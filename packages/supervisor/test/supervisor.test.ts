import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Envelope } from "@bobnet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSupervisorConfig } from "../src/config.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { landSummary, powerNote, Supervisor, taskRef } from "../src/supervisor.ts";
import { gitWriteDirs, WORKER_TOOLS } from "../src/worker.ts";
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

/** Accepts only the token "good-token" for owner@example.com. */
const ownerCheck = async (token: string, email: string) => token === "good-token" && email === "owner@example.com";

async function setup(over = "", s = store) {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery();
  const sup = new Supervisor({ config: testConfig(dir, over), policy: POLICY, store: s, broker, queryFn, log: quiet, ownerCheck });
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

describe("lean workers", () => {
  it("gives a worker only its tools and its own MCP servers, without tool search", async () => {
    const { sup, sessions } = await setup("sandbox_write: [/home/me/.local/state/fnm_multishells]");
    sup.spawn({ project: "helix", role: "bill", task: "x" });
    await until(() => sessions.length === 1);
    const o = sessions[0]!.options;
    expect(o.tools).toEqual(WORKER_TOOLS);
    expect(o.strictMcpConfig).toBe(true);
    expect(Object.keys(o.mcpServers!)).toEqual(["bobnet"]);
    expect(o.settings).toBeUndefined();
    expect(o.env).toMatchObject({ ENABLE_TOOL_SEARCH: "false" });
    expect(o.sandbox!.filesystem!.allowWrite).toContain("/home/me/.local/state/fnm_multishells");
  });

  it("reads a role's servers from the project's .mcp.json and sets its memory folder", () => {
    const project = join(dir, "helix");
    mkdirSync(project);
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { backlog: { command: "backlog" }, landai: { type: "http", url: "x" } } }));
    const c = parseSupervisorConfig(
      `orchestrator: Bob\nprojects:\n  helix:\n    path: ${project}\n    memory_dir: /mem/workers\n    roles:\n` +
        `      riker: { dir: ${project}/product, mcp: [backlog] }\n      bill: { dir: ${project}/arch, memory_dir: false }\n`,
      (d) => d,
    );
    const roles = c.projects.get("helix")!.roles;
    expect(roles.get("riker")).toMatchObject({ mcpServers: { backlog: { command: "backlog" } }, memoryDir: "/mem/workers" });
    expect(roles.get("bill")).toMatchObject({ mcpServers: {}, memoryDir: false });
    expect(() =>
      parseSupervisorConfig(`orchestrator: Bob\nprojects:\n  helix:\n    path: ${project}\n    roles: { riker: { dir: /x, mcp: [nope] } }\n`, (d) => d),
    ).toThrow(/no server nope/);
  });

  it("passes the memory folder and role servers to the worker", async () => {
    const project = join(dir, "games");
    mkdirSync(project);
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { backlog: { command: "backlog" } } }));
    const broker = new FakeBroker();
    const { queryFn, sessions } = fakeQuery();
    const config = parseSupervisorConfig(
      `orchestrator: Bob\nstate_dir: ${dir}\nprojects:\n  games:\n    path: ${project}\n    roles:\n      mario: { dir: ${project}, mcp: [backlog], memory_dir: /mem/m }\n`,
      (d) => d,
    );
    const sup = new Supervisor({ config, policy: POLICY, store, broker, queryFn, log: quiet, ownerCheck });
    await sup.start();
    running.push(sup);
    sup.spawn({ project: "games", role: "mario", task: "x" });
    await until(() => sessions.length === 1);
    expect(Object.keys(sessions[0]!.options.mcpServers!).sort()).toEqual(["backlog", "bobnet"]);
    expect(sessions[0]!.options.settings).toEqual({ autoMemoryDirectory: "/mem/m" });
  });

  it("marks each role's peer entry with whether a worker runs behind it", async () => {
    const { sup, broker, sessions } = await setup();
    await until(() => broker.statuses.some((s) => s.as === "Bill"));
    expect(broker.statuses.find((s) => s.as === "Bill")!.status).toMatch(/^role · no worker running/);
    const w = sup.spawn({ project: "helix", role: "bill", task: "x" });
    await until(() => sessions.length === 1);
    await until(() => broker.statuses.at(-1)?.status === `role · worker ${w.id} running`);
    sessions[0]!.finish();
    await until(() => broker.statuses.at(-1)?.as === "Bill" && /no worker running/.test(broker.statuses.at(-1)!.status ?? ""));
  });
});

describe("taskRef", () => {
  it("picks the most specific task number, the first on a tie", () => {
    expect(taskRef("LAND-41 design session (Bob's plan). Your task: LAND-41.2 (Ready), the prototype")).toBe("LAND-41.2");
    expect(taskRef("LAND-41.4 · note on main f2017530 · needs LAND-41.1")).toBe("LAND-41.4");
    expect(taskRef("Finish your ADR 0094 §6 task")).toBeUndefined();
  });
});

describe("landSummary", () => {
  it("keeps the landed line with main's hashes, not just the last line", () => {
    const out = "verify passed\nlanded: land/Bill 11943fbf: main e2d601ee → 1165f8b0\n  11943fbf → 1165f8b0 ADR 0094\n  Quote these hashes from main.\n";
    expect(landSummary(out)).toBe("landed: land/Bill 11943fbf: main e2d601ee → 1165f8b0\n  11943fbf → 1165f8b0 ADR 0094\n  Quote these hashes from main.");
    expect(landSummary("a\nb\n")).toBe("b");
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

  it("posts progress to Session updates led by the task number, and none for a consult", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "LAND-41 design session. Your task: LAND-41.1, the ADR" });
    await until(() => sessions.length === 1);
    sessions[0]!.finish();
    await until(() => sup.status(w.id).state === "done");
    expect(broker.updates).toEqual(["Bill: LAND-41.1 · started", "Bill: LAND-41.1 · done"]);
  });

  it("runs a worker on its role's model and effort, which a spawn may override within the role's limits", async () => {
    const config = testConfig(dir);
    const bill = config.projects.get("helix")!.roles.get("bill")!;
    Object.assign(bill, { model: "opus", effort: "high", models: ["opus", "sonnet"], maxEffort: "xhigh" });
    const broker = new FakeBroker();
    const { queryFn, sessions } = fakeQuery();
    const sup = new Supervisor({ config, policy: POLICY, store, broker, queryFn, log: quiet, ownerCheck });
    await sup.start();
    running.push(sup);
    const w = sup.spawn({ project: "helix", role: "bill", task: "LAND-41.1 · the ADR" });
    await until(() => sessions.length === 1);
    expect(sessions[0]!.options).toMatchObject({ model: "opus", effort: "high" });
    expect(sup.status(w.id)).toMatchObject({ model: "opus", effort: "high" });
    expect(broker.updates.at(-1)).toBe("Bill: LAND-41.1 · started on opus/high");

    expect(() => sup.spawn({ project: "helix", role: "bill", task: "t", model: "haiku" })).toThrow(/may run on opus, sonnet, not haiku/);
    expect(() => sup.spawn({ project: "helix", role: "bill", task: "t", effort: "max" })).toThrow(/capped at xhigh/);

    // A reset keeps what it ran on unless told otherwise.
    const again = await sup.reset(w.id, { effort: "xhigh" });
    expect(again).toMatchObject({ model: "opus", effort: "xhigh" });
    await until(() => sessions.length === 2);
    expect(sessions[1]!.options).toMatchObject({ model: "opus", effort: "xhigh" });
    expect(broker.updates.at(-1)).toBe("Bill: LAND-41.1 · started on opus/xhigh (above the role's effort high)");
  });

  it("notes what a run is on, and what is above the role's default", () => {
    const role = { model: "sonnet", effort: "medium" as const };
    expect(powerNote({ model: null, effort: null }, role)).toBe("");
    expect(powerNote({ model: "sonnet", effort: "low" }, role)).toBe(" on sonnet/low");
    expect(powerNote({ model: "opus", effort: "max" }, role)).toBe(" on opus/max (above the role's model sonnet and effort medium)");
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

describe("usage and snapshots", () => {
  it("counts tokens live, takes the SDK's totals at the end, and rolls them up per role and day", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sessions[0]!.say("thinking", { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 });
    await until(() => sup.snapshot().workers[0]!.tokens.input === 1000);
    expect(sup.snapshot().workers[0]).toMatchObject({ id: w.id, name: "Bill", state: "running", tokens: { input: 1000, output: 200, cache_read: 5000 }, cost_usd: 0 });

    sessions[0]!.totals = { inputTokens: 1500, outputTokens: 300, cacheReadInputTokens: 6000, cacheCreationInputTokens: 400, costUSD: 0.42 };
    sessions[0]!.finish();
    await until(() => sup.status(w.id).state === "done");
    const snap = sup.snapshot();
    expect(snap.workers[0]).toMatchObject({ state: "done", tokens: { input: 1500, output: 300, cache_read: 6000, cache_write: 400 }, cost_usd: 0.42 });
    expect(snap.usage).toEqual([
      { day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), project: "helix", role: "bill", model: null, workers: 1, tokens: { input: 1500, output: 300, cache_read: 6000, cache_write: 400 }, cost_usd: 0.42 },
    ]);
    expect(snap.supervisor).toMatchObject({ concurrency: 2, active: 0, queued: 0 });
    await until(() => broker.reports.length > 0);
  });

  it("counts a response once, though the SDK repeats its usage on every content block", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const usage = { input_tokens: 10, output_tokens: 6, cache_read_input_tokens: 39385, cache_creation_input_tokens: 0 };
    const block = (id: string, u = usage) =>
      sessions[0]!.emit({ type: "assistant", message: { id, content: [{ type: "text", text: "x" }], usage: u } } as never);
    block("msg_1");
    block("msg_1");
    block("msg_1", { ...usage, output_tokens: 9 });
    block("msg_2");
    await until(() => sup.snapshot().workers[0]!.tokens.input === 20);
    expect(sup.snapshot().workers[0]!.tokens).toEqual({ input: 20, output: 15, cache_read: 78770, cache_write: 0 });
  });

  it("counts only the new part of a resumed session", async () => {
    const { sup, sessions } = await setup();
    const first = sup.spawn({ project: "helix", role: "bill", task: "build" });
    await until(() => sessions.length === 1);
    await until(() => store.worker(first.id)!.session_id !== null);
    sessions[0]!.totals = { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.1 };
    sessions[0]!.finish();
    await until(() => sup.status(first.id).state === "done");

    const second = sup.spawn({ project: "helix", role: "bill", task: "fix", resume_session: store.worker(first.id)!.session_id! });
    await until(() => sessions.length === 2);
    // The SDK's totals for the resumed session include the first run.
    sessions[1]!.totals = { inputTokens: 1600, outputTokens: 150, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.16 };
    sessions[1]!.finish();
    await until(() => sup.status(second.id).state === "done");
    const byId = new Map(sup.snapshot().workers.map((w) => [w.id, w]));
    expect(byId.get(second.id)).toMatchObject({ tokens: { input: 600, output: 50 } });
    expect(byId.get(second.id)!.cost_usd).toBeCloseTo(0.06);
    expect(sup.snapshot().usage[0]!.tokens.input).toBe(1600);
  });

  it("shows pending requests in the snapshot", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    void sessions[0]!.ask("Bash", { command: "git push" });
    await until(() => sup.snapshot().pending.length === 1);
    expect(sup.snapshot().pending[0]).toMatchObject({ name: "Bill", kind: "approval", tool: "Bash", tier: "human" });
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

describe("dashboard actions", () => {
  const action = (a: Record<string, unknown>, token = "good-token") =>
    ({ t: "action", id: `a_${Math.random()}`, to: "supervisor@mbp-1", by: "owner@example.com", token, action: a }) as never;

  it("lets the verified owner allow a human-tier request, recorded as theirs", async () => {
    const { sup, broker, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const pending = sessions[0]!.ask("Bash", { command: "git push origin HEAD:main" });
    await until(() => sup.pending().length === 1);
    const id = sup.pending()[0]!.id;
    sup.onPush(action({ kind: "answer", request: id, decision: "allow" }));
    await expect(pending).resolves.toMatchObject({ behavior: "allow" });
    await until(() => broker.results.length === 1);
    expect(broker.results[0]).toMatchObject({ ok: true, message: `${id} allowed` });
    expect(store.request(id)!.decided_by).toBe("human");
    expect(store.auditLog().some((a) => a.actor === "human:owner@example.com" && a.action === "dashboard:answer")).toBe(true);
  });

  it("refuses an action whose owner token doesn't verify, and changes nothing", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sup.onPush(action({ kind: "stop", worker: w.id }, "forged"));
    await until(() => broker.results.length === 1);
    expect(broker.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/couldn't be verified/) });
    expect(sup.status(w.id).state).toBe("running");
  });

  it("stops and resets workers from the dashboard", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "the task" });
    await until(() => sessions.length === 1);
    sup.onPush(action({ kind: "reset", worker: w.id }));
    await until(() => broker.results.length === 1);
    expect(broker.results[0]!.message).toMatch(new RegExp(`${w.id} reset; w_\\w+ starts fresh`));
    await until(() => sessions.length === 2);
    const fresh = sup.list().at(-1)!;
    sup.onPush(action({ kind: "stop", worker: fresh.id }));
    await until(() => broker.results.length === 2);
    expect(broker.results[1]).toMatchObject({ ok: true, message: `${fresh.id} stopped` });
  });

  it("refuses actions when the laptop has no Access settings", async () => {
    const broker = new FakeBroker();
    const { queryFn } = fakeQuery();
    const sup = new Supervisor({ config: testConfig(dir), policy: POLICY, store, broker, queryFn, log: quiet });
    running.push(sup);
    await sup.start();
    sup.onPush(action({ kind: "stop", worker: "w_x" }));
    await until(() => broker.results.length === 1);
    expect(broker.results[0]!.message).toMatch(/aren't set up/);
  });

  it("previews requests for the dashboard, hiding anything that looks like a credential", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    void sessions[0]!.ask("Bash", { command: "git push origin HEAD:main" });
    void sessions[0]!.ask("Bash", { command: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' https://x" });
    await until(() => sup.snapshot().pending.length === 2);
    expect(sup.snapshot().pending.map((p) => p.preview)).toEqual(["git push origin HEAD:main", "[hidden: looks like it contains a credential]"]);
  });
});

describe("dismissing", () => {
  it("closes an orphaned request without resuming anything", async () => {
    const first = await setup();
    first.sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => first.sessions.length === 1);
    void first.sessions[0]!.ask("WebFetch", { url: "https://x" });
    await until(() => first.sup.pending().length === 1);
    const id = first.sup.pending()[0]!.id;
    const second = await setup();
    expect(() => second.sup.answer(id, { decision: "allow" }, "orchestrator", false)).toThrow(/Dismiss/);
    const { resumed } = second.sup.answer(id, { decision: "deny" }, "orchestrator", false);
    expect(resumed).toBeUndefined();
    expect(second.sup.pending()).toEqual([]);
    await tick(30);
    expect(second.sessions).toHaveLength(0);
  });
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

describe("gitWriteDirs", () => {
  it("opens a linked worktree's git data to the sandbox, but not hooks or config", () => {
    const dirs = (): [string, string] => ["/repo/.git/worktrees/bill", "/repo/.git"];
    expect(gitWriteDirs("/repo-bill/arch", ["/repo-bill"], dirs)).toEqual([
      "/repo/.git/worktrees/bill",
      "/repo/.git/objects",
      "/repo/.git/refs",
      "/repo/.git/logs",
      "/repo/.git/packed-refs",
      "/repo/.git/packed-refs.lock",
    ]);
    // A plain checkout's .git is already inside its write root.
    expect(gitWriteDirs("/repo/arch", ["/repo"], () => ["/repo/.git", "/repo/.git"])).toEqual([]);
    expect(gitWriteDirs("/not-git", ["/not-git"], () => null)).toEqual([]);
  });

  it("finds a real worktree's git dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "bobnet-git-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
      git("init", "-q", "main");
      git("-C", "main", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
      git("-C", "main", "worktree", "add", "-q", "../bill");
      const real = realpathSync(root);
      expect(gitWriteDirs(join(real, "bill"), [join(real, "bill")])).toEqual([
        join(real, "main/.git/worktrees/bill"),
        join(real, "main/.git/objects"),
        join(real, "main/.git/refs"),
        join(real, "main/.git/logs"),
        join(real, "main/.git/packed-refs"),
        join(real, "main/.git/packed-refs.lock"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
