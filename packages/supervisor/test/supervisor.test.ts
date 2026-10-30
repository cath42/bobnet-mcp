import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Envelope } from "@bobnet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSupervisorConfig } from "../src/config.ts";
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

let dir: string;
let store: Store;
let running: Supervisor[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bobnet-sup-"));
  store = new Store(join(dir, "supervisor.db"));
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function setup(over = "", s = store) {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery();
  const sup = new Supervisor({ config: testConfig(dir, over), policy: POLICY, store: s, broker, queryFn, log: quiet });
  await sup.start();
  running.push(sup);
  return { sup, broker, sessions };
}

const msg = (over: Partial<Envelope> = {}): Envelope => ({
  id: "m_x1",
  type: "message",
  from: "Riker@mbp-1",
  to: ["Bill@mbp-1"],
  team: "land",
  laptop: "mbp-1",
  in_reply_to: null,
  urgent: false,
  body: "LAND-41 is Ready, see product/backlog",
  created_at: "2026-10-30T00:00:00Z",
  expires_at: "2026-11-30T00:00:00Z",
  ...over,
});

describe("config", () => {
  it("names roles, resolves write roots and rejects name clashes", () => {
    const c = testConfig(dir);
    const bill = c.projects.get("helix")!.roles.get("bill")!;
    expect(bill).toMatchObject({ name: "Bill", team: "land", writeRoots: ["/work/helix-bill"], sandbox: true });
    expect(() =>
      parseSupervisorConfig(`orchestrator: Bob\nprojects:\n  a: { path: /a, roles: { bob: { dir: /a/b } } }`, (d) => d),
    ).toThrow(/already used by the orchestrator/);
  });
});

describe("lifecycle", () => {
  it("registers the supervisor and every role on BobNet at start", async () => {
    const { broker } = await setup();
    expect(broker.registered.map((r) => r.name)).toEqual(["supervisor", "Bill", "Marvin", "Homer", "Mario"]);
  });

  it("starts a worker in its role folder with project settings, the claude_code prompt and the sandbox", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "Write ADR 0093" });
    await until(() => sessions.length === 1);
    expect(sup.status(w.id).state).toBe("running");
    const o = sessions[0]!.options;
    expect(o.cwd).toBe("/work/helix-bill/architecture");
    expect(o.settingSources).toEqual(["user", "project", "local"]);
    expect(o.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" });
    expect(o.permissionMode).toBe("default");
    expect(o.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false });
    expect(o.sandbox!.filesystem!.allowWrite).toContain("/work/helix-bill");
    expect(o.disallowedTools).toContain("mcp__bobnet-mcp");
    expect(o.allowedTools).toBeUndefined();
    await expect(
      o.canUseTool!("mcp__bobnet__send_message", { to: "Bob", body: "x" }, { signal: new AbortController().signal, mcpServer: { name: "bobnet", source: "sdk" } } as never),
    ).resolves.toMatchObject({ behavior: "allow" });
    // A configured server that merely calls itself "bobnet" gets no such pass.
    void o.canUseTool!("mcp__bobnet__send_message", {}, { signal: new AbortController().signal, mcpServer: { name: "bobnet", source: "project" } } as never);
    await until(() => sup.pending().length === 1);
    expect(o.env).toMatchObject({ BOBNET_SUPERVISED: "1", BOBNET_WORKER_ID: w.id });
    await until(() => sessions[0]!.inputs.length === 1);
    expect(sessions[0]!.inputs[0]).toContain("Write ADR 0093");
    expect(sessions[0]!.inputs[0]).toContain(`handoffs/helix/${w.id}.md`);
    // The impostor "bobnet" call above is waiting on an answer.
    expect(sup.status(w.id).state).toBe("waiting-approval");
  });

  it("reports completion with the checkpoint to the orchestrator and frees the slot", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    store.updateWorker(w.id, { checkpoint: "F12-b · story 3 · design done" });
    sessions[0]!.say("Wrote the ADR.");
    sessions[0]!.finish();
    await until(() => sup.status(w.id).state === "done");
    expect(broker.toOrchestrator().at(-1)).toMatch(/Bill \(w_\w+, helix\/bill\) done: F12-b · story 3 · design done/);
    expect(sup.summary(w.id)).toMatchObject({ result: "all done", last_message: "Wrote the ADR." });
    expect(sup.tail(w.id, 10).join("\n")).toMatch(/say  Wrote the ADR\.[\s\S]*end  success/);
  });

  it("caps concurrency and runs the queue by project priority, then age", async () => {
    const { sup, sessions } = await setup();
    const homer = sup.spawn({ project: "helix", role: "homer", task: "h" });
    sup.spawn({ project: "helix", role: "marvin", task: "m" });
    const mario = sup.spawn({ project: "games", role: "mario", task: "g" });
    const bill = sup.spawn({ project: "helix", role: "bill", task: "b" });
    await until(() => sessions.length === 2);
    expect([sup.status(mario.id).state, sup.status(bill.id).state]).toEqual(["queued", "queued"]);
    sessions[0]!.finish();
    await until(() => sup.status(homer.id).state === "done");
    // helix (priority 1) goes before games (priority 5), though games queued first.
    await until(() => sessions.length === 3);
    expect([sup.status(bill.id).state, sup.status(mario.id).state]).toEqual(["running", "queued"]);
  });

  it("never runs the same role twice at once", async () => {
    const { sup, sessions } = await setup();
    const b1 = sup.spawn({ project: "helix", role: "bill", task: "b1" });
    const b2 = sup.spawn({ project: "helix", role: "bill", task: "b2" });
    await until(() => sessions.length === 1);
    await tick(30);
    expect([sup.status(b1.id).state, sup.status(b2.id).state, sessions.length]).toEqual(["running", "queued", 1]);
    sessions[0]!.finish();
    await until(() => sessions.length === 2);
    expect(sup.status(b2.id).state).toBe("running");
  });

  it("stops gracefully, and reset starts a fresh worker on the same task", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "the task" });
    await until(() => sessions.length === 1);
    const fresh = await sup.reset(w.id);
    expect(sessions[0]!.interrupted).toBe(true);
    await until(() => sup.status(w.id).state === "stopped");
    await until(() => sessions.length === 2);
    expect(fresh.id).not.toBe(w.id);
    expect(sessions[1]!.options.resume).toBeUndefined();
    await until(() => sessions[1]!.inputs.length === 1);
    expect(sessions[1]!.inputs[0]).toContain("the task");
  });

  it("resumes a session by id when asked", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "fix review notes", resume_session: "sess-abc" });
    await until(() => sessions.length === 1);
    expect(sessions[0]!.options.resume).toBe("sess-abc");
  });

  it("marks a failed session", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sessions[0]!.fail();
    await until(() => sup.status(w.id).state === "failed");
    expect(broker.toOrchestrator().at(-1)).toContain("failed: error_during_execution");
  });

  it("writes status.json", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const status = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
    expect(status.workers).toEqual([expect.objectContaining({ id: w.id, name: "Bill", state: "running" })]);
  });
});

describe("approvals and questions", () => {
  it("applies policy without bothering anyone", async () => {
    const { sup, broker, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    await expect(sessions[0]!.ask("Read", { file_path: "/x" })).resolves.toMatchObject({ behavior: "allow" });
    await expect(sessions[0]!.ask("Write", { file_path: "/elsewhere/x" })).resolves.toMatchObject({ behavior: "deny" });
    expect(broker.toOrchestrator()).toEqual([]);
  });

  it("always lets a worker write its own handoff file, and no other file there", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const handoff = sup.status(w.id).handoff!;
    await expect(sessions[0]!.ask("Write", { file_path: handoff, content: "x" })).resolves.toMatchObject({ behavior: "allow" });
    // Another worker's handoff is outside this role's write roots: denied, not even escalated.
    await expect(sessions[0]!.ask("Write", { file_path: handoff.replace(w.id, "w_other"), content: "x" })).resolves.toMatchObject({
      behavior: "deny",
    });
  });

  it("escalates, holds the worker, and releases it on the orchestrator's answer", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const pending = sessions[0]!.ask("WebFetch", { url: "https://docs.example" });
    await until(() => sup.pending().length === 1);
    const [req] = sup.pending();
    expect(req).toMatchObject({ kind: "approval", tool: "WebFetch", tier: "orchestrator", worker: "Bill" });
    expect(sup.status(w.id).state).toBe("waiting-approval");
    expect(broker.toOrchestrator().at(-1)).toContain(`Bill needs approval for WebFetch (${req!.id}`);
    sup.answer(req!.id, { decision: "allow" }, "orchestrator");
    await expect(pending).resolves.toEqual({ behavior: "allow", updatedInput: { url: "https://docs.example" } });
    expect(sup.status(w.id).state).toBe("running");
    expect(sup.pending()).toEqual([]);
  });

  it("only takes the user's own decision on human-tier requests", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const pending = sessions[0]!.ask("Bash", { command: "git push origin HEAD:main" });
    await until(() => sup.pending().length === 1);
    const id = sup.pending()[0]!.id;
    expect(() => sup.answer(id, { decision: "allow" }, "orchestrator")).toThrow(/needs the user's own decision/);
    sup.answer(id, { decision: "deny", message: "not now" }, "human");
    await expect(pending).resolves.toEqual({ behavior: "deny", message: "Denied: not now" });
    expect(store.auditLog().some((a) => a.actor === "human" && a.action === "answer:deny")).toBe(true);
  });

  it("routes AskUserQuestion as a question and returns the answers in the tool input", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const input = { questions: [{ question: "Which index?", header: "Index", options: [{ label: "GiST" }, { label: "BRIN" }], multiSelect: false }] };
    const pending = sessions[0]!.ask("AskUserQuestion", input);
    await until(() => sup.pending().length === 1);
    const req = sup.pending()[0]!;
    expect(req).toMatchObject({ kind: "question", tier: "orchestrator" });
    expect(sup.status(w.id).state).toBe("waiting-answer");
    expect(() => sup.answer(req.id, { decision: "allow" }, "orchestrator")).toThrow(/is a question/);
    sup.answer(req.id, { decision: "answer", answers: { "Which index?": "GiST" } }, "orchestrator");
    await expect(pending).resolves.toEqual({ behavior: "allow", updatedInput: { ...input, answers: { "Which index?": "GiST" } } });
  });

  it("times out to a deny that tells the worker to use its handoff file", async () => {
    const { sup, sessions } = await setup("request_timeout_minutes: 0.001");
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const r = await sessions[0]!.ask("WebFetch", { url: "https://x" });
    expect(r).toMatchObject({ behavior: "deny" });
    expect((r as { message: string }).message).toMatch(/Open questions in your handoff file/);
    expect(store.requests(["expired"])).toHaveLength(1);
  });
});

describe("restart", () => {
  it("fails orphaned workers, keeps their requests answerable, and resumes the session on answer", async () => {
    const first = await setup();
    const w = first.sup.spawn({ project: "helix", role: "bill", task: "push the ADR" });
    await until(() => first.sessions.length === 1);
    await until(() => store.worker(w.id)!.session_id !== null);
    void first.sessions[0]!.ask("WebFetch", { url: "https://x" });
    await until(() => first.sup.pending().length === 1);
    const reqId = first.sup.pending()[0]!.id;
    const sessionId = store.worker(w.id)!.session_id!;

    // The supervisor dies; a new one starts on the same store.
    const second = await setup();
    expect(store.worker(w.id)).toMatchObject({ state: "failed", error: "supervisor restarted" });
    expect(second.sup.pending()[0]).toMatchObject({ id: reqId, state: "orphaned" });
    expect(second.broker.toOrchestrator()[0]).toContain(`Requests still answerable (answering resumes the worker): ${reqId}`);

    const { resumed } = second.sup.answer(reqId, { decision: "allow" }, "orchestrator");
    expect(resumed).toBeDefined();
    await until(() => second.sessions.length === 1);
    const s = second.sessions[0]!;
    expect(s.options.resume).toBe(sessionId);
    await until(() => s.inputs.length === 1);
    expect(s.inputs[0]).toMatch(new RegExp(`request ${reqId} \\(WebFetch\\)\\. It has been approved; retry it now`));
    // The approved call goes through once without a second escalation; the next one asks again.
    await expect(s.ask("WebFetch", { url: "https://x" })).resolves.toMatchObject({ behavior: "allow" });
    void s.ask("WebFetch", { url: "https://x" });
    await until(() => second.sup.pending().length === 1);
  });
});

describe("notifications", () => {
  it("keeps what the broker refuses and sends it when the orchestrator joins", async () => {
    const { sup, broker, sessions } = await setup();
    const realRequest = broker.request.bind(broker);
    let reachable = false;
    broker.request = (async (frame: Parameters<typeof broker.request>[0]) => {
      if (frame.t === "send" && !reachable) throw Object.assign(new Error("No such peer: Bob"), { code: "unknown_peer" });
      return realRequest(frame);
    }) as typeof broker.request;
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sessions[0]!.finish();
    await until(() => sup.status(w.id).state === "done");
    await until(() => store.outbox().length === 1);
    reachable = true;
    sup.onPush({ t: "presence", event: "joined", peer: { address: "Bob@mbp-1", name: "Bob", laptop: "mbp-1", team: null, purpose: null, expertise: [], status: null, online: true, last_seen: "" } });
    await until(() => store.outbox().length === 0);
    expect(broker.toOrchestrator().at(-1)).toMatch(/^\(sent .+\) Bill \(w_\w+, helix\/bill\) done/);
  });

  it("retries registration while an old connection still holds the names", async () => {
    const broker = new FakeBroker();
    let refusals = 1;
    const realRegister = broker.register.bind(broker);
    broker.register = async (id) => {
      if (refusals-- > 0) throw Object.assign(new Error("in use"), { code: "name_in_use" });
      return realRegister(id);
    };
    const { queryFn } = fakeQuery();
    const sup = new Supervisor({ config: testConfig(dir), policy: POLICY, store, broker, queryFn, log: quiet });
    running.push(sup);
    await sup.start();
    expect(broker.registered.map((r) => r.name)).toContain("supervisor");
  }, 15_000);
});

describe("BobNet messages", () => {
  it("hands a directed message to the role's running worker and acks it", async () => {
    const { sup, broker, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sup.onPush({ t: "deliver", to: "Bill@mbp-1", wake: true, msg: msg() });
    await until(() => sessions[0]!.inputs.length === 2);
    expect(sessions[0]!.inputs[1]).toMatch(/^\[BobNet\] Message from Riker@mbp-1 \(message_id m_x1\)/);
    expect(broker.acks).toContainEqual({ as: "Bill", ids: ["m_x1"] });
  });

  it("keeps a message for an idle role, tells the orchestrator once, and gives it to the next worker", async () => {
    const { sup, broker, sessions } = await setup();
    sup.onPush({ t: "deliver", to: "Bill@mbp-1", wake: true, msg: msg() });
    sup.onPush({ t: "deliver", to: "Bill@mbp-1", wake: true, msg: msg() });
    expect(broker.toOrchestrator().filter((b) => b.includes("Riker@mbp-1 messaged Bill"))).toHaveLength(1);
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1 && sessions[0]!.inputs.length === 1);
    expect(sessions[0]!.inputs[0]).toContain("Messages that arrived for you while no worker was running");
    expect(sessions[0]!.inputs[0]).toContain("LAND-41 is Ready");
    expect(store.waiting("helix", "bill")).toEqual([]);
    expect(w.id).toBeTruthy();
  });

  it("drops quiet broadcasts for workers but acks them", async () => {
    const { sup, broker, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sup.onPush({ t: "deliver", to: "Bill@mbp-1", wake: false, msg: msg({ id: "m_b", type: "broadcast" }) });
    await tick(30);
    expect(sessions[0]!.inputs).toHaveLength(1);
    expect(broker.acks).toContainEqual({ as: "Bill", ids: ["m_b"] });
  });
});
