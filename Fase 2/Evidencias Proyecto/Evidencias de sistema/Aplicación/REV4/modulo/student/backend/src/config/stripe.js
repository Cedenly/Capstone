import Stripe from 'stripe';

let client = null;
let clientKey = null;

const priceVariables = {
  'uni:monthly': 'STRIPE_PRICE_UNI_MONTHLY',
  'uni:yearly': 'STRIPE_PRICE_UNI_YEARLY',
  'all:monthly': 'STRIPE_PRICE_ALL_MONTHLY',
  'all:yearly': 'STRIPE_PRICE_ALL_YEARLY',
};

function readEnv(name) {
  return (process.env[name] || '').trim();
}

function configError(message) {
  return Object.assign(new Error(message), {
    status: 503,
    code: 'PAYMENTS_NOT_CONFIGURED',
  });
}

export function getStripe() {
  const key = readEnv('STRIPE_SECRET_KEY');

  if (!key) {
    throw configError('Los pagos estan pendientes de configuracion.');
  }

  if (!/^(sk_test_|rk_test_|rkcs_test_)/.test(key)) {
    throw configError('Este MVP solo admite claves de prueba de Stripe.');
  }

  if (!client || clientKey !== key) {
    client = new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 20000,
    });
    clientKey = key;
  }

  return client;
}

export function getStripePriceId(plan, billingCycle) {
  const variable = priceVariables[`${plan}:${billingCycle}`];

  if (!variable) {
    throw Object.assign(new Error('El plan o ciclo indicado no existe.'), {
      status: 400,
      code: 'INVALID_PLAN',
    });
  }

  const priceId = readEnv(variable);

  if (!priceId.startsWith('price_')) {
    throw configError(
      'El precio de este plan esta pendiente de configuracion.'
    );
  }

  return priceId;
}

export function getStripeWebhookSecret() {
  const secret = readEnv('STRIPE_WEBHOOK_SECRET');

  if (!secret.startsWith('whsec_')) {
    throw configError(
      'La confirmacion de pagos esta pendiente de configuracion.'
    );
  }

  return secret;
}

export function getStudentWebUrl() {
  let url;

  try {
    url = new URL(readEnv('STUDENT_WEB_URL'));
  } catch {
    throw configError('Falta una STUDENT_WEB_URL valida.');
  }

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const validProtocol =
    url.protocol === 'https:' || (local && url.protocol === 'http:');

  if (
    !validProtocol ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw configError(
      'STUDENT_WEB_URL debe ser el origen de la web; usa HTTPS salvo en localhost.'
    );
  }

  return url.origin;
}