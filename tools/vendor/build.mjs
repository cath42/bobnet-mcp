// BOB-212 (ADR 0016 §7, 0017 §7): packs the library's two diagram viewers, each one self-contained HTML file that the
// dashboard frames with sandbox="allow-scripts", into packages/broker/public/vendor/:
//   - likec4-viewer-<likec4>.html: likec4-viewer.jsx (LikeC4's React viewer, 0016 §7's settings) bundled with esbuild;
//   - erd-viewer-<liam>.html: Liam ERD as is (Casper's Q-23), from architecture/spikes/bob212/pack-liam-as-is.mjs. Liam
//     CLI's prebuilt app byte for byte, after DBML's official exporter (@dbml/core) and Liam's own Postgres parser
//     (@liam-hq/schema), which turn the library's DBML into the schema JSON the app fetches;
//   - viewers.json: each viewer's file and its script hashes, which the Worker puts in the viewer's CSP;
//   - THIRD_PARTY.txt: every package whose code is in a viewer, its version and licence, and the licence texts.
// It also writes the fixtures the broker's frame tests compare the viewers against (test-ui/fixtures/viewers/): the
// sample's DBML through the unbundled exporter, and the Liam CLI's own parse of that DDL. A version bump is a change
// here and in package.json: re-run, re-run the broker's tests, look at the shots.
//   cd tools/vendor && npm ci && node build.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");
const out = join(repo, "packages/broker/public/vendor");
const fixtures = join(repo, "packages/broker/test-ui/fixtures/viewers");
const SAMPLE = join(repo, "architecture/spikes/bob212/sample/library");
const require = createRequire(join(here, "package.json"));
const pkg = (name) => JSON.parse(readFileSync(join(here, "node_modules", name, "package.json"), "utf8"));
const pins = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).dependencies;
for (const [name, version] of Object.entries(pins)) {
  if (pkg(name).version !== version) throw new Error(`${name} is ${pkg(name).version} in node_modules, pinned ${version}: npm ci`);
}
const hash = (s) => "'sha256-" + createHash("sha256").update(s).digest("base64") + "'";
const inline = (s) => s.replace(/<\/script/gi, "<\\/script");
// The storage an opaque origin lacks (it throws on localStorage, sessionStorage and document.cookie), in memory.
const SHIM = `(()=>{const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};for(const n of ["localStorage","sessionStorage"])Object.defineProperty(window,n,{value:mk(),configurable:true});let ck="";Object.defineProperty(document,"cookie",{get:()=>ck,set:v=>{ck=String(v).split(";")[0]},configurable:true})})();`;

/** The package each bundled file came from, for THIRD_PARTY.txt. */
const used = new Map();
function credit(metafile) {
  for (const file of Object.keys(metafile.inputs)) {
    const m = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g);
    if (!m) continue;
    const dir = join(here, file.slice(0, file.lastIndexOf(m.at(-1)) + m.at(-1).length));
    if (existsSync(join(dir, "package.json"))) used.set(dir, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));
  }
}

// ---------- LikeC4: the spike's esbuild settings (architecture/spikes/bob212/README.md) ----------
const likec4 = await build({
  entryPoints: [join(here, "likec4-viewer.jsx")], bundle: true, minify: true, format: "esm", platform: "browser",
  jsx: "automatic", loader: { ".wasm": "binary" }, metafile: true, write: false, outdir: "out", logLevel: "error",
  alias: { "node:events": "events", "node:module": join(here, "node-module-stub.js") },
  define: { "import.meta.env": JSON.stringify({ DEV: false, PROD: true, SSR: false, MODE: "production", BASE_URL: "/" }), "process.env.NODE_ENV": '"production"' },
});
credit(likec4.metafile);
const lcJs = inline(likec4.outputFiles.find((f) => f.path.endsWith(".js")).text);
const lcCss = likec4.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
const likec4Html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${lcCss ? `<style>${lcCss}</style>` : ""}</head><body style="margin:0"><div id="root"></div><script>${SHIM}</script><script type="module">${lcJs}</script></body></html>`;

// ---------- Liam ERD as is (pack-liam-as-is.mjs) ----------
// @dbml/core's SQL importers (14.6 MB of ANTLR parsers that export never calls) are stubbed; the broker's test checks
// that the frame's DDL is still the unbundled exporter's.
const entry = `import { exporter } from "@dbml/core";
import { processor } from "./node_modules/@liam-hq/schema/dist/parser/sql/index.js"; // Liam's Postgres reader, not in its exports map
window.dbmlToLiam = async (text) => {
  let sql;
  try { sql = exporter.export(text, "postgres"); }
  catch (e) { return { schema: null, sql: null, errors: (e.diags ?? [e]).map((d) => ({ line: d.location?.start?.line ?? 0, message: d.message })) }; }
  const r = await processor(sql);
  if (r.errors.length) return { schema: null, sql, errors: [{ line: 0, message: "The viewer couldn't read the converted model: " + r.errors[0].message }] };
  return { schema: r.value, sql, errors: [] };
};`;
const stubImporters = { name: "stub-importers", setup(b) {
  b.onResolve({ filter: /(ANTLR\/ASTGeneration\/index|deprecated\/\w+Parser)\.mjs$/ }, (a) => ({ path: a.path, namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: /ASTGeneration/.test(a.path)
    ? `export function parse() { throw new Error("SQL import is not in this bundle"); }`
    : `export function ${a.path.match(/(\w+Parser)\.mjs$/)[1].replace(/^./, (x) => "require_" + x)}() { return {}; }` }));
} };
const parserBuild = await build({ stdin: { contents: entry, resolveDir: here }, bundle: true, minify: true, format: "iife", platform: "browser",
  alias: { "node:module": join(here, "node-module-stub.js") }, plugins: [stubImporters], metafile: true, write: false, logLevel: "error" });
credit(parserBuild.metafile);
const parser = inline(parserBuild.outputFiles[0].text);
const app = join(here, "node_modules/@liam-hq/cli/dist-cli/html/assets");
const asset = (re) => {
  const found = readdirSync(app).filter((f) => re.test(f));
  if (found.length !== 1) throw new Error(`Liam's app: expected one ${re} in ${app}, found ${found.length}: a Liam release changed its build`);
  return readFileSync(join(app, found[0]), "utf8");
};
const liamJs = inline(asset(/^index-.*\.js$/)), liamCss = asset(/^index-.*\.css$/);
// The frame shell: the page posts {t:"files", kind:"erd", files:[{path, text}]}; the shell answers {t:"ready", errors,
// tables}, and Liam's fetch("schema.json") with the parse. It draws nothing and styles nothing.
const shell = `(()=>{let give;const schema=new Promise(r=>give=r);let done=false;
addEventListener("message",async e=>{if(e.source!==parent||!e.data||e.data.t!=="files"||e.data.kind!=="erd"||done)return;done=true;const f=e.data.files[0],r=await window.dbmlToLiam(f.text);
 const errors=r.errors.map(x=>({path:f.path,...x}));if(r.schema)give(r.schema);parent.postMessage({t:"ready",errors,tables:r.schema?Object.keys(r.schema.tables).length:0},"*")});
const real=window.fetch;window.fetch=(u,o)=>String(u).endsWith("schema.json")?schema.then(s=>new Response(JSON.stringify(s),{headers:{"content-type":"application/json"}})):real(u,o);
parent.postMessage({t:"hello"},"*")})();`;
const erdHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${liamCss}</style></head><body><div id="root"></div><script>${SHIM}</script><script>${parser}</script><script>${shell}</script><script type="module">${liamJs}</script></body></html>`;

// ---------- the fixtures: the unbundled exporter's DDL for the sample, and the Liam CLI's parse of it ----------
const dbml = readFileSync(join(SAMPLE, "data-model.dbml"), "utf8");
const ddl = require("@dbml/core").exporter.export(dbml, "postgres");
const tmp = mkdtempSync(join(tmpdir(), "bobnet-vendor-"));
writeFileSync(join(tmp, "schema.sql"), ddl);
execFileSync(join(here, "node_modules/.bin/liam"), ["erd", "build", "--format", "postgres", "--input", join(tmp, "schema.sql"), "--output-dir", join(tmp, "out")], { cwd: tmp, stdio: "pipe" });
const cliSchema = readFileSync(join(tmp, "out/schema.json"), "utf8");
rmSync(tmp, { recursive: true, force: true });
if (Object.keys(JSON.parse(cliSchema).tables).length !== 9) throw new Error("the Liam CLI didn't read the sample's 9 tables");

// ---------- write ----------
const viewers = {
  likec4: { file: `likec4-viewer-${pins.likec4}.html`, html: likec4Html, scripts: [hash(SHIM), hash(lcJs)] },
  erd: { file: `erd-viewer-${pins["@liam-hq/cli"]}.html`, html: erdHtml, scripts: [hash(SHIM), hash(parser), hash(shell), hash(liamJs)] },
};
// A file is cached immutable by its name, so new content needs a new name: refuse to change a viewer under its old one.
const before = existsSync(join(out, "viewers.json")) ? JSON.parse(readFileSync(join(out, "viewers.json"), "utf8")) : {};
for (const [kind, v] of Object.entries(viewers)) {
  const was = before[kind];
  if (was?.file === v.file && was.sha256 !== createHash("sha256").update(v.html).digest("hex")) {
    throw new Error(`${v.file} would change under the same name: bump the viewer's pin (its name), the browsers cache it immutable`);
  }
}
for (const f of readdirSync(out)) if (/^(likec4|erd)-viewer-.*\.html$/.test(f)) rmSync(join(out, f));
const manifest = {};
for (const [kind, v] of Object.entries(viewers)) {
  writeFileSync(join(out, v.file), v.html);
  manifest[kind] = { file: v.file, scripts: v.scripts, bytes: Buffer.byteLength(v.html), sha256: createHash("sha256").update(v.html).digest("hex") };
  console.log(`${v.file}: ${(Buffer.byteLength(v.html) / 1e6).toFixed(2)} MB`);
}
manifest.pins = pins;
writeFileSync(join(out, "viewers.json"), JSON.stringify(manifest, null, 2) + "\n");
mkdirSync(fixtures, { recursive: true });
writeFileSync(join(fixtures, "toolshed.sql"), ddl);
writeFileSync(join(fixtures, "toolshed.liam.json"), cliSchema);

// THIRD_PARTY.txt: Liam's app is prebuilt, so it is credited as @liam-hq/cli; the rest from esbuild's inputs.
const cli = join(here, "node_modules/@liam-hq/cli");
used.set(cli, pkg("@liam-hq/cli"));
const texts = new Map();
const rows = [...used.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([dir, p]) => {
  const lic = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  const text = lic ? readFileSync(join(dir, lic), "utf8").trim() : null;
  if (text) texts.set(text, [...(texts.get(text) ?? []), `${p.name} ${p.version}`]);
  const licence = typeof p.license === "string" ? p.license : p.license?.type ?? "see its package";
  return `${p.name} ${p.version}  ${licence}${text ? "" : "  (no licence file in the package)"}`;
});
writeFileSync(join(out, "THIRD_PARTY.txt"), [
  `The library's diagram viewers (${viewers.likec4.file}, ${viewers.erd.file}), packed by tools/vendor/build.mjs.`,
  "Every package whose code is in them, its version and its licence. Liam ERD's app is Liam's own prebuilt bundle,",
  "credited as @liam-hq/cli; the packages it carries are under their own licences, as Liam publishes it.",
  "",
  ...rows,
  "",
  ...[...texts.entries()].map(([text, names]) => `${"-".repeat(78)}\n${names.join(", ")}\n\n${text}\n`),
].join("\n"));
console.log(`THIRD_PARTY.txt: ${rows.length} packages`);
