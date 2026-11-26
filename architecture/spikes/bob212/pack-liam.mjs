// Packs Liam's prebuilt ERD app into one sandboxed viewer HTML. A preamble shims storage and answers the
// app's fetch("schema.json") with what the dashboard posts in. Writes the CSP script-src hashes beside it.
import fs from "node:fs"; import c from "node:crypto"; import path from "node:path";
const [appDir, out] = process.argv.slice(2);
const h = (s) => "'sha256-" + c.createHash("sha256").update(s).digest("base64") + "'";
const assets = fs.readdirSync(path.join(appDir, "assets"));
const js = fs.readFileSync(path.join(appDir, "assets", assets.find(f => /^index-.*\.js$/.test(f))), "utf8").replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(appDir, "assets", assets.find(f => /^index-.*\.css$/.test(f))), "utf8");
const pre = `(()=>{const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};for(const n of ["localStorage","sessionStorage"])Object.defineProperty(window,n,{value:mk(),configurable:true});let ck="";Object.defineProperty(document,"cookie",{get:()=>ck,set:v=>{ck=String(v).split(";")[0]},configurable:true});
let give;const schema=new Promise(r=>give=r);addEventListener("message",e=>{if(e.source===parent&&e.data&&e.data.t==="schema")give(e.data.schema)});
const real=window.fetch;window.fetch=(u,o)=>String(u).endsWith("schema.json")?schema.then(s=>new Response(JSON.stringify(s),{headers:{"content-type":"application/json"}})):real(u,o);
parent.postMessage({t:"hello"},"*")})();`;
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${pre}</script><script type="module">${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), `${h(pre)} ${h(js)}`);
