// Las semillas y pruebas que mutan datos solo se permiten de forma explícita.
// Esta comprobación debe ejecutarse antes de inicializar el repositorio/API.
export function assertTestDataEnvironment(operation = 'datos de prueba') {
  const stop = message => { throw new Error(`[${operation}] ${message}`); };
  if (process.env.ALLOW_TEST_SEED !== 'true') {
    stop('Se requiere ALLOW_TEST_SEED=true. Esta operación reemplaza o modifica datos de prueba.');
  }
  if (process.env.NODE_ENV === 'production') {
    stop('Los datos de prueba están deshabilitados con NODE_ENV=production.');
  }
  const driver = process.env.DATA_DRIVER || 'memory';
  if (!['memory', 'firestore'].includes(driver)) stop('DATA_DRIVER debe ser memory o firestore.');
  if (driver === 'firestore') {
    const host = process.env.FIRESTORE_EMULATOR_HOST || '';
    const match = /^(?:127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(host);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) {
      stop('Firestore de prueba requiere FIRESTORE_EMULATOR_HOST loopback con puerto válido. No se permite Cloud Firestore.');
    }
    const project = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || '';
    if (!/^demo-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project)) {
      stop('Firestore de prueba requiere un proyecto dedicado con prefijo demo-.');
    }
  }
}
