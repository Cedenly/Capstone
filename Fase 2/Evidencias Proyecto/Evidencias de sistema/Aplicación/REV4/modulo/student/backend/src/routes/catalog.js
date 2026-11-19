// Catalogos: /countries, /countries/:code/grades, /tests (Bearer),
// /plans (publico), /benefits (Bearer)
import { Router } from 'express';
import { ok, created, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { COL, list, get, add, set, where, genId } from '../data/repo.js';
import { hasPracticeQuestions } from '../lib/questionAvailability.js';
import {
  COUNTRIES,
  GRADE_GROUPS,
  SUBJECT_SETS,
  TEST_LABELS_EN,
  findCountry,
  findGrade,
  loc,
} from '../data/catalog.js';

const r = Router();

const langOf = (req) => (
  String(
    req.query.lang ||
    req.user?.language ||
    req.user?.locale ||
    'es'
  ) === 'en'
    ? 'en'
    : 'es'
);

// Estas funciones estan pendientes y no deben anunciarse
// como beneficios operativos del MVP.
const UNAVAILABLE_MVP_FEATURES = new Set([
  'modo facsimil',
  'modo facsimil (ensayos)',
  'estadisticas avanzadas',
]);

const normalizeFeature = (value) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

function availablePlanFeatures(features) {
  if (!Array.isArray(features)) return [];

  return features.filter(feature => (
    typeof feature === 'string' &&
    feature.trim().length > 0 &&
    !UNAVAILABLE_MVP_FEATURES.has(normalizeFeature(feature))
  ));
}

// GET /countries (publico: se consulta antes de tener cuenta)
r.get('/countries', wrap(async (req, res) => {
  const lang = langOf(req);

  return ok(res, COUNTRIES.map(country => ({
    code: country.code,
    name: loc(country.name, lang),
    dialCode: country.dialCode,
    flag: country.flag,
    languages: country.languages,
    defaultLanguage: country.defaultLanguage,
    currency: country.currency,
  })));
}));

// GET /countries/:code/grades (publico)
r.get('/countries/:code/grades', wrap(async (req, res) => {
  const country = findCountry(req.params.code);

  if (!country) {
    return fail(res, 404, 'NOT_FOUND', 'Pais no soportado');
  }

  const lang = langOf(req);

  const groups = (GRADE_GROUPS[country.code] || []).map(group => ({
    key: group.key,
    label: loc(group.label, lang),
    items: group.items.map(item => ({
      id: item.id,
      label: loc(item.label, lang),
      kind: item.kind,
    })),
  }));

  return ok(res, groups, 200, { country: country.code });
}));

// Resuelve las asignaturas de un grado. Para pruebas nacionales tipo PAES usa
// la coleccion tests; para el resto, el catalogo.
async function subjectsForGrade(gradeId, lang) {
  const testsCol = (await list(COL.tests))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const fromTests = () => Promise.all(testsCol.map(async test => ({
    id: test.id,
    label: lang === 'en'
      ? (TEST_LABELS_EN[test.id] || test.label)
      : test.label,
    color: test.color,
    hasQuestions:
      test.active !== false &&
      test.published !== false &&
      await hasPracticeQuestions(test.id),
  })));

  if (!gradeId) return fromTests();

  const grade = findGrade(gradeId);
  if (!grade) return null;

  const subjectSet = SUBJECT_SETS[grade.subjectSet];
  if (subjectSet == null) return fromTests();

  return subjectSet.map(subject => ({
    id: subject.id,
    label: loc(subject.label, lang),
    color: subject.color,
    hasQuestions: false,
  }));
}

// GET /tests?gradeId=&lang=
r.get('/tests', authRequired, wrap(async (req, res) => {
  const lang = langOf(req);
  const gradeId = req.query.gradeId || req.user.gradeId || null;
  const subjects = await subjectsForGrade(gradeId, lang);

  if (subjects === null) {
    return fail(
      res,
      404,
      'NOT_FOUND',
      'El grado indicado no existe',
      { field: 'gradeId' }
    );
  }

  return ok(res, subjects, 200, {
    gradeId: gradeId || null,
    country: req.user.country || null,
  });
}));

// GET /plans (publico)
r.get('/plans', wrap(async (_req, res) => {
  const plans = (await list(COL.plans))
    .filter(plan => plan.id !== 'free' && plan.active !== false)
    .sort((a, b) => (a.price || 0) - (b.price || 0));

  const out = plans.map(plan => ({
    id: plan.id,
    name: plan.name,
    popular: !!plan.popular,
    features: availablePlanFeatures(plan.featuresText),
    price: {
      monthly: plan.price,
      yearly: plan.price * 10,
    },
    limits: plan.limits,
  }));

  return ok(res, out);
}));

const REQUIRED_PLATINUM = 5;

const publicBenefit = (benefit, unlocked) => ({
  id: benefit.id,
  name: benefit.name,
  description: benefit.description,
  costPlatinum: benefit.costPlatinum || REQUIRED_PLATINUM,
  unlocked,
  sponsor: benefit.sponsor,
  stock: benefit.stock ?? null,
  terms: benefit.terms || null,
});

// GET /benefits
r.get('/benefits', authRequired, wrap(async (req, res) => {
  const benefits = await list(COL.benefits);
  const platinum = req.user.medals?.platinum || 0;
  const unlocked = platinum >= REQUIRED_PLATINUM;

  return ok(
    res,
    benefits.map(benefit => publicBenefit(benefit, unlocked)),
    200,
    {
      platinum,
      requiredPlatinum: REQUIRED_PLATINUM,
    }
  );
}));

// GET /benefits/:id
r.get('/benefits/:id', authRequired, wrap(async (req, res) => {
  const benefit = await get(COL.benefits, req.params.id);

  if (!benefit) {
    return fail(res, 404, 'NOT_FOUND', 'El beneficio no existe');
  }

  const platinum = req.user.medals?.platinum || 0;

  const redemptions = await where(
    COL.benefitRedemptions,
    redemption => (
      redemption.userId === req.user.id &&
      redemption.benefitId === benefit.id
    )
  );

  return ok(res, {
    ...publicBenefit(benefit, platinum >= REQUIRED_PLATINUM),
    platinum,
    requiredPlatinum: REQUIRED_PLATINUM,
    myRedemptions: redemptions.map(redemption => ({
      id: redemption.id,
      couponCode: redemption.couponCode,
      createdAt: redemption.createdAt,
    })),
  });
}));

// POST /benefits/:id/redeem
r.post('/benefits/:id/redeem', authRequired, wrap(async (req, res) => {
  const benefit = await get(COL.benefits, req.params.id);

  if (!benefit) {
    return fail(res, 404, 'NOT_FOUND', 'El beneficio no existe');
  }

  if ((req.user.medals?.platinum || 0) < REQUIRED_PLATINUM) {
    return fail(
      res,
      422,
      'INSUFFICIENT_MEDALS',
      'Necesitas 5 medallas de Platino'
    );
  }

  if (benefit.stock != null && benefit.stock <= 0) {
    return fail(
      res,
      409,
      'BENEFIT_OUT_OF_STOCK',
      'El beneficio se agoto'
    );
  }

  req.user.medals.platinum -= REQUIRED_PLATINUM;
  await set(COL.users, req.user.id, req.user);

  if (benefit.stock != null) {
    benefit.stock -= 1;
    await set(COL.benefits, benefit.id, benefit);
  }

  const couponCode = `APRUEBA-${genId('').slice(1, 5).toUpperCase()}`;

  const redemption = await add(
    COL.benefitRedemptions,
    {
      userId: req.user.id,
      benefitId: benefit.id,
      benefit: benefit.name,
      couponCode,
      platinumSpent: REQUIRED_PLATINUM,
      createdAt: new Date().toISOString(),
    },
    'rdm'
  );

  return created(res, {
    redemptionId: redemption.id,
    benefit: benefit.name,
    couponCode,
    platinumSpent: REQUIRED_PLATINUM,
  });
}));

export default r;