import 'dotenv/config';
import { requireTestSeedEnvironment } from '../lib/testSeedGuard.js';
import { billingFixture, createFixtureDocuments } from '../seed/billingFixture.js';

const target = requireTestSeedEnvironment();
const { db } = await import('../config/firebase.js');

try {
  await createFixtureDocuments(db, billingFixture());
  console.log(`Usuario, suscripción y factura sintéticos creados en ${target.projectId}. No se contactó a Stripe.`);
} catch (error) {
  if (error.code === 6) console.error('Los fixtures ya existen: el lote completo se rechazó sin sobrescribir datos.');
  else console.error('No se pudo crear el lote local:', error.message);
  process.exitCode = 1;
} finally {
  await db.terminate();
}
