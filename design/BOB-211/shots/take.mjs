// Screenshots of BOB-211's prototype at 390 (phone), 1024 (tablet, touch) and 1440 (desktop, mouse); spec.md §6 says which shows what.
//   node design/BOB-211/shots/take.mjs [name-prefix]   (playwright-core from @bobnet/broker)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../../packages/broker/package.json"))("playwright-core");
const page0 = pathToFileURL(join(here, "../prototype/index.html")).href;
const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };

const bobnet = '.ucard[data-project="bobnet"]';
// With a mouse: point at build E's part of 23 Nov's bar. On a touch screen: tap the bar, which names its sessions under it.
const pointAtBuildE = async (p, w) => {
  if (w === "1440") await p.locator(`${bobnet} rect.shit[data-sid="BOB-121/build/E"]`).first().hover();
  else await p.locator(`${bobnet} g.bar[data-fk="bar/bobnet/2026-11-23"]`).tap();
};
const ss = "usage/bobnet/2026-11-23/BOB-121/build/E", re = "usage/bobnet/2026-11-25/BOB-121/review/E";

// [file, hash, steps after load, colour scheme]
const shots = [
  ["01-bar-names-its-session", "usage", [pointAtBuildE]],
  ["02-session-build-e", ss, []],
  ["03-session-review-e-all-agents", re, []],
  ["04-review-e-daisy", `${re}/Daisy`, []],
  ["05-review-e-mario-no-band", `${re}/Mario`, []],
  ["06-review-e-from-its-bar-on-23-nov", "usage", [async (p, w) => {
    if (w === "1440") await p.locator(`${bobnet} rect.shit[data-sid="BOB-121/review/E"]`).first().hover();
    else { await p.locator(`${bobnet} g.bar[data-fk="bar/bobnet/2026-11-25"]`).tap(); await p.waitForTimeout(100); await p.locator(`${bobnet} button.u-s`, { hasText: "review E" }).tap(); }
  }]],
  ["07-running-session-today", "usage/bobnet/2026-11-26/BOB-211/design/A", []],
  ["08-review-e-weighted", `${re}?weigh=1`, []],
  ["09-review-e-dark", `${re}/Toad`, [], "dark"],
  ["10-helix-fixes-running", "usage/helix/2026-11-26/LAND-50/build/Fixes", []],
];

const only = process.argv[2];
const browser = await chromium.launch();
let errors = 0;
try {
  for (const [file, hash, after, scheme] of shots.filter(([f]) => !only || f.startsWith(only))) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const touch = width < 1200;
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme ?? "light", isMobile: touch, hasTouch: touch });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => { errors++; console.error(`${file}-${w}: ${e.message}`); });
      await p.goto(`${page0}#${hash}`);
      await p.addStyleTag({ content: "header { position: static !important; } #toast { display: none !important; }" });
      for (const step of after) { await step(p, w); await p.waitForTimeout(150); }
      await p.screenshot({ path: join(here, `${file}-${w}.png`), fullPage: true });
      await ctx.close();
    }
    console.log(file);
  }
} finally {
  await browser.close();
}
if (errors) process.exit(1);
