import type { TokenTotals } from "./board.ts";

// Usage weighted by model (ADR 0014 §1): each model's tokens count at its ratio to Claude Sonnet 5.5,
// kind by kind, so a weighted count is still tokens ("Sonnet-equivalent"). The ratios are read off
// Anthropic's pricing page (platform.claude.com/docs/en/about-claude/pricing) and kept as ratios only.
// Effort is never weighted: higher effort already shows as more tokens. Update this table by hand when
// Anthropic changes its models, and the date with it.

/** One model's ratio to Sonnet 5.5, per token kind. `alias`: the family alias that names this model, the family's current one. */
export interface UsageWeight {
  model: string;
  alias: string | null;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

/** When the table was read off the pricing page. */
export const USAGE_WEIGHTS_READ_AT = "2026-11-22";

const row = (model: string, alias: string | null, input: number, cache_read: number): UsageWeight => ({
  model,
  alias,
  input,
  output: input,
  cache_read,
  cache_write: input,
});

/** ADR 0014 §1's table. The 5-minute and 1-hour cache writes have the same ratio between models: one column. */
export const USAGE_WEIGHTS: readonly UsageWeight[] = [
  row("claude-sonnet-5-5", "sonnet", 1, 1),
  row("claude-opus-5-5", "opus", 2, 2),
  // Prompts up to 100k: a run's report has no per-call prompt size, so the higher tier is never applied.
  row("claude-haiku-5-5", "haiku", 0.05, 0.1),
  row("claude-fable-5-1", "fable", 5, 2.5),
  row("claude-fable-5-2", null, 4, 2),
  row("claude-mythos-5-1", null, 5, 2.5),
  row("claude-mythos-5-2", null, 4, 2),
  row("claude-opus-5", null, 2.5, 5),
  row("claude-opus-4-8", null, 2.5, 5),
  row("claude-opus-4-7", null, 2.5, 5),
  row("claude-opus-4-6", null, 2.5, 5),
  row("claude-opus-4-5", null, 2.5, 5),
  row("claude-sonnet-5", null, 1, 2),
  row("claude-sonnet-4-6", null, 1.5, 3),
  row("claude-sonnet-4-5", null, 1.5, 3),
  row("claude-haiku-4-5", null, 0.5, 1),
];

/** The four token kinds, each weighed by its own column. */
const KINDS = ["input", "output", "cache_read", "cache_write"] as const;

/** `claude-<family>-<major>[-<minor>]`, with an optional date suffix; a context tag (`[1m]`) is cut first. */
const FULL_ID = /^claude-([a-z]+)-(\d{1,2}(?:-\d{1,2})?)(?:-\d{8})?$/;

/**
 * A model's row (§1): a full id by its family and version; a bare alias, or a known family at a
 * version the table lacks, by the alias's row; anything else, null included, is unknown (null). A
 * family no alias names (Mythos) has no current model, so an unknown version of it is unknown.
 */
export function weightOf(model: string | null, table: readonly UsageWeight[] = USAGE_WEIGHTS): UsageWeight | null {
  if (!model) return null;
  const m = model.trim().toLowerCase().replace(/\[[^\]]*\]$/, "");
  const alias = table.find((r) => r.alias === m);
  if (alias) return alias;
  const id = FULL_ID.exec(m);
  if (!id) return null;
  return table.find((r) => r.model === "claude-" + id[1] + "-" + id[2]) ?? table.find((r) => r.alias === id[1]) ?? null;
}

/** All four kinds, unweighted. */
export function rawSum(t: TokenTotals): number {
  return t.input + t.output + t.cache_read + t.cache_write;
}

/**
 * A run's tokens weighed by its model (§1). `unknown`: the raw tokens of a model the table can't
 * resolve, which count at ×1 in `weighted` too; 0 for a known model.
 */
export function weigh(tokens: TokenTotals, model: string | null, table: readonly UsageWeight[] = USAGE_WEIGHTS): { weighted: number; unknown: number } {
  const w = weightOf(model, table);
  if (!w) {
    const raw = rawSum(tokens);
    return { weighted: raw, unknown: raw };
  }
  return { weighted: KINDS.reduce((sum, k) => sum + tokens[k] * w[k], 0), unknown: 0 };
}
