/* ============================================================
   41-an-resumen.js · Resumen ejecutivo + utilidades compartidas del analista (App.An1)
   App.An1 reúne lo que usan las pestañas 41-47: límites plausibles, filas «limpias», memoria de cálculos,
   agrupación por periodo, redacción de resultados estadísticos y tarjetas KPI.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.Analisis || !A.Stats || !A.Charts || !A.DL) return;
  const S = A.Stats, C = A.Charts, AN = A.Analisis;
  const { fmt, fmtPct, fmtP, fmtDate, esc, iso } = AN;
  const DAY = 86400000;
  const An1 = (A.An1 = A.An1 || {});

  /* ---------- Números y listas ---------- */
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const vals = (rows, k) => rows.map((r) => (typeof k === 'function' ? k(r) : r[k])).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const sum = (xs) => S.sum(xs) || 0;
  const mean = (xs) => S.mean(xs);
  const med = (xs) => S.median(xs);
  const rel = (a, b) => (a == null || b == null || !b ? null : ((a - b) / Math.abs(b)) * 100);
  const wpct = (rows, num, den) => { const d = sum(vals(rows, den)); return d > 0 ? (sum(vals(rows, num)) / d) * 100 : null; };
  Object.assign(An1, { fin, vals, sum, mean, med, rel, wpct, DAY });

  /* ---------- Límites físicos plausibles por campo (fuera de ellos el dato se considera error de captura) ---------- */
  const LIM = {
    agua: { pisos: [0, 400], cip: [0, 400], gea: [0, 400], total: [0.5, 400], aseos: [0, 30], production: [0, 20000], transfer: [0, 10000] },
    aseos: { m3: [0, 100], flow: [0, 2000], minutes: [0, 1440], ph: [0, 14], durMin: [0, 4320] },
    merma: { input: [500, 8000], lossPct: [-50, 60], purges: [0, 500] },
    recuperacion: { yeast: [0, 1000], waterHl: [0, 1000], volume: [0, 1000], yieldPct: [0, 110], hours: [0, 200], ph: [3, 7], temp: [-2, 15] },
    trasiego: { duration: [0, 72], delay: [-72, 240] },
    ferm: { eo: [8, 25], e72: [0, 25], h75: [10, 400], h15: [1, 150], rata: [0.001, 1], vol: [500, 8000], tll: [0.2, 48], atten: [60, 95], rdf: [0, 8], ph: [3.5, 6], viab: [50, 100], cons: [10, 100], gen: [0, 15] },
    lev: { viab: [50, 100], cons: [10, 100], ph: [3, 7], gen: [0, 15], vol: [0, 500], etanol: [0, 20] },
  };
  An1.LIM = LIM;
  const outOf = (ds, k, v) => { const l = LIM[ds] && LIM[ds][k]; return !!l && v != null && Number.isFinite(v) && (v < l[0] || v > l[1]); };
  An1.fueraDeRango = outOf;
  const SANE = new WeakMap();
  /** Copia de las filas con los valores imposibles puestos en blanco (no modifica App.DL). */
  An1.sane = (ds, rows) => rows.map((r) => {
    let s = SANE.get(r);
    if (s) return s;
    s = Object.assign({}, r);
    const l = LIM[ds] || {};
    for (const k of Object.keys(l)) if (s[k] != null && outOf(ds, k, s[k])) s[k] = null;
    if (ds === 'agua') {
      const hl = (s.production || 0) + (s.transfer || 0);
      s.hl = hl > 0 ? hl : null;
      s.hlPerHl = s.total != null && hl > 0 ? (s.total * 10) / hl : null;
      s.m3PerAseo = s.total != null && s.aseos > 0 ? s.total / s.aseos : null;
    }
    if (ds === 'ferm' && s.atten != null && s.rdf != null && s.atten < 60) s.rdf = null;
    SANE.set(r, s);
    return s;
  });

  /* ---------- Memoria de cálculos por (periodo, marcas, comparación, datos, metas) ---------- */
  const MEMO = new Map();
  const dsig = () => ['agua', 'aseos', 'merma', 'recuperacion', 'trasiego', 'ferm', 'lev'].map((d) => { const x = A.DL.get(d); return x.length + ':' + (x.length ? x[x.length - 1].t : 0); }).join(',');
  const msig = () => { try { return JSON.stringify((A.S && A.S.config && A.S.config.cifraMetas) || {}); } catch (e) { return ''; } };
  An1.memo = (ctx, name, fn) => {
    const k = [name, ctx.rango.from, ctx.rango.to, ctx.estado.brands.join('|'), ctx.estado.comparar ? 1 : 0, dsig(), msig()].join('#');
    if (MEMO.has(k)) return MEMO.get(k);
    const v = fn();
    MEMO.set(k, v);
    if (MEMO.size > 120) MEMO.delete(MEMO.keys().next().value);
    return v;
  };

  /* ---------- Periodos ---------- */
  An1.autoBy = (ctx) => (ctx.rango.dias <= 45 ? 'day' : ctx.rango.dias <= 200 ? 'week' : 'month');
  An1.porPeriodo = (rows, by) => {
    const m = new Map();
    for (const r of rows) {
      if (r.t == null) continue;
      const g = A.DL.periodKey(r.t, by);
      let e = m.get(g.k);
      if (!e) { e = { k: g.k, label: g.label, t: g.t, rows: [] }; m.set(g.k, e); }
      e.rows.push(r);
    }
    return [...m.values()].sort((a, b) => a.t - b.t);
  };
  const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  An1.dow = DOW;
  /** Quita el último periodo (semana/mes) si quedó a medias, para que no distorsione la tendencia. */
  An1.recorta = (per, by) => {
    if (by === 'day' || per.length < 4) return per;
    const n = per.slice(0, -1).map((p) => p.rows.length).sort((a, b) => a - b), mdn = n[n.length >> 1];
    return per[per.length - 1].rows.length < 0.5 * mdn ? per.slice(0, -1) : per;
  };
  An1.periodoTxt = (by) => (by === 'day' ? 'día' : by === 'week' ? 'semana' : 'mes');
  An1.srcRange = (rows) => {
    const nums = rows.map((r) => { const m = /fila (\d+)/.exec(r.source || ''); return m ? +m[1] : null; }).filter((x) => x != null);
    const first = rows.find((r) => r.source);
    if (!first) return 'Datos de la plataforma';
    const base = String(first.source).replace(/ · fila.*$/, '');
    return nums.length ? `${base} · filas ${Math.min(...nums)}–${Math.max(...nums)}` : base;
  };

  /* ---------- Redacción de resultados estadísticos ---------- */
  const pTxt = (p) => (p == null ? '' : p < 0.001 ? 'p < 0,001' : 'p = ' + fmtP(p));
  An1.pTxt = pTxt;
  /** «diferencia real, no azar» / «puede ser casualidad» */
  An1.sig = (p, alfa = 0.05) => (p == null ? { ok: null, txt: 'no hay datos suficientes para saber si es real', frase: 'no hay datos suficientes para saber si la diferencia es real' }
    : p < alfa ? { ok: true, txt: `diferencia real, no azar (${pTxt(p)})`, frase: `la diferencia es real, no azar (${pTxt(p)})` } : { ok: false, txt: `puede ser casualidad (${pTxt(p)})`, frase: `la diferencia puede ser casualidad (${pTxt(p)})` });
  /** Resultado de comparar grupos: manda Kruskal-Wallis (robusta a lotes extremos) y se avisa si el ANOVA discrepa. */
  An1.difGrupos = (c) => {
    if (!c) return null;
    const k = c.kruskal, a = c.anova, p = k ? k.p : a ? a.p : c.p, s = An1.sig(p);
    const det = k && a && (a.p < 0.05) !== (k.p < 0.05) ? ` (el ANOVA clásico da ${pTxt(a.p)}; se prefiere Kruskal-Wallis porque no se deja llevar por datos extremos)` : '';
    return { p, ok: s.ok, frase: s.frase + det, txt: s.txt, test: k ? 'Kruskal-Wallis' : a ? 'ANOVA' : 't de Welch' };
  };
  An1.wins = (v, lo = 0.05, hi = 0.95) => { const a = S.quantile(v, lo), b = S.quantile(v, hi); return v.map((x) => Math.min(b, Math.max(a, x))); };
  /** Datos de caja con los valores extremos fuera de [lo, hi] sin dibujar (para que la caja se pueda leer). */
  An1.boxData = (label, values, lo, hi) => {
    const b = S.boxStats(values); if (!b) return null;
    const out = b.outliers.filter((x) => x >= lo && x <= hi);
    return { label, q1: b.q1, med: b.med, q3: b.q3, lo: b.lo, hi: b.hi, outliers: out, n: b.n, ocultos: b.outliers.length - out.length };
  };
  An1.fuerza = (r) => { const s = S.strength(r); return s === 'nula' ? 'casi nula' : s; };
  An1.trend = (values, { unit = '', dec = 2, porPeriodo = 'periodo' } = {}) => {
    const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
    const mk = S.mannKendall(v);
    if (!mk) return { txt: 'Hay muy pocos periodos para hablar de tendencia.', dir: 0, p: null };
    const sen = S.senSlope(v);
    if (mk.p < 0.05) return { txt: `Tendencia ${mk.trend === 'sube' ? 'al alza' : 'a la baja'} sostenida (${pTxt(mk.p)}): cambia cerca de ${fmt(Math.abs(sen), dec)} ${unit} por ${porPeriodo}.`, dir: mk.trend === 'sube' ? 1 : -1, p: mk.p, sen };
    return { txt: `Sin tendencia clara (${pTxt(mk.p)}): lo que se ve es variación normal.`, dir: 0, p: mk.p, sen };
  };
  An1.cmpTxt = (cur, prev, { unit = '', dec = 1, bueno = 'baja', nombre = 'el periodo anterior', pp = false } = {}) => {
    if (cur == null || prev == null) return '';
    if (pp) {
      const d = cur - prev, up = d > 0;
      if (Math.abs(d) < 0.05) return `Igual que ${nombre} (${fmt(prev, dec)} ${unit}).`;
      return `${up ? 'Subió' : 'Bajó'} ${fmt(Math.abs(d), 2)} puntos frente a ${nombre} (${fmt(prev, dec)} ${unit}), ${(bueno === 'baja') === !up ? 'a favor' : 'en contra'}.`;
    }
    if (!prev) return '';
    const d = rel(cur, prev), up = d > 0;
    if (Math.abs(d) < 0.5) return `Igual que ${nombre} (${fmt(prev, dec)}${unit ? ' ' + unit : ''}).`;
    const good = (bueno === 'baja') === !up;
    return `${up ? 'Subió' : 'Bajó'} ${fmt(Math.abs(d), 1)} % frente a ${nombre} (${fmt(prev, dec)}${unit ? ' ' + unit : ''}), ${good ? 'a favor' : 'en contra'}.`;
  };
  An1.marcaTxt = (ctx) => (ctx.filtraMarca ? 'la marca ' + ctx.marcas.join(', ') : 'todas las marcas');

  /* ---------- Piezas de interfaz ---------- */
  // En pantallas angostas las gráficas se dibujan más pequeñas para que el texto siga legible.
  An1.W = { get full() { return window.innerWidth < 700 ? 400 : 1120; }, get half() { return window.innerWidth < 700 ? 400 : 620; }, get third() { return 400; } };
  /** Gráfica + «Cómo leerlo» dentro de una tarjeta. */
  An1.tarjeta = (UI, titulo, sub, chart, lectura, o = {}) => UI.card(titulo, sub, `${chart || ''}${lectura ? UI.lectura(lectura, o.tono) : ''}${o.extra || ''}`, o);
  An1.kpi = (o) => {
    let delta = '';
    if (o.v != null && o.p != null && Number.isFinite(o.v) && Number.isFinite(o.p)) {
      if (o.pp) { const d = o.v - o.p; if (Math.abs(d) >= 0.05) delta = (d > 0 ? '+' : '−') + fmt(Math.abs(d), 1) + ' pp'; }
      else if (o.abs) { const d = o.v - o.p; if (Math.abs(d) >= 0.05) delta = (d > 0 ? '+' : '−') + fmt(Math.abs(d), 1) + ' ' + (o.unit || ''); }
      else if (o.p !== 0) { const d = Math.round(rel(o.v, o.p) * 10) / 10; delta = d; }
    }
    const vs = o.v == null ? '—' : fmt(o.v, o.dec == null ? 1 : o.dec);
    const inner = C.kpi({ label: o.label, value: /^[\d.]+$/.test(vs) ? vs + '\u200b' : vs, unit: o.unit, delta, deltaGood: o.bueno === 'sube' ? 'up' : 'down', spark: o.spark, help: o.help });
    return o.tab ? `<a class="an-kpi-a" href="#/analisis/${o.tab}">${inner}</a>` : inner;
  };
  An1.sev = (alta, media) => (alta ? 'alta' : media ? 'media' : 'info');
  An1.chips = (items) => `<div class="an-chiplist">${items.map((t) => `<span class="an-badge ${t[1] || ''}">${esc(t[0])}</span>`).join('')}</div>`;
  An1.stat = (label, value, sub, tono) => `<div class="an-stat ${tono ? 't-' + tono : ''}"><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  An1.stats = (items) => `<div class="an-stats">${items.join('')}</div>`;
  An1.metodo = (titulo, html) => `<details class="an-metodo"><summary>${esc(titulo)}</summary><div>${html}</div></details>`;
  An1.sinDatos = (UI, titulo, msg) => UI.card(titulo, '', UI.vacio(msg));
  /** Serie de puntos {x,y} para App.Charts.line (eje de tiempo). */
  An1.pts = (periods, fn) => periods.map((p) => ({ x: p.t, y: fin(fn(p)) }));
  An1.fechaIso = (t) => (t == null ? '' : iso(t));
  An1.fecha = (t) => (t == null ? '—' : fmtDate(t));
  An1.round = (v, d = 2) => { if (v == null || !Number.isFinite(v)) return null; const r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d); return r === 0 ? 0 : r; };
  /** Columna de fecha para tablas: ordena por ISO y muestra «12 mar 2026». */
  An1.colFecha = (k = 'fecha', t = 'Fecha') => ({ k, t, f: (v) => esc(v ? fmtDate(new Date(v + 'T12:00:00').getTime()) : '—') });
  An1.colNum = (k, t, d = 1) => ({ k, t, num: true, f: (v) => (v == null ? '—' : fmt(v, d)) });
  An1.colFuente = () => ({ k: 'source', t: 'Fuente', f: (v) => `<span class="an-src">${esc(v || '')}</span>` });
  An1.badgeCol = (k, t, tonos = {}) => ({ k, t, f: (v) => (v ? `<span class="an-badge ${tonos[v] || ''}">${esc(v)}</span>` : '') });

  /** Intervalo de confianza 95 % de una media (t de Student). */
  An1.ci = (xs) => {
    const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)), n = v.length;
    if (n < 2) return null;
    const m = mean(v), se = S.sd(v) / Math.sqrt(n), t = S.tInv(0.975, n - 1);
    return [m - t * se, m + t * se];
  };

  /* ---------- Cobertura por dataset (usada en Resumen y Calidad) ---------- */
  const DS_INFO = {
    agua: { label: 'Agua', clave: ['total', 'production', 'transfer'], ruta: '#/agua' },
    aseos: { label: 'Aseos', clave: ['flow', 'minutes', 'ph'], ruta: '#/aseos' },
    merma: { label: 'Merma', clave: ['input', 'loss', 'purges'], ruta: '#/merma' },
    recuperacion: { label: 'Recuperación', clave: ['yeast', 'volume', 'hours'], ruta: '#/recuperacion' },
    trasiego: { label: 'Trasiego', clave: ['duration', 'delay'], ruta: '#/programa' },
    ferm: { label: 'Fermentación', clave: ['eo', 'h75', 'h15', 'viab'], ruta: '#/bd' },
    lev: { label: 'Levadura', clave: ['viab', 'cons', 'ph'], ruta: '#/levaduras' },
  };
  An1.DS_INFO = DS_INFO;
  An1.hoy = () => { const t = Date.now(); return t; };
  An1.cobertura = (ds) => {
    const info = DS_INFO[ds], rows = A.DL.get(ds), now = Date.now();
    const past = rows.filter((r) => r.t <= now + DAY);
    const last = past.length ? Math.max(...past.map((r) => r.t)) : null;
    const comp = rows.filter((r) => info.clave.every((k) => r[k] != null && !outOf(ds, k, r[k]))).length;
    return { ds, label: info.label, n: rows.length, last, dias: last ? Math.floor((now - last) / DAY) : null, completo: rows.length ? (comp / rows.length) * 100 : null, ruta: info.ruta };
  };

  /* ---------- KPIs y gráficas panorámicas del Resumen ---------- */
  function recupR(ctx) {
    return An1.memo(ctx, 'recup', () => {
      const rows = An1.sane('recuperacion', ctx.rows('recuperacion')), prev = An1.sane('recuperacion', ctx.previas('recuperacion'));
      const by = An1.autoBy(ctx), per = An1.porPeriodo(rows, by);
      return { rows, prev, n: rows.length, hl: sum(vals(rows, 'volume')), hlPrev: prev.length ? sum(vals(prev, 'volume')) : null, rend: wpct(rows.filter((r) => r.volume != null && r.yeast > 0), 'volume', 'yeast'), rendPrev: prev.length ? wpct(prev.filter((r) => r.volume != null && r.yeast > 0), 'volume', 'yeast') : null,
        per, by, spark: per.map((p) => sum(vals(p.rows, 'volume'))) };
    });
  }
  function trasR(ctx) {
    return An1.memo(ctx, 'tras', () => {
      const rows = An1.sane('trasiego', ctx.rows('trasiego')), prev = An1.sane('trasiego', ctx.previas('trasiego'));
      const d = vals(rows, 'delay'), dp = vals(prev, 'delay');
      const by = An1.autoBy(ctx), per = An1.porPeriodo(rows, by);
      return { rows, prev, n: d.length, med: med(d), medPrev: dp.length ? med(dp) : null, enPlazo: d.length ? (d.filter((x) => x <= (ctx.metas.get('trasiego.desvioMaxH', 1))).length / d.length) * 100 : null,
        per, by, spark: per.map((p) => med(vals(p.rows, 'delay'))) };
    });
  }
  function aseosR(ctx) {
    return An1.memo(ctx, 'aseosR', () => {
      const rows = An1.sane('aseos', ctx.rows('aseos')), prev = An1.sane('aseos', ctx.previas('aseos'));
      const ok = (rs) => { const p = rs.filter((r) => r.ph != null && r.ph >= 3 && r.ph <= 11); return p.length ? (p.filter((r) => r.ph >= ctx.metas.get('aseos.phMin', 6) && r.ph <= ctx.metas.get('aseos.phMax', 8)).length / p.length) * 100 : null; };
      const by = An1.autoBy(ctx), per = An1.porPeriodo(rows, by);
      return { rows, n: rows.length, cumple: ok(rows), cumplePrev: ok(prev), spark: per.map((p) => ok(p.rows)).filter((x) => x != null) };
    });
  }
  An1.recupR = recupR; An1.trasR = trasR; An1.aseosR = aseosR;

  /** Datos de los indicadores clave (los usa el Resumen y el Informe). */
  function kpiData(ctx) {
    const out = [];
    const add = (o) => out.push(o);
    try { if (An1.aguaR) { const R = An1.aguaR(ctx); if (R.n) {
      add({ tab: 'agua', label: 'Agua por turno', unit: 'm³/turno', v: R.mean, p: R.prevMean, dec: 1, bueno: 'baja', spark: R.spark, help: `${R.n} turnos medidos` });
      add({ tab: 'agua', label: 'Agua por Hl procesado', unit: 'Hl/Hl', v: R.eff.actual, p: R.eff.previo, dec: 3, bueno: 'baja', spark: R.eff.spark, help: 'Cuánta agua se gasta por cada Hl trasegado o recibido' });
    } } } catch (e) { warn('kpi agua', e); }
    try { if (An1.mermaR) { const R = An1.mermaR(ctx); for (const ph of ['FV', 'SV']) { const q = R.fase[ph]; if (q && q.n) add({ tab: 'merma', label: 'Merma ' + ph, unit: '%', v: q.tasa, p: q.tasaPrev, dec: 2, bueno: 'baja', pp: true, spark: q.spark, help: `${q.n} lotes cerrados · ponderada por volumen` }); } } } catch (e) { warn('kpi merma', e); }
    try { if (An1.fermR) { const R = An1.fermR(ctx); if (R.n && R.h75.med != null) add({ tab: 'fermentacion', label: 'Tiempo a 75 % de atenuación', unit: 'h', v: R.h75.med, p: R.h75.medPrev, dec: 1, bueno: 'baja', spark: R.h75.spark, help: `Mediana de ${R.h75.n} fermentaciones` }); } } catch (e) { warn('kpi ferm', e); }
    try { if (An1.levR) { const R = An1.levR(ctx); if (R.n) add({ tab: 'levadura', label: 'Viabilidad de levadura', unit: '%', v: R.viab.mean, p: R.viab.prev, dec: 1, bueno: 'sube', pp: true, spark: R.viab.spark, help: `${R.n} cosechas · meta ≥ ${fmt(R.meta, 0)} %` }); } } catch (e) { warn('kpi lev', e); }
    const rc = recupR(ctx); if (rc.n) add({ tab: 'recuperacion', label: 'Cerveza recuperada', unit: 'Hl', v: rc.hl, p: rc.hlPrev, dec: 0, bueno: 'sube', spark: rc.spark, help: `${rc.n} recuperaciones${rc.rend != null ? ' · rinde ' + fmt(rc.rend, 0) + ' % de la levadura' : ''}` });
    const tr = trasR(ctx); if (tr.n) add({ tab: 'operacion', label: 'Desvío de trasiego', unit: 'h', v: tr.med, p: tr.medPrev, dec: 1, bueno: 'baja', abs: true, spark: tr.spark, help: `Mediana frente al plan · ${tr.n} actividades` });
    const as = aseosR(ctx); if (as.cumple != null) add({ tab: 'operacion', label: 'Aseos con pH en rango', unit: '%', v: as.cumple, p: as.cumplePrev, dec: 0, bueno: 'sube', pp: true, spark: as.spark, help: `${as.n} aseos · pH ${fmt(ctx.metas.get('aseos.phMin', 6), 0)}–${fmt(ctx.metas.get('aseos.phMax', 8), 0)}` });
    return out;
  }
  An1.kpiData = kpiData;
  const kpiList = (ctx) => kpiData(ctx).map((o) => An1.kpi(o));
  /** Estado de un indicador frente al periodo anterior: 'mejor' | 'peor' | 'igual' | null. */
  An1.kpiEstado = (o) => {
    if (o.v == null || o.p == null) return null;
    const d = o.v - o.p, tol = o.pp || o.abs ? 0.05 : Math.abs(o.p) * 0.005;
    if (Math.abs(d) <= tol) return 'igual';
    return (d > 0) === (o.bueno === 'sube') ? 'mejor' : 'peor';
  };
  function warn(w, e) { if (window.console) console.warn('[An1]', w, e); }

  function miniRecup(ctx) {
    const R = recupR(ctx);
    if (!R.per.length) return null;
    return C.bars({ title: 'Cerveza recuperada', subtitle: `Hl por ${An1.periodoTxt(R.by)}`, unit: 'Hl', w: An1.W.half, h: 260, data: R.per.map((p) => ({ label: p.label, value: sum(vals(p.rows, 'volume')) })) });
  }
  function miniTras(ctx) {
    const R = trasR(ctx);
    const pts = R.per.map((p) => ({ x: p.t, y: fin(med(vals(p.rows, 'delay'))) })).filter((p) => p.y != null);
    if (pts.length < 2) return null;
    return C.line({ title: 'Desvío de trasiego frente al plan', subtitle: `Mediana en horas por ${An1.periodoTxt(R.by)} (positivo = tarde)`, unit: 'h', xType: 'time', w: An1.W.half, h: 260, series: [{ name: 'Desvío', points: pts }], refs: [{ y: 0, label: 'Según plan', dashed: false }] });
  }

  /* ---------- Hallazgos ---------- */
  const SEV_TXT = { alta: 'Alta', media: 'Media', info: 'Informativo', ok: 'Bien' };
  An1.hallazgoHtml = (h) => `<a class="an-h ${h.sev}" href="#/analisis/${h.tab}"><i></i><div><b>${esc(h.titulo)}</b><span>${esc(h.detalle || '')}</span></div><em>${esc(h.area || '')}${h.valor ? ' · ' + esc(h.valor) : ''}</em></a>`;
  An1.SEV_TXT = SEV_TXT;
  function atencion(ctx) {
    const hs = AN.hallazgos(ctx);
    if (!hs.length) return `<div class="an-empty"><b>Nada que reportar</b><span>No hay hallazgos con los datos y el periodo elegidos.</span></div>`;
    const prim = hs.filter((h) => h.sev === 'alta' || h.sev === 'media').slice(0, 10), resto = hs.filter((h) => !prim.includes(h));
    return `<div class="an-hallazgos">${(prim.length ? prim : hs.slice(0, 4)).map(An1.hallazgoHtml).join('')}</div>` +
      (resto.length && prim.length ? `<details class="an-mas"><summary>Ver ${resto.length} más (informativos y puntos en verde)</summary><div class="an-hallazgos">${resto.map(An1.hallazgoHtml).join('')}</div></details>` : '');
  }

  /* ---------- Cobertura visible ---------- */
  function coberturaHtml(ctx) {
    const items = Object.keys(DS_INFO).map((ds) => {
      const c = An1.cobertura(ds), enPer = ctx.rows(ds).length;
      const stale = c.dias != null && c.dias > 14 && ds !== 'aseos';
      const tono = !c.n ? 't-bad' : stale || (c.completo != null && c.completo < 60) ? 't-warn' : 't-ok';
      return `<a class="an-cob-i ${tono}" href="#/analisis/calidad" title="Ver detalle en Calidad de datos"><span>${esc(c.label)}</span><b>${fmt(enPer, 0)}<small> en el periodo</small></b>
        <div class="an-bar"><i style="width:${Math.max(2, Math.min(100, c.completo || 0))}%"></i></div>
        <em>${c.completo != null ? fmt(c.completo, 0) + ' % completos' : 'sin datos'} · ${c.last ? 'último dato ' + fmtDate(c.last) : '—'}</em></a>`;
    });
    return `<div class="an-cob">${items.join('')}</div>`;
  }

  /* ---------- Lectura del periodo (texto) ---------- */
  function lecturaGeneral(ctx, hs) {
    const alta = hs.filter((h) => h.sev === 'alta').length, media = hs.filter((h) => h.sev === 'media').length, ok = hs.filter((h) => h.sev === 'ok').length;
    const partes = [];
    partes.push(`En ${ctx.rango.dias} días (${ctx.etiquetaPeriodo}) y para ${An1.marcaTxt(ctx)}`);
    if (alta + media) partes.push(`el análisis automático encontró ${alta} punto${alta === 1 ? '' : 's'} de atención alta y ${media} de atención media`);
    else partes.push('el análisis automático no encontró puntos de atención');
    if (ok) partes.push(`y ${ok} indicador${ok === 1 ? '' : 'es'} que mejoraron o cumplen la meta`);
    return partes.join(', ') + '.';
  }

  /* ---------- Pestaña ---------- */
  AN.registrar({
    id: 'resumen', label: 'Resumen ejecutivo', orden: 1,
    render(ctx, UI) {
      const kpis = kpiList(ctx);
      const hs = AN.hallazgos(ctx);
      const minis = [];
      for (const [k, fn] of [['agua', () => An1.mini && An1.mini.agua && An1.mini.agua(ctx)], ['merma', () => An1.mini && An1.mini.merma && An1.mini.merma(ctx)], ['ferm', () => An1.mini && An1.mini.ferm && An1.mini.ferm(ctx)], ['lev', () => An1.mini && An1.mini.lev && An1.mini.lev(ctx)], ['recup', () => miniRecup(ctx)], ['tras', () => miniTras(ctx)]]) {
        let h = null;
        try { h = fn(); } catch (e) { warn('mini ' + k, e); }
        if (h) minis.push(`<div class="an-card an-mini">${h}</div>`);
      }
      return `
        <section class="an-card an-lead"><p>${esc(lecturaGeneral(ctx, hs))}</p></section>
        ${UI.card('Indicadores clave', `Cada tarjeta compara este periodo con el anterior. Verde = cambio a favor, rojo = en contra. Toca una tarjeta para ver el análisis completo.`,
          kpis.length ? `<div class="an-kpis">${kpis.join('')}</div>` : UI.vacio('No hay datos en este periodo. Prueba con «Todo el histórico».'))}
        ${UI.card('Qué requiere atención', 'Lo más importante que detectó el análisis, ordenado por gravedad. Toca un punto para ir a su explicación.', atencion(ctx))}
        ${UI.card('Panorama del periodo', 'Las curvas principales de la planta en un vistazo.', minis.length ? `<div class="an-grid an-g2">${minis.join('')}</div>` : UI.vacio('Sin series para graficar en este periodo.'))}
        ${UI.card('Cobertura de los datos', 'Qué tan completos y recientes están los datos que alimentan el análisis. Si una barra es corta, los resultados de esa área son menos confiables.', coberturaHtml(ctx))}`;
    },
    hallazgos(ctx) {
      // Aviso general: datos viejos (el detalle por dataset está en «Calidad de datos»)
      const out = [];
      for (const ds of ['agua', 'merma', 'ferm', 'lev']) {
        const c = An1.cobertura(ds);
        if (c.n && c.dias != null && c.dias > 21) out.push({ sev: 'media', tab: 'calidad', area: 'Datos', titulo: `${DS_INFO[ds].label}: sin datos nuevos hace ${c.dias} días`, detalle: `El último registro es del ${fmtDate(c.last)}. Los análisis de ${DS_INFO[ds].label.toLowerCase()} pueden estar desactualizados.` });
      }
      return out;
    },
  });
})();
