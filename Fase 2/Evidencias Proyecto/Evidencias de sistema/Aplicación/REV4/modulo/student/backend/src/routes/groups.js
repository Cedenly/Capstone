// 1.5 Grupos de estudio
import { Router } from 'express';
import { ok, created, fail, noContent } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { COL, get, set, add, del, where, list, genId } from '../data/repo.js';

const r = Router();
r.use(authRequired);

async function subjectLabel(testId) {
  const t = await get(COL.tests, testId);
  return t?.label || testId;
}
async function isMember(groupId, userId) {
  const m = await where(COL.groupMembers, (x) => x.groupId === groupId && x.userId === userId);
  return m[0] || null;
}

// GET /groups
r.get('/groups', wrap(async (req, res) => {
  const myMemberships = await where(COL.groupMembers, (m) => m.userId === req.user.id);
  const out = [];
  for (const mem of myMemberships) {
    const g = await get(COL.groups, mem.groupId);
    if (!g) continue;
    const members = await where(COL.groupMembers, (m) => m.groupId === g.id);
    const avg = members.length ? Math.round(members.reduce((s, m) => s + (m.score || 0), 0) / members.length) : 0;
    out.push({ id: g.id, name: g.name, subject: g.subject, memberCount: members.length, avgScore: avg, yourScore: mem.score || 0 });
  }
  return ok(res, out);
}));

// POST /groups
r.post('/groups', wrap(async (req, res) => {
  const { name, subjectTestId } = req.body || {};
  if (!name) return fail(res, 400, 'GROUP_NAME_REQUIRED', 'El nombre del grupo es obligatorio');
  if (!subjectTestId) return fail(res, 400, 'VALIDATION_ERROR', 'subjectTestId es obligatorio');
  const subject = await subjectLabel(subjectTestId);
  const g = await add(COL.groups, { name, subjectTestId, subject, ownerId: req.user.id, createdAt: new Date().toISOString() }, 'grp');
  await add(COL.groupMembers, { groupId: g.id, userId: req.user.id, name: req.user.name, role: 'owner', score: 0, activeToday: true }, 'gm');
  return created(res, { id: g.id, name: g.name, subject: g.subject, memberCount: 1 });
}));

// GET /groups/:id
r.get('/groups/:id', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  if (!(await isMember(g.id, req.user.id))) return fail(res, 403, 'NOT_GROUP_MEMBER', 'No perteneces a este grupo');
  const members = await where(COL.groupMembers, (m) => m.groupId === g.id);
  return ok(res, {
    id: g.id, name: g.name, subject: g.subject, ownerId: g.ownerId,
    members: members.map((m) => ({ userId: m.userId, name: m.name, score: m.score || 0, activeToday: !!m.activeToday, role: m.role })),
  });
}));

// PATCH /groups/:id  (owner)
r.patch('/groups/:id', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  if (g.ownerId !== req.user.id) return fail(res, 403, 'AUTH_FORBIDDEN', 'Solo el owner puede editar');
  const { name, subjectTestId } = req.body || {};
  if (name) g.name = name;
  if (subjectTestId) { g.subjectTestId = subjectTestId; g.subject = await subjectLabel(subjectTestId); }
  await set(COL.groups, g.id, g);
  return ok(res, { id: g.id, name: g.name, subject: g.subject });
}));

// DELETE /groups/:id  (owner)
r.delete('/groups/:id', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  if (g.ownerId !== req.user.id) return fail(res, 403, 'AUTH_FORBIDDEN', 'Solo el owner puede eliminar');
  for (const m of await where(COL.groupMembers, (x) => x.groupId === g.id)) await del(COL.groupMembers, m.id);
  await del(COL.groups, g.id);
  return noContent(res);
}));

// POST /groups/:id/invitations
r.post('/groups/:id/invitations', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  if (!(await isMember(g.id, req.user.id))) return fail(res, 403, 'NOT_GROUP_MEMBER', 'No perteneces a este grupo');
  const { email } = req.body || {};
  if (!email) return fail(res, 400, 'VALIDATION_ERROR', 'email es obligatorio');
  const target = await where(COL.users, () => false); // placeholder
  const existingMember = (await where(COL.groupMembers, (m) => m.groupId === g.id)).find((m) => m.email === email);
  if (existingMember) return fail(res, 409, 'ALREADY_MEMBER', 'Ese usuario ya es miembro del grupo');
  const pending = await where(COL.groupInvitations, (i) => i.groupId === g.id && i.email === email && i.status === 'pending');
  if (pending.length) return fail(res, 409, 'ALREADY_INVITED', 'Ese correo ya tiene una invitacion pendiente');
  const token = genId('inv');
  const inv = await add(COL.groupInvitations, { groupId: g.id, email, status: 'pending', token, createdAt: new Date().toISOString() }, 'inv');
  console.log(`[demo] invitacion a ${email} para grupo ${g.name}: token=${token}`);
  return created(res, { id: inv.id, email, status: 'pending', token });
}));

// GET /groups/:id/invitations
r.get('/groups/:id/invitations', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  const items = await where(COL.groupInvitations, (i) => i.groupId === g.id && i.status === 'pending');
  return ok(res, items.map((i) => ({ id: i.id, email: i.email, status: i.status })));
}));

// POST /invitations/:token/accept
r.post('/invitations/:token/accept', wrap(async (req, res) => {
  const inv = (await where(COL.groupInvitations, (i) => i.token === req.params.token && i.status === 'pending'))[0];
  if (!inv) return fail(res, 400, 'INVITATION_INVALID', 'La invitacion es invalida o expiro');
  if (await isMember(inv.groupId, req.user.id)) return fail(res, 409, 'ALREADY_MEMBER', 'Ya eres miembro del grupo');
  await add(COL.groupMembers, { groupId: inv.groupId, userId: req.user.id, name: req.user.name, email: req.user.email, role: 'member', score: 0, activeToday: true }, 'gm');
  inv.status = 'accepted'; await set(COL.groupInvitations, inv.id, inv);
  return ok(res, { groupId: inv.groupId, joined: true });
}));

// DELETE /groups/:id/members/me  (salir del grupo)
// Si el dueno se va, la propiedad pasa al miembro mas antiguo; si no queda
// nadie, el grupo y sus datos se eliminan.
r.delete('/groups/:id/members/me', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  const m = await isMember(g.id, req.user.id);
  if (!m) return fail(res, 404, 'NOT_GROUP_MEMBER', 'No perteneces a este grupo');
  await del(COL.groupMembers, m.id);
  const remaining = await where(COL.groupMembers, (x) => x.groupId === g.id);
  if (!remaining.length) {
    for (const s of await where(COL.groupShared, (x) => x.groupId === g.id)) await del(COL.groupShared, s.id);
    for (const i of await where(COL.groupInvitations, (x) => x.groupId === g.id)) await del(COL.groupInvitations, i.id);
    await del(COL.groups, g.id);
    return noContent(res);
  }
  if (g.ownerId === req.user.id) {
    const heir = remaining[0];
    await set(COL.groups, g.id, { ...g, ownerId: heir.userId });
    await set(COL.groupMembers, heir.id, { ...heir, role: 'owner' });
  }
  return noContent(res);
}));

// DELETE /groups/:id/members/:userId
r.delete('/groups/:id/members/:userId', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  const isOwner = g.ownerId === req.user.id;
  const isSelf = req.params.userId === req.user.id;
  if (!isOwner && !isSelf) return fail(res, 403, 'AUTH_FORBIDDEN', 'No autorizado');
  const m = await isMember(g.id, req.params.userId);
  if (!m) return fail(res, 404, 'NOT_FOUND', 'El miembro no existe');
  await del(COL.groupMembers, m.id);
  return noContent(res);
}));

// GET /groups/:id/stats
r.get('/groups/:id/stats', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  if (!(await isMember(g.id, req.user.id))) return fail(res, 403, 'NOT_GROUP_MEMBER', 'No perteneces a este grupo');
  const members = await where(COL.groupMembers, (m) => m.groupId === g.id);
  const avg = members.length ? Math.round(members.reduce((s, m) => s + (m.score || 0), 0) / members.length) : 0;
  return ok(res, {
    avgScore: avg, memberCount: members.length,
    best: g.statsBest || [{ area: 'Lectura', avg: 80 }, { area: 'Algebra', avg: 72 }],
    weak: g.statsWeak || [{ area: 'Calculo', avg: 44 }, { area: 'Estadistica', avg: 58 }],
  });
}));

// GET /groups/:id/shared
r.get('/groups/:id/shared', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  if (!(await isMember(g.id, req.user.id))) return fail(res, 403, 'NOT_GROUP_MEMBER', 'No perteneces a este grupo');
  const items = (await where(COL.groupShared, (s) => s.groupId === g.id)).sort((a, b) => (b.sharedAt || '').localeCompare(a.sharedAt || ''));
  return ok(res, items.map((s) => ({ id: s.id, questionId: s.questionId, sharedBy: s.sharedBy, result: s.result, elapsed: s.elapsed, comment: s.comment, sharedAt: s.sharedAt })));
}));

// POST /groups/:id/shared
r.post('/groups/:id/shared', wrap(async (req, res) => {
  const g = await get(COL.groups, req.params.id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'El grupo no existe');
  if (!(await isMember(g.id, req.user.id))) return fail(res, 403, 'NOT_GROUP_MEMBER', 'No perteneces a este grupo');
  const { questionId, answerId, comment } = req.body || {};
  if (!questionId) return fail(res, 400, 'VALIDATION_ERROR', 'questionId es obligatorio');
  const s = await add(COL.groupShared, {
    groupId: g.id, questionId, answerId: answerId || null, comment: comment || '',
    sharedBy: req.user.name, result: 'correct', elapsed: '0:18', sharedAt: new Date().toISOString(),
  }, 'shr');
  return created(res, { id: s.id, questionId, groupId: g.id });
}));

export default r;
