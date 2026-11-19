# Modelo utilizado por el módulo del estudiante

Este documento describe el código entregado y sus diferencias respecto del modelo inicial. No acredita una migración de datos ni la integración con el administrador.

## Colecciones raíz

El backend usa colecciones raíz enlazadas por identificadores, tanto en memoria como en Firestore; las consultas son sobre esas colecciones, no `collectionGroup`.

| Colección | Enlace principal |
|---|---|
| `answers`, `notifications`, `devices`, `medalLedger` | `userId` |
| `practiceSessions` | `userId`, `questionId`, `testId` |
| `groupMembers`, `groupInvitations`, `groupShared` | `groupId` y los enlaces de usuario o invitación correspondientes |
| `comments`, `likes`, `reposts` | `postId`, `userId` o autor |
| `tutorRequests`, `conversations`, `tutorReviews` | `tutorId`, `userId` |
| `messages` | `conversationId` |
| `checkoutAttempts` | documento por `userId`, con `attemptId` |
| `checkoutSessions` | documento por identificador Stripe, enlazado a `attemptId` |
| `subscriptions`, `invoices` | usuario e identificadores de facturación |
| `authSessions`, `authRefreshTokens` | sesión `sid`, usuario y hashes de credenciales de renovación |

## Cuota y acceso

`users.quota` contiene el día y los contadores de uso; `bonuses.school` y `bonuses.address` amplían la cuota gratuita de 10 a un máximo de 20. El plan `all` da acceso ilimitado a las pruebas con preguntas. `uni` es ilimitado únicamente para la prueba elegida; las demás conservan la cuota gratuita. El acceso de una suscripción Stripe depende de los campos de facturación confirmados y del fin del periodo, no de una respuesta del navegador.

Los identificadores de plan son `free`, `uni` y `all`; los ciclos son `monthly` y `yearly`. El catálogo utiliza precio mensual y calcula el anual como diez mensualidades. Los ejemplos locales tienen `uni` a USD 1/mes y `all` a USD 5/mes; la configuración Stripe debe coincidir con el catálogo real. Los planes no anuncian facsímil ni estadísticas avanzadas como funciones disponibles.

## Preguntas y práctica

El importador de prueba lee el banco empaquetado `datos-paes/` o el `PAES_DIR` explícito. Mapea `pregunta` a `statement`, `alternativas` a `options`, `respuesta_correcta` a `correctIndex`, `explicacion_respuesta` a las explicaciones y `habilidad_requerida` a `habilidad`. Añade prueba, eje, dificultad y publicación. El banco incluido permite importar 1.365 preguntas; los dos JSON inválidos de Verbal se omiten con aviso. M2 e Historia no tienen preguntas en este banco. La disponibilidad pública se calcula a partir de preguntas publicadas, no solo de la presencia del catálogo.

La pregunta pública no contiene `correctIndex`. `GET /practice/next` crea un intento `practiceSessions` con identificador `prs_*`, dueño, pregunta y vencimiento de 24 horas. El envío de respuesta requiere ese `sessionId`; `answers` utiliza `ans_<sessionId>` y una medalla, cuando corresponde, `mdl_<sessionId>`. El reenvío idéntico devuelve el resultado guardado; no crea otra respuesta ni otro premio. El servicio calcula la corrección, cuota y medalla.

El historial de respuestas permite calcular el dominio (`mastery`). Los prerrequisitos y recursos se toman de los campos curados disponibles o de ejemplos fijos de respaldo; no se generan a partir del historial ni equivalen a un banco completo de habilidades curadas. La comparación entre estudiantes no está implementada y devuelve `cohortPercentile:null`.

## Facturación vigente

Ya no existe activación simulada desde el frontend: `/checkout/sessions/:id/confirm` devuelve 410. Checkout requiere Firestore y Stripe de prueba; devuelve `checkoutSessionId` y `url`. El webhook valida la firma y la compra antes de confirmar acceso. `/billing/status` consulta la relación con la compra y la suscripción; `/billing/portal` abre la gestión permitida por Stripe. Las rutas antiguas de cambio/cancelación directa de suscripción están deshabilitadas.

APR-69 conserva un intento por cuenta, parámetros y clave idempotente originales. Recupera sesiones sin referencia local, restaura una única relación en `checkoutSessions` y permite descartar mediante `attemptId`. Una conciliación incierta conserva la reserva; un pago enviado no se convierte en cancelado. Recuperar o consultar no concede acceso: esa responsabilidad sigue en el webhook.

## Identidad

Las contraseñas se guardan con `crypto.scrypt`, formato `scrypt$<salt>$<hash>`. El JWT exige una clave configurada de al menos 32 bytes y rechaza placeholders conocidos. El acceso social simulado y la recuperación de contraseña están deshabilitados con respuesta 410. El registro con teléfono consume un token corto emitido tras verificar el token telefónico. Los tokens `dev:` son una ayuda explícita de pruebas locales, desactivada en el ejemplo normal y no admitida en producción.

APR-77 añade `authSessions` y `authRefreshTokens`: sesión persistida y hashes de credenciales rotables, con vencimiento absoluto. El JWT de acceso incorpora `sid`; logout revoca su familia. El cliente usa cookie HttpOnly y acceso en memoria, con control de origen. `users.authSessionVersion` se incrementa al suspender/reactivar desde administración y se preserva en las escrituras del alumno. Las sesiones previas requieren otro login y el contrato móvil debe adaptarse por su responsable. Ver la configuración de sesión en `README.md`.

## Datos de prueba y arranque

`npm start` no siembra ni modifica datos por sí mismo. `seed`, `smoke` y `dump_payloads` requieren `ALLOW_TEST_SEED=true` y rechazan producción. Para Firestore solo se aceptan emulador loopback y proyecto `demo-*`; la siembra limpia únicamente las colecciones incluidas en su fixture antes de recargarlas. En memoria reemplaza `backend/.data/db.json`.

Las cuentas y datos sociales sembrados son fixtures. Los accesos manuales `all` y `uni` permiten ensayar pantallas localmente, sin generar suscripciones ni facturas. El proyecto de ensayo del estudiante debe separarse del administrador; los datos compartidos y su integración requieren su validación correspondiente.
