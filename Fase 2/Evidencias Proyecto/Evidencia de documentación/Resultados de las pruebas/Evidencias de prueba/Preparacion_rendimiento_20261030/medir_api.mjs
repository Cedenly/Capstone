import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import readline from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
const BASE='https://aprueba-student-api.vercel.app/api/v1';
const PATHS=['/me','/me/quota'];
export function summarize(samples,expected=30,threshold=3000){
 const durations=samples.map(s=>s.duration_ms).sort((a,b)=>a-b);
 const success=samples.filter(s=>s.ok&&s.duration_ms<threshold).length;
 return {expected,observed:samples.length,completed:samples.length===expected,threshold_ms:threshold,under_threshold_and_correct:success,required:Math.ceil(.95*expected),p95_http_client_ms:durations.length?durations[Math.ceil(.95*durations.length)-1]:null,within_sample_target:samples.length===expected&&success>=Math.ceil(.95*expected)};
}
export async function collect({token,fetchImpl=fetch,clock=()=>performance.now(),N=30,pause=200}){
 if(!token)throw new Error('TOKEN_REQUIRED');
 const groups=[];
 for(const path of PATHS){
  const samples=[];let stopReason=null;
  for(let i=0;i<N;i++){
   const start=clock();let sample;
   try{
    const response=await fetchImpl(BASE+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
    const body=await response.json();const data=body?.data;
    const valid=path==='/me'?typeof data?.plan==='string':Number.isFinite(data?.used)&&Number.isFinite(data?.max)&&typeof data?.unlimited==='boolean';
    sample={index:i+1,status:response.status,duration_ms:clock()-start,ok:response.status===200&&!body.error&&valid,requestId:typeof body?.meta?.requestId==='string'&&/^req_[a-f0-9-]{1,50}$/i.test(body.meta.requestId)?body.meta.requestId:null};
    if([401,403,429].includes(response.status)||response.status>=500)stopReason='HTTP_'+response.status;
   }catch(error){sample={index:i+1,status:null,duration_ms:clock()-start,ok:false,requestId:null};stopReason=error?.name==='TimeoutError'?'TIMEOUT':'TRANSPORT_OR_FORMAT_ERROR';}
   samples.push(sample);if(stopReason)break;
   if(pause)await new Promise(r=>setTimeout(r,pause));
  }
  groups.push({operation:'GET '+path,stopReason,samples,summary:summarize(samples,N)});
  if(stopReason)break;
 }
 return groups;
}
async function hiddenPrompt(label){
 const input=process.stdin,output=process.stdout;
 if(!input.isTTY||!output.isTTY)throw new Error('TERMINAL_INTERACTIVA_REQUERIDA');
 output.write(label);input.setRawMode(true);input.resume();input.setEncoding('utf8');let secret='';
 return new Promise((resolve,reject)=>{
  const restore=()=>{input.removeListener('data',onData);input.setRawMode(false);input.pause();output.write('\n')};
  const onData=chunk=>{for(const char of chunk){if(char==='\u0003'){restore();reject(new Error('CANCELADO'));return}if(char==='\r'||char==='\n'){restore();resolve(secret);return}if(char==='\u007f'||char==='\b'){secret=secret.slice(0,-1);continue}if(char>=' ')secret+=char}};
  input.on('data',onData);
 });
}
async function main(){
 console.log('Destino fijo: '+BASE+' (entorno de pruebas de Aprueba).');
 console.log('Solo cuenta dedicada de prueba. Login puede conceder premio diario; GET /me guarda el perfil y normaliza la cuota. No se responde, compra ni modifica suscripciones.');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 const email=(await rl.question('Correo de prueba [renov@renov.com]: ')).trim()||'renov@renov.com';rl.close();
 let password=await hiddenPrompt('Contraseña (no se muestra ni se guarda): ');
 const login=await fetch(BASE+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),redirect:'error',signal:AbortSignal.timeout(10000)});password='';
 const body=await login.json();if(login.status!==200||typeof body?.data?.accessToken!=='string')throw new Error('LOGIN_NO_CONFIRMADO_HTTP_'+login.status);
 let token=body.data.accessToken;delete body.data.accessToken;delete body.data.refreshToken;
 const startedAt=new Date().toISOString();const groups=await collect({token});token='';
 const report={kind:'Muestra HTTP cliente del despliegue',executedAt:startedAt,finishedAt:new Date().toISOString(),origin:BASE,preparedOnly:false,N_per_operation:30,concurrency:1,interval_ms:200,timing:'performance.now desde fetch hasta JSON recibido, incluye red y lectura de respuesta; login excluido. No es tiempo interno del servidor.',credential_policy:'No se guardan correo, contraseña, tokens, cuerpo de perfil ni datos de pago.',groups,limits:'No mide latencia interna aislada, interfaz, Stripe ni webhook PG19. Una muestra correcta no acredita otras operaciones ni todos los RNF. Si se corta por error, se conserva N esperado y no se aprueba la muestra incompleta.'};
 const name='Resultado_rendimiento_API_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
 await fs.writeFile(name,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 for(const g of groups)console.log(g.operation,JSON.stringify(g.summary));console.log('Resultado guardado: '+name);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(()=>{console.error('No se completó la medición. Revisa conectividad y la cuenta de prueba. No compartas contraseñas ni tokens.');process.exitCode=1})}
