import 'dotenv/config';
import { requireTestSeedEnvironment } from '../lib/testSeedGuard.js';
import { billingFixture, createFixtureDocuments } from './billingFixture.js';

const target = requireTestSeedEnvironment();
const { db } = await import('../config/firebase.js');
const fixture = { fixture: true, fixtureSource: 'admin-local-emulator' };
const plans = [
  ['free', 'Gratis', 0, '#64748B', { qDay: 20, groups: 1, tests: 1 }, { login: 1, purchase: 0, correct: 1 }],
  ['uni', '1 prueba ilimitada', 1, '#1A365D', { qDay: 0, groups: 3, tests: 1 }, { login: 1, purchase: 5, correct: 1 }],
  ['all', 'Todas las pruebas', 5, '#F5B041', { qDay: 0, groups: 0, tests: 99 }, { login: 2, purchase: 10, correct: 2 }],
].map(([id, name, price, color, limits, badges]) => ['plans', id, {
  ...fixture, name, price, currency: 'USD', color, features: [], limits, badges,
  popular: false, adminRevision: 0,
}]);

try {
  await createFixtureDocuments(db, [...plans, ...billingFixture()]);
  console.log(`Fixtures locales creados en ${target.projectId}: 3 planes, 1 usuario, 1 suscripción y 1 factura.`);
  console.log('No se crearon cuentas administrativas, preguntas ni métricas. No es evidencia de un pago Stripe.');
} catch (error) {
  if (error.code === 6) console.error('Los fixtures ya existen: el lote completo se rechazó sin sobrescribir datos.');
  else console.error('No se pudo crear el lote local:', error.message);
  process.exitCode = 1;
} finally {
  await db.terminate();
}
