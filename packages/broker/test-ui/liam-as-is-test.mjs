// BOB-212 build B (ADR 0017 §7 "The evidence", build task B4): the vendored ERD viewer, Liam ERD as is, as the library
// page frames it, on the sample's data model (Toolshed's library/data-model.dbml), at 1280 by mouse and 390 by touch:
//   - ready has no errors and 9 tables, and Liam draws 9;
//   - the frame's DDL is the unbundled @dbml/core exporter's, and Liam's parse in the frame is the Liam CLI's for that
//     DDL (both written by tools/vendor/build.mjs from the pinned packages, in test-ui/fixtures/viewers/);
//   - a DBML error comes back at its line;
//   - the only console error is the blocked Google Fonts request, and no request leaves but the frame's own document.
// It fails on a Liam or DBML release that breaks any of these. test-ui/viewers.test.ts runs it in the broker's suite.
//   node test-ui/liam-as-is-test.mjs [shots dir]   (from packages/broker)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { open, SAMPLE, serveViewer } from "./viewer-server.mjs";
import { viewerPath } from "../src/csp.ts";

const PATH = "library/data-model.dbml";
const text = readFileSync(join(SAMPLE, PATH), "utf8");
const fixtures = new URL("./fixtures/viewers/", import.meta.url).pathname;
const ddl = readFileSync(join(fixtures, "toolshed.sql"), "utf8");
const cli = JSON.parse(readFileSync(join(fixtures, "toolshed.liam.json"), "utf8"));
const sorted = (x) => Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted(x[k])])) : x;
// Liam's app asks Google Fonts for IBM Plex; the frame's policy blocks it and Liam uses the system font (0017 §7).
const notFonts = (errors) => errors.filter((e) => !e.includes("https://fonts.googleapis.com/"));
const files = (t) => ({ t: "files", kind: "erd", files: [{ path: PATH, text: t }] });

export async function liamAsIsTest(browser, shots) {
  const results = [];
  const server = serveViewer("erd", files(text));
  try {
    for (const width of [1280, 390]) {
      const t0 = Date.now();
      const v = await open(browser, server, width);
      const ready = (await v.msgs()).find((m) => m.t === "ready");
      assert.deepEqual(ready, { t: "ready", errors: [], tables: 9 });
      await v.frame.waitForSelector(".react-flow__node", { timeout: 20000 });
      await v.page.waitForTimeout(1500);
      assert.equal(await v.frame.locator(".react-flow__node").count(), 9);
      const ms = Date.now() - t0;
      const inFrame = await v.frame.evaluate((t) => window.dbmlToLiam(t), text);
      assert.equal(inFrame.sql, ddl, "the frame's DDL is the unbundled exporter's");
      assert.deepEqual(sorted(inFrame.schema), sorted(cli), "Liam's parse in the frame is the Liam CLI's");
      if (shots) await v.page.screenshot({ path: join(shots, `liam-as-is-${width}.png`) });
      // A click or a tap on a table: Liam's own focus and side pane.
      const loan = v.frame.locator(".react-flow__node", { hasText: "loan" }).first();
      if (width === 390) await loan.tap(); else await loan.click();
      await v.page.waitForTimeout(1200);
      if (shots) await v.page.screenshot({ path: join(shots, `liam-as-is-${width}-loan.png`) });
      assert.deepEqual(notFonts(v.errors), []);
      results.push({ width, ms, fontErrors: v.errors.length });
      await v.page.close();
    }
    assert.deepEqual([...new Set(server.seen)].sort(), ["/", "/host.css", "/host.js", viewerPath("erd")].sort(), "no request leaves the frame");
  } finally {
    await server.close();
  }

  // A DBML error, through the page's own message: by its line, and nothing drawn.
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("Table loan {")) + 2;
  lines.splice(at - 1, 0, "  oops");
  const broken = serveViewer("erd", files(lines.join("\n")));
  try {
    const v = await open(browser, broken, 1280);
    const ready = (await v.msgs()).find((m) => m.t === "ready");
    assert.equal(ready.tables, 0);
    assert.equal(ready.errors.length >= 1, true);
    assert.equal(ready.errors[0].path, PATH);
    assert.equal(ready.errors[0].line, at, JSON.stringify(ready.errors));
    assert.equal(await v.frame.locator(".react-flow__node").count(), 0);
    assert.deepEqual(notFonts(v.errors), []);
    results.push({ broken: ready.errors[0] });
    await v.page.close();
  } finally {
    await broken.close();
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  try {
    console.log(await liamAsIsTest(browser, process.argv[2]));
  } finally {
    await browser.close();
  }
}
