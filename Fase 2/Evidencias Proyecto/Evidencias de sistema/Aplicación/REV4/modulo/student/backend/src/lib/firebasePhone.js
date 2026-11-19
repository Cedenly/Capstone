// Verificación del teléfono con Firebase Authentication.
// En producción valida el idToken entregado por Firebase Auth.
// En desarrollo admite tokens dev si están habilitados.

import { initFirebaseAdmin } from '../config/firebase.js';

let _auth = null;

const devTokensAllowed = () =>
  process.env.PHONE_AUTH_ALLOW_DEV_TOKEN === 'true' &&
  process.env.NODE_ENV !== 'production';

async function firebaseAuth() {
  if (_auth) return _auth;

  const [{ getAuth }, app] = await Promise.all([
    import('firebase-admin/auth'),
    initFirebaseAdmin(),
  ]);

  _auth = getAuth(app);
  return _auth;
}

export class PhoneVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function verifyPhoneIdToken(idToken) {
  const token = String(idToken || '').trim();

  if (!token) {
    throw new PhoneVerificationError(
      'VALIDATION_ERROR',
      'firebaseIdToken es obligatorio',
    );
  }

  if (token.startsWith('dev:')) {
    if (!devTokensAllowed()) {
      throw new PhoneVerificationError(
        'PHONE_TOKEN_INVALID',
        'Los tokens de desarrollo están deshabilitados',
      );
    }

    const phone = token.slice(4);

    return {
      phone,
      firebaseUid: `dev_${phone.replace(/\D/g, '')}`,
      provider: 'dev',
    };
  }

  let decoded;

  try {
    const auth = await firebaseAuth();
    decoded = await auth.verifyIdToken(token, true);
  } catch (error) {
    throw new PhoneVerificationError(
      'PHONE_TOKEN_INVALID',
      'El idToken de Firebase es inválido o expiró',
    );
  }

  const phone =
    decoded.phone_number ||
    decoded.firebase?.identities?.phone?.[0];

  const signInProvider = decoded.firebase?.sign_in_provider;

  if (!phone || signInProvider !== 'phone') {
    throw new PhoneVerificationError(
      'PHONE_NOT_VERIFIED',
      'El idToken no corresponde a una verificación telefónica',
    );
  }

  return {
    phone,
    firebaseUid: decoded.uid,
    provider: 'firebase',
  };
}