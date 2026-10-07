/* ============================================================
   App.Captura · «Capturar como Excel»
   Hojas de captura (App.Hoja) conectadas a App.S.config['opCaptures_'+tipo].records, con la misma forma que usan las
   pantallas Consumo de agua, Aseos, Recuperación y Programa de trasiego: { id, row:null, source:<hoja>, origin:'Plataforma',
   savedAt, cells:{<índice de columna del Excel>:valor}, revisions:[…] }.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !A.Hoja) return;
  const U = A.Hoja.util;
  const S = () => A.OperationSources;
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const blank = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  const clone = (o) => JSON.parse(JSON.stringify(o == null ? null : o));
  const M = (path, fb) => { try { const v = A.Metas.get(path, fb); return v == null ? fb : v; } catch (e) { return fb; } };
  const r2 = (x) => Math.round(x * 100) / 100;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  /** número desde una celda (acepta «12,5», «#DIV/0!» → null) */
  const N = (v) => {
    if (isNum(v)) return v;
    if (typeof v !== 'string' || !v.trim() || v.startsWith('#')) return null;
    const n = U.parseNum(v);
    return Number.isFinite(n) ? n : null;
  };
  /** fecha-hora normalizada 'YYYY-MM-DDTHH:MM' de una celda (serial de Excel, texto ISO…) o null */
  function fh(v) {
    if (blank(v)) return null;
    let d = null;
    try { d = S().date(v); } catch (e) { d = null; }
    if (typeof d === 'string' && U.RX.fechahora.test(d)) return d;
    if (typeof d === 'string' && U.RX.fecha.test(d)) return d + 'T00:00';
    if (typeof d === 'string') { const p = U.parseFecha(d, 'fechahora'); if (p) return p; }
    return null;
  }
  const isoWeek = (iso) => {
    const ms = U.msDe(iso); if (ms == null) return null;
    const d = new Date(ms); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  };
  const serialDe = (fecha) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || ''); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) + 25569 : null; };

  /* ---------- Catálogos derivados de los datos existentes ---------- */
  function frecuentes(valores, { max = 80, mayus = false } = {}) {
    const m = new Map();
    for (let v of valores) {
      if (blank(v)) continue;
      v = String(v).replace(/\s+/g, ' ').trim();
      if (!v || /^(n\/?a|na|-|#.*)$/i.test(v)) continue;
      const k = U.norm(v), e = m.get(k) || { t: mayus ? v.toUpperCase() : v, n: 0, mejor: 0 };
      e.n++; m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.t.localeCompare(b.t, 'es')).slice(0, max).map((e) => e.t);
  }
  const unirListas = (...ls) => { const vistos = new Set(), out = []; for (const l of ls) for (const v of l) { const k = U.norm(v); if (k && !vistos.has(k)) { vistos.add(k); out.push(v); } } return out; };
  const registros = (tipo, hoja) => { try { return S().records(tipo, hoja) || []; } catch (e) { return []; } };
  const colDe = (tipo, hoja, idxs, o) => frecuentes(registros(tipo, hoja).flatMap((r) => [].concat(idxs).map((i) => r.cells[i])), o);
  const marcas = () => {
    const base = ['ESTANDAR', 'AGUILA LIGHT', 'CLUB COLOMBIA', 'AZTECA', 'AGUILA', 'LIGHT'];
    try { return unirListas(base.slice(0, 4), A.DL.brands(), base.slice(4)); } catch (e) { return base; }
  };
  const CAUSAS = ['ASEO CAMBIO MARCA', 'ASEOS ENTRE TRASIEGOS', 'ATENUACIÓN DE DIACETILO', 'CIP DEL BUFFER', 'DISPONIBILIDAD DE CIP TANQUES', 'DISPONIBILIDAD DE LINEAS', 'FALLA BOMBA TRASIEGO', 'FALLA CENTRIFUGA', 'FALLA DE RECETA TRASIEGO', 'FALLA ELECTRICA O NEUMÁTICA', 'FALLA EN ENFRIADOR', 'FALLA HUMANA', 'FALLA RECETA DE CIP', 'FALTA DE PVPP', 'FALTA DE SILICA', 'FALTA DE SV', 'FILTRACIÓN DE DOS SV NO CONTEMPLADA', 'FV SIN PURGA', 'MANTENIMIENTO SEMANAL', 'MENOR FLUJO DE TRASIEGO', 'PARADA POR BAJA DEMANDA', 'PROYECTOS CAPACITY', 'SIN CUPO EN BUFFER', 'SIN SUMINISTRO AIRE', 'SIN SUMINISTRO DE FRIO', 'SIN SUMINISTRO ENERGIA', 'SIN SUMINISTRO VAPOR', 'SIN SUMINISTRO AGUA', 'TEMPERATURA ALTA PARA TRASIEGO'];
  function causas() {
    try {
      const ref = S().raw('programa')['REFERENCIAS'];
      const l = ref ? ref.rows.map((r) => r.cells[4]).filter((v) => typeof v === 'string' && v.trim().length > 4 && !/^causa/i.test(v)).map((v) => v.trim()) : [];
      if (l.length > 5) return unirListas(l);
    } catch (e) { /* usa la lista de las notas */ }
    return CAUSAS;
  }
  const EQUIPOS = ['FV', 'SV', 'COLECTOR', 'PROPAGADOR', 'CENTRIFUGA', 'RED MOSTO', 'RED TRASIEGO', 'RED COSECHA', 'RED SIEMBRA', 'RED CERVEZA 1', 'RED CERVEZA 2', 'RED CERVEZA 3', 'RED CERVEZA 4', 'TANQUE SILICA'];
  function equiposAseo() {
    let ref = [];
    try {
      const r = S().raw('aseos')['REFERENCIAS'];
      if (r) ref = r.rows.filter((x) => x.row >= 4 && x.row <= 40).map((x) => x.cells[19]).filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
    } catch (e) { ref = []; }
    return unirListas(ref.length > 5 ? ref : EQUIPOS, colDe('aseos', '1. Cada uso', 4, { max: 40, mayus: true }));
  }
  const rojoDe = (f, ctx) => (ctx.rojos || []).some((k) => f[k + '_sem'] === 'bad');

  /* ============================================================
     Definiciones por proceso
     ============================================================ */
  const DEFS = {};

  /* ---------------------------------------------------------- A. Consumo de agua */
  (function () {
    const ord = (h) => (h === '00:00' ? 24 : +h.slice(0, 2));
    const key = (fecha, hora) => (fecha && hora ? fecha + ' ' + pad(ord(hora)) + hora.slice(3) : null);
    const horaFr = (h) => { const m = /^(\d{2}):(\d{2})$/.exec(h || ''); return m ? (+m[1] * 60 + +m[2]) / 1440 : null; };
    const frHora = (v) => {
      if (isNum(v) && v >= 0 && v < 1) { const m = Math.round(v * 1440); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
      if (typeof v === 'string') { const m = /(\d{2}:\d{2})/.exec(v); if (m) return m[1]; const p = U.parseFecha(v, 'hora'); return p || null; }
      return null;
    };
    const diaDe = (v) => { const x = fh(v); return x ? x.slice(0, 10) : null; };
    const CONT = { pisos: 4, cip: 9, gea: 14 };

    function lecturas(hoja, excluir) {
      const out = { pisos: [], cip: [], gea: [] };
      let dia = null;
      for (const r of registros('agua', hoja)) {
        const c = r.cells, d = diaDe(c[1]);
        if (d) dia = d;
        if (r.row != null && r.row < 14) continue;
        if (excluir.has(r.id) || !dia) continue;
        const h = frHora(c[3]); if (!h) continue;
        const k = key(r.origin === 'Plataforma' ? (d || dia) : dia, h);
        for (const [n, i] of Object.entries(CONT)) { const v = N(c[i]); if (isNum(v) && v > 0) out[n].push({ k, v }); }
      }
      return out;
    }
    function previa(contador, k, f, ctx, info) {
      let mejor = null;
      for (const x of ctx.lecturas[contador]) if (x.k < k && (!mejor || x.k > mejor.k)) mejor = x;
      const todas = info.filas();
      todas.forEach((o, j) => {
        if (j === info.i || !o) return;
        const kk = key(o.fecha, o.hora), v = o['lectura' + contador[0].toUpperCase() + contador.slice(1)];
        if (kk && kk < k && isNum(v) && (!mejor || kk > mejor.k)) mejor = { k: kk, v };
      });
      return mejor ? mejor.v : null;
    }
    const consumo = (contador) => (f, ctx, info) => {
      const L = f['lectura' + contador[0].toUpperCase() + contador.slice(1)], k = key(f.fecha, f.hora);
      if (!isNum(L) || !k) return null;
      const p = previa(contador, k, f, ctx, info);
      return p == null ? null : r3(L - p);
    };
    const sum = (f, ks) => ks.reduce((a, k) => a + (isNum(f[k]) ? f[k] : 0), 0);
    const ASEOS = ['utq', 'colector', 'linea', 'desinc', 'otros'];
    const semBandas = (lo, hi, unidad) => (v) => {
      if (!isNum(v)) return null;
      if (v < 0) return ['bad', 'Consumo negativo: la lectura es menor que la anterior. Si se cambió el contador, justifícalo.'];
      return v < lo ? ['ok', 'Dentro de lo esperado (< ' + lo + ' ' + unidad + ')'] : v <= hi ? ['warn', 'Entre ' + lo + ' y ' + hi + ' ' + unidad + ': vigilar'] : ['bad', 'Supera ' + hi + ' ' + unidad + ': justifica la desviación'];
    };
    const filaRoja = (f, ctx) => {
      const lo = M('agua.pisosAlto', 100), g = M('agua.geaAlto', 1000), a = M('agua.aseoM3', 10);
      return (isNum(f.consumoPisos) && (f.consumoPisos < 0 || f.consumoPisos > lo)) || (isNum(f.consumoCip) && f.consumoCip < 0) ||
        (isNum(f.consumoGea) && (f.consumoGea < 0 || f.consumoGea > g)) || (isNum(f.m3Aseo) && f.m3Aseo >= a);
    };

    DEFS.agua = {
      titulo: 'Consumo de agua',
      intro: 'Una fila por lectura de contadores. El consumo se calcula solo contra la lectura anterior. 00:00 cuenta como el cierre del día indicado.',
      hoja: '2026', hojas: null, cadena: true,
      orden: (f) => key(f.fecha, f.hora) || '',
      indices: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      contexto(hoja, mostrados) { const L = lecturas(hoja, mostrados); const todos = [...L.pisos, ...L.cip, ...L.gea].map((x) => x.k).sort(); return { lecturas: L, ultimo: todos.length ? todos[todos.length - 1] : null, claves: new Set(todos) }; },
      nuevaFila(prev, ctx) {
        let k = null;
        for (const o of prev) { const kk = key(o.fecha, o.hora); if (kk && (!k || kk > k)) k = kk; }
        if (ctx.ultimo && (!k || ctx.ultimo > k)) k = ctx.ultimo;
        if (!k) { const d = new Date(); return { fecha: U.ahora('fecha'), hora: d.getHours() < 12 ? '08:00' : d.getHours() < 20 ? '16:00' : '00:00' }; }
        const fecha = k.slice(0, 10), h = k.slice(11, 13);
        if (h === '24') { const d = new Date(fecha + 'T00:00'); d.setDate(d.getDate() + 1); return { fecha: U.toIso(+d).slice(0, 10), hora: '08:00' }; }
        return h < '16' ? { fecha, hora: '16:00' } : { fecha, hora: '00:00' };
      },
      columnas() {
        const med = (k, t, g, u, extra) => Object.assign({ key: k, titulo: t, grupo: g, unidad: u, tipo: 'numero', min: 0 }, extra);
        const calcN = (k, t, g, u, calc, extra) => Object.assign({ key: k, titulo: t, grupo: g, unidad: u, tipo: 'calc', formato: 'numero', calc }, extra);
        const asep = (k, t) => ({ key: k, titulo: t, grupo: 'Aseos del turno (n.º)', tipo: 'numero', min: 0, max: 40, ancho: 78, validar: (v) => (v * 2) % 1 === 0 ? null : 'Usa pasos de 0,5' });
        return [
          { key: 'fecha', titulo: 'Fecha', grupo: 'Turno', tipo: 'fecha', requerido: true, ancho: 104, ayuda: 'Escribe hoy, 7/10 o 2026-10-07 · N = hoy' },
          { key: 'hora', titulo: 'Hora', grupo: 'Turno', tipo: 'hora', requerido: true, ancho: 76, ayuda: '08:00, 16:00 o 00:00 (cierre del día)',
            validar: (v, f, ctx) => { const k = key(f.fecha, v); return k && ctx.claves.has(k) ? 'Ya existe una lectura de esa fecha y hora' : null; } },
          med('lecturaPisos', 'Lectura pisos', 'Pisos', 'm³', { decimales: 0, max: 99999999, requerido: true, ancho: 104, ayuda: 'Lectura acumulada del contador' }),
          calcN('consumoPisos', 'Consumo pisos', 'Pisos', 'm³', consumo('pisos'), { decimales: 0, ancho: 96, semaforo: (v) => semBandas(M('agua.pisosBajo', 60), M('agua.pisosAlto', 100), 'm³')(v) }),
          calcN('hlPisos', 'Pisos', 'Pisos', 'Hl', (f) => (isNum(f.consumoPisos) ? r2(f.consumoPisos * 10) : null), { decimales: 0, ancho: 78 }),
          med('lecturaCip', 'Lectura CIP', 'CIP', 'm³', { decimales: 0, max: 99999999, requerido: true, ancho: 104 }),
          calcN('consumoCip', 'Consumo CIP', 'CIP', 'm³', consumo('cip'), { decimales: 0, ancho: 96, semaforo: (v) => (isNum(v) && v < 0 ? ['bad', 'Consumo negativo: revisa la lectura o el contador'] : null) }),
          calcN('hlCip', 'CIP', 'CIP', 'Hl', (f) => (isNum(f.consumoCip) ? r2(f.consumoCip * 10) : null), { decimales: 0, ancho: 78 }),
          med('lecturaGea', 'Lectura CIP GEA', 'CIP GEA', 'Hl', { decimales: 0, max: 999999999, requerido: true, ancho: 112 }),
          calcN('consumoGea', 'Consumo CIP GEA', 'CIP GEA', 'Hl', consumo('gea'), { decimales: 0, ancho: 104, semaforo: (v) => semBandas(M('agua.geaBajo', 600), M('agua.geaAlto', 1000), 'Hl')(v) }),
          calcN('total', 'Total turno', 'Resultado', 'Hl', (f) => (isNum(f.hlPisos) && isNum(f.hlCip) && isNum(f.consumoGea) ? r2(f.hlPisos + f.hlCip + f.consumoGea) : null), { decimales: 0, ancho: 92 }),
          med('mosto', 'Mosto frío recibido', 'Producción', 'Hl', { decimales: 0, max: 99999, ancho: 112, ayuda: 'Hl de mosto recibidos de cocina en el turno' }),
          med('trasegados', 'Trasegados', 'Producción', 'Hl', { decimales: 0, max: 99999, ancho: 96, ayuda: 'Hl trasegados en el turno (ver Programa de trasiego)' }),
          asep('utq', 'UTQ'), asep('colector', 'Colector'), asep('linea', 'Línea'), asep('desinc', 'Desincr.'), asep('otros', 'Otros'),
          Object.assign(asep('gea', 'GEA'), { grupo: 'Aseos del turno (n.º)' }),
          calcN('totalAseos', 'Total aseos', 'Resultado', '', (f) => r2(sum(f, [...ASEOS, 'gea'])), { ancho: 84 }),
          calcN('m3Aseo', 'm³ agua / aseo', 'Resultado', 'm³', (f) => {
            const n = sum(f, ASEOS);
            if (!isNum(f.consumoCip)) return null;
            if (f.consumoCip === 0) return 'SIN CONSUMO';
            return n > 0 ? r2(f.consumoCip / n) : 'CONSUMO SIN ASEOS';
          }, { decimales: 1, ancho: 118, semaforo: (v) => (isNum(v) ? (v < M('agua.aseoM3', 10) ? ['ok', 'Por debajo de ' + M('agua.aseoM3', 10) + ' m³ por aseo'] : ['bad', 'Igual o mayor que ' + M('agua.aseoM3', 10) + ' m³ por aseo: justifica']) : v === 'CONSUMO SIN ASEOS' ? ['warn', 'Hay consumo de CIP pero no registraste aseos'] : null) }),
          calcN('hlAseoGea', 'Hl / aseo GEA', 'Resultado', 'Hl', (f) => {
            if (!isNum(f.consumoGea)) return null;
            if (f.consumoGea === 0) return 'SIN CONSUMO';
            return isNum(f.gea) && f.gea > 0 ? r2(f.consumoGea / f.gea) : 'CONSUMO SIN ASEOS';
          }, { decimales: 0, ancho: 110 }),
          calcN('eficiencia', 'Hl agua / Hl producido', 'Resultado', 'Hl/Hl', (f) => {
            const den = (isNum(f.mosto) ? f.mosto : 0) + (isNum(f.trasegados) ? f.trasegados : 0);
            return isNum(f.total) && den > 0 ? r3(f.total / den) : null;
          }, { decimales: 2, ancho: 124, ayuda: 'Hl de agua del turno / (Hl de mosto + Hl trasegados)' }),
          { key: 'justificacion', titulo: 'Justificación de la desviación', grupo: 'Control', tipo: 'texto', ancho: 300,
            requerido: (f, ctx) => filaRoja(f, ctx), ayuda: 'Obligatoria cuando algún semáforo está en rojo' },
        ];
      },
      aCelulas(f) {
        const c = {}, set = (i, v) => { if (!blank(v)) c[i] = v; };
        const s = serialDe(f.fecha), hf = horaFr(f.hora);
        set(1, s);
        if (f.fecha) set(2, new Date(f.fecha + 'T12:00').toLocaleDateString('es-CO', { weekday: 'long' }).toLowerCase());
        set(3, hf);
        const hc = hf == null ? null : (hf - 1 / 24 + 1) % 1;
        set(4, f.lecturaPisos); set(5, f.consumoPisos); set(6, f.hlPisos);
        set(8, hc); set(9, f.lecturaCip); set(10, f.consumoCip); set(11, f.hlCip);
        set(13, hc); set(14, f.lecturaGea); set(15, f.consumoGea);
        set(17, f.total); set(18, f.mosto); set(19, f.trasegados);
        [20, 21, 22, 23, 24, 25].forEach((i, j) => set(i, f[[...ASEOS, 'gea'][j]]));
        set(26, f.totalAseos); set(27, f.m3Aseo); set(28, f.hlAseoGea); set(29, f.eficiencia); set(30, f.justificacion);
        return c;
      },
      deRecord(rec) {
        const c = rec.cells;
        return { id: rec.id, fecha: diaDe(c[1]), hora: frHora(c[3]), lecturaPisos: N(c[4]), lecturaCip: N(c[9]), lecturaGea: N(c[14]), mosto: N(c[18]), trasegados: N(c[19]),
          utq: N(c[20]), colector: N(c[21]), linea: N(c[22]), desinc: N(c[23]), otros: N(c[24]), gea: N(c[25]), justificacion: blank(c[30]) ? null : String(c[30]) };
      },
    };
  })();

  /* ---------------------------------------------------------- B. Recuperación de cerveza */
  (function () {
    const REC = [[2, 3, 4, 5, 6], [7, 8, 9, 10, 11], [12, 13, 14, 15, 16], [17, 18, 19, 20, 21]];
    const sumaVol = (f) => [1, 2, 3, 4].reduce((a, n) => a + (isNum(f['vol' + n]) ? f['vol' + n] : 0), 0);
    const horasA = (f) => { const a = U.msDe(f.rec1), b = U.msDe(f.recuperacion); return a != null && b != null ? r2((b - a) / 3600000) : null; };
    DEFS.recuperacion = {
      titulo: 'Recuperación de cerveza',
      intro: 'Una fila por UTK: hasta 4 recolecciones, agua, cierre, retiro y recuperación. Abre «Recolección 2–4» con el triángulo del encabezado.',
      hoja: 'Control Recuperada', cadena: false,
      orden: (f) => f.rec1 || '',
      gruposPlegables: ['Recolección 2', 'Recolección 3', 'Recolección 4'], gruposPlegados: ['Recolección 2', 'Recolección 3', 'Recolección 4'],
      indices: [0, 1, ...Array.from({ length: 22 }, (_, i) => i + 2), 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 53, 54, 55, 56],
      contexto(hoja) {
        const rs = registros('recuperacion', hoja);
        return {
          fvs: unirListas(['COL 1', 'COL 2', 'COL 3', 'COL 4'], colDe('recuperacion', hoja, [3, 8, 13, 18], { max: 60, mayus: true })),
          operarios: colDe('recuperacion', hoja, [30, 32, 43], { max: 60 }), stl: colDe('recuperacion', hoja, 50, { max: 30 }),
          sv: unirListas(colDe('recuperacion', hoja, 41, { max: 40 }), Array.from({ length: 32 }, (_, i) => String(i + 1))),
          marcas: marcas(), consec: rs.reduce((m, r) => Math.max(m, N(r.cells[0]) || 0), 0),
        };
      },
      nuevaFila() { return {}; },
      columnas() {
        const out = [
          { key: 'utk', titulo: 'UTK / colector', grupo: 'Tanque', tipo: 'lista', libre: true, opciones: ['UTK 19', 'UTK 20'], requerido: true, ancho: 112, ayuda: 'UTK donde se recolecta la levadura' },
        ];
        REC.forEach((_, i) => {
          const n = i + 1, g = 'Recolección ' + n;
          out.push(
            { key: 'rec' + n, titulo: 'Fecha y hora', grupo: g, tipo: 'fechahora', requerido: n === 1, ancho: 136, ayuda: 'Escribe 7/10 08:00 o «hoy 14:30» · N = ahora' },
            { key: 'fv' + n, titulo: 'FV / colector origen', grupo: g, tipo: 'lista', libre: true, opciones: (ctx) => ctx.fvs, ancho: 118 },
            { key: 'vol' + n, titulo: 'Levadura', grupo: g, tipo: 'numero', unidad: 'Hl', min: 0, max: 600, decimales: 1, ancho: 84, requerido: (f) => n === 1 },
            { key: 'ph' + n, titulo: 'pH línea cosecha', grupo: g, tipo: 'numero', min: 2, max: 9, decimales: 2, ancho: 92 },
            { key: 'cons' + n, titulo: 'Consistencia', grupo: g, tipo: 'numero', unidad: '%', min: 0, max: 100, decimales: 1, ancho: 96 });
        });
        return out.concat([
          { key: 'totalLev', titulo: 'Levadura total', grupo: 'Agua', tipo: 'calc', formato: 'numero', unidad: 'Hl', decimales: 1, ancho: 96, calc: (f) => (sumaVol(f) > 0 ? r2(sumaVol(f)) : null) },
          { key: 'tqAgua', titulo: 'TQ agua desaireada', grupo: 'Agua', tipo: 'lista', opciones: ['1', '2', '3'], ancho: 96 },
          { key: 'aguaTeo', titulo: 'Agua teórica (50 %)', grupo: 'Agua', tipo: 'calc', formato: 'numero', unidad: 'Hl', decimales: 1, ancho: 104, calc: (f) => (isNum(f.totalLev) ? r2(f.totalLev * 0.5) : null) },
          { key: 'agua', titulo: 'Agua total', grupo: 'Agua', tipo: 'numero', unidad: 'Hl', min: 0, max: 600, decimales: 1, ancho: 84 },
          { key: 'relacion', titulo: 'Agua / levadura', grupo: 'Agua', tipo: 'calc', formato: 'numero', unidad: '%', decimales: 1, ancho: 100, ayuda: 'Verde entre ' + M('recuperacion.aguaMin', 49) + ' y ' + M('recuperacion.aguaMax', 51) + ' %',
            calc: (f) => (isNum(f.totalLev) && f.totalLev > 0 && isNum(f.agua) ? r2((f.agua / f.totalLev) * 100) : null),
            semaforo: (v) => (isNum(v) ? (v >= M('recuperacion.aguaMin', 49) && v <= M('recuperacion.aguaMax', 51) ? ['ok', 'Relación dentro de ' + M('recuperacion.aguaMin', 49) + '–' + M('recuperacion.aguaMax', 51) + ' %'] : ['warn', 'Fuera de ' + M('recuperacion.aguaMin', 49) + '–' + M('recuperacion.aguaMax', 51) + ' %']) : null) },
          { key: 'sumAgua', titulo: 'Suministro de agua', grupo: 'Cierre del UTK', tipo: 'fechahora', ancho: 136 },
          { key: 'presCierre', titulo: 'Presión al cerrar', grupo: 'Cierre del UTK', tipo: 'numero', unidad: 'PSI', min: 0, max: 30, decimales: 2, ancho: 96,
            semaforo: (v) => (isNum(v) ? (v > M('recuperacion.presionMax', 5) ? ['bad', 'Presión mayor que ' + M('recuperacion.presionMax', 5) + ' PSI'] : ['ok', '']) : null) },
          { key: 'tempCierre', titulo: 'Temperatura al cerrar', grupo: 'Cierre del UTK', tipo: 'numero', unidad: '°C', min: -5, max: 40, decimales: 1, ancho: 108 },
          { key: 'opCierre', titulo: 'Operario cierre', grupo: 'Cierre del UTK', tipo: 'lista', libre: true, opciones: (ctx) => ctx.operarios, ancho: 130 },
          { key: 'retiro', titulo: 'Retiro de levadura', grupo: 'Retiro', tipo: 'fechahora', ancho: 136 },
          { key: 'opRetiro', titulo: 'Operario retiro', grupo: 'Retiro', tipo: 'lista', libre: true, opciones: (ctx) => ctx.operarios, ancho: 130 },
          { key: 'fmax', titulo: 'Fecha máxima de recuperación', grupo: 'Recuperación', tipo: 'calc', formato: 'fechahora', ancho: 150, ayuda: 'Primera recolección + ' + M('recuperacion.maximoH', 96) + ' h',
            calc: (f) => { const a = U.msDe(f.rec1); return a == null ? null : U.toIso(a + M('recuperacion.maximoH', 96) * 3600000); } },
          { key: 'recuperacion', titulo: 'Fecha y hora recuperación', grupo: 'Recuperación', tipo: 'fechahora', ancho: 150,
            validar: (v, f) => { const a = U.msDe(f.rec1), b = U.msDe(v); return a != null && b != null && b < a ? 'La recuperación es anterior a la primera recolección' : null; } },
          { key: 'semana', titulo: 'Semana', grupo: 'Recuperación', tipo: 'calc', formato: 'numero', decimales: 0, ancho: 70, calc: (f) => (f.recuperacion ? isoWeek(f.recuperacion) : null) },
          { key: 'horas', titulo: 'Horas hasta recuperar', grupo: 'Recuperación', tipo: 'calc', formato: 'numero', unidad: 'h', decimales: 1, ancho: 108,
            calc: (f) => horasA(f),
            semaforo: (v) => (isNum(v) ? (v < 0 ? ['bad', 'Fechas en desorden'] : v > M('recuperacion.maximoH', 96) ? ['bad', 'Pasó el máximo de ' + M('recuperacion.maximoH', 96) + ' h'] : v > M('recuperacion.objetivoH', 72) ? ['warn', 'Entre ' + M('recuperacion.objetivoH', 72) + ' y ' + M('recuperacion.maximoH', 96) + ' h: recuperar pronto'] : ['ok', 'Dentro del objetivo de ' + M('recuperacion.objetivoH', 72) + ' h']) : null) },
          { key: 'volRec', titulo: 'Volumen recuperado', grupo: 'Recuperación', tipo: 'numero', unidad: 'Hl', min: 0, max: 800, decimales: 1, ancho: 100, requerido: (f) => !!f.recuperacion },
          { key: 'presRec', titulo: 'Presión al recuperar', grupo: 'Recuperación', tipo: 'numero', unidad: 'PSI', min: 0, max: 30, decimales: 2, ancho: 100,
            semaforo: (v) => (isNum(v) ? (v > M('recuperacion.presionMax', 5) ? ['bad', 'Presión mayor que ' + M('recuperacion.presionMax', 5) + ' PSI'] : ['ok', '']) : null) },
          { key: 'tempRec', titulo: 'Temperatura cerveza recuperada', grupo: 'Recuperación', tipo: 'numero', unidad: '°C', min: -5, max: 40, decimales: 1, ancho: 120,
            semaforo: (v) => (isNum(v) ? (v > M('recuperacion.tempMax', 2) ? ['bad', 'Temperatura mayor que ' + M('recuperacion.tempMax', 2) + ' °C'] : ['ok', '']) : null) },
          { key: 'sv', titulo: 'SV destino', grupo: 'Destino', tipo: 'lista', libre: true, opciones: (ctx) => ctx.sv, ancho: 88, requerido: (f) => !!f.recuperacion },
          { key: 'consSv', titulo: 'Consecutivo SV', grupo: 'Destino', tipo: 'texto', ancho: 100, ayuda: 'Ejemplo: M24 o F593' },
          { key: 'opRec', titulo: 'Operario responsable', grupo: 'Destino', tipo: 'lista', libre: true, opciones: (ctx) => ctx.operarios, ancho: 130 },
          { key: 'marca', titulo: 'Marca destino', grupo: 'Destino', tipo: 'lista', libre: true, opciones: (ctx) => ctx.marcas, ancho: 126, requerido: (f) => !!f.recuperacion },
          { key: 'extracto', titulo: 'Extracto original', grupo: 'Calidad', tipo: 'numero', unidad: '°P', min: 3, max: 25, decimales: 2, ancho: 96 },
          { key: 'consFinal', titulo: 'Consistencia', grupo: 'Calidad', tipo: 'numero', unidad: '%', min: 0, max: 100, decimales: 1, ancho: 92 },
          { key: 'phFinal', titulo: 'pH al terminar descarte', grupo: 'Calidad', tipo: 'numero', min: 2, max: 9, decimales: 2, ancho: 112,
            semaforo: (v) => (isNum(v) ? (v > M('recuperacion.phMax', 5.35) ? ['bad', 'pH mayor que ' + M('recuperacion.phMax', 5.35) + ' (objetivo ' + M('recuperacion.phObjetivo', 4.4) + ')'] : ['ok', '']) : null) },
          { key: 'filtracion', titulo: 'Inicio de filtración', grupo: 'Calidad', tipo: 'fechahora', ancho: 136 },
          { key: 'sensorial', titulo: 'Sensorial', grupo: 'Calidad', tipo: 'lista', opciones: ['OK', 'NO OK'], ancho: 90 },
          { key: 'stl', titulo: 'STL que prueba', grupo: 'Calidad', tipo: 'lista', libre: true, opciones: (ctx) => ctx.stl, ancho: 100 },
          { key: 'hl95', titulo: 'Hl a 9,5 °P', grupo: 'Indicador de ahorro', tipo: 'calc', formato: 'numero', unidad: 'Hl', decimales: 1, ancho: 96, ayuda: 'hl × (E·260/(260−E)) / (9,5·260/250,5)',
            calc: (f) => (isNum(f.volRec) && isNum(f.extracto) && f.extracto < 260 ? r2(f.volRec * ((f.extracto * 260) / (260 - f.extracto)) / ((9.5 * 260) / 250.5)) : null) },
          { key: 'kg', titulo: 'kg recuperados', grupo: 'Indicador de ahorro', tipo: 'calc', formato: 'numero', unidad: 'kg', decimales: 0, ancho: 100, calc: (f) => (isNum(f.hl95) ? r2(f.hl95 * 9.86) : null) },
          { key: 'comentarios', titulo: 'Comentarios', grupo: 'Calidad', tipo: 'texto', ancho: 240 },
        ]);
      },
      aCelulas(f, ctx, previas) {
        const c = {}, set = (i, v) => { if (!blank(v)) c[i] = v; };
        const num = (v) => (v != null && /^\d+$/.test(String(v)) ? Number(v) : v);
        previas && previas[0] != null ? set(0, previas[0]) : set(0, ctx.consec + 1);
        set(1, f.utk);
        REC.forEach((ix, i) => { const n = i + 1; set(ix[0], f['rec' + n]); set(ix[1], f['fv' + n]); set(ix[2], f['vol' + n]); set(ix[3], f['ph' + n]); set(ix[4], f['cons' + n]); });
        set(22, f.totalLev); set(23, num(f.tqAgua)); set(24, f.aguaTeo); set(25, f.agua); set(26, f.relacion); set(27, f.sumAgua);
        set(28, f.presCierre); set(29, f.tempCierre); set(30, f.opCierre); set(31, f.retiro); set(32, f.opRetiro); set(33, f.fmax); set(34, f.recuperacion);
        set(35, f.semana); set(36, f.semana === 52 ? 0 : f.semana); set(37, f.horas); set(38, f.volRec); set(39, f.presRec); set(40, f.tempRec);
        set(41, num(f.sv)); set(42, f.consSv); set(43, f.opRec); set(44, f.marca); set(45, f.extracto); set(46, f.consFinal); set(47, f.phFinal);
        set(48, f.filtracion); set(49, f.sensorial); set(50, f.stl); set(51, f.comentarios);
        set(53, f.volRec); set(54, f.extracto); set(55, f.hl95); set(56, f.kg);
        return c;
      },
      deRecord(rec) {
        const c = rec.cells, f = { id: rec.id, utk: blank(c[1]) ? null : String(c[1]) };
        REC.forEach((ix, i) => { const n = i + 1; f['rec' + n] = fh(c[ix[0]]); f['fv' + n] = blank(c[ix[1]]) ? null : String(c[ix[1]]); f['vol' + n] = N(c[ix[2]]); f['ph' + n] = N(c[ix[3]]); f['cons' + n] = N(c[ix[4]]); });
        Object.assign(f, { tqAgua: blank(c[23]) ? null : String(c[23]), agua: N(c[25]), sumAgua: fh(c[27]), presCierre: N(c[28]), tempCierre: N(c[29]), opCierre: c[30] || null, retiro: fh(c[31]), opRetiro: c[32] || null,
          recuperacion: fh(c[34]), volRec: N(c[38]), presRec: N(c[39]), tempRec: N(c[40]), sv: blank(c[41]) ? null : String(c[41]), consSv: c[42] || null, opRec: c[43] || null, marca: c[44] || null,
          extracto: N(c[45]), consFinal: N(c[46]), phFinal: N(c[47]), filtracion: fh(c[48]), sensorial: c[49] || null, stl: c[50] || null, comentarios: c[51] || null });
        return f;
      },
    };
  })();

  /* ---------------------------------------------------------- C. Programa de trasiego */
  (function () {
    const esCip = (p) => /^\s*CIP/i.test(p || '');
    DEFS.programa = {
      titulo: 'Programa de trasiego',
      intro: 'Una fila por actividad (trasiego o CIP). El plan se encadena solo: inicio = fin del anterior + holgura; puedes escribir encima de un horario y Supr lo restablece.',
      hoja: 'CONTROL TRASIEGO', cadena: true,
      orden: (f) => f.inicioReal || f.inicioPlan || '',
      indices: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11],
      contexto(hoja, mostrados) {
        let baseFin = null, ms = -1;
        for (const r of registros('programa', hoja)) {
          if (mostrados.has(r.id)) continue;
          const f = fh(r.cells[5]); const t = f ? U.msDe(f) : null;
          if (t != null && t > ms) { ms = t; baseFin = f; }
        }
        const procesos = unirListas(colDe('programa', hoja, 1, { max: 45, mayus: true }), ['CIP CENTRIFUGA RECETA 40', 'CIP CENTRIFUGA RECETA 60', 'CIP RED TRASIEGO']);
        return { baseFin, procesos, marcas: unirListas(colDe('programa', hoja, 2, { max: 12, mayus: true }), ['ESTANDAR', 'AGUILA LIGHT', 'CLUB COLOMBIA', 'AZTECA']), causas: causas(), svs: Array.from({ length: 32 }, (_, i) => String(i + 1)) };
      },
      nuevaFila() { return {}; },
      columnas() {
        const plan = M('trasiego.holguraH', 1);
        return [
          { key: 'proceso', titulo: 'Proceso', grupo: 'Actividad', tipo: 'lista', libre: true, opciones: (ctx) => ctx.procesos, ancho: 260, requerido: true, ayuda: 'Elige uno de los habituales o escribe uno nuevo (Enter dos veces lo agrega)' },
          { key: 'marca', titulo: 'Marca', grupo: 'Actividad', tipo: 'lista', libre: true, opciones: (ctx) => ctx.marcas, ancho: 124, requerido: (f) => !esCip(f.proceso) && !!f.proceso },
          { key: 'sv', titulo: 'SV destino', grupo: 'Actividad', tipo: 'lista', libre: true, opciones: (ctx) => ctx.svs, ancho: 90, ayuda: 'Tanque madurador de destino (1–32)' },
          { key: 'inicioPlan', titulo: 'Inicio plan', grupo: 'Plan', tipo: 'calc', anulable: true, formato: 'fechahora', ancho: 138, ayuda: 'Fin del anterior + ' + plan + ' h',
            calc: (f, ctx, info) => {
              const base = info.prev && info.prev.finPlan ? info.prev.finPlan : info.i === 0 ? ctx.baseFin : null;
              const ms = U.msDe(base);
              return ms == null ? null : U.toIso(ms + M('trasiego.holguraH', 1) * 3600000);
            } },
          { key: 'finPlan', titulo: 'Fin plan', grupo: 'Plan', tipo: 'calc', anulable: true, formato: 'fechahora', ancho: 138, ayuda: 'Inicio + ' + M('trasiego.trasiegoH', 8.5) + ' h (trasiego) o + ' + M('trasiego.cipCentrifugaH', 2.5) + ' h (CIP)',
            calc: (f) => { const ms = U.msDe(f.inicioPlan); if (ms == null || !f.proceso) return null; return U.toIso(ms + (esCip(f.proceso) ? M('trasiego.cipCentrifugaH', 2.5) : M('trasiego.trasiegoH', 8.5)) * 3600000); } },
          { key: 'inicioReal', titulo: 'Inicio real', grupo: 'Ejecución', tipo: 'fechahora', ancho: 138, ayuda: 'N = ahora' },
          { key: 'finReal', titulo: 'Fin real', grupo: 'Ejecución', tipo: 'fechahora', ancho: 138,
            validar: (v, f) => { const a = U.msDe(f.inicioReal), b = U.msDe(v); return a != null && b != null && b < a ? 'El fin real es anterior al inicio real' : null; } },
          { key: 'desvio', titulo: 'Desvío vs. plan', grupo: 'Ejecución', tipo: 'calc', formato: 'numero', unidad: 'h', decimales: 2, ancho: 104, ayuda: 'Fin real − fin plan, en horas',
            calc: (f) => { const a = U.msDe(f.finReal), b = U.msDe(f.finPlan); return a != null && b != null ? r2((a - b) / 3600000) : null; },
            semaforo: (v) => (isNum(v) ? (v <= 0 ? ['ok', 'A tiempo o antes del plan'] : v <= M('trasiego.desvioMaxH', 1) ? ['warn', 'Retraso dentro de ' + M('trasiego.desvioMaxH', 1) + ' h'] : ['bad', 'Retraso mayor que ' + M('trasiego.desvioMaxH', 1) + ' h: indica la causa']) : null) },
          { key: 'causa', titulo: 'Causa del desvío', grupo: 'Desvío', tipo: 'lista', libre: true, opciones: (ctx) => ctx.causas, ancho: 250,
            requerido: (f) => isNum(f.desvio) && f.desvio > M('trasiego.desvioMaxH', 1), ayuda: 'Obligatoria si el retraso supera ' + M('trasiego.desvioMaxH', 1) + ' h' },
          { key: 'comentarios', titulo: 'Comentarios', grupo: 'Desvío', tipo: 'texto', ancho: 260 },
        ];
      },
      aCelulas(f) {
        const c = {}, set = (i, v) => { if (!blank(v)) c[i] = v; };
        set(1, f.proceso); set(2, f.marca); set(3, f.sv != null && /^\d+$/.test(f.sv) ? Number(f.sv) : f.sv);
        set(4, f.inicioPlan); set(5, f.finPlan); set(6, f.inicioReal); set(7, f.finReal); set(9, f.desvio); set(10, f.causa); set(11, f.comentarios);
        return c;
      },
      deRecord(rec) {
        const c = rec.cells;
        return { id: rec.id, proceso: c[1] || null, marca: c[2] || null, sv: blank(c[3]) ? null : String(c[3]), inicioPlan: fh(c[4]), finPlan: fh(c[5]), inicioReal: fh(c[6]), finReal: fh(c[7]),
          causa: c[10] || null, comentarios: c[11] || null };
      },
    };
  })();

  /* ---------------------------------------------------------- D. Aseos */
  (function () {
    const kind = (e) => { e = String(e || '').toUpperCase().trim(); return /^CENTRIFUGA/.test(e) ? 'CENT' : /^FV\b/.test(e) ? 'FV' : /^SV\b/.test(e) ? 'SV' : /^RED MOSTO/.test(e) ? 'MOSTO' : 'OTRO'; };
    const inR = (v, a, b) => isNum(v) && v >= a && v <= b;
    const concSoda = (f) => (isNum(f.sodaCond) && f.sodaCond > 0 ? r2((f.sodaCond + 2.4968) / 56.636) : null);
    const concTri = (f) => (isNum(f.triCond) && f.triCond > 0 ? r2((f.triCond - 1.2316) / 14.703) : null);
    /** criterios simplificados de cumplimiento (hoja «1. Cada uso»): 7 criterios de 1/7 */
    function criterios(f) {
      const k = kind(f.equipo), fvsv = k === 'FV' || k === 'SV';
      const tSoda = k === 'FV' ? [30, 40] : k === 'SV' ? [14, 40] : k === 'MOSTO' ? [30, 48] : k === 'CENT' ? [30, 69] : [30, 40];
      return {
        sodaConc: inR(concSoda(f), fvsv ? 0.7 : 1.73, fvsv ? 1.05 : 2.1),
        sodaTiempo: inR(f.sodaTiempo, tSoda[0], tSoda[1]),
        sodaTemp: k === 'CENT' ? inR(f.sodaTemp, 79, 81) : inR(f.sodaTemp, 20, 26),
        triConc: inR(concTri(f), 1.4, 1.6),
        triTemp: inR(f.triTemp, 20, 25),
        triTiempo: k === 'CENT' ? (blank(f.triTiempo) || inR(f.triTiempo, 10, 40)) : inR(f.triTiempo, 30, 40),
        estados: f.sodaEstado === 'L' && f.triEstado === 'L' && f.apariencia === 'L',
      };
    }
    const sem = (clave, texto) => (v, f) => { if (!isNum(v)) return null; const ok = criterios(f)[clave]; return ok ? ['ok', ''] : ['warn', texto]; };
    const LNL = ['L', 'NL'];

    DEFS.aseosCadaUso = {
      titulo: 'Aseos · 1. Cada uso',
      intro: 'Una fila por aseo. La concentración y el cumplimiento se calculan con la conductividad y los rangos de las especificaciones (versión simplificada: revísalos en Metas).',
      hoja: '1. Cada uso', cadena: false,
      orden: (f) => f.inicio || '',
      indices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
      contexto(hoja) { return { equipos: equiposAseo(), operarios: colDe('aseos', hoja, 28, { max: 120 }), stl: colDe('aseos', hoja, 29, { max: 30, mayus: true }) }; },
      nuevaFila() { return {}; },
      columnas() {
        const n = (k, t, g, u, extra) => Object.assign({ key: k, titulo: t, grupo: g, unidad: u, tipo: 'numero', min: 0, ancho: 92 }, extra);
        return [
          { key: 'inicio', titulo: 'Inicio', grupo: 'Aseo', tipo: 'fechahora', requerido: true, ancho: 138, ayuda: 'N = ahora · también «14:30» o «7/10 08:00»' },
          { key: 'fin', titulo: 'Fin', grupo: 'Aseo', tipo: 'fechahora', ancho: 138,
            validar: (v, f) => { const a = U.msDe(f.inicio), b = U.msDe(v); return a != null && b != null && b < a ? 'El fin es anterior al inicio' : null; } },
          { key: 'duracion', titulo: 'Duración', grupo: 'Aseo', tipo: 'calc', formato: 'numero', unidad: 'min', decimales: 0, ancho: 84, calc: (f) => { const a = U.msDe(f.inicio), b = U.msDe(f.fin); return a != null && b != null && b >= a ? Math.round((b - a) / 60000) : null; } },
          { key: 'semana', titulo: 'Semana', grupo: 'Aseo', tipo: 'calc', formato: 'numero', decimales: 0, ancho: 70, calc: (f) => (f.inicio ? isoWeek(f.inicio) : null) },
          { key: 'equipo', titulo: 'Equipo', grupo: 'Aseo', tipo: 'lista', libre: true, opciones: (ctx) => ctx.equipos, requerido: true, ancho: 190, ayuda: 'Elige de la lista; un valor nuevo pide confirmación' },
          { key: 'num', titulo: '#', grupo: 'Aseo', tipo: 'numero', decimales: 0, min: 1, max: 40, ancho: 60, ayuda: 'Número de FV, SV o colector' },
          { key: 'vapor', titulo: 'Paso de vapor aireador', grupo: 'Aseo', tipo: 'calc', formato: 'texto', ancho: 120, calc: (f) => (f.equipo ? (String(f.equipo).toUpperCase() === 'RED MOSTO' ? 'SI' : 'N/A') : null) },
          { key: 'cumple', titulo: 'Cumplimiento de parámetros', grupo: 'Aseo', tipo: 'calc', formato: 'numero', porcentaje: true, ancho: 120, ayuda: 'Promedio de 7 criterios (soda, tiempos, temperaturas, trimeta, estados)',
            calc: (f) => {
              if (!f.equipo || [f.sodaCond, f.sodaTiempo, f.sodaTemp, f.triCond, f.triTemp, f.triTiempo].every((v) => !isNum(v))) return null;
              const c = criterios(f); return r2(Object.values(c).filter(Boolean).length / 7);
            },
            semaforo: (v) => (isNum(v) ? (v >= 0.9 ? ['ok', 'Cumple (≥ 90 %)'] : v >= 0.7 ? ['warn', 'Cumplimiento parcial'] : ['bad', 'Cumplimiento bajo']) : null) },
          { key: 'pre', titulo: 'Preenjuague', grupo: 'Soda cáustica', tipo: 'sino', ancho: 90 },
          { key: 'sodaConc', titulo: 'Concentración', grupo: 'Soda cáustica', tipo: 'calc', formato: 'numero', unidad: '%', decimales: 2, ancho: 100, ayuda: '(conductividad + 2,4968) / 56,636',
            calc: concSoda, semaforo: sem('sodaConc', 'Fuera del rango de concentración de soda para este equipo') },
          n('sodaCond', 'Conductividad', 'Soda cáustica', 'mS', { max: 200, decimales: 1 }),
          n('sodaTiempo', 'Tiempo', 'Soda cáustica', 'min', { max: 240, decimales: 0, semaforo: sem('sodaTiempo', 'Fuera del tiempo de contacto para este equipo') }),
          n('sodaTemp', 'Temperatura', 'Soda cáustica', '°C', { max: 100, decimales: 1, semaforo: sem('sodaTemp', 'Fuera de la temperatura esperada') }),
          { key: 'sodaEstado', titulo: 'Estado solución', grupo: 'Soda cáustica', tipo: 'lista', opciones: LNL, ancho: 90, ayuda: 'L = limpia · NL = no limpia' },
          n('sodaEnj', 'Tiempo enjuague', 'Soda cáustica', 'min', { max: 120, decimales: 0 }),
          { key: 'triConc', titulo: 'Concentración', grupo: 'Trimeta', tipo: 'calc', formato: 'numero', unidad: '%', decimales: 2, ancho: 100, ayuda: '(conductividad − 1,2316) / 14,703',
            calc: concTri, semaforo: sem('triConc', 'Fuera de 1,4–1,6 %') },
          n('triCond', 'Conductividad', 'Trimeta', 'mS', { max: 200, decimales: 1 }),
          n('triTemp', 'Temperatura', 'Trimeta', '°C', { max: 100, decimales: 1, semaforo: sem('triTemp', 'Fuera de 20–25 °C') }),
          n('triTiempo', 'Tiempo', 'Trimeta', 'min', { max: 240, decimales: 0, semaforo: sem('triTiempo', 'Fuera del tiempo de contacto de trimeta') }),
          { key: 'triEstado', titulo: 'Estado solución', grupo: 'Trimeta', tipo: 'lista', opciones: LNL, ancho: 90 },
          n('triEnj', 'Tiempo enjuague', 'Trimeta', 'min', { max: 120, decimales: 0 }),
          n('ph', 'pH final', 'Enjuague final', '', { min: 0, max: 14, decimales: 1, ancho: 80, ayuda: 'Esperado ' + M('aseos.phMin', 6) + '–' + M('aseos.phMax', 8),
            semaforo: (v) => (isNum(v) ? (v >= M('aseos.phMin', 6) && v <= M('aseos.phMax', 8) ? ['ok', ''] : ['bad', 'pH fuera de ' + M('aseos.phMin', 6) + '–' + M('aseos.phMax', 8)]) : null) }),
          n('flujo', 'Flujo', 'Enjuague final', 'Hl/h', { max: 3000, decimales: 0, ancho: 88 }),
          { key: 'apariencia', titulo: 'Apariencia', grupo: 'Enjuague final', tipo: 'lista', opciones: LNL, ancho: 92 },
          { key: 'metil', titulo: 'Metil naranja', grupo: 'Enjuague final', tipo: 'lista', opciones: ['OK', 'NO OK'], ancho: 100 },
          n('lumYpt', 'Luminometría YPT', 'Luminometría', 'RLU', { max: 100000, decimales: 0, ancho: 110 }),
          n('lumToma', 'Luminometría tomamuestras', 'Luminometría', 'RLU', { max: 100000, decimales: 0, ancho: 130 }),
          { key: 'operario', titulo: 'Operario', grupo: 'Responsables', tipo: 'lista', libre: true, opciones: (ctx) => ctx.operarios, ancho: 150, ayuda: 'Se autocompleta con los nombres ya usados' },
          { key: 'stl', titulo: 'STL', grupo: 'Responsables', tipo: 'lista', libre: true, opciones: (ctx) => ctx.stl, ancho: 80 },
          { key: 'bio', titulo: 'Muestra biológica', grupo: 'Responsables', tipo: 'sino', ancho: 100 },
          { key: 'comentarios', titulo: 'Comentarios', grupo: 'Responsables', tipo: 'texto', ancho: 260 },
        ];
      },
      aCelulas(f) {
        const c = {}, set = (i, v) => { if (!blank(v)) c[i] = v; };
        set(1, f.inicio); set(2, f.fin); set(3, f.semana); set(4, f.equipo); set(5, f.num); set(6, f.vapor); set(7, f.cumple); set(8, f.pre);
        set(9, f.sodaConc); set(10, f.sodaCond); set(11, f.sodaTiempo); set(12, f.sodaTemp); set(14, f.sodaEstado); set(15, f.sodaEnj);
        set(16, f.triConc); set(17, f.triCond); set(18, f.triTemp); set(19, f.triTiempo); set(20, f.triEstado); set(21, f.triEnj);
        set(22, f.ph); set(23, f.flujo); set(24, f.apariencia); set(25, f.metil); set(26, f.lumYpt); set(27, f.lumToma);
        set(28, f.operario); set(29, f.stl); set(30, f.bio); set(31, f.comentarios);
        return c;
      },
      deRecord(rec) {
        const c = rec.cells, t = (i) => (blank(c[i]) ? null : String(c[i]).trim());
        const sn = (i) => { const v = (t(i) || '').toUpperCase(); return v === 'SI' || v === 'SÍ' ? 'SI' : v === 'NO' ? 'NO' : null; };
        return { id: rec.id, inicio: fh(c[1]), fin: fh(c[2]), equipo: t(4), num: N(c[5]), pre: sn(8), sodaCond: N(c[10]), sodaTiempo: N(c[11]), sodaTemp: N(c[12]), sodaEstado: t(14), sodaEnj: N(c[15]),
          triCond: N(c[17]), triTemp: N(c[18]), triTiempo: N(c[19]), triEstado: t(20), triEnj: N(c[21]), ph: N(c[22]), flujo: N(c[23]), apariencia: t(24), metil: t(25), lumYpt: N(c[26]), lumToma: N(c[27]),
          operario: t(28), stl: t(29), bio: sn(30), comentarios: t(31) };
      },
    };
  })();

  /* ---------- Hojas de aseo genéricas: grilla generada desde el esquema ---------- */
  function defGenerica(tipo, hoja) {
    const sch = S().schema(tipo, hoja);
    const SKIP = /cumplimiento|d[ií]as (restantes|faltantes)|diferencia|^estado$|^semana$|^consecutivo$/i;
    const cols = sch.cols.filter((c) => !/^Columna/.test(c.label) && !SKIP.test(c.label.trim()));
    const prior = sch.sheet.rows.find((r) => r.row === sch.header - 1);
    const starts = Object.entries((prior && prior.cells) || {}).filter(([, v]) => typeof v === 'string' && v.length < 65).map(([i, label]) => ({ i: +i, label })).sort((a, b) => a.i - b.i);
    const grupoDe = (i) => { const g = starts.filter((s) => s.i <= i).pop(); return g ? g.label.replace(/\s+/g, ' ').trim() : 'Registro'; };
    const infer = (c) => {
      const l = c.label;
      if (/fecha/i.test(l)) return 'fechahora';
      if (/comentario|observaci|causa|raz[oó]n|motivo|verificaci/i.test(l)) return 'texto';
      if (/\bL ?- ?NL\b|apariencia|estado de la soluci/i.test(l)) return 'ln';
      if (/sensorial/i.test(l)) return 'bnb';
      if (/metil/i.test(l)) return 'okno';
      if (/\bSI ?\/ ?NO\b|preenjuague|muestra biol|paso de vapor|aireador/i.test(l)) return 'sino';
      if (/operario|responsable|persona|ejecuci[oó]n|^stl|recibe|env[ií]a|\bbts\b/i.test(l)) return 'persona';
      if (/concentraci|conductiv|tiempo|temperatura|^ph|\bph\b|flujo|caudal|volumen|luminom|medici[oó]n|cantidad|presi[oó]n/i.test(l)) return 'numero';
      if (/equipo|tanque|tinas|red de|tipo|sustancia|filtro/i.test(l)) return 'equipo';
      return 'texto';
    };
    const info = cols.map((c) => ({ c, t: infer(c) }));
    return {
      titulo: 'Aseos · ' + hoja.trim(), intro: 'Hoja generada desde las columnas del Excel «' + hoja.trim() + '». Se guardan en las mismas posiciones de columna.', hoja, cadena: false, generica: true,
      orden: (f) => { const d = info.find((x) => x.t === 'fechahora'); return d ? f['c' + d.c.i] || '' : ''; },
      indices: info.map((x) => x.c.i),
      contexto() {
        const out = { listas: {} };
        info.forEach((x) => { if (x.t === 'persona' || x.t === 'equipo') out.listas[x.c.i] = colDe(tipo, hoja, x.c.i, { max: 120, mayus: x.t === 'equipo' }); });
        return out;
      },
      nuevaFila() { return {}; },
      columnas() {
        let primera = true;
        return info.map(({ c, t }) => {
          const base = { key: 'c' + c.i, titulo: c.label.trim(), grupo: grupoDe(c.i), ancho: 110 };
          if (t === 'fechahora') { const r = primera; primera = false; return Object.assign(base, { tipo: 'fechahora', ancho: 138, requerido: r && /inicio|aseo|realiz/i.test(c.label) && !/program|propuest/i.test(c.label) }); }
          if (t === 'texto') return Object.assign(base, { tipo: 'texto', ancho: /comentario|observ/i.test(c.label) ? 240 : 140 });
          if (t === 'ln') return Object.assign(base, { tipo: 'lista', opciones: ['L', 'NL', 'B'], ancho: 90 });
          if (t === 'bnb') return Object.assign(base, { tipo: 'lista', opciones: ['B', 'NB'], ancho: 80 });
          if (t === 'okno') return Object.assign(base, { tipo: 'lista', opciones: ['OK', 'NO OK'], ancho: 90 });
          if (t === 'sino') return Object.assign(base, { tipo: 'sino', ancho: 90 });
          if (t === 'persona' || t === 'equipo') return Object.assign(base, { tipo: 'lista', libre: true, opciones: (ctx) => ctx.listas[c.i] || [], ancho: t === 'equipo' ? 190 : 150 });
          return Object.assign(base, { tipo: 'numero', min: 0, max: /ph/i.test(c.label) ? 14 : 1e7, ancho: 96 });
        });
      },
      aCelulas(f) { const c = {}; info.forEach(({ c: col }) => { const v = f['c' + col.i]; if (!blank(v)) c[col.i] = v; }); return c; },
      deRecord(rec) {
        const f = { id: rec.id };
        info.forEach(({ c, t }) => {
          const v = rec.cells[c.i];
          f['c' + c.i] = blank(v) ? null : t === 'fechahora' ? fh(v) : t === 'numero' ? N(v) : t === 'sino' ? ({ SI: 'SI', 'SÍ': 'SI', NO: 'NO' }[String(v).trim().toUpperCase()] || null) : String(v).trim();
        });
        return f;
      },
    };
  }

  /* ============================================================
     Motor de guardado / panel
     ============================================================ */
  let panel = null;

  function toast(texto, accion) {
    document.querySelectorAll('.cap-toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'cap-toast'; t.setAttribute('role', 'status');
    t.innerHTML = '<span>' + esc(texto) + '</span>' + (accion ? '<button type="button">' + esc(accion.texto) + '</button>' : '');
    document.body.appendChild(t);
    let timer = setTimeout(() => t.remove(), accion ? 12000 : 4000);
    if (accion) t.querySelector('button').addEventListener('click', async () => { clearTimeout(timer); t.remove(); await accion.fn(); });
    return t;
  }

  function resolverDef(tipo, hoja) {
    if (tipo === 'agua') return DEFS.agua;
    if (tipo === 'recuperacion') return DEFS.recuperacion;
    if (tipo === 'programa') return DEFS.programa;
    if (tipo === 'aseos') return hoja === '1. Cada uso' || !hoja ? DEFS.aseosCadaUso : defGenerica('aseos', hoja);
    return null;
  }
  const hojaPrincipal = (tipo) => (tipo === 'aseos' ? '1. Cada uso' : S().defs[tipo].main);
  const ruta = { agua: 'agua', aseos: 'aseos', recuperacion: 'recuperacion', programa: 'programa' };

  function hojasDe(tipo) {
    if (tipo !== 'aseos') return [hojaPrincipal(tipo)];
    const orden = ['1. Cada uso', '2. Semanal', '3. Mensual', '4. Desincrustaciones', '5. CIP del CIP', '6. Filtros', '07. Tinas', '07.Tinas', '08. TQ LEV AUTOLIZADA ', '09. PML CO-PRODUCTOS', 'Cambio de marca', 'Descargas BTS'];
    const raw = S().raw('aseos');
    return orden.filter((h) => raw[h]);
  }

  function filasGuardadas(tipo, hoja, def) {
    const recs = ((A.S.config['opCaptures_' + tipo] || {}).records || []).filter((r) => r.source === hoja && r.origin === 'Plataforma');
    const filas = recs.map((r) => ({ rec: r, f: def.deRecord(r) }));
    filas.sort((a, b) => (def.orden(a.f) || String(a.rec.savedAt || '')).localeCompare(def.orden(b.f) || String(b.rec.savedAt || '')));
    return filas.slice(-30).map((x) => x.f);
  }

  async function guardarFilas(tipo, hoja, def, filas, ctx) {
    if (!A.Store.canWrite) return false;
    const clave = 'opCaptures_' + tipo;
    const antes = clone(A.S.config[clave] || { records: [] });
    const estado = clone(antes); estado.records = estado.records || [];
    const at = new Date().toISOString(), ids = [];
    filas.forEach((f, i) => {
      const nuevas = def.aCelulas(f, ctx);
      const rec = f.id ? estado.records.find((r) => r.id === f.id) : null;
      if (rec) {
        const previas = rec.cells || {};
        const celdas = Object.assign({}, previas);
        def.indices.forEach((ix) => { delete celdas[ix]; });
        Object.assign(celdas, def.aCelulas(f, ctx, previas));
        rec.revisions = [...(rec.revisions || []), { at, sheet: hoja, before: clone(previas), after: clone(celdas) }];
        rec.cells = celdas; rec.savedAt = at;
        ids.push(rec.id); return;
      }
      const id = 'platform-' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 6);
      estado.records.push({ id, row: null, source: hoja, origin: 'Plataforma', savedAt: at, cells: nuevas, revisions: [{ at, sheet: hoja, before: null, after: clone(nuevas) }] });
      ids.push(id);
      if (tipo === 'recuperacion' && ctx) ctx.consec = Math.max(ctx.consec || 0, N(nuevas[0]) || 0);
    });
    const ok = await A.Store.set('config', clave, estado);
    if (ok === false) return false;
    try { A.DL.invalidate(); } catch (e) { /* sin capa de datos */ }
    return { ids, antes, clave };
  }

  function cerrar() {
    if (!panel) return;
    const p = panel; panel = null;
    const pend = p.h ? p.h.validar().sinGuardar : 0;
    try { p.h.destruir(); } catch (e) { /* ya destruida */ }
    p.fondo.remove();
    document.documentElement.style.overflow = p.overflow;
    if (p.foco && p.foco.focus) try { p.foco.focus(); } catch (e) { /* nada */ }
    if (pend) toast('Quedaron ' + pend + (pend === 1 ? ' fila' : ' filas') + ' sin guardar. Se conservan como borrador en este equipo.');
  }

  function abrir(tipo, hoja) {
    if (!S() || !DEFS_OK(tipo)) return;
    hoja = hoja || hojaPrincipal(tipo);
    if (panel) cerrar();
    const fondo = document.createElement('div');
    fondo.className = 'cap-fondo';
    const hojas = hojasDe(tipo);
    fondo.innerHTML = `<section class="cap-panel" role="dialog" aria-modal="true" aria-label="Capturar como Excel">
      <header class="cap-cab"><div class="cap-tit"><h2></h2><p></p></div>
        ${hojas.length > 1 ? '<label class="cap-hoja-sel">Hoja<select aria-label="Hoja del libro"></select></label>' : ''}
        <button type="button" class="cap-x" data-cerrar>Cerrar</button></header>
      <div class="cap-cuerpo"></div></section>`;
    document.body.appendChild(fondo);
    const p = panel = { fondo, h: null, foco: document.activeElement, overflow: document.documentElement.style.overflow, tipo, hoja };
    document.documentElement.style.overflow = 'hidden';
    const sel = fondo.querySelector('select');
    if (sel) { sel.innerHTML = hojas.map((h) => `<option value="${esc(h)}"${h === hoja ? ' selected' : ''}>${esc(h.trim())}</option>`).join(''); sel.addEventListener('change', () => abrir(tipo, sel.value)); }
    fondo.querySelector('[data-cerrar]').addEventListener('click', cerrar);
    fondo.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.closest('.hoja') && !e.defaultPrevented) cerrar(); });
    montar(p);
  }
  const DEFS_OK = (t) => !!ruta[t];

  function montar(p) {
    const { tipo, hoja, fondo } = p;
    const def = resolverDef(tipo, hoja);
    const cuerpo = fondo.querySelector('.cap-cuerpo');
    fondo.querySelector('h2').textContent = def.titulo;
    fondo.querySelector('p').textContent = def.intro;
    cuerpo.innerHTML = '';
    const puede = !!A.Store.canWrite;
    if (!puede) { const a = document.createElement('div'); a.className = 'cap-aviso'; a.textContent = 'Tu usuario solo puede consultar: la hoja está en modo de solo lectura.'; cuerpo.appendChild(a); }
    const filas = filasGuardadas(tipo, hoja, def);
    const mostrados = new Set(filas.map((f) => f.id));
    let ctx = def.contexto(hoja, mostrados);
    const caja = document.createElement('div');
    caja.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column';
    cuerpo.appendChild(caja);
    const nota = document.createElement('p');
    nota.className = 'cap-nota';
    nota.textContent = filas.length ? 'Arriba: las últimas ' + filas.length + ' capturas hechas en la plataforma (puedes corregirlas; cada cambio queda como revisión). Escribe en la última fila para registrar.' : 'Escribe en la primera fila para registrar. Puedes pegar varias filas desde Excel.';
    cuerpo.appendChild(nota);
    const cols = def.columnas();
    const h = A.Hoja.crear(caja, {
      columnas: cols, filas, contexto: () => ctx, cadena: def.cadena, nuevaFila: def.nuevaFila, soloLectura: !puede,
      gruposPlegables: def.gruposPlegables, gruposPlegados: def.gruposPlegados, clave: tipo + ':' + hoja, titulo: def.titulo + ' · ' + hoja,
      async onGuardar(listas) {
        const r = await guardarFilas(tipo, hoja, def, listas, ctx);
        if (!r) return false;
        try { A.render(true); } catch (e) { /* vista no disponible */ }
        toast('Guardadas ' + listas.length + (listas.length === 1 ? ' fila' : ' filas') + ' en ' + def.titulo, {
          texto: 'Deshacer',
          async fn() {
            const ok = await A.Store.set('config', r.clave, r.antes);
            if (ok === false) return;
            try { A.DL.invalidate(); A.render(true); } catch (e) { /* nada */ }
            const nuevos = filasGuardadas(tipo, hoja, def);
            ctx = def.contexto(hoja, new Set(nuevos.map((f) => f.id)));
            h.recargar(nuevos, false);
            // lo que se había escrito vuelve como filas pendientes, para no perder el trabajo
            listas.forEach((f) => {
              const vals = {}; cols.forEach((c) => { if (c.tipo !== 'calc' || c.anulable) { if (f[c.key] != null) vals[c.key] = f[c.key]; } });
              if (f.id && nuevos.some((n) => n.id === f.id)) {
                const i = h.getFilas().findIndex((x) => x.id === f.id);
                if (i >= 0) Object.entries(vals).forEach(([k, v]) => h.setCelda(i, k, typeof v === 'string' ? v : v));
              } else h.agregarFila(vals);
            });
            h.enfocar(Math.max(0, h.filasN - 1), 0);
            toast('Cambios deshechos. Tus filas quedaron como pendientes en la hoja.');
          },
        });
        return r.ids;
      },
      async onEliminar(sel) {
        const ok = await confirmar('Eliminar ' + sel.length + (sel.length === 1 ? ' captura' : ' capturas'), 'Se quita de la plataforma el registro guardado. Podrás deshacerlo desde el aviso.');
        if (!ok) return false;
        const clave = 'opCaptures_' + tipo, antes = clone(A.S.config[clave] || { records: [] }), estado = clone(antes);
        const ids = new Set(sel.map((x) => x.id));
        estado.records = (estado.records || []).filter((r) => !ids.has(r.id));
        if (await A.Store.set('config', clave, estado) === false) return false;
        try { A.DL.invalidate(); A.render(true); } catch (e) { /* nada */ }
        toast('Captura eliminada', { texto: 'Deshacer', async fn() { await A.Store.set('config', clave, antes); try { A.DL.invalidate(); A.render(true); } catch (e) { /* */ } h.recargar(filasGuardadas(tipo, hoja, def), true); } });
        return true;
      },
    });
    p.h = h;
    h.enfocar(Math.max(0, h.filasN - 1), 0);
  }
  function confirmar(titulo, texto) {
    try { if (A.UI && A.UI.confirm) return Promise.resolve(A.UI.confirm(titulo, texto, 'Eliminar')); } catch (e) { /* usa el cuadro nativo */ }
    return Promise.resolve(window.confirm(titulo + '\n' + texto));
  }

  /* ---------- Botón en cada sección ---------- */
  function hojaActiva(tipo) {
    if (tipo === 'aseos') { const b = document.querySelector('[data-aseo-module][aria-pressed="true"]'); return b ? b.dataset.aseoModule : '1. Cada uso'; }
    return hojaPrincipal(tipo);
  }
  for (const tipo of Object.keys(ruta)) {
    A.Seccion.registrar(ruta[tipo], (vista) => {
      if (!A.OperationSources) return;
      A.Seccion.boton(vista, 'capturar-excel-' + tipo, 'Capturar como Excel', () => abrir(tipo, hojaActiva(tipo)), { primario: true, antes: '[data-op-add],#aseoNew' });
    });
  }

  A.Captura = { abrir, cerrar, hoja: () => (panel ? panel.h : null), defs: DEFS, guardarFilas, util: { frecuentes, isoWeek, serialDe, fh } };
})();
