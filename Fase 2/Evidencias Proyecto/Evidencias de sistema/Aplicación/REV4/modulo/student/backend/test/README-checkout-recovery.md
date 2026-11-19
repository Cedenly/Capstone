# APR-69: pruebas locales de recuperación de Checkout

Desde `backend`, con Node.js y sin instalar dependencias:

```bash
node --experimental-vm-modules --test test/checkout-recovery.test.mjs
```

La suite carga las rutas y el servicio de recuperación reales mediante módulos VM. Solo sustituye los límites externos: Express registra las rutas, la autenticación entrega una identidad de prueba, Firestore conserva documentos en memoria y Stripe utiliza sesiones e idempotencia simuladas. No usa credenciales ni conexiones de red.

La reproducción anterior puede ejecutarse si se conserva una copia intacta del backend original:

```bash
APR69_BASELINE_BACKEND=/ruta/al/backend-original node --experimental-vm-modules --test test/checkout-baseline.test.mjs
```

En el espacio de trabajo de la corrección se detecta también `../../../baseline/backend` respecto de esta carpeta. Si no existe ninguna de estas fuentes, las tres reproducciones históricas se omiten con una indicación; las pruebas de la corrección se ejecutan normalmente.

## Qué se comprueba

- Interrupción antes de crear, timeout después de crear y error al guardar la asociación en Firestore.
- Reanudación del mismo intento y descarte por `attemptId`, seguido de compra del mismo plan o de otro.
- Recuperación después de 23 horas, clave de idempotencia vencida, error 500 conservado por el proveedor y llamadas simultáneas.
- Espera ante una creación incierta hasta la caducidad fija más margen; en intentos antiguos sin caducidad fija, espera desde el último envío incierto.
- Búsqueda paginada, múltiples coincidencias y lecturas incompletas: no se presume ausencia a partir de una consulta fallida.
- Rechazo de otra identidad, otro intento y sesiones completas; carrera entre pago y expiración y entre continuar y descartar.
- Conservación de una sola sesión cobrable y de la asociación que necesita el procesamiento posterior del pago.

El doble rechaza lecturas de una transacción después de su primera escritura, aplica caducidad de las sesiones al consultarlas y de las claves a las 24 horas, exige parámetros iguales al repetir una clave vigente y valida una caducidad nueva entre 30 minutos y 24 horas.

## Límites de la evidencia

Son pruebas ejecutadas sobre las rutas reales con dobles locales; no son pruebas de Stripe sandbox ni del proyecto integrado. No comprueban OAuth/JWT real, transporte HTTP de Express, reglas o índices desplegados de Firestore, reintentos distribuidos del SDK, pagos de redes de tarjetas ni activación por webhook. La asociación recuperada se verifica como dato persistido; la ejecución del webhook queda fuera de esta suite. El reloj y las intercalaciones de concurrencia son controlados y no representan todas las temporizaciones posibles de la infraestructura.
