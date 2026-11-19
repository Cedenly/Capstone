import 'dotenv/config';
import { createHash } from 'node:crypto';
import {
  getStripe,
  getStripePriceId,
  getStudentWebUrl,
} from '../config/stripe.js';

const catalog = [
  { plan: 'uni', cycle: 'monthly', amount: 100, interval: 'month' },
  { plan: 'uni', cycle: 'yearly', amount: 1000, interval: 'year' },
  { plan: 'all', cycle: 'monthly', amount: 500, interval: 'month' },
  { plan: 'all', cycle: 'yearly', amount: 5000, interval: 'year' },
];

const metadata = {
  integration: 'aprueba_mvp',
  purpose: 'student_subscription_portal',
};

async function main() {
  const stripe = getStripe();
  const returnUrl = `${getStudentWebUrl()}/plan?portal=return`;

  const verified = await Promise.all(catalog.map(async entry => {
    const id = getStripePriceId(entry.plan, entry.cycle);
    const price = await stripe.prices.retrieve(id, {
      expand: ['product'],
    });
    const product = price.product;

    const valid =
      price.livemode === false &&
      price.active === true &&
      price.currency === 'usd' &&
      price.unit_amount === entry.amount &&
      price.type === 'recurring' &&
      price.billing_scheme === 'per_unit' &&
      price.recurring?.interval === entry.interval &&
      price.recurring?.interval_count === 1 &&
      price.recurring?.usage_type === 'licensed' &&
      product?.id === `prod_aprueba_${entry.plan}` &&
      product.active === true &&
      product.livemode === false;

    if (!valid) {
      throw new Error(
        `Revisa el precio de ${entry.plan}/${entry.cycle}.`
      );
    }

    return { ...entry, id, productId: product.id };
  }));

  const params = {
    name: 'Aprueba MVP - Portal del estudiante',
    business_profile: {
      headline: 'Gestiona tu suscripcion a Aprueba',
    },
    default_return_url: returnUrl,
    login_page: { enabled: false },
    metadata,
    features: {
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none',
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        billing_cycle_anchor: 'unchanged',
        proration_behavior: 'always_invoice',
        products: ['uni', 'all'].map(plan => ({
          product: `prod_aprueba_${plan}`,
          prices: verified
            .filter(price => price.plan === plan)
            .map(price => price.id),
        })),
      },
    },
  };

  let existing = null;
  const configuredId = (
    process.env.STRIPE_PORTAL_CONFIGURATION_ID || ''
  ).trim();

  if (configuredId) {
    if (!/^bpc_[A-Za-z0-9]+$/.test(configuredId)) {
      throw new Error(
        'STRIPE_PORTAL_CONFIGURATION_ID debe comenzar con bpc_.'
      );
    }

    existing = await stripe.billingPortal.configurations.retrieve(
      configuredId
    );
  } else {
    for await (
      const config of stripe.billingPortal.configurations.list({
        limit: 100,
      })
    ) {
      if (
        config.metadata?.integration === metadata.integration &&
        config.metadata?.purpose === metadata.purpose
      ) {
        existing = config;
        break;
      }
    }
  }

  if (
    existing &&
    (
      existing.livemode !== false ||
      existing.metadata?.integration !== metadata.integration ||
      existing.metadata?.purpose !== metadata.purpose
    )
  ) {
    throw new Error(
      'La configuracion indicada no pertenece al portal de pruebas de Aprueba.'
    );
  }

  // Reutiliza nuestra configuracion si el script se ejecuta otra vez.
  const digest = createHash('sha256')
    .update(JSON.stringify(params))
    .digest('hex');

  const config = existing
    ? await stripe.billingPortal.configurations.update(existing.id, {
        ...params,
        active: true,
      })
    : await stripe.billingPortal.configurations.create(params, {
        idempotencyKey: `aprueba-portal-${digest}`,
      });

  if (config.livemode !== false || !config.active) {
    throw new Error(
      'No se obtuvo una configuracion activa en modo de pruebas.'
    );
  }

  console.log('Portal de pruebas preparado: OK');
  console.log('Precios verificados: 4/4');
  console.log('Cancelacion: al terminar el periodo pagado.');
  console.log('Cambios de plan: con ajuste proporcional inmediato.');
  console.log('Copia esta linea en backend/.env:');
  console.log(`STRIPE_PORTAL_CONFIGURATION_ID=${config.id}`);
}

main().catch(error => {
  console.error('No se pudo preparar el portal.');

  const message = String(error.message || 'Error sin detalle.');
  console.error(
    message.replace(
      /(?:sk_test_|rk_test_|rkcs_test_|whsec_)[A-Za-z0-9_*]+/g,
      '[oculto]'
    )
  );

  process.exitCode = 1;
});