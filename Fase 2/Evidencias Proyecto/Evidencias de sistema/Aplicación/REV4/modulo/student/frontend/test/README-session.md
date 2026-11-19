# APR-77 · Pruebas del cliente de sesión

Desde `student/frontend`:

```bash
node --test test/sessionClient.test.mjs test/sessionContext.test.mjs test/checkoutRecovery.test.mjs
npm ci
npm run build
```

Las pruebas usan el código real del cliente con `fetch`, almacenamiento, Web Locks y BroadcastChannel controlados. Las pruebas de contexto ejecutan los callbacks reales de `AuthProvider` con hooks controlados; no renderizan JSX. Son comprobaciones locales, sin usuarios, secretos ni pagos reales.

## Comportamiento incorporado

- Login y registro reciben únicamente `accessToken`, `expiresIn` y el usuario. El acceso se mantiene en memoria. No se lee ni se migra el antiguo `aprueba_tokens`; esa entrada se elimina.
- La recarga inicia `POST /auth/refresh` con `{}` y `credentials: include`. El navegador administra la cookie HttpOnly; JavaScript no conoce su valor.
- Una pestaña comparte la renovación entre sus solicitudes. Un 401 tardío reutiliza el acceso ya renovado. No se repite indefinidamente una petición que sigue siendo rechazada.
- Login, registro, refresh y logout usan una cola local. Cuando Web Locks está disponible, comparten además un bloqueo entre pestañas del mismo origen y partición de almacenamiento.
- Un `409 REFRESH_CONCURRENT` permite una sola repetición tras 100 ms. No se interpreta como revocación confirmada.
- Logout descarta inmediatamente el acceso para llamadas normales. Envía, si lo tiene, el Bearer capturado al endpoint de salida para permitir revocación cuando falta la cookie. Después de un fallo conserva esa copia solo en memoria para repetir la salida, sin reutilizarla en recursos protegidos.
- Si logout falla, la interfaz conserva el error y la posibilidad de repetir. Una marca **sin secreto**, `aprueba-logout-pending:<base API> = 1`, bloquea la restauración automática tras recargar. Se elimina cuando el servidor confirma logout o después de un login explícito correcto.
- BroadcastChannel solo comunica `{type: 'session-changed'}`. Una salida o un login en otra pestaña invalida el estado anterior; no transmite credenciales ni adopta silenciosamente otro usuario.
- Respuestas tardías de login, refresh, perfil o ajustes no pueden reponer un usuario tras una salida o cambio de sesión.

## Límites pendientes

La cola entre pestañas depende de Web Locks y de que ambas usen el mismo origen y partición. Sin ese API queda la cola de cada pestaña y el único reintento de concurrencia. BroadcastChannel tiene el mismo límite de origen/partición; cuando no existe, la siguiente llamada protegida queda sujeta a la revocación del servidor.

La marca de salida requiere que el navegador permita localStorage; si el usuario lo bloquea, se mantiene el bloqueo en memoria, pero no se promete persistencia entre recargas. No se guardan tokens como alternativa.

Cuando una salida no fue confirmada y se recarga, se muestra el acceso público y se exige un login explícito para volver a entrar. En la pestaña original puede repetirse el botón de salida. El cliente no afirma haber revocado una sesión cuando la petición falló.

Estas pruebas no acreditan que un navegador real acepte las cookies, respete SameSite/Secure en los dominios finales o funcione con los proveedores reales. Debe comprobarse después la integración de dominios, proxy, CORS, origen permitido y HTTPS.

Referencias de comportamiento de navegador:

- [Web Locks API, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [Broadcast Channel API, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
