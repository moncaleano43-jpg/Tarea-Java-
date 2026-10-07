// Prueba de interfaz de Cifra: abre el panel real, escribe, ve la respuesta con gráfico y chips, abre «¿Qué puedo preguntar?»,
// prueba el autocompletado y toma capturas en claro, oscuro y 390 px.
// Uso: NODE_PATH=$(npm root -g) node plataforma/tests/asistente.ui.mjs [html compilado] [carpeta de capturas]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(process.env.PW_ROOT ? process.env.PW_ROOT + '/' : '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const html = process.argv[2] || '/tmp/claude-0/asis.html';
const out = process.argv[3] || '/tmp/claude-0/shots';
mkdirSync(out, { recursive: true });
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const fails = [];
const check = (c, msg) => { if (!c) { fails.push(msg); console.log('  FALLA:', msg); } else console.log('  ok:', msg); };

async function session(name, viewport, theme) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(pathToFileURL(html).href);
  await page.waitForFunction(() => window.App && App.Cifra && App.S && App.S.ready, null, { timeout: 30000 });
  await page.evaluate((t) => { try { App.Tema.set(t); } catch (e) { /* tema por defecto */ } }, theme);
  await page.waitForTimeout(800);
  console.log('\n[' + name + ']');
  // 1) abrir el panel con el botón de la barra superior
  await page.evaluate(() => { try { localStorage.removeItem('levabot.chat.v2'); localStorage.removeItem('cifra.freq.v1'); } catch (e) { /* sin almacenamiento */ } });
  const btn = page.locator('#botBtn');
  check(await btn.count() > 0, 'existe el botón del asistente en la barra superior');
  if (await btn.count()) { const lab = await btn.getAttribute('aria-label'); check(/Cifra/.test(lab || ''), 'el botón se llama Cifra (' + lab + ')'); await btn.click({ force: true }); } else await page.evaluate(() => App.Bot.abrir());
  await page.waitForSelector('#levabot:not([hidden])');
  await page.waitForTimeout(500);
  check(await page.locator('#levabot .bot-h b').first().innerText() === 'Cifra', 'el encabezado dice Cifra');
  const sub = await page.locator('#levabot .cf-sub').first().innerText();
  check(/Analista de datos de la planta/.test(sub), 'subtítulo «' + sub + '»');
  const subBox = await page.locator('#levabot .cf-sub').first().evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height }));
  check(subBox.sw <= subBox.cw + 1, 'el subtítulo no se corta (' + subBox.sw + '/' + subBox.cw + ')');
  check(await page.locator('#cfWelcome:not([hidden])').count() === 1, 'estado vacío con ayuda visible');
  check(await page.locator('#cfWelcome .cf-q').count() >= 4, 'preguntas sugeridas para la pantalla');
  await page.screenshot({ path: `${out}/${name}-1-vacio.png` });
  // 2) preguntar con el teclado
  await page.fill('#botI', 'cuanta agua gastamos este mes');
  await page.waitForTimeout(250);
  check(await page.locator('#cfSug:not([hidden]) .cf-sug-i').count() > 0, 'autocompletado aparece al escribir ≥ 3 letras');
  await page.screenshot({ path: `${out}/${name}-2-autocompletar.png` });
  await page.keyboard.press('Enter');
  const pasos = await page.waitForSelector('#levabot .cf-steps', { timeout: 600 }).then(() => true, () => false);
  check(pasos, 'indicador «analizando…» con pasos mientras responde');
  await page.waitForSelector('#levabot .cf-ans', { timeout: 8000 });
  await page.waitForTimeout(600);
  check(await page.locator('#levabot .cf-ans svg.ch-svg').count() >= 1, 'la respuesta trae gráfico');
  check(await page.locator('#levabot .bot-opts .chip').count() >= 3, 'la respuesta trae chips de seguimiento');
  check(await page.locator('#levabot .cf-kpis .ch-kpi').count() >= 2, 'la respuesta trae KPI');
  check(await page.locator('#levabot .cf-src').count() >= 1, 'la respuesta cita fuente, periodo y cobertura');
  check(await page.locator('#levabot [data-cf-go]').count() >= 1, 'botón «Abrir en Análisis»');
  check(await page.locator('#levabot.cf-empty').count() === 0, 'sale del estado vacío tras preguntar');
  await page.screenshot({ path: `${out}/${name}-3-respuesta.png` });
  // 3) chip de seguimiento: «¿Y por turno?» y gráfico de barras
  const chip = page.locator('#levabot .bot-opts .chip', { hasText: 'turno' }).first();
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1500); }
  check(await page.locator('#levabot .bm.b .cf-ans').count() >= 2, 'el chip genera una segunda respuesta');
  const lastAns = page.locator('#levabot .bm.b .cf-ans').last();
  await lastAns.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-4-seguimiento.png` });
  // 4) tabla + copiar
  await page.fill('#botI', 'top 10 aseos con más consumo de agua');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1600);
  check(await page.locator('#levabot .cf-tbl').count() >= 1, 'respuesta con mini-tabla');
  await page.locator('#levabot [data-cf-copy]').last().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-5-tabla.png` });
  // 5) panel «¿Qué puedo preguntar?»
  await page.locator('#cfHelpBtn').click();
  await page.waitForSelector('#cfHelpPanel:not([hidden])');
  const nq = await page.evaluate(() => App.Cifra.catalogo().length);
  check(nq >= 100, 'catálogo con ' + nq + ' preguntas de ejemplo (≥ 100)');
  check(await page.locator('#cfHelpPanel .cf-tab').count() >= 10, 'categorías en el panel de ayuda');
  await page.screenshot({ path: `${out}/${name}-6-ayuda.png` });
  await page.fill('#cfHelpSearch', 'merma');
  await page.waitForTimeout(200);
  check(await page.locator('#cfHelpPanel .cf-q').count() >= 3, 'la búsqueda dentro de la ayuda filtra preguntas');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(await page.locator('#cfHelpPanel:not([hidden])').count() === 0, 'Escape cierra la ayuda sin cerrar el panel');
  check(await page.locator('#levabot:not([hidden])').count() === 1, 'el panel sigue abierto');
  // 6) ampliar
  if (viewport.width > 700) {
    await page.locator('#cfWideBtn').click();
    await page.waitForTimeout(400);
    const w = await page.locator('#levabot').evaluate((e) => e.getBoundingClientRect().width);
    check(w > 600, 'el panel se amplía (' + Math.round(w) + ' px)');
    await page.screenshot({ path: `${out}/${name}-7-ancho.png` });
    await page.locator('#cfWideBtn').click();
  }
  // 7) nombre configurable
  await page.evaluate(() => { App.Metas.get = ((g) => (p, d) => (p === 'asistente.nombre' ? 'Dato' : g(p, d)))(App.Metas.get); App.Cifra.aplicarNombre(); });
  check((await page.locator('#levabot .bot-h b').first().innerText()) === 'Dato', 'aplicarNombre() cambia el nombre del panel');
  check(/Dato/.test((await page.locator('#botI').getAttribute('placeholder')) || ''), 'y el placeholder del cuadro de texto');
  if (await btn.count()) check(/Dato/.test((await btn.getAttribute('aria-label')) || ''), 'y el botón de la barra superior');
  // 8) teclado: Escape cierra el panel
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await page.locator('#levabot[hidden]').count() === 1, 'Escape cierra el panel');
  check(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await ctx.close();
}
await session('claro', { width: 1360, height: 860 }, 'light');
await session('oscuro', { width: 1360, height: 860 }, 'dark');
await session('movil', { width: 390, height: 844 }, 'light');
await browser.close();
console.log(fails.length ? '\nFALLAS: ' + fails.length : '\nUI: todo ok');
process.exit(fails.length ? 1 : 0);
