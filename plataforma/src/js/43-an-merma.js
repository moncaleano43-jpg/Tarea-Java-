/* ============================================================
   43-an-merma.js · Análisis de merma (FV y SV): tasa ponderada, marcas, tanques, cascada, lotes críticos,
   carta de control, relaciones con volumen / levadura / tiempo de ciclo y ahorro potencial
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.An1 || !A.Analisis) return;
  const An1 = A.An1, S = A.Stats, C = A.Charts, AN = A.Analisis;
  const { fmt, fmtPct, fmtDate, esc, iso } = AN;
  const { vals, sum, mean, med, rel, W } = An1;
  const FASES = ['FV', 'SV'];
  const FASE_TXT = { FV: 'fermentación (FV)', SV: 'maduración (SV)' };
  const NEG_TOL = -1; // saldos negativos menores a 1 % del volumen se consideran ruido de medición
  const tasaDe = (rs) => { const i = sum(vals(rs, 'input')); return i > 0 ? (sum(vals(rs, 'loss')) / i) * 100 : null; };

  function grupos(rows, keyFn, minN) {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); if (k == null || k === '') continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m.entries()].map(([k, rs]) => ({ k: String(k), n: rs.length, rows: rs, input: sum(vals(rs, 'input')), loss: sum(vals(rs, 'loss')), tasa: tasaDe(rs), med: med(vals(rs, 'lossPct')), v: vals(rs, 'lossPct'), ci: An1.ci(vals(rs, 'lossPct')) }))
      .filter((g) => g.n >= minN);
  }

  function analizar(ctx, ph, rs, ps, fermMap) {
    const F = { ph, rows: rs, n: rs.length };
    if (!rs.length) return F;
    const pct = vals(rs, 'lossPct');
    F.input = sum(vals(rs, 'input')); F.loss = sum(vals(rs, 'loss'));
    F.tasa = tasaDe(rs); F.tasaPrev = ps.length ? tasaDe(ps) : null; F.mediana = med(pct); F.sd = S.sd(pct); F.ci = An1.ci(pct);
    F.tt = ps.length > 2 && pct.length > 2 ? S.ttest(pct, vals(ps, 'lossPct')) : null;
    F.purges = sum(vals(rs, 'purges')); F.sinExp = F.loss - F.purges; F.cobPurgas = F.loss > 0 ? (F.purges / F.loss) * 100 : null;
    // Serie en el tiempo (tasa ponderada por volumen)
    F.by = ctx.rango.dias > 200 ? 'month' : 'week';
    F.per = An1.recorta(An1.porPeriodo(rs, F.by), F.by);
    F.ser = F.per.map((p) => ({ t: p.t, label: p.label, y: tasaDe(p.rows), n: p.rows.length }));
    F.spark = F.ser.map((p) => p.y);
    F.tendencia = An1.trend(F.spark.filter((v) => v != null), { unit: 'pp', dec: 2, porPeriodo: An1.periodoTxt(F.by) });
    // Marcas y tanques
    F.marcas = grupos(rs, (r) => r.brand, 3).sort((a, b) => b.tasa - a.tasa);
    F.cmpMarcas = F.marcas.length >= 2 ? S.compareGroups(Object.fromEntries(F.marcas.map((g) => [g.k, g.v]))) : null;
    F.tanques = grupos(rs, (r) => r.tq, 3).sort((a, b) => b.tasa - a.tasa);
    F.cmpTanques = F.tanques.length >= 3 ? S.compareGroups(Object.fromEntries(F.tanques.map((g) => ['TQ ' + g.k, g.v]))) : null;
    const alpha = 0.05 / Math.max(1, F.tanques.length), lo5 = S.quantile(pct, 0.05), hi95 = S.quantile(pct, 0.95);
    F.tanques.forEach((g) => {
      const resto = An1.wins(vals(rs.filter((r) => String(r.tq) !== g.k), 'lossPct'));
      const t = g.v.length > 1 && resto.length > 1 ? S.ttest(g.v.map((x) => Math.min(Math.max(x, lo5), hi95)), resto) : null;
      g.p = t ? t.p : null; g.dif = t ? t.diff : null; g.real = !!(t && t.p < alpha); g.posible = !!(t && t.p < 0.05);
    });
    // Lotes críticos
    const alerta = ctx.metas.get('merma.alerta', 30);
    const mz = S.modZ(pct), zmap = new Map(); rs.forEach((r, i) => zmap.set(r, mz[i]));
    F.alerta = alerta;
    F.criticos = rs.map((r) => {
      const z = zmap.get(r), motivos = [];
      if (r.lossPct < NEG_TOL) motivos.push('Saldo negativo');
      if (r.lossPct > alerta) motivos.push(`Merma > ${alerta} %`);
      if (z != null && z > 3.5) motivos.push('Atípico (MAD)');
      return motivos.length ? { ...r, z, motivos } : null;
    }).filter(Boolean);
    F.neg = rs.filter((r) => r.lossPct < NEG_TOL).length; F.sobre = rs.filter((r) => r.lossPct > alerta).length;
    // Carta de control individual (últimos 100 lotes cerrados)
    const orden = rs.slice().sort((a, b) => a.t - b.t).slice(-100);
    F.chartRows = orden;
    F.imr = orden.length >= 8 ? S.imr(orden.map((r) => r.lossPct)) : null;
    // Ahorro potencial: llevar todos los lotes al mejor cuartil (percentil 25 de los lotes con merma ≥ 0)
    const nn = rs.filter((r) => r.lossPct >= 0);
    F.meta = nn.length >= 8 ? S.quantile(nn.map((r) => r.lossPct), 0.25) : null;
    F.ahorro = F.meta != null ? sum(nn.filter((r) => r.lossPct > F.meta).map((r) => r.loss - (r.input * F.meta) / 100)) : null;
    F.ahorroTanques = F.ahorro != null && med(vals(rs, 'input')) ? F.ahorro / med(vals(rs, 'input')) : null;
    // Cruce con fermentación (solo FV: el lote es el mismo F###)
    if (ph === 'FV') {
      const j = rs.map((r) => { const f = fermMap.get(String(r.lote)); return f ? { r, f, ciclo: (r.t - f.t) / An1.DAY } : null; }).filter(Boolean).filter((x) => x.ciclo > 0 && x.ciclo < 40);
      F.join = j;
      const cols = [['Volumen de entrada (Hl)', (x) => x.r.input], ['Tiempo en el tanque (días)', (x) => x.ciclo], ['Generación de levadura', (x) => x.f.gen], ['Viabilidad de la levadura (%)', (x) => x.f.viab], ['Consistencia de la levadura (%)', (x) => x.f.cons], ['Horas a 75 % de atenuación', (x) => x.f.h75], ['Extracto original (°P)', (x) => x.f.eo], ['Purgas (Hl)', (x) => x.r.purges]];
      F.corr = cols.map(([label, fn]) => { const xs = j.map(fn), ys = j.map((x) => x.r.lossPct); const sp = S.spearman(xs, ys); return { label, n: sp ? sp.n : 0, r: sp ? sp.r : null, p: sp ? sp.p : null }; }).filter((c) => c.n >= 10);
      F.ptsVol = rs.map((r) => ({ x: r.input, y: r.lossPct, group: r.brand, label: `${r.lote} · ${r.brand}: ${fmt(r.lossPct, 1)} % con ${fmt(r.input, 0)} Hl` }));
      F.ptsCiclo = j.map((x) => ({ x: x.ciclo, y: x.r.lossPct, group: x.r.brand, label: `${x.r.lote}: ${fmt(x.r.lossPct, 1)} % tras ${fmt(x.ciclo, 1)} días` }));
      F.regVol = rs.length >= 8 ? S.linreg(rs.map((r) => r.input), pct) : null;
      F.regCiclo = j.length >= 8 ? S.linreg(j.map((x) => x.ciclo), j.map((x) => x.r.lossPct)) : null;
    }
    return F;
  }

  function mermaR(ctx) {
    return An1.memo(ctx, 'mermaR', () => {
      const todo = An1.sane('merma', ctx.rows('merma')), prevAll = An1.sane('merma', ctx.previas('merma'));
      const ok = (r) => r.loss != null && r.input > 0 && r.lossPct != null;
      const fermMap = new Map(); An1.sane('ferm', ctx.todas('ferm')).forEach((f) => { if (f.lote) fermMap.set(String(f.lote), f); });
      const R = { n: 0, fase: {}, sinDato: todo.filter((r) => !ok(r)).length, total: todo.length };
      for (const ph of FASES) {
        const rs = todo.filter((r) => r.phase === ph && ok(r)), ps = prevAll.filter((r) => r.phase === ph && ok(r));
        R.fase[ph] = analizar(ctx, ph, rs, ps, fermMap);
        R.n += rs.length;
      }
      R.criticos = FASES.flatMap((ph) => R.fase[ph].criticos || []);
      R.lossTotal = sum(FASES.map((ph) => R.fase[ph].loss || 0));
      R.ahorro = sum(FASES.map((ph) => R.fase[ph].ahorro || 0));
      R.sinPurgas = todo.filter((r) => ok(r) && (r.purges == null || r.purges === 0)).length;
      R.fuente = An1.srcRange(todo);
      return R;
    });
  }
  An1.mermaR = mermaR;

  An1.mini = An1.mini || {};
  An1.mini.merma = (ctx) => {
    const R = mermaR(ctx), series = [];
    for (const ph of FASES) { const F = R.fase[ph]; if (F.ser && F.ser.filter((p) => p.y != null).length >= 2) series.push({ name: ph, points: F.ser.filter((p) => p.y != null).map((p) => ({ x: p.t, y: An1.round(p.y, 2) })), color: ph === 'SV' ? 'var(--est,#5d6f8c)' : undefined }); }
    if (!series.length) return null;
    return C.line({ title: 'Merma ponderada', subtitle: `% del volumen de entrada, por ${An1.periodoTxt(R.fase.FV.by || 'week')}`, unit: '%', xType: 'time', w: W.half, h: 260, series });
  };

  /* ---------- Render ---------- */
  function render(ctx, UI) {
    const R = mermaR(ctx);
    if (!R.n) return UI.card('Merma', '', UI.vacio('No hay lotes cerrados con volumen de entrada y merma en este periodo. Prueba con «Todo el histórico».'));
    const out = [];
    const FV = R.fase.FV, SV = R.fase.SV;
    out.push(An1.stats([
      An1.stat('Merma FV (ponderada)', FV.n ? fmt(FV.tasa, 2) + ' %' : '—', FV.n ? `${FV.n} lotes${FV.tasaPrev != null ? ' · antes ' + fmt(FV.tasaPrev, 2) + ' %' : ''}` : 'sin lotes'),
      An1.stat('Merma SV (ponderada)', SV.n ? fmt(SV.tasa, 2) + ' %' : '—', SV.n ? `${SV.n} lotes${SV.tasaPrev != null ? ' · antes ' + fmt(SV.tasaPrev, 2) + ' %' : ''}` : 'sin lotes'),
      An1.stat('Cerveza perdida', fmt(R.lossTotal, 0) + ' Hl', `de ${fmt(sum(FASES.map((p) => R.fase[p].input || 0)), 0)} Hl que entraron`),
      An1.stat('Lotes críticos', fmt(R.criticos.length, 0), `${FV.neg + SV.neg} con saldo negativo (< −1 %)`, R.criticos.length ? 'warn' : ''),
      An1.stat('Merma sin explicar', fmt(sum(FASES.map((p) => R.fase[p].sinExp || 0)), 0) + ' Hl', 'no justificada por purgas'),
      An1.stat('Ahorro potencial', fmt(R.ahorro, 0) + ' Hl', 'si todo fuera como el mejor cuartil'),
    ]));

    // 1. Tendencia
    out.push((() => {
      const series = FASES.filter((ph) => R.fase[ph].ser && R.fase[ph].ser.filter((p) => p.y != null).length >= 2).map((ph) => ({ name: ph, color: ph === 'SV' ? 'var(--est,#5d6f8c)' : undefined, points: R.fase[ph].ser.filter((p) => p.y != null).map((p) => ({ x: p.t, y: An1.round(p.y, 2) })) }));
      if (!series.length) return UI.card('Tendencia de la merma', '', UI.vacio('Se necesitan al menos 2 periodos con lotes cerrados.'));
      const refs = []; const fvMax = ctx.metas.get('merma.fvMax', null), svMax = ctx.metas.get('merma.svMax', null);
      if (fvMax != null) refs.push({ y: fvMax, label: `Meta FV ${fmt(fvMax, 1)} %`, color: 'var(--ink)' }); if (svMax != null) refs.push({ y: svMax, label: `Meta SV ${fmt(svMax, 1)} %`, color: 'var(--est)' });
      let l = '';
      for (const ph of FASES) {
        const F = R.fase[ph]; if (!F.n) continue;
        l += `<b>${ph}:</b> ${fmt(F.tasa, 2)} % (IC 95 % de la merma típica por lote: ${F.ci ? fmt(F.ci[0], 2) + ' a ' + fmt(F.ci[1], 2) : '—'} %). ${An1.cmpTxt(F.tasa, F.tasaPrev, { unit: '%', dec: 2, pp: true })} ${F.tt ? 'Frente al periodo anterior, ' + (F.tt.p < 0.05 ? '<b>' + An1.sig(F.tt.p).frase + '</b>' : An1.sig(F.tt.p).frase) + '.' : ''} ${F.tendencia.txt}<br>`;
      }
      return An1.tarjeta(UI, 'Tendencia de la merma', `Merma ponderada por volumen (litros perdidos ÷ litros que entraron), por ${An1.periodoTxt(R.fase.FV.by)} de cierre de lote.`,
        C.line({ w: W.full, h: 300, unit: '%', xType: 'time', toolbar: true, id: 'ch-me-tend', series, refs }), l);
    })());

    // 2. Cascada por fase
    out.push(UI.grid(FASES.map((ph) => {
      const F = R.fase[ph];
      if (!F.n) return UI.card(`Cascada ${ph}`, '', UI.vacio(`Sin lotes ${ph} en el periodo.`));
      const l = `En ${FASE_TXT[ph]} entraron <b>${fmt(F.input, 0)} Hl</b> y se perdieron <b>${fmt(F.loss, 0)} Hl</b> (${fmt(F.tasa, 2)} %). Las purgas registradas explican ${fmt(F.purges, 0)} Hl (${fmt(F.cobPurgas, 0)} %); quedan <b>${fmt(F.sinExp, 0)} Hl sin explicar</b>` +
        (F.sinExp < 0 ? ' (negativo: las purgas registradas superan la merma, señal de datos mal capturados)' : '') + '.';
      return An1.tarjeta(UI, `De dónde sale la merma ${ph}`, 'Merma total, parte justificada por purgas y parte sin explicar (Hl).',
        C.waterfall({ w: W.half, h: 280, unit: 'Hl', toolbar: true, id: 'ch-me-wf-' + ph, steps: [{ label: 'Merma total', value: An1.round(F.loss, 0), total: true }, { label: 'Purgas registradas', value: -An1.round(F.purges, 0) }, { label: 'Sin explicar', total: true }] }), l, { tono: F.sinExp > 0.5 * F.loss ? 'warn' : '' });
    }), 2));

    // 3. Marcas
    out.push(UI.grid(FASES.map((ph) => {
      const F = R.fase[ph];
      if (F.marcas.length < 1) return UI.card(`Merma ${ph} por marca`, '', UI.vacio('Pocos lotes por marca (se necesitan al menos 3).'));
      const hi = F.marcas[0], lo = F.marcas[F.marcas.length - 1], d = An1.difGrupos(F.cmpMarcas);
      const stats = F.marcas.map((g) => An1.boxData(`${g.k} (${g.n})`, g.v, -10, 15)).filter(Boolean), ocultos = sum(stats.map((x) => x.ocultos));
      const l = `En ${ph} la marca con más merma es <b>${esc(hi.k)}</b> (${fmt(hi.tasa, 2)} %) y la de menos <b>${esc(lo.k)}</b> (${fmt(lo.tasa, 2)} %). ` + (d ? `Entre marcas, ${d.ok ? '<b>' + d.frase + '</b>' : d.frase}. ` : '') + (ocultos ? `${ocultos} lotes extremos (fuera de −10 a 15 %) no se dibujan para poder leer las cajas; están en la lista de lotes críticos.` : '');
      return An1.tarjeta(UI, `Merma ${ph} por marca`, 'Cada caja resume la merma de los lotes de la marca (la línea es la mediana). El detalle numérico está en la tabla de abajo.',
        C.box({ w: W.half, h: 280, unit: '%', toolbar: true, id: 'ch-me-box-' + ph, stats, refs: [{ y: F.tasa, label: 'Promedio' }] }), l);
    }), 2));
    out.push(UI.card('Merma por marca y fase', 'Tasa ponderada por volumen, mediana por lote e intervalo de confianza del 95 % de la merma típica por lote.',
      UI.tabla([{ k: 'fase', t: 'Fase' }, { k: 'marca', t: 'Marca' }, An1.colNum('n', 'Lotes', 0), An1.colNum('entrada', 'Entrada (Hl)', 0), An1.colNum('merma', 'Merma (Hl)', 0), An1.colNum('tasa', 'Ponderada (%)', 2), An1.colNum('mediana', 'Mediana (%)', 2), { k: 'ic', t: 'IC 95 % (%)' }, An1.colFuente()],
        FASES.flatMap((ph) => R.fase[ph].marcas.map((g) => ({ fase: ph, marca: g.k, n: g.n, entrada: An1.round(g.input, 0), merma: An1.round(g.loss, 0), tasa: An1.round(g.tasa, 2), mediana: An1.round(g.med, 2), ic: g.ci ? `${fmt(g.ci[0], 2)} a ${fmt(g.ci[1], 2)}` : '—', source: An1.srcRange(g.rows) }))),
        { id: 'tb-me-m', nombre: 'merma-por-marca', sort: { k: 'tasa', dir: -1 } })));

    // 4. Tanques
    out.push(UI.grid(FASES.map((ph) => {
      const F = R.fase[ph];
      if (F.tanques.length < 3) return UI.card(`Merma ${ph} por tanque`, '', UI.vacio('Pocos lotes por tanque.'));
      const top = F.tanques.slice(0, 12), reales = F.tanques.filter((g) => g.real && g.dif > 0), posibles = F.tanques.filter((g) => !g.real && g.posible && g.dif > 0);
      let l = `Hay ${F.tanques.length} tanques con 3 o más lotes. El peor es el <b>${ph === 'FV' ? 'FV ' : 'SV '}${esc(F.tanques[0].k)}</b> con ${fmt(F.tanques[0].tasa, 2)} %. `;
      const dt = An1.difGrupos(F.cmpTanques); l += dt ? `Entre todos los tanques, ${dt.ok ? '<b>' + dt.frase + '</b>' : dt.frase}. ` : '';
      l += reales.length ? `Con evidencia fuerte (ajustada por comparar muchos tanques a la vez) pierden más que el resto: <b>${reales.map((g) => g.k).join(', ')}</b>.` : posibles.length ? `Posibles tanques con más pérdida (evidencia moderada): ${posibles.map((g) => g.k).join(', ')}.` : 'Ningún tanque se separa claramente del resto.';
      return An1.tarjeta(UI, `Merma ${ph} por tanque`, 'Merma ponderada de los 12 tanques con más pérdida (mínimo 3 lotes). Un * marca diferencia real frente al resto.',
        C.barsH({ w: W.half, h: Math.max(240, top.length * 28 + 50), unit: '%', toolbar: true, id: 'ch-me-tq-' + ph, data: top.map((g) => ({ label: `${g.real ? '* ' : ''}TQ ${g.k} (n=${g.n})`, value: An1.round(g.tasa, 2) })), refs: [{ y: F.tasa, label: 'Promedio' }] }), l);
    }), 2));

    // 5. Carta de control
    out.push(UI.grid(FASES.map((ph) => {
      const F = R.fase[ph];
      if (!F.imr) return UI.card(`Carta de control ${ph}`, '', UI.vacio('Se necesitan al menos 8 lotes.'));
      const im = F.imr, viol = im.violations, sg = (im.ucl - im.cl) / 3, lo = im.cl - 8 * sg, hi = im.cl + 8 * sg;
      const lot = (i) => F.chartRows[i];
      const txt = (v) => { const r = lot(v.i); const base = `Lote ${r.lote} (${fmtDate(r.t)})`; return v.rule === 1 ? `${base}: ${fmt(r.lossPct, 2)} % fuera de los límites normales.` : v.rule === 2 ? `${base}: 2 de 3 lotes seguidos muy lejos del promedio.` : v.rule === 3 ? `${base}: 4 de 5 lotes seguidos algo alejados del promedio, del mismo lado.` : `${base}: 8 lotes seguidos del mismo lado del promedio (el nivel cambió).`; };
      const extremos = F.chartRows.filter((r) => r.lossPct < lo || r.lossPct > hi).length;
      const l = `Se ven los últimos ${F.chartRows.length} lotes ${ph} en orden de cierre. La merma típica es <b>${fmt(im.cl, 2)} %</b> y lo normal va de ${fmt(im.lcl, 2)} a ${fmt(im.ucl, 2)} %. ` +
        (viol.length ? `<b>${new Set(viol.map((v) => v.i)).size} lotes</b> se salen de lo normal o forman rachas sospechosas; el último fue el lote ${esc(lot(viol[viol.length - 1].i).lote)} (${fmtDate(lot(viol[viol.length - 1].i).t)}).` : 'Todos los lotes están dentro de lo normal.') + (extremos ? ` ${extremos} lote${extremos === 1 ? '' : 's'} extremo${extremos === 1 ? '' : 's'} se dibuja${extremos === 1 ? '' : 'n'} en el borde del gráfico.` : '');
      return An1.tarjeta(UI, `Carta de control ${ph}`, 'Merma de cada lote (%). Los puntos rojos salieron del rango normal (carta I-MR, ±3σ).',
        C.control({ w: W.half, h: 300, unit: '%', toolbar: true, id: 'ch-me-ctl-' + ph, name: 'Merma %', points: im.points.map((p, k) => ({ i: p.i + 1, y: An1.round(Math.min(hi, Math.max(lo, p.y)), 2), out: p.out, label: `${lot(k).lote} · ${fmtDate(lot(k).t)}: ${fmt(p.y, 2)} %` })), cl: im.cl, ucl: im.ucl, lcl: im.lcl, violations: viol.slice(-4).map((v) => ({ i: v.i + 1, text: txt(v) })) }), l);
    }), 2));

    // 6. Relaciones (FV)
    out.push((() => {
      if (FV.n < 8) return UI.card('Qué se relaciona con la merma en FV', '', UI.vacio('Se necesitan al menos 8 lotes FV.'));
      const corr = FV.corr || [];
      const tbl = corr.length ? UI.tabla([{ k: 'factor', t: 'Factor' }, An1.colNum('n', 'Lotes', 0), An1.colNum('r', 'Correlación (Spearman)', 2), { k: 'fuerza', t: 'Fuerza' }, { k: 'veredicto', t: '¿Es real?', f: (v) => `<span class="an-badge ${v.startsWith('Real') ? 'warn' : ''}">${esc(v)}</span>` }],
        corr.map((c) => ({ factor: c.label, n: c.n, r: An1.round(c.r, 2), fuerza: An1.fuerza(c.r), veredicto: c.p != null && c.p < 0.05 ? `Real (${An1.pTxt(c.p)})` : `Puede ser casualidad (${An1.pTxt(c.p)})` })), { id: 'tb-me-corr', nombre: 'merma-correlaciones', sort: { k: 'r', dir: -1 } }) : '';
      const reales = corr.filter((c) => c.p != null && c.p < 0.05).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
      const l = `Se cruzó la merma de ${fmt(FV.join ? FV.join.length : 0, 0)} lotes FV con los datos de su fermentación. ` + (reales.length ? `Lo que sí se relaciona de forma real con la merma: ${reales.slice(0, 3).map((c) => `<b>${esc(c.label.toLowerCase())}</b> (r = ${fmt(c.r, 2)}, ${An1.fuerza(c.r)}, ${c.r > 0 ? 'a más, más merma' : 'a más, menos merma'})`).join('; ')}.` : 'Ningún factor muestra relación clara con la merma: lo que se ve puede ser casualidad.') + ' Correlación no es causa: úsalo como pista para investigar.';
      const sc = (pts, reg, xl, id) => (pts && pts.length >= 8 ? C.scatter({ w: W.half, h: 280, points: pts, xLabel: xl, yLabel: 'Merma %', regression: true, r: reg ? reg.r : undefined, toolbar: true, id }) : UI.vacio('Sin suficientes puntos.'));
      return UI.card('Qué se relaciona con la merma en FV', 'Cruce de cada lote FV con su fermentación (volumen, tiempo en tanque, levadura y rapidez).',
        `<div class="an-grid an-g2">${sc(FV.ptsVol, FV.regVol, 'Volumen de entrada (Hl)', 'ch-me-vol')}${sc(FV.ptsCiclo, FV.regCiclo, 'Días en el tanque', 'ch-me-ciclo')}</div>${tbl}${UI.lectura(l)}`);
    })());

    // 7. Lotes críticos
    out.push((() => {
      const rows = R.criticos.map((c) => ({ fecha: iso(c.t), t: c.t, fase: c.phase, lote: c.lote, tq: c.tq, marca: c.brand, entrada: An1.round(c.input, 0), merma: An1.round(c.loss, 0), pct: An1.round(c.lossPct, 2), purgas: c.purges, motivo: c.motivos.join(' · '), z: An1.round(c.z, 1), source: c.source }));
      const cuerpo = rows.length ? UI.tabla([An1.colFecha('fecha', 'Cierre'), { k: 'fase', t: 'Fase' }, { k: 'lote', t: 'Lote' }, { k: 'tq', t: 'Tanque' }, { k: 'marca', t: 'Marca' }, An1.colNum('entrada', 'Entrada (Hl)', 0), An1.colNum('merma', 'Merma (Hl)', 0), An1.colNum('pct', 'Merma (%)', 2), An1.colNum('purgas', 'Purgas (Hl)', 0),
        { k: 'motivo', t: 'Motivo', f: (v) => v.split(' · ').map((m) => `<span class="an-badge ${m.startsWith('Saldo') ? 'warn' : 'bad'}">${esc(m)}</span>`).join(' ') }, An1.colFuente()], rows, { id: 'tb-me-crit', nombre: 'merma-lotes-criticos', sort: { k: 'pct', dir: -1 }, max: 12 }) : UI.vacio('Ningún lote crítico en este periodo.');
      const l = rows.length ? `Hay <b>${rows.length} lotes críticos</b>: ${FV.neg + SV.neg} con saldo negativo de más de 1 % (salió más cerveza de la que entró: casi siempre un error de medición o captura), ${FV.sobre + SV.sobre} con merma mayor a ${fmt(FV.alerta || SV.alerta, 0)} % y el resto atípicos por criterio estadístico robusto (MAD, |z| &gt; 3,5). Corregir sus volúmenes en la sección Merma mejora la confianza de todo el análisis.` : '';
      return UI.card('Lotes críticos', 'Lotes con saldo negativo, merma por encima de la alerta o muy lejos de lo normal. Ordena o descarga la lista.', cuerpo + (l ? UI.lectura(l, rows.length > 10 ? 'warn' : '') : ''));
    })());

    // 8. Ahorro y cobertura
    out.push(UI.grid([
      (() => {
        const items = FASES.filter((ph) => R.fase[ph].meta != null).map((ph) => { const F = R.fase[ph]; return `<b>${ph}</b>: el mejor cuartil de lotes pierde ${fmt(F.meta, 2)} % o menos. Si todos los lotes por encima de eso hubieran llegado a ese nivel, se habrían ahorrado <b>${fmt(F.ahorro, 0)} Hl</b> (unos ${fmt(F.ahorroTanques, 1)} tanques llenos).`; });
        return UI.card('Cuánto se habría ahorrado', 'Escenario: llevar todos los lotes al nivel del mejor cuartil (percentil 25 entre lotes con merma ≥ 0).', items.length ? `<p class="an-prosa">${items.join('<br><br>')}</p>${UI.lectura('Es un techo teórico: no todos los lotes pueden ser tan buenos, pero muestra el tamaño de la oportunidad.')}` : UI.vacio('Se necesitan al menos 8 lotes con merma ≥ 0.'));
      })(),
      (() => {
        const tot = R.total, pc = (n) => (tot ? (n / tot) * 100 : 0);
        const l = `De ${fmt(tot, 0)} lotes cerrados en el periodo, ${fmt(R.sinDato, 0)} (${fmt(pc(R.sinDato), 0)} %) no se pudieron usar por faltar volumen o porcentaje de merma, y ${fmt(R.sinPurgas, 0)} no tienen purgas registradas. ` + (pc(R.sinDato) > 10 ? 'Conviene completar esos datos para que la merma sea confiable.' : 'La cobertura es buena.');
        return UI.card('Calidad de los datos de merma', 'Qué tan completos están los lotes que alimentan este análisis.', An1.stats([An1.stat('Lotes usados', fmt(R.n, 0), `de ${fmt(tot, 0)}`), An1.stat('Sin volumen o merma', fmt(R.sinDato, 0), fmt(pc(R.sinDato), 0) + ' %', R.sinDato ? 'warn' : ''), An1.stat('Sin purgas', fmt(R.sinPurgas, 0), fmt(pc(R.sinPurgas), 0) + ' %')]) + UI.lectura(l));
      })(),
    ], 2));

    // 9. Detalle
    const drows = FASES.flatMap((ph) => R.fase[ph].per.map((p) => ({ fecha: iso(p.t), t: p.t, fase: ph, lotes: p.rows.length, entrada: An1.round(sum(vals(p.rows, 'input')), 0), merma: An1.round(sum(vals(p.rows, 'loss')), 0), tasa: An1.round(tasaDe(p.rows), 2), purgas: An1.round(sum(vals(p.rows, 'purges')), 0), source: An1.srcRange(p.rows) })));
    out.push(UI.card(`Detalle por ${An1.periodoTxt(R.fase.FV.by || 'week')}`, 'Merma por periodo y fase con la fuente de cada fila.', UI.tabla([An1.colFecha('fecha', 'Desde'), { k: 'fase', t: 'Fase' }, An1.colNum('lotes', 'Lotes', 0), An1.colNum('entrada', 'Entrada (Hl)', 0), An1.colNum('merma', 'Merma (Hl)', 0), An1.colNum('tasa', 'Merma ponderada (%)', 2), An1.colNum('purgas', 'Purgas (Hl)', 0), An1.colFuente()], drows, { id: 'tb-me-det', nombre: 'merma-detalle', sort: { k: 'fecha', dir: -1 }, max: 12 })));

    out.push(An1.metodo('Cómo se calculó esta pestaña', `<ul>
      <li><b>Merma ponderada:</b> suma de Hl perdidos ÷ suma de Hl de entrada, así un lote grande pesa más que uno chico. Se usan lotes cerrados (vacíos) con volumen de entrada entre 500 y 8.000 Hl y merma entre −50 % y 60 %.</li>
      <li><b>Intervalo de confianza:</b> 95 % para la merma promedio por lote (distribución t de Student).</li>
      <li><b>Diferencias entre marcas y tanques:</b> Kruskal-Wallis como prueba principal (no se deja llevar por lotes extremos) y ANOVA de apoyo (alfa 0,05). Cada tanque contra el resto con t de Welch y corrección de Bonferroni (alfa 0,05 ÷ número de tanques) para el asterisco (*). Los valores de cada tanque se acotan a los percentiles 5 y 95 de la fase para que un lote extremo no decida solo.</li>
      <li><b>Tendencia:</b> prueba de Mann-Kendall sobre la tasa por periodo y pendiente de Sen. Se omite el último periodo si está incompleto.</li>
      <li><b>Lotes críticos:</b> saldo negativo menor a −1 % (los menores se toman como ruido de medición), merma sobre la alerta (${fmt(ctx.metas.get('merma.alerta', 30), 0)} %) o z modificado por MAD mayor a 3,5.</li>
      <li><b>Carta de control:</b> I-MR sobre los últimos 100 lotes, límites a ±3σ y reglas de Nelson.</li>
      <li><b>Relaciones:</b> correlación de Spearman (no exige línea recta) entre la merma de cada lote FV y los datos de su fermentación (mismo número de lote).</li>
      <li><b>Ahorro potencial:</b> Σ (merma real − entrada × percentil 25) de los lotes por encima de ese percentil.</li></ul>`));
    return out.join('');
  }

  /* ---------- Hallazgos ---------- */
  function hallazgos(ctx) {
    const R = mermaR(ctx), out = [];
    if (!R.n) return out;
    for (const ph of FASES) {
      const F = R.fase[ph]; if (!F.n) continue;
      if (F.tasaPrev != null && F.tt) {
        const d = F.tasa - F.tasaPrev;
        if (d > 0.3 && F.tt.p < 0.05) out.push({ sev: d > 1 ? 'alta' : 'media', tab: 'merma', titulo: `La merma ${ph} subió ${fmt(d, 2)} puntos`, detalle: `${fmt(F.tasa, 2)} % frente a ${fmt(F.tasaPrev, 2)} % del periodo anterior: ${An1.sig(F.tt.p).txt}.`, valor: fmt(F.tasa, 2) + ' %' });
        else if (d < -0.3 && F.tt.p < 0.05) out.push({ sev: 'ok', tab: 'merma', titulo: `La merma ${ph} bajó ${fmt(Math.abs(d), 2)} puntos`, detalle: `${fmt(F.tasa, 2)} % frente a ${fmt(F.tasaPrev, 2)} % antes: ${An1.sig(F.tt.p).txt}.` });
      }
      if (F.tendencia && F.tendencia.dir > 0) out.push({ sev: 'media', tab: 'merma', titulo: `Tendencia al alza de la merma ${ph}`, detalle: F.tendencia.txt });
      const mal = F.tanques.filter((g) => g.real && g.dif > 0);
      if (mal.length) out.push({ sev: 'media', tab: 'merma', titulo: `${ph} ${mal[0].k} pierde más que el resto de tanques`, detalle: `${fmt(mal[0].tasa, 2)} % frente a ${fmt(F.tasa, 2)} % general, con ${mal[0].n} lotes (diferencia real, no azar; ${An1.pTxt(mal[0].p)}).`, valor: fmt(mal[0].tasa, 2) + ' %' });
      if (F.sobre) out.push({ sev: 'alta', tab: 'merma', titulo: `${F.sobre} lote${F.sobre === 1 ? '' : 's'} ${ph} con merma mayor a ${fmt(F.alerta, 0)} %`, detalle: 'Revisa el balance de volúmenes de esos lotes en la sección Merma.' });
      const dm = An1.difGrupos(F.cmpMarcas); if (dm && dm.ok && F.marcas.length > 1) out.push({ sev: 'info', tab: 'merma', titulo: `La merma ${ph} cambia según la marca`, detalle: `${F.marcas[0].k} (${fmt(F.marcas[0].tasa, 2)} %) vs ${F.marcas[F.marcas.length - 1].k} (${fmt(F.marcas[F.marcas.length - 1].tasa, 2)} %): ${dm.txt}.` });
    }
    const neg = R.fase.FV.neg + R.fase.SV.neg;
    if (neg >= 8) out.push({ sev: 'media', tab: 'calidad', titulo: `${neg} lotes con saldo negativo de merma (más de 1 %)`, detalle: 'Salió más cerveza de la que entró: son errores de captura que distorsionan la merma real.', valor: String(neg) });
    if (R.ahorro > 0) out.push({ sev: 'info', tab: 'merma', titulo: `Oportunidad: ${fmt(R.ahorro, 0)} Hl de merma evitable`, detalle: 'Es lo que se habría ahorrado llevando todos los lotes al nivel del mejor cuartil.', valor: fmt(R.ahorro, 0) + ' Hl' });
    return out;
  }

  AN.registrar({ id: 'merma', label: 'Merma', orden: 3, render, hallazgos });
})();
