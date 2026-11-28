import { checkLibrary, gitBlobId, type BoardCaller, type BoardOpInput, type BoardReply, type BoardResults, type LibraryIndex, type ServerFrame } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, laptopToken, ORIGIN, ownerToken } from "./helpers.ts";

// A project's library in the Board (ADR 0015 §2, §4; 0017 §4): a cache of main by blob, sent by the supervisors that
// serve the project, read by the page. The fixture is the standard's sample, Toolshed.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const sup = (laptop = "mbp-1", serves = ["toolshed"]): BoardCaller => ({ kind: "agent", name: "supervisor", laptop, supervisor: true, ctx: null, serves });
const board = () => env.BOARD.getByName("board");
const TOOLSHED = JSON.parse(env.TOOLSHED) as Array<{ path: string; text: string }>;
const C1 = "1c83f2b0000000000000000000000000000000aa";
const C2 = "9c01d2e0000000000000000000000000000000bb";

async function reply(caller: BoardCaller, op: BoardOpInput): Promise<BoardReply> {
  return (await board().apply(caller, op)) as unknown as BoardReply;
}
async function ok<R = unknown>(caller: BoardCaller, op: BoardOpInput): Promise<R> {
  const r = await reply(caller, op);
  if (!r.ok) throw new Error(`${op.op} refused: ${r.code}: ${r.message}`);
  return r.result as R;
}
const rows = (sql: string) => runInDurableObject(board(), (_, state) => state.storage.sql.exec(sql).toArray());

/** The sample's index at a commit, as the supervisor would send it, with each file's blob. */
async function indexOf(files: Array<{ path: string; text: string }>): Promise<LibraryIndex> {
  const checked = checkLibrary(files.map((f) => ({ ...f, bytes: new TextEncoder().encode(f.text).byteLength })));
  const blobs = new Map(await Promise.all(files.map(async (f) => [f.path, await gitBlobId(f.text)] as const)));
  return {
    standard: 1,
    files: checked.files.map((f) => ({ ...f, blob: blobs.get(f.path)!, changed: { sha: "1c83f2b", date: "2026-11-26T21:34:00+01:00" } })),
  };
}

async function toolshed(): Promise<void> {
  await ok(owner, { op: "create_project", key: "toolshed", name: "Toolshed", prefix: "TS", repos: ["cath42/toolshed"] });
}

/** Every blob, then the index: what a sync sends after a restart. */
async function send(caller: BoardCaller, files: Array<{ path: string; text: string }>, commit = C1, committed_at = "2026-11-26T21:34:00+01:00") {
  for (const f of files) await ok(caller, { op: "library_blob", project: "toolshed", blob: await gitBlobId(f.text), text: f.text });
  return reply(caller, { op: "library_sync", project: "toolshed", ref: "origin/main", commit, committed_at, github: "https://github.com/cath42/toolshed", index: await indexOf(files) });
}

describe("a project's library in the Board (ADR 0015 §2, 0017 §4)", () => {
  it("keeps the sample's blobs and index, and serves the library and each section's texts from them", async () => {
    await toolshed();
    expect(await send(sup(), TOOLSHED)).toMatchObject({ ok: true, result: { stored: true, missing: [] }, changed: { project: "toolshed", refs: ["library"] } });

    const read = await ok<BoardResults["library"]>(owner, { op: "library", project: "toolshed" });
    expect(read.library).toMatchObject({ project: "toolshed", ref: "origin/main", commit: C1, laptop: "mbp-1", github: "https://github.com/cath42/toolshed", problems: [] });
    expect(read.library!.index!.files).toHaveLength(TOOLSHED.length);
    expect(read.standard.sections.map((s) => s.id)).toEqual(["overview", "architecture", "data", "decisions", "usecases", "ux", "glossary"]);
    expect(Date.parse(read.now)).toBeGreaterThan(0);
    // No texts in the library read: the home reads only the index.
    expect(JSON.stringify(read)).not.toContain("## Goals");

    const page = (section: string, path?: string) => ok<BoardResults["library_page"]>(owner, { op: "library_page", project: "toolshed", section, ...(path ? { path } : {}) } as BoardOpInput);
    expect((await page("architecture")).files.map((f) => f.path)).toEqual(["library/architecture/model.c4", "library/architecture/spec.c4", "library/architecture/views.c4"]);
    const dbml = await page("data");
    expect(dbml).toMatchObject({ commit: C1, files: [{ path: "library/data-model.dbml", text: TOOLSHED.find((f) => f.path === "library/data-model.dbml")!.text }] });
    expect((await page("decisions")).files).toHaveLength(3);
    const adr = "library/decisions/0003-push-reminders-email-fallback.md";
    expect((await page("decisions", adr)).files).toEqual([{ path: adr, text: TOOLSHED.find((f) => f.path === adr)!.text }]);
    expect(await reply(owner, { op: "library_page", project: "toolshed", section: "decisions", path: "library/decisions/0009-none.md" })).toMatchObject({ ok: false, code: "invalid" });

    // The project menu's summary rides the projects and project reads.
    const { projects } = await ok<BoardResults["projects"]>(owner, { op: "projects" });
    expect(projects[0]!.library).toEqual({
      commit: C1,
      committed_at: "2026-11-26T21:34:00+01:00",
      checked_at: expect.any(String),
      written: true,
      title: "Toolshed",
      tagline: "A neighbourhood tool library: borrow the drill, don't buy it",
      problems: 0,
    });
    expect((await ok<BoardResults["project"]>(owner, { op: "project", project: "toolshed" })).project.library).toMatchObject({ commit: C1, written: true });
  });

  it("takes a blob only as git's own id for its text, and only from a supervisor that serves the project", async () => {
    await toolshed();
    const text = TOOLSHED[0]!.text;
    expect(await reply(sup(), { op: "library_blob", project: "toolshed", blob: "0".repeat(40), text })).toMatchObject({ ok: false, code: "invalid", message: expect.stringMatching(/git id differs/) });
    const blob = await gitBlobId(text);
    expect(await reply(owner, { op: "library_blob", project: "toolshed", blob, text })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await reply(sup("mbp-1", ["helix"]), { op: "library_blob", project: "toolshed", blob, text })).toMatchObject({ ok: false, code: "forbidden", message: expect.stringMatching(/didn't register toolshed/) });
    const worker: BoardCaller = { kind: "agent", name: "Otto", laptop: "mbp-1", supervisor: false, ctx: null };
    expect(await reply(worker, { op: "library_blob", project: "toolshed", blob, text })).toMatchObject({ ok: false, code: "forbidden" });
    // Once: a blob it has is ok, and not stored again.
    expect(await ok(sup(), { op: "library_blob", project: "toolshed", blob, text })).toMatchObject({ stored: true });
    expect(await ok(sup(), { op: "library_blob", project: "toolshed", blob, text })).toMatchObject({ stored: false });
    // Nothing a library sends is an event.
    expect(await rows("SELECT count(*) AS n FROM events WHERE tbl LIKE 'librar%'")).toEqual([{ n: 0 }]);
  });

  it("answers missing for a blob it lacks and keeps nothing, then keeps the newest commit and drops what it no longer names", async () => {
    await toolshed();
    const [first, ...rest] = TOOLSHED;
    for (const f of rest) await ok(sup(), { op: "library_blob", project: "toolshed", blob: await gitBlobId(f.text), text: f.text });
    const index = await indexOf(TOOLSHED);
    const sync = { op: "library_sync" as const, project: "toolshed", ref: "origin/main", commit: C1, committed_at: "2026-11-26T21:34:00+01:00", github: null, index };
    expect(await reply(sup(), sync)).toMatchObject({ ok: true, result: { stored: false, missing: [await gitBlobId(first!.text)] }, changed: null });
    expect((await ok<BoardResults["library"]>(owner, { op: "library", project: "toolshed" })).library).toBeNull();
    await ok(sup(), { op: "library_blob", project: "toolshed", blob: await gitBlobId(first!.text), text: first!.text });
    expect(await reply(sup(), sync)).toMatchObject({ ok: true, result: { stored: true, missing: [] } });

    // A newer commit with the glossary changed: the old glossary blob goes, the rest stay.
    const gloss = "library/glossary.md";
    const changed = TOOLSHED.map((f) => (f.path === gloss ? { ...f, text: `${f.text}\n## Zone\n\nA shed's area.\n` } : f));
    expect(await send(sup(), changed, C2, "2026-11-27T09:00:00Z")).toMatchObject({ ok: true, result: { stored: true }, changed: { refs: ["library"] } });
    expect(await rows("SELECT count(*) AS n FROM library_blobs")).toEqual([{ n: TOOLSHED.length }]);
    const page = await ok<BoardResults["library_page"]>(owner, { op: "library_page", project: "toolshed", section: "glossary" });
    expect(page).toMatchObject({ commit: C2, files: [{ text: expect.stringContaining("## Zone") }] });

    // Another laptop that hasn't fetched can't move it back; the same commit from it refreshes the check, and tells no page.
    expect(await reply(sup("mbp-2"), sync)).toMatchObject({ ok: true, result: { stored: false, missing: [] }, changed: null });
    const before = (await ok<BoardResults["library"]>(owner, { op: "library", project: "toolshed" })).library!;
    const heartbeat = { ...sync, commit: C2, committed_at: "2026-11-27T09:00:00Z", index: await indexOf(changed) };
    expect(await reply(sup("mbp-2"), heartbeat)).toMatchObject({ ok: true, result: { stored: true }, changed: null });
    const after = (await ok<BoardResults["library"]>(owner, { op: "library", project: "toolshed" })).library!;
    expect(after).toMatchObject({ commit: C2, laptop: "mbp-2" });
    expect(after.checked_at >= before.checked_at).toBe(true);
    // A failed fetch at the same commit is news for an open page.
    const failed = { ...heartbeat, problems: [{ kind: "fetch_failed" as const, at: "2026-11-27T10:00:00Z", message: "Could not resolve host: github.com" }] };
    expect(await reply(sup("mbp-2"), failed)).toMatchObject({ ok: true, changed: { refs: ["library"] } });
  });

  it("refuses an unserved caller's 900 KB blob before it hashes it, and a text over 512 KB in bytes (review A 1, 2)", async () => {
    await toolshed();
    // 300K euro signs: 900 KB in UTF-8, under the schema's 512K UTF-16 units. Its id is wrong, so a hash would say so.
    const text = "\u20ac".repeat(300 * 1024);
    expect(new TextEncoder().encode(text).byteLength).toBe(900 * 1024);
    const wrong = "0".repeat(40);
    // Who sends it is checked first: forbidden, not "its git id differs".
    expect(await reply(sup("mbp-1", ["helix"]), { op: "library_blob", project: "toolshed", blob: wrong, text })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await reply(owner, { op: "library_blob", project: "toolshed", blob: wrong, text })).toMatchObject({ ok: false, code: "forbidden" });
    // Then its bytes, still before the hash: a served supervisor's is invalid for its size, even with its right id.
    for (const blob of [wrong, await gitBlobId(text)]) {
      expect(await reply(sup(), { op: "library_blob", project: "toolshed", blob, text })).toMatchObject({ ok: false, code: "invalid", message: expect.stringMatching(/921600 bytes, over the 524288/) });
    }
    // 512 KB exactly is kept.
    const fits = "\u20ac".repeat(512 * 1024 / 4) + "ab".repeat(512 * 1024 / 8);
    expect(new TextEncoder().encode(fits).byteLength).toBe(512 * 1024);
    expect(await ok(sup(), { op: "library_blob", project: "toolshed", blob: await gitBlobId(fits), text: fits })).toMatchObject({ stored: true });
    expect(await rows("SELECT bytes FROM library_blobs")).toEqual([{ bytes: 512 * 1024 }]);
  });

  it("keeps the stored library on an equal or older date from another commit, and takes a newer one (review A 6)", async () => {
    await toolshed();
    await send(sup(), TOOLSHED, C1, "2026-11-27T09:00:00Z");
    const index = await indexOf(TOOLSHED);
    const sync = (commit: string, committed_at: string) => ({ op: "library_sync" as const, project: "toolshed", ref: "origin/main", commit, committed_at, github: null, index });
    const C3 = "3c000000000000000000000000000000000000cc";
    // The same second, written another way, from a laptop on another commit (an amend): kept, every tick.
    for (let tick = 0; tick < 2; tick++) {
      expect(await reply(sup("mbp-2"), sync(C2, "2026-11-27T10:00:00+01:00"))).toMatchObject({ ok: true, result: { stored: false }, changed: null });
      expect(await reply(sup(), sync(C1, "2026-11-27T09:00:00Z"))).toMatchObject({ ok: true, result: { stored: true }, changed: null });
    }
    expect((await ok<BoardResults["library"]>(owner, { op: "library", project: "toolshed" })).library).toMatchObject({ commit: C1, laptop: "mbp-1" });
    // Older: kept.
    expect(await reply(sup("mbp-2"), sync(C2, "2026-11-27T08:59:59Z"))).toMatchObject({ ok: true, result: { stored: false } });
    // Newer, by a second: replaces it.
    expect(await reply(sup("mbp-2"), sync(C3, "2026-11-27T09:00:01Z"))).toMatchObject({ ok: true, result: { stored: true }, changed: { refs: ["library"] } });
    expect((await ok<BoardResults["library"]>(owner, { op: "library", project: "toolshed" })).library).toMatchObject({ commit: C3, laptop: "mbp-2" });
  });

  it("keeps a commit with no library/ as a library not written, and drops every blob", async () => {
    await toolshed();
    await send(sup(), TOOLSHED);
    expect(await reply(sup(), { op: "library_sync", project: "toolshed", ref: "origin/main", commit: C2, committed_at: "2026-11-27T09:00:00Z", github: null, index: null })).toMatchObject({ ok: true, result: { stored: true } });
    expect((await ok<BoardResults["library"]>(owner, { op: "library", project: "toolshed" })).library).toMatchObject({ commit: C2, index: null });
    expect((await ok<BoardResults["projects"]>(owner, { op: "projects" })).projects[0]!.library).toMatchObject({ written: false, title: null, tagline: null });
    expect(await rows("SELECT count(*) AS n FROM library_blobs")).toEqual([{ n: 0 }]);
    expect(await reply(owner, { op: "library_page", project: "toolshed", section: "overview" })).toMatchObject({ ok: true, result: { files: [] } });
  });

  it("is never the record: no one edits it, and the board's export leaves it out", async () => {
    await toolshed();
    await send(sup(), TOOLSHED);
    const doc = JSON.stringify(await board().exportBoard({ kind: "owner", email: "owner@example.com" }));
    expect(doc).not.toContain("library");
    expect(doc).not.toContain("Toolshed's members");
    // A library is read by whoever reads the project, and not by an agent without read.
    const stranger: BoardCaller = { kind: "agent", name: "Nobody", laptop: "mbp-1", supervisor: false, ctx: null };
    expect(await reply(stranger, { op: "library", project: "toolshed" })).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("the library over the socket (ADR 0015 §2, §4)", () => {
  it("takes a blob or an index frame up to 900 KB, other ops to 64 KB, and tells the owners of a new library", async () => {
    await toolshed();
    const o = await Client.open(await ownerToken(), { origin: ORIGIN });
    const s = await Client.open(await laptopToken(1));
    await s.request({ t: "register", name: "supervisor", supervisor: true, projects: ["toolshed"] });
    const big = `# Big\n\n${"x".repeat(300 * 1024)}\n`;
    await expect(s.request({ t: "board_op", as: "supervisor", op: { op: "library_blob", project: "toolshed", blob: await gitBlobId(big), text: big } })).resolves.toMatchObject({ stored: true });
    await expect(s.request({ t: "board_op", as: "supervisor", op: { op: "capture", project: "toolshed", capture_id: "c_1", title: "x", description: big.slice(0, 70 * 1024) } })).rejects.toMatchObject({ code: "frame_too_large" });
    for (const f of TOOLSHED) await s.request({ t: "board_op", as: "supervisor", op: { op: "library_blob", project: "toolshed", blob: await gitBlobId(f.text), text: f.text } });
    await s.request({ t: "board_op", as: "supervisor", op: { op: "library_sync", project: "toolshed", ref: "origin/main", commit: C1, committed_at: "2026-11-26T21:34:00Z", github: null, index: await indexOf(TOOLSHED) } });
    const told = await o.next((f: ServerFrame) => f.t === "board_changed");
    expect(told).toMatchObject({ project: "toolshed", refs: ["library"] });
  });
});
