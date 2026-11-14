// Screenshots of the prototype for each of BOB-1's criteria, at 390, 1024 and 1440 px.
//   PLAYWRIGHT=<path to playwright-core> node design/BOB-1/shots/take.mjs
// Any playwright-core whose Chromium is installed will do (1.63.0 for chromium-1243).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(join(process.env.PLAYWRIGHT ?? "playwright-core", "index.mjs"));
const page0 = pathToFileURL(join(here, "../prototype/index.html")).href;
const widths = { phone: [390, 844], tablet: [1024, 768], desktop: [1440, 900] };

// [file, hash, steps before the shot, full page?, colour scheme]
const shots = [
  ["c1-overview", "overview", [], true],
  ["c1-roadmap", "roadmap/helix", [], true],
  ["c1-roadmap-unfolded", "roadmap/helix", [(p) => p.getByRole("button", { name: /^21 done/ }).click()], true],
  ["c2-feature-land-49", "feature/LAND-49", [], true],
  ["c2-feature-bob-1-running", "feature/BOB-1", [], true],
  ["c3-overview-count", "overview", [], false],
  ["c3-waits", "waits", [], true],
  ["c4-source", "source", [], true],
  ["c5-dark-roadmap", "roadmap/helix", [], false, "dark"],
  ["c5-states", "states", [], true],
  ["c7-capture", "triage/helix", [(p) => p.click("#capture-open"), (p) => p.fill("#cap-text", "Map: let me pin a tract to compare it with another one. Came up rehearsing the demo.")], false],
  ["c7-triage", "triage/helix", [], true],
  ["c7-triage-after-capture", "triage/helix", [(p) => p.click("#capture-open"), (p) => p.fill("#cap-text", "Map: let me pin a tract to compare it with another one. Came up rehearsing the demo."), (p) => p.getByRole("button", { name: "Capture", exact: true }).click()], false],
  ["c8-gates-edit", "roadmap/helix/edit", [], true],
  ["c8-gates-moved", "roadmap/helix/edit", [(p) => p.selectOption('select[aria-label="Release of LAND-45"]', "m-2")], false],
  ["c8-close-release", "roadmap/helix/edit", [(p) => p.locator("#rel-m-2").getByRole("button", { name: "Close release" }).click()], false],
  ["c8-gates-backlog-item", "triage/helix/edit", [(p) => p.selectOption('select[aria-label="Release of DRAFT-108"]', "m-2")], false],
  ["c9-capture-bug", "waits", [(p) => p.click("#capture-open"), (p) => p.fill("#cap-text", "Sign-in loops back to the start page on staging after choosing Google. Can't get into the demo account."),
    (p) => p.getByRole("button", { name: "Bug", exact: true }).click(), (p) => p.check("#cap-blocks")], false],
  ["c9-waits-with-bug", "waits", [(p) => p.click("#capture-open"), (p) => p.fill("#cap-text", "Sign-in loops back to the start page on staging after choosing Google. Can't get into the demo account."),
    (p) => p.getByRole("button", { name: "Bug", exact: true }).click(), (p) => p.check("#cap-blocks"), (p) => p.getByRole("button", { name: "Capture", exact: true }).click()], true],
  ["c9-triage-bugs", "triage/helix", [(p) => p.getByRole("button", { name: /^Bugs/ }).click()], true],
  // Round 2: context per call on a session card (a string in place of "full page" shoots that element)
  ["r2-ctx-running", "feature/LAND-49", [(p) => running(p).getByRole("button", { name: /Context per call/ }).click()], ".step[data-state=running]"],
  ["r2-ctx-running-agent", "feature/LAND-49", [(p) => running(p).getByRole("button", { name: /Context per call/ }).click(), (p) => running(p).locator(".seg").getByRole("button", { name: "Marvin" }).click()], ".step[data-state=running]"],
  ["r2-ctx-closed-agent", "feature/LAND-49", [(p) => build1(p).getByRole("button", { name: /Context per call/ }).click(), (p) => build1(p).locator(".seg").getByRole("button", { name: "Howard" }).click()], ".step:nth-child(2)"],
  // Round 2: answering from the dashboard
  ["r2-answer-question", "waits", [(p) => item(p, "How does staging get").getByRole("button", { name: "Answer" }).click(), (p) => item(p, "How does staging get").locator("input[value=a]").check(),
    (p) => item(p, "How does staging get").locator("textarea").fill("Yes, (a). I'll add Northfield Energy with one area tonight; rerun C11 tomorrow morning.")], false],
  ["r2-answered", "waits", [(p) => item(p, "How does staging get").getByRole("button", { name: "Answer" }).click(), (p) => item(p, "How does staging get").locator("input[value=a]").check(),
    (p) => item(p, "How does staging get").locator("textarea").fill("Yes, (a). I'll add Northfield Energy with one area tonight; rerun C11 tomorrow morning."),
    (p) => p.getByRole("button", { name: "Send answer" }).click()], true],
  ["r2-answer-overview", "overview", [(p) => p.locator(".ov-needs li", { hasText: "How does staging get" }).getByRole("button", { name: "Answer" }).click()], false],
  ["r2-answer-action", "waits", [(p) => item(p, "Try claude.ai").getByRole("button", { name: "Mark done" }).click()], "li:has(form.answer)"],
  ["r2-answer-permission", "waits", [(p) => item(p, "kill 33987").getByRole("button", { name: "Allow or deny" }).click()], "li:has(form.answer)"],
  // Round 2: waiting on CI / a run
  ["r2-ci-overview", "overview", [], false],
  ["r2-ci-feature", "feature/LAND-49", [], false],
  ["r2-ci-states", "states", [], true],
];
const running = (p) => p.locator(".step[data-state=running]");
const build1 = (p) => p.locator(".step").nth(1);
const item = (p, text) => p.locator(".waits li", { hasText: text });

const only = process.argv[2];
const browser = await chromium.launch();
try {
  for (const [size, [w, h]] of Object.entries(widths)) {
    for (const [name, hash, steps, full, scheme = "light"] of shots) {
      if (only && !name.startsWith(only)) continue;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: scheme });
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(`${page0}#${hash}`);
      for (const s of steps) await s(p);
      await p.waitForTimeout(150);
      const path = join(here, `${name}-${w}.png`);
      if (typeof full === "string") { await p.addStyleTag({ content: "header { position: static !important; }" }); await p.locator(full).first().screenshot({ path }); }
      else await p.screenshot({ path, fullPage: full });
      if (errors.length) throw new Error(`${name} at ${w}: ${errors.join("; ")}`);
      await ctx.close();
    }
    console.log(`${size} done`);
  }
} finally {
  await browser.close();
}
