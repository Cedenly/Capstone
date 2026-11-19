"""Invoca ejemplos de la guía en una copia aislada del backend de alumno de REV4."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

def reproducir(fuentes, dependencias):
    with tempfile.TemporaryDirectory() as tmp:
        work=Path(tmp)
        backend=fuentes/'student/backend'
        shutil.copytree(backend/'src', work/'src')
        shutil.copy(backend/'package.json', work/'package.json')
        (work/'node_modules').symlink_to(dependencias.resolve(),target_is_directory=True)
        with socket.socket() as so:
            so.bind(('127.0.0.1',0)); port=so.getsockname()[1]
        origin='http://127.0.0.1:5174'
        env={'PATH':os.environ['PATH'],'PORT':str(port),'HOST':'127.0.0.1','NODE_ENV':'test',
             'DATA_DRIVER':'memory','AUTH_ALLOWED_ORIGINS':origin,'JWT_SECRET':secrets.token_hex(40),
             'AUTH_COOKIE_SECURE':'false','PHONE_VERIFICATION_REQUIRED':'false'}
        proc=subprocess.Popen(['node','src/index.js'],cwd=tmp,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        def api(r,body=None,token=None):
            hdr={'Origin':origin,'Accept':'application/json'}
            if body is not None:
                hdr['Content-Type']='application/json'
            if token:
                hdr['Authorization']='Bearer '+token
            req=Request(f'http://127.0.0.1:{port}'+r,data=None if body is None else json.dumps(body).encode(),headers=hdr)
            try:
                with urlopen(req,timeout=3) as res:return res.status,json.load(res)
            except HTTPError as e:
                return e.code,json.load(e)
        try:
            for _ in range(80):
                if proc.poll() is not None: raise RuntimeError('No se pudo iniciar la API local')
                try:
                    if api('/health')[0]==200:break
                except URLError:pass
                time.sleep(.1)
            else:raise RuntimeError('API no está disponible')
            s0, ausente=api('/api/v1/me/invoices')
            assert s0==401 and ausente['error']['code']=='AUTH_REQUIRED'
            sc, catalog=api('/api/v1/plans')
            assert sc==200 and isinstance(catalog['data'],list) and catalog['error'] is None
            user={'name':'Prueba local','email':'revisor@example.invalid','password':secrets.token_hex(16),'consent':True}
            status, body=api('/api/v1/auth/register',user)
            assert status==201, (status, body.get('error'))
            s,d=api('/api/v1/auth/login',{'email':user['email'],'password':user['password']})
            assert s==200
            data=d['data']; token=data.get('accessToken') or data.get('token')
            assert token
            s1, invoices=api('/api/v1/me/invoices',token=token)
            assert s1==200 and invoices['data']==[] and invoices['error'] is None and invoices['meta']['requestId']
            s2,disabled=api('/api/v1/me/subscription/cancel',{},token)
            assert s2==410 and disabled['error']['code']=='DEMO_SUBSCRIPTION_CANCEL_DISABLED'
            return {'entorno':'API real de alumno por HTTP en loopback con driver de memoria vacío y cuenta ficticia',
                    'sin_token':{'metodo':'GET','ruta':'/api/v1/me/invoices','estado':s0,'codigo':ausente['error']['code']},
                    'consulta_de_catalogo':{'metodo':'GET','ruta':'/api/v1/plans','estado':sc,'cantidad':len(catalog['data']),'ambito':'almacén de memoria nuevo'},
                    'consulta_de_facturas_propias':{'metodo':'GET','ruta':'/api/v1/me/invoices','estado':s1,'data':[], 'requestId_presente':True},
                    'cancelacion_heredada':{'metodo':'POST','ruta':'/api/v1/me/subscription/cancel','estado':s2,'codigo':disabled['error']['code']}}
        finally:
            proc.terminate(); proc.wait(timeout=6)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('modulo', type=Path)
    p.add_argument('node_modules_alumno', type=Path)
    args=p.parse_args()
    manifests = args.modulo.parent/'MANIFIESTO_MODULO_REV4.json'
    from hashlib import sha256
    from datetime import datetime, timezone
    expected=json.loads(manifests.read_text())
    assert sha256(manifests.read_bytes()).hexdigest()=='628f864ddd7d2278a847c2bffc2765a1fc2e8989e45c135a1f845443843c9594'
    for rel, fingerprint in expected.items():
        assert sha256((args.modulo/rel).read_bytes()).hexdigest()==fingerprint,rel
    res=reproducir(args.modulo,args.node_modules_alumno)
    print(json.dumps({'version':'DAD20-LOCAL-20261118-REV4','fecha_utc':datetime.now(timezone.utc).isoformat(),'http':res},ensure_ascii=False,indent=2))
