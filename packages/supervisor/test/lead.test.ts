import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaptopSnapshot } from "@bobnet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, handlers } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { FakeBroker, fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";

const POLICY_TEXT = `
rules:
  - { id: read, tools: [Read], decision: allow }
  - { id: no-push, tools: [Bash], command: "^git push", decision: deny, reason: "Workers don't push" }
  - { id: fetch, tools: [WebFetch], decision: escalate, tier: orchestrator }
  - { id: tests, tools: [Bash], command: "^pnpm test( |$)", decision: allow, slot: true }
`;
const SUPERVISOR_DIR = "/home/x/.config/bobnet";
const POLICY = new Policy(POLICY_TEXT, { protect: [SUPERVISOR_DIR] });

// A project led by Bob as a worker, beside helix and games (whose orchestrator Bob stays interactive).
const STUDIO = `  studio:
    path: /work/studio
    roles:
      bob: { dir: /work/studio-bob, lead: true }
      ann: { dir: /work/studio-ann }
      cy: { dir: /work/studio-cy, remote_control: false }
`;

let dir: string;
let store: Store;
let running: Supervisor[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bobnet-lead-"));
  store = new Store(join(dir, "supervisor.db"));
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function setup(opts: { remoteControl?: boolean } = {}) {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery(opts);
  const sup = new Supervisor({ config: testConfig(dir, STUDIO), policy: POLICY, store, broker, queryFn, log: quiet, ownerCheck: async () => false });
  await sup.start();
  running.push(sup);
  return { sup, broker, sessions };
}

/** Starts the lead and returns its tools, as its in-process server runs them. */
async function withLead() {
  const s = await setup();
  const lead = s.sup.spawn({ project: "studio", role: "bob", task: "Lead LAND-42 build 2" });
  await until(() => s.sessions.length === 1);
  const h = handlers(s.sup, { lead: lead.id });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await callTool(h, name, args);
    const text = r.content[0]!.text;
    if (r.isError) throw new Error(text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return { ...s, lead, call, leadSession: s.sessions[0]! };
}

const snapshot = (sup: Supervisor) => (sup as unknown as { snapshot: () => LaptopSnapshot }).snapshot();
const pushMsg = (to: string, wake: boolean, body: string, id = `m_${Math.random().toString(36).slice(2, 7)}`) =>
  ({
    t: "message",
    to,
    wake,
    msg: { id, type: wake ? "message" : "broadcast", from: "Riker@mbp-1", to: [to], team: "land", laptop: "mbp-1", in_reply_to: null, urgent: false, body, created_at: "2026-11-07T00:00:00Z", expires_at: "2026-12-07T00:00:00Z" },
  }) as never;

describe("config", () => {
  it("names a lead as its project's orchestrator, one per project", () => {
    expect(testConfig(dir, STUDIO).projects.get("studio")!.roles.get("bob")).toMatchObject({ name: "Bob", lead: true, remoteControl: true });
    expect(() => testConfig(dir, "  studio:\n    path: /s\n    roles:\n      ann: { dir: /s/a, lead: true }\n")).toThrow(/a lead role is named as the project's orchestrator \(Bob\), not Ann/);
    expect(() => testConfig(dir, "  studio:\n    path: /s\n    roles:\n      bob: { dir: /s/b, lead: true }\n      cy: { dir: /s/c, lead: true, name: Bob }\n")).toThrow(/one lead role at most/);
    // Bob without lead is still a clash with the orchestrator's name.
    expect(() => testConfig(dir, "  studio:\n    path: /s\n    roles:\n      bob: { dir: /s/b }\n")).toThrow(/already used by the orchestrator/);
  });
});

describe("Remote Control", () => {
  it("turns on once at the session's start, named for the worker's session, and shows its URL", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "studio", role: "ann", task: "draw", session: { feature: "LAND-42", kind: "build", label: "2" } });
    await until(() => sessions.length === 1);
    await until(() => sup.status(w.id).remote_control !== null && "url" in sup.status(w.id).remote_control!);
    sessions[0]!.init();
    await tick(20);
    expect(sessions[0]!.remoteCalls).toEqual([[true, "Ann · LAND-42 build 2"]]);
    expect(sup.status(w.id).remote_control).toEqual({ url: "https://claude.ai/code/session_test" });
    expect(snapshot(sup).workers.find((x) => x.id === w.id)!.remote_url).toBe("https://claude.ai/code/session_test");
    expect(store.auditLog(20).some((a) => a.action === "remote-control" && a.worker_id === w.id)).toBe(true);
  });

  it("is on for every worker unless its role or project turns it off, and never for a consult", async () => {
    expect(testConfig(dir, "  studio:\n    path: /s\n    remote_control: false\n    roles:\n      ann: { dir: /s/a }\n      bo: { dir: /s/b, remote_control: true }\n").projects.get("studio")!.roles.get("ann")!.remoteControl).toBe(false);
    expect(testConfig(dir, "  studio:\n    path: /s\n    remote_control: false\n    roles:\n      ann: { dir: /s/a }\n      bo: { dir: /s/b, remote_control: true }\n").projects.get("studio")!.roles.get("bo")!.remoteControl).toBe(true);
    expect(testConfig(dir).projects.get("helix")!.roles.get("bill")!.remoteControl).toBe(true);
    expect(testConfig(dir, "remote_control: false\n").projects.get("helix")!.roles.get("bill")!.remoteControl).toBe(false);
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "studio", role: "cy", task: "x" });
    await until(() => sessions.length === 1);
    await tick(20);
    expect(sessions[0]!.remoteCalls).toEqual([]);
    expect(sup.status(w.id).remote_control).toBeNull();
  });

  it("says why when the SDK has no such method, and the worker runs on", async () => {
    const { sup, broker, sessions } = await setup({ remoteControl: false });
    const w = sup.spawn({ project: "studio", role: "ann", task: "draw" });
    await until(() => sessions.length === 1);
    await until(() => broker.toOrchestrator().some((b) => b.includes("runs without Remote Control")));
    expect(sup.status(w.id).remote_control).toMatchObject({ error: expect.stringMatching(/no enableRemoteControl/) });
    expect(sup.status(w.id).state).toBe("running");
  });
});

describe("a lead", () => {
  it("waits for its next message after a result and ends only when stopped", async () => {
    const { sup, lead, leadSession: s } = await withLead();
    s.turnDone("planned");
    await tick(20);
    expect(sup.status(lead.id).state).toBe("running");
    const run = (sup as unknown as { runs: Map<string, { idle: boolean }> }).runs.get(lead.id)!;
    expect(run.idle).toBe(true);
    // A message to Bob is its next turn.
    sup.onPush(pushMsg("Bob@mbp-1", true, "LAND-42.3 is Ready"));
    await until(() => s.inputs.length === 2);
    expect(s.inputs[1]).toContain("LAND-42.3 is Ready");
    expect(run.idle).toBe(false);
    s.turnDone("answered");
    await tick(20);
    // Stopped between turns: its last turn runs, then it ends.
    const stopping = sup.stop(lead.id);
    await until(() => s.inputs.length === 3);
    expect(s.inputs[2]).toMatch(/You are being stopped/);
    s.turnDone("handoff written");
    await stopping;
    await until(() => sup.status(lead.id).state === "stopped");
  });

  it("is never stalled by the clock, idle or in a long call", async () => {
    const { sup, lead, leadSession: s } = await withLead();
    const run = (sup as unknown as { runs: Map<string, { lastEventAt: number; toolsInFlight: number }> }).runs.get(lead.id)!;
    run.toolsInFlight = 1;
    run.lastEventAt = Date.now() - 5 * 3600_000;
    (sup as unknown as { checkStalls: () => void }).checkStalls();
    expect(s.interrupted).toBe(false);
  });

  it("holds no worker slot: it starts past the cap, and its builders don't wait behind it", async () => {
    const { sup, sessions } = await setup();
    const a = sup.spawn({ project: "helix", role: "bill", task: "a" });
    const b = sup.spawn({ project: "helix", role: "marvin", task: "b" });
    const lead = sup.spawn({ project: "studio", role: "bob", task: "lead" });
    await until(() => sessions.length === 3);
    expect([a, b, lead].map((w) => sup.status(w.id).state)).toEqual(["running", "running", "running"]);
    expect(sup.spawn({ project: "studio", role: "ann", task: "c" }).note).toMatch(/2 workers running, the laptop's limit/);
  });

  it("has no rules but the two guards: the supervisor's folder and the hooks", async () => {
    const { sup, leadSession: s, sessions } = await withLead();
    const lead = { project: "studio", role: "bob", writeRoots: ["/work/studio-bob"], cwd: "/work/studio-bob", lead: true };
    // A builder's deny rule doesn't bind it; auto mode judges the call, as for the interactive orchestrator.
    expect(POLICY.preflight("Bash", { command: "git push -q origin HEAD:main" }, lead)).toBeNull();
    expect(POLICY.preflight("Bash", { command: "git push" }, { ...lead, lead: false })).toMatchObject({ decision: "deny", rule: "no-push" });
    // No slot either: it ran none as the interactive orchestrator.
    expect(POLICY.preflight("Bash", { command: "pnpm test" }, lead)).toBeNull();
    // Writes anywhere, as before.
    expect(POLICY.preflight("Write", { file_path: "/work/helix/lead/notes.md" }, lead)).toBeNull();
    expect(POLICY.preflight("Bash", { command: `cat ${SUPERVISOR_DIR}/supervisor.token` }, lead)).toMatchObject({ decision: "deny", rule: "builtin:supervisor" });
    expect(POLICY.preflight("Bash", { command: "git commit --no-verify -m x" }, lead)).toMatchObject({ decision: "deny", rule: "builtin:no-verify" });
    // What auto mode leaves open is Casper's, and waits for him: no timeout.
    void s.ask("Bash", { command: "rm -rf build" });
    await until(() => sup.pending().length === 1);
    expect(sup.pending()[0]).toMatchObject({ tier: "human", rule: "lead" });
    expect((sup as unknown as { router: { waiting: Map<string, { timer: unknown }> } }).router.waiting.values().next().value!.timer).toBeNull();
    expect(sessions.length).toBe(1);
  });

  it("asks Casper in its own session, not through a request", async () => {
    const { sup, broker, leadSession: s } = await withLead();
    const r = await s.ask("AskUserQuestion", { questions: [] });
    expect(r).toMatchObject({ behavior: "deny", message: expect.stringMatching(/Ask Casper in your reply.*Remote Control session/s) });
    expect(sup.pending()).toEqual([]);
    expect(broker.toOrchestrator().filter((b) => b.includes("asks a question"))).toEqual([]);
  });

  it("has the orchestrator's BobNet tools and keeps its own status", async () => {
    const { sup, broker, leadSession: s, sessions } = await withLead();
    sup.spawn({ project: "studio", role: "ann", task: "x" });
    await until(() => sessions.length === 2);
    expect(Object.keys(s.options.mcpServers!)).toEqual(["bobnet", "supervisor"]);
    expect(Object.keys(sessions[1]!.options.mcpServers!)).toEqual(["bobnet"]);
    const tools = (srv: unknown) => Object.keys((srv as { instance: { _registeredTools: Record<string, unknown> } }).instance._registeredTools);
    expect(tools(s.options.mcpServers!["bobnet"])).toEqual(expect.arrayContaining(["send_message", "broadcast", "post_update", "update_status"]));
    expect(tools(sessions[1]!.options.mcpServers!["bobnet"])).not.toContain("broadcast");
    expect(tools(s.options.mcpServers!["supervisor"])).toEqual(expect.arrayContaining(["spawn_worker", "answer_request", "audit_log", "take_slot", "order_run_queue"]));
    // The supervisor sets Bob's idle status at its start, never "worker … running" over the lead's own.
    expect(broker.statuses.filter((x) => x.as === "Bob").map((x) => x.status)).toEqual(["role · no worker running (messages wait for the next one)"]);
    expect(s.options.systemPrompt).toMatchObject({ append: expect.stringMatching(/Ending a turn doesn't end you/) });
  });

  it("gets the info-only news with its next message, as the interactive orchestrator did", async () => {
    const { sup, leadSession: s } = await withLead();
    sup.onPush({ t: "presence", event: "joined", peer: { address: "poe@ubu1", name: "poe", laptop: "ubu1", team: "portfolio", purpose: "Portfolio orchestrator", expertise: [], status: null, online: true, last_seen: "2026-11-07T00:00:00Z" } } as never);
    sup.onPush(pushMsg("Bob@mbp-1", false, "release cut"));
    await tick(20);
    expect(s.inputs.length).toBe(1);
    sup.onPush(pushMsg("Bob@mbp-1", true, "LAND-42.3 is Ready"));
    await until(() => s.inputs.length === 2);
    expect(s.inputs[1]).toMatch(/LAND-42\.3 is Ready[\s\S]*Queued BobNet updates[\s\S]*broadcast: release cut[\s\S]*poe@ubu1 \[team: portfolio\] joined/);
  });
});

describe("the lead's tools", () => {
  it("are the orchestrator's, in every project, its spawns its own", async () => {
    const { lead, call } = await withLead();
    const ann = await call("spawn_worker", { project: "studio", role: "ann", task: "draw" });
    expect(ann).toMatchObject({ project: "studio", spawned_by: lead.id });
    expect(store.auditLog(10).find((x) => x.action === "spawn" && x.worker_id === ann.id)!.actor).toBe(lead.id);
    const bill = await call("spawn_worker", { project: "helix", role: "bill", task: "x" });
    expect(bill).toMatchObject({ project: "helix", spawned_by: lead.id });
    expect((await call("list_projects")).map((p: { key: string }) => p.key)).toEqual(["helix", "games", "studio"]);
    await expect(call("stop_worker", { id: lead.id })).rejects.toThrow(/can't stop yourself/);
    await expect(call("reset_worker", { id: lead.id })).rejects.toThrow(/can't reset yourself/);
    // A reset by the lead makes the fresh worker the lead's.
    const fresh = await call("reset_worker", { id: ann.id });
    expect(fresh.spawned_by).toBe(lead.id);
  });

  it("answer any worker's request, a human-tier one only with Casper's word, never its own", async () => {
    const { sup, call, leadSession: s, sessions } = await withLead();
    const cy = sup.spawn({ project: "studio", role: "cy", task: "y" }); // the interactive orchestrator's
    await until(() => sessions.length === 2);
    const allowed = sessions[1]!.ask("WebFetch", { url: "https://c" });
    await until(() => sup.pending().length === 1);
    const req = sup.pending()[0]!.id;
    expect(await call("answer_request", { id: req, decision: "allow" })).toMatchObject({ state: "answered" });
    await expect(allowed).resolves.toMatchObject({ behavior: "allow" });
    expect(cy.spawned_by).toBe("orchestrator");

    // Its own request: Casper's, even with user_decided.
    void s.ask("Bash", { command: "rm -rf build" });
    await until(() => sup.pending().length === 1);
    const own = sup.pending()[0]!.id;
    await expect(call("answer_request", { id: own, decision: "allow", user_decided: true })).rejects.toThrow(/your own request; Casper answers it/);
    expect(sup.pending().map((r) => r.id)).toEqual([own]);
  });
});
