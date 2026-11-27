// Shots of the BOB-212 prototype (version 2) at 390 (phone, touch), 1024 (tablet, touch) and 1440 (desktop), light,
// and some dark. The viewers are served with their own CSP (ADR 0016 §6), the page with frame-src 'self'.
//   node design/BOB-212/tools/shots.mjs [name-filter]   (writes design/BOB-212/shots/*.png)
// Prints any page error, any page wider than its viewport, and each viewer's ready.
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(join(here, "../../../packages/broker/node_modules/playwright-core/index.mjs"));
const pub = join(here, "../prototype"), out = join(here, "../shots");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const hash = (n) => readFileSync(join(pub, "vendor", `${n}.hash`), "utf8").trim();
const VIEWER = (n) => `default-src 'none'; script-src ${hash(n)} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const viewer = path.match(/^\/vendor\/((?:likec4|erd)-viewer)\.html$/);
  try {
    const body = await readFile(join(pub, path === "/" ? "index.html" : path));
    const head = { "content-type": types[extname(path) || ".html"] ?? "text/html" };
    if (viewer) head["content-security-policy"] = VIEWER(viewer[1]);
    res.writeHead(200, head).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const W = { 390: [390, 844, true], 1024: [1024, 768, true], 1440: [1440, 900, false] };
const ready = (p) => p.waitForFunction(() => document.querySelector(".vf-veil")?.hidden || document.querySelector(".vf-fail"), null, { timeout: 30000 }).catch(() => console.log("  (viewer not ready)"));
const settle = (ms) => (p) => p.waitForTimeout(ms);
// [name, hash, widths, setup, full page, dark too]
const shots = [
  ["01-menu-open", "#overview", [390, 1024, 1440], async (p) => { await p.click("#pm-btn"); }, false],
  ["02-home-bobnet", "#project/bobnet/library", [390, 1024, 1440], null, true, true],
  ["03-c4-context", "#project/bobnet/library/architecture", [390, 1024, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); }, false, true],
  ["04-c4-drilled", "#project/bobnet/library/architecture/model/boardComponents", [390, 1024, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); }, false, true],
  ["05-c4-click-drill", "#project/bobnet/library/architecture/model/containers", [1440], async (p) => {
    await ready(p); await p.waitForTimeout(1200);
    const node = p.frameLocator(".vf-box iframe").locator(".react-flow__node", { hasText: "Broker" }).first();
    await node.hover(); await node.locator('button[aria-label="Navigate to view"]').click({ timeout: 4000 }).catch((e) => console.log("  drill:", e.message.slice(0, 80)));
    await p.waitForTimeout(2000); console.log("  address after drill:", await p.evaluate(() => location.hash));
  }, false],
  ["06-c4-phone-explore", "#project/bobnet/library/architecture/model/containers", [390], async (p) => { await ready(p); await p.click(".vf-touch"); await p.waitForTimeout(800); }, false],
  ["07-c4-fullscreen", "#project/bobnet/library/architecture/model/brokerComponents", [390, 1024], async (p) => { await ready(p); await p.click(".vf-full-b"); await p.waitForTimeout(1500); await p.evaluate(() => {}); }, false],
  ["08-decisions-bobnet", "#project/bobnet/library/decisions", [390, 1024, 1440], null, false, true],
  ["09-adr-open", "#project/bobnet/library/decisions/adrs/0016-library-skeleton-and-zoomable-diagrams", [390, 1440], null, false],
  ["10-ux-cards", "#project/bobnet/library/ux", [390, 1024, 1440], null, false, true],
  ["11-usecases-bobnet", "#project/bobnet/library/usecases", [390, 1440], null, false],
  ["12-missing-section", "#project/bobnet/library/data", [390, 1440], null, false],
  ["13-home-helix", "#project/helix/library", [390, 1440], null, true],
  ["14-helix-adrs", "#project/helix/library/decisions/adrs", [390, 1024, 1440], null, false],
  ["15-helix-scenarios", "#project/helix/library/usecases/scenarios/domain-hold-and-expiry", [390, 1440], null, false],
  ["16-helix-taxonomy", "#project/helix/library/data/taxonomy/all-elements", [390, 1440], null, false],
  ["17-home-vitals", "#project/vitals/library", [390, 1440], null, true],
  ["18-vitals-erd", "#project/vitals/library/data", [390, 1024, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); }, false, true],
  // A table focused by its chip, the sixth: its name stays out of this public file.
  ["19-vitals-erd-focus", "#project/vitals/library/data", [390, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); await p.locator(".vf-jump .chip-b").nth(5).click(); await p.waitForTimeout(2500); }, false, true],
  ["20-vitals-usecases", "#project/vitals/library/usecases", [390, 1024, 1440], null, false],
  ["21-vitals-usecase-open", "#project/vitals/library/usecases", [390, 1440], async (p) => { const c = p.locator(".ucard").nth(4); await c.locator("summary").click(); await c.scrollIntoViewIfNeeded(); await p.evaluate(() => scrollBy(0, -90)); }, false],
  ["22-vitals-architecture", "#project/vitals/library/architecture", [390, 1440], null, false],
  ["23-diagram-loading", "#project/bobnet/library/architecture", [390, 1440], async (p) => { await state(p, "slow"); await p.waitForTimeout(600); }, false],
  ["24-diagram-errors", "#project/bobnet/library/architecture", [390, 1440], async (p) => { await state(p, "nodiagram"); await p.waitForTimeout(1500); }, false],
  ["25-behind", "#project/vitals/library/glossary", [390, 1440], async (p) => { await state(p, "behind"); }, false],
  ["26-fetch-failed", "#project/helix/library", [390, 1440], async (p) => { await state(p, "failed"); }, false],
  ["27-page-missing", "#project/helix/library/decisions", [390, 1440], async (p) => { await state(p, "missing"); }, false],
  ["28-no-library", "#project/bobnet/library", [390, 1440], async (p) => { await state(p, "none"); }, false],
  ["29-loading", "#project/bobnet/library", [390, 1440], async (p) => { await state(p, "loading"); }, false],
  ["30-sections-open", "#project/vitals/library/data", [390], async (p) => { await p.click(".secs-pick"); }, false],
  ["31-work-tab", "#project/helix", [390, 1440], null, false],
];
async function state(p, v) { await p.evaluate((v) => { const r = document.querySelector(`.proto-states input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event("change")); }, v); }
const only = process.argv[2];
const browser = await chromium.launch(process.env.EXE ? { executablePath: process.env.EXE } : {});
for (const dark of [false, true]) {
  for (const [name, hash, widths, setup, full, darkToo] of shots) {
    if (only && !name.includes(only)) continue;
    if (dark && !darkToo) continue;
    for (const w of widths) {
      if (dark && w === 1024) continue;
      const [vw, vh, touch] = W[w];
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch, isMobile: touch && w === 390, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light" });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => console.log(name, w, "page error:", e.message));
      p.on("console", (m) => { if (m.type() === "error" && !/fonts|favicon/.test(m.text())) console.log(name, w, "console:", m.text().slice(0, 160)); });
      await p.goto(base + "index.html" + hash);
      await p.waitForTimeout(400);
      if (setup) await setup(p);
      await p.waitForTimeout(300);
      const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (wide > 0) console.log(name, w, `wider than the viewport by ${wide}px`);
      await p.screenshot({ path: join(out, `${name}-${w}${dark ? "-dark" : ""}.png`), fullPage: !!full });
      await ctx.close();
    }
  }
}
await browser.close();
server.close();
