import { Router } from 'express';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, listAll, getDoc, db } from '../data/repo.js';

const r = Router();
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const text = value => typeof value === 'string' ? value : '';
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
// Lista explicita: nunca devolver hashes de contrasena ni tokens de recuperacion.
function publicUser(user) {
  return {
    id: text(user.id), name: text(user.name), email: text(user.email), country: text(user.country),
    plan: text(user.plan), state: text(user.state), lastActivity: text(user.lastActivity),
    badges: number(user.badges), groups: number(user.groups),
    subscription: user.billingProvider === 'stripe' && user.stripeSubscriptionId ? {
      id: text(user.stripeSubscriptionId), status: text(user.billingStatus),
    } : null,
    auditedBy: text(user.auditedBy), auditedAt: text(user.auditedAt), lastActionReason: text(user.lastActionReason),
  };
}

r.get('/users', requireRole('support'), wrap(async (req, res) => {
  const { q, plan, state, limit = '20', cursor } = req.query;
  if ([q, plan, state, limit, cursor].some(value => value != null && typeof value !== 'string')) {
    return fail(res, 400, 'VALIDATION', 'Filtros invalidos');
  }
  const lim = Number(limit);
  const offset = cursor ? Buffer.from(cursor, 'base64').toString('utf8') : '0';
  const start = Number(offset);
  if (!Number.isInteger(lim) || lim < 1 || lim > 100 || !/^\d+$/.test(offset) || !Number.isSafeInteger(start)) {
    return fail(res, 400, 'VALIDATION', 'Paginacion invalida');
  }
  let rows = await listAll(COL.users, 'name');
  if (q) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter(user => text(user.name).toLowerCase().includes(needle) || text(user.email).toLowerCase().includes(needle));
  }
  if (plan) rows = rows.filter(user => user.plan === plan);
  if (state) rows = rows.filter(user => user.state === state);
  const total = rows.length;
  const next = start + lim < total ? Buffer.from(String(start + lim)).toString('base64') : null;
  return ok(res, rows.slice(start, start + lim).map(publicUser), 200, { pagination: { total, nextCursor: next } });
}));

r.get('/users/:id', requireRole('support'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'VALIDATION', 'Identificador invalido');
  const user = await getDoc(COL.users, req.params.id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'Usuario no encontrado');
  return ok(res, publicUser({ ...user, id: req.params.id }));
}));

r.patch('/users/:id', requireRole('support'), wrap(async (req, res) => {
  const body = req.body;
  if (!validId(req.params.id) || !body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(res, 400, 'VALIDATION', 'Solicitud invalida');
  }
  if (Object.keys(body).some(key => !['state', 'reason'].includes(key))) {
    return fail(res, 409, 'USER_FIELDS_READ_ONLY', 'Solo puedes suspender o reactivar la cuenta. El correo y el plan son de consulta.');
  }
  if (!['active', 'suspended'].includes(body.state) || typeof body.reason !== 'string' ||
      body.reason.trim().length < 3 || body.reason.trim().length > 500) {
    return fail(res, 400, 'VALIDATION', 'Indica un estado valido y un motivo de entre 3 y 500 caracteres');
  }
  const ref = db.collection(COL.users).doc(req.params.id);
  const user = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const current = snap.data();
    if (current.state === body.state) return { ...current, id: ref.id };
    // APR-77: el alumno vincula sus sesiones a esta versión. Incrementarla en
    // la misma transacción impide reusar una sesión tras suspender/reactivar,
    // incluso si no hubo peticiones del alumno durante la suspensión.
    const previousVersion = current.authSessionVersion ?? 0;
    if (!Number.isSafeInteger(previousVersion) || previousVersion < 0 ||
        previousVersion >= Number.MAX_SAFE_INTEGER) {
      throw Object.assign(new Error('La version de sesion de la cuenta requiere revision antes de cambiar su estado.'),
        { status: 409, code: 'AUTH_SESSION_VERSION_INVALID' });
    }
    const patch = { state: body.state, lastActionReason: body.reason.trim(),
      auditedBy: req.user.id, auditedAt: new Date().toISOString(),
      authSessionVersion: previousVersion + 1 };
    // Actualiza estado, revocación y auditoría; conserva los campos de Stripe.
    tx.update(ref, patch);
    return { ...current, ...patch, id: ref.id };
  });
  if (!user) return fail(res, 404, 'NOT_FOUND', 'Usuario no encontrado');
  return ok(res, publicUser(user));
}));

export default r;
