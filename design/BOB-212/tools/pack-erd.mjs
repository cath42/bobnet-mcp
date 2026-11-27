// BOB-212 prototype: Liam's ERD app packed as the library frames it (ADR 0016 §6), from Toad's
// architecture/spikes/bob212/pack-liam.mjs. What it adds for the spec (§10):
// - erd-theme.css after Liam's own styles: BobNet's tokens, Liam's header hidden;
// - the messages: files {kind: "erd", schema, focus} (the prototype posts Liam's parsed schema; the build posts the
//   schema file and parses it here, 0016 build B task 3), ready {errors, tables}, focus both ways, fit.
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
for(const k of ["pushState","replaceState"]){const f=history[k];history[k]=function(...a){const r=f.apply(this,a);const now=active();if(now!==last){last=now;post({t:"focus",focus:now})}return r}}
const focus=t=>{if(t===active())return;last=t;history.pushState(null,"",t?"?active="+encodeURIComponent(t):location.pathname);dispatchEvent(new PopStateEvent("popstate"))};
let give;const schema=new Promise(r=>give=r);
addEventListener("message",e=>{if(e.source!==parent||!e.data)return;const d=e.data;
if(d.t==="files"&&d.kind==="erd"){give(d.schema);const tables=Object.keys(d.schema.tables||{});const t0=Date.now();const wait=()=>{if(document.querySelector(".react-flow__node")){post({t:"ready",errors:[],tables});if(d.focus)setTimeout(()=>focus(d.focus),300)}else if(Date.now()-t0<15000)setTimeout(wait,100)};wait()}
if(d.t==="focus")focus(d.focus||"");
if(d.t==="fit")document.querySelector('button[aria-label="Zoom to fit"]')?.click()});
const real=window.fetch;window.fetch=(u,o)=>String(u).endsWith("schema.json")?schema.then(s=>new Response(JSON.stringify(s),{headers:{"content-type":"application/json"}})):real(u,o);
post({t:"hello"})})();`;
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${theme}</style></head><body><div id="root"></div><script>${pre}</script><script type="module">${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), `${h(pre)} ${h(js)}`);
