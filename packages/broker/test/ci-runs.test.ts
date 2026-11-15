import type { BoardCaller, BoardOpInput, BoardReply, SessionRef } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { accessToken, laptopToken, ORIGIN, ownerToken } from "./helpers.ts";

// CI runs from anywhere (ADR 0001 §4, §10): POST /v1/runs with a CI token, tied to a worker by its push.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const board = () => env.BOARD.getByName("board");
const ciToken = (n: 1 | 2) => accessToken({ common_name: `ci-${n}.access`, sub: "" });
const SHA = "0123456789abcdef0123456789abcdef01234567";

async function ok(caller: BoardCaller, op: BoardOpInput): Promise<unknown> {
  const reply = (await board().apply(caller, op)) as unknown as BoardReply;
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result;
}

async function post(body: unknown, token?: string, method = "POST"): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await exports.default.fetch(`${ORIGIN}/v1/runs`, {
    method,
    headers: { "cf-access-jwt-assertion": token ?? (await ciToken(1)), "content-type": "application/json" },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith("{") ? JSON.parse(text) : { text } };
}

async function rows(sql: string): Promise<Record<string, unknown>[]> {
  return runInDurableObject(board(), (_, state) => state.storage.sql.exec(sql).toArray());
}

/** Helix, whose repo is cath42/helix, with a feature and a task; and Bill's run, which pushed SHA. */
async function helix(push = true) {
  await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
  await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Roadmap" });
  await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Draw it", parent: "LAND-1" });
  const session: SessionRef = { feature: "LAND-1", kind: "build", label: "1" };
  const bill: BoardCaller = { kind: "agent", name: "Bill", laptop: "mbp-1", supervisor: true, ctx: { worker: "w_bill", role: "builder", project: "helix", session, tasks: ["LAND-2"] } };
  await ok(bill, { op: "session_join", project: "helix", session });
  await ok(bill, { op: "run_start", project: "helix", id: "w_bill", started_at: new Date().toISOString(), session, tasks: ["LAND-2"] });
  if (push) await ok(bill, { op: "push", project: "helix", repo: "cath42/helix", branch: "main", sha: SHA });
  return { bill };
}

const run = { external_id: "123-1", name: "CI / test", repo: "cath42/helix", branch: "main", sha: SHA };

describe("POST /v1/runs (ADR 0001 §10)", () => {
  it("takes only a CI token, which gets nothing else", async () => {
    await helix();
    expect((await exports.default.fetch(`${ORIGIN}/v1/runs`, { method: "POST" })).status).toBe(401);
    expect((await post({ ...run, status: "running" }, await laptopToken(1))).status).toBe(403);
    expect((await post({ ...run, status: "running" }, await ownerToken())).status).toBe(403);
    expect((await post(null, undefined, "GET")).status).toBe(405);
    const ci = { "cf-access-jwt-assertion": await ciToken(1) };
    expect((await exports.default.fetch(`${ORIGIN}/v1/ws`, { headers: { ...ci, upgrade: "websocket" } })).status).toBe(403);
    expect((await exports.default.fetch(`${ORIGIN}/v1/board/export`, { headers: ci })).status).toBe(403);
    expect((await exports.default.fetch(`${ORIGIN}/`, { headers: ci })).status).toBe(404);
    // A CI run is the CI system's: not an operation an agent or the owner makes.
    expect(await board().apply(owner, { op: "ci_run", project: "helix", ...run, status: "running" })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("takes its source from the token, never the body", async () => {
    await helix();
    expect(await post({ ...run, source: "buildkite", status: "running" })).toMatchObject({ status: 403, body: { code: "forbidden" } });
    expect(await post({ ...run, source: "github-actions", status: "running" })).toMatchObject({ status: 200, body: { ok: true, ref: "github-actions 123-1" } });
    expect(await post({ ...run, status: "running" }, await ciToken(2))).toMatchObject({ status: 200, body: { ref: "buildkite 123-1" } });
    expect((await rows("SELECT source FROM ci_runs ORDER BY source")).map((r) => r.source)).toEqual(["buildkite", "github-actions"]);
  });

  it("refuses a body that isn't a run", async () => {
    await helix();
    expect((await post("not json")).status).toBe(400);
    expect((await post([run])).status).toBe(400);
    expect(await post({ ...run, status: "done" })).toMatchObject({ status: 400, body: { code: "invalid" } });
    expect(await post({ ...run, status: "running", sha: "abc" })).toMatchObject({ status: 400 });
  });

  it("upserts a run by its id: a start, then its end; a late start changes nothing", async () => {
    await helix();
    expect(await post({ ...run, status: "running", started_at: "2026-11-14T10:00:00Z" })).toMatchObject({ status: 200, body: { tied: "w_bill" } });
    expect(await post({ ...run, status: "passed", ended_at: "2026-11-14T10:04:00Z", url: "https://github.com/cath42/helix/actions/runs/123" })).toMatchObject({ status: 200 });
    expect(await post({ ...run, status: "running", started_at: "2026-11-14T10:01:00Z" })).toMatchObject({ status: 200 });
    expect(await rows("SELECT status, started_at, ended_at, url FROM ci_runs")).toEqual([
      { status: "passed", started_at: "2026-11-14T10:00:00Z", ended_at: "2026-11-14T10:04:00Z", url: "https://github.com/cath42/helix/actions/runs/123" },
    ]);
    // One event per change, as the CI system: the late start made none.
    expect(await rows("SELECT op, actor_kind, actor FROM events WHERE tbl = 'ci_runs' ORDER BY seq")).toEqual([
      { op: "ci_run", actor_kind: "ci", actor: "github-actions" },
      { op: "ci_run", actor_kind: "ci", actor: "github-actions" },
    ]);
  });

  it("finds its project by repo when it names none, and keeps the project it first had", async () => {
    await helix();
    await ok(owner, { op: "create_project", key: "solo", name: "Solo", prefix: "SOLO", repos: ["cath42/solo"] });
    expect(await post({ ...run, external_id: "9", repo: "cath42/other", status: "queued" })).toMatchObject({ status: 400, body: { message: expect.stringMatching(/name the project/) } });
    expect(await post({ ...run, external_id: "9", repo: null, status: "queued" })).toMatchObject({ status: 400 });
    expect((await post({ ...run, external_id: "9", repo: "cath42/other", project: "solo", status: "queued" })).status).toBe(200);
    expect(await post({ ...run, external_id: "9", project: "helix", status: "running" })).toMatchObject({ status: 409, body: { code: "conflict" } });
    expect((await post({ ...run, external_id: "10", repo: "Cath42/Helix", status: "queued" })).status).toBe(200);
    expect(await rows("SELECT c.external_id, p.key FROM ci_runs c JOIN projects p ON p.pk = c.project ORDER BY c.external_id")).toEqual([
      { external_id: "10", key: "helix" },
      { external_id: "9", key: "solo" },
    ]);
  });

  it("ties to the worker whose push it ran on, and to its session and tasks, whichever comes first", async () => {
    const { bill } = await helix(false);
    expect(await post({ ...run, status: "passed", ended_at: "2026-11-14T10:04:00Z" })).toMatchObject({ body: { tied: null } });
    await ok(bill, { op: "push", project: "helix", repo: "cath42/helix", branch: "main", sha: SHA });
    expect(await rows("SELECT worker, session IS NOT NULL AS session FROM ci_runs")).toEqual([{ worker: "w_bill", session: 1 }]);
    expect(await rows("SELECT count(*) AS n FROM ci_run_tasks")).toEqual([{ n: 1 }]);
    expect(await post({ ...run, status: "passed" })).toMatchObject({ body: { tied: "w_bill" } });
    // A run on a commit nobody here pushed ties to its project only.
    expect(await post({ ...run, external_id: "7", sha: "f".repeat(40), status: "running" })).toMatchObject({ status: 200, body: { tied: null } });
  });
});
