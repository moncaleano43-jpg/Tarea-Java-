/* ============================================================
   Análisis · Recuperación de cerveza  (+ utilidades compartidas App.AnX para las pestañas 46–4a)
   Fuente: tabla plana App.DL.recuperacion + columnas crudas de «Control Recuperada» (presión, extracto, operarios).
   Fórmulas del Excel del usuario: hl a 9,5 °P = hl × (E·260/(260−E)) / (9,5·260/(260−9,5)); kg = hl 9,5 °P × 9,86.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.Analisis || !A.Stats || !A.Charts || !A.DL) return;
  const S = A.Stats, C = A.Charts, AN = A.Analisis;
  const esc = AN.esc, f = AN.fmt, fp = AN.fmtPct, fP = AN.fmtP, fd = AN.fmtDate;
  const ok = (v) => typeof v === 'number' && Number.isFinite(v);

  /* ============================================================
     Utilidades compartidas (App.AnX)
     ============================================================ */
  const X = (A.AnX = A.AnX || {});
  const MEMO = new Map();
  window.addEventListener('hashchange', () => MEMO.clear());
  let uid = 0;
  Object.assign(X, {
    S, C, ok, esc, f, fp, fP, fd,
    DIAS: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
    memo(ctx, name, deps, fn, extra) {
      const e = ctx.estado, r = ctx.rango;
      const key = [name, r.from, r.to, e.brands.join(','), e.comparar, (deps || []).map((d) => A.DL.get(d).length).join(','), extra || ''].join('|');
      if (MEMO.has(key)) return MEMO.get(key);
      const v = fn();
      MEMO.set(key, v);
      if (MEMO.size > 90) MEMO.delete(MEMO.keys().next().value);
      return v;
    },
    clearMemo() { MEMO.clear(); },
    /** Nombre «bonito»: pasa MAYÚSCULAS a Título (el programa convierte solas las etiquetas todo en mayúsculas). */
    tc(v) {
      const t = String(v == null ? '' : v).trim();
      if (!t || t !== t.toUpperCase()) return t;
      return t.split(/(\s+)/).map((w) => (/\d|^(FV|SV|UTK|UTQ|CIP|GEA|YPT|TQ|BUD|BSSI|PQ|CO2|ATP|PH|II|III|IV|STL|PML|CMP|O2)$/.test(w) || !/[A-ZÁÉÍÓÚÑ]{2}/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join('');
    },
    id: (p) => (p || 'anx') + (++uid),
    vals: (rows, k) => rows.map((r) => r[k]).filter(ok),
    sum: (xs) => xs.reduce((a, b) => a + (ok(b) ? b : 0), 0),
    mean: (xs) => { const v = xs.filter(ok); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; },
    median: (xs) => S.median(xs.filter(ok)),
    pl: (n, s, p) => `${f(n, 0)} ${n === 1 ? s : p}`,
    pctOf: (a, b) => (b > 0 ? (a / b) * 100 : null),
    /** Variación porcentual entre dos valores (para KPI). */
    dpct: (a, b) => (ok(a) && ok(b) && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null),
    /** Rejilla de KPIs: [{label,value,unit,help,cur,prev,good:'up'|'down',spark}] */
    kpis(items) {
      const parse = (v) => (typeof v === 'string' && /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(v) ? Number(v.replace(/\./g, '').replace(',', '.')) : v);
      return `<div class="an-kpis an-k${items.length <= 4 ? items.length : 4}">${items.map((k) => C.kpi({
        label: k.label, value: parse(k.value), unit: k.unit, help: k.help, spark: k.spark,
        delta: k.delta !== undefined ? k.delta : (A.AnX.dpct(k.cur, k.prev) != null && Math.abs(A.AnX.dpct(k.cur, k.prev)) >= 0.05 ? A.AnX.dpct(k.cur, k.prev) : null),
        deltaGood: k.good === 'down' ? 'down' : 'up',
      })).join('')}</div>`;
    },
    /** Figura con barra de descarga PNG/SVG. */
    fig(kind, o) { return C[kind](Object.assign({ toolbar: true, id: X.id('anc') }, o)); },
    /** Explica un p-valor en palabras simples. */
    grid12(a, b) { return `<div class="an-grid an-g-12">${a}${b}</div>`; },
    sig(p, n) {
      if (p == null) return 'no se pudo calcular la significancia';
      const pp = `${X.pt(p)}`;
      const peq = n != null && n < 10 ? ' (con tan pocos datos tómalo solo como pista)' : '';
      if (p < 0.01) return `es muy poco probable que sea casualidad (${pp})${peq}`;
      if (p < 0.05) return `probablemente es real y no casualidad (${pp})${peq}`;
      return `no se distingue de la casualidad (${pp})${peq}`;
    },
    efectoD(d) { const a = Math.abs(d); return a < 0.2 ? 'insignificante' : a < 0.5 ? 'pequeño' : a < 0.8 ? 'mediano' : 'grande'; },
    efectoEta(e) { return e == null ? '—' : e < 0.01 ? 'insignificante' : e < 0.06 ? 'pequeño' : e < 0.14 ? 'mediano' : 'grande'; },
    pt: (p) => (p == null ? 'p = —' : p < 0.001 ? 'p < 0,001' : 'p = ' + fP(p)),
    fuerza(r) { const a = Math.abs(r); return a >= 0.8 ? 'muy fuerte' : a >= 0.6 ? 'fuerte' : a >= 0.4 ? 'moderada' : a >= 0.2 ? 'débil' : 'casi nula'; },
    badge(txt, tono) { return `<span class="an-badge ${tono || ''}">${esc(txt)}</span>`; },
    /** Mann-Kendall + pendiente de Sen con texto. good: 'down' (bajar es bueno) | 'up' | null */
    tendencia(vals, good) {
      const v = vals.filter(ok);
      if (v.length < 4) return null;
      const mk = S.mannKendall(v), sen = S.senSlope(v);
      if (!mk) return null;
      const dir = mk.trend === 'sube' ? 1 : mk.trend === 'baja' ? -1 : 0;
      const tono = dir === 0 || !good ? '' : ((dir > 0) === (good === 'up') ? 'ok' : 'bad');
      return { n: v.length, mk, sen, dir, tono, trend: mk.trend, p: mk.p, tau: mk.tau };
    },
    /** Controles de selección (selects) marcados con data-st para enlazarlos a un objeto de estado. */
    sel(id, label, opts, val, st) {
      return `<label class="an-ctl"><span>${esc(label)}</span><select id="${id}" data-st="${st || id}">${opts.map((o) => `<option value="${esc(o[0])}" ${String(o[0]) === String(val) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
    },
    chk(id, label, val, st) {
      return `<label class="an-ctl an-ctl-c"><input type="checkbox" id="${id}" data-st="${st || id}" ${val ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    },
    num(id, label, val, st, min, max) {
      return `<label class="an-ctl"><span>${esc(label)}</span><input type="number" id="${id}" data-st="${st || id}" value="${esc(val)}" min="${min}" max="${max}"></label>`;
    },
    rerender(focusId) {
      const y = window.scrollY;
      AN.repintar();
      window.scrollTo(0, y);
      if (focusId) { const e = document.getElementById(focusId); if (e && e.focus) e.focus({ preventScroll: true }); }
    },
    /** Enlaza controles [data-st] dentro de `root` con el objeto `state` y repinta al cambiar. */
    bind(root, state, after) {
      root.querySelectorAll('[data-st]').forEach((el) => {
        el.addEventListener('change', () => {
          const k = el.dataset.st;
          state[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value;
          if (after) after(k, state[k]);
          X.rerender(el.id);
        });
      });
    },
    /** Rango de fechas de los datos de un conjunto (sin filtros) respetando marcas del marco. */
    todo(ctx, ds) {
      const hasBrand = ['merma', 'recuperacion', 'trasiego', 'ferm', 'lev'].includes(ds);
      return A.DL.filterRows(A.DL.get(ds), { where: hasBrand && ctx.estado.brands.length ? (r) => ctx.estado.brands.includes(r.brand) : null });
    },
    /** Agrega filas por semana/mes/día con App.Stats.aggregate. */
    agg(rows, vk, fn, by, tk) { return S.aggregate(rows, { t: tk || 't', v: vk, fn: fn || 'sum', by: by || 'week' }); },
    monthsCover(from, to) { // etiqueta de agrupación según el largo del periodo
      const dias = (to - from) / 86400000;
      return dias >= 75 ? 'month' : dias >= 21 ? 'week' : 'day';
    },
    toast(msg) { try { if (A.UI && A.UI.toast) A.UI.toast(msg); } catch (e) { /* sin aviso */ } },
  });

  /* ============================================================
     Datos de recuperación
     ============================================================ */
  const N = A.DL.N;
  const rawExtra = () => {
    const m = new Map();
    let recs = [];
    try { recs = A.OperationSources.records('recuperacion', 'Control Recuperada'); } catch (e) { /* sin fuente */ }
    for (const r of recs) {
      const c = r.cells || {};
      m.set(r.id, { presionCierre: N(c[28]), tempCierre: N(c[29]), presion: N(c[39]), extracto: N(c[45]), operCierre: c[30] ? String(c[30]).trim() : '', operario: c[43] ? String(c[43]).trim() : '' });
    }
    return m;
  };
  const metas = () => ({
    obj: A.Metas.get('recuperacion.objetivoH', 72), max: A.Metas.get('recuperacion.maximoH', 96),
    ph: A.Metas.get('recuperacion.phMax', 5.35), phObj: A.Metas.get('recuperacion.phObjetivo', 4.4), temp: A.Metas.get('recuperacion.tempMax', 2),
    pres: A.Metas.get('recuperacion.presionMax', 5), aMin: A.Metas.get('recuperacion.aguaMin', 49), aMax: A.Metas.get('recuperacion.aguaMax', 51),
  });
  function enrich(rows, ex, now) {
    const M = metas();
    return rows.map((r) => {
      const e = ex.get(r.id) || {};
      const E = ok(e.extracto) && e.extracto > 5 && e.extracto < 25 ? e.extracto : null;
      const hl95 = ok(r.volume) && E ? (r.volume * ((E * 260) / (260 - E))) / ((9.5 * 260) / (260 - 9.5)) : null;
      const utkN = /19/.test(r.utk) ? 'UTK 19' : /20/.test(r.utk) ? 'UTK 20' : (r.utk || '').trim() || '(sin dato)';
      const waterPct = r.yeast > 0 && r.waterHl > 0 ? (r.waterHl / r.yeast) * 100 : null;
      const hOpen = r.hours == null && r.begin != null && r.volume == null ? (now - r.begin) / 3600000 : null;
      return Object.assign({}, r, {
        utkN, brandN: r.brand ? X.tc(r.brand) : '(sin marca)', waterPct, extracto: E, hl95, kg: hl95 != null ? hl95 * 9.86 : null,
        presion: ok(e.presion) && e.presion > 0 ? e.presion : null, presionCierre: ok(e.presionCierre) && e.presionCierre > 0 ? e.presionCierre : null,
        tempOk: ok(r.temp) && r.temp > 0 ? r.temp : null, phOk: ok(r.ph) && r.ph > 3 && r.ph < 8 ? r.ph : null,
        operario: e.operario || '', hOpen,
        fPh: ok(r.ph) && r.ph > 3 && r.ph < 8 ? r.ph > M.ph : null,
        fTemp: ok(r.temp) && r.temp > 0 ? r.temp > M.temp : null,
        fPres: ok(e.presion) && e.presion > 0 ? e.presion > M.pres : null,
        fAgua: waterPct != null ? waterPct < M.aMin || waterPct > M.aMax : null,
      });
    });
  }
  function resumen(rs) {
    const M = metas();
    const h = X.vals(rs, 'hours');
    const vol = X.sum(rs.map((r) => r.volume));
    const con95 = rs.filter((r) => r.hl95 != null);
    return {
      n: rs.length, vol, yeast: X.sum(rs.map((r) => r.yeast)), water: X.sum(rs.map((r) => r.waterHl)),
      hl95: X.sum(con95.map((r) => r.hl95)), kg: X.sum(con95.map((r) => r.kg)), nE: con95.length,
      hMean: X.mean(h), hMed: X.median(h), nH: h.length,
      a72: h.filter((x) => x <= M.obj).length, a96: h.filter((x) => x > M.obj && x <= M.max).length, m96: h.filter((x) => x > M.max).length,
      yieldMean: X.mean(rs.map((r) => r.yieldPct)), yieldAgg: X.sum(rs.map((r) => (r.yeast > 0 && ok(r.volume) ? r.volume : 0))) / (X.sum(rs.map((r) => (r.yeast > 0 && ok(r.volume) ? r.yeast : 0))) || NaN) * 100,
      ph: X.mean(rs.map((r) => r.phOk)), temp: X.mean(rs.map((r) => r.tempOk)),
      phOut: rs.filter((r) => r.fPh).length, phN: rs.filter((r) => r.fPh != null).length,
      tOut: rs.filter((r) => r.fTemp).length, tN: rs.filter((r) => r.fTemp != null).length,
      pOut: rs.filter((r) => r.fPres).length, pN: rs.filter((r) => r.fPres != null).length,
      wOut: rs.filter((r) => r.fAgua).length, wN: rs.filter((r) => r.fAgua != null).length,
    };
  }

  function calc(ctx) {
    return X.memo(ctx, 'rec', ['recuperacion'], () => {
      const ex = rawExtra();
      const now = Math.min(Date.now(), ctx.rango.to);
      const rows = enrich(ctx.rows('recuperacion'), ex, now).sort((a, b) => a.t - b.t);
      const prev = enrich(ctx.previas('recuperacion'), ex, now);
      return { rows, prev, R: resumen(rows), P: prev.length >= 5 ? resumen(prev) : null, now };
    });
  }

  /* ============================================================
     Bloques
     ============================================================ */
  const hoursTxt = (h) => (h == null ? '—' : f(h, 1) + ' h');
  const day = (t) => fd(t);

  function bloqueKpis(d) {
    const { R, P } = d, M = metas();
    const pc = (a, n) => (n > 0 ? (a / n) * 100 : null);
    const pOn = pc(R.a72, R.nH), pOnP = P ? pc(P.a72, P.nH) : null;
    const pLate = pc(R.m96, R.nH), pLateP = P ? pc(P.m96, P.nH) : null;
    return X.kpis([
      { label: 'Recuperaciones', value: f(R.n, 0), help: 'En el periodo', cur: R.n, prev: P && P.n, good: 'up' },
      { label: 'Cerveza recuperada', value: f(R.vol, 0), unit: 'Hl', help: `Levadura recolectada ${f(R.yeast, 0)} Hl`, cur: R.vol, prev: P && P.vol, good: 'up' },
      { label: 'Equivalente a 9,5 °P', value: R.nE ? f(R.hl95, 0) : '—', unit: 'Hl', help: R.nE < R.n ? `Con extracto en ${R.nE} de ${R.n}` : 'Todas con extracto', cur: R.hl95, prev: P && P.hl95, good: 'up' },
      { label: 'Kg ahorrados', value: R.nE ? f(R.kg, 0) : '—', unit: 'kg', help: 'Hl a 9,5 °P × 9,86', cur: R.kg, prev: P && P.kg, good: 'up' },
      { label: 'Horas hasta recuperar', value: R.hMed != null ? f(R.hMed, 1) : '—', unit: 'h', help: `Mediana · meta ${M.obj} h`, cur: R.hMed, prev: P && P.hMed, good: 'down' },
      { label: `Dentro de ${M.obj} h`, value: pOn != null ? f(pOn, 0) : '—', unit: '%', help: `${R.a72} de ${R.nH} con tiempo medido`, cur: pOn, prev: pOnP, good: 'up' },
      { label: `Pasaron de ${M.max} h`, value: pLate != null ? f(pLate, 0) : '—', unit: '%', help: `${R.m96} lote${R.m96 === 1 ? '' : 's'}`, cur: pLate, prev: pLateP, good: 'down' },
      { label: 'Rendimiento', value: ok(R.yieldAgg) ? f(R.yieldAgg, 0) : '—', unit: '%', help: 'Cerveza recuperada / levadura', cur: R.yieldAgg, prev: P && P.yieldAgg, good: 'up' },
    ]);
  }

  function bloqueVolumen(d, ctx, UI) {
    const { rows } = d;
    const by = X.monthsCover(ctx.rango.from, ctx.rango.to);
    const g = new Map();
    for (const r of rows) {
      const k = A.DL.periodKey(r.t, by);
      if (!g.has(k.k)) g.set(k.k, { k: k.k, label: k.label, t: k.t, n: 0, vol: 0, hl95: 0, kg: 0, h: [] });
      const e = g.get(k.k);
      e.n++; e.vol += r.volume || 0; e.hl95 += r.hl95 || 0; e.kg += r.kg || 0; if (ok(r.hours)) e.h.push(r.hours);
    }
    const per = [...g.values()].sort((a, b) => a.t - b.t);
    per.forEach((p) => { p.hMean = X.mean(p.h); p.source = 'Control Recuperada · ' + p.n + ' recuperaciones'; });
    let c1 = 0, c2 = 0;
    const accV = [], acc95 = [];
    for (const r of rows) { c1 += r.volume || 0; c2 += r.hl95 || 0; accV.push({ x: r.t, y: c1, label: `${day(r.t)}: ${f(c1, 0)} Hl acumulados` }); acc95.push({ x: r.t, y: c2, label: `${day(r.t)}: ${f(c2, 0)} Hl a 9,5 °P acumulados` }); }
    const R = d.R;
    const best = per.slice().sort((a, b) => b.vol - a.vol)[0];
    const span = rows.length > 1 ? Math.max(1, (rows[rows.length - 1].t - rows[0].t) / 86400000 + 1) : 1;
    const porDia = rows.length ? R.vol / span : 0;
    const lectura = per.length
      ? UI.lectura(`En el periodo se recuperaron <strong>${f(R.vol, 0)} Hl</strong> de cerveza en ${X.pl(R.n, 'recuperación', 'recuperaciones')}${R.nE ? `, que equivalen a <strong>${f(R.hl95, 0)} Hl a 9,5 °P</strong> y <strong>${f(R.kg, 0)} kg</strong> de extracto que no se fueron al drenaje` : ''}. ${best ? `El ${by === 'month' ? 'mes' : by === 'week' ? 'tramo semanal' : 'día'} de mayor volumen fue <strong>${esc(best.label)}</strong> con ${f(best.vol, 0)} Hl. ` : ''}Promedio ${f(porDia, 1)} Hl por día calendario entre la primera y la última recuperación.${R.nE < R.n ? ` Ojo: ${X.pl(R.n - R.nE, 'recuperación no tiene', 'recuperaciones no tienen')} extracto original y no suman al equivalente.` : ''}`)
      : '';
    const grafBars = X.fig('bars', {
      title: `Cerveza recuperada por ${by === 'month' ? 'mes' : by === 'week' ? 'semana' : 'día'}`, unit: 'Hl', categories: per.map((p) => p.label),
      series: [{ name: 'Recuperada (Hl)', values: per.map((p) => p.vol), color: 'var(--est)' }, { name: 'Equivalente a 9,5 °P (Hl)', values: per.map((p) => p.hl95), color: 'var(--ink)' }], yFmt: (v) => f(v, 0),
    });
    const grafAcc = X.fig('line', {
      title: 'Acumulado del periodo', unit: 'Hl', xType: 'time', yFmt: (v) => f(v, 0),
      series: [{ name: 'Recuperada (Hl)', points: accV, color: 'var(--est)', dots: false, area: true }, { name: 'Equivalente a 9,5 °P (Hl)', points: acc95, color: 'var(--ink)', dots: false }],
    });
    const tabla = UI.tabla([
      { k: 'label', t: by === 'month' ? 'Mes' : by === 'week' ? 'Semana' : 'Día' }, { k: 'n', t: 'Recuperaciones', num: 1 },
      { k: 'vol', t: 'Recuperada (Hl)', num: 1, f: (v) => f(v, 0) }, { k: 'hl95', t: 'Equiv. 9,5 °P (Hl)', num: 1, f: (v) => f(v, 0) }, { k: 'kg', t: 'kg ahorrados', num: 1, f: (v) => f(v, 0) },
      { k: 'hMean', t: 'Horas promedio', num: 1, f: (v) => f(v, 1) },
    ], per, { id: 'tb-rec-vol', nombre: 'recuperacion_por_periodo', max: 12 });
    return UI.card('Volumen recuperado y ahorro', 'Cerveza que se recupera de la levadura y su equivalente a 9,5 °P y en kilos de extracto.',
      UI.grid([grafBars, grafAcc], 2) + lectura + `<details class="an-det"><summary>Ver tabla por periodo</summary>${tabla}</details>`, { id: 'rec-volumen' });
  }

  function bloqueRendimiento(d, ctx, UI) {
    const { rows, R, P } = d;
    const ys = rows.filter((r) => ok(r.yieldPct));
    if (ys.length < 2) return UI.card('Rendimiento de la recuperación', 'Cerveza recuperada ÷ levadura recolectada.', UI.vacio('Se necesitan al menos 2 recuperaciones con volumen y levadura.'), { id: 'rec-rend' });
    const sm = S.summary(ys.map((r) => r.yieldPct));
    const mm = S.movingAvg(ys.map((r) => r.yieldPct), 5);
    const line = X.fig('line', {
      title: 'Rendimiento por recuperación', unit: '%', xType: 'time', yFmt: (v) => f(v, 0),
      series: [{ name: 'Rendimiento (%)', points: ys.map((r) => ({ x: r.t, y: r.yieldPct, label: `${day(r.t)} · ${r.utkN} · ${f(r.yieldPct, 1)} % (${f(r.volume, 0)} de ${f(r.yeast, 0)} Hl)` })), dots: true, color: 'var(--est)' },
        ...(ys.length >= 6 ? [{ name: 'Promedio móvil (5)', points: ys.map((r, i) => ({ x: r.t, y: mm[i] })).filter((p) => ok(p.y)), dots: false, color: 'var(--ink)' }] : [])],
      refs: [{ y: sm.mean, label: 'Promedio ' + f(sm.mean, 0) + ' %' }],
    });
    const hist = X.fig('histogram', { title: 'Cómo se reparte el rendimiento', values: ys.map((r) => r.yieldPct), unit: '%', normal: false, xFmt: (v) => f(v, 0) });
    const tend = X.tendencia(ys.map((r) => r.yieldPct), 'up');
    const bajos = ys.filter((r) => r.yieldPct < sm.p10);
    const dif = P && ok(P.yieldAgg) ? R.yieldAgg - P.yieldAgg : null;
    const lectura = UI.lectura(`De cada 100 Hl de levadura recolectada se recuperan en promedio <strong>${f(sm.mean, 1)} Hl</strong> de cerveza (mediana ${f(sm.median, 1)}; la mitad central de los casos va de ${f(sm.p25, 0)} a ${f(sm.p75, 0)} %).${dif != null ? ` Frente al periodo anterior ${dif >= 0 ? 'mejora' : 'baja'} ${f(Math.abs(dif), 1)} puntos.` : ''} ${tend ? (tend.trend === 'sin tendencia' ? 'No hay una tendencia clara en el tiempo.' : `La tendencia es <strong>${tend.trend === 'sube' ? 'a mejor' : 'a peor'}</strong> y ${X.sig(tend.p, tend.n)}.`) : ''} ${bajos.length ? `Los casos más bajos (menos de ${f(sm.p10, 0)} %) fueron el ${bajos.slice(0, 3).map((r) => day(r.t)).join(', ')}.` : ''}`);
    return UI.card('Rendimiento de la recuperación', 'Cerveza recuperada ÷ levadura recolectada, por cada recuperación.', UI.grid([line, hist], 2) + lectura, { id: 'rec-rend' });
  }

  function bloqueTiempo(d, ctx, UI) {
    const { rows, R, P } = d, M = metas();
    const hs = rows.filter((r) => ok(r.hours));
    if (!hs.length) return UI.card('Tiempo hasta recuperar', `Meta ${M.obj} h, máximo ${M.max} h desde la primera recolección.`, UI.vacio('Ninguna recuperación del periodo tiene fecha de recuperación registrada.'), { id: 'rec-tiempo' });
    const h = hs.map((r) => r.hours);
    const lo = Math.floor(Math.min(...h, M.obj - 8) / 8) * 8, hi = Math.ceil(Math.max(...h, M.max + 8) / 8) * 8;
    const bins = [];
    for (let a = lo; a < hi; a += 8) bins.push({ x0: a, x1: a + 8, n: h.filter((x) => x >= a && x < a + 8 || (a + 8 >= hi && x === hi)).length });
    const hist = X.fig('histogram', { title: 'Horas hasta recuperar (cada barra = 8 h)', bins, usl: M.max, mean: S.mean(h), sd: S.sd(h), unit: 'h', normal: false, xFmt: (v) => f(v, 0) });
    const tot = R.nH;
    const donut = X.fig('donut', {
      title: 'Reparto por tramo', w: 420, h: 220,
      data: [{ label: `≤ ${M.obj} h`, value: R.a72, color: 'var(--pos)' }, { label: `${M.obj}–${M.max} h`, value: R.a96, color: 'var(--warn)' }, { label: `> ${M.max} h`, value: R.m96, color: 'var(--neg)' }],
    });
    const abVenc = rows.filter((r) => r.hours == null && r.hOpen != null && r.hOpen > M.max);
    const p72 = (R.a72 / tot) * 100, pA = (R.a96 / tot) * 100, pV = (R.m96 / tot) * 100;
    const p72p = P && P.nH ? (P.a72 / P.nH) * 100 : null;
    const tono = pV > 15 ? 'bad' : pV > 0 || p72 < 50 ? 'warn' : 'ok';
    const lectura = UI.lectura(`De ${tot} recuperaciones con tiempo medido, <strong>${f(p72, 0)} %</strong> se hizo dentro de ${M.obj} h, <strong>${f(pA, 0)} %</strong> tardó entre ${M.obj} y ${M.max} h y <strong>${f(pV, 0)} %</strong> superó el máximo de ${M.max} h. El promedio es ${hoursTxt(R.hMean)} y la mediana ${hoursTxt(R.hMed)}${p72p != null ? `; en el periodo anterior el ${f(p72p, 0)} % cumplía la meta de ${M.obj} h` : ''}. ${R.m96 ? `Mientras más pasa la levadura con el agua, más riesgo de pH alto y de perder calidad: las barras rojas son los lotes que no deberían repetirse.` : 'Ningún lote pasó el máximo.'}${abVenc.length ? ` <strong>Atención:</strong> ${X.pl(abVenc.length, 'recuperación', 'recuperaciones')} sin fecha de cierre lleva${abVenc.length === 1 ? '' : 'n'} más de ${M.max} h desde la primera recolección (están pasadas de tiempo o no se registró el cierre).` : ''}`, tono);
    return UI.card('Tiempo hasta recuperar', `Horas entre la primera recolección y la recuperación. Meta ${M.obj} h, máximo ${M.max} h.`, UI.grid([hist, donut], 2) + lectura, { id: 'rec-tiempo' });
  }

  function bloqueLimites(d, ctx, UI) {
    const { rows, R } = d, M = metas();
    const mk = (title, key, ref, unit, label, extra = {}) => {
      const pts = rows.filter((r) => ok(r[key]));
      return X.fig('line', Object.assign({
        title, unit, xType: 'time', yFmt: (v) => f(v, 1),
        series: [{ name: title, points: pts.map((r) => ({ x: r.t, y: r[key], label: `${day(r.t)} · ${r.utkN} · ${f(r[key], 2)} ${unit}` })), dots: true, color: 'var(--est)', width: 1.4 }],
        refs: ref,
      }, extra));
    };
    const filas = [
      { p: 'pH al retirar levadura', lim: `≤ ${f(M.ph, 2)}`, n: R.phN, out: R.phOut, worst: Math.max(...X.vals(rows, 'phOk'), -Infinity), key: 'ph' },
      { p: 'Temperatura cerveza recuperada', lim: `≤ ${M.temp} °C`, n: R.tN, out: R.tOut, worst: Math.max(...X.vals(rows, 'tempOk'), -Infinity), key: 'temp' },
      { p: 'Presión del UTK al recuperar', lim: `≤ ${M.pres} PSI`, n: R.pN, out: R.pOut, worst: Math.max(...X.vals(rows, 'presion'), -Infinity), key: 'pres' },
      { p: 'Agua / levadura', lim: `${M.aMin}–${M.aMax} %`, n: R.wN, out: R.wOut, worst: null, key: 'agua' },
    ].map((r) => ({ ...r, pct: r.n ? (r.out / r.n) * 100 : null, worst: Number.isFinite(r.worst) ? r.worst : null, source: 'Control Recuperada' }));
    const aguaOut = rows.filter((r) => r.fAgua);
    if (aguaOut.length) { const dev = aguaOut.map((r) => r.waterPct); filas[3].worst = dev.reduce((a, b) => (Math.abs(b - 50) > Math.abs(a - 50) ? b : a)); }
    const tabla = UI.tabla([
      { k: 'p', t: 'Parámetro' }, { k: 'lim', t: 'Límite' }, { k: 'n', t: 'Medidas', num: 1 }, { k: 'out', t: 'Fuera', num: 1 },
      { k: 'pct', t: '% fuera', num: 1, f: (v) => (v == null ? '—' : f(v, 0) + ' %') }, { k: 'worst', t: 'Valor más extremo', num: 1, f: (v) => (v == null ? '—' : f(v, 2)) },
      { k: 'pct', t: 'Estado', f: (v) => (v == null ? '—' : UI.badge(v === 0 ? 'En control' : v < 15 ? 'Vigilar' : 'Atender', v === 0 ? 'ok' : v < 15 ? 'warn' : 'bad')) },
    ], filas, { id: 'tb-rec-lim', nombre: 'recuperacion_limites', max: 6 });
    const bars = X.fig('barsH', {
      title: '% de recuperaciones fuera del límite', h: 220, xFmt: (v) => f(v, 0) + ' %',
      data: filas.filter((r) => r.pct != null).map((r) => ({ label: r.p, value: r.pct, color: r.pct === 0 ? 'var(--pos)' : r.pct < 15 ? 'var(--warn)' : 'var(--neg)', note: `${r.out} de ${r.n}` })),
    });
    const peor = filas.filter((r) => r.pct).sort((a, b) => b.pct - a.pct)[0];
    const hayDatos = filas.some((r) => r.n);
    const lectura = hayDatos ? UI.lectura(peor
      ? `El parámetro que más se sale es <strong>${esc(peor.p.toLowerCase())}</strong>: ${peor.out} de ${peor.n} mediciones (${f(peor.pct, 0)} %) superaron el límite ${esc(peor.lim)}. ${filas.filter((r) => r.pct === 0 && r.n).length ? 'Se mantienen en control: ' + filas.filter((r) => r.pct === 0 && r.n).map((r) => esc(r.p.toLowerCase())).join(', ') + '.' : ''} Un pH alto al retirar levadura pide revisar el tiempo que estuvo en el UTK; una temperatura alta, el enfriamiento antes de cerrar.`
      : 'Todas las mediciones del periodo estuvieron dentro de los límites.', peor && peor.pct >= 15 ? 'warn' : 'ok') : '';
    const charts = UI.grid([
      mk('pH al retirar levadura', 'phOk', [{ y: M.ph, label: 'Límite ' + f(M.ph, 2) }, { y: M.phObj, label: 'Meta ' + f(M.phObj, 1), color: 'var(--pos)' }], 'pH'),
      mk('Temperatura recuperada', 'tempOk', [{ y: M.temp, label: 'Límite ' + M.temp + ' °C' }], '°C'),
      mk('Presión del UTK', 'presion', [{ y: M.pres, label: 'Límite ' + M.pres + ' PSI' }], 'PSI'),
      mk('Agua añadida / levadura', 'waterPct', [{ y: M.aMin, label: M.aMin + ' %', color: 'var(--pos)' }, { y: M.aMax, label: M.aMax + ' %', color: 'var(--pos)' }], '%'),
    ], 2);
    return UI.card('pH, temperatura, presión y agua dentro de límites', 'Cada punto es una recuperación; las líneas son los límites de proceso.', X.grid12(bars, tabla) + lectura + charts, { id: 'rec-limites' });
  }

  function bloqueUtk(d, ctx, UI) {
    const { rows } = d;
    const g19 = rows.filter((r) => r.utkN === 'UTK 19'), g20 = rows.filter((r) => r.utkN === 'UTK 20');
    const mets = [
      ['hours', 'Horas hasta recuperar', 'h', 1, 'down'], ['yieldPct', 'Rendimiento', '%', 1, 'up'], ['phOk', 'pH al retirar levadura', '', 2, 'down'],
      ['tempOk', 'Temperatura recuperada', '°C', 2, 'down'], ['waterPct', 'Agua / levadura', '%', 1, null], ['volume', 'Cerveza recuperada por vez', 'Hl', 0, 'up'],
    ];
    const filas = mets.map(([k, lab, u, dec, good]) => {
      const a = X.vals(g19, k), b = X.vals(g20, k), t = a.length >= 2 && b.length >= 2 ? S.ttest(a, b) : null;
      return { m: lab, n19: a.length, m19: S.mean(a), n20: b.length, m20: S.mean(b), diff: t ? t.diff : null, p: t ? t.p : null, d: t ? t.d : null, dec, u, good, source: 'Control Recuperada' };
    });
    if (g19.length < 2 || g20.length < 2) {
      return UI.card('UTK 19 contra UTK 20', 'Prueba t de Welch entre los dos tanques de recuperación.', UI.vacio(`En el periodo hay ${g19.length} recuperaciones en UTK 19 y ${g20.length} en UTK 20; se necesitan al menos 2 en cada uno para comparar.`), { id: 'rec-utk' });
    }
    const tabla = UI.tabla([
      { k: 'm', t: 'Medida' }, { k: 'n19', t: 'n UTK 19', num: 1 }, { k: 'm19', t: 'Media UTK 19', num: 1, f: (v, r) => (v == null ? '—' : f(v, r.dec)) },
      { k: 'n20', t: 'n UTK 20', num: 1 }, { k: 'm20', t: 'Media UTK 20', num: 1, f: (v, r) => (v == null ? '—' : f(v, r.dec)) },
      { k: 'diff', t: '19 − 20', num: 1, f: (v, r) => (v == null ? '—' : (v > 0 ? '+' : '') + f(v, r.dec)) },
      { k: 'p', t: 'Valor p', num: 1, f: (v) => fP(v) },
      { k: 'd', t: '¿Diferencia real?', f: (v, r) => (r.p == null ? '—' : r.p < 0.05 ? UI.badge('Sí · efecto ' + X.efectoD(v), 'warn') : UI.badge('No se nota', '')) },
    ], filas, { id: 'tb-rec-utk', nombre: 'recuperacion_utk19_vs_utk20', max: 8 });
    const box = X.fig('box', { title: 'Horas hasta recuperar por UTK', unit: 'h', groups: [{ label: 'UTK 19', values: X.vals(g19, 'hours') }, { label: 'UTK 20', values: X.vals(g20, 'hours') }], refs: [{ y: metas().obj, label: 'Meta' }, { y: metas().max, label: 'Máximo' }], yFmt: (v) => f(v, 0) });
    const reales = filas.filter((r) => r.p != null && r.p < 0.05);
    const h = filas[0];
    const lectura = UI.lectura(`UTK 19: ${g19.length} recuperaciones; UTK 20: ${g20.length}. En horas, UTK 19 promedia ${f(h.m19, 1)} h y UTK 20 ${f(h.m20, 1)} h: ${h.p == null ? 'no se pudo comparar' : 'la diferencia ' + X.sig(h.p, Math.min(h.n19, h.n20))}. ${reales.length ? `Las diferencias que parecen reales son: ${reales.map((r) => esc(r.m.toLowerCase())).join(', ')}.` : 'En ninguna de las medidas la diferencia es estadísticamente clara: los dos tanques se comportan parecido.'} <small>Prueba t de Welch; «efecto» mide qué tan grande es la diferencia respecto a la variación normal.</small>`, reales.length ? 'warn' : '');
    return UI.card('UTK 19 contra UTK 20', '¿Alguno de los dos tanques de recuperación rinde distinto?', X.grid12(box, tabla) + lectura, { id: 'rec-utk' });
  }

  function bloqueMarca(d, ctx, UI) {
    const { rows } = d;
    const g = new Map();
    for (const r of rows) { const k = r.brandN; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    const M = metas();
    const filas = [...g.entries()].map(([marca, rs]) => {
      const h = X.vals(rs, 'hours');
      return { marca, n: rs.length, vol: X.sum(rs.map((r) => r.volume)), hl95: X.sum(rs.map((r) => r.hl95)), hMean: S.mean(h), m96: h.filter((x) => x > M.max).length, ph: X.mean(rs.map((r) => r.phOk)), yieldPct: X.mean(rs.map((r) => r.yieldPct)), source: 'Control Recuperada' };
    }).sort((a, b) => b.vol - a.vol);
    if (!filas.length) return '';
    const bars = X.fig('barsH', { title: 'Hl recuperados por marca de destino', unit: 'Hl', data: filas.map((r) => ({ label: r.marca, value: r.vol, color: 'var(--est)', note: r.n + ' recuperaciones' })), xFmt: (v) => f(v, 0) });
    const tabla = UI.tabla([
      { k: 'marca', t: 'Marca destino' }, { k: 'n', t: 'Recup.', num: 1 }, { k: 'vol', t: 'Hl', num: 1, f: (v) => f(v, 0) }, { k: 'hl95', t: 'Equiv. 9,5 °P', num: 1, f: (v) => f(v, 0) },
      { k: 'hMean', t: 'Horas prom.', num: 1, f: (v) => f(v, 1) }, { k: 'm96', t: `> ${M.max} h`, num: 1 }, { k: 'ph', t: 'pH prom.', num: 1, f: (v) => f(v, 2) }, { k: 'yieldPct', t: 'Rend. %', num: 1, f: (v) => f(v, 0) },
    ], filas, { id: 'tb-rec-marca', nombre: 'recuperacion_por_marca', max: 10 });
    const top = filas[0];
    const sinMarca = filas.find((r) => r.marca === '(sin marca)');
    const lectura = UI.lectura(`<strong>${esc(top.marca)}</strong> concentra ${f((top.vol / X.sum(filas.map((r) => r.vol))) * 100, 0)} % de la cerveza recuperada (${f(top.vol, 0)} Hl).${sinMarca ? ` Hay ${sinMarca.n} recuperaciones sin marca de destino registrada (${f(sinMarca.vol, 0)} Hl): conviene completarla para poder atribuir el ahorro.` : ''}`);
    return UI.card('Por marca de destino', 'A qué marca se inyectó la cerveza recuperada.', X.grid12(bars, tabla) + lectura, { id: 'rec-marca' });
  }

  function causas(rows) {
    const M = metas();
    const lista = [
      ['Tardó más de ' + M.max + ' h (máximo)', (r) => r.hours != null && r.hours > M.max],
      ['Tardó entre ' + M.obj + ' y ' + M.max + ' h (alerta)', (r) => r.hours != null && r.hours > M.obj && r.hours <= M.max],
      ['pH alto al retirar levadura (> ' + f(M.ph, 2) + ')', (r) => r.fPh],
      ['Temperatura alta (> ' + M.temp + ' °C)', (r) => r.fTemp],
      ['Presión alta del UTK (> ' + M.pres + ' PSI)', (r) => r.fPres],
      ['Agua / levadura fuera de ' + M.aMin + '–' + M.aMax + ' %', (r) => r.fAgua],
    ];
    return lista.map(([label, fn]) => ({ label, value: rows.filter(fn).length })).filter((x) => x.value > 0);
  }
  function bloquePareto(d, ctx, UI) {
    const items = causas(d.rows);
    if (!items.length) return UI.card('Causas de incumplimiento', 'Qué se sale más seguido de lo especificado.', UI.vacio('No hubo incumplimientos en el periodo.'), { id: 'rec-pareto' });
    const par = S.pareto(items, { vital: 80 });
    const graf = X.fig('pareto', { title: 'Incumplimientos por causa (Pareto)', items, unit: 'veces' });
    const vit = par.vitalFew;
    const tabla = UI.tabla([{ k: 'label', t: 'Causa' }, { k: 'value', t: 'Veces', num: 1 }, { k: 'pct', t: '%', num: 1, f: (v) => f(v, 0) + ' %' }, { k: 'cum', t: '% acumulado', num: 1, f: (v) => f(v, 0) + ' %' }],
      par.items.map((x) => ({ ...x, source: 'Control Recuperada' })), { id: 'tb-rec-par', nombre: 'recuperacion_causas', max: 8 });
    const lectura = UI.lectura(`Se registraron ${par.total} incumplimientos en ${d.rows.length} recuperaciones (una recuperación puede incumplir varias cosas). <strong>${esc(par.items[0].label)}</strong> es la causa más frecuente (${f(par.items[0].pct, 0)} %). ${vit.length <= 3 ? `Con atender ${vit.length === 1 ? 'esa causa' : 'estas ' + vit.length + ' causas'} se resolvería cerca del 80 % de los casos (regla 80/20).` : 'Los incumplimientos están repartidos entre varias causas; no hay una sola que concentre el 80 %.'}`);
    return UI.card('Causas de incumplimiento', 'Cuántas veces cada límite se superó, ordenado de mayor a menor (Pareto).', X.grid12(graf, tabla) + lectura, { id: 'rec-pareto' });
  }

  function bloqueTendencia(d, ctx, UI) {
    const { rows } = d, M = metas();
    const hs = rows.filter((r) => ok(r.hours));
    if (hs.length < 4) return UI.card('Tendencia y carta de control de las horas', 'Mann-Kendall y límites de control ±3σ.', UI.vacio('Se necesitan al menos 4 recuperaciones con tiempo medido en el periodo (prueba con un periodo más largo).'), { id: 'rec-tend' });
    const im = S.imr(hs.map((r) => r.hours));
    const ctrl = X.fig('control', {
      title: 'Carta de control individual de las horas', unit: 'h', cl: im.cl, ucl: im.ucl, lcl: im.lcl, usl: M.max, yFmt: (v) => f(v, 0),
      points: im.points.map((p, i) => ({ i: i + 1, y: p.y, out: p.out || p.rules.length > 0, label: `${day(hs[i].t)} · ${hs[i].utkN} · ${f(p.y, 1)} h` })),
      violations: im.violations.map((v) => ({ i: v.i + 1, text: v.text })),
    });
    const defs = [
      ['Horas hasta recuperar', 'hours', 'down', 'h', 1], ['Rendimiento', 'yieldPct', 'up', '%', 1], ['pH al retirar levadura', 'phOk', 'down', '', 2],
      ['Temperatura recuperada', 'tempOk', 'down', '°C', 2], ['Cerveza recuperada por vez', 'volume', 'up', 'Hl', 0],
    ];
    const filas = defs.map(([lab, k, good, u, dec]) => {
      const t = X.tendencia(rows.filter((r) => ok(r[k])).map((r) => r[k]), good);
      return { m: lab, n: t ? t.n : rows.filter((r) => ok(r[k])).length, trend: t ? t.trend : '—', tau: t ? t.tau : null, p: t ? t.p : null, sen: t ? t.sen : null, dec, u, tono: t ? t.tono : '', source: 'Control Recuperada' };
    });
    const tabla = UI.tabla([
      { k: 'm', t: 'Medida' }, { k: 'n', t: 'n', num: 1 },
      { k: 'trend', t: 'Tendencia', f: (v, r) => (v === '—' ? '—' : UI.badge(v === 'sin tendencia' ? 'Sin tendencia' : v === 'sube' ? 'Sube' : 'Baja', r.tono)) },
      { k: 'sen', t: 'Cambio por recuperación', num: 1, f: (v, r) => (v == null ? '—' : (v > 0 ? '+' : '') + f(v, r.dec + 1) + ' ' + r.u) }, { k: 'tau', t: 'tau', num: 1, f: (v) => f(v, 2) }, { k: 'p', t: 'Valor p', num: 1, f: (v) => fP(v) },
    ], filas, { id: 'tb-rec-tend', nombre: 'recuperacion_tendencias', max: 8 });
    const fuera = im.violations.length;
    const th = filas[0];
    const lectura = UI.lectura(`Las horas promedian <strong>${f(im.cl, 1)} h</strong>; el proceso «normal» se mueve entre ${f(Math.max(0, im.lcl), 1)} y ${f(im.ucl, 1)} h (±3σ), así que ${im.ucl > M.max ? `<strong>el límite natural del proceso (${f(im.ucl, 0)} h) está por encima del máximo permitido de ${M.max} h</strong>: aunque todo funcione «normal», habrá lotes que se pasen.` : `el proceso cabe dentro del máximo de ${M.max} h.`} ${fuera ? `Se detectaron ${fuera} señal${fuera === 1 ? '' : 'es'} de la carta (${esc(im.violations[0].text)}).` : 'No hay señales fuera de control: la variación es la habitual del proceso.'} ${th.trend === 'sin tendencia' ? 'Mann-Kendall no encuentra tendencia en las horas.' : th.trend === '—' ? '' : `Mann-Kendall indica que las horas <strong>${th.trend === 'sube' ? 'vienen subiendo' : 'vienen bajando'}</strong> (${X.sig(th.p, th.n)}), unas ${f(Math.abs(th.sen), 1)} h por recuperación.`}`, th.tono === 'bad' || im.ucl > M.max ? 'warn' : '');
    return UI.card('Tendencia y carta de control de las horas', 'Mann-Kendall (¿sube o baja con el tiempo?) y carta I-MR (¿el proceso está estable?).', X.grid12(ctrl, tabla) + lectura, { id: 'rec-tend' });
  }

  function bloqueLotes(d, ctx, UI) {
    const M = metas();
    const venc = d.rows.filter((r) => r.hours != null && r.hours > M.max).map((r) => ({ ...r, exceso: r.hours - M.max, estado: 'Recuperada tarde' }));
    const ab = d.rows.filter((r) => r.hours == null && r.hOpen != null && r.hOpen > M.max).map((r) => ({ ...r, hours: r.hOpen, exceso: r.hOpen - M.max, estado: 'Sin fecha de recuperación (¿sin registrar?)' }));
    const todos = venc.concat(ab).sort((a, b) => b.hours - a.hours);
    if (!todos.length) return UI.card(`Lotes que superaron ${M.max} h`, 'Detalle de recuperaciones fuera del tiempo máximo.', `<div class="an-empty ok"><strong>Ninguno en el periodo</strong><span>Todas las recuperaciones medidas estuvieron por debajo de ${M.max} h.</span></div>`, { id: 'rec-lotes' });
    const tabla = UI.tabla([
      { k: 't', t: 'Fecha', f: (v) => esc(AN.fmtDateTime(v)) }, { k: 'utkN', t: 'UTK' }, { k: 'brandN', t: 'Marca' }, { k: 'destination', t: 'SV destino' },
      { k: 'hours', t: 'Horas', num: 1, f: (v) => f(v, 1) }, { k: 'exceso', t: `Exceso sobre ${M.max} h`, num: 1, f: (v) => '+' + f(v, 1) },
      { k: 'volume', t: 'Hl', num: 1, f: (v) => f(v, 0) }, { k: 'phOk', t: 'pH', num: 1, f: (v) => f(v, 2) }, { k: 'tempOk', t: '°C', num: 1, f: (v) => f(v, 1) },
      { k: 'estado', t: 'Estado' }, { k: 'source', t: 'Fuente' },
    ], todos, { id: 'tb-rec-lotes', nombre: 'recuperacion_lotes_vencidos', max: 10, sort: { k: 'hours', dir: -1 } });
    const peor = venc.slice().sort((a, b) => b.hours - a.hours)[0];
    const lectura = UI.lectura(`${venc.length ? `${X.pl(venc.length, 'recuperación superó', 'recuperaciones superaron')} las ${M.max} h. La más larga fue la del <strong>${esc(fd(peor.t))}</strong> en ${esc(peor.utkN)}: ${f(peor.hours, 1)} h (${f(peor.exceso, 1)} h de más).` : 'Ninguna recuperación cerrada superó el máximo.'} ${ab.length ? `${X.pl(ab.length, 'registro no tiene', 'registros no tienen')} fecha de recuperación: el tiempo se midió hasta el cierre del periodo y probablemente es un cierre sin registrar.` : ''}`, 'bad');
    return UI.card(`Lotes que superaron ${M.max} h`, 'Detalle para revisar caso por caso (pasa el cursor sobre una fila para ver su fuente).', tabla + lectura, { id: 'rec-lotes' });
  }

  /* ============================================================
     Registro
     ============================================================ */
  A.Analisis.registrar({
    id: 'recuperacion', label: 'Recuperación', orden: 6,
    render(ctx, UI) {
      const d = calc(ctx);
      if (!d.rows.length) {
        const todas = ctx.todas('recuperacion').length;
        return UI.card('Recuperación de cerveza', 'Levadura recolectada, agua añadida y cerveza recuperada.', UI.vacio(todas ? 'No hay recuperaciones en este periodo' + (ctx.filtraMarca ? ' y marcas elegidas' : '') + '. Prueba con «Todo el histórico».' : 'Todavía no hay registros de recuperación. Carga el Excel «Control Recuperada» en el apartado Recuperación.'));
      }
      return [bloqueKpis(d), bloqueVolumen(d, ctx, UI), bloqueRendimiento(d, ctx, UI), bloqueTiempo(d, ctx, UI), bloqueLimites(d, ctx, UI),
        UI.grid([bloqueUtk(d, ctx, UI)], 1), bloqueMarca(d, ctx, UI), bloquePareto(d, ctx, UI), bloqueTendencia(d, ctx, UI), bloqueLotes(d, ctx, UI)].join('');
    },
    hallazgos(ctx) {
      const d = calc(ctx), M = metas(), out = [];
      if (!d.rows.length) return out;
      const R = d.R;
      if (R.nH && R.m96) {
        const pct = (R.m96 / R.nH) * 100;
        out.push({ sev: pct >= 20 ? 'alta' : 'media', titulo: `${X.pl(R.m96, 'recuperación superó', 'recuperaciones superaron')} las ${M.max} h`, detalle: `${f(pct, 0)} % de las recuperaciones medidas; promedio ${f(R.hMean, 1)} h frente a la meta de ${M.obj} h.`, valor: f(pct, 0) + ' %' });
      } else if (R.nH) out.push({ sev: 'ok', titulo: `Ninguna recuperación pasó de ${M.max} h`, detalle: `Promedio ${f(R.hMean, 1)} h; ${f((R.a72 / R.nH) * 100, 0)} % dentro de ${M.obj} h.` });
      if (R.phN && R.phOut / R.phN >= 0.15) out.push({ sev: R.phOut / R.phN >= 0.4 ? 'alta' : 'media', titulo: 'pH de recuperación fuera del límite', detalle: `${R.phOut} de ${R.phN} mediciones superaron ${M.ph}.`, valor: f((R.phOut / R.phN) * 100, 0) + ' %' });
      if (R.tN && R.tOut / R.tN >= 0.15) out.push({ sev: 'media', titulo: 'Temperatura de la cerveza recuperada alta', detalle: `${R.tOut} de ${R.tN} mediciones superaron ${M.temp} °C.`, valor: f((R.tOut / R.tN) * 100, 0) + ' %' });
      if (R.nE) out.push({ sev: 'info', titulo: `${f(R.hl95, 0)} Hl a 9,5 °P recuperados`, detalle: `${f(R.vol, 0)} Hl de cerveza recuperada; ${f(R.kg, 0)} kg de extracto ahorrados${d.P && d.P.kg ? ' (' + (R.kg >= d.P.kg ? '+' : '') + f(((R.kg - d.P.kg) / d.P.kg) * 100, 0) + ' % frente al periodo anterior)' : ''}.`, valor: f(R.kg, 0) + ' kg' });
      const hs = d.rows.filter((r) => ok(r.hours));
      const t = X.tendencia(hs.map((r) => r.hours), 'down');
      if (t && t.trend !== 'sin tendencia') out.push({ sev: t.dir > 0 ? 'media' : 'ok', titulo: `Las horas de recuperación ${t.dir > 0 ? 'suben' : 'bajan'} de forma sostenida`, detalle: `Mann-Kendall (${X.sig(t.p, t.n)}), unas ${f(Math.abs(t.sen), 1)} h por recuperación.` });
      const g19 = X.vals(d.rows.filter((r) => r.utkN === 'UTK 19'), 'hours'), g20 = X.vals(d.rows.filter((r) => r.utkN === 'UTK 20'), 'hours');
      const tt = g19.length >= 3 && g20.length >= 3 ? S.ttest(g19, g20) : null;
      if (tt && tt.p < 0.05) out.push({ sev: 'media', titulo: `${tt.diff > 0 ? 'UTK 19' : 'UTK 20'} tarda más en recuperar`, detalle: `${f(Math.abs(tt.diff), 1)} h de diferencia en promedio (UTK 19: ${f(tt.meanA, 1)} h, UTK 20: ${f(tt.meanB, 1)} h), ${X.sig(tt.p)}.` });
      const ab = d.rows.filter((r) => r.hours == null && r.hOpen != null && r.hOpen > M.max);
      if (ab.length) out.push({ sev: 'alta', titulo: `${X.pl(ab.length, 'recuperación abierta', 'recuperaciones abiertas')} con más de ${M.max} h`, detalle: 'Tienen primera recolección pero no fecha de recuperación: o están pasadas de tiempo o falta registrarlas.' });
      return out;
    },
  });
})();
