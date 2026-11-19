import test from 'node:test';
import assert from 'node:assert/strict';
import { requireTestSeedEnvironment } from '../src/lib/testSeedGuard.js';
import { billingFixture } from '../src/seed/billingFixture.js';

const local = { ALLOW_TEST_SEED: 'true', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-aprueba-admin' };

test('las semillas requieren consentimiento, emulador loopback y proyecto demo', () => {
  for (const change of [
    { ALLOW_TEST_SEED: undefined }, { ALLOW_TEST_SEED: 'false' }, { ALLOW_TEST_SEED: 'TRUE' },
    { FIRESTORE_EMULATOR_HOST: undefined }, { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
    { FIRESTORE_EMULATOR_HOST: '192.168.1.5:8080' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:65536' },
    { FIRESTORE_EMULATOR_HOST: 'http://127.0.0.1:8080' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.999:8080' },
    { GCLOUD_PROJECT: 'aprueba-produccion' }, { GCLOUD_PROJECT: undefined },
  ]) assert.throws(() => requireTestSeedEnvironment({ ...local, ...change }), /Semilla bloqueada/);
  for (const host of ['127.0.0.1:8080', '127.0.0.2:9090', 'localhost:8080', '[::1]:8080']) {
    assert.equal(requireTestSeedEnvironment({ ...local, FIRESTORE_EMULATOR_HOST: host }).host, host);
  }
});

test('factura, suscripción y usuario comparten identidad, vigencia y acceso confirmado', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const [[, userId, user], [, subscriptionId, subscription], [, , invoice]] = billingFixture(now);
  assert.equal(userId, subscription.userId);
  assert.equal(userId, invoice.userId);
  assert.equal(user.stripeSubscriptionId, subscriptionId);
  assert.equal(invoice.stripeSubscriptionId, subscriptionId);
  assert.equal(user.stripeCustomerId, subscription.stripeCustomerId);
  assert.equal(user.stripeCustomerId, invoice.stripeCustomerId);
  assert.equal(user.plan, subscription.plan);
  assert.equal(user.billingStatus, subscription.status);
  assert.equal(user.billingPeriodEnd, subscription.currentPeriodEnd);
  assert.equal(user.state, 'active');
  assert.equal(user.billingProvider, 'stripe');
  assert.equal(user.billingAccessActive, true);
  assert.equal(subscription.accessActive, true);
  assert.ok(Date.parse(user.billingPeriodEnd) > now.getTime());
  assert.equal(subscription.livemode, false);
  assert.equal(invoice.livemode, false);
  assert.equal(invoice.amount * 100, 500);
  assert.equal(invoice.currency, 'USD');
  assert.equal(invoice.pdfUrl, undefined);
  for (const data of [user, subscription, invoice]) assert.equal(data.fixture, true);
});
