import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { created, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { initFirestore } from '../config/firebase.js';
import { hasPracticeQuestions, isOfferedTest } from '../lib/questionAvailability.js';
import {
  acquireAttemptOperation,
  assertAttemptReady,
  closeExpiredAttempt,
  releaseAttemptOperation,
  resolveAttemptSession,
} from '../services/checkoutRecovery.js';
import {
  getStripe,
  getStripePriceId,
  getStripeWebhookSecret,
  getStudentWebUrl,
} from '../config/stripe.js';

const r = Router();

const blockedStatuses = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
];

const stop = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

r.post('/checkout/sessions', authRequired, wrap(async (req, res) => {
const { plan, billingCycle, testId } = req.body || {};
const selectedTestId =
  plan === 'uni' && typeof testId === 'string'
    ? testId.trim()
    : null;

if (plan === 'uni' && !/^[a-z0-9_-]{1,64}$/i.test(selectedTestId || '')) {
  return fail(
    res, 400, 'TEST_REQUIRED',
    'Elige la prueba incluida en este plan.'
  );
}

if (plan !== 'uni' && testId != null) {
  return fail(
    res, 400, 'TEST_NOT_APPLICABLE',
    'Este plan no necesita elegir una prueba.'
  );
}

const priceId = getStripePriceId(plan, billingCycle);
  getStripeWebhookSecret();

  const webUrl = getStudentWebUrl();
  const stripe = getStripe();

  if (process.env.DATA_DRIVER !== 'firestore') {
    throw stop(
      503,
      'FIRESTORE_REQUIRED',
      'Los pagos requieren Firestore.'
    );
  }

  const { db } = await initFirestore();
  const userId = req.user.id;
  const planRef = db.collection('plans').doc(plan);
  const testRef = selectedTestId
    ? db.collection('tests').doc(selectedTestId)
    : null;

  let planSnap;
  let price;
  let testSnap;
  let hasQuestions;

  try {
    [planSnap, price, testSnap, hasQuestions] = await Promise.all([
      planRef.get(),
      stripe.prices.retrieve(priceId),
      testRef ? testRef.get() : Promise.resolve(null),
      selectedTestId
        ? hasPracticeQuestions(selectedTestId)
        : Promise.resolve(null),
    ]);
  } catch (error) {
    console.error(
      '[checkout catalogo]',
      error.code || error.type || 'ERROR'
    );

    return fail(
      res,
      503,
      'CATALOG_UNAVAILABLE',
      'No se pudo verificar el catalogo. Reintenta mas tarde.'
    );
  }

  const planDoc = planSnap.data();
  const monthly = Number(planDoc?.price);
  const amountCents = Math.round(
    monthly * (billingCycle === 'yearly' ? 10 : 1) * 100
  );
  const interval = billingCycle === 'yearly' ? 'year' : 'month';

  if (!planSnap.exists || planDoc.active === false) {
    return fail(
      res,
      400,
      'INVALID_PLAN',
      'El plan no esta disponible.'
    );
  }
  if (testRef && !isOfferedTest(testSnap?.data())) {
    return fail(
      res,
      400,
      'INVALID_TEST',
      'La prueba elegida no está disponible.'
    );
  }

  if (selectedTestId && hasQuestions !== true) {
    return fail(
      res,
      422,
      'TEST_NO_QUESTIONS',
      'La prueba elegida todavía no tiene preguntas disponibles.'
    );
  }

  if (
    !Number.isFinite(monthly) ||
    monthly <= 0 ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    !price.active ||
    price.livemode !== false ||
    price.currency !== 'usd' ||
    price.product !== `prod_aprueba_${plan}` ||
    price.unit_amount !== amountCents ||
    price.type !== 'recurring' ||
    price.billing_scheme !== 'per_unit' ||
    price.recurring?.interval !== interval ||
    price.recurring?.interval_count !== 1 ||
    price.recurring?.usage_type !== 'licensed'
  ) {
    return fail(
      res,
      503,
      'PRICE_MISMATCH',
      'El precio de Stripe no coincide con el catalogo.'
    );
  }

  const pointerRef = db.collection('checkoutAttempts').doc(userId);
  const userRef = db.collection('users').doc(userId);

  const subsQuery = db.collection('subscriptions')
    .where('userId', '==', userId);

  // Reserva un intento compartido entre solicitudes simultaneas.
  const attempt = await db.runTransaction(async (tx) => {
    const [userSnap, pointerSnap, subsSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(pointerRef),
      tx.get(subsQuery),
    ]);

    const user = userSnap.data();

    if (!userSnap.exists || user.state === 'suspended') {
      throw stop(
        403,
        'ACCOUNT_UNAVAILABLE',
        'La cuenta no esta disponible.'
      );
    }

    if (
      subsSnap.docs.some((doc) =>
        blockedStatuses.includes(doc.data().status)
      )
    ) {
      throw stop(
        409,
        'ALREADY_SUBSCRIBED',
        'Ya tienes una suscripcion. Gestiona el plan actual.'
      );
    }

    const current = pointerSnap.data();

    if (current && !current.closed) {
      if (current.cancelRequested) {
        throw stop(409, 'CHECKOUT_CANCELLING', 'El descarte está pendiente. Vuelve a descartarlo para completar el cierre.');
      }
      if (
        current.plan !== plan ||
        current.billingCycle !== billingCycle ||
        current.priceId !== priceId ||
        current.testId !== selectedTestId
      ) {
        throw stop(
          409,
          'CHECKOUT_IN_PROGRESS',
          'Tienes un pago pendiente para otro plan. Cancela esa sesion primero.'
        );
      }

      return current;
    }

    const attemptId = randomUUID();

    const metadata = {
      integration: 'aprueba_mvp',
      userId,
      plan,
      billingCycle,
      attemptId,
      ...(selectedTestId ? { testId: selectedTestId } : {}),
    };

    const next = {
      attemptId,
      userId,
      plan,
      billingCycle,
      priceId,
      testId: selectedTestId,
      amountCents,
      createdAt: new Date().toISOString(),
      closed: false,

      params: {
        mode: 'subscription',
        currency: 'usd',
        adaptive_pricing: { enabled: false },
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: userId,

        ...(user.stripeCustomerId
          ? { customer: user.stripeCustomerId }
          : { customer_email: user.email }),

        metadata,
        subscription_data: { metadata },

        success_url:
          `${webUrl}/plan?checkout=success&session_id={CHECKOUT_SESSION_ID}`,

        cancel_url: `${webUrl}/plan?checkout=cancelled`,
        locale: 'es',
        // Immutable across retries. Even a delayed worker cannot create a
        // fresh collectible session after this attempt's absolute expiry.
        expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
      },
    };

    tx.set(pointerRef, next);

    return next;
  });

  const claimed = await acquireAttemptOperation({
    db, userId, attemptId: attempt.attemptId, kind: 'resume',
  });
  const context = { db, stripe, userId, ...claimed };
  try {
    const session = await resolveAttemptSession(context);
    if (!session || session.status === 'expired') {
      if (session) await closeExpiredAttempt(context, session);
      return fail(res, 410, 'CHECKOUT_EXPIRED', 'El intento terminó. Vuelve a elegir el plan.');
    }
    if (session.status !== 'open' || !session.url) {
      return fail(res, 409, 'PAYMENT_PROCESSING', 'El pago ya fue enviado. Espera su confirmación.');
    }
    await assertAttemptReady(context, session);
    return created(res, {
      checkoutSessionId: session.id,
      url: session.url,
      amount: claimed.attempt.amountCents / 100,
      currency: 'USD',
      plan: claimed.attempt.plan,
      testId: claimed.attempt.testId,
      billingCycle: claimed.attempt.billingCycle,
    });
  } catch (error) {
    if (error.status && error.code) throw error;
    console.error('[stripe checkout]', error.code || error.type || 'ERROR');
    return fail(res, 503, 'CHECKOUT_UNAVAILABLE', 'No se pudo abrir el pago. Actualiza su estado y reintenta.');
  } finally {
    await releaseAttemptOperation({ db, userId, attemptId: attempt.attemptId, operation: claimed.operation });
  }
}));


// El estudiante ya no puede activar planes desde la confirmacion demo.
r.post(
  '/checkout/sessions/:id/confirm',
  authRequired,
  (_req, res) => {
    return fail(
      res,
      410,
      'DEMO_CONFIRM_DISABLED',
      'La confirmacion simulada fue deshabilitada.'
    );
  }
);

export default r;
