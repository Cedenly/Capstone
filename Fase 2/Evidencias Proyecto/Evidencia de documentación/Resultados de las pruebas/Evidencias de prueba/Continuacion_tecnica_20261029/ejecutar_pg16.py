import json,urllib.request,urllib.error,datetime,pathlib,uuid
p=pathlib.Path('/workspace/scratch/2d7c4b51b596/preparacion_tecnica_actual')
event={'id':'evt_aprueba_capstone_invalid_'+uuid.uuid4().hex,'type':'invoice.paid','livemode':False,'data':{'object':{'id':'in_test_nonexistent'}}}
record={'case':'PG-16','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':'https://aprueba-student-api.vercel.app/api/v1/webhooks/stripe','method':'POST','signature':'t=0,v1=invalid_test_signature','payload':event,'scope':'Una sola solicitud sintetica de firma invalida; sin claves, tokens ni cobro'}
request=urllib.request.Request(record['url'],data=json.dumps(event).encode(),method='POST',headers={'Content-Type':'application/json','Stripe-Signature':record['signature']})
try:
 response=urllib.request.urlopen(request,timeout=25);record['http_status']=response.status;record['response']=json.loads(response.read())
except urllib.error.HTTPError as e:
 record['http_status']=e.code
 try:record['response']=json.loads(e.read())
 except Exception:record['response_parse']='No JSON'
except Exception as e:record['transport_error']=str(e)
(p/'PG16_respuesta_20261029.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
print(json.dumps(record,ensure_ascii=False))
