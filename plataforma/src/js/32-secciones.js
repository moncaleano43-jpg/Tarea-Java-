/* ============================================================
   App.Seccion · permite añadir controles a las pantallas existentes sin tocar su código.
   registrar('aseos', (vista) => {...}) se ejecuta después de cada pintado de esa ruta ('*' = todas).
   Los manejadores deben ser idempotentes (comprobar si ya añadieron su control).
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;
  const regs = {};
  const ruta = () => (location.hash || '#/inicio').slice(2).split('/')[0];
  let timer = null, running = false;

  function run() {
    if (running) return;
    const vista = document.getElementById('view');
    if (!vista) return;
    const r = ruta();
    running = true;
    try {
      for (const fn of [...(regs[r] || []), ...(regs['*'] || [])]) {
        try { fn(vista, r); } catch (e) { if (window.console) console.error('[Seccion]', r, e); }
      }
    } finally { setTimeout(() => { running = false; }, 0); }
  }
  const programar = () => { clearTimeout(timer); timer = setTimeout(run, 40); };

  A.Seccion = {
    registrar(rutas, fn) { for (const r of [].concat(rutas)) (regs[r] = regs[r] || []).push(fn); programar(); },
    ruta, ejecutar: run,
    /** Crea (una sola vez) un botón en la fila de acciones de la cabecera de la pantalla. Devuelve el botón. */
    boton(vista, id, texto, onClick, { primario = false, antes = null } = {}) {
      if (!vista) return null;
      let b = vista.querySelector('[data-cifra-btn="' + id + '"]');
      if (b) return b;
      const caja = vista.querySelector('.studio-actions, .acts, .page-h .acts');
      if (!caja) return null;
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (primario ? ' pri' : '');
      b.dataset.cifraBtn = id;
      b.textContent = texto;
      b.addEventListener('click', onClick);
      const ref = antes ? caja.querySelector(antes) : null;
      if (ref) caja.insertBefore(b, ref); else caja.appendChild(b);
      return b;
    },
  };
  new MutationObserver(programar).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', programar);
})();
