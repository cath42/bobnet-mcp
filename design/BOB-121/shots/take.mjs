// Screenshots of BOB-121's prototype, every view at 390, 1024 and 1440 px (spec.md §5 says which shows what).
//   node design/BOB-121/shots/take.mjs [name-prefix]   (playwright-core from @bobnet/broker)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../../packages/broker/package.json"))("playwright-core");
const page0 = pathToFileURL(join(here, "../prototype/index.html")).href;
const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };

const openAsk = [(p) => p.locator(".a-line", { hasText: "Marvin" }).first().locator(".a-btn").click(), (p) => p.locator(".a-detail .ask-more").click()];
const states = (o) => (p) => p.evaluate((o) => sessionStorage.setItem("bobnet.proto121", JSON.stringify(o)), o);

// [file, hash, steps before load, steps after load, colour scheme]
const shots = [
  ["01-overview", "overview", [], []],
  ["02-overview-agent-ask", "overview", [], openAsk],
  ["03-overview-quiet-laptop", "overview", [states({ quiet: true })], []],
  ["04-overview-nothing-needs-you", "overview", [states({ empty: true })], []],
  ["05-needs-you", "needs", [], []],
  ["06-needs-you-allow-note", "needs", [], [(p) => p.getByRole("button", { name: "Allow or deny" }).click(), (p) => p.fill("form.answer textarea", "Fine. Keep the stash; clear only the tile cache.")]],
  ["07-project-helix-running", "project/helix", [], []],
  ["08-project-bobnet-nobody-running", "project/bobnet", [], []],
  ["09-status", "status", [], []],
  ["10-status-helix", "status/helix", [], []],
  ["11-roadmap-bobnet", "roadmap/bobnet", [], []],
  ["12-roadmap-helix-done-shown", "roadmap/helix", [], [(p) => p.locator("#rel-R1").getByRole("button", { name: /done: show them/ }).click()]],
  ["13-features-bobnet", "features/bobnet", [], []],
  ["14-features-helix-done", "features/helix", [], [(p) => p.getByRole("button", { name: /^Done/ }).click()]],
  ["15-feature-land-50-open", "feature/helix/LAND-50", [], []],
  ["16-feature-bob-51-done-unticked", "feature/bobnet/BOB-51", [], [(p) => p.locator(".unticked summary").click()]],
  ["17-triage-bobnet", "triage/bobnet", [], []],
  ["18-triage-helix", "triage/helix", [], []],
  ["19-usage-raw", "usage", [], []],
  ["20-usage-weighted-day", "usage", [states({ weigh: true })], [(p) => p.locator(".ucard").last().getByRole("button", { name: /^\d+ \w+ / }).first().click(), (p) => p.locator(".factored summary").click()]],
  ["21-laptops", "laptops", [], []],
  ["22-overview-dark", "overview", [], openAsk, "dark"],
];

const only = process.argv[2];
const browser = await chromium.launch();
let errors = 0;
try {
  for (const [file, hash, before, after, scheme] of shots.filter(([f]) => !only || f.startsWith(only))) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme ?? "light", isMobile: width < 600, hasTouch: width < 600 });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => { errors++; console.error(`${file}-${w}: ${e.message}`); });
      await p.goto(`${page0}#overview`);
      for (const step of before) await step(p);
      await p.goto(`${page0}#${hash}`);
      await p.reload();
      await p.addStyleTag({ content: "header { position: static !important; } #toast { display: none !important; } .proto-states { display: none; }" });
      for (const step of after) { await step(p); await p.waitForTimeout(150); }
      await p.screenshot({ path: join(here, `${file}-${w}.png`), fullPage: true });
      await ctx.close();
    }
    console.log(file);
  }
} finally {
  await browser.close();
}
if (errors) process.exit(1);
