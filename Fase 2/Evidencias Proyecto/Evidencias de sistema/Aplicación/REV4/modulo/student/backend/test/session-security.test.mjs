// APR-77. Solo datos locales sintéticos. Ejecutar mediante run-session-security.mjs.
import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.APR77_ISOLATED_TEST_RUNTIME !== 'true') {
  throw new Error('Usa node test/run-session-security.mjs para ejecutar en una copia temporal aislada.');
}

process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.JWT_SECRET = randomBytes(48).toString('base64url');
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:5174';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_COOKIE_SAME_SITE = 'lax';
process.env.PHONE_VERIFICATION_REQUIRED = 'false';
process.env.DATA_DRIVER ||= 'memory';
process.env.ALLOW_TEST_SEED = 'true';
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = '';
if (process.env.DATA_DRIVER === 'firestore' &&
    (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
     !/^demo-/.test(process.env.GCLOUD_PROJECT || ''))) throw new Error('Solo emulador local demo-*');

const { default: app, server } = await import('../src/index.js');
const repo = await import('../src/data/repo.js');
const { default: password } = await import('../src/lib/password.js');
const { verify, signAccess } = await import('../src/lib/jwt.js');
const { default: jwt } = await import('jsonwebtoken');
const { readSessionConfig } = await import('../src/lib/sessionConfig.js');
const fixture = { id: 'usr_session_fixture', name: 'Prueba local de sesión', email: 'session@example.invalid',
  passwordHash: password.hashSync('Local-fixture-APR77'), state: 'active', plan: 'free',
  authSessionVersion: 0, authProvider: 'password', medals: {}, quota: {} };
let base;
const cookie = response => response.headers.get('set-cookie')?.split(';')[0];
const tokenOf = value => value.slice(value.indexOf('=') + 1);
const hash = value => createHash('sha256').update(value).digest('hex');

async function request(path, { method = 'POST', body = {}, origin = 'http://localhost:5174', sessionCookie, access, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: {
    ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    ...(origin != null ? { Origin: origin } : {}),
    ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    ...(access ? { Authorization: `Bearer ${access}` } : {}), ...headers,
  }, body: method !== 'GET' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
  const data = response.status === 204 ? null : await response.json();
  return { response, data, status: response.status, sessionCookie: cookie(response) };
}
async function login() {
  const result = await request('/auth/login', { body: { email: fixture.email, password: 'Local-fixture-APR77' } });
  assert.equal(result.status, 200);
  return { ...result, access: result.data.data.accessToken };
}
async function refresh(sessionCookie) { return request('/auth/refresh', { sessionCookie }); }
async function me(access) { return request('/me', { method: 'GET', access }); }
async function updateUser(partial) {
  if (process.env.DATA_DRIVER === 'firestore') {
    const { db } = await (await import('../src/config/firebase.js')).initFirestore();
    await db.collection('users').doc(fixture.id).update(partial);
  } else await repo.patch('users', fixture.id, partial);
}

before(async () => {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
beforeEach(async () => repo.reset({ users: { [fixture.id]: fixture }, authSessions: {}, authRefreshTokens: {}, medalLedger: {} }));
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (process.env.DATA_DRIVER === 'firestore') {
    const { getApps, deleteApp } = await import('firebase-admin/app');
    await Promise.all(getApps().map(deleteApp));
  }
});

test('origen ausente, null, externo o con Host falsificado no puede abrir sesión', async () => {
  for (const origin of [null, 'null', 'https://attacker.invalid', 'http://localhost:5174.evil.invalid']) {
    const result = await request('/auth/login', { origin, headers: { Host: 'localhost:5174', 'X-Forwarded-Host': 'localhost:5174' },
      body: { email: fixture.email, password: 'Local-fixture-APR77' } });
    assert.equal(result.status, 403); assert.equal(result.sessionCookie, undefined);
  }
  assert.equal((await repo.list('authSessions')).length, 0);
});

test('formularios simples no pueden modificar sesión', async () => {
  const result = await request('/auth/login', { headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(result.status, 415);
  assert.equal(result.data.error.code, 'AUTH_JSON_REQUIRED');
});

test('CORS devuelve origen exacto y credenciales solamente a la allowlist', async () => {
  for (const [origin, allowed] of [['http://localhost:5174', true], ['https://attacker.invalid', false]]) {
    const response = await fetch(base + '/auth/login', { method: 'OPTIONS', headers: { Origin: origin,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(response.headers.get('access-control-allow-origin'), allowed ? origin : null);
    if (allowed) assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  }
});

test('login usa HttpOnly, path limitado, SameSite y no expone refresh en JSON', async () => {
  const result = await login();
  const header = result.response.headers.get('set-cookie');
  assert.match(header, /HttpOnly/); assert.match(header, /Path=\/api\/v1\/auth/); assert.match(header, /SameSite=Lax/);
  assert.doesNotMatch(header, /Domain=/); assert.doesNotMatch(header, /Secure/);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(Object.hasOwn(result.data.data, 'refreshToken'), false);
  assert.equal(Object.hasOwn(result.data.data.user, 'authSessionVersion'), false);
  assert.match(verify(result.access).sid, /^[a-f0-9]{32}$/);
  assert.equal((await me(result.access)).status, 200);
});

test('registro establece la misma cookie y contrato público', async () => {
  const result = await request('/auth/register', { body: { name: 'Nueva cuenta local', email: 'new@example.invalid', password: 'Local-register-APR77', consent: true } });
  assert.equal(result.status, 201); assert.ok(result.sessionCookie);
  assert.equal(Object.hasOwn(result.data.data, 'refreshToken'), false);
  assert.equal((await me(result.data.data.accessToken)).status, 200);
});

test('credenciales erróneas no crean cookie ni familia', async () => {
  const result = await request('/auth/login', { body: { email: fixture.email, password: 'incorrecta' } });
  assert.equal(result.status, 401); assert.equal(result.sessionCookie, undefined);
  assert.equal((await repo.list('authSessions')).length, 0);
});

test('el almacén solo conserva hashes de refresh, no claves en claro', async () => {
  const result = await login();
  const secret = tokenOf(result.sessionCookie);
  const records = await repo.list('authRefreshTokens');
  assert.equal(records.length, 1); assert.equal(records[0].id, hash(secret));
  assert.equal(JSON.stringify([records, await repo.list('authSessions')]).includes(secret), false);
});

test('rotación consume el token y conserva vigencia absoluta', async () => {
  const result = await login();
  const sid = verify(result.access).sid;
  const initial = await repo.get('authSessions', sid);
  const next = await refresh(result.sessionCookie);
  assert.equal(next.status, 200); assert.notEqual(next.sessionCookie, result.sessionCookie);
  assert.equal(Object.hasOwn(next.data.data, 'refreshToken'), false);
  const current = await repo.get('authSessions', sid);
  assert.equal(current.rotation, 1); assert.equal(current.expiresAt, initial.expiresAt);
  assert.equal((await me(next.data.data.accessToken)).status, 200);
});

test('12 renovaciones simultáneas generan una rotación, los 409 no borran cookie', async () => {
  const result = await login();
  const responses = await Promise.all(Array.from({ length: 12 }, () => refresh(result.sessionCookie)));
  const success = responses.filter(r => r.status === 200);
  assert.equal(success.length, 1);
  for (const r of responses.filter(r => r.status !== 200)) {
    assert.equal(r.status, 409); assert.equal(r.data.error.code, 'REFRESH_CONCURRENT');
    assert.equal(r.sessionCookie, undefined);
  }
  assert.equal((await repo.list('authRefreshTokens')).length, 2);
  assert.equal((await refresh(success[0].sessionCookie)).status, 200);
});

test('reutilización fuera de ventana revoca la familia completa', async () => {
  const result = await login();
  const next = await refresh(result.sessionCookie);
  const oldHash = hash(tokenOf(result.sessionCookie));
  await repo.patch('authRefreshTokens', oldHash, { usedAt: Date.now() - 6000 });
  assert.equal((await refresh(result.sessionCookie)).status, 401);
  assert.equal((await refresh(next.sessionCookie)).status, 401);
  assert.equal((await me(next.data.data.accessToken)).status, 401);
});

test('logout sin Bearer revoca refresh y acceso; repetirlo es idempotente', async () => {
  const result = await login();
  for (let n = 0; n < 2; n++) {
    const logout = await request('/auth/logout', { sessionCookie: result.sessionCookie });
    assert.equal(logout.status, 204); assert.match(logout.response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  }
  assert.equal((await refresh(result.sessionCookie)).status, 401);
  assert.equal((await me(result.access)).status, 401);
});

test('logout con Bearer sin cookie también revoca la familia', async () => {
  const result = await login();
  assert.equal((await request('/auth/logout', { access: result.access })).status, 204);
  assert.equal((await refresh(result.sessionCookie)).status, 401);
  assert.equal((await me(result.access)).status, 401);
});

test('Bearer vencido solo permite logout, nunca acceso o renovación', async () => {
  const result = await login();
  const expired = jwt.sign({ sub: fixture.id, sid: verify(result.access).sid, typ: 'access' }, process.env.JWT_SECRET, { expiresIn: -1 });
  assert.equal((await me(expired)).status, 401);
  assert.equal((await request('/auth/logout', { access: expired })).status, 204);
  assert.equal((await refresh(result.sessionCookie)).status, 401);
});

test('cookie y Bearer de familias distintas se revocan en el mismo logout', async () => {
  const first = await login(); const second = await login();
  assert.equal((await request('/auth/logout', { sessionCookie: first.sessionCookie, access: second.access })).status, 204);
  assert.equal((await refresh(first.sessionCookie)).status, 401);
  assert.equal((await refresh(second.sessionCookie)).status, 401);
});

test('Bearer falsificado no permite revocar ni confirma logout', async () => {
  const result = await login();
  const forged = jwt.sign({ sub: fixture.id, sid: verify(result.access).sid, typ: 'access' }, 'synthetic-untrusted-secret');
  const response = await request('/auth/logout', { access: forged });
  assert.equal(response.status, 401); assert.equal(response.sessionCookie, undefined);
  assert.equal((await me(result.access)).status, 200);
});

test('logout con copia histórica revoca incluso después de dos rotaciones', async () => {
  const result = await login();
  const first = await refresh(result.sessionCookie);
  const second = await refresh(first.sessionCookie);
  assert.equal((await request('/auth/logout', { sessionCookie: result.sessionCookie })).status, 204);
  assert.equal((await refresh(second.sessionCookie)).status, 401);
});

test('logout concurrente con refresh nunca deja una familia utilizable', async () => {
  const result = await login();
  const [renew, logout] = await Promise.all([refresh(result.sessionCookie), request('/auth/logout', { sessionCookie: result.sessionCookie })]);
  assert.equal(logout.status, 204); assert.ok([200, 401].includes(renew.status));
  assert.equal((await refresh(renew.sessionCookie || result.sessionCookie)).status, 401);
  assert.equal((await me(result.access)).status, 401);
});

test('un token desconocido no revoca una familia cuyo sid conoce', async () => {
  const result = await login();
  const forged = `aprueba_refresh=${verify(result.access).sid}.${randomBytes(32).toString('base64url')}`;
  assert.equal((await refresh(forged)).status, 401);
  assert.equal((await request('/auth/logout', { sessionCookie: forged })).status, 204);
  assert.equal((await refresh(result.sessionCookie)).status, 200);
});

test('JWT antiguo sin sid y JWT con vínculo a otro usuario son rechazados', async () => {
  const result = await login();
  const old = jwt.sign({ sub: fixture.id, typ: 'access' }, process.env.JWT_SECRET, { expiresIn: 900 });
  assert.equal((await me(old)).status, 401);
  const mismatch = signAccess({ id: 'usr_other', role: 'student' }, verify(result.access).sid);
  assert.equal((await me(mismatch)).status, 401);
});

test('suspensión observada revoca la familia aunque luego reactive sin versión', async () => {
  const result = await login();
  await updateUser({ state: 'suspended' });
  assert.equal((await me(result.access)).status, 403);
  await updateUser({ state: 'active' });
  assert.equal((await refresh(result.sessionCookie)).status, 401);
});

test('suspender y reactivar entre peticiones invalida la sesión anterior por versión', async () => {
  const result = await login();
  await updateUser({ state: 'suspended', authSessionVersion: 1, auditedAt: '2026-11-10T01:00:00.000Z' });
  await updateUser({ state: 'active', authSessionVersion: 2, auditedAt: '2026-11-10T01:00:01.000Z' });
  assert.equal((await me(result.access)).status, 401);
  assert.equal((await refresh(result.sessionCookie)).status, 401);
  assert.equal((await me((await login()).access)).status, 200);
});

test('auditoría anterior al contador también invalida sesiones', async () => {
  const result = await login();
  await updateUser({ auditedAt: '2026-11-10T01:00:02.000Z' });
  assert.equal((await refresh(result.sessionCookie)).status, 401);
});

test('cuenta suspendida no inicia ni renueva sesión', async () => {
  const result = await login();
  await updateUser({ state: 'suspended' });
  assert.equal((await refresh(result.sessionCookie)).status, 403);
  const blocked = await request('/auth/login', { body: { email: fixture.email, password: 'Local-fixture-APR77' } });
  assert.equal(blocked.status, 403); assert.equal(blocked.sessionCookie, undefined);
});

test('refresh por cuerpo está retirado, incluso cuando acompaña cookie válida', async () => {
  const result = await login();
  const denied = await request('/auth/refresh', { sessionCookie: result.sessionCookie, body: { refreshToken: tokenOf(result.sessionCookie) } });
  assert.equal(denied.status, 400); assert.equal(denied.data.error.code, 'REFRESH_BODY_UNSUPPORTED');
  assert.equal((await refresh(result.sessionCookie)).status, 200);
});

test('cookies duplicadas se rechazan sin declarar un logout exitoso', async () => {
  const result = await login();
  const duplicate = `${result.sessionCookie}; ${result.sessionCookie}`;
  for (const path of ['/auth/logout', '/auth/refresh']) {
    const denied = await request(path, { sessionCookie: duplicate });
    assert.equal(denied.status, 400); assert.equal(denied.data.error.code, 'AUTH_COOKIE_AMBIGUOUS');
    assert.equal(denied.sessionCookie, undefined);
  }
  assert.equal((await me(result.access)).status, 200);
});

test('cookie malformada no confirma logout ni se borra silenciosamente', async () => {
  const response = await request('/auth/logout', { sessionCookie: 'aprueba_refresh=malformed' });
  assert.equal(response.status, 400); assert.equal(response.data.error.code, 'AUTH_COOKIE_INVALID');
  assert.equal(response.sessionCookie, undefined);
});

test('caducidad absoluta impide usar access aún firmado y refresh vigente', async () => {
  const result = await login();
  await repo.patch('authSessions', verify(result.access).sid, { expiresAt: Date.now() - 1 });
  assert.equal((await me(result.access)).status, 401);
  assert.equal((await refresh(result.sessionCookie)).status, 401);
});

test('fallo al guardar logout devuelve error sin borrar cookie ni fingir revocación', async () => {
  const result = await login();
  let restore;
  if (process.env.DATA_DRIVER === 'firestore') {
    const { db } = await (await import('../src/config/firebase.js')).initFirestore();
    const original = db.runTransaction;
    db.runTransaction = async () => { throw new Error('Fallo sintético de almacenamiento APR-77'); };
    restore = () => { db.runTransaction = original; };
  } else {
    const original = fs.renameSync;
    fs.renameSync = () => { throw new Error('Fallo sintético de persistencia APR-77'); };
    restore = () => { fs.renameSync = original; };
  }
  let response;
  try { response = await request('/auth/logout', { sessionCookie: result.sessionCookie }); } finally { restore(); }
  assert.equal(response.status, 500); assert.equal(response.sessionCookie, undefined);
  assert.equal((await me(result.access)).status, 200);
  assert.equal((await request('/auth/logout', { sessionCookie: result.sessionCookie })).status, 204);
  assert.equal((await me(result.access)).status, 401);
});

test('revocación sobrevive a un segundo proceso que relee el almacén', async () => {
  const result = await login();
  await request('/auth/logout', { sessionCookie: result.sessionCookie });
  const program = `import {validateWebAccess} from './src/lib/webSessions.js';
    const result=await validateWebAccess(JSON.parse(process.env.APR77_ACCESS_PAYLOAD));
    if(result.status!==401) throw new Error('Revocación no persistida');
    if(process.env.DATA_DRIVER==='firestore'){const {getApps,deleteApp}=await import('firebase-admin/app');await Promise.all(getApps().map(deleteApp));}
    console.log('REVOCATION_PERSISTED');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, APR77_ACCESS_PAYLOAD: JSON.stringify(verify(result.access)) },
  });
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /REVOCATION_PERSISTED/);
});

test('configuración segura por defecto y rechazo de configuraciones peligrosas', () => {
  const saved = { ...process.env };
  try {
    delete process.env.AUTH_COOKIE_SECURE;
    assert.equal(readSessionConfig().secure, true);
    for (const value of ['https://valid.invalid/path', '*', 'http://external.invalid', 'https://valid.invalid/']) {
      process.env.AUTH_ALLOWED_ORIGINS = value;
      assert.throws(() => readSessionConfig());
    }
    process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:5174';
    process.env.AUTH_COOKIE_SECURE = 'false'; process.env.NODE_ENV = 'production';
    assert.throws(() => readSessionConfig());
    process.env.NODE_ENV = 'test'; process.env.HOST = '0.0.0.0';
    assert.throws(() => readSessionConfig());
    process.env.HOST = '127.0.0.1'; process.env.AUTH_COOKIE_SAME_SITE = 'none';
    assert.throws(() => readSessionConfig());
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
