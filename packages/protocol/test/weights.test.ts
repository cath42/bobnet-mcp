import { describe, expect, it } from "vitest";
import { USAGE_WEIGHTS, USAGE_WEIGHTS_READ_AT, weigh, weightOf, type TokenTotals } from "../src/index.ts";

// Usage weighted by model (ADR 0014 §1, BOB-166): ratios to Sonnet 5.5, never by effort.

const tokens = (input: number, output: number, cache_read: number, cache_write: number): TokenTotals => ({ input, output, cache_read, cache_write });
const t = tokens(100, 20, 1000, 40);
const raw = 1160;

describe("the weight table (ADR 0014 §1)", () => {
  it("records the date it was read and holds ratios as rows", () => {
    expect(USAGE_WEIGHTS_READ_AT).toBe("2026-11-22");
    for (const r of USAGE_WEIGHTS) expect(Object.keys(r).sort()).toEqual(["alias", "cache_read", "cache_write", "input", "model", "output"]);
    expect(new Set(USAGE_WEIGHTS.map((r) => r.model)).size).toBe(USAGE_WEIGHTS.length);
    expect(USAGE_WEIGHTS.filter((r) => r.alias).map((r) => [r.alias, r.model])).toEqual([
      ["sonnet", "claude-sonnet-5-5"],
      ["opus", "claude-opus-5-5"],
      ["haiku", "claude-haiku-5-5"],
      ["fable", "claude-fable-5-1"],
    ]);
  });

  it("weighs Sonnet 5.5 to its raw sum", () => {
    expect(weigh(t, "claude-sonnet-5-5")).toEqual({ weighted: raw, unknown: 0 });
    expect(weigh(t, "sonnet")).toEqual({ weighted: raw, unknown: 0 });
  });

  it("weighs `opus` and `claude-opus-5-5` both ×2 on every kind", () => {
    for (const m of ["opus", "claude-opus-5-5", "Opus"]) {
      expect(weigh(t, m)).toEqual({ weighted: 2 * raw, unknown: 0 });
      for (const k of ["input", "output", "cache_read", "cache_write"] as const) expect(weightOf(m)![k]).toBe(2);
    }
  });

  it("weighs Fable 5.1's cache reads ×2.5 and its other kinds ×5", () => {
    expect(weigh(tokens(1, 0, 0, 0), "fable").weighted).toBe(5);
    expect(weigh(tokens(0, 1, 0, 0), "fable").weighted).toBe(5);
    expect(weigh(tokens(0, 0, 0, 1), "fable").weighted).toBe(5);
    expect(weigh(tokens(0, 0, 1, 0), "claude-fable-5-1").weighted).toBe(2.5);
    expect(weigh(t, "claude-fable-5-1")).toEqual({ weighted: 5 * 160 + 2.5 * 1000, unknown: 0 });
  });

  it("counts null, empty and an unknown model at ×1, as unknown", () => {
    for (const m of [null, "", "gpt-9", "default"]) {
      expect(weightOf(m)).toBeNull();
      expect(weigh(t, m)).toEqual({ weighted: raw, unknown: raw });
    }
  });

  it("resolves a full id with a date suffix or a context tag, and a family at a version it lacks by its alias", () => {
    expect(weightOf("claude-opus-5-5-20261001")?.model).toBe("claude-opus-5-5");
    expect(weightOf("claude-opus-5-20260301")?.model).toBe("claude-opus-5");
    expect(weightOf("claude-haiku-4-5-20251001")?.model).toBe("claude-haiku-4-5");
    expect(weightOf("claude-opus-4-6[1m]")?.model).toBe("claude-opus-4-6");
    expect(weightOf("claude-sonnet-6-1")?.model).toBe("claude-sonnet-5-5");
    expect(weightOf("claude-fable-5-2")?.model).toBe("claude-fable-5-2");
    // A family no alias names has no current model.
    expect(weightOf("claude-mythos-5-1")?.model).toBe("claude-mythos-5-1");
    expect(weightOf("claude-mythos-6")).toBeNull();
  });

  it("has no effort parameter: effort changes nothing", () => {
    expect(weigh.length).toBe(2);
    expect(weightOf.length).toBe(1);
  });
});
