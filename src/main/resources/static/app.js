'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (v, d = 1) => v == null ? '–' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });
const fdate = v => v ? v.replace('T', ' ').slice(0, 16) : '–';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3500);
}

async function api(path, opts) {
  const r = await fetch('/api' + path, opts && opts.body !== undefined
    ? { method: opts.method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) } : opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || 'Error ' + r.status);
  return body;
}

function table(el, cols, rows, onClick) {
  el.innerHTML = '<thead><tr>' + cols.map(c => `<th>${esc(c.t)}</th>`).join('') + '</tr></thead><tbody>' +
    (rows.length ? rows.map((r, i) => `<tr class="${onClick ? 'click' : ''}" data-i="${i}">` +
      cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.h ? c.h(r) : esc(c.f(r))}</td>`).join('') + '</tr>').join('')
      : `<tr><td colspan="${cols.length}" class="muted">Sin registros</td></tr>`) + '</tbody>';
  if (onClick) $$('tbody tr', el).forEach(tr => tr.onclick = () => onClick(rows[tr.dataset.i]));
}

const alertas = a => (a || []).map(x => `<span class="badge alerta ${x.nivel}">${esc(x.mensaje)}</span>`).join('');

// ---------- Tabs ----------
$('#tabs').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(x => x.classList.toggle('active', x.id === b.dataset.tab));
  load[b.dataset.tab]?.();
};

// ---------- Dashboard ----------
async function dashboard() {
  const a = $('#ahora').value;
  const r = await api('/resumen' + (a ? '?ahora=' + encodeURIComponent(a + ':00') : ''));
  $('#kpis').innerHTML = `<span class="badge">${r.fermentadores.length} FV</span><span class="badge">${r.maduradores.length} SV</span>` +
    `<span class="badge CRITICA">${r.alertasCriticas} críticas</span><span class="badge AVISO">${r.alertasAviso} avisos</span>`;
  table($('#tblFv'), [
    { t: 'FV', f: x => x.tq }, { t: 'Cons', f: x => x.cons }, { t: 'Marca', f: x => x.marca }, { t: 'Etapa', f: x => x.etapa },
    { t: 'Horas en FV', num: 1, f: x => fmt(x.horasEnFv, 0) }, { t: 'E.O °P', num: 1, f: x => fmt(x.eoPonderado, 2) },
    { t: 'Extracto °P', num: 1, f: x => fmt(x.extractoActual, 2) }, { t: 'Atenuación %', num: 1, f: x => fmt(x.atenuacion) },
    { t: 'pH', num: 1, f: x => fmt(x.phActual, 2) }, { t: 'Último muestreo', f: x => fdate(x.ultimoMuestreo) },
    { t: 'T M/I °C', f: x => `${fmt(x.tempM)} / ${fmt(x.tempI)}` }, { t: 'Levadura', f: x => `${x.levadura ?? '–'} (g${x.generacion ?? '–'})` },
    { t: 'Alertas', h: x => alertas(x.alertas) }], r.fermentadores, x => verFermentacion(x.cons));
  table($('#tblSv'), [
    { t: 'SV', f: x => x.tq }, { t: 'Cons', f: x => x.cons }, { t: 'Marca', f: x => x.marca }, { t: 'Etapa', f: x => x.etapa },
    { t: 'Origen', f: x => x.fvOrigen }, { t: 'Volumen Hl', num: 1, f: x => fmt(x.volumenHl, 0) },
    { t: 'Horas en SV', num: 1, f: x => fmt(x.horasEnSv, 0) }, { t: 'Muestreo final', f: x => fdate(x.fechaMuestreoFinal) },
    { t: 'RDF %', num: 1, f: x => fmt(x.rdf) }, { t: 'pH', num: 1, f: x => fmt(x.ph, 2) },
    { t: 'Alertas', h: x => alertas(x.alertas) }], r.maduradores);
}

// ---------- Fermentación ----------
let charts = {};
async function fermentaciones() {
  const m = $('#fMarca').value;
  const rows = await api('/fermentaciones?limite=300' + (m ? '&marca=' + encodeURIComponent(m) : ''));
  table($('#tblFer'), [
    { t: 'Cons', f: x => x.cons }, { t: 'FV', f: x => x.tq }, { t: 'Marca', f: x => x.marca }, { t: 'Etapa', f: x => x.etapa },
    { t: 'Inicio llenado', f: x => fdate(x.inicioLlenado) }, { t: 'Vol Hl', num: 1, f: x => fmt(x.volumenHl, 0) },
    { t: 'E.O °P', num: 1, f: x => fmt(x.eoPonderado, 2) }, { t: 'Levadura', f: x => x.levadura ?? '–' },
    { t: 'Gen', num: 1, f: x => x.generacion ?? '–' }, { t: 'Viab %', num: 1, f: x => x.viabilidad == null ? '–' : fmt(x.viabilidad * 100) },
    { t: 'AF real', f: x => fdate(x.fechaAfReal) }], rows, x => verFermentacion(x.cons));
}

async function verFermentacion(cons) {
  const d = await api('/fermentaciones/' + encodeURIComponent(cons));
  if (!$('#fermentaciones').classList.contains('active')) $('#tabs [data-tab=fermentaciones]').click();
  $('#detalleFer').hidden = false;
  const f = d.fermentacion;
  $('#detalleTitulo').textContent = `${f.cons} · FV ${f.tq} · ${f.marca} · E.O ${fmt(f.eoPonderado, 2)} °P`;
  Object.values(charts).forEach(c => c.destroy());
  const ext = d.muestras.filter(m => m.horas != null && m.extracto != null).map(m => ({ x: m.horas, y: m.extracto }));
  charts.e = new Chart($('#chExtracto'), {
    type: 'line',
    data: { datasets: [{ label: 'Extracto (°P)', data: ext, borderColor: '#b45309', backgroundColor: '#b45309', tension: .25 }] },
    options: { parsing: false, scales: { x: { type: 'linear', title: { display: true, text: 'Horas de fermentación' } }, y: { title: { display: true, text: '°P' } } },
      plugins: { title: { display: true, text: 'Curva de atenuación' } } }
  });
  const tm = d.temperaturas.filter(t => t.horas != null);
  charts.t = new Chart($('#chTemp'), {
    type: 'line',
    data: { datasets: [
      { label: 'Temp. M (°C)', data: tm.filter(t => t.tempM != null).map(t => ({ x: t.horas, y: t.tempM })), borderColor: '#1d4ed8', backgroundColor: '#1d4ed8', pointRadius: 2 },
      { label: 'Temp. I (°C)', data: tm.filter(t => t.tempI != null).map(t => ({ x: t.horas, y: t.tempI })), borderColor: '#15803d', backgroundColor: '#15803d', pointRadius: 2 }] },
    options: { parsing: false, scales: { x: { type: 'linear', title: { display: true, text: 'Horas' } }, y: { title: { display: true, text: '°C' } } },
      plugins: { title: { display: true, text: 'Temperatura' } } }
  });
  $('#detalleFer').scrollIntoView({ behavior: 'smooth' });
}

// ---------- Maduración / Levadura ----------
async function maduraciones() {
  const rows = await api('/maduraciones?limite=300');
  table($('#tblMad'), [
    { t: 'Cons', f: x => x.cons }, { t: 'SV', f: x => x.tq }, { t: 'Marca', f: x => x.marca }, { t: 'Etapa', f: x => x.etapa },
    { t: 'Origen', f: x => [x.fvCons, x.fv2Cons].filter(Boolean).join(' + ') || '–' }, { t: 'Inicio trasiego', f: x => fdate(x.inicioTrasiego) },
    { t: 'Vol Hl', num: 1, f: x => fmt(x.volTotalHl, 0) }, { t: 'E.O °P', num: 1, f: x => fmt(x.extractoOriginal, 2) },
    { t: 'E.Real °P', num: 1, f: x => fmt(x.extractoReal, 2) }, { t: 'Alcohol %v/v', num: 1, f: x => fmt(x.alcoholV, 2) },
    { t: 'RDF %', num: 1, f: x => fmt(x.rdf) }, { t: 'pH', num: 1, f: x => fmt(x.ph, 2) }, { t: 'Color EBC', num: 1, f: x => fmt(x.color) },
    { t: 'Amargo', num: 1, f: x => fmt(x.amargo) }, { t: 'O2 ppb', num: 1, f: x => fmt(x.o2Ppb) }, { t: 'CO2', num: 1, f: x => fmt(x.co2, 2) },
    { t: 'Sensorial', f: x => [x.sensorial1, x.sensorial2].filter(Boolean).join(' / ') || '–' }], rows);
}

async function levaduras() {
  const rows = await api('/levaduras?limite=300' + ($('#levDisp').checked ? '&disponibles=true' : ''));
  table($('#tblLev'), [
    { t: 'Código', f: x => x.codigo }, { t: 'Marca', f: x => x.marca }, { t: 'Gen', num: 1, f: x => x.generacion ?? '–' },
    { t: 'FV fuente', f: x => x.utqFuente ?? '–' }, { t: 'Fin remoción', f: x => fdate(x.finRemocion) }, { t: 'Vol Hl', num: 1, f: x => fmt(x.volumenHl, 0) },
    { t: 'Consist.', num: 1, f: x => fmt(x.consistencia, 3) }, { t: 'Viab %', num: 1, f: x => x.viabilidad == null ? '–' : fmt(x.viabilidad * 100) },
    { t: 'pH', num: 1, f: x => fmt(x.ph, 2) }, { t: 'T cosecha', num: 1, f: x => fmt(x.tempCosecha) },
    { t: 'Máx. resiembra', f: x => fdate(x.maxResiembra) }, { t: 'Resembrada en', f: x => x.consResiembra ? `${x.consResiembra} (FV ${x.tqResiembra})` : '–' }], rows);
}

// ---------- Indicadores ----------
async function indicadores() {
  const q = new URLSearchParams();
  if ($('#indDesde').value) q.set('desde', $('#indDesde').value);
  if ($('#indHasta').value) q.set('hasta', $('#indHasta').value);
  const r = await api('/indicadores?' + q);
  $('#indCont').innerHTML = r.length ? '' : '<p class="muted">Sin datos en el rango seleccionado.</p>';
  r.forEach(m => {
    const div = document.createElement('div'); div.className = 'ind';
    div.innerHTML = `<h2>${esc(m.marca)}</h2><div class="scroll"><table></table></div>`;
    $('#indCont').appendChild(div);
    table($('table', div), [
      { t: 'Indicador', f: x => x.nombre }, { t: 'Unidad', f: x => x.unidad }, { t: 'Medidos', num: 1, f: x => x.medidos },
      { t: 'Cumplen', num: 1, f: x => x.cumplen },
      { t: '% Cumplimiento', h: x => x.porcentaje == null ? '–' : `${fmt(x.porcentaje, 0)} %<div class="bar"><i style="width:${x.porcentaje}%;background:${x.porcentaje >= 90 ? 'var(--ok)' : x.porcentaje >= 70 ? 'var(--warn)' : 'var(--crit)'}"></i></div>` }],
      m.indicadores);
  });
}

// ---------- Formularios ----------
const val = (v, type) => v === '' ? null : (type === 'number' ? Number(v) : v);
function formData(f) {
  const o = {};
  [...f.elements].filter(e => e.name).forEach(e => { const v = val(e.value, e.type); if (v !== null) o[e.name] = v; });
  return o;
}
const dt = s => s && s.length === 16 ? s + ':00' : s;

async function refreshSelects() {
  const r = await api('/resumen');
  const opt = (rows, f, blank) => (blank ? '<option value="">—</option>' : '') + rows.map(f).join('');
  $$('.fvActivos').forEach(s => s.innerHTML = opt(r.fermentadores, x => `<option value="${x.cons}">${x.cons} · FV ${x.tq} · ${x.marca}</option>`, s.classList.contains('opcional')));
  $$('.svActivos').forEach(s => s.innerHTML = opt(r.maduradores, x => `<option value="${x.cons}">${x.cons} · SV ${x.tq} · ${x.marca}</option>`));
  const lev = await api('/levaduras?disponibles=true&limite=100');
  $('#selLev').innerHTML = '<option value="">— Propagador —</option>' +
    lev.map(l => `<option value="${esc(l.codigo)}">${esc(l.codigo)} · ${esc(l.marca ?? '')} · gen ${l.generacion ?? '–'}</option>`).join('');
}

function bindForm(id, send, ok) {
  $(id).onsubmit = async e => {
    e.preventDefault();
    try {
      await send(formData(e.target));
      toast(ok); e.target.reset(); refreshSelects();
    } catch (err) { toast(err.message, true); }
  };
}
bindForm('#formLlenado', d => api('/fermentaciones', { body: { ...d, inicioLlenado: dt(d.inicioLlenado), finLlenado: dt(d.finLlenado) } }), 'Llenado registrado');
bindForm('#formMuestra', d => api(`/fermentaciones/${d.cons}/muestras`, { body: { ...d, fecha: dt(d.fecha) } }), 'Muestra registrada');
bindForm('#formTemp', d => api(`/fermentaciones/${d.cons}/temperaturas`, { body: { ...d, fecha: dt(d.fecha) } }), 'Lectura registrada');
bindForm('#formEtapaFv', d => api(`/fermentaciones/${d.cons}/etapa`, { method: 'PUT', body: { etapa: d.etapa } }), 'Etapa actualizada');
bindForm('#formTrasiego', d => api('/maduraciones', { body: { ...d, inicioTrasiego: dt(d.inicioTrasiego), finTrasiego: dt(d.finTrasiego) } }), 'Trasiego registrado');
bindForm('#formAnalisis', d => api(`/maduraciones/${d.cons}/analisis`, { method: 'PUT', body: { ...d, fechaMuestreo: dt(d.fechaMuestreo) } }), 'Análisis registrado');
bindForm('#formEtapaSv', d => api(`/maduraciones/${d.cons}/etapa`, { method: 'PUT', body: { etapa: d.etapa } }), 'Etapa actualizada');
bindForm('#formCosecha', d => api('/levaduras', { body: { ...d, finRemocion: dt(d.finRemocion), maxResiembra: dt(d.maxResiembra) } }), 'Cosecha registrada');

$('#formCalc').onsubmit = async e => {
  e.preventDefault();
  const q = new URLSearchParams(Object.entries(formData(e.target)));
  try { $('#calcOut').textContent = JSON.stringify(await api('/calculos?' + q), null, 2); } catch (err) { toast(err.message, true); }
};

// ---------- Init ----------
const load = { dashboard, fermentaciones, maduraciones, levaduras, indicadores, registrar: refreshSelects };
$('#ahoraBtn').onclick = () => dashboard().catch(e => toast(e.message, true));
$('#fMarca').onchange = fermentaciones;
$('#levDisp').onchange = levaduras;
$('#indBtn').onclick = () => indicadores().catch(e => toast(e.message, true));

(async function init() {
  try {
    const marcas = [...new Set((await api('/especificaciones')).map(e => e.marca))].sort();
    $('#fMarca').innerHTML += marcas.map(m => `<option>${esc(m)}</option>`).join('');
    $$('.marcas').forEach(s => s.innerHTML = marcas.map(m => `<option>${esc(m)}</option>`).join(''));
    const hoy = new Date(), pad = n => String(n).padStart(2, '0');
    $('#indHasta').value = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
    const d90 = new Date(hoy - 90 * 864e5);
    $('#indDesde').value = `${d90.getFullYear()}-${pad(d90.getMonth() + 1)}-${pad(d90.getDate())}`;
    await dashboard();
  } catch (e) { toast(e.message, true); }
})();
