// Barra de navegación: borde al hacer scroll
const nav = document.getElementById('nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10), { passive: true });

// Animaciones de aparición al hacer scroll
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 80}ms`;
  io.observe(el);
});

// Contadores animados
const counters = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target, end = +el.dataset.count, t0 = performance.now(), dur = 1400;
    const tick = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    counters.unobserve(el);
  });
}, { threshold: 0.6 });
document.querySelectorAll('[data-count]').forEach((el) => counters.observe(el));

// Cambio de tema claro/oscuro (se recuerda si el navegador lo permite)
const root = document.documentElement;
try { const s = localStorage.getItem('theme'); if (s) root.dataset.theme = s; } catch (_) {}
document.getElementById('theme').addEventListener('click', () => {
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch (_) {}
});

/* ---------- Análisis y gráficas ---------- */
const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const fmt = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const fmtC = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Regresión lineal por mínimos cuadrados + error estándar de los residuos
function regress(vals) {
  const n = vals.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  vals.forEach((y, x) => { sx += x; sy += y; sxy += x * y; sxx += x * x; });
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - m * sx) / n;
  let se = 0;
  vals.forEach((y, x) => { se += (y - (m * x + b)) ** 2; });
  return { m, b, se: Math.sqrt(se / Math.max(n - 2, 1)) };
}

function nextLabels(labels, k) {
  const i = MONTHS.indexOf(labels[labels.length - 1]);
  return Array.from({ length: k }, (_, j) => (i >= 0 ? MONTHS[(i + j + 1) % 12] : `+${j + 1}`));
}

function niceStep(range) {
  const pow = 10 ** Math.floor(Math.log10(range));
  const f = range / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function drawChart(el, data, { mode = 'line', ahead = 4 } = {}) {
  el._args = [data, { mode, ahead }];
  const W = el.clientWidth || 640, H = W < 500 ? 260 : 320;
  const P = { l: 44, r: 14, t: 14, b: 28 };
  const vals = data.map((d) => d.value);
  const reg = regress(vals);
  const k = reg ? ahead : 0;
  const labels = [...data.map((d) => d.label), ...nextLabels(data.map((d) => d.label), k)];
  const proj = Array.from({ length: k }, (_, j) => reg.m * (vals.length + j) + reg.b);
  const band = reg ? reg.se * 1.5 : 0;
  const N = labels.length;

  let max = Math.max(0, ...vals, ...proj.map((v) => v + band));
  let min = Math.min(0, ...vals, ...proj.map((v) => v - band));
  if (max === min) max = min + 1;
  const step = niceStep((max - min) / 4);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;

  const x0 = P.l + 12, x1 = W - P.r - 12;
  const slot = (W - P.l - P.r) / Math.max(N, 1);
  const x = (i) => (mode === 'bar' ? P.l + (i + 0.5) * slot : N > 1 ? x0 + (i * (x1 - x0)) / (N - 1) : (x0 + x1) / 2);
  const y = (v) => P.t + ((max - v) / (max - min)) * (H - P.t - P.b);

  let g = '';
  for (let v = min; v <= max + step / 2; v += step) {
    g += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>` +
         `<text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtC.format(v)}</text>`;
  }
  const every = Math.ceil(N / Math.max(Math.floor((W - P.l) / 46), 1));
  labels.forEach((l, i) => {
    if (i % every === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
  });

  const n = vals.length;
  if (n) {
    if (mode === 'bar') {
      const bw = Math.min(slot * 0.6, 46), y0 = y(0);
      const bar = (i, v, cls) => {
        const yy = y(v);
        return `<rect class="${cls}" x="${x(i) - bw / 2}" y="${Math.min(yy, y0)}" width="${bw}" height="${Math.max(Math.abs(yy - y0), 1)}" rx="6"/>`;
      };
      vals.forEach((v, i) => { g += bar(i, v, 'bar'); });
      proj.forEach((v, i) => { g += bar(n + i, v, 'bar-p'); });
    } else {
      const pts = vals.map((v, i) => `${x(i)},${y(v)}`);
      g += `<defs><linearGradient id="ag${el.id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.3"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>`;
      g += `<polygon fill="url(#ag${el.id})" points="${x(0)},${y(0)} ${pts.join(' ')} ${x(n - 1)},${y(0)}"/>`;
      if (k) {
        const up = proj.map((v, j) => `${x(n + j)},${y(v + band)}`);
        const lo = proj.map((v, j) => `${x(n + j)},${y(v - band)}`).reverse();
        g += `<polygon class="band" points="${x(n - 1)},${y(vals[n - 1])} ${up.join(' ')} ${lo.join(' ')}"/>`;
        g += `<polyline class="ln-p" points="${x(n - 1)},${y(vals[n - 1])} ${proj.map((v, j) => `${x(n + j)},${y(v)}`).join(' ')}"/>`;
      }
      g += `<polyline class="ln" points="${pts.join(' ')}"/>`;
      vals.forEach((v, i) => { g += `<circle class="pt" cx="${x(i)}" cy="${y(v)}" r="4"/>`; });
      proj.forEach((v, j) => { g += `<circle class="pt-p" cx="${x(n + j)}" cy="${y(v)}" r="4"/>`; });
    }
    labels.forEach((_, i) => { g += `<rect class="hit" data-i="${i}" x="${x(i) - (mode === 'bar' ? slot : (x1 - x0) / Math.max(N - 1, 1)) / 2}" y="${P.t}" width="${mode === 'bar' ? slot : (x1 - x0) / Math.max(N - 1, 1)}" height="${H - P.t - P.b}"/>`; });
  }

  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg><div class="tip"></div>`;
  const tip = el.querySelector('.tip');
  el.querySelectorAll('.hit').forEach((r) => {
    const i = +r.dataset.i, real = i < n, v = real ? vals[i] : proj[i - n];
    r.addEventListener('mouseenter', () => {
      tip.innerHTML = `${esc(labels[i])}${real ? '' : ' · proyección'}<b>${fmt.format(v)}</b>${real ? '' : `<span>±${fmt.format(band)}</span>`}`;
      tip.style.left = `${x(i)}px`;
      tip.style.top = `${y(v)}px`;
      tip.classList.add('on');
    });
    r.addEventListener('mouseleave', () => tip.classList.remove('on'));
  });
}

// Redibuja las gráficas al cambiar el ancho
const ro = new ResizeObserver((entries) => entries.forEach((e) => {
  const el = e.target;
  if (el._w !== el.clientWidth && el._args) { el._w = el.clientWidth; drawChart(el, ...el._args); }
}));
const watch = (el) => ro.observe(el);

/* ---------- Hero ---------- */
const heroChart = document.getElementById('heroChart');
const sample = [42, 48, 45, 56, 61, 58, 72, 78].map((value, i) => ({ label: MONTHS[i], value }));
drawChart(heroChart, sample, { mode: 'line', ahead: 4 });
watch(heroChart);

/* ---------- Demo interactiva ---------- */
const demo = document.getElementById('demoChart');
const rowsEl = document.getElementById('rows');
const state = {
  data: [32, 38, 41, 47, 45, 55, 61, 66].map((value, i) => ({ label: MONTHS[i], value })),
  mode: 'line',
  ahead: 4,
};

function renderRows() {
  rowsEl.innerHTML = state.data.map((d, i) => `<tr>
    <td><input aria-label="Periodo ${i + 1}" data-i="${i}" data-k="label" value="${esc(d.label)}"></td>
    <td><input aria-label="Valor ${i + 1}" type="number" step="any" inputmode="decimal" data-i="${i}" data-k="value" value="${d.value}"></td>
    <td><button class="x" type="button" data-del="${i}" aria-label="Eliminar fila ${i + 1}">×</button></td></tr>`).join('');
}

function update() {
  const vals = state.data.map((d) => d.value);
  const reg = regress(vals), n = vals.length;
  const total = vals.reduce((a, b) => a + b, 0);
  const set = (id, t) => { document.getElementById(id).textContent = t; };
  set('k-total', n ? fmt.format(total) : '–');
  set('k-avg', n ? fmt.format(total / n) : '–');
  set('k-slope', reg ? `${reg.m >= 0 ? '+' : ''}${fmt.format(reg.m)}` : '–');
  set('k-proj', reg && state.ahead ? fmt.format(reg.m * (n + state.ahead - 1) + reg.b) : '–');
  drawChart(demo, state.data, { mode: state.mode, ahead: state.ahead });
  flagOutliers();
}

rowsEl.addEventListener('input', (e) => {
  const t = e.target, d = state.data[+t.dataset.i];
  if (!d) return;
  d[t.dataset.k] = t.dataset.k === 'value' ? parseFloat(t.value) || 0 : t.value;
  update();
});
rowsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  state.data.splice(+b.dataset.del, 1);
  renderRows();
  update();
});
document.getElementById('add').addEventListener('click', () => {
  const labels = state.data.map((d) => d.label);
  const last = state.data[state.data.length - 1];
  const nl = MONTHS.includes(labels[labels.length - 1]) ? nextLabels(labels, 1)[0] : `P${labels.length + 1}`;
  state.data.push({ label: nl, value: last ? last.value : 0 });
  renderRows();
  update();
  rowsEl.scrollTop = rowsEl.scrollHeight;
});
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll('.seg button').forEach((o) => o.classList.toggle('on', o === b));
  update();
}));
document.getElementById('ahead').addEventListener('input', (e) => {
  state.ahead = +e.target.value;
  document.getElementById('ahead-out').textContent = state.ahead;
  update();
});

// Exportar a CSV
document.getElementById('export').addEventListener('click', () => {
  const csv = 'periodo,valor\n' + state.data.map((d) => `"${String(d.label).replace(/"/g, '""')}",${d.value}`).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'datos.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

// Importar desde CSV (periodo,valor) separado por coma, punto y coma o tabulador
document.getElementById('csv').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rows = (await f.text()).split(/\r?\n/).map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, '')));
  const parsed = rows
    .filter((r) => r.length >= 2 && r[1] !== '' && !isNaN(parseFloat(r[1].replace(',', '.'))))
    .slice(0, 60)
    .map((r) => ({ label: r[0], value: parseFloat(r[1].replace(',', '.')) }));
  if (parsed.length) { state.data = parsed; renderRows(); update(); }
  e.target.value = '';
});

renderRows();
update();
watch(demo);

/* ---------- Validación en vivo: datos atípicos ---------- */
function flagOutliers() {
  const vals = state.data.map((d) => d.value), reg = regress(vals);
  const warn = document.getElementById('warn');
  const bad = [];
  if (reg && vals.length >= 5) {
    vals.forEach((v, i) => { if (Math.abs(v - (reg.m * i + reg.b)) > 2 * reg.se && reg.se > 0) bad.push(i); });
  }
  rowsEl.querySelectorAll('tr').forEach((tr, i) => {
    const on = bad.includes(i);
    tr.classList.toggle('flag', on);
    tr.title = on ? 'Fuera de lo esperado según la tendencia' : '';
  });
  warn.hidden = !bad.length;
  warn.textContent = bad.length
    ? `⚠ ${bad.length === 1 ? 'Dato atípico' : bad.length + ' datos atípicos'}: ${bad.map((i) => state.data[i].label).join(', ')} se aleja de la tendencia. Revísalo antes de proyectar.`
    : '';
}

/* ---------- Deshacer ---------- */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, prev) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(msg)}</span>${prev ? '<button type="button">Deshacer</button>' : ''}`;
  toastEl.classList.add('on');
  if (prev) toastEl.querySelector('button').onclick = () => {
    state.data = JSON.parse(prev);
    renderRows(); update();
    toastEl.classList.remove('on');
  };
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 6000);
}
const snap = () => JSON.stringify(state.data);
// Captura antes de que los manejadores originales modifiquen los datos
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-del]')) toast('Fila eliminada', snap());
  else if (e.target.closest('#add')) toast('Periodo agregado', snap());
}, true);

/* ---------- Paleta de comandos (⌘K / Ctrl+K) ---------- */
const pal = document.getElementById('palette'), pin = document.getElementById('pin'), plist = document.getElementById('plist');
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const click = (sel) => () => document.querySelector(sel).click();
const goTo = (h) => () => { location.hash = h; };
const setMode = (m) => () => document.querySelector(`.seg button[data-mode=${m}]`).click();
const COMMANDS = [
  { t: 'Ir a la demo', hint: 'Navegar', run: goTo('#demo') },
  { t: 'Ir a funciones', hint: 'Navegar', run: goTo('#funciones') },
  { t: 'Ir a precios', hint: 'Navegar', run: goTo('#precios') },
  { t: 'Ir a ayuda', hint: 'Navegar', run: goTo('#faq') },
  { t: 'Agregar periodo', hint: 'Datos', run: click('#add') },
  { t: 'Gráfica de línea', hint: 'Vista', run: setMode('line') },
  { t: 'Gráfica de barras', hint: 'Vista', run: setMode('bar') },
  { t: 'Exportar datos a CSV', hint: 'Datos', run: click('#export') },
  { t: 'Cambiar tema claro/oscuro', hint: 'Apariencia', run: click('#theme') },
];
let sel = 0, items = [];

function quickEntry(q) {
  const m = q.trim().match(/^(?:(\S+)\s+)?(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const labels = state.data.map((d) => d.label);
  const label = m[1] || (MONTHS.includes(labels[labels.length - 1]) ? nextLabels(labels, 1)[0] : `P${labels.length + 1}`);
  const value = parseFloat(m[2].replace(',', '.'));
  return { t: `Agregar «${label} · ${fmt.format(value)}» a los datos`, hint: 'Ingreso rápido', run: () => {
    const prev = snap();
    state.data.push({ label, value });
    renderRows(); update();
    toast(`Agregado ${label} · ${fmt.format(value)}`, prev);
  } };
}

function renderPalette() {
  const q = norm(pin.value);
  items = COMMANDS.filter((c) => norm(c.t).includes(q));
  const qe = quickEntry(pin.value);
  if (qe) items.unshift(qe);
  sel = Math.min(sel, Math.max(items.length - 1, 0));
  plist.innerHTML = items.length
    ? items.map((c, i) => `<li role="option" data-i="${i}" class="${i === sel ? 'on' : ''}"><span>${esc(c.t)}</span><small>${c.hint}</small></li>`).join('')
    : '<li class="empty">Sin resultados</li>';
}
function openPalette() { pal.hidden = false; pin.value = ''; sel = 0; renderPalette(); pin.focus(); }
function closePalette() { pal.hidden = true; }
function runItem(i) { const c = items[i]; if (!c) return; closePalette(); c.run(); }

document.getElementById('cmdk').addEventListener('click', openPalette);
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); return; }
  if (pal.hidden) return;
  if (e.key === 'Escape') closePalette();
  else if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(items.length, 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(items.length, 1); renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runItem(sel); }
});
pin.addEventListener('input', () => { sel = 0; renderPalette(); });
plist.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) runItem(+li.dataset.i); });
pal.addEventListener('mousedown', (e) => { if (e.target === pal) closePalette(); });
flagOutliers();
