// Analisis de falencias (pantalla tutor-analysis, premium).
// Se calcula con las respuestas reales del alumno: dominio por prueba, ejes mas
// debiles y cuantos tutores hay disponibles para reforzar cada prueba.
import { loc, TEST_LABELS_EN } from '../data/catalog.js';

export const WEAK_THRESHOLD = 60; // % de dominio bajo el cual un eje se marca a reforzar
const MIN_ANSWERS_PER_AXIS = 2;   // evita marcar un eje por una sola respuesta

const pct = (correct, total) => (total ? Math.round((correct / total) * 100) : 0);

function tally(rows) {
  const total = rows.length;
  const correct = rows.filter((a) => a.correct).length;
  return { total, correct, mastery: pct(correct, total) };
}

/**
 * @param {object} user       usuario autenticado (usa selectedTests y progressSeed)
 * @param {Array}  answers    respuestas del usuario
 * @param {Array}  tests      coleccion tests
 * @param {Array}  questions  coleccion questions (para resolver el eje/axis)
 * @param {Array}  tutors     tutores activos
 * @param {string} lang       'es' | 'en'
 */
export function buildGapAnalysis(user, { answers = [], tests = [], questions = [], tutors = [], lang = 'es' }) {
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const selected = user.selectedTests?.length ? user.selectedTests : tests.map((t) => t.id);

  const subjects = selected.map((testId) => {
    const test = tests.find((t) => t.id === testId);
    const rows = answers.filter((a) => a.testId === testId);
    const overall = tally(rows);

    // Ejes/areas dentro de la prueba.
    const byAxis = new Map();
    for (const a of rows) {
      const axis = questionById.get(a.questionId)?.axis || 'General';
      if (!byAxis.has(axis)) byAxis.set(axis, []);
      byAxis.get(axis).push(a);
    }
    let areas = [...byAxis.entries()]
      .map(([axis, arr]) => ({ axis, ...tally(arr) }))
      .sort((a, b) => a.mastery - b.mastery);

    const weak = areas.filter((x) => x.total >= MIN_ANSWERS_PER_AXIS && x.mastery < WEAK_THRESHOLD);
    const areasToReinforce = (weak.length ? weak : areas.slice(0, 1)).slice(0, 3);

    // Sin datos suficientes caemos al progressSeed del usuario (demo/onboarding).
    const mastery = overall.total ? overall.mastery : (user.progressSeed?.[testId] ?? 0);
    const eligibleTutors = tutors.filter((t) => (t.subjects || []).includes(testId));

    const label = lang === 'en'
      ? (TEST_LABELS_EN[testId] || test?.label || testId)
      : (test?.label || testId);

    return {
      testId,
      label,
      color: test?.color || '#1A365D',
      mastery,
      status: mastery < 55 ? 'critical' : mastery < 70 ? 'warning' : 'ok',
      exercises: overall.total,
      correct: overall.correct,
      hasData: overall.total > 0,
      areasToReinforce: areasToReinforce.map((a) => ({
        area: a.axis, mastery: a.mastery, exercises: a.total,
      })),
      recommendedTutorCount: eligibleTutors.length,
      recommendedTutorIds: eligibleTutors.slice(0, 5).map((t) => t.id),
    };
  });

  // Ordenado de mayor a menor necesidad, como en el wireframe.
  subjects.sort((a, b) => a.mastery - b.mastery);

  return {
    basedOnExercises: answers.length,
    generatedAt: new Date().toISOString(),
    weakThreshold: WEAK_THRESHOLD,
    subjects,
  };
}

// Areas debiles planas (las usa el perfil compartido al contactar a un tutor).
export function weakAreaNames(analysis, limit = 3) {
  return analysis.subjects
    .flatMap((s) => s.areasToReinforce.map((a) => a.area))
    .slice(0, limit);
}

export const localize = loc;
