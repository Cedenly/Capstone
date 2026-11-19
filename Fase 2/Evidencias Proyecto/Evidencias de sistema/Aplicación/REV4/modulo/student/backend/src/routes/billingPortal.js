import { Router } from 'express';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { initFirestore } from '../config/firebase.js';
import { getStripe, getStudentWebUrl } from '../config/stripe.js';

const r = Router();

const objectId = value =>
  typeof value === 'string' ? value : value?.id;

r.post('/billing/portal', authRequired, wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');

  // La cuenta y la direccion de regreso se deciden en el servidor.
  if (Object.keys(req.body || {}).length > 0) {
    return fail(
      res,
      400,
      'PORTAL_BODY_NOT_ALLOWED',
      'Esta operacion no necesita datos adicionales.'
    );
  }

  const configuration = (
    process.env.STRIPE_PORTAL_CONFIGURATION_ID || ''
  ).trim();

  if (!/^bpc_[A-Za-z0-9]+$/.test(configuration)) {
    return fail(
      res,
      503,
      'PORTAL_NOT_CONFIGURED',
      'Falta configurar el portal de suscripciones.'
    );
  }

  try {
    const { db } = await initFirestore();

    const user = (
      await db.collection('users').doc(req.user.id).get()
    ).data();

    if (!user || user.state === 'suspended') {
      return fail(
        res,
        403,
        'PORTAL_ACCESS_DENIED',
        'La cuenta no puede acceder al portal.'
      );
    }

    const customerId = user.stripeCustomerId;
    const subscriptionId = user.stripeSubscriptionId;

    if (
      user.billingProvider !== 'stripe' ||
      !/^cus_[A-Za-z0-9]+$/.test(customerId || '') ||
      !/^sub_[A-Za-z0-9]+$/.test(subscriptionId || '')
    ) {
      return fail(
        res,
        409,
        'PORTAL_NOT_AVAILABLE',
        'Todavia no hay una suscripcion de Stripe vinculada a tu cuenta.'
      );
    }

    const saved = (
      await db.collection('subscriptions').doc(subscriptionId).get()
    ).data();

    if (
      !saved ||
      saved.provider !== 'stripe' ||
      saved.userId !== req.user.id ||
      saved.stripeCustomerId !== customerId
    ) {
      return fail(
        res,
        409,
        'PORTAL_ACCOUNT_MISMATCH',
        'No se pudo verificar la suscripcion de esta cuenta.'
      );
    }

    const stripe = getStripe();

    const [customer, subscription, settings] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.subscriptions.retrieve(subscriptionId),
      stripe.billingPortal.configurations.retrieve(configuration),
    ]);

    if (
      customer.deleted ||
      customer.livemode !== false ||
      subscription.livemode !== false ||
      objectId(subscription.customer) !== customerId ||
      subscription.metadata?.integration !== 'aprueba_mvp' ||
      subscription.metadata?.userId !== req.user.id
    ) {
      return fail(
        res,
        409,
        'PORTAL_ACCOUNT_MISMATCH',
        'Stripe no pudo confirmar la vinculacion de esta cuenta.'
      );
    }

    if (
      !settings.active ||
      settings.livemode !== false ||
      settings.metadata?.integration !== 'aprueba_mvp' ||
      settings.metadata?.purpose !== 'student_subscription_portal'
    ) {
      return fail(
        res,
        503,
        'PORTAL_NOT_CONFIGURED',
        'La configuracion del portal no es valida para este MVP.'
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration,
      return_url: `${getStudentWebUrl()}/plan?portal=return`,
      locale: 'es',
    });

    const target = new URL(session.url);

    if (
      session.livemode !== false ||
      session.customer !== customerId ||
      target.protocol !== 'https:' ||
      target.hostname !== 'billing.stripe.com' ||
      target.username ||
      target.password
    ) {
      return fail(
        res,
        503,
        'PORTAL_INVALID_RESPONSE',
        'No se recibio un acceso valido al portal.'
      );
    }

    return ok(res, { url: target.href });
  } catch (error) {
    console.error('[stripe portal]', error.code || error.type || 'ERROR');

    return fail(
      res,
      503,
      'PORTAL_UNAVAILABLE',
      'No se pudo abrir el portal. Vuelve a intentarlo en unos instantes.'
    );
  }
}));

export default r;