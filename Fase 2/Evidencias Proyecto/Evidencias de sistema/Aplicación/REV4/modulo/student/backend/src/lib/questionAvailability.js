import { initFirestore } from '../config/firebase.js';
import { COL, queryEqual } from '../data/repo.js';

const PAGE_SIZE = 10;

// Conserva la regla actual de Practica:
// published === false excluye la pregunta.
const available = question => question.published !== false;

export function isOfferedTest(test) {
  return !!test && test.active !== false && test.published !== false;
}

export async function hasPracticeQuestions(testId, transaction) {
  if (typeof testId !== 'string' || !testId.trim()) {
    return false;
  }

  if (process.env.DATA_DRIVER !== 'firestore') {
    const questions = await queryEqual(COL.questions, { testId });
    return questions.some(available);
  }

  const { db } = await initFirestore();
  const baseQuery = db.collection(COL.questions)
    .where('testId', '==', testId)
    .limit(PAGE_SIZE);

  let query = baseQuery;

  while (true) {
    const snapshot = transaction ? await transaction.get(query) : await query.get();

    if (snapshot.docs.some(doc => available(doc.data()))) {
      return true;
    }

    if (snapshot.size < PAGE_SIZE) {
      return false;
    }

    query = baseQuery.startAfter(snapshot.docs.at(-1));
  }
}