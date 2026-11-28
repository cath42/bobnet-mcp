/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOARD_READS,
  BoardOp,
  LARGE_BOARD_OPS,
  LIBRARY_BLOB_MAX,
  LIBRARY_CARDS_MAX,
  LIBRARY_STANDARD,
  SUPERVISOR_OPS,
  checkLibrary,
  gitBlobId,
  glossaryProblems,
  librarySectionOf,
  readFrontMatter,
  type LibraryEntry,
} from "../src/index.ts";

// The standard's sample, Toolshed (ADR 0017): every section written, 0 problems.
const SAMPLE = fileURLToPath(new URL("../../../architecture/spikes/bob212/sample/", import.meta.url));

function sample(): LibraryEntry[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n: string) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  return walk(join(SAMPLE, "library")).map((full) => {
    const text = readFileSync(full, "utf8");
    return { path: relative(SAMPLE, full), bytes: Buffer.byteLength(text), text };
  });
}

/** The sample with one file's text changed, added or dropped: the broken copies. */
function edit(entries: LibraryEntry[], path: string, text: string | null): LibraryEntry[] {
  const rest = entries.filter((e) => e.path !== path);
  return text === null ? rest : [...rest, { path, bytes: Buffer.byteLength(text), text }];
}
const textOf = (entries: LibraryEntry[], path: string) => entries.find((e) => e.path === path)!.text!;

describe("LIBRARY_STANDARD", () => {
  it("has the seven sections in the standard's order, each with its owner", () => {
    expect(LIBRARY_STANDARD.sections.map((s) => s.id)).toEqual(["overview", "architecture", "data", "decisions", "usecases", "ux", "glossary"]);
    expect(LIBRARY_STANDARD.sections.map((s) => s.owner)).toEqual(["product-owner", "architect", "architect", "architect", "product-owner", "designer", "product-owner"]);
  });

  it("puts each path in its section, an image nowhere, and anything else outside the standard", () => {
    expect(librarySectionOf("library/overview.md")).toBe("overview");
    expect(librarySectionOf("library/architecture/model.c4")).toBe("architecture");
    expect(librarySectionOf("library/architecture/sub/model.c4")).toBeNull();
    expect(librarySectionOf("library/data-model.dbml")).toBe("data");
    expect(librarySectionOf("library/decisions/0003-push-reminders.md")).toBe("decisions");
    expect(librarySectionOf("library/usecases/0001-reserve-a-tool.md")).toBe("usecases");
    expect(librarySectionOf("library/ux/0002-counter-screen.md")).toBe("ux");
    expect(librarySectionOf("library/ux/images/0002-counter.png")).toBe("image");
    expect(librarySectionOf("library/glossary.md")).toBe("glossary");
    for (const no of ["library/decisions/3-push.md", "library/decisions/0003_Push.md", "library/decisions/0000-x.md", "library/notes/ideas.md", "library/README.md"]) {
      expect(librarySectionOf(no)).toBeNull();
    }
  });
});

describe("readFrontMatter", () => {
  it("reads plain, quoted and list values as strings, and the # title", () => {
    const fm = readFrontMatter('---\nstatus: approved\nverdict: "Yes: ship it"\nuse-cases: [0001, 0002]\ndate: 2026-03-09\n---\n# Catalogue\n\n## Purpose\n', "ux");
    expect(fm.head).toEqual({ status: "approved", verdict: "Yes: ship it", "use-cases": "[0001, 0002]", date: "2026-03-09" });
    expect(fm.title).toBe("Catalogue");
  });

  it("reads a file without front matter, and checks nothing without a section", () => {
    expect(readFrontMatter("# Glossary\n\n## Hold\n")).toEqual({ head: {}, title: "Glossary", problems: [] });
  });

  it("finds each kind of problem by its line: a value outside its list, a missing or unknown key, a heading missing or out of order", () => {
    const text = [
      "---", // 1
      "status: decided", // 2
      "owner: Otto", // 3
      "supersedes: 0002", // 4
      "---",
      "# Photos in object storage", // 6
      "",
      "## Context", // 8
      "",
      "## Consequences", // 10
      "",
      "## Decision", // 12
      "",
      "```md",
      "## Options",
      "```",
    ].join("\n");
    const { problems } = readFrontMatter(text, "decisions");
    expect(problems).toEqual([
      { line: 1, message: "date is missing: a decision needs it" },
      { line: 2, message: 'status is "decided": it is one of proposed, accepted, rejected, deprecated or superseded' },
      { line: 3, message: "owner isn't one of the standard's keys: status, date, decision-makers, supersedes, feature" },
      { line: 4, message: 'supersedes is "0002": it is a list of card numbers, [0001, 0002]' },
      { line: 12, message: "the heading Decision is out of order: Context, Options, Decision, Consequences, in that order" },
      { line: 12, message: "the heading Options is missing: Context, Options, Decision, Consequences, in that order" },
    ]);
  });

  it("names a card without front matter, a nested value and a verdict not in quotes", () => {
    expect(readFrontMatter("# Reserve\n\n## Goal\n", "usecases").problems[0]).toEqual({ line: 1, message: "it has no front matter: --- lines around key: value lines, at the top" });
    const ux = readFrontMatter("---\nstatus: approved\ndate: 2026-03-09\nverdict: Yes, this\n  nested: x\n---\n# A\n## Purpose\n## Screens\n## States\n## Open questions\n", "ux");
    expect(ux.problems).toEqual([
      { line: 4, message: 'verdict is someone\'s words: put them in "quotes"' },
      { line: 5, message: "not a key: value line: a value is one line, nothing nested" },
    ]);
  });
});

describe("glossaryProblems", () => {
  it("finds a term out of alphabetical order, case aside", () => {
    expect(glossaryProblems("# Glossary\n\n## hold\n\n## Loan\n\n## Deposit\n")).toEqual([{ line: 7, message: "Deposit is out of alphabetical order: it comes after Loan" }]);
  });
});

describe("checkLibrary", () => {
  it("indexes the sample, Toolshed, with 0 problems: every section, the titles and the heads", () => {
    const { files, problems } = checkLibrary(sample());
    expect(problems).toEqual([]);
    const by = (s: string) => files.filter((f) => f.section === s).map((f) => f.path.replace(/^library\//, ""));
    expect(by("overview")).toEqual(["overview.md"]);
    expect(by("architecture")).toEqual(["architecture/model.c4", "architecture/spec.c4", "architecture/views.c4"]);
    expect(by("data")).toEqual(["data-model.dbml"]);
    expect(by("decisions")).toHaveLength(3);
    expect(by("usecases")).toHaveLength(3);
    expect(by("ux")).toHaveLength(2);
    expect(by("glossary")).toEqual(["glossary.md"]);
    const overview = files.find((f) => f.section === "overview")!;
    expect(overview.head).toMatchObject({ title: "Toolshed", "product-owner": "Wren", architect: "Otto", designer: "Ines" });
    const adr3 = files.find((f) => f.path.startsWith("library/decisions/0003"))!;
    expect(adr3).toMatchObject({ title: "Reminders go by push, with email as the fallback", head: { status: "accepted", supersedes: "[0002]" } });
    // Only the overview and the cards carry a head; the glossary a title; the model neither.
    expect(files.find((f) => f.section === "glossary")).toMatchObject({ title: "Glossary" });
    expect(files.find((f) => f.section === "glossary")!.head).toBeUndefined();
    expect(files.find((f) => f.section === "data")!.title).toBeUndefined();
  });

  it("lists each kind of problem in a broken copy of the sample, and still shows what it can", () => {
    let lib = sample();
    const adr = "library/decisions/0001-reservations-hold-for-24-hours.md";
    lib = edit(lib, adr, textOf(lib, adr).replace("status: accepted", "status: decided").replace("## Options", "## Choices"));
    lib = edit(lib, "library/decisions/0001-twice.md", "---\nstatus: proposed\ndate: 2026-01-01\n---\n# Twice\n## Context\n## Options\n## Decision\n## Consequences\n");
    lib = edit(lib, "library/decisions/4-photos.md", "# Photos\n");
    lib = edit(lib, "library/notes/counter-ideas.md", "# Ideas\n");
    lib = edit(lib, "library/ux/images/0001-catalogue.png", "PNG");
    const gl = "library/glossary.md";
    lib = edit(lib, gl, `${textOf(lib, gl)}\n## Apron\n\nWhat a member wears.\n`);
    lib = edit(lib, "library/overview.md", textOf(lib, "library/overview.md").replace("tagline:", "slogan:"));

    const { files, problems } = checkLibrary(lib);
    const at = (path: string) => problems.filter((p) => p.kind === "standard" && p.path === path).map((p) => p.kind === "standard" && `${p.line ?? "-"} ${p.message}`);
    expect(at(adr)).toEqual([
      '2 status is "decided": it is one of proposed, accepted, rejected, deprecated or superseded',
      expect.stringMatching(/^\d+ the heading Options is missing: Context, Options, Decision, Consequences, in that order$/),
    ]);
    expect(at("library/decisions/0001-twice.md")).toEqual(["- its number is 0001-reservations-hold-for-24-hours.md's too: a card's number is used once"]);
    expect(at("library/decisions/4-photos.md")).toEqual(["- a card's name is NNNN-slug.md, four digits and lowercase words, so it isn't shown"]);
    expect(at("library/notes/counter-ideas.md")).toEqual(["- the standard doesn't name this file, so it isn't shown"]);
    expect(at(gl)).toEqual([expect.stringMatching(/^\d+ Apron is out of alphabetical order: it comes after /)]);
    expect(at("library/overview.md")).toEqual(["3 slogan isn't one of the standard's keys: title, tagline, product-owner, architect, designer"]);
    // An image is neither shown nor a problem; the stray and misnamed files aren't shown; the broken card still is.
    expect(files.map((f) => f.path)).not.toContain("library/ux/images/0001-catalogue.png");
    expect(files.map((f) => f.path)).not.toContain("library/notes/counter-ideas.md");
    expect(files.find((f) => f.path === adr)).toMatchObject({ section: "decisions", head: { status: "decided" } });
  });

  it("marks a file over 512 KB and a model over its limits too large, and shows no more than 200 cards", () => {
    let lib = sample();
    lib = edit(lib, "library/data-model.dbml", null).concat({ path: "library/data-model.dbml", bytes: LIBRARY_BLOB_MAX + 1 });
    for (let i = 0; i < 64; i++) lib.push({ path: `library/architecture/extra${String(i).padStart(2, "0")}.c4`, bytes: 10 });
    for (let i = 4; i < 4 + LIBRARY_CARDS_MAX; i++) lib.push({ path: `library/decisions/${String(i).padStart(4, "0")}-more.md`, bytes: 10 });
    const { files, problems } = checkLibrary(lib);
    expect(files.find((f) => f.section === "data")).toMatchObject({ too_large: true });
    expect(files.filter((f) => f.section === "architecture").every((f) => f.too_large)).toBe(true);
    expect(files.filter((f) => ["decisions", "usecases", "ux"].includes(f.section))).toHaveLength(LIBRARY_CARDS_MAX);
    const large = problems.filter((p) => p.kind === "too_large").map((p) => p.kind === "too_large" && p.path);
    expect(large).toContain("library/data-model.dbml");
    expect(large).toContain("library/architecture/");
    expect(large.filter((p) => p && /^library\/(decisions|usecases|ux)\//.test(p))).toHaveLength(8);
  });
});

describe("gitBlobId", () => {
  it("is git's own id of a blob", async () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(await gitBlobId("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(await gitBlobId("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("the library's ops", () => {
  const commit = "a".repeat(40);
  const index = { standard: 1, files: [{ path: "library/overview.md", section: "overview", blob: "b".repeat(40), bytes: 10, changed: { sha: "1c83f2b", date: "2026-11-26T21:34:00+01:00" }, title: "Toolshed", head: { title: "Toolshed" } }] };

  it("parses a sync with its index, and one without library/", () => {
    const op = BoardOp.parse({ op: "library_sync", project: "toolshed", ref: "origin/main", commit, committed_at: "2026-11-26T21:34:00+01:00", github: "https://github.com/cath42/toolshed", index });
    expect(op).toMatchObject({ op: "library_sync", problems: [] });
    expect(BoardOp.safeParse({ op: "library_sync", project: "toolshed", ref: "origin/main", commit, committed_at: "2026-11-26T21:34:00Z", github: null, index: null }).success).toBe(true);
  });

  it("refuses a path outside library/, a section that isn't one, and a short blob id", () => {
    const bad = (f: object) => ({ ...index, files: [{ ...index.files[0], ...f }] });
    for (const f of [{ path: "docs/overview.md" }, { section: "notes" }, { blob: "abc" }]) {
      expect(BoardOp.safeParse({ op: "library_sync", project: "toolshed", ref: "origin/main", commit, committed_at: "2026-11-26T21:34:00Z", github: null, index: bad(f) }).success).toBe(false);
    }
    expect(BoardOp.safeParse({ op: "library_blob", project: "toolshed", blob: "b".repeat(40), text: "x".repeat(LIBRARY_BLOB_MAX + 1) }).success).toBe(false);
  });

  it("makes library and library_page reads, and the blob and sync the supervisor's, in large frames", () => {
    expect(BOARD_READS).toEqual(expect.arrayContaining(["library", "library_page"]));
    expect(SUPERVISOR_OPS).toEqual(expect.arrayContaining(["library_blob", "library_sync"]));
    expect(LARGE_BOARD_OPS).toEqual(["library_blob", "library_sync"]);
    expect(BoardOp.parse({ op: "library_page", project: "toolshed", section: "decisions", path: "library/decisions/0003-x.md" })).toMatchObject({ section: "decisions" });
    expect(BoardOp.safeParse({ op: "library_page", project: "toolshed", section: "notes" }).success).toBe(false);
  });
});
