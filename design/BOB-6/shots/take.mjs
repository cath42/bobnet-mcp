// Screenshots of BOB-6's prototype at 390, 1024 and 1440 px.
//   node design/BOB-6/shots/take.mjs   (playwright-core from @bobnet/broker, as design/BOB-33/shots/take.mjs)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../../../packages/broker/package.json"))("playwright-core");
const page0 = pathToFileURL(join(here, "../prototype/index.html")).href;
const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };
const only = process.argv[2];

const scen = (name) => (p) => p.locator(".proto-bar").getByRole("button", { name, exact: true }).click();
const start = (p) => p.locator("#next .start-row button.primary").click();
const send = async (p) => { await p.locator("#send-btn").click(); };
const ask = (p) => p.locator("dialog .foot button.primary").click();
const offline = (p) => p.locator(".proto-bar").getByRole("button", { name: "offline", exact: true }).click();
const edit = async (p) => { await p.locator("#brief").evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); await p.keyboard.type("\n\nLuigi: the Withdraw button needs its own test; poe must hear the withdrawal."); };
const top = (p) => p.evaluate(() => window.scrollTo(0, 0));
const next = (p) => p.locator("#next").scrollIntoViewIfNeeded();

// [file, steps, full page?, colour scheme]
const shots = [
  ["s1-offered", [], true],
  ["s1-offered-top", [], false],
  ["s1-offered-dark", [], true, "dark"],
  ["s2-limit", [scen("Helix: one open feature")], true],
  ["s2-limit-top", [scen("Helix: one open feature")], false],
  ["s3-held", [scen("Held by your question")], true],
  ["s4-editor", [start, top], false],
  ["s4-editor-full", [start], true],
  ["s5-edited", [start, edit], true],
  ["s5-label-taken", [start, (p) => p.locator(".seg.kinds").getByRole("button", { name: "Design" }).click(), async (p) => { await p.fill("#label", "A"); await p.press("#label", "Tab"); }], false],
  ["s6-confirm", [start, edit, send], false],
  ["s7-refused", [scen("Refused on send"), start, send, ask, top], false],
  ["s8-pending", [start, edit, send, ask], true],
  ["s8-pending-top", [start, send, ask, top], false],
  ["s9-pending-offline", [offline, start, send, ask], true],
  ["s10-declined", [start, edit, send, ask, (p) => p.locator(".proto-bar").getByRole("button", { name: "declines it" }).click()], true],
  ["s11-started", [start, edit, send, ask, (p) => p.locator(".proto-bar").getByRole("button", { name: "starts it" }).click()], true],
  ["s13-no-supervisor", [(p) => p.locator(".proto-bar").getByRole("button", { name: "none runs it" }).click()], true],
  ["s12-withdraw", [start, send, ask, (p) => p.getByRole("button", { name: "Withdraw request" }).click()], false],
];

const browser = await chromium.launch();
for (const [w, [width, height]] of Object.entries(widths)) {
  for (const [file, steps, full, scheme] of shots) {
    if (only && !file.startsWith(only)) continue;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme ?? "light", isMobile: width < 600, hasTouch: width < 600 });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error(`${file}-${w}: ${e.message}`));
    await p.goto(page0);
    for (const s of steps) await s(p);
    await p.waitForTimeout(150);
    // A full-page shot is one tall viewport, so a sticky foot would float mid-page: it sits in its place instead.
    if (full) await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    if (full) await p.addStyleTag({ content: ".se-foot { position: static !important; }" });
    const out = join(here, `${file}-${w}.png`);
    await p.screenshot({ path: out, fullPage: full });
    await ctx.close();
  }
}
await browser.close();
console.log("done");
