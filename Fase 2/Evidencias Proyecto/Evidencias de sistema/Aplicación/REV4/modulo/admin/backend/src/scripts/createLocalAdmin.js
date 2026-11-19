import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { requireTestSeedEnvironment } from '../lib/testSeedGuard.js';

requireTestSeedEnvironment();
const password = process.env.LOCAL_ADMIN_PASSWORD || '';

if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
  throw new Error('LOCAL_ADMIN_PASSWORD debe tener entre 12 caracteres y 72 bytes.');
}

const { db } = await import('../config/firebase.js');

try {
  const ref = db.collection('adminUsers').doc('adm_local');
  const existing = await ref.get();

  if (existing.exists) {
    console.log('La cuenta local ya existe; se conserva su contraseña.');
  } else {
    await ref.create({
      name: 'Administrador local',
      email: 'admin.local@example.test',
      emailLower: 'admin.local@example.test',
      role: 'admin',
      state: 'active',
      mfaEnabled: false,
      passwordHash: await bcrypt.hash(password, 12),
      createdBy: 'local_emulator',
      createdAt: new Date().toISOString(),
    });
    console.log('Cuenta administrativa local creada.');
  }

  console.log('Correo: admin.local@example.test');
} finally {
  await db.terminate();
}
