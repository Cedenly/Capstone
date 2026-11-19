// 1.1/1.2/1.3/1.4/3: perfil, ajustes, preferencias, cuota, progreso, medallas, regalos,
// notificaciones, dispositivos, suscripcion, invoices, export.
import { Router } from 'express';
import bcrypt from '../lib/password.js';
import { ok, created, fail, noContent } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { COL, get, set, add, patch, del, where, list } from '../data/repo.js';
import { TIERS, NEXT, walletProgress, award } from '../lib/medals.js';
import { quotaMax, freeQuotaMax, ensureQuotaDay, isUnlimited, BASE_QUOTA, MAX_QUOTA, resetsAt } from '../lib/quota.js';
import { effectivePlan } from '../lib/entitlements.js';
import { normalizeBillingDate, billingTime, diagnoseSubscription } from '../lib/billingIdentity.js';
import { verifyPhone } from '../lib/jwt.js';
import { findCountry, findGrade } from '../data/catalog.js';

const r = Router();
r.use(authRequired);
const save = (u) => set(COL.users, u.id, u);
// Fechas válidas de mayor a menor; las ausentes o inválidas quedan al final.
const newestBillingDate = (left, right) => {
  const a = billingTime(left), b = billingTime(right);
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
};

// GET /me
r.get('/me', wrap(async (req, res) => {
  const u = req.user; ensureQuotaDay(u); await save(u);
  return ok(res, {
        id: u.id, name: u.name, email: u.email, plan: effectivePlan(u), streak: u.streak || 0,
    quota: { used: u.quota.used, max: quotaMax(u), freeMax: freeQuotaMax(u) }, medals: u.medals,
    school: u.school || null, age: u.age || null, region: u.region || null,
    // El cliente lo usa para decidir si pide contrasena al borrar la cuenta.
    authProvider: u.authProvider || 'password',
    phone: u.phone || null, phoneVerified: !!u.phoneVerified,
    country: u.country || null, language: u.language || u.locale || 'es',
    gradeId: u.gradeId || null, onboarded: !!u.onboarded,
  });
}));

// PATCH /me/phone  (asocia un telefono verificado a la cuenta; flujo social)
r.patch('/me/phone', wrap(async (req, res) => {
  const { phoneToken } = req.body || {};
  if (!phoneToken) return fail(res, 400, 'VALIDATION_ERROR', 'phoneToken es obligatorio', { field: 'phoneToken' });
  const payload = verifyPhone(phoneToken);
  if (!payload) return fail(res, 401, 'PHONE_TOKEN_INVALID', 'El phoneToken es invalido o expiro', { field: 'phoneToken' });
  const taken = await where(COL.users, (x) => x.phone === payload.sub && x.id !== req.user.id);
  if (taken.length) return fail(res, 409, 'PHONE_ALREADY_IN_USE', 'Ya existe una cuenta con ese telefono');
  const u = req.user;
  u.phone = payload.sub;
  u.phoneVerified = true;
  u.firebaseUid = payload.firebaseUid || u.firebaseUid || null;
  if (!u.country && payload.country) u.country = payload.country;
  if (!u.language && payload.language) { u.language = payload.language; u.locale = payload.language; }
  await save(u);
  return ok(res, { phone: u.phone, phoneVerified: true, country: u.country || null, language: u.language || u.locale });
}));

// PATCH /me
r.patch('/me', wrap(async (req, res) => {
  const { name, school, age, region } = req.body || {};
  const u = req.user;
  if (name != null) u.name = name;
  if (school != null) u.school = school;
  if (age != null) u.age = age;
  if (region != null) u.region = region;
  await save(u);
  return ok(res, { id: u.id, name: u.name, school: u.school, age: u.age, region: u.region });
}));

// DELETE /me
r.delete('/me', wrap(async (req, res) => {
  const u = req.user;
  if (u.authProvider === 'password') {
    const { password } = req.body || {};
    if (!password || !bcrypt.compareSync(password, u.passwordHash || '')) {
      return fail(res, 401, 'AUTH_INVALID_CREDENTIALS', 'La contrasena de confirmacion es incorrecta');
    }
  }
  await del(COL.users, u.id);
  return noContent(res);
}));

// GET /me/settings
r.get('/me/settings', wrap(async (req, res) => {
  const u = req.user;
  return ok(res, {
    locale: u.locale || 'es', theme: u.theme || 'light', dailyReminder: u.dailyReminder !== false,
    selectedTests: u.selectedTests || [], format: u.format || 'random', difficulty: u.difficulty || 'd2',
  });
}));

// PATCH /me/settings
r.patch('/me/settings', wrap(async (req, res) => {
  const { locale, theme, dailyReminder } = req.body || {};
  const u = req.user;
  if (locale && !['es', 'en'].includes(locale)) return fail(res, 400, 'VALIDATION_ERROR', 'locale invalido');
  if (theme && !['light', 'dark'].includes(theme)) return fail(res, 400, 'VALIDATION_ERROR', 'theme invalido');
  if (locale) u.locale = locale;
  if (theme) u.theme = theme;
  if (dailyReminder != null) u.dailyReminder = !!dailyReminder;
  await save(u);
  return ok(res, { locale: u.locale, theme: u.theme, dailyReminder: u.dailyReminder });
}));

const prefsOf = (u) => ({
  country: u.country || null,
  language: u.language || u.locale || 'es',
  gradeId: u.gradeId || null,
  selectedTests: u.selectedTests || [],
  format: u.format || 'random',
  difficulty: u.difficulty || 'd2',
  onboarded: !!u.onboarded,
});

// GET /me/preferences
r.get('/me/preferences', wrap(async (req, res) => ok(res, prefsOf(req.user))));

// PUT /me/preferences
// Guarda pais, idioma y grado del onboarding (pantallas confirm-locale /
// select-grade / select-tests). format y difficulty son opcionales: el wireframe
// los fija en un paso posterior.
r.put('/me/preferences', wrap(async (req, res) => {
  const { selectedTests, format, difficulty, country, language, gradeId } = req.body || {};
  if (!Array.isArray(selectedTests) || selectedTests.length === 0) return fail(res, 400, 'NO_TESTS_SELECTED', 'Debe seleccionarse al menos una prueba');
  if (country != null && !findCountry(country)) return fail(res, 400, 'VALIDATION_ERROR', 'country invalido', { field: 'country' });
  if (language != null && !['es', 'en'].includes(language)) return fail(res, 400, 'VALIDATION_ERROR', 'language invalido', { field: 'language' });
  if (gradeId != null) {
    const grade = findGrade(gradeId);
    if (!grade) return fail(res, 400, 'INVALID_GRADE', 'El grado indicado no existe', { field: 'gradeId' });
    const targetCountry = (country || req.user.country || grade.country).toUpperCase();
    if (grade.country !== targetCountry) return fail(res, 422, 'GRADE_COUNTRY_MISMATCH', 'El grado no pertenece al pais seleccionado', { field: 'gradeId' });
  }
  if (format != null && !['random', 'facsim'].includes(format)) return fail(res, 400, 'VALIDATION_ERROR', 'format invalido');
  if (difficulty != null && !['d1', 'd2', 'd3', 'd4'].includes(difficulty)) return fail(res, 400, 'VALIDATION_ERROR', 'difficulty invalido');
    if (format === 'facsim' && effectivePlan(req.user) === 'free') return fail(res, 422, 'FORMAT_REQUIRES_PLAN', 'El formato facsimil requiere un plan de pago');
  const u = req.user;
  u.selectedTests = selectedTests;
  if (country != null) u.country = String(country).toUpperCase();
  if (language != null) { u.language = language; u.locale = language; }
  if (gradeId != null) u.gradeId = gradeId;
  if (format != null) u.format = format;
  if (difficulty != null) u.difficulty = difficulty;
  u.onboarded = true;
  await save(u);
  return ok(res, prefsOf(u));
}));

// GET /me/quota
r.get('/me/quota', wrap(async (req, res) => {
  const u = req.user; ensureQuotaDay(u); await save(u);
  return ok(res, {
    used: u.quota.used, max: quotaMax(u), freeMax: freeQuotaMax(u), base: BASE_QUOTA,
    bonuses: u.bonuses || { school: false, address: false }, unlimited: isUnlimited(u),
    unlimitedTestId: effectivePlan(u) === 'uni'
      ? (u.billingProvider === 'stripe' ? u.billingTestId : (u.billingTestId || u.selectedTests?.[0])) || null
      : null,
    resetsAt: resetsAt(),
  });
}));

// POST /me/quota/unlock
r.post('/me/quota/unlock', wrap(async (req, res) => {
  const { type, school, region, age } = req.body || {};
  if (!['school', 'address'].includes(type)) return fail(res, 400, 'VALIDATION_ERROR', 'type invalido');
  const u = req.user; u.bonuses = u.bonuses || { school: false, address: false };
  if (u.bonuses[type === 'school' ? 'school' : 'address']) return fail(res, 409, 'BONUS_ALREADY_CLAIMED', 'Esta bonificacion ya fue reclamada');
  if (effectivePlan(u) === 'all' || freeQuotaMax(u) >= MAX_QUOTA) return fail(res, 422, 'QUOTA_MAX_REACHED', 'La cuota ya esta en su maximo');
  if (type === 'school') { if (!school) return fail(res, 400, 'VALIDATION_ERROR', 'school requerido'); u.school = school; u.bonuses.school = true; }
  else { if (!region) return fail(res, 400, 'VALIDATION_ERROR', 'region requerida'); u.region = region; u.bonuses.address = true; }
  if (age != null) u.age = age;
  award(u.medals, 'bronze', 1);
  await save(u);
  await add(COL.medalLedger, { userId: u.id, tier: 'bronze', amount: 1, reason: 'quota_unlock', createdAt: new Date().toISOString() }, 'mdl');
  return ok(res, { used: u.quota.used, max: quotaMax(u), freeMax: freeQuotaMax(u), bonuses: u.bonuses });
}));

// GET /me/progress
r.get('/me/progress', wrap(async (req, res) => {
  const u = req.user;
  const answers = await where(COL.answers, (a) => a.userId === u.id);
  const tests = await list(COL.tests);
  const byTest = {};
  for (const a of answers) {
    byTest[a.testId] ||= { total: 0, correct: 0 };
    byTest[a.testId].total++; if (a.correct) byTest[a.testId].correct++;
  }
  const selected = u.selectedTests?.length ? u.selectedTests : tests.map((t) => t.id);
  const data = selected.map((id) => {
    const t = tests.find((x) => x.id === id);
    const s = byTest[id];
    const percent = s ? Math.round((s.correct / s.total) * 100) : (u.progressSeed?.[id] ?? 0);
    return { testId: id, label: t?.label || id, percent };
  });
  return ok(res, data);
}));

// GET /me/medals
r.get('/me/medals', wrap(async (req, res) => {
  return ok(res, { wallet: req.user.medals, progress: walletProgress(req.user.medals) });
}));

// POST /me/medals/exchange
r.post('/me/medals/exchange', wrap(async (req, res) => {
  const { from, quantity } = req.body || {};
  if (!NEXT[from]) return fail(res, 400, 'INVALID_TIER', 'El nivel de origen no admite canje');
  const qty = quantity || 5;
  if (qty % 5 !== 0 || qty <= 0) return fail(res, 400, 'VALIDATION_ERROR', 'quantity debe ser multiplo de 5');
  const u = req.user;
  if ((u.medals[from] || 0) < qty) return fail(res, 422, 'INSUFFICIENT_MEDALS', 'No tienes suficientes medallas para canjear');
  const to = NEXT[from]; const gained = qty / 5;
  u.medals[from] -= qty; u.medals[to] = (u.medals[to] || 0) + gained;
  await save(u);
  await add(COL.medalLedger, { userId: u.id, tier: to, amount: gained, reason: `exchange_${from}`, createdAt: new Date().toISOString() }, 'mdl');
  return ok(res, { wallet: u.medals, exchanged: { from, to, amount: gained } });
}));

// GET /me/gifts
r.get('/me/gifts', wrap(async (req, res) => {
  const u = req.user;
  const today = new Date().toISOString().slice(0, 10);
  const used = u.giftDay === today ? (u.giftUsed || 0) : 0;
  // amigos: miembros de grupos compartidos
  const myGroups = (await where(COL.groupMembers, (m) => m.userId === u.id)).map((m) => m.groupId);
  const friends = [];
  const seen = new Set();
  for (const gid of myGroups) {
    const members = await where(COL.groupMembers, (m) => m.groupId === gid && m.userId !== u.id);
    for (const m of members) {
      if (seen.has(m.userId)) continue; seen.add(m.userId);
      friends.push({ userId: m.userId, name: m.name, giftedToday: 0 });
    }
  }
  return ok(res, { daily: { used, max: 10 }, bronzeAvailable: u.medals.bronze, friends });
}));

// POST /me/gifts
r.post('/me/gifts', wrap(async (req, res) => {
  const { recipients } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0) return fail(res, 400, 'VALIDATION_ERROR', 'recipients es obligatorio');
  const u = req.user;
  const today = new Date().toISOString().slice(0, 10);
  if (u.giftDay !== today) { u.giftDay = today; u.giftUsed = 0; }
  const total = recipients.reduce((s, x) => s + (x.amount || 0), 0);
  if (u.giftUsed + total > 10) return fail(res, 422, 'DAILY_GIFT_LIMIT', 'Se supero el limite de 10 regalos diarios');
  if ((u.medals.bronze || 0) < total) return fail(res, 422, 'INSUFFICIENT_MEDALS', 'No tienes suficientes bronces');
  // validar grupo compartido
  const myGroups = new Set((await where(COL.groupMembers, (m) => m.userId === u.id)).map((m) => m.groupId));
  for (const rcp of recipients) {
    const shares = await where(COL.groupMembers, (m) => m.userId === rcp.userId && myGroups.has(m.groupId));
    if (shares.length === 0) return fail(res, 403, 'NOT_IN_SHARED_GROUP', 'El destinatario no comparte ningun grupo contigo');
  }
  for (const rcp of recipients) {
    u.medals.bronze -= rcp.amount;
    const target = await get(COL.users, rcp.userId);
    if (target) { target.medals = target.medals || {}; target.medals.bronze = (target.medals.bronze || 0) + rcp.amount; await set(COL.users, target.id, target); }
  }
  u.giftUsed += total;
  await save(u);
  return ok(res, { gifted: total, daily: { used: u.giftUsed, max: 10 }, bronzeAvailable: u.medals.bronze });
}));

// GET /me/notifications
r.get('/me/notifications', wrap(async (req, res) => {
  const onlyUnread = req.query.unread === 'true';
  let items = await where(COL.notifications, (n) => n.userId === req.user.id);
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const unreadCount = items.filter((n) => !n.read).length;
  if (onlyUnread) items = items.filter((n) => !n.read);
  return ok(res, items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, read: !!n.read, createdAt: n.createdAt })), 200, { unreadCount });
}));

// PATCH /me/notifications/:id/read
r.patch('/me/notifications/:id/read', wrap(async (req, res) => {
  const n = await get(COL.notifications, req.params.id);
  if (!n || n.userId !== req.user.id) return fail(res, 404, 'NOT_FOUND', 'La notificacion no existe');
  await patch(COL.notifications, n.id, { read: true });
  return ok(res, { id: n.id, read: true });
}));

// POST /me/notifications/read-all
r.post('/me/notifications/read-all', wrap(async (req, res) => {
  const items = await where(COL.notifications, (n) => n.userId === req.user.id && !n.read);
  for (const n of items) await patch(COL.notifications, n.id, { read: true });
  return ok(res, { marked: items.length, unreadCount: 0 });
}));

// PUT /me/notifications/preferences
r.put('/me/notifications/preferences', wrap(async (req, res) => {
  const { dailyReminder, reminderTime, channels } = req.body || {};
  if (dailyReminder == null) return fail(res, 400, 'VALIDATION_ERROR', 'dailyReminder es obligatorio');
  const u = req.user;
  u.dailyReminder = !!dailyReminder; u.reminderTime = reminderTime || u.reminderTime || '19:00';
  if (channels) u.notifChannels = channels;
  await save(u);
  return ok(res, { dailyReminder: u.dailyReminder, reminderTime: u.reminderTime });
}));

// POST /devices
r.post('/devices', wrap(async (req, res) => {
  const { platform, pushToken, deviceId } = req.body || {};
  if (!platform || !pushToken) return fail(res, 400, 'VALIDATION_ERROR', 'platform y pushToken son obligatorios');
  const id = deviceId || `dev_${Math.random().toString(36).slice(2, 8)}`;
  await set(COL.devices, id, { id, userId: req.user.id, platform, pushToken, createdAt: new Date().toISOString() });
  return created(res, { id, platform, registered: true });
}));

// DELETE /devices/:id
r.delete('/devices/:id', wrap(async (req, res) => {
  const d = await get(COL.devices, req.params.id);
  if (!d || d.userId !== req.user.id) return fail(res, 404, 'NOT_FOUND', 'Dispositivo no encontrado');
  await del(COL.devices, d.id);
  return noContent(res);
}));

// GET /me/subscription
r.get('/me/subscription', wrap(async (req, res) => {
  const sub = await where(COL.subscriptions, (s) => s.userId === req.user.id && s.status !== 'canceled');
  const s = sub.sort((a, b) => newestBillingDate(a.createdAt, b.createdAt))[0];
  if (!s) return ok(res, null);
  return ok(res, {
    id: s.id, plan: s.plan, billingCycle: s.billingCycle, status: s.status,
    currentPeriodEnd: normalizeBillingDate(s.currentPeriodEnd), cancelAtPeriodEnd: !!s.cancelAtPeriodEnd,
    paymentMethod: s.paymentMethod || null,
    billingIdentity: diagnoseSubscription({
      userId: req.user.id, user: req.user, subscriptionId: s.id, subscription: s,
    }),
  });
}));

// POST /me/subscription/change
// Los cambios de plan se gestionan en Stripe y los confirma el webhook.
r.post('/me/subscription/change', (_req, res) => {
  return fail(
    res,
    410,
    'DEMO_SUBSCRIPTION_CHANGE_DISABLED',
    'El cambio de plan simulado fue deshabilitado. Gestiona tu suscripción en Stripe desde Mi plan.'
  );
});

// POST /me/subscription/cancel
// La cancelación se gestiona en Stripe y la confirma el webhook.
r.post('/me/subscription/cancel', (_req, res) => {
  return fail(
    res,
    410,
    'DEMO_SUBSCRIPTION_CANCEL_DISABLED',
    'La cancelación simulada fue deshabilitada. Gestiona tu suscripción en Stripe desde Mi plan.'
  );
});

// GET /me/invoices
r.get('/me/invoices', wrap(async (req, res) => {
  const items = (await where(COL.invoices, (i) => i.userId === req.user.id)).sort((a, b) => newestBillingDate(a.paidAt, b.paidAt));
  return ok(res, items.map((i) => ({ id: i.id, amount: i.amount, currency: i.currency, status: i.status, paidAt: normalizeBillingDate(i.paidAt), pdfUrl: i.pdfUrl })));
}));

// GET /me/data-export
r.get('/me/data-export', wrap(async (_req, res) => {
  return ok(res, { exportId: `exp_${Math.random().toString(36).slice(2, 6)}`, status: 'processing' }, 202);
}));

export default r;
