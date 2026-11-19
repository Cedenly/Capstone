import { hasPracticeQuestions, isOfferedTest } from '../lib/questionAvailability.js';
import { Router } from 'express';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { initFirestore } from '../config/firebase.js';
import { getStripe } from '../config/stripe.js';
import { effectivePlan } from '../lib/entitlements.js';
import { normalizeBillingDate, billingTime, diagnoseSubscription } from '../lib/billingIdentity.js';
import { cancelCheckoutAttempt } from '../services/checkoutRecovery.js';

const r = Router();

const validSessionId = value =>
  typeof value === 'string' &&
  /^cs_[A-Za-z0-9_]+$/.test(value);

const validTestId = value =>
  typeof value === 'string' &&
  /^[a-z0-9_-]{1,64}$/i.test(value);

const validSubscriptionDocumentId = value =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);

// Informa la prueba que utilizaría el webhook al aplicar el plan Uni.
// Solo consulta datos; no cambia la suscripción ni concede acceso.
async function uniAssignmentFor(db, subscription, user, userId) {
  if (
    !subscription ||
    subscription.provider !== 'stripe' ||
    subscription.userId !== userId ||
    subscription.stripeCustomerId !== user.stripeCustomerId ||
    !validSessionId(subscription.checkoutSessionId)
  ) {
    return null;
  }

  const originalSnap = await db
    .collection('checkoutSessions')
    .doc(subscription.checkoutSessionId)
    .get();

  const original = originalSnap.data();

  if (
    !original ||
    original.userId !== userId ||
    original.stripeSubscriptionId !== user.stripeSubscriptionId
  ) {
    return null;
  }

  // Mantiene la misma prioridad utilizada por stripeBilling.js.
  const testId =
    original.testId ||
    user.billingTestId ||
    (
      Array.isArray(user.selectedTests)
        ? user.selectedTests[0]
        : null
    );

  if (!validTestId(testId)) {
    return null;
  }

  const testSnap = await db.collection('tests').doc(testId).get();

  if (!testSnap.exists) {
    return null;
  }

  const test = testSnap.data();
  if (subscription.plan === 'all' &&
      (!isOfferedTest(test) || !await hasPracticeQuestions(testId))) {
    return null;
  }

  return {
    testId,
    testLabel:
      typeof test.label === 'string' && test.label.trim()
        ? test.label.trim()
        : testId,
  };
}

// Consulta lo confirmado por el webhook. No activa planes.
r.get('/billing/status', authRequired, wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const requestedId = req.query.session_id;

  if (
    requestedId !== undefined &&
    !validSessionId(requestedId)
  ) {
    return fail(
      res,
      400,
      'INVALID_CHECKOUT_SESSION',
      'La sesion de pago no es valida.',
    );
  }

  const { db } = await initFirestore();
  const userId = req.user.id;

  const [userSnap, pointerSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('checkoutAttempts').doc(userId).get(),
  ]);

  if (!userSnap.exists) {
    return fail(
      res,
      404,
      'USER_NOT_FOUND',
      'La cuenta no existe.',
    );
  }

  const user = userSnap.data();
  const pointer = pointerSnap.data();

  const sessionId =
    requestedId ||
    (!pointer?.closed ? pointer?.sessionId : null);

  const [subSnap, checkoutSnap] = await Promise.all([
    validSubscriptionDocumentId(user.stripeSubscriptionId)
      ? db
          .collection('subscriptions')
          .doc(user.stripeSubscriptionId)
          .get()
      : null,
    sessionId
      ? db.collection('checkoutSessions').doc(sessionId).get()
      : null,
  ]);

  const s = subSnap?.data();

  const ownedSub =
    s?.provider === 'stripe' &&
    s.userId === userId;
  const periodEnd = billingTime(s?.currentPeriodEnd);

  const accessActive = !!(
    ownedSub &&
    s.stripeCustomerId === user.stripeCustomerId &&
    s.accessActive === true &&
    ['active', 'past_due'].includes(s.status) &&
    effectivePlan(user) === s.plan &&
    periodEnd !== null && periodEnd > Date.now()
  );

  const uniAssignment = ownedSub
    ? await uniAssignmentFor(db, s, user, userId)
    : null;

  const subscription = ownedSub
    ? {
        id: subSnap.id,
        plan: s.plan,
        testId:
          s.plan === 'uni'
            ? (s.testId || user.billingTestId || null)
            : null,
        billingCycle: s.billingCycle,
        status: s.status,
        accessActive,
        paymentPending: s.paymentPending === true,
        currentPeriodEnd: normalizeBillingDate(s.currentPeriodEnd),
        cancelAtPeriodEnd: !!s.cancelAtPeriodEnd,
        paymentMethod: s.paymentMethod || null,
        uniAssignment,
      }
    : null;

  let checkout = null;
  const c = checkoutSnap?.data();

  if (requestedId && (!c || c.userId !== userId)) {
    return fail(
      res,
      404,
      'CHECKOUT_NOT_FOUND',
      'No se encontro esa compra en tu cuenta.',
    );
  }

  if (c?.userId === userId) {
    const confirmed =
      accessActive &&
      c.stripeSubscriptionId === subscription?.id &&
      c.fulfillmentStatus === 'active';

    const ended =
      c.fulfillmentStatus === 'ended' ||
      (
        c.stripeSubscriptionId &&
        user.stripeSubscriptionId &&
        c.stripeSubscriptionId !== user.stripeSubscriptionId
      ) ||
      (
        c.stripeSubscriptionId === subscription?.id &&
        ['canceled', 'incomplete_expired'].includes(s?.status)
      );

    checkout = {
      id: checkoutSnap.id,
      attemptId: c.attemptId || null,
      plan: c.plan,
      testId: c.testId || null,
      billingCycle: c.billingCycle,
      amount: c.amountCents / 100,
      currency: 'USD',
      status: confirmed
        ? 'active'
        : c.status === 'expired'
          ? 'expired'
          : ended
            ? 'ended'
            : 'pending',
    };
  } else if (!requestedId && pointer && !pointer.closed) {
    checkout = {
      id: null,
      attemptId: pointer.attemptId || null,
      plan: pointer.plan,
      testId: pointer.testId || null,
      billingCycle: pointer.billingCycle,
      amount: pointer.amountCents / 100,
      currency: 'USD',
      status: 'pending',
    };
  }

  // Diagnóstico de lectura: no altera la política de acceso ni reasigna
  // identidades. Ante una referencia ajena solo se devuelven códigos genéricos.
  const billingIdentity = diagnoseSubscription({
    userId, user, subscriptionId: subSnap?.id ?? user.stripeSubscriptionId ?? null,
    subscription: s,
  });
  return ok(res, { subscription, checkout, billingIdentity });
}));

// Descarta solo el intento pendiente de esta cuenta. La resolución y el cierre
// comparten la misma reserva que continuar el checkout; nunca activan un plan.
async function cancelAttempt(req, res, db, attemptId) {
  try {
    const result = await cancelCheckoutAttempt({
      db, stripe: getStripe(), userId: req.user.id, attemptId,
    });
    return ok(res, result);
  } catch (error) {
    if (error.status && error.code) throw error;
    console.error('[stripe cerrar checkout]', error.code || error.type || 'ERROR');
    return fail(res, 503, 'CHECKOUT_UNAVAILABLE', 'No se pudo cerrar el pago. Actualiza su estado y vuelve a descartarlo.');
  }
}

r.post(
  '/checkout/attempts/:attemptId/cancel',
  authRequired,
  wrap(async (req, res) => {
    if (typeof req.params.attemptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(req.params.attemptId)) {
      return fail(res, 400, 'INVALID_CHECKOUT_ATTEMPT', 'El intento de pago no es válido.');
    }
    const { db } = await initFirestore();
    return cancelAttempt(req, res, db, req.params.attemptId);
  }),
);

// Compatibilidad con clientes anteriores que ya conocen la sesión.
// No cancela una suscripción ya contratada ni toca un intento posterior.
r.post(
  '/checkout/sessions/:id/cancel',
  authRequired,
  wrap(async (req, res) => {
    if (!validSessionId(req.params.id)) {
      return fail(res, 400, 'INVALID_CHECKOUT_SESSION', 'La sesión de pago no es válida.');
    }
    const { db } = await initFirestore();
    const checkout = (await db.collection('checkoutSessions').doc(req.params.id).get()).data();
    if (!checkout || checkout.userId !== req.user.id || !checkout.attemptId) {
      return fail(res, 404, 'CHECKOUT_NOT_FOUND', 'No se encontró esa compra en tu cuenta.');
    }
    return cancelAttempt(req, res, db, checkout.attemptId);
  }),
);

export default r;
