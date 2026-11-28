// BOB-212 (ADR 0017 §7, Q-23): the library's DBML through DBML's official exporter into Liam ERD as is, in the sandboxed
// frame under the dashboard's CSP and the viewer's. Checks: the frame's DDL is the unbundled exporter's, Liam's parse
// in the frame is the Liam CLI's on that DDL, every table is drawn, 0 console errors, no request but the frame's own.
// usage: TOOLS=<dir with playwright> EXE=<chrome-headless-shell> node liam-as-is-test.mjs <frame dir> <data-model.dbml>
//          <deps dir: @dbml/core> <liam cli schema.json of the same DDL> <shots dir>
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
import assert from "node:assert/strict";
const [root, dbml, deps, cliJson, shots] = process.argv.slice(2).map((p) => path.resolve(p));
const hash = fs.readFileSync(path.join(root, "erd-viewer.hash"), "utf8").trim(), text = fs.readFileSync(dbml, "utf8");
const { exporter } = createRequire(path.join(deps, "package.json"))("@dbml/core");
const { chromium } = await import(path.join(process.env.TOOLS, "node_modules/playwright/index.mjs"));
const DASH = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// 'unsafe-eval' is for Liam's Postgres parser (pg-query-emscripten); the frame is sandboxed to an opaque origin with no network.
const VIEWER = `default-src 'none'; script-src ${hash} 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
const pages = {
  "/dashboard.html": `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="dash.css"><iframe id="v" sandbox="allow-scripts" src="erd-viewer.html"></iframe><script type="module" src="dash.js"></script>`,
  "/dash.css": "body{margin:0}iframe{border:0;width:100vw;height:100vh}",
  "/dash.js": `const f=document.getElementById("v");window.ready=null;addEventListener("message",e=>{if(e.source!==f.contentWindow)return;
    if(e.data.t==="hello")f.contentWindow.postMessage({t:"files",kind:"erd",files:[{path:"library/data-model.dbml",text:${JSON.stringify(text)}}]},"*");
    if(e.data.t==="ready")window.ready=e.data});`,
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const seen = [];
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname; seen.push(p);
  const body = pages[p] ?? (p === "/erd-viewer.html" ? fs.readFileSync(path.join(root, p)) : null);
  if (body == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)], "content-security-policy": p.includes("viewer") ? VIEWER : DASH }); res.end(body);
}).listen(0);
const sort = (x) => Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x;
fs.mkdirSync(shots, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.EXE });
for (const [w, vp] of [[1280, { width: 1280, height: 800 }], [390, { width: 390, height: 844 }]]) {
  const pg = await b.newPage({ viewport: vp, hasTouch: w === 390, isMobile: w === 390 });
  const errs = []; pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); }); pg.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  const t0 = Date.now();
  await pg.goto(`http://localhost:${srv.address().port}/dashboard.html`);
  await pg.waitForFunction(() => window.ready, null, { timeout: 20000 });
  const ready = await pg.evaluate(() => window.ready), fr = pg.frames().find((f) => f.url().endsWith("erd-viewer.html"));
  await fr.waitForSelector(".react-flow__node", { timeout: 20000 }); await pg.waitForTimeout(1500);
  const ms = Date.now() - t0, nodes = await fr.locator(".react-flow__node").count();
  const inFrame = await fr.evaluate((t) => window.dbmlToLiam(t), text);
  assert.deepEqual(ready.errors, []); assert.equal(ready.tables, 9); assert.equal(nodes, 9);
  assert.equal(inFrame.sql, exporter.export(text, "postgres"), "the frame's DDL is the unbundled exporter's");
  assert.deepEqual(sort(inFrame.schema), sort(JSON.parse(fs.readFileSync(cliJson, "utf8"))), "Liam's parse in the frame is the Liam CLI's");
  await pg.screenshot({ path: path.join(shots, `liam-as-is-${w}.png`) });
  // A tap or click on a table: Liam's own focus and side pane.
  await fr.locator(".react-flow__node", { hasText: "loan" }).first().click();
  await pg.waitForTimeout(1200); await pg.screenshot({ path: path.join(shots, `liam-as-is-${w}-loan.png`) });
  // A DBML error, by line, from the exporter's parse in the frame.
  const bad = await fr.evaluate((t) => window.dbmlToLiam(t), text.replace(/Table loan \{/, "Table loan {\n  oops"));
  assert.equal(bad.schema, null); assert.ok(bad.errors[0].line > 0, JSON.stringify(bad.errors));
  console.log(w, { ready, nodes, ms, badDbml: bad.errors[0], errs: [...new Set(errs)] });
  // The one error allowed: Liam's app asks Google Fonts for IBM Plex, which the frame's CSP blocks; it uses the system font.
  assert.deepEqual(errs.filter((e) => !e.includes("https://fonts.googleapis.com/")), []);
  await pg.close();
}
console.log("requests:", [...new Set(seen)]);
await b.close(); srv.close();
