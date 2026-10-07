/* ============================================================
   50-asistente.js · Cifra, analista de datos de la planta (motor local, sin IA externa)
   - Comprende preguntas en español de planta (tildes, jerga, errores de ortografía, abreviaturas).
   - Consulta los datos reales de App.DL (agua, aseos, merma, recuperación, trasiego, fermentación, levadura).
   - Responde con cifras, periodo, cobertura, comparación, interpretación, gráfico y chips de seguimiento.
   - Se instala DELANTE de App.BotDirecto: lo que no es del dominio nuevo lo siguen respondiendo las capas anteriores.
   Expone App.Cifra.preguntar(texto, ctx) → Promise<{texto, html, intent, confianza}>.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;
  const DAY = 864e5, HOUR = 36e5;
  const KB = () => A.CifraKB || { CATEGORIAS: [], GLOSARIO: [], PLATAFORMA: [], CONTEXTUAL: {}, SEGUIMIENTOS: [], ALIAS_MARCA: {} };
  const ST = () => A.Stats, CH = () => A.Charts;

  /* ---------------------------------------------------------------- formato */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NF = {};
  const nf = (d) => NF[d] || (NF[d] = new Intl.NumberFormat('es-CO', { maximumFractionDigits: d, minimumFractionDigits: 0, useGrouping: true }));
  const fmt = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : nf(d).format(x));
  const autoDec = (x) => { const a = Math.abs(x); return a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 1 : a >= 1 ? 2 : 3; };
  const fa = (x) => fmt(x, x == null ? 1 : autoDec(x));
  const withU = (x, u, d) => fmt(x, d == null ? autoDec(x) : d) + (u ? (u === '%' ? ' %' : ' ' + u) : '');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES3 = MESES.map((m) => m.slice(0, 3));
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const pad = (n) => String(n).padStart(2, '0');
  const sod = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const eod = (t) => sod(t) + DAY - 1;
  const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
  const addMonths = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
  let REF_YEAR = new Date().getFullYear();
  const fd = (t) => { if (t == null) return '—'; const d = new Date(t); return d.getDate() + ' ' + MES3[d.getMonth()] + (d.getFullYear() !== REF_YEAR ? ' ' + d.getFullYear() : ''); };
  const fdt = (t) => { const d = new Date(t); return fd(t) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const plural = (n, s, p) => (Math.abs(n) === 1 ? s : p || s + 's');
  const strip = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tagsOut = (h) => String(h).replace(/\u2060/g, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const uniq = (a) => [...new Set(a)];
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const jparse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  };
  const nombre = () => { try { return (A.Metas && A.Metas.get('asistente.nombre', 'Cifra')) || 'Cifra'; } catch (e) { return 'Cifra'; } };

  /* ---------------------------------------------------------------- normalización */
  function norm(s) {
    let t = strip(s);
    t = t.replace(/(\d),(\d)/g, '$1.$2');
    t = t.replace(/≥|=>/g, ' >= ').replace(/≤|=</g, ' <= ');
    t = t.replace(/\bm\^?3\b|\bmt3\b|\bmetros? cubicos?\b/g, 'm3').replace(/\bm3(?=\w)/g, 'm3 ');
    t = t.replace(/\bhectolitros?\b|\bhls\b|\bhectos?\b/g, 'hl');
    t = t.replace(/por ciento|porciento|\bpct\b/g, '%');
    t = t.replace(/(\d)\s*(horas?|hrs?|hs)\b/g, '$1 h').replace(/\bhoras?\b/g, 'horas');
    t = t.replace(/(\d)\s*(minutos?|mins?)\b/g, '$1 min');
    t = t.replace(/\b(fv|sv|utq|utk|ypt|tq|col|colector|propagador|tanque|sem|semana|lote|ciclo)\s*_?\s*0*(\d+)/g, '$1 $2');
    t = t.replace(/\b(fv|sv|utq|utk)(\d)/g, '$1 $2');
    t = t.replace(/\bxq\b|\bporq\b|\bpq\b|\bporque\b|\bpor q\b/g, 'por que');
    t = t.replace(/\bq\b/g, 'que').replace(/\bx\b/g, 'por').replace(/\bk\b/g, 'que');
    t = t.replace(/[^a-z0-9%<>=.\/ ]/g, ' ');
    t = t.replace(/\.(?!\d)/g, ' ').replace(/(\d)\.(?=\s|$)/g, '$1').replace(/(?<!\d)\.(?=\d)/g, ' .');
    t = t.replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
    return t;
  }

  const STOP = new Set(('para pero como esta este esto estos estas solo todo toda todos todas muy mas menos cada casa caso cuando donde quien cual cuales sobre entre desde hasta bajo tiene tienen tengo hace hacer hicimos hizo hubo hay hemos fue fueron sido vamos queda quedo dentro fuera segun otra otro otros otras mismo misma algo nada alguno alguna tambien ademas ahora aqui alli luego antes despues durante mientras nuestro nuestra nuestros nuestras mejor peor mayor menor primer primera segundo tercer cuarto quinto sexto planta cerveza cervezas volumen hectolitros litros horas hora minutos minuto dato datos valor valores cifra cifras numero numeros lote lotes tanque tanques fecha fechas registro registros nombre nombres hacemos bajamos reducimos subimos aumentamos disminuimos logramos llevamos pasamos cumplimos dejamos eliminamos mejoramos cortamos ahorramos perdimos tuvimos cerramos recuperamos produjimos sacamos revisamos hicieron estamos estan estoy estuvo estuvieron esta quiero quieres puedo puedes podemos puede pueden dime dame muestrame necesito favor porfa porfavor gracias hola buenas buenos buen tardes noches dias tarde noche manana ayer hoy anteayer siempre nunca casi aqui dos tres cuatro cinco seis siete ocho nueve diez veces vez parte partes forma tipo tipos clase lado lados punto puntos nivel niveles caudal ritmo grado grados plato brix tema temas area areas seccion secciones pantalla pantallas pagina vista menu opcion opciones boton botones carga cargar subir bajar abrir cerrar guardar borrar editar nuevo nueva nuevos nuevas viejo vieja gran grande grandes pequeno pequena poco pocos poca pocas mucho muchos mucha muchas bien mal bueno buena buenos buenas malo mala malos malas ultima ultimo estaba estaban estado estados tuvimos tuvo tuvieron teniamos tenemos tenga tengan seria serian sera seran podria podrian deberia deberian debemos debe deben iba iban unos unas unas haya hayan tambien tampoco incluso aunque mientras entonces porque pues sino sin con del las los una uno que cuyo cuya donde adonde quienes cuyos asi incluye incluir listo listos lista listas hecho hechos hecha hechas dentro afuera encima debajo alrededor cerca lejos junto junta juntos juntas ahi alla aca todavia aun ya recien apenas') .split(/\s+/));

  const VOCAB_STR = `agua aguas consumo consumos gasto gastos gastamos gastado gastar gasta consumimos consumido consume consumen aseo aseos limpieza lavado enjuague merma mermas perdida perdidas perdimos perdemos pierde faltante recuperacion recuperaciones recuperada recuperadas recuperamos recuperado recupera trasiego trasiegos traslado programa programado programados fermentacion fermentaciones fermenta fermentador fermentadores curva extracto atenuacion levadura levaduras viabilidad consistencia generacion generaciones cepa familia familias cosecha cosechas marca marcas turno turnos operario operarios causa causas desvio desvios retraso retrasos promedio media mediana maximo minimo total suma acumulado cuantos cuantas cuanto cuanta tanque tanques unitanque unitanques colector colectores propagador centrifuga siembra grafica grafico graficos graficas graficame muestrame muestra dame dime lista listame comparar compara comparame comparado compararlo frente contra versus tendencia evolucion distribucion histograma variabilidad dispersion correlacion relacion semana semanas semanal semanales mes meses mensual diario diaria dia dias ano anos anual trimestre hoy ayer anteayer ultimo ultima ultimos ultimas anterior pasado pasada actual enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre resumen reporte informe documento documentos pronostico proyeccion prediccion anomalia anomalias atipico atipicos raro rara rarezas inusual ahorrar ahorro ahorramos ahorraria optimizar revisar revisamos deberia debemos prioridad alerta alertas calidad faltan faltantes vacios invalidas invalidos ayuda explica explicame hectolitro produccion mosto cocina pisos turnos manana tarde noche light estandar club colombia azteca aguila poker presion temperatura duracion caudal minutos horas volumen hectolitros litros eficiencia rendimiento recoleccion recolectada recolectado destino estado descartada descartadas descartado vaciada utilizada inventario cervezas sensorial excel archivo cargar capturar capturo registro registrar registro registrar aseo analisis constructor configuracion metas meta objetivo semaforo grafica barras lineas torta pastel dispersion caja pareto control carta significativo significancia estadistica diferencia diferencias aumento aumentaron aumento bajo disminuyo cayo crecio empeoro mejoro esperado esperada proyectado proyectada pronosticar proximo proxima siguiente quincena fermento llenado llenar extractos atenuaciones lento lenta lentas lentos rapido rapida rapidos rapidas largo larga largos largas corto corta cortos cortas cuantos hicimos hicieron hacemos realizamos realizados tuvimos cerramos cerrados cerrada cerradas cerrado lotes lote saldo negativo negativos imposibles invalidez outliers outlier sospechosos sospechoso confiable confiables confiabilidad cobertura completitud tabla tablas listado reporte informe borra exporta exportar descarga descargar copiar copia grafico imprimir imagen imagenes png svg csv xlsx xlsm`;
  const VOCAB = new Set(VOCAB_STR.split(/\s+/).filter(Boolean));
  const VLIST = () => (VLIST.c && VLIST.n === VOCAB.size ? VLIST.c : ((VLIST.n = VOCAB.size), (VLIST.c = [...VOCAB])));

  // Distancia de Damerau-Levenshtein con corte
  function dl(a, b, max) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let p2 = null, p = new Array(lb + 1), c = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) p[j] = j;
    for (let i = 1; i <= la; i++) {
      c[0] = i; let rm = i;
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        c[j] = v; if (v < rm) rm = v;
      }
      if (rm > max) return max + 1;
      p2 = p; p = c; c = new Array(lb + 1);
    }
    return p[lb];
  }
  const FIXCACHE = new Map();
  function fixWord(t) {
    if (t.length < 4 || /\d/.test(t) || VOCAB.has(t) || STOP.has(t)) return t;
    if (FIXCACHE.has(t)) return FIXCACHE.get(t);
    let out = t;
    const base = t.replace(/(es|s)$/, '');
    if (base !== t && (VOCAB.has(base) || STOP.has(base))) out = t;
    else {
      const max = t.length <= 8 ? 1 : 2;
      let best = null, bd = 9;
      for (const w of VLIST()) {
        if (w[0] !== t[0] && !(w.length === t.length && dl(w, t, 1) === 1 && w[1] === t[0] && w[0] === t[1])) continue;
        const d = dl(t, w, max);
        if (d <= max && d < bd) { best = w; bd = d; if (d === 1) break; }
      }
      if (best) out = best;
    }
    FIXCACHE.set(t, out);
    return out;
  }
  function correct(q) {
    const fixed = [];
    const out = q.split(' ').map((t) => { const f = fixWord(t); if (f !== t) fixed.push([t, f]); return f; });
    return { q: out.join(' '), fixed };
  }

  /* ---------------------------------------------------------------- capa de datos del asistente */
  const DL = () => A.DL;
  const dsLabel = (ds) => { const m = DL() && DL().META[ds]; return m ? m.label : ds; };
  const DSNOUN = { agua: ['turno', 'turnos'], aseos: ['aseo', 'aseos'], merma: ['lote cerrado', 'lotes cerrados'], recuperacion: ['recuperación', 'recuperaciones'], trasiego: ['actividad', 'actividades'], ferm: ['fermentación', 'fermentaciones'], lev: ['cosecha', 'cosechas'] };
  const DSTAB = { agua: 'agua', aseos: 'operacion', merma: 'merma', recuperacion: 'recuperacion', trasiego: 'operacion', ferm: 'fermentacion', lev: 'levadura' };
  const DSROUTE = { agua: 'agua', aseos: 'aseos', merma: 'merma', recuperacion: 'recuperacion', trasiego: 'programa', ferm: 'analisis/fermentacion', lev: 'analisis/levadura' };
  const HASBRAND = { merma: 1, recuperacion: 1, trasiego: 1, ferm: 1, lev: 1 };

  // Equipos de aseo: los Excel traen más de 300 escrituras para unos 60 equipos reales («COELECTOR 2», «FV 23 23», «R COSECHA»…)
  const EQW = 'cosecha siembra mosto trasiego centrifuga anillo autolizador soda trimeta propagacion propagadores propagador colector purgas purga aire cerveza levadura buffer silica sanitizante gases insuflacion contrapresion vemstack trampa agua fresca retorno recuperada caliente fria diluida divosan quincenal unitanques lineas loops desaireada ambiente planta tanques corto largo budweiser primer segundo aseo foam'.split(' ');
  const eqFix = (w) => { if (w.length < 4 || EQW.includes(w)) return w; let b = w, bd = 3; for (const x of EQW) { const d = dl(w, x, w.length <= 6 ? 1 : 2); if (d < bd) { bd = d; b = x; } } return bd <= (w.length <= 6 ? 1 : 2) ? b : w; };
  const EQC = new Map();
  function eqCanon(raw) {
    const k0 = String(raw == null ? '' : raw);
    if (EQC.has(k0)) return EQC.get(k0);
    let w = norm(k0).split(' ').filter(Boolean).map(eqFix);
    let s = w.join(' ');
    let r;
    let m;
    if ((m = /^(fv|fermentador|sv|madurador|colector|col|propagador|ypt|tpt|utk|utq)\s*(\d+)/.exec(s)) || (m = /^(colector|col)\s*(\d+)/.exec(s))) {
      const t = { fv: 'FV', fermentador: 'FV', sv: 'SV', madurador: 'SV', colector: 'COLECTOR', col: 'COLECTOR', propagador: 'PROPAGADOR', ypt: 'PROPAGADOR', tpt: 'PROPAGADOR', utk: 'UTK', utq: 'UTQ' }[m[1]];
      r = { key: t + ' ' + +m[2], type: t, n: +m[2] };
    } else if (/^(fv|sv)$/.test(s)) r = { key: s.toUpperCase(), type: s.toUpperCase(), n: null };
    else if (/centrifuga/.test(s)) r = { key: 'CENTRÍFUGA', type: 'CENTRIFUGA', n: null };
    else if (/anillo/.test(s)) { const n = /(\d+)\s*-?\s*(\d+)/.exec(s.replace(/anillo/, '')); r = { key: 'ANILLO ' + (n ? n[1] + '-' + n[2] : ''), type: 'ANILLO', n: null }; }
    else if (/autolizador/.test(s)) r = { key: 'AUTOLIZADOR', type: 'AUTOLIZADOR', n: null };
    else if (/^(tanque|tq)\b.*(soda|trimeta|agua|pre|sanitizante|silica|divosan)|soda caliente|soda fria|trimeta gea|silica|pre shot|sanitizante|divosan|trimeta|soda caustica/.test(s)) {
      const nm = /(pre shot|sanitizante|silica|divosan|trimeta|soda|agua fresca|agua retorno|agua recuperada)/.exec(s);
      r = { key: 'TANQUE ' + (nm ? nm[1].toUpperCase() : s.toUpperCase()), type: 'TANQUE', n: null };
    } else if (/^(red|r|re|res)\b|^(cosecha|siembra|mosto|trasiego)\b/.test(s)) {
      const nm = /(cosecha|siembra|mosto|trasiego|purgas?|co2|aire|cerveza|levadura|insuflacion|contrapresion|gases|desaireada)/.exec(s);
      r = { key: 'RED ' + (nm ? nm[1].replace(/^purga$/, 'purgas').toUpperCase() : s.toUpperCase()), type: 'RED', n: null };
    } else if (/buffer/.test(s)) r = { key: 'BUFFER LEVADURA', type: 'OTRO', n: null };
    else r = { key: s.toUpperCase().replace(/\s+\d+$/, (x) => x), type: 'OTRO', n: null };
    EQC.set(k0, r);
    return r;
  }
  const eqLabel = (key) => String(key).replace(/^RED /, 'Red de ').replace('CENTRÍFUGA', 'Centrífuga').replace(/^TANQUE /, 'Tanque ').replace(/^ANILLO /, 'Anillo ').replace(/^COLECTOR /, 'Colector ').replace(/^PROPAGADOR /, 'Propagador ').replace(/^BUFFER LEVADURA/, 'Buffer de levadura').replace(/^AUTOLIZADOR/, 'Autolizador').replace(/(^|\s)([A-ZÁÉÍÓÚ]{3,})/g, (m, a, b) => a + b.charAt(0) + b.slice(1).toLowerCase()).replace(/\b(fv|sv|utk|utq|co2)\b/gi, (x) => x.toUpperCase());

  // Operarios: se agrupan las variantes («LUIS B», «LJUIS B», «LUIIS B») por su nombre de pila
  let OPS = null;
  function operators() {
    const src = DL().get('aseos');
    if (OPS && OPS.src === src) return OPS;
    const cnt = new Map();
    const parts = (s) => String(s || '').split(/[\/,&+]|\s-\s|\sy\s|_/).map((x) => strip(x).replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0]).filter((x) => x && x.length >= 3);
    for (const r of src) for (const p of parts(r.operator)) cnt.set(p, (cnt.get(p) || 0) + 1);
    const names = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
    const canon = new Map(), main = [];
    for (const [n, c] of names) {
      let hit = main.find((m) => dl(n, m, n.length <= 5 ? 1 : 2) <= (n.length <= 5 ? 1 : 2) && n[0] === m[0]);
      if (hit) canon.set(n, hit); else if (c >= 8) { main.push(n); canon.set(n, n); }
    }
    OPS = { src, canon, main, parts };
    main.forEach((m) => VOCAB.add(m));
    return OPS;
  }
  const opsOf = (r) => { const o = operators(); return uniq(o.parts(r.operator).map((p) => o.canon.get(p)).filter(Boolean)); };

  /* ---------------------------------------------------------------- filas decoradas por conjunto de datos */
  const DECO = new Map();
  const UTQ_RE = /utq\s*_?\s*0*(\d+)/i;
  function decorate(ds, r) {
    if (ds === 'aseos') {
      const e = eqCanon(r.equipment);
      return Object.assign({}, r, { eq: e.key, eqType: e.type, tqN: e.n != null && (e.type === 'FV' || e.type === 'SV') ? e.n : null, ops: opsOf(r), opMain: null, tipo: r.sheet.replace(/^\d+\.\s*/, '') });
    }
    if (ds === 'trasiego') {
      const m = UTQ_RE.exec(r.activity);
      return Object.assign({}, r, { tq: m ? +m[1] : null, brand: r.brand || '(sin marca)', cause: r.cause });
    }
    if (ds === 'recuperacion') {
      const m = /(\d+)/.exec(r.utk || '');
      return Object.assign({}, r, { utk: m ? 'UTK ' + +m[1] : String(r.utk || '').trim(), brand: r.brand || '(sin marca)', utkN: m ? +m[1] : null });
    }
    if (ds === 'agua') return Object.assign({}, r, { turno: r.shift });
    return r;
  }
  function rowsOf(ds) {
    const src = DL().get(ds), c = DECO.get(ds);
    if (c && c.src === src) return c.rows;
    const rows = src.map((r) => decorate(ds, r));
    DECO.set(ds, { src, rows });
    return rows;
  }

  /* ---------------------------------------------------------------- «ahora» = último dato disponible */
  function refTime() {
    const now = Date.now();
    let best = null;
    for (const ds of ['agua', 'ferm', 'lev', 'recuperacion', 'aseos', 'trasiego']) {
      const rows = DL().get(ds);
      for (let i = rows.length - 1; i >= 0; i--) { const t = rows[i].t; if (t != null && t <= now + 3600000) { if (best == null || t > best) best = t; break; } }
    }
    const ref = best == null ? now : Math.min(best, now + DAY);
    REF_YEAR = new Date(ref).getFullYear();
    return ref;
  }

  /* ---------------------------------------------------------------- catálogo de métricas (con rangos plausibles: los Excel traen basura como 36.800 h de duración) */
  // t: 'add' (se suma) | 'ratio' (se promedia); w: [numerador, denominador] para promedio ponderado; good: dirección buena; plaus: rango válido
  const MET = {
    agua: [
      { k: 'hlPerHl', re: /por hl|hl procesad|eficienc|hl\/hl|por hectolitro|intensidad|relacion agua cerveza/, t: 'ratio', good: 'down', plaus: [0, 5], d: 2 },
      { k: 'pisos', re: /\bpisos?\b/, t: 'add', good: 'down', plaus: [0, 1000], l: 'Consumo de pisos' },
      { k: 'gea', re: /\bgea\b/, t: 'add', good: 'down', plaus: [0, 5000], l: 'Consumo de CIP GEA' },
      { k: 'cip', re: /\bcip\b/, t: 'add', good: 'down', plaus: [0, 1000], l: 'Consumo de CIP' },
      { k: 'production', re: /mosto|produccion|cocina|elaborad|recibid/, t: 'add', plaus: [0, 30000], l: 'Mosto recibido' },
      { k: 'transfer', re: /trasegad/, t: 'add', plaus: [0, 30000] },
      { k: 'total', re: /.*/, t: 'add', good: 'down', plaus: [0, 1000], def: true, l: 'Consumo de agua' },
    ],
    aseos: [
      { k: 'durMin', re: /duracion|dura\b|tarda|demora|tiempo|minutos de aseo/, t: 'ratio', good: 'down', plaus: [1, 1440], l: 'Duración del aseo', u: 'min' },
      { k: 'flow', re: /caudal|flujo/, t: 'ratio', plaus: [0, 5000] },
      { k: 'minutes', re: /minutos de enjuague|enjuague|minutos/, t: 'ratio', plaus: [0, 1440] },
      { k: 'ph', re: /\bph\b/, t: 'ratio', plaus: [0, 14], l: 'pH del enjuague' },
      { k: 'm3', re: /.*/, t: 'add', good: 'down', plaus: [0, 200], def: true, l: 'Agua de aseos', u: 'm³' },
    ],
    merma: [
      { k: 'loss', re: /\bhl\b|volumen|litros|hectolitros|cuanto (perdimos|se perdio)|perdimos|perdido|perdidas en hl/, t: 'add', good: 'down', plaus: [-5000, 20000], l: 'Merma' },
      { k: 'input', re: /entrada|recibid|ingres|llen/, t: 'add', plaus: [0, 30000] },
      { k: 'purges', re: /purga/, t: 'add', plaus: [0, 20000] },
      { k: 'unexplained', re: /sin explicar|no explicad|inexplicad/, t: 'add', good: 'down', plaus: [-5000, 20000] },
      { k: 'kgLoss', re: /kge|kilos/, t: 'add', good: 'down', plaus: [-5000, 50000] },
      { k: 'lossPct', re: /.*/, t: 'ratio', w: ['loss', 'input'], good: 'down', plaus: [-100, 100], def: true, d: 2 },
    ],
    recuperacion: [
      { k: 'hours', re: /horas|tiempo|demora|tarda|duracion|lenta|rapida/, t: 'ratio', good: 'down', plaus: [0, 400] },
      { k: 'yieldPct', re: /rendimiento|eficiencia|recuperado\s*\/\s*levadura/, t: 'ratio', w: ['volume', 'yeast'], good: 'up', plaus: [0, 200], d: 1 },
      { k: 'yeast', re: /levadura|recolectad|recolecci/, t: 'add', plaus: [0, 2000] },
      { k: 'waterHl', re: /agua/, t: 'add', plaus: [0, 2000] },
      { k: 'ph', re: /\bph\b/, t: 'ratio', plaus: [0, 14] },
      { k: 'temp', re: /temperatura|temp\b/, t: 'ratio', plaus: [-5, 40] },
      { k: 'volume', re: /.*/, t: 'add', good: 'up', plaus: [0, 2000], def: true },
    ],
    trasiego: [
      { k: 'duration', re: /duracion|\bdura\b|demora\w*|tarda\w*|cuanto tiempo|largo|larga|cuanto dura/, t: 'ratio', good: 'down', plaus: [0.25, 72] },
      { k: 'delay', re: /desvio|retraso|atraso/, t: 'add', good: 'down', plaus: [-72, 240], l: 'Desvío frente al plan' },
      { k: 'duration', re: /.*/, t: 'ratio', good: 'down', plaus: [0.25, 72], def: true },
    ],
    ferm: [
      { k: 'h75', re: /\bh ?75\b|75 ?%|rapid|lent|velocidad|cuanto tarda|tiempo (a|hasta|para)/, t: 'ratio', good: 'down', plaus: [10, 400] },
      { k: 'h15', re: /\bh ?15\b|15 p/, t: 'ratio', good: 'down', plaus: [5, 400] },
      { k: 'e72', re: /\be ?72\b|72 h|extracto a (las )?72/, t: 'ratio', plaus: [0, 20] },
      { k: 'atten', re: /atenuacion/, t: 'ratio', good: 'up', plaus: [0, 100] },
      { k: 'rdf', re: /extracto final|\brdf\b|final/, t: 'ratio', plaus: [0, 20] },
      { k: 'eo', re: /extracto ?original|extractooriginal|\beo\b|extracto/, t: 'ratio', plaus: [5, 30] },
      { k: 'rata', re: /rata|ritmo|caida/, t: 'ratio', plaus: [0, 1] },
      { k: 'tll', re: /llenado|tiempo de llenado/, t: 'ratio', plaus: [0, 100] },
      { k: 'tA', re: /\balta\b/, t: 'ratio', plaus: [0, 2000] },
      { k: 'vol', re: /volumen|\bhl\b/, t: 'add', plaus: [0, 20000] },
      { k: 'viab', re: /viabilidad/, t: 'ratio', good: 'up', plaus: [0, 100] },
      { k: 'cons', re: /consistencia/, t: 'ratio', plaus: [0, 100] },
      { k: 'ph', re: /\bph\b/, t: 'ratio', plaus: [2, 8] },
      { k: 'h75', re: /.*/, t: 'ratio', good: 'down', plaus: [10, 400], def: true },
    ],
    lev: [
      { k: 'viab', re: /viabilidad|viable/, t: 'ratio', good: 'up', plaus: [0, 100] },
      { k: 'cons', re: /consistencia/, t: 'ratio', plaus: [0, 100] },
      { k: 'ph', re: /\bph\b/, t: 'ratio', plaus: [2, 8] },
      { k: 'etanol', re: /etanol|alcohol/, t: 'ratio', plaus: [0, 20] },
      { k: 'vol', re: /volumen|\bhl\b|cabeza/, t: 'add', plaus: [0, 1000] },
      { k: 'gen', re: /generacion/, t: 'ratio', plaus: [0, 30] },
      { k: 'viab', re: /.*/, t: 'ratio', good: 'up', plaus: [0, 100], def: true },
    ],
  };
  const COUNT_MET = { k: '__n', t: 'count', l: 'Cantidad', u: '' };
  function metOf(ds, k) {
    if (k === '__n') return Object.assign({ ds }, COUNT_MET, { l: 'Cantidad de ' + DSNOUN[ds][1], u: DSNOUN[ds][1] });
    const base = (MET[ds] || []).find((m) => m.k === k) || { k, t: 'add' };
    const f = DL().fieldOf(ds, k) || {};
    return Object.assign({ ds }, base, { l: base.l || f.label || k, u: base.u != null ? base.u : f.unit || '' });
  }
  const dec = (m) => (m.d != null ? m.d : null);
  const vFmt = (m, x) => withU(x, m.u, dec(m));
  // Valores válidos de una métrica en un conjunto de filas
  function vals(rows, m) {
    const out = [], [lo, hi] = m.plaus || [-Infinity, Infinity];
    for (const r of rows) { const v = DL().N(r[m.k]); if (v != null && v >= lo && v <= hi) out.push(v); }
    return out;
  }
  const quant = (s, p) => { if (!s.length) return null; const a = s.slice().sort((x, y) => x - y), i = (a.length - 1) * p, f = Math.floor(i), c = Math.ceil(i); return a[f] + (a[c] - a[f]) * (i - f); };
  // Agrega: how = sum|mean|median|max|min|count|wmean. Devuelve {v, n, tot}
  function aggregate(rows, m, how) {
    if (m.k === '__n') return { v: rows.length, n: rows.length, tot: rows.length };
    if (m.w && (how === 'wmean' || how === 'sum' || how === 'mean' || !how)) {
      const [nk, dk] = m.w, [lo, hi] = m.plaus;
      const n1 = metOf(m.ds, nk), d1 = metOf(m.ds, dk);
      let sn = 0, sd = 0, n = 0;
      for (const r of rows) { const a = DL().N(r[nk]), b = DL().N(r[dk]); if (a == null || b == null || !(b > 0)) continue; const pv = (a / b) * 100; if (pv < lo || pv > hi) continue; sn += a; sd += b; n++; }
      return { v: sd > 0 ? (sn / sd) * 100 : null, n, tot: rows.length, sn, sd };
    }
    const v = vals(rows, m);
    if (!v.length) return { v: null, n: 0, tot: rows.length };
    const h = how || (m.t === 'add' ? 'sum' : 'mean');
    let x;
    if (h === 'sum') x = sum(v); else if (h === 'mean') x = sum(v) / v.length; else if (h === 'median') x = quant(v, 0.5);
    else if (h === 'max') x = Math.max(...v); else if (h === 'min') x = Math.min(...v); else x = sum(v) / v.length;
    return { v: x, n: v.length, tot: rows.length };
  }
  const defaultHow = (m) => (m.k === '__n' ? 'count' : m.w ? 'wmean' : m.t === 'add' ? 'sum' : 'mean');

  /* ---------------------------------------------------------------- dimensiones (por …) */
  const DIMS = {
    agua: { shift: ['turno', (r) => r.shift], day: null, week: null, month: null },
    aseos: { eq: ['equipo', (r) => eqLabel(r.eq)], eqType: ['tipo de equipo', (r) => ({ FV: 'Fermentadores (FV)', SV: 'Maduradores (SV)', COLECTOR: 'Colectores', PROPAGADOR: 'Propagadores', CENTRIFUGA: 'Centrífuga', RED: 'Redes', ANILLO: 'Anillos', TANQUE: 'Tanques de CIP', AUTOLIZADOR: 'Autolizador', UTK: 'UTK', UTQ: 'UTQ' }[r.eqType] || 'Otros')], tipo: ['programa de aseo', (r) => r.tipo], operator: ['operario', null], day: null, week: null, month: null },
    merma: { brand: ['marca', (r) => r.brand], tq: ['tanque', (r) => 'UTQ ' + r.tq], phase: ['etapa', (r) => (r.phase === 'FV' ? 'FV (fermentación)' : 'SV (maduración)')], day: null, week: null, month: null },
    recuperacion: { utk: ['UTK', (r) => r.utk], brand: ['marca', (r) => r.brand], day: null, week: null, month: null },
    trasiego: { brand: ['marca', (r) => r.brand], kind: ['tipo de actividad', (r) => r.kind], cause: ['causa de desvío', (r) => r.cause], tq: ['tanque', (r) => (r.tq != null ? 'UTQ ' + r.tq : null)], day: null, week: null, month: null },
    ferm: { brand: ['marca', (r) => r.brand], tq: ['tanque', (r) => 'FV ' + r.tq], fam: ['familia de levadura', (r) => r.fam], gen: ['generación de levadura', (r) => (r.gen != null ? 'Gen ' + r.gen : null)], day: null, week: null, month: null },
    lev: { brand: ['marca', (r) => r.brand], fam: ['familia', (r) => r.fam], gen: ['generación', (r) => (r.gen != null ? 'Gen ' + r.gen : null)], state: ['estado', (r) => ({ utilizada: 'Utilizada', vaciada: 'Vaciada', descartada: 'Descartada', inventario: 'En inventario' }[r.state] || r.state)], day: null, week: null, month: null },
  };
  const TIMEDIM = { day: 'día', week: 'semana', month: 'mes', year: 'año' };
  const dimLabel = (ds, by) => (TIMEDIM[by] || (DIMS[ds] && DIMS[ds][by] && DIMS[ds][by][0]) || by);
  // Agrupa filas: devuelve [{k,label,t,rows}]
  function groupRows(ds, rows, by) {
    const g = new Map();
    const add = (k, label, t, r) => { if (k == null || k === '') return; if (!g.has(k)) g.set(k, { k, label, t, rows: [] }); g.get(k).rows.push(r); };
    if (TIMEDIM[by]) for (const r of rows) { if (r.t == null) continue; const p = DL().periodKey(r.t, by); add(p.k, p.label, p.t, r); }
    else if (by === 'operator') for (const r of rows) for (const o of r.ops || []) add(o, o.charAt(0).toUpperCase() + o.slice(1), null, r);
    else { const d = DIMS[ds] && DIMS[ds][by]; if (!d) return []; for (const r of rows) { const l = d[1](r); add(l, l, null, r); } }
    return [...g.values()];
  }

  /* ---------------------------------------------------------------- periodos */
  const MON_RE = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept|sep|set|oct|nov|dic)';
  const monIdx = (w) => { const k = w.slice(0, 3); const i = MES3.indexOf(k === 'set' ? 'sep' : k); return i; };
  const mondayOf = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); };
  const rangeTxt = (f, t) => {
    const a = new Date(f), b = new Date(t);
    if (sod(f) === sod(t)) return fd(f);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return a.getDate() + '–' + fd(t);
    return fd(f) + ' – ' + fd(t);
  };
  const P = (from, to, label, kind, extra) => Object.assign({ from, to, label, kind, txt: rangeTxt(from, to) }, extra || {});
  const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const monthPeriod = (y, m, ref) => {
    const from = new Date(y, m, 1).getTime(), to = eod(new Date(y, m, lastDayOfMonth(y, m)).getTime());
    const partial = ref != null && ref >= from && ref < to;
    return P(from, partial ? eod(ref) : to, MESES[m] + (y !== REF_YEAR ? ' de ' + y : ''), 'month', { partial, y, m });
  };
  const yearOfMonth = (m, ref, explicit) => { if (explicit) return explicit; const y = new Date(ref).getFullYear(); return new Date(y, m, 1).getTime() > ref ? y - 1 : y; };
  const dayPeriod = (t, label) => P(sod(t), eod(t), label || fd(t), 'day');

  // Devuelve {p, q} (q = texto sin la expresión de tiempo) o null
  function parsePeriod(q, ref) {
    let m, rest = q;
    const cut = (re) => { rest = rest.replace(re, ' ').replace(/\s+/g, ' ').trim(); };
    const R0 = eod(ref);
    // últimos N …
    if ((m = /\b(?:ultim[oa]s?|pasad[oa]s?|previ[oa]s?)\s+(\d{1,3})\s+(horas?|dias?|semanas?|meses|mes|anos?)\b/.exec(q))) {
      const n = +m[1], u = m[2];
      let from, label;
      if (/hora/.test(u)) { from = ref - n * HOUR; label = 'últimas ' + n + ' horas'; }
      else if (/dia/.test(u)) { from = sod(addDays(ref, -(n - 1))); label = 'últimos ' + n + ' días'; }
      else if (/sem/.test(u)) { from = sod(addDays(ref, -(7 * n - 1))); label = 'últimas ' + n + ' ' + plural(n, 'semana'); }
      else if (/mes/.test(u)) { const d = new Date(ref); from = new Date(d.getFullYear(), d.getMonth() - n, d.getDate() + 1).getTime(); label = 'últimos ' + n + ' ' + plural(n, 'mes', 'meses'); }
      else { const d = new Date(ref); from = new Date(d.getFullYear() - n, d.getMonth(), d.getDate() + 1).getTime(); label = 'últimos ' + n + ' ' + plural(n, 'año'); }
      cut(m[0]); return { p: P(from, R0, label, 'rolling', { n, u }), q: rest };
    }
    // rango con días
    const D = '(\\d{1,2})';
    const yr = (s) => (s ? +s : null);
    if ((m = new RegExp('\\b(?:del|desde el|desde|entre el|entre)\\s+' + D + '\\s+(?:de\\s+' + '(' + MON_RE + ')\\s+)?(?:al|a|hasta el|hasta|y el|y)\\s+' + D + '\\s+de\\s+(' + MON_RE + ')(?:\\s+(?:de|del)?\\s*(\\d{4}))?\\b').exec(q))) {
      const m2 = monIdx(m[4]), m1 = m[2] ? monIdx(m[2]) : m2, y = yearOfMonth(m2, ref, yr(m[5]));
      const from = new Date(m1 > m2 ? y - 1 : y, m1, +m[1]).getTime(), to = eod(new Date(y, m2, +m[3]).getTime());
      cut(m[0]); return { p: P(from, to, m1 === m2 ? 'del ' + m[1] + ' al ' + m[3] + ' de ' + MESES[m2] + (y !== REF_YEAR ? ' de ' + y : '') : 'del ' + m[1] + ' de ' + MESES[m1] + ' al ' + m[3] + ' de ' + MESES[m2], 'range'), q: rest };
    }
    if ((m = new RegExp('\\b(?:del|desde el|entre el)\\s+' + D + '\\s+(?:al|a|y el|y|hasta el|hasta)\\s+' + D + '\\b(?!\\s*(?:de\\s+)?' + MON_RE + ')').exec(q)) && +m[1] <= 31 && +m[2] <= 31 && +m[1] < +m[2]) {
      const d = new Date(ref), from = new Date(d.getFullYear(), d.getMonth(), +m[1]).getTime(), to = eod(new Date(d.getFullYear(), d.getMonth(), +m[2]).getTime());
      cut(m[0]); return { p: P(from, to, 'del ' + m[1] + ' al ' + m[2] + ' de ' + MESES[d.getMonth()], 'range'), q: rest };
    }
    // desde X (hasta Y)
    if ((m = new RegExp('\\b(?:desde|a partir de)\\s+(?:el\\s+)?(?:' + D + '\\s+de\\s+)?(' + MON_RE + ')(?:\\s+(?:de|del)?\\s*(\\d{4}))?(?:\\s+(?:hasta|a)\\s+(?:el\\s+)?(?:' + D + '\\s+de\\s+)?(' + MON_RE + ')(?:\\s+(?:de|del)?\\s*(\\d{4}))?)?\\b').exec(q))) {
      const m1 = monIdx(m[2]), y1 = yearOfMonth(m1, ref, yr(m[3])), from = new Date(y1, m1, m[1] ? +m[1] : 1).getTime();
      let to = R0, label = 'desde ' + (m[1] ? m[1] + ' de ' : '') + MESES[m1];
      if (m[5]) { const m2 = monIdx(m[5]), y2 = yearOfMonth(m2, ref, yr(m[6])); to = m[4] ? eod(new Date(y2, m2, +m[4]).getTime()) : eod(new Date(y2, m2, lastDayOfMonth(y2, m2)).getTime()); label = 'de ' + MESES[m1] + ' a ' + MESES[m2]; }
      cut(m[0]); return { p: P(from, Math.min(to, R0), label, 'range'), q: rest };
    }
    if ((m = new RegExp('\\b(?:de|desde)\\s+(' + MON_RE + ')\\s+(?:a|hasta)\\s+(' + MON_RE + ')\\b').exec(q))) {
      const m1 = monIdx(m[1]), m2 = monIdx(m[2]), y2 = yearOfMonth(m2, ref, null), y1 = m1 > m2 ? y2 - 1 : y2;
      cut(m[0]); return { p: P(new Date(y1, m1, 1).getTime(), eod(new Date(y2, m2, lastDayOfMonth(y2, m2)).getTime()), 'de ' + MESES[m1] + ' a ' + MESES[m2], 'range'), q: rest };
    }
    // un día concreto
    if ((m = new RegExp('\\b(?:el\\s+|del\\s+|dia\\s+)?' + D + '\\s+de\\s+(' + MON_RE + ')(?:\\s+(?:de|del)?\\s*(\\d{4}))?\\b').exec(q)) && +m[1] >= 1 && +m[1] <= 31) {
      const mi = monIdx(m[2]), y = yearOfMonth(mi, ref, yr(m[3]));
      cut(m[0]); const t = new Date(y, mi, +m[1]).getTime(); return { p: dayPeriod(t, +m[1] + ' de ' + MESES[mi] + (y !== REF_YEAR ? ' de ' + y : '')), q: rest };
    }
    // semana N
    if ((m = /\b(?:semana|sem)\s+(\d{1,2})\b(?:\s+(?:de|del)\s+(\d{4}))?/.exec(q)) && +m[1] >= 1 && +m[1] <= 53) {
      const y = m[2] ? +m[2] : new Date(ref).getFullYear(), jan1 = new Date(y, 0, 1).getTime();
      let mon = mondayOf(jan1); if (mon < jan1) mon = addDays(mon, 7);
      let found = null;
      for (let t = addDays(mon, -7); t <= new Date(y, 11, 31).getTime(); t = addDays(t, 7)) { const wk = Math.floor((t - jan1) / (7 * DAY)) + 1; if (wk === +m[1]) { found = t; break; } }
      if (found != null) { cut(m[0]); return { p: P(found, eod(addDays(found, 6)), 'semana ' + m[1], 'week'), q: rest }; }
    }
    // trimestre
    if ((m = /\b(?:(primer|1er|1ro|segundo|2do|tercer|3er|cuarto|4to)\s+trimestre|trimestre\s+(\d)|q([1-4])\b)(?:\s+(?:de|del)\s+(\d{4}))?/.exec(q))) {
      const qn = m[3] ? +m[3] : m[2] ? +m[2] : { primer: 1, '1er': 1, '1ro': 1, segundo: 2, '2do': 2, tercer: 3, '3er': 3, cuarto: 4, '4to': 4 }[m[1]];
      const y = m[4] ? +m[4] : new Date(ref).getFullYear(), from = new Date(y, (qn - 1) * 3, 1).getTime(), to = eod(new Date(y, qn * 3, 0).getTime());
      cut(m[0]); return { p: P(from, Math.min(to, R0), qn + 'º trimestre' + (y !== REF_YEAR ? ' de ' + y : ''), 'quarter', { partial: R0 < to, qn, y }), q: rest };
    }
    if ((m = /\btrimestre\s+(?:pasado|anterior)\b|\bultimo trimestre\b/.exec(q))) {
      const d = new Date(ref); let qn = Math.floor(d.getMonth() / 3) + 1 - 1, y = d.getFullYear(); if (qn < 1) { qn = 4; y--; }
      cut(m[0]); return { p: P(new Date(y, (qn - 1) * 3, 1).getTime(), eod(new Date(y, qn * 3, 0).getTime()), 'trimestre pasado (' + qn + 'º)', 'quarter', { qn, y }), q: rest };
    }
    if ((m = /\b(?:este trimestre|trimestre actual|del trimestre|el trimestre|en el trimestre|en lo que va del trimestre)\b/.exec(q))) {
      const d = new Date(ref), qn = Math.floor(d.getMonth() / 3) + 1; cut(m[0]);
      return { p: P(new Date(d.getFullYear(), (qn - 1) * 3, 1).getTime(), R0, 'este trimestre', 'quarter', { partial: true, qn, y: d.getFullYear() }), q: rest };
    }
    // meses calendario
    if ((m = /\b(?:mes pasado|mes anterior|pasado mes|ultimo mes calendario)\b/.exec(q))) {
      const d = new Date(ref); cut(m[0]); const p = monthPeriod(new Date(d.getFullYear(), d.getMonth() - 1, 1).getFullYear(), (d.getMonth() + 11) % 12, ref); p.label = 'el mes pasado (' + MESES[p.m] + ')'; return { p, q: rest };
    }
    if ((m = /\b(?:este mes|mes actual|mes en curso|en lo que va (?:del|de este|de) mes|lo que va del mes|del mes|el mes|en el mes|mensual a la fecha|mtd)\b/.exec(q)) && !/\bmes\s+de\b/.test(q)) {
      const d = new Date(ref); cut(m[0]); const p = monthPeriod(d.getFullYear(), d.getMonth(), ref); p.label = 'este mes (' + MESES[p.m] + ')'; return { p, q: rest };
    }
    // año
    if ((m = /\b(?:ano pasado|ano anterior|pasado ano)\b/.exec(q))) { const y = new Date(ref).getFullYear() - 1; cut(m[0]); return { p: P(new Date(y, 0, 1).getTime(), eod(new Date(y, 11, 31).getTime()), 'el año pasado (' + y + ')', 'year', { y }), q: rest }; }
    if ((m = /\b(?:este ano|ano actual|ano en curso|en lo que va (?:del|de este|de) ano|lo que va del ano|del ano|el ano|en el ano|ytd|este 2026|en 2026)\b/.exec(q))) {
      const y = new Date(ref).getFullYear(); cut(m[0]); return { p: P(new Date(y, 0, 1).getTime(), R0, 'en lo que va de ' + y, 'year', { partial: true, y }), q: rest };
    }
    // semanas
    if ((m = /\b(?:semana pasada|semana anterior|pasada semana)\b/.exec(q))) { const mon = addDays(mondayOf(ref), -7); cut(m[0]); return { p: P(mon, eod(addDays(mon, 6)), 'la semana pasada', 'week'), q: rest }; }
    if ((m = /\b(?:esta semana|semana actual|semana en curso|en lo que va de (?:la )?semana)\b/.exec(q))) { cut(m[0]); return { p: P(mondayOf(ref), R0, 'esta semana', 'week', { partial: true }), q: rest }; }
    if ((m = /\b(?:ultima semana|ultimos dias|ultima quincena|de la semana|la semana|en la semana|semanal a la fecha|ultimos 7 dias)\b/.exec(q)) && !/\bpor semana\b/.test(q)) { cut(m[0]); return { p: P(sod(addDays(ref, -6)), R0, /quincena/.test(m[0]) ? 'últimos 15 días' : 'últimos 7 días', 'rolling', { n: 7, u: 'dias' }), q: rest }; }
    if ((m = /\b(?:ultimo mes|ultimos 30 dias)\b/.exec(q))) { cut(m[0]); return { p: P(sod(addDays(ref, -29)), R0, 'últimos 30 días', 'rolling', { n: 30, u: 'dias' }), q: rest }; }
    if ((m = /\bultimo ano\b/.exec(q))) { cut(m[0]); return { p: P(sod(addDays(ref, -364)), R0, 'últimos 12 meses', 'rolling', { n: 365, u: 'dias' }), q: rest }; }
    // días relativos
    if ((m = /\b(?:anteayer|antier|antes de ayer)\b/.exec(q))) { cut(m[0]); return { p: dayPeriod(addDays(ref, -2), 'anteayer (' + fd(addDays(ref, -2)) + ')'), q: rest }; }
    if ((m = /\bayer\b/.exec(q))) { cut(m[0]); return { p: dayPeriod(addDays(ref, -1), 'ayer (' + fd(addDays(ref, -1)) + ')'), q: rest }; }
    if ((m = /\b(?:hoy|del dia|este dia|en el dia|esta manana|de hoy|el dia de hoy)\b/.exec(q))) { cut(m[0]); return { p: dayPeriod(ref, 'hoy (' + fd(ref) + ')'), q: rest }; }
    if ((m = /\bhace (\d{1,3}) dias?\b/.exec(q))) { cut(m[0]); const t = addDays(ref, -+m[1]); return { p: dayPeriod(t, 'hace ' + m[1] + ' días (' + fd(t) + ')'), q: rest }; }
    if ((m = /\b(?:el\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+pasado)?\b/.exec(q))) {
      const wd = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].indexOf(m[1]); let t = sod(ref); while (new Date(t).getDay() !== wd || t > sod(ref)) t = addDays(t, -1);
      if (t === sod(ref) && /pasado/.test(m[0])) t = addDays(t, -7);
      cut(m[0]); return { p: dayPeriod(t, 'el ' + DIAS[wd] + ' (' + fd(t) + ')'), q: rest };
    }
    // mes por nombre
    if ((m = new RegExp('\\b(?:en |de |del |durante |para |el mes de |mes de |a )?(' + MON_RE + ')(?:\\s+(?:de|del)?\\s*(\\d{4}))?\\b').exec(q))) {
      const full = /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)$/.test(m[1]);
      const hasCtx = /^(en |de |del |durante |para |el mes de |mes de )/.test(m[0]) || m[2] != null;
      if (full || hasCtx || /^(sept|sep|oct|nov|dic|ene|feb|abr|jun|jul|ago)$/.test(m[1])) {
        const mi = monIdx(m[1]), y = yearOfMonth(mi, ref, yr(m[2])); cut(m[0]);
        const p = monthPeriod(y, mi, ref); if (p.partial) p.label = MESES[mi] + ' (en curso)'; return { p, q: rest };
      }
    }
    if ((m = /\b(?:20\d{2})\b/.exec(q)) && !/\bfv|sv|utq|lote\b/.test(q.slice(Math.max(0, m.index - 6), m.index))) {
      const y = +m[0]; if (y >= 2015 && y <= 2040) { cut(m[0]); return { p: P(new Date(y, 0, 1).getTime(), Math.min(eod(new Date(y, 11, 31).getTime()), R0), 'año ' + y, 'year', { y, partial: y === new Date(ref).getFullYear() }), q: rest }; }
    }
    if ((m = /\b(?:todo el historico|todo el historial|historico|historial completo|todos los datos|siempre|desde el inicio|desde que hay datos|toda la historia|en total historico|todo el tiempo|todo el periodo)\b/.exec(q))) { cut(m[0]); return { p: P(0, R0, 'todo el histórico', 'all'), q: rest }; }
    return null;
  }

  // Periodo inmediatamente anterior comparable (mismo tramo del periodo anterior si el actual va en curso)
  function prevPeriod(p, ref) {
    if (!p || p.kind === 'all') return null;
    const len = p.to - p.from + 1;
    if (p.kind === 'day') { const t = addDays(p.from, -1); return dayPeriod(t, 'el día anterior (' + fd(t) + ')'); }
    if (p.kind === 'week') { const f = addDays(p.from, -7); return P(f, p.partial ? eod(addDays(f, Math.round(len / DAY) - 1)) : eod(addDays(f, 6)), 'la semana anterior', 'week'); }
    if (p.kind === 'month') {
      const d = new Date(p.from), f = new Date(d.getFullYear(), d.getMonth() - 1, 1), nd = lastDayOfMonth(f.getFullYear(), f.getMonth());
      const days = p.partial ? Math.min(nd, Math.round(len / DAY)) : nd;
      return P(f.getTime(), eod(new Date(f.getFullYear(), f.getMonth(), days).getTime()), 'el mes anterior (' + MESES[f.getMonth()] + ')', 'month', { y: f.getFullYear(), m: f.getMonth() });
    }
    if (p.kind === 'quarter') { const d = new Date(p.from), f = new Date(d.getFullYear(), d.getMonth() - 3, 1); return P(f.getTime(), p.partial ? eod(addDays(f.getTime(), Math.round(len / DAY) - 1)) : eod(new Date(f.getFullYear(), f.getMonth() + 3, 0).getTime()), 'el trimestre anterior', 'quarter'); }
    if (p.kind === 'year') { const d = new Date(p.from), f = new Date(d.getFullYear() - 1, 0, 1); return P(f.getTime(), p.partial ? eod(addDays(f.getTime(), Math.round(len / DAY) - 1)) : eod(new Date(f.getFullYear(), 11, 31).getTime()), 'el año anterior (' + f.getFullYear() + ')', 'year'); }
    const f = p.from - len;
    return P(f, p.from - 1, 'el periodo anterior (' + rangeTxt(f, p.from - 1) + ')', 'rolling');
  }
  function currentOf(p, ref) {
    const d = new Date(ref);
    if (!p) return null;
    if (p.kind === 'month') { const q = monthPeriod(d.getFullYear(), d.getMonth(), ref); q.label = 'este mes (' + MESES[d.getMonth()] + ')'; return q; }
    if (p.kind === 'week') return P(mondayOf(ref), eod(ref), 'esta semana', 'week', { partial: true });
    if (p.kind === 'day') return dayPeriod(ref, 'hoy (' + fd(ref) + ')');
    if (p.kind === 'year') return P(new Date(d.getFullYear(), 0, 1).getTime(), eod(ref), 'en lo que va de ' + d.getFullYear(), 'year', { partial: true, y: d.getFullYear() });
    if (p.kind === 'quarter') { const qn = Math.floor(d.getMonth() / 3) + 1; return P(new Date(d.getFullYear(), (qn - 1) * 3, 1).getTime(), eod(ref), 'este trimestre', 'quarter', { partial: true, qn }); }
    return null;
  }
  const inP = (r, p) => r.t != null && r.t >= p.from && r.t <= p.to;

  /* ---------------------------------------------------------------- entidades */
  let BR = null;
  function brandMap() {
    const brands = DL().brands();
    const key = brands.join('|');
    if (BR && BR.key === key) return BR;
    const m = {};
    const kb = KB().ALIAS_MARCA || {};
    for (const [k, v] of Object.entries(kb)) m[norm(k)] = v;
    for (const b of brands) { m[norm(b)] = b; }
    const list = Object.keys(m).sort((a, b) => b.length - a.length);
    BR = { key, m, re: list.length ? new RegExp('(?:^|\\s)(' + list.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?=\\s|$)', 'g') : null };
    return BR;
  }
  const TANK_RE = /\b(fv|sv|utq|utk|tq|tanque|unitanque|fermentador|madurador|colector|col|propagador|ypt)\s+(\d{1,2})(?!\d)/g;
  const TANK_KIND = { fv: 'FV', fermentador: 'FV', sv: 'SV', madurador: 'SV', utq: 'UTQ', tq: 'UTQ', tanque: 'UTQ', unitanque: 'UTQ', utk: 'UTK', colector: 'COLECTOR', col: 'COLECTOR', propagador: 'PROPAGADOR', ypt: 'PROPAGADOR' };
  const EQTERMS = [[/\bcentrifuga\b/, 'centrifuga'], [/\bred(?:es)? (?:de )?cosecha\b|\bcosecha\b/, 'cosecha'], [/\bred(?:es)? (?:de )?siembra\b|\bsiembra\b/, 'siembra'], [/\bred(?:es)? (?:de )?mosto\b/, 'mosto'], [/\banillo/, 'anillo'], [/\bautolizador\b/, 'autolizador'], [/\bsoda\b/, 'soda'], [/\btrimeta\b/, 'trimeta'], [/\bagua fresca\b/, 'agua fresca'], [/\bbuffer\b/, 'buffer'], [/\bsilica\b/, 'silica'], [/\bpurgas?\b/, 'purga'], [/\bsanitizante\b/, 'sanitizante'], [/\bpropagador(?:es)?\b/, 'propagador'], [/\bco2\b/, 'co2'], [/\bred(?:es)? (?:de )?trasiego\b/, 'trasiego'], [/\bred(?:es)? (?:de )?cerveza\b/, 'cerveza']];
  const CAUSE_KW = ['diacetilo', 'falta de sv', 'sin cupo', 'temperatura', 'mantenimiento', 'purga', 'falla', 'valvula', 'disponibilidad', 'flujo', 'electrica', 'neumatica', 'demanda', 'aseos entre', 'filtracion', 'centrifuga', 'bomba', 'calibracion', 'amoniaco'];

  function condUnit(u) { return u ? ({ h: 'h', horas: 'h', m3: 'm3', '%': '%', hl: 'hl', min: 'min', p: 'p', kg: 'kg' }[u] || u) : null; }
  function parseConds(q) {
    const conds = []; let rest = q, m;
    const NUM = '(\\d+(?:\\.\\d+)?)', UN = '\\s*(h|horas|m3|%|hl|min|p|kg)?';
    let re = new RegExp('\\bentre\\s+' + NUM + UN + '\\s+y\\s+' + NUM + UN + '\\b');
    if ((m = re.exec(rest))) { conds.push({ op: 'between', v: +m[1], v2: +m[3], u: condUnit(m[2] || m[4]) }); rest = rest.replace(m[0], ' '); }
    else if ((m = new RegExp('\\bde\\s+' + NUM + UN + '\\s+a\\s+' + NUM + '\\s*(h|horas|m3|%|hl|min)\\b').exec(rest))) { conds.push({ op: 'between', v: +m[1], v2: +m[3], u: condUnit(m[4] || m[2]) }); rest = rest.replace(m[0], ' '); }
    re = new RegExp('(?:(mayor(?:es)?|menor(?:es)?|mas|menos|superior(?:es)?|inferior(?:es)?|sobre|bajo|debajo|arriba|supera\\w*|excede\\w*|pasa\\w*|rebasa\\w*|por encima|por debajo|iguales?|igual|al menos|minimo|maximo|hasta)\\s*(?:a|de|que|al|del|los|las|el|la)?\\s*|([<>]=?)\\s*)' + NUM + UN + '(?![\\d.])', 'g');
    while ((m = re.exec(rest))) {
      const w = m[1] || '', sym = m[2];
      let op;
      if (sym) op = sym; else if (/^(mayor|mas|superior|sobre|arriba|supera|excede|pasa|rebasa|por encima)/.test(w) && !/^mas\s*$/.test('') ) op = '>'; else op = '<';
      if (/^(al menos|minimo)/.test(w)) op = '>='; if (/^(maximo|hasta)/.test(w)) op = '<='; if (/^igual/.test(w)) op = '=';
      conds.push({ op, v: +m[3], u: condUnit(m[4]) });
    }
    rest = rest.replace(re, ' ');
    return { conds, rest: rest.replace(/\s+/g, ' ').trim() };
  }

  // by explícito y nombres de dimensión
  const BYWORDS = [[/\b(?:dia|dias|diario|diaria|diarios|diarias)\b/, 'day'], [/\b(?:semana|semanas|semanal|semanales)\b/, 'week'], [/\b(?:mes|meses|mensual|mensuales|mensualmente)\b/, 'month'], [/\b(?:ano|anos|anual|anuales)\b/, 'year'],
    [/\bmarcas?\b/, 'brand'], [/\bturnos?\b/, 'shift'], [/\b(?:tanque|tanques|unitanque|unitanques|utq|fv|sv|fermentador(?:es)?|madurador(?:es)?)\b/, 'tq'], [/\bequipos?\b|\bred(?:es)?\b/, 'eq'], [/\btipo de equipo\b/, 'eqType'], [/\b(?:tipo de aseo|programa de aseo)\b/, 'tipo'],
    [/\boperarios?\b|\bcaveros?\b|\bquien(?:es)?\b/, 'operator'], [/\bcausas?\b|\bmotivos?\b/, 'cause'], [/\butk\b/, 'utk'], [/\bgeneracion(?:es)?\b/, 'gen'], [/\bfamilias?\b/, 'fam'], [/\b(?:actividad(?:es)?|tipo de actividad|clase)\b/, 'kind'],
    [/\b(?:etapa|etapas|fase|fases)\b/, 'phase'], [/\bestados?\b/, 'state'], [/\bcomponentes?\b/, 'component']];
  const TIMEKEYS = ['day', 'week', 'month', 'year'];

  /* ---------------------------------------------------------------- reconocimiento de intención */
  const RXF = {
    saludo: /^(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hey|saludos|quiubo|que mas|ola)\b/,
    gracias: /\b(gracias|te agradezco|muy amable|listo gracias|perfecto|genial|excelente|chevere|bacano|super|vale|dale|ok|okey|entendido)\b/,
    chao: /\b(chao|adios|hasta luego|nos vemos|bye)\b/,
    ayuda: /\b(ayuda|ayudame|que sabes|que puedes|que puedo preguntar|que me puedes|que haces|para que sirves|capacidades|que preguntas|que se te puede|opciones|comandos|menu|que se puede preguntar|ejemplos|como te uso|como funciona esto|que mas sabes|en que me ayudas|que cosas)\b/,
    chart: /\b(graficame|grafica|graficar|graficas|graficos?|grafiquen?|visualiza\w*|dibuja\w*|plot|diagrama|barras|lineas|torta|pastel|curva|evolucion|tendencia|serie de tiempo|a traves del tiempo|como ha (cambiado|evolucionado|variado|ido|venido)|historico de|comportamiento)\b/,
    compare: /\b(vs|versus|frente a|frente al|comparad[oa]s?|compar\w+|contra|diferencia entre|respecto a|respecto al|en comparacion|comparando)\b/,
    cause: /\bpor que\b|\bcausas? de que\b|\ba que se (debe|deben)\b|\bque paso con\b|\bque provoco\b|\bque origino\b|\bque (esta )?(pasando|afectando|explica|influyo|influye)\b|\bexplica\w*\b|\bculpable\b|\bcausa\b.*\b(subi\w*|baj\w*|aument\w*|disminu\w*|cambi\w*|alz\w*|cay\w*|crec\w*|empeor\w*)|\b(subi\w*|baj\w*|aument\w*|disminu\w*|cay\w*|crec\w*|empeor\w*)\b.*\b(causa|motivo|razon)\b|\bmotivo\b|\brazon\b/,
    forecast: /\b(proyecci\w+|pronostic\w+|predic\w+|vamos a (gastar|consumir|perder|recuperar|hacer|cerrar|producir|terminar|llegar)|va a (gastar|consumir|cerrar|terminar)|cerrar\w* (el )?mes|\bcier(ra|re|rr)\w* (el |de )?(mes|ano)|cerraremos|terminaremos|fin de mes|(proximo|siguiente) (mes|semana|ano|trimestre)|proxima semana|estimad[oa] (de|para)|a este ritmo|al ritmo actual|tendencia futura|gastaremos|consumiremos|perderemos|recuperaremos|que esperar\w*|cuanto (nos falta|llevamos para))\b/,
    whatif: /\bsi (bajamos|reducimos|disminuimos|subimos|aumentamos|logramos|llevamos|pasamos|cumplimos|hacemos|el \d+|todos|dejamos|eliminamos|elimin\w+|mejoramos|cortamos|ahorramos|bajaramos|redujeramos|se hace|se reduce|baja|sube|la merma|el consumo|las recuperaciones|los trasiegos|los aseos|bajara|llegamos|llegara|lo llevamos)\b|\bque pasaria si\b|\bque pasa si\b|\bque ganamos\b|\bcuanto (ahorr\w+|ganar\w+|recuper\w+|bajar\w+) si\b|\bsimul\w+|\bescenario\b|\bsupon\w+ que\b|\by si (bajamos|reducimos|el|la|los|las)\b/,
    anom: /\b(raro|rara|raros|raras|rarezas?|anomali\w+|atipic\w+|outliers?|fuera de (lo )?(normal|rango|limite\w*|meta|control)|inusual\w*|extran\w+|sospechos\w+|disparad\w+|se salio|se salen|picos?|anormal\w*|desviad\w+|alarmante\w*|problema\w*)\b/,
    reco: /\bque (deberia|deberiamos|debo|debemos|tengo que|hay que|conviene|toca|reviso|revisar|revisamos|atiendo|atendemos|corrijo|corregimos)\b|\bdeberia\w* revisar\b|\bprioridad\w*|\brecomien\w+|\bsugier\w+|\bpor donde empiezo\b|\bpendientes?\b|\blo mas importante\b|\blo importante\b|\bque urge\b|\burgente\w*|\bque (esta )?pasando hoy\b|\bque hay que mirar\b|\bpuntos de atencion\b|\brevisar hoy\b|\bque miro\b|\balertas?\b/,
    ahorro: /\bahorr\w+|\boptimiz\w+|\boportunidad\w*|\bdesperdicio\w*|\bdonde (puedo|podemos|se puede) (mejorar|bajar|reducir|recortar|disminuir)|\bpotencial\b|\brecortar\b/,
    summary: /\bresumen\b|\bresumeme\b|\bresumir\b|\bpanorama\b|\bbalance\b|\bcomo (vamos|va todo|estamos|andamos|nos fue|nos va|va el (dia|mes|turno|ano)|ha ido)\b|\bestado general\b|\bsituacion\b|\bnovedades?\b|\bque paso (hoy|ayer|esta semana|este mes|en el turno|en la semana|en el mes)\b|\bcuentame\b|\bponme al dia\b/,
    quality: /\bcalidad de (los )?datos\b|\bdatos (faltantes|faltan|vacios|incompletos|inconsistentes|sucios|malos|dudosos|erroneos|incorrectos)\b|\bque (datos )?faltan\b|\blecturas? (invalid|faltan|erroneas|malas|incorrectas)\w*|\bconfiab\w+|\bconfio\b|\bvacios\b|\binconsistenc\w+|\bsin (dato|datos|causa|caudal|lectura|marca|registro|minutos)\b|\binvalid\w+|\bhuecos\b|\bcobertura\b|\bcompletitud\b|\bdesde cuando (hay|tenemos)\b|\bhasta (que|cuando) fecha\b|\bhasta donde llegan\b|\bcuantos registros\b|\bno (tienen|tiene|hay|registran|trae|traen) (caudal|minutos|causa|marca|dato|datos|lectura|lecturas|registro)\b|\bfaltan datos\b|\bque tan buenos\b|\bdatos imposibles\b|\bvalores imposibles\b/,
    dist: /\b(distribuci\w+|histograma|variabilidad|dispersion|rango tipico|que tan (variable|estable)|estabilidad|desviacion estandar|cuartiles?|percentil\w*|boxplot|diagrama de caja|como se reparte|como se distribuye)\b/,
    corr: /\b(relacion|correlacion|correlaciona\w*|depende\w*|influye\w*|asociad[oa]|se relaciona\w*|afecta\w*|vinculo|impacto)\b/,
    rank: /\b(top ?\d*|ranking|mejores|peores|mayores|menores|principales|primeros|que (\w+ ){0,2}(tiene|consume|gasta|pierde|recupera|fermenta|hace|registra|genera|tarda|demora|aporta|usa) (mas|menos|mejor|peor)|que (mas|menos|mejor|peor) \w+ (tiene|consume|gasta|pierde|recupera|fermenta|hace|registra|genera|tarda|demora|aporta|usa)|(el|la) \w+ que (mas|menos)|cual(es)? (es|son|fue|fueron) (el|la|los|las) (que )?(mas|menos|mayor|menor|peor|mejor)|quien\w* (hace|tiene|registra|consume|realiza) (mas|menos)|el (mayor|menor|peor|mejor)|la (mayor|menor|peor|mejor)|mas (alto|alta|bajo|baja|largo|larga|lento|lenta|rapido|rapida|corto|corta)|de (mayor|menor) |(mas|menos) (merma|consumo|desvio|gasto|aseos|trasiegos|recuperacion|viabilidad))\b/,
    list: /\b(lista\w*|listame|muestrame (los|las)|dame (los|las)|cuales (son|fueron|estan)|detalle de|detalla\w*|enumera\w*|ver (los|las)|filas|registros de)\b/,
    docs: /\b(documento\w*|procedimiento\w*|instructivo\w*|manual\w*|formato\w*|sop\b|politica\w*|norma\w*|guia\w* de)\b/,
    nav: /\b(abre|abrir|abreme|llevame|ir a|ve a|navega\w*|muestrame la (seccion|pantalla|pagina|vista)|ver en analisis|en analisis|abrelo|quiero ver|llevame a)\b/,
    report: /\b(reporte|informe)\b/,
    exportar: /\b(exporta\w*|descarga\w*|bajame|bajalo|pasalo a excel|en excel|a excel|csv|sacar excel|guardalo|bajar excel|excel de eso)\b/,
    more: /\b(mas detalle|detalla\w*|profundiza\w*|ampli\w+|desglosa\w*|desglose|expande|dime mas|explicame mas|mas informacion|mas info|ver mas|mas datos|a fondo)\b/,
    programado: /\b(programad\w+|agendad\w+|proximos? (trasiegos|aseos|cip)|que sigue|siguientes trasiegos|plan de trasiego|por hacer|falta por hacer|planead\w+)\b/,
    yMarker: /^(y|e|tambien|ahora|pero|entonces|ademas|y que|y como|y en|y de|y si|y para|y con|de)\b/,
    count: /\bcuant[oa]s\b|\bnumero de\b|\bcantidad de\b|\bconteo\b|\bcuenta de\b|\btotal de (aseos|lotes|trasiegos|fermentaciones|cosechas|recuperaciones|turnos|lecturas)\b/,
    sum: /\b(total|suma|sumando|acumulad\w+|en total|sumatoria|cuanto (gastamos|consumimos|perdimos|recuperamos|se gasto|se consumio|se perdio|llevamos|hemos gastado|hemos perdido)|gastamos|consumimos|perdimos|recuperamos|llevamos|hemos (gastado|perdido|recuperado))\b/,
    mean: /\b(promedio|promedi\w+|media|en promedio|tipic\w+|normalmente|por lo general|habitual\w*|medio|media de)\b/,
    median: /\bmediana\b/,
    max: /\b(maximo|maxima|pico|record|mayor|mas alto|mas alta|mas largo|mas larga|mas lenta|mas lento|mas grande)\b/,
    min: /\b(minimo|minima|mas bajo|mas baja|mas corto|mas corta|mas rapido|mas rapida|menor)\b/,
    oldHint: /\b(t ?0|vence\w*|retir\w+|siembr\w+|cosechar|linaje|genealog\w+|traza\w*|libres?|ocupad\w+|alta\b|extracto actual|cuanto falta|que sigue|que hago primero|prioridad\w*|disponible\w*|inventario|f\d{3}\b|[a-z]{2}\d+f\d+|como va (el|la) (fv|tanque|colector)|estado del (fv|tanque)|llevame a (colectores|tanques|levaduras)|contrasena|diagnostic\w*|arregl\w+|guiame)\b/,
    accion: /\b(registra\w*|marca\w* (c\d|colector)|saca\w* \d+ hl|cambiar contrasena|cambia\w* (la )?contrasena|anota\w*|guarda\w* (una )?(muestra|nota))\b/,
  };

  const DSRX = {
    agua: [[/\b(agua|aguas|hidric\w*|consumo|consumos|gasto|gastos|gastamos|gastado|gastar|gasta|consumimos|consumido|consume|consumen|m3|pisos|gea)\b/, 2], [/\bhl procesad|\bpor hl\b|\bhl\/hl\b/, 1], [/\bturnos?\b/, 0.7]],
    aseos: [[/\b(aseos?|limpiez\w+|lavad\w+|lavado|enjuagu\w+)\b/, 3.2], [/\bcip\b/, 1.2], [/\b(operarios?|caveros?)\b/, 1], [/\b(centrifuga|red de|redes|anillo|autolizador)\b/, 0.9], [/\bcaudal\b/, 1]],
    merma: [[/\b(merma|mermas|perdida|perdidas|perdimos|perdemos|pierde|pierden|perdio|faltante|kge)\b/, 3.2], [/\blotes? cerrad\w+|\bcerramos\b.*\blotes?\b/, 2.5], [/\bpurgas?\b/, 1.5], [/\bsaldo negativo|saldos negativos\b/, 1.5]],
    recuperacion: [[/\brecuper\w+/, 3.2], [/\butk\b/, 2], [/\bcerveza recuperada\b/, 2]],
    trasiego: [[/\b(trasiego|trasiegos|trasegad\w+|trasegar|programa de trasiego|traslado)\b/, 3.2], [/\bdesvios?\b|\bretrasos?\b|\batrasos?\b/, 1.6], [/\bprogramad\w+/, 1]],
    ferm: [[/\b(fermentacion|fermentaciones|fermenta|fermentan|fermentar|fermento|fermentador\w*|atenuacion|h ?75|h ?15|e ?72|rdf|extracto|extractos)\b/, 3], [/\b(eo|el)\b/, 0.5], [/\b(lento|lenta|lentas|lentos|rapid\w+)\b/, 0.8], [/\bfv\b/, 1.2], [/\bllenado\b/, 1.5]],
    lev: [[/\b(levadura|levaduras|viabilidad|cosecha|cosechas|consistencia|cepa|cepas)\b/, 3], [/\bgeneracion(es)?\b|\bfamilias?\b/, 1.4], [/\betanol\b/, 1.5], [/\bdescartad\w+|vaciad\w+|utilizad\w+/, 1]],
  };
  const NEWSTRONG = /\b(agua|aseos?|merma|mermas|recuper\w+|trasiego\w*|desvios?|h ?75|h ?15|e ?72|atenuacion|fermentaciones|cosechas|kge|pisos|gea|hl procesado|lotes cerrados|programa de trasiego|consumo)\b/;

  function scoreDs(q) {
    const sc = { agua: 0, aseos: 0, merma: 0, recuperacion: 0, trasiego: 0, ferm: 0, lev: 0 };
    for (const [ds, list] of Object.entries(DSRX)) for (const [re, w] of list) if (re.test(q)) sc[ds] += w;
    // matices
    if (/\bconsumo\b|\bagua\b|\bgasto\b|\bgastamos\b/.test(q) && sc.aseos >= 3) { if (/\bagua (usada|gastada|de|en|por)\b.*\baseos?\b|\bconsumo (de agua )?(por|de|en) aseos?\b|\baseos?\b.*\b(consumo|agua|m3|gasta)\b/.test(q)) { sc.aseos += 1.5; sc.agua = Math.min(sc.agua, 1.5); } }
    if (sc.recuperacion >= 3 && /\blevadura\b/.test(q) && sc.lev < 4) sc.lev = Math.min(sc.lev, 2);
    if (/\bviabilidad\b/.test(q) && sc.ferm > 0 && !/\bfermentaci/.test(q)) sc.ferm = Math.min(sc.ferm, 1.2);
    if (/\bcip\b/.test(q) && /\b(consumo|gasto|gastamos|agua|pisos|gea)\b/.test(q) && !/\baseos?\b/.test(q)) { sc.agua += 2; sc.aseos = Math.min(sc.aseos, 1.2); }
    if (/\bcip\b/.test(q) && /\btrasiego|programa|centrifuga|cuantos cip/.test(q) && sc.aseos < 3.5 && !/\baseos?\b/.test(q)) sc.trasiego += /centrifuga/.test(q) ? 2.6 : 1;
    return sc;
  }

  /* ---------------------------------------------------------------- estado y memoria de la conversación */
  const S = { mem: LS.get('cifra.mem.v1', { last: null }), lastExp: null, depth: 0, counter: 0 };
  const remember = (spec) => { S.mem.last = spec; LS.set('cifra.mem.v1', S.mem); };
  const NAVT = [
    ['analisis', /\banalisis\b|\banalitica\b/], ['constructor', /\bconstructor\b/], ['informe', /\binforme\b|\breporte\b/],
    ['agua', /\bagua\b|\bconsumo\b/], ['aseos', /\baseos?\b/], ['recuperacion', /\brecuperacion\b|\brecuperada\b/], ['programa', /\btrasiegos?\b|\bprograma\b/], ['merma', /\bmerma\b/],
    ['inicio', /\binicio\b|\bportada\b|\bhome\b|\bpagina principal\b/], ['tanques', /\btanques\b|\bfermentadores\b/], ['colectores', /\bcolectores\b/], ['levaduras', /\blevaduras?\b/], ['historial', /\bhistorial\b|\bhistorico\b/],
    ['bd', /\bbase de datos\b|\bbd\b/], ['config', /\bconfiguracion\b|\bajustes\b/], ['alertas', /\balertas\b/], ['pantalla', /\bpantalla\b/],
  ];
  const NAVLABEL = { agua: 'Agua', aseos: 'Aseos', recuperacion: 'Recuperación', programa: 'Programa de trasiego', merma: 'Merma', inicio: 'Inicio', tanques: 'Tanques', colectores: 'Colectores', levaduras: 'Levaduras', historial: 'Historial', bd: 'Base de datos', config: 'Configuración', alertas: 'Alertas', pantalla: 'Pantalla', analisis: 'Análisis', constructor: 'Constructor', informe: 'Informe' };
  const TABRX = [['agua', /\bagua\b|\bconsumo\b/], ['operacion', /\baseos?\b|\btrasiego\w*|\boperacion\b|\bprograma\b/], ['merma', /\bmerma\b/], ['fermentacion', /\bferment\w+|\batenuacion\b/], ['levadura', /\blevadura\b|\bviabilidad\b/], ['recuperacion', /\brecuper\w+/], ['relaciones', /\brelacion\w*|\bcorrelacion\w*/], ['pronosticos', /\bpronostic\w+|\bproyecc\w+/], ['constructor', /\bconstructor\b|\bpersonaliz\w+/], ['calidad', /\bcalidad\b/], ['informe', /\binforme\b|\breporte\b/], ['resumen', /\bresumen\b/]];
  function navTarget(q) {
    if (/\banalisis\b|\banalitica\b/.test(q)) { const t = TABRX.find(([, re]) => re.test(q)); return { ruta: 'analisis' + (t ? '/' + t[0] : ''), label: 'Análisis' + (t ? ' · ' + (A.Analisis && A.Analisis.pestanas.find((p) => p.id === t[0]) ? A.Analisis.pestanas.find((p) => p.id === t[0]).label : t[0]) : '') }; }
    for (const [k, re] of NAVT) if (k !== 'analisis' && re.test(q)) return { ruta: k === 'constructor' ? 'analisis/constructor' : k === 'informe' ? 'analisis/informe' : k, label: NAVLABEL[k] };
    return null;
  }
  const DOCS_TOPIC = [[/aseos?|limpieza|cip/, 'aseos'], [/agua|consumo/, 'agua'], [/merma/, 'merma'], [/recuper/, 'recuperacion'], [/trasiego|programa/, 'trasiego'], [/ferment/, 'fermentacion'], [/levadura|viabilidad/, 'levadura']];

  /* ---------------------------------------------------------------- comprensión: texto → plan */
  const cloneJ = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  function defaultPeriod(ds, ref) {
    const y = new Date(ref).getFullYear();
    return P(new Date(y, 0, 1).getTime(), eod(ref), 'en lo que va de ' + y, 'year', { partial: true, y, dflt: true });
  }
  const DS_KEYS = ['agua', 'aseos', 'merma', 'recuperacion', 'trasiego', 'ferm', 'lev'];

  const DEF_EX = { aseos: /\b(agua|consumo|gast\w*|m3|litros|usad\w*|usamos)\b/, merma: /\b(merma|mermas|perdid\w*|perdimos)\b/, agua: /\b(agua|consumo|gast\w*|consumimos)\b/, recuperacion: /\b(recuper\w*|cerveza)\b/, lev: /\b(viabilidad)\b/ };
  function detectMetric(ds, q) {
    const list = MET[ds] || [];
    for (const m of list) if (!m.def && m.re.test(q)) return { k: m.k, explicit: true };
    const d = list.find((m) => m.def);
    return { k: d ? d.k : null, explicit: !!(DEF_EX[ds] && DEF_EX[ds].test(q)) };
  }

  function detectBy(q) {
    for (const [re, k] of BYWORDS) {
      const src = re.source.replace(/\\b/g, '');
      if (new RegExp('\\b(?:por|segun|de cada|cada|para cada)\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+)?(?:' + src + ')\\b').test(q)) return k;
    }
    return null;
  }

  function understand(text) {
    const raw = String(text == null ? '' : text).trim();
    const q0 = norm(raw);
    const ref = refTime();
    const plan = { raw, ref, intent: null, conf: 0, spec: null, fixed: [], q: q0 };
    if (!q0) { plan.intent = 'vacio'; return plan; }
    const cc = correct(q0);
    let q = cc.q;
    plan.q = q; plan.fixed = cc.fixed;
    const ntok = q.split(' ').length;
    const F = {}; for (const [k, re] of Object.entries(RXF)) F[k] = re.test(q);
    plan.F = F;
    operators();

    if (F.accion) { plan.intent = 'legacy'; plan.why = 'accion'; return plan; }
    const dsw = scoreDs(q);
    const bestDs = Object.entries(dsw).sort((a, b) => b[1] - a[1]);
    const anyData = bestDs[0][1] >= 1.2;
    // charla
    if (ntok <= 6 && F.saludo && !anyData && !F.ayuda) { plan.intent = 'saludo'; plan.conf = 1; return plan; }
    if (ntok <= 4 && F.gracias && !anyData) { plan.intent = 'gracias'; plan.conf = 1; return plan; }
    if (ntok <= 3 && F.chao) { plan.intent = 'chao'; plan.conf = 1; return plan; }
    if (F.ayuda && !anyData) { plan.intent = 'ayuda'; plan.conf = 1; return plan; }

    /* ---- entidades ---- */
    const X = { brands: [], tanks: [], shifts: [], ops: [], eqTerms: [], eqTypes: [], phases: [], cause: null, state: null, kind: null };
    let w = q.replace(/desviacion estandar|extracto original|aguila light/g, (m) => (m === 'aguila light' ? ' light ' : m === 'extracto original' ? ' extractooriginal ' : ' '));
    const bm = brandMap();
    if (bm.re) { w = w.replace(bm.re, (m, a) => { X.brands.push(bm.m[a]); return ' '; }); X.brands = uniq(X.brands); }
    w = w.replace(TANK_RE, (m, k, n) => { X.tanks.push({ kind: TANK_KIND[k], n: +n }); return ' '; });
    w = w.replace(/\b(?:turno\s+(?:de\s+(?:la\s+)?)?|(?:por|de|en)\s+la\s+)(manana|tarde|noche)\b|\b(manana|tarde|noche)\s+turno\b/g, (m, a, b) => { X.shifts.push(a || b); return ' '; });
    if (F.compare) w = w.replace(/\b(manana|tarde|noche)\b/g, (m) => { X.shifts.push(m); return ' '; });
    X.shifts = uniq(X.shifts).map((s) => ({ manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }[s]));
    for (const t of operators().main) if (new RegExp('\\b' + t + '\\b').test(w) && !/^(ivan|jean|luis)$/.test('') ) { X.ops.push(t); w = w.replace(new RegExp('\\b' + t + '\\b', 'g'), ' '); }
    for (const [re, sub] of EQTERMS) if (re.test(w)) X.eqTerms.push(sub);
    if (/\bfv\b|\bfermentadores\b/.test(w) && !X.tanks.length) X.phases.push('FV');
    if (/\bsv\b|\bmaduradores\b/.test(w) && !X.tanks.length) X.phases.push('SV');
    if (/\bunitanques?\b|\butq\b/.test(w)) X.eqTypes.push('FV', 'SV');
    if (/\bcolectores\b/.test(w)) X.eqTypes.push('COLECTOR');
    if (/\bdescartad\w+/.test(w)) X.state = 'descartada'; else if (/\bvaciad\w+/.test(w)) X.state = 'vaciada'; else if (/\butilizad\w+/.test(w)) X.state = 'utilizada'; else if (/\ben inventario\b/.test(w)) X.state = 'inventario';
    if (/\bcips?\b.*\bcentrifuga|\bcip\b/.test(w) && /trasiego|programa|cuantos cip/.test(w)) X.kind = 'CIP';
    if (/\btrasiegos?\b/.test(w) && !/\bcip\b/.test(w)) X.kind = 'Trasiego';
    for (const kw of CAUSE_KW) if (w.includes(kw) && /\bcausa\b|\bpor\b|\bdebido\b|\bmotivo\b|\bdesvio\b/.test(w)) { X.cause = kw; break; }

    if (X.shifts.length) { dsw.agua += 2.2; bestDs.splice(0, bestDs.length, ...Object.entries(dsw).sort((a, b) => b[1] - a[1])); }
    // periodo
    let pr = null;
    let split = null;
    const cmpCue = /\s(vs|versus|frente a|frente al|contra|comparad[oa] con|compar\w+ con|con el|con la|con los|con las|con|y el|y la|y los|y las)\s/.exec(' ' + w + ' ');
    if (F.compare && cmpCue) {
      const wi = (' ' + w + ' ').slice(1, -1), idx = (' ' + w + ' ').indexOf(cmpCue[0]) - 1;
      const left = wi.slice(0, Math.max(0, idx)), right = wi.slice(Math.max(0, idx) + cmpCue[0].length - 1);
      const pa = parsePeriod(left, ref), pb = parsePeriod(right, ref);
      if (pa && pb) split = { a: pa.p, b: pb.p };
      else if (pb && !pa) split = { a: null, b: pb.p };
      else if (pa && !pb) split = { a: pa.p, b: null };
    }
    pr = parsePeriod(w, ref);
    let period = pr ? pr.p : null;
    if (split && split.a) period = split.a;
    if (pr) w = pr.q;
    if (split) { for (const p of [split.a, split.b]) if (p) { /* se quitan las palabras de tiempo ya consumidas */ } w = parsePeriod(w, ref) ? parsePeriod(w, ref).q : w; }
    // condiciones numéricas
    const pc = parseConds(w);
    let conds = pc.conds; w = pc.rest;
    // topN
    let topN = null, mt;
    if ((mt = /\btop ?(\d{1,3})\b|\b(\d{1,3})\s+(?:mejores|peores|mayores|menores|principales|primeros|mas)\b|\blos (\d{1,3}) (?:mas|principales|mayores|peores|mejores)\b/.exec(w))) topN = +(mt[1] || mt[2] || mt[3]);
    else if (/\btop\b|\branking\b/.test(w)) topN = 5;
    else if (/\bel (mayor|menor|peor|mejor)\b|\bla (mayor|menor|peor|mejor)\b|\bmas (largo|larga|lento|lenta|alto|alta)\b|\bde (mayor|menor)\b|\b(el|la) \w+ que (mas|menos)\b|\bcual fue (el|la)\b.*\b(mas|mayor|menor|peor|mejor)\b/.test(w)) topN = 1;

    /* ---- dataset ---- */
    let ds = null, dsConf = 0;
    if (bestDs[0][1] >= 1.2) {
      ds = bestDs[0][0]; dsConf = bestDs[0][1];
      const second = bestDs[1][1];
      if (second > 0 && bestDs[0][1] - second < 1) plan.ambig = [bestDs[0][0], bestDs[1][0]];
    }
    if (F.corr && /\b(viabilidad|consistencia)\b/.test(q) && /\b(h ?75|h ?15|e ?72|atenuacion|rapid\w+|lent\w+|velocidad)\b/.test(q)) { ds = 'ferm'; dsConf = Math.max(dsConf, 3); }
    // métricas de componentes del agua
    const comps = ['pisos', 'cip', 'gea'].filter((c) => new RegExp('\\b' + c + '\\b').test(q));
    // seguimiento: sin tema nuevo
    const last = S.mem.last;
    const yM = F.yMarker && ntok <= 9;
    let followUp = false;
    if (!ds && last && last.ds) followUp = true;
    else if (ds && last && yM && !F.summary) followUp = false;

    // ¿legacy?
    const newStrong = NEWSTRONG.test(q);
    if (!followUp && RXF.oldHint.test(q) && !newStrong && !F.summary && !F.reco) { plan.intent = 'legacy'; plan.why = 'old'; return plan; }

    // plataforma / glosario
    const askHow = /\b(donde|como|para que sirve|que es|que son|que hay|cual es|puedo|se puede|sirve|eres|usas|funcionas|llamas|quien eres|que eres|que significa|significa|quiere decir|se calcula)\b/.test(q);
    const NOCUE = new Set(['cargar', 'captura', 'exportar', 'grafica', 'metas', 'nombre', 'ia', 'privacidad', 'pin']);
    const sect = /\b(seccion|pantalla|pagina|modulo|apartado|menu|boton|opcion)\b/.test(q);
    const defCue = /\b(que es|que son|que significa|significa|quiere decir|significado|define|definicion|como se (calcula|mide|saca|obtiene)|a que se refiere|que mide|para que sirve el|para que sirve la)\b/.test(q);
    const gl = KB().GLOSARIO.find((g) => g.re.test(q));
    const pl = KB().PLATAFORMA.find((g) => {
      if (!g.re.test(q)) return false;
      if (g.k === 'informe') return /\b(que es|donde (esta|veo|encuentro)|para que sirve|que (contiene|trae|incluye))\b/.test(q);
      return askHow || NOCUE.has(g.k);
    });
    const asksData = F.count || F.sum || F.mean || F.chart || F.compare || F.rank || F.list || period || F.cause;
    if (pl && (sect || !gl || !defCue) && !(gl && defCue && !sect)) { plan.intent = 'plataforma'; plan.item = pl; plan.conf = 0.9; return plan; }
    if (gl && (defCue || (askHow && !asksData && !anyData))) { plan.intent = 'glosario'; plan.item = gl; plan.conf = 0.9; return plan; }
    if (gl && ntok <= 3 && !anyData) { plan.intent = 'glosario'; plan.item = gl; plan.conf = 0.7; return plan; }

    // documentos
    if (F.docs && /\b(documento\w*|procedimiento\w*|instructivo\w*|manual\w*|formato\w*|sop)\b/.test(q)) { plan.intent = 'docs'; plan.conf = 0.8; plan.topic = (DOCS_TOPIC.find(([re]) => re.test(q)) || [])[1] || null; plan.text = raw; return plan; }

    // reporte / navegación
    const nt = navTarget(q);
    const giveRep = /\b(dame|damelo|genera\w*|arma\w*|quiero|necesito|prepara\w*|abre|abreme|crea|haz|hazme|saca\w*|imprime\w*|un|el|ver)\b/.test(q);
    if (F.report && giveRep && !gl && !pl && ntok <= 8 && !F.summary) { plan.intent = 'reporte'; plan.conf = 0.9; return plan; }
    if (F.nav && nt && !(F.sum || F.count || F.forecast)) { plan.intent = 'nav'; plan.nav = nt; plan.conf = 0.9; return plan; }
    if (F.nav && /\banalisis|constructor\b/.test(q) && last && !nt) { plan.intent = 'nav'; plan.nav = { ruta: 'analisis', label: 'Análisis' }; plan.fromMem = true; plan.conf = 0.8; return plan; }

    // exportar / más detalle sobre lo último
    if (F.exportar && !ds && last) { plan.intent = 'exportar'; plan.conf = 0.9; return plan; }
    if (F.exportar && last && ntok <= 5) { plan.intent = 'exportar'; plan.conf = 0.8; return plan; }

    /* ---- inteligencia transversal ---- */
    const scoped = ds && dsConf >= 1.2 ? ds : null;
    if (F.programado && (ds === 'trasiego' || /\btrasiegos?\b/.test(q) || /\bcip\b/.test(q) || !ds)) { plan.intent = 'programado'; plan.conf = 0.85; plan.spec = { intent: 'programado', ds: 'trasiego', brands: X.brands, kind: X.kind }; return plan; }
    if (F.quality && !F.cause) { plan.intent = 'calidad'; plan.conf = 0.9; plan.spec = { intent: 'calidad', ds: scoped, period }; return plan; }
    if (F.summary && !(RXF.oldHint.test(q) && !newStrong) && !/\bresumen\b.*\b(planta|operacion)\b|\bresumen de la (planta|operacion)\b/.test(q)) {
      plan.intent = 'resumen'; plan.conf = 0.9;
      plan.spec = { intent: 'resumen', ds: scoped, period, turn: /\bturno\b/.test(q) && !period, brands: X.brands };
      return plan;
    }
    if (/\bresumen\b.*\b(planta|operacion)\b|\bresumen de la (planta|operacion)\b/.test(q) && !newStrong) { plan.intent = 'legacy'; plan.why = 'resumen-planta'; return plan; }
    if (F.reco && !F.forecast && !(F.rank && ds)) { plan.intent = 'revisar'; plan.conf = 0.9; plan.spec = { intent: 'revisar', ds: scoped, period }; return plan; }
    if (F.ahorro && !F.whatif) { plan.intent = 'ahorro'; plan.conf = 0.9; plan.spec = { intent: 'ahorro', ds: scoped, period }; return plan; }
    if (F.anom && !F.cause && (!ds || /\batipic|\bturnos?\b|\braro|\bfuera de lo normal|\banomal|\bsospech/.test(q))) { plan.intent = 'anomalias'; plan.conf = 0.9; plan.spec = { intent: 'anomalias', ds: scoped, period, brands: X.brands }; return plan; }

    /* ---- seguimientos sin tema ---- */
    if (!ds && last && last.ds) {
      const spec = cloneJ(last); spec.followed = true;
      let changed = false;
      if (X.brands.length) { spec.brands = X.brands; changed = true; if (X.brands.length > 1) spec.cmp = { kind: 'brand', items: X.brands }; }
      if (period) { spec.period = period; changed = true; }
      if (X.tanks.length) { spec.tanks = X.tanks; changed = true; }
      if (X.shifts.length) { spec.shifts = X.shifts; changed = true; }
      if (X.ops.length) { spec.ops = X.ops; changed = true; }
      if (conds.length) { spec.conds = conds; changed = true; }
      if (topN) { spec.topN = topN; spec.intent = spec.by || spec.intent === 'rank' ? 'rank' : spec.intent; if (!spec.by && DIMS[spec.ds]) { /* conserva */ } changed = true; }
      const byk = detectBy(q);
      if (byk && (DIMS[spec.ds] && (DIMS[spec.ds][byk] !== undefined) || TIMEKEYS.includes(byk))) { spec.by = byk; spec.intent = spec.intent === 'trend' || TIMEKEYS.includes(byk) ? 'trend' : 'stat'; changed = true; }
      const mm = detectMetric(spec.ds, w);
      if (mm.explicit && mm.k !== spec.metric) { spec.metric = mm.k; changed = true; }
      if (F.compare && !spec.cmp) {
        if (split && split.b) { spec.cmp = { kind: 'period', a: split.a || spec.period || defaultPeriod(spec.ds, ref), b: split.b }; spec.intent = 'compare'; changed = true; }
        else if (period) { spec.cmp = { kind: 'period', a: last.period || defaultPeriod(spec.ds, ref), b: period }; spec.period = spec.cmp.a; spec.intent = 'compare'; changed = true; }
        else if (X.brands.length) { spec.cmp = { kind: 'brand', items: uniq([...(last.brands || []), ...X.brands]) }; if (spec.cmp.items.length < 2) spec.cmp.items.unshift('*'); spec.intent = 'compare'; changed = true; }
        else { spec.cmp = { kind: 'period', a: spec.period || defaultPeriod(spec.ds, ref), b: prevPeriod(spec.period || defaultPeriod(spec.ds, ref), ref) }; spec.intent = 'compare'; changed = true; }
      } else if (F.compare && spec.cmp && (period || X.brands.length)) { changed = true; }
      if (F.chart) { spec.chart = true; if (spec.intent === 'stat' || spec.intent === 'count') spec.intent = spec.by ? spec.intent : 'trend'; changed = true; }
      if (F.more) { spec.intent = 'list'; spec.more = true; changed = true; }
      if (F.dist) { spec.intent = 'dist'; changed = true; }
      if (F.mean) { spec.how = 'mean'; changed = true; } else if (F.sum) { spec.how = 'sum'; changed = true; } else if (F.max && !F.rank) { spec.how = 'max'; changed = true; } else if (F.median) { spec.how = 'median'; changed = true; }
      if (F.rank && !topN) { spec.intent = 'rank'; changed = true; }
      if (F.cause) { spec.intent = 'cause'; changed = true; }
      if (F.forecast) { spec.intent = 'forecast'; changed = true; }
      if (F.whatif) { spec.intent = 'whatif'; spec.wtext = q; changed = true; }
      if (changed) { spec.raw = raw; plan.intent = spec.intent; plan.spec = spec; plan.conf = F.yMarker || ntok <= 6 ? 0.8 : 0.6; plan.followUp = true; return plan; }
      if (ntok <= 3 && !anyData) { /* sin cambios y sin tema */ }
    }
    if (!ds) {
      // sin tema reconocible
      if (comps.length >= 1 && /\bconsumo\b|\bgasto\b/.test(q)) ds = 'agua';
      else { plan.intent = 'aclarar'; plan.conf = 0.2; plan.X = X; plan.period = period; return plan; }
    }

    /* ---- armado de la consulta ---- */
    const spec = { intent: 'stat', ds, brands: X.brands, tanks: X.tanks, shifts: X.shifts, ops: X.ops, eqTerms: X.eqTerms, eqTypes: X.eqTypes, phases: X.phases, cause: X.cause, state: X.state, kind: X.kind, conds, topN, period, raw };
    const mm = detectMetric(ds, w);
    spec.metric = mm.k; spec.metricExplicit = mm.explicit;
    // hay que quitar de w las palabras del tema para que 'consumo' no pese como métrica en otro ds
    const nounCount = /\bcuant[oa]s\b(?: \w+){0,3} (aseos?|lotes?|trasiegos?|actividades|fermentaciones?|cosechas?|recuperaciones|turnos|lecturas|registros|cips?|fv|sv)\b/.test(q);
    if (nounCount || (F.count && !mm.explicit && !F.sum && !/\b(hl|m3|litros)\b/.test(w))) { spec.metric = '__n'; spec.metricExplicit = true; }
    if (/\bturnos?\b/.test(q) && ds === 'agua' && F.count) spec.metric = '__n';
    if (/\b(mas|menos)\s+(aseos|trasiegos|fermentaciones|cosechas|recuperaciones|lotes|actividades|cips?)\b/.test(q)) { spec.metric = '__n'; spec.metricExplicit = true; }
    if (ds === 'aseos' && !mm.explicit && spec.metric !== '__n' && (F.chart || /\b(semanal|mensual|diario|por (dia|semana|mes))\b/.test(q)) && !F.sum) { spec.metric = '__n'; spec.metricExplicit = true; }
    if (ds === 'agua' && comps.length >= 2) { spec.cmp = { kind: 'component', items: comps }; }
    // agregación
    const Fw = { max: RXF.max.test(w), min: RXF.min.test(w), rank: RXF.rank.test(w) };
    const rankish = F.rank || Fw.rank || !!topN;
    if (F.median) spec.how = 'median'; else if (F.mean && !rankish) spec.how = 'mean'; else if (F.sum) spec.how = 'sum'; else if (Fw.max && !rankish) spec.how = 'max'; else if (Fw.min && !rankish) spec.how = 'min';
    // dimensiones
    const noun = /\b(?:que|cual(?:es)?|cuales|quien(?:es)?)\s+(?:\w+\s+){0,2}?(turno|marca|tanque|unitanque|equipo|operario|utk|causa|generacion|familia|dia|semana|mes|actividad|etapa|fase)s?\b/.exec(q) || /\b(?:top\s*\d*|los\s+\d+|\d+)\s+(turno|marca|tanque|unitanque|equipo|operario|utk|causa|generacion|familia|dia|semana|mes|actividad)(?:s|es)?\b/.exec(w) || /\b(?:mejor|peor|mayor|menor|mas)\s+(turno|marca|tanque|equipo|operario|utk|causa|generacion|familia|dia|semana|mes)(?:s|es)?\b/.exec(w);
    let by = detectBy(q);
    if (!by && noun) { const n = noun[1]; by = { turno: 'shift', marca: 'brand', tanque: 'tq', unitanque: 'tq', equipo: 'eq', operario: 'operator', utk: 'utk', causa: 'cause', generacion: 'gen', familia: 'fam', dia: 'day', semana: 'week', mes: 'month', actividad: 'kind', etapa: 'phase', fase: 'phase' }[n]; }
    if (!by && /\b(diario|diaria|diarios|cada dia)\b/.test(q)) by = 'day'; else if (!by && /\b(semanal|semanales|cada semana)\b/.test(q)) by = 'week'; else if (!by && /\b(mensual|mensuales|mensualmente|cada mes)\b/.test(q)) by = 'month';
    if (!by && /\bcausas\b/.test(q) && ds === 'trasiego') by = 'cause';
    if (!by && /\bcomponentes?\b/.test(q) && ds === 'agua') spec.cmp = { kind: 'component', items: ['pisos', 'cip', 'gea'] };
    if (by === 'cip' || (by && !(TIMEKEYS.includes(by) || (DIMS[ds] && DIMS[ds][by] !== undefined) || by === 'component'))) by = null;
    if (by === 'component') { by = null; spec.cmp = { kind: 'component', items: ['pisos', 'cip', 'gea'] }; }
    if (F.mean && TIMEKEYS.includes(by) && !F.chart && !rankish && !F.compare && !F.forecast && !F.cause) { spec.perUnit = by; by = null; }
    if (by === 'tq' && ds === 'aseos') by = 'eq';
    if (by === 'eq' && ds !== 'aseos') by = null;
    if (by === 'shift' && ds !== 'agua') by = null;
    spec.by = by;
    // unidades de las condiciones → métrica
    spec.conds = conds.map((c) => {
      const o = Object.assign({}, c);
      const per = { aseos: { m3: 'm3', h: 'durMin', min: 'durMin', '%': null }, merma: { '%': 'lossPct', hl: 'loss' }, recuperacion: { h: 'hours', '%': 'yieldPct', hl: 'volume' }, trasiego: { h: 'delay' }, ferm: { h: 'h75', '%': 'atten', p: 'eo' }, lev: { '%': 'viab' }, agua: { m3: 'total', hl: 'total' } }[ds] || {};
      let k = (c.u && per[c.u]) || null;
      if (c.u === 'h' || c.u === 'min') { if (ds === 'trasiego') k = /\bduracion|dura|tarda|largo/.test(q) ? 'duration' : 'delay'; if (ds === 'ferm') k = /\bh ?15\b/.test(q) ? 'h15' : /llenado/.test(q) ? 'tll' : /\balta\b/.test(q) ? 'tA' : 'h75'; if (ds === 'aseos') k = /\bminutos de enjuague|enjuague\b/.test(q) ? 'minutes' : 'durMin'; }
      if (!k && mm.explicit) k = mm.k;
      if (c.u === '%' && ds === 'aseos') k = 'ph';
      if (!k) { k = ({ agua: 'total', aseos: /\bph\b/.test(q) ? 'ph' : 'm3', merma: 'lossPct', recuperacion: /\bph\b/.test(q) ? 'ph' : 'hours', trasiego: 'delay', ferm: mm.k, lev: 'viab' })[ds]; }
      if (ds === 'aseos' && /\bph\b/.test(q)) k = 'ph';
      o.k = k; return o;
    });
    // fuera de rango
    if (/\bfuera de (rango|meta|limite\w*|especificacion)\b/.test(q) && ds === 'aseos' && /\bph\b/.test(q)) { spec.conds = [{ op: 'out', k: 'ph', v: A.Metas.get('aseos.phMin', 6), v2: A.Metas.get('aseos.phMax', 8) }]; }
    if (/\bfuera de (rango|meta|limite\w*)\b/.test(q) && ds === 'recuperacion' && !spec.conds.length) spec.conds = [{ op: '>', k: 'hours', v: A.Metas.get('recuperacion.maximoH', 96) }];
    if (/\bsaldos? negativos?\b/.test(q) && ds === 'merma') spec.conds = [{ op: '<', k: 'loss', v: 0 }];
    if (/\bfuera de (meta|rango|limite\w*)\b/.test(q) && ds === 'aseos' && !/\bph\b/.test(q) && !spec.conds.length) spec.conds = [{ op: '>', k: 'm3', v: A.Metas.get('agua.aseoM3', 10) }];
    spec.flt = [];
    if (/\bsin operario\b|\bsin responsable\b/.test(q) && ds === 'aseos') spec.flt.push('sinOperario');
    if (/\bsin causa\b/.test(q) && ds === 'trasiego') spec.flt.push('sinCausa');
    if (/\bsin marca\b/.test(q) && (ds === 'trasiego' || ds === 'recuperacion')) spec.flt.push('sinMarca');
    if (spec.flt.length && !F.count && !F.chart) spec.intentHint = 'list';
    // ¿comparación?
    if (F.compare) {
      if (split && (split.a || split.b)) {
        const a = split.a || period || defaultPeriod(ds, ref);
        const b = split.b || prevPeriod(a, ref);
        if (split.a && split.b) { spec.cmp = { kind: 'period', a, b }; spec.period = a; }
        else if (split.b) { spec.cmp = { kind: 'period', a: currentOf(split.b, ref) || (S.mem.last && S.mem.last.ds === ds && S.mem.last.period && !S.mem.last.periodDefault ? S.mem.last.period : null) || defaultPeriod(ds, ref), b: split.b }; spec.period = spec.cmp.a; }
        else { spec.cmp = { kind: 'period', a, b: prevPeriod(a, ref) }; spec.period = a; }
      } else if (X.brands.length >= 2) spec.cmp = { kind: 'brand', items: X.brands };
      else if (X.shifts.length >= 2) spec.cmp = { kind: 'shift', items: X.shifts };
      else if (X.tanks.length >= 2) spec.cmp = { kind: 'tank', items: X.tanks };
      else if (X.ops.length >= 2) spec.cmp = { kind: 'op', items: X.ops };
      else if (X.phases.length >= 2 && ds === 'merma') spec.cmp = { kind: 'phase', items: ['FV', 'SV'] };
      else if (spec.cmp && spec.cmp.kind === 'component') { /* ya definido */ }
      else if (period) spec.cmp = { kind: 'period', a: period, b: prevPeriod(period, ref) };
      else if (/\b(fv|sv)\b.*\b(vs|versus|contra|con|frente)\b.*\b(fv|sv)\b/.test(q) && (ds === 'merma' || ds === 'aseos')) spec.cmp = { kind: 'phase', items: ['FV', 'SV'] };
      else spec.cmp = { kind: 'period', a: defaultPeriod(ds, ref), b: null };
    }
    // período por defecto (fuera del periodo no se asume nada: se declara)
    spec.periodDefault = !spec.period;
    if (!spec.period) {
      spec.period = defaultPeriod(ds, ref);
      if (spec.cmp && spec.cmp.kind === 'period' && !spec.cmp.a) spec.cmp.a = spec.period;
    }
    if (spec.cmp && spec.cmp.kind === 'period') { if (!spec.cmp.a) spec.cmp.a = spec.period; if (!spec.cmp.b) spec.cmp.b = prevPeriod(spec.cmp.a, ref); }
    // herencia de periodo/marca si arranca con «y …»
    if (yM && last && last.ds && ds === last.ds && F.yMarker) {
      if (!period) { spec.period = last.period; spec.periodDefault = last.periodDefault; }
      if (!X.brands.length && last.brands && last.brands.length) spec.brands = last.brands;
    }

    /* ---- intención ---- */
    let intent = 'stat';
    const rowNoun = /\b(lote|lotes|aseo|aseos|fermentacion|fermentaciones|cosecha|cosechas|trasiego|trasiegos|recuperacion|recuperaciones|actividad|actividades)\b/.test(q);
    if (F.whatif) { intent = 'whatif'; spec.wtext = q; }
    else if (F.forecast && !F.programado) intent = 'forecast';
    else if (F.cause) intent = 'cause';
    else if (F.compare && spec.cmp) intent = 'compare';
    else if (/\b(que )?(%|porcentaje|proporcion|fraccion)\b.{0,30}\b(de|del|de los|de las)\b/.test(q) && spec.conds.length || /\bque (parte|fraccion) de\b/.test(q)) intent = 'share';
    else if (F.corr) intent = 'corr';
    else if (F.dist && !F.rank) intent = 'dist';
    else if ((rankish || (noun && /\b(mas|menos|mayor|menor|mejor|peor|lento|rapido|largo|corto)\b/.test(w))) && !F.cause) intent = 'rank';
    else if (F.count && spec.metric === '__n' && !by && (spec.conds.length || X.tanks.length || X.brands.length || X.ops.length || X.eqTerms.length || !F.chart)) intent = 'count';
    else if (spec.intentHint === 'list') intent = 'list';
    else if (F.list || (rowNoun && !F.sum && !F.mean && !F.count && !F.chart && (spec.conds.length || X.tanks.length || X.eqTerms.length || X.ops.length || X.brands.length || spec.period && !spec.periodDefault) && (!spec.metricExplicit || (spec.conds.length && spec.conds.every((c) => c.k === spec.metric))) && !by && !F.compare)) intent = 'list';
    else if (F.chart || (by && TIMEKEYS.includes(by))) intent = 'trend';
    else if (by) intent = 'stat';
    if (ds === 'recuperacion' && F.compare && /levadura|recolect/.test(q) && /recuperad|cerveza/.test(q)) { intent = 'corr'; spec.cmp = null; }
    if (intent === 'rank' && !by) {
      // por defecto: filas (lotes, aseos…) o la dimensión natural del tema
      if (noun) by = null;
      spec.by = by;
    }
    spec.intent = intent;
    spec.chart = F.chart || ['trend', 'rank', 'compare', 'dist', 'corr', 'forecast', 'cause'].includes(intent);
    plan.intent = intent; plan.spec = spec;
    // confianza
    let conf = 0.5 + Math.min(0.3, dsConf / 12);
    if (mm.explicit) conf += 0.1; if (period) conf += 0.05; if (plan.ambig) conf -= 0.2;
    plan.conf = Math.max(0.3, Math.min(0.97, conf));
    // consultas de agua que preguntan por aseos como conteo
    if (ds === 'agua' && !mm.explicit && !/\b(agua|consumo|gast|m3|turno|pisos|gea|cip)\b/.test(q)) plan.conf = 0.4;
    // los temas ferm/lev sin cifras ni contexto de análisis los dejamos al motor anterior
    if ((ds === 'ferm' || ds === 'lev') && !followUp) {
      const analytic = period || F.mean || F.sum || F.count || F.rank || F.compare || F.chart || F.dist || F.corr || by || spec.conds.length || topN || F.cause || F.forecast || F.whatif || F.median || F.max || F.min || F.list;
      const strong = /\b(fermentaciones|fermenta\w*|atenuacion|h ?75|h ?15|e ?72|cosechas|viabilidad|consistencia|generacion(es)?|familia|etanol)\b/.test(q);
      if (!analytic && !strong) { plan.intent = 'legacy'; plan.why = 'old-ferm'; return plan; }
    }
    return plan;
  }

  /* ---------------------------------------------------------------- selección de filas */
  const capT = () => eod(refTime());
  const normS = (s) => strip(s);
  function condPass(c, r, ds) {
    const k = c.k; if (!k) return true;
    const m = metOf(ds, k);
    const v = DL().N(r[k]);
    if (v == null) return false;
    if (m.plaus && (v < m.plaus[0] || v > m.plaus[1])) return false;
    switch (c.op) {
      case '>': return v > c.v; case '<': return v < c.v; case '>=': return v >= c.v; case '<=': return v <= c.v; case '=': return Math.abs(v - c.v) < 1e-9;
      case 'between': return v >= c.v && v <= c.v2; case 'out': return v < c.v || v > c.v2;
      default: return true;
    }
  }
  function select(spec, o = {}) {
    const ds = spec.ds, p = o.period || spec.period;
    const cap = capT();
    let rows = rowsOf(ds).filter((r) => r.t != null && r.t >= p.from && r.t <= Math.min(p.to, o.noCap ? p.to : cap));
    const brands = (o.brands !== undefined ? o.brands : spec.brands || []).filter((b) => b !== '*');
    if (HASBRAND[ds] && brands.length) rows = rows.filter((r) => brands.includes(r.brand));
    const tanks = o.tanks !== undefined ? o.tanks : spec.tanks || [];
    if (tanks.length) {
      rows = rows.filter((r) => tanks.some((t) => {
        if (ds === 'ferm') return r.tq === t.n;
        if (ds === 'merma') return r.tq === t.n && (t.kind === 'FV' || t.kind === 'SV' ? r.phase === t.kind : true);
        if (ds === 'aseos') { if (t.kind === 'FV' || t.kind === 'SV') return r.eqType === t.kind && r.tqN === t.n; if (t.kind === 'UTQ') return (r.eqType === 'FV' || r.eqType === 'SV') && r.tqN === t.n; return r.eq === t.kind + ' ' + t.n; }
        if (ds === 'trasiego') return r.tq === t.n;
        if (ds === 'recuperacion') return r.utkN === t.n;
        return true;
      }));
    }
    if (spec.shifts && spec.shifts.length && ds === 'agua') rows = rows.filter((r) => spec.shifts.includes(r.shift));
    if (spec.ops && spec.ops.length && ds === 'aseos') rows = rows.filter((r) => (r.ops || []).some((x) => spec.ops.includes(x)));
    if (ds === 'aseos') {
      for (const t of spec.eqTerms || []) rows = rows.filter((r) => normS(r.eq).includes(t));
      if (spec.eqTypes && spec.eqTypes.length) rows = rows.filter((r) => spec.eqTypes.includes(r.eqType));
    }
    if (ds === 'merma' && spec.phases && spec.phases.length === 1 && !(spec.tanks || []).length) rows = rows.filter((r) => r.phase === spec.phases[0]);
    if (ds === 'trasiego') {
      if (spec.cause) rows = rows.filter((r) => normS(r.cause).includes(spec.cause));
      if (spec.kind) rows = rows.filter((r) => r.kind === spec.kind);
      for (const t of spec.eqTerms || []) rows = rows.filter((r) => normS(r.activity).includes(t));
    }
    if (ds === 'lev' && spec.state) rows = rows.filter((r) => r.state === spec.state);
    for (const f of spec.flt || []) rows = rows.filter((r) => (f === 'sinOperario' ? !r.operator : f === 'sinCausa' ? r.cause === 'Sin causa registrada' : !r.brand || r.brand === '(sin marca)'));
    for (const c of spec.conds || []) rows = rows.filter((r) => condPass(c, r, ds));
    return rows;
  }

  /* ---------------------------------------------------------------- textos reutilizables */
  const HOWL = { sum: 'Total', mean: 'Promedio', median: 'Mediana', max: 'Máximo', min: 'Mínimo', wmean: '', count: '' };
  const howOf = (spec, m) => { const h = spec.how; if (!h) return defaultHow(m); if (m.t === 'ratio' && !m.w && h === 'sum') return defaultHow(m); if (m.k === '__n') return 'count'; return h; };
  function metTitle(m, how) {
    const h = HOWL[how] || '';
    if (m.k === '__n') return m.l;
    if (m.w) return (how === 'wmean' || how === 'sum' || how === 'mean' ? '' : h + ' de ') + m.l.replace(/^Merma$/, 'Merma (% del volumen)').replace(/^Recuperado \/ levadura$/, 'Rendimiento de recuperación');
    if (m.t === 'add') return how === 'sum' ? m.l : h + ' de ' + m.l.charAt(0).toLowerCase() + m.l.slice(1);
    return (how === 'mean' ? 'Promedio de ' : h + ' de ') + m.l.charAt(0).toLowerCase() + m.l.slice(1);
  }
  const brandTxt = (spec) => { const b = (spec.brands || []).filter((x) => x !== '*'); return b.length ? ' · ' + b.map((x) => titleCase(x)).join(', ') : ''; };
  function filtTxt(spec) {
    const out = [];
    for (const t of spec.tanks || []) out.push(t.kind === 'COLECTOR' ? 'colector ' + t.n : t.kind + ' ' + t.n);
    if (spec.shifts && spec.shifts.length) out.push('turno ' + spec.shifts.join('/').toLowerCase());
    if (spec.ops && spec.ops.length) out.push('operario ' + spec.ops.join('/'));
    if (spec.eqTerms && spec.eqTerms.length) out.push(spec.eqTerms.join(', '));
    if (spec.cause) out.push('causa «' + spec.cause + '»');
    if (spec.state) out.push(spec.state);
    if (spec.kind) out.push(spec.kind);
    for (const f of spec.flt || []) out.push({ sinOperario: 'sin operario', sinCausa: 'sin causa registrada', sinMarca: 'sin marca' }[f]);
    for (const c of spec.conds || []) out.push(condTxt(c, spec.ds));
    return out.join(' · ');
  }
  function condTxt(c, ds) {
    const m = c.k ? metOf(ds, c.k) : null, nm = m ? (m.l || c.k) : 'valor', u = m && m.u ? (m.u === '%' ? ' %' : ' ' + m.u) : '';
    const n = nm.charAt(0).toLowerCase() + nm.slice(1);
    if (c.op === 'between') return n + ' entre ' + fmt(c.v, 2) + ' y ' + fmt(c.v2, 2) + u;
    if (c.op === 'out') return n + ' fuera de ' + fmt(c.v, 2) + '–' + fmt(c.v2, 2);
    return n + ' ' + ({ '>': '>', '<': '<', '>=': '≥', '<=': '≤', '=': '=' }[c.op]) + ' ' + fmt(c.v, 2) + u;
  }
  const dirWord = (good, up) => (good ? (up ? 'mejor' : 'mejor') : 'peor');
  function deltaPct(cur, prev) { if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null; return ((cur - prev) / Math.abs(prev)) * 100; }
  const frenteA = (l) => (/^el /.test(l) ? 'frente al ' + l.slice(3) : 'frente a ' + l);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function deltaSentence(m, cur, prev, prevLabel, how) {
    const d = deltaPct(cur, prev);
    if (d == null) return prev == null ? '' : 'Frente a ' + prevLabel + ' (' + vFmt(m, prev) + ') no se puede calcular el cambio porcentual.';
    if (Math.abs(d) < 0.5 || (m.u === '%' && m.t === 'ratio' && Math.abs(cur - prev) < 0.05)) return 'Prácticamente igual ' + frenteA(prevLabel) + ' (' + vFmt(m, prev) + ').';
    const up = d > 0, good = m.good ? (m.good === 'down') !== up : null;
    if (m.u === '%' && (m.t === 'ratio')) { const pts = cur - prev; return (pts > 0 ? 'Subió ' : 'Bajó ') + fmt(Math.abs(pts), 2) + ' puntos porcentuales ' + frenteA(prevLabel) + ' (' + vFmt(m, prev) + ')' + (good == null ? '.' : good ? ', una buena señal.' : ', conviene mirarlo.'); }
    return (up ? 'Subió ' : 'Bajó ') + fmt(Math.abs(d), 1) + ' % ' + frenteA(prevLabel) + ' (' + vFmt(m, prev) + ')' + (good == null ? '.' : good ? ', una buena señal.' : ', conviene mirarlo.');
  }
  function sigSentence(a, b, lblA, lblB) {
    const t = ST().ttest(a, b);
    if (!t || t.p == null) return null;
    const ps = t.p < 0.001 ? '<0,001' : fmt(t.p, 3);
    if (t.p < 0.05) return 'La diferencia es estadísticamente significativa (p = ' + ps + '): es poco probable que sea casualidad.';
    return 'La diferencia no es concluyente (p = ' + ps + '): con estos datos podría ser variación normal de un periodo a otro.';
  }
  function trendSentence(ys, unitTxt) {
    const y = ys.filter((v) => v != null && Number.isFinite(v));
    if (y.length < 5) return null;
    const mk = ST().mannKendall(y);
    if (!mk) return null;
    const ps = mk.p < 0.001 ? '<0,001' : fmt(mk.p, 3);
    if (mk.trend === 'sin tendencia') return 'La serie no muestra una tendencia clara (p = ' + ps + '): sube y baja sin dirección sostenida.';
    const sl = ST().senSlope(y);
    return 'Hay una tendencia ' + (mk.trend === 'sube' ? 'al alza' : 'a la baja') + ' sostenida (p = ' + ps + ')' + (sl != null ? ', de unos ' + fmt(Math.abs(sl), Math.abs(sl) < 1 ? 2 : 1) + (unitTxt ? ' ' + unitTxt : '') + ' por punto de la serie' : '') + '.';
  }

  /* ---------------------------------------------------------------- constructor de respuestas */
  function Resp(spec, intent) { this.parts = []; this.txt = []; this.chips = []; this.spec = spec || null; this.intent = intent || (spec && spec.intent) || 'stat'; this.conf = 0.8; this.exp = null; this.go = []; }
  Resp.prototype = {
    h(title, sub) { this.parts.push('<div class="cf-h"><b>' + title + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>'); this.txt.push(tagsOut(title) + (sub ? '. ' + tagsOut(sub) : '')); return this; },
    p(html, cls) { if (!html) return this; this.parts.push('<p class="cf-p' + (cls ? ' ' + cls : '') + '">' + html + '</p>'); this.txt.push(tagsOut(html)); return this; },
    kpis(list) { const l = list.filter(Boolean); if (!l.length) return this; this.parts.push('<div class="cf-kpis">' + l.map((k) => CH().kpi(k)).join('') + '</div>'); this.txt.push(l.map((k) => k.label + ': ' + String(k.value).replace(/\u2060/g, '') + (k.unit ? ' ' + k.unit : '')).join('; ')); return this; },
    chart(html, caption) { if (!html) return this; this.parts.push('<div class="cf-chart">' + html + '</div>'); this.hasChart = true; if (caption) this.txt.push(caption); return this; },
    note(html, tone) { if (!html) return this; this.parts.push('<div class="cf-note' + (tone ? ' ' + tone : '') + '">' + html + '</div>'); this.txt.push(tagsOut(html)); return this; },
    src(html) { if (!html) return this; this.parts.push('<div class="cf-src">' + html + '</div>'); this.txt.push(tagsOut(html)); return this; },
    list(items) { if (!items || !items.length) return this; this.parts.push('<ul class="cf-ul">' + items.map((i) => '<li>' + i + '</li>').join('') + '</ul>'); this.txt.push(items.map(tagsOut).join('; ')); return this; },
    table(cols, rows, o = {}) {
      if (!rows.length) return this;
      const max = o.max || 10, shown = rows.slice(0, max);
      const th = cols.map((c) => '<th' + (c.num ? ' class="n"' : '') + '>' + esc(c.t) + '</th>').join('');
      const body = shown.map((r) => '<tr>' + cols.map((c) => '<td' + (c.num ? ' class="n"' : '') + '>' + (c.f ? c.f(r[c.k], r) : esc(r[c.k] == null ? '—' : r[c.k])) + '</td>').join('') + '</tr>').join('');
      this.parts.push('<div class="cf-tbl"><div class="cf-tbl-s"><table><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>' + (rows.length > shown.length ? '<div class="cf-tbl-f">Mostrando ' + shown.length + ' de ' + rows.length + '. Descarga el Excel para verlos todos.</div>' : '') + '</div>');
      this.hasTable = true;
      this.txt.push(shown.slice(0, 5).map((r) => cols.map((c) => tagsOut(c.f ? c.f(r[c.k], r) : r[c.k] == null ? '—' : r[c.k])).join(' | ')).join('; '));
      return this;
    },
    chip(label, q) { if (label && q && !this.chips.some((c) => c.label === label)) this.chips.push({ label, q }); return this; },
    go_(label, ruta, extra) { this.go.push(Object.assign({ label, ruta }, extra || {})); return this; },
    export(nombre, cols, rows, sub) { this.exp = { nombre, cols, rows, sub }; return this; },
    done() {
      const acts = [];
      const specAttr = this.spec ? " data-cf-spec='" + esc(JSON.stringify(this.spec)).replace(/'/g, '&#39;') + "'" : '';
      for (const g of this.go) acts.push('<button type="button" class="cf-act cf-go" data-cf-go="' + esc(g.ruta) + '"' + (g.ds ? ' data-cf-ds="' + esc(g.ds) + '"' : '') + specAttr + '>' + esc(g.label) + ' ›</button>');
      if (this.exp && this.exp.rows.length) acts.push('<button type="button" class="cf-act" data-cf-xls="1"' + specAttr + '>Descargar Excel</button>');
      acts.push('<button type="button" class="cf-act cf-copy" data-cf-copy="1" title="Copiar la respuesta como texto">Copiar</button>');
      const html = '<div class="cf-ans">' + this.parts.join('') + '<div class="cf-acts">' + acts.join('') + '</div></div>';
      if (this.exp) S.lastExp = { spec: this.spec, exp: this.exp };
      return { h: html, valor: this.valor, opts: this.chips.slice(0, 6), intent: this.intent, conf: this.conf, texto: this.txt.join(' ').replace(/\s+/g, ' ').trim(), html, hasChart: !!this.hasChart, hasTable: !!this.hasTable, spec: this.spec };
    },
  };
  // Los valores se envían ya formateados; si el texto pareciera un número con punto decimal («1.514») se protege para que el gráfico no lo reinterprete.
  const kpiVal = (v) => { const s = v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '—' : typeof v === 'number' ? fa(v) : String(v); return /^-?\d+\.\d+$/.test(s) ? '\u2060' + s : s; };
  const kd = (m, cur, prev) => { if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return undefined; if (m.u === '%' && m.t === 'ratio') { const d = cur - prev; return Math.abs(d) < 0.05 ? undefined : (d > 0 ? '+' : '−') + fmt(Math.abs(d), 1) + ' pts'; } const d = deltaPct(cur, prev); return d != null && Math.abs(d) >= 0.05 ? d : undefined; };
  const kpi = (label, value, unit, extra) => Object.assign({ label, value: kpiVal(value), unit: unit || '' }, extra || {});

  /* ---------------------------------------------------------------- gráficos */
  const CW = 420;
  const refsFor = (ds, m, how) => {
    const g = (p, d) => A.Metas.get(p, d), out = [];
    if (how === 'sum' || how === 'count') return out;
    if (ds === 'aseos' && m.k === 'm3') out.push({ y: g('agua.aseoM3', 10), label: 'Meta ' + g('agua.aseoM3', 10) + ' m³' });
    if (ds === 'recuperacion' && m.k === 'hours') { out.push({ y: g('recuperacion.objetivoH', 72), label: 'Objetivo ' + g('recuperacion.objetivoH', 72) + ' h' }); }
    if (ds === 'lev' && m.k === 'viab') out.push({ y: g('levadura.viabMin', 95), label: 'Mínimo ' + g('levadura.viabMin', 95) + ' %' });
    if (ds === 'trasiego' && m.k === 'delay' && how !== 'sum') out.push({ y: g('trasiego.desvioMaxH', 1), label: 'Desvío máx. ' + g('trasiego.desvioMaxH', 1) + ' h' });
    return out;
  };
  const trendBy = (p) => { const d = (p.to - p.from) / DAY; return d <= 45 ? 'day' : d <= 200 ? 'week' : 'month'; };
  // Serie temporal agregada: [{k,label,t,v,n}]
  function series(spec, rows, m, how, by) {
    let g = groupRows(spec.ds, rows, by);
    let dropped = 0;
    if (spec.ds === 'agua' && by === 'day' && (m.t === 'add' || m.k === '__n') && ['total', 'pisos', 'cip', 'gea'].includes(m.k)) { const before = g.length; g = g.filter((x) => x.rows.filter((r) => r[m.k] != null).length >= 3); dropped = before - g.length; }
    const out = g.map((x) => { const a = aggregate(x.rows, m, how === 'count' ? 'count' : how); return { k: x.k, label: x.label, t: x.t, v: a.v, n: a.n, rows: x.rows }; }).filter((x) => x.v != null).sort((a, b) => a.t - b.t);
    out.dropped = dropped;
    return out;
  }
  function timeChart(ser, m, how, o = {}) {
    if (ser.length < 2) return '';
    const unit = m.u === '%' ? '%' : m.u;
    const useBars = o.bars != null ? o.bars : ser.length <= 14 && (m.t === 'add' || m.k === '__n') ;
    if (useBars) return CH().bars({ title: o.title, subtitle: o.subtitle, data: ser.map((x) => ({ label: x.label, value: Math.round(x.v * 100) / 100 })), unit, w: CW, h: 220, toolbar: true, refs: o.refs });
    return CH().line({ title: o.title, subtitle: o.subtitle, xType: 'time', series: [{ name: m.l, points: ser.map((x) => ({ x: x.t, y: Math.round(x.v * 1000) / 1000 })) }], unit, w: CW, h: 220, toolbar: true, refs: o.refs });
  }
  function barsH(items, o = {}) {
    if (!items.length) return '';
    return CH().barsH({ title: o.title, subtitle: o.subtitle, data: items.map((x) => ({ label: x.label, value: Math.round(x.v * 100) / 100 })), unit: o.unit, w: CW, toolbar: true, refs: o.refs, h: Math.max(150, items.length * 26 + 50) });
  }

  /* ---------------------------------------------------------------- tablas de filas por tema */
  const T_ = (t) => (t == null ? '—' : fdt(t));
  const nz = (v, d) => (v == null || !Number.isFinite(v) ? '—' : fmt(v, d));
  const ROWCOLS = {
    agua: [{ k: 't', t: 'Lectura', f: (v) => T_(v) }, { k: 'shift', t: 'Turno' }, { k: 'pisos', t: 'Pisos', num: 1, f: (v) => nz(v, 1) }, { k: 'cip', t: 'CIP', num: 1, f: (v) => nz(v, 1) }, { k: 'gea', t: 'GEA', num: 1, f: (v) => nz(v, 1) }, { k: 'total', t: 'Total m³', num: 1, f: (v) => nz(v, 1) }, { k: 'aseos', t: 'Aseos', num: 1, f: (v) => nz(v, 0) }],
    aseos: [{ k: 't', t: 'Inicio', f: (v) => T_(v) }, { k: 'eq', t: 'Equipo', f: (v) => esc(eqLabel(v)) }, { k: 'tipo', t: 'Tipo' }, { k: 'm3', t: 'm³', num: 1, f: (v) => nz(v, 1) }, { k: 'durMin', t: 'Min', num: 1, f: (v) => (v != null && v >= 1 && v <= 1440 ? fmt(v, 0) : '—') }, { k: 'ph', t: 'pH', num: 1, f: (v) => (v != null && v >= 0 && v <= 14 ? fmt(v, 1) : '—') }, { k: 'operator', t: 'Operario', f: (v) => esc(v || '—') }],
    merma: [{ k: 't', t: 'Cierre', f: (v) => fd(v) }, { k: 'lote', t: 'Lote' }, { k: 'phase', t: 'Etapa' }, { k: 'tq', t: 'UTQ', num: 1 }, { k: 'brand', t: 'Marca', f: (v) => esc(titleCase(v)) }, { k: 'input', t: 'Entrada Hl', num: 1, f: (v) => nz(v, 0) }, { k: 'loss', t: 'Merma Hl', num: 1, f: (v) => nz(v, 0) }, { k: 'lossPct', t: 'Merma %', num: 1, f: (v) => nz(v, 1) }],
    recuperacion: [{ k: 't', t: 'Fecha', f: (v) => fd(v) }, { k: 'utk', t: 'UTK' }, { k: 'brand', t: 'Marca', f: (v) => esc(titleCase(v)) }, { k: 'yeast', t: 'Levadura Hl', num: 1, f: (v) => nz(v, 0) }, { k: 'volume', t: 'Recuperado Hl', num: 1, f: (v) => nz(v, 0) }, { k: 'hours', t: 'Horas', num: 1, f: (v) => nz(v, 0) }, { k: 'yieldPct', t: 'Rend. %', num: 1, f: (v) => nz(v, 0) }],
    trasiego: [{ k: 't', t: 'Inicio', f: (v) => T_(v) }, { k: 'activity', t: 'Actividad', f: (v) => esc(String(v).slice(0, 34)) }, { k: 'brand', t: 'Marca', f: (v) => esc(titleCase(v)) }, { k: 'duration', t: 'Duración h', num: 1, f: (v) => (v != null && v >= 0.25 && v <= 72 ? fmt(v, 1) : '—') }, { k: 'delay', t: 'Desvío h', num: 1, f: (v) => (v != null && v > -72 && v < 240 ? fmt(v, 1) : '—') }, { k: 'cause', t: 'Causa', f: (v) => esc(String(v).slice(0, 30)) }],
    ferm: [{ k: 't', t: 'Llenado', f: (v) => fd(v) }, { k: 'lote', t: 'Lote' }, { k: 'tq', t: 'FV', num: 1 }, { k: 'brand', t: 'Marca', f: (v) => esc(titleCase(v)) }, { k: 'eo', t: 'EO °P', num: 1, f: (v) => nz(v, 1) }, { k: 'h75', t: 'h75', num: 1, f: (v) => nz(v, 0) }, { k: 'e72', t: 'E72 °P', num: 1, f: (v) => nz(v, 1) }, { k: 'atten', t: 'Aten. %', num: 1, f: (v) => nz(v, 0) }],
    lev: [{ k: 't', t: 'Cosecha', f: (v) => fd(v) }, { k: 'nombre', t: 'Levadura' }, { k: 'brand', t: 'Marca', f: (v) => esc(titleCase(v)) }, { k: 'gen', t: 'Gen', num: 1 }, { k: 'viab', t: 'Viab. %', num: 1, f: (v) => nz(v, 1) }, { k: 'cons', t: 'Cons. %', num: 1, f: (v) => nz(v, 0) }, { k: 'ph', t: 'pH', num: 1, f: (v) => nz(v, 2) }, { k: 'state', t: 'Estado' }],
  };
  const titleCase = (s) => String(s == null ? '' : s).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\bEstandar\b/g, 'Estándar');
  const expCols = (ds) => ROWCOLS[ds].map((c) => ({ h: c.t, t: c.num ? 'n' : 's' }));
  const expRow = (ds, r) => ROWCOLS[ds].map((c) => { const v = r[c.k]; if (c.k === 't') return v == null ? null : new Date(v).toLocaleString('es-CO'); if (c.k === 'eq') return eqLabel(v); return v == null ? null : v; });
  const dsAnalysisRoute = (ds) => 'analisis/' + DSTAB[ds];

  // Texto de periodo + cobertura para la línea de fuente
  function srcLine(spec, rows, m, extraN) {
    const ds = spec.ds, tot = rows.length;
    const a = m && m.k !== '__n' ? aggregate(rows, m, defaultHow(m)) : null;
    const nn = a ? a.n : tot;
    const noun = DSNOUN[ds][nn === 1 ? 0 : 1];
    let s = 'Fuente: ' + dsLabel(ds) + ' · ' + spec.period.label + (spec.period.txt ? ' (' + spec.period.txt + ')' : '') + ' · ';
    s += a && nn < tot ? fmt(nn, 0) + ' de ' + fmt(tot, 0) + ' ' + DSNOUN[ds][1] + ' con dato válido' : fmt(tot, 0) + ' ' + DSNOUN[ds][tot === 1 ? 0 : 1];
    if (spec.periodDefault) s += ' (no indicaste periodo: usé lo que va del año)';
    return esc(s);
  }
  const noBrandNote = (spec) => (!HASBRAND[spec.ds] && (spec.brands || []).filter((b) => b !== '*').length ? 'Ojo: ' + dsLabel(spec.ds).toLowerCase() + ' no se registra por marca, así que ignoré el filtro de marca.' : '');
  // Cuántos valores imposibles se descartaron (p. ej. 36.800 h de duración en una celda mal digitada)
  function discardNote(rows, m) {
    if (!m || m.k === '__n' || !m.plaus) return '';
    let bad = 0, ex = null;
    for (const r of rows) { const v = DL().N(r[m.k]); if (v != null && (v < m.plaus[0] || v > m.plaus[1])) { bad++; if (ex == null) ex = v; } }
    return bad ? 'Descarté ' + bad + ' ' + plural(bad, 'valor') + ' imposible' + (bad === 1 ? '' : 's') + ' (por ejemplo ' + fmt(ex, 0) + ' ' + (m.u || '') + '): casi seguro son errores de captura. Están marcados en Calidad de datos.' : '';
  }
  function emptyAnswer(spec, why) {
    const R = new Resp(spec, spec.intent);
    const ds = spec.ds, e = DL().extent(ds);
    R.h('No encontré datos para eso', esc(dsLabel(ds)) + ' · ' + esc(spec.period.label) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
    R.p(why || 'No hay registros de ' + esc(dsLabel(ds).toLowerCase()) + ' que cumplan lo que pediste.');
    if (e && e.to < spec.period.from) R.p('Aún no hay registros en ese periodo.');
    if (e) R.p('Los datos de ' + esc(dsLabel(ds).toLowerCase()) + ' van del <b>' + fd(e.from) + '</b> al <b>' + fd(Math.min(e.to, capT())) + '</b> (' + fmt(e.n, 0) + ' registros).');
    R.chip('Todo el año', DSEXAMPLE[ds] + ' este año').chip('Mes pasado', DSEXAMPLE[ds] + ' el mes pasado').chip('Últimos 90 días', DSEXAMPLE[ds] + ' en los últimos 90 días');
    R.conf = 0.55;
    return R;
  }
  const DSEXAMPLE = { agua: 'consumo de agua', aseos: 'aseos', merma: 'merma', recuperacion: 'recuperación de cerveza', trasiego: 'trasiegos', ferm: 'fermentaciones', lev: 'viabilidad de la levadura' };

  /* ---------------------------------------------------------------- hallazgos internos por tema (insights breves y verificables) */
  const med = (v) => quant(v, 0.5);
  const metaG = (p, d) => A.Metas.get(p, d);
  function insights(spec, rows, m, how) {
    const ds = spec.ds, out = [];
    try {
      if (ds === 'agua') {
        const days = groupRows('agua', rows, 'day').map((g) => ({ g, v: sum(vals(g.rows, metOf('agua', 'total'))) })).filter((x) => x.v > 0);
        if (m.k === 'total' && days.length >= 3) {
          const peak = days.reduce((a, b) => (b.v > a.v ? b : a));
          out.push('El día de mayor consumo fue el <b>' + fd(peak.g.t) + '</b> con ' + withU(peak.v, 'm³') + ' (promedio diario ' + withU(sum(days.map((d) => d.v)) / days.length, 'm³') + ').');
          const comp = ['pisos', 'cip', 'gea'].map((k) => [k, sum(vals(rows, metOf('agua', k)))]);
          const tot = sum(comp.map((c) => c[1]));
          if (tot > 0) out.push('Por origen: pisos ' + fmt((comp[0][1] / tot) * 100, 0) + ' %, CIP ' + fmt((comp[1][1] / tot) * 100, 0) + ' %, GEA ' + fmt((comp[2][1] / tot) * 100, 0) + ' %.');
        }
        const tv = vals(rows, metOf('agua', 'total'));
        if (tv.length >= 6) { const md = med(tv), lim = md * metaG('agua.turnosAtipicos', 1.25), n = tv.filter((x) => x > lim).length; if (n) out.push(n + ' ' + plural(n, 'turno') + ' ' + (n === 1 ? 'superó' : 'superaron') + ' ' + fmt(metaG('agua.turnosAtipicos', 1.25), 2) + ' × la mediana (' + withU(md, 'm³') + ' por turno).'); }
        const hl = rows.filter((r) => r.total != null && (r.production || 0) + (r.transfer || 0) > 0 && r.total >= 0);
        if (hl.length >= 5 && m.k === 'total') { const tt = sum(hl.map((r) => r.total)) * 10, hh = sum(hl.map((r) => (r.production || 0) + (r.transfer || 0))); if (hh > 0 && tt / hh < 5) out.push('Relación global: ' + fmt(tt / hh, 2) + ' Hl de agua por cada Hl de mosto más trasiego.'); }
      } else if (ds === 'aseos') {
        const mv = rows.filter((r) => r.m3 != null && r.m3 <= 200), meta = metaG('agua.aseoM3', 10);
        if (mv.length >= 5 && (m.k === 'm3' || m.k === '__n')) {
          const over = mv.filter((r) => r.m3 > meta);
          out.push(over.length + ' de ' + mv.length + ' aseos (' + fmt((over.length / mv.length) * 100, 1) + ' %) superan la meta de ' + meta + ' m³.');
          const g = groupRows('aseos', mv, 'eq').map((x) => ({ l: x.label, v: sum(x.rows.map((r) => r.m3)), n: x.rows.length })).sort((a, b) => b.v - a.v)[0];
          if (g && !(spec.eqTerms || []).length && !(spec.tanks || []).length) out.push('El equipo que más agua usa en aseos es <b>' + esc(g.l) + '</b>: ' + withU(g.v, 'm³') + ' en ' + g.n + ' aseos.');
        }
        const phs = rows.filter((r) => r.ph != null && r.ph >= 0 && r.ph <= 14);
        if (phs.length >= 5 && m.k === 'ph') { const bad = phs.filter((r) => r.ph < metaG('aseos.phMin', 6) || r.ph > metaG('aseos.phMax', 8)).length; out.push(bad + ' de ' + phs.length + ' enjuagues quedaron fuera del rango de pH ' + metaG('aseos.phMin', 6) + '–' + metaG('aseos.phMax', 8) + '.'); }
      } else if (ds === 'merma') {
        const neg = rows.filter((r) => r.loss != null && r.loss < 0).length, big = rows.filter((r) => r.lossPct != null && r.lossPct > metaG('merma.alerta', 30)).length;
        if (neg || big) out.push((neg ? neg + ' ' + plural(neg, 'lote') + ' con saldo negativo (salió más de lo registrado)' : '') + (neg && big ? ' y ' : '') + (big ? big + ' con merma mayor a ' + metaG('merma.alerta', 30) + ' %' : '') + ': suelen ser errores de captura; revísalos en Calidad de datos.');
        const g = groupRows('merma', rows, 'brand').map((x) => ({ l: x.label, a: aggregate(x.rows, metOf('merma', 'lossPct'), 'wmean'), n: x.rows.length })).filter((x) => x.a.v != null && x.n >= 3).sort((a, b) => b.a.v - a.a.v);
        if (g.length >= 2 && !(spec.brands || []).length) out.push('Por marca, la merma más alta es <b>' + esc(titleCase(g[0].l)) + '</b> (' + fmt(g[0].a.v, 1) + ' %) y la más baja ' + esc(titleCase(g[g.length - 1].l)) + ' (' + fmt(g[g.length - 1].a.v, 1) + ' %).');
        const un = sum(rows.map((r) => r.unexplained || 0).filter((x) => x > 0)), ls = sum(rows.map((r) => r.loss || 0).filter((x) => x > 0));
        if (ls > 0 && m.k === 'lossPct') out.push('Del volumen perdido, ' + fmt(Math.min(100, (un / ls) * 100), 0) + ' % no queda explicado por purgas.');
      } else if (ds === 'recuperacion') {
        const hv = rows.filter((r) => r.hours != null && r.hours >= 0 && r.hours <= 400);
        if (hv.length >= 5) { const ob = metaG('recuperacion.objetivoH', 72), mx = metaG('recuperacion.maximoH', 96); out.push(fmt((hv.filter((r) => r.hours <= ob).length / hv.length) * 100, 0) + ' % de las ' + hv.length + ' recuperaciones con horas registradas se hizo en ' + ob + ' h o menos; ' + hv.filter((r) => r.hours > mx).length + ' pasaron de ' + mx + ' h.'); }
        const y = aggregate(rows, metOf('recuperacion', 'yieldPct'), 'wmean'); if (y.v != null && m.k !== 'yieldPct') out.push('Rendimiento global: ' + fmt(y.v, 0) + ' Hl recuperados por cada 100 Hl de levadura recolectada.');
      } else if (ds === 'trasiego') {
        const dv = rows.filter((r) => r.delay != null && r.delay > -72 && r.delay < 240);
        if (dv.length >= 5) { const lim = metaG('trasiego.desvioMaxH', 1); out.push(fmt((dv.filter((r) => r.delay <= lim).length / dv.length) * 100, 0) + ' % de las actividades terminó dentro de ' + lim + ' h del plan (' + dv.length + ' con hora real registrada).'); }
        const cs = groupRows('trasiego', rows.filter((r) => r.delay > 0 && r.cause !== 'Sin causa registrada'), 'cause').map((x) => ({ l: x.label, v: sum(x.rows.map((r) => r.delay)) })).sort((a, b) => b.v - a.v)[0];
        if (cs) out.push('La causa registrada con más horas de retraso es «' + esc(String(cs.l).toLowerCase()) + '» (' + fmt(cs.v, 0) + ' h).');
      } else if (ds === 'ferm') {
        const g = groupRows('ferm', rows, 'brand').map((x) => ({ l: x.label, a: aggregate(x.rows, m.k === '__n' ? metOf('ferm', 'h75') : m, 'mean'), n: x.rows.length })).filter((x) => x.a.v != null && x.n >= 3).sort((a, b) => a.a.v - b.a.v);
        if (g.length >= 2 && !(spec.brands || []).length && m.k !== '__n') out.push('Por marca: ' + g.map((x) => esc(titleCase(x.l)) + ' ' + fmt(x.a.v, m.k === 'eo' || m.k === 'e72' || m.k === 'rdf' ? 2 : 0) + (m.u ? ' ' + m.u : '')).join(' · ') + '.');
      } else if (ds === 'lev') {
        const vv = rows.filter((r) => r.viab != null && r.viab >= 0 && r.viab <= 100), mn = metaG('levadura.viabMin', 95);
        if (vv.length >= 5) out.push(vv.filter((r) => r.viab < mn).length + ' de ' + vv.length + ' cosechas (' + fmt((vv.filter((r) => r.viab < mn).length / vv.length) * 100, 0) + ' %) tuvieron viabilidad por debajo de ' + mn + ' %.');
      }
    } catch (e) { /* los hallazgos son un extra: nunca rompen la respuesta */ }
    return out;
  }

  function followChips(R, spec) {
    const ds = spec.ds;
    if (spec.intent !== 'trend') R.chip('Grafícalo', 'grafícalo');
    if (HASBRAND[ds] && !(spec.brands || []).filter((b) => b !== '*').length && !spec.by) R.chip('¿Y por marca?', 'y por marca');
    if (ds === 'agua' && spec.by !== 'shift') R.chip('¿Y por turno?', 'y por turno');
    if (ds === 'aseos' && spec.by !== 'eq') R.chip('¿Y por equipo?', 'y por equipo');
    if (ds === 'aseos' && spec.by !== 'operator') R.chip('¿Y por operario?', 'y por operario');
    if (ds === 'trasiego' && spec.by !== 'cause') R.chip('¿Y por causa?', 'y por causa');
    if (ds === 'recuperacion' && spec.by !== 'utk') R.chip('¿Y por UTK?', 'y por utk');
    if (ds === 'merma' && spec.by !== 'tq') R.chip('¿Qué tanque tiene más?', 'qué tanque tiene más');
    if (!spec.by) R.chip('¿Y por semana?', 'y por semana');
    if (spec.period && spec.period.kind !== 'all') R.chip('Compáralo con el periodo anterior', 'compáralo con el periodo anterior');
    if (spec.period && spec.period.kind === 'month' || spec.period.dflt) R.chip('¿Y el mes pasado?', 'y el mes pasado');
    R.chip('Más detalle', 'más detalle');
  }
  function goBtns(R, spec) {
    R.go_('Abrir en Análisis', dsAnalysisRoute(spec.ds), { ds: spec.ds });
    const by = TIMEKEYS.includes(spec.by) ? spec.by : spec.by && DIMS[spec.ds] && DIMS[spec.ds][spec.by] ? ({ shift: 'shift', brand: 'brand', tq: 'tq', phase: 'phase', fam: 'fam', cause: 'cause', utk: 'utk', gen: 'gen', kind: 'kind' })[spec.by] || '' : 'month';
    if (spec.metric && spec.metric !== '__n') R.go_('Abrir en el Constructor', 'analisis/constructor?ds=' + spec.ds + '&m=' + spec.metric + (by ? '&by=' + by : ''), { ds: spec.ds });
  }

  /* ---------------------------------------------------------------- estadística de un valor (stat) */
  const H = {};
  // El periodo anterior solo es comparable si tiene una densidad de registros parecida (evita comparar contra años casi vacíos)
  function comparable(rows, prows, p, pp) {
    if (!pp || !prows.length) return false;
    const d1 = Math.max(1, (Math.min(p.to, capT()) - p.from) / DAY + 1), d2 = Math.max(1, (pp.to - pp.from) / DAY + 1);
    const r1 = rows.length / d1, r2 = prows.length / d2;
    return r1 === 0 ? true : r2 / r1 >= 0.4 && r2 / r1 <= 2.5;
  }
  function latestWithValue(spec, m) {
    const rows = select(Object.assign({}, spec, { period: P(0, capT(), 'todo', 'all') }));
    for (let i = rows.length - 1; i >= 0; i--) { if (m.k === '__n' || vals([rows[i]], m).length) return rows[i].t; }
    return null;
  }
  function extremeRow(rows, m, how) {
    const [lo, hi] = m.plaus || [-Infinity, Infinity];
    let best = null;
    for (const r of rows) { const v = DL().N(r[m.k]); if (v == null || v < lo || v > hi) continue; if (best == null || (how === 'max' ? v > best.v : v < best.v)) best = { r, v }; }
    return best;
  }
  const rowLabel = (ds, r) => ({
    agua: () => fd(r.t) + ' · ' + r.shift, aseos: () => eqLabel(r.eq) + ' · ' + fd(r.t), merma: () => r.lote + ' (' + r.phase + ' ' + r.tq + ')', recuperacion: () => r.utk + ' · ' + fd(r.t),
    trasiego: () => String(r.activity).replace(/\s*-.*$/, '').slice(0, 24) + ' · ' + fd(r.t), ferm: () => r.lote + ' (FV ' + r.tq + ')', lev: () => (r.nombre || r.id) + ' · ' + fd(r.t),
  }[ds]());
  const secondaryKpi = (spec, rows, m, how, a) => {
    if (m.k === '__n') { const days = Math.max(1, Math.round((Math.min(spec.period.to, capT()) - spec.period.from + 1) / DAY)); return days >= 7 ? kpi(days >= 60 ? 'Promedio por semana' : 'Promedio por día', days >= 60 ? (a.v / days) * 7 : a.v / days, '') : null; }
    if (how === 'sum') { const dd = groupRows(spec.ds, rows.filter((r) => vals([r], m).length), 'day').length; return dd > 1 ? kpi('Promedio por día con datos', a.v / dd, m.u, { help: dd + ' días con registros' }) : null; }
    if (how === 'wmean') { const s = aggregate(rows, m, 'mean'); const vv = rows.map((r) => (m.w ? (DL().N(r[m.w[0]]) / DL().N(r[m.w[1]])) * 100 : null)).filter((x) => x != null && Number.isFinite(x) && x >= m.plaus[0] && x <= m.plaus[1]); return vv.length ? kpi('Promedio simple por registro', vv.reduce((x, y) => x + y, 0) / vv.length, m.u, { help: 'sin ponderar por volumen' }) : null; }
    if (how === 'mean' || how === 'median') { const v = vals(rows, m); return v.length ? kpi('Rango', fa(Math.min(...v)) + ' – ' + fa(Math.max(...v)), m.u) : null; }
    return null;
  };

  H.stat = function (spec) {
    const ds = spec.ds;
    if (spec.cmp && spec.cmp.kind === 'component') return compareGroups(spec);
    if (spec.by) return TIMEKEYS.includes(spec.by) ? H.trend(spec) : byDim(spec);
    const m = metOf(ds, spec.metric), how = howOf(spec, m), ref = refTime();
    let rows = select(spec), a = aggregate(rows, m, how), note = '';
    if (a.v == null && (spec.period.kind === 'day' || spec.period.kind === 'week' || spec.period.kind === 'rolling') && spec.period.to - spec.period.from < 8 * DAY) {
      const lt = latestWithValue(spec, m);
      if (lt != null) {
        const old = spec.period.label;
        spec = Object.assign({}, spec, { period: dayPeriod(lt, 'el último día con datos (' + fd(lt) + ')') });
        rows = select(spec); a = aggregate(rows, m, how);
        note = 'Todavía no hay dato válido para ' + esc(old) + '. Te muestro el último día con datos.';
      }
    }
    if (a.v == null) return emptyAnswer(spec);
    const R = new Resp(spec, 'stat');
    let main = a.v, mainRow = null;
    const perU = spec.perUnit && (m.t === 'add' || m.k === '__n') ? spec.perUnit : null;
    const perVal = (rs) => { const s2 = series(spec, rs, m, m.k === '__n' ? 'count' : 'sum', perU); return s2.length ? sum(s2.map((x) => x.v)) / s2.length : null; };
    if (perU) { const v0 = perVal(rows); if (v0 != null) main = v0; }
    if ((how === 'max' || how === 'min') && m.k !== '__n') mainRow = extremeRow(rows, m, how);
    const prevP = prevPeriod(spec.period, ref);
    let pa = null, prevRows = [];
    let incomparable = false;
    if (prevP && spec.period.kind !== 'all') { prevRows = select(spec, { period: prevP }); pa = aggregate(prevRows, m, how); if (perU) pa = { v: perVal(prevRows), n: prevRows.length }; if (prevRows.length && !comparable(rows, prevRows, spec.period, prevP)) { incomparable = true; pa = null; } }
    const d = pa && pa.v != null ? deltaPct(main, pa.v) : null;
    const title = perU ? 'Promedio de ' + (m.k === '__n' ? DSNOUN[ds][1] : m.l.toLowerCase()) + ' por ' + TIMEDIM[perU] : metTitle(m, how);
    R.h(esc(title) + ': ' + vFmt(m, main).replace(/^/, '<span class="cf-big">') + '</span>', esc(spec.period.label) + (spec.period.txt && spec.period.kind !== 'day' ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
    R.kpis([
      kpi(perU ? 'Promedio por ' + TIMEDIM[perU] : m.k === '__n' ? m.l : metTitle(m, how), main, m.k === '__n' ? '' : m.u, { delta: pa && pa.v != null ? kd(m, main, pa.v) : undefined, deltaGood: m.good === 'down' ? 'down' : 'up', help: prevP && pa && pa.v != null ? 'vs ' + prevP.label + ': ' + vFmt(m, pa.v) : '' }),
      secondaryKpi(spec, rows, m, how, a),
      kpi('Registros usados', a.n, ''),
    ]);
    R.valor = main;
    if (mainRow) R.p((how === 'max' ? 'Ocurrió' : 'Ocurrió') + ' en <b>' + esc(rowLabel(ds, mainRow.r)) + '</b>.');
    if (note) R.note(note, 'warn');
    if (pa && pa.v != null && prevP) {
      R.p(esc(deltaSentence(m, main, pa.v, prevP.label, how)));
      if (m.t !== 'add' || m.w || how !== 'sum') { const sg = sigSentence(vals(rows, m), vals(prevRows, m)); if (sg && vals(rows, m).length >= 4 && vals(prevRows, m).length >= 4) R.p(esc(sg)); }
      else {
        const sa = series(spec, rows, m, how, 'day').map((x) => x.v), sb = series(spec, prevRows, m, how, 'day').map((x) => x.v);
        if (sa.length >= 5 && sb.length >= 5) { const sg = sigSentence(sa, sb); if (sg) R.p(esc(sg.replace('La diferencia', 'Comparando día a día, la diferencia'))); }
      }
    } else if (incomparable) R.p('No comparo con ' + esc(prevP.label) + ' porque tiene muchos menos registros (' + fmt(prevRows.length, 0) + ') y la comparación no sería justa.');
    else if (prevP && spec.period.kind !== 'all' && !spec.period.dflt) R.p('No hay datos en ' + esc(prevP.label) + ' para comparar.');
    const ins = insights(spec, rows, m, how);
    if (ins.length) R.list(ins);
    if (ds === 'agua' && m.k !== '__n' && spec.period.to - spec.period.from < 40 * DAY && m.k === 'total') {
      const nd = Math.max(1, Math.round((Math.min(spec.period.to, capT()) - spec.period.from + 1) / DAY)), exp = nd * 3;
      if (a.n < exp * 0.85) R.note('Ojo: hay <b>' + a.n + '</b> lecturas válidas de unas ' + exp + ' esperadas (3 por día) en este periodo; el total está subestimado por las lecturas que faltan.', 'warn');
    }
    if (a.n > 0 && a.n < 5 && m.k !== '__n' && (how === 'mean' || how === 'median' || how === 'wmean')) R.note('Son pocos datos (' + a.n + ' ' + plural(a.n, 'registro') + '): tómalo como una referencia, no como una conclusión.', 'warn');
    // gráfico de tendencia cuando el periodo da para varios puntos
    const days = (Math.min(spec.period.to, capT()) - spec.period.from) / DAY;
    if (days >= 4 && !(how === 'max' || how === 'min')) {
      const by = trendBy(spec.period), ser = series(spec, rows, m, m.k === '__n' ? 'count' : how === 'wmean' ? 'wmean' : how, by);
      if (ser.length >= 3) R.chart(timeChart(ser, m, how, { title: m.l + ' por ' + TIMEDIM[by], subtitle: spec.period.label, refs: refsFor(ds, m, how) }));
    } else if (days < 4 && rows.length >= 2 && rows.length <= 12) R.table(ROWCOLS[ds].filter((c) => c.k !== 'aseos'), rows.slice().sort((x, y) => y.t - x.t), { max: 8 });
    R.note(esc(discardNote(rows, m) || noBrandNote(spec)), 'warn');
    R.src(srcLine(spec, rows, m));
    R.export(dsLabel(ds), expCols(ds), rows.map((r) => expRow(ds, r)), spec.period.label);
    goBtns(R, spec);
    followChips(R, spec);
    R.conf = 0.9;
    return R;
  };

  H.trend = function (spec) {
    const ds = spec.ds, m = metOf(ds, spec.metric), how = howOf(spec, m), ref = refTime();
    const by = TIMEKEYS.includes(spec.by) ? spec.by : trendBy(spec.period);
    const rows = select(spec);
    if (!rows.length) return emptyAnswer(spec);
    const hw = m.k === '__n' ? 'count' : how;
    const ser = series(spec, rows, m, hw, by);
    if (ser.length < 2) { const s2 = Object.assign({}, spec, { by: null, intent: 'stat' }); return H.stat(s2); }
    const R = new Resp(spec, 'trend');
    const multi = (spec.brands || []).filter((b) => b !== '*').length >= 2 && HASBRAND[ds];
    R.h(esc(m.k === '__n' ? m.l : metTitle(m, how)) + ' por ' + TIMEDIM[by], esc(spec.period.label) + (spec.period.txt ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
    const vs = ser.map((x) => x.v), last = ser[ser.length - 1], first = ser[0];
    const peak = ser.reduce((a, b) => (b.v > a.v ? b : a)), low = ser.reduce((a, b) => (b.v < a.v ? b : a));
    R.kpis([kpi('Último ' + TIMEDIM[by], last.v, m.u, { help: last.label }), kpi('Máximo', peak.v, m.u, { help: peak.label }), kpi('Mínimo', low.v, m.u, { help: low.label })]);
    if (multi) {
      const sers = spec.brands.map((b) => ({ name: titleCase(b), points: series(spec, select(spec, { brands: [b] }), m, hw, by).map((x) => ({ x: x.t, y: Math.round(x.v * 1000) / 1000 })) })).filter((s) => s.points.length);
      R.chart(CH().line({ title: m.l + ' por ' + TIMEDIM[by], subtitle: 'por marca', xType: 'time', series: sers, unit: m.u, w: CW, h: 230, toolbar: true, refs: refsFor(ds, m, how) }));
    } else R.chart(timeChart(ser, m, how, { title: m.l + ' por ' + TIMEDIM[by], subtitle: spec.period.label, refs: refsFor(ds, m, how) }));
    if (ser.dropped) R.note('Excluí ' + ser.dropped + ' ' + plural(ser.dropped, 'día') + ' con lecturas incompletas (menos de 3 turnos) para no subestimar el consumo.', 'warn');
    R.p('En el periodo, el valor más alto fue <b>' + vFmt(m, peak.v) + '</b> (' + esc(peak.label) + ') y el más bajo <b>' + vFmt(m, low.v) + '</b> (' + esc(low.label) + '). ' + (first.v ? 'Pasó de ' + vFmt(m, first.v) + ' en ' + esc(first.label) + ' a ' + vFmt(m, last.v) + ' en ' + esc(last.label) + '.' : ''));
    const ts = trendSentence(vs, m.u);
    if (ts) R.p(esc(ts));
    if (by === 'day' && vs.length >= 8) { const o = ST().outliers(vs, { method: 'mad' }); if (o.idx.length) R.p('Puntos que se salen de lo habitual: ' + o.idx.slice(0, 4).map((i) => '<b>' + esc(ser[i].label) + '</b> (' + vFmt(m, ser[i].v) + ')').join(', ') + '.'); }
    R.note(esc(discardNote(rows, m) || noBrandNote(spec)), 'warn');
    R.src(srcLine(spec, rows, m));
    R.export(dsLabel(ds) + ' por ' + TIMEDIM[by], [{ h: TIMEDIM[by][0].toUpperCase() + TIMEDIM[by].slice(1), t: 's' }, { h: m.l, t: 'n' }, { h: 'Registros', t: 'n' }], ser.map((x) => [x.label, x.v, x.n]), spec.period.label);
    goBtns(R, spec);
    R.chip('Compáralo con el periodo anterior', 'compáralo con el periodo anterior').chip('¿Cuánto vamos a cerrar?', 'proyección').chip('Distribución', 'distribución').chip('¿Y por semana?', 'y por semana').chip('¿Y por mes?', 'y por mes');
    if (HASBRAND[ds]) R.chip('¿Y por marca?', 'y por marca');
    R.conf = 0.9;
    return R;
  };

  /* ---------------------------------------------------------------- por dimensión / ranking */
  const orderOf = (spec, m) => {
    const q = norm(spec.raw || '');
    let asc = /\b(menos|menor|menores|mas bajo|mas baja|mas corto|mas corta|mas rapido|mas rapida|minimo|minima|mas barato|poco)\b/.test(q);
    if (/\bmejor(es)?\b/.test(q)) asc = m.good === 'down';
    if (/\bpeor(es)?\b/.test(q)) asc = m.good === 'up';
    if (/\bmas (lento|lenta|largo|larga|alto|alta)\b/.test(q)) asc = false;
    return asc ? 'asc' : 'desc';
  };
  function groupAgg(spec, rows, by, m, how) {
    let g = groupRows(spec.ds, rows, by);
    g = g.map((x) => { const a = aggregate(x.rows, m, m.k === '__n' ? 'count' : how); return { k: x.k, label: x.label, t: x.t, v: a.v, n: x.rows.length, nv: a.n, rows: x.rows }; }).filter((x) => x.v != null);
    return g;
  }
  function byDim(spec) {
    const ds = spec.ds, m = metOf(ds, spec.metric), how = howOf(spec, m);
    const rows = select(spec);
    if (!rows.length) return emptyAnswer(spec);
    const by = spec.by, dn = dimLabel(ds, by);
    let g = groupAgg(spec, rows, by, m, how), noCause = null;
    if (by === 'cause') { noCause = g.find((x) => x.label === 'Sin causa registrada'); g = g.filter((x) => x.label !== 'Sin causa registrada' && x.v > 0); }
    if (!g.length) return emptyAnswer(spec);
    const ord = orderOf(spec, m);
    const isRank = spec.intent === 'rank';
    if (by === 'tq' || by === 'gen') g.sort((a, b) => (isRank ? (ord === 'asc' ? a.v - b.v : b.v - a.v) : (a.t != null ? a.t - b.t : parseInt(String(a.label).replace(/\D/g, ''), 10) - parseInt(String(b.label).replace(/\D/g, ''), 10)))); else g.sort((a, b) => (ord === 'asc' ? a.v - b.v : b.v - a.v));
    if (!isRank && by !== 'tq' && by !== 'gen') g.sort((a, b) => b.v - a.v);
    const lim = spec.topN || (isRank ? 5 : 12);
    const top = g.slice(0, lim);
    const total = m.t === 'add' || m.k === '__n' ? sum(g.map((x) => x.v)) : null;
    const R = new Resp(spec, isRank ? 'rank' : 'stat');
    const lead = top[0], tail = g[g.length - 1];
    R.h((isRank ? 'Ranking · ' : '') + esc(m.k === '__n' ? m.l : metTitle(m, how)) + ' por ' + esc(dn), esc(spec.period.label) + (spec.period.txt ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
    R.kpis([kpi(isRank ? (ord === 'asc' ? 'Menor' : 'Mayor') : 'Más alto', lead.v, m.u, { help: lead.label }), g.length > 1 ? kpi(isRank && ord === 'asc' ? 'Mayor' : 'Más bajo', (isRank && ord === 'asc' ? g[g.length - 1] : tail).v, m.u, { help: (isRank && ord === 'asc' ? g[g.length - 1] : tail).label }) : null, kpi('Grupos comparados', g.length, '')]);
    let sg = '';
    if (m.t !== 'add' && m.k !== '__n' && g.length >= 2) {
      const groups = {}; for (const x of g.slice(0, 8)) { const v = vals(x.rows, m); if (v.length >= 3) groups[x.label] = v; }
      if (Object.keys(groups).length >= 2) { const cg = ST().compareGroups(groups); if (cg && cg.p != null) sg = cg.significant ? 'Las diferencias entre ' + dn + 's son estadísticamente significativas (p ' + (cg.p < 0.001 ? '< 0,001' : '= ' + fmt(cg.p, 3)) + '): no parecen casualidad.' : 'Las diferencias entre ' + dn + 's no son concluyentes (p = ' + fmt(cg.p, 3) + '): con estos datos podrían ser variación normal.'; }
    }
    const share = total ? ' (' + fmt((lead.v / total) * 100, 0) + ' % del total)' : '';
    R.p('<b>' + esc(lead.label) + '</b> ' + (ord === 'asc' ? 'tiene el valor más bajo' : 'encabeza') + ' con ' + vFmt(m, lead.v) + share + (g.length > 1 ? ', frente a ' + vFmt(m, tail.v) + ' de <b>' + esc(tail.label) + '</b>' : '') + '.');
    if (sg) R.p(esc(sg));
    if (by === 'cause' && ds === 'trasiego') {
      const noC = rows.filter((r) => r.cause === 'Sin causa registrada').length;
      if (noC) R.p('Ojo: ' + noC + ' de ' + rows.length + ' actividades (' + fmt((noC / rows.length) * 100, 0) + ' %) no tienen causa registrada' + (noCause ? ' y suman ' + vFmt(m, noCause.v) : '') + '; el ranking solo cuenta las que sí.');
    }
    const chartItems = (by === 'cause' ? top.filter((x) => x.label !== 'Sin causa registrada') : top).map((x) => ({ label: x.label, v: x.v }));
    if (by === 'cause' && m.t === 'add' && chartItems.length >= 3) R.chart(CH().pareto({ title: 'Pareto de ' + dn + 's', items: chartItems.map((x) => ({ label: String(x.label).slice(0, 30), value: Math.max(0, x.v) })), unit: m.u, w: CW, h: 260, toolbar: true }));
    else if (chartItems.length >= 2) R.chart(barsH(chartItems, { title: (m.k === '__n' ? m.l : m.l) + ' por ' + dn, subtitle: spec.period.label, unit: m.u, refs: refsFor(ds, m, how) }));
    const cols = [{ k: 'label', t: dn.charAt(0).toUpperCase() + dn.slice(1) }, { k: 'v', t: m.k === '__n' ? 'Cantidad' : metTitle(m, how).slice(0, 22), num: 1, f: (v) => fmt(v, m.d != null ? m.d : autoDec(v)) + (m.u === '%' ? ' %' : '') }, { k: 'n', t: 'Registros', num: 1 }];
    if (total) cols.push({ k: 'sh', t: '% total', num: 1, f: (v) => fmt(v, 0) + ' %' });
    const tab = g.map((x) => Object.assign({}, x, { sh: total ? (x.v / total) * 100 : null }));
    R.table(cols, (isRank ? tab.slice(0, Math.max(lim, 5)) : tab), { max: Math.max(lim, 8) });
    R.note(esc(discardNote(rows, m) || noBrandNote(spec)), 'warn');
    R.src(srcLine(spec, rows, m));
    R.export(dsLabel(ds) + ' por ' + dn, cols.map((c) => ({ h: c.t, t: c.num ? 'n' : 's' })), tab.map((x) => cols.map((c) => x[c.k])), spec.period.label);
    goBtns(R, spec);
    if (by !== 'month' && by !== 'week') R.chip('¿Y por mes?', 'y por mes');
    if (HASBRAND[ds] && by !== 'brand') R.chip('¿Y por marca?', 'y por marca');
    R.chip('Compáralo con el periodo anterior', 'compáralo con el periodo anterior').chip('Más detalle', 'más detalle').chip('¿Y el mes pasado?', 'y el mes pasado');
    R.conf = 0.9;
    return R;
  }

  H.rank = function (spec) {
    const ds = spec.ds, m = metOf(ds, spec.metric), how = howOf(spec, m);
    if (spec.by && !TIMEKEYS.includes(spec.by)) { const s2 = Object.assign({}, spec, { topN: spec.topN || (spec.by === 'tq' ? 5 : null) }); return byDim(s2); }
    if (spec.by && TIMEKEYS.includes(spec.by)) {
      spec = Object.assign({}, spec, { topN: spec.topN || 1 });
      // «top 5 días con más consumo»
      const rows = select(spec); if (!rows.length) return emptyAnswer(spec);
      const ser = series(spec, rows, m, m.k === '__n' ? 'count' : how === 'wmean' ? 'wmean' : (m.t === 'add' ? 'sum' : how), spec.by);
      const ord = orderOf(spec, m); ser.sort((a, b) => (ord === 'asc' ? a.v - b.v : b.v - a.v));
      const top = ser.slice(0, spec.topN || 5);
      const R = new Resp(spec, 'rank');
      R.h(top.length === 1 ? 'El ' + TIMEDIM[spec.by] + ' con ' + (ord === 'asc' ? 'menor ' : 'mayor ') + esc(m.l.toLowerCase()) + ': ' + esc(top[0].label) : 'Top ' + top.length + ' ' + TIMEDIM[spec.by] + 's con ' + (ord === 'asc' ? 'menor ' : 'mayor ') + esc(m.l.toLowerCase()), esc(spec.period.label) + esc(brandTxt(spec)));
      R.kpis([kpi(ord === 'asc' ? 'Menor' : 'Mayor', top[0].v, m.u, { help: top[0].label }), kpi('Promedio de la serie', sum(ser.map((x) => x.v)) / ser.length, m.u), kpi(TIMEDIM[spec.by] + 's con datos', ser.length, '')]);
      if (ser.dropped) R.note('Excluí ' + ser.dropped + ' ' + plural(ser.dropped, 'día') + ' con lecturas incompletas (menos de 3 turnos) para no subestimar el consumo.', 'warn');
      R.p('El ' + TIMEDIM[spec.by] + ' con ' + (ord === 'asc' ? 'menor' : 'mayor') + ' valor fue <b>' + esc(top[0].label) + '</b> con ' + vFmt(m, top[0].v) + ' (el promedio de la serie es ' + vFmt(m, sum(ser.map((x) => x.v)) / ser.length) + ').');
      R.chart(barsH(top.map((x) => ({ label: x.label, v: x.v })), { title: 'Top ' + top.length + ' ' + TIMEDIM[spec.by] + 's', subtitle: spec.period.label, unit: m.u }));
      R.table([{ k: 'label', t: TIMEDIM[spec.by].charAt(0).toUpperCase() + TIMEDIM[spec.by].slice(1) }, { k: 'v', t: m.l, num: 1, f: (v) => fmt(v, autoDec(v)) }, { k: 'n', t: 'Registros', num: 1 }], top, { max: 10 });
      R.src(srcLine(spec, rows, m)); goBtns(R, spec);
      R.export(dsLabel(ds) + ' top', [{ h: TIMEDIM[spec.by], t: 's' }, { h: m.l, t: 'n' }], top.map((x) => [x.label, x.v]), spec.period.label);
      R.chip('Grafícalo', 'grafícalo').chip('¿Y por semana?', 'y por semana').chip('¿Por qué?', 'por qué subió');
      R.conf = 0.88;
      return R;
    }
    // filas individuales
    const rows = select(spec); if (!rows.length) return emptyAnswer(spec);
    const mm = m.k === '__n' ? metOf(ds, ({ aseos: 'm3', agua: 'total', merma: 'loss', recuperacion: 'volume', trasiego: 'delay', ferm: 'h75', lev: 'viab' })[ds]) : m;
    const ord = orderOf(spec, mm), N = spec.topN || 5;
    const [lo, hi] = mm.plaus || [-Infinity, Infinity];
    const ok = rows.filter((r) => { const v = DL().N(r[mm.k]); return v != null && v >= lo && v <= hi; });
    if (!ok.length) return emptyAnswer(spec);
    ok.sort((a, b) => (ord === 'asc' ? a[mm.k] - b[mm.k] : b[mm.k] - a[mm.k]));
    const top = ok.slice(0, N);
    const R = new Resp(spec, 'rank');
    R.h((N === 1 ? (ord === 'asc' ? 'El menor' : 'El mayor') : 'Top ' + top.length + (ord === 'asc' ? ' menores' : ' mayores')) + ' ' + DSNOUN[ds][N === 1 ? 0 : 1] + ' por ' + esc(mm.l.toLowerCase()), esc(spec.period.label) + (spec.period.txt ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
    const vAll = vals(rows, mm), mean = sum(vAll) / vAll.length;
    R.kpis([kpi(ord === 'asc' ? 'Menor' : 'Mayor', top[0][mm.k], mm.u, { help: rowLabel(ds, top[0]) }), kpi('Promedio del periodo', mean, mm.u), kpi('Registros', ok.length, '')]);
    R.p('<b>' + esc(rowLabel(ds, top[0])) + '</b> ' + (ord === 'asc' ? 'es el más bajo' : 'es el más alto') + ' con ' + vFmt(mm, top[0][mm.k]) + (mean ? ', ' + fmt(Math.abs(top[0][mm.k] / mean), 1) + ' veces el promedio del periodo (' + vFmt(mm, mean) + ').' : '.'));
    if (top.length > 1) R.chart(barsH(top.map((r) => ({ label: rowLabel(ds, r), v: r[mm.k] })), { title: 'Top ' + top.length + ' por ' + mm.l.toLowerCase(), subtitle: spec.period.label, unit: mm.u }));
    R.table(ROWCOLS[ds], top, { max: 10 });
    R.note(esc(discardNote(rows, mm)), 'warn');
    R.src(srcLine(spec, rows, mm));
    R.export(dsLabel(ds) + ' top', expCols(ds), ok.slice(0, 500).map((r) => expRow(ds, r)), spec.period.label);
    goBtns(R, spec);
    R.chip('Top 10', 'top 10').chip('¿Y por marca?', HASBRAND[ds] ? 'y por marca' : 'y por semana').chip('¿Y el mes pasado?', 'y el mes pasado').chip('Más detalle', 'más detalle');
    R.conf = 0.88;
    return R;
  };

  /* ---------------------------------------------------------------- comparar */
  function dailySeries(spec, rows, m, how) { return series(spec, rows, m, m.k === '__n' ? 'count' : m.t === 'add' ? 'sum' : how === 'wmean' ? 'wmean' : how, 'day'); }
  function sigGroups(spec, groups, m) {
    // groups: [{label, rows}] → frase de significancia o ''
    const gs = {};
    for (const g of groups) {
      let v;
      if (m.t === 'add' || m.k === '__n') v = dailySeries(spec, g.rows, m, 'sum').map((x) => x.v); else v = vals(g.rows, m);
      if (v.length >= 3) gs[g.label] = v;
    }
    const keys = Object.keys(gs);
    if (keys.length < 2) return '';
    const cg = ST().compareGroups(keys.length > 8 ? Object.fromEntries(keys.slice(0, 8).map((k) => [k, gs[k]])) : gs);
    if (!cg || cg.p == null) return '';
    const ps = cg.p < 0.001 ? '< 0,001' : '= ' + fmt(cg.p, 3);
    const unit = m.t === 'add' || m.k === '__n' ? ' (comparando día a día)' : '';
    return cg.significant ? 'La diferencia es estadísticamente significativa' + unit + ' (p ' + ps + '): es poco probable que sea casualidad.' : 'La diferencia no es concluyente' + unit + ' (p ' + ps + '): con estos datos podría ser variación normal.';
  }
  const deDe = (l) => (/^el /i.test(l) ? 'del <b>' + esc(l.slice(3)) + '</b>' : 'de <b>' + esc(l) + '</b>');
  const lenDiff = (groups) => { if (!groups[0].p || !groups[1].p) return false; const a = groups[0].p.to - groups[0].p.from + 1, b = groups[1].p.to - groups[1].p.from + 1; return Math.abs(a - b) / Math.max(a, b) > 0.15; };
  function compareGroups(spec) {
    const ds = spec.ds, m = metOf(ds, spec.metric), how = howOf(spec, m), c = spec.cmp, ref = refTime();
    let groups = [], kindTxt = '', R;
    if (c.kind === 'period') {
      const a = c.a, b = c.b;
      if (!b) return H.stat(Object.assign({}, spec, { cmp: null, intent: 'stat' }));
      const rA = select(spec, { period: a }), rB = select(spec, { period: b });
      groups = [{ label: a.label, rows: rA, p: a }, { label: b.label, rows: rB, p: b }];
      kindTxt = 'periodos';
    } else if (c.kind === 'brand') {
      groups = c.items.map((b) => ({ label: b === '*' ? 'Todas las marcas' : titleCase(b), rows: select(spec, { brands: b === '*' ? [] : [b] }) }));
      kindTxt = 'marcas';
    } else if (c.kind === 'shift') { groups = c.items.map((s) => ({ label: 'Turno ' + s.toLowerCase(), rows: select(Object.assign({}, spec, { shifts: [s] })) })); kindTxt = 'turnos'; }
    else if (c.kind === 'tank') { groups = c.items.map((t) => ({ label: (t.kind === 'UTQ' ? 'UTQ' : t.kind === 'COLECTOR' ? 'Colector' : t.kind) + ' ' + t.n, rows: select(spec, { tanks: [t] }) })); kindTxt = 'tanques'; }
    else if (c.kind === 'op') { groups = c.items.map((o) => ({ label: titleCase(o), rows: select(Object.assign({}, spec, { ops: [o] })) })); kindTxt = 'operarios'; }
    else if (c.kind === 'phase') { groups = c.items.map((p) => ({ label: p === 'FV' ? 'FV (fermentación)' : 'SV (maduración)', rows: select(Object.assign({}, spec, { phases: [p], tanks: [] })) })); kindTxt = 'etapas'; }
    else if (c.kind === 'component') {
      const rows = select(spec);
      groups = c.items.map((k) => { const mk = metOf('agua', k); return { label: mk.l, v: sum(vals(rows, mk)), n: vals(rows, mk).length, rows }; });
      const tot = sum(groups.map((g) => g.v));
      if (!rows.length || tot <= 0) return emptyAnswer(spec);
      R = new Resp(spec, 'compare');
      R.h('Consumo de agua por origen', esc(spec.period.label) + (spec.period.txt ? ' (' + esc(spec.period.txt) + ')' : ''));
      R.kpis(groups.map((g) => kpi(g.label, g.v, 'm³', { help: fmt((g.v / tot) * 100, 0) + ' % del total' })));
      groups.sort((x, y) => y.v - x.v);
      R.p('<b>' + esc(groups[0].label) + '</b> es el mayor componente: ' + withU(groups[0].v, 'm³') + ' (' + fmt((groups[0].v / tot) * 100, 0) + ' % de los ' + withU(tot, 'm³') + ' sumados de los tres contadores).');
      R.chart(CH().donut({ title: 'Reparto del consumo', subtitle: spec.period.label, data: groups.map((g) => ({ label: g.label, value: Math.round(g.v * 10) / 10 })), unit: 'm³', w: CW, h: 200, toolbar: true }));
      R.table([{ k: 'label', t: 'Origen' }, { k: 'v', t: 'm³', num: 1, f: (v) => fmt(v, 0) }, { k: 'sh', t: '% total', num: 1, f: (v) => fmt(v, 0) + ' %' }, { k: 'n', t: 'Lecturas', num: 1 }], groups.map((g) => Object.assign({ sh: (g.v / tot) * 100 }, g)));
      R.src(srcLine(spec, rows, metOf('agua', 'total')));
      R.export('Agua por origen', [{ h: 'Origen', t: 's' }, { h: 'm³', t: 'n' }], groups.map((g) => [g.label, g.v]), spec.period.label);
      goBtns(R, spec);
      R.chip('Grafícalo', 'grafícalo').chip('Compáralo con el mes pasado', 'compáralo con el mes pasado').chip('¿Y por turno?', 'y por turno');
      R.conf = 0.88;
      return R;
    }
    groups = groups.filter((g) => g);
    const withData = groups.filter((g) => aggregate(g.rows, m, m.k === '__n' ? 'count' : how).v != null);
    if (withData.length < 2) {
      const R0 = emptyAnswer(spec, 'Para comparar necesito datos en al menos dos de los grupos (' + groups.map((g) => esc(g.label) + ': ' + g.rows.length).join(', ') + ').');
      return R0;
    }
    const aggs = groups.map((g) => Object.assign({ g }, aggregate(g.rows, m, m.k === '__n' ? 'count' : how)));
    R = new Resp(spec, 'compare');
    R.h(esc(m.k === '__n' ? m.l : metTitle(m, how)) + ': ' + groups.map((g) => esc(g.label)).join(' vs '), (c.kind === 'period' ? '' : esc(spec.period.label) + (spec.period.txt ? ' (' + esc(spec.period.txt) + ')' : '')) + (filtTxt(spec) && c.kind !== 'period' ? ' · ' + esc(filtTxt(spec)) : '') + (c.kind !== 'brand' ? esc(brandTxt(spec)) : ''));
    const base = aggs[0];
    const isP = c.kind === 'period', refI = isP ? 1 : 0;
    const refA = aggs[refI];
    R.kpis(aggs.slice(0, 4).map((x, i) => kpi(x.g.label.length > 26 ? x.g.label.slice(0, 25) + '…' : x.g.label, x.v, m.k === '__n' ? '' : m.u, i !== refI && refA.v != null && x.v != null && !(isP && how === 'sum' && lenDiff(groups))
      ? { delta: kd(m, x.v, refA.v), deltaGood: m.good === 'down' ? 'down' : 'up', help: 'frente a ' + refA.g.label } : { help: x.n + ' registros' })));
    // frase de lectura
    const ok = aggs.filter((x) => x.v != null);
    if (ok.length >= 2) {
      const x0 = isP ? ok[1] : ok[0], x1 = isP ? ok[0] : ok[1];
      let dv0 = x0.v, dv1 = x1.v, per = '';
      if (isP && how === 'sum' && lenDiff(groups)) { const dA = Math.max(1, Math.round((groups[0].p.to - groups[0].p.from + 1) / DAY)), dB = Math.max(1, Math.round((groups[1].p.to - groups[1].p.from + 1) / DAY)); dv1 = x1.v / dA; dv0 = x0.v / dB; per = ' por día'; }
      const d = deltaPct(dv1, dv0);
      let phr = '<b>' + esc(x1.g.label) + '</b> ' + (d == null ? 'registra ' + vFmt(m, x1.v) : (d > 0 ? 'está ' + fmt(Math.abs(d), 1) + ' % por encima' : d < 0 ? 'está ' + fmt(Math.abs(d), 1) + ' % por debajo' : 'es igual') + ' ' + deDe(x0.g.label) + ' (' + vFmt(m, dv1) + ' vs ' + vFmt(m, dv0) + per + ')') + '.';
      if (d != null && m.good && Math.abs(d) >= 0.5) phr += ' ' + ((m.good === 'down') !== (d > 0) ? 'Es un resultado favorable.' : 'Conviene revisarlo.');
      R.p(phr);
      if (isP && (m.t === 'add' || m.k === '__n') && how === 'sum' && lenDiff(groups)) {
        const dA = Math.max(1, Math.round((groups[0].p.to - groups[0].p.from + 1) / DAY)), dB = Math.max(1, Math.round((groups[1].p.to - groups[1].p.from + 1) / DAY));
        R.p('Ojo: los periodos no tienen los mismos días (' + dA + ' vs ' + dB + '), por eso comparo el promedio por día: ' + esc(groups[0].label) + ' ' + fa(aggs[0].v / dA) + ' y ' + esc(groups[1].label) + ' ' + fa(aggs[1].v / dB) + ' ' + esc(m.u) + '.');
      }
      const sg = sigGroups(spec, groups.filter((g) => g.rows.length), m);
      if (sg) R.p(esc(sg));
    }
    // gráfico
    const doLine = c.kind === 'period' || ((c.kind === 'brand' || c.kind === 'phase') && (spec.period.to - spec.period.from) / DAY >= 60);
    if (c.kind === 'period' && groups.every((g) => g.rows.length >= 4)) {
      const sers = groups.map((g) => { const dsr = dailySeries(spec, g.rows, m, how); return { name: g.label, points: dsr.map((x) => ({ x: Math.floor((x.t - sod(g.p.from)) / DAY) + 1, y: Math.round(x.v * 100) / 100 })) }; }).filter((s) => s.points.length >= 2);
      if (sers.length === 2) R.chart(CH().line({ title: (m.k === '__n' ? m.l : m.l) + ' por día', subtitle: 'día del periodo (1 = primer día)', xType: 'linear', series: sers, unit: m.u, w: CW, h: 230, toolbar: true, xFmt: (v) => 'd' + v }));
    } else if (doLine && c.kind !== 'period') {
      const by = (spec.period.to - spec.period.from) / DAY > 150 ? 'month' : 'week';
      const sers = groups.map((g) => ({ name: g.label, points: series(spec, g.rows, m, m.k === '__n' ? 'count' : how, by).map((x) => ({ x: x.t, y: Math.round(x.v * 100) / 100 })) })).filter((s) => s.points.length >= 2);
      if (sers.length >= 2) R.chart(CH().line({ title: m.l + ' por ' + TIMEDIM[by], subtitle: kindTxt, xType: 'time', series: sers, unit: m.u, w: CW, h: 230, toolbar: true, refs: refsFor(ds, m, how) }));
    }
    if (!R.hasChart) R.chart(CH().bars({ title: m.l, subtitle: groups.map((g) => g.label).join(' vs '), data: aggs.filter((x) => x.v != null).map((x) => ({ label: x.g.label.slice(0, 22), value: Math.round(x.v * 100) / 100 })), unit: m.u, w: CW, h: 220, toolbar: true, refs: refsFor(ds, m, how) }));
    R.table([{ k: 'l', t: 'Grupo' }, { k: 'v', t: m.k === '__n' ? 'Cantidad' : metTitle(m, how).slice(0, 20), num: 1, f: (v) => fmt(v, m.d != null ? m.d : autoDec(v)) }, { k: 'n', t: 'Registros', num: 1 }, { k: 'd', t: 'vs primero', num: 1, f: (v) => (v == null ? '—' : (v > 0 ? '+' : '') + fmt(v, 1) + ' %') }],
      aggs.map((x, i) => ({ l: x.g.label, v: x.v, n: x.n, d: i && base.v != null && x.v != null ? deltaPct(x.v, base.v) : null })));
    const allRows = groups.flatMap((g) => g.rows);
    R.note(esc(discardNote(allRows, m) || noBrandNote(spec)), 'warn');
    R.src(esc('Fuente: ' + dsLabel(ds) + ' · ' + (c.kind === 'period' ? groups.map((g) => g.label + (g.p && g.p.txt ? ' (' + g.p.txt + ')' : '')).join(' vs ') : spec.period.label + (spec.period.txt ? ' (' + spec.period.txt + ')' : '')) + ' · ' + aggs.map((x) => x.n).join(' y ') + ' registros'));
    R.export(dsLabel(ds) + ' comparación', [{ h: 'Grupo', t: 's' }, { h: m.l, t: 'n' }, { h: 'Registros', t: 'n' }], aggs.map((x) => [x.g.label, x.v, x.n]), spec.period.label);
    goBtns(R, spec);
    R.chip('¿Por qué cambió?', 'por qué cambió').chip('Grafícalo', 'grafícalo').chip('Más detalle', 'más detalle');
    if (c.kind === 'period') R.chip('¿Y por marca?', HASBRAND[ds] ? 'y por marca' : 'y por semana');
    R.conf = 0.9;
    return R;
  }
  H.compare = function (spec) { return compareGroups(spec); };

  /* ---------------------------------------------------------------- listar / contar / proporción */
  function dayFallback(spec) {
    if (spec.period.kind !== 'day') return null;
    const all = select(Object.assign({}, spec, { period: P(0, capT(), 'todo', 'all') }));
    if (!all.length) return null;
    const t = all[all.length - 1].t;
    return { period: dayPeriod(t, 'el último día con datos (' + fd(t) + ')'), old: spec.period.label };
  }
  H.list = function (spec) {
    const ds = spec.ds, ref = refTime(), m = metOf(ds, spec.metric === '__n' ? ({ aseos: 'm3', agua: 'total', merma: 'loss', recuperacion: 'volume', trasiego: 'delay', ferm: 'h75', lev: 'viab' })[ds] : spec.metric);
    let rows = select(spec), fbNote = '';
    if (!rows.length) { const fb = dayFallback(spec); if (fb) { spec = Object.assign({}, spec, { period: fb.period }); rows = select(spec); fbNote = 'No hay registros para ' + esc(fb.old) + '. Te muestro el último día con datos.'; } }
    if (!rows.length) return emptyAnswer(spec);
    const sorted = rows.slice().sort((a, b) => b.t - a.t);
    const R = new Resp(spec, 'list');
    R.h(rows.length + ' ' + DSNOUN[ds][rows.length === 1 ? 0 : 1] + (spec.conds.length ? (rows.length === 1 ? ' que cumple' : ' que cumplen') : ''), esc(spec.period.label) + (spec.period.txt && spec.period.kind !== 'day' ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
    const a = aggregate(rows, m, defaultHow(m));
    const k = [kpi('Registros', rows.length, ''), a.v != null ? kpi(metTitle(m, defaultHow(m)), a.v, m.u) : null, kpi('Más reciente', fd(sorted[0].t), '')];
    if (fbNote) R.note(fbNote, 'warn');
    R.kpis(k);
    const first = sorted[0], lastR = sorted[sorted.length - 1];
    R.p('Van del <b>' + fd(lastR.t) + '</b> al <b>' + fd(first.t) + '</b>. ' + (a.v != null ? 'En conjunto: ' + esc(metTitle(m, defaultHow(m)).toLowerCase()) + ' <b>' + vFmt(m, a.v) + '</b>.' : ''));
    const ins = spec.more ? insights(spec, rows, m, defaultHow(m)) : [];
    if (ins.length) R.list(ins);
    R.table(ROWCOLS[ds], sorted, { max: spec.more ? 20 : 10 });
    R.note(esc(discardNote(rows, m) || noBrandNote(spec)), 'warn');
    R.src(srcLine(spec, rows, null));
    R.export(dsLabel(ds), expCols(ds), sorted.slice(0, 2000).map((r) => expRow(ds, r)), spec.period.label);
    goBtns(R, spec);
    R.chip('Grafícalo', 'grafícalo').chip('¿Y por semana?', 'y por semana').chip('Top 5 por valor', 'top 5');
    if (HASBRAND[ds]) R.chip('¿Y por marca?', 'y por marca');
    R.conf = 0.88;
    return R;
  };

  H.count = function (spec) {
    const ds = spec.ds, ref = refTime(), m = metOf(ds, '__n');
    let rows = select(spec), fbNote = '';
    if (!rows.length) { const fb = dayFallback(spec); if (fb) { spec = Object.assign({}, spec, { period: fb.period }); rows = select(spec); fbNote = 'No hay registros para ' + esc(fb.old) + '. Te muestro el último día con datos.'; } }
    { const e0 = DL().extent(ds); if (!rows.length && e0 && e0.to < spec.period.from) return emptyAnswer(spec, 'Todavía no hay registros de ' + esc(dsLabel(ds).toLowerCase()) + ' en ' + esc(spec.period.label) + ': los datos llegan hasta el <b>' + fd(e0.to) + '</b>.'); }
    const R = new Resp(spec, 'count');
    R.valor = rows.length;
    const base = (spec.conds.length || (spec.tanks || []).length || (spec.eqTerms || []).length || (spec.ops || []).length || (spec.brands || []).length) ? select(Object.assign({}, spec, { conds: [], tanks: [], eqTerms: [], eqTypes: [], ops: [], brands: [], cause: null, state: null, kind: null })) : null;
    const prevP = prevPeriod(spec.period, ref);
    let prev = prevP ? select(spec, { period: prevP }) : [];
    if (prev.length && !comparable(rows, prev, spec.period, prevP)) prev = [];
    R.h(fmt(rows.length, 0) + ' ' + DSNOUN[ds][rows.length === 1 ? 0 : 1], esc(spec.period.label) + (spec.period.txt && spec.period.kind !== 'day' ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
    const days = Math.max(1, Math.round((Math.min(spec.period.to, capT()) - spec.period.from + 1) / DAY));
    const d = prev.length ? deltaPct(rows.length, prev.length) : null;
    R.kpis([kpi('Cantidad', rows.length, '', { delta: d != null && Math.abs(d) > 0.05 ? d : undefined, deltaGood: 'up', help: prevP && prev.length ? 'vs ' + prevP.label + ': ' + prev.length : '' }), base && base.length ? kpi('Del total del periodo', (rows.length / base.length) * 100, '%', { help: rows.length + ' de ' + base.length }) : kpi('Promedio por día', rows.length / days, ''), days >= 14 ? kpi('Promedio por semana', (rows.length / days) * 7, '') : null]);
    if (fbNote) R.note(fbNote, 'warn');
    if (!rows.length) R.p('No hay ' + DSNOUN[ds][1] + ' con esas condiciones' + (base && base.length ? ', de los ' + base.length + ' del periodo.' : ' en el periodo.'));
    else {
      let t = 'Contando todos los registros de ese periodo' + (base && base.length ? ', <b>' + rows.length + ' de ' + base.length + '</b> (' + fmt((rows.length / base.length) * 100, 1) + ' %) cumplen lo que pediste.' : ': <b>' + rows.length + '</b>.');
      R.p(t);
      if (d != null) R.p(esc((d > 0 ? 'Son ' : 'Son ') + fmt(Math.abs(d), 0) + ' % ' + (d > 0 ? 'más' : 'menos') + ' que ' + prevP.label + ' (' + prev.length + ').'));
    }
    if (days >= 6 && rows.length >= 3) {
      const by = trendBy(spec.period), ser = series(spec, rows, m, 'count', by);
      if (ser.length >= 3) R.chart(timeChart(ser, m, 'count', { title: m.l + ' por ' + TIMEDIM[by], subtitle: spec.period.label }));
    }
    const ins = insights(spec, rows, metOf(ds, spec.conds[0] && spec.conds[0].k ? spec.conds[0].k : metOf(ds, null).k || '__n'), 'count');
    if (rows.length && ins.length && ds !== 'aseos') R.list(ins.slice(0, 2));
    if (rows.length && rows.length <= 12) R.table(ROWCOLS[ds], rows.slice().sort((a, b) => b.t - a.t), { max: 8 });
    R.src(srcLine(spec, rows, null));
    R.export(dsLabel(ds), expCols(ds), rows.slice(0, 2000).map((r) => expRow(ds, r)), spec.period.label);
    goBtns(R, spec);
    R.chip('Muéstramelos', 'lista de esos registros').chip('Grafícalo', 'grafícalo').chip('¿Y el mes pasado?', 'y el mes pasado');
    if (HASBRAND[ds]) R.chip('¿Y por marca?', 'y por marca');
    R.conf = 0.9;
    return R;
  };

  H.share = function (spec) {
    const ds = spec.ds;
    if (!spec.conds.length) return H.stat(Object.assign({}, spec, { intent: 'stat' }));
    const c = spec.conds[0], m = metOf(ds, c.k), ref = refTime();
    const base = select(Object.assign({}, spec, { conds: [] })).filter((r) => vals([r], m).length);
    if (!base.length) return emptyAnswer(spec);
    const pass = base.filter((r) => condPass(c, r, ds));
    const share = (pass.length / base.length) * 100;
    const prevP = prevPeriod(spec.period, ref);
    let pshare = null;
    if (prevP) { const pb = select(Object.assign({}, spec, { conds: [] }), { period: prevP }).filter((r) => vals([r], m).length); if (pb.length >= 3) pshare = (pb.filter((r) => condPass(c, r, ds)).length / pb.length) * 100; }
    const R = new Resp(spec, 'share');
    R.valor = share;
    R.h(fmt(share, 1) + ' % cumple: ' + esc(condTxt(c, ds)), esc(spec.period.label) + (spec.period.txt ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)));
    R.kpis([kpi('Cumplen', share, '%', { delta: pshare != null ? deltaPct(share, pshare) : undefined, deltaGood: 'up', help: prevP && pshare != null ? 'vs ' + prevP.label + ': ' + fmt(pshare, 1) + ' %' : '' }), kpi('Registros que cumplen', pass.length, ''), kpi('Registros evaluados', base.length, '')]);
    R.chart(CH().donut({ title: 'Cumplen / no cumplen', subtitle: condTxt(c, ds), data: [{ label: 'Cumplen', value: pass.length }, { label: 'No cumplen', value: base.length - pass.length }], w: CW, h: 160, toolbar: true }));
    R.p('De <b>' + base.length + '</b> ' + DSNOUN[ds][1] + ' con ' + esc(m.l.toLowerCase()) + ' registrado, <b>' + pass.length + '</b> cumplen (' + fmt(share, 1) + ' %).' + (pshare != null ? ' En ' + esc(prevP.label) + ' era ' + fmt(pshare, 1) + ' %.' : ''));
    const goal = metaG(ds === 'recuperacion' ? 'recuperacion.objetivoH' : 'x', null);
    if (ds === 'recuperacion' && c.k === 'hours') R.p('Para que el 80 % se haga en ' + c.v + ' h faltarían ' + Math.max(0, Math.ceil(base.length * 0.8) - pass.length) + ' recuperaciones más dentro de ese tiempo. Puedes preguntarme «si el 80 % de las recuperaciones se hace en 72 h, ¿qué ganamos?».');
    R.note(esc(discardNote(base, m)), 'warn');
    R.src(srcLine(spec, base, m));
    R.export(dsLabel(ds), expCols(ds), pass.slice(0, 2000).map((r) => expRow(ds, r)), spec.period.label);
    goBtns(R, spec);
    R.chip('Muéstramelos', 'lista de esos registros').chip('¿Y el mes pasado?', 'y el mes pasado');
    if (HASBRAND[ds]) R.chip('¿Y por marca?', 'y por marca');
    R.conf = 0.88;
    return R;
  };

  /* ---------------------------------------------------------------- distribución */
  H.dist = function (spec) {
    const ds = spec.ds, m0 = metOf(ds, spec.metric), m = m0.k === '__n' ? metOf(ds, ({ aseos: 'm3', agua: 'total', merma: 'lossPct', recuperacion: 'hours', trasiego: 'duration', ferm: 'h75', lev: 'viab' })[ds]) : m0;
    const rows = select(spec);
    const v = vals(rows, m);
    if (v.length < 5) return emptyAnswer(spec, 'Para una distribución necesito al menos 5 valores y hay ' + v.length + '.');
    const sm = ST().summary(v), hs = ST().histogram(v, {}), out = ST().outliers(v, { method: 'iqr' });
    const R = new Resp(spec, 'dist');
    R.h('Distribución: ' + esc(m.l.toLowerCase()), esc(spec.period.label) + (spec.period.txt ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
    const p10 = quant(v, 0.1), p90 = quant(v, 0.9);
    R.kpis([kpi('Mediana', sm.median, m.u), kpi('Promedio', sm.mean, m.u), kpi('Rango habitual (P10–P90)', fa(p10) + ' – ' + fa(p90), m.u)]);
    if (spec.by && !TIMEKEYS.includes(spec.by)) {
      const g = groupRows(ds, rows, spec.by).map((x) => ({ label: x.label, values: vals(x.rows, m) })).filter((x) => x.values.length >= 4).slice(0, 10);
      if (g.length >= 2) R.chart(CH().box({ title: m.l + ' por ' + dimLabel(ds, spec.by), groups: g, unit: m.u, w: CW, h: 240, toolbar: true, horizontal: g.length > 5 }));
    }
    if (!R.hasChart) R.chart(CH().histogram({ title: 'Cómo se reparte ' + m.l.toLowerCase(), subtitle: spec.period.label, values: v, unit: m.u, w: CW, h: 230, toolbar: true }));
    const cvv = sm.cv != null ? sm.cv * 100 : null;
    R.p('El 80 % de los registros está entre <b>' + vFmt(m, p10) + '</b> y <b>' + vFmt(m, p90) + '</b>; la mitad pasa de ' + vFmt(m, sm.median) + '. ' + (cvv != null ? 'La variación (CV) es ' + fmt(cvv, 0) + ' %: ' + (cvv < 10 ? 'un proceso muy estable.' : cvv < 30 ? 'variación moderada.' : 'mucha variación; hay oportunidad de estandarizar.') : ''));
    if (sm.mean != null && sm.median != null && Math.abs(sm.mean - sm.median) / (Math.abs(sm.median) || 1) > 0.15) R.p('El promedio (' + vFmt(m, sm.mean) + ') se aleja de la mediana (' + vFmt(m, sm.median) + '): unos pocos valores altos o bajos arrastran el promedio, por eso conviene mirar la mediana.');
    if (out.idx.length) R.p('<b>' + out.idx.length + '</b> ' + plural(out.idx.length, 'valor') + ' atípico' + (out.idx.length === 1 ? '' : 's') + ' (fuera de ' + fa(out.lo) + ' – ' + fa(out.hi) + '): ' + esc(out.values.slice(0, 5).map((x) => fa(x)).join(', ')) + (out.idx.length > 5 ? '…' : '') + '.');
    R.note(esc(discardNote(rows, m) || noBrandNote(spec)), 'warn');
    R.src(srcLine(spec, rows, m));
    R.export(dsLabel(ds) + ' distribución', [{ h: m.l, t: 'n' }], v.map((x) => [x]), spec.period.label);
    goBtns(R, spec);
    if (HASBRAND[ds] && !spec.by) R.chip('¿Y por marca?', 'distribución por marca');
    R.chip('Grafícalo en el tiempo', 'evolución').chip('¿Y el mes pasado?', 'y el mes pasado');
    R.conf = 0.88;
    return R;
  };

  /* ---------------------------------------------------------------- relaciones */
  const CORR_PAIRS = {
    agua: [['production', 'Mosto recibido (Hl)'], ['aseos', 'N.º de aseos']],
    aseos: [['minutes', 'm3'], ['flow', 'm3']],
    merma: [['input', 'loss'], ['purges', 'loss']],
    recuperacion: [['hours', 'yieldPct'], ['yeast', 'volume']],
    trasiego: [['duration', 'delay']],
    ferm: [['viab', 'h75'], ['eo', 'atten'], ['gen', 'h75'], ['cons', 'h75']],
    lev: [['gen', 'viab'], ['viab', 'cons']],
  };
  H.corr = function (spec) {
    const ds = spec.ds, q = norm(spec.raw || '');
    const rows = select(spec);
    let xk, yk, daily = false;
    const found = (MET[ds] || []).filter((x) => !x.def && x.re.test(q)).map((x) => x.k);
    if (ds === 'agua') { xk = /aseos?/.test(q) ? 'aseos' : /trasegad/.test(q) ? 'transfer' : 'hlproc'; yk = 'total'; daily = true; }
    else if (ds === 'recuperacion' && /levadura|recolect/.test(q) && /recuperad|cerveza/.test(q)) { xk = 'yeast'; yk = 'volume'; }
    else if (found.length >= 2) { found.sort((a, b) => { const ia = (MET[ds].find((x) => x.k === a).re.exec(q) || {}).index, ib = (MET[ds].find((x) => x.k === b).re.exec(q) || {}).index; return ia - ib; }); xk = found[0]; yk = found[1]; }
    else { const pr = (CORR_PAIRS[ds] || [])[0]; if (!pr) return emptyAnswer(spec, 'No tengo una relación natural para ese tema.'); [xk, yk] = pr; if (found.length === 1) { const cand = (CORR_PAIRS[ds] || []).find((p) => p.includes(found[0])); if (cand) { xk = cand[0]; yk = cand[1]; } } }
    let pts = [], xl, yl, xu, yu;
    if (ds === 'agua') {
      const g = groupRows('agua', rows, 'day');
      for (const x of g) {
        const tot = sum(vals(x.rows, metOf('agua', 'total'))), n = vals(x.rows, metOf('agua', 'total')).length;
        if (n < 2) continue;
        let xv;
        if (xk === 'aseos') xv = sum(x.rows.map((r) => r.aseos || 0)); else if (xk === 'transfer') xv = sum(x.rows.map((r) => r.transfer || 0)); else xv = sum(x.rows.map((r) => ((r.production > 0 && r.production < 30000 ? r.production : 0) + (r.transfer || 0))));
        if (xv > 0 && tot > 0) pts.push({ x: xk === 'aseos' ? xv : xv, y: tot, label: fd(x.t) });
      }
      xl = xk === 'aseos' ? 'Aseos del día' : xk === 'transfer' ? 'Hl trasegados del día' : 'Hl de mosto + trasiego del día'; yl = 'Consumo de agua del día (m³)'; xu = xk === 'aseos' ? '' : 'Hl'; yu = 'm³';
    } else {
      const mx = metOf(ds, xk), my = metOf(ds, yk);
      for (const r of rows) { const a = DL().N(r[xk]), b = DL().N(r[yk]); if (a == null || b == null) continue; if (mx.plaus && (a < mx.plaus[0] || a > mx.plaus[1])) continue; if (my.plaus && (b < my.plaus[0] || b > my.plaus[1])) continue; pts.push({ x: a, y: b, label: rowLabel(ds, r) }); }
      xl = mx.l + (mx.u ? ' (' + mx.u + ')' : ''); yl = my.l + (my.u ? ' (' + my.u + ')' : ''); xu = mx.u; yu = my.u;
    }
    if (pts.length < 6) return emptyAnswer(spec, 'Para medir una relación necesito al menos 6 pares de datos y encontré ' + pts.length + '.');
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const pe = ST().pearson(xs, ys), sp = ST().spearman(xs, ys), lr = ST().linreg(xs, ys);
    if (!pe) return emptyAnswer(spec, 'No pude calcular la relación (los valores casi no varían).');
    const st = ST().strength(pe.r), ps = pe.p < 0.001 ? '< 0,001' : '= ' + fmt(pe.p, 3);
    const R = new Resp(spec, 'corr');
    R.h('Relación: ' + esc(xl.replace(/ \(.*\)/, '')) + ' y ' + esc(yl.replace(/ \(.*\)/, '')), esc(spec.period.label) + (spec.period.txt ? ' (' + esc(spec.period.txt) + ')' : '') + esc(brandTxt(spec)));
    R.kpis([kpi('Correlación (r)', fmt(pe.r, 2), '', { help: st }), kpi('R² (lo que explica)', lr ? fmt(lr.r2 * 100, 0) : '—', '%'), kpi('Pares usados', pts.length, '')]);
    R.chart(CH().scatter({ title: yl + ' vs ' + xl, points: pts, xLabel: xl, yLabel: yl, w: CW, h: 250, toolbar: true }));
    const dir = pe.r > 0 ? 'positiva (cuando uno sube, el otro tiende a subir)' : 'negativa (cuando uno sube, el otro tiende a bajar)';
    R.p('La relación es <b>' + st + '</b> y ' + dir + ': r = ' + fmt(pe.r, 2) + (sp ? ' (Spearman ' + fmt(sp.r, 2) + ')' : '') + '. ' + (pe.p < 0.05 ? 'Es estadísticamente significativa (p ' + ps + '): es poco probable que sea casualidad.' : 'No es significativa (p ' + ps + '): con estos datos no puedo afirmar que exista relación.'));
    if (lr && pe.p < 0.05) R.p('En términos prácticos, por cada +1 ' + esc(xu || 'unidad') + ' de ' + esc(xl.replace(/ \(.*\)/, '').toLowerCase()) + ', ' + esc(yl.replace(/ \(.*\)/, '').toLowerCase()) + ' cambia en promedio <b>' + fmt(lr.b, Math.abs(lr.b) < 1 ? 3 : 2) + (yu ? ' ' + esc(yu) : '') + '</b>.');
    R.note('Correlación no es causalidad: indica que se mueven juntos, no que uno cause al otro.', '');
    R.src(esc('Fuente: ' + dsLabel(ds) + ' · ' + spec.period.label + ' · ' + pts.length + ' pares' + (ds === 'agua' ? ' (un punto por día)' : '')));
    R.export(dsLabel(ds) + ' relación', [{ h: xl, t: 'n' }, { h: yl, t: 'n' }, { h: 'Etiqueta', t: 's' }], pts.map((p) => [p.x, p.y, p.label]), spec.period.label);
    goBtns(R, spec);
    R.go_('Ver relaciones en Análisis', 'analisis/relaciones', { ds });
    R.chip('Grafícalo', 'grafícalo').chip('¿Y por marca?', HASBRAND[ds] ? 'y por marca' : 'y por semana').chip('Distribución', 'distribución');
    R.conf = 0.85;
    return R;
  };

  /* ---------------------------------------------------------------- causas: ¿por qué subió/bajó? */
  const y0 = (t) => new Date(t).getFullYear();
  const CAUSE_DIMS = { agua: ['shift'], aseos: ['eqType', 'eq', 'tipo'], merma: ['brand', 'phase', 'tq'], recuperacion: ['utk', 'brand'], trasiego: ['cause', 'brand', 'kind'], ferm: ['brand', 'fam', 'gen'], lev: ['brand', 'gen', 'fam'] };
  H.cause = function (spec) {
    const ds = spec.ds, m0 = metOf(ds, spec.metric), m = m0.k === '__n' && ds !== 'aseos' && ds !== 'trasiego' ? metOf(ds, MET[ds].find((x) => x.def).k) : m0, ref = refTime();
    const how = m.k === '__n' ? 'count' : howOf(spec, m);
    let cur = spec.period;
    if (spec.periodDefault) { const d = new Date(ref); cur = monthPeriod(d.getFullYear(), d.getMonth(), ref); cur.label = 'este mes (' + MESES[d.getMonth()] + ')'; }
    let causeNote = '';
    let rC = select(spec, { period: cur });
    if (spec.periodDefault && rC.length < 3) {
      for (let k = 1; k <= 12; k++) { const dd = new Date(y0(ref), new Date(ref).getMonth() - k, 1), pm = monthPeriod(dd.getFullYear(), dd.getMonth(), ref), rr = select(spec, { period: pm }); if (rr.length >= 3) { causeNote = 'En ' + cur.label + ' todavía no hay registros suficientes; analicé el último mes con datos (' + MESES[dd.getMonth()] + ').'; cur = pm; cur.label = MESES[dd.getMonth()] + (dd.getFullYear() !== REF_YEAR ? ' de ' + dd.getFullYear() : ''); rC = rr; break; } }
    }
    const prev = prevPeriod(cur, ref);
    const rP = prev ? select(spec, { period: prev }) : [];
    const aC = aggregate(rC, m, how), aP = aggregate(rP, m, how);
    if (aC.v == null || aP.v == null) return emptyAnswer(spec, 'Para explicar un cambio necesito datos en los dos periodos (' + esc(cur.label) + ': ' + rC.length + ' registros; ' + esc(prev ? prev.label : 'anterior') + ': ' + rP.length + ').');
    const d = deltaPct(aC.v, aP.v);
    const R = new Resp(Object.assign({}, spec, { period: cur }), 'cause');
    const qn = norm(spec.raw || ''), askedUp = /subi|aument|alz|crec|empeor|mas alt/.test(qn), askedDown = /baj|disminu|cay|reduj|mejor/.test(qn);
    const up = d != null && d > 0;
    R.h('¿Qué cambió en ' + esc(m.l.toLowerCase()) + '?', esc(cur.label) + ' vs ' + esc(prev.label));
    if (causeNote) R.note(esc(causeNote), 'warn');
    R.kpis([kpi(cur.label.length > 24 ? 'Periodo actual' : cur.label, aC.v, m.u, { delta: d != null ? d : undefined, deltaGood: m.good === 'down' ? 'down' : 'up' }), kpi(prev.label.length > 24 ? 'Periodo anterior' : prev.label, aP.v, m.u), kpi('Cambio', aC.v - aP.v, m.u)]);
    let lead = vFmt(m, aC.v) + ' frente a ' + vFmt(m, aP.v) + ' (' + (d == null ? 'sin %' : (d > 0 ? '+' : '') + fmt(d, 1) + ' %') + ').';
    if (d != null && Math.abs(d) < 2) lead = 'Prácticamente no cambió: ' + lead;
    else if ((askedUp && !up) || (askedDown && up)) lead = 'En realidad ' + (up ? 'subió' : 'bajó') + ', no ' + (up ? 'bajó' : 'subió') + ': ' + lead;
    else lead = (up ? 'Subió: ' : 'Bajó: ') + lead;
    R.p(esc(lead));
    // significancia
    const sg = m.t === 'add' || m.k === '__n' ? (() => { const a = dailySeries(spec, rC, m, how).map((x) => x.v), b = dailySeries(spec, rP, m, how).map((x) => x.v); return a.length >= 5 && b.length >= 5 ? sigSentence(a, b) : null; })() : sigSentence(vals(rC, m), vals(rP, m));
    if (sg) R.p(esc(sg));
    // descomposición por dimensiones
    const found = [];
    for (const dim of CAUSE_DIMS[ds] || []) {
      if (!(DIMS[ds] && DIMS[ds][dim])) continue;
      const gC = new Map(groupRows(ds, rC, dim).map((g) => [g.k, g])), gP = new Map(groupRows(ds, rP, dim).map((g) => [g.k, g]));
      const keys = uniq([...gC.keys(), ...gP.keys()]);
      const items = [];
      const totC = rC.length || 1, totP = rP.length || 1;
      for (const k of keys) {
        const c1 = gC.get(k), p1 = gP.get(k);
        const ac = c1 ? aggregate(c1.rows, m, how) : { v: null, n: 0 }, ap = p1 ? aggregate(p1.rows, m, how) : { v: null, n: 0 };
        let contrib;
        if (m.t === 'add' || m.k === '__n') contrib = (ac.v || 0) - (ap.v || 0);
        else { const wc = (c1 ? c1.rows.length : 0) / totC, wp = (p1 ? p1.rows.length : 0) / totP; const mc = ac.v != null ? ac.v : aP.v, mp = ap.v != null ? ap.v : aC.v; contrib = wc * (mc - mp) + (wc - wp) * (mp - aP.v); }
        items.push({ label: (c1 || p1).label, contrib, ac: ac.v, ap: ap.v, nc: ac.n, np: ap.n });
      }
      const tot = sum(items.map((x) => Math.abs(x.contrib))) || 1;
      items.sort((x, y) => Math.abs(y.contrib) - Math.abs(x.contrib));
      found.push({ dim, items, conc: Math.abs(items[0].contrib) / tot });
    }
    found.sort((x, y) => y.conc - x.conc);
    const best = found[0];
    if (best && best.items.length) {
      const dn = dimLabel(ds, best.dim), top = best.items.slice(0, 3);
      const totalChange = aC.v - aP.v;
      R.p('<b>Qué lo explica</b> (por ' + esc(dn) + '): ' + top.map((x) => '<b>' + esc(x.label) + '</b> ' + (x.contrib > 0 ? '+' : '') + fa(x.contrib) + ' ' + esc(m.u === '%' ? 'pts' : m.u) + (m.t === 'add' && totalChange ? ' (' + fmt((x.contrib / totalChange) * 100, 0) + ' % del cambio)' : '') + (x.ac != null && x.ap != null ? ' [' + fa(x.ap) + ' → ' + fa(x.ac) + ']' : '')).join('; ') + '.');
      if (m.t === 'add' || m.k === '__n') {
        const steps = [{ label: prev.label.length > 14 ? 'Antes' : prev.label, value: aP.v, total: true }, ...top.map((x) => ({ label: String(x.label).slice(0, 14), value: x.contrib })), ...(best.items.length > 3 ? [{ label: 'Otros', value: sum(best.items.slice(3).map((x) => x.contrib)) }] : []), { label: cur.label.length > 14 ? 'Ahora' : cur.label, total: true }];
        R.chart(CH().waterfall({ title: 'De ' + fa(aP.v) + ' a ' + fa(aC.v) + ' ' + (m.u || ''), subtitle: 'contribución por ' + dn, steps, unit: m.u, w: CW, h: 240, toolbar: true }));
      } else R.chart(barsH(top.map((x) => ({ label: x.label, v: x.contrib })), { title: 'Contribución al cambio por ' + dn, unit: m.u === '%' ? 'pts' : m.u }));
    }
    // factores propios del tema
    if (ds === 'agua') {
      const hl = (rs) => { const x = rs.filter((r) => r.total != null && (r.production || 0) + (r.transfer || 0) > 0 && r.total >= 0 && (r.production || 0) < 30000); const hh = sum(x.map((r) => (r.production || 0) + (r.transfer || 0))); return hh > 0 && x.length > 3 ? (sum(x.map((r) => r.total)) * 10) / hh : null; };
      const hC = hl(rC), hP = hl(rP);
      if (hC != null && hP != null && hC < 5 && hP < 5) R.p('Por Hl procesado (mosto + trasiego) el consumo pasó de <b>' + fmt(hP, 2) + '</b> a <b>' + fmt(hC, 2) + '</b> Hl de agua por Hl: ' + (Math.abs(deltaPct(hC, hP) || 0) < 5 ? 'la eficiencia casi no cambió, así que el cambio se explica sobre todo por el volumen producido.' : (hC > hP ? 'la planta usó más agua para producir lo mismo, no es solo un tema de volumen.' : 'la planta fue más eficiente por cada Hl procesado.')));
      const aseoC = sum(rC.map((r) => r.aseos || 0)), aseoP = sum(rP.map((r) => r.aseos || 0));
      if (aseoC && aseoP) R.p('Los aseos registrados en las lecturas pasaron de ' + fmt(aseoP, 0) + ' a ' + fmt(aseoC, 0) + ' (' + fmt(deltaPct(aseoC, aseoP), 0) + ' %).');
    }
    if (ds === 'merma') { const nC = rC.filter((r) => r.lossPct != null && r.lossPct > metaG('merma.alerta', 30)).length; if (nC) R.p(nC + ' lote(s) del periodo actual tienen merma superior a ' + metaG('merma.alerta', 30) + ' %: revísalos, pueden distorsionar el promedio.'); }
    R.note('Esto señala dónde se concentra el cambio. Para confirmar la causa en planta conviene revisarlo con el equipo del turno.', '');
    R.src(esc('Fuente: ' + dsLabel(ds) + ' · ' + cur.label + ' (' + rC.length + ' registros) vs ' + prev.label + ' (' + rP.length + ')'));
    goBtns(R, spec);
    R.export(dsLabel(ds) + ' causas', [{ h: 'Grupo', t: 's' }, { h: 'Contribución', t: 'n' }], best ? best.items.map((x) => [x.label, x.contrib]) : [], cur.label);
    R.chip('Compáralo con el periodo anterior', 'compáralo con el periodo anterior').chip('Grafícalo', 'grafícalo');
    if (HASBRAND[ds]) R.chip('¿Y por marca?', 'y por marca');
    R.chip('Más detalle', 'más detalle');
    R.conf = 0.82;
    return R;
  };

  /* ---------------------------------------------------------------- pronóstico */
  H.forecast = function (spec) {
    const ds = spec.ds, ref = refTime(), q = norm(spec.raw || '');
    let m = metOf(ds, spec.metric);
    const count = m.k === '__n' || (ds === 'aseos' && /cuant|cantidad|numero|aseos? (para|del|de)/.test(q) && !/agua|m3|consumo/.test(q));
    if (count) m = metOf(ds, '__n');
    const add = m.t === 'add' || m.k === '__n';
    const d0 = new Date(ref), y = d0.getFullYear(), mo = d0.getMonth();
    let mode = 'month';
    if (/proxima semana|siguiente semana|semana que viene|proximos 7 dias/.test(q)) mode = 'week';
    else if (/proximo mes|siguiente mes|mes que viene|proximo mes/.test(q)) mode = 'nextmonth';
    else if (/este ano|cerrar el ano|fin de ano|del ano/.test(q)) mode = 'year';
    const histFrom = sod(addDays(ref, -89));
    const hist = select(Object.assign({}, spec, { period: P(histFrom, eod(ref), 'últimos 90 días', 'rolling'), conds: spec.conds }), {});
    const hw = m.k === '__n' ? 'count' : add ? 'sum' : 'mean';
    let ser = series(spec, hist, m, hw, 'day');
    if (ds === 'agua' && add) ser = ser.filter((x) => x.rows.filter((r) => r.total != null).length >= 3);
    if (add && m.k === '__n' && ser.length) { // días sin registros cuentan como cero
      const map = new Map(ser.map((x) => [sod(x.t), x])), fill = [];
      for (let t = sod(ser[0].t); t <= sod(ref); t = addDays(t, 1)) fill.push(map.get(t) || { t, v: 0, n: 0, label: fd(t) });
      ser = fill;
    }
    if (ser.length < 14) return emptyAnswer(Object.assign({}, spec, { period: P(histFrom, eod(ref), 'últimos 90 días', 'rolling') }), 'Para proyectar necesito al menos 14 días con datos y encontré ' + ser.length + '.');
    const R = new Resp(spec, 'forecast');
    const lastDay = ser[ser.length - 1].t;
    let horizon, label, mtd = 0, mtdDays = 0, start, skip = 0, nmDays = 0;
    if (mode === 'month') { const eom = new Date(y, mo + 1, 0).getDate(), ms0 = new Date(y, mo, 1).getTime(); const inMonth = ser.filter((x) => x.t >= ms0); mtdDays = inMonth.length; mtd = add ? sum(inMonth.map((x) => x.v)) : 0; horizon = Math.max(1, eom - mtdDays); label = 'cierre de ' + MESES[mo]; }
    else if (mode === 'week') { horizon = 7; label = 'los próximos 7 días'; }
    else if (mode === 'nextmonth') { const nm = new Date(y, mo + 1, 1), dn = new Date(y, mo + 2, 0).getDate(), rem0 = Math.max(0, new Date(y, mo + 1, 0).getDate() - d0.getDate()); horizon = rem0 + dn; skip = rem0; nmDays = dn; label = MESES[nm.getMonth()]; start = nm; }
    else { horizon = Math.max(1, Math.round((new Date(y, 11, 31).getTime() - sod(ref)) / DAY)); label = 'cierre de ' + y; mtd = add ? aggregate(select(spec, { period: P(new Date(y, 0, 1).getTime(), eod(ref), '', 'year') }), m, m.k === '__n' ? 'count' : 'sum').v || 0 : 0; }
    const h = Math.min(horizon, 400);
    const yv = ser.map((x) => x.v);
    const fc = ST().forecast(yv, { h: Math.min(h, 120) });
    if (!fc) return emptyAnswer(spec, 'No logré ajustar un modelo con estos datos.');
    const pts = fc.points.map((p) => ({ y: add ? Math.max(0, p.y) : p.y }));
    const rate14 = sum(yv.slice(-14)) / Math.min(14, yv.length);
    let remaining;
    if (add) { const all = pts.map((p) => p.y); while (all.length < h) all.push(all.length ? all[all.length - 1] : rate14); remaining = sum(all.slice(skip, h)); }
    const rmse = fc.rmse != null ? fc.rmse : 0, bt = fc.backtest;
    const sdTot = rmse * Math.sqrt(Math.max(1, h - skip));
    const est = add ? mtd + remaining : null;
    const unit = m.k === '__n' ? DSNOUN[ds][1] : m.u;
    if (add) {
      const prevTot = mode === 'month' ? (() => { const pm = monthPeriod(mo === 0 ? y - 1 : y, (mo + 11) % 12, ref); pm.partial = false; const r = select(spec, { period: pm }); return aggregate(r, m, m.k === '__n' ? 'count' : 'sum'); })() : null;
      R.valor = est;
    R.h('Proyección: ' + fmt(est, est > 100 ? 0 : 1) + ' ' + esc(unit), esc(label) + esc(brandTxt(spec)) + (filtTxt(spec) ? ' · ' + esc(filtTxt(spec)) : ''));
      const lo = Math.max(mtd, est - 1.96 * sdTot), hi = est + 1.96 * sdTot;
      R.kpis([kpi('Proyectado', est, unit, { delta: prevTot && prevTot.v ? deltaPct(est, prevTot.v) : undefined, deltaGood: m.good === 'down' ? 'down' : 'up', help: prevTot && prevTot.v ? 'vs mes pasado: ' + fa(prevTot.v) : '' }), mode !== 'week' && mode !== 'nextmonth' ? kpi('Ya acumulado', mtd, unit, { help: mtdDays ? mtdDays + ' días' : '' }) : null, kpi('Rango probable (95 %)', fa(lo) + ' – ' + fa(hi), unit)]);
      const phr = { month: 'al ' + label, year: 'al ' + label, week: 'en ' + label, nextmonth: 'en ' + label }[mode];
      R.p('A este ritmo, ' + esc(phr) + ' serían <b>' + fa(est) + ' ' + esc(unit) + '</b>' + (mode === 'month' || mode === 'year' ? ' (' + fa(mtd) + ' ya acumulados en ' + (mode === 'month' ? mtdDays + ' días con dato' : 'el año') + ' + ' + fa(remaining) + ' proyectados para los ' + h + ' días restantes o sin lectura)' : mode === 'nextmonth' ? ' (' + nmDays + ' días)' : ' (' + fa(remaining) + ' en ' + h + ' días)') + '. Con un 95 % de confianza quedaría entre ' + fa(lo) + ' y ' + fa(hi) + '.');
      if (prevTot && prevTot.v) R.p(esc(deltaSentence(m, est, prevTot.v, 'el mes pasado', 'sum')));
    } else {
      const meanNext = sum(pts.slice(0, Math.min(h, pts.length)).map((p) => p.y)) / Math.min(h, pts.length);
      R.h('Proyección: ' + fa(meanNext) + ' ' + esc(unit) + ' (promedio)', esc(label));
      R.kpis([kpi('Promedio esperado', meanNext, unit), kpi('Promedio últimos 14 días', rate14, unit), kpi('Error típico diario', rmse, unit)]);
      R.p('Si se mantiene la dinámica de los últimos 90 días, el promedio de ' + esc(m.l.toLowerCase()) + ' en ' + esc(label) + ' rondaría <b>' + fa(meanNext) + ' ' + esc(unit) + '</b>.');
    }
    const modelo = { lineal: 'una recta de tendencia', holt: 'suavizado exponencial (Holt)', media: 'el nivel medio reciente' }[fc.method];
    R.p('Método: ' + modelo + ' sobre ' + ser.length + ' días' + (bt && bt.mape != null ? '; en pruebas retroactivas se equivocó en promedio ' + fmt(bt.mape, 0) + ' % por día' : '') + '. Es una proyección estadística, no una promesa: cambia si cambia la producción.');
    const lastN = ser.slice(-30);
    const fcPts = pts.slice(0, Math.min(h, 30)).map((p, i) => ({ x: addDays(lastDay, i + 1), y: Math.round(p.y * 100) / 100 }));
    R.chart(CH().line({ title: m.l + ' diario: real y proyectado', subtitle: 'últimos 30 días y próximos ' + fcPts.length, xType: 'time', series: [{ name: 'Real', points: lastN.map((x) => ({ x: x.t, y: Math.round(x.v * 100) / 100 })) }, { name: 'Proyección', dashed: true, points: [{ x: lastN[lastN.length - 1].t, y: Math.round(lastN[lastN.length - 1].v * 100) / 100 }].concat(fcPts) }], unit, w: CW, h: 230, toolbar: true }));
    R.note(esc(noBrandNote(spec)), 'warn');
    R.src(esc('Fuente: ' + dsLabel(ds) + ' · ' + ser.length + ' días con datos hasta el ' + fd(lastDay)));
    R.export(dsLabel(ds) + ' proyección', [{ h: 'Fecha', t: 's' }, { h: 'Real', t: 'n' }, { h: 'Proyección', t: 'n' }], lastN.map((x) => [fd(x.t), x.v, null]).concat(fcPts.map((p) => [fd(p.x), null, p.y])), label);
    R.go_('Ver pronósticos en Análisis', 'analisis/pronosticos', { ds });
    R.chip('¿Por qué subió?', 'por qué subió').chip('Compáralo con el mes pasado', 'compáralo con el mes pasado').chip('¿Qué pasa si bajamos 10 %?', 'si reducimos el consumo 10 %');
    R.conf = 0.85;
    return R;
  };

  /* ---------------------------------------------------------------- qué pasaría si… */
  const numsIn = (q) => [...q.matchAll(/(\d+(?:\.\d+)?)\s*(m3|%|h|hl|min|kg|p)?\b/g)].map((x) => ({ v: +x[1], u: x[2] || null }));
  H.whatif = function (spec) {
    const ds = spec.ds, ref = refTime(), q = spec.wtext || norm(spec.raw || '');
    const ns = numsIn(q);
    const R = new Resp(spec, 'whatif');
    const rows = select(spec);
    const days = Math.max(1, Math.round((Math.min(spec.period.to, capT()) - Math.max(spec.period.from, rows.length ? Math.min(...rows.map((r) => r.t)) : spec.period.from)) / DAY) + 1);
    const annual = (x) => (days >= 20 ? x * (365 / days) : null);
    const finish = (title, sub) => { R.note('Es un escenario hecho con tus datos del periodo, no una promesa: asume que lo demás se mantiene igual.', ''); R.src(esc('Fuente: ' + dsLabel(ds) + ' · ' + spec.period.label + ' · ' + fmt(rows.length, 0) + ' registros')); goBtns(R, spec); R.conf = 0.8; return R; };
    const pctRed = /\b(reducimos|bajamos|disminuimos|reduc\w+|baj\w+|disminu\w+|recortamos|cortamos)\b.*?(\d+(?:\.\d+)?)\s*%/.exec(q);
    if (ds === 'aseos' || (ds === 'agua' && /por aseo/.test(q))) {
      const t = (ns.find((n) => n.u === 'm3') || ns.find((n) => !n.u && n.v < 100) || {}).v;
      const dsx = 'aseos', rr = ds === 'aseos' ? rows : select(Object.assign({}, spec, { ds: dsx }));
      const mv = rr.filter((r) => r.m3 != null && r.m3 >= 0 && r.m3 <= 200);
      if (!mv.length) return emptyAnswer(spec);
      const mean = sum(mv.map((r) => r.m3)) / mv.length, tot = sum(mv.map((r) => r.m3));
      if (t == null && !pctRed) return H.aclarar({ q, hint: 'whatif-aseo' });
      const target = t != null ? t : mean * (1 - pctRed[2] / 100);
      R.h('Si el consumo por aseo bajara a ' + fmt(target, 1) + ' m³', esc(spec.period.label));
      const s1 = Math.max(0, (mean - target) * mv.length), s2 = sum(mv.map((r) => Math.max(0, r.m3 - target)));
      R.kpis([kpi('Hoy (promedio por aseo)', mean, 'm³'), kpi('Ahorro si el promedio llega a la meta', s1, 'm³', { help: 'sobre ' + mv.length + ' aseos' }), kpi('Ahorro si ningún aseo la supera', s2, 'm³')]);
      const over = mv.filter((r) => r.m3 > target).length;
      R.p('Hoy cada aseo usa en promedio <b>' + fmt(mean, 2) + ' m³</b> (' + fmt(tot, 0) + ' m³ en ' + fmt(mv.length, 0) + ' aseos). ' + (mean <= target ? 'Ya estás por debajo de esa meta en promedio; el ahorro solo vendría de los ' + over + ' aseos que la superan: <b>' + fmt(s2, 0) + ' m³</b>.' : 'Llevar el promedio a ' + fmt(target, 1) + ' m³ ahorraría <b>' + fmt(s1, 0) + ' m³</b> (' + fmt((s1 / tot) * 100, 0) + ' % del agua de aseos). Si en cambio se logra que ' + 'ningún aseo supere ese valor, el ahorro es de <b>' + fmt(s2, 0) + ' m³</b>, porque ' + fmt(over, 0) + ' aseos (' + fmt((over / mv.length) * 100, 0) + ' %) hoy lo superan.'));
      const a1 = annual(s2); if (a1) R.p('Si el ritmo de aseos se mantiene, eso equivale a unos <b>' + fmt(a1, 0) + ' m³ al año</b> (estimación simple a partir de ' + days + ' días).');
      R.chart(CH().histogram({ title: 'Agua por aseo y la meta', subtitle: spec.period.label, values: mv.map((r) => r.m3), unit: 'm³', w: CW, h: 220, toolbar: true, refs: [{ x: target, label: 'Meta ' + fmt(target, 1) }] }));
      R.chip('Aseos que superan la meta', 'aseos que superan ' + fmt(target, 1).replace(',', '.') + ' m3').chip('¿Qué equipos gastan más?', 'qué equipos tienen más consumo de agua por aseo');
      return finish();
    }
    if (ds === 'merma') {
      const rr = rows.filter((r) => r.input > 0 && r.loss != null);
      if (!rr.length) return emptyAnswer(spec);
      const a = aggregate(rr, metOf('merma', 'lossPct'), 'wmean');
      const tIn = (ns.find((n) => n.u === '%') || ns.find((n) => !n.u && n.v < 50) || {}).v;
      const target = pctRed && !/ a /.test(q) ? a.v * (1 - pctRed[2] / 100) : tIn;
      if (target == null) return H.aclarar({ q, hint: 'whatif-merma' });
      const inTot = sum(rr.map((r) => r.input)), save = Math.max(0, inTot * ((a.v - target) / 100));
      R.h('Si la merma bajara a ' + fmt(target, 2) + ' %', esc(spec.period.label) + esc(brandTxt(spec)));
      R.kpis([kpi('Merma hoy', a.v, '%'), kpi('Ahorro estimado', save, 'Hl'), kpi('Volumen movido', inTot, 'Hl')]);
      R.p(a.v <= target ? 'La merma actual (' + fmt(a.v, 2) + ' %) ya está por debajo de ' + fmt(target, 2) + ' %.' : 'Con ' + fmt(inTot, 0) + ' Hl de entrada, pasar de <b>' + fmt(a.v, 2) + ' %</b> a <b>' + fmt(target, 2) + ' %</b> evitaría perder unos <b>' + fmt(save, 0) + ' Hl</b> en el periodo.');
      const an = annual(save); if (an && save > 0) R.p('Al año serían unos <b>' + fmt(an, 0) + ' Hl</b> si el volumen se mantiene.');
      R.chip('Merma por marca', 'merma por marca').chip('¿Qué tanque tiene más merma?', 'qué tanque tiene más merma');
      return finish();
    }
    if (ds === 'recuperacion') {
      const hv = rows.filter((r) => r.hours != null && r.hours >= 0 && r.hours <= 400);
      if (hv.length < 5) return emptyAnswer(spec, 'Necesito al menos 5 recuperaciones con horas registradas y hay ' + hv.length + '.');
      const hrs = (ns.find((n) => n.u === 'h') || ns.find((n) => !n.u && n.v >= 24 && n.v <= 200) || {}).v || metaG('recuperacion.objetivoH', 72);
      const shareT = (ns.find((n) => n.u === '%') || {}).v;
      const within = hv.filter((r) => r.hours <= hrs), cur = (within.length / hv.length) * 100;
      R.h('Si ' + (shareT ? fmt(shareT, 0) + ' % de las recuperaciones' : 'las recuperaciones') + ' se hicieran en ' + hrs + ' h o menos', esc(spec.period.label));
      const need = shareT ? Math.max(0, Math.ceil((shareT / 100) * hv.length) - within.length) : hv.length - within.length;
      const yin = within.map((r) => r.yieldPct).filter((x) => x != null && x <= 200), yout = hv.filter((r) => r.hours > hrs).map((r) => r.yieldPct).filter((x) => x != null && x <= 200);
      const hoursSaved = sum(hv.filter((r) => r.hours > hrs).map((r) => r.hours - hrs));
      R.kpis([kpi('Hoy en ≤ ' + hrs + ' h', cur, '%', { help: within.length + ' de ' + hv.length }), kpi('Recuperaciones por mover', need, ''), kpi('Horas que se liberarían', shareT ? (hoursSaved * need) / Math.max(1, hv.length - within.length) : hoursSaved, 'h')]);
      R.p('Hoy <b>' + fmt(cur, 0) + ' %</b> de las recuperaciones (' + within.length + ' de ' + hv.length + ') se hace en ' + hrs + ' h o menos' + (shareT ? '; para llegar a ' + fmt(shareT, 0) + ' % tendrían que ser ' + need + ' más' : '') + '. Las que se pasan acumulan <b>' + fmt(hoursSaved, 0) + ' h</b> sobre ese límite.');
      if (yin.length >= 3 && yout.length >= 3) {
        const tt = ST().ttest(yin, yout), my1 = sum(yin) / yin.length, my2 = sum(yout) / yout.length;
        R.p('¿Se gana volumen? El rendimiento medio es ' + fmt(my1, 0) + ' % cuando se hace a tiempo y ' + fmt(my2, 0) + ' % cuando se demora' + (tt && tt.p != null ? (tt.p < 0.05 ? ': la diferencia es significativa (p = ' + fmt(tt.p, 3) + '), así que recuperar a tiempo sí rinde más.' : ': esa diferencia no es significativa (p = ' + fmt(tt.p, 3) + '), por lo que con estos datos el beneficio sería de tiempo y no de volumen.') : '.'));
      }
      R.chip('Horas de recuperación', 'horas promedio de recuperación').chip('Recuperaciones que pasaron de 96 horas', 'recuperaciones que pasaron de 96 horas');
      return finish();
    }
    if (ds === 'trasiego') {
      const dv = rows.filter((r) => r.delay != null && r.delay > -72 && r.delay < 240);
      if (!dv.length) return emptyAnswer(spec);
      const T = (ns.find((n) => n.u === 'h') || {}).v || 0;
      const saved = sum(dv.map((r) => Math.max(0, r.delay - T)));
      const eliminCause = spec.cause ? dv.filter((r) => normS(r.cause).includes(spec.cause)) : null;
      const sv2 = eliminCause ? sum(eliminCause.map((r) => Math.max(0, r.delay))) : saved;
      R.h(spec.cause ? 'Si eliminamos los desvíos por «' + esc(spec.cause) + '»' : 'Si ningún desvío pasara de ' + T + ' h', esc(spec.period.label));
      R.kpis([kpi('Horas de desvío recuperables', sv2, 'h'), kpi('Actividades con desvío', (eliminCause || dv.filter((r) => r.delay > T)).length, ''), kpi('Actividades evaluadas', dv.length, '')]);
      R.p('Sobre ' + dv.length + ' actividades con hora real registrada, eliminar ' + (spec.cause ? 'esa causa' : 'lo que excede ' + T + ' h') + ' liberaría <b>' + fmt(sv2, 0) + ' h</b> de planta (' + fmt(sv2 / Math.max(1, dv.length), 1) + ' h por actividad).');
      R.chip('Principales causas de desvío', 'principales causas de desvío en los trasiegos');
      return finish();
    }
    if (ds === 'agua') {
      const tv = vals(rows, metOf('agua', 'total'));
      if (!tv.length) return emptyAnswer(spec);
      const pr = pctRed ? +pctRed[2] : (ns.find((n) => n.u === '%') || {}).v;
      const tot = sum(tv);
      if (pr == null) return H.aclarar({ q, hint: 'whatif-agua' });
      const s = tot * (pr / 100);
      R.h('Si reducimos el consumo de agua ' + fmt(pr, 0) + ' %', esc(spec.period.label));
      R.kpis([kpi('Consumo del periodo', tot, 'm³'), kpi('Ahorro', s, 'm³'), kpi('Consumo nuevo', tot - s, 'm³')]);
      R.p('En el periodo se consumieron <b>' + fmt(tot, 0) + ' m³</b> (' + tv.length + ' turnos con lectura). Un recorte de ' + fmt(pr, 0) + ' % ahorraría <b>' + fmt(s, 0) + ' m³</b>' + (annual(s) ? ', unos <b>' + fmt(annual(s), 0) + ' m³ al año</b> si el ritmo se mantiene' : '') + '.');
      const sh = groupRows('agua', rows, 'shift').map((g) => ({ l: g.label, v: sum(vals(g.rows, metOf('agua', 'total'))) })).sort((a, b) => b.v - a.v)[0];
      if (sh) R.p('Dónde empezar: el turno <b>' + esc(sh.l.toLowerCase()) + '</b> concentra más agua (' + fmt(sh.v, 0) + ' m³, ' + fmt((sh.v / tot) * 100, 0) + ' %).');
      R.chip('¿Dónde puedo ahorrar?', 'dónde puedo ahorrar').chip('Consumo por turno', 'consumo de agua por turno');
      return finish();
    }
    return H.aclarar({ q, hint: 'whatif' });
  };

  /* ---------------------------------------------------------------- programado */
  H.programado = function (spec) {
    const ref = refTime();
    let rows = rowsOf('trasiego').filter((r) => r.t != null && r.t > ref - 2 * HOUR && r.actualEnd == null);
    if (spec.kind) rows = rows.filter((r) => r.kind === spec.kind);
    const brands = (spec.brands || []).filter((b) => b !== '*');
    if (brands.length) rows = rows.filter((r) => brands.includes(r.brand));
    rows.sort((a, b) => a.t - b.t);
    const R = new Resp(Object.assign({}, spec, { ds: 'trasiego', period: P(ref, ref + 14 * DAY, 'próximos días', 'rolling') }), 'programado');
    if (!rows.length) {
      const e = DL().extent('trasiego');
      R.h('No hay trasiegos programados', 'después del ' + fdt(ref));
      R.p('En el programa no encuentro actividades pendientes con fecha posterior al último dato (' + fd(ref) + '). ' + (e ? 'El programa tiene registros hasta el ' + fd(e.to) + '.' : ''));
      R.chip('Trasiegos de este mes', 'cuántos trasiegos hicimos este mes').chip('Desvío promedio', 'desvío promedio por marca');
      R.go_('Abrir el programa', 'programa', {}); R.conf = 0.7; return R;
    }
    R.h(rows.length + ' ' + plural(rows.length, 'actividad programada', 'actividades programadas'), 'sin hora real de fin registrada · desde ' + fdt(rows[0].t));
    const next = rows[0];
    R.kpis([kpi('Próxima', fdt(next.t), '', { help: String(next.activity).slice(0, 28) }), kpi('Trasiegos', rows.filter((r) => r.kind === 'Trasiego').length, ''), kpi('CIP', rows.filter((r) => r.kind === 'CIP').length, '')]);
    R.p('La próxima es <b>' + esc(String(next.activity)) + '</b>' + (next.brand && next.brand !== '(sin marca)' ? ' (' + esc(titleCase(next.brand)) + ')' : '') + ' el <b>' + fdt(next.t) + '</b>' + (next.plannedEnd ? ', con fin planeado a las ' + fdt(next.plannedEnd) : '') + '.');
    R.chart(CH().gantt({ title: 'Programa próximo', rows: rows.slice(0, 12).map((r) => ({ label: String(r.activity).replace(/\s*-.*$/, '').slice(0, 26), start: r.t, end: r.plannedEnd && r.plannedEnd > r.t ? r.plannedEnd : r.t + 8 * HOUR, status: r.kind === 'CIP' ? 'pendiente' : 'en_curso' })), now: ref, w: CW, toolbar: true }));
    R.table([{ k: 't', t: 'Inicio', f: (v) => fdt(v) }, { k: 'activity', t: 'Actividad', f: (v) => esc(String(v).slice(0, 36)) }, { k: 'brand', t: 'Marca', f: (v) => esc(titleCase(v)) }, { k: 'plannedEnd', t: 'Fin planeado', f: (v) => (v ? fdt(v) : '—') }], rows, { max: 8 });
    R.src(esc('Fuente: Programa de trasiego · ' + rows.length + ' actividades sin cierre'));
    R.export('Trasiegos programados', [{ h: 'Inicio', t: 's' }, { h: 'Actividad', t: 's' }, { h: 'Marca', t: 's' }, { h: 'Fin planeado', t: 's' }], rows.map((r) => [new Date(r.t).toLocaleString('es-CO'), r.activity, r.brand, r.plannedEnd ? new Date(r.plannedEnd).toLocaleString('es-CO') : '']), 'programado');
    R.go_('Abrir el programa', 'programa', {});
    R.chip('Desvío promedio', 'desvío promedio por marca').chip('Causas de desvío', 'principales causas de desvío en los trasiegos');
    R.conf = 0.88;
    return R;
  };

  /* ---------------------------------------------------------------- escaneo de anomalías y alertas (base de revisar / anomalías / resumen) */
  function mad(v) { const m0 = med(v); return { c: m0, s: 1.4826 * med(v.map((x) => Math.abs(x - m0))) }; }
  function scan(period, only) {
    const out = [], g = metaG;
    const add = (f) => out.push(f);
    const inP2 = (r) => r.t != null && r.t >= period.from && r.t <= Math.min(period.to, capT());
    const ok = (ds) => !only || only === ds;
    try {
      if (ok('agua')) {
        const all = rowsOf('agua').filter((r) => r.total != null && r.total >= 0 && r.total <= 1000), cur = all.filter(inP2);
        if (all.length > 20 && cur.length) {
          const md = med(all.map((r) => r.total)), lim = md * g('agua.turnosAtipicos', 1.25), hot = cur.filter((r) => r.total > lim).sort((a, b) => b.total - a.total);
          if (hot.length) add({ sev: hot.length / cur.length > 0.25 ? 'alta' : 'media', ds: 'agua', area: 'Agua', titulo: hot.length + ' de ' + cur.length + ' turnos superan ' + fmt(g('agua.turnosAtipicos', 1.25), 2) + ' × la mediana (' + fmt(md, 0) + ' m³)', detalle: 'El mayor: ' + fd(hot[0].t) + ' turno ' + hot[0].shift.toLowerCase() + ' con ' + fmt(hot[0].total, 0) + ' m³.', q: 'hay turnos atípicos de consumo de agua' });
          const dayVals = groupRows('agua', all, 'day').map((x) => ({ t: x.t, v: sum(x.rows.map((r) => r.total)), n: x.rows.length })).filter((x) => x.n >= 3);
          if (dayVals.length > 20) { const { c, s } = mad(dayVals.map((x) => x.v)); const out2 = dayVals.filter((x) => s > 0 && Math.abs(x.v - c) / s > 3.5 && x.t >= period.from && x.t <= period.to); if (out2.length) add({ sev: 'media', ds: 'agua', area: 'Agua', titulo: out2.length + ' ' + plural(out2.length, 'día') + ' con consumo fuera de lo habitual', detalle: out2.slice(0, 3).map((x) => fd(x.t) + ' (' + fmt(x.v, 0) + ' m³)').join(', ') + ' · lo normal ronda ' + fmt(c, 0) + ' m³ por día.', q: 'grafícame el consumo diario de agua' }); }
        }
        const miss = rowsOf('agua').filter((r) => inP2(r) && r.total == null && r.t < refTime() - 8 * HOUR);
        if (miss.length >= 2) add({ sev: 'info', ds: 'agua', area: 'Agua', titulo: miss.length + ' turnos sin lectura válida de agua', detalle: 'Faltan lecturas o hay fórmula con error; el consumo del periodo está subestimado.', q: 'cuántas lecturas de agua son inválidas' });
      }
      if (ok('aseos')) {
        const cur = rowsOf('aseos').filter((r) => inP2(r) && r.m3 != null && r.m3 <= 200), meta = g('agua.aseoM3', 10);
        if (cur.length) { const over = cur.filter((r) => r.m3 > meta).sort((a, b) => b.m3 - a.m3); if (over.length) add({ sev: over.length / cur.length > 0.15 ? 'alta' : 'media', ds: 'aseos', area: 'Aseos', titulo: over.length + ' de ' + cur.length + ' aseos superan la meta de ' + meta + ' m³', detalle: 'El mayor: ' + eqLabel(over[0].eq) + ' el ' + fd(over[0].t) + ' con ' + fmt(over[0].m3, 1) + ' m³.', q: 'aseos que superan ' + meta + ' m3' }); }
        const ph = rowsOf('aseos').filter((r) => inP2(r) && r.ph != null && r.ph >= 0 && r.ph <= 14), bad = ph.filter((r) => r.ph < g('aseos.phMin', 6) || r.ph > g('aseos.phMax', 8));
        if (bad.length) add({ sev: bad.length / ph.length > 0.1 ? 'alta' : 'media', ds: 'aseos', area: 'Aseos', titulo: bad.length + ' de ' + ph.length + ' enjuagues con pH fuera de ' + g('aseos.phMin', 6) + '–' + g('aseos.phMax', 8), detalle: 'Riesgo de residuos de soda o ácido: confirma el enjuague final.', q: 'cuántos aseos tienen pH fuera de rango' });
      }
      if (ok('merma')) {
        const cur = rowsOf('merma').filter(inP2), neg = cur.filter((r) => r.loss != null && r.loss < 0), big = cur.filter((r) => r.lossPct != null && r.lossPct > g('merma.alerta', 30));
        if (big.length) add({ sev: 'alta', ds: 'merma', area: 'Merma', titulo: big.length + ' lote(s) con merma mayor a ' + g('merma.alerta', 30) + ' %', detalle: big.slice(0, 3).map((r) => r.lote + ' (' + fmt(r.lossPct, 0) + ' %)').join(', ') + '. Verifica volúmenes de entrada y salida.', q: 'lotes con merma mayor a ' + g('merma.alerta', 30) + ' %' });
        if (neg.length) add({ sev: 'media', ds: 'merma', area: 'Merma', titulo: neg.length + ' lote(s) con saldo negativo', detalle: 'Salió más volumen del que entró: casi siempre es un error de captura.', q: 'qué lotes de merma tienen saldo negativo' });
        const hist = rowsOf('merma').filter((r) => r.lossPct != null && r.lossPct > -50 && r.lossPct < 50);
        if (hist.length > 30) { const { c, s } = mad(hist.map((r) => r.lossPct)); const ot = cur.filter((r) => r.lossPct != null && s > 0 && (r.lossPct - c) / s > 3.5 && r.lossPct <= g('merma.alerta', 30)); if (ot.length) add({ sev: 'media', ds: 'merma', area: 'Merma', titulo: ot.length + ' lote(s) con merma muy por encima de lo habitual (mediana ' + fmt(c, 1) + ' %)', detalle: ot.slice(0, 3).map((r) => r.lote + ' ' + fmt(r.lossPct, 1) + ' %').join(', '), q: 'top 5 lotes con más merma' }); }
      }
      if (ok('recuperacion')) {
        const cur = rowsOf('recuperacion').filter(inP2), late = cur.filter((r) => r.hours != null && r.hours > g('recuperacion.maximoH', 96) && r.hours <= 400);
        if (late.length) add({ sev: 'alta', ds: 'recuperacion', area: 'Recuperación', titulo: late.length + ' recuperación(es) pasaron de ' + g('recuperacion.maximoH', 96) + ' h', detalle: late.slice(0, 3).map((r) => r.utk + ' ' + fmt(r.hours, 0) + ' h').join(', '), q: 'recuperaciones que pasaron de 96 horas' });
        const ph = cur.filter((r) => r.ph != null && r.ph > g('recuperacion.phMax', 5.35) && r.ph < 14);
        if (ph.length) add({ sev: 'media', ds: 'recuperacion', area: 'Recuperación', titulo: ph.length + ' recuperación(es) con pH sobre ' + g('recuperacion.phMax', 5.35), detalle: 'Riesgo de contaminación de la cerveza recuperada.', q: 'pH de la recuperación' });
      }
      if (ok('trasiego')) {
        const cur = rowsOf('trasiego').filter((r) => inP2(r) && r.delay != null && r.delay > -72 && r.delay < 240), late = cur.filter((r) => r.delay > Math.max(2, g('trasiego.desvioMaxH', 1))).sort((a, b) => b.delay - a.delay);
        if (late.length) { const noC = late.filter((r) => r.cause === 'Sin causa registrada').length; add({ sev: late.length / Math.max(1, cur.length) > 0.2 ? 'alta' : 'media', ds: 'trasiego', area: 'Trasiego', titulo: late.length + ' de ' + cur.length + ' actividades terminaron más de ' + Math.max(2, g('trasiego.desvioMaxH', 1)) + ' h tarde', detalle: 'La mayor: ' + String(late[0].activity).slice(0, 28) + ' (+' + fmt(late[0].delay, 1) + ' h)' + (noC ? ' · ' + noC + ' sin causa registrada' : '') + '.', q: 'trasiegos con desvío mayor a 2 h' }); }
      }
      if (ok('ferm')) {
        const all = rowsOf('ferm').filter((r) => r.h75 != null && r.h75 >= 10 && r.h75 <= 400), cur = all.filter(inP2);
        if (all.length > 30 && cur.length) { const { c, s } = mad(all.map((r) => r.h75)); const slow = cur.filter((r) => s > 0 && (r.h75 - c) / s > 3.5); if (slow.length) add({ sev: 'media', ds: 'ferm', area: 'Fermentación', titulo: slow.length + ' fermentación(es) mucho más lentas de lo habitual (h75 típico ' + fmt(c, 0) + ' h)', detalle: slow.slice(0, 3).map((r) => r.lote + ' ' + fmt(r.h75, 0) + ' h').join(', '), q: 'cuál fue la fermentación más lenta' }); }
      }
      if (ok('lev')) {
        const cur = rowsOf('lev').filter((r) => inP2(r) && r.viab != null && r.viab > 0 && r.viab <= 100), low = cur.filter((r) => r.viab < g('levadura.viabMin', 95));
        if (low.length) add({ sev: low.length / cur.length > 0.25 ? 'alta' : 'media', ds: 'lev', area: 'Levadura', titulo: low.length + ' de ' + cur.length + ' cosechas con viabilidad bajo ' + g('levadura.viabMin', 95) + ' %', detalle: 'La menor: ' + low.sort((a, b) => a.viab - b.viab)[0].nombre + ' con ' + fmt(low[0].viab, 1) + ' %.', q: 'cosechas con viabilidad menor a ' + g('levadura.viabMin', 95) + ' %' });
      }
    } catch (e) { if (window.console) console.error('[Cifra] scan', e); }
    const o = { alta: 0, media: 1, info: 2, ok: 3 };
    return out.sort((a, b) => o[a.sev] - o[b.sev]);
  }
  const sevTag = (s) => '<span class="cf-tag ' + s + '">' + ({ alta: 'Prioridad alta', media: 'Revisar', info: 'Informativo', ok: 'Bien' }[s] || s) + '</span>';
  function analisisHallazgos() {
    try { if (A.Analisis && A.Analisis.hallazgos) return A.Analisis.hallazgos(A.Analisis.contexto()) || []; } catch (e) { /* los hallazgos dependen de pestañas de otros módulos */ }
    return [];
  }

  H.anomalias = function (spec) {
    const ref = refTime();
    const period = spec.period && !spec.periodDefault ? spec.period : P(sod(addDays(ref, -29)), eod(ref), 'últimos 30 días', 'rolling');
    const fs = scan(period, spec.ds);
    const R = new Resp(Object.assign({}, spec, { period }), 'anomalias');
    const extra = analisisHallazgos().filter((h) => h.sev === 'alta' || h.sev === 'media').slice(0, 4);
    R.h(fs.length ? 'Esto se sale de lo habitual' : 'Sin anomalías relevantes', esc(period.label) + (period.txt ? ' (' + esc(period.txt) + ')' : '') + (spec.ds ? ' · ' + esc(dsLabel(spec.ds)) : ''));
    if (!fs.length && !extra.length) {
      R.p('Revisé turnos de agua, aseos, merma, recuperación, trasiegos, fermentaciones y levadura contra sus metas y contra el comportamiento histórico, y <b>no encontré nada fuera de lo normal</b> en ' + esc(period.label) + '.');
      R.chip('Resumen de la semana', 'resumen de la semana').chip('¿Qué debería revisar hoy?', 'qué debería revisar hoy').chip('Calidad de datos', 'qué datos faltan');
      R.conf = 0.85; return R;
    }
    const a = fs.filter((f) => f.sev === 'alta').length, mm = fs.filter((f) => f.sev === 'media').length;
    R.kpis([kpi('Prioridad alta', a, ''), kpi('Para revisar', mm, ''), kpi('Áreas con hallazgos', uniq(fs.map((f) => f.area)).length, '')]);
    R.p('Comparé cada área con sus metas y con su propio comportamiento histórico (mediana y desviación robusta; marco como atípico lo que se aleja más de 3,5 desviaciones). Esto es lo que encontré en ' + esc(period.label) + ':');
    R.list(fs.slice(0, 8).map((f) => sevTag(f.sev) + ' <b>' + esc(f.area) + '</b> · ' + esc(f.titulo) + '<br><span class="cf-mut">' + esc(f.detalle) + '</span>'));
    if (extra.length) R.p('<b>Del Análisis automático:</b>'), R.list(extra.map((h) => sevTag(h.sev) + ' <b>' + esc(h.area || h.tab) + '</b> · ' + esc(h.titulo) + (h.detalle ? '<br><span class="cf-mut">' + esc(h.detalle) + '</span>' : '')));
    // gráfica de control del agua diaria
    if ((!spec.ds || spec.ds === 'agua')) {
      const all = rowsOf('agua').filter((r) => r.total != null && r.total >= 0 && r.total <= 1000 && r.t >= sod(addDays(ref, -59)) && r.t <= ref);
      const days = groupRows('agua', all, 'day').map((x) => ({ t: x.t, v: sum(x.rows.map((r) => r.total)), n: x.rows.length })).filter((x) => x.n >= 3).sort((p, q2) => p.t - q2.t);
      if (days.length >= 10) {
        const im = ST().imr(days.map((d) => d.v));
        if (im) R.chart(CH().control({ title: 'Consumo diario de agua (carta de control)', subtitle: 'últimos 60 días · límites a ±3σ', points: days.map((d, i) => ({ i: i + 1, y: Math.round(d.v * 10) / 10, out: im.points[i] && im.points[i].out, label: fd(d.t) })), cl: im.cl, ucl: im.ucl, lcl: im.lcl, violations: im.violations, unit: 'm³', w: CW, h: 240, toolbar: true }));
      }
    }
    if (!R.hasChart && fs.length > 1) R.chart(barsH(Object.entries(fs.reduce((o, f) => ((o[f.area] = (o[f.area] || 0) + 1), o), {})).map(([l, v]) => ({ label: l, v })), { title: 'Hallazgos por área', unit: '' }));
    R.src(esc('Fuente: todas las áreas · ' + period.label + (period.txt ? ' (' + period.txt + ')' : '')));
    R.go_('Ver calidad de datos', 'analisis/calidad', {});
    fs.slice(0, 3).forEach((f) => R.chip(f.area + ': ver detalle', f.q));
    R.chip('¿Qué debería revisar hoy?', 'qué debería revisar hoy');
    R.conf = 0.9;
    return R;
  };

  H.revisar = function (spec) {
    const ref = refTime();
    const period = spec.period && !spec.periodDefault && spec.period.kind !== 'day' ? spec.period : P(sod(addDays(ref, -13)), eod(ref), 'últimos 14 días', 'rolling');
    const fs = scan(period, spec.ds);
    const hall = analisisHallazgos().filter((h) => h.sev === 'alta' || h.sev === 'media');
    let old = [];
    try { old = (A.PlatformFinish && A.PlatformFinish.alerts ? A.PlatformFinish.alerts() : []).slice(0, 4); } catch (e) { old = []; }
    const prog = rowsOf('trasiego').filter((r) => r.t != null && r.t >= sod(ref) && r.t <= eod(ref) + DAY && r.actualEnd == null).sort((a, b) => a.t - b.t);
    const R = new Resp(Object.assign({}, spec, { period }), 'revisar');
    const items = [];
    for (const f of fs.filter((x) => x.sev !== 'info').slice(0, 5)) items.push({ sev: f.sev, html: '<b>' + esc(f.area) + '</b> · ' + esc(f.titulo) + '<br><span class="cf-mut">' + esc(f.detalle) + '</span>', q: f.q });
    for (const h of hall.slice(0, 3)) if (!items.some((i) => i.html.includes(esc(h.titulo).slice(0, 25)))) items.push({ sev: h.sev, html: '<b>' + esc(h.area || h.tab) + '</b> · ' + esc(h.titulo) + (h.detalle ? '<br><span class="cf-mut">' + esc(h.detalle) + '</span>' : '') });
    for (const a of old) items.push({ sev: a.color === 'red' ? 'alta' : 'media', html: '<b>Tanques y levadura</b> · ' + esc(a.label) + (a.help ? '<br><span class="cf-mut">' + esc(a.help) + '</span>' : '') });
    R.h(spec.periodDefault || !spec.period || spec.period.kind === 'day' ? 'Para revisar hoy' : 'Lo más importante · ' + esc(period.label), 'datos al ' + fdt(ref) + ' · revisé ' + esc(period.label));
    if (!items.length && !prog.length) { R.p('No veo nada urgente: las áreas que monitoreo están dentro de metas y de su comportamiento habitual en los últimos 14 días.'); R.chip('Resumen de la semana', 'resumen de la semana').chip('Dónde puedo ahorrar', 'dónde puedo ahorrar'); R.conf = 0.8; return R; }
    items.sort((a, b) => ({ alta: 0, media: 1, info: 2 }[a.sev] - { alta: 0, media: 1, info: 2 }[b.sev]));
    R.kpis([kpi('Prioridad alta', items.filter((i) => i.sev === 'alta').length, ''), kpi('Para revisar', items.filter((i) => i.sev !== 'alta').length, ''), kpi('Programados hoy/mañana', prog.length, '')]);
    R.p('Ordené lo que encontré de más a menos urgente:');
    R.list(items.slice(0, 9).map((i, n) => sevTag(i.sev) + ' ' + i.html));
    if (prog.length) R.p('<b>En el programa:</b> ' + prog.slice(0, 3).map((r) => esc(String(r.activity).replace(/\s*-.*$/, '').slice(0, 26)) + ' (' + fdt(r.t) + ')').join('; ') + (prog.length > 3 ? ' y ' + (prog.length - 3) + ' más' : '') + '.');
    R.src(esc('Fuente: metas de la plataforma, comportamiento histórico, análisis automático y alertas de tanques'));
    items.filter((i) => i.q).slice(0, 3).forEach((i) => R.chip(String(i.html.replace(/<[^>]+>/g, ' ')).trim().split('·')[0].trim() + ': ver', i.q));
    R.chip('Hay algo raro', 'hay algo raro en los datos').chip('Dónde puedo ahorrar', 'dónde puedo ahorrar');
    R.go_('Ver alertas', 'alertas', {});
    R.conf = 0.88;
    return R;
  };

  /* ---------------------------------------------------------------- ahorro potencial */
  H.ahorro = function (spec) {
    const ref = refTime();
    const period = spec.period && !spec.periodDefault ? spec.period : P(sod(addDays(ref, -89)), eod(ref), 'últimos 90 días', 'rolling');
    const days = Math.max(1, Math.round((Math.min(period.to, capT()) - period.from + 1) / DAY)), ann = 365 / days;
    const inP2 = (r) => r.t != null && r.t >= period.from && r.t <= Math.min(period.to, capT());
    const opp = [];
    const as = rowsOf('aseos').filter((r) => inP2(r) && r.m3 != null && r.m3 <= 200), meta = metaG('agua.aseoM3', 10);
    if (as.length) { const ex = sum(as.map((r) => Math.max(0, r.m3 - meta))), base = sum(as.map((r) => r.m3)); if (ex > 0) opp.push({ k: 'Aseos sobre la meta de ' + meta + ' m³', base: base, unit: 'm³', pot: ex, sh: ex / base, q: 'si bajamos el consumo por aseo a ' + meta + ' m3' }); }
    const ag = rowsOf('agua').filter((r) => inP2(r) && r.total != null && r.total >= 0 && r.total <= 1000), mdAll = med(rowsOf('agua').filter((r) => r.total != null && r.total >= 0 && r.total <= 1000).map((r) => r.total) || [0]);
    if (ag.length && mdAll) { const lim = mdAll * metaG('agua.turnosAtipicos', 1.25), ex = sum(ag.map((r) => Math.max(0, r.total - lim))), base = sum(ag.map((r) => r.total)); if (ex > 0) opp.push({ k: 'Turnos de agua sobre ' + fmt(metaG('agua.turnosAtipicos', 1.25), 2) + ' × la mediana', base, unit: 'm³', pot: ex, sh: ex / base, q: 'hay turnos atípicos de consumo de agua' }); }
    const mr = rowsOf('merma').filter((r) => inP2(r) && r.input > 0 && r.loss != null && r.lossPct != null && r.lossPct < metaG('merma.alerta', 30));
    if (mr.length >= 10) { const p75 = quant(mr.map((r) => r.lossPct), 0.75), ex = sum(mr.map((r) => (r.lossPct > p75 ? ((r.lossPct - p75) / 100) * r.input : 0))), base = sum(mr.map((r) => Math.max(0, r.loss))); if (ex > 0) opp.push({ k: 'Lotes con merma sobre el percentil 75 (' + fmt(p75, 1) + ' %)', base, unit: 'Hl', pot: ex, sh: ex / base, q: 'top 5 lotes con más merma' }); }
    const rc = rowsOf('recuperacion').filter((r) => inP2(r) && r.hours != null && r.hours <= 400);
    if (rc.length >= 5) { const ob = metaMeta('recuperacion.objetivoH', 72), ex = sum(rc.map((r) => Math.max(0, r.hours - ob))), base = sum(rc.map((r) => r.hours)); if (ex > 0) opp.push({ k: 'Recuperaciones sobre ' + ob + ' h', base, unit: 'h', pot: ex, sh: ex / base, q: 'qué porcentaje de recuperaciones se hace en menos de 72 h' }); }
    const tr = rowsOf('trasiego').filter((r) => inP2(r) && r.delay != null && r.delay > -72 && r.delay < 240);
    if (tr.length >= 10) { const lim = metaG('trasiego.desvioMaxH', 1), ex = sum(tr.map((r) => Math.max(0, r.delay - lim))), base = sum(tr.map((r) => Math.max(0, r.duration || 0))); if (ex > 0) opp.push({ k: 'Desvíos de trasiego sobre ' + lim + ' h', base: base || ex, unit: 'h', pot: ex, sh: base ? ex / base : 0, q: 'principales causas de desvío en los trasiegos' }); }
    const R = new Resp(Object.assign({}, spec, { period }), 'ahorro');
    if (!opp.length) { R.h('No encuentro oportunidades claras', esc(period.label)); R.p('Con los datos de ' + esc(period.label) + ' todo está dentro de las metas. Puedes cambiar las metas en Configuración para ser más exigente.'); R.conf = 0.7; return R; }
    opp.sort((a, b) => b.sh - a.sh);
    R.h('Dónde está el ahorro potencial', esc(period.label) + (period.txt ? ' (' + esc(period.txt) + ')' : ''));
    const top = opp[0];
    R.kpis([kpi('Mayor oportunidad', fmt(top.sh * 100, 0), '%', { help: top.k }), kpi('Oportunidades', opp.length, ''), kpi('Periodo', days, 'días')]);
    R.p('Calculé cuánto se podría recortar si lo que hoy está por encima de su meta (o de su nivel habitual) llegara a esa referencia. Ordenado por el peso que tiene sobre su propia base:');
    R.chart(barsH(opp.map((o) => ({ label: o.k.length > 36 ? o.k.slice(0, 35) + '…' : o.k, v: o.sh * 100 })), { title: 'Potencial como % de la base', unit: '%' }));
    R.table([{ k: 'k', t: 'Oportunidad' }, { k: 'pot', t: 'Potencial', num: 1, f: (v, r) => fmt(v, 0) + ' ' + esc(r.unit) }, { k: 'sh', t: '% base', num: 1, f: (v) => fmt(v * 100, 0) + ' %' }, { k: 'an', t: 'Al año (est.)', num: 1, f: (v, r) => fmt(v, 0) + ' ' + esc(r.unit) }], opp.map((o) => Object.assign({ an: o.pot * ann }, o)), { max: 8 });
    R.note('Son escenarios sobre tus datos, no promesas: lo que está sobre la meta no siempre se puede eliminar del todo. Las unidades distintas (m³, Hl, h) no se suman entre sí.', '');
    R.src(esc('Fuente: aseos, agua, merma, recuperación y trasiego · ' + period.label + ' · anualizado ×' + fmt(ann, 1)));
    R.export('Ahorro potencial', [{ h: 'Oportunidad', t: 's' }, { h: 'Potencial', t: 'n' }, { h: 'Unidad', t: 's' }, { h: '% de la base', t: 'n' }, { h: 'Al año (est.)', t: 'n' }], opp.map((o) => [o.k, o.pot, o.unit, o.sh * 100, o.pot * ann]), period.label);
    opp.slice(0, 3).forEach((o) => R.chip(o.k.slice(0, 30), o.q));
    R.chip('Hay algo raro', 'hay algo raro en los datos');
    R.conf = 0.85;
    return R;
  };
  const metaMeta = metaG;

  /* ---------------------------------------------------------------- resumen (turno / día / semana / mes) */
  function areaCards(period, brands) {
    const ref = refTime(), prevP = prevPeriod(period, ref), cards = [];
    const sp = (ds) => ({ ds, period, brands: brands || [], tanks: [], conds: [] });
    const both = (ds, fn) => { const cur = select(sp(ds)); const pr = prevP ? select(sp(ds), { period: prevP }) : []; return fn(cur, pr); };
    both('agua', (cur, pr) => { const m = metOf('agua', 'total'), a = aggregate(cur, m, 'sum'); if (a.v == null) return; const b = aggregate(pr, m, 'sum'); const sp2 = series(sp('agua'), cur, m, 'sum', 'day').map((x) => x.v); cards.push({ ds: 'agua', k: kpi('Agua', a.v, 'm³', { delta: b.v ? deltaPct(a.v, b.v) : undefined, deltaGood: 'down', spark: sp2.length >= 3 ? sp2 : undefined, help: a.n + ' turnos con lectura' }), line: 'Consumo de agua <b>' + vFmt(m, a.v) + '</b>' + (b.v ? ' (' + (a.v >= b.v ? '+' : '') + fmt(deltaPct(a.v, b.v), 0) + ' % vs ' + esc(prevP.label) + ')' : '') }); });
    both('aseos', (cur, pr) => { if (!cur.length) return; const m = metOf('aseos', 'm3'), a = aggregate(cur, m, 'sum'), meta = metaG('agua.aseoM3', 10), over = cur.filter((r) => r.m3 != null && r.m3 > meta && r.m3 <= 200).length; cards.push({ ds: 'aseos', k: kpi('Aseos', cur.length, '', { delta: pr.length ? deltaPct(cur.length, pr.length) : undefined, deltaGood: 'up', help: a.v != null ? fa(a.v) + ' m³ de agua' + (over ? ' · ' + over + ' sobre la meta' : '') : '' }), line: cur.length + ' aseos' + (a.v != null ? ' con ' + vFmt(m, a.v) + ' de agua' : '') + (over ? ' (' + over + ' sobre la meta de ' + meta + ' m³)' : '') }); });
    both('merma', (cur, pr) => { const m = metOf('merma', 'lossPct'), a = aggregate(cur, m, 'wmean'); if (a.v == null) return; const b = aggregate(pr, m, 'wmean'); cards.push({ ds: 'merma', k: kpi('Merma', a.v, '%', { delta: b.v != null ? kd(m, a.v, b.v) : undefined, deltaGood: 'down', help: a.n + ' lotes cerrados' }), line: 'Merma <b>' + fmt(a.v, 2) + ' %</b> en ' + a.n + ' lotes cerrados' }); });
    both('recuperacion', (cur, pr) => { const m = metOf('recuperacion', 'volume'), a = aggregate(cur, m, 'sum'); if (a.v == null) return; const h = aggregate(cur, metOf('recuperacion', 'hours'), 'mean'); const b = aggregate(pr, m, 'sum'); cards.push({ ds: 'recuperacion', k: kpi('Cerveza recuperada', a.v, 'Hl', { delta: b.v ? deltaPct(a.v, b.v) : undefined, deltaGood: 'up', help: h.v != null ? fmt(h.v, 0) + ' h en promedio' : '' }), line: 'Recuperados <b>' + vFmt(m, a.v) + '</b>' + (h.v != null ? ' en ' + fmt(h.v, 0) + ' h promedio' : '') }); });
    both('trasiego', (cur, pr) => { const done = cur.filter((r) => r.actualEnd != null); if (!done.length) return; const dly = aggregate(done, metOf('trasiego', 'delay'), 'mean'); cards.push({ ds: 'trasiego', k: kpi('Trasiegos y CIP', done.length, '', { delta: pr.length ? deltaPct(done.length, pr.filter((r) => r.actualEnd != null).length) : undefined, deltaGood: 'up', help: dly.v != null ? 'desvío medio ' + fmt(dly.v, 1) + ' h' : '' }), line: done.length + ' actividades terminadas' + (dly.v != null ? ', desvío medio ' + fmt(dly.v, 1) + ' h' : '') }); });
    both('ferm', (cur, pr) => { if (!cur.length) return; const h = aggregate(cur, metOf('ferm', 'h75'), 'mean'); cards.push({ ds: 'ferm', k: kpi('Fermentaciones', cur.length, '', { delta: pr.length ? deltaPct(cur.length, pr.length) : undefined, deltaGood: 'up', help: h.v != null ? 'h75 medio ' + fmt(h.v, 0) + ' h' : '' }), line: cur.length + ' fermentaciones' + (h.v != null ? ' con h75 medio de ' + fmt(h.v, 0) + ' h' : '') }); });
    both('lev', (cur, pr) => { const m = metOf('lev', 'viab'), a = aggregate(cur, m, 'mean'); if (a.v == null) return; const b = aggregate(pr, m, 'mean'); cards.push({ ds: 'lev', k: kpi('Viabilidad', a.v, '%', { delta: b.v != null ? kd(m, a.v, b.v) : undefined, deltaGood: 'up', help: a.n + ' cosechas' }), line: 'Viabilidad media <b>' + fmt(a.v, 1) + ' %</b> en ' + a.n + ' cosechas' }); });
    return cards;
  }
  function resumenTurno(spec) {
    const ref = refTime();
    const ag = rowsOf('agua').filter((r) => r.total != null && r.total >= 0 && r.total <= 1000 && r.t <= capT());
    if (!ag.length) return emptyAnswer(Object.assign({}, spec, { ds: 'agua', period: defaultPeriod('agua', ref) }));
    const last = ag[ag.length - 1], win = P(last.t - 8 * HOUR, last.t, 'el turno ' + last.shift.toLowerCase() + ' del ' + fd(last.t), 'rolling');
    const same = ag.filter((r) => r.shift === last.shift && r.t > last.t - 60 * DAY && r !== last), md = med(same.map((r) => r.total));
    const as = rowsOf('aseos').filter((r) => r.t != null && r.t > win.from && r.t <= win.to), tr = rowsOf('trasiego').filter((r) => r.t != null && r.t > win.from && r.t <= win.to);
    const R = new Resp(Object.assign({}, spec, { ds: 'agua', period: win }), 'resumen');
    R.h('Resumen del turno ' + esc(last.shift.toLowerCase()), esc(fdt(last.t - 8 * HOUR)) + ' → ' + esc(fdt(last.t)) + ' · último turno con lectura');
    R.kpis([kpi('Agua del turno', last.total, 'm³', { delta: md ? deltaPct(last.total, md) : undefined, deltaGood: 'down', help: md ? 'mediana del turno ' + last.shift.toLowerCase() + ': ' + fa(md) + ' m³' : '' }), kpi('Aseos en el turno', as.length, '', { help: as.length ? fa(sum(as.map((r) => r.m3 || 0))) + ' m³' : '' }), kpi('Trasiegos y CIP', tr.length, '')]);
    R.p('En el turno ' + esc(last.shift.toLowerCase()) + ' se consumieron <b>' + fa(last.total) + ' m³</b> de agua' + (md ? ', ' + (last.total > md ? fmt(((last.total - md) / md) * 100, 0) + ' % por encima' : fmt(((md - last.total) / md) * 100, 0) + ' % por debajo') + ' de lo habitual en ese turno' : '') + '. Hubo ' + as.length + ' ' + plural(as.length, 'aseo') + ' y ' + tr.length + ' ' + plural(tr.length, 'actividad', 'actividades') + ' de trasiego/CIP iniciadas.');
    if (as.length) R.table(ROWCOLS.aseos.slice(0, 5), as.sort((a, b) => b.t - a.t), { max: 5 });
    R.note('Tomo como turno las 8 horas previas a la hora de lectura del contador de agua.', '');
    R.src(esc('Fuente: Consumo de agua, Aseos y Programa de trasiego'));
    R.chip('Resumen del día', 'resumen del día').chip('Resumen de la semana', 'resumen de la semana').chip('¿Qué debería revisar hoy?', 'qué debería revisar hoy');
    R.go_('Abrir Agua', 'agua', {});
    R.conf = 0.85;
    return R;
  }
  H.resumen = function (spec) {
    if (spec.turn) return resumenTurno(spec);
    const ref = refTime();
    let period = spec.period || P(sod(addDays(ref, -6)), eod(ref), 'últimos 7 días', 'rolling', { n: 7 });
    let note = '';
    let cards = areaCards(period, spec.brands);
    if (period.kind === 'day' && cards.length < 2) {
      for (let i = 1; i <= 7 && cards.length < 2; i++) { const t = addDays(period.from, -1 * i); const p2 = dayPeriod(t, 'el último día con datos (' + fd(t) + ')'); const c2 = areaCards(p2, spec.brands); if (c2.length >= 2) { note = 'Hoy todavía hay pocos registros; te muestro el último día con datos.'; period = p2; cards = c2; } }
    }
    const R = new Resp(Object.assign({}, spec, { period }), 'resumen');
    if (!cards.length) { R.h('Sin registros en ese periodo', esc(period.label)); R.p('No encuentro datos en ' + esc(period.label) + '. Puedes pedirme el resumen del mes o de los últimos 30 días.'); R.chip('Resumen del mes', 'resumen del mes').chip('Resumen de los últimos 30 días', 'resumen de los últimos 30 días'); R.conf = 0.6; return R; }
    R.h('Resumen · ' + esc(period.label), (period.txt ? esc(period.txt) + ' · ' : '') + cards.length + ' áreas con datos' + esc(brandTxt(spec)));
    R.parts.push('<div class="cf-kpis cf-kpis-3">' + cards.map((c) => CH().kpi(c.k)).join('') + '</div>'); R.txt.push(cards.map((c) => tagsOut(c.line)).join('; '));
    if (note) R.note(esc(note), 'warn');
    R.list(cards.map((c) => c.line));
    const fs = scan(period).filter((f) => f.sev !== 'info').slice(0, 3);
    if (fs.length) { R.p('<b>Lo que destaca:</b>'); R.list(fs.map((f) => sevTag(f.sev) + ' <b>' + esc(f.area) + '</b> · ' + esc(f.titulo))); }
    else R.p('No hay hallazgos fuera de lo normal en este periodo.');
    const days = (Math.min(period.to, capT()) - period.from) / DAY;
    if (days >= 4 && cards.some((c) => c.ds === 'agua')) { const spq = { ds: 'agua', period, brands: [], tanks: [], conds: [] }; const ser = series(spq, select(spq), metOf('agua', 'total'), 'sum', trendBy(period)); if (ser.length >= 3) R.chart(timeChart(ser, metOf('agua', 'total'), 'sum', { title: 'Consumo de agua', subtitle: period.label })); }
    R.src(esc('Fuente: ' + cards.map((c) => dsLabel(c.ds)).join(', ') + ' · ' + period.label));
    R.go_('Abrir el resumen en Análisis', 'analisis/resumen', {});
    R.go_('Ver el informe', 'analisis/informe', {});
    R.chip('¿Qué debería revisar hoy?', 'qué debería revisar hoy').chip('Compáralo con el periodo anterior', 'compara el consumo de agua con el periodo anterior').chip('¿Hay algo raro?', 'hay algo raro en los datos').chip('Dame un reporte', 'dame un reporte');
    R.conf = 0.9;
    return R;
  };

  /* ---------------------------------------------------------------- calidad de datos */
  const QUAL = {
    agua: { rows: () => DL().get('agua'), probs: (r) => { const p = []; if (r.total == null || r.valid === false) p.push(r.issue ? 'lecturas faltantes o con error' : 'sin consumo válido'); else if (r.total < 0 || r.total > 1000) p.push('valores imposibles'); return p; }, tail: 'El consumo del periodo queda subestimado por las lecturas que faltan.', q: 'consumo de agua' },
    aseos: { rows: () => DL().get('aseos'), probs: (r) => { const p = []; if (r.m3 == null) p.push('sin caudal o minutos válidos'); else if (r.m3 > 200) p.push('agua imposible'); if (r.ph != null && (r.ph < 0 || r.ph > 14)) p.push('pH imposible'); if (r.durMin != null && (r.durMin < 1 || r.durMin > 1440)) p.push('duración imposible'); if (!r.operator) p.push('sin operario'); if (r.t > refTime() + DAY) p.push('con fecha futura'); return p; }, tail: 'El agua por aseo solo se calcula cuando hay caudal y minutos de enjuague.', q: 'aseos' },
    merma: { rows: () => DL().get('merma'), probs: (r) => { const p = []; if (r.flag === 'Saldo negativo') p.push('saldo negativo'); else if (r.flag === 'Merma > 30 %') p.push('merma > 30 %'); else if (r.flag) p.push('faltan volúmenes'); return p; }, tail: 'Los lotes con saldo negativo o merma extrema distorsionan los promedios.', q: 'merma' },
    recuperacion: { rows: () => DL().get('recuperacion'), probs: (r) => { const p = []; if (r.hours == null) p.push('sin horas (faltan fechas)'); if (!r.brand) p.push('sin marca'); if (r.yieldPct != null && r.yieldPct > 110) p.push('rendimiento mayor a 110 %'); if (r.volume == null) p.push('sin Hl recuperados'); return p; }, tail: 'Sin fechas completas no se pueden calcular las horas de recuperación.', q: 'recuperación de cerveza' },
    trasiego: { rows: () => DL().get('trasiego'), probs: (r) => { const p = []; if (r.duration != null && (r.duration < 0.25 || r.duration > 72)) p.push('duración imposible'); if (r.delay != null && r.delay > metaG('trasiego.desvioMaxH', 1) && r.delay < 240 && r.cause === 'Sin causa registrada') p.push('retraso sin causa'); if (r.delay != null && (r.delay < -72 || r.delay > 240)) p.push('desvío imposible'); return p; }, tail: 'Los retrasos sin causa impiden hacer el Pareto de causas.', q: 'trasiegos' },
    ferm: { rows: () => DL().get('ferm'), probs: (r) => { const p = []; if ((r.nMuestras || 0) < 2) p.push('sin curva (menos de 2 muestras)'); if (r.h75 == null) p.push('sin h75'); if (r.viab == null) p.push('sin viabilidad de levadura'); return p; }, tail: 'Sin curva no se calculan h75, e72 ni ritmo de caída.', q: 'fermentaciones' },
    lev: { rows: () => DL().get('lev'), probs: (r) => { const p = []; if (r.viab == null) p.push('sin viabilidad'); if (r.cons == null) p.push('sin consistencia'); return p; }, tail: 'Las cosechas sin viabilidad no entran en los promedios.', q: 'levadura' },
  };
  function qualityOf(ds) {
    const Q = QUAL[ds], rows = Q.rows(), cnt = {}; let bad = 0;
    for (const r of rows) { const p = Q.probs(r); if (p.length) bad++; for (const x of uniq(p)) cnt[x] = (cnt[x] || 0) + 1; }
    const problems = Object.entries(cnt).map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n);
    const e = DL().extent(ds);
    return { ds, n: rows.length, bad, ok: rows.length ? ((rows.length - bad) / rows.length) * 100 : null, problems, e };
  }
  H.calidad = function (spec) {
    const q = norm(spec.raw || '');
    const R = new Resp(spec, 'calidad');
    const ref = refTime();
    const extents = /\bdesde cuando\b|\bhasta (que|cuando) fecha\b|\bhasta donde\b|\bcuantos registros\b|\bcobertura\b|\bque datos (hay|tengo|tenemos)\b/.test(q);
    const list = spec.ds ? [spec.ds] : DS_KEYS;
    const info = list.map(qualityOf);
    if (extents) {
      R.h(spec.ds ? 'Datos disponibles de ' + esc(dsLabel(spec.ds).toLowerCase()) : 'Qué datos tiene la plataforma', 'último dato general: ' + esc(fdt(ref)));
      R.table([{ k: 'l', t: 'Tema' }, { k: 'n', t: 'Registros', num: 1, f: (v) => fmt(v, 0) }, { k: 'f', t: 'Desde' }, { k: 'h', t: 'Hasta' }], info.map((x) => ({ l: dsLabel(x.ds), n: x.n, f: x.e ? fd(x.e.from) : '—', h: x.e ? fd(Math.min(x.e.to, x.ds === 'trasiego' || x.ds === 'aseos' ? x.e.to : x.e.to)) : '—' })), { max: 10 });
      const fut = info.filter((x) => x.e && x.e.to > ref + DAY);
      if (fut.length) R.note('Algunos temas incluyen fechas posteriores al último dato real (' + fut.map((x) => esc(dsLabel(x.ds)) + ' hasta ' + fd(x.e.to)).join('; ') + '): son programación a futuro o fechas mal digitadas; no las uso en los cálculos de «hoy».', 'warn');
      R.p('Cada tema trae sus propias fechas porque se alimenta de un Excel distinto. Para las cifras de «hoy», «esta semana» o «este mes» tomo como referencia el último dato real: <b>' + fd(ref) + '</b>.');
      R.src(esc('Fuente: capa de datos de la plataforma'));
      R.go_('Ver calidad de datos', 'analisis/calidad', {});
      R.chip('¿Qué datos faltan?', 'qué datos faltan').chip('¿Qué tan confiables son los datos?', 'qué tan confiables son los datos');
      R.conf = 0.88; return R;
    }
    if (spec.ds) {
      const x = info[0];
      R.h('Calidad de datos · ' + esc(dsLabel(x.ds)), x.n + ' registros' + (x.e ? ' · ' + fd(x.e.from) + ' a ' + fd(Math.min(x.e.to, capT())) : ''));
      R.kpis([kpi('Registros completos', x.ok, '%', { help: x.n - x.bad + ' de ' + x.n }), kpi('Con algún problema', x.bad, ''), kpi('Tipos de problema', x.problems.length, '')]);
      if (x.problems.length) {
        R.p('Lo que encontré en ' + esc(dsLabel(x.ds).toLowerCase()) + ':');
        R.list(x.problems.slice(0, 6).map((p) => '<b>' + fmt(p.n, 0) + '</b> ' + esc(p.t) + ' (' + fmt((p.n / x.n) * 100, 1) + ' %)'));
        R.p(esc(QUAL[x.ds].tail));
      } else R.p('No encontré problemas en ' + esc(dsLabel(x.ds).toLowerCase()) + ': todos los registros están completos y dentro de rangos posibles.');
      if (x.ds === 'agua') { const iss = {}; for (const r of DL().get('agua')) if (r.issue) iss[r.issue] = (iss[r.issue] || 0) + 1; const t = Object.entries(iss).sort((a, b) => b[1] - a[1])[0]; if (t) R.p('El aviso más frecuente en las lecturas es «' + esc(t[0]) + '» (' + t[1] + ' veces).'); }
      R.p(x.ok != null && x.ok >= 95 ? 'Mi lectura: los datos de ' + esc(dsLabel(x.ds).toLowerCase()) + ' son <b>confiables</b> (' + fmt(x.ok, 0) + ' % completos).' : x.ok != null && x.ok >= 80 ? 'Mi lectura: son <b>utilizables con cuidado</b> (' + fmt(x.ok, 0) + ' % completos): mis cifras descartan los valores imposibles y te aviso cuando lo hago.' : 'Mi lectura: la calidad es <b>baja</b> (' + fmt(x.ok, 0) + ' % completos); toma las cifras como orientativas y corrige primero los registros marcados.');
      R.src(esc('Fuente: ' + dsLabel(x.ds)));
      R.go_('Ver calidad de datos', 'analisis/calidad', {}); R.go_('Abrir ' + dsLabel(x.ds), DSROUTE[x.ds], {});
      R.chip('¿Qué datos faltan en general?', 'qué datos faltan').chip('¿Hasta qué fecha llegan los datos?', 'hasta qué fecha llegan los datos');
      R.export('Calidad ' + dsLabel(x.ds), [{ h: 'Problema', t: 's' }, { h: 'Registros', t: 'n' }], x.problems.map((p) => [p.t, p.n]), 'todo');
      R.conf = 0.88; return R;
    }
    R.h('Calidad de los datos', 'revisé los 7 temas de la plataforma');
    const avg = sum(info.map((x) => (x.ok || 0) * x.n)) / Math.max(1, sum(info.map((x) => x.n)));
    R.kpis([kpi('Registros completos (global)', avg, '%'), kpi('Temas revisados', info.length, ''), kpi('Con más problemas', info.slice().sort((a, b) => (a.ok || 0) - (b.ok || 0))[0] ? dsLabel(info.slice().sort((a, b) => (a.ok || 0) - (b.ok || 0))[0].ds) : '—', '')]);
    R.chart(barsH(info.filter((x) => x.ok != null).sort((a, b) => a.ok - b.ok).map((x) => ({ label: dsLabel(x.ds), v: x.ok })), { title: '% de registros completos y sin valores imposibles', unit: '%' }));
    R.table([{ k: 'l', t: 'Tema' }, { k: 'n', t: 'Registros', num: 1, f: (v) => fmt(v, 0) }, { k: 'ok', t: 'Completos', num: 1, f: (v) => fmt(v, 0) + ' %' }, { k: 'p', t: 'Principal problema' }], info.map((x) => ({ l: dsLabel(x.ds), n: x.n, ok: x.ok, p: x.problems[0] ? fmt(x.problems[0].n, 0) + ' ' + x.problems[0].t : 'ninguno' })), { max: 10 });
    const worst = info.slice().sort((a, b) => (a.ok || 0) - (b.ok || 0))[0];
    if (worst && worst.ok < 95) R.p('Empieza por <b>' + esc(dsLabel(worst.ds)) + '</b>: ' + fmt(worst.bad, 0) + ' registros con algún problema. ' + esc(QUAL[worst.ds].tail));
    R.note('Mis cálculos descartan automáticamente los valores imposibles (por ejemplo, un trasiego de 36.800 h) y te aviso cuando lo hago.', '');
    R.src(esc('Fuente: capa de datos de la plataforma'));
    R.go_('Ver calidad de datos', 'analisis/calidad', {});
    info.filter((x) => x.problems.length).sort((a, b) => b.bad / b.n - a.bad / a.n).slice(0, 3).forEach((x) => R.chip('Calidad de ' + dsLabel(x.ds).toLowerCase(), 'calidad de los datos de ' + QUAL[x.ds].q));
    R.export('Calidad de datos', [{ h: 'Tema', t: 's' }, { h: 'Registros', t: 'n' }, { h: '% completos', t: 'n' }, { h: 'Principal problema', t: 's' }], info.map((x) => [dsLabel(x.ds), x.n, x.ok, x.problems[0] ? x.problems[0].n + ' ' + x.problems[0].t : '']), 'todo');
    R.conf = 0.88;
    return R;
  };

  /* ---------------------------------------------------------------- documentos, plataforma, glosario, ayuda */
  const GLOSDYN = {
    merma: () => { const sp = { ds: 'merma', period: defaultPeriod('merma', refTime()), brands: [], tanks: [], conds: [] }, a = aggregate(select(sp), metOf('merma', 'lossPct'), 'wmean'); return a.v != null ? 'En tus datos de lo que va del año, la merma ponderada es <b>' + fmt(a.v, 2) + ' %</b> en ' + a.n + ' lotes cerrados.' : ''; },
    h75: () => { const sp = { ds: 'ferm', period: defaultPeriod('ferm', refTime()), brands: [], tanks: [], conds: [] }, a = aggregate(select(sp), metOf('ferm', 'h75'), 'mean'); return a.v != null ? 'El h75 promedio de lo que va del año es <b>' + fmt(a.v, 0) + ' h</b> (' + a.n + ' fermentaciones).' : ''; },
    viabilidad: () => { const sp = { ds: 'lev', period: defaultPeriod('lev', refTime()), brands: [], tanks: [], conds: [] }, a = aggregate(select(sp), metOf('lev', 'viab'), 'mean'); return a.v != null ? 'La viabilidad media de las cosechas del año es <b>' + fmt(a.v, 1) + ' %</b>; la meta mínima es ' + metaG('levadura.viabMin', 95) + ' %.' : ''; },
    cip: () => 'La meta configurada es de menos de <b>' + metaG('agua.aseoM3', 10) + ' m³ por aseo</b>.',
    desvio: () => 'La meta de desvío máximo configurada es <b>' + metaG('trasiego.desvioMaxH', 1) + ' h</b>.',
    recuperacion: () => 'El objetivo configurado es recuperar en <b>' + metaG('recuperacion.objetivoH', 72) + ' h</b> (máximo ' + metaG('recuperacion.maximoH', 96) + ' h).',
    atenuacion: () => { const sp = { ds: 'ferm', period: defaultPeriod('ferm', refTime()), brands: [], tanks: [], conds: [] }, a = aggregate(select(sp), metOf('ferm', 'atten'), 'mean'); return a.v != null ? 'La atenuación media final de lo que va del año es <b>' + fmt(a.v, 1) + ' %</b>.' : ''; },
  };
  H.glosario = function (plan) {
    const g = plan.item, R = new Resp({ intent: 'glosario' }, 'glosario');
    R.h(esc(g.t), 'glosario del proceso');
    R.p(g.texto);
    try { const d = GLOSDYN[g.k] && GLOSDYN[g.k](); if (d) R.p(d); } catch (e) { /* dato opcional */ }
    const RELQ = { merma: ['Merma por marca', '¿Qué tanque tiene más merma?'], h75: ['Distribución del h75', '¿Qué marca fermenta más rápido?'], viabilidad: ['Viabilidad por generación', 'Cosechas con viabilidad menor a 95 %'], cip: ['¿Cuántos aseos superan 10 m³?', 'Top 10 aseos con más consumo de agua'], desvio: ['Principales causas de desvío en los trasiegos', 'Desvío promedio por marca'], recuperacion: ['Horas promedio de recuperación', 'Recuperación por UTK'], atenuacion: ['Atenuación promedio de Light', 'Compara la atenuación de Club Colombia vs Light'] };
    const rel = Object.prototype.hasOwnProperty.call(RELQ, g.k) ? RELQ[g.k] : ['¿Qué sabes hacer?'];
    rel.forEach((x) => R.chip(x, x));
    R.conf = plan.conf || 0.85;
    return R;
  };
  H.plataforma = function (plan) {
    const it = plan.item, R = new Resp({ intent: 'plataforma' }, 'plataforma');
    R.h(esc(it.t), 'guía de la plataforma');
    R.p(it.texto);
    if (it.ruta) R.go_('Ir a ' + (NAVLABEL[it.ruta.split('/')[0]] || 'la sección') + (it.ruta.includes('/') ? ' · ' + it.ruta.split('/')[1] : ''), it.ruta, {});
    const NEXTQ = { cargar: ['¿Cómo capturo datos como en Excel?', '¿Dónde registro el agua?'], captura: ['¿Cómo cargo un Excel?', '¿Dónde registro un aseo?'], exportar: ['¿Cómo descargo una gráfica?', 'Dame un reporte'], agua: ['¿Cuánta agua gastamos este mes?', '¿Cómo cargo un Excel?'], aseo: ['¿Cuántos aseos hicimos este mes?', '¿Cómo cambio la meta de consumo por aseo?'], metas: ['¿Qué debería revisar hoy?'], ia: ['¿Qué sabes hacer?'] };
    const next = Object.prototype.hasOwnProperty.call(NEXTQ, it.k) ? NEXTQ[it.k] : ['¿Qué sabes hacer?', '¿Qué puedo preguntarte?'];
    next.forEach((x) => R.chip(x, x));
    R.conf = plan.conf || 0.88;
    return R;
  };
  function normDocs(list) {
    return (Array.isArray(list) ? list : []).map((d) => (typeof d === 'string' ? { id: d, titulo: d } : { id: d.id != null ? d.id : d.slug, titulo: d.titulo || d.nombre || d.title || d.id, desc: d.descripcion || d.desc || d.resumen || '', seccion: d.seccion || d.tipo || '' })).filter((d) => d.id != null);
  }
  H.docs = function (plan) {
    const D = A.Documentos, R = new Resp({ intent: 'docs' }, 'docs');
    if (!D) {
      R.h('Documentos', 'módulo aún no disponible');
      R.p('El módulo de documentos (procedimientos, instructivos y formatos) todavía no está instalado en esta versión de la plataforma. Cuando esté, podré buscarlos por tema, por ejemplo «¿qué documentos hay de aseos?».');
      R.chip('¿Qué sabes hacer?', '¿Qué sabes hacer?'); R.conf = 0.6; return R;
    }
    let items = [];
    try {
      if (plan.topic && D.listar) items = normDocs(D.listar(plan.topic));
      if (!items.length && D.buscar) { const key = norm(plan.text || '').replace(/\b(que|cuales|hay|tengo|tenemos|documentos?|archivos?|procedimientos?|instructivos?|manuales?|formatos?|sobre|de|del|la|el|los|las|dame|muestrame|busca|buscar|sop|politicas?|normas?)\b/g, ' ').replace(/\s+/g, ' ').trim(); items = normDocs(D.buscar(key || plan.topic || '')); }
    } catch (e) { items = []; }
    R.h(items.length ? items.length + ' ' + plural(items.length, 'documento') + (plan.topic ? ' de ' + esc(plan.topic) : '') : 'No encontré documentos', plan.topic ? 'tema: ' + esc(plan.topic) : 'búsqueda libre');
    if (items.length) R.parts.push('<ul class="cf-docs">' + items.slice(0, 10).map((d) => '<li><button type="button" class="cf-doc" data-cf-doc="' + esc(d.id) + '"><b>' + esc(d.titulo) + '</b>' + (d.desc ? '<span>' + esc(String(d.desc).slice(0, 110)) + '</span>' : '') + '</button></li>').join('') + '</ul>'), R.txt.push(items.slice(0, 10).map((d) => d.titulo).join('; '));
    else R.p('No hay documentos que coincidan' + (plan.topic ? ' con «' + esc(plan.topic) + '»' : '') + '. Puedes cargarlos desde la sección Documentos.');
    R.chip('Documentos de aseos', '¿qué documentos hay de aseos?').chip('Documentos de merma', '¿qué documentos hay de merma?');
    R.conf = 0.8;
    return R;
  };

  function allQuestions() { return KB().CATEGORIAS.flatMap((c) => c.ejemplos.map((q) => ({ q, cat: c.id, catTitulo: c.titulo }))); }
  const QIDX = { c: null };
  function qIndex() { if (QIDX.c && QIDX.c.n === allQuestions().length) return QIDX.c; const list = allQuestions().map((x) => ({ x, n: norm(x.q), t: new Set(norm(x.q).split(' ').filter((w) => w.length >= 3 && !STOP.has(w))) })); QIDX.c = { n: list.length, list }; return QIDX.c; }
  function suggestSimilar(q, n = 4) {
    const qt = norm(q).split(' ').map(fixWord).filter((w) => w.length >= 3 && !STOP.has(w));
    if (!qt.length) return [];
    const sc = qIndex().list.map((e) => { let s = 0; for (const w of qt) { if (e.t.has(w)) s += 1; else for (const t of e.t) if (t.length >= 4 && w.length >= 4 && (t.startsWith(w.slice(0, 4)) || w.startsWith(t.slice(0, 4)))) { s += 0.6; break; } } return { x: e.x, s: s / Math.sqrt(e.t.size + 1) }; }).filter((e) => e.s > 0.3).sort((a, b) => b.s - a.s);
    return sc.slice(0, n).map((e) => e.x);
  }
  H.ayuda = function () {
    const R = new Resp({ intent: 'ayuda' }, 'ayuda');
    const nq = allQuestions().length;
    R.h('Soy ' + esc(nombre()) + ', el analista de datos de la planta', 'motor local · no necesita internet ni IA externa');
    R.p('Leo los datos de tu plataforma (agua, aseos, merma, recuperación de cerveza, trasiegos, fermentación y levadura) y te respondo con cifras, periodo, comparación, gráfico y de dónde salió cada número. Puedes escribirme como hablas: entiendo errores de ortografía, abreviaturas (UTQ, FV, SV, UTK, CIP, GEA, Hl, m³) y fechas como «ayer», «el mes pasado» o «del 3 al 10 de abril».');
    R.list(['<b>Consultar</b>: totales, promedios, máximos, conteos y listas con filtros («aseos de SV 12 en septiembre»).', '<b>Comparar y graficar</b>: periodos, marcas, turnos, tanques («merma de Light vs Estándar»), tendencias, distribuciones, relaciones.', '<b>Explicar</b>: «¿por qué subió el consumo?» con qué lo explica y si la diferencia es real.', '<b>Anticipar</b>: proyecciones de fin de mes y escenarios «¿y si bajamos el consumo por aseo a 8 m³?».', '<b>Vigilar</b>: «¿qué debería revisar hoy?», anomalías, ahorro potencial y calidad de datos.', '<b>Guiar</b>: dónde está cada cosa y cómo cargar un Excel o capturar datos.', '<b>Conversar</b>: puedes seguir con «¿y de Light?», «¿y el mes pasado?», «grafícalo» o «exporta eso».']);
    R.note('Nunca invento cifras: si no hay datos o la pregunta es ambigua, te lo digo y te propongo opciones. Las acciones sobre tanques y levadura (registrar retiros o muestras) siguen pidiendo la contraseña de autorización.', '');
    R.parts.push('<div class="cf-acts"><button type="button" class="cf-act cf-go" data-cf-help="1">Ver las ' + nq + ' preguntas de ejemplo ›</button></div>');
    for (const c of KB().CATEGORIAS.slice(0, 6)) R.chip(c.titulo + ': ' + c.ejemplos[0].replace(/[¿?]/g, ''), c.ejemplos[0]);
    R.conf = 1;
    return R;
  };
  H.saludo = function () {
    const R = new Resp({ intent: 'saludo' }, 'saludo');
    const h = new Date().getHours();
    R.p((h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches') + '. Soy <b>' + esc(nombre()) + '</b>, el analista de datos de la planta. Pregúntame lo que quieras sobre agua, aseos, merma, recuperación, trasiegos, fermentación o levadura.');
    contextualQs().slice(0, 4).forEach((x) => R.chip(x.replace(/[¿?]/g, ''), x));
    R.chip('¿Qué sabes hacer?', '¿Qué sabes hacer?');
    R.conf = 1; return R;
  };
  H.gracias = function () { const R = new Resp({ intent: 'gracias' }, 'gracias'); R.p('Con gusto. Si quieres seguir, puedo compararlo, graficarlo o descargarlo en Excel.'); R.chip('Grafícalo', 'grafícalo').chip('Exporta eso', 'exporta eso').chip('¿Qué debería revisar hoy?', 'qué debería revisar hoy'); R.conf = 1; return R; };
  H.chao = function () { const R = new Resp({ intent: 'chao' }, 'chao'); R.p('Hasta luego. Aquí estaré cuando necesites revisar los datos de la planta.'); R.conf = 1; return R; };

  H.aclarar = function (plan) {
    const R = new Resp({ intent: 'aclarar' }, 'aclarar');
    const q = plan.q || '', hint = plan.hint || '';
    if (/^whatif/.test(hint)) {
      const ej = { 'whatif-aseo': ['Si bajamos el consumo por aseo a 8 m³', 'Si reducimos el consumo por aseo un 20 %'], 'whatif-merma': ['Si bajamos la merma a 1 %', 'Si reducimos la merma un 20 %'], 'whatif-agua': ['Si reducimos el consumo de agua un 10 %', 'Si reducimos el consumo de agua un 5 %'], whatif: ['Si bajamos el consumo por aseo a 8 m³', 'Si reducimos el consumo de agua un 10 %', 'Si el 80 % de las recuperaciones se hace en 72 h'] }[hint] || [];
      R.h('¿A cuánto quieres llevarlo?', 'para simular un escenario necesito la meta');
      R.p('Puedo calcular el ahorro, pero me falta el valor objetivo (por ejemplo «a 8 m³» o «un 10 %»). Prueba así:');
      ej.forEach((x) => R.chip(x, x)); R.conf = 0.5; return R;
    }
    R.h('Necesito un poco más de contexto', 'no estoy seguro de qué quieres consultar');
    const sim = suggestSimilar(plan.raw || q, 4);
    const last = S.mem.last;
    R.p('No pude ubicar el tema de tu pregunta. ' + (sim.length ? 'Estas preguntas se parecen a lo que escribiste:' : 'Dime si te refieres a agua, aseos, merma, recuperación, trasiegos, fermentación o levadura, por ejemplo:'));
    if (sim.length) sim.slice(0, 4).forEach((x) => R.chip(x.q.replace(/[¿?]/g, ''), x.q));
    else { R.chip('Consumo de agua de este mes', '¿Cuánta agua gastamos este mes?'); R.chip('Merma de este mes', '¿Cuál es la merma de este mes?'); R.chip('Aseos de este mes', '¿Cuántos aseos hicimos este mes?'); }
    if (last && last.ds) R.chip('Seguir con ' + dsLabel(last.ds).toLowerCase(), DSEXAMPLE[last.ds] + ' este mes');
    R.chip('¿Qué puedo preguntarte?', '¿Qué sabes hacer?');
    R.conf = 0.25;
    return R;
  };
  H.exportar = function () {
    const R = new Resp({ intent: 'exportar' }, 'exportar');
    let le = S.lastExp;
    if (!le && S.mem.last && S.mem.last.ds) { try { runSpec(S.mem.last).done(); le = S.lastExp; } catch (e) { le = null; } }
    if (!le || !le.exp || !le.exp.rows.length) { R.p('Todavía no hay nada que exportar. Hazme primero una consulta (por ejemplo «aseos de SV 12 en septiembre») y luego dime «exporta eso».'); R.chip('Aseos de SV 12 en septiembre', 'aseos de SV 12 en septiembre'); R.conf = 0.5; return R; }
    R.h('Descargando «' + esc(le.exp.nombre) + '»', le.exp.rows.length + ' filas · ' + esc(le.exp.sub || ''));
    R.p('Listo: preparé el Excel con <b>' + fmt(le.exp.rows.length, 0) + '</b> filas. Si no empieza solo, usa el botón «Descargar Excel» de la respuesta anterior.');
    R.after = () => exportExp(le.exp);
    R.conf = 0.9; return R;
  };
  H.nav = function (plan) {
    const R = new Resp({ intent: 'nav' }, 'nav'), n = plan.nav, last = S.mem.last;
    R.p('Te llevo a <b>' + esc(n.label) + '</b>' + (plan.fromMem && last ? ' con el mismo periodo y marcas de tu última consulta' : '') + '. Si prefieres ver la cifra aquí mismo, pídeme el dato (por ejemplo «' + esc(DSEXAMPLE[({ agua: 'agua', aseos: 'aseos', merma: 'merma', recuperacion: 'recuperacion', programa: 'trasiego' })[n.ruta.split('/')[0]]] || 'resumen de la semana') + ' este mes»).');
    R.go_('Abrir ' + n.label, n.ruta, plan.fromMem && last ? { ds: last.ds } : {});
    R.after = () => goTo(n.ruta, plan.fromMem ? last : null);
    R.chip('¿Qué sabes hacer?', '¿Qué sabes hacer?');
    R.conf = 0.9; return R;
  };
  H.reporte = function () {
    const R = new Resp({ intent: 'reporte' }, 'reporte');
    R.h('Reporte', 'te llevo al Informe del Análisis');
    R.p('El <b>Informe</b> junta indicadores, gráficas y hallazgos del periodo que tengas elegido en Análisis, listo para imprimir o guardar como PDF. Te lo abro; si quieres otro periodo, cámbialo arriba o pídeme un resumen.');
    R.go_('Abrir el informe', 'analisis/informe', {});
    R.after = () => goTo('analisis/informe', S.mem.last);
    R.chip('Resumen de la semana', 'resumen de la semana').chip('Resumen del mes', 'resumen del mes').chip('¿Qué debería revisar hoy?', 'qué debería revisar hoy');
    R.conf = 0.9; return R;
  };

  /* ---------------------------------------------------------------- navegación y exportación (acciones de los botones) */
  function setAnalisisFilters(spec) {
    try {
      const st = A.Analisis && A.Analisis.state; if (!st || !spec) return;
      const p = spec.period; if (p) {
        const ref = refTime();
        if (p.kind === 'all') st.preset = 'todo'; else if (p.dflt || (p.kind === 'year' && p.partial && p.y === new Date(ref).getFullYear())) st.preset = 'anio';
        else if (p.kind === 'month' && p.partial) st.preset = 'mes'; else { st.preset = 'custom'; st.from = p.from; st.to = p.to; }
      }
      const b = (spec.brands || []).filter((x) => x !== '*'); st.brands = b.filter((x) => DL().brands().includes(x));
    } catch (e) { /* el marco de Análisis es de otro módulo */ }
  }
  function goTo(ruta, spec) {
    if (!ruta) return;
    if (/^analisis/.test(ruta) && spec) setAnalisisFilters(spec);
    const h = '#/' + ruta.replace(/^#?\/?/, '');
    if (location.hash === h) { try { A.render(true); } catch (e) { /* sin render */ } } else location.hash = h;
    if (window.innerWidth < 701 && A.Bot && A.Bot.cerrar) A.Bot.cerrar();
  }
  function csvOf(exp) { const q = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return '﻿' + [exp.cols.map((c) => q(c.h)).join(';'), ...exp.rows.map((r) => r.map(q).join(';'))].join('\n'); }
  function exportExp(exp) {
    const name = (exp.nombre || 'cifra').replace(/[^\wáéíóúñ ]/gi, '').trim().replace(/\s+/g, '_');
    try {
      if (A.V35 && A.V35.excel) { A.V35.excel(name + '.xlsx', [{ nombre: String(exp.nombre).slice(0, 28), titulo: exp.nombre, sub: exp.sub || '', cols: exp.cols, rows: exp.rows }]); return true; }
    } catch (e) { /* cae a CSV */ }
    if (A.Analisis && A.Analisis.descargar) A.Analisis.descargar(name + '.csv', csvOf(exp), 'text/csv;charset=utf-8');
    else { const url = URL.createObjectURL(new Blob([csvOf(exp)], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = name + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
    return true;
  }

  /* ---------------------------------------------------------------- ejecución de un spec y router */
  const SPEC_INTENTS = new Set(['stat', 'trend', 'rank', 'compare', 'list', 'count', 'share', 'dist', 'corr', 'cause', 'forecast', 'whatif', 'programado', 'resumen', 'revisar', 'anomalias', 'ahorro', 'calidad']);
  function runSpec(spec) {
    const f = H[spec.intent] || H.stat;
    return f(spec);
  }
  function dispatch(plan) {
    const it = plan.intent;
    if (SPEC_INTENTS.has(it)) {
      const spec = plan.spec; if (!spec.raw) spec.raw = plan.raw;
      const R = runSpec(spec);
      return R;
    }
    if (H[it]) return H[it](plan);
    return null;
  }
  const FALLBACK_SIG = /No tengo esa respuesta|No encontré eso en los datos de la plataforma|No te entendí bien|esa no la capté/i;
  function legacyAnswer(texto, env) {
    // Pasa la pregunta por las capas anteriores (FV, colectores, levaduras, T0, trazabilidad, acciones con PIN…)
    S.reent = true;
    let r = null;
    try { r = A.Bot && A.Bot._responder ? A.Bot._responder(texto) : null; } catch (e) { r = null; } finally { S.reent = false; }
    return r;
  }
  function splitQuestion(texto) {
    const parts = String(texto).split(/\?\s+(?=¿?\w)|\s+y\s+(?=(?:cu[aá]nt|cu[aá]l|qu[eé]|c[oó]mo|compar|graf|dame|mu[eé]str|top|por\s?qu))/i).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
    return parts.length > 1 && parts.length <= 3 ? parts : null;
  }
  function run(texto) {
    const t0 = performance.now();
    const plan = understand(texto);
    if (plan.spec && !plan.spec.raw) plan.spec.raw = plan.raw;
    if (plan.intent === 'vacio') return null;
    if (plan.intent === 'legacy' || plan.intent === 'aclarar') return { legacy: true, plan };
    // varias preguntas en un mensaje
    const sp = /\bsi\b.*\b(a|un|el|la)\b/.test(norm(texto)) && !/\?\s+¿?\w/.test(texto) ? null : splitQuestion(texto);
    if (sp && !S.inSplit) {
      S.inSplit = true;
      try {
        const subs = sp.map((x) => { const p = understand(x); return p.spec || ['glosario', 'plataforma'].includes(p.intent) ? { x, p } : null; });
        if (subs.every(Boolean) && subs.every((s) => s.p.conf >= 0.6 && s.p.intent !== 'aclarar')) {
          const rs = subs.map((s) => { s.p.spec && (s.p.spec.raw = s.x); return dispatch(s.p).done(); });
          const html = rs.map((r, i) => '<div class="cf-multi"><div class="cf-multi-h">' + (i + 1) + '. ' + esc(sp[i]) + '</div>' + r.html + '</div>').join('');
          const last = subs[subs.length - 1].p; if (last.spec) remember(last.spec);
          return { out: { h: html, html, opts: rs[rs.length - 1].opts, intent: 'multi', conf: Math.min(...rs.map((r) => r.conf)), texto: rs.map((r) => r.texto).join(' '), spec: null }, plan, ms: performance.now() - t0 };
        }
      } finally { S.inSplit = false; }
    }
    let R;
    try { R = dispatch(plan); } catch (e) { if (window.console) console.error('[Cifra]', e); R = new Resp({ intent: 'error' }, 'error'); R.p('Tuve un problema calculando eso con los datos. Intenta de otra forma o pídeme otra consulta.'); R.conf = 0; }
    if (!R) return null;
    if (plan.ambig && plan.spec && R.intent !== 'aclarar') { const alt = plan.ambig.find((d) => d !== plan.spec.ds); if (alt) R.chip('¿Querías decir ' + dsLabel(alt).toLowerCase() + '?', DSEXAMPLE[alt] + (plan.spec.periodDefault ? '' : ' ' + (plan.spec.period.label || ''))); }
    if (plan.fixed && plan.fixed.length && plan.fixed.length <= 3 && SPEC_INTENTS.has(R.intent)) R.src(esc('Entendí ' + plan.fixed.map((f) => '«' + f[0] + '» como «' + f[1] + '»').join(', ') + '.'));
    if (plan.spec && plan.spec.ds && !['aclarar', 'error', 'calidad', 'revisar', 'anomalias', 'resumen', 'ahorro', 'programado'].includes(R.intent) && R.conf >= 0.6) remember(plan.spec);
    const out = R.done();
    out.afterFn = R.after || null;
    if (plan.fixed && plan.fixed.length) out.corregido = plan.fixed;
    return { out, plan, ms: performance.now() - t0 };
  }
  // Frecuencia de preguntas (solo las que se entendieron y son independientes)
  function bump(raw, plan, out) {
    try {
      if (!raw || raw.length < 12 || !plan || plan.followUp || (plan.spec && plan.spec.followed) || out.conf < 0.6 || ['aclarar', 'error', 'saludo', 'gracias', 'chao', 'vacio', 'exportar'].includes(plan.intent)) return;
      const k = norm(raw), f = LS.get('cifra.freq.v1', {});
      f[k] = { q: f[k] ? f[k].q : raw.trim(), n: (f[k] ? f[k].n : 0) + 1, t: Date.now() };
      const ks = Object.keys(f); if (ks.length > 60) ks.sort((a, b) => f[a].t - f[b].t).slice(0, ks.length - 60).forEach((x) => delete f[x]);
      LS.set('cifra.freq.v1', f);
    } catch (e) { /* sin almacenamiento */ }
  }
  const frecuentes = (n = 5) => Object.values(LS.get('cifra.freq.v1', {})).sort((a, b) => b.n - a.n || b.t - a.t).slice(0, n);

  /* Capa delante de App.BotDirecto */
  function answer(texto, env, prev) {
    const r = run(texto);
    if (!r) return null;
    if (r.legacy) {
      const inner = legacyAnswer(texto, env);
      if (inner && inner.h && !FALLBACK_SIG.test(String(inner.h).replace(/<[^>]+>/g, ' '))) return inner;
      const R = H.aclarar({ raw: texto, q: r.plan.q });
      const out = R.done();
      return { h: out.h, opts: out.opts, intent: 'aclarar' };
    }
    bump(texto, r.plan, r.out);
    const res = { h: r.out.h, opts: r.out.opts };
    if (r.out.afterFn) res.after = r.out.afterFn;
    return res;
  }
  (function install() {
    const prev = A.BotDirecto;
    A.BotDirecto = function (texto, env) {
      if (S.reent) return prev ? prev(texto, env) : null;
      try { const r = answer(texto, env, prev); if (r) return Object.assign(r, { directo: true }); } catch (e) { if (window.console) console.error('[Cifra]', e); }
      return prev ? prev(texto, env) : null;
    };
  })();

  /* API pública para pruebas y para otros módulos */
  function preguntar(texto, ctx) {
    return new Promise((resolve) => {
      if (ctx && ctx.reset) { S.mem.last = null; S.lastExp = null; }
      const t0 = performance.now();
      let r = null;
      try { r = run(texto); } catch (e) { r = null; if (window.console) console.error(e); }
      if (!r) { resolve({ texto: '', html: '', intent: 'vacio', confianza: 0, ms: 0 }); return; }
      if (r.legacy) {
        const inner = legacyAnswer(texto);
        const txt = inner && inner.h ? tagsOut(inner.h) : '';
        if (inner && inner.h && !FALLBACK_SIG.test(txt)) { resolve({ texto: txt, html: inner.h, intent: 'legacy', confianza: 0.7, opts: inner.opts || [], ms: performance.now() - t0 }); return; }
        const out = H.aclarar({ raw: texto, q: r.plan.q }).done();
        resolve({ texto: out.texto, html: out.html, intent: 'aclarar', confianza: 0.2, opts: out.opts, ms: performance.now() - t0 }); return;
      }
      bump(texto, r.plan, r.out);
      resolve({ texto: r.out.texto, html: r.out.html, valor: r.out.valor, intent: r.out.intent, confianza: r.out.conf, opts: r.out.opts, hasChart: r.out.hasChart, hasTable: r.out.hasTable, spec: r.out.spec, corregido: r.out.corregido || null, ms: performance.now() - t0 });
    });
  }

  /* ---------------------------------------------------------------- interfaz del panel */
  const $q = (s, r) => (r || document).querySelector(s);
  const $qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const panelEl = () => document.getElementById('levabot');
  const routeInfo = () => { const p = (location.hash || '#/inicio').slice(2).split('/'); return { rt: p[0] || 'inicio', tab: (p[1] || '').split('?')[0] }; };
  function contextualQs() {
    const { rt, tab } = routeInfo(), kb = KB();
    if (rt === 'analisis') { const m = { agua: 'agua', merma: 'merma', recuperacion: 'recuperacion', operacion: 'aseos', fermentacion: 'ferm', levadura: 'lev', calidad: 'calidad', informe: 'reportes', pronosticos: 'analisis', relaciones: 'analisis', resumen: 'reportes' }[tab]; const cat = kb.CATEGORIAS.find((c) => c.id === m); if (cat) return cat.ejemplos.slice(0, 4); return kb.CONTEXTUAL.analisis || []; }
    return (kb.CONTEXTUAL[rt] || kb.CONTEXTUAL.inicio || []).slice(0, 4);
  }
  function ask(q) {
    closeHelp();
    const inp = $q('#botI'); if (inp) { inp.value = ''; inp.style.height = '46px'; }
    hideSug();
    if (A.Bot && A.Bot._enviar) A.Bot._enviar(q);
  }

  function aplicarNombre() {
    const n = nombre(), el = panelEl();
    if (el) {
      el.setAttribute('aria-label', n);
      $qa('[data-cf-name]', el).forEach((x) => { if (x.textContent !== n) x.textContent = n; });
      const ti = $q('#botI', el); if (ti) { ti.placeholder = 'Pregúntale a ' + n + '…'; ti.setAttribute('aria-label', 'Mensaje para ' + n); }
      const x = $q('#botX', el); if (x) x.setAttribute('aria-label', 'Cerrar ' + n);
      const ty = $q('.bm.typing', el); if (ty) ty.setAttribute('aria-label', n + ' está analizando');
    }
    const b = document.getElementById('botBtn');
    if (b) { b.setAttribute('aria-label', 'Abrir ' + n); const t = b.querySelector('.bb-txt'); if (t && t.textContent.trim() !== n) t.textContent = ' ' + n; }
    $qa('[data-cf-nombre]').forEach((x) => { if (x.textContent !== n) x.textContent = n; });
  }

  /* --- panel «¿Qué puedo preguntar?» --- */
  function renderHelp(cat, filter) {
    const box = $q('#cfHelpBody'); if (!box) return;
    const kb = KB(), f = norm(filter || '');
    const tabs = $q('#cfHelpTabs');
    if (tabs) tabs.innerHTML = kb.CATEGORIAS.map((c) => '<button type="button" class="cf-tab" role="tab" aria-selected="' + (c.id === cat && !f) + '" data-cf-cat="' + c.id + '">' + esc(c.titulo) + '<small>' + c.ejemplos.length + '</small></button>').join('');
    let items;
    if (f) { const toks = f.split(' ').filter((t) => t.length >= 2); items = allQuestions().filter((x) => { const n = norm(x.q); return toks.every((t) => n.includes(t) || n.split(' ').some((w) => w.startsWith(t.slice(0, 4)) && t.length >= 4)); }); }
    else { const c = kb.CATEGORIAS.find((x) => x.id === cat) || kb.CATEGORIAS[0]; items = c.ejemplos.map((q) => ({ q, cat: c.id, catTitulo: c.titulo })); }
    const fq = frecuentes(4);
    box.innerHTML = (f ? '<div class="cf-help-res">' + items.length + ' ' + (items.length === 1 ? 'resultado' : 'resultados') + ' para «' + esc(filter) + '»</div>' : '') +
      (!f && fq.length ? '<div class="cf-help-sec"><h4>Tus preguntas frecuentes</h4>' + fq.map((x) => '<button type="button" class="cf-q cf-q-freq" data-cf-q="' + esc(x.q) + '">' + esc(x.q) + '<small>×' + x.n + '</small></button>').join('') + '</div>' : '') +
      '<div class="cf-help-sec">' + (f ? '' : '<h4>' + esc((kb.CATEGORIAS.find((c) => c.id === cat) || kb.CATEGORIAS[0]).titulo) + '</h4>') + (items.length ? items.map((x) => '<button type="button" class="cf-q" data-cf-q="' + esc(x.q) + '">' + esc(x.q) + (f ? '<small>' + esc(x.catTitulo) + '</small>' : '') + '</button>').join('') : '<p class="cf-mut">Nada coincide. Escríbeme tu pregunta igual: entiendo errores de ortografía y jerga de planta.</p>') + '</div>' +
      (!f ? '<div class="cf-help-sec"><h4>Después de una respuesta puedes decir</h4><div class="cf-fu">' + kb.SEGUIMIENTOS.map((s) => '<span class="cf-fu-i">' + esc(s) + '</span>').join('') + '</div></div>' : '');
  }
  function openHelp(cat) {
    const el = panelEl(); if (!el) return;
    let h = $q('#cfHelpPanel', el); if (!h) return;
    h.hidden = false; el.classList.add('cf-help-on');
    renderHelp(cat || KB().CATEGORIAS[0].id, '');
    h.dataset.cat = cat || KB().CATEGORIAS[0].id;
    const s = $q('#cfHelpSearch', h); if (s) { s.value = ''; setTimeout(() => s.focus(), 30); }
  }
  function closeHelp() { const el = panelEl(); if (!el) return; const h = $q('#cfHelpPanel', el); if (h && !h.hidden) { h.hidden = true; el.classList.remove('cf-help-on'); const b = $q('#cfHelpBtn', el); if (b) b.focus(); } }

  /* --- estado vacío / bienvenida --- */
  let welcomeRoute = '';
  function renderWelcome() {
    const w = $q('#cfWelcome'); if (!w) return;
    const kb = KB(), fq = frecuentes(4), ctxq = contextualQs();
    welcomeRoute = location.hash;
    w.innerHTML = '<div class="cf-w-hi"><b>Hola, soy <span data-cf-name>' + esc(nombre()) + '</span></b><p>Analista de datos de la planta. Pregúntame con tus palabras sobre agua, aseos, merma, recuperación, trasiegos, fermentación o levadura: te respondo con cifras, gráficos y el origen de cada dato.</p></div>' +
      '<div class="cf-w-sec"><h4>Para esta pantalla</h4>' + ctxq.map((q) => '<button type="button" class="cf-q" data-cf-q="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' +
      (fq.length ? '<div class="cf-w-sec"><h4>Tus preguntas frecuentes</h4>' + fq.map((x) => '<button type="button" class="cf-q cf-q-freq" data-cf-q="' + esc(x.q) + '">' + esc(x.q) + '<small>×' + x.n + '</small></button>').join('') + '</div>' : '') +
      '<div class="cf-w-sec"><h4>Explora por tema</h4><div class="cf-cats">' + kb.CATEGORIAS.map((c) => '<button type="button" class="cf-cat" data-cf-opencat="' + c.id + '">' + esc(c.titulo) + '</button>').join('') + '</div></div>' +
      '<button type="button" class="cf-act cf-go cf-w-all" data-cf-help="1">Ver las ' + allQuestions().length + ' preguntas de ejemplo ›</button>';
  }
  function updateEmpty() {
    const el = panelEl(); if (!el) return;
    const m = $q('#botM', el); if (!m) return;
    const n = m.querySelectorAll('.bm:not(.typing)').length, hasUser = !!m.querySelector('.bm.u');
    const empty = !hasUser && n <= 3;
    el.classList.toggle('cf-empty', empty);
    const w = $q('#cfWelcome', el);
    if (w) { w.hidden = !empty; if (empty && (w.dataset.r !== location.hash || !w.innerHTML)) { renderWelcome(); w.dataset.r = location.hash; } }
  }

  /* --- autocompletado --- */
  let sugItems = [], sugIdx = -1;
  function hideSug() { const s = $q('#cfSug'); if (s) { s.hidden = true; s.innerHTML = ''; } sugItems = []; sugIdx = -1; const i = $q('#botI'); if (i) i.removeAttribute('aria-activedescendant'); }
  function showSug(v) {
    const s = $q('#cfSug'); if (!s) return;
    const nv = norm(v);
    if (nv.length < 3) { hideSug(); return; }
    const toks = nv.split(' ').filter(Boolean), last = toks[toks.length - 1];
    const pool = [...frecuentes(10).map((x) => ({ q: x.q, catTitulo: 'Frecuente', freq: x.n })), ...allQuestions()];
    const seen = new Set(), sc = [];
    for (const it of pool) {
      const n = norm(it.q); if (seen.has(n)) continue;
      const words = n.split(' ');
      let s0 = 0, all = true;
      for (const t of toks) { if (words.some((w) => w === t)) s0 += 2; else if (words.some((w) => w.startsWith(t))) s0 += 1.5; else if (t.length >= 4 && n.includes(t)) s0 += 1; else if (t.length >= 5 && words.some((w) => w.length >= 5 && dl(w, t, 1) <= 1)) s0 += 1; else all = false; }
      if (!all && toks.length > 1 && s0 < toks.length) continue;
      if (!s0) continue;
      if (n.startsWith(nv)) s0 += 3; if (it.freq) s0 += 0.5;
      seen.add(n); sc.push({ it, s0 });
    }
    sc.sort((a, b) => b.s0 - a.s0);
    sugItems = sc.slice(0, 6).map((x) => x.it);
    if (!sugItems.length) { hideSug(); return; }
    sugIdx = -1;
    s.innerHTML = sugItems.map((x, i) => '<button type="button" role="option" id="cfSug' + i + '" class="cf-sug-i" data-cf-sug="' + i + '"><span>' + esc(x.q) + '</span><small>' + esc(x.catTitulo) + '</small></button>').join('');
    s.hidden = false;
  }
  function moveSug(d) {
    const s = $q('#cfSug'); if (!s || s.hidden) return false;
    sugIdx = (sugIdx + d + sugItems.length + 1) % (sugItems.length + 1) - 1 + 0;
    if (sugIdx >= sugItems.length) sugIdx = -1;
    $qa('.cf-sug-i', s).forEach((b, i) => b.classList.toggle('on', i === sugIdx));
    const inp = $q('#botI'); if (inp) { if (sugIdx >= 0) inp.setAttribute('aria-activedescendant', 'cfSug' + sugIdx); else inp.removeAttribute('aria-activedescendant'); }
    return true;
  }

  /* --- montaje --- */
  const icoHelp = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8"/><path d="M12 16.9h.01"/></svg>';
  const icoWide = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
  const icoMore = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
  function enhance() {
    const el = panelEl(); if (!el) return;
    if (el.dataset.cf === '1') { aplicarNombre(); updateEmpty(); return; }
    el.dataset.cf = '1';
    const head = $q('.bot-h', el), act = $q('.bot-head-actions', el), m = $q('#botM', el), form = $q('#botF', el);
    if (head) {
      const t = head.querySelector(':scope > div:not(.bot-head-actions)');
      if (t) t.innerHTML = '<b data-cf-name>' + esc(nombre()) + '</b><span class="cf-sub">Analista de datos de la planta</span>';
    }
    if (act) {
      const x = $q('#botX', act);
      const mk = (id, cls, html, label) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'btn sm ghost cf-hb ' + cls; b.innerHTML = html; b.setAttribute('aria-label', label); b.title = label; return b; };
      const help = mk('cfHelpBtn', '', icoHelp, '¿Qué puedo preguntar?'), wide = mk('cfWideBtn', 'cf-wide-btn', icoWide, 'Ampliar el panel'), more = mk('cfMore', '', icoMore, 'Más opciones');
      wide.setAttribute('aria-pressed', 'false'); more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div'); menu.id = 'cfMenu'; menu.className = 'cf-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
      ['#botNew', '#botProactive', '#botPwd'].forEach((s) => { const b = $q(s, act); if (b) { b.classList.add('cf-menu-i'); b.setAttribute('role', 'menuitem'); menu.appendChild(b); } });
      act.insertBefore(help, x); act.insertBefore(wide, x); act.insertBefore(more, x);
      head.appendChild(menu);
      more.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) { const f = menu.querySelector('button'); if (f) f.focus(); } });
      menu.addEventListener('click', () => { setTimeout(() => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); }, 0); });
      menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); menu.hidden = true; more.setAttribute('aria-expanded', 'false'); more.focus(); } });
      help.addEventListener('click', () => openHelp());
      wide.addEventListener('click', () => setWide(!el.classList.contains('cf-wide')));
      const nb = $q('#botNew', menu); if (nb) nb.addEventListener('click', () => { S.mem.last = null; S.lastExp = null; LS.set('cifra.mem.v1', S.mem); setTimeout(updateEmpty, 30); }, true);
    }
    // contenedor de bienvenida
    const w = document.createElement('div'); w.id = 'cfWelcome'; w.className = 'cf-welcome'; w.hidden = true; w.setAttribute('aria-label', 'Para empezar');
    if (m) m.insertAdjacentElement('afterend', w);
    // panel de ayuda
    const hp = document.createElement('div'); hp.id = 'cfHelpPanel'; hp.className = 'cf-help'; hp.hidden = true; hp.setAttribute('role', 'dialog'); hp.setAttribute('aria-label', '¿Qué puedo preguntar?');
    hp.innerHTML = '<div class="cf-help-h"><b>¿Qué puedo preguntar?</b><button type="button" class="btn sm ghost cf-hb" id="cfHelpClose" aria-label="Cerrar la ayuda">✕</button></div><div class="cf-help-s"><input id="cfHelpSearch" type="search" placeholder="Busca una pregunta (agua, merma, comparar…)" aria-label="Buscar entre las preguntas de ejemplo" autocomplete="off"></div><div class="cf-help-tabs" id="cfHelpTabs" role="tablist"></div><div class="cf-help-b" id="cfHelpBody"></div>';
    el.appendChild(hp);
    $q('#cfHelpClose', hp).addEventListener('click', closeHelp);
    $q('#cfHelpSearch', hp).addEventListener('input', (e) => renderHelp(hp.dataset.cat, e.target.value));
    hp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeHelp(); } });
    // autocompletado
    if (form) {
      form.classList.add('cf-form');
      const sg = document.createElement('div'); sg.id = 'cfSug'; sg.className = 'cf-sug'; sg.hidden = true; sg.setAttribute('role', 'listbox'); sg.setAttribute('aria-label', 'Sugerencias de preguntas');
      form.insertAdjacentElement('afterbegin', sg);
      const inp = $q('#botI', form);
      if (inp) {
        inp.setAttribute('aria-autocomplete', 'list'); inp.setAttribute('aria-controls', 'cfSug');
        inp.addEventListener('input', () => showSug(inp.value));
        inp.addEventListener('blur', () => setTimeout(hideSug, 160));
        inp.addEventListener('keydown', (e) => {
          const open = !sg.hidden;
          if (open && e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); moveSug(1); }
          else if (open && e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); moveSug(-1); }
          else if (open && e.key === 'Tab' && sugItems.length) { e.preventDefault(); e.stopImmediatePropagation(); inp.value = sugItems[Math.max(0, sugIdx)].q; hideSug(); }
          else if (open && e.key === 'Enter' && sugIdx >= 0) { e.preventDefault(); e.stopImmediatePropagation(); const q = sugItems[sugIdx].q; ask(q); }
          else if (open && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); hideSug(); }
        }, true);
        form.addEventListener('submit', hideSug, true);
      }
      sg.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-cf-sug]'); if (b) { e.preventDefault(); ask(sugItems[+b.dataset.cfSug].q); } });
    }
    // pasos de «analizando…»
    if (m) new MutationObserver(() => {
      updateEmpty();
      const ty = $q('.bm.typing:not([data-cf])', m); if (!ty) return;
      ty.dataset.cf = '1';
      const steps = ['Leyendo los registros…', 'Calculando y comparando…', 'Armando la respuesta…'];
      ty.innerHTML = '<span class="bot-typing"><i></i><i></i><i></i></span><span class="cf-steps">' + steps[0] + '</span>';
      let k = 0; const lab = $q('.cf-steps', ty);
      const iv = setInterval(() => { if (!document.contains(ty)) { clearInterval(iv); return; } k = Math.min(steps.length - 1, k + 1); lab.textContent = steps[k]; }, 700);
    }).observe(m, { childList: true });
    try { if (LS.get('cifra.wide', false)) setWide(true); } catch (e) { /* ancho por defecto */ }
    aplicarNombre(); updateEmpty();
  }
  function setWide(on) {
    const el = panelEl(); if (!el) return;
    el.classList.toggle('cf-wide', !!on); document.body.classList.toggle('cf-wide-on', !!on);
    const b = $q('#cfWideBtn', el); if (b) { b.setAttribute('aria-pressed', String(!!on)); b.title = b.getAttribute('aria-label') === 'Ampliar el panel' || on ? (on ? 'Reducir el panel' : 'Ampliar el panel') : b.title; b.setAttribute('aria-label', on ? 'Reducir el panel' : 'Ampliar el panel'); }
    LS.set('cifra.wide', !!on);
  }

  /* --- acciones de los botones dentro de las respuestas --- */
  document.addEventListener('click', (e) => {
    const t = e.target; if (!t || !t.closest) return;
    let b;
    if ((b = t.closest('[data-cf-q]'))) { e.preventDefault(); ask(b.dataset.cfQ); return; }
    if ((b = t.closest('[data-cf-help]'))) { e.preventDefault(); openHelp(); return; }
    if ((b = t.closest('[data-cf-opencat]'))) { e.preventDefault(); openHelp(b.dataset.cfOpencat); return; }
    if ((b = t.closest('.cf-tab[data-cf-cat]'))) { const hp = $q('#cfHelpPanel'); if (hp) { hp.dataset.cat = b.dataset.cfCat; const s = $q('#cfHelpSearch'); if (s) s.value = ''; renderHelp(b.dataset.cfCat, ''); } return; }
    if ((b = t.closest('[data-cf-go]'))) { e.preventDefault(); const spec = b.dataset.cfSpec ? jparse(b.dataset.cfSpec, null) : null; goTo(b.dataset.cfGo, spec); return; }
    if ((b = t.closest('[data-cf-xls]'))) {
      e.preventDefault();
      const spec = b.dataset.cfSpec ? jparse(b.dataset.cfSpec, null) : null;
      let exp = S.lastExp && spec && S.lastExp.spec && JSON.stringify(S.lastExp.spec) === JSON.stringify(spec) ? S.lastExp.exp : null;
      if (!exp && spec) { try { const R = runSpec(spec); exp = R.exp; } catch (er) { exp = null; } }
      if (exp && exp.rows.length) { exportExp(exp); if (A.U && A.U.toast) A.U.toast('Descargando ' + exp.nombre + '…'); }
      else if (A.U && A.U.toast) A.U.toast('No hay filas para exportar.');
      return;
    }
    if ((b = t.closest('[data-cf-copy]'))) {
      e.preventDefault();
      const ans = b.closest('.cf-ans'); if (!ans) return;
      const clone = ans.cloneNode(true); $qa('.cf-acts,.ch-tb', clone).forEach((x) => x.remove());
      const text = clone.innerText ? clone.innerText.replace(/\n{3,}/g, '\n\n').trim() : clone.textContent.trim();
      const done = () => { const o = b.textContent; b.textContent = 'Copiado'; b.classList.add('ok'); setTimeout(() => { b.textContent = o; b.classList.remove('ok'); }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); else fallbackCopy(text, done);
      return;
    }
    if ((b = t.closest('[data-cf-doc]'))) { e.preventDefault(); try { A.Documentos.abrir(b.dataset.cfDoc); } catch (er) { if (A.U && A.U.toast) A.U.toast('No pude abrir el documento.'); } return; }
    // cerrar menú al hacer clic fuera
    const mn = $q('#cfMenu'); if (mn && !mn.hidden && !t.closest('#cfMenu')) { mn.hidden = true; const mb = $q('#cfMore'); if (mb) mb.setAttribute('aria-expanded', 'false'); }
  });
  function fallbackCopy(text, done) { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) { /* sin portapapeles */ } }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const el = panelEl(); if (!el || el.hidden) return;
    const hp = $q('#cfHelpPanel', el); if (hp && !hp.hidden) { e.stopImmediatePropagation(); closeHelp(); }
  }, true);
  window.addEventListener('hashchange', () => { setTimeout(() => { updateEmpty(); aplicarNombre(); }, 60); });

  /* Enganche en la apertura del panel */
  (function hook() {
    if (!A.Bot || !A.Bot.abrir) return;
    const ab = A.Bot.abrir;
    A.Bot.abrir = function () {
      const r = ab.apply(this, arguments);
      try { enhance(); } catch (e) { if (window.console) console.error('[Cifra] ui', e); }
      return r;
    };
    if (panelEl()) { try { enhance(); } catch (e) { /* aún no construido */ } }
    setInterval(() => { try { aplicarNombre(); } catch (e) { /* sin DOM */ } }, 4000);
    setTimeout(aplicarNombre, 500);
  })();

  A.Cifra = {
    version: '1.0', preguntar, entender: understand, aplicarNombre, abrirAyuda: openHelp, cerrarAyuda: closeHelp, catalogo: () => allQuestions(), frecuentes,
    memoria: () => cloneJ(S.mem), olvidar() { S.mem.last = null; S.lastExp = null; LS.set('cifra.mem.v1', S.mem); }, sugerir: suggestSimilar, ampliar: setWide, _H: H, _select: select, _rows: rowsOf, _metOf: metOf, _aggregate: aggregate, _refTime: refTime, _norm: norm, _correct: correct, _periodo: (t) => parsePeriod(norm(t), refTime()), _eqCanon: eqCanon,
  };
})();
