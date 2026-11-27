// BOB-212 prototype v4: the ERD viewer for the library standard's data model (ADR 0017 §7), Liam's prebuilt app
// packed into one HTML file. It joins Toad's architecture/spikes/bob212/pack-erd-dbml.mjs (DBML parsed in the frame,
// the diagram, the show mode) and v3's card messages (spec §10, §14):
// - erd-theme.css after Liam's own styles: BobNet's tokens; Liam's header and table drawer hidden;
// - in: files {kind: "erd", files: [{path, text}], view?, show?, focus?}. The viewer parses the DBML, hands Liam only
//   the diagram's tables (dbmlOnly) and sets Liam's own ?showMode=. {t: "show", show} toggles it live, {t: "focus"}
//   opens a table, {t: "fit"}, {t: "inset", right, bottom} (the part of the frame the entity card covers);
// - out: hello; ready {errors, views, note, tables, enums, shown}; focus (Liam's ?active= changed); show (Liam's own
//   show menu changed it); hover {table, rect} per change of table;
// - Liam drops ?showMode= when it loads on a narrow screen, so the viewer sets it again after the first draw;
// - a table the page opens is opened as a click on it would (Liam centres it), then nudged by half the inset with a
//   synthetic wheel. The build does that through React Flow (ADR 0016 §6, setCenter).
// Liam keeps the open table in ?active= and the mode in ?showMode=; the preamble changes one and keeps the other.
// No 'unsafe-eval': the CSP's script-src is the three hashes written beside it.
//   node pack-erd.mjs <@liam-hq/cli 0.7.24>/dist-cli/html <dbml.js, from dbml-entry.mjs> <out erd-viewer.html>
import fs from "node:fs"; import c from "node:crypto"; import path from "node:path"; import { fileURLToPath } from "node:url";
const [appDir, dbmlJs, out] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const h = (s) => "'sha256-" + c.createHash("sha256").update(s).digest("base64") + "'";
const assets = fs.readdirSync(path.join(appDir, "assets"));
const js = fs.readFileSync(path.join(appDir, "assets", assets.find((f) => /^index-.*\.js$/.test(f))), "utf8").replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(appDir, "assets", assets.find((f) => /^index-.*\.css$/.test(f))), "utf8");
const parser = fs.readFileSync(dbmlJs, "utf8").replace(/<\/script/gi, "<\\/script");
const theme = fs.readFileSync(path.join(here, "erd-theme.css"), "utf8");
const pre = `(()=>{const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};for(const n of ["localStorage","sessionStorage"])Object.defineProperty(window,n,{value:mk(),configurable:true});let ck="";Object.defineProperty(document,"cookie",{get:()=>ck,set:v=>{ck=String(v).split(";")[0]},configurable:true});
const post=m=>parent.postMessage(m,"*");
const MODE={tables:"TABLE_NAME",keys:"KEY_ONLY",columns:"ALL_FIELDS"},BACK={TABLE_NAME:"tables",KEY_ONLY:"keys",ALL_FIELDS:"columns"};
const q=()=>new URLSearchParams(location.search);const active=()=>q().get("active")||"";const mode=()=>BACK[q().get("showMode")]||"";
const at=(set)=>{const u=q();for(const[k,v]of Object.entries(set))v?u.set(k,v):u.delete(k);const s=u.toString();return location.pathname+(s?"?"+s:"")};
const go=(set)=>{history.pushState(null,"",at(set));dispatchEvent(new PopStateEvent("popstate"))};
let last="",lastMode="",want="tables",inset={right:0,bottom:0},shown=new Set();
const pan=(dx,dy)=>{const p=document.querySelector(".react-flow__pane");if(!p||(Math.abs(dx)<2&&Math.abs(dy)<2))return;const b=p.getBoundingClientRect();
p.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,view:window,clientX:b.left+b.width/2,clientY:b.top+b.height/2,deltaX:-2*dx,deltaY:-2*dy,deltaMode:0}))};
const settle=()=>setTimeout(()=>pan(-inset.right/2,-inset.bottom/2),450);
for(const k of ["pushState","replaceState"]){const f=history[k];history[k]=function(...a){const r=f.apply(this,a);const now=active();if(now!==last){last=now;post({t:"focus",focus:now});if(now)settle()}const m=mode();if(m&&m!==lastMode){lastMode=m;if(m!==want){want=m;post({t:"show",show:m})}}return r}}
const focus=t=>{if(t===active())return;if(t&&!shown.has(t))t="";const n=t&&document.querySelector('.react-flow__node[data-id="'+CSS.escape(t)+'"]');if(n){n.click();return}
last=t;go({active:t});if(t)settle()};
let give;const schema=new Promise(r=>give=r);
addEventListener("message",e=>{if(e.source!==parent||!e.data)return;const d=e.data;
 if(d.t==="files"&&d.kind==="erd"){const f=d.files[0],r=window.dbmlToLiam(f.text);const errors=r.errors.map(x=>({path:f.path,...x}));
  if(!r.schema){post({t:"ready",errors,views:[],tables:[]});return}
  const v=d.view&&r.views.find(x=>x.id===d.view);const s=v?window.dbmlOnly(r.schema,v.tables):r.schema;shown=new Set(Object.keys(s.tables));
  want=MODE[d.show]?d.show:"tables";lastMode=want;history.replaceState(null,"",at({showMode:MODE[want]}));give(s);
  const x=window.dbmlExtras(f.text);
  const tables=Object.values(r.schema.tables).map(t=>{const cs=Object.values(t.constraints||{});return{name:t.name,comment:t.comment||null,line:x.lines[t.name]??null,
   columns:Object.values(t.columns).map(c=>({name:c.name,type:c.type,notNull:!!c.notNull,default:c.default??null,unique:cs.some(k=>k.type==="UNIQUE"&&k.columnNames.length===1&&k.columnNames[0]===c.name),comment:c.comment||null})),
   pk:cs.filter(k=>k.type==="PRIMARY KEY").flatMap(k=>k.columnNames),fks:cs.filter(k=>k.type==="FOREIGN KEY").map(k=>({columns:k.columnNames,table:k.targetTableName,targetColumns:k.targetColumnNames}))}});
  const t0=Date.now();const wait=()=>{if(document.querySelector(".react-flow__node")){
    // Liam drops ?showMode= on a narrow screen when it loads: set it again once drawn.
    setTimeout(()=>{if(mode()!==want){lastMode=want;go({showMode:MODE[want]})}post({t:"ready",errors,views:r.views,note:r.note,tables,enums:x.enums,shown:[...shown]});if(d.focus)setTimeout(()=>focus(d.focus),300)},400)}
   else if(Date.now()-t0<15000)setTimeout(wait,100)};wait()}
 if(d.t==="show"&&MODE[d.show]){want=d.show;lastMode=want;go({showMode:MODE[want]})}
 if(d.t==="focus")focus(d.focus||"");
 if(d.t==="inset")inset={right:+d.right||0,bottom:+d.bottom||0};
 if(d.t==="fit")document.querySelector('button[aria-label="Zoom to fit"]')?.click()});
const add=document.addEventListener;document.addEventListener=function(t,f,o){if(t==="mousedown"&&(o===true||o?.capture)){const g=f;f=e=>{if(e.target instanceof Element&&e.target.closest(".react-flow"))return;g(e)}}return add.call(this,t,f,o)};
let hov=null;addEventListener("mouseover",e=>{const n=e.target instanceof Element?e.target.closest(".react-flow__node"):null;const id=n?n.getAttribute("data-id"):null;if(id===hov)return;hov=id;if(!n)return post({t:"hover",table:null});const r=n.getBoundingClientRect();post({t:"hover",table:id,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})});
document.documentElement.addEventListener("mouseleave",()=>{if(hov!==null){hov=null;post({t:"hover",table:null})}});
const real=window.fetch;window.fetch=(u,o)=>String(u).endsWith("schema.json")?schema.then(s=>new Response(JSON.stringify(s),{headers:{"content-type":"application/json"}})):real(u,o);
post({t:"hello"})})();`;
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${theme}</style></head><body><div id="root"></div><script>${parser}</script><script>${pre}</script><script type="module">${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), `${h(parser)} ${h(pre)} ${h(js)}`);
