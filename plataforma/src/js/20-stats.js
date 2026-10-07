/* ============================================================
 * 20-stats.js  -  Motor estadístico del "analista de datos"
 * JavaScript puro (ES2020), sin dependencias ni DOM.
 * Expone window.App.Stats (navegador) o globalThis.__Stats / module.exports (Node).
 *
 * Convenciones:
 *  - Todas las funciones toleran null/undefined/NaN/strings no numéricos
 *    (se ignoran) y devuelven null (nunca NaN) si faltan datos. No lanzan.
 *  - Las series (imr, cusum, mannKendall, forecast, changePoint...) trabajan
 *    sobre la serie "limpia" (sin valores inválidos); los índices que
 *    devuelven se refieren a esa serie limpia. `outliers` y `zscores`
 *    conservan la posición del arreglo original.
 *  - cv se devuelve como fracción (sd/|media|); usar fmtPct(cv*100).
 *  - Porcentajes (pct, cum, pctOut) vienen en escala 0-100.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- utilidades básicas ---------- */
  function num(x) {
    if (typeof x === 'number') return Number.isFinite(x) ? x : null;
    if (typeof x === 'string') {
      const s = x.trim();
      if (s === '') return null;
      let v = Number(s);
      if (!Number.isFinite(v) && /^-?\d+,\d+$/.test(s)) v = Number(s.replace(',', '.'));
      return Number.isFinite(v) ? v : null;
    }
    return null;
  }
  function clean(arr) {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (let i = 0; i < arr.length; i++) { const v = num(arr[i]); if (v !== null) out.push(v); }
    return out;
  }
  // pares válidos (ambos numéricos); conserva el índice original
  function pairs(xs, ys) {
    const X = [], Y = [], I = [];
    if (!Array.isArray(xs) || !Array.isArray(ys)) return { X, Y, I };
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) {
      const a = num(xs[i]), b = num(ys[i]);
      if (a !== null && b !== null) { X.push(a); Y.push(b); I.push(i); }
    }
    return { X, Y, I };
  }
  // envuelve funciones numéricas: nunca lanza ni devuelve NaN/Infinity
  function safe(f) {
    return function () {
      try { const v = f.apply(null, arguments); return (typeof v === 'number' && !Number.isFinite(v)) ? null : (v === undefined ? null : v); }
      catch (e) { return null; }
    };
  }
  function sortedAsc(v) { return v.slice().sort((a, b) => a - b); }
  function qs(s, p) { // cuantil R-7 sobre arreglo ya ordenado
    const n = s.length;
    if (!n) return null;
    if (p <= 0) return s[0];
    if (p >= 1) return s[n - 1];
    const h = (n - 1) * p, lo = Math.floor(h);
    return s[lo] + (h - lo) * ((s[lo + 1] !== undefined ? s[lo + 1] : s[lo]) - s[lo]);
  }
  function fin(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }

  /* ---------- estadística descriptiva ---------- */
  function sum(arr) { const v = clean(arr); if (!v.length) return null; let s = 0, c = 0; for (const x of v) { const y = x - c, t = s + y; c = (t - s) - y; s = t; } return s; }
  function mean(arr) { const v = clean(arr); if (!v.length) return null; return sum(v) / v.length; }
  function median(arr) { const v = sortedAsc(clean(arr)); return qs(v, 0.5); }
  function variance(arr) {
    const v = clean(arr); if (v.length < 2) return null;
    const m = mean(v); let s = 0, c = 0;
    for (const x of v) { const d = x - m; s += d * d; c += d; }
    return (s - c * c / v.length) / (v.length - 1);
  }
  function sd(arr) { const v = variance(arr); return v === null ? null : Math.sqrt(v); }
  function min(arr) { const v = clean(arr); if (!v.length) return null; let m = v[0]; for (const x of v) if (x < m) m = x; return m; }
  function max(arr) { const v = clean(arr); if (!v.length) return null; let m = v[0]; for (const x of v) if (x > m) m = x; return m; }
  function quantile(arr, p) {
    p = num(p); if (p === null) return null;
    return qs(sortedAsc(clean(arr)), p);
  }
  function iqr(arr) { const s = sortedAsc(clean(arr)); if (!s.length) return null; return qs(s, 0.75) - qs(s, 0.25); }
  function mad(arr) { // desviación absoluta mediana (sin escalar)
    const v = clean(arr); if (!v.length) return null;
    const m = median(v);
    return median(v.map(x => Math.abs(x - m)));
  }
  function cv(arr) { const m = mean(arr), s = sd(arr); if (m === null || s === null || m === 0) return null; return s / Math.abs(m); }
  function skew(arr) {
    const v = clean(arr), n = v.length; if (n < 3) return null;
    const m = mean(v), s = sd(v); if (!s) return null;
    let t = 0; for (const x of v) t += Math.pow((x - m) / s, 3);
    return fin(n / ((n - 1) * (n - 2)) * t);
  }
  function kurt(arr) { // curtosis en exceso (G2)
    const v = clean(arr), n = v.length; if (n < 4) return null;
    const m = mean(v), s = sd(v); if (!s) return null;
    let t = 0; for (const x of v) t += Math.pow((x - m) / s, 4);
    return fin(n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * t - 3 * Math.pow(n - 1, 2) / ((n - 2) * (n - 3)));
  }
  function summary(arr) {
    const v = clean(arr); if (!v.length) return null;
    const s = sortedAsc(v);
    return {
      n: v.length, mean: mean(v), sd: sd(v), min: s[0],
      p10: qs(s, 0.1), p25: qs(s, 0.25), median: qs(s, 0.5), p75: qs(s, 0.75), p90: qs(s, 0.9),
      max: s[s.length - 1], cv: cv(v), iqr: qs(s, 0.75) - qs(s, 0.25)
    };
  }

  /* ---------- distribuciones ---------- */
  const _lanczos = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function _gammaLn(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - _gammaLn(1 - x);
    x -= 1;
    let a = 0.99999999999980993;
    const t = x + 7.5;
    for (let i = 0; i < 8; i++) a += _lanczos[i] / (x + i + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function _betaCf(x, a, b) {
    const FPMIN = 1e-300, EPS = 3e-16;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; let h = d;
    for (let m = 1; m <= 500; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function _betaInc(x, a, b) {
    if (!(a > 0) || !(b > 0) || !(x >= 0) || x > 1) return NaN;
    if (x === 0) return 0;
    if (x === 1) return 1;
    const bt = Math.exp(_gammaLn(a + b) - _gammaLn(a) - _gammaLn(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * _betaCf(x, a, b) / a;
    return 1 - bt * _betaCf(1 - x, b, a) / b;
  }
  function _gammaP(a, x) { // gamma incompleta regularizada inferior
    if (!(a > 0) || !(x >= 0)) return NaN;
    if (x === 0) return 0;
    if (x < a + 1) {
      let ap = a, del = 1 / a, s = del;
      for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; s += del; if (Math.abs(del) < Math.abs(s) * 3e-16) break; }
      return s * Math.exp(-x + a * Math.log(x) - _gammaLn(a));
    }
    return 1 - _gammaQcf(a, x);
  }
  function _gammaQcf(a, x) {
    const FPMIN = 1e-300;
    let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - _gammaLn(a)) * h;
  }
  function _gammaQ(a, x) {
    if (!(a > 0) || !(x >= 0)) return NaN;
    if (x < a + 1) return 1 - _gammaP(a, x);
    return _gammaQcf(a, x);
  }
  function _normCdf(x) {
    if (x === Infinity) return 1;
    if (x === -Infinity) return 0;
    const z = -x / Math.SQRT2; // normCdf = erfc(z)/2
    const z2 = z * z;
    const erfc = z >= 0 ? _gammaQ(0.5, z2) : 1 + _gammaP(0.5, z2);
    return 0.5 * erfc;
  }
  function _normInv(p) {
    if (!(p > 0) || !(p < 1)) return NaN;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    let x;
    if (p < 0.02425) {
      const q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p > 1 - 0.02425) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else {
      const q = p - 0.5, r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    // refinamiento de Halley
    const e = _normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }
  function _tSf2(t, df) { // p bilateral
    if (!(df > 0) || t === null || Number.isNaN(t)) return NaN;
    if (!Number.isFinite(t)) return 0;
    return _betaInc(df / (df + t * t), df / 2, 0.5);
  }
  function _tCdf(t, df) {
    const p2 = _tSf2(t, df);
    return t >= 0 ? 1 - p2 / 2 : p2 / 2;
  }
  function _tInv(p, df) {
    if (!(p > 0) || !(p < 1) || !(df > 0)) return NaN;
    if (p === 0.5) return 0;
    const q = p > 0.5 ? 2 * (1 - p) : 2 * p; // área bilateral
    let lo = 0, hi = 1;
    while (_tSf2(hi, df) > q && hi < 1e12) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (_tSf2(mid, df) > q) lo = mid; else hi = mid;
      if (hi - lo < 1e-13 * Math.max(1, hi)) break;
    }
    const t = (lo + hi) / 2;
    return p > 0.5 ? t : -t;
  }
  function _fSf(F, d1, d2) {
    if (!(d1 > 0) || !(d2 > 0) || !(F >= 0)) return NaN;
    if (F === Infinity) return 0;
    return _betaInc(d2 / (d2 + d1 * F), d2 / 2, d1 / 2);
  }
  function _chi2Sf(x, df) { return x <= 0 ? 1 : _gammaQ(df / 2, x / 2); }

  const gammaLn = safe(_gammaLn);
  const betaInc = safe(_betaInc);
  const normCdf = safe(_normCdf);
  const normInv = safe(_normInv);
  const tCdf = safe((t, df) => _tCdf(num(t), num(df)));
  const tSf2 = safe((t, df) => _tSf2(num(t), num(df)));
  const tInv = safe((p, df) => _tInv(num(p), num(df)));
  const fSf = safe((F, d1, d2) => _fSf(num(F), num(d1), num(d2)));
  const fCdf = safe((F, d1, d2) => 1 - _fSf(num(F), num(d1), num(d2)));
  const chi2Sf = safe((x, df) => _chi2Sf(num(x), num(df)));

  /* ---------- atípicos ---------- */
  function robustScale(v) { // sigma robusta: 1.4826*MAD (o 1.2533*DAM si MAD=0)
    const m = median(v), md = median(v.map(x => Math.abs(x - m)));
    if (md > 0) return { c: m, s: 1.4826 * md };
    const dam = mean(v.map(x => Math.abs(x - m)));
    return { c: m, s: dam > 0 ? 1.253314 * dam : 0 };
  }
  function zscores(arr) {
    if (!Array.isArray(arr)) return [];
    const v = clean(arr), m = mean(v), s = sd(v);
    return arr.map(x => { const a = num(x); return (a === null || m === null || !s) ? null : (a - m) / s; });
  }
  function modZ(arr) {
    if (!Array.isArray(arr)) return [];
    const v = clean(arr); if (!v.length) return arr.map(() => null);
    const r = robustScale(v);
    return arr.map(x => { const a = num(x); return (a === null || !r.s) ? null : (a - r.c) / r.s; }); // = 0.6745*(x-mediana)/MAD
  }
  function outliers(arr, opts) {
    opts = opts || {};
    const method = opts.method || 'mad';
    const res = { idx: [], values: [], lo: null, hi: null, method };
    const v = clean(arr); if (v.length < 3) return res;
    let lo, hi, k;
    if (method === 'iqr') {
      k = num(opts.k) ?? 1.5;
      const s = sortedAsc(v), q1 = qs(s, 0.25), q3 = qs(s, 0.75);
      lo = q1 - k * (q3 - q1); hi = q3 + k * (q3 - q1);
    } else if (method === 'z') {
      k = num(opts.k) ?? 3;
      const m = mean(v), s = sd(v); if (!s) return res;
      lo = m - k * s; hi = m + k * s;
    } else {
      k = num(opts.k) ?? 3.5;
      const r = robustScale(v); if (!r.s) return res;
      lo = r.c - k * r.s; hi = r.c + k * r.s;
    }
    res.lo = lo; res.hi = hi; res.k = k;
    arr.forEach((x, i) => { const a = num(x); if (a !== null && (a < lo || a > hi)) { res.idx.push(i); res.values.push(a); } });
    return res;
  }

  /* ---------- regresión ---------- */
  function linreg(xs, ys) {
    const { X, Y } = pairs(xs, ys), n = X.length;
    if (n < 2) return null;
    const mx = mean(X), my = mean(Y);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = X[i] - mx, dy = Y[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    if (!(sxx > 0)) return null;
    const b = sxy / sxx, a = my - b * mx;
    let sse = 0;
    for (let i = 0; i < n; i++) { const e = Y[i] - (a + b * X[i]); sse += e * e; }
    if (sse < 1e-24 * Math.max(1, syy)) sse = 0;
    let r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
    if (r !== null) r = Math.max(-1, Math.min(1, r));
    const r2 = r === null ? null : (sse === 0 ? 1 : r * r);
    const df = n - 2;
    const se = df > 0 ? Math.sqrt(sse / df) : null;
    const seB = se !== null ? se / Math.sqrt(sxx) : null;
    let t = null, p = null;
    if (seB !== null) {
      if (seB > 0) { t = b / seB; p = fin(_tSf2(t, df)); }
      else { p = b === 0 ? 1 : 0; }
    }
    const predict = x => { const v = num(x); return v === null ? null : a + b * v; };
    const interval = (x, level) => {
      const v = num(x), mid = predict(x);
      if (v === null || se === null) return { lo: null, hi: null, mid };
      const lv = num(level) ?? 0.95;
      const tq = _tInv(1 - (1 - lv) / 2, df);
      const half = tq * se * Math.sqrt(1 + 1 / n + (v - mx) * (v - mx) / sxx);
      return { lo: fin(mid - half), hi: fin(mid + half), mid };
    };
    return { n, a, b, r, r2, se, seB, t, p, predict, interval, meanX: mx, meanY: my };
  }
  function linregIdx(ys) { // x = posición en el arreglo (los huecos inválidos se saltan)
    if (!Array.isArray(ys)) return null;
    return linreg(ys.map((_, i) => i), ys);
  }
  function _solve(A, b) { // Gauss con pivoteo parcial
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      if (Math.abs(A[p][i]) < 1e-14) return null;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }
  function polyfit(xs, ys, grado) {
    const deg = Math.max(1, Math.min(6, Math.floor(num(grado) ?? 2)));
    const { X, Y } = pairs(xs, ys), n = X.length;
    if (n <= deg) return null;
    const mx = mean(X), sx = sd(X); if (!sx) return null;
    const Z = X.map(x => (x - mx) / sx);
    const m = deg + 1, A = [], b = [];
    for (let i = 0; i < m; i++) {
      A.push(new Array(m).fill(0)); b.push(0);
      for (let k = 0; k < n; k++) { b[i] += Math.pow(Z[k], i) * Y[k]; for (let j = 0; j < m; j++) A[i][j] += Math.pow(Z[k], i + j); }
    }
    const coef = _solve(A, b); if (!coef) return null;
    const predict = x => { const v = num(x); if (v === null) return null; const z = (v - mx) / sx; let r = 0; for (let i = m - 1; i >= 0; i--) r = r * z + coef[i]; return r; };
    const my = mean(Y); let sse = 0, sst = 0;
    for (let k = 0; k < n; k++) { const e = Y[k] - predict(X[k]); sse += e * e; sst += (Y[k] - my) * (Y[k] - my); }
    return { deg, n, coef, mx, sx, r2: sst > 0 ? 1 - sse / sst : null, rmse: Math.sqrt(sse / n), predict };
  }

  /* ---------- correlación ---------- */
  function ranks(v) { // rangos promedio
    const idx = v.map((x, i) => i).sort((a, b) => v[a] - v[b]);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
      const rk = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = rk;
      i = j + 1;
    }
    return r;
  }
  function _pearsonRaw(X, Y) {
    const n = X.length; if (n < 2) return null;
    const mx = mean(X), my = mean(Y);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = X[i] - mx, dy = Y[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    if (!(sxx > 0) || !(syy > 0)) return null;
    const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
    let t = null, p = null;
    if (n > 2) {
      if (Math.abs(r) >= 1 - 1e-12) p = 0;
      else { t = r * Math.sqrt((n - 2) / (1 - r * r)); p = fin(_tSf2(t, n - 2)); }
    }
    return { r, n, p, t };
  }
  function pearson(xs, ys) { const { X, Y } = pairs(xs, ys); return _pearsonRaw(X, Y); }
  function spearman(xs, ys) {
    const { X, Y } = pairs(xs, ys); if (X.length < 2) return null;
    const res = _pearsonRaw(ranks(X), ranks(Y)); if (!res) return null;
    return { r: res.r, n: res.n, p: res.p };
  }
  function corrMatrix(cols, opts) {
    const method = (opts && opts.method) || 'pearson';
    const names = cols && typeof cols === 'object' ? Object.keys(cols) : [];
    const k = names.length;
    const matrix = [], N = [], P = [];
    for (let i = 0; i < k; i++) {
      matrix.push(new Array(k).fill(null)); N.push(new Array(k).fill(0)); P.push(new Array(k).fill(null));
    }
    for (let i = 0; i < k; i++) {
      for (let j = i; j < k; j++) {
        const a = cols[names[i]], b = cols[names[j]];
        const { X, Y } = pairs(a, b);
        N[i][j] = N[j][i] = X.length;
        if (i === j) { matrix[i][i] = X.length >= 2 && sd(X) > 0 ? 1 : null; P[i][i] = matrix[i][i] === null ? null : 0; continue; }
        const r = method === 'spearman' ? spearman(X, Y) : pearson(X, Y);
        if (r) { matrix[i][j] = matrix[j][i] = r.r; P[i][j] = P[j][i] = r.p; }
      }
    }
    return { names, matrix, n: N, p: P, method };
  }
  function strength(r) {
    const v = num(r); if (v === null) return null;
    const a = Math.abs(v);
    return a >= 0.8 ? 'muy fuerte' : a >= 0.6 ? 'fuerte' : a >= 0.4 ? 'moderada' : a >= 0.2 ? 'débil' : 'nula';
  }

  /* ---------- comparar grupos ---------- */
  function normGroups(groups) {
    const out = [];
    if (Array.isArray(groups)) groups.forEach((g, i) => { const v = clean(g); if (v.length) out.push({ name: 'G' + (i + 1), v }); });
    else if (groups && typeof groups === 'object') Object.keys(groups).forEach(k => { const v = clean(groups[k]); if (v.length) out.push({ name: k, v }); });
    return out;
  }
  function ttest(a, b, opts) {
    const welch = !(opts && opts.welch === false);
    const A = clean(a), B = clean(b);
    if (A.length < 2 || B.length < 2) return null;
    const na = A.length, nb = B.length, ma = mean(A), mb = mean(B), va = variance(A), vb = variance(B);
    const diff = ma - mb;
    const sp = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
    let se, df;
    if (welch) {
      const qa = va / na, qb = vb / nb; se = Math.sqrt(qa + qb);
      df = se > 0 ? Math.pow(qa + qb, 2) / (qa * qa / (na - 1) + qb * qb / (nb - 1)) : na + nb - 2;
    } else { se = sp * Math.sqrt(1 / na + 1 / nb); df = na + nb - 2; }
    let t = null, p, ci95;
    if (se > 0) { t = diff / se; p = fin(_tSf2(t, df)); const h = _tInv(0.975, df) * se; ci95 = [diff - h, diff + h]; }
    else { p = diff === 0 ? 1 : 0; ci95 = [diff, diff]; }
    return { t, df, p, meanA: ma, meanB: mb, diff, ci95, d: sp > 0 ? diff / sp : null, nA: na, nB: nb, welch };
  }
  function anova(groups) {
    const g = normGroups(groups), k = g.length;
    if (k < 2) return null;
    const N = g.reduce((s, x) => s + x.v.length, 0);
    if (N - k < 1) return null;
    const all = [].concat(...g.map(x => x.v)), gm = mean(all);
    let ssb = 0, ssw = 0;
    const info = g.map(x => {
      const m = mean(x.v); ssb += x.v.length * (m - gm) * (m - gm);
      for (const y of x.v) ssw += (y - m) * (y - m);
      return { name: x.name, n: x.v.length, mean: m, sd: sd(x.v) };
    });
    const df1 = k - 1, df2 = N - k;
    let F, p;
    if (ssw <= 1e-24 * Math.max(1, ssb)) { F = null; p = ssb > 0 ? 0 : 1; if (ssb === 0) F = 0; }
    else { F = (ssb / df1) / (ssw / df2); p = fin(_fSf(F, df1, df2)); }
    const sst = ssb + ssw;
    return { F, df1, df2, p, eta2: sst > 0 ? ssb / sst : null, ssb, ssw, groups: info };
  }
  function kruskal(groups) {
    const g = normGroups(groups), k = g.length;
    if (k < 2) return null;
    const all = [].concat(...g.map(x => x.v)), N = all.length;
    const r = ranks(all);
    let pos = 0, H = 0;
    g.forEach(x => { let rs = 0; for (let i = 0; i < x.v.length; i++) rs += r[pos + i]; pos += x.v.length; H += rs * rs / x.v.length; });
    H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
    const cnt = new Map(); all.forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1));
    let tie = 0; cnt.forEach(t => { tie += t * t * t - t; });
    const corr = 1 - tie / (N * N * N - N);
    if (!(corr > 0)) return null;
    H = Math.max(0, H / corr);
    const df = k - 1;
    return { H, df, p: fin(_chi2Sf(H, df)), N };
  }
  function pTxt(p) { return p !== null && p < 0.001 ? 'p<0,001' : 'p=' + fmtP(p); }
  function compareGroups(groups) {
    const g = normGroups(groups);
    if (g.length < 2) return null;
    const alpha = 0.05;
    if (g.length === 2) {
      const t = ttest(g[0].v, g[1].v, { welch: true });
      if (!t) return null;
      const sig = t.p !== null && t.p < alpha;
      const det = `${g[0].name} (media ${fmtNum(t.meanA, 2)}) vs ${g[1].name} (media ${fmtNum(t.meanB, 2)}); diferencia ${fmtNum(t.diff, 2)}, IC95 % [${fmtNum(t.ci95[0], 2)}; ${fmtNum(t.ci95[1], 2)}]`;
      const texto = sig ? `Diferencia significativa (${pTxt(t.p)}): ${det}.` : `Sin evidencia de diferencia (${pTxt(t.p)}): ${det}.`;
      return { test: 'welch', p: t.p, significant: sig, ttest: t, texto };
    }
    const an = anova(groups), kw = kruskal(groups);
    if (!an) return null;
    const best = an.groups.slice().sort((x, y) => y.mean - x.mean);
    const sig = an.p !== null && an.p < alpha;
    const kwTxt = kw ? `; Kruskal-Wallis ${pTxt(kw.p)}` : '';
    const det = `ANOVA F(${an.df1}, ${an.df2})=${fmtNum(an.F, 2)}, ${pTxt(an.p)}, η²=${fmtNum(an.eta2, 2)}${kwTxt}`;
    const ext = `mayor media en ${best[0].name} (${fmtNum(best[0].mean, 2)}), menor en ${best[best.length - 1].name} (${fmtNum(best[best.length - 1].mean, 2)})`;
    const texto = sig ? `Diferencia significativa (${pTxt(an.p)}): ${ext}. ${det}.` : `Sin evidencia de diferencia (${pTxt(an.p)}) entre ${an.groups.length} grupos. ${det}.`;
    return { test: 'anova', p: an.p, significant: sig, anova: an, kruskal: kw, texto };
  }

  /* ---------- tendencia y series ---------- */
  function rolling(arr, w, fn) {
    if (!Array.isArray(arr)) return [];
    w = Math.max(1, Math.floor(num(w) ?? 3));
    const f = { mean, sum, median, sd, min, max }[fn || 'mean'] || mean;
    return arr.map((_, i) => i < w - 1 ? null : fin(f(arr.slice(i - w + 1, i + 1))));
  }
  function movingAvg(arr, w) { return rolling(arr, w, 'mean'); }
  function ewma(arr, lambda) {
    if (!Array.isArray(arr)) return [];
    let l = num(lambda); if (l === null || l <= 0 || l > 1) l = 0.3;
    let s = null;
    return arr.map(x => { const v = num(x); if (v !== null) s = s === null ? v : l * v + (1 - l) * s; return s; });
  }
  function _holtRun(y, al, be) {
    const n = y.length; let l = y[0], b = y[1] - y[0], sse = 0, sae = 0;
    const fitted = [y[0]];
    for (let t = 1; t < n; t++) {
      const pred = l + b, e = y[t] - pred; fitted.push(pred); sse += e * e; sae += Math.abs(e);
      const ln = al * y[t] + (1 - al) * (l + b);
      b = be * (ln - l) + (1 - be) * b; l = ln;
    }
    return { fitted, level: l, trend: b, sse, mae: sae / (n - 1), rmse: Math.sqrt(sse / (n - 1)) };
  }
  function holt(arr, opts) {
    opts = opts || {};
    const y = clean(arr); if (y.length < 3) return null;
    const h = Math.max(1, Math.floor(num(opts.h) ?? 3));
    let al = num(opts.alpha), be = num(opts.beta), run;
    if (al === null || be === null) { // búsqueda en rejilla minimizando el SSE de un paso
      let best = null;
      for (const a of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]) for (const b of [0.05, 0.1, 0.2, 0.3, 0.5]) {
        if (al !== null && a !== al) continue; if (be !== null && b !== be) continue;
        const r = _holtRun(y, a, b);
        if (!best || r.sse < best.r.sse) best = { r, a, b };
      }
      if (al === null) al = best.a; if (be === null) be = best.b;
      run = best.r;
    } else run = _holtRun(y, al, be);
    const forecast = []; for (let k = 1; k <= h; k++) forecast.push(run.level + k * run.trend);
    return { fitted: run.fitted, forecast, level: run.level, trend: run.trend, mae: run.mae, rmse: run.rmse, alpha: al, beta: be };
  }
  function mannKendall(arr) {
    const y = clean(arr), n = y.length; if (n < 3) return null;
    let S = 0;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(y[j] - y[i]);
    const cnt = new Map(); y.forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1));
    let v = n * (n - 1) * (2 * n + 5);
    cnt.forEach(t => { if (t > 1) v -= t * (t - 1) * (2 * t + 5); });
    v /= 18;
    if (!(v > 0)) return null;
    const z = S > 0 ? (S - 1) / Math.sqrt(v) : S < 0 ? (S + 1) / Math.sqrt(v) : 0;
    const p = fin(2 * (1 - _normCdf(Math.abs(z))));
    const tau = S / (n * (n - 1) / 2);
    const trend = p !== null && p < 0.05 ? (S > 0 ? 'sube' : 'baja') : 'sin tendencia';
    return { S, z, p, tau, n, trend };
  }
  function senSlope(arr) {
    const y = clean(arr), n = y.length; if (n < 2) return null;
    const sl = [];
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) sl.push((y[j] - y[i]) / (j - i));
    return median(sl);
  }
  function seasonalIndex(values, labels) { // [{label,n,mean,index}] por etiqueta (ej. día de semana)
    if (!Array.isArray(values) || !Array.isArray(labels)) return [];
    const m = new Map(), all = [];
    for (let i = 0; i < values.length; i++) {
      const v = num(values[i]), l = labels[i];
      if (v === null || l === null || l === undefined) continue;
      if (!m.has(l)) m.set(l, []);
      m.get(l).push(v); all.push(v);
    }
    const gm = mean(all), out = [];
    m.forEach((vs, l) => { const mm = mean(vs); out.push({ label: l, n: vs.length, mean: mm, index: gm ? mm / gm : null }); });
    return out;
  }
  function cusum(arr, opts) {
    opts = opts || {};
    const y = clean(arr); if (y.length < 2) return null;
    const target = num(opts.target) ?? mean(y), sg = sd(y);
    const k = num(opts.k) ?? 0.5, h = num(opts.h) ?? 5; // en unidades de sigma
    const pos = [], neg = [], alarms = [];
    if (!sg) return { pos: y.map(() => 0), neg: y.map(() => 0), alarms, target, sigma: 0, k, h };
    let p = 0, q = 0;
    y.forEach((x, i) => {
      p = Math.max(0, p + (x - target) - k * sg); q = Math.max(0, q + (target - x) - k * sg);
      pos.push(p); neg.push(q);
      if (p > h * sg || q > h * sg) { alarms.push(i); p = 0; q = 0; }
    });
    return { pos, neg, alarms, target, sigma: sg, k, h };
  }
  function _rng(seed) { // mulberry32 determinista
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function _bestSplit(y, minSeg) { // devuelve {idx, gain}: reducción máxima de SSE
    const n = y.length, c1 = new Array(n + 1).fill(0), c2 = new Array(n + 1).fill(0);
    const m0 = y.reduce((a, b) => a + b, 0) / n; // centrado por estabilidad
    for (let i = 0; i < n; i++) { const d = y[i] - m0; c1[i + 1] = c1[i] + d; c2[i + 1] = c2[i] + d * d; }
    const sst = c2[n] - c1[n] * c1[n] / n;
    let best = -1, bestSse = Infinity;
    for (let i = minSeg; i <= n - minSeg; i++) {
      const s1 = c2[i] - c1[i] * c1[i] / i, s2 = (c2[n] - c2[i]) - Math.pow(c1[n] - c1[i], 2) / (n - i);
      if (s1 + s2 < bestSse) { bestSse = s1 + s2; best = i; }
    }
    return { idx: best, gain: sst - bestSse };
  }
  function changePoint(arr) {
    const y = clean(arr), n = y.length, minSeg = 3;
    if (n < 2 * minSeg) return null;
    if (!(sd(y) > 0)) return null;
    const obs = _bestSplit(y, minSeg); if (obs.idx < 0) return null;
    const B = n > 2000 ? 99 : 199, rnd = _rng(20260101);
    let ge = 0; const w = y.slice();
    for (let b = 0; b < B; b++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = w[i]; w[i] = w[j]; w[j] = t; }
      if (_bestSplit(w, minSeg).gain >= obs.gain - 1e-12) ge++;
    }
    const before = y.slice(0, obs.idx), after = y.slice(obs.idx);
    return { idx: obs.idx, meanBefore: mean(before), meanAfter: mean(after), delta: mean(after) - mean(before), p: (ge + 1) / (B + 1) };
  }

  /* ---------- pronóstico ---------- */
  function _fcLinear(y, h, level) {
    const r = linreg(y.map((_, i) => i), y); if (!r) return null;
    const n = y.length, points = [];
    for (let k = 0; k < h; k++) { const iv = r.interval(n + k, level); points.push({ i: n + k, y: iv.mid, lo: iv.lo, hi: iv.hi }); }
    let sae = 0, sse = 0; y.forEach((v, i) => { const e = v - r.predict(i); sae += Math.abs(e); sse += e * e; });
    return { points, mae: sae / n, rmse: Math.sqrt(sse / n) };
  }
  function _fcHolt(y, h, level) {
    const r = holt(y, { h }); if (!r) return null;
    const z = _normInv(1 - (1 - level) / 2), n = y.length;
    const points = r.forecast.map((v, k) => { const hw = z * r.rmse * Math.sqrt(k + 1); return { i: n + k, y: v, lo: v - hw, hi: v + hw }; });
    return { points, mae: r.mae, rmse: r.rmse };
  }
  function _fcMean(y, h, level) {
    const n = y.length, m = mean(y), s = sd(y) || 0, n1 = y.length;
    const hw = (n1 > 1 ? _tInv(1 - (1 - level) / 2, n1 - 1) : 0) * s * Math.sqrt(1 + 1 / n1);
    const points = []; for (let k = 0; k < h; k++) points.push({ i: n + k, y: m, lo: m - hw, hi: m + hw });
    return { points, mae: mean(y.map(v => Math.abs(v - m))), rmse: Math.sqrt(y.reduce((a, v) => a + (v - m) * (v - m), 0) / n) };
  }
  const _fc = { lineal: _fcLinear, holt: _fcHolt, media: _fcMean };
  function _backtest(method, y, level) {
    const n = y.length; let nt = Math.max(1, Math.round(0.2 * n));
    if (n - nt < 3) nt = n - 3;
    if (nt < 1) return null;
    const f = _fc[method](y.slice(0, n - nt), nt, level); if (!f) return null;
    let sae = 0, sse = 0, ape = 0, nape = 0, cov = 0;
    f.points.forEach((p, k) => {
      const a = y[n - nt + k], e = a - p.y;
      sae += Math.abs(e); sse += e * e;
      if (a !== 0) { ape += Math.abs(e / a); nape++; }
      if (p.lo !== null && p.hi !== null && a >= p.lo && a <= p.hi) cov++;
    });
    return { mae: sae / nt, rmse: Math.sqrt(sse / nt), mape: nape ? ape / nape * 100 : null, coverage: cov / nt, n: nt };
  }
  function forecast(arr, opts) {
    opts = opts || {};
    const y = clean(arr); if (y.length < 3) return null;
    const h = Math.max(1, Math.floor(num(opts.h) ?? 5));
    let level = num(opts.level) ?? 0.95; if (!(level > 0 && level < 1)) level = 0.95;
    let method = opts.method || 'auto';
    const cand = {};
    if (method === 'auto') {
      let best = null;
      for (const m of ['lineal', 'holt', 'media']) {
        const bt = _backtest(m, y, level), fit = _fc[m](y, h, level);
        if (!fit) continue;
        const score = bt ? bt.mae : fit.mae;
        cand[m] = { mae: score, backtest: !!bt };
        if (!best || score < best.score) best = { m, score };
      }
      if (!best) return null;
      method = best.m;
    } else if (!_fc[method]) method = 'lineal';
    const fit = _fc[method](y, h, level); if (!fit) return null;
    const bt = _backtest(method, y, level);
    return {
      method, h, level, n: y.length, points: fit.points,
      mae: bt ? bt.mae : fit.mae, rmse: bt ? bt.rmse : fit.rmse,
      backtest: bt, inSample: { mae: fit.mae, rmse: fit.rmse }, candidates: cand
    };
  }

  /* ---------- control estadístico de procesos ---------- */
  function imr(arr) {
    const y = clean(arr), n = y.length; if (n < 3) return null;
    const mr = []; for (let i = 1; i < n; i++) mr.push(Math.abs(y[i] - y[i - 1]));
    let mrBar = mean(mr);
    const keep = mr.filter(v => v <= 3.267 * mrBar); // recorta rangos extremos (estimación robusta)
    if (keep.length >= 2) mrBar = mean(keep);
    const sigma = mrBar / 1.128, cl = mean(y);
    const ucl = cl + 3 * sigma, lcl = cl - 3 * sigma;
    const z = y.map(v => sigma > 0 ? (v - cl) / sigma : 0);
    const side = v => v > 0 ? 1 : v < 0 ? -1 : 0;
    const points = [], violations = [];
    const nm = f => fmtNum(f, 2);
    for (let i = 0; i < n; i++) {
      const rules = [];
      if (sigma > 0) {
        if (Math.abs(z[i]) > 3) rules.push(1);
        // regla 2: 2 de 3 > 2σ del mismo lado
        if (i >= 2 && Math.abs(z[i]) > 2) {
          const s = side(z[i]); let c = 0; for (let j = i - 2; j <= i; j++) if (side(z[j]) === s && Math.abs(z[j]) > 2) c++;
          if (c >= 2) rules.push(2);
        }
        // regla 3: 4 de 5 > 1σ del mismo lado
        if (i >= 4 && Math.abs(z[i]) > 1) {
          const s = side(z[i]); let c = 0; for (let j = i - 4; j <= i; j++) if (side(z[j]) === s && Math.abs(z[j]) > 1) c++;
          if (c >= 4) rules.push(3);
        }
        // regla 4: 8 seguidos del mismo lado
        if (i >= 7) {
          const s = side(z[i]); let ok = s !== 0; for (let j = i - 7; j <= i && ok; j++) if (side(z[j]) !== s) ok = false;
          if (ok) rules.push(4);
        }
      }
      points.push({ i, y: y[i], z: z[i], out: rules.includes(1), rules });
      const lado = z[i] > 0 ? 'por encima' : 'por debajo';
      rules.forEach(r => {
        const text = r === 1 ? `Punto ${i + 1} fuera de los límites de control (±3σ): ${nm(y[i])}, límites ${nm(lcl)} a ${nm(ucl)}.`
          : r === 2 ? `Punto ${i + 1}: 2 de 3 puntos consecutivos a más de 2σ de la media, ${lado} (posible desvío del proceso).`
          : r === 3 ? `Punto ${i + 1}: 4 de 5 puntos consecutivos a más de 1σ de la media, ${lado} (cambio pequeño sostenido).`
          : `Punto ${i + 1}: 8 puntos seguidos ${lado} de la media (desplazamiento del nivel del proceso).`;
        violations.push({ i, rule: r, text });
      });
    }
    return { n, cl, ucl, lcl, mrBar, sigma, mrUcl: 3.267 * mrBar, points, violations };
  }
  const _A2 = [1.880, 1.023, 0.729, 0.577, 0.483, 0.419, 0.373, 0.337, 0.308];
  const _D3 = [0, 0, 0, 0, 0, 0.076, 0.136, 0.184, 0.223];
  const _D4 = [3.267, 2.575, 2.282, 2.114, 2.004, 1.924, 1.864, 1.816, 1.777];
  const _d2 = [1.128, 1.693, 2.059, 2.326, 2.534, 2.704, 2.847, 2.970, 3.078];
  function xbarR(subgroups) {
    if (!Array.isArray(subgroups)) return null;
    const sg = subgroups.map(clean).filter(g => g.length >= 2);
    if (sg.length < 2) return null;
    const nbar = Math.round(mean(sg.map(g => g.length))), ni = Math.max(2, Math.min(10, nbar)) - 2;
    const xb = sg.map(g => mean(g)), rg = sg.map(g => max(g) - min(g));
    const xbb = mean(xb), rbar = mean(rg);
    const xl = { cl: xbb, ucl: xbb + _A2[ni] * rbar, lcl: xbb - _A2[ni] * rbar };
    const rl = { cl: rbar, ucl: _D4[ni] * rbar, lcl: _D3[ni] * rbar };
    return {
      k: sg.length, n: nbar, xbarbar: xbb, rbar, sigma: rbar / _d2[ni],
      xbar: Object.assign({ points: xb.map((v, i) => ({ i, y: v, out: v > xl.ucl || v < xl.lcl })) }, xl),
      r: Object.assign({ points: rg.map((v, i) => ({ i, y: v, out: v > rl.ucl || v < rl.lcl })) }, rl)
    };
  }
  function capability(arr, opts) {
    opts = opts || {};
    const y = clean(arr), lsl = num(opts.lsl), usl = num(opts.usl), target = num(opts.target);
    const res = { n: y.length, mean: null, sd: null, sigmaWithin: null, cp: null, cpk: null, pp: null, ppk: null, cpm: null, pctOut: null, pctOutExp: null, verdict: null, lsl, usl, target };
    if (y.length < 2) return res;
    const m = mean(y), s = sd(y);
    res.mean = m; res.sd = s;
    if (lsl === null && usl === null) return res;
    let mrs = 0; for (let i = 1; i < y.length; i++) mrs += Math.abs(y[i] - y[i - 1]);
    const sw = mrs / (y.length - 1) / 1.128; res.sigmaWithin = sw;
    const idx = (sig, both) => {
      if (!(sig > 0)) return [null, null];
      const a = (lsl !== null && usl !== null) ? (usl - lsl) / (6 * sig) : null;
      const up = usl !== null ? (usl - m) / (3 * sig) : Infinity, lo = lsl !== null ? (m - lsl) / (3 * sig) : Infinity;
      return [a, Math.min(up, lo)];
    };
    [res.cp, res.cpk] = idx(sw); [res.pp, res.ppk] = idx(s);
    if (target !== null && lsl !== null && usl !== null && s > 0) res.cpm = (usl - lsl) / (6 * Math.sqrt(s * s + (m - target) * (m - target)));
    const out = y.filter(v => (lsl !== null && v < lsl) || (usl !== null && v > usl)).length;
    res.pctOut = out / y.length * 100;
    if (s > 0) res.pctOutExp = ((lsl !== null ? _normCdf((lsl - m) / s) : 0) + (usl !== null ? 1 - _normCdf((usl - m) / s) : 0)) * 100;
    const ref = res.cpk !== null ? res.cpk : res.ppk;
    if (ref !== null) res.verdict = ref >= 1.33 ? 'capaz' : ref >= 1 ? 'marginal' : 'no capaz';
    return res;
  }

  /* ---------- Pareto, histograma, distribución ---------- */
  function pareto(items, opts) {
    opts = opts || {};
    let it = (Array.isArray(items) ? items : []).map(x => ({ label: x && x.label, value: num(x && x.value) })).filter(x => x.value !== null && x.value > 0);
    if (!it.length) return null;
    it.sort((a, b) => b.value - a.value);
    const top = Math.floor(num(opts.top) ?? 0);
    if (top > 0 && it.length > top) {
      const rest = it.slice(top).reduce((s, x) => s + x.value, 0);
      it = it.slice(0, top); it.push({ label: 'Otros', value: rest });
    }
    const total = it.reduce((s, x) => s + x.value, 0);
    let run = 0;
    const out = it.map((x, i) => { run += x.value; return { label: x.label, value: x.value, pct: x.value / total * 100, cum: i === it.length - 1 ? 100 : run / total * 100 }; });
    const vital = num(opts.vital) ?? 80, vitalFew = [];
    for (const o of out) { vitalFew.push(o.label); if (o.cum >= vital - 1e-9) break; }
    return { items: out, total, vitalFew };
  }
  function histogram(arr, opts) {
    const y = clean(arr); if (!y.length) return null;
    const s = sortedAsc(y), n = y.length, lo = s[0], hi = s[n - 1], range = hi - lo;
    const res = { n, mean: mean(y), sd: sd(y), min: lo, max: hi };
    if (!(range > 0)) { res.bins = [{ x0: lo, x1: hi, n, pct: 100 }]; res.width = 0; return res; }
    let k = num(opts && opts.bins);
    if (k === null) {
      const h = 2 * (qs(s, 0.75) - qs(s, 0.25)) / Math.cbrt(n);
      k = h > 0 ? Math.ceil(range / h) : Math.ceil(Math.log2(n)) + 1;
      k = Math.max(Math.ceil(Math.log2(n)) + 1 > 5 ? 5 : 3, k);
    }
    k = Math.max(1, Math.min(60, Math.floor(k)));
    const w = range / k, bins = [];
    for (let i = 0; i < k; i++) bins.push({ x0: lo + i * w, x1: i === k - 1 ? hi : lo + (i + 1) * w, n: 0, pct: 0 });
    for (const v of y) bins[Math.min(k - 1, Math.floor((v - lo) / w))].n++;
    bins.forEach(b => { b.pct = b.n / n * 100; });
    res.bins = bins; res.width = w;
    return res;
  }
  function ecdf(arr) {
    const s = sortedAsc(clean(arr)), n = s.length; if (!n) return null;
    const p = s.map((_, i) => (i + 1) / n);
    const at = x => { const v = num(x); if (v === null) return null; let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] <= v) lo = m + 1; else hi = m; } return lo / n; };
    return { x: s, p, at, n };
  }
  function boxStats(arr) {
    const s = sortedAsc(clean(arr)), n = s.length; if (!n) return null;
    const q1 = qs(s, 0.25), med = qs(s, 0.5), q3 = qs(s, 0.75), r = q3 - q1;
    const fl = q1 - 1.5 * r, fh = q3 + 1.5 * r;
    const inside = s.filter(v => v >= fl && v <= fh);
    return { n, q1, med, q3, lo: inside[0], hi: inside[inside.length - 1], min: s[0], max: s[n - 1], outliers: s.filter(v => v < fl || v > fh) };
  }

  /* ---------- fechas y agregación ---------- */
  const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function toDate(t) {
    let d = null;
    if (Object.prototype.toString.call(t) === '[object Date]') d = new Date(t.getTime());
    else if (typeof t === 'number') d = Number.isFinite(t) ? new Date(t) : null;
    else if (typeof t === 'string') {
      const s = t.trim(); let m;
      if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) d = new Date(+m[1], +m[2] - 1, +m[3]);
      else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) d = new Date(+m[3], +m[2] - 1, +m[1]);
      else if (/^\d{9,}$/.test(s)) d = new Date(Number(s));
      else { const ms = Date.parse(s); d = Number.isNaN(ms) ? null : new Date(ms); }
    }
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }
  function bucketStart(d, by) {
    const y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
    if (by === 'year') return new Date(y, 0, 1);
    if (by === 'month') return new Date(y, m, 1);
    if (by === 'week') return new Date(y, m, dd - ((d.getDay() + 6) % 7));
    return new Date(y, m, dd);
  }
  function nextBucket(d, by) {
    const y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
    if (by === 'year') return new Date(y + 1, 0, 1);
    if (by === 'month') return new Date(y, m + 1, 1);
    if (by === 'week') return new Date(y, m, dd + 7);
    return new Date(y, m, dd + 1);
  }
  const p2 = n => (n < 10 ? '0' : '') + n;
  function isoWeek(mon) { // mon = lunes de la semana
    const thu = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 3);
    const doy = Math.round((thu - new Date(thu.getFullYear(), 0, 1)) / 864e5);
    return { year: thu.getFullYear(), week: Math.floor(doy / 7) + 1 };
  }
  function bucketInfo(d, by) {
    const y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
    if (by === 'year') return { k: String(y), label: String(y) };
    if (by === 'month') return { k: y + '-' + p2(m + 1), label: monthNames[m] + ' ' + y };
    if (by === 'week') { const w = isoWeek(d); return { k: w.year + '-W' + p2(w.week), label: 'S' + w.week + ' ' + w.year }; }
    return { k: y + '-' + p2(m + 1) + '-' + p2(dd), label: dd + ' ' + monthNames[m] };
  }
  const _aggFns = {
    sum: v => sum(v), mean: v => mean(v), median: v => median(v), min: v => min(v), max: v => max(v),
    count: v => v.length, first: v => v[0], last: v => v[v.length - 1], sd: v => sd(v)
  };
  function aggregate(rows, opts) {
    opts = opts || {};
    const tk = opts.t || 't', vk = opts.v || 'v', by = ['day', 'week', 'month', 'year'].includes(opts.by) ? opts.by : 'day';
    const fn = _aggFns[opts.fn] ? opts.fn : 'sum', keyOpt = opts.key || null;
    if (!Array.isArray(rows)) return [];
    const get = (r, k) => (typeof k === 'function' ? k(r) : (r == null ? undefined : r[k]));
    const m = new Map();
    for (const r of rows) {
      if (r === null || r === undefined) continue;
      const d = toDate(get(r, tk)); if (!d) continue;
      const v = num(get(r, vk));
      if (v === null && fn !== 'count') continue;
      const st = bucketStart(d, by), info = bucketInfo(st, by);
      const key = keyOpt ? get(r, keyOpt) : null;
      const id = info.k + '\u0000' + (key === null || key === undefined ? '' : String(key));
      let e = m.get(id);
      if (!e) { e = { k: info.k, label: info.label, t: st.getTime(), key, vals: [], rows: 0 }; m.set(id, e); }
      if (v !== null) e.vals.push(v);
      e.rows++;
    }
    const out = [];
    m.forEach(e => {
      const v = fn === 'count' ? e.rows : fin(_aggFns[fn](e.vals));
      const o = { k: e.k, label: e.label, t: e.t, v, n: fn === 'count' ? e.rows : e.vals.length };
      if (keyOpt) o.key = e.key;
      out.push(o);
    });
    out.sort((a, b) => a.t - b.t || (String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0));
    return out;
  }
  function groupBy(rows, fnOrKey) {
    const m = new Map(); if (!Array.isArray(rows)) return m;
    const f = typeof fnOrKey === 'function' ? fnOrKey : r => (r == null ? undefined : r[fnOrKey]);
    for (const r of rows) { let k; try { k = f(r); } catch (e) { k = undefined; } if (k === undefined || k === null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  }
  function fillGaps(series, by) {
    if (!Array.isArray(series) || !series.length) return [];
    by = ['day', 'week', 'month', 'year'].includes(by) ? by : 'day';
    const keyed = series.some(s => s && s.key !== undefined);
    const groups = new Map();
    series.forEach(s => { if (!s || !Number.isFinite(s.t)) return; const g = keyed ? String(s.key) : ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); });
    const out = [];
    groups.forEach(list => {
      const have = new Map(list.map(s => [bucketStart(new Date(s.t), by).getTime(), s]));
      const ts = [...have.keys()].sort((a, b) => a - b);
      let d = new Date(ts[0]);
      for (let g = 0; g < 100000 && d.getTime() <= ts[ts.length - 1]; g++) {
        const s = have.get(d.getTime());
        if (s) out.push(s);
        else { const info = bucketInfo(d, by), o = { k: info.k, label: info.label, t: d.getTime(), v: null, n: 0 }; if (keyed) o.key = list[0].key; out.push(o); }
        d = nextBucket(d, by);
      }
    });
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  /* ---------- formato es-CO ---------- */
  function fmtNum(x, dec) {
    const v = num(x); if (v === null) return '—';
    const d = Math.max(0, Math.min(20, dec === undefined || dec === null ? 1 : Math.floor(dec)));
    const s = Math.abs(v).toFixed(d), parts = s.split('.');
    const ent = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return ((v < 0 && /[1-9]/.test(s)) ? '-' : '') + ent + (parts[1] ? ',' + parts[1] : '');
  }
  function fmtPct(x, dec) { const v = num(x); return v === null ? '—' : fmtNum(v, dec === undefined ? 1 : dec) + ' %'; }
  function fmtP(p) {
    const v = num(p); if (v === null) return '—';
    if (v < 0.001) return '<0,001';
    return fmtNum(Math.min(v, 1), 3);
  }

  /* ---------- textos / insights ---------- */
  function describeTrend(arr, opts) {
    opts = opts || {};
    const unit = opts.unit || '', name = opts.name ? opts.name + ': ' : '';
    const y = clean(arr);
    if (y.length < 4) return name + 'Datos insuficientes para evaluar la tendencia.';
    const r = linregIdx(y);
    if (!r || r.p === null) return name + 'Datos insuficientes para evaluar la tendencia.';
    const m = mean(y), rel = m ? r.b / Math.abs(m) * 100 : null;
    const stats = `${pTxt(r.p)}), R²=${fmtNum(r.r2, 2)}`;
    if (r.p >= 0.05) return `${name}Sin tendencia clara (${stats}.`;
    const dir = r.b > 0 ? 'Sube' : 'Baja';
    const mag = unit ? `${fmtNum(Math.abs(r.b), 2)} ${unit}` + (rel !== null ? ` (${fmtNum(Math.abs(rel), 1)} %)` : '') : (rel !== null ? `${fmtNum(Math.abs(rel), 1)} %` : fmtNum(Math.abs(r.b), 2));
    return `${name}${dir} ${mag} por periodo (${stats}.`;
  }
  function describeSummary(arr, opts) {
    opts = opts || {};
    const unit = opts.unit ? ' ' + opts.unit : '', name = opts.name ? opts.name + ': ' : '';
    const s = summary(arr); if (!s) return name + 'Sin datos suficientes.';
    let t = `${name}n=${s.n}; promedio ${fmtNum(s.mean, 2)}${unit}`;
    if (s.sd !== null) t += ` (sd ${fmtNum(s.sd, 2)}${s.cv !== null ? '; CV ' + fmtPct(s.cv * 100, 1) : ''})`;
    t += `; mediana ${fmtNum(s.median, 2)}${unit}; rango ${fmtNum(s.min, 2)} a ${fmtNum(s.max, 2)}${unit}`;
    const o = outliers(arr, { method: 'iqr' });
    if (o.idx.length) t += `; ${o.idx.length} ${o.idx.length === 1 ? 'valor atípico' : 'valores atípicos'}`;
    return t + '.';
  }

  /* ---------- exportación ---------- */
  const S = {
    num, clean, sum, mean, median, variance, sd, min, max, quantile, iqr, mad, cv, skew, kurt, summary,
    outliers, zscores, modZ,
    linreg, polyfit, linregIdx,
    pearson, spearman, corrMatrix, strength, ranks: safe(v => ranks(clean(v))),
    tCdf, tSf2, tInv, fCdf, fSf, chi2Sf, normCdf, normInv, betaInc, gammaLn,
    ttest, anova, kruskal, compareGroups,
    movingAvg, ewma, holt, mannKendall, senSlope, seasonalIndex, cusum, changePoint, forecast, rolling,
    imr, xbarR, capability,
    pareto, histogram, ecdf, boxStats,
    aggregate, groupBy, fillGaps, monthNames, fmtNum, fmtPct, fmtP,
    describeTrend, describeSummary
  };
  // envoltura anti-excepciones: ninguna función pública lanza
  Object.keys(S).forEach(k => {
    if (typeof S[k] !== 'function') return;
    const f = S[k];
    S[k] = function () { try { return f.apply(this, arguments); } catch (e) { return (k === 'clean' || k === 'movingAvg' || k === 'ewma' || k === 'rolling' || k === 'zscores' || k === 'modZ') ? [] : (k.indexOf('fmt') === 0 || k.indexOf('describe') === 0 ? '—' : null); } };
  });

  if (typeof window !== 'undefined') {
    window.App = window.App || {};
    window.App.Stats = S;
  } else {
    globalThis.__Stats = S;
    if (typeof module !== 'undefined' && module.exports) module.exports = S;
  }
})();
