import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';

import {
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore';

let _app = null;
let _db = null;

export async function initFirebaseAdmin() {
  if (_app) return _app;

  const existingApps = getApps();

  if (existingApps.length > 0) {
    _app = existingApps[0];
    return _app;
  }

  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    'aprueba-dev';

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    _app = initializeApp({ projectId });

    console.log(
      `[firebase] Emulador Firestore en ${process.env.FIRESTORE_EMULATOR_HOST}`,
    );
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    );

    _app = initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id || projectId,
    });

    console.log(
      '[firebase] Firebase Admin inicializado desde variable de entorno',
    );
  } else {
    _app = initializeApp({
      credential: applicationDefault(),
      projectId,
    });

    console.log(
      '[firebase] Firebase Admin inicializado con credenciales locales',
    );
  }

  return _app;
}

export async function initFirestore() {
  if (_db) {
    return {
      db: _db,
      FieldValue,
    };
  }

  const app = await initFirebaseAdmin();
  _db = getFirestore(app);

  return {
    db: _db,
    FieldValue,
  };
}