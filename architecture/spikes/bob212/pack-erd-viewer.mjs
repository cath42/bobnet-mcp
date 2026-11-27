// BOB-212 (ADR 0017 §7, as amended for Q-22): bundles BobNet's own ERD viewer (erd-viewer.jsx, dbml-model.mjs,
// React, React Flow, dagre, @dbml/parse) with esbuild and packs it into one HTML file. The styles are React Flow's
// style.css and erd-viewer.css. Writes the CSP's script-src hash beside it: no 'unsafe-eval', no wasm.
//   node pack-erd-viewer.mjs <dir whose node_modules has esbuild, react, react-dom, @xyflow/react, @dagrejs/dagre,
//        @dbml/parse> <out erd-viewer.html>
import fs from "node:fs"; import c from "node:crypto"; import path from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const [dir, out] = process.argv.slice(2), mods = path.resolve(dir, "node_modules"), here = path.dirname(fileURLToPath(import.meta.url));
const esbuild = await import(pathToFileURL(path.join(mods, "esbuild/lib/main.js")));
const r = await esbuild.build({
  entryPoints: [path.join(here, "erd-viewer.jsx")], bundle: true, minify: true, format: "iife", platform: "browser", target: "es2022",
  jsx: "automatic", nodePaths: [mods], define: { "process.env.NODE_ENV": '"production"' }, legalComments: "none", write: false, metafile: true,
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
if (/\beval\(|new Function\(/.test(js)) throw new Error("the bundle calls eval or new Function: the CSP refuses it");
const css = fs.readFileSync(path.join(mods, "@xyflow/react/dist/style.css"), "utf8") + "\n" + fs.readFileSync(path.join(here, "erd-viewer.css"), "utf8");
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), "'sha256-" + c.createHash("sha256").update(js).digest("base64") + "'");
const kb = (n) => `${Math.round(n / 1024)} KB`, top = Object.entries(r.metafile.outputs)[0][1].inputs, by = {};
for (const [f, v] of Object.entries(top)) { const m = f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); by[m ? m[1] : "ours"] = (by[m ? m[1] : "ours"] ?? 0) + v.bytesInOutput; }
console.log(out, kb(fs.statSync(out).size), "gzip", kb((await import("node:zlib")).gzipSync(fs.readFileSync(out)).length));
console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${kb(v)}`).join(", "));
