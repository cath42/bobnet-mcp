// BOB-212 prototype v4: data.js from the sample library, Toolshed (architecture/spikes/bob212/sample/library/), as
// the broker would answer the page (ADR 0017 §4): the `library` read's index, and the files `library_page` returns.
// Toolshed is fictional and public, so data.js is committed. The commit and dates are the sample's on v2.
//   node design/BOB-212/tools/gen_data.mjs [out]   (default: design/BOB-212/prototype/data.js)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const root = "architecture/spikes/bob212/sample/";
const out = process.argv[2] ?? path.join(here, "../prototype/data.js");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();

// ADR 0017 §1: the standard's paths. Anything else under library/ is a problem, never shown.
const SECTION = [
  [/^library\/overview\.md$/, "overview"],
  [/^library\/architecture\/[^/]+\.c4$/, "architecture"],
  [/^library\/data-model\.dbml$/, "data"],
  [/^library\/decisions\/\d{4}-[a-z0-9-]+\.md$/, "decisions"],
  [/^library\/usecases\/\d{4}-[a-z0-9-]+\.md$/, "usecases"],
  [/^library\/ux\/\d{4}-[a-z0-9-]+\.md$/, "ux"],
  [/^library\/glossary\.md$/, "glossary"],
];
const head = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  return m ? Object.fromEntries(m[1].split("\n").map((l) => l.match(/^([a-z][a-z-]*):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].replace(/^"(.*)"$/, "$1")])) : null;
};

const commit = git("log", "-1", "--format=%H", "--", root);
const files = [], texts = {};
for (const p of git("ls-tree", "-r", "--name-only", commit, "--", `${root}library/`).split("\n").sort()) {
  const rel = p.slice(root.length), section = SECTION.find(([re]) => re.test(rel))?.[1];
  if (!section) continue;
  const text = git("show", `${commit}:${p}`);
  const [sha, date] = git("log", "-1", "--format=%H %cI", commit, "--", p).split(" ");
  const md = rel.endsWith(".md");
  files.push({ path: rel, section, blob: git("rev-parse", `${commit}:${p}`), changed: { sha: sha.slice(0, 7), date },
    title: md ? text.match(/^# (.+)$/m)?.[1] ?? null : null, head: md ? head(text) : null });
  texts[rel] = text;
}
const lib = {
  key: "toolshed", ref: "main", commit, committed_at: git("log", "-1", "--format=%cI", commit), laptop: "mbp-1",
  // The prototype links to the sample's files in bobnet-mcp; a real project links to its own repo (0015 §3).
  github: "https://github.com/cath42/bobnet-mcp", root,
  index: { standard: 1, files }, texts,
};
fs.writeFileSync(out, `// Made by tools/gen_data.mjs from ${root}library/ at ${commit.slice(0, 7)}. Toolshed is fictional and public.\nwindow.LIBS = ${JSON.stringify({ toolshed: lib }, null, 1)};\n`);
console.log(`${out}: ${files.length} files, ${Math.round(fs.statSync(out).size / 1024)} KB`);
