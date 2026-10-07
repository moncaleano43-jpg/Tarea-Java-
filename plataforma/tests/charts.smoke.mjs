// Prueba de humo de 25-charts.js: node tests/charts.smoke.mjs  (NODE_PATH=$(npm root -g))
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const outDir = process.env.CHARTS_OUT || '/tmp/claude-0';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(path.join(here, 'charts-demo.html')).href);
await page.waitForSelector('[data-chart] svg');

const fails = [];
const report = await page.$$eval('[data-chart]', els => els.map(s => {
  const svg = s.querySelector('svg');
  return { name: s.dataset.chart, svg: !!svg, kids: svg ? svg.querySelectorAll('*').length : 0, aria: svg ? svg.getAttribute('aria-label') : null, empty: !!s.querySelector('.ch-is-empty') };
}));
for (const r of report) {
  const shouldBeEmpty = r.name.startsWith('empty-');
  if (!r.svg) fails.push(r.name + ': sin <svg>');
  else if (r.kids < (shouldBeEmpty ? 1 : r.name === 'spark' ? 3 : 5)) fails.push(r.name + ': SVG casi vacío (' + r.kids + ')');
  if (!shouldBeEmpty && r.empty) fails.push(r.name + ': mostró estado vacío');
  if (shouldBeEmpty && !r.empty) fails.push(r.name + ': debía mostrar estado vacío');
  if (r.svg && !r.aria) fails.push(r.name + ': sin aria-label');
}
if (await page.$$eval('.ch-kpi', e => e.length) < 4) fails.push('faltan tarjetas KPI');
// colores fijos incrustados
const hard = await page.$$eval('svg.ch-svg [fill],svg.ch-svg [stroke]', els => els.filter(e => /#|rgb/i.test((e.getAttribute('fill') || '') + (e.getAttribute('stroke') || ''))).length);
if (hard) fails.push('SVG con colores fijos en atributos: ' + hard);
// exportación PNG/SVG
const exp = await page.evaluate(async () => {
  const fg = document.querySelector('#c-line');
  const b = await App.Charts.svgToPng(fg, 2);
  const s = await App.Charts.svgToPng(App.Charts.bars({ data: [{ label: 'a', value: 2 }] }), 1);
  return { png: b.size, type: b.type, png2: s.size };
});
if (!(exp.png > 2000) || !(exp.png2 > 500)) fails.push('svgToPng devolvió imagen sospechosa: ' + JSON.stringify(exp));
// robustez: datos raros nunca lanzan
const robust = await page.evaluate(() => {
  const C = App.Charts, bad = [];
  const junk = [undefined, null, {}, { data: null }, { series: [{ data: [null, 'x'] }] }, { points: [{ x: 'a', y: 'b' }] }, { items: [{}] }, { values: [NaN] }, { rows: [], cols: [] }, { days: [{ date: 'zz' }] }, { steps: [{}] }];
  for (const k of ['line', 'bars', 'barsH', 'stacked', 'histogram', 'scatter', 'box', 'heatmap', 'control', 'pareto', 'spark', 'sparkBars', 'donut', 'gauge', 'waterfall', 'gantt', 'calendar', 'kpi'])
    for (const j of junk) { try { if (typeof C[k](j) !== 'string') bad.push(k); } catch (e) { bad.push(k + ':' + e.message); } }
  return bad;
});
if (robust.length) fails.push('lanzó con datos vacíos: ' + robust.join(', '));

await page.screenshot({ path: path.join(outDir, 'charts-light.png'), fullPage: true });
await page.click('#theme');
if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') fails.push('el botón no cambió a oscuro');
await page.screenshot({ path: path.join(outDir, 'charts-dark.png'), fullPage: true });
await browser.close();

if (errors.length) fails.push(...errors);
if (fails.length) { console.error('FALLOS:\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('OK: ' + report.length + ' gráficas verificadas; capturas en ' + outDir);
