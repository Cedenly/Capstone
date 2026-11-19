import { verify } from '../lib/jwt.js';
import { fail } from '../lib/envelope.js';
import { COL, getDoc } from '../data/repo.js';

const ROLES = ['admin', 'finance', 'ops', 'support'];
export const validAdminId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
export async function loadAdmin(id) {
  if (!validAdminId(id)) return null;
  const user = await getDoc(COL.adminUsers, id);
  if (!user || !ROLES.includes(user.role) ||
      (user.state != null && user.state !== 'active') || user.disabled === true || user.mfaEnabled === true) return null;
  return { ...user, id };
}

export async function authRequired(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 401, 'AUTH_REQUIRED', 'Falta el token de acceso');
  let payload;
  try { payload = verify(token); }
  catch { return fail(res, 401, 'AUTH_INVALID', 'Sesion invalida o expirada. Inicia sesion nuevamente.'); }
  if (payload.typ !== 'access' || !validAdminId(payload.sub)) {
    return fail(res, 401, 'AUTH_INVALID', 'Tipo de sesion invalido');
  }
  try {
    const user = await loadAdmin(payload.sub);
    if (!user) return fail(res, 401, 'AUTH_INVALID', 'La cuenta administrativa no esta habilitada');
    // Consulta el rol vigente; no utiliza permisos antiguos del token.
    req.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (error) { next(error); }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, 'AUTH_REQUIRED', 'No autenticado');
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    return fail(res, 403, 'AUTH_FORBIDDEN', 'Tu cuenta no tiene permiso para esta operacion');
  };
}
