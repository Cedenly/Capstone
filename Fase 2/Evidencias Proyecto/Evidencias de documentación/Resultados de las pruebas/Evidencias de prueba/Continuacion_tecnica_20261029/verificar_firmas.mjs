import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import Stripe from './deps/node_modules/stripe/esm/stripe.esm.node.js';
import {verifyStripeWebhook} from './codigo/backend/src/middleware/verifyStripeWebhook.js';

// Random fixtures exist only in process memory. They are not account credentials.
process.env.STRIPE_SECRET_KEY='sk_test_fixture_'+crypto.randomBytes(24).toString('hex');
process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture_'+crypto.randomBytes(24).toString('hex');
const secret=process.env.STRIPE_WEBHOOK_SECRET;
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const payload={id:'evt_component_check',object:'event',type:'aprueba.webhook.check',created:Math.floor(Date.now()/1000),livemode:false,data:{object:{id:'component_check'}}};
const body=JSON.stringify(payload);
const signed=(body,timestamp)=>stripe.webhooks.generateTestHeaderString({payload:body,secret,...(timestamp?{timestamp}:{})});
const cases=[];
function check(id,description,body,signature,expected,unconfigured=false){
 let captured=null,forwarded=0,status=null,error=null;
 const req={body,get:()=>signature};
 const res={status(n){status=n;return this},json(v){captured=v;return this}};
 if(unconfigured)delete process.env.STRIPE_WEBHOOK_SECRET;
 try{verifyStripeWebhook(req,res,()=>{forwarded++});assert.deepEqual({status,code:captured?.error?.code??null,forwarded},expected);if(forwarded)assert.equal(req.stripeEvent.id,payload.id)}catch(e){error=e.message}
 process.env.STRIPE_WEBHOOK_SECRET=secret;
 cases.push({id,description,expected,observed:{status,code:captured?.error?.code??null,forwarded},result:error?'Fallido':'Aprobado',...(error?{error}:{})});
}
check('UT-FIRMA01','Mensaje válido firmado llega al siguiente middleware',Buffer.from(body),signed(body),{status:null,code:null,forwarded:1});
check('UT-FIRMA02','Sin firma no se reenvía',Buffer.from(body),null,{status:400,code:'WEBHOOK_SIGNATURE_MISSING',forwarded:0});
check('UT-FIRMA03','Firma inválida no se reenvía',Buffer.from(body),'t=0,v1=invalid_test_signature',{status:400,code:'WEBHOOK_SIGNATURE_INVALID',forwarded:0});
check('UT-FIRMA04','Alteración del mensaje después de firmar se rechaza',Buffer.from(body+' '),signed(body),{status:400,code:'WEBHOOK_SIGNATURE_INVALID',forwarded:0});
check('UT-FIRMA05','Firma con marca temporal antigua se rechaza',Buffer.from(body),signed(body,1),{status:400,code:'WEBHOOK_SIGNATURE_INVALID',forwarded:0});
const live=JSON.stringify({...payload,livemode:true});
check('UT-FIRMA06','Mensaje firmado livemode=true se rechaza en el MVP',Buffer.from(live),signed(live),{status:400,code:'WEBHOOK_TEST_MODE_REQUIRED',forwarded:0});
const malformed=JSON.stringify({...payload,object:'other'});
check('UT-FIRMA07','Formato de evento inválido con firma válida se rechaza',Buffer.from(malformed),signed(malformed),{status:400,code:'WEBHOOK_EVENT_INVALID',forwarded:0});
check('UT-FIRMA08','Cuerpo ya parseado no sustituye mensaje original',payload,signed(body),{status:400,code:'WEBHOOK_BODY_INVALID',forwarded:0});
check('UT-FIRMA09','Sin configuración no se reenvía',Buffer.from(body),signed(body),{status:503,code:'WEBHOOK_NOT_CONFIGURED',forwarded:0},true);
const files=['middleware/verifyStripeWebhook.js','config/stripe.js','lib/envelope.js'];
const hashes=[];for(const f of files){const b=await fs.readFile(new URL('./codigo/backend/src/'+f,import.meta.url));hashes.push({file:'backend/src/'+f,sha256:crypto.createHash('sha256').update(b).digest('hex')})}
const r={executedAt:new Date().toISOString(),commit:'d1ac22791bdf6f276c8dcce3ec02d707daca3735',node:process.version,stripeSdk:'22.6.2',kind:'Comprobaciones aisladas del middleware original de la revisión publicada',scope:'Stripe SDK real y middleware original; req/res y next simulados. No inicia servidor HTTP ni llama al handler, Stripe API o Firebase. Firma sintética solo local.',limits:'No aprueba PG16 integral ni PG13/14/15/17; no comprueba despliegue, parser Express, Firestore o efectos de negocio. No agrega casos a los 57 principales.',hashes,total:cases.length,passed:cases.filter(c=>c.result==='Aprobado').length,cases};
await fs.writeFile(new URL('./Resultados_firmas_locales_20261029.json',import.meta.url),JSON.stringify(r,null,2));
console.log(JSON.stringify(r,null,2));
if(r.passed!==r.total)process.exitCode=1;
