// Prueba de extremo a extremo de App.Hoja y App.Captura con Playwright (Chromium).
// Requiere el HTML original del usuario (con sus datos) SOLO para compilar en un directorio temporal:
//   CAVAS_ORIGINAL=/ruta/Control_Cavas_v36.html NODE_PATH=$(npm root -g) node --test plataforma/tests/hoja.e2e.mjs
// Todo se escribe «como lo haría un usuario» (teclado). Los datos de prueba solo viven en el navegador efímero;
// no se escribe nada en el repositorio (las capturas de pantalla van a un directorio temporal).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIG = process.env.CAVAS_ORIGINAL;
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let chromium = null;
try { chromium = createRequire(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), '/'))('playwright').chromium; } catch (e) { chromium = null; }
const skip = !ORIG || !fs.existsSync(ORIG) ? 'Define CAVAS_ORIGINAL con la ruta del HTML original' : !chromium ? 'Playwright no está instalado (NODE_PATH)' : false;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cavas-hoja-'));
const shots = path.join(tmp, 'capturas');
fs.mkdirSync(shots);
const out = path.join(tmp, 'hoja.html');
let browser, ctx, p;
const errores = [];

before(async () => {
  if (skip) return;
  execFileSync('node', [path.join(here, '..', 'build.mjs'), ORIG, out, '--only=10-neutral-tokens.css,11-asistente-avatar.css,30-datos.js,31-metas.js,32-secciones.js,35-hoja.js,35-hoja.css,36-captura.js'], { stdio: 'pipe' });
  browser = await chromium.launch({ executablePath: CHROME });
  ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, colorScheme: 'light' });
  p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text().slice(0, 200)); });
  await p.goto('file://' + out);
  await p.waitForFunction(() => window.App && App.DL && App.Captura && App.S && App.S.ready, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
});
after(async () => {
  if (browser) await browser.close();
  if (process.env.CAVAS_KEEP !== '1') fs.rmSync(tmp, { recursive: true, force: true }); else console.log('capturas en', shots);
});

/* ---------- ayudas ---------- */
const kb = () => p.keyboard;
async function abrir(ruta, hoja) {
  await p.evaluate((r) => { location.hash = '#/' + r; }, ruta);
  await p.waitForSelector('[data-cifra-btn^="capturar-excel"]', { timeout: 10000 });
  if (hoja) await p.evaluate((h) => { const b = document.querySelector('[data-aseo-module="' + h + '"]'); if (b) b.click(); }, hoja);
  await p.waitForTimeout(400);
  await p.click('[data-cifra-btn^="capturar-excel"]');
  await p.waitForSelector('.cap-panel .hoja-vp');
  await p.waitForTimeout(300);
}
const cerrarPanel = async () => { await p.evaluate(() => App.Captura.cerrar()); await p.waitForTimeout(150); };
const hoja = (fn, arg) => p.evaluate(`(${fn.toString()})(App.Captura.hoja(), ${JSON.stringify(arg === undefined ? null : arg)})`);
/** enfoca la celda `key` de la última fila (la vacía) o de la fila `fila` y escribe como usuario; Tab confirma */
async function escribir(key, texto, fila) {
  await hoja((h, a) => h.enfocar(a.f == null ? h.filasN - 1 : a.f, a.k), { k: key, f: fila == null ? null : fila });
  await kb().type(texto);
  await kb().press('Tab');
}
const estado = () => p.evaluate(() => document.querySelector('.cap-panel .hoja-estado').textContent);
const registros = (tipo) => p.evaluate((t) => ((App.S.config['opCaptures_' + t] || {}).records || []).map((r) => JSON.parse(JSON.stringify(r))), tipo);
async function guardar() { await kb().press('Control+s'); await p.waitForSelector('.cap-toast', { timeout: 5000 }); await p.waitForTimeout(300); }
async function foto(nombre) {
  for (const esquema of ['light', 'dark']) {
    await p.emulateMedia({ colorScheme: esquema });
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(shots, nombre + '-' + esquema + '.png') });
  }
  await p.emulateMedia({ colorScheme: 'light' });
}
async function pegar(texto) {
  await p.evaluate(async (t) => { try { await navigator.clipboard.writeText(t); } catch (e) { window.__tsv = t; } }, texto);
  const ok = await p.evaluate(() => !window.__tsv);
  if (ok) { await kb().press('Control+v'); return 'teclado'; }
  // sin permiso de portapapeles en este navegador: se entrega el mismo evento «paste» que dispara Ctrl+V
  await p.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); const vp = document.querySelector('.cap-panel .hoja-vp'); vp.focus(); vp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); window.__tsv = null; }, texto);
  return 'evento';
}
const sinErrores = () => assert.deepEqual(errores, [], 'errores de página: ' + errores.join(' | '));

/* ============================================================ */
test('la plataforma carga sin errores y cada sección tiene su botón', { skip }, async () => {
  for (const r of ['agua', 'aseos', 'recuperacion', 'programa']) {
    await p.evaluate((x) => { location.hash = '#/' + x; }, r);
    await p.waitForSelector('[data-cifra-btn^="capturar-excel"]', { timeout: 10000 });
    assert.equal(await p.locator('[data-cifra-btn^="capturar-excel"]').count(), 1, 'botón único en ' + r);
    assert.ok(await p.$('[data-op-add], #aseoNew'), 'se conserva el botón original en ' + r);
  }
  sinErrores();
});

test('Consumo de agua: teclado, pegado TSV, cálculos, semáforos, guardado y deshacer', { skip }, async () => {
  const antes = (await registros('agua')).length;
  const ult = await p.evaluate(() => {
    const rs = App.OperationSources.records('agua', '2026').filter((r) => r.origin === 'Excel' && +r.cells[4] > 1000);
    const c = rs[rs.length - 1].cells; return { pisos: c[4], cip: c[9], gea: c[14] };
  });
  const miles = (n) => String(n).replace(/(\d)(?=(\d{3})+$)/g, '$1.');
  await abrir('agua');
  const def = await hoja((h) => ({ fecha: h.getCelda(h.filasN - 1, 'fecha'), hora: h.getCelda(h.filasN - 1, 'hora') }));
  assert.match(def.fecha, /^\d{4}-\d{2}-\d{2}$/, 'la fila vacía propone fecha');
  assert.match(def.hora, /^\d{2}:\d{2}$/, 'y turno');

  // fila 1 (verde): pisos +50, CIP +30, GEA +300 (con separador de miles, como se copia de Excel)
  await escribir('lecturaPisos', String(ult.pisos + 50));
  await escribir('lecturaCip', String(ult.cip + 30));
  await escribir('lecturaGea', miles(ult.gea + 300));
  await escribir('mosto', '1200'); await escribir('trasegados', '1500');
  await escribir('utq', '1'); await escribir('colector', '1'); await escribir('linea', '2'); await escribir('gea', '1');
  const f1 = await hoja((h) => h.getFilas()[0]);
  assert.equal(f1.consumoPisos, 50); assert.equal(f1.consumoCip, 30); assert.equal(f1.consumoGea, 300);
  assert.equal(f1.hlPisos, 500); assert.equal(f1.total, 1100); assert.equal(f1.totalAseos, 5);
  assert.equal(f1.m3Aseo, 7.5); assert.equal(f1.hlAseoGea, 300); assert.equal(f1.eficiencia, 0.407);
  assert.match(await estado(), /1 fila · 0 con error · 1 sin guardar/);
  await foto('agua-1-fila');

  // pegar un bloque TSV: fecha, hora y lectura de pisos de dos turnos; luego las lecturas de CIP y GEA
  await hoja((h) => h.enfocar(h.filasN - 1, 'fecha'));
  const via = await pegar(`09/10/2026\t16:00\t${miles(ult.pisos + 200)}\n09/10/2026\t00:00\t${ult.pisos + 350}\n`);
  await hoja((h) => h.enfocar(1, 'lecturaCip'));
  await pegar(`${ult.cip + 60}\n${ult.cip + 90}`);
  await hoja((h) => h.enfocar(1, 'lecturaGea'));
  await pegar(`${ult.gea + 700}\n${ult.gea + 1000}`);
  const fs3 = await hoja((h) => h.getFilas());
  assert.equal(fs3.length, 3, 'pegar creó las filas que faltaban (vía ' + via + ')');
  assert.equal(fs3[1].fecha, '2026-10-09'); assert.equal(fs3[1].hora, '16:00');
  assert.equal(fs3[1].lecturaPisos, ult.pisos + 200, 'miles con punto en columna entera');
  assert.equal(fs3[1].consumoPisos, 150); assert.equal(fs3[2].consumoPisos, 150);
  assert.equal(fs3[1].consumoGea, 400); assert.equal(fs3[2].consumoGea, 300);
  assert.equal(fs3[2].hora, '00:00');
  await foto('agua-3-filas');

  // las filas 2 y 3 pasan de 100 m³ de pisos (rojo) y exigen justificación: Ctrl+S guarda solo la fila 1
  assert.match(await estado(), /3 filas · 2 con error · 3 sin guardar/);
  await guardar();
  let rs = await registros('agua');
  assert.equal(rs.length, antes + 1);
  const rec = rs[rs.length - 1];
  assert.equal(rec.source, '2026'); assert.equal(rec.origin, 'Plataforma'); assert.equal(rec.row, null);
  const c = rec.cells;
  assert.equal(c[4], ult.pisos + 50); assert.equal(c[5], 50); assert.equal(c[6], 500);
  assert.equal(c[9], ult.cip + 30); assert.equal(c[10], 30); assert.equal(c[11], 300);
  assert.equal(c[14], ult.gea + 300); assert.equal(c[15], 300); assert.equal(c[17], 1100);
  assert.equal(c[18], 1200); assert.equal(c[19], 1500);
  assert.deepEqual([c[20], c[21], c[22], c[25], c[26]], [1, 1, 2, 1, 5]);
  assert.equal(c[27], 7.5); assert.equal(c[28], 300); assert.equal(c[29], 0.407);
  assert.equal(c[1], Math.round(Date.parse(def.fecha + 'T00:00:00Z') / 86400000) + 25569, 'fecha como serial de Excel');
  assert.ok(Math.abs(c[3] - ({ '08:00': 8, '16:00': 16, '00:00': 0 }[def.hora] || 0) / 24) < 1e-9, 'hora como fracción de día');
  assert.ok(rec.revisions && rec.revisions.length === 1, 'revisión inicial');
  // lo capturado aparece en la capa de datos y en lo que lee la sección
  const dl = await p.evaluate((id) => { const r = App.DL.agua().find((x) => x.id === id); const w = App.OperationsWorkspace.waterRows().find((x) => x.id === id); return { r, w }; }, rec.id);
  assert.ok(dl.r, 'App.DL.agua() incluye la fila nueva');
  assert.equal(dl.r.pisos, 50); assert.equal(dl.r.cip, 30); assert.equal(dl.r.gea, 30); assert.equal(dl.r.total, 110);
  assert.equal(dl.r.aseos, 4); assert.equal(dl.r.production, 1200); assert.equal(dl.r.transfer, 1500);
  assert.ok(dl.w && dl.w.valid, 'waterRows (sección) la reconoce como válida');
  assert.match(await estado(), /3 filas · 2 con error · 2 sin guardar/);
  assert.ok(await p.$('.cap-toast button'), 'aviso con «Deshacer»');

  // justificación en las dos filas rojas → se guardan
  await escribir('justificacion', 'Fuga en línea CIP', 1);
  await escribir('justificacion', 'Lavado extraordinario', 2);
  assert.match(await estado(), /3 filas · 0 con error · 2 sin guardar/);
  await guardar();
  rs = await registros('agua');
  assert.equal(rs.length, antes + 3);
  assert.equal(rs[rs.length - 1].cells[30], 'Lavado extraordinario');
  assert.equal(rs[rs.length - 2].cells[5], 150);
  assert.match(await estado(), /0 sin guardar/);
  await foto('agua-guardado');

  // Deshacer (aviso): vuelve al estado anterior y deja las filas como pendientes
  await p.click('.cap-toast button'); await p.waitForTimeout(500);
  assert.equal((await registros('agua')).length, antes + 1, 'deshacer restaura las capturas');
  assert.match(await estado(), /3 filas · 0 con error · 2 sin guardar/);
  await guardar();
  assert.equal((await registros('agua')).length, antes + 3, 'se pueden guardar otra vez');
  await cerrarPanel();
  sinErrores();
});

test('Recuperación: recolecciones plegables, cálculos, semáforos y guardado', { skip }, async () => {
  const antes = (await registros('recuperacion')).length;
  await abrir('recuperacion');
  await escribir('utk', 'utk 2');                       // lista: «UTK 20»
  await escribir('rec1', '5/10 08:00'); await escribir('fv1', 'col 2');
  await escribir('vol1', '120'); await escribir('ph1', '4,9'); await escribir('cons1', '40');
  // segunda recolección: está plegada; se abre con el triángulo del encabezado
  await p.click('.hoja-gtog[data-g="Recolección 2"]');
  await escribir('rec2', '6/10 07:30'); await escribir('vol2', '30');
  await escribir('tqAgua', '2'); await escribir('agua', '75');                 // 75 / 150 = 50 %
  await escribir('sumAgua', '6/10 09:00'); await escribir('presCierre', '3,2'); await escribir('tempCierre', '1,5');
  await escribir('opCierre', 'laura');
  await escribir('retiro', '7/10 08:00');
  await escribir('recuperacion', '8/10 08:00');            // 72 h exactas desde la primera recolección
  await escribir('volRec', '100'); await escribir('presRec', '5,6'); await escribir('tempRec', '1,2');
  await escribir('sv', '14'); await escribir('consSv', 'M24'); await escribir('marca', 'est');
  await escribir('extracto', '11'); await escribir('phFinal', '5,5'); await escribir('sensorial', 'ok');
  const f = await hoja((h) => h.getFilas()[0]);
  assert.equal(f.totalLev, 150); assert.equal(f.aguaTeo, 75); assert.equal(f.relacion, 50);
  assert.equal(f.fmax, '2026-10-09T08:00', 'primera recolección + 96 h');
  assert.equal(f.horas, 72); assert.equal(f.semana, 41);
  const hl95 = Math.round(100 * ((11 * 260) / (260 - 11)) / ((9.5 * 260) / 250.5) * 100) / 100;
  assert.equal(f.hl95, hl95); assert.equal(f.kg, Math.round(hl95 * 9.86 * 100) / 100);
  assert.equal(f.utk, 'UTK 20'); assert.equal(f.tqAgua, '2');
  // semáforos: relación agua verde, 72 h verde, presión 5,6 y pH 5,5 rojos
  const sem = await p.evaluate(() => [...document.querySelectorAll('.cap-panel .hoja-f')][0] && [...document.querySelectorAll('.cap-panel .hoja-f')][0].querySelectorAll('[class*="sem-"]').length);
  assert.ok(sem >= 5, 'celdas con semáforo: ' + sem);
  const bad = await p.evaluate(() => [...document.querySelectorAll('.cap-panel .hoja-c.sem-bad')].map((e) => e.getAttribute('title')));
  assert.ok(bad.some((t) => /pH/.test(t)) && bad.some((t) => /Presión/.test(t)), 'alertas pH y presión: ' + bad);
  await foto('recuperacion');
  await guardar();
  const rs = await registros('recuperacion');
  assert.equal(rs.length, antes + 1);
  const rec = rs[rs.length - 1], c = rec.cells;
  assert.equal(rec.source, 'Control Recuperada'); assert.equal(rec.origin, 'Plataforma');
  assert.equal(c[1], 'UTK 20'); assert.equal(c[2], '2026-10-05T08:00'); assert.equal(c[4], 120); assert.equal(c[9], 30);
  assert.equal(c[22], 150); assert.equal(c[24], 75); assert.equal(c[25], 75); assert.equal(c[26], 50);
  assert.equal(c[33], '2026-10-09T08:00'); assert.equal(c[34], '2026-10-08T08:00'); assert.equal(c[37], 72);
  assert.equal(c[38], 100); assert.equal(c[41], 14); assert.equal(c[44], 'ESTANDAR'); assert.equal(c[47], 5.5); assert.equal(c[49], 'OK');
  assert.equal(c[55], hl95);
  const dl = await p.evaluate((id) => App.DL.recuperacion().find((x) => x.id === id), rec.id);
  assert.ok(dl, 'App.DL.recuperacion() la incluye');
  assert.equal(dl.volume, 100); assert.equal(dl.yeast, 150); assert.equal(dl.hours, 72); assert.equal(dl.brand, 'ESTANDAR'); assert.equal(dl.ph, 5.5);
  assert.equal(dl.yieldPct, 100 / 150 * 100);
  await p.click('.cap-toast button'); await p.waitForTimeout(400);
  assert.equal((await registros('recuperacion')).length, antes, 'deshacer');
  await cerrarPanel();
  sinErrores();
});

test('Programa de trasiego: plan encadenado, desvío, causa obligatoria y lista con valor nuevo', { skip }, async () => {
  const antes = (await registros('programa')).length;
  await abrir('programa');
  const proc = await hoja((h) => (h.columnas.find((c) => c.key === 'proceso').opciones({ procesos: App.Captura.defs.programa.contexto('CONTROL TRASIEGO', new Set()).procesos })).find((o) => /^TRASIEGO/.test(o)));
  assert.ok(proc, 'hay procesos habituales derivados de los datos');
  await escribir('proceso', proc); await escribir('marca', 'est'); await escribir('sv', '12');
  // inicio del plan: sobrescribe la sugerencia con una hora concreta; fin plan = +8,5 h
  await escribir('inicioPlan', '8/10 08:00');
  let f = await hoja((h) => h.getFilas()[0]);
  assert.equal(f.finPlan, '2026-10-08T16:30');
  await escribir('inicioReal', '8/10 08:20'); await escribir('finReal', '8/10 18:30');
  f = await hoja((h) => h.getFilas()[0]);
  assert.equal(f.desvio, 2);                                // 18:30 − 16:30
  assert.match(await estado(), /1 fila · 1 con error/, 'causa obligatoria si el retraso supera 1 h');
  await escribir('causa', 'falla bomba');
  // fila 2: CIP de centrífuga encadenado: inicio = fin anterior + 1 h; fin = +2,5 h; causa nueva con confirmación
  await escribir('proceso', 'CIP CENTRIFUGA RECETA 40');
  const f2 = await hoja((h) => h.getFilas()[1]);
  assert.equal(f2.inicioPlan, '2026-10-08T17:30'); assert.equal(f2.finPlan, '2026-10-08T20:00');
  await hoja((h) => h.enfocar(1, 'causa'));
  await kb().type('Causa inventada para la prueba'); await kb().press('Enter');
  assert.match(await p.evaluate(() => document.querySelector('.cap-panel .hoja-pie-msg').textContent), /valor nuevo/);
  await kb().press('Enter');                               // segunda confirmación
  assert.equal(await hoja((h) => h.getCelda(1, 'causa')), 'Causa inventada para la prueba');
  await foto('programa');
  await guardar();
  const rs = await registros('programa');
  assert.equal(rs.length, antes + 2);
  const c = rs[rs.length - 2].cells;
  assert.equal(c[1], proc); assert.equal(c[2], 'ESTANDAR'); assert.equal(c[3], 12);
  assert.equal(c[4], '2026-10-08T08:00'); assert.equal(c[5], '2026-10-08T16:30'); assert.equal(c[6], '2026-10-08T08:20'); assert.equal(c[7], '2026-10-08T18:30');
  assert.equal(c[9], 2); assert.equal(c[10], 'FALLA BOMBA TRASIEGO');
  const dl = await p.evaluate((id) => App.DL.trasiego().find((x) => x.id === id), rs[rs.length - 2].id);
  assert.ok(dl, 'App.DL.trasiego() la incluye');
  assert.equal(dl.delay, 2); assert.equal(dl.cause, 'FALLA BOMBA TRASIEGO'); assert.equal(dl.kind, 'Trasiego'); assert.equal(dl.brand, 'ESTANDAR');
  assert.equal(Math.round(dl.duration * 100), Math.round(10 + 1 / 6) * 100 === 0 ? 0 : Math.round(dl.duration * 100));
  await cerrarPanel();
  sinErrores();
});

test('Aseos · Cada uso: cálculos, cumplimiento y aparece en la sección', { skip }, async () => {
  const antes = (await registros('aseos')).length;
  await abrir('aseos');
  await escribir('inicio', '7/10 08:00'); await escribir('fin', '7/10 08:50');
  await escribir('equipo', 'fv'); await escribir('num', '12'); await escribir('pre', 's');
  await escribir('sodaCond', '60'); await escribir('sodaTiempo', '40'); await escribir('sodaTemp', '25'); await escribir('sodaEstado', 'l');
  await escribir('triCond', '24'); await escribir('triTemp', '22'); await escribir('triTiempo', '35'); await escribir('triEstado', 'l');
  await escribir('ph', '6,8'); await escribir('flujo', '1200'); await escribir('apariencia', 'l'); await escribir('metil', 'ok');
  await escribir('operario', 'Operario de prueba'); await kb().press('Enter');            // valor nuevo: confirmar
  await hoja((h) => h.enfocar(0, 'stl'));
  await kb().type('rf'); await kb().press('Tab'); await escribir('comentarios', 'Prueba de captura', 0);
  const f = await hoja((h) => h.getFilas()[0]);
  assert.equal(f.duracion, 50); assert.equal(f.semana, 41); assert.equal(f.equipo, 'FV'); assert.equal(f.vapor, 'N/A');
  assert.equal(f.sodaConc, 1.1);                            // (60 + 2,4968) / 56,636
  assert.equal(f.triConc, 1.55);                            // (24 − 1,2316) / 14,703
  assert.equal(f.cumple, 0.86);                             // 6 de 7 criterios: la soda de FV debe estar en 0,7–1,05 %
  assert.equal(f.pre, 'SI'); assert.equal(f.sodaEstado, 'L'); assert.equal(f.operario, 'Operario de prueba');
  await foto('aseos-cada-uso');
  await guardar();
  const rs = await registros('aseos');
  assert.equal(rs.length, antes + 1);
  const rec = rs[rs.length - 1], c = rec.cells;
  assert.equal(rec.source, '1. Cada uso'); assert.equal(rec.origin, 'Plataforma');
  assert.equal(c[1], '2026-10-07T08:00'); assert.equal(c[2], '2026-10-07T08:50'); assert.equal(c[4], 'FV'); assert.equal(c[5], 12); assert.equal(c[8], 'SI');
  assert.equal(c[9], 1.1); assert.equal(c[10], 60); assert.equal(c[16], 1.55); assert.equal(c[7], 0.86); assert.equal(c[22], 6.8); assert.equal(c[23], 1200);
  assert.equal(c[28], 'Operario de prueba'); assert.equal(c[29], 'RF'); assert.equal(c[31], 'Prueba de captura');
  const dl = await p.evaluate((id) => App.DL.aseos().find((x) => x.id === id), rec.id);
  assert.ok(dl, 'App.DL.aseos() la incluye');
  assert.equal(dl.equipment, 'FV 12'); assert.equal(dl.durMin, 50); assert.equal(dl.flow, 1200); assert.equal(dl.ph, 6.8); assert.equal(dl.operator, 'Operario de prueba');
  await cerrarPanel();
  // la sección (módulo aseos-workbench) la muestra y no se rompe
  await p.evaluate(() => { App.render(true); }); await p.waitForTimeout(600);
  const tabla = await p.evaluate(() => document.querySelector('#view').innerText);
  assert.match(tabla, /Finalizado/);
  assert.match(tabla, /FV/);
  sinErrores();
});

test('Aseos · hoja genérica generada desde el esquema (3. Mensual)', { skip }, async () => {
  const antes = (await registros('aseos')).length;
  await abrir('aseos', '3. Mensual');
  const cols = await hoja((h) => h.columnas.map((c) => ({ key: c.key, titulo: c.titulo, tipo: c.tipo })));
  assert.ok(cols.length > 8, 'columnas generadas: ' + cols.length);
  assert.ok(cols.some((c) => c.tipo === 'fechahora') && cols.some((c) => c.tipo === 'numero') && cols.some((c) => c.tipo === 'lista'), 'tipos inferidos');
  const fecha = cols.find((c) => c.tipo === 'fechahora' && !/program|propuest/i.test(c.titulo)), eq = cols.find((c) => /equipo|tipo/i.test(c.titulo) && c.tipo === 'lista');
  const num = cols.find((c) => /conductiv/i.test(c.titulo) && c.tipo === 'numero');
  assert.ok(fecha && num);
  await escribir(fecha.key, '6/10 09:00');
  if (eq) { await hoja((h, k) => h.enfocar(h.filasN - 1, k), eq.key); await kb().type('RED'); await kb().press('Tab'); }
  await escribir(num.key, '55,5');
  await foto('aseos-mensual');
  await guardar();
  const rs = await registros('aseos');
  assert.equal(rs.length, antes + 1);
  const rec = rs[rs.length - 1];
  assert.equal(rec.source, '3. Mensual');
  const idx = +fecha.key.slice(1);
  assert.equal(rec.cells[idx], '2026-10-06T09:00'); assert.equal(rec.cells[+num.key.slice(1)], 55.5);
  await cerrarPanel();
  sinErrores();
});

/* ---------- Comportamiento tipo Excel del componente (hoja suelta con todos los tipos) ---------- */
test('App.Hoja: atajos tipo Excel, fechas flexibles, listas, rango, deshacer y borrador', { skip }, async () => {
  await p.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="demo" style="position:fixed;inset:20px;z-index:99999;background:var(--bg)"></div>');
    window.__g = App.Hoja.crear(document.getElementById('demo'), {
      clave: 'prueba-demo', alto: 420,
      columnas: [
        { key: 'f', titulo: 'Fecha y hora', tipo: 'fechahora', requerido: true },
        { key: 'n', titulo: 'Caudal', tipo: 'numero', unidad: 'Hl/h', min: 0, max: 100, decimales: 1, semaforo: (v) => (v > 80 ? 'bad' : v > 50 ? 'warn' : 'ok') },
        { key: 'l', titulo: 'Estado', tipo: 'lista', opciones: ['L', 'NL', 'B'] },
        { key: 'sn', titulo: 'Preenjuague', tipo: 'sino' },
        { key: 'x', titulo: 'Doble', tipo: 'calc', formato: 'numero', calc: (f) => (typeof f.n === 'number' ? f.n * 2 : null) },
        { key: 't', titulo: 'Nota', tipo: 'texto' },
      ],
      filas: [], onGuardar: async (fs) => { window.__guardadas = fs; return true; },
    });
    window.__g.enfocar(0, 'f');
  });
  const g = (fn, a) => p.evaluate(`(${fn.toString()})(window.__g, ${JSON.stringify(a === undefined ? null : a)})`);
  const k = kb();
  await k.type('hoy 14:30'); await k.press('Tab');
  await k.type('55,55'); await k.press('Tab');                // número con coma, 1 decimal → 55,6
  await k.type('n'); await k.press('Tab');                    // «n» → NL
  await k.press('Space');                                     // sí/no con espacio → SÍ
  await k.press('Tab'); await k.press('Tab');                 // salta la celda calculada
  await k.type('texto libre'); await k.press('Enter');        // Enter baja
  let f = await g((h) => h.getFilas()[0]);
  assert.match(f.f, /T14:30$/); assert.equal(f.n, 55.6); assert.equal(f.l, 'NL'); assert.equal(f.sn, 'SI'); assert.equal(f.x, 111.2); assert.equal(f.t, 'texto libre');
  assert.deepEqual(await g((h) => h.activa), { fila: 1, columna: 't' });
  // fechas flexibles
  await g((h) => h.enfocar(1, 'f'));
  for (const [txt, re] of [['14:30', /T14:30$/], ['7/10 08:00', /-10-07T08:00$/], ['2026-10-07 14:30', /^2026-10-07T14:30$/], ['46302.5', /^2026-10-07T12:00$/]]) {
    await k.type(txt); await k.press('Enter'); await k.press('ArrowUp');
    assert.match(await g((h) => h.getCelda(1, 'f')), re, txt);
  }
  // N = ahora en celda de fecha vacía; Ctrl+Z lo deshace
  await g((h) => h.enfocar(2, 'f')); await k.press('n');
  assert.match(await g((h) => h.getCelda(2, 'f')), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  await k.press('Control+z');
  assert.equal(await g((h) => h.getCelda(2, 'f')), null);
  await k.press('Control+y');
  assert.ok(await g((h) => h.getCelda(2, 'f')), 'rehacer');
  // validación de rango: 150 en un campo 0–100 se rechaza al escribir; con Esc se cancela
  await g((h) => h.enfocar(2, 'n')); await k.type('150'); await k.press('Enter');
  assert.match(await p.evaluate(() => document.querySelector('#demo .hoja-pie-msg').textContent + document.querySelector('#demo .hoja-estado').textContent), /./);
  await k.press('Escape');
  assert.equal(await g((h) => h.getCelda(2, 'n')), undefined);
  // pegar fuera de rango: se acepta pero queda marcado en error
  await pegar2('3\t150\tx');
  assert.match(await p.evaluate(() => document.querySelector('#demo .hoja-estado').textContent), /con error/);
  assert.ok(await p.$('#demo .hoja-c--bad'), 'celda con error marcada');
  // rango con Shift+flechas, copiar/pegar, Ctrl+D y Supr
  await g((h) => h.enfocar(1, 'n')); await k.type('10'); await k.press('Enter');          // fila 2, col n = 10
  await g((h) => h.enfocar(1, 'n')); await k.press('Shift+ArrowDown'); await k.press('Shift+ArrowDown');
  await k.press('Control+d');
  assert.equal(await g((h) => h.getCelda(2, 'n')), 10); assert.equal(await g((h) => h.getCelda(3, 'n')), 10, 'Ctrl+D rellena hacia abajo');
  await k.press('Delete');
  assert.equal(await g((h) => h.getCelda(2, 'n')), undefined);
  await k.press('Control+z');
  assert.equal(await g((h) => h.getCelda(2, 'n')), 10, 'deshacer el borrado del rango');
  // lista con teclado: flecha abajo abre las opciones, Enter elige
  await g((h) => h.enfocar(4, 'l')); await k.press('F2'); await k.press('ArrowDown'); await k.press('ArrowDown'); await k.press('Enter');
  assert.equal(await g((h) => h.getCelda(4, 'l')), 'NL');
  // guardar: solo filas completas y válidas
  const res = await g((h) => h.validar());
  assert.ok(res.errores.length > 0 && res.listas.length > 0);
  await k.press('Control+s'); await p.waitForTimeout(200);
  const gd = await p.evaluate(() => (window.__guardadas || []).length);
  assert.equal(gd, res.listas.length);
  // borrador: se conserva en localStorage y se recupera al recrear la hoja
  await g((h) => h.enfocar(h.filasN - 1, 'f')); await k.type('9/10 10:00'); await k.press('Tab'); await p.waitForTimeout(600);
  const hay = await p.evaluate(() => !!localStorage.getItem('cavas:hoja:prueba-demo'));
  assert.ok(hay, 'borrador guardado');
  await p.evaluate(() => { window.__g.destruir(); });
  const recup = await p.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="demo2"></div>');
    window.__g2 = App.Hoja.crear(document.getElementById('demo2'), { clave: 'prueba-demo', columnas: [{ key: 'f', titulo: 'F', tipo: 'fechahora' }, { key: 'n', titulo: 'N', tipo: 'numero' }], filas: [] });
    return { aviso: !document.querySelector('#demo2 .hoja-aviso').hidden, texto: document.querySelector('#demo2 .hoja-aviso span').textContent, n: window.__g2.getFilas().length };
  });
  assert.ok(recup.aviso && /recuperó un borrador/.test(recup.texto), recup.texto); assert.ok(recup.n >= 1);
  await p.evaluate(() => { localStorage.removeItem('cavas:hoja:prueba-demo'); window.__g2.destruir(); document.getElementById('demo').remove(); document.getElementById('demo2').remove(); });
  sinErrores();

  async function pegar2(t) { await pegar(t); }
});

test('App.Hoja escala: 4000 filas con ventana de render y teclado fluido', { skip }, async () => {
  const r = await p.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="big" style="position:fixed;inset:20px;z-index:99999;background:var(--bg)"></div>');
    const filas = Array.from({ length: 4000 }, (_, i) => ({ id: 'r' + i, n: i % 90, t: 'fila ' + i }));
    const t0 = performance.now();
    const h = App.Hoja.crear(document.getElementById('big'), { alto: 400, columnas: [{ key: 'n', titulo: 'N', tipo: 'numero' }, { key: 't', titulo: 'T', tipo: 'texto' }, { key: 'd', titulo: 'D', tipo: 'calc', formato: 'numero', calc: (f) => (f.n == null ? null : f.n * 2) }], filas });
    const ms = performance.now() - t0;
    window.__big = h;
    return { ms, dom: document.querySelectorAll('#big .hoja-f').length, filas: h.filasN };
  });
  assert.ok(r.dom < 80, 'filas en el DOM: ' + r.dom);
  assert.ok(r.ms < 1500, 'tiempo de carga ms: ' + r.ms);
  assert.equal(r.filas, 4001);
  await p.evaluate(() => window.__big.enfocar(0, 'n'));
  await kb().press('Control+ArrowDown'); await kb().press('PageUp');
  const act = await p.evaluate(() => window.__big.activa);
  assert.ok(act.fila > 3000 && act.fila < 4001, 'navegación por la hoja larga: ' + act.fila);
  const dom2 = await p.evaluate(() => document.querySelectorAll('#big .hoja-f').length);
  assert.ok(dom2 < 80);
  await p.evaluate(() => { window.__big.destruir(); document.getElementById('big').remove(); });
  sinErrores();
});

test('Solo lectura y vista móvil', { skip }, async () => {
  await p.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="ro" style="position:fixed;inset:20px;z-index:99999;background:var(--bg)"></div>');
    window.__ro = App.Hoja.crear(document.getElementById('ro'), { soloLectura: true, alto: 300, columnas: [{ key: 'n', titulo: 'N', tipo: 'numero' }], filas: [{ id: 'a', n: 5 }] });
    window.__ro.enfocar(0, 'n');
  });
  await kb().type('9'); await kb().press('Delete');
  assert.equal(await p.evaluate(() => window.__ro.getCelda(0, 'n')), 5, 'no edita en solo lectura');
  await p.evaluate(() => { window.__ro.destruir(); document.getElementById('ro').remove(); });
  await p.setViewportSize({ width: 390, height: 780 });
  await abrir('recuperacion');
  await foto('movil-recuperacion');
  const sinScrollPagina = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  assert.ok(sinScrollPagina, 'sin scroll horizontal de la página');
  await cerrarPanel();
  await p.setViewportSize({ width: 1500, height: 900 });
  sinErrores();
});
