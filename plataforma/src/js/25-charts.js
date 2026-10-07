/* ============================================================
   25-charts.js · Gráficos SVG minimalistas (sin dependencias)
   window.App.Charts.{line,bars,barsH,stacked,histogram,scatter,box,
   heatmap,control,pareto,spark,sparkBars,donut,gauge,waterfall,gantt,
   calendar,kpi,niceScale,fmt,palette,svgToPng,download,toolbar}
   Todas devuelven un string HTML (<figure class="ch">…</figure>).
   Colores solo vía variables CSS (ver 26-charts.css).
   ============================================================ */
(function () {
  'use strict';
  window.App = window.App || {};

  /* ---------- utilidades básicas ---------- */
  const palette = [
    'var(--ink,#171717)', 'var(--est,#5d6f8c)', 'var(--warn,#a26a14)', 'var(--pos,#3b7a59)',
    '#8a8a84', 'var(--neg,#b0442e)', '#7a6f9a', '#5f8f8b'
  ];
  const C_INK = 'var(--ink,#171717)', C_EST = 'var(--est,#5d6f8c)', C_WARN = 'var(--warn,#a26a14)',
    C_POS = 'var(--pos,#3b7a59)', C_NEG = 'var(--neg,#b0442e)', C_MUTED = 'var(--muted,#6b6b66)';
  const col = (c, i) => c || palette[i % palette.length];
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = v => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(+v);
  const R = v => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const tw = (s, sz) => String(s).length * (sz || 11) * 0.57;
  const trunc = (s, max) => { s = String(s == null ? '' : s); return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s; };
  const A = o => Object.keys(o).filter(k => o[k] !== undefined && o[k] !== null && o[k] !== false)
    .map(k => ' ' + k + '="' + esc(o[k]) + '"').join('');
  const el = (t, a, inner) => inner === undefined ? '<' + t + A(a) + '/>' : '<' + t + A(a) + '>' + inner + '</' + t + '>';
  const tx = (x, y, s, cls, anchor, extra) =>
    el('text', Object.assign({ class: 'ch-t' + (cls ? ' ' + cls : ''), x: R(x), y: R(y), 'text-anchor': anchor || null }, extra || {}), esc(s));
  const tip = s => el('title', {}, esc(s));
  const lin = (d0, d1, r0, r1) => v => d1 === d0 ? (r0 + r1) / 2 : r0 + (v - d0) / (d1 - d0) * (r1 - r0);
  const nums = a => (a || []).filter(isNum).map(Number);
  const sum = a => a.reduce((s, v) => s + v, 0);
  const mean = a => a.length ? sum(a) / a.length : NaN;
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map(v => (v - m) ** 2)) / (a.length - 1)); };
  const quant = (s, p) => { if (!s.length) return NaN; const i = (s.length - 1) * p, f = Math.floor(i), c = Math.ceil(i); return s[f] + (s[c] - s[f]) * (i - f); };

  /* ---------- formato es-CO ---------- */
  const nfCache = {};
  function fmt(n, dec) {
    if (!isNum(n)) return '—';
    const k = dec == null ? 'a' : dec;
    if (!nfCache[k]) {
      try {
        nfCache[k] = new Intl.NumberFormat('es-CO', dec == null ? { maximumFractionDigits: 2 } : { minimumFractionDigits: dec, maximumFractionDigits: dec });
      } catch (e) { nfCache[k] = { format: v => String(v) }; }
    }
    return nfCache[k].format(+n);
  }
  const pct = (v, d) => fmt(v * 100, d == null ? 0 : d) + '%';
  const decFor = step => { let d = 0; while (d < 4 && Math.abs(step * Math.pow(10, d) - Math.round(step * Math.pow(10, d))) > 1e-9) d++; return d; };

  /* ---------- escala "bonita" ---------- */
  function niceNum(x, round) {
    const e = Math.floor(Math.log10(x)), f = x / Math.pow(10, e);
    const n = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
    return n * Math.pow(10, e);
  }
  function niceScale(min, max, ticks) {
    ticks = ticks || 5;
    min = +min; max = +max;
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
    if (min > max) { const t = min; min = max; max = t; }
    if (min === max) { const p = min === 0 ? 1 : Math.abs(min) * 0.1; min -= p; max += p; }
    const step = niceNum(niceNum(max - min, false) / Math.max(1, ticks - 1), true);
    const nmin = Math.floor(min / step + 1e-9) * step, nmax = Math.ceil(max / step - 1e-9) * step;
    const out = [];
    for (let v = nmin, i = 0; v <= nmax + step / 2 && i < 100; v += step, i++) out.push(+v.toFixed(10));
    return { min: +nmin.toFixed(10), max: +nmax.toFixed(10), step, ticks: out };
  }
  const tickFmt = (o, sc) => o.yFmt || (v => fmt(v, decFor(sc.step)));
  const withUnit = (o, s) => s + (o.unit ? ' ' + o.unit : '');

  /* ---------- fechas / ticks de tiempo ---------- */
  const toMs = v => {
    if (v instanceof Date) return v.getTime();
    if (isNum(v)) return +v;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const t = Date.parse(v); return Number.isFinite(t) ? t : NaN;
  };
  const p2 = n => (n < 10 ? '0' : '') + n;
  function dateLabel(ms, full) {
    const d = new Date(ms);
    let s = d.getDate() + ' ' + MES[d.getMonth()] + (full ? ' ' + d.getFullYear() : '');
    if (full && (d.getHours() || d.getMinutes())) s += ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    return s;
  }
  function timeTicks(min, max, maxN) {
    if (max <= min) { min -= 432e5; max += 432e5; }
    const H = 36e5, D = 24 * H, span = max - min;
    const steps = [[1, 'h'], [3, 'h'], [6, 'h'], [12, 'h'], [1, 'd'], [2, 'd'], [7, 'd'], [14, 'd'], [1, 'M'], [3, 'M'], [6, 'M'], [1, 'y'], [2, 'y'], [5, 'y'], [10, 'y']];
    const ap = (k, u) => k * (u === 'h' ? H : u === 'd' ? D : u === 'M' ? 30.4 * D : 365.25 * D);
    let st = steps[steps.length - 1];
    for (const s of steps) if (span / ap(s[0], s[1]) <= maxN) { st = s; break; }
    const k = st[0], u = st[1], d = new Date(min);
    if (u === 'h') { d.setMinutes(0, 0, 0); d.setHours(Math.floor(d.getHours() / k) * k); }
    else if (u === 'd') { d.setHours(0, 0, 0, 0); }
    else if (u === 'M') { d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(Math.floor(d.getMonth() / k) * k); }
    else { d.setMonth(0, 1); d.setHours(0, 0, 0, 0); d.setFullYear(Math.floor(d.getFullYear() / k) * k); }
    const ticks = [];
    for (let i = 0; i < 400 && d.getTime() <= max; i++) {
      if (d.getTime() >= min) ticks.push(d.getTime());
      if (u === 'h') d.setHours(d.getHours() + k); else if (u === 'd') d.setDate(d.getDate() + k);
      else if (u === 'M') d.setMonth(d.getMonth() + k); else d.setFullYear(d.getFullYear() + k);
    }
    const label = ms => {
      const x = new Date(ms);
      if (u === 'h') return x.getHours() === 0 ? dateLabel(ms) : p2(x.getHours()) + ':' + p2(x.getMinutes());
      if (u === 'd') return dateLabel(ms);
      if (u === 'M') return x.getMonth() === 0 ? MES[0] + ' ' + String(x.getFullYear()).slice(2) : MES[x.getMonth()];
      return String(x.getFullYear());
    };
    return { ticks, label };
  }

  /* ---------- estructura común: figure / vacío ---------- */
  let uid = 0;
  function toolbar(id) {
    const f = id ? { 'data-ch-for': id } : {};
    return el('span', Object.assign({ class: 'ch-tb' }, f),
      el('button', { type: 'button', class: 'ch-btn', 'data-ch-dl': 'png', 'aria-label': 'Descargar gráfica como PNG' }, 'PNG') +
      el('button', { type: 'button', class: 'ch-btn', 'data-ch-dl': 'svg', 'aria-label': 'Descargar gráfica como SVG' }, 'SVG'));
  }
  function head(o) {
    if (!o.title && !o.subtitle && !o.toolbar) return '';
    return '<div class="ch-head"><div class="ch-hd">' +
      (o.title ? '<div class="ch-title">' + esc(o.title) + '</div>' : '') +
      (o.subtitle ? '<div class="ch-sub">' + esc(o.subtitle) + '</div>' : '') +
      '</div>' + (o.toolbar ? toolbar(o.id) : '') + '</div>';
  }
  function legendHtml(items) {
    items = (items || []).filter(i => i && i.name);
    if (!items.length) return '';
    return '<ul class="ch-legend">' + items.map(i => '<li style="--c:' + esc(i.color) + '"><i class="ch-sw' + (i.dashed ? ' ch-sw-d' : '') + (i.box ? ' ch-sw-b' : '') + '"></i>' + esc(i.name) + '</li>').join('') + '</ul>';
  }
  function fig(o, kind, W, H, inner, x) {
    x = x || {};
    const label = (o.title ? o.title + '. ' : '') + (x.aria || 'Gráfica');
    return '<figure class="ch ch-k-' + kind + (x.cls ? ' ' + x.cls : '') + '"' + A({ id: o.id }) + '>' + head(o) + legendHtml(x.legend) +
      '<svg class="ch-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + R(W) + ' ' + R(H) + '" role="img" aria-label="' + esc(label) + '" preserveAspectRatio="xMidYMid meet">' +
      inner + '</svg>' + (x.note ? '<figcaption class="ch-note">' + x.note + '</figcaption>' : '') + '</figure>';
  }
  function emptyFig(o, W, H) {
    o = o || {}; W = W || o.w || 720; H = H || o.h || 300;
    const cx = W / 2, cy = H / 2, msg = o.empty || 'Sin datos';
    const inner = '<g class="ch-empty-ic" transform="translate(' + R(cx - 14) + ' ' + R(cy - 34) + ')">' +
      '<rect x="2" y="2" width="24" height="24" rx="6"/><path d="M7 19l5-5 4 3 6-7"/></g>' +
      tx(cx, cy + 20, msg, 'ch-empty-t', 'middle');
    return fig(o, 'empty', W, H, inner, { aria: msg, cls: 'ch-is-empty' });
  }
  const safe = (name, fn) => function (o) {
    o = o || {};
    try { return fn(o); } catch (e) { return emptyFig(o); }
  };

  /* ---------- ejes compartidos ---------- */
  function orient(horiz, x0, y0, x1, y1, n, sc) {
    const slot = (horiz ? y1 - y0 : x1 - x0) / Math.max(1, n);
    const V = horiz ? lin(sc.min, sc.max, x0, x1) : lin(sc.min, sc.max, y1, y0);
    const Cc = (i, off) => (horiz ? y0 : x0) + (i + (off == null ? 0.5 : off)) * slot;
    return { horiz, x0, y0, x1, y1, slot, V, C: Cc };
  }
  function valueAxis(O, sc, f, zeroLine) {
    let s = '';
    sc.ticks.forEach(t => {
      const p = O.V(t), isz = zeroLine && t === 0;
      if (O.horiz) {
        s += el('line', { class: isz ? 'ch-axis' : 'ch-grid', x1: R(p), x2: R(p), y1: R(O.y0), y2: R(O.y1) });
        const w = tw(f(t)), an = p - w / 2 < 0 ? 'start' : 'middle';
        s += tx(p, O.y1 + 16, f(t), '', an);
      } else {
        s += el('line', { class: isz ? 'ch-axis' : 'ch-grid', x1: R(O.x0), x2: R(O.x1), y1: R(p), y2: R(p) });
        s += tx(O.x0 - 8, p + 3.5, f(t), '', 'end');
      }
    });
    return s;
  }
  function wrapLabel(s, maxc) {
    s = String(s == null ? '' : s);
    if (s.length <= maxc) return [s];
    const w = s.split(/\s+/); let a = '', i = 0;
    while (i < w.length && (a + ' ' + w[i]).trim().length <= maxc) { a = (a + ' ' + w[i]).trim(); i++; }
    if (!a) return [trunc(s, maxc)];
    return [a, trunc(w.slice(i).join(' '), maxc)];
  }
  function catLabels(O, labels, maxLines) {
    let s = '';
    if (O.horiz) {
      const mc = Math.floor((O.x0 - 14) / 6.2);
      labels.forEach((l, i) => { s += el('text', { class: 'ch-t ch-t-ink', x: R(O.x0 - 8), y: R(O.C(i) + 3.5), 'text-anchor': 'end' }, esc(trunc(l, mc)) + (String(l).length > mc ? tip(l) : '')); });
      return s;
    }
    const maxc = Math.max(3, Math.floor(O.slot / 6.2));
    const maxW = Math.max.apply(null, labels.map(l => tw(wrapLabel(l, maxc)[0])).concat([1]));
    const every = maxLines > 1 || O.slot >= maxW + 6 ? 1 : Math.ceil((maxW + 8) / O.slot);
    labels.forEach((l, i) => {
      if (i % every) return;
      const ls = every > 1 ? [trunc(l, Math.max(3, Math.floor(O.slot * every / 6.2)))] : wrapLabel(l, maxc).slice(0, maxLines || 2);
      const x = O.C(i);
      s += el('text', { class: 'ch-t', x: R(x), y: R(O.y1 + 16), 'text-anchor': 'middle' },
        ls.map((t, k) => '<tspan x="' + R(x) + '" dy="' + (k ? 13 : 0) + '">' + esc(t) + '</tspan>').join('') + (ls.join('') !== String(l) ? tip(l) : ''));
    });
    return s;
  }
  function labelLines(labels, slot) {
    const maxc = Math.max(3, Math.floor(slot / 6.2));
    return Math.min(2, Math.max.apply(null, labels.map(l => wrapLabel(l, maxc).length).concat([1])));
  }
  function refsLayer(O, refs, o) {
    let s = '';
    (refs || []).forEach(r => {
      if (!isNum(r.y)) return;
      const p = O.V(+r.y), c = r.color || null;
      const st = c ? { style: '--c:' + c } : {};
      if (O.horiz) {
        s += el('line', Object.assign({ class: 'ch-ref' + (r.dashed === false ? '' : ' ch-dash'), x1: R(p), x2: R(p), y1: R(O.y0), y2: R(O.y1) }, st));
        if (r.label) s += tx(p + 4, O.y0 + 10, r.label, 'ch-ref-t', 'start', st);
      } else {
        s += el('line', Object.assign({ class: 'ch-ref' + (r.dashed === false ? '' : ' ch-dash'), x1: R(O.x0), x2: R(O.x1), y1: R(p), y2: R(p) }, st));
        if (r.label) s += tx(O.x1 - 4, p - 5, r.label, 'ch-ref-t', 'end', st);
      }
    });
    return s;
  }
  const unitTop = (o, x, y) => o.unit ? tx(x, y, o.unit, 'ch-unit', 'start') : '';

  /* ============================================================
     1. line
     ============================================================ */
  const line = safe('line', function (o) {
    const W = o.w || 720, H = o.h || 300, xType = o.xType || 'category';
    const series = (o.series || []).map((s, si) => ({
      s, name: s.name || ('Serie ' + (si + 1)), color: col(s.color, si),
      pts: Array.isArray(s.points) ? s.points.map((p, i) => ({ x: p.x == null ? i : p.x, y: p.y, label: p.label }))
        : (s.data || []).map((y, i) => ({ x: i, y }))
    }));
    if (!series.some(s => s.pts.some(p => isNum(p.y)))) return emptyFig(o);
    // eje X
    const cats = (o.xLabels || []).map(String);
    let nCat = cats.length;
    series.forEach(s => s.pts.forEach(p => {
      if (xType === 'time') p.xv = toMs(p.x);
      else if (xType === 'linear') p.xv = +p.x;
      else if (isNum(p.x) && (typeof p.x === 'number')) { p.xv = +p.x; nCat = Math.max(nCat, p.xv + 1); }
      else {
        let i = cats.indexOf(String(p.x));
        if (i < 0) { cats.push(String(p.x)); i = cats.length - 1; }
        p.xv = i; nCat = Math.max(nCat, cats.length);
      }
    }));
    if (xType === 'category') series.forEach(s => s.pts.forEach(p => { if (!cats[p.xv] && p.label !== undefined && !o.xLabels) cats[p.xv] = String(p.label); }));
    series.forEach(s => { s.pts = s.pts.filter(p => Number.isFinite(p.xv)); });
    const catLab = i => (o.xFmt ? o.xFmt(cats[i] != null ? cats[i] : i + 1) : (cats[i] != null ? cats[i] : String(i + 1)));
    // dominio Y
    let ys = [];
    series.forEach(s => s.pts.forEach(p => { if (isNum(p.y)) ys.push(+p.y); }));
    const band = o.band && o.band.lo && o.band.hi ? o.band : null;
    if (band) ys = ys.concat(nums(band.lo), nums(band.hi));
    (o.refs || []).forEach(r => { if (isNum(r.y)) ys.push(+r.y); });
    let ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    const anyArea = series.some(s => s.s.area);
    if (anyArea || (ymin >= 0 && ymin <= ymax * 0.35)) ymin = Math.min(0, ymin);
    const ysc = niceScale(ymin, ymax, 5), yf = tickFmt(o, ysc);
    const ml = Math.max(34, Math.max.apply(null, ysc.ticks.map(t => tw(yf(t)))) + 16);
    const mt = 14 + (o.unit ? 12 : 0) + ((o.annotations || []).length ? 14 : 0), mb = 28, mr = 20;
    const x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb, pw = x1 - x0;
    const Y = lin(ysc.min, ysc.max, y1, y0);
    // dominio X
    let xmin, xmax, xticks = [], xlab;
    const padX = 10;
    if (xType === 'category') {
      xmin = 0; xmax = Math.max(1, nCat - 1);
      if (nCat <= 1) { xmin = -0.5; xmax = 0.5; }
      const maxW = Math.max.apply(null, Array.from({ length: nCat }, (_, i) => tw(catLab(i))).concat([1]));
      const every = Math.max(1, Math.ceil(nCat / Math.max(1, Math.floor(pw / (maxW + 12)))));
      for (let i = 0; i < nCat; i += every) xticks.push(i);
      xlab = catLab;
    } else {
      const xs = []; series.forEach(s => s.pts.forEach(p => xs.push(p.xv)));
      xmin = Math.min.apply(null, xs); xmax = Math.max.apply(null, xs);
      if (xType === 'time') {
        if (xmax === xmin) { xmin -= 432e5; xmax += 432e5; }
        const tt = timeTicks(xmin, xmax, Math.max(2, Math.floor(pw / 80)));
        xticks = tt.ticks; xlab = o.xFmt || tt.label;
      } else {
        const ns = niceScale(xmin, xmax, Math.max(3, Math.floor(pw / 90)));
        xmin = ns.min; xmax = ns.max; xticks = ns.ticks;
        const f = o.xFmt || (v => fmt(v, decFor(ns.step))); xlab = f;
      }
    }
    const X = lin(xmin, xmax, x0 + padX, x1 - padX);
    const tipX = v => xType === 'time' ? dateLabel(v, true) : xType === 'linear' ? (o.xFmt ? o.xFmt(v) : fmt(v)) : catLab(v);
    let g = '';
    g += valueAxis({ horiz: false, x0, x1, y0, y1, V: Y }, ysc, yf, true);
    g += unitTop(o, 0, 11);
    // eje x
    xticks.forEach(t => {
      const x = X(t), s = xlab(t), w = tw(s), an = x - w / 2 < 0 ? 'start' : x + w / 2 > W ? 'end' : 'middle';
      g += el('line', { class: 'ch-tick', x1: R(x), x2: R(x), y1: R(y1), y2: R(y1 + 4) }) + tx(x, y1 + 17, s, '', an);
    });
    // banda
    if (band) {
      const xsAll = Array.from(new Set([].concat.apply([], series.map(s => s.pts.map(p => p.xv))))).sort((a, b) => a - b);
      const n = Math.max(band.lo.length, band.hi.length);
      let seg = [];
      const segs = [];
      for (let i = 0; i < n; i++) {
        const l = band.lo[i], h = band.hi[i], xv = xsAll[i] != null ? xsAll[i] : i;
        if (isNum(l) && isNum(h)) seg.push([X(xv), Y(+l), Y(+h)]);
        else if (seg.length) { segs.push(seg); seg = []; }
      }
      if (seg.length) segs.push(seg);
      segs.forEach(sg => {
        const d = 'M' + sg.map(p => R(p[0]) + ' ' + R(p[2])).join('L') + 'L' + sg.slice().reverse().map(p => R(p[0]) + ' ' + R(p[1])).join('L') + 'Z';
        g += el('path', { class: 'ch-band', d }, band.name ? tip(band.name) : undefined);
      });
    }
    g += refsLayer({ horiz: false, x0, x1, y0, y1, V: Y }, o.refs, o);
    // series
    series.forEach(s => {
      const pts = s.pts.filter(p => isNum(p.y));
      const ord = s.pts.slice().sort((a, b) => a.xv - b.xv);
      let d = '', pen = false, segs = [], cur = [];
      ord.forEach(p => {
        if (!isNum(p.y)) { if (cur.length) segs.push(cur); cur = []; return; }
        cur.push([X(p.xv), Y(+p.y)]);
      });
      if (cur.length) segs.push(cur);
      segs.forEach(sg => { d += 'M' + sg.map(p => R(p[0]) + ' ' + R(p[1])).join('L'); });
      let ar = '';
      if (s.s.area) segs.forEach(sg => { if (sg.length > 1) ar += 'M' + R(sg[0][0]) + ' ' + R(y1) + 'L' + sg.map(p => R(p[0]) + ' ' + R(p[1])).join('L') + 'L' + R(sg[sg.length - 1][0]) + ' ' + R(y1) + 'Z'; });
      const st = '--c:' + s.color + (s.s.width ? ';--w:' + s.s.width + 'px' : '');
      let inner = '';
      if (ar) inner += el('path', { class: 'ch-area', d: ar });
      inner += el('path', { class: 'ch-line' + (s.s.dashed ? ' ch-dash' : ''), d });
      const showDots = s.s.dots === true || (s.s.dots !== false && pts.length <= 40);
      if (showDots || pts.length <= 200) {
        pts.forEach(p => {
          const t = p.label != null ? String(p.label) : s.name + ' · ' + tipX(p.xv) + ': ' + withUnit(o, yf(+p.y));
          inner += '<g class="ch-pt">' + el('circle', { class: 'ch-hit', cx: R(X(p.xv)), cy: R(Y(+p.y)), r: 9 }) +
            (showDots ? el('circle', { class: 'ch-dot', cx: R(X(p.xv)), cy: R(Y(+p.y)), r: 2.6 }) : '') + tip(t) + '</g>';
        });
      }
      g += el('g', { class: 'ch-s', style: st }, inner);
    });
    // anotaciones
    (o.annotations || []).forEach(a => {
      let xv = xType === 'time' ? toMs(a.x) : xType === 'linear' ? +a.x : (isNum(a.x) ? +a.x : cats.indexOf(String(a.x)));
      if (!Number.isFinite(xv) || xv < xmin || xv > xmax) return;
      const x = X(xv), right = x + tw(a.text) + 8 > W;
      g += el('line', { class: 'ch-ann', x1: R(x), x2: R(x), y1: R(y0 - 6), y2: R(y1) }) +
        tx(right ? x - 4 : x + 4, y0 - 3, a.text, 'ch-t-ink', right ? 'end' : 'start');
    });
    const legend = series.length > 1 || band ? series.map(s => ({ name: s.name, color: s.color, dashed: s.s.dashed })).concat(band && band.name ? [{ name: band.name, color: C_EST, box: true }] : []) : [];
    const aria = 'Gráfica de líneas con ' + series.length + (series.length === 1 ? ' serie' : ' series') + ': ' + series.map(s => s.name).join(', ') +
      '. Valores entre ' + yf(Math.min.apply(null, ys)) + ' y ' + yf(Math.max.apply(null, ys)) + (o.unit ? ' ' + o.unit : '') + '.';
    return fig(o, 'line', W, H, g, { aria, legend });
  });

  /* ============================================================
     2. bars / barsH / stacked
     ============================================================ */
  function barsImpl(o, horiz, forceStacked) {
    const W = o.w || 720;
    let data = (o.data || []).slice();
    const stacked = forceStacked || !!o.stacked;
    let cats, ser, single = false;
    if (Array.isArray(o.series) && o.series.length) {
      cats = (o.categories || data.map(d => d.label)).map(String);
      ser = o.series.map((s, i) => ({ name: s.name || 'Serie ' + (i + 1), color: col(s.color, i), values: s.values || s.data || [] }));
      const n = Math.max(cats.length, Math.max.apply(null, ser.map(s => s.values.length)));
      for (let i = cats.length; i < n; i++) cats.push(String(i + 1));
    } else {
      if (o.sort) data.sort((a, b) => (o.sort === 'asc' ? 1 : -1) * ((+a.value || 0) - (+b.value || 0)));
      cats = data.map(d => String(d.label == null ? '' : d.label));
      ser = [{ name: '', color: palette[0], values: data.map(d => d.value) }];
      single = true;
    }
    const n = cats.length;
    if (!n || !ser.some(s => s.values.some(isNum))) return emptyFig(o);
    const H = o.h || (horiz ? Math.max(300, n * 26 + 48) : 300);
    const vf0 = o.yFmt || (horiz && o.xFmt) || null;
    // dominio
    let lo = 0, hi = 0;
    if (stacked) {
      for (let i = 0; i < n; i++) { let p = 0, q = 0; ser.forEach(s => { const v = isNum(s.values[i]) ? +s.values[i] : 0; v >= 0 ? p += v : q += v; }); hi = Math.max(hi, p); lo = Math.min(lo, q); }
    } else ser.forEach(s => s.values.forEach(v => { if (isNum(v)) { hi = Math.max(hi, +v); lo = Math.min(lo, +v); } }));
    (o.refs || []).forEach(r => { if (isNum(r.y)) { hi = Math.max(hi, +r.y); lo = Math.min(lo, +r.y); } });
    if (hi === 0 && lo === 0) hi = 1;
    const sc = niceScale(lo, hi, horiz ? 5 : 5), vf = vf0 || (v => fmt(v, decFor(sc.step)));
    const vlab = v => withUnit(o, (vf0 || (x => fmt(x)))(v));
    const catsL = o.xFmt && !horiz ? cats.map(c => o.xFmt(c)) : cats;
    let ml, mr, mt = 12 + (o.unit && !horiz ? 12 : 0), mb;
    if (horiz) {
      ml = Math.min(W * 0.4, Math.max.apply(null, catsL.map(l => tw(trunc(l, 30)))) + 16);
      const mv = o.labels === false ? 0 : Math.max.apply(null, cats.map((_, i) => tw(vlab(stacked ? sum(ser.map(s => +s.values[i] || 0)) : +ser[0].values[i] || 0))));
      mr = Math.max(20, mv + 14); mb = 26; ml = Math.max(ml, 20);
    } else {
      ml = Math.max(34, Math.max.apply(null, sc.ticks.map(t => tw(vf(t)))) + 16); mr = 16;
      const slot0 = (W - ml - mr) / n;
      mb = 14 + 13 * labelLines(catsL, slot0) + 6;
    }
    const x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;
    const O = orient(horiz, x0, y0, x1, y1, n, sc);
    let g = valueAxis(O, sc, vf, true);
    if (!horiz) g += unitTop(o, 0, 11);
    g += refsLayer(O, o.refs, o);
    const gw = Math.min(O.slot * (stacked || ser.length === 1 ? 0.62 : 0.78), horiz ? 22 : 64);
    const nb = stacked ? 1 : ser.length;
    const bw = (gw - (nb - 1) * 2) / nb;
    const rect = (ci, k, va, vb, color, t, i) => {
      const c0 = O.C(ci, 0.5) - gw / 2 + k * (bw + 2);
      const a = O.V(va), b = O.V(vb);
      const len = Math.max(Math.abs(b - a), (va === vb ? 0 : 1)), s0 = Math.min(a, b);
      const rr = Math.min(3, bw / 2, len / 2);
      const at = horiz ? { x: R(s0), y: R(c0), width: R(len), height: R(bw) } : { x: R(c0), y: R(s0), width: R(bw), height: R(len) };
      return el('rect', Object.assign({ class: 'ch-bar' + (stacked && ser.length > 1 ? ' ch-seg' : ''), rx: R(rr), style: '--c:' + color }, at), tip(t));
    };
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0, tot = 0;
      ser.forEach((s, k) => {
        const v = s.values[i]; if (!isNum(v)) return; const val = +v;
        const color = single ? (data[i] && data[i].color) || palette[0] : s.color;
        const t = (single ? catsL[i] : catsL[i] + ' · ' + s.name) + ': ' + vlab(val) + (single && data[i] && data[i].note ? ' — ' + data[i].note : '');
        if (stacked) {
          const a = val >= 0 ? pos : neg, b = a + val;
          g += rect(i, 0, a, b, color, t); val >= 0 ? pos = b : neg = b; tot += val;
        } else {
          g += rect(i, k, 0, val, color, t);
          if (o.labels !== false && (single ? true : bw > 20)) {
            const e = O.V(val), vt = (vf0 || (x => fmt(x)))(val);
            if (horiz) g += tx(val >= 0 ? e + 6 : e - 6, O.C(i) - gw / 2 + k * (bw + 2) + bw / 2 + 3.5, vt, 'ch-t-ink ch-vl', val >= 0 ? 'start' : 'end');
            else g += tx(O.C(i) - gw / 2 + k * (bw + 2) + bw / 2, val >= 0 ? e - 6 : e + 14, vt, 'ch-t-ink ch-vl', 'middle');
          }
        }
      });
      if (stacked && o.labels !== false) {
        const e = O.V(pos), vt = (vf0 || (x => fmt(x)))(tot);
        if (horiz) g += tx(e + 6, O.C(i) + 3.5, vt, 'ch-t-ink ch-vl', 'start');
        else g += tx(O.C(i), e - 6, vt, 'ch-t-ink ch-vl', 'middle');
      }
    }
    g += catLabels(O, catsL, horiz ? 1 : labelLines(catsL, O.slot));
    const legend = ser.length > 1 ? ser.map(s => ({ name: s.name, color: s.color, box: true })) : [];
    const aria = (stacked ? 'Barras apiladas' : horiz ? 'Barras horizontales' : 'Gráfica de barras') + ' con ' + n + ' categorías: ' + cats.slice(0, 6).join(', ') + (n > 6 ? '…' : '') + '.';
    return fig(o, horiz ? 'barsh' : 'bars', W, H, g, { aria, legend });
  }
  const bars = safe('bars', o => barsImpl(o, !!o.horizontal, false));
  const barsH = safe('barsH', o => barsImpl(o, true, false));
  const stackedFn = safe('stacked', o => barsImpl(Object.assign({}, o, { stacked: true }), !!o.horizontal, true));

  /* ============================================================
     3. histogram
     ============================================================ */
  const histogram = safe('histogram', function (o) {
    const W = o.w || 720, H = o.h || 300;
    let bins = [], values = nums(o.values), n, mu = o.mean, sg = o.sd;
    if (Array.isArray(o.bins) && o.bins.length) {
      bins = o.bins.map(b => ({ x0: +(b.x0 != null ? b.x0 : b.lo), x1: +(b.x1 != null ? b.x1 : b.hi), n: +(b.count != null ? b.count : b.n != null ? b.n : b.value) || 0 })).filter(b => Number.isFinite(b.x0) && Number.isFinite(b.x1));
      n = sum(bins.map(b => b.n));
      if (n && !isNum(mu)) mu = sum(bins.map(b => b.n * (b.x0 + b.x1) / 2)) / n;
      if (n > 1 && !isNum(sg)) sg = Math.sqrt(sum(bins.map(b => b.n * ((b.x0 + b.x1) / 2 - mu) ** 2)) / (n - 1));
    } else {
      if (values.length < 2) return emptyFig(o);
      n = values.length;
      const s = values.slice().sort((a, b) => a - b), mn = s[0], mx = s[n - 1];
      let nb;
      if (isNum(o.bins)) nb = Math.max(1, Math.round(+o.bins));
      else {
        const iqr = quant(s, 0.75) - quant(s, 0.25), fd = iqr > 0 ? 2 * iqr / Math.cbrt(n) : 0;
        nb = fd > 0 ? Math.ceil((mx - mn) / fd) : Math.ceil(Math.log2(n) + 1);
        nb = clamp(nb, 6, 28);
      }
      if (mx === mn) { bins = [{ x0: mn - 0.5, x1: mn + 0.5, n }]; }
      else {
        const step = niceNum((mx - mn) / nb, true), start = Math.floor(mn / step + 1e-9) * step;
        const cnt = Math.max(1, Math.ceil((mx - start) / step - 1e-9));
        for (let i = 0; i < cnt; i++) bins.push({ x0: +(start + i * step).toFixed(10), x1: +(start + (i + 1) * step).toFixed(10), n: 0 });
        values.forEach(v => { bins[Math.min(cnt - 1, Math.floor((v - start) / step + 1e-9))].n++; });
      }
      if (!isNum(mu)) mu = mean(values);
      if (!isNum(sg)) sg = sd(values);
    }
    if (!bins.length || !n) return emptyFig(o);
    const lsl = isNum(o.lsl) ? +o.lsl : null, usl = isNum(o.usl) ? +o.usl : null;
    const bw = bins[0].x1 - bins[0].x0;
    let dmin = Math.min(bins[0].x0, lsl == null ? Infinity : lsl), dmax = Math.max(bins[bins.length - 1].x1, usl == null ? -Infinity : usl);
    const pad = (dmax - dmin) * 0.03; dmin -= pad; dmax += pad;
    const xsc = niceScale(dmin, dmax, Math.max(4, Math.floor((W - 80) / 70)));
    const showNormal = o.normal !== false && Number.isFinite(sg) && sg > 0 && isNum(mu) && (o.normal === true || values.length || o.bins);
    const dens = x => n * bw * Math.exp(-0.5 * ((x - mu) / sg) ** 2) / (sg * Math.sqrt(2 * Math.PI));
    let ymax = Math.max.apply(null, bins.map(b => b.n));
    if (showNormal) ymax = Math.max(ymax, dens(mu));
    const ysc = niceScale(0, ymax * 1.05, 5), yf = o.yFmt || (v => fmt(v, 0));
    const ml = Math.max(34, Math.max.apply(null, ysc.ticks.map(t => tw(yf(t)))) + 16);
    const hasLines = isNum(mu) || lsl != null || usl != null;
    const mt = 14 + (hasLines ? 24 : 0) + (o.unit ? 0 : 0), mb = 30, mr = 20;
    const x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;
    const X = lin(xsc.min, xsc.max, x0, x1), Y = lin(ysc.min, ysc.max, y1, y0);
    const xf = o.xFmt || (v => fmt(v, decFor(xsc.step)));
    let g = valueAxis({ horiz: false, x0, x1, y0, y1, V: Y }, ysc, yf, true);
    xsc.ticks.forEach(t => { const x = X(t), s = xf(t); g += el('line', { class: 'ch-tick', x1: R(x), x2: R(x), y1: R(y1), y2: R(y1 + 4) }) + tx(x, y1 + 17, s, '', x - tw(s) / 2 < 0 ? 'start' : 'middle'); });
    bins.forEach(b => {
      const out = (lsl != null && b.x1 <= lsl + 1e-9) || (usl != null && b.x0 >= usl - 1e-9);
      const xa = X(b.x0) + 0.5, xb = X(b.x1) - 0.5, yy = Y(b.n);
      g += el('rect', { class: 'ch-bar ch-hbar', rx: Math.min(3, (xb - xa) / 2), x: R(xa), y: R(yy), width: R(Math.max(1, xb - xa)), height: R(Math.max(0, y1 - yy)), style: '--c:' + (out ? C_NEG : C_EST) }, tip(fmt(b.x0) + ' – ' + fmt(b.x1) + ': ' + b.n + (b.n === 1 ? ' dato' : ' datos') + (out ? ' (fuera de especificación)' : '')));
    });
    if (showNormal) {
      let d = '';
      for (let i = 0; i <= 90; i++) { const x = xsc.min + (xsc.max - xsc.min) * i / 90; d += (i ? 'L' : 'M') + R(X(x)) + ' ' + R(Y(dens(x))); }
      g += el('path', { class: 'ch-normal', d }, tip('Curva normal'));
    }
    const vline = (v, cls, label, anchor, row) => {
      const x = X(v), top = y0 - (row ? 20 : 8);
      return el('line', { class: cls, x1: R(x), x2: R(x), y1: R(top + 3), y2: R(y1) }) + tx(x + (anchor === 'start' ? 3 : anchor === 'end' ? -3 : 0), top, label, 'ch-t-ink', anchor);
    };
    if (lsl != null) g += vline(lsl, 'ch-spec', 'LIE ' + fmt(lsl), 'end', 0);
    if (usl != null) g += vline(usl, 'ch-spec', 'LSE ' + fmt(usl), 'start', 0);
    if (isNum(mu)) g += vline(+mu, 'ch-mean', 'Media ' + fmt(+mu, 2), 'middle', 1);
    const legend = [{ name: 'Datos', color: C_EST, box: true }].concat(showNormal ? [{ name: 'Normal', color: C_INK }] : []);
    const aria = 'Histograma de ' + n + ' datos en ' + bins.length + ' intervalos' + (isNum(mu) ? ', media ' + fmt(+mu, 2) : '') + (lsl != null || usl != null ? ', con límites de especificación' : '') + '.';
    const note = isNum(mu) && Number.isFinite(sg) ? 'n = ' + fmt(n, 0) + ' · media = ' + fmt(+mu, 2) + ' · σ = ' + fmt(sg, 2) : '';
    return fig(o, 'hist', W, H, g, { aria, legend: [], note: note });
  });

  /* ============================================================
     4. scatter
     ============================================================ */
  const scatter = safe('scatter', function (o) {
    const W = o.w || 720, H = o.h || 300;
    const pts = (o.points || []).filter(p => isNum(p.x) && isNum(p.y)).map(p => ({ x: +p.x, y: +p.y, label: p.label, group: p.group }));
    if (!pts.length) return emptyFig(o);
    let gnames = (o.groups || []).map(g => typeof g === 'string' ? { name: g } : g);
    pts.forEach(p => { if (p.group != null && !gnames.some(g => g.name === p.group)) gnames.push({ name: p.group }); });
    gnames = gnames.map((g, i) => ({ name: g.name, color: col(g.color, i) }));
    const gcol = p => { const g = gnames.find(g => g.name === p.group); return g ? g.color : palette[0]; };
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const xsc = niceScale(Math.min.apply(null, xs), Math.max.apply(null, xs), 6), ysc = niceScale(Math.min.apply(null, ys), Math.max.apply(null, ys), 5);
    const yf = o.yFmt || (v => fmt(v, decFor(ysc.step))), xf = o.xFmt || (v => fmt(v, decFor(xsc.step)));
    const ml = Math.max(34, Math.max.apply(null, ysc.ticks.map(t => tw(yf(t)))) + 16) + (o.yLabel ? 14 : 0);
    const mt = 14, mb = 30 + (o.xLabel ? 16 : 0), mr = 20, x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;
    const X = lin(xsc.min, xsc.max, x0, x1), Y = lin(ysc.min, ysc.max, y1, y0);
    let g = valueAxis({ horiz: false, x0: ml, x1, y0, y1, V: Y }, ysc, yf, false);
    xsc.ticks.forEach(t => { const x = X(t), s = xf(t); g += el('line', { class: 'ch-grid ch-grid-v', x1: R(x), x2: R(x), y1: R(y0), y2: R(y1) }) + tx(x, y1 + 17, s, '', x - tw(s) / 2 < 0 ? 'start' : 'middle'); });
    if (o.xLabel) g += tx((x0 + x1) / 2, H - 6, o.xLabel, 'ch-t-ink ch-axlab', 'middle');
    if (o.yLabel) g += el('text', { class: 'ch-t ch-t-ink ch-axlab', transform: 'translate(11 ' + R((y0 + y1) / 2) + ') rotate(-90)', 'text-anchor': 'middle' }, esc(o.yLabel));
    // regresión
    const n = pts.length, mx = mean(xs), my = mean(ys);
    let sxx = 0, syy = 0, sxy = 0;
    pts.forEach(p => { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); });
    let note = '';
    if (o.regression !== false && n > 2 && sxx > 0) {
      const b = sxy / sxx, a = my - b * mx, xa = Math.min.apply(null, xs), xb = Math.max.apply(null, xs);
      g += el('line', { class: 'ch-reg', x1: R(X(xa)), y1: R(Y(a + b * xa)), x2: R(X(xb)), y2: R(Y(a + b * xb)) }, tip('Regresión lineal'));
      const r = isNum(o.r) ? +o.r : (syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0);
      note = 'r = ' + fmt(r, 2) + ' · R² = ' + fmt(r * r, 2) + ' · y = ' + fmt(b, 3) + 'x ' + (a < 0 ? '− ' : '+ ') + fmt(Math.abs(a), 2) + ' · n = ' + fmt(n, 0);
    } else if (isNum(o.r)) note = 'r = ' + fmt(+o.r, 2) + ' · R² = ' + fmt(o.r * o.r, 2) + ' · n = ' + fmt(n, 0);
    pts.forEach(p => {
      const t = p.label != null ? String(p.label) : (p.group != null ? p.group + ' · ' : '') + (o.xLabel || 'x') + ' ' + xf(p.x) + ' · ' + (o.yLabel || 'y') + ' ' + yf(p.y);
      g += '<g class="ch-pt ch-sc" style="--c:' + esc(gcol(p)) + '">' + el('circle', { class: 'ch-hit', cx: R(X(p.x)), cy: R(Y(p.y)), r: 8 }) + el('circle', { class: 'ch-dot ch-dot-sc', cx: R(X(p.x)), cy: R(Y(p.y)), r: 3.6 }) + tip(t) + '</g>';
    });
    const legend = gnames.length > 1 ? gnames.map(g => ({ name: g.name, color: g.color })) : [];
    return fig(o, 'scatter', W, H, g, { aria: 'Diagrama de dispersión de ' + n + ' puntos' + (note ? '. ' + note : '') + '.', legend, note });
  });

  /* ============================================================
     5. box
     ============================================================ */
  const box = safe('box', function (o) {
    const W = o.w || 720, horiz = !!o.horizontal;
    let stats = [];
    if (Array.isArray(o.stats) && o.stats.length) stats = o.stats.map(s => ({ label: s.label, q1: +s.q1, med: +s.med, q3: +s.q3, lo: +s.lo, hi: +s.hi, out: nums(s.outliers), n: s.n, color: s.color }));
    else stats = (o.groups || []).map(gp => {
      const v = nums(gp.values).sort((a, b) => a - b); if (!v.length) return null;
      const q1 = quant(v, 0.25), q3 = quant(v, 0.75), med = quant(v, 0.5), iqr = q3 - q1;
      const inside = v.filter(x => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
      return { label: gp.label, q1, med, q3, lo: inside[0], hi: inside[inside.length - 1], out: v.filter(x => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr), n: v.length, color: gp.color };
    }).filter(Boolean);
    stats = stats.filter(s => [s.q1, s.med, s.q3, s.lo, s.hi].every(Number.isFinite));
    if (!stats.length) return emptyFig(o);
    const n = stats.length, H = o.h || (horiz ? Math.max(300, n * 44 + 50) : 300);
    let vals = []; stats.forEach(s => { vals.push(s.lo, s.hi, s.q1, s.q3); s.out.forEach(v => vals.push(v)); });
    (o.refs || []).forEach(r => { if (isNum(r.y)) vals.push(+r.y); });
    const sc = niceScale(Math.min.apply(null, vals), Math.max.apply(null, vals), 5), vf = o.yFmt || (v => fmt(v, decFor(sc.step)));
    const labels = stats.map(s => String(s.label == null ? '' : s.label));
    let ml, mb, mt = 14 + (o.unit && !horiz ? 12 : 0), mr = 20;
    if (horiz) { ml = Math.min(W * 0.35, Math.max.apply(null, labels.map(l => tw(trunc(l, 26)))) + 16); mb = 28; }
    else { ml = Math.max(34, Math.max.apply(null, sc.ticks.map(t => tw(vf(t)))) + 16); mb = 14 + 13 * labelLines(labels, (W - ml - mr) / n) + 6; }
    const O = orient(horiz, ml, mt, W - mr, H - mb, n, sc);
    let g = valueAxis(O, sc, vf, false) + (horiz ? '' : unitTop(o, 0, 11)) + refsLayer(O, o.refs, o);
    const bw = Math.min(O.slot * 0.5, 46), cap = bw * 0.4;
    const P = (c, v) => horiz ? [R(O.V(v)), R(c)] : [R(c), R(O.V(v))];
    stats.forEach((s, i) => {
      const c = O.C(i), color = s.color || C_EST;
      const t = labels[i] + (s.n ? ' (n = ' + s.n + ')' : '') + ' · mín ' + vf(s.lo) + ' · Q1 ' + vf(s.q1) + ' · mediana ' + vf(s.med) + ' · Q3 ' + vf(s.q3) + ' · máx ' + vf(s.hi) + (s.out.length ? ' · ' + s.out.length + ' atípicos' : '');
      const ln = (a, b, cls) => el('line', { class: cls, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      const cp = (v) => horiz ? ln([R(O.V(v)), R(c - cap / 2)], [R(O.V(v)), R(c + cap / 2)], 'ch-whisk') : ln([R(c - cap / 2), R(O.V(v))], [R(c + cap / 2), R(O.V(v))], 'ch-whisk');
      let inner = ln(P(c, s.q3), P(c, s.hi), 'ch-whisk') + ln(P(c, s.q1), P(c, s.lo), 'ch-whisk') + cp(s.hi) + cp(s.lo);
      const a = O.V(s.q1), b = O.V(s.q3);
      inner += horiz ? el('rect', { class: 'ch-box', rx: 3, x: R(Math.min(a, b)), y: R(c - bw / 2), width: R(Math.abs(b - a)), height: R(bw) })
        : el('rect', { class: 'ch-box', rx: 3, x: R(c - bw / 2), y: R(Math.min(a, b)), width: R(bw), height: R(Math.abs(b - a)) });
      const m = O.V(s.med);
      inner += horiz ? ln([R(m), R(c - bw / 2)], [R(m), R(c + bw / 2)], 'ch-med') : ln([R(c - bw / 2), R(m)], [R(c + bw / 2), R(m)], 'ch-med');
      s.out.forEach(v => { const p = P(c, v); inner += el('circle', { class: 'ch-out', cx: p[0], cy: p[1], r: 3 }, tip('Atípico: ' + vf(v))); });
      g += el('g', { class: 'ch-bx', style: '--c:' + color }, inner + tip(t));
    });
    g += catLabels(O, labels, horiz ? 1 : labelLines(labels, O.slot));
    return fig(o, 'box', W, H, g, { aria: 'Diagrama de cajas de ' + n + ' grupos: ' + labels.slice(0, 6).join(', ') + '.' });
  });

  /* ============================================================
     6. heatmap
     ============================================================ */
  function heatColor(v, dom, div) {
    if (!isNum(v)) return null;
    let p, base;
    if (div) { const m = Math.max(Math.abs(dom[0]), Math.abs(dom[1])) || 1, t = clamp(v / m, -1, 1); p = Math.round(Math.abs(t) * 88); base = t < 0 ? C_EST : C_INK; }
    else { const t = clamp((v - dom[0]) / ((dom[1] - dom[0]) || 1), 0, 1); p = Math.round(t * 88); base = C_INK; }
    return { bg: 'color-mix(in srgb, ' + base + ' ' + p + '%, var(--surface,#fff))', dark: p >= 52, base, p };
  }
  const heatmap = safe('heatmap', function (o) {
    const W = o.w || 720, rows = (o.rows || []).map(String), cols = (o.cols || []).map(String), M = o.matrix || [];
    if (!rows.length || !cols.length || !M.length) return emptyFig(o);
    const div = o.diverging !== false;
    let dom = o.domain;
    if (!Array.isArray(dom)) { const all = [].concat.apply([], M).filter(isNum).map(Number); dom = all.length ? [Math.min.apply(null, all), Math.max.apply(null, all)] : [0, 1]; if (div) { const m = Math.max(Math.abs(dom[0]), Math.abs(dom[1])); dom = [-m, m]; } }
    const ff = o.fmt || (v => fmt(v, 2));
    const ml = Math.min(W * 0.3, Math.max.apply(null, rows.map(r => tw(trunc(r, 24)))) + 14), mt = 26, mr = 8;
    const cw = (W - ml - mr) / cols.length;
    const ch = o.h ? (o.h - mt - 40) / rows.length : clamp(cw * 0.62, 24, 40);
    const H = mt + rows.length * ch + 40;
    let g = '';
    cols.forEach((c, j) => { const mc = Math.max(3, Math.floor(cw / 6)); g += el('text', { class: 'ch-t ch-t-ink', x: R(ml + (j + 0.5) * cw), y: mt - 9, 'text-anchor': 'middle' }, esc(trunc(c, mc)) + (c.length > mc ? tip(c) : '')); });
    rows.forEach((r, i) => {
      g += el('text', { class: 'ch-t ch-t-ink', x: R(ml - 8), y: R(mt + (i + 0.5) * ch + 3.5), 'text-anchor': 'end' }, esc(trunc(r, 24)) + (r.length > 24 ? tip(r) : ''));
      cols.forEach((c, j) => {
        const v = (M[i] || [])[j], hc = heatColor(v, dom, div), x = ml + j * cw + 1, y = mt + i * ch + 1;
        if (!hc) { g += el('rect', { class: 'ch-cell ch-cell-na', x: R(x), y: R(y), width: R(cw - 2), height: R(ch - 2), rx: 3 }); return; }
        g += el('rect', { class: 'ch-cell', x: R(x), y: R(y), width: R(cw - 2), height: R(ch - 2), rx: 3, style: 'fill:' + hc.bg }, tip(r + ' × ' + c + ': ' + ff(+v)));
        if (o.cellLabels !== false && cw > 30) g += el('text', { class: 'ch-t ch-cl', x: R(x + (cw - 2) / 2), y: R(y + (ch - 2) / 2 + 3.7), 'text-anchor': 'middle', style: 'fill:' + (hc.dark ? 'var(--surface,#fff)' : 'var(--ink,#171717)') }, esc(ff(+v)));
      });
    });
    // escala discreta
    const ly = H - 22, sw = 18, n = 9, lx = W - mr - n * sw - 44;
    for (let k = 0; k < n; k++) { const v = dom[0] + (dom[1] - dom[0]) * k / (n - 1), hc = heatColor(v, dom, div); g += el('rect', { class: 'ch-cell', x: R(lx + k * sw), y: ly, width: sw, height: 8, style: 'fill:' + hc.bg }); }
    g += tx(lx - 6, ly + 8, ff(dom[0]), '', 'end') + tx(lx + n * sw + 6, ly + 8, ff(dom[1]), '', 'start');
    return fig(o, 'heat', W, H, g, { aria: 'Mapa de calor de ' + rows.length + ' filas por ' + cols.length + ' columnas, valores de ' + ff(dom[0]) + ' a ' + ff(dom[1]) + '.' });
  });

  /* ============================================================
     7. control
     ============================================================ */
  const control = safe('control', function (o) {
    const W = o.w || 720, H = o.h || 300;
    const pts = (o.points || []).map((p, k) => ({ i: isNum(p.i) ? +p.i : k + 1, y: p.y, out: p.out, label: p.label })).filter(p => isNum(p.y));
    if (!pts.length || !isNum(o.cl) || !isNum(o.ucl) || !isNum(o.lcl)) return emptyFig(o);
    const cl = +o.cl, ucl = +o.ucl, lcl = +o.lcl, sg = (ucl - cl) / 3;
    const lsl = isNum(o.lsl) ? +o.lsl : null, usl = isNum(o.usl) ? +o.usl : null;
    const viol = {}; (o.violations || []).forEach(v => { viol[v.i] = (viol[v.i] ? viol[v.i] + '; ' : '') + v.text; });
    let vals = pts.map(p => +p.y).concat([ucl, lcl]); if (lsl != null) vals.push(lsl); if (usl != null) vals.push(usl);
    const ysc = niceScale(Math.min.apply(null, vals), Math.max.apply(null, vals), 6), yf = o.yFmt || (v => fmt(v, decFor(ysc.step)));
    const lbls = [{ y: ucl, t: 'LSC ' + fmt(ucl, 2), c: 'ch-lim' }, { y: cl, t: 'LC ' + fmt(cl, 2), c: 'ch-lim' }, { y: lcl, t: 'LIC ' + fmt(lcl, 2), c: 'ch-lim' }];
    if (usl != null) lbls.push({ y: usl, t: 'LSE ' + fmt(usl, 2), c: 'ch-spec-t' }); if (lsl != null) lbls.push({ y: lsl, t: 'LIE ' + fmt(lsl, 2), c: 'ch-spec-t' });
    const ml = Math.max(34, Math.max.apply(null, ysc.ticks.map(t => tw(yf(t)))) + 16), mr = Math.max.apply(null, lbls.map(l => tw(l.t))) + 16;
    const mt = 14 + (o.unit ? 12 : 0), mb = 30, x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;
    const Y = lin(ysc.min, ysc.max, y1, y0);
    const xmin = Math.min.apply(null, pts.map(p => p.i)), xmax = Math.max.apply(null, pts.map(p => p.i));
    const X = lin(xmin - 0.5, xmax + 0.5, x0, x1);
    let g = '';
    if (o.zones !== false && sg > 0) {
      const zr = (a, b, cls) => el('rect', { class: cls, x: R(x0), width: R(x1 - x0), y: R(Y(Math.max(a, b))), height: R(Math.abs(Y(a) - Y(b))) });
      g += zr(cl + 2 * sg, ucl, 'ch-zoneA') + zr(cl - 2 * sg, lcl, 'ch-zoneA') + zr(cl + sg, cl + 2 * sg, 'ch-zoneB') + zr(cl - sg, cl - 2 * sg, 'ch-zoneB');
    }
    g += valueAxis({ horiz: false, x0, x1, y0, y1, V: Y }, ysc, yf, false) + unitTop(o, 0, 11);
    const ns = niceScale(xmin, xmax, Math.max(3, Math.floor((x1 - x0) / 60)));
    ns.ticks.forEach(t => { if (t < xmin || t > xmax) return; const x = X(t); g += el('line', { class: 'ch-tick', x1: R(x), x2: R(x), y1: R(y1), y2: R(y1 + 4) }) + tx(x, y1 + 17, fmt(t, 0), '', 'middle'); });
    // límites
    if (lsl != null) g += el('line', { class: 'ch-spec', x1: R(x0), x2: R(x1), y1: R(Y(lsl)), y2: R(Y(lsl)) });
    if (usl != null) g += el('line', { class: 'ch-spec', x1: R(x0), x2: R(x1), y1: R(Y(usl)), y2: R(Y(usl)) });
    g += el('line', { class: 'ch-cl-line', x1: R(x0), x2: R(x1), y1: R(Y(cl)), y2: R(Y(cl)) });
    g += el('line', { class: 'ch-limit ch-dash', x1: R(x0), x2: R(x1), y1: R(Y(ucl)), y2: R(Y(ucl)) }) + el('line', { class: 'ch-limit ch-dash', x1: R(x0), x2: R(x1), y1: R(Y(lcl)), y2: R(Y(lcl)) });
    // etiquetas derechas sin solape
    lbls.sort((a, b) => Y(a.y) - Y(b.y));
    let last = -99;
    lbls.forEach(l => { let yy = Y(l.y) + 3.5; if (yy - last < 12) yy = last + 12; last = yy; g += tx(x1 + 8, yy, l.t, l.c, 'start'); });
    // serie
    const ord = pts.slice().sort((a, b) => a.i - b.i);
    g += el('path', { class: 'ch-cline', d: 'M' + ord.map(p => R(X(p.i)) + ' ' + R(Y(+p.y))).join('L') });
    let nout = 0;
    ord.forEach(p => {
      const out = p.out != null ? !!p.out : (+p.y > ucl || +p.y < lcl), v = viol[p.i];
      if (out) nout++;
      const t = (name => name)((o.name ? o.name + ' · ' : '') + 'Punto ' + p.i + ': ' + yf(+p.y) + (p.label ? ' · ' + p.label : '') + (out ? ' · fuera de control' : '') + (v ? ' · ' + v : ''));
      g += '<g class="ch-pt ch-cp' + (out ? ' ch-bad' : '') + '">' + el('circle', { class: 'ch-hit', cx: R(X(p.i)), cy: R(Y(+p.y)), r: 9 }) +
        (out ? el('circle', { class: 'ch-ring', cx: R(X(p.i)), cy: R(Y(+p.y)), r: 8 }) : v ? el('circle', { class: 'ch-ring ch-ring-w', cx: R(X(p.i)), cy: R(Y(+p.y)), r: 7 }) : '') +
        el('circle', { class: 'ch-dot', cx: R(X(p.i)), cy: R(Y(+p.y)), r: out ? 3.6 : 2.8 }) + tip(t) + '</g>';
    });
    const note = (o.violations || []).length ? '<ul class="ch-viol">' + o.violations.map(v => '<li><b>Punto ' + esc(v.i) + '</b> · ' + esc(v.text) + '</li>').join('') + '</ul>' : '';
    const aria = 'Carta de control' + (o.name ? ' de ' + o.name : '') + ' con ' + pts.length + ' puntos, línea central ' + fmt(cl, 2) + ', límites ' + fmt(lcl, 2) + ' a ' + fmt(ucl, 2) + '; ' + nout + (nout === 1 ? ' punto fuera de control.' : ' puntos fuera de control.');
    return fig(o, 'control', W, H, g, { aria, note });
  });

  /* ============================================================
     8. pareto
     ============================================================ */
  const pareto = safe('pareto', function (o) {
    const W = o.w || 720, H = o.h || 320;
    const items = (o.items || []).filter(i => isNum(i.value) && +i.value > 0).map(i => ({ label: String(i.label), value: +i.value })).sort((a, b) => b.value - a.value);
    if (!items.length) return emptyFig(o);
    const total = sum(items.map(i => i.value)), n = items.length, vital = isNum(o.vital) ? +o.vital : 0.8;
    const labels = items.map(i => i.label), ml = Math.max(34, tw(fmt(total, 0)) + 16), mr = 44, mt = 16 + (o.unit ? 12 : 0);
    const mb = 14 + 13 * labelLines(labels, (W - ml - mr) / n) + 6;
    const sc = { min: 0, max: total, ticks: [0, .25, .5, .75, 1].map(f => total * f) };
    const O = orient(false, ml, mt, W - mr, H - mb, n, sc);
    let g = '';
    [0, .25, .5, .75, 1].forEach(f => {
      const y = O.V(total * f);
      g += el('line', { class: f === 0 ? 'ch-axis' : 'ch-grid', x1: R(ml), x2: R(O.x1), y1: R(y), y2: R(y) }) + tx(ml - 8, y + 3.5, fmt(total * f, 0), '', 'end') + (o.cumulative === false ? '' : tx(O.x1 + 8, y + 3.5, Math.round(f * 100) + '%', '', 'start'));
    });
    g += unitTop(o, 0, 11);
    let acc = 0, cut = -1; const cum = items.map((it, i) => { acc += it.value; if (cut < 0 && acc / total >= vital - 1e-9) cut = i; return acc / total; });
    if (cut < 0) cut = n - 1;
    const bw = Math.min(O.slot * 0.62, 56);
    items.forEach((it, i) => {
      const y = O.V(it.value), x = O.C(i) - bw / 2, v = i <= cut;
      g += el('rect', { class: 'ch-bar' + (v ? '' : ' ch-bar-m'), rx: Math.min(3, bw / 2), x: R(x), y: R(y), width: R(bw), height: R(Math.max(1, O.y1 - y)), style: '--c:' + (v ? C_INK : C_MUTED) },
        tip(it.label + ': ' + fmt(it.value) + (o.unit ? ' ' + o.unit : '') + ' (' + pct(it.value / total, 1) + ', acumulado ' + pct(cum[i], 1) + ')'));
      if (bw >= 22 && n <= 14) g += tx(O.C(i), y - 6, fmt(it.value), 'ch-t-ink ch-vl', 'middle');
    });
    if (o.cumulative !== false) {
      const y80 = O.V(total * vital);
      g += el('line', { class: 'ch-ref ch-dash', x1: R(ml), x2: R(O.x1), y1: R(y80), y2: R(y80), style: '--c:' + C_WARN }) + tx(ml + 4, y80 - 5, Math.round(vital * 100) + '%', 'ch-ref-t', 'start', { style: '--c:' + C_WARN });
      g += el('path', { class: 'ch-line', style: '--c:' + C_EST, d: 'M' + cum.map((c, i) => R(O.C(i)) + ' ' + R(O.V(total * c))).join('L') });
      cum.forEach((c, i) => { g += '<g class="ch-pt" style="--c:' + C_EST + '">' + el('circle', { class: 'ch-hit', cx: R(O.C(i)), cy: R(O.V(total * c)), r: 9 }) + el('circle', { class: 'ch-dot', cx: R(O.C(i)), cy: R(O.V(total * c)), r: 2.6 }) + tip('Acumulado hasta ' + items[i].label + ': ' + pct(c, 1)) + '</g>'; });
    }
    g += catLabels(O, labels, labelLines(labels, O.slot));
    const legend = [{ name: 'Causas vitales', color: C_INK, box: true }, { name: 'Resto', color: C_MUTED, box: true }].concat(o.cumulative !== false ? [{ name: '% acumulado', color: C_EST }] : []);
    return fig(o, 'pareto', W, H, g, { aria: 'Diagrama de Pareto con ' + n + ' categorías; las primeras ' + (cut + 1) + ' acumulan ' + pct(cum[cut], 0) + ' del total.', legend });
  });

  /* ============================================================
     9. spark / sparkBars
     ============================================================ */
  function sparkEmpty(o, w, h) {
    return '<figure class="ch ch-sp ch-is-empty"><svg class="ch-svg" xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.empty || 'Sin datos') + '">' +
      el('line', { class: 'ch-ref ch-dash', x1: 2, x2: w - 2, y1: h / 2, y2: h / 2 }) + '</svg></figure>';
  }
  const spark = safe('spark', function (o) {
    const w = o.w || 120, h = o.h || 32, v = nums(o.values);
    if (!v.length) return sparkEmpty(o, w, h);
    const mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), pad = 4;
    const X = i => v.length === 1 ? w / 2 : pad + i * (w - 2 * pad) / (v.length - 1), Y = lin(mn, mx, h - pad, pad);
    const d = v.map((y, i) => (i ? 'L' : 'M') + R(X(i)) + ' ' + R(mx === mn ? h / 2 : Y(y))).join('');
    const yy = i => mx === mn ? h / 2 : Y(v[i]);
    let inner = '';
    if (o.area) inner += el('path', { class: 'ch-area', d: d + 'L' + R(X(v.length - 1)) + ' ' + h + 'L' + R(X(0)) + ' ' + h + 'Z' });
    inner += el('path', { class: 'ch-line ch-line-sp', d });
    if (o.last !== false) inner += el('circle', { class: 'ch-dot ch-dot-sp', cx: R(X(v.length - 1)), cy: R(yy(v.length - 1)), r: 2.6 });
    return '<figure class="ch ch-sp"><svg class="ch-svg" xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' +
      esc('Tendencia de ' + v.length + ' valores, de ' + fmt(v[0]) + ' a ' + fmt(v[v.length - 1])) + '"><g style="--c:' + esc(o.color || C_INK) + '">' + inner + '</g></svg></figure>';
  });
  const sparkBars = safe('sparkBars', function (o) {
    const w = o.w || 120, h = o.h || 32, v = nums(o.values);
    if (!v.length) return sparkEmpty(o, w, h);
    const mx = Math.max.apply(null, v.concat([0])), mn = Math.min.apply(null, v.concat([0])), Y = lin(mn, mx || 1, h - 1, 2), base = Y(0), gap = 2, bw = Math.max(1.5, (w - gap * (v.length - 1)) / v.length);
    const inner = v.map((y, i) => el('rect', { class: 'ch-bar ch-bar-sp' + (i === v.length - 1 && o.last !== false ? ' ch-bar-last' : ''), rx: Math.min(2, bw / 2), x: R(i * (bw + gap)), y: R(Math.min(Y(y), base)), width: R(bw), height: R(Math.max(1, Math.abs(base - Y(y)))) })).join('');
    return '<figure class="ch ch-sp"><svg class="ch-svg" xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' +
      esc('Barras de ' + v.length + ' valores, último ' + fmt(v[v.length - 1])) + '"><g style="--c:' + esc(o.color || C_INK) + '">' + inner + '</g></svg></figure>';
  });

  /* ============================================================
     10. donut / gauge
     ============================================================ */
  const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const arcPath = (cx, cy, r, a0, a1) => {
    const s = polar(cx, cy, r, a0), e = polar(cx, cy, r, a1);
    return 'M' + R(s[0]) + ' ' + R(s[1]) + 'A' + R(r) + ' ' + R(r) + ' 0 ' + (a1 - a0 > Math.PI ? 1 : 0) + ' 1 ' + R(e[0]) + ' ' + R(e[1]);
  };
  const donut = safe('donut', function (o) {
    const W = o.w || 420, H = o.h || 220;
    const data = (o.data || []).map((d, i) => ({ label: String(d.label), value: +d.value, color: col(d.color, i) })).filter(d => isNum(d.value) && d.value > 0);
    if (!data.length) return emptyFig(o, W, H);
    const total = sum(data.map(d => d.value)), cx = H / 2, cy = H / 2, th = 16, r = H / 2 - th / 2 - 8;
    let a = -Math.PI / 2, g = '';
    g += el('circle', { class: 'ch-track', cx: R(cx), cy: R(cy), r: R(r), style: 'stroke-width:' + th }) ;
    data.forEach(d => {
      const sw = d.value / total * Math.PI * 2, gap = data.length > 1 ? Math.min(0.03, sw * 0.3) : 0;
      const a0 = a + gap / 2, a1 = Math.min(a + sw - gap / 2, a0 + Math.PI * 2 - 0.0001);
      g += el('path', { class: 'ch-arc', d: arcPath(cx, cy, r, a0, a1), style: '--c:' + d.color + ';stroke-width:' + th }, tip(d.label + ': ' + withUnit(o, fmt(d.value)) + ' (' + pct(d.value / total, 1) + ')'));
      a += sw;
    });
    const ct = o.center || { text: fmt(total), sub: 'Total' };
    g += el('text', { class: 'ch-t ch-big', x: R(cx), y: R(cy + (ct.sub ? 2 : 8)), 'text-anchor': 'middle' }, esc(ct.text)) + (ct.sub ? tx(cx, cy + 20, ct.sub, '', 'middle') : '');
    // leyenda dentro del svg
    const lx = H + 12, rowH = Math.min(24, (H - 24) / data.length), ly = cy - rowH * data.length / 2 + rowH / 2;
    const mc = Math.floor((W - lx - 90) / 6.2);
    data.forEach((d, i) => {
      const y = ly + i * rowH;
      g += el('rect', { class: 'ch-sw-svg', x: R(lx), y: R(y - 5), width: 10, height: 10, rx: 3, style: '--c:' + d.color }) +
        el('text', { class: 'ch-t ch-t-ink', x: R(lx + 18), y: R(y + 3.5) }, esc(trunc(d.label, mc)) + (d.label.length > mc ? tip(d.label) : '')) +
        tx(W - 4, y + 3.5, fmt(d.value) + (o.unit ? ' ' + o.unit : '') + ' · ' + pct(d.value / total, 0), '', 'end');
    });
    return fig(o, 'donut', W, H, g, { aria: 'Gráfica de anillo de ' + data.length + ' categorías, total ' + fmt(total) + ': ' + data.map(d => d.label + ' ' + pct(d.value / total, 0)).join(', ') + '.' });
  });
  const gauge = safe('gauge', function (o) {
    const W = o.w || 260, H = o.h || 160;
    if (!isNum(o.value)) return emptyFig(o, W, H);
    const min = isNum(o.min) ? +o.min : 0, max = isNum(o.max) ? +o.max : 100, v = clamp(+o.value, min, max);
    if (max <= min) return emptyFig(o, W, H);
    const th = 12, cx = W / 2, r = Math.min(W / 2 - 24, H - 46), cy = r + th / 2 + 8;
    const ang = x => Math.PI + (clamp(x, min, max) - min) / (max - min) * Math.PI;
    let g = '';
    const zones = (o.zones || []).filter(z => isNum(z.to)).sort((a, b) => a.to - b.to);
    let zc = C_INK;
    if (zones.length) {
      let from = min, hit = false;
      zones.forEach(z => {
        const to = clamp(+z.to, min, max); if (to <= from) return;
        const gp = 0.02;
        g += el('path', { class: 'ch-gz', d: arcPath(cx, cy, r, ang(from) + (from > min ? gp : 0), ang(to) - (to < max ? gp : 0)), style: '--c:' + col(z.color, 3) + ';stroke-width:' + th });
        if (!hit && v <= to) { zc = col(z.color, 3); hit = true; }
        from = to;
      });
    } else g += el('path', { class: 'ch-gt', d: arcPath(cx, cy, r, Math.PI, Math.PI * 2 - 0.0001), style: 'stroke-width:' + th }) + (v > min ? el('path', { class: 'ch-gz', d: arcPath(cx, cy, r, Math.PI, ang(v)), style: '--c:' + C_INK + ';stroke-width:' + th }) : '');
    const pe = polar(cx, cy, r, ang(v));
    g += el('circle', { class: 'ch-gm', cx: R(pe[0]), cy: R(pe[1]), r: 7, style: '--c:' + zc }, tip(withUnit(o, fmt(+o.value))));
    const unit = o.unit ? '<tspan class="ch-gu" dx="3">' + esc(o.unit) + '</tspan>' : '';
    g += el('text', { class: 'ch-t ch-big', x: R(cx), y: R(cy - 8), 'text-anchor': 'middle' }, esc(fmt(+o.value, o.dec)) + unit);
    if (o.label) g += tx(cx, cy + 12, o.label, '', 'middle');
    g += tx(cx - r, cy + 16, fmt(min), '', 'middle') + tx(cx + r, cy + 16, fmt(max), '', 'middle');
    return fig(o, 'gauge', W, H, g, { aria: 'Indicador semicircular' + (o.label ? ' de ' + o.label : '') + ': ' + fmt(+o.value) + (o.unit ? ' ' + o.unit : '') + ', en una escala de ' + fmt(min) + ' a ' + fmt(max) + '.' });
  });

  /* ============================================================
     11. waterfall
     ============================================================ */
  const waterfall = safe('waterfall', function (o) {
    const W = o.w || 720, H = o.h || 300, steps = (o.steps || []).filter(s => s && (isNum(s.value) || s.total));
    if (!steps.length) return emptyFig(o);
    let run = 0; const bars = [];
    steps.forEach(s => {
      if (s.total) { const v = isNum(s.value) ? +s.value : run; bars.push({ a: 0, b: v, kind: 'tot', label: s.label, v, end: v }); run = v; }
      else { const v = +s.value, a = run; run += v; bars.push({ a, b: run, kind: v >= 0 ? 'pos' : 'neg', label: s.label, v, end: run }); }
    });
    const all = [0]; bars.forEach(b => all.push(b.a, b.b));
    const sc = niceScale(Math.min.apply(null, all), Math.max.apply(null, all), 5), yf = o.yFmt || (v => fmt(v, decFor(sc.step)));
    const n = bars.length, labels = bars.map(b => String(b.label == null ? '' : b.label)), ml = Math.max(34, Math.max.apply(null, sc.ticks.map(t => tw(yf(t)))) + 16), mr = 16, mt = 18 + (o.unit ? 12 : 0);
    const mb = 14 + 13 * labelLines(labels, (W - ml - mr) / n) + 6;
    const O = orient(false, ml, mt, W - mr, H - mb, n, sc);
    let g = valueAxis(O, sc, yf, true) + unitTop(o, 0, 11);
    const bw = Math.min(O.slot * 0.6, 64);
    bars.forEach((b, i) => {
      const ya = O.V(b.a), yb = O.V(b.b), y = Math.min(ya, yb), x = O.C(i) - bw / 2, hh = Math.max(1, Math.abs(ya - yb));
      const col2 = b.kind === 'tot' ? C_INK : b.kind === 'pos' ? C_POS : C_NEG;
      g += el('rect', { class: 'ch-bar', rx: Math.min(3, bw / 2, hh / 2), x: R(x), y: R(y), width: R(bw), height: R(hh), style: '--c:' + col2 }, tip(b.label + ': ' + (b.kind === 'tot' ? '' : b.v >= 0 ? '+' : '') + withUnit(o, yf(b.v)) + (b.kind === 'tot' ? '' : ' → ' + yf(b.end))));
      const txt = (b.kind === 'tot' ? '' : b.v >= 0 ? '+' : '') + (o.yFmt ? o.yFmt(b.v) : fmt(b.v));
      const up = b.kind === 'neg' ? false : true;
      g += tx(O.C(i), up ? y - 6 : y + hh + 14, txt, 'ch-t-ink ch-vl', 'middle');
      if (i < n - 1) { const yy = O.V(b.end); g += el('line', { class: 'ch-conn', x1: R(x + bw), x2: R(O.C(i + 1) - bw / 2), y1: R(yy), y2: R(yy) }); }
    });
    g += catLabels(O, labels, labelLines(labels, O.slot));
    return fig(o, 'waterfall', W, H, g, { aria: 'Cascada con ' + n + ' pasos: ' + bars.map(b => b.label + ' ' + fmt(b.v)).join(', ') + '.' });
  });

  /* ============================================================
     12. gantt
     ============================================================ */
  const STATUS = { ok: C_POS, done: C_POS, listo: C_POS, completado: C_POS, completo: C_POS, finalizado: C_POS, en_curso: C_EST, encurso: C_EST, running: C_EST, activo: C_EST, aviso: C_WARN, warn: C_WARN, atencion: C_WARN, atrasado: C_NEG, late: C_NEG, error: C_NEG, retraso: C_NEG, neg: C_NEG, pendiente: '#8a8a84', planificado: '#8a8a84', pending: '#8a8a84' };
  const gantt = safe('gantt', function (o) {
    const W = o.w || 720, rows = (o.rows || []).map(r => Object.assign({}, r, { s: toMs(r.start), e: toMs(r.end) })).filter(r => Number.isFinite(r.s) && Number.isFinite(r.e));
    if (!rows.length) return emptyFig(o);
    const n = rows.length, rh = 28, H = o.h || Math.max(200, n * rh + 60);
    let mn = Math.min.apply(null, rows.map(r => r.s)), mx = Math.max.apply(null, rows.map(r => r.e));
    const now = isNum(o.now) || o.now instanceof Date ? toMs(o.now) : null;
    if (now != null && Number.isFinite(now)) { mn = Math.min(mn, now); mx = Math.max(mx, now); }
    if (mx === mn) mx += 36e5; const pd = (mx - mn) * 0.02; mn -= pd; mx += pd;
    const ml = Math.min(W * 0.34, Math.max.apply(null, rows.map(r => tw(trunc(r.label, 28)))) + 16), mr = 18, mt = 10, mb = 26, x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;
    const X = lin(mn, mx, x0, x1), tt = timeTicks(mn, mx, Math.max(2, Math.floor((x1 - x0) / 80))), xl = o.xFmt || tt.label;
    let g = '';
    tt.ticks.forEach(t => { const x = X(t), s = xl(t); g += el('line', { class: 'ch-grid', x1: R(x), x2: R(x), y1: y0, y2: y1 }) + tx(x, y1 + 17, s, '', x - tw(s) / 2 < 0 ? 'start' : x + tw(s) / 2 > W ? 'end' : 'middle'); });
    g += el('line', { class: 'ch-axis', x1: x0, x2: x1, y1: y1, y2: y1 });
    const slot = (y1 - y0) / n, bh = Math.min(16, slot * 0.6), seen = {};
    rows.forEach((r, i) => {
      const cy = y0 + (i + 0.5) * slot, st = String(r.status || '').toLowerCase().replace(/[\s-]+/g, '_'), c = r.color || (r.status ? (STATUS[st] || C_EST) : C_EST);
      if (r.status) seen[r.status] = c;
      g += el('text', { class: 'ch-t ch-t-ink', x: R(x0 - 10), y: R(cy + 3.5), 'text-anchor': 'end' }, esc(trunc(r.label, Math.floor((x0 - 20) / 6.2))) + tip(r.label));
      const xa = X(r.s), w = Math.max(3, X(r.e) - xa), dur = (r.e - r.s) / 36e5;
      g += el('rect', { class: 'ch-bar ch-gbar', rx: Math.min(3, w / 2), x: R(xa), y: R(cy - bh / 2), width: R(w), height: R(bh), style: '--c:' + c },
        tip(r.label + ': ' + dateLabel(r.s, true) + ' → ' + dateLabel(r.e, true) + ' (' + (dur >= 48 ? fmt(dur / 24, 1) + ' d' : fmt(dur, 1) + ' h') + ')' + (r.status ? ' · ' + r.status : '')));
    });
    if (now != null && Number.isFinite(now)) {
      const x = X(now), right = x + 44 > W;
      g += el('line', { class: 'ch-now', x1: R(x), x2: R(x), y1: y0 - 2, y2: y1 }) + tx(x + (right ? -4 : 4), y0 + 8, 'Ahora', 'ch-now-t', right ? 'end' : 'start');
    }
    const legend = Object.keys(seen).map(k => ({ name: k.charAt(0).toUpperCase() + k.slice(1), color: seen[k], box: true }));
    return fig(o, 'gantt', W, H, g, { aria: 'Cronograma con ' + n + ' actividades, desde ' + dateLabel(mn, true) + ' hasta ' + dateLabel(mx, true) + '.', legend });
  });

  /* ============================================================
     13. calendar
     ============================================================ */
  const calendar = safe('calendar', function (o) {
    const W = o.w || 720, weeks = o.weeks || 26, DAY = 864e5;
    const map = {}; let last = -Infinity, vmax = 0;
    (o.days || []).forEach(d => {
      const ms = toMs(d.date); if (!Number.isFinite(ms) || !isNum(d.value)) return;
      const dt = new Date(ms), k = dt.getFullYear() + '-' + dt.getMonth() + '-' + dt.getDate();
      map[k] = (map[k] || 0) + +d.value; last = Math.max(last, new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime());
    });
    if (!Object.keys(map).length) return emptyFig(o);
    Object.keys(map).forEach(k => { vmax = Math.max(vmax, map[k]); });
    const ld = new Date(last), dow = (ld.getDay() + 6) % 7, endMon = new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() - dow);
    const startMon = new Date(endMon.getFullYear(), endMon.getMonth(), endMon.getDate() - (weeks - 1) * 7);
    const ml = 30, mt = 20, mr = 8, cs = (W - ml - mr) / weeks, sz = cs - 3, H = mt + 7 * cs + 34;
    let g = '', lastX = -99;
    ['Lun', '', 'Mié', '', 'Vie', '', 'Dom'].forEach((d, r) => { if (d) g += tx(ml - 6, mt + r * cs + sz / 2 + 3.5, d, '', 'end'); });
    for (let w = 0; w < weeks; w++) {
      const mon = new Date(startMon.getFullYear(), startMon.getMonth(), startMon.getDate() + w * 7);
      for (let r = 0; r < 7; r++) {
        const dt = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + r);
        if (dt.getTime() > last) continue;
        const k = dt.getFullYear() + '-' + dt.getMonth() + '-' + dt.getDate(), v = map[k], x = ml + w * cs, y = mt + r * cs;
        const t = dt.getDate() + ' ' + MES[dt.getMonth()] + ' ' + dt.getFullYear() + ': ' + (v == null ? 'sin datos' : withUnit(o, fmt(v)));
        if (v == null || vmax <= 0) g += el('rect', { class: 'ch-cal ch-cal-na', x: R(x), y: R(y), width: R(sz), height: R(sz), rx: 3 }, tip(t));
        else g += el('rect', { class: 'ch-cal', x: R(x), y: R(y), width: R(sz), height: R(sz), rx: 3, style: '--p:' + Math.round(14 + 76 * clamp(v / vmax, 0, 1)) + '%' }, tip(t));
      }
      if ((w === 0 || mon.getDate() <= 7) && ml + w * cs - lastX >= 30) { g += tx(ml + w * cs, 11, MES[mon.getMonth()], '', 'start'); lastX = ml + w * cs; }
    }
    const ly = H - 14, lsz = 10, lx = W - mr - 5 * (lsz + 3) - 34;
    g += tx(lx - 6, ly + 8, 'Menos', '', 'end') + tx(lx + 5 * (lsz + 3) + 2, ly + 8, 'Más', '', 'start');
    for (let k = 0; k < 5; k++) g += el('rect', { class: 'ch-cal', x: lx + k * (lsz + 3), y: ly, width: lsz, height: lsz, rx: 2.5, style: '--p:' + Math.round(14 + 76 * k / 4) + '%' });
    if (o.unit) g += tx(ml, ly + 8, 'Máx. ' + fmt(vmax) + ' ' + o.unit, '', 'start');
    return fig(o, 'cal', W, H, g, { aria: 'Mapa de calor tipo calendario de ' + weeks + ' semanas hasta el ' + dateLabel(last, true) + '; valor máximo ' + fmt(vmax) + (o.unit ? ' ' + o.unit : '') + '.' });
  });

  /* ============================================================
     14. kpi
     ============================================================ */
  const kpi = safe('kpi', function (o) {
    let delta = '';
    if (o.delta != null && o.delta !== '') {
      const good = o.deltaGood === 'down' ? 'down' : 'up';
      const num = isNum(o.delta) ? +o.delta : null;
      const dir = num == null ? (/^\s*-|−/.test(String(o.delta)) ? -1 : 1) : Math.sign(num);
      const tone = dir === 0 ? 'flat' : ((dir > 0) === (good === 'up') ? 'good' : 'bad');
      const txt = num == null ? String(o.delta) : (num > 0 ? '+' : num < 0 ? '−' : '') + fmt(Math.abs(num), 1) + '%';
      delta = '<span class="ch-delta ch-delta-' + tone + '"><span aria-hidden="true">' + (dir > 0 ? '▲' : dir < 0 ? '▼' : '■') + '</span> ' + esc(txt) + '</span>';
    }
    const v = isNum(o.value) ? fmt(+o.value) : (o.value == null || o.value === '' ? '—' : String(o.value));
    return '<div class="ch-kpi"' + A({ id: o.id, title: o.help || null }) + '>' +
      '<div class="ch-kpi-l">' + esc(o.label || '') + '</div>' +
      '<div class="ch-kpi-v"><span class="ch-kpi-n">' + esc(v) + '</span>' + (o.unit ? '<span class="ch-kpi-u">' + esc(o.unit) + '</span>' : '') + delta + '</div>' +
      (Array.isArray(o.spark) && o.spark.length ? '<div class="ch-kpi-s">' + spark({ values: o.spark, w: o.sparkW || 120, h: 32, color: o.sparkColor }) + '</div>' : '') +
      (o.help ? '<div class="ch-kpi-h">' + esc(o.help) + '</div>' : '') + '</div>';
  });

  /* ============================================================
     Exportación: svgToPng / download / toolbar
     ============================================================ */
  const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'paint-order', 'text-anchor', 'dominant-baseline'];
  function resolveSvg(src) {
    let host = null, svg = null;
    if (typeof src === 'string') {
      host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px;pointer-events:none';
      host.innerHTML = src; document.body.appendChild(host);
      svg = host.querySelector('svg');
    } else if (src && src.tagName && src.tagName.toLowerCase() === 'svg') svg = src;
    else if (src && src.querySelector) svg = src.querySelector('svg.ch-svg') || src.querySelector('svg');
    if (!svg) { if (host) host.remove(); throw new Error('No hay SVG'); }
    return { svg, host };
  }
  function inlined(svg, bg) {
    const vb = (svg.getAttribute('viewBox') || '0 0 720 300').split(/[\s,]+/).map(Number);
    const w = vb[2] || 720, h = vb[3] || 300, clone = svg.cloneNode(true);
    const A1 = [svg].concat(Array.from(svg.querySelectorAll('*'))), B1 = [clone].concat(Array.from(clone.querySelectorAll('*')));
    A1.forEach((e, i) => {
      const cs = getComputedStyle(e), t = B1[i]; let s = '';
      PROPS.forEach(p => { const v = cs.getPropertyValue(p); if (v) s += p + ':' + v + ';'; });
      t.setAttribute('style', s); t.removeAttribute('class');
    });
    Array.from(clone.querySelectorAll('title')).forEach(t => t.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    if (bg) clone.insertAdjacentHTML('afterbegin', '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + esc(bg) + '"/>');
    return { str: new XMLSerializer().serializeToString(clone), w, h };
  }
  function surfaceColor(svg) {
    let c = '';
    try { c = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(); } catch (e) { /* sin variable */ }
    return c || '#ffffff';
  }
  function svgToPng(src, scale) {
    scale = scale || 2;
    return new Promise((resolve, reject) => {
      let r;
      try { r = resolveSvg(src); } catch (e) { reject(e); return; }
      try {
        const pad = 12, bg = surfaceColor(r.svg), s = inlined(r.svg, bg);
        if (r.host) r.host.remove();
        const img = new Image();
        img.onload = () => {
          try {
            const cv = document.createElement('canvas'); cv.width = Math.round(s.w * scale); cv.height = Math.round(s.h * scale);
            const ctx = cv.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0, cv.width, cv.height);
            cv.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo generar el PNG')), 'image/png');
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('No se pudo renderizar el SVG'));
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.str);
      } catch (e) { if (r.host) r.host.remove(); reject(e); }
    });
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  function download(src, filename, type) {
    type = (type || 'png').toLowerCase();
    let name = String(filename || 'grafica').replace(/\.(png|svg)$/i, '');
    if (type === 'svg') {
      return new Promise((resolve, reject) => {
        let r; try { r = resolveSvg(src); const s = inlined(r.svg, null); if (r.host) r.host.remove(); const b = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + s.str], { type: 'image/svg+xml' }); saveBlob(b, name + '.svg'); resolve(b); }
        catch (e) { if (r && r.host) r.host.remove(); reject(e); }
      });
    }
    return svgToPng(src, 2).then(b => { saveBlob(b, name + '.png'); return b; });
  }

  /* ---------- listener delegado único ---------- */
  const API = {
    version: '1.0.0', palette, niceScale, fmt, svgToPng, download, toolbar,
    line, bars, barsH, stacked: stackedFn, histogram, scatter, box, heatmap, control, pareto,
    spark, sparkBars, donut, gauge, waterfall, gantt, calendar, kpi
  };
  if (!(window.App.Charts && window.App.Charts._bound)) {
    document.addEventListener('click', function (ev) {
      const b = ev.target && ev.target.closest ? ev.target.closest('[data-ch-dl]') : null;
      if (!b) return;
      const holder = b.closest('[data-ch-for]'), id = b.getAttribute('data-ch-for') || (holder && holder.getAttribute('data-ch-for'));
      const target = id ? document.getElementById(id) : b.closest('figure.ch');
      if (!target) return;
      const t = target.querySelector && target.querySelector('.ch-title');
      const name = b.getAttribute('data-ch-name') || id || (t ? t.textContent.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '') || 'grafica';
      download(target, name, b.getAttribute('data-ch-dl')).catch(function () { /* sin acción */ });
    });
  }
  API._bound = true;
  window.App.Charts = API;
})();
