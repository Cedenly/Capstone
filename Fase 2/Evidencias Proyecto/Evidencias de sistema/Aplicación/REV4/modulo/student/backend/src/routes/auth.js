// 1.1 Autenticación y cuenta
import { Router } from 'express';
import bcrypt from '../lib/password.js';
import { ok, created, fail, noContent } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireSessionOrigin } from '../middleware/sessionOrigin.js';
import { createWebSession, rotateWebSession, revokeWebSession } from '../lib/webSessions.js';
import { readRefreshCookie, setRefreshCookie, clearRefreshCookie } from '../lib/sessionCookies.js';
import {
  signAccess,
  verifyForLogout,
  signPhone,
  verifyPhone,
  accessTtl,
  phoneTtl,
} from '../lib/jwt.js';
import {
  COL,
  get,
  set,
  add,
  findOne,
  genId,
} from '../data/repo.js';
import { emptyWallet, award } from '../lib/medals.js';
import { todayKey, quotaMax } from '../lib/quota.js';
import { effectivePlan } from '../lib/entitlements.js';
import {
  normalizePhone,
  detectLocale,
  maskPhone,
} from '../lib/phone.js';
import {
  verifyPhoneIdToken,
  PhoneVerificationError,
} from '../lib/firebasePhone.js';
import { findCountry } from '../data/catalog.js';

const r = Router();

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  plan: effectivePlan(user),
  streak: user.streak || 0,
  quota: {
    used: user.quota?.used || 0,
    max: quotaMax(user),
  },
  medals: user.medals,
  authProvider: user.authProvider,
  phone: user.phone || null,
  phoneVerified: !!user.phoneVerified,
  country: user.country || null,
  language: user.language || user.locale || 'es',
  gradeId: user.gradeId || null,
  onboarded: !!user.onboarded,
});

function consumePhoneToken(phoneToken) {
  const payload = verifyPhone(phoneToken);

  if (!payload) return null;

  return {
    phone: payload.sub,
    country: payload.country || null,
    language: payload.language || null,
    firebaseUid: payload.firebaseUid || null,
  };
}

async function dailyLoginReward(user) {
  const today = todayKey();

  if (user.lastLoginRewardDay === today) return null;

  user.medals = user.medals || emptyWallet();
  award(user.medals, 'bronze', 1);
  user.lastLoginRewardDay = today;
  user.streak = (user.streak || 0) + 1;

  await set(COL.users, user.id, user);

  await add(COL.medalLedger, {
    userId: user.id,
    tier: 'bronze',
    amount: 1,
    reason: 'daily_login',
    createdAt: new Date().toISOString(),
  }, 'mdl');

  return { tier: 'bronze', amount: 1 };
}

// POST /auth/phone/send-code
// Firebase Auth envía el SMS desde el cliente.
r.post('/auth/phone/send-code', wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);

  if (!phone) {
    return fail(
      res,
      400,
      'INVALID_PHONE',
      'El telefono debe venir en formato internacional (+56912345678)',
      { field: 'phone' }
    );
  }

  const locale = detectLocale(phone);

  if (!locale.supported) {
    return fail(
      res,
      422,
      'COUNTRY_NOT_SUPPORTED',
      'Por ahora solo operamos en Chile (+56) y Reino Unido (+44)',
      { field: 'phone' }
    );
  }

  const existing = await findOne(
    COL.users,
    (user) => user.phone === phone
  );

  return ok(res, {
    phone,
    masked: maskPhone(phone),
    verifier: 'firebase',
    codeLength: 6,
    detectedCountry: locale.country,
    detectedLanguage: locale.language,
    dialCode: locale.dialCode,
    accountExists: !!existing,
  });
}));

// POST /auth/phone/verify-code
r.post('/auth/phone/verify-code', wrap(async (req, res) => {
  const {
    firebaseIdToken,
    idToken,
    phone: claimedPhone,
  } = req.body || {};

  let verified;

  try {
    verified = await verifyPhoneIdToken(firebaseIdToken || idToken);
  } catch (error) {
    if (error instanceof PhoneVerificationError) {
      const status = error.code === 'VALIDATION_ERROR'
        ? 400
        : error.code === 'PHONE_AUTH_UNAVAILABLE'
          ? 503
          : 401;

      return fail(res, status, error.code, error.message);
    }

    throw error;
  }

  const phone = normalizePhone(verified.phone);

  if (!phone) {
    return fail(
      res,
      422,
      'INVALID_PHONE',
      'El telefono verificado no tiene formato valido'
    );
  }

  if (claimedPhone && normalizePhone(claimedPhone) !== phone) {
    return fail(
      res,
      409,
      'PHONE_MISMATCH',
      'El telefono verificado no coincide con el solicitado'
    );
  }

  const locale = detectLocale(phone);

  if (!locale.supported) {
    return fail(
      res,
      422,
      'COUNTRY_NOT_SUPPORTED',
      'Por ahora solo operamos en Chile (+56) y Reino Unido (+44)'
    );
  }

  const existing = await findOne(
    COL.users,
    (user) => user.phone === phone
  );

  return ok(res, {
    phoneToken: signPhone({
      phone,
      country: locale.country,
      language: locale.language,
      firebaseUid: verified.firebaseUid,
      provider: verified.provider,
    }),
    expiresIn: phoneTtl,
    phone,
    country: locale.country,
    language: locale.language,
    accountExists: !!existing,
  });
}));

// POST /auth/register
r.post('/auth/register', requireSessionOrigin, wrap(async (req, res) => {
  const {
    name,
    email,
    password,
    consent,
    locale,
    phoneToken,
    country,
    language,
    gradeId,
  } = req.body || {};

  if (!name || !email || !password) {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'Nombre, correo y contrasena son obligatorios'
    );
  }

  if (String(password).length < 8) {
    return fail(
      res,
      400,
      'WEAK_PASSWORD',
      'La contrasena debe tener al menos 8 caracteres'
    );
  }

  if (!consent) {
    return fail(
      res,
      400,
      'CONSENT_REQUIRED',
      'Debe aceptarse el tratamiento de datos'
    );
  }

  const exists = await findOne(
    COL.users,
    (user) => user.email?.toLowerCase() === String(email).toLowerCase()
  );

  if (exists) {
    return fail(
      res,
      409,
      'EMAIL_ALREADY_EXISTS',
      'Ya existe una cuenta con ese correo'
    );
  }

  const phoneRequired =
    process.env.PHONE_VERIFICATION_REQUIRED !== 'false';

  const verifiedPhone = phoneToken
    ? consumePhoneToken(phoneToken)
    : null;

  if (phoneToken && !verifiedPhone) {
    return fail(
      res,
      401,
      'PHONE_TOKEN_INVALID',
      'El phoneToken es invalido o expiro',
      { field: 'phoneToken' }
    );
  }

  if (phoneRequired && !verifiedPhone) {
    return fail(
      res,
      400,
      'PHONE_VERIFICATION_REQUIRED',
      'Debes verificar tu telefono antes de crear la cuenta',
      { field: 'phoneToken' }
    );
  }

  if (verifiedPhone) {
    const phoneTaken = await findOne(
      COL.users,
      (user) => user.phone === verifiedPhone.phone
    );

    if (phoneTaken) {
      return fail(
        res,
        409,
        'PHONE_ALREADY_IN_USE',
        'Ya existe una cuenta con ese telefono',
        { field: 'phoneToken' }
      );
    }
  }

  if (country && !findCountry(country)) {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'country invalido',
      { field: 'country' }
    );
  }

  const resolvedCountry =
    (country || verifiedPhone?.country || 'CL').toUpperCase();

  const resolvedLanguage =
    language || locale || verifiedPhone?.language || 'es';

  const id = genId('usr');

  const user = {
    id,
    name,
    email,
    emailLower: String(email).toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 8),
    authProvider: 'password',
    phone: verifiedPhone?.phone || null,
    phoneVerified: !!verifiedPhone,
    firebaseUid: verifiedPhone?.firebaseUid || null,
    country: resolvedCountry,
    language: resolvedLanguage,
    gradeId: gradeId || null,
    plan: 'free',
    state: 'active',
    locale: resolvedLanguage,
    theme: 'light',
    dailyReminder: true,
    streak: 0,
    quota: { day: todayKey(), used: 0 },
    bonuses: { school: false, address: false },
    medals: emptyWallet(),
    selectedTests: [],
    format: 'random',
    difficulty: 'd2',
    onboarded: false,
    createdAt: new Date().toISOString(),
  };

  award(user.medals, 'bronze', 1);
  await set(COL.users, id, user);

  const session = await createWebSession(user);
  if (session.status) return fail(res, session.status, session.code, session.message);
  setRefreshCookie(res, session.refreshToken, session.expiresAt);
  return created(res, {
    user: publicUser(session.user),
    accessToken: signAccess(session.user, session.session.id),
    expiresIn: accessTtl,
  });
}));

// POST /auth/login
r.post('/auth/login', requireSessionOrigin, wrap(async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'email y password son obligatorios'
    );
  }

  const user = await findOne(
    COL.users,
    (item) => item.email?.toLowerCase() === String(email).toLowerCase()
  );

  if (!user || !bcrypt.compareSync(password, user.passwordHash || '')) {
    return fail(
      res,
      401,
      'AUTH_INVALID_CREDENTIALS',
      'El correo o la contrasena son incorrectos'
    );
  }

  if (user.state === 'suspended') {
    return fail(
      res,
      403,
      'ACCOUNT_SUSPENDED',
      'La cuenta esta suspendida'
    );
  }

  const reward = await dailyLoginReward(user);

  const session = await createWebSession(user);
  if (session.status) return fail(res, session.status, session.code, session.message);
  setRefreshCookie(res, session.refreshToken, session.expiresAt);
  return ok(res, {
    user: publicUser(session.user),
    accessToken: signAccess(session.user, session.session.id),
    expiresIn: accessTtl,
    dailyLoginReward: reward,
  });
}));

// El acceso social anterior era simulado.
r.post('/auth/social', (_req, res) => {
  return fail(
    res,
    410,
    'SOCIAL_LOGIN_DISABLED',
    'El acceso con Google o Apple no esta disponible. Utiliza tu correo y contrasena.'
  );
});

// POST /auth/refresh. El token vive exclusivamente en una cookie HttpOnly.
r.post('/auth/refresh', requireSessionOrigin, wrap(async (req, res) => {
  if (Object.hasOwn(req.body || {}, 'refreshToken')) {
    return fail(res, 400, 'REFRESH_BODY_UNSUPPORTED', 'La renovación web requiere la cookie de sesión.');
  }
  const session = await rotateWebSession(readRefreshCookie(req));
  if (session.status) {
    // No borrar cookies desde respuestas tardías, en especial un 409 de una
    // renovación concurrente: podría borrar la cookie ya rotada por otra.
    return fail(res, session.status, session.code, session.message);
  }
  setRefreshCookie(res, session.refreshToken, session.expiresAt);
  return ok(res, {
    accessToken: signAccess(session.user, session.session.id),
    expiresIn: accessTtl,
  });
}));

// POST /auth/logout. También funciona con accessToken vencido o ausente.
r.post('/auth/logout', requireSessionOrigin, wrap(async (req, res) => {
  const refreshCookie = readRefreshCookie(req);
  let payload = null;
  if (req.headers.authorization) {
    try {
      if (!req.headers.authorization.startsWith('Bearer ')) throw new Error('Formato');
      payload = verifyForLogout(req.headers.authorization.slice(7));
      if (payload.typ !== 'access' || typeof payload.sid !== 'string' || !/^[a-f0-9]{32}$/.test(payload.sid) ||
          typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.sub)) throw new Error('Tipo');
    } catch {
      return fail(res, 401, 'AUTH_LOGOUT_TOKEN_INVALID', 'No se pudo comprobar la sesión que se desea cerrar.');
    }
  }
  await revokeWebSession(refreshCookie, payload);
  clearRefreshCookie(res);
  return noContent(res);
}));

// La recuperación por correo requiere una integración real de envío.
// Las rutas demo no generan tokens ni modifican contraseñas.
const recoveryUnavailable = (_req, res) => {
  return fail(
    res,
    410,
    'PASSWORD_RECOVERY_UNAVAILABLE',
    'La recuperacion de contrasena por correo no esta disponible en esta version.'
  );
};

r.post('/auth/password/forgot', recoveryUnavailable);
r.post('/auth/password/reset', recoveryUnavailable);

export { dailyLoginReward, publicUser };
export default r;
