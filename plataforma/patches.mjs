// Reemplazos de texto exactos sobre el HTML original (se verifica el número de coincidencias).
// Los nombres internos (claves de localStorage, cabecera x-levabot-token, ruta /api/levabot, ids #levabot) NO se tocan:
// solo cambia el nombre visible del asistente.
export const ASSISTANT = 'Cifra';
export const PATCHES = [
  { name: 'Nombre visible del asistente', find: 'LevaBot', replace: ASSISTANT, count: 53 },
  { name: 'El intérprete ignora el nombre como palabra de relleno',
    find: ' levabot bot parce', replace: ' levabot cifra bot parce', count: 1 },
];
