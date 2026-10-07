// Construye la plataforma nueva a partir del HTML original del usuario (con sus datos) y las capas de src/.
// Uso: node plataforma/build.mjs <Control_Cavas_v36.html> [salida.html]
// Los datos de producción NO viven en este repositorio: se leen del archivo original en cada compilación.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATCHES } from './patches.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [, , input, output = join(here, 'dist', 'Control_Cavas_v42.html')] = process.argv;
if (!input) { console.error('Uso: node plataforma/build.mjs <Control_Cavas_v36.html> [salida.html]'); process.exit(1); }

let html = readFileSync(input, 'utf8');

for (const p of PATCHES) {
  const n = html.split(p.find).length - 1;
  if (n !== (p.count ?? 1)) throw new Error(`Parche «${p.name}»: se esperaban ${p.count ?? 1} coincidencias y hay ${n}`);
  html = html.split(p.find).join(p.replace);
}

const list = (dir, ext) => existsSync(join(here, 'src', dir))
  ? readdirSync(join(here, 'src', dir)).filter((f) => f.endsWith(ext)).sort() : [];
const css = list('css', '.css').map((f) => `<style id="v42-${f.replace(/\W/g, '-')}">\n${readFileSync(join(here, 'src/css', f), 'utf8')}\n</style>`).join('\n');
const js = list('js', '.js').map((f) => `<script id="v42-${f.replace(/\W/g, '-')}">\n${readFileSync(join(here, 'src/js', f), 'utf8')}\n</script>`).join('\n');

const cut = (s, marker, add, before = true) => {
  const i = s.lastIndexOf(marker);
  if (i < 0) throw new Error(`No se encontró ${marker}`);
  return before ? s.slice(0, i) + add + '\n' + s.slice(i) : s.slice(0, i + marker.length) + '\n' + add + s.slice(i + marker.length);
};
// El programa original inyecta más <style> en el <body> durante la carga; las capas v42 deben quedar siempre al final.
const keepLast = `<script id="v42-css-last">(function(){
  var run=function(){var b=document.body;if(!b)return;
    var all=document.querySelectorAll('style'),mine=document.querySelectorAll('style[id^="v42-"]');
    if(!mine.length)return;
    var lastMine=mine[mine.length-1],after=false;
    for(var i=all.length-1;i>=0;i--){if(all[i]===lastMine)break;if(all[i].id.indexOf('v42-')!==0){after=true;break}}
    if(after||lastMine.parentNode!==b){mine.forEach(function(x){b.appendChild(x)})}};
  run();new MutationObserver(function(){clearTimeout(run.t);run.t=setTimeout(run,50)}).observe(document.documentElement,{childList:true,subtree:true});
  [300,1200,3000].forEach(function(ms){setTimeout(run,ms)});
})();</script>`;
html = cut(html, '</head>', css);
html = cut(html, '</body>', js + '\n' + keepLast);

writeFileSync(output, html);
console.log(`OK → ${output} (${(html.length / 1e6).toFixed(2)} MB, ${PATCHES.length} parches, ${list('css', '.css').length} css, ${list('js', '.js').length} js)`);
