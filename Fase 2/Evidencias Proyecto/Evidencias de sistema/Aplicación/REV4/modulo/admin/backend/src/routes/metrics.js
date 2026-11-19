import { Router } from 'express';
import { ok } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, getDoc } from '../data/repo.js';

const r = Router();

// GET /admin/metrics/overview  (cualquier rol administrativo)
// "Resumen" es la portada de la consola para los cuatro roles, así que el
// resumen ejecutivo tiene que ser legible por todos ellos (admin pasa siempre).
r.get('/metrics/overview', requireRole('finance', 'ops', 'support'), wrap(async (req, res) => {
  const doc = await getDoc(COL.metrics, 'overview');
  return ok(res, doc || {}, 200, { range: req.query.range || '30d' });
}));

// GET /admin/metrics/commercial  (Bearer finance/admin)
r.get('/metrics/commercial', requireRole('finance'), wrap(async (req, res) => {
  const doc = await getDoc(COL.metrics, 'commercial');
  return ok(res, doc || {}, 200, { range: req.query.range || '30d' });
}));

export default r;
