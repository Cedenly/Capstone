import { Router } from 'express';
import { ok, created, noContent, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, listAll, addDoc, patchDoc, deleteDoc, getDoc } from '../data/repo.js';

const r = Router();
const TIERS = ['Bronze', 'Silver', 'Gold'];

r.get('/sponsors', requireRole('finance'), wrap(async (_req, res) => {
  return ok(res, await listAll(COL.sponsors, 'name'));
}));

r.post('/sponsors', requireRole('finance'), wrap(async (req, res) => {
  const { name, tier, monthlyFee, benefits = [] } = req.body || {};
  if (!name) return fail(res, 400, 'VALIDATION', 'name es obligatorio');
  if (tier && !TIERS.includes(tier)) return fail(res, 400, 'VALIDATION', `tier debe ser uno de ${TIERS.join(', ')}`);
  const doc = await addDoc(COL.sponsors, {
    name, tier: tier || 'Bronze', monthlyFee: Number(monthlyFee || 0),
    benefitsOffered: benefits.length, benefitsRedeemed: 0, status: 'ok', benefits,
  });
  return created(res, doc);
}));

r.patch('/sponsors/:id', requireRole('finance'), wrap(async (req, res) => {
  const allowed = ['name', 'tier', 'monthlyFee', 'status', 'benefitsOffered'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  const doc = await patchDoc(COL.sponsors, req.params.id, patch);
  if (!doc) return fail(res, 404, 'NOT_FOUND', 'Sponsor no encontrado');
  return ok(res, doc);
}));

r.delete('/sponsors/:id', requireRole('finance'), wrap(async (req, res) => {
  const doc = await getDoc(COL.sponsors, req.params.id);
  if (!doc) return fail(res, 404, 'NOT_FOUND', 'Sponsor no encontrado');
  await deleteDoc(COL.sponsors, req.params.id);
  return noContent(res);
}));

export default r;
