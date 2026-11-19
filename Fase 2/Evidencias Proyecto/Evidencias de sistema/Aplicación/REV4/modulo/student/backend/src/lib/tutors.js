// Helpers del marketplace de tutores: serializacion publica y agregacion de
// valoraciones (3 criterios del wireframe: didactica, puntualidad, dominio).
import { loc } from '../data/catalog.js';

export const REVIEW_CRITERIA = ['teaching', 'punctuality', 'mastery'];
export const CRITERIA_LABELS = {
  teaching: { es: 'Didactica (claridad)', en: 'Teaching (clarity)' },
  punctuality: { es: 'Puntualidad', en: 'Punctuality' },
  mastery: { es: 'Dominio del tema', en: 'Subject mastery' },
};
export const MODES = ['online', 'in_person'];

const round1 = (n) => Math.round(n * 10) / 10;

// Combina la reputacion historica del tutor (ratingSeed/reviewCountSeed, que
// llega desde la consola admin) con las resenas creadas en la app.
export function aggregateRatings(tutor, reviews = []) {
  const seedCount = tutor.reviewCountSeed || 0;
  const seed = tutor.ratingSeed || {};
  const out = {};
  for (const c of REVIEW_CRITERIA) {
    const values = reviews
      .filter((r) => r.ratings?.[c] != null)
      .map((r) => Number(r.ratings[c]))
      .filter((n) => Number.isFinite(n));
    // El peso del historico se aplica solo si ese criterio trae valor sembrado;
    // si no, las resenas reales quedarian diluidas contra un 0.
    const raw = Number(seed[c]);
    const seedValue = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const seedWeight = seedValue > 0 ? seedCount : 0;
    const sum = values.reduce((s, n) => s + n, 0) + seedValue * seedWeight;
    const count = values.length + seedWeight;
    out[c] = count ? round1(sum / count) : 0;
  }
  const overallValues = REVIEW_CRITERIA.map((c) => out[c]).filter((n) => n > 0);
  const overall = overallValues.length ? round1(overallValues.reduce((s, n) => s + n, 0) / overallValues.length) : 0;
  return { overall, criteria: out, reviewCount: reviews.length + seedCount };
}

export function criteriaLabels(lang = 'es') {
  return REVIEW_CRITERIA.map((key) => ({ key, label: loc(CRITERIA_LABELS[key], lang) }));
}

// Tarjeta de listado (pantalla `tutors`).
export function tutorCard(tutor, ratings, lang = 'es') {
  return {
    id: tutor.id,
    name: tutor.name,
    initials: tutor.initials,
    avatarColor: tutor.avatarColor,
    textColor: tutor.textColor || '#FFFFFF',
    subjects: tutor.subjects || [],
    subjectsLabel: loc(tutor.subjectsLabel, lang),
    modes: tutor.modes || [],
    modesLabel: loc(tutor.modesLabel, lang),
    pricePerHour: tutor.pricePerHour,
    currency: tutor.currency || 'CLP',
    verified: !!tutor.verified,
    featured: !!tutor.featured,
    yearsExperience: tutor.yearsExperience || 0,
    rating: ratings.overall,
    reviewCount: ratings.reviewCount,
  };
}

// Perfil completo (pantalla `tutor-profile`).
export function tutorProfile(tutor, ratings, lang = 'es', extra = {}) {
  return {
    ...tutorCard(tutor, ratings, lang),
    bio: loc(tutor.bio, lang),
    country: tutor.country || null,
    languages: tutor.languages || [],
    ratingByCriterion: criteriaLabels(lang).map((c) => ({ ...c, value: ratings.criteria[c.key] })),
    ...extra,
  };
}

export function publicReview(review, lang = 'es') {
  return {
    id: review.id,
    author: { name: review.userName, initials: review.userInitials, avatarColor: review.avatarColor || '#1A365D' },
    ratings: review.ratings,
    overall: review.overall,
    comment: review.comment || '',
    criteria: criteriaLabels(lang).map((c) => ({ ...c, value: review.ratings?.[c.key] ?? null })),
    createdAt: review.createdAt,
  };
}

// Valida el payload de una resena: 3 criterios enteros 1..5.
export function validateReviewRatings(ratings) {
  if (!ratings || typeof ratings !== 'object') return 'ratings es obligatorio';
  for (const c of REVIEW_CRITERIA) {
    const v = ratings[c];
    if (!Number.isInteger(v) || v < 1 || v > 5) return `ratings.${c} debe ser un entero entre 1 y 5`;
  }
  return null;
}

export function overallOf(ratings) {
  return round1(REVIEW_CRITERIA.reduce((s, c) => s + ratings[c], 0) / REVIEW_CRITERIA.length);
}
