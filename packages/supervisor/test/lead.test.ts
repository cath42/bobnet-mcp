import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaptopSnapshot } from "@bobnet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LeadToolDeps } from "../src/lead-tools.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { FakeBroker, fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";

const POLICY = new Policy(`
rules:
  - { id: read, tools: [Read], decision: allow }
  - { id: push, tools: [Bash], command: "^git push", decision: escalate, tier: human }
  - { id: fetch, tools: [WebFetch], decision: escalate, tier: orchestrator }
`);

// A project led by Bob as a worker, beside helix and games (whose orchestrator Bob stays interactive).
const STUDIO = `  studio:
    path: /work/studio
    roles:
      bob: { dir: /work/studio-bob, lead: true, remote_control: true }
      ann: { dir: /work/studio-ann, remote_control: true }
      cy: { dir: /work/studio-cy }
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

/** The lead's tools as the supervisor scopes them. */
const scope = (sup: Supervisor, leadId: string): LeadToolDeps =>
  (sup as unknown as { leadScope: (id: string, role: unknown) => LeadToolDeps }).leadScope(leadId, testConfig(dir, STUDIO).projects.get("studio")!.roles.get("bob"));

const snapshot = (sup: Supervisor) => (sup as unknown as { snapshot: () => LaptopSnapshot }).snapshot();

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

  it("is off unless the role asks for it", async () => {
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
  it("waits for its next message after a result, isn't stalled while it waits, and ends only when stopped", async () => {
    const { sup, sessions } = await setup();
    const lead = sup.spawn({ project: "studio", role: "bob", task: "Lead LAND-42 build 2" });
    await until(() => sessions.length === 1);
    sessions[0]!.turnDone("planned");
    await tick(20);
    expect(sup.status(lead.id).state).toBe("running");
    const run = (sup as unknown as { runs: Map<string, { idle: boolean; lastEventAt: number }> }).runs.get(lead.id)!;
    expect(run.idle).toBe(true);
    // Quiet for an hour between turns is waiting, not stuck.
    run.lastEventAt = Date.now() - 3600_000;
    (sup as unknown as { checkStalls: () => void }).checkStalls();
    expect(sessions[0]!.interrupted).toBe(false);
    // A message to Bob is its next turn.
    sup.onPush({ t: "message", to: "Bob@mbp-1", wake: true, msg: { id: "m_1", type: "message", from: "Riker@mbp-1", to: ["Bob@mbp-1"], team: "land", laptop: "mbp-1", in_reply_to: null, urgent: false, body: "LAND-42.3 is Ready", created_at: "2026-11-07T00:00:00Z", expires_at: "2026-12-07T00:00:00Z" } } as never);
    await until(() => sessions[0]!.inputs.length === 2);
    expect(sessions[0]!.inputs[1]).toContain("LAND-42.3 is Ready");
    expect(run.idle).toBe(false);
    sessions[0]!.turnDone("answered");
    await tick(20);
    // Stopped between turns: its last turn runs, then it ends.
    const stopping = sup.stop(lead.id);
    await until(() => sessions[0]!.inputs.length === 3);
    expect(sessions[0]!.inputs[2]).toMatch(/You are being stopped/);
    sessions[0]!.turnDone("handoff written");
    await stopping;
    await until(() => sup.status(lead.id).state === "stopped");
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

  it("sends its own requests to Casper, and doesn't message itself about them", async () => {
    const { sup, broker, sessions } = await setup();
    const lead = sup.spawn({ project: "studio", role: "bob", task: "lead" });
    await until(() => sessions.length === 1);
    void sessions[0]!.ask("WebFetch", { url: "https://example.com" });
    await until(() => sup.pending().length === 1);
    expect(sup.pending()[0]).toMatchObject({ worker_id: lead.id, tier: "human" });
    void sessions[0]!.ask("AskUserQuestion", { questions: [] });
    await until(() => sup.pending().length === 2);
    expect(sup.pending()[1]).toMatchObject({ kind: "question", tier: "human" });
    expect(broker.toOrchestrator().filter((b) => b.includes("needs approval") || b.includes("asks a question"))).toEqual([]);
  });

  it("gets its tools in-process, never the token, and other workers get none", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "studio", role: "bob", task: "lead" });
    sup.spawn({ project: "studio", role: "ann", task: "x" });
    await until(() => sessions.length === 2);
    expect(Object.keys(sessions[0]!.options.mcpServers!)).toEqual(["bobnet", "supervisor"]);
    expect(Object.keys(sessions[1]!.options.mcpServers!)).toEqual(["bobnet"]);
    expect(sessions[0]!.options.systemPrompt).toMatchObject({ append: expect.stringMatching(/Ending a turn doesn't end you/) });
  });
});

describe("the lead's tools", () => {
  it("spawn and act in its own project only, never on a lead", async () => {
    const { sup, sessions } = await setup();
    const lead = sup.spawn({ project: "studio", role: "bob", task: "lead" });
    await until(() => sessions.length === 1);
    const t = scope(sup, lead.id);
    const ann = t.spawn({ role: "ann", task: "draw" }) as { id: string; project: string; spawned_by: string };
    expect(ann).toMatchObject({ project: "studio", spawned_by: lead.id });
    expect(store.auditLog(10).find((x) => x.action === "spawn" && x.worker_id === ann.id)!.actor).toBe(lead.id);
    expect(() => t.spawn({ role: "bill", task: "x" })).toThrow(/No role bill in studio/);
    expect(() => t.spawn({ role: "bob", task: "x" })).toThrow(/the lead's own role/);
    const helix = sup.spawn({ project: "helix", role: "bill", task: "x" });
    expect(() => t.status(helix.id, false)).toThrow(/is helix's; your tools act in studio only/);
    await expect(t.stop(helix.id)).rejects.toThrow(/studio only/);
    await expect(t.stop(lead.id)).rejects.toThrow(/only Casper stops or resets it/);
    expect((t.list(false, {}) as Array<{ id: string }>).map((w) => w.id).sort()).toEqual([ann.id, lead.id].sort());
    expect(t.project_info()).toMatchObject({ key: "studio", roles: [{ key: "bob" }, { key: "ann" }, { key: "cy" }] });
    expect(t.takeSlot("Dee", "e2e")).toMatchObject({ queued: true });
    expect(() => t.freeSlot("Bill")).toThrow(/Bill isn't studio's/);
    expect(() => t.orderRunQueue(["Dee", "Marvin"])).toThrow(/Marvin isn't studio's/);
    expect(t.freeSlot("Dee")).toBe("Dee's slot freed");
    // A reset by the lead makes the fresh worker the lead's.
    const fresh = (await t.reset(ann.id, {})) as { spawned_by: string };
    expect(fresh.spawned_by).toBe(lead.id);
  });

  it("answer only its own workers' orchestrator-tier requests", async () => {
    const { sup, sessions } = await setup();
    const lead = sup.spawn({ project: "studio", role: "bob", task: "lead" });
    await until(() => sessions.length === 1);
    const t = scope(sup, lead.id);
    const ann = t.spawn({ role: "ann", task: "x" }) as { id: string };
    const cy = sup.spawn({ project: "studio", role: "cy", task: "y" }); // the interactive orchestrator's
    const bill = sup.spawn({ project: "helix", role: "bill", task: "z" });
    await until(() => sessions.length === 3);
    const [, annS, cyS] = sessions;
    const allowed = annS!.ask("WebFetch", { url: "https://a" });
    void annS!.ask("Bash", { command: "git push" });
    void cyS!.ask("WebFetch", { url: "https://c" });
    await until(() => sup.pending().length === 3);
    const req = (worker: string, tool: string) => sup.pending().find((r) => r.worker_id === worker && r.tool === tool)!.id;

    expect((t.pending() as Array<{ id: string; decides: string }>).map((r) => r.decides).sort()).toEqual(["Casper", "the orchestrator that spawned it", "you"]);
    expect(() => t.answer(req(ann.id, "Bash"), { decision: "allow" })).toThrow(/Casper's to decide/);
    expect(() => t.answer(req(cy.id, "WebFetch"), { decision: "allow" })).toThrow(/a worker you didn't spawn/);
    expect(t.answer(req(ann.id, "WebFetch"), { decision: "allow" })).toMatchObject({ state: "answered", decision: "allow" });
    await expect(allowed).resolves.toMatchObject({ behavior: "allow" });

    // Another project's requests aren't even listed. Bill starts once Cy's slot is free.
    void sup.stop(cy.id);
    cyS!.finish();
    await until(() => sessions.length === 4);
    void sessions[3]!.ask("WebFetch", { url: "https://b" });
    await until(() => sup.pending().some((r) => r.worker_id === bill.id));
    expect((t.pending() as Array<{ worker_id: string }>).some((r) => r.worker_id === bill.id)).toBe(false);
    expect(() => t.detail(req(bill.id, "WebFetch"))).toThrow(/isn't one of studio's workers' requests/);
  });
});
