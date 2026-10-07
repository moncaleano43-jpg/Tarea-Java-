/* ============================================================
   47-an-calidad.js · Pestañas «Calidad de datos» e «Informe»
   Calidad: cobertura por campo, duplicados, fechas, variantes de nombres, valores imposibles/atípicos, puntuación 0-100,
   recomendaciones de qué corregir y documentación del método estadístico.
   Informe: resumen imprimible del periodo, descarga a Excel y texto para WhatsApp/correo.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.An1 || !A.Analisis) return;
  const An1 = A.An1, S = A.Stats, C = A.Charts, AN = A.Analisis;
  const { fmt, fmtPct, fmtDate, fmtDateTime, esc, iso } = AN;
  const { vals, sum, mean, med, rel, W, DS_INFO } = An1;
  const DAY = An1.DAY;
  const safe = (fn, fb) => { try { const v = fn(); return v == null ? fb : v; } catch (e) { return fb; } };
  const canon = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const KEYS = {
    agua: (r) => r.t + '|' + r.shift, aseos: (r) => r.t + '|' + r.equipment + '|' + r.sheet, merma: (r) => r.lote + '|' + r.phase + '|' + r.tq,
    recuperacion: (r) => r.begin + '|' + r.utk, trasiego: (r) => r.t + '|' + r.activity, ferm: (r) => r.lote + '|' + r.tq, lev: (r) => r.nombre + '|' + r.t,
  };
  const RUTA = { agua: ['#/agua', 'Agua'], aseos: ['#/aseos', 'Aseos'], merma: ['#/merma', 'Merma'], recuperacion: ['#/recuperacion', 'Recuperación'], trasiego: ['#/programa', 'Programa de trasiego'], ferm: ['#/bd', 'Base de datos'], lev: ['#/levaduras', 'Levaduras'] };
  const TEXTOS = { agua: ['shift'], aseos: ['equipment', 'operator', 'sheet'], merma: ['tq', 'brand'], recuperacion: ['utk', 'brand', 'destination'], trasiego: ['activity', 'brand', 'cause', 'destination'], ferm: ['tq', 'brand', 'fam', 'levadura'], lev: ['nombre', 'brand', 'fam', 'state'] };

  /* ---------- Marcas tal como llegan en las fuentes (antes de normalizar) ---------- */
  function marcasCrudas() {
    const out = [];
    const ex = safe(() => A.ExcelCavas.data(), {});
    (ex.fermentations || []).forEach((r) => out.push(['Fermentación', r.marca]));
    (ex.maturations || []).forEach((r) => out.push(['Maduración', r.marca]));
    safe(() => A.OperationSources.records('recuperacion', 'Control Recuperada'), []).forEach((r) => out.push(['Recuperación', r.cells[44]]));
    for (const sh of ['CONTROL TRASIEGO', 'CONTROL TRASIEGO HISTÓRICO']) safe(() => A.OperationSources.records('programa', sh), []).forEach((r) => out.push(['Trasiego', r.cells[2]]));
    safe(() => A.BDM.registros(), []).forEach((r) => out.push(['Levadura', r.marca]));
    return out.filter((x) => x[1] != null && String(x[1]).trim() !== '');
  }

  function calidadDS(ds, ctx) {
    const rows = A.DL.get(ds), n = rows.length, now = Date.now(), info = DS_INFO[ds];
    const Q = { ds, label: info.label, n, ruta: RUTA[ds] };
    if (!n) { Q.score = 0; Q.campos = []; Q.problemas = []; return Q; }
    const ts = rows.map((r) => r.t).filter((t) => t != null);
    const pasado = ts.filter((t) => t <= now + DAY);
    Q.desde = Math.min(...ts); Q.hasta = pasado.length ? Math.max(...pasado) : null; Q.dias = Q.hasta ? Math.max(0, Math.floor((now - Q.hasta) / DAY)) : null;
    Q.futuras = rows.filter((r) => r.t > now + DAY);
    // Duplicados
    const seen = new Map(); rows.forEach((r) => { const k = KEYS[ds](r); if (!seen.has(k)) seen.set(k, []); seen.get(k).push(r); });
    Q.duplicados = [...seen.values()].filter((g) => g.length > 1);
    Q.nDup = sum(Q.duplicados.map((g) => g.length - 1));
    // Campos numéricos
    const meta = A.DL.META[ds].fields.filter((f) => f.kind === 'num');
    Q.campos = meta.map((f) => {
      const v = rows.map((r) => r[f.key]).filter((x) => typeof x === 'number' && Number.isFinite(x));
      const lim = An1.LIM[ds] && An1.LIM[ds][f.key];
      const fuera = lim ? v.filter((x) => x < lim[0] || x > lim[1]) : [];
      const ok = lim ? v.filter((x) => x >= lim[0] && x <= lim[1]) : v;
      const o = S.outliers(ok, { method: 'iqr', k: 3 });
      return { key: f.key, label: f.label, unit: f.unit, n: v.length, cob: (v.length / n) * 100, lim, fuera: fuera.length, atip: o.idx.length, media: ok.length ? mean(ok) : null, clave: info.clave.includes(f.key) };
    });
    // Variantes de texto (misma palabra escrita distinto)
    Q.variantes = [];
    for (const k of TEXTOS[ds] || []) {
      const g = new Map();
      rows.forEach((r) => { const raw = r[k]; if (raw == null || raw === '') return; const c = canon(raw); if (!c) return; if (!g.has(c)) g.set(c, new Map()); const m = g.get(c); m.set(String(raw), (m.get(String(raw)) || 0) + 1); });
      const grupos = [...g.values()].filter((m) => m.size > 1).map((m) => [...m.entries()].sort((a, b) => b[1] - a[1]));
      grupos.forEach((m) => Q.variantes.push({ campo: k, formas: m.map((x) => x[0]), n: sum(m.map((x) => x[1])) }));
      Q.distintos = Q.distintos || {}; Q.distintos[k] = g.size;
    }
    Q.nVar = sum(Q.variantes.map((v) => v.n));
    // Problemas puntuales por dataset
    Q.problemas = [];
    const P = (sev, titulo, detalle, extra) => Q.problemas.push(Object.assign({ sev, titulo, detalle, ds, ruta: RUTA[ds] }, extra || {}));
    if (ds === 'agua') {
      const iss = new Map(); rows.forEach((r) => { if (r.issue) iss.set(r.issue, (iss.get(r.issue) || 0) + 1); });
      iss.forEach((c, k) => P(c >= 10 ? 'media' : 'info', `Agua: ${c} lecturas con «${k.toLowerCase()}»`, 'Revisa la lectura del contador en esas filas (reinicio de contador, fórmula rota o dato faltante).', { n: c }));
      const futuros = rows.filter((r) => r.total == null && r.t > now - DAY * 3 && r.t <= now + 2 * DAY).length; if (futuros) Q.sinCaptura = futuros;
    }
    if (ds === 'merma') {
      const sinVol = rows.filter((r) => r.loss == null).length; if (sinVol) P('media', `Merma: ${sinVol} lotes sin volumen o porcentaje de merma`, 'Completa el volumen de entrada y el porcentaje de merma de esos lotes en la sección Merma.', { n: sinVol });
      const neg = rows.filter((r) => r.lossPct != null && r.lossPct < -1).length; if (neg) P(neg >= 20 ? 'media' : 'info', `Merma: ${neg} lotes con saldo negativo (más de 1 %)`, 'Salió más cerveza de la que entró; revisa el volumen de entrada y de salida de esos lotes.', { n: neg });
      const grande = rows.filter((r) => r.lossPct != null && r.lossPct > ctx.metas.get('merma.alerta', 30)).length; if (grande) P('alta', `Merma: ${grande} lotes con merma mayor a ${ctx.metas.get('merma.alerta', 30)} %`, 'Probable error de captura de volumen; verifica contra el balance del lote.', { n: grande });
    }
    if (ds === 'aseos') {
      const sinFlujo = rows.filter((r) => r.flow == null || r.minutes == null).length; if (sinFlujo > n * 0.2) P('info', `Aseos: ${sinFlujo} aseos sin caudal o minutos de enjuague`, 'Sin esos datos no se puede estimar el agua del aseo.', { n: sinFlujo });
      const ops = Q.distintos && Q.distintos.operator; if (ops && ops > 60) P('info', `Aseos: ${ops} nombres de operario distintos`, 'Muchos nombres escritos distinto; usar una lista de operarios evitaría variantes.', { n: ops });
    }
    if (ds === 'recuperacion') { const sh = rows.filter((r) => r.hours == null).length; if (sh) P('info', `Recuperación: ${sh} recuperaciones sin horas calculables`, 'Falta la fecha de inicio o de fin de la recuperación.', { n: sh }); const sm = rows.filter((r) => !r.brand).length; if (sm) P('info', `Recuperación: ${sm} sin marca destino`, 'Completa la marca destino en el control de recuperación.', { n: sm }); }
    if (ds === 'trasiego') { const sc = rows.filter((r) => r.delay != null && r.delay > 4 && r.cause === 'Sin causa registrada').length; if (sc) P('info', `Trasiego: ${sc} retrasos de más de 4 h sin causa registrada`, 'Registrar la causa permite hacer el Pareto de retrasos.', { n: sc }); }
    if (ds === 'ferm') { const sl = rows.filter((r) => r.viab == null).length; if (sl > n * 0.03) P('info', `Fermentación: ${sl} fermentaciones sin levadura enlazada`, 'No se pudo cruzar con el banco de levadura (nombre de levadura distinto o faltante).', { n: sl }); }
    if (Q.futuras.length) P('media', `${info.label}: ${Q.futuras.length} registros con fecha futura`, 'Fechas posteriores a hoy suelen ser errores de digitación (año o mes).', { n: Q.futuras.length, ejemplo: Q.futuras.slice(0, 3).map((r) => fmtDate(r.t)).join(', ') });
    if (Q.nDup) P(Q.nDup >= 5 ? 'media' : 'info', `${info.label}: ${Q.nDup} registros duplicados`, 'Misma fecha y mismo equipo, lote o actividad repetidos; borra el duplicado para no contar dos veces.', { n: Q.nDup });
    if (Q.dias != null && Q.dias > 14 && ds !== 'aseos') P(Q.dias > 30 ? 'media' : 'info', `${info.label}: último dato hace ${Q.dias} días`, `El último registro es del ${fmtDate(Q.hasta)}. Carga los Excel más recientes.`, { n: Q.dias });
    Q.campos.filter((c) => c.clave && c.cob < 70).forEach((c) => P(c.cob < 40 ? 'media' : 'info', `${info.label}: «${c.label}» solo está completo en ${fmt(c.cob, 0)} %`, 'Es un dato clave del análisis; completarlo mejora los resultados.', { n: Math.round((c.cob / 100) * n) }));
    Q.campos.filter((c) => c.fuera > Math.max(3, n * 0.01)).forEach((c) => P('media', `${info.label}: ${c.fuera} valores imposibles en «${c.label}»`, `Fuera de ${fmt(c.lim[0], 1)} a ${fmt(c.lim[1], 1)} ${c.unit}; el análisis los ignora. Corrige la digitación o la lectura.`, { n: c.fuera }));
    // Puntuación 0-100
    const claves = Q.campos.filter((c) => c.clave);
    const cob = claves.length ? mean(claves.map((c) => c.cob)) : 100;
    const celdas = sum(claves.map((c) => c.n)), imp = sum(claves.map((c) => c.fuera));
    const pc = {
      cobertura: 40 * (cob / 100), imposibles: 20 * Math.max(0, 1 - (celdas ? (imp / celdas) * 10 : 0)), duplicados: 10 * Math.max(0, 1 - (Q.nDup / n) * 10),
      fechas: 10 * Math.max(0, 1 - (Q.futuras.length / n) * 10), actualidad: Q.dias == null ? 0 : ds === 'aseos' ? 10 : 10 * Math.max(0, Math.min(1, (60 - Q.dias) / 53)), consistencia: 10 * Math.max(0, 1 - (Q.nVar / n) * 2),
    };
    Q.pc = pc; Q.score = Math.round(sum(Object.values(pc)));
    Q.cob = cob;
    return Q;
  }

  function calidadR(ctx) {
    return An1.memo(ctx, 'calidadR', () => {
      const R = { ds: {} };
      for (const ds of Object.keys(DS_INFO)) R.ds[ds] = calidadDS(ds, ctx);
      const con = Object.values(R.ds).filter((q) => q.n);
      R.score = con.length ? Math.round(mean(con.map((q) => q.score))) : 0;
      R.filas = sum(Object.values(R.ds).map((q) => q.n));
      // Variantes de marca crudas → normalizadas
      const m = new Map();
      marcasCrudas().forEach(([fuente, raw]) => { const norm = A.DL.brandOf(raw), r = String(raw); if (r !== norm) { const k = r + '→' + norm; if (!m.has(k)) m.set(k, { raw: r, norm, n: 0, fuentes: new Set() }); const o = m.get(k); o.n++; o.fuentes.add(fuente); } });
      R.marcas = [...m.values()].map((o) => ({ ...o, fuentes: [...o.fuentes].join(', ') })).sort((a, b) => b.n - a.n);
      R.problemas = Object.values(R.ds).flatMap((q) => q.problemas || []);
      if (R.marcas.length) R.problemas.push({ sev: R.marcas.reduce((s, x) => s + x.n, 0) > 50 ? 'media' : 'info', titulo: `Marcas escritas de ${R.marcas.length} formas distintas`, detalle: 'Por ejemplo ' + R.marcas.slice(0, 3).map((x) => `«${x.raw}» → ${x.norm}`).join(', ') + '. La plataforma ya las unifica al analizar; conviene corregirlas en el origen o agregar la equivalencia en Configuración.', ruta: ['#/config', 'Configuración'], n: R.marcas.reduce((s, x) => s + x.n, 0), ds: 'marcas' });
      const orden = { alta: 0, media: 1, info: 2 };
      R.problemas.sort((a, b) => (orden[a.sev] ?? 3) - (orden[b.sev] ?? 3) || (b.n || 0) - (a.n || 0));
      return R;
    });
  }
  An1.calidadR = calidadR;

  const tono = (s) => (s >= 85 ? 'ok' : s >= 65 ? 'warn' : 'bad');
  const tonoT = (s) => 't-' + tono(s);

  function renderCalidad(ctx, UI) {
    const R = calidadR(ctx), out = [];
    const ds = Object.values(R.ds);
    const prob = R.problemas;
    out.push(`<div class="an-grid an-g-21">${UI.card('Puntuación de calidad de datos', 'De 0 a 100: cobertura de los campos clave (40), valores posibles (20), duplicados (10), fechas (10), actualidad (10) y nombres consistentes (10).',
      `<div class="an-score"><div class="an-score-n ${tono(R.score)}">${R.score}<small>de 100</small></div><div style="flex:1"><div class="an-cov">${ds.map((q) => `<div class="an-cov-r ${tonoT(q.score)}"><span>${esc(q.label)}</span><div class="an-bar"><i style="width:${Math.max(2, q.score)}%"></i></div><em>${q.n ? q.score : '—'}</em></div>`).join('')}</div></div></div>` +
      UI.lectura(`${fmt(R.filas, 0)} filas revisadas en ${ds.filter((q) => q.n).length} fuentes. ${R.score >= 85 ? 'Los datos son confiables para decidir.' : R.score >= 65 ? 'Los datos sirven, pero hay puntos que conviene corregir para que el análisis sea más confiable.' : 'Hay problemas importantes: los resultados deben leerse con cautela.'}`, R.score >= 85 ? 'ok' : R.score >= 65 ? 'warn' : 'bad'))}
      ${UI.card('Resumen', 'Lo encontrado en todas las fuentes.', An1.stats([An1.stat('Problemas a corregir', fmt(prob.filter((p) => p.sev !== 'info').length, 0), `${prob.filter((p) => p.sev === 'info').length} menores`, prob.some((p) => p.sev === 'alta') ? 'bad' : prob.some((p) => p.sev === 'media') ? 'warn' : 'ok'), An1.stat('Duplicados', fmt(sum(ds.map((q) => q.nDup || 0)), 0), 'registros repetidos'), An1.stat('Fechas futuras', fmt(sum(ds.map((q) => (q.futuras || []).length)), 0), 'posibles errores'), An1.stat('Variantes de marca', fmt(R.marcas.length, 0), 'formas de escribirlas')]))}</div>`);

    out.push(UI.card('Qué corregir primero', 'Lista ordenada por importancia, con el lugar de la plataforma donde se corrige.',
      prob.length ? `<div class="an-fix">${prob.slice(0, 14).map((p) => `<div class="an-fix-i ${p.sev}"><i></i><div><b>${esc(p.titulo)}</b><span>${esc(p.detalle)}${p.ejemplo ? ' Ej.: ' + esc(p.ejemplo) + '.' : ''}</span></div>${p.ruta ? `<a href="${p.ruta[0]}">Corregir en ${esc(p.ruta[1])} →</a>` : ''}</div>`).join('')}</div>${prob.length > 14 ? `<p class="an-note">Hay ${prob.length - 14} observaciones menores más; están en las tablas de cada fuente.</p>` : ''}` : `<div class="an-empty"><b>Todo en orden</b><span>No se encontraron problemas de calidad.</span></div>`));

    // Cobertura por fuente
    out.push(UI.card('Cobertura por fuente', 'Cada fila es una fuente de datos: cuántos registros tiene, qué tan completa está y hasta cuándo llega.',
      UI.tabla([{ k: 'fuente', t: 'Fuente' }, An1.colNum('n', 'Filas', 0), An1.colFecha('desde', 'Desde'), An1.colFecha('hasta', 'Último dato'), An1.colNum('dias', 'Días sin datos', 0), An1.colNum('cob', 'Campos clave completos (%)', 0), An1.colNum('dup', 'Duplicados', 0), An1.colNum('fut', 'Fechas futuras', 0), An1.colNum('imp', 'Valores imposibles', 0), An1.colNum('var', 'Filas con variantes de texto', 0), { k: 'score', t: 'Puntuación', num: true, f: (v) => `<span class="an-badge ${tono(v)}">${v}</span>` }],
        ds.map((q) => ({ fuente: q.label, n: q.n, desde: q.desde ? iso(q.desde) : '', hasta: q.hasta ? iso(q.hasta) : '', dias: q.dias, cob: An1.round(q.cob, 0), dup: q.nDup || 0, fut: (q.futuras || []).length, imp: sum((q.campos || []).map((c) => c.fuera)), var: q.nVar || 0, score: q.score })), { id: 'tb-ca-fuente', nombre: 'calidad-por-fuente', sort: { k: 'score', dir: 1 } })));

    // Detalle por dataset
    out.push(...ds.filter((q) => q.n).map((q) => UI.card(`${q.label}: campo por campo`, `${fmt(q.n, 0)} filas · ${fmtDate(q.desde)} a ${q.hasta ? fmtDate(q.hasta) : '—'}${q.dias != null ? ` · último dato hace ${q.dias} días` : ''}.`,
      UI.tabla([{ k: 'campo', t: 'Campo' }, { k: 'unidad', t: 'Unidad' }, An1.colNum('n', 'Con dato', 0), { k: 'cob', t: 'Cobertura', num: true, f: (v) => `<span class="an-badge ${v >= 90 ? 'ok' : v >= 60 ? 'warn' : 'bad'}">${fmt(v, 0)} %</span>` }, An1.colNum('fuera', 'Imposibles', 0), An1.colNum('atip', 'Atípicos extremos', 0), An1.colNum('media', 'Promedio sin imposibles', 2), { k: 'rango', t: 'Rango plausible' }, { k: 'source', t: 'Fuente', f: (v) => `<span class="an-src">${esc(v)}</span>` }],
        q.campos.map((c) => ({ campo: c.label, unidad: c.unit, n: c.n, cob: c.cob, fuera: c.fuera, atip: c.atip, media: An1.round(c.media, 2), rango: c.lim ? `${fmt(c.lim[0], 1)} a ${fmt(c.lim[1], 1)}` : '—', source: (A.DL.get(q.ds)[0] && A.DL.get(q.ds)[0].source ? String(A.DL.get(q.ds)[0].source).replace(/ · fila.*$/, '') : '') })), { id: 'tb-ca-' + q.ds, nombre: 'calidad-' + q.ds, max: 14 }) +
      (q.duplicados.length ? UI.lectura(`Hay ${q.nDup} registros repetidos; por ejemplo ${q.duplicados.slice(0, 2).map((g) => esc(g[0].source || g[0].lote || '')).join(' y ')}.`) : ''))));

    // Variantes
    out.push(UI.card('Nombres escritos de varias formas', 'Marcas, equipos y operarios que significan lo mismo pero están escritos distinto. La plataforma unifica las marcas al analizar; los demás se cuentan por separado.',
      (R.marcas.length ? UI.tabla([{ k: 'raw', t: 'Como está escrito' }, { k: 'norm', t: 'Se interpreta como' }, An1.colNum('n', 'Veces', 0), { k: 'fuentes', t: 'Dónde aparece' }], R.marcas.map((m) => ({ raw: m.raw, norm: m.norm, n: m.n, fuentes: m.fuentes })), { id: 'tb-ca-marcas', nombre: 'calidad-variantes-marca', sort: { k: 'n', dir: -1 }, max: 10 }) : '<p class="an-prosa">Las marcas están escritas de forma consistente.</p>') +
      (() => { const v = ds.flatMap((q) => (q.variantes || []).map((x) => ({ fuente: q.label, campo: x.campo, formas: x.formas.slice(0, 4).join(' · '), n: x.n }))); return v.length ? UI.tabla([{ k: 'fuente', t: 'Fuente' }, { k: 'campo', t: 'Campo' }, { k: 'formas', t: 'Formas encontradas' }, An1.colNum('n', 'Filas', 0)], v, { id: 'tb-ca-var', nombre: 'calidad-variantes-texto', sort: { k: 'n', dir: -1 }, max: 8 }) : ''; })() +
      UI.lectura(`Corregir en el origen es lo mejor; si no se puede, agrega la equivalencia en <a href="#/config">Configuración</a> y la plataforma la usará en todos los análisis.`)));

    // Método
    out.push(UI.card('Método estadístico usado en el análisis', 'Qué prueba se usó en cada parte, para que cualquiera pueda revisar los cálculos.', metodoGeneral(ctx, UI), { id: 'metodo' }));
    return out.join('');
  }

  function metodoGeneral(ctx, UI) {
    const L = An1.LIM;
    const filas = [
      ['Comparar con el periodo anterior', 'Prueba t de Welch (no supone varianzas iguales). Si p < 0,05 se dice «diferencia real, no azar»; si no, «puede ser casualidad». En porcentajes se muestran puntos de diferencia.', 'Resumen, Agua, Merma, Levadura'],
      ['Comparar varios grupos (turnos, marcas, tanques, generaciones, familias)', 'Kruskal-Wallis como prueba principal (usa rangos y no se deja llevar por datos extremos) y ANOVA de apoyo. Para un tanque contra el resto: Welch con corrección de Bonferroni (0,05 ÷ número de grupos).', 'Agua, Merma, Fermentación, Levadura'],
      ['Tendencia en el tiempo', 'Prueba de Mann-Kendall (no exige línea recta) y pendiente de Sen (mediana de pendientes). Se descarta el último periodo si está incompleto.', 'Agua, Merma, Levadura'],
      ['Variación normal y alarmas', 'Carta de control I-MR con σ = rango móvil promedio ÷ 1,128, límites a ±3σ y reglas de Nelson 1-4 (1 punto fuera, 2 de 3 a más de 2σ, 4 de 5 a más de 1σ, 8 seguidos de un lado).', 'Agua, Merma, Levadura'],
      ['Cambios pequeños sostenidos', 'EWMA (λ = 0,2), CUSUM bilateral (k = 0,5σ, alarma a 5σ) y punto de cambio por mínima suma de cuadrados con p-valor por 199 permutaciones.', 'Fermentación'],
      ['Capacidad de proceso', 'Cp = (LSE − LIE) ÷ 6σ, Cpk = mín(LSE − μ, μ − LIE) ÷ 3σ, con σ dentro del subgrupo por rango móvil. Capaz si Cpk ≥ ' + fmt(ctx.metas.get('calidad.cpkMinimo', 1.33), 2) + '. Límites de la hoja ESPECIFICACIONES MARCA.', 'Fermentación'],
      ['Relaciones entre variables', 'Correlación de Spearman (rangos) con p-valor por t de Student; regresión lineal con R² donde se muestra una recta. Se dice «fuerte» desde |r| ≥ 0,6, «moderada» desde 0,4, «débil» desde 0,2.', 'Agua, Merma, Levadura'],
      ['Valores atípicos', 'Tukey (1,5 × rango intercuartil) para turnos de agua; z modificado por MAD (|z| > 3,5) para lotes de merma y fermentaciones; los valores físicamente imposibles se excluyen antes.', 'Agua, Merma, Fermentación'],
      ['Pronóstico', 'Se prueba línea de tendencia, suavizado de Holt y promedio, y se elige el de menor error en una prueba hacia atrás (últimos 20 % de los datos). Intervalo aproximado al 95 %.', 'Agua'],
      ['Merma ponderada', 'Σ merma ÷ Σ entrada: los lotes grandes pesan más. Intervalos de confianza del 95 % para el promedio por lote con t de Student.', 'Merma'],
      ['Valores relativos a la marca', 'Cada fermentación se compara con la mediana histórica de su marca para poder juntar marcas sin que la diferencia entre ellas confunda.', 'Fermentación, Levadura'],
    ];
    const lim = Object.entries(L).flatMap(([ds, cs]) => Object.entries(cs).map(([k, [a, b]]) => { const f = A.DL.fieldOf(ds, k); return { fuente: DS_INFO[ds].label, campo: f ? f.label : k, min: a, max: b }; }));
    return `<div class="an-tabla"><div class="an-tabla-s"><table><thead><tr><th>Qué se quiere saber</th><th>Cómo se calcula</th><th>Dónde se usa</th></tr></thead><tbody>${filas.map((f) => `<tr><td style="white-space:normal;min-width:200px"><b>${esc(f[0])}</b></td><td style="white-space:normal;min-width:320px">${esc(f[1])}</td><td style="white-space:normal">${esc(f[2])}</td></tr>`).join('')}</tbody></table></div></div>` +
      An1.metodo('Límites físicos que se usan para descartar valores imposibles', `<p>Un dato fuera de estos rangos se considera un error de captura (por ejemplo, una lectura de contador reiniciada) y no entra a los cálculos. Se cuentan arriba como «imposibles».</p>` + UI.tabla([{ k: 'fuente', t: 'Fuente' }, { k: 'campo', t: 'Campo' }, An1.colNum('min', 'Mínimo', 2), An1.colNum('max', 'Máximo', 2)], lim, { id: 'tb-ca-lim', nombre: 'calidad-limites', max: 12 })) +
      `<p class="an-note"><b>Nivel de confianza</b> En todo el análisis se usa 95 % (alfa = 0,05). Un resultado «real» no significa que sea importante en la práctica: mira también el tamaño de la diferencia. Con muchos datos, hasta diferencias mínimas salen «reales».</p>`;
  }

  function hallazgosCalidad(ctx) {
    const R = calidadR(ctx), out = [];
    if (!R.filas) return out;
    R.problemas.filter((p) => (p.sev === 'alta' || p.sev === 'media') && !(p.ds === 'merma' && /saldo negativo|mayor a/.test(p.titulo))).slice(0, 3).forEach((p) => out.push({ sev: p.sev, tab: 'calidad', area: 'Calidad de datos', titulo: p.titulo, detalle: p.detalle, valor: p.n != null ? String(p.n) : '' }));
    if (R.score >= 90) out.push({ sev: 'ok', tab: 'calidad', area: 'Calidad de datos', titulo: `Calidad de datos ${R.score}/100`, detalle: 'Los datos son completos y consistentes; el análisis es confiable.' });
    else if (R.score < 65) out.push({ sev: 'alta', tab: 'calidad', area: 'Calidad de datos', titulo: `Calidad de datos baja (${R.score}/100)`, detalle: 'Hay faltantes o errores que afectan los resultados; revisa la lista de correcciones.' });
    return out;
  }

  AN.registrar({ id: 'calidad', label: 'Calidad de datos', orden: 11, render: renderCalidad, hallazgos: hallazgosCalidad });

  /* ============================================================
     INFORME
     ============================================================ */
  const sevTxt = { alta: 'ATENCIÓN ALTA', media: 'ATENCIÓN MEDIA', info: 'PARA SABER', ok: 'BIEN' };
  const signo = (d) => (d > 0 ? '+' : d < 0 ? '−' : '');
  function cambioTxt(k) {
    if (k.v == null || k.p == null) return '';
    const d = k.v - k.p;
    if (k.pp) return Math.abs(d) < 0.05 ? 'igual' : `${signo(d)}${fmt(Math.abs(d), 1)} pp`;
    if (k.abs) return Math.abs(d) < 0.05 ? 'igual' : `${signo(d)}${fmt(Math.abs(d), 1)} ${k.unit}`;
    if (!k.p) return '';
    const r = rel(k.v, k.p); return Math.abs(r) < 0.5 ? 'igual' : `${signo(r)}${fmt(Math.abs(r), 1)} %`;
  }
  function informeDatos(ctx) {
    const kpis = An1.kpiData(ctx), hs = AN.hallazgos(ctx);
    return { kpis, hs, estado: kpis.map((k) => An1.kpiEstado(k)) };
  }
  function textoPlanta(ctx) {
    const { kpis, hs } = informeDatos(ctx);
    const L = [];
    L.push(`*Informe de cavas* · ${ctx.etiquetaPeriodo}`);
    L.push(`${ctx.rango.dias} días · ${An1.marcaTxt(ctx)}${ctx.estado.comparar ? ' · comparado con el periodo anterior' : ''}`);
    L.push('');
    L.push('*Cómo vamos*');
    kpis.forEach((k) => {
      const e = An1.kpiEstado(k), c = cambioTxt(k);
      L.push(`• ${k.label}: ${fmt(k.v, k.dec)} ${k.unit}${c ? ` (${c}${e === 'mejor' ? ', mejor' : e === 'peor' ? ', peor' : ''})` : ''}`);
    });
    const act = hs.filter((h) => h.sev === 'alta' || h.sev === 'media').slice(0, 6);
    if (act.length) { L.push(''); L.push('*Para actuar*'); act.forEach((h) => L.push(`• ${h.sev === 'alta' ? '(Alta) ' : ''}${h.titulo}. ${h.detalle || ''}`.trim())); }
    const bien = hs.filter((h) => h.sev === 'ok').slice(0, 4);
    if (bien.length) { L.push(''); L.push('*Lo que va bien*'); bien.forEach((h) => L.push(`• ${h.titulo}`)); }
    L.push(''); L.push('Datos: plataforma Control de Cavas (Cifra).');
    return L.join('\n');
  }

  function renderInforme(ctx, UI) {
    const { kpis, hs } = informeDatos(ctx);
    const calidad = calidadR(ctx);
    const filasK = kpis.map((k) => { const e = An1.kpiEstado(k), c = cambioTxt(k); return `<tr><td>${esc(k.label)}</td><td class="n"><b>${fmt(k.v, k.dec)}</b> ${esc(k.unit)}</td><td class="n">${k.p != null ? fmt(k.p, k.dec) + ' ' + esc(k.unit) : '—'}</td><td class="n ${e === 'mejor' ? 'up' : e === 'peor' ? 'dn' : ''}">${esc(c || '—')}</td><td>${e === 'mejor' ? 'Mejor' : e === 'peor' ? 'Peor' : e === 'igual' ? 'Igual' : '—'}</td></tr>`; }).join('');
    const grupos = [['alta', 'Atención alta'], ['media', 'Atención media'], ['info', 'Para saber'], ['ok', 'Va bien']];
    const hsHtml = grupos.map(([s, t]) => { const l = hs.filter((h) => h.sev === s); return l.length ? `<h4 style="margin:14px 0 6px;font-size:13px;color:var(--ink)">${t} (${l.length})</h4><ul class="an-lista">${l.map((h) => `<li><b>${esc(h.titulo)}.</b> ${esc(h.detalle || '')} <span class="an-src">(${esc(h.area || '')})</span></li>`).join('')}</ul>` : ''; }).join('');
    const charts = ['agua', 'merma', 'ferm', 'lev'].map((k) => { try { return An1.mini && An1.mini[k] ? An1.mini[k](ctx) : null; } catch (e) { return null; } }).filter(Boolean);
    const texto = textoPlanta(ctx);
    return `
      <div class="an-informe-acc an-card"><div class="an-acciones">
        <button type="button" class="an-btn pri" data-inf="print">Imprimir o guardar como PDF</button>
        <button type="button" class="an-btn" data-inf="excel">Descargar Excel</button>
        <button type="button" class="an-btn" data-inf="copy">Copiar resumen como texto</button>
        <span class="an-toast" id="anInfToast" role="status" aria-live="polite"></span></div>
        <p class="an-note" style="margin-top:12px"><b>Consejo</b> Para guardar en PDF, elige «Guardar como PDF» como impresora. El informe usa el periodo, las marcas y la comparación que tengas seleccionados arriba.</p></div>
      <article class="an-informe an-card" id="anInforme">
        <header class="an-informe-h"><h2>Informe de control de cavas</h2>
          <p>${esc(ctx.etiquetaPeriodo)} · ${ctx.rango.dias} días · ${esc(An1.marcaTxt(ctx))}${ctx.estado.comparar ? ` · comparado con ${esc(fmtDate(ctx.rango.prevFrom))} – ${esc(fmtDate(ctx.rango.prevTo))}` : ''} · generado el ${esc(fmtDate(Date.now()))}</p></header>
        <section><h3 style="margin:0 0 8px;font-size:15px">Indicadores clave</h3>
          ${kpis.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Indicador</th><th class="n">Periodo</th><th class="n">Anterior</th><th class="n">Cambio</th><th>Frente al anterior</th></tr></thead><tbody>${filasK}</tbody></table></div>` : '<p class="an-prosa">Sin indicadores para este periodo.</p>'}</section>
        <section><h3 style="margin:0 0 4px;font-size:15px">Hallazgos</h3>${hsHtml || '<p class="an-prosa">El análisis automático no encontró puntos para destacar.</p>'}</section>
        ${charts.length ? `<section><h3 style="margin:0 0 8px;font-size:15px">Gráficas clave</h3><div class="an-grid an-g2">${charts.map((c) => `<div class="an-mini">${c}</div>`).join('')}</div></section>` : ''}
        <section><h3 style="margin:0 0 8px;font-size:15px">Confianza de los datos</h3><p class="an-prosa">Puntuación de calidad de datos: <b>${calidad.score}/100</b>. ${calidad.problemas.filter((p) => p.sev !== 'info').slice(0, 3).map((p) => esc(p.titulo)).join('; ') || 'Sin problemas relevantes'}. Las pruebas estadísticas usan un nivel de confianza de 95 %; el método completo está en la sección Calidad de datos.</p></section>
      </article>
      <div class="an-informe-no">${UI.card('Texto para WhatsApp o correo', 'Edita lo que quieras y copia. Las líneas con asteriscos salen en negrita en WhatsApp.', `<textarea class="an-texto" id="anTexto" rows="16" spellcheck="false">${esc(texto)}</textarea>`)}</div>`;
  }

  function descargarExcel(ctx) {
    const { kpis, hs } = informeDatos(ctx);
    const aguaR = An1.aguaR ? An1.aguaR(ctx) : null, mermaR = An1.mermaR ? An1.mermaR(ctx) : null, fermR = An1.fermR ? An1.fermR(ctx) : null;
    const hojas = [
      { nombre: 'Indicadores', titulo: 'Informe de control de cavas', sub: ctx.etiquetaPeriodo + ' · ' + An1.marcaTxt(ctx), cols: [{ h: 'Indicador', t: 's' }, { h: 'Unidad', t: 's' }, { h: 'Periodo', t: 'n' }, { h: 'Periodo anterior', t: 'n' }, { h: 'Cambio', t: 's' }, { h: 'Frente al anterior', t: 's' }], rows: kpis.map((k) => [k.label, k.unit, An1.round(k.v, 3), An1.round(k.p, 3), cambioTxt(k), An1.kpiEstado(k) || '']) },
      { nombre: 'Hallazgos', titulo: 'Hallazgos del análisis', sub: ctx.etiquetaPeriodo, cols: [{ h: 'Gravedad', t: 's' }, { h: 'Área', t: 's' }, { h: 'Hallazgo', t: 's' }, { h: 'Detalle', t: 's' }], rows: hs.map((h) => [An1.SEV_TXT[h.sev] || h.sev, h.area || '', h.titulo, h.detalle || '']) },
    ];
    if (aguaR && aguaR.per.length) hojas.push({ nombre: 'Agua', titulo: 'Consumo de agua por ' + An1.periodoTxt(aguaR.by), sub: ctx.etiquetaPeriodo, cols: [{ h: 'Desde', t: 's' }, { h: 'Turnos', t: 'n' }, { h: 'Total m³', t: 'n' }, { h: 'm³ por turno', t: 'n' }, { h: 'Fuente', t: 's' }], rows: aguaR.per.map((p) => [iso(p.t), p.rows.length, An1.round(sum(vals(p.rows, 'total')), 1), An1.round(mean(vals(p.rows, 'total')), 2), An1.srcRange(p.rows)]) });
    if (mermaR && mermaR.n) hojas.push({ nombre: 'Merma lotes críticos', titulo: 'Lotes críticos de merma', sub: ctx.etiquetaPeriodo, cols: [{ h: 'Cierre', t: 's' }, { h: 'Fase', t: 's' }, { h: 'Lote', t: 's' }, { h: 'Tanque', t: 's' }, { h: 'Marca', t: 's' }, { h: 'Entrada Hl', t: 'n' }, { h: 'Merma Hl', t: 'n' }, { h: 'Merma %', t: 'n' }, { h: 'Motivo', t: 's' }, { h: 'Fuente', t: 's' }], rows: mermaR.criticos.map((c) => [iso(c.t), c.phase, c.lote, String(c.tq), c.brand, An1.round(c.input, 0), An1.round(c.loss, 0), An1.round(c.lossPct, 2), c.motivos.join(' · '), c.source]) });
    if (fermR && fermR.n) hojas.push({ nombre: 'Fermentación', titulo: 'Fermentaciones del periodo', sub: ctx.etiquetaPeriodo, cols: [{ h: 'Llenado', t: 's' }, { h: 'Lote', t: 's' }, { h: 'Tanque', t: 's' }, { h: 'Marca', t: 's' }, { h: 'E.O. °P', t: 'n' }, { h: 'Horas a 15 °P', t: 'n' }, { h: 'Horas a 75 %', t: 'n' }, { h: 'Atenuación %', t: 'n' }, { h: 'Fuente', t: 's' }], rows: fermR.rows.map((r) => [iso(r.t), r.lote, String(r.tq), r.brand, An1.round(r.eo, 2), An1.round(r.h15, 1), An1.round(r.h75, 1), An1.round(r.atten, 1), r.source]) });
    const nombre = `Informe_cavas_${iso(ctx.rango.to)}.xlsx`;
    try { return A.V35.excel(nombre, hojas); } catch (e) { return false; }
  }

  function copiar(texto, avisar) {
    const ok = () => avisar('Copiado. Ya puedes pegarlo en WhatsApp o en el correo.');
    const viejo = () => { try { const t = document.getElementById('anTexto'); t.focus(); t.select(); document.execCommand('copy') ? ok() : avisar('Selecciona el texto y copia con Ctrl+C.'); } catch (e) { avisar('Selecciona el texto y copia con Ctrl+C.'); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(ok, viejo); else viejo(); } catch (e) { viejo(); }
  }

  function mountInforme(ctx, el) {
    const toast = (m) => { const t = el.querySelector('#anInfToast'); if (t) { t.textContent = m; setTimeout(() => { if (t.textContent === m) t.textContent = ''; }, 5000); } };
    el.querySelectorAll('[data-inf]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.inf;
        if (k === 'print') window.print();
        else if (k === 'excel') { const r = descargarExcel(AN.contexto()); if (r === false) toast('No se pudo generar el Excel en este navegador.'); else toast('Generando Excel…'); }
        else if (k === 'copy') copiar((el.querySelector('#anTexto') || {}).value || textoPlanta(AN.contexto()), toast);
      };
    });
  }

  AN.registrar({ id: 'informe', label: 'Informe', orden: 12, render: renderInforme, mount: mountInforme });
  An1.informe = { texto: textoPlanta, excel: descargarExcel };
})();
