// BOB-212 (ADR 0017): the dashboard frames the DBML ERD viewer (opaque origin, no 'unsafe-eval') and posts the
// sample's data-model.dbml in: all tables as names only, then one diagram with its columns, then the toggle live.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const [root, dbml] = process.argv.slice(2), hash = fs.readFileSync(path.join(root, "erd-viewer.hash"), "utf8").trim();
const { chromium } = await import(path.join(process.env.TOOLS, "node_modules/playwright/index.mjs"));
const DASH = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const VIEWER = `default-src 'none'; script-src ${hash}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
const pages = {
  "/dashboard.html": `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="dash.css"><iframe id="v" sandbox="allow-scripts" src="erd-viewer.html"></iframe><script type="module" src="dash.js"></script>`,
  "/dash.css": "body{margin:0}iframe{border:0;width:100vw;height:100vh}",
  "/dash.js": `const f=document.getElementById("v"),q=new URLSearchParams(location.search);const s=fetch("data-model.dbml").then(r=>r.text());
addEventListener("message",async e=>{if(e.source!==f.contentWindow)return;if(e.data.t==="hello")f.contentWindow.postMessage({t:"files",kind:"erd",files:[{path:"library/data-model.dbml",text:await s}],view:q.get("view"),show:q.get("show")},"*");if(e.data.t==="ready")window.ready=e.data});
window.show=m=>f.contentWindow.postMessage({t:"show",show:m},"*");`,
  "/data-model.dbml": fs.readFileSync(dbml, "utf8"),
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".dbml": "text/plain" };
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const body = pages[p] ?? (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p)) : null);
  if (body == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)], "content-security-policy": p.includes("viewer") ? VIEWER : DASH }); res.end(body);
}).listen(0);
fs.mkdirSync("shots", { recursive: true });
const b = await chromium.launch({ executablePath: process.env.EXE });
for (const [name, vp] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  for (const [label, qs] of [["all-tables", "show=tables"], ["lending-columns", "view=lending&show=columns"]]) {
    const pg = await b.newPage({ viewport: vp, hasTouch: name === "phone", isMobile: name === "phone" });
    const errs = []; pg.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); }); pg.on("pageerror", e => errs.push(e.message.slice(0, 140)));
    await pg.goto(`http://localhost:${srv.address().port}/dashboard.html?${qs}`); await pg.waitForTimeout(4000);
    const fr = pg.frameLocator("#v"), cols = () => fr.locator(".react-flow__node li, .react-flow__node [data-column-name], .react-flow__node tr").count();
    const nodes = await fr.locator(".react-flow__node").count(), c1 = await cols();
    await pg.screenshot({ path: `shots/dbml-${name}-${label}.png` });
    await pg.evaluate(() => window.show(new URLSearchParams(location.search).get("show") === "tables" ? "columns" : "tables")); await pg.waitForTimeout(1200);
    const c2 = await cols(); await pg.screenshot({ path: `shots/dbml-${name}-${label}-toggled.png` });
    const r = await pg.evaluate(() => window.ready && { errors: window.ready.errors, views: window.ready.views.map(v => v.id), tables: window.ready.tables.length });
    console.log(name, label, { nodes, columnRows: [c1, c2], ready: r, errs: [...new Set(errs)] });
    await pg.close();
  }
}
await b.close(); srv.close();
