// BOB-115: Vitals' backlog (requirements/backlog.md's release table and its Drafts) as a Backlog.md
// tree, so the one import there is (`bobnet-supervisor import-backlog`) reads it as it read Helix's
// and Athletic's. Read through git at a commit, never from the worktree (Vita works in it).
//   node vitals-to-backlog.mjs <vitals repo> <ref> <out dir>
// Writes <out>/requirements/board/... and commits it in a fresh repo at <out>, its message naming the
// vitals commit. Each increment R<x.y> is one feature VIT-n in table order; its release file stays in
// the repo as the spec. R1.x go under board release R1 (closed: all done), R2.x under R2 (open).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [repo, ref, out] = process.argv.slice(2);
if (!repo || !ref || !out) throw new Error("usage: node vitals-to-backlog.mjs <vitals repo> <ref> <out dir>");
const git = (args, cwd = repo) => execFileSync("git", args, { cwd, encoding: "utf8" });
const sha = git(["rev-parse", "--short=12", `${ref}^{commit}`]).trim();
const backlog = git(["show", `${sha}:requirements/backlog.md`]);

const rows = [...backlog.matchAll(/^\| \*\*(R\d+\.\d+)\*\* +\| (.+?) +\| (.+?) +\| (.+?) +\|$/gm)].map((m) => ({
  rel: m[1],
  title: m[2].trim(),
  what: m[3].trim(),
  status: m[4].trim(),
}));
if (rows.length === 0) throw new Error("no release rows in requirements/backlog.md");

const dates = (path) => {
  const log = git(["log", "--format=%as", sha, "--", path]).trim().split("\n").filter(Boolean);
  return { created: log.at(-1) ?? null, updated: log[0] ?? null };
};
const yaml = (s) => JSON.stringify(s);
const file = (fm, sections) =>
  [
    "---",
    ...Object.entries(fm)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${typeof v === "number" ? v : yaml(v)}`),
    "---",
    "",
    ...Object.entries(sections)
      .filter(([, v]) => v)
      .flatMap(([k, v]) => [`<!-- SECTION:${k}:BEGIN -->`, v, `<!-- SECTION:${k}:END -->`, ""]),
  ].join("\n");

rmSync(out, { recursive: true, force: true });
const board = join(out, "requirements/board");
for (const d of ["tasks", "drafts", "milestones", "archive/milestones"]) mkdirSync(join(board, d), { recursive: true });

const majors = [...new Set(rows.map((r) => r.rel.split(".")[0]))];
const allDone = (major) => rows.filter((r) => r.rel.startsWith(`${major}.`)).every((r) => r.status.startsWith("☑"));
const milestoneTitle = { R1: "R1 — a working Vitals (R1.0 to R1.9)", R2: "R2 — written against use (R2.0 on)" };
for (const major of majors) {
  const folder = allDone(major) && major !== majors.at(-1) ? "archive/milestones" : "milestones";
  writeFileSync(join(board, folder, `m-${major.slice(1)} - ${major}.md`), file({ id: `m-${major.slice(1)}`, title: milestoneTitle[major] ?? major }, {}));
}

let n = 0;
const status = (s) => (s.startsWith("☑") ? "Done" : s.startsWith("◐") ? "In Progress" : s.startsWith("☐") ? "Ready" : null);
for (const r of rows) {
  const id = `VIT-${++n}`;
  const st = status(r.status);
  if (!st) throw new Error(`${r.rel}: status "${r.status}" isn't ☑, ◐ or ☐ (a dropped one needs a rule first)`);
  const spec = `requirements/releases/${r.rel}.md`;
  const { created, updated } = dates(spec);
  const done = /done (\d{4}-\d{2}-\d{2})/.exec(r.status)?.[1];
  writeFileSync(
    join(board, "tasks", `${id.toLowerCase()} - ${r.rel}.md`),
    file(
      { id, title: `${r.rel} ${r.title}`, status: st, type: "increment", milestone: `m-${r.rel.slice(1).split(".")[0]}`, ordinal: n, created_date: created, updated_date: done ?? updated },
      {
        DESCRIPTION: `${r.what}\n\nSpec (the contract): \`${spec}\`. "Build release ${r.rel.slice(1)}" still means: read that file and build what it says.`,
        NOTES: `Imported from requirements/backlog.md at vitals ${sha} (BOB-115). Its status there: ${r.status}`,
      },
    ),
  );
}

const drafts = /^## Drafts\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(backlog)?.[1] ?? "";
for (const d of drafts.split(/^### /m).slice(1)) {
  const [head, ...body] = d.split("\n");
  const id = `VIT-${++n}`;
  const added = /Added (\d{4}-\d{2}-\d{2})/.exec(d)?.[1] ?? null;
  writeFileSync(
    join(board, "drafts", `${id.toLowerCase()} - draft.md`),
    file(
      { id, title: head.trim(), status: "Draft", type: "task", created_date: added, updated_date: added },
      { DESCRIPTION: body.join("\n").trim(), NOTES: `Imported from requirements/backlog.md § Drafts at vitals ${sha} (BOB-115).` },
    ),
  );
}

git(["init", "-q"], out);
git(["remote", "add", "origin", "https://github.com/cath42/vitals.git"], out);
git(["add", "-A"], out);
git(["-c", "user.name=Mario", "-c", "user.email=mario@bobnet", "commit", "-q", "-m", `Vitals backlog at ${sha} as Backlog.md (BOB-115)`], out);
console.log(`${rows.length} increments, ${n - rows.length} drafts, ${majors.length} releases from vitals ${sha} -> ${board}`);
