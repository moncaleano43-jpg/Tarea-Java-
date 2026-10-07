import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '../src/js/20-stats.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(code, ctx);
const S = ctx.__Stats;

const close = (a, b, tol = 1e-6, msg) => assert.ok(a !== null && Math.abs(a - b) <= tol, `${msg || ''} esperado ${b}, obtenido ${a}`);

test('se expone la API', () => {
  assert.ok(S && typeof S.mean === 'function');
  for (const k of ['linreg', 'pearson', 'ttest', 'anova', 'kruskal', 'compareGroups', 'holt', 'forecast', 'imr', 'xbarR',
    'capability', 'pareto', 'histogram', 'aggregate', 'fmtNum', 'describeTrend', 'tSf2', 'normInv', 'betaInc', 'gammaLn'])
    assert.equal(typeof S[k], 'function', k);
});

test('básicas y tolerancia a datos sucios', () => {
  const a = [2, 4, 4, 4, 5, 5, 7, 9];
  close(S.mean(a), 5); close(S.sd(a), Math.sqrt(32 / 7)); close(S.variance(a), 32 / 7);
  assert.equal(S.median(a), 4.5);
  assert.equal(S.mean(['a', null, NaN, undefined, 3, '5', '4,5', Infinity]), 4.1666666666666667);
  assert.equal(S.mean([]), null); assert.equal(S.sd([1]), null); assert.equal(S.mean(null), null);
  assert.equal(S.num('x'), null); assert.equal(S.num(true), null); assert.equal(S.num('3.5'), 3.5);
  close(S.quantile([1, 2, 3, 4, 5], 0.25), 2); close(S.quantile([1, 2, 3, 4], 0.5), 2.5);
  close(S.quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
  assert.equal(S.min(a), 2); assert.equal(S.max(a), 9);
  close(S.iqr([1, 2, 3, 4, 5]), 2); close(S.mad([1, 2, 3, 4, 100]), 1);
  const s = S.summary(a);
  assert.equal(s.n, 8); close(s.cv, Math.sqrt(32 / 7) / 5); close(s.p25, 4); close(s.p75, 5.5);
  assert.equal(S.summary([]), null);
  close(S.skew([1, 2, 3, 4, 10]), 1.6970563, 1e-6);
  assert.equal(S.kurt([1, 2]), null);
});

test('distribuciones', () => {
  close(S.normCdf(1.96), 0.975, 1e-4); close(S.normCdf(0), 0.5, 1e-12);
  close(S.normInv(0.975), 1.959964, 1e-5); close(S.normInv(0.5), 0, 1e-12);
  assert.equal(S.normInv(0), null); assert.equal(S.normInv(1.5), null);
  close(S.gammaLn(5), Math.log(24), 1e-10); close(S.gammaLn(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10);
  close(S.betaInc(0.3, 2, 2), 3 * 0.09 - 2 * 0.027, 1e-12); close(S.betaInc(0.5, 3, 3), 0.5, 1e-12);
  close(S.tCdf(0, 5), 0.5, 1e-12);
  close(S.tSf2(2.228138852, 10), 0.05, 1e-6); close(S.tSf2(2.570582, 5), 0.05, 1e-5);
  close(S.tSf2(1, 8), 0.3466, 1e-3); close(S.tCdf(-2, 1000), S.normCdf(-2), 1e-3);
  close(S.tSf2(12.706, 1), 0.05, 1e-3); // Cauchy: 2*(1-atan(t)/pi*...)
  close(S.fSf(9.2647, 2, 15), Math.pow(1 + 2 * 9.2647 / 15, -7.5), 1e-10);
  close(S.fCdf(9.2647, 2, 15), 1 - Math.pow(1 + 2 * 9.2647 / 15, -7.5), 1e-10);
  close(S.chi2Sf(7.2, 2), Math.exp(-3.6), 1e-10); close(S.chi2Sf(3.841459, 1), 0.05, 1e-5);
  close(S.tInv(0.975, 10), 2.228139, 1e-5);
  assert.equal(S.tSf2(NaN, 5), null);
});

test('atípicos', () => {
  const v = [10, 11, 10, 9, 10, 11, 10, 50, 10, 9];
  for (const method of ['mad', 'iqr', 'z']) {
    const o = S.outliers(v, { method, k: method === 'z' ? 2.5 : undefined });
    assert.deepEqual(Array.from(o.idx), [7], method); assert.equal(o.values[0], 50);
    assert.ok(o.hi < 50 && o.lo < 10);
  }
  // conserva índice original ignorando basura
  const o2 = S.outliers([10, null, 11, 'x', 10, 9, 10, 11, 10, 500, 10, 9]);
  assert.deepEqual(Array.from(o2.idx), [9]);
  const z = S.zscores([1, 2, 3, null]); assert.equal(z[3], null); close(z[1], 0);
  assert.ok(S.modZ(v)[7] > 3.5);
  assert.deepEqual(Array.from(S.outliers([1, 2]).idx), []);
});

test('regresión', () => {
  const xs = [0, 1, 2, 3, 4, 5], ys = xs.map(x => 2 * x + 1);
  const r = S.linreg(xs, ys);
  close(r.a, 1); close(r.b, 2); close(r.r, 1); close(r.r2, 1); assert.equal(r.p, 0);
  close(r.predict(10), 21);
  const iv = r.interval(10, 0.95); close(iv.mid, 21); close(iv.lo, 21); close(iv.hi, 21);
  // con ruido: valores conocidos (x=1..5, y=2,4,5,4,5 => b=0.6, a=2.2)
  const q = S.linreg([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
  close(q.b, 0.6); close(q.a, 2.2); close(q.r2, 0.6, 1e-9); close(q.se, Math.sqrt(2.4 / 3), 1e-9);
  close(q.seB, Math.sqrt(2.4 / 3) / Math.sqrt(10), 1e-9); close(q.t, 0.6 / (Math.sqrt(0.8) / Math.sqrt(10)), 1e-9);
  close(q.p, 0.1241, 2e-3);
  const i2 = q.interval(3, 0.95); assert.ok(i2.lo < i2.mid && i2.mid < i2.hi);
  assert.equal(S.linreg([1], [2]), null); assert.equal(S.linreg([1, 1, 1], [1, 2, 3]), null);
  close(S.linreg([1, 'a', 3, 4], [2, 3, null, 8]).b, 2); // solo pares válidos (1,2) y (4,8)
  close(S.linregIdx([1, 3, 5, 7]).b, 2);
  const pf = S.polyfit([-2, -1, 0, 1, 2, 3], [-2, -1, 0, 1, 2, 3].map(x => x * x - 2 * x + 3), 2);
  close(pf.predict(4), 11, 1e-8); close(pf.r2, 1, 1e-10);
});

test('correlación', () => {
  const p = S.pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
  close(p.r, 1); assert.equal(p.p, 0); assert.equal(p.n, 5);
  close(S.pearson([1, 2, 3, 4], [4, 3, 2, 1]).r, -1);
  const q = S.pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]); close(q.r, Math.sqrt(0.6), 1e-9); close(q.p, 0.1241, 2e-3);
  assert.equal(S.pearson([1, 1, 1], [1, 2, 3]), null); assert.equal(S.pearson([1], [1]), null);
  close(S.spearman([1, 2, 3, 4, 5], [1, 8, 27, 64, 125]).r, 1);
  close(S.spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]).r, 0.8208, 1e-3);
  const m = S.corrMatrix({ a: [1, 2, 3, 4, null], b: [2, 4, 6, 8, 100], c: [4, 3, 2, 1, 0] });
  assert.deepEqual(Array.from(m.names), ['a', 'b', 'c']);
  close(m.matrix[0][1], 1); close(m.matrix[0][2], -1); close(m.matrix[1][1], 1);
  assert.equal(m.n[0][1], 4); assert.equal(m.n[1][2], 5);
  assert.equal(S.strength(0.9), 'muy fuerte'); assert.equal(S.strength(-0.65), 'fuerte');
  assert.equal(S.strength(0.45), 'moderada'); assert.equal(S.strength(0.25), 'débil'); assert.equal(S.strength(0.05), 'nula');
});

test('comparar grupos', () => {
  const t = S.ttest([1, 2, 3, 4, 5], [2, 3, 4, 5, 6]);
  close(t.t, -1, 1e-9); close(t.df, 8, 1e-9); close(t.p, 0.3466, 1e-3); close(t.diff, -1);
  close(t.d, -1 / Math.sqrt(2.5), 1e-9); assert.ok(t.ci95[0] < -1 && t.ci95[1] > -1);
  close(t.ci95[1], -1 + 2.306004 * Math.sqrt(1), 1e-4);
  const tw = S.ttest([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]); assert.ok(tw.p < 0.05 && tw.df < 8);
  close(S.ttest([1, 2, 3, 4, 5], [2, 3, 4, 5, 6], { welch: false }).df, 8);
  assert.equal(S.ttest([1], [2, 3]), null);
  // ANOVA clásico: F=9.265, df 2/15
  const g = { A: [6, 8, 4, 5, 3, 4], B: [8, 12, 9, 11, 6, 8], C: [13, 9, 11, 8, 7, 12] };
  const an = S.anova(g);
  close(an.F, 9.2647, 1e-3); assert.equal(an.df1, 2); assert.equal(an.df2, 15);
  close(an.p, Math.pow(1 + 2 * (84 / 2) / (68 / 15 * 2) * 2 / 15 * 0 + 2 * an.F / 15, -7.5), 1e-9);
  close(an.p, 0.0024, 3e-4); close(an.eta2, 84 / 152, 1e-9);
  assert.equal(an.groups[1].name, 'B'); close(an.groups[1].mean, 9); assert.equal(an.groups[0].n, 6);
  const kw = S.kruskal({ a: [1, 2, 3], b: [4, 5, 6], c: [7, 8, 9] });
  close(kw.H, 7.2); assert.equal(kw.df, 2); close(kw.p, Math.exp(-3.6), 1e-9);
  const c3 = S.compareGroups(g);
  assert.equal(c3.test, 'anova'); assert.match(c3.texto, /^Diferencia significativa \(p=0,002\)/);
  const c2 = S.compareGroups({ x: [1, 2, 3, 4, 5], y: [2, 3, 4, 5, 6] });
  assert.equal(c2.test, 'welch'); assert.match(c2.texto, /^Sin evidencia de diferencia \(p=0,347\)/);
  const c2b = S.compareGroups({ x: [1, 2, 3, 4, 5], y: [50, 51, 52, 53, 54] });
  assert.match(c2b.texto, /^Diferencia significativa \(p<0,001\)/);
  assert.equal(S.compareGroups({ x: [1, 2, 3] }), null);
});

test('series: tendencia', () => {
  const inc = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const mk = S.mannKendall(inc);
  assert.equal(mk.S, 45); close(mk.tau, 1); assert.equal(mk.trend, 'sube'); assert.ok(mk.p < 0.001);
  assert.equal(S.mannKendall(inc.slice().reverse()).trend, 'baja');
  assert.equal(S.mannKendall([5, 1, 4, 2, 5, 3, 4, 2, 5, 3]).trend, 'sin tendencia');
  assert.equal(S.mannKendall([1, 2]), null); assert.equal(S.mannKendall([3, 3, 3, 3]), null);
  close(S.senSlope([1, 3, 5, 7, 100]), 2); assert.equal(S.senSlope([1]), null);
  assert.deepEqual(Array.from(S.movingAvg([1, 2, 3, 4, 5], 3)), [null, null, 2, 3, 4]);
  const e = S.ewma([10, 20, null, 30], 0.5); assert.deepEqual(Array.from(e), [10, 15, 15, 22.5]);
  const h = S.holt([1, 2, 3, 4, 5, 6, 7, 8], { alpha: 0.5, beta: 0.5, h: 3 });
  close(h.forecast[0], 9, 1e-9); close(h.forecast[2], 11, 1e-9); close(h.mae, 0, 1e-9); assert.equal(h.fitted.length, 8);
  assert.equal(S.holt([1, 2]), null);
  const si = S.seasonalIndex([10, 20, 10, 20, 10, 20], ['L', 'M', 'L', 'M', 'L', 'M']);
  close(si.find(x => x.label === 'M').index, 20 / 15); close(si.find(x => x.label === 'L').index, 10 / 15);
});

test('series: cusum y punto de cambio', () => {
  const base = []; for (let i = 0; i < 30; i++) base.push(10 + (i % 2 ? 0.3 : -0.3));
  const shifted = base.concat(base.map(v => v + 3));
  const c = S.cusum(base.concat(base.map(v => v + 1.5)), { target: 10 });
  assert.ok(c.alarms.length > 0 && c.alarms[0] >= 30);
  assert.equal(S.cusum(base, { target: 10, h: 5 }).alarms.length, 0);
  const cp = S.changePoint(shifted);
  assert.equal(cp.idx, 30); close(cp.meanBefore, 10, 1e-9); close(cp.meanAfter, 13, 1e-9); assert.ok(cp.p < 0.01);
  const cp2 = S.changePoint(shifted); assert.equal(cp.p, cp2.p); // determinista
  assert.equal(S.changePoint([1, 2, 3]), null);
  assert.ok(S.changePoint(base.map((v, i) => v + Math.sin(i * 12.9898) * 0.0 + (i * 7919 % 13) / 13)).p > 0.05);
});

test('forecast', () => {
  const y = []; for (let i = 0; i < 30; i++) y.push(5 + 2 * i + (i % 2 ? 0.2 : -0.2));
  const f = S.forecast(y, { h: 4, method: 'lineal' });
  assert.equal(f.method, 'lineal'); assert.equal(f.points.length, 4); assert.equal(f.points[0].i, 30);
  close(f.points[0].y, 65, 0.3); assert.ok(f.points[0].lo < f.points[0].y && f.points[0].hi > f.points[0].y);
  assert.ok(f.backtest.mae < 0.6); assert.ok(f.backtest.coverage >= 0 && f.backtest.coverage <= 1);
  const fa = S.forecast(y, { h: 3 });
  assert.ok(['lineal', 'holt', 'media'].includes(fa.method)); assert.notEqual(fa.method, 'media');
  const fm = S.forecast([5, 5.1, 4.9, 5, 5.2, 4.8, 5, 5.1, 4.9, 5, 5.05, 4.95], { h: 2, method: 'media' });
  close(fm.points[0].y, 5, 0.1);
  assert.equal(S.forecast([1, 2]), null);
  for (const m of ['holt', 'media']) assert.equal(S.forecast(y, { method: m }).method, m);
});

test('control estadístico de procesos', () => {
  const y = []; for (let i = 0; i < 30; i++) y.push(i % 2 ? 9.9 : 10.1);
  y[15] = 11; // ~5.6 sigma
  const r = S.imr(y);
  assert.ok(r.points[15].out); assert.ok(r.points[15].rules.includes(1));
  assert.equal(r.points.filter(p => p.out).length, 1);
  assert.ok(r.ucl > 10 && r.lcl < 10 && r.ucl < 11);
  assert.ok(r.violations.some(v => v.i === 15 && v.rule === 1 && /fuera de los límites/.test(v.text)));
  close(r.sigma, 0.2 / 1.128, 1e-3);
  // regla 4: 8 seguidos del mismo lado
  const rr = S.imr([10, 10.2, 9.8, 10.1, 9.9, 10, 10.3, 10.2, 10.4, 10.1, 10.2, 10.3, 10.2, 10.1, 9.9, 10, 10.1, 9.9, 10]);
  assert.ok(rr.violations.some(v => v.rule === 4));
  assert.equal(S.imr([1, 2]), null);
  assert.equal(S.imr([5, 5, 5, 5]).violations.length, 0);
  const xr = S.xbarR([[10, 11, 12], [10, 10, 11], [11, 12, 13], [9, 10, 11], [10, 11, 12]]);
  close(xr.xbarbar, 10.8666667, 1e-6); close(xr.rbar, 1.8, 1e-9); close(xr.xbar.ucl, 10.8666667 + 1.023 * 1.8, 1e-6);
  close(xr.r.ucl, 2.575 * 1.8, 1e-9); assert.equal(xr.r.lcl, 0);
  // capacidad
  const alt = []; for (let i = 0; i < 10; i++) alt.push(i % 2 ? 9.9 : 10.1);
  const cap = S.capability(alt, { lsl: 9.4, usl: 10.6, target: 10 });
  close(cap.mean, 10); close(cap.cp, 1.2 * 1.128 / (6 * 0.2), 1e-9); close(cap.cpk, cap.cp, 1e-9);
  close(cap.sd, Math.sqrt(0.1 / 9), 1e-9); close(cap.pp, 1.2 / (6 * Math.sqrt(0.1 / 9)), 1e-9);
  assert.equal(cap.verdict, 'marginal'); assert.equal(cap.pctOut, 0);
  const c2 = S.capability([2, 4, 4, 4, 5, 5, 7, 9], { lsl: -1, usl: 11 });
  close(c2.ppk, 6 / (3 * Math.sqrt(32 / 7)), 1e-9);
  const c3 = S.capability([10, 10.1, 9.9, 10.2, 11.5, 9.8, 10, 10.1, 9.9, 10.3], { usl: 10.5 });
  assert.equal(c3.cp, null); assert.equal(c3.verdict, 'no capaz'); close(c3.pctOut, 10);
  assert.equal(S.capability([1], { usl: 3 }).verdict, null); assert.equal(S.capability([1, 2, 3], {}).verdict, null);
  assert.equal(S.capability([1, 2, 3, 4], { usl: 100, lsl: -100 }).verdict, 'capaz');
});

test('pareto, histograma y distribución', () => {
  const p = S.pareto([{ label: 'D', value: 5 }, { label: 'A', value: 50 }, { label: 'C', value: 15 }, { label: 'B', value: 30 }, { label: 'Z', value: 'x' }]);
  assert.deepEqual(Array.from(p.items.map(i => i.label)), ['A', 'B', 'C', 'D']);
  close(p.total, 100); close(p.items[0].cum, 50); close(p.items[1].cum, 80); close(p.items[3].cum, 100, 1e-12);
  assert.deepEqual(Array.from(p.vitalFew), ['A', 'B']); close(p.items[2].pct, 15);
  const pt = S.pareto([{ label: 'a', value: 5 }, { label: 'b', value: 4 }, { label: 'c', value: 3 }, { label: 'd', value: 2 }, { label: 'e', value: 1 }], { top: 2 });
  assert.equal(pt.items.length, 3); assert.equal(pt.items[2].label, 'Otros'); close(pt.items[2].value, 6);
  assert.equal(S.pareto([]), null);
  const h = S.histogram([1, 2, 2, 3, 3, 3, 4, 4, 5, 10], { bins: 3 });
  assert.equal(h.bins.length, 3); assert.equal(h.bins.reduce((s, b) => s + b.n, 0), 10);
  close(h.width, 3); assert.equal(h.bins[0].n, 6); assert.equal(h.bins[2].n, 1);
  const ha = S.histogram(Array.from({ length: 100 }, (_, i) => i)); assert.ok(ha.bins.length >= 5);
  assert.equal(S.histogram([4, 4, 4]).bins.length, 1); assert.equal(S.histogram([]), null);
  const e = S.ecdf([3, 1, 2, 2]); assert.equal(e.at(0), 0); close(e.at(2), 0.75); assert.equal(e.at(10), 1);
  const b = S.boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  close(b.q1, 3.25); close(b.med, 5.5); close(b.q3, 7.75); assert.deepEqual(Array.from(b.outliers), [100]); assert.equal(b.hi, 9);
});

test('series con fechas', () => {
  const rows = [
    { t: '2026-03-12', v: 10 }, { t: '2026-03-12', v: 5 }, { t: '2026-03-13', v: 7 },
    { t: '2026-03-30', v: 1 }, { t: '2026-04-02', v: 3 }, { t: 'basura', v: 9 }, { t: '2026-04-03', v: null }
  ];
  const d = S.aggregate(rows, { by: 'day', fn: 'sum' });
  assert.equal(d.length, 4); assert.equal(d[0].label, '12 mar'); assert.equal(d[0].v, 15); assert.equal(d[0].n, 2);
  assert.ok(d[0].t < d[1].t);
  const w = S.aggregate(rows, { by: 'week', fn: 'sum' });
  assert.deepEqual(Array.from(w.map(x => x.label)), ['S11 2026', 'S14 2026']);
  assert.equal(w[1].v, 4);
  const m = S.aggregate(rows, { by: 'month', fn: 'mean' });
  assert.equal(m[0].label, 'mar 2026'); close(m[0].v, 23 / 4); assert.equal(m[1].label, 'abr 2026');
  assert.equal(S.aggregate(rows, { by: 'year', fn: 'count' })[0].v, 6);
  assert.equal(S.aggregate([{ t: Date.UTC(2026, 0, 15, 12), v: 2 }], { by: 'month' })[0].label, 'ene 2026');
  const ky = S.aggregate([{ t: '2026-01-01', v: 1, m: 'a' }, { t: '2026-01-01', v: 2, m: 'b' }], { key: 'm', by: 'day' });
  assert.equal(ky.length, 2); assert.equal(ky[1].key, 'b');
  assert.deepEqual(Array.from(S.aggregate(null)), []);
  const gb = S.groupBy([{ a: 'x' }, { a: 'y' }, { a: 'x' }], 'a'); assert.equal(gb.get('x').length, 2);
  const fg = S.fillGaps(S.aggregate([{ t: '2026-03-01', v: 1 }, { t: '2026-03-04', v: 2 }], { by: 'day' }), 'day');
  assert.equal(fg.length, 4); assert.equal(fg[1].v, null); assert.equal(fg[1].n, 0); assert.equal(fg[1].label, '2 mar');
  const fm = S.fillGaps(S.aggregate([{ t: '2025-11-10', v: 1 }, { t: '2026-02-04', v: 2 }], { by: 'month' }), 'month');
  assert.deepEqual(Array.from(fm.map(x => x.label)), ['nov 2025', 'dic 2025', 'ene 2026', 'feb 2026']);
});

test('formato y textos', () => {
  assert.equal(S.fmtNum(1234567.891, 2), '1.234.567,89'); assert.equal(S.fmtNum(-0.001, 1), '0,0');
  assert.equal(S.fmtNum(12.5, 0), '13'); assert.equal(S.fmtNum(null), '—'); assert.equal(S.fmtNum(-1500, 0), '-1.500');
  assert.equal(S.fmtPct(12.34), '12,3 %'); assert.equal(S.fmtP(0.0004), '<0,001'); assert.equal(S.fmtP(0.0234), '0,023');
  assert.equal(S.monthNames.length, 12);
  const up = Array.from({ length: 20 }, (_, i) => 100 + 2.3 * i + (i % 3 - 1) * 0.5);
  const t = S.describeTrend(up, { name: 'Agua' });
  assert.match(t, /^Agua: Sube /); assert.match(t, /por periodo \(p<0,001\), R²=(0,9|1,00)/);
  assert.match(S.describeTrend([5, 6, 5, 6, 5, 6, 5, 6]), /^Sin tendencia clara/);
  assert.match(S.describeTrend([1, 2]), /insuficientes/);
  assert.match(S.describeTrend(up, { unit: 'hL' }), /hL \(.*\) por periodo/);
  assert.match(S.describeSummary([2, 4, 4, 4, 5, 5, 7, 9], { unit: 'L' }), /^n=8; promedio 5,00 L \(sd 2,14; CV 42,8 %\)/);
  assert.match(S.describeSummary([]), /Sin datos/);
});

test('nunca lanza ni devuelve NaN con entradas raras', () => {
  const bad = [undefined, null, NaN, 'x', {}, [], [null], [NaN, 'a'], 5, () => 1];
  const fns = Object.keys(S).filter(k => typeof S[k] === 'function');
  for (const k of fns) for (const a of bad) for (const b of bad) {
    let r;
    assert.doesNotThrow(() => { r = S[k](a, b); }, k);
    if (typeof r === 'number') assert.ok(Number.isFinite(r), `${k} devolvió ${r}`);
  }
});
