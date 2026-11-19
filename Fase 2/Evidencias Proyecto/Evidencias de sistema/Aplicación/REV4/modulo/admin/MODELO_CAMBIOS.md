# Modelo de datos y límites de la instalación local

Este documento describe los contratos relevantes del administrador y los datos mínimos de APR-74. No informa una migración de una base compartida ni atribuye a esta tarea nuevas funciones de pagos, medallas o integración.

## Persistencia y destino

`backend/src/data/repo.js` opera sobre Firestore; no existe almacenamiento JSON alternativo. `FIREBASE_SERVICE_ACCOUNT_JSON` configura credenciales del SDK, no datos.

La instalación local usa `GCLOUD_PROJECT=demo-aprueba-admin` y `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. Los scripts de creación de prueba requieren además `ALLOW_TEST_SEED=true`, proyecto `demo-*` y un destino loopback literal con puerto. La API no ejecuta semillas al arrancar.

`demo-aprueba-admin` es un proyecto aislado distinto de `demo-aprueba-student`. No combinar semillas en una base compartida sin acordar el modelo con Amaru en APR-84.

## `plans`: edición no financiera existente

Los planes contienen configuración visible, límites y valores de medallas por acción. `badges` forma parte del modelo previo; APR-74 no implementa ni demuestra la entrega de esas medallas.

```json
{
  "name": "Todas las pruebas",
  "color": "#F5B041",
  "features": [],
  "popular": false,
  "limits": { "qDay": 0, "groups": 0, "tests": 99 },
  "badges": { "login": 2, "purchase": 10, "correct": 2 },
  "adminRevision": 0
}
```

El ejemplo ilustra campos, no acredita prestaciones ni fija reglas empresariales nuevas. La aplicación de cada límite en el alumno se verifica contra la implementación integrada.

### API efectiva

- `GET /api/v1/admin/plans` devuelve planes y metadatos `readOnly=false`, `editableFields` y `billingChangesReady=false`.
- `PUT /api/v1/admin/plans/:id` modifica un **plan existente**. Admite `name`, `color`, `features`, `limits`, `badges` y `popular`, junto con la revisión esperada `adminRevision`.
- `limits` debe contener `qDay`, `groups` y `tests`; `badges`, `login`, `purchase` y `correct`. Sus valores deben ser enteros seguros no negativos; no se admiten mapas parciales en lugar de esas estructuras.
- Una revisión desactualizada devuelve `PLAN_CHANGED`; campos no editables devuelven `PLAN_FIELDS_READ_ONLY`. El formulario no modifica precios, publicación ni referencias de pago.
- Crear o eliminar planes continúa bloqueado mediante `PLAN_CATALOG_READ_ONLY`. No documentar `POST /plans` como una función disponible.

El cambio se guarda en una transacción: actualiza solo los campos modificados, incrementa `adminRevision`, registra `updatedAt`/`updatedBy` y crea `plan.updated` en `auditLog`. Al cambiar funcionalidades, valida sus referencias y refleja sus nombres en `featuresText`. Los campos financieros y demás datos existentes se conservan.

La configuración `badges.purchase` no prueba que una compra otorgue una recompensa ni que sea idempotente. Los consumidores, el momento del abono y una sola aplicación requieren validación propia. APR-74 tampoco modifica la regla de recorrección.

## `adminUsers`: cuenta local

`npm run admin:local` crea por separado `adminUsers/adm_local`, correo `admin.local@example.test`, rol `admin`, estado `active` y `mfaEnabled=false`. Recibe la contraseña por `LOCAL_ADMIN_PASSWORD`, la valida y guarda su hash; no hay una contraseña fija incorporada.

No sobrescribe cuentas ni restablece contraseñas. La autenticación actual rechaza cuentas deshabilitadas, roles no admitidos o `mfaEnabled=true`. Las antiguas instrucciones de OTP fijo no describen una capacidad vigente.

## Fixtures de catálogo y facturación

La semilla general crea exactamente seis documentos: tres planes (`free`, `uni`, `all`) con `features: []`, un usuario, una suscripción y una factura relacionados. No crea documentos de funcionalidades ni referencias de pruebas/materias y no añade preguntas ficticias. `seed:billing` crea solo el usuario, la suscripción y la factura del mismo conjunto.

Existe un banco PAES real compartido en `../datos-paes/` para el procedimiento del alumno. La semilla administrativa no es su importador. La carga real en la base administrativa y su integración requieren coordinación con el responsable de contenido; los tres planes locales no acreditan preguntas utilizables ni funcionalidades configuradas.

La facturación local relaciona:

- `users/usr_billing_local`: propietario sintético de los datos.
- La suscripción local y su referencia al mismo usuario.
- La factura local, el mismo usuario y la suscripción correspondiente.

La semilla general y `seed:billing` usan la misma fixture. Crean documentos y abortan sin sobrescribir si existe un identificador del conjunto. No son procedimientos de actualización, migración ni limpieza.

`fixture=true`, `provider='stripe'` y `livemode=false` identifican registros sintéticos para lecturas financieras. No prueban contacto con Stripe, cobro, factura del proveedor, webhook, PDF ni Checkout. Solo deben usarse en el emulador, sin presentarlos como evidencia de QA financiera.

La semilla general no crea administradores, contraseñas fijas, métricas comerciales, sponsors ni tutores de demostración. Las colecciones vacías permanecen vacías. No sembrar tutores, reseñas o solicitudes no retira sus rutas; APR-74 no amplía ni valida sus funciones.

## Evidencia y trabajo posterior

Documentar versiones efectivas de herramientas, copia limpia, comandos, resultados y destino local. Comprobar el catálogo como configuración no financiera; ver una fixture no demuestra efectos en otros servicios.

Integración con el alumno, reglas compartidas de catálogo/medallas, Firestore del proyecto conjunto, Stripe de prueba y Docker coordinado con Amaru requieren sus propias tareas y evidencias. La instalación reproducible del administrador aporta a ese trabajo, sin cerrar H2 por sí sola.
