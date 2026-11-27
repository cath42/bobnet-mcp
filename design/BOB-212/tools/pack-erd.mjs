// BOB-212 prototype: Liam's ERD app packed as the library frames it (ADR 0016 §6), from Toad's
// architecture/spikes/bob212/pack-liam.mjs. What it adds for the spec (§10):
// - erd-theme.css after Liam's own styles: BobNet's tokens, Liam's header hidden;
// - the messages: files {kind: "erd", schema, focus} (the prototype posts Liam's parsed schema; the build posts the
//   schema file and parses it here, 0016 build B task 3), ready {errors, tables}, focus both ways, fit;
// - version 3: ready.tables is each table's name, comment, columns and foreign keys, so the page draws the entity
//   card without parsing SQL; {t: "hover", table, rect} when the pointer enters or leaves a table (frame px, one
//   message per change). Liam's drawer is hidden (erd-theme.css), and its "mousedown outside the drawer closes it"
//   is kept off the canvas, so a pan or a click on another table keeps a table focused;
// - {t: "inset", right, bottom} from the page: the part of the frame the entity card covers. A table the page opens
//   is opened as a click on it would (Liam centres it), and then the canvas is moved by half the inset, so the table
//   sits in the part the card leaves free. Liam pans on scroll (at half the wheel's delta), so the prototype
//   moves it with a synthetic wheel; the build should ask React
//   Flow directly (spec §15).
// Liam keeps the focused table in its own ?active=; the preamble reads and writes that.
//   node pack-erd.mjs <@liam-hq/cli>/dist-cli/html <out erd-viewer.html>
import fs from "node:fs"; import c from "node:crypto"; import path from "node:path"; import { fileURLToPath } from "node:url";
const [appDir, out] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const h = (s) => "'sha256-" + c.createHash("sha256").update(s).digest("base64") + "'";
const assets = fs.readdirSync(path.join(appDir, "assets"));
const js = fs.readFileSync(path.join(appDir, "assets", assets.find((f) => /^index-.*\.js$/.test(f))), "utf8").replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(appDir, "assets", assets.find((f) => /^index-.*\.css$/.test(f))), "utf8");
const theme = fs.readFileSync(path.join(here, "erd-theme.css"), "utf8");
const pre = `(()=>{const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};for(const n of ["localStorage","sessionStorage"])Object.defineProperty(window,n,{value:mk(),configurable:true});let ck="";Object.defineProperty(document,"cookie",{get:()=>ck,set:v=>{ck=String(v).split(";")[0]},configurable:true});
const post=m=>parent.postMessage(m,"*");const active=()=>new URLSearchParams(location.search).get("active")||"";let last="";
let inset={right:0,bottom:0};
const pan=(dx,dy)=>{const p=document.querySelector(".react-flow__pane");if(!p||(Math.abs(dx)<2&&Math.abs(dy)<2))return;const b=p.getBoundingClientRect();
p.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,view:window,clientX:b.left+b.width/2,clientY:b.top+b.height/2,deltaX:-2*dx,deltaY:-2*dy,deltaMode:0}))};
const settle=()=>setTimeout(()=>pan(-inset.right/2,-inset.bottom/2),450);
for(const k of ["pushState","replaceState"]){const f=history[k];history[k]=function(...a){const r=f.apply(this,a);const now=active();if(now!==last){last=now;post({t:"focus",focus:now});if(now)settle()}return r}}
const focus=t=>{if(t===active())return;const n=t&&document.querySelector('.react-flow__node[data-id="'+CSS.escape(t)+'"]');if(n){n.click();return}
last=t;history.pushState(null,"",t?"?active="+encodeURIComponent(t):location.pathname);dispatchEvent(new PopStateEvent("popstate"));if(t)settle()};
let give;const schema=new Promise(r=>give=r);
addEventListener("message",e=>{if(e.source!==parent||!e.data)return;const d=e.data;
if(d.t==="files"&&d.kind==="erd"){give(d.schema);const tables=Object.values(d.schema.tables||{}).map(t=>({name:t.name,comment:t.comment||null,columns:Object.values(t.columns||{}).map(c=>({name:c.name,type:c.type,notNull:!!c.notNull,comment:c.comment||null})),pk:Object.values(t.constraints||{}).filter(c=>c.type==="PRIMARY KEY").flatMap(c=>c.columnNames),fks:Object.values(t.constraints||{}).filter(c=>c.type==="FOREIGN KEY").map(c=>({columns:c.columnNames,table:c.targetTableName,targetColumns:c.targetColumnNames}))}));const t0=Date.now();const wait=()=>{if(document.querySelector(".react-flow__node")){post({t:"ready",errors:[],tables});if(d.focus)setTimeout(()=>focus(d.focus),300)}else if(Date.now()-t0<15000)setTimeout(wait,100)};wait()}
if(d.t==="focus")focus(d.focus||"");
if(d.t==="inset")inset={right:+d.right||0,bottom:+d.bottom||0};
if(d.t==="fit")document.querySelector('button[aria-label="Zoom to fit"]')?.click()});
const add=document.addEventListener;document.addEventListener=function(t,f,o){if(t==="mousedown"&&(o===true||o?.capture)){const g=f;f=e=>{if(e.target instanceof Element&&e.target.closest(".react-flow"))return;g(e)}}return add.call(this,t,f,o)};
let hov=null;addEventListener("mouseover",e=>{const n=e.target instanceof Element?e.target.closest(".react-flow__node"):null;const id=n?n.getAttribute("data-id"):null;if(id===hov)return;hov=id;if(!n)return post({t:"hover",table:null});const r=n.getBoundingClientRect();post({t:"hover",table:id,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})});
document.documentElement.addEventListener("mouseleave",()=>{if(hov!==null){hov=null;post({t:"hover",table:null})}});
const real=window.fetch;window.fetch=(u,o)=>String(u).endsWith("schema.json")?schema.then(s=>new Response(JSON.stringify(s),{headers:{"content-type":"application/json"}})):real(u,o);
post({t:"hello"})})();`;
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${theme}</style></head><body><div id="root"></div><script>${pre}</script><script type="module">${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), `${h(pre)} ${h(js)}`);
