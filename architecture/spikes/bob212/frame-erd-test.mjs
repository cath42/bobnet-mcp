// The dashboard frames the ERD viewer (opaque origin, its own CSP) and posts the schema in.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const [root, table] = process.argv.slice(2), hash = fs.readFileSync(path.join(root, "erd-viewer.hash"), "utf8").trim();
const { chromium } = await import(path.join(process.env.TOOLS, "node_modules/playwright/index.mjs"));
const DASH = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const VIEWER = `default-src 'none'; script-src ${hash}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
const pages = {
  "/dashboard.html": `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="dash.css"><iframe id="v" sandbox="allow-scripts" src="erd-viewer.html"></iframe><script type="module" src="dash.js"></script>`,
  "/dash.css": "body{margin:0}iframe{border:0;width:100vw;height:100vh}",
  "/dash.js": `const f=document.getElementById("v");const s=fetch("schema.json").then(r=>r.json());addEventListener("message",async e=>{if(e.source===f.contentWindow&&e.data.t==="hello")f.contentWindow.postMessage({t:"schema",schema:await s},"*")});`,
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const seen = [];
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname; seen.push(p);
  const body = pages[p] ?? (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p)) : null);
  if (body == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)], "content-security-policy": p.includes("viewer") ? VIEWER : DASH }); res.end(body);
}).listen(0);
const b = await chromium.launch({ executablePath: process.env.EXE });
for (const [name, vp] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  const pg = await b.newPage({ viewport: vp, hasTouch: name === "phone", isMobile: name === "phone" });
  const errs = []; pg.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); }); pg.on("pageerror", e => errs.push(e.message.slice(0, 140)));
  await pg.goto(`http://localhost:${srv.address().port}/dashboard.html`); await pg.waitForTimeout(4000);
  const fr = pg.frameLocator("#v");
  const n = await fr.locator(".react-flow__node").count();
  await pg.screenshot({ path: `shots/erd-${name}-1.png` });
  // Focus a table: click it; Liam highlights it and its relations and opens its detail.
  await fr.locator(".react-flow__node", { hasText: table }).first().click().catch(e => errs.push("click " + e.message.slice(0, 60)));
  await pg.waitForTimeout(1200); await pg.screenshot({ path: `shots/erd-${name}-2.png` });
  console.log(name, { nodes: n, errs: [...new Set(errs)] });
  await pg.close();
}
console.log("requests:", [...new Set(seen)]);
await b.close(); srv.close();
