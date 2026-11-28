// drawDB trial: import Toolshed's DBML, collapse loan's columns on its node, then member's; shot each step.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const [dir, dbml, outDir, w = "1280", h = "800"] = process.argv.slice(2);
const { chromium } = await import(path.join(process.env.TOOLS, "node_modules/playwright/index.mjs"));
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'";
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  let p = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream", "content-security-policy": CSP }); res.end(fs.readFileSync(p));
}).listen(0);
const touch = +w < 700;
const b = await chromium.launch({ executablePath: process.env.EXE });
const pg = await b.newPage({ viewport: { width: +w, height: +h }, hasTouch: touch, isMobile: touch });
const errs = []; pg.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
const shot = (n) => pg.screenshot({ path: path.join(outDir, `drawdb-${w}-${n}.png`) });
await pg.goto(`http://localhost:${srv.address().port}/editor`); await pg.waitForTimeout(1500);
await pg.locator(".semi-modal").getByText("PostgreSQL", { exact: true }).click(); await pg.waitForTimeout(300); console.log("step db"); await pg.locator(".semi-modal").getByRole("button", { name: "Continue" }).click(); await pg.waitForTimeout(800); console.log("step continue", await pg.locator(".semi-modal").count()); await shot("dbg");
await pg.locator(".semi-modal").getByText("DBML", { exact: true }).click(); await pg.waitForTimeout(300); await pg.locator(".semi-modal").getByRole("button", { name: "Create", exact: true }).click(); await pg.waitForTimeout(600); await shot("dbg2");
await pg.locator(".semi-modal input[type=file]").first().setInputFiles(dbml); await pg.waitForTimeout(800);
console.log("modal:", (await pg.locator(".semi-modal").innerText()).replace(/\s+/g, " ").slice(0, 200));
await pg.getByRole("button", { name: "Import" }).last().click(); await pg.waitForTimeout(1200);
await pg.getByTitle("Auto arrange").click(); await pg.waitForTimeout(300);
await pg.getByText("Layered, left to right").click(); await pg.waitForTimeout(800);
await pg.keyboard.press("Escape"); await pg.mouse.click(+w - 20, 120);
await pg.keyboard.press("Control+Alt+w"); await pg.waitForTimeout(800);
const node = (n) => pg.locator("foreignObject").filter({ has: pg.locator(`text="${n}"`) }).first();
const rows = async (n) => (await node(n).locator("> div").innerText()).split("\n").filter(Boolean).length;
const names = ["loan", "member", "tool", "shed"];
console.log("lines per node before:", JSON.stringify(Object.fromEntries(await Promise.all(names.map(async (n) => [n, await rows(n)])))));
await shot("a-imported");
for (const [i, n] of ["loan", "member"].entries()) {
  const nd = node(n);
  const hd = nd.getByText(n, { exact: true });
  if (touch) await hd.tap(); else await hd.hover();
  await pg.waitForTimeout(300);
  const btn = nd.getByRole("button", { name: /unlinked columns/i });
  console.log(n, "button visible after", touch ? "tap" : "hover", ":", await btn.isVisible().catch(() => false), "label:", await btn.getAttribute("aria-label").catch(() => "-"));
  if (touch) await btn.tap({ force: true }); else await btn.click();
  await pg.mouse.move(5, +h - 5); await pg.waitForTimeout(500);
  console.log("lines per node after", n, ":", JSON.stringify(Object.fromEntries(await Promise.all(names.map(async (m) => [m, await rows(m)])))));
  console.log(n, "now shows:", (await nd.locator("> div").innerText()).split("\n").filter(Boolean).join(" / ").slice(0, 160));
  await shot(`${"bc"[i]}-${n}-collapsed`);
}
console.log("errors:", errs.join(" | ") || "none");
await b.close(); srv.close();
