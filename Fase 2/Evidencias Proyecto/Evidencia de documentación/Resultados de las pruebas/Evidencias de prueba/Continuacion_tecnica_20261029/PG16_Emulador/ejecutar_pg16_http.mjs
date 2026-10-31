import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import express from './deps/node_modules/express/index.js';
import Stripe from './deps/node_modules/stripe/esm/stripe.esm.node.js';
const project='demo-aprueba-pg16';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8187');
assert.equal(process.env.DATA_DRIVER,'firestore');
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
process.env.STRIPE_SECRET_KEY='sk_test_local_'+crypto.randomBytes(24).toString('hex');
const secret='whsec_local_'+crypto.randomBytes(24).toString('hex');process.env.STRIPE_WEBHOOK_SECRET=secret;
const {initFirestore}=await import('./codigo/src/config/firebase.js');
const {verifyStripeWebhook}=await import('./codigo/src/middleware/verifyStripeWebhook.js');
const {stripeWebhookHandler}=await import('./codigo/src/routes/stripeWebhook.js');
const {deleteApp}=await import('./deps/node_modules/firebase-admin/lib/app/index.js');
const {getApps}=await import('./deps/node_modules/firebase-admin/lib/app/index.js');
const {db}=await initFirestore();
assert.equal(db.projectId,project);
for(const collection of ['users','subscriptions','invoices','stripeEvents'])await db.collection(collection).doc('local_sentinel').set({localFixture:true,value:'Sin cambios',collection});
async function snapshot(){
 const rows=[];
 async function scan(collection){const docs=await collection.get();for(const d of docs.docs){rows.push({path:d.ref.path,data:d.data(),createTime:d.createTime.toDate().toISOString(),updateTime:d.updateTime.toDate().toISOString()});for(const sub of await d.ref.listCollections())await scan(sub);}}
 for(const c of await db.listCollections())await scan(c);
 return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
const before=await snapshot();assert.equal(before.length,4);
// Control independiente: el comparador debe detectar una escritura y su eliminación.
await db.collection('controlComparator').doc('write_check').set({expectedDetection:true});
assert.notDeepEqual(await snapshot(),before);
await db.collection('controlComparator').doc('write_check').delete();assert.deepEqual(await snapshot(),before);
const app=express();let handlerCalls=0;
app.post('/api/v1/webhooks/stripe',express.raw({type:'application/json',limit:'1mb'}),verifyStripeWebhook,(req,res)=>{handlerCalls++;return stripeWebhookHandler(req,res)});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const url=`http://127.0.0.1:${server.address().port}/api/v1/webhooks/stripe`;
const signer=new Stripe(process.env.STRIPE_SECRET_KEY);
const event={id:'evt_local_pg16_control',object:'event',type:'aprueba.webhook.check',created:Math.floor(Date.now()/1000),livemode:false,data:{object:{id:'local_check'}}};
const body=JSON.stringify(event);const sign=(payload,timestamp)=>signer.webhooks.generateTestHeaderString({payload,secret,...(timestamp?{timestamp}:{})});
const live=JSON.stringify({...event,livemode:true});const invalid=JSON.stringify({...event,object:'invalid'});
const specs=[
 ['HTTP-FIRMA01','Control válido de evento ignorado',body,sign(body),200,null,1],
 ['HTTP-FIRMA02','Firma ausente',body,null,400,'WEBHOOK_SIGNATURE_MISSING',0],
 ['HTTP-FIRMA03','invoice.paid sintético con firma inválida',JSON.stringify({...event,id:'evt_local_pg16_invalid_invoice',type:'invoice.paid',data:{object:{id:'in_test_nonexistent'}}}),'t=0,v1=invalid_test_signature',400,'WEBHOOK_SIGNATURE_INVALID',0],
 ['HTTP-FIRMA04','Contenido alterado después de firmar',body+' ',sign(body),400,'WEBHOOK_SIGNATURE_INVALID',0],
 ['HTTP-FIRMA05','Firma con timestamp vencido',body,sign(body,1),400,'WEBHOOK_SIGNATURE_INVALID',0],
 ['HTTP-FIRMA06','Evento firmado de modo real',live,sign(live),400,'WEBHOOK_TEST_MODE_REQUIRED',0],
 ['HTTP-FIRMA07','Evento firmado de formato inválido',invalid,sign(invalid),400,'WEBHOOK_EVENT_INVALID',0],
 ['HTTP-FIRMA08','Content-Type incompatible con express.raw',body,sign(body),400,'WEBHOOK_BODY_INVALID',0,'text/plain'],
 ['HTTP-FIRMA09','Receptor sin secreto configurado',body,sign(body),503,'WEBHOOK_NOT_CONFIGURED',0,'application/json',true]
];
const results=[];
try{
 for(const [id,description,payload,signature,status,code,calls,contentType='application/json',unconfigured=false]of specs){
  const countBefore=handlerCalls;const dataBefore=await snapshot();if(unconfigured)delete process.env.STRIPE_WEBHOOK_SECRET;
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':contentType,...(signature?{'Stripe-Signature':signature}:{})},body:payload});
  const json=await response.json();process.env.STRIPE_WEBHOOK_SECRET=secret;
  const dataAfter=await snapshot();const observed={status:response.status,code:json.error?.code??null,handlerCalls:handlerCalls-countBefore,unchanged:JSON.stringify(dataBefore)===JSON.stringify(dataAfter)};
  let error=null;try{assert.deepEqual(observed,{status,code,handlerCalls:calls,unchanged:true});if(calls)assert.equal(json.data.ignored,true)}catch(e){error=e.message}
  results.push({id,description,expected:{status,code,handlerCalls:calls,unchanged:true},observed,response:json,before:dataBefore,after:dataAfter,result:error?'Fallido':'Aprobado',...(error?{error}:{})});
 }
 const hashes=[];for(const f of ['middleware/verifyStripeWebhook.js','routes/stripeWebhook.js','services/stripeBilling.js','config/firebase.js','config/stripe.js','lib/envelope.js']){const b=await fs.readFile(new URL('./codigo/src/'+f,import.meta.url));hashes.push({file:'backend/src/'+f,sha256:crypto.createHash('sha256').update(b).digest('hex')})}
 const report={executedAt:new Date().toISOString(),commit:'d1ac22791bdf6f276c8dcce3ec02d707daca3735',project,edition:'standard local emulator',endpoint:url,node:process.version,express:'4.19.2',stripe:'22.6.2',firebaseAdmin:'14.3.0',kind:'HTTP local con ruta Express equivalente y módulos originales sin cambios',scope:'Receptor HTTP mínimo con express.raw, middleware y handler originales; Firestore Emulator con cuatro registros ficticios y comparación completa local antes/después de cada caso. Control válido usa evento no soportado que se ignora.',limits:'No inicia todo index.js ni prueba Vercel o entregas de Stripe. El control válido no ejecuta un pago ni comprueba processStripeEvent con eventos de negocio. No acredita PG13/14/15/17 ni agrega casos a los 57. El resultado se limita al rechazo y ausencia de cambios en el receptor HTTP local probado.',comparatorPositiveControl:true,hashes,total:results.length,passed:results.filter(r=>r.result==='Aprobado').length,results};
 await fs.writeFile(new URL('./Resultados_PG16_HTTP_emulador.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify({total:report.total,passed:report.passed,results:results.map(({id,result,observed})=>({id,result,observed}))},null,2));
 if(report.passed!==report.total)process.exitCode=1;
}finally{await new Promise(resolve=>server.close(resolve));for(const app of getApps())await deleteApp(app)}
