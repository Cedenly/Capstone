import { Router } from 'express';
import { ok, created, fail } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { COL, listAll, addDoc, patchDoc, getDoc } from '../data/repo.js';

const r = Router();

r.get('/questions', requireRole('admin'), wrap(async (req, res) => {
  let rows = await listAll(COL.questions);
  const { testId, axis, difficulty, status } = req.query;
  if (testId) rows = rows.filter((q) => q.testId === testId);
  if (axis) rows = rows.filter((q) => q.axis === axis);
  if (difficulty) rows = rows.filter((q) => q.difficulty === difficulty);
  if (status) rows = rows.filter((q) => q.status === status);
  return ok(res, rows, 200, { pagination: { total: rows.length } });
}));

r.post('/questions', requireRole('admin'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.statement || !Array.isArray(b.options)) return fail(res, 400, 'VALIDATION', 'statement y options son obligatorios');
  const doc = await addDoc(COL.questions, {
    testId: b.testId || null, axis: b.axis || null, difficulty: b.difficulty || 'd1',
    statement: b.statement, options: b.options, correctAnswer: b.correctAnswer || 'A',
    explanation: b.explanation || '', requiredSkill: b.requiredSkill || '', status: 'draft',
  });
  return created(res, { id: doc.id, status: doc.status });
}));

r.put('/questions/:id', requireRole('admin'), wrap(async (req, res) => {
  const allowed = ['testId', 'axis', 'difficulty', 'statement', 'options', 'correctAnswer', 'explanation', 'requiredSkill', 'status'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  const doc = await patchDoc(COL.questions, req.params.id, patch);
  if (!doc) return fail(res, 404, 'NOT_FOUND', 'Pregunta no encontrada');
  return ok(res, doc);
}));

// POST /admin/questions/import — formato de origen (archivos JSON por materia)
r.post('/questions/import', requireRole('admin'), wrap(async (req, res) => {
  const { testId, items } = req.body || {};
  if (!Array.isArray(items)) return fail(res, 400, 'VALIDATION', 'items debe ser un array');
  let imported = 0; const errors = [];
  for (const [i, it] of items.entries()) {
    try {
      await addDoc(COL.questions, {
        testId: testId || null, axis: it.eje || it.axis || null, difficulty: it.dificultad || 'd1',
        statement: it.pregunta, options: it.alternativas, correctAnswer: it.respuesta_correcta,
        explanation: it.explicacion_respuesta || '', requiredSkill: it.habilidad_requerida || '', status: 'published',
      });
      imported++;
    } catch (e) { errors.push({ index: i, message: e.message }); }
  }
  return created(res, { imported, skipped: items.length - imported - errors.length, errors });
}));

export default r;
