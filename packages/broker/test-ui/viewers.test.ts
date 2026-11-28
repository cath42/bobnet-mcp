// @vitest-environment node
// BOB-212 build B (ADR 0017 build task B4): the vendored viewers in a real Chromium, as the library page frames them,
// at 1280 and 390 wide. They fail on a LikeC4, Liam or DBML release that breaks them; each also runs alone with node.
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { frameTest } from "./frame-test.mjs";
import { liamAsIsTest } from "./liam-as-is-test.mjs";

describe("the vendored viewers (ADR 0017 §7)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);
  afterAll(() => browser?.close());

  it("draws the sample's architecture in LikeC4, drills from a container into its components and zooms, at 1280 and 390 (frame-test)", async () => {
    const results = await frameTest(browser);
    expect(results.map((r: { width: number }) => r.width)).toEqual([1280, 390]);
  }, 180_000);

  it("draws the sample's 9 tables in Liam ERD as is: the exporter's DDL, Liam CLI's parse, a DBML error at its line, only Google Fonts refused (liam-as-is-test)", async () => {
    const results = await liamAsIsTest(browser);
    expect(results.map((r: { width?: number }) => r.width)).toEqual([1280, 390, undefined]);
  }, 180_000);
});
