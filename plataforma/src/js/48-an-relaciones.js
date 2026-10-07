/* ============================================================
   Análisis · Relaciones
   Cruza dominios (agua, aseos, merma, recuperación, trasiego, fermentación y levadura) alineándolos por semana ISO
   (o por mes) y mide qué tanto se mueven juntos. Correlación NO es causa: aquí se explica con honestidad.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.Analisis || !A.AnX) return;
  const X = A.AnX, S = X.S, C = X.C, AN = A.Analisis, ok = X.ok, esc = X.esc, f = X.f, fP = X.fP;
  const DAY = 86400000;
  const st = { ventana: 'auto', metodo: 'pearson', ax: 'agua:production', ay: 'agua:total', fx: 'auto', fy: 'auto', por: 'week', gds: 'ferm', gm: 'atten', gby: 'brand', top: 12 };

  /* ---------- Métricas semanales cruzadas ---------- */
  const lim = (lo, hi) => (r, k) => r[k] != null && r[k] >= lo && r[k] <= hi;
  const METS = [
    { k: 'aguaTotal', s: 'Agua total', l: 'Agua total', u: 'm³', ds: 'agua', v: 'total', fn: 'sum', minN: 14 },
    { k: 'hlProc', s: 'Hl mosto', l: 'Hl de mosto procesado', u: 'Hl', ds: 'agua', v: 'production', fn: 'sum', minN: 14 },
    { k: 'trasegado', s: 'Hl trasegado', l: 'Hl trasegado', u: 'Hl', ds: 'agua', v: 'transfer', fn: 'sum', minN: 14 },
    { k: 'aseosAgua', s: 'N.º aseos (turnos)', l: 'N.º de aseos (conteo por turno)', u: '', ds: 'agua', v: 'aseos', fn: 'sum', minN: 14 },
    { k: 'm3AseoAgua', s: 'm³/aseo (turnos)', l: 'm³ de agua por aseo (turnos)', u: 'm³', ds: 'agua', v: 'm3PerAseo', fn: 'mean', comp: ['aguaTotal', 'aseosAgua'] },
    { k: 'hlPorHl', s: 'Agua por Hl', l: 'Agua por Hl procesado', u: '', ds: 'agua', v: 'hlPerHl', fn: 'mean', comp: ['aguaTotal', 'hlProc', 'trasegado'] },
    { k: 'aseosN', s: 'Aseos registrados', l: 'Aseos registrados', u: '', ds: 'aseos', v: 'm3', fn: 'count' },
    { k: 'aseoM3', s: 'm³/aseo (CIP)', l: 'm³ por aseo (CIP)', u: 'm³', ds: 'aseos', v: 'm3', fn: 'mean' },
    { k: 'aseoPh', s: 'pH enjuague', l: 'pH de enjuague', u: '', ds: 'aseos', v: 'ph', fn: 'mean', pre: (r) => r.ph >= 3 && r.ph <= 11 },
    { k: 'mermaPct', s: 'Merma %', l: 'Merma (%)', u: '%', ds: 'merma', v: 'lossPct', fn: 'mean', pre: (r) => !r.flag },
    { k: 'mermaHl', comp: ['mermaPct'], s: 'Merma Hl', l: 'Merma (Hl)', u: 'Hl', ds: 'merma', v: 'loss', fn: 'sum', pre: (r) => !r.flag },
    { k: 'recVol', s: 'Recuperada Hl', l: 'Cerveza recuperada', u: 'Hl', ds: 'recuperacion', v: 'volume', fn: 'sum' },
    { k: 'recH', s: 'Horas recuperar', l: 'Horas hasta recuperar', u: 'h', ds: 'recuperacion', v: 'hours', fn: 'mean' },
    { k: 'recRend', s: 'Rend. recuperación', l: 'Rendimiento de recuperación', u: '%', ds: 'recuperacion', v: 'yieldPct', fn: 'mean' },
    { k: 'recPh', s: 'pH recuperación', l: 'pH de recuperación', u: '', ds: 'recuperacion', v: 'ph', fn: 'mean', pre: (r) => r.ph > 3 && r.ph < 8 },
    { k: 'trN', s: 'Act. trasiego', l: 'Actividades de trasiego', u: '', ds: 'trasiego', v: 'duration', fn: 'count' },
    { k: 'trDelay', s: 'Desvío trasiego', l: 'Desvío del trasiego', u: 'h', ds: 'trasiego', v: 'delay', fn: 'mean' },
    { k: 'trDur', s: 'Duración trasiego', l: 'Duración del trasiego', u: 'h', ds: 'trasiego', v: 'duration', fn: 'mean', pre: (r) => r.kind === 'Trasiego' && r.duration > 0 && r.duration <= 48 },
    { k: 'fermN', s: 'Fermentaciones', l: 'Fermentaciones llenadas', u: '', ds: 'ferm', v: 'vol', fn: 'count' },
    { k: 'fermVol', comp: ['fermN'], s: 'Hl fermentados', l: 'Volumen fermentado', u: 'Hl', ds: 'ferm', v: 'vol', fn: 'sum' },
    { k: 'h75', s: 'Horas a 75 % aten.', l: 'Horas hasta 75 % de atenuación', u: 'h', ds: 'ferm', v: 'h75', fn: 'mean' },
    { k: 'e72', s: 'Extracto 72 h', l: 'Extracto a las 72 h', u: '°P', ds: 'ferm', v: 'e72', fn: 'mean' },
    { k: 'atten', s: 'Atenuación final', l: 'Atenuación final', u: '%', ds: 'ferm', v: 'atten', fn: 'mean' },
    { k: 'viabF', comp: ['viabL', 'consL'], s: 'Viab. sembrada', l: 'Viabilidad de la levadura sembrada', u: '%', ds: 'ferm', v: 'viab', fn: 'mean' },
    { k: 'viabL', s: 'Viab. cosechas', l: 'Viabilidad (cosechas)', u: '%', ds: 'lev', v: 'viab', fn: 'mean' },
    { k: 'consL', s: 'Consist. cosechas', l: 'Consistencia (cosechas)', u: '%', ds: 'lev', v: 'cons', fn: 'mean' },
  ];
  // Los contadores de mosto del Excel traen algunos valores imposibles (negativos o de millones de Hl por turno): se descartan.
  const saneAgua = (r) => (r.production == null || (r.production >= 0 && r.production <= 30000)) && (r.transfer == null || (r.transfer >= 0 && r.transfer <= 30000));
  METS.forEach((m) => { if (m.ds === 'agua' && ['production', 'transfer', 'hlPerHl'].includes(m.v)) m.pre = saneAgua; });

  const vent = (ctx) => (st.ventana === 'auto' ? (ctx.rango.dias / 7 >= 20 ? 'periodo' : 'todo') : st.ventana);
  const rowsFor = (ctx, ds) => (vent(ctx) === 'todo' ? X.todo(ctx, ds).filter((r) => r.t <= ctx.rango.to) : ctx.rows(ds));
  const winOf = (ctx) => (vent(ctx) === 'todo' ? { from: 0, to: ctx.rango.to } : { from: ctx.rango.from, to: ctx.rango.to });
  const periodoTxt = (ctx) => (vent(ctx) === 'todo' ? 'todo el histórico hasta ' + AN.fmtDate(ctx.rango.to) : 'el periodo elegido (' + ctx.etiquetaPeriodo + ')');

  function weeklyOf(ctx, m, by, win) {
    const base = rowsFor(ctx, m.ds);
    const rr = m.pre ? base.filter(m.pre) : base;
    const span = by === 'month' ? 28 * DAY : 7 * DAY;
    const ag = S.aggregate(rr, { t: 't', v: m.v, fn: m.fn, by });
    const mp = new Map();
    for (const a of ag) {
      if (a.v == null) continue;
      if (by === 'week' && (a.t < win.from - 1 || a.t + 7 * DAY - 1 > win.to)) continue; // semanas incompletas
      if (by === 'month' && (a.t < win.from - 1 || new Date(new Date(a.t).getFullYear(), new Date(a.t).getMonth() + 1, 1).getTime() - 1 > win.to)) continue;
      if (m.minN && by === 'week' && a.n < m.minN) continue;
      mp.set(a.k, a);
    }
    return mp;
  }

  const strong = (r) => X.fuerza(r);
  function bh(ps) { // ajuste Benjamini-Hochberg
    const idx = ps.map((p, i) => [p, i]).filter((x) => x[0] != null).sort((a, b) => a[0] - b[0]);
    const m = idx.length, q = new Array(ps.length).fill(null);
    let prev = 1;
    for (let i = m - 1; i >= 0; i--) { prev = Math.min(prev, (idx[i][0] * m) / (i + 1)); q[idx[i][1]] = prev; }
    return q;
  }

  function calc(ctx) {
    return X.memo(ctx, 'rel', ['agua', 'aseos', 'merma', 'recuperacion', 'trasiego', 'ferm', 'lev'], () => {
      const win = winOf(ctx);
      const series = METS.map((m) => ({ m, mp: weeklyOf(ctx, m, 'week', win) })).filter((x) => x.mp.size >= 6);
      const keys = [...new Set(series.flatMap((x) => [...x.mp.keys()]))].sort();
      const tOf = new Map(); series.forEach((x) => x.mp.forEach((a, k) => tOf.set(k, a)));
      const cols = {}, names = [];
      series.forEach((x, i) => { const nm = x.m.l; names.push(nm); cols[nm] = keys.map((k) => (x.mp.has(k) ? x.mp.get(k).v : null)); x.name = nm; x.i = i; });
      const cmP = S.corrMatrix(cols, { method: 'pearson' }), cmS = S.corrMatrix(cols, { method: 'spearman' });
      const pares = [];
      for (let i = 0; i < series.length; i++) {
        for (let j = i + 1; j < series.length; j++) {
          const a = series[i].m, b = series[j].m, n = cmP.n[i][j];
          if (n < 8) continue;
          const trivial = (a.comp && a.comp.includes(b.k)) || (b.comp && b.comp.includes(a.k));
          pares.push({ i, j, a: a.l, b: b.l, ak: a.k, bk: b.k, n, r: cmP.matrix[i][j], p: cmP.p[i][j], rs: cmS.matrix[i][j], ps: cmS.p[i][j], trivial });
        }
      }
      const real = pares.filter((p) => !p.trivial && p.r != null && p.p != null);
      const q = bh(real.map((p) => p.p));
      real.forEach((p, k) => { p.q = q[k]; });
      real.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
      return { series, keys, cmP, cmS, names, pares: real, nPares: real.length, semanas: keys.length };
    }, vent(ctx));
  }

  /* ---------- Bloques ---------- */
  function bloqueMatriz(d, ctx, UI) {
    const cm = st.metodo === 'spearman' ? d.cmS : d.cmP;
    const n = d.series.length;
    const heat = X.fig('heatmap', {
      title: `Matriz de correlación (${st.metodo === 'spearman' ? 'Spearman' : 'Pearson'}) entre métricas semanales`, w: 1000,
      rows: d.series.map((x, i) => `${i + 1} · ${x.m.s}`), cols: d.names.map((nm, i) => String(i + 1)), matrix: cm.matrix.map((r) => r.map((v) => (v == null ? null : v))), domain: [-1, 1], fmt: (v) => f(v, 2), cellLabels: n <= 16,
    });
    const sig = d.pares.filter((p) => p.p < 0.05);
    const esp = d.nPares * 0.05;
    const lectura = UI.lectura(`Cada celda dice qué tanto se mueven juntas dos métricas <strong>semana a semana</strong> (de −1 a +1: cerca de +1 suben y bajan juntas; cerca de −1 una sube cuando la otra baja; cerca de 0 no se relacionan). Se cruzaron <strong>${n}</strong> métricas usando semanas completas de ${esc(periodoTxt(ctx))} (${d.semanas} semanas distintas; cada par usa solo las semanas que tienen en común)${st.ventana === 'auto' && vent(ctx) === 'todo' ? ' (el periodo elegido tiene muy pocas semanas, por eso se usó todo el histórico; puedes cambiarlo arriba)' : ''}. De ${d.nPares} pares comparables (con 8 semanas o más en común), ${sig.length} salen «significativos» (p < 0,05); solo por azar se esperarían unos ${f(esp, 0)}, así que <strong>conviene mirar primero las relaciones fuertes y con muchas semanas</strong> antes de creerle a una sola. Las celdas vacías son pares sin semanas en común. Spearman usa los rangos y se afecta menos por valores extremos.`, d.semanas < 12 ? 'warn' : '');
    const ctl = `<div class="an-controls">${X.sel('rl-met', 'Método', [['pearson', 'Pearson (relación lineal)'], ['spearman', 'Spearman (por rangos)']], st.metodo, 'metodo')}${X.sel('rl-vent', 'Semanas a usar', [['auto', 'Automático'], ['periodo', 'Las del periodo elegido'], ['todo', 'Todo el histórico']], st.ventana, 'ventana')}</div>`;
    return UI.card('Matriz de correlación', 'Qué métricas de toda la planta se mueven juntas.', ctl + heat + lectura, { id: 'rl-matriz' });
  }

  function interpreta(p, nPares) {
    const dir = p.r > 0 ? 'sube' : 'baja';
    const f1 = strong(p.r);
    const ln = [];
    ln.push(`Cuando <strong>${esc(p.a)}</strong> sube, <strong>${esc(p.b)}</strong> tiende a ${dir === 'sube' ? 'subir' : 'bajar'} (relación ${f1}, r = ${f(p.r, 2)}, ${p.n} semanas).`);
    ln.push(p.p < 0.05 ? `Es poco probable que sea casualidad (${X.pt(p.p)}).` : `Con ${p.n} semanas no se distingue de la casualidad (${X.pt(p.p)}).`);
    if (p.n < 10) ln.push('Son pocas semanas: tómalo solo como pista.');
    if (p.rs != null && (Math.sign(p.rs) !== Math.sign(p.r) || Math.abs(p.rs - p.r) > 0.3)) ln.push(`Por rangos (Spearman) da ${f(p.rs, 2)}: la relación depende de pocos valores extremos.`);
    if (p.q != null && p.p < 0.05 && p.q >= 0.05) ln.push(`Al corregir por las ${nPares} comparaciones hechas deja de ser significativa: puede ser un falso positivo.`);
    return ln.join(' ');
  }

  function bloqueRanking(d, ctx, UI) {
    const top = d.pares.slice(0, 10);
    if (!top.length) return UI.card('Las relaciones más fuertes', 'Ranking de pares de métricas.', UI.vacio('No hay pares de métricas con 8 semanas o más en común. Prueba con «Todo el histórico».'), { id: 'rl-rank' });
    const cards = top.map((p) => {
      const tags = [UI.badge(p.p < 0.05 ? 'Significativa' : 'No significativa', p.p < 0.05 ? 'ok' : 'warn'), UI.badge(`n = ${p.n}`, p.n < 10 ? 'warn' : ''), UI.badge(`Spearman ${f(p.rs, 2)}`, ''), p.q != null && p.q < 0.05 ? UI.badge('Resiste la corrección múltiple', 'ok') : ''].join('');
      return `<article class="an-corr"><span class="r ${p.r > 0 ? 'pos' : 'neg'}">${p.r > 0 ? '+' : '−'}${f(Math.abs(p.r), 2)}</span><div><b>${esc(p.a)} ↔ ${esc(p.b)}</b></div><p>${interpreta(p, d.nPares)}</p><div class="tags">${tags}</div></article>`;
    }).join('');
    const tabla = UI.tabla([
      { k: 'a', t: 'Métrica A' }, { k: 'b', t: 'Métrica B' }, { k: 'n', t: 'Semanas', num: 1 }, { k: 'r', t: 'Pearson', num: 1, f: (v) => f(v, 2) }, { k: 'p', t: 'p', num: 1, f: (v) => fP(v) },
      { k: 'rs', t: 'Spearman', num: 1, f: (v) => f(v, 2) }, { k: 'ps', t: 'p', num: 1, f: (v) => fP(v) }, { k: 'q', t: 'p ajustado', num: 1, f: (v) => fP(v) }, { k: 'fz', t: 'Fuerza' },
    ], d.pares.map((p) => ({ ...p, fz: strong(p.r), source: 'Semanas ISO · ' + d.semanas + ' semanas' })), { id: 'tb-rl-rank', nombre: 'relaciones_pares_de_metricas', max: 15, sort: { k: 'r', dir: -1 } });
    const lectura = UI.lectura(`<strong>Correlación no es causa.</strong> Que dos métricas se muevan juntas puede deberse a que una causa a la otra, a que una tercera mueve a ambas (por ejemplo, el volumen producido) o simplemente al azar. Úsalo para saber dónde mirar y luego confírmalo con el proceso. «p ajustado» corrige el hecho de revisar ${d.nPares} pares a la vez (método Benjamini-Hochberg); se excluyeron las relaciones que existen por construcción (por ejemplo, agua por Hl contra agua total).`);
    return UI.card('Las relaciones más fuertes', 'Ordenadas de mayor a menor fuerza, con una lectura honesta de cada una.', `<div class="an-corr-list">${cards}</div><details class="an-det"><summary>Ver los ${d.pares.length} pares en una tabla</summary>${tabla}</details>` + lectura, { id: 'rl-rank' });
  }

  /* ---------- Dispersión interactiva ---------- */
  function opcionesCampos() {
    const out = [];
    const skip = new Set(['t']);
    for (const [ds, meta] of Object.entries(A.DL.META)) for (const fl of meta.fields) if (fl.kind === 'num' && !skip.has(fl.key)) out.push({ v: ds + ':' + fl.key, ds, fl, g: meta.label, l: fl.label + (fl.unit ? ' (' + fl.unit + ')' : '') });
    return out;
  }
  const autoAgg = (fl) => (['Hl', 'm³', 'kg'].includes(fl.unit) || ['aseos', 'nMuestras'].includes(fl.key) ? 'sum' : 'mean');
  const AGGS = [['auto', 'Automática'], ['mean', 'Promedio'], ['sum', 'Suma'], ['median', 'Mediana'], ['max', 'Máximo'], ['min', 'Mínimo']];
  function selCampos(id, label, val, stk) {
    const ops = opcionesCampos();
    const gr = {}; ops.forEach((o) => { (gr[o.g] = gr[o.g] || []).push(o); });
    return `<label class="an-ctl"><span>${esc(label)}</span><select id="${id}" data-st="${stk}">${Object.entries(gr).map(([g, l]) => `<optgroup label="${esc(g)}">${l.map((o) => `<option value="${o.v}" ${o.v === val ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  }
  function serieDe(ctx, spec, agg, by, win) {
    const [ds, key] = spec.split(':');
    const fl = A.DL.fieldOf(ds, key);
    if (!fl) return null;
    const fn = agg === 'auto' ? autoAgg(fl) : agg;
    const rr = rowsFor(ctx, ds).filter((r) => ok(r[key]) && (ds !== 'agua' || !['production', 'transfer', 'hlPerHl'].includes(key) || saneAgua(r)));
    const ag = S.aggregate(rr, { t: 't', v: key, fn, by });
    const mp = new Map();
    for (const a of ag) {
      if (a.v == null) continue;
      if (by === 'week' && (a.t < win.from - 1 || a.t + 7 * DAY - 1 > win.to)) continue;
      if (by === 'month' && (a.t < win.from - 1 || new Date(new Date(a.t).getFullYear(), new Date(a.t).getMonth() + 1, 1).getTime() - 1 > win.to)) continue;
      mp.set(a.k, a);
    }
    return { mp, fl, fn, ds };
  }
  const FN_TXT = { mean: 'promedio', sum: 'suma', median: 'mediana', max: 'máximo', min: 'mínimo', count: 'conteo' };
  function bloqueDispersion(d, ctx, UI) {
    const win = winOf(ctx);
    const X1 = serieDe(ctx, st.ax, st.fx, st.por, win), Y1 = serieDe(ctx, st.ay, st.fy, st.por, win);
    const ctl = `<div class="an-controls">${selCampos('rl-ax', 'Eje X', st.ax, 'ax')}${X.sel('rl-fx', 'Agregación de X', AGGS, st.fx, 'fx')}${selCampos('rl-ay', 'Eje Y', st.ay, 'ay')}${X.sel('rl-fy', 'Agregación de Y', AGGS, st.fy, 'fy')}${X.sel('rl-por', 'Alinear por', [['week', 'Semana'], ['month', 'Mes']], st.por, 'por')}</div>`;
    if (!X1 || !Y1) return UI.card('Dispersión: elige dos campos', 'Cualquier par de campos numéricos, alineados por semana o mes.', ctl + UI.vacio('Elige campos válidos.'), { id: 'rl-scatter' });
    const pts = [];
    X1.mp.forEach((a, k) => { const b = Y1.mp.get(k); if (b) pts.push({ k, label: a.label, t: a.t, x: a.v, y: b.v }); });
    const lx = X1.fl.label + (X1.fl.unit ? ` (${X1.fl.unit})` : ''), ly = Y1.fl.label + (Y1.fl.unit ? ` (${Y1.fl.unit})` : '');
    if (pts.length < 4) return UI.card('Dispersión: elige dos campos', 'Cualquier par de campos numéricos, alineados por semana o mes.', ctl + UI.vacio(`Solo hay ${pts.length} ${st.por === 'week' ? 'semanas' : 'meses'} con ambos datos (${X1.mp.size} de X y ${Y1.mp.size} de Y). Prueba con otro par, alinear por mes o «Todo el histórico».`), { id: 'rl-scatter' });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const lr = S.linreg(xs, ys), pe = S.pearson(xs, ys), sp = S.spearman(xs, ys);
    const graf = X.fig('scatter', { title: `${ly} frente a ${lx}`, xLabel: `${lx} · ${FN_TXT[X1.fn]}`, yLabel: `${ly} · ${FN_TXT[Y1.fn]}`, points: pts.map((p) => ({ x: p.x, y: p.y, label: `${p.label}: X ${f(p.x, 2)} · Y ${f(p.y, 2)}` })), h: 340 });
    const tabla = UI.tabla([{ k: 'label', t: st.por === 'week' ? 'Semana' : 'Mes' }, { k: 'x', t: lx, num: 1, f: (v) => f(v, 2) }, { k: 'y', t: ly, num: 1, f: (v) => f(v, 2) }], pts.map((p) => ({ ...p, source: 'Alineado por ' + (st.por === 'week' ? 'semana ISO' : 'mes') })), { id: 'tb-rl-sc', nombre: 'relaciones_dispersion', max: 10 });
    const same = st.ax === st.ay;
    const b = lr ? lr.b : null;
    const frase = lr
      ? `Por cada <strong>+1 ${esc(X1.fl.unit || 'unidad')}</strong> de ${esc(X1.fl.label.toLowerCase())}, ${esc(Y1.fl.label.toLowerCase())} ${b >= 0 ? 'sube' : 'baja'} en promedio <strong>${f(Math.abs(b), 3)} ${esc(Y1.fl.unit || '')}</strong> (${X.sig(lr.p, lr.n)}). La recta explica el <strong>${f(lr.r2 * 100, 0)} %</strong> de la variación (R² = ${f(lr.r2, 2)}); el otro ${f((1 - lr.r2) * 100, 0)} % depende de otros factores.`
      : 'No se pudo ajustar una recta (X no varía).';
    const lectura = UI.lectura(`${same ? 'Elegiste el mismo campo en X y en Y. ' : ''}${frase} Correlación de Pearson ${f(pe.r, 2)} (${strong(pe.r)}, ${X.pt(pe.p)}), Spearman ${sp ? f(sp.r, 2) : '—'}; n = ${pts.length} ${st.por === 'week' ? 'semanas' : 'meses'}. ${pts.length < 10 ? '<strong>Pocos puntos:</strong> la recta puede cambiar mucho con un dato más. ' : ''}${pe.p >= 0.05 ? 'No hay evidencia suficiente de relación. ' : ''}Que haya relación no prueba que uno cause al otro.`, pe.p < 0.05 && pts.length >= 10 ? 'ok' : 'warn');
    const regTxt = lr && lr.p != null ? `<p class="an-note"><b>Recta</b> Y = ${f(lr.a, 3)} ${lr.b < 0 ? '−' : '+'} ${f(Math.abs(lr.b), 3)} · X · error típico ${f(lr.se, 2)} · pendiente ${X.pt(lr.p)}</p>` : '';
    return UI.card('Dispersión: elige dos campos', 'Cualquier par de campos numéricos de cualquier conjunto de datos, alineados por semana o por mes, con recta de regresión.', ctl + UI.grid([graf, `<div>${lectura}${regTxt}</div>`], 2) + `<details class="an-det"><summary>Ver los ${pts.length} puntos</summary>${tabla}</details>`, { id: 'rl-scatter' });
  }

  /* ---------- Comparación de grupos ---------- */
  const DS_ORDER = ['ferm', 'lev', 'merma', 'recuperacion', 'trasiego', 'aseos', 'agua'];
  function catFields(ds) {
    const meta = A.DL.META[ds];
    const out = meta.fields.filter((fl) => fl.kind === 'cat' && !['lote'].includes(fl.key)).map((fl) => [fl.key, fl.label]);
    if (meta.fields.some((fl) => fl.key === 'gen')) out.push(['gen', 'Generación de levadura']);
    out.push(['mes', 'Mes'], ['sem', 'Semana']);
    return out;
  }
  const groupKey = (r, key) => {
    if (key === 'mes') return A.DL.periodKey(r.t, 'month').label;
    if (key === 'sem') return A.DL.periodKey(r.t, 'week').k;
    const v = r[key];
    if (v == null || v === '') return null;
    return key === 'gen' ? 'Gen. ' + v : key === 'brand' ? X.tc(String(v)) : key === 'equipment' ? X.tc(String(v)) : String(v);
  };
  function bloqueGrupos(d, ctx, UI) {
    if (!A.DL.META[st.gds]) st.gds = 'ferm';
    const meta = A.DL.META[st.gds];
    const nums = meta.fields.filter((fl) => fl.kind === 'num' && fl.key !== 't');
    if (!nums.some((fl) => fl.key === st.gm)) st.gm = nums[0] ? nums[0].key : '';
    const cats = catFields(st.gds);
    if (!cats.some((c) => c[0] === st.gby)) st.gby = cats[0][0];
    const ctl = `<div class="an-controls">${X.sel('rl-gds', 'Conjunto de datos', DS_ORDER.map((k) => [k, A.DL.META[k].label]), st.gds, 'gds')}${X.sel('rl-gm', 'Medida', nums.map((fl) => [fl.key, fl.label + (fl.unit ? ' (' + fl.unit + ')' : '')]), st.gm, 'gm')}${X.sel('rl-gby', 'Comparar por', cats, st.gby, 'gby')}</div>`;
    const fl = A.DL.fieldOf(st.gds, st.gm);
    const rr = rowsFor(ctx, st.gds).filter((r) => ok(r[st.gm]));
    const gm = new Map();
    for (const r of rr) { const k = groupKey(r, st.gby); if (k == null) continue; if (!gm.has(k)) gm.set(k, []); gm.get(k).push(r[st.gm]); }
    let grupos = [...gm.entries()].filter(([, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, st.top);
    if (grupos.length < 2) {
      return UI.card('Comparar grupos', 'ANOVA y Kruskal-Wallis con tamaño del efecto.', ctl + UI.vacio(`Solo ${grupos.length} grupo(s) con 3 datos o más en ${esc(periodoTxt(ctx))} (${rr.length} registros con ${esc(fl ? fl.label.toLowerCase() : 'la medida')}). Elige otra medida u otra forma de agrupar, o usa «Todo el histórico» en la matriz.`), { id: 'rl-grupos' });
    }
    if (st.gby === 'mes' || st.gby === 'sem') grupos.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const obj = Object.fromEntries(grupos);
    const an = S.anova(obj), kw = S.kruskal(obj), cg = S.compareGroups(obj);
    const two = grupos.length === 2 ? S.ttest(grupos[0][1], grupos[1][1]) : null;
    const box = X.fig('box', { title: `${fl.label} por ${cats.find((c) => c[0] === st.gby)[1].toLowerCase()}`, unit: fl.unit, groups: grupos.map(([k, v]) => ({ label: `${k} (${v.length})`, values: v })), yFmt: (v) => f(v, Math.abs(v) < 10 ? 1 : 0) });
    const filas = grupos.map(([k, v]) => ({ grupo: k, n: v.length, media: S.mean(v), mediana: S.median(v), sd: S.sd(v), min: Math.min(...v), max: Math.max(...v), source: A.DL.META[st.gds].label })).sort((a, b) => b.media - a.media);
    const tabla = UI.tabla([{ k: 'grupo', t: 'Grupo' }, { k: 'n', t: 'n', num: 1 }, { k: 'media', t: 'Media', num: 1, f: (v) => f(v, 2) }, { k: 'mediana', t: 'Mediana', num: 1, f: (v) => f(v, 2) }, { k: 'sd', t: 'Desv. est.', num: 1, f: (v) => f(v, 2) }, { k: 'min', t: 'Mín.', num: 1, f: (v) => f(v, 2) }, { k: 'max', t: 'Máx.', num: 1, f: (v) => f(v, 2) }], filas, { id: 'tb-rl-gr', nombre: 'relaciones_comparacion_grupos', max: 12 });
    const efecto = two ? { txt: `d de Cohen = ${f(Math.abs(two.d), 2)} (${X.efectoD(two.d)})`, val: Math.abs(two.d) } : an ? { txt: `η² = ${f(an.eta2, 2)} (efecto ${X.efectoEta(an.eta2)}: ${f(an.eta2 * 100, 0)} % de la variación se explica por el grupo)`, val: an.eta2 } : null;
    const p = two ? two.p : an ? an.p : null;
    const mx = filas[0], mn = filas[filas.length - 1];
    const concuerdan = an && kw ? (an.p < 0.05) === (kw.p < 0.05) : true;
    const lectura = UI.lectura(`${p != null && p < 0.05 ? `Sí hay diferencia entre grupos: ${X.sig(p, Math.min(...grupos.map((g) => g[1].length)))}.` : `No se puede afirmar que haya diferencia entre los grupos: ${X.sig(p, Math.min(...grupos.map((g) => g[1].length)))}.`} El grupo con mayor media es <strong>${esc(mx.grupo)}</strong> (${f(mx.media, 2)}) y el menor <strong>${esc(mn.grupo)}</strong> (${f(mn.media, 2)}). ${efecto ? 'Tamaño del efecto: ' + efecto.txt + '. ' : ''}${an && kw ? `ANOVA: F(${an.df1}, ${an.df2}) = ${f(an.F, 2)}, ${X.pt(an.p)}; Kruskal-Wallis (sin suponer curva normal): ${X.pt(kw.p)}${concuerdan ? ', coinciden.' : ', <strong>no coinciden</strong>: hay valores extremos que cambian la conclusión, confía más en Kruskal-Wallis.'}` : ''} Se comparan solo grupos con 3 datos o más (los ${grupos.length} más numerosos). «Significativo» no es lo mismo que «importante»: mira el tamaño del efecto.`, p != null && p < 0.05 ? 'ok' : '');
    return UI.card('Comparar grupos', 'Marca, tanque, turno, generación, equipo, operario o mes: ¿hay diferencia real en una medida?', ctl + X.grid12(box, tabla) + lectura, { id: 'rl-grupos' });
  }

  A.Analisis.registrar({
    id: 'relaciones', label: 'Relaciones', orden: 8,
    render(ctx, UI) {
      const d = calc(ctx);
      const ayuda = '<p class="an-note"><strong>Cómo se hace</strong> Cada métrica se resume por semana (suma o promedio, según el caso) y se miden las relaciones entre todas. Solo cuentan semanas completas dentro del periodo.</p>';
      const matriz = d.series.length >= 3 && d.semanas >= 6 ? bloqueMatriz(d, ctx, UI) : UI.card('Matriz de correlación', 'Qué métricas de toda la planta se mueven juntas.', `<div class="an-controls">${X.sel('rl-vent', 'Semanas a usar', [['auto', 'Automático'], ['periodo', 'Las del periodo elegido'], ['todo', 'Todo el histórico']], st.ventana, 'ventana')}</div>` + UI.vacio('Se necesitan al menos 6 semanas completas con datos de varias métricas. Elige «Todo el histórico» arriba o amplía el periodo.'));
      return matriz + bloqueRanking(d, ctx, UI) + bloqueDispersion(d, ctx, UI) + bloqueGrupos(d, ctx, UI) + (d.series.length ? '' : ayuda);
    },
    mount(ctx, el) { X.bind(el, st); },
    hallazgos(ctx) {
      const prev = st.ventana; st.ventana = 'todo';
      let d; try { d = calc(ctx); } finally { st.ventana = prev; }
      const out = [];
      d.pares.filter((p) => p.n >= 20 && p.p < 0.05 && p.q != null && p.q < 0.05 && Math.abs(p.r) >= 0.5).slice(0, 3).forEach((p) => out.push({ sev: 'info', titulo: `${p.a} y ${p.b} se mueven ${p.r > 0 ? 'juntas' : 'en sentido contrario'}`, detalle: `Correlación semanal de ${f(p.r, 2)} (${strong(p.r)}) en ${p.n} semanas. Es una relación, no necesariamente una causa.`, valor: f(p.r, 2) }));
      return out;
    },
  });
})();
