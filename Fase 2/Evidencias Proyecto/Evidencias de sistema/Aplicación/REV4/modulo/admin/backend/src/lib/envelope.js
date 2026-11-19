// Envelope de respuestas estándar: { data, error, meta }
import { randomUUID } from 'crypto';

export function meta(extra = {}) {
  return { requestId: `req_${randomUUID().slice(0, 12)}`, timestamp: new Date().toISOString(), ...extra };
}
export function ok(res, data, status = 200, extraMeta = {}) {
  return res.status(status).json({ data, error: null, meta: meta(extraMeta) });
}
export function created(res, data, extraMeta = {}) {
  return ok(res, data, 201, extraMeta);
}
export function noContent(res) {
  return res.status(204).end();
}
export function fail(res, status, code, message, details = undefined) {
  return res.status(status).json({ data: null, error: { code, message, ...(details ? { details } : {}) }, meta: meta() });
}
