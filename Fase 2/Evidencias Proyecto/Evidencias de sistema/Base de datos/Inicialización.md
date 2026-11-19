# Base de datos del módulo de pagos

El sistema usa Firestore. La entrega incluye la inicialización del catálogo y de las cuentas de prueba, la configuración del emulador y las reglas de la copia local. La carpeta de la aplicación contiene los archivos ejecutables.

| Archivo | Contenido |
|---|---|
| Configuración de Firebase (`../Aplicación/REV4/modulo/admin/backend/firebase.json`) y reglas (`../Aplicación/REV4/modulo/admin/backend/firestore.rules`) | Parámetros de arranque del emulador y reglas asociadas al montaje local. |
| Semilla de alumno (`../Aplicación/REV4/modulo/student/backend/src/seed/seed.js`) | Crea los datos de prueba a partir de la configuración y del banco incluido. |
| Semilla de administración (`../Aplicación/REV4/modulo/admin/backend/src/seed/seed.js`) | Inicialización del contexto administrativo en el emulador. |
| Guía de alumno (`../Aplicación/REV4/modulo/student/README.md`) y guía de administración (`../Aplicación/REV4/modulo/admin/README.md`) | Requisitos, instalación, variables y comandos de carga de cada entorno. |
| Modelo físico (`03_Modelo_fisico_de_pagos_REV4.pdf`) y resultado del contraste local (`modelo_y_diagnostico.json`) | Estructura, relaciones financieras y consultas de la candidata. |

Para reproducir los recorridos se utiliza una instancia local de Firestore Emulator de la versión indicada en las guías. La exportación del entorno compartido del avance se consultó para elaborar el diccionario histórico. En este paquete se distribuyen las semillas y los resultados sintéticos de la versión local REV4.
