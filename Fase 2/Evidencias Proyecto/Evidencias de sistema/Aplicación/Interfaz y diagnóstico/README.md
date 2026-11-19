# Comprobación de los ejemplos de la API de pagos

Las guías de esta carpeta describen la candidata local DAD20-LOCAL-20261118-REV4. Hay dos registros con alcances distintos.

| Evidencia | Entorno y resultado |
|---|---|
| Ejemplos HTTP (`ejemplos_http.json`) | API de alumno con almacenamiento en memoria. La consulta de facturas sin sesión devolvió 401. El catálogo vacío y las facturas de la cuenta ficticia devolvieron 200. La antigua ruta de cancelación devolvió 410. |
| Recorrido de compra de Todas mensual (`../../../Evidencias de documentación/Resultados de las pruebas/Evidencias de prueba/REV4/APR-82-95/pruebas_http/report.json`) | API de alumno y de administración con Firestore Emulator y proveedor Stripe simulado. La factura de USD 5 del alumno corresponde a los 500 centavos de administración. El reenvío del evento se reconoció como duplicado. |

## Cómo consultar el diagnóstico

En el informe del recorrido, localiza las etiquetas `checkout-created`, `pending-status`, `webhook-confirmation`, `student-invoices`, `admin-invoices` y `webhook-replay`. Los archivos del directorio `../APR-82-95/` que cita el PDF de diagnóstico se encuentran en la carpeta de ensayos de REV4 (`../../../Evidencias de documentación/Resultados de las pruebas/Evidencias de prueba/REV4/APR-82-95`) de esta entrega.

- El registro del alumno (`../../../Evidencias de documentación/Resultados de las pruebas/Evidencias de prueba/REV4/APR-82-95/pruebas_http/student.log`) y el resultado de materias (`../../../Evidencias de documentación/Resultados de las pruebas/Evidencias de prueba/REV4/APR-82-95/pruebas_http/materias.json`) documentan la asignación diferida cuando la materia elegida dejó de ser elegible.
- El registro de webhooks (`../../../Evidencias de documentación/Resultados de las pruebas/Evidencias de prueba/REV4/APR-82-95/webhooks/results/report.json`) muestra la secuencia resultante al reintentar después de un error técnico.
- El anexo del 18 de noviembre (`../../../Evidencias de documentación/Resultados de las pruebas/Evidencias de prueba/2026-11-18 Cliente y pagos/Resultados_del_18_de_noviembre.txt`) describe las pruebas posteriores de cliente y pagos. También distingue la compra completada en Chrome del intento anterior en que otra cuenta registró `resource_missing`.

## Cómo reproducir los cuatro ejemplos en memoria

Usa Python 3 y la versión de Node.js indicada en la guía de instalación (`../REV4/modulo/LEEME_INSTALACION.md`). El verificador necesita las dependencias del backend de alumno. Para conservar limpia la copia comprobada con el manifiesto de REV4, instala con `npm ci` en una copia de trabajo de `student/backend` y anota la ruta absoluta a su directorio `node_modules`. El verificador crea una instancia temporal de la API en el equipo local, con una cuenta ficticia, y escribe el resultado en la terminal.

Desde esta misma carpeta, en un entorno con enlaces simbólicos de directorios habilitados, sustituye el segundo argumento por esa ruta.

```sh
python3 verificar_ejemplos_http.py "../REV4/modulo" "/ruta/de/trabajo/student/backend/node_modules"
```

## Cómo contrastar los registros de Firestore

El verificador de modelo y diagnóstico (`../../Base de datos/evidencia/verificar_modelo_y_diagnostico.py`) contrasta los archivos incluidos en el ZIP. No requiere acceso a Firestore ni a Stripe. Desde esta carpeta, ejecuta el siguiente comando y compara el resultado con el registro de contraste (`../../Base de datos/modelo_y_diagnostico.json`).

```sh
python3 "../../Base de datos/evidencia/verificar_modelo_y_diagnostico.py" "../REV4/modulo" "../../../Evidencias de documentación/Resultados de las pruebas/Evidencias de prueba/REV4/APR-82-95"
```
