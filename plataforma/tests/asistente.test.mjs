// Prueba del motor de Cifra con Playwright (Chromium).
// Uso: NODE_PATH=$(npm root -g) node plataforma/tests/asistente.test.mjs [ruta/al/html/compilado.html]
// El HTML compilado contiene datos de producción: déjalo fuera del repositorio (p. ej. /tmp/claude-0/asis.html).
// Verifica: intención reconocida (≠ respuesta genérica), gráficos donde se piden, seguimientos con memoria,
// cifras contra un cálculo independiente sobre App.DL, tiempos de respuesta y ausencia de errores de página.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(process.env.PW_ROOT ? process.env.PW_ROOT + '/' : '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const html = process.argv[2] || '/tmp/claude-0/asis.html';
const bank = JSON.parse(readFileSync(join(here, 'asistente-preguntas.json'), 'utf8'));
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(html).href);
await page.waitForFunction(() => window.App && App.Cifra && App.DL && App.S && App.S.ready, null, { timeout: 30000 });
await page.waitForTimeout(1500);

const BAD = new Set(['aclarar', 'error', 'vacio']);
const results = [];
const ask = (q, reset) => page.evaluate(async ({ q, reset }) => {
  if (reset) App.Cifra.olvidar();
  const r = await App.Cifra.preguntar(q);
  return { intent: r.intent, ds: r.spec ? r.spec.ds : null, conf: r.confianza, ms: r.ms, chart: !!r.hasChart, table: !!r.hasTable, valor: r.valor, texto: r.texto.slice(0, 220), per: r.spec && r.spec.period ? r.spec.period.label : null, chips: (r.opts || []).length };
}, { q, reset });

// 1) Preguntas independientes por categoría
for (const [cat, list] of [...Object.entries(bank.categorias), ...Object.entries(bank.libres || {})]) {
  for (const it of list) {
    const r = await ask(it.q, true);
    let good, why = '';
    if (it.legacy) { good = r.intent === 'legacy' && r.texto.length > 5; if (!good) why = 'debía responder el motor anterior'; }
    else {
      good = !BAD.has(r.intent) && r.texto.length > 20;
      if (!good) why = 'sin respuesta útil (' + r.intent + ')';
      if (good && it.ok && !it.ok.includes(r.intent)) { good = false; why = 'intención ' + r.intent + ' no esperada (' + it.ok.join('/') + ')'; }
      if (good && it.chart && !r.chart) { good = false; why = 'faltó el gráfico'; }
      if (good && it.ds && r.ds && r.ds !== it.ds) { good = false; why = 'tema ' + r.ds + ' en vez de ' + it.ds; }
      if (it.ruido) { good = it.ok.includes(r.intent); why = good ? '' : 'el ruido no debía responderse como ' + r.intent; }
    }
    results.push({ tipo: 'pregunta', cat, q: it.q, good, why, ...r });
  }
}
// 2) Secuencias con memoria
await page.evaluate(() => App.Cifra.olvidar());
for (const s of bank.secuencias) {
  await page.evaluate(() => App.Cifra.olvidar());
  for (const st of s.steps) {
    const r = await ask(st.q, false);
    let good = !BAD.has(r.intent) && r.texto.length > 15, why = '';
    if (!good) why = 'sin respuesta útil (' + r.intent + ')';
    if (good && st.ok && !st.ok.includes(r.intent)) { good = false; why = 'intención ' + r.intent + ' no esperada (' + st.ok.join('/') + ')'; }
    if (good && st.chart && !r.chart) { good = false; why = 'faltó el gráfico'; }
    if (good && st.periodo && !(r.per || '').toLowerCase().includes(st.periodo)) { good = false; why = 'no heredó/cambió el periodo (' + r.per + ')'; }
    results.push({ tipo: 'seguimiento', cat: 'seq: ' + s.name, q: st.q, good, why, ...r });
  }
}
// 3) Cifras contra cálculo independiente
const numRes = [];
for (const it of bank.numericas) {
  const r = await ask(it.q, true);
  const exp = await page.evaluate((c) => {
    const DL = App.DL, ref = App.Cifra._refTime();
    const day = (t) => new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate()).getTime();
    const parse = (s) => { if (s === 'REF') return day(ref) + 864e5 - 1; const m = /^REF-(\d+)$/.exec(s); if (m) return day(ref) - +m[1] * 864e5; const [y, mo, d] = s.split('-').map(Number); return new Date(y, mo - 1, d).getTime(); };
    const t0 = parse(c.from_), t1 = c.to === 'REF' ? parse('REF') : parse(c.to) + 864e5 - 1;
    let rows = DL.get(c.ds).filter((r) => r.t != null && r.t >= t0 && r.t <= Math.min(t1, day(ref) + 864e5 - 1));
    if (c.brand) rows = rows.filter((r) => r.brand === c.brand);
    if (c.kind) rows = rows.filter((r) => r.kind === c.kind);
    if (c.state) rows = rows.filter((r) => r.state === c.state);
    if (c.eqType) rows = rows.filter((r) => new RegExp('^\\s*' + c.eqType + '\\s*0*' + c.tqN + '(?!\\d)', 'i').test(String(r.equipment || '')));
    const [lo, hi] = c.plaus || [-Infinity, Infinity];
    const ok = (r) => { const v = r[c.k]; return v != null && Number.isFinite(+v) && v >= lo && v <= hi; };
    if (c.agg === 'count') { if (c.gt != null) return rows.filter((r) => ok(r) && r[c.k] > c.gt).length; return rows.length; }
    if (c.agg === 'wmean') { const rr = rows.filter((r) => r.loss != null && r.input > 0 && r.lossPct >= lo && r.lossPct <= hi && r.lossPct <= 100); let a = 0, b = 0; rr.forEach((r) => { a += r.loss; b += r.input; }); return (a / b) * 100; }
    const v = rows.filter(ok).map((r) => +r[c.k]);
    if (c.agg === 'share_lt') return (v.filter((x) => x < c.v).length / v.length) * 100;
    if (c.agg === 'sum') return v.reduce((x, y) => x + y, 0);
    if (c.agg === 'mean') return v.reduce((x, y) => x + y, 0) / v.length;
    if (c.agg === 'max') return Math.max(...v);
    if (c.agg === 'median') { const s = v.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    return null;
  }, it.calc);
  const good = r.valor != null && Number.isFinite(exp) && Math.abs(r.valor - exp) <= 1e-6 * Math.max(1, Math.abs(exp)) + 1e-9;
  numRes.push({ q: it.q, esperado: exp, obtenido: r.valor, good, intent: r.intent });
  results.push({ tipo: 'numérica', cat: 'numérica', q: it.q, good, why: good ? '' : 'esperado ' + exp + ' y obtuve ' + r.valor, ...r });
}

await browser.close();

// Informe
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const q = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
const cats = {};
for (const r of results) { (cats[r.cat] = cats[r.cat] || { n: 0, ok: 0 }); cats[r.cat].n++; if (r.good) cats[r.cat].ok++; }
const fails = results.filter((r) => !r.good);
const useful = results.filter((r) => !BAD.has(r.intent) && r.texto.length > 15).length;
console.log('\nCifra · prueba del motor');
console.log('Preguntas:', results.length, '| con respuesta útil (≠ genérica):', useful, '(' + pct(useful, results.length) + ' %) | correctas con sus expectativas:', results.length - fails.length, '(' + pct(results.length - fails.length, results.length) + ' %)');
console.log('Cifras verificadas:', numRes.filter((x) => x.good).length + '/' + numRes.length);
console.log('Gráficos presentes:', results.filter((r) => r.chart).length, '| con tabla:', results.filter((r) => r.table).length);
console.log('Tiempos (ms): mediana', Math.round(q(0.5)), '· p90', Math.round(q(0.9)), '· p95', Math.round(q(0.95)), '· máx', Math.round(ms[ms.length - 1]), '· >500 ms:', ms.filter((x) => x > 500).length);
console.log('Por categoría:', Object.entries(cats).map(([k, v]) => k + ' ' + v.ok + '/' + v.n).join(' | '));
if (fails.length) { console.log('\nFallos (' + fails.length + '):'); for (const f of fails) console.log(' -', '[' + f.cat + ']', f.q, '→', f.why, '|', f.texto.slice(0, 90)); }
console.log('\nErrores de página:', pageErrors.length ? pageErrors.slice(0, 5) : 'ninguno');
writeFileSync(process.env.CIFRA_REPORT || '/tmp/claude-0/asistente-report.json', JSON.stringify({ total: results.length, utiles: useful, fallos: fails, numericas: numRes, ms: { p50: q(0.5), p90: q(0.9), p95: q(0.95), max: ms[ms.length - 1] }, errores: pageErrors }, null, 1));
const badNum = numRes.filter((x) => !x.good).length;
if (pageErrors.length || badNum || pct(useful, results.length) < 95 || pct(results.length - fails.length, results.length) < 90) process.exit(1);
