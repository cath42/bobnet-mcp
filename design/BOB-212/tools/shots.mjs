// Shots of the BOB-212 prototype (version 5, Toolshed) at 390 (phone, touch), 1024 (tablet, touch) and 1440 (desktop), light,
// and some dark. The viewers are served with their own CSP (ADR 0016 §6), the page with frame-src 'self'.
//   node design/BOB-212/tools/shots.mjs [name-filter]   (writes design/BOB-212/shots/v5/*.png)
// Prints any page error, any page wider than its viewport, and each viewer's ready.
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(join(here, "../../../packages/broker/node_modules/playwright-core/index.mjs"));
const pub = join(here, "../prototype"), out = join(here, "../shots/v5");
(await import("node:fs")).mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const hash = (n) => readFileSync(join(pub, "vendor", `${n}.hash`), "utf8").trim();
// ADR 0017 §7: the ERD viewer needs no eval of any kind; LikeC4's Graphviz needs 'wasm-unsafe-eval'.
const VIEWER = (n) => `default-src 'none'; script-src ${hash(n)}${n === "likec4-viewer" ? " 'wasm-unsafe-eval'" : ""}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
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
const T = "#project/toolshed/library";
const shots = [
  ["01-menu-open", "#overview", [390, 1024, 1440], async (p) => { await p.click("#pm-btn"); }, false],
  ["02-home", T, [390, 1024, 1440], null, true, true],
  ["03-c4-context", `${T}/architecture`, [390, 1024, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); }, false, true],
  ["04-c4-drilled", `${T}/architecture/apiComponents`, [390, 1024, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); }, false, true],
  ["05-c4-click-drill", `${T}/architecture/containers`, [1440], async (p) => {
    await ready(p); await p.waitForTimeout(1200);
    const node = p.frameLocator(".vf-box iframe").locator(".react-flow__node", { hasText: "API" }).first();
    await node.hover(); await node.locator('button[aria-label="Navigate to view"]').click({ timeout: 4000 }).catch((e) => console.log("  drill:", e.message.slice(0, 80)));
    await p.waitForTimeout(2000); console.log("  address after drill:", await p.evaluate(() => location.hash));
  }, false],
  // A phone: the containers are too small to tap, so the views picker is the way in (ADR 0017 §7).
  ["06-c4-phone-picker", `${T}/architecture/containers`, [390], async (p) => { await ready(p); await p.waitForTimeout(1000); await p.selectOption(".vf-pick", "workerComponents"); await p.waitForTimeout(2000);
    console.log("  address after pick:", await p.evaluate(() => location.hash)); }, false],
  ["07-c4-flow", `${T}/architecture/uc0001`, [390, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); }, false],
  ["08-c4-fullscreen", `${T}/architecture/containers`, [390, 1024], async (p) => { await ready(p); await p.click(".vf-full-b"); await p.waitForTimeout(1500); }, false],
  ["09-erd-all", `${T}/data`, [390, 1024, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); }, false, true],
  ["11-erd-lending", `${T}/data/lending`, [390, 1024, 1440], async (p) => { await ready(p); await p.waitForTimeout(1500); }, false, true],
  ["13-erd-card", `${T}/data/lending/loan`, [390, 1024, 1440], async (p) => { await ready(p); await p.waitForTimeout(2500); }, false, true],
  ["14-erd-card-all", `${T}/data/all/reservation`, [1440], async (p) => { await ready(p); await p.waitForTimeout(2500); await p.click(".ent-all summary").catch(() => {}); await p.waitForTimeout(300); }, false],
  ["15-erd-hover", `${T}/data/catalogue`, [1440], async (p) => {
    await ready(p); await p.waitForTimeout(1500);
    await p.frameLocator(".vf-box iframe").locator(".react-flow__node").nth(1).hover(); await p.waitForTimeout(600);
  }, false],
  ["16-erd-phone-full", `${T}/data/lending/loan`, [390], async (p) => { await ready(p); await p.waitForTimeout(2000); await p.click(".vf-full-b"); await p.waitForTimeout(1200); }, false],
  ["17-decisions", `${T}/decisions`, [390, 1024, 1440], null, false, true],
  ["18-decision-open", `${T}/decisions/0003`, [390, 1440], null, false],
  ["19-usecases", `${T}/usecases`, [390, 1024, 1440], null, false, true],
  ["20-usecase-open", `${T}/usecases/0001`, [390, 1440], null, false],
  ["21-ux-cards", `${T}/ux`, [390, 1024, 1440], null, false, true],
  ["22-ux-open", `${T}/ux/0001`, [390, 1440], null, false],
  ["23-glossary", `${T}/glossary/hold`, [390, 1440], null, false],
  ["24-overview", `${T}/overview`, [390, 1440], null, false],
  ["25-problems", T, [390, 1440], async (p) => { await state(p, "problems"); }, true],
  ["26-problem-card", `${T}/decisions/0004`, [390, 1440], async (p) => { await state(p, "problems"); }, false],
  ["27-not-converted", "#project/helix/library", [390, 1440], null, true],
  ["28-section-not-written", `${T}/glossary`, [390, 1440], async (p) => { await state(p, "gloss"); }, false],
  ["29-diagram-loading", `${T}/data`, [390, 1440], async (p) => { await state(p, "slow"); await p.waitForTimeout(600); }, false],
  ["30-erd-errors", `${T}/data`, [390, 1440], async (p) => { await state(p, "nodiagram"); await p.waitForTimeout(2500); }, false],
  ["31-c4-errors", `${T}/architecture`, [1440], async (p) => { await state(p, "nodiagram"); await ready(p); await p.waitForTimeout(2000); }, false],
  ["32-behind", `${T}/glossary`, [390, 1440], async (p) => { await state(p, "behind"); }, false],
  ["33-fetch-failed", T, [390, 1440], async (p) => { await state(p, "failed"); }, false],
  ["34-no-library-sent", T, [390, 1440], async (p) => { await state(p, "none"); }, false],
  ["35-loading", T, [390, 1440], async (p) => { await state(p, "loading"); }, false],
  ["36-sections-folded", `${T}/data`, [390, 1440], async (p) => { await ready(p); await p.click(".secs-pick"); await p.waitForTimeout(300); }, false],
  ["37-work-tab", "#project/toolshed", [390, 1440], null, false],
  // A click on a table in the frame opens its card; a click on another moves the card. Each table's open state stays per diagram.
  ["38-erd-click", `${T}/data/lending`, [1440], async (p) => {
    await ready(p); await p.waitForTimeout(1500);
    const nodes = p.frameLocator(".vf-box iframe").locator(".react-flow__node");
    for (const n of [1, 3]) {
      const id = await nodes.nth(n).getAttribute("data-id");
      await nodes.nth(n).click(); await p.waitForTimeout(1200);
      const got = await p.evaluate(() => [decodeURIComponent(location.hash.split("/").pop()), document.querySelector(".ent-h b")?.textContent ?? ""]);
      console.log("  click", n, got[0] === id && got[1] === id ? "opens its card" : `MISMATCH ${got} ${id}`);
    }
  }, false],
];
async function pickTable(p, n) { await p.selectOption(".vf-pick", { index: n }); await p.waitForTimeout(2500); }
const toFrame = async (p) => { await p.evaluate(() => document.querySelector(".vf").scrollIntoView({ block: "start" })); await p.waitForTimeout(300); };
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
      // A phone: the frame is under the fold, so bring it up as a reader would.
      if (w === 390 && !full && (await p.$(".vf:not(.full)"))) await toFrame(p);
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
