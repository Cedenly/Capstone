import { ok, fail } from '../lib/envelope.js';
import { processStripeEvent } from '../services/stripeBilling.js';

export async function stripeWebhookHandler(req, res) {
  if (!req.stripeEvent) {
    return fail(
      res,
      400,
      'WEBHOOK_NOT_VERIFIED',
      'El evento no fue verificado.',
    );
  }

  try {
    const result = await processStripeEvent(req.stripeEvent);
    return ok(res, result);
  } catch (error) {
    console.error(
      '[stripe webhook]',
      req.stripeEvent.id,
      error.code || error.type || 'ERROR',
    );

    return fail(
      res,
      503,
      'WEBHOOK_PROCESSING_FAILED',
      'No se pudo completar la confirmacion.',
    );
  }
}