// Screenshots of BOB-33's prototype at 390, 1024 and 1440 px, light and dark.
//   node design/BOB-33/shots/take.mjs   (playwright-core from @bobnet/broker; see design/BOB-31/shots/take.mjs)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../../packages/broker/package.json"))("playwright-core");
const page0 = pathToFileURL(join(here, "../prototype/index.html")).href;
const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };

// [file, hash, steps, full page?, colour scheme]
const shots = [
  ["s1-status-top", "status", [], false],
  ["s1-status", "status", [], true],
  ["s1-status-dark", "status", [], true, "dark"],
  ["s2-helix", "status/helix", [], true],
  ["s2-helix-dark", "status/helix", [], true, "dark"],
  ["s2-helix-open", "status/helix", [(p) => p.$$eval("details.sec", (ds) => ds.forEach((d) => (d.open = true)))], true],
  ["s3-bobnet", "status/bobnet", [], true],
  ["s4-week", "status/helix", [(p) => p.getByRole("button", { name: "A week" }).click()], true],
  ["s5-caught-up", "status", [(p) => p.locator(".caught-foot button").click()], true],
  ["s6-first-visit", "status", [(p) => p.getByRole("button", { name: "first visit" }).click()], false],
  ["s7-overview-line", "overview", [], false],
  ["s8-bob33-only", "status/helix", [(p) => p.getByRole("button", { name: "BOB-33 only" }).click()], true],
];

const browser = await chromium.launch();
for (const [w, [width, height]] of Object.entries(widths)) {
  for (const [file, hash, steps, full, scheme] of shots) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme ?? "light", isMobile: width < 600, hasTouch: width < 600 });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error(`${file}-${w}: ${e.message}`));
    await p.goto(`${page0}#${hash}`);
    for (const s of steps) await s(p);
    await p.mouse.move(0, 0);
    const out = join(here, `${file}-${w}.png`);
    await p.screenshot({ path: out, fullPage: full });
    await ctx.close();
  }
}
await browser.close();
console.log("done");
