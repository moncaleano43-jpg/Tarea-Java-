/* ============================================================
   Análisis · Constructor
   Arma tu propio gráfico sin código: conjunto de datos, métrica, agregación, agrupación, filtros, tipo de gráfica,
   comparación con el periodo anterior, tabla subyacente, descargas y «Mis vistas» (App.S.config.cifraVistas).
   Acepta parámetros en el enlace: #/analisis/constructor?ds=agua&m=total&by=week&ch=line
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.Analisis || !A.AnX) return;
  const X = A.AnX, S = X.S, C = X.C, AN = A.Analisis, ok = X.ok, esc = X.esc, f = X.f, fd = X.fd;
  const DL = A.DL;
  const DAY = 86400000;
  const TIME = ['day', 'week', 'month', 'year'];
  const TIME_L = { day: 'día', week: 'semana', month: 'mes', year: 'año' };
  const AGGS = [['sum', 'Suma'], ['mean', 'Promedio'], ['median', 'Mediana'], ['min', 'Mínimo'], ['max', 'Máximo'], ['count', 'Conteo de registros']];
  const AGG_TXT = { sum: 'Suma', mean: 'Promedio', median: 'Mediana', min: 'Mínimo', max: 'Máximo', count: 'Conteo' };
  const CHARTS = [['auto', 'Automático'], ['line', 'Líneas'], ['area', 'Área'], ['bars', 'Barras'], ['barsH', 'Barras horizontales'], ['scatter', 'Dispersión'], ['box', 'Cajas (distribución)'], ['hist', 'Histograma'], ['pareto', 'Pareto']];
  const HAS_BRAND = ['merma', 'recuperacion', 'trasiego', 'ferm', 'lev'];
  const KEYS = ['ds', 'm', 'agg', 'by', 'ch', 'f', 'fv', 'brand', 'top', 'sort', 'cmp', 'per', 'x'];
  const VIEWS_LS = 'cifra.vistas.v1';

  const defaults = (ds) => {
    const meta = DL.META[ds];
    return { ds, m: meta.defaultMetric, agg: meta.fields.find((x) => x.key === meta.defaultMetric)?.kind === 'num' ? (['Hl', 'm³', 'kg'].includes(meta.fields.find((x) => x.key === meta.defaultMetric).unit) ? 'sum' : 'mean') : 'count', by: meta.defaultBy || 'month', ch: 'auto', f: '', fv: '', brand: '', top: 0, sort: 'auto', cmp: false, per: true, x: '' };
  };
  const st = Object.assign(defaults('agua'), { m: 'total', agg: 'sum', by: 'week' });

  /* ---------- Parámetros del enlace ---------- */
  function hashQuery() {
    const h = location.hash || '';
    const i = h.indexOf('?');
    if (i < 0) return null;
    const q = {};
    h.slice(i + 1).split('&').forEach((kv) => { const [k, v = ''] = kv.split('='); if (k) q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); });
    return q;
  }
  function aplicar(q) {
    if (!q) return;
    if (q.ds && DL.META[q.ds]) Object.assign(st, defaults(q.ds));
    for (const k of KEYS) {
      if (q[k] == null || k === 'ds') continue;
      st[k] = k === 'top' ? Math.max(0, parseInt(q[k], 10) || 0) : k === 'cmp' || k === 'per' ? (q[k] === '1' || q[k] === 'true') : q[k];
    }
    if (q.ds && !q.agg && DL.fieldOf(st.ds, st.m)) { const fl = DL.fieldOf(st.ds, st.m); if (fl.kind !== 'num') st.agg = 'count'; }
    normaliza();
  }
  function normaliza() {
    const meta = DL.META[st.ds] || DL.META.agua;
    if (!DL.META[st.ds]) Object.assign(st, defaults('agua'));
    if (st.m !== '__count' && !DL.fieldOf(st.ds, st.m)) st.m = meta.defaultMetric;
    const fl = DL.fieldOf(st.ds, st.m);
    if (st.m === '__count' || !fl || fl.kind !== 'num') st.agg = 'count';
    if (!AGGS.some((a) => a[0] === st.agg)) st.agg = 'mean';
    if (st.by && !TIME.includes(st.by) && !meta.fields.some((x) => x.key === st.by)) st.by = meta.defaultBy || 'month';
    if (!CHARTS.some((c) => c[0] === st.ch)) st.ch = 'auto';
    if (st.f && !meta.fields.some((x) => x.key === st.f)) { st.f = ''; st.fv = ''; }
    if (st.x && !DL.numericFields(st.ds).some((x) => x.key === st.x)) st.x = '';
    if (!['auto', 'desc', 'asc', 'nat'].includes(st.sort)) st.sort = 'auto';
  }
  function aHash() {
    const base = (location.hash || '#/analisis/constructor').split('?')[0];
    const d = defaults(st.ds), q = [];
    for (const k of KEYS) {
      const v = st[k];
      if (k === 'ds' || v !== d[k] || ['m', 'by', 'agg'].includes(k)) {
        if (v === '' || v == null || v === false && k !== 'per') continue;
        q.push(k + '=' + encodeURIComponent(typeof v === 'boolean' ? (v ? '1' : '0') : v));
      }
    }
    const nuevo = base + (q.length ? '?' + q.join('&') : '');
    try { history.replaceState(null, '', nuevo); } catch (e) { /* sin historial */ }
    return nuevo;
  }

  /* ---------- Cálculo ---------- */
  const catFieldsOf = (ds) => DL.META[ds].fields.filter((x) => x.kind === 'cat');
  const isCat = (ds, key) => { const fl = DL.fieldOf(ds, key); return !!fl && fl.kind !== 'date'; };
  const fmtVal = (v, dec) => (v == null ? '—' : f(v, dec == null ? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) : dec));
  const AGGF = {
    sum: (v) => (v.length ? v.reduce((a, b) => a + b, 0) : null), mean: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null),
    median: (v) => S.median(v), min: (v) => (v.length ? Math.min(...v) : null), max: (v) => (v.length ? Math.max(...v) : null),
  };
  function filtrar(ctx, from, to) {
    const meta = DL.META[st.ds];
    const brands = st.brand ? [st.brand] : ctx.estado.brands;
    const hasB = HAS_BRAND.includes(st.ds);
    return DL.get(st.ds).filter((r) => {
      if (st.per && (r.t == null || r.t < from || r.t > to)) return false;
      if (hasB && brands.length && !brands.includes(r.brand)) return false;
      if (st.f && st.fv !== '' && String(r[st.f] == null || r[st.f] === '' ? '(sin dato)' : r[st.f]) !== st.fv) return false;
      return true;
    });
  }
  function valorDe(r) { const v = r[st.m]; return ok(v) ? v : null; }
  function agrupa(rows) {
    const by = st.by;
    const isTime = TIME.includes(by);
    const g = new Map();
    if (!by) { g.set('(total)', { k: '(total)', label: 'Total', t: null, rows }); }
    else for (const r of rows) {
      let k, label, t = null;
      if (isTime) { if (r.t == null) continue; const p = DL.periodKey(r.t, by); k = p.k; label = p.label; t = p.t; }
      else { const raw = r[by]; label = raw == null || raw === '' ? '(sin dato)' : by === 'gen' ? 'Gen. ' + raw : (by === 'brand' || by === 'equipment' || by === 'operator') ? X.tc(String(raw)) : String(raw); k = label; }
      if (!g.has(k)) g.set(k, { k, label, t, rows: [] });
      g.get(k).rows.push(r);
    }
    const out = [...g.values()];
    for (const e of out) {
      const vals = e.rows.map(valorDe).filter((v) => v != null);
      e.n = e.rows.length; e.vals = vals;
      e.v = st.agg === 'count' ? e.rows.length : AGGF[st.agg](vals);
    }
    return { grupos: out, isTime };
  }
  const nextOf = (t, by) => {
    const d = new Date(t);
    if (by === 'year') return new Date(d.getFullYear() + 1, 0, 1).getTime();
    if (by === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    if (by === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  };
  function calc(ctx) {
    normaliza();
    const r = ctx.rango;
    const cur = filtrar(ctx, r.from, r.to);
    const prev = st.cmp && st.per ? filtrar(ctx, r.prevFrom, r.prevTo) : [];
    const A1 = agrupa(cur), A0 = prev.length ? agrupa(prev) : null;
    let grupos = A1.grupos;
    const isTime = A1.isTime;
    if (isTime) grupos.sort((a, b) => a.t - b.t);
    else {
      const ord = st.sort === 'auto' ? 'desc' : st.sort;
      if (ord === 'desc') grupos.sort((a, b) => (b.v == null) - (a.v == null) || b.v - a.v);
      else if (ord === 'asc') grupos.sort((a, b) => (a.v == null) - (b.v == null) || a.v - b.v);
      else grupos.sort((a, b) => String(a.label).localeCompare(String(b.label), 'es', { numeric: true }));
    }
    grupos = grupos.filter((e) => e.v != null);
    if (isTime && (st.agg === 'sum' || st.agg === 'count')) {
      for (const e of grupos) { const fin = nextOf(e.t, st.by) - 1; if ((st.per && e.t < r.from - 1) || fin > r.to) { e.parcial = true; e.label += ' *'; } }
    }
    if (st.top > 0) grupos = isTime ? grupos.slice(-st.top) : grupos.slice(0, st.top);
    // periodo anterior alineado
    let prevVals = null;
    if (A0) {
      if (isTime) { const pg = A0.grupos.sort((x, y) => x.t - y.t).filter((e) => e.v != null); prevVals = grupos.map((_, i) => (pg[i] ? pg[i].v : null)); }
      else { const mp = new Map(A0.grupos.map((e) => [e.k, e])); prevVals = grupos.map((e) => (mp.get(e.k) ? mp.get(e.k).v : null)); }
    }
    const all = cur.map(valorDe).filter((v) => v != null);
    const overall = st.agg === 'count' ? cur.length : AGGF[st.agg](all);
    return { cur, prev, grupos, isTime, prevVals, all, overall, nPrev: prev.length };
  }

  /* ---------- Textos ---------- */
  function etiquetaMetrica() {
    if (st.m === '__count') return 'registros';
    const fl = DL.fieldOf(st.ds, st.m);
    return fl ? fl.label.toLowerCase() + (fl.unit ? ' (' + fl.unit + ')' : '') : st.m;
  }
  function unidad() { const fl = DL.fieldOf(st.ds, st.m); return st.agg === 'count' || !fl ? '' : fl.unit; }
  function describir(ctx) {
    const meta = DL.META[st.ds];
    const agg = st.agg === 'count' ? 'Número de registros de' : AGG_TXT[st.agg] + ' de';
    const by = st.by ? (TIME.includes(st.by) ? 'por ' + TIME_L[st.by] : 'por ' + (DL.fieldOf(st.ds, st.by) ? DL.fieldOf(st.ds, st.by).label.toLowerCase() : st.by)) : 'en total';
    const filt = st.f && st.fv !== '' ? `, solo ${(DL.fieldOf(st.ds, st.f) || { label: st.f }).label.toLowerCase()} = ${st.fv}` : '';
    const mar = st.brand ? `, marca ${st.brand}` : (HAS_BRAND.includes(st.ds) && ctx.estado.brands.length ? `, marcas ${ctx.estado.brands.join(', ')}` : '');
    return `${agg} ${st.agg === 'count' ? meta.label.toLowerCase() : etiquetaMetrica()} ${by}, ${st.per ? ctx.etiquetaPeriodo : 'todo el histórico'}${mar}${filt}.`;
  }

  /* ---------- Gráfica ---------- */
  function tipoEfectivo(d) {
    if (st.ch !== 'auto') return st.ch;
    if (!st.by) return 'hist';
    return d.isTime ? 'line' : 'bars';
  }
  function grafica(ctx, d, UI) {
    const ch = tipoEfectivo(d);
    const u = unidad();
    const metric = etiquetaMetrica();
    const title = describirCorto();
    const base = { title, unit: u };
    const G = d.grupos;
    const fl = DL.fieldOf(st.ds, st.m);
    const num = fl && fl.kind === 'num';
    const lab = (e, i) => e.label;
    const hasPrev = d.prevVals && d.prevVals.some((v) => v != null);
    const aviso = (msg) => UI.vacio(msg);
    if (ch === 'hist') {
      if (!num) return aviso('El histograma necesita una métrica numérica.');
      return X.fig('histogram', { ...base, values: d.all, normal: false, full: true, h: 320 });
    }
    if (ch === 'scatter') {
      if (!num) return aviso('La dispersión necesita una métrica numérica en el eje Y.');
      const xf = st.x || (DL.numericFields(st.ds).find((x) => x.key !== st.m) || {}).key;
      const xfl = DL.fieldOf(st.ds, xf);
      if (!xf) return aviso('Este conjunto de datos tiene una sola métrica numérica.');
      const catBy = st.by && !TIME.includes(st.by);
      const top = catBy ? [...new Set(d.cur.map((r) => (r[st.by] == null ? '(sin dato)' : String(r[st.by]))))].slice(0, 6) : [];
      const pts = d.cur.filter((r) => ok(r[xf]) && ok(r[st.m])).map((r) => ({ x: r[xf], y: r[st.m], group: catBy ? (top.includes(String(r[st.by] == null ? '(sin dato)' : r[st.by])) ? String(r[st.by] == null ? '(sin dato)' : r[st.by]) : undefined) : undefined, label: `${r.t ? AN.fmtDate(r.t) + ' · ' : ''}${xfl.label} ${f(r[xf], 2)} · ${fl.label} ${f(r[st.m], 2)}${r.source ? ' · ' + r.source : ''}` }));
      if (pts.length < 3) return aviso('Hay muy pocos registros con ambos valores.');
      return X.fig('scatter', { ...base, points: pts, xLabel: xfl.label + (xfl.unit ? ` (${xfl.unit})` : ''), yLabel: fl.label + (fl.unit ? ` (${fl.unit})` : ''), full: true, h: 340 });
    }
    if (ch === 'box') {
      if (!num) return aviso('Las cajas necesitan una métrica numérica.');
      if (!st.by) return aviso('Elige «Agrupar por» para comparar distribuciones.');
      const gs = (d.isTime ? G.slice(-12) : G.slice().sort((a, b) => b.n - a.n).slice(0, 12)).filter((e) => e.vals.length >= 2);
      if (!gs.length) return aviso('Los grupos tienen menos de 2 datos para dibujar una caja.');
      return X.fig('box', { ...base, groups: gs.map((e) => ({ label: `${e.label} (${e.vals.length})`, values: e.vals })), full: true, h: 320 });
    }
    if (!G.length) return aviso('No hay datos con estos filtros.');
    if (ch === 'pareto') {
      if (!st.by || d.isTime) return aviso('El Pareto necesita agrupar por un campo (marca, causa, equipo…), no por tiempo.');
      return X.fig('pareto', { ...base, items: G.filter((e) => e.v > 0).map((e) => ({ label: e.label, value: e.v })), full: true, h: 340 });
    }
    if (ch === 'barsH') {
      if (hasPrev) return X.fig('bars', { ...base, horizontal: true, categories: G.map(lab), series: [{ name: 'Periodo actual', values: G.map((e) => e.v), color: 'var(--est)' }, { name: 'Periodo anterior', values: d.prevVals, color: 'var(--faint)' }] });
      return X.fig('barsH', { ...base, data: G.map((e) => ({ label: e.label, value: e.v, color: 'var(--est)' })) });
    }
    if (ch === 'bars') {
      const series = [{ name: hasPrev ? 'Periodo actual' : metric, values: G.map((e) => e.v), color: 'var(--est)' }];
      if (hasPrev) series.push({ name: 'Periodo anterior', values: d.prevVals, color: 'var(--faint)' });
      return X.fig('bars', { ...base, categories: G.map(lab), series, full: G.length > 8, h: 320 });
    }
    // line / area
    const area = ch === 'area';
    const pts = G.map((e, i) => ({ x: d.isTime ? e.t : i, y: e.v, label: `${e.label}: ${fmtVal(e.v)} ${u} (${e.n} registros)` }));
    const series = [{ name: hasPrev ? 'Periodo actual' : metric, points: pts, color: 'var(--est)', area, dots: G.length <= 40 }];
    if (hasPrev) series.push({ name: 'Periodo anterior', points: G.map((e, i) => ({ x: d.isTime ? e.t : i, y: d.prevVals[i], label: `${e.label} (periodo anterior): ${fmtVal(d.prevVals[i])} ${u}` })).filter((p) => p.y != null), color: 'var(--ink)', dashed: true, dots: false });
    const o = { ...base, series, full: true, h: 320, xType: d.isTime ? 'time' : 'category' };
    if (!d.isTime) o.xLabels = G.map(lab);
    return X.fig('line', o);
  }
  function describirCorto() {
    const meta = DL.META[st.ds];
    const m = st.agg === 'count' ? 'Registros de ' + meta.label.toLowerCase() : `${AGG_TXT[st.agg]} de ${etiquetaMetrica()}`;
    return st.by ? `${m} por ${TIME.includes(st.by) ? TIME_L[st.by] : (DL.fieldOf(st.ds, st.by) || { label: st.by }).label.toLowerCase()}` : m;
  }

  /* ---------- Lectura automática ---------- */
  function lectura(ctx, d, UI) {
    const G = d.grupos, u = unidad();
    if (!G.length) return '';
    const Gc = G.filter((e) => !e.parcial), hayParcial = Gc.length < G.length;
    const GG = Gc.length >= 2 ? Gc : G;
    const mx = GG.reduce((a, b) => (b.v > a.v ? b : a)), mn = GG.reduce((a, b) => (b.v < a.v ? b : a));
    const partes = [];
    partes.push(`Hay <strong>${d.cur.length}</strong> registro${d.cur.length === 1 ? '' : 's'} en ${G.length} ${d.isTime ? 'periodos' : 'grupos'}. ${st.agg === 'count' ? 'En total' : AGG_TXT[st.agg]}: <strong>${fmtVal(d.overall)}${u ? ' ' + esc(u) : ''}</strong>.`);
    if (GG.length >= 2) partes.push(`El valor más alto es <strong>${esc(mx.label)}</strong> (${fmtVal(mx.v)}${u ? ' ' + esc(u) : ''}) y el más bajo <strong>${esc(mn.label)}</strong> (${fmtVal(mn.v)}${u ? ' ' + esc(u) : ''}).`);
    if (hayParcial) partes.push('Los periodos marcados con * están incompletos (el periodo elegido los corta) y no cuentan para el máximo, el mínimo ni la tendencia.');
    if (d.isTime && GG.length >= 4) {
      const t = X.tendencia(GG.map((e) => e.v), null);
      if (t) partes.push(t.trend === 'sin tendencia' ? 'No hay una tendencia clara en el tiempo (Mann-Kendall).' : `La serie <strong>${t.trend === 'sube' ? 'sube' : 'baja'}</strong> con el tiempo (${X.sig(t.p, t.n)}), unos ${f(Math.abs(t.sen), 2)}${u ? ' ' + esc(u) : ''} por ${TIME_L[st.by]}.`);
      const o = S.outliers(GG.map((e) => e.v), { method: 'iqr' });
      if (o && o.idx && o.idx.length) partes.push(`${o.idx.length === 1 ? 'Un periodo se sale' : o.idx.length + ' periodos se salen'} de lo habitual: ${o.idx.slice(0, 3).map((i) => esc(GG[i].label)).join(', ')}.`);
    }
    if (!d.isTime && st.by && (st.agg === 'sum' || st.agg === 'count') && G.length >= 2) {
      const tot = X.sum(G.map((e) => e.v));
      const par = S.pareto(G.filter((e) => e.v > 0).map((e) => ({ label: e.label, value: e.v })), { vital: 80 });
      if (par && tot > 0) partes.push(`${esc(mx.label)} aporta el ${f((mx.v / tot) * 100, 0)} % del total${par.vitalFew.length < G.length ? `; ${par.vitalFew.length} ${par.vitalFew.length === 1 ? 'grupo explica' : 'grupos explican'} el 80 %` : ''}.`);
    }
    if (d.prevVals && d.nPrev) {
      const pv = d.prev.map(valorDe).filter((v) => v != null);
      const po = st.agg === 'count' ? d.prev.length : AGGF[st.agg](pv);
      const dc = X.dpct(d.overall, po);
      partes.push(`Frente al periodo anterior (${d.nPrev} registros, ${st.agg === 'count' ? '' : AGG_TXT[st.agg].toLowerCase() + ' '}${fmtVal(po)}${u ? ' ' + esc(u) : ''}) ${dc == null ? 'no se puede calcular el cambio' : `${dc >= 0 ? 'sube' : 'baja'} ${f(Math.abs(dc), 1)} %`}.`);
    } else if (st.cmp && !st.per) partes.push('Para comparar con el periodo anterior activa «Usar el periodo del marco».');
    else if (st.cmp) partes.push('No hay registros en el periodo anterior para comparar.');
    if (st.agg === 'sum' && DL.fieldOf(st.ds, st.m) && ['%', '°C', 'pH', '°P'].includes(DL.fieldOf(st.ds, st.m).unit)) partes.push('<em>Ojo:</em> sumar un porcentaje o una temperatura rara vez tiene sentido; prueba con promedio.');
    return UI.lectura(partes.join(' '));
  }

  const pick = (d) => { const c = d.grupos.filter((e) => !e.parcial); return c.length >= 2 ? c : d.grupos; };

  /* ---------- Tablas ---------- */
  function tablas(ctx, d, UI) {
    const u = unidad();
    const cols = [{ k: 'label', t: TIME.includes(st.by) ? TIME_L[st.by].replace(/^./, (c) => c.toUpperCase()) : (st.by ? (DL.fieldOf(st.ds, st.by) || { label: 'Grupo' }).label : 'Total') }, { k: 'v', t: (st.agg === 'count' ? 'Registros' : AGG_TXT[st.agg]) + (u ? ` (${u})` : ''), num: 1, f: (v) => fmtVal(v) }, { k: 'n', t: 'Registros', num: 1 }];
    const rows = d.grupos.map((e, i) => {
      const o = { label: e.label, v: e.v, n: e.n, source: DL.META[st.ds].label };
      if (d.prevVals) { o.prev = d.prevVals[i]; o.var = o.prev ? ((e.v - o.prev) / Math.abs(o.prev)) * 100 : null; }
      return o;
    });
    if (d.prevVals) { cols.push({ k: 'prev', t: 'Periodo anterior', num: 1, f: (v) => fmtVal(v) }, { k: 'var', t: 'Variación', num: 1, f: (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${f(v, 1)} %`) }); }
    const t1 = UI.tabla(cols, rows, { id: 'tb-cx-agg', nombre: 'constructor_' + st.ds + '_' + (st.m || 'conteo'), max: 12 });
    const meta = DL.META[st.ds];
    const colsRaw = [{ k: 't', t: 'Fecha', f: (v) => (v == null ? '—' : esc(AN.fmtDateTime(v))) }];
    if (st.by && !TIME.includes(st.by)) colsRaw.push({ k: st.by, t: (DL.fieldOf(st.ds, st.by) || { label: st.by }).label });
    if (st.m !== '__count' && DL.fieldOf(st.ds, st.m)) colsRaw.push({ k: st.m, t: DL.fieldOf(st.ds, st.m).label, num: DL.fieldOf(st.ds, st.m).kind === 'num', f: (v) => (ok(v) ? fmtVal(v) : esc(v == null ? '—' : v)) });
    if (st.f && st.f !== st.by) colsRaw.push({ k: st.f, t: (DL.fieldOf(st.ds, st.f) || { label: st.f }).label });
    colsRaw.push({ k: 'source', t: 'Fuente' });
    const raw = d.cur.map((r) => ({ ...r, source: r.source || meta.label }));
    const t2 = UI.tabla(colsRaw, raw, { id: 'tb-cx-raw', nombre: 'constructor_' + st.ds + '_registros', max: 12, sort: { k: 't', dir: -1 } });
    return { t1, t2 };
  }

  /* ---------- Controles ---------- */
  function valoresDe(ds, key) {
    if (!key) return [];
    const m = new Map();
    for (const r of DL.get(ds)) { const v = r[key] == null || r[key] === '' ? '(sin dato)' : String(r[key]); m.set(v, (m.get(v) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([v]) => v);
  }
  function controles(ctx) {
    const meta = DL.META[st.ds];
    const nums = meta.fields.filter((x) => x.kind === 'num');
    const mets = [['__count', 'N.º de registros'], ...nums.map((x) => [x.key, x.label + (x.unit ? ` (${x.unit})` : '')])];
    const bys = [['', 'Nada (un solo total)'], ...TIME.map((t) => [t, 'Por ' + TIME_L[t]]), ...meta.fields.filter((x) => x.kind === 'cat' || x.key === 'gen').map((x) => [x.key, x.label])];
    const fcats = [['', 'Sin filtro'], ...catFieldsOf(st.ds).map((x) => [x.key, x.label])];
    const fvals = [['', '(todos)'], ...valoresDe(st.ds, st.f).map((v) => [v, v])];
    const aggOps = st.m === '__count' || !(DL.fieldOf(st.ds, st.m) || {}).kind || DL.fieldOf(st.ds, st.m).kind !== 'num' ? [['count', 'Conteo de registros']] : AGGS;
    const marcas = [['', 'Las del marco'], ...ctx.marcasTodas.map((m) => [m, X.tc(m)])];
    const xs = [['', 'Automática'], ...nums.filter((x) => x.key !== st.m).map((x) => [x.key, x.label])];
    const topOps = [[0, 'Todos'], [5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']];
    return `<div class="an-controls">
      ${X.sel('cx-ds', 'Datos', Object.keys(DL.META).map((k) => [k, DL.META[k].label]), st.ds, 'ds')}
      ${X.sel('cx-m', 'Métrica', mets, st.m, 'm')}
      ${X.sel('cx-agg', 'Cómo agregar', aggOps, st.agg, 'agg')}
      ${X.sel('cx-by', 'Agrupar por', bys, st.by || '', 'by')}
      ${X.sel('cx-ch', 'Tipo de gráfica', CHARTS, st.ch, 'ch')}
    </div><div class="an-controls">
      ${X.sel('cx-f', 'Filtrar por campo', fcats, st.f, 'f')}
      ${st.f ? X.sel('cx-fv', 'Valor', fvals, st.fv, 'fv') : ''}
      ${HAS_BRAND.includes(st.ds) ? X.sel('cx-brand', 'Marca', marcas, st.brand, 'brand') : ''}
      ${X.sel('cx-sort', 'Orden', [['auto', 'Automático'], ['desc', 'De mayor a menor'], ['asc', 'De menor a mayor'], ['nat', 'Alfabético']], st.sort, 'sort')}
      ${X.sel('cx-top', st.by && TIME.includes(st.by) ? 'Mostrar últimos' : 'Mostrar los primeros', topOps, st.top, 'top')}
      ${st.ch === 'scatter' ? X.sel('cx-x', 'Eje X', xs, st.x, 'x') : ''}
      ${X.chk('cx-per', 'Usar el periodo del marco', st.per, 'per')}
      ${X.chk('cx-cmp', 'Comparar con el periodo anterior', st.cmp && st.per, 'cmp')}
    </div>`;
  }

  /* ---------- Mis vistas ---------- */
  function leerVistas() {
    let v = (A.S && A.S.config && A.S.config.cifraVistas) || {};
    try { const ls = JSON.parse(localStorage.getItem(VIEWS_LS) || '{}'); v = Object.assign({}, ls, v); } catch (e) { /* sin almacenamiento */ }
    return v && typeof v === 'object' ? v : {};
  }
  async function guardarVistas(obj) {
    let guardado = false;
    try {
      if (A.Store && A.Store.set && A.Store.canWrite !== false) { await A.Store.set('config', 'cifraVistas', obj); guardado = true; }
    } catch (e) { guardado = false; }
    try { localStorage.setItem(VIEWS_LS, JSON.stringify(obj)); } catch (e) { /* sin almacenamiento */ }
    return guardado;
  }
  const snapshot = () => { const o = {}; KEYS.forEach((k) => { o[k] = st[k]; }); return o; };
  function vistasHtml() {
    const v = leerVistas();
    const ids = Object.keys(v).sort((a, b) => (v[b].at || 0) - (v[a].at || 0));
    return `<div class="an-vistas">${ids.length ? ids.map((id) => `<span class="an-vista"><button type="button" data-vista-cargar="${esc(id)}" title="Abrir esta vista">${esc(v[id].name || 'Vista')}</button><button type="button" class="x" data-vista-borrar="${esc(id)}" aria-label="Borrar la vista ${esc(v[id].name || '')}">×</button></span>`).join('') : '<span class="an-note" style="margin:0">Aún no hay vistas guardadas. Arma un gráfico y guárdalo con un nombre.</span>'}</div>`;
  }

  /* ---------- Registro ---------- */
  A.Analisis.registrar({
    id: 'constructor', label: 'Constructor', orden: 10,
    render(ctx, UI) {
      aplicar(hashQuery());
      normaliza();
      const d = X.memo(ctx, 'cx', [st.ds], () => calc(ctx), JSON.stringify(snapshot()));
      const meta = DL.META[st.ds];
      let cuerpo;
      if (!d.cur.length) {
        cuerpo = UI.vacio(`No hay registros de «${meta.label}» con estos filtros${st.per ? ' en el periodo' : ''}. ${st.per ? 'Prueba con «Todo el histórico» arriba o desmarca «Usar el periodo del marco».' : 'Quita algún filtro.'}`);
      } else {
        const t = tablas(ctx, d, UI);
        const kp = X.kpis([
          { label: 'Registros', value: f(d.cur.length, 0), help: st.per ? 'En el periodo del marco' : 'En todo el histórico', cur: d.cur.length, prev: d.nPrev || null, good: 'up' },
          { label: st.agg === 'count' ? 'Total de registros' : AGG_TXT[st.agg], value: fmtVal(d.overall), unit: unidad(), help: 'De todo lo filtrado' },
          { label: d.isTime ? 'Periodos' : 'Grupos', value: f(d.grupos.length, 0), help: st.by ? 'Con dato' : 'Sin agrupar' },
          { label: 'Valor más alto', value: d.grupos.length ? fmtVal(Math.max(...pick(d).map((e) => e.v))) : '—', unit: unidad(), help: d.grupos.length ? pick(d).reduce((a, b) => (b.v > a.v ? b : a)).label : '' },
        ]);
        cuerpo = kp + UI.card('Resultado', esc(describir(ctx)), grafica(ctx, d, UI) + lectura(ctx, d, UI), { id: 'cx-resultado' })
          + UI.card('Datos de la gráfica', 'Los valores que se dibujan, listos para descargar (CSV o Excel).', t.t1, { id: 'cx-datos' })
          + UI.card('Registros que alimentan la gráfica', 'Cada fila trae su fuente; pasa el cursor para verla.', t.t2, { id: 'cx-raw' });
      }
      const barra = `<div class="an-controls"><label class="an-ctl"><span>Nombre de la vista</span><input type="text" id="cx-nombre" placeholder="Ej. Agua semanal" maxlength="60" value=""></label>
        <button type="button" class="an-btn pri" id="cx-guardar">Guardar vista</button><button type="button" class="an-btn" id="cx-enlace">Copiar enlace</button><button type="button" class="an-btn" id="cx-reset">Restablecer</button></div><p id="cx-msg" class="an-note" hidden role="status"></p>`;
      return UI.card('Arma tu gráfico', 'Elige los datos, qué medir y cómo agruparlo. Todo se calcula con tus registros y se actualiza al instante.', controles(ctx) + barra, { id: 'cx-config' })
        + UI.card('Mis vistas', 'Gráficos guardados para volver a abrirlos con un clic.', vistasHtml(), { id: 'cx-vistas' })
        + cuerpo;
    },
    mount(ctx, el) {
      const msg = (t) => { const m = el.querySelector('#cx-msg'); if (m) { m.textContent = t; m.hidden = !t; } };
      X.bind(el, st, (k) => {
        if (k === 'ds') { Object.assign(st, defaults(st.ds)); }
        if (k === 'm') { const fl = DL.fieldOf(st.ds, st.m); st.agg = st.m === '__count' || !fl || fl.kind !== 'num' ? 'count' : (st.agg === 'count' ? 'mean' : st.agg); st.x = ''; }
        if (k === 'f') st.fv = '';
        if (k === 'top') st.top = parseInt(st.top, 10) || 0;
        normaliza();
        aHash();
      });
      const q = (id) => el.querySelector('#' + id);
      if (q('cx-guardar')) q('cx-guardar').onclick = async () => {
        const nombre = (q('cx-nombre').value || '').trim() || describirCorto().slice(0, 50);
        const v = Object.assign({}, leerVistas());
        const id = 'v' + Date.now().toString(36);
        v[id] = { name: nombre, cfg: snapshot(), at: Date.now() };
        const enPlataforma = await guardarVistas(v);
        X.rerender();
        const m = document.querySelector('#cx-msg');
        if (m) { m.textContent = `Vista «${nombre}» guardada${enPlataforma ? '' : ' en este navegador (la plataforma está en solo lectura)'}.`; m.hidden = false; }
      };
      if (q('cx-enlace')) q('cx-enlace').onclick = async () => {
        const url = location.href.split('#')[0] + aHash();
        try { await navigator.clipboard.writeText(url); msg('Enlace copiado. Al abrirlo, el gráfico aparece ya configurado.'); } catch (e) { msg('Copia este enlace: ' + url); }
      };
      if (q('cx-reset')) q('cx-reset').onclick = () => { Object.assign(st, defaults(st.ds)); aHash(); X.rerender(); };
      el.querySelectorAll('[data-vista-cargar]').forEach((b) => { b.onclick = () => { const v = leerVistas()[b.dataset.vistaCargar]; if (!v) return; Object.assign(st, defaults(v.cfg.ds || 'agua'), v.cfg); normaliza(); aHash(); X.rerender(); }; });
      el.querySelectorAll('[data-vista-borrar]').forEach((b) => { b.onclick = async () => { const v = Object.assign({}, leerVistas()); delete v[b.dataset.vistaBorrar]; await guardarVistas(v); try { const ls = JSON.parse(localStorage.getItem(VIEWS_LS) || '{}'); delete ls[b.dataset.vistaBorrar]; localStorage.setItem(VIEWS_LS, JSON.stringify(ls)); } catch (e) { /* sin almacenamiento */ } X.rerender(); }; });
    },
    hallazgos() { return []; },
  });

  /* ---------- El marco no quita los parámetros del enlace (#/analisis/constructor?ds=...) ---------- */
  try {
    const V = A.V && A.V.analisis;
    if (V && !V.__qs) {
      const clean = (a) => a.map((x) => String(x).split('?')[0]);
      const r0 = V.render, m0 = V.mount;
      V.render = (...a) => r0(...clean(a));
      V.mount = (...a) => m0(...clean(a));
      V.__qs = true;
    }
  } catch (e) { /* sin marco */ }
})();
