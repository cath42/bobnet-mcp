// Toad's fuzz for the review of BOB-44 A-fixes-3 (reviews/2026-11-20-bob44-a-fixes-3.md). Not shipped code.
// Setup: copy packages/protocol/src/secrets.ts to impl.ts and append __spans (redactSecrets' merged, edged spans),
// __PATTERNS and __BLOCKS as exports; copy the A-fixes-3 sketch to sketch.ts and append __sketchSpans
// (its merged spans). Run: node fuzz.ts <texts> <seed>.
// Checks per text: the output is the spans applied; findSecret of it is null; redacting it again changes nothing;
// every match of every pattern, at every start, lies inside one span; each BEGIN goes through the first END of its
// kind after it (or its line); every sketch span lies inside one span (the departures withhold more, never less).
import { findSecret, redactSecrets, __spans, __PATTERNS, __BLOCKS } from "./impl.ts";
import { __sketchSpans } from "./sketch.ts";
type S = [number, number];
const MARK = "[withheld: looks like a credential]";
const N = Number(process.argv[2] ?? 20000);
let seed = Number(process.argv[3] ?? 12345) >>> 0;
const rand = (n: number) => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return seed % n; };
const pick = <T,>(xs: readonly T[]) => xs[rand(xs.length)]!;
const B = "BEGIN", E = "END";
const FRAG = [
  "password", "PASSWORD", "DB_PASSWORD", "passwd", "secret", "SECRET_KEY", "api_key", "API-KEY", "apikey", "AWS_SECRET_ACCESS_KEY",
  "secret_detected", "password_detected", "x_password", "Xpassword", "_", "-", "=", ":", " = ", '"', "'", "\\", " ", "\n", "\r\n", ";", ",", "{", "}", ".",
  "sk-ant-api03-" + "a".repeat(22), "sk-" + "p".repeat(33), "AKIAIOSFODNN7EXAMPLE", "ASIA" + "Q".repeat(16), "ghp_" + "c".repeat(36), "github_pat_" + "d".repeat(60),
  "xoxb-" + "1".repeat(10), "Bearer ", "Bearer " + "t".repeat(24), "eyJ", "eyJ" + "h".repeat(10), ".eyJ" + "p".repeat(10), "." + "s".repeat(10),
  `-----${B} RSA PRIVATE KEY-----`, `-----${E} RSA PRIVATE KEY-----`, `-----${B} PGP PRIVATE KEY BLOCK-----`, `-----${E} PGP PRIVATE KEY BLOCK-----`, `-----${B} private key-----`,
  "PuTTY-User-Key-File-3:", "PuTTY-User-Key-File-2: ssh-rsa", "Private-MAC: ", "Private-MAC: a1b2", "ab12", "MIIE", "body",
  MARK, "[withheld", "credential]", "abc", "X", "9", "Tok",
];
const uniq = () => `Tok${seed % 100000}Z${"v".repeat(rand(9))}`;
const kinds: Record<string, number> = {};
let fails = 0, extra = 0, total = 0, checked = 0;
const fail = (what: string, text: string, out: string) => { fails++; kinds[what] = (kinds[what] ?? 0) + 1; if (fails <= 12) console.log("FAIL", what, JSON.stringify(text), "->", JSON.stringify(out)); };
const covered = (sp: S[], a: number, b: number) => sp.some(([s, e]) => s <= a && b <= e);
for (let n = 0; n < N; n++) {
  let text = "";
  for (let k = 1 + rand(14); k > 0; k--) text += rand(5) === 0 ? uniq() : pick(FRAG);
  const out = redactSecrets(text, MARK);
  const sp = __spans(text, MARK);
  let rebuilt = "", at = 0; for (const [s, e] of sp) { rebuilt += text.slice(at, s) + MARK; at = e; } rebuilt += text.slice(at);
  if (rebuilt !== out) fail("copy differs", text, out);
  if (findSecret(out) !== null) fail("residual " + findSecret(out), text, out);
  if (redactSecrets(out, MARK) !== out) fail("not idempotent", text, out);
  // Every match of every pattern, at every position, inside one span.
  for (const [name, re] of __PATTERNS) {
    const y = new RegExp(re.source, re.flags.replace("g", "") + "y");
    for (let i = 0; i < text.length; i++) { y.lastIndex = i; const m = y.exec(text); if (m) { checked++; if (!covered(sp, i, i + m[0].length)) fail("uncovered " + name, text, out); } }
  }
  // Ruling 2: each BEGIN through the first END of its kind after it; none after: its line.
  for (const blk of Object.values(__BLOCKS)) {
    const bs = [...text.matchAll(new RegExp(blk.begin.source, blk.begin.flags + "g"))];
    const es = [...text.matchAll(new RegExp(blk.end.source, blk.end.flags + "g"))];
    for (const b of bs) {
      const be = b.index! + b[0].length;
      const e = es.find((x) => x.index! >= be);
      const end = e ? e.index! + e[0].length : (() => { const r = /[\r\n]/g; r.lastIndex = b.index!; return r.exec(text)?.index ?? text.length; })();
      if (!covered(sp, b.index!, end)) fail("block", text, out);
    }
  }
  // The sketch's spans: a subset (Luigi's departures withhold more, never less).
  for (const [s, e] of __sketchSpans(text, MARK)) if (!covered(sp, s, e)) fail("less than sketch", text, out);
  const len = (x: S[]) => x.reduce((t, [s, e]) => t + e - s, 0);
  extra += len(sp) - len(__sketchSpans(text, MARK)); total += text.length;
}
console.log({ kinds, N, fails, checked, extraCharsOverSketch: extra, totalChars: total });
