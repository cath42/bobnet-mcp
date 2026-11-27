// BOB-212 prototype v5: the ERD viewer, BobNet's own (ADR 0017 §7 as amended for Q-22): Toad's
// architecture/spikes/bob212/erd-viewer.jsx and dbml-model.mjs, bundled as Toad's pack-erd-viewer.mjs does, with
// two changes for the phone (spec §11.3), applied here as checked patches on his source and proposed back to him:
// - one node size on every device: HEAD 40 and TOG 52 on a coarse pointer too (his were 48 and 64);
// - the viewport's zoom as --z on the frame's root, so erd-node.css keeps the control's tap target >= 44 px on screen.
// The styles: React Flow's style.css, Toad's erd-viewer.css, then erd-node.css. Writes the CSP's one hash beside it.
//   node pack-erd.mjs <dir whose node_modules has esbuild, react, react-dom, @xyflow/react, @dagrejs/dagre, @dbml/parse 13>
//        <out erd-viewer.html>
import fs from "node:fs"; import c from "node:crypto"; import path from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const [dir, out] = process.argv.slice(2), mods = path.resolve(dir, "node_modules"), here = path.dirname(fileURLToPath(import.meta.url));
const spike = path.join(here, "../../../architecture/spikes/bob212");
const esbuild = await import(pathToFileURL(path.join(mods, "esbuild/lib/main.js")));
const PATCHES = [
  ["const HEAD = coarse ? 48 : 40, ROW = 26, PAD = 12, TOG = coarse ? 64 : 52", "const HEAD = 40, ROW = 26, PAD = 12, TOG = 52"],
  ["import { Background, Controls,", "import { useStore } from \"@xyflow/react\";\nimport { Background, Controls,"],
  ["  const rf = useReactFlow();\n", "  const rf = useReactFlow(), zoom = useStore((s) => s.transform[2]);\n  useEffect(() => document.documentElement.style.setProperty(\"--z\", String(zoom)), [zoom]);\n"],
];
const patch = {
  name: "bob212-v5", setup(b) {
    b.onLoad({ filter: /erd-viewer\.jsx$/ }, (a) => {
      let src = fs.readFileSync(a.path, "utf8");
      for (const [from, to] of PATCHES) { if (!src.includes(from)) throw new Error(`erd-viewer.jsx changed: no "${from.slice(0, 50)}"`); src = src.replace(from, to); }
      return { contents: src, loader: "jsx", resolveDir: path.dirname(a.path) };
    });
  },
};
const r = await esbuild.build({
  entryPoints: [path.join(spike, "erd-viewer.jsx")], bundle: true, minify: true, format: "iife", platform: "browser", target: "es2022",
  jsx: "automatic", nodePaths: [mods], define: { "process.env.NODE_ENV": '"production"' }, legalComments: "none", write: false, plugins: [patch],
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
if (/\beval\(|new Function\(/.test(js)) throw new Error("the bundle calls eval or new Function: the CSP refuses it");
const css = [path.join(mods, "@xyflow/react/dist/style.css"), path.join(spike, "erd-viewer.css"), path.join(here, "erd-node.css")].map((f) => fs.readFileSync(f, "utf8")).join("\n");
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
fs.writeFileSync(out.replace(/\.html$/, ".hash"), "'sha256-" + c.createHash("sha256").update(js).digest("base64") + "'");
console.log(out, `${Math.round(fs.statSync(out).size / 1024)} KB`);
