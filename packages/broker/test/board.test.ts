import type { BoardCaller, BoardCtx, BoardOpInput, BoardReply, BoardResults, GrantField, ItemRecord, SessionRef } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
    await ok(owner, { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "1" } });
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
    await ok(owner, { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "1" } });
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
    await ok(owner, { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "1" } });
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
    await ok(owner, { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "1" } });
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
});

describe("sessions", () => {
  it("opens the feature when a session joins it, and refuses a feature that isn't one", async () => {
    const { f1, t1 } = await helix();
    const first = await ok(owner, { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "1" } });
    expect(first).toMatchObject({ ref: `${f1} build 1`, created: true });
    expect(await ok(owner, { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "1" } })).toMatchObject({ created: false });
    expect(await refused(owner, { op: "session_join", project: "helix", session: { feature: t1, kind: "build", label: "1" } })).toMatchObject({ code: "invalid" });
    const f = await item(f1);
    expect(f.sessions).toEqual([{ feature: f1, kind: "build", label: "1", started_at: f.open_since, ended_at: null }]);
    expect(await refused(agent("Bill"), { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "2" } })).toMatchObject({ code: "forbidden" });
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
    const start = { op: "run_start" as const, project: "helix", id: "w_bill", agent: "Bill", role: "builder", started_at: at(0), session, tasks: [t1, "LAND-99"] };
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
    expect(await refused(bill, { ...end, id: "w_nobody" })).toMatchObject({ code: "invalid" });
  });

  it("keeps the supervisor's reports to its laptop's supervisor, for the worker's own project", async () => {
    await helix();
    const start = { op: "run_start" as const, project: "helix", id: "w_x", agent: "Bill", role: "builder", started_at: at(0), session: null };
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
    await ok(bill, { op: "run_start", project: "helix", id: "w_bill", agent: "Bill", role: "builder", started_at: at(0), session, tasks: [t1] });
    const push = { op: "push" as const, project: "helix", repo: "cath42/helix", branch: "main", sha: "abcdef1234567", worker: "w_bill", run: "w_bill" };
    const pushed = await ok(bill, push);
    expect(await ok(bill, push)).toMatchObject({ seq: pushed.seq });
    const slot = { op: "slot_run" as const, project: "helix", external_id: "s_1", name: "land", worker: "w_bill", run: "w_bill" };
    await ok(bill, { ...slot, status: "running", started_at: at(1) });
    await ok(bill, { ...slot, status: "passed", ended_at: at(4) });
    await runInDurableObject(board(), (_, state) => {
      const sql = state.storage.sql;
      expect(sql.exec("SELECT status, laptop, started_at, ended_at, session IS NOT NULL AS tied FROM ci_runs").toArray()).toEqual([
        { status: "passed", laptop: "mbp-1", started_at: at(1), ended_at: at(4), tied: 1 },
      ]);
      expect(sql.exec<{ n: number }>("SELECT count(*) AS n FROM ci_run_tasks").one().n).toBe(1);
      expect(sql.exec<{ n: number }>("SELECT count(*) AS n FROM pushes WHERE run IS NOT NULL").one().n).toBe(1);
    });
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

  it("keeps a capture's release only for someone who may triage, and says when it didn't", async () => {
    const { r1 } = await helix();
    await helixRules();
    expect(await ok(agent("Bill"), { op: "capture", project: "helix", capture_id: uuid(2), title: "x", release: r1 })).toMatchObject({ dropped: ["release"] });
    const picard = await ok(agent("Picard"), { op: "capture", project: "helix", capture_id: uuid(3), title: "y", release: r1 });
    expect(picard.dropped).toEqual([]);
    expect((await item(picard.ref!)).release).toBe(r1);
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

  it("refuses a project prefix that reads as a question's", async () => {
    expect(await refused(owner, { op: "create_project", key: "quiz", name: "Quiz", prefix: "Q" })).toMatchObject({ code: "invalid" });
  });
});

describe("close_session (ADR 0001 §6)", () => {
  async function closing() {
    const ids = await helix();
    await helixRules();
    const session = { feature: ids.f1, kind: "build" as const, label: "1" };
    const bill = sup("Bill", session);
    await ok(bill, { op: "session_join", project: "helix", session });
    await ok(bill, { op: "run_start", project: "helix", id: "w_bill", agent: "Bill", role: "builder", started_at: at(0), session });
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
    await ok(agent("Picard"), { ...close(session), need: "casper", waits_on: ["Q-1"] });
    const { session: s } = await ok(owner, { op: "get", project: "helix", session });
    expect(s!.close).toMatchObject({ need: "casper", waits_on: ["Q-1"] });
  });
});
