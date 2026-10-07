// Prueba de integración: abre el HTML construido, recorre todas las rutas en claro y oscuro y falla si hay errores de página.
// Uso: NODE_PATH=$(npm root -g) node plataforma/tests/integracion.mjs <Control_Cavas_v42.html> [carpeta_capturas]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [, , file, out = '/tmp/claude-0/integracion'] = process.argv;
if (!file) { console.error('Falta el HTML construido'); process.exit(1); }
mkdirSync(out, { recursive: true });

const RUTAS = ['inicio', 'tanques', 'levaduras', 'bd', 'agua', 'aseos', 'recuperacion', 'programa', 'merma', 'config',
  'analisis/resumen', 'analisis/agua', 'analisis/merma', 'analisis/fermentacion', 'analisis/levadura', 'analisis/recuperacion', 'analisis/operacion',
  'analisis/relaciones', 'analisis/pronosticos', 'analisis/constructor', 'analisis/calidad', 'analisis/informe', 'analista', 'comparar'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let fallos = 0;
for (const tema of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: tema });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
  await page.goto('file://' + file);
  await page.evaluate((t) => { localStorage.setItem('cifra.guia.v42', '1'); document.documentElement.dataset.theme = t; }, tema);
  await page.waitForTimeout(3500);
  for (const r of RUTAS) {
    const antes = errores.length;
    const t0 = Date.now();
    await page.evaluate((h) => { location.hash = '#/' + h; }, r);
    await page.waitForTimeout(1200);
    const ms = Date.now() - t0 - 1200;
    await page.screenshot({ path: `${out}/${tema}-${r.replace(/\//g, '_')}.png` });
    const nuevos = errores.slice(antes);
    if (nuevos.length) { fallos++; console.log(`✗ [${tema}] #/${r}`, nuevos.slice(0, 3)); } else console.log(`✓ [${tema}] #/${r} (${ms} ms de margen)`);
  }
  await ctx.close();
}
await browser.close();
if (fallos) { console.error(`${fallos} ruta(s) con errores`); process.exit(1); }
console.log('Integración OK');
