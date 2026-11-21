// A-fixes-4 review (Toad, 2026-11-21): redactSecrets timings on adversarial 200 KB inputs, best of 3 after a warm-up.
// Run: node architecture/reviews/2026-11-21-a-fixes-4-timing.mts (node 24). The last line uses a mark that
// starts with a word character (no caller does), the review's m1.
import { redactSecrets, findSecret } from "../../packages/protocol/src/secrets.ts";
const M = "[withheld: looks like a credential]";
const best = (f: () => unknown) => { f(); let b = Infinity; for (let i = 0; i < 3; i++) { const t = performance.now(); f(); b = Math.min(b, performance.now() - t); } return b; };
const N = 200_000;
const fill = (u: string) => u.repeat(Math.ceil(N / u.length)).slice(0, N);
const cases: Record<string, [string, string]> = {
  "M1 chain xoxb-aaaaaaaaaa_-": [fill("xoxb-aaaaaaaaaa_-"), M],
  "xoxb-..._": [fill("xoxb-aaaaaaaaaa_"), M],
  "glued ghp tokens a+ghp_": [fill("a ghp_" + "A".repeat(36) + "x"), M],
  "putty glued Z": [fill("ZPuTTY-User-Key-File-1:Private-MAC:abZ"), M],
  "putty unclosed glued": [fill("aPuTTY-User-Key-File-1:"), M],
  "putty in one word run": ["a".repeat(N/2) + fill("PuTTY-User-Key-File-1:Private-MAC:0a").slice(0, N/2), M],
  "aws glued": [fill(" AKIAAAAAAAAAAAAAAAAA"), M],
  "assign _password": [fill("a_password=12345678"), M],
  "assign glued alnum": [fill("_secret=abcdefgh_"), M],
  "word run + putty starts": [fill("aaaaPuTTY-User-Key-File-1:\n"), M],
  "mark glued in word": [fill("a" + M + "a"), M],
  "word mark REDACTED 20k": [fill("aREDACTED").slice(0, 20000), "REDACTED"],
};
for (const [k, [t, m]] of Object.entries(cases)) {
  const ms = best(() => redactSecrets(t, m));
  console.log(k.padEnd(34), t.length, ms.toFixed(1), "ms", findSecret(t));
}
