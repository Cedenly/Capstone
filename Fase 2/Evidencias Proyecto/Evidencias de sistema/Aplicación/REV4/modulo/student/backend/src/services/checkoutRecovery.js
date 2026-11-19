import { randomUUID } from 'node:crypto';

// A lease serializes work on one user's attempt. It is not evidence that a
// timed-out Stripe create failed: an uncertain create keeps its reservation.
const LEASE_MS = 90_000;
const CREATE_WINDOW_MS = 23 * 60 * 60 * 1000;
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
const QUIET_MS = 60_000;
const READ_OPTIONS = { timeout: 7000, maxNetworkRetries: 0 };
const MAX_SCAN_PAGES = 1000;

export const checkoutError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

const problem = (code, message, status = 503) => {
  throw checkoutError(status, code, message);
};

const pointerFor = (db, userId) => db.collection('checkoutAttempts').doc(userId);
const sessionsFor = (db, attemptId) => db.collection('checkoutSessions')
  .where('attemptId', '==', attemptId).limit(2);
const objectId = value => typeof value === 'string' ? value : value?.id;

function assertOperation(pointer, attemptId, operation) {
  if (!pointer || pointer.attemptId !== attemptId) {
    problem('CHECKOUT_CHANGED', 'El intento cambió. Actualiza su estado.', 409);
  }
  if (pointer.operationId !== operation.id || pointer.operationLeaseUntil <= Date.now()) {
    problem('CHECKOUT_BUSY', 'El intento se está conciliando. Reintenta en unos segundos.', 409);
  }
}

export async function acquireAttemptOperation({ db, userId, attemptId, kind }) {
  const ref = pointerFor(db, userId);
  const operation = { id: randomUUID(), kind };
  const result = await db.runTransaction(async tx => {
    const pointer = (await tx.get(ref)).data();
    if (!pointer || pointer.attemptId !== attemptId) {
      problem('CHECKOUT_ATTEMPT_NOT_FOUND', 'Ese intento ya no es el pendiente de tu cuenta.', 404);
    }
    if (kind !== 'cancel' && pointer.closed) {
      problem('CHECKOUT_CHANGED', 'El intento terminó. Actualiza su estado.', 409);
    }
    if (kind !== 'cancel' && pointer.cancelRequested) {
      problem('CHECKOUT_CANCELLING', 'El descarte está pendiente. Vuelve a descartarlo para completar el cierre.', 409);
    }
    // Persist the user's cancellation intent even while another request owns
    // the lease. That request must not return another payment URL afterwards.
    const cancellation = kind === 'cancel' ? { cancelRequested: true } : {};
    if (pointer.operationId && pointer.operationLeaseUntil > Date.now()) {
      if (kind === 'cancel') tx.set(ref, cancellation, { merge: true });
      return { busy: true };
    }
    const updates = {
      ...cancellation,
      operationId: operation.id,
      operationKind: kind,
      operationLeaseUntil: Date.now() + LEASE_MS,
    };
    tx.set(ref, updates, { merge: true });
    return { attempt: { ...pointer, ...updates } };
  });
  if (result.busy) {
    problem('CHECKOUT_BUSY', 'El intento se está conciliando. Reintenta en unos segundos.', 409);
  }
  return { attempt: result.attempt, operation };
}

async function renewOperation({ db, userId, attempt, operation }) {
  await db.runTransaction(async tx => {
    const ref = pointerFor(db, userId);
    const pointer = (await tx.get(ref)).data();
    assertOperation(pointer, attempt.attemptId, operation);
    if (operation.kind !== 'cancel' && pointer.cancelRequested) {
      problem('CHECKOUT_CANCELLING', 'El descarte está pendiente. Actualiza su estado.', 409);
    }
    tx.set(ref, { operationLeaseUntil: Date.now() + LEASE_MS }, { merge: true });
  });
}

export async function releaseAttemptOperation({ db, userId, attemptId, operation }) {
  try {
    await db.runTransaction(async tx => {
      const ref = pointerFor(db, userId);
      const pointer = (await tx.get(ref)).data();
      if (pointer?.attemptId === attemptId && pointer.operationId === operation.id) {
        tx.set(ref, { operationId: null, operationKind: null, operationLeaseUntil: 0 }, { merge: true });
      }
    });
  } catch (error) {
    // Cleanup cannot invalidate an already-sent response or hide the original
    // error. On failure the durable lease expires by itself after 90 seconds.
    console.error('[checkout liberar reserva]', error.code || 'ERROR');
  }
}

export function validateAttemptSession(session, attempt, userId) {
  const metadata = session?.metadata;
  if (
    !/^cs_[A-Za-z0-9_]+$/.test(session?.id || '') || session.livemode !== false || session.mode !== 'subscription' ||
    session.client_reference_id !== userId || metadata?.integration !== 'aprueba_mvp' ||
    metadata.userId !== userId || metadata.attemptId !== attempt.attemptId ||
    metadata.plan !== attempt.plan || metadata.billingCycle !== attempt.billingCycle ||
    (metadata.testId || null) !== (attempt.testId || null) ||
    (attempt.params?.customer && objectId(session.customer) !== attempt.params.customer)
  ) {
    problem('CHECKOUT_MISMATCH', 'La sesión no corresponde a este intento de compra.', 409);
  }
  if (!['open', 'complete', 'expired'].includes(session.status)) {
    problem('CHECKOUT_UNAVAILABLE', 'No se pudo comprobar el estado del pago. Reintenta.');
  }
  return session;
}

async function stripeCall(context, call) {
  await renewOperation(context);
  return call();
}

// Checkout Session list has no metadata filter. Complete every page in the
// creation interval, then match the immutable attempt identity server-side.
async function findRemoteSession(context) {
  const { stripe, attempt, userId } = context;
  const createdAt = Date.parse(attempt.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > Date.now() + 5 * 60_000) {
    problem('CHECKOUT_UNAVAILABLE', 'No se pudo comprobar la fecha del intento.');
  }
  const created = {
    gte: Math.max(0, Math.floor(createdAt / 1000) - 300),
    lte: Math.ceil(Date.now() / 1000),
  };
  let cursor;
  let found = null;
  const cursors = new Set();
  for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
    const result = await stripeCall(context, () => stripe.checkout.sessions.list({
      created, limit: 100, ...(cursor ? { starting_after: cursor } : {}),
    }, READ_OPTIONS));
    if (!Array.isArray(result?.data) || typeof result.has_more !== 'boolean') {
      problem('CHECKOUT_UNAVAILABLE', 'La conciliación del intento no pudo completarse.');
    }
    for (const session of result.data) {
      if (session.metadata?.attemptId !== attempt.attemptId) continue;
      validateAttemptSession(session, attempt, userId);
      if (found && found.id !== session.id) {
        problem('CHECKOUT_CONFLICT', 'Hay más de una sesión para este intento; no se abrirá otro pago.', 409);
      }
      found = session;
    }
    if (!result.has_more) return found;
    const next = result.data.at(-1)?.id;
    if (!next || next === cursor || cursors.has(next)) {
      problem('CHECKOUT_UNAVAILABLE', 'La conciliación del intento no pudo completarse.');
    }
    cursors.add(next);
    cursor = next;
  }
  problem('CHECKOUT_UNAVAILABLE', 'La conciliación del intento no pudo completarse. Reintenta.');
}

async function persistSession(context, session) {
  const { db, userId, attempt, operation } = context;
  validateAttemptSession(session, attempt, userId);
  await db.runTransaction(async tx => {
    const pointerRef = pointerFor(db, userId);
    const sessionRef = db.collection('checkoutSessions').doc(session.id);
    const [pointerSnap, matches, sessionSnap] = await Promise.all([
      tx.get(pointerRef), tx.get(sessionsFor(db, attempt.attemptId)),
      tx.get(sessionRef),
    ]);
    const pointer = pointerSnap.data();
    const existing = sessionSnap.data();
    assertOperation(pointer, attempt.attemptId, operation);
    if (
      (pointer.sessionId && pointer.sessionId !== session.id) ||
      matches.docs.some(doc => doc.id !== session.id || doc.data().userId !== userId) ||
      (existing && (existing.userId !== userId || existing.attemptId !== attempt.attemptId))
    ) {
      problem('CHECKOUT_CONFLICT', 'La relación del intento con su sesión no es única.', 409);
    }
    tx.set(pointerRef, { sessionId: session.id }, { merge: true });
    // The billing webhook deliberately requires this unique record. Recovery
    // restores it, but does not activate a subscription or grant paid access.
    tx.set(sessionRef, {
      checkoutSessionId: session.id,
      userId,
      plan: attempt.plan,
      billingCycle: attempt.billingCycle,
      priceId: attempt.priceId,
      testId: attempt.testId || null,
      amountCents: attempt.amountCents,
      currency: 'usd',
      attemptId: attempt.attemptId,
      createdAt: attempt.createdAt,
    }, { merge: true });
  });
  return session;
}

async function closeAbsentAttempt(context) {
  const { db, userId, attempt, operation } = context;
  await db.runTransaction(async tx => {
    const ref = pointerFor(db, userId);
    const [snap, matches] = await Promise.all([
      tx.get(ref), tx.get(sessionsFor(db, attempt.attemptId)),
    ]);
    const pointer = snap.data();
    assertOperation(pointer, attempt.attemptId, operation);
    if (pointer.sessionId || matches.docs.length) {
      problem('CHECKOUT_CHANGED', 'El intento cambió durante la conciliación. Reintenta.', 409);
    }
    // For a create dispatched by this implementation, a timeout is ambiguous.
    // Wait until its fixed expiry (or the legacy maximum lifetime) before a
    // negative scan can release the slot. Never infer failure from a timeout.
    if (pointer.creationStartedAt) {
      const fixedExpiry = Number(pointer.params?.expires_at) * 1000;
      const safeAt = Number.isFinite(fixedExpiry) && fixedExpiry > 0
        ? fixedExpiry + QUIET_MS
        : Math.max(
            Date.parse(pointer.creationStartedAt),
            Date.parse(pointer.lastCreationStartedAt || pointer.creationStartedAt),
          ) + MAX_SESSION_MS + QUIET_MS;
      if (!Number.isFinite(safeAt) || Date.now() < safeAt) {
        problem('CHECKOUT_RECONCILIATION_PENDING', 'La creación anterior aún debe conciliarse; no se abrirá otro pago. Reintenta más tarde.', 409);
      }
    }
    tx.set(ref, {
      closed: true, closedReason: 'no_session', closedAt: new Date().toISOString(),
    }, { merge: true });
  });
}

async function markCreation(context) {
  const { db, userId, attempt, operation } = context;
  await db.runTransaction(async tx => {
    const ref = pointerFor(db, userId);
    const pointer = (await tx.get(ref)).data();
    assertOperation(pointer, attempt.attemptId, operation);
    if (pointer.closed || (operation.kind !== 'cancel' && pointer.cancelRequested)) {
      problem('CHECKOUT_CANCELLING', 'El intento ya no permite abrir un pago. Actualiza su estado.', 409);
    }
    if (Date.now() - Date.parse(pointer.createdAt) >= CREATE_WINDOW_MS) {
      problem('CHECKOUT_BUSY', 'El intento requiere completar su conciliación antes de continuar.', 409);
    }
    tx.set(ref, {
      creationStartedAt: pointer.creationStartedAt || new Date().toISOString(),
      lastCreationStartedAt: new Date().toISOString(),
    }, { merge: true });
  });
}

export async function resolveAttemptSession(context) {
  const { db, stripe, userId, attempt, allowCreate = true } = context;
  const matches = await sessionsFor(db, attempt.attemptId).get();
  if (matches.docs.length > 1 || matches.docs.some(doc => doc.data().userId !== userId)) {
    problem('CHECKOUT_CONFLICT', 'La relación del intento con su sesión no es única.', 409);
  }
  const localId = matches.docs[0]?.id;
  if (attempt.sessionId && localId && attempt.sessionId !== localId) {
    problem('CHECKOUT_CONFLICT', 'La relación del intento con su sesión no es única.', 409);
  }
  const sessionId = attempt.sessionId || localId;
  if (sessionId) {
    const session = await stripeCall(context, () => stripe.checkout.sessions.retrieve(sessionId, {}, READ_OPTIONS));
    return persistSession(context, session);
  }

  const recovered = await findRemoteSession(context);
  if (recovered) return persistSession(context, recovered);

  const age = Date.now() - Date.parse(attempt.createdAt);
  if (!Number.isFinite(age) || age < -5 * 60_000) {
    problem('CHECKOUT_UNAVAILABLE', 'No se pudo comprobar la fecha del intento.');
  }
  if (!allowCreate || age >= CREATE_WINDOW_MS) {
    await closeAbsentAttempt(context);
    return null;
  }
  if (!attempt.params || typeof attempt.params !== 'object') {
    problem('CHECKOUT_UNAVAILABLE', 'No se pudieron recuperar los parámetros del intento.');
  }

  await markCreation(context);
  let session;
  try {
    session = await stripeCall(context, () => stripe.checkout.sessions.create(attempt.params, {
      ...READ_OPTIONS, idempotencyKey: `aprueba-checkout-${attempt.attemptId}`,
    }));
  } catch (error) {
    // A server error can be cached by Stripe, and a timeout can hide success.
    // Reconcile before replying, always retaining the same attempt/key/params.
    if (['CHECKOUT_CANCELLING', 'CHECKOUT_BUSY', 'CHECKOUT_CHANGED'].includes(error.code)) throw error;
    const afterFailure = await findRemoteSession(context);
    if (afterFailure) return persistSession(context, afterFailure);
    problem('CHECKOUT_UNAVAILABLE', 'No se pudo confirmar la creación del pago. Actualiza su estado y reintenta.');
  }
  return persistSession(context, session);
}

export async function closeExpiredAttempt(context, session) {
  const { db, userId, attempt, operation } = context;
  validateAttemptSession(session, attempt, userId);
  if (session.status !== 'expired') {
    problem('PAYMENT_PROCESSING', 'El pago ya está en proceso. Actualiza su estado.', 409);
  }
  await db.runTransaction(async tx => {
    const ref = pointerFor(db, userId);
    const pointer = (await tx.get(ref)).data();
    assertOperation(pointer, attempt.attemptId, operation);
    if (pointer.sessionId !== session.id) {
      problem('CHECKOUT_CHANGED', 'El intento cambió. Actualiza su estado.', 409);
    }
    tx.set(db.collection('checkoutSessions').doc(session.id), {
      status: 'expired', fulfillmentStatus: 'expired', updatedAt: new Date().toISOString(),
    }, { merge: true });
    tx.set(ref, { closed: true, closedReason: 'expired', closedAt: new Date().toISOString() }, { merge: true });
  });
}

export async function assertAttemptReady(context, session) {
  const { db, userId, attempt, operation } = context;
  await db.runTransaction(async tx => {
    const pointer = (await tx.get(pointerFor(db, userId))).data();
    assertOperation(pointer, attempt.attemptId, operation);
    if (pointer.cancelRequested) {
      problem('CHECKOUT_CANCELLING', 'El descarte está pendiente. Actualiza su estado.', 409);
    }
    if (pointer.closed || pointer.sessionId !== session.id) {
      problem('CHECKOUT_CHANGED', 'El intento terminó o cambió. Actualiza su estado.', 409);
    }
  });
}

export async function cancelCheckoutAttempt({ db, stripe, userId, attemptId }) {
  const { attempt, operation } = await acquireAttemptOperation({ db, userId, attemptId, kind: 'cancel' });
  const context = { db, stripe, userId, attempt, operation, allowCreate: true };
  try {
    if (attempt.closed && ['expired', 'no_session'].includes(attempt.closedReason)) return { cancelled: true };
    let session = await resolveAttemptSession(context);
    if (!session) return { cancelled: true };
    if (session.status === 'open') {
      try {
        session = await stripeCall(context, () => stripe.checkout.sessions.expire(session.id, {}, READ_OPTIONS));
      } catch (error) {
        if (['CHECKOUT_BUSY', 'CHECKOUT_CHANGED'].includes(error.code)) throw error;
        // Expiration can race payment or succeed despite a lost response.
        session = await stripeCall(context, () => stripe.checkout.sessions.retrieve(session.id, {}, READ_OPTIONS));
      }
      validateAttemptSession(session, attempt, userId);
    }
    if (session.status === 'open') {
      problem('CHECKOUT_UNAVAILABLE', 'No se pudo cerrar el pago. Vuelve a descartarlo.');
    }
    await closeExpiredAttempt(context, session);
    return { cancelled: true };
  } finally {
    await releaseAttemptOperation({ db, userId, attemptId, operation });
  }
}
