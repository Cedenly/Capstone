import { Router } from 'express';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, listAll, getDoc, patchDoc } from '../data/repo.js';

const r = Router();

// GET /admin/platforms (ops/admin)
r.get('/platforms', requireRole('ops'), wrap(async (_req, res) => {
  return ok(res, await listAll(COL.platforms));
}));

// GET /admin/services (ops/admin)
r.get('/services', requireRole('ops'), wrap(async (_req, res) => {
  return ok(res, await listAll(COL.services));
}));

// GET /admin/containers (ops/admin)
r.get('/containers', requireRole('ops'), wrap(async (_req, res) => {
  return ok(res, await listAll(COL.containers));
}));

// POST /admin/containers/:name/restart (ops/admin)
r.post('/containers/:name/restart', requireRole('ops'), wrap(async (req, res) => {
  const doc = await getDoc(COL.containers, req.params.name);
  if (!doc) return fail(res, 404, 'NOT_FOUND', 'Contenedor no encontrado');
  // Acción operativa simulada: marca como reiniciándose.
  await patchDoc(COL.containers, req.params.name, { state: 'ok', cpu: 5, mem: 12 });
  return ok(res, { name: req.params.name, action: 'restart', status: 'scheduled' }, 202);
}));

export default r;
