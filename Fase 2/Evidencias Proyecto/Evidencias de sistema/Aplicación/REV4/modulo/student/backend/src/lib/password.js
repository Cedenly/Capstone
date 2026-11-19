// Hash de contrasenas con crypto.scrypt nativo (sin dependencias externas).
// API compatible con bcryptjs: hashSync(plain) / compareSync(plain, stored).
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

export function hashSync(plain) {
  const salt = randomBytes(16).toString('hex');
  const dk = scryptSync(String(plain), salt, 32).toString('hex');
  return `scrypt$${salt}$${dk}`;
}

export function compareSync(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, dk] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !dk) return false;
  const calc = scryptSync(String(plain), salt, 32);
  const orig = Buffer.from(dk, 'hex');
  return calc.length === orig.length && timingSafeEqual(calc, orig);
}

export default { hashSync, compareSync };
