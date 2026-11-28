// BOB-212 (ADR 0017 §7, Casper's Q-23 "Liam as is"): the data model viewer is Liam ERD's own prebuilt app, unpatched,
// in one HTML file. In front of it, in the same sandboxed frame:
//   - DBML's official exporter (@dbml/core, exporter.export(dbml, "postgres")) turns the library's DBML into DDL;
//   - Liam's own Postgres parser (@liam-hq/schema's sql processor) reads that DDL into the schema JSON Liam's app draws;
//   - a frame shell shims storage for the opaque origin and answers the app's fetch("schema.json").
// No viewer code of ours and no stylesheet of ours. Liam's JS and CSS go in byte for byte.
// The bundle leaves out @dbml/core's SQL importers (14.6 MB of ANTLR parsers that export never calls): they are
// replaced by stubs that throw. The DDL is then checked against the unbundled exporter's (liam-as-is-test.mjs).
// usage: node pack-liam-as-is.mjs <deps dir: @dbml/core, @liam-hq/schema, esbuild> <liam cli dist-cli/html> <out.html>
import fs from "node:fs"; import c from "node:crypto"; import path from "node:path"; import { createRequire } from "node:module";
const [deps, appDir, out] = process.argv.slice(2).map((p) => path.resolve(p));
const { build } = createRequire(path.join(deps, "package.json"))("esbuild");
const h = (s) => "'sha256-" + c.createHash("sha256").update(s).digest("base64") + "'";

const entry = `import { exporter } from "@dbml/core";
import { processor } from "./node_modules/@liam-hq/schema/dist/parser/sql/index.js"; // Liam's Postgres reader, not in its exports map
window.dbmlToLiam = async (text) => {
  let sql;
  try { sql = exporter.export(text, "postgres"); }
  catch (e) { return { schema: null, sql: null, errors: (e.diags ?? [e]).map((d) => ({ line: d.location?.start?.line ?? 0, message: d.message })) }; }
  const r = await processor(sql);
  return { schema: r.value, sql, errors: r.errors.map((e) => ({ line: 0, message: "the viewer couldn't read the converted model: " + e.message })) };
};`;
const stubImporters = { name: "stub-importers", setup(b) {
  b.onResolve({ filter: /(ANTLR\/ASTGeneration\/index|deprecated\/\w+Parser)\.mjs$/ }, (a) => ({ path: a.path, namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: /ASTGeneration/.test(a.path)
    ? `export function parse() { throw new Error("SQL import is not in this bundle"); }`
    : `export function ${a.path.match(/(\w+Parser)\.mjs$/)[1].replace(/^./, (x) => "require_" + x)}() { return {}; }` }));
} };
const r = await build({ stdin: { contents: entry, resolveDir: deps }, bundle: true, minify: true, format: "iife", platform: "browser",
  alias: { "node:module": path.join(path.dirname(new URL(import.meta.url).pathname), "node-module-stub.js") },
  plugins: [stubImporters], write: false, logLevel: "error" });
const parser = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const assets = fs.readdirSync(path.join(appDir, "assets"));
const js = fs.readFileSync(path.join(appDir, "assets", assets.find((f) => /^index-.*\.js$/.test(f))), "utf8").replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(appDir, "assets", assets.find((f) => /^index-.*\.css$/.test(f))), "utf8");
// The frame shell: the page posts {t:"files", kind:"erd", files:[{path, text}]}; the shell answers {t:"ready", errors, tables}.
const pre = `(()=>{const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};for(const n of ["localStorage","sessionStorage"])Object.defineProperty(window,n,{value:mk(),configurable:true});let ck="";Object.defineProperty(document,"cookie",{get:()=>ck,set:v=>{ck=String(v).split(";")[0]},configurable:true});
let give;const schema=new Promise(r=>give=r);
addEventListener("message",async e=>{if(e.source!==parent||!e.data||e.data.t!=="files")return;const f=e.data.files[0],r=await window.dbmlToLiam(f.text);
 const errors=r.errors.map(x=>({path:f.path,...x}));if(r.schema)give(r.schema);parent.postMessage({t:"ready",errors,tables:r.schema?Object.keys(r.schema.tables).length:0},"*")});
const real=window.fetch;window.fetch=(u,o)=>String(u).endsWith("schema.json")?schema.then(s=>new Response(JSON.stringify(s),{headers:{"content-type":"application/json"}})):real(u,o);
parent.postMessage({t:"hello"},"*")})();`;
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${parser}</script><script>${pre}</script><script type="module">${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), `${h(parser)} ${h(pre)} ${h(js)}`);
const size = (s) => (s / 1e6).toFixed(2) + " MB";
console.log(`${out}: ${size(fs.statSync(out).size)}, parser ${size(parser.length)}, Liam app ${size(js.length + css.length)}`);
