import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '../src/js/38-importador.js'), 'utf8');
const win = { App: {} };
const ctx = vm.createContext({ window: win, console, TextDecoder, TextEncoder });
vm.runInContext(code, ctx);
const P = win.App.Importador._p;

test('CSV: comillas, saltos de línea y separadores', () => {
  const r = P.parseDelimitado('a;b;c\n"x;1";"di ""hola""";3\n"l1\nl2";,;z\n');
  assert.equal(r.sep, ';');
  assert.equal(JSON.stringify(r.rows[1]), JSON.stringify(['x;1', 'di "hola"', '3']));
  assert.equal(r.rows[2][0], 'l1\nl2');
  assert.equal(P.parseDelimitado('a\tb\n1\t2').sep, '\t');
  assert.equal(P.parseDelimitado('a,b,c\n1,2,3').sep, ',');
  assert.equal(P.parseDelimitado('﻿a,b\r\n1,2\r\n').rows.length, 2);
});

test('números con coma o punto decimal y miles', () => {
  assert.equal(P.numeroTexto('1,5'), 1.5);
  assert.equal(P.numeroTexto('1.234,56'), 1234.56);
  assert.equal(P.numeroTexto('1,234.56'), 1234.56);
  assert.equal(P.numeroTexto('-12'), -12);
  assert.equal(P.numeroTexto('95%'), 95);
  assert.equal(P.numeroTexto('007'), null);
  assert.equal(P.numeroTexto('abc'), null);
  assert.equal(P.numeroTexto('1.234.567'), 1234567);
});

test('fechas dd/mm/aaaa, ISO y imposibles', () => {
  const s = (t) => P.fechaTexto(t);
  assert.equal(s('06/10/2026').v, 46301);
  assert.equal(s('2026-10-06').v, 46301);
  assert.ok(Math.abs(s('06/10/2026 12:00').v - 46301.5) < 1e-9);
  assert.ok(Math.abs(s('21/01/2026 22.00').v - (46043 + 22 / 24)) < 1e-9);
  assert.ok(Math.abs(s('2026-10-06T08:30:00').v - (46301 + 8.5 / 24)) < 1e-9);
  assert.equal(s('31/02/2026').malo, true);
  assert.equal(s('13/13/2026').malo, true);
  assert.equal(s('hola'), null);
  assert.equal(P.horaTexto('08:00'), 1 / 3);
  assert.equal(P.horaTexto('25:00'), null);
  assert.equal(P.dmy(46301), '06/10/2026');
});

test('tipificar convierte columnas completas', () => {
  const m = [['Fecha', 'Hora', 'Lectura', 'Obs'], ['06/10/2026', '08:00', '1.234,5', 'ok'], ['07/10/2026', '16:00', '12,5', 'x']];
  const { rows } = P.tipificar(m, 1, 4);
  assert.equal(rows[1][0], 46301); assert.equal(rows[1][1], 1 / 3); assert.equal(rows[1][2], 1234.5); assert.equal(rows[2][2], 12.5); assert.equal(rows[1][3], 'ok');
});

test('encabezado y mapeo por similitud', () => {
  const m = [['Reporte de agua'], [], ['Fecha', 'Hora', 'Lectura pisos'], ['06/10/2026', '08:00', '5']];
  assert.equal(P.detectaEncabezado(m), 2);
  const dest = [{ i: 1, label: 'FECHA' }, { i: 3, label: 'HORA' }, { i: 4, label: 'LECTURA' }, { i: 9, label: 'LECTURA' }, { i: 5, label: 'CONSUMO PISOS (m3)' }];
  const mp = P.sugiereMapeo(['Fecha', 'Hora', 'Lectura pisos', 'Observaciones'], dest);
  assert.equal(mp[0], 1); assert.equal(mp[1], 3); assert.ok([4, 9].includes(mp[2])); assert.equal(mp[3], -1);
  assert.ok(P.similitud('Fecha y hora de Inicio', 'Fecha inicio') > 0.4);
  assert.ok(P.similitud('Marca', 'Operario') < 0.3);
});

test('detección por hojas', () => {
  assert.equal(P.detectaPorHojas(['Versión', '2026']).tipo, 'agua?');
  assert.equal(P.detectaPorHojas(['x', '1. Cada uso', '2. Semanal']).tipo, 'aseos');
  assert.equal(P.detectaPorHojas(['Gráficas', 'Control Recuperada']).tipo, 'recuperacion');
  assert.equal(P.detectaPorHojas(['CONTROL TRASIEGO', 'PARETO']).tipo, 'programa');
  assert.equal(P.detectaPorHojas(['INVENTARIO', 'B.D FERMENTACIÓN', 'B.D MADURACIÓN', 'x']).tipo, 'cavas');
  assert.equal(P.detectaPorHojas(['Hoja1']).tipo, 'libre');
});

// fuente de agua sintética (forma de OperationSources): encabezado en fila 12, día = 3 filas
const agua = (lecturas) => {
  const rows = [{ row: 12, cells: { 1: 'FECHA', 3: 'HORA', 4: 'LECTURA' } }];
  let r = 14;
  lecturas.forEach(([dia, vals]) => vals.forEach((v, k) => { const c = { 3: [1 / 3, 2 / 3, 0][k] }; if (k === 0) c[1] = dia; if (v != null) { c[4] = v; c[5] = 5; } rows.push({ row: r++, cells: c }); }));
  return { '2026': { rows, formulas: {} } };
};
test('agua: combinar agrega lo nuevo, actualiza lo que cambió y respeta lo igual', () => {
  const act = agua([[46300, [100, 110, 120]], [46301, [130, null, null]]]);
  const inc = agua([[46300, [100, 110, 120]], [46301, [130, 140, 150]], [46302, [160, 170, 180]]]);
  const r = P.fusionarLibro('agua', act, inc, '01.', {});
  assert.equal(r.total.iguales, 4);
  assert.equal(r.total.nuevas, 5); // 2 turnos que estaban vacíos + 3 del día nuevo
  assert.equal(r.total.actualizadas, 0);
  assert.equal(r.next['2026'].rows.filter((x) => x.row > 12).length, 9);
  // idempotente: aplicar de nuevo no cambia nada
  const r2 = P.fusionarLibro('agua', r.next, inc, '01.', {});
  assert.equal(r2.total.nuevas + r2.total.actualizadas, 0);
  // cambio de una lectura → actualizada
  const inc2 = agua([[46300, [999, 110, 120]], [46301, [130, 140, 150]]]);
  const r3 = P.fusionarLibro('agua', r.next, inc2, '01.', {});
  assert.equal(r3.total.actualizadas, 1);
  // número de fila conservado
  assert.equal(r3.next['2026'].rows.find((x) => x.cells[4] === 999).row, 14);
});
test('aseos: clave hoja+equipo+inicio y conflicto con edición propia', () => {
  const enc = { row: 9, cells: { 1: 'Fecha y hora de Inicio', 2: 'Fecha y hora de fin', 4: 'Equipo', 22: 'pH 6-8' } };
  const hoja = (xs) => ({ '1. Cada uso': { rows: [enc, ...xs.map(([f, e, ph], i) => ({ row: 10 + i, cells: { 1: f, 4: e, 22: ph, 28: 'X' } }))], formulas: {} } });
  const act = hoja([[46301.3, 'RED MOSTO', 6.5], [46301.4, 'FV 12', 7]]);
  const inc = hoja([[46301.3, 'RED MOSTO', 6.5], [46301.4, 'FV 12', 7.5], [46301.5, 'FV 13', 6]]);
  const r = P.fusionarLibro('aseos', act, inc, '02.', {});
  assert.equal(JSON.stringify([r.total.nuevas, r.total.actualizadas, r.total.iguales, r.total.conflictos]), '[1,1,1,0]');
  const r2 = P.fusionarLibro('aseos', act, inc, '02.', { '02.|1. Cada uso|11': { revisions: [] } });
  assert.equal(JSON.stringify([r2.total.nuevas, r2.total.actualizadas, r2.total.conflictos]), '[1,0,1]');
});
test('recuperación y programa: claves', () => {
  const rec = { rows: [{ row: 11, cells: { 0: 'Consecutivo' } }, { row: 12, cells: { 0: 5, 1: 'UTK 1', 2: 46301 } }, { row: 13, cells: { 0: 5, 1: 'UTK 1' } }], formulas: {} };
  assert.equal(JSON.stringify(P.claves('recuperacion', 'Control Recuperada', rec.rows, rec.rows[0])), '[null,"C5","C5#2"]');
  const pr = [{ row: 8, cells: { 1: 'Proceso' } }, { row: 9, cells: { 1: 'TRASIEGO UTQ_16', 4: 46301.5 } }, { row: 10, cells: { 1: 'CIP' } }];
  assert.equal(JSON.stringify(P.claves('programa', 'CONTROL TRASIEGO', pr, pr[0])), JSON.stringify([null, 'Ptrasiego utq 16|' + Math.round(46301.5 * 1440), null]));
});
test('validación: fechas imposibles, errores y valores desproporcionados', () => {
  const lab = { 1: 'FECHA', 5: 'CONSUMO PISOS (m3)' };
  const av = P.validar('agua', [{ row: 14, cells: { 1: '31/02/2026', 5: -3 } }, { row: 15, cells: { 1: 2, 5: 99999 } }, { row: 16, cells: { 1: '#REF!' } }], lab, {});
  const t = av.map((a) => a.texto).join('|');
  assert.match(t, /fecha/); assert.match(t, /negativo/); assert.match(t, /desproporcionado/); assert.match(t, /error de Excel/);
});

// ---- lector rápido de .xlsx: se prueba con un libro mínimo armado a mano (zip sin compresión)
function zipStored(files) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = enc.encode(name), db = enc.encode(text);
    const lh = new Uint8Array(30 + nb.length); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint32(18, db.length, true); dv.setUint32(22, db.length, true); dv.setUint16(26, nb.length, true);
    lh.set(nb, 30); parts.push(lh, db);
    const ch = new Uint8Array(46 + nb.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint32(20, db.length, true); cv.setUint32(24, db.length, true); cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true);
    ch.set(nb, 46); cd.push(ch); off += lh.length + db.length;
  }
  const cdLen = cd.reduce((a, b) => a + b.length, 0), eo = new Uint8Array(22), ev = new DataView(eo.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, cd.length, true); ev.setUint16(10, cd.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
  const all = [...parts, ...cd, eo], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out.buffer;
}
test('lector rápido: textos compartidos, inline, números, booleanos, errores, entidades y límites', async () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>46301.5</v></c><c r="C1" t="b"><v>1</v></c><c r="D1" t="e"><v>#REF!</v></c></row>'
    + '<row r="3" spans="1:16384"><c r="A3" t="inlineStr"><is><t>a &amp; b</t></is></c><c r="B3" t="str"><f>A1</f><v>x &lt; y</v></c><c r="C3" s="5"/><c r="AA3"><v>9</v></c></row></sheetData></worksheet>';
  const buf = zipStored({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Datos &amp; más" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Fecha</t></si><si><r><t>x</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': sheet,
  });
  const l = await P.libroRapido(buf);
  assert.equal(l.hojas[0], 'Datos & más');
  const f = await l.filas('Datos & más', {});
  assert.equal(f[0][0], 'Fecha'); assert.equal(f[0][1], 46301.5); assert.equal(f[0][2], true); assert.equal(f[0][3], null);
  assert.equal(f[1], undefined);
  assert.equal(f[2][0], 'a & b'); assert.equal(f[2][1], 'x < y'); assert.equal(f[2][26], 9); assert.equal(f[2][2], undefined);
  const g = await l.filas('Datos & más', { maxCol: 10, maxRow: 2 });
  assert.equal(g[2], undefined); assert.equal(g[0][1], 46301.5);
  const h = await l.filas('Datos & más', { maxCol: 10 });
  assert.equal(h[2][26], undefined);
});
