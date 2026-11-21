// Messages carry paths, not content. The broker rejects any text that looks
// like a credential so nothing secret is ever stored in the cloud.

/** password_assignment is its name and then its value. */
const ASSIGNMENT = /\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["']?/;
// No `\` in the value: a JSON escape (a newline as `\n`) can't carry a match across what the field
// keeps apart, so the serialised body matches only where a field does (ADR 0007 §2).
const ASSIGNMENT_VALUE = /[^\s"'\\]{8,}/;

// No pattern has the `g` flag: findSecret's `test` would keep its lastIndex between calls.
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["anthropic_key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai_key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ["slack_token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["bearer", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/],
  ["password_assignment", new RegExp(ASSIGNMENT.source + ASSIGNMENT_VALUE.source, "i")],
];

/** Returns the name of the first credential pattern found, or null. */
export function findSecret(text: string): string | null {
  for (const [name, re] of PATTERNS) if (re.test(text)) return name;
  return null;
}

/**
 * Kinds whose credential is a block, not the pattern's own match: the BEGIN line is enough to detect
 * one, but the key is BEGIN through the END that closes it. Each kind pairs its own BEGINs and ENDs.
 */
const BLOCKS: Readonly<Record<string, { begin: RegExp; end: RegExp }>> = {
  private_key: { begin: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, end: /-----END [A-Z ]*PRIVATE KEY-----/ },
};

/**
 * Where a kind's blocks are, in one pass over its BEGINs and ENDs (linear in the text, ADR 0007 §14):
 * an END closes the latest open BEGIN, so a nested key goes whole with its outer one; an END with none
 * open is left; a BEGIN that no END closes is only its own line (Casper, 2026-11-20: a handoff quoting
 * one in prose keeps the rest). The spans in order, overlaps merged.
 */
function blockSpans(text: string, block: { begin: RegExp; end: RegExp }): Array<[number, number]> {
  const open: number[] = [];
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(new RegExp(`(${block.begin.source})|${block.end.source}`, "g"))) {
    if (m[1] !== undefined) open.push(m.index);
    else if (open.length > 0) spans.push([open.pop()!, m.index + m[0].length]);
  }
  // The unclosed, in order: one already inside the last line found needs no second search for its end.
  const eol = /[\r\n]/g;
  let lineEnd = -1;
  for (const start of open) {
    if (start < lineEnd) continue;
    eol.lastIndex = start;
    lineEnd = eol.exec(text)?.index ?? text.length;
    spans.push([start, lineEnd]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of spans) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text with every span that looks like a credential replaced by `mark`; the rest stays. */
export function redactSecrets(text: string, mark: string): string {
  let out = text;
  for (const block of Object.values(BLOCKS)) {
    let kept = "";
    let at = 0;
    for (const [s, e] of blockSpans(out, block)) {
      kept += out.slice(at, s) + mark;
      at = e;
    }
    out = kept + out.slice(at);
  }
  for (const [name, re] of PATTERNS) {
    if (name in BLOCKS || name === "password_assignment") continue;
    out = out.replace(new RegExp(re.source, `${re.flags}g`), mark);
  }
  // Last, and a value already marked is its value: `api_key = sk-ant-…` gives one mark, not a mark after a mark.
  return out.replace(new RegExp(`${ASSIGNMENT.source}(?:${escapeRegExp(mark)}|${ASSIGNMENT_VALUE.source})`, "gi"), mark);
}
