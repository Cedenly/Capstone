// Ejecuta la batería de APR-77 sin tocar backend/.data de la instalación.
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const driver = process.argv[2] || 'memory';
if (!['memory', 'firestore'].includes(driver)) throw new Error('Uso: node test/run-session-security.mjs [memory|firestore]');
if (driver === 'firestore' && (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^demo-/.test(process.env.GCLOUD_PROJECT || ''))) {
  throw new Error('Firestore requiere emulador 127.0.0.1:puerto y GCLOUD_PROJECT=demo-* dedicados a pruebas.');
}
const source = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(join(source, 'node_modules'))) throw new Error('Ejecuta npm ci en backend antes de la batería.');
const scratch = mkdtempSync(join(tmpdir(), 'apr77-session-test-'));
try {
  const runtime = join(scratch, 'backend');
  cpSync(source, runtime, { recursive: true, filter: path => {
    const name = basename(path);
    return !['node_modules', '.data', '.git'].includes(name) && !name.startsWith('.env');
  } });
  symlinkSync(join(source, 'node_modules'), join(runtime, 'node_modules'), 'junction');
  // No se pasan credenciales Firebase/Stripe a la copia de pruebas.
  const env = { ...process.env, NODE_ENV: 'test', DATA_DRIVER: driver, APR77_ISOLATED_TEST_RUNTIME: 'true' };
  for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) delete env[name];
  if (driver === 'memory') { delete env.FIRESTORE_EMULATOR_HOST; delete env.GCLOUD_PROJECT; }
  const result = spawnSync(process.execPath, ['--test', 'test/session-security.test.mjs'], {
    cwd: runtime, env, stdio: 'inherit', timeout: 120000,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
