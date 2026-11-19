// 1.3 Practica: next, question, answer, explanation, skill
import { randomUUID } from 'crypto';
import { Router } from 'express';
import { ok, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { COL, get, add, patch, set, queryEqual, list } from '../data/repo.js';
import { initFirestore } from '../config/firebase.js';
import {
  quotaMax,
  freeQuotaMax,
  ensureQuotaDay,
  isUnlimited,
  MAX_QUOTA,
} from '../lib/quota.js';
import { award, emptyWallet } from '../lib/medals.js';

const r = Router();
r.use(authRequired);

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const ATTEMPT_DURATION_MS = 24 * 60 * 60 * 1000;
const memoryLocks = new Map();

const publicQuestion = (q) => ({
  id: q.id,
  testId: q.testId,
  axis: q.axis,
  difficulty: q.difficulty,
  statement: q.statement,
  options: q.options,
});

function reject(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

// Cache de contenido educativo por prueba.
// No almacena usuarios, permisos, respuestas ni suscripciones.
const QUESTION_CACHE_MS = 5 * 60 * 1000;
const MAX_CACHED_TESTS = 32;
const questionCache = new Map();

async function questionsForTest(testId) {
  const now = Date.now();
  const cached = questionCache.get(testId);

  if (cached && (cached.pending || cached.expiresAt > now)) {
    return cached.promise;
  }

  questionCache.delete(testId);

  if (questionCache.size >= MAX_CACHED_TESTS) {
    questionCache.delete(questionCache.keys().next().value);
  }

  const entry = {
    pending: true,
    expiresAt: 0,
    promise: null,
  };

  entry.promise = queryEqual(COL.questions, { testId })
    .then(rows => {
      entry.pending = false;
      entry.expiresAt = Date.now() + QUESTION_CACHE_MS;
      return rows.filter(q => q.published !== false);
    })
    .catch(error => {
      if (questionCache.get(testId) === entry) {
        questionCache.delete(testId);
      }
      throw error;
    });

  questionCache.set(testId, entry);
  return entry.promise;
}

// Prepara el resultado sin realizar escrituras.
// En Firestore se ejecuta usando los documentos leidos en la transaccion.
function prepareAnswer({
  user,
  question,
  attempt,
  existing,
  sessionId,
  selected,
  elapsedMs,
}) {
  if (!user) {
    reject(401, 'AUTH_INVALID', 'Usuario no encontrado');
  }

  if (user.state === 'suspended') {
    reject(403, 'ACCOUNT_SUSPENDED', 'La cuenta esta suspendida');
  }

  if (!question) {
    reject(404, 'NOT_FOUND', 'La pregunta no existe');
  }

  if (
    !attempt ||
    attempt.kind !== 'question_attempt' ||
    attempt.userId !== user.id ||
    attempt.questionId !== question.id
  ) {
    reject(
      400,
      'INVALID_PRACTICE_ATTEMPT',
      'El intento no corresponde a este usuario y pregunta'
    );
  }

  // Un reenvio del mismo intento devuelve el resultado original.
  if (existing) {
    if (
      existing.userId !== user.id ||
      existing.questionId !== question.id ||
      existing.sessionId !== sessionId ||
      !existing.result
    ) {
      reject(409, 'INVALID_PRACTICE_ATTEMPT', 'El intento no es valido');
    }

    if (existing.selected !== selected) {
      reject(
        409,
        'ALREADY_ANSWERED',
        'Este intento ya fue respondido con otra alternativa'
      );
    }

    return {
      replayed: true,
      data: {
        ...existing.result,
        cohortPercentile: null,
      },
    };
  }

  if (attempt.state !== 'pending') {
    reject(409, 'ALREADY_ANSWERED', 'Este intento ya fue respondido');
  }

  const expiresAt = Date.parse(attempt.expiresAt);

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    reject(
      409,
      'PRACTICE_ATTEMPT_EXPIRED',
      'El intento expiro. Solicita una nueva pregunta'
    );
  }

  if (question.published === false) {
    reject(
      404,
      'NO_QUESTIONS_AVAILABLE',
      'La pregunta ya no esta disponible'
    );
  }

  const idx = LETTERS.indexOf(selected);

  if (
    !Array.isArray(question.options) ||
    idx < 0 ||
    idx >= question.options.length
  ) {
    reject(
      400,
      'INVALID_OPTION',
      'La alternativa enviada no existe en la pregunta'
    );
  }

  ensureQuotaDay(user);

  const unlimited = isUnlimited(user, question.testId);

  if (!unlimited && user.quota.used >= quotaMax(user, question.testId)) {
    reject(422, 'QUOTA_DAILY_LIMIT', 'Cuota diaria agotada');
  }

  const correct = idx === question.correctIndex;

  user.quota.total = (user.quota.total ?? user.quota.used) + 1;

  if (!unlimited) {
    user.quota.used += 1;
  }

  user.medals = {
    ...emptyWallet(),
    ...(user.medals || {}),
  };

  let medalAwarded = null;

  if (correct) {
    award(user.medals, 'bronze', 1);
    medalAwarded = { tier: 'bronze', amount: 1 };
  }

  const createdAt = new Date().toISOString();
  const answerId = `ans_${sessionId}`;

  // La comparación entre estudiantes aún no está implementada.
  const cohortPercentile = null;

  const data = {
    correct,
    correctAnswer: LETTERS[question.correctIndex],
    shortExplanation:
      question.shortExplanation ||
      question.explanation?.slice(0, 160) ||
      '',
    cohortPercentile,
    medalAwarded,
    quota: {
      used: user.quota.used,
      max: quotaMax(user, question.testId),
    },
    answerId,
    elapsedMs,
  };

  const answer = {
    id: answerId,
    userId: user.id,
    questionId: question.id,
    testId: question.testId,
    selected,
    correct,
    elapsedMs,
    sessionId,
    createdAt,
    result: data,
  };

  const ledger = correct
    ? {
        id: `mdl_${sessionId}`,
        userId: user.id,
        tier: 'bronze',
        amount: 1,
        reason: 'correct_answer',
        answerId,
        createdAt,
      }
    : null;

  return {
    replayed: false,
    data,
    answer,
    ledger,
    userChanges: {
      quota: user.quota,
      medals: user.medals,
    },
    attemptChanges: {
      state: 'completed',
      answerId,
      completedAt: createdAt,
    },
  };
}

async function answerWithFirestore(input) {
  const { db } = await initFirestore();

  const userRef = db.collection(COL.users).doc(input.userId);
  const questionRef = db.collection(COL.questions).doc(input.questionId);
  const attemptRef = db.collection(COL.practiceSessions).doc(input.sessionId);
  const answerRef = db.collection(COL.answers).doc(`ans_${input.sessionId}`);
  const ledgerRef = db.collection(COL.medalLedger).doc(`mdl_${input.sessionId}`);

  return db.runTransaction(async tx => {
    // Todas las lecturas ocurren antes de las escrituras.
    const [userSnap, questionSnap, attemptSnap, answerSnap] =
      await Promise.all([
        tx.get(userRef),
        tx.get(questionRef),
        tx.get(attemptRef),
        tx.get(answerRef),
      ]);

    const outcome = prepareAnswer({
      ...input,
      user: userSnap.exists
        ? { ...userSnap.data(), id: userSnap.id }
        : null,
      question: questionSnap.exists
        ? { ...questionSnap.data(), id: questionSnap.id }
        : null,
      attempt: attemptSnap.exists ? attemptSnap.data() : null,
      existing: answerSnap.exists ? answerSnap.data() : null,
    });

    if (outcome.replayed) {
      return outcome;
    }

    // Actualiza solamente cuota y medallas.
    // Conserva los campos de administracion y facturacion.
    tx.update(userRef, outcome.userChanges);
    tx.create(answerRef, outcome.answer);

    if (outcome.ledger) {
      tx.create(ledgerRef, outcome.ledger);
    }

    tx.update(attemptRef, outcome.attemptChanges);

    return outcome;
  });
}

// Compatibilidad con el driver local en memoria.
// Serializa respuestas del mismo usuario dentro de este proceso.
async function answerWithMemory(input) {
  const previous = memoryLocks.get(input.userId) || Promise.resolve();

  let release;
  const current = new Promise(resolve => {
    release = resolve;
  });

  const tail = previous.then(() => current);
  memoryLocks.set(input.userId, tail);

  await previous;

  try {
    const [user, question, attempt, existing] = await Promise.all([
      get(COL.users, input.userId),
      get(COL.questions, input.questionId),
      get(COL.practiceSessions, input.sessionId),
      get(COL.answers, `ans_${input.sessionId}`),
    ]);

    const outcome = prepareAnswer({
      ...input,
      user,
      question,
      attempt,
      existing,
    });

    if (outcome.replayed) {
      return outcome;
    }

    await patch(COL.users, input.userId, outcome.userChanges);
    await set(COL.answers, outcome.answer.id, outcome.answer);

    if (outcome.ledger) {
      await set(COL.medalLedger, outcome.ledger.id, outcome.ledger);
    }

    await patch(
      COL.practiceSessions,
      input.sessionId,
      outcome.attemptChanges
    );

    return outcome;
  } finally {
    release();

    if (memoryLocks.get(input.userId) === tail) {
      memoryLocks.delete(input.userId);
    }
  }
}

// GET /practice/next
r.get('/practice/next', wrap(async (req, res) => {
  const u = req.user;
  ensureQuotaDay(u);

  const prefs = u.selectedTests?.length
    ? [...u.selectedTests]
    : (await list(COL.tests)).map(t => t.id);

  const chosen = u.billingTestId || u.selectedTests?.[0];

  if (chosen && isUnlimited(u, chosen) && !prefs.includes(chosen)) {
    prefs.push(chosen);
  }

  const forced = req.query.testId;

  if (
    forced !== undefined &&
    (typeof forced !== 'string' || !forced.trim())
  ) {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'testId debe ser un texto no vacio'
    );
  }

  const testIds = [...new Set(forced ? [forced.trim()] : prefs)]
    .filter(id => typeof id === 'string' && id.length > 0);

  const groups = await Promise.all(testIds.map(questionsForTest));
  let pool = groups.flat();

  if (pool.length === 0) {
    return fail(
      res,
      404,
      'NO_QUESTIONS_AVAILABLE',
      'No quedan preguntas para los filtros actuales'
    );
  }

  // Al agotar la cuota gratuita, conserva las pruebas ilimitadas.
  if (u.quota.used >= freeQuotaMax(u)) {
    pool = pool.filter(q => isUnlimited(u, q.testId));

    if (pool.length === 0) {
      const canUnlockBonus = freeQuotaMax(u) < MAX_QUOTA;

      return fail(
        res,
        422,
        canUnlockBonus ? 'QUOTA_BASE_REACHED' : 'QUOTA_DAILY_LIMIT',
        'Se alcanzo la cuota diaria gratuita'
      );
    }
  }

  const answers = await queryEqual(COL.answers, { userId: u.id });
  const answered = new Set(answers.map(a => a.questionId));

  let candidates = pool.filter(q => !answered.has(q.id));

  if (candidates.length === 0) {
    candidates = pool;
  }

  const q = candidates[Math.floor(Math.random() * candidates.length)];
  const max = quotaMax(u, q.testId);
  const sessionTotal = 10;
  const current = ((u.quota.total ?? u.quota.used) % sessionTotal) + 1;

  // Cada pregunta mostrada tiene un intento creado por el servidor.
  const sessionId = `prs_${randomUUID().replace(/-/g, '')}`;
  const now = Date.now();

  await add(
    COL.practiceSessions,
    {
      id: sessionId,
      kind: 'question_attempt',
      userId: u.id,
      questionId: q.id,
      testId: q.testId,
      state: 'pending',
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ATTEMPT_DURATION_MS).toISOString(),
    },
    'prs'
  );

  return ok(
    res,
    {
      ...publicQuestion(q),
      sessionId,
      progress: { current, total: sessionTotal },
    },
    200,
    { quota: { used: u.quota.used, max } }
  );
}));

// GET /questions/:id
r.get('/questions/:id', wrap(async (req, res) => {
  const q = await get(COL.questions, req.params.id);

  if (!q) {
    return fail(res, 404, 'NOT_FOUND', 'La pregunta no existe');
  }

  return ok(res, publicQuestion(q));
}));

// POST /questions/:id/answer
r.post('/questions/:id/answer', wrap(async (req, res) => {
  const { selected, elapsedMs = 0, sessionId } = req.body || {};

  if (
    typeof sessionId !== 'string' ||
    !/^prs_[0-9a-f]{32}$/.test(sessionId)
  ) {
    return fail(
      res,
      400,
      'INVALID_PRACTICE_ATTEMPT',
      'Solicita una pregunta para obtener un intento valido'
    );
  }

  if (
    typeof selected !== 'string' ||
    !LETTERS.includes(selected.toUpperCase())
  ) {
    return fail(
      res,
      400,
      'INVALID_OPTION',
      'La alternativa enviada no es valida'
    );
  }

  if (
    typeof elapsedMs !== 'number' ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs > ATTEMPT_DURATION_MS
  ) {
    return fail(
      res,
      400,
      'VALIDATION_ERROR',
      'elapsedMs debe ser un numero entre 0 y 86400000'
    );
  }

  const input = {
    userId: req.user.id,
    questionId: req.params.id,
    sessionId,
    selected: selected.toUpperCase(),
    elapsedMs: Math.floor(elapsedMs),
  };

  const outcome = process.env.DATA_DRIVER === 'firestore'
    ? await answerWithFirestore(input)
    : await answerWithMemory(input);

  return ok(
    res,
    outcome.data,
    outcome.replayed ? 200 : 201,
    { replayed: outcome.replayed }
  );
}));

// GET /questions/:id/explanation
r.get('/questions/:id/explanation', wrap(async (req, res) => {
  const q = await get(COL.questions, req.params.id);

  if (!q) {
    return fail(res, 404, 'NOT_FOUND', 'La pregunta no existe');
  }

  if (q.explanationDetailed) {
    return ok(res, q.explanationDetailed);
  }

  return ok(res, {
    title: 'Explicacion',
    subject: `${q.testLabel || q.testId} · ${q.axis || ''}`.trim(),
    steps: [
      {
        label: 'Planteamiento',
        body: q.statement,
      },
      {
        label: 'Resolucion',
        body: q.explanation || q.shortExplanation || '',
      },
    ],
    verification: '',
    keyConcept: q.habilidad || '',
  });
}));

// GET /questions/:id/skill
r.get('/questions/:id/skill', wrap(async (req, res) => {
  const q = await get(COL.questions, req.params.id);

  if (!q) {
    return fail(res, 404, 'NOT_FOUND', 'La pregunta no existe');
  }

  const skill = q.skillId ? await get(COL.skills, q.skillId) : null;
  const u = req.user;

  const answers = await queryEqual(COL.answers, {
    userId: u.id,
    testId: q.testId,
  });

  const total = answers.length;
  const correct = answers.filter(a => a.correct).length;
  const percent = total ? Math.round(correct / total * 100) : 0;

  const base = skill || {
    id: 'skl_generic',
    name: q.habilidad || 'Habilidad evaluada',
    test: q.testId,
    level: 2,
    maxLevel: 4,
    prerequisites: [],
    resources: [],
  };

  return ok(res, {
    skill: {
      id: base.id,
      name: base.name,
      test: base.test || q.testId,
      level: base.level || 2,
      maxLevel: base.maxLevel || 4,
    },
    mastery: {
      percent,
      correct,
      total,
      status: percent >= 80
        ? 'mastered'
        : (total ? 'in_progress' : 'not_started'),
    },
    prerequisites: base.prerequisites?.length
      ? base.prerequisites
      : [
          { name: 'Conocimientos previos', status: 'done' },
          { name: base.name, status: 'active' },
          { name: 'Nivel avanzado', status: 'locked' },
        ],
    resources: base.resources?.length
      ? base.resources
      : [
          {
            type: 'video',
            title: 'Repaso del tema',
            duration: '8 min',
            source: 'Khan Academy',
            url: 'https://www.khanacademy.org',
          },
          {
            type: 'pdf',
            title: 'Ficha de ejercicios',
            url: '#',
          },
        ],
  });
}));

export default r;