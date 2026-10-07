/* ============================================================
   «Pulso de la planta» en Inicio: indicadores clave de la última semana/mes, lo que conviene revisar y accesos rápidos.
   Se inyecta en la pantalla existente con App.Seccion.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.DL) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const nf = (d) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: d });
  const fmt = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : nf(d).format(x));
  const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const sum = (a) => a.filter(Number.isFinite).reduce((s, x) => s + x, 0);
  const nombre = () => (A.Metas ? A.Metas.get('asistente.nombre', 'Cifra') : 'Cifra');

  // «Hoy» = último dato real disponible (el programa trabaja con cortes del Excel).
  function ahora() {
    const ends = ['agua', 'merma', 'recuperacion', 'ferm', 'lev'].map((n) => { const e = A.DL.extent(n); return e ? e.to : null; }).filter((t) => t && t <= Date.now() + 7 * DAY);
    return ends.length ? Math.max(...ends) : Date.now();
  }
  const ventana = (ds, fin, dias, desplazo = 0) => A.DL.get(ds).filter((r) => r.t != null && r.t <= fin - desplazo * DAY && r.t > fin - (dias + desplazo) * DAY);

  function delta(a, b, bueno) {
    if (a == null || b == null || b === 0) return '';
    const d = ((a - b) / Math.abs(b)) * 100;
    if (Math.abs(d) < 0.5) return '<span class="pl-d">sin cambio</span>';
    const sube = d > 0, ok = (bueno === 'baja') === !sube;
    return `<span class="pl-d ${ok ? 'ok' : 'bad'}">${sube ? '▲' : '▼'} ${fmt(Math.abs(d), 0)} %</span>`;
  }

  function kpis() {
    const fin = ahora(), L = [];
    const aguaA = ventana('agua', fin, 7).filter((r) => r.valid && r.total != null), aguaB = ventana('agua', fin, 7, 7).filter((r) => r.valid && r.total != null);
    if (aguaA.length) L.push({ l: 'Agua por turno', v: fmt(mean(aguaA.map((r) => r.total)), 0), u: 'm³', d: delta(mean(aguaA.map((r) => r.total)), mean(aguaB.map((r) => r.total)), 'baja'), s: 'últimos 7 días', ir: 'analisis/agua' });
    const ok = (r) => r.loss != null && r.input > 0 && r.loss >= 0 && !r.flag;
    const mA = ventana('merma', fin, 30).filter(ok), mB = ventana('merma', fin, 30, 30).filter(ok);
    const pc = (rows) => (sum(rows.map((r) => r.input)) > 0 ? (sum(rows.map((r) => r.loss)) / sum(rows.map((r) => r.input))) * 100 : null);
    if (mA.length) L.push({ l: 'Merma', v: fmt(pc(mA), 2), u: '%', d: delta(pc(mA), pc(mB), 'baja'), s: `${mA.length} lotes · 30 días`, ir: 'analisis/merma' });
    const rA = ventana('recuperacion', fin, 30), rB = ventana('recuperacion', fin, 30, 30);
    if (rA.length) L.push({ l: 'Cerveza recuperada', v: fmt(sum(rA.map((r) => r.volume)), 0), u: 'Hl', d: delta(sum(rA.map((r) => r.volume)), sum(rB.map((r) => r.volume)), 'sube'), s: `${rA.length} recuperaciones · 30 días`, ir: 'analisis/recuperacion' });
    const tol = A.Metas ? A.Metas.get('trasiego.desvioMaxH', 1) : 1;
    const tA = ventana('trasiego', fin, 30).filter((r) => r.delay != null), tB = ventana('trasiego', fin, 30, 30).filter((r) => r.delay != null);
    const aT = (rows) => (rows.length ? (rows.filter((r) => r.delay <= tol).length / rows.length) * 100 : null);
    if (tA.length) L.push({ l: 'Trasiegos a tiempo', v: fmt(aT(tA), 0), u: '%', d: delta(aT(tA), aT(tB), 'sube'), s: `${tA.length} actividades · 30 días`, ir: 'analisis/operacion' });
    const lA = ventana('lev', fin, 30).filter((r) => r.viab != null), lB = ventana('lev', fin, 30, 30).filter((r) => r.viab != null);
    if (lA.length) L.push({ l: 'Viabilidad de levadura', v: fmt(mean(lA.map((r) => r.viab)), 1), u: '%', d: delta(mean(lA.map((r) => r.viab)), mean(lB.map((r) => r.viab)), 'sube'), s: `${lA.length} cosechas · 30 días`, ir: 'analisis/levadura' });
    return L;
  }

  function hallazgos() {
    try {
      if (!A.Analisis || !A.Analisis.hallazgos) return [];
      const ctx = A.Analisis.contexto();
      return A.Analisis.hallazgos(ctx).filter((h) => h.sev === 'alta' || h.sev === 'media').slice(0, 3);
    } catch (e) { return []; }
  }

  function html() {
    const K = kpis(), H = hallazgos(), n = nombre();
    const fin = ahora();
    const d = new Date(fin);
    const cuando = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    return `<section class="pl" data-cifra-pulso aria-label="Pulso de la planta">
      <div class="pl-h"><div><span class="pl-k">PULSO DE LA PLANTA</span><h2>Cómo va la operación</h2></div><small>Datos hasta el ${esc(cuando)}</small></div>
      ${K.length ? `<div class="pl-kpis">${K.map((k) => `<a class="pl-kpi" href="#/${k.ir}"><span>${esc(k.l)}</span><b>${esc(k.v)}<small>${esc(k.u)}</small></b><div>${k.d}<em>${esc(k.s)}</em></div></a>`).join('')}</div>` : '<p class="pl-vacio">Carga tus archivos para ver aquí los indicadores.</p>'}
      <div class="pl-cols">
        <div class="pl-rev"><h3>Qué conviene revisar</h3>${H.length ? H.map((h) => `<a class="pl-hall ${esc(h.sev)}" href="#/analisis/${esc(h.tab)}"><i></i><span><b>${esc(h.titulo)}</b>${h.detalle ? `<small>${esc(h.detalle)}</small>` : ''}</span></a>`).join('') : `<p class="pl-vacio">${A.Analisis ? 'Nada urgente en el periodo. Buen trabajo.' : 'Aquí aparecerán los hallazgos del análisis.'}</p>`}
          <a class="pl-mas" href="#/analisis/resumen">Ver todo el análisis →</a></div>
        <div class="pl-acc"><h3>Accesos rápidos</h3>
          <button type="button" class="btn" data-pl="agua">Capturar agua como Excel</button>
          <button type="button" class="btn" data-pl="cargar">Cargar un archivo</button>
          <button type="button" class="btn pri" data-pl="ask">Preguntarle a ${esc(n)}</button></div>
      </div></section>`;
  }

  function inyectar(vista) {
    if (vista.querySelector('[data-cifra-pulso]')) return;
    if (!A.S || !A.S.ready) return;
    const caja = document.createElement('div');
    caja.innerHTML = html();
    const nodo = caja.firstElementChild;
    const ref = vista.querySelector('.cavas-summary');
    const page = ref ? ref.closest('.sec, section, div') : null;
    if (ref && ref.parentElement) ref.parentElement.insertBefore(nodo, ref.nextSibling); else vista.prepend(nodo);
    nodo.querySelector('[data-pl="agua"]').onclick = () => { if (A.Captura && A.Captura.abrir) { A.go('agua'); setTimeout(() => A.Captura.abrir('agua', '2026'), 400); } else A.go('agua'); };
    nodo.querySelector('[data-pl="cargar"]').onclick = () => { if (A.Importador && A.Importador.abrir) A.Importador.abrir({}); else A.go('bd'); };
    nodo.querySelector('[data-pl="ask"]').onclick = () => { if (A.Bot && A.Bot.abrir) A.Bot.abrir(); };
  }
  A.Seccion.registrar('inicio', inyectar);
})();
