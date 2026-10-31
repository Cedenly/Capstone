import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {performance} from 'node:perf_hooks';
import express from './deps/node_modules/express/index.js';
import {getApps,deleteApp} from './deps/node_modules/firebase-admin/lib/app/index.js';
const project='demo-aprueba-limite',host='127.0.0.1:8188';
assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.DATA_DRIVER,'firestore');
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');
const O=new URL('../outputs/limite_api_20261030/',import.meta.url);await fs.mkdir(O,{recursive:true});
const {initFirestore}=await import('./codigo/src/config/firebase.js');
const {default:me}=await import('./codigo/src/routes/me.js');
const {default:practice}=await import('./codigo/src/routes/practice.js');
const {signAccess}=await import('./codigo/src/lib/jwt.js');
const {errorHandler}=await import('./codigo/src/middleware/error.js');
const {db}=await initFirestore();assert.equal(db.projectId,project);
assert.equal((await db.listCollections()).length,0,'Emulador nuevo y vacío requerido');
const end='2026-11-30T12:05:13.000Z',t=Date.parse(end),day=end.slice(0,10);
const fixtures=[];
for(const plan of ['uni','all'])for(const status of ['active','past_due']){
 const id=`usr_local_limite_${plan}_${status}`;
 const u={id,name:'Fixture local de acceso',email:id+'@example.invalid',state:'active',role:'student',plan,planSource:'subscription',billingProvider:'stripe',billingStatus:status,billingAccessActive:true,billingPeriodEnd:end,billingTestId:plan==='uni'?'cien':null,selectedTests:['cien'],bonuses:{school:true,address:true},quota:{day,used:20,total:20},medals:{bronze:0,silver:0,gold:0,diamond:0,platinum:0}};
 await db.collection('users').doc(id).set(u);fixtures.push(u);
}
await db.collection('tests').doc('cien').set({id:'cien',label:'Materia ficticia de control',active:true});
await db.collection('questions').doc('q_local_limite').set({id:'q_local_limite',testId:'cien',published:true,statement:'Pregunta ficticia usada solo para comprobar autorización',difficulty:'d2',axis:'control',options:['Control A','Control B'],correct:0});
const billingKeys=['plan','planSource','billingProvider','billingStatus','billingAccessActive','billingPeriodEnd','billingTestId'];
const billing=u=>Object.fromEntries(billingKeys.map(k=>[k,u[k]??null]));
const timings=[];let serial=0;
const app=express();app.use(express.json());
app.use((req,res,next)=>{const start=performance.now(),n=++serial,path=req.path;res.on('finish',()=>timings.push({n,method:req.method,path,status:res.statusCode,duration_ms:performance.now()-start}));next()});
app.use('/api/v1',me);app.use('/api/v1',practice);app.use(errorHandler);
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const origin=`http://127.0.0.1:${server.address().port}`;
let calls=0;
async function request(path,token){calls++;const start=performance.now();const r=await fetch(origin+path,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,body:await r.json(),client_duration_ms:performance.now()-start};}
const results=[];let report;
const realExecutedAt=new Date().toISOString();
try{
 mock.timers.enable({apis:['Date'],now:t-1});
 const control=await request('/api/v1/me');assert.equal(control.status,401);assert.equal(control.body.error.code,'AUTH_REQUIRED');
 for(const u of fixtures){
  mock.timers.setTime(t-1);const token=signAccess(u);const stages=[];
  for(const [stage,now,paid]of [['antes',t-1,true],['limite',t,false],['despues',t+1,false],['repetida',t+1,false]]){
   mock.timers.setTime(now);
   const before=(await db.collection('users').doc(u.id).get()).data();const triesBefore=(await db.collection('practiceSessions').where('userId','==',u.id).get()).size;
   const profile=await request('/api/v1/me',token),quota=await request('/api/v1/me/quota',token),next=await request('/api/v1/practice/next?testId=cien',token);
   assert.equal(profile.status,200);assert.equal(profile.body.data.plan,paid?u.plan:'free');
   assert.equal(quota.status,200);assert.equal(quota.body.data.unlimited,paid);assert.equal(quota.body.data.used,20);assert.equal(quota.body.data.max,paid?999999:20);assert.equal(quota.body.data.freeMax,20);
   assert.equal(next.status,paid?200:422);if(!paid)assert.equal(next.body.error.code,'QUOTA_DAILY_LIMIT');
   const after=(await db.collection('users').doc(u.id).get()).data(),triesAfter=(await db.collection('practiceSessions').where('userId','==',u.id).get()).size;
   assert.deepEqual(billing(after),billing(before));assert.equal(after.quota.used,20);assert.equal(triesAfter-triesBefore,paid?1:0);
   stages.push({stage,time:new Date(now).toISOString(),expected:{plan:paid?u.plan:'free',unlimited:paid,next_status:paid?200:422},profile,quota,next,before:{billing:billing(before),quota:before.quota,attempt_count:triesBefore},after:{billing:billing(after),quota:after.quota,attempt_count:triesAfter},result:'Aprobado'});
  }
  results.push({user_id:u.id,plan:u.plan,status:u.billingStatus,stages});
 }
 // Muestra local del tramo servidor GET /me; reloj de duración monotónico.
 mock.timers.setTime(t-1);const token=signAccess(fixtures[0]);const first=timings.length;
 for(let i=0;i<30;i++){const r=await request('/api/v1/me',token);assert.equal(r.status,200);assert.equal(r.body.data.plan,'uni');}
 const sample=timings.slice(first).filter(x=>x.path==='/api/v1/me');assert.equal(sample.length,30);
 const sorted=sample.map(x=>x.duration_ms).sort((a,b)=>a-b);const performanceSample={operation:'GET /api/v1/me',N:30,concurrency:1,environment:'HTTP local + Firestore Emulator Standard; sin llamadas Stripe',timing:'performance.now al entrar en Express hasta finish de la respuesta; separado del tiempo cliente; Date controlada no altera este reloj',samples:sample,p95_ms:sorted[Math.ceil(.95*sorted.length)-1],under_3000_ms:sample.filter(x=>x.status===200&&x.duration_ms<3000).length,limits:'No mide Vercel ni Firestore remoto. No acredita RNF-07 en el despliegue ni cambia estado PG18 con esta muestra aislada.'};
 mock.timers.reset();
 const hashes=[];for(const f of ['routes/me.js','routes/practice.js','middleware/auth.js','data/repo.js','data/firestore.js','lib/jwt.js','lib/quota.js','lib/entitlements.js']){const b=await fs.readFile(new URL('./codigo/src/'+f,import.meta.url));hashes.push({file:'backend/src/'+f,sha256:crypto.createHash('sha256').update(b).digest('hex')})}
 report={executed_at_utc:realExecutedAt,commit:'d1ac22791bdf6f276c8dcce3ec02d707daca3735',environment:{project,edition:'standard',firestore_host:host,http_origin:origin,node:process.version,data_driver:'firestore'},scope:'Rutas HTTP originales /me, /me/quota y /practice/next, auth JWT original y persistencia en emulador. Tiempo de Date controlado solo en el proceso del ensayo. Cuatro usuarios y una pregunta ficticios; no valida contenido educativo.',production_code_modified:false,live_accounts_modified:false,hashes,authentication_control:control,scenario_count:16,scenario_passed:16,http_requests:calls,results,performanceSample,conclusion:'La API devuelve el plan pagado antes del fin y free desde el límite exacto. Tras agotar cuota gratuita, práctica permite acceso antes y lo deniega desde el límite. Repetición no crea intentos ni cambia campos de facturación. La retirada efectiva se calcula al leer: los campos guardados plan/billingAccessActive/billingStatus no se limpian automáticamente en estas rutas.',limits:'No acredita webhook real de vencimiento, interfaz del alumno, relojes remotos, notificaciones, sincronización durable de estado ni una transición única auditada. NPG09 permanece abierta y PG10/11/12 parciales. Los 16 escenarios HTTP y 30 muestras locales se cuentan aparte de los 57 casos principales.'};
 await fs.writeFile(new URL('Resultado_limite_API.json',O),JSON.stringify(report,null,2));
 console.log(JSON.stringify({scenarios:16,passed:16,http_requests:calls,p95_local_ms:performanceSample.p95_ms,under3seconds:performanceSample.under_3000_ms,conclusion:report.conclusion}));
}finally{mock.timers.reset();await new Promise(r=>server.close(r));for(const a of getApps())await deleteApp(a);}
