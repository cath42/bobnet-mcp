// bb51add's secrets.ts, verbatim below this line: the reference BOB-89's fuzz compares redactSecrets with (AC 2).
// Messages carry paths, not content. The broker rejects any text that looks
// like a credential so nothing secret is ever stored in the cloud.

/**
 * password_assignment is its name and then its value. The name may have `_` before it (`DB_PASSWORD`, the
 * match starting at the keyword) and up to 4 `_` segments after it (`AWS_SECRET_ACCESS_KEY`), bounded so a
 * run of `_password` stays linear; `secret_detected`, BobNet's own refusal text, is no name, and the guard is on
 * `secret` only, so `password_detected` is one (ADR 0007 §14, "Ruling, A-fixes-3" 4).
 */
const ASSIGNMENT = /(?<![A-Za-z0-9])(?:password|passwd|secret(?!_detected\b)|api[_-]?key)(?:_[A-Za-z0-9]{1,32}){0,4}\s*[:=]\s*["']?/;
// No `\` in the value: a JSON escape (a newline as `\n`) can't carry a match across what the field
// keeps apart, so the serialised body matches only where a field does (ADR 0007 §2).
const ASSIGNMENT_VALUE = /[^\s"'\\]{8,}/;
const VALUE_RUN = /[^\s"'\\]+/;

/**
 * Kinds whose credential is a block, not the pattern's own match: the BEGIN line is enough to detect
 * one, but the key is BEGIN through the END that closes it. Each kind pairs its own BEGINs and ENDs.
 * A label of at most 40 characters, any case, PGP's `BLOCK` too; a PuTTY header as PuTTY reads it, through
 * its Private-MAC, which covers v2 and v3 (ADR 0007 §14).
 */
const BLOCKS: Readonly<Record<string, { begin: RegExp; end: RegExp }>> = {
  private_key: { begin: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/i, end: /-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/i },
  putty_key: { begin: /PuTTY-User-Key-File-\d{1,2}:/, end: /Private-MAC:[ \t]*[0-9a-f]{1,128}/i },
};

// No pattern has the `g` flag: findSecret's `test` would keep its lastIndex between calls.
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private_key", BLOCKS.private_key!.begin],
  ["putty_key", BLOCKS.putty_key!.begin],
  ["anthropic_key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai_key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ["slack_token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  // Not `\b`: every `-eyJ` inside a run would start a scan of the whole run (ADR 0007 §14, "Ruling, A-fixes-3" 3).
  ["jwt", /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["bearer", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/],
  ["password_assignment", new RegExp(ASSIGNMENT.source + ASSIGNMENT_VALUE.source, "i")],
];

/** Returns the name of the first credential pattern found, or null. */
export function findSecret(text: string): string | null {
  for (const [name, re] of PATTERNS) if (re.test(text)) return name;
  return null;
}

type Span = [number, number];
const WORD = /\w/;
const ALNUM = /[A-Za-z0-9]/;
const TOKEN = /[A-Za-z0-9_-]/;

/** Every match of `re` in `text`, as [start, end], each found once. */
const spansOf = (text: string, re: RegExp): Span[] =>
  Array.from(text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`)), (m) => [m.index, m.index + m[0].length]);

/** Spans in order, overlapping or touching ones merged. */
function merge(spans: Span[]): Span[] {
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const [s, e] of spans) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * Where a kind's blocks are (ADR 0007 §14, "Ruling, A-fixes-3" 2): each BEGIN goes through the first END of
 * its kind that starts after it, so a BEGIN quoted in prose before a key goes whole with it; and, unioned with
 * that, an END closes the latest open BEGIN, so a nested key's outer tail goes too (Toad, consult on BOB-85).
 * Only a BEGIN with no END after it is its own line (Casper, 2026-11-20: a handoff quoting one in prose keeps
 * the rest). BEGINs and ENDs each found once and walked in order: linear in the text.
 */
function blockSpans(text: string, block: { begin: RegExp; end: RegExp }): Span[] {
  const begins = spansOf(text, block.begin);
  const ends = spansOf(text, block.end);
  const spans: Span[] = [];
  const eol = /[\r\n]/g;
  let lineEnd = -1;
  for (let b = 0, e = 0; b < begins.length; b++) {
    const [start, beginEnd] = begins[b]!;
    while (e < ends.length && ends[e]![0] < beginEnd) e++;
    if (e < ends.length) spans.push([start, ends[e]![1]]);
    else if (start >= lineEnd) {
      // The unclosed come last, in order: one already inside the last line found needs no second search.
      eol.lastIndex = start;
      lineEnd = eol.exec(text)?.index ?? text.length;
      spans.push([start, lineEnd]);
    }
  }
  const open: number[] = [];
  for (let b = 0, e = 0; b < begins.length || e < ends.length; ) {
    if (e >= ends.length || (b < begins.length && begins[b]![0] < ends[e]![0])) open.push(begins[b++]![0]);
    else {
      const end = ends[e++]![1];
      if (open.length > 0) spans.push([open.pop()!, end]);
    }
  }
  return spans;
}

/**
 * password_assignment's spans (ADR 0007 §14, "Ruling, A-fixes-3" 1), on the original text. Its prefix is found
 * at every keyword, and its value is the run of value characters from the prefix's end: it goes, from the
 * keyword, when the run is 8 or more long or reaches another span (then through that span), so a short value
 * can't swallow the next assignment's name and leave its value in clear. Linear: the runs are found once, each
 * prefix's run end by a pointer walk, and what it reaches by one walk right to left over `other` (merged).
 */
function assignmentSpans(text: string, other: readonly Span[]): Span[] {
  const runs = spansOf(text, VALUE_RUN);
  const prefixes = spansOf(text, new RegExp(ASSIGNMENT.source, "i"));
  const runEnds: number[] = [];
  for (let r = 0, i = 0; i < prefixes.length; i++) {
    const q = prefixes[i]![1];
    while (r < runs.length && runs[r]![1] <= q) r++;
    runEnds.push(r < runs.length && runs[r]![0] <= q ? runs[r]![1] : q);
  }
  const spans: Span[] = [];
  // The leftmost span ending after the prefix in hand: another kind's, or an assignment already taken.
  let next: Span | null = null;
  for (let o = other.length - 1, i = prefixes.length - 1; i >= 0; i--) {
    const [p, q] = prefixes[i]!;
    for (; o >= 0 && other[o]![1] > q; o--) if (!next || other[o]![0] < next[0]) next = other[o]!;
    const end = runEnds[i]!;
    const reach = next && next[0] <= end ? next[1] : -1;
    if (end - q >= 8 || reach >= 0) {
      const span: Span = [p, Math.max(end, reach)];
      spans.push(span);
      if (!next || p < next[0]) next = span;
    }
  }
  return spans;
}

/**
 * The text with every span that looks like a credential replaced by `mark`; the rest stays. Every span is
 * found on the original text (blocks, tokens, a mark already there, then assignments), the spans unioned and
 * each merged one a single mark: no pattern reads another's output (ADR 0007 §14, "Ruling, A-fixes-3" 1).
 */
export function redactSecrets(text: string, mark: string): string {
  const found: Span[] = [];
  for (const block of Object.values(BLOCKS)) found.push(...blockSpans(text, block));
  for (const [name, re] of PATTERNS) if (!(name in BLOCKS) && name !== "password_assignment") found.push(...spansOf(text, re));
  if (mark) for (let i = text.indexOf(mark); i >= 0; i = text.indexOf(mark, i + mark.length)) found.push([i, i + mark.length]);
  const other = merge(found);
  // A mark never starts or ends inside a word: one there would give the text beside it a boundary it didn't
  // have, and a match (`…EXAMPLE` + a PuTTY header; a Private-MAC's hex + `ghp_…`; an END's `-----` + `eyJ…`).
  // Before a span, a letter or digit takes its word back (`DB_` stays: `_` is no boundary for the keyword);
  // after one, the run of token characters goes with it.
  const edged = merge([...other, ...assignmentSpans(text, other)]).map(([s, e]): Span => {
    if (s > 0 && ALNUM.test(text[s - 1]!) && WORD.test(text[s]!)) while (s > 0 && WORD.test(text[s - 1]!)) s--;
    if (e < text.length && TOKEN.test(text[e - 1]!) && WORD.test(text[e]!)) while (e < text.length && TOKEN.test(text[e]!)) e++;
    return [s, e];
  });
  let out = "";
  let at = 0;
  for (const [s, e] of merge(edged)) {
    out += text.slice(at, s) + mark;
    at = e;
  }
  return out + text.slice(at);
}
