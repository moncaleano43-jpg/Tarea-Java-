/* ============================================================
   44-an-fermentacion.js · Pestañas «Fermentación» y «Levadura»
   Fermentación: curvas típicas por marca, tiempos, capacidad de proceso (Cp/Cpk), EWMA/CUSUM, puntos de cambio,
   ranking de tanques y fermentaciones atípicas. Levadura: efecto de la generación, supervivencia, banco, cosechas fuera de límites.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.An1 || !A.Analisis) return;
  const An1 = A.An1, S = A.Stats, C = A.Charts, AN = A.Analisis;
  const { fmt, fmtDate, esc, iso } = AN;
  const { vals, sum, mean, med, rel, W } = An1;
  const specDe = (b) => { try { return (A.Hist2 && A.Hist2.spec && A.Hist2.spec(b)) || null; } catch (e) { return null; } };
  const VARS = [
    { k: 'eo', label: 'Extracto original (°P)', spec: 'eo', dec: 2 },
    { k: 'h15', label: 'Horas hasta 15 % de atenuación', spec: 't15', dec: 1 },
    { k: 'h75', label: 'Horas hasta 75 % de atenuación', spec: 'rata', dec: 1 },
    { k: 'rdf', label: 'Extracto final (°P)', spec: 'elim', dec: 2 },
  ];

  /* ---------- Base común: filas con valores relativos a la mediana de su marca ---------- */
  function baseMed(all) {
    const m = {};
    for (const b of new Set(all.map((r) => r.brand))) {
      const rs = all.filter((r) => r.brand === b);
      m[b] = {}; for (const v of VARS.concat([{ k: 'rata' }, { k: 'atten' }])) m[b][v.k] = med(vals(rs, v.k));
    }
    return m;
  }
  const enriquecer = (rows, bm) => rows.map((r) => { const o = Object.assign({}, r); for (const k of ['eo', 'h15', 'h75', 'rdf', 'rata', 'atten']) o[k + 'R'] = r[k] != null && bm[r.brand] && bm[r.brand][k] != null ? r[k] - bm[r.brand][k] : null; return o; });

  function curvas(ctx, rows, marcas) {
    let hist = []; try { hist = (A.Hist2 && A.Hist2.hist && A.Hist2.hist()) || []; } catch (e) { hist = []; }
    const byId = new Map(hist.map((h) => [h.id, h]));
    const out = [];
    for (const b of marcas) {
      let banda = null; try { banda = A.Hist2.banda(b); } catch (e) { banda = null; }
      if (!banda || !banda.ok) continue;
      const rec = rows.filter((r) => r.brand === b).slice(-5).map((r) => ({ r, h: byId.get(r.id) })).filter((x) => x.h && x.h.pts && x.h.pts.length >= 3);
      out.push({ marca: b, banda, rec });
    }
    return out;
  }
  const interp = (g, h, key) => {
    if (!g.length || h < g[0].h || h > g[g.length - 1].h) return null;
    for (let i = 1; i < g.length; i++) if (g[i].h >= h) { const k = (h - g[i - 1].h) / (g[i].h - g[i - 1].h || 1); return g[i - 1][key] + k * (g[i][key] - g[i - 1][key]); }
    return null;
  };

  /* ---------- Fermentación ---------- */
  function fermR(ctx) {
    return An1.memo(ctx, 'fermR', () => {
      const todo = An1.sane('ferm', ctx.todas('ferm')), bm = baseMed(todo);
      const rows = enriquecer(An1.sane('ferm', ctx.rows('ferm')), bm), prev = enriquecer(An1.sane('ferm', ctx.previas('ferm')), bm);
      const R = { rows, prev, n: rows.length, nPrev: prev.length, bm };
      R.by = ctx.rango.dias > 200 ? 'month' : ctx.rango.dias > 45 ? 'week' : 'week';
      R.per = An1.recorta(An1.porPeriodo(rows, R.by), R.by);
      const h = vals(rows, 'h75'), hp = vals(prev, 'h75');
      R.h75 = { n: h.length, med: med(h), medPrev: hp.length ? med(hp) : null, spark: R.per.map((p) => med(vals(p.rows, 'h75'))).filter((v) => v != null) };
      const r75 = vals(rows, 'h75R'), r75p = vals(prev, 'h75R');
      R.h75.tt = r75.length > 2 && r75p.length > 2 ? S.ttest(r75, r75p) : null;
      R.h75.rel = r75.length ? mean(r75) : null; R.h75.relPrev = r75p.length ? mean(r75p) : null;
      R.h15 = { med: med(vals(rows, 'h15')), medPrev: prev.length ? med(vals(prev, 'h15')) : null };

      // Por marca
      const marcas = [...new Set(rows.map((r) => r.brand))].sort();
      R.marcas = marcas.map((b) => {
        const rs = rows.filter((r) => r.brand === b), sp = specDe(b);
        const g = { marca: b, n: rs.length, rows: rs, spec: sp };
        for (const v of VARS) {
          const x = vals(rs, v.k), lim = sp && sp[v.spec] ? sp[v.spec] : null;
          g[v.k] = { n: x.length, med: med(x), mean: mean(x), v: x, lim, dentro: lim && x.length ? (x.filter((y) => (lim.inf == null || y >= lim.inf) && (lim.sup == null || y <= lim.sup)).length / x.length) * 100 : null };
        }
        g.atten = mean(vals(rs.filter((r) => r.atten != null), 'atten')); g.viab = mean(vals(rs, 'viab'));
        return g;
      });
      // Capacidad de proceso
      const cpkMin = ctx.metas.get('calidad.cpkMinimo', 1.33);
      R.cpkMin = cpkMin; R.cap = [];
      for (const g of R.marcas) for (const v of VARS) {
        const lim = g[v.k].lim; if (!lim || g[v.k].n < 8 || (lim.inf == null && lim.sup == null)) continue;
        const cap = S.capability(vals(g.rows, v.k), { lsl: lim.inf, usl: lim.sup });
        R.cap.push({ marca: g.marca, variable: v, lim, cap });
      }
      // Curvas típicas
      R.curvas = curvas(ctx, rows, ctx.marcas.filter((b) => marcas.includes(b)));
      // EWMA / CUSUM / cambio de nivel (h75 relativo a su marca, en orden de llenado)
      const orden = rows.filter((r) => r.h75R != null);
      R.serie = orden;
      const y = orden.map((r) => r.h75R);
      R.ewma = y.length >= 12 ? S.ewma(y, 0.2) : null;
      R.cusum = y.length >= 12 ? S.cusum(y, { target: 0, k: 0.5, h: 5 }) : null;
      R.cambios = VARS.map((v) => {
        const ys = rows.filter((r) => r[v.k + 'R'] != null).map((r) => r[v.k + 'R']), rs = rows.filter((r) => r[v.k + 'R'] != null);
        if (ys.length < 20) return null;
        const cp = S.changePoint(ys); if (!cp) return null;
        return { v, cp, t: rs[cp.idx].t, n: ys.length };
      }).filter(Boolean);
      // Tanques (FV)
      const tq = new Map(); rows.forEach((r) => { if (r.tq != null && r.h75R != null) { if (!tq.has(r.tq)) tq.set(r.tq, []); tq.get(r.tq).push(r); } });
      R.tanques = [...tq.entries()].filter(([, rs]) => rs.length >= 4).map(([k, rs]) => ({ k: String(k), n: rs.length, rows: rs, v: rs.map((r) => r.h75R), mean: mean(rs.map((r) => r.h75R)), med: med(rs.map((r) => r.h75R)), h75: med(vals(rs, 'h75')) })).sort((a, b) => b.mean - a.mean);
      const alpha = 0.05 / Math.max(1, R.tanques.length), allR = vals(rows, 'h75R');
      R.tanques.forEach((g) => { const rest = rows.filter((r) => r.h75R != null && String(r.tq) !== g.k).map((r) => r.h75R); const t = g.v.length > 1 && rest.length > 1 ? S.ttest(g.v, rest) : null; g.p = t ? t.p : null; g.real = !!(t && t.p < alpha); g.posible = !!(t && t.p < 0.05); g.dif = t ? t.diff : null; });
      R.cmpTanques = R.tanques.length >= 3 ? S.compareGroups(Object.fromEntries(R.tanques.map((g) => ['TQ ' + g.k, g.v]))) : null;
      // Atípicas
      const mz = S.modZ(allR), zm = new Map(); rows.filter((r) => r.h75R != null).forEach((r, i) => zm.set(r, mz[i]));
      R.atipicas = rows.filter((r) => r.h75R != null && zm.get(r) != null && Math.abs(zm.get(r)) > 3.5).map((r) => ({ ...r, z: zm.get(r) })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
      R.enCurso = rows.filter((r) => r.h75 == null).length;
      return R;
    });
  }
  An1.fermR = fermR;

  An1.mini = An1.mini || {};
  An1.mini.ferm = (ctx) => {
    const R = fermR(ctx), g = R.marcas.filter((m) => m.h75.n >= 3);
    if (!g.length) return null;
    return C.box({ title: 'Tiempo a 75 % de atenuación', subtitle: 'Horas desde el llenado, por marca', unit: 'h', w: W.half, h: 260, groups: g.map((m) => ({ label: `${m.marca} (${m.h75.n})`, values: m.h75.v })) });
  };

  /* ---------- Render de Fermentación ---------- */
  function renderFerm(ctx, UI) {
    const R = fermR(ctx);
    if (!R.n) return UI.card('Fermentación', '', UI.vacio('No hay fermentaciones en este periodo. Prueba con «Todo el histórico» o quita el filtro de marca.'));
    const out = [];
    const dentro75 = (() => { const xs = R.marcas.filter((m) => m.h75.dentro != null); const n = sum(xs.map((m) => m.h75.n)); return n ? sum(xs.map((m) => (m.h75.dentro * m.h75.n) / 100)) / n * 100 : null; })();
    const dentroEo = (() => { const xs = R.marcas.filter((m) => m.eo.dentro != null); const n = sum(xs.map((m) => m.eo.n)); return n ? sum(xs.map((m) => (m.eo.dentro * m.eo.n) / 100)) / n * 100 : null; })();
    out.push(An1.stats([
      An1.stat('Fermentaciones', fmt(R.n, 0), `${R.enCurso} aún sin terminar`),
      An1.stat('Hasta 75 % (mediana)', R.h75.med != null ? fmt(R.h75.med, 1) + ' h' : '—', R.h75.medPrev != null ? `antes ${fmt(R.h75.medPrev, 1)} h` : ''),
      An1.stat('Hasta 15 °P (mediana)', R.h15.med != null ? fmt(R.h15.med, 1) + ' h' : '—', R.h15.medPrev != null ? `antes ${fmt(R.h15.medPrev, 1)} h` : ''),
      An1.stat('E.O. dentro de especificación', dentroEo != null ? fmt(dentroEo, 0) + ' %' : '—', 'extracto original del mosto', dentroEo != null && dentroEo < 80 ? 'warn' : ''),
      An1.stat('Tiempo a 75 % dentro del límite', dentro75 != null ? fmt(dentro75, 0) + ' %' : '—', 'límite «Rata fermentación» del Excel'),
      An1.stat('Cambios de nivel', fmt(R.cambios.filter((c) => c.cp.p < 0.05).length, 0), 'variables con cambio real en el periodo'),
    ]));

    // 1. Curvas típicas
    out.push((() => {
      if (!R.curvas.length) return UI.card('Curva típica de fermentación', '', UI.vacio('No hay suficiente historia por marca (se necesitan 8 fermentaciones o más) o no hay curvas de extracto.'));
      const cards = R.curvas.map((cv) => {
        const g = cv.banda.g, ser = [{ name: 'Típica (mediana)', color: 'var(--muted,#6b6b66)', dashed: true, points: g.map((p) => ({ x: p.h, y: An1.round(p.p50, 2) })) }];
        cv.rec.forEach((x, i) => ser.push({ name: x.r.lote, points: x.h.pts.filter((p) => p.h != null && p.e != null).map((p) => ({ x: An1.round(p.h, 1), y: p.e })), color: i === cv.rec.length - 1 ? 'var(--ink,#171717)' : undefined, width: i === cv.rec.length - 1 ? 2.5 : 1.5 }));
        const xs = [...new Set(ser.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
        const band = { lo: xs.map((x) => { const v = interp(g, x, 'p10'); return v == null ? null : An1.round(v, 2); }), hi: xs.map((x) => { const v = interp(g, x, 'p90'); return v == null ? null : An1.round(v, 2); }), name: `Banda normal (P10–P90, ${cv.banda.n} fermentaciones)` };
        const fuera = cv.rec.map((x) => { const pts = x.h.pts.filter((p) => p.e != null && interp(g, p.h, 'p10') != null); const f = pts.filter((p) => p.e < interp(g, p.h, 'p10') - 0.05 || p.e > interp(g, p.h, 'p90') + 0.05).length; return { lote: x.r.lote, pct: pts.length ? (f / pts.length) * 100 : 0, lento: pts.length ? mean(pts.map((p) => p.e - interp(g, p.h, 'p50'))) : 0 }; });
        const raros = fuera.filter((f) => f.pct >= 40);
        const l = `La banda gris es donde cae el 80 % de las fermentaciones de ${esc(cv.marca)} (${cv.banda.n} históricas). ` + (cv.rec.length ? `De las últimas ${cv.rec.length}, ` + (raros.length ? `<b>${raros.map((f) => f.lote + (f.lento > 0 ? ' (más lenta)' : ' (más rápida)')).join(', ')}</b> se salió de la banda en 40 % o más de sus mediciones.` : 'todas se mantuvieron dentro de la banda normal.') : 'no hay fermentaciones recientes con curva.');
        return An1.tarjeta(UI, `Curva típica · ${cv.marca}`, 'Extracto (°P) según las horas desde el fin del llenado. La línea negra es la última fermentación.',
          C.line({ w: W.half, h: 300, unit: '°P', xType: 'linear', xFmt: (v) => v + ' h', toolbar: true, id: 'ch-fe-cv-' + cv.marca.replace(/\W/g, ''), series: ser, band }), l, { tono: raros.length ? 'warn' : '' });
      });
      return UI.grid(cards, 2);
    })());

    // 2. Tiempos por marca
    out.push(UI.grid(['h15', 'h75'].map((k) => {
      const v = VARS.find((x) => x.k === k), gs = R.marcas.filter((m) => m[k].n >= 3);
      if (!gs.length) return UI.card(v.label, '', UI.vacio('Pocas fermentaciones terminadas por marca.'));
      const stats = gs.map((m) => An1.boxData(`${m.marca} (${m[k].n})`, m[k].v, 0, 1e9)).filter(Boolean);
      const items = gs.map((m) => `<b>${esc(m.marca)}</b> ${fmt(m[k].med, 1)} h${m[k].lim ? ` (límite ${m[k].lim.inf != null ? fmt(m[k].lim.inf, 0) : '—'}–${m[k].lim.sup != null ? fmt(m[k].lim.sup, 0) : '—'}; ${fmt(m[k].dentro, 0)} % dentro)` : ''}`);
      return An1.tarjeta(UI, v.label.replace('Horas hasta', 'Tiempo hasta'), 'Cada caja muestra cómo se reparten las fermentaciones de la marca. Menos horas = fermenta más rápido.',
        C.box({ w: W.half, h: 280, unit: 'h', toolbar: true, id: 'ch-fe-box-' + k, stats }), `Medianas: ${items.join('; ')}.`);
    }), 2));

    // 3. Tabla por marca
    out.push(UI.card('Resumen por marca', 'Medianas del periodo y cuánto cumple cada marca su especificación (hoja ESPECIFICACIONES MARCA del Excel).',
      UI.tabla([{ k: 'marca', t: 'Marca' }, An1.colNum('n', 'Fermentaciones', 0), An1.colNum('eo', 'E.O. medio (°P)', 2), An1.colNum('eoDentro', 'E.O. en espec. (%)', 0), An1.colNum('h15', 'Hasta 15 °P (h)', 1), An1.colNum('h75', 'Hasta 75 % (h)', 1), An1.colNum('h75Dentro', '75 % en límite (%)', 0), An1.colNum('atten', 'Atenuación final (%)', 1), An1.colNum('rdf', 'Extracto final (°P)', 2), An1.colNum('viab', 'Viabilidad levadura (%)', 1), An1.colFuente()],
        R.marcas.map((g) => ({ marca: g.marca, n: g.n, eo: An1.round(g.eo.mean, 2), eoDentro: An1.round(g.eo.dentro, 0), h15: An1.round(g.h15.med, 1), h75: An1.round(g.h75.med, 1), h75Dentro: An1.round(g.h75.dentro, 0), atten: An1.round(g.atten, 1), rdf: An1.round(g.rdf.mean, 2), viab: An1.round(g.viab, 1), source: An1.srcRange(g.rows) })), { id: 'tb-fe-marca', nombre: 'fermentacion-por-marca' })));

    // 4. Capacidad de proceso
    out.push((() => {
      if (!R.cap.length) return UI.card('Capacidad del proceso (Cp / Cpk)', '', UI.vacio('Se necesitan al menos 8 fermentaciones por marca con límites de especificación.'));
      const rows = R.cap.map((c) => ({ marca: c.marca, variable: c.variable.label, n: c.cap.n, media: An1.round(c.cap.mean, c.variable.dec), lie: c.lim.inf, lse: c.lim.sup, cp: An1.round(c.cap.cp, 2), cpk: An1.round(c.cap.cpk, 2), fuera: An1.round(c.cap.pctOut, 0), veredicto: c.cap.cpk == null ? '' : c.cap.cpk >= R.cpkMin ? 'Capaz' : c.cap.cpk >= 1 ? 'Marginal' : 'No capaz' }));
      const malos = rows.filter((r) => r.veredicto === 'No capaz'), buenos = rows.filter((r) => r.veredicto === 'Capaz');
      const l = `Cpk mide qué tan cómodo cabe el proceso dentro de los límites de especificación: <b>1,33 o más es capaz</b> (meta de la plataforma ${fmt(R.cpkMin, 2)}), entre 1 y 1,33 es marginal y menos de 1 es que el proceso sale de los límites con frecuencia. ` +
        `De ${rows.length} combinaciones marca-variable, <b>${buenos.length} son capaces</b> y <b>${malos.length} no lo son</b>` + (malos.length ? `; las peores: ${malos.sort((a, b) => a.cpk - b.cpk).slice(0, 3).map((r) => `${r.marca} · ${r.variable.toLowerCase()} (Cpk ${fmt(r.cpk, 2)})`).join('; ')}.` : '.') + ' Cp compara el ancho del límite con la variación; si Cp es alto y Cpk bajo, el problema es que el proceso está descentrado.' + (rows.some((r) => r.variable.startsWith('Horas hasta 75')) ? ' <b>Ojo:</b> el límite «Rata fermentación» del Excel (horas) se compara aquí con el tiempo hasta 75 % de atenuación medido desde el fin del llenado; si en planta ese límite se mide desde otro punto, esas filas no son comparables y conviene revisar la definición.' : '');
      return UI.card('Capacidad del proceso (Cp / Cpk)', 'Qué tan bien cumple cada marca las especificaciones del Excel. Mide la variación dentro de cada marca con el rango móvil.',
        UI.tabla([{ k: 'marca', t: 'Marca' }, { k: 'variable', t: 'Variable' }, An1.colNum('n', 'n', 0), An1.colNum('media', 'Media', 2), An1.colNum('lie', 'Límite inf.', 2), An1.colNum('lse', 'Límite sup.', 2), An1.colNum('cp', 'Cp', 2), An1.colNum('cpk', 'Cpk', 2), An1.colNum('fuera', 'Fuera de límite (%)', 0), An1.badgeCol('veredicto', 'Veredicto', { Capaz: 'ok', Marginal: 'warn', 'No capaz': 'bad' })],
          rows, { id: 'tb-fe-cap', nombre: 'fermentacion-capacidad', sort: { k: 'cpk', dir: 1 }, max: 14 }) + UI.lectura(l, malos.length > buenos.length ? 'warn' : ''));
    })());

    // 5. EWMA y CUSUM
    out.push((() => {
      if (!R.ewma) return UI.card('¿Cambió el proceso?', '', UI.vacio('Se necesitan al menos 12 fermentaciones terminadas para vigilar cambios de nivel.'));
      const o = R.serie, cs = R.cusum, cp = R.cambios.find((c) => c.v.k === 'h75');
      const xs = o.map((r) => r.t);
      const line = C.line({ w: W.half, h: 300, unit: 'h', xType: 'time', toolbar: true, id: 'ch-fe-ewma', title: 'Desvío del tiempo a 75 % frente a lo normal de su marca',
        series: [{ name: 'Cada fermentación', dots: false, color: 'var(--faint,#c9c9c3)', points: o.map((r) => ({ x: r.t, y: An1.round(r.h75R, 1) })) }, { name: 'Tendencia suavizada (EWMA)', points: o.map((r, i) => ({ x: r.t, y: An1.round(R.ewma[i], 2) })) }],
        refs: [{ y: 0, label: 'Lo normal', dashed: false }], annotations: cp && cp.cp.p < 0.05 ? [{ x: cp.t, text: 'Cambio' }] : [] });
      const cus = C.line({ w: W.half, h: 300, unit: 'h acum.', xType: 'time', toolbar: true, id: 'ch-fe-cusum', title: 'Acumulado de desvíos (CUSUM)',
        series: [{ name: 'Se vuelve más lento', points: o.map((r, i) => ({ x: r.t, y: An1.round(cs.pos[i], 1) })) }, { name: 'Se vuelve más rápido', color: 'var(--est,#5d6f8c)', points: o.map((r, i) => ({ x: r.t, y: An1.round(cs.neg[i], 1) })) }],
        refs: [{ y: cs.h * cs.sigma, label: 'Alarma', color: 'var(--neg,#b0442e)' }] });
      const alarm = cs.alarms.length ? o[cs.alarms[cs.alarms.length - 1]] : null;
      const l1 = `Cada punto es una fermentación terminada: cuántas horas más (o menos) tardó en llegar al 75 % que lo habitual de su marca. La línea oscura suaviza el ruido y muestra hacia dónde va el proceso. ` + (cp ? `${cp.cp.p < 0.05 ? `<b>El proceso cambió cerca del ${fmtDate(cp.t)}</b>: antes tardaba ${fmt(cp.cp.meanBefore, 1)} h ${cp.cp.meanBefore > 0 ? 'más' : 'menos'} que lo normal y después ${fmt(cp.cp.meanAfter, 1)} h (cambio de ${fmt(cp.cp.delta, 1)} h; ${An1.sig(cp.cp.p).txt}).` : `No hay evidencia de un cambio de nivel (${An1.pTxt(cp.cp.p)}).`}` : '');
      const l2 = `El CUSUM suma los desvíos pequeños hasta que se vuelven imposibles de ignorar. ` + (alarm ? `Se disparó una alarma por última vez en la fermentación ${esc(alarm.lote)} (${fmtDate(alarm.t)}), señal de un corrimiento sostenido.` : 'No se disparó ninguna alarma: no hay corrimiento sostenido.');
      const tbl = R.cambios.length ? UI.tabla([{ k: 'variable', t: 'Variable' }, An1.colFecha('fecha', 'Punto de cambio'), An1.colNum('antes', 'Antes (vs. normal)', 2), An1.colNum('despues', 'Después (vs. normal)', 2), An1.colNum('delta', 'Cambio', 2), { k: 'veredicto', t: '¿Es real?', f: (v) => `<span class="an-badge ${v.startsWith('Real') ? 'warn' : ''}">${esc(v)}</span>` }],
        R.cambios.map((c) => ({ variable: c.v.label, fecha: iso(c.t), antes: An1.round(c.cp.meanBefore, 2), despues: An1.round(c.cp.meanAfter, 2), delta: An1.round(c.cp.delta, 2), veredicto: c.cp.p < 0.05 ? `Real (${An1.pTxt(c.cp.p)})` : `Puede ser casualidad (${An1.pTxt(c.cp.p)})` })), { id: 'tb-fe-cp', nombre: 'fermentacion-puntos-de-cambio' }) : '';
      return UI.card('¿Cambió el proceso?', 'Vigilancia de cambios de nivel con EWMA, CUSUM y detección de punto de cambio (cada fermentación se compara con la mediana de su marca).',
        `<div class="an-grid an-g2">${An1.tarjeta(UI, 'Tendencia suavizada', '', line, l1)}${An1.tarjeta(UI, 'Alarmas acumuladas', '', cus, l2)}</div>${tbl}${UI.lectura('«Punto de cambio»: la fecha que mejor separa la serie en dos tramos con promedios distintos. La prueba de permutación dice si esa separación podría ser casualidad. Los valores son horas (o °P) respecto a lo normal de la marca.')}`);
    })());

    // 6. Tanques
    out.push((() => {
      if (R.tanques.length < 3) return UI.card('Ranking de tanques (FV)', '', UI.vacio('Se necesitan al menos 3 tanques con 4 fermentaciones terminadas.'));
      const top = R.tanques.slice(0, 14), d = An1.difGrupos(R.cmpTanques), reales = R.tanques.filter((g) => g.real && g.dif > 0), rapidos = R.tanques.filter((g) => g.real && g.dif < 0);
      const l = `Cada barra es cuántas horas más (positivo) o menos tarda ese tanque en llegar al 75 % comparado con lo normal de la marca que contiene. Entre los ${R.tanques.length} tanques, ${d.ok ? '<b>' + d.frase + '</b>' : d.frase}. ` +
        (reales.length ? `Con evidencia fuerte, <b>${reales.map((g) => 'TQ ' + g.k).join(', ')}</b> fermenta${reales.length > 1 ? 'n' : ''} más lento que el resto. ` : '') + (rapidos.length ? `Más rápido que el resto: ${rapidos.map((g) => 'TQ ' + g.k).join(', ')}.` : '') + (!reales.length && !rapidos.length ? 'Ningún tanque se separa claramente del resto.' : '');
      return An1.tarjeta(UI, 'Ranking de tanques (FV)', 'Diferencia del tiempo a 75 % frente a lo normal de la marca (horas). Un * marca diferencia real frente al resto (corregida por comparar muchos tanques).',
        C.barsH({ w: W.full, h: Math.max(240, top.length * 28 + 50), unit: 'h', toolbar: true, id: 'ch-fe-tq', data: top.map((g) => ({ label: `${g.real ? '* ' : ''}TQ ${g.k} (n=${g.n})`, value: An1.round(g.mean, 1) })), refs: [{ y: 0, label: 'Normal', dashed: false }] }), l);
    })());

    // 7. Atípicas
    out.push((() => {
      const rows = R.atipicas.map((r) => ({ fecha: iso(r.t), t: r.t, lote: r.lote, tq: r.tq, marca: r.brand, h75: An1.round(r.h75, 1), normal: An1.round(R.bm[r.brand] ? R.bm[r.brand].h75 : null, 1), desvio: An1.round(r.h75R, 1), h15: An1.round(r.h15, 1), atten: An1.round(r.atten, 1), gen: r.gen, viab: An1.round(r.viab, 1), sentido: r.h75R > 0 ? 'Más lenta' : 'Más rápida', source: r.source }));
      const cuerpo = rows.length ? UI.tabla([An1.colFecha('fecha', 'Llenado'), { k: 'lote', t: 'Lote' }, { k: 'tq', t: 'Tanque' }, { k: 'marca', t: 'Marca' }, An1.colNum('h75', 'Hasta 75 % (h)', 1), An1.colNum('normal', 'Normal de la marca (h)', 1), An1.colNum('desvio', 'Desvío (h)', 1), An1.colNum('h15', 'Hasta 15 °P (h)', 1), An1.colNum('gen', 'Gen. levadura', 0), An1.colNum('viab', 'Viab. (%)', 1), An1.badgeCol('sentido', 'Sentido', { 'Más lenta': 'warn' }), An1.colFuente()], rows, { id: 'tb-fe-atip', nombre: 'fermentacion-atipicas', sort: { k: 'desvio', dir: -1 }, max: 10 }) : UI.vacio('Ninguna fermentación se aparta de lo normal por criterio robusto.');
      const l = rows.length ? `Hay <b>${rows.length} fermentación${rows.length === 1 ? '' : 'es'} atípica${rows.length === 1 ? '' : 's'}</b> (más de 3,5 desviaciones robustas MAD de lo normal de su marca): ${rows.filter((r) => r.sentido === 'Más lenta').length} más lentas y ${rows.filter((r) => r.sentido === 'Más rápida').length} más rápidas. Revisa temperatura, aireación y levadura de esos lotes.` : '';
      return UI.card('Fermentaciones atípicas', 'Lotes que tardaron mucho más o mucho menos de lo normal para su marca.', cuerpo + (l ? UI.lectura(l) : ''));
    })());

    out.push(An1.metodo('Cómo se calculó esta pestaña', `<ul>
      <li><b>Datos:</b> una fila por fermentación (B.D FERMENTACIÓN). Se descartan valores imposibles (por ejemplo extracto fuera de 8–25 °P). Los tiempos son solo de fermentaciones que ya llegaron al 75 %.</li>
      <li><b>Curva típica:</b> percentiles P10, P50 y P90 del extracto en cada hora, calculados con todo el histórico de la marca (App.Hist2.banda); se interpolan las curvas recientes a esa malla.</li>
      <li><b>Valores relativos a la marca:</b> para mezclar marcas sin sesgo, cada tiempo se compara con la mediana histórica de su propia marca.</li>
      <li><b>Capacidad:</b> Cp = (LSE − LIE) ÷ 6σ y Cpk = mín(LSE − μ, μ − LIE) ÷ 3σ, con σ estimada por el rango móvil promedio ÷ 1,128 (variación dentro de cada marca). Límites desde la hoja ESPECIFICACIONES MARCA.</li>
      <li><b>EWMA:</b> media móvil exponencial con λ = 0,2. <b>CUSUM:</b> k = 0,5σ, alarma a h = 5σ. <b>Punto de cambio:</b> mejor división en dos tramos (mínimo suma de cuadrados) y p-valor por 199 permutaciones.</li>
      <li><b>Tanques:</b> cada tanque contra el resto con t de Welch; umbral de Bonferroni (0,05 ÷ número de tanques) para marcar «real». Comparación global con Kruskal-Wallis.</li>
      <li><b>Atípicas:</b> z modificado con MAD (|z| &gt; 3,5) sobre el desvío relativo a la marca.</li></ul>`));
    return out.join('');
  }

  function hallazgosFerm(ctx) {
    const R = fermR(ctx), out = [];
    if (!R.n) return out;
    if (R.h75.tt && R.h75.rel != null && R.h75.relPrev != null) {
      const d = R.h75.rel - R.h75.relPrev;
      if (d > 2 && R.h75.tt.p < 0.05) out.push({ sev: d > 5 ? 'alta' : 'media', tab: 'fermentacion', titulo: `Las fermentaciones tardan ${fmt(d, 1)} h más en llegar al 75 %`, detalle: `Frente al periodo anterior (ajustado por marca): ${An1.sig(R.h75.tt.p).txt}.`, valor: fmt(R.h75.med, 1) + ' h' });
      else if (d < -2 && R.h75.tt.p < 0.05) out.push({ sev: 'ok', tab: 'fermentacion', titulo: `Las fermentaciones llegan ${fmt(Math.abs(d), 1)} h antes al 75 %`, detalle: `Mejora frente al periodo anterior: ${An1.sig(R.h75.tt.p).txt}.` });
    }
    for (const c of R.cambios) {
      if (c.cp.p < 0.05 && Math.abs(c.cp.delta) >= (c.v.k.startsWith('h') ? 3 : 0.1) && c.t >= ctx.rango.from) out.push({ sev: 'media', tab: 'fermentacion', titulo: `Cambio de nivel en «${c.v.label.toLowerCase()}» desde el ${fmtDate(c.t)}`, detalle: `Pasó de ${fmt(c.cp.meanBefore, 1)} a ${fmt(c.cp.meanAfter, 1)} frente a lo normal de la marca (${An1.sig(c.cp.p).txt}).` });
    }
    const fuera = R.marcas.filter((m) => m.eo.dentro != null && m.eo.n >= 8 && m.eo.dentro < 70);
    fuera.forEach((m) => out.push({ sev: 'media', tab: 'fermentacion', titulo: `${m.marca}: solo ${fmt(m.eo.dentro, 0)} % de los mostos cumple el extracto original`, detalle: `Límite ${fmt(m.eo.lim.inf, 2)}–${fmt(m.eo.lim.sup, 2)} °P; media real ${fmt(m.eo.mean, 2)} °P.` }));
    const malos = R.cap.filter((c) => c.cap.cpk != null && c.cap.cpk < 1 && c.variable.k !== 'h75');
    if (malos.length) out.push({ sev: 'info', tab: 'fermentacion', titulo: `${malos.length} combinaciones marca-variable con proceso no capaz (Cpk < 1)`, detalle: malos.slice(0, 3).map((c) => `${c.marca} · ${c.variable.label.toLowerCase()} (Cpk ${fmt(c.cap.cpk, 2)})`).join('; ') + '.' });
    const lentos = R.tanques.filter((g) => g.real && g.dif > 0);
    if (lentos.length) out.push({ sev: 'media', tab: 'fermentacion', titulo: `El tanque ${lentos[0].k} fermenta más lento que el resto`, detalle: `${fmt(lentos[0].mean, 1)} h más de lo normal de su marca, con ${lentos[0].n} fermentaciones (diferencia real, no azar; ${An1.pTxt(lentos[0].p)}).` });
    const lentas = R.atipicas.filter((r) => r.h75R > 0 && r.t >= ctx.rango.to - 14 * An1.DAY);
    if (lentas.length) out.push({ sev: 'info', tab: 'fermentacion', titulo: `${lentas.length} fermentación${lentas.length === 1 ? '' : 'es'} muy lenta${lentas.length === 1 ? '' : 's'} en las últimas 2 semanas`, detalle: lentas.slice(0, 3).map((r) => `${r.lote} (${r.brand}, +${fmt(r.h75R, 0)} h)`).join('; ') + '.' });
    return out;
  }

  /* ============================================================
     LEVADURA
     ============================================================ */
  function levR(ctx) {
    return An1.memo(ctx, 'levR', () => {
      const todo = An1.sane('lev', ctx.todas('lev')).filter((r) => !ctx.filtraMarca || ctx.marcas.includes(r.brand));
      const rows = An1.sane('lev', ctx.rows('lev')), prev = An1.sane('lev', ctx.previas('lev'));
      const meta = ctx.metas.get('levadura.viabMin', 95);
      const R = { rows, prev, todo, n: rows.length, meta };
      const by = An1.autoBy(ctx); R.by = by === 'day' ? 'week' : by;
      R.per = An1.recorta(An1.porPeriodo(rows, R.by), R.by);
      const v = vals(rows, 'viab'), vp = vals(prev, 'viab');
      R.viab = { n: v.length, mean: v.length ? mean(v) : null, prev: vp.length ? mean(vp) : null, sd: S.sd(v), ci: An1.ci(v), tt: v.length > 2 && vp.length > 2 ? S.ttest(v, vp) : null, cumple: v.length ? (v.filter((x) => x >= meta).length / v.length) * 100 : null, cumplePrev: vp.length ? (vp.filter((x) => x >= meta).length / vp.length) * 100 : null, spark: R.per.map((p) => mean(vals(p.rows, 'viab'))).filter((x) => x != null) };
      R.viab.tendencia = An1.trend(R.viab.spark, { unit: 'pp', dec: 2, porPeriodo: An1.periodoTxt(R.by) });
      R.cons = mean(vals(rows, 'cons')); R.consPrev = prev.length ? mean(vals(prev, 'cons')) : null; R.gen = mean(vals(rows, 'gen')); R.ph = mean(vals(rows, 'ph'));
      // Efecto en desempeño de la fermentación (cruce con ferm; se usa el histórico si el periodo tiene pocas)
      const fermAll = An1.sane('ferm', ctx.todas('ferm')), bm = baseMed(fermAll);
      let fr = enriquecer(An1.sane('ferm', ctx.rows('ferm')), bm); R.efectoHist = false;
      if (fr.filter((r) => r.gen != null && r.h75R != null).length < 30) { fr = enriquecer(fermAll.filter((r) => !ctx.filtraMarca || ctx.marcas.includes(r.brand)), bm); R.efectoHist = true; }
      R.ferm = fr;
      const preds = [['gen', 'Generación de la levadura', 'Generación'], ['viab', 'Viabilidad de la siembra (%)', 'Viabilidad'], ['cons', 'Consistencia de la siembra (%)', 'Consistencia']];
      const outs = [['h75R', 'Tiempo a 75 % (vs. su marca)', 'A 75 %'], ['h15R', 'Tiempo a 15 °P (vs. su marca)', 'A 15 °P'], ['rataR', 'Ritmo de caída medio, °P/h (vs. su marca)', 'Ritmo'], ['attenR', 'Atenuación final (vs. su marca)', 'Atenuación']];
      R.preds = preds; R.outs = outs;
      R.corr = preds.map(([pk, pl]) => outs.map(([ok, ol]) => { const xs = fr.map((r) => r[pk]), ys = fr.map((r) => r[ok]); const sp = S.spearman(xs, ys); return { pk, pl, ok, ol, r: sp ? sp.r : null, p: sp ? sp.p : null, n: sp ? sp.n : 0 }; }));
      const gg = new Map(); fr.forEach((r) => { if (r.gen != null && r.h75R != null) { const g = Math.round(r.gen); if (!gg.has(g)) gg.set(g, []); gg.get(g).push(r.h75R); } });
      R.porGen = [...gg.entries()].filter(([, a]) => a.length >= 5).sort((a, b) => a[0] - b[0]).map(([g, a]) => ({ g, v: a, n: a.length, med: med(a) }));
      R.cmpGen = R.porGen.length >= 3 ? S.compareGroups(Object.fromEntries(R.porGen.map((x) => ['Gen ' + x.g, x.v]))) : null;
      // Supervivencia (histórico completo)
      const lin = new Map(); todo.forEach((r) => { if (r.fam && r.gen != null) { const k = r.brand + '|' + r.fam; lin.set(k, Math.max(lin.get(k) || 0, Math.round(r.gen))); } });
      const maxG = Math.max(0, ...lin.values()), nLin = lin.size;
      R.surv = []; for (let g = 1; g <= Math.min(maxG, 12); g++) R.surv.push({ g, n: [...lin.values()].filter((m) => m >= g).length, pct: nLin ? ([...lin.values()].filter((m) => m >= g).length / nLin) * 100 : 0 });
      R.nLin = nLin;
      const cg = new Map(); todo.forEach((r) => { if (r.gen != null) { const g = Math.round(r.gen); if (!cg.has(g)) cg.set(g, { g, n: 0, desc: 0 }); const o = cg.get(g); o.n++; if (r.state === 'descartada') o.desc++; } });
      R.cosechasGen = [...cg.values()].sort((a, b) => a.g - b.g).filter((x) => x.g >= 1 && x.g <= 12);
      // Banco por familia y generación
      const fam = new Map(); rows.forEach((r) => { if (r.fam) { if (!fam.has(r.fam)) fam.set(r.fam, []); fam.get(r.fam).push(r); } });
      R.fam = [...fam.entries()].filter(([, rs]) => rs.length >= 4).sort((a, b) => b[1].length - a[1].length).slice(0, 10).map(([k, rs]) => ({ k, rs, n: rs.length }));
      const gen = new Map(); rows.forEach((r) => { if (r.gen != null) { const g = Math.round(r.gen); if (!gen.has(g)) gen.set(g, []); gen.get(g).push(r); } });
      R.genBanco = [...gen.entries()].filter(([, rs]) => rs.length >= 4).sort((a, b) => a[0] - b[0]).map(([g, rs]) => ({ g, rs, n: rs.length }));
      R.cmpFam = R.fam.length >= 3 ? S.compareGroups(Object.fromEntries(R.fam.map((f) => [f.k, vals(f.rs, 'viab')]))) : null;
      R.cmpGenViab = R.genBanco.length >= 3 ? S.compareGroups(Object.fromEntries(R.genBanco.map((f) => ['Gen ' + f.g, vals(f.rs, 'viab')]))) : null;
      const sp = rows.filter((r) => r.gen != null && r.viab != null); R.spGenViab = sp.length >= 10 ? S.spearman(sp.map((r) => r.gen), sp.map((r) => r.viab)) : null;
      // Cosechas fuera de límite
      R.fuera = rows.filter((r) => r.viab != null && r.viab < meta).sort((a, b) => a.viab - b.viab);
      const marc = [...new Set(rows.map((r) => r.brand))]; R.marcas = marc.map((b) => ({ b, v: vals(rows.filter((r) => r.brand === b), 'viab') })).filter((g) => g.v.length >= 3);
      R.cmpMarcas = R.marcas.length >= 2 ? S.compareGroups(Object.fromEntries(R.marcas.map((g) => [g.b, g.v]))) : null;
      // Serie por cosecha
      R.orden = rows.filter((r) => r.viab != null);
      R.imr = R.orden.length >= 8 ? S.imr(R.orden.map((r) => r.viab)) : null;
      return R;
    });
  }
  An1.levR = levR;

  An1.mini.lev = (ctx) => {
    const R = levR(ctx);
    if (R.per.length < 2) return null;
    const pts = R.per.map((p) => ({ x: p.t, y: An1.round(mean(vals(p.rows, 'viab')), 2) })).filter((p) => p.y != null);
    return C.line({ title: 'Viabilidad de la levadura', subtitle: `% promedio por ${An1.periodoTxt(R.by)} de cosecha`, unit: '%', xType: 'time', w: W.half, h: 260, series: [{ name: 'Viabilidad', points: pts }], refs: [{ y: R.meta, label: `Meta ${fmt(R.meta, 0)} %`, color: 'var(--pos)' }] });
  };

  function renderLev(ctx, UI) {
    const R = levR(ctx);
    if (!R.n) return UI.card('Levadura', '', UI.vacio('No hay cosechas de levadura en este periodo. Prueba con «Todo el histórico».'));
    const out = [];
    out.push(An1.stats([
      An1.stat('Cosechas', fmt(R.n, 0), `${R.prev.length ? 'antes ' + fmt(R.prev.length, 0) : ''}`),
      An1.stat('Viabilidad promedio', fmt(R.viab.mean, 1) + ' %', R.viab.prev != null ? `antes ${fmt(R.viab.prev, 1)} %` : '', R.viab.mean < R.meta ? 'warn' : 'ok'),
      An1.stat(`Cosechas ≥ ${fmt(R.meta, 0)} %`, R.viab.cumple != null ? fmt(R.viab.cumple, 0) + ' %' : '—', `${fmt(R.fuera.length, 0)} por debajo de la meta`, R.viab.cumple < 80 ? 'warn' : ''),
      An1.stat('Consistencia promedio', fmt(R.cons, 1) + ' %', R.consPrev != null ? `antes ${fmt(R.consPrev, 1)} %` : ''),
      An1.stat('Generación promedio', fmt(R.gen, 1), 'de las cosechas del periodo'),
      An1.stat('pH promedio', fmt(R.ph, 2), 'de la levadura cosechada'),
    ]));

    // 1. Tendencia de viabilidad
    out.push((() => {
      if (R.orden.length < 6) return UI.card('Viabilidad a lo largo del tiempo', '', UI.vacio('Se necesitan al menos 6 cosechas con viabilidad.'));
      const xs = R.orden.map((r) => r.t), ma = S.movingAvg(R.orden.map((r) => r.viab), 10);
      const cmp = An1.cmpTxt(R.viab.mean, R.viab.prev, { unit: '%', dec: 1, bueno: 'sube', pp: true });
      const l = `La viabilidad promedio fue <b>${fmt(R.viab.mean, 1)} %</b> (IC 95 %: ${R.viab.ci ? fmt(R.viab.ci[0], 1) + ' a ' + fmt(R.viab.ci[1], 1) : '—'}); ${R.viab.cumple != null ? fmt(R.viab.cumple, 0) + ' % de las cosechas cumple la meta de ' + fmt(R.meta, 0) + ' %.' : ''} ${cmp} ${R.viab.tt ? 'Frente al periodo anterior, ' + (R.viab.tt.p < 0.05 ? '<b>' + An1.sig(R.viab.tt.p).frase + '</b>' : An1.sig(R.viab.tt.p).frase) + '.' : ''} ${R.viab.tendencia.txt}`;
      return An1.tarjeta(UI, 'Viabilidad a lo largo del tiempo', 'Viabilidad de cada cosecha (puntos) y su media móvil de 10 cosechas. La línea verde es la meta.',
        C.line({ w: W.full, h: 300, unit: '%', xType: 'time', toolbar: true, id: 'ch-le-viab', series: [{ name: 'Cada cosecha', dots: false, color: 'var(--faint,#c9c9c3)', points: R.orden.map((r) => ({ x: r.t, y: r.viab, label: `${r.nombre} · ${fmtDate(r.t)}: ${fmt(r.viab, 1)} %` })) }, { name: 'Media móvil (10)', points: R.orden.map((r, i) => ({ x: r.t, y: An1.round(ma[i], 2) })) }],
          refs: [{ y: R.meta, label: `Meta ${fmt(R.meta, 0)} %`, color: 'var(--pos,#3b7a59)' }] }), l, { tono: R.viab.mean < R.meta ? 'warn' : '' });
    })());

    // 2. Efecto de la generación
    out.push((() => {
      const flat = R.corr.flat().filter((c) => c.n >= 10);
      if (!flat.length) return UI.card('¿La generación de la levadura cambia la fermentación?', '', UI.vacio('No hay suficientes fermentaciones con datos de levadura.'));
      const heat = C.heatmap({ w: W.half, rows: R.preds.map((p) => p[2]), cols: R.outs.map((o) => o[2]), matrix: R.corr.map((fila) => fila.map((c) => (c.r == null ? null : An1.round(c.r, 2)))), domain: [-0.5, 0.5], diverging: true, toolbar: true, id: 'ch-le-heat', title: 'Correlación (Spearman)', subtitle: 'r de Spearman. En tiempos, positivo = más lento; en ritmo y atenuación, positivo = más rápido o más atenuada.' });
      const reales = flat.filter((c) => c.p != null && c.p < 0.05).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
      const box = R.porGen.length >= 2 ? C.box({ w: W.half, h: 290, unit: 'h', toolbar: true, id: 'ch-le-gen', title: 'Tiempo a 75 % por generación (vs. su marca)', groups: R.porGen.map((x) => ({ label: `Gen ${x.g} (${x.n})`, values: x.v })), refs: [{ y: 0, label: 'Normal', dashed: false }] }) : '';
      const dg = An1.difGrupos(R.cmpGen);
      const tbl = UI.tabla([{ k: 'factor', t: 'Característica de la levadura' }, { k: 'resultado', t: 'Resultado de la fermentación' }, An1.colNum('n', 'n', 0), An1.colNum('r', 'Correlación', 2), { k: 'fuerza', t: 'Fuerza' }, { k: 'veredicto', t: '¿Es real?', f: (v) => `<span class="an-badge ${v.startsWith('Real') ? 'warn' : ''}">${esc(v)}</span>` }],
        flat.map((c) => ({ factor: c.pl, resultado: c.ol, n: c.n, r: An1.round(c.r, 2), fuerza: An1.fuerza(c.r), veredicto: c.p < 0.05 ? `Real (${An1.pTxt(c.p)})` : `Puede ser casualidad (${An1.pTxt(c.p)})` })), { id: 'tb-le-corr', nombre: 'levadura-efecto-en-fermentacion', sort: { k: 'r', dir: -1 } });
      const l = `Se cruzaron ${fmt(R.ferm.filter((r) => r.gen != null).length, 0)} fermentaciones${R.efectoHist ? ' de todo el histórico (el periodo tenía pocas)' : ''} con la levadura que se sembró, comparando cada una con lo normal de su marca. ` +
        (reales.length ? `Relaciones reales: ${reales.slice(0, 3).map((c) => `<b>${esc(c.pl.toLowerCase())}</b> con <b>${esc(c.ol.toLowerCase())}</b> (r = ${fmt(c.r, 2)}, ${An1.fuerza(c.r)})`).join('; ')}.` : 'Ninguna característica de la levadura muestra relación clara: lo que se ve puede ser casualidad.') +
        (dg ? ` Entre generaciones, ${dg.ok ? '<b>' + dg.frase + '</b>' : dg.frase}.` : '') + ' Correlación no es causa; es una pista para investigar.';
      return UI.card('¿La generación de la levadura cambia la fermentación?', 'Cómo se relacionan la generación, la viabilidad y la consistencia de la levadura sembrada con la rapidez de la fermentación.',
        `<div class="an-grid an-g2"><div>${heat}</div><div>${box}</div></div>${tbl}${UI.lectura(l)}`);
    })());

    // 3. Supervivencia
    out.push((() => {
      if (!R.surv.length) return UI.card('Supervivencia de generaciones', '', UI.vacio('No hay generaciones registradas.'));
      const half = R.surv.find((s) => s.pct < 50), hi = R.surv.filter((s) => s.g >= 7).slice(0, 1)[0];
      const l1 = `Se identificaron ${fmt(R.nLin, 0)} «linajes» (marca + familia de levadura). <b>${fmt(R.surv[Math.min(4, R.surv.length - 1)].pct, 0)} %</b> llega a la generación ${R.surv[Math.min(4, R.surv.length - 1)].g}` + (hi ? ` y <b>${fmt(hi.pct, 0)} %</b> a la ${hi.g}` : '') + (half ? `; menos de la mitad pasa de la generación ${half.g - 1}.` : '.');
      const cg = R.cosechasGen.filter((x) => x.n >= 3), peor = cg.slice().sort((a, b) => b.desc / b.n - a.desc / a.n)[0];
      const l2 = cg.length ? `Se descarta ${fmt((sum(cg.map((x) => x.desc)) / sum(cg.map((x) => x.n))) * 100, 0)} % de las cosechas en total.` + (peor && peor.desc ? ` La generación con más descartes es la ${peor.g} (${fmt((peor.desc / peor.n) * 100, 0)} %).` : '') : '';
      return UI.grid([
        An1.tarjeta(UI, 'Cuántos linajes llegan a cada generación', 'Porcentaje de linajes de levadura que alcanzaron al menos la generación N (todo el histórico).',
          C.line({ w: W.half, h: 280, unit: '%', xType: 'linear', xFmt: (v) => 'Gen ' + v, toolbar: true, id: 'ch-le-surv', series: [{ name: 'Linajes que llegan', points: R.surv.map((s) => ({ x: s.g, y: An1.round(s.pct, 1) })) }] }), l1),
        An1.tarjeta(UI, 'Descartes por generación', 'Porcentaje de cosechas descartadas según su generación (todo el histórico).',
          C.bars({ w: W.half, h: 280, unit: '%', toolbar: true, id: 'ch-le-desc', data: cg.map((x) => ({ label: 'Gen ' + x.g, value: An1.round((x.desc / x.n) * 100, 1), note: `${x.desc} de ${x.n}` })) }), l2),
      ], 2);
    })());

    // 4. Banco por familia y generación
    out.push(UI.grid([
      (() => {
        if (R.fam.length < 2) return UI.card('Viabilidad por familia', '', UI.vacio('Pocas cosechas por familia.'));
        const d = An1.difGrupos(R.cmpFam), best = R.fam.map((f) => ({ k: f.k, m: mean(vals(f.rs, 'viab')) })).sort((a, b) => b.m - a.m);
        return An1.tarjeta(UI, 'Viabilidad por familia', 'Cada caja resume la viabilidad de las cosechas de una familia (mínimo 4 cosechas).',
          C.box({ w: W.half, h: 280, unit: '%', toolbar: true, id: 'ch-le-fam', groups: R.fam.map((f) => ({ label: `${f.k} (${f.n})`, values: vals(f.rs, 'viab') })), refs: [{ y: R.meta, label: 'Meta', color: 'var(--pos,#3b7a59)' }] }),
          `La mejor familia es la <b>${esc(best[0].k)}</b> (${fmt(best[0].m, 1)} %) y la más baja la <b>${esc(best[best.length - 1].k)}</b> (${fmt(best[best.length - 1].m, 1)} %). ` + (d ? `Entre familias, ${d.ok ? '<b>' + d.frase + '</b>' : d.frase}.` : ''));
      })(),
      (() => {
        if (R.genBanco.length < 2) return UI.card('Viabilidad por generación', '', UI.vacio('Pocas cosechas por generación.'));
        const d = An1.difGrupos(R.cmpGenViab), sp = R.spGenViab;
        return An1.tarjeta(UI, 'Viabilidad por generación', 'La viabilidad suele bajar al repetir generaciones. Cada caja resume las cosechas de esa generación.',
          C.box({ w: W.half, h: 280, unit: '%', toolbar: true, id: 'ch-le-gviab', groups: R.genBanco.map((f) => ({ label: `Gen ${f.g} (${f.n})`, values: vals(f.rs, 'viab') })), refs: [{ y: R.meta, label: 'Meta', color: 'var(--pos,#3b7a59)' }] }),
          (sp ? `La relación entre generación y viabilidad es <b>${An1.fuerza(sp.r)}</b> (r = ${fmt(sp.r, 2)}; ${sp.p < 0.05 ? An1.sig(sp.p).txt : An1.sig(sp.p).txt}): ${sp.r < 0 && sp.p < 0.05 ? 'a más generaciones, menos viabilidad.' : 'no se ve que la viabilidad caiga con las generaciones.'} ` : '') + (d ? `Entre generaciones, ${d.ok ? '<b>' + d.frase + '</b>' : d.frase}.` : ''));
      })(),
    ], 2));

    // 5. Consistencia y pH por generación + marcas
    out.push(UI.grid([
      R.genBanco.length >= 2 ? An1.tarjeta(UI, 'Consistencia por generación', 'Consistencia (%) de la levadura cosechada según su generación.', C.box({ w: W.half, h: 260, unit: '%', toolbar: true, id: 'ch-le-gcons', groups: R.genBanco.map((f) => ({ label: `Gen ${f.g}`, values: vals(f.rs, 'cons') })) }), `Consistencia promedio del periodo: ${fmt(R.cons, 1)} %.`) : UI.card('Consistencia por generación', '', UI.vacio('Pocas cosechas por generación.')),
      R.marcas.length >= 2 ? An1.tarjeta(UI, 'Viabilidad por marca', 'Viabilidad de la levadura cosechada para cada marca.', C.box({ w: W.half, h: 260, unit: '%', toolbar: true, id: 'ch-le-marca', groups: R.marcas.map((g) => ({ label: `${g.b} (${g.v.length})`, values: g.v })), refs: [{ y: R.meta, label: 'Meta', color: 'var(--pos,#3b7a59)' }] }), (() => { const d = An1.difGrupos(R.cmpMarcas); return d ? `Entre marcas, ${d.ok ? '<b>' + d.frase + '</b>' : d.frase}.` : ''; })()) : UI.card('Viabilidad por marca', '', UI.vacio('Pocas cosechas por marca.')),
    ], 2));

    // 6. Cosechas fuera de límites
    out.push((() => {
      const rows = R.fuera.map((r) => ({ fecha: iso(r.t), t: r.t, nombre: r.nombre, marca: r.brand, fam: r.fam, gen: r.gen, viab: An1.round(r.viab, 1), falta: An1.round(R.meta - r.viab, 1), cons: An1.round(r.cons, 1), ph: An1.round(r.ph, 2), estado: r.state, source: r.source }));
      const cuerpo = rows.length ? UI.tabla([An1.colFecha('fecha', 'Cosecha'), { k: 'nombre', t: 'Levadura' }, { k: 'marca', t: 'Marca' }, { k: 'fam', t: 'Familia' }, An1.colNum('gen', 'Gen.', 0), An1.colNum('viab', 'Viabilidad (%)', 1), An1.colNum('falta', 'Falta para la meta', 1), An1.colNum('cons', 'Consistencia (%)', 1), An1.colNum('ph', 'pH', 2), { k: 'estado', t: 'Estado' }, An1.colFuente()], rows, { id: 'tb-le-fuera', nombre: 'levadura-cosechas-fuera-de-limite', sort: { k: 'viab', dir: 1 }, max: 10 }) : UI.vacio(`Todas las cosechas cumplen la meta de ${fmt(R.meta, 0)} % de viabilidad.`);
      const usadas = R.fuera.filter((r) => r.state === 'utilizada').length;
      const l = rows.length ? `<b>${rows.length} cosechas</b> (${fmt((rows.length / R.n) * 100, 0)} %) quedaron por debajo de ${fmt(R.meta, 0)} % de viabilidad; <b>${usadas}</b> de ellas se usaron igual para sembrar. La meta se puede cambiar en Configuración.` : '';
      return UI.card('Cosechas fuera de límites', `Cosechas con viabilidad menor a la meta (${fmt(R.meta, 0)} %).`, cuerpo + (l ? UI.lectura(l, R.fuera.length / R.n > 0.2 ? 'warn' : '') : ''));
    })());

    // 7. Detalle
    const drows = R.per.map((p) => ({ fecha: iso(p.t), t: p.t, n: p.rows.length, viab: An1.round(mean(vals(p.rows, 'viab')), 2), cons: An1.round(mean(vals(p.rows, 'cons')), 1), gen: An1.round(mean(vals(p.rows, 'gen')), 1), ph: An1.round(mean(vals(p.rows, 'ph')), 2), fuera: p.rows.filter((r) => r.viab != null && r.viab < R.meta).length, source: An1.srcRange(p.rows) }));
    out.push(UI.card(`Detalle por ${An1.periodoTxt(R.by)}`, 'Promedios del banco de levadura por periodo de cosecha.', UI.tabla([An1.colFecha('fecha', 'Desde'), An1.colNum('n', 'Cosechas', 0), An1.colNum('viab', 'Viabilidad (%)', 2), An1.colNum('cons', 'Consistencia (%)', 1), An1.colNum('gen', 'Generación', 1), An1.colNum('ph', 'pH', 2), An1.colNum('fuera', 'Bajo la meta', 0), An1.colFuente()], drows, { id: 'tb-le-det', nombre: 'levadura-detalle', sort: { k: 'fecha', dir: -1 }, max: 12 })));

    out.push(An1.metodo('Cómo se calculó esta pestaña', `<ul>
      <li><b>Datos:</b> una fila por cosecha (B.D LEVADURA). Se descartan viabilidad fuera de 50–100 % y consistencia fuera de 10–100 %.</li>
      <li><b>Efecto en la fermentación:</b> correlación de Spearman (no exige línea recta) entre la levadura sembrada y el desvío de cada fermentación frente a la mediana de su marca; p-valor con la t de Student sobre los rangos. Se considera real si p &lt; 0,05.</li>
      <li><b>Generaciones y familias:</b> Kruskal-Wallis (principal) y ANOVA (apoyo); cajas con mínimo 4–5 datos por grupo.</li>
      <li><b>Supervivencia:</b> linaje = marca + familia; se toma la generación máxima alcanzada y se cuenta cuántos linajes llegan a cada generación (histórico completo, sin cortar por periodo).</li>
      <li><b>Tendencia de viabilidad:</b> Mann-Kendall sobre el promedio por periodo; media móvil de 10 cosechas.</li>
      <li><b>Cosechas fuera de límites:</b> viabilidad menor a la meta de Configuración (por defecto 95 %).</li></ul>`));
    return out.join('');
  }

  function hallazgosLev(ctx) {
    const R = levR(ctx), out = [];
    if (!R.n) return out;
    if (R.viab.mean != null && R.viab.mean < R.meta) out.push({ sev: R.viab.mean < R.meta - 1 ? 'alta' : 'media', tab: 'levadura', titulo: `La viabilidad promedio (${fmt(R.viab.mean, 1)} %) está bajo la meta de ${fmt(R.meta, 0)} %`, detalle: `${fmt(R.viab.cumple, 0)} % de las cosechas cumple la meta.`, valor: fmt(R.viab.mean, 1) + ' %' });
    else if (R.viab.cumple != null && R.viab.cumple < 80) out.push({ sev: 'media', tab: 'levadura', titulo: `Solo ${fmt(R.viab.cumple, 0)} % de las cosechas cumple la viabilidad mínima`, detalle: `${R.fuera.length} cosechas por debajo de ${fmt(R.meta, 0)} %.` });
    if (R.viab.tt && R.viab.prev != null) {
      const d = R.viab.mean - R.viab.prev;
      if (d < -0.5 && R.viab.tt.p < 0.05) out.push({ sev: 'media', tab: 'levadura', titulo: `La viabilidad bajó ${fmt(Math.abs(d), 1)} puntos`, detalle: `${fmt(R.viab.mean, 1)} % frente a ${fmt(R.viab.prev, 1)} % antes: ${An1.sig(R.viab.tt.p).txt}.` });
      else if (d > 0.5 && R.viab.tt.p < 0.05) out.push({ sev: 'ok', tab: 'levadura', titulo: `La viabilidad subió ${fmt(d, 1)} puntos`, detalle: `${fmt(R.viab.mean, 1)} % frente a ${fmt(R.viab.prev, 1)} % antes: ${An1.sig(R.viab.tt.p).txt}.` });
    }
    if (R.viab.tendencia && R.viab.tendencia.dir < 0) out.push({ sev: 'media', tab: 'levadura', titulo: 'Tendencia a la baja de la viabilidad', detalle: R.viab.tendencia.txt });
    const g = R.corr[0] && R.corr[0][0];
    if (g && g.p != null && g.p < 0.05 && Math.abs(g.r) >= 0.2) out.push({ sev: 'info', tab: 'levadura', titulo: `La levadura de generaciones altas fermenta ${g.r > 0 ? 'más lento' : 'más rápido'}`, detalle: `Relación ${An1.fuerza(g.r)} (r = ${fmt(g.r, 2)}) entre generación y tiempo a 75 %: ${An1.sig(g.p).txt}.` });
    const usadas = R.fuera.filter((r) => r.state === 'utilizada').length;
    if (usadas >= 3) out.push({ sev: 'media', tab: 'levadura', titulo: `${usadas} cosechas bajo la meta se usaron para sembrar`, detalle: `Viabilidad menor a ${fmt(R.meta, 0)} % y aun así se utilizaron; riesgo de fermentaciones lentas.` });
    return out;
  }

  AN.registrar({ id: 'fermentacion', label: 'Fermentación', orden: 4, render: renderFerm, hallazgos: hallazgosFerm });
  AN.registrar({ id: 'levadura', label: 'Levadura', orden: 5, render: renderLev, hallazgos: hallazgosLev });
})();
