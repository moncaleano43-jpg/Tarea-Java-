// Reemplazos de texto exactos sobre el HTML original (se verifica el número de coincidencias).
// Los nombres internos (claves de localStorage, cabecera x-levabot-token, ruta /api/levabot, ids #levabot) NO se tocan:
// solo cambia el nombre visible del asistente.
export const ASSISTANT = 'Cifra';
export const PATCHES = [
  { name: 'Nombre visible del asistente', find: 'LevaBot', replace: ASSISTANT, count: 53 },
  { name: 'El intérprete ignora el nombre como palabra de relleno',
    find: ' levabot bot parce', replace: ' levabot cifra bot parce', count: 1 },
  { name: 'OperationSources: exponer importación/fusión y apertura de capturas',
    find: 'App.OperationSources={defs,raw,schema,records,date,dateSerial,cellText,status,capture,exportBook,importBook};restore();',
    replace: 'App.OperationSources={defs,raw,schema,records,date,dateSerial,cellText,status,capture,exportBook,importBook,setImport:async(type,next)=>{imports[type]=next;await saveImport(type,next);},getImport:type=>imports[type]||null,tabOf:type=>tab[type],setTab:(type,name)=>{tab[type]=name;page[type]=0;}};restore();', count: 1 },
  { name: 'Menú «Operación y análisis»: más accesos',
    find: "const extraRoutes=[['aseos','Aseos'],['recuperacion','Recuperación'],['programa','Programa de trasiego'],['merma','Merma'],['agua','Agua'],['analisis','Análisis']];",
    replace: "const extraRoutes=[['agua','Consumo de agua'],['aseos','Aseos'],['recuperacion','Recuperación de cerveza'],['programa','Programa de trasiego'],['merma','Merma'],['analisis','Análisis de datos'],['analista','Analista de fermentación'],['comparar','Comparar'],['historico','Histórico de fermentación'],['config','Configuración']];", count: 1 },
];
