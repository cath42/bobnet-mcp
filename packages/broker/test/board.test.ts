import type { BoardCaller, BoardCtx, BoardOpInput, BoardReply, BoardResults, GrantField, ItemRecord, SessionRef } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

// The board service's core (ADR 0001 §2, §3, §5), called as the broker calls it.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const agent = (name: string, ctx: BoardCtx | null = null): BoardCaller => ({ kind: "agent", name, laptop: "mbp-1", supervisor: ctx !== null, ctx });
const inSession = (name: string, feature: string, role = "po"): BoardCaller =>
  agent(name, { worker: `w_${name.toLowerCase()}`, role, project: "helix", session: { feature, kind: "build", label: "1" }, tasks: [] });

const board = () => env.BOARD.getByName("board");

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

  it("keeps Casper's gates his: a feature's release, the order of releases, a gated criterion", async () => {
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

    const got = await ok(owner, { op: "get", project: "helix", session, history: true });
    expect(got.session).toMatchObject({ tokens: tokens(100), runs: [{ id: "w_bill", agent: "Bill", laptop: "mbp-1", calls: 3, tokens: tokens(100), tasks: [t1], ended_at: at(30) }] });
    expect(got.session!.runs[0]).not.toHaveProperty("cost_usd");
    await runInDurableObject(board(), (_, state) => {
      const blob = state.storage.sql.exec<{ ctx: ArrayBuffer }>("SELECT ctx FROM runs WHERE id = 'w_bill'").one().ctx;
      const view = new DataView(blob);
      expect([0, 1, 2].map((i) => view.getUint32(i * 4, true))).toEqual([1000, 70000, 0x10000000]);
    });
    expect(await refused(bill, { ...end, id: "w_nobody" })).toMatchObject({ code: "forbidden" });
    expect(await refused(sup("Nobody", null), { ...end, id: "w_nobody" })).toMatchObject({ code: "invalid" });
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

  /** The messages an operation that must succeed sends. */
  async function sent(caller: BoardCaller, op: BoardOpInput): Promise<Extract<BoardReply, { ok: true }>["messages"]> {
    const reply = await call(caller, op);
    if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
    return reply.messages;
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
    const [note, ...more] = reply.messages;
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

  it("replays an answer's messages, so a reply lost after the commit still tells the lead", async () => {
    await helix();
    await helixRules();
    await ok(agent("Picard"), { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars" }] });
    const answer = { op: "answer_question", project: "helix", ref: "Q-1", key: "a" } as const;
    const first = await keyed(owner, answer, "k-2");
    expect(first).toMatchObject({ ok: true, messages: [{ to: ["Picard@mbp-1"] }] });
    expect(await keyed(owner, answer, "k-2")).toEqual(first);
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
    });
    // A Done feature with criteria not ticked reads from its progress; no flag of its own.
    expect((await ok(owner, { op: "list", project: "helix", of: "releases" })).releases!.map((r) => r.backlog)).toEqual([
      { items: 0, bugs: 0, oldest: null },
      { items: 1, bugs: 1, oldest: expect.any(String) },
    ]);
  });
});
