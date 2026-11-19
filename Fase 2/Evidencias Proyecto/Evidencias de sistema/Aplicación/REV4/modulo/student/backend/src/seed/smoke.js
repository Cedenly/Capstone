// Smoke test de los endpoints del API del alumno, con foco en los agregados
// para el wireframe Aprueba_App.html (telefono, catalogo pais/grado, tutores,
// chat, analisis de falencias y huecos menores).
//
//   ALLOW_TEST_SEED=true npm run seed
//   ALLOW_TEST_SEED=true npm run smoke
//
// Requiere la base sembrada: el script muta datos (sale de un grupo, publica
// resenas), asi que hay que resembrar antes de cada corrida.
import 'dotenv/config';
import { assertTestDataEnvironment } from '../lib/testDataSafety.js';
import { startTestServer, TEST_ORIGIN } from './testServer.js';
assertTestDataEnvironment('smoke');
process.env.PHONE_AUTH_ALLOW_DEV_TOKEN = 'true';
process.env.PHONE_VERIFICATION_REQUIRED = 'true';
const BASE = await startTestServer(process.env.SMOKE_PORT || 0);

let pass = 0, failCount = 0;
const results = [];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Origin: TEST_ORIGIN,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function check(label, cond, extra = '') {
  if (cond) { pass++; results.push(`  ok   ${label}`); }
  else { failCount++; results.push(`  FAIL ${label} ${extra}`); }
}

async function expect(label, method, path, opts, expectedStatus, validate) {
  const { status, json } = await call(method, path, opts);
  const statusOk = status === expectedStatus;
  const dataOk = statusOk && (!validate || validate(json?.data, json?.meta, json));
  check(`${method} ${path} -> ${expectedStatus} ${label}`, statusOk && dataOk,
    statusOk ? `(validacion fallida: ${String(JSON.stringify(json?.data)).slice(0, 220)})` : `(recibido ${status} ${String(JSON.stringify(json?.error)).slice(0, 160)})`);
  return json?.data;
}

const login = async email => {
  const { status, json } = await call('POST', '/auth/login', { body: { email, password: 'demo1234' } });
  if (status !== 200 || typeof json?.data?.accessToken !== 'string') {
    throw new Error(`[smoke] Falta una fixture válida para ${email}: HTTP ${status}, código ${json?.error?.code || 'sin accessToken'}. Ejecuta ALLOW_TEST_SEED=true npm run seed antes de esta prueba, en el mismo entorno local.`);
  }
  return json.data.accessToken;
};

// ── Tokens: demo = plan free, camila = plan all (premium) ──
const free = await login('demo@aprueba.cl');
const premium = await login('camila@correo.cl');

results.push('\n[1] Verificacion telefonica (Firebase)');
await expect('detecta pais/idioma', 'POST', '/auth/phone/send-code', { body: { phone: '+44 7700 900123' } }, 200,
  (d) => d.detectedCountry === 'UK' && d.detectedLanguage === 'en' && d.verifier === 'firebase');
await expect('rechaza formato', 'POST', '/auth/phone/send-code', { body: { phone: '123' } }, 400);
await expect('pais no soportado', 'POST', '/auth/phone/send-code', { body: { phone: '+34600000000' } }, 422);
await expect('cuenta existente', 'POST', '/auth/phone/send-code', { body: { phone: '+56912345678' } }, 200,
  (d) => d.accountExists === true);
const verified = await expect('emite phoneToken', 'POST', '/auth/phone/verify-code',
  { body: { firebaseIdToken: 'dev:+56999888777' } }, 200,
  (d) => typeof d.phoneToken === 'string' && d.country === 'CL' && d.accountExists === false);
// Se mantiene local: no se consulta el verificador Firebase con tokens reales.
await expect('rechaza teléfono de desarrollo inválido', 'POST', '/auth/phone/verify-code',
  { body: { firebaseIdToken: 'dev:invalido' } }, 422, (_d, _m, j) => j.error.code === 'INVALID_PHONE');
await expect('phone/mismatch', 'POST', '/auth/phone/verify-code',
  { body: { firebaseIdToken: 'dev:+56999888777', phone: '+56911111111' } }, 409);

results.push('\n[2] Registro con telefono verificado');
await expect('exige phoneToken', 'POST', '/auth/register',
  { body: { name: 'Sin Fono', email: `nofono${Date.now()}@x.cl`, password: 'clave1234', consent: true } }, 400);
const reg = await expect('crea cuenta', 'POST', '/auth/register', {
  body: {
    name: 'Nueva Alumna', email: `nueva${Date.now()}@x.cl`, password: 'clave1234', consent: true,
    phoneToken: verified.phoneToken, country: 'CL', language: 'es', gradeId: 'cl-media-3',
  },
}, 201, (d) => d.user.phoneVerified === true && d.user.phone === '+56999888777' && d.user.gradeId === 'cl-media-3');
await expect('telefono duplicado', 'POST', '/auth/register', {
  body: { name: 'Otra', email: `otra${Date.now()}@x.cl`, password: 'clave1234', consent: true, phoneToken: verified.phoneToken },
}, 409);
const socialPhone = (await call('POST', '/auth/phone/verify-code', { body: { firebaseIdToken: 'dev:+56977766655' } })).json.data;
await expect('social simulado deshabilitado', 'POST', '/auth/social',
  { body: { provider: 'google', idToken: 'google:fixture@example.invalid:Fixture' } }, 410,
  (_d, _m, j) => j.error.code === 'SOCIAL_LOGIN_DISABLED');
await expect('PATCH /me/phone asocia', 'PATCH', '/me/phone',
  { token: reg.accessToken, body: { phoneToken: socialPhone.phoneToken } }, 200,
  (d) => d.phone === '+56977766655' && d.phoneVerified === true);
await expect('phoneToken invalido', 'PATCH', '/me/phone', { token: reg.accessToken, body: { phoneToken: 'xx' } }, 401);

results.push('\n[3] Catalogo pais / grado / asignaturas');
await expect('paises', 'GET', '/countries', {}, 200, (d) => d.length === 2 && d[0].dialCode === '+56');
await expect('grados CL', 'GET', '/countries/CL/grades', {}, 200,
  (d) => d.length === 3 && d[0].items.length === 8 && d[2].items[0].id === 'cl-paes');
await expect('grados UK en ingles', 'GET', '/countries/UK/grades?lang=en', {}, 200,
  (d) => d.length === 4 && d.at(-1).items.some((x) => x.id === 'uk-a-levels'));
await expect('pais inexistente', 'GET', '/countries/FR/grades', {}, 404);
await expect('asignaturas escolares CL', 'GET', '/tests?gradeId=cl-media-2', { token: free }, 200,
  (d) => d.length === 4 && d.some((x) => x.id === 'language') && d.every((x) => x.hasQuestions === false));
await expect('asignaturas PAES', 'GET', '/tests?gradeId=cl-paes', { token: free }, 200,
  (d) => d.length === 5 && d.every((x) => x.hasQuestions === ['lectora', 'm1', 'cien'].includes(x.id)));
await expect('asignaturas UK exam en ingles', 'GET', '/tests?gradeId=uk-a-levels&lang=en', { token: free }, 200,
  (d) => d.some((x) => x.id === 'eng-lit'));
await expect('grado inexistente', 'GET', '/tests?gradeId=zz-999', { token: free }, 404);

results.push('\n[4] Preferencias con pais/idioma/grado');
await expect('guarda onboarding', 'PUT', '/me/preferences',
  { token: free, body: { country: 'CL', language: 'es', gradeId: 'cl-paes', selectedTests: ['lectora', 'm1'] } }, 200,
  (d) => d.gradeId === 'cl-paes' && d.country === 'CL' && d.onboarded === true && d.format === 'random');
await expect('grado invalido', 'PUT', '/me/preferences',
  { token: free, body: { gradeId: 'no-existe', selectedTests: ['m1'] } }, 400);
await expect('grado de otro pais', 'PUT', '/me/preferences',
  { token: free, body: { country: 'UK', gradeId: 'cl-paes', selectedTests: ['m1'] } }, 422);
await expect('lee preferencias', 'GET', '/me/preferences', { token: free }, 200, (d) => d.gradeId === 'cl-paes');
await expect('/me expone telefono y grado', 'GET', '/me', { token: free }, 200,
  (d) => d.phone === '+56912345678' && d.gradeId === 'cl-paes' && d.country === 'CL');

results.push('\n[5] Tutores');
const tutorList = await expect('listado', 'GET', '/tutors', { token: free }, 200,
  (d, m) => d.length === 4 && d[0].rating >= d[1].rating && m.premium.contactTutors === false);
await expect('destacados', 'GET', '/tutors/featured', { token: free }, 200, (d) => d.length === 4);
await expect('filtro por asignatura', 'GET', '/tutors?subject=m1', { token: free }, 200,
  (d) => d.length === 1 && d[0].name === 'Maria Valdes');
await expect('filtro verificados', 'GET', '/tutors?verified=true', { token: free }, 200, (d) => d.length === 3);
await expect('busqueda por texto', 'GET', '/tutors?q=paula', { token: free }, 200, (d) => d.length === 1);
await expect('orden por precio', 'GET', '/tutors?sort=price_asc', { token: free }, 200,
  (d) => d[0].pricePerHour === 9500);
await expect('mode invalido', 'GET', '/tutors?mode=telepatia', { token: free }, 400);
const maria = tutorList.find((t) => t.name === 'Maria Valdes');
await expect('perfil', 'GET', `/tutors/${maria.id}`, { token: premium }, 200,
  (d) => d.bio && d.ratingByCriterion.length === 3 && d.reviewCount === 130);
await expect('perfil inexistente', 'GET', '/tutors/tut_nope', { token: free }, 404);
await expect('resenas', 'GET', `/tutors/${maria.id}/reviews`, { token: free }, 200,
  (d, m) => d.length === 2 && m.summary.byCriterion.length === 3 && m.summary.overall > 4);

results.push('\n[6] Gating premium');
await expect('contacto bloqueado en free', 'POST', `/tutors/${maria.id}/contact-requests`,
  { token: free, body: { message: 'Hola' } }, 403, (_d, _m, j) => j.error.code === 'PLAN_REQUIRED');
await expect('analisis bloqueado en free', 'GET', '/me/gap-analysis', { token: free }, 403);
const analysis = await expect('analisis premium', 'GET', '/me/gap-analysis', { token: premium }, 200,
  (d) => Array.isArray(d.subjects) && d.subjects.length === 3
    && d.subjects[0].mastery <= d.subjects[1].mastery
    && typeof d.subjects[0].recommendedTutorCount === 'number');
check('gap-analysis: recomienda tutor para lectora', analysis.subjects.some((s) => s.testId === 'lectora' && s.recommendedTutorCount === 1));

results.push('\n[7] Solicitud de contacto y chat');
const rodrigo = tutorList.find((t) => t.name === 'Rodrigo Cea');
await expect('mensaje obligatorio', 'POST', `/tutors/${rodrigo.id}/contact-requests`,
  { token: premium, body: { message: '  ' } }, 400);
const contact = await expect('crea conversacion', 'POST', `/tutors/${rodrigo.id}/contact-requests`,
  { token: premium, body: { message: 'Hola Rodrigo, necesito reforzar inferencias.' } }, 201,
  (d) => d.created === true && d.conversationId && d.sharedProfile.name === 'Camila Rojas');
await expect('idempotente', 'POST', `/tutors/${rodrigo.id}/contact-requests`,
  { token: premium, body: { message: 'Insisto :)' } }, 200, (d) => d.created === false);
await expect('lista conversaciones', 'GET', '/me/conversations', { token: premium }, 200,
  (d) => d.length === 1 && d[0].tutor.name === 'Rodrigo Cea');
await expect('detalle conversacion', 'GET', `/conversations/${contact.conversationId}`, { token: premium }, 200,
  (d) => d.contactSharing.mutual === false && d.sharedProfile.weakAreas);
await expect('mensajes', 'GET', `/conversations/${contact.conversationId}/messages`, { token: premium }, 200,
  (d) => d.length === 2 && d.every((m) => m.mine === true));
await expect('envia mensaje', 'POST', `/conversations/${contact.conversationId}/messages`,
  { token: premium, body: { text: 'Puedo los jueves' } }, 201, (d) => d.mine === true);
await expect('texto vacio', 'POST', `/conversations/${contact.conversationId}/messages`,
  { token: premium, body: { text: '' } }, 400);
await expect('conversacion ajena', 'GET', `/conversations/${contact.conversationId}/messages`, { token: free }, 404);
await expect('marca leido', 'POST', `/conversations/${contact.conversationId}/read`, { token: premium }, 200,
  (d) => d.unreadCount === 0);
await expect('consentimiento no booleano', 'PATCH', `/conversations/${contact.conversationId}/contact-sharing`,
  { token: premium, body: { shareWhatsapp: 'si' } }, 400);
await expect('consentimiento mutuo revela', 'PATCH', `/conversations/${contact.conversationId}/contact-sharing`,
  { token: premium, body: { shareWhatsapp: true } }, 200,
  (d) => d.mutual === true && d.revealed.tutorWhatsapp === '+56922222222' && d.revealed.myWhatsapp === '+56987654321');
await expect('revoca consentimiento', 'PATCH', `/conversations/${contact.conversationId}/contact-sharing`,
  { token: premium, body: { shareWhatsapp: false } }, 200, (d) => d.mutual === false && d.revealed === null);

// Conversacion sembrada del alumno free (demo): chat y no-lectura
const freeConvs = await expect('demo tiene conversacion sembrada', 'GET', '/me/conversations', { token: free }, 200,
  (d) => d.length === 1 && d[0].unreadCount === 1);
await expect('lectura baja el badge', 'GET', `/conversations/${freeConvs[0].id}/messages`, { token: free }, 200,
  (d) => d.length === 4 && d[0].senderType === 'tutor');
await expect('badge en cero', 'GET', '/me/conversations', { token: free }, 200, (d) => d[0].unreadCount === 0);

results.push('\n[8] Resenas de tutores');
await expect('sin contacto no puede resenar', 'POST', `/tutors/${maria.id}/reviews`,
  { token: premium, body: { ratings: { teaching: 5, punctuality: 5, mastery: 5 } } }, 403);
await expect('ratings invalidos', 'POST', `/tutors/${rodrigo.id}/reviews`,
  { token: premium, body: { ratings: { teaching: 9, punctuality: 5, mastery: 5 } } }, 400);
await expect('publica resena', 'POST', `/tutors/${rodrigo.id}/reviews`,
  { token: premium, body: { ratings: { teaching: 5, punctuality: 4, mastery: 5 }, comment: 'Muy claro' } }, 201,
  (d) => d.reviewCount === 87 && d.review.overall > 4.5 && d.review.criteria.length === 3);
await expect('una resena por alumno', 'POST', `/tutors/${rodrigo.id}/reviews`,
  { token: premium, body: { ratings: { teaching: 3, punctuality: 3, mastery: 3 } } }, 409);
await expect('perfil marca canReview=false', 'GET', `/tutors/${rodrigo.id}`, { token: premium }, 200,
  (d) => d.contacted === true && d.canReview === false && d.myReview !== null);

results.push('\n[9] Huecos menores');
const correction = await expect('crea recorreccion', 'POST', '/corrections',
  { token: premium, body: { questionId: (await call('GET', '/practice/next', { token: premium })).json.data.id, reason: 'ambiguous', comment: 'Enunciado ambiguo' } }, 201);
await expect('detalle recorreccion', 'GET', `/corrections/${correction.id}`, { token: premium }, 200,
  (d) => d.status === 'pending' && d.question.officialAnswer && d.potentialReward.amount === 250);
await expect('recorreccion ajena', 'GET', `/corrections/${correction.id}`, { token: free }, 404);
const feed = await expect('feed con reposts', 'GET', '/feed', { token: free }, 200,
  (d) => d.length >= 2 && d[0].reposts === 0 && d[0].reposted === false);
await expect('repost', 'POST', `/posts/${feed[0].id}/repost`, { token: free }, 200,
  (d) => d.reposted === true && d.reposts === 1);
await expect('repost toggle', 'POST', `/posts/${feed[0].id}/repost`, { token: free }, 200,
  (d) => d.reposted === false && d.reposts === 0);
await expect('no borra post ajeno', 'DELETE', `/posts/${feed[0].id}`, { token: free }, 403);
const myPost = await expect('crea post', 'POST', '/posts', { token: free, body: { text: 'Post de prueba' } }, 201);
const myComment = await expect('comenta', 'POST', `/posts/${myPost.id}/comments`, { token: free, body: { text: 'Comentario' } }, 201);
await expect('borra comentario', 'DELETE', `/posts/${myPost.id}/comments/${myComment.id}`, { token: free }, 204, () => true);
await expect('borra post propio', 'DELETE', `/posts/${myPost.id}`, { token: free }, 204, () => true);
await expect('marca todo leido', 'POST', '/me/notifications/read-all', { token: free }, 200, (d) => d.unreadCount === 0);
await expect('detalle beneficio', 'GET', '/benefits/ben_platzi', { token: free }, 200,
  (d) => d.requiredPlatinum === 5 && Array.isArray(d.myRedemptions));
await expect('beneficio inexistente', 'GET', '/benefits/ben_nope', { token: free }, 404);
const groups = await expect('grupos', 'GET', '/groups', { token: free }, 200, (d) => d.length >= 1);
const leaveTarget = groups.find((g) => g.name === 'Lectura critica');
await expect('sale del grupo', 'DELETE', `/groups/${leaveTarget.id}/members/me`, { token: free }, 204, () => true);
await expect('no puede salir dos veces', 'DELETE', `/groups/${leaveTarget.id}/members/me`, { token: free }, 404);

results.push('\n[10] Correcciones de la revision de codigo');
// Webhook publico: no debe quedar tapado por el authRequired de meRoutes.
{
  const { status } = await call('POST', '/webhooks/stripe', { body: { type: 'ping' } });
  check('POST /webhooks/stripe sigue siendo publico', status !== 401, `(recibido ${status})`);
}
await expect('cursor invalido no rompe el feed', 'GET', '/feed?cursor[a]=1', { token: free }, 200, (d) => Array.isArray(d));
await expect('limit negativo se acota', 'GET', '/feed?limit=-5', { token: free }, 200,
  (d, m) => d.length >= 1 && m.pagination.limit === 1);
await expect('enviar mensaje exige plan de pago', 'POST', `/conversations/${freeConvs[0].id}/messages`,
  { token: free, body: { text: 'Hola' } }, 403);
await expect('compartir contacto exige plan de pago', 'PATCH', `/conversations/${freeConvs[0].id}/contact-sharing`,
  { token: free, body: { shareWhatsapp: true } }, 403);
await expect('telefono enmascarado', 'POST', '/auth/phone/send-code', { body: { phone: '+56912345678' } }, 200,
  (d) => d.masked === '+56*****5678');
await expect('post demasiado largo', 'POST', '/posts', { token: free, body: { text: 'x'.repeat(2001) } }, 400);
{
  // Un tutor sin ratingSeed no debe diluir las resenas reales contra cero.
  const { aggregateRatings } = await import('../lib/tutors.js');
  const sinSeed = aggregateRatings({ ratingSeed: null, reviewCountSeed: 100 },
    [{ ratings: { teaching: 5, punctuality: 5, mastery: 5 } }]);
  check('aggregateRatings ignora historico sin valores', sinSeed.overall === 5, `(overall=${sinSeed.overall})`);
  const parcial = aggregateRatings({ ratingSeed: { teaching: 4.8, punctuality: 4.6 }, reviewCountSeed: 10 },
    [{ ratings: { teaching: 5, punctuality: 5, mastery: 4 } }]);
  check('aggregateRatings soporta historico parcial', parcial.criteria.mastery === 4, `(mastery=${parcial.criteria.mastery})`);
}

results.push('\n[11] Regresion de rutas existentes');
const practice = await expect('practice/next crea intento', 'GET', '/practice/next', { token: premium }, 200,
  (d) => d.progress.total === 10 && /^prs_[0-9a-f]{32}$/.test(d.sessionId) && !Object.hasOwn(d, 'correctIndex'));
await expect('respuesta requiere sessionId', 'POST', `/questions/${practice.id}/answer`,
  { token: premium, body: { selected: 'A', elapsedMs: 12000 } }, 400,
  (_d, _m, j) => j.error.code === 'INVALID_PRACTICE_ATTEMPT');
const answerBody = { selected: 'A', elapsedMs: 12000, sessionId: practice.sessionId };
await expect('responde intento válido', 'POST', `/questions/${practice.id}/answer`,
  { token: premium, body: answerBody }, 201);
await expect('reenvío idempotente', 'POST', `/questions/${practice.id}/answer`,
  { token: premium, body: answerBody }, 200, (_d, m) => m.replayed === true);
await expect('sin sesión de acceso no practica', 'GET', '/practice/next', {}, 401);
await expect('recuperación de contraseña no disponible', 'POST', '/auth/password/forgot',
  { body: { email: 'fixture@example.invalid' } }, 410, (_d, _m, j) => j.error.code === 'PASSWORD_RECOVERY_UNAVAILABLE');
await expect('plans publico', 'GET', '/plans', {}, 200, (d) => d.length >= 2);
await expect('me/medals', 'GET', '/me/medals', { token: free }, 200, (d) => d.wallet);
await expect('me/progress', 'GET', '/me/progress', { token: free }, 200, (d) => Array.isArray(d));
await expect('sin token', 'GET', '/tutors', {}, 401);

console.log(results.join('\n'));
console.log(`\n${pass} ok / ${failCount} fallos`);
process.exit(failCount ? 1 : 0);
