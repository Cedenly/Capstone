// Prueba HTTP contra Firestore emulado. No ejecutar contra un proyecto real.
// ALLOW_TEST_SEED=true FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
// GCLOUD_PROJECT=demo-apr77-admin JWT_SECRET=<clave temporal>
// node --test test/sessionRevocation.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { requireTestSeedEnvironment } from '../src/lib/testSeedGuard.js';

requireTestSeedEnvironment();

const { default: express } = await import('express');
const { db, COL } = await import('../src/data/repo.js');
const { signAccess } = await import('../src/lib/jwt.js');
const { authRequired } = await import('../src/middleware/auth.js');
const { errorHandler } = await import('../src/middleware/error.js');
const { default: usersRoutes } = await import('../src/routes/users.js');

const runId = randomUUID().replaceAll('-', '');
const ids = [];
const admins = [];
let server, base, supportToken, financeToken;

async function fixture(extra = {}) {
  const id = `usr_revocation_${runId}_${ids.length}`;
  ids.push(id);
  const value = {
    id, name: 'APR-77 synthetic account', email: `${id}@example.invalid`,
    state: 'active', plan: 'all', billingProvider: 'stripe',
    stripeCustomerId: `cus_local_${id}`, stripeSubscriptionId: `sub_local_${id}`,
    billingAccessActive: true, billingPeriodEnd: '2099-01-01T00:00:00.000Z',
    passwordHash: 'synthetic-not-a-password', ...extra,
  };
  await db.collection(COL.users).doc(id).create(value);
  return value;
}
async function read(id) {
  return (await db.collection(COL.users).doc(id).get()).data();
}
async function change(id, state, options = {}) {
  const response = await fetch(`${base}/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token || supportToken}` },
    body: JSON.stringify(options.body || { state, reason: options.reason || 'APR-77 comprobacion local' }),
  });
  return { status: response.status, body: await response.json() };
}
function financialFields(user) {
  return Object.fromEntries(Object.entries(user).filter(([key]) =>
    ['plan', 'billingProvider', 'stripeCustomerId', 'stripeSubscriptionId',
      'billingAccessActive', 'billingPeriodEnd', 'email', 'passwordHash'].includes(key)));
}

before(async () => {
  for (const role of ['support', 'finance']) {
    const user = { id: `adm_revocation_${runId}_${role}`, name: 'APR-77 synthetic admin', role, state: 'active' };
    admins.push(user.id);
    await db.collection(COL.adminUsers).doc(user.id).create(user);
    if (role === 'support') supportToken = signAccess(user);
    else financeToken = signAccess(user);
  }
  const app = express();
  app.use(express.json());
  app.use(authRequired, usersRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) { server.close(); await once(server, 'close'); }
  const batch = db.batch();
  for (const id of ids) batch.delete(db.collection(COL.users).doc(id));
  for (const id of admins) batch.delete(db.collection(COL.adminUsers).doc(id));
  await batch.commit();
  await db.terminate();
});

test('suspender y reactivar avanzan la version aunque el alumno no consulte entre cambios', async () => {
  const initial = await fixture();
  const suspended = await change(initial.id, 'suspended');
  assert.equal(suspended.status, 200);
  const first = await read(initial.id);
  assert.equal(first.authSessionVersion, 1);
  assert.equal(first.state, 'suspended');
  assert.equal(first.auditedBy, admins[0]);
  assert.equal(first.lastActionReason, 'APR-77 comprobacion local');
  assert.ok(Number.isFinite(Date.parse(first.auditedAt)));
  assert.deepEqual(financialFields(first), financialFields(initial));
  assert.equal(suspended.body.data.authSessionVersion, undefined);
  assert.equal(suspended.body.data.passwordHash, undefined);
  const active = await change(initial.id, 'active');
  assert.equal(active.status, 200);
  const final = await read(initial.id);
  assert.equal(final.authSessionVersion, 2);
  assert.equal(final.state, 'active');
  assert.deepEqual(financialFields(final), financialFields(initial));
});

test('repetir el estado vigente conserva la version, auditoria y todos los campos', async () => {
  const initial = await fixture({ authSessionVersion: 8, auditedAt: '2026-01-01T00:00:00.000Z', auditedBy: 'adm_original' });
  assert.equal((await change(initial.id, 'active', { reason: 'No deberia reemplazar auditoria' })).status, 200);
  assert.deepEqual(await read(initial.id), initial);
});

test('ocho suspensiones concurrentes producen un solo incremento y preservan Stripe', async () => {
  const initial = await fixture({ authSessionVersion: 20 });
  const responses = await Promise.all(Array.from({ length: 8 }, () => change(initial.id, 'suspended')));
  assert.deepEqual(responses.map(item => item.status), Array(8).fill(200));
  const final = await read(initial.id);
  assert.equal(final.authSessionVersion, 21);
  assert.equal(final.state, 'suspended');
  assert.deepEqual(financialFields(final), financialFields(initial));
});

test('cambios concurrentes de ambos estados conservan un contador serializable', async () => {
  const initial = await fixture({ authSessionVersion: 0 });
  const responses = await Promise.all(['suspended', 'active', 'suspended', 'active'].map(state => change(initial.id, state)));
  assert.ok(responses.every(item => item.status === 200));
  const final = await read(initial.id);
  assert.ok(final.authSessionVersion >= 1 && final.authSessionVersion <= 4);
  assert.equal(final.state, final.authSessionVersion % 2 ? 'suspended' : 'active');
  assert.deepEqual(financialFields(final), financialFields(initial));
});

test('el cliente no puede fijar la version ni reemplazar campos del proveedor', async () => {
  const initial = await fixture({ authSessionVersion: 4 });
  for (const forbidden of [{ authSessionVersion: 0 }, { stripeCustomerId: 'cus_other' }]) {
    const result = await change(initial.id, 'suspended', {
      body: { state: 'suspended', reason: 'Cambio no permitido', ...forbidden },
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'USER_FIELDS_READ_ONLY');
    assert.deepEqual(await read(initial.id), initial);
  }
});

test('versiones malformadas o agotadas fallan sin escribir cambios parciales', async () => {
  for (const authSessionVersion of ['4', -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    const initial = await fixture({ authSessionVersion });
    const result = await change(initial.id, 'suspended');
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'AUTH_SESSION_VERSION_INVALID');
    assert.deepEqual(await read(initial.id), initial);
  }
});

test('el rol financiero no puede modificar el estado ni invalidar sesiones', async () => {
  const initial = await fixture({ authSessionVersion: 2 });
  const result = await change(initial.id, 'suspended', { token: financeToken });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'AUTH_FORBIDDEN');
  assert.deepEqual(await read(initial.id), initial);
});

test('usuario inexistente devuelve 404 sin crear una cuenta parcial', async () => {
  const id = `usr_absent_${runId}`;
  const result = await change(id, 'suspended');
  assert.equal(result.status, 404);
  assert.equal((await db.collection(COL.users).doc(id).get()).exists, false);
});
