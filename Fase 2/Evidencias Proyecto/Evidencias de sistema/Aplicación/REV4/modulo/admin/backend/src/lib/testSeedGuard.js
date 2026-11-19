// Guardar antes de inicializar el SDK: los fixtures solo pueden vivir en el emulador.
export function requireTestSeedEnvironment(env = process.env) {
  if (env.ALLOW_TEST_SEED !== 'true') {
    throw new Error('Semilla bloqueada: define ALLOW_TEST_SEED=true solo para esta prueba local.');
  }
  const match = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]):([1-9]\d{0,4})$/.exec(env.FIRESTORE_EMULATOR_HOST || '');
  if (!match || Number(match[2]) > 65535 ||
      (match[1].startsWith('127.') && match[1].split('.').some(part => Number(part) > 255))) {
    throw new Error('Semilla bloqueada: FIRESTORE_EMULATOR_HOST debe ser loopback con puerto, por ejemplo 127.0.0.1:8080.');
  }
  if (!/^demo-[a-z0-9][a-z0-9-]{0,24}$/.test(env.GCLOUD_PROJECT || '')) {
    throw new Error('Semilla bloqueada: GCLOUD_PROJECT debe identificar un proyecto local demo-*.');
  }
  return { projectId: env.GCLOUD_PROJECT, host: env.FIRESTORE_EMULATOR_HOST };
}
