// Pruebas unitarias de los lectores de App.Hoja (números, fechas, TSV). No necesitan navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const win = { App: {} };
vm.runInContext(fs.readFileSync(path.join(dir, '../src/js/35-hoja.js'), 'utf8'), vm.createContext({ window: win }));
const U = win.App.Hoja.util;
const ref = new Date(2026, 9, 7, 10, 15); // 2026-10-07 10:15

test('números: coma o punto decimal y miles', () => {
  assert.equal(U.parseNum('12,5'), 12.5);
  assert.equal(U.parseNum('12.5'), 12.5);
  assert.equal(U.parseNum('1.234,5'), 1234.5);
  assert.equal(U.parseNum('1,234.5'), 1234.5);
  assert.equal(U.parseNum('116.756', true), 116756);   // columna entera: punto = miles
  assert.equal(U.parseNum('1.200.300'), 1200300);
  assert.equal(U.parseNum('50 %'), 50);
  assert.equal(U.parseNum('7 m³'), 7);
  assert.equal(U.parseNum(''), null);
  assert.ok(Number.isNaN(U.parseNum('abc')));
});

test('fechas y horas flexibles', () => {
  const f = (s, t = 'fechahora') => U.parseFecha(s, t, ref);
  assert.equal(f('hoy 14:30'), '2026-10-07T14:30');
  assert.equal(f('14:30'), '2026-10-07T14:30');
  assert.equal(f('7/10 08:00'), '2026-10-07T08:00');
  assert.equal(f('07/10/2026 8:05'), '2026-10-07T08:05');
  assert.equal(f('2026-10-07 14:30'), '2026-10-07T14:30');
  assert.equal(f('2026-10-07T14:30'), '2026-10-07T14:30');
  assert.equal(f('26/07/2026 18.10'), '2026-07-26T18:10');       // texto real encontrado en los Excel
  assert.equal(f('ayer 08:00'), '2026-10-06T08:00');
  assert.equal(f('5/10'), '2026-10-05T00:00');
  assert.equal(f('2:30 pm'), '2026-10-07T14:30');
  assert.equal(f(46302.5), '2026-10-07T12:00');                   // serial de Excel
  assert.equal(f('46302'), '2026-10-07T00:00');
  assert.equal(f('hoy', 'fecha'), '2026-10-07');
  assert.equal(f('31/09/2026'), null);                           // fecha imposible
  assert.equal(f('25:00'), null);
  assert.equal(f('hola'), null);
  assert.equal(f('0.3333333', 'hora'), '08:00');
  assert.equal(f('1430', 'hora'), '14:30');
  assert.equal(f('8', 'hora'), '08:00');
});

test('TSV de Excel: comillas y saltos finales', () => {
  const j = (x) => JSON.stringify(x);
  assert.equal(j(U.parseTSV('a\tb\n1,5\t2\n')), j([['a', 'b'], ['1,5', '2']]));
  assert.equal(j(U.parseTSV('"x\ty"\t"he said ""hi"""\r\nz\tw')), j([['x\ty', 'he said "hi"'], ['z', 'w']]));
  assert.equal(U.toTSV([['a', 'b c'], ['1', '']]), 'a\tb c\n1\t');
});

test('formato de fecha', () => {
  assert.equal(U.fmtFecha('2026-10-07T14:30', 'fechahora'), '07/10/26 14:30');
  assert.equal(U.fmtFecha('2026-10-07', 'fecha'), '07/10/26');
  assert.equal(U.fmtFecha('texto raro', 'fecha'), 'texto raro');
});
