import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Policy } from "../src/policy.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ciStatus, GhCiPoll, ghCiRun, type GhRun } from "../src/ci-poll.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { FakeBroker, fakeQuery, quiet, testConfig, until } from "./fakes.ts";

// The gh adapter (ADR 0001 §10): a service project's GitHub Actions runs, read with gh, reported as
// the supervisor's own ci_run, each change once.

const SHA = "0123456789abcdef0123456789abcdef01234567";
const ghRun = (over: Partial<GhRun> = {}): GhRun => ({
  databaseId: 77,
  attempt: 1,
  workflowName: "CI",
  name: "test",
  status: "in_progress",
  conclusion: "",
  startedAt: "2026-11-14T10:00:00Z",
  updatedAt: "2026-11-14T10:02:00Z",
  headSha: SHA,
  headBranch: "v2",
  url: "https://github.com/cath42/bobnet-mcp/actions/runs/77",
  ...over,
});

/** A fake git and gh: origin is cath42/bobnet-mcp, and `runs()` is what gh lists. */
function fakeExec(runs: () => GhRun[]) {
  const calls: string[] = [];
  const exec = async (cmd: string, args: string[], cwd: string) => {
    calls.push(`${cwd}: ${cmd} ${args[0]}`);
    if (cmd === "git") return "git@github.com:cath42/bobnet-mcp.git\n";
    return JSON.stringify(runs());
  };
  return { exec, calls };
}

describe("a GitHub run as the board's", () => {
  it("maps GitHub's status and conclusion, anything but success and failure as cancelled", () => {
    expect(ciStatus("queued", "")).toBe("queued");
    expect(ciStatus("waiting", "")).toBe("queued");
    expect(ciStatus("in_progress", "")).toBe("running");
    expect(ciStatus("completed", "success")).toBe("passed");
    for (const c of ["failure", "timed_out", "startup_failure"]) expect(ciStatus("completed", c)).toBe("failed");
    for (const c of ["cancelled", "skipped", "stale", "neutral", "action_required"]) expect(ciStatus("completed", c)).toBe("cancelled");
  });

  it("is a run per attempt, ended only once it has", () => {
    expect(ghCiRun("bobnet", "cath42/bobnet-mcp", ghRun())).toEqual({
      op: "ci_run",
      project: "bobnet",
      external_id: "77-1",
      name: "CI / test",
      url: "https://github.com/cath42/bobnet-mcp/actions/runs/77",
      repo: "cath42/bobnet-mcp",
      branch: "v2",
      sha: SHA,
      status: "running",
      started_at: "2026-11-14T10:00:00Z",
      ended_at: null,
    });
    expect(ghCiRun("bobnet", "cath42/bobnet-mcp", ghRun({ attempt: 2, status: "completed", conclusion: "success", name: "CI" }))).toMatchObject({
      external_id: "77-2",
      name: "CI",
      status: "passed",
      ended_at: "2026-11-14T10:02:00Z",
    });
    expect(ghCiRun("bobnet", "cath42/bobnet-mcp", ghRun({ headSha: "abc", startedAt: "0001-01-01T00:00:00Z" }))).toMatchObject({ sha: null, started_at: null });
  });
});

describe("GhCiPoll", () => {
  it("says each run's status once, and again when it changes", async () => {
    let runs = [ghRun(), ghRun({ databaseId: 78, status: "queued" })];
    const { exec, calls } = fakeExec(() => runs);
    const poll = new GhCiPoll(quiet, exec);
    const project = testConfig("/tmp/x", "").projects.get("helix")!;
    expect((await poll.poll([project])).map((o) => `${o.external_id} ${o.status}`)).toEqual(["77-1 running", "78-1 queued"]);
    expect(await poll.poll([project])).toEqual([]);
    runs = [ghRun({ status: "completed", conclusion: "failure" }), ghRun({ databaseId: 78, status: "queued" })];
    expect((await poll.poll([project])).map((o) => `${o.external_id} ${o.status}`)).toEqual(["77-1 failed"]);
    expect(calls[0]).toBe("/work/helix: git remote");
  });

  it("reports nothing for a project without gh or a GitHub remote", async () => {
    const poll = new GhCiPoll(quiet, async () => {
      throw new Error("gh: not found");
    });
    expect(await poll.poll([testConfig("/tmp/x", "").projects.get("helix")!])).toEqual([]);
  });
});

describe("the supervisor's gh adapter", () => {
  let dir: string;
  let store: Store;
  let sup: Supervisor | null = null;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bobnet-ci-"));
    store = new Store(join(dir, "supervisor.db"));
  });
  afterEach(async () => {
    await sup?.shutdown();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers its service projects, and reports their runs as its own, through the outbox", async () => {
    const config = testConfig(dir, "  bobnet:\n    path: /work/bobnet\n    priority: 2\n    board: service\n    roles:\n      luigi: { dir: /work/bobnet-luigi/packages, name: Luigi }\n");
    const broker = new FakeBroker();
    const { exec, calls } = fakeExec(() => [ghRun()]);
    const { queryFn } = fakeQuery();
    sup = new Supervisor({ config, policy: new Policy("rules: []"), store, broker, queryFn, log: quiet, sandboxCheck: async () => null, captureDir: join(dir, "c"), ciPoll: new GhCiPoll(quiet, exec) });
    await sup.start();
    const me = broker.registered[0]!;
    expect(me).toMatchObject({ supervisor: true, projects: ["bobnet"] });
    await until(() => broker.boardOps.some((o) => o.op.op === "ci_run"));
    const [report] = broker.boardOps.filter((o) => o.op.op === "ci_run");
    expect(report).toEqual({ as: me.name, ctx: undefined, op: expect.objectContaining({ project: "bobnet", external_id: "77-1", repo: "cath42/bobnet-mcp", status: "running" }) });
    // Only the service project is read: Backlog.md projects keep the legacy poll.
    expect(calls.every((c) => c.startsWith("/work/bobnet:"))).toBe(true);
    await until(() => store.outbox("board_op").length === 0);
  });
});
