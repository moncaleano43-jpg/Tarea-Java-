# Inventario de Levadura · LevaBot v36 + Control de proceso de cava

Plataforma de un solo archivo (`index.html`, se abre en el navegador). La v36 suma la sección **Cava**, que reemplaza el Excel *01. CONTROL PROCESO CAVAS 2026*.

## Sección «Cava» (menú lateral)

| Pestaña | Hoja(s) del Excel que reemplaza |
|---|---|
| Informe de cava | INFORME CAVA (los 32 tanques: FV/SV, etapa, ocupación, extracto, alertas) |
| Llenado FV | REGISTRO FV, B.D FERMENTACIÓN, CURVAS FERMENTACION (mosto, cocimientos, aire, levadura sembrada, muestreo y curva) |
| Trasiego y maduración | REGISTRO SV, SEGUIMIENTO MADURACIÓN, B.D MADURACIÓN (silica/PVPP, centrífuga, deep freeze, purgas, fisicoquímico, filtración y merma) |
| Análisis | REGISTRO ANÁLISIS, REFERENCIAS (muestreo pendiente, purgas, pendientes de calidad) |
| Inventario | INVENTARIO (volumen real, de inventario y depósito, mermas y factores de dilución) |
| Merma y SAP | MERMA, SAP (datos de vaciado y filtración por mes, exportables a CSV) |
| Especificaciones | ESPECIFICACIONES MARCA, CUMPLIMIENTO INDICADORES (editable) |

Está conectada con el resto de la plataforma: al registrar un llenado con fin de llenado se crea el tanque en el monitor de tanques (T0, retiro de levadura) y se descuenta la levadura del colector; las muestras se guardan en ambos lados.

Las fórmulas del Excel (KGE, extracto, merma de contador, merma de filtración, volumen de inventario, tiempo de resiembra, dispersión de medidores de aire) están portadas tal cual.

## Datos
Los registros de 2026 del Excel (483 llenados de FV, 483 trasiegos a SV, inventario de 32 tanques y especificaciones) vienen incluidos. Si ya usaba la plataforma, se cargan una sola vez al abrirla; en una instalación nueva también hay un botón *Cargar datos del Excel* en la pestaña Informe.

## Desarrollo
```
src/base.html      plataforma v35 con los ganchos de Cava
src/cava.js        módulo Cava
src/seed_cava.json datos del Excel
tools/build.py     genera index.html (python3 tools/build.py)
tools/extraer_excel.py  regenera src/seed_cava.json desde el .xlsm (poner el archivo en entrada/)
```
