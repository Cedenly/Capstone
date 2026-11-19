// Autenticacion por JWT Bearer para el alumno.
import { verify } from '../lib/jwt.js';
import { fail } from '../lib/envelope.js';
import { validateWebAccess } from '../lib/webSessions.js';

export async function authRequired(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return fail(res, 401, 'AUTH_REQUIRED', 'Falta el token de acceso');
  try {
    const payload = verify(token);
    if (payload.typ !== 'access') return fail(res, 401, 'AUTH_INVALID', 'Tipo de token invalido');
    const result = await validateWebAccess(payload);
    if (result.status) return fail(res, result.status, result.code, result.message);
    req.user = result.user;
    req.authSession = result.session;
    next();
  } catch (e) {
    if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(e.name)) {
      return fail(res, 401, 'AUTH_INVALID', 'Token invalido o expirado');
    }
    // Un fallo del almacén no convierte una revocación fallida en logout ni
    // borra la sesión del navegador; permite reintentar cuando se recupere.
    return next(e);
  }
}
