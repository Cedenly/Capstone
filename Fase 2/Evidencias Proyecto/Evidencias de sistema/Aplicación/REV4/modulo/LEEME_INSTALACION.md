# Aprueba Administración · Instalación del módulo de pagos

**Versión local seleccionada: DAD20-LOCAL-20261118-REV4.** La selección incorpora los cambios de la pantalla «Mi plan» de la rama de alumno (commit de origen `e7099da`) ya presentes en REV3 y la corrección de APR-82. La fecha del identificador se expresa en UTC. Este respaldo se preparó para el trabajo técnico de DAD_20 el 17 de noviembre de 2026, hora de Santiago. El módulo se verificó en local. El despliegue conjunto y el envío a Amaru quedan pendientes.

| Componente | Tecnología | Cómo se ejecuta en desarrollo |
|---|---|---|
| `student/backend/` | Node.js 24, Express 4, Firebase Admin y SDK de Stripe | `npm start`, API en 4100 |
| `student/frontend/` | React 18, React Router y Vite 5 | `npm run dev`, web en 5174 |
| `admin/backend/` | Node.js 24, Express 4 y Firebase Admin | `npm start`, API en 4000 |
| `admin/frontend/` | React 18, React Router y Vite 5 | `npm run dev`, consola en 5173 |

**Base de datos.** Cloud Firestore almacena usuarios, catálogo, intentos de compra, referencias de Checkout, suscripciones, facturas y recibos de eventos. El entorno local usa Firestore Emulator. El alumno también puede iniciar en modo de memoria para explorar la interfaz. Checkout y la confirmación financiera requieren el driver Firestore. El proveedor de pagos es Stripe, en modo de prueba.

## Instalación local

1. Instala Node.js 24 y npm. Para usar Firestore Emulator, prepara Java 21 y el emulador v1.22.0. Los README de cada módulo incluyen la fuente del JAR y su SHA-256.
2. Desde cada una de las cuatro carpetas indicadas en la tabla ejecuta `npm ci`. Cada carpeta tiene su propio `package-lock.json`.
3. Usa las plantillas `.env.example` de cada componente. Elige una clave JWT propia para cada backend siguiendo su README. El alumno permite explorar las pantallas en el modo local descrito en su guía. Para probar pagos, configura el backend de alumno con `DATA_DRIVER=firestore`, el proyecto de prueba `GCLOUD_PROJECT` y el destino del emulador `FIRESTORE_EMULATOR_HOST`. La API de administración siempre utiliza Firestore.
4. Para iniciar cada módulo por separado, sigue su README para crear el proyecto emulado y, si corresponde, sus datos de prueba. Abre una terminal por servicio y usa el comando de la tabla. Verifica las API con `http://127.0.0.1:4100/health` y `http://127.0.0.1:4000/health`. Abre `http://localhost:5174` para alumno y `http://localhost:5173` para administración. La respuesta de salud comprueba que arrancó el proceso.
5. Para compilar los clientes, ejecuta `npm run build` en cada carpeta `frontend/`. Con el proxy local basta la configuración de ejemplo. Si usas orígenes separados, el alumno espera `VITE_API_URL` con el origen de la API y le agrega `/api/v1`. Administración espera esa ruta ya incluida en la base de la API.

Las guías contienen los comandos de instalación, incluida la variante PowerShell indicada para alumno, las semillas y las precauciones sobre los datos locales. La instalación separada usa `demo-aprueba-student` y `demo-aprueba-admin`; estas bases tienen datos independientes. Para que administración vea las operaciones reales del alumno en una prueba conjunta, ambos servicios deben apuntar al proyecto de prueba compartido que corresponda y leer el mismo conjunto de datos. Conserva las semillas aisladas de ese entorno. [Instalación del alumno](student/README.md) · [Instalación de administración](admin/README.md)

## Recorrido de pagos e incorporación al administrador

El alumno selecciona plan, periodicidad y materia cuando corresponde. Checkout crea o retoma el intento. El acceso pagado se actualiza cuando el backend recibe el evento firmado de Stripe y procesa el estado financiero. Al volver mediante el botón Atrás, la pantalla «Mi plan» vuelve a consultar el estado del intento y permite continuarlo o descartarlo según lo informado por el servidor. Administración lee facturas y suscripciones de la misma base autorizada.

Para una integración en el entorno de prueba del equipo:

- Configura el origen del frontend de alumno en `STUDENT_WEB_URL` y los orígenes admitidos en `AUTH_ALLOWED_ORIGINS`. Si cambian los puertos del entorno, ajusta los proxies o las URL de compilación.
- Proporciona al backend de alumno la clave de Stripe de prueba, los cuatro IDs de precio y la configuración de Portal de ese entorno. Configura el receptor `POST /api/v1/webhooks/stripe` con su secreto de firma. El detalle de variables está en la plantilla y en el README. Los secretos se suministran por el canal propio del entorno.
- Comprueba en el montaje elegido que un pago confirmado queda registrado una sola vez, que el alumno ve su derecho pagado y que la consola lee la factura y la suscripción correspondientes. Las necesidades de puertos, rutas y variables del montaje Docker se pueden coordinar sobre esta versión del módulo.

Los bancos originales que acompañan a la semilla incluyen 31 archivos legibles con 1.365 preguntas. La semilla omite con aviso los dos archivos verbales originales con errores de sintaxis. La gestión editorial del banco corresponde a su equipo.

Las comprobaciones locales del flujo financiero usaron el emulador y el SDK de Stripe con respuestas de proveedor simuladas. La publicación y verificación del proyecto integrado se realizan en el entorno que defina el equipo integrador.
