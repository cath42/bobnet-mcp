// BOB-212 (ADR 0017 §2, §4): checks a repo's library/ against the standard, as protocol's readFrontMatter and the
// supervisor will. A reference for build A task 1, run on the sample: `node check-library.mjs sample`.
import fs from "node:fs"; import path from "node:path";
const root = path.join(process.argv[2], "library"), problems = [];
const say = (p, line, message) => problems.push(`${p}${line ? ":" + line : ""}  ${message}`);
const DATE = /^\d{4}-\d{2}-\d{2}$/, NUMS = /^\[(\d{4}(, *\d{4})*)?\]$/;
const CARDS = {
  decisions: { req: { status: ["proposed", "accepted", "rejected", "deprecated", "superseded"], date: DATE }, opt: { "decision-makers": /^\[.*\]$/, supersedes: NUMS, feature: /./ }, heads: ["Context", "Options", "Decision", "Consequences"] },
  usecases: { req: { status: ["draft", "agreed", "built", "retired"], actor: /./, date: DATE }, opt: { feature: /./ }, heads: ["Goal", "Preconditions", "Main scenario", "Extensions", "Acceptance"] },
  ux: { req: { status: ["draft", "in review", "approved", "changes asked", "built"], date: DATE }, opt: { feature: /./, "use-cases": NUMS, prototype: /^https?:\/\//, verdict: /^".*"$/, "verdict-date": DATE }, heads: ["Purpose", "Screens", "States", "Open questions"] },
  overview: { req: { title: /./ }, opt: { tagline: /./, "product-owner": /./, architect: /./, designer: /./ }, heads: ["Goals", "Stakeholders", "Scope", "Constraints", "Quality goals"] },
};
// Front matter: --- / key: value lines / ---. Values: plain, "quoted" or [a, b]; nothing nested.
function front(p, lines) {
  const head = {}; if (lines[0] !== "---") { say(p, 1, "no front matter"); return [head, 0]; }
  let i = 1; for (; i < lines.length && lines[i] !== "---"; i++) {
    const m = /^([a-z][a-z-]*): (.+)$/.exec(lines[i]); if (!m) { say(p, i + 1, "not a key: value line"); continue; }
    head[m[1]] = [m[2], i + 1];
  }
  return [head, i + 1];
}
function check(p, spec) {
  const lines = fs.readFileSync(path.join(root, p), "utf8").split("\n"), [head, body] = front(p, lines);
  for (const [k, rule] of Object.entries(spec.req)) if (!head[k]) say(p, 1, `missing ${k}`);
  for (const [k, [v, n]] of Object.entries(head)) {
    const rule = spec.req[k] ?? spec.opt[k]; if (!rule) { say(p, n, `unknown key ${k}`); continue; }
    if (Array.isArray(rule) ? !rule.includes(v) : !rule.test(v)) say(p, n, `${k}: "${v}" is not allowed`);
  }
  const title = lines.findIndex((l, i) => i >= body && l.startsWith("# ")); if (title < 0) say(p, null, "no # title");
  const got = lines.map((l, i) => [l, i + 1]).filter(([l]) => l.startsWith("## ")).map(([l, n]) => [l.slice(3), n]);
  spec.heads.forEach((h, i) => { if (got[i]?.[0] !== h) say(p, got[i]?.[1], `expected "## ${h}" here, found ${got[i] ? `"## ${got[i][0]}"` : "none"}`); });
  return head;
}
const known = new Set();
if (fs.existsSync(path.join(root, "overview.md"))) { known.add("overview.md"); check("overview.md", CARDS.overview); }
for (const s of ["decisions", "usecases", "ux"]) {
  const dir = path.join(root, s); if (!fs.existsSync(dir)) continue; const seen = new Set();
  for (const f of fs.readdirSync(dir).sort()) {
    if (s === "ux" && f === "images") { known.add("ux/images"); continue; }
    const m = /^(\d{4})-[a-z0-9-]+\.md$/.exec(f); if (!m) continue; known.add(`${s}/${f}`);
    if (seen.has(m[1])) say(`${s}/${f}`, null, `number ${m[1]} used twice`); seen.add(m[1]);
    check(`${s}/${f}`, CARDS[s]);
  }
}
if (fs.existsSync(path.join(root, "glossary.md"))) {
  known.add("glossary.md"); const terms = fs.readFileSync(path.join(root, "glossary.md"), "utf8").split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
  terms.forEach((t, i) => { if (i && t.localeCompare(terms[i - 1], "en", { sensitivity: "base" }) < 0) say("glossary.md", null, `"${t}" is out of alphabetical order`); });
}
for (const f of ["data-model.dbml"]) if (fs.existsSync(path.join(root, f))) known.add(f);
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (`${d}${e.name}` === "ux/images" ? [] : walk(`${d}${e.name}/`)) : [`${d}${e.name}`]);
for (const f of walk("")) if (!known.has(f) && !(f.startsWith("architecture/") && f.endsWith(".c4") && !f.slice(13).includes("/"))) say(f, null, "not part of the standard; not shown");
console.log(problems.length ? problems.join("\n") : "library/ follows the standard: 0 problems");
process.exitCode = problems.length ? 1 : 0;
