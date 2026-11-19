import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { requireTestSeedEnvironment } from '../lib/testSeedGuard.js';

requireTestSeedEnvironment();
const baseUrl = new URL(process.env.ADMIN_API_URL || 'http://localhost:4000/api/v1/admin');
if (baseUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname) ||
    baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== '/api/v1/admin') {
  throw new Error('ADMIN_API_URL debe apuntar a la API local http://localhost:puerto/api/v1/admin.');
}
const { db } = await import('../config/firebase.js');
const { signAccess } = await import('../lib/jwt.js');

// Solo para la API local. Las pruebas de escritura usan documentos inexistentes
// y cuerpos que tampoco pueden crear datos con las rutas anteriores.
const base = baseUrl.href;
async function request(path, token, method = 'GET', body) {
  const response = await fetch(base + path, {
    method, signal: AbortSignal.timeout(15000), redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

try {
  const account = (await db.collection('adminUsers').doc('adm_local').get()).data();
  if (!account || account.role !== 'admin' || (account.state && account.state !== 'active') || account.disabled || account.mfaEnabled) {
    throw new Error('Crea primero la cuenta local con npm run admin:local. Debe estar habilitada como admin.');
  }
  const probe = `guard_${randomUUID().replaceAll('-', '')}`;
  for (const collection of ['users', 'plans', 'adminUsers']) {
    if ((await db.collection(collection).doc(probe).get()).exists) throw new Error('Identificador de prueba ocupado.');
  }
  const token = signAccess({ ...account, id: 'adm_local' });
  const missingToken = signAccess({ id: probe, name: 'Comprobacion', role: 'admin' });
  const cases = [
    ['Sin sesion', '/users', null, 'GET', undefined, 401, 'AUTH_REQUIRED'],
    ['Administrador inexistente', '/users', missingToken, 'GET', undefined, 401, 'AUTH_INVALID'],
    ['Cambio manual de plan bloqueado', `/users/${probe}`, token, 'PATCH', { plan: 'free' }, 409, 'USER_FIELDS_READ_ONLY'],
    ['Cambio de correo bloqueado', `/users/${probe}`, token, 'PATCH', { email: 'guard@example.com' }, 409, 'USER_FIELDS_READ_ONLY'],
    ['Crear plan bloqueado', '/plans', token, 'POST', {}, 409, 'PLAN_CATALOG_READ_ONLY'],
    ['Plan inexistente protegido', `/plans/${probe}`, token, 'PUT', {}, 404, 'NOT_FOUND'],
    ['Cambios de precio bloqueados', `/plans/${probe}`, token, 'PUT', { price: 99 }, 409, 'PLAN_FIELDS_READ_ONLY'],
    ['Eliminar plan bloqueado', `/plans/${probe}`, token, 'DELETE', undefined, 409, 'PLAN_CATALOG_READ_ONLY'],
  ];
  const results = [];
  for (const [name, path, key, method, body, expectedStatus, code] of cases) {
    const result = await request(path, key, method, body);
    results.push({ Prueba: name, HTTP: result.status, Resultado:
      result.status === expectedStatus && result.json.error?.code === code ? 'OK' : 'FALLO' });
  }
  const users = await request('/users?limit=100', token);
  const allowed = new Set(['id', 'name', 'email', 'country', 'plan', 'state', 'lastActivity', 'badges',
    'groups', 'subscription', 'auditedBy', 'auditedAt', 'lastActionReason']);
  const privateSafe = users.status === 200 && Array.isArray(users.json.data) && users.json.data.length > 0 &&
    users.json.data.every(user => Object.keys(user).every(key => allowed.has(key)) &&
      (!user.subscription || Object.keys(user.subscription).every(key => ['id', 'status'].includes(key))));
  results.push({ Prueba: 'Usuarios sin campos privados', HTTP: users.status, Resultado: privateSafe ? 'OK' : 'FALLO' });
  const plans = await request('/plans', token);
  const catalogSafe =
  plans.status === 200 &&
  plans.json.meta?.readOnly === false &&
  ['name', 'color', 'features', 'limits', 'badges', 'popular'].every(
    field => plans.json.meta?.editableFields?.includes(field)
  ) &&
  plans.json.meta?.billingChangesReady === false;

results.push({
  Prueba: 'Configuracion editable',
  HTTP: plans.status,
  Resultado: catalogSafe ? 'OK' : 'FALLO',
});
  console.table(results);
  const passed = results.filter(result => result.Resultado === 'OK').length;
  console.log(`Protecciones verificadas: ${passed}/${results.length}`);
  if (passed !== results.length) process.exitCode = 1;
} catch (error) {
  console.error('No se pudo completar la comprobacion:', error.message);
  process.exitCode = 1;
} finally { await db.terminate(); }
