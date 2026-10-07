/* ============================================================
   Capa de datos unificada (App.DL)
   Normaliza en tablas planas lo que el programa guarda en distintas estructuras:
   agua por turno, aseos, merma, recuperación, trasiego, fermentación y levadura.
   Todas las filas llevan `t` (ms) y `brand` cuando aplica, para poder cruzar y filtrar.
   Es de solo lectura: no modifica ningún registro del programa.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;

  const N = (v) => {
    if (v == null || v === '' || v === '-') return null;
    const x = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(x) ? x : null;
  };
  const sum = (xs) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  // Las marcas llegan escritas de varias formas en los Excel (STD, «ESTANDAR » con espacio, AGUILA LIGHT…).
  // Se unifican aquí; el usuario puede añadir equivalencias en Configuración (config.brandAliases).
  const ALIAS = { STD: 'ESTANDAR', S: 'ESTANDAR', 'AGUILA LIGHT': 'LIGHT', 'POKER 100%': 'POKER', 'CLUB': 'CLUB COLOMBIA', CC: 'CLUB COLOMBIA' };
  const brandOf = (v) => {
    let b = String(v == null ? '' : v);
    try { b = String(A.PlatformRules.brand(v) || b); } catch (e) { /* sin reglas de plataforma */ }
    b = b.replace(/\s+/g, ' ').trim().toUpperCase();
    if (b) SEEN.set(b, (SEEN.get(b) || 0) + 1);
    const custom = (A.S && A.S.config && A.S.config.brandAliases) || {};
    return custom[b] || ALIAS[b] || b;
  };
  const SEEN = new Map();
  // Fechas imposibles (celdas con 0, 2, etc. leídas como fecha) se descartan.
  const T_MIN = Date.UTC(2015, 0, 1), T_MAX = Date.UTC(2040, 0, 1);
  const okT = (t) => t != null && Number.isFinite(t) && t >= T_MIN && t <= T_MAX;
  const S = () => A.OperationSources;
  const time = (v) => {
    try {
      const d = S().date(v);
      if (!d) return null;
      const t = +A.U.parseDT(d);
      return okT(t) ? t : null;
    } catch (e) { return null; }
  };
  const safe = (fn, fallback = []) => { try { return fn() || fallback; } catch (e) { return fallback; } };

  /* ---------- Metadatos de campos (los usa el constructor de análisis y el asistente) ---------- */
  const F = (key, label, unit, kind = 'num', extra = {}) => Object.assign({ key, label, unit: unit || '', kind }, extra);

  const META = {
    agua: {
      label: 'Consumo de agua', singular: 'turno', icon: 'water',
      desc: 'Lecturas de contadores por turno (pisos, CIP, GEA) y su relación con producción y aseos.',
      defaultMetric: 'total', defaultBy: 'day',
      fields: [
        F('t', 'Fecha y hora', '', 'date'), F('shift', 'Turno', '', 'cat'),
        F('pisos', 'Consumo pisos', 'm³'), F('cip', 'Consumo CIP', 'm³'), F('gea', 'Consumo CIP GEA', 'm³'),
        F('total', 'Consumo total del turno', 'm³'), F('aseos', 'N.º de aseos', ''), F('production', 'Mosto recibido (cocina)', 'Hl'),
        F('transfer', 'Trasegado', 'Hl'), F('hlPerHl', 'Agua por Hl procesado', 'Hl/Hl'), F('m3PerAseo', 'Agua por aseo', 'm³'),
      ],
    },
    aseos: {
      label: 'Aseos (CIP)', singular: 'aseo', icon: 'clean',
      desc: 'Cada ciclo de aseo registrado: equipo, duración, caudal, pH y agua estimada.',
      defaultMetric: 'm3', defaultBy: 'week',
      fields: [
        F('t', 'Inicio', '', 'date'), F('durMin', 'Duración', 'min'), F('sheet', 'Tipo de aseo', '', 'cat'), F('equipment', 'Equipo', '', 'cat'),
        F('flow', 'Caudal enjuague', 'Hl/h'), F('minutes', 'Minutos de enjuague', 'min'), F('ph', 'pH enjuague', ''), F('m3', 'Agua estimada', 'm³'),
        F('ok', 'Cumple parámetros', '', 'cat'), F('operator', 'Operario', '', 'cat'),
      ],
    },
    merma: {
      label: 'Merma', singular: 'lote cerrado', icon: 'loss',
      desc: 'Balance de volumen por lote cerrado (FV y SV): entrada, merma, purgas y KGE.',
      defaultMetric: 'lossPct', defaultBy: 'month',
      fields: [
        F('t', 'Fecha de cierre', '', 'date'), F('phase', 'Etapa', '', 'cat'), F('brand', 'Marca', '', 'cat'), F('tq', 'Tanque', '', 'cat'), F('lote', 'Lote', '', 'cat'),
        F('input', 'Volumen de entrada', 'Hl'), F('loss', 'Merma', 'Hl'), F('lossPct', 'Merma', '%'), F('purges', 'Purgas', 'Hl'), F('unexplained', 'Sin explicar', 'Hl'),
        F('kgIn', 'KGE entrada', 'kg'), F('kgOut', 'KGE salida', 'kg'), F('kgLoss', 'KGE pérdida', 'kg'),
      ],
    },
    recuperacion: {
      label: 'Recuperación de cerveza', singular: 'recuperación', icon: 'recover',
      desc: 'Levadura recolectada, agua añadida y cerveza recuperada, con el tiempo que tomó.',
      defaultMetric: 'volume', defaultBy: 'month',
      fields: [
        F('t', 'Fecha de recuperación', '', 'date'), F('utk', 'UTK / colector', '', 'cat'), F('brand', 'Marca destino', '', 'cat'), F('destination', 'SV destino', '', 'cat'),
        F('yeast', 'Levadura recolectada', 'Hl'), F('waterHl', 'Agua añadida', 'Hl'), F('volume', 'Cerveza recuperada', 'Hl'), F('yieldPct', 'Recuperado / levadura', '%'),
        F('hours', 'Horas hasta recuperar', 'h'), F('ph', 'pH', ''), F('temp', 'Temperatura', '°C'),
      ],
    },
    trasiego: {
      label: 'Programa de trasiego', singular: 'actividad', icon: 'transfer',
      desc: 'Plan y ejecución de trasiegos y CIP: duración real, desvío frente al plan y causa.',
      defaultMetric: 'duration', defaultBy: 'month',
      fields: [
        F('t', 'Inicio real', '', 'date'), F('activity', 'Actividad', '', 'cat'), F('kind', 'Clase', '', 'cat'), F('brand', 'Marca', '', 'cat'), F('destination', 'Destino', '', 'cat'),
        F('duration', 'Duración real', 'h'), F('delay', 'Desvío vs. plan', 'h'), F('cause', 'Causa del desvío', '', 'cat'),
      ],
    },
    ferm: {
      label: 'Fermentaciones', singular: 'fermentación', icon: 'ferment',
      desc: 'Una fila por fermentación cerrada: curva, atenuación, tiempos y levadura usada.',
      defaultMetric: 'e72', defaultBy: 'month',
      fields: [
        F('t', 'Llenado', '', 'date'), F('lote', 'Lote', '', 'cat'), F('brand', 'Marca', '', 'cat'), F('tq', 'Tanque', '', 'cat'), F('fam', 'Familia de levadura', '', 'cat'), F('gen', 'Generación de levadura', '', 'num'),
        F('eo', 'Extracto original', '°P'), F('e72', 'Extracto a las 72 h', '°P'), F('h75', 'Horas hasta 75 % atenuación', 'h'), F('h15', 'Horas hasta 15 °P', 'h'), F('rata', 'Ritmo de caída', '°P/h'),
        F('vol', 'Volumen', 'Hl'), F('tll', 'Tiempo de llenado', 'h'), F('tA', 'Tiempo hasta alta', 'h'),
        F('atten', 'Atenuación final', '%'), F('rdf', 'Extracto final', '°P'), F('ph', 'pH final', ''), F('nMuestras', 'N.º de muestras', ''),
        F('viab', 'Viabilidad de la levadura sembrada', '%'), F('cons', 'Consistencia de la levadura sembrada', '%'),
      ],
    },
    lev: {
      label: 'Levadura (cosechas)', singular: 'cosecha', icon: 'yeast',
      desc: 'Banco de levadura: viabilidad, consistencia, pH y destino de cada cosecha.',
      defaultMetric: 'viab', defaultBy: 'month',
      fields: [
        F('t', 'Fecha de cosecha', '', 'date'), F('nombre', 'Levadura', '', 'cat'), F('brand', 'Marca', '', 'cat'), F('fam', 'Familia', '', 'cat'), F('gen', 'Generación', '', 'num'),
        F('viab', 'Viabilidad', '%'), F('cons', 'Consistencia', '%'), F('ph', 'pH', ''), F('etanol', 'Etanol', '%'), F('vol', 'Volumen en cabeza', 'Hl'), F('state', 'Estado', '', 'cat'),
      ],
    },
  };

  /* ---------- Normalizadores ---------- */
  function agua() {
    const w = A.OperationsWorkspace && A.OperationsWorkspace.waterData ? A.OperationsWorkspace.waterData() : { rows: [] };
    // «Mosto frío recibido» trae en el Excel vínculos rotos (−277 600) y cifras imposibles (> 1 000 000): se descartan.
    const okHl = (v) => (v != null && v >= 0 && v <= 10000 ? v : null);
    return w.rows.map((r0) => {
      const r = Object.assign({}, r0, { production: okHl(r0.production), transfer: okHl(r0.transfer) });
      const hl = (r.production || 0) + (r.transfer || 0);
      return {
        id: r.id, t: r.t, day: r.day, shift: r.shift, pisos: r.pisos, cip: r.cip, gea: r.gea, total: r.total,
        aseos: r.aseos, production: r.production, transfer: r.transfer,
        hlPerHl: r.total != null && hl > 0 ? (r.total * 10) / hl : null,
        m3PerAseo: r.total != null && r.aseos > 0 ? r.total / r.aseos : null,
        valid: r.valid !== false, issue: r.issue || '', comment: r.comment || '', source: 'Consumo agua · fila ' + r.row,
      };
    }).filter((r) => okT(r.t)).sort((a, b) => a.t - b.t);
  }

  const ASEO_MAP = {
    '1. Cada uso': { start: 1, end: 2, equipment: 4, number: 5, ok: 8, flow: 23, minutes: 21, ph: 22, operator: 28 },
    'Cambio de marca': { start: 1, equipment: 3, flow: 10, minutes: 8, ph: 9 },
    '2. Semanal': { start: 2, end: 3, equipment: 4, flow: 24, minutes: 22, ph: 23 },
    '3. Mensual': { start: 2, end: 3, equipment: 4, flow: 24, minutes: 22, ph: 23 },
    '5. CIP del CIP': { start: 3, end: 4, equipment: 1, flow: 22, minutes: 21 },
    'Aseo CIPs': { start: 3, equipment: 1, flow: 27, minutes: 26 },
  };
  function aseos() {
    const rows = [];
    for (const [sheet, m] of Object.entries(ASEO_MAP)) {
      for (const r of safe(() => S().records('aseos', sheet))) {
        const c = r.cells, t = time(c[m.start]);
        if (t == null || !c[m.equipment]) continue;
        const end = m.end ? time(c[m.end]) : null;
        const flow = N(c[m.flow]), minutes = N(c[m.minutes]), ph = m.ph ? N(c[m.ph]) : null;
        const valid = flow > 0 && minutes > 0 && minutes <= 1440;
        const okRaw = m.ok ? String(c[m.ok] == null ? '' : c[m.ok]).toUpperCase() : '';
        rows.push({
          id: r.id, t, end, durMin: end != null && end >= t ? (end - t) / 60000 : null, sheet,
          equipment: String(c[m.equipment]).trim().toUpperCase() + (m.number && c[m.number] != null ? ' ' + c[m.number] : ''),
          flow, minutes, ph, m3: valid ? (flow * minutes) / 600 : null,
          ok: okRaw === 'SI' ? 'Sí' : okRaw === 'NO' ? 'No' : '', operator: m.operator && c[m.operator] ? String(c[m.operator]).trim() : '',
          phOk: ph != null ? ph >= 6 && ph <= 8 : null, source: sheet + ' · fila ' + (r.row || 'plataforma'),
        });
      }
    }
    return rows.sort((a, b) => a.t - b.t);
  }

  function merma() {
    const rows = [];
    const ex = A.ExcelCavas.data();
    for (const [type, phase, closed, ratio, input, purges, closedDate, kgeIn, kgeOut] of [
      ['fermentations', 'FV', 845, 689, 65, 641, 564, 690, 692],
      ['maturations', 'SV', 466, 447, 53, 416, 363, 448, 450],
    ]) {
      for (const r of ex[type] || []) {
        const c = r.cells || {};
        const t = time(c[closedDate]) || (phase === 'SV' ? time(c[463]) : null);
        if (c[closed] !== 'VACIO' || t == null) continue;
        const v = N(c[input]), raw = N(c[ratio]);
        const fraction = raw != null ? (phase === 'FV' ? raw / 100 : raw) : null;
        const loss = v != null && fraction != null ? v * fraction : null;
        const kgIn = N(c[kgeIn]), kgOut = N(c[kgeOut]), p = N(c[purges]);
        rows.push({
          id: r.id, phase, lote: r.lote, tq: r.tq, brand: brandOf(r.marca), t, input: v, loss, lossPct: v > 0 && loss != null ? (loss / v) * 100 : null,
          purges: p, unexplained: loss != null && p != null ? loss - p : null, kgIn, kgOut, kgLoss: kgIn != null && kgOut != null ? kgIn - kgOut : null,
          flag: loss == null ? 'Faltan valores de volumen' : loss < 0 ? 'Saldo negativo' : fraction > 0.3 ? 'Merma > 30 %' : null,
          source: (r.source ? r.source.sheet + ' · fila ' + r.source.row : 'Excel'),
        });
      }
    }
    return rows.sort((a, b) => a.t - b.t);
  }

  function recuperacion() {
    return safe(() => S().records('recuperacion', 'Control Recuperada')).map((r) => {
      const c = r.cells, begin = time(c[2]), end = time(c[34]);
      const hours = begin != null && end != null ? (end - begin) / 3600000 : null;
      const yeast = N(c[22]), volume = N(c[38]);
      return {
        id: r.id, t: end || begin, begin, utk: c[1] != null ? String(c[1]) : '', brand: brandOf(c[44]), destination: c[41] != null ? String(c[41]) : '',
        yeast, waterHl: N(c[25]), volume, yieldPct: yeast > 0 && volume != null ? (volume / yeast) * 100 : null,
        hours: hours != null && hours >= 0 ? hours : null, ph: N(c[47]), temp: N(c[40]),
        late: hours != null && hours > 96, over72: hours != null && hours > 72, source: 'Control Recuperada · fila ' + (r.row || 'plataforma'),
      };
    }).filter((r) => r.t != null && (r.volume != null || r.yeast != null)).sort((a, b) => a.t - b.t);
  }

  function trasiego() {
    const rows = [];
    for (const sheet of ['CONTROL TRASIEGO', 'CONTROL TRASIEGO HISTÓRICO']) {
      for (const r of safe(() => S().records('programa', sheet))) {
        const c = r.cells, planned = time(c[5]), start = time(c[6]), actual = time(c[7]), t = start || time(c[4]);
        if (t == null || !c[1]) continue;
        const duration = start != null && actual != null ? (actual - start) / 3600000 : null;
        const act = String(c[1]).trim();
        rows.push({
          id: r.id, t, activity: act, kind: /^CIP/i.test(act) ? 'CIP' : /^TRASIEGO/i.test(act) ? 'Trasiego' : /FILTR/i.test(act) ? 'Filtración' : 'Otro',
          brand: brandOf(c[2]), destination: c[3] != null ? String(c[3]) : '', plannedEnd: planned, actualEnd: actual,
          duration: duration != null && duration >= 0 ? duration : null, delay: planned != null && actual != null ? (actual - planned) / 3600000 : null,
          cause: String(c[sheet.includes('HIST') ? 9 : 10] || '').trim() || 'Sin causa registrada', source: sheet + ' · fila ' + r.row,
        });
      }
    }
    return rows.sort((a, b) => a.t - b.t);
  }

  // Extracto interpolado a las h horas desde el fin de llenado.
  function atHour(pts, h) {
    const p = pts.filter((x) => x.h != null && x.e != null).sort((a, b) => a.h - b.h);
    if (p.length < 2 || h < p[0].h || h > p[p.length - 1].h) return null;
    for (let i = 1; i < p.length; i++) if (p[i].h >= h) { const k = (h - p[i - 1].h) / (p[i].h - p[i - 1].h || 1); return p[i - 1].e + k * (p[i].e - p[i - 1].e); }
    return null;
  }
  // Primera hora en que el extracto baja a `target` °P (interpolado).
  function hourTo(pts, target) {
    const p = pts.filter((x) => x.h != null && x.e != null).sort((a, b) => a.h - b.h);
    for (let i = 1; i < p.length; i++) if (p[i - 1].e > target && p[i].e <= target) { const k = (p[i - 1].e - target) / (p[i - 1].e - p[i].e || 1); return p[i - 1].h + k * (p[i].h - p[i - 1].h); }
    return null;
  }
  function ferm() {
    const levByName = new Map();
    for (const r of lev()) if (r.nombre) levByName.set(String(r.nombre).toUpperCase(), r);
    return safe(() => A.An.DS()).map((d) => {
      const h = d.h || {}, pts = h.pts || [], t = d.t;
      const last = pts.length ? pts[pts.length - 1] : null, first = pts.find((p) => p.h > 0 && p.e != null);
      const lv = h.levadura && h.levadura.nombre ? levByName.get(String(h.levadura.nombre).toUpperCase()) : null;
      const eo = h.eo != null ? h.eo : d.v && d.v.eo;
      const fillMs = h.ini && h.fin ? +A.U.parseDT(h.fin) - +A.U.parseDT(h.ini) : null;
      const samplesPh = (h.muestras || []).map((m) => m.ph).filter((x) => x != null);
      return {
        id: h.id, t, mes: d.mes, lote: h.lote, brand: brandOf(d.marca), tq: d.tq, fam: d.fam, gen: d.gen,
        eo, el: h.el, vol: h.vol != null ? h.vol : d.v && d.v.vol,
        e72: atHour(pts, 72), h15: h.h15Excel != null ? h.h15Excel : hourTo(pts, 15),
        h75: h.h75Excel != null ? h.h75Excel : eo ? hourTo(pts, eo * 0.25) : null,
        rata: first && last && last.h > first.h ? (first.e - last.e) / (last.h - first.h) : null,
        tll: fillMs != null && fillMs >= 0 ? fillMs / 3600000 : null, tA: d.v && d.v.tA,
        atten: eo && last && last.e != null ? ((eo - last.e) / eo) * 100 : null, rdf: last && last.e != null ? last.e : null,
        ph: samplesPh.length ? samplesPh[samplesPh.length - 1] : null, nMuestras: (h.muestras || []).length,
        viab: lv ? lv.viab : null, cons: lv ? lv.cons : null, levadura: h.levadura ? h.levadura.nombre : '', source: 'B.D FERMENTACIÓN',
      };
    }).filter((r) => okT(r.t)).sort((a, b) => a.t - b.t);
  }

  function lev() {
    return safe(() => A.BDM.registros()).map((r) => ({
      id: r.id, t: r.retiro ? +A.U.parseDT(r.retiro) : r.t0 ? +A.U.parseDT(r.t0) : null, nombre: r.nombre, brand: brandOf(r.marca), fam: r.familia, gen: r.generacion,
      viab: r.viab != null && r.viab <= 1 ? r.viab * 100 : r.viab, cons: r.cons != null && r.cons <= 1 ? r.cons * 100 : r.cons, ph: r.ph, etanol: r.etanol != null && r.etanol <= 1 ? r.etanol * 100 : r.etanol,
      vol: r.volCabeza, state: r.st, source: 'B.D LEVADURA',
    })).filter((r) => r.t != null && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  }

  const BUILDERS = { agua, aseos, merma, recuperacion, trasiego, ferm, lev };

  /* ---------- Caché corta: se invalida al navegar o al guardar ---------- */
  const cache = new Map();
  function get(name) {
    const hit = cache.get(name);
    if (hit && Date.now() - hit.at < 4000) return hit.rows;
    const rows = safe(BUILDERS[name]);
    cache.set(name, { at: Date.now(), rows });
    return rows;
  }
  const invalidate = () => cache.clear();
  /** Variantes de marca tal como llegan en los datos → marca unificada (para la pantalla de equivalencias). */
  function marcasVistas() {
    SEEN.clear(); cache.clear();
    Object.keys(BUILDERS).forEach((n) => get(n));
    const custom = (A.S && A.S.config && A.S.config.brandAliases) || {};
    return [...SEEN.entries()].map(([raw, n]) => ({ raw, n, canon: custom[raw] || ALIAS[raw] || raw, manual: !!custom[raw] })).sort((a, b) => b.n - a.n);
  }
  window.addEventListener('hashchange', invalidate);

  /* ---------- Consulta genérica ---------- */
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const pad = (n) => String(n).padStart(2, '0');
  function periodKey(t, by) {
    const d = new Date(t);
    if (by === 'day') return { k: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, t: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() };
    if (by === 'week') {
      const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dow = (m.getDay() + 6) % 7; m.setDate(m.getDate() - dow);
      const jan1 = new Date(m.getFullYear(), 0, 1);
      const wk = Math.floor((m - jan1) / 604800000) + 1;
      return { k: `${m.getFullYear()}-W${pad(wk)}`, label: `S${wk}`, t: m.getTime() };
    }
    if (by === 'year') return { k: String(d.getFullYear()), label: String(d.getFullYear()), t: new Date(d.getFullYear(), 0, 1).getTime() };
    return { k: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, t: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
  }
  const AGG = {
    sum: (v) => sum(v), mean: (v) => (v.length ? sum(v) / v.length : null), count: (v) => v.length,
    min: (v) => (v.length ? Math.min(...v) : null), max: (v) => (v.length ? Math.max(...v) : null),
    median: (v) => { if (!v.length) return null; const a = [...v].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; },
  };
  function filterRows(rows, f = {}) {
    return rows.filter((r) => {
      if (f.from != null && (r.t == null || r.t < f.from)) return false;
      if (f.to != null && (r.t == null || r.t > f.to)) return false;
      if (f.brand && f.brand !== 'Todas' && r.brand !== f.brand) return false;
      if (f.where && !f.where(r)) return false;
      for (const [k, v] of Object.entries(f.eq || {})) if (String(r[k]) !== String(v)) return false;
      return true;
    });
  }
  /**
   * query({dataset, metric, agg:'sum|mean|median|min|max|count', by:'day|week|month|year|<campo categórico>'|null, from, to, brand, eq, where, limit, sort})
   * → { dataset, field, agg, by, rows:[{k,label,t,v,n}], total, n, overall }
   */
  function query(q) {
    const meta = META[q.dataset];
    if (!meta) return null;
    const field = meta.fields.find((f) => f.key === (q.metric || meta.defaultMetric)) || null;
    const base = filterRows(get(q.dataset), q);
    const agg = q.agg || (field && field.kind === 'num' ? 'mean' : 'count');
    const val = (r) => (field && field.kind === 'num' ? N(r[field.key]) : 1);
    const by = q.by === undefined ? meta.defaultBy : q.by;
    const out = { dataset: q.dataset, field, agg, by, n: base.length, rows: [] };
    const pick = (rows) => AGG[agg](agg === 'count' ? rows : rows.map(val).filter((x) => x != null));
    out.overall = pick(base);
    if (!by) return out;
    const groups = new Map();
    const isTime = ['day', 'week', 'month', 'year'].includes(by);
    for (const r of base) {
      if (isTime && r.t == null) continue;
      const g = isTime ? periodKey(r.t, by) : { k: String(r[by] == null || r[by] === '' ? '(sin dato)' : r[by]), label: String(r[by] == null || r[by] === '' ? '(sin dato)' : r[by]), t: null };
      if (!groups.has(g.k)) groups.set(g.k, Object.assign({ rows: [] }, g));
      groups.get(g.k).rows.push(r);
    }
    out.rows = [...groups.values()].map((g) => ({ k: g.k, label: g.label, t: g.t, v: pick(g.rows), n: g.rows.length }));
    if (isTime) out.rows.sort((a, b) => a.t - b.t);
    else out.rows.sort((a, b) => (q.sort === 'asc' ? 1 : -1) * ((a.v || 0) - (b.v || 0)));
    if (q.limit) out.rows = out.rows.slice(0, q.limit);
    return out;
  }

  /* ---------- Catálogo y utilidades ---------- */
  const catalog = () => Object.entries(META).map(([key, m]) => ({ key, label: m.label, desc: m.desc, fields: m.fields, n: get(key).length }));
  function extent(name) {
    // Las filas de plantilla vacías (p. ej. turnos futuros del Excel de agua) no cuentan como «último dato».
    const ts = get(name).filter((r) => r.valid !== false).map((r) => r.t).filter((t) => t != null);
    return ts.length ? { from: Math.min(...ts), to: Math.max(...ts), n: ts.length } : null;
  }
  const brands = () => [...new Set(['ferm', 'merma', 'recuperacion', 'trasiego', 'lev'].flatMap((n) => get(n).map((r) => r.brand)).filter(Boolean))].sort();
  const fieldOf = (dataset, key) => (META[dataset] ? META[dataset].fields.find((f) => f.key === key) : null);
  const numericFields = (dataset) => (META[dataset] ? META[dataset].fields.filter((f) => f.kind === 'num') : []);

  A.DL = {
    META, get, invalidate, marcasVistas, query, catalog, extent, brands, fieldOf, numericFields, filterRows, periodKey, N, sum, time, brandOf, MONTHS,
    agua: () => get('agua'), aseos: () => get('aseos'), merma: () => get('merma'), recuperacion: () => get('recuperacion'),
    trasiego: () => get('trasiego'), ferm: () => get('ferm'), lev: () => get('lev'),
  };
})();
