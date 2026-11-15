import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardExportV1 } from "@bobnet/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  type BacklogFiles,
  backlogToExport,
  EVERY_PROJECT_WARNING,
  type ImportGrant,
  importBacklogCommand,
  readBacklogAt,
  readGrants,
  readQuestions,
} from "../src/backlog-import.ts";
import type { ImportPosted } from "../src/board-backup.ts";

// The Backlog.md import (ADR 0001 §11, BOB-9): a backlog at a commit as one board export.

const helix = { key: "helix", name: "Helix", prefix: "LAND", draft_prefix: "DRAFT", lead: null, po: null, repos: ["helix"] };
const now = new Date("2026-11-14T12:00:00.000Z");

function task(id: string, fm: Record<string, string | string[] | number> = {}, body = ""): string {
  const lines = [`id: ${id}`, `title: '${id} title'`];
  for (const [k, v] of Object.entries({ status: "Ready", created_date: "2026-11-01 10:00", updated_date: "2026-11-02 11:30", ...fm })) lines.push(Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${x}`).join("\n")}` : `${k}: ${typeof v === "string" ? `'${v}'` : v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}
const desc = (text: string) => `## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\n${text}\n<!-- SECTION:DESCRIPTION:END -->\n`;
const ac = (...rows: string[]) => `## Acceptance Criteria\n<!-- AC:BEGIN -->\n${rows.join("\n")}\n<!-- AC:END -->\n`;

function backlog(files: Array<[BacklogFiles["files"][number]["folder"], string]>, questions: string | null = null): BacklogFiles {
  return { sha: "abc123def456", repo: "helix", files: files.map(([folder, text], i) => ({ folder, path: `product/backlog/${folder}/f${i}.md`, text })), questions };
}

const milestones: Array<[BacklogFiles["files"][number]["folder"], string]> = [
  ["milestones", "---\nid: m-1\ntitle: \"R0 Sign in\"\n---\n"],
  ["archive/milestones", "---\nid: m-2\ntitle: \"R1 Partner demo\"\n---\n"],
  ["milestones", "---\nid: m-3\ntitle: \"R2 Edit\"\n---\n"],
];

/** A repository with a backlog committed in it, and the commit. */
function repo(files: Record<string, string>): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "backlog-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git("add", ".");
  git("commit", "-q", "-m", "one");
  return { dir, sha: git("rev-parse", "--short=12", "HEAD").trim() };
}

describe("the Backlog.md import", () => {
  it("keeps undotted ids, renumbers dotted ones numerically past every id, and maps every link to the new refs", () => {
    const { doc, report } = backlogToExport(
      helix,
      backlog([
        ...milestones,
        ["tasks", task("LAND-49", { type: "increment", milestone: "m-3", ordinal: 1000 }, desc("The feature") + ac("- [x] #1 Done one", "- [ ] #2 Not yet"))],
        ["tasks", task("LAND-49.19", { type: "task", parent_task_id: "LAND-49", dependencies: ["LAND-49.2"] })],
        ["tasks", task("LAND-49.2", { type: "task", parent_task_id: "LAND-49", dependencies: ["LAND-99"] })],
        ["tasks", task("LAND-50", { type: "increment", milestone: "m-1" })],
      ]),
      now,
    );
    expect(report.renumbered).toEqual([
      ["LAND-49.2", "LAND-51"],
      ["LAND-49.19", "LAND-52"],
    ]);
    const p = BoardExportV1.parse(doc).projects[0]!;
    const item = (ref: string) => p.items.find((i) => i.ref === ref)!;
    expect(item("LAND-52")).toMatchObject({ kind: "task", parent: "LAND-49", deps: ["LAND-51"], aliases: ["LAND-49.19"], release: null });
    expect(item("LAND-49")).toMatchObject({
      kind: "feature",
      release: "R2",
      ord: 1000,
      description: "The feature",
      created_at: "2026-11-01T10:00:00.000Z",
      criteria: [
        { section: "ac", n: 1, text: "Done one", state: "checked", checked_at: "2026-11-02T11:30:00.000Z" },
        { section: "ac", n: 2, text: "Not yet", state: "open" },
      ],
    });
    expect(p.next.item).toBe(53);
    expect(p.releases).toMatchObject([
      { ref: "R0", status: "open", ord: 1 },
      { ref: "R1", status: "closed", ord: 2 },
      { ref: "R2", status: "planned", ord: 3 },
    ]);
    expect(report.problems).toEqual(["LAND-49.2 (LAND-51): dependency LAND-99 isn't on the board; dropped"]);
    // The same commit gives the same document.
    expect(backlogToExport(helix, backlog([...milestones, ["tasks", task("LAND-49.19")], ["tasks", task("LAND-49.2")]]), now).report.renumbered).toEqual([
      ["LAND-49.2", "LAND-50"],
      ["LAND-49.19", "LAND-51"],
    ]);
  });

  it("links a re-creation to its old id, absorbing an archived old item, and reports one still on the board", () => {
    const { doc, report } = backlogToExport(
      helix,
      backlog([
        ["tasks", task("LAND-40", { type: "increment" })],
        ["tasks", task("LAND-40.1", { type: "task", parent_task_id: "LAND-40" }, desc("Was LAND-17.9; renumbered under its parent."))],
        ["archive/tasks", task("LAND-17.9", { type: "task" }, desc("Was LAND-20.2."))],
        ["drafts", task("DRAFT-1", { status: "Draft", parent_task_id: "LAND-40" }, desc("Was LAND-18.1 (the Inbox becomes drafts)."))],
        ["tasks", task("LAND-41", { type: "task" }, desc("Was LAND-40."))],
      ]),
      now,
    );
    const p = doc.projects[0]!;
    expect(p.items.find((i) => i.aliases.includes("LAND-40.1"))!.aliases).toEqual(["LAND-17.9", "LAND-20.2", "LAND-40.1"]);
    expect(p.items.find((i) => i.ref === "DRAFT-1")).toMatchObject({ kind: "backlog", status: "Draft", parent_hint: "LAND-40", aliases: ["LAND-18.1"] });
    expect(p.items.some((i) => i.title === "LAND-17.9 title")).toBe(false);
    expect(report.problems).toEqual(["LAND-41 says it was LAND-40, but LAND-40 is still on the board (tasks); both kept, not linked"]);
  });

  it("makes a top-level item that holds tasks a feature, puts a task under a task under its feature, and reports what differs", () => {
    const { doc, report } = backlogToExport(
      helix,
      backlog([
        ...milestones,
        ["tasks", task("LAND-17", { type: "chore", milestone: "m-1" })],
        ["tasks", task("LAND-17.1", { type: "task", parent_task_id: "LAND-17", milestone: "m-3" })],
        ["tasks", task("LAND-17.1.1", { parent_task_id: "LAND-17.1" })],
        ["tasks", task("LAND-60", { type: "bug", status: "Blocked" })],
        ["tasks", "---\nid: LAND-61\ntitle: 'it's broken'\n---\n"],
      ]),
      now,
    );
    const p = doc.projects[0]!;
    expect(p.items.find((i) => i.ref === "LAND-17")).toMatchObject({ kind: "feature", type: "increment", release: "R0" });
    expect(p.items.filter((i) => i.parent === "LAND-17").map((i) => i.aliases[0])).toEqual(["LAND-17.1", "LAND-17.1.1"]);
    expect(p.items.find((i) => i.ref === "LAND-60")).toMatchObject({ kind: "backlog", type: "bug", status: "Draft" });
    expect(report.notes).toContain("LAND-17: type chore, but it holds tasks; imported as a feature (type increment)");
    expect(report.problems).toEqual([
      "product/backlog/tasks/f7.md: its front matter isn't valid YAML with an id; not imported",
      'LAND-60: status "Blocked" isn\'t one of Draft, Ready, In Progress, In Review, Done; imported as Draft',
      // LAND-61's file didn't read, and its number is still never given again.
      "LAND-17.1 (LAND-62): milestone m-3 differs from its feature LAND-17's m-1; the task follows its feature",
    ]);
  });

  it("appends an item's references to its notes as a References list, after its final summary (BOB-14 #6)", () => {
    const section = (name: string, text: string) => `<!-- SECTION:${name}:BEGIN -->\n${text}\n<!-- SECTION:${name}:END -->\n`;
    const { doc, report } = backlogToExport(
      helix,
      backlog([
        ["tasks", task("LAND-1", { references: ["product/requirements/migration.md", "https://example.com/adr", "product/requirements/migration.md"] }, section("NOTES", "Kept as written.") + section("FINAL_SUMMARY", "Shipped."))],
        ["tasks", task("LAND-2", { references: ["architecture/decisions/0001-board-service.md"] })],
        ["tasks", task("LAND-3", {}, section("NOTES", "Only notes."))],
        ["tasks", task("LAND-4")],
      ]),
      now,
    );
    expect(doc.projects[0]!.items.map((i) => i.notes)).toEqual([
      "Kept as written.\n\nFinal summary:\nShipped.\n\nReferences:\n- product/requirements/migration.md\n- https://example.com/adr",
      "References:\n- architecture/decisions/0001-board-service.md",
      "Only notes.",
      null,
    ]);
    expect(report.counts["references appended to notes"]).toBe(2);
  });

  it("opens a feature In Progress with an imported session", () => {
    const { doc } = backlogToExport(helix, backlog([["tasks", task("LAND-49", { type: "increment", status: "In Progress" })]]), now);
    const p = doc.projects[0]!;
    expect(p.items[0]).toMatchObject({ open_since: "2026-11-02T11:30:00.000Z" });
    expect(p.sessions).toMatchObject([{ feature: "LAND-49", kind: "build", label: "imported", imported: true, ended_at: null }]);
  });

  it("refuses Q or A as the project's prefix, and an id that reads as a question's", () => {
    expect(() => backlogToExport({ ...helix, prefix: "Q" }, backlog([]), now)).toThrow(/questions' and actions'/);
    expect(() => backlogToExport({ ...helix, draft_prefix: "A" }, backlog([]), now)).toThrow(/questions' and actions'/);
    expect(backlogToExport(helix, backlog([["tasks", task("Q-3")]]), now).report.problems).toEqual(["Q-3: reads as a question's or action's id; not imported"]);
  });

  it("reads questions.md: open rows, answered questions verbatim from its paragraph, actions, and the next ids", () => {
    const text = [
      "The next ID is **Q-267**. Last given: Q-266 (Casper, 2026-11-14, in session: \"Accepted\" (as drawn)). Before it, Q-261 (open). Q-258 (Casper, 2026-11-13, LAND-49 fixes review: no manual step; LAND-49.19).",
      "",
      "| ID | From | Question | Context | Recommendation | Blocking? |",
      "|---|---|---|---|---|---|",
      "| Q-261 | Bill (R1 close) | May a CLAUDE.md drop its copy? | The first audit | Yes | No |",
      "",
      "The next ID is **A-22**.",
      "| A-17 | Try claude.ai on Marvin's cut | Your own Claude | LAND-31.3 |",
    ].join("\n");
    const q = readQuestions(text, now.toISOString());
    expect(q.next).toEqual({ question: 267, action: 22 });
    expect(q.questions.map((x) => [x.ref, x.state])).toEqual([
      ["Q-258", "answered"],
      ["Q-261", "open"],
      ["Q-266", "answered"],
      ["A-17", "open"],
    ]);
    expect(q.questions[0]).toMatchObject({ answer_words: "Casper, 2026-11-13, LAND-49 fixes review: no manual step; LAND-49.19", answered_by: "Casper", answered_at: "2026-11-13T00:00:00.000Z" });
    expect(q.questions[2]!.answer_words).toBe('Casper, 2026-11-14, in session: "Accepted" (as drawn)');
    expect(q.questions[1]).toMatchObject({ text: "May a CLAUDE.md drop its copy?", asked_by: "Bill (R1 close)", context: "The first audit\n\nRecommendation: Yes\n\nBlocking: No" });
    expect(q.questions[3]).toMatchObject({ kind: "action", text: "Try claude.ai on Marvin's cut", context: "Where: Your own Claude\n\nFor: LAND-31.3" });
  });

  it("reads the backlog through git at the named commit, never the worktree", async () => {
    const { dir, sha } = repo({
      "product/backlog/tasks/land-1 - §-odd name.md": task("LAND-1", { type: "increment" }),
      "lead/questions.md": "The next ID is **Q-5**.\n",
    });
    writeFileSync(join(dir, "product/backlog/tasks/land-2.md"), task("LAND-2"));
    const read = await readBacklogAt(dir, "HEAD", "product/backlog", "lead/questions.md");
    expect(read).toMatchObject({ sha, questions: "The next ID is **Q-5**.\n" });
    expect(read.files.map((f) => [f.folder, f.path])).toEqual([["tasks", "product/backlog/tasks/land-1 - §-odd name.md"]]);
  });

  describe("seeding the project's rules (BOB-14 #7)", () => {
    const rule = (project: string, agent: string, laptop: string, extra: Partial<ImportGrant> = {}): ImportGrant => ({
      project,
      agent,
      laptop,
      role: "PO",
      read: true,
      items: "all",
      fields: ["status", "content"],
      sessions: false,
      questions: true,
      admin: false,
      ...extra,
    });
    const peach = rule("helix", "Peach", "*");
    const mario = rule("*", "Mario", "mbp-1", { role: "backup", items: "none", fields: [], questions: false });

    it("puts the project's rows in the project and a '*' row in the document, and lists them in the report", () => {
      const { doc, report } = backlogToExport(helix, backlog([]), now, [mario, rule("helix", "Bill", "mbp-2", { role: "builder", items: "open_feature" }), peach]);
      const { project: _p, ...marioRow } = mario;
      expect(BoardExportV1.parse(doc).grants).toEqual([marioRow]);
      expect(doc.projects[0]!.grants.map((g) => g.agent)).toEqual(["Bill", "Peach"]);
      expect(report.grants).toEqual([
        "Bill@mbp-2 on helix, builder: items open_feature; fields status, content; read, questions",
        "Peach@* on helix, PO: items all; fields status, content; read, questions",
        "Mario@mbp-1 on every project ('*'), backup: items none; fields none; read",
      ]);
      expect(backlogToExport(helix, backlog([]), now).doc.grants).toEqual([]);
    });

    it("refuses a rule for another project, or two rules for one agent", () => {
      expect(() => backlogToExport(helix, backlog([]), now, [rule("bobnet", "Peach", "*")])).toThrow("The rule for Peach@* is for project bobnet, not helix");
      expect(() => backlogToExport(helix, backlog([]), now, [peach, { ...peach, agent: "peach" }])).toThrow("Two rules for peach@* on helix");
      expect(() => backlogToExport(helix, backlog([]), now, [mario, rule("helix", "Mario", "mbp-1")])).not.toThrow();
    });

    it("reads a --grants file with the protocol's schema, saying what's wrong", () => {
      expect(readGrants(JSON.stringify([peach, mario]))).toEqual([peach, mario]);
      expect(() => readGrants("[")).toThrow(/isn't JSON/);
      expect(() => readGrants(JSON.stringify([{ ...peach, items: "some" }]))).toThrow(/^0\.items: /);
      expect(() => readGrants(JSON.stringify([{ ...peach, project: "Helix" }]))).toThrow(/^0\.project: /);
      expect(() => readGrants(JSON.stringify([{ ...peach, extra: 1 }]))).toThrow(/extra/);
      expect(() => readGrants(JSON.stringify({ rules: [] }))).toThrow(/the file: /);
    });
  });

  describe("the command's --post", () => {
    const run = async (answer: ImportPosted, extra: string[] = []) => {
      const { dir } = repo({ "product/backlog/tasks/bob-1.md": task("BOB-1", { type: "increment" }) });
      const errors: string[] = [];
      const err = vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));
      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const posted: BoardExportV1[] = [];
      try {
        const code = await importBacklogCommand(
          ["--repo", dir, "--ref", "HEAD", "--project", "bobnet", "--name", "BobNet", "--prefix", "BOB", "--post", ...extra],
          () => async (doc) => (posted.push(doc), answer),
        );
        return { code, errors, posted };
      } finally {
        err.mockRestore();
        out.mockRestore();
        write.mockRestore();
      }
    };

    it("exits 0 only when the broker took the import", async () => {
      expect((await run({ status: 200, reply: { ok: true, projects: [{ key: "bobnet", items: 1, events: 1, next_item: 2 }] } })).code).toBe(0);
    });

    it("exits 1 and says why when the broker refuses it", async () => {
      const refused = await run({ status: 403, reply: { ok: false, code: "forbidden", message: "rules for every project come from a laptop only into an empty board" } });
      expect(refused.code).toBe(1);
      expect(refused.errors).toEqual(["Not imported: the broker answered 403, forbidden: rules for every project come from a laptop only into an empty board"]);
      expect((await run({ status: 409, reply: { ok: false, code: "conflict", message: "bobnet exists" } })).code).toBe(1);
      const unreadable = await run({ status: 502, reply: null });
      expect(unreadable.code).toBe(1);
      expect(unreadable.errors).toEqual(["Not imported: the broker answered 502, no reply it could read"]);
      // A 2xx whose reply isn't ok isn't taken either.
      expect((await run({ status: 200, reply: { ok: false, code: "invalid", message: "x" } })).code).toBe(1);
    });

    it("takes --lead and --po only as name@laptop (BOB-5 review, finding 1)", async () => {
      const taken = { status: 200, reply: { ok: true as const, projects: [] } };
      const bare = await run(taken, ["--lead", "Mario"]);
      expect(bare).toMatchObject({ code: 2, errors: ["--lead Mario is not name@laptop"], posted: [] });
      expect((await run(taken, ["--po", "Peach@board"])).errors).toEqual(["--po Peach@board is not name@laptop"]);
      const good = await run(taken, ["--lead", "Mario@mbp-1", "--po", "Peach@mbp-1"]);
      expect(good.code).toBe(0);
      expect(good.posted[0]!.projects[0]).toMatchObject({ lead: "Mario@mbp-1", po: "Peach@mbp-1" });
    });

    it("seeds the rules in --grants, and says before posting that a '*' row needs an empty board", async () => {
      const file = join(mkdtempSync(join(tmpdir(), "grants-")), "grants.json");
      const peach = { project: "bobnet", agent: "Peach", laptop: "mbp-1", role: "PO", read: true, items: "all", fields: ["status"], sessions: false, questions: true, admin: false };
      writeFileSync(file, JSON.stringify([peach]));
      const own = await run({ status: 200, reply: { ok: true, projects: [] } }, ["--grants", file]);
      expect(own).toMatchObject({ code: 0, errors: [] });
      expect(own.posted[0]!.projects[0]!.grants).toMatchObject([{ agent: "Peach", laptop: "mbp-1" }]);

      writeFileSync(file, JSON.stringify([peach, { ...peach, project: "*", agent: "Mario", role: "backup", items: "none", fields: [], questions: false }]));
      const every = await run({ status: 403, reply: { ok: false, code: "forbidden", message: "not an empty board" } }, ["--grants", file]);
      expect(every.code).toBe(1);
      expect(every.errors).toEqual([EVERY_PROJECT_WARNING, "Not imported: the broker answered 403, forbidden: not an empty board"]);
      expect(every.posted[0]!.grants).toMatchObject([{ agent: "Mario", laptop: "mbp-1", read: true }]);

      writeFileSync(file, "[{}]");
      const broken = await run({ status: 200, reply: { ok: true, projects: [] } }, ["--grants", file]);
      expect(broken.code).toBe(2);
      expect(broken.errors[0]).toMatch(/^--grants .*grants\.json: 0\.agent: /);
      expect(broken.posted).toEqual([]);
    });
  });
});
