import { fail } from '../lib/envelope.js';

export function notFound(req, res) {
  return fail(res, 404, 'NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.path}`);
}
export function errorHandler(err, req, res, _next) {
  console.error('[error]', err);
  if (err.status) return fail(res, err.status, err.code || 'ERROR', err.message);
  return fail(res, 500, 'INTERNAL', 'Error interno del servidor');
}
// Helper para envolver handlers async y propagar errores.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
