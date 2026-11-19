import { Router } from 'express';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, listAll } from '../data/repo.js';
import { db, FieldValue } from '../config/firebase.js';

const r = Router();

const CONFIRM_REWARD = { tier: 'bronze', amount: 250 };
const FINAL_STATUSES = ['confirmed', 'rejected'];
const STATUSES = ['pending', ...FINAL_STATUSES];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const MEDAL_LEDGER = 'medalLedger';

const validId = value =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_-]{1,200}$/.test(value);

const stop = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

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

function validQuestionPatch(patch) {
  if (
    !patch ||
    typeof patch !== 'object' ||
    Array.isArray(patch)
  ) {
    return false;
  }

  const allowed = ['statement', 'correctAnswer', 'explanation'];

  if (Object.keys(patch).some(key => !allowed.includes(key))) {
    return false;
  }

  if (
    'statement' in patch &&
    (
      typeof patch.statement !== 'string' ||
      !patch.statement.trim() ||
      patch.statement.length > 20000
    )
  ) {
    return false;
  }

  if (
    'correctAnswer' in patch &&
    (
      typeof patch.correctAnswer !== 'string' ||
      !LETTERS.includes(patch.correctAnswer.trim().toUpperCase())
    )
  ) {
    return false;
  }

  if (
    'explanation' in patch &&
    (
      typeof patch.explanation !== 'string' ||
      patch.explanation.length > 20000
    )
  ) {
    return false;
  }

  return true;
}

// GET /admin/corrections
r.get('/corrections', requireRole('support'), wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const requestedState = req.query.state;

  if (
    requestedState !== undefined &&
    (
      typeof requestedState !== 'string' ||
      (requestedState !== '' && !STATUSES.includes(requestedState))
    )
  ) {
    return fail(
      res,
      400,
      'VALIDATION',
      'El estado indicado no es valido'
    );
  }

  let rows = (await listAll(COL.corrections)).map(correction => {
    const status = correctionStatus(correction);

    return {
      ...correction,
      status,
      state: status,
    };
  });

  if (requestedState) {
    rows = rows.filter(correction =>
      correction.state === requestedState
    );
  }

  return ok(res, rows);
}));

// PATCH /admin/corrections/:id
// Guarda la resolución, la recompensa y la modificación opcional
// de la pregunta en una única transacción.
r.patch(
  '/corrections/:id',
  requireRole('support'),
  wrap(async (req, res) => {
    const { resolution, questionPatch } = req.body || {};

    if (!validId(req.params.id)) {
      return fail(
        res,
        400,
        'VALIDATION',
        'El identificador de la solicitud no es valido'
      );
    }

    if (!FINAL_STATUSES.includes(resolution)) {
      return fail(
        res,
        400,
        'VALIDATION',
        "resolution debe ser 'confirmed' o 'rejected'"
      );
    }

    const hasQuestionPatch = questionPatch != null;

    if (
      hasQuestionPatch &&
      (
        resolution !== 'confirmed' ||
        !validQuestionPatch(questionPatch)
      )
    ) {
      return fail(
        res,
        400,
        'VALIDATION',
        'La modificacion de la pregunta no es valida'
      );
    }

    if (!validId(req.user?.id)) {
      return fail(
        res,
        403,
        'AUTH_FORBIDDEN',
        'Acceso no autorizado'
      );
    }

    const correctionRef = db
      .collection(COL.corrections)
      .doc(req.params.id);

    const adminRef = db
      .collection(COL.adminUsers)
      .doc(req.user.id);

    const result = await db.runTransaction(async tx => {
      const [adminSnap, correctionSnap] = await Promise.all([
        tx.get(adminRef),
        tx.get(correctionRef),
      ]);

      const admin = adminSnap.data();

      if (
        !adminSnap.exists ||
        !['admin', 'support'].includes(admin.role) ||
        (admin.state != null && admin.state !== 'active') ||
        admin.disabled === true ||
        admin.mfaEnabled === true
      ) {
        throw stop(
          403,
          'AUTH_FORBIDDEN',
          'La cuenta no tiene permiso para resolver solicitudes'
        );
      }

      if (hasQuestionPatch && admin.role !== 'admin') {
        throw stop(
          403,
          'AUTH_FORBIDDEN',
          'Solo administracion puede modificar la pregunta'
        );
      }

      if (!correctionSnap.exists) {
        throw stop(
          404,
          'NOT_FOUND',
          'Solicitud no encontrada'
        );
      }

      const correction = correctionSnap.data();

      if (correctionStatus(correction) !== 'pending') {
        throw stop(
          409,
          'CORRECTION_ALREADY_RESOLVED',
          'La solicitud ya fue resuelta'
        );
      }

      let userRef = null;
      let userSnap = null;
      let ledgerRef = null;
      let questionRef = null;
      let questionSnap = null;

      // Todas las lecturas se realizan antes de las escrituras.
      if (resolution === 'confirmed') {
        if (!validId(correction.userId)) {
          throw stop(
            409,
            'INVALID_CORRECTION_USER',
            'La solicitud no tiene un alumno valido'
          );
        }

        userRef = db
          .collection(COL.users)
          .doc(correction.userId);

        ledgerRef = db
          .collection(MEDAL_LEDGER)
          .doc(`mdl_cor_${correctionSnap.id}`);

        const [studentSnap, ledgerSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(ledgerRef),
        ]);

        userSnap = studentSnap;

        if (!userSnap.exists) {
          throw stop(
            404,
            'USER_NOT_FOUND',
            'El alumno de la solicitud no existe'
          );
        }

        if (ledgerSnap.exists) {
          throw stop(
            409,
            'CORRECTION_REWARD_ALREADY_GRANTED',
            'La recompensa de esta solicitud ya fue registrada'
          );
        }

        if (hasQuestionPatch) {
          if (!validId(correction.questionId)) {
            throw stop(
              409,
              'INVALID_CORRECTION_QUESTION',
              'La solicitud no tiene una pregunta valida'
            );
          }

          questionRef = db
            .collection(COL.questions)
            .doc(correction.questionId);

          questionSnap = await tx.get(questionRef);

          if (!questionSnap.exists) {
            throw stop(
              404,
              'QUESTION_NOT_FOUND',
              'La pregunta de la solicitud no existe'
            );
          }
        }
      }

      const resolvedAt = new Date().toISOString();
      let rewardGranted = null;
      let questionChanges = null;

      if (hasQuestionPatch) {
        const question = questionSnap.data();
        questionChanges = {};

        if ('statement' in questionPatch) {
          questionChanges.statement = questionPatch.statement.trim();
        }

        if ('correctAnswer' in questionPatch) {
          const letter = questionPatch.correctAnswer
            .trim()
            .toUpperCase();

          const index = LETTERS.indexOf(letter);

          if (
            !Array.isArray(question.options) ||
            index >= question.options.length
          ) {
            throw stop(
              400,
              'INVALID_OPTION',
              'La alternativa correcta no existe en la pregunta'
            );
          }

          // Compatibilidad entre administración y la práctica del alumno.
          questionChanges.correctAnswer = letter;
          questionChanges.correctIndex = index;
        }

        if ('explanation' in questionPatch) {
          questionChanges.explanation = questionPatch.explanation;
          questionChanges.shortExplanation =
            questionPatch.explanation.slice(0, 160);

          // Evita mostrar una explicación detallada anterior
          // cuando se modifica la explicación principal.
          questionChanges.explanationDetailed = FieldValue.delete();
        }

        if (Object.keys(questionChanges).length) {
          questionChanges.updatedAt = resolvedAt;
        }
      }

      if (resolution === 'confirmed') {
        const user = userSnap.data();
        const wallet = user.medals;

        if (
          wallet != null &&
          (
            typeof wallet !== 'object' ||
            Array.isArray(wallet)
          )
        ) {
          throw stop(
            409,
            'INVALID_MEDAL_WALLET',
            'El saldo de medallas del alumno necesita revision'
          );
        }

        const bronze = wallet?.bronze ?? 0;
        const nextBronze = bronze + CONFIRM_REWARD.amount;

        if (
          !Number.isSafeInteger(bronze) ||
          bronze < 0 ||
          !Number.isSafeInteger(nextBronze)
        ) {
          throw stop(
            409,
            'INVALID_MEDAL_WALLET',
            'El saldo de bronces del alumno necesita revision'
          );
        }

        tx.update(userRef, {
          'medals.bronze': nextBronze,
        });

        tx.create(ledgerRef, {
          id: ledgerRef.id,
          userId: correction.userId,
          correctionId: correctionSnap.id,
          tier: CONFIRM_REWARD.tier,
          amount: CONFIRM_REWARD.amount,
          reason: 'correction_confirmed',
          createdAt: resolvedAt,
        });

        rewardGranted = {
          userId: correction.userId,
          ...CONFIRM_REWARD,
        };
      }

      if (
        questionChanges &&
        Object.keys(questionChanges).length
      ) {
        tx.update(questionRef, questionChanges);
      }

      tx.update(correctionRef, {
        status: resolution,
        state: resolution,
        resolution,
        resolvedBy: req.user.id,
        resolvedAt,
        updatedAt: resolvedAt,
        rewardTier:
          resolution === 'confirmed' ? CONFIRM_REWARD.tier : null,
        rewardAmount:
          resolution === 'confirmed' ? CONFIRM_REWARD.amount : 0,
        rewardGrantedAt:
          resolution === 'confirmed' ? resolvedAt : null,
      });

      return {
        id: correctionSnap.id,
        status: resolution,
        state: resolution,
        resolution,
        resolvedAt,
        rewardGranted,
      };
    });

    return ok(res, result);
  })
);

export default r;