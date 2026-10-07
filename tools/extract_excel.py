#!/usr/bin/env python3
"""ETL: extrae las bases de datos del Excel "CONTROL PROCESO CAVAS" a CSV normalizados.

Uso: python3 -I tools/extract_excel.py <archivo.xlsm> <directorio_salida>

Genera (en el directorio de salida):
  fermentaciones.csv, muestras_fermentacion.csv, temperaturas.csv,
  maduraciones.csv, levaduras.csv, especificaciones.csv
Los CSV contienen datos de producción: NO se versionan (ver .gitignore).
"""
import csv, os, sys, datetime as dt
import openpyxl


def clean(v):
    if v is None or v == "" or (isinstance(v, str) and v.startswith("#")):
        return ""
    if isinstance(v, dt.datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(v, dt.time):
        return v.strftime("%H:%M:%S")
    if isinstance(v, float):
        return repr(round(v, 6))
    return str(v).strip()


def num(v):
    s = clean(v)
    try:
        return float(s)
    except ValueError:
        return None


def rows(ws, first, maxc):
    for r in ws.iter_rows(min_row=first, max_col=maxc, values_only=True):
        yield r


def col(r, n):  # n 1-based como en Excel
    return r[n - 1] if n - 1 < len(r) else None


def write(path, header, data):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(data)
    print(f"{os.path.basename(path)}: {len(data)} filas")


def main(xlsm, out):
    os.makedirs(out, exist_ok=True)
    wb = openpyxl.load_workbook(xlsm, read_only=True, data_only=True)

    # ---- Fermentación (B.D FERMENTACIÓN, datos desde fila 13) ----
    ferm, muestras, temps = [], [], []
    for r in rows(wb["B.D FERMENTACIÓN"], 13, 700):
        cons, tq, marca = clean(col(r, 2)), clean(col(r, 3)), clean(col(r, 4))
        if not cons or not marca or tq in ("", "0"):
            continue
        ferm.append([cons, tq, marca, clean(col(r, 53)), clean(col(r, 54)), clean(col(r, 56)),
                     clean(col(r, 57)), clean(col(r, 58)), clean(col(r, 59)), clean(col(r, 60)),
                     clean(col(r, 61)), clean(col(r, 62)), clean(col(r, 66)), clean(col(r, 68)),
                     clean(col(r, 69)), clean(col(r, 78)), clean(col(r, 239)), clean(col(r, 673))])
        for base in range(82, 172, 5):  # fecha, tiempo, extracto, atenuación, pH
            if col(r, base) in (None, ""):
                continue
            muestras.append([cons, clean(col(r, base)), clean(col(r, base + 1)),
                             clean(col(r, base + 2)), clean(col(r, base + 3)), clean(col(r, base + 4))])
        for base in range(240, 492, 7):  # fecha, tiempo, T.M, T.I, SP, desv, presión
            if col(r, base) in (None, ""):
                continue
            temps.append([cons, clean(col(r, base)), clean(col(r, base + 1)), clean(col(r, base + 2)),
                          clean(col(r, base + 3)), clean(col(r, base + 4)), clean(col(r, base + 6))])
    write(os.path.join(out, "fermentaciones.csv"),
          ["cons", "tq", "marca", "levadura", "utq_origen", "generacion", "consistencia", "viabilidad",
           "ph_levadura", "temp_siembra", "inicio_llenado", "fin_llenado", "volumen_hl", "eo_ponderado",
           "e_limite", "recuento_3h", "fecha_af_real", "etapa"], ferm)
    write(os.path.join(out, "muestras_fermentacion.csv"),
          ["cons", "fecha", "horas", "extracto", "atenuacion", "ph"], muestras)
    write(os.path.join(out, "temperaturas.csv"),
          ["cons", "fecha", "horas", "temp_m", "temp_i", "set_point", "presion"], temps)

    # ---- Maduración (B.D MADURACIÓN, datos desde fila 13) ----
    mad = []
    for r in rows(wb["B.D MADURACIÓN"], 13, 440):
        cons, tq, marca = clean(col(r, 2)), clean(col(r, 3)), clean(col(r, 4))
        if not cons or not marca or tq in ("", "0"):
            continue
        mad.append([cons, tq, marca, clean(col(r, 9)), clean(col(r, 10)), clean(col(r, 11)),
                    clean(col(r, 12)), clean(col(r, 13)), clean(col(r, 14)), clean(col(r, 17)),
                    clean(col(r, 18)), clean(col(r, 54)), clean(col(r, 58)), clean(col(r, 65)),
                    clean(col(r, 66)), clean(col(r, 67)), clean(col(r, 68)), clean(col(r, 69)),
                    clean(col(r, 70)), clean(col(r, 71)), clean(col(r, 72)), clean(col(r, 73)),
                    clean(col(r, 74)), clean(col(r, 75)), clean(col(r, 76)), clean(col(r, 77)),
                    clean(col(r, 78)), clean(col(r, 80)), clean(col(r, 82)),
                    clean(col(r, 30)), clean(col(r, 31)), clean(col(r, 434))])
    write(os.path.join(out, "maduraciones.csv"),
          ["cons", "tq", "marca", "fv_cons", "fv_origen", "inicio_trasiego", "fin_trasiego",
           "lote_silica", "silica_kg", "vol_contador_hl", "responsable", "vol_total_hl", "eo_ponderado",
           "fecha_muestreo_final", "extracto_original", "e_app", "extracto_real", "alcohol_p", "alcohol_v",
           "rdf", "color", "ph", "amargo", "recuento", "o2_ppb", "co2", "turbidez", "sensorial1",
           "sensorial2", "fv2_cons", "fv2_tq", "etapa"], mad)

    # ---- Levadura (B.D LEVADURA, datos desde fila 12) ----
    lev = []
    for r in rows(wb["B.D LEVADURA"], 12, 51):
        codigo = clean(col(r, 2))
        if not codigo or codigo == "0":
            continue
        lev.append([codigo, clean(col(r, 3)), clean(col(r, 4)), clean(col(r, 5)), clean(col(r, 6)),
                    clean(col(r, 8)), clean(col(r, 9)), clean(col(r, 14)), clean(col(r, 19)),
                    clean(col(r, 20)), clean(col(r, 22)), clean(col(r, 23)), clean(col(r, 24)),
                    clean(col(r, 25)), clean(col(r, 26)), clean(col(r, 27)), clean(col(r, 29)),
                    clean(col(r, 30)), clean(col(r, 31)), clean(col(r, 32)), clean(col(r, 34))])
    write(os.path.join(out, "levaduras.csv"),
          ["codigo", "marca", "familia", "utq_fuente", "generacion", "inicio_remocion", "fin_remocion",
           "volumen_hl", "consistencia", "conteo", "viabilidad", "ph", "temp_cosecha", "sensorial",
           "responsable", "cons_fuente", "max_resiembra", "tq_resiembra", "cons_resiembra",
           "fecha_resiembra", "temp_siembra"], lev)

    # ---- Especificaciones por marca (límites superior/inferior, filas 11.., cols 3-9 y 11-17) ----
    esp, vistos = [], set()
    ws = wb["ESPECIFICACIONES MARCA"]
    marcas = None
    for i, r in enumerate(rows(ws, 1, 17), 1):
        if i == 10:
            marcas = [clean(c) for c in r[3:9]]
        if i < 11 or not marcas:
            continue
        param = clean(col(r, 3))
        if not param or param.upper() == "MARCA" or num(param) is not None:
            continue
        for j, m in enumerate(marcas):
            if (m, param) in vistos:
                continue
            vistos.add((m, param))
            esp.append([m, param, clean(col(r, 4 + j)), clean(col(r, 12 + j))])
        if i > 60:
            break
    write(os.path.join(out, "especificaciones.csv"), ["marca", "parametro", "limite_sup", "limite_inf"], esp)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
