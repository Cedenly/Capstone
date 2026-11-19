// Reemplaza datos de prueba locales. Nunca se ejecuta al arrancar el API.
// Firestore solo admite emulador loopback y proyecto demo-* autorizado.
//   Uso: ALLOW_TEST_SEED=true npm run seed
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from '../lib/password.js';
import { assertTestDataEnvironment } from '../lib/testDataSafety.js';

assertTestDataEnvironment('seed');
const { reset, genId } = await import('../data/repo.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Banco incluido junto a student/ y admin/ en el paquete instalable.
const REPO_ROOT = process.env.PAES_DIR
  ? path.resolve(process.env.PAES_DIR)
  : path.resolve(__dirname, '../../../../datos-paes');
const hash = (p) => bcrypt.hashSync(p, 8);
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// ── Catalogo de pruebas (alineado al doc de API) ──
const tests = {
  lectora: { id: 'lectora', label: 'Comp. Lectora', color: '#1A365D', order: 1 },
  m1: { id: 'm1', label: 'Matematica M1', color: '#10B981', order: 2 },
  m2: { id: 'm2', label: 'Matematica M2', color: '#6366F1', order: 3 },
  cien: { id: 'cien', label: 'Ciencias', color: '#F5B041', order: 4 },
  hist: { id: 'hist', label: 'Historia y C. Soc.', color: '#EF4444', order: 5 },
};

// Carpeta PAES -> testId
const SOURCES = [
  { dir: 'PAES Chile Verbal', testId: 'lectora', axis: 'Comprension lectora' },
  { dir: 'PAES Chile Matematica', testId: 'm1', axis: 'Numeros y Algebra' },
  { dir: 'PAES Chile Biologia', testId: 'cien', axis: 'Biologia' },
];

function loadQuestions() {
  const questions = {};
  let total = 0, skipped = 0;
  for (const src of SOURCES) {
    const dir = path.join(REPO_ROOT, src.dir);
    if (!fs.existsSync(dir)) { console.warn(`[seed] carpeta no encontrada: ${dir}`); continue; }
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort();
    let i = 0;
    for (const file of files) {
      let arr;
      try { arr = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
      catch (e) { skipped++; console.warn(`[seed] omito ${src.dir}/${file}: JSON invalido (${e.message})`); continue; }
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const options = item.alternativas || [];
        const correctIndex = LETTERS.indexOf(String(item.respuesta_correcta || '').trim().toUpperCase());
        if (!item.pregunta || options.length < 2 || correctIndex < 0 || correctIndex >= options.length) continue;
        const id = genId('qst');
        const difficulty = ['d1', 'd2', 'd2', 'd3', 'd3', 'd4'][i % 6];
        const shortExp = String(item.explicacion_respuesta || '').split(/(?<=\.)\s/)[0].slice(0, 200);
        questions[id] = {
          id, testId: src.testId, testLabel: tests[src.testId].label, axis: src.axis, difficulty,
          statement: item.pregunta, options, correctIndex, published: true,
          shortExplanation: shortExp, explanation: item.explicacion_respuesta || '',
          habilidad: item.habilidad_requerida || '', source: `${src.dir}/${file}`,
          createdAt: new Date().toISOString(),
        };
        i++; total++;
      }
    }
  }
  if (!total) throw new Error('[seed] No hay preguntas válidas. Revisa PAES_DIR; no se reemplazaron datos.');
  console.log(`[seed] preguntas cargadas: ${total} (archivos omitidos: ${skipped})`);
  for (const source of SOURCES) {
    console.log(`[seed] ${source.testId}: ${Object.values(questions).filter(q => q.testId === source.testId).length}`);
  }
  return questions;
}

// ── Planes y features ──
const features = {
  f1: { id: 'f1', ic: 'INF', name_es: 'Preguntas ilimitadas', name_en: 'Unlimited questions' },
  f2: { id: 'f2', ic: 'FAX', name_es: 'Modo facsimil (ensayos)', name_en: 'Facsimile mode' },
  f3: { id: 'f3', ic: 'EXP', name_es: 'Explicaciones paso a paso', name_en: 'Step-by-step explanations' },
  f4: { id: 'f4', ic: 'COR', name_es: 'Recorreccion de preguntas', name_en: 'Question corrections' },
  f5: { id: 'f5', ic: 'GRP', name_es: 'Grupos de estudio', name_en: 'Study groups' },
  f6: { id: 'f6', ic: 'STA', name_es: 'Estadisticas avanzadas', name_en: 'Advanced stats' },
};
const plans = {
  free: { id: 'free', name: 'Gratis', price: 0, color: '#64748B', features: ['f3'], featuresText: ['10 preguntas al dia, ampliables a 20', 'Explicaciones paso a paso'], limits: { qDay: 10, groups: 1, tests: 1 } },
  uni: { id: 'uni', name: '1 prueba ilimitada', price: 1, color: '#1A365D', features: ['f1', 'f3', 'f4'], featuresText: ['Preguntas ilimitadas de 1 prueba a eleccion', 'Recorreccion de preguntas'], limits: { qDay: 0, groups: 3, tests: 1 } },
  all: { id: 'all', name: 'Todas las pruebas', price: 5, color: '#F5B041', popular: true, features: ['f1', 'f3', 'f4', 'f5'], featuresText: ['Acceso ilimitado a las pruebas con preguntas disponibles', 'Explicaciones paso a paso', 'Grupos de estudio'], limits: { qDay: 0, groups: 0, tests: 99 } },
};

// Compatibilidad con los planes de la consola administrativa.
plans.free.badges = { login: 1, purchase: 0, correct: 1 };
plans.uni.badges = { login: 1, purchase: 5, correct: 1 };
plans.all.badges = { login: 2, purchase: 10, correct: 2 };


// ── Sponsors y beneficios ──
const sponsors = {
  spo_platzi: { id: 'spo_platzi', name: 'Platzi', tier: 'Gold', status: 'ok' },
  spo_spotify: { id: 'spo_spotify', name: 'Spotify', tier: 'Silver', status: 'ok' },
  spo_pre: { id: 'spo_pre', name: 'Preuniversitario Pedro de V.', tier: 'Gold', status: 'ok' },
};
const benefits = {
  ben_platzi: { id: 'ben_platzi', name: 'Platzi', description: '1 mes de acceso completo', costPlatinum: 5, sponsor: 'Platzi', stock: 50 },
  ben_spotify: { id: 'ben_spotify', name: 'Spotify Premium', description: '3 meses gratis', costPlatinum: 5, sponsor: 'Spotify', stock: 30 },
  ben_pre: { id: 'ben_pre', name: 'Descuento preuniversitario', description: '50% en plan anual', costPlatinum: 5, sponsor: 'Preuniversitario Pedro de V.', stock: 20 },
};

// ── Usuarios demo ──
const now = new Date().toISOString();
const baseUser = (over) => ({
  fixture: true, authProvider: 'password', state: 'active', locale: 'es', theme: 'light', dailyReminder: true,
  country: 'CL', language: 'es', gradeId: 'cl-paes', phoneVerified: true,
  bonuses: { school: false, address: false }, format: 'random', difficulty: 'd2', onboarded: true,
  quota: { day: now.slice(0, 10), used: 0 }, createdAt: now,
  medals: { bronze: 0, silver: 0, gold: 0, diamond: 0, platinum: 0 }, ...over,
});
const users = {
  usr_demo: baseUser({
    id: 'usr_demo', name: 'Estudiante Demo', email: 'demo@aprueba.cl', emailLower: 'demo@aprueba.cl',
    phone: '+56912345678',
    passwordHash: hash('demo1234'), plan: 'free', streak: 4, quota: { day: now.slice(0, 10), used: 5 },
    medals: { bronze: 14, silver: 3, gold: 1, diamond: 0, platinum: 0 }, selectedTests: ['lectora', 'm1'],
    progressSeed: { lectora: 68, m1: 54, m2: 41, cien: 33 },
  }),
  usr_camila: baseUser({
    id: 'usr_camila', name: 'Camila Rojas', email: 'camila@correo.cl', emailLower: 'camila@correo.cl',
    phone: '+56987654321',
    passwordHash: hash('demo1234'), plan: 'all', planSource: 'manual', streak: 7, medals: { bronze: 30, silver: 6, gold: 2, diamond: 0, platinum: 1 },
    selectedTests: ['lectora', 'm1', 'cien'], progressSeed: { lectora: 81, m1: 72, cien: 60 },
  }),
  usr_juan: baseUser({
    id: 'usr_juan', name: 'Juan Lopez', email: 'juan@correo.cl', emailLower: 'juan@correo.cl',
    phone: '+56955555555',
    passwordHash: hash('demo1234'), plan: 'uni', planSource: 'manual', streak: 3, medals: { bronze: 9, silver: 1, gold: 0, diamond: 0, platinum: 0 },
    selectedTests: ['m1'], progressSeed: { m1: 63 },
  }),
};

// ── Grupos + miembros ──
const groups = {
  grp_mates: { id: 'grp_mates', name: 'Mates PAES 2025', subjectTestId: 'm1', subject: 'Matematica M1', ownerId: 'usr_demo', createdAt: now,
    statsBest: [{ area: 'Algebra', avg: 78 }, { area: 'Geometria', avg: 70 }], statsWeak: [{ area: 'Probabilidad', avg: 45 }, { area: 'Funciones', avg: 56 }] },
  grp_lectura: { id: 'grp_lectura', name: 'Lectura critica', subjectTestId: 'lectora', subject: 'Comp. Lectora', ownerId: 'usr_camila', createdAt: now,
    statsBest: [{ area: 'Vocabulario', avg: 82 }, { area: 'Inferencia', avg: 71 }], statsWeak: [{ area: 'Argumentacion', avg: 48 }] },
};
const groupMembers = {
  gm_1: { id: 'gm_1', groupId: 'grp_mates', userId: 'usr_demo', name: 'Estudiante Demo', email: 'demo@aprueba.cl', role: 'owner', score: 81, activeToday: true },
  gm_2: { id: 'gm_2', groupId: 'grp_mates', userId: 'usr_camila', name: 'Camila Rojas', email: 'camila@correo.cl', role: 'member', score: 72, activeToday: true },
  gm_3: { id: 'gm_3', groupId: 'grp_mates', userId: 'usr_juan', name: 'Juan Lopez', email: 'juan@correo.cl', role: 'member', score: 63, activeToday: false },
  gm_5: { id: 'gm_5', groupId: 'grp_lectura', userId: 'usr_camila', name: 'Camila Rojas', email: 'camila@correo.cl', role: 'owner', score: 81, activeToday: true },
  gm_6: { id: 'gm_6', groupId: 'grp_lectura', userId: 'usr_demo', name: 'Estudiante Demo', email: 'demo@aprueba.cl', role: 'member', score: 63, activeToday: true },
};

// ── Comunidad ──
const posts = {
  pst_1: { id: 'pst_1', authorId: 'usr_camila', authorName: 'Camila R.', text: 'Alguien sabe por que la respuesta es B y no C? Me confunde el enunciado.', questionId: null, questionAxis: 'Algebra', likes: 12, comments: 1, createdAt: new Date(Date.now() - 7200e3).toISOString() },
  pst_2: { id: 'pst_2', authorId: 'usr_juan', authorName: 'Juan L.', text: 'Tip: para ecuaciones, siempre verifica reemplazando el valor. Me salvo en el ensayo.', questionId: null, questionAxis: null, likes: 28, comments: 0, createdAt: new Date(Date.now() - 18000e3).toISOString() },
};
const comments = {
  cmt_1: { id: 'cmt_1', postId: 'pst_1', authorId: 'usr_juan', authorName: 'Juan L.', text: 'Es B por el despeje, revisa el paso 2.', createdAt: new Date(Date.now() - 6000e3).toISOString() },
};

// ── Notificaciones demo ──
const notifications = {
  ntf_1: { id: 'ntf_1', userId: 'usr_demo', type: 'streak', title: 'Sigue tu racha', body: 'Llevas 4 dias seguidos. No la pierdas!', read: false, createdAt: new Date(Date.now() - 3600e3).toISOString() },
  ntf_2: { id: 'ntf_2', userId: 'usr_demo', type: 'medal', title: 'Nueva medalla', body: 'Ganaste 1 medalla de bronce por tu respuesta correcta.', read: true, createdAt: new Date(Date.now() - 86400e3).toISOString() },
};

// Acceso premium local para probar pantallas; no representa una compra.
// Las suscripciones y facturas reales solo provienen del flujo de pagos.
const subscriptions = {};
const invoices = {};

// ── Tutores (marketplace, administrado desde la consola admin) ──
// ratingSeed/reviewCountSeed = reputacion historica; las resenas creadas en la
// app se agregan encima (ver lib/tutors.js aggregateRatings).
const tutors = {
  tut_maria: {
    id: 'tut_maria', name: 'Maria Valdes', initials: 'MV', avatarColor: '#1A365D', textColor: '#FFFFFF',
    subjects: ['m1', 'm2'], subjectsLabel: { es: 'Matematica M1·M2', en: 'Math M1·M2' },
    modes: ['online', 'in_person'], modesLabel: { es: 'Online · Presencial', en: 'Online · In-person' },
    pricePerHour: 12000, currency: 'CLP', country: 'CL', languages: ['es'],
    verified: true, featured: true, online: true, yearsExperience: 5,
    bio: {
      es: 'Ingeniera civil PUC. Preparo PAES Matematica con foco en algebra y funciones. Metodo paso a paso y ensayos cronometrados.',
      en: 'PUC civil engineer. PAES Math prep focused on algebra and functions. Step-by-step method and timed mock tests.',
    },
    ratingSeed: { teaching: 4.9, punctuality: 4.8, mastery: 5.0 }, reviewCountSeed: 128,
    rating: 4.9, reviewCount: 128, status: 'active',
    contact: { whatsapp: '+56911111111', email: 'maria@tutores.cl' }, contactSharingDefault: true,
    createdAt: now,
  },
  tut_rodrigo: {
    id: 'tut_rodrigo', name: 'Rodrigo Cea', initials: 'RC', avatarColor: '#10B981', textColor: '#FFFFFF',
    subjects: ['lectora'], subjectsLabel: { es: 'Comp. Lectora', en: 'Reading Comp.' },
    modes: ['online'], modesLabel: { es: 'Online', en: 'Online' },
    pricePerHour: 10000, currency: 'CLP', country: 'CL', languages: ['es'],
    verified: true, featured: true, online: false, yearsExperience: 4,
    bio: {
      es: 'Profesor de Lenguaje. Estrategias de comprension lectora y manejo del tiempo.',
      en: 'Language teacher. Reading comprehension strategies and time management.',
    },
    ratingSeed: { teaching: 4.8, punctuality: 4.6, mastery: 4.7 }, reviewCountSeed: 86,
    rating: 4.7, reviewCount: 86, status: 'active',
    contact: { whatsapp: '+56922222222', email: 'rodrigo@tutores.cl' }, contactSharingDefault: true,
    createdAt: now,
  },
  tut_paula: {
    id: 'tut_paula', name: 'Paula Soto', initials: 'PS', avatarColor: '#6366F1', textColor: '#FFFFFF',
    subjects: ['cien'], subjectsLabel: { es: 'Ciencias · Biologia', en: 'Science · Biology' },
    modes: ['in_person'], modesLabel: { es: 'Presencial', en: 'In-person' },
    pricePerHour: 11000, currency: 'CLP', country: 'CL', languages: ['es'],
    verified: false, featured: true, online: false, yearsExperience: 6,
    bio: {
      es: 'Biologa. Clases de Ciencias PAES con material propio y guias de practica.',
      en: 'Biologist. PAES Science classes with own material and practice guides.',
    },
    ratingSeed: { teaching: 4.9, punctuality: 4.7, mastery: 4.8 }, reviewCountSeed: 54,
    rating: 4.8, reviewCount: 54, status: 'active',
    contact: { whatsapp: '+56933333333', email: 'paula@tutores.cl' }, contactSharingDefault: false,
    createdAt: now,
  },
  tut_javier: {
    id: 'tut_javier', name: 'Javier Fuentes', initials: 'JF', avatarColor: '#F5B041', textColor: '#1A365D',
    subjects: ['hist'], subjectsLabel: { es: 'Historia y C. Soc.', en: 'History' },
    modes: ['online'], modesLabel: { es: 'Online', en: 'Online' },
    pricePerHour: 9500, currency: 'CLP', country: 'CL', languages: ['es'],
    verified: true, featured: true, online: true, yearsExperience: 3,
    bio: {
      es: 'Historiador. Preparacion PAES Historia y Educacion Ciudadana con foco en analisis de fuentes.',
      en: 'Historian. PAES History prep focused on source analysis.',
    },
    ratingSeed: { teaching: 4.6, punctuality: 4.7, mastery: 4.5 }, reviewCountSeed: 41,
    rating: 4.6, reviewCount: 41, status: 'active',
    contact: { whatsapp: '+56944444444', email: 'javier@tutores.cl' }, contactSharingDefault: true,
    createdAt: now,
  },
};

const tutorReviews = {
  rev_1: {
    id: 'rev_1', tutorId: 'tut_maria', userId: 'usr_camila', userName: 'Camila Rojas', userInitials: 'CR',
    ratings: { teaching: 5, punctuality: 5, mastery: 5 }, overall: 5,
    comment: 'Explica increible, subi 120 puntos en el ensayo. Muy puntual y paciente.',
    lessonsTaken: 12, createdAt: new Date(Date.now() - 14 * 86400e3).toISOString(),
  },
  rev_2: {
    id: 'rev_2', tutorId: 'tut_maria', userId: 'usr_juan', userName: 'Juan Lopez', userInitials: 'JL',
    ratings: { teaching: 5, punctuality: 4, mastery: 5 }, overall: 4.7,
    comment: 'Domina la materia. A veces se atrasaba unos minutos.',
    lessonsTaken: 6, createdAt: new Date(Date.now() - 30 * 86400e3).toISOString(),
  },
};

// Conversacion demo del alumno usr_demo con Maria (pantalla tutor-chat).
const demoConvAt = new Date(Date.now() - 3600e3).toISOString();
const tutorRequests = {
  trq_demo: {
    id: 'trq_demo', tutorId: 'tut_maria', userId: 'usr_demo', conversationId: 'cnv_demo',
    message: 'Hola Maria, necesito reforzar algebra para la PAES. Tienes cupos en las tardes?',
    sharedProfile: {
      name: 'Estudiante Demo', initials: 'ES', gradeId: 'cl-paes', gradeLabel: 'PAES', country: 'CL',
      goal: '700+ pts', selectedTests: ['lectora', 'm1'], weakAreas: ['Numeros y Algebra'],
    },
    status: 'accepted', createdAt: new Date(Date.now() - 7200e3).toISOString(),
  },
};
const conversations = {
  cnv_demo: {
    id: 'cnv_demo', tutorId: 'tut_maria', tutorName: 'Maria Valdes', tutorInitials: 'MV', tutorColor: '#1A365D',
    userId: 'usr_demo', userName: 'Estudiante Demo', requestId: 'trq_demo',
    lastMessageAt: demoConvAt, lastMessagePreview: 'Si, por videollamada. La primera clase es de diagnostico',
    unreadForUser: 1, unreadForTutor: 0, lessonsTaken: 8,
    contactSharing: { user: false, tutor: true }, createdAt: new Date(Date.now() - 7200e3).toISOString(),
  },
};
const messages = {
  msg_1: { id: 'msg_1', conversationId: 'cnv_demo', senderType: 'user', senderId: 'usr_demo', text: 'Hola Maria, necesito reforzar algebra para la PAES. Tienes cupos en las tardes?', readByUser: true, readByTutor: true, createdAt: new Date(Date.now() - 7200e3).toISOString() },
  msg_2: { id: 'msg_2', conversationId: 'cnv_demo', senderType: 'tutor', senderId: 'tut_maria', text: 'Hola! Vi tu perfil, podemos partir reforzando algebra. Tengo cupo martes y jueves 18:00.', readByUser: true, readByTutor: true, createdAt: new Date(Date.now() - 5400e3).toISOString() },
  msg_3: { id: 'msg_3', conversationId: 'cnv_demo', senderType: 'user', senderId: 'usr_demo', text: 'Perfecto, me sirve el martes. Es online?', readByUser: true, readByTutor: true, createdAt: new Date(Date.now() - 4500e3).toISOString() },
  msg_4: { id: 'msg_4', conversationId: 'cnv_demo', senderType: 'tutor', senderId: 'tut_maria', text: 'Si, por videollamada. La primera clase es de diagnostico', readByUser: false, readByTutor: true, createdAt: demoConvAt },
};

const skills = {}; // el endpoint /questions/:id/skill genera el arbol a partir de la habilidad

const seedData = {
  users, tests, questions: loadQuestions(), plans, features, sponsors, benefits,
  groups, groupMembers, groupInvitations: {}, groupShared: {},
  posts, comments, likes: {}, reposts: {}, notifications, subscriptions, invoices,
  corrections: {}, answers: {}, devices: {}, medalLedger: {}, skills, practiceSessions: {}, skillMastery: {},
  tutors, tutorReviews, tutorRequests, conversations, messages,
  // Repetir la fixture también invalida cualquier sesión local anterior.
  authSessions: {}, authRefreshTokens: {},
};

await reset(seedData);
console.log('[seed] listo. Driver:', process.env.DATA_DRIVER || 'memory');
console.log('[seed] usuarios demo: demo@aprueba.cl / camila@correo.cl / juan@correo.cl  (contrasena: demo1234)');
process.exit(0);
