# Contratos complementarios del API del estudiante

Base: `/api/v1`. Envelope estándar `{ data, error, meta }`.
Referencia del código entregado para APR-74 y del contrato de sesión web de APR-77. Las comprobaciones reproducibles están en `src/seed/smoke.js`; la salida de cada ejecución informa su resultado. Este documento no acredita pruebas externas, integración del administrador ni validación del cliente móvil.

Comportamiento del módulo:

- **Teléfono**: Firebase Auth phone. El cliente realiza la verificación SMS; el backend valida el `idToken` y emite un `phoneToken` corto que se canjea al registrarse.
- **Tutores**: administrados desde la consola admin (`/api/v1/admin/tutors`); la app del alumno solo lee, reseña, contacta y chatea.
- **Chat**: REST + polling (`unreadCount` para el badge, cursor opaco para el historial).

---

## Sesión web del alumno: APR-77

Login y registro devuelven `user`, `accessToken` y `expiresIn`; no devuelven un `refreshToken` legible desde JavaScript. La renovación utiliza la cookie host-only `aprueba_refresh`, HttpOnly, con `Path=/api/v1/auth`, Secure por defecto y SameSite configurado. El cliente envía `credentials: 'include'`, mantiene el acceso en memoria y elimina la entrada heredada `aprueba_tokens` de `localStorage`.

- `POST /auth/refresh`: cuerpo `{}` y cookie; devuelve `accessToken` y `expiresIn`. Enviar `refreshToken` en el cuerpo devuelve `400 REFRESH_BODY_UNSUPPORTED`. Un reintento concurrente puede devolver `409 REFRESH_CONCURRENT` sin alterar la cookie vigente.
- `POST /auth/logout`: revoca mediante cookie y admite un Bearer opcional firmado, incluso expirado, únicamente para identificar otra sesión que cerrar. No exige un acceso vigente. La respuesta satisfactoria es `204`; sin ambas credenciales también responde `204` de forma idempotente. Credenciales malformadas o ambiguas y errores de persistencia fallan sin borrar la cookie: solo un `204` confirma el cierre solicitado.
- Login, registro, renovación y salida requieren `Origin` exacto autorizado y `Content-Type: application/json`; un origen ausente o no autorizado se rechaza. Las cookies ambiguas se rechazan, sin seleccionar arbitrariamente una credencial.
- La migración requiere un nuevo login para sesiones anteriores. Los dominios finales y el contrato de otros consumidores, incluido el móvil, deben acordarse y verificarse durante la integración.

Consultar la configuración y los límites en [README del alumno](../README.md); el comportamiento de la sesión se implementa en `src/routes/auth.js` y sus módulos de sesión. El marcador administrativo `users.authSessionVersion` solo revoca el acceso del alumno si ambos servicios comparten la identidad o propagan ese cambio.

## 1. Verificación telefónica (pantalla `sms-verification`)

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/auth/phone/send-code` | `{ phone }` | `{ phone, masked, verifier:'firebase', codeLength, detectedCountry, detectedLanguage, dialCode, accountExists }` |
| POST | `/auth/phone/verify-code` | `{ firebaseIdToken, phone? }` | `{ phoneToken, expiresIn, phone, country, language, accountExists }` |
| PATCH | `/me/phone` | `{ phoneToken }` | `{ phone, phoneVerified, country, language }` |

- `send-code` **no** envía SMS: valida E.164, deriva país/idioma del prefijo (+56 → CL/es, +44 → UK/en) y alimenta `confirm-locale`. `422 COUNTRY_NOT_SUPPORTED` fuera de CL/UK.
- `/auth/register` ahora acepta `phoneToken`, `country`, `language`, `gradeId`. Sin `phoneToken` → `400 PHONE_VERIFICATION_REQUIRED` (desactivable con `PHONE_VERIFICATION_REQUIRED=false`). Teléfono repetido → `409 PHONE_ALREADY_IN_USE`.
- `/auth/social` devuelve 410 `SOCIAL_LOGIN_DISABLED`; no acepta tokens sociales simulados. `/auth/password/forgot` y `/auth/password/reset` devuelven 410 `PASSWORD_RECOVERY_UNAVAILABLE`.
- `firebase-admin` está incluido en el lock. La verificación telefónica real requiere su configuración. `PHONE_AUTH_ALLOW_DEV_TOKEN=true` permite tokens `dev:` únicamente fuera de producción; los scripts de prueba lo activan tras verificar su entorno local. El arranque normal los deja desactivados.

## 2. Catálogo país / grado / asignaturas (`confirm-locale`, `select-grade`, `select-tests`)

| Método | Ruta | Notas |
|---|---|---|
| GET | `/countries` | público. `{ code, name, dialCode, flag, languages, defaultLanguage, currency }` |
| GET | `/countries/:code/grades?lang=` | público. Grupos del wireframe: básica 1-8, media 1-4, PAES / primary, secondary, sixth form, GCSE, A levels |
| GET | `/tests?gradeId=&lang=` | asignaturas del grado; `hasQuestions:true` solo si la prueba está habilitada y tiene preguntas publicadas |

Países y grados se definen en `src/data/catalog.js`. Las pruebas PAES consultan además `tests` y las preguntas disponibles. El banco incluido cubre lectora, M1 y ciencias; M2 e Historia se devuelven sin preguntas.

## 3. Persistencia del onboarding

- `PUT /me/preferences` acepta `{ country, language, gradeId, selectedTests, format?, difficulty? }`. `format`/`difficulty` pasaron a opcionales. Valida grado (`400 INVALID_GRADE`) y coherencia con el país (`422 GRADE_COUNTRY_MISMATCH`).
- `GET /me` expone `phone`, `phoneVerified`, `country`, `language`, `gradeId` y `onboarded`. `GET /me/preferences` devuelve preferencias como país, idioma, grado, pruebas, formato y dificultad; no devuelve teléfono.

## 4. Marketplace de tutores

| Método | Ruta | Notas |
|---|---|---|
| GET | `/tutors` | `q`, `subject`, `mode`, `verified`, `featured`, `sort=rating\|price_asc\|price_desc\|experience`, `limit`, `cursor`. `meta.premium` indica si el plan permite contactar |
| GET | `/tutors/featured` | bloque "Profesores destacados" |
| GET | `/tutors/:id` | bio, precio, `ratingByCriterion`, reseña destacada, `contacted`, `canReview`, `conversationId` |
| GET | `/tutors/:id/reviews` | paginado + `meta.summary` (promedio global y por criterio) |
| POST | `/tutors/:id/reviews` | `{ ratings:{ teaching, punctuality, mastery }, comment? }`. Exige contacto previo (`403 REVIEW_NOT_ALLOWED`), una por alumno (`409 REVIEW_ALREADY_EXISTS`) |
| POST | `/tutors/:id/contact-requests` | **Premium**. `{ message, shareProfile? }` → crea solicitud + conversación. Idempotente: si ya existe, agrega el mensaje y responde `200 { created:false }` |
| GET | `/me/gap-analysis` | **Premium**. Dominio por prueba, `areasToReinforce`, `recommendedTutorCount`, ordenado de mayor a menor necesidad |

El plan free recibe `403 PLAN_REQUIRED` en contacto y análisis (middleware `premiumRequired`).
Las valoraciones combinan la reputación histórica del tutor (`ratingSeed`/`reviewCountSeed`) con las reseñas creadas en la app.

## 5. Chat con tutores (REST + polling)

| Método | Ruta | Notas |
|---|---|---|
| GET | `/me/conversations` | `unreadCount` por chat y `meta.unreadTotal` |
| GET | `/conversations/:id` | perfil compartido en la solicitud + estado de contacto |
| GET | `/conversations/:id/messages` | orden descendente, cursor opaco, marca leídos (`?markRead=false` para no marcar) |
| POST | `/conversations/:id/messages` | Premium; `{ text }` (máx. 2000) |
| POST | `/conversations/:id/read` | pone el badge en cero |
| PATCH | `/conversations/:id/contact-sharing` | Premium; `{ shareWhatsapp }`. El teléfono se revela **solo con consentimiento mutuo**; requiere teléfono verificado (`422 PHONE_REQUIRED`) |

## 6. Huecos menores cerrados

| Método | Ruta | Motivo |
|---|---|---|
| GET | `/corrections/:id` | la pantalla `recorreccion` consulta el veredicto mientras está `pending` |
| POST | `/posts/:id/repost` | contador 🔁 del feed (toggle) |
| DELETE | `/posts/:id` | solo autor (`403 NOT_POST_AUTHOR`), limpia comentarios/likes/reposts |
| DELETE | `/posts/:id/comments/:commentId` | autor del comentario o del post |
| POST | `/me/notifications/read-all` | marcar todo leído |
| DELETE | `/groups/:id/members/me` | salir del grupo; traspasa la propiedad o elimina el grupo si queda vacío |
| GET | `/benefits/:id` | detalle del beneficio + cupones ya canjeados |

`GET /feed` ahora devuelve `reposts`, `reposted` y `mine`.

## 7. Práctica y sesiones

Todas las rutas de práctica requieren JWT. `GET /practice/next` devuelve la pregunta pública y su `sessionId`. Enviar `{ selected:'A', elapsedMs:12000, sessionId }` a `POST /questions/:id/answer`; omitir el intento devuelve 400 `INVALID_PRACTICE_ATTEMPT`. El primer resultado devuelve 201; el reenvío idéntico devuelve 200 con `meta.replayed:true`. Cada intento pertenece a una cuenta y pregunta, y vence a las 24 horas.

## 8. Checkout y suscripciones

`POST /checkout/sessions` requiere Firestore y Stripe de prueba. Devuelve `checkoutSessionId` y `url`; no activa el plan. `GET /billing/status` informa lo confirmado por el webhook y el `attemptId` pendiente, aunque falte el identificador de sesión. `POST /checkout/attempts/:attemptId/cancel` recupera y descarta el intento; la ruta equivalente por sesión se conserva por compatibilidad. Un pago ya enviado responde `PAYMENT_PROCESSING` y no se considera cancelado.

`POST /billing/portal` abre la gestión de una suscripción existente. El webhook `/webhooks/stripe` exige firma sobre el mensaje original. `/checkout/sessions/:id/confirm`, `/me/subscription/change` y `/me/subscription/cancel` devuelven 410; no usar esos flujos demo anteriores.

## 9. Límites entre módulos

La gestión administrativa de tutores y contenido pertenece al módulo administrador. Los contratos que consuma la aplicación móvil deben verificarse con su equipo. La existencia de rutas en el estudiante no demuestra integración ni pruebas de esos clientes. No utilizar la confirmación de checkout demo en ningún consumidor.

## Cómo verificar localmente

Seguir primero `../README.md`: Node >=22, `npm ci`, `.env` local y JWT aleatorio propio. Después, con el API detenido:

```bash
ALLOW_TEST_SEED=true npm run seed
ALLOW_TEST_SEED=true npm run smoke
ALLOW_TEST_SEED=true npm run seed
ALLOW_TEST_SEED=true node src/seed/dump_payloads.js payloads.json
```

Seed, smoke y dump modifican datos. En memoria utilizan `.data/db.json`; en Firestore solo admiten un emulador loopback y proyecto `demo-*` dedicado. Rechazan producción y no se ejecutan al arrancar el API. Repetir seed antes de cada suite restablece las colecciones de la fixture. El banco de preguntas se incluye en `datos-paes/`, fuera de `student/`, o se indica con `PAES_DIR`.

Las cuentas demo del README permiten comprobar permisos locales. Los accesos premium manuales de esas fixtures no representan compras ni suscripciones Stripe. El dump valida los códigos HTTP y oculta los tokens exportados.

## Pendientes conscientes (fuera de alcance)

- Portal/app del tutor: no hay signup ni bandeja del lado del profesor; los mensajes del tutor entran por seed o por la consola admin.
- Pago de clases dentro de Aprueba (el wireframe lo declara "pronto").
- Preguntas para asignaturas escolares (no PAES): el catálogo las expone con `hasQuestions:false`; `/practice/next` sirve únicamente pruebas con preguntas publicadas disponibles.
