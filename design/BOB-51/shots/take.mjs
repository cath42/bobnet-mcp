// Screenshots of BOB-51's prototype at 390, 1024 and 1440 px.
//   node design/BOB-51/shots/take.mjs   (playwright-core from @bobnet/broker)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../../packages/broker/package.json"))("playwright-core");
const page0 = pathToFileURL(join(here, "../prototype/index.html")).href;
const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };

// [file, hash, steps, element to shoot (else the full page), colour scheme]
const shots = [
  ["ac1-overview-folded", "overview", [], "main"],
  ["ac1-overview-open", "overview", [(p) => p.locator("#needs > li[data-id^=perm] .acts .more-t").click(), (p) => p.locator(".a-detail .ask-more").click()], "main"],
  ["ac1-overview-open-dark", "overview", [(p) => p.locator("#needs > li[data-id^=perm] .acts .more-t").click(), (p) => p.locator(".a-detail .ask-more").click()], "main", "dark"],
  ["ac2-ac3-waits-allow-note", "waits", [(p) => p.getByRole("button", { name: "Allow or deny" }).click(), (p) => p.fill("form.answer textarea", "Fine. Keep the stash; I'll check the token rotation with Picard.")], null],
];

const browser = await chromium.launch();
for (const [w, [width, height]] of Object.entries(widths)) {
  for (const [file, hash, steps, el, scheme] of shots) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme ?? "light", isMobile: width < 600, hasTouch: width < 600 });
    const p = await ctx.newPage();
    await p.addInitScript(() => sessionStorage.clear());
    await p.goto(`${page0}#${hash}`);
    if (el) await p.addStyleTag({ content: "header { position: static; }" });
    for (const s of steps) await s(p);
    const out = join(here, `${file}-${w}.png`);
    if (el) await p.locator(el).screenshot({ path: out }); else await p.screenshot({ path: out, fullPage: true });
    await ctx.close();
    console.log(out);
  }
}
await browser.close();
