// Datos sintéticos del emulador. No representan una compra ni un evento de Stripe.
export function billingFixture(now = new Date()) {
  const createdAt = now.toISOString();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const userId = 'usr_billing_local';
  const subscriptionId = 'sub_billing_local';
  const customerId = 'cus_billing_local';
  const fixture = { fixture: true, fixtureSource: 'admin-local-emulator' };
  return [
    ['users', userId, {
      ...fixture, name: 'Estudiante de ejemplo local', email: 'estudiante.local@example.test',
      country: 'CL', state: 'active', plan: 'all', planSource: 'subscription',
      billingProvider: 'stripe', stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId,
      billingStatus: 'active', billingAccessActive: true, billingPeriodEnd: periodEnd,
      billingCycle: 'monthly', badges: 0, groups: 0,
    }],
    ['subscriptions', subscriptionId, {
      ...fixture, userId, provider: 'stripe', livemode: false, stripeCustomerId: customerId,
      plan: 'all', billingCycle: 'monthly', status: 'active', accessActive: true,
      paymentPending: false, cancelAtPeriodEnd: false,
      currentPeriodStart: createdAt, currentPeriodEnd: periodEnd, updatedAt: createdAt,
    }],
    ['invoices', 'in_billing_local', {
      ...fixture, userId, provider: 'stripe', livemode: false, stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId, status: 'paid', amount: 5, currency: 'USD',
      createdAt, paidAt: createdAt, updatedAt: createdAt,
      // Sin PDF ni URL inventada: la interfaz mostrará que no están disponibles.
    }],
  ];
}

export async function createFixtureDocuments(db, entries) {
  // create (no set) hace fallar el lote entero si cualquier ID ya existe.
  const batch = db.batch();
  for (const [collection, id, data] of entries) {
    batch.create(db.collection(collection).doc(id), data);
  }
  await batch.commit();
}
