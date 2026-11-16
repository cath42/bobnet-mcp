// Screenshots of BOB-31's prototype at 390, 1024 and 1440 px.
//   node design/BOB-31/shots/take.mjs   (playwright-core from @bobnet/broker; see design/BOB-1/shots/take.mjs)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../../packages/broker/package.json"))("playwright-core");
const page0 = pathToFileURL(join(here, "../prototype/index.html")).href;
const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };
const line = (p, ref) => p.locator(`#needs > li[data-id$="/${ref}"]`);

// [file, hash, steps, element to shoot (else the viewport), colour scheme]
const shots = [
  ["c1-needs-cut", "overview", [], ".ov-needs"],
  ["c1-needs-open", "overview", [(p) => line(p, "Q-1").getByRole("button", { name: "Show all" }).click(), (p) => p.locator("#needs > li[data-id^=perm] .l-t").click()], ".ov-needs"],
  ["c1-needs-open-dark", "overview", [(p) => line(p, "Q-1").getByRole("button", { name: "Show all" }).click()], ".ov-needs", "dark"],
  ["c2-needs-answering", "overview", [(p) => line(p, "Q-1").getByRole("button", { name: "Answer" }).click(), (p) => p.fill("form.answer textarea", "Fixture is fine, and note it on BOB-9 so"), (p) => p.waitForTimeout(5500)], ".ov-needs"],
  ["c1-waits-context", "waits", [(p) => p.getByRole("button", { name: "Show context" }).first().click()], null],
];

const browser = await chromium.launch();
for (const [w, [width, height]] of Object.entries(widths)) {
  for (const [file, hash, steps, el, scheme] of shots) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme ?? "light", isMobile: width < 600, hasTouch: width < 600 });
    const p = await ctx.newPage();
    await p.goto(`${page0}#${hash}`);
    // An element shot scrolls under the sticky header; let it scroll away.
    if (el) await p.addStyleTag({ content: "header { position: static; }" });
    for (const s of steps) await s(p);
    const out = join(here, `${file}-${w}.png`);
    if (el) await p.locator(el).screenshot({ path: out }); else await p.screenshot({ path: out, fullPage: true });
    await ctx.close();
    console.log(out);
  }
}
await browser.close();
