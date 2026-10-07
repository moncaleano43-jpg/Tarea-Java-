/* ============================================================
   App.Importador · cargar Excel / CSV / texto pegado en cualquier apartado
   - Todo ocurre en el navegador; ningún archivo sale del equipo.
   - Detecta el tipo de archivo, muestra qué cambiaría (nuevas / actualizadas / iguales / conflictos) y solo
     entonces aplica. Antes de aplicar guarda una copia en IndexedDB «cifra-respaldos» para poder deshacer.
   - Fuentes operativas (agua, aseos, recuperación, programa) → App.OperationSources.setImport
   - Tablas libres → capturas de la plataforma (config.opCaptures_<tipo>)
   - Libro completo de control de cavas → App.ExcelCavas (read / plan / persist), sin reescribirlo.
   ============================================================ */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const A = root.App = root.App || {};

  /* ======================================================================
     1. Utilidades puras (se prueban en Node: tests/importador.test.mjs)
     ====================================================================== */
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const letra = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const T_MIN = 42005, T_MAX = 55154; // 2015-01-01 .. 2040-12-31 (serial Excel)
  const p2 = (n) => String(n).padStart(2, '0');

  /** Fecha civil → serial de Excel (hora local de pared, sin zona horaria). */
  const aSerial = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 86400000 + 25569;
  function validaFecha(y, mo, d, h = 0, mi = 0, s = 0) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59 || s > 59) return false;
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }
  /** Texto → serial. Devuelve {v} si es fecha válida, {malo:true} si parece fecha pero es imposible, null si no es fecha. */
  function fechaTexto(s) {
    s = String(s).trim();
    let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T,]+(\d{1,2})[:.hH](\d{2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?)?$/i.exec(s);
    let y, mo, d, h = 0, mi = 0, se = 0, ap;
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0); ap = (m[7] || '').toLowerCase(); }
    else {
      m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
      if (!m) return null;
      y = +m[1]; mo = +m[2]; d = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0);
    }
    if (ap) { if (/^p/.test(ap) && h < 12) h += 12; if (/^a/.test(ap) && h === 12) h = 0; }
    if (!validaFecha(y, mo, d, h, mi, se)) return { malo: true };
    return { v: aSerial(y, mo, d, h, mi, se) };
  }
  /** Texto de hora (08:00, 8:30:15) → fracción de día. */
  function horaTexto(s) {
    const m = /^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/.exec(String(s).trim());
    if (!m || +m[1] > 24 || +m[2] > 59) return null;
    return (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400;
  }
  /** Texto numérico con coma o punto decimal, miles opcionales. */
  function numeroTexto(s) {
    s = String(s).trim().replace(/\s+/g, '').replace(/%$/, '');
    if (!s || !/^[+-]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
    if (/^[+-]?0\d+$/.test(s)) return null; // códigos con ceros a la izquierda
    const pc = s.lastIndexOf('.'), cm = s.lastIndexOf(',');
    let x = s;
    if (pc >= 0 && cm >= 0) { const dec = Math.max(pc, cm) === pc ? '.' : ','; const mil = dec === '.' ? ',' : '.'; x = s.split(mil).join('').replace(dec, '.'); }
    else if (cm >= 0) { if ((s.match(/,/g) || []).length > 1) x = s.split(',').join(''); else x = s.replace(',', '.'); }
    else if ((s.match(/\./g) || []).length > 1) x = s.split('.').join('');
    if (!/^[+-]?\d*\.?\d+$/.test(x) && !/^[+-]?\d+\.$/.test(x)) return null;
    const n = parseFloat(x);
    return Number.isFinite(n) ? n : null;
  }
  const ERR_RE = /^#(REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!)/i;

  /** Valor de celda (número de Excel o texto) → serial de fecha o null. Acepta «21/01/2026 22.00». */
  function comoFecha(v) {
    if (isNum(v)) return v >= 20000 && v < 80000 ? v : null;
    if (typeof v !== 'string') return null;
    const r = fechaTexto(v);
    return r && r.v != null ? r.v : null;
  }
  const dmy = (serial) => { const d = new Date(Math.round((serial - 25569) * 86400000)); return p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };
  const dmyHm = (serial) => { const d = new Date(Math.round((serial - 25569) * 86400000)); return dmy(serial) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); };
  const hm = (frac) => { const t = Math.round(frac * 1440) % 1440; return p2(Math.floor(t / 60)) + ':' + p2(t % 60); };

  /** Lector de texto delimitado (comillas, saltos dentro de comillas, ; , tab | autodetectados). */
  function detectaSeparador(text) {
    const cand = ['\t', ';', ',', '|'], lines = [];
    let cur = '', q = false;
    for (let i = 0; i < text.length && lines.length < 12; i++) {
      const c = text[i];
      if (c === '"') q = !q;
      if (!q && (c === '\n' || c === '\r')) { if (cur.trim()) lines.push(cur); cur = ''; if (c === '\r' && text[i + 1] === '\n') i++; } else cur += c;
    }
    if (cur.trim() && lines.length < 12) lines.push(cur);
    let best = ',', bs = -1;
    for (const d of cand) {
      const counts = lines.map((l) => { let n = 0, qq = false; for (const c of l) { if (c === '"') qq = !qq; else if (!qq && c === d) n++; } return n; });
      const min = counts.length ? Math.min(...counts) : 0;
      if (min <= 0) continue;
      const same = counts.every((n) => n === counts[0]);
      const score = min * 10 + (same ? 5 : 0) + (d === '\t' ? 3 : d === ';' ? 2 : d === ',' ? 0 : 1);
      if (score > bs) { bs = score; best = d; }
    }
    return best;
  }
  function parseDelimitado(text, sep) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    sep = sep || detectaSeparador(text);
    const rows = [];
    let row = [], field = '', q = false, wasQ = false;
    const endField = () => { row.push(wasQ ? field : field.trim()); field = ''; wasQ = false; };
    const endRow = () => { endField(); if (row.some((x) => x !== '')) rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
      } else if (c === '"' && field.trim() === '') { q = true; wasQ = true; field = ''; }
      else if (c === sep) endField();
      else if (c === '\n') endRow();
      else if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
      else field += c;
    }
    if (field !== '' || row.length) endRow();
    return { rows, sep };
  }
  const nombreSep = (s) => ({ '\t': 'tabulador', ';': 'punto y coma', ',': 'coma', '|': 'barra vertical' }[s] || s);

  /** Convierte cada columna según lo que contiene (número / fecha / hora / texto). rows = matriz de texto. */
  function tipificar(rows, desde, ancho) {
    const out = rows.map((r) => r.slice()), info = [];
    for (let j = 0; j < ancho; j++) {
      const vals = [];
      for (let i = desde; i < rows.length; i++) { const v = rows[i][j]; if (v != null && String(v).trim() !== '') vals.push([i, String(v).trim()]); }
      if (!vals.length) { info.push({ tipo: 'texto', malos: 0 }); continue; }
      let nn = 0, nd = 0, nh = 0, nbad = 0;
      for (const [, v] of vals) {
        if (numeroTexto(v) != null && !/[:\/]/.test(v)) nn++;
        else if (horaTexto(v) != null) nh++;
        else { const f = fechaTexto(v); if (f) { if (f.malo) nbad++; else nd++; } }
      }
      const k = vals.length, lim = 0.8 * k;
      let tipo = 'texto';
      if (nn >= lim) tipo = 'numero'; else if (nd + nbad >= lim && nd > 0) tipo = 'fecha'; else if (nh >= lim) tipo = 'hora';
      if (tipo === 'numero') for (const [i, v] of vals) { const x = numeroTexto(v); if (x != null) out[i][j] = x; }
      else if (tipo === 'fecha') for (const [i, v] of vals) { const f = fechaTexto(v); if (f && f.v != null) out[i][j] = f.v; }
      else if (tipo === 'hora') for (const [i, v] of vals) { const x = horaTexto(v); if (x != null) out[i][j] = x; }
      info.push({ tipo, malos: tipo === 'fecha' ? nbad : 0 });
    }
    return { rows: out, info };
  }

  /** Fila de encabezado más probable en una matriz de filas (arrays). */
  function detectaEncabezado(m) {
    const lim = Math.min(m.length, 30), sc = [];
    let max = 0;
    for (let i = 0; i < lim; i++) {
      const r = m[i] || [];
      let n = 0;
      for (const v of r) if (typeof v === 'string' && v.trim() && numeroTexto(v) == null && !fechaTexto(v) && !ERR_RE.test(v)) n++;
      sc.push(n); if (n > max) max = n;
    }
    if (max < 2) return 0;
    for (let i = 0; i < lim; i++) if (sc[i] >= Math.max(2, Math.ceil(max * 0.8))) return i;
    return 0;
  }

  const STOP = new Set(['de', 'del', 'la', 'el', 'en', 'y', 'o', 'a', 'por', 'con', 'las', 'los', 'hl', 'm3', 'm', 'h']);
  const tokens = (s) => norm(s).split(' ').filter((t) => t && !STOP.has(t)).map((t) => t.replace(/(es|s)$/, (x, g, o, all) => (all.length > 4 ? '' : x)));
  /** Similitud 0..1 entre dos nombres de columna. */
  function similitud(a, b) {
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ta = new Set(tokens(a)), tb = new Set(tokens(b));
    let inter = 0;
    ta.forEach((t) => {
      if (tb.has(t)) inter++;
      else for (const u of tb) if (u.length > 3 && t.length > 3 && (u.startsWith(t) || t.startsWith(u))) { inter += 0.7; break; }
    });
    const uni = ta.size + tb.size - inter;
    let s = uni > 0 ? inter / uni : 0;
    if (na.length > 2 && nb.length > 2 && (na.includes(nb) || nb.includes(na))) s = Math.max(s, 0.6);
    return Math.min(1, s);
  }
  /** Sugerencia de mapeo: devuelve array (una posición por columna de origen) con el índice destino o -1. */
  function sugiereMapeo(origen, destinos, umbral = 0.4) {
    const pares = [];
    origen.forEach((o, i) => destinos.forEach((d) => { const s = similitud(o, d.label); if (s >= umbral) pares.push([s, i, d.i]); }));
    pares.sort((a, b) => b[0] - a[0]);
    const res = origen.map(() => -1), usadoD = new Set();
    for (const [, i, d] of pares) if (res[i] < 0 && !usadoD.has(d)) { res[i] = d; usadoD.add(d); }
    return res;
  }

  /* ---------- Hojas operativas: encabezado, claves de fusión, datos ---------- */
  const MAIN = { agua: '2026', aseos: '1. Cada uso', recuperacion: 'Control Recuperada', programa: 'CONTROL TRASIEGO' };
  const TIPOS = {
    agua: { titulo: 'Consumo de agua', unidad: 'lecturas', clave: 'fecha + hora' },
    aseos: { titulo: 'Aseos', unidad: 'aseos', clave: 'hoja + equipo + inicio' },
    recuperacion: { titulo: 'Recuperación de cerveza', unidad: 'recuperaciones', clave: 'consecutivo' },
    programa: { titulo: 'Programa de trasiego', unidad: 'actividades', clave: 'proceso + inicio planeado' },
    cavas: { titulo: 'Control de proceso de cavas', unidad: 'registros', clave: 'lote / FV / levadura' },
    libre: { titulo: 'Tabla libre', unidad: 'filas', clave: '' },
  };
  const ETIQ_TIPO = (t) => (TIPOS[t] || TIPOS.libre).titulo;

  /** Misma heurística que OperationSources.schema para localizar la fila de encabezado de una hoja. */
  function filaEncabezado(tipo, nombre, rows) {
    let h;
    if (tipo === 'agua' && nombre === '2026') h = rows.find((r) => r.row === 12);
    else if (tipo === 'recuperacion' && nombre === 'Control Recuperada') h = rows.find((r) => r.row === 11);
    else if (/^CONTROL TRASIEGO/.test(nombre)) h = rows.find((r) => r.row === 8);
    else {
      h = rows.find((r) => r.row < 15 && Object.values(r.cells).filter((v) => typeof v === 'string' && /fecha|equipo|proceso|operario|concen|tiempo|comentario|volumen|recolec/i.test(v)).length >= 5);
      if (!h) h = rows.find((r) => r.row < 15 && Object.keys(r.cells).length >= 6) || rows[0];
    }
    return h || null;
  }
  const etiquetas = (h) => { const o = {}; if (h) for (const [i, v] of Object.entries(h.cells)) o[i] = String(v).replace(/\s+/g, ' ').trim(); return o; };

  const minuto = (s) => Math.round(s * 1440);
  const tieneDatos = (tipo, c) => {
    if (tipo === 'agua') return [4, 9, 14].some((i) => isNum(c[i]) && c[i] > 0);
    if (tipo === 'recuperacion') return [1, 2, 4, 38].some((i) => c[i] != null && c[i] !== '');
    if (tipo === 'programa') return c[1] != null && c[4] != null;
    return Object.keys(c).length >= 3;
  };

  /**
   * Claves de fusión por fila. Devuelve un array paralelo a rows con la clave (texto) o null.
   * Devuelve null si la hoja no tiene clave definida (se reemplaza completa).
   */
  function claves(tipo, nombre, rows, encab, sinRelleno) {
    const cuenta = new Map();
    const unica = (k) => { const n = (cuenta.get(k) || 0) + 1; cuenta.set(k, n); return n > 1 ? k + '#' + n : k; };
    const hdrRow = encab ? encab.row : 0;
    if (tipo === 'agua' && nombre === '2026') {
      let dia = null, enDia = 0;
      return rows.map((r) => {
        if (r.row <= hdrRow) return null;
        const d = comoFecha(r.cells[1]);
        if (d != null) { dia = Math.floor(d); enDia = 0; } else if (dia == null || sinRelleno) return null; else enDia++;
        const hf = r.cells[3];
        return unica('D' + dia + '|' + (isNum(hf) ? minuto(hf) : '#' + enDia));
      });
    }
    if (tipo === 'recuperacion' && nombre === 'Control Recuperada') {
      return rows.map((r) => {
        if (r.row <= hdrRow) return null;
        const c = r.cells;
        if (isNum(c[0])) return unica('C' + c[0]);
        const f = comoFecha(c[2]);
        if (c[1] && f != null) return unica('U' + norm(c[1]) + '|' + minuto(f));
        return null;
      });
    }
    if (tipo === 'programa' && /^CONTROL TRASIEGO/.test(nombre)) {
      return rows.map((r) => {
        if (r.row <= hdrRow) return null;
        const f = comoFecha(r.cells[4]);
        if (!r.cells[1] || f == null) return null;
        return unica('P' + norm(r.cells[1]) + '|' + minuto(f));
      });
    }
    if (tipo === 'aseos') {
      const lab = etiquetas(encab), idx = Object.keys(lab);
      const buscar = (re, no) => { const k = idx.find((i) => re.test(lab[i]) && !(no && no.test(lab[i]))); return k == null ? -1 : +k; };
      const ini = buscar(/fecha.*inicio|fecha del aseo|fecha.*aseo|^fecha$/i, /programad|propuest|fin\b/i);
      const prog = buscar(/programada|propuesta/i);
      const eq = buscar(/equipo|tanque|linea|red\b/i);
      if ((ini < 0 && prog < 0) || eq < 0) return null;
      return rows.map((r) => {
        if (r.row <= hdrRow) return null;
        const c = r.cells;
        let f = ini >= 0 ? comoFecha(c[ini]) : null, pre = 'I';
        if (f == null && prog >= 0) { f = comoFecha(c[prog]); pre = 'P'; }
        if (f == null || c[eq] == null) return null;
        return unica(nombre + '|' + norm(c[eq]) + '|' + pre + minuto(f));
      });
    }
    return null;
  }

  // Las celdas con error de Excel (#DIV/0!, #REF!…) no cuentan como dato: el lector las entrega vacías.
  const esErr = (v) => typeof v === 'string' && ERR_RE.test(v.trim());
  const iguales = (a, b) => {
    const ka = Object.keys(a).filter((k) => !esErr(a[k])), kb = Object.keys(b).filter((k) => !esErr(b[k]));
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      const x = a[k], y = b[k];
      if (y === undefined || esErr(y)) return false;
      if (isNum(x) && isNum(y)) { if (Math.abs(x - y) > 1e-9) return false; } else if (x !== y) return false;
    }
    return true;
  };

  /** Fusiona una hoja entrante en la actual. ed = ediciones propias de la plataforma (por id de fila). */
  function fusionarHoja(tipo, nombre, act, inc, idPrefijo, ed) {
    const hInc = filaEncabezado(tipo, nombre, inc.rows);
    const kInc = claves(tipo, nombre, inc.rows, hInc);
    if (!kInc) return { modo: 'reemplazo', hoja: inc, c: null };
    const hAct = filaEncabezado(tipo, nombre, act.rows) || hInc;
    const kAct = claves(tipo, nombre, act.rows, hAct) || [];
    const mapa = new Map();
    kAct.forEach((k, i) => { if (k != null && !mapa.has(k)) mapa.set(k, i); });
    const rows = act.rows.slice();
    let maxRow = rows.reduce((m, r) => Math.max(m, r.row), 0);
    const c = { nuevas: 0, actualizadas: 0, iguales: 0, conflictos: 0, repetidas: 0 };
    const vistos = new Set();
    inc.rows.forEach((r, i) => {
      const k = kInc[i];
      if (k == null) return;
      if (/#\d+$/.test(k) && tieneDatos(tipo, r.cells)) c.repetidas++;
      vistos.add(k);
      const j = mapa.get(k);
      const datos = tieneDatos(tipo, r.cells);
      if (j == null) {
        if (!datos) return;
        rows.push({ row: ++maxRow, cells: r.cells }); mapa.set(k, rows.length - 1); c.nuevas++;
        return;
      }
      const a = rows[j];
      const aDatos = tieneDatos(tipo, a.cells);
      if (iguales(a.cells, r.cells)) { if (datos) c.iguales++; return; }
      if (ed && ed[idPrefijo + '|' + nombre + '|' + a.row]) { c.conflictos++; return; }
      rows[j] = { row: a.row, cells: r.cells };
      if (!aDatos && datos) c.nuevas++; else if (datos || aDatos) c.actualizadas++;
    });
    return { modo: 'fusion', hoja: { rows, formulas: act.formulas || {} }, c };
  }

  /** Fusiona todas las hojas de un libro entrante en la fuente actual. */
  function fusionarLibro(tipo, actual, entrante, idPrefijo, ed) {
    const next = {}, hojas = [], total = { nuevas: 0, actualizadas: 0, iguales: 0, conflictos: 0, repetidas: 0 };
    for (const n of Object.keys(actual)) next[n] = actual[n];
    for (const [n, inc] of Object.entries(entrante)) {
      if (!actual[n]) { next[n] = inc; hojas.push({ nombre: n, modo: 'nueva', filas: inc.rows.length }); continue; }
      const r = fusionarHoja(tipo, n, actual[n], inc, idPrefijo, ed);
      next[n] = r.hoja;
      hojas.push({ nombre: n, modo: r.modo, c: r.c, filas: r.hoja.rows.length });
      if (r.c) for (const k of Object.keys(total)) total[k] += r.c[k];
    }
    return { next, hojas, total };
  }
  /** Contadores informativos de «Reemplazar»: compara claves actual vs entrante (solo hojas con clave). */
  function contarReemplazo(tipo, actual, entrante, idPrefijo, ed) {
    const total = { nuevas: 0, actualizadas: 0, iguales: 0, conflictos: 0, perdidas: 0 };
    for (const [n, inc] of Object.entries(entrante)) {
      if (!actual[n]) continue;
      const hInc = filaEncabezado(tipo, n, inc.rows), kInc = claves(tipo, n, inc.rows, hInc);
      if (!kInc) continue;
      const hAct = filaEncabezado(tipo, n, actual[n].rows) || hInc, kAct = claves(tipo, n, actual[n].rows, hAct) || [];
      const mapa = new Map();
      kAct.forEach((k, i) => { if (k != null && !mapa.has(k)) mapa.set(k, i); });
      const vistos = new Set();
      inc.rows.forEach((r, i) => {
        const k = kInc[i]; if (k == null) return;
        vistos.add(k);
        const datos = tieneDatos(tipo, r.cells), j = mapa.get(k);
        if (j == null) { if (datos) total.nuevas++; return; }
        const a = actual[n].rows[j];
        if (iguales(a.cells, r.cells)) { if (datos) total.iguales++; } else if (datos || tieneDatos(tipo, a.cells)) total.actualizadas++;
      });
      mapa.forEach((j, k) => { if (!vistos.has(k) && tieneDatos(tipo, actual[n].rows[j].cells)) total.perdidas++; });
    }
    return total;
  }

  /** Matriz (arrays dispersos) → forma de OperationSources {rows:[{row,cells}], formulas:{}}. */
  function aHoja(matriz) {
    const rows = [];
    matriz.forEach((r, i) => {
      if (!r) return;
      const cells = {};
      let n = 0;
      for (let j = 0; j < r.length; j++) { const v = r[j]; if (v != null && v !== '') { cells[j] = v; n++; } }
      if (n) rows.push({ row: i + 1, cells });
    });
    return { rows, formulas: {} };
  }

  /* ---------- Lector rápido de hojas (.xlsx/.xlsm) ----------
     App.BDM.leerLibro recorre cada <row> con DOMParser: en hojas con un millón de filas vacías con formato
     (típico de los libros de aseos) tarda minutos. Este lector solo visita las celdas que tienen valor.
     Mismo formato de salida que BDM.filas: array disperso [fila-1][columna-1]. Si algo falla se usa BDM. */
  const decEnt = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  }));
  const colNum = (L) => { let n = 0; for (let i = 0; i < L.length; i++) n = n * 26 + L.charCodeAt(i) - 64; return n - 1; };
  async function inflarRaw(u) {
    if (typeof DecompressionStream === 'undefined') throw new Error('NAVEGADOR');
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(ds)).arrayBuffer());
  }
  function zipLeer(buf) {
    const u = new Uint8Array(buf), dv = new DataView(buf);
    let e = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('FORMATO');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const ent = {}, dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('FORMATO');
      const met = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      ent[dec.decode(u.subarray(p + 46, p + 46 + nl))] = { met, cs, lo };
      p += 46 + nl + xl + cl;
    }
    return async (name) => {
      const x = ent[name]; if (!x) return null;
      const lnl = dv.getUint16(x.lo + 26, true), lxl = dv.getUint16(x.lo + 28, true), st = x.lo + 30 + lnl + lxl, raw = u.subarray(st, st + x.cs);
      return dec.decode(x.met === 0 ? raw : await inflarRaw(raw));
    };
  }
  const atr = (tag, n) => { const m = new RegExp('\\b' + n + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
  async function libroRapido(buf) {
    const leer = zipLeer(buf);
    const wb = await leer('xl/workbook.xml'), rels = (await leer('xl/_rels/workbook.xml.rels')) || '';
    if (!wb) throw new Error('FORMATO');
    const rmap = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) rmap[atr(m[0], 'Id')] = atr(m[0], 'Target');
    const hojas = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
      const rid = atr(m[0], 'r:id'); const t = (rmap[rid] || '').replace(/^\/?xl\//, '').replace(/^\//, '');
      return { nombre: decEnt(atr(m[0], 'name') || ''), ruta: 'xl/' + t };
    });
    let ss = null;
    const compartidas = async () => {
      if (ss) return ss;
      ss = [];
      const x = await leer('xl/sharedStrings.xml');
      if (x) for (const m of x.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
        let t = '';
        if (m[1]) for (const q of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += q[1];
        ss.push(decEnt(t));
      }
      return ss;
    };
    const filas = async (nombre, lim = {}) => {
      const hj = hojas.find((x) => x.nombre === nombre); if (!hj) return null;
      const xml = await leer(hj.ruta); if (!xml) return null;
      const S = await compartidas(), out = [], maxRow = lim.maxRow || 0, maxCol = lim.maxCol || 0;
      let i = 0, cnt = 0;
      while ((i = xml.indexOf('<c ', i)) >= 0) {
        const e = xml.indexOf('>', i);
        if (e < 0) break;
        if (xml.charCodeAt(e - 1) === 47) { i = e; continue; } // <c .../> sin valor
        const tag = xml.slice(i + 3, e), fin = xml.indexOf('</c>', e);
        if (fin < 0) break;
        const body = xml.slice(e + 1, fin); i = fin;
        const rm = /\br="([A-Z]+)(\d+)"/.exec(tag); if (!rm) continue;
        const fila = +rm[2], col = colNum(rm[1]);
        if ((maxRow && fila > maxRow) || (maxCol && col + 1 > maxCol)) continue;
        const t = atr(tag, 't');
        let v = null;
        if (t === 'inlineStr') { if (body.indexOf('<is>') < 0) continue; v = ''; for (const q of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) v += q[1]; v = decEnt(v); }
        else {
          const a = body.indexOf('<v>'); if (a < 0) continue;
          const b = body.indexOf('</v>', a); const raw = body.slice(a + 3, b < 0 ? undefined : b);
          if (t === 's') v = S[+raw] == null ? null : S[+raw];
          else if (t === 'b') v = raw === '1';
          else if (t === 'e') v = null;
          else if (t === 'str') v = decEnt(raw);
          else v = Number(raw);
        }
        (out[fila - 1] || (out[fila - 1] = []))[col] = v; cnt++;
        if (cnt % 20000 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      return out;
    };
    return { hojas: hojas.map((h) => h.nombre), filas };
  }
  /** Abre el libro con BDM (nombres de hoja, errores conocidos) y lee las hojas con el lector rápido. */
  async function abrirLibro(buf) {
    const base = await A.BDM.leerLibro(buf);
    let rapido = null;
    try { rapido = await libroRapido(buf); } catch (e) { rapido = null; }
    return { hojas: base.hojas, filas: async (n, l) => { if (rapido) { try { const r = await rapido.filas(n, l); if (r) return r; } catch (e) { /* usa BDM */ } } return base.filas(n, l); }, _rapido: !!rapido };
  }

  /* ---------- Detección del tipo de archivo ---------- */
  function detectaPorHojas(hojas) {
    const n = hojas.map(norm), has = (x) => n.includes(norm(x));
    if (has('INVENTARIO') && has('B.D FERMENTACIÓN') && (has('B.D MADURACIÓN') || has('B.D LEVADURA'))) return { tipo: 'cavas', hoja: 'B.D FERMENTACIÓN' };
    if (has('1. Cada uso') || has('2. Semanal') || has('3. Mensual') || has('4. Desincrustaciones')) return { tipo: 'aseos', hoja: hojas[n.indexOf(norm('1. Cada uso'))] || hojas[n.indexOf(norm('2. Semanal'))] };
    if (has('Control Recuperada')) return { tipo: 'recuperacion', hoja: hojas[n.indexOf(norm('Control Recuperada'))] };
    if (has('CONTROL TRASIEGO')) return { tipo: 'programa', hoja: hojas[n.indexOf(norm('CONTROL TRASIEGO'))] };
    const y = hojas.find((h) => /^\s*20\d\d\s*$/.test(h));
    if (y) return { tipo: 'agua?', hoja: y };
    return { tipo: 'libre', hoja: hojas[0] };
  }
  const esAgua = (muestra) => {
    const txt = norm(muestra.map((r) => (r || []).filter((v) => typeof v === 'string').join(' ')).join(' '));
    return /\bfecha\b/.test(txt) && /\blectura\b/.test(txt);
  };

  /* ---------- Resumen y validación ---------- */
  function resumen(tipo, hojas, main) {
    const h = hojas[main]; if (!h) return null;
    const enc = filaEncabezado(tipo, main, h.rows), k = claves(tipo, main, h.rows, enc) || [];
    let n = 0, d0 = Infinity, d1 = -Infinity;
    const col = tipo === 'agua' ? 1 : tipo === 'recuperacion' ? 2 : tipo === 'programa' ? 4 : null;
    const lab = etiquetas(enc);
    const cInicio = tipo === 'aseos' ? Object.keys(lab).find((i) => /fecha.*inicio|fecha del aseo|fecha.*aseo|^fecha$/i.test(lab[i]) && !/programad|propuest|fin\b/i.test(lab[i])) : null;
    let dia = null;
    h.rows.forEach((r, i) => {
      if (r.row <= (enc ? enc.row : 0)) return;
      if (tipo === 'agua') { const f = comoFecha(r.cells[1]); if (f != null) dia = Math.floor(f); }
      if (k[i] == null || !tieneDatos(tipo, r.cells)) return;
      n++;
      let f = tipo === 'agua' ? dia : tipo === 'aseos' ? comoFecha(r.cells[cInicio]) : comoFecha(r.cells[col]);
      if (f != null && f >= T_MIN && f <= T_MAX) { if (f < d0) d0 = f; if (f > d1) d1 = f; }
    });
    return { n, desde: d0 === Infinity ? null : d0, hasta: d1 === -Infinity ? null : d1, hojas: Object.keys(hojas).filter((x) => hojas[x].rows.length).length };
  }

  const metas = (path, def) => { try { const v = A.Metas && A.Metas.get(path); return v == null ? def : v; } catch (e) { return def; } };
  /** Avisos de validación sobre filas ya cargadas. lab = {idx:etiqueta}. */
  function validar(tipo, filas, lab, extra = {}) {
    const av = [];
    const add = (nivel, texto, ejemplos) => av.push({ nivel, texto, ejemplos: (ejemplos || []).slice(0, 4) });
    let errores = 0, malas = 0, fuera = 0, ejE = [], ejM = [];
    const colFecha = Object.keys(lab).filter((i) => /fecha|inicio|fin\b/i.test(lab[i]) && !/hora/i.test(lab[i]));
    const rg = { negativo: [], enorme: [], horas: [], ph: [], crono: [] };
    const pisosAlto = metas('agua.pisosAlto', 100), geaAlto = metas('agua.geaAlto', 1000), maxH = metas('recuperacion.maximoH', 96);
    const phMin = metas('aseos.phMin', 6), phMax = metas('aseos.phMax', 8), phRec = metas('recuperacion.phMax', 5.35);
    const colPh = tipo === 'aseos' ? Object.keys(lab).filter((i) => /^ph\b/i.test(lab[i])) : [];
    for (const r of filas) {
      const c = r.cells, id = r.row != null ? 'fila ' + r.row : (r.n != null ? 'fila ' + r.n : '');
      for (const [i, v] of Object.entries(c)) {
        if (typeof v === 'string' && ERR_RE.test(v.trim())) { errores++; if (ejE.length < 3) ejE.push(id + ' · ' + (lab[i] || letra(+i)) + ': ' + v); }
      }
      for (const i of colFecha) {
        const v = c[i]; if (v == null || v === '') continue;
        let mala = false;
        if (isNum(v)) mala = v >= 1 && v < 20000 || v > 80000 || (v >= 20000 && (v < T_MIN || v > T_MAX));
        else if (typeof v === 'string' && !ERR_RE.test(v)) { const f = fechaTexto(v); mala = !!(f && (f.malo || f.v < T_MIN || f.v > T_MAX)) || (!f && /\d+[\/\-]\d+[\/\-]\d+/.test(v)); }
        if (mala) { malas++; if (ejM.length < 4) ejM.push(id + ' · ' + (lab[i] || letra(+i)) + ': ' + (isNum(v) ? v : '«' + v + '»')); }
      }
      if (tipo === 'agua') {
        const pis = c[5], cip = c[10], gea = c[15];
        if (isNum(pis) && pis < 0 || isNum(cip) && cip < 0 || isNum(gea) && gea < 0) rg.negativo.push(id + ': consumo ' + (isNum(pis) && pis < 0 ? pis + ' m³ (pisos)' : isNum(cip) && cip < 0 ? cip + ' m³ (CIP)' : gea + ' hl (GEA)'));
        if (isNum(pis) && pis > pisosAlto * 10 || isNum(cip) && cip > pisosAlto * 10 || isNum(gea) && gea > geaAlto * 10) rg.enorme.push(id + ': ' + [isNum(pis) && pis > pisosAlto * 10 ? pis + ' m³ pisos' : '', isNum(cip) && cip > pisosAlto * 10 ? cip + ' m³ CIP' : '', isNum(gea) && gea > geaAlto * 10 ? gea + ' hl GEA' : ''].filter(Boolean).join(', '));
      } else if (tipo === 'recuperacion') {
        if (isNum(c[37]) && c[37] > maxH) rg.horas.push(id + ': ' + Math.round(c[37]) + ' h hasta recuperar');
        if (isNum(c[47]) && c[47] > phRec) rg.ph.push(id + ': pH ' + c[47]);
      } else if (tipo === 'aseos') {
        for (const i of colPh) if (isNum(c[i]) && (c[i] < phMin || c[i] > phMax) && c[i] > 0 && c[i] < 15) rg.ph.push(id + ': pH ' + c[i]);
      } else if (tipo === 'programa') {
        const a = comoFecha(c[6]), b = comoFecha(c[7]);
        if (a != null && b != null && b < a) rg.crono.push(id + ': fin real antes del inicio real');
      }
    }
    if (errores) add('info', errores + ' celda' + (errores > 1 ? 's' : '') + ' con error de Excel (#REF!, #DIV/0!…). Se conservan como texto y no afectan los cálculos.', ejE);
    if (malas) add('warn', malas + ' fecha' + (malas > 1 ? 's' : '') + ' imposible' + (malas > 1 ? 's' : '') + ' (fuera de 2015-2040, día inexistente o número suelto). Esas filas no aparecerán en los análisis por fecha.', ejM);
    if (rg.negativo.length) add('warn', rg.negativo.length + ' consumo' + (rg.negativo.length > 1 ? 's' : '') + ' negativo' + (rg.negativo.length > 1 ? 's' : '') + ' (lectura menor que la anterior).', rg.negativo);
    if (rg.enorme.length) add('warn', rg.enorme.length + ' valor' + (rg.enorme.length > 1 ? 'es' : '') + ' desproporcionado' + (rg.enorme.length > 1 ? 's' : '') + ' frente a las metas (más de 10 veces el límite alto); suele ser una lectura sobrescrita.', rg.enorme);
    if (rg.horas.length) add('info', rg.horas.length + ' recuperaciones superan el máximo de ' + maxH + ' h.', rg.horas);
    if (rg.ph.length) add('info', rg.ph.length + ' valores de pH fuera de la meta.', rg.ph);
    if (rg.crono.length) add('warn', rg.crono.length + ' actividades con fin real antes del inicio real.', rg.crono);
    if (extra.repetidas) add('warn', extra.repetidas + ' fila' + (extra.repetidas > 1 ? 's' : '') + ' repetida' + (extra.repetidas > 1 ? 's' : '') + ' (misma clave: ' + (TIPOS[tipo] || {}).clave + '). Se conservan todas.', []);
    if (extra.duplicadas) add('warn', extra.duplicadas + ' fila' + (extra.duplicadas > 1 ? 's' : '') + ' duplicada' + (extra.duplicadas > 1 ? 's' : '') + ' dentro del archivo (idéntica a otra). Solo se importa una.', []);
    return av;
  }

  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

  A.Importador = Object.assign(A.Importador || {}, {
    _p: { norm, letra, fechaTexto, horaTexto, numeroTexto, parseDelimitado, detectaSeparador, tipificar, detectaEncabezado, similitud, sugiereMapeo, claves, filaEncabezado, fusionarHoja, fusionarLibro, contarReemplazo, aHoja, detectaPorHojas, esAgua, resumen, libroRapido, validar, comoFecha, tieneDatos, dmy, dmyHm, iguales, hash },
  });

  if (typeof document === 'undefined' || !A.U) return;

  /* ======================================================================
     2. Respaldos (IndexedDB «cifra-respaldos»)
     ====================================================================== */
  const DB_NAME = 'cifra-respaldos', MAX_RESPALDOS = 8;
  function abrirDB() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('Este navegador no permite guardar copias de seguridad.'));
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('respaldos', { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('No se pudo abrir las copias de seguridad.'));
    });
  }
  const tx = (db, modo, fn) => new Promise((res, rej) => {
    const t = db.transaction('respaldos', modo), st = t.objectStore('respaldos');
    let out; const rq = fn(st); if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Cancelado'));
  });
  async function guardarRespaldo(rec) {
    const db = await abrirDB();
    try {
      await tx(db, 'readwrite', (s) => s.put(rec));
      const todos = await tx(db, 'readonly', (s) => s.getAll());
      const viejos = todos.sort((a, b) => b.t - a.t).slice(MAX_RESPALDOS);
      for (const v of viejos) await tx(db, 'readwrite', (s) => s.delete(v.id));
    } finally { db.close(); }
  }
  async function listarRespaldos() {
    try {
      const db = await abrirDB();
      try { return (await tx(db, 'readonly', (s) => s.getAll())).sort((a, b) => b.t - a.t); } finally { db.close(); }
    } catch (e) { return []; }
  }
  async function leerRespaldo(id) { const db = await abrirDB(); try { return await tx(db, 'readonly', (s) => s.get(id)); } finally { db.close(); } }
  async function marcarDeshecho(id) {
    const db = await abrirDB();
    try { const r = await tx(db, 'readonly', (s) => s.get(id)); if (r) { r.estado = 'deshecha'; r.antes = null; await tx(db, 'readwrite', (s) => s.put(r)); } } finally { db.close(); }
  }
  function leerSnapshotCavas() {
    return new Promise((res) => {
      try {
        const r = indexedDB.open('ControlCavasExcel:v1');
        r.onsuccess = () => {
          const db = r.result;
          try {
            if (!db.objectStoreNames.contains('snapshots')) { db.close(); return res(null); }
            const g = db.transaction('snapshots').objectStore('snapshots').get('current');
            g.onsuccess = () => { db.close(); res(g.result || null); };
            g.onerror = () => { db.close(); res(null); };
          } catch (e) { db.close(); res(null); }
        };
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  const clon = (o) => (o == null ? o : (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o))));

  /** Foto del estado que va a cambiar, antes de aplicar. */
  async function fotoPrevia(tipo, soloCapturas) {
    const antes = {};
    const S = A.OperationSources;
    if (TIPOS[tipo] && S && S.defs && S.defs[tipo]) {
      if (!soloCapturas) antes.fuente = clon(S.raw(tipo));
      else antes.capturas = clon((A.S.config['opCaptures_' + tipo]) || null);
    } else if (tipo === 'cavas') {
      antes.cavas = await leerSnapshotCavas();
    }
    return antes;
  }
  async function restaurar(rec) {
    const a = rec.antes; if (!a) throw new Error('Esta importación ya no se puede deshacer.');
    const S = A.OperationSources;
    if (a.fuente && S && S.setImport) await S.setImport(rec.tipoFuente || rec.tipo, a.fuente);
    if ('capturas' in a && S && S.defs[rec.tipoFuente || rec.tipo]) {
      const k = 'opCaptures_' + (rec.tipoFuente || rec.tipo);
      await A.Store.set('config', k, a.capturas || { records: [] });
    }
    if (rec.tipo === 'cavas' && A.ExcelCavas) await A.ExcelCavas.persist(a.cavas || clon(A.ExcelCavas.baselineData()));
    await marcarDeshecho(rec.id);
    try { A.DL.invalidate(); } catch (e) { /* sin capa de datos */ }
    A.render(true);
  }

  /* ======================================================================
     3. Lectura de archivos
     ====================================================================== */
  const { esc } = A.U;
  const nf = new Intl.NumberFormat('es-CO');
  const fmtN = (n) => nf.format(n);
  const fmtMB = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const pausa = () => new Promise((r) => setTimeout(r, 0));
  const ext = (n) => (/\.([a-z0-9]+)$/i.exec(n || '') || [, ''])[1].toLowerCase();
  const DATOS_EXT = ['xlsx', 'xlsm', 'csv', 'tsv', 'txt'];

  async function leerTexto(file) {
    const buf = await file.arrayBuffer();
    let t = new TextDecoder('utf-8').decode(buf);
    if (t.indexOf('�') >= 0) { try { t = new TextDecoder('windows-1252').decode(buf); } catch (e) { /* se queda utf-8 */ } }
    return t;
  }
  const hojaDeTexto = (texto) => {
    const p = parseDelimitado(texto);
    const ancho = p.rows.reduce((m, r) => Math.max(m, r.length), 0);
    return { matriz: p.rows.map((r) => { const o = r.slice(); while (o.length < ancho) o.push(''); return o; }), sep: p.sep, texto: true };
  };

  /* ======================================================================
     4. Asistente
     ====================================================================== */
  let wiz = null; // asistente abierto

  const ic = {
    up: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>',
    ok: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4m0 3v.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.01"/></svg>',
  };

  const secciones = { tanques: 'Tanques', levaduras: 'Levaduras', bd: 'Base de datos', aseos: 'Aseos', recuperacion: 'Recuperación', programa: 'Programa de trasiego', merma: 'Merma', agua: 'Consumo de agua', analisis: 'Análisis' };
  const OPS = ['agua', 'aseos', 'recuperacion', 'programa'];

  function nuevoEstado(seccion) {
    return { paso: 1, seccion: seccion || null, archivo: null, nombre: '', tam: 0, hojas: [], libro: null, texto: null, matriz: null, tipo: null, detectado: null, hojaMain: null, entrante: null, plan: null, modo: 'combinar', lectura: 0, avisos: [], cargando: null, error: null, ancho: 0, t0: 0, libre: null, cavas: null, resultado: null, pegado: false };
  }

  async function abrir(opts = {}) {
    if (wiz) { try { wiz.d.close(); wiz.d.remove(); } catch (e) { /* ya cerrado */ } wiz = null; }
    const d = document.createElement('dialog');
    d.className = 'wide imp-dlg';
    d.innerHTML = '<div class="dlg"><header><h3>Cargar archivo</h3><button class="btn sm" type="button" data-x>Cerrar</button></header><div class="bd imp-bd"></div><footer class="imp-ft"></footer></div>';
    document.body.appendChild(d);
    const w = wiz = { d, s: nuevoEstado(opts.seccion || (A.Seccion ? A.Seccion.ruta() : null)), bd: d.querySelector('.imp-bd'), ft: d.querySelector('.imp-ft'), h3: d.querySelector('h3') };
    const cerrar = () => { if (w.s.cargando && w.s.cargando.bloquea) return; try { d.close(); } catch (e) { /* */ } d.remove(); if (wiz === w) wiz = null; };
    w.cerrar = cerrar;
    d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
    d.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) cerrar(); });
    enlazar(w);
    d.showModal();
    pintar(w);
    if (opts.archivo) cargarArchivo(w, opts.archivo);
    return w;
  }

  function pasos(w) {
    const p = w.s.paso, t = ['Elegir', 'Revisar', 'Listo'];
    return '<ol class="imp-steps">' + t.map((x, i) => `<li class="${i + 1 === p ? 'on' : i + 1 < p ? 'done' : ''}"><span>${i + 1}</span>${x}</li>`).join('') + '</ol>';
  }

  function pintar(w) {
    const s = w.s;
    w.h3.textContent = s.paso === 3 ? 'Importación lista' : 'Cargar archivo';
    if (s.paso === 1) pintarPaso1(w);
    else if (s.paso === 2) pintarPaso2(w);
    else pintarPaso3(w);
  }

  /* ---------- Paso 1 ---------- */
  async function pintarPaso1(w) {
    const s = w.s, rec = await listarRespaldos();
    if (w.s !== s || s.paso !== 1) return;
    w.bd.innerHTML = pasos(w) + `
      <div class="imp-drop" data-drop tabindex="0" role="button" aria-label="Elegir archivo">
        ${ic.up}
        <strong>Suelta aquí tu Excel o CSV</strong>
        <span>o <button type="button" class="btn pri" data-pick>Elegir archivo</button></span>
        <small>.xlsx · .xlsm · .csv · .tsv · .txt &nbsp;·&nbsp; Todo se procesa en tu navegador; nada se sube a ningún servidor.</small>
        <input type="file" data-file accept=".xlsx,.xlsm,.csv,.tsv,.txt" hidden>
      </div>
      <details class="imp-paste" ${s.pegado ? 'open' : ''}><summary>Pegar desde Excel</summary>
        <p>Copia un rango en Excel (Ctrl+C) y pégalo aquí. Funciona con tabuladores, punto y coma o coma.</p>
        <textarea data-paste rows="5" placeholder="Fecha&#9;Hora&#9;Lectura&#10;06/10/2026&#9;08:00&#9;124750"></textarea>
        <div class="imp-row"><button type="button" class="btn" data-usepaste>Usar texto pegado</button></div>
      </details>
      ${rec.length ? `<section class="imp-recent"><h4>Importaciones recientes</h4>${listaRespaldos(rec)}</section>` : ''}
      ${s.seccion && secciones[s.seccion] ? `<p class="imp-hint">Abierto desde <b>${esc(secciones[s.seccion])}</b>. Detecto el tipo de archivo automáticamente.</p>` : ''}`;
    w.ft.innerHTML = '<button type="button" class="btn" data-x>Cancelar</button>';
  }

  function listaRespaldos(rec) {
    return '<ul class="imp-list">' + rec.map((r) => `<li>
      <span class="imp-li-main"><b>${esc(ETIQ_TIPO(r.tipo))}</b> · ${esc(r.archivo || '')}<small>${esc(new Date(r.t).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }))} · ${esc(r.resumen || '')}</small></span>
      ${r.estado === 'deshecha' ? '<span class="imp-pill">Deshecha</span>' : `<button type="button" class="btn sm" data-undo="${esc(r.id)}">Deshacer</button>`}</li>`).join('') + '</ul>';
  }

  /* ---------- Carga ---------- */
  function progreso(w, texto, pct, bloquea) {
    w.s.cargando = { texto, pct, bloquea: !!bloquea };
    const b = w.bd.querySelector('.imp-prog');
    if (b) {
      b.querySelector('span').textContent = texto;
      const bar = b.querySelector('i'); bar.style.width = pct == null ? '100%' : Math.max(3, pct) + '%'; b.classList.toggle('ind', pct == null);
    }
  }

  async function cargarArchivo(w, file) {
    const s = w.s;
    const sec = s.seccion;
    Object.assign(s, nuevoEstado(sec), { paso: 2, archivo: file, nombre: file.name, tam: file.size });
    s.t0 = performance.now();
    s.cargando = { texto: 'Abriendo archivo…', pct: null, bloquea: true };
    pintar(w);
    try {
      const e = ext(file.name);
      if (!DATOS_EXT.includes(e)) {
        const doc = A.Documentos;
        throw Object.assign(new Error('«' + file.name + '» no es una hoja de cálculo ni un texto delimitado.'), { documento: !!doc });
      }
      if (e === 'xlsx' || e === 'xlsm') {
        if (!A.BDM || !A.BDM.leerLibro) throw new Error('El lector de Excel no está disponible.');
        progreso(w, 'Leyendo ' + fmtMB(file.size) + '…', null, true);
        await pausa();
        const buf = await file.arrayBuffer();
        s.buf = buf;
        try { s.libro = await abrirLibro(buf); } catch (er) {
          throw new Error(er && er.message === 'NAVEGADOR' ? 'Este navegador no puede abrir archivos .xlsx. Guarda la hoja como CSV e inténtalo de nuevo.' : 'No se pudo abrir el libro: ' + (er && er.message || er));
        }
        s.hojas = s.libro.hojas.slice();
        await detectar(w);
      } else {
        progreso(w, 'Leyendo texto…', null, true);
        const t = await leerTexto(file);
        s.texto = true;
        await prepararTexto(w, t, file.name.replace(/\.[^.]+$/, ''));
      }
    } catch (er) {
      s.error = er; s.cargando = null; pintar(w); return;
    }
    s.cargando = null;
    pintar(w);
  }

  async function usarPegado(w, texto) {
    const s = w.s;
    if (!String(texto).trim()) { A.U.toast('Pega primero el contenido copiado de Excel.'); return; }
    Object.assign(s, nuevoEstado(s.seccion), { paso: 2, nombre: 'Texto pegado', tam: texto.length, texto: true });
    s.t0 = performance.now(); s.cargando = { texto: 'Leyendo texto…', pct: null, bloquea: true }; pintar(w);
    try { await prepararTexto(w, texto, 'Pegado'); } catch (er) { s.error = er; }
    s.cargando = null; pintar(w);
  }

  async function prepararTexto(w, texto, nombre) {
    const s = w.s, h = hojaDeTexto(texto);
    if (!h.matriz.length) throw new Error('No encontré filas en el texto.');
    s.sep = h.sep; s.hojas = [nombre]; s.hojaMain = nombre;
    s.tipo = 'libre'; s.detectado = { tipo: 'libre', hoja: nombre };
    s.matriz = h.matriz;
    prepararLibre(w);
  }

  async function detectar(w) {
    const s = w.s;
    let det = detectaPorHojas(s.hojas);
    if (det.tipo === 'agua?') {
      const m = await s.libro.filas(det.hoja, { maxRow: 20, maxCol: 12 });
      det = esAgua(m) ? { tipo: 'agua', hoja: det.hoja } : { tipo: 'libre', hoja: s.hojas[0] };
    }
    if (det.tipo === 'libre') det.hoja = s.hojas.find((h) => !/version|revision|referencia|grafica/i.test(norm(h))) || s.hojas[0];
    s.detectado = det; s.tipo = det.tipo; s.hojaMain = det.hoja;
    await prepararTipo(w);
  }

  /** Lee lo necesario según el tipo elegido y calcula el plan. */
  async function prepararTipo(w) {
    const s = w.s;
    s.error = null; s.plan = null; s.entrante = null; s.cavas = null; s.libre = null; s.avisos = [];
    if (OPS.includes(s.tipo)) await prepararOps(w);
    else if (s.tipo === 'cavas') await prepararCavas(w);
    else await prepararLibreArchivo(w);
  }

  async function prepararOps(w) {
    const s = w.s, t = s.tipo, S = A.OperationSources;
    if (!s.libro) { s.tipo = 'libre'; return prepararLibre(w); }
    const main = MAIN[t];
    const mainReal = s.hojas.find((h) => norm(h) === norm(main));
    if (!mainReal) { s.error = new Error('No encontré la hoja «' + main + '» que necesita ' + ETIQ_TIPO(t) + '.'); return; }
    const entrante = {};
    for (let i = 0; i < s.hojas.length; i++) {
      const n = s.hojas[i];
      progreso(w, 'Leyendo hoja «' + n + '» (' + (i + 1) + ' de ' + s.hojas.length + ')…', (i / s.hojas.length) * 100, true);
      const bar = w.bd.querySelector('.imp-prog'); if (bar) bar.querySelector('span').textContent = 'Leyendo hoja «' + n + '» (' + (i + 1) + ' de ' + s.hojas.length + ')…';
      await pausa();
      const rows = await s.libro.filas(n, { maxCol: 100 });
      entrante[n] = aHoja(rows);
    }
    s.entrante = entrante; s.mainReal = mainReal;
    progreso(w, 'Comparando con lo que ya está cargado…', null, true); await pausa();
    const prefijo = S.defs[t].prefix;
    const ed = (A.S.config && A.S.config.aseoCellEdits) || {};
    const actual = S.raw(t);
    const comb = fusionarLibro(t, actual, entrante, prefijo, ed);
    const reem = contarReemplazo(t, actual, entrante, prefijo, ed);
    s.plan = { comb, reem };
    const hojaM = entrante[mainReal];
    s.resumen = resumen(t, entrante, mainReal);
    const enc = filaEncabezado(t, mainReal, hojaM.rows), lab = etiquetas(enc);
    s.lab = lab; s.enc = enc;
    const datos = hojaM.rows.filter((r) => r.row > (enc ? enc.row : 0) && tieneDatos(t, r.cells));
    s.avisos = validar(t, datos, lab, { repetidas: comb.total.repetidas });
    s.muestra = datos.slice(0, 8);
    s.cuentaCapturaDup = 0;
  }

  async function prepararCavas(w) {
    const s = w.s, E = A.ExcelCavas;
    if (!E || !E.read) { s.error = new Error('El módulo de control de cavas no está disponible.'); return; }
    let seg = 0;
    const timer = setInterval(() => { seg++; const b = w.bd.querySelector('.imp-prog span'); if (b) b.textContent = 'Leyendo inventario, fermentación, maduración y levaduras… ' + seg + ' s'; }, 1000);
    try {
      progreso(w, 'Leyendo inventario, fermentación, maduración y levaduras…', null, true);
      await pausa();
      const shim = { name: s.nombre, size: s.tam, arrayBuffer: async () => s.buf };
      const next = await E.read(shim);
      s.cavas = { next, counts: E.plan(next) };
      s.avisos = (next.warnings || []).length ? [{ nivel: 'info', texto: next.warnings.length + ' filas del Excel omitidas por identificación incompleta.', ejemplos: next.warnings.slice(0, 4) }] : [];
      const c = s.cavas.counts;
      if (c && Object.values(c).some((x) => x.conflicts)) s.avisos.push({ nivel: 'info', texto: 'Hay registros con entradas manuales de la plataforma: se conservan y no se sobrescriben.', ejemplos: [] });
    } catch (er) {
      s.cavas = null; s.error = er;
    } finally { clearInterval(timer); }
  }

  async function prepararLibreArchivo(w) {
    const s = w.s;
    if (!s.libro) return prepararLibre(w);
    const n = s.hojaMain;
    progreso(w, 'Leyendo hoja «' + n + '»…', null, true); await pausa();
    const rows = await s.libro.filas(n, { maxRow: 60000, maxCol: 150 });
    let max = 0; rows.forEach((r) => { if (r && r.length > max) max = r.length; });
    const matriz = []; for (let i = 0; i < rows.length; i++) { const r = rows[i] || []; const o = new Array(max); for (let j = 0; j < max; j++) o[j] = r[j] == null ? '' : r[j]; matriz.push(o); }
    s.matriz = matriz;
    prepararLibre(w);
  }

  /** Estado de «tabla libre»: encabezado, destino, mapeo. */
  function prepararLibre(w, conservar) {
    const s = w.s, m = s.matriz || [];
    s.ancho = m.reduce((a, r) => Math.max(a, r.length), 0);
    const L = s.libre = Object.assign({}, conservar || {});
    if (L.enc == null) L.enc = detectaEncabezado(m);
    const S = A.OperationSources;
    const etiq = (j) => { const v = (m[L.enc] || [])[j]; return v == null || v === '' ? 'Columna ' + (j + 1) : String(v).replace(/\s+/g, ' ').trim(); };
    L.nombres = Array.from({ length: s.ancho }, (_, j) => etiq(j));
    if (!L.destino) {
      if (OPS.includes(s.seccion)) L.destino = s.seccion;
      else {
        let best = null, bs = 0;
        for (const t of OPS) {
          const dest = destinosDe(t, MAIN[t]);
          const mp = sugiereMapeo(L.nombres, dest);
          const sc = mp.filter((x) => x >= 0).length;
          if (sc > bs) { bs = sc; best = t; }
        }
        L.destino = best && bs >= 2 ? best : '';
        L.sugerido = !!L.destino;
      }
    }
    if (L.destino && !L.hoja) L.hoja = MAIN[L.destino];
    if (L.destino && S) {
      const dest = destinosDe(L.destino, L.hoja);
      if (!L.mapa) L.mapa = sugiereMapeo(L.nombres, dest);
    } else L.mapa = L.mapa || L.nombres.map(() => -1);
    calcularLibre(w);
  }
  function destinosDe(tipo, hoja) {
    const S = A.OperationSources;
    try {
      return S.schema(tipo, hoja).cols.map((c) => (tipo === 'agua' && c.i === 30 && /^Columna \d+$/.test(c.label) ? { i: 30, label: 'Comentario' } : c)).filter((c) => !/^Columna \d+$/.test(c.label));
    } catch (e) { return []; }
  }

  /** Convierte la matriz según el mapeo y calcula contadores contra lo que ya existe. */
  function calcularLibre(w) {
    const s = w.s, L = s.libre, m = s.matriz || [];
    L.filas = []; L.plan = null; s.avisos = []; L.nuevas = null;
    if (!L.destino || !m.length) return;
    const S = A.OperationSources, t = L.destino;
    const sch = S.schema(t, L.hoja), colsDest = sch.cols;
    const mapeados = L.mapa.map((d, j) => [j, d]).filter(([, d]) => d >= 0);
    if (!mapeados.length) return;
    // los textos se tipifican por columna del origen (CSV / pegado); en Excel ya vienen tipados
    let datos = m.slice(L.enc + 1);
    let conv = datos;
    if (s.texto) conv = tipificar(m, L.enc + 1, s.ancho).rows.slice(L.enc + 1);
    const lab = {}; colsDest.forEach((c) => { lab[c.i] = c.label; });
    const filas = [];
    let erroresDescartados = 0, vacias = 0;
    conv.forEach((r, i) => {
      const cells = {};
      for (const [j, d] of mapeados) {
        let v = r[j];
        if (v == null || v === '') continue;
        if (typeof v === 'string') { v = v.trim(); if (!v) continue; if (ERR_RE.test(v)) { erroresDescartados++; continue; } }
        const etq = lab[d] || '';
        if (/fecha/i.test(etq) && typeof v === 'string') { const f = fechaTexto(v); if (f && f.v != null) v = f.v; }
        if (/^hora\b|\bhora$/i.test(etq) && typeof v === 'string') { const f = horaTexto(v); if (f != null) v = f; }
        if (typeof v === 'string' && !/fecha|hora|equipo|marca|operario|comentario|causa|estado|proceso|tanque/i.test(etq)) { const x = numeroTexto(v); if (x != null) v = x; }
        cells[d] = v;
      }
      if (Object.keys(cells).length) filas.push({ n: L.enc + 2 + i, row: null, cells }); else vacias++;
    });
    L.filas = filas; L.vacias = vacias;
    // claves y comparación con lo que ya existe
    const ed = (A.S.config && A.S.config.aseoCellEdits) || {};
    const enc = { row: 0, cells: Object.fromEntries(colsDest.map((c) => [c.i, c.label])) };
    const kNew = claves(t, L.hoja, filas.map((f, i) => ({ row: i + 1000, cells: f.cells })), enc, true);
    const existentes = S.records(t, L.hoja);
    const hdrEx = { row: sch.header, cells: Object.fromEntries(colsDest.map((c) => [c.i, c.label])) };
    const delExcel = existentes.filter((r) => r.origin !== 'Plataforma'), delaPlat = existentes.filter((r) => r.origin === 'Plataforma');
    const mapaEx = new Map(), mapaPl = new Map();
    const kExc = claves(t, L.hoja, delExcel.map((r) => ({ row: r.row, cells: r.cells })), hdrEx);
    if (kExc) kExc.forEach((k, i) => { if (k != null && !mapaEx.has(k)) mapaEx.set(k, delExcel[i]); });
    const kPl = claves(t, L.hoja, delaPlat.map((r, i) => ({ row: 100000 + i, cells: r.cells })), hdrEx, true);
    if (kPl) kPl.forEach((k, i) => { if (k != null && !mapaPl.has(k)) mapaPl.set(k, delaPlat[i]); });
    const c = { nuevas: 0, actualizadas: 0, iguales: 0, conflictos: 0, repetidas: 0 };
    const sets = new Set(), ops = [], porId = new Map(existentes.map((r) => [r.id, r]));
    const importadas = existentes.filter((r) => r.origin === 'Plataforma' && /^imp-/.test(r.id || ''));
    const modoReemp = s.modo === 'reemplazar';
    const idsBorrar = new Set(modoReemp ? importadas.filter((r) => r.source === L.hoja).map((r) => r.id) : []);
    let dup = 0;
    filas.forEach((f, i) => {
      const k = kNew ? kNew[i] : null;
      const id = 'imp-' + t + '-' + hash(L.hoja + '|' + (k != null ? k : JSON.stringify(f.cells)));
      if (sets.has(id)) { dup++; return; }
      sets.add(id);
      let ex = null;
      if (k != null) { ex = mapaPl.get(k) || null; if (!ex) { const x = mapaEx.get(k); if (x && tieneDatos(t, x.cells)) ex = x; } } // una casilla vacía de la plantilla del Excel no cuenta
      else ex = porId.get(id) || null;
      if (!ex || idsBorrar.has(ex.id)) { c.nuevas++; ops.push({ tipo: 'nueva', id, cells: f.cells }); return; }
      const sub = Object.fromEntries(Object.keys(f.cells).map((d) => [d, ex.cells[d]]).filter(([, v]) => v !== undefined));
      const igual = iguales(f.cells, sub) && Object.keys(sub).length === Object.keys(f.cells).length;
      if (igual) { c.iguales++; return; }
      if (ex.origin === 'Plataforma' && /^imp-/.test(ex.id || '')) { c.actualizadas++; ops.push({ tipo: 'act', id: ex.id, cells: Object.assign({}, ex.cells, f.cells) }); } else c.conflictos++;
    });
    L.plan = { c, ops, idsBorrar: [...idsBorrar], dup };
    const labs = lab;
    s.avisos = validar(t, filas, labs, { duplicadas: dup });
    if (erroresDescartados) s.avisos.push({ nivel: 'info', texto: erroresDescartados + ' celdas con error de Excel se dejaron vacías.', ejemplos: [] });
    const sinMapa = L.nombres.filter((_, j) => L.mapa[j] < 0 && m.slice(L.enc + 1).some((r) => r[j] != null && r[j] !== '')).length;
    if (sinMapa) s.avisos.push({ nivel: 'info', texto: sinMapa + ' columna' + (sinMapa > 1 ? 's' : '') + ' del archivo no se importa' + (sinMapa > 1 ? 'n' : '') + ' (sin columna destino).', ejemplos: [] });
    s.muestra = filas.slice(0, 8);
  }

  /* ---------- Paso 2 ---------- */
  const fmtCelda = (v, etq) => {
    if (v == null || v === '') return '';
    if (isNum(v)) {
      if (/fecha|inicio|fin\b/i.test(etq || '') && v >= 20000 && v < 80000) return v % 1 ? dmyHm(v) : dmy(v);
      if (/hora/i.test(etq || '') && v >= 0 && v < 1) return hm(v);
      return nf.format(Math.round(v * 1000) / 1000);
    }
    return String(v);
  };

  function selTipo(s) {
    const opts = ['agua', 'aseos', 'recuperacion', 'programa', 'cavas', 'libre'];
    return `<label class="imp-f"><span>Tipo de datos</span><select data-tipo>${opts.map((o) => `<option value="${o}" ${o === s.tipo ? 'selected' : ''}>${esc(ETIQ_TIPO(o))}${o === s.detectado.tipo && o !== 'libre' ? ' (detectado)' : ''}</option>`).join('')}</select></label>`;
  }

  function lineaDetecte(s) {
    const t = s.tipo;
    if (t === 'libre') {
      const n = s.matriz ? Math.max(0, s.matriz.length - ((s.libre && s.libre.enc) || 0) - 1) : 0;
      return `Detecté: <b>Tabla libre</b> · ${s.libro ? 'hoja ' + esc(s.hojaMain) + ' · ' : ''}${fmtN(n)} filas · ${fmtN(s.ancho)} columnas${s.sep ? ' · separador ' + nombreSep(s.sep) : ''}`;
    }
    if (t === 'cavas') {
      const c = s.cavas && s.cavas.next;
      if (!c) return 'Detecté: <b>Control de proceso de cavas</b> (libro completo)';
      return `Detecté: <b>Control de proceso de cavas</b> · ${fmtN(c.fermentations.length)} fermentaciones · ${fmtN(c.maturations.length)} maduraciones · ${fmtN(c.yeasts.length)} levaduras · ${fmtN(c.inventory.records.length)} tanques`;
    }
    const r = s.resumen;
    if (!r) return 'Detecté: <b>' + esc(ETIQ_TIPO(t)) + '</b>';
    const rango = r.desde != null ? ` · ${dmy(r.desde)} → ${dmy(r.hasta)}` : '';
    return `Detecté: <b>${esc(ETIQ_TIPO(t))}</b> · hoja ${esc(s.mainReal)} · ${fmtN(r.n)} ${esc(TIPOS[t].unidad)}${rango}${t === 'aseos' && r.hojas > 1 ? ` · ${r.hojas} hojas con datos` : ''}`;
  }

  function tarjetasConteo(c, extra) {
    const it = [['Nuevas', c.nuevas, 'pos'], ['Actualizadas', c.actualizadas, 'acc'], ['Iguales', c.iguales, 'mut'], ['Conflictos', c.conflictos, c.conflictos ? 'warn' : 'mut']];
    return `<div class="imp-counts">${it.map(([l, n, k]) => `<div class="imp-count ${k}"><b>${fmtN(n)}</b><span>${l}</span></div>`).join('')}</div>${extra || ''}`;
  }

  function pintarPaso2(w) {
    const s = w.s;
    let h = pasos(w);
    h += `<div class="imp-file">${ic.file}<span><b>${esc(s.nombre)}</b><small>${fmtMB(s.tam)}${s.hojas.length > 1 ? ' · ' + s.hojas.length + ' hojas' : ''}</small></span></div>`;
    if (s.cargando) {
      h += `<div class="imp-prog ${s.cargando.pct == null ? 'ind' : ''}"><span>${esc(s.cargando.texto)}</span><div><i style="width:${s.cargando.pct == null ? 100 : s.cargando.pct}%"></i></div></div>`;
      w.bd.innerHTML = h; w.ft.innerHTML = '<button type="button" class="btn" data-x disabled>Cancelar</button>';
      return;
    }
    if (s.error) {
      h += `<div class="imp-alert neg">${ic.warn}<div><b>No pude usar este archivo</b><p>${esc(s.error.message || String(s.error))}</p></div></div>`;
      if (s.error.documento) h += '<p class="imp-hint">Puedes adjuntarlo como documento a la sección en lugar de importar datos.</p>';
      w.bd.innerHTML = h;
      w.ft.innerHTML = `<button type="button" class="btn" data-back>Elegir otro archivo</button>${s.error.documento ? '<button type="button" class="btn pri" data-asdoc>Adjuntar como documento</button>' : ''}${s.libro && s.tipo !== 'libre' ? '<button type="button" class="btn" data-libre>Tratar como tabla libre</button>' : ''}`;
      return;
    }
    h += `<div class="imp-detect">${lineaDetecte(s)}</div>`;
    h += `<div class="imp-cfg">${selTipo(s)}${s.tipo === 'libre' && s.hojas.length > 1 ? `<label class="imp-f"><span>Hoja</span><select data-hoja>${s.hojas.map((x) => `<option ${x === s.hojaMain ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}</div>`;
    if (s.seccion && secciones[s.seccion] && s.tipo !== 'libre' && s.tipo !== 'cavas' && OPS.includes(s.seccion) && s.seccion !== s.tipo) h += `<div class="imp-alert">${ic.info}<div>Abriste esto desde <b>${esc(secciones[s.seccion])}</b>, pero el archivo es de <b>${esc(ETIQ_TIPO(s.tipo))}</b>. Se cargará donde corresponde.</div></div>`;
    let puede = false, etiquetaOk = 'Importar';
    if (OPS.includes(s.tipo) && s.plan) {
      const comb = s.modo === 'combinar';
      const c = comb ? s.plan.comb.total : s.plan.reem;
      h += `<div class="imp-modes" role="radiogroup" aria-label="Cómo aplicar">
        <label class="imp-mode ${comb ? 'on' : ''}"><input type="radio" name="imp-modo" value="combinar" ${comb ? 'checked' : ''}><span><b>Combinar <em>Recomendado</em></b>Agrega solo lo nuevo y actualiza lo que cambió. Lo que ya tienes y no viene en el archivo se conserva.</span></label>
        <label class="imp-mode ${!comb ? 'on' : ''}"><input type="radio" name="imp-modo" value="reemplazar" ${!comb ? 'checked' : ''}><span><b>Reemplazar fuente</b>Sustituye todas las hojas por las del archivo. Tus capturas hechas en la plataforma se conservan.</span></label></div>`;
      h += tarjetasConteo(c, !comb ? `<p class="imp-note">${s.plan.reem.perdidas ? `Dejarán de estar ${fmtN(s.plan.reem.perdidas)} filas con datos que hoy existen y no vienen en este archivo.` : 'No se pierde ninguna fila con datos.'}</p>` : this_hojasNota(s));
      puede = c.nuevas + c.actualizadas > 0 || !comb;
      etiquetaOk = comb ? 'Combinar e importar' : 'Reemplazar fuente';
    } else if (s.tipo === 'cavas' && s.cavas) {
      const L = { fermentations: 'Fermentación', maturations: 'Maduración', yeasts: 'Levaduras', specifications: 'Especificaciones' };
      h += `<table class="imp-tbl"><thead><tr><th>Apartado</th><th>Nuevos</th><th>Actualizados</th><th>Iguales</th><th>Conflictos</th></tr></thead><tbody>${Object.entries(s.cavas.counts).map(([k, c]) => `<tr><td>${L[k] || k}</td><td>${c.new}</td><td>${c.updated}</td><td>${c.same}</td><td>${c.conflicts}</td></tr>`).join('')}</tbody></table>`;
      h += `<p class="imp-note">El libro de control de cavas siempre se <b>combina por identidad del registro</b> (lote, FV o levadura). Los registros con entradas manuales de la plataforma, las muestras y los borradores se conservan.</p>`;
      const t = Object.values(s.cavas.counts).reduce((a, c) => a + c.new + c.updated, 0);
      puede = t > 0; etiquetaOk = 'Combinar e importar';
    } else if (s.tipo === 'libre' && s.libre) {
      const r = pintarLibre(w); h += r.html; puede = r.puede; etiquetaOk = r.ok;
    }
    if (s.avisos && s.avisos.length) h += avisosHTML(s.avisos);
    if (s.tipo !== 'cavas') h += previaHTML(s);
    s.puede = puede;
    w.bd.innerHTML = h;
    w.ft.innerHTML = `<button type="button" class="btn" data-back>Atrás</button><span class="imp-spacer"></span><button type="button" class="btn pri" data-apply ${puede ? '' : 'disabled'}>${esc(etiquetaOk)}</button>`;
    if (!puede && ((s.plan && !s.plan.comb.total.nuevas && !s.plan.comb.total.actualizadas && s.modo === 'combinar') || (s.cavas))) {
      const n = w.bd.querySelector('.imp-counts'); if (n) n.insertAdjacentHTML('afterend', '<p class="imp-note">No hay nada nuevo para combinar: el archivo coincide con lo que ya está cargado.</p>');
    }
  }
  function this_hojasNota(s) {
    const hs = s.plan.comb.hojas, rep = hs.filter((x) => x.modo === 'reemplazo').length, fus = hs.filter((x) => x.modo === 'fusion').length, nu = hs.filter((x) => x.modo === 'nueva').length;
    return `<p class="imp-note">${fus} hoja${fus === 1 ? '' : 's'} se fusiona${fus === 1 ? '' : 'n'} fila por fila (${esc(TIPOS[s.tipo].clave)})${rep ? `; ${rep} de referencia se actualiza${rep === 1 ? '' : 'n'} completa${rep === 1 ? '' : 's'}` : ''}${nu ? `; ${nu} hoja${nu === 1 ? '' : 's'} nueva${nu === 1 ? '' : 's'}` : ''}.</p>`;
  }

  function pintarLibre(w) {
    const s = w.s, L = s.libre, m = s.matriz || [];
    let h = '';
    const opsDest = OPS.map((t) => `<option value="${t}" ${L.destino === t ? 'selected' : ''}>${esc(ETIQ_TIPO(t))}</option>`).join('');
    const sinSoporte = s.seccion && !OPS.includes(s.seccion) && secciones[s.seccion] ? `<div class="imp-alert">${ic.info}<div>La sección <b>${esc(secciones[s.seccion])}</b> se alimenta del libro de control de cavas. Una tabla libre puede cargarse en Agua, Aseos, Recuperación o Programa.</div></div>` : '';
    h += sinSoporte;
    const hojasDest = L.destino ? Object.keys(A.OperationSources.raw(L.destino)) : [];
    h += `<div class="imp-cfg">
      <label class="imp-f"><span>Sección destino</span><select data-destino><option value="">Elige una sección…</option>${opsDest}</select></label>
      ${L.destino ? `<label class="imp-f"><span>Hoja destino</span><select data-hojadest>${hojasDest.map((x) => `<option ${x === L.hoja ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}
      <label class="imp-f imp-f-s"><span>Fila de encabezado</span><input type="number" min="1" max="${Math.max(1, m.length)}" value="${L.enc + 1}" data-enc></label></div>`;
    if (L.sugerido) h += `<p class="imp-note">Sugerí «${esc(ETIQ_TIPO(L.destino))}» por el parecido de los encabezados. Cámbialo si no es correcto.</p>`;
    if (!L.destino) return { html: h, puede: false, ok: 'Importar' };
    const dest = destinosDe(L.destino, L.hoja);
    const usados = new Set(L.mapa.filter((x) => x >= 0));
    h += `<div class="imp-map"><h4>Cómo se corresponden las columnas</h4><div class="imp-map-g">` + L.nombres.map((n, j) => {
      const mu = [1, 2, 3].map((k) => m[L.enc + k] && m[L.enc + k][j]).filter((x) => x != null && x !== '').map((x) => fmtCelda(x, n)).join(' · ');
      const sel = `<select data-map="${j}"><option value="-1">— No importar —</option>${dest.map((d) => `<option value="${d.i}" ${L.mapa[j] === d.i ? 'selected' : ''}>${esc(d.label)} (${letra(d.i)})${usados.has(d.i) && L.mapa[j] !== d.i ? ' · ya usada' : ''}</option>`).join('')}</select>`;
      return `<div class="imp-map-r ${L.mapa[j] >= 0 ? 'on' : ''}"><span class="imp-map-o"><b>${esc(n)}</b><small>${esc(mu).slice(0, 70)}</small></span><span class="imp-arrow">→</span>${sel}</div>`;
    }).join('') + '</div></div>';
    if (L.plan && L.filas.length) {
      const comb = s.modo === 'combinar';
      h += `<div class="imp-modes" role="radiogroup">
        <label class="imp-mode ${comb ? 'on' : ''}"><input type="radio" name="imp-modo" value="combinar" ${comb ? 'checked' : ''}><span><b>Combinar <em>Recomendado</em></b>Agrega las filas nuevas y actualiza las importadas antes; no toca el Excel original ni tus capturas manuales.</span></label>
        <label class="imp-mode ${!comb ? 'on' : ''}"><input type="radio" name="imp-modo" value="reemplazar" ${!comb ? 'checked' : ''}><span><b>Reemplazar importación previa</b>Quita lo que cargaste antes desde archivos en esta hoja y pone lo de este archivo.${L.plan.idsBorrar.length ? ' Se quitarían ' + fmtN(L.plan.idsBorrar.length) + ' filas importadas antes.' : ''}</span></label></div>`;
      h += tarjetasConteo(L.plan.c, '<p class="imp-note">Los conflictos son filas que ya existen en el Excel original o en una captura manual con valores distintos: se respetan y no se tocan.</p>');
      const ok = L.plan.c.nuevas + L.plan.c.actualizadas > 0 || (!comb && L.plan.idsBorrar.length > 0);
      return { html: h, puede: ok, ok: comb ? 'Combinar e importar' : 'Reemplazar importación' };
    }
    return { html: h + `<p class="imp-note">${L.mapa.some((x) => x >= 0) ? 'No hay filas con datos debajo de la fila de encabezado.' : 'Asigna al menos una columna de destino.'}</p>`, puede: false, ok: 'Importar' };
  }

  function avisosHTML(av) {
    const w = av.filter((a) => a.nivel === 'warn'), i = av.filter((a) => a.nivel !== 'warn');
    return `<section class="imp-avisos"><h4>Revisión de datos</h4>${[...w, ...i].map((a) => `<details class="imp-aviso ${a.nivel}"><summary>${a.nivel === 'warn' ? ic.warn : ic.info}<span>${esc(a.texto)}</span></summary>${a.ejemplos.length ? '<ul>' + a.ejemplos.map((e) => `<li>${esc(e)}</li>`).join('') + '</ul>' : ''}</details>`).join('')}</section>`;
  }
  function previaHTML(s) {
    const t = s.tipo;
    let cols = [], filas = [];
    if (OPS.includes(t)) {
      const keys = Object.keys(s.lab || {}).map(Number).filter((i) => !/^columna/i.test(s.lab[i])).slice(0, 9);
      cols = keys.map((i) => ({ i, l: s.lab[i] }));
      filas = (s.muestra || []).map((r) => cols.map((c) => fmtCelda(r.cells[c.i], c.l)));
    } else if (t === 'libre' && s.libre && s.matriz) {
      const L = s.libre;
      const idx = L.nombres.map((_, j) => j).slice(0, 9);
      cols = idx.map((j) => ({ i: j, l: L.nombres[j] }));
      filas = s.matriz.slice(L.enc + 1, L.enc + 9).map((r) => idx.map((j) => fmtCelda(r[j], L.nombres[j])));
    }
    if (!filas.length) return '';
    return `<section class="imp-prev"><h4>Vista previa <small>primeras ${filas.length} filas</small></h4><div class="imp-scroll"><table class="imp-tbl"><thead><tr>${cols.map((c) => `<th>${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${filas.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }

  /* ---------- Paso 3 ---------- */
  function pintarPaso3(w) {
    const r = w.s.resultado;
    w.bd.innerHTML = pasos(w) + `<div class="imp-done">${ic.ok}<div><b>${esc(r.titulo)}</b><p>${esc(r.detalle)}</p></div></div>
      ${r.items ? `<ul class="imp-sum">${r.items.map(([a, b]) => `<li><span>${esc(a)}</span><b>${esc(b)}</b></li>`).join('')}</ul>` : ''}
      <p class="imp-note">Guardé una copia previa de lo que había. Si algo no quedó como esperabas, puedes volver atrás ahora o más tarde desde «Importaciones recientes».</p>`;
    w.ft.innerHTML = `<button type="button" class="btn" data-recent>Importaciones recientes</button><span class="imp-spacer"></span><button type="button" class="btn" data-undo-now>Deshacer importación</button><button type="button" class="btn pri" data-x>Listo</button>`;
  }

  /* ---------- Aplicar ---------- */
  async function aplicar(w) {
    const s = w.s;
    if (!s.puede) return;
    if (A.Store && A.Store.canWrite === false) { A.U.toast('Estás en modo de solo lectura: no se puede importar.'); return; }
    const btn = w.ft.querySelector('[data-apply]');
    if (btn) { btn.disabled = true; btn.textContent = 'Aplicando…'; }
    s.cargando = { bloquea: true };
    const t0 = performance.now();
    try {
      let rec, titulo, detalle, items;
      const idRec = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (OPS.includes(s.tipo)) {
        const S = A.OperationSources, t = s.tipo;
        if (!S.setImport) throw new Error('Esta versión del programa no permite fusionar fuentes (falta setImport).');
        const comb = s.modo === 'combinar';
        const c = comb ? s.plan.comb.total : s.plan.reem;
        const antes = await fotoPrevia(t);
        await guardarRespaldo(rec = { id: idRec, t: Date.now(), tipo: t, archivo: s.nombre, modo: comb ? 'Combinar' : 'Reemplazar', resumen: comb ? `${c.nuevas} nuevas · ${c.actualizadas} actualizadas` : 'Fuente reemplazada', estado: 'activa', antes });
        await S.setImport(t, comb ? s.plan.comb.next : s.entrante);
        titulo = comb ? 'Datos combinados en ' + ETIQ_TIPO(t) : 'Fuente de ' + ETIQ_TIPO(t) + ' reemplazada';
        detalle = comb ? `${fmtN(c.nuevas)} filas nuevas y ${fmtN(c.actualizadas)} actualizadas; ${fmtN(c.iguales)} ya estaban igual.` : `Se sustituyeron todas las hojas por las de «${s.nombre}». Tus capturas de la plataforma se conservaron.`;
        items = [['Archivo', s.nombre], ['Nuevas', fmtN(c.nuevas)], ['Actualizadas', fmtN(c.actualizadas)], ['Iguales', fmtN(c.iguales)], ['Conflictos (se respetaron)', fmtN(c.conflictos)]];
      } else if (s.tipo === 'cavas') {
        const E = A.ExcelCavas;
        const antes = await fotoPrevia('cavas');
        const c = s.cavas.counts;
        await guardarRespaldo(rec = { id: idRec, t: Date.now(), tipo: 'cavas', archivo: s.nombre, modo: 'Combinar', resumen: Object.values(c).reduce((a, x) => a + x.new, 0) + ' nuevos · ' + Object.values(c).reduce((a, x) => a + x.updated, 0) + ' actualizados', estado: 'activa', antes });
        const current = E.data(), next = s.cavas.next, snapshot = clon(next);
        for (const k of ['fermentations', 'maturations', 'yeasts', 'specifications']) {
          const map = new Map(current[k].map((r) => [r.id, r]));
          for (const r of next[k]) { const old = map.get(r.id); if (!(old && old.manualUpdatedAt)) map.set(r.id, r); }
          snapshot[k] = [...map.values()];
        }
        await E.persist(snapshot);
        titulo = 'Libro de control de cavas incorporado';
        detalle = 'Se combinó por identidad de registro; las entradas manuales y borradores se conservaron.';
        items = [['Archivo', s.nombre], ...Object.entries({ fermentations: 'Fermentaciones', maturations: 'Maduraciones', yeasts: 'Levaduras', specifications: 'Especificaciones' }).map(([k, l]) => [l, `${c[k].new} nuevas · ${c[k].updated} actualizadas`])];
      } else {
        const L = s.libre, t = L.destino, S = A.OperationSources;
        const antes = await fotoPrevia(t, true);
        const c = L.plan.c;
        await guardarRespaldo(rec = { id: idRec, t: Date.now(), tipo: t, archivo: s.nombre, modo: s.modo === 'combinar' ? 'Tabla libre · combinar' : 'Tabla libre · reemplazar', resumen: `${c.nuevas} nuevas · ${c.actualizadas} actualizadas`, estado: 'activa', antes });
        const st = clon((A.S.config['opCaptures_' + t]) || { records: [] }); st.records = st.records || [];
        const borrar = new Set(L.plan.idsBorrar);
        if (borrar.size) st.records = st.records.filter((r) => !borrar.has(r.id));
        const porId = new Map(st.records.map((r, i) => [r.id, i]));
        const ahora = new Date().toISOString();
        for (const op of L.plan.ops) {
          if (op.tipo === 'act' && porId.has(op.id)) { st.records[porId.get(op.id)] = Object.assign({}, st.records[porId.get(op.id)], { cells: op.cells, savedAt: ahora }); } else st.records.push({ id: op.id, row: null, source: L.hoja, origin: 'Plataforma', savedAt: ahora, importedFrom: s.nombre, cells: op.cells });
        }
        const ok = await A.Store.set('config', 'opCaptures_' + t, st);
        if (!ok) throw new Error('No se pudo guardar. No se cambió nada.');
        titulo = 'Tabla cargada en ' + ETIQ_TIPO(t);
        detalle = `${fmtN(c.nuevas)} filas nuevas y ${fmtN(c.actualizadas)} actualizadas, guardadas como capturas de la plataforma en «${L.hoja}».`;
        items = [['Archivo', s.nombre], ['Nuevas', fmtN(c.nuevas)], ['Actualizadas', fmtN(c.actualizadas)], ['Iguales', fmtN(c.iguales)], ['Conflictos (se respetaron)', fmtN(c.conflictos)]];
      }
      try { A.DL.invalidate(); } catch (e) { /* sin capa */ }
      s.resultado = { titulo, detalle, items, id: rec.id };
      s.cargando = null; s.paso = 3;
      s.t1 = Math.round(performance.now() - t0);
      A.render(true);
      A.U.toast(titulo + '. Puedes deshacerlo desde «Importaciones recientes».');
      pintar(w);
    } catch (er) {
      s.cargando = null;
      A.U.toast('No se importó: ' + (er && er.message || er));
      const e = w.bd.querySelector('.imp-err'); if (e) e.remove();
      w.bd.insertAdjacentHTML('afterbegin', `<div class="imp-alert neg imp-err">${ic.warn}<div><b>No se aplicó</b><p>${esc(er && er.message || String(er))}</p></div></div>`);
      const b = w.ft.querySelector('[data-apply]'); if (b) { b.disabled = false; b.textContent = 'Reintentar'; }
    }
  }

  async function deshacer(id, w) {
    const rec = await leerRespaldo(id);
    if (!rec || !rec.antes) { A.U.toast('Esta importación ya no se puede deshacer.'); return false; }
    const ok = await A.UI.confirm('Deshacer importación', 'Se restaurará lo que había antes de importar «' + (rec.archivo || '') + '» en ' + ETIQ_TIPO(rec.tipo) + '. Los cambios hechos después en esos datos se perderán.', 'Deshacer');
    if (!ok) return false;
    try { await restaurar(rec); } catch (e) { A.U.toast('No se pudo deshacer: ' + (e && e.message || e)); return false; }
    A.U.toast('Importación deshecha. Todo volvió a como estaba.');
    if (w && w === wiz) { w.s = Object.assign(nuevoEstado(w.s.seccion), { paso: 1 }); pintar(w); }
    return true;
  }

  /* ---------- Eventos del asistente ---------- */
  function enlazar(w) {
    const d = w.d;
    const manejar = (f) => { if (f) cargarArchivo(w, f); };
    d.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-pick]')) { e.stopPropagation(); d.querySelector('[data-file]').click(); return; }
      const dz = t.closest('[data-drop]'); if (dz && !t.closest('button')) { d.querySelector('[data-file]').click(); return; }
      if (t.closest('[data-usepaste]')) { usarPegado(w, d.querySelector('[data-paste]').value); return; }
      if (t.closest('[data-back]')) { w.s = Object.assign(nuevoEstado(w.s.seccion), { paso: 1 }); pintar(w); return; }
      if (t.closest('[data-apply]')) { aplicar(w); return; }
      if (t.closest('[data-libre]')) { w.s.tipo = 'libre'; w.s.error = null; w.s.cargando = null; await prepararTipo(w); w.s.cargando = null; pintar(w); return; }
      if (t.closest('[data-asdoc]')) { const f = w.s.archivo; w.cerrar(); if (A.Documentos && f) A.Documentos.subir(w.s.seccion || (A.Seccion && A.Seccion.ruta()) || 'general', [f]); return; }
      const u = t.closest('[data-undo]'); if (u) { u.disabled = true; const ok = await deshacer(u.dataset.undo, w); if (!ok) u.disabled = false; else if (wiz === w) pintar(w); return; }
      if (t.closest('[data-undo-now]')) { const ok = await deshacer(w.s.resultado.id, w); if (ok) { w.s = Object.assign(nuevoEstado(w.s.seccion), { paso: 1 }); pintar(w); } return; }
      if (t.closest('[data-recent]')) { w.s = Object.assign(nuevoEstado(w.s.seccion), { paso: 1 }); pintar(w); return; }
    });
    d.addEventListener('change', async (e) => {
      const t = e.target, s = w.s;
      if (t.matches('[data-file]')) { manejar(t.files[0]); t.value = ''; return; }
      if (t.matches('[data-tipo]')) { s.tipo = t.value; s.cargando = { texto: 'Preparando…', pct: null, bloquea: true }; pintar(w); try { await prepararTipo(w); } catch (er) { s.error = er; } s.cargando = null; pintar(w); return; }
      if (t.matches('[data-hoja]')) { s.hojaMain = t.value; s.cargando = { texto: 'Leyendo hoja…', pct: null, bloquea: true }; pintar(w); try { await prepararLibreArchivo(w); } catch (er) { s.error = er; } s.cargando = null; pintar(w); return; }
      if (t.matches('input[name=imp-modo]')) { s.modo = t.value; if (s.tipo === 'libre') calcularLibre(w); pintar(w); return; }
      if (t.matches('[data-destino]')) { const L = s.libre; L.destino = t.value; L.hoja = t.value ? MAIN[t.value] : null; L.mapa = null; L.sugerido = false; prepararLibre(w, { enc: L.enc, destino: L.destino, hoja: L.hoja }); pintar(w); return; }
      if (t.matches('[data-hojadest]')) { const L = s.libre; L.hoja = t.value; L.mapa = null; prepararLibre(w, { enc: L.enc, destino: L.destino, hoja: L.hoja }); pintar(w); return; }
      if (t.matches('[data-enc]')) { const L = s.libre; const n = Math.max(1, Math.min(s.matriz.length, +t.value || 1)) - 1; prepararLibre(w, { enc: n, destino: L.destino, hoja: L.hoja }); pintar(w); return; }
      if (t.matches('[data-map]')) { const L = s.libre, j = +t.dataset.map, v = +t.value; if (v >= 0) L.mapa = L.mapa.map((x, k) => (k !== j && x === v ? -1 : x)); L.mapa[j] = v; calcularLibre(w); pintar(w); }
    });
    // arrastrar y soltar dentro del asistente
    const dz = () => d.querySelector('[data-drop]');
    d.addEventListener('dragover', (e) => { if (hayArchivos(e)) { e.preventDefault(); const z = dz(); if (z) z.classList.add('over'); } });
    d.addEventListener('dragleave', (e) => { const z = dz(); if (z && !d.contains(e.relatedTarget)) z.classList.remove('over'); });
    d.addEventListener('drop', (e) => { if (!hayArchivos(e)) return; e.preventDefault(); const z = dz(); if (z) z.classList.remove('over'); if (w.s.cargando && w.s.cargando.bloquea) return; manejar(e.dataTransfer.files[0]); });
    d.addEventListener('paste', (e) => {
      if (e.target.matches('[data-paste]')) return;
      const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0]; if (f) { manejar(f); return; }
      const tx = e.clipboardData && e.clipboardData.getData('text'); if (tx && w.s.paso === 1 && tx.indexOf('\n') > 0) usarPegado(w, tx);
    });
  }
  const hayArchivos = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');

  /* ======================================================================
     5. Superposición «Suelta el archivo aquí» y botones de sección
     ====================================================================== */
  const RUTAS = ['tanques', 'levaduras', 'bd', 'aseos', 'recuperacion', 'programa', 'merma', 'agua', 'analisis'];
  function enRutaSeccion() { const r = A.Seccion ? A.Seccion.ruta() : ''; return RUTAS.includes(r) ? r : null; }

  function iniciarArrastre() {
    let ov = null, n = 0;
    const crear = () => {
      ov = document.createElement('div');
      ov.className = 'imp-overlay';
      ov.innerHTML = `<div class="imp-ov-in"><div class="imp-ov-data" data-ov="datos">${ic.up}<b>Suelta el archivo aquí</b><span>Excel o CSV: lo reviso contigo antes de cargarlo</span></div><div class="imp-ov-doc" data-ov="doc"><b>Guardar como documento</b><span>PDF, imagen, Word… se adjunta a esta sección</span></div></div>`;
      document.body.appendChild(ov);
      ov.addEventListener('dragover', (e) => { e.preventDefault(); const z = e.target.closest('[data-ov]'); ov.querySelectorAll('[data-ov]').forEach((x) => x.classList.toggle('hot', x === z)); });
      ov.addEventListener('drop', (e) => {
        e.preventDefault(); const z = e.target.closest('[data-ov]'); const fs = [...e.dataTransfer.files]; ocultar();
        if (!fs.length) return;
        const sec = enRutaSeccion();
        const todosDatos = fs.length === 1 && DATOS_EXT.includes(ext(fs[0].name));
        if ((z && z.dataset.ov === 'doc') || !todosDatos) { if (A.Documentos) A.Documentos.subir(sec || 'general', fs); else abrir({ seccion: sec, archivo: fs[0] }); } else abrir({ seccion: sec, archivo: fs[0] });
      });
    };
    const mostrar = () => { if (!ov) crear(); ov.classList.add('on'); };
    const ocultar = () => { n = 0; if (ov) { ov.classList.remove('on'); ov.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot')); } };
    document.addEventListener('dragenter', (e) => {
      if (!hayArchivos(e) || !enRutaSeccion() || document.querySelector('dialog[open]')) return;
      if (e.target.closest && e.target.closest('[data-doc-drop]')) return;
      n++; mostrar();
    });
    document.addEventListener('dragleave', () => { if (n > 0 && --n === 0) ocultar(); });
    document.addEventListener('dragend', ocultar);
    document.addEventListener('drop', (e) => { if (ov && ov.classList.contains('on') && !e.target.closest('.imp-overlay')) { e.preventDefault(); ocultar(); } });
    window.addEventListener('blur', ocultar);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ocultar(); });
  }

  /* ---------- Plantilla ---------- */
  function plantilla(seccion) {
    const S = A.OperationSources, X = (A.V35 && A.V35.excel) || (A.Excel35 && A.Excel35.excel);
    const t = OPS.includes(seccion) ? seccion : null;
    if (!t) { A.U.toast('Para esta sección usa el libro de control de cavas completo.'); return; }
    if (!X) { A.U.toast('La descarga de Excel no está disponible aquí.'); return; }
    const hoja = MAIN[t];
    const cols = S.schema(t, hoja).cols.filter((c) => !/^Columna \d+$/.test(c.label) && c.i < 60);
    const tipoCol = (c) => (/fecha|hora/i.test(c.label) ? 's' : 'n');
    const uniq = (idx, lim = 80) => { const set = new Set(); for (const r of S.records(t, hoja)) { const v = r.cells[idx]; if (typeof v === 'string' && v.trim() && !/^#/.test(v) && set.size < lim) set.add(v.replace(/\s+/g, ' ').trim()); } return [...set].sort(); };
    const listas = [];
    const L = (nombre, vals) => { if (vals.length) listas.push([nombre, vals]); };
    const lab = (rx) => (cols.find((c) => rx.test(c.label)) || {}).i;
    if (t === 'agua') { L('Hora del turno', ['08:00', '16:00', '00:00']); }
    if (t === 'aseos') { L('Equipo', uniq(lab(/^equipo/i))); L('Estado de la solución', ['L', 'NL']); L('Cumple parámetros', ['SI', 'NO']); L('Operario', uniq(lab(/operario/i))); L('STL', uniq(lab(/^stl/i))); }
    if (t === 'recuperacion') { L('Marca', uniq(lab(/marca/i))); L('Destino SV', uniq(lab(/sv destino/i))); L('Operario', uniq(lab(/operario responsable$/i))); L('Sensorial', ['B', 'NB']); }
    if (t === 'programa') { L('Proceso', uniq(lab(/^proceso/i), 60)); L('Marca', uniq(lab(/^marca/i))); L('Causa de la desviación', uniq(lab(/causa/i))); }
    const maxL = Math.max(1, ...listas.map((l) => l[1].length));
    const hojas = [
      { nombre: 'Datos', titulo: ETIQ_TIPO(t), sub: 'Plantilla vacía de Cifra · una fila por registro · fechas como dd/mm/aaaa hh:mm · luego usa «Cargar archivo»', cols: cols.map((c) => ({ h: c.label, t: tipoCol(c) })), rows: [] },
      { nombre: 'Listas', titulo: 'Listas de apoyo', sub: 'Valores usados en la plataforma (copia el que corresponda)', cols: listas.map(([n]) => ({ h: n, t: 's' })), rows: Array.from({ length: maxL }, (_, i) => listas.map(([, v]) => v[i] == null ? null : v[i])) },
    ];
    if (!listas.length) hojas.pop();
    // la fila de encabezado queda en la fila 4 del Excel (título + subtítulo); el asistente la detecta sola
    X('Plantilla_' + ETIQ_TIPO(t).replace(/\s+/g, '_') + '.xlsx', hojas);
  }

  function botones(vista, ruta) {
    if (!RUTAS.includes(ruta) || !A.Seccion) return;
    // pantallas sin fila de acciones en la cabecera (levaduras, base de datos, merma): se crea una
    if (!vista.querySelector('.studio-actions, .acts, .page-h .acts')) {
      const ph = vista.querySelector('.page-h'), sh = vista.querySelector('.studio-heading');
      if (ph) { const d = document.createElement('div'); d.className = 'acts'; d.dataset.impActs = '1'; ph.appendChild(d); }
      else if (sh) { const d = document.createElement('div'); d.className = 'studio-actions'; d.dataset.impActs = '1'; sh.appendChild(d); }
    }
    const b = A.Seccion.boton(vista, 'imp-cargar', 'Cargar archivo', () => abrir({ seccion: ruta }), { primario: false });
    if (b) b.classList.add('imp-btn');
    if (OPS.includes(ruta)) { const p = A.Seccion.boton(vista, 'imp-plantilla', 'Descargar plantilla', () => plantilla(ruta)); if (p) p.classList.add('imp-btn'); }
  }
  if (A.Seccion) A.Seccion.registrar(RUTAS, botones);
  iniciarArrastre();

  Object.assign(A.Importador, { abrir, plantilla, respaldos: listarRespaldos, deshacer: (id) => deshacer(id), _wiz: () => wiz });
})();
