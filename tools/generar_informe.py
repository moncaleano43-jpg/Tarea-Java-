#!/usr/bin/env python3
"""Genera un único archivo HTML (informe_cavas.html) a partir del Excel de control de cavas.

Uso:  python3 -I tools/generar_informe.py "CONTROL PROCESO CAVAS 2026.xlsm" [salida.html]

El HTML resultante es autocontenido (datos, estilos y gráficas incluidos): se abre con doble clic,
no necesita servidor ni internet. Es de solo lectura; para volver a actualizarlo, vuelva a ejecutar el script.
Requiere: pip install openpyxl
"""
import csv, json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_excel

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)


def valor(s):
    if s == "":
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() and abs(f) < 1e9 and "." not in s and "e" not in s.lower() else f
    except ValueError:
        return s


def leer(directorio, nombre):
    with open(os.path.join(directorio, nombre), encoding="utf-8", newline="") as f:
        return [{k: valor(v) for k, v in fila.items()} for fila in csv.DictReader(f)]


def agrupar(filas, columnas):
    out = {}
    for r in filas:
        out.setdefault(r["cons"], []).append([r["fecha"]] + [r[c] for c in columnas])
    return out


def main(xlsm, salida):
    with tempfile.TemporaryDirectory() as tmp:
        extract_excel.main(xlsm, tmp)
        datos = {
            "especificaciones": leer(tmp, "especificaciones.csv"),
            "fermentaciones": leer(tmp, "fermentaciones.csv"),
            "maduraciones": leer(tmp, "maduraciones.csv"),
            "levaduras": leer(tmp, "levaduras.csv"),
            "muestras": agrupar(leer(tmp, "muestras_fermentacion.csv"), ["horas", "extracto", "ph"]),
            "temperaturas": agrupar(leer(tmp, "temperaturas.csv"), ["horas", "temp_m", "temp_i"]),
        }
    for e in datos["especificaciones"]:
        e["marca"] = str(e["marca"]).upper()
    fechas = [m[0] for v in datos["muestras"].values() for m in v] + [m[0] for v in datos["temperaturas"].values() for m in v]
    fechas += [f["inicio_llenado"] for f in datos["fermentaciones"] if f["inicio_llenado"]]
    datos["hasta"] = max(f for f in fechas if isinstance(f, str) and len(f) >= 16 and f[4] == "-")

    def leer_txt(p):
        with open(p, encoding="utf-8") as f:
            return f.read()

    html = leer_txt(os.path.join(AQUI, "informe_template.html"))
    css = leer_txt(os.path.join(RAIZ, "src/main/resources/static/styles.css"))
    chart = leer_txt(os.path.join(RAIZ, "src/main/resources/static/vendor/chart.umd.js"))
    html = (html.replace("/*__CSS__*/", css).replace("/*__CHART__*/", chart)
            .replace("/*__DATA__*/", json.dumps(datos, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")))
    with open(salida, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{salida}: {os.path.getsize(salida) / 1e6:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "informe_cavas.html")
