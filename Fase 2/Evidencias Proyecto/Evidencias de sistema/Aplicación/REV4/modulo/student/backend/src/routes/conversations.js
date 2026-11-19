// 1.8 Chat con tutores (pantalla tutor-chat). Transporte REST + polling:
// el cliente refresca /conversations/:id/messages y usa `unreadCount` de
// /me/conversations para el badge. El telefono solo se revela si ambas partes
// aceptan compartirlo (consentimiento mutuo del wireframe).
import { Router } from 'express';
import { ok, created, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { premiumRequired } from '../middleware/premium.js';
import { COL, get, add, where, patch } from '../data/repo.js';
import { paginate } from '../lib/paginate.js';

const r = Router();
r.use(authRequired);

async function myConversation(id, userId) {
  const c = await get(COL.conversations, id);
  if (!c || c.userId !== userId) return null;
  return c;
}

function sharingState(conversation, user, tutor) {
  const sharing = conversation.contactSharing || { user: false, tutor: false };
  const mutual = !!sharing.user && !!sharing.tutor;
  return {
    myConsent: !!sharing.user,
    tutorConsent: !!sharing.tutor,
    mutual,
    // Solo con consentimiento mutuo se entregan los contactos.
    revealed: mutual
      ? { tutorWhatsapp: tutor?.contact?.whatsapp || null, myWhatsapp: user.phone || null }
      : null,
  };
}

const publicMessage = (m, userId) => ({
  id: m.id,
  text: m.text,
  mine: m.senderType === 'user' && m.senderId === userId,
  senderType: m.senderType,
  createdAt: m.createdAt,
});

// GET /me/conversations
r.get('/me/conversations', wrap(async (req, res) => {
  const items = (await where(COL.conversations, (c) => c.userId === req.user.id))
    .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
  // El listado tambien informa `online` para que el cliente pinte el punto verde.
  const online = new Map();
  for (const c of items) {
    if (online.has(c.tutorId)) continue;
    const tutor = await get(COL.tutors, c.tutorId);
    online.set(c.tutorId, !!tutor?.online);
  }
  const data = items.map((c) => ({
    id: c.id,
    tutor: {
      id: c.tutorId, name: c.tutorName, initials: c.tutorInitials,
      avatarColor: c.tutorColor, online: online.get(c.tutorId) === true,
    },
    lastMessagePreview: c.lastMessagePreview || '',
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadForUser || 0,
    lessonsTaken: c.lessonsTaken || 0,
    contactShared: !!(c.contactSharing?.user && c.contactSharing?.tutor),
  }));
  return ok(res, data, 200, { unreadTotal: data.reduce((s, c) => s + c.unreadCount, 0) });
}));

// GET /conversations/:id
r.get('/conversations/:id', wrap(async (req, res) => {
  const c = await myConversation(req.params.id, req.user.id);
  if (!c) return fail(res, 404, 'NOT_FOUND', 'La conversacion no existe');
  const tutor = await get(COL.tutors, c.tutorId);
  const request = c.requestId ? await get(COL.tutorRequests, c.requestId) : null;
  return ok(res, {
    id: c.id,
    tutor: { id: c.tutorId, name: c.tutorName, initials: c.tutorInitials, avatarColor: c.tutorColor, online: !!tutor?.online },
    lessonsTaken: c.lessonsTaken || 0,
    unreadCount: c.unreadForUser || 0,
    contactSharing: sharingState(c, req.user, tutor),
    sharedProfile: request?.sharedProfile || null,
    createdAt: c.createdAt,
  });
}));

// GET /conversations/:id/messages?cursor=&limit=
// Devuelve del mas reciente al mas antiguo y marca como leidos los del tutor.
r.get('/conversations/:id/messages', wrap(async (req, res) => {
  const c = await myConversation(req.params.id, req.user.id);
  if (!c) return fail(res, 404, 'NOT_FOUND', 'La conversacion no existe');
  const all = (await where(COL.messages, (m) => m.conversationId === c.id))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const { page, pagination } = paginate(all, req.query, 30, 100);

  if (req.query.markRead !== 'false') {
    const marked = new Set();
    for (const m of page) {
      if (m.senderType === 'tutor' && !m.readByUser) { await patch(COL.messages, m.id, { readByUser: true }); marked.add(m.id); }
    }
    // El badge se recalcula sobre lo que sigue sin leer fuera de esta pagina.
    const stillUnread = all.filter((m) => m.senderType === 'tutor' && !m.readByUser && !marked.has(m.id)).length;
    if ((c.unreadForUser || 0) !== stillUnread) await patch(COL.conversations, c.id, { unreadForUser: stillUnread });
  }
  return ok(res, page.map((m) => publicMessage(m, req.user.id)), 200, { pagination });
}));

// POST /conversations/:id/messages  (Premium, igual que contactar al tutor)
r.post('/conversations/:id/messages', premiumRequired, wrap(async (req, res) => {
  const c = await myConversation(req.params.id, req.user.id);
  if (!c) return fail(res, 404, 'NOT_FOUND', 'La conversacion no existe');
  const text = String(req.body?.text || '').trim();
  if (!text) return fail(res, 400, 'VALIDATION_ERROR', 'text es obligatorio', { field: 'text' });
  if (text.length > 2000) return fail(res, 400, 'VALIDATION_ERROR', 'text supera los 2000 caracteres', { field: 'text' });
  const now = new Date().toISOString();
  const m = await add(COL.messages, {
    conversationId: c.id, senderType: 'user', senderId: req.user.id,
    text, readByUser: true, readByTutor: false, createdAt: now,
  }, 'msg');
  await patch(COL.conversations, c.id, {
    lastMessageAt: now, lastMessagePreview: text.slice(0, 120),
    unreadForTutor: (c.unreadForTutor || 0) + 1,
  });
  return created(res, publicMessage(m, req.user.id));
}));

// POST /conversations/:id/read
r.post('/conversations/:id/read', wrap(async (req, res) => {
  const c = await myConversation(req.params.id, req.user.id);
  if (!c) return fail(res, 404, 'NOT_FOUND', 'La conversacion no existe');
  const pending = await where(COL.messages, (m) => m.conversationId === c.id && m.senderType === 'tutor' && !m.readByUser);
  for (const m of pending) await patch(COL.messages, m.id, { readByUser: true });
  await patch(COL.conversations, c.id, { unreadForUser: 0 });
  return ok(res, { marked: pending.length, unreadCount: 0 });
}));

// PATCH /conversations/:id/contact-sharing  (Premium)
r.patch('/conversations/:id/contact-sharing', premiumRequired, wrap(async (req, res) => {
  const c = await myConversation(req.params.id, req.user.id);
  if (!c) return fail(res, 404, 'NOT_FOUND', 'La conversacion no existe');
  const { shareWhatsapp } = req.body || {};
  if (typeof shareWhatsapp !== 'boolean') return fail(res, 400, 'VALIDATION_ERROR', 'shareWhatsapp debe ser booleano', { field: 'shareWhatsapp' });
  if (shareWhatsapp && !(req.user.phone && req.user.phoneVerified)) {
    return fail(res, 422, 'PHONE_REQUIRED', 'Necesitas un telefono verificado para compartir tu contacto');
  }
  const contactSharing = { ...(c.contactSharing || { user: false, tutor: false }), user: shareWhatsapp };
  await patch(COL.conversations, c.id, { contactSharing });
  const tutor = await get(COL.tutors, c.tutorId);
  return ok(res, sharingState({ ...c, contactSharing }, req.user, tutor));
}));

export default r;
