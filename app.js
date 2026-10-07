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

// Modelos de proyección: devuelve base, límite superior (optimista) e inferior (pesimista)
function forecast(vals, ahead, model) {
  const n = vals.length;
  const none = { proj: [], up: [], lo: [], r2: null, name: 'Lineal', note: '' };
  if (n < 2 || !ahead) return none;
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  const sst = vals.reduce((s, v) => s + (v - mean) ** 2, 0);
  const r2 = (pred) => (sst ? 1 - vals.reduce((s, v, i) => s + (v - pred(i)) ** 2, 0) / sst : 1);
  const build = (f, lo, hi, name, note = '') => {
    const proj = Array.from({ length: ahead }, (_, j) => f(n + j));
    return { proj, up: proj.map((v, j) => hi(v, j)), lo: proj.map((v, j) => lo(v, j)), r2: r2(f), name, note };
  };
  if (model === 'exp' && vals.every((v) => v > 0)) {
    const r = regress(vals.map(Math.log)), k = Math.exp(1.5 * r.se);
    return build((i) => Math.exp(r.m * i + r.b), (v) => v / k, (v) => v * k, 'Exponencial');
  }
  if (model === 'media') {
    const w = Math.min(3, n), last = vals.slice(-w), level = last.reduce((s, v) => s + v, 0) / w;
    let sse = 0, cnt = 0, sr = 0;
    for (let i = w; i < n; i++) {
      const p = vals.slice(i - w, i).reduce((s, v) => s + v, 0) / w;
      sse += (vals[i] - p) ** 2; sr += (vals[i] - p) ** 2; cnt++;
    }
    const se = cnt ? Math.sqrt(sse / cnt) : Math.sqrt(last.reduce((s, v) => s + (v - level) ** 2, 0) / w);
    const out = build(() => level, (v) => v - 1.5 * se, (v) => v + 1.5 * se, `Media móvil (${w})`);
    out.r2 = cnt && sst ? 1 - sr / sst : null;
    return out;
  }
  const r = regress(vals), band = 1.5 * r.se;
  const note = model === 'exp' ? 'El modelo exponencial requiere valores mayores que 0; se usó el lineal.' : '';
  return build((i) => r.m * i + r.b, (v) => v - band, (v) => v + band, 'Lineal', note);
}

function drawChart(el, data, { mode = 'line', ahead = 4, model = 'lineal', scen = false, focus = 'base' } = {}) {
  el._args = [data, { mode, ahead, model, scen, focus }];
  const W = el.clientWidth || 640, H = W < 500 ? 260 : 320;
  const P = { l: 44, r: 14, t: 14, b: 28 };
  const vals = data.map((d) => d.value);
  const F = forecast(vals, ahead, model);
  const { proj, up, lo } = F;
  const k = proj.length;
  const labels = [...data.map((d) => d.label), ...nextLabels(data.map((d) => d.label), k)];
  const N = labels.length;

  let max = Math.max(0, ...vals, ...up);
  let min = Math.min(0, ...vals, ...lo);
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
        const upP = up.map((v, j) => `${x(n + j)},${y(v)}`);
        const loP = lo.map((v, j) => `${x(n + j)},${y(v)}`).reverse();
        g += `<polygon class="band" points="${x(n - 1)},${y(vals[n - 1])} ${upP.join(' ')} ${loP.join(' ')}"/>`;
        if (scen) {
          const line = (arr, cls) => `<polyline class="ln-s ${cls}" points="${x(n - 1)},${y(vals[n - 1])} ${arr.map((v, j) => `${x(n + j)},${y(v)}`).join(' ')}"/>`;
          g += line(up, 'ln-opt' + (focus === 'opt' ? ' hot' : '')) + line(lo, 'ln-pes' + (focus === 'pes' ? ' hot' : ''));
        }
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
      tip.innerHTML = `${esc(labels[i])}${real ? '' : ' · proyección'}<b>${fmt.format(v)}</b>${real ? '' : `<span>Rango ${fmt.format(lo[i - n])} – ${fmt.format(up[i - n])}</span>`}`;
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
function defaultData() { return [32, 38, 41, 47, 45, 55, 61, 66].map((value, i) => ({ label: MONTHS[i], value })); }
const state = {
  data: defaultData(),
  mode: 'line',
  ahead: 4,
  model: 'lineal',
  scen: 'base',
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
  const F = forecast(vals, state.ahead, state.model);
  const key = { pes: 'lo', base: 'proj', opt: 'up' }[state.scen], arr = F[key];
  set('k-proj', arr.length ? fmt.format(arr[arr.length - 1]) : '–');
  set('k-proj-l', `Proyección · ${{ pes: 'pesimista', base: 'base', opt: 'optimista' }[state.scen]}`);
  set('fit', F.note || (F.proj.length ? `Modelo ${F.name}${F.r2 == null ? '' : ` · ajuste R² ${F.r2.toFixed(2).replace('.', ',')}`}` : ''));
  drawChart(demo, state.data, { mode: state.mode, ahead: state.ahead, model: state.model, scen: true, focus: state.scen });
  flagOutliers();
  saveSession();
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
document.querySelectorAll('.seg[data-g] button').forEach((b) => b.addEventListener('click', () => {
  const g = b.closest('.seg').dataset.g;
  state[g] = b.dataset[g];
  syncControls();
  update();
}));
document.getElementById('ahead').addEventListener('input', (e) => {
  state.ahead = +e.target.value;
  syncControls();
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

loadSession();
renderRows();
syncControls();
update();
watch(demo);

/* ---------- Validación en vivo: datos atípicos ---------- */
function fitXY(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  xs.forEach((x, i) => { sx += x; sy += ys[i]; sxy += x * ys[i]; sxx += x * x; });
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - m * sx) / n;
  const se = Math.sqrt(xs.reduce((s, x, i) => s + (ys[i] - (m * x + b)) ** 2, 0) / Math.max(n - 2, 1));
  return { m, b, se };
}
function flagOutliers() {
  const vals = state.data.map((d) => d.value), reg = regress(vals);
  const warn = document.getElementById('warn');
  const bad = [];
  const span = Math.max(...vals) - Math.min(...vals);
  if (vals.length >= 5) {
    // Cada punto se compara con la tendencia calculada SIN él, para que un valor extremo no se "esconda"
    vals.forEach((v, i) => {
      const xs = [], ys = [];
      vals.forEach((w, k) => { if (k !== i) { xs.push(k); ys.push(w); } });
      const r = fitXY(xs, ys);
      const dev = Math.abs(v - (r.m * i + r.b));
      if (r.se > 0 && dev > 3 * r.se && dev > 0.25 * span) bad.push(i);   // estadísticamente raro Y relevante a la escala
    });
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
  { t: 'Modelo exponencial', hint: 'Proyección', run: click('.seg button[data-model=exp]') },
  { t: 'Modelo lineal', hint: 'Proyección', run: click('.seg button[data-model=lineal]') },
  { t: 'Escenario optimista', hint: 'Proyección', run: click('.seg button[data-scen=opt]') },
  { t: 'Escenario pesimista', hint: 'Proyección', run: click('.seg button[data-scen=pes]') },
  { t: 'Descargar gráfica (PNG)', hint: 'Exportar', run: click('#png') },
  { t: 'Restablecer datos de ejemplo', hint: 'Datos', run: click('#reset') },
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

/* ---------- Controles sincronizados ---------- */
function syncControls() {
  document.querySelectorAll('.seg[data-g]').forEach((seg) => {
    const g = seg.dataset.g;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[g] === state[g]));
  });
  document.getElementById('ahead').value = state.ahead;
  document.getElementById('ahead-out').textContent = state.ahead;
}

/* ---------- Guardado automático en el navegador ---------- */
function saveSession() {
  try { localStorage.setItem('cifra:v1', JSON.stringify({ data: state.data, mode: state.mode, ahead: state.ahead, model: state.model, scen: state.scen })); } catch (_) {}
}
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem('cifra:v1') || 'null');
    if (!s || !Array.isArray(s.data) || !s.data.length) return;
    state.data = s.data.slice(0, 200).map((d) => ({ label: String(d.label), value: Number(d.value) || 0 }));
    if (['line', 'bar'].includes(s.mode)) state.mode = s.mode;
    if (['lineal', 'exp', 'media'].includes(s.model)) state.model = s.model;
    if (['pes', 'base', 'opt'].includes(s.scen)) state.scen = s.scen;
    if (Number.isInteger(s.ahead) && s.ahead >= 0 && s.ahead <= 12) state.ahead = s.ahead;
  } catch (_) {}
}
document.getElementById('reset').addEventListener('click', () => {
  const prev = snap();
  Object.assign(state, { data: defaultData(), mode: 'line', ahead: 4, model: 'lineal', scen: 'base' });
  renderRows(); syncControls(); update();
  toast('Datos de ejemplo restablecidos', prev);
});

/* ---------- Pegar desde Excel ---------- */
function parseNum(s) {
  s = String(s).trim().replace(/\s/g, '');
  s = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
  const v = parseFloat(s);
  return Number.isNaN(v) ? null : v;
}
document.querySelector('.studio__side').addEventListener('paste', (e) => {
  const t = (e.clipboardData || window.clipboardData).getData('text');
  if (!/[\t\n]/.test(t.trim())) return;               // un solo valor: pegado normal
  const out = [];
  t.trim().split(/\r?\n/).forEach((line) => {
    const c = line.split(/\t|;/).map((x) => x.trim());
    const v = parseNum(c.length >= 2 ? c[1] : c[0]);
    if (v !== null) out.push({ label: c.length >= 2 ? c[0] : '', value: v });
  });
  if (!out.length) return;
  e.preventDefault();
  const prev = snap();
  state.data = out.slice(0, 200).map((o, i) => ({ label: o.label || MONTHS[i] || `P${i + 1}`, value: o.value }));
  renderRows(); update();
  toast(`Se pegaron ${state.data.length} filas`, prev);
});

/* ---------- Descargar la gráfica (SVG / PNG) ---------- */
const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'stop-color', 'stop-opacity'];
function chartSvg() {
  const src = demo.querySelector('svg');
  if (!src) return null;
  const clone = src.cloneNode(true);
  clone.querySelectorAll('.hit').forEach((n) => n.remove());
  const a = [src, ...src.querySelectorAll('*')].filter((n) => !n.classList.contains('hit'));
  const b = [clone, ...clone.querySelectorAll('*')];
  a.forEach((n, i) => {                               // fija los colores resueltos para que el archivo sea autónomo
    const cs = getComputedStyle(n);
    b[i].setAttribute('style', STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  const w = +src.getAttribute('width'), h = +src.getAttribute('height');
  const bg = getComputedStyle(document.querySelector('.studio__main')).backgroundColor;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.insertAdjacentHTML('afterbegin', `<rect width="${w}" height="${h}" style="fill:${bg}"/>`);
  return { text: new XMLSerializer().serializeToString(clone), w, h };
}
function download(href, name) {
  const a = document.createElement('a');
  a.href = href; a.download = name; a.click();
}
document.getElementById('svg').addEventListener('click', () => {
  const s = chartSvg();
  if (!s) return;
  const u = URL.createObjectURL(new Blob([s.text], { type: 'image/svg+xml' }));
  download(u, 'cifra-grafica.svg');
  setTimeout(() => URL.revokeObjectURL(u), 1000);
  toast('Gráfica descargada (SVG)');
});
document.getElementById('png').addEventListener('click', () => {
  const s = chartSvg();
  if (!s) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = s.w * 2; c.height = s.h * 2;
    const x = c.getContext('2d');
    x.scale(2, 2); x.drawImage(img, 0, 0);
    c.toBlob((bl) => {
      const u = URL.createObjectURL(bl);
      download(u, 'cifra-grafica.png');
      setTimeout(() => URL.revokeObjectURL(u), 1000);
      toast('Gráfica descargada (PNG)');
    });
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.text);
});
