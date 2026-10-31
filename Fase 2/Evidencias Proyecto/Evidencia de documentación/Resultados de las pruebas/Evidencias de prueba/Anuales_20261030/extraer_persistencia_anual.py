from pathlib import Path
import json,hashlib
R=Path('/workspace/scratch/2d7c4b51b596');O=R/'anual_20261030/evidencias'
refs=[{'alias':'C','user':'usr_61a4061122','sub':'sub_1UW3S9AhY3J8iTOwMNeaVbsS','invoice':'in_1UW3S8AhY3J8iTOwD901Ktuh','plan':'uni','test':'cien','amount':1000}, {'alias':'E','user':'usr_d58ab7f21d','sub':'sub_1UW3hlAhY3J8iTOwH4EJiYeO','invoice':'in_1UW3hjAhY3J8iTOw9fvTzsZ3','plan':'all','test':None,'amount':5000}]
allowed={
 'users':{'id','state','plan','selectedTests','stripeSubscriptionId','billingAccessActive','billingTestId','stripeCustomerId','billingPeriodEnd','billingProvider','billingStatus','billingUpdatedAt','quota'},
 'subscriptions':{'id','userId','livemode','accessActive','paymentPending','currentPeriodStart','currentPeriodEnd','createdAt','provider','billingCycle','latestInvoiceId','cancelAtPeriodEnd','testId','paidEntitlement','priceId','stripeCustomerId','plan','stripePlan','status','updatedAt','checkoutSessionId'},
 'invoices':{'id','amount','livemode','userId','createdAt','stripeSubscriptionId','provider','paidAt','currency','stripeCustomerId','status','updatedAt'},
 'checkoutAttempts':{'attemptId','userId','plan','billingCycle','priceId','testId','amountCents','createdAt','sessionId','closed'},
 'checkoutSessions':{'id','userId','attemptId','plan','billingCycle','priceId','testId','amountCents','createdAt','sessionId','closed','status','stripeSubscriptionId','subscriptionId','stripeCustomerId','customerId','completedAt','updatedAt','amount','currency'},
}
sources=[]
for filename in ['PG13_ANTES.json','PG13_DESPUES.json']:
 p=R/'upload'/filename;full=json.loads(p.read_text());m=full['metadata']
 assert m['projectId']=='aprueba-mvp-pruebas-2fc41' and m['complete'] and not full['errors']
 bypath={x['path']:x for x in full['documents']};extracted=[];checks=[]
 for ref in refs:
  paths=[f"users/{ref['user']}",f"subscriptions/{ref['sub']}",f"invoices/{ref['invoice']}",f"checkoutAttempts/{ref['user']}"]
  sub=bypath[paths[1]]['data'];session=sub.get('checkoutSessionId')
  if session and 'checkoutSessions/'+session in bypath:paths.append('checkoutSessions/'+session)
  for path in paths:
   raw=bypath[path];collection=path.split('/')[0]
   extracted.append({'alias':ref['alias'],'path':path,'createTime':raw.get('createTime'),'updateTime':raw.get('updateTime'),'data':{k:v for k,v in raw['data'].items()if k in allowed[collection]}})
  user=bypath[paths[0]]['data'];invoice=bypath[paths[2]]['data'];attempt=bypath[paths[3]]['data']
  def numeric(v):return int(v['value'])if isinstance(v,dict)and v.get('__firestoreType')=='integer64'else float(v)
  verified={
   'same_user':sub['userId']==invoice['userId']==ref['user'],
   'same_invoice':sub['latestInvoiceId']==ref['invoice']==sub['paidEntitlement']['invoiceId'],
   'same_subscription':user['stripeSubscriptionId']==ref['sub']==invoice['stripeSubscriptionId'],
   'plan':user['plan']==sub['plan']==sub['paidEntitlement']['plan']==ref['plan'],
   'annual':sub['billingCycle']==sub['paidEntitlement']['billingCycle']==attempt['billingCycle']=='yearly',
   'active':user['billingAccessActive']is True and sub['accessActive']is True and sub['status']=='active',
   'no_pending_payment':sub['paymentPending']is False,
   'invoice_paid':invoice['status']=='paid' and invoice['livemode']is False,
   'same_end':user['billingPeriodEnd']==sub['currentPeriodEnd']==sub['paidEntitlement']['currentPeriodEnd'],
   'paid_test':user['billingTestId']==sub['testId']==ref['test'],
   'amounts':numeric(invoice['amount'])*100==numeric(attempt['amountCents'])==ref['amount'] and invoice['currency'].lower()=='usd',
   'checkout_closed':attempt['closed']is True,
  }
  assert all(verified.values()),(ref['alias'],verified)
  checks.append({'alias':ref['alias'],'checks':verified,'all_true':True,'limits':'Verifica campos persistidos; no ejecuta la autorización de API ni una práctica por interfaz.'})
 sources.append({'source_filename':filename,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'metadata':{k:m[k]for k in ['projectId','databaseId','startedAt','finishedAt','complete']},'records':extracted,'checks':checks})
same=sources[0]['records']==sources[1]['records'];assert same
out={'generatedFrom':'Exportaciones completas ya recibidas; filtrado local sin nuevas consultas Firestore','privacy':'Lista permitida de campos. Se excluyen contraseñas, hashes, tokens, contactos y enlaces privados de facturas. No se adjuntan exportaciones completas.','sources':sources,'same_filtered_records_before_after':same,'records_per_export':len(sources[0]['records']),'limits':['Fuentes del 30-10 01:25–01:30Z anteriores al incidente de cuota. No certifican disponibilidad actual.','Exportaciones secuenciales; no instantáneas atómicas.','Persistencia y derecho pagado no equivalen a práctica completada ni observación de Mi plan/administración.','No compara todos los datos de las cuentas; solo campos permitidos.']}
(O/'Firestore_anuales_filtrado.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'filtered_records_per_export':out['records_per_export'],'sources_match':same,'checks':checks},ensure_ascii=False))
