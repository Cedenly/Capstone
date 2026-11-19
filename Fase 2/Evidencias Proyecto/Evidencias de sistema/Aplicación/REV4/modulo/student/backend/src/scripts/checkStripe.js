import 'dotenv/config';
import Stripe from 'stripe';

const expected = [
  ['STRIPE_PRICE_UNI_MONTHLY', 'prod_aprueba_uni', 100, 'month'],
  ['STRIPE_PRICE_UNI_YEARLY', 'prod_aprueba_uni', 1000, 'year'],
  ['STRIPE_PRICE_ALL_MONTHLY', 'prod_aprueba_all', 500, 'month'],
  ['STRIPE_PRICE_ALL_YEARLY', 'prod_aprueba_all', 5000, 'year'],
];

async function main() {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();

  if (!key) {
    throw new Error('Falta STRIPE_SECRET_KEY en backend/.env.');
  }

  if (!/^(sk_test_|rk_test_|rkcs_test_)/.test(key)) {
    throw new Error('Debes usar una clave de prueba de Stripe.');
  }

  const stripe = new Stripe(key, {
    maxNetworkRetries: 1,
    timeout: 20000,
  });

  const rows = await Promise.all(
    expected.map(async ([variable, product, amount, interval]) => {
      const id = (process.env[variable] || '').trim();

      if (!id.startsWith('price_')) {
        throw new Error(
          `Falta un identificador de precio valido en ${variable}.`
        );
      }

      const price = await stripe.prices.retrieve(id);

      const valid =
        price.livemode === false &&
        price.active === true &&
        price.product === product &&
        price.currency === 'usd' &&
        price.unit_amount === amount &&
        price.type === 'recurring' &&
        price.billing_scheme === 'per_unit' &&
        price.recurring?.interval === interval &&
        price.recurring?.interval_count === 1 &&
        price.recurring?.usage_type === 'licensed';

      if (!valid) {
        throw new Error(
          `El precio de ${variable} no coincide con la configuracion esperada.`
        );
      }

      return {
        Variable: variable,
        USD: price.unit_amount / 100,
        Periodo: interval === 'month' ? 'Mensual' : 'Anual',
        Modo: 'Pruebas',
      };
    })
  );

  console.table(rows);
  console.log('Conexion con Stripe: OK');
  console.log('Precios verificados: 4/4');
}

main().catch((error) => {
  console.error('La comprobacion no se completo.');
  console.error(error.code || error.type || error.message);
  process.exitCode = 1;
});