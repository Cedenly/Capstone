// Volcado de respuestas reales del API para validar los modelos del cliente
// Flutter (aprueba_app/tool/check_models.py). Requiere la base sembrada.
//   ALLOW_TEST_SEED=true node src/seed/dump_payloads.js [salida.json]
// Requiere resembrar: crea respuestas, contactos y reseñas en datos locales.
import 'dotenv/config';
import { assertTestDataEnvironment } from '../lib/testDataSafety.js';
import { startTestServer, TEST_ORIGIN } from './testServer.js';
assertTestDataEnvironment('dump');
process.env.PHONE_AUTH_ALLOW_DEV_TOKEN = 'true';
const B = await startTestServer(process.env.DUMP_PORT || 0);
const call=async(m,p,{token,body}={})=>{
  const r=await fetch(B+p,{method:m,headers:{Origin:TEST_ORIGIN,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const t=await r.text();
  let json;
  try { json = JSON.parse(t); } catch { throw new Error(`[dump] ${m} ${p}: respuesta no JSON (${r.status})`); }
  if (!r.ok || json.error || json.data == null) {
    throw new Error(`[dump] ${m} ${p}: HTTP ${r.status}, código ${json.error?.code || 'sin data'}`);
  }
  return json;
};
const login = async email => {
  try {
    const json = await call('POST', '/auth/login', { body: { email, password: 'demo1234' } });
    if (typeof json.data.accessToken !== 'string') throw new Error('La respuesta no contiene accessToken');
    return json;
  } catch (error) {
    throw new Error(`[dump] No se pudo iniciar la cuenta fixture ${email}. Ejecuta ALLOW_TEST_SEED=true npm run seed antes del dump, en el mismo entorno local. ${error.message}`);
  }
};
const premiumLogin=await login('camila@correo.cl');
const premium=premiumLogin.data.accessToken;
const out={};
out['AuthSession']=premiumLogin;
out['PhoneCodeHint']=await call('POST','/auth/phone/send-code',{body:{phone:'+56911223344'}});
out['PhoneVerification']=await call('POST','/auth/phone/verify-code',{body:{firebaseIdToken:'dev:+56911223344'}});
out['Country']=await call('GET','/countries');
out['GradeGroup']=await call('GET','/countries/CL/grades');
out['TestInfo']=await call('GET','/tests?gradeId=cl-paes',{token:premium});
out['User']=await call('GET','/me',{token:premium});
out['Preferences']=await call('GET','/me/preferences',{token:premium});
out['TutorCard']=await call('GET','/tutors',{token:premium});
out['TutorDetail']=await call('GET','/tutors/tut_maria',{token:premium});
out['TutorReviewPage']=await call('GET','/tutors/tut_maria/reviews',{token:premium});
// Responde 4 preguntas para que el analisis tenga ejes con datos.
for(let i=0;i<4;i++){
  const q=await call('GET','/practice/next',{token:premium});
  if (!q.data.id || !q.data.sessionId) throw new Error('[dump] practice/next no devolvió un intento válido');
  await call('POST',`/questions/${q.data.id}/answer`,{token:premium,body:{selected:'A',elapsedMs:12000,sessionId:q.data.sessionId}});
}
out['GapAnalysis']=await call('GET','/me/gap-analysis',{token:premium});
out['ContactRequestResult']=await call('POST','/tutors/tut_paula/contact-requests',{token:premium,body:{message:'Hola Paula, necesito reforzar biologia celular.'}});
out['Conversation']=await call('GET','/me/conversations',{token:premium});
const convId=out['Conversation'].data[0].id;
out['ConversationDetail']=await call('GET',`/conversations/${convId}`,{token:premium});
out['ChatMessage']=await call('GET',`/conversations/${convId}/messages`,{token:premium});
out['PublishedReview']=await call('POST','/tutors/tut_paula/reviews',{token:premium,body:{ratings:{teaching:5,punctuality:4,mastery:5},comment:'Clara y puntual'}});
out['ContactSharing']=await call('PATCH',`/conversations/${convId}/contact-sharing`,{token:premium,body:{shareWhatsapp:true}});
const fs=await import('fs');
const target = process.argv[2] || 'payloads.json';
fs.writeFileSync(target, JSON.stringify(out, (key, value) => ['accessToken', 'refreshToken', 'phoneToken'].includes(key) ? 'LOCAL_TEST_TOKEN_REDACTED' : value, 1));
console.log(`[dump] ${Object.keys(out).length} respuestas -> ${target}`);
process.exit(0);
