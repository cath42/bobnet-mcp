// Packs a bundle into one self-contained viewer HTML: a storage shim (opaque origins have no
// localStorage), then the module. Writes the CSP script-src hashes beside it.
import fs from "node:fs"; import c from "node:crypto";
const [bundle, out] = process.argv.slice(2);
const h = (s) => "'sha256-" + c.createHash("sha256").update(s).digest("base64") + "'";
const shim = `(()=>{const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};for(const n of ["localStorage","sessionStorage"])Object.defineProperty(window,n,{value:mk(),configurable:true})})();`;
const js = fs.readFileSync(bundle, "utf8").replace(/<\/script/gi, "<\\/script");
fs.writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script>${shim}</script><script type="module">${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), `${h(shim)} ${h(js)}`);
