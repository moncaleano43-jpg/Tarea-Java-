/* ============================================================
   42-an-agua.js · Análisis de agua (consumo por turno, contador, día, eficiencia, atípicos y pronóstico)
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.An1 || !A.Analisis) return;
  const An1 = A.An1, S = A.Stats, C = A.Charts, AN = A.Analisis;
  const { fmt, fmtPct, fmtDate, esc, iso } = AN;
  const { vals, sum, mean, med, rel, fin, W } = An1;
  const TURNOS = ['Mañana', 'Tarde', 'Noche'];
  const COMP = [['pisos', 'Pisos'], ['cip', 'CIP'], ['gea', 'CIP GEA']];
  const DOWN = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const dowIdx = (t) => (new Date(t).getDay() + 6) % 7;

  /* ---------- Pronóstico a fin de mes ---------- */
  function pronostico(all, endT) {
    const end = new Date(endT), y = end.getFullYear(), m = end.getMonth();
    const dim = new Date(y, m + 1, 0).getDate();
    const days = An1.porPeriodo(all.filter((r) => r.t <= endT), 'day');
    const inMonth = (t, yy, mm) => { const x = new Date(t); return x.getFullYear() === yy && x.getMonth() === mm; };
    const completos = days.filter((d) => d.rows.length >= 3).map((d) => ({ t: d.t, y: sum(vals(d.rows, 'total')) }));
    // total real del mes + turnos que faltan valorados con el promedio por turno del mes
    const mes = (yy, mm) => {
      const ds = days.filter((d) => inMonth(d.t, yy, mm));
      if (!ds.length) return null;
      const turnos = sum(ds.map((d) => d.rows.length)), real = sum(ds.map((d) => sum(vals(d.rows, 'total'))));
      const ultimo = new Date(ds[ds.length - 1].t).getDate(), dimM = new Date(yy, mm + 1, 0).getDate();
      return { ds, turnos, real, ultimo, dimM, estimado: real + Math.max(0, 3 * ultimo - turnos) * (real / turnos) };
    };
    const cur = mes(y, m);
    if (!cur || cur.ds.length < 3) return null;
    const rem = dim - cur.ultimo;
    const hist = completos.slice(-60);
    const lastC = hist.length ? new Date(hist[hist.length - 1].t).getDate() : cur.ultimo;
    const gap = Math.max(0, cur.ultimo - lastC);
    let fc = null;
    if (rem > 0 && hist.length >= 8) fc = S.forecast(hist.map((d) => d.y), { h: rem + gap });
    const fpts = fc ? fc.points.slice(gap).map((p) => ({ y: Math.max(0, p.y), lo: Math.max(0, p.lo != null ? p.lo : p.y), hi: p.hi != null ? p.hi : p.y })) : [];
    const half = Math.sqrt(sum(fpts.map((p) => Math.pow((p.hi - p.lo) / 2, 2))));
    const proy = cur.estimado + sum(fpts.map((p) => p.y));
    const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1;
    const prv = mes(py, pm);
    const prevTot = prv && prv.ultimo >= prv.dimM - 2 ? prv.estimado + Math.max(0, prv.dimM - prv.ultimo) * (prv.estimado / prv.ultimo) : null;
    return { y, m, dim, lastDay: cur.ultimo, rem, mtd: cur.estimado, mtdReal: cur.real, proy, lo: fc ? proy - half : null, hi: fc ? proy + half : null, metodo: fc ? fc.method : null, prevTot, diarios: hist.slice(-45), fpts, completo: rem <= 0 };
  }

  /* ---------- Cálculo completo (memoizado) ---------- */
  function aguaR(ctx) {
    return An1.memo(ctx, 'aguaR', () => {
      const ok = (r) => r.valid && r.total != null;
      const rows = An1.sane('agua', ctx.rows('agua')).filter(ok);
      const prev = An1.sane('agua', ctx.previas('agua')).filter(ok);
      const all = An1.sane('agua', ctx.todas('agua')).filter(ok);
      const R = { rows, prev, n: rows.length, nPrev: prev.length };
      const tot = vals(rows, 'total'), totP = vals(prev, 'total');
      R.m3 = sum(tot); R.mean = mean(tot); R.median = med(tot); R.sd = S.sd(tot); R.cv = S.cv(tot);
      R.prevMean = totP.length ? mean(totP) : null; R.prevM3 = totP.length ? sum(totP) : null;
      R.tt = tot.length > 1 && totP.length > 1 ? S.ttest(tot, totP) : null;
      R.by = An1.autoBy(ctx);
      R.per = An1.porPeriodo(rows, R.by);
      R.perS = An1.recorta(R.per, R.by);
      R.recortado = R.perS.length < R.per.length;
      R.ser = R.perS.map((p) => ({ t: p.t, label: p.label, y: mean(vals(p.rows, 'total')), n: p.rows.length }));
      R.spark = R.ser.map((p) => p.y);
      R.imr = R.ser.length >= 6 ? S.imr(R.ser.map((p) => p.y)) : null;
      R.maW = R.by === 'day' ? 7 : R.by === 'week' ? 4 : 3;
      R.ma = S.movingAvg(R.ser.map((p) => p.y), R.maW);
      R.tendencia = An1.trend(R.ser.map((p) => p.y), { unit: 'm³/turno', porPeriodo: An1.periodoTxt(R.by) });

      // Por contador
      R.cby = R.by === 'day' ? 'week' : R.by;
      R.cper = An1.recorta(An1.porPeriodo(rows, R.cby), R.cby);
      R.comp = COMP.map(([k, label]) => ({ k, label, mean: mean(vals(rows, k)), prev: prev.length ? mean(vals(prev, k)) : null }));
      const cs = sum(R.comp.map((c) => c.mean || 0));
      R.comp.forEach((c) => { c.share = cs > 0 ? ((c.mean || 0) / cs) * 100 : null; });

      // Por turno
      R.turnos = TURNOS.map((t) => ({ t, v: vals(rows.filter((r) => r.shift === t), 'total') })).filter((g) => g.v.length);
      const gobj = {}; R.turnos.forEach((g) => { gobj[g.t] = g.v; });
      R.cmpTurnos = R.turnos.length >= 2 ? S.compareGroups(gobj) : null;
      R.turnoInfo = R.turnos.map((g) => ({ turno: g.t, n: g.v.length, media: mean(g.v), mediana: med(g.v), sd: S.sd(g.v), aseos: mean(vals(rows.filter((r) => r.shift === g.t), 'aseos')) }));
      // Por día de la semana
      const dl = rows.map((r) => DOWN[dowIdx(r.t)]);
      const si = S.seasonalIndex(rows.map((r) => r.total), dl);
      R.dias = DOWN.map((d) => si.find((s) => s.label === d)).filter(Boolean);
      const dg = {}; DOWN.forEach((d) => { const v = rows.filter((r, i) => dl[i] === d).map((r) => r.total); if (v.length) dg[d] = v; });
      R.cmpDias = Object.keys(dg).length >= 3 ? S.compareGroups(dg) : null;

      // Eficiencia Hl agua / Hl procesado (razón de sumas)
      const er = (rs) => { const x = rs.filter((r) => r.hl != null); return x.length ? (sum(vals(x, 'total')) * 10) / sum(vals(x, 'hl')) : null; };
      R.eff = { actual: er(rows), previo: prev.length ? er(prev) : null, n: rows.filter((r) => r.hl != null).length,
        ser: R.perS.map((p) => ({ t: p.t, y: er(p.rows) })) };
      R.eff.spark = R.eff.ser.map((p) => p.y).filter((v) => v != null);
      R.eff.tendencia = An1.trend(R.eff.spark, { unit: 'Hl/Hl', dec: 3, porPeriodo: An1.periodoTxt(R.by) });

      // Agua por aseo (tabla de aseos: agua estimada del enjuague)
      const as = An1.sane('aseos', ctx.rows('aseos')).filter((r) => r.m3 != null);
      const meta = ctx.metas.get('agua.aseoM3', 10);
      R.aseo = { meta, n: as.length, media: mean(vals(as, 'm3')), mediana: med(vals(as, 'm3')), cumple: as.length ? (as.filter((r) => r.m3 <= meta).length / as.length) * 100 : null,
        prev: ctx.estado.comparar ? (() => { const p = An1.sane('aseos', ctx.previas('aseos')).filter((r) => r.m3 != null); return p.length ? (p.filter((r) => r.m3 <= meta).length / p.length) * 100 : null; })() : null };
      const cat = (r) => String(r.equipment || '').split(' ')[0] || '(sin equipo)';
      const cg = new Map(); as.forEach((r) => { const k = cat(r); if (!cg.has(k)) cg.set(k, []); cg.get(k).push(r); });
      R.aseo.grupos = [...cg.entries()].map(([k, rs]) => ({ k, n: rs.length, media: mean(vals(rs, 'm3')), mediana: med(vals(rs, 'm3')), cumple: (rs.filter((r) => r.m3 <= meta).length / rs.length) * 100, max: Math.max(...vals(rs, 'm3')) }))
        .filter((g) => g.n >= 5).sort((a, b) => b.n - a.n).slice(0, 8);
      R.aseo.porTurno = med(vals(rows, 'm3PerAseo'));

      // Turnos atípicos
      const mult = ctx.metas.get('agua.turnosAtipicos', 1.25), mediana = R.median;
      R.mult = mult;
      const mad = S.outliers(rows.map((r) => r.total), { method: 'iqr' });
      const stat = new Set(mad.idx);
      R.atip = rows.map((r, i) => ({ r, i })).filter((o) => mediana != null && o.r.total > mult * mediana)
        .map((o) => ({ ...o.r, exceso: o.r.total - mediana, estad: stat.has(o.i), justificado: !!(o.r.comment && o.r.comment.trim()) }))
        .sort((a, b) => b.exceso - a.exceso);
      R.atipSin = R.atip.filter((a) => !a.justificado).length;
      R.ahorro = sum(R.atip.map((a) => a.exceso));
      R.ahorroPct = R.m3 > 0 ? (R.ahorro / R.m3) * 100 : null;
      R.umbral = mediana != null ? mult * mediana : null;

      // Relación con producción, trasiego y aseos
      const pr = rows.filter((r) => r.hl != null);
      R.regHl = pr.length >= 8 ? S.linreg(pr.map((r) => r.hl), pr.map((r) => r.total)) : null;
      R.ptsHl = pr.map((r) => ({ x: r.hl, y: r.total, group: r.shift, label: `${fmtDate(r.t)} · ${r.shift}: ${fmt(r.total, 1)} m³ con ${fmt(r.hl, 0)} Hl` }));
      const pa = rows.filter((r) => r.aseos != null && r.aseos > 0);
      R.regAs = pa.length >= 8 ? S.linreg(pa.map((r) => r.aseos), pa.map((r) => r.total)) : null;
      R.ptsAs = pa.map((r) => ({ x: r.aseos, y: r.total, group: r.shift, label: `${fmtDate(r.t)} · ${r.shift}: ${fmt(r.total, 1)} m³ con ${fmt(r.aseos, 1)} aseos` }));

      // Calendario y pronóstico
      R.dias_cal = An1.porPeriodo(rows, 'day').map((d) => ({ date: iso(d.t), value: mean(vals(d.rows, 'total')) }));
      R.fc = pronostico(all, ctx.rango.to);
      R.fuente = An1.srcRange(rows);
      return R;
    });
  }
  An1.aguaR = aguaR;

  /* ---------- Gráfica panorámica para el Resumen ---------- */
  An1.mini = An1.mini || {};
  An1.mini.agua = (ctx) => {
    const R = aguaR(ctx);
    if (R.ser.length < 2) return null;
    const pts = R.ser.map((p) => ({ x: p.t, y: An1.round(p.y, 2) }));
    return C.line({ title: 'Consumo de agua por turno', subtitle: `m³ promedio por turno, por ${An1.periodoTxt(R.by)}`, unit: 'm³', xType: 'time', w: W.half, h: 260,
      series: [{ name: 'Consumo', points: pts }, { name: `Media móvil (${R.maW})`, points: R.ser.map((p, i) => ({ x: p.t, y: An1.round(R.ma[i], 2) })), dashed: true, color: 'var(--est,#5d6f8c)' }],
      refs: R.imr ? [{ y: R.imr.cl, label: 'Promedio', dashed: true }] : [] });
  };

  /* ---------- Render ---------- */
  function render(ctx, UI) {
    const R = aguaR(ctx);
    if (!R.n) return UI.card('Agua', '', UI.vacio('No hay lecturas de agua válidas en este periodo. Prueba con «Todo el histórico» o revisa la sección Agua.'));
    const out = [];
    const nota = ctx.filtraMarca ? `<p class="an-note"><b>Ojo</b> El agua se mide por turno y no por marca, así que el filtro de marca no cambia esta pestaña.</p>` : '';
    const cmp = An1.cmpTxt(R.mean, R.prevMean, { unit: 'm³/turno', dec: 1 });
    const sg = R.tt ? An1.sig(R.tt.p) : null;

    out.push(nota + An1.stats([
      An1.stat('Consumo total', fmt(R.m3, 0) + ' m³', `${fmt(R.n, 0)} turnos medidos`),
      An1.stat('Por turno (promedio)', fmt(R.mean, 1) + ' m³', R.prevMean != null ? `antes ${fmt(R.prevMean, 1)}` : ''),
      An1.stat('Por turno (mediana)', fmt(R.median, 1) + ' m³', `variación típica ±${fmt(R.sd, 1)}`),
      An1.stat('Agua por Hl procesado', R.eff.actual != null ? fmt(R.eff.actual, 3) + ' Hl/Hl' : '—', R.eff.previo != null ? `antes ${fmt(R.eff.previo, 3)}` : ''),
      An1.stat(`Turnos sobre ${fmt(R.mult, 2)} × mediana`, fmt(R.atip.length, 0), `${R.atipSin} sin justificación`, R.atipSin > 5 ? 'warn' : ''),
      An1.stat('Ahorro potencial', fmt(R.ahorro, 0) + ' m³', R.ahorroPct != null ? fmt(R.ahorroPct, 1) + ' % del consumo' : ''),
    ]));

    // 1. Tendencia
    const lectTend = `En el periodo cada turno consumió en promedio <b>${fmt(R.mean, 1)} m³</b> (mediana ${fmt(R.median, 1)}). ${cmp}${sg ? ` Frente al periodo anterior, ${sg.ok ? '<b>' + sg.frase + '</b>' : sg.frase} (prueba t de Welch).` : ''} ${R.tendencia.txt}` +
      (R.imr && R.imr.violations.length ? ` Hubo <b>${new Set(R.imr.violations.map((v) => v.i)).size} ${An1.periodoTxt(R.by)}(s) fuera de lo normal</b> (puntos que salen de la banda gris o se quedan seguidos de un solo lado).` : ' El consumo se mantuvo dentro de su variación normal.');
    const xs = R.ser.map((p) => p.t);
    const band = R.imr ? { lo: xs.map(() => Math.max(0, R.imr.lcl)), hi: xs.map(() => R.imr.ucl), name: 'Variación normal (±3σ)' } : null;
    out.push(An1.tarjeta(UI, 'Tendencia del consumo', `m³ promedio por turno, por ${An1.periodoTxt(R.by)}. La banda gris es lo que se considera variación normal del proceso (carta de control I-MR).`,
      C.line({ w: W.full, h: 320, unit: 'm³', xType: 'time', toolbar: true, id: 'ch-ag-tend', title: 'Consumo por turno', series: [{ name: 'Consumo', points: R.ser.map((p) => ({ x: p.t, y: An1.round(p.y, 2) })) }, { name: `Media móvil de ${R.maW}`, points: R.ser.map((p, i) => ({ x: p.t, y: An1.round(R.ma[i], 2) })), dashed: true, color: 'var(--est,#5d6f8c)' }],
        band: band || undefined, refs: R.imr ? [{ y: R.imr.cl, label: 'Promedio', dashed: true }] : [] }), lectTend, { id: 'agua-tend' }));

    // 2 y 3. Contadores + turnos
    const cats = R.cper.map((p) => p.label);
    const compBlock = (() => {
      const top = R.comp.slice().sort((a, b) => (b.mean || 0) - (a.mean || 0))[0];
      const cambios = R.comp.filter((c) => c.prev).map((c) => ({ ...c, d: rel(c.mean, c.prev) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      const l = `El mayor consumidor es <b>${esc(top.label)}</b> con ${fmt(top.share, 0)} % del agua medida (${fmt(top.mean, 1)} m³ por turno). ` + R.comp.map((c) => `${c.label}: ${fmt(c.share, 0)} %`).join(' · ') + '.' +
        (cambios.length ? ` El que más cambió frente al periodo anterior fue <b>${esc(cambios[0].label)}</b> (${cambios[0].d > 0 ? '+' : ''}${fmt(cambios[0].d, 0)} %).` : '');
      return An1.tarjeta(UI, 'Quién consume el agua', `m³ promedio por turno según el contador: pisos, CIP y CIP GEA, por ${An1.periodoTxt(R.cby)}.`,
        C.stacked({ w: W.half, h: 300, unit: 'm³', toolbar: true, id: 'ch-ag-cont', categories: cats, series: COMP.map(([k, label]) => ({ name: label, values: R.cper.map((p) => An1.round(mean(vals(p.rows, k)) || 0, 1)) })) }), l);
    })();
    const turnoBlock = (() => {
      if (!R.turnos.length) return UI.card('Consumo por turno', '', UI.vacio('Sin turnos identificados.'));
      const ord = R.turnoInfo.slice().sort((a, b) => b.media - a.media), hi = ord[0], lo = ord[ord.length - 1];
      let l = `El turno <b>${esc(hi.turno)}</b> gasta más (${fmt(hi.media, 1)} m³ en promedio) y el <b>${esc(lo.turno)}</b> menos (${fmt(lo.media, 1)} m³): ${fmt(rel(hi.media, lo.media), 0)} % de diferencia. `;
      if (R.cmpTurnos) { const d = An1.difGrupos(R.cmpTurnos); l += `Entre los ${R.turnos.length} turnos, ${d.ok ? '<b>' + d.frase + '</b>' : d.frase}.`; }
      return An1.tarjeta(UI, 'Consumo por turno', 'Cada caja muestra la mitad central de los turnos; la línea del medio es la mediana y los puntos sueltos son turnos raros.',
        C.box({ w: W.half, h: 300, unit: 'm³', toolbar: true, id: 'ch-ag-turno', groups: R.turnos.map((g) => ({ label: g.t, values: g.v })), refs: R.umbral ? [{ y: R.umbral, label: `Atípico > ${fmt(R.umbral, 0)}` }] : [] }), l);
    })();
    out.push(UI.grid([compBlock, turnoBlock], 2));

    // 4 y 5. Día de la semana + eficiencia
    const diaBlock = (() => {
      if (R.dias.length < 3) return UI.card('Consumo por día de la semana', '', UI.vacio('Se necesitan al menos 3 días distintos.'));
      const o = R.dias.slice().sort((a, b) => b.index - a.index), hi = o[0], lo = o[o.length - 1];
      const l = `El <b>${esc(hi.label)}</b> es el día de más consumo (${fmt(hi.index * 100, 0)} sobre 100 del promedio) y el <b>${esc(lo.label)}</b> el de menos (${fmt(lo.index * 100, 0)}). ` +
        (R.cmpDias ? (() => { const d = An1.difGrupos(R.cmpDias); return `Entre días, ${d.ok ? '<b>' + d.frase + '</b>' : d.frase}.`; })() : '');
      return An1.tarjeta(UI, 'Consumo por día de la semana', 'Índice estacional: 100 = el consumo promedio de un turno cualquiera.',
        C.bars({ w: W.half, h: 280, toolbar: true, id: 'ch-ag-dia', data: R.dias.map((d) => ({ label: d.label, value: An1.round(d.index * 100, 1), note: `${d.n} turnos · ${fmt(d.mean, 1)} m³` })), refs: [{ y: 100, label: 'Promedio' }] }), l);
    })();
    const effBlock = (() => {
      const pts = R.eff.ser.filter((p) => p.y != null);
      if (pts.length < 2) return UI.card('Eficiencia del agua', '', UI.vacio('Faltan datos de producción o trasiego para calcular Hl de agua por Hl procesado.'));
      const l = `Se gastaron <b>${fmt(R.eff.actual, 3)} Hl de agua por cada Hl</b> recibido o trasegado (${fmt(R.eff.n, 0)} turnos con producción registrada). ${An1.cmpTxt(R.eff.actual, R.eff.previo, { unit: 'Hl/Hl', dec: 3 })} ${R.eff.tendencia.txt}`;
      return An1.tarjeta(UI, 'Eficiencia: agua por Hl procesado', `Hl de agua (1 m³ = 10 Hl) por cada Hl de mosto o cerveza movido, por ${An1.periodoTxt(R.by)}. Menos es mejor.`,
        C.line({ w: W.half, h: 280, unit: 'Hl/Hl', xType: 'time', toolbar: true, id: 'ch-ag-ef', series: [{ name: 'Hl agua / Hl procesado', points: pts.map((p) => ({ x: p.t, y: An1.round(p.y, 3) })) }], refs: R.eff.actual != null ? [{ y: R.eff.actual, label: 'Promedio', dashed: true }] : [] }), l);
    })();
    out.push(UI.grid([diaBlock, effBlock], 2));

    // 6. Agua por aseo
    out.push((() => {
      const a = R.aseo;
      if (!a.n) return UI.card('Agua por aseo frente a la meta', '', UI.vacio('No hay aseos con caudal y minutos registrados en este periodo.'));
      const l = `Cada aseo gastó en promedio <b>${fmt(a.media, 1)} m³</b> de agua de enjuague (mediana ${fmt(a.mediana, 1)}) y <b>${fmt(a.cumple, 0)} %</b> de los ${fmt(a.n, 0)} aseos cumple la meta de menos de ${fmt(a.meta, 0)} m³.` +
        (a.prev != null ? ` Antes cumplía ${fmt(a.prev, 0)} %.` : '') + (a.grupos.length ? ` El grupo con más agua por aseo es <b>${esc(a.grupos.slice().sort((x, y) => y.media - x.media)[0].k)}</b>.` : '') +
        (a.porTurno != null ? ` Mirando el turno completo (todo el consumo ÷ aseos), la mediana es ${fmt(a.porTurno, 1)} m³ por aseo realizado, porque el turno incluye más usos que el enjuague.` : '');
      return An1.tarjeta(UI, 'Agua por aseo frente a la meta', 'Agua estimada del enjuague de cada aseo (caudal × minutos). La línea es la meta de la plataforma.',
        a.grupos.length ? C.barsH({ w: W.full, h: Math.max(220, a.grupos.length * 36 + 60), unit: 'm³', toolbar: true, id: 'ch-ag-aseo', data: a.grupos.map((g) => ({ label: `${g.k} (n=${g.n})`, value: An1.round(g.media, 2) })), refs: [{ y: a.meta, label: `Meta ${fmt(a.meta, 0)} m³` }] }) : '', l);
    })());

    // 7. Calendario de calor
    if (R.dias_cal.length > 3) {
      const weeks = Math.min(53, Math.max(8, Math.ceil(ctx.rango.dias / 7) + 1));
      out.push(An1.tarjeta(UI, 'Calendario de consumo', 'Cada cuadro es un día; más oscuro = más agua por turno. Los cuadros vacíos son días sin lectura.',
        `<div style="max-width:${Math.min(W.full, 70 + weeks * 26)}px">` + C.calendar({ w: Math.min(W.full, 70 + weeks * 26), days: R.dias_cal, weeks, unit: 'm³/turno', toolbar: true, id: 'ch-ag-cal' }) + '</div>',
        `Los días más oscuros son los de mayor gasto. El día con más consumo fue el <b>${fmtDate(R.dias_cal.slice().sort((a, b) => b.value - a.value)[0].date ? new Date(R.dias_cal.slice().sort((a, b) => b.value - a.value)[0].date + 'T12:00:00').getTime() : null)}</b> (${fmt(Math.max(...R.dias_cal.map((d) => d.value)), 1)} m³ por turno).`));
    }

    // 8. Turnos atípicos
    out.push((() => {
      const rows = R.atip.map((a) => ({ fecha: iso(a.t), t: a.t, turno: a.shift, total: An1.round(a.total, 1), exceso: An1.round(a.exceso, 1), aseos: a.aseos, estado: a.justificado ? 'Justificado' : 'Sin justificación', nota: a.comment || '', tipo: a.estad ? 'Muy atípico' : 'Sobre la meta', source: a.source }));
      const cuerpo = rows.length ? UI.tabla([
        An1.colFecha(), { k: 'turno', t: 'Turno' }, An1.colNum('total', 'Consumo (m³)', 1), An1.colNum('exceso', 'Exceso vs. mediana (m³)', 1), An1.colNum('aseos', 'Aseos', 1),
        An1.badgeCol('tipo', 'Tipo', { 'Muy atípico': 'bad' }), An1.badgeCol('estado', 'Justificación', { 'Sin justificación': 'warn', Justificado: 'ok' }), { k: 'nota', t: 'Comentario', f: (v) => (v ? `<span class="an-src">${esc(v)}</span>` : '') }, An1.colFuente(),
      ], rows, { id: 'tb-ag-atip', nombre: 'agua-turnos-atipicos', sort: { k: 'exceso', dir: -1 }, max: 12 }) : UI.vacio(`Ningún turno superó ${fmt(R.mult, 2)} × la mediana.`);
      const l = rows.length ? `Hay <b>${R.atip.length} turnos</b> (${fmt((R.atip.length / R.n) * 100, 0)} % de los medidos) por encima de ${fmt(R.mult, 2)} × la mediana (${fmt(R.umbral, 0)} m³); <b>${R.atipSin} no tienen comentario</b> que explique el gasto. ` +
        `Si todos hubieran consumido la mediana (${fmt(R.median, 1)} m³) se habrían ahorrado <b>${fmt(R.ahorro, 0)} m³</b>${R.ahorroPct != null ? ` (${fmt(R.ahorroPct, 1)} % del total)` : ''}. «Muy atípico» significa que además se sale del diagrama de cajas (criterio estadístico de Tukey), no solo de la regla de la meta; hay ${R.atip.filter((a) => a.estad).length}.` : '';
      return UI.card('Turnos con consumo atípico', `Turnos que superan ${fmt(R.mult, 2)} veces la mediana del periodo (meta editable en Configuración). Ordena por cualquier columna.`, cuerpo + (l ? UI.lectura(l, R.atipSin > 5 ? 'warn' : '') : ''));
    })());

    // 9. Relaciones
    out.push(UI.grid([
      relBlock(UI, 'Relación con lo procesado', 'Cada punto es un turno: Hl recibidos de cocina + Hl trasegados contra m³ gastados.', R.regHl, R.ptsHl, 'Hl procesados (producción + trasiego)', 'ch-ag-hl', 1000, 'cada 1.000 Hl'),
      relBlock(UI, 'Relación con el número de aseos', 'Cada punto es un turno: aseos realizados contra m³ gastados.', R.regAs, R.ptsAs, 'Aseos en el turno', 'ch-ag-as', 1, 'cada aseo adicional'),
    ], 2));

    // 10. Pronóstico
    out.push(pronosticoBlock(UI, R));

    // 11. Detalle
    const drows = R.per.map((p) => ({ fecha: iso(p.t), t: p.t, turnos: p.rows.length, m3: An1.round(sum(vals(p.rows, 'total')), 1), prom: An1.round(mean(vals(p.rows, 'total')), 2), pisos: An1.round(mean(vals(p.rows, 'pisos')), 1), cip: An1.round(mean(vals(p.rows, 'cip')), 1), gea: An1.round(mean(vals(p.rows, 'gea')), 1),
      ef: An1.round((() => { const x = p.rows.filter((r) => r.hl != null); return x.length ? (sum(vals(x, 'total')) * 10) / sum(vals(x, 'hl')) : null; })(), 3), source: An1.srcRange(p.rows) }));
    out.push(UI.card(`Detalle por ${An1.periodoTxt(R.by)}`, 'Todas las cifras del análisis, listas para descargar. El origen de cada fila está en la última columna.',
      UI.tabla([An1.colFecha('fecha', 'Desde'), An1.colNum('turnos', 'Turnos', 0), An1.colNum('m3', 'Total (m³)', 0), An1.colNum('prom', 'm³ por turno', 1), An1.colNum('pisos', 'Pisos (m³/turno)', 1), An1.colNum('cip', 'CIP (m³/turno)', 1), An1.colNum('gea', 'GEA (m³/turno)', 1), An1.colNum('ef', 'Hl agua/Hl', 3), An1.colFuente()],
        drows, { id: 'tb-ag-det', nombre: 'agua-detalle', sort: { k: 'fecha', dir: -1 }, max: 12 })));

    out.push(An1.metodo('Cómo se calculó esta pestaña', `<ul>
      <li><b>Datos:</b> turnos con consumo total entre 0,5 y 400 m³. Lecturas de contador imposibles (por reinicio o error de digitación) se descartan; el detalle está en «Calidad de datos».</li>
      <li><b>Tendencia:</b> promedio por periodo, media móvil y carta I-MR (límites a ±3σ, σ estimada con el rango móvil); reglas de Nelson para señales sostenidas. Prueba de Mann-Kendall para decidir si hay tendencia.</li>
      <li><b>Comparaciones:</b> turnos y días con Kruskal-Wallis como prueba principal y ANOVA de apoyo (alfa 0,05); contra el periodo anterior con t de Welch.</li>
      <li><b>Atípicos:</b> regla de la meta (&gt; ${fmt(R.mult, 2)} × mediana) y criterio de Tukey del diagrama de cajas (más de 1,5 veces el rango intercuartil por encima del tercer cuartil). Ahorro potencial = suma de (consumo − mediana) de los turnos atípicos.</li>
      <li><b>Pronóstico:</b> totales diarios (suma de turnos; si faltan turnos, promedio × 3). Se elige entre línea, Holt y promedio según el menor error en una prueba hacia atrás; el intervalo es aproximado al 95 %.</li></ul>`));
    return out.join('');
  }

  function relBlock(UI, titulo, sub, reg, pts, xLabel, id, unidad, txtUnidad) {
    if (!reg || pts.length < 8) return UI.card(titulo, sub, UI.vacio('No hay suficientes turnos con ambos datos.'));
    const fuerza = An1.fuerza(reg.r), s = An1.sig(reg.p);
    const l = `La relación es <b>${fuerza}</b> (r = ${fmt(reg.r, 2)}, R² = ${fmt(reg.r2, 2)}): ${fmt(reg.r2 * 100, 0)} % de las variaciones del consumo se explican por esta variable. ` +
      (reg.p != null && reg.p < 0.05 ? `Por ${txtUnidad} el consumo ${reg.b > 0 ? 'sube' : 'baja'} cerca de <b>${fmt(Math.abs(reg.b) * unidad, 2)} m³</b> (${s.txt}).` : `No se puede afirmar una relación: ${s.txt}.`);
    return An1.tarjeta(UI, titulo, sub, C.scatter({ w: W.half, h: 300, points: pts, xLabel, yLabel: 'm³ por turno', regression: true, r: reg.r, toolbar: true, id }), l);
  }

  function pronosticoBlock(UI, R) {
    const f = R.fc;
    if (!f) return UI.card('Pronóstico a fin de mes', '', UI.vacio('Se necesitan al menos 3 días con datos en el mes del periodo para proyectar.'));
    const mes = AN.fmtDate(new Date(f.y, f.m, 1).getTime()).split(' ')[1];
    const dif = f.prevTot ? rel(f.proy, f.prevTot) : null;
    let chart = '';
    const obs = f.diarios;
    if (f.fpts.length && obs.length) {
      const fut = f.fpts.map((p, i) => ({ x: new Date(f.y, f.m, f.lastDay + 1 + i).getTime(), ...p }));
      const last = obs[obs.length - 1];
      const xs = obs.map((o) => o.t).concat(fut.map((p) => p.x));
      chart = C.line({ w: W.full, h: 300, unit: 'm³/día', xType: 'time', toolbar: true, id: 'ch-ag-fc',
        series: [{ name: 'Consumo diario (días completos)', points: xs.map((x, i) => ({ x, y: i < obs.length ? An1.round(obs[i].y, 1) : null })) },
          { name: 'Pronóstico', dashed: true, color: 'var(--warn,#a26a14)', points: xs.map((x, i) => ({ x, y: i === obs.length - 1 ? An1.round(last.y, 1) : i >= obs.length ? An1.round(fut[i - obs.length].y, 1) : null })) }],
        band: { lo: xs.map((x, i) => (i >= obs.length ? An1.round(fut[i - obs.length].lo, 1) : null)), hi: xs.map((x, i) => (i >= obs.length ? An1.round(fut[i - obs.length].hi, 1) : null)), name: 'Rango probable (95 %)' } });
    }
    const l = f.completo ? `El mes de ${mes} ya cerró con aproximadamente <b>${fmt(f.mtd, 0)} m³</b>.` + (f.prevTot ? ` El mes anterior fue ${fmt(f.prevTot, 0)} m³ (${dif > 0 ? '+' : ''}${fmt(dif, 0)} %).` : '')
      : `Hasta el día ${f.lastDay} de ${mes} se llevan <b>${fmt(f.mtd, 0)} m³</b>. Si el ritmo sigue así, el mes cerraría en cerca de <b>${fmt(f.proy, 0)} m³</b>${f.lo != null ? ` (rango probable ${fmt(f.lo, 0)} a ${fmt(f.hi, 0)} m³)` : ''}.` +
        (f.prevTot ? ` Eso es ${dif > 0 ? 'un <b>' + fmt(dif, 0) + ' % más</b>' : 'un <b>' + fmt(Math.abs(dif), 0) + ' % menos</b>'} que el mes anterior (${fmt(f.prevTot, 0)} m³).` : '') + (f.metodo ? ` Método elegido: ${f.metodo === 'lineal' ? 'línea de tendencia' : f.metodo === 'holt' ? 'suavizado de Holt' : 'promedio reciente'}.` : '');
    return An1.tarjeta(UI, 'Pronóstico a fin de mes', 'Total diario de agua (m³ por día) de las últimas semanas y su proyección hasta el último día del mes.', chart, l, { tono: dif != null && dif > 10 ? 'warn' : '' });
  }

  /* ---------- Hallazgos ---------- */
  function hallazgos(ctx) {
    const R = aguaR(ctx), out = [];
    if (!R.n) return out;
    if (R.prevMean != null && R.tt) {
      const d = rel(R.mean, R.prevMean), s = An1.sig(R.tt.p);
      if (d > 7 && R.tt.p < 0.05) out.push({ sev: d > 15 ? 'alta' : 'media', tab: 'agua', titulo: `El consumo de agua subió ${fmt(d, 0)} %`, detalle: `${fmt(R.mean, 1)} m³ por turno frente a ${fmt(R.prevMean, 1)} del periodo anterior: ${s.txt}.`, valor: `${fmt(R.mean, 1)} m³/turno` });
      else if (d < -7 && R.tt.p < 0.05) out.push({ sev: 'ok', tab: 'agua', titulo: `El consumo de agua bajó ${fmt(Math.abs(d), 0)} %`, detalle: `${fmt(R.mean, 1)} m³ por turno frente a ${fmt(R.prevMean, 1)} antes: ${s.txt}.` });
    }
    if (R.atipSin >= 5) out.push({ sev: R.atipSin >= 15 ? 'alta' : 'media', tab: 'agua', titulo: `${R.atipSin} turnos gastaron mucha agua sin explicación`, detalle: `Superan ${fmt(R.mult, 2)} × la mediana (${fmt(R.umbral, 0)} m³) y no tienen comentario. Ahorro potencial: ${fmt(R.ahorro, 0)} m³ (${fmt(R.ahorroPct, 1)} %).`, valor: `${fmt(R.ahorro, 0)} m³` });
    if (R.imr) {
      const viol = R.imr.violations.filter((v) => v.i >= R.imr.n - 3);
      if (viol.length) out.push({ sev: 'media', tab: 'agua', titulo: 'Consumo de agua fuera de su variación normal en lo más reciente', detalle: viol[0].text.replace(/^Punto \d+/, 'Un periodo reciente') });
    }
    if (R.cmpTurnos && An1.difGrupos(R.cmpTurnos).ok && R.turnoInfo.length > 1) {
      const o = R.turnoInfo.slice().sort((a, b) => b.media - a.media);
      if (rel(o[0].media, o[o.length - 1].media) > 15) out.push({ sev: 'info', tab: 'agua', titulo: `El turno ${o[0].turno} gasta ${fmt(rel(o[0].media, o[o.length - 1].media), 0)} % más agua que el ${o[o.length - 1].turno}`, detalle: `Diferencia real, no azar (${An1.pTxt(An1.difGrupos(R.cmpTurnos).p)}). Vale la pena revisar rutinas de aseo y llenado de ese turno.` });
    }
    if (R.aseo.n >= 10 && R.aseo.cumple != null && R.aseo.cumple < 80) out.push({ sev: R.aseo.cumple < 60 ? 'alta' : 'media', tab: 'agua', titulo: `Solo ${fmt(R.aseo.cumple, 0)} % de los aseos cumple la meta de agua`, detalle: `La meta es menos de ${fmt(R.aseo.meta, 0)} m³ por aseo; el promedio fue ${fmt(R.aseo.media, 1)} m³.` });
    if (R.fc && !R.fc.completo && R.fc.prevTot) {
      const d = rel(R.fc.proy, R.fc.prevTot);
      if (d > 10) out.push({ sev: 'media', tab: 'agua', titulo: `El mes cerraría con ${fmt(d, 0)} % más agua que el anterior`, detalle: `Proyección ${fmt(R.fc.proy, 0)} m³ frente a ${fmt(R.fc.prevTot, 0)} m³ del mes pasado.`, valor: `${fmt(R.fc.proy, 0)} m³` });
    }
    if (R.eff.actual != null && R.eff.previo != null) {
      const d = rel(R.eff.actual, R.eff.previo);
      if (d > 15) out.push({ sev: 'media', tab: 'agua', titulo: `Se gasta ${fmt(d, 0)} % más agua por cada Hl procesado`, detalle: `${fmt(R.eff.actual, 3)} Hl/Hl frente a ${fmt(R.eff.previo, 3)} antes.` });
      else if (d < -15) out.push({ sev: 'ok', tab: 'agua', titulo: `Mejoró la eficiencia del agua en ${fmt(Math.abs(d), 0)} %`, detalle: `${fmt(R.eff.actual, 3)} Hl de agua por Hl procesado (antes ${fmt(R.eff.previo, 3)}).` });
    }
    return out;
  }

  AN.registrar({ id: 'agua', label: 'Agua', orden: 2, render, hallazgos });
})();
