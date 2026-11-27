// BOB-212 (ADR 0017): the ERD viewer for the library standard's data model. Liam's prebuilt app, packed into one
// HTML file, with the DBML parser (dbml-to-liam.mjs, bundled to an IIFE) in front of it. The page posts
// {t:"files", files:[{path, text}], view?, show?}; the viewer parses the DBML, picks the diagram's tables,
// sets Liam's own ?showMode= and answers the app's fetch("schema.json"). {t:"show", show} toggles it live.
// Liam drops ?showMode= at load on a narrow screen, so the viewer applies it again after the first draw.
// Writes the CSP script-src hashes beside it: no 'unsafe-eval' is needed.
import fs from "node:fs"; import c from "node:crypto"; import path from "node:path";
const [appDir, dbmlJs, out] = process.argv.slice(2);
const h = (s) => "'sha256-" + c.createHash("sha256").update(s).digest("base64") + "'";
const assets = fs.readdirSync(path.join(appDir, "assets"));
const js = fs.readFileSync(path.join(appDir, "assets", assets.find(f => /^index-.*\.js$/.test(f))), "utf8").replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(appDir, "assets", assets.find(f => /^index-.*\.css$/.test(f))), "utf8");
const parser = fs.readFileSync(dbmlJs, "utf8").replace(/<\/script/gi, "<\\/script");
const pre = `(()=>{const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};for(const n of ["localStorage","sessionStorage"])Object.defineProperty(window,n,{value:mk(),configurable:true});let ck="";Object.defineProperty(document,"cookie",{get:()=>ck,set:v=>{ck=String(v).split(";")[0]},configurable:true});
const MODE={tables:"TABLE_NAME",keys:"KEY_ONLY",columns:"ALL_FIELDS"};const url=s=>{const u=new URL(location.href);u.searchParams.set("showMode",MODE[s]||"TABLE_NAME");return u.search};
let give;const schema=new Promise(r=>give=r);
addEventListener("message",e=>{if(e.source!==parent||!e.data)return;const d=e.data;
 if(d.t==="files"){const f=d.files[0],r=window.dbmlToLiam(f.text);const errors=r.errors.map(x=>({path:f.path,...x}));
  if(!r.schema){parent.postMessage({t:"ready",errors},"*");return}
  const v=d.view&&r.views.find(x=>x.id===d.view);history.replaceState(null,"",url(d.show));give(v?window.dbmlOnly(r.schema,v.tables):r.schema);
  const tables=Object.values(r.schema.tables).map(t=>({name:t.name,comment:t.comment,columns:Object.values(t.columns).map(c=>({name:c.name,type:c.type,notNull:c.notNull,comment:c.comment}))}));
  setTimeout(()=>{history.pushState(null,"",url(d.show));dispatchEvent(new PopStateEvent("popstate"));parent.postMessage({t:"ready",errors,views:r.views,tables,note:r.note},"*")},1500)}
 if(d.t==="show"){history.pushState(null,"",url(d.show));dispatchEvent(new PopStateEvent("popstate"))}});
const real=window.fetch;window.fetch=(u,o)=>String(u).endsWith("schema.json")?schema.then(s=>new Response(JSON.stringify(s),{headers:{"content-type":"application/json"}})):real(u,o);
parent.postMessage({t:"hello"},"*")})();`;
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${parser}</script><script>${pre}</script><script type="module">${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), `${h(parser)} ${h(pre)} ${h(js)}`);
