import jwt from 'jsonwebtoken';

const SECRET = (process.env.JWT_SECRET || '').trim();
if (Buffer.byteLength(SECRET, 'utf8') < 32 || /cambia|change.?me|dev-secret/i.test(SECRET)) {
  throw new Error('Configura JWT_SECRET en backend/.env con una clave aleatoria de al menos 32 caracteres.');
}
const ISSUER = 'aprueba-admin-api';
const AUDIENCE = 'aprueba-admin-console';
function ttl(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} debe ser un numero entero positivo.`);
  return value;
}
const ACCESS_TTL = ttl('JWT_ACCESS_TTL', 900);
const REFRESH_TTL = ttl('JWT_REFRESH_TTL', 2592000);
const options = { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE };

export function signAccess(user) {
  return jwt.sign({ sub: user.id, name: user.name, role: user.role, typ: 'access' },
    SECRET, { ...options, expiresIn: ACCESS_TTL });
}
export function signRefresh(user) {
  return jwt.sign({ sub: user.id, typ: 'refresh' }, SECRET, { ...options, expiresIn: REFRESH_TTL });
}
export function verify(token) {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
}
