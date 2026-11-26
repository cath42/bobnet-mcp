// Shots of the BOB-212 prototype at 390 (phone, touch), 1024 (tablet, touch) and 1440 (desktop), light, and one dark.
//   node design/BOB-212/tools/shots.mjs   (writes design/BOB-212/shots/*.png)
// Prints any page error and any page wider than its viewport.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(join(here, "../../../packages/broker/node_modules/playwright-core/index.mjs"));
const pub = join(here, "../prototype"), out = join(here, "../shots");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try { res.writeHead(200, { "content-type": types[extname(path) || ".html"] ?? "text/html" }).end(await readFile(join(pub, path === "/" ? "index.html" : path))); }
  catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const W = { 390: [390, 844, true], 1024: [1024, 768, true], 1440: [1440, 900, false] };
// [name, hash, widths, setup, full page]
const shots = [
  ["01-menu-open", "#overview", [390, 1024, 1440], async (p) => { await p.click("#pm-btn"); }, false],
  ["02-library-home", "#project/helix/library", [390, 1024, 1440], null, true],
  ["03-architecture", "#project/helix/library/overview", [390, 1024, 1440], null, false],
  ["04-architecture-long", "#project/helix/library/overview/details-by-area", [390, 1440], null, false],
  ["05-sections-open", "#project/helix/library/overview", [390], async (p) => { await p.click(".secs-pick"); }, false],
  ["06-data-model-diagram", "#project/helix/library/entities", [390, 1024, 1440], async (p) => { await p.waitForSelector(".dia img", { timeout: 15000 }).catch(() => {}); }, false],
  ["07-taxonomy", "#project/helix/library/taxonomy/all-elements", [390, 1024, 1440], null, false],
  ["08-taxonomy-found", "#project/helix/library/taxonomy/all-elements", [390, 1440], async (p) => { await p.fill(".tax-bar input", "hold"); await p.selectOption(".tax-bar select", "Leases"); }, false],
  ["09-scenario", "#project/helix/library/scenarios-domain-hold-and-expiry", [390, 1440], null, false],
  ["10-vitals-use-cases", "#project/vitals/library/usecases", [390, 1440], null, false],
  ["11-vitals-diagram", "#project/vitals/library/entities", [390, 1440], async (p) => { await p.waitForSelector(".dia img", { timeout: 15000 }).catch(() => {}); }, false],
  ["12-behind", "#project/helix/library/overview", [390, 1440], async (p) => { await state(p, "behind"); }, false],
  ["13-fetch-failed", "#project/helix/library", [390, 1440], async (p) => { await state(p, "failed"); }, false],
  ["14-page-missing", "#project/helix/library/decisions", [390, 1440], async (p) => { await state(p, "missing"); }, false],
  ["15-no-library", "#project/bobnet/library", [390, 1440], null, false],
  ["16-diagram-fallback", "#project/helix/library/entities", [390, 1440], async (p) => { await state(p, "nodiagram"); }, false],
  ["17-loading", "#project/helix/library/overview", [390, 1440], async (p) => { await state(p, "loading"); }, false],
  ["18-work-tab", "#project/helix", [390, 1440], null, false],
];
async function state(p, v) { await p.evaluate((v) => { const r = document.querySelector(`.proto-states input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event("change")); }, v); }
const browser = await chromium.launch();
for (const dark of [false, true]) {
  for (const [name, hash, widths, setup, full] of shots) {
    if (dark && !["02-library-home", "03-architecture", "06-data-model-diagram", "07-taxonomy"].includes(name)) continue;
    for (const w of widths) {
      if (dark && w === 1024) continue;
      const [vw, vh, touch] = W[w];
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch, isMobile: touch && w === 390, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light" });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => console.log(name, w, "page error:", e.message));
      await p.goto(base + hash);
      await p.waitForTimeout(150);
      if (setup) await setup(p);
      await p.evaluate(() => document.querySelector(".proto-states")?.remove());
      await p.waitForTimeout(250);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      if (sw > vw) console.log(name, w, `wider than the viewport: ${sw}`);
      await p.screenshot({ path: join(out, `${name}-${w}${dark ? "-dark" : ""}.png`), fullPage: full });
      await ctx.close();
    }
  }
}
await browser.close();
server.close();
console.log("done");
