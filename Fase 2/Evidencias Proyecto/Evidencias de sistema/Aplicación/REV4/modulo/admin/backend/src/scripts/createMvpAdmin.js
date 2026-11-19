import 'dotenv/config';
import bcrypt from 'bcryptjs';
import admin, { db } from '../config/firebase.js';

const PROJECT_ID = 'aprueba-mvp-pruebas-2fc41';
const ADMIN_ID = 'adm_mvp';
const ADMIN_EMAIL = 'admin.mvp@example.com';

async function main() {
  const projectId = admin.app().options.projectId;

  if (
    projectId !== PROJECT_ID ||
    process.env.FIRESTORE_EMULATOR_HOST
  ) {
    throw new Error(
      'La conexion no corresponde a la base de pruebas esperada.'
    );
  }

  const password = process.env.MVP_ADMIN_PASSWORD || '';

  if (
    password === 'ESCRIBE_AQUI_TU_CONTRASENA' ||
    password.length < 12 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error(
      'Define MVP_ADMIN_PASSWORD con una contrasena propia de al menos 12 caracteres y hasta 72 bytes.'
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admins = db.collection('adminUsers');

  const created = await db.runTransaction(async tx => {
    const snapshot = await tx.get(admins);

    const emailOf = doc =>
      String(doc.data().email || '').toLowerCase();

    const existingId = snapshot.docs.find(
      doc => doc.id === ADMIN_ID
    );

    const sameEmails = snapshot.docs.filter(
      doc => emailOf(doc) === ADMIN_EMAIL
    );

    if (existingId) {
      if (
        emailOf(existingId) !== ADMIN_EMAIL ||
        existingId.data().role !== 'admin' ||
        existingId.data().createdBy !== 'mvp_setup' ||
        sameEmails.length !== 1
      ) {
        throw new Error(
          'El identificador administrativo ya esta ocupado. No se modifico la cuenta.'
        );
      }

      return false;
    }

    if (sameEmails.length > 0) {
      throw new Error(
        'Ese correo ya pertenece a otra cuenta administrativa.'
      );
    }

    tx.create(admins.doc(ADMIN_ID), {
      name: 'Administrador MVP',
      email: ADMIN_EMAIL,
      emailLower: ADMIN_EMAIL,
      role: 'admin',
      mfaEnabled: false,
      passwordHash,
      createdBy: 'mvp_setup',
      createdAt: new Date().toISOString(),
    });

    return true;
  });

  console.log('Proyecto Firebase:', projectId);

  console.log(
    created
      ? 'Cuenta administrativa creada: OK'
      : 'La cuenta ya existia. Se conserva su contrasena anterior.'
  );

  console.log('Correo:', ADMIN_EMAIL);
  console.log('Rol: admin');
}

try {
  await main();
} catch (error) {
  console.error(
    'No se pudo completar la creacion:',
    error.message
  );
  process.exitCode = 1;
} finally {
  await db.terminate().catch(() => {});
}