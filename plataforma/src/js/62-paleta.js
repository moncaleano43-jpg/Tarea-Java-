/* ============================================================
   Paleta de comandos (Ctrl/⌘ + K): ir a cualquier sección, ejecutar acciones y preguntarle al asistente.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nombre = () => (A.Metas ? A.Metas.get('asistente.nombre', 'Cifra') : 'Cifra');
  const go = (r) => () => { if (A.go) A.go(r); else location.hash = '#/' + r; };
  const hay = (fn) => { try { return !!fn(); } catch (e) { return false; } };

  function preguntar(q) {
    if (A.Bot && A.Bot.abrir) A.Bot.abrir();
    let n = 0;
    const t = setInterval(() => {
      const i = document.getElementById('botI'), f = document.getElementById('botF');
      if (i && f) { clearInterval(t); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }
      else if (++n > 30) clearInterval(t);
    }, 100);
  }

  function items() {
    const L = [];
    const nav = (grupo, ids) => ids.forEach(([r, t, kw]) => L.push({ g: grupo, t, kw: kw || '', run: go(r), hint: 'Ir a' }));
    nav('Secciones', [
      ['inicio', 'Inicio', 'panel resumen'], ['tanques', 'Tanques', 'fermentadores maduradores fv sv utq'], ['levaduras', 'Levaduras', 'colectores banco'], ['bd', 'Base de datos', 'registros cosechas'],
      ['agua', 'Consumo de agua', 'contadores turnos m3'], ['aseos', 'Aseos', 'cip limpieza'], ['recuperacion', 'Recuperación de cerveza', 'utk'], ['programa', 'Programa de trasiego', 'plan'],
      ['merma', 'Merma', 'perdidas'], ['config', 'Configuración', 'ajustes metas respaldo'], ['pantalla', 'Pantalla de planta', 'tv monitor'],
    ]);
    const pests = (A.Analisis && A.Analisis.pestanas) || [];
    pests.forEach((p) => L.push({ g: 'Análisis', t: 'Análisis · ' + p.label, kw: 'analisis datos ' + p.id, run: go('analisis/' + p.id), hint: 'Abrir' }));
    if (!pests.length) L.push({ g: 'Análisis', t: 'Análisis de datos', kw: 'analisis', run: go('analisis'), hint: 'Abrir' });
    L.push({ g: 'Análisis', t: 'Analista de fermentación (clásico)', kw: 'curvas historico', run: go('analista'), hint: 'Abrir' });
    L.push({ g: 'Análisis', t: 'Comparar marcas, tanques o periodos', kw: 'comparar', run: go('comparar'), hint: 'Abrir' });
    // Acciones que dependen de módulos opcionales
    if (hay(() => A.Captura && A.Captura.abrir)) {
      L.push({ g: 'Acciones', t: 'Capturar consumo de agua (como Excel)', kw: 'registrar lecturas turno contador', run: () => { go('agua')(); setTimeout(() => A.Captura.abrir('agua', '2026'), 400); }, hint: 'Registrar' });
      L.push({ g: 'Acciones', t: 'Capturar recuperación de cerveza', kw: 'registrar utk', run: () => { go('recuperacion')(); setTimeout(() => A.Captura.abrir('recuperacion', 'Control Recuperada'), 400); }, hint: 'Registrar' });
      L.push({ g: 'Acciones', t: 'Capturar programa de trasiego', kw: 'registrar plan', run: () => { go('programa')(); setTimeout(() => A.Captura.abrir('programa', 'CONTROL TRASIEGO'), 400); }, hint: 'Registrar' });
      L.push({ g: 'Acciones', t: 'Capturar aseo (cada uso)', kw: 'registrar cip limpieza', run: () => { go('aseos')(); setTimeout(() => A.Captura.abrir('aseos', '1. Cada uso'), 400); }, hint: 'Registrar' });
    }
    if (hay(() => A.Importador && A.Importador.abrir)) L.push({ g: 'Acciones', t: 'Cargar un archivo (Excel, CSV o documento)', kw: 'importar subir excel csv pdf', run: () => A.Importador.abrir({}), hint: 'Cargar' });
    L.push({ g: 'Acciones', t: 'Registrar un fermentador (FV)', kw: 'nuevo llenado', run: go('fv/nuevo'), hint: 'Registrar' });
    L.push({ g: 'Acciones', t: 'Cambiar tema claro/oscuro', kw: 'apariencia modo', run: () => { if (A.Tema) A.Tema.toggle(); }, hint: 'Cambiar' });
    if (hay(() => A.Config42)) {
      L.push({ g: 'Acciones', t: 'Descargar respaldo de todo lo capturado', kw: 'backup copia seguridad', run: () => A.Config42.respaldar(false), hint: 'Descargar' });
      L.push({ g: 'Acciones', t: 'Ver la guía rápida', kw: 'ayuda tutorial novedades', run: () => A.Config42.guia(), hint: 'Abrir' });
    }
    L.push({ g: nombre(), t: `Abrir a ${nombre()}`, kw: 'asistente chat preguntar bot', run: () => A.Bot && A.Bot.abrir && A.Bot.abrir(), hint: 'Abrir' });
    for (const q of ['¿Qué debería revisar hoy?', '¿Cuánto hemos gastado de agua este mes?', 'Resumen de la semana', '¿Qué marca tiene más merma?', '¿Qué puedo preguntarte?'])
      L.push({ g: nombre(), t: q, kw: '', run: () => preguntar(q), hint: 'Preguntar' });
    return L;
  }

  /* ---------- UI ---------- */
  let abierta = false;
  function abrir() {
    if (abierta) return;
    abierta = true;
    const todos = items();
    const cont = document.createElement('div');
    cont.className = 'pal42';
    cont.innerHTML = `<div class="pal42-box" role="dialog" aria-modal="true" aria-label="Paleta de comandos"><input class="pal42-in" placeholder="Busca una sección, una acción o escribe una pregunta…" aria-label="Comando" autocomplete="off"><ul class="pal42-list" role="listbox"></ul><div class="pal42-pie"><span>↑↓ moverse</span><span>↵ ejecutar</span><span>esc cerrar</span></div></div>`;
    document.body.appendChild(cont);
    const inp = cont.querySelector('input'), ul = cont.querySelector('ul');
    let sel = 0, vis = [];
    const recientes = () => { try { return JSON.parse(localStorage.getItem('cifra.pal.recientes') || '[]'); } catch (e) { return []; } };
    function filtrar(q) {
      const nq = norm(q);
      if (!nq) { const rec = recientes(); return [...rec.map((t) => todos.find((x) => x.t === t)).filter(Boolean), ...todos.filter((x) => !rec.includes(x.t))].slice(0, 14); }
      const tok = nq.split(' ');
      const pts = todos.map((x) => { const h = norm(x.t + ' ' + x.kw), tt = norm(x.t); let s = 0; for (const w of tok) { if (tt.startsWith(w)) s += 3; else if (tt.includes(w)) s += 2; else if (h.includes(w)) s += 1; else { s = -1; break; } } return { x, s }; }).filter((o) => o.s > 0).sort((a, b) => b.s - a.s).map((o) => o.x);
      const out = pts.slice(0, 9);
      if (q.trim().length > 2) out.push({ g: nombre(), t: `Preguntar a ${nombre()}: «${q.trim()}»`, hint: 'Preguntar', run: () => preguntar(q.trim()), libre: true });
      return out;
    }
    function pintar() {
      vis = filtrar(inp.value);
      if (sel >= vis.length) sel = Math.max(0, vis.length - 1);
      let ult = null;
      ul.innerHTML = vis.map((x, i) => { const head = x.g !== ult ? `<li class="pal42-g" role="presentation">${esc(x.g)}</li>` : ''; ult = x.g; return `${head}<li role="option" data-i="${i}" class="${i === sel ? 'on' : ''}" aria-selected="${i === sel}"><span>${esc(x.t)}</span><small>${esc(x.hint || '')}</small></li>`; }).join('') || '<li class="pal42-vacio">Nada coincide. Pulsa Enter para preguntarle al asistente.</li>';
      const on = ul.querySelector('li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function cerrar() { cont.remove(); abierta = false; document.removeEventListener('keydown', teclas, true); }
    function ejecutar(x) {
      if (!x) { if (inp.value.trim()) { cerrar(); preguntar(inp.value.trim()); } return; }
      if (!x.libre) { try { const r = recientes().filter((t) => t !== x.t); r.unshift(x.t); localStorage.setItem('cifra.pal.recientes', JSON.stringify(r.slice(0, 5))); } catch (e) { /* sin almacenamiento */ } }
      cerrar(); setTimeout(() => { try { x.run(); } catch (e) { if (window.console) console.error(e); } }, 30);
    }
    function teclas(e) {
      if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(vis.length - 1, sel + 1); pintar(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); pintar(); }
      else if (e.key === 'Enter') { e.preventDefault(); ejecutar(vis[sel]); }
    }
    document.addEventListener('keydown', teclas, true);
    inp.addEventListener('input', () => { sel = 0; pintar(); });
    ul.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) ejecutar(vis[+li.dataset.i]); });
    cont.addEventListener('mousedown', (e) => { if (e.target === cont) cerrar(); });
    pintar(); inp.focus();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abierta ? null : abrir(); }
  });
  A.Paleta = { abrir, preguntar };
})();
