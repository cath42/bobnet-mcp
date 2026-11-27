// The dashboard (its CSP + frame-src 'self') frames the single-file viewer (its own CSP, opaque origin).
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const [root, drill = "Supervisor"] = process.argv.slice(2), hash = fs.readFileSync(path.join(root, "likec4-viewer.hash"), "utf8").trim();
const { chromium } = await import(path.join(process.env.TOOLS, "node_modules/playwright/index.mjs"));
const DASH = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const VIEWER = `default-src 'none'; script-src ${hash} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const seen = [];
const srv = http.createServer((req, res) => {
  let p = new URL(req.url, "http://x").pathname; seen.push(p);
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)], "content-security-policy": p.includes("viewer") ? VIEWER : DASH });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const b = await chromium.launch({ executablePath: process.env.EXE });
for (const [name, vp] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  const pg = await b.newPage({ viewport: vp, hasTouch: name === "phone", isMobile: name === "phone" });
  const errs = []; pg.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); }); pg.on("pageerror", e => errs.push(e.message.slice(0, 140)));
  await pg.goto(`http://localhost:${srv.address().port}/dashboard.html#containers`); await pg.waitForTimeout(3500);
  const fr = pg.frameLocator("#v");
  await pg.screenshot({ path: `shots/frame-${name}-1.png` });
  const node = fr.locator(".react-flow__node", { hasText: drill }).first();
  if (name === "phone") await node.tap(); else await node.hover();
  await pg.waitForTimeout(300);
  // A wide view leaves nodes too small to tap on a phone (the sample's containers): then fire the drill button's click.
  const btn = node.locator("button").first(); let tapped = true;
  await btn.click({ timeout: 3000 }).catch(async () => { tapped = false; await btn.dispatchEvent("click"); }); await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `shots/frame-${name}-2.png` });
  // Zoom with the control button (phones: also pinch, which React Flow handles natively).
  const tf = async () => fr.locator(".react-flow__viewport").first().getAttribute("style");
  const before = await tf(); await fr.locator(".react-flow__controls-zoomin, button[title*='zoom in' i], button[aria-label*='zoom in' i]").first().click().catch(() => {}); await pg.waitForTimeout(400);
  console.log(name, { title: await pg.title(), crumb: await pg.textContent("#view"), url: pg.url().split("#")[1], zoomed: before !== await tf(), tapped, errs });
  await pg.close();
}
console.log("requests:", [...new Set(seen)]);
await b.close(); srv.close();
