import type { BoardCaller, BoardCtx, BoardOpInput, BoardReply, BoardResults, GrantField, ItemRecord, SessionRef } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { NoticeRow } from "../src/board/store.ts";

// The board service's core (ADR 0001 §2, §3, §5), called as the broker calls it.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const agent = (name: string, ctx: BoardCtx | null = null): BoardCaller => ({ kind: "agent", name, laptop: "mbp-1", supervisor: ctx !== null, ctx });
const inSession = (name: string, feature: string, role = "po"): BoardCaller =>
  agent(name, { worker: `w_${name.toLowerCase()}`, role, project: "helix", session: { feature, kind: "build", label: "1" }, tasks: [] });

const board = () => env.BOARD.getByName("board");

/** The untaken notice an answer left (ADR 0009 §1), by its seq. */
async function noticeOf(seq: number): Promise<NoticeRow | undefined> {
  return ((await board().notices()) as unknown as NoticeRow[]).find((n) => n.seq === seq);
}
/** A notice's text as the message to agents it is; none when it goes to nobody. */
const textOf = (n: NoticeRow | undefined) => (n && n.to.length ? [{ to: n.to, body: n.text }] : []);
/** Every notice row, taken or not. */
const noticeCount = () => runInDurableObject(board(), (_, state) => state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM notices").one().n);

async function call(caller: BoardCaller, op: BoardOpInput): Promise<BoardReply> {
  return (await board().apply(caller, op)) as unknown as BoardReply;
}

/** The result of an operation that must succeed. */
async function ok<K extends keyof BoardResults>(caller: BoardCaller, op: BoardOpInput & { op: K }): Promise<BoardResults[K]> {
  const reply = await call(caller, op);
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result as BoardResults[K];
}

/** The refusal of an operation that must fail. */
async function refused(caller: BoardCaller, op: BoardOpInput): Promise<{ code: string; message: string }> {
  const reply = await call(caller, op);
  if (reply.ok) throw new Error(`${op.op} was not refused`);
  return reply;
}

async function item(ref: string, project = "helix"): Promise<ItemRecord & { history: NonNullable<BoardResults["get"]["history"]> }> {
  const got = await ok(owner, { op: "get", project, ref, history: true });
  return { ...got.item!, history: got.history! };
}

/** Helix with two features, a task under each and a release; returns their ids. */
async function helix() {
  await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Picard@mbp-1", po: "Picard@mbp-1" });
  const r1 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 1" })).ref!;
  const f1 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Roadmap", release: r1 })).ref!;
  const f2 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Steps" })).ref!;
  const t1 = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Draw it", parent: f1, criteria: [{ text: "Drawn" }, { text: "Shown" }] })).ref!;
  const t2 = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Count it", parent: f2 })).ref!;
  return { r1, f1, f2, t1, t2 };
}

/** Helix's rule (board-writes 2, 3): the session PO writes the open feature, Picard the rest, builders read. */
async function helixRules() {
  const po = { read: true, fields: ["status", "order", "content", "criteria", "triage", "create"] as GrantField[] };
  await ok(owner, { op: "grant", project: "helix", agent: "Picard", role: "backlog PO", ...po, items: "not_open_feature", sessions: true, questions: true, admin: true });
  await ok(owner, { op: "grant", project: "helix", agent: "Riker", role: "session PO", ...po, items: "open_feature", sessions: true });
  await ok(owner, { op: "grant", project: "helix", agent: "Bill", role: "builder", read: true, items: "none", fields: [] });
}

describe("records (criterion 0)", () => {
  it("refuses an invalid status, at the operation and in the store", async () => {
    const { t1 } = await helix();
    expect(await refused(owner, { op: "update", project: "helix", ref: t1, set: { status: "Blocked" as never } })).toMatchObject({ code: "invalid" });
    await runInDurableObject(board(), (_, state) => {
      expect(() => state.storage.sql.exec("UPDATE items SET status = 'Blocked'")).toThrow(/CHECK constraint failed/);
    });
    expect((await item(t1)).status).toBe("Draft");
  });

  it("refuses a dangling parent, at the operation and in the store", async () => {
    await helix();
    expect(await refused(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Orphan", parent: "LAND-99" })).toEqual({
      ok: false,
      code: "invalid",
      message: "No item LAND-99 in helix",
    });
    await runInDurableObject(board(), (_, state) => {
      expect(() => state.storage.sql.exec("UPDATE items SET parent = 999 WHERE kind = 'task'")).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  it("refuses a link to another project's item, at the operation and in the store", async () => {
    const { t1 } = await helix();
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    const bob = (await ok(owner, { op: "create", project: "bobnet", kind: "backlog", type: "chore", title: "Tidy" })).ref!;
    expect(await refused(owner, { op: "update", project: "bobnet", ref: bob, set: { deps: [t1] } })).toMatchObject({
      code: "invalid",
      message: `${t1} is not an item of bobnet: links stay in one project`,
    });
    await runInDurableObject(board(), (_, state) => {
      const sql = state.storage.sql;
      const pk = (ref: string) => sql.exec<{ item: number }>("SELECT item FROM item_refs WHERE ref = ?", ref).one().item;
      const bobnet = sql.exec<{ pk: number }>("SELECT pk FROM projects WHERE key = 'bobnet'").one().pk;
      expect(() => sql.exec("INSERT INTO item_deps (project, item, dep) VALUES (?, ?, ?)", bobnet, pk(bob), pk(t1))).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  it("keeps a run's tasks, pushes and events in the run's project, in the store", async () => {
    const { f1, t1 } = await helix();
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    await join(f1);
    await runInDurableObject(board(), (_, state) => {
      const sql = state.storage.sql;
      const pk = (table: string, where = "1") => sql.exec<{ pk: number }>(`SELECT pk FROM ${table} WHERE ${where}`).one().pk;
      const helixPk = pk("projects", "key = 'helix'");
      const bobnet = pk("projects", "key = 'bobnet'");
      const task = sql.exec<{ item: number }>("SELECT item FROM item_refs WHERE ref = ?", t1).one().item;
      const run = sql
        .exec<{ pk: number }>("INSERT INTO runs (id, project, agent, role, laptop, started_at) VALUES ('w_1/1', ?, 'Bill', 'builder', 'mbp-1', 'now') RETURNING pk", bobnet)
        .one().pk;
      expect(() => sql.exec("INSERT INTO run_tasks (project, run, item) VALUES (?, ?, ?)", helixPk, run, task)).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => sql.exec("INSERT INTO pushes (project, repo, branch, sha, worker, run, at) VALUES (?, 'r', 'b', 's', 'w_1', ?, 'now')", helixPk, run)).toThrow(/FOREIGN KEY constraint failed/);
      expect(() =>
        sql.exec("INSERT INTO events (at, project, actor_kind, actor, session, op, tbl, pk) VALUES ('now', ?, 'board', 'x', ?, 'x', 'x', 1)", bobnet, pk("sessions")),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  it("keeps a task's release its feature's and a feature parentless", async () => {
    const { r1, f1, f2 } = await helix();
    expect(await refused(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "x", parent: f1, release: r1 })).toMatchObject({ code: "invalid" });
    expect(await refused(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "x", parent: "LAND-4" })).toMatchObject({
      message: "LAND-4 is a task, not a feature",
    });
    expect(await refused(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "x", parent: f2 })).toMatchObject({ code: "invalid" });
    expect((await item("LAND-3")).release).toBe(r1);
  });
});

describe("ids (criterion 2)", () => {
  it("keeps an item's id when it moves to another feature or release, or changes kind", async () => {
    const { f1, f2, t1 } = await helix();
    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 2" })).ref!;
    await ok(owner, { op: "update", project: "helix", ref: t1, set: { parent: f2 } });
    await ok(owner, { op: "set_release", project: "helix", ref: f1, release: r2 });
    expect(await item(t1)).toMatchObject({ ref: t1, parent: f2, release: null });
    expect(await item(f1)).toMatchObject({ ref: f1, release: r2 });

    const idea = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "chore", title: "Idea" })).ref!;
    await ok(owner, { op: "slot", project: "helix", ref: idea, feature: f2 });
    expect(await item(idea)).toMatchObject({ ref: idea, kind: "task", parent: f2 });
    const big = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "spike", title: "Big idea" })).ref!;
    await ok(owner, { op: "promote", project: "helix", ref: big });
    expect(await item(big)).toMatchObject({ ref: big, kind: "feature", type: "increment", release: null });
  });

  it("never reuses an id: an archived item keeps its, and the next item gets a new one", async () => {
    const { t2 } = await helix();
    expect(t2).toBe("LAND-4");
    await ok(owner, { op: "archive", project: "helix", ref: t2, reason: "dropped at triage" });
    expect(await item(t2)).toMatchObject({ ref: t2, archived_at: expect.any(String), archive_reason: "dropped at triage" });
    expect((await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "chore", title: "Next" })).ref).toBe("LAND-5");
    await runInDurableObject(board(), (_, state) => {
      expect(state.storage.sql.exec("SELECT ref FROM item_refs ORDER BY ref").toArray().map((r) => r.ref)).toEqual(["LAND-1", "LAND-2", "LAND-3", "LAND-4", "LAND-5"]);
    });
  });

  it("keeps the order it is given: features in a release, releases in a project, the backlog", async () => {
    const { r1, f1 } = await helix();
    const f3 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Waits", release: r1 })).ref!;
    const ids = async (op: BoardOpInput) => ((await ok(owner, op as BoardOpInput & { op: "list" })).items ?? []).map((i) => i.ref);
    expect(await ids({ op: "list", project: "helix", of: "features", release: r1 })).toEqual([f1, f3]);
    await ok(owner, { op: "order", project: "helix", scope: "features", release: r1, refs: [f3, f1] });
    expect(await ids({ op: "list", project: "helix", of: "features", release: r1 })).toEqual([f3, f1]);
    expect(await refused(owner, { op: "order", project: "helix", scope: "features", release: r1, refs: [f3] })).toMatchObject({ code: "invalid" });

    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 2" })).ref!;
    await ok(owner, { op: "order_releases", project: "helix", refs: [r2, r1] });
    expect((await ok(owner, { op: "list", project: "helix", of: "releases" })).releases!.map((r) => r.ref)).toEqual([r2, r1]);
  });
});

describe("events (criterion 6)", () => {
  it("records every write with who, what, from what to what, in the item's history", async () => {
    const { f1, t1 } = await helix();
    await helixRules();
    await join(f1);
    const riker = inSession("Riker", f1);
    const writes: Array<{ seq: number }> = [
      await ok(riker, { op: "update", project: "helix", ref: t1, set: { status: "In Progress", labels: ["ui"] }, reason: "build started" }),
      await ok(riker, { op: "criteria", project: "helix", ref: t1, change: { action: "check", n: 1, evidence: "test/roadmap.test.ts" } }),
      await ok(riker, { op: "update", project: "helix", ref: t1, set: { title: "Draw the roadmap" } }),
    ];
    const { history } = await item(t1);
    expect(history.map((e) => e.seq)).toEqual(expect.arrayContaining(writes.map((w) => w.seq)));
    expect(history.at(-3)).toMatchObject({
      op: "update",
      reason: "build started",
      actor: { kind: "agent", who: "Riker@mbp-1", role: "po", worker: "w_riker", session: { feature: f1, kind: "build", label: "1" } },
      changes: [
        { field: "status", old: "Draft", new: "In Progress" },
        { field: "label", old: null, new: "ui" },
      ],
    });
    expect(history.at(-2)!.changes).toEqual([
      { field: "ac #1 state", old: "open", new: "checked" },
      { field: "ac #1 evidence", old: null, new: "test/roadmap.test.ts" },
    ]);
    expect(history.at(-1)!.changes).toEqual([{ field: "title", old: "Draw it", new: "Draw the roadmap" }]);
    expect(history[0]).toMatchObject({ op: "create", actor: { kind: "owner", who: "owner@example.com" } });
  });

  it("writes an event for every record a write changes, and none for a write that changes nothing", async () => {
    const { t1 } = await helix();
    const count = () => runInDurableObject(board(), (_, state) => state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM events").one().n);
    const before = await count();
    await ok(owner, { op: "update", project: "helix", ref: t1, set: { title: "Draw it" } });
    expect(await count()).toBe(before);
    await ok(owner, { op: "update", project: "helix", ref: t1, set: { title: "Drawn" } });
    expect(await count()).toBe(before + 1);
  });

  it("refuses to change or delete an event", async () => {
    await helix();
    await runInDurableObject(board(), (_, state) => {
      expect(() => state.storage.sql.exec("DELETE FROM events")).toThrow(/never deleted/);
      expect(() => state.storage.sql.exec("UPDATE event_changes SET new = 'x'")).toThrow(/never changed/);
    });
  });

  it("commits nothing of a refused write", async () => {
    const { t1 } = await helix();
    const before = await item(t1);
    await refused(owner, { op: "update", project: "helix", ref: t1, set: { title: "New", deps: ["LAND-99"] } });
    const after = await item(t1);
    expect(after.title).toBe(before.title);
    expect(after.history).toHaveLength(before.history.length);
  });
});

describe("who may write what (ADR 0001 §5)", () => {
  it("refuses a builder's status write, with its reason and who may make it", async () => {
    const { t2 } = await helix();
    await helixRules();
    expect(await refused(agent("Bill"), { op: "update", project: "helix", ref: t2, set: { status: "Done" } })).toEqual({
      ok: false,
      code: "forbidden",
      message: "Bill may not change status on LAND-4 in helix; Picard off the open feature, or Riker on the open feature may",
    });
    expect((await ok(agent("Bill"), { op: "get", project: "helix", ref: t2 })).item!.status).toBe("Draft");
  });

  it("has Helix's two PO rows: the session PO writes the open feature, Picard the rest", async () => {
    const { f1, f2, t1, t2 } = await helix();
    await helixRules();
    await join(f1);
    expect((await item(f1)).open_since).not.toBeNull();

    const riker = inSession("Riker", f1);
    await ok(riker, { op: "update", project: "helix", ref: t1, set: { status: "In Progress" } });
    expect(await refused(riker, { op: "update", project: "helix", ref: t2, set: { status: "In Progress" } })).toMatchObject({ code: "forbidden" });

    await ok(agent("Picard"), { op: "update", project: "helix", ref: t2, set: { status: "Ready" } });
    expect(await refused(agent("Picard"), { op: "update", project: "helix", ref: t1, set: { status: "Done" } })).toMatchObject({
      code: "forbidden",
      message: expect.stringMatching(/^Picard may not change status on LAND-3 in helix \(LAND-1 is open\)/),
    });

    // A session PO whose session is on another feature doesn't write this one.
    expect(await refused(inSession("Riker", f2), { op: "update", project: "helix", ref: t1, set: { status: "Done" } })).toMatchObject({ code: "forbidden" });
    // Nor does one that declares no session.
    expect(await refused(agent("Riker"), { op: "update", project: "helix", ref: t1, set: { status: "Done" } })).toMatchObject({ code: "forbidden" });
    expect((await item(t1)).status).toBe("In Progress");
  });

  it("checks a task moved between features against both", async () => {
    const { f1, f2, t2 } = await helix();
    await helixRules();
    await join(f1);
    expect(await refused(agent("Picard"), { op: "update", project: "helix", ref: t2, set: { parent: f1 } })).toMatchObject({ code: "forbidden" });
    expect((await item(t2)).parent).toBe(f2);
  });

  it("keeps Casper's gates his: a feature's release without the 'release' grant, the order of releases, a gated criterion", async () => {
    const { r1, f2, t1 } = await helix();
    await helixRules();
    expect(await refused(agent("Picard"), { op: "set_release", project: "helix", ref: f2, release: r1 })).toMatchObject({ code: "forbidden" });
    expect(await refused(agent("Picard"), { op: "order_releases", project: "helix", refs: [r1] })).toMatchObject({ code: "forbidden" });
    await ok(agent("Picard"), { op: "criteria", project: "helix", ref: t1.replace("3", "4"), change: { action: "add", text: "Casper accepts", casper_gate: true } });
    expect(await refused(agent("Picard"), { op: "criteria", project: "helix", ref: "LAND-4", change: { action: "check", n: 1, evidence: "demo" } })).toMatchObject({
      code: "forbidden",
    });
    await ok(owner, { op: "criteria", project: "helix", ref: "LAND-4", change: { action: "check", n: 1, evidence: "demo" } });
  });

  it("lets a create-only grant make Drafts, and nothing further on", async () => {
    await helix();
    await ok(owner, { op: "grant", project: "helix", agent: "Wesley", role: "capturer", read: true, items: "all", fields: ["create"] });
    expect(await refused(agent("Wesley"), { op: "create", project: "helix", kind: "backlog", type: "chore", title: "Done already", status: "Done" })).toMatchObject({
      code: "forbidden",
      message: expect.stringMatching(/^Wesley may not change status on the backlog in helix/),
    });
    await ok(agent("Wesley"), { op: "create", project: "helix", kind: "backlog", type: "chore", title: "A draft", status: "Draft" });
  });

  it("never gives a new rule a revoked rule's history", async () => {
    await helix();
    await ok(owner, { op: "grant", project: "helix", agent: "Bill", role: "builder", read: true, items: "none", fields: [] });
    await ok(owner, { op: "revoke", project: "helix", agent: "Bill" });
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "builder", read: true, items: "none", fields: [] });
    await runInDurableObject(board(), (_, state) => {
      const events = state.storage.sql.exec<{ op: string; pk: number }>("SELECT op, pk FROM events WHERE tbl = 'grants' ORDER BY seq").toArray();
      expect(events.map((e) => e.op)).toEqual(["grant", "revoke", "grant"]);
      expect(events[2]!.pk).not.toBe(events[0]!.pk);
    });
  });

  it("lets the owner or an admin change the rules, and records it", async () => {
    await helix();
    await helixRules();
    expect(await refused(agent("Riker"), { op: "grant", project: "helix", agent: "Bill", role: "builder", read: true, items: "all", fields: ["status"] })).toMatchObject({
      code: "forbidden",
      message: "Riker may not change the rules on helix; Picard may",
    });
    await ok(agent("Picard"), { op: "grant", project: "helix", agent: "Bill", role: "builder", read: true, items: "all", fields: ["status"] });
    expect(await refused(agent("Picard"), { op: "grant", project: "*", agent: "Bill", role: "x", read: true, items: "none", fields: [] })).toMatchObject({ code: "forbidden" });
    const { grants } = await ok(agent("Bill"), { op: "grants", project: "helix" });
    expect(grants.find((g) => g.agent === "Bill")).toMatchObject({ items: "all", fields: ["status"] });
    await ok(agent("Bill"), { op: "update", project: "helix", ref: "LAND-4", set: { status: "Ready" } });
  });

  it("lets a global admin, made by the owner from the dashboard, set a project's rules (BOB-118)", async () => {
    await helix();
    await helixRules();
    const poe = { op: "grant" as const, project: "*", agent: "poe", laptop: "mbp-1", role: "admin", read: true, items: "none" as const, fields: [], admin: true };
    expect(await refused(agent("Picard"), poe)).toMatchObject({ code: "forbidden" });
    await ok(owner, poe);
    await ok(agent("poe"), { op: "grant", project: "helix", agent: "Bill", role: "builder", read: true, items: "none", fields: [] });
    const { grants } = await ok(agent("poe"), { op: "grants", project: "helix" });
    expect(grants.find((g) => g.project === "*" && g.agent === "poe")).toMatchObject({ admin: true, items: "none" });
    // No item writes: admin sets rules, not the board.
    expect(await refused(agent("poe"), { op: "update", project: "helix", ref: "LAND-4", set: { status: "Ready" } })).toMatchObject({ code: "forbidden" });
  });
});

describe("Casper's gates: closing a release, and undo (ADR 0001 §5)", () => {
  /** Helix's R1 holding f1 (not Done), a Done feature, an archived one, and R2 holding one feature already. */
  async function releases() {
    const ids = await helix();
    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 2" })).ref!;
    const feature = async (title: string, release: string | null) => (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title, release })).ref!;
    const done = await feature("Shipped", ids.r1);
    await ok(owner, { op: "update", project: "helix", ref: done, set: { status: "Done" } });
    const dropped = await feature("Dropped", ids.r1);
    await ok(owner, { op: "archive", project: "helix", ref: dropped, reason: "not wanted" });
    const f3 = await feature("Waits", ids.r1);
    const there = await feature("Already there", r2);
    return { ...ids, r2, done, dropped, f3, there };
  }
  const release = async (ref: string) => (await ok(owner, { op: "get", project: "helix", ref })).release!;
  const features = async (release: string | null) => ((await ok(owner, { op: "list", project: "helix", of: "features", release })).items ?? []).map((i) => i.ref);

  it("refuses a close that leaves a feature not Done in it, naming each", async () => {
    const { r1, r2, f1, f3 } = await releases();
    expect(await refused(owner, { op: "close_release", project: "helix", ref: r1 })).toEqual({
      ok: false,
      code: "invalid",
      message: `Closing ${r1} would leave ${f1}, ${f3} not Done in it: say where each goes, another release or none`,
    });
    expect(await refused(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: r2 }] })).toMatchObject({ code: "invalid", message: expect.stringContaining(f3) });
    expect((await release(r1)).status).toBe("planned");
  });

  it("closes a release, moving each open feature last in its destination; Done and archived ones stay", async () => {
    const { r1, r2, f1, f3, done, dropped, there } = await releases();
    const closed = await ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f3, to: r2 }, { feature: f1, to: null }] });
    expect(closed.ref).toBe(r1);
    expect(await release(r1)).toMatchObject({ status: "closed", closed_at: expect.any(String), closed_by: "owner@example.com" });
    expect(await features(r2)).toEqual([there, f3]);
    expect(await features(null)).toContain(f1);
    expect(await item(done)).toMatchObject({ release: r1 });
    expect(await item(dropped)).toMatchObject({ release: r1 });
    const moved = (await item(f3)).history.at(-1)!;
    expect(moved).toMatchObject({ op: "close_release", actor: { kind: "owner", who: "owner@example.com" }, changes: expect.arrayContaining([{ field: "release", old: r1, new: r2 }]) });
    // A closed release takes no features, and isn't closed twice.
    expect(await refused(owner, { op: "set_release", project: "helix", ref: f1, release: r1 })).toMatchObject({ code: "conflict" });
    expect(await refused(owner, { op: "close_release", project: "helix", ref: r1 })).toMatchObject({ code: "conflict" });
  });

  it("refuses a close by anyone but Casper, and a move that isn't one", async () => {
    const { r1, r2, f1, f2, f3, done } = await releases();
    await helixRules();
    const moves = [{ feature: f1, to: r2 }, { feature: f3, to: r2 }];
    expect(await refused(agent("Picard"), { op: "close_release", project: "helix", ref: r1, moves })).toMatchObject({ code: "forbidden" });
    const bad = async (extra: { feature: string; to: string | null }) => refused(owner, { op: "close_release", project: "helix", ref: r1, moves: [...moves, extra] });
    expect(await bad({ feature: f2, to: r2 })).toMatchObject({ code: "invalid", message: `${f2} is not in ${r1}` });
    expect(await bad({ feature: done, to: r2 })).toMatchObject({ code: "invalid", message: `${done} is Done: it stays in ${r1}` });
    expect(await bad({ feature: f1, to: null })).toMatchObject({ code: "invalid", message: `${f1} is moved twice` });
    expect(await refused(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: r1 }, moves[1]!] })).toMatchObject({ code: "invalid" });
    const r3 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 3" })).ref!;
    await ok(owner, { op: "close_release", project: "helix", ref: r3 });
    expect(await refused(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: r3 }, moves[1]!] })).toMatchObject({ code: "conflict" });
    expect((await release(r1)).status).toBe("planned");
  });

  it("undoes a close: the release reopens and its features go back to their places", async () => {
    const { r1, r2, f1, f3, done, there } = await releases();
    const before = await features(r1);
    const { seq } = await ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: r2 }, { feature: f3, to: null }] });
    const moveSeq = (await item(f1)).history.at(-1)!.seq;
    expect(await refused(owner, { op: "undo", project: "helix", seq: moveSeq })).toMatchObject({ code: "invalid", message: expect.stringMatching(/undo the close/) });
    expect(await refused(agent("Picard"), { op: "undo", project: "helix", seq })).toMatchObject({ code: "forbidden" });

    expect(await ok(owner, { op: "undo", project: "helix", seq })).toMatchObject({ ref: r1, told: [] });
    expect(await release(r1)).toMatchObject({ status: "planned", closed_at: null, closed_by: null });
    expect(await features(r1)).toEqual(before);
    expect(await features(r2)).toEqual([there]);
    expect(await item(done)).toMatchObject({ release: r1 });
    // Each feature's undo names its own move; the release's names the close.
    expect((await item(f3)).history.at(-1)).toMatchObject({ op: "undo", undo_of: seq - 1, changes: expect.arrayContaining([{ field: "release", old: null, new: r1 }]) });
    const got = await ok(owner, { op: "get", project: "helix", ref: r1, history: true });
    expect(got.history!.map((e) => e.op)).toEqual(["create_release", "close_release", "undo"]);
    expect(got.history!.at(-1)).toMatchObject({ undo_of: seq, changes: expect.arrayContaining([{ field: "status", old: "closed", new: "planned" }]) });
    expect(await refused(owner, { op: "undo", project: "helix", seq })).toMatchObject({ code: "conflict", message: expect.stringMatching(/undone already/) });
  });

  it("refuses to undo a close after two minutes, or once a feature has moved or its destination closed", async () => {
    const { r1, r2, f1, f3 } = await releases();
    const close = () => ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: r2 }, { feature: f3, to: r2 }] });
    const late = await close();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 121_000 });
    try {
      expect(await refused(owner, { op: "undo", project: "helix", seq: late.seq })).toMatchObject({ code: "conflict", message: expect.stringMatching(/two minutes/) });
    } finally {
      vi.useRealTimers();
    }
    await ok(owner, { op: "set_release", project: "helix", ref: f1, release: null });
    expect(await refused(owner, { op: "undo", project: "helix", seq: late.seq })).toMatchObject({ code: "conflict" });
  });

  it("refuses to undo a close whose destination has closed since", async () => {
    const { r1, r2, f1, f3, there } = await releases();
    const { seq } = await ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: r2 }, { feature: f3, to: r2 }] });
    const r3 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 3" })).ref!;
    await ok(owner, { op: "close_release", project: "helix", ref: r2, moves: [f1, f3, there].map((feature) => ({ feature, to: r3 })) });
    // The features are in R3 now, not where R1's close put them.
    expect(await refused(owner, { op: "undo", project: "helix", seq })).toMatchObject({ code: "conflict", message: expect.stringMatching(/has moved/) });
    expect((await release(r1)).status).toBe("closed");
  });

  it("undoes a feature's move between releases, unless it has moved since or its old release is closed", async () => {
    const { r1, r2, f1, f3 } = await releases();
    const before = await features(r1);
    const { seq } = await ok(owner, { op: "set_release", project: "helix", ref: f1, release: r2 });
    await ok(owner, { op: "undo", project: "helix", seq });
    expect(await features(r1)).toEqual(before);
    expect((await item(f1)).history.at(-1)).toMatchObject({ op: "undo", undo_of: seq });
    expect(await refused(owner, { op: "undo", project: "helix", seq })).toMatchObject({ code: "conflict" });

    const twice = await ok(owner, { op: "set_release", project: "helix", ref: f1, release: r2 });
    await ok(owner, { op: "set_release", project: "helix", ref: f1, release: null });
    expect(await refused(owner, { op: "undo", project: "helix", seq: twice.seq })).toMatchObject({ code: "conflict", message: expect.stringMatching(/has moved/) });

    const out = await ok(owner, { op: "set_release", project: "helix", ref: f3, release: r2 });
    await ok(owner, { op: "close_release", project: "helix", ref: r1 });
    expect(await refused(owner, { op: "undo", project: "helix", seq: out.seq })).toMatchObject({ code: "conflict", message: expect.stringMatching(/closed now/) });
  });

  it("records each gate as Casper's, takes a release order back by its inverse, and leaves a feature's release to the gate alone (board-writes 4, 8)", async () => {
    const { r1, r2, f2, f3 } = await releases();
    await helixRules();
    const order = async () => ((await ok(owner, { op: "list", project: "helix", of: "releases" })).releases ?? []).map((r) => r.ref);
    expect(await order()).toEqual([r1, r2]);
    await ok(owner, { op: "order_releases", project: "helix", refs: [r2, r1] });
    expect(await order()).toEqual([r2, r1]);
    const reordered = (await ok(owner, { op: "get", project: "helix", ref: r2, history: true })).history!.at(-1)!;
    expect(reordered).toMatchObject({ op: "order_releases", actor: { kind: "owner", who: "owner@example.com" } });
    // The dashboard's Undo of a release move is the inverse order (Daisy), not `undo`.
    expect(await refused(owner, { op: "undo", project: "helix", seq: reordered.seq })).toMatchObject({ code: "invalid" });
    await ok(owner, { op: "order_releases", project: "helix", refs: [r1, r2] });
    expect(await order()).toEqual([r1, r2]);

    // A feature goes last in its new release, recorded as Casper's.
    await ok(owner, { op: "set_release", project: "helix", ref: f2, release: r2 });
    expect(await features(r2)).toEqual([expect.any(String), f2]);
    expect((await item(f2)).history.at(-1)).toMatchObject({ op: "set_release", actor: { kind: "owner" }, changes: expect.arrayContaining([{ field: "release", old: null, new: r2 }]) });

    // Nobody else places a feature, by the gate or by an update; the PO's update of a feature's release is pointed at the gate.
    expect(await refused(agent("Picard"), { op: "update", project: "helix", ref: f3, set: { release: r2 } })).toMatchObject({ code: "invalid", message: expect.stringContaining("set_release") });
    expect(await refused(agent("Picard"), { op: "close_release", project: "helix", ref: r2, moves: [{ feature: f2, to: null }] })).toMatchObject({ code: "forbidden" });
    // A feature promoted from a backlog item is in no release until the gate places it.
    const drafted = (await ok(agent("Picard"), { op: "create", project: "helix", kind: "backlog", type: "task", title: "Big one", release: r1 })).ref!;
    await ok(agent("Picard"), { op: "promote", project: "helix", ref: drafted });
    expect((await item(drafted)).release).toBeNull();
    expect(await features(null)).toContain(drafted);
  });
});

describe("a feature's release is a grant, 'release' (BOB-122)", () => {
  /** Helix's R1 holding f1, R2 empty, f2 in none; Data has the PO's rule with 'release', Picard without it. */
  async function slotting() {
    const ids = await helix();
    await helixRules();
    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 2" })).ref!;
    const f3 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Waits", release: r2 })).ref!;
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "PO", read: true, items: "all", fields: ["status", "order", "content", "criteria", "triage", "create", "release"] });
    return { ...ids, r2, f3 };
  }
  const features = async (release: string | null) => ((await ok(owner, { op: "list", project: "helix", of: "features", release })).items ?? []).map((i) => i.ref);

  it("AC1: a rule with 'release' moves a feature into a release, between releases and out of any, last in its new one, as the PO's", async () => {
    const { r1, r2, f1, f2, f3 } = await slotting();
    const moved = async (ref: string, old: string | null, now: string | null) =>
      expect((await item(ref)).history.at(-1)).toMatchObject({
        op: "set_release",
        actor: { kind: "agent", who: "Data@mbp-1" },
        changes: expect.arrayContaining([{ field: "release", old, new: now }]),
      });

    await ok(agent("Data"), { op: "set_release", project: "helix", ref: f2, release: r2 });
    expect(await features(r2)).toEqual([f3, f2]);
    await moved(f2, null, r2);

    await ok(agent("Data"), { op: "set_release", project: "helix", ref: f1, release: r2 });
    expect(await features(r2)).toEqual([f3, f2, f1]);
    expect(await features(r1)).toEqual([]);
    await moved(f1, r1, r2);

    await ok(agent("Data"), { op: "set_release", project: "helix", ref: f3, release: null });
    expect(await features(r2)).toEqual([f2, f1]);
    expect((await features(null)).at(-1)).toBe(f3);
    await moved(f3, r2, null);

    // A new feature made in a release goes last in it, by the same grant.
    const made = (await ok(agent("Data"), { op: "create", project: "helix", kind: "feature", type: "increment", title: "New", release: r2 })).ref!;
    expect(await features(r2)).toEqual([f2, f1, made]);
  });

  it("AC2: a rule without 'release' is refused, naming the field; the owner still moves a feature and undoes it", async () => {
    const { r1, r2, f1, f2 } = await slotting();
    const missing = { code: "forbidden", message: expect.stringContaining("the 'release' field") };
    expect(await refused(agent("Picard"), { op: "set_release", project: "helix", ref: f2, release: r2 })).toMatchObject(missing);
    expect(await refused(agent("Picard"), { op: "set_release", project: "helix", ref: f1, release: null })).toMatchObject(missing);
    expect(await refused(agent("Picard"), { op: "create", project: "helix", kind: "feature", type: "increment", title: "x", release: r1 })).toMatchObject(missing);
    expect((await refused(agent("Picard"), { op: "set_release", project: "helix", ref: f2, release: r2 })).message).toMatch(/Data may$/);
    expect(await features(r2)).not.toContain(f2);

    const before = await features(r1);
    const { seq } = await ok(owner, { op: "set_release", project: "helix", ref: f1, release: r2 });
    expect((await item(f1)).history.at(-1)).toMatchObject({ op: "set_release", actor: { kind: "owner" } });
    await ok(owner, { op: "undo", project: "helix", seq });
    expect(await features(r1)).toEqual(before);
    expect((await item(f1)).history.at(-1)).toMatchObject({ op: "undo", undo_of: seq });
  });

  it("keeps 'release' through the rules: granted, read back, and in the store's check", async () => {
    await slotting();
    const { grants } = await ok(agent("Data"), { op: "grants", project: "helix" });
    expect(grants.find((g) => g.agent === "Data")!.fields).toContain("release");
    await runInDurableObject(board(), (_, state) => {
      expect(() => state.storage.sql.exec("INSERT INTO grant_fields (grant_pk, field) SELECT pk, 'slot' FROM grants LIMIT 1")).toThrow(/CHECK constraint failed/);
    });
  });
});

describe("a 'release' rule organizes releases (BOB-189, ADR 0003 2026-11-22)", () => {
  /** Helix's R1 holding f1, f2 in none; Data is a backlog PO with 'release' off the open feature. */
  async function organizing() {
    const ids = await helix();
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "backlog PO", read: true, items: "not_open_feature", fields: ["release"] });
    return ids;
  }
  const data = agent("Data");
  const releases = async () => ((await ok(owner, { op: "list", project: "helix", of: "releases" })).releases ?? []).map((r) => [r.ref, r.status]);
  const release = async (ref: string) => {
    const got = await ok(owner, { op: "get", project: "helix", ref, history: true });
    return { ...got.release!, history: got.history! };
  };
  const byData = { kind: "agent", who: "Data@mbp-1" };

  it("AC1, AC2: creates the next release, planned and last, and orders every release", async () => {
    const { r1 } = await organizing();
    const made = await ok(data, { op: "create_release", project: "helix", title: "Nightly", goal: "Every day starts green" });
    expect(made.ref).toBe("R2");
    expect(await releases()).toEqual([
      [r1, "planned"],
      ["R2", "planned"],
    ]);
    expect((await release("R2")).history[0]).toMatchObject({ op: "create_release", actor: byData });

    await ok(data, { op: "order_releases", project: "helix", refs: ["R2", r1] });
    expect((await releases()).map(([ref]) => ref)).toEqual(["R2", r1]);
    expect((await release(r1)).history.at(-1)).toMatchObject({ op: "order_releases", actor: byData });
  });

  it("AC2: edits a release's title, goal and spec_url, each with old and new; a no-op writes nothing; a closed one is edited too", async () => {
    const { r1, f1 } = await organizing();
    await ok(data, { op: "update_release", project: "helix", ref: r1, set: { title: "Roadmap", goal: "See what's next", spec_url: "https://example.com/r1" }, reason: "README's outcome" });
    const r = await release(r1);
    expect(r).toMatchObject({ title: "Roadmap", goal: "See what's next", spec_url: "https://example.com/r1", status: "planned" });
    expect(r.history.at(-1)).toMatchObject({
      op: "update_release",
      actor: byData,
      reason: "README's outcome",
      changes: [
        { field: "title", old: "Release 1", new: "Roadmap" },
        { field: "goal", old: null, new: "See what's next" },
        { field: "spec_url", old: null, new: "https://example.com/r1" },
      ],
    });
    await ok(data, { op: "update_release", project: "helix", ref: r1, set: { title: "Roadmap", goal: "See what's next" } });
    expect((await release(r1)).history).toHaveLength(r.history.length);

    await ok(data, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: null }] });
    await ok(data, { op: "update_release", project: "helix", ref: r1, set: { goal: null } });
    expect(await release(r1)).toMatchObject({ goal: null, status: "closed" });
    expect(await refused(data, { op: "update_release", project: "helix", ref: "R9", set: { title: "x" } })).toMatchObject({ code: "invalid" });
  });

  it("AC3: closes a release with its moves and reopens it to the status before the close, naming the PO; the moves stay", async () => {
    const { r1, f1, f2 } = await organizing();
    await ok(data, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: null }] });
    const closed = await release(r1);
    expect(closed).toMatchObject({ status: "closed", closed_by: "Data@mbp-1", closed_at: expect.any(String) });
    expect((await item(f1)).history.at(-1)).toMatchObject({ op: "close_release", actor: byData, changes: expect.arrayContaining([{ field: "release", old: r1, new: null }]) });

    await ok(data, { op: "reopen_release", project: "helix", ref: r1, reason: "closed too soon" });
    const reopened = await release(r1);
    expect(reopened).toMatchObject({ status: "planned", closed_at: null, closed_by: null });
    expect(reopened.history.map((e) => e.op)).toEqual(["create_release", "close_release", "reopen_release"]);
    expect(reopened.history.at(-1)).toMatchObject({
      actor: byData,
      reason: "closed too soon",
      changes: [
        { field: "status", old: "closed", new: "planned" },
        { field: "closed_at", old: closed.closed_at, new: null },
        { field: "closed_by", old: "Data@mbp-1", new: null },
      ],
    });
    expect((await item(f1)).release).toBeNull();
    await ok(data, { op: "set_release", project: "helix", ref: f2, release: r1 });
    expect((await item(f2)).release).toBe(r1);
    expect(await refused(data, { op: "reopen_release", project: "helix", ref: r1 })).toMatchObject({ code: "conflict" });
  });

  it("AC3: an open release reopens open; one imported closed, with no close event, reopens planned", async () => {
    const { r1, f1 } = await organizing();
    await join(f1);
    expect((await release(r1)).status).toBe("open");
    await ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: null }] });
    await ok(data, { op: "reopen_release", project: "helix", ref: r1 });
    expect((await release(r1)).status).toBe("open");
    expect(await refused(data, { op: "reopen_release", project: "helix", ref: r1 })).toMatchObject({ code: "conflict", message: expect.stringContaining("open, not closed") });

    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Imported" })).ref!;
    await runInDurableObject(board(), (_, state) => {
      state.storage.sql.exec("UPDATE releases SET status = 'closed', closed_at = '2026-10-01T00:00:00.000Z', closed_by = 'import' WHERE ref = ?", r2);
    });
    await ok(data, { op: "reopen_release", project: "helix", ref: r2 });
    expect(await release(r2)).toMatchObject({ status: "planned", closed_at: null, closed_by: null });
  });

  it("refuses a close that moves an open feature to a PO off the open feature, not to the owner", async () => {
    const { r1, f1 } = await organizing();
    await join(f1);
    expect(await refused(data, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: null }] })).toMatchObject({
      code: "forbidden",
      message: expect.stringContaining(`(${f1} is open)`),
    });
    expect((await release(r1)).status).toBe("open");
    await ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: null }] });
    expect((await release(r1)).status).toBe("closed");
  });

  it("refuses every release write to rules with only 'create', 'triage' or 'order', naming who holds 'release'; a PO's undo too", async () => {
    const { r1, f1 } = await organizing();
    const { seq } = await ok(data, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: null }] });
    const writes = [
      { op: "create_release", project: "helix", title: "Nightly" },
      { op: "update_release", project: "helix", ref: r1, set: { title: "Roadmap" } },
      { op: "order_releases", project: "helix", refs: [r1] },
      { op: "close_release", project: "helix", ref: r1 },
      { op: "reopen_release", project: "helix", ref: r1 },
    ] as const satisfies BoardOpInput[];
    for (const field of ["create", "triage", "order"] as const) {
      const name = `Only${field}`;
      await ok(owner, { op: "grant", project: "helix", agent: name, role: "PO", read: true, items: "all", fields: [field] });
      for (const op of writes) {
        expect(await refused(agent(name), op)).toMatchObject({
          code: "forbidden",
          message: expect.stringMatching(new RegExp(`^${name} may not organize releases \\(the 'release' field\\) on releases in helix; Data off the open feature may$`)),
        });
      }
    }
    expect(await releases()).toEqual([[r1, "closed"]]);
    expect(await refused(data, { op: "undo", project: "helix", seq })).toMatchObject({ code: "forbidden", message: expect.stringContaining("Casper's gate") });
  });

  it("AC4: Picard's helix rule organizes the roadmap end to end: R3 and Later, a backlog item through them, R0 closed, reopened and closed", async () => {
    // Helix as imported (BOB-9): R0-R2; R0 holds a Done feature and two not Done, R2 one.
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Picard@mbp-1", po: "Picard@mbp-1" });
    for (const title of ["Foundations", "Roadmap", "Steps"]) await ok(owner, { op: "create_release", project: "helix", title });
    // The import numbers them from R0, and next_release follows the last (export.ts).
    await runInDurableObject(board(), (_, state) => {
      for (const n of [1, 2, 3]) state.storage.sql.exec("UPDATE releases SET ref = ? WHERE ref = ?", `R${n - 1}`, `R${n}`);
      state.storage.sql.exec("UPDATE projects SET next_release = 3 WHERE key = 'helix'");
    });
    const feature = async (title: string, release: string) => (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title, release })).ref!;
    const shipped = await feature("Shipped", "R0");
    const late = await feature("Late", "R0");
    const later = await feature("Later still", "R0");
    const steps = await feature("Steps view", "R2");
    await ok(owner, { op: "update", project: "helix", ref: shipped, set: { status: "Done" } });
    const idea = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "task", title: "Nightly digest" })).ref!;

    // Picard's rule exactly as board_grants shows it on helix.
    await ok(owner, {
      op: "grant",
      project: "helix",
      agent: "Picard",
      role: "backlog PO",
      read: true,
      items: "not_open_feature",
      fields: ["content", "create", "criteria", "order", "release", "status", "triage"],
      questions: true,
      sessions: false,
    });
    const picard = agent("Picard");
    const { grants } = await ok(picard, { op: "grants", project: "helix" });
    expect(grants.find((g) => g.agent === "Picard")).toMatchObject({ role: "backlog PO", items: "not_open_feature", sessions: false, questions: true });

    expect((await ok(picard, { op: "create_release", project: "helix", title: "Nightly", goal: "Every day starts green" })).ref).toBe("R3");
    expect((await ok(picard, { op: "create_release", project: "helix", title: "Later" })).ref).toBe("R4");
    await ok(picard, { op: "update_release", project: "helix", ref: "R4", set: { goal: "Not yet placed" } });
    await ok(picard, { op: "order_releases", project: "helix", refs: ["R0", "R1", "R2", "R3", "R4"] });

    await ok(picard, { op: "promote", project: "helix", ref: idea });
    await ok(picard, { op: "set_release", project: "helix", ref: idea, release: "R3" });
    await ok(picard, { op: "set_release", project: "helix", ref: steps, release: "R3" });
    await ok(picard, { op: "set_release", project: "helix", ref: idea, release: "R4" });
    await ok(picard, { op: "set_release", project: "helix", ref: idea, release: null });
    await ok(picard, { op: "set_release", project: "helix", ref: idea, release: "R3" });
    await ok(picard, { op: "order", project: "helix", scope: "features", release: "R3", refs: [idea, steps] });

    await ok(picard, { op: "close_release", project: "helix", ref: "R0", moves: [{ feature: late, to: "R3" }, { feature: later, to: "R4" }] });
    await ok(picard, { op: "reopen_release", project: "helix", ref: "R0", reason: "closed before the review" });
    await ok(picard, { op: "close_release", project: "helix", ref: "R0" });

    const releases = (await ok(picard, { op: "list", project: "helix", of: "releases" })).releases!;
    expect(releases.map((r) => [r.ref, r.title, r.status, r.closed_by])).toEqual([
      ["R0", "Foundations", "closed", "Picard@mbp-1"],
      ["R1", "Roadmap", "planned", null],
      ["R2", "Steps", "planned", null],
      ["R3", "Nightly", "planned", null],
      ["R4", "Later", "planned", null],
    ]);
    const features = async (release: string | null) => ((await ok(picard, { op: "list", project: "helix", of: "features", release })).items ?? []).map((i) => i.ref);
    expect(await features("R0")).toEqual([shipped]);
    expect(await features("R2")).toEqual([]);
    expect(await features("R3")).toEqual([idea, steps, late]);
    expect(await features("R4")).toEqual([later]);
    expect((await ok(picard, { op: "get", project: "helix", ref: "R0", history: true })).history!.map((e) => [e.op, e.actor.who])).toEqual([
      ["create_release", "owner@example.com"],
      ["close_release", "Picard@mbp-1"],
      ["reopen_release", "Picard@mbp-1"],
      ["close_release", "Picard@mbp-1"],
    ]);
  });

  it("leaves the owner all of it", async () => {
    const { r1, f1 } = await organizing();
    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Nightly" })).ref!;
    await ok(owner, { op: "update_release", project: "helix", ref: r2, set: { goal: "Green" } });
    await ok(owner, { op: "order_releases", project: "helix", refs: [r2, r1] });
    const { seq } = await ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: r2 }] });
    await ok(owner, { op: "undo", project: "helix", seq });
    expect((await item(f1)).release).toBe(r1);
    await ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: r2 }] });
    await ok(owner, { op: "reopen_release", project: "helix", ref: r1 });
    expect(await releases()).toEqual([
      [r2, "planned"],
      [r1, "planned"],
    ]);
  });
});

describe("projects (criterion 7)", () => {
  it("shows an agent only the projects it may read; a * row reads them all", async () => {
    await helix();
    await helixRules();
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    await ok(owner, { op: "grant", project: "*", agent: "Mario", role: "lead", read: true, items: "none", fields: [] });

    expect((await ok(agent("Picard"), { op: "projects" })).projects.map((p) => p.key)).toEqual(["helix"]);
    expect(await refused(agent("Picard"), { op: "list", project: "bobnet", of: "backlog" })).toMatchObject({
      code: "forbidden",
      message: "Picard may not read bobnet's board",
    });
    expect(await refused(agent("Picard"), { op: "create", project: "bobnet", kind: "backlog", type: "chore", title: "x" })).toMatchObject({ code: "forbidden" });
    expect((await ok(agent("Mario"), { op: "projects" })).projects.map((p) => p.key)).toEqual(["bobnet", "helix"]);
    expect((await ok(agent("Nobody"), { op: "projects" })).projects).toEqual([]);
  });
});

describe("progress (criterion 5)", () => {
  it("counts acceptance criteria checked of total, per task and per feature across its tasks", async () => {
    const { f1, t1 } = await helix();
    await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "More", parent: f1, criteria: [{ text: "a" }, { text: "done", section: "dod" }] });
    await ok(owner, { op: "criteria", project: "helix", ref: t1, change: { action: "check", n: 2, evidence: "screenshot" } });
    expect((await item(t1)).progress).toEqual({ checked: 1, total: 2 });
    const { items } = await ok(owner, { op: "list", project: "helix", of: "features" });
    expect(items!.find((i) => i.ref === f1)).toMatchObject({ progress: { checked: 1, total: 3 }, tasks: { done: 0, total: 2 } });
  });

  it("counts a feature's own criteria with its tasks', so a feature with no tasks shows its own", async () => {
    const { f1, f2 } = await helix();
    await ok(owner, { op: "criteria", project: "helix", ref: f2, change: { action: "add", text: "Its own" } });
    await ok(owner, { op: "criteria", project: "helix", ref: f2, change: { action: "add", text: "Landed", section: "dod" } });
    await ok(owner, { op: "criteria", project: "helix", ref: f1, change: { action: "add", text: "Its own" } });
    await ok(owner, { op: "criteria", project: "helix", ref: f1, change: { action: "check", n: 1, evidence: "test" } });
    const { items } = await ok(owner, { op: "list", project: "helix", of: "features" });
    expect(items!.find((i) => i.ref === f1)!.progress).toEqual({ checked: 1, total: 3 });
    expect(items!.find((i) => i.ref === f2)!.progress).toEqual({ checked: 0, total: 1 });
    expect((await item(f2)).progress).toEqual({ checked: 0, total: 1 });
  });

  it("gives a feature its own criteria, AC and DoD, beside progress, and a task none (ADR 0014 §3a, BOB-169)", async () => {
    const { r1 } = await helix();
    const f = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Own", release: r1, criteria: [{ text: "a" }, { text: "b" }, { text: "landed", section: "dod" }] })).ref!;
    const t = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "T", parent: f, criteria: [{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }] })).ref!;
    await ok(owner, { op: "criteria", project: "helix", ref: f, change: { action: "check", n: 1, evidence: "test" } });
    const row = async () => (await ok(owner, { op: "list", project: "helix", of: "features" })).items!.find((i) => i.ref === f)!;
    expect(await row()).toMatchObject({ own: { checked: 1, total: 3 }, progress: { checked: 1, total: 6 }, done_at: null });
    await ok(owner, { op: "criteria", project: "helix", ref: f, change: { action: "check", section: "dod", n: 1, evidence: "test" } });
    expect(await row()).toMatchObject({ own: { checked: 2, total: 3 }, progress: { checked: 1, total: 6 } });
    expect((await item(f)).own).toEqual({ checked: 2, total: 3 });
    const tasks = (await ok(owner, { op: "list", project: "helix", of: "tasks", feature: f })).items!;
    expect(tasks.map((i) => i.ref)).toEqual([t]);
    expect("own" in tasks[0]! || "done_at" in tasks[0]!).toBe(false);
  });

  it("gives a Done feature its latest move to Done, and none once moved back (BOB-169)", async () => {
    const { f1, t1 } = await helix();
    const row = async () => (await ok(owner, { op: "list", project: "helix", of: "features" })).items!.find((i) => i.ref === f1)!;
    const set = (status: "Done" | "In Progress") => ok(owner, { op: "update", project: "helix", ref: f1, set: { status } });
    const moves = () =>
      runInDurableObject(board(), (_, state) =>
        state.storage.sql
          .exec<{ at: string }>("SELECT e.at FROM events e JOIN event_changes c ON c.event = e.seq JOIN item_refs r ON r.item = e.pk WHERE e.tbl = 'items' AND r.ref = ? AND c.field = 'status' AND c.new = 'Done' ORDER BY e.seq", f1)
          .toArray()
          .map((r) => r.at),
      );
    expect((await row()).done_at).toBeNull();
    await set("Done");
    expect((await row()).done_at).toBe((await moves())[0]);
    await set("In Progress");
    expect((await row()).done_at).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    await set("Done");
    const [first, done] = await moves();
    expect(done! > first!).toBe(true);
    expect((await row()).done_at).toBe(done);
    await new Promise((r) => setTimeout(r, 5));
    await ok(owner, { op: "update", project: "helix", ref: f1, set: { title: "Renamed later" } });
    expect((await row()).done_at).toBe(done);
    await ok(owner, { op: "update", project: "helix", ref: t1, set: { status: "Done" } });
    expect("done_at" in (await item(t1))).toBe(false);
  });
});

describe("sessions", () => {
  it("opens the feature when a session joins it, and refuses a feature that isn't one", async () => {
    const { f1, t1 } = await helix();
    const first = await join(f1);
    expect(first).toMatchObject({ ref: `${f1} build 1`, created: true });
    expect(await join(f1)).toMatchObject({ created: false });
    const onTask = { feature: t1, kind: "build" as const, label: "1" };
    expect(await refused(sup("Sup", onTask), { op: "session_join", project: "helix", session: onTask })).toMatchObject({ code: "invalid" });
    // No one opens a feature by hand, the owner included.
    expect(await refused(owner, { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "2" } })).toMatchObject({ code: "forbidden" });
    const f = await item(f1);
    expect(f.sessions).toEqual([{ feature: f1, kind: "build", label: "1", started_at: f.open_since, ended_at: null }]);
    expect(await refused(agent("Bill"), { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "2" } })).toMatchObject({ code: "forbidden" });
  });

  it("opens a planned release when its first session starts, as the session's write (board-writes 6)", async () => {
    const { r1, f1, f2 } = await helix();
    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 2" })).ref!;
    const history = async (ref: string) => (await ok(owner, { op: "get", project: "helix", ref, history: true })).history!;
    // A feature in no release opens none.
    await join(f2);
    expect((await ok(owner, { op: "get", project: "helix", ref: r1 })).release!.status).toBe("planned");

    await join(f1);
    expect((await ok(owner, { op: "get", project: "helix", ref: r1 })).release!.status).toBe("open");
    expect((await history(r1)).at(-1)).toMatchObject({
      op: "session_join",
      actor: { kind: "agent", who: "Sup@mbp-1", session: { feature: f1, kind: "build", label: "1" } },
      changes: [{ field: "status", old: "planned", new: "open" }],
    });
    // Once: a second session on it, or on another of its features, writes nothing to the release.
    await join(f1, "2");
    const f3 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "More", release: r1 })).ref!;
    await join(f3);
    expect((await history(r1)).map((e) => e.op)).toEqual(["create_release", "session_join"]);
    expect((await ok(owner, { op: "get", project: "helix", ref: r2 })).release!.status).toBe("planned");
  });

  it("refuses a session on a feature of a closed release, naming undo only while it can be made", async () => {
    const { r1, f1 } = await helix();
    await join(f1);
    const done = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Shipped", release: r1 })).ref!;
    await ok(owner, { op: "update", project: "helix", ref: done, set: { status: "Done" } });
    await ok(owner, { op: "close_release", project: "helix", ref: r1, moves: [{ feature: f1, to: null }] });
    const review = { feature: done, kind: "review" as const, label: "1" };
    const start = () => refused(sup("Sup", review), { op: "session_join", project: "helix", session: review });
    expect(await start()).toEqual({ ok: false, code: "conflict", message: `${done} is in ${r1}, which is closed: a closed release takes no new sessions; undo the close first` });
    expect((await item(done)).sessions).toEqual([]);
    await runInDurableObject(board(), (_, state) => {
      state.storage.sql.exec("UPDATE releases SET closed_at = ? WHERE ref = ?", "2026-01-01T00:00:00.000Z", r1);
    });
    expect(await start()).toMatchObject({ message: `${done} is in ${r1}, which is closed: a closed release takes no new sessions` });
    // Moved out by the close, f1 is in no release and takes sessions.
    expect(await join(f1, "2")).toMatchObject({ created: true });
  });

  it("lets no one set the open feature by hand", async () => {
    const { f1 } = await helix();
    expect(await refused(owner, { op: "update", project: "helix", ref: f1, set: { open_since: "2026-11-14" } as never })).toMatchObject({ code: "invalid" });
  });
});

describe("lists", () => {
  it("filters by status, type, label and text, and pages past 100", async () => {
    const { f1 } = await helix();
    for (let i = 0; i < 105; i++) {
      await ok(owner, { op: "create", project: "helix", kind: "task", type: i % 2 ? "bug" : "task", title: `Task ${i}`, parent: f1, labels: i === 7 ? ["phone"] : [] });
    }
    const list = (extra: object) => ok(owner, { op: "list", project: "helix", of: "tasks", feature: f1, ...extra } as BoardOpInput & { op: "list" });
    const first = await list({});
    expect(first).toMatchObject({ total: 106, cursor: "100" });
    expect(first.items).toHaveLength(100);
    expect((await list({ cursor: "100" })).items).toHaveLength(6);
    expect((await list({ label: "phone" })).items!.map((i) => i.title)).toEqual(["Task 7"]);
    expect((await list({ type: "bug" })).total).toBe(52);
    expect((await list({ text: "task 10" })).items!.map((i) => i.title)).toEqual(["Task 10", "Task 100", "Task 101", "Task 102", "Task 103", "Task 104"]);
    expect((await list({ status: "Done" })).total).toBe(0);
  });
});

// ---------- Step 2: the supervisor's reports, capture, questions and the close ----------

/** The laptop's supervisor speaking for a worker of helix (ADR 0001 §4). */
const sup = (name: string, session: BoardCtx["session"], worker = `w_${name.toLowerCase()}`): Extract<BoardCaller, { kind: "agent" }> => ({
  kind: "agent",
  name,
  laptop: "mbp-1",
  supervisor: true,
  ctx: { worker, role: name.toLowerCase(), project: "helix", session, tasks: [] },
});
/** The supervisor joining a worker into a build session of helix. */
const join = (feature: string, label = "1") => {
  const session = { feature, kind: "build" as const, label };
  return ok(sup("Sup", session), { op: "session_join", project: "helix", session });
};
const at = (min: number) => new Date(Date.UTC(2026, 10, 14, 10, min)).toISOString();
const tokens = (n: number) => ({ input: n, output: n, cache_read: n, cache_write: n });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("the supervisor's operations (ADR 0001 §4, §9, §10)", () => {
  it("joins a session for a worker its spawn declared, with no sessions grant, and only that session", async () => {
    const { f1 } = await helix();
    await helixRules();
    const session = { feature: f1, kind: "build" as const, label: "1" };
    expect(await ok(sup("Bill", session), { op: "session_join", project: "helix", session })).toMatchObject({ created: true });
    expect(await refused(sup("Bill", session), { op: "session_join", project: "helix", session: { ...session, label: "2" } })).toMatchObject({ code: "forbidden" });
    // A peer that isn't the supervisor carries no ctx, so it can't make the supervisor's operations.
    expect(await refused({ ...sup("Bill", session), supervisor: false }, { op: "session_join", project: "helix", session })).toMatchObject({ code: "forbidden" });
    expect(await refused(agent("Picard"), { op: "session_join", project: "helix", session })).toMatchObject({ code: "forbidden" });
  });

  it("records a run once from start to end in tokens, with its session, tasks and context per call", async () => {
    const { f1, t1 } = await helix();
    const session = { feature: f1, kind: "build" as const, label: "1" };
    const bill = sup("Bill", session);
    await ok(bill, { op: "session_join", project: "helix", session });
    const start = { op: "run_start" as const, project: "helix", id: "w_bill", started_at: at(0), session, tasks: [t1, "LAND-99"] };
    expect(await ok(bill, start)).toMatchObject({ unknown_tasks: ["LAND-99"] });
    expect(await ok(bill, start)).toMatchObject({ unknown_tasks: [] });
    const end = { op: "run_end" as const, project: "helix", id: "w_bill", ended_at: at(30), tokens: tokens(100), calls: 3, ctx: [1000, 70000, 0x10000000] };
    const first = await ok(bill, end);
    expect(await ok(bill, { ...end, tokens: tokens(5) })).toMatchObject({ seq: first.seq });

    // Context per call only when asked: an agent's board_get of a session doesn't carry a chart (Toad, BOB-4 review 1).
    const got = await ok(owner, { op: "get", project: "helix", session, history: true });
    expect(got.session).toMatchObject({ tokens: tokens(100), runs: [{ id: "w_bill", agent: "Bill", laptop: "mbp-1", calls: 3, tokens: tokens(100), tasks: [t1], ended_at: at(30), remote_url: null }] });
    expect(got.session!.runs[0]).not.toHaveProperty("ctx");
    expect(got.session!.runs[0]).not.toHaveProperty("cost_usd");
    const charted = await ok(owner, { op: "get", project: "helix", session, ctx: true });
    expect(charted.session!.runs[0]!.ctx).toEqual([1000, 70000, 0x10000000]);
    await runInDurableObject(board(), (_, state) => {
      const blob = state.storage.sql.exec<{ ctx: ArrayBuffer }>("SELECT ctx FROM runs WHERE id = 'w_bill'").one().ctx;
      const view = new DataView(blob);
      expect([0, 1, 2].map((i) => view.getUint32(i * 4, true))).toEqual([1000, 70000, 0x10000000]);
    });
    expect(await refused(bill, { ...end, id: "w_nobody" })).toMatchObject({ code: "forbidden" });
    expect(await refused(sup("Nobody", null), { ...end, id: "w_nobody" })).toMatchObject({ code: "invalid" });
  });

  it("sets a run's Remote Control link once, after its start; never makes a run, and a replay changes nothing (BOB-4)", async () => {
    const { f1 } = await helix();
    const session = { feature: f1, kind: "build" as const, label: "1" };
    const bill = sup("Bill", session);
    await ok(bill, { op: "session_join", project: "helix", session });
    const remote = { op: "run_remote" as const, project: "helix", id: "w_bill", remote_url: "https://claude.ai/code/s_1" };
    // Before its start there's no run to set: nothing is made.
    await ok(bill, remote);
    await runInDurableObject(board(), (_, state) => {
      expect(state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM runs").one().n).toBe(0);
    });
    await ok(bill, { op: "run_start", project: "helix", id: "w_bill", started_at: at(0), session });
    const set = await ok(bill, remote);
    expect(set.seq).toBeGreaterThan(0);
    // A replay, or another link for a run that has one, records nothing.
    expect(await ok(bill, remote)).toMatchObject({ seq: set.seq });
    expect(await ok(bill, { ...remote, remote_url: "https://claude.ai/code/s_2" })).toMatchObject({ seq: set.seq });
    const got = await ok(owner, { op: "get", project: "helix", session, history: true });
    expect(got.session!.runs[0]).toMatchObject({ id: "w_bill", remote_url: "https://claude.ai/code/s_1" });
    expect(await refused(bill, { ...remote, id: "w_other" })).toMatchObject({ code: "forbidden" });
    expect(await refused(owner, remote)).toMatchObject({ code: "forbidden" });
  });

  it("takes the run's worker, agent, role and session from the verified ctx, never from the op", async () => {
    const { f1 } = await helix();
    const session = { feature: f1, kind: "build" as const, label: "1" };
    const bill = sup("Bill", session);
    await ok(bill, { op: "session_join", project: "helix", session });
    const start = { op: "run_start" as const, project: "helix", id: "w_bill", started_at: at(0), session };
    expect(await refused(bill, { ...start, id: "w_other" })).toMatchObject({ code: "forbidden" });
    expect(await refused(bill, { ...start, session: null })).toMatchObject({ code: "forbidden" });
    await ok(bill, start);
    const { session: s } = await ok(owner, { op: "get", project: "helix", session });
    expect(s!.runs[0]).toMatchObject({ id: "w_bill", agent: "Bill", role: "bill" });
    // The same run id from another project's worker is another project's run.
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    const other: BoardCaller = { kind: "agent", name: "Bill", laptop: "mbp-1", supervisor: true, ctx: { worker: "w_bill", role: "b", project: "bobnet", session: null, tasks: [] } };
    expect(await refused(other, { ...start, project: "bobnet", session: null })).toMatchObject({ code: "conflict" });
  });

  it("keeps the supervisor's reports to its laptop's supervisor, for the worker's own project", async () => {
    await helix();
    const start = { op: "run_start" as const, project: "helix", id: "w_x", started_at: at(0), session: null };
    expect(await refused(owner, start)).toMatchObject({ code: "forbidden" });
    expect(await refused({ ...sup("Bill", null), supervisor: false }, start)).toMatchObject({ code: "forbidden" });
    const elsewhere: BoardCaller = { kind: "agent", name: "Bill", laptop: "mbp-1", supervisor: true, ctx: { worker: "w_x", role: "b", project: "bobnet", session: null, tasks: [] } };
    expect(await refused(elsewhere, start)).toMatchObject({ code: "forbidden", message: expect.stringMatching(/not bobnet/) });
  });

  it("records a push once per commit, and a slot run from grant to release with its holder's session and tasks", async () => {
    const { f1, t1 } = await helix();
    const session = { feature: f1, kind: "build" as const, label: "1" };
    const bill = sup("Bill", session);
    await ok(bill, { op: "session_join", project: "helix", session });
    await ok(bill, { op: "run_start", project: "helix", id: "w_bill", started_at: at(0), session, tasks: [t1] });
    const push = { op: "push" as const, project: "helix", repo: "cath42/helix", branch: "main", sha: "abcdef1234567" };
    const pushed = await ok(bill, push);
    expect(await ok(bill, push)).toMatchObject({ seq: pushed.seq });
    const slot = { op: "slot_run" as const, project: "helix", external_id: "s_1", name: "land" };
    await ok(bill, { ...slot, status: "running", started_at: at(1) });
    await ok(bill, { ...slot, status: "passed", ended_at: at(4) });
    await runInDurableObject(board(), (_, state) => {
      const sql = state.storage.sql;
      expect(sql.exec("SELECT status, laptop, started_at, ended_at, session IS NOT NULL AS tied FROM ci_runs").toArray()).toEqual([
        { status: "passed", laptop: "mbp-1", started_at: at(1), ended_at: at(4), tied: 1 },
      ]);
      expect(sql.exec<{ n: number }>("SELECT count(*) AS n FROM ci_run_tasks").one().n).toBe(1);
      expect(sql.exec<{ n: number }>("SELECT count(*) AS n FROM pushes WHERE run IS NOT NULL AND worker = 'w_bill'").one().n).toBe(1);
    });
    // Another laptop's slot run of the same id is not this one's to change.
    const elsewhere = { ...bill, laptop: "mbp-2" };
    expect(await refused(elsewhere, { ...slot, status: "failed" })).toMatchObject({ code: "conflict" });
  });

  it("gives a session its runs' Remote Control and its slot runs, with the usual time once three like it passed (§10)", async () => {
    const { f1 } = await helix();
    const session = { feature: f1, kind: "build" as const, label: "1" };
    const bill = sup("Bill", session);
    await ok(bill, { op: "session_join", project: "helix", session });
    await ok(bill, { op: "run_start", project: "helix", id: "w_bill", started_at: at(0), session, remote_url: "https://claude.ai/code/s_1" });
    const slot = (n: number, status: "passed" | "running", start: number, end?: number) =>
      ok(bill, { op: "slot_run", project: "helix", external_id: `s_${n}`, name: "land", status, started_at: at(start), ...(end === undefined ? {} : { ended_at: at(end) }) });
    await slot(1, "passed", 1, 3);
    await slot(2, "passed", 4, 10);
    const two = (await ok(owner, { op: "get", project: "helix", session, ctx: true })).session!;
    expect(two.runs[0]).toMatchObject({ remote_url: "https://claude.ai/code/s_1", ctx: [] });
    expect(two.ci_runs.map((c) => [c.external_id, c.status, c.usual_ms])).toEqual([["s_1", "passed", null], ["s_2", "passed", null]]);
    await slot(3, "passed", 11, 15);
    await slot(4, "running", 20);
    const four = (await ok(owner, { op: "get", project: "helix", session })).session!;
    expect(four.ci_runs.at(-1)).toMatchObject({ source: "slot", name: "land", laptop: "mbp-1", status: "running", worker: "w_bill", ended_at: null, usual_ms: 4 * 60_000 });
  });
});

describe("capture (ADR 0001 §12)", () => {
  it("lets anyone capture, storing a capture sent twice once, with who captured it", async () => {
    await helix();
    const cap = { op: "capture" as const, project: "helix", capture_id: uuid(1), title: "The chart is slow", casper_words: "it crawls" };
    const first = await ok(agent("Stranger"), cap);
    expect(first).toMatchObject({ duplicate: false, dropped: [] });
    expect(await ok(agent("Stranger"), cap)).toMatchObject({ ref: first.ref, duplicate: true });
    expect(await item(first.ref!)).toMatchObject({ kind: "backlog", type: "task", status: "Draft", captured_by: "Stranger@mbp-1", casper_words: "it crawls" });
    expect((await item(first.ref!)).history.map((e) => e.op)).toEqual(["capture"]);
  });

  it("drops, and names, every link a capture can't keep, refusing only an unknown project", async () => {
    const { r1, f1, t1 } = await helix();
    await ok(owner, { op: "create_release", project: "helix", title: "Release 2" });
    const cap = { op: "capture" as const, project: "helix", title: "Broken", type: "bug" as const };
    const stale = await ok(owner, { ...cap, capture_id: uuid(4), release: "R9", found_in: t1, bug_where: "production", blocks_use: true });
    expect(stale.dropped).toEqual(["release", "found_in"]);
    expect(await item(stale.ref!)).toMatchObject({ release: null, found_in: null, bug_where: "production", blocks_use: true });
    expect((await ok(owner, { ...cap, capture_id: uuid(5), type: "chore", bug_where: "staging", found_in: f1 })).dropped).toEqual(["found_in", "bug_where"]);
    expect((await ok(owner, { ...cap, capture_id: uuid(6), release: r1, found_in: f1 })).dropped).toEqual([]);
    expect(await refused(owner, { ...cap, capture_id: uuid(7), project: "nope" })).toMatchObject({ code: "invalid" });
  });

  it("keeps a capture's release only for someone who may triage, and says when it didn't", async () => {
    const { r1 } = await helix();
    await helixRules();
    expect(await ok(agent("Bill"), { op: "capture", project: "helix", capture_id: uuid(2), title: "x", release: r1 })).toMatchObject({ dropped: ["release"] });
    const picard = await ok(agent("Picard"), { op: "capture", project: "helix", capture_id: uuid(3), title: "y", release: r1 });
    expect(picard.dropped).toEqual([]);
    expect((await item(picard.ref!)).release).toBe(r1);
  });
});

describe("triage (capture 3-5, BOB-8)", () => {
  it("records the session a capture was made in, and Casper's words as given", async () => {
    const { f1 } = await helix();
    await join(f1);
    const session = { feature: f1, kind: "build" as const, label: "1" };
    const words = "The chart is slow on a phone. It took ten seconds this morning.";
    const got = await ok(sup("Data", session), { op: "capture", project: "helix", capture_id: uuid(10), title: "The chart is slow on a phone.", casper_words: words });
    const it_ = await item(got.ref!);
    expect(it_).toMatchObject({ captured_by: "Data@mbp-1", casper_words: words });
    expect(it_.history[0]!.actor).toMatchObject({ who: "Data@mbp-1", session });
  });

  it("lists the backlog with each row's triage fields: when, who, Casper's words, the bug's fields, the hint", async () => {
    const { r1, f1 } = await helix();
    const bug = await ok(agent("Data"), { op: "capture", project: "helix", capture_id: uuid(11), title: "Login fails", type: "bug", bug_where: "production", blocks_use: true, casper_words: "can't log in" });
    await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "task", title: "Hinted", parent_hint: f1, release: r1 });
    const long = "x".repeat(2000);
    const wordy = await ok(agent("Data"), { op: "capture", project: "helix", capture_id: uuid(12), title: "Long", casper_words: long });
    const rows = (await ok(owner, { op: "list", project: "helix", of: "backlog" })).items!;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ ref: bug.ref, type: "bug", captured_by: "Data@mbp-1", casper_words: "can't log in", bug_where: "production", blocks_use: true, release: null });
    expect(rows[0]!.created_at).toMatch(/^\d{4}-/);
    // A row carries only the triage fields it has (Toad, BOB-8 review 4).
    expect(rows[0]).not.toHaveProperty("parent_hint");
    expect(rows[1]).toMatchObject({ title: "Hinted", parent_hint: f1, release: r1 });
    for (const k of ["captured_by", "casper_words", "bug_where", "blocks_use"]) expect(rows[1]).not.toHaveProperty(k);
    // Casper's words are clipped on a row and whole on the item.
    expect(rows[2]!.casper_words).toBe(`${"x".repeat(279)}…`);
    expect((await item(wordy.ref!)).casper_words).toBe(long);
    // A feature's or task's row carries no triage fields.
    const features = (await ok(owner, { op: "list", project: "helix", of: "features" })).items!;
    expect(features[0]).not.toHaveProperty("casper_words");
    expect(features[0]!.created_at).toMatch(/^\d{4}-/);
  });

  it("lets the PO slot, promote, set or clear an item's release, and drop it with a reason, each keeping its id; a builder none of them", async () => {
    const { r1, f1 } = await helix();
    await helixRules();
    const cap = (n: number, title: string) => ok(agent("Data"), { op: "capture", project: "helix", capture_id: uuid(n), title }).then((r) => r.ref!);
    const [a, b, c] = [await cap(20, "Slot me"), await cap(21, "Make me a feature"), await cap(22, "Drop me")];
    const picard = agent("Picard");
    for (const op of [
      { op: "slot", project: "helix", ref: a, feature: f1 },
      { op: "promote", project: "helix", ref: b },
      { op: "update", project: "helix", ref: c, set: { release: r1 } },
      { op: "archive", project: "helix", ref: c, reason: "no" },
    ] as BoardOpInput[]) {
      expect((await refused(agent("Bill"), op)).code).toBe("forbidden");
    }
    await ok(picard, { op: "update", project: "helix", ref: c, set: { release: r1 } });
    expect((await item(c)).release).toBe(r1);
    await ok(picard, { op: "update", project: "helix", ref: c, set: { release: null } });
    expect((await item(c)).release).toBeNull();
    await ok(picard, { op: "slot", project: "helix", ref: a, feature: f1 });
    expect(await item(a)).toMatchObject({ ref: a, kind: "task", parent: f1 });
    await ok(picard, { op: "promote", project: "helix", ref: b });
    expect(await item(b)).toMatchObject({ ref: b, kind: "feature", release: null });
    await ok(picard, { op: "archive", project: "helix", ref: c, reason: "Done elsewhere" });
    expect(await item(c)).toMatchObject({ ref: c, archive_reason: "Done elsewhere" });
    expect((await ok(owner, { op: "list", project: "helix", of: "backlog" })).total).toBe(0);
    expect((await ok(owner, { op: "list", project: "helix", of: "backlog", archived: true })).items!.map((i) => i.ref)).toEqual([c]);
  });

  it("keeps a migrated draft's parent hint and milestone as fields the PO clears or sets (AC 7)", async () => {
    const { r1, f1, f2 } = await helix();
    await helixRules();
    const d = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "task", title: "DRAFT-46", parent_hint: f1, release: r1 })).ref!;
    expect(await item(d)).toMatchObject({ parent_hint: f1, release: r1 });
    await ok(agent("Picard"), { op: "update", project: "helix", ref: d, set: { parent_hint: f2, release: null } });
    expect(await item(d)).toMatchObject({ parent_hint: f2, release: null });
    await ok(agent("Picard"), { op: "update", project: "helix", ref: d, set: { parent_hint: null } });
    expect((await item(d)).parent_hint).toBeNull();
  });
});

describe("questions (ADR 0001 §7)", () => {
  it("asks with options and holds, and records an answer from conversation once, verbatim", async () => {
    const { f1, t1 } = await helix();
    await helixRules();
    expect(await refused(agent("Riker"), { op: "ask", project: "helix", text: "Which?" })).toMatchObject({ code: "forbidden" });
    const q = await ok(agent("Picard"), {
      op: "ask",
      project: "helix",
      text: "Which chart?",
      options: [{ key: "a", text: "Bars", recommended: true }, { key: "b", text: "Lines" }],
      holds: [t1],
      needed_before: { item: f1 },
    });
    expect(q.ref).toBe("Q-1");
    expect((await ok(agent("Picard"), { op: "ask", project: "helix", kind: "action", text: "Rotate the key" })).ref).toBe("A-1");
    expect(await refused(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-1", key: "c", words: "c" })).toMatchObject({ code: "invalid" });
    await ok(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-1", key: "a", words: "Bars, obviously" });
    expect(await refused(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-1", words: "again" })).toMatchObject({ code: "conflict" });
    const { question } = await ok(owner, { op: "get", project: "helix", ref: "Q-1" });
    expect(question).toMatchObject({
      state: "answered",
      holds: [t1],
      needed_before: { item: f1 },
      options: [{ key: "a", recommended: true }, { key: "b", recommended: false }],
      answer: { key: "a", words: "Bars, obviously", by: "Picard@mbp-1", via: "conversation" },
    });
  });

  /** Picard asks Q-1 with two options and A-1, as Helix's lead asks Casper. */
  async function asked() {
    await helix();
    await helixRules();
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars", recommended: true }, { key: "b", text: "Lines" }] });
    await ok(agent("Picard"), { op: "ask", project: "helix", kind: "action", text: "Rotate the key" });
  }

  /** The message to agents an operation that must succeed leaves in its notice (ADR 0009 §1): none when its text goes to nobody. */
  async function sent(caller: BoardCaller, op: BoardOpInput): Promise<Array<{ to: string[]; body: string }>> {
    const reply = await call(caller, op);
    if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
    return textOf(await noticeOf((reply.result as { seq: number }).seq));
  }

  it("takes the owner's answer once, verbatim, and refuses every other role", async () => {
    await asked();
    for (const who of [agent("Picard"), agent("Riker"), agent("Bill")]) {
      expect(await refused(who, { op: "answer_question", project: "helix", ref: "Q-1", key: "a" })).toMatchObject({ code: "forbidden" });
      expect(await refused(who, { op: "mark_done", project: "helix", ref: "A-1" })).toMatchObject({ code: "forbidden" });
    }
    // Recording his answer from conversation is the lead's or PO's (the questions flag), never a builder's (BOB-7 #5).
    expect(await refused(agent("Bill"), { op: "record_answer", project: "helix", ref: "Q-1", key: "a", words: "Bars" })).toMatchObject({ code: "forbidden" });
    expect(await refused(owner, { op: "answer_question", project: "helix", ref: "Q-1" })).toMatchObject({ code: "invalid" });
    expect(await refused(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "c" })).toMatchObject({ code: "invalid" });
    expect(await refused(owner, { op: "answer_question", project: "helix", ref: "A-1", words: "done" })).toMatchObject({ code: "invalid" });
    expect(await refused(owner, { op: "mark_done", project: "helix", ref: "Q-1" })).toMatchObject({ code: "invalid" });

    const words = "Bars,  but  \"stacked\"";
    await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a", words });
    expect(await refused(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "b" })).toMatchObject({ code: "conflict" });
    expect(await refused(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-1", words: "Lines" })).toMatchObject({ code: "conflict" });
    await ok(owner, { op: "mark_done", project: "helix", ref: "A-1", note: "Rotated" });
    expect(await refused(owner, { op: "mark_done", project: "helix", ref: "A-1" })).toMatchObject({ code: "conflict" });

    const q = await ok(owner, { op: "get", project: "helix", ref: "Q-1", history: true });
    expect(q.question).toMatchObject({ state: "answered", answer: { key: "a", words, by: "owner@example.com", via: "dashboard" } });
    expect(q.history!.at(-1)).toMatchObject({ op: "answer_question", actor: { kind: "owner" }, changes: expect.arrayContaining([{ field: "answer_words", old: null, new: words }]) });
    expect((await ok(owner, { op: "get", project: "helix", ref: "A-1" })).question).toMatchObject({ state: "done", answer: { key: null, words: "Rotated", via: "dashboard" } });
  });

  it("sends the answer from BobNet@board to the lead and to whoever asked", async () => {
    await asked();
    await ok(owner, { op: "grant", project: "helix", agent: "Riker", role: "session PO", read: true, items: "open_feature", fields: [], questions: true });
    await ok(agent("Riker"), { op: "ask", project: "helix", text: "Ship it?", options: [{ key: "y", text: "Yes" }] });
    await ok(owner, { op: "ask", project: "helix", text: "Mine?" });

    // Picard is the lead and asked: one recipient. The body names the question, the option and his words.
    const [toLead, ...more] = await sent(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "b", words: "Lines, thin ones" });
    expect(more).toEqual([]);
    expect(toLead!.to).toEqual(["Picard@mbp-1"]);
    expect(toLead!.body).toContain("Q-1");
    expect(toLead!.body).toContain("Which chart?");
    expect(toLead!.body).toContain("b: Lines");
    expect(toLead!.body).toContain("Lines, thin ones");
    // Riker asked: the lead and Riker, in one message.
    expect((await sent(owner, { op: "answer_question", project: "helix", ref: "Q-2", key: "y" }))[0]!.to).toEqual(["Picard@mbp-1", "Riker@mbp-1"]);
    // The owner asked: only the lead.
    expect((await sent(owner, { op: "answer_question", project: "helix", ref: "Q-3", words: "Yes" }))[0]!.to).toEqual(["Picard@mbp-1"]);
    const [done] = await sent(owner, { op: "mark_done", project: "helix", ref: "A-1" });
    expect(done!.body).toContain("A-1");
    expect(done!.body).toContain("done");
    // An answer from conversation is the lead's own record: no message.
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Again?" });
    expect(await sent(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-4", words: "No" })).toEqual([]);
  });

  it("sends an answer from conversation to whoever waits on it, never to the recorder", async () => {
    await asked();
    await ok(owner, { op: "grant", project: "helix", agent: "Riker", role: "session PO", read: true, items: "open_feature", fields: [], questions: true });
    await ok(agent("Riker"), { op: "ask", project: "helix", text: "Ship it?", options: [{ key: "y", text: "Yes" }] });

    // The lead records Casper's answer to Riker's question: Riker hears, the lead doesn't.
    const reply = await call(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-2", key: "y", words: "Ship it Friday" });
    if (!reply.ok) throw new Error(reply.message);
    expect(reply.result).toMatchObject({ told: ["Riker@mbp-1"] });
    const [note, ...more] = textOf(await noticeOf((reply.result as { seq: number }).seq));
    expect(more).toEqual([]);
    expect(note!.to).toEqual(["Riker@mbp-1"]);
    expect(note!.body).toContain("Casper answered Q-2 (helix), in conversation, recorded by Picard@mbp-1: Ship it?");
    expect(note!.body).toContain("Option y: Yes");
    expect(note!.body).toContain("His words: Ship it Friday");
    // Riker records the lead's question: the lead hears.
    const [toLead] = await sent(agent("Riker"), { op: "record_answer", project: "helix", ref: "Q-1", words: "Bars" });
    expect(toLead!.to).toEqual(["Picard@mbp-1"]);
    expect(toLead!.body).toContain("recorded by Riker@mbp-1");
  });

  it("undoes the owner's answer within two minutes: the question reopens, the history keeps it, the lead hears", async () => {
    await asked();
    const { seq } = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a", words: "Bars" });
    expect(await refused(agent("Picard"), { op: "undo", project: "helix", seq })).toMatchObject({ code: "forbidden" });

    const [note] = await sent(owner, { op: "undo", project: "helix", seq });
    expect(note!.to).toEqual(["Picard@mbp-1"]);
    expect(note!.body).toContain("Q-1");
    expect(note!.body).toMatch(/withdr/i);
    const q = await ok(owner, { op: "get", project: "helix", ref: "Q-1", history: true });
    expect(q.question).toMatchObject({ state: "open", answer: null });
    expect(q.history!.map((e) => e.op)).toEqual(["ask", "answer_question", "undo"]);
    expect(q.history![1]!.changes).toContainEqual({ field: "answer_words", old: null, new: "Bars" });
    expect(q.history![2]).toMatchObject({ undo_of: seq, changes: expect.arrayContaining([{ field: "state", old: "answered", new: "open" }, { field: "answer_words", old: "Bars", new: null }]) });

    // Undone once; answered again, and that answer can be undone.
    expect(await refused(owner, { op: "undo", project: "helix", seq })).toMatchObject({ code: "conflict" });
    const again = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "b" });
    expect(await refused(owner, { op: "undo", project: "helix", seq })).toMatchObject({ code: "conflict" });
    await ok(owner, { op: "undo", project: "helix", seq: again.seq });
    const done = await ok(owner, { op: "mark_done", project: "helix", ref: "A-1" });
    await ok(owner, { op: "undo", project: "helix", seq: done.seq });
    expect((await ok(owner, { op: "get", project: "helix", ref: "A-1" })).question).toMatchObject({ state: "open", answer: null });
  });

  it("refuses an undo after two minutes, of another kind of event, or of an answer from conversation", async () => {
    await asked();
    const late = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a" });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 121_000 });
    try {
      expect(await refused(owner, { op: "undo", project: "helix", seq: late.seq })).toMatchObject({ code: "conflict", message: expect.stringMatching(/two minutes/) });
    } finally {
      vi.useRealTimers();
    }
    const asking = await ok(agent("Picard"), { op: "ask", project: "helix", text: "Another?" });
    expect(await refused(owner, { op: "undo", project: "helix", seq: asking.seq })).toMatchObject({ code: "invalid" });
    const said = await ok(agent("Picard"), { op: "record_answer", project: "helix", ref: asking.ref!, words: "Yes" });
    expect(await refused(owner, { op: "undo", project: "helix", seq: said.seq })).toMatchObject({ code: "invalid" });
    expect(await refused(owner, { op: "undo", project: "helix", seq: 9999 })).toMatchObject({ code: "invalid" });
  });

  it("says whom an answer told, and that nobody heard when the project has no lead", async () => {
    await asked();
    expect(await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a" })).toMatchObject({ told: ["Picard@mbp-1"] });
    const done = await ok(owner, { op: "mark_done", project: "helix", ref: "A-1" });
    expect(done.told).toEqual(["Picard@mbp-1"]);
    expect((await ok(owner, { op: "undo", project: "helix", seq: done.seq })).told).toEqual(["Picard@mbp-1"]);
    await ok(owner, { op: "create_project", key: "solo", name: "Solo", prefix: "SOLO" });
    await ok(owner, { op: "ask", project: "solo", text: "Alone?" });
    expect((await ok(owner, { op: "answer_question", project: "solo", ref: "Q-1", words: "Yes" })).told).toEqual([]);
  });

  it("takes a project's lead and PO only as name@laptop, so an answer can reach them", async () => {
    for (const lead of ["Mario", "Mario@", "@mbp-1", "Mario@board", "Mario@BOARD", "Mario@*", "Mario@mbp 1"]) {
      expect(await refused(owner, { op: "create_project", key: "quiz", name: "Quiz", prefix: "QUIZ", lead })).toMatchObject({ code: "invalid" });
      expect(await refused(owner, { op: "create_project", key: "quiz", name: "Quiz", prefix: "QUIZ", po: lead })).toMatchObject({ code: "invalid" });
    }
    await ok(owner, { op: "create_project", key: "quiz", name: "Quiz", prefix: "QUIZ", lead: "Mario@mbp-1", po: null });
  });

  it("refuses a project prefix, or draft prefix, that reads as a question's", async () => {
    expect(await refused(owner, { op: "create_project", key: "quiz", name: "Quiz", prefix: "Q" })).toMatchObject({ code: "invalid" });
    expect(await refused(owner, { op: "create_project", key: "quiz", name: "Quiz", prefix: "QUIZ", draft_prefix: "A" })).toMatchObject({ code: "invalid" });
  });

  it("holds a session once however often the ask names it", async () => {
    const { f1 } = await helix();
    const session = await join(f1).then(() => ({ feature: f1, kind: "build" as const, label: "1" }));
    await ok(owner, { op: "ask", project: "helix", text: "Go?", holds_sessions: [session, session] });
    expect((await ok(owner, { op: "get", project: "helix", ref: "Q-1" })).question!.holds_sessions).toEqual([session]);
  });
});

describe("answer notices (ADR 0009 §1, §3; BOB-111 AC1, AC3)", () => {
  /** Picard, the lead, asks Q-1 holding a feature and its session, and Q-2 holding the same session; and A-1. */
  async function asking() {
    const { f1, t1 } = await helix();
    await helixRules();
    await join(f1);
    const session = { feature: f1, kind: "build" as const, label: "1" };
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars" }], holds: [t1], holds_sessions: [session] });
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Which colour?", holds_sessions: [session] });
    await ok(agent("Picard"), { op: "ask", project: "helix", kind: "action", text: "Rotate the key" });
    return { f1, t1, session };
  }

  it("leaves exactly one notice for each of the four ops, and none for an edit or a refused write", async () => {
    await asking();
    await ok(owner, { op: "grant", project: "helix", agent: "Riker", role: "session PO", read: true, items: "open_feature", fields: [], questions: true });
    const before = await noticeCount();
    const answered = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a" });
    expect(await noticeCount()).toBe(before + 1);
    await ok(owner, { op: "undo", project: "helix", seq: answered.seq });
    expect(await noticeCount()).toBe(before + 2);
    await ok(owner, { op: "mark_done", project: "helix", ref: "A-1", note: "Rotated" });
    expect(await noticeCount()).toBe(before + 3);
    await ok(agent("Riker"), { op: "record_answer", project: "helix", ref: "Q-2", words: "Blue" });
    expect(await noticeCount()).toBe(before + 4);

    await ok(agent("Picard"), { op: "edit_question", project: "helix", ref: "Q-1", set: { text: "Which chart, really?" } });
    expect(await noticeCount()).toBe(before + 4);
    expect(await refused(owner, { op: "answer_question", project: "helix", ref: "Q-2", words: "again" })).toMatchObject({ code: "conflict" });
    expect(await refused(owner, { op: "answer_question", project: "helix", ref: "Q-9", words: "nobody's" })).toMatchObject({ code: "invalid" });
    expect(await noticeCount()).toBe(before + 4);
  });

  it("says what was answered, what it holds and what still holds it, in the text and the supervisor's JSON", async () => {
    const { t1, session } = await asking();
    const { seq } = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a", words: "Bars, thin" });
    const n = (await noticeOf(seq))!;
    expect(n).toMatchObject({ project: "helix", kind: "answer", subject: "Q-1", state: "answered", to: ["Picard@mbp-1"], except: null });
    expect(n.text).toContain(`Holds: ${t1}; session ${session.feature} build 1`);
    expect(n.text).toContain(`Still held by: Q-2 (session ${session.feature} build 1)`);
    expect(n.notice).toEqual({
      v: 2, event: "answer", seq, project: "helix", ref: "Q-1", kind: "question", state: "answered", key: "a", option: "Bars", words: "Bars, thin",
      by: "owner", via: "dashboard", asked_by: "Picard@mbp-1", lead: "Picard@mbp-1",
      holds: { items: [t1], sessions: [session] }, still_held: [{ session, by: ["Q-2"] }], at: expect.any(String),
    });
    // The owner's email is never in a message.
    expect(JSON.stringify(n)).not.toContain("owner@example.com");
    // Q-2 answered after: nothing else holds the session, so no "Still held by".
    const second = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-2", words: "Blue" });
    const n2 = (await noticeOf(second.seq))!;
    expect(n2.text).not.toContain("Still held by");
    expect(n2.notice).toMatchObject({ key: null, option: null, words: "Blue", still_held: [], holds: { items: [], sessions: [session] } });
  });

  it("leaves the recorder out of an answer recorded from conversation, and names it as by", async () => {
    await asking();
    await ok(owner, { op: "grant", project: "helix", agent: "Riker", role: "session PO", read: true, items: "open_feature", fields: [], questions: true });
    const { seq } = await ok(agent("Riker"), { op: "record_answer", project: "helix", ref: "Q-1", key: "a", words: "Bars" });
    expect(await noticeOf(seq)).toMatchObject({ to: ["Picard@mbp-1"], except: "Riker@mbp-1", notice: { by: "Riker@mbp-1", via: "conversation", state: "answered" } });
    // The lead records his own question: its text goes to nobody, the notice is still left for the supervisor.
    const own = await ok(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-2", words: "Blue" });
    expect(await noticeOf(own.seq)).toMatchObject({ to: [], except: "Picard@mbp-1", notice: { by: "Picard@mbp-1" } });
  });

  it("leaves a withdrawn notice for an undo, with what was withdrawn, and a done one for an action", async () => {
    await asking();
    const answered = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a", words: "Bars" });
    const undone = await ok(owner, { op: "undo", project: "helix", seq: answered.seq });
    expect(await noticeOf(undone.seq)).toMatchObject({ state: "withdrawn", notice: { state: "withdrawn", key: "a", option: "Bars", words: "Bars", by: "owner" } });
    const done = await ok(owner, { op: "mark_done", project: "helix", ref: "A-1", note: "Rotated" });
    expect(await noticeOf(done.seq)).toMatchObject({ state: "done", notice: { kind: "action", state: "done", words: "Rotated", key: null } });
    // The owner asked: asked_by is his email, so the JSON has none.
    await ok(owner, { op: "ask", project: "helix", text: "Mine?" });
    const mine = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-3", words: "Yes" });
    expect((await noticeOf(mine.seq))!.notice.asked_by).toBeNull();
  });

  it("hands out untaken notices oldest first, and prunes taken ones after 30 days", async () => {
    await asking();
    const a = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a" });
    const b = await ok(owner, { op: "answer_question", project: "helix", ref: "Q-2", words: "Blue" });
    expect(((await board().notices()) as unknown as NoticeRow[]).map((n) => n.seq)).toEqual([a.seq, b.seq]);
    await board().noticesTaken([a.seq]);
    expect(((await board().notices()) as unknown as NoticeRow[]).map((n) => n.seq)).toEqual([b.seq]);
    expect(await noticeCount()).toBe(2);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31 * 24 * 60 * 60 * 1000 });
    try {
      await board().noticesTaken([b.seq]);
    } finally {
      vi.useRealTimers();
    }
    // a went, taken 31 days before; b, just taken, stays.
    expect(await noticeCount()).toBe(1);
    expect(await board().notices()).toEqual([]);
  });
});

describe("operation keys (ADR 0001 §12)", () => {
  const keyed = async (caller: BoardCaller, op: BoardOpInput, key: string) => (await board().apply(caller, op, key)) as unknown as BoardReply;
  const backlog = async () => (await ok(owner, { op: "list", project: "helix", of: "backlog" })).total;

  it("writes a keyed write once, and answers its repeat with the first reply", async () => {
    await helix();
    const create = { op: "create", project: "helix", kind: "backlog", type: "bug", title: "Slow chart" } as const;
    const first = await keyed(owner, create, "k-1");
    expect(first).toMatchObject({ ok: true, result: { ref: expect.any(String) } });
    expect(await keyed(owner, create, "k-1")).toEqual(first);
    expect(await backlog()).toBe(1);
    // Without a key, a write is made as often as it is sent.
    await ok(owner, create);
    expect(await backlog()).toBe(2);
  });

  it("replays an answer's reply, and leaves its notice once (ADR 0009 §1)", async () => {
    await helix();
    await helixRules();
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars" }] });
    const answer = { op: "answer_question", project: "helix", ref: "Q-1", key: "a" } as const;
    const first = await keyed(owner, answer, "k-2");
    expect(first).toMatchObject({ ok: true, result: { told: ["Picard@mbp-1"] } });
    expect(await noticeCount()).toBe(1);
    expect(await keyed(owner, answer, "k-2")).toEqual(first);
    expect(await noticeCount()).toBe(1);
    // A new key is a new answer, which is written once.
    expect(await keyed(owner, answer, "k-3")).toMatchObject({ ok: false, code: "conflict" });
  });

  it("refuses a key used by another actor or for another op", async () => {
    await helix();
    await helixRules();
    await keyed(owner, { op: "create", project: "helix", kind: "backlog", type: "bug", title: "One" }, "k-4");
    expect(await keyed(agent("Picard"), { op: "create", project: "helix", kind: "backlog", type: "bug", title: "One" }, "k-4")).toMatchObject({ ok: false, code: "invalid" });
    expect(await keyed(owner, { op: "create_release", project: "helix", title: "R2" }, "k-4")).toMatchObject({ ok: false, code: "invalid" });
    expect(await backlog()).toBe(1);
  });

  it("keeps no key for a refused write, and forgets keys after a day", async () => {
    await helix();
    const bad = { op: "create", project: "helix", kind: "task", type: "task", title: "Orphan", parent: "LAND-99" } as const;
    expect(await keyed(owner, bad, "k-5")).toMatchObject({ ok: false, code: "invalid" });
    expect(await keyed(owner, bad, "k-5")).toMatchObject({ ok: false, code: "invalid" });
    await runInDurableObject(board(), (_, state) => {
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM op_keys WHERE key = 'k-5'").one().n).toBe(0);
    });

    const create = { op: "create", project: "helix", kind: "backlog", type: "bug", title: "Again" } as const;
    await keyed(owner, create, "k-6");
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 25 * 60 * 60 * 1000 });
    try {
      await keyed(owner, create, "k-6");
    } finally {
      vi.useRealTimers();
    }
    expect(await backlog()).toBe(2);
  });
});

describe("close_session (ADR 0001 §6)", () => {
  async function closing() {
    const ids = await helix();
    await helixRules();
    const session = { feature: ids.f1, kind: "build" as const, label: "1" };
    const bill = sup("Bill", session);
    await ok(bill, { op: "session_join", project: "helix", session });
    await ok(bill, { op: "run_start", project: "helix", id: "w_bill", started_at: at(0), session });
    await ok(bill, { op: "run_end", project: "helix", id: "w_bill", ended_at: at(9), tokens: tokens(10), calls: 1 });
    const riker = sup("Riker", session);
    return { ...ids, session, riker };
  }
  const close = (session: SessionRef) => ({
    op: "close_session" as const,
    project: "helix",
    session,
    need: "none" as const,
    summary: "Built the roadmap",
    handoff: { path: "/state/h.md", text: "# Handoff\nDone." },
  });

  it("applies its moves tagged with the session, reads tasks moved from the log, sums tokens, and clears the open feature", async () => {
    const { f1, t1, session, riker } = await closing();
    await ok(riker, { op: "update", project: "helix", ref: t1, set: { status: "In Progress" } });
    const closed = await ok(riker, { ...close(session), moves: [{ task: t1, status: "In Review" }], minors_fixed: 2, commit: "abc1234" });
    expect(closed).toMatchObject({ ref: `${f1} build 1`, tasks_moved: [{ task: t1, status: "In Review" }], tokens: tokens(10) });
    expect((await item(f1)).open_since).toBeNull();
    expect((await item(t1)).history.at(-1)).toMatchObject({ actor: { session }, reason: `${f1} build 1 closed` });
    const { session: s } = await ok(owner, { op: "get", project: "helix", session });
    expect(s).toMatchObject({ ended_at: expect.any(String), close: { need: "none", minors_fixed: 2, commit: "abc1234", handoff_text: "# Handoff\nDone.", closed_by: "Riker@mbp-1" } });
    expect(await refused(riker, close(session))).toMatchObject({ code: "conflict" });
    expect(await refused(sup("Bill", session), { op: "session_join", project: "helix", session })).toMatchObject({ code: "conflict" });
  });

  it("needs the sessions grant, the questions it waits on, and findings that are the feature's tasks", async () => {
    const { t2, session, riker } = await closing();
    expect(await refused(sup("Bill", session), close(session))).toMatchObject({ code: "forbidden" });
    expect(await refused(agent("Picard"), { ...close(session), need: "casper" })).toMatchObject({ code: "invalid" });
    expect(await refused(agent("Picard"), { ...close(session), blockers: [t2] })).toMatchObject({ code: "invalid", message: expect.stringMatching(/isn't a task of/) });
    // A move the closer may not make refuses the whole close.
    expect(await refused(riker, { ...close(session), moves: [{ task: t2, status: "Done" }] })).toMatchObject({ code: "forbidden" });
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Ship?" });
    expect(await refused(agent("Picard"), { ...close(session), need: "answer", waits_on: ["Q-1"] })).toMatchObject({ code: "invalid" });
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Answered?" });
    await ok(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-2", words: "yes" });
    expect(await refused(agent("Picard"), { ...close(session), need: "casper", waits_on: ["Q-2"] })).toMatchObject({ code: "invalid", message: /Q-2 is answered/ });
    await ok(agent("Picard"), { ...close(session), need: "casper", waits_on: ["Q-1"] });
    const { session: s } = await ok(owner, { op: "get", project: "helix", session });
    expect(s!.close).toMatchObject({ need: "casper", waits_on: ["Q-1"] });
  });
});

describe("bugs (BOB-10, bugs.md)", () => {
  const NO_LONGER = { section: "ac", n: 1, text: "It no longer happens", state: "open", evidence: null };

  it("captures a bug in one call: what happened, where, the feature it was found in, with its one criterion (bugs.md 1)", async () => {
    const { f1 } = await helix();
    const got = await ok(agent("Data"), {
      op: "capture", project: "helix", capture_id: uuid(30), title: "Login fails on a phone", description: "Twice today, on production.", type: "bug", bug_where: "production", found_in: f1,
    });
    expect(got.dropped).toEqual([]);
    const bug = await item(got.ref!);
    expect(bug).toMatchObject({ kind: "backlog", type: "bug", status: "Draft", description: "Twice today, on production.", bug_where: "production", found_in: f1, blocks_use: false });
    expect(bug.criteria).toMatchObject([NO_LONGER]);
    // It waits in the triage list, marked as a bug (bugs.md 2).
    expect((await ok(owner, { op: "list", project: "helix", of: "backlog", type: "bug" })).items!.map((i) => [i.ref, i.type, i.bug_where])).toEqual([[got.ref, "bug", "production"]]);
    // A bug made with its own criteria keeps them as given.
    const own = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "bug", title: "Slow chart", criteria: [{ text: "Loads in 2 s" }] })).ref!;
    expect((await item(own)).criteria.map((c) => c.text)).toEqual(["Loads in 2 s"]);
  });

  it("gives an item that becomes a bug the criterion only when it has none", async () => {
    const { t1, t2 } = await helix();
    await ok(owner, { op: "update", project: "helix", ref: t2, set: { type: "bug" } });
    expect((await item(t2)).criteria).toMatchObject([NO_LONGER]);
    expect((await item(t2)).history.at(-1)!.changes).toContainEqual({ field: "ac #1", old: null, new: "It no longer happens" });
    await ok(owner, { op: "update", project: "helix", ref: t1, set: { type: "bug" } });
    expect((await item(t1)).criteria.map((c) => c.text)).toEqual(["Drawn", "Shown"]);
    // A Done item doesn't become a bug, open criterion and all (Toad, BOB-10 review 2); a new capture is the bug.
    const done = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "chore", title: "Tidied" })).ref!;
    await ok(owner, { op: "update", project: "helix", ref: done, set: { status: "Done" } });
    expect(await refused(owner, { op: "update", project: "helix", ref: done, set: { type: "bug" } })).toMatchObject({ code: "conflict", message: expect.stringContaining("found_in") });
    const chore = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "chore", title: "Tidy" })).ref!;
    expect(await refused(owner, { op: "update", project: "helix", ref: chore, set: { type: "bug", status: "Done" } })).toMatchObject({ code: "conflict" });
    expect((await item(done)).type).toBe("chore");
  });

  it("closes a bug only once every criterion is checked with evidence; without a fix, by archiving it with a reason (bugs.md 4)", async () => {
    const { f1, t1 } = await helix();
    await helixRules();
    const picard = agent("Picard");
    const bug = (await ok(agent("Data"), { op: "capture", project: "helix", capture_id: uuid(31), title: "Crashes", type: "bug" })).ref!;
    await ok(picard, { op: "slot", project: "helix", ref: bug, feature: f1 });
    const done = { op: "update", project: "helix", ref: bug, set: { status: "Done" } } as const;
    expect(await refused(picard, done)).toMatchObject({ code: "conflict", message: expect.stringMatching(/is a bug: it is Done once its fix has landed .*archive it with a reason$/) });
    expect((await refused(picard, { op: "criteria", project: "helix", ref: bug, change: { action: "check", n: 1 } } as BoardOpInput)).code).toBe("invalid");
    await ok(picard, { op: "criteria", project: "helix", ref: bug, change: { action: "check", n: 1, evidence: "Fixed in 0b8a185, landed on v2; no crash in 20 tries" } });
    await ok(picard, done);
    expect(await item(bug)).toMatchObject({ status: "Done", criteria: [{ state: "checked", evidence: "Fixed in 0b8a185, landed on v2; no crash in 20 tries" }] });
    // Every criterion, not only the first.
    await ok(owner, { op: "update", project: "helix", ref: t1, set: { type: "bug" } });
    await ok(picard, { op: "criteria", project: "helix", ref: t1, change: { action: "check", n: 1, evidence: "seen" } });
    expect((await refused(picard, { op: "update", project: "helix", ref: t1, set: { status: "Done" } })).code).toBe("conflict");
    // Nor made Done in one write: with the type, or at birth.
    const t3 = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Plain", parent: f1 })).ref!;
    expect((await refused(owner, { op: "update", project: "helix", ref: t3, set: { type: "bug", status: "Done" } })).code).toBe("conflict");
    expect((await item(t3)).criteria).toEqual([]);
    expect((await refused(owner, { op: "create", project: "helix", kind: "backlog", type: "bug", title: "Gone", status: "Done" })).code).toBe("conflict");
    // Without a fix: archive, which takes a reason.
    const wontfix = (await ok(agent("Data"), { op: "capture", project: "helix", capture_id: uuid(32), title: "Odd font", type: "bug" })).ref!;
    expect((await refused(picard, { op: "archive", project: "helix", ref: wontfix } as BoardOpInput)).code).toBe("invalid");
    await ok(picard, { op: "archive", project: "helix", ref: wontfix, reason: "Works as designed" });
    expect(await item(wontfix)).toMatchObject({ archive_reason: "Works as designed" });
  });

  it("keeps a bug that blocks use on what waits on Casper until it is slotted or closed (bugs.md 3)", async () => {
    const { f1 } = await helix();
    await helixRules();
    const picard = agent("Picard");
    const cap = async (n: number) => (await ok(agent("Data"), { op: "capture", project: "helix", capture_id: uuid(n), title: `Blocks ${n}`, type: "bug", blocks_use: true, bug_where: "staging" })).ref!;
    const [a, b, c] = [await cap(33), await cap(34), await cap(35)];
    const bugs = async () => (await ok(owner, { op: "waits" })).waits.filter((w) => w.kind === "bug").map((w) => w.ref);
    expect(await bugs()).toEqual([a, b, c]);
    await ok(picard, { op: "slot", project: "helix", ref: a, feature: f1 });
    await ok(picard, { op: "criteria", project: "helix", ref: b, change: { action: "check", n: 1, evidence: "landed abc1234" } });
    await ok(picard, { op: "update", project: "helix", ref: b, set: { status: "Done" } });
    expect(await bugs()).toEqual([c]);
    await ok(picard, { op: "archive", project: "helix", ref: c, reason: "duplicate of " + a });
    expect(await bugs()).toEqual([]);
  });
});

describe("the views' reads: waits, overview, the roadmap's counts (ADR 0001 §7, design/BOB-1/spec.md)", () => {
  const waits = (caller: BoardCaller = owner, extra: Partial<{ project: string; since: string }> = {}) => ok(caller, { op: "waits", ...extra });

  it("lists what waits on Casper, oldest first, blocking when it holds up a named task, session or feature", async () => {
    const { r1, f1, f2, t1, t2 } = await helix();
    await helixRules();
    const picard = agent("Picard");
    await ok(picard, { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars" }, { key: "b", text: "Lines", recommended: true }], holds: [t1] });
    await ok(picard, { op: "ask", project: "helix", kind: "action", text: "Add the token", needed_before: { release: r1 } });
    await ok(picard, { op: "ask", project: "helix", text: "Ship it?" });
    const session = { feature: f2, kind: "build" as const, label: "1" };
    await join(f2);
    await ok(picard, { op: "close_session", project: "helix", session, need: "casper", waits_on: ["Q-2"], summary: "Waits", handoff: { path: "/h.md", text: "h" } });
    await ok(owner, { op: "criteria", project: "helix", ref: t2, change: { action: "add", text: "Casper accepts", casper_gate: true } });
    await ok(owner, { op: "update", project: "helix", ref: t2, set: { status: "In Review" } });
    const bug = (await ok(agent("Bill"), { op: "capture", project: "helix", capture_id: uuid(1), title: "Crashes", type: "bug", blocks_use: true, found_in: f1 })).ref!;
    await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "bug", title: "Typo" });

    const { waits: list } = await waits();
    expect(list.map((w) => [w.kind, w.ref, w.blocking])).toEqual([
      ["question", "Q-1", true],
      ["action", "A-1", false],
      ["question", "Q-2", true],
      ["review_gate", t2, true],
      ["bug", bug, true],
    ]);
    expect(list[0]).toMatchObject({ project: "helix", feature: f1, text: "Which chart?", recommended: { key: "b", text: "Lines" }, holds: { items: [t1], sessions: [] }, asked_by: "Picard@mbp-1" });
    expect(list[1]).toMatchObject({ needed_before: { release: r1 }, feature: null });
    // The session closed on Q-2 is on it, not a second item (notes 23).
    expect(list[2]).toMatchObject({ waiting_sessions: [session], feature: f2 });
    expect(list[3]).toMatchObject({ feature: f2, text: "Count it", holds: { items: [t2], sessions: [] }, asked_by: null });
    expect(list[4]).toMatchObject({ feature: f1, asked_by: "Bill@mbp-1" });

    // An answer, a ticked gate or an archived bug leaves the list: it keeps no state of its own.
    await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "b", words: "Lines, thin" });
    await ok(owner, { op: "criteria", project: "helix", ref: t2, change: { action: "check", n: 1, evidence: "seen" } });
    await ok(owner, { op: "archive", project: "helix", ref: bug, reason: "fixed" });
    const after = await waits();
    expect(after.waits.map((w) => w.ref)).toEqual(["A-1", "Q-2"]);
    expect(after.answered).toEqual([{ project: "helix", ref: "Q-1", kind: "question", text: "Which chart?", key: "b", words: "Lines, thin", at: expect.any(String) }]);
    // His day starts where the dashboard says it does.
    expect((await waits(owner, { since: new Date(Date.now() + 60_000).toISOString() })).answered).toEqual([]);
    // An answer from conversation isn't "from here".
    await ok(picard, { op: "record_answer", project: "helix", ref: "Q-2", words: "Yes" });
    expect((await waits()).answered.map((a) => a.ref)).toEqual(["Q-1"]);
  });

  it("carries a question's or action's context whole; none or blank is null, and a review gate's and a bug's are null (BOB-31)", async () => {
    const { t2 } = await helix();
    await helixRules();
    const picard = agent("Picard");
    const context = `First line.\nSecond line.\n${"x".repeat(16 * 1024 - 30)}`;
    await ok(picard, { op: "ask", project: "helix", text: "Which chart?", context });
    await ok(picard, { op: "ask", project: "helix", kind: "action", text: "Add the token", context: "On the vault." });
    await ok(picard, { op: "ask", project: "helix", text: "Ship it?" });
    await ok(picard, { op: "ask", project: "helix", text: "Blank?", context: "  \n " });
    await ok(owner, { op: "criteria", project: "helix", ref: t2, change: { action: "add", text: "Casper accepts", casper_gate: true } });
    await ok(owner, { op: "update", project: "helix", ref: t2, set: { status: "In Review" } });
    await ok(agent("Bill"), { op: "capture", project: "helix", capture_id: uuid(7), title: "Crashes", type: "bug", blocks_use: true });
    const { waits: list } = await waits();
    expect(list.map((w) => [w.ref, w.context])).toEqual([
      ["Q-1", context],
      ["A-1", "On the vault."],
      ["Q-2", null],
      ["Q-3", null],
      [t2, null],
      [expect.any(String), null],
    ]);
    expect(list.map((w) => w.kind)).toEqual(["question", "action", "question", "question", "review_gate", "bug"]);
  });

  it("covers the projects the caller reads, or the one it names", async () => {
    await helix();
    await helixRules();
    await ok(owner, { op: "create_project", key: "solo", name: "Solo", prefix: "SOLO" });
    await ok(owner, { op: "ask", project: "solo", text: "Alone?" });
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Ship?" });
    expect((await waits()).waits.map((w) => w.project).sort()).toEqual(["helix", "solo"]);
    expect((await waits(owner, { project: "helix" })).waits.map((w) => w.project)).toEqual(["helix"]);
    expect((await waits(agent("Bill"))).waits.map((w) => w.project)).toEqual(["helix"]);
    expect(await waits(agent("Nobody"))).toEqual({ waits: [], answered: [] });
    expect(await refused(agent("Bill"), { op: "waits", project: "solo" })).toMatchObject({ code: "forbidden" });
    expect((await ok(agent("Bill"), { op: "overview" })).projects.map((p) => p.project.key)).toEqual(["helix"]);
  });

  it("gives each project's overview row: its open release, open features, next Ready one, first wait and backlog", async () => {
    const { r1, f1, f2 } = await helix();
    await helixRules();
    const r0 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 0" })).ref!;
    await ok(owner, { op: "order_releases", project: "helix", refs: [r0, r1] });
    await ok(owner, { op: "close_release", project: "helix", ref: r0 });
    await runInDurableObject(board(), (_, state) => {
      state.storage.sql.exec("UPDATE releases SET status = 'open' WHERE ref = ?", r1);
    });
    const ready = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Later", release: r1 })).ref!;
    await ok(owner, { op: "update", project: "helix", ref: ready, set: { status: "Ready" } });
    await ok(owner, { op: "update", project: "helix", ref: f2, set: { status: "Ready" } });
    // An open feature keeps its Ready status; it is open now, not next.
    await ok(owner, { op: "update", project: "helix", ref: f1, set: { status: "Ready" } });
    await join(f1);
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Later?" });
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Now?", holds: [f1] });
    await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "bug", title: "Crash", release: r1 });
    await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "chore", title: "Tidy" });

    const [row, ...rest] = (await ok(owner, { op: "overview" })).projects;
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      project: { key: "helix", lead: "Picard@mbp-1" },
      release: { ref: r1, status: "open", features: { done: 0, total: 2 }, backlog: { items: 1, bugs: 1, oldest: expect.any(String) } },
      release_number: 2,
      open: [{ ref: f1, open_since: expect.any(String) }],
      // The open release's Ready feature comes before one in no release.
      next_ready: { ref: ready },
      waits_on_you: "Q-2",
      backlog: { items: 2, bugs: 1 },
      // The roadmap's "Not in a release" counts line: the chore, not the bug in R1.
      no_release: { items: 1, bugs: 0, oldest: expect.any(String) },
    });
    // A Done feature whose session is still open isn't open now (notes 15).
    await ok(owner, { op: "update", project: "helix", ref: f1, set: { status: "Done" } });
    expect((await ok(owner, { op: "overview", project: "helix" })).projects[0]!.open).toEqual([]);
    // A Done feature with criteria not ticked reads from its progress; no flag of its own.
    expect((await ok(owner, { op: "list", project: "helix", of: "releases" })).releases!.map((r) => r.backlog)).toEqual([
      { items: 0, bugs: 0, oldest: null },
      { items: 1, bugs: 1, oldest: expect.any(String) },
    ]);
    // A Done bug is still a backlog item, but not an open bug.
    await runInDurableObject(board(), (_, state) => {
      state.storage.sql.exec("UPDATE items SET status = 'Done' WHERE title = 'Crash'");
    });
    expect((await ok(owner, { op: "overview", project: "helix" })).projects[0]!.backlog).toMatchObject({ items: 2, bugs: 0 });
  });
});

describe("editing an open question or action (BOB-119)", () => {
  const edit = (caller: BoardCaller, ref: string, set: Extract<BoardOpInput, { op: "edit_question" }>["set"], reason?: string) =>
    call(caller, { op: "edit_question", project: "helix", ref, set, ...(reason ? { reason } : {}) });
  const question = async (ref: string) => (await ok(owner, { op: "get", project: "helix", ref, history: true })) as Required<Pick<BoardResults["get"], "question" | "history">>;
  const edits = async (ref: string) => (await question(ref)).history.filter((e) => e.op === "question_edited");

  /** Helix's rules, and Data, who may ask but isn't admin; Data asks Q-1 with two options. */
  async function asked() {
    const ids = await helix();
    await helixRules();
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "engineer", read: true, items: "none", fields: [], questions: true });
    await ok(agent("Data"), { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars", recommended: true }, { key: "b", text: "Lines" }] });
    return ids;
  }

  it("lets its asker and an admin edit it, and refuses anyone else (AC 1)", async () => {
    await asked();
    expect(await ok(agent("Data"), { op: "edit_question", project: "helix", ref: "Q-1", set: { text: "Which chart, for the roadmap?" } })).toMatchObject({ ref: "Q-1" });
    // Picard is the project's admin; the owner is admin everywhere.
    await ok(agent("Picard"), { op: "edit_question", project: "helix", ref: "Q-1", set: { context: "The roadmap's chart." } });
    await ok(owner, { op: "edit_question", project: "helix", ref: "Q-1", set: { needed_before: { text: "the demo" } } });
    // Riker may write the open feature and close sessions, but didn't ask it and isn't admin; Bill only reads.
    for (const who of ["Riker", "Bill"]) {
      expect(await refused(agent(who), { op: "edit_question", project: "helix", ref: "Q-1", set: { text: "Mine now" } })).toEqual({
        ok: false,
        code: "forbidden",
        message: `${who} may not edit Q-1 in helix; its asker, Data@mbp-1, or an admin may`,
      });
    }
    expect((await question("Q-1")).question).toMatchObject({ text: "Which chart, for the roadmap?", context: "The roadmap's chart.", needed_before: { text: "the demo" } });
    expect(await edits("Q-1")).toHaveLength(3);
  });

  it("refuses an answered, done or withdrawn one as not_open, and changes nothing (AC 2)", async () => {
    await asked();
    await ok(agent("Data"), { op: "ask", project: "helix", kind: "action", text: "Rotate the key" });
    await ok(agent("Data"), { op: "ask", project: "helix", text: "Ship it?" });
    await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a" });
    await ok(owner, { op: "mark_done", project: "helix", ref: "A-1" });
    await runInDurableObject(board(), (_, state) => {
      state.storage.sql.exec("UPDATE questions SET state = 'withdrawn' WHERE ref = 'Q-2'");
    });
    for (const [ref, state] of [["Q-1", "answered"], ["A-1", "done"], ["Q-2", "withdrawn"]] as const) {
      const before = await question(ref);
      expect(await edit(agent("Data"), ref, { text: "Changed" })).toMatchObject({ ok: false, code: "conflict", message: expect.stringMatching(new RegExp(`^not_open: ${ref} is ${state}`)) });
      expect(await edit(owner, ref, { holds: ["LAND-1"] })).toMatchObject({ ok: false, code: "conflict", message: expect.stringMatching(/^not_open/) });
      expect(await question(ref)).toEqual(before);
    }
  });

  it("loses to an answer that lands after its read: the open check is the UPDATE's, and nothing is written (AC 2)", async () => {
    const { t1 } = await asked();
    await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "b", words: "Lines" });
    const before = await question("Q-1");
    // The edit read Q-1 while it was still open; the answer landed between that read and its write.
    const reply = await runInDurableObject(board(), async (instance) => {
      const store = (instance as unknown as { store: { question: (...a: unknown[]) => Record<string, unknown> } }).store;
      const read = store.question.bind(store);
      store.question = (...a: unknown[]) => ({ ...read(...a), state: "open" });
      try {
        return (await instance.apply(agent("Data"), { op: "edit_question", project: "helix", ref: "Q-1", set: { text: "Too late", holds: [t1], options: [{ key: "a", text: "Bars" }, { key: "b", text: "Thin lines" }] } })) as unknown as BoardReply;
      } finally {
        store.question = read;
      }
    });
    expect(reply).toMatchObject({ ok: false, code: "conflict", message: expect.stringMatching(/^not_open: Q-1 is answered/) });
    expect(await question("Q-1")).toEqual(before);
    expect(before.question).toMatchObject({ state: "answered", text: "Which chart?", holds: [], answer: { key: "b", words: "Lines" } });
  });

  it("keeps option keys: their text may change and options may be added; a lost or renamed key is refused, changing nothing (AC 3)", async () => {
    await asked();
    await ok(agent("Data"), { op: "edit_question", project: "helix", ref: "Q-1", set: { options: [{ key: "a", text: "Stacked bars", recommended: true }, { key: "b", text: "Lines" }, { key: "c", text: "A table" }] } });
    const kept = await question("Q-1");
    expect(kept.question.options).toEqual([
      { key: "a", text: "Stacked bars", recommended: true },
      { key: "b", text: "Lines", recommended: false },
      { key: "c", text: "A table", recommended: false },
    ]);
    // b renamed to l, and c dropped: both lose a key.
    for (const options of [[{ key: "a", text: "Bars" }, { key: "l", text: "Lines" }, { key: "c", text: "A table" }], [{ key: "a", text: "Bars" }, { key: "b", text: "Lines" }]]) {
      expect(await edit(agent("Data"), "Q-1", { text: "Also changed", options })).toMatchObject({ ok: false, code: "invalid", message: expect.stringMatching(/^An option's key stays once set: Q-1 would lose (b|c)/) });
    }
    expect(await edit(agent("Data"), "Q-1", { options: [{ key: "a", text: "x" }, { key: "a", text: "y" }, { key: "b", text: "z" }, { key: "c", text: "w" }] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await question("Q-1")).toEqual(kept);
    // An answer still takes the keys it had.
    await ok(owner, { op: "answer_question", project: "helix", ref: "Q-1", key: "a" });
  });

  it("refuses options on an action, asked or edited, and says to ask a question instead; one that has them keeps them (ADR 0001 §7, BOB-187)", async () => {
    await asked();
    const options = [{ key: "a", text: "A cron entry" }, { key: "b", text: "By hand" }];
    const said = { ok: false, code: "invalid", message: expect.stringMatching(/^An action has no options.*Ask a question instead/) };
    expect(await call(agent("Data"), { op: "ask", project: "helix", kind: "action", text: "Run the checks", options })).toMatchObject(said);
    expect((await ok(agent("Data"), { op: "ask", project: "helix", kind: "action", text: "Run the checks", options: [] })).ref).toBe("A-1");
    const before = await question("A-1");
    expect(await edit(agent("Data"), "A-1", { text: "Run the checks by hand", options })).toMatchObject(said);
    expect(await question("A-1")).toEqual(before);
    // Without options the edit goes; a question's options are as they were.
    expect(await edit(agent("Data"), "A-1", { text: "Run the checks by hand", options: [] })).toMatchObject({ ok: true });
    expect(await edit(agent("Data"), "Q-1", { options: [{ key: "a", text: "Bars", recommended: true }, { key: "b", text: "Lines" }, { key: "c", text: "A table" }] })).toMatchObject({ ok: true });
    // One filed with options before this: they stand, can't be changed, and it is marked done as any.
    await runInDurableObject(board(), (_instance, ctx) => {
      ctx.storage.sql.exec("INSERT INTO question_options (question, ord, key, text, recommended) SELECT pk, 1, 'a', 'A cron entry', 1 FROM questions WHERE ref = 'A-1'");
    });
    expect((await question("A-1")).question.options).toEqual([{ key: "a", text: "A cron entry", recommended: true }]);
    expect(await edit(agent("Data"), "A-1", { options: [{ key: "a", text: "Cron" }] })).toMatchObject(said);
    expect(await edit(agent("Data"), "A-1", { text: "Run them" })).toMatchObject({ ok: true });
    expect(await call(owner, { op: "mark_done", project: "helix", ref: "A-1", note: "a" })).toMatchObject({ ok: true });
  });

  it("checks new holds and needed-before as an ask does, and Waits follows: the A-24 case turns blocking (AC 4)", async () => {
    const { r1, f2, t1 } = await asked();
    await join(f2);
    // As helix A-24 was asked: needed before, holding nothing.
    await ok(agent("Data"), { op: "ask", project: "helix", kind: "action", text: "Book the room", needed_before: { item: f2 } });
    const wait = async (ref: string) => (await ok(owner, { op: "waits" })).waits.find((w) => w.ref === ref)!;
    expect(await wait("A-1")).toMatchObject({ blocking: false, holds: { items: [], sessions: [] }, needed_before: { item: f2 }, edits: [] });
    const before = await question("A-1");
    for (const set of [{ holds: [t1, "LAND-99"] }, { holds_sessions: [{ feature: f2, kind: "review" as const, label: "1" }] }, { needed_before: { release: "R9" } }, { needed_before: { item: "LAND-99" } }]) {
      expect(await edit(agent("Data"), "A-1", set)).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(await question("A-1")).toEqual(before);

    const session = { feature: f2, kind: "build" as const, label: "1" };
    await ok(agent("Data"), { op: "edit_question", project: "helix", ref: "A-1", set: { holds: [t1, t1], holds_sessions: [session, session] }, reason: "holds were left out" });
    expect(await wait("A-1")).toMatchObject({ blocking: true, holds: { items: [t1], sessions: [session] }, needed_before: { item: f2 } });
    expect((await ok(owner, { op: "overview", project: "helix" })).projects[0]!.waits_on_you).toBeTruthy();
    await ok(agent("Data"), { op: "edit_question", project: "helix", ref: "A-1", set: { holds: [], holds_sessions: [], needed_before: { release: r1 } } });
    expect(await wait("A-1")).toMatchObject({ blocking: false, holds: { items: [], sessions: [] }, needed_before: { release: r1 } });
    await ok(agent("Data"), { op: "edit_question", project: "helix", ref: "A-1", set: { needed_before: null } });
    expect((await question("A-1")).question.needed_before).toBeNull();
  });

  it("keeps each edit in the history: the fields it changed, before and after, who, when and why; an edit that changes nothing writes nothing (AC 5)", async () => {
    const { f1, t1 } = await asked();
    const last = (await question("Q-1")).history.at(-1)!.seq;
    await ok(agent("Data"), { op: "edit_question", project: "helix", ref: "Q-1", set: { text: "Which chart, for the roadmap?", holds: [t1], needed_before: { item: f1 } }, reason: "holds were left out" });
    await ok(agent("Picard"), { op: "edit_question", project: "helix", ref: "Q-1", set: { options: [{ key: "a", text: "Bars", recommended: true }, { key: "b", text: "Thin lines" }, { key: "c", text: "A table" }] } });
    const [first, second] = await edits("Q-1");
    expect(first).toMatchObject({
      seq: expect.any(Number),
      at: expect.any(String),
      actor: { kind: "agent", who: "Data@mbp-1" },
      op: "question_edited",
      record: { table: "questions", ref: "Q-1" },
      reason: "holds were left out",
      changes: [
        { field: "text", old: "Which chart?", new: "Which chart, for the roadmap?" },
        { field: "needed_before", old: null, new: f1 },
        { field: "holds", old: null, new: t1 },
      ],
    });
    expect(first!.seq).toBeGreaterThan(last);
    expect(second).toMatchObject({
      actor: { who: "Picard@mbp-1" },
      reason: null,
      changes: [
        { field: "option b", old: "Lines", new: "Thin lines" },
        { field: "option c", old: null, new: "A table" },
      ],
    });
    // Waits carries the same edits, oldest first, for the dashboard.
    expect((await ok(owner, { op: "waits" })).waits.find((w) => w.ref === "Q-1")!.edits).toEqual([
      { seq: first!.seq, at: first!.at, by: "Data@mbp-1", reason: "holds were left out", changes: first!.changes },
      { seq: second!.seq, at: second!.at, by: "Picard@mbp-1", reason: null, changes: second!.changes },
    ]);

    // The same values again, or nothing at all: no event, and the board's seq doesn't move.
    const now = (await question("Q-1")).history.at(-1)!.seq;
    const same = await call(agent("Data"), { op: "edit_question", project: "helix", ref: "Q-1", set: { text: "Which chart, for the roadmap?", holds: [t1], needed_before: { item: f1 } }, reason: "again" });
    expect(same).toMatchObject({ ok: true, changed: null, result: { ref: "Q-1", seq: now } });
    expect(await call(agent("Data"), { op: "edit_question", project: "helix", ref: "Q-1", set: {} })).toMatchObject({ ok: true, changed: null });
    expect(await edits("Q-1")).toHaveLength(2);
  });
});
