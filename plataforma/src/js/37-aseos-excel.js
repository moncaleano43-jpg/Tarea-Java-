/* ============================================================
   Aseos · vista tipo Excel dentro de la pantalla.
   Reemplaza la tabla «Historial de cada aseo» por una hoja editable (App.Hoja) con TODOS los registros de la hoja activa:
   los que vienen del Excel y los capturados en la plataforma. Encabezados agrupados como en el libro, Equipo y # fijos,
   celdas fuera de rango en color, filtros (periodo, equipo, operario, solo con alertas, búsqueda) y exportar lo filtrado.
   Correcciones a filas del Excel → App.S.config.aseoCellEdits (lo mismo que usa el programa original);
   filas nuevas o capturas de plataforma → App.S.config.opCaptures_aseos.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.Hoja || !A.Captura || !A.Captura.resolverDef) return;
  const U = A.Hoja.util;
  const S = () => A.OperationSources;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const blank = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  const clone = (o) => JSON.parse(JSON.stringify(o == null ? null : o));
  const DAY = 86400000;
  const LS = 'cavas:aseos:vista';
  const leer = (k, fb) => { try { return localStorage.getItem(k) || fb; } catch (e) { return fb; } };
  const escribir = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };

  // Estado que sobrevive a los repintados de la pantalla
  const st = { hoja: null, h: null, el: null, def: null, cols: null, ctx: null, origen: new Map(), todas: [], f: { periodo: 'todo', equipo: '', operario: '', alertas: false, q: '' }, full: false };

  const toast = (t) => { try { A.U.toast(t); } catch (e) { /* sin avisos */ } };
  const hojaActiva = () => { const b = document.querySelector('[data-aseo-module][aria-pressed="true"]'); return b ? b.dataset.aseoModule : '1. Cada uso'; };

  /* ---------- Columnas: Equipo y # primero (quedan fijas), luego el cumplimiento y las fechas ---------- */
  function columnas(def) {
    const cols = def.columnas();
    const pesoDe = (c) => { const t = c.key + ' ' + c.titulo; return /^equipo\b/i.test(c.key) || (def.generica && /equipo|tanque|tinas/i.test(c.titulo)) ? 0 : c.key === 'num' ? 1 : c.key === 'cumple' ? 2 : /fecha|inicio|^fin$/i.test(t) ? 3 : 9; };
    const primera = cols.findIndex((c) => pesoDe(c) === 0);
    if (primera < 0) return { cols, fijas: 1 };
    const orden = cols.map((c, i) => ({ c, i, p: Math.min(pesoDe(c), 9) })).sort((a, b) => (a.p < 9 || b.p < 9 ? a.p - b.p || a.i - b.i : a.i - b.i)).map((x) => x.c);
    const eq = orden[0]; eq.ancho = Math.min(eq.ancho || 150, 160);
    const fijas = orden[1] && orden[1].key === 'num' ? 2 : 1;
    // las columnas reordenadas conservan su grupo; si el grupo de la primera queda partido se nombra igual
    return { cols: orden, fijas };
  }
  const colPor = (re) => (st.cols || []).find((c) => re.test(c.key) || re.test(c.titulo));

  /* ---------- Filas: todas las de la hoja (Excel + plataforma), sin las plantillas vacías ---------- */
  function cargarTodas(hoja, def) {
    let recs = [];
    try { recs = S().records('aseos', hoja) || []; } catch (e) { recs = []; }
    const idx = new Set(def.indices.map(String));
    st.origen = new Map();
    const out = [];
    for (const r of recs) {
      if (!r || !r.cells) continue;
      if (!Object.entries(r.cells).some(([k, v]) => idx.has(String(k)) && !blank(v) && !(typeof v === 'string' && !v.trim()))) continue;
      let f; try { f = def.deRecord(r); } catch (e) { continue; }
      if (!f) continue;
      const llenos = Object.entries(f).filter(([k, v]) => k !== 'id' && !blank(v)).length;
      if (llenos < 2) continue;   // filas de plantilla con un solo valor suelto
      st.origen.set(r.id, r.origin === 'Plataforma' ? 'Plataforma' : 'Excel');
      out.push(f);
    }
    out.sort((a, b) => String(def.orden(a) || '').localeCompare(String(def.orden(b) || '')));
    return out;
  }

  /* valores con fórmulas y semáforos (para filtros, resumen y exportar) */
  function evaluar(f) {
    const v = Object.assign({}, f), ctx = st.ctx || {};
    for (const c of st.cols) if (c.tipo === 'calc' && typeof c.calc === 'function') { try { const x = c.calc(v, ctx, { i: 0, prev: null, filas: () => [] }); v[c.key] = typeof x === 'number' && !Number.isFinite(x) ? null : x; } catch (e) { v[c.key] = null; } }
    let alerta = false, motivos = [];
    for (const c of st.cols) {
      if (typeof c.semaforo !== 'function' || blank(v[c.key])) continue;
      let s = null; try { s = c.semaforo(v[c.key], v, ctx); } catch (e) { s = null; }
      const n = Array.isArray(s) ? s[0] : s && s.n;
      if (n === 'bad' || n === 'warn') { alerta = true; motivos.push(c.titulo); }
    }
    return { v, alerta, motivos };
  }
  const msFila = (f) => { const o = st.def ? st.def.orden(f) : null; return o ? U.msDe(String(o).length === 10 ? o + 'T00:00' : o) : null; };

  function filtrar() {
    const F = st.f, eqC = colPor(/^equipo$|equipo|tanque|tinas/i), opC = colPor(/operario|responsable/i);
    const fin = Math.max(0, ...st.todas.map(msFila).filter((x) => x != null));
    const dias = { sem: 7, mes: 30, tri: 90, anio: 365 }[F.periodo];
    const q = U.norm(F.q);
    return st.todas.filter((f) => {
      if (dias) { const t = msFila(f); if (t == null || t <= fin - dias * DAY) return false; }
      if (F.equipo && eqC && U.norm(f[eqC.key]) !== U.norm(F.equipo)) return false;
      if (F.operario && opC && U.norm(f[opC.key]) !== U.norm(F.operario)) return false;
      if (q && !U.norm(Object.values(f).filter((x) => !blank(x)).join(' ')).includes(q)) return false;
      if (F.alertas && !evaluar(f).alerta) return false;
      return true;
    });
  }

  /* ---------- Guardar ---------- */
  async function guardar(lista) {
    if (!A.Store.canWrite) return false;
    const hoja = st.hoja, def = st.def;
    const antes = { aseoCellEdits: clone(A.S.config.aseoCellEdits || {}), opCaptures_aseos: clone(A.S.config.opCaptures_aseos || { records: [] }) };
    const deExcel = lista.filter((f) => f.id && st.origen.get(f.id) === 'Excel');
    const resto = lista.filter((f) => !deExcel.includes(f));
    const ids = new Map();
    if (deExcel.length) {
      const changes = clone(antes.aseoCellEdits), at = new Date().toISOString();
      const recs = new Map((S().records('aseos', hoja) || []).map((r) => [r.id, r]));
      for (const f of deExcel) {
        const r = recs.get(f.id); if (!r) continue;
        const f0 = def.deRecord(r);
        const nuevo = def.aCelulas(f, st.ctx, r.cells), viejo = def.aCelulas(Object.assign({}, f0, evaluar(f0).v), st.ctx, r.cells);
        const patch = {};
        for (const ix of def.indices) { const a = nuevo[ix] == null ? null : nuevo[ix], b = viejo[ix] == null ? null : viejo[ix]; if (JSON.stringify(a) !== JSON.stringify(b)) patch[ix] = a; }
        ids.set(f, f.id);
        if (!Object.keys(patch).length) continue;
        const prev = changes[f.id] || {};
        const despues = Object.assign({}, r.cells, patch);
        changes[f.id] = { cells: Object.assign({}, prev.cells || {}, patch), at, sheet: hoja, revisions: [...(prev.revisions || []), { at, sheet: hoja, before: clone(r.cells), after: clone(despues) }] };
      }
      if (await A.Store.set('config', 'aseoCellEdits', changes) === false) return false;
    }
    if (resto.length) {
      const r = await A.Captura.guardarFilas('aseos', hoja, def, resto, st.ctx);
      if (!r) return false;
      resto.forEach((f, i) => { ids.set(f, r.ids[i]); st.origen.set(r.ids[i], 'Plataforma'); });
    }
    try { A.DL.invalidate(); } catch (e) { /* sin capa de datos */ }
    st.todas = cargarTodas(hoja, def);
    resumen();
    avisoDeshacer(lista.length, antes);
    return lista.map((f) => ids.get(f));
  }
  function avisoDeshacer(n, antes) {
    document.querySelectorAll('.cap-toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'cap-toast'; t.setAttribute('role', 'status');
    t.innerHTML = `<span>${n === 1 ? 'Fila guardada' : n + ' filas guardadas'} en ${esc(st.hoja.trim())}</span><button type="button">Deshacer</button>`;
    document.body.appendChild(t);
    const timer = setTimeout(() => t.remove(), 12000);
    t.querySelector('button').addEventListener('click', async () => {
      clearTimeout(timer); t.remove();
      if (await A.Store.setMany('config', antes) === false) return;
      try { A.DL.invalidate(); } catch (e) { /* nada */ }
      recargar(false);
      toast('Cambios deshechos');
    });
  }
  async function eliminar(sel) {
    if (sel.some((f) => st.origen.get(f.id) === 'Excel')) { toast('Las filas que vienen del Excel no se eliminan desde aquí: corrige sus valores o actualiza el Excel.'); return false; }
    let ok = false;
    try { ok = await A.UI.confirm('Eliminar ' + sel.length + (sel.length === 1 ? ' captura' : ' capturas'), 'Se quita de la plataforma el registro guardado.', 'Eliminar'); } catch (e) { ok = window.confirm('¿Eliminar ' + sel.length + ' captura(s)?'); }
    if (!ok) return false;
    const estado = clone(A.S.config.opCaptures_aseos || { records: [] }), quitar = new Set(sel.map((x) => x.id));
    estado.records = (estado.records || []).filter((r) => !quitar.has(r.id));
    if (await A.Store.set('config', 'opCaptures_aseos', estado) === false) return false;
    try { A.DL.invalidate(); } catch (e) { /* nada */ }
    st.todas = st.todas.filter((f) => !quitar.has(f.id));
    resumen();
    return true;
  }

  /* ---------- Exportar lo filtrado ---------- */
  function exportar() {
    const filas = filtrar().map((f) => evaluar(f).v);
    const fmt = (c, v) => {
      if (blank(v)) return null;
      if (/fecha/.test(c.tipo) && typeof v === 'string') return U.fmtFecha(v, c.tipo);
      if (c.porcentaje && typeof v === 'number') return Math.round(v * 1000) / 10 + ' %';
      return v;
    };
    const hojaX = { nombre: st.hoja.trim().slice(0, 31), titulo: 'Aseos · ' + st.hoja.trim(), sub: filas.length + ' registros · filtros: ' + descFiltros(), cols: st.cols.map((c) => ({ h: c.titulo + (c.unidad ? ' (' + c.unidad + ')' : ''), t: 's' })), rows: filas.map((v) => st.cols.map((c) => fmt(c, v[c.key]))) };
    try { A.V35.excel('Aseos ' + st.hoja.trim() + '.xlsx', [hojaX]); } catch (e) { toast('No se pudo generar el Excel'); }
  }
  const descFiltros = () => { const F = st.f, L = []; if (F.periodo !== 'todo') L.push({ sem: 'últimos 7 días', mes: 'últimos 30 días', tri: 'últimos 90 días', anio: 'último año' }[F.periodo]); if (F.equipo) L.push(F.equipo); if (F.operario) L.push(F.operario); if (F.alertas) L.push('solo con alertas'); if (F.q) L.push('«' + F.q + '»'); return L.join(', ') || 'ninguno'; };

  /* ---------- Interfaz ---------- */
  function opciones(col) {
    if (!col) return [];
    const m = new Map();
    for (const f of st.todas) { const v = f[col.key]; if (blank(v)) continue; const k = U.norm(v); m.set(k, { t: String(v).trim(), n: (m.get(k) || { n: 0 }).n + 1 }); }
    return [...m.values()].sort((a, b) => a.t.localeCompare(b.t, 'es'));
  }
  function barraHTML() {
    const F = st.f, eqC = colPor(/^equipo$|equipo|tanque|tinas/i), opC = colPor(/operario|responsable/i);
    const sel = (id, lbl, items, val) => `<label class="ax-f"><span>${lbl}</span><select data-ax="${id}"><option value="">Todos</option>${items.map((o) => `<option value="${esc(o.t)}"${U.norm(o.t) === U.norm(val) ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>`;
    return `<div class="ax-barra">
      <label class="ax-f"><span>Periodo</span><select data-ax="periodo">${[['todo', 'Todo'], ['sem', 'Última semana'], ['mes', 'Último mes'], ['tri', 'Últimos 3 meses'], ['anio', 'Último año']].map(([v, t]) => `<option value="${v}"${F.periodo === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      ${eqC ? sel('equipo', 'Equipo', opciones(eqC), F.equipo) : ''}
      ${opC ? sel('operario', 'Operario', opciones(opC), F.operario) : ''}
      <label class="ax-f ax-q"><span>Buscar</span><input type="search" data-ax="q" value="${esc(F.q)}" placeholder="Cualquier dato…" autocomplete="off"></label>
      <label class="ax-chk"><input type="checkbox" data-ax="alertas"${F.alertas ? ' checked' : ''}> Solo con alertas</label>
      <span class="ax-fill"></span>
      <button type="button" class="btn" data-ax="exportar">Exportar a Excel</button>
      <button type="button" class="btn" data-ax="full" aria-pressed="${st.full}">${st.full ? 'Salir de pantalla completa' : 'Pantalla completa'}</button>
    </div>
    <div class="ax-resumen" role="status" aria-live="polite"></div>`;
  }
  function resumen() {
    if (!st.el) return;
    const caja = st.el.querySelector('.ax-resumen'); if (!caja) return;
    const vis = filtrar(), ev = vis.map(evaluar), n = vis.length;
    const conAlerta = ev.filter((x) => x.alerta).length;
    const cumpleC = st.cols.find((c) => c.key === 'cumple');
    const conCumple = cumpleC ? ev.filter((x) => typeof x.v.cumple === 'number') : [];
    const ok = conCumple.filter((x) => x.v.cumple >= 0.9).length;
    const pend = st.h ? st.h.validar().sinGuardar : 0;
    caja.innerHTML = `<span><b>${n.toLocaleString('es-CO')}</b> ${n === 1 ? 'aseo' : 'aseos'}${n !== st.todas.length ? ` de ${st.todas.length.toLocaleString('es-CO')}` : ''}</span>`
      + (conCumple.length ? `<span><b>${Math.round((ok / conCumple.length) * 100)} %</b> cumplen parámetros</span>` : '')
      + `<span class="${conAlerta ? 'ax-mal' : 'ax-bien'}"><i></i><b>${conAlerta}</b> con valores fuera de rango</span>`
      + (pend ? `<span class="ax-pend"><b>${pend}</b> sin guardar · Ctrl+S</span>` : '')
      + `<span class="ax-ley"><i class="ax-sw s-ok"></i>en rango <i class="ax-sw s-warn"></i>revisar <i class="ax-sw s-bad"></i>fuera de rango <i class="ax-sw s-calc">ƒ</i>calculado</span>`;
  }
  function recargar(conservar) {
    if (!st.h) return;
    st.todas = cargarTodas(st.hoja, st.def);
    st.h.recargar(filtrar(), conservar !== false);
    alFinal();
    resumen();
  }
  const alFinal = () => { const vp = st.el && st.el.querySelector('.hoja-vp'); if (vp) requestAnimationFrame(() => { vp.scrollTop = vp.scrollHeight; }); };

  function pantallaCompleta(on) {
    st.full = on;
    st.el.classList.toggle('ax-full', on);
    document.documentElement.style.overflow = on ? 'hidden' : '';
    const b = st.el.querySelector('[data-ax="full"]'); if (b) { b.textContent = on ? 'Salir de pantalla completa' : 'Pantalla completa'; b.setAttribute('aria-pressed', on); }
    if (st.h) st.h.recalcular();
  }

  function montar(seccion, hoja) {
    if (st.h) { try { st.h.destruir(); } catch (e) { /* ya no existe */ } st.h = null; }
    if (st.hoja !== hoja) st.f = { periodo: 'todo', equipo: '', operario: '', alertas: false, q: '' };
    st.hoja = hoja;
    st.def = A.Captura.resolverDef('aseos', hoja);
    if (!st.def) return;
    const { cols, fijas } = columnas(st.def);
    st.cols = cols;
    st.ctx = st.def.contexto(hoja, new Set());
    st.todas = cargarTodas(hoja, st.def);
    const el = document.createElement('div');
    el.className = 'ax';
    el.innerHTML = barraHTML() + '<div class="ax-hoja"></div><p class="ax-nota">Escribe directo en las celdas como en Excel: Tab y Enter para moverte, Ctrl+V para pegar filas desde Excel, Ctrl+S para guardar. Las correcciones a filas del Excel quedan con historial; la última fila vacía sirve para un aseo nuevo.</p>';
    seccion.appendChild(el);
    st.el = el;
    const puede = !!A.Store.canWrite;
    st.h = A.Hoja.crear(el.querySelector('.ax-hoja'), {
      columnas: cols, filas: filtrar(), fijas, contexto: () => st.ctx, cadena: false, nuevaFila: st.def.nuevaFila, soloLectura: !puede,
      clave: 'aseos-vista:' + hoja, titulo: 'Aseos · ' + hoja.trim(), alto: st.full ? 'calc(100vh - 210px)' : 'min(68vh, 640px)',
      onGuardar: guardar, onEliminar: eliminar,
      onCambio: () => resumen(),
    });
    alFinal();
    resumen();
    // filtros
    let tq = null;
    el.querySelector('.ax-barra').addEventListener('change', (e) => {
      const k = e.target.dataset.ax; if (!k || k === 'q') return;
      st.f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      st.h.recargar(filtrar(), true); alFinal(); resumen();
    });
    el.querySelector('[data-ax="q"]').addEventListener('input', (e) => { clearTimeout(tq); tq = setTimeout(() => { st.f.q = e.target.value; st.h.recargar(filtrar(), true); alFinal(); resumen(); }, 250); });
    el.querySelector('[data-ax="exportar"]').addEventListener('click', exportar);
    el.querySelector('[data-ax="full"]').addEventListener('click', () => pantallaCompleta(!st.full));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.full && !e.defaultPrevented && !e.target.closest('input, select, textarea')) pantallaCompleta(false); });
    if (st.full) pantallaCompleta(true);
  }

  /* ---------- Conexión con la pantalla de Aseos ---------- */
  function inyectar(vista) {
    const ws = vista.querySelector('.aseo-workspace');
    const sec = ws && ws.querySelector('.studio-section');
    if (!sec || !S()) return;
    const modo = leer(LS, 'excel');
    const hoja = hojaActiva();
    // interruptor de vista (una vez por pintado)
    const cab = sec.querySelector('.sec-h');
    if (cab && !cab.querySelector('.ax-modo')) {
      const sw = document.createElement('div');
      sw.className = 'ax-modo'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Vista');
      sw.innerHTML = '<button type="button" data-v="excel">Tabla Excel</button><button type="button" data-v="clasica">Vista anterior</button>';
      sw.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; escribir(LS, b.dataset.v); if (b.dataset.v !== 'excel' && st.full) pantallaCompleta(false); A.render(true); });
      cab.appendChild(sw);
    }
    sec.querySelectorAll('.ax-modo [data-v]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === modo));
    const on = modo === 'excel';
    sec.classList.toggle('ax-on', on);
    ws.classList.toggle('ax-ws', on);
    if (!on) { if (st.h && !document.body.contains(st.h.el)) { try { st.h.destruir(); } catch (e) { /* */ } st.h = null; } return; }
    if (sec.querySelector('.ax') && st.h && document.body.contains(st.h.el) && st.hoja === hoja) return;
    montar(sec, hoja);
  }
  A.Seccion.registrar('aseos', inyectar);
  window.addEventListener('hashchange', () => { if (st.full) pantallaCompleta(false); });
  A.AseosExcel = { recargar, estado: () => st };
})();
