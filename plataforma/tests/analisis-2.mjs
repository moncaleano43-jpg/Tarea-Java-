// Prueba de las pestañas Recuperación, Operación, Relaciones, Pronósticos y Constructor del módulo de análisis.
// Uso:  NODE_PATH=$(npm root -g) node plataforma/tests/analisis-2.mjs  [BUILD=/ruta/compilado.html] [SHOTS=/ruta/capturas]
// - abre cada pestaña con varios periodos y filtros de marca (sin errores de página, tiempos de pintado),
// - compara cifras clave con un cálculo independiente sobre los registros crudos,
// - prueba el Constructor con 7 combinaciones, guardar / recargar una vista y los parámetros del enlace,
// - toma capturas (1440 y 390 px, claro y oscuro) en SHOTS (fuera del repositorio: son datos reales).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const BUILD = process.env.BUILD || '/tmp/claude-0/an2.html';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/w2/shots';
mkdirSync(SHOTS, { recursive: true });

let fails = 0, passes = 0;
const check = (name, ok, extra = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${extra ? ' · ' + extra : ''}`); };
const near = (a, b, tol = 0.01) => a != null && b != null && Math.abs(a - b) <= Math.max(tol * Math.max(Math.abs(a), Math.abs(b)), 0.051);
const parseEs = (s) => { if (s == null) return null; const t = String(s).replace(/[^\d,.\-−]/g, '').replace('−', '-'); if (!t) return null; return Number(t.replace(/\./g, '').replace(',', '.')); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('file://' + BUILD);
await page.waitForTimeout(2500);

const abrir = async (hash, preset, brands = []) => {
  await page.evaluate(([pr, br]) => { const s = App.Analisis.state; s.preset = pr; s.brands = br; s.comparar = true; }, [preset, brands]);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector('.an-card, .an-empty', { timeout: 15000 });
  await page.waitForTimeout(350);
  await page.evaluate(() => App.Analisis.repintar()); // si el enlace no cambió, el marco no repinta solo
  await page.waitForTimeout(150);
};
const kpi = (label) => page.evaluate((l) => { const k = [...document.querySelectorAll('.ch-kpi')].find((e) => e.querySelector('.ch-kpi-l').textContent.trim().startsWith(l)); return k ? k.querySelector('.ch-kpi-n').textContent : null; }, label);
const repaint = () => page.evaluate(() => { const t = performance.now(); App.Analisis.repintar(); return Math.round(performance.now() - t); });

/* ---------- 1. Todas las pestañas: sin errores y con tiempos ---------- */
const TABS = ['recuperacion', 'operacion', 'relaciones', 'pronosticos', 'constructor'];
const PRESETS = [['7d', []], ['30d', []], ['90d', []], ['todo', []], ['90d', ['ESTANDAR']], ['mes', ['LIGHT', 'AZTECA']]];
for (const tab of TABS) {
  let max = 0;
  for (const [pr, br] of PRESETS) {
    const n0 = errs.length;
    await abrir('#/analisis/' + tab, pr, br);
    const ms = await repaint();
    max = Math.max(max, ms);
    const sinError = await page.evaluate(() => !document.querySelector('#anBody .an-empty b')?.textContent.includes('No se pudo calcular'));
    check(`${tab} · ${pr}${br.length ? ' · ' + br.join('+') : ''} sin errores`, errs.length === n0 && sinError, errs.slice(n0).join(' | '));
  }
  check(`${tab} pinta en < 300 ms (peor caso ${max} ms)`, max < 300);
}
// Operación: la otra vista (aseos)
await abrir('#/analisis/operacion', '90d');
await page.click('[data-vista="aseos"]'); await page.waitForTimeout(300);
for (const pr of ['30d', '90d', 'todo']) { await abrir('#/analisis/operacion', pr); if (!(await page.$('[data-vista="aseos"][aria-pressed="true"]'))) await page.click('[data-vista="aseos"]'); await page.waitForTimeout(200); check(`operación/aseos · ${pr} pinta en < 300 ms`, (await repaint()) < 300); }

/* ---------- 2. Cifras clave contra cálculo independiente ---------- */
// Recuperación (hoja cruda «Control Recuperada»)
for (const pr of ['90d', 'todo']) {
  await abrir('#/analisis/recuperacion', pr);
  const ref = await page.evaluate(() => {
    const S = App.OperationSources, r = App.Analisis.range();
    const ms = (v) => { const d = S.date(v); return d ? +App.U.parseDT(d) : null; };
    const N = (v) => { if (v == null || v === '' || v === '-') return null; const x = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null; };
    let n = 0, vol = 0, hl95 = 0, kg = 0; const hs = [];
    for (const rec of S.records('recuperacion', 'Control Recuperada')) {
      const c = rec.cells, b = ms(c[2]), e = ms(c[34]), t = e || b;
      if (t == null || t < r.from || t > r.to) continue;
      const y = N(c[22]), v = N(c[38]);
      if (v == null && y == null) continue;
      n++; vol += v || 0;
      const E = N(c[45]);
      if (v != null && E && E > 5 && E < 25) { const h = v * ((E * 260) / (260 - E)) / ((9.5 * 260) / 250.5); hl95 += h; kg += h * 9.86; }
      if (b != null && e != null && e >= b) hs.push((e - b) / 3600000);
    }
    hs.sort((a, b) => a - b); const med = hs.length ? (hs.length % 2 ? hs[hs.length >> 1] : (hs[hs.length / 2 - 1] + hs[hs.length / 2]) / 2) : null;
    return { n, vol, hl95, kg, med, a72: hs.filter((h) => h <= 72).length / hs.length * 100, m96: hs.filter((h) => h > 96).length, nh: hs.length };
  });
  check(`recuperación ${pr}: n = ${ref.n}`, parseEs(await kpi('Recuperaciones')) === ref.n, await kpi('Recuperaciones'));
  check(`recuperación ${pr}: Hl recuperados = ${ref.vol.toFixed(0)}`, near(parseEs(await kpi('Cerveza recuperada')), ref.vol, 0.001), await kpi('Cerveza recuperada'));
  check(`recuperación ${pr}: Hl a 9,5 °P = ${ref.hl95.toFixed(0)}`, near(parseEs(await kpi('Equivalente a 9,5')), ref.hl95, 0.002), await kpi('Equivalente a 9,5'));
  check(`recuperación ${pr}: kg = ${ref.kg.toFixed(0)}`, near(parseEs(await kpi('Kg ahorrados')), ref.kg, 0.002), await kpi('Kg ahorrados'));
  check(`recuperación ${pr}: mediana de horas = ${ref.med.toFixed(1)}`, near(parseEs(await kpi('Horas hasta recuperar')), ref.med, 0.01), await kpi('Horas hasta recuperar'));
  check(`recuperación ${pr}: % dentro de 72 h = ${ref.a72.toFixed(0)}`, near(parseEs(await kpi('Dentro de 72')), ref.a72, 0.02), await kpi('Dentro de 72'));
  check(`recuperación ${pr}: lotes > 96 h = ${ref.m96}`, (parseEs(await kpi('Pasaron de 96')) != null) && Math.abs(parseEs(await kpi('Pasaron de 96')) - (ref.m96 / ref.nh) * 100) < 0.6, await kpi('Pasaron de 96'));
}
// Trasiego (hojas crudas del programa)
for (const pr of ['90d', '30d']) {
  await abrir('#/analisis/operacion', pr);
  await page.evaluate(() => { const b = document.querySelector('[data-vista="trasiego"]'); if (b) b.click(); }); await page.waitForTimeout(250);
  const ref = await page.evaluate(() => {
    const S = App.OperationSources, r = App.Analisis.range();
    const ms = (v) => { const d = S.date(v); return d ? +App.U.parseDT(d) : null; };
    const d = []; let n = 0, plan = 0;
    for (const sh of ['CONTROL TRASIEGO', 'CONTROL TRASIEGO HISTÓRICO']) for (const rec of S.records('programa', sh)) {
      const c = rec.cells, pl = ms(c[5]), st = ms(c[6]), ac = ms(c[7]), t = st || ms(c[4]);
      if (t == null || !c[1] || t < r.from || t > r.to) continue;
      n++; if (pl != null && ac != null) d.push((ac - pl) / 3600000);
    }
    const s = d.slice().sort((a, b) => a - b), med = s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    return { n, nPlan: d.length, aT: d.filter((x) => x <= 1).length, perd: d.filter((x) => x > 0).reduce((a, b) => a + b, 0), med };
  });
  check(`trasiego ${pr}: actividades = ${ref.n}`, parseEs(await kpi('Actividades')) === ref.n, await kpi('Actividades'));
  check(`trasiego ${pr}: cumplimiento = ${(ref.aT / ref.nPlan * 100).toFixed(0)} %`, Math.abs(parseEs(await kpi('Cumplimiento del plan')) - (ref.aT / ref.nPlan) * 100) < 0.6, await kpi('Cumplimiento del plan'));
  check(`trasiego ${pr}: horas perdidas = ${ref.perd.toFixed(0)}`, near(parseEs(await kpi('Horas perdidas')), ref.perd, 0.003), await kpi('Horas perdidas'));
  check(`trasiego ${pr}: desvío mediano = ${ref.med.toFixed(1)}`, near(parseEs(await kpi('Desvío mediano')), ref.med, 0.02), await kpi('Desvío mediano'));
}
// Aseos
await abrir('#/analisis/operacion', '90d');
await page.click('[data-vista="aseos"]'); await page.waitForTimeout(300);
{
  const ref = await page.evaluate(() => {
    const r = App.Analisis.range(); const rows = App.DL.get('aseos').filter((x) => x.t >= r.from && x.t <= r.to);
    let m3 = 0, nm = 0, phN = 0, phOut = 0;
    for (const x of rows) { if (x.m3 != null) { m3 += x.m3; nm++; } if (x.ph != null && x.ph >= 3 && x.ph <= 11) { phN++; if (x.ph < 6 || x.ph > 8) phOut++; } }
    // cumplimiento: columna cruda 7 de «1. Cada uso»
    const ids = new Set(rows.map((x) => x.id)); let cu = 0, ok = 0;
    for (const rec of App.OperationSources.records('aseos', '1. Cada uso')) { if (!ids.has(rec.id)) continue; const v = rec.cells[7]; if (typeof v === 'number' && v >= 0 && v <= 1.0001) { cu++; if (v * 100 >= 99.9) ok++; } }
    return { n: rows.length, m3, mean: m3 / nm, phN, phOut, cuPct: ok / cu * 100 };
  });
  check(`aseos: n = ${ref.n}`, parseEs(await kpi('Aseos realizados')) === ref.n, await kpi('Aseos realizados'));
  check(`aseos: m³ totales = ${ref.m3.toFixed(0)}`, near(parseEs(await kpi('Agua estimada')), ref.m3, 0.002), await kpi('Agua estimada'));
  check(`aseos: m³ por aseo = ${ref.mean.toFixed(1)}`, near(parseEs(await kpi('Agua por aseo')), ref.mean, 0.02), await kpi('Agua por aseo'));
  check(`aseos: % cumplen parámetros = ${ref.cuPct.toFixed(0)}`, Math.abs(parseEs(await kpi('Cumplen todos')) - ref.cuPct) < 0.6, await kpi('Cumplen todos'));
  const phKpi = parseEs(await kpi('pH de enjuague en'));
  check(`aseos: % pH en 6–8 = ${(100 - ref.phOut / ref.phN * 100).toFixed(1)}`, Math.abs(phKpi - (100 - (ref.phOut / ref.phN) * 100)) < 0.6, String(phKpi));
}
// Relaciones: Pearson semanal mosto vs agua (por defecto) y ANOVA de atenuación por marca
await abrir('#/analisis/relaciones', '90d');
{
  const ref = await page.evaluate(() => {
    const r = App.Analisis.range(), DAY = 86400000;
    const monday = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); };
    const wk = (key) => { const m = new Map(); for (const x of App.DL.get('agua')) { if (x.t > r.to || x[key] == null) continue; if (['production', 'transfer'].includes(key) && !(x.production == null || (x.production >= 0 && x.production <= 30000)) ) continue; if (key === 'production' && x.transfer != null && !(x.transfer >= 0 && x.transfer <= 30000)) continue; const k = monday(x.t); m.set(k, (m.get(k) || 0) + x[key]); } return m; };
    const X = wk('production'), Y = wk('total'); const pts = [];
    X.forEach((v, k) => { if (Y.has(k) && k + 7 * DAY - 1 <= r.to) pts.push([v, Y.get(k)]); });
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0, syy = 0; pts.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
    // ANOVA atenuación por marca, todo el histórico hasta el fin del periodo
    const rows = App.DL.get('ferm').filter((x) => x.t <= r.to && x.atten != null); const g = new Map();
    rows.forEach((x) => { const b = x.brand; if (!b) return; if (!g.has(b)) g.set(b, []); g.get(b).push(x.atten); });
    const gs = [...g.values()].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length).slice(0, 12);
    const N = gs.reduce((a, v) => a + v.length, 0), gm = gs.flat().reduce((a, b) => a + b, 0) / N; let ssb = 0, ssw = 0;
    gs.forEach((v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; ssb += v.length * (m - gm) ** 2; v.forEach((y) => { ssw += (y - m) ** 2; }); });
    return { n, r: sxy / Math.sqrt(sxx * syy), F: (ssb / (gs.length - 1)) / (ssw / (N - gs.length)), k: gs.length, N };
  });
  const txt = await page.evaluate(() => document.querySelector('#rl-scatter')?.textContent || '');
  const m = /Correlación de Pearson (-?[\d,]+)/.exec(txt), mn = /n = (\d+) semanas/.exec(txt);
  check(`relaciones: Pearson mosto–agua = ${ref.r.toFixed(2)} (n = ${ref.n})`, m && Math.abs(parseEs(m[1]) - ref.r) < 0.006 && mn && +mn[1] === ref.n, m ? `${m[1]} / n=${mn && mn[1]}` : 'sin texto');
  const t2 = await page.evaluate(() => document.querySelector('#rl-grupos')?.textContent || '');
  const f = /F\((\d+), (\d+)\) = (\d+,\d+)/.exec(t2);
  check(`relaciones: ANOVA atenuación por marca F = ${ref.F.toFixed(2)}`, f && Math.abs(parseEs(f[3]) - ref.F) < 0.02 && +f[1] === ref.k - 1 && +f[2] === ref.N - ref.k, f ? f[0] : 'sin F');
  const matriz = await page.evaluate(() => !!document.querySelector('#rl-matriz svg'));
  check('relaciones: hay matriz de correlación y ranking', matriz && (await page.$$('.an-corr')).length > 0);
  // cambiar selectores
  await page.selectOption('#rl-met', 'spearman'); await page.waitForTimeout(250);
  await page.selectOption('#rl-gds', 'recuperacion'); await page.waitForTimeout(250);
  await page.selectOption('#rl-ay', 'aseos:m3'); await page.waitForTimeout(250);
  check('relaciones: selectores interactivos repintan sin error', !errs.some((e) => /relaciones|rl-/.test(e)));
}
// Pronósticos: modelo lineal a 1 semana y fin de mes de agua
await abrir('#/analisis/pronosticos', '90d');
{
  await page.selectOption('#pr-mod', 'lineal'); await page.waitForTimeout(250);
  await page.fill('#pr-h', '1'); await page.dispatchEvent('#pr-h', 'change'); await page.waitForTimeout(300);
  const ref = await page.evaluate(() => {
    const r = App.Analisis.range(), DAY = 86400000;
    const monday = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); };
    const m = new Map();
    for (const x of App.DL.get('agua')) { if (x.t > r.to || x.total == null) continue; const k = monday(x.t); if (!m.has(k)) m.set(k, { s: 0, n: 0 }); const e = m.get(k); e.s += x.total; e.n++; }
    const ks = [...m.keys()].sort((a, b) => a - b); const comp = []; let t = ks[0];
    while (t + 7 * DAY - 1 <= r.to) { const e = m.get(t); comp.push(e && e.n >= 15 ? e.s : null); const d = new Date(t); t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime(); }
    const y = comp.slice(-52).filter((v) => v != null), n = y.length, k = n; const xs = y.map((_, i) => i);
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (y[i] - my); sxx += (x - mx) ** 2; });
    const b = sxy / sxx, a = my - b * mx;
    // fin de mes: acumulado del último mes con dato
    const rows = App.DL.get('agua').filter((x) => x.total != null && x.t <= r.to); const T = new Date(rows[rows.length - 1].t);
    const m0 = new Date(T.getFullYear(), T.getMonth(), 1).getTime();
    const mtd = rows.filter((x) => x.t >= m0).reduce((a2, x) => a2 + x.total, 0);
    return { next: a + b * k, mtd, n };
  });
  const base = await page.evaluate(() => { const e = document.querySelectorAll('.an-esc > div')[1]; return e ? e.querySelector('b').textContent : null; });
  check(`pronósticos: base lineal a 1 semana = ${ref.next.toFixed(1)} m³ (n = ${ref.n})`, near(parseEs(base), ref.next, 0.002), base);
  const fm = await page.evaluate(() => /van ([\d.,]+) m³/.exec(document.querySelector('#pr-mes')?.textContent || '')?.[1] || null);
  check(`pronósticos: acumulado del mes de agua = ${ref.mtd.toFixed(0)}`, near(parseEs(fm), ref.mtd, 0.002), fm);
  for (const [m, by] of [['recH', 'week'], ['viab', 'month'], ['trDelay', 'day'], ['merma', 'month'], ['recVol', 'week']]) {
    const n0 = errs.length;
    await page.selectOption('#pr-m', m); await page.waitForTimeout(200);
    await page.selectOption('#pr-by', by); await page.waitForTimeout(250);
    const hay = await page.evaluate(() => !!document.querySelector('#pr-modelo svg') || !!document.querySelector('#pr-modelo .an-empty'));
    check(`pronósticos: ${m} por ${by} sin error`, errs.length === n0 && hay);
  }
}

/* ---------- 3. Constructor ---------- */
const combos = [
  ['ds=agua&m=total&agg=sum&by=week&per=1', 'agua'],
  ['ds=aseos&m=m3&agg=mean&by=equipment&ch=barsH&top=10&per=0', 'aseos'],
  ['ds=recuperacion&m=volume&agg=sum&by=brand&ch=pareto&per=0', 'recuperacion'],
  ['ds=ferm&m=h75&agg=median&by=month&ch=box&per=0', 'ferm'],
  ['ds=trasiego&m=delay&agg=mean&by=kind&ch=bars&cmp=1&per=1', 'trasiego'],
  ['ds=ferm&m=eo&x=e72&ch=scatter&by=brand&per=0', 'ferm'],
  ['ds=lev&m=viab&agg=mean&by=&ch=hist&per=0', 'lev'],
];
for (const [q, ds] of combos) {
  await abrir('#/analisis/constructor?' + q, '90d');
  const info = await page.evaluate(() => ({ svg: !!document.querySelector('#cx-resultado svg'), vacio: !!document.querySelector('#cx-resultado .an-empty'), regs: [...document.querySelectorAll('.ch-kpi')].find((e) => e.querySelector('.ch-kpi-l').textContent.startsWith('Registros'))?.querySelector('.ch-kpi-n').textContent }));
  const params = Object.fromEntries(new URLSearchParams(q));
  const ref = await page.evaluate((p) => {
    const r = App.Analisis.range(), st = App.Analisis.state;
    return App.DL.get(p.ds).filter((x) => (p.per === '0' || (x.t >= r.from && x.t <= r.to)) && (!['merma', 'recuperacion', 'trasiego', 'ferm', 'lev'].includes(p.ds) || !st.brands.length || st.brands.includes(x.brand))).length;
  }, params);
  check(`constructor ${q}: pinta (${info.svg ? 'gráfica' : info.vacio ? 'vacío' : '¿?'}) y n = ${ref}`, (info.svg || info.vacio) && parseEs(info.regs) === ref, info.regs);
}
// Exactitud del agrupado: suma semanal = suma total
await abrir('#/analisis/constructor?ds=recuperacion&m=volume&agg=sum&by=month&per=0', '90d');
{
  const r = await page.evaluate(() => {
    const tot = App.DL.get('recuperacion').reduce((a, x) => a + (x.volume || 0), 0);
    const suma = [...document.querySelectorAll('#tb-cx-agg tbody tr')].reduce((a, tr) => a + (Number(tr.children[1].textContent.replace(/\./g, '').replace(',', '.')) || 0), 0);
    return { tot, suma };
  });
  check(`constructor: suma de los grupos mensuales = total (${r.tot.toFixed(0)})`, near(r.suma, r.tot, 0.0005), String(r.suma));
}
// Enlace con parámetros, copiar enlace y restablecer
await abrir('#/analisis/constructor?ds=agua&m=total&by=week', 'todo');
check('constructor: el enlace con parámetros abre la pestaña Constructor ya configurada', await page.evaluate(() => document.querySelector('.an-tabs a.on')?.textContent === 'Constructor' && document.querySelector('#cx-ds').value === 'agua' && document.querySelector('#cx-by').value === 'week'));
// Guardar y recargar una vista
await page.selectOption('#cx-ds', 'trasiego'); await page.waitForTimeout(300);
await page.selectOption('#cx-by', 'brand'); await page.waitForTimeout(300);
check('constructor: al cambiar los selectores el enlace se actualiza', await page.evaluate(() => /ds=trasiego/.test(location.hash) && /by=brand/.test(location.hash)));
await page.fill('#cx-nombre', 'Prueba trasiego por marca');
await page.click('#cx-guardar'); await page.waitForTimeout(500);
check('constructor: la vista queda en «Mis vistas»', await page.evaluate(() => [...document.querySelectorAll('.an-vista')].some((e) => e.textContent.includes('Prueba trasiego por marca'))));
const guardado = await page.evaluate(() => JSON.stringify((App.S.config && App.S.config.cifraVistas) || null));
check('constructor: quedó en App.S.config.cifraVistas', /Prueba trasiego por marca/.test(guardado));
await page.reload(); await page.waitForTimeout(2500);
await page.evaluate(() => { location.hash = '#/analisis/constructor'; }); await page.waitForSelector('#cx-ds'); await page.waitForTimeout(300);
await page.selectOption('#cx-ds', 'agua'); await page.waitForTimeout(300);
const chip = await page.$('.an-vista [data-vista-cargar]');
check('constructor: la vista sigue después de recargar la página', !!chip);
if (chip) { await chip.click(); await page.waitForTimeout(400); }
check('constructor: al abrir la vista se restauran los controles', await page.evaluate(() => document.querySelector('#cx-ds').value === 'trasiego' && document.querySelector('#cx-by').value === 'brand'));
await page.click('[data-vista-borrar]'); await page.waitForTimeout(300);
check('constructor: se puede borrar la vista', await page.evaluate(() => !document.querySelector('.an-vista')));

/* ---------- 4. Capturas ---------- */
for (const [w, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']]) {
  const c2 = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme });
  const p2 = await c2.newPage();
  const e2 = []; p2.on('pageerror', (e) => e2.push(e.message));
  await p2.goto('file://' + BUILD); await p2.waitForTimeout(2500);
  for (const tab of TABS) {
    await p2.evaluate(() => { const s = App.Analisis.state; s.preset = '90d'; s.brands = []; });
    await p2.evaluate((t) => { location.hash = '#/analisis/' + t; }, tab);
    await p2.waitForSelector('.an-card'); await p2.waitForTimeout(500);
    await p2.screenshot({ path: `${SHOTS}/${tab}-${w}-${theme}.png`, fullPage: true });
    const ancho = await p2.evaluate(() => document.documentElement.scrollWidth);
    check(`captura ${tab} ${w} ${theme}: sin desborde horizontal de la página (${ancho} px)`, ancho <= w + 1);
  }
  check(`capturas ${w} ${theme} sin errores`, e2.length === 0, e2.join(' | '));
  await c2.close();
}

check('sin errores de página en toda la prueba', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${passes} correctas, ${fails} con falla`);
await browser.close();
process.exit(fails ? 1 : 0);
