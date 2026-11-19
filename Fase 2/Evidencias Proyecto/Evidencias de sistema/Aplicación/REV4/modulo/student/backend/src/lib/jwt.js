import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;

if (
  typeof SECRET !== 'string' ||
  Buffer.byteLength(SECRET.trim(), 'utf8') < 32 ||
  /cambia|change.?me|dev-secret/i.test(SECRET)
) {
  throw new Error(
    'JWT_SECRET debe ser una clave aleatoria propia de al menos 32 bytes. Configúrala en las variables del backend.'
  );
}
const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL || 900);
// Token corto que acredita "este telefono fue verificado"; se canjea en
// /auth/register, /auth/social o PATCH /me/phone.
const PHONE_TTL = Number(process.env.JWT_PHONE_TTL || 900);

if (!Number.isSafeInteger(ACCESS_TTL) || ACCESS_TTL < 1 || ACCESS_TTL > 900) {
  throw new Error('JWT_ACCESS_TTL debe estar entre 1 y 900 segundos.');
}
export function signAccess(user, sid) {
  if (typeof sid !== 'string' || !/^[a-f0-9]{32}$/.test(sid)) {
    throw new Error('signAccess requiere una sesión web registrada.');
  }
  return jwt.sign(
    { sub: user.id, sid, name: user.name, role: user.role || 'student', plan: user.plan || 'free', typ: 'access' },
    SECRET, { expiresIn: ACCESS_TTL });
}
export function signPhone({ phone, country, language, firebaseUid, provider }) {
  return jwt.sign(
    { sub: phone, country, language, firebaseUid, provider, typ: 'phone' },
    SECRET, { expiresIn: PHONE_TTL });
}
// Devuelve el payload del phoneToken o null si es invalido/expirado o no es de tipo phone.
export function verifyPhone(token) {
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    return payload.typ === 'phone' ? payload : null;
  } catch {
    return null;
  }
}
export function verify(token) { return jwt.verify(token, SECRET, { algorithms: ['HS256'] }); }
// Exclusivamente para revocar: un JWT vencido sigue acreditando qué familia
// cerrar, pero esta función jamás se usa para autorizar un recurso o renovar.
export function verifyForLogout(token) {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'], ignoreExpiration: true });
}
export const accessTtl = ACCESS_TTL;
export const phoneTtl = PHONE_TTL;
