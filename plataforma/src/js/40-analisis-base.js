/* ============================================================
   App.Analisis · marco del «Análisis de datos»
   Reemplaza la pantalla #/analisis. Aporta: filtros globales (periodo, marcas, comparar con el periodo anterior),
   navegación por pestañas, utilidades de presentación y un registro de hallazgos automáticos.
   Las pestañas se registran desde otros archivos (41-an-*.js) con App.Analisis.registrar({...}).
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;
  const esc = (s) => (A.U && A.U.esc ? A.U.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const DAY = 86400000;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const KEY = 'cifra.analisis.v1';

  /* ---------- Formato ---------- */
  const nf = (d) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const fmt = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : nf(d).format(x));
  const fmtPct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : nf(d).format(x) + ' %');
  const fmtP = (p) => (p == null ? '—' : p < 0.001 ? '<0,001' : nf(3).format(p));
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (t) => { if (t == null) return '—'; const d = new Date(t); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
  const fmtDateTime = (t) => { if (t == null) return '—'; const d = new Date(t); return `${fmtDate(t)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const iso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
  const startOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const endOfDay = (t) => startOfDay(t) + DAY - 1;

  /* ---------- Estado y filtros ---------- */
  const PRESETS = [
    ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['90d', 'Últimos 90 días'], ['mes', 'Este mes'], ['mesant', 'Mes pasado'],
    ['anio', 'Este año'], ['todo', 'Todo el histórico'], ['custom', 'Personalizado'],
  ];
  const state = { preset: '90d', from: null, to: null, brands: [], comparar: true };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* sin almacenamiento */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ } };

  // «Ahora» = último dato disponible (el programa trabaja con cortes del Excel; así «últimos 30 días» siempre tiene datos).
  function dataEnd() {
    const ends = ['agua', 'merma', 'recuperacion', 'ferm', 'lev'].map((n) => { const e = A.DL.extent(n); return e ? e.to : null; }).filter(Boolean);
    const now = Date.now();
    const plausible = ends.filter((t) => t <= now + 7 * DAY);
    return plausible.length ? Math.max(...plausible) : now;
  }
  function range() {
    const end = endOfDay(Math.min(dataEnd(), Date.now() + 7 * DAY));
    let from, to = end;
    const p = state.preset;
    if (p === '7d') from = startOfDay(end - 6 * DAY);
    else if (p === '30d') from = startOfDay(end - 29 * DAY);
    else if (p === '90d') from = startOfDay(end - 89 * DAY);
    else if (p === 'mes') { const d = new Date(end); from = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
    else if (p === 'mesant') { const d = new Date(end); from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(); to = new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1; }
    else if (p === 'anio') from = new Date(new Date(end).getFullYear(), 0, 1).getTime();
    else if (p === 'todo') from = 0;
    else { from = state.from != null ? startOfDay(state.from) : startOfDay(end - 89 * DAY); to = state.to != null ? endOfDay(state.to) : end; }
    if (p === 'todo') { const mins = ['agua', 'merma', 'recuperacion', 'ferm', 'lev', 'aseos', 'trasiego'].map((n) => { const e = A.DL.extent(n); return e ? e.from : null; }).filter(Boolean); from = mins.length ? startOfDay(Math.min(...mins)) : end - 365 * DAY; }
    const len = to - from + 1;
    return { from, to, dias: Math.max(1, Math.round(len / DAY)), prevFrom: from - len, prevTo: from - 1 };
  }

  /* ---------- Contexto que reciben las pestañas ---------- */
  function contexto() {
    const r = range();
    const brandsAll = A.DL.brands();
    const hasBrand = (ds) => ['merma', 'recuperacion', 'trasiego', 'ferm', 'lev'].includes(ds);
    const pick = (ds, from, to) => A.DL.filterRows(A.DL.get(ds), { from, to, where: hasBrand(ds) && state.brands.length ? (x) => state.brands.includes(x.brand) : null });
    const ctx = {
      estado: state, rango: r, marcasTodas: brandsAll,
      marcas: state.brands.length ? state.brands : brandsAll,
      filtraMarca: state.brands.length > 0,
      rows: (ds) => pick(ds, r.from, r.to),
      previas: (ds) => (state.comparar ? pick(ds, r.prevFrom, r.prevTo) : []),
      todas: (ds) => A.DL.get(ds),
      fmt, fmtPct, fmtP, fmtDate, fmtDateTime, esc, iso,
      metas: A.Metas,
    };
    ctx.etiquetaPeriodo = `${fmtDate(r.from)} – ${fmtDate(r.to)}`;
    return ctx;
  }

  /* ---------- Bloques de presentación reutilizables ---------- */
  const UI = {
    esc, fmt, fmtPct,
    card(titulo, sub, cuerpo, o = {}) {
      return `<section class="an-card ${o.cls || ''}" ${o.id ? `id="${esc(o.id)}"` : ''}>
        <header class="an-card-h"><div><h3>${esc(titulo)}</h3>${sub ? `<p>${sub}</p>` : ''}</div>${o.acciones ? `<div class="an-card-a">${o.acciones}</div>` : ''}</header>
        <div class="an-card-b">${cuerpo}</div>${o.pie ? `<footer class="an-card-f">${o.pie}</footer>` : ''}</section>`;
    },
    grid(items, cols = 2) { return `<div class="an-grid an-g${cols}">${items.join('')}</div>`; },
    vacio(msg) { return `<div class="an-empty"><b>Sin datos para mostrar</b><span>${esc(msg || 'Prueba con otro periodo o quita el filtro de marca.')}</span></div>`; },
    /** Explicación en lenguaje claro bajo una gráfica. */
    lectura(html, tono) { return `<p class="an-note ${tono || ''}"><b>Cómo leerlo</b> ${html}</p>`; },
    badge(txt, tono) { return `<span class="an-badge ${tono || ''}">${esc(txt)}</span>`; },
    delta(actual, previo, { bueno = 'baja', dec = 1, unidad = '' } = {}) {
      if (actual == null || previo == null || !Number.isFinite(actual) || !Number.isFinite(previo) || previo === 0) return '';
      const d = ((actual - previo) / Math.abs(previo)) * 100;
      if (Math.abs(d) < 0.05) return '<span class="an-delta">sin cambio</span>';
      const sube = d > 0, ok = (bueno === 'baja') === !sube;
      return `<span class="an-delta ${ok ? 'ok' : 'bad'}">${sube ? '▲' : '▼'} ${fmt(Math.abs(d), dec)} %${unidad ? ' ' + unidad : ''}</span>`;
    },
    kpi(o) {
      if (A.Charts && A.Charts.kpi) return A.Charts.kpi(o);
      return `<article class="an-kpi"><span>${esc(o.label)}</span><b>${esc(o.value)}<small>${esc(o.unit || '')}</small></b>${o.help ? `<p>${esc(o.help)}</p>` : ''}</article>`;
    },
    /** Tabla ordenable con exportación. cols: [{k,t,f?:fn(valor,fila)->html|texto, num?:true, w?}] */
    tabla(cols, rows, o = {}) {
      const max = o.max || 25, id = o.id || 'tb' + Math.random().toString(36).slice(2, 7);
      TABLAS[id] = { cols, rows, sort: o.sort || null, max, nombre: o.nombre || 'tabla' };
      return tablaHtml(id);
    },
  };
  const TABLAS = {};
  function tablaHtml(id) {
    const T = TABLAS[id];
    let rows = T.rows.slice();
    if (T.sort) { const { k, dir } = T.sort; rows.sort((a, b) => { const x = a[k], y = b[k]; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * dir; }); }
    const shown = rows.slice(0, T.expandida ? 500 : T.max);
    return `<div class="an-tabla" id="${id}"><div class="an-tabla-s"><table><thead><tr>${T.cols.map((c) => `<th ${c.num ? 'class="n"' : ''} data-sort="${esc(c.k)}">${esc(c.t)}${T.sort && T.sort.k === c.k ? (T.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((r) => `<tr ${r.source ? `title="${esc(r.source)}"` : ''}>${T.cols.map((c) => `<td ${c.num ? 'class="n"' : ''}>${c.f ? c.f(r[c.k], r) : esc(r[c.k] == null ? '—' : r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="an-tabla-f"><span>${rows.length} fila${rows.length === 1 ? '' : 's'}${rows.length > shown.length ? ` · mostrando ${shown.length}` : ''}</span>
      ${rows.length > T.max ? `<button type="button" class="an-link" data-tb-mas="${id}">${T.expandida ? 'Ver menos' : 'Ver más'}</button>` : ''}
      <button type="button" class="an-link" data-tb-csv="${id}">Descargar CSV</button><button type="button" class="an-link" data-tb-xls="${id}">Descargar Excel</button></div></div>`;
  }
  function csvDe(T) {
    const q = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [T.cols.map((c) => q(c.t)).join(';'), ...T.rows.map((r) => T.cols.map((c) => q(r[c.k] == null ? '' : r[c.k])).join(';'))].join('\n');
  }
  function descargar(nombre, contenido, tipo) {
    const url = URL.createObjectURL(contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo || 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- Registro de pestañas y hallazgos ---------- */
  const pestanas = [];
  const registrar = (p) => { const i = pestanas.findIndex((x) => x.id === p.id); if (i >= 0) pestanas[i] = p; else pestanas.push(p); pestanas.sort((a, b) => (a.orden || 99) - (b.orden || 99)); };

  /** Reúne los hallazgos que cada pestaña declara en p.hallazgos(ctx) → [{sev:'alta'|'media'|'info'|'ok', titulo, detalle, tab, valor?}] */
  function hallazgos(ctx) {
    const out = [];
    for (const p of pestanas) {
      if (!p.hallazgos) continue;
      try { for (const h of p.hallazgos(ctx) || []) out.push(Object.assign({ tab: p.id, area: p.label }, h)); } catch (e) { if (window.console) console.error('[Analisis] hallazgos', p.id, e); }
    }
    const orden = { alta: 0, media: 1, info: 2, ok: 3 };
    return out.sort((a, b) => (orden[a.sev] ?? 9) - (orden[b.sev] ?? 9));
  }

  /* ---------- Vista ---------- */
  let tabActual = 'resumen';
  const rutaTab = (arg) => { const t = arg && arg[0]; return pestanas.some((p) => p.id === t) ? t : pestanas.length ? pestanas[0].id : 'resumen'; };

  function filtrosHtml(ctx) {
    const r = ctx.rango;
    return `<div class="an-filtros" role="group" aria-label="Filtros del análisis">
      <label class="an-f"><span>Periodo</span><select id="anPreset">${PRESETS.map(([k, l]) => `<option value="${k}" ${state.preset === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="an-f an-f-d" ${state.preset === 'custom' ? '' : 'hidden'}><span>Desde</span><input type="date" id="anFrom" value="${iso(r.from)}"></label>
      <label class="an-f an-f-d" ${state.preset === 'custom' ? '' : 'hidden'}><span>Hasta</span><input type="date" id="anTo" value="${iso(r.to)}"></label>
      <div class="an-f an-f-m"><span>Marca</span><div class="an-chips">${ctx.marcasTodas.map((m) => `<button type="button" class="an-chip" data-marca="${esc(m)}" aria-pressed="${state.brands.includes(m)}">${esc(m)}</button>`).join('')}${state.brands.length ? '<button type="button" class="an-chip an-chip-x" data-marca="*">Todas</button>' : ''}</div></div>
      <label class="an-f an-f-c"><input type="checkbox" id="anComparar" ${state.comparar ? 'checked' : ''}><span>Comparar con el periodo anterior</span></label>
      <p class="an-rango"><b>${esc(ctx.etiquetaPeriodo)}</b> · ${r.dias} días${state.comparar ? ` · comparado con ${esc(fmtDate(r.prevFrom))} – ${esc(fmtDate(r.prevTo))}` : ''}</p></div>`;
  }
  function tabsHtml(act) {
    return `<nav class="an-tabs" aria-label="Secciones del análisis">${pestanas.map((p) => `<a href="#/analisis/${p.id}" class="${p.id === act ? 'on' : ''}" ${p.id === act ? 'aria-current="page"' : ''}>${esc(p.label)}</a>`).join('')}</nav>`;
  }
  function cuerpo(tab) {
    const p = pestanas.find((x) => x.id === tab);
    if (!p) return UI.vacio('Esta sección todavía no está disponible.');
    const ctx = contexto();
    try { return p.render(ctx, UI); } catch (e) { if (window.console) console.error('[Analisis]', tab, e); return `<div class="an-empty"><b>No se pudo calcular esta sección</b><span>${esc(e.message)}</span></div>`; }
  }
  function render(...arg) {
    tabActual = rutaTab(arg);
    const ctx = contexto();
    return `<div class="an-root" data-tab="${tabActual}">
      <header class="an-head"><span class="an-kicker">ANÁLISIS DE DATOS</span><h1>Análisis<span>. Entiende el proceso. Decide con evidencia.</span></h1>
      <p>Agua, merma, fermentación, levadura, recuperación, trasiego y aseos en un solo lugar, con estadística explicada en palabras claras.</p></header>
      ${filtrosHtml(ctx)}${tabsHtml(tabActual)}<div class="an-body" id="anBody">${cuerpo(tabActual)}</div>
      <p class="an-pie">Los datos salen de tus Excel y de lo capturado en la plataforma. Pasa el cursor sobre una fila o un punto para ver su origen. Los cálculos estadísticos se detallan en la sección <a href="#/analisis/calidad">Calidad de datos</a>.</p></div>`;
  }

  function repintarCuerpo() {
    const el = document.getElementById('anBody');
    if (!el) return;
    el.innerHTML = cuerpo(tabActual);
    montarCuerpo(el);
    const rg = document.querySelector('.an-rango');
    if (rg) { const c = contexto(); rg.innerHTML = `<b>${esc(c.etiquetaPeriodo)}</b> · ${c.rango.dias} días${state.comparar ? ` · comparado con ${esc(fmtDate(c.rango.prevFrom))} – ${esc(fmtDate(c.rango.prevTo))}` : ''}`; }
    document.querySelectorAll('.an-chip[data-marca]').forEach((b) => { if (b.dataset.marca !== '*') b.setAttribute('aria-pressed', String(state.brands.includes(b.dataset.marca))); });
  }

  function montarCuerpo(el) {
    el.querySelectorAll('[data-tb-mas]').forEach((b) => { b.onclick = () => { const T = TABLAS[b.dataset.tbMas]; T.expandida = !T.expandida; document.getElementById(b.dataset.tbMas).outerHTML = tablaHtml(b.dataset.tbMas); montarCuerpo(document.getElementById('anBody')); }; });
    el.querySelectorAll('[data-sort]').forEach((th) => { th.onclick = () => { const id = th.closest('.an-tabla').id, T = TABLAS[id], k = th.dataset.sort; T.sort = T.sort && T.sort.k === k ? { k, dir: -T.sort.dir } : { k, dir: 1 }; document.getElementById(id).outerHTML = tablaHtml(id); montarCuerpo(document.getElementById('anBody')); }; });
    el.querySelectorAll('[data-tb-csv]').forEach((b) => { b.onclick = () => { const T = TABLAS[b.dataset.tbCsv]; descargar(T.nombre + '.csv', csvDe(T), 'text/csv;charset=utf-8'); }; });
    el.querySelectorAll('[data-tb-xls]').forEach((b) => { b.onclick = () => {
      const T = TABLAS[b.dataset.tbXls];
      try { A.V35.excel(T.nombre + '.xlsx', [{ nombre: T.nombre.slice(0, 28), titulo: T.nombre, sub: contexto().etiquetaPeriodo, cols: T.cols.map((c) => ({ h: c.t, t: c.num ? 'n' : 's' })), rows: T.rows.map((r) => T.cols.map((c) => (r[c.k] == null ? null : r[c.k]))) }]); }
      catch (e) { descargar(T.nombre + '.csv', csvDe(T), 'text/csv;charset=utf-8'); }
    }; });
    const p = pestanas.find((x) => x.id === tabActual);
    if (p && p.mount) { try { p.mount(contexto(), el, UI); } catch (e) { if (window.console) console.error('[Analisis] mount', e); } }
  }

  function mount(_arg, repintar) {
    const q = (id) => document.getElementById(id);
    if (!q('anPreset')) return;
    q('anPreset').onchange = (e) => { state.preset = e.target.value; persist(); if (state.preset === 'custom') { const r = range(); state.from = r.from; state.to = r.to; persist(); } actualizarFiltros(); repintarCuerpo(); };
    const f = q('anFrom'), t = q('anTo');
    if (f) f.onchange = () => { state.from = parseIso(f.value); persist(); repintarCuerpo(); };
    if (t) t.onchange = () => { state.to = parseIso(t.value); persist(); repintarCuerpo(); };
    q('anComparar').onchange = (e) => { state.comparar = e.target.checked; persist(); repintarCuerpo(); };
    document.querySelectorAll('.an-chip[data-marca]').forEach((b) => b.addEventListener('click', () => {
      const m = b.dataset.marca;
      if (m === '*') state.brands = []; else state.brands = state.brands.includes(m) ? state.brands.filter((x) => x !== m) : [...state.brands, m];
      persist();
      document.querySelector('.an-filtros').outerHTML = filtrosHtml(contexto());
      mount(null, true);
    }));
    if (repintar) repintarCuerpo(); else montarCuerpo(q('anBody'));
  }
  function actualizarFiltros() {
    const custom = state.preset === 'custom';
    document.querySelectorAll('.an-f-d').forEach((e) => { e.hidden = !custom; });
    const r = range(); const f = document.getElementById('anFrom'), t = document.getElementById('anTo');
    if (f) f.value = iso(r.from); if (t) t.value = iso(r.to);
  }

  A.Analisis = { registrar, hallazgos, contexto, range, state, UI, fmt, fmtPct, fmtP, fmtDate, fmtDateTime, esc, iso, descargar, repintar: repintarCuerpo, pestanas, render, mount };
  A.V.analisis = { render, mount };
})();
