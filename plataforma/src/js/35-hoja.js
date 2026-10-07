/* ============================================================
   App.Hoja · grilla editable tipo Excel
   const h = App.Hoja.crear(contenedor, {columnas, filas, contexto, onCambio, onGuardar, soloLectura, clave, ...})
   Escribir es como en Excel (flechas, Enter, Tab, F2, Supr, copiar/pegar TSV, Ctrl+D, Ctrl+Z…), pero cada celda
   conoce su tipo: valida rango, ofrece listas, calcula fórmulas y muestra semáforo.
   Los valores se guardan tipados: número, 'YYYY-MM-DDTHH:MM', 'YYYY-MM-DD', 'HH:MM', 'SI'/'NO', texto.
   ============================================================ */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const A = root.App || (root.App = {});

  const RH = 32;      // alto de fila (px)
  const GUT = 44;     // ancho de la columna de numeración
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const blank = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

  /* ---------- Números ---------- */
  function parseNum(raw, entero) {
    if (typeof raw === 'number') return raw;
    let s = String(raw == null ? '' : raw).trim().replace(/[\s ]/g, '');
    if (!s) return null;
    s = s.replace(/[a-zA-Z°%³²µ/]+$/, '');
    if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
    const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
    if (dots && commas) {
      const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
      const th = dec === ',' ? '.' : ',';
      s = s.split(th).join('').replace(dec, '.');
    } else if (commas) {
      s = commas > 1 ? s.split(',').join('') : (entero && /^[-+]?\d{1,3},\d{3}$/.test(s) ? s.replace(',', '') : s.replace(',', '.'));
    } else if (dots > 1) s = s.split('.').join('');
    else if (dots === 1 && entero && /^[-+]?\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /* ---------- Fechas y horas ---------- */
  const partsOk = (y, m, d, hh, mi) => {
    if (hh > 23 || mi > 59 || m < 1 || m > 12 || d < 1) return null;
    const t = new Date(y, m - 1, d);
    if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) return null;
    return { y, m, d, hh, mi };
  };
  const fromSerial = (n) => {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 1440) * 60000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mi: d.getUTCMinutes() };
  };
  const fmtParts = (p, tipo) => {
    const D = p.y + '-' + pad(p.m) + '-' + pad(p.d), T = pad(p.hh) + ':' + pad(p.mi);
    return tipo === 'fecha' ? D : tipo === 'hora' ? T : D + 'T' + T;
  };
  function parseFecha(raw, tipo, ref) {
    ref = ref || new Date();
    if (raw == null || raw === '') return null;
    const today = () => ({ y: ref.getFullYear(), m: ref.getMonth() + 1, d: ref.getDate() });
    const off = (n) => { const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + n); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; };
    const num = typeof raw === 'number' ? raw : null;
    let s = norm(raw);
    if (num != null || /^\d+([.,]\d+)?$/.test(s)) {
      const n = num != null ? num : parseFloat(s.replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      if (tipo === 'hora') {
        if (n >= 0 && n < 1) { const m = Math.round(n * 1440); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
        if (/^\d{1,2}$/.test(s) && n < 24) return pad(n) + ':00';
        if (/^\d{3,4}$/.test(s)) { const p = partsOk(2000, 1, 1, Math.floor(n / 100), n % 100); return p ? fmtParts(p, 'hora') : null; }
        return null;
      }
      if (n > 20000 && n < 80000) return fmtParts(fromSerial(n), tipo);
      if (tipo === 'fechahora' && /^\d{3,4}$/.test(s)) { const t = today(), p = partsOk(t.y, t.m, t.d, Math.floor(n / 100), n % 100); return p ? fmtParts(p, tipo) : null; }
      return null;
    }
    s = s.replace(/(\d)t(\d)/, '$1 $2').replace(/\b(a las|a la|de la|el|del)\b/g, ' ').replace(/,/g, ' ');
    let date = null, time = null, ampm = null, m;
    for (const t of s.split(/\s+/).filter(Boolean)) {
      if (t === 'hoy') date = today();
      else if (t === 'ahora') { date = today(); time = [ref.getHours(), ref.getMinutes()]; }
      else if (t === 'ayer') date = off(-1);
      else if (t === 'anteayer') date = off(-2);
      else if (t === 'manana') date = off(1);
      else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) date = { y: +m[1], m: +m[2], d: +m[3] };
      else if ((m = t.match(/^(\d{1,2})([\/-])(\d{1,2})(?:\2(\d{2,4}))?$/))) date = { y: m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : ref.getFullYear(), m: +m[3], d: +m[1] };
      else if ((m = t.match(/^(\d{1,2})[:h](\d{2})(?::\d{2})?(am|pm|a\.?m\.?|p\.?m\.?)?$/))) { time = [+m[1], +m[2]]; if (m[3]) ampm = m[3][0]; }
      else if ((m = t.match(/^(\d{1,2})\.(\d{2})(?:\.(\d{2,4}))?$/))) {
        if (m[3] || (!date && tipo !== 'hora' && !time && +m[2] <= 12)) date = { y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : ref.getFullYear(), m: +m[2], d: +m[1] };
        else time = [+m[1], +m[2]];
      } else if ((m = t.match(/^(\d{1,2})(am|pm)$/))) { time = [+m[1], 0]; ampm = m[2][0]; }
      else if (/^(am|pm|a\.?m\.?|p\.?m\.?)$/.test(t)) ampm = t[0];
      else if (/^\d{3,4}$/.test(t) && !time && tipo !== 'fecha') time = [Math.floor(+t / 100), +t % 100];
      else return null;
    }
    if (time && ampm) { if (ampm === 'p' && time[0] < 12) time[0] += 12; if (ampm === 'a' && time[0] === 12) time[0] = 0; }
    if (tipo === 'hora') { if (!time) return null; const p = partsOk(2000, 1, 1, time[0], time[1]); return p ? fmtParts(p, 'hora') : null; }
    if (tipo === 'fecha') { if (!date) return null; const p = partsOk(date.y, date.m, date.d, 0, 0); return p ? fmtParts(p, 'fecha') : null; }
    if (!date && !time) return null;
    if (!date) date = today();
    const p = partsOk(date.y, date.m, date.d, time ? time[0] : 0, time ? time[1] : 0);
    return p ? fmtParts(p, 'fechahora') : null;
  }
  function ahora(tipo) {
    const d = new Date();
    return fmtParts({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mi: d.getMinutes() }, tipo || 'fechahora');
  }
  const RX = { fechahora: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, fecha: /^\d{4}-\d{2}-\d{2}$/, hora: /^\d{2}:\d{2}$/ };
  function fmtFecha(v, tipo) {
    if (blank(v)) return '';
    const s = String(v);
    if (!RX[tipo] || !RX[tipo].test(s)) return s;
    if (tipo === 'hora') return s;
    const d = s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(2, 4);
    return tipo === 'fecha' ? d : d + ' ' + s.slice(11, 16);
  }
  /** milisegundos de un valor fecha/fechahora normalizado (hora local), o null */
  const msDe = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v)) ? +new Date(v.length === 10 ? v + 'T00:00' : v) : null;
  const toIso = (ms) => { const d = new Date(ms); return fmtParts({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mi: d.getMinutes() }, 'fechahora'); };

  /* ---------- Portapapeles (TSV) ---------- */
  function parseTSV(text) {
    const t = String(text).replace(/\r\n?/g, '\n');
    const out = []; let row = [], cell = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"' && cell === '') q = true;
      else if (ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell); out.push(row);
    if (out.length > 1) { const l = out[out.length - 1]; if (l.length === 1 && l[0] === '') out.pop(); }
    return out;
  }
  const toTSV = (m) => m.map((r) => r.map((c) => (/[\t\n"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join('\t')).join('\n');

  const TIPOS_FECHA = ['fecha', 'hora', 'fechahora'];
  const ANCHO = { texto: 150, numero: 96, fechahora: 138, fecha: 104, hora: 84, lista: 130, sino: 84, calc: 100 };
  let UID = 0;

  /* ============================================================
     Componente
     ============================================================ */
  function crear(contenedor, opciones) {
    const opts = Object.assign({ columnas: [], filas: [], gruposPlegables: [], gruposPlegados: [] }, opciones || {});
    const uid = 'hoja' + (++UID);
    let ro = !!opts.soloLectura;
    const cols = opts.columnas.map((c) => {
      const col = Object.assign({ tipo: 'texto', grupo: '' }, c);
      if (col.tipo === 'sino') col.opciones = [{ v: 'SI', t: 'SÍ' }, { v: 'NO', t: 'NO' }];
      col.ancho = col.ancho || ANCHO[col.tipo] || 110;
      col.base = col.tipo === 'calc' ? (col.formato || 'numero') : col.tipo;
      if (col.base === 'sino') col.base = 'lista';
      return col;
    });
    const colIdx = Object.fromEntries(cols.map((c, i) => [c.key, i]));
    const calcCols = cols.filter((c) => c.tipo === 'calc' && typeof c.calc === 'function');
    const plegados = new Set(opts.gruposPlegados || []);
    const plegables = new Set(opts.gruposPlegables || []);
    let rows = [];
    let act = { r: 0, c: 0 }, ext = { r: 0, c: 0 };
    let ed = null;                 // edición activa
    let pop = null;                // lista desplegable
    let selecting = false;
    let saving = false, draftTimer = null, destroyed = false;
    const undoS = [], redoS = []; let tx = null;
    const rowEls = new Map();
    const nfCache = new Map();
    const getCtx = () => (typeof opts.contexto === 'function' ? opts.contexto() : opts.contexto) || {};

    /* ---------- DOM ---------- */
    const el = document.createElement('div');
    el.className = 'hoja' + (opts.clase ? ' ' + opts.clase : '');
    el.innerHTML = `
      <div class="hoja-bar" role="toolbar" aria-label="Herramientas de la hoja">
        <button type="button" class="hoja-btn" data-a="nueva" title="Agregar fila (Ctrl+Enter)">＋ Fila</button>
        <button type="button" class="hoja-btn" data-a="dup" title="Duplicar la fila seleccionada">Duplicar</button>
        <button type="button" class="hoja-btn" data-a="del" title="Eliminar la fila seleccionada (Ctrl+-)">Eliminar</button>
        <span class="hoja-sep"></span>
        <button type="button" class="hoja-btn hoja-btn--ico" data-a="undo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer">↶</button>
        <button type="button" class="hoja-btn hoja-btn--ico" data-a="redo" title="Rehacer (Ctrl+Y)" aria-label="Rehacer">↷</button>
        <button type="button" class="hoja-btn hoja-btn--ico" data-a="help" title="Atajos de teclado" aria-label="Atajos de teclado">?</button>
        <span class="hoja-bar-fill"></span>
        <span class="hoja-estado" role="status" aria-live="polite"></span>
        ${opts.onGuardar ? '<button type="button" class="hoja-btn hoja-btn--pri" data-a="save" title="Guardar filas completas y válidas (Ctrl+S)"></button>' : ''}
      </div>
      <div class="hoja-aviso" hidden><span></span><button type="button" class="hoja-btn hoja-btn--sm" data-a="descartar">Descartar borrador</button></div>
      <div class="hoja-vp" tabindex="0" role="grid" aria-colcount="${cols.length + 1}" aria-multiselectable="true">
        <div class="hoja-cab"></div>
        <div class="hoja-cuerpo"></div>
      </div>
      <div class="hoja-pie"><span class="hoja-pie-msg" aria-live="polite"></span><span class="hoja-pie-ayuda"></span></div>`;
    contenedor.appendChild(el);
    const vp = el.querySelector('.hoja-vp'), cab = el.querySelector('.hoja-cab'), body = el.querySelector('.hoja-cuerpo');
    const bar = el.querySelector('.hoja-bar'), estado = el.querySelector('.hoja-estado'), aviso = el.querySelector('.hoja-aviso');
    const pieMsg = el.querySelector('.hoja-pie-msg'), pieAyuda = el.querySelector('.hoja-pie-ayuda');
    vp.setAttribute('aria-label', opts.titulo || 'Hoja de captura');
    if (opts.alto) vp.style.height = typeof opts.alto === 'number' ? opts.alto + 'px' : opts.alto;
    const btn = (a) => bar.querySelector('[data-a="' + a + '"]');

    /* ---------- Filas ---------- */
    function mkRow(vals) {
      const r = { id: null, nuevo: true, sucio: false, tocada: false, d: {}, ov: {}, c: {}, v: {}, st: null };
      if (vals) for (const [k, v] of Object.entries(vals)) {
        if (k === 'id' || k === '_id') r.id = v;
        else if (k in colIdx) { if (cols[colIdx[k]].tipo === 'calc') { if (cols[colIdx[k]].anulable && v != null) r.ov[k] = v; } else r.d[k] = v; }
      }
      if (r.id != null) r.nuevo = false;
      return r;
    }
    const vacia = (r) => !r.id && !r.tocada;
    function evalRow(i) {
      const row = rows[i], v = Object.assign({}, row.d), ctx = getCtx();
      row.c = {};
      for (const col of calcCols) {
        let x = null;
        try { x = col.calc(v, ctx, { i, prev: i > 0 ? rows[i - 1].v : null, filas: () => rows.map((r) => r.v) }); } catch (e) { x = null; }
        if (typeof x === 'number' && !Number.isFinite(x)) x = null;
        row.c[col.key] = x;
        v[col.key] = col.anulable && row.ov[col.key] != null ? row.ov[col.key] : x;
      }
      row.v = v; row.st = null;
    }
    function recalc(desde) {
      if (opts.cadena || desde == null) {
        rows.forEach((r) => { r.v = Object.assign({}, r.d); });   // entradas al día para fórmulas que miran otras filas
        for (let i = 0; i < rows.length; i++) evalRow(i);
      } else evalRow(Math.min(desde, rows.length - 1));
    }
    function defectos() {
      if (typeof opts.nuevaFila !== 'function') return;
      for (let i = 0; i < rows.length; i++) {
        if (!vacia(rows[i])) continue;
        let def = null;
        try { def = opts.nuevaFila(rows.slice(0, i).filter((r) => !vacia(r)).map((r) => r.v), getCtx(), i); } catch (e) { def = null; }
        rows[i].d = {};
        if (def) for (const [k, v] of Object.entries(def)) if (k in colIdx && cols[colIdx[k]].tipo !== 'calc') rows[i].d[k] = v;
        evalRow(i);
      }
    }
    function asegurarFinal() {
      let ch = false;
      if (!rows.length || !vacia(rows[rows.length - 1])) { rows.push(mkRow()); ch = true; }
      // como mucho una fila vacía al final
      while (rows.length > 1 && vacia(rows[rows.length - 1]) && vacia(rows[rows.length - 2]) && !tx) { rows.pop(); ch = true; }
      defectos();
      return ch;
    }

    /* ---------- Valores y formato ---------- */
    const valorDe = (row, col) => (col.tipo === 'calc' ? (col.anulable && row.ov[col.key] != null ? row.ov[col.key] : row.c[col.key]) : row.d[col.key]);
    function opcionesDe(col, row) {
      let o = col.opciones;
      if (typeof o === 'function') { try { o = o(getCtx(), row ? row.v : null); } catch (e) { o = []; } }
      return (o || []).map((x) => (typeof x === 'object' && x ? x : { v: String(x), t: String(x) }));
    }
    function nf(col) {
      let f = nfCache.get(col.key);
      if (!f) {
        const d = col.decimales;
        f = new Intl.NumberFormat('es-CO', { minimumFractionDigits: d != null ? d : 0, maximumFractionDigits: d != null ? d : 2 });
        nfCache.set(col.key, f);
      }
      return f;
    }
    function texto(row, col) {
      const v = valorDe(row, col);
      if (blank(v)) return '';
      const b = col.base;
      if (b === 'numero') {
        if (!isNum(v)) return String(v);
        if (col.porcentaje) return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v * 100) + ' %';
        return nf(col).format(v);
      }
      if (TIPOS_FECHA.includes(b)) return fmtFecha(v, b);
      if (b === 'lista') { const o = opcionesDe(col, row).find((x) => x.v === v); return o ? o.t : String(v); }
      return String(v);
    }
    function textoEdicion(row, col) {
      const v = valorDe(row, col);
      if (blank(v)) return '';
      if (col.base === 'numero') return isNum(v) ? String(v).replace('.', ',') : String(v);
      if (TIPOS_FECHA.includes(col.base)) return fmtFecha(v, col.base);
      if (col.base === 'lista') { const o = opcionesDe(col, row).find((x) => x.v === v); return o ? o.t : String(v); }
      return String(v);
    }
    function resolver(col, row, txt, exacto) {
      const n = norm(txt); if (!n) return null;
      const os = opcionesDe(col, row);
      const hit = os.find((o) => norm(o.t) === n || norm(o.v) === n);
      if (hit || (exacto && col.libre)) return hit || null;
      const pre = os.filter((o) => norm(o.t).startsWith(n));
      if (pre.length) return pre[0];
      const con = os.filter((o) => norm(o.t).includes(n));
      return con.length === 1 ? con[0] : null;
    }
    /** interpreta lo escrito según el tipo de la columna. modo: 'enter' (rechaza), 'suave' (conserva texto marcado) */
    function interpretar(col, row, txt, modo) {
      txt = txt == null ? '' : String(txt).trim();
      if (!txt) return { ok: true, val: null };
      const b = col.base;
      if (b === 'numero') {
        const n = parseNum(txt, col.decimales === 0);
        if (n == null || Number.isNaN(n)) return modo === 'enter' ? { ok: false, msg: 'No es un número. Ejemplo: 12,5' } : { ok: true, val: txt };
        if (col.decimales == null) return { ok: true, val: n };
        const pw = Math.pow(10, col.decimales);
        return { ok: true, val: (Math.sign(n) * Math.round(Math.abs(n) * pw + 1e-9)) / pw };
      }
      if (TIPOS_FECHA.includes(b)) {
        const s = parseFecha(txt, b);
        if (!s) return modo === 'enter' ? { ok: false, msg: 'No entendí la ' + (b === 'hora' ? 'hora' : 'fecha') + '. Prueba: ' + (b === 'hora' ? '14:30' : 'hoy 14:30, 7/10 08:00, 2026-10-07') } : { ok: true, val: txt };
        return { ok: true, val: s };
      }
      if (b === 'lista') {
        const o = resolver(col, row, txt, modo !== 'enter');
        if (o) return { ok: true, val: o.v };
        if (col.libre) return modo === 'enter' ? { ok: false, nuevo: true, val: txt } : { ok: true, val: txt };
        return modo === 'enter' ? { ok: false, msg: '«' + txt + '» no está en la lista' } : { ok: true, val: txt };
      }
      return { ok: true, val: txt };
    }

    /* ---------- Validación ---------- */
    function celdaEstado(row, col) {
      const v = valorDe(row, col), req = typeof col.requerido === 'function' ? col.requerido(row.v, getCtx()) : col.requerido;
      if (blank(v)) {
        if (req && (row.tocada || row.id)) return { t: 'falta', msg: 'Falta ' + col.titulo.toLowerCase() };
        return null;
      }
      const b = col.base;
      if (col.tipo === 'calc' && typeof v === 'string' && !col.anulable) { /* una fórmula puede devolver un texto de estado */ }
      else if (b === 'numero') {
        if (!isNum(v)) return { t: 'err', msg: 'No es un número' };
        if (col.min != null && v < col.min) return { t: 'err', msg: 'Fuera de rango: mínimo ' + col.min + (col.unidad ? ' ' + col.unidad : '') };
        if (col.max != null && v > col.max) return { t: 'err', msg: 'Fuera de rango: máximo ' + col.max + (col.unidad ? ' ' + col.unidad : '') };
      } else if (TIPOS_FECHA.includes(b)) {
        if (!RX[b].test(String(v))) return { t: 'err', msg: 'Fecha u hora no reconocida' };
      } else if (b === 'lista' && !col.libre) {
        if (!opcionesDe(col, row).some((o) => o.v === v)) return { t: 'err', msg: '«' + v + '» no está en la lista' };
      }
      if (typeof col.validar === 'function') {
        let m = null; try { m = col.validar(v, row.v, getCtx()); } catch (e) { m = null; }
        if (m) return { t: 'err', msg: m };
      }
      return null;
    }
    function filaEstado(row) {
      if (row.st) return row.st;
      const errs = [];
      if (!vacia(row)) cols.forEach((col, c) => { const e = celdaEstado(row, col); if (e) errs.push(Object.assign({ c }, e)); });
      row.st = { errs, falta: errs.filter((e) => e.t === 'falta').length, err: errs.filter((e) => e.t === 'err').length };
      return row.st;
    }
    function semaforoDe(row, col) {
      if (typeof col.semaforo !== 'function') return null;
      const v = valorDe(row, col);
      if (blank(v)) return null;
      try { const s = col.semaforo(v, row.v, getCtx()); return Array.isArray(s) ? { n: s[0], msg: s[1] } : s ? { n: s, msg: '' } : null; } catch (e) { return null; }
    }
    const pub = (row, i) => Object.assign({}, row.v, { id: row.id, indice: i, _nuevo: row.nuevo, _sucio: row.sucio });
    function validar() {
      const errores = [], listas = [], incompletas = [];
      let n = 0;
      rows.forEach((row, i) => {
        if (vacia(row)) return;
        n++;
        const st = filaEstado(row);
        st.errs.forEach((e) => errores.push({ fila: i, indice: i, columna: cols[e.c].key, tipo: e.t, mensaje: e.msg }));
        if (st.falta) incompletas.push(i);
        if (!st.errs.length && row.sucio) listas.push(i);
      });
      return { ok: !errores.length, errores, listas, incompletas, filas: n, sinGuardar: rows.filter((r) => !vacia(r) && r.sucio).length };
    }

    /* ---------- Undo / redo ---------- */
    const snap = (row) => ({ d: Object.assign({}, row.d), ov: Object.assign({}, row.ov), tocada: row.tocada, sucio: row.sucio });
    const restore = (row, s) => { row.d = Object.assign({}, s.d); row.ov = Object.assign({}, s.ov); row.tocada = s.tocada; row.sucio = s.sucio; row.st = null; };
    function begin() { if (!tx) tx = { ops: [], seen: new Map() }; return tx; }
    function touchRow(row) { begin(); if (!tx.seen.has(row)) { const s = snap(row); tx.seen.set(row, s); tx.ops.push({ k: 'row', row, before: s }); } }
    function end() {
      if (!tx) return;
      const t = tx; tx = null;
      if (!t.ops.length) return;
      t.ops.forEach((o) => { if (o.k === 'row') o.after = snap(o.row); });
      undoS.push(t); if (undoS.length > 200) undoS.shift();
      redoS.length = 0;
    }
    function aplicarOps(t, deshacer) {
      const ops = deshacer ? [...t.ops].reverse() : t.ops;
      for (const o of ops) {
        if (o.k === 'row') restore(o.row, deshacer ? o.before : o.after);
        else if (o.k === 'ins') { if (deshacer) { const i = rows.indexOf(o.row); if (i >= 0) rows.splice(i, 1); } else rows.splice(o.idx, 0, o.row); }
        else if (o.k === 'del') { if (deshacer) rows.splice(o.idx, 0, o.row); else { const i = rows.indexOf(o.row); if (i >= 0) rows.splice(i, 1); } }
      }
    }
    function deshacer() {
      commitEdit(); end();
      const t = undoS.pop(); if (!t) { msg('No hay nada que deshacer'); return; }
      aplicarOps(t, true); redoS.push(t); trasCambio(null, true);
      msg('Cambio deshecho');
    }
    function rehacer() {
      commitEdit(); end();
      const t = redoS.pop(); if (!t) { msg('No hay nada que rehacer'); return; }
      aplicarOps(t, false); undoS.push(t); trasCambio(null, true);
      msg('Cambio rehecho');
    }

    /* ---------- Escritura de celdas ---------- */
    function ponerValor(row, col, val) {
      touchRow(row);
      if (col.tipo === 'calc') { if (val == null) delete row.ov[col.key]; else row.ov[col.key] = val; }
      else row.d[col.key] = val;
      row.tocada = true; row.sucio = true; row.st = null;
    }
    const editable = (r, c) => {
      if (ro || r < 0 || r >= rows.length) return false;
      const col = cols[c];
      if (!col || col.soloLectura) return false;
      if (col.tipo === 'calc' && !col.anulable) return false;
      if (typeof opts.filaBloqueada === 'function' && rows[r].id && opts.filaBloqueada(rows[r].v, rows[r])) return false;
      return true;
    };
    function trasCambio(idxs, todo, cambios) {
      if (todo || !idxs) recalc(null);
      else if (opts.cadena) recalc(null);
      else [...new Set(idxs)].forEach((i) => { if (rows[i]) evalRow(i); });
      asegurarFinal();
      if (act.r >= rows.length) act.r = rows.length - 1;
      if (ext.r >= rows.length) ext.r = rows.length - 1;
      body.style.height = rows.length * RH + 'px';
      renderWin(true);
      resumen(); borrador();
      if (cambios && cambios.length && typeof opts.onCambio === 'function') {
        try { opts.onCambio({ cambios, filas: [...new Set(cambios.map((x) => x.indice))].map((i) => pub(rows[i], i)) }, api); } catch (e) { if (root.console) console.error(e); }
      }
    }
    function escribir(celdas, modo) {
      // celdas: [{r,c,val}]
      const cambios = [];
      begin();
      for (const x of celdas) {
        const row = rows[x.r], col = cols[x.c];
        if (!row || !col) continue;
        ponerValor(row, col, x.val);
        cambios.push({ indice: x.r, columna: col.key, valor: x.val });
      }
      end();
      trasCambio(cambios.map((x) => x.indice), false, cambios);
    }

    /* ---------- Columnas visibles y geometría ---------- */
    let colX = [], colW = [], totalW = 0, stubs = new Map();
    const grupoOf = (c) => cols[c].grupo || '';
    const oculta = (c) => { const g = grupoOf(c); return g && plegados.has(g); };
    function geometria() {
      let x = GUT; colX = []; colW = []; stubs = new Map();
      cols.forEach((col, c) => {
        colX[c] = x;
        if (oculta(c)) {
          const g = grupoOf(c), first = cols.findIndex((k) => k.grupo === g);
          if (first === c) { colW[c] = 132; stubs.set(c, g); } else colW[c] = 0;
        } else colW[c] = col.ancho;
        x += colW[c];
      });
      totalW = x;
    }
    function cabeceraHTML() {
      geometria();
      let g1 = '', g2 = '';
      const hayGrupos = cols.some((c) => c.grupo);
      if (hayGrupos) {
        let i = 0;
        g1 += `<div class="hoja-h hoja-h--g hoja-h--corner" role="columnheader" style="width:${GUT}px"></div>`;
        while (i < cols.length) {
          const g = cols[i].grupo || ''; let j = i, w = 0;
          while (j < cols.length && (cols[j].grupo || '') === g) { w += colW[j]; j++; }
          const pleg = g && plegables.has(g), cerrado = g && plegados.has(g);
          g1 += `<div class="hoja-h hoja-h--g${g ? '' : ' hoja-h--vacio'}" role="columnheader" aria-colspan="${j - i}" style="width:${w}px">${pleg ? `<button type="button" class="hoja-gtog" data-g="${esc(g)}" aria-expanded="${!cerrado}" title="${cerrado ? 'Mostrar' : 'Ocultar'} ${esc(g)}">${cerrado ? '▸' : '▾'} ${esc(g)}</button>` : esc(g)}</div>`;
          i = j;
        }
      }
      g2 += `<div class="hoja-h hoja-h--corner hoja-h--c" role="columnheader" style="width:${GUT}px">#</div>`;
      cols.forEach((col, c) => {
        if (!colW[c]) return;
        if (stubs.has(c)) { g2 += `<div class="hoja-h hoja-h--c hoja-h--stub" role="columnheader" style="width:${colW[c]}px">…</div>`; return; }
        g2 += `<div class="hoja-h hoja-h--c${c === 0 ? ' hoja-h--f1' : ''}${col.requerido ? ' hoja-h--req' : ''}" role="columnheader" aria-colindex="${c + 2}" data-c="${c}" style="width:${colW[c]}px" title="${esc(col.ayuda || col.titulo)}"><span class="hoja-h-t">${esc(col.titulo)}</span>${col.unidad ? `<small>${esc(col.unidad)}</small>` : ''}${col.tipo === 'calc' ? '<i class="hoja-h-fx" aria-label="calculado">ƒ</i>' : ''}</div>`;
      });
      cab.style.width = totalW + 'px'; body.style.width = totalW + 'px';
      cab.innerHTML = (hayGrupos ? `<div class="hoja-hr hoja-hr--g" role="row">${g1}</div>` : '') + `<div class="hoja-hr" role="row">${g2}</div>`;
    }

    /* ---------- Pintado de filas ---------- */
    const cellId = (r, c) => uid + '-' + r + '-' + c;
    function celdaHTML(i, c) {
      const row = rows[i], col = cols[c];
      if (!colW[c]) return '';
      if (stubs.has(c)) {
        const g = stubs.get(c), tiene = cols.some((k, j) => k.grupo === g && !blank(valorDe(row, k)));
        return `<div class="hoja-c hoja-c--stub" role="gridcell" aria-hidden="true" style="width:${colW[c]}px">${tiene ? '•' : ''}</div>`;
      }
      let cls = 'hoja-c' + (col.base === 'numero' ? ' hoja-c--n' : '') + (c === 0 ? ' hoja-c--f1' : '');
      const calcRO = col.tipo === 'calc' && !col.anulable;
      if (calcRO) cls += ' hoja-c--calc';
      if (col.tipo === 'calc' && col.anulable && row.ov[col.key] != null) cls += ' hoja-c--ov';
      if (ro || col.soloLectura) cls += ' hoja-c--ro';
      let titulo = '';
      const st = filaEstado(row), e = st.errs.find((x) => x.c === c);
      if (e) { cls += e.t === 'err' ? ' hoja-c--bad' : ' hoja-c--falta'; titulo = e.msg; }
      const s = semaforoDe(row, col);
      if (s && ['ok', 'warn', 'bad'].includes(s.n)) { cls += ' sem-' + s.n; if (!titulo && s.msg) titulo = s.msg; }
      const txt = texto(row, col);
      return `<div class="${cls}" role="gridcell" id="${cellId(i, c)}" data-c="${c}" aria-colindex="${c + 2}"${calcRO || ro ? ' aria-readonly="true"' : ''}${e && e.t === 'err' ? ' aria-invalid="true"' : ''}${titulo ? ` title="${esc(titulo)}"` : ''} style="width:${colW[c]}px">${esc(txt)}</div>`;
    }
    function filaHTML(i) {
      const row = rows[i];
      const st = filaEstado(row);
      const marca = row.sucio && !vacia(row) ? '<i class="hoja-dot" title="Sin guardar"></i>' : '';
      let h = `<div class="hoja-c hoja-g${st.err ? ' hoja-g--bad' : st.falta ? ' hoja-g--falta' : ''}" role="rowheader" data-g="1" style="width:${GUT}px">${marca}<span>${i + 1}</span></div>`;
      for (let c = 0; c < cols.length; c++) h += celdaHTML(i, c);
      return h;
    }
    function crearFilaEl(i) {
      const d = document.createElement('div');
      d.className = 'hoja-f' + (i % 2 ? ' hoja-f--par' : '');
      d.setAttribute('role', 'row'); d.setAttribute('aria-rowindex', i + (cab.querySelector('.hoja-hr--g') ? 3 : 2));
      d.dataset.r = i; d.style.top = i * RH + 'px'; d.style.width = totalW + 'px';
      d.innerHTML = filaHTML(i);
      return d;
    }
    function renderWin(force) {
      if (destroyed) return;
      const top = vp.scrollTop, hgt = vp.clientHeight || 600;
      const a = Math.max(0, Math.floor(top / RH) - 8), b = Math.min(rows.length - 1, Math.ceil((top + hgt) / RH) + 8);
      for (const [i, d] of rowEls) {
        if (i > rows.length - 1 || ((i < a || i > b) && !(ed && ed.r === i))) { d.remove(); rowEls.delete(i); }
      }
      body.style.height = rows.length * RH + 'px';
      for (let i = a; i <= b; i++) {
        const cur = rowEls.get(i);
        if (!cur) { const d = crearFilaEl(i); body.appendChild(d); rowEls.set(i, d); }
        else if (force && !(ed && ed.r === i)) { cur.innerHTML = filaHTML(i); cur.style.width = totalW + 'px'; cur.className = 'hoja-f' + (i % 2 ? ' hoja-f--par' : ''); }
      }
      vp.setAttribute('aria-rowcount', rows.length + 2);
      paintSel(); decorar();
    }
    let rafScroll = 0;
    vp.addEventListener('scroll', () => { if (rafScroll) return; rafScroll = requestAnimationFrame(() => { rafScroll = 0; renderWin(false); }); });

    /* ---------- Selección ---------- */
    const rango = () => ({ r1: Math.min(act.r, ext.r), r2: Math.max(act.r, ext.r), c1: Math.min(act.c, ext.c), c2: Math.max(act.c, ext.c) });
    function paintSel() {
      const s = rango(), multi = s.r1 !== s.r2 || s.c1 !== s.c2;
      for (const [i, d] of rowEls) {
        const enR = i >= s.r1 && i <= s.r2;
        d.classList.toggle('hoja-f--act', i === act.r);
        for (const cell of d.children) {
          if (cell.dataset.g) { cell.classList.toggle('hoja-g--act', i === act.r); continue; }
          const c = +cell.dataset.c;
          if (Number.isNaN(c)) continue;
          cell.classList.toggle('hoja-c--sel', multi && enR && c >= s.c1 && c <= s.c2);
          const isAct = i === act.r && c === act.c;
          cell.classList.toggle('hoja-c--act', isAct);
          if (cell.hasAttribute('aria-selected') !== (enR && c >= s.c1 && c <= s.c2)) { if (enR && c >= s.c1 && c <= s.c2) cell.setAttribute('aria-selected', 'true'); else cell.removeAttribute('aria-selected'); }
        }
      }
      const id = cellId(act.r, act.c);
      if (document.getElementById(id)) vp.setAttribute('aria-activedescendant', id); else vp.removeAttribute('aria-activedescendant');
      // cabeceras de la columna activa
      cab.querySelectorAll('.hoja-h[data-c]').forEach((h) => h.classList.toggle('hoja-h--act', +h.dataset.c === act.c));
    }
    function cellEl(r, c) { const d = rowEls.get(r); return d ? d.querySelector(`.hoja-c[data-c="${c}"]`) : null; }
    function decorar() {
      vp.querySelectorAll('.hoja-c__btn').forEach((b) => b.remove());
      if (ro || ed) return;
      const col = cols[act.c], cell = cellEl(act.r, act.c);
      if (!col || !cell || !editable(act.r, act.c)) return;
      let t = null;
      if (col.base === 'lista') t = '▾';
      else if (TIPOS_FECHA.includes(col.base) && blank(valorDe(rows[act.r], col))) t = col.base === 'fecha' ? 'Hoy' : 'Ahora';
      if (!t) return;
      const b = document.createElement('button');
      b.type = 'button'; b.tabIndex = -1; b.className = 'hoja-c__btn'; b.textContent = t; b.dataset.k = t === '▾' ? 'lista' : 'ahora';
      b.setAttribute('aria-label', t === '▾' ? 'Abrir lista de opciones' : 'Poner la fecha u hora actual');
      cell.appendChild(b);
    }
    function visible(c) { return colW[c] > 0 && !stubs.has(c); }
    function colSig(c, dir) { let k = c + dir; while (k >= 0 && k < cols.length && !visible(k)) k += dir; return k >= 0 && k < cols.length ? k : c; }
    function primeraEditable() { for (let c = 0; c < cols.length; c++) if (visible(c) && editable(0, c)) return c; return 0; }
    function scrollA(r, c) {
      const cabH = cab.offsetHeight, vh = vp.clientHeight, vw = vp.clientWidth;
      const y = r * RH;
      if (y < vp.scrollTop) vp.scrollTop = y;
      else if (y + RH + cabH > vp.scrollTop + vh) vp.scrollTop = y + RH + cabH - vh;
      const x = colX[c], w = colW[c], fix = c === 0 ? 0 : GUT + cols[0].ancho;
      if (c > 0 && x - fix < vp.scrollLeft) vp.scrollLeft = x - fix;
      else if (x + w > vp.scrollLeft + vw) vp.scrollLeft = x + w - vw;
    }
    function ir(r, c, extend, sinScroll) {
      r = Math.max(0, Math.min(rows.length - 1, r)); c = Math.max(0, Math.min(cols.length - 1, c));
      if (!visible(c)) c = colSig(c, 1) !== c ? colSig(c, 1) : colSig(c, -1);
      if (extend) ext = { r, c }; else { act = { r, c }; ext = { r, c }; }
      if (!sinScroll) scrollA(r, c);
      renderWin(false);
      pieInfo();
    }
    function pieInfo() {
      const col = cols[act.c], row = rows[act.r];
      if (!col || !row) { pieAyuda.textContent = ''; return; }
      const st = filaEstado(row), e = st.errs.find((x) => x.c === act.c), s = semaforoDe(row, col);
      let t = col.titulo + (col.unidad ? ' (' + col.unidad + ')' : '');
      if (col.ayuda) t += ' · ' + col.ayuda;
      else if (col.base === 'numero' && (col.min != null || col.max != null)) t += ' · rango ' + (col.min != null ? col.min : '…') + '–' + (col.max != null ? col.max : '…');
      if (col.tipo === 'calc') t += ' · calculado' + (col.anulable ? ' (puedes sobrescribirlo; Supr lo restablece)' : '');
      pieAyuda.textContent = t;
      pieAyuda.dataset.estado = e ? e.t : s && s.msg ? s.n : '';
      if (e) pieMsg.textContent = e.msg;
      else if (s && s.msg) pieMsg.textContent = s.msg;
      else if (!pieMsg.dataset.fijo) pieMsg.textContent = '';
    }
    let msgT = null;
    function msg(t, ms) { pieMsg.textContent = t || ''; pieMsg.dataset.fijo = t ? '1' : ''; clearTimeout(msgT); if (t) msgT = setTimeout(() => { pieMsg.dataset.fijo = ''; pieInfo(); }, ms || 4000); }

    /* ---------- Edición ---------- */
    function iniciarEdicion(r, c, o) {
      o = o || {};
      if (ed) commitEdit();
      if (!editable(r, c)) { if (ro) msg('Hoja de solo lectura'); else if (cols[c] && cols[c].tipo === 'calc') msg('«' + cols[c].titulo + '» se calcula solo'); return; }
      scrollA(r, c); renderWin(false);
      const cell = cellEl(r, c); if (!cell) return;
      const row = rows[r], col = cols[c];
      vp.querySelectorAll('.hoja-c__btn').forEach((b) => b.remove());
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'hoja-ed'; input.autocomplete = 'off'; input.spellcheck = false;
      input.setAttribute('aria-label', col.titulo + (col.unidad ? ' (' + col.unidad + ')' : ''));
      if (col.base === 'numero') input.inputMode = 'decimal';
      input.placeholder = TIPOS_FECHA.includes(col.base) ? (col.base === 'hora' ? 'hh:mm' : 'hoy 14:30 · 7/10 08:00') : '';
      input.value = o.texto != null ? o.texto : textoEdicion(row, col);
      cell.classList.add('hoja-c--ed'); cell.textContent = ''; cell.appendChild(input);
      ed = { r, c, input, modo: o.texto != null ? 'enter' : 'edit', hl: -1, pend: null, cerrando: false };
      input.focus({ preventScroll: true });
      if (o.texto == null) input.setSelectionRange(input.value.length, input.value.length);
      input.addEventListener('keydown', teclaEdicion);
      input.addEventListener('input', () => { ed.pend = null; ed.hl = col.base === 'lista' ? 0 : -1; if (col.base === 'lista') abrirPop(); });
      input.addEventListener('blur', () => { if (ed && ed.input === input && !ed.cerrando) commitEdit({ suave: true }); });
      input.addEventListener('paste', (e) => {
        const t = (e.clipboardData || root.clipboardData).getData('text');
        if (/[\t\n]/.test(t.replace(/[\r\n]+$/, ''))) { e.preventDefault(); cancelarEdicion(); pegar(t); }
      });
      if (col.base === 'lista' && (o.abrir || o.texto)) { ed.hl = o.texto ? 0 : -1; abrirPop(); }
    }
    function cerrarEditor() {
      if (!ed) return;
      const { r, c, input } = ed;
      ed.cerrando = true;
      cerrarPop();
      const cell = cellEl(r, c);
      ed = null;
      if (input.parentNode) input.remove();
      if (cell) cell.classList.remove('hoja-c--ed');
    }
    function cancelarEdicion() {
      if (!ed) return;
      const r = ed.r; cerrarEditor();
      const d = rowEls.get(r); if (d) d.innerHTML = filaHTML(r);
      renderWin(false); vp.focus({ preventScroll: true });
    }
    /** confirma la edición; devuelve false si se rechaza el valor (el editor sigue abierto) */
    function commitEdit(o) {
      if (!ed) return true;
      o = o || {};
      const { r, c, input } = ed, row = rows[r], col = cols[c];
      const txt = input.value;
      let res;
      const popSel = pop && ed.hl >= 0 ? pop.items[ed.hl] : null;
      if (col.base === 'lista' && popSel && !popSel.nuevo && !o.suave) res = { ok: true, val: popSel.v };
      else res = interpretar(col, row, txt, o.suave ? 'suave' : 'enter');
      if (!res.ok) {
        if (res.nuevo) {
          if (ed.pend === txt.trim()) res = { ok: true, val: txt.trim() };
          else { ed.pend = txt.trim(); msg('«' + txt.trim() + '» es un valor nuevo. Pulsa Enter otra vez para agregarlo.', 6000); abrirPop(); return false; }
        } else { msg(res.msg, 5000); input.classList.add('hoja-ed--bad'); return false; }
      }
      cerrarEditor();
      const prev = valorDe(row, col);
      if (res.val !== prev && !(blank(res.val) && blank(prev))) escribir([{ r, c, val: res.val }]);
      else { const d = rowEls.get(r); if (d) d.innerHTML = filaHTML(r); }
      renderWin(false);
      vp.focus({ preventScroll: true });
      return true;
    }
    function mover(dr, dc, extend) { ir(act.r + dr, dc ? colSig(act.c, dc) : act.c, extend); }
    /** Tab / Shift+Tab: devuelve false si el foco debe salir de la hoja */
    function tab(shift) {
      const dir = shift ? -1 : 1;
      const bloqueada = (c) => cols[c].tipo === 'calc' && !cols[c].anulable;
      let c = colSig(act.c, dir);
      while (c !== act.c && bloqueada(c)) { const n = colSig(c, dir); if (n === c) { c = act.c; break; } c = n; }
      if (c !== act.c && !bloqueada(c)) { ir(act.r, c); return true; }
      const r = act.r + dir;
      if (r < 0 || r >= rows.length) return false;
      let cc = shift ? cols.length - 1 : 0; if (!visible(cc)) cc = colSig(cc, dir);
      while (bloqueada(cc)) { const n = colSig(cc, dir); if (n === cc) break; cc = n; }
      ir(r, cc); return true;
    }
    function teclaEdicion(e) {
      if (!ed) return;
      const col = cols[ed.c];
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelarEdicion(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === ';' && TIPOS_FECHA.includes(col.base)) { e.preventDefault(); ed.input.value = fmtFecha(ahora(col.base), col.base); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { if (commitEdit()) nuevaDebajo(); return; }
        if (commitEdit()) mover(e.shiftKey ? -1 : 1, 0);
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); if (commitEdit()) tab(e.shiftKey); return; }
      if (col.base === 'lista' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        if (!pop) { ed.hl = -1; abrirPop(); }
        const n = pop ? pop.items.length : 0;
        if (n) { ed.hl = e.key === 'ArrowDown' ? (ed.hl + 1) % n : (ed.hl - 1 + n) % n; pintarPop(); }
        return;
      }
      if (ed.modo === 'enter' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0, dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (commitEdit()) mover(dr, dc);
      }
    }

    /* ---------- Lista desplegable ---------- */
    function itemsPop(col, row, txt) {
      const os = opcionesDe(col, row), n = norm(txt);
      let items = n ? [...os.filter((o) => norm(o.t) === n), ...os.filter((o) => norm(o.t) !== n && norm(o.t).startsWith(n)), ...os.filter((o) => !norm(o.t).startsWith(n) && norm(o.t).includes(n))] : os;
      items = items.slice(0, 60);
      if (col.libre && txt.trim() && !os.some((o) => norm(o.t) === n)) items.push({ v: txt.trim(), t: '＋ Agregar «' + txt.trim() + '» como valor nuevo', nuevo: true });
      return items;
    }
    function abrirPop() {
      if (!ed) return;
      const col = cols[ed.c], row = rows[ed.r];
      const items = itemsPop(col, row, ed.input.value);
      if (!items.length) { cerrarPop(); return; }
      if (!pop) {
        const d = document.createElement('div');
        d.className = 'hoja-pop'; d.setAttribute('role', 'listbox');
        d.addEventListener('mousedown', (e) => e.preventDefault());
        d.addEventListener('click', (e) => {
          const li = e.target.closest('[data-i]'); if (!li || !ed) return;
          ed.hl = +li.dataset.i; const it = pop.items[ed.hl];
          ed.input.value = it.nuevo ? it.v : it.t; if (it.nuevo) ed.pend = it.v;
          if (commitEdit()) mover(1, 0);
        });
        document.body.appendChild(d);
        pop = { el: d, items };
      }
      pop.items = items;
      if (ed.hl >= items.length) ed.hl = items.length - 1;
      pintarPop();
    }
    function pintarPop() {
      if (!pop || !ed) return;
      pop.el.innerHTML = pop.items.map((o, i) => `<div role="option" class="hoja-op${i === ed.hl ? ' on' : ''}${o.nuevo ? ' nuevo' : ''}" data-i="${i}" aria-selected="${i === ed.hl}">${esc(o.t)}</div>`).join('');
      const rc = ed.input.getBoundingClientRect(), h = Math.min(260, pop.items.length * 30 + 8);
      const below = innerHeight - rc.bottom > h + 8 || rc.top < h;
      pop.el.style.left = Math.max(4, Math.min(rc.left, innerWidth - 224)) + 'px';
      pop.el.style.minWidth = Math.max(200, rc.width) + 'px';
      pop.el.style.top = (below ? rc.bottom + 2 : rc.top - h - 2) + 'px';
      const on = pop.el.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function cerrarPop() { if (pop) { pop.el.remove(); pop = null; } }

    /* ---------- Operaciones sobre rangos ---------- */
    function borrarRango() {
      if (ro) return;
      const s = rango(), celdas = [];
      for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) if (editable(r, c) && !blank(valorDe(rows[r], cols[c]))) celdas.push({ r, c, val: null });
      if (celdas.length) escribir(celdas);
    }
    function copiaTexto(s) {
      const m = [];
      for (let r = s.r1; r <= s.r2; r++) {
        const fila = [];
        for (let c = s.c1; c <= s.c2; c++) {
          const col = cols[c], v = valorDe(rows[r], col);
          let t = '';
          if (!blank(v)) {
            if (col.base === 'numero' && isNum(v)) t = /^es/i.test(navigator.language || 'es') ? String(v).replace('.', ',') : String(v);
            else if (col.base === 'fechahora' && RX.fechahora.test(v)) t = v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4) + ' ' + v.slice(11);
            else if (col.base === 'fecha' && RX.fecha.test(v)) t = v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4);
            else t = String(v);
          }
          fila.push(t);
        }
        m.push(fila);
      }
      return toTSV(m);
    }
    let copiado = false;
    function copiar(e, cortar) {
      const t = copiaTexto(rango());
      copiado = true;
      if (e && e.clipboardData) { e.clipboardData.setData('text/plain', t); e.preventDefault(); }
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(() => {});
      if (cortar) borrarRango();
      msg('Copiado ' + (rango().r2 - rango().r1 + 1) + ' × ' + (rango().c2 - rango().c1 + 1) + ' celdas');
    }
    function pegar(texto) {
      if (ro) { msg('Hoja de solo lectura'); return; }
      const m = parseTSV(texto);
      if (!m.length || (m.length === 1 && m[0].length === 1 && m[0][0] === '' )) return;
      const s = rango(), celdas = [];
      let r0 = s.r1, c0 = s.c1;
      const unico = m.length === 1 && m[0].length === 1;
      const nuevas = [];
      begin();
      const necesarias = unico ? s.r2 + 1 : r0 + m.length;
      while (rows.length < necesarias) { const f = mkRow(); rows.push(f); tx.ops.push({ k: 'ins', row: f, idx: rows.length - 1 }); nuevas.push(f); }
      const alto = unico ? s.r2 - s.r1 + 1 : m.length, ancho = unico ? s.c2 - s.c1 + 1 : m[0].length;
      let omitidas = 0, invalidas = 0;
      for (let i = 0; i < alto; i++) {
        const fila = m[unico ? 0 : i] || [];
        for (let j = 0; j < ancho; j++) {
          const c = c0 + j, r = r0 + i;
          if (c >= cols.length) break;
          if (!editable(r, c)) { omitidas++; continue; }
          const res = interpretar(cols[c], rows[r], unico ? fila[0] : fila[j], 'suave');
          const prev = valorDe(rows[r], cols[c]);
          if (res.val === prev || (blank(res.val) && blank(prev))) continue;
          if (typeof res.val === 'string' && cols[c].base !== 'texto' && !(cols[c].base === 'lista' && cols[c].libre)) invalidas++;
          celdas.push({ r, c, val: res.val });
        }
      }
      const cambios = [];
      for (const x of celdas) { ponerValor(rows[x.r], cols[x.c], x.val); cambios.push({ indice: x.r, columna: cols[x.c].key, valor: x.val }); }
      end();
      act = { r: r0, c: c0 }; ext = { r: Math.min(rows.length - 1, r0 + alto - 1), c: Math.min(cols.length - 1, c0 + ancho - 1) };
      trasCambio(cambios.map((x) => x.indice), true, cambios);
      let t = 'Pegadas ' + celdas.length + ' celdas' + (nuevas.length ? ' · ' + nuevas.length + ' filas nuevas' : '');
      if (omitidas) t += ' · ' + omitidas + ' calculadas omitidas';
      if (invalidas) t += ' · ' + invalidas + ' valores a revisar';
      msg(t, 6000);
    }
    function rellenarAbajo() {
      if (ro) return;
      const s = rango(), celdas = [];
      const fuente = s.r1 === s.r2 ? s.r1 - 1 : s.r1, desde = s.r1 === s.r2 ? s.r1 : s.r1 + 1;
      if (fuente < 0) return;
      for (let c = s.c1; c <= s.c2; c++) for (let r = desde; r <= s.r2; r++) {
        if (!editable(r, c)) continue;
        const v = rows[fuente].d[cols[c].key];
        if (cols[c].tipo === 'calc') continue;
        celdas.push({ r, c, val: v == null ? null : v });
      }
      if (celdas.length) { escribir(celdas); msg('Rellenado hacia abajo'); }
    }
    function ponerAhora() {
      const col = cols[act.c];
      if (!TIPOS_FECHA.includes(col.base) || !editable(act.r, act.c)) return false;
      escribir([{ r: act.r, c: act.c, val: ahora(col.base) }]);
      return true;
    }
    function nuevaDebajo() {
      if (ro) return;
      const f = mkRow({}); f.tocada = false;
      begin(); const idx = act.r + 1; rows.splice(idx, 0, f); tx.ops.push({ k: 'ins', row: f, idx }); end();
      trasCambio([idx], true);
      ir(idx, primeraEditable());
    }
    function agregarFila(valores) {
      if (ro) return -1;
      let f = rows.find((r) => vacia(r));
      begin();
      if (!f) { f = mkRow(); rows.push(f); tx.ops.push({ k: 'ins', row: f, idx: rows.length - 1 }); }
      const i = rows.indexOf(f);
      touchRow(f);
      if (valores) for (const [k, v] of Object.entries(valores)) if (k in colIdx) { if (cols[colIdx[k]].tipo === 'calc') { if (cols[colIdx[k]].anulable) f.ov[k] = v; } else f.d[k] = v; }
      f.tocada = !!valores; f.sucio = !!valores;
      end();
      trasCambio([i], true);
      return rows.indexOf(f);
    }
    function duplicarFila() {
      if (ro) return;
      const s = rango(), nuevos = [];
      begin();
      let idx = s.r2 + 1;
      for (let r = s.r1; r <= s.r2; r++) {
        const o = rows[r]; if (vacia(o)) continue;
        const f = mkRow(); f.d = Object.assign({}, o.d); f.ov = Object.assign({}, o.ov); f.tocada = true; f.sucio = true;
        rows.splice(idx, 0, f); tx.ops.push({ k: 'ins', row: f, idx }); nuevos.push(idx); idx++;
      }
      end();
      if (!nuevos.length) return;
      trasCambio(nuevos, true);
      ir(nuevos[0], act.c);
      msg('Fila duplicada');
    }
    async function eliminarFilas() {
      if (ro) return;
      const s = rango(), objetivo = [];
      for (let r = s.r1; r <= s.r2; r++) if (!vacia(rows[r])) objetivo.push(rows[r]);
      if (!objetivo.length) { msg('No hay filas con datos para eliminar'); return; }
      const guardadas = objetivo.filter((r) => r.id);
      if (guardadas.length) {
        if (typeof opts.onEliminar !== 'function') { msg('Las filas ya guardadas no se pueden eliminar desde aquí'); return; }
        let ok = false;
        try { ok = await opts.onEliminar(guardadas.map((r) => pub(r, rows.indexOf(r))), api); } catch (e) { ok = false; }
        if (!ok) return;
        const quitar = new Set(guardadas);
        for (const r of quitar) { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); }
        const resto = objetivo.filter((r) => !r.id);
        begin(); for (const r of resto) { const i = rows.indexOf(r); if (i >= 0) { rows.splice(i, 1); tx.ops.push({ k: 'del', row: r, idx: i }); } } end();
        undoS.length = 0; redoS.length = 0;
      } else {
        begin();
        for (const r of objetivo) { const i = rows.indexOf(r); if (i >= 0) { rows.splice(i, 1); tx.ops.push({ k: 'del', row: r, idx: i }); } }
        end();
      }
      trasCambio(null, true);
      ir(Math.min(act.r, rows.length - 1), act.c);
      msg(objetivo.length + (objetivo.length === 1 ? ' fila eliminada' : ' filas eliminadas') + ' · Ctrl+Z para deshacer');
    }

    /* ---------- Teclado ---------- */
    function alternarSino() {
      const col = cols[act.c], row = rows[act.r];
      if (col.tipo !== 'sino' || !editable(act.r, act.c)) return false;
      const v = row.d[col.key];
      escribir([{ r: act.r, c: act.c, val: v === 'SI' ? 'NO' : v === 'NO' ? null : 'SI' }]);
      return true;
    }
    vp.addEventListener('keydown', (e) => {
      if (ed) return;
      const k = e.key, mod = e.ctrlKey || e.metaKey;
      const nav = (dr, dc) => { e.preventDefault(); mover(dr, dc, e.shiftKey); };
      if (mod) {
        const kl = k.toLowerCase();
        if (kl === 'z' && !e.shiftKey) { e.preventDefault(); deshacer(); return; }
        if (kl === 'y' || (kl === 'z' && e.shiftKey)) { e.preventDefault(); rehacer(); return; }
        if (kl === 's') { e.preventDefault(); guardar(); return; }
        if (kl === 'd') { e.preventDefault(); rellenarAbajo(); return; }
        if (kl === 'a') { e.preventDefault(); act = { r: 0, c: 0 }; ext = { r: rows.length - 1, c: cols.length - 1 }; renderWin(false); return; }
        if (kl === 'c' || kl === 'x') { copiado = false; setTimeout(() => { if (!copiado) copiar(null, kl === 'x'); }, 30); return; }
        if (kl === 'v') return;
        if (k === ';') { e.preventDefault(); ponerAhora(); return; }
        if (k === 'Enter') { e.preventDefault(); nuevaDebajo(); return; }
        if (k === '-') { e.preventDefault(); eliminarFilas(); return; }
        if (k === 'ArrowDown') { e.preventDefault(); ir(rows.length - 1, act.c, e.shiftKey); return; }
        if (k === 'ArrowUp') { e.preventDefault(); ir(0, act.c, e.shiftKey); return; }
        if (k === 'ArrowLeft' || k === 'Home') { e.preventDefault(); ir(k === 'Home' ? 0 : act.r, 0, e.shiftKey); return; }
        if (k === 'ArrowRight' || k === 'End') { e.preventDefault(); ir(k === 'End' ? rows.length - 1 : act.r, cols.length - 1, e.shiftKey); return; }
        return;
      }
      switch (k) {
        case 'ArrowDown': if (e.altKey && cols[act.c].base === 'lista') { e.preventDefault(); iniciarEdicion(act.r, act.c, { abrir: true }); return; } return nav(1, 0);
        case 'ArrowUp': return nav(-1, 0);
        case 'ArrowLeft': return nav(0, -1);
        case 'ArrowRight': return nav(0, 1);
        case 'Tab': if (tab(e.shiftKey)) e.preventDefault(); return;
        case 'Enter': e.preventDefault(); if (act.r === rows.length - 1 && !vacia(rows[act.r])) asegurarFinal(); ir(act.r + (e.shiftKey ? -1 : 1), act.c); return;
        case 'Home': e.preventDefault(); ir(act.r, colSig(-1, 1), e.shiftKey); return;
        case 'End': e.preventDefault(); { let c = cols.length; c = colSig(c, -1); ir(act.r, c, e.shiftKey); } return;
        case 'PageDown': e.preventDefault(); ir(act.r + Math.max(1, Math.floor(vp.clientHeight / RH) - 2), act.c, e.shiftKey); return;
        case 'PageUp': e.preventDefault(); ir(act.r - Math.max(1, Math.floor(vp.clientHeight / RH) - 2), act.c, e.shiftKey); return;
        case 'F2': e.preventDefault(); iniciarEdicion(act.r, act.c, { abrir: cols[act.c].base === 'lista' }); return;
        case 'F4': e.preventDefault(); if (cols[act.c].base === 'lista') iniciarEdicion(act.r, act.c, { abrir: true }); return;
        case 'Delete': case 'Backspace': e.preventDefault(); borrarRango(); return;
        case 'Escape': if (rango().r1 !== rango().r2 || rango().c1 !== rango().c2) { ext = { ...act }; renderWin(false); } return;
        default:
      }
      if (k === ' ' && cols[act.c].tipo === 'sino') { e.preventDefault(); alternarSino(); return; }
      if ((k === 'n' || k === 'N') && !e.altKey && TIPOS_FECHA.includes(cols[act.c].base) && editable(act.r, act.c)) { e.preventDefault(); ponerAhora(); return; }
      if (k.length === 1 && !e.altKey) {
        e.preventDefault();
        iniciarEdicion(act.r, act.c, { texto: k });
      }
    });
    vp.addEventListener('copy', (e) => { if (ed) return; copiar(e, false); });
    vp.addEventListener('cut', (e) => { if (ed) return; copiar(e, true); });
    vp.addEventListener('paste', (e) => {
      if (ed) return;
      e.preventDefault();
      pegar((e.clipboardData || root.clipboardData).getData('text'));
    });

    /* ---------- Ratón y táctil ---------- */
    let wasAct = false;
    vp.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.hoja-c__btn');
      if (b) {
        e.preventDefault();
        if (b.dataset.k === 'ahora') { ponerAhora(); vp.focus({ preventScroll: true }); }
        else iniciarEdicion(act.r, act.c, { abrir: true });
        return;
      }
      if (e.target.closest('.hoja-gtog')) return;
      if (e.target.closest('.hoja-ed')) return;
      const cell = e.target.closest('.hoja-c, .hoja-h[data-c]');
      if (!cell || e.button > 0) return;
      if (ed) commitEdit({ suave: true });
      const fila = cell.closest('.hoja-f');
      if (cell.classList.contains('hoja-h')) {   // clic en cabecera: columna completa
        const c = +cell.dataset.c; act = { r: 0, c }; ext = { r: rows.length - 1, c }; renderWin(false); vp.focus({ preventScroll: true }); return;
      }
      if (!fila) return;
      const r = +fila.dataset.r;
      if (cell.dataset.g) { act = { r, c: 0 }; ext = { r, c: cols.length - 1 }; renderWin(false); vp.focus({ preventScroll: true }); return; }
      const c = +cell.dataset.c;
      if (Number.isNaN(c) || stubs.has(c)) return;
      wasAct = act.r === r && act.c === c && e.pointerType !== 'mouse';
      if (e.shiftKey) ir(r, c, true, true); else { act = { r, c }; ext = { r, c }; renderWin(false); pieInfo(); }
      selecting = e.pointerType === 'mouse';
      if (document.activeElement !== vp) { e.preventDefault(); vp.focus({ preventScroll: true }); }
    });
    vp.addEventListener('pointermove', (e) => {
      if (!selecting || !(e.buttons & 1)) { selecting = false; return; }
      const t = document.elementFromPoint(e.clientX, e.clientY), cell = t && t.closest && t.closest('.hoja-c');
      if (!cell || cell.dataset.g || !cell.closest('.hoja-f') || !vp.contains(cell)) return;
      const r = +cell.closest('.hoja-f').dataset.r, c = +cell.dataset.c;
      if (Number.isNaN(c) || stubs.has(c) || (ext.r === r && ext.c === c)) return;
      ext = { r, c }; paintSel();
      const rc = vp.getBoundingClientRect();
      if (e.clientY > rc.bottom - 24) vp.scrollTop += 24; else if (e.clientY < rc.top + cab.offsetHeight + 16) vp.scrollTop -= 24;
    });
    document.addEventListener('pointerup', onUp);
    function onUp() { selecting = false; }
    vp.addEventListener('click', (e) => {
      if (wasAct && !ed) {
        const cell = e.target.closest('.hoja-c');
        if (cell && !cell.dataset.g && !e.target.closest('.hoja-c__btn')) {
          wasAct = false;
          if (cols[act.c].tipo === 'sino' && alternarSino()) return;
          iniciarEdicion(act.r, act.c, { abrir: cols[act.c].base === 'lista' });
        }
      }
      wasAct = false;
      const g = e.target.closest('.hoja-gtog');
      if (g) { const n = g.dataset.g; if (plegados.has(n)) plegados.delete(n); else plegados.add(n); cabeceraHTML(); if (oculta(act.c)) { act = { r: act.r, c: primeraEditable() }; ext = { ...act }; } rowEls.forEach((d) => d.remove()); rowEls.clear(); renderWin(true); }
    });
    vp.addEventListener('dblclick', (e) => {
      const cell = e.target.closest('.hoja-c');
      if (!cell || cell.dataset.g || e.target.closest('.hoja-ed')) return;
      iniciarEdicion(act.r, act.c, { abrir: cols[act.c].base === 'lista' });
    });

    /* ---------- Barra y estado ---------- */
    function resumen() {
      const v = validar();
      const conError = new Set(v.errores.map((e) => e.fila)).size;
      const partes = [v.filas + (v.filas === 1 ? ' fila' : ' filas')];
      partes.push(conError + ' con error');
      partes.push(v.sinGuardar + ' sin guardar');
      estado.textContent = partes.join(' · ');
      estado.classList.toggle('hoja-estado--bad', conError > 0);
      const b = btn('save');
      if (b) {
        b.textContent = saving ? 'Guardando…' : v.listas.length ? 'Guardar ' + v.listas.length + (v.listas.length === 1 ? ' fila' : ' filas') : 'Guardar';
        b.disabled = ro || saving || !v.listas.length;
      }
      btn('undo').disabled = !undoS.length; btn('redo').disabled = !redoS.length;
      for (const a of ['nueva', 'dup', 'del']) btn(a).disabled = ro;
      return v;
    }
    async function guardar() {
      if (ro || saving || typeof opts.onGuardar !== 'function') return false;
      if (ed && !commitEdit()) return false;
      end();
      const v = validar();
      if (!v.listas.length) {
        if (v.errores.length) { const e = v.errores[0]; msg('Corrige «' + cols[colIdx[e.columna]].titulo + '» en la fila ' + (e.fila + 1) + ': ' + e.mensaje, 7000); ir(e.fila, colIdx[e.columna]); }
        else msg('No hay cambios por guardar');
        return false;
      }
      const lista = v.listas.map((i) => rows[i]);
      saving = true; resumen();
      let res;
      try { res = await opts.onGuardar(lista.map((r) => pub(r, rows.indexOf(r))), api); }
      catch (e) { res = false; if (root.console) console.error(e); }
      saving = false;
      if (res === false) { resumen(); return false; }
      lista.forEach((r, i) => {
        r.sucio = false; r.nuevo = false;
        const id = Array.isArray(res) && res[i] != null ? (typeof res[i] === 'object' ? res[i].id : res[i]) : null;
        if (id != null) r.id = id; else if (!r.id) r.id = 'tmp-' + Math.random().toString(36).slice(2);
        r.st = null;
      });
      undoS.length = 0; redoS.length = 0;
      asegurarFinal(); recalc(null); renderWin(true); resumen(); borrador();
      const pend = v.errores.length ? new Set(v.errores.map((e) => e.fila)).size : 0;
      msg('Guardadas ' + lista.length + (lista.length === 1 ? ' fila' : ' filas') + (pend ? ' · ' + pend + ' con error siguen pendientes' : ''), 5000);
      return true;
    }
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'nueva') { const i = agregarFila(); if (i >= 0) { ir(i, primeraEditable()); vp.focus({ preventScroll: true }); } }
      else if (a === 'dup') duplicarFila();
      else if (a === 'del') eliminarFilas();
      else if (a === 'undo') deshacer();
      else if (a === 'redo') rehacer();
      else if (a === 'save') guardar();
      else if (a === 'help') ayuda();
      if (a !== 'save') vp.focus({ preventScroll: true });
    });
    function ayuda() {
      const ya = document.querySelector('.hoja-ayuda'); if (ya) { ya.remove(); return; }
      const d = document.createElement('div');
      d.className = 'hoja-ayuda'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Atajos de teclado');
      d.innerHTML = `<div class="hoja-ayuda-c"><h3>Atajos de teclado</h3><dl>
        <dt>Flechas · Tab · Enter</dt><dd>Moverse (Enter baja, Tab avanza)</dd>
        <dt>Escribir · F2</dt><dd>Escribir en la celda · editar lo que ya tiene</dd>
        <dt>Esc · Supr</dt><dd>Cancelar la edición · borrar la selección</dd>
        <dt>Shift + flechas</dt><dd>Seleccionar un rango (también arrastrando)</dd>
        <dt>Ctrl+C · Ctrl+V</dt><dd>Copiar · pegar desde Excel o Sheets (crea filas si hace falta)</dd>
        <dt>Ctrl+D</dt><dd>Rellenar hacia abajo</dd>
        <dt>Ctrl+Z · Ctrl+Y</dt><dd>Deshacer · rehacer</dd>
        <dt>N · Ctrl+;</dt><dd>«Ahora» en celdas de fecha u hora</dd>
        <dt>Espacio</dt><dd>SÍ / NO en celdas de sí-no</dd>
        <dt>Alt+↓ · F4</dt><dd>Abrir la lista de opciones</dd>
        <dt>Ctrl+Enter</dt><dd>Insertar fila debajo</dd>
        <dt>Ctrl+-</dt><dd>Eliminar fila(s)</dd>
        <dt>Ctrl+S</dt><dd>Guardar las filas completas y válidas</dd></dl>
        <p>Fechas: «hoy 14:30», «14:30», «7/10 08:00», «2026-10-07 14:30». Números con coma o punto.</p>
        <button type="button" class="hoja-btn hoja-btn--pri">Cerrar</button></div>`;
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('button')) d.remove(); });
      d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); d.remove(); vp.focus(); } });
      document.body.appendChild(d); d.querySelector('button').focus();
    }

    /* ---------- Borrador local ---------- */
    const dkey = opts.clave ? 'cavas:hoja:' + opts.clave : null;
    function borrador() {
      if (!dkey) return;
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        try {
          const sucias = rows.filter((r) => !vacia(r) && r.sucio);
          if (!sucias.length) localStorage.removeItem(dkey);
          else localStorage.setItem(dkey, JSON.stringify({ v: 1, at: Date.now(), filas: sucias.map((r) => ({ id: r.id, d: r.d, ov: r.ov })) }));
        } catch (e) { /* sin almacenamiento */ }
      }, 350);
    }
    function recuperarBorrador() {
      if (!dkey) return 0;
      let b = null;
      try { b = JSON.parse(localStorage.getItem(dkey) || 'null'); } catch (e) { b = null; }
      if (!b || !Array.isArray(b.filas) || !b.filas.length) return 0;
      let n = 0;
      for (const f of b.filas) {
        let row = f.id != null ? rows.find((r) => r.id === f.id) : null;
        if (f.id != null && !row) continue;       // la fila guardada ya no existe
        if (!row) { row = mkRow(); const pos = rows.findIndex((r) => vacia(r)); if (pos >= 0) rows.splice(pos, 0, row); else rows.push(row); }
        row.d = Object.assign({}, f.d); row.ov = Object.assign({}, f.ov || {}); row.tocada = true; row.sucio = true; n++;
      }
      if (n) { aviso.hidden = false; aviso.querySelector('span').textContent = 'Se recuperó un borrador: ' + n + (n === 1 ? ' fila' : ' filas') + ' sin guardar.'; }
      return n;
    }
    aviso.addEventListener('click', (e) => {
      if (!e.target.closest('[data-a="descartar"]')) return;
      try { localStorage.removeItem(dkey); } catch (x) { /* nada */ }
      rows = rows.filter((r) => r.id || false).map((r) => r); recargarOriginal();
      aviso.hidden = true;
    });
    let original = [];
    function recargarOriginal() { cargar(original, false); }

    /* ---------- API ---------- */
    function cargar(filas, conBorrador) {
      original = (filas || []).map((f) => Object.assign({}, f));
      rows = original.map((f) => mkRow(f));
      undoS.length = 0; redoS.length = 0; tx = null;
      asegurarFinal(); recalc(null);
      let n = 0;
      if (conBorrador) n = recuperarBorrador();
      asegurarFinal(); defectos(); recalc(null);
      act = { r: Math.min(act.r, rows.length - 1), c: act.c }; ext = { ...act };
      rowEls.forEach((d) => d.remove()); rowEls.clear();
      renderWin(true); resumen();
      return n;
    }
    function celdaPorClave(r, c) { return [r, typeof c === 'string' ? colIdx[c] : c]; }
    const api = {
      el, columnas: cols,
      getFilas(o) {
        o = o || {};
        const lst = o.soloListas ? new Set(validar().listas) : null;
        return rows.map((r, i) => [r, i]).filter(([r, i]) => (o.todas || !vacia(r)) && (!lst || lst.has(i))).map(([r, i]) => pub(r, i));
      },
      setFilas(filas) { return cargar(filas, false); },
      /** vuelve a cargar manteniendo la selección; las filas pendientes (sin guardar) se conservan si conservar=true */
      recargar(filas, conservar) {
        const pend = conservar ? rows.filter((r) => !vacia(r) && r.sucio).map((r) => ({ id: r.id, d: Object.assign({}, r.d), ov: Object.assign({}, r.ov) })) : [];
        cargar(filas, false);
        for (const p of pend) {
          let row = p.id != null ? rows.find((r) => r.id === p.id) : null;
          if (p.id != null && !row) continue;
          if (!row) { row = mkRow(); const pos = rows.findIndex((r) => vacia(r)); if (pos >= 0) rows.splice(pos, 0, row); else rows.push(row); }
          row.d = p.d; row.ov = p.ov; row.tocada = true; row.sucio = true;
        }
        asegurarFinal(); recalc(null); renderWin(true); resumen(); borrador();
      },
      validar, agregarFila,
      enfocar(r, c) { const [rr, cc] = celdaPorClave(r, c); ir(rr, cc == null ? act.c : cc); vp.focus({ preventScroll: true }); },
      guardar, deshacer, rehacer,
      recalcular() { recalc(null); defectos(); renderWin(true); resumen(); },
      setContexto(c) { opts.contexto = c; api.recalcular(); },
      setSoloLectura(v) { ro = !!v; renderWin(true); resumen(); },
      getCelda(r, key) { const row = rows[r]; if (!row) return null; const v = valorDe(row, cols[colIdx[key]]); return v === undefined ? null : v; },
      setCelda(r, key, val) { const c = colIdx[key]; if (c == null || !rows[r]) return false; const res = interpretar(cols[c], rows[r], val, 'suave'); escribir([{ r, c, val: res.val }]); return true; },
      get activa() { return { fila: act.r, columna: cols[act.c] && cols[act.c].key }; },
      get filasN() { return rows.length; },
      descartarBorrador() { try { localStorage.removeItem(dkey); } catch (e) { /* */ } aviso.hidden = true; },
      destruir() {
        destroyed = true; cerrarEditor(); cerrarPop(); clearTimeout(draftTimer);
        document.removeEventListener('pointerup', onUp);
        const a = document.querySelector('.hoja-ayuda'); if (a) a.remove();
        el.remove();
      },
    };

    cabeceraHTML();
    cargar(opts.filas, true);
    ir(0, primeraEditable(), false, true);
    return api;
  }

  A.Hoja = { crear, util: { parseNum, parseFecha, parseTSV, toTSV, fmtFecha, ahora, norm, msDe, toIso, RX } };
})();
