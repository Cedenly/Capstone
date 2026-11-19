import { Router } from 'express';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, listAll, patchDoc } from '../data/repo.js';

const r = Router();

r.get('/tickets', requireRole('support'), wrap(async (req, res) => {
  let rows = await listAll(COL.tickets);
  if (req.query.state) rows = rows.filter((t) => t.state === req.query.state);
  if (req.query.priority) rows = rows.filter((t) => t.priority === req.query.priority);
  return ok(res, rows);
}));

r.patch('/tickets/:id', requireRole('support'), wrap(async (req, res) => {
  const allowed = ['state', 'priority', 'assigneeId'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if (req.body?.reply) patch.lastReply = req.body.reply;
  const t = await patchDoc(COL.tickets, req.params.id, patch);
  if (!t) return fail(res, 404, 'NOT_FOUND', 'Ticket no encontrado');
  return ok(res, t);
}));

export default r;
