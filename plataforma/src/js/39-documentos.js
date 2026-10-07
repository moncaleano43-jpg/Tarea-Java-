/* ============================================================
   App.Documentos · adjuntar PDF, imágenes, Word, Excel u otros archivos a cada sección
   Se guardan en IndexedDB «cifra-documentos» (solo en este navegador; nada se sube a ningún servidor).
   API: listar(seccion?) · buscar(texto) · abrir(id) · contar(seccion) · subir(seccion, files) · quitar(id)
        · editarNota(id) · descargar(id) · uso() · limiteMB() · fijarLimite(mb)
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.U || typeof document === 'undefined') return;
  const { esc } = A.U;

  const SECCIONES = { tanques: 'Tanques', levaduras: 'Levaduras', bd: 'Base de datos', aseos: 'Aseos', recuperacion: 'Recuperación', programa: 'Programa de trasiego', merma: 'Merma', agua: 'Consumo de agua', analisis: 'Análisis', general: 'General' };
  const RUTAS = ['tanques', 'levaduras', 'bd', 'aseos', 'recuperacion', 'programa', 'merma', 'agua', 'analisis'];
  const LIMITE_DEF = 25;
  const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  const ext = (n) => (/\.([a-z0-9]+)$/i.exec(n || '') || [, ''])[1].toLowerCase();
  const mimeDe = (f) => f.type || MIME[ext(f.name)] || 'application/octet-stream';
  const clase = (d) => {
    const t = (d.tipo || '').toLowerCase(), e = ext(d.nombre);
    if (t.startsWith('image/')) return 'img';
    if (t === 'application/pdf' || e === 'pdf') return 'pdf';
    if (/word|msword/.test(t) || ['doc', 'docx', 'odt', 'rtf'].includes(e)) return 'doc';
    if (/sheet|excel|csv/.test(t) || ['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(e)) return 'xls';
    if (t.startsWith('text/') || ['txt', 'md', 'json'].includes(e)) return 'txt';
    return 'otro';
  };
  const ICONOS = {
    pdf: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5h1.2a1.2 1.2 0 000-2.4H8.5v3.4m4-3.4v3.4h.8a1.7 1.7 0 000-3.4z"/>',
    img: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
    doc: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7m-7 3h7"/>',
    xls: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M8 12.5h8m-8 3h8M11 11v6"/>',
    txt: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7"/>',
    otro: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
  };
  const icono = (k, tam = 20) => `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[k] || ICONOS.otro}</svg>`;
  const fmtMB = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 10485760 ? 0 : 1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const fmtF = (t) => new Date(t).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('Este navegador no permite guardar documentos.'));
      const r = indexedDB.open('cifra-documentos', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('docs', { keyPath: 'id' }); s.createIndex('seccion', 'seccion'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error || new Error('No se pudo abrir el almacenamiento de documentos.')); };
    });
    return dbp;
  }
  async function tx(modo, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('docs', modo); let out;
      const rq = fn(t.objectStore('docs')); if (rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Almacenamiento lleno o bloqueado'));
    });
  }
  const sinBlob = (d) => { const { blob, ...m } = d; return m; };

  const conteos = {};
  /* ---------- API ---------- */
  async function listar(seccion) {
    const todos = await tx('readonly', (s) => (seccion ? s.index('seccion').getAll(seccion) : s.getAll()));
    return (todos || []).map(sinBlob).sort((a, b) => b.fecha - a.fecha);
  }
  async function buscar(texto) {
    const q = String(texto || '').toLowerCase().trim();
    const todos = await listar();
    if (!q) return todos;
    return todos.filter((d) => [d.nombre, d.nota, SECCIONES[d.seccion] || d.seccion, d.tipo].join(' ').toLowerCase().includes(q));
  }
  async function contar(seccion) {
    const n = await tx('readonly', (s) => s.index('seccion').count(seccion));
    conteos[seccion] = n || 0;
    return conteos[seccion];
  }
  const obtener = (id) => tx('readonly', (s) => s.get(id));
  const limiteMB = () => { const v = A.S && A.S.config && A.S.config.cifraDocumentos && +A.S.config.cifraDocumentos.limiteMB; return v > 0 ? v : LIMITE_DEF; };
  async function fijarLimite(mb) {
    mb = Math.max(1, Math.min(500, +mb || LIMITE_DEF));
    if (A.Store && A.Store.set) await A.Store.set('config', 'cifraDocumentos', Object.assign({}, (A.S.config || {}).cifraDocumentos, { limiteMB: mb }));
    return mb;
  }
  async function uso() {
    const todos = await tx('readonly', (s) => s.getAll());
    const bytes = (todos || []).reduce((a, d) => a + (d.tamano || 0), 0);
    let cuota = null, usado = null;
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); cuota = e.quota; usado = e.usage; } } catch (e) { /* sin estimación */ }
    return { archivos: (todos || []).length, bytes, cuota, usado };
  }

  async function subir(seccion, files, nota) {
    seccion = SECCIONES[seccion] ? seccion : 'general';
    const arr = [...files].filter(Boolean);
    if (!arr.length) return [];
    if (A.Store && A.Store.canWrite === false) { A.U.toast('Estás en modo de solo lectura: no se pueden adjuntar documentos.'); return []; }
    const lim = limiteMB() * 1048576, ok = [], rech = [];
    for (const f of arr) { (f.size > lim ? rech : ok).push(f); }
    if (rech.length) A.U.toast(rech.length === 1 ? `«${rech[0].name}» pesa ${fmtMB(rech[0].size)} y supera el límite de ${limiteMB()} MB. Puedes subirlo en Documentos > Cambiar límite.` : `${rech.length} archivos superan el límite de ${limiteMB()} MB y no se adjuntaron.`);
    const guardados = [];
    try {
      const u = await uso();
      const nuevo = ok.reduce((a, f) => a + f.size, 0);
      if (u.cuota && u.usado != null && u.usado + nuevo > u.cuota * 0.9) A.U.toast('Queda poco espacio en el navegador. Elimina documentos que ya no necesites.');
    } catch (e) { /* sin aviso */ }
    for (const f of ok) {
      const rec = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), seccion, nombre: f.name, tipo: mimeDe(f), tamano: f.size, fecha: Date.now(), nota: nota || '', blob: new Blob([f], { type: mimeDe(f) }) };
      try { await tx('readwrite', (s) => s.put(rec)); guardados.push(sinBlob(rec)); } catch (e) { A.U.toast('No se pudo guardar «' + f.name + '»: ' + (e && e.message || 'almacenamiento lleno') + '.'); }
    }
    if (guardados.length) { A.U.toast(guardados.length === 1 ? 'Documento adjuntado a ' + SECCIONES[seccion] + '.' : guardados.length + ' documentos adjuntados a ' + SECCIONES[seccion] + '.'); await contar(seccion).catch(() => 0); refrescar(); }
    return guardados;
  }
  async function quitar(id, sinPreguntar) {
    const d = await obtener(id); if (!d) return false;
    if (!sinPreguntar) { const ok = await A.UI.confirm('Eliminar documento', '«' + d.nombre + '» se quitará de ' + (SECCIONES[d.seccion] || d.seccion) + '. No se puede deshacer.', 'Eliminar'); if (!ok) return false; }
    await tx('readwrite', (s) => s.delete(id));
    await contar(d.seccion).catch(() => 0); refrescar(); A.U.toast('Documento eliminado.');
    return true;
  }
  async function editarNota(id) {
    const d = await obtener(id); if (!d) return false;
    const r = await A.UI.form({ title: 'Nota del documento', intro: d.nombre, fields: [{ k: 'nota', l: 'Nota', t: 'ta' }], values: { nota: d.nota || '' }, ok: 'Guardar nota' });
    if (!r) return false;
    d.nota = String(r.nota || '').trim();
    await tx('readwrite', (s) => s.put(d)); refrescar();
    return true;
  }
  async function descargar(id) {
    const d = await obtener(id); if (!d) return;
    try { if (A.downloads) { await A.downloads.save({ filename: d.nombre, data: d.blob }); return; } } catch (e) { if (e && e.code === 'declined') return; }
    const u = URL.createObjectURL(d.blob), a = document.createElement('a');
    a.href = u; a.download = d.nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  async function abrir(id) {
    const d = await obtener(id);
    if (!d) { A.U.toast('No encontré ese documento.'); return null; }
    const k = clase(d), url = URL.createObjectURL(d.blob);
    let cuerpo;
    if (k === 'img') cuerpo = `<div class="doc-prev"><img src="${url}" alt="${esc(d.nombre)}"></div>`;
    else if (k === 'pdf') cuerpo = `<iframe class="doc-frame" src="${url}" title="${esc(d.nombre)}"></iframe>`;
    else if (k === 'txt' && d.tamano < 400000) { let t = ''; try { t = await d.blob.text(); } catch (e) { /* binario */ } cuerpo = `<pre class="doc-text">${esc(t.slice(0, 60000))}</pre>`; }
    else cuerpo = `<div class="doc-nopreview">${icono(k, 40)}<p>No hay vista previa para este tipo de archivo.</p><button type="button" class="btn pri" data-dl>Descargar</button></div>`;
    const dlg = document.createElement('dialog');
    dlg.className = 'wide doc-dlg';
    dlg.innerHTML = `<div class="dlg"><header><h3>${esc(d.nombre)}</h3><span class="doc-hdr"><button class="btn sm" type="button" data-dl>Descargar</button><button class="btn sm" type="button" data-x>Cerrar</button></span></header><div class="bd doc-bd">${cuerpo}${d.nota ? `<p class="doc-nota">${esc(d.nota)}</p>` : ''}</div></div>`;
    document.body.appendChild(dlg);
    const cerrar = () => { try { dlg.close(); } catch (e) { /* */ } dlg.remove(); URL.revokeObjectURL(url); };
    dlg.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) cerrar(); else if (e.target.closest('[data-dl]')) descargar(id); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
    dlg.showModal();
    return dlg;
  }

  /* ---------- Panel en cada sección ---------- */
  const abierto = (r) => { try { return localStorage.getItem('cifra:doc-abierto:' + r) === '1'; } catch (e) { return false; } };
  const recordar = (r, v) => { try { localStorage.setItem('cifra:doc-abierto:' + r, v ? '1' : '0'); } catch (e) { /* sin almacenamiento */ } };
  const busqueda = {};

  async function pintarLista(panel) {
    const r = panel.dataset.docPanel, caja = panel.querySelector('[data-doc-list]'), info = panel.querySelector('[data-doc-uso]');
    if (!caja) return;
    let lista = await listar(r);
    const q = (busqueda[r] || '').toLowerCase().trim();
    const total = lista.length;
    if (q) lista = lista.filter((d) => [d.nombre, d.nota, d.tipo].join(' ').toLowerCase().includes(q));
    caja.innerHTML = lista.length ? lista.map((d) => {
      const k = clase(d);
      return `<li class="doc-item" data-id="${esc(d.id)}">
        <span class="doc-ic doc-${k}">${icono(k)}</span>
        <span class="doc-main"><button type="button" class="doc-name" data-act="ver" title="Ver ${esc(d.nombre)}">${esc(d.nombre)}</button><small>${fmtMB(d.tamano)} · ${fmtF(d.fecha)}</small>${d.nota ? `<em class="doc-note">${esc(d.nota)}</em>` : ''}</span>
        <span class="doc-acts"><button type="button" class="btn sm" data-act="ver">Ver</button><button type="button" class="btn sm" data-act="dl">Descargar</button><button type="button" class="btn sm" data-act="nota">${d.nota ? 'Editar nota' : 'Nota'}</button><button type="button" class="btn sm doc-del" data-act="del">Eliminar</button></span></li>`;
    }).join('') : `<li class="doc-empty">${total ? 'Ningún documento coincide con la búsqueda.' : 'Aún no hay documentos en esta sección. Adjunta procedimientos, fotos, actas o certificados.'}</li>`;
    const u = await uso().catch(() => null);
    if (u && info) info.textContent = `${u.archivos} en total · ${fmtMB(u.bytes)} guardados${u.cuota ? ' · ' + Math.round((u.usado || 0) / u.cuota * 100) + ' % del espacio del navegador' : ''} · límite por archivo ${limiteMB()} MB`;
    const n = panel.querySelector('[data-doc-n]'); if (n) n.textContent = '(' + total + ')';
    conteos[r] = total;
  }

  function construir(ruta) {
    const p = document.createElement('details');
    p.className = 'doc-panel'; p.dataset.docPanel = ruta; p.dataset.docDrop = '1';
    if (abierto(ruta)) p.open = true;
    const n = conteos[ruta];
    p.innerHTML = `<summary><span class="doc-sum-ic">${icono('otro', 18)}</span><span>Documentos <span data-doc-n>${n == null ? '' : '(' + n + ')'}</span></span><small>${esc(SECCIONES[ruta] || '')} · procedimientos, fotos, actas, certificados</small></summary>
      <div class="doc-body">
        <div class="doc-bar">
          <input type="search" class="doc-search" data-doc-q placeholder="Buscar documentos…" aria-label="Buscar documentos" value="${esc(busqueda[ruta] || '')}">
          <button type="button" class="btn pri" data-doc-up>Subir documentos</button>
          <input type="file" multiple hidden data-doc-file>
        </div>
        <ul class="doc-list" data-doc-list></ul>
        <div class="doc-foot"><span data-doc-uso></span><button type="button" class="btn sm" data-doc-lim>Cambiar límite</button></div>
      </div>`;
    p.addEventListener('toggle', () => { recordar(ruta, p.open); if (p.open) pintarLista(p); });
    p.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-doc-up]')) { p.querySelector('[data-doc-file]').click(); return; }
      if (t.closest('[data-doc-lim]')) {
        const r = await A.UI.form({ title: 'Límite por archivo', intro: 'Los documentos se guardan en este navegador. Un límite evita llenar el espacio por accidente.', fields: [{ k: 'mb', l: 'Tamaño máximo por archivo (MB)', t: 'n' }], values: { mb: limiteMB() }, ok: 'Guardar' });
        if (r && r.mb) { await fijarLimite(r.mb); pintarLista(p); }
        return;
      }
      const it = t.closest('.doc-item'), b = t.closest('[data-act]');
      if (it && b) {
        const id = it.dataset.id, a = b.dataset.act;
        if (a === 'ver') abrir(id); else if (a === 'dl') descargar(id); else if (a === 'nota') editarNota(id); else if (a === 'del') quitar(id);
      }
    });
    p.addEventListener('change', async (e) => { if (e.target.matches('[data-doc-file]')) { const fs = [...e.target.files]; e.target.value = ''; await subir(ruta, fs); } });
    p.addEventListener('input', (e) => { if (e.target.matches('[data-doc-q]')) { busqueda[ruta] = e.target.value; clearTimeout(p._t); p._t = setTimeout(() => pintarLista(p), 150); } });
    p.addEventListener('dragover', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); p.classList.add('over'); } });
    p.addEventListener('dragleave', (e) => { if (!p.contains(e.relatedTarget)) p.classList.remove('over'); });
    p.addEventListener('drop', (e) => { e.preventDefault(); p.classList.remove('over'); subir(ruta, e.dataTransfer.files); });
    return p;
  }

  function inyectar(vista, ruta) {
    if (!RUTAS.includes(ruta)) return;
    if (vista.querySelector('[data-doc-panel]')) return;
    const host = vista.querySelector('.studio-page') || vista;
    const p = construir(ruta);
    host.appendChild(p);
    if (A.Seccion && A.Seccion.boton) {
      const b = A.Seccion.boton(vista, 'doc-abrir', 'Documentos', () => {
        const q = document.querySelector('[data-doc-panel]'); if (!q) return;
        q.open = true; q.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      if (b) b.classList.add('imp-btn');
    }
    // el contador y la lista se completan en segundo plano
    contar(ruta).then((n) => { const e = p.querySelector('[data-doc-n]'); if (e) e.textContent = '(' + n + ')'; const bt = vista.querySelector('[data-cifra-btn=doc-abrir]'); if (bt) bt.textContent = 'Documentos' + (n ? ' (' + n + ')' : ''); if (p.open) pintarLista(p); }).catch(() => {});
  }
  function refrescar() {
    document.querySelectorAll('[data-doc-panel]').forEach((p) => pintarLista(p).catch(() => {}));
  }

  if (A.Seccion) A.Seccion.registrar(RUTAS, inyectar);
  A.Documentos = { listar, buscar, abrir, contar, subir, quitar, editarNota, descargar, uso, limiteMB, fijarLimite, obtener, SECCIONES };
})();
