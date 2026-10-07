/* ============================================================
   Análisis · Operación (trasiego y aseos)
   Trasiego: plan encadenado (8,5 h por trasiego, 2,5 h por CIP de centrífuga), desvío = fin real − fin planeado.
   Aseos: CMP con parámetros, frecuencia y estados; agua estimada = caudal (Hl/h) × minutos / 600.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.Analisis || !A.AnX) return;
  const X = A.AnX, S = X.S, C = X.C, AN = A.Analisis, ok = X.ok, esc = X.esc, f = X.f, fp = X.fp, fP = X.fP, fd = X.fd;
  const DAY = 86400000;
  const st = { vista: 'trasiego' };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /* ---------- Causas: agrupa los textos libres del Excel ---------- */
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const REGLAS = [
    [/DIACETILO/, 'Atenuación de diacetilo'],
    [/TARSIEGO DURA|DURA \d+ ?H/, 'Trasiego más largo de lo planeado'],
    [/RECUPERADA/, 'Inyección de recuperada'],
    [/TEMPERATURA ALTA|ENFRIADOR|AMONIACO/, 'Temperatura alta / enfriador'],
    [/MENOR FLUJO|BAJA FLUJO|FLUJO|HL ?\/ ?H|H\/H|HL7H/, 'Flujo de trasiego reducido'],
    [/UTK/, 'Disponibilidad de UTK'],
    [/FALTA DE SV|SV ?\d|DESOCUPACION|DISPONIBILIDAD DE TANQUE|SIN CUPO|BUFFER/, 'Falta de SV o cupo'],
    [/FALLA|FUGA|VALVULA|BOMBA|ELECTRIC|NEUMAT|BATCH|CALIBRACION|RECETA/, 'Falla de equipo o receta'],
    [/ASEO|CIP/, 'Aseos y CIP entre trasiegos'],
    [/MANTENIMIENTO/, 'Mantenimiento'],
    [/PURGA/, 'Purgas'],
    [/DEMANDA|FILTRACION|PROGRAMA/, 'Programa o demanda'],
    [/CENTRIFUGA/, 'Trasiego sin centrífuga'],
  ];
  const SIN = 'Sin causa registrada';
  function causaGrupo(c) {
    if (!c || c === SIN) return SIN;
    const n = norm(c);
    for (const [re, g] of REGLAS) if (re.test(n)) return g;
    const t = String(c).trim();
    return t.length > 38 ? t.slice(0, 36) + '…' : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }
  const metasT = () => ({ plan: A.Metas.get('trasiego.trasiegoH', 8.5), cip: A.Metas.get('trasiego.cipCentrifugaH', 2.5), holg: A.Metas.get('trasiego.holguraH', 1), dmax: A.Metas.get('trasiego.desvioMaxH', 1) });
  const sh = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ============================================================
     TRASIEGO
     ============================================================ */
  function prepT(rows, M) {
    return rows.map((r) => Object.assign({}, r, {
      grupo: causaGrupo(r.cause), brandN: r.brand ? X.tc(r.brand) : '(sin marca)', destN: r.destination ? 'SV ' + r.destination : '(sin destino)',
      tarde: r.delay != null ? r.delay > M.dmax : null, durOk: r.duration != null && r.duration > 0 && r.duration <= 48 ? r.duration : null,
    }));
  }
  function resT(rs, M, ctx) {
    const pl = rs.filter((r) => r.delay != null);
    const dl = pl.map((r) => r.delay);
    const tr = rs.filter((r) => r.kind === 'Trasiego');
    const durs = tr.filter((r) => r.durOk != null).map((r) => r.durOk);
    const perdidas = pl.filter((r) => r.delay > 0).reduce((a, r) => a + r.delay, 0);
    return {
      n: rs.length, nPlan: pl.length, aTiempo: pl.filter((r) => r.delay <= M.dmax).length, delayMean: S.mean(dl), delayMed: S.median(dl), delayNet: X.sum(dl), perdidas,
      sinCausaH: pl.filter((r) => r.delay > 0 && r.grupo === SIN).reduce((a, r) => a + r.delay, 0), nTr: tr.length, durMean: S.mean(durs), durMed: S.median(durs), nDur: durs.length,
      horasTr: X.sum(durs), tarde: pl.filter((r) => r.delay > M.dmax).length,
    };
  }
  function calcT(ctx) {
    return X.memo(ctx, 'tras', ['trasiego'], () => {
      const M = metasT();
      const rows = prepT(ctx.rows('trasiego'), M).sort((a, b) => a.t - b.t);
      const prev = prepT(ctx.previas('trasiego'), M);
      return { M, rows, prev, R: resT(rows, M), P: prev.length >= 8 ? resT(prev, M) : null };
    });
  }

  function kpisT(d) {
    const { R, P, M } = d;
    const pc = (a, n) => (n > 0 ? (a / n) * 100 : null);
    const cur = pc(R.aTiempo, R.nPlan), pre = P ? pc(P.aTiempo, P.nPlan) : null;
    return X.kpis([
      { label: 'Actividades', value: f(R.n, 0), help: `${R.nTr} trasiegos · ${R.nPlan} con plan y fin real`, cur: R.n, prev: P && P.n, good: 'up' },
      { label: 'Cumplimiento del plan', value: cur != null ? f(cur, 0) : '—', unit: '%', help: `Terminó con ≤ ${M.dmax} h de desvío`, cur, prev: pre, good: 'up' },
      { label: 'Desvío mediano', value: R.delayMed != null ? f(R.delayMed, 1) : '—', unit: 'h', help: R.delayMean != null ? `Promedio ${f(R.delayMean, 1)} h` : '', cur: R.delayMed, prev: P && P.delayMed, good: 'down' },
      { label: 'Horas perdidas', value: f(R.perdidas, 0), unit: 'h', help: 'Suma de retrasos sobre el plan', cur: R.perdidas, prev: P && P.perdidas, good: 'down' },
      { label: 'Duración de un trasiego', value: R.durMed != null ? f(R.durMed, 1) : '—', unit: 'h', help: `Mediana · plan ${M.plan} h`, cur: R.durMed, prev: P && P.durMed, good: 'down' },
      { label: 'Horas de trasiego', value: f(R.horasTr, 0), unit: 'h', help: 'Suma de duración real', cur: R.horasTr, prev: P && P.horasTr, good: 'up' },
      { label: 'Con retraso', value: f(R.tarde, 0), help: `de ${R.nPlan} con plan`, cur: R.tarde, prev: P && P.tarde, good: 'down' },
      { label: 'Sin causa registrada', value: R.perdidas ? f((R.sinCausaH / R.perdidas) * 100, 0) : '—', unit: '%', help: 'De las horas perdidas', good: 'down' },
    ]);
  }

  function bloqueCumplimiento(d, ctx, UI) {
    const { R, P, M, rows } = d;
    const pl = rows.filter((r) => r.delay != null);
    if (pl.length < 2) return UI.card('Cumplimiento del plan', 'Fin real frente al fin planeado.', UI.vacio('Se necesitan actividades con fecha de fin planeada y real.'), { id: 'op-cumpl' });
    const dl = pl.map((r) => r.delay);
    const lo = Math.max(-24, Math.floor(Math.min(...dl) / 2) * 2), hi = Math.min(36, Math.ceil(Math.max(...dl) / 2) * 2);
    const bins = [];
    for (let a = lo; a < hi; a += 2) bins.push({ x0: a, x1: a + 2, n: dl.filter((x) => (x >= a && x < a + 2) || (a + 2 >= hi && x === hi) || (a === lo && x < lo)).length });
    const hist = X.fig('histogram', { title: 'Desvío del fin real frente al plan (h)', bins, usl: M.dmax, mean: S.mean(dl), sd: S.sd(dl), normal: false, unit: 'h', xFmt: (v) => f(v, 0) });
    const by = X.monthsCover(ctx.rango.from, ctx.rango.to) === 'day' ? 'week' : X.monthsCover(ctx.rango.from, ctx.rango.to);
    const g = new Map();
    for (const r of pl) { const k = A.DL.periodKey(r.t, by); if (!g.has(k.k)) g.set(k.k, { ...k, a: [], tot: [] }); const e = g.get(k.k); e.tot.push(r.delay); }
    const per = [...g.values()].sort((a, b) => a.t - b.t).map((e) => ({ label: e.label, t: e.t, n: e.tot.length, pct: (e.tot.filter((x) => x <= M.dmax).length / e.tot.length) * 100, mean: S.mean(e.tot), med: S.median(e.tot), perd: e.tot.filter((x) => x > 0).reduce((a, b) => a + b, 0), acum: 0 }));
    let ac = 0; per.forEach((p) => { ac += p.mean * p.n; p.acum = ac; });
    const lineP = X.fig('bars', { title: `% de actividades que cumplen el plan (≤ ${M.dmax} h) por ${by === 'month' ? 'mes' : 'semana'}`, categories: per.map((p) => p.label), series: [{ name: '% a tiempo', values: per.map((p) => p.pct), color: 'var(--pos)' }], yFmt: (v) => f(v, 0), unit: '%', refs: [{ y: 80 }] });
    const pOn = (R.aTiempo / R.nPlan) * 100, adelant = pl.filter((r) => r.delay < -M.dmax).length;
    const tono = pOn < 40 ? 'bad' : pOn < 70 ? 'warn' : 'ok';
    const tr = X.tendencia(per.map((p) => p.med), 'down');
    const lectura = UI.lectura(`Solo el <strong>${f(pOn, 0)} %</strong> de las ${R.nPlan} actividades terminó dentro del plan (≤ ${M.dmax} h de desvío)${P && P.nPlan ? `; antes era ${f((P.aTiempo / P.nPlan) * 100, 0)} %` : ''}. El desvío mediano es ${f(R.delayMed, 1)} h (promedio ${f(R.delayMean, 1)} h) y <strong>${adelant}</strong> actividades terminaron más de ${M.dmax} h antes de lo planeado. El plan es encadenado: cada trasiego empieza 1 h después de terminar el anterior, así que un retraso se arrastra a los siguientes y el desvío acumulado suma ${f(R.delayNet, 0)} h netas (${f(R.perdidas, 0)} h solo de retrasos).${tr && tr.trend !== 'sin tendencia' ? ` El desvío mediano por ${by === 'month' ? 'mes' : 'semana'} <strong>${tr.trend === 'sube' ? 'viene subiendo' : 'viene bajando'}</strong> (${X.sig(tr.p, tr.n)}).` : ''}`, tono);
    return UI.card('Cumplimiento del plan', 'Fin real frente al fin planeado de cada actividad (trasiegos y CIP).', UI.grid([lineP, hist], 2) + lectura, { id: 'op-cumpl' });
  }

  function bloquePareto(d, ctx, UI) {
    const { rows, M, R } = d;
    const pl = rows.filter((r) => r.delay > 0);
    const g = new Map();
    for (const r of pl) { const k = r.grupo; if (!g.has(k)) g.set(k, { causa: k, h: 0, n: 0, orig: new Set() }); const e = g.get(k); e.h += r.delay; e.n++; e.orig.add(r.cause); }
    const con = [...g.values()].filter((e) => e.causa !== SIN);
    const sin = g.get(SIN);
    if (!con.length) return UI.card('Horas perdidas por causa', 'Pareto de los retrasos con causa registrada.', UI.vacio(`En el periodo ${pl.length ? `hay ${pl.length} retrasos (${f(R.perdidas, 0)} h) pero ninguno tiene causa registrada` : 'no hay retrasos'}. Registrar la causa en el programa permite hacer el Pareto.`), { id: 'op-pareto' });
    const par = S.pareto(con.map((e) => ({ label: e.causa, value: e.h })), { vital: 80 });
    const graf = X.fig('pareto', { title: 'Horas perdidas por causa (Pareto)', items: con.map((e) => ({ label: e.causa, value: e.h })), unit: 'h', h: 340 });
    const tabla = UI.tabla([
      { k: 'causa', t: 'Causa' }, { k: 'n', t: 'Veces', num: 1 }, { k: 'h', t: 'Horas perdidas', num: 1, f: (v) => f(v, 1) }, { k: 'pct', t: '%', num: 1, f: (v) => f(v, 0) + ' %' }, { k: 'cum', t: '% acum.', num: 1, f: (v) => f(v, 0) + ' %' },
      { k: 'orig', t: 'Textos del Excel', f: (v) => `<span title="${esc(v)}">${esc(sh(v, 26))}</span>` },
    ], par.items.map((x) => { const e = g.get(x.label) || {}; return { causa: x.label, n: e.n || 0, h: x.value, pct: x.pct, cum: x.cum, orig: e.orig ? [...e.orig].join(' · ') : '', source: 'Programa de trasiego' }; }), { id: 'tb-op-par', nombre: 'trasiego_horas_perdidas_por_causa', max: 8 });
    const vital = par.items[0], totCon = X.sum(con.map((e) => e.h));
    const lectura = UI.lectura(`De ${f(R.perdidas, 0)} h perdidas, ${f(totCon, 0)} h tienen causa registrada y <strong>${sin ? f(sin.h, 0) : 0} h (${f(R.perdidas ? ((sin ? sin.h : 0) / R.perdidas) * 100 : 0, 0)} %) no tienen causa</strong>: justificarlas en el programa haría el Pareto más completo. Entre las que sí tienen, la causa vital es <strong>${esc(vital.label)}</strong> con ${f(vital.value, 1)} h (${f(vital.pct, 0)} %); ${par.vitalFew.length <= 3 ? `${par.vitalFew.length === 1 ? 'esa sola causa' : 'estas ' + par.vitalFew.length + ' causas'} explican el 80 % de las horas perdidas con causa` : 'se necesitan ' + par.vitalFew.length + ' causas para llegar al 80 %'} (regla 80/20).`, sin && sin.h > totCon ? 'warn' : '');
    return UI.card('Horas perdidas por causa', 'Retrasos sobre el plan agrupados por causa; los textos libres del Excel se unifican por tema.', X.grid12(graf, tabla) + lectura, { id: 'op-pareto' });
  }

  function bloqueDuracion(d, ctx, UI) {
    const { rows, M } = d;
    const dur = rows.filter((r) => r.durOk != null);
    const tr = dur.filter((r) => r.kind === 'Trasiego'), cip = dur.filter((r) => r.kind === 'CIP');
    if (!dur.length) return UI.card('Duración real frente al plan', `Plan: ${M.plan} h por trasiego y ${M.cip} h por CIP de centrífuga.`, UI.vacio('Ninguna actividad del periodo tiene hora real de inicio y fin.'), { id: 'op-dur' });
    const groups = [{ label: 'Trasiego', values: tr.map((r) => r.durOk) }, { label: 'CIP', values: cip.map((r) => r.durOk) }].filter((g) => g.values.length);
    const box1 = X.fig('box', { title: 'Duración real por clase', unit: 'h', groups, refs: [{ y: M.plan, label: `Plan trasiego ${M.plan} h` }, ...(cip.length ? [{ y: M.cip, label: `Plan CIP ${M.cip} h` }] : [])], yFmt: (v) => f(v, 0) });
    const gm = new Map();
    for (const r of tr) { if (!gm.has(r.brandN)) gm.set(r.brandN, []); gm.get(r.brandN).push(r.durOk); }
    const marcas = [...gm.entries()].filter(([, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length);
    const box2 = marcas.length ? X.fig('box', { title: 'Duración de un trasiego por marca', unit: 'h', groups: marcas.map(([k, v]) => ({ label: `${k} (${v.length})`, values: v })), refs: [{ y: M.plan, label: 'Plan' }], yFmt: (v) => f(v, 0) }) : UI.vacio('Pocas actividades por marca para comparar.');
    const filas = marcas.map(([k, v]) => { const bs = S.boxStats(v); return { marca: k, n: v.length, media: S.mean(v), mediana: S.median(v), sobre: v.filter((x) => x > M.plan + M.holg).length, pct: (v.filter((x) => x > M.plan + M.holg).length / v.length) * 100, atip: bs ? bs.outliers.length : 0, source: 'Programa de trasiego' }; });
    const kw = marcas.length >= 2 ? S.kruskal(Object.fromEntries(marcas.map(([k, v]) => [k, v]))) : null;
    const tabla = UI.tabla([
      { k: 'marca', t: 'Marca' }, { k: 'n', t: 'Trasiegos', num: 1 }, { k: 'media', t: 'Media (h)', num: 1, f: (v) => f(v, 1) }, { k: 'mediana', t: 'Mediana (h)', num: 1, f: (v) => f(v, 1) },
      { k: 'sobre', t: `> ${M.plan + M.holg} h`, num: 1 }, { k: 'pct', t: '%', num: 1, f: (v) => f(v, 0) + ' %' }, { k: 'atip', t: 'Atípicos', num: 1 },
    ], filas, { id: 'tb-op-dur', nombre: 'trasiego_duracion_por_marca', max: 8 });
    const tm = S.mean(tr.map((r) => r.durOk)), over = tr.filter((r) => r.durOk > M.plan + M.holg).length;
    const lectura = UI.lectura(`${tr.length ? `Un trasiego dura en promedio <strong>${f(tm, 1)} h</strong> frente a las ${M.plan} h del plan (${f(tm - M.plan, 1)} h ${tm >= M.plan ? 'más' : 'menos'}); <strong>${over}</strong> de ${tr.length} (${f((over / tr.length) * 100, 0)} %) pasaron de ${f(M.plan + M.holg, 1)} h.` : ''} ${cip.length ? '' : 'Los CIP no traen hora real de inicio y fin en el programa, por eso no se puede medir su duración. '}${kw ? `Entre marcas ${kw.p < 0.05 ? 'sí hay diferencia: ' : 'no hay diferencia clara: '}${X.sig(kw.p)} (Kruskal-Wallis).` : ''} Las duraciones mayores a 48 h se descartan como errores de captura.`);
    return UI.card('Duración real frente al plan', `Plan: ${M.plan} h por trasiego y ${M.cip} h por CIP de centrífuga. Las cajas muestran la mitad central de los casos.`, UI.grid([box1, box2], 2) + (filas.length ? tabla : '') + lectura, { id: 'op-dur' });
  }

  function bloqueUtilizacion(d, ctx, UI) {
    const { rows } = d;
    const tr = rows.filter((r) => r.kind === 'Trasiego' && r.durOk != null);
    if (!tr.length) return UI.card('Utilización mensual del sistema de trasiego', 'Horas de trasiego ÷ (24 × días).', UI.vacio('No hay trasiegos con duración real en el periodo.'), { id: 'op-util' });
    const g = new Map();
    for (const r of tr) { const k = A.DL.periodKey(r.t, 'month'); if (!g.has(k.k)) g.set(k.k, { ...k, h: 0, n: 0 }); const e = g.get(k.k); e.h += r.durOk; e.n++; }
    const per = [...g.values()].sort((a, b) => a.t - b.t).map((e) => {
      const m0 = new Date(e.t), m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1).getTime();
      const dias = Math.max(1, (Math.min(m1, ctx.rango.to + 1) - Math.max(e.t, ctx.rango.from)) / DAY);
      return { label: e.label, n: e.n, h: e.h, dias, util: (e.h / (24 * dias)) * 100, source: 'Programa de trasiego' };
    });
    const graf = X.fig('bars', { title: 'Utilización = horas de trasiego ÷ (24 × días)', categories: per.map((p) => p.label), series: [{ name: 'Utilización (%)', values: per.map((p) => p.util), color: 'var(--est)' }], unit: '%', yFmt: (v) => f(v, 0) });
    const tabla = UI.tabla([{ k: 'label', t: 'Mes' }, { k: 'n', t: 'Trasiegos', num: 1 }, { k: 'h', t: 'Horas', num: 1, f: (v) => f(v, 0) }, { k: 'dias', t: 'Días', num: 1, f: (v) => f(v, 0) }, { k: 'util', t: 'Utilización', num: 1, f: (v) => f(v, 1) + ' %' }], per, { id: 'tb-op-util', nombre: 'trasiego_utilizacion_mensual', max: 12 });
    const mx = per.slice().sort((a, b) => b.util - a.util)[0], mean = S.mean(per.map((p) => p.util));
    const lectura = UI.lectura(`El sistema de trasiego estuvo ocupado en promedio el <strong>${f(mean, 0)} %</strong> del tiempo (el máximo fue ${esc(mx.label)} con ${f(mx.util, 0)} %). El resto del tiempo está libre o en CIP, aseos y esperas; si la utilización sube de forma sostenida por encima de ~70 % cualquier imprevisto se traduce en retrasos para el siguiente trasiego.`);
    return UI.card('Utilización del sistema de trasiego', 'Qué parte del tiempo se usó trasegando (mes por mes).', X.grid12(graf, tabla) + lectura, { id: 'op-util' });
  }

  function bloqueSemanal(d, ctx, UI) {
    const { rows, M } = d;
    const pl = rows.filter((r) => r.delay != null);
    const wk = S.aggregate(pl, { t: 't', v: 'delay', fn: 'median', by: 'week' });
    const cnt = S.aggregate(rows.filter((r) => r.kind === 'Trasiego'), { t: 't', v: 'duration', fn: 'count', by: 'week' });
    if (wk.length < 3) return UI.card('Tendencia semanal', 'Desvío y número de trasiegos por semana.', UI.vacio('Se necesitan al menos 3 semanas con actividades para ver la tendencia (amplía el periodo).'), { id: 'op-sem' });
    const t = X.tendencia(wk.map((w) => w.v), 'down');
    const l = X.fig('line', { title: 'Desvío mediano por semana (h)', unit: 'h', xType: 'time', series: [{ name: 'Mediana semanal', points: wk.map((w) => ({ x: w.t, y: w.v, label: `${w.label}: ${f(w.v, 1)} h (${w.n} actividades)` })), color: 'var(--est)' }], refs: [{ y: M.dmax, label: 'Límite ' + M.dmax + ' h' }], yFmt: (v) => f(v, 0) });
    const b = X.fig('bars', { title: 'Trasiegos por semana', categories: cnt.map((w) => w.label), series: [{ name: 'Trasiegos', values: cnt.map((w) => w.v), color: 'var(--est)' }], yFmt: (v) => f(v, 0) });
    const mejor = wk.slice().sort((a, b) => a.v - b.v)[0], peor = wk.slice().sort((a, b) => b.v - a.v)[0];
    const lectura = UI.lectura(`La semana con mejor desvío fue ${esc(mejor.label)} (${f(mejor.v, 1)} h) y la peor ${esc(peor.label)} (${f(peor.v, 1)} h). ${t ? (t.trend === 'sin tendencia' ? 'No hay una tendencia clara semana a semana (Mann-Kendall).' : `La tendencia es <strong>${t.trend === 'sube' ? 'a empeorar' : 'a mejorar'}</strong> y ${X.sig(t.p, t.n)}, unas ${f(Math.abs(t.sen), 1)} h por semana.`) : ''} ${cnt.length ? `Se hacen en promedio ${f(S.mean(cnt.map((c) => c.v)), 1)} trasiegos por semana.` : ''}`, t && t.tono === 'bad' ? 'warn' : '');
    return UI.card('Tendencia semanal', 'Cómo evoluciona el desvío y el ritmo de trasiegos.', UI.grid([l, b], 2) + lectura, { id: 'op-sem' });
  }

  function bloqueGantt(d, ctx, UI) {
    const { rows, M } = d;
    const ult = rows.filter((r) => r.actualEnd != null && r.durOk != null).slice(-14);
    if (!ult.length) return '';
    const graf = X.fig('gantt', {
      title: 'Últimas actividades ejecutadas', w: 1000, h: ult.length * 28 + 70,
      rows: ult.map((r) => ({ label: `${sh(r.activity.replace(/^TRASIEGO\s*/i, 'T '), 22)} · ${sh(r.brandN, 12)}`, start: r.t, end: r.actualEnd, status: r.delay == null ? 'pendiente' : r.delay > M.dmax ? 'atrasado' : 'ok' })),
    });
    return UI.card('Línea de tiempo de los últimos trasiegos', 'Verde: a tiempo; rojo: terminó con más de ' + M.dmax + ' h de retraso.', graf, { id: 'op-gantt' });
  }

  function bloqueRecurrentes(d, ctx, UI) {
    const { rows, M } = d;
    const mk = (key, nombre) => {
      const g = new Map();
      for (const r of rows.filter((x) => x.delay != null)) { const k = r[key]; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
      return [...g.entries()].filter(([k, v]) => v.length >= 3 && !/^\(sin/.test(k)).map(([k, v]) => {
        const late = v.filter((r) => r.delay > M.dmax);
        const cs = new Map(); late.filter((r) => r.grupo !== SIN).forEach((r) => cs.set(r.grupo, (cs.get(r.grupo) || 0) + 1));
        const top = [...cs.entries()].sort((a, b) => b[1] - a[1])[0];
        return { grupo: k, n: v.length, tardes: late.length, pct: (late.length / v.length) * 100, h: late.reduce((a, r) => a + r.delay, 0), med: S.median(v.map((r) => r.delay)), causa: top ? top[0] : '—', source: 'Programa de trasiego' };
      }).sort((a, b) => b.h - a.h);
    };
    const porMarca = mk('brandN'), porDest = mk('destN');
    if (!porMarca.length && !porDest.length) return '';
    const cols = (t) => [{ k: 'grupo', t }, { k: 'n', t: 'Actividades', num: 1 }, { k: 'tardes', t: 'Con retraso', num: 1 }, { k: 'pct', t: '% con retraso', num: 1, f: (v) => f(v, 0) + ' %' }, { k: 'h', t: 'Horas perdidas', num: 1, f: (v) => f(v, 0) }, { k: 'med', t: 'Desvío mediano (h)', num: 1, f: (v) => f(v, 1) }, { k: 'causa', t: 'Causa más repetida' }];
    const peor = porDest.filter((x) => x.pct >= 50)[0] || porDest[0], peorM = porMarca[0];
    const lectura = UI.lectura(`${peorM ? `Por marca, <strong>${esc(peorM.grupo)}</strong> acumula más horas perdidas (${f(peorM.h, 0)} h, ${f(peorM.pct, 0)} % de sus actividades con retraso).` : ''} ${peor ? `Por destino, <strong>${esc(peor.grupo)}</strong> es el que más se repite (${peor.tardes} de ${peor.n} con retraso, ${f(peor.h, 0)} h).` : ''} Solo se listan grupos con al menos 3 actividades para no sacar conclusiones de un caso suelto.`);
    return UI.card('Retrasos recurrentes', 'Marcas y destinos (SV) donde el retraso se repite.', UI.grid([`<div><p class="an-sub">Por marca</p>${UI.tabla(cols('Marca'), porMarca, { id: 'tb-op-rm', nombre: 'trasiego_retrasos_por_marca', max: 8 })}</div>`, `<div><p class="an-sub">Por destino</p>${UI.tabla(cols('Destino'), porDest, { id: 'tb-op-rd', nombre: 'trasiego_retrasos_por_destino', max: 8 })}</div>`], 1) + lectura, { id: 'op-rec' });
  }

  function bloqueDetalleT(d, ctx, UI) {
    const { rows, M } = d;
    const tabla = UI.tabla([
      { k: 't', t: 'Inicio', f: (v) => esc(AN.fmtDateTime(v)) }, { k: 'activity', t: 'Actividad', f: (v) => esc(sh(v, 44)) }, { k: 'brandN', t: 'Marca' }, { k: 'destN', t: 'Destino' },
      { k: 'duration', t: 'Duración (h)', num: 1, f: (v) => (v == null ? '—' : f(v, 1)) }, { k: 'delay', t: 'Desvío (h)', num: 1, f: (v) => (v == null ? '—' : (v > 0 ? '+' : '') + f(v, 1)) }, { k: 'grupo', t: 'Causa' }, { k: 'source', t: 'Fuente' },
    ], rows.slice(), { id: 'tb-op-det', nombre: 'trasiego_detalle', max: 12, sort: { k: 't', dir: -1 } });
    return UI.card('Detalle de actividades', 'Todas las actividades del periodo; pasa el cursor sobre una fila para ver su fuente.', tabla, { id: 'op-det' });
  }

  /* ============================================================
     ASEOS
     ============================================================ */
  const fam = (e) => String(e || '').replace(/\s*\d+(\s*[-/]\s*\d+)?\s*$/, '').trim() || e;
  const SHEETS = { '1. Cada uso': 'Cada uso', '2. Semanal': 'Semanal', '3. Mensual': 'Mensual', '5. CIP del CIP': 'CIP del CIP', 'Aseo CIPs': 'Aseo CIPs', 'Cambio de marca': 'Cambio de marca' };
  const opNorm = (s) => String(s || '').replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  const OPALIAS = { 'LJUIS B': 'LUIS B', 'LUIIS B': 'LUIS B', 'LUUIS B': 'LUIS B', 'CARLOS G': 'CARLOS G', 'CARLO G': 'CARLOS G', 'CARLO SG': 'CARLOS G', 'CAROLS G': 'CARLOS G', 'IVAN O': 'IVAN', 'IVAN': 'IVAN', 'SEBAS': 'SEBAS D', 'SEBASTIAN D': 'SEBAS D', 'SEBAS D': 'SEBAS D', 'STIVE R': 'STIVEN R', 'STIVEN': 'STIVEN R', 'CAMILO': 'CAMILO Z', 'CAMILOZ': 'CAMILO Z', 'JEAN C': 'JEAN C', 'JENA C': 'JEAN C', 'LAURA': 'LAURA E', 'LAURA A': 'LAURA A', 'LAUARA E': 'LAURA E', 'ANGELO': 'ANGELO M', 'JHON': 'JHON T', 'FABIO': 'FABIO M', 'URIEL': 'URIEL R', 'YEFERSON T': 'YEFERSON T' };
  const personas = (s) => {
    const parts = opNorm(s).split(/\s*(?:\/|-|_|&|,| Y )\s*/).map((x) => x.trim()).filter((x) => x && x.length > 2);
    return parts.map((p) => X.tc(OPALIAS[p] || p));
  };
  function rawAseos() {
    const m = new Map();
    let recs = [];
    try { recs = A.OperationSources.records('aseos', '1. Cada uso'); } catch (e) { /* sin fuente */ }
    for (const r of recs) {
      const c = r.cells || {};
      const lum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      m.set(r.id, { cumpl: typeof c[7] === 'number' && c[7] >= 0 && c[7] <= 1.0001 ? c[7] * 100 : null, lumYpt: lum(c[26]), lumToma: lum(c[27]) });
    }
    return m;
  }
  function estadoPrograma(ctx) {
    const out = [];
    const SRC = A.OperationSources;
    const now = Math.min(Date.now(), ctx.rango.to + DAY);
    for (const sheet of ['2. Semanal', '3. Mensual']) {
      let recs = [];
      try { recs = SRC.records('aseos', sheet); } catch (e) { continue; }
      for (const r of recs) {
        const c = r.cells || {};
        if (c[1] == null || !c[4]) continue;
        const prog = A.DL.time(c[1]);
        if (prog == null || prog < ctx.rango.from || prog > ctx.rango.to) continue;
        let s = null;
        try { s = SRC.status('aseos', sheet, r); } catch (e) { s = null; }
        const label = s ? s.label : '';
        const k = /pendiente|vencido/i.test(label) ? 'pend' : /registrado/i.test(label) ? 'hecho' : /programado/i.test(label) ? 'prog' : /curso/i.test(label) ? 'curso' : 'otro';
        out.push({ sheet: SHEETS[sheet], equipo: X.tc(String(c[4]).trim()), prog, estado: label, k, atraso: k === 'pend' ? Math.max(0, (now - prog) / DAY) : null, source: sheet + ' · fila ' + r.row });
      }
    }
    return out;
  }
  function prepA(rows, ex) {
    return rows.map((r) => {
      const e = ex.get(r.id) || {};
      const durOk = ok(r.durMin) && r.durMin > 0 && r.durMin <= 1440 ? r.durMin : null;
      return Object.assign({}, r, { equipment: X.tc(r.equipment), fam: X.tc(fam(r.equipment)), tipo: SHEETS[r.sheet] || r.sheet, cumpl: e.cumpl != null ? e.cumpl : null, lum: e.lumYpt != null || e.lumToma != null ? Math.max(e.lumYpt || 0, e.lumToma || 0) : null, lumYpt: e.lumYpt, lumToma: e.lumToma, durOk, phOkN: r.ph != null && r.ph >= 3 && r.ph <= 11 ? r.ph : null });
    });
  }
  function resA(rs, Ms) {
    const m3 = X.vals(rs, 'm3');
    const ph = rs.filter((r) => r.phOkN != null);
    const cu = rs.filter((r) => r.cumpl != null);
    return {
      n: rs.length, m3Tot: X.sum(m3), m3Mean: S.mean(m3), m3Over: m3.filter((x) => x > Ms.aseoM3).length, nM3: m3.length,
      phN: ph.length, phOut: ph.filter((r) => r.phOkN < Ms.phMin || r.phOkN > Ms.phMax).length,
      cuN: cu.length, cuOk: cu.filter((r) => r.cumpl >= 99.9).length, cuMean: S.mean(cu.map((r) => r.cumpl)), durMed: S.median(X.vals(rs, 'durOk')),
      nLum: rs.filter((r) => r.lum != null).length,
    };
  }
  function calcA(ctx) {
    return X.memo(ctx, 'aseos', ['aseos'], () => {
      const Ms = { aseoM3: A.Metas.get('agua.aseoM3', 10), phMin: A.Metas.get('aseos.phMin', 6), phMax: A.Metas.get('aseos.phMax', 8) };
      const ex = rawAseos();
      const rows = prepA(ctx.rows('aseos'), ex).sort((a, b) => a.t - b.t);
      const prev = prepA(ctx.previas('aseos'), ex);
      return { Ms, rows, prev, R: resA(rows, Ms), P: prev.length >= 8 ? resA(prev, Ms) : null, prog: estadoPrograma(ctx) };
    });
  }

  function kpisA(d) {
    const { R, P, Ms, prog } = d;
    const pc = (a, n) => (n > 0 ? (a / n) * 100 : null);
    const pend = prog.filter((x) => x.k === 'pend').length;
    const phIn = R.phN ? 100 - (R.phOut / R.phN) * 100 : null, phInP = P && P.phN ? 100 - (P.phOut / P.phN) * 100 : null;
    return X.kpis([
      { label: 'Aseos realizados', value: f(R.n, 0), help: 'Todas las hojas de aseos', cur: R.n, prev: P && P.n, good: 'up' },
      { label: 'Agua estimada', value: f(R.m3Tot, 0), unit: 'm³', help: 'Caudal × minutos de enjuague', cur: R.m3Tot, prev: P && P.m3Tot, good: 'down' },
      { label: 'Agua por aseo', value: R.m3Mean != null ? f(R.m3Mean, 1) : '—', unit: 'm³', help: `Meta < ${Ms.aseoM3} m³`, cur: R.m3Mean, prev: P && P.m3Mean, good: 'down' },
      { label: 'Aseos sobre la meta de agua', value: R.nM3 ? f(pc(R.m3Over, R.nM3), pc(R.m3Over, R.nM3) < 1 && R.m3Over ? 1 : 0) : '—', unit: '%', help: `${R.m3Over} de ${R.nM3} con dato`, cur: pc(R.m3Over, R.nM3), prev: P && pc(P.m3Over, P.nM3), good: 'down' },
      { label: `pH de enjuague en ${Ms.phMin}–${Ms.phMax}`, value: phIn != null ? f(phIn, phIn >= 99 && phIn < 100 ? 1 : 0) : '—', unit: '%', help: `${R.phOut} fuera de ${R.phN} medidos`, cur: phIn, prev: phInP, good: 'up' },
      { label: 'Cumplen todos los parámetros', value: R.cuN ? f(pc(R.cuOk, R.cuN), 0) : '—', unit: '%', help: `${R.cuOk} de ${R.cuN} aseos «Cada uso»`, cur: pc(R.cuOk, R.cuN), prev: P && pc(P.cuOk, P.cuN), good: 'up' },
      { label: 'Duración mediana', value: R.durMed != null ? f(R.durMed, 0) : '—', unit: 'min', cur: R.durMed, prev: P && P.durMed, good: 'down', help: 'Inicio a fin del aseo' },
      { label: 'Pendientes / vencidos', value: f(pend, 0), help: 'Aseos programados sin registrar (semanal y mensual)', good: 'down' },
    ]);
  }

  function bloqueVolumenA(d, ctx, UI) {
    const { rows } = d;
    if (!rows.length) return '';
    const by = X.monthsCover(ctx.rango.from, ctx.rango.to);
    const tipos = [...new Set(rows.map((r) => r.tipo))];
    const keys = new Map();
    for (const r of rows) { const k = A.DL.periodKey(r.t, by); keys.set(k.k, k); }
    const ks = [...keys.values()].sort((a, b) => a.t - b.t);
    const cnt = (k, tp) => rows.filter((r) => A.DL.periodKey(r.t, by).k === k && r.tipo === tp).length;
    const idx = new Map(); for (const r of rows) { const k = A.DL.periodKey(r.t, by).k + '|' + r.tipo; idx.set(k, (idx.get(k) || 0) + 1); }
    const g1 = X.fig('stacked', { title: `Aseos por ${by === 'month' ? 'mes' : by === 'week' ? 'semana' : 'día'} y tipo`, categories: ks.map((k) => k.label), series: tipos.map((tp, i) => ({ name: tp, values: ks.map((k) => idx.get(k.k + '|' + tp) || 0), color: C.palette[i % C.palette.length] })), yFmt: (v) => f(v, 0) });
    const eq = new Map(); for (const r of rows) eq.set(r.equipment, (eq.get(r.equipment) || 0) + 1);
    const top = [...eq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const g2 = X.fig('barsH', { title: 'Equipos con más aseos', data: top.map(([k, v]) => ({ label: k, value: v, color: 'var(--est)' })), xFmt: (v) => f(v, 0) });
    const fm = new Map(); for (const r of rows) fm.set(r.fam, (fm.get(r.fam) || 0) + 1);
    const topF = [...fm.entries()].sort((a, b) => b[1] - a[1])[0];
    const lectura = UI.lectura(`Se registraron <strong>${f(rows.length, 0)} aseos</strong> en ${eq.size} equipos distintos. El equipo con más aseos es <strong>${esc(top[0][0])}</strong> (${top[0][1]}) y el tipo de equipo más aseado es <strong>${esc(topF[0])}</strong> (${topF[1]}, ${f((topF[1] / rows.length) * 100, 0)} %). ${d.P ? `En el periodo anterior fueron ${d.P.n}.` : ''}`);
    return UI.card('Cuántos aseos y dónde', 'Aseos por periodo y tipo (hoja del Excel) y los equipos que más se aseán.', UI.grid([g1, g2], 2) + lectura, { id: 'as-vol' });
  }

  function bloqueAguaA(d, ctx, UI) {
    const { rows, Ms, R } = d;
    const cm = rows.filter((r) => r.m3 != null);
    if (cm.length < 3) return UI.card('Agua por aseo frente a la meta', `Meta: menos de ${Ms.aseoM3} m³ por aseo.`, UI.vacio('Hay muy pocos aseos con caudal y minutos de enjuague en el periodo.'), { id: 'as-agua' });
    const g = new Map(); for (const r of cm) { if (!g.has(r.fam)) g.set(r.fam, []); g.get(r.fam).push(r.m3); }
    const filas = [...g.entries()].filter(([, v]) => v.length >= 3).map(([k, v]) => ({ fam: k, n: v.length, media: S.mean(v), mediana: S.median(v), max: Math.max(...v), sobre: v.filter((x) => x > Ms.aseoM3).length, pct: (v.filter((x) => x > Ms.aseoM3).length / v.length) * 100, total: X.sum(v), source: 'Aseos · caudal × min / 600' })).sort((a, b) => b.total - a.total);
    const bars = X.fig('barsH', { title: 'm³ de agua por aseo, promedio por tipo de equipo', data: filas.slice(0, 12).map((r) => ({ label: r.fam, value: r.media, color: r.media > Ms.aseoM3 ? 'var(--neg)' : 'var(--est)', note: r.n + ' aseos' })), refs: [{ y: Ms.aseoM3, label: 'Meta ' + Ms.aseoM3 + ' m³' }], xFmt: (v) => f(v, 1) });
    const hist = X.fig('histogram', { title: 'Cómo se reparte el agua por aseo', values: cm.map((r) => r.m3), usl: Ms.aseoM3, unit: 'm³', normal: false, xFmt: (v) => f(v, 0) });
    const tabla = UI.tabla([
      { k: 'fam', t: 'Tipo de equipo' }, { k: 'n', t: 'Aseos', num: 1 }, { k: 'media', t: 'm³ promedio', num: 1, f: (v) => f(v, 1) }, { k: 'mediana', t: 'm³ mediana', num: 1, f: (v) => f(v, 1) }, { k: 'max', t: 'm³ máx.', num: 1, f: (v) => f(v, 1) },
      { k: 'pct', t: '% sobre la meta', num: 1, f: (v) => f(v, 0) + ' %' }, { k: 'total', t: 'm³ totales', num: 1, f: (v) => f(v, 0) },
    ], filas, { id: 'tb-as-agua', nombre: 'aseos_agua_por_equipo', max: 10 });
    const peor = filas.slice().sort((a, b) => b.media - a.media)[0];
    const tot = X.sum(filas.map((r) => r.total)), topShare = filas[0] ? (filas[0].total / tot) * 100 : 0;
    const lectura = UI.lectura(`Un aseo gasta en promedio <strong>${f(R.m3Mean, 1)} m³</strong> (meta < ${Ms.aseoM3}); ${R.m3Over} de ${R.nM3} aseos (${f((R.m3Over / R.nM3) * 100, 0)} %) la superaron. El tipo de equipo que más agua gasta por aseo es <strong>${esc(peor.fam)}</strong> (${f(peor.media, 1)} m³) y el que más agua suma en total es <strong>${esc(filas[0].fam)}</strong> (${f(topShare, 0)} % del agua de aseos). Estimación = caudal (Hl/h) × minutos de enjuague ÷ 600.`, peor.media > Ms.aseoM3 ? 'warn' : '');
    return UI.card('Agua por aseo frente a la meta', `Meta: menos de ${Ms.aseoM3} m³ por aseo. Rojo = el promedio de ese equipo pasa la meta.`, UI.grid([bars, hist], 2) + tabla + lectura, { id: 'as-agua' });
  }

  function bloquePhA(d, ctx, UI) {
    const { rows, Ms, R } = d;
    const ph = rows.filter((r) => r.phOkN != null);
    if (ph.length < 3) return UI.card('pH de enjuague', `Debe estar entre ${Ms.phMin} y ${Ms.phMax}.`, UI.vacio('Hay muy pocas mediciones de pH de enjuague en el periodo.'), { id: 'as-ph' });
    const fuera = ph.filter((r) => r.phOkN < Ms.phMin || r.phOkN > Ms.phMax);
    const wmed = S.aggregate(ph, { t: 't', v: 'phOkN', fn: 'median', by: 'week' }), wmin = S.aggregate(ph, { t: 't', v: 'phOkN', fn: 'min', by: 'week' }), wmax = S.aggregate(ph, { t: 't', v: 'phOkN', fn: 'max', by: 'week' });
    const line = X.fig('line', { title: 'pH de enjuague por semana (mediana y rango)', unit: 'pH', xType: 'time', series: [{ name: 'Mediana semanal', points: wmed.map((w, i) => ({ x: w.t, y: w.v, label: `${w.label}: mediana ${f(w.v, 2)} · mín ${f(wmin[i].v, 1)} · máx ${f(wmax[i].v, 1)} (${w.n} aseos)` })), color: 'var(--est)' }], band: { name: 'Mínimo a máximo de la semana', lo: wmin.map((w) => w.v), hi: wmax.map((w) => w.v) }, refs: [{ y: Ms.phMin, label: 'Mín ' + Ms.phMin, color: 'var(--pos)' }, { y: Ms.phMax, label: 'Máx ' + Ms.phMax, color: 'var(--pos)' }], yFmt: (v) => f(v, 1) });
    const g = new Map(); for (const r of fuera) g.set(r.fam, (g.get(r.fam) || 0) + 1);
    const tot = new Map(); for (const r of ph) tot.set(r.fam, (tot.get(r.fam) || 0) + 1);
    const filas = [...g.entries()].map(([k, v]) => ({ fam: k, fuera: v, n: tot.get(k), pct: (v / tot.get(k)) * 100, source: 'Aseos · pH enjuague' })).sort((a, b) => b.fuera - a.fuera);
    const tabla = filas.length ? UI.tabla([{ k: 'fam', t: 'Tipo de equipo' }, { k: 'fuera', t: 'Fuera de rango', num: 1 }, { k: 'n', t: 'Medidos', num: 1 }, { k: 'pct', t: '%', num: 1, f: (v) => f(v, 0) + ' %' }], filas, { id: 'tb-as-ph', nombre: 'aseos_ph_fuera_de_rango', max: 8 }) : `<div class="an-empty ok"><b>Todo en rango</b><span>Ningún pH de enjuague salió de ${Ms.phMin}–${Ms.phMax}.</span></div>`;
    const lectura = UI.lectura(`${fuera.length ? `<strong>${fuera.length} de ${ph.length}</strong> mediciones (${f((fuera.length / ph.length) * 100, 1)} %) salieron del rango ${Ms.phMin}–${Ms.phMax}${filas[0] ? `; el tipo de equipo que más se sale es ${esc(filas[0].fam)} (${filas[0].fuera} veces)` : ''}. Un pH de enjuague fuera de rango suele indicar que quedó soda o ácido: conviene repetir el enjuague.` : `Todas las ${ph.length} mediciones estuvieron en el rango ${Ms.phMin}–${Ms.phMax}.`}`, fuera.length / ph.length > 0.1 ? 'warn' : 'ok');
    return UI.card('pH de enjuague', `Debe estar entre ${Ms.phMin} y ${Ms.phMax}.`, X.grid12(line, tabla) + lectura, { id: 'as-ph' });
  }

  function bloqueCumplimientoA(d, ctx, UI) {
    const { rows } = d;
    const cu = rows.filter((r) => r.cumpl != null);
    if (cu.length < 3) return UI.card('Cumplimiento de parámetros', 'Soda, trimeta, tiempos, temperaturas y pH frente a la tabla de parámetros CMP.', UI.vacio('Los aseos del periodo no traen el % de cumplimiento de parámetros.'), { id: 'as-cump' });
    const by = X.monthsCover(ctx.rango.from, ctx.rango.to) === 'day' ? 'week' : X.monthsCover(ctx.rango.from, ctx.rango.to);
    const g = new Map(); for (const r of cu) { const k = A.DL.periodKey(r.t, by); if (!g.has(k.k)) g.set(k.k, { ...k, v: [] }); g.get(k.k).v.push(r.cumpl); }
    const per = [...g.values()].sort((a, b) => a.t - b.t).map((e) => ({ label: e.label, n: e.v.length, pct: (e.v.filter((x) => x >= 99.9).length / e.v.length) * 100, media: S.mean(e.v) }));
    const graf = X.fig('bars', { title: '% de aseos que cumplen todos los parámetros', categories: per.map((p) => p.label), series: [{ name: '% que cumple 100 %', values: per.map((p) => p.pct), color: 'var(--pos)' }], unit: '%', yFmt: (v) => f(v, 0) });
    const ge = new Map(); for (const r of cu) { if (!ge.has(r.fam)) ge.set(r.fam, []); ge.get(r.fam).push(r.cumpl); }
    const filas = [...ge.entries()].filter(([, v]) => v.length >= 5).map(([k, v]) => ({ fam: k, n: v.length, pct: (v.filter((x) => x >= 99.9).length / v.length) * 100, media: S.mean(v), source: 'Aseos · Cada uso' })).sort((a, b) => a.pct - b.pct);
    const tabla = UI.tabla([{ k: 'fam', t: 'Tipo de equipo' }, { k: 'n', t: 'Aseos', num: 1 }, { k: 'pct', t: '% que cumple 100 %', num: 1, f: (v) => f(v, 0) + ' %' }, { k: 'media', t: 'Cumplimiento medio', num: 1, f: (v) => f(v, 0) + ' %' }], filas, { id: 'tb-as-cump', nombre: 'aseos_cumplimiento_por_equipo', max: 8 });
    const tot = (cu.filter((r) => r.cumpl >= 99.9).length / cu.length) * 100;
    const t = X.tendencia(per.map((p) => p.pct), 'up');
    const lectura = UI.lectura(`El <strong>${f(tot, 0)} %</strong> de los ${cu.length} aseos «Cada uso» cumplió todos los parámetros (cumplimiento medio ${f(S.mean(cu.map((r) => r.cumpl)), 0)} %). ${filas[0] && filas[0].pct < 100 ? `El tipo de equipo con menor cumplimiento es <strong>${esc(filas[0].fam)}</strong> (${f(filas[0].pct, 0)} %).` : ''} ${t && t.trend !== 'sin tendencia' ? `La tendencia es <strong>${t.trend === 'sube' ? 'a mejorar' : 'a empeorar'}</strong> (${X.sig(t.p, t.n)}).` : ''}`, tot < 85 ? 'warn' : 'ok');
    return UI.card('Cumplimiento de parámetros', 'Aseos «Cada uso» que cumplieron todos los parámetros de concentración, tiempo, temperatura y pH.', X.grid12(graf, filas.length ? tabla : '<span></span>') + lectura, { id: 'as-cump' });
  }

  function bloquePendientes(d, ctx, UI) {
    const { prog } = d;
    if (!prog.length) return UI.card('Aseos programados: pendientes y vencidos', 'Hojas semanal y mensual.', UI.vacio('No hay aseos programados (semanal o mensual) dentro del periodo.'), { id: 'as-pend' });
    const cnt = (k) => prog.filter((x) => x.k === k).length;
    const data = [{ label: 'Registrados', value: cnt('hecho'), color: 'var(--pos)' }, { label: 'Programados', value: cnt('prog'), color: 'var(--est)' }, { label: 'Pendientes', value: cnt('pend'), color: 'var(--neg)' }, { label: 'En curso', value: cnt('curso'), color: 'var(--warn)' }, { label: 'Otros', value: cnt('otro'), color: 'var(--faint)' }].filter((x) => x.value > 0);
    const donut = X.fig('donut', { title: 'Estado del programa de aseos', data, w: 440, h: 230 });
    const pend = prog.filter((x) => x.k === 'pend').sort((a, b) => b.atraso - a.atraso);
    const porEq = new Map(); pend.forEach((x) => porEq.set(x.equipo, (porEq.get(x.equipo) || 0) + 1));
    const tabla = pend.length ? UI.tabla([{ k: 'sheet', t: 'Hoja' }, { k: 'equipo', t: 'Equipo', f: (v) => esc(sh(v, 44)) }, { k: 'prog', t: 'Programado', f: (v) => esc(fd(v)) }, { k: 'atraso', t: 'Días de atraso', num: 1, f: (v) => f(v, 0) }, { k: 'estado', t: 'Estado' }], pend, { id: 'tb-as-pend', nombre: 'aseos_pendientes_vencidos', max: 10, sort: { k: 'atraso', dir: -1 } }) : `<div class="an-empty ok"><b>Nada pendiente</b><span>Todos los aseos programados del periodo están registrados.</span></div>`;
    const hechos = cnt('hecho'), base = hechos + cnt('pend');
    const lectura = UI.lectura(`De ${prog.length} aseos programados en el periodo, <strong>${cnt('pend')}</strong> están pendientes o vencidos${base ? ` (${f((cnt('pend') / base) * 100, 0)} % de los que ya debían estar hechos)` : ''} y ${hechos} se registraron. ${pend.length ? `Los equipos con más pendientes: ${[...porEq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${esc(sh(k, 36))} (${v})`).join(', ')}.` : ''} Las hojas semanal y mensual trabajan con una fecha programada; el estado lo calcula la plataforma comparando con la fecha de hoy.`, cnt('pend') > 0 ? 'warn' : 'ok');
    return UI.card('Aseos programados: pendientes y vencidos', 'Cumplimiento de la frecuencia (hojas «2. Semanal» y «3. Mensual») con fecha programada en el periodo.', X.grid12(donut, tabla) + lectura, { id: 'as-pend' });
  }

  function bloqueOperarios(d, ctx, UI) {
    const { rows, Ms } = d;
    const g = new Map();
    for (const r of rows) {
      if (!r.operator) continue;
      for (const p of personas(r.operator)) { if (!g.has(p)) g.set(p, []); g.get(p).push(r); }
    }
    const filas = [...g.entries()].filter(([, v]) => v.length >= 5).map(([k, v]) => {
      const cu = v.filter((r) => r.cumpl != null), ph = v.filter((r) => r.phOkN != null), m3 = X.vals(v, 'm3');
      return { op: k, n: v.length, cump: cu.length ? (cu.filter((r) => r.cumpl >= 99.9).length / cu.length) * 100 : null, phOut: ph.length ? (ph.filter((r) => r.phOkN < Ms.phMin || r.phOkN > Ms.phMax).length / ph.length) * 100 : null, m3: S.mean(m3), source: 'Aseos · Cada uso' };
    }).sort((a, b) => b.n - a.n);
    if (filas.length < 2) return UI.card('Operarios', 'Carga de trabajo y cumplimiento por persona.', UI.vacio('Los aseos del periodo no traen operario o hay menos de 5 por persona.'), { id: 'as-ops' });
    const bars = X.fig('barsH', { title: 'Aseos por operario', data: filas.slice(0, 12).map((r) => ({ label: r.op, value: r.n, color: 'var(--est)' })), xFmt: (v) => f(v, 0) });
    const tabla = UI.tabla([{ k: 'op', t: 'Operario' }, { k: 'n', t: 'Aseos', num: 1 }, { k: 'cump', t: '% cumple parámetros', num: 1, f: (v) => (v == null ? '—' : f(v, 0) + ' %') }, { k: 'phOut', t: '% pH fuera', num: 1, f: (v) => (v == null ? '—' : f(v, 1) + ' %') }, { k: 'm3', t: 'm³ por aseo', num: 1, f: (v) => (v == null ? '—' : f(v, 1)) }], filas, { id: 'tb-as-op', nombre: 'aseos_por_operario', max: 10 });
    const cum = filas.filter((r) => r.cump != null && r.n >= 10).sort((a, b) => a.cump - b.cump);
    const lectura = UI.lectura(`<strong>${esc(filas[0].op)}</strong> es quien más aseos registra (${filas[0].n}). ${cum.length >= 2 ? `El cumplimiento de parámetros va de ${f(cum[0].cump, 0)} % (${esc(cum[0].op)}) a ${f(cum[cum.length - 1].cump, 0)} % (${esc(cum[cum.length - 1].op)}).` : ''} Si en una celda hay dos nombres, el aseo se cuenta para cada persona. Los nombres se escriben de muchas formas en el Excel; se unifican las variantes más comunes, pero conviene estandarizarlos. Sirve para repartir carga y capacitar, no para juzgar personas: la diferencia puede deberse a los equipos que le tocan.`);
    return UI.card('Operarios', 'Carga de trabajo y cumplimiento por persona (solo quien tiene 5 aseos o más).', X.grid12(bars, tabla) + lectura, { id: 'as-ops' });
  }

  function bloqueLum(d, ctx, UI) {
    const lum = d.rows.filter((r) => r.lum != null);
    if (lum.length < 3) return UI.card('Luminometría', 'Prueba ATP de limpieza (valor en YPT y en toma-muestras).', UI.vacio(`Solo hay ${lum.length} aseos con valor de luminometría en el periodo (la mayoría dice «NA»).`), { id: 'as-lum' });
    const hist = X.fig('histogram', { title: 'Valores de luminometría (máx. entre YPT y toma-muestras)', values: lum.map((r) => r.lum), normal: false, xFmt: (v) => f(v, 0) });
    const bs = S.boxStats(lum.map((r) => r.lum));
    const atip = lum.filter((r) => bs && r.lum > bs.hi).sort((a, b) => b.lum - a.lum);
    const tabla = UI.tabla([{ k: 't', t: 'Fecha', f: (v) => esc(AN.fmtDateTime(v)) }, { k: 'equipment', t: 'Equipo' }, { k: 'lumYpt', t: 'YPT', num: 1, f: (v) => (v == null ? '—' : f(v, 0)) }, { k: 'lumToma', t: 'Toma-muestras', num: 1, f: (v) => (v == null ? '—' : f(v, 0)) }, { k: 'source', t: 'Fuente' }], lum.slice(), { id: 'tb-as-lum', nombre: 'aseos_luminometria', max: 8, sort: { k: 'lumYpt', dir: -1 } });
    const lectura = UI.lectura(`Hay ${lum.length} lecturas; la mediana es <strong>${f(bs.med, 0)}</strong> y ${atip.length ? `<strong>${atip.length}</strong> son atípicas (por encima de ${f(bs.hi, 0)}): el valor más alto fue ${f(atip[0].lum, 0)} en ${esc(atip[0].equipment)} el ${esc(fd(atip[0].t))}.` : 'ninguna es atípica.'} La plataforma no tiene un límite de luminometría configurado; úsalo según el criterio de calidad de la planta.`);
    return UI.card('Luminometría', 'Prueba ATP de limpieza (valor en YPT y en toma-muestras).', X.grid12(hist, tabla) + lectura, { id: 'as-lum' });
  }

  function bloqueDuracionA(d, ctx, UI) {
    const dur = d.rows.filter((r) => r.durOk != null);
    if (dur.length < 5) return UI.card('Duración de los aseos', 'Minutos entre inicio y fin por tipo de equipo.', UI.vacio('Hay muy pocos aseos con hora de inicio y fin en el periodo.'), { id: 'as-dur' });
    const g = new Map(); for (const r of dur) { if (!g.has(r.fam)) g.set(r.fam, []); g.get(r.fam).push(r); }
    const lista = [...g.entries()].filter(([, v]) => v.length >= 4).sort((a, b) => b[1].length - a[1].length);
    const box = X.fig('box', { title: 'Duración por tipo de equipo (min)', unit: 'min', groups: lista.slice(0, 8).map(([k, v]) => ({ label: `${sh(k, 16)} (${v.length})`, values: v.map((r) => r.durOk).filter((x) => x <= 600) })), yFmt: (v) => f(v, 0) });
    const filas = lista.map(([k, v]) => { const x = v.map((r) => r.durOk), bs = S.boxStats(x); return { fam: k, n: v.length, media: S.mean(x), mediana: S.median(x), p90: S.quantile(x, 0.9), atip: bs ? bs.outliers.length : 0, max: Math.max(...x), source: 'Aseos' }; });
    const tabla = UI.tabla([{ k: 'fam', t: 'Tipo de equipo' }, { k: 'n', t: 'Aseos', num: 1 }, { k: 'media', t: 'Media (min)', num: 1, f: (v) => f(v, 0) }, { k: 'mediana', t: 'Mediana', num: 1, f: (v) => f(v, 0) }, { k: 'p90', t: 'P90', num: 1, f: (v) => f(v, 0) }, { k: 'max', t: 'Máx.', num: 1, f: (v) => f(v, 0) }, { k: 'atip', t: 'Atípicos', num: 1 }], filas, { id: 'tb-as-dur', nombre: 'aseos_duracion_por_equipo', max: 10 });
    const atipT = filas.reduce((a, r) => a + r.atip, 0), may = filas.slice().sort((a, b) => b.mediana - a.mediana)[0];
    const lectura = UI.lectura(`La duración mediana de un aseo es <strong>${f(S.median(dur.map((r) => r.durOk)), 0)} min</strong>; el tipo que más tarda es <strong>${esc(may.fam)}</strong> (mediana ${f(may.mediana, 0)} min). Hay <strong>${atipT}</strong> aseos con duración atípica (fuera de la caja ± 1,5 veces su ancho): suelen ser interrupciones o registros mal cerrados y vale la pena revisarlos. En el gráfico no se dibujan los aseos de más de 10 h para no aplastar las cajas, pero sí cuentan en la tabla.`);
    return UI.card('Duración de los aseos', 'Minutos entre inicio y fin por tipo de equipo, con los casos atípicos.', X.grid12(box, tabla) + lectura, { id: 'as-dur' });
  }

  function bloqueDetalleA(d, ctx, UI) {
    const tabla = UI.tabla([
      { k: 't', t: 'Inicio', f: (v) => esc(AN.fmtDateTime(v)) }, { k: 'tipo', t: 'Tipo' }, { k: 'equipment', t: 'Equipo' }, { k: 'durOk', t: 'Min', num: 1, f: (v) => (v == null ? '—' : f(v, 0)) },
      { k: 'm3', t: 'm³', num: 1, f: (v) => (v == null ? '—' : f(v, 1)) }, { k: 'ph', t: 'pH', num: 1, f: (v) => (v == null ? '—' : f(v, 1)) }, { k: 'cumpl', t: 'Cumple %', num: 1, f: (v) => (v == null ? '—' : f(v, 0)) }, { k: 'operator', t: 'Operario' }, { k: 'source', t: 'Fuente' },
    ], d.rows.slice(), { id: 'tb-as-det', nombre: 'aseos_detalle', max: 12, sort: { k: 't', dir: -1 } });
    return UI.card('Detalle de aseos', 'Todos los aseos del periodo (pasa el cursor sobre una fila para ver su fuente).', tabla, { id: 'as-det' });
  }

  /* ============================================================
     Registro
     ============================================================ */
  const seg = () => `<div class="an-seg" role="group" aria-label="Qué parte de la operación ver">
    <button type="button" data-vista="trasiego" aria-pressed="${st.vista === 'trasiego'}">Trasiego</button><button type="button" data-vista="aseos" aria-pressed="${st.vista === 'aseos'}">Aseos</button></div>`;

  A.Analisis.registrar({
    id: 'operacion', label: 'Operación', orden: 7,
    render(ctx, UI) {
      const cab = `<div class="an-controls">${seg()}</div>`;
      if (st.vista === 'aseos') {
        const d = calcA(ctx);
        if (!d.rows.length && !d.prog.length) return cab + UI.card('Aseos', 'Ciclos de aseo (CIP) registrados.', UI.vacio('No hay aseos en este periodo. Prueba con «Todo el histórico».'));
        return cab + [kpisA(d), bloqueVolumenA(d, ctx, UI), bloqueAguaA(d, ctx, UI), bloquePhA(d, ctx, UI), bloqueCumplimientoA(d, ctx, UI), bloquePendientes(d, ctx, UI), bloqueOperarios(d, ctx, UI), bloqueLum(d, ctx, UI), bloqueDuracionA(d, ctx, UI), bloqueDetalleA(d, ctx, UI)].join('');
      }
      const d = calcT(ctx);
      if (!d.rows.length) return cab + UI.card('Programa de trasiego', 'Plan y ejecución de trasiegos y CIP.', UI.vacio('No hay actividades de trasiego en este periodo' + (ctx.filtraMarca ? ' y marcas elegidas' : '') + '. Prueba con «Todo el histórico».'));
      return cab + [kpisT(d), bloqueCumplimiento(d, ctx, UI), bloquePareto(d, ctx, UI), bloqueDuracion(d, ctx, UI), bloqueUtilizacion(d, ctx, UI), bloqueSemanal(d, ctx, UI), bloqueGantt(d, ctx, UI), bloqueRecurrentes(d, ctx, UI), bloqueDetalleT(d, ctx, UI)].join('');
    },
    mount(ctx, el) {
      el.querySelectorAll('[data-vista]').forEach((b) => { b.onclick = () => { st.vista = b.dataset.vista; X.rerender(); }; });
    },
    hallazgos(ctx) {
      const out = [];
      const d = calcT(ctx);
      if (d.rows.length) {
        const { R, M, rows, P } = d;
        if (R.nPlan >= 5) {
          const pOn = (R.aTiempo / R.nPlan) * 100;
          out.push({ sev: pOn < 40 ? 'alta' : pOn < 70 ? 'media' : 'ok', titulo: `Solo ${f(pOn, 0)} % de las actividades de trasiego cumple el plan`, detalle: `${R.tarde} de ${R.nPlan} terminaron con más de ${M.dmax} h de retraso; desvío mediano ${f(R.delayMed, 1)} h${P && P.nPlan ? ` (antes ${f((P.aTiempo / P.nPlan) * 100, 0)} % a tiempo)` : ''}.`, valor: f(pOn, 0) + ' %' });
          const g = new Map(); rows.filter((r) => r.delay > 0 && r.grupo !== SIN).forEach((r) => g.set(r.grupo, (g.get(r.grupo) || 0) + r.delay));
          const top = [...g.entries()].sort((a, b) => b[1] - a[1])[0];
          if (top) out.push({ sev: 'media', titulo: `Causa vital de retrasos de trasiego: ${top[0]}`, detalle: `${f(top[1], 0)} h perdidas con esta causa de ${f(R.perdidas, 0)} h totales de retraso (${f(R.perdidas ? (R.sinCausaH / R.perdidas) * 100 : 0, 0)} % de las horas perdidas no tiene causa registrada).`, valor: f(top[1], 0) + ' h' });
        }
        if (R.nDur >= 5 && R.durMed > M.plan + M.holg) out.push({ sev: 'media', titulo: 'Los trasiegos duran más que el plan', detalle: `Mediana ${f(R.durMed, 1)} h frente a ${M.plan} h planeadas.`, valor: f(R.durMed, 1) + ' h' });
      }
      const a = calcA(ctx);
      if (a.rows.length) {
        const { R, Ms, prog } = a;
        if (R.phN >= 10 && R.phOut / R.phN > 0.05) out.push({ sev: R.phOut / R.phN > 0.15 ? 'alta' : 'media', titulo: 'pH de enjuague fuera de 6–8 en aseos', detalle: `${R.phOut} de ${R.phN} aseos con pH fuera de ${Ms.phMin}–${Ms.phMax}.`, valor: f((R.phOut / R.phN) * 100, 0) + ' %' });
        if (R.nM3 >= 10 && R.m3Mean > Ms.aseoM3) out.push({ sev: 'media', titulo: 'Agua por aseo sobre la meta', detalle: `Promedio ${f(R.m3Mean, 1)} m³ frente a la meta de ${Ms.aseoM3} m³; ${R.m3Over} de ${R.nM3} aseos la superaron.`, valor: f(R.m3Mean, 1) + ' m³' });
        else if (R.nM3 >= 10) out.push({ sev: 'ok', titulo: 'Agua por aseo dentro de la meta', detalle: `Promedio ${f(R.m3Mean, 1)} m³ (meta < ${Ms.aseoM3} m³).` });
        const pend = prog.filter((x) => x.k === 'pend').length;
        if (pend) out.push({ sev: pend >= 10 ? 'alta' : 'media', titulo: `${pend} aseos programados pendientes o vencidos`, detalle: 'Hojas semanal y mensual del programa de aseos, con fecha programada en el periodo.', valor: String(pend) });
        if (R.cuN >= 10 && R.cuOk / R.cuN < 0.85) out.push({ sev: 'media', titulo: 'Cumplimiento de parámetros de aseo bajo', detalle: `Solo ${f((R.cuOk / R.cuN) * 100, 0)} % de los aseos «Cada uso» cumple todos los parámetros.`, valor: f((R.cuOk / R.cuN) * 100, 0) + ' %' });
      }
      return out;
    },
  });
})();
