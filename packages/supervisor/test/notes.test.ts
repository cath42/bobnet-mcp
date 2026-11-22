import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { callTool, handlers } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { REMOTE_TOOLS_SINCE, Supervisor } from "../src/supervisor.ts";
import { fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork } from "./network.ts";

// ADR 0013 §3 with both ends real (BOB-51, BOB-29 AC3): mbp-1's supervisor spawns a v: 2 worker on
// ubu1's, each with its real Router, WorkerRun and store on one FakeNetwork; only the SDK is a
// FakeQuery that reads its prompt. A note sent with allow is the worker's next message, from mbp-1's
// answer_request and from the dashboard's action on ubu1 alike.

const POLICY = new Policy(`
rules:
  - { id: probe, tools: [Bash], command: "^echo probe$", decision: escalate, tier: orchestrator, reason: the probe }
  - { id: human, tools: [Bash], command: "^echo human", decision: escalate, tier: human, reason: the user decides }
`);
const UBU = `  studio:
    path: /work/studio
    roles:
      ann: { dir: /work/studio-ann }
remote:
  supervisor@mbp-1: { spawn: { studio: [ann] } }
`;
const SUP_UBU = "supervisor@ubu1";

const dirs: string[] = [];
const stores: Store[] = [];
const running: Supervisor[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(net: FakeNetwork, laptop: string, over: string) {
  const dir = mkdtempSync(join(tmpdir(), "bobnet-notes-"));
  dirs.push(dir);
  const store = new Store(join(dir, "supervisor.db"));
  stores.push(store);
  const link = net.link(laptop);
  const query = fakeQuery();
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config: testConfig(dir, over), policy: POLICY, store, broker: link, queryFn: query.queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => true, sleep: net.sleep, ciPoll });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push(sup);
  return { sup, store, link, sessions: query.sessions };
}

/** Both supervisors real, Bob mbp-1's orchestrator, and Ann running on ubu1 as mbp-1's v: 2 worker. */
async function both() {
  const net = new FakeNetwork();
  net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
  const ubu = await boot(net, "ubu1", UBU);
  const mbp = await boot(net, "mbp-1", "");
  await mbp.link.register({ name: "Bob" });
  const tools = handlers(mbp.sup);
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await callTool(tools, name, args)).content[0]!.text) as Record<string, unknown>;
  const w = await call("spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" });
  await until(() => ubu.sessions.length === 1);
  const session = ubu.sessions[0]!;
  await until(() => session.inputs.length === 1);
  return { net, ubu, mbp, call, session, worker: w["id"] as string };
}

describe("a note with allow, both ends real (ADR 0013 §3)", () => {
  it("remote half: mbp-1's answer_request allow with a note; ubu1's worker gets the call, then the line; note_delivered true", async () => {
    const s = await both();
    const result = s.session.ask("Bash", { command: "echo probe" });
    await until(() => s.mbp.store.remoteAsks("ubu1").length === 1);
    const rid = s.mbp.store.remoteAsks("ubu1")[0]!.id;
    const out = await s.call("answer_request", { id: rid, decision: "allow", message: "Then stop and report." });
    expect(out).toEqual({ id: rid, state: "answered", decision: "allow", note_delivered: true, laptop: "ubu1" });
    expect(await result).toEqual({ behavior: "allow", updatedInput: { command: "echo probe" } });
    await until(() => s.session.inputs.length === 2);
    expect(s.session.inputs[1]).toBe(`Note from Bob@mbp-1 with the Allow of request ${rid} (Bash): Then stop and report.`);
    expect(s.ubu.store.auditLog(50).find((a) => a.action === "remote:answer")).toMatchObject({ actor: "supervisor@mbp-1", worker_id: s.worker });
    expect(s.ubu.store.request(rid)).toMatchObject({ decided_by: "orchestrator", via: null, message: "Then stop and report." });
  });

  it("old-target variant: ubu1's answer replies without note_delivered, and mbp-1's result says not delivered", async () => {
    const s = await both();
    const real = s.ubu.sup.answer.bind(s.ubu.sup);
    vi.spyOn(s.ubu.sup, "answer").mockImplementation((...args) => {
      const { note_delivered: _, ...rest } = real(...args);
      return rest;
    });
    const result = s.session.ask("Bash", { command: "echo probe" });
    await until(() => s.mbp.store.remoteAsks("ubu1").length === 1);
    const rid = s.mbp.store.remoteAsks("ubu1")[0]!.id;
    const out = await s.call("answer_request", { id: rid, decision: "allow", message: "Then stop and report." });
    expect(out).toEqual({
      id: rid,
      state: "answered",
      decision: "allow",
      note_delivered: false,
      note: "not delivered: ubu1's supervisor is older and drops a note sent with allow",
      laptop: "ubu1",
    });
    await result;
  });

  it("local half: the dashboard's allow with a note, handed to ubu1 through its link; action_result's note_delivered true, and the line", async () => {
    const s = await both();
    const result = s.session.ask("Bash", { command: "echo human: push it" });
    await until(() => s.ubu.store.requests(["open"]).length === 1);
    const rid = s.ubu.store.requests(["open"])[0]!.id;
    s.ubu.link.onPush!({ t: "action", id: "a_1", to: SUP_UBU, by: "owner@example.com", token: "owner-token", action: { kind: "answer", request: rid, decision: "allow", message: "Once, then land." } });
    expect(await result).toMatchObject({ behavior: "allow" });
    await until(() => s.ubu.link.results.length === 1);
    expect(s.ubu.link.results[0]).toEqual({ t: "action_result", as: "supervisor", id: "a_1", ok: true, message: `${rid} allowed`, note_delivered: true });
    await until(() => s.session.inputs.length === 2);
    expect(s.session.inputs[1]).toBe(`Note from Casper with the Allow of request ${rid} (Bash): Once, then land.`);
    expect(s.ubu.sup.snapshot().decided).toEqual([expect.objectContaining({ id: rid, decision: "allow", note: "Once, then land.", project: "studio", name: "Ann" })]);
  });
});
