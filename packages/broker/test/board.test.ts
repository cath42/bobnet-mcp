import type { BoardCaller, BoardCtx, BoardOpInput, BoardReply, BoardResults, GrantField, ItemRecord } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// The board service's core (ADR 0001 §2, §3, §5), called as the broker calls it.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const agent = (name: string, ctx: BoardCtx | null = null): BoardCaller => ({ kind: "agent", name, laptop: "mbp-1", ctx });
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
  await ok(owner, { op: "grant", project: "helix", agent: "Picard", role: "backlog PO", ...po, items: "not_open_feature", sessions: true, admin: true });
  await ok(owner, { op: "grant", project: "helix", agent: "Riker", role: "session PO", ...po, items: "open_feature" });
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
    await ok(agent("Picard"), { op: "session_join", project: "helix", session: { feature: f1, kind: "build", label: "1" } });
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
