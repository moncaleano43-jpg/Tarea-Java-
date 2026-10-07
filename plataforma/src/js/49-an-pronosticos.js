/* ============================================================
   Análisis · Pronósticos
   Elige métrica, agregación y horizonte; App.Stats.forecast escoge el mejor modelo (lineal, Holt o media) comparando
   el error en el último 20 % de la serie (backtest) y entrega intervalo del 95 %, escenarios, cruce de metas y
   proyección de fin de mes para agua y recuperación.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.Analisis || !A.AnX) return;
  const X = A.AnX, S = X.S, AN = A.Analisis, ok = X.ok, esc = X.esc, f = X.f, fd = X.fd;
  const DAY = 86400000;
  const st = { m: 'aguaTotal', by: 'week', h: null, model: 'auto' };
  const metas = (k, d) => A.Metas.get(k, d);

  /** good: 'down' (menos es mejor) | 'up'. zero: los periodos sin registros valen 0 (conteos/sumas de eventos). */
  const METS = () => [
    { k: 'aguaTotal', l: 'Consumo de agua', u: 'm³', ds: 'agua', v: 'total', fn: 'sum', good: 'down', zero: false, minN: { day: 3, week: 15, month: 70 }, dec: 0 },
    { k: 'm3Aseo', l: 'Agua por aseo (m³)', u: 'm³', ds: 'agua', v: 'm3PerAseo', fn: 'mean', good: 'down', metas: [{ v: metas('agua.aseoM3', 10), dir: 'max', label: 'Meta ' + metas('agua.aseoM3', 10) + ' m³' }], dec: 1 },
    { k: 'merma', l: 'Merma (%)', u: '%', ds: 'merma', v: 'lossPct', fn: 'mean', good: 'down', pre: (r) => !r.flag, dec: 2 },
    { k: 'recVol', l: 'Cerveza recuperada (Hl)', u: 'Hl', ds: 'recuperacion', v: 'volume', fn: 'sum', good: 'up', zero: true, dec: 0 },
    { k: 'recH', l: 'Horas hasta recuperar', u: 'h', ds: 'recuperacion', v: 'hours', fn: 'mean', good: 'down', metas: [{ v: metas('recuperacion.objetivoH', 72), dir: 'max', label: 'Meta ' + metas('recuperacion.objetivoH', 72) + ' h' }, { v: metas('recuperacion.maximoH', 96), dir: 'max', label: 'Máximo ' + metas('recuperacion.maximoH', 96) + ' h' }], dec: 1 },
    { k: 'recPh', l: 'pH de recuperación', u: '', ds: 'recuperacion', v: 'ph', fn: 'mean', good: 'down', pre: (r) => r.ph > 3 && r.ph < 8, metas: [{ v: metas('recuperacion.phMax', 5.35), dir: 'max', label: 'Límite ' + metas('recuperacion.phMax', 5.35) }], dec: 2 },
    { k: 'trDelay', l: 'Desvío del trasiego (h)', u: 'h', ds: 'trasiego', v: 'delay', fn: 'mean', good: 'down', metas: [{ v: metas('trasiego.desvioMaxH', 1), dir: 'max', label: 'Límite ' + metas('trasiego.desvioMaxH', 1) + ' h' }], dec: 1 },
    { k: 'trDur', l: 'Duración del trasiego (h)', u: 'h', ds: 'trasiego', v: 'duration', fn: 'mean', good: 'down', pre: (r) => r.kind === 'Trasiego' && r.duration > 0 && r.duration <= 48, metas: [{ v: metas('trasiego.trasiegoH', 8.5), dir: 'max', label: 'Plan ' + metas('trasiego.trasiegoH', 8.5) + ' h' }], dec: 1 },
    { k: 'trN', l: 'N.º de actividades de trasiego', u: '', ds: 'trasiego', v: 'duration', fn: 'count', good: 'up', zero: true, dec: 0 },
    { k: 'aseosN', l: 'N.º de aseos', u: '', ds: 'aseos', v: 'm3', fn: 'count', good: 'up', zero: true, dec: 0 },
    { k: 'viab', l: 'Viabilidad de la levadura', u: '%', ds: 'lev', v: 'viab', fn: 'mean', good: 'up', metas: [{ v: metas('levadura.viabMin', 95), dir: 'min', label: 'Mínimo ' + metas('levadura.viabMin', 95) + ' %' }], dec: 1 },
    { k: 'h75', l: 'Horas hasta 75 % de atenuación', u: 'h', ds: 'ferm', v: 'h75', fn: 'mean', good: 'down', dec: 1 },
    { k: 'atten', l: 'Atenuación final (%)', u: '%', ds: 'ferm', v: 'atten', fn: 'mean', good: 'up', dec: 1 },
  ];
  const BY = { day: 'día', week: 'semana', month: 'mes' };
  const BYP = { day: 'días', week: 'semanas', month: 'meses' };
  const LIM = { day: 120, week: 52, month: 36 };
  const HDEF = { day: 14, week: 8, month: 3 };

  /* ---------- Series ---------- */
  const startOf = (t, by) => {
    const d = new Date(t);
    if (by === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    if (by === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const nextOf = (t, by) => {
    const d = new Date(t);
    if (by === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    if (by === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  };
  const labelOf = (t, by) => A.DL.periodKey(t, by).label;

  function serie(ctx, M, by) {
    const to = ctx.rango.to;
    const rows = X.todo(ctx, M.ds).filter((r) => r.t <= to && (!M.pre || M.pre(r)));
    if (!rows.length) return null;
    const ag = S.aggregate(rows, { t: 't', v: M.v, fn: M.fn, by });
    const mp = new Map(ag.map((a) => [a.t, a]));
    if (!ag.length) return null;
    const first = ag[0].t;
    const pts = [];
    let t = first, guard = 0;
    while (guard++ < 5000) {
      const end = nextOf(t, by) - 1;
      const a = mp.get(t);
      const complete = end <= to;
      let v = a ? a.v : (M.zero ? 0 : null);
      if (a && M.minN && M.minN[by] && a.n < M.minN[by]) v = null;
      pts.push({ t, label: labelOf(t, by), v, n: a ? a.n : 0, complete });
      if (!complete) break;
      t = nextOf(t, by);
      if (t > to) break;
    }
    const comp = pts.filter((p) => p.complete);
    const last = pts[pts.length - 1];
    const parcial = last && !last.complete && last.v != null ? last : null;
    const hist = comp.slice(-LIM[by]);
    const valid = hist.filter((p) => p.v != null);
    return { pts: hist, valid, parcial, all: pts };
  }

  /* ---------- Modelo ---------- */
  function modelo(sr, M, h, by) {
    const y = sr.valid.map((p) => p.v);
    if (y.length < 4) return null;
    const fc = S.forecast(y, { h, level: 0.95, method: st.model === 'auto' ? 'auto' : st.model });
    if (!fc) return null;
    const lastT = sr.pts[sr.pts.length - 1].t;
    const fut = [];
    let t = lastT;
    for (let i = 0; i < h; i++) { t = nextOf(t, by); fut.push({ t, label: labelOf(t, by) }); }
    const err = fc.backtest ? fc.backtest.rmse : fc.rmse;
    const pts = fc.points.map((p, i) => {
      const goodDown = M.good === 'down';
      const lo = p.lo, hi = p.hi;
      const nonNeg = M.zero || M.fn === 'sum' || M.fn === 'count' || ['lossPct', 'm3PerAseo', 'hours', 'volume', 'viab', 'h75'].includes(M.v);
      const cl = (v) => (nonNeg && ok(v) ? Math.max(0, v) : v);
      return { ...fut[i], y: cl(p.y), lo: cl(lo), hi: cl(hi), opt: cl(p.y + (goodDown ? -err : err)), pes: cl(p.y + (goodDown ? err : -err)) };
    });
    // tendencia reciente: últimos k periodos
    const k = Math.min(y.length, Math.max(6, Math.min(12, Math.floor(y.length * 0.6))));
    const yk = y.slice(-k);
    const lr = S.linreg(yk.map((_, i) => i), yk);
    return { fc, pts, y, err, lr, k, h };
  }

  /* ---------- Cruce de metas y riesgo ---------- */
  function cruces(M, mod, by) {
    if (!M.metas || !mod) return [];
    const { lr, k, pts, y } = mod;
    const cur = lr ? lr.predict(k - 1) : y[y.length - 1];
    const slope = lr ? lr.b : 0;
    return M.metas.map((m) => {
      const dir = m.dir; // 'max': no debe pasar; 'min': no debe bajar
      const ya = dir === 'max' ? cur > m.v : cur < m.v;
      let cuando = null, txt;
      const acerca = dir === 'max' ? slope > 0 : slope < 0;
      if (ya) txt = `La tendencia reciente ya está ${dir === 'max' ? 'por encima' : 'por debajo'} de ${esc(m.label.toLowerCase())} (nivel actual ${f(cur, M.dec + 1)}).`;
      else if (!acerca || Math.abs(slope) < 1e-9) txt = `Con la tendencia de los últimos ${k} periodos no se cruzaría ${esc(m.label.toLowerCase())}: ${slope === 0 ? 'la serie está plana' : 'se aleja de la meta'}.`;
      else {
        const per = (m.v - cur) / slope;
        let t = mod.pts[0].t; for (let i = 0; i < Math.ceil(per) - 1; i++) t = nextOf(t, by);
        cuando = { per, t };
        txt = per > 60 ? `Con esta tendencia no se cruzaría ${esc(m.label.toLowerCase())} en un horizonte razonable (más de ${f(per, 0)} ${BYP[by]}).` : `A este ritmo (${slope > 0 ? '+' : ''}${f(slope, M.dec + 2)} por ${BY[by]}) se cruzaría <strong>${esc(m.label.toLowerCase())}</strong> en unos <strong>${f(per, 0)} ${per === 1 ? BY[by] : BYP[by]}</strong>, hacia ${esc(fd(t))}.`;
      }
      const signif = lr && lr.p != null && lr.p < 0.05;
      const base = pts.some((p) => (dir === 'max' ? p.y > m.v : p.y < m.v));
      const banda = pts.some((p) => (dir === 'max' ? p.hi > m.v : p.lo < m.v));
      const riesgo = ya || base ? 'bad' : banda ? 'warn' : 'ok';
      return { meta: m, txt, cuando, signif, riesgo, ya, base, banda, nivel: cur, slope };
    });
  }

  /* ---------- Fin de mes ---------- */
  function finMes(ctx, ds, key, opts) {
    const rows = X.todo(ctx, ds).filter((r) => ok(r[key]) && r.t <= ctx.rango.to && (!opts.pre || opts.pre(r)));
    if (!rows.length) return null;
    const lastRow = rows[rows.length - 1].t;
    const T = opts.zero ? Math.max(lastRow, ctx.rango.to) : lastRow;
    const d = new Date(T);
    const m0 = new Date(d.getFullYear(), d.getMonth(), 1).getTime(), m1 = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const dim = Math.round((m1 - m0) / DAY), dia = d.getDate(), rem = dim - dia;
    const mtd = X.sum(rows.filter((r) => r.t >= m0).map((r) => r[key]));
    const dias = [];
    const tDay0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    for (let i = 0; i < 28; i++) {
      const tt = tDay0 - i * DAY;
      const loc = rows.filter((r) => r.t >= tt && r.t < tt + DAY);
      if (loc.length) dias.push(X.sum(loc.map((r) => r[key])));
      else if (opts.zero) dias.push(0);
    }
    const rate = S.mean(dias), sd = S.sd(dias) || 0;
    const proj = mtd + (rate || 0) * rem;
    const half = 1.96 * sd * Math.sqrt(Math.max(0, rem));
    const pm0 = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    const prevRows = rows.filter((r) => r.t >= pm0 && r.t < m0);
    const prevTot = prevRows.length ? X.sum(prevRows.map((r) => r[key])) : null;
    const prevSame = prevRows.length ? X.sum(prevRows.filter((r) => r.t < pm0 + dia * DAY).map((r) => r[key])) : null;
    return { T, lastRow, dia, dim, rem, mtd, rate, sd, proj, lo: Math.max(mtd, proj - half), hi: proj + half, prevTot, prevSame, mes: A.DL.periodKey(T, 'month').label, nDias: dias.length };
  }
  const aguaFM = (ctx) => finMes(ctx, 'agua', 'total', { zero: false });
  const recFM = (ctx) => finMes(ctx, 'recuperacion', 'volume', { zero: true });

  /* ---------- Estacionalidad semanal ---------- */
  function estacional(ctx, M) {
    const to = ctx.rango.to;
    const rows = X.todo(ctx, M.ds).filter((r) => r.t <= to && r.t >= to - 140 * DAY && (!M.pre || M.pre(r)));
    const ag = S.aggregate(rows, { t: 't', v: M.v, fn: M.fn, by: 'day' }).filter((a) => a.v != null && (!M.minN || a.n >= M.minN.day));
    if (ag.length < 21) return null;
    const lab = ag.map((a) => X.DIAS[(new Date(a.t).getDay() + 6) % 7]);
    const si = S.seasonalIndex(ag.map((a) => a.v), lab);
    const orden = X.DIAS.map((dname) => si.find((s) => s.label === dname)).filter(Boolean);
    const groups = {}; ag.forEach((a, i) => { (groups[lab[i]] = groups[lab[i]] || []).push(a.v); });
    const kw = Object.keys(groups).length >= 3 ? S.kruskal(groups) : null;
    return { orden, kw, n: ag.length };
  }

  /* ---------- Bloques ---------- */
  function controles(M, h) {
    const opts = METS().map((m) => [m.k, m.l]);
    return `<div class="an-controls">${X.sel('pr-m', 'Métrica', opts, st.m, 'm')}${X.sel('pr-by', 'Agrupar por', [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes']], st.by, 'by')}${X.num('pr-h', `Horizonte (${BYP[st.by]})`, h, 'h', 1, st.by === 'day' ? 60 : st.by === 'week' ? 26 : 12)}${X.sel('pr-mod', 'Modelo', [['auto', 'Automático (el de menor error)'], ['lineal', 'Línea de tendencia'], ['holt', 'Suavizado de Holt'], ['media', 'Promedio']], st.model, 'model')}</div>`;
  }

  function bloqueModelo(M, sr, mod, h, ctx, UI) {
    const by = st.by;
    const ctl = controles(M, h);
    if (!sr || sr.valid.length < 6) {
      return UI.card('Pronóstico', 'Qué esperar en los próximos periodos.', ctl + UI.vacio(`Hay solo ${sr ? sr.valid.length : 0} ${BYP[by]} con datos de «${M.l}». Prueba agrupando por ${by === 'day' ? 'semana' : 'mes'} o con otra métrica.`), { id: 'pr-modelo' });
    }
    if (!mod) return UI.card('Pronóstico', 'Qué esperar en los próximos periodos.', ctl + UI.vacio('No se pudo ajustar un modelo con esta serie.'), { id: 'pr-modelo' });
    const { fc, pts, y, err } = mod;
    const hist = sr.valid;
    const nH = hist.length;
    const labels = hist.map((p) => p.label).concat(pts.map((p) => p.label));
    const cat = (i) => i;
    const histPts = hist.map((p, i) => ({ x: i, y: p.v, label: `${p.label}: ${f(p.v, M.dec + 1)} ${M.u}` }));
    const lastPt = histPts[histPts.length - 1];
    const fcPts = [{ x: nH - 1, y: lastPt.y, label: lastPt.label }].concat(pts.map((p, i) => ({ x: nH + i, y: p.y, label: `${p.label} (pronóstico): ${f(p.y, M.dec + 1)} ${M.u} · IC 95 % ${f(p.lo, M.dec + 1)} a ${f(p.hi, M.dec + 1)}` })));
    const lo = new Array(nH).fill(null).concat(pts.map((p) => p.lo)), hi = new Array(nH).fill(null).concat(pts.map((p) => p.hi));
    const refs = (M.metas || []).map((m, i) => ({ y: m.v, label: m.label, color: i ? 'var(--neg)' : undefined }));
    const graf = X.fig('line', {
      title: `${M.l}: histórico y pronóstico por ${BY[by]}`, unit: M.u, full: true, h: 340, xLabels: labels, xType: 'category',
      series: [
        { name: 'Histórico', points: histPts, color: 'var(--est)', dots: nH <= 40 },
        { name: 'Pronóstico', points: fcPts, color: 'var(--ink)', dashed: true, dots: true },
        { name: 'Optimista', points: [{ x: nH - 1, y: lastPt.y }].concat(pts.map((p, i) => ({ x: nH + i, y: p.opt, label: `${p.label} · optimista: ${f(p.opt, M.dec + 1)}` }))), color: 'var(--pos)', dashed: true, dots: false, width: 1 },
        { name: 'Pesimista', points: [{ x: nH - 1, y: lastPt.y }].concat(pts.map((p, i) => ({ x: nH + i, y: p.pes, label: `${p.label} · pesimista: ${f(p.pes, M.dec + 1)}` }))), color: 'var(--neg)', dashed: true, dots: false, width: 1 },
      ],
      band: { name: 'Intervalo de confianza 95 %', lo, hi }, refs, yFmt: (v) => f(v, M.dec > 1 ? 1 : M.dec),
    });
    const bt = fc.backtest;
    const metodoTxt = { lineal: 'línea de tendencia', holt: 'suavizado de Holt (nivel + tendencia)', media: 'promedio' }[fc.method];
    const unidad = M.u ? ' ' + M.u : '';
    const cand = fc.candidates ? Object.entries(fc.candidates).map(([k, v]) => ({ modelo: { lineal: 'Línea de tendencia', holt: 'Suavizado de Holt', media: 'Promedio' }[k], mae: v.mae, esc: k === fc.method ? 'Elegido' : '', source: 'Backtest 20 %' })) : [];
    const tabCand = cand.length ? UI.tabla([{ k: 'modelo', t: 'Modelo' }, { k: 'mae', t: `Error medio (MAE${unidad})`, num: 1, f: (v) => f(v, M.dec + 1) }, { k: 'esc', t: '' }], cand, { id: 'tb-pr-cand', nombre: 'pronostico_modelos', max: 5, sort: { k: 'mae', dir: 1 } }) : '';
    const last = y[y.length - 1], end = pts[pts.length - 1];
    const cambio = X.dpct(end.y, last);
    const esc3 = (lab, v, cls, extra) => `<div class="${cls}"><span>${lab}</span><b>${f(v, M.dec + 1)}${unidad}</b><small>${extra}</small></div>`;
    const dch = (v) => { const c = X.dpct(v, last); return c == null ? '' : `${c >= 0 ? '+' : ''}${f(c, 1)} % frente al último dato`; };
    const escenarios = `<div class="an-esc">${esc3('Optimista', end.opt, 'ok', dch(end.opt))}${esc3('Base', end.y, '', dch(end.y))}${esc3('Pesimista', end.pes, 'bad', dch(end.pes))}</div><p class="an-note"><b>Escenarios</b> a ${h} ${h === 1 ? BY[by] : BYP[by]} (${esc(end.label)}): el base es el pronóstico; optimista y pesimista suman o restan un error típico del modelo (${f(err, M.dec + 1)}${unidad}) en la dirección buena o mala para «${esc(M.l.toLowerCase())}» (${M.good === 'down' ? 'menos es mejor' : 'más es mejor'}).</p>`;
    const l = mod.lr;
    const tend = l && l.p != null ? `La <strong>tendencia reciente</strong> (últimos ${mod.k} ${BYP[by]}) es de ${l.b >= 0 ? '+' : '−'}${f(Math.abs(l.b), M.dec + 2)}${unidad} por ${BY[by]} (${X.sig(l.p, l.n)}). <strong>Si la tendencia continúa</strong>, en ${h} ${h === 1 ? BY[by] : BYP[by]} estaría en ${f(l.predict(mod.k - 1 + h), M.dec + 1)}${unidad}; el modelo ${esc(metodoTxt)} dice ${f(end.y, M.dec + 1)}${unidad} (${cambio != null ? (cambio >= 0 ? '+' : '') + f(cambio, 1) + ' %' : '—'} frente al último dato), con 95 % de confianza entre ${f(end.lo, M.dec + 1)} y ${f(end.hi, M.dec + 1)}.` : '';
    const calidad = bt
      ? `En una prueba con datos que el modelo no vio (el último 20 %: ${bt.n} ${BYP[by]}), <strong>se equivocó en promedio ${f(bt.mae, M.dec + 1)}${unidad}${bt.mape != null ? ` (${f(bt.mape, 0)} %)` : ''}</strong>, y el intervalo del 95 % contuvo ${f(bt.coverage * bt.n, 0)} de ${bt.n} valores reales (cobertura ${f(bt.coverage * 100, 0)} %).`
      : 'Hay muy pocos datos para hacer una prueba de error; el intervalo es solo orientativo.';
    const aviso = y.length < 12 ? ' Con menos de 12 periodos de historia el pronóstico es frágil: úsalo como orientación.' : '';
    const sinPron = bt && bt.mape != null && bt.mape > 40 ? ' El error es alto frente al valor: la serie es muy irregular y el pronóstico sirve solo para ver el orden de magnitud.' : '';
    const parcial = sr.parcial ? ` El ${BY[by]} en curso (${esc(sr.parcial.label)}) va en ${f(sr.parcial.v, M.dec + 1)}${unidad} y no entra al ajuste por estar incompleto.` : '';
    const lectura = UI.lectura(`El modelo escogido automáticamente es <strong>${esc(metodoTxt)}</strong> (${st.model === 'auto' ? 'el de menor error entre línea de tendencia, Holt y promedio' : 'elegido por ti'}). ${calidad}${aviso}${sinPron} ${tend}${parcial}`, y.length < 12 ? 'warn' : '');
    return UI.card('Pronóstico', `${M.l}: lo que se espera en los próximos ${h} ${h === 1 ? BY[by] : BYP[by]} con intervalo de confianza del 95 %.`, ctl + graf + escenarios + lectura + (tabCand ? `<details class="an-det"><summary>Ver cómo se compararon los modelos</summary>${tabCand}</details>` : ''), { id: 'pr-modelo' });
  }

  function bloqueMetas(M, cr, UI) {
    if (!M.metas) return '';
    if (!cr.length) return '';
    const items = cr.map((c) => {
      const tono = c.riesgo;
      const titulo = c.riesgo === 'bad' ? 'Riesgo alto' : c.riesgo === 'warn' ? 'Riesgo medio' : 'Riesgo bajo';
      const det = c.riesgo === 'bad' ? (c.ya ? 'La serie ya está fuera de la meta.' : 'El pronóstico base cruza la meta dentro del horizonte.') : c.riesgo === 'warn' ? 'El pronóstico base se mantiene dentro, pero el intervalo de confianza toca la meta.' : 'Ni el pronóstico base ni su intervalo tocan la meta en el horizonte elegido.';
      return `<div class="an-riesgo ${tono}"><i></i><div><b>${titulo} · ${esc(c.meta.label)}.</b> ${det}<br>${c.txt}${c.signif ? '' : ' <small>La pendiente reciente no es estadísticamente distinta de cero, así que la fecha de cruce es incierta.</small>'}</div></div>`;
    }).join('');
    return UI.card('¿Cuándo se cruzaría la meta?', 'Cruce de la tendencia reciente con las metas de Configuración, y alerta de riesgo según el pronóstico.', items, { id: 'pr-metas' });
  }

  function tarjetaFM(titulo, unidad, fm, UI, dec, good) {
    if (!fm) return UI.vacio('Sin datos de este mes.');
    const vsPrev = fm.prevTot != null ? X.dpct(fm.proj, fm.prevTot) : null;
    const vsSame = fm.prevSame != null ? X.dpct(fm.mtd, fm.prevSame) : null;
    const graf = X.fig('bars', {
      title: titulo, unit: unidad, h: 240, categories: ['Mes anterior (total)', `Acumulado al ${fm.dia}`, 'Proyección fin de mes'],
      series: [{ name: unidad, values: [fm.prevTot, fm.mtd, fm.proj], color: 'var(--est)' }], yFmt: (v) => f(v, dec),
    });
    const bien = vsPrev == null ? '' : (vsPrev > 0) === (good === 'up') ? 'ok' : 'warn';
    const txt = UI.lectura(`Al ${fm.dia} de ${esc(fm.mes)} van <strong>${f(fm.mtd, dec)} ${unidad}</strong>. Al ritmo de los últimos 28 días (${f(fm.rate, 1)} ${unidad} por día${fm.sd ? `, variación diaria ±${f(fm.sd, 1)}` : ''}), el mes cerraría en <strong>${f(fm.proj, dec)} ${unidad}</strong>, con 95 % de confianza entre ${f(fm.lo, dec)} y ${f(fm.hi, dec)}.${fm.prevTot != null ? ` El mes anterior sumó ${f(fm.prevTot, dec)}: la proyección es ${vsPrev >= 0 ? '+' : ''}${f(vsPrev, 1)} % frente a ese total${vsSame != null ? `, y lo acumulado va ${vsSame >= 0 ? '+' : ''}${f(vsSame, 1)} % frente al mismo día del mes anterior` : ''}.` : ''} Faltan ${fm.rem} día${fm.rem === 1 ? '' : 's'}.${fm.T - fm.lastRow > 7 * DAY ? ` El último dato registrado es del ${esc(fd(fm.lastRow))}.` : ''}`, bien);
    return graf + txt;
  }
  function bloqueFinMes(ctx, UI) {
    const a = aguaFM(ctx), r = recFM(ctx);
    if (!a && !r) return '';
    return UI.card('Pronóstico de fin de mes', 'Agua y cerveza recuperada: cuánto llevan y cómo cerrarían el mes si siguen al ritmo de los últimos 28 días.', UI.grid([`<div><p class="an-sub">Consumo de agua</p>${tarjetaFM('Agua del mes (m³)', 'm³', a, UI, 0, 'down')}</div>`, `<div><p class="an-sub">Cerveza recuperada</p>${tarjetaFM('Recuperación del mes (Hl)', 'Hl', r, UI, 0, 'up')}</div>`], 2), { id: 'pr-mes' });
  }

  function bloqueEstacional(M, ctx, UI) {
    const es = estacional(ctx, M);
    if (!es) return UI.card('Estacionalidad semanal', 'Qué día de la semana tiende a ser más alto o más bajo.', UI.vacio('Se necesitan al menos 21 días con datos de esta métrica en los últimos 140 días.'), { id: 'pr-estac' });
    const graf = X.fig('bars', { title: `Índice por día de la semana: ${M.l}`, full: true, h: 260, categories: es.orden.map((s) => s.label.slice(0, 3)), series: [{ name: 'Índice (1 = promedio)', values: es.orden.map((s) => s.index), color: 'var(--est)' }], refs: [{ y: 1 }], yFmt: (v) => f(v, 2) });
    const mx = es.orden.slice().sort((a, b) => b.index - a.index)[0], mn = es.orden.slice().sort((a, b) => a.index - b.index)[0];
    const real = es.kw && es.kw.p < 0.05;
    const lectura = UI.lectura(`Un índice de 1 es un día promedio. El día más alto es <strong>${esc(mx.label)}</strong> (${f((mx.index - 1) * 100, 0)} % ${mx.index >= 1 ? 'sobre' : 'bajo'} el promedio) y el más bajo <strong>${esc(mn.label)}</strong> (${f(Math.abs(mn.index - 1) * 100, 0)} % ${mn.index >= 1 ? 'sobre' : 'bajo'}). ${es.kw ? (real ? `La diferencia entre días <strong>sí es real</strong> (Kruskal-Wallis, ${X.pt(es.kw.p)}): conviene planear con ese patrón.` : `La diferencia entre días <strong>no se distingue de la casualidad</strong> (Kruskal-Wallis, ${X.pt(es.kw.p)}): no hay un patrón semanal confiable.`) : ''} Calculado con ${es.n} días de los últimos 140.`, real ? 'ok' : '');
    return UI.card('Estacionalidad semanal', 'Patrón por día de la semana de la métrica elegida (últimos 140 días).', graf + lectura, { id: 'pr-estac' });
  }

  function estado(ctx) {
    const lista = METS();
    let M = lista.find((m) => m.k === st.m) || lista[0];
    const h = ok(st.h) && st.h >= 1 ? Math.floor(st.h) : HDEF[st.by];
    return { M, h };
  }

  A.Analisis.registrar({
    id: 'pronosticos', label: 'Pronósticos', orden: 9,
    render(ctx, UI) {
      const { M, h } = estado(ctx);
      const tot = X.todo(ctx, M.ds).filter((r) => r.t <= ctx.rango.to).length;
      const dat = X.memo(ctx, 'pron', [M.ds], () => { const sr = serie(ctx, M, st.by); const mod = sr ? modelo(sr, M, h, st.by) : null; return { sr, mod }; }, [M.k, st.by, h, st.model].join(','));
      const aviso = `<p class="an-note"><strong>Ojo</strong> El pronóstico usa el histórico disponible hasta ${esc(AN.fmtDate(ctx.rango.to))} (no solo el periodo elegido) y respeta el filtro de marca. Los pronósticos son estimaciones: asume que el proceso se comporta como en el pasado.</p>`;
      if (!tot) return UI.card('Pronóstico', 'Qué esperar en los próximos periodos.', controles(M, h) + UI.vacio('No hay datos de esta métrica' + (ctx.filtraMarca ? ' con las marcas elegidas' : '') + '.'));
      const cr = cruces(M, dat.mod, st.by);
      return bloqueModelo(M, dat.sr, dat.mod, h, ctx, UI) + bloqueMetas(M, cr, UI) + bloqueFinMes(ctx, UI) + bloqueEstacional(M, ctx, UI) + aviso;
    },
    mount(ctx, el) {
      X.bind(el, st, (k) => { if (k === 'by' || k === 'm') st.h = null; });
    },
    hallazgos(ctx) {
      const out = [];
      const a = aguaFM(ctx), r = recFM(ctx);
      if (a && a.prevTot != null) {
        const c = X.dpct(a.proj, a.prevTot);
        if (c != null && Math.abs(c) >= 5) out.push({ sev: c > 10 ? 'media' : 'info', titulo: `El agua de ${a.mes} cerraría ${c > 0 ? 'por encima' : 'por debajo'} del mes anterior`, detalle: `Proyección ${f(a.proj, 0)} m³ (IC 95 %: ${f(a.lo, 0)}–${f(a.hi, 0)}) frente a ${f(a.prevTot, 0)} m³ del mes anterior.`, valor: (c > 0 ? '+' : '') + f(c, 0) + ' %' });
      }
      if (r && r.prevTot != null) {
        const c = X.dpct(r.proj, r.prevTot);
        if (c != null && Math.abs(c) >= 10) out.push({ sev: c < -15 ? 'media' : 'info', titulo: `La cerveza recuperada de ${r.mes} cerraría ${c > 0 ? 'por encima' : 'por debajo'} del mes anterior`, detalle: `Proyección ${f(r.proj, 0)} Hl frente a ${f(r.prevTot, 0)} Hl.`, valor: (c > 0 ? '+' : '') + f(c, 0) + ' %' });
      }
      for (const M of METS().filter((m) => m.metas)) {
        try {
          const by = 'week', h = 8;
          const sr = serie(ctx, M, by);
          if (!sr || sr.valid.length < 10) continue;
          const mod = modelo(sr, M, h, by);
          const cr = cruces(M, mod, by).filter((c) => c.riesgo === 'bad' && !c.ya && c.cuando && c.cuando.per <= 8);
          if (cr[0]) out.push({ sev: 'media', titulo: `${M.l}: riesgo de cruzar la meta en ~${f(cr[0].cuando.per, 0)} semanas`, detalle: `Con la tendencia reciente se cruzaría ${cr[0].meta.label.toLowerCase()} hacia ${fd(cr[0].cuando.t)}.` });
        } catch (e) { /* métrica sin datos */ }
      }
      return out;
    },
  });
})();
