# Aprueba · módulo web del estudiante

Frontend React 18/Vite y API Node/Express bajo `/api/v1`, con respuestas `{data,error,meta}`. Esta versión incluye la recuperación de Checkout APR-69 y la sesión web con cookie de APR-77. La preparación instalable corresponde a APR-74; la integración conjunta con el administrador y su Docker debe coordinarse con Amaru.

## Requisitos y estructura

Usar Node.js 22 o posterior (validación local con Node 24) y npm. El `firebase-admin` requerido ya está incluido en el lock del backend. Para el emulador Firestore usado en las pruebas se requiere Java 21.

```text
student/backend/     API, configuración de ejemplo y scripts de prueba
student/frontend/    aplicación React
admin/               módulo administrador separado
datos-paes/          banco original compartido con el paquete
```

El banco incluido contiene 1.365 preguntas importables: 559 de comprensión lectora, 683 de matemática M1 y 123 de ciencias. Dos archivos de Verbal contienen JSON inválido y el importador los omite con aviso; no se alteraron los originales. M2 e Historia permanecen en el catálogo con `hasQuestions:false` al no tener preguntas en este banco.

## Instalación local sin servicios externos

En una copia limpia, instalar el backend y crear su configuración:

```bash
cd student/backend
npm ci
cp .env.example .env
node --input-type=module -e "import fs from 'node:fs'; import {randomBytes} from 'node:crypto'; const f='.env'; fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+randomBytes(48).toString('hex')));"
npm start
```

El comando genera una clave JWT local propia sin mostrarla. Un valor vacío, corto o de ejemplo impide el arranque. `GET http://127.0.0.1:4100/health` permite comprobar que el servidor escucha. El arranque no siembra datos ni reemplaza catálogos. Una base vacía necesita contenido autorizado antes de usar las pantallas.

El driver predeterminado `memory` persiste únicamente en `student/backend/.data/db.json`; no requiere Firebase. Para cargar las cuentas y el banco de prueba, detener el servidor y ejecutar explícitamente:

```bash
ALLOW_TEST_SEED=true npm run seed
npm start
```

`seed` reemplaza el almacén local. El banco se resuelve junto a `student/`, en `datos-paes/`; se puede seleccionar otro directorio con `PAES_DIR`. Si no encuentra preguntas válidas, falla antes de reemplazar datos.

En otra terminal:

```bash
cd student/frontend
npm ci
npm run dev
```

Abrir `http://localhost:5174`. Vite dirige `/api` al backend de `localhost:4100`. Si se cambia ese puerto, ajustar el proxy de `vite.config.js` o configurar el origen del API como se describe abajo.

## Sesión web APR-77

El ejemplo usa `AUTH_ALLOWED_ORIGINS=http://localhost:5174,http://127.0.0.1:5174` y `AUTH_COOKIE_SECURE=false` exclusivamente para HTTP local, con `HOST=127.0.0.1`. Esa excepción se rechaza en producción, con escucha pública, orígenes remotos o un par no loopback. Sin una excepción explícita, Secure es obligatorio por defecto.

Para HTTPS, fijar `AUTH_COOKIE_SECURE=true` y los orígenes exactos del frontend en `AUTH_ALLOWED_ORIGINS`, sin rutas ni comodines. El origen no se deduce desde `Host` ni cabeceras del proxy. `AUTH_COOKIE_SAME_SITE=lax` es el valor inicial; `none` exige Secure y solo corresponde si los dominios acordados lo requieren. Las restricciones del navegador sobre cookies de terceros deben probarse en esos dominios.

La cookie `aprueba_refresh` es HttpOnly, host-only y tiene ruta `/api/v1/auth`. Login y registro devuelven usuario, acceso y duración; refresh devuelve acceso y duración. El token de renovación no aparece en JSON ni se guarda en `localStorage`. El acceso permanece en memoria; al recargar se utiliza la cookie para recuperar la sesión. Las operaciones de sesión exigen `Origin` permitido y `Content-Type: application/json`; el cliente usa `credentials: include`.

Las sesiones anteriores requieren un nuevo login. El refresh antiguo en JSON y los accesos sin sesión vinculada dejan de ser válidos. No se adapta ni se valida aquí el cliente móvil: su contrato debe coordinarse con el responsable de identidad.

Las colecciones `authSessions` y `authRefreshTokens` conservan familias y hashes de credenciales. Una rotación no extiende el vencimiento absoluto de la sesión. Un token consumido recibe `409 REFRESH_CONCURRENT` durante cinco segundos; su reutilización posterior revoca la familia. El cliente coordina renovaciones y limita el reintento. Logout invalida la sesión del servidor; un fallo de cierre se muestra como no confirmado.

Cambiar el estado administrativo incrementa `authSessionVersion`. Suspender y reactivar obliga a iniciar otra sesión; para aplicarlo entre módulos hace falta el mismo documento de usuario o propagar ese marcador. El driver `memory` admite un solo proceso; Firestore proporciona las transacciones para concurrencia entre instancias. Repetir la semilla elimina también las sesiones locales anteriores.

## Alternativa para Windows PowerShell

Desde una copia limpia del paquete, usar `npm.cmd` evita depender de la política de ejecución de `npm.ps1`. Esta variante conserva un `.env` existente y genera JWT únicamente si su valor está vacío:

```powershell
Set-Location student/backend
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
@'
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
const file = '.env';
const text = fs.readFileSync(file, 'utf8');
if (/^JWT_SECRET=\s*$/m.test(text)) {
  fs.writeFileSync(file, text.replace(/^JWT_SECRET=\s*$/m,
    'JWT_SECRET=' + randomBytes(48).toString('hex')));
} else {
  console.log('Se conserva JWT_SECRET existente; debe cumplir los requisitos del backend.');
}
'@ | node --input-type=module
npm.cmd start
```

Para cada comando que modifica la fixture, detener el API y habilitar la señal solo durante ese comando. La función restaura el valor anterior incluso si falla:

```powershell
function Invoke-TestDataCommand([scriptblock]$Command) {
  $previous = $env:ALLOW_TEST_SEED
  try {
    $env:ALLOW_TEST_SEED = 'true'
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "La prueba terminó con código $LASTEXITCODE" }
  } finally {
    if ($null -eq $previous) {
      Remove-Item Env:ALLOW_TEST_SEED -ErrorAction SilentlyContinue
    } else {
      $env:ALLOW_TEST_SEED = $previous
    }
  }
}
Invoke-TestDataCommand { npm.cmd run seed }
Invoke-TestDataCommand { npm.cmd run smoke }
Invoke-TestDataCommand { npm.cmd run seed }
Invoke-TestDataCommand { node src/seed/dump_payloads.js payloads.json }
```

Para el frontend, ejecutar `npm.cmd ci` y `npm.cmd run dev` desde `student/frontend` en otra terminal. Para compilar con origen separado, definir `$env:VITE_API_URL = 'http://127.0.0.1:4100'` antes de `npm.cmd run build`. Los ensayos automatizados documentados se ejecutaron con Bash/Node; esta variante PowerShell se revisó como instrucción, sin ejecutarla en PowerShell.

## Datos y comprobaciones locales

Las tres cuentas usan la contraseña de prueba `demo1234`. No deben cargarse en una base compartida.

| Cuenta | Acceso de la fixture | Observación |
|---|---|---|
| `demo@aprueba.cl` | free | Cuota inicial 5/10; los bonos permiten ampliarla a 20 |
| `camila@correo.cl` | all manual | Acceso local a pruebas con preguntas; no representa una suscripción Stripe |
| `juan@correo.cl` | uni manual | M1 ilimitada; las demás pruebas conservan cuota gratuita |

Las fixtures no crean suscripciones ni facturas pagadas. Los contactos, mensajes, reseñas y medallas sembrados son ejemplos para comprobar pantallas.

`smoke` y `dump_payloads` también mutan la fixture. Repetir `seed` antes de cada uno, con el API detenido:

```bash
cd student/backend
ALLOW_TEST_SEED=true npm run seed
ALLOW_TEST_SEED=true npm run smoke
ALLOW_TEST_SEED=true npm run seed
ALLOW_TEST_SEED=true node src/seed/dump_payloads.js payloads.json
```

Los scripts inician su propio API en un puerto local libre y se detienen al finalizar. `SMOKE_PORT` o `DUMP_PORT` permiten elegir otro puerto. Tras validar el entorno local, fijan su origen de prueba y la excepción HTTP local de la cookie. El dump comprueba los errores HTTP, responde con el `sessionId` de práctica y oculta los tokens en el JSON exportado. No prueba al cliente móvil.

Los scripts requieren `ALLOW_TEST_SEED=true` y rechazan `NODE_ENV=production`. Para Firestore exigen además un emulador loopback (`127.0.0.1:puerto`, `localhost:puerto` o `[::1]:puerto`) y un proyecto `demo-*`. No usan Cloud Firestore para fixtures. Los tokens telefónicos `dev:` se habilitan solo dentro de estas pruebas; el ejemplo de configuración los deja desactivados para el arranque normal.

## Ensayo con Firestore local

La validación utiliza Firestore emulator 1.22.0 con Java 21. Obtener el [JAR oficial](https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar) y comprobar SHA256 `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c` antes de ejecutarlo (`sha256sum` en Bash o `Get-FileHash -Algorithm SHA256` en PowerShell). No se incluye ese binario en el paquete.

En una terminal separada, iniciar el emulador vacío con una ruta local al JAR:

```bash
java -jar /ruta/cloud-firestore-emulator-v1.22.0.jar --host 127.0.0.1 --port 8080 --project_id demo-aprueba-student --single_project_mode --single_project_mode_error
```

El mismo comando funciona en PowerShell reemplazando la ruta por la ruta Windows entre comillas. Mantenerlo abierto durante seed/smoke/dump y detenerlo al terminar. No importar datos de otro entorno. Configurar en `student/backend/.env`, además del JWT local:

```dotenv
DATA_DRIVER=firestore
GCLOUD_PROJECT=demo-aprueba-student
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

Ejecutar los comandos de seed/smoke/dump anteriores. La siembra Firestore borra y recarga únicamente las colecciones incluidas en la fixture, de modo que las respuestas y contactos de la prueba anterior no se acumulen. Usar un proyecto dedicado; no compartirlo con el administrador, cuyo ensayo usa `demo-aprueba-admin`. Estos ensayos separados no acreditan integración entre módulos. Las credenciales no son necesarias para el emulador.

Para una instalación real, el equipo debe configurar su proyecto y credenciales por su canal habitual y cargar los catálogos desde el administrador o mediante el procedimiento acordado. No ejecutar estas semillas contra ese proyecto. El servidor no ejecuta semillas automáticamente.

## Build del frontend

```bash
cd student/frontend
npm run build
```

Se genera `dist/`. En un servidor que publica frontend y API bajo el mismo origen, `/api/v1` debe dirigirse al backend y el resto de rutas React debe resolver `index.html`. Con API en otro origen, definir `VITE_API_URL` antes de compilar, sin añadir `/api/v1`:

```bash
VITE_API_URL=http://127.0.0.1:4100 npm run build
npm run preview -- --host 127.0.0.1 --port 5174
```

`preview` sirve para comprobar el build local, no reemplaza el servidor de producción. Su origen debe aparecer en `AUTH_ALLOWED_ORIGINS`; mantener el mismo hostname para frontend y API facilita el ensayo HTTP local. En contenedores, configurar `HOST=0.0.0.0`, `AUTH_COOKIE_SECURE=true` y orígenes HTTPS acordados, y conservar `JWT_SECRET` fuera del repositorio. La composición y terminación HTTPS integradas siguen pendientes.

## Contratos y límites de esta versión

- Login y registro usan los endpoints vigentes. El login social simulado está deshabilitado: `/auth/social` devuelve 410 `SOCIAL_LOGIN_DISABLED`. La recuperación de contraseña devuelve 410 `PASSWORD_RECOVERY_UNAVAILABLE` hasta disponer de su servicio.
- La verificación telefónica real requiere Firebase Auth configurado. `/auth/phone/send-code` valida el teléfono y devuelve indicaciones; no envía un SMS. El cliente realiza la verificación y el backend valida el token resultante.
- Práctica requiere JWT. `GET /practice/next` entrega un `sessionId`; `POST /questions/:id/answer` necesita `{selected,elapsedMs,sessionId}`. El primer envío devuelve 201 y repetir la misma respuesta del mismo intento devuelve 200 sin duplicar el resultado.
- El catálogo informa disponibilidad real de preguntas. El modo facsímil, las estadísticas avanzadas y la comparación entre estudiantes no se anuncian como funciones terminadas.
- Pagos requieren Firestore y configuración Stripe de prueba. Checkout devuelve una URL y un identificador de sesión; únicamente el webhook firmado confirma el acceso. `GET /billing/status` consulta el resultado; `/billing/portal` gestiona una suscripción existente. La confirmación demo y las rutas anteriores de cambio/cancelación de suscripción devuelven 410.
- Los intentos de checkout sin sesión se recuperan por su `attemptId`; pueden descartarse mediante `POST /checkout/attempts/:attemptId/cancel`. Los límites y pruebas de APR-69 están en `backend/test/README-checkout-recovery.md`.

El correo de Max indica que no hay observaciones al MVP y que la entrega final será cuando esté lista. No acredita pruebas externas ni fija una fecha. El Docker integrado y la validación con los demás equipos siguen siendo coordinaciones de la entrega.
