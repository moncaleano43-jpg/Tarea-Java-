// Prueba de extremo a extremo del importador y de los documentos (Playwright + Chromium).
// Uso:
//   NODE_PATH=$(npm root -g) IMP_HTML=/tmp/claude-0/imp.html IMP_DIR=/ruta/con/libros node plataforma/tests/importador.e2e.mjs
// IMP_DIR debe contener agua.xlsx, aseos.xlsx, recup.xlsx, prog.xlsx y cavas.xlsm (los libros reales del usuario;
// NO viven en el repositorio). Sin IMP_DIR solo se prueban CSV, pegado, documentos y arrastre.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HTML = process.env.IMP_HTML || '/tmp/claude-0/imp.html';
const DIR = process.env.IMP_DIR || '';
const SH = process.env.IMP_SHOTS || path.join(os.tmpdir(), 'imp-shots');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-e2e-'));
fs.mkdirSync(SH, { recursive: true });
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let fallos = 0;
const ok = (c, msg) => { if (!c) { fallos++; console.log('  FALLO ·', msg); } else console.log('  ok ·', msg); };

// ---- archivos de ejemplo generados aquí (sin datos del usuario)
fs.writeFileSync(path.join(TMP, 'ejemplo.csv'), 'Fecha;Hora;Lectura pisos;Consumo pisos (m3);Comentario\n07/10/2026;08:00;124900;12,5;turno normal\n07/10/2026;16:00;124950;50;\n31/02/2026;00:00;125000;-4;fecha mala\n#REF!;08:00;1;2;error\n08/10/2026;08:00;125100;1.234,5;"con ""comillas"""\n');
fs.writeFileSync(path.join(TMP, 'pegado.tsv'), 'Fecha\tHora\tLectura\n09/10/2026\t08:00\t126000\n09/10/2026\t16:00\t126040\n');
fs.writeFileSync(path.join(TMP, 'procedimiento.pdf'), '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 55>>stream\nBT /F1 18 Tf 30 100 Td (Procedimiento de aseo) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
function png(w, h) {
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, (_, x) => [Math.floor(x * 255 / w), Math.floor(y * 255 / h), 150]).flat())])));
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ch('IHDR', ihdr), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(TMP, 'foto-aseo.png'), png(160, 100));
fs.writeFileSync(path.join(TMP, 'grande.bin'), Buffer.alloc(3 * 1024 * 1024));

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => { errores.push(e.message); console.log('  PAGEERROR', e.message); });
await page.goto('file://' + HTML);
await page.waitForFunction(() => window.App && App.S && App.S.ready && App.Importador && App.Documentos, null, { timeout: 60000 });
await page.waitForTimeout(1500);

const ir = async (r) => { await page.evaluate((x) => { location.hash = '#/' + x; }, r); await page.waitForTimeout(900); };
const shot = (n) => page.screenshot({ path: path.join(SH, n + '.png') });
const abrir = async (sec) => { await ir(sec); await page.click('[data-cifra-btn=imp-cargar]'); await page.waitForSelector('.imp-dlg [data-file]', { state: 'attached' }); };
async function cargar(archivo, { timeout = 200000 } = {}) {
  const t0 = Date.now();
  await page.setInputFiles('.imp-dlg [data-file]', archivo);
  await page.waitForSelector('.imp-dlg .imp-detect, .imp-dlg .imp-alert.neg', { timeout });
  await page.waitForTimeout(250);
  return Date.now() - t0;
}
const txt = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const conteos = () => page.evaluate(() => [...document.querySelectorAll('.imp-count b')].map((b) => +b.textContent.replace(/\D/g, '')));
const cerrar = async () => { await page.evaluate(() => { const w = App.Importador._wiz(); if (w) w.cerrar(); }); await page.waitForTimeout(150); };
const confirmar = async (texto) => { await page.waitForSelector('dialog[open] button[type=submit]'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(500); };
const toTheme = async (t) => { await page.evaluate((x) => document.documentElement.setAttribute('data-theme', x), t); await page.waitForTimeout(500); };

/** Ciclo completo con un libro real: detectar, simular un estado más antiguo, combinar, deshacer. */
async function ciclo(nombre, archivo, seccion, tipo, esperaTexto, hojaMain) {
  console.log('\n== ' + nombre);
  await toTheme('light');
  await abrir(seccion);
  const ms = await cargar(path.join(DIR, archivo));
  const det = await txt('.imp-detect');
  console.log('  ' + det + '  (' + ms + ' ms)');
  ok(esperaTexto.test(det), 'detección: ' + esperaTexto);
  ok(ms < 60000, 'tiempo razonable (' + ms + ' ms)');
  const c0 = await conteos();
  ok(c0.length === 4 && c0[0] === 0 && c0[1] === 0, 'el libro coincide con lo cargado: 0 nuevas / 0 actualizadas ' + JSON.stringify(c0));
  await shot('c-' + tipo + '-paso2');
  await cerrar();
  // estado "antiguo": quita las últimas 40 filas con datos y altera una
  const prep = await page.evaluate(async ({ tipo, hoja }) => {
    const S = App.OperationSources, raw = S.raw(tipo), cp = JSON.parse(JSON.stringify(raw));
    window.__orig = window.__orig || {}; window.__orig[tipo] = JSON.parse(JSON.stringify(raw));
    const P = App.Importador._p, enc = P.filaEncabezado(tipo, hoja, cp[hoja].rows), rows = cp[hoja].rows;
    const withData = rows.filter((r) => r.row > enc.row && P.tieneDatos(tipo, r.cells));
    const quitar = new Set(withData.slice(-40).map((r) => r.row));
    cp[hoja].rows = rows.filter((r) => !quitar.has(r.row));
    const cand = (r) => Object.keys(r.cells).filter((x) => typeof r.cells[x] === 'number' && +x >= 3 && +x !== 4);
    const alt = cp[hoja].rows.filter((r) => r.row > enc.row && P.tieneDatos(tipo, r.cells) && cand(r).length)[3];
    const k = cand(alt).pop();
    alt.cells[k] = alt.cells[k] + 7;
    await S.setImport(tipo, cp); App.DL.invalidate(); App.render(true);
    return { filas: cp[hoja].rows.length, original: rows.length, quitadas: quitar.size };
  }, { tipo, hoja: hojaMain });
  await abrir(seccion);
  await cargar(path.join(DIR, archivo));
  const c1 = await conteos();
  console.log('  contadores con estado antiguo: ' + JSON.stringify(c1));
  ok(c1[0] >= 30 && c1[1] >= 1, 'combinar detecta nuevas (>=30) y actualizadas (>=1)');
  await shot('c-' + tipo + '-combinar');
  await page.click('[data-apply]');
  await page.waitForSelector('.imp-done', { timeout: 60000 });
  await shot('c-' + tipo + '-resultado');
  const desp = await page.evaluate(({ tipo, hoja }) => App.OperationSources.raw(tipo)[hoja].rows.length, { tipo, hoja: hojaMain });
  ok(desp >= prep.original - 2 && desp <= prep.original + 1, 'tras combinar la hoja recupera sus filas (' + prep.filas + ' → ' + desp + ' de ' + prep.original + ')');
  const resp = await page.evaluate(async () => (await App.Importador.respaldos()).length);
  ok(resp >= 1, 'hay copia de seguridad en cifra-respaldos');
  // deshacer
  await page.click('[data-undo-now]');
  await confirmar();
  await page.waitForTimeout(600);
  const undo = await page.evaluate(({ tipo, hoja }) => App.OperationSources.raw(tipo)[hoja].rows.length, { tipo, hoja: hojaMain });
  ok(undo === prep.filas, 'deshacer restaura el estado previo (' + undo + ' = ' + prep.filas + ')');
  await cerrar();
  // dejar la fuente como estaba originalmente para las siguientes pruebas
  await page.evaluate(async ({ tipo }) => { await App.OperationSources.setImport(tipo, window.__orig[tipo]); App.DL.invalidate(); App.render(true); }, { tipo });
}

if (DIR && fs.existsSync(path.join(DIR, 'agua.xlsx'))) {
  await ciclo('Consumo de agua', 'agua.xlsx', 'agua', 'agua', /Consumo de agua · hoja 2026 · 835 lecturas · 31\/12\/2025 → 06\/10\/2026/, '2026');
  // DL refleja los datos
  const dl = await page.evaluate(() => { App.DL.invalidate(); return App.DL.agua().length; });
  ok(dl > 0, 'App.DL.agua() devuelve filas (' + dl + ')');

  console.log('\n== Agua · modo Reemplazar y modo oscuro');
  await abrir('agua'); await cargar(path.join(DIR, 'agua.xlsx'));
  await page.check('input[name=imp-modo][value=reemplazar]');
  await page.waitForTimeout(200);
  ok(/Reemplazar fuente/.test(await txt('.imp-mode.on')), 'modo Reemplazar seleccionable');
  await toTheme('dark'); await shot('c-agua-reemplazar-oscuro'); await toTheme('light');
  await cerrar();

  await ciclo('Aseos', 'aseos.xlsx', 'aseos', 'aseos', /Aseos · hoja 1\. Cada uso · [\d.]+ aseos/, '1. Cada uso');
  await ciclo('Recuperación', 'recup.xlsx', 'recuperacion', 'recuperacion', /Recuperación de cerveza · hoja Control Recuperada · \d+ recuperaciones/, 'Control Recuperada');
  await ciclo('Programa de trasiego', 'prog.xlsx', 'programa', 'programa', /Programa de trasiego · hoja CONTROL TRASIEGO · \d+ actividades/, 'CONTROL TRASIEGO');

  console.log('\n== Libro completo de control de cavas (40 MB)');
  await abrir('tanques');
  const ms = await cargar(path.join(DIR, 'cavas.xlsm'), { timeout: 240000 });
  console.log('  ' + await txt('.imp-detect') + '  (' + ms + ' ms)');
  ok(/Control de proceso de cavas · \d+ fermentaciones/.test(await txt('.imp-detect')), 'detecta el libro de cavas');
  ok(ms < 90000, 'lectura de 40 MB en tiempo razonable (' + ms + ' ms)');
  await shot('c-cavas-paso2');
  const antes = await page.evaluate(() => { const d = App.ExcelCavas.data(); return { f: d.fermentations.length, src: d.source }; });
  await page.click('[data-apply]');
  await page.waitForSelector('.imp-done', { timeout: 90000 });
  const med = await page.evaluate(() => { const d = App.ExcelCavas.data(); return { f: d.fermentations.length, src: d.source }; });
  ok(med.src === 'cavas.xlsm', 'ExcelCavas.data() ya usa el archivo importado (' + med.src + ')');
  await shot('c-cavas-resultado');
  await page.click('[data-undo-now]'); await confirmar(); await page.waitForTimeout(800);
  const des = await page.evaluate(() => { const d = App.ExcelCavas.data(); return { f: d.fermentations.length, src: d.source }; });
  ok(des.src === antes.src && des.f === antes.f, 'deshacer restaura el libro anterior (' + des.src + ')');
  await cerrar();
}

console.log('\n== CSV de ejemplo → tabla libre en Agua');
await abrir('agua');
await cargar(path.join(TMP, 'ejemplo.csv'));
const detCsv = await txt('.imp-detect');
console.log('  ' + detCsv);
ok(/Tabla libre/.test(detCsv) && /punto y coma/.test(detCsv), 'CSV detectado como tabla libre con separador ;');
const mapa = await page.evaluate(() => [...document.querySelectorAll('[data-map]')].map((s) => s.options[s.selectedIndex].textContent));
console.log('  mapeo: ' + JSON.stringify(mapa));
ok(/FECHA/.test(mapa[0]) && /HORA/.test(mapa[1]) && /LECTURA/.test(mapa[2]) && /CONSUMO PISOS \(m3\)/.test(mapa[3]), 'columnas autosugeridas por nombre');
const av = await txt('.imp-avisos');
ok(/fecha/i.test(av) && /error de Excel/.test(av), 'avisos: fecha imposible y error de Excel');
await shot('c-csv-paso2');
await toTheme('dark'); await shot('c-csv-paso2-oscuro'); await toTheme('light');
const antesCap = await page.evaluate(() => ((App.S.config.opCaptures_agua || {}).records || []).length);
await page.click('[data-apply]');
await page.waitForSelector('.imp-done');
const capturas = await page.evaluate(() => ((App.S.config.opCaptures_agua || {}).records || []).filter((r) => /^imp-/.test(r.id)));
ok(capturas.length >= 3, 'se guardaron capturas de plataforma (' + capturas.length + ')');
const enSeccion = await page.evaluate(() => App.OperationSources.records('agua', '2026').filter((r) => r.origin === 'Plataforma').length);
ok(enSeccion >= antesCap + 3, 'las filas aparecen en la sección Agua (' + enSeccion + ')');
await shot('c-csv-resultado');
// idempotente: volver a cargar el mismo CSV → todo igual
await page.click('[data-x].btn.pri');
await abrir('agua'); await cargar(path.join(TMP, 'ejemplo.csv'));
const cc = await conteos();
ok(cc[0] === 0 && cc[2] >= 3, 'recargar el mismo CSV no duplica (iguales=' + cc[2] + ')');
await cerrar();
// deshacer desde «Importaciones recientes»
await abrir('agua');
await page.click('.imp-recent [data-undo]'); await confirmar(); await page.waitForTimeout(600);
const trasUndo = await page.evaluate(() => ((App.S.config.opCaptures_agua || {}).records || []).filter((r) => /^imp-/.test(r.id)).length);
ok(trasUndo === 0, 'deshacer desde la lista de recientes quita lo importado');
await cerrar();

console.log('\n== Pegar desde Excel (TSV) en Recuperación → Agua sugerido');
await abrir('merma');
await page.click('.imp-paste summary');
await page.fill('[data-paste]', fs.readFileSync(path.join(TMP, 'pegado.tsv'), 'utf8'));
await page.click('[data-usepaste]');
await page.waitForSelector('.imp-detect');
ok(/Tabla libre/.test(await txt('.imp-detect')) && /tabulador/.test(await txt('.imp-detect')), 'texto pegado reconocido (tabulador)');
ok((await page.evaluate(() => document.querySelector('[data-destino]').value)) === 'agua', 'destino sugerido por encabezados: agua');
await shot('c-pegado');
await cerrar();

console.log('\n== Superposición «Suelta el archivo aquí» y Documentos');
await ir('aseos');
await page.evaluate(() => {
  const dt = new DataTransfer(); dt.items.add(new File(['a;b\n1;2'], 'x.csv', { type: 'text/csv' }));
  document.querySelector('#view').dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
});
await page.waitForTimeout(200);
ok(await page.evaluate(() => document.querySelector('.imp-overlay.on') != null), 'aparece la superposición al arrastrar');
await shot('c-overlay');
await toTheme('dark'); await shot('c-overlay-oscuro'); await toTheme('light');
await page.evaluate(() => {
  const dt = new DataTransfer(); dt.items.add(new File(['Fecha;Equipo\n01/10/2026;FV 1'], 'x.csv', { type: 'text/csv' }));
  document.querySelector('.imp-ov-data').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForSelector('.imp-dlg .imp-detect');
ok(true, 'soltar abre el asistente con el archivo');
await cerrar();

await ir('aseos');
const panel = '[data-doc-panel=aseos]';
await page.waitForSelector(panel);
ok(/Documentos/.test(await txt(panel + ' summary')), 'panel «Documentos» inyectado en Aseos');
await page.click(panel + ' summary');
await page.setInputFiles(panel + ' [data-doc-file]', [path.join(TMP, 'procedimiento.pdf'), path.join(TMP, 'foto-aseo.png')]);
await page.waitForFunction(() => document.querySelectorAll('[data-doc-panel=aseos] .doc-item').length === 2, null, { timeout: 8000 });
ok(await page.evaluate(async () => (await App.Documentos.contar('aseos')) === 2), 'contar(aseos) = 2');
ok(/\(2\)/.test(await txt(panel + ' [data-doc-n]')), 'el título muestra Documentos (2)');
await shot('c-docs-lista');
await toTheme('dark'); await shot('c-docs-lista-oscuro'); await toTheme('light');
const nota = await page.evaluate(async () => { const l = await App.Documentos.listar('aseos'); return l.map((d) => d.nombre + ':' + d.tipo).sort(); });
ok(nota.length === 2 && /pdf/.test(nota.join()) && /png/.test(nota.join()), 'listar devuelve PDF e imagen ' + nota.join(' '));
const b = await page.evaluate(async () => (await App.Documentos.buscar('procedimiento')).length);
ok(b === 1, 'buscar por nombre');
// vista previa imagen
await page.click(panel + ' .doc-item:has-text("foto-aseo") [data-act=ver]');
await page.waitForSelector('.doc-dlg img');
await page.waitForTimeout(300);
await shot('c-docs-preview-img');
ok(await page.evaluate(() => { const i = document.querySelector('.doc-dlg img'); return i && i.naturalWidth === 160; }), 'vista previa de imagen carga el blob');
await page.click('.doc-dlg [data-x]');
await page.click(panel + ' .doc-item:has-text("procedimiento") [data-act=ver]');
await page.waitForSelector('.doc-dlg iframe');
ok(await page.evaluate(() => /^blob:/.test(document.querySelector('.doc-dlg iframe').src)), 'vista previa de PDF usa un object URL');
await page.click('.doc-dlg [data-x]');
// descargar
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click(panel + ' .doc-item:has-text("foto-aseo") [data-act=dl]')]);
ok(!!dl && dl.suggestedFilename() === 'foto-aseo.png', 'descargar entrega el archivo original');
// editar nota
await page.click(panel + ' .doc-item:has-text("procedimiento") [data-act=nota]');
await page.waitForSelector('dialog[open] textarea');
await page.fill('dialog[open] textarea', 'Versión 3 vigente');
await page.click('dialog[open] button[type=submit]');
await page.waitForFunction(() => /Versión 3/.test(document.querySelector('[data-doc-panel=aseos] .doc-list').textContent), null, { timeout: 5000 });
ok(true, 'la nota se guarda y se muestra');
// persiste al recargar la ruta
await ir('agua'); await ir('aseos');
ok(await page.evaluate(async () => (await App.Documentos.contar('aseos')) === 2), 'los documentos persisten al cambiar de sección');
// límite
await page.evaluate(() => App.Documentos.fijarLimite(1));
await page.evaluate(async (f) => { const r = await App.Documentos.subir('aseos', [new File([new Uint8Array(2 * 1048576)], 'enorme.bin')]); window.__sub = r.length; }, '');
ok((await page.evaluate(() => window.__sub)) === 0, 'archivo mayor al límite se rechaza con aviso');
await page.evaluate(() => App.Documentos.fijarLimite(25));
// eliminar
await page.click(panel + ' .doc-item:has-text("foto-aseo") [data-act=del]');
await confirmar();
await page.waitForFunction(() => document.querySelectorAll('[data-doc-panel=aseos] .doc-item').length === 1, null, { timeout: 5000 });
ok(true, 'eliminar con confirmación');
await page.evaluate(async () => { for (const d of await App.Documentos.listar()) await App.Documentos.quitar(d.id, true); });

console.log('\n== Botones por sección');
for (const r of ['tanques', 'levaduras', 'bd', 'aseos', 'recuperacion', 'programa', 'merma', 'agua', 'analisis']) {
  await ir(r);
  const t = await page.evaluate(() => [...document.querySelectorAll('[data-cifra-btn]')].map((x) => x.textContent));
  ok(t.includes('Cargar archivo'), r + ': botón «Cargar archivo»' + (t.includes('Descargar plantilla') ? ' + plantilla' : ''));
  const pnl = await page.evaluate(() => !!document.querySelector('[data-doc-panel]'));
  ok(pnl, r + ': panel de documentos');
}
console.log('\n== Plantilla de Excel');
await ir('agua');
const [pl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.click('[data-cifra-btn=imp-plantilla]')]);
ok(!!pl, 'la plantilla se descarga' + (pl ? ' (' + pl.suggestedFilename() + ')' : ''));
if (pl) {
  const f = path.join(TMP, pl.suggestedFilename()); await pl.saveAs(f);
  await abrir('agua'); await cargar(f);
  const m = await page.evaluate(() => [...document.querySelectorAll('[data-map]')].filter((s) => s.value !== '-1').length);
  ok(m >= 8, 'la plantilla vuelve a importarse con el mapeo completo (' + m + ' columnas)');
  await shot('c-plantilla');
  await cerrar();
}

ok(errores.length === 0, 'sin errores de página (' + errores.length + ')');
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + (fallos ? fallos + ' FALLOS' : 'TODO OK') + ' · capturas en ' + SH);
process.exit(fallos ? 1 : 0);
