import 'dotenv/config';
import {
  getStripe,
  getStripeWebhookSecret,
} from '../config/stripe.js';

async function main() {
  const stripe = getStripe();
  const secret = getStripeWebhookSecret();
  const url = 'http://localhost:4100/api/v1/webhooks/stripe';

  const payload = JSON.stringify({
    id: 'evt_aprueba_local_check',
    object: 'event',
    type: 'aprueba.webhook.check',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: { id: 'local_check' },
    },
  });

  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });

  const cases = [
    {
      name: 'Sin firma',
      body: payload,
      signature: null,
      status: 400,
      code: 'WEBHOOK_SIGNATURE_MISSING',
    },
    {
      name: 'Contenido alterado',
      body: payload + ' ',
      signature,
      status: 400,
      code: 'WEBHOOK_SIGNATURE_INVALID',
    },
    {
      name: 'Firma valida',
      body: payload,
      signature,
      status: 200,
      code: undefined,
    },
  ];

  const results = [];

  for (const test of cases) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(test.signature
          ? { 'Stripe-Signature': test.signature }
          : {}),
      },
      body: test.body,
    });

    const json = await response.json();

    const matches =
      response.status === test.status &&
      json.error?.code === test.code;

    results.push({
      Prueba: test.name,
      HTTP: response.status,
      Codigo: json.error?.code || '(sin codigo)',
      Resultado: matches ? 'OK' : 'REVISAR',
    });
  }

  console.table(results);

  if (results.some(result => result.Resultado !== 'OK')) {
    throw new Error(
      'Hay resultados distintos de los esperados para este paso.',
    );
  }

  console.log('Verificacion de firmas: 3/3 OK');
  console.log('Receptor verificado. Falta probar una compra completa.');
}

main().catch(error => {
  console.error(
    'No se completo la comprobacion:',
    error.message,
  );
  process.exitCode = 1;
});