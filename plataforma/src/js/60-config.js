/* ============================================================
   Configuración ampliada: asistente, metas y límites, equivalencias de marca, respaldo y restauración,
   apariencia (densidad, tamaño de texto, movimiento), atajos y novedades.
   Se inyecta en la pantalla #/config existente con App.Seccion (no la reemplaza).
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;
  const esc = (s) => (A.U && A.U.esc ? A.U.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const toast = (m) => { try { A.U.toast(m); } catch (e) { /* sin toast */ } };
  const VERSION = 'v42';

  /* ---------- Preferencias de interfaz (se aplican al cargar) ---------- */
  const UIKEY = 'cifra.ui';
  const ui = Object.assign({ densidad: 'comoda', texto: 'normal', sinMovimiento: false }, (() => { try { return JSON.parse(localStorage.getItem(UIKEY) || '{}'); } catch (e) { return {}; } })());
  function aplicarUI() {
    const r = document.documentElement;
    r.classList.toggle('ui-compacta', ui.densidad === 'compacta');
    r.classList.toggle('ui-grande', ui.texto === 'grande');
    r.classList.toggle('ui-muy-grande', ui.texto === 'muygrande');
    r.classList.toggle('ui-sin-mov', !!ui.sinMovimiento);
  }
  const guardarUI = () => { try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) { /* sin almacenamiento */ } aplicarUI(); };
  aplicarUI();

  /* ---------- Metas: etiquetas ---------- */
  const GRUPOS = [
    ['agua', 'Consumo de agua', [
      ['aseoM3', 'Consumo objetivo por aseo', 'm³'], ['pisosBajo', 'Pisos: límite inferior normal por lectura', 'm³'], ['pisosAlto', 'Pisos: límite superior normal por lectura', 'm³'],
      ['geaBajo', 'CIP GEA: límite inferior normal', 'Hl'], ['geaAlto', 'CIP GEA: límite superior normal', 'Hl'], ['turnosAtipicos', 'Un turno es atípico si supera la mediana por', '×']]],
    ['recuperacion', 'Recuperación de cerveza', [
      ['objetivoH', 'Horas objetivo hasta recuperar', 'h'], ['maximoH', 'Horas máximas permitidas', 'h'], ['phMax', 'pH máximo', ''], ['phObjetivo', 'pH objetivo', ''],
      ['tempMax', 'Temperatura máxima de la cerveza recuperada', '°C'], ['presionMax', 'Presión máxima del UTK', 'PSI'], ['aguaMin', 'Relación agua/levadura mínima', '%'], ['aguaMax', 'Relación agua/levadura máxima', '%']]],
    ['aseos', 'Aseos (CIP)', [['phMin', 'pH final de enjuague: mínimo', ''], ['phMax', 'pH final de enjuague: máximo', ''], ['aseoDiasUrgente', 'Marcar URGENTE cuando falten', 'días'], ['aseoDiasPilas', 'Marcar PILAS cuando falten', 'días']]],
    ['trasiego', 'Programa de trasiego', [['trasiegoH', 'Duración planeada de un trasiego', 'h'], ['cipCentrifugaH', 'Duración planeada del CIP de centrífuga', 'h'], ['holguraH', 'Holgura entre actividades', 'h'], ['desvioMaxH', 'Desvío tolerado frente al plan', 'h']]],
    ['levadura', 'Levadura', [['viabMin', 'Viabilidad mínima', '%'], ['tempMin', 'Temperatura mínima de almacenamiento', '°C'], ['tempMax', 'Temperatura máxima de almacenamiento', '°C']]],
    ['merma', 'Merma', [['fvMax', 'Merma máxima esperada en fermentación (FV)', '%'], ['svMax', 'Merma máxima esperada en maduración (SV)', '%'], ['alerta', 'Revisar datos si la merma supera', '%']]],
    ['calidad', 'Capacidad de proceso', [['cpkMinimo', 'Cpk mínimo para considerar el proceso capaz', ''], ['sigmas', 'Sigmas de los límites de control', 'σ']]],
  ];

  const icono = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    bot: icono('<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V5M9 13h.01M15 13h.01M9 16.5h6"/><circle cx="12" cy="4" r="1"/>'),
    meta: icono('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    tag: icono('<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.2"/>'),
    save: icono('<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>'),
    eye: icono('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    key: icono('<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>'),
    info: icono('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'),
  };
  const sec = (ic, titulo, sub, cuerpo, id) => `<section class="config-section cf-sec" ${id ? `id="${id}"` : ''}><div class="config-section-head"><span class="config-icon cf-ic">${ic}</span><div><h2>${esc(titulo)}</h2><p>${sub}</p></div></div>${cuerpo}</section>`;

  /* ---------- Bloques ---------- */
  const nombreAsistente = () => (A.Metas ? A.Metas.get('asistente.nombre', 'Cifra') : 'Cifra');

  function bloqueAsistente() {
    return sec(IC.bot, 'Asistente', 'Nombre y comportamiento de tu analista de datos.', `
      <div class="fg"><label class="f"><span>Nombre del asistente</span><input class="inp" id="cfNombre" maxlength="24" value="${esc(nombreAsistente())}"></label></div>
      <div class="cf-row"><button class="btn pri" type="button" id="cfNombreGuardar">Guardar nombre</button>
      <button class="btn" type="button" id="cfBotAyuda">Ver qué puede responder</button>
      <button class="btn" type="button" id="cfBotBorrar">Borrar historial y preguntas frecuentes</button></div>
      <p class="config-help">Responde con lo que hay en la plataforma: consulta tus datos, calcula, compara, proyecta y dibuja gráficos. Todo se calcula en este equipo; no se envía nada a internet.</p>`, 'cfAsistente');
  }

  function bloqueMetas() {
    const m = A.Metas.all();
    const grupos = GRUPOS.map(([g, titulo, campos]) => `
      <details class="cf-grupo" ${g === 'agua' ? 'open' : ''}><summary><b>${esc(titulo)}</b><small>${campos.length} valores</small></summary>
        <div class="fg">${campos.map(([k, l, u]) => `<label class="f"><span>${esc(l)}${u ? ` <em>(${esc(u)})</em>` : ''}</span><input class="inp" type="number" step="any" data-meta="${g}.${k}" value="${m[g][k] == null ? '' : m[g][k]}" placeholder="sin definir"></label>`).join('')}</div>
        <div class="cf-row"><button class="btn pri" type="button" data-meta-guardar="${g}">Guardar</button><button class="btn" type="button" data-meta-reset="${g}">Restablecer</button></div></details>`).join('');
    return sec(IC.meta, 'Metas y límites del proceso', 'Con estos valores se colorean los semáforos, se detectan atípicos y se escriben las conclusiones del análisis. Los iniciales salen de tus propios Excel (TG, UCL y notas).', grupos, 'cfMetas');
  }

  function bloqueMarcas() {
    let filas = [];
    try { filas = A.DL.marcasVistas(); } catch (e) { filas = []; }
    const canon = [...new Set(filas.map((f) => f.canon))].sort();
    const raros = filas.filter((f) => f.raw !== f.canon || f.manual);
    const cuerpo = filas.length ? `<div class="cf-tabla"><table><thead><tr><th>Como aparece en los datos</th><th class="n">Registros</th><th>Se cuenta como</th></tr></thead><tbody>
      ${filas.map((f) => `<tr><td>${esc(f.raw)}</td><td class="n">${f.n}</td><td><input class="inp cf-alias" list="cfMarcasLista" data-raw="${esc(f.raw)}" value="${esc(f.canon)}"></td></tr>`).join('')}</tbody></table></div>
      <datalist id="cfMarcasLista">${canon.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="cf-row"><button class="btn pri" type="button" id="cfAliasGuardar">Guardar equivalencias</button></div>
      <p class="config-help">${raros.length ? `Hoy se unifican ${raros.length} variante${raros.length === 1 ? '' : 's'} (por ejemplo «STD» → «ESTANDAR»).` : 'No hay variantes por unificar.'} Los Excel escriben la misma marca de varias formas; aquí decides cómo se agrupan en análisis, gráficas y preguntas al asistente.</p>` : '<p class="config-help">Aún no hay datos con marca.</p>';
    return sec(IC.tag, 'Equivalencias de marca', 'Une «STD», «ESTANDAR » y «Águila Light» sin tocar tus datos originales.', cuerpo, 'cfMarcas');
  }

  function bloqueRespaldo() {
    return sec(IC.save, 'Respaldo y restauración', 'Lleva todo lo capturado a otro equipo o guárdalo por seguridad.', `
      <div class="config-data-stats cf-stats"><div><small>Almacenamiento usado</small><b id="cfUso">…</b></div><div><small>Último respaldo</small><b id="cfUltimo">${esc(ultimoRespaldo())}</b></div></div>
      <div class="cf-row"><button class="btn pri" type="button" id="cfRespaldar">Descargar respaldo (.json)</button>
      <label class="btn cf-file">Restaurar desde respaldo<input type="file" id="cfRestaurar" accept=".json,application/json" hidden></label></div>
      <p class="config-help">El respaldo incluye capturas, metas, equivalencias, auditoría y las fuentes Excel que hayas cargado. No incluye los archivos adjuntos (documentos). Antes de restaurar se descarga una copia del estado actual.</p>
      <label class="cf-check"><input type="checkbox" id="cfRecordar" ${localStorage.getItem('cifra.recordarRespaldo') !== '0' ? 'checked' : ''}> Recordarme hacer un respaldo cada 7 días</label>`, 'cfRespaldo');
  }

  function bloqueApariencia() {
    const seg = (name, opts, val) => `<div class="cf-seg" role="group" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${val === v}">${esc(l)}</button>`).join('')}</div>`;
    return sec(IC.eye, 'Apariencia y accesibilidad', 'Ajusta la densidad y el tamaño del texto a tu pantalla.', `
      <div class="cf-fila"><div><b>Densidad</b><small>Compacta muestra más filas en tablas y listas.</small></div>${seg('densidad', [['comoda', 'Cómoda'], ['compacta', 'Compacta']], ui.densidad)}</div>
      <div class="cf-fila"><div><b>Tamaño del texto</b><small>Útil en pantallas de planta o tabletas.</small></div>${seg('texto', [['normal', 'Normal'], ['grande', 'Grande'], ['muygrande', 'Muy grande']], ui.texto)}</div>
      <div class="cf-fila"><div><b>Reducir animaciones</b><small>Desactiva transiciones y gráficas animadas.</small></div>${seg('sinMovimiento', [['0', 'No'], ['1', 'Sí']], ui.sinMovimiento ? '1' : '0')}</div>`, 'cfApariencia');
  }

  function bloqueAtajos() {
    const k = (x) => `<kbd>${x}</kbd>`;
    const filas = [[`${k('/')} o ${k('Ctrl')} ${k('K')}`, 'Buscar y ejecutar acciones'], [`${k('Ctrl')} ${k('J')}`, 'Abrir al asistente'], [`${k('?')}`, 'Ver todos los atajos'],
      [`${k('Tab')} · ${k('Enter')} · ${k('↑↓←→')}`, 'Moverse por la hoja de captura'], [`${k('Ctrl')} ${k('V')}`, 'Pegar un bloque desde Excel en la hoja'], [`${k('Ctrl')} ${k('D')}`, 'Rellenar hacia abajo'],
      [`${k('Ctrl')} ${k('S')}`, 'Guardar la hoja de captura'], [`${k('N')}`, 'Poner la hora actual en una celda de fecha'], [`${k('Esc')}`, 'Cerrar ventanas y cancelar edición']];
    return sec(IC.key, 'Atajos de teclado', 'Para registrar y consultar sin soltar el teclado.', `<div class="cf-atajos">${filas.map(([a, b]) => `<div><span>${a}</span><b>${esc(b)}</b></div>`).join('')}</div>`, 'cfAtajos');
  }

  function bloqueAcerca() {
    return sec(IC.info, 'Acerca de esta versión', `Plataforma de control de cavas ${VERSION}`, `
      <ul class="cf-lista"><li><b>Diseño neutro y minimalista</b> en claro y oscuro.</li><li><b>Cargar archivo</b> (Excel, CSV o documentos) en cada apartado, con vista previa y opción de deshacer.</li>
      <li><b>Capturar como Excel</b>: hojas con teclado, pegado, listas desplegables, cálculos y semáforos.</li><li><b>Análisis de datos</b> con estadística explicada en palabras claras, pronósticos, correlaciones y constructor de gráficas.</li>
      <li><b>${esc(nombreAsistente())}</b>, asistente local que consulta, compara, proyecta y grafica sobre todos tus datos.</li></ul>
      <div class="cf-row"><button class="btn" type="button" id="cfGuia">Ver la guía rápida</button></div>`, 'cfAcerca');
  }

  /* ---------- Respaldo ---------- */
  const ultimoRespaldo = () => { const t = +localStorage.getItem('cifra.ultimoRespaldo') || 0; if (!t) return 'Nunca'; const d = Math.floor((Date.now() - t) / 86400000); return d === 0 ? 'Hoy' : d === 1 ? 'Ayer' : `Hace ${d} días`; };
  async function leerFuentes() {
    const out = {};
    try { for (const type of Object.keys(A.OperationSources.defs)) { const v = A.OperationSources.getImport && A.OperationSources.getImport(type); if (v) out[type] = v; } } catch (e) { /* sin fuentes importadas */ }
    return out;
  }
  async function respaldar(silencioso) {
    const S = {};
    for (const c of ['tanques', 'colectores', 'bdlev', 'config', 'colhist', 'eventos']) S[c] = A.S[c] || {};
    const data = { app: 'cifra-control-cavas', version: VERSION, fecha: new Date().toISOString(), S, fuentes: await leerFuentes() };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `respaldo-cavas-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    try { localStorage.setItem('cifra.ultimoRespaldo', String(Date.now())); } catch (e) { /* sin almacenamiento */ }
    if (!silencioso) toast('Respaldo descargado.');
    const u = document.getElementById('cfUltimo'); if (u) u.textContent = 'Hoy';
  }
  async function restaurar(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { toast('El archivo no es un respaldo válido.'); return; }
    if (!data || data.app !== 'cifra-control-cavas' || !data.S) { toast('Este archivo no parece un respaldo de la plataforma.'); return; }
    const n = Object.values(data.S).reduce((s, o) => s + Object.keys(o || {}).length, 0);
    const ok = await A.UI.confirm
      ? await A.UI.confirm({ title: 'Restaurar respaldo', msg: `Se restaurarán ${n} registros del respaldo del ${String(data.fecha || '').slice(0, 10)}. Se descargará antes una copia del estado actual.`, ok: 'Restaurar' })
      : window.confirm(`Restaurar ${n} registros del respaldo? Se descargará una copia del estado actual.`);
    if (!ok) return;
    await respaldar(true);
    for (const [c, obj] of Object.entries(data.S)) if (obj && Object.keys(obj).length) await A.Store.setMany(c, obj);
    for (const [type, next] of Object.entries(data.fuentes || {})) { try { await A.OperationSources.setImport(type, next); } catch (e) { /* fuente no restaurable */ } }
    try { A.DL.invalidate(); } catch (e) { /* sin DL */ }
    toast('Respaldo restaurado.');
    A.render && A.render(true);
  }

  /* ---------- Guía rápida (se muestra una vez) ---------- */
  function guia() {
    const n = nombreAsistente();
    const html = `<div class="cf-guia">
      <div><b>1 · Carga lo que ya tienes</b><p>En cada apartado pulsa <em>Cargar archivo</em> y suelta tu Excel. Verás qué detectó, cuántos registros son nuevos y puedes deshacerlo.</p></div>
      <div><b>2 · Captura como en Excel</b><p>Pulsa <em>Capturar como Excel</em>: escribe con Tab y Enter, pega bloques desde Excel y mira los cálculos y semáforos al instante.</p></div>
      <div><b>3 · Analiza</b><p>La sección <em>Análisis</em> explica en palabras claras qué está pasando, qué cambió frente al periodo anterior y qué conviene revisar.</p></div>
      <div><b>4 · Pregúntale a ${esc(n)}</b><p>Escribe como hablas: «¿cuánto gastamos de agua este mes?», «compara la merma de Light y Estándar», «¿qué debería revisar hoy?».</p></div></div>`;
    A.UI.info ? A.UI.info('Guía rápida', html) : alert('Guía rápida: cargar archivo, capturar como Excel, analizar y preguntar.');
    try { localStorage.setItem('cifra.guia.' + VERSION, '1'); } catch (e) { /* sin almacenamiento */ }
  }

  /* ---------- Montaje en #/config ---------- */
  async function inyectar(vista) {
    if (vista.querySelector('[data-cifra-config]')) return;
    const page = vista.querySelector('.config-page');
    if (!page) return;
    const caja = document.createElement('div');
    caja.dataset.cifraConfig = '1';
    caja.className = 'cf-wrap';
    caja.innerHTML = bloqueAsistente() + bloqueMetas() + bloqueMarcas() + bloqueRespaldo() + bloqueApariencia() + bloqueAtajos() + bloqueAcerca();
    const hero = page.querySelector('.config-hero');
    if (hero && hero.nextElementSibling) hero.nextElementSibling.after(caja); else page.appendChild(caja);
    enlazar(caja);
    try { const e = await navigator.storage.estimate(); const el = caja.querySelector('#cfUso'); if (el && e && e.usage != null) el.textContent = `${(e.usage / 1048576).toFixed(1)} MB`; else if (el) el.textContent = 'n/d'; } catch (e) { const el = caja.querySelector('#cfUso'); if (el) el.textContent = 'n/d'; }
  }

  function enlazar(root) {
    const $ = (s) => root.querySelector(s);
    $('#cfNombreGuardar').onclick = async () => {
      const nombre = ($('#cfNombre').value || '').trim() || 'Cifra';
      await A.Metas.set({ asistente: { nombre } });
      if (A.Cifra && A.Cifra.aplicarNombre) A.Cifra.aplicarNombre();
      toast(`El asistente ahora se llama ${nombre}.`);
    };
    $('#cfBotAyuda').onclick = () => { if (A.Bot && A.Bot.abrir) A.Bot.abrir(); if (A.Cifra && A.Cifra.mostrarAyuda) setTimeout(() => A.Cifra.mostrarAyuda(), 200); };
    $('#cfBotBorrar').onclick = () => {
      for (const k of ['levabot.chat.v2', 'cifra.frecuentes', 'cifra.chat']) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
      toast('Historial y preguntas frecuentes borrados.');
    };
    root.querySelectorAll('[data-meta-guardar]').forEach((b) => { b.onclick = async () => {
      const g = b.dataset.metaGuardar, patch = {}, antes = A.Metas.all()[g];
      root.querySelectorAll(`[data-meta^="${g}."]`).forEach((i) => { const k = i.dataset.meta.split('.')[1]; patch[k] = i.value === '' ? null : Number(i.value); });
      await A.Metas.set({ [g]: patch });
      for (const [k, v] of Object.entries(patch)) if (antes[k] !== v && A.Sec && A.Sec.auditar) { try { await A.Sec.auditar(`Meta · ${g}.${k}`, antes[k], v); } catch (e) { /* auditoría opcional */ } }
      try { A.DL.invalidate(); } catch (e) { /* sin DL */ }
      toast('Metas guardadas.');
    }; });
    root.querySelectorAll('[data-meta-reset]').forEach((b) => { b.onclick = async () => {
      const g = b.dataset.metaReset; await A.Metas.reset(g);
      root.querySelectorAll(`[data-meta^="${g}."]`).forEach((i) => { const v = A.Metas.DEFAULTS[g][i.dataset.meta.split('.')[1]]; i.value = v == null ? '' : v; });
      toast('Valores iniciales restablecidos.');
    }; });
    const ag = $('#cfAliasGuardar');
    if (ag) ag.onclick = async () => {
      const cur = Object.assign({}, (A.S.config && A.S.config.brandAliases) || {});
      root.querySelectorAll('.cf-alias').forEach((i) => {
        const raw = i.dataset.raw, v = i.value.trim().toUpperCase();
        if (v && v !== raw) cur[raw] = v; else delete cur[raw];
      });
      await A.Store.set('config', 'brandAliases', cur);
      try { A.DL.invalidate(); } catch (e) { /* sin DL */ }
      toast('Equivalencias guardadas.');
      A.render && A.render(true);
    };
    $('#cfRespaldar').onclick = () => respaldar(false);
    $('#cfRestaurar').onchange = (e) => { const f = e.target.files[0]; if (f) restaurar(f); e.target.value = ''; };
    $('#cfRecordar').onchange = (e) => { try { localStorage.setItem('cifra.recordarRespaldo', e.target.checked ? '1' : '0'); } catch (x) { /* sin almacenamiento */ } };
    root.querySelectorAll('[data-seg]').forEach((g) => g.querySelectorAll('button').forEach((b) => { b.onclick = () => {
      const k = g.dataset.seg; ui[k] = k === 'sinMovimiento' ? b.dataset.v === '1' : b.dataset.v; guardarUI();
      g.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    }; }));
    $('#cfGuia').onclick = guia;
  }

  A.Seccion.registrar('config', inyectar);

  /* ---------- Atajos globales ---------- */
  document.addEventListener('keydown', (e) => {
    const t = e.target, editable = t && /INPUT|TEXTAREA|SELECT/.test(t.tagName) || (t && t.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); if (A.Bot && A.Bot.abrir) A.Bot.abrir(); return; }
    if (e.key === '?' && !editable) { e.preventDefault(); A.go && A.go('config'); setTimeout(() => { const s = document.getElementById('cfAtajos'); if (s) s.scrollIntoView({ behavior: 'smooth' }); }, 400); }
  });

  /* ---------- Recordatorio semanal de respaldo y guía de la primera vez ---------- */
  setTimeout(() => {
    try {
      if (!localStorage.getItem('cifra.guia.' + VERSION) && A.S && A.S.ready) { setTimeout(guia, 1500); return; }
      const ult = +localStorage.getItem('cifra.ultimoRespaldo') || 0;
      if (localStorage.getItem('cifra.recordarRespaldo') !== '0' && ult && Date.now() - ult > 7 * 86400000) toast('Hace más de 7 días que no haces un respaldo. Puedes hacerlo en Configuración.');
    } catch (e) { /* sin almacenamiento */ }
  }, 6000);

  A.Config42 = { respaldar, restaurar, guia, ui, aplicarUI };
})();
