import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import https from 'node:https';
import express from './deps/node_modules/express/index.js';
import Stripe from './deps/node_modules/stripe/esm/stripe.esm.node.js';
import {getApps,deleteApp} from './deps/node_modules/firebase-admin/lib/app/index.js';
assert.equal(process.env.GCLOUD_PROJECT,'demo-aprueba-pg16');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8187');
assert.equal(process.env.DATA_DRIVER,'firestore');
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
process.env.STRIPE_SECRET_KEY='sk_test_fixture_'+crypto.randomBytes(24).toString('hex');
const secret='whsec_fixture_'+crypto.randomBytes(24).toString('hex');process.env.STRIPE_WEBHOOK_SECRET=secret;
for(const [key,value]of Object.entries({STRIPE_PRICE_UNI_MONTHLY:'price_uni_monthly',STRIPE_PRICE_UNI_YEARLY:'price_uni_yearly',STRIPE_PRICE_ALL_MONTHLY:'price_all_monthly',STRIPE_PRICE_ALL_YEARLY:'price_all_yearly'}))process.env[key]=value;
const {initFirestore}=await import('./codigo/src/config/firebase.js');
const {getStripe}=await import('./codigo/src/config/stripe.js');
const {verifyStripeWebhook}=await import('./codigo/src/middleware/verifyStripeWebhook.js');
const {stripeWebhookHandler}=await import('./codigo/src/routes/stripeWebhook.js');
const {db}=await initFirestore();assert.equal(db.projectId,'demo-aprueba-pg16');
const stripe=getStripe();let fixture,phase='',failSession=false,barrier=null,apiCalls=[],externalRequests=0;
const originalHttpsRequest=https.request;https.request=function(){externalRequests++;throw new Error('EXTERNAL_NETWORK_FORBIDDEN_BY_HARNESS')};
const clone=x=>structuredClone(x);
stripe.invoices.retrieve=async id=>{
 apiCalls.push({phase,method:'invoices.retrieve',id});
 if(barrier&&id===fixture.invoice.id){const b=barrier;b.arrivals++;if(b.arrivals===2){barrier=null;b.release()}else await b.promise;}
 const v=id===fixture.invoice.id?fixture.invoice:fixture.oldInvoice;assert.equal(id,v.id);return clone(v);
};
stripe.subscriptions.retrieve=async id=>{apiCalls.push({phase,method:'subscriptions.retrieve',id});assert.equal(id,fixture.subscription.id);return clone(fixture.subscription)};
stripe.checkout.sessions.retrieve=async id=>{apiCalls.push({phase,method:'checkout.sessions.retrieve',id});assert.equal(id,fixture.session.id);if(failSession){failSession=false;throw Object.assign(new Error('Fallo reversible inducido dentro de la transacción'),{code:'TEMPORARY_FIXTURE_FAILURE'})}return clone(fixture.session)};
stripe.invoices.list=async()=>{throw new Error('UNEXPECTED_FIXTURE_LIST')};
async function snapshot(){const rows=[];async function scan(c){for(const d of (await c.get()).docs){rows.push({path:d.ref.path,data:d.data(),createTime:{seconds:d.createTime.seconds,nanoseconds:d.createTime.nanoseconds},updateTime:{seconds:d.updateTime.seconds,nanoseconds:d.updateTime.nanoseconds}});for(const s of await d.ref.listCollections())await scan(s)}}for(const c of await db.listCollections())await scan(c);return rows.sort((a,b)=>a.path.localeCompare(b.path))}
async function reset(alias){
 for(const c of await db.listCollections())await db.recursiveDelete(c);
 const now=Math.floor(Date.now()/1000),user='usr_local_'+alias,attempt='attempt_'+alias,customer='cus_local'+alias,sub='sub_local'+alias,invoice='in_local'+alias,session='cs_test_local'+alias;
 const metadata={integration:'aprueba_mvp',userId:user,attemptId:attempt};
 const inv={id:invoice,object:'invoice',livemode:false,currency:'usd',customer,subscription:sub,status:'paid',amount_remaining:0,amount_paid:500,amount_due:500,created:now-30,status_transitions:{paid_at:now-20}};
 const subscription={id:sub,object:'subscription',livemode:false,customer,metadata,status:'active',created:now-60,cancel_at_period_end:false,latest_invoice:inv,items:{has_more:false,data:[{quantity:1,current_period_start:now-60,current_period_end:now+2592000,price:{id:'price_all_monthly',livemode:false,currency:'usd',unit_amount:500,product:'prod_aprueba_all',type:'recurring',billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}};
 fixture={now,user,attempt,invoice:inv,oldInvoice:{...inv,id:'in_old'+alias,status:'open',amount_remaining:500,amount_paid:0,status_transitions:{paid_at:null}},subscription,session:{id:session,object:'checkout.session',livemode:false,mode:'subscription',client_reference_id:user,metadata,customer,subscription:sub,status:'complete',payment_status:'paid'}};
 await db.collection('users').doc(user).set({id:user,name:'Fixture local '+alias,plan:'free',state:'active',selectedTests:['cien']});
 await db.collection('checkoutSessions').doc(session).set({id:session,userId:user,attemptId:attempt,testId:null});
 await db.collection('checkoutAttempts').doc(user).set({attemptId:attempt,closed:false});
 return clone(fixture);
}
function event(id,type='invoice.paid',objectId=fixture.invoice.id,created=fixture.now){return {id:'evt_local_'+id,object:'event',type,livemode:false,created,data:{object:{id:objectId}}}}
const app=express();let inflight=0,maxInflight=0;const logs=[];const oldConsoleError=console.error;console.error=(...args)=>{logs.push(args.map(String));oldConsoleError(...args)};
app.post('/api/v1/webhooks/stripe',express.raw({type:'application/json',limit:'1mb'}),verifyStripeWebhook,async(req,res)=>{inflight++;maxInflight=Math.max(maxInflight,inflight);try{await stripeWebhookHandler(req,res)}finally{inflight--}});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const url=`http://127.0.0.1:${server.address().port}/api/v1/webhooks/stripe`;
async function send(e){const body=JSON.stringify(e),start=new Date().toISOString();const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':stripe.webhooks.generateTestHeaderString({payload:body,secret})},body});return {event:e,start,finish:new Date().toISOString(),status:response.status,body:await response.json()}}
const results=[];
function business(rows){const u=rows.find(r=>r.path==='users/'+fixture.user)?.data;const s=rows.find(r=>r.path==='subscriptions/'+fixture.subscription.id)?.data;return {plan:u?.plan,active:u?.billingAccessActive,status:u?.billingStatus,end:u?.billingPeriodEnd,subPlan:s?.plan,subActive:s?.accessActive,subEnd:s?.currentPeriodEnd,latestInvoice:s?.latestInvoiceId}}
function verifyActive(rows){const b=business(rows);assert.equal(b.plan,'all');assert.equal(b.active,true);assert.equal(b.subActive,true);assert.equal(b.end,new Date(fixture.subscription.items.data[0].current_period_end*1000).toISOString());assert.equal(rows.filter(r=>r.path.startsWith('subscriptions/')).length,1);assert.equal(rows.filter(r=>r.path.startsWith('invoices/')).length,1);return b}
async function run(id,description,fn){phase=id;const firstLog=logs.length,firstApi=apiCalls.length;let output=null,error=null;try{output=await fn()}catch(e){error={message:e.message,stack:e.stack}}results.push({id,description,result:error?'Fallido':'Aprobado',output,error,logs:logs.slice(firstLog),stripeReadDoubles:apiCalls.slice(firstApi)});console.log(id,error?'FALLIDO '+error.message:'APROBADO')}
try{
 await run('PG-13','Reentrega secuencial idéntica con persistencia real emulada y Stripe simulado',async()=>{
  const initial=await reset('PG13'),before=await snapshot(),e=event('PG13'),first=await send(e);assert.equal(first.status,200);assert.equal(first.body.data.processed,true);const afterFirst=await snapshot();verifyActive(afterFirst);
  const second=await send(e),afterSecond=await snapshot();assert.equal(second.status,200);assert.equal(second.body.data.duplicate,true);assert.deepEqual(afterSecond,afterFirst);assert.equal(afterSecond.filter(r=>r.path.startsWith('stripeEvents/')).length,1);
  return {initial,before,first,afterFirst,second,afterSecond,conclusion:'La reentrega no vuelve a escribir ni extiende el beneficio; no acredita un reenvío de evento real Stripe.'};
 });
 await run('PG-14','Dos entregas idénticas concurrentes y transacción con deduplicación',async()=>{
  const initial=await reset('PG14'),before=await snapshot(),e=event('PG14');let release;const promise=new Promise(r=>release=r);barrier={promise,release,arrivals:0};maxInflight=0;
  const timer=setTimeout(()=>release(),15000);const responses=await Promise.all([send(e),send(e)]);clearTimeout(timer);barrier=null;assert.equal(maxInflight,2);
  assert.ok(responses.every(r=>r.status===200));assert.equal(responses.filter(r=>r.body.data.processed===true).length,1);assert.equal(responses.filter(r=>r.body.data.duplicate===true).length,1);
  const after=await snapshot();verifyActive(after);assert.equal(after.filter(r=>r.path.startsWith('stripeEvents/')).length,1);
  const third=await send(e),afterThird=await snapshot();assert.equal(third.body.data.duplicate,true);assert.deepEqual(afterThird,after);
  return {initial,before,responses,maxInflight,after,third,afterThird,conclusion:'Una aplicación y una respuesta duplicate bajo simultaneidad comprobada; tercera entrega sin cambios.'};
 });
 await run('PG-15','Eventos antiguos respetan el estado actual consultado al proveedor simulado',async()=>{
  const initial=await reset('PG15'),before=await snapshot(),current=await send(event('PG15_current','customer.subscription.updated',fixture.subscription.id));assert.equal(current.status,200);const active=await snapshot();verifyActive(active);
  const older=await send(event('PG15_old_fail','invoice.payment_failed',fixture.oldInvoice.id,fixture.now-3600));assert.equal(older.status,200);const afterOlder=await snapshot();assert.deepEqual(business(afterOlder),business(active));assert.equal(afterOlder.find(r=>r.path==='invoices/'+fixture.invoice.id).data.status,'paid');
  fixture.subscription.status='canceled';const canceled=await send(event('PG15_cancel','customer.subscription.deleted',fixture.subscription.id,fixture.now+1));assert.equal(canceled.status,200);const afterCancel=await snapshot();assert.equal(business(afterCancel).active,false);assert.equal(business(afterCancel).plan,'free');
  const oldPaid=await send(event('PG15_old_paid','invoice.paid',fixture.invoice.id,fixture.now-7200));assert.equal(oldPaid.status,200);const final=await snapshot();assert.deepEqual(business(final),business(afterCancel));assert.equal(final.filter(r=>r.path.startsWith('stripeEvents/')).length,4);
  return {initial,before,current,active,older,afterOlder,canceled,afterCancel,oldPaid,final,conclusion:'La regla observada consulta el estado actual de la suscripción; no ordena exclusivamente por event.created. El evento antiguo no revoca acceso vigente ni reactiva una suscripción cancelada.'};
 });
 await run('PG-17','Fallo reversible dentro de la transacción, recuperación y reentrega sin cambios',async()=>{
  const initial=await reset('PG17'),before=await snapshot(),e=event('PG17');failSession=true;
  const failed=await send(e),afterFailure=await snapshot();assert.equal(failed.status,503);assert.equal(failed.body.error.code,'WEBHOOK_PROCESSING_FAILED');assert.deepEqual(afterFailure,before);assert.ok(logs.some(r=>r.includes('TEMPORARY_FIXTURE_FAILURE')));
  const retry=await send(e);assert.equal(retry.status,200);assert.equal(retry.body.data.processed,true);const afterRetry=await snapshot();verifyActive(afterRetry);
  const replay=await send(e),afterReplay=await snapshot();assert.equal(replay.status,200);assert.equal(replay.body.data.duplicate,true);assert.deepEqual(afterReplay,afterRetry);assert.equal(afterReplay.filter(r=>r.path.startsWith('stripeEvents/')).length,1);
  return {initial,before,failed,afterFailure,retry,afterRetry,replay,afterReplay,conclusion:'503 y registro en consola del handler, sin recibo ni escritura parcial. Reintento aplica una vez. No acredita auditoría duradera ni reintento automático del proveedor.'};
 });
 assert.equal(externalRequests,0);
 const hashes=[];for(const f of ['middleware/verifyStripeWebhook.js','routes/stripeWebhook.js','services/stripeBilling.js','config/firebase.js','config/stripe.js','lib/envelope.js']){const b=await fs.readFile(new URL('./codigo/src/'+f,import.meta.url));hashes.push({file:'backend/src/'+f,sha256:crypto.createHash('sha256').update(b).digest('hex')})}
 const report={executedAt:new Date().toISOString(),commit:'d1ac22791bdf6f276c8dcce3ec02d707daca3735',environment:{project:'demo-aprueba-pg16',edition:'standard',firestoreHost:process.env.FIRESTORE_EMULATOR_HOST,url,node:process.version},kind:'Integración local HTTP y Firestore Emulator con dobles explícitos de consultas Stripe',scope:'Middleware, handler, servicio de negocio y transacciones originales. SDK Stripe real para firma local; subscriptions.retrieve, invoices.retrieve y checkout.sessions.retrieve sustituidos por fixtures de lectura. Sin cuentas, cobros ni API Stripe real.',limits:'No acredita entrega/reenvío real Stripe–Vercel, ausencia de cobros duplicados en el proveedor, reintentos automáticos ni persistencia de errores en auditoría. PG13 mantiene pendiente su precondición de evento real.',hashes,externalRequests,total:results.length,passed:results.filter(r=>r.result==='Aprobado').length,results};
 await fs.writeFile(new URL('./Resultados_webhooks_negocio_local.json',import.meta.url),JSON.stringify(report,null,2));if(report.passed!==report.total)process.exitCode=1;
}finally{console.error=oldConsoleError;https.request=originalHttpsRequest;await new Promise(r=>server.close(r));for(const a of getApps())await deleteApp(a)}
