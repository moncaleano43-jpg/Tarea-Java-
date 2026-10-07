# Control de Cavas

Plataforma web para el control del proceso de cavas (fermentación, maduración y levadura), construida a partir del
libro Excel `CONTROL PROCESO CAVAS 2026.xlsm`. Reemplaza las macros VBA (`REGISTRO FV`, `REGISTRO SV`, `Registrar`,
`Levadura`…) por una API y una interfaz web con las mismas reglas.

**Stack:** Java 21 · Spring Boot 3 · Spring Data JPA · H2 (desarrollo) / PostgreSQL (producción) · SPA en JS plano + Chart.js (incluido localmente, funciona sin internet).

## Qué incluye

| Excel | Plataforma |
|---|---|
| `B.D FERMENTACIÓN` + `REGISTRO FV` | Fermentaciones, muestreos (extracto/pH), temperatura y presión, etapas EN/AF/RF/VACIO. Valida que el FV no esté ocupado. |
| `B.D MADURACIÓN` + `REGISTRO SV` | Trasiego FV→SV (uno o dos FV, no mezcla marcas), análisis fisicoquímico final, etapas MADURANDO/LISTO/VACIO. |
| `B.D LEVADURA` | Cosechas, generación, viabilidad; al llenar un FV con una levadura se hereda su información y se marca la resiembra. |
| `ESPECIFICACIONES MARCA` | Límites sup./inf. por marca, usados para generar alertas. |
| `INFORME CAVA` / `INVENTARIO` | Dashboard de FV y SV activos con alertas (tiempo máx. en FV, E.O fuera de rango, viabilidad, temp. de siembra, análisis pendiente). |
| `CUMPLIMIENTO INDICADORES` | Indicadores por marca y rango de fechas. |
| `CURVAS FERMENTACION` | Curva de atenuación y de temperatura por fermentación. |
| Funciones VBA `Kge`, `Extracto`, `VolEqui` | `Calculos.java` (portadas 1:1) + calculadora en la UI. |

## Ejecutar

```bash
mvn spring-boot:run          # http://localhost:8080  (base H2 en ./data)
mvn test                     # 19 pruebas
```

### Cargar los datos históricos del Excel

```bash
pip install openpyxl
python3 -I tools/extract_excel.py "CONTROL PROCESO CAVAS 2026.xlsm" out/     # genera CSV en out/
CAVAS_IMPORT_DIR=out mvn spring-boot:run                                       # importa si la base está vacía
```

Los CSV contienen datos de producción y están en `.gitignore`.

### PostgreSQL

```bash
SPRING_PROFILES_ACTIVE=postgres DB_URL=jdbc:postgresql://host:5432/cavas DB_USER=cavas DB_PASSWORD=... java -jar target/control-cavas-0.1.0.jar
```

## Opción sin servidor: un solo archivo HTML (Python)

Para ver el estado de la cava **sin instalar Java ni levantar un servidor**:

```bash
pip install openpyxl
python3 -I tools/generar_informe.py "CONTROL PROCESO CAVAS 2026.xlsm" informe_cavas.html
```

Genera un único `informe_cavas.html` (datos, estilos y gráficas incluidos, ~2 MB) que se abre con doble clic en el
navegador y funciona sin internet. Incluye dashboard con alertas, curvas por fermentación, maduración, levadura e indicadores.
Es de **solo lectura**: para actualizarlo se vuelve a ejecutar el script con el Excel más reciente. El registro de datos
(llenado, trasiego, etc.) solo está en la versión Java.

## API (resumen)

`GET /api/resumen[?ahora=ISO]` · `GET/POST /api/fermentaciones` · `GET /api/fermentaciones/{cons}` ·
`POST /api/fermentaciones/{cons}/muestras|temperaturas` · `PUT /api/fermentaciones/{cons}/etapa` ·
`GET/POST /api/maduraciones` · `PUT /api/maduraciones/{cons}/analisis|etapa` · `GET/POST /api/levaduras[?disponibles=true]` ·
`GET /api/indicadores?desde&hasta` · `GET /api/especificaciones` · `GET /api/calculos`

## Pendiente / siguientes pasos

- **Autenticación y roles** (hoy la API es abierta; no exponer fuera de una red de confianza).
- Hojas aún no migradas: `INVENTARIO LEVADURA` detallado, `MERMA`/`SAP`, `GRAFICAS PRODUCTIVIDAD`, descanso de diacetilo,
  purgas de trub, enfriamiento y CO2 (columnas 492–706 de `B.D FERMENTACIÓN`).
- Los umbrales de indicadores (viabilidad ≥ 95 %, generación ≤ 10, siembra 3–4 °C, O2 ≤ 15 ppb) se tomaron de las filas de
  límites del Excel; revisar con Calidad. Están en `InformeService`/`IndicadoresService`.
