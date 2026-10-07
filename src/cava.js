/* ============================================================
   cava.js — Control de proceso de cava (FV / SV)
   Reemplaza al Excel "CONTROL PROCESO CAVAS": informe de cava,
   registro de llenado de FV, trasiego a SV y maduración, análisis,
   inventario de cellars, merma / SAP y especificaciones por marca.
   Colecciones: llenados, trasiegos, cava (+ config/espec, config/cavaCfg)
   ============================================================ */
(function(){
"use strict";
const {esc,f,pc,num,fmt,fmtS,toIn,parseDT,HOUR,DAY,toast,clone,$,$$} = App.U;
const S = () => App.S;
const NTQ = 32;
const MARCA_COD = {S:"ESTANDAR",L:"LIGHT",Z:"AZTECA",PS:"PILSEN",CC:"CLUB COLOMBIA",A:"AGUILA"};
const COD_MARCA = Object.fromEntries(Object.entries(MARCA_COD).map(([k,v])=>[v,k]));
const MARCAS = ["AGUILA","ESTANDAR","LIGHT","AZTECA","PILSEN","CLUB COLOMBIA"];
const CFG_DEF = {mermaFV:0.01, mermaSV:0.002, mermaEnv:0.015, factores:{A:1.94,S:1.94,Z:1.84,L:2.1,PS:1.91,CC:1.29}};
const RESPONSABLES_DEF = ["Angelo","Camilo Z.","Carlos G.","Cesar M.","Cristina E.","Fabio","Ivan","Jean C.","Jhon T.","Julian B.","Luis B.","Milton P.","Sebastian D.","Stiven R.","Yeferson T."];

/* ---------- utilidades ---------- */
const N = v => (v==null||v===""||!isFinite(+v)) ? null : +v;
const d = s => parseDT(s);
const hrs = (a,b) => { a=d(a); b=d(b); return a&&b ? (b-a)/HOUR : null; };
const dias = (a,b) => { const h=hrs(a,b); return h==null?null:h/24; };
const r1 = v => v==null?null:Math.round(v*10)/10;
const f1 = v => f(v,1), f2 = v => f(v,2), f0 = v => f(v,0);
const ahora = () => toIn(new Date());
const yr = s => (s||"").slice(0,4) || String(new Date().getFullYear());
const loteNum = l => parseInt(String(l||"").replace(/\D/g,""),10)||0;
const can = () => { if(!App.Store.canWrite){ toast("Modo de solo lectura."); return false; } return true; };
const mean = a => { a=a.filter(x=>x!=null&&isFinite(x)); return a.length?a.reduce((s,x)=>s+x,0)/a.length:null; };

/* ---------- fórmulas del Excel (Módulo1) ---------- */
const kge = (eo,vol) => (eo==null||vol==null) ? null : (((eo-0.4644)/238.4+1)*eo-0.02)*vol;
const volEqui = (k,eoEq) => k==null||eoEq==null ? null : k/((((eoEq-0.4644)/238.4)+1)*eoEq-0.02);

/* ---------- configuración y especificaciones ---------- */
function cfg(){ return Object.assign({}, CFG_DEF, (S().config||{}).cavaCfg||{}, {factores:Object.assign({},CFG_DEF.factores,((S().config||{}).cavaCfg||{}).factores||{})}); }
function espec(){ const c=(S().config||{}).espec; return (c&&c.sup)?c:(App.SEED&&App.SEED.espec)||{marcas:MARCAS,sup:{},inf:{},descanso:{}}; }
function spec(nombre,marca,lado){ const e=espec(), t=(lado==="inf"?e.inf:e.sup)||{}, k=Object.keys(t).find(x=>x.toLowerCase().startsWith(nombre.toLowerCase())); return k&&t[k]?N(t[k][marca]):null; }
const eoSup = m => spec("E.O Mosto",m,"sup"), eoInf = m => spec("E.O Mosto",m,"inf");
const rataSup = m => spec("Rata fermet",m,"sup");
const eLimDe = m => { const a=spec("E.Lim",m,"sup"), b=spec("E.Lim",m,"inf"); return a!=null&&b!=null?Math.round((a+b)/2*100)/100:(a??b); };
const tMaxFV = m => spec("Tiempo Max",m,"sup") ?? spec("Tiempo en fermentador",m,"sup");
const descanso = m => (espec().descanso||{})[m]||{};

/* ---------- datos ---------- */
function llenados(){ return Object.entries(S().llenados||{}).map(([id,x])=>Object.assign({id},x)); }
function trasiegos(){ return Object.entries(S().trasiegos||{}).map(([id,x])=>Object.assign({id},x)); }
const byInicio = (a,b) => String(b.inicio||b.ini||"").localeCompare(String(a.inicio||a.ini||""));
const llenadoId = (lote,inicio) => (String(lote).toUpperCase())+"-"+yr(inicio);
function proxLote(prefijo,y){ const p=prefijo, arr=(p==="F"?llenados():trasiegos()).filter(x=>yr(x.inicio||x.ini)===String(y)).map(x=>loteNum(x.lote)); return p+((arr.length?Math.max(...arr):0)+1); }
function findL(lote,fecha){ const L=S().llenados||{}, y=+yr(fecha), k=String(lote||"").toUpperCase(); for(const yy of [y,y-1,y+1]){ const id=k+"-"+yy; if(L[id]) return Object.assign({id},L[id]); } return null; }
function cavaDoc(tq){ return (S().cava||{})[String(tq)]||{tq:+tq,op:null}; }
function registroDe(c){ if(!c||!c.op||!c.ref) return null; return c.op==="F"?(S().llenados||{})[c.ref]:(S().trasiegos||{})[c.ref]; }
function ocupados(){ const o={}; for(let t=1;t<=NTQ;t++){ const c=cavaDoc(t); if(c.op) o[t]=c; } return o; }

/* extracto / muestras */
function muestras(L){ return (L.muestras||[]).filter(m=>m.t&&m.ext!=null).sort((a,b)=>String(a.t).localeCompare(String(b.t))); }
function ultima(L){ const m=muestras(L); return m[m.length-1]||null; }
function rataH(L){ const m=muestras(L).slice(-3); if(m.length<2||!L.fin) return null; const a=m[0], b=m[m.length-1], ha=hrs(L.fin,a.t), hb=hrs(L.fin,b.t); if(hb<=ha) return null; const sl=(b.ext-a.ext)/(hb-ha); if(sl>=0) return null; const lim=N(L.eLim)??eLimDe(L.marca); if(lim==null) return null; if(b.ext<=lim) return hb; return hb+(lim-b.ext)/sl; }
function deltaDia(L){ const m=muestras(L); if(m.length<2) return null; const a=m[m.length-2], b=m[m.length-1], h=hrs(a.t,b.t); return h>0?(a.ext-b.ext)/h*24:null; }
function rdf(L){ const u=ultima(L), eo=N(L.eo); return u&&eo?((eo-u.ext)/eo):null; }
function etapaFV(L,now=Date.now()){
  if(L.fechaFrio&&d(L.fechaFrio)<=now) return "Frío";
  if(L.fechaDescanso&&d(L.fechaDescanso)<=now) return "Descanso";
  const u=ultima(L), de=descanso(L.marca).ext; if(u&&de!=null&&u.ext<=de) return "Descanso";
  return "Fermentación";
}
function etapaSV(M,now=Date.now()){
  const h=M.fin?hrs(M.fin,now):null; if(h==null) return "Llenando";
  if(M.filtr&&M.filtr.ini&&d(M.filtr.ini)<=now) return "Filtración";
  return h>=96?"Listo":"Madurando";
}
function ocupacionDias(c,now=Date.now()){ const r=registroDe(c); if(!r) return null; const ini=r.fin||r.ini||r.inicio; return ini?dias(ini,now):null; }

/* levadura / colectores */
function colectoresLista(){ return Object.entries(S().colectores||{}).sort((a,b)=>a[0].localeCompare(b[0])).map(([id,c])=>Object.assign({id},c)); }
const posTxt = id => "C"+id.slice(1).replace("-","-P");

/* inventario (fórmulas hoja INVENTARIO) */
function inventarioFila(c){
  const g=cfg(), cod=c.marca||"S", vr=N(c.volReal)||0; if(!vr||!c.op) return {inv:0,dep:0};
  const fac=g.factores[cod]??1.94;
  let v = c.op==="F" ? vr*(1-g.mermaFV)*(1-g.mermaSV) : vr*(1-g.mermaSV);
  v = v*fac*(1-g.mermaEnv)/fac;
  return {inv:v, dep:v*fac};
}

/* ---------- sincronización del inventario de cava ---------- */
function derivarCava(tq){
  const L=llenados().filter(x=>+x.tq===+tq&&!x.vaciado).sort(byInicio)[0];
  const M=trasiegos().filter(x=>+x.tq===+tq&&!x.vaciado).sort(byInicio)[0];
  const prev=cavaDoc(tq);
  let pick=null; if(L&&M) pick=String(L.inicio)>String(M.ini)?["F",L]:["M",M]; else if(L) pick=["F",L]; else if(M) pick=["M",M];
  if(!pick) return {tq:+tq,op:null,temp:prev.temp};
  const [op,x]=pick;
  if(op==="F") return {tq:+tq,op:"F",ref:x.id,fechaLlenado:x.fin||x.inicio,marca:COD_MARCA[x.marca]||prev.marca||"S",temp:prev.temp,levadura:x.levSembrada,fechaRecoleccion:x.fechaRecup,volReal:x.vol};
  return {tq:+tq,op:"M",ref:x.id,fechaLlenado:x.fin||x.ini,marca:COD_MARCA[x.marca]||prev.marca||"S",temp:prev.temp,volReal:x.vol};
}
async function syncCava(tqs){
  const out={}; (tqs||Array.from({length:NTQ},(_,i)=>i+1)).forEach(t=>{ if(t>=1&&t<=NTQ){ const c=derivarCava(t); out[String(t)]=c; } });
  return App.Store.setMany("cava",out);
}

/* ---------- estilos ---------- */
const css=document.createElement("style"); css.id="cava-styles";
css.textContent=`
.cv{max-width:1280px}
.cv .tabs{display:flex;gap:2px;padding:3px;border-radius:980px;background:var(--sunken);flex-wrap:wrap;margin:0 0 20px;width:fit-content;max-width:100%}
.cv .tabs a{padding:8px 16px;border-radius:980px;font-size:.88rem;font-weight:500;color:var(--ink-2);text-decoration:none;white-space:nowrap}
.cv .tabs a.on{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.cv .tw{border:1px solid var(--line);border-radius:14px;background:var(--surface);overflow:auto;max-height:70vh}
.cv table{font-size:.84rem}
.cv th,.cv td{padding:9px 12px}
.cv tbody tr.clk{cursor:pointer}.cv tbody tr.clk:hover{background:var(--surface-2)}
.cv tr.vacio td{color:var(--muted)}
.cv .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.74rem;font-weight:600;background:var(--st-espera-bg);color:var(--st-espera)}
.cv .pill.ok{background:var(--st-lista-bg);color:var(--st-lista)}
.cv .pill.warn{background:var(--st-prox-bg);color:var(--st-prox)}
.cv .pill.bad{background:var(--st-vencida-bg);color:var(--st-vencida)}
.cv .pill.info{background:var(--accent-soft);color:var(--accent)}
.cv .v-ok{color:var(--st-lista);font-weight:600}.cv .v-warn{color:var(--st-prox);font-weight:600}.cv .v-bad{color:var(--st-vencida);font-weight:600}
.cv .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 14px}
.cv .bar .sp{flex:1}
.cv input.q,.cv select.q{min-height:38px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:.88rem}
.cv .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}
.cv .card-p h3{font-size:1rem;font-weight:600;margin:0 0 12px}
.cv .kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px 18px}
.cv .kv>div span{display:block;font-size:.72rem;color:var(--muted);margin-bottom:2px}
.cv .kv>div b{font-size:.95rem;font-weight:600}
.cv .nota{font-size:.8rem;color:var(--muted);margin:8px 0 0}
.cv .acts{display:flex;gap:8px;flex-wrap:wrap}
.cv svg.curva{width:100%;height:auto;max-height:300px}
.cv svg.curva text{fill:var(--muted);font-size:10px}
.cvf fieldset{border:1px solid var(--line);border-radius:12px;padding:12px 14px 14px;margin:0 0 14px}
.cvf legend{font-weight:600;font-size:.88rem;padding:0 6px}
.cvf .cocs{overflow:auto}
.cvf .cocs table{font-size:.8rem}.cvf .cocs th,.cvf .cocs td{padding:4px 5px}
.cvf .cocs input{width:92px;min-height:34px;padding:0 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}
.cvf .calc{background:var(--surface-2);border-radius:10px;padding:8px 12px;font-size:.84rem;margin-top:8px}
.cvf details summary{cursor:pointer;font-weight:600;font-size:.88rem;margin:4px 0 10px}
@media (max-width:700px){.cv .tabs{border-radius:16px}}
`;
document.head.appendChild(css);

/* ---------- componentes ---------- */
const TABS=[["informe","Informe de cava"],["llenado","Llenado FV"],["trasiego","Trasiego y maduración"],["analisis","Análisis"],["inventario","Inventario"],["merma","Merma y SAP"],["espec","Especificaciones"]];
const pill=(t,c)=>`<span class="pill ${c||""}">${esc(t)}</span>`;
const kv=(l,v)=>`<div><span>${esc(l)}</span><b>${v==null||v===""?"—":v}</b></div>`;
function limCls(v,inf,sup){ if(v==null) return ""; if(sup!=null&&v>sup) return "v-bad"; if(inf!=null&&v<inf) return "v-bad"; return "v-ok"; }
function tabsHTML(cur){ return `<nav class="tabs" aria-label="Secciones de cava">${TABS.map(([k,l])=>`<a href="#/cava/${k}" class="${cur===k?"on":""}">${l}</a>`).join("")}</nav>`; }
function header(titulo,sub,acts){ return `<div class="page-h"><div><h1>${titulo}</h1><p>${sub}</p></div>${acts?`<div class="acts">${acts}</div>`:""}</div>`; }
function tabla(head,rows,vacio){ return rows.length?`<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`:`<div class="card card-p muted">${vacio||"Sin registros."}</div>`; }
const th = (t,n) => `<th class="${n?"n":""}">${t}</th>`;
const td = (v,n,cls) => `<td class="${n?"n":""} ${cls||""}">${v==null||v===""?"—":v}</td>`;

/* campos de formulario */
function inp(name,label,o={}){
  const t=o.t||"text", v=o.v==null?"":o.v, req=o.req?"required":"";
  let el;
  if(t==="sel") el=`<select name="${name}" ${req}><option value=""></option>${(o.opts||[]).map(x=>{ const [val,lab]=Array.isArray(x)?x:[x,x]; return `<option value="${esc(val)}" ${String(val)===String(v)?"selected":""}>${esc(lab)}</option>`; }).join("")}</select>`;
  else if(t==="ta") el=`<textarea name="${name}" rows="2">${esc(v)}</textarea>`;
  else if(t==="dt") el=`<input name="${name}" type="datetime-local" value="${esc(v)}" ${req}>`;
  else if(t==="n") el=`<input name="${name}" type="number" step="${o.step||"any"}" inputmode="decimal" value="${esc(v)}" ${req} ${o.ph?`placeholder="${esc(o.ph)}"`:""}>`;
  else if(t==="pct") el=`<input name="${name}" type="number" step="any" inputmode="decimal" value="${v===""?"":Math.round(v*10000)/100}" placeholder="%" ${req}>`;
  else el=`<input name="${name}" type="text" value="${esc(v)}" ${req} ${o.ph?`placeholder="${esc(o.ph)}"`:""} ${o.up?'style="text-transform:uppercase"':""} ${o.list?`list="${o.list}"`:""}>`;
  return `<label class="f ${o.req?"req":""}" ${o.wide?'style="grid-column:1/-1"':""}><span>${esc(label)}</span>${el}${o.hint?`<small class="muted">${esc(o.hint)}</small>`:""}</label>`;
}
const G = (...c) => `<div class="fg">${c.join("")}</div>`;
const FS = (t,b) => `<fieldset><legend>${esc(t)}</legend>${b}</fieldset>`;
const rv = (fm,n,t) => { const el=fm.elements[n]; if(!el) return null; const v=el.value; if(t==="n") return num(v); if(t==="pct"){ const x=num(v); return x==null?null:(x>1?x/100:x); } if(t==="up") return v.trim().toUpperCase()||null; return v===""?null:v; };
function clean(o){ Object.keys(o).forEach(k=>{ if(o[k]==null||o[k]===""||(Array.isArray(o[k])&&!o[k].length)) delete o[k]; }); return o; }
function respOpts(){ return RESPONSABLES_DEF; }
function csvDescarga(nombre,filas){ const txt="﻿"+filas.map(r=>r.map(v=>{ v=v==null?"":String(v); return /[",;\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }).join(";")).join("\n"); const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([txt],{type:"text/csv;charset=utf-8"})); a.download=nombre; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500); }

/* ============================================================
   VISTAS
   ============================================================ */
let st={mes:"",marca:"",q:"",sub:"fer"};

/* ----- INFORME DE CAVA ----- */
function vInforme(){
  const now=Date.now(), occ=ocupados(), rows=[], fvs=[], svs=[];
  let volTotal=0, alertas=[];
  for(let t=1;t<=NTQ;t++){
    const c=cavaDoc(t), r=registroDe(c);
    if(!c.op||!r){ rows.push(`<tr class="vacio"><td><b>${t}</b></td><td colspan="14">Vacío${c.op&&!r?" (referencia no encontrada)":""}</td><td><button class="btn sm" data-nuevo-tq="${t}" type="button">Llenar</button></td></tr>`); continue; }
    const op=c.op, marca=r.marca||MARCA_COD[c.marca], vol=N(r.vol)||N(c.volReal);
    volTotal+=vol||0;
    if(op==="F"){
      fvs.push(r);
      const u=ultima(r), oc=ocupacionDias(c,now), tmax=tMaxFV(marca), lim=N(r.eLim)??eLimDe(marca), et=etapaFV(r,now), rh=rataH(r);
      const eoC=limCls(N(r.eo),eoInf(marca),eoSup(marca)), ocH=oc!=null?oc*24:null;
      const ocC=tmax&&ocH!=null&&ocH>tmax?"v-bad":"";
      if(ocC) alertas.push(`FV ${t} (${r.lote}) supera el tiempo máximo en FV (${f0(ocH)} h > ${tmax} h)`);
      if(u==null&&hrs(r.fin,now)>26&&r.fin) alertas.push(`FV ${t} (${r.lote}) sin muestreo después de ${f0(hrs(r.fin,now))} h`);
      rows.push(`<tr class="clk" data-go="cava/llenado/${esc(c.ref)}"><td><b>${t}</b></td><td>${esc(r.lote)}</td><td>${pill("FV","info")}</td><td>${esc(marca)}</td><td class="n">${f0(vol)}</td><td>${fmtS(r.fin)}</td><td class="n ${ocC}">${oc!=null?f1(oc):"—"}</td><td>${pill(et,et==="Frío"?"info":et==="Descanso"?"warn":"ok")}</td><td class="n">${f2(lim)}</td><td>${u?fmtS(u.t):"—"}</td><td class="n">${u?f2(u.ext):"—"}</td><td class="n">${u&&u.ph?f2(u.ph):"—"}</td><td class="n">${rh!=null?f0(rh):"—"}</td><td class="n">${r.rec3h?f1(r.rec3h/1e6):"—"}</td><td>${r.fechaFrio?fmtS(r.fechaFrio):"—"}</td></tr>`);
    } else {
      svs.push(r);
      const et=etapaSV(r,now), oc=r.fin?dias(r.fin,now):null, fv=(r.fvs||[]).map(x=>x.lote).filter(Boolean).join(" + ");
      rows.push(`<tr class="clk" data-go="cava/trasiego/${esc(c.ref)}"><td><b>${t}</b></td><td>${esc(r.lote)}</td><td>${pill("SV","warn")}</td><td>${esc(marca)}</td><td class="n">${f0(vol)}</td><td>${fmtS(r.fin)}</td><td class="n">${oc!=null?f1(oc):"—"}</td><td>${pill(et,et==="Listo"?"ok":et==="Filtración"?"info":"warn")}</td><td>FV ${esc(fv||"—")}</td><td>${r.purgas&&r.purgas.length?fmtS(r.purgas[r.purgas.length-1].t):"—"}</td><td class="n">${r.purgas?r.purgas.length:0}</td><td class="n">${r.phFin?f2(r.phFin):"—"}</td><td class="n">${r.fvs&&r.fvs[0]&&r.fvs[0].tFV?f0(r.fvs[0].tFV/24)+" d":"—"}</td><td></td><td></td></tr>`);
    }
  }
  const libres=NTQ-Object.keys(occ).length;
  const kp=[App.C.kpi({label:"FV en fermentación",value:fvs.length,color:"var(--accent)",sub:"tanques fermentando",go:"cava/llenado"}),
    App.C.kpi({label:"SV en maduración",value:svs.length,color:"var(--st-prox)",sub:"tanques madurando",go:"cava/trasiego"}),
    App.C.kpi({label:"Tanques vacíos",value:libres,color:"var(--st-espera)",sub:"de "+NTQ+" UTQ",go:"cava/inventario"}),
    App.C.kpi({label:"Volumen en cava",value:f0(volTotal),color:"var(--st-lista)",sub:"hectolitros en tanques"}),
    App.C.kpi({label:"Alertas",value:alertas.length,color:alertas.length?"var(--st-vencida)":"var(--st-lista)",sub:alertas.length?"revisar abajo":"todo en rango"})].join("");
  return `${header("Informe de cava","Estado de los "+NTQ+" tanques: fermentadores (FV) y maduradores (SV). Equivale a la hoja INFORME CAVA del Excel.",`<button class="btn" type="button" id="cvCsv">Exportar CSV</button><button class="btn pri" type="button" data-nuevo>＋ Nuevo llenado</button>`)}
  ${tabsHTML("informe")}
  <div class="kpis sec">${kp}</div>
  ${alertas.length?`<div class="card card-p sec"><b>Alertas</b><ul style="margin:8px 0 0 18px">${alertas.slice(0,10).map(a=>`<li>${esc(a)}</li>`).join("")}</ul></div>`:""}
  <div class="tw"><table><thead><tr>${th("TQ")}${th("Cons.")}${th("FV/SV")}${th("Marca")}${th("Vol (Hl)",1)}${th("Fin llenado")}${th("Ocupación (d)",1)}${th("Etapa")}${th("E.Lím (°P) / FV origen")}${th("Último muestreo / purga")}${th("Ext. actual (°P) / # purgas",1)}${th("pH",1)}${th("Rata (h) / FCT",1)}${th("Rec. 3 h (M/mL)",1)}${th("Fecha frío")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>
  <p class="nota">FV: rata = horas estimadas hasta el extracto límite (proyección con las últimas muestras). SV: FCT = ciclo de fermentación en días. Toque una fila para abrir el registro.</p>`;
}
function mInforme(){
  $$("#view [data-nuevo]").forEach(b=>b.onclick=()=>llenadoForm());
  $$("#view [data-nuevo-tq]").forEach(b=>b.onclick=()=>llenadoForm(null,+b.dataset.nuevoTq));
  const c=$("#cvCsv"); if(c) c.onclick=()=>{ const filas=[["TQ","Consecutivo","Operación","Marca","Vol (Hl)","Fin llenado","Ocupación (d)","Etapa"]]; for(let t=1;t<=NTQ;t++){ const cv=cavaDoc(t), r=registroDe(cv); if(!r){ filas.push([t,"","Vacío"]); continue; } filas.push([t,r.lote,cv.op==="F"?"FV":"SV",r.marca||"",r.vol||"",r.fin||"",r1(ocupacionDias(cv)),cv.op==="F"?etapaFV(r):etapaSV(r)]); } csvDescarga("informe_cava_"+toIn(new Date()).slice(0,10)+".csv",filas); };
}

/* ----- LLENADO FV: lista ----- */
function vLlenadoLista(){
  const meses=[...new Set(llenados().map(x=>(x.inicio||"").slice(0,7)).filter(Boolean))].sort().reverse();
  let L=llenados().sort(byInicio);
  if(st.mes) L=L.filter(x=>(x.inicio||"").startsWith(st.mes));
  if(st.marca) L=L.filter(x=>x.marca===st.marca);
  if(st.q){ const q=st.q.toUpperCase(); L=L.filter(x=>[x.lote,x.tq,x.marca,x.levSembrada].join(" ").toUpperCase().includes(q)); }
  const abiertos=L.filter(x=>!x.vaciado).length;
  const rows=L.slice(0,st.max||80).map(x=>{ const u=ultima(x); const lim=N(x.eLim)??eLimDe(x.marca); return `<tr class="clk ${x.vaciado?"vacio":""}" data-go="cava/llenado/${esc(x.id)}"><td><b>${esc(x.lote)}</b></td><td class="n">${x.tq}</td><td>${esc(x.marca)}</td><td>${fmtS(x.inicio)}</td><td>${fmtS(x.fin)}</td><td class="n">${x.tLlenado!=null?f1(x.tLlenado):"—"}</td><td class="n">${f0(x.vol)}</td><td class="n ${limCls(N(x.eo),eoInf(x.marca),eoSup(x.marca))}">${f2(x.eo)}</td><td>${esc(x.levSembrada||"—")}</td><td class="n">${x.viab!=null?pc(x.viab):"—"}</td><td class="n">${u?f2(u.ext):"—"}</td><td>${x.vaciado?pill("Trasegado"):pill("En FV","info")}</td></tr>`; });
  return `${header("Llenado de FV","Recibo de mosto, cocimientos, levadura sembrada y muestreo de cada fermentador. Equivale a la hoja REGISTRO FV y a la base B.D FERMENTACIÓN.",`<button class="btn pri" type="button" data-nuevo>＋ Nuevo llenado</button>`)}
  ${tabsHTML("llenado")}
  <div class="bar"><input class="q" id="cvQ" type="search" placeholder="Buscar lote, FV, marca, levadura" value="${esc(st.q)}"><select class="q" id="cvMes"><option value="">Todos los meses</option>${meses.map(m=>`<option ${st.mes===m?"selected":""}>${m}</option>`).join("")}</select><select class="q" id="cvMarca"><option value="">Todas las marcas</option>${MARCAS.map(m=>`<option ${st.marca===m?"selected":""}>${m}</option>`).join("")}</select><span class="sp"></span><span class="muted small">${L.length} llenados · ${abiertos} en FV</span></div>
  ${tabla([th("Lote"),th("FV",1),th("Marca"),th("Inicio"),th("Fin"),th("T. llenado (h)",1),th("Vol (Hl)",1),th("E.O (°P)",1),th("Levadura"),th("Viab.",1),th("Últ. ext.",1),th("Estado")].join(""),rows,"No hay llenados registrados. Use «Nuevo llenado» o cargue los datos del Excel.")}
  ${L.length>(st.max||80)?`<div style="text-align:center;margin-top:12px"><button class="btn" id="cvMas">Mostrar más</button></div>`:""}`;
}
function bindFiltros(){
  const q=$("#cvQ"); if(q) q.onchange=()=>{ st.q=q.value; App.render(true); };
  const m=$("#cvMes"); if(m) m.onchange=()=>{ st.mes=m.value; App.render(true); };
  const k=$("#cvMarca"); if(k) k.onchange=()=>{ st.marca=k.value; App.render(true); };
  const mas=$("#cvMas"); if(mas) mas.onclick=()=>{ st.max=(st.max||80)+120; App.render(true); };
  $$("#view [data-nuevo]").forEach(b=>b.onclick=()=>{ const t=App.V.cava._tab; if(t==="trasiego") trasiegoForm(); else llenadoForm(); });
}

/* curva de fermentación */
function curvaSVG(L){
  const m=muestras(L); if(!m.length||!L.fin) return `<p class="muted small">Sin muestras registradas todavía.</p>`;
  const pts=m.map(x=>({h:hrs(L.fin,x.t),e:x.ext})).filter(p=>p.h!=null);
  if(N(L.eo)) pts.unshift({h:0,e:+L.eo});
  const lim=N(L.eLim)??eLimDe(L.marca), W=640,H=260,P={l:42,r:14,t:12,b:30};
  const hmax=Math.max(24,...pts.map(p=>p.h))*1.05, emax=Math.max(...pts.map(p=>p.e),lim||0)*1.05+0.5, emin=0;
  const X=h=>P.l+h/hmax*(W-P.l-P.r), Y=e=>H-P.b-(e-emin)/(emax-emin)*(H-P.t-P.b);
  let g=""; for(let i=0;i<=4;i++){ const e=emin+(emax-emin)*i/4; g+=`<line x1="${P.l}" x2="${W-P.r}" y1="${Y(e)}" y2="${Y(e)}" stroke="var(--line)"/><text x="${P.l-6}" y="${Y(e)+3}" text-anchor="end">${f0(e)}</text>`; }
  for(let i=0;i<=5;i++){ const h=hmax*i/5; g+=`<text x="${X(h)}" y="${H-10}" text-anchor="middle">${f0(h)} h</text>`; }
  const path=pts.map((p,i)=>(i?"L":"M")+X(p.h).toFixed(1)+" "+Y(p.e).toFixed(1)).join(" ");
  return `<svg class="curva" viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva de extracto">${g}${lim!=null?`<line x1="${P.l}" x2="${W-P.r}" y1="${Y(lim)}" y2="${Y(lim)}" stroke="var(--st-prox)" stroke-dasharray="5 4"/><text x="${W-P.r}" y="${Y(lim)-4}" text-anchor="end">E.Lím ${f2(lim)}</text>`:""}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>${pts.map(p=>`<circle cx="${X(p.h)}" cy="${Y(p.e)}" r="3.2" fill="var(--accent)"><title>${f1(p.h)} h · ${f2(p.e)} °P</title></circle>`).join("")}</svg>`;
}

/* ----- LLENADO FV: detalle ----- */
function vLlenadoDetalle(id){
  const L0=(S().llenados||{})[id]; if(!L0) return `${header("Llenado no encontrado","",`<a class="btn" href="#/cava/llenado">Volver</a>`)}<div class="card card-p">No existe el registro ${esc(id)}.</div>`;
  const L=Object.assign({id},L0), u=ultima(L), tr=L.trasiego?(S().trasiegos||{})[L.trasiego]:null, t=(S().tanques||{})[L.lote];
  const cocs=(L.cocs||[]).map((c,i)=>`<tr><td>${i+1}</td>${td(c.coc)}${td(c.temp!=null?f1(c.temp):null,1)}${td(c.vol!=null?f0(c.vol):null,1)}${td(c.eo!=null?f2(c.eo):null,1)}${td(c.o2ppm!=null?f2(c.o2ppm):(c.aire!=null?f2(c.aire):null),1)}${td(c.lev!=null?f2(c.lev):null,1)}${td(c.o2kgh!=null?f1(c.o2kgh):null,1)}${td(c.med1!=null?f2(c.med1):null,1)}${td(c.med2!=null?f2(c.med2):null,1)}${td(disp(c)!=null?pc(disp(c)):null,1)}</tr>`);
  const ms=muestras(L).map(m=>`<tr><td>${fmt(m.t)}</td>${td(m.h!=null?f1(m.h):f1(hrs(L.fin,m.t)),1)}${td(f2(m.ext),1)}${td(m.ph!=null?f2(m.ph):null,1)}${td(m.temp!=null?f1(m.temp):null,1)}${td(m.resp)}</tr>`);
  const eo=N(L.eo), marca=L.marca;
  return `${header(`FV ${L.tq} · ${esc(L.lote)}`,`${esc(marca)} · llenado ${fmtS(L.inicio)} → ${fmtS(L.fin)}`,`<a class="btn" href="#/cava/llenado">‹ Lista</a>${can0()?`<button class="btn" data-ed>Editar</button><button class="btn" data-mue>＋ Muestra</button>${!L.fin?`<button class="btn" data-fin>Finalizar llenado</button>`:""}${!L.vaciado?`<button class="btn pri" data-tras>Trasegar a SV</button>`:""}`:""}`)}
  ${tabsHTML("llenado")}
  <div class="kpis sec">${App.C.kpi({label:"Estado",value:L.vaciado?"Trasegado":"En FV",color:L.vaciado?"var(--st-espera)":"var(--accent)",sub:L.vaciado?"a "+(tr?`SV ${tr.tq} · ${tr.lote}`:fmtS(L.vaciado)):etapaFV(L)})}${App.C.kpi({label:"Volumen",value:f0(L.vol)+" Hl",color:"var(--st-lista)",sub:(L.nCoc||(L.cocs||[]).length)+" cocimientos"})}${App.C.kpi({label:"Extracto original",value:eo!=null?f2(eo)+" °P":"—",color:eo==null?"var(--faint)":limCls(eo,eoInf(marca),eoSup(marca))==="v-ok"?"var(--st-lista)":"var(--st-vencida)",sub:"rango "+f2(eoInf(marca))+" – "+f2(eoSup(marca))})}${App.C.kpi({label:"Último extracto",value:u?f2(u.ext)+" °P":"—",color:"var(--accent)",sub:u?fmtS(u.t):"sin muestras"})}${App.C.kpi({label:"Atenuación",value:rdf(L)!=null?pc(rdf(L)):"—",color:"var(--st-prox)",sub:deltaDia(L)!=null?f2(deltaDia(L))+" °P/día":""})}</div>
  <div class="grid2 sec">
   <div class="card card-p"><h3>Recibo de mosto</h3><div class="kv">${kv("Tanque (UTQ)",L.tq)}${kv("Marca",esc(L.marca))}${kv("Inicio llenado",fmt(L.inicio))}${kv("Fin llenado",fmt(L.fin))}${kv("Tiempo de llenado (h)",L.tLlenado!=null?f1(L.tLlenado):(L.fin?f1(hrs(L.inicio,L.fin)):null))}${kv("Presión inicio FV (PSI)",L.presion!=null?f2(L.presion):null)}${kv("Inicio aireación",fmt(L.aireIni))}${kv("Fin aireación",fmt(L.aireFin))}${kv("DYA (min)",L.aireIni&&L.aireFin?f0(hrs(L.aireIni,L.aireFin)*60):null)}${kv("O₂ ponderado (ppm)",L.o2!=null?f2(L.o2):null)}${kv("pH mosto",L.phMosto!=null?f2(L.phMosto):null)}${kv("Amargo (BU)",L.amargo!=null?f1(L.amargo):null)}${kv("Color (EBC)",L.color!=null?f1(L.color):null)}${kv("E. límite (°P)",f2(N(L.eLim)??eLimDe(marca)))}${kv("PNC",esc(L.pnc||"No"))}</div></div>
   <div class="card card-p"><h3>Levadura sembrada</h3><div class="kv">${kv("Levadura",esc(L.levSembrada))}${kv("Generación",L.gen)}${kv("Colector",L.colector)}${kv("UTQ origen",L.utqOrigen)}${kv("Recuperada",fmt(L.fechaRecup))}${kv("Tiempo de resiembra (h)",L.fechaRecup||L.t0?f1(hrs(L.t0||L.fechaRecup,L.inicio)):null)}${kv("Viabilidad",L.viab!=null?pc(L.viab):null)}${kv("Consistencia",L.cons!=null?pc(L.cons):null)}${kv("pH",L.ph!=null?f2(L.ph):null)}${kv("Temp. siembra (°C)",L.tempSiembra!=null?f1(L.tempSiembra):null)}${kv("Levadura total (MMcel)",L.levTotal!=null?f2(L.levTotal):null)}${kv("Factor dosificación",L.factorDosis!=null?f(L.factorDosis,4):null)}</div></div>
  </div>
  <div class="card card-p sec"><h3>Cocimientos</h3>${tabla([th("#"),th("Coc."),th("Temp (°C)",1),th("Vol (Hl)",1),th("Ext. mosto (°P)",1),th("O₂ (ppm)",1),th("Lev. (MMcel)",1),th("O₂ (kg/h)",1),th("Aire 1",1),th("Aire 2",1),th("Dispersión",1)].join(""),cocs,"Sin cocimientos registrados.")}</div>
  <div class="grid2 sec">
   <div class="card card-p"><h3>Curva de fermentación</h3>${curvaSVG(L)}</div>
   <div class="card card-p"><h3>Muestreo</h3>${tabla([th("Fecha y hora"),th("Horas",1),th("Ext. (°P)",1),th("pH",1),th("Temp",1),th("Resp.")].join(""),ms,"Sin muestras.")}</div>
  </div>
  <div class="card card-p sec"><h3>Control de calidad</h3><div class="kv">${kv("Recuento a 3 h (M cel/mL)",L.rec3h!=null?f1(L.rec3h/1e6):null)}${kv("Fecha recuento",fmt(L.fechaRec3h))}${kv("KPI higiénico",fmt(L.kpiHig))}${kv("Extracto 72 h (°P)",L.ea72!=null?f2(L.ea72):null)}${kv("Muestra 72 h",fmt(L.fechaMuestra72))}${kv("Descanso diacetilo",fmt(L.fechaDescanso))}${kv("Puesta en frío",fmt(L.fechaFrio))}${kv("Observaciones",esc(L.obs||"Sin observaciones"))}</div>
   ${t&&t.retiro?`<p class="nota">Retiro de levadura registrado en el monitor: ${fmt(t.retiro.fecha)} ${esc(t.retiro.destino||"")}.</p>`:""}
   ${t&&!t.retiro?`<div class="acts" style="margin-top:12px"><a class="btn sm" href="#/tanque/${esc(L.lote)}">Abrir en monitor de tanques</a></div>`:""}</div>`;
}
const can0 = () => App.Store.canWrite;
function disp(c){ return c.med1&&c.med2!=null?Math.abs(c.med1-c.med2)/c.med1:null; }
function mLlenadoDetalle(id){
  const L=(S().llenados||{})[id]; if(!L) return;
  const q=s=>$("#view "+s);
  if(q("[data-ed]")) q("[data-ed]").onclick=()=>llenadoForm(id);
  if(q("[data-mue]")) q("[data-mue]").onclick=()=>muestraModal(id);
  if(q("[data-tras]")) q("[data-tras]").onclick=()=>trasiegoForm(null,id);
  if(q("[data-fin]")) q("[data-fin]").onclick=()=>finalizarLlenado(id);
}

/* ============================================================
   FORMULARIO DE LLENADO (REGISTRO FV)
   ============================================================ */
function cocRow(i,c){ c=c||{}; const n=(k,w)=>`<td><input name="c${i}_${k}" type="${w||"number"}" step="any" inputmode="decimal" value="${c[k]==null?"":esc(c[k])}"></td>`;
  return `<tr><td>${i+1}</td>${n("coc","text")}${n("temp")}${n("vol")}${n("eo")}${n("o2ppm")}${n("lev")}${n("o2kgh")}${n("med1")}${n("med2")}<td class="dsp" data-dsp="${i}">—</td></tr>`; }
function llenadoForm(id,tqPre){
  if(!can()) return;
  const L=id?clone(S().llenados[id]):{}, nuevo=!id, y=new Date().getFullYear();
  const oc=ocupados(), libres=[]; for(let t=1;t<=NTQ;t++) if(!oc[t]||(!nuevo&&+L.tq===t)) libres.push(t);
  const cols=colectoresLista();
  const cocs=Array.from({length:5},(_,i)=>(L.cocs||[])[i]);
  const body=`<div class="cvf">
   ${FS("Recibo de mosto",G(
     inp("tq","Tanque (UTQ)",{t:"sel",req:1,v:L.tq??tqPre,opts:libres}),
     inp("marca","Marca",{t:"sel",req:1,v:L.marca,opts:MARCAS}),
     inp("lote","Consecutivo",{req:1,v:L.lote||proxLote("F",y),up:1}),
     inp("inicio","Inicio llenado",{t:"dt",req:1,v:L.inicio||ahora()}),
     inp("fin","Fin llenado",{t:"dt",v:L.fin,hint:"Déjelo vacío si el tanque sigue llenándose"}),
     inp("presion","Presión inicio FV (PSI)",{t:"n",v:L.presion,hint:"Debe ser ≤ 2,5 PSI"}),
     inp("aireIni","Inicio aireación",{t:"dt",v:L.aireIni}),
     inp("aireFin","Fin aireación",{t:"dt",v:L.aireFin}),
     inp("pnc","PNC (producto no conforme)",{t:"sel",v:L.pnc||"",opts:["SI","NO"]})))}
   ${FS("Levadura sembrada",`${cols.length?G(inp("colId","Levadura en colector",{t:"sel",wide:1,v:L.colId,opts:cols.map(c=>[c.id,`${posTxt(c.id)}: ${c.nombre} · gen ${c.generacion??"?"} · ${f0(c.vol)} Hl · viab ${pc(c.viab)}`])})):`<p class="muted small">No hay levadura en colectores: escríbala a mano.</p>`}${G(
     inp("levSembrada","Nombre de la levadura",{v:L.levSembrada,up:1,ph:"Ej.: EK7F1"}),
     inp("gen","Generación",{t:"n",v:L.gen}),inp("colector","Colector",{t:"n",v:L.colector}),inp("utqOrigen","UTQ origen",{t:"n",v:L.utqOrigen}),
     inp("fechaRecup","Fecha de recuperación (T0)",{t:"dt",v:L.fechaRecup||L.t0}),
     inp("viab","Viabilidad (%)",{t:"pct",v:L.viab}),inp("cons","Consistencia (%)",{t:"pct",v:L.cons}),inp("ph","pH levadura",{t:"n",v:L.ph}),
     inp("tempSiembra","Temp. levadura (°C)",{t:"n",v:L.tempSiembra,hint:"Objetivo 3–4 °C"}),
     nuevo?inp("hl","Hl sembrados (se descuentan del colector)",{t:"n"}):"")}<div class="calc" id="cvResiembra">Tiempo de resiembra: —</div>`)}
   ${FS("Cocimientos (hasta 5)",`<div class="cocs"><table><thead><tr><th>#</th><th>Coc.</th><th>Temp °C</th><th>Vol Hl</th><th>Ext. °P</th><th>O₂ ppm</th><th>Lev. MMcel</th><th>O₂ kg/h</th><th>Aire 1 kg/Hl</th><th>Aire 2 kg/Hl</th><th>Disp.</th></tr></thead><tbody>${cocs.map((c,i)=>cocRow(i,c)).join("")}</tbody></table></div><div class="calc" id="cvPond">Ponderado: —</div>
     ${G(inp("phMosto","pH mosto",{t:"n",v:L.phMosto}),inp("amargo","Amargo (BU)",{t:"n",v:L.amargo}),inp("color","Color (EBC)",{t:"n",v:L.color}),inp("eLim","Extracto límite (°P)",{t:"n",v:L.eLim,hint:"Si lo deja vacío se toma de las especificaciones"}))}`)}
   ${FS("Calidad y observaciones",G(
     inp("fechaRec3h","Fecha recuento 3 h",{t:"dt",v:L.fechaRec3h}),inp("rec3h","Recuento a 3 h (cel/mL)",{t:"n",v:L.rec3h,hint:"Ej.: 15000000"}),
     inp("kpiHig","KPI higiénico (fecha)",{t:"dt",v:L.kpiHig}),inp("fechaMuestra72","Fecha muestra 72 h",{t:"dt",v:L.fechaMuestra72}),inp("ea72","Extracto 72 h (°P)",{t:"n",v:L.ea72}),
     inp("fechaDescanso","Inicio descanso de diacetilo",{t:"dt",v:L.fechaDescanso}),inp("fechaFrio","Puesta en frío",{t:"dt",v:L.fechaFrio}),
     inp("obs","Observaciones",{t:"ta",wide:1,v:L.obs})))}
  </div>`;
  App.UI.modal(nuevo?"Nuevo llenado de FV":"Editar llenado "+L.lote,body,{wide:true,ok:nuevo?"Registrar llenado":"Guardar cambios",
    onOpen(fm){
      const calc=()=>{ // ponderados, dispersión, tiempo de resiembra
        let vt=0,eo=0,o2=0,o2v=0,lev=0,nc=0;
        for(let i=0;i<5;i++){ const v=rv(fm,`c${i}_vol`,"n"), e=rv(fm,`c${i}_eo`,"n"), o=rv(fm,`c${i}_o2ppm`,"n"), a=rv(fm,`c${i}_med1`,"n"), b=rv(fm,`c${i}_med2`,"n"), l=rv(fm,`c${i}_lev`,"n");
          const dc=fm.querySelector(`[data-dsp="${i}"]`); if(dc) dc.textContent=a&&b!=null?pc(Math.abs(a-b)/a):"—";
          if(v){ vt+=v; nc++; if(e!=null) eo+=v*e; if(o!=null){ o2+=v*o; o2v+=v; } } if(l) lev+=l; }
        fm.querySelector("#cvPond").innerHTML=`Ponderado FV: <b>${nc}</b> cocimientos · <b>${f0(vt)}</b> Hl · E.O <b>${vt?f2(eo/vt):"—"}</b> °P · O₂ <b>${o2v?f2(o2/o2v):"—"}</b> ppm · Levadura <b>${f2(lev)}</b> MMcel`;
        const ini=rv(fm,"inicio"), rec=rv(fm,"fechaRecup"), h=hrs(rec,ini);
        fm.querySelector("#cvResiembra").innerHTML="Tiempo de resiembra: "+(h!=null?`<b class="${h<=48&&h>=0?"v-ok":"v-bad"}">${f1(h)} h</b> (objetivo 0–48 h)`:"—");
      };
      fm.addEventListener("input",calc); fm.addEventListener("change",e=>{
        if(e.target.name==="colId"&&e.target.value){ const c=S().colectores[e.target.value]; if(c){ const set=(n,v)=>{ if(fm.elements[n]&&v!=null) fm.elements[n].value=v; };
          set("levSembrada",c.nombre); set("gen",c.generacion); set("colector",e.target.value.slice(1).split("-")[0]); set("utqOrigen",c.tq); set("fechaRecup",c.t0||c.finRemocion||c.retiro);
          set("viab",c.viab!=null?Math.round(c.viab*10000)/100:null); set("cons",c.cons!=null?Math.round(c.cons*10000)/100:null); set("ph",c.ph); if(!rv(fm,"marca")&&c.marca) fm.elements.marca.value=c.marca; calc(); } }
        if(e.target.name==="marca"&&!rv(fm,"eLim")){ const m=rv(fm,"marca"); fm.elements.eLim.placeholder=f2(eLimDe(m)); } });
      calc();
    },
    async onSubmit(fm,showErr){
      const tq=rv(fm,"tq","n"), marca=rv(fm,"marca"), lote=rv(fm,"lote","up"), inicio=rv(fm,"inicio"), fin=rv(fm,"fin");
      if(!tq||!marca||!lote||!inicio){ showErr("Complete tanque, marca, consecutivo e inicio de llenado."); return false; }
      if(fin&&hrs(inicio,fin)<0){ showErr("El fin de llenado es anterior al inicio."); return false; }
      const nid=nuevo?llenadoId(lote,inicio):id;
      if(nuevo&&S().llenados[nid]){ showErr("Ya existe el consecutivo "+lote+" en "+yr(inicio)+"."); return false; }
      if(nuevo&&oc[tq]){ showErr("El tanque "+tq+" está ocupado."); return false; }
      const cocsN=[]; let vt=0,eo=0,o2=0,o2v=0,lev=0;
      for(let i=0;i<5;i++){ const c=clean({coc:rv(fm,`c${i}_coc`),temp:rv(fm,`c${i}_temp`,"n"),vol:rv(fm,`c${i}_vol`,"n"),eo:rv(fm,`c${i}_eo`,"n"),o2ppm:rv(fm,`c${i}_o2ppm`,"n"),lev:rv(fm,`c${i}_lev`,"n"),o2kgh:rv(fm,`c${i}_o2kgh`,"n"),med1:rv(fm,`c${i}_med1`,"n"),med2:rv(fm,`c${i}_med2`,"n")});
        if(!Object.keys(c).length) continue; cocsN.push(Object.assign({ok:"OK"},c)); if(c.vol){ vt+=c.vol; if(c.eo!=null) eo+=c.vol*c.eo; if(c.o2ppm!=null){ o2+=c.vol*c.o2ppm; o2v+=c.vol; } } if(c.lev) lev+=c.lev; }
      const colId=rv(fm,"colId"), o=Object.assign({},L,clean({
        lote,tq,marca,inicio,fin,presion:rv(fm,"presion","n"),aireIni:rv(fm,"aireIni"),aireFin:rv(fm,"aireFin"),pnc:rv(fm,"pnc"),
        levSembrada:rv(fm,"levSembrada","up"),gen:rv(fm,"gen","n"),colector:rv(fm,"colector","n"),utqOrigen:rv(fm,"utqOrigen","n"),fechaRecup:rv(fm,"fechaRecup"),
        viab:rv(fm,"viab","pct"),cons:rv(fm,"cons","pct"),ph:rv(fm,"ph","n"),tempSiembra:rv(fm,"tempSiembra","n"),
        cocs:cocsN,nCoc:cocsN.length,vol:vt||L.vol,eo:vt&&eo?Math.round(eo/vt*100)/100:L.eo,o2:o2v?Math.round(o2/o2v*100)/100:L.o2,levTotal:lev||L.levTotal,
        tLlenado:fin?r1(hrs(inicio,fin)*10)/10:null,phMosto:rv(fm,"phMosto","n"),amargo:rv(fm,"amargo","n"),color:rv(fm,"color","n"),eLim:rv(fm,"eLim","n"),
        fechaRec3h:rv(fm,"fechaRec3h"),rec3h:rv(fm,"rec3h","n"),kpiHig:rv(fm,"kpiHig"),fechaMuestra72:rv(fm,"fechaMuestra72"),ea72:rv(fm,"ea72","n"),
        fechaDescanso:rv(fm,"fechaDescanso"),fechaFrio:rv(fm,"fechaFrio"),obs:rv(fm,"obs")}));
      if(colId) o.colId=colId;
      if(!await App.Store.set("llenados",nid,o)) return false;
      await syncCava([tq].concat(L.tq&&+L.tq!==tq?[+L.tq]:[]));
      if(o.fin) await crearTanqueMonitor(nid,o,nuevo?rv(fm,"hl","n"):null);
      toast(nuevo?"Llenado "+lote+" registrado":"Cambios guardados"); App.go("cava/llenado/"+nid); App.render(true); return true;
    }});
}
/* Crea / actualiza el tanque en el monitor de levadura (T0, retiro, colectores) */
async function crearTanqueMonitor(id,o,hl){
  const exist=S().tanques&&S().tanques[o.lote];
  const t=Object.assign({},exist||{},{tq:o.tq,marca:o.marca,fin:o.fin,lote:o.lote,eo:o.eo,eLim:N(o.eLim)??eLimDe(o.marca),muestras:muestras(o).map(m=>({t:m.t,ext:m.ext}))});
  if(!exist) t.creado=new Date().toISOString();
  if(o.levSembrada&&!t.levadura){ const c=o.colId&&S().colectores[o.colId]; t.levadura=clean({nombre:o.levSembrada,generacion:o.gen,origen:c?"colector":"otro",colectorId:c?o.colId:null,colector:o.colector!=null?String(o.colector):null,levId:c?c.levId:null,viab:o.viab,cons:o.cons,ph:o.ph}); }
  await App.Store.set("tanques",o.lote,t);
  if(!exist&&hl&&o.colId&&S().colectores[o.colId]){ const c=clone(S().colectores[o.colId]); c.vol=Math.round((c.vol-hl)*100)/100;
    if(c.levId&&S().bdlev[c.levId]){ const b=clone(S().bdlev[c.levId]); b.siembras=(b.siembras||[]).concat([{tq:String(o.tq),lote:o.lote,fecha:o.fin,hl,colector:o.colId}]); await App.Store.set("bdlev",c.levId,b); }
    if(c.vol<=0&&App.Act.archivarPosicion){ await App.Act.archivarPosicion(o.colId,c,"Sembrada (volumen agotado) en FV "+o.tq); await App.Store.del("colectores",o.colId); } else await App.Store.set("colectores",o.colId,c); }
}
async function finalizarLlenado(id){
  const L=clone(S().llenados[id]);
  App.UI.modal("Finalizar llenado "+L.lote,G(inp("fin","Fin de llenado",{t:"dt",req:1,v:ahora()})),{ok:"Finalizar",async onSubmit(fm,err){ const fin=rv(fm,"fin"); if(hrs(L.inicio,fin)<0){ err("El fin es anterior al inicio."); return false; } L.fin=fin; L.tLlenado=r1(hrs(L.inicio,fin)*10)/10; if(!await App.Store.set("llenados",id,L)) return false; await syncCava([L.tq]); await crearTanqueMonitor(id,L,null); App.render(true); return true; }});
}

/* ---------- muestra de extracto / pH ---------- */
function muestraModal(id){
  if(!can()) return; const L=clone(S().llenados[id]); const u=ultima(L);
  App.UI.modal(`Agregar muestra · FV ${L.tq} · ${L.lote}`,`<p class="small muted" style="margin:0 0 12px">${esc(L.marca)} · E.O ${f2(L.eo)} °P${u?` · último ${f2(u.ext)} °P (${fmtS(u.t)})`:""}</p>`+G(
    inp("ext","Extracto (°P)",{t:"n",req:1,wide:1}),inp("t","Fecha y hora",{t:"dt",req:1,v:ahora()}),inp("ph","pH",{t:"n"}),inp("temp","Temperatura (°C)",{t:"n"}),inp("resp","Responsable",{list:"cvResp"}))+`<datalist id="cvResp">${respOpts().map(r=>`<option value="${esc(r)}">`).join("")}</datalist><div id="cvAv"></div>`,{ok:"Guardar muestra",
    onOpen(fm){ fm.addEventListener("input",()=>{ const e=rv(fm,"ext","n"), w=[]; if(e!=null&&N(L.eo)&&e>L.eo) w.push("El extracto supera el extracto original."); if(e!=null&&u&&e>u.ext+0.3) w.push("El extracto subió respecto a la muestra anterior."); const t=rv(fm,"t"); if(t&&L.fin&&hrs(L.fin,t)<0) w.push("La fecha es anterior al fin de llenado."); fm.querySelector("#cvAv").innerHTML=w.length?`<div class="warn"><b>Revise:</b> ${w.map(esc).join(" ")}</div>`:""; }); },
    async onSubmit(fm,err){ const m=clean({t:rv(fm,"t"),ext:rv(fm,"ext","n"),ph:rv(fm,"ph","n"),temp:rv(fm,"temp","n"),resp:rv(fm,"resp")}); if(m.ext==null){ err("Indique el extracto."); return false; }
      m.h=r1(hrs(L.fin,m.t)*10)/10; L.muestras=(L.muestras||[]).concat([m]);
      if(!await App.Store.set("llenados",id,L)) return false;
      const t=S().tanques&&S().tanques[L.lote]; if(t){ const t2=clone(t); t2.muestras=(t2.muestras||[]).concat([{t:m.t,ext:m.ext}]); await App.Store.set("tanques",L.lote,t2); }
      toast("Muestra guardada"); App.render(true); return true; }});
}

/* ============================================================
   TRASIEGO FV → SV (REGISTRO SV) Y MADURACIÓN
   ============================================================ */
function vTrasiegoLista(){
  const meses=[...new Set(trasiegos().map(x=>(x.ini||"").slice(0,7)).filter(Boolean))].sort().reverse();
  let T=trasiegos().sort(byInicio);
  if(st.mes) T=T.filter(x=>(x.ini||"").startsWith(st.mes));
  if(st.marca) T=T.filter(x=>x.marca===st.marca);
  if(st.q){ const q=st.q.toUpperCase(); T=T.filter(x=>[x.lote,x.tq,x.marca,(x.fvs||[]).map(v=>v.lote).join(" ")].join(" ").toUpperCase().includes(q)); }
  const rows=T.slice(0,st.max||80).map(x=>{ const fv=(x.fvs||[]).map(v=>v.lote).filter(Boolean).join(" + "); return `<tr class="clk ${x.vaciado?"vacio":""}" data-go="cava/trasiego/${esc(x.id)}"><td><b>${esc(x.lote)}</b></td><td class="n">${x.tq}</td><td>${esc(x.marca)}</td><td>${esc(fv||"—")}</td><td>${fmtS(x.ini)}</td><td>${fmtS(x.fin)}</td><td class="n">${f0(x.vol)}</td><td class="n">${x.eoPond!=null?f2(x.eoPond):"—"}</td><td class="n">${x.fvs&&x.fvs[0]&&x.fvs[0].tFV?f1(x.fvs[0].tFV/24):"—"}</td><td class="n">${x.rdf!=null?f1(x.rdf)+" %":"—"}</td><td>${x.vaciado?pill("Vacío"):pill(etapaSV(x),etapaSV(x)==="Listo"?"ok":"warn")}</td></tr>`; });
  return `${header("Trasiego y maduración","Trasiego de FV a SV (centrífuga, deep freeze, silica/PVPP), purgas y filtración. Equivale a REGISTRO SV, SEGUIMIENTO MADURACIÓN y B.D MADURACIÓN.",`<button class="btn pri" type="button" data-nuevo>＋ Nuevo trasiego</button>`)}
  ${tabsHTML("trasiego")}
  <div class="bar"><input class="q" id="cvQ" type="search" placeholder="Buscar lote, SV, FV origen, marca" value="${esc(st.q)}"><select class="q" id="cvMes"><option value="">Todos los meses</option>${meses.map(m=>`<option ${st.mes===m?"selected":""}>${m}</option>`).join("")}</select><select class="q" id="cvMarca"><option value="">Todas las marcas</option>${MARCAS.map(m=>`<option ${st.marca===m?"selected":""}>${m}</option>`).join("")}</select><span class="sp"></span><span class="muted small">${T.length} trasiegos</span></div>
  ${tabla([th("Lote SV"),th("SV",1),th("Marca"),th("FV origen"),th("Inicio trasiego"),th("Fin trasiego"),th("Vol (Hl)",1),th("E.O (°P)",1),th("Días en FV",1),th("RDF",1),th("Estado")].join(""),rows,"No hay trasiegos registrados.")}
  ${T.length>(st.max||80)?`<div style="text-align:center;margin-top:12px"><button class="btn" id="cvMas">Mostrar más</button></div>`:""}`;
}
function filtrCalc(M){
  const fl=M.filtr||{}, eo=N(M.eoPond)??N(M.eoFinal), kin=kge(eo,N(M.vol)), volPurgas=(M.purgas||[]).reduce((s,p)=>s+(N(p.vol)||0),0);
  const eoSal=N(fl.eo)??N(M.eoFinal)??eo, kout=fl.vol?kge(eoSal,(N(fl.vol)||0)+volPurgas):null;
  return {kin,kout,merma:kin&&kout&&fl.vacio==="SI"?(kin-kout)/kin*100:null,volPurgas};
}
function vTrasiegoDetalle(id){
  const M=(S().trasiegos||{})[id]; if(!M) return `${header("Trasiego no encontrado","",`<a class="btn" href="#/cava/trasiego">Volver</a>`)}<div class="card card-p">No existe el registro ${esc(id)}.</div>`;
  const fl=M.filtr||{}, fc=filtrCalc(M), marca=M.marca, tSV=M.fin?dias(M.fin,fl.ini||Date.now()):null;
  const fvs=(M.fvs||[]).map(v=>`<tr><td>${(()=>{ const l=findL(v.lote,v.ini); return l?`<a href="#/cava/llenado/${esc(l.id)}">${esc(v.lote)}</a>`:esc(v.lote); })()}</td>${td(v.tq,1)}${td(fmtS(v.ini))}${td(fmtS(v.fin))}${td(v.eo!=null?f2(v.eo):null,1)}${td(v.volAj!=null?f0(v.volAj):null,1)}${td(v.volCont!=null?f0(v.volCont):null,1)}${td(v.silicaLote)}${td(v.silicaKg!=null?f0(v.silicaKg):null,1)}${td(v.temp!=null?f1(v.temp):null,1)}${td(v.resp)}${td(v.tFV!=null?f1(v.tFV/24):null,1)}</tr>`);
  const pur=(M.purgas||[]).map(p=>`<tr><td>${fmt(p.t)}</td>${td(p.vol!=null?f0(p.vol):null,1)}${td(p.cons!=null?pc(p.cons):null,1)}${td(p.resp)}</tr>`);
  const seg=(M.seg||[]).map(s=>`<tr><td>${esc(s.etapa||"")}</td>${td(s.hora)}${td(s.presion!=null?f1(s.presion):null,1)}${td(s.ph!=null?f2(s.ph):null,1)}${td(s.tSal!=null?f1(s.tSal):null,1)}${td(s.tEnt!=null?f1(s.tEnt):null,1)}${td(s.o2!=null?f2(s.o2):null,1)}</tr>`);
  const an=[["E.O (°P)",M.eoFinal,2],["E. aparente",M.eapp,2],["E. real",M.ereal,2],["Alcohol p/p",M.alcPeso,2],["Alcohol v/v",M.alcVol,2],["RDF (%)",M.rdf,1],["Color (EBC)",M.colorFinal,1],["pH",M.phFin,2],["Amargo (BU)",M.amargoFinal,1],["Recuento (cel/mL)",M.recuento,0],["O₂ disuelto (ppb)",M.o2d,0],["CO₂",M.co2,2],["Turbidez (UA)",M.turb,1]];
  return `${header(`SV ${M.tq} · ${esc(M.lote)}`,`${esc(marca)} · trasiego ${fmtS(M.ini)} → ${fmtS(M.fin)}`,`<a class="btn" href="#/cava/trasiego">‹ Lista</a>${can0()?`<button class="btn" data-ed>Editar</button><button class="btn" data-pur>＋ Purga</button><button class="btn" data-fis>Fisicoquímico</button><button class="btn pri" data-fil>Filtración</button>`:""}`)}
  ${tabsHTML("trasiego")}
  <div class="kpis sec">${App.C.kpi({label:"Estado",value:M.vaciado?"Vacío":etapaSV(M),color:M.vaciado?"var(--st-espera)":"var(--st-prox)",sub:tSV!=null?f1(tSV)+" d en SV":""})}${App.C.kpi({label:"Volumen",value:f0(M.vol)+" Hl",color:"var(--st-lista)",sub:"a SV"})}${App.C.kpi({label:"Ciclo de fermentación",value:M.fvs&&M.fvs[0]&&M.fvs[0].tFV?f1(M.fvs[0].tFV/24)+" d":"—",color:"var(--accent)",sub:"tiempo en FV"})}${App.C.kpi({label:"Purgas",value:(M.purgas||[]).length,color:"var(--st-espera)",sub:f0(fc.volPurgas)+" Hl purgados"})}${App.C.kpi({label:"Merma de filtración",value:fc.merma!=null?f2(fc.merma)+" %":"—",color:"var(--st-vencida)",sub:fl.vacio==="SI"?"SV vacío":"al vaciar el SV"})}</div>
  <div class="card card-p sec"><h3>FV de origen</h3>${tabla([th("FV"),th("UTQ",1),th("Inicio trasiego"),th("Fin trasiego"),th("E.O (°P)",1),th("Vol aj. (Hl)",1),th("Vol cont. (Hl)",1),th("Lote silica"),th("Silica (kg)",1),th("Temp",1),th("Responsable"),th("Días FV",1)].join(""),fvs,"Sin FV de origen.")}
   <div class="kv" style="margin-top:14px">${kv("Lote silica/PVPP",esc(M.silicaLote))}${kv("Bultos preparados",M.bultos)}${kv("Sensorial silica",esc(M.sensSilica))}${kv("Degustador",esc(M.degSilica))}${kv("Cavero",esc(M.cavero))}${kv("Temp. antes trasiego (°C)",M.tempAntes!=null?f1(M.tempAntes):null)}${kv("Vol. cocina (Hl)",M.volCocina!=null?f0(M.volCocina):null)}${kv("E.O cocina (°P)",M.eoCocina!=null?f2(M.eoCocina):null)}${kv("E.O fin FV (°P)",M.eoFinFV!=null?f2(M.eoFinFV):null)}${kv("KGE cocina",M.eoCocina&&M.volCocina?f0(kge(M.eoCocina,M.volCocina)):null)}${kv("Vol. contador (Hl)",M.volContador!=null?f0(M.volContador):null)}${kv("Merma contador (%)",M.eoCocina&&M.volCocina&&M.eoFinFV&&M.volContador?f2((kge(M.eoCocina,M.volCocina)-kge(M.eoFinFV,M.volContador))/kge(M.eoCocina,M.volCocina)*100):null)}${kv("FV queda vacío",esc(M.fvVacio))}${kv("CO₂ en SV",M.co2sv!=null?f2(M.co2sv):null)}${kv("O₂ en SV (ppb) <15",M.o2sv!=null?f1(M.o2sv):null)}</div></div>
  <div class="grid2 sec">
   <div class="card card-p"><h3>Seguimiento del trasiego</h3>${tabla([th("Etapa"),th("Hora"),th("Presión ent. enf.",1),th("pH",1),th("T° salida",1),th("T° entrada",1),th("O₂ línea",1)].join(""),seg,"Sin seguimiento registrado.")}</div>
   <div class="card card-p"><h3>Centrífuga y deep freeze</h3><div class="kv">${kv("Trasiego con centrífuga",esc(M.centrifuga||"NO"))}${kv("Recuperación de levadura",esc(M.recupLev))}${kv("Causa no recuperación",esc(M.causaNoRecup))}${kv("Colector origen",M.colOrigen)}${kv("Vol. en colector (Hl)",M.volColector!=null?f0(M.volColector):null)}${kv("Descargas parciales",M.descargas)}${kv("Vol. levadura recuperada (Hl)",M.volLevRec!=null?f1(M.volLevRec):null)}${kv("Consistencia descarga (%)",M.consDescarga!=null?pc(M.consDescarga):null)}${kv("Trasiego deep freeze",esc(M.deepFreeze||"NO"))}${kv("Caso deep freeze",esc(M.casoDF))}${kv("OD integrado (ppb)",M.odInt!=null?f1(M.odInt):null)}${kv("Eventos",esc(M.eventos))}</div></div>
  </div>
  <div class="grid2 sec">
   <div class="card card-p"><h3>Purgas</h3>${tabla([th("Fecha y hora"),th("Vol (Hl)",1),th("Consist. 10 min",1),th("Responsable")].join(""),pur,"Sin purgas registradas.")}</div>
   <div class="card card-p"><h3>Filtración</h3><div class="kv">${kv("Inicio",fmt(fl.ini))}${kv("Fin",fmt(fl.fin))}${kv("Vol. filtrado (Hl)",fl.vol!=null?f0(fl.vol):null)}${kv("SV queda vacío",esc(fl.vacio))}${kv("KGE entrada",fc.kin!=null?f0(fc.kin):null)}${kv("KGE salida",fc.kout!=null?f0(fc.kout):null)}${kv("Merma (%)",fc.merma!=null?f2(fc.merma):null)}${kv("Tiempo en SV (d)",tSV!=null?f1(tSV):null)}${kv("Comentario",esc(fl.coment))}</div></div>
  </div>
  <div class="card card-p sec"><h3>Fisicoquímico y sensorial</h3><div class="kv">${an.map(([l,v,dc])=>kv(l,v!=null?f(v,dc):null)).join("")}${kv("Fecha muestreo",fmt(M.fechaFinal))}${kv("Responsable",esc(M.resp))}${kv("Sensorial 1",esc(M.sensorial))}${kv("Degustador 1",esc(M.degustador))}${kv("Sensorial 2",esc(M.sensorial2))}${kv("Degustador 2",esc(M.degustador2))}</div></div>`;
}
function mTrasiegoDetalle(id){
  const q=s=>$("#view "+s);
  if(q("[data-ed]")) q("[data-ed]").onclick=()=>trasiegoForm(id);
  if(q("[data-pur]")) q("[data-pur]").onclick=()=>purgaModal(id);
  if(q("[data-fis]")) q("[data-fis]").onclick=()=>fisicoModal(id);
  if(q("[data-fil]")) q("[data-fil]").onclick=()=>filtracionModal(id);
}
function trasiegoForm(id,fvPre){
  if(!can()) return;
  const nuevo=!id, M=id?clone(S().trasiegos[id]):{}, y=new Date().getFullYear(), v0=(M.fvs||[])[0]||{};
  const oc=ocupados(), libres=[]; for(let t=1;t<=NTQ;t++) if(!oc[t]||(!nuevo&&+M.tq===t)) libres.push(t);
  const fvSel=fvPre||(v0.lote?((findL(v0.lote,v0.ini)||{}).id||""):"");
  const abiertos=llenados().filter(x=>(!x.vaciado&&x.fin)||x.id===fvSel).sort(byInicio);
  const seg=[["5 MIN INICIO (50 Hl)"],["Mitad (1700 Hl)"],["5 MIN FIN (3800 Hl)"]].map((x,i)=>Object.assign({etapa:x[0]},(M.seg||[])[i]||{}));
  const body=`<div class="cvf">
   ${FS("Trasiego de fermentación",G(
     inp("fv","FV de origen",{t:"sel",req:1,v:fvSel,opts:abiertos.map(x=>[x.id,`FV ${x.tq} · ${x.lote} · ${x.marca} · ${f0(x.vol)} Hl`]),hint:nuevo?"":"Para un segundo FV edite el registro desde la base"}),
     inp("tq","SV destino (UTQ)",{t:"sel",req:1,v:M.tq,opts:libres}),
     inp("lote","Consecutivo SV",{req:1,v:M.lote||proxLote("M",y),up:1}),
     inp("ini","Inicio trasiego",{t:"dt",req:1,v:M.ini||ahora()}),inp("fin","Fin trasiego",{t:"dt",v:M.fin}),
     inp("tempAntes","Temp. antes del trasiego (°C)",{t:"n",v:M.tempAntes}),
     inp("eoCocina","E.O cocina (°P)",{t:"n",v:M.eoCocina}),inp("eoFinFV","E.O fin FV (°P)",{t:"n",v:M.eoFinFV}),
     inp("volCocina","Vol. cocina (Hl)",{t:"n",v:M.volCocina}),inp("volContador","Vol. contador (Hl)",{t:"n",v:M.volContador??v0.volCont}),inp("volAj","Volumen ajustado (Hl)",{t:"n",v:M.vol??v0.volAj,hint:"Es el volumen que entra al SV"}),
     inp("fvVacio","¿FV queda vacío?",{t:"sel",v:M.fvVacio||"SI",opts:["SI","NO"]}),inp("cavero","Cavero / responsable",{v:M.cavero||v0.resp,list:"cvResp"})))}
   <datalist id="cvResp">${respOpts().map(r=>`<option value="${esc(r)}">`).join("")}</datalist>
   ${FS("Silica y PVPP",G(inp("silicaLote","Lote silica y PVPP",{v:M.silicaLote||v0.silicaLote}),inp("bultos","Bultos preparados",{t:"n",v:M.bultos??v0.silicaKg}),inp("sensSilica","Sensorial silica",{t:"sel",v:M.sensSilica,opts:["OK","NO OK"]}),inp("degSilica","Degustador",{v:M.degSilica,list:"cvResp"})))}
   ${FS("Seguimiento (enfriador y línea)",`<div class="cocs"><table><thead><tr><th>Etapa</th><th>Hora</th><th>Presión ent. enf.</th><th>pH</th><th>T° salida</th><th>T° entrada</th><th>O₂ línea</th></tr></thead><tbody>${seg.map((s,i)=>`<tr><td>${esc(s.etapa)}</td>${[["hora","time"],["presion"],["ph"],["tSal"],["tEnt"],["o2"]].map(([k,ty])=>`<td><input name="s${i}_${k}" type="${ty||"number"}" step="any" value="${s[k]==null?"":esc(s[k])}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>`)}
   <details ${M.centrifuga==="SI"?"open":""}><summary>Centrífuga y recuperación de levadura</summary>${G(inp("centrifuga","Trasiego con centrífuga",{t:"sel",v:M.centrifuga||"NO",opts:["SI","NO"]}),inp("recupLev","Recuperación de levadura",{t:"sel",v:M.recupLev,opts:["SI","NO"]}),inp("causaNoRecup","Causa no recuperación",{v:M.causaNoRecup,list:"cvCausas"}),inp("colOrigen","Colector origen levadura",{t:"n",v:M.colOrigen}),inp("volColector","Vol. en colector (Hl)",{t:"n",v:M.volColector}),inp("descargas","# descargas parciales",{t:"n",v:M.descargas}),inp("volLevRec","Vol. levadura recuperada (Hl)",{t:"n",v:M.volLevRec}),inp("consDescarga","Consistencia descarga centrífuga (%)",{t:"pct",v:M.consDescarga}),inp("eoDescarga","E.O descarga centrífuga (°P)",{t:"n",v:M.eoDescarga}),inp("volContCent","Vol. contador centrífuga (Hl)",{t:"n",v:M.volContCent}))}<datalist id="cvCausas">${["Colectores 3-4 con levadura","Equipo en mantenimiento","Estación CIP ocupada","Fisicoquímicos FDE","Levadura no disponible","No compatibilidad marca","pH > 5.9","Temperatura levadura","Tiempo en colector >","Trasiego Light"].map(x=>`<option value="${esc(x)}">`).join("")}</datalist></details>
   <details ${M.deepFreeze==="SI"?"open":""}><summary>Deep freeze y calidad en SV</summary>${G(inp("deepFreeze","Trasiego deep freeze",{t:"sel",v:M.deepFreeze||"NO",opts:["SI","NO"]}),inp("casoDF","Caso deep freeze",{t:"sel",v:M.casoDF,opts:["Enf.1","Enf.2","Enf.Azul","Enf.1+Enf.2","Enf.1+Enf.2+Enf.Azul","Enf.2+Enf.Azul"]}),inp("co2sv","CO₂ en SV",{t:"n",v:M.co2sv}),inp("o2sv","O₂ en SV (ppb) · CI < 15",{t:"n",v:M.o2sv}),inp("odInt","OD integrado (ppb)",{t:"n",v:M.odInt}),inp("eventos","Eventos durante el trasiego",{t:"ta",wide:1,v:M.eventos}))}</details>
  </div>`;
  App.UI.modal(nuevo?"Nuevo trasiego a SV":"Editar trasiego "+M.lote,body,{wide:true,ok:nuevo?"Registrar trasiego":"Guardar cambios",
    async onSubmit(fm,err){
      const fvId=rv(fm,"fv"), tq=rv(fm,"tq","n"), lote=rv(fm,"lote","up"), ini=rv(fm,"ini");
      if(!fvId||!tq||!lote||!ini){ err("Complete FV de origen, SV destino, consecutivo e inicio."); return false; }
      const fin=rv(fm,"fin"); if(fin&&hrs(ini,fin)<0){ err("El fin del trasiego es anterior al inicio."); return false; }
      const L=S().llenados[fvId]; if(!L){ err("No se encontró el FV de origen."); return false; }
      if(L.fin&&hrs(L.fin,ini)<0){ err("El trasiego empieza antes de terminar el llenado del FV."); return false; }
      const nid=nuevo?llenadoId(lote,ini):id; if(nuevo&&S().trasiegos[nid]){ err("Ya existe el consecutivo "+lote+"."); return false; }
      if(nuevo&&oc[tq]){ err("El SV "+tq+" está ocupado."); return false; }
      const volAj=rv(fm,"volAj","n"), eoFV=rv(fm,"eoFinFV","n");
      const fvs=[clean({lote:L.lote,tq:L.tq,ini,fin,eo:eoFV??L.eo,volAj,volCont:rv(fm,"volContador","n"),silicaLote:rv(fm,"silicaLote"),silicaKg:rv(fm,"bultos","n"),resp:rv(fm,"cavero"),tFV:r1(hrs(L.fin||L.inicio,ini))})].concat((M.fvs||[]).slice(1));
      const seg=[]; for(let i=0;i<3;i++){ const s=clean({etapa:["5 MIN INICIO (50 Hl)","Mitad (1700 Hl)","5 MIN FIN (3800 Hl)"][i],hora:rv(fm,`s${i}_hora`),presion:rv(fm,`s${i}_presion`,"n"),ph:rv(fm,`s${i}_ph`,"n"),tSal:rv(fm,`s${i}_tSal`,"n"),tEnt:rv(fm,`s${i}_tEnt`,"n"),o2:rv(fm,`s${i}_o2`,"n")}); if(Object.keys(s).length>1) seg.push(s); }
      const o=Object.assign({},M,clean({lote,tq,marca:L.marca,ini,fin,fvs,vol:volAj,tLlenado:fin?r1(hrs(ini,fin)):null,eoPond:eoFV??L.eo,
        tempAntes:rv(fm,"tempAntes","n"),eoCocina:rv(fm,"eoCocina","n"),eoFinFV:eoFV,volCocina:rv(fm,"volCocina","n"),volContador:rv(fm,"volContador","n"),fvVacio:rv(fm,"fvVacio"),cavero:rv(fm,"cavero"),
        silicaLote:rv(fm,"silicaLote"),bultos:rv(fm,"bultos","n"),sensSilica:rv(fm,"sensSilica"),degSilica:rv(fm,"degSilica"),seg,
        centrifuga:rv(fm,"centrifuga"),recupLev:rv(fm,"recupLev"),causaNoRecup:rv(fm,"causaNoRecup"),colOrigen:rv(fm,"colOrigen","n"),volColector:rv(fm,"volColector","n"),descargas:rv(fm,"descargas","n"),volLevRec:rv(fm,"volLevRec","n"),consDescarga:rv(fm,"consDescarga","pct"),eoDescarga:rv(fm,"eoDescarga","n"),volContCent:rv(fm,"volContCent","n"),
        deepFreeze:rv(fm,"deepFreeze"),casoDF:rv(fm,"casoDF"),co2sv:rv(fm,"co2sv","n"),o2sv:rv(fm,"o2sv","n"),odInt:rv(fm,"odInt","n"),eventos:rv(fm,"eventos")}));
      if(!await App.Store.set("trasiegos",nid,o)) return false;
      const fvTq=+L.tq, tqs=[tq,fvTq];
      if(nuevo){ const L2=clone(L); if(o.fvVacio!=="NO"){ L2.vaciado=ini; L2.trasiego=nid; await App.Store.set("llenados",fvId,L2); } }
      await syncCava(tqs); toast(nuevo?"Trasiego "+lote+" registrado":"Cambios guardados"); App.go("cava/trasiego/"+nid); App.render(true); return true;
    }});
}
function purgaModal(id){
  if(!can()) return; const M=clone(S().trasiegos[id]);
  App.UI.modal(`Registrar purga · SV ${M.tq} · ${M.lote}`,G(inp("t","Fecha y hora de la purga",{t:"dt",req:1,v:ahora()}),inp("vol","Volumen (Hl)",{t:"n",req:1}),inp("cons","Consistencia 10 min (%)",{t:"pct"}),inp("resp","Responsable",{req:1,list:"cvResp"}))+`<datalist id="cvResp">${respOpts().map(r=>`<option value="${esc(r)}">`).join("")}</datalist>`,{ok:"Guardar purga",
    async onSubmit(fm,err){ const p=clean({t:rv(fm,"t"),vol:rv(fm,"vol","n"),cons:rv(fm,"cons","pct"),resp:rv(fm,"resp")}); if(!p.vol||!p.resp){ err("Indique volumen y responsable."); return false; } M.purgas=(M.purgas||[]).concat([p]); if(!await App.Store.set("trasiegos",id,M)) return false; toast("Purga registrada"); App.render(true); return true; }});
}
function fisicoModal(id){
  if(!can()) return; const M=clone(S().trasiegos[id]);
  const c=[["fechaFinal","Fecha de muestreo","dt"],["eoFinal","Extracto original (°P)","n"],["eapp","E. aparente (°P)","n"],["ereal","E. real (°P)","n"],["alcPeso","Alcohol p/p (%)","n"],["alcVol","Alcohol v/v (%)","n"],["rdf","RDF (%)","n"],["colorFinal","Color (EBC)","n"],["phFin","pH","n"],["amargoFinal","Amargo (BU)","n"],["recuento","Recuento celular (cel/mL)","n"],["o2d","O₂ disuelto (ppb)","n"],["co2","CO₂","n"],["turb","Turbidez (UA)","n"],["resp","Responsable","t"],["sensorial","Sensorial 1","t"],["degustador","Degustador 1","t"],["sensorial2","Sensorial 2","t"],["degustador2","Degustador 2","t"]];
  App.UI.modal(`Fisicoquímico · SV ${M.tq} · ${M.lote}`,G(...c.map(([k,l,t])=>inp(k,l,{t:t==="n"?"n":t==="dt"?"dt":"text",v:M[k]})))+`<p class="nota">Si deja vacío el E. real o el RDF se calculan con E.O y E. aparente (E.real = 0,1808·E.O + 0,8192·E.app).</p>`,{ok:"Guardar",
    async onSubmit(fm,err){ c.forEach(([k,l,t])=>{ const v=rv(fm,k,t==="n"?"n":undefined); if(v==null) delete M[k]; else M[k]=v; });
      if(M.eoFinal!=null&&M.eapp!=null){ if(M.ereal==null) M.ereal=Math.round((0.1808*M.eoFinal+0.8192*M.eapp)*100)/100; if(M.rdf==null) M.rdf=Math.round((M.eoFinal-M.ereal)/M.eoFinal*10000)/100; }
      if(!await App.Store.set("trasiegos",id,M)) return false; toast("Análisis guardado"); App.render(true); return true; }});
}
function filtracionModal(id){
  if(!can()) return; const M=clone(S().trasiegos[id]), fl=M.filtr||{};
  App.UI.modal(`Filtración · SV ${M.tq} · ${M.lote}`,G(inp("ini","Inicio de filtración",{t:"dt",v:fl.ini||ahora()}),inp("fin","Fin de filtración",{t:"dt",v:fl.fin}),inp("vol","Volumen filtrado (Hl)",{t:"n",v:fl.vol}),inp("eo","E.O en SV (°P)",{t:"n",v:fl.eo??M.eoFinal??M.eoPond}),inp("vacio","¿SV queda vacío?",{t:"sel",v:fl.vacio,opts:["SI","NO"]}),inp("coment","Comentario",{t:"ta",wide:1,v:fl.coment}))+`<p class="nota">La merma se calcula al vaciar el SV: (KGE entrada − KGE salida) / KGE entrada, con KGE = Σ vol × (E.O ajustada).</p>`,{ok:"Guardar filtración",
    async onSubmit(fm,err){ const o=clean({ini:rv(fm,"ini"),fin:rv(fm,"fin"),vol:rv(fm,"vol","n"),eo:rv(fm,"eo","n"),vacio:rv(fm,"vacio"),coment:rv(fm,"coment")}); M.filtr=o; if(o.vacio==="SI") M.vaciado=o.fin||o.ini||ahora();
      if(!await App.Store.set("trasiegos",id,M)) return false; await syncCava([M.tq]); toast("Filtración guardada"); App.render(true); return true; }});
}

/* ============================================================
   ANÁLISIS: pendientes de muestreo, purgas, fisicoquímicos
   ============================================================ */
function vAnalisis(){
  const now=Date.now(), fv=llenados().filter(x=>!x.vaciado&&x.fin).sort(byInicio), sv=trasiegos().filter(x=>!x.vaciado).sort(byInicio);
  const rowsF=fv.map(L=>{ const u=ultima(L), edad=u?hrs(u.t,now):hrs(L.fin,now), pend=edad>=24;
    return `<tr><td><a href="#/cava/llenado/${esc(L.id)}"><b>FV ${L.tq}</b></a></td><td>${esc(L.lote)}</td><td>${esc(L.marca)}</td><td>${u?fmtS(u.t):"—"}</td><td class="n ${pend?"v-bad":""}">${edad!=null?f0(edad)+" h":"—"}</td><td class="n">${u?f2(u.ext):"—"}</td><td class="n">${deltaDia(L)!=null?f2(deltaDia(L)):"—"}</td><td class="n">${rdf(L)!=null?pc(rdf(L)):"—"}</td><td>${etapaFV(L)}</td><td>${can0()?`<button class="btn sm" data-mue="${esc(L.id)}">＋ Muestra</button>`:""}</td></tr>`; });
  const rowsS=sv.map(M=>{ const p=(M.purgas||[]), last=p[p.length-1], edad=last?hrs(last.t,now):null;
    return `<tr><td><a href="#/cava/trasiego/${esc(M.id)}"><b>SV ${M.tq}</b></a></td><td>${esc(M.lote)}</td><td>${esc(M.marca)}</td><td>${fmtS(M.fin)}</td><td class="n">${M.fin?f1(dias(M.fin,now)):"—"}</td><td class="n">${p.length}</td><td>${last?fmtS(last.t):"—"}</td><td class="n ${edad!=null&&edad>48?"v-warn":""}">${edad!=null?f0(edad)+" h":"—"}</td><td class="n">${last&&last.cons!=null?pc(last.cons):"—"}</td><td>${M.eapp!=null?pill("Con análisis","ok"):pill("Sin análisis","warn")}</td><td>${can0()?`<button class="btn sm" data-pur="${esc(M.id)}">＋ Purga</button> <button class="btn sm" data-fis="${esc(M.id)}">Fisicoq.</button>`:""}</td></tr>`; });
  const pend=[]; fv.forEach(L=>{ const h=hrs(L.fin,now); if(h>=3&&L.rec3h==null) pend.push([L,"Recuento a 3 h",h]); if(h>=72&&L.ea72==null) pend.push([L,"Extracto a 72 h",h]); if(h>=24&&!L.kpiHig) pend.push([L,"KPI higiénico",h]); if(h>=120&&!L.fechaDescanso&&etapaFV(L)==="Descanso") pend.push([L,"Inicio de descanso de diacetilo",h]); });
  const rowsP=pend.map(([L,q,h])=>`<tr><td><a href="#/cava/llenado/${esc(L.id)}"><b>FV ${L.tq}</b></a></td><td>${esc(L.lote)}</td><td>${esc(L.marca)}</td><td>${q}</td><td class="n">${f0(h)} h en FV</td></tr>`);
  return `${header("Análisis","Muestreo de extractos, purgas de SV, fisicoquímicos y pendientes de calidad. Equivale a REGISTRO ANÁLISIS y REFERENCIAS.","")}
  ${tabsHTML("analisis")}
  <div class="sec"><div class="sec-h"><h2>Muestreo de fermentadores</h2><span class="muted small">Alerta cuando pasan 24 h sin muestra</span></div>${tabla([th("FV"),th("Lote"),th("Marca"),th("Último muestreo"),th("Hace",1),th("Ext. (°P)",1),th("°P/día",1),th("Atenuación",1),th("Etapa"),th("")].join(""),rowsF,"No hay fermentadores llenos.")}</div>
  <div class="sec"><div class="sec-h"><h2>Maduradores: purgas y fisicoquímicos</h2></div>${tabla([th("SV"),th("Lote"),th("Marca"),th("Llenado"),th("Días en SV",1),th("# purgas",1),th("Última purga"),th("Hace",1),th("Consist.",1),th("Análisis"),th("")].join(""),rowsS,"No hay maduradores ocupados.")}</div>
  <div class="sec"><div class="sec-h"><h2>Pendientes de calidad</h2></div>${tabla([th("FV"),th("Lote"),th("Marca"),th("Pendiente"),th("Tiempo",1)].join(""),rowsP,"Sin pendientes de calidad.")}</div>`;
}
function mAnalisis(){
  $$("#view [data-mue]").forEach(b=>b.onclick=()=>muestraModal(b.dataset.mue));
  $$("#view [data-pur]").forEach(b=>b.onclick=()=>purgaModal(b.dataset.pur));
  $$("#view [data-fis]").forEach(b=>b.onclick=()=>fisicoModal(b.dataset.fis));
}

/* ============================================================
   INVENTARIO (INVENTARIO sheet)
   ============================================================ */
function vInventario(){
  const g=cfg(); let tInv=0,tDep=0,tReal=0;
  const rows=Array.from({length:NTQ},(_,i)=>{ const t=i+1, c=cavaDoc(t), x=inventarioFila(c); tInv+=x.inv; tDep+=x.dep; tReal+=N(c.volReal)||0; const r=registroDe(c);
    return `<tr class="${c.op?"":"vacio"}"><td><b>${t}</b></td><td>${c.op||"—"}</td><td>${fmtS(c.fechaLlenado)}</td><td>${c.marca||"—"}</td><td class="n">${c.op?f0(x.inv):"0"}</td><td class="n">${c.temp!=null?f1(c.temp):"—"}</td><td>${esc(c.levadura||"—")}</td><td>${fmtS(c.fechaRecoleccion)}</td><td class="n">${c.volReal?f0(c.volReal):"—"}</td><td class="n">${c.op?f0(x.dep):"0"}</td><td>${r?`<a href="#/cava/${c.op==="F"?"llenado":"trasiego"}/${esc(c.ref)}">${esc(r.lote)}</a>`:"—"}</td><td>${can0()?`<button class="btn sm" data-ed="${t}">Editar</button>`:""}</td></tr>`; });
  const fac=Object.entries(g.factores).map(([k,v])=>`<tr><td>${k}</td><td>${MARCA_COD[k]}</td><td class="n">${f2(v)}</td></tr>`).join("");
  return `${header("Inventario de cellars","Inventario de los "+NTQ+" UTQ con volumen real, volumen de inventario y volumen en depósito. Equivale a la hoja INVENTARIO.",`${can0()?`<button class="btn" id="cvSync">Sincronizar con llenados y trasiegos</button><button class="btn" id="cvCfg">Mermas y factores</button>`:""}`)}
  ${tabsHTML("inventario")}
  <div class="tw sec"><table><thead><tr>${th("UTQ")}${th("Op.")}${th("Fecha y hora llenado")}${th("Marca")}${th("Vol. inventario (Hl)",1)}${th("Temp (°C)",1)}${th("Levadura")}${th("Recolección")}${th("Vol. real (Hl)",1)}${th("Vol. depósito (Hl)",1)}${th("Registro")}${th("")}</tr></thead><tbody>${rows.join("")}<tr><td colspan="4"><b>Total</b></td><td class="n"><b>${f0(tInv)}</b></td><td colspan="3"></td><td class="n"><b>${f0(tReal)}</b></td><td class="n"><b>${f0(tDep)}</b></td><td colspan="2"></td></tr></tbody></table></div>
  <div class="grid2 sec"><div class="card card-p"><h3>Mermas aplicadas</h3><div class="kv">${kv("Merma FV",pc(g.mermaFV,2))}${kv("Merma SV",pc(g.mermaSV,2))}${kv("Merma con/envasado",pc(g.mermaEnv,2))}</div><p class="nota">Vol. inventario = Vol. real × (1 − merma FV, solo FV) × (1 − merma SV) × (1 − merma con/env). Vol. depósito = inventario × factor de dilución.</p></div>
  <div class="card card-p"><h3>Factores de dilución</h3><div class="tw"><table><thead><tr><th>Cód.</th><th>Marca</th><th class="n">Factor</th></tr></thead><tbody>${fac}</tbody></table></div></div></div>`;
}
function mInventario(){
  $$("#view [data-ed]").forEach(b=>b.onclick=()=>inventarioModal(+b.dataset.ed));
  const s=$("#cvSync"); if(s) s.onclick=async()=>{ if(await syncCava()){ toast("Inventario sincronizado"); App.render(true); } };
  const c=$("#cvCfg"); if(c) c.onclick=cfgModal;
}
function inventarioModal(t){
  const c=Object.assign({tq:t},cavaDoc(t));
  App.UI.modal("Inventario · UTQ "+t,G(inp("op","Operación",{t:"sel",v:c.op,opts:[["F","F · Fermentación"],["M","M · Maduración"]]}),inp("fechaLlenado","Fecha y hora de llenado",{t:"dt",v:c.fechaLlenado}),inp("marca","Marca",{t:"sel",v:c.marca,opts:Object.entries(MARCA_COD).map(([k,v])=>[k,k+" · "+v])}),inp("temp","Temperatura (°C)",{t:"n",v:c.temp}),inp("levadura","Levadura",{v:c.levadura,up:1}),inp("fechaRecoleccion","Fecha y hora de recolección",{t:"dt",v:c.fechaRecoleccion}),inp("volReal","Volumen real (Hl)",{t:"n",v:c.volReal}))+`<p class="nota">Dejar la operación vacía marca el tanque como vacío. Normalmente se actualiza solo al registrar llenados y trasiegos.</p>`,{ok:"Guardar",
    async onSubmit(fm){ const o=clean({tq:t,op:rv(fm,"op"),fechaLlenado:rv(fm,"fechaLlenado"),marca:rv(fm,"marca"),temp:rv(fm,"temp","n"),levadura:rv(fm,"levadura","up"),fechaRecoleccion:rv(fm,"fechaRecoleccion"),volReal:rv(fm,"volReal","n")}); if(c.ref&&o.op===c.op) o.ref=c.ref; if(!await App.Store.set("cava",String(t),o)) return false; App.render(true); return true; }});
}
function cfgModal(){
  const g=cfg();
  App.UI.modal("Mermas y factores de dilución",G(inp("mermaFV","Merma FV (%)",{t:"n",v:g.mermaFV*100}),inp("mermaSV","Merma SV (%)",{t:"n",v:g.mermaSV*100}),inp("mermaEnv","Merma con/envasado (%)",{t:"n",v:g.mermaEnv*100}),...Object.entries(g.factores).map(([k,v])=>inp("f_"+k,`Factor ${k} · ${MARCA_COD[k]}`,{t:"n",v})))+`<p class="nota">Estos valores alimentan los cálculos de volumen del inventario.</p>`,{ok:"Guardar",
    async onSubmit(fm){ const o={mermaFV:rv(fm,"mermaFV","n")/100,mermaSV:rv(fm,"mermaSV","n")/100,mermaEnv:rv(fm,"mermaEnv","n")/100,factores:{}}; Object.keys(g.factores).forEach(k=>{ o.factores[k]=rv(fm,"f_"+k,"n")??g.factores[k]; }); if(!await App.Store.set("config","cavaCfg",o)) return false; App.render(true); return true; }});
}

/* ============================================================
   MERMA Y SAP
   ============================================================ */
function vMerma(){
  const meses=[...new Set(trasiegos().map(x=>(x.ini||"").slice(0,7)).filter(Boolean))].sort().reverse();
  const mes=st.mes||meses[0]||"", T=trasiegos().filter(x=>(x.ini||"").startsWith(mes)).sort(byInicio).reverse();
  const sub=st.sub;
  let tabla1="", resumen="";
  if(sub==="fer"){
    const rows=T.map(M=>{ const v=(M.fvs||[])[0]||{}, L=findL(v.lote,v.ini)||{}, cocs=(L.cocs||[]).map(c=>c.coc).filter(Boolean);
      const merma=M.eoCocina&&M.volCocina&&M.eoFinFV&&M.volContador?(kge(M.eoCocina,M.volCocina)-kge(M.eoFinFV,M.volContador))/kge(M.eoCocina,M.volCocina)*100:null;
      return `<tr><td>${esc(v.lote||"—")}</td><td class="n">${v.tq||"—"}</td><td>${esc(M.marca)}</td><td>${esc(cocs.join(" · ")||"—")}</td><td>${fmtS(M.ini)}</td><td class="n">${v.eo!=null?f2(v.eo):"—"}</td><td class="n">${M.ereal!=null?f2(M.ereal):"—"}</td><td class="n">${M.alcPeso!=null?f2(M.alcPeso):"—"}</td><td class="n">${M.tq}</td><td class="n">${f0(M.vol)}</td><td class="n">${v.silicaKg!=null?f0(v.silicaKg):"—"}</td><td class="n ${merma!=null&&Math.abs(merma)>3?"v-warn":""}">${merma!=null?f2(merma):"—"}</td></tr>`; });
    tabla1=tabla([th("FV"),th("UTQ",1),th("Marca"),th("Cocimientos"),th("Fecha y hora vaciado"),th("E.O (°P)",1),th("E.R (°P)",1),th("OH (p/p %)",1),th("SV destino",1),th("Volumen FV (Hl)",1),th("Silica (kg)",1),th("Merma contador %",1)].join(""),rows,"Sin trasiegos en este mes.");
  } else if(sub==="mad"){
    const rows=T.map(M=>{ const fl=M.filtr||{}, fc=filtrCalc(M), fv=(M.fvs||[]).map(v=>v.lote).filter(Boolean).join(" + ");
      return `<tr><td class="n">${M.tq}</td><td>${esc(M.marca)}</td><td>${esc(fv||"—")}</td><td>${fmtS(fl.ini)}</td><td class="n">${fl.vol!=null?f0(fl.vol):"—"}</td><td class="n">${M.eoFinal!=null?f2(M.eoFinal):"—"}</td><td class="n">${M.eapp!=null?f2(M.eapp):"—"}</td><td class="n">${M.turb!=null?f1(M.turb):"—"}</td><td class="n">${M.colorFinal!=null?f1(M.colorFinal):"—"}</td><td class="n">${M.alcPeso!=null?f2(M.alcPeso):"—"}</td><td class="n">${f0(fc.volPurgas)}</td><td class="n ${fc.merma!=null&&fc.merma>2?"v-warn":""}">${fc.merma!=null?f2(fc.merma):"—"}</td></tr>`; });
    tabla1=tabla([th("TQ",1),th("Marca"),th("FV origen"),th("Inicio filtración"),th("Vol. filtrado (Hl)",1),th("E.O (°P)",1),th("E. app (°P)",1),th("UA",1),th("Color",1),th("OH (p/p %)",1),th("Vol. purgas (Hl)",1),th("Merma %",1)].join(""),rows,"Sin trasiegos en este mes.");
  } else {
    const grupos={}; trasiegos().filter(M=>M.vol).forEach(M=>{ const k=(M.ini||"").slice(0,7); const v=(M.fvs||[])[0]||{}; const merma=M.eoCocina&&M.volCocina&&M.eoFinFV&&M.volContador?(kge(M.eoCocina,M.volCocina)-kge(M.eoFinFV,M.volContador))/kge(M.eoCocina,M.volCocina)*100:null; const fc=filtrCalc(M); (grupos[k]=grupos[k]||[]).push({vol:M.vol,eo:v.eo,m1:merma,m2:fc.merma,pur:fc.volPurgas}); });
    const rows=Object.keys(grupos).sort().reverse().map(k=>{ const a=grupos[k]; return `<tr><td>${k}</td><td class="n">${a.length}</td><td class="n">${f0(mean(a.map(x=>x.vol)))}</td><td class="n">${f2(mean(a.map(x=>x.eo)))}</td><td class="n">${f2(mean(a.map(x=>x.m1)))}</td><td class="n">${f2(mean(a.map(x=>x.m2)))}</td><td class="n">${f0(a.reduce((s,x)=>s+(x.pur||0),0))}</td></tr>`; });
    tabla1=tabla([th("Mes"),th("Trasiegos",1),th("Vol. prom. (Hl)",1),th("E.O prom. (°P)",1),th("Merma contador % (prom.)",1),th("Merma filtración % (prom.)",1),th("Purgas (Hl)",1)].join(""),rows,"Sin datos.");
  }
  return `${header("Merma y SAP","Datos de vaciado de fermentadores y filtración de maduradores para SAP, y merma de proceso. Equivale a las hojas SAP y MERMA.",`<button class="btn" id="cvCsv">Exportar CSV</button>`)}
  ${tabsHTML("merma")}
  <div class="bar"><div class="v31-seg" role="tablist">${[["fer","Fermentadores (SAP)"],["mad","Maduradores (SAP)"],["res","Resumen de merma"]].map(([k,l])=>`<button class="${sub===k?"on":""}" data-sub="${k}" type="button">${l}</button>`).join("")}</div>${sub!=="res"?`<select class="q" id="cvMesM">${meses.map(m=>`<option ${m===mes?"selected":""}>${m}</option>`).join("")}</select>`:""}</div>
  ${tabla1}`;
}
function mMerma(){
  $$("#view [data-sub]").forEach(b=>b.onclick=()=>{ st.sub=b.dataset.sub; App.render(true); });
  const m=$("#cvMesM"); if(m) m.onchange=()=>{ st.mes=m.value; App.render(true); };
  const c=$("#cvCsv"); if(c) c.onclick=()=>{ const t=$("#view table"); if(!t) return; const filas=[...t.rows].map(r=>[...r.cells].map(x=>x.textContent.trim())); csvDescarga("cava_"+st.sub+"_"+(st.mes||"todo")+".csv",filas); };
}

/* ============================================================
   ESPECIFICACIONES E INDICADORES
   ============================================================ */
function indicadores(){
  const out={}; MARCAS.forEach(m=>out[m]={});
  const add=(m,k,ok)=>{ if(ok==null||!out[m]) return; const o=out[m][k]=out[m][k]||{ok:0,n:0}; o.n++; if(ok) o.ok++; };
  llenados().filter(x=>(x.inicio||"").startsWith(String(new Date().getFullYear()))).forEach(L=>{ const m=L.marca;
    add(m,"viab",L.viab!=null?L.viab>=0.95:null);
    const h=L.fechaRecup?hrs(L.fechaRecup,L.inicio):null; add(m,"resiembra",h!=null?(h>=0&&h<=48):null);
    add(m,"eo",L.eo!=null?limCls(L.eo,eoInf(m),eoSup(m))==="v-ok":null);
    add(m,"presion",L.presion!=null?L.presion<=2.5:null);
    add(m,"tlev",L.tempSiembra!=null?(L.tempSiembra>=3&&L.tempSiembra<=4):null);
    const tm=tMaxFV(m), tf=L.vaciado&&L.fin?hrs(L.fin,L.vaciado):null; add(m,"tfv",tf!=null&&tm?tf<=tm:null);
    add(m,"ea72",L.ea72!=null&&N(descanso(m).ext)!=null?L.ea72<=spec("E.O 75% atenuación",m,"sup"):null);
  });
  trasiegos().filter(x=>(x.ini||"").startsWith(String(new Date().getFullYear()))).forEach(M=>{ const m=M.marca; add(m,"o2d",M.o2d!=null?M.o2d<15:null); add(m,"ph",M.phFin!=null?M.phFin<=4.6:null); });
  return out;
}
const IND=[["viab","Viabilidad levadura ≥ 95 %"],["resiembra","Resiembra ≤ 48 h"],["tlev","Temp. levadura 3–4 °C"],["presion","Presión inicio FV ≤ 2,5 PSI"],["eo","E.O mosto en rango"],["tfv","Tiempo en FV ≤ máx."],["ea72","Extracto 72 h ≤ meta"],["o2d","O₂ disuelto SV < 15 ppb"],["ph","pH final ≤ 4,6"]];
function vEspec(){
  const e=espec(), marcas=e.marcas||MARCAS, nombres=Object.keys(e.sup||{});
  const sup=nombres.map(n=>`<tr><td>${esc(n)}</td>${marcas.map(m=>td(e.sup[n][m]!=null?f(e.sup[n][m],e.sup[n][m]<0.1&&e.sup[n][m]>0?4:2):null,1)).join("")}</tr>`).join("");
  const inf=Object.keys(e.inf||{}).map(n=>`<tr><td>${esc(n)}</td>${marcas.map(m=>td(e.inf[n][m]!=null?f(e.inf[n][m],e.inf[n][m]<0.1&&e.inf[n][m]>0?4:2):null,1)).join("")}</tr>`).join("");
  const ind=indicadores(), head=`<tr><th>Indicador</th>${MARCAS.map(m=>`<th class="n">${esc(m)}</th>`).join("")}</tr>`;
  const irows=IND.map(([k,l])=>`<tr><td>${l}</td>${MARCAS.map(m=>{ const o=ind[m][k]; if(!o||!o.n) return td("—",1); const p=o.ok/o.n; return `<td class="n ${p>=0.9?"v-ok":p>=0.7?"v-warn":"v-bad"}">${f0(p*100)} % <small class="muted">(${o.n})</small></td>`; }).join("")}</tr>`).join("");
  return `${header("Especificaciones e indicadores","Límites por marca y cumplimiento de indicadores del año. Equivale a ESPECIFICACIONES MARCA y CUMPLIMIENTO INDICADORES.",`${can0()?`<button class="btn" id="cvEdEsp">Editar especificaciones</button>`:""}`)}
  ${tabsHTML("espec")}
  <div class="sec"><div class="sec-h"><h2>Cumplimiento de indicadores ${new Date().getFullYear()}</h2><span class="muted small">entre paréntesis, registros evaluados</span></div><div class="tw"><table><thead>${head}</thead><tbody>${irows}</tbody></table></div></div>
  <div class="grid2"><div><div class="sec-h"><h2>Límite superior</h2></div><div class="tw"><table><thead><tr><th>Variable</th>${marcas.map(m=>`<th class="n">${esc(m)}</th>`).join("")}</tr></thead><tbody>${sup}</tbody></table></div></div>
  <div><div class="sec-h"><h2>Límite inferior</h2></div><div class="tw"><table><thead><tr><th>Variable</th>${marcas.map(m=>`<th class="n">${esc(m)}</th>`).join("")}</tr></thead><tbody>${inf}</tbody></table></div></div></div>`;
}
function mEspec(){
  const b=$("#cvEdEsp"); if(b) b.onclick=()=>{ const e=clone(espec()), marcas=e.marcas||MARCAS, ks=Object.keys(e.sup||{});
    const campos=[]; ["sup","inf"].forEach(l=>Object.keys(e[l]||{}).forEach((n,i)=>marcas.forEach(m=>campos.push([l,n,m]))));
    const body=`<div class="cvf">${["sup","inf"].map(l=>FS(l==="sup"?"Límite superior":"Límite inferior",`<div class="cocs"><table><thead><tr><th>Variable</th>${marcas.map(m=>`<th>${esc(m)}</th>`).join("")}</tr></thead><tbody>${Object.keys(e[l]||{}).map((n,i)=>`<tr><td>${esc(n)}</td>${marcas.map(m=>`<td><input name="${l}|${i}|${m}" type="number" step="any" value="${e[l][n][m]==null?"":e[l][n][m]}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>`)).join("")}</div>`;
    App.UI.modal("Editar especificaciones por marca",body,{wide:true,ok:"Guardar",async onSubmit(fm){ ["sup","inf"].forEach(l=>Object.keys(e[l]||{}).forEach((n,i)=>marcas.forEach(m=>{ e[l][n][m]=rv(fm,`${l}|${i}|${m}`,"n"); }))); if(!await App.Store.set("config","espec",e)) return false; App.render(true); return true; }}); };
}

/* ============================================================
   CARGA DE DATOS DEL EXCEL
   ============================================================ */
function vVacioDatos(){
  return `${header("Cava","Control de proceso de cava: llenado de FV, trasiego a SV, análisis, inventario, merma y especificaciones.","")}
  <div class="card card-p" style="max-width:640px"><h3>Todavía no hay datos de cava</h3><p>Cargue los registros de 2026 del Excel «01. CONTROL PROCESO CAVAS» (llenados de FV, trasiegos a SV y el inventario de los ${NTQ} tanques) para empezar, o registre su primer llenado.</p>
  <div class="acts"><button class="btn pri" id="cvSeed" ${can0()?"":"disabled"}>Cargar datos del Excel</button><button class="btn" data-nuevo>Registrar un llenado</button></div></div>`;
}
async function cargarSeed(){
  if(!can()) return; const sd=App.SEED||{}; if(!sd.llenados){ toast("No hay datos de Excel incluidos."); return; }
  toast("Cargando datos…");
  const ok=await App.Store.setMany("llenados",sd.llenados)&&await App.Store.setMany("trasiegos",sd.trasiegos)&&await App.Store.setMany("cava",sd.cava)&&await App.Store.set("config","espec",sd.espec);
  if(ok){ toast("Datos del Excel cargados"); App.render(true); }
}

/* ============================================================
   REGISTRO DE LA VISTA
   ============================================================ */
function parts(tab,id){ return {tab:TABS.some(t=>t[0]===tab)?tab:"informe",id}; }
App.V.cava={
  _tab:"informe",
  render(tab,id){
    const p=parts(tab,id); this._tab=p.tab; const vacio=!Object.keys(S().llenados||{}).length&&!Object.keys(S().trasiegos||{}).length;
    let h;
    if(vacio&&p.tab==="informe") h=vVacioDatos();
    else if(p.tab==="informe") h=vInforme();
    else if(p.tab==="llenado") h=p.id?vLlenadoDetalle(p.id):vLlenadoLista();
    else if(p.tab==="trasiego") h=p.id?vTrasiegoDetalle(p.id):vTrasiegoLista();
    else if(p.tab==="analisis") h=vAnalisis();
    else if(p.tab==="inventario") h=vInventario();
    else if(p.tab==="merma") h=vMerma();
    else h=vEspec();
    return `<div class="cv">${h}</div>`;
  },
  mount(tab,id){
    const p=parts(tab,id), vacio=!Object.keys(S().llenados||{}).length&&!Object.keys(S().trasiegos||{}).length;
    if(vacio&&p.tab==="informe"){ const s=$("#cvSeed"); if(s) s.onclick=cargarSeed; $$("#view [data-nuevo]").forEach(b=>b.onclick=()=>llenadoForm()); return; }
    if(p.tab==="informe") mInforme();
    else if(p.tab==="llenado"){ if(p.id) mLlenadoDetalle(p.id); else bindFiltros(); }
    else if(p.tab==="trasiego"){ if(p.id) mTrasiegoDetalle(p.id); else bindFiltros(); }
    else if(p.tab==="analisis") mAnalisis();
    else if(p.tab==="inventario") mInventario();
    else if(p.tab==="merma") mMerma();
    else mEspec();
  }
};
App.Cava={kge,volEqui,syncCava,llenadoForm,trasiegoForm,cargarSeed,indicadores};
if((location.hash||"").startsWith("#/cava")&&App.render) setTimeout(()=>App.render(true),0);
})();
