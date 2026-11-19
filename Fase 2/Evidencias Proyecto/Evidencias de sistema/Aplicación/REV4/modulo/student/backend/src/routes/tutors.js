// 1.7 Marketplace de tutores (pantallas tutors, tutor-profile, tutor-reviews,
// tutor-contact, tutor-review y tutor-analysis del wireframe).
// Los tutores se administran desde la consola admin (/admin/tutors); aqui el
// alumno solo lee, resena, contacta y consulta su analisis de falencias.
import { Router } from 'express';
import { ok, created, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { premiumRequired } from '../middleware/premium.js';
import { COL, get, set, add, where, list, findOne } from '../data/repo.js';
import { paginate } from '../lib/paginate.js';
import { buildGapAnalysis, weakAreaNames } from '../lib/gap.js';
import { findGrade, loc } from '../data/catalog.js';
import { effectivePlan } from '../lib/entitlements.js';
import {
  MODES, aggregateRatings, criteriaLabels, tutorCard, tutorProfile,
  publicReview, validateReviewRatings, overallOf,
} from '../lib/tutors.js';

const r = Router();
r.use(authRequired);

const langOf = (req) => (String(req.query.lang || req.user?.language || req.user?.locale || 'es') === 'en' ? 'en' : 'es');
const isActive = (t) => (t.status || 'active') === 'active';

async function activeTutors() {
  return (await list(COL.tutors)).filter(isActive);
}
const byDateDesc = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '');
async function reviewsOf(tutorId) {
  return (await where(COL.tutorReviews, (x) => x.tutorId === tutorId)).sort(byDateDesc);
}
// Una sola lectura de resenas agrupada por tutor (evita N+1 en los listados).
async function reviewsByTutor() {
  const grouped = new Map();
  for (const rv of await list(COL.tutorReviews)) {
    if (!grouped.has(rv.tutorId)) grouped.set(rv.tutorId, []);
    grouped.get(rv.tutorId).push(rv);
  }
  for (const arr of grouped.values()) arr.sort(byDateDesc);
  return grouped;
}
async function ratingsOf(tutor) {
  return aggregateRatings(tutor, await reviewsOf(tutor.id));
}

// Perfil del alumno que se comparte al contactar (pantalla tutor-contact).
async function shareableProfile(user, lang) {
  const [answers, tests, questions, tutors] = await Promise.all([
    where(COL.answers, (a) => a.userId === user.id),
    list(COL.tests),
    list(COL.questions),
    activeTutors(),
  ]);
  const analysis = buildGapAnalysis(user, { answers, tests, questions, tutors, lang });
  const grade = user.gradeId ? findGrade(user.gradeId) : null;
  return {
    name: user.name,
    initials: (user.name || 'AL').slice(0, 2).toUpperCase(),
    gradeId: user.gradeId || null,
    gradeLabel: grade ? loc(grade.label, lang) : null,
    country: user.country || null,
    goal: user.goal || null,
    selectedTests: user.selectedTests || [],
    weakAreas: weakAreaNames(analysis),
  };
}

// ── GET /tutors ─────────────────────────────────────────────────────────────
// q, subject, mode, verified, featured, sort=rating|price_asc|price_desc|experience
r.get('/tutors', wrap(async (req, res) => {
  const lang = langOf(req);
  const { q, subject, mode, verified, featured, sort } = req.query;
  if (mode && !MODES.includes(mode)) return fail(res, 400, 'VALIDATION_ERROR', `mode debe ser uno de ${MODES.join(', ')}`, { field: 'mode' });

  const needle = String(q || '').trim().toLowerCase();
  let items = await activeTutors();
  if (needle) {
    items = items.filter((t) => {
      const haystack = [t.name, loc(t.subjectsLabel, lang), ...(t.subjects || [])].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }
  if (subject) items = items.filter((t) => (t.subjects || []).includes(subject));
  if (mode) items = items.filter((t) => (t.modes || []).includes(mode));
  if (verified === 'true') items = items.filter((t) => t.verified);
  if (featured === 'true') items = items.filter((t) => t.featured);

  const grouped = await reviewsByTutor();
  const withRatings = items.map((t) => ({ tutor: t, ratings: aggregateRatings(t, grouped.get(t.id) || []) }));

  const sorters = {
    rating: (a, b) => b.ratings.overall - a.ratings.overall || b.ratings.reviewCount - a.ratings.reviewCount,
    price_asc: (a, b) => (a.tutor.pricePerHour || 0) - (b.tutor.pricePerHour || 0),
    price_desc: (a, b) => (b.tutor.pricePerHour || 0) - (a.tutor.pricePerHour || 0),
    experience: (a, b) => (b.tutor.yearsExperience || 0) - (a.tutor.yearsExperience || 0),
  };
  withRatings.sort(sorters[sort] || sorters.rating);

  const { page, pagination } = paginate(withRatings, req.query);
  return ok(res, page.map((x) => tutorCard(x.tutor, x.ratings, lang)), 200, {
    pagination,
    filters: { subject: subject || null, mode: mode || null, verified: verified === 'true', q: q || null },
    // El wireframe bloquea contacto y analisis para el plan free.
    premium: { contactTutors: effectivePlan(req.user) !== 'free', gapAnalysis: effectivePlan(req.user) !== 'free' },
  });
}));

// ── GET /tutors/featured ────────────────────────────────────────────────────
r.get('/tutors/featured', wrap(async (req, res) => {
  const lang = langOf(req);
  const items = (await activeTutors()).filter((t) => t.featured);
  const grouped = await reviewsByTutor();
  const out = items
    .map((t) => tutorCard(t, aggregateRatings(t, grouped.get(t.id) || []), lang))
    .sort((a, b) => b.rating - a.rating);
  return ok(res, out);
}));

// ── GET /tutors/:id ─────────────────────────────────────────────────────────
r.get('/tutors/:id', wrap(async (req, res) => {
  const lang = langOf(req);
  const tutor = await get(COL.tutors, req.params.id);
  if (!tutor || !isActive(tutor)) return fail(res, 404, 'NOT_FOUND', 'El tutor no existe');
  const reviews = await reviewsOf(tutor.id);
  const ratings = aggregateRatings(tutor, reviews);
  const mine = reviews.find((x) => x.userId === req.user.id) || null;
  const conversation = await findOne(COL.conversations, (c) => c.tutorId === tutor.id && c.userId === req.user.id);
  return ok(res, tutorProfile(tutor, ratings, lang, {
    highlightedReview: reviews[0] ? publicReview(reviews[0], lang) : (tutor.highlightedReview || null),
    myReview: mine ? publicReview(mine, lang) : null,
    conversationId: conversation?.id || null,
    contacted: !!conversation,
    canReview: !!conversation && !mine,
  }));
}));

// ── GET /tutors/:id/reviews ─────────────────────────────────────────────────
r.get('/tutors/:id/reviews', wrap(async (req, res) => {
  const lang = langOf(req);
  const tutor = await get(COL.tutors, req.params.id);
  if (!tutor || !isActive(tutor)) return fail(res, 404, 'NOT_FOUND', 'El tutor no existe');
  const reviews = await reviewsOf(tutor.id);
  const ratings = aggregateRatings(tutor, reviews);
  const { page, pagination } = paginate(reviews, req.query);
  return ok(res, page.map((x) => publicReview(x, lang)), 200, {
    pagination,
    summary: {
      overall: ratings.overall,
      reviewCount: ratings.reviewCount,
      byCriterion: criteriaLabels(lang).map((c) => ({ ...c, value: ratings.criteria[c.key] })),
    },
  });
}));

// ── POST /tutors/:id/reviews ────────────────────────────────────────────────
// Solo si el alumno contacto al tutor (existe conversacion) y no ha resenado antes.
r.post('/tutors/:id/reviews', wrap(async (req, res) => {
  const lang = langOf(req);
  const tutor = await get(COL.tutors, req.params.id);
  if (!tutor || !isActive(tutor)) return fail(res, 404, 'NOT_FOUND', 'El tutor no existe');
  const { ratings, comment } = req.body || {};
  const invalid = validateReviewRatings(ratings);
  if (invalid) return fail(res, 400, 'VALIDATION_ERROR', invalid, { field: 'ratings' });

  const conversation = await findOne(COL.conversations, (c) => c.tutorId === tutor.id && c.userId === req.user.id);
  if (!conversation) return fail(res, 403, 'REVIEW_NOT_ALLOWED', 'Solo puedes resenar tutores con los que has tenido contacto');
  const previous = await findOne(COL.tutorReviews, (x) => x.tutorId === tutor.id && x.userId === req.user.id);
  if (previous) return fail(res, 409, 'REVIEW_ALREADY_EXISTS', 'Ya publicaste una resena para este tutor');

  const clean = { teaching: ratings.teaching, punctuality: ratings.punctuality, mastery: ratings.mastery };
  const review = await add(COL.tutorReviews, {
    tutorId: tutor.id, userId: req.user.id, userName: req.user.name,
    userInitials: (req.user.name || 'AL').slice(0, 2).toUpperCase(),
    ratings: clean, overall: overallOf(clean),
    comment: String(comment || '').trim().slice(0, 1000),
    lessonsTaken: conversation.lessonsTaken || 0,
    createdAt: new Date().toISOString(),
  }, 'rev');

  // Cache de reputacion para los listados de la consola admin.
  const agg = aggregateRatings(tutor, await reviewsOf(tutor.id));
  await set(COL.tutors, tutor.id, { ...tutor, rating: agg.overall, reviewCount: agg.reviewCount });

  return created(res, { review: publicReview(review, lang), tutorRating: agg.overall, reviewCount: agg.reviewCount });
}));

// ── POST /tutors/:id/contact-requests  (Premium) ────────────────────────────
r.post('/tutors/:id/contact-requests', premiumRequired, wrap(async (req, res) => {
  const lang = langOf(req);
  const tutor = await get(COL.tutors, req.params.id);
  if (!tutor || !isActive(tutor)) return fail(res, 404, 'NOT_FOUND', 'El tutor no existe');
  const message = String(req.body?.message || '').trim();
  if (!message) return fail(res, 400, 'VALIDATION_ERROR', 'message es obligatorio', { field: 'message' });
  const shareProfile = req.body?.shareProfile !== false;

  const existing = await findOne(COL.conversations, (c) => c.tutorId === tutor.id && c.userId === req.user.id);
  const now = new Date().toISOString();

  if (existing) {
    // Idempotente: si ya hay conversacion, el mensaje se agrega a ella.
    await add(COL.messages, {
      conversationId: existing.id, senderType: 'user', senderId: req.user.id,
      text: message, readByUser: true, readByTutor: false, createdAt: now,
    }, 'msg');
    await set(COL.conversations, existing.id, {
      ...existing, lastMessageAt: now, lastMessagePreview: message.slice(0, 120),
      unreadForTutor: (existing.unreadForTutor || 0) + 1,
    });
    return ok(res, { created: false, conversationId: existing.id, requestId: existing.requestId || null, status: 'sent' });
  }

  const profile = shareProfile ? await shareableProfile(req.user, lang) : null;
  const request = await add(COL.tutorRequests, {
    tutorId: tutor.id, userId: req.user.id, message, sharedProfile: profile,
    status: 'sent', createdAt: now,
  }, 'trq');
  const conversation = await add(COL.conversations, {
    tutorId: tutor.id, tutorName: tutor.name, tutorInitials: tutor.initials, tutorColor: tutor.avatarColor,
    userId: req.user.id, userName: req.user.name, requestId: request.id,
    lastMessageAt: now, lastMessagePreview: message.slice(0, 120),
    unreadForUser: 0, unreadForTutor: 1, lessonsTaken: 0,
    contactSharing: { user: false, tutor: !!tutor.contactSharingDefault },
    createdAt: now,
  }, 'cnv');
  await add(COL.messages, {
    conversationId: conversation.id, senderType: 'user', senderId: req.user.id,
    text: message, readByUser: true, readByTutor: false, createdAt: now,
  }, 'msg');
  await set(COL.tutorRequests, request.id, { ...request, conversationId: conversation.id });

  return created(res, {
    created: true, requestId: request.id, conversationId: conversation.id, status: 'sent',
    sharedProfile: profile,
  });
}));

// ── GET /me/gap-analysis  (Premium) ─────────────────────────────────────────
r.get('/me/gap-analysis', premiumRequired, wrap(async (req, res) => {
  const lang = langOf(req);
  const [answers, tests, questions, tutors] = await Promise.all([
    where(COL.answers, (a) => a.userId === req.user.id),
    list(COL.tests),
    list(COL.questions),
    activeTutors(),
  ]);
  const analysis = buildGapAnalysis(req.user, { answers, tests, questions, tutors, lang });
  return ok(res, analysis);
}));

export default r;
