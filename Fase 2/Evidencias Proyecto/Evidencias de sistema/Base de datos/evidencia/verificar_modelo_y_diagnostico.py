"""Comprueba los datos citados por las referencias APR-98 y APR-99 sobre REV4."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

VERSION = 'DAD20-LOCAL-20261118-REV4'
DIGEST = '628f864ddd7d2278a847c2bffc2765a1fc2e8989e45c135a1f845443843c9594'


def read(path):
    return json.loads(path.read_bytes())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def only(projection, collection):
    rows = projection[collection]
    assert len(rows) == 1, collection
    return next(iter(rows.items()))


def validate(module, runs):
    manifest_path = module.parent/'MANIFIESTO_MODULO_REV4.json'
    assert sha(manifest_path) == DIGEST
    entries = read(manifest_path)
    for rel, expected in entries.items():
        assert sha(module/rel) == expected, rel

    case = runs/'pruebas_http'
    p = read(case/'report.json')
    assert p['candidate'] == VERSION and p['outcome'] == 'PASS'
    backend = read(case/'source-manifest.json')
    assert sha(case/'source-manifest.json') == p['backendManifestSha256']
    for rel, expected in backend.items():
        assert entries[rel] == expected, rel
    data = {s['label']: s for s in p['observations']}
    after = read(case/'after-confirmation.json')
    before = read(case/'before-confirmation.json')
    uid, user = only(after, 'users')
    pid, attempt = only(after, 'checkoutAttempts')
    cid, checkout = only(after, 'checkoutSessions')
    sid, sub = only(after, 'subscriptions')
    iid, invoice = only(after, 'invoices')
    eid, event = only(after, 'stripeEvents')
    links = {
        'Usuario, reserva y titular': pid == uid == user['id'] == attempt['userId'],
        'Sesión, intento y titular': cid == attempt['sessionId'] and
            attempt['attemptId'] == checkout['attemptId'] and checkout['userId'] == uid,
        'Suscripción de usuario y sesión': sid == user['stripeSubscriptionId'] ==
            checkout['stripeSubscriptionId'] == sub['id'] and sub['userId'] == uid,
        'Factura del derecho con titular y suscripción': iid == invoice['id'] ==
            sub['paidEntitlement']['invoiceId'] and invoice['userId'] == uid and invoice['stripeSubscriptionId'] == sid,
        'Cliente Stripe coincide': user['stripeCustomerId'] == sub['stripeCustomerId'] == invoice['stripeCustomerId'],
        'Recibo v3 de la suscripción y del titular': event['processingVersion'] == 3 and
            event['userId'] == uid and event['stripeSubscriptionId'] == sid,
        'Antes de confirmar, cuenta Gratis sin recibo, factura ni suscripción proyectados':
            before['users'][uid]['plan'] == 'free' and all(not before[k] for k in ['stripeEvents','invoices','subscriptions']),
        'Después de confirmar, acceso activo y factura pagada de USD 5':
            user['billingAccessActive'] and sub['accessActive'] and invoice['amount'] == 5 and
            invoice['currency'] == 'USD' and invoice['status'] == 'paid',
        'Reenvío sin cambio en la proyección': read(case/'before-replay.json') == read(case/'after-replay.json')
    }
    for desc, verified in links.items():
        assert verified, desc
    assert data['checkout-created']['status'] == 201
    assert data['webhook-confirmation']['body']['data']['processed']
    assert data['webhook-replay']['body']['data']['duplicate']
    student, = data['student-invoices']['body']['data']
    admin, = data['admin-invoices']['body']['data']
    assert student['id'] == iid == admin['id'] and student['amount'] == 5 and admin['amountCents'] == 500
    elig = read(case/'materias.json')
    assert elig['candidate'] == VERSION and elig['backendManifestSha256'] == sha(case/'source-manifest.json')
    assert len(elig['controls']) == 18 and all(c['accepted'] for c in elig['controls'])
    assert len(elig['cases']) == 4 and all(c['eligibleAssignment'] == 'CUMPLE' for c in elig['cases'])
    archived, = [c for c in elig['cases'] if c['case'] == 'archivada']
    assert archived['providerProjection'] == {'status':200,'processed':True}
    assert archived['after']['providerPlan'] == 'uni' and archived['after']['plan'] == 'all'
    assert archived['after']['paidEnd'] == archived['before']['paidEnd']
    warning='[stripe webhook] evt_prueba_todas_una_archivada BILLING_TEST_REQUIRED'
    assert warning in (case/'student.log').read_text().splitlines()
    hooks = read(runs/'webhooks/results/report.json')
    assert hooks['status'] == 'PASS' and len(hooks['scenarios']) == 7
    assert all(s['status'] == 'PASS' for s in hooks['scenarios'])
    assert all(entries['student/backend/'+k]==v for k,v in hooks['sourceSha256'].items())
    seq = {}
    for scenario in hooks['scenarios']:
        if scenario['id'] not in ['provider_read','after_commit']:
            continue
        deliveries=scenario['deliveries']
        assert [d['status'] for d in deliveries]==[503,200,200]
        assert deliveries[0]['response']['error']['code']=='WEBHOOK_PROCESSING_FAILED'
        actions=[next(k for k in ['duplicate','processed'] if d['response']['data'].get(k)) for d in deliveries[1:]]
        assert actions==(['processed','duplicate'] if scenario['id']=='provider_read' else ['duplicate','duplicate'])
        seq[scenario['id']]=['503 WEBHOOK_PROCESSING_FAILED',*('200 '+a for a in actions)]
    assert len(seq)==2

    firebase=read(module/'admin/backend/firebase.json')
    assert 'indexes' not in firebase['firestore']
    assert not any('firestore.indexes' in name for name in entries)
    csv_path=Path(__file__).resolve().parents[1]/'Consultas_e_indices_REV4.csv'
    with csv_path.open(encoding='utf-8-sig', newline='') as src:
        ids=[row['Consulta'] for row in csv.DictReader(src)]
    assert ids==['Q1','Q2','Q3a','Q3b','Q4','Q5a','Q5b','Q6','Q7','Q8','Q9']
    return {'candidata':VERSION, 'manifest_sha256':DIGEST,'archivos_modulo':len(entries),
            'archivos_en_ensayo_backend':len(backend),'version_procesamiento_recibo':event['processingVersion'],
            'relaciones_comprobadas':links, 'factura_local':{'alumno_USD':5,'administracion_centavos':500},
            'materias':{'casos':4,'controles':18,'aviso_observado':warning},
            'diagnostico_webhook':seq,'consultas_contraste':ids,
            'indices':{'configuracion_entregada_sin_manifiesto':True,'estado_base_remota':'sin verificar'},
            'evidencia_sha256':{f:sha(runs/f) for f in [
                'pruebas_http/report.json','pruebas_http/materias.json','pruebas_http/source-manifest.json',
                'pruebas_http/before-confirmation.json','pruebas_http/after-confirmation.json',
                'pruebas_http/before-replay.json','pruebas_http/after-replay.json',
                'pruebas_http/student.log','webhooks/results/report.json']}}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('modulo',type=Path)
    p.add_argument('ensayos',type=Path)
    args=p.parse_args()
    print(json.dumps(validate(args.modulo,args.ensayos),ensure_ascii=False,indent=2))
