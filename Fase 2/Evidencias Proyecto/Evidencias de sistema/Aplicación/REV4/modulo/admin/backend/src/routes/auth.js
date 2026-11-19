import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { loadAdmin, validAdminId } from '../middleware/auth.js';
import { signAccess, signRefresh, verify } from '../lib/jwt.js';
import { COL, listAll } from '../data/repo.js';

const r = Router();
const publicAdmin = user => ({ id: user.id, name: user.name, role: user.role, email: user.email });
r.post('/auth/login', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || email.length > 254 ||
      typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    return fail(res, 400, 'VALIDATION', 'Ingresa un correo y una contrasena validos');
  }
  const normalized = email.trim().toLowerCase();
  const matches = (await listAll(COL.adminUsers)).filter(user => user.email?.toLowerCase() === normalized);
  const user = matches.length === 1 ? await loadAdmin(matches[0].id) : null;
  if (!user || typeof user.passwordHash !== 'string' || !await bcrypt.compare(password, user.passwordHash)) {
    return fail(res, 401, 'AUTH_INVALID_CREDENTIALS', 'Credenciales invalidas o cuenta no habilitada');
  }
  const pub = publicAdmin(user);
  return ok(res, { user: pub, accessToken: signAccess(pub), refreshToken: signRefresh(pub) });
}));

r.post('/auth/refresh', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let payload;
  try { payload = verify(req.body?.refreshToken); }
  catch { return fail(res, 401, 'AUTH_INVALID', 'Sesion invalida o expirada'); }
  if (payload.typ !== 'refresh' || !validAdminId(payload.sub)) {
    return fail(res, 401, 'AUTH_INVALID', 'Tipo de sesion invalido');
  }
  const user = await loadAdmin(payload.sub);
  if (!user) return fail(res, 401, 'AUTH_INVALID', 'La cuenta administrativa no esta habilitada');
  const pub = publicAdmin(user);
  return ok(res, { accessToken: signAccess(pub), refreshToken: signRefresh(pub) });
}));

export default r;
