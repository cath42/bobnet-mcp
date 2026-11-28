// BOB-212 build B (ADR 0017 build task B4): the vendored LikeC4 viewer, as the library page frames it, on the sample's
// architecture (Toolshed): it draws, drills from a container into its components and zooms, at 1280 by mouse and 390
// by touch, under the Worker's content policies, with no console error and no request but its own document. It fails
// on a LikeC4 release that breaks any of these. test-ui/viewers.test.ts runs it in the broker's suite.
//   node test-ui/frame-test.mjs [shots dir]   (from packages/broker)
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { open, SAMPLE, serveViewer } from "./viewer-server.mjs";
import { viewerPath } from "../src/csp.ts";

const dir = join(SAMPLE, "library/architecture");
const files = readdirSync(dir).sort().map((n) => ({ path: `library/architecture/${n}`, text: readFileSync(join(dir, n), "utf8") }));

export async function frameTest(browser, shots) {
  const server = serveViewer("likec4", { t: "files", kind: "likec4", files, focus: "containers" });
  const results = [];
  try {
    for (const width of [1280, 390]) {
      const v = await open(browser, server, width);
      const shot = (n) => shots && v.page.screenshot({ path: join(shots, `frame-${width}-${n}.png`) });
      const node = (text) => v.frame.locator(".react-flow__node", { hasText: text }).first();
      // Drawn: every view of the model, with its crumb, and the starting view's boxes.
      const ready = (await v.msgs()).find((m) => m.t === "ready");
      assert.deepEqual(ready.errors, []);
      assert.deepEqual(ready.views.map((x) => x.id), ["index", "containers", "apiComponents", "workerComponents", "uc0001", "uc0002", "prod"]);
      assert.deepEqual(ready.views.find((x) => x.id === "apiComponents").crumb, ["index", "containers", "apiComponents"]);
      assert.equal(ready.views.find((x) => x.id === "uc0001").dynamic, true);
      await node("Reminder worker").waitFor({ timeout: 20000 });
      assert.equal(await v.frame.locator(".react-flow__node").count(), 11);
      await shot("1-containers");

      // Drill: API's own button opens its components, and the viewer tells the page where it went. On a phone a box in
      // a wide view is too small for its button to show on a tap; the button's click is the page's fallback (0017 §7).
      const api = node("API");
      if (width === 390) await api.tap(); else await api.hover();
      const drill = api.locator("button").first();
      await drill.click({ timeout: 3000 }).catch(() => drill.dispatchEvent("click"));
      await node("Reservations").waitFor({ timeout: 10000 });
      await v.page.waitForFunction(() => window.msgs.some((m) => m.t === "focus"), null, { timeout: 5000 });
      assert.deepEqual((await v.msgs()).filter((m) => m.t === "focus").at(-1), { t: "focus", focus: "apiComponents" });
      await v.page.waitForTimeout(800);
      await shot("2-drilled");

      // Zoom: a pinch, which reaches the page as a ctrl-wheel (a plain wheel pans), changes its scale; fit brings it back.
      const scale = async () => Number((await v.frame.locator(".react-flow__viewport").first().getAttribute("style")).match(/scale\(([\d.]+)\)/)[1]);
      const fitted = await scale();
      await v.page.mouse.move(width / 2, 400);
      await v.page.keyboard.down("Control");
      for (let i = 0; i < 5; i++) await v.page.mouse.wheel(0, -120);
      await v.page.keyboard.up("Control");
      await v.page.waitForTimeout(500);
      const zoomed = await scale();
      assert.ok(zoomed > fitted * 1.2, `zoomed in: ${fitted} -> ${zoomed}`);
      await shot("3-zoomed");
      await v.send({ t: "fit" });
      await v.page.waitForTimeout(600);
      assert.ok(Math.abs((await scale()) - fitted) < 0.02, "fit");

      // The page moves it: back out to the context, by the bar's ↑ Out or the route; no focus comes back for it.
      const focuses = (await v.msgs()).filter((m) => m.t === "focus").length;
      await v.send({ t: "focus", focus: "index" });
      await node("Toolshed").waitFor({ timeout: 10000 });
      await v.page.waitForTimeout(500);
      assert.equal(await node("Reservations").count(), 0);
      assert.equal((await v.msgs()).filter((m) => m.t === "focus").length, focuses);

      assert.deepEqual(v.errors, []);
      results.push({ width, ms: ready.ms, fitted, zoomed });
      await v.page.close();
    }
    assert.deepEqual([...new Set(server.seen)].sort(), ["/", "/host.css", "/host.js", viewerPath("likec4")].sort(), "no request leaves the frame");
  } finally {
    await server.close();
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  try {
    console.log(await frameTest(browser, process.argv[2]));
  } finally {
    await browser.close();
  }
}
