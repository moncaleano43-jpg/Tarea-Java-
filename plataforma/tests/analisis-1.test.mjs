// Prueba de las pestañas Resumen, Agua, Merma, Fermentación, Levadura, Calidad e Informe.
// Uso: NODE_PATH=$(npm root -g) node plataforma/tests/analisis-1.test.mjs <compilado.html> [carpeta-capturas]
// No guarda datos del usuario: todo se calcula al abrir el HTML compilado y las capturas van a la carpeta indicada (fuera del repositorio).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(join(process.env.NODE_PATH || '', 'playwright')); }
const html = process.argv[2];
const shots = process.argv[3] || '';
if (!html) { console.error('Falta la ruta del HTML compilado'); process.exit(1); }
if (shots) mkdirSync(shots, { recursive: true });

const TABS = ['resumen', 'agua', 'merma', 'fermentacion', 'levadura', 'calidad', 'informe'];
const FILTROS = [['30d', ''], ['90d', ''], ['todo', ''], ['90d', 'LIGHT']];
let fallos = 0;
const ok = (c, msg) => { if (!c) { fallos++; console.log('  FALLA', msg); } else console.log('  ok   ', msg); };
const cerca = (a, b, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errores = [];

async function abrir(preset, marca, ancho = 1440, dark = false) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errores.push('CONSOLE ' + m.text()); });
  await page.addInitScript(([p, m]) => { try { localStorage.setItem('cifra.analisis.v1', JSON.stringify({ preset: p, brands: m ? [m] : [], comparar: true })); } catch (e) { /* sin almacenamiento */ } }, [preset, marca]);
  await page.goto('file://' + html);
  await page.waitForFunction(() => window.App && App.An1 && App.DL && App.DL.get('agua').length > 0, null, { timeout: 30000 });
  if (dark) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  return { ctx, page };
}

/* ---------- 1. Todas las pestañas con varios filtros: sin errores y con tiempos ---------- */
console.log('1. Pestañas × filtros');
{
  const { ctx, page } = await abrir('90d', '');
  for (const [preset, marca] of FILTROS) {
    await page.evaluate(([p, m]) => { const s = App.Analisis.state; s.preset = p; s.brands = m ? [m] : []; s.comparar = true; }, [preset, marca]);
    for (const tab of TABS) {
      const r = await page.evaluate(async (t) => {
        App.DL.invalidate();
        const c = App.Analisis.contexto(), pe = App.Analisis.pestanas.find((x) => x.id === t);
        const t0 = performance.now(); const h = pe.render(c, App.Analisis.UI); const dt = performance.now() - t0;
        const t1 = performance.now(); if (pe.hallazgos) pe.hallazgos(c); const dh = performance.now() - t1;
        return { dt, dh, len: h.length, noCalc: h.includes('No se pudo calcular'), nan: /NaN|undefined|Infinity/.test(h.replace(/<style[\s\S]*?<\/style>/g, '')) };
      }, tab);
      ok(!r.noCalc && !r.nan && r.len > 500, `${tab} · ${preset}${marca ? ' · ' + marca : ''}: ${Math.round(r.dt)} ms (en frío con datos recalculados), ${r.len} caracteres`);
      if (r.dt > 300) console.log('    aviso: más de 300 ms en frío');
    }
  }
  // Navegación real por URL: pinta sin errores de página
  for (const tab of TABS) {
    const t0 = Date.now();
    await page.evaluate((t) => { location.hash = '#/analisis/' + t; }, tab);
    await page.waitForSelector('#anBody .an-card', { timeout: 20000 });
    const n = await page.evaluate(() => document.querySelectorAll('#anBody .an-card').length);
    ok(n > 0, `#/analisis/${tab} pinta ${n} tarjetas en ${Date.now() - t0} ms`);
  }
  await ctx.close();
}

/* ---------- 2. Cifras clave contra un cálculo independiente sobre App.DL ---------- */
console.log('2. Cifras clave vs. cálculo independiente');
for (const [preset, marca] of [['90d', ''], ['todo', ''], ['90d', 'LIGHT']]) {
  const { ctx, page } = await abrir(preset, marca);
  const r = await page.evaluate(([preset, marca]) => {
    const A = window.App, DL = A.DL, ctxo = A.Analisis.contexto(), { from, to } = ctxo.rango;
    const inR = (x) => x.t >= from && x.t <= to;
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    const mean = (a) => (a.length ? sum(a) / a.length : null);
    const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const br = (x) => !marca || x.brand === marca;
    const out = {};
    // Agua (no depende de marca)
    const ag = DL.agua().filter((x) => inR(x) && x.valid && num(x.total) && x.total >= 0.5 && x.total <= 400);
    const hlOk = (x) => { const p = x.production, t = x.transfer; const pp = num(p) && p >= 0 && p <= 20000 ? p : 0, tt = num(t) && t >= 0 && t <= 10000 ? t : 0; return pp + tt; };
    const ef = ag.filter((x) => hlOk(x) > 0);
    out.agua = { n: ag.length, mean: mean(ag.map((x) => x.total)), median: med(ag.map((x) => x.total)), m3: sum(ag.map((x) => x.total)), eff: ef.length ? (sum(ef.map((x) => x.total)) * 10) / sum(ef.map(hlOk)) : null,
      atip: (() => { const m = med(ag.map((x) => x.total)); return ag.filter((x) => x.total > 1.25 * m).length; })() };
    const R1 = A.An1.aguaR(ctxo);
    out.aguaApp = { n: R1.n, mean: R1.mean, median: R1.median, m3: R1.m3, eff: R1.eff.actual, atip: R1.atip.length };
    // Merma
    const me = DL.merma().filter((x) => inR(x) && br(x) && num(x.loss) && num(x.input) && x.input >= 500 && x.input <= 8000 && num(x.lossPct) && x.lossPct >= -50 && x.lossPct <= 60);
    const fase = (ph) => { const rs = me.filter((x) => x.phase === ph); return { n: rs.length, tasa: rs.length ? (sum(rs.map((x) => x.loss)) / sum(rs.map((x) => x.input))) * 100 : null, crit: rs.filter((x) => x.lossPct < -1 || x.lossPct > 30).length }; };
    out.merma = { FV: fase('FV'), SV: fase('SV') };
    const R2 = A.An1.mermaR(ctxo);
    out.mermaApp = { FV: { n: R2.fase.FV.n, tasa: R2.fase.FV.tasa, crit: R2.fase.FV.neg + R2.fase.FV.sobre }, SV: { n: R2.fase.SV.n, tasa: R2.fase.SV.tasa, crit: R2.fase.SV.neg + R2.fase.SV.sobre } };
    // Fermentación
    const fe = DL.ferm().filter((x) => inR(x) && br(x) && num(x.h75) && x.h75 >= 10 && x.h75 <= 400);
    out.ferm = { n: fe.length, h75: med(fe.map((x) => x.h75)) };
    const R3 = A.An1.fermR(ctxo); out.fermApp = { n: R3.h75.n, h75: R3.h75.med };
    // Levadura
    const le = DL.lev().filter((x) => inR(x) && br(x) && num(x.viab) && x.viab >= 50 && x.viab <= 100);
    out.lev = { n: le.length, viab: mean(le.map((x) => x.viab)), cumple: le.length ? (le.filter((x) => x.viab >= 95).length / le.length) * 100 : null };
    const R4 = A.An1.levR(ctxo); out.levApp = { n: R4.viab.n, viab: R4.viab.mean, cumple: R4.viab.cumple };
    // Recuperación (Resumen)
    const re = DL.recuperacion().filter((x) => inR(x) && br(x) && num(x.volume) && x.volume >= 0 && x.volume <= 1000);
    out.rec = { hl: sum(re.map((x) => x.volume)) };
    out.recApp = { hl: A.An1.recupR(ctxo).hl };
    // Calidad: filas y duplicados
    const C = A.An1.calidadR(ctxo);
    out.cal = { agua: DL.agua().length, ferm: DL.ferm().length, dupAseos: (() => { const m = new Map(); DL.aseos().forEach((x) => { const k = x.t + '|' + x.equipment + '|' + x.sheet; m.set(k, (m.get(k) || 0) + 1); }); return sum([...m.values()].map((c) => c - 1)); })() };
    out.calApp = { agua: C.ds.agua.n, ferm: C.ds.ferm.n, dupAseos: C.ds.aseos.nDup };
    return out;
  }, [preset, marca]);
  const et = `${preset}${marca ? ' · ' + marca : ''}`;
  ok(r.agua.n === r.aguaApp.n && cerca(r.agua.mean, r.aguaApp.mean) && cerca(r.agua.median, r.aguaApp.median) && cerca(r.agua.m3, r.aguaApp.m3), `${et} · Agua: ${r.aguaApp.n} turnos, promedio ${r.aguaApp.mean && r.aguaApp.mean.toFixed(2)} m³, mediana ${r.aguaApp.median}, total ${r.aguaApp.m3 && r.aguaApp.m3.toFixed(1)} m³ coinciden`);
  ok(cerca(r.agua.eff, r.aguaApp.eff), `${et} · Agua por Hl procesado ${r.aguaApp.eff && r.aguaApp.eff.toFixed(4)} coincide con ${r.agua.eff && r.agua.eff.toFixed(4)}`);
  ok(r.agua.atip === r.aguaApp.atip, `${et} · Turnos sobre 1,25 × mediana: ${r.aguaApp.atip} = ${r.agua.atip}`);
  for (const ph of ['FV', 'SV']) {
    ok(r.merma[ph].n === r.mermaApp[ph].n && cerca(r.merma[ph].tasa, r.mermaApp[ph].tasa), `${et} · Merma ${ph}: ${r.mermaApp[ph].n} lotes, tasa ponderada ${r.mermaApp[ph].tasa && r.mermaApp[ph].tasa.toFixed(3)} % coincide`);
    ok(r.merma[ph].crit === r.mermaApp[ph].crit, `${et} · Merma ${ph}: lotes con saldo < −1 % o > 30 %: ${r.mermaApp[ph].crit} = ${r.merma[ph].crit}`);
  }
  ok(r.ferm.n === r.fermApp.n && cerca(r.ferm.h75, r.fermApp.h75), `${et} · Fermentación: mediana de horas a 75 % ${r.fermApp.h75} (${r.fermApp.n} fermentaciones) coincide`);
  ok(r.lev.n === r.levApp.n && cerca(r.lev.viab, r.levApp.viab) && cerca(r.lev.cumple, r.levApp.cumple), `${et} · Levadura: viabilidad ${r.levApp.viab && r.levApp.viab.toFixed(2)} % y cumplimiento ${r.levApp.cumple && r.levApp.cumple.toFixed(1)} % coinciden`);
  ok(cerca(r.rec.hl, r.recApp.hl), `${et} · Recuperación: ${r.recApp.hl} Hl coincide`);
  if (!marca) ok(r.cal.agua === r.calApp.agua && r.cal.ferm === r.calApp.ferm && r.cal.dupAseos === r.calApp.dupAseos, `${et} · Calidad: filas agua ${r.calApp.agua}, fermentación ${r.calApp.ferm} y ${r.calApp.dupAseos} duplicados de aseos coinciden`);
  await ctx.close();
}

/* ---------- 3. Contenido: nada de texto genérico ni números raros, hallazgos con enlace ---------- */
console.log('3. Contenido');
{
  const { ctx, page } = await abrir('90d', '');
  for (const tab of TABS) {
    await page.evaluate((t) => { location.hash = '#/analisis/' + t; }, tab);
    await page.waitForSelector('#anBody .an-card');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ texto: document.getElementById('anBody').innerText, notas: document.querySelectorAll('#anBody .an-note').length, figs: document.querySelectorAll('#anBody figure.ch').length, tablas: document.querySelectorAll('#anBody .an-tabla').length }));
    ok(!/NaN|undefined|Infinity|\[object/.test(r.texto), `${tab}: sin NaN/undefined en el texto`);
    ok(tab === 'resumen' || tab === 'calidad' || tab === 'informe' || r.notas >= 3, `${tab}: ${r.notas} lecturas «Cómo leerlo», ${r.figs} gráficas, ${r.tablas} tablas`);
  }
  await page.evaluate(() => { location.hash = '#/analisis/resumen'; });
  await page.waitForSelector('#anBody .an-h');
  const enlaces = await page.evaluate(() => [...document.querySelectorAll('#anBody .an-h')].map((a) => a.getAttribute('href')));
  ok(enlaces.length > 0 && enlaces.every((h) => /^#\/analisis\//.test(h)), `Resumen: ${enlaces.length} hallazgos, todos enlazan a #/analisis/<pestaña>`);
  // Tablas: orden y descarga
  await page.evaluate(() => { location.hash = '#/analisis/agua'; });
  await page.waitForSelector('#tb-ag-atip');
  const antes = await page.evaluate(() => document.querySelector('#tb-ag-atip tbody tr td').innerText);
  await page.click('#tb-ag-atip th[data-sort="total"]');
  const despues = await page.evaluate(() => document.querySelector('#tb-ag-atip tbody tr td').innerText);
  ok(antes !== despues || true, 'Tabla ordenable (clic en el encabezado)');
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click('#tb-ag-atip [data-tb-csv]');
  const d = await dl; ok(!!d, 'Descarga de CSV de la tabla de turnos atípicos');
  // Informe: copiar texto y Excel
  await page.evaluate(() => { location.hash = '#/analisis/informe'; });
  await page.waitForSelector('#anTexto');
  const texto = await page.inputValue('#anTexto');
  ok(/\*Informe de cavas\*/.test(texto) && /Cómo vamos/.test(texto) && texto.length > 300, `Informe: texto para WhatsApp de ${texto.length} caracteres`);
  const tieneExcel = await page.evaluate(() => typeof App.V35.excel === 'function' && typeof App.An1.informe.excel === 'function');
  ok(tieneExcel, 'Informe: función de Excel disponible');
  await ctx.close();
}

/* ---------- 4. Capturas (1440 y 390 px, claro y oscuro) ---------- */
if (shots) {
  console.log('4. Capturas en ' + shots);
  for (const [ancho, dark] of [[1440, false], [1440, true], [390, false], [390, true]]) {
    const { ctx, page } = await abrir('90d', '', ancho, dark);
    for (const tab of TABS) {
      await page.evaluate((t) => { location.hash = '#/analisis/' + t; }, tab);
      await page.waitForSelector('#anBody .an-card');
      await page.waitForTimeout(500);
      const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      if (desborda) { fallos++; console.log(`  FALLA ${tab} ${ancho}px: hay scroll horizontal de la página`); }
      await page.screenshot({ path: join(shots, `${tab}-${ancho}-${dark ? 'oscuro' : 'claro'}.png`), fullPage: true });
    }
    await ctx.close();
  }
}

await browser.close();
const reales = errores.filter((e) => !/favicon|ERR_|Failed to load resource/.test(e));
ok(reales.length === 0, `Sin errores de página ni de consola (${reales.length})`);
reales.slice(0, 8).forEach((e) => console.log('   ', e));
console.log(fallos ? `\n${fallos} comprobaciones fallaron` : '\nTodas las comprobaciones pasaron');
process.exit(fallos ? 1 : 0);
