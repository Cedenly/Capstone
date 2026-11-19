import { fail } from '../lib/envelope.js';
import { isAllowedOrigin, isLocalPeer, sessionConfig } from '../lib/sessionConfig.js';

// Las rutas que utilizan/establecen cookies no admiten formularios ni origen
// ausente/null. La allowlist se configura, nunca se reconstruye desde Host.
export function requireSessionOrigin(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!isAllowedOrigin(req.headers.origin)) {
    return fail(res, 403, 'AUTH_ORIGIN_DENIED', 'Origen de sesión no permitido.');
  }
  if (!req.is('application/json')) {
    return fail(res, 415, 'AUTH_JSON_REQUIRED', 'La sesión requiere application/json.');
  }
  if (!sessionConfig.secure && !isLocalPeer(req)) {
    return fail(res, 403, 'AUTH_LOCAL_ONLY', 'La cookie sin Secure solo está habilitada para pruebas loopback.');
  }
  next();
}
