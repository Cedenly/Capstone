# Aprueba · Consola de administración

Consola web con frontend React 18/Vite y API Node.js/Express sobre Firestore. La API usa `/api/v1/admin/*` y respuestas `{data,error,meta}`.

APR-74 prepara una instalación local reproducible y datos mínimos de prueba. No acredita Stripe ni la integración del administrador completo. Docker con Amaru y la composición conjunta corresponden a las tareas de integración posteriores; ejecutar este repositorio por separado no cierra H2.

APR-77 añade la revocación asociada al estado del alumno: `PATCH /users/:id` incrementa `users.authSessionVersion` en la misma transacción que suspende o reactiva la cuenta. Repetir el estado vigente no modifica la versión ni la auditoría. El cambio conserva los campos de Stripe y no modifica el login administrativo. Para invalidar las sesiones del alumno, ambos servicios deben compartir el documento de identidad o propagar ese marcador mediante el contrato integrado; los proyectos locales separados no quedan enlazados automáticamente.

## Requisitos

- Node.js **24** y npm. Ambos proyectos incluyen `package-lock.json`: usar `npm ci`, sin regenerar los locks.
- Java **21** y el emulador Firestore. La ruta comprobada usa el JAR oficial 1.22.0; Firebase CLI es una alternativa instalada por separado.
- Puertos locales disponibles: API `4000`, frontend `5173`, Firestore `8080`.

Si falta Firebase CLI, instalarla aparte con `npm install --global firebase-tools` y registrar después su versión efectiva. Este documento no fija una versión de CLI no verificada. La instalación inicial de herramientas y dependencias requiere acceso a sus repositorios de descarga.

```bash
node --version
npm --version
java -version
firebase --version
```

No existe un modo de almacenamiento JSON: `backend/src/data/repo.js` siempre utiliza Firestore. `FIREBASE_SERVICE_ACCOUNT_JSON` representa credenciales del SDK, no una base JSON. Esta instalación usa exclusivamente el emulador, sin login ni credenciales de Firebase real.

## 1. Instalar y configurar

Desde la raíz del administrador, en una copia limpia:

```bash
cd backend
npm ci
cp .env.example .env
```

Si ya existe `.env`, conservarlo y revisar sus valores en vez de copiar encima. La configuración local es:

```dotenv
PORT=4000
JWT_SECRET=
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=2592000
GCLOUD_PROJECT=demo-aprueba-admin
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
ALLOW_TEST_SEED=false
```

Generar una clave JWT aleatoria una sola vez sobre el archivo recién creado. Este comando escribe la clave sin mostrarla:

```bash
node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; import { randomBytes } from "node:crypto"; const p = ".env"; writeFileSync(p, readFileSync(p, "utf8").replace(/^JWT_SECRET=.*$/m, "JWT_SECRET=" + randomBytes(48).toString("hex")));'
```

La API rechaza una clave insuficiente o de ejemplo. Los tiempos JWT deben ser enteros positivos en segundos. Mantener `.env` y contraseñas fuera del repositorio y de la evidencia compartida. Cambiar `PORT` exige ajustar el destino del proxy de Vite.

En otra terminal, desde la raíz del administrador:

```bash
cd frontend
npm ci
cp .env.example .env
```

El valor local es `VITE_API_URL=/api/v1`. No añadir `/admin`: el cliente ya incorpora ese segmento.

## 2. Levantar Firestore local

La comprobación del 16/11/2026 usó directamente el JAR oficial, sin requerir Firebase CLI ni login. Descargar [Firestore Emulator 1.22.0](https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar) y verificar SHA-256 `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c` antes de ejecutarlo:

```bash
java -jar /ruta/cloud-firestore-emulator-v1.22.0.jar --host 127.0.0.1 --port 8080 --project_id demo-aprueba-admin --single_project_mode --single_project_mode_error
```

Usar solo uno de los dos métodos. Como alternativa con Firebase CLI instalada, en una terminal dentro de `backend`:

```bash
npm run emulator
```

El script selecciona `demo-aprueba-admin` y Firestore escucha en `127.0.0.1:8080`. Esperar su disponibilidad antes de crear datos. El arranque no carga semillas automáticamente. Sin exportación/importación configurada, no asumir que los datos sobreviven al cierre del emulador.

`demo-aprueba-admin` está separado de `demo-aprueba-student`. No combinar las semillas en una base compartida sin acordar el modelo y la integración con Amaru en APR-84. Compartir un proceso emulador no convierte proyectos distintos en la misma base.

El SDK también admite credenciales remotas, pero ese acceso queda fuera de este procedimiento. Si falta `FIRESTORE_EMULATOR_HOST`, puede recurrir a credenciales del entorno: revisar el destino antes de arrancar. Los scripts de creación de prueba tienen una guarda adicional que rechaza ese destino.

## 3. Crear una cuenta local

Dentro de `backend`, con el emulador activo, introducir una contraseña propia de al menos 12 caracteres y como máximo 72 bytes. Ejemplo para Bash:

```bash
read -r -s -p 'Contraseña de la cuenta local: ' LOCAL_ADMIN_PASSWORD
ALLOW_TEST_SEED=true LOCAL_ADMIN_PASSWORD="$LOCAL_ADMIN_PASSWORD" npm run admin:local
unset LOCAL_ADMIN_PASSWORD
```

La cuenta es `admin.local@example.test`, documento `adminUsers/adm_local`, rol `admin`, estado activo y `mfaEnabled=false`. El script no sobrescribe la cuenta existente ni cambia su contraseña. No hay contraseña predeterminada. La autenticación actual rechaza cuentas con MFA habilitado; no existe un OTP fijo de prueba válido.

`ALLOW_TEST_SEED=true` se aplica solo a esa ejecución. Mantener `false` en `.env`. La guarda exige proyecto `demo-*` y un host de emulador loopback literal con puerto. Para este procedimiento conservar exactamente `demo-aprueba-admin` y `127.0.0.1:8080`.

## 4. Datos mínimos opcionales

En `backend`, elegir **una** alternativa para un emulador vacío:

```bash
# Catálogo mínimo y registros locales relacionados de facturación.
ALLOW_TEST_SEED=true npm run seed
```

```bash
# Solo los registros relacionados de facturación.
ALLOW_TEST_SEED=true npm run seed:billing
```

Ambos usan la misma fixture, incluido `usr_billing_local`. No ejecutarlos consecutivamente como conjuntos independientes. Las escrituras crean documentos: si existe un identificador del conjunto, se aborta sin sobrescribirlo. Volver a sembrar no actualiza ni limpia datos.

La semilla general crea exactamente **seis documentos**: tres planes (`free`, `uni`, `all`) con `features: []`, un usuario, una suscripción y una factura locales relacionados. No crea documentos de funcionalidades o pruebas/materias, administradores, contraseñas, preguntas ficticias, métricas comerciales, sponsors ni tutores de demostración. `seed:billing` crea solo los últimos tres documentos.

El paquete incluye un banco PAES real en `../datos-paes/`, utilizado por el procedimiento del alumno. El administrador no incorpora un importador de ese banco en su semilla. La carga de preguntas reales en la base que use administración y su integración se coordinan con el responsable de contenido. Disponer del catálogo no demuestra que exista contenido utilizable en este proyecto aislado.

La facturación sembrada es **sintética**: `fixture=true`, `provider='stripe'` y `livemode=false` permiten ejercitar lecturas de la consola en el emulador. No significan que Stripe haya recibido un pago o emitido una factura. Estas fixtures no acreditan Checkout, webhook, PDF, integración financiera ni QA final.

## 5. Iniciar API y frontend

En una terminal dentro de `backend`:

```bash
npm start
```

Para recarga al editar, usar `npm run dev` en su lugar. La API escucha en `http://localhost:4000`; `GET /health` comprueba el proceso, pero no consulta Firestore.

En una terminal dentro de `frontend`:

```bash
npm run dev -- --host 127.0.0.1
```

Abrir `http://localhost:5173`. Vite redirige `/api` a `http://localhost:4000`. Iniciar sesión con la cuenta local. Las vistas sin datos deben permanecer vacías; no cargar el antiguo contenido de demostración para ocultar esa situación.

## 6. Comprobar la instalación

Desde `backend`, `npm run test:seed` verifica las protecciones de las semillas. Consultar `/health` y probar una autenticación local comprueba proceso y acceso; una lectura autenticada comprueba también el emulador. Con API, emulador, cuenta local y fixture de usuario disponibles, `check:protections` comprueba las protecciones administrativas. Está restringido al emulador, usa `adm_local` y firma un token de prueba con el JWT local; no lee `LOCAL_ADMIN_PASSWORD` ni sustituye la prueba de login:

```bash
ALLOW_TEST_SEED=true npm run check:protections
```

La prueba específica de APR-77 usa la ruta HTTP real y el emulador. Con las variables locales anteriores, el emulador activo y `JWT_SECRET` configurado en el entorno del proceso, ejecutar `ALLOW_TEST_SEED=true node --env-file=.env --test test/sessionRevocation.test.js`. Crea cuentas sintéticas con identificadores exclusivos y las elimina al terminar. Comprueba cambios simultáneos de estado, permisos, conservación de facturación y rechazo de contadores inválidos; no comprueba la integración con el servicio de identidad del equipo.

Registrar las comprobaciones ejecutadas y sus resultados; una fixture visible no valida pagos reales. Desde `frontend`, comprobar compilación:

```bash
npm run build
```

Para probar el resultado compilado con la API local, usar URL absoluta al compilar y después iniciar la vista previa:

```bash
VITE_API_URL=http://localhost:4000/api/v1 npm run build
npm run preview -- --host 127.0.0.1
```

No depender del proxy `/api` de desarrollo en la vista previa. `VITE_API_URL` se incorpora al compilar; cambiarla después no modifica `dist`. El despliegue del conjunto requiere acordar URL o enrutamiento con el administrador integrado.

## Equivalentes para Windows PowerShell

`npm ci`, `npm start`, `npm run emulator` y los comandos sin asignaciones de entorno se usan igual. En cada carpeta correspondiente, crear `.env` solo si todavía no existe:

```powershell
if (Test-Path .env) { throw 'Conserva el .env existente y revisa sus valores.' }
Copy-Item .env.example .env
```

Dentro de `backend`, generar el JWT sin imprimirlo. El bloque se envía a Node por entrada estándar para evitar problemas de comillas en PowerShell:

```powershell
@'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const p = '.env';
const text = readFileSync(p, 'utf8');
if ((text.match(/^JWT_SECRET=.*$/gm) || []).length !== 1) throw new Error('Debe existir una sola linea JWT_SECRET en .env');
writeFileSync(p, text.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + randomBytes(48).toString('hex')));
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'No se genero la clave JWT.' }
```

Crear la cuenta local con entrada oculta; la contraseña no se escribe en el código ni se envía a un servicio de login externo:

```powershell
$securePassword = Read-Host 'Contraseña de la cuenta local' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:LOCAL_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    $env:ALLOW_TEST_SEED = 'true'
    npm run admin:local
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la cuenta local.' }
} finally {
    Remove-Item Env:LOCAL_ADMIN_PASSWORD, Env:ALLOW_TEST_SEED -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
    $securePassword.Dispose()
}
```

Para la semilla opcional, aplicar el indicador solo durante el comando. Elegir `seed` o `seed:billing`, sin ejecutar ambos consecutivamente. Para comprobar protecciones, usar el mismo bloque cambiando el comando por `npm run check:protections`:

```powershell
$env:ALLOW_TEST_SEED = 'true'
try {
    npm run seed
    if ($LASTEXITCODE -ne 0) { throw 'El comando local fallo; revisar el resultado.' }
} finally {
    Remove-Item Env:ALLOW_TEST_SEED -ErrorAction SilentlyContinue
}
```

Para compilar el frontend con la API absoluta de la prueba local:

```powershell
$env:VITE_API_URL = 'http://localhost:4000/api/v1'
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'La compilacion fallo.' }
} finally {
    Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
}
npm run preview -- --host 127.0.0.1
```

## Alcance funcional

- El catálogo permite editar configuración **no financiera de planes existentes** con `PUT /api/v1/admin/plans/:id`, control `adminRevision` y auditoría. Crear, eliminar, publicar y cambiar precios o referencias de pago queda fuera de esa edición. Ver `MODELO_CAMBIOS.md`.
- `badges` pertenece al modelo existente. Su presencia o edición no acredita abonos por login, compras o respuestas en el sistema integrado.
- El arranque local no migra datos ni prueba compatibilidad con otros equipos. La evidencia de instalación respalda APR-74; Docker integrado, contratos compartidos y Stripe de prueba requieren sus propias comprobaciones.
