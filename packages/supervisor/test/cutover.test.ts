import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSupervisorConfig } from "../src/config.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { workerEnv } from "../src/worker.ts";
import { FakeBroker, fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";

// What the helix cutover needs from the supervisor: workers billed only to the
// subscription, an orchestrator per project, run slots and a hold, landing
// through the project's command, and consults between roles.

const POLICY = new Policy(`
rules:
  - { id: read, tools: [Read], decision: allow }
  - { id: tests, tools: [Bash], command: "^pnpm test( |$)", decision: allow, slot: true }
  - { id: probe, tools: [Bash], command: "^psql ", decision: escalate, tier: orchestrator, slot: true }
`);

let dir: string;
let store: Store;
let running: Supervisor[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bobnet-cut-"));
  store = new Store(join(dir, "supervisor.db"));
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Sets or lifts the hold, as `pnpm integrate hold` / `release` would, and lets the supervisor see it. */
function hold(sup: Supervisor, reason: string | null, allow: string[] = []) {
  const file = join(dir, "land-hold");
  if (reason === null) rmSync(file, { force: true });
  else writeFileSync(file, JSON.stringify({ reason, allow }));
  sup.checkHold();
}

async function setup(over = "", config = testConfig(dir, over)) {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery();
  const sup = new Supervisor({ config, policy: POLICY, store, broker, queryFn, log: quiet, sandboxCheck: async () => null });
  await sup.start();
  running.push(sup);
  return { sup, broker, sessions };
}

describe("billing guard", () => {
  it("never hands a worker an API key or another provider's switch", () => {
    const env = workerEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "x", ANTHROPIC_AUTH_TOKEN: "y", CLAUDE_CODE_USE_BEDROCK: "1", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("never hands a worker the laptop's broker credentials (Linux keeps them in the supervisor's environment)", () => {
    expect(workerEnv({ PATH: "/bin", BOBNET_ACCESS_CLIENT_ID: "a.access", BOBNET_ACCESS_CLIENT_SECRET: "s" })).toEqual({ PATH: "/bin" });
  });

  it("refuses a key in a role's or a project's env", () => {
    const base = (env: string) =>
      `orchestrator: Bob\nprojects:\n  a:\n    path: /a\n    ${env}\n    roles: { bill: { dir: /a/b } }`;
    expect(() => parseSupervisorConfig(base("env: { ANTHROPIC_API_KEY: k }"), (d) => d)).toThrow(/bill to the subscription/);
    expect(() =>
      parseSupervisorConfig(`orchestrator: Bob\nprojects:\n  a: { path: /a, roles: { bill: { dir: /a/b, env: { ANTHROPIC_AUTH_TOKEN: t } } } }`, (d) => d),
    ).toThrow(/bill to the subscription/);
  });

  it("stops a worker whose session reports an API key as its source", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sessions[0]!.emit({ type: "system", subtype: "init", session_id: "s-key", apiKeySource: "ANTHROPIC_API_KEY" } as unknown as SDKMessage);
    await until(() => sup.status(w.id).state === "stopped");
    expect(sup.status(w.id).error).toMatch(/billing guard/);
    expect(broker.toOrchestrator().at(-1)).toMatch(/billing guard/);
  });

  it("treats any key source but none as a key, oauth included (ADR 0094 §3)", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sessions[0]!.emit({ type: "system", subtype: "init", session_id: "s-o", apiKeySource: "oauth" } as unknown as SDKMessage);
    await until(() => sup.status(w.id).state === "stopped");
  });

  it("leaves a subscription session alone", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sessions[0]!.emit({ type: "system", subtype: "init", session_id: "s-sub", apiKeySource: "none" } as unknown as SDKMessage);
    await tick(30);
    expect(sup.status(w.id).state).toBe("running");
  });
});

describe("an orchestrator per project", () => {
  it("tells each project's own orchestrator, and the laptop's for the rest", async () => {
    const config = testConfig(dir).projects.get("helix")!;
    expect(config.orchestrator).toBe("Bob");
    const { sup, broker, sessions } = await setup("", parseOver(`
orchestrator: Orchestrator
state_dir: ${dir}
projects:
  helix: { path: /work/helix, orchestrator: Bob, roles: { bill: { dir: /work/helix-bill/architecture } } }
  sandbox: { path: /work/sb, roles: { writer: { dir: /work/sb/writer } } }
`));
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    sup.spawn({ project: "sandbox", role: "writer", task: "t" });
    await until(() => sessions.length === 2);
    sessions[0]!.finish();
    sessions[1]!.finish();
    await until(() => broker.sent.length >= 2);
    const to = (who: string) => broker.sent.filter((s) => s.to.includes(who)).map((s) => s.body);
    expect(to("Bob")).toEqual([expect.stringMatching(/^Bill .* done/)]);
    expect(to("Orchestrator")).toEqual([expect.stringMatching(/^Writer .* done/)]);
    expect(sessions[0]!.options.systemPrompt).toMatchObject({ append: expect.stringContaining("orchestrator (Bob)") });
  });

  it("rejects a project orchestrator that is also a role", () => {
    expect(() =>
      parseSupervisorConfig(`orchestrator: O\nprojects:\n  a: { path: /a, orchestrator: Bill, roles: { bill: { dir: /a/b } } }`, (d) => d),
    ).toThrow(/already used by orchestrator of a/);
  });
});

describe("run slots and the hold", () => {
  it("runs one heavy command at a time, in order, and frees the slot when it returns", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 2);
    const [bill, homer] = sessions as [typeof sessions[0], typeof sessions[0]];
    await expect(bill!.askCall("tu1", "Bash", { command: "pnpm test" })).resolves.toMatchObject({ behavior: "allow" });
    let homerGot = false;
    const waiting = homer!.askCall("tu2", "Bash", { command: "pnpm test" }).then((r) => {
      homerGot = true;
      return r;
    });
    await tick(30);
    expect(homerGot).toBe(false);
    expect(sup.slotStatus()).toMatchObject({ holders: [{ name: "Bill", label: "pnpm test" }], queue: [{ name: "Homer" }] });
    bill!.toolResult("tu1");
    await expect(waiting).resolves.toMatchObject({ behavior: "allow" });
    expect(sup.slotStatus().holders).toEqual([expect.objectContaining({ name: "Homer" })]);
  });

  it("takes the slot only after an escalated heavy run is approved", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    const r = sessions[0]!.askCall("tu1", "Bash", { command: "psql -c 'select 1'" });
    await until(() => sup.pending().length === 1);
    expect(sup.slotStatus().holders).toEqual([]);
    sup.answer(sup.pending()[0]!.id, { decision: "allow" }, "orchestrator");
    await expect(r).resolves.toMatchObject({ behavior: "allow" });
    expect(sup.slotStatus().holders).toHaveLength(1);
  });

  it("refuses a heavy run in the background", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    await expect(sessions[0]!.askCall("tu1", "Bash", { command: "pnpm test", run_in_background: true })).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringMatching(/foreground/),
    });
  });

  it("frees a stopped worker's slot", async () => {
    const { sup, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    await sessions[0]!.askCall("tu1", "Bash", { command: "pnpm test" });
    await sup.stop(w.id);
    await until(() => sup.slotStatus().holders.length === 0);
  });

  it("on hold (the hold file), still starts workers and grants slots: a held pair must reach land; the hold is reported", async () => {
    const { sup, sessions } = await setup();
    hold(sup, "LAND-41.17 pair");
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    await expect(sessions[0]!.askCall("tu1", "Bash", { command: "pnpm test" })).resolves.toMatchObject({ behavior: "allow" });
    expect(sup.slotStatus().hold).toMatchObject({ reason: "LAND-41.17 pair", allow: [] });
  });

  it("says why a spawn stays queued", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    expect(sup.spawn({ project: "helix", role: "bill", task: "u" }).note).toMatch(/^queued: Bill already has a worker running/);
  });

  it("queues interactive agents in the same slot, tells their orchestrator, and takes Bob's order", async () => {
    const { sup, broker, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    expect(sup.takeSlot("helix", "Marvin", "e2e on staging")).toEqual({ queued: true, position: 0 });
    await until(() => broker.toOrchestrator().some((b) => b.startsWith("Run slot given to Marvin")));
    let billGot = false;
    void sessions[0]!.askCall("tu1", "Bash", { command: "pnpm test" }).then(() => (billGot = true));
    expect(sup.takeSlot("helix", "Bender", "wrangler deploy staging").position).toBe(2);
    sup.orderRunQueue(["Bender"]);
    expect(sup.slotStatus().queue.map((q) => q.name)).toEqual(["Bender", "Bill"]);
    expect(() => sup.takeSlot("helix", "Marvin", "again")).toThrow(/already holds/);
    sup.freeSlot("Marvin");
    await until(() => broker.toOrchestrator().some((b) => b.startsWith("Run slot given to Bender")));
    expect(billGot).toBe(false);
    sup.freeSlot("Bender");
    await until(() => billGot);
    expect(() => sup.freeSlot("Marvin")).toThrow(/holds no slot/);
  });
});

describe("stuck workers", () => {
  // The supervisor's own clock, wound on: a worker last heard from `minutes` ago, then the minute's check.
  type Inner = { runs: Map<string, { lastEventAt: number }>; slots: { holders: Array<{ since: string }> }; checkStalls(): void };
  const inner = (sup: Supervisor) => sup as unknown as Inner;
  const quietFor = (sup: Supervisor, id: string, minutes: number) => {
    inner(sup).runs.get(id)!.lastEventAt = Date.now() - minutes * 60_000;
    inner(sup).checkStalls();
  };
  const toolUse = (s: { emit(m: SDKMessage): void }, id: string) =>
    s.emit({ type: "assistant", message: { id: `msg_${id}`, content: [{ type: "tool_use", id, name: "Bash", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } } as unknown as SDKMessage);

  it("records a worker quiet past stall_minutes, and neither interrupts it nor messages anyone (Casper, 2026-11-07)", async () => {
    const { sup, broker, sessions } = await setup();
    const w = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions[0]?.inputs.length === 1);
    const sent = broker.sent.length;
    quietFor(sup, w.id, 14);
    expect(store.auditLog(5).some((a) => a.action === "stalled")).toBe(false);
    quietFor(sup, w.id, 16);
    quietFor(sup, w.id, 17);
    await tick(20);
    expect(sessions[0]!.interrupted).toBe(false);
    expect(sessions[0]!.inputs.length).toBe(1);
    expect(broker.sent.slice(sent)).toEqual([]);
    expect(sup.status(w.id).state).toBe("running");
    expect(store.auditLog(10).filter((a) => a.action === "stalled").map((a) => a.detail)).toEqual([JSON.stringify({ minutes: 16, in_tool: false })]);
  });

  it("gives a tool call tool_stall_minutes, never counts a wait for the slot, and leaves a stuck call running", async () => {
    const { sup, sessions } = await setup();
    const bill = sup.spawn({ project: "helix", role: "bill", task: "t" });
    const homer = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 2);
    toolUse(sessions[0]!, "tu1");
    await sessions[0]!.askCall("tu1", "Bash", { command: "pnpm test" });
    toolUse(sessions[1]!, "tu2");
    void sessions[1]!.askCall("tu2", "Bash", { command: "pnpm test" });
    await tick(20);
    quietFor(sup, homer.id, 120);
    quietFor(sup, bill.id, 30);
    expect(store.auditLog(10).some((a) => a.action === "stalled")).toBe(false);
    quietFor(sup, bill.id, 50);
    expect(store.auditLog(10).find((a) => a.action === "stalled")).toMatchObject({ worker_id: bill.id, detail: JSON.stringify({ minutes: 50, in_tool: true }) });
    // Waiting for the slot is never a stall; the stuck call is left for Casper or the lead to stop.
    expect(store.auditLog(10).some((a) => a.action === "stalled" && a.worker_id === homer.id)).toBe(false);
    expect(sessions[0]!.interrupted).toBe(false);
  });

  it("records an interactive agent's long hold on the slot, once, and tells no one", async () => {
    const { sup, broker } = await setup();
    sup.takeSlot("helix", "Marvin", "e2e on staging");
    await until(() => broker.toOrchestrator().some((b) => b.startsWith("Run slot given to Marvin")));
    const sent = broker.sent.length;
    inner(sup).checkStalls();
    inner(sup).slots.holders[0]!.since = new Date(Date.now() - 50 * 60_000).toISOString();
    inner(sup).checkStalls();
    inner(sup).checkStalls();
    expect(store.auditLog(10).filter((a) => a.action === "slot:long-hold")).toHaveLength(1);
    expect(broker.sent.slice(sent)).toEqual([]);
  });
});

// Real git, real repositories: seconds each under load, past the 5 s default.
describe("land", { timeout: 20_000 }, () => {
  function repo(): { worktree: string; script: string } {
    const worktree = join(dir, "helix-homer");
    mkdirSync(join(worktree, "platform"), { recursive: true });
    execFileSync("git", ["init", "-q", worktree]);
    writeFileSync(join(worktree, "README"), "x");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "-c", "user.name=Homer", "-c", "user.email=h@x", "commit", "-qm", "init"]);
    const script = join(dir, "land.sh");
    writeFileSync(script, '#!/bin/sh\necho "author=$GIT_AUTHOR_NAME key=${ANTHROPIC_API_KEY:-none} pg=${LAND_PG_ADMIN_URL:-unset} pwd=$(basename "$PWD")"\nif [ -f FAIL ]; then echo "hook: ownership refused" >&2; exit 3; fi\nsleep 0.2\necho landed 1a2b3c\n');
    chmodSync(script, 0o755);
    const env = join(dir, "env.sh");
    writeFileSync(env, "#!/bin/sh\n[ -f " + join(dir, "PG_DOWN") + " ] && exit 1\necho \"export LAND_PG_ADMIN_URL='postgres://admin:pw@127.0.0.1:5432/postgres'\"\necho \"export LAND_PG_CONTAINER='land-pg'\"\n");
    chmodSync(env, 0o755);
    return { worktree, script };
  }

  const landConfig = (worktree: string, script: string) =>
    parseOver(`
orchestrator: Bob
state_dir: ${dir}
projects:
  helix:
    path: ${worktree}
    land: { command: [${script}], env_command: [${join(dir, "env.sh")}], requires_env: [LAND_PG_ADMIN_URL] }
    hold_file: ${join(dir, "land-hold")}
    env: { GIT_AUTHOR_NAME: nobody }
    roles:
      homer: { dir: ${join(worktree, "platform")}, env: { GIT_AUTHOR_NAME: Homer } }
`, (d) => d);

  it("runs the land command in the worker's worktree, with its author, in a slot, and tells the orchestrator when the run ends", async () => {
    const { worktree, script } = repo();
    process.env["ANTHROPIC_API_KEY"] = "must-not-leak";
    try {
      const { sup, broker, sessions } = await setup("", landConfig(worktree, script));
      const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
      await until(() => sessions.length === 1);
      const r = await sup.land(w.id);
      expect(r.ok).toBe(true);
      expect(r.output).toMatch(/author=Homer key=none pg=postgres:\/\/admin:pw@127\.0\.0\.1:5432\/postgres pwd=helix-homer/);
      expect(broker.updates).toEqual(["Homer: started", "Homer: landed: landed 1a2b3c"]);
      expect(sup.slotStatus().holders).toEqual([]);
      // One wake for the orchestrator: the land result rides on the run's done.
      expect(broker.toOrchestrator().filter((b) => b.startsWith("Homer"))).toEqual([]);
      sessions[0]!.finish("ok");
      await until(() => broker.toOrchestrator().some((b) => b.startsWith("Homer")));
      expect(broker.toOrchestrator().filter((b) => b.startsWith("Homer"))).toEqual([expect.stringMatching(/^Homer .* done.* Land: landed: landed 1a2b3c\. Handoff/)]);
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });

  it("refuses a dirty tree, and returns the hook's refusal in full", async () => {
    const { worktree, script } = repo();
    const { sup, broker, sessions } = await setup("", landConfig(worktree, script));
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    writeFileSync(join(worktree, "FAIL"), "");
    const dirty = await sup.land(w.id);
    expect(dirty).toMatchObject({ ok: false, output: expect.stringMatching(/uncommitted changes[\s\S]*FAIL/) });

    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "-c", "user.name=Homer", "-c", "user.email=h@x", "commit", "-qm", "fail"]);
    const refused = await sup.land(w.id);
    expect(refused).toMatchObject({ ok: false, output: expect.stringMatching(/exited 3[\s\S]*hook: ownership refused/) });
    // The same HEAD again is a retry loop: refused without running.
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/Nothing has changed since your last land/) });
    sessions[0]!.finish("gave up");
    await until(() => broker.toOrchestrator().some((b) => b.startsWith("Homer")));
    expect(broker.toOrchestrator().at(-1)).toMatch(/Land: could not land \(exit 3\)/);
  });

  it("reports a held tip as held, not refused, and lets it land again", async () => {
    const { worktree, script } = repo();
    const config = landConfig(worktree, script);
    config.projects.get("helix")!.land!.heldExit = 3;
    const { sup, broker, sessions } = await setup("", config);
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    writeFileSync(join(worktree, "FAIL"), "");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "-c", "user.name=Homer", "-c", "user.email=h@x", "commit", "-qm", "f"]);
    // Under a hold (allowing no one) the land still gets its slot: the land command answers "held".
    hold(sup, "LAND-41.17 pair");
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: true, output: expect.stringMatching(/^Held, not refused/) });
    await expect(sup.land(w.id)).resolves.toMatchObject({ output: expect.not.stringMatching(/Nothing has changed/) });
    sessions[0]!.finish("ok");
    await until(() => broker.toOrchestrator().some((b) => b.startsWith("Homer")));
    expect(broker.toOrchestrator().at(-1)).toMatch(/Land: held, lands after the hold: .*; held, lands after the hold/);
  });

  it("gives a flaky failure one more run of the same commit, and refuses a second failure (no retry loop)", async () => {
    const { worktree, script } = repo();
    const config = landConfig(worktree, script);
    config.projects.get("helix")!.land!.flakyExit = 3;
    const { sup, broker, sessions } = await setup("", config);
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    writeFileSync(join(worktree, "FAIL"), "");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "-c", "user.name=Homer", "-c", "user.email=h@x", "commit", "-qm", "f"]);
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/^Flaky, not refused \(exit 3\): .*may land once more/) });
    // The one more run: it runs, fails again, and is the last.
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/exited 3/) });
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/^Not landed\. Nothing has changed since your last land was refused/) });
    expect(store.auditLog(20).filter((a) => a.action === "land:flaky")).toHaveLength(2);
    sessions[0]!.finish("ok");
    await until(() => broker.toOrchestrator().some((b) => b.startsWith("Homer")));
    expect(broker.toOrchestrator().at(-1)).toMatch(/Land: flaky \(exit 3\): .*; flaky \(exit 3\)/);
  });

  it("refuses, naming it, when the Postgres environment can't be had", async () => {
    const { worktree, script } = repo();
    const { sup, sessions } = await setup("", landConfig(worktree, script));
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    writeFileSync(join(dir, "PG_DOWN"), "");
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/Precondition: the environment/) });
  });

  it("holds the worker's edits and Bash until its land returns", async () => {
    const { worktree, script } = repo();
    const { sup, sessions } = await setup("", landConfig(worktree, script));
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    let landed = false;
    const landing = sup.land(w.id).then((r) => {
      landed = true;
      return r;
    });
    await tick(20);
    const edit = sessions[0]!.ask("Read", { file_path: join(worktree, "README") });
    await expect(edit).resolves.toMatchObject({ behavior: "allow" });
    expect(landed).toBe(false);
    // A write (here one policy denies at once) waits for the land before it is even decided.
    const write = sessions[0]!.ask("Write", { file_path: "/elsewhere/x" }).then((r) => ({ r, landed }));
    await expect(landing).resolves.toMatchObject({ ok: true });
    await expect(write).resolves.toMatchObject({ landed: true, r: { behavior: "deny" } });
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: true });
  });

  it("waits for the hold to end before landing", async () => {
    const { worktree, script } = repo();
    const { sup, sessions } = await setup("", landConfig(worktree, script));
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    hold(sup, "closing ci");
    let done = false;
    const landing = sup.land(w.id).then((r) => {
      done = true;
      return r;
    });
    await tick(50);
    expect(done).toBe(false);
    hold(sup, null);
    await expect(landing).resolves.toMatchObject({ ok: true });
  });
});

describe("consult", () => {
  async function consultSetup(concurrency = 1) {
    const text = `
orchestrator: Bob
concurrency: ${concurrency}
state_dir: ${dir}
consult_timeout_minutes: 0.01
projects:
  helix:
    path: /work/helix
    team: land
    hold_file: ${dir}/land-hold
    consult: [bill, homer]
    roles:
      bill: { dir: /work/helix-bill/architecture }
      homer: { dir: /work/helix-homer/platform }
      marvin: { dir: /work/helix-marvin/qa }
`;
    return setup("", parseOver(text));
  }

  it("starts a read-only worker for an idle role, past the cap, and returns its advisory answer", async () => {
    const { sup, broker, sessions } = await consultSetup();
    const homer = sup.spawn({ project: "helix", role: "homer", task: "build" });
    await until(() => sessions.length === 1);
    const answer = sup.consult(homer.id, "bill", "Does LAND-40.4's integrator need its own OWNERS row?");
    await until(() => sessions.length === 2);
    const bill = sessions[1]!;
    expect(bill.options.cwd).toBe("/work/helix-bill/architecture");
    expect(bill.options.disallowedTools).toEqual(expect.arrayContaining(["Write", "Edit"]));
    await until(() => bill.inputs.length === 1);
    // Remote Control is on for every worker, but never for a consult's short read-only life.
    await until(() => sessions[0]!.remoteCalls.length === 1);
    expect(bill.remoteCalls).toEqual([]);
    expect(bill.inputs[0]).toMatch(/^\[Consult c_\w+\] Homer asks Bill/);
    await expect(bill.ask("Write", { file_path: "/work/helix-bill/architecture/x.md" })).resolves.toMatchObject({ behavior: "deny" });
    const id = bill.inputs[0]!.match(/c_\w+/)![0];
    sup.answerConsult(sup.list().find((w) => w.role === "bill")!.id, id, "Yes: ADR 0093 §3, OWNERS.yaml row before the first commit.");
    await expect(answer).resolves.toMatch(/^Advisory answer from Bill[\s\S]*not a ruling until Bill records it[\s\S]*ADR 0093 §3/);
    await until(() => bill.interrupted);
    // A consult worker ending doesn't wake the orchestrator.
    await tick(30);
    expect(broker.toOrchestrator().filter((b) => b.startsWith("Bill"))).toEqual([]);
  });

  it("hands the question to the role's running worker, and refuses a consult that would wait in a circle", async () => {
    const { sup, sessions } = await consultSetup(2);
    const bill = sup.spawn({ project: "helix", role: "bill", task: "review" });
    const homer = sup.spawn({ project: "helix", role: "homer", task: "build" });
    await until(() => sessions.length === 2);
    const answer = sup.consult(homer.id, "bill", "Is a branch hook a loosening?");
    await until(() => sessions[0]!.inputs.length === 2);
    expect(sessions.length).toBe(2);
    expect(sessions[0]!.inputs[1]).toMatch(/^\[Consult c_\w+\] Homer asks Bill/);
    // Bill can't consult Homer while Homer waits on Bill.
    expect(() => sup.consult(bill.id, "homer", "q")).toThrow(/itself waiting on a consult/);
    // Only the role asked may answer.
    const id = sessions[0]!.inputs[1]!.match(/c_\w+/)![0];
    expect(() => sup.answerConsult(homer.id, id, "me")).toThrow(/put to Bill/);
    sup.answerConsult(bill.id, id, "No: ADR 0093 §2.");
    await expect(answer).resolves.toMatch(/Advisory answer from Bill[\s\S]*ADR 0093 §2/);
    expect(sessions[0]!.interrupted).toBe(false);
  });

  it("times out, refuses self and non-consultable roles, and isn't stopped by a hold", async () => {
    const { sup, sessions } = await consultSetup();
    const homer = sup.spawn({ project: "helix", role: "homer", task: "build" });
    await until(() => sessions.length === 1);
    expect(() => sup.consult(homer.id, "homer", "q")).toThrow(/own role/);
    expect(() => sup.consult(homer.id, "marvin", "q")).toThrow(/isn't consultable/);
    hold(sup, "closing ci");
    await expect(sup.consult(homer.id, "bill", "q")).rejects.toThrow(/didn't answer within/);
  });
});

// Real git, real repositories: seconds each under load, past the 5 s default.
describe("rebase", { timeout: 20_000 }, () => {
  const g = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, "-c", "user.name=Main", "-c", "user.email=m@x", ...args], { encoding: "utf8" }).trim();

  /** An origin with main, and Homer's clone on homer/x one commit ahead of where main was. */
  function repo() {
    const origin = join(dir, "origin.git");
    const seed = join(dir, "seed");
    const worktree = join(dir, "helix-homer");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    execFileSync("git", ["clone", "-q", origin, seed], { stdio: "ignore" });
    writeFileSync(join(seed, "README"), "x\n");
    g(seed, "add", ".");
    g(seed, "commit", "-qm", "init");
    g(seed, "push", "-q", "origin", "HEAD:main");
    execFileSync("git", ["clone", "-q", origin, worktree]);
    mkdirSync(join(worktree, "platform"));
    g(worktree, "switch", "-qc", "homer/x");
    writeFileSync(join(worktree, "homer.md"), "mine\n");
    g(worktree, "add", ".");
    g(worktree, "commit", "-qm", "homer's work");
    // main moves on after Homer branched.
    writeFileSync(join(seed, "main.md"), "theirs\n");
    g(seed, "add", ".");
    g(seed, "commit", "-qm", "main moves");
    g(seed, "push", "-q", "origin", "HEAD:main");
    return { worktree, seed };
  }

  const config = (worktree: string) =>
    parseOver(`
orchestrator: Bob
state_dir: ${dir}
projects:
  helix:
    path: ${worktree}
    rebase: { onto: origin/main }
    roles:
      homer: { dir: ${join(worktree, "platform")}, env: { GIT_AUTHOR_NAME: Homer, GIT_COMMITTER_NAME: Homer } }
`, (d) => d);

  it("fetches main and rebases the worker's branch onto it, as the worker", async () => {
    const { worktree, seed } = repo();
    const { sup, sessions } = await setup("", config(worktree));
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    const r = await sup.rebase(w.id);
    expect(r).toMatchObject({ ok: true, output: expect.stringMatching(/^Rebased homer\/x onto origin\/main: /) });
    expect(g(worktree, "rev-parse", "HEAD~1")).toBe(g(seed, "rev-parse", "HEAD"));
    expect(g(worktree, "log", "-1", "--format=%cn %s")).toBe("Homer homer's work");
    expect(g(worktree, "status", "--porcelain")).toBe("");
  });

  it("rebases the worker's branch after a land, so the replayed commits drop out", async () => {
    const { worktree, seed } = repo();
    // The integrator replays the worker's commit onto main: same change, new hash.
    const land = join(dir, "land.sh");
    writeFileSync(land, `#!/bin/sh\nset -e\ncd ${seed}\ngit pull -q --rebase=false origin main\ngit fetch -q "$OLDPWD" HEAD\ngit -c user.name=Main -c user.email=m@x cherry-pick FETCH_HEAD >/dev/null\ngit push -q origin HEAD:main\necho "landed: main $(git rev-parse --short HEAD)"\n`);
    chmodSync(land, 0o755);
    const c = config(worktree);
    c.projects.get("helix")!.land = { command: [land], timeoutMinutes: 1, envCommand: undefined, requiresEnv: [], heldExit: undefined, flakyExit: undefined };
    const { sup, sessions } = await setup("", c);
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    const r = await sup.land(w.id);
    expect(r).toMatchObject({ ok: true, output: expect.stringMatching(/landed: main [\s\S]*Then: Rebased homer\/x onto origin\/main/) });
    expect(g(worktree, "rev-parse", "HEAD")).toBe(g(seed, "rev-parse", "HEAD"));
    expect(g(worktree, "rev-list", "--count", "origin/main..HEAD")).toBe("0");
  });

  it("aborts a conflict and leaves the branch as it was; refuses a dirty tree or main itself", async () => {
    const { worktree, seed } = repo();
    writeFileSync(join(seed, "homer.md"), "clash\n");
    g(seed, "add", ".");
    g(seed, "commit", "-qm", "clash");
    g(seed, "push", "-q", "origin", "HEAD:main");
    const { sup, sessions } = await setup("", config(worktree));
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    const before = g(worktree, "rev-parse", "HEAD");
    const r = await sup.rebase(w.id);
    expect(r).toMatchObject({ ok: false, output: expect.stringMatching(/aborted and homer\/x is still at [\s\S]*Conflicts in:\nhomer\.md/) });
    expect(g(worktree, "rev-parse", "HEAD")).toBe(before);
    expect(g(worktree, "status", "--porcelain")).toBe("");

    writeFileSync(join(worktree, "stray"), "");
    await expect(sup.rebase(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/uncommitted changes[\s\S]*stray/) });
    rmSync(join(worktree, "stray"));
    g(worktree, "switch", "-q", "main");
    await expect(sup.rebase(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/You are on main/) });
  });

  describe("a land on a stale tip", () => {
    /** A land that counts its checks, lets main move mid-check once (a RACE file), then pushes the tip to main. */
    function landOnStale(worktree: string, seed: string) {
      const land = join(dir, "land.sh");
      const checks = join(dir, "checks");
      writeFileSync(land, `#!/bin/sh\necho check >> ${checks}\nif [ -f ${join(dir, "RACE")} ]; then rm ${join(dir, "RACE")}; cd ${seed}; git pull -q --rebase=false origin main; echo race > race.md; git add .; git -c user.name=Main -c user.email=m@x commit -qm race; git push -q origin HEAD:main; cd "$OLDPWD"; fi\ngit push origin HEAD:refs/heads/main 2>&1 || exit 1\necho "landed: main $(git rev-parse --short HEAD)"\n`);
      chmodSync(land, 0o755);
      const c = config(worktree);
      c.projects.get("helix")!.land = { command: [land], timeoutMinutes: 1, envCommand: undefined, requiresEnv: [], heldExit: undefined, flakyExit: undefined, target: { remote: "origin", branch: "main" } };
      const count = () => execFileSync("sh", ["-c", `cat ${checks} 2>/dev/null | wc -l`], { encoding: "utf8" }).trim();
      return { c, count };
    }

    it("is opt-in per project, as land.target", () => {
      const parse = (land: string) => parseOver(`orchestrator: Bob\nprojects:\n  a: { path: /a, land: ${land}, roles: { b: { dir: /a/b } } }`, (d) => d).projects.get("a")!.land!;
      expect(parse("{ command: [x], target: origin/release/v2 }").target).toEqual({ remote: "origin", branch: "release/v2" });
      expect(parse("{ command: [x] }").target).toBeUndefined();
      expect(() => parse("{ command: [x], target: v2 }")).toThrow(/remote\/branch/);
    });

    it("fetches main in the slot and rebases a tip that is behind it before the check", async () => {
      const { worktree, seed } = repo();
      const { c, count } = landOnStale(worktree, seed);
      const { sup, sessions } = await setup("", c);
      const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
      await until(() => sessions.length === 1);
      const main = g(seed, "rev-parse", "HEAD");
      const r = await sup.land(w.id);
      expect(r).toMatchObject({ ok: true, output: expect.stringMatching(/^Your tip was behind origin\/main, so it was rebased first[\s\S]*landed: main/) });
      expect(count()).toBe("1");
      expect(g(worktree, "rev-parse", "HEAD~1")).toBe(main);
      expect(g(worktree, "rev-parse", "HEAD")).toBe(g(seed, "ls-remote", "origin", "refs/heads/main").split("\t")[0]);
    });

    it("refuses a stale tip that doesn't rebase cleanly without running the check, and doesn't count it as refused", async () => {
      const { worktree, seed } = repo();
      writeFileSync(join(seed, "homer.md"), "clash\n");
      g(seed, "add", ".");
      g(seed, "commit", "-qm", "clash");
      g(seed, "push", "-q", "origin", "HEAD:main");
      const { c, count } = landOnStale(worktree, seed);
      const { sup, broker, sessions } = await setup("", c);
      const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
      await until(() => sessions.length === 1);
      const before = g(worktree, "rev-parse", "HEAD");
      const stale = /^Stale, not refused: your tip is behind origin\/main and doesn't rebase onto it[\s\S]*Conflicts in:\nhomer\.md/;
      await expect(sup.land(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(stale) });
      expect(count()).toBe("0");
      expect(g(worktree, "rev-parse", "HEAD")).toBe(before);
      // Not a refusal of that HEAD: landing it again is tried again, not "nothing has changed".
      await expect(sup.land(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(stale) });
      expect(store.auditLog(20).filter((a) => a.action === "land:stale")).toHaveLength(2);
      sessions[0]!.finish("ok");
      await until(() => broker.toOrchestrator().some((b) => b.startsWith("Homer")));
      expect(broker.toOrchestrator().at(-1)).toMatch(/Land: stale, behind origin\/main/);
    });

    it("reports a run the target moved under as stale, not failed, and lands that HEAD on the next try", async () => {
      const { worktree, seed } = repo();
      const { c, count } = landOnStale(worktree, seed);
      const { sup, broker, sessions } = await setup("", c);
      const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
      await until(() => sessions.length === 1);
      writeFileSync(join(dir, "RACE"), "");
      const r = await sup.land(w.id);
      expect(r).toMatchObject({ ok: false, output: expect.stringMatching(/^Stale, not refused: origin\/main moved while your land ran[\s\S]*\[rejected\]/) });
      expect(store.auditLog(20).some((a) => a.action === "land:failed")).toBe(false);
      await expect(sup.land(w.id)).resolves.toMatchObject({ ok: true, output: expect.stringMatching(/rebased first[\s\S]*landed: main/) });
      expect(count()).toBe("2");
      expect(g(seed, "ls-remote", "origin", "refs/heads/main").split("\t")[0]).toBe(g(worktree, "rev-parse", "HEAD"));
      sessions[0]!.finish("ok");
      await until(() => broker.toOrchestrator().some((b) => b.startsWith("Homer")));
      expect(broker.toOrchestrator().at(-1)).toMatch(/Land: stale, origin\/main moved during the land; landed: /);
    });
  });
});

describe("listed runs", () => {
  function setupRuns() {
    const worktree = join(dir, "helix-calvin");
    mkdirSync(join(worktree, "design", "tools"), { recursive: true });
    execFileSync("git", ["init", "-q", worktree]);
    const script = join(worktree, "design", "tools", "shot.sh");
    writeFileSync(script, '#!/bin/sh\necho "author=$GIT_AUTHOR_NAME pwd=$(basename "$PWD") np=$NODE_PATH args=$*"\n[ "$1" = fail ] && exit 2\nexit 0\n');
    chmodSync(script, 0o755);
    const config = parseOver(`
orchestrator: Bob
state_dir: ${dir}
projects:
  helix:
    path: ${worktree}
    runs:
      shot: { command: [./shot.sh], cwd: design/tools, description: "phone screenshots", args: "^[\\\\w.:/=-]+$", roles: [calvin], env: { NODE_PATH: ../../node_modules } }
      pdf: { command: [./design/tools/shot.sh, pdf], description: "the model PDF", slot: false }
    roles:
      calvin: { dir: ${join(worktree, "design")}, env: { GIT_AUTHOR_NAME: Calvin } }
      bill: { dir: ${join(worktree, "design")}, env: { GIT_AUTHOR_NAME: Bill } }
`, (d) => d);
    return config;
  }

  it("runs a listed command in the worktree, as the worker, in a slot", async () => {
    const { sup, sessions } = await setup("", setupRuns());
    const w = sup.spawn({ project: "helix", role: "calvin", task: "t" });
    await until(() => sessions.length === 1);
    const r = await sup.runListed(w.id, "shot", ["http://localhost:5173/map", "shots/d14", "390"]);
    expect(r).toMatchObject({ ok: true, output: expect.stringMatching(/exited 0[\s\S]*author=Calvin pwd=tools np=\.\.\/\.\.\/node_modules args=http:\/\/localhost:5173\/map shots\/d14 390/) });
    expect(sup.slotStatus().holders).toEqual([]);
    await expect(sup.runListed(w.id, "shot", ["fail"])).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/exited 2/) });
  });

  it("refuses what isn't listed, isn't the role's, or reaches outside the worktree", async () => {
    const { sup, sessions } = await setup("", setupRuns());
    const calvin = sup.spawn({ project: "helix", role: "calvin", task: "t" });
    await until(() => sessions.length === 1);
    const no = (name: string, args: string[], why: RegExp) => expect(sup.runListed(calvin.id, name, args)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(why) });
    await no("rm", [], /isn't a command Calvin may run/);
    await no("pdf", ["x"], /takes no arguments/);
    await no("shot", ["/Users/ct/.ssh/id"], /reaches outside/);
    await no("shot", ["~/x"], /reaches outside/);
    await no("shot", ["shots/../../x"], /reaches outside/);
    await no("shot", ["--out=/tmp/x"], /reaches outside/);
    await no("shot", ["a;b"], /doesn't match/);
    await expect(sup.runListed(calvin.id, "pdf", [])).resolves.toMatchObject({ ok: true, output: expect.stringMatching(/args=pdf/) });
    expect(() => parseOver(`orchestrator: Bob\nprojects:\n  a: { path: /a, runs: { x: { command: [y], description: z, cwd: ../up } }, roles: { bill: { dir: /a/b } } }`, (d) => d)).toThrow(/inside the worktree/);
    expect(() => parseOver(`orchestrator: Bob\nprojects:\n  a: { path: /a, runs: { x: { command: [y], description: z, roles: [nobody] } }, roles: { bill: { dir: /a/b } } }`, (d) => d)).toThrow(/no role nobody/);
  });
});

function parseOver(text: string, root: (d: string) => string = (d) => d.split("/").slice(0, 3).join("/")) {
  return parseSupervisorConfig(text, root);
}
