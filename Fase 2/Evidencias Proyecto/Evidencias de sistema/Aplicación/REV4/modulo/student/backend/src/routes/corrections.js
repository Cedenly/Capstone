// 1.3 Recorrecciones del alumno
import { Router } from 'express';
import { ok, created, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { COL, get, add, where } from '../data/repo.js';

const r = Router();
r.use(authRequired);

const REASONS = [
  'wrong_answer',
  'ambiguous',
  'typo',
  'bad_explanation',
  'other',
];

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const FINAL_STATUSES = ['confirmed', 'rejected'];
const CONFIRM_REWARD = { tier: 'bronze', amount: 250 };

const validId = value =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_-]{1,200}$/.test(value);

// Compatibilidad con solicitudes antiguas:
// administración guardaba state y el alumno guardaba status.
function correctionStatus(correction) {
  if (FINAL_STATUSES.includes(correction.status)) {
    return correction.status;
  }

  if (FINAL_STATUSES.includes(correction.state)) {
    return correction.state;
  }

  if (FINAL_STATUSES.includes(correction.resolution)) {
    return correction.resolution;
  }

  return 'pending';
}

// Solo informa una recompensa registrada en el nuevo flujo.
// Una confirmación antigua en badges no demuestra un abono en medals.
function grantedReward(correction, status) {
  if (
    status !== 'confirmed' ||
    correction.rewardTier !== 'bronze' ||
    typeof correction.rewardGrantedAt !== 'string' ||
    !Number.isFinite(Date.parse(correction.rewardGrantedAt)) ||
    !Number.isSafeInteger(correction.rewardAmount) ||
    correction.rewardAmount <= 0
  ) {
    return null;
  }

  return {
    tier: correction.rewardTier,
    amount: correction.rewardAmount,
  };
}

function officialAnswer(question) {
  if (
    Number.isInteger(question.correctIndex) &&
    question.correctIndex >= 0 &&
    question.correctIndex < LETTERS.length &&
    question.correctIndex < (question.options?.length || 0)
  ) {
    return LETTERS[question.correctIndex];
  }

  const letter = typeof question.correctAnswer === 'string'
    ? question.correctAnswer.trim().toUpperCase()
    : '';

  const index = LETTERS.indexOf(letter);

  return index >= 0 && index < (question.options?.length || 0)
    ? letter
    : null;
}

// POST /corrections
r.post('/corrections', wrap(async (req, res) => {
  const { questionId, reason, comment } = req.body || {};

  if (!validId(questionId) || !REASONS.includes(reason)) {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'questionId y reason validos son obligatorios'
    );
  }

  if (
    comment != null &&
    (typeof comment !== 'string' || comment.length > 2000)
  ) {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'El comentario debe ser un texto de hasta 2000 caracteres'
    );
  }

  const question = await get(COL.questions, questionId);

  if (!question) {
    return fail(res, 404, 'NOT_FOUND', 'La pregunta no existe');
  }

  const open = await where(
    COL.corrections,
    correction => (
      correction.userId === req.user.id &&
      correction.questionId === questionId &&
      correctionStatus(correction) === 'pending'
    )
  );

  if (open.length) {
    return fail(
      res,
      409,
      'CORRECTION_ALREADY_OPEN',
      'Ya existe una solicitud abierta tuya para esta pregunta'
    );
  }

  const createdAt = new Date().toISOString();
  const expectedReviewBy = new Date(
    Date.now() + 48 * 3600 * 1000
  ).toISOString();

  const correction = await add(
    COL.corrections,
    {
      userId: req.user.id,
      questionId,
      reason,
      comment: comment?.trim() || '',
      status: 'pending',
      state: 'pending',
      expectedReviewBy,
      createdAt,
    },
    'cor'
  );

  return created(res, {
    id: correction.id,
    status: 'pending',
    expectedReviewBy,
    potentialReward: CONFIRM_REWARD,
  });
}));

// GET /corrections
r.get('/corrections', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const items = (
    await where(
      COL.corrections,
      correction => correction.userId === req.user.id
    )
  ).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );

  return ok(res, items.map(correction => {
    const status = correctionStatus(correction);

    return {
      id: correction.id,
      questionId: correction.questionId,
      reason: correction.reason,
      status,
      resolvedAt: correction.resolvedAt || null,
      rewardGranted: grantedReward(correction, status),
    };
  }));
}));

// GET /corrections/:id
r.get('/corrections/:id', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!validId(req.params.id)) {
    return fail(res, 404, 'NOT_FOUND', 'La solicitud no existe');
  }

  const correction = await get(COL.corrections, req.params.id);

  if (!correction || correction.userId !== req.user.id) {
    return fail(res, 404, 'NOT_FOUND', 'La solicitud no existe');
  }

  const question = validId(correction.questionId)
    ? await get(COL.questions, correction.questionId)
    : null;

  const status = correctionStatus(correction);

  return ok(res, {
    id: correction.id,
    questionId: correction.questionId,
    question: question ? {
      id: question.id,
      testId: question.testId,
      testLabel: question.testLabel,
      axis: question.axis || null,
      difficulty: question.difficulty,
      statement: question.statement,
      officialAnswer: officialAnswer(question),
    } : null,
    reason: correction.reason,
    comment: correction.comment || '',
    status,
    resolution: status === 'pending' ? null : status,
    reviewerNote: correction.reviewerNote || null,
    expectedReviewBy: correction.expectedReviewBy || null,
    resolvedAt: correction.resolvedAt || null,
    potentialReward: CONFIRM_REWARD,
    rewardGranted: grantedReward(correction, status),
    createdAt: correction.createdAt,
  });
}));

export default r;