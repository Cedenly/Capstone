// Administración del marketplace de tutores. La app del alumno solo lee estos
// registros (GET /tutors en el API del estudiante), por lo que el alta, la
// verificación y la baja se hacen aquí.
import { Router } from 'express';
import { ok, created, noContent, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, listAll, addDoc, patchDoc, deleteDoc, getDoc } from '../data/repo.js';

const r = Router();

const MODES = ['online', 'in_person'];
const STATUSES = ['active', 'paused', 'rejected'];
const CRITERIA = ['teaching', 'punctuality', 'mastery'];

const initialsOf = (name) => String(name || '')
  .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'TU';

const round1 = (n) => Math.round(n * 10) / 10;

// Misma agregación que el API del alumno (lib/tutors.js): el peso del histórico
// solo cuenta para los criterios con valor sembrado. Nunca se confía en un
// `rating` enviado por el cliente.
function computeRating(tutor, reviews = []) {
  const seed = tutor.ratingSeed || {};
  const seedCount = Number(tutor.reviewCountSeed || 0);
  const perCriterion = CRITERIA.map((c) => {
    const values = reviews
      .filter((r) => r.ratings?.[c] != null)
      .map((r) => Number(r.ratings[c]))
      .filter((n) => Number.isFinite(n));
    const raw = Number(seed[c]);
    const seedValue = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const weight = seedValue > 0 ? seedCount : 0;
    const total = values.length + weight;
    return total ? round1((values.reduce((s, n) => s + n, 0) + seedValue * weight) / total) : 0;
  }).filter((n) => n > 0);
  return {
    rating: perCriterion.length ? round1(perCriterion.reduce((s, n) => s + n, 0) / perCriterion.length) : 0,
    reviewCount: reviews.length + seedCount,
  };
}

async function refreshRatingCache(tutorId) {
  const tutor = await getDoc(COL.tutors, tutorId);
  if (!tutor) return null;
  const reviews = (await listAll(COL.tutorReviews)).filter((x) => x.tutorId === tutorId);
  return patchDoc(COL.tutors, tutorId, computeRating(tutor, reviews));
}

function validate(body, { partial = false } = {}) {
  const b = body || {};
  if (!partial || 'name' in b) if (!b.name) return 'name es obligatorio';
  if (!partial || 'subjects' in b) {
    if (!Array.isArray(b.subjects) || b.subjects.length === 0) return 'subjects debe ser un array con al menos una prueba';
  }
  if ('modes' in b) {
    if (!Array.isArray(b.modes) || b.modes.some((m) => !MODES.includes(m))) return `modes solo admite: ${MODES.join(', ')}`;
  }
  if ('pricePerHour' in b && !(Number(b.pricePerHour) >= 0)) return 'pricePerHour debe ser un número >= 0';
  if ('status' in b && !STATUSES.includes(b.status)) return `status solo admite: ${STATUSES.join(', ')}`;
  if ('ratingSeed' in b && b.ratingSeed != null) {
    for (const c of CRITERIA) {
      const v = Number(b.ratingSeed[c]);
      if (!(v >= 0 && v <= 5)) return `ratingSeed.${c} debe estar entre 0 y 5`;
    }
  }
  return null;
}

// GET /admin/tutors?status=&subject=&verified=&q=
r.get('/tutors', requireRole('support'), wrap(async (req, res) => {
  let rows = await listAll(COL.tutors);
  const { status, subject, verified, q } = req.query;
  if (status) rows = rows.filter((t) => (t.status || 'active') === status);
  if (subject) rows = rows.filter((t) => (t.subjects || []).includes(subject));
  if (verified) rows = rows.filter((t) => !!t.verified === (verified === 'true'));
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((t) => `${t.name} ${t.contact?.email || ''}`.toLowerCase().includes(needle));
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return ok(res, rows, 200, { pagination: { total: rows.length } });
}));

// GET /admin/tutors/:id  (incluye reseñas para moderación)
r.get('/tutors/:id', requireRole('support'), wrap(async (req, res) => {
  const tutor = await getDoc(COL.tutors, req.params.id);
  if (!tutor) return fail(res, 404, 'NOT_FOUND', 'Tutor no encontrado');
  const reviews = (await listAll(COL.tutorReviews)).filter((x) => x.tutorId === tutor.id);
  const requests = (await listAll(COL.tutorRequests)).filter((x) => x.tutorId === tutor.id);
  return ok(res, { ...tutor, reviews, contactRequests: requests.length });
}));

// POST /admin/tutors
r.post('/tutors', requireRole('support'), wrap(async (req, res) => {
  const b = req.body || {};
  const invalid = validate(b);
  if (invalid) return fail(res, 400, 'VALIDATION', invalid);
  const doc = await addDoc(COL.tutors, {
    name: b.name,
    initials: b.initials || initialsOf(b.name),
    avatarColor: b.avatarColor || '#1A365D',
    textColor: b.textColor || '#FFFFFF',
    subjects: b.subjects,
    subjectsLabel: b.subjectsLabel || { es: b.subjects.join(' · '), en: b.subjects.join(' · ') },
    modes: b.modes || ['online'],
    modesLabel: b.modesLabel || { es: 'Online', en: 'Online' },
    pricePerHour: Number(b.pricePerHour || 0),
    currency: b.currency || 'CLP',
    country: b.country || 'CL',
    languages: b.languages || ['es'],
    bio: b.bio || { es: '', en: '' },
    yearsExperience: Number(b.yearsExperience || 0),
    verified: !!b.verified,
    featured: !!b.featured,
    online: false,
    // Reputación histórica traída desde fuera de la app (opcional). El rating
    // publicado se deriva de aquí, nunca del body.
    ratingSeed: b.ratingSeed || null,
    reviewCountSeed: Number(b.reviewCountSeed || 0),
    ...computeRating({ ratingSeed: b.ratingSeed || null, reviewCountSeed: b.reviewCountSeed }, []),
    contact: b.contact || {},
    contactSharingDefault: b.contactSharingDefault !== false,
    status: b.status || 'active',
    createdAt: new Date().toISOString(),
  });
  return created(res, doc);
}));

// PUT /admin/tutors/:id
r.put('/tutors/:id', requireRole('support'), wrap(async (req, res) => {
  const invalid = validate(req.body, { partial: true });
  if (invalid) return fail(res, 400, 'VALIDATION', invalid);
  const allowed = [
    'name', 'initials', 'avatarColor', 'textColor', 'subjects', 'subjectsLabel', 'modes', 'modesLabel',
    'pricePerHour', 'currency', 'country', 'languages', 'bio', 'yearsExperience', 'verified', 'featured',
    'ratingSeed', 'reviewCountSeed', 'contact', 'contactSharingDefault', 'status',
  ];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  const doc = await patchDoc(COL.tutors, req.params.id, patch);
  if (!doc) return fail(res, 404, 'NOT_FOUND', 'Tutor no encontrado');
  // Si cambió el histórico, hay que recalcular la reputación publicada.
  if ('ratingSeed' in patch || 'reviewCountSeed' in patch) {
    return ok(res, await refreshRatingCache(doc.id));
  }
  return ok(res, doc);
}));

// PATCH /admin/tutors/:id/verification
r.patch('/tutors/:id/verification', requireRole('support'), wrap(async (req, res) => {
  const { verified, note } = req.body || {};
  if (typeof verified !== 'boolean') return fail(res, 400, 'VALIDATION', 'verified debe ser booleano');
  const doc = await patchDoc(COL.tutors, req.params.id, {
    verified,
    verificationNote: note || null,
    verifiedAt: verified ? new Date().toISOString() : null,
    verifiedBy: verified ? req.user.id : null,
  });
  if (!doc) return fail(res, 404, 'NOT_FOUND', 'Tutor no encontrado');
  return ok(res, { id: doc.id, verified: doc.verified, verifiedAt: doc.verifiedAt });
}));

// DELETE /admin/tutors/:id  (?hard=true elimina; por defecto pausa)
r.delete('/tutors/:id', requireRole('admin'), wrap(async (req, res) => {
  const tutor = await getDoc(COL.tutors, req.params.id);
  if (!tutor) return fail(res, 404, 'NOT_FOUND', 'Tutor no encontrado');
  if (req.query.hard === 'true') {
    await deleteDoc(COL.tutors, tutor.id);
    return noContent(res);
  }
  const doc = await patchDoc(COL.tutors, tutor.id, { status: 'paused', featured: false });
  return ok(res, { id: doc.id, status: doc.status });
}));

// DELETE /admin/tutors/:id/reviews/:reviewId  (moderación de reseñas)
r.delete('/tutors/:id/reviews/:reviewId', requireRole('support'), wrap(async (req, res) => {
  const review = await getDoc(COL.tutorReviews, req.params.reviewId);
  if (!review || review.tutorId !== req.params.id) return fail(res, 404, 'NOT_FOUND', 'Reseña no encontrada');
  await deleteDoc(COL.tutorReviews, review.id);
  await refreshRatingCache(review.tutorId);
  return noContent(res);
}));

export default r;
