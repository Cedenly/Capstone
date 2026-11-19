// Inicialización del Firebase Admin SDK.
//
// Modos soportados:
// 1. Emulador local mediante FIRESTORE_EMULATOR_HOST.
// 2. Vercel mediante FIREBASE_SERVICE_ACCOUNT_JSON.
// 3. Credenciales locales mediante GOOGLE_APPLICATION_CREDENTIALS
//    o Google Application Default Credentials.

import admin from 'firebase-admin';

const projectId =
  process.env.GCLOUD_PROJECT ||
  'aprueba-administracion';

if (!admin.apps.length) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId });

    console.log(
      `[firebase] Conectado al emulador de Firestore en ${process.env.FIRESTORE_EMULATOR_HOST}`
    );
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });

    console.log('[firebase] Conectado a Firestore mediante cuenta de servicio');
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });

    console.log(
      '[firebase] Conectado a Firestore mediante credenciales del entorno'
    );
  }
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export default admin;