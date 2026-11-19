import { fail } from '../lib/envelope.js';
import {
  getStripe,
  getStripeWebhookSecret,
} from '../config/stripe.js';

export function verifyStripeWebhook(req, res, next) {
  const signature = req.get('stripe-signature');

  if (!signature) {
    return fail(
      res,
      400,
      'WEBHOOK_SIGNATURE_MISSING',
      'Falta la firma de Stripe.',
    );
  }

  if (!Buffer.isBuffer(req.body)) {
    return fail(
      res,
      400,
      'WEBHOOK_BODY_INVALID',
      'Se requiere el cuerpo original del mensaje.',
    );
  }

  let stripe;
  let secret;

  try {
    stripe = getStripe();
    secret = getStripeWebhookSecret();
  } catch {
    return fail(
      res,
      503,
      'WEBHOOK_NOT_CONFIGURED',
      'Falta completar la configuracion del webhook.',
    );
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      secret,
    );
  } catch {
    return fail(
      res,
      400,
      'WEBHOOK_SIGNATURE_INVALID',
      'La firma de Stripe no es valida.',
    );
  }

  if (
    event?.object !== 'event' ||
    typeof event.id !== 'string' ||
    !event.id.startsWith('evt_') ||
    typeof event.type !== 'string' ||
    !event.type ||
    !Number.isFinite(event.created) ||
    !event.data ||
    typeof event.data.object !== 'object' ||
    event.data.object === null
  ) {
    return fail(
      res,
      400,
      'WEBHOOK_EVENT_INVALID',
      'El evento no tiene el formato esperado.',
    );
  }

  if (event.livemode !== false) {
    return fail(
      res,
      400,
      'WEBHOOK_TEST_MODE_REQUIRED',
      'Este MVP solo acepta eventos de prueba.',
    );
  }

  req.stripeEvent = event;
  return next();
}