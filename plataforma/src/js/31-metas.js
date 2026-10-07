/* ============================================================
   App.Metas · metas y límites de proceso, editables en Configuración
   Valores iniciales tomados de los propios Excel del usuario (columnas «TG», «UCL», semáforos y notas).
   Se guardan en App.S.config.cifraMetas; lo que el usuario no cambie conserva el valor por defecto.
   ============================================================ */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;

  const DEFAULTS = {
    agua: {
      aseoM3: 10,           // consumo objetivo por aseo (UTQ, colector, línea) < 10 m³
      pisosBajo: 60, pisosAlto: 100,       // semáforo de pisos por lectura (m³)
      geaBajo: 600, geaAlto: 1000,         // semáforo CIP GEA por lectura (Hl)
      turnosAtipicos: 1.25,                // un turno se marca si supera 1,25 × la mediana
    },
    recuperacion: {
      objetivoH: 72, maximoH: 96,          // horas hasta recuperar (TG / UCL)
      phMax: 5.35, phObjetivo: 4.4, tempMax: 2, presionMax: 5,
      aguaMin: 49, aguaMax: 51,            // relación agua/levadura (%)
    },
    aseos: { phMin: 6, phMax: 8, aseoDiasUrgente: 1, aseoDiasPilas: 8 },
    trasiego: { trasiegoH: 8.5, cipCentrifugaH: 2.5, holguraH: 1, desvioMaxH: 1 },
    levadura: { viabMin: 95, tempMin: 3, tempMax: 4 },
    merma: { fvMax: null, svMax: null, alerta: 30 },   // % (la alerta de 30 % ya la usa el programa)
    calidad: { cpkMinimo: 1.33, sigmas: 3 },
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const saved = () => (A.S && A.S.config && A.S.config.cifraMetas) || {};
  function merged() {
    const out = clone(DEFAULTS), s = saved();
    for (const g of Object.keys(out)) Object.assign(out[g], s[g] || {});
    out.asistente = Object.assign({ nombre: 'Cifra' }, s.asistente || {});
    out.marcas = Object.assign({}, s.marcas || {});
    return out;
  }
  const get = (path, fallback) => {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), merged());
    return v == null ? fallback : v;
  };
  async function set(patch) {
    const cur = clone(saved());
    for (const [g, vals] of Object.entries(patch)) cur[g] = Object.assign({}, cur[g] || {}, vals);
    if (A.Store && A.Store.set) await A.Store.set('config', 'cifraMetas', cur);
    return merged();
  }
  async function reset(group) {
    const cur = clone(saved());
    if (group) delete cur[group]; else Object.keys(cur).forEach((k) => delete cur[k]);
    if (A.Store && A.Store.set) await A.Store.set('config', 'cifraMetas', cur);
    return merged();
  }
  A.Metas = { DEFAULTS, get, set, reset, all: merged };
})();
