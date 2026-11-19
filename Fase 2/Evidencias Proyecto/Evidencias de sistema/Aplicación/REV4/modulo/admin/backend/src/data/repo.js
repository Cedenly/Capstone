// Capa de acceso a datos sobre Firestore. Centraliza la lectura/escritura por colección
// para que las rutas no toquen Firestore directamente.
import { db, FieldValue } from '../config/firebase.js';

export const COL = {
  adminUsers: 'adminUsers',
  features: 'features',
  plans: 'plans',
  sponsors: 'sponsors',
  users: 'users',
  tickets: 'tickets',
  corrections: 'corrections',
  questions: 'questions',
  platforms: 'platforms',
  services: 'services',
  containers: 'containers',
  metrics: 'metrics', // documentos: overview, commercial
  // Marketplace de tutores (lo consume en modo lectura el API del alumno).
  tutors: 'tutors',
  tutorReviews: 'tutorReviews',
  tutorRequests: 'tutorRequests',
};

const withId = (doc) => ({ id: doc.id, ...doc.data() });

export async function listAll(col, orderBy) {
  let q = db.collection(col);
  if (orderBy) q = q.orderBy(orderBy);
  const snap = await q.get();
  return snap.docs.map(withId);
}

export async function getDoc(col, id) {
  const snap = await db.collection(col).doc(id).get();
  return snap.exists ? withId(snap) : null;
}

export async function setDoc(col, id, data) {
  await db.collection(col).doc(id).set(data, { merge: false });
  return getDoc(col, id);
}

export async function patchDoc(col, id, data) {
  const ref = db.collection(col).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.set(data, { merge: true });
  return getDoc(col, id);
}

export async function addDoc(col, data, id) {
  const ref = id ? db.collection(col).doc(id) : db.collection(col).doc();
  await ref.set(data);
  return getDoc(col, ref.id);
}

export async function deleteDoc(col, id) {
  await db.collection(col).doc(id).delete();
}

export async function countActiveSubscriptions(planId) {
  const snap = await db.collection(COL.users).where('plan', '==', planId).where('state', '==', 'active').get();
  return snap.size;
}

export { db, FieldValue };
