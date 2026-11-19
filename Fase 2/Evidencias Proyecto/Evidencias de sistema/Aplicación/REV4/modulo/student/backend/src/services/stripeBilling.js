import { hasPracticeQuestions, isOfferedTest } from '../lib/questionAvailability.js';
import { initFirestore } from '../config/firebase.js';
import { getStripe, getStripePriceId } from '../config/stripe.js';

const PROCESSING_VERSION = 3;

const events = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.updated',
]);

const terminal = new Set(['canceled', 'incomplete_expired']);
const readOptions = { timeout: 7000, maxNetworkRetries: 0 };

const catalog = [
  {
    plan: 'uni',
    billingCycle: 'monthly',
    cents: 100,
    interval: 'month',
  },
  {
    plan: 'uni',
    billingCycle: 'yearly',
    cents: 1000,
    interval: 'year',
  },
  {
    plan: 'all',
    billingCycle: 'monthly',
    cents: 500,
    interval: 'month',
  },
  {
    plan: 'all',
    billingCycle: 'yearly',
    cents: 5000,
    interval: 'year',
  },
];

const objectId = value =>
  typeof value === 'string' ? value : value?.id || null;

const invoiceSubscription = invoice =>
  objectId(
    invoice?.parent?.subscription_details?.subscription ||
    invoice?.subscription,
  );

const iso = seconds =>
  Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;

const documentId = value =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('/');

function requireData(condition, code = 'BILLING_DATA_MISMATCH') {
  if (!condition) {
    throw Object.assign(
      new Error('La confirmacion necesita revision o reintento.'),
      { code },
    );
  }
}

function readSubscription(stripe, id) {
  return stripe.subscriptions.retrieve(
    id,
    {
      expand: [
        'latest_invoice',
        'default_payment_method',
        'default_source',
        'customer.invoice_settings.default_payment_method',
        'customer.default_source',
      ],
    },
    readOptions,
  );
}

function planOf(subscription) {
  const items = subscription.items?.data || [];

  requireData(
    items.length === 1 && !subscription.items.has_more,
  );

  const item = items[0];
  const price = item.price;

  const selected = catalog.find(
    p => getStripePriceId(p.plan, p.billingCycle) === price?.id,
  );

  requireData(
    selected &&
    item.quantity === 1 &&
    price.livemode === false &&
    price.currency === 'usd' &&
    price.unit_amount === selected.cents &&
    objectId(price.product) === `prod_aprueba_${selected.plan}` &&
    price.type === 'recurring' &&
    price.billing_scheme === 'per_unit' &&
    price.recurring?.interval === selected.interval &&
    price.recurring.interval_count === 1 &&
    price.recurring.usage_type === 'licensed',
    'BILLING_PRICE_MISMATCH',
  );

  const end =
    item.current_period_end ?? subscription.current_period_end;
  const start =
    item.current_period_start ?? subscription.current_period_start;

  requireData(
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start,
  );

  return {
    ...selected,
    priceId: price.id,
    start,
    end,
  };
}

function validateInvoice(invoice, subscription, customerId) {
  requireData(
    invoice?.object === 'invoice' &&
    invoice.livemode === false &&
    invoice.currency === 'usd' &&
    objectId(invoice.customer) === customerId &&
    invoiceSubscription(invoice) === subscription.id,
  );
}

function ownsSubscription(user, subscriptionId, customerId) {
  return (
    user.billingProvider === 'stripe' &&
    user.stripeSubscriptionId === subscriptionId &&
    user.stripeCustomerId === customerId
  );
}

async function eligibleSubject(db, tx, testId) {
  if (typeof testId !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(testId)) {
    return false;
  }
  const subject = await tx.get(db.collection('tests').doc(testId));
  return isOfferedTest(subject.data()) && hasPracticeQuestions(testId, tx);
}

// Un período contiguo o solapado conserva la materia previamente acreditada.
// Después de una interrupción, asignar el mismo identificador vuelve a requerir catálogo.
function continuesSubject(previous, next, testId) {
  return previous?.plan === 'uni' && previous.testId === testId &&
    previous.start < next.end && next.start <= previous.end;
}

// El derecho pagado se conserva separado de la ultima factura.
function previousPaidPlan(stored, user, subscriptionId, customerId) {
  if (
    stored?.provider !== 'stripe' ||
    stored.livemode !== false ||
    stored.userId !== user.id ||
    stored.stripeCustomerId !== customerId ||
    !ownsSubscription(user, subscriptionId, customerId)
  ) {
    return null;
  }

  // Compatibilidad con suscripciones anteriores a este cambio.
  const legacy =
    stored.accessActive === true &&
    stored.status === 'active' &&
    user.billingStatus === 'active' &&
    user.plan === stored.plan &&
    user.billingPeriodEnd === stored.currentPeriodEnd;

  const paid = stored.paidEntitlement || (legacy ? {
    plan: stored.plan,
    testId: stored.testId || user.billingTestId || null,
    billingCycle: stored.billingCycle,
    priceId: stored.priceId,
    currentPeriodStart: stored.currentPeriodStart,
    currentPeriodEnd: stored.currentPeriodEnd,
    invoiceId: stored.latestInvoiceId,
  } : null);

  if (!paid) return null;

  const start = Date.parse(paid.currentPeriodStart) / 1000;
  const end = Date.parse(paid.currentPeriodEnd) / 1000;

  if (
    !['uni', 'all'].includes(paid.plan) ||
    !['monthly', 'yearly'].includes(paid.billingCycle) ||
    paid.priceId !== getStripePriceId(paid.plan, paid.billingCycle) ||
    !documentId(paid.invoiceId) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    (
      paid.plan === 'uni' &&
      (
        typeof paid.testId !== 'string' ||
        !/^[a-z0-9_-]{1,64}$/i.test(paid.testId)
      )
    )
  ) {
    return null;
  }

  return {
    plan: paid.plan,
    testId: paid.plan === 'uni' ? paid.testId : null,
    billingCycle: paid.billingCycle,
    priceId: paid.priceId,
    start,
    end,
    invoiceId: paid.invoiceId,
  };
}

// Recupera suscripciones antiguas cuyo acceso ya fue sobrescrito.
// Solo acepta facturas pagadas del mismo cliente y suscripcion.
async function recoverPaidPlan(
  stripe,
  subscription,
  customerId,
  preferredTestId,
  nowSeconds,
) {
  const result = await stripe.invoices.list(
    {
      customer: customerId,
      subscription: subscription.id,
      status: 'paid',
      limit: 100,
    },
    readOptions,
  );

  for (const invoice of result.data) {
    validateInvoice(invoice, subscription, customerId);

    if (
      invoice.status !== 'paid' ||
      invoice.amount_remaining !== 0 ||
      invoice.lines?.has_more
    ) {
      continue;
    }

    const candidates = [];

    for (const line of invoice.lines?.data || []) {
      const parent = line.parent?.subscription_item_details;
      const recurring =
        line.parent?.type === 'subscription_item_details' ||
        line.type === 'subscription';

      const lineSubscriptionId = objectId(
        parent?.subscription || line.subscription,
      );

      if (
        !recurring ||
        (
          lineSubscriptionId &&
          lineSubscriptionId !== subscription.id
        ) ||
        line.livemode !== false ||
        line.currency !== 'usd' ||
        line.quantity !== 1 ||
        !(line.amount > 0)
      ) {
        continue;
      }

      const details = line.pricing?.price_details;
      const priceId = objectId(details?.price || line.price);
      const productId = objectId(
        details?.product || line.price?.product,
      );

      const selected = catalog.find(
        p => getStripePriceId(p.plan, p.billingCycle) === priceId,
      );

      const start = line.period?.start;
      const end = line.period?.end;

      if (
        !selected ||
        productId !== `prod_aprueba_${selected.plan}` ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        start > nowSeconds ||
        end <= nowSeconds
      ) {
        continue;
      }

      if (
        selected.plan === 'uni' &&
        (
          typeof preferredTestId !== 'string' ||
          !/^[a-z0-9_-]{1,64}$/i.test(preferredTestId)
        )
      ) {
        continue;
      }

      candidates.push({
        ...selected,
        priceId,
        start,
        end,
        testId: selected.plan === 'uni' ? preferredTestId : null,
        invoiceId: invoice.id,
      });
    }

    // El MVP utiliza un unico producto por suscripcion.
    if (candidates.length === 1) {
      return { paidPlan: candidates[0], invoice };
    }
  }

  return null;
}

function invoiceRecord(
  invoice,
  userId,
  subscriptionId,
  customerId,
  now,
) {
  return {
    id: invoice.id,
    provider: 'stripe',
    livemode: false,
    userId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId,
    amount:
      (invoice.status === 'paid'
        ? invoice.amount_paid
        : invoice.amount_due) / 100,
    currency: 'USD',
    status: invoice.status,
    paidAt: iso(invoice.status_transitions?.paid_at),
    createdAt: iso(invoice.created),
    updatedAt: now,
    pdfUrl: invoice.invoice_pdf || null,
    hostedInvoiceUrl: invoice.hosted_invoice_url || null,
  };
}

async function syncCustomerPaymentMethod(event, stripe, db, eventRef) {
  const customerId = event.data.object.id;

  requireData(
    event.livemode === false &&
    event.data.object.object === 'customer' &&
    typeof customerId === 'string' &&
    /^cus_[A-Za-z0-9]+$/.test(customerId),
  );

  const usersQuery = db
    .collection('users')
    .where('stripeCustomerId', '==', customerId)
    .limit(2);

  return db.runTransaction(async tx => {
    const [receipt, users] = await Promise.all([
      tx.get(eventRef),
      tx.get(usersQuery),
    ]);

    if (receipt.data()?.processingVersion === PROCESSING_VERSION) {
      return { received: true, duplicate: true };
    }

    // Los clientes que no pertenecen a Aprueba se ignoran.
    if (users.empty) {
      return { received: true, ignored: true };
    }

    requireData(
      users.docs.length === 1,
      'BILLING_CUSTOMER_CONFLICT',
    );

    const userDoc = users.docs[0];
    const user = userDoc.data();
    const subscriptionId = user.stripeSubscriptionId;

    if (
      !documentId(subscriptionId) ||
      !ownsSubscription(user, subscriptionId, customerId)
    ) {
      return { received: true, ignored: true };
    }

    const subscriptionRef = db
      .collection('subscriptions')
      .doc(subscriptionId);

    const storedSnap = await tx.get(subscriptionRef);
    const stored = storedSnap.data();

    requireData(
      storedSnap.exists &&
      stored.provider === 'stripe' &&
      stored.livemode === false &&
      stored.userId === userDoc.id &&
      stored.stripeCustomerId === customerId,
      'BILLING_DATA_MISMATCH',
    );

    // Recupera el estado actual, incluso si el evento llegó tarde.
    const subscription = await readSubscription(
      stripe,
      subscriptionId,
    );

    requireData(
      subscription.object === 'subscription' &&
      subscription.livemode === false &&
      subscription.id === subscriptionId &&
      objectId(subscription.customer) === customerId &&
      subscription.metadata?.integration === 'aprueba_mvp' &&
      subscription.metadata.userId === userDoc.id,
      'BILLING_DATA_MISMATCH',
    );

    // Respeta la prioridad del medio de pago de la suscripción.
    const paymentMethod =
      subscription.default_payment_method ||
      subscription.default_source ||
      subscription.customer?.invoice_settings?.default_payment_method ||
      subscription.customer?.default_source ||
      null;

    const card =
      paymentMethod?.card ||
      (paymentMethod?.object === 'card' ? paymentMethod : null);

    const registeredCard =
      typeof card?.brand === 'string' &&
      typeof card?.last4 === 'string' &&
      /^\d{4}$/.test(card.last4)
        ? { brand: card.brand, last4: card.last4 }
        : null;

    const now = new Date().toISOString();

    tx.set(
      subscriptionRef,
      {
        paymentMethod: registeredCard,
        updatedAt: now,
      },
      { merge: true },
    );

    tx.set(eventRef, {
      type: event.type,
      userId: userDoc.id,
      stripeSubscriptionId: subscriptionId,
      checkoutSessionId: stored.checkoutSessionId || null,
      processingVersion: PROCESSING_VERSION,
      processedAt: now,
    });

    return { received: true, processed: true };
  }, { maxAttempts: 3 });
}
export async function processStripeEvent(event) {
  if (!events.has(event.type)) {
    return { received: true, ignored: true };
  }

  requireData(
    process.env.DATA_DRIVER === 'firestore',
    'FIRESTORE_REQUIRED',
  );

  const { db } = await initFirestore();
  const eventRef = db.collection('stripeEvents').doc(event.id);
  const existingReceipt = (await eventRef.get()).data();

  if (existingReceipt?.processingVersion === PROCESSING_VERSION) {
    return { received: true, duplicate: true };
  }

  const stripe = getStripe();

  if (event.type === 'customer.updated') {
    return syncCustomerPaymentMethod(
      event,
      stripe,
      db,
      eventRef,
    );
  }

  let sessionId = null;
  let subscriptionId = null;
  let invoiceId = null;
  let metadata;

  // Se consulta el estado actual de Stripe, no se confia
  // solamente en el estado incluido en el evento recibido.
  if (event.type.startsWith('checkout.session.')) {
    const session = await stripe.checkout.sessions.retrieve(
      event.data.object.id,
      {},
      readOptions,
    );

    if (session.metadata?.integration !== 'aprueba_mvp') {
      return { received: true, ignored: true };
    }

    requireData(
      session.livemode === false &&
      session.mode === 'subscription',
    );

    sessionId = session.id;
    subscriptionId = objectId(session.subscription);
    metadata = session.metadata;
  } else {
    if (event.type.startsWith('invoice.')) {
      const invoice = await stripe.invoices.retrieve(
        event.data.object.id,
        {},
        readOptions,
      );

      requireData(invoice.livemode === false);

      subscriptionId = invoiceSubscription(invoice);
      invoiceId = invoice.id;

      if (!subscriptionId) {
        return { received: true, ignored: true };
      }
    } else {
      subscriptionId = event.data.object.id;
    }

    const subscription = await readSubscription(
      stripe,
      subscriptionId,
    );

    requireData(subscription.livemode === false);
    metadata = subscription.metadata;
  }

  if (metadata?.integration !== 'aprueba_mvp') {
    return { received: true, ignored: true };
  }

  const { userId, attemptId } = metadata;

  requireData(documentId(userId) && documentId(attemptId));

  const userRef = db.collection('users').doc(userId);
  const pointerRef = db.collection('checkoutAttempts').doc(userId);
  const sessionQuery = db
    .collection('checkoutSessions')
    .where('attemptId', '==', attemptId)
    .limit(2);

  return db.runTransaction(async tx => {
    const receipt = await tx.get(eventRef);

    if (
      receipt.data()?.processingVersion === PROCESSING_VERSION
    ) {
      return { received: true, duplicate: true };
    }

    const [userSnap, matches, pointerSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(sessionQuery),
      tx.get(pointerRef),
    ]);

    requireData(
      userSnap.exists && matches.docs.length === 1,
      'BILLING_CHECKOUT_NOT_FOUND',
    );

    const user = { ...userSnap.data(), id: userId };
    const checkoutDoc = matches.docs[0];
    const checkout = checkoutDoc.data();

    requireData(
      checkout.userId === userId &&
      checkout.attemptId === attemptId &&
      (!sessionId || sessionId === checkoutDoc.id),
    );

    const previousId = user.stripeSubscriptionId;

    const previousSnap =
      previousId && previousId !== subscriptionId
        ? await tx.get(
            db.collection('subscriptions').doc(previousId),
          )
        : null;

    const subscriptionSnap = subscriptionId
      ? await tx.get(
          db.collection('subscriptions').doc(subscriptionId),
        )
      : null;

    const [session, subscription, changedInvoice] =
      await Promise.all([
        stripe.checkout.sessions.retrieve(
          checkoutDoc.id,
          {},
          readOptions,
        ),
        subscriptionId
          ? readSubscription(stripe, subscriptionId)
          : null,
        invoiceId
          ? stripe.invoices.retrieve(invoiceId, {}, readOptions)
          : null,
      ]);

    requireData(
      session.livemode === false &&
      session.mode === 'subscription' &&
      session.client_reference_id === userId &&
      session.metadata?.integration === 'aprueba_mvp' &&
      session.metadata.userId === userId &&
      session.metadata.attemptId === attemptId &&
      (session.metadata.testId || null) === (checkout.testId || null),
    );

    requireData(
      objectId(session.subscription) === subscriptionId,
      'BILLING_RETRY_REQUIRED',
    );

    const now = new Date().toISOString();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const sessionState = {
      status: session.status,
      paymentStatus: session.payment_status,
      stripeSubscriptionId: subscriptionId,
      updatedAt: now,
    };

    let closeAttempt = session.status === 'expired';

    if (subscription) {
      const customerId = objectId(subscription.customer);

      requireData(
        subscription.livemode === false &&
        subscription.id === subscriptionId &&
        subscription.metadata?.integration === 'aprueba_mvp' &&
        subscription.metadata.userId === userId &&
        subscription.metadata.attemptId === attemptId &&
        (subscription.metadata.testId || null) === (checkout.testId || null) &&
        customerId &&
        objectId(session.customer) === customerId &&
        (
          !user.stripeCustomerId ||
          user.stripeCustomerId === customerId
        ),
      );

      const plan = planOf(subscription);
      const latestInvoice = subscription.latest_invoice;

      if (latestInvoice) {
        validateInvoice(latestInvoice, subscription, customerId);
      }

      if (changedInvoice) {
        validateInvoice(changedInvoice, subscription, customerId);
      }

      const invoicePaid =
        latestInvoice?.status === 'paid' &&
        latestInvoice.amount_remaining === 0;

      const preferredTestId =
        checkout.testId ||
        user.billingTestId ||
        (
          Array.isArray(user.selectedTests)
            ? user.selectedTests[0]
            : null
        );

      let paidBefore = previousPaidPlan(
        subscriptionSnap?.data(),
        user,
        subscriptionId,
        customerId,
      );

      let recoveredInvoice = null;

      if (
        !invoicePaid &&
        !subscription.pause_collection &&
        ['active', 'past_due'].includes(subscription.status) &&
        ownsSubscription(user, subscriptionId, customerId) &&
        (!paidBefore || paidBefore.end <= nowSeconds)
      ) {
        const recovered = await recoverPaidPlan(
          stripe,
          subscription,
          customerId,
          preferredTestId,
          nowSeconds,
        );

        if (recovered) {
          const recoveredPlan = recovered.paidPlan;
          // Una factura antigua de Una acredita el importe y el ciclo, pero
          // no siempre identifica la materia elegida en ese momento.
          if (recoveredPlan.plan !== 'uni' ||
              continuesSubject(paidBefore, recoveredPlan, recoveredPlan.testId) ||
              await eligibleSubject(db, tx, recoveredPlan.testId)) {
            paidBefore = recoveredPlan;
          } else {
            console.warn('[stripe webhook]', event.id, 'BILLING_TEST_REQUIRED');
          }
          recoveredInvoice = recovered.invoice;
        }
      }

      const previousPeriodActive = !!(
        paidBefore && paidBefore.start <= nowSeconds && paidBefore.end > nowSeconds
      );
      const keepPaidAccess = !invoicePaid && !subscription.pause_collection &&
        ['active', 'past_due'].includes(subscription.status) && previousPeriodActive;
      const providerGrantsAccess = subscription.status === 'active' &&
        !subscription.pause_collection && invoicePaid &&
        plan.start <= nowSeconds && plan.end > nowSeconds;

      // Sólo una nueva asignación de materia necesita verificar el catálogo.
      // Los eventos posteriores deben poder registrar una baja y conservar
      // un derecho anterior aunque el catálogo haya cambiado desde la compra.
      const newSubject = invoicePaid && plan.plan === 'uni' &&
        !continuesSubject(paidBefore, plan, preferredTestId);
      const deferSubject = newSubject &&
        (!providerGrantsAccess || !await eligibleSubject(db, tx, preferredTestId));
      const retainPrevious = (keepPaidAccess || deferSubject) && paidBefore;
      const accessPlan = retainPrevious || plan;
      let selectedTestId = null;
      if (accessPlan.plan === 'uni') {
        if (retainPrevious) {
          selectedTestId = paidBefore.testId;
        } else if (!deferSubject && typeof preferredTestId === 'string' &&
                   /^[a-z0-9_-]{1,64}$/i.test(preferredTestId)) {
          selectedTestId = preferredTestId;
        }
      }
      const active = keepPaidAccess ||
        (providerGrantsAccess && (!deferSubject || previousPeriodActive));

      if (deferSubject && providerGrantsAccess) {
        console.warn('[stripe webhook]', event.id, 'BILLING_TEST_REQUIRED');
      }
      // La tarifa y la factura del proveedor se guardan por separado. Mientras
      // falta una materia elegible no se modifica ni amplía el derecho pagado.
      const paidPlan = invoicePaid && !deferSubject
        ? {
            ...plan,
            testId: selectedTestId,
            invoiceId: latestInvoice.id,
          }
        : paidBefore;

      const paidEntitlement = paidPlan ? {
        plan: paidPlan.plan,
        testId: paidPlan.plan === 'uni' ? paidPlan.testId : null,
        billingCycle: paidPlan.billingCycle,
        priceId: paidPlan.priceId,
        currentPeriodStart: iso(paidPlan.start),
        currentPeriodEnd: iso(paidPlan.end),
        invoiceId: paidPlan.invoiceId,
      } : null;

      const previous = previousSnap?.data();

      const mayUpdateUser =
        !previousId ||
        previousId === subscriptionId ||
        (
          previous &&
          terminal.has(previous.status) &&
          !terminal.has(subscription.status)
        );

      requireData(
        !active || mayUpdateUser,
        'BILLING_SUBSCRIPTION_CONFLICT',
      );

      const paymentPending = !!(
        latestInvoice &&
        !invoicePaid &&
        ['active', 'past_due'].includes(subscription.status)
      );

const paymentMethod =
  subscription.default_payment_method ||
  subscription.default_source ||
  subscription.customer?.invoice_settings?.default_payment_method ||
  subscription.customer?.default_source ||
  null;

const card =
  paymentMethod?.card ||
  (paymentMethod?.object === 'card' ? paymentMethod : null);

      tx.set(
        db.collection('subscriptions').doc(subscriptionId),
        {
          id: subscriptionId,
          provider: 'stripe',
          livemode: false,
          userId,
          stripeCustomerId: customerId,
          checkoutSessionId: session.id,
          plan: accessPlan.plan,
          testId: selectedTestId,
          billingCycle: accessPlan.billingCycle,
          priceId: accessPlan.priceId,
          status: subscription.status,
          accessActive: active,
          paymentPending,
          currentPeriodStart: iso(accessPlan.start),
          currentPeriodEnd: iso(accessPlan.end),
          paidEntitlement,
          stripePlan: {
            plan: plan.plan,
            billingCycle: plan.billingCycle,
            priceId: plan.priceId,
            currentPeriodStart: iso(plan.start),
            currentPeriodEnd: iso(plan.end),
          },
          cancelAtPeriodEnd:
            !!subscription.cancel_at_period_end ||
            Number.isFinite(subscription.cancel_at),
          createdAt: iso(subscription.created),
          updatedAt: now,
          latestInvoiceId: objectId(latestInvoice),
          paymentMethod: card
            ? { brand: card.brand, last4: card.last4 }
            : null,
        },
        { merge: true },
      );

      if (mayUpdateUser) {
        tx.update(userRef, {
          billingProvider: 'stripe',
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          billingStatus: subscription.status,
          billingAccessActive: active,
          billingPeriodEnd: iso(accessPlan.end),
          billingUpdatedAt: now,
          plan: active ? accessPlan.plan : 'free',
          billingTestId: selectedTestId,
        });
      }

      const invoices = new Map();

      if (recoveredInvoice) {
        invoices.set(recoveredInvoice.id, recoveredInvoice);
      }

      if (changedInvoice) {
        invoices.set(changedInvoice.id, changedInvoice);
      }

      if (latestInvoice) {
        invoices.set(latestInvoice.id, latestInvoice);
      }

      for (const invoice of invoices.values()) {
        tx.set(
          db.collection('invoices').doc(invoice.id),
          invoiceRecord(
            invoice,
            userId,
            subscriptionId,
            customerId,
            now,
          ),
          { merge: true },
        );
      }

      closeAttempt ||= active || terminal.has(subscription.status);

      sessionState.fulfillmentStatus = active
        ? 'active'
        : terminal.has(subscription.status)
          ? 'ended'
          : 'pending';
    } else {
      sessionState.fulfillmentStatus =
        session.status === 'expired' ? 'expired' : 'pending';
    }

    tx.set(checkoutDoc.ref, sessionState, { merge: true });

    if (
      pointerSnap.data()?.attemptId === attemptId &&
      closeAttempt
    ) {
      tx.set(pointerRef, { closed: true }, { merge: true });
    }

    tx.set(eventRef, {
      type: event.type,
      userId,
      stripeSubscriptionId: subscriptionId,
      checkoutSessionId: session.id,
      processingVersion: PROCESSING_VERSION,
      processedAt: now,
    });

    return { received: true, processed: true };
  }, { maxAttempts: 3 });
}