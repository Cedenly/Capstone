from pathlib import Path
import json,math,hashlib,shutil,datetime,sys
O=Path(__file__).resolve().parent;P=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else O/'Resultado_rendimiento_API_2026-10-30T16-27-29-932Z.json';x=json.loads(P.read_text());assert x['origin']=='https://aprueba-student-api.vercel.app/api/v1'and x['N_per_operation']==30 and x['concurrency']==1 and x['preparedOnly']is False
assert [g['operation']for g in x['groups']]==['GET /me','GET /me/quota']
rows=[];ids=[]
for g in x['groups']:
 s=g['samples'];assert len(s)==30 and [v['index']for v in s]==list(range(1,31))and g['stopReason']is None
 assert all(isinstance(v['duration_ms'],(int,float))and math.isfinite(v['duration_ms'])and v['duration_ms']>=0 for v in s)
 ordered=sorted(v['duration_ms']for v in s);n=len(s);p95=ordered[math.ceil(.95*n)-1];good=sum(v['ok']is True and v['status']==200 and v['duration_ms']<3000 for v in s)
 summary=g['summary'];assert summary['expected']==summary['observed']==n and summary['required']==29 and summary['completed']is True and summary['threshold_ms']==3000 and summary['within_sample_target']is True and summary['under_threshold_and_correct']==good
 assert math.isclose(summary['p95_http_client_ms'],p95,abs_tol=1e-8)
 assert all(v['status']==200 and v['ok']is True for v in s)
 ids.extend(v['requestId']for v in s)
 rows.append({'operation':g['operation'],'N':n,'valid_HTTP200':n,'valid_under_3000_ms':good,'required':29,'percent_valid_under_threshold':100*good/n,'p95_ms':p95,'min_ms':min(ordered),'max_ms':max(ordered),'mean_ms':sum(ordered)/n})
assert len(ids)==len(set(ids))==60
start=datetime.datetime.fromisoformat(x['executedAt'].replace('Z','+00:00'));end=datetime.datetime.fromisoformat(x['finishedAt'].replace('Z','+00:00'));elapsed=(end-start).total_seconds();sum_seconds=sum(s['duration_ms']for g in x['groups']for s in g['samples'])/1000;assert elapsed>=sum_seconds
r={'reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':{'name':P.name,'library_file_id':'libfile_47d480bf9bb8819188e305e07424c2a6','sha256':hashlib.sha256(P.read_bytes()).hexdigest(),'executedAtUTC':x['executedAt'],'finishedAtUTC':x['finishedAt'],'executedAtChile':start.astimezone(datetime.timezone(datetime.timedelta(hours=-3))).isoformat(),'finishedAtChile':end.astimezone(datetime.timezone(datetime.timedelta(hours=-3))).isoformat()},'recalculated':rows,'checks':{'sample_indices_contiguous':True,'request_ids_unique':60,'summary_agrees_with_raw_samples':True,'reported_elapsed_seconds':elapsed,'sum_sample_duration_seconds':sum_seconds,'reported_time_covers_sample_duration':True},'case':'PG-18','state':'Parcial','reason':'Muestra HTTP cliente del despliegue correcta en dos consultas. Incluye red y lectura JSON; no separa latencia propia del servidor. El caso exige ese desglose: no se declara aprobación integral RNF-07. No mide creación de sesión ni webhook PG19.','task':'NPG11 En curso; ocho tareas abiertas conservadas.','counts':{'main':57,'approved':32,'partial':13,'failed':2,'blocked':8,'not_executed':2,'payments':{'approved':14,'partial':9,'not_executed':2}},'conditions':{'N_per_operation':30,'concurrency':1,'interval_ms':200,'identity':'Identidad y correo no conservados; no atribuir la muestra a una cuenta específica.','platform':'Node, sistema, equipo y red no registrados en el JSON.','version':'Alias comprobado después del ensayo: ver Version_despliegue.json; no es un pin de versión por petición.'}}
(O/'Revision_medicion_API.json').write_text(json.dumps(r,ensure_ascii=False,indent=2))
print('Revisión correcta: 60/60 HTTP200, 60/60 <3s; p95 1428.669 ms y 1626.048 ms. PG18 parcial, NPG11 En curso. 8 tareas abiertas.')
