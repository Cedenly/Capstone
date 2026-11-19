# APR-77 · Sesión web del alumno

Código de tarea: **DAD_20_E3_T8**. Preparación local del 10 de noviembre de 2026; la integración con los dominios y el servicio de identidad conjunto sigue pendiente.

## Repetir la batería sin modificar la instalación

Desde `student/backend`, después de `npm ci`:

```bash
node test/run-session-security.mjs memory
```

El ejecutor crea una copia temporal, comparte únicamente las dependencias instaladas y elimina esa copia al terminar. No modifica el archivo `backend/.data/db.json` de la instalación. Ejecutar directamente `session-security.test.mjs` está bloqueado. La semilla de los ensayos contiene solo cuentas y secretos sintéticos.

Para Firestore, iniciar un **emulador dedicado** con proyecto `demo-*`, por ejemplo `demo-apr77-backend`; esta batería borra y reconstruye `users`, `authSessions`, `authRefreshTokens` y `medalLedger` de ese proyecto de prueba. No reutilizar un proyecto local que contenga otras fixtures que se quieran conservar.

```bash
java -jar /ruta/cloud-firestore-emulator-v1.22.0.jar --host 127.0.0.1 --port 8887 --project_id demo-apr77-backend --single_project_mode --single_project_mode_error
```

En otra terminal del mismo equipo:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8887 GCLOUD_PROJECT=demo-apr77-backend node test/run-session-security.mjs firestore
```

El runner rechaza destinos que no sean `127.0.0.1:puerto` y proyectos que no empiecen con `demo-`; elimina credenciales Firebase/Stripe del proceso de prueba. Se verificaron 30 casos en memoria y los mismos 30 con el emulador oficial 1.22.0, Node.js 24.22.1 y las dependencias bloqueadas existentes. El JAR y `node_modules` no forman parte de la distribución.

## Qué comprueban los 30 casos

- Origen ausente, `null`, externo o falsificado; rechazo de formularios y CORS con origen exacto y credenciales.
- Login y registro con cookie HttpOnly de ruta limitada; JSON sin refresh; ausencia de tokens en claro en las colecciones de sesión.
- Rotación con vigencia absoluta, 12 renovaciones simultáneas y reutilización fuera de la ventana de concurrencia.
- Logout con cookie, sin Bearer, con Bearer sin cookie, con Bearer vencido, con cookie histórica y con dos familias distintas; rechazo de firma falsa.
- Carrera entre logout y refresh, sesión de otro usuario, JWT antiguo sin `sid`, suspensión/reactivación y revisión administrativa.
- Cuerpo antiguo de refresh retirado, cookies duplicadas o malformadas, caducidad absoluta, fallo de persistencia y revocación releída por otro proceso.
- Valores por defecto de configuración y rechazo de combinaciones peligrosas.

Los errores 400/500 impresos por el middleware en algunos casos son respuestas provocadas por las pruebas negativas; el resumen final del ejecutor distingue pruebas aprobadas y fallidas. Los logs no contienen cookies ni JWT.

## Contrato HTTP de esta candidata

| Ruta | Entrada de sesión | Respuesta correcta |
| --- | --- | --- |
| `POST /auth/login` | Credenciales, Origin autorizado y JSON | Usuario público, accessToken, expiresIn; cookie HttpOnly. |
| `POST /auth/register` | Datos de registro, Origin autorizado y JSON | Usuario público, accessToken, expiresIn; cookie HttpOnly. |
| `POST /auth/refresh` | Cookie y JSON `{}` | accessToken, expiresIn; cookie rotada. |
| `POST /auth/logout` | Cookie y/o Bearer opcional, Origin autorizado y JSON `{}` | 204 después de guardar la revocación; elimina cookie. |

La cookie se llama `aprueba_refresh`, es host-only, `HttpOnly` y tiene `Path=/api/v1/auth`. Secure es verdadero por defecto. El ejemplo local desactiva Secure únicamente con HOST loopback, orígenes loopback y entorno no productivo. SameSite=Lax es el valor predeterminado; SameSite=None exige Secure. No se deduce el origen autorizado de Host o de cabeceras proxy.

El accessToken solo se admite si tiene `sid`, la familia continúa vigente y su usuario coincide con `sub`. La autorización relee el usuario; no confía en roles o derechos antiguos del JWT. Las respuestas protegidas y las de sesión llevan `Cache-Control: no-store`.

Los tokens anteriores a esta candidata y la renovación por `refreshToken` en JSON requieren un nuevo inicio de sesión. El contrato de clientes nativos/Flutter y los dominios de la integración deben acordarse antes de incorporar esta migración al proyecto conjunto.

## Rotación y revocación

`authSessions/{sid}` contiene usuario, revisión, creación, vencimiento absoluto, revocación y número de rotación. `authRefreshTokens/{sha256(token)}` conserva el vínculo a la familia, expiración y momento de consumo; no guarda el token. Cada renovación marca el hash anterior y crea el nuevo dentro de una sola transacción.

Una repetición durante los cinco segundos posteriores al consumo devuelve `409 REFRESH_CONCURRENT`, sin emitir ni borrar cookies. El cliente espera a la otra renovación y puede reintentar con la cookie que el navegador ya tenga. Después de esa ventana, reutilizar un hash conocido revoca la familia. Si se perdió la respuesta que llevaba la cookie nueva, corresponde volver a iniciar sesión; el servidor no reconstruye ni divulga su secreto.

Logout reconoce cualquier hash histórico registrado de la familia. Cuando incluye un Bearer firmado, puede revocar esa familia aunque falte la cookie; se permite un JWT vencido **solo para revocar**, nunca para acceso o renovación. Si cookie y Bearer válidos identifican familias distintas, revoca ambas atómicamente. Con ambos ausentes, 204 es idempotente. Un Bearer inválido devuelve 401; una cookie ambigua o malformada devuelve 400, sin afirmar cierre exitoso. Un fallo de almacenamiento devuelve 500 y no borra la cookie, de modo que el cierre puede reintentarse.

La revisión de usuario combina `authSessionVersion`, `auditedAt` y el hash de contraseña ya almacenado. Administración incrementa el contador al cambiar realmente el estado. Así, suspender y reactivar entre dos peticiones invalida las sesiones anteriores. En Firestore, una actualización del alumno conserva estos campos administrativos. Para que esto funcione en integración, ambos servicios deben usar el mismo documento de usuario y respetar ese contrato.

## Límites comprobados

Se verificó el transporte HTTP y las cabeceras; estos ensayos no prueban un navegador real ni políticas de cookies entre dominios de producción. La revisión independiente añade una respuesta con Secure habilitado. Firestore usa su emulador oficial; no se utilizó Cloud Firestore, Stripe ni Firebase Auth reales.

El driver de memoria es para un solo proceso. Serializa escrituras y persiste por archivo temporal/renombre; un fallo no confirma una revocación inexistente. Las instalaciones con varios procesos requieren Firestore u otro almacén transaccional compartido. Se conserva el vencimiento absoluto de treinta días como máximo; los hashes históricos se retienen para revocación y detección de reutilización. La limpieza operativa de documentos vencidos debe acordarse con identidad; esta candidata no crea trabajos programados ni configura políticas TTL en la cuenta del equipo.

Las colecciones `authSessions` y `authRefreshTokens` deben ser privadas del backend o servicio de identidad. Antes del despliegue hay que verificar las reglas/permisos Firestore del proyecto compartido: ningún cliente debe poder cambiar hashes, revisiones o revocaciones. Esta preparación no aplica reglas a una cuenta real.

No se ejecuta MFA administrativo ni se define el despliegue, los dominios o una migración de sesiones en una cuenta real. APR-77 conserva estado de preparación local pendiente de integración.
