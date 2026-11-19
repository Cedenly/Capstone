# Candidata local del módulo DAD_20

**DAD20-LOCAL-20261118-REV4** reúne los dos frontends y los dos backends del módulo de pagos y suscripciones. Se adoptó la corrección de APR-82 después de reproducir en REV3 tres adjudicaciones de materia que el alta inicial rechazaba. La revisión se armó desde la copia inalterada de `DAD20-LOCAL-20261117-REV3`. Se aplicó el parche validado mediante `git apply --check` y `git apply`. El código íntegro está bajo `modulo/`.

- Se compararon los 158 archivos, incluidas las plantillas de configuración y los archivos ocultos del módulo. Las dos versiones tienen las mismas rutas. Las 153 rutas sin cambios coinciden byte por byte.
- Cambiaron cuatro fuentes de `student/backend` y un archivo de soporte de pruebas. Las cuatro fuentes introducen una regla compartida entre el alta de Checkout, la vista previa del Portal y la asignación de un derecho nuevo. El ajuste de la prueba usa la implementación real y una pregunta publicada de muestra.
- El SHA-256 del parche aplicado es `a9ea4847cf022873869560827d2672da9f39f346a12c4d84c7e094da89f6542a`. El SHA-256 del manifiesto completo de REV4 es `628f864ddd7d2278a847c2bffc2765a1fc2e8989e45c135a1f845443843c9594`. Huellas por ruta (`MANIFIESTO_MODULO_REV4.json`) · Cambios respecto de REV3 (`ORIGEN_Y_DIFERENCIAS.json`)

Se adoptó REV4 para los trabajos y pruebas locales del equipo. El registro de pruebas identifica la versión y los resultados. Esta revisión aún está pendiente de envío a Amaru y de comprobación dentro del conjunto de Alloxentric. La distribución no contiene dependencias instaladas, archivos de sesión o bases con las cuentas usadas en los ensayos.

## Integridad de la copia

Para comprobar los 158 archivos de aplicación, ejecutar lo siguiente desde esta carpeta en una copia recién extraída.

```sh
python3 - <<'PY'
from pathlib import Path
import hashlib, json
base = Path('modulo')
esperado = json.loads(Path('MANIFIESTO_MODULO_REV4.json').read_text())
observado = {p.relative_to(base).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
             for componente in ('student', 'admin')
             for p in (base / componente).rglob('*') if p.is_file()}
assert observado == esperado, 'Hay archivos adicionales, faltantes o con contenido diferente'
print(f'{len(esperado)} archivos verificados')
PY
```

El listado de huellas del banco y la guía (`SHA256SUMS_banco_y_guia.txt`) recoge las 34 entradas correspondientes del manifiesto original de REV4. Incluye los 33 archivos de preguntas y la guía de instalación. Para comparar sus contenidos con los originales, ejecutar desde esta misma carpeta en Git Bash o Linux.

```sh
sha256sum -c SHA256SUMS_banco_y_guia.txt
```

## Verificadores y resultados de REV4

Los verificadores proceden de la evidencia de APR-98 y APR-99 para esta candidata local.

- **API de pagos.** El verificador de ejemplos HTTP (`../Interfaz y diagnóstico/verificar_ejemplos_http.py`) recibe la ruta a `modulo/` y la ruta a las dependencias instaladas del backend del alumno (`node_modules`). El registro de las respuestas HTTP (`../Interfaz y diagnóstico/ejemplos_http.json`) conserva los resultados del ensayo.
- **Modelo físico de pagos.** El verificador del modelo (`../../Base de datos/evidencia/verificar_modelo_y_diagnostico.py`) recibe la ruta a `modulo/` y la carpeta de ensayos APR-82-95 (`../../../Evidencias de documentación/Resultados de las pruebas/Evidencias de prueba/REV4/APR-82-95`). Contrasta los registros de esos ensayos con el modelo y su matriz de consultas (`../../Base de datos/Consultas_e_indices_REV4.csv`). Las relaciones comprobadas figuran en el resultado del modelo y diagnóstico (`../../Base de datos/modelo_y_diagnostico.json`).
