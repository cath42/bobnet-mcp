import type { BoardCaller, BoardOpInput, BoardReply, BoardResults } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// BOB-121's project data (ADR 0014 §3, §3a, §4): the current release, a project's page, its CI
// history and a feature's own criteria, called as the broker calls them.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const board = () => env.BOARD.getByName("board");

async function call(caller: BoardCaller, op: BoardOpInput): Promise<BoardReply> {
  return (await board().apply(caller, op)) as unknown as BoardReply;
}
async function ok<K extends keyof BoardResults>(caller: BoardCaller, op: BoardOpInput & { op: K }): Promise<BoardResults[K]> {
  const reply = await call(caller, op);
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result as BoardResults[K];
}
const sql = (run: (sql: SqlStorage) => void) => runInDurableObject(board(), (_, state) => run(state.storage.sql));

async function project(key = "helix") {
  await ok(owner, { op: "create_project", key, name: key[0]!.toUpperCase() + key.slice(1), prefix: key === "helix" ? "LAND" : key.slice(0, 3).toUpperCase() });
}
const release = async (title: string, key = "helix") => (await ok(owner, { op: "create_release", project: key, title })).ref!;
const feature = async (title: string, rel: string | null, key = "helix") =>
  (await ok(owner, { op: "create", project: key, kind: "feature", type: "increment", title, ...(rel ? { release: rel } : {}) })).ref!;
const done = (ref: string, key = "helix") => ok(owner, { op: "update", project: key, ref, set: { status: "Done" } });
const setStatus = (ref: string, status: "planned" | "open" | "closed") =>
  sql((s) => {
    s.exec("UPDATE releases SET status = ?, closed_at = ?, closed_by = ? WHERE ref = ?", status, ...(status === "closed" ? [new Date().toISOString(), "owner@example.com"] : [null, null]), ref);
  });

async function overviewRow(key = "helix") {
  return (await ok(owner, { op: "overview", project: key })).projects[0]!;
}
async function statusRelease(key = "helix") {
  return (await ok(owner, { op: "status", project: key, since: new Date(Date.now() - 3600_000).toISOString() })).projects[0]!.backlog.release;
}

describe("the current release (ADR 0014 §4, BOB-163)", () => {
  it("is R2, planned with work, after an R1 that is open and all done: number 2 and R2's own count", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    for (const t of ["A", "B", "C", "D"]) await done(await feature(t, r1));
    await setStatus(r1, "open");
    await done(await feature("E", r2));
    for (const t of ["F", "G", "H", "I", "J"]) await feature(t, r2);
    const row = await overviewRow();
    expect(row.release).toMatchObject({ ref: r2, status: "planned", features: { done: 1, total: 6 } });
    expect(row.release_number).toBe(2);
    expect(await statusRelease()).toEqual({ ref: r2, todo: 5, ready: 0 });
  });

  it("is an open R2 with work after a closed R1", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await feature("A", r1);
    await feature("B", r2);
    await setStatus(r1, "closed");
    await setStatus(r2, "open");
    const row = await overviewRow();
    expect([row.release?.ref, row.release_number]).toEqual([r2, 2]);
    expect((await statusRelease())?.ref).toBe(r2);
  });

  it("is the last release not closed when every one is done and none closed", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    const r3 = await release("Release 3");
    await done(await feature("A", r1));
    await done(await feature("B", r2));
    await setStatus(r3, "closed");
    const row = await overviewRow();
    expect(row.release).toMatchObject({ ref: r2, features: { done: 1, total: 1 } });
    expect(row.release_number).toBe(2);
    expect(await statusRelease()).toEqual({ ref: r2, todo: 0, ready: 0 });
  });

  it("is none without releases, or with every one closed", async () => {
    await project();
    expect(await overviewRow()).toMatchObject({ release: null, release_number: null });
    expect(await statusRelease()).toBeNull();
    const r1 = await release("Release 1");
    await setStatus(r1, "closed");
    expect(await overviewRow()).toMatchObject({ release: null, release_number: null });
  });

  it("counts an archived feature that isn't Done as no work", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await done(await feature("A", r1));
    const gone = await feature("B", r1);
    await ok(owner, { op: "archive", project: "helix", ref: gone, reason: "Dropped" });
    await feature("C", r2);
    const row = await overviewRow();
    expect([row.release?.ref, row.release_number, row.release?.features]).toEqual([r2, 2, { done: 0, total: 1 }]);
  });

  it("follows the board's order of releases, not their creation", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await feature("A", r1);
    await feature("B", r2);
    await ok(owner, { op: "order_releases", project: "helix", refs: [r2, r1] });
    const row = await overviewRow();
    expect([row.release?.ref, row.release_number]).toEqual([r2, 1]);
  });
});

const SHA = (n: number) => n.toString(16).padStart(40, "a");
const supervisor = (worker: string, name = "Bill"): BoardCaller => ({
  kind: "agent",
  name,
  laptop: "mbp-1",
  supervisor: true,
  ctx: { worker, role: name.toLowerCase(), project: "helix", session: null, tasks: [] },
});
async function ci(n: number, o: { name?: string; status?: "queued" | "running" | "passed" | "failed"; sha?: string; start?: string | null }) {
  const at = o.start === undefined ? new Date(Date.parse("2026-11-20T10:00:00Z") + n * 60_000).toISOString() : o.start;
  const reply = (await board().reportCi("github-actions", {
    external_id: `run-${n}`,
    name: o.name ?? "ci",
    url: `https://github.com/cath42/helix/actions/runs/${n}`,
    repo: "cath42/helix",
    branch: "main",
    sha: o.sha ?? SHA(n),
    status: o.status ?? "passed",
    started_at: at,
    ended_at: at && (o.status ?? "passed") !== "running" ? at : null,
  })) as unknown as BoardReply;
  if (!reply.ok) throw new Error(`ci_run refused: ${reply.message}`);
}

describe("CI history from the board (ADR 0014 §3a, BOB-168)", () => {
  it("gives each workflow its latest run and the 5 before it, newest first, passed ones too; a slot run is no workflow", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    for (let n = 1; n <= 8; n++) await ci(n, { status: n === 7 ? "failed" : "passed" });
    await ci(9, { name: "deploy", status: "running" });
    await ci(10, { name: "deploy", status: "queued", start: null });
    const bill = supervisor("w_bill");
    await ok(bill, { op: "run_start", project: "helix", id: "w_bill", started_at: new Date().toISOString(), session: null });
    await ok(bill, { op: "slot_run", project: "helix", external_id: "s_1", name: "land", status: "passed", started_at: new Date().toISOString() });
    const flows = (await overviewRow()).ci!;
    expect(flows.map((f) => [f.name, f.runs.length])).toEqual([
      ["ci", 6],
      ["deploy", 2],
    ]);
    expect(flows[0]!.runs.map((r) => [r.sha, r.status])).toEqual([8, 7, 6, 5, 4, 3].map((n) => [SHA(n), n === 7 ? "failed" : "passed"]));
    expect(flows[0]!.runs[0]).toEqual({
      name: "ci",
      branch: "main",
      status: "passed",
      sha: SHA(8),
      url: "https://github.com/cath42/helix/actions/runs/8",
      started_at: "2026-11-20T10:08:00.000Z",
      ended_at: "2026-11-20T10:08:00.000Z",
      agent: null,
    });
    // A run not started yet is the newest.
    expect(flows[1]!.runs.map((r) => r.status)).toEqual(["queued", "running"]);
  });

  it("names the agent whose land pushed the sha a run ran on, and none without a push", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    const toad = supervisor("w_toad", "Toad");
    await ok(toad, { op: "run_start", project: "helix", id: "w_toad", started_at: new Date().toISOString(), session: null });
    await ok(toad, { op: "push", project: "helix", repo: "Cath42/Helix", branch: "v2", sha: SHA(1) });
    await ci(1, {});
    await ci(2, {});
    // A push after its run's report ties it too.
    await ci(3, {});
    await ok(toad, { op: "push", project: "helix", repo: "cath42/helix", branch: "v2", sha: SHA(3) });
    const runs = (await overviewRow()).ci![0]!.runs;
    expect(runs.map((r) => [r.sha, r.agent])).toEqual([
      [SHA(3), "Toad"],
      [SHA(2), null],
      [SHA(1), "Toad"],
    ]);
  });

  it("gives every project on the Overview its ci, none as an empty list", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    await ci(1, {});
    const rows = (await ok(owner, { op: "overview" })).projects;
    expect(rows.map((r) => [r.project.key, r.ci?.length])).toEqual([
      ["bobnet", 0],
      ["helix", 1],
    ]);
  });
});
