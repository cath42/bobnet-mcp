import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BoardOp, gitBlobId, LIBRARY_C4_FILES_MAX, LIBRARY_CARDS_MAX, LIBRARY_FILES_MAX, LIMITS, type BoardOpInput, type BoardResults } from "@bobnet/protocol";
import type { Logger } from "@bobnet/client/log";
import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.ts";
import { githubOf, LIBRARY_FIT_BYTES, LIBRARY_HEARTBEAT_MS, LibrarySync, readLibrary, type LibrarySend } from "../src/library-sync.ts";
import type { Exec } from "../src/board.ts";
import { quiet } from "./fakes.ts";

// The library sync (ADR 0015 §1, 0017 §4) against `git init` fixtures: an origin made from the standard's sample,
// Toolshed, a project clone of it that the sync reads, and a working copy that pushes changes to the origin's main.

const SAMPLE = fileURLToPath(new URL("../../../architecture/spikes/bob212/sample/", import.meta.url));

interface Fixture {
  project: ProjectConfig;
  /** Commits in the working copy and pushes to the origin's main. */
  push(files: Record<string, string | Buffer | null>, message?: string): string;
  /** git in the project's clone. */
  clone(...args: string[]): string;
}

function fixture(withLibrary = true): Fixture {
  const root = mkdtempSync(join(tmpdir(), "bobnet-library-"));
  const work = join(root, "work"), origin = join(root, "origin.git"), clone = join(root, "clone");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_COMMITTER_DATE: "", GIT_AUTHOR_DATE: "" } });
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.email", "otto@toolshed.example");
  git(work, "config", "user.name", "Otto");
  if (withLibrary) cpSync(join(SAMPLE, "library"), join(work, "library"), { recursive: true });
  writeFileSync(join(work, "README.md"), "# Toolshed\n");
  mkdirSync(join(work, "docs"));
  writeFileSync(join(work, "docs", "old.md"), "# Old docs, outside library/: never read\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "Toolshed's library");
  git(root, "clone", "-q", "--bare", work, origin);
  git(work, "remote", "add", "origin", origin);
  git(work, "fetch", "-q", "origin");
  git(root, "clone", "-q", origin, clone);
  const project = { key: "toolshed", path: clone, rebase: undefined, board: "service" } as unknown as ProjectConfig;
  return {
    project,
    push(files, message = "change") {
      const added: string[] = [];
      for (const [path, text] of Object.entries(files)) {
        if (text === null) git(work, "rm", "-q", path);
        else {
          mkdirSync(join(work, path, ".."), { recursive: true });
          writeFileSync(join(work, path), text);
          added.push(path);
        }
      }
      if (added.length > 0) git(work, "add", "--", ...added);
      git(work, "commit", "-q", "-m", message);
      git(work, "push", "-q", "origin", "main");
      return git(work, "rev-parse", "HEAD").trim();
    },
    clone: (...args) => git(clone, ...args).trim(),
  };
}

/** A Board as far as the library goes (ADR 0015 §2): blobs by git's id, checked; a sync kept once it has every blob. */
function fakeBoard() {
  const blobs = new Map<string, string>();
  const ops: Array<BoardOpInput & { op: "library_blob" | "library_sync" }> = [];
  let kept: (BoardOpInput & { op: "library_sync" }) | null = null;
  const send = (async (op: BoardOpInput & { op: "library_blob" | "library_sync" }) => {
    ops.push(op);
    if (op.op === "library_blob") {
      if ((await gitBlobId(op.text)) !== op.blob) throw Object.assign(new Error("not its blob"), { code: "invalid" });
      const stored = !blobs.has(op.blob);
      blobs.set(op.blob, op.text);
      return { ref: null, seq: 1, stored } satisfies BoardResults["library_blob"];
    }
    const missing = (op.index?.files ?? []).filter((f) => !f.too_large && !blobs.has(f.blob)).map((f) => f.blob);
    if (missing.length === 0) kept = op;
    return { ref: null, seq: 1, stored: missing.length === 0, missing } satisfies BoardResults["library_sync"];
  }) as LibrarySend;
  return { blobs, ops, send, kept: () => kept, drop: () => blobs.clear() };
}

const syncs = (ops: Array<{ op: string }>) => ops.filter((o) => o.op === "library_sync").length;
const blobsSent = (ops: Array<{ op: string }>) => ops.filter((o) => o.op === "library_blob").length;

describe("readLibrary (ADR 0015 §1, 0017 §4)", () => {
  it("reads the sample from the clone's origin/main: the standard's files with their blobs, titles, heads and last changes, 0 problems", async () => {
    const f = fixture();
    const { op, texts } = await readLibrary(f.project, { fetch: true });
    expect(op).toMatchObject({ op: "library_sync", project: "toolshed", ref: "origin/main", commit: f.clone("rev-parse", "origin/main"), github: null, problems: [] });
    expect(op.committed_at).toBe(f.clone("log", "-1", "--format=%cI", "origin/main"));
    const files = op.index!.files;
    expect(files).toHaveLength(14);
    expect(files.map((x) => x.path)).not.toContain("docs/old.md");
    const overview = files.find((x) => x.section === "overview")!;
    expect(overview).toMatchObject({ title: "Toolshed", head: { title: "Toolshed", architect: "Otto" }, changed: { sha: f.clone("rev-parse", "--short", "HEAD") } });
    expect(overview.blob).toBe(f.clone("rev-parse", "origin/main:library/overview.md"));
    expect(overview.bytes).toBe(readFileSync(join(SAMPLE, "library/overview.md")).byteLength);
    // Every blob it would send is git's own id for its text.
    expect(texts.size).toBe(14);
    for (const [blob, text] of texts) expect(await gitBlobId(text)).toBe(blob);
  });

  it("answers index null for a repo with no library/", async () => {
    const f = fixture(false);
    const { op, texts } = await readLibrary(f.project, { fetch: true });
    expect(op).toMatchObject({ index: null, problems: [], commit: f.clone("rev-parse", "origin/main") });
    expect(texts.size).toBe(0);
  });

  it("lists what breaks the standard, never failing, and reads nothing outside library/", async () => {
    const f = fixture();
    const adr = "library/decisions/0001-reservations-hold-for-24-hours.md";
    f.push({
      [adr]: readFileSync(join(SAMPLE, adr), "utf8").replace("status: accepted", "status: decided"),
      "library/notes/counter-ideas.md": "# Ideas\n",
      "library/ux/images/0001-catalogue.png": "\x89PNG",
      "library/decisions/0009-latin.md": Buffer.from("---\nstatus: draft\n---\n# Caf\xe9\n", "latin1"),
    });
    const { op } = await readLibrary(f.project, { fetch: true });
    expect(op.problems).toEqual(
      expect.arrayContaining([
        { kind: "standard", path: adr, line: 2, message: 'status is "decided": it is one of proposed, accepted, rejected, deprecated or superseded' },
        { kind: "standard", path: "library/notes/counter-ideas.md", message: "the standard doesn't name this file, so it isn't shown" },
        { kind: "standard", path: "library/decisions/0009-latin.md", message: "it isn't UTF-8 text, so it isn't shown" },
      ]),
    );
    expect(op.problems).toHaveLength(3);
    expect(op.index!.files.find((x) => x.path === adr)).toMatchObject({ head: { status: "decided" } });
  });

  it("reads the last commit it has when the fetch fails, with the failure as a problem", async () => {
    const f = fixture();
    const before = f.clone("rev-parse", "origin/main");
    f.clone("remote", "set-url", "origin", "/nonexistent/toolshed.git");
    const { op } = await readLibrary(f.project, { fetch: true, now: () => new Date("2026-11-27T10:00:00Z") });
    expect(op.commit).toBe(before);
    expect(op.problems![0]).toMatchObject({ kind: "fetch_failed", at: "2026-11-27T10:00:00.000Z", message: expect.stringMatching(/^git fetch origin main: /) });
  });

  it("fits a worst-case index into a frame: the cards' long values left out, with one problem on library/ (review A 4)", async () => {
    const f = fixture();
    // 267 files: 200 UX cards with a 300-character title and every key at 1,000 characters, 64 .c4 files with long
    // names, and the overview; every card's values break their rules, so it has 200 problems too.
    const files: Record<string, string> = {};
    const long = (c: string) => c.repeat(1000);
    for (let i = 1; i <= LIBRARY_CARDS_MAX; i++) {
      const n = String(i).padStart(4, "0");
      const head = ["status", "date", "feature", "use-cases", "prototype", "verdict", "verdict-date"].map((k, j) => `${k}: ${long("abcdefg"[j]!)}`);
      files[`library/ux/${n}-${"card".repeat(40)}.md`] = `---\n${head.join("\n")}\n---\n\n# ${"T".repeat(300)}\n`;
    }
    for (let i = 0; i < LIBRARY_C4_FILES_MAX - 3; i++) files[`library/architecture/${String(i).padStart(2, "0")}-${"view".repeat(50)}.c4`] = "model {}\n";
    f.push(files, "a worst-case library");
    const read = await readLibrary(f.project, { fetch: true });
    expect(read.op.index!.files).toHaveLength(LIBRARY_FILES_MAX);
    const frame = JSON.stringify({ t: "board_op", id: "x".repeat(36), as: "supervisor", key: "k".repeat(36), op: read.op });
    expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(LIMITS.boardFrameBytes);
    expect(Buffer.byteLength(JSON.stringify(read.op))).toBeLessThanOrEqual(LIBRARY_FIT_BYTES);
    // The broker takes it as it is sent.
    expect(BoardOp.safeParse(read.op).success).toBe(true);
    expect(read.op.problems![0]).toMatchObject({ kind: "too_large", path: "library/", message: expect.stringMatching(/over the 899 KB/) });
    expect(read.op.problems!.filter((p) => p.kind === "too_large" && p.path === "library/")).toHaveLength(1);
    // The overview keeps its head; a card keeps its title and loses the long values.
    expect(read.op.index!.files.find((x) => x.section === "overview")!.head).toMatchObject({ title: "Toolshed" });
    const card = read.op.index!.files.find((x) => x.path.startsWith("library/ux/0001-"))!;
    expect(card.title).toBe("T".repeat(300));
    expect(Object.values(card.head ?? {}).every((v) => v.length <= 200)).toBe(true);
    // The sample, well under it, is sent whole, with no such problem.
    const small = await readLibrary(fixture().project, { fetch: true });
    expect(small.op.problems).toEqual([]);
  }, 30_000);

  it("links GitHub only for a GitHub remote", () => {
    expect(githubOf("git@github.com:cath42/toolshed.git")).toBe("https://github.com/cath42/toolshed");
    expect(githubOf("https://github.com/cath42/toolshed")).toBe("https://github.com/cath42/toolshed");
    expect(githubOf("/srv/git/toolshed.git")).toBeNull();
    expect(githubOf("https://gitlab.com/cath42/toolshed.git")).toBeNull();
  });
});

describe("LibrarySync (ADR 0015 §1)", () => {
  it("sends every blob, then the index; a change pushed to main shows at the next sync, with only its new blob", async () => {
    const f = fixture();
    const board = fakeBoard();
    const sync = new LibrarySync({ log: quiet, send: board.send });
    await sync.sync(f.project);
    expect(blobsSent(board.ops)).toBe(14);
    expect(syncs(board.ops)).toBe(1);
    expect(board.kept()!.commit).toBe(f.clone("rev-parse", "origin/main"));

    const gloss = "library/glossary.md";
    const commit = f.push({ [gloss]: `${readFileSync(join(SAMPLE, gloss), "utf8")}\n## Zone\n\nA shed's area.\n` }, "Zone");
    board.ops.length = 0;
    await sync.sync(f.project);
    expect(board.ops.map((o) => o.op)).toEqual(["library_blob", "library_sync"]);
    expect(board.kept()).toMatchObject({ commit, problems: [] });
    expect(board.blobs.get(board.kept()!.index!.files.find((x) => x.path === gloss)!.blob)).toContain("## Zone");
    expect(board.kept()!.index!.files.find((x) => x.path === gloss)!.changed.sha).toBe(commit.slice(0, 7));
  });

  it("sends an unchanged library again only as the hourly heartbeat, alone", async () => {
    const f = fixture();
    const board = fakeBoard();
    let now = Date.parse("2026-11-27T10:00:00Z");
    const sync = new LibrarySync({ log: quiet, send: board.send, now: () => now });
    await sync.sync(f.project);
    board.ops.length = 0;
    now += 10 * 60_000;
    await sync.sync(f.project);
    expect(board.ops).toEqual([]);
    now += LIBRARY_HEARTBEAT_MS;
    await sync.sync(f.project);
    expect(board.ops.map((o) => o.op)).toEqual(["library_sync"]);
  });

  it("sends every blob again when the Board answers missing", async () => {
    const f = fixture();
    const board = fakeBoard();
    const sync = new LibrarySync({ log: quiet, send: board.send });
    await sync.sync(f.project);
    // Another laptop's newer library dropped them; then main moves here.
    board.drop();
    f.push({ "library/glossary.md": `${readFileSync(join(SAMPLE, "library/glossary.md"), "utf8")}\n## Zone\n\nA shed's area.\n` });
    board.ops.length = 0;
    await sync.sync(f.project);
    expect(board.ops.map((o) => o.op)).toEqual(["library_blob", "library_sync", ...Array(14).fill("library_blob"), "library_sync"]);
    expect(board.kept()!.commit).toBe(f.clone("rev-parse", "origin/main"));
  });

  it("says once when the broker refuses the ops, and tries again at the next tick", async () => {
    const f = fixture();
    const warned: string[] = [];
    const log: Logger = { ...quiet, warn: (m: string) => void warned.push(m) };
    let calls = 0;
    const send = (async () => {
      calls++;
      throw Object.assign(new Error("Invalid operation"), { code: "invalid" });
    }) as unknown as LibrarySend;
    const sync = new LibrarySync({ log, send });
    await sync.sync(f.project);
    await sync.sync(f.project);
    expect(calls).toBe(2);
    expect(warned).toEqual(["the broker refused the library; it may predate libraries"]);
  });

  it("says once, not every tick, when an older broker answers bad_frame, unsupported or frame_too_large (review A 3)", async () => {
    for (const code of ["bad_frame", "unsupported", "frame_too_large"]) {
      const f = fixture();
      const lines: string[] = [];
      const log: Logger = { ...quiet, warn: (m: string) => void lines.push(m), info: (m: string) => void lines.push(m) };
      let calls = 0;
      const send = (async () => {
        calls++;
        throw Object.assign(new Error(code), { code });
      }) as unknown as LibrarySend;
      const sync = new LibrarySync({ log, send });
      await sync.syncAll([f.project, { ...f.project, key: "workshop" }]);
      await sync.syncAll([f.project, { ...f.project, key: "workshop" }]);
      expect(calls).toBe(4);
      expect(lines).toEqual(["the broker refused the library; it may predate libraries"]);
    }
  }, 30_000);

  it("asks whether it may fetch before each project, so a slot taken between two isn't met by a fetch (review A 7)", async () => {
    const a = fixture(), b = fixture();
    const board = fakeBoard();
    const fetched: string[] = [];
    const exec = (async (cmd: string, args: string[], cwd: string) => {
      if (args[0] === "fetch") fetched.push(cwd);
      return execFileSync(cmd, args, { cwd, encoding: "utf8" });
    }) as Exec;
    // A land is granted while the first project syncs: its index is the last op it sends.
    let slotHeld = false;
    const sync = new LibrarySync({ log: quiet, exec, send: (async (op: Parameters<LibrarySend>[0]) => {
      if (op.op === "library_sync") slotHeld = true;
      return board.send(op as never);
    }) as LibrarySend });
    await sync.syncAll([a.project, { ...b.project, key: "workshop" }], () => !slotHeld);
    expect(fetched).toEqual([a.project.path]);
    // Both were read and sent; the second at what its clone had.
    expect(board.ops.filter((o) => o.op === "library_sync").map((o) => o.project)).toEqual(["toolshed", "workshop"]);
  });

  it("reads no fetch after a land, whose push already moved the ref", async () => {
    const f = fixture();
    const board = fakeBoard();
    const sync = new LibrarySync({ log: quiet, send: board.send });
    await sync.sync(f.project);
    const moved = f.push({ "library/glossary.md": "# Glossary\n\n## Apron\n\nWhat a member wears.\n" });
    // No fetch: the clone's origin/main hasn't moved, so nothing new goes.
    board.ops.length = 0;
    await sync.sync(f.project, false);
    expect(board.ops).toEqual([]);
    f.clone("fetch", "-q", "origin", "main");
    await sync.sync(f.project, false);
    expect(board.kept()!.commit).toBe(moved);
  });
});
