// Repositorio unificado. Selecciona el driver segun DATA_DRIVER y expone
// una API simple que usan las rutas. Las subcolecciones del modelo Firestore
// se representan como colecciones raiz con un campo de referencia al padre
// (p. ej. answers.userId, groupMembers.groupId). Ver MODELO_CAMBIOS.md.
import { randomUUID } from 'crypto';
import { memoryDriver } from './memory.js';

const DRIVER = process.env.DATA_DRIVER || 'memory';
let driver = memoryDriver;

if (DRIVER === 'firestore') {
  const { firestoreDriver } = await import('./firestore.js');
  driver = firestoreDriver;
}

export const COL = {
  users: 'users',
  authSessions: 'authSessions',
  authRefreshTokens: 'authRefreshTokens',
  answers: 'answers',
  skillMastery: 'skillMastery',
  notifications: 'notifications',
  devices: 'devices',
  medalLedger: 'medalLedger',
  practiceSessions: 'practiceSessions',
  tests: 'tests',
  skills: 'skills',
  questions: 'questions',
  corrections: 'corrections',
  groups: 'groups',
  groupMembers: 'groupMembers',
  groupInvitations: 'groupInvitations',
  groupShared: 'groupShared',
  posts: 'posts',
  comments: 'comments',
  likes: 'likes',
  plans: 'plans',
  features: 'features',
  subscriptions: 'subscriptions',
  invoices: 'invoices',
  sponsors: 'sponsors',
  benefits: 'benefits',
  benefitRedemptions: 'benefitRedemptions',
  // Marketplace de tutores (administrado desde la consola admin; el alumno solo lee).
  tutors: 'tutors',
  tutorReviews: 'tutorReviews',
  tutorRequests: 'tutorRequests',
  conversations: 'conversations',
  messages: 'messages',
  reposts: 'reposts',
};

export const genId = (prefix) =>
  `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

export const list = (col) => driver.list(col);
export const get = (col, id) => driver.get(col, id);
export const set = (col, id, data) => driver.set(col, id, data);
export const patch = (col, id, partial) => driver.patch(col, id, partial);
export const del = (col, id) => driver.del(col, id);
export const reset = (seedData) => driver.reset(seedData);

// La API transaccional de autenticación no permite escribir usuarios ni otras
// colecciones. Los cambios de estado administrativo pertenecen a su servicio.
export const authTransaction = (fn) => driver.authTransaction(tx => fn({
  get: (name, id) => {
    if (!['users', 'authSessions', 'authRefreshTokens'].includes(name) ||
        typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
      throw new Error('Lectura de sesión inválida.');
    }
    return tx.get(name, id);
  },
  set: (name, id, data) => {
    if (!['authSessions', 'authRefreshTokens'].includes(name) ||
        typeof id !== 'string' || !/^[a-f0-9]{32,64}$/.test(id)) {
      throw new Error('Escritura de sesión inválida.');
    }
    return tx.set(name, id, data);
  },
}));

// add con id autogenerado opcional
export async function add(col, data, idPrefix = 'doc') {
  const id = data.id || genId(idPrefix);
  return set(col, id, { ...data, id });
}

// Compatibilidad con rutas existentes: estos predicados leen toda la coleccion.
// En rutas nuevas, preferir queryEqual para filtrar en Firestore.
export async function where(col, predicate) {
  const all = await list(col);
  return all.filter(predicate);
}

export async function findOne(col, predicate) {
  const all = await list(col);
  return all.find(predicate) || null;
}

// Consultas de igualdad sobre campos simples, con filtro nativo en Firestore.
// El driver en memoria conserva el mismo resultado sin requerir cambios.
export async function queryEqual(col, filters, limit = null) {
  const entries = Object.entries(filters || {});

  if (
    !entries.length ||
    entries.some(([field, value]) =>
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field) ||
      !(
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    )
  ) {
    throw new Error('queryEqual requiere filtros de igualdad validos.');
  }

  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error('El limite de queryEqual debe ser un entero positivo.');
  }

  if (driver.queryEqual) {
    return driver.queryEqual(col, filters, limit);
  }

  const rows = (await list(col)).filter(row =>
    entries.every(([field, value]) => row[field] === value)
  );

  return limit === null ? rows : rows.slice(0, limit);
}
