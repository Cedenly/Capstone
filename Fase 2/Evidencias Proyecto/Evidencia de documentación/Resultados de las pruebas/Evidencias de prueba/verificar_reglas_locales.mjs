import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {effectivePlan} from './codigo_consulta/aprueba_student_web-main/backend/src/lib/entitlements.js';
import {isUnlimited,freeQuotaMax,ensureQuotaDay,todayKey} from './codigo_consulta/aprueba_student_web-main/backend/src/lib/quota.js';

const root=new URL('./',import.meta.url);
const now=Date.parse('2026-10-29T16:00:00Z');
const expiry='2026-11-29T16:00:00Z';
const base={plan:'uni',billingProvider:'stripe',planSource:'subscription',billingStatus:'active',billingAccessActive:true,billingPeriodEnd:expiry,billingTestId:'cien',selectedTests:['m1']};
const cases=[];
function check(id,description,expected,fn){
 let actual,error;try{actual=fn();assert.deepEqual(actual,expected);}catch(e){error=e.message;}
 cases.push({id,description,expected,actual,status:error?'Fallido':'Aprobado',...(error?{error}:{})});
}
check('UT-01','Usuario sin plan conserva acceso gratuito','free',()=>effectivePlan(null,now));
check('UT-02','Ciencias confirmada dentro del periodo conserva uni','uni',()=>effectivePlan(base,now));
check('UT-03','Todas confirmada dentro del periodo conserva all','all',()=>effectivePlan({...base,plan:'all'},now));
check('UT-04','Pago vencido con acceso confirmado y periodo pagado vigente conserva uni','uni',()=>effectivePlan({...base,billingStatus:'past_due'},now));
check('UT-05','Acceso no confirmado no otorga plan de pago','free',()=>effectivePlan({...base,billingAccessActive:false},now));
check('UT-06','Un milisegundo antes del término conserva beneficio','uni',()=>effectivePlan(base,Date.parse(expiry)-1));
check('UT-07','Exactamente al término pierde beneficio','free',()=>effectivePlan(base,Date.parse(expiry)));
check('UT-08','Después del término pierde beneficio','free',()=>effectivePlan(base,Date.parse(expiry)+1));
check('UT-09','past_due después del término no prolonga beneficio','free',()=>effectivePlan({...base,billingStatus:'past_due'},Date.parse(expiry)+1));
check('UT-10','Fecha de término inválida no otorga beneficio','free',()=>effectivePlan({...base,billingPeriodEnd:'invalida'},now));
check('UT-11','Suscripción cancelada no otorga beneficio aunque fecha sea futura','free',()=>effectivePlan({...base,billingStatus:'canceled'},now));
check('UT-12','Plan gratuito permanece gratuito','free',()=>effectivePlan({...base,plan:'free'},now));
// Quota usa el reloj real; la fecha futura deriva del instante de ejecución.
const live={...base,billingPeriodEnd:new Date(Date.now()+86400000).toISOString()};
check('UT-13','uni habilita Ciencias contratada',true,()=>isUnlimited(live,'cien'));
check('UT-14','Preferir M1 no cambia la materia contratada',false,()=>isUnlimited(live,'m1'));
check('UT-15','uni no otorga ilimitado sin materia asignada',false,()=>isUnlimited({...live,billingTestId:null},'cien'));
check('UT-16','all habilita las cinco materias a nivel de regla',[true,true,true,true,true],()=>['m1','m2','lect','hist','cien'].map(t=>isUnlimited({...live,plan:'all'},t)));
check('UT-17','Suscripción vencida no otorga ilimitado',false,()=>isUnlimited({...live,billingPeriodEnd:new Date(Date.now()-1000).toISOString()},'cien'));
check('UT-18','Cuota gratuita base',10,()=>freeQuotaMax({}));
check('UT-19','Bono colegio',15,()=>freeQuotaMax({bonuses:{school:true}}));
check('UT-20','Bono dirección',15,()=>freeQuotaMax({bonuses:{address:true}}));
check('UT-21','Ambos bonos alcanzan máximo de veinte',20,()=>freeQuotaMax({bonuses:{school:true,address:true}}));
check('UT-22','Contador del mismo día se conserva',4,()=>ensureQuotaDay({quota:{day:todayKey(),used:4,total:4}}).used);
check('UT-23','Contador de otro día se reinicia',0,()=>ensureQuotaDay({quota:{day:'2000-01-01',used:10,total:10}}).used);
const sources=[];for(const name of ['entitlements.js','quota.js']){
 const bytes=await fs.readFile(new URL('codigo_consulta/aprueba_student_web-main/backend/src/lib/'+name,root));
 sources.push({file:'backend/src/lib/'+name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
const report={executedAt:new Date().toISOString(),kind:'Pruebas unitarias locales sobre código entregado, sin modificarlo',limits:'No ejecutan Vercel, Stripe, Firebase ni webhooks. No prueban disponibilidad de preguntas. No cierran casos integrales PG ni aumentan el inventario de 41 casos.',sources,total:cases.length,passed:cases.filter(c=>c.status==='Aprobado').length,cases};
await fs.writeFile(new URL('reglas_locales_resultados.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({total:report.total,passed:report.passed,failed:report.total-report.passed,executedAt:report.executedAt}));
if(report.passed!==report.total)process.exitCode=1;
