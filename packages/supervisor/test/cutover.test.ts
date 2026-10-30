import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

async function setup(over = "", config = testConfig(dir, over)) {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery();
  const sup = new Supervisor({ config, policy: POLICY, store, broker, queryFn, log: quiet });
  await sup.start();
  running.push(sup);
  return { sup, broker, sessions };
}

describe("billing guard", () => {
  it("never hands a worker an API key or another provider's switch", () => {
    const env = workerEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "x", ANTHROPIC_AUTH_TOKEN: "y", CLAUDE_CODE_USE_BEDROCK: "1", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
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

  it("on hold, starts no worker and grants no slot, and survives a restart", async () => {
    const { sup, sessions } = await setup();
    const bill = sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    sup.hold("ci 41077 running on the Mac runner");
    const homer = sup.spawn({ project: "helix", role: "homer", task: "t" });
    let granted = false;
    void sessions[0]!.askCall("tu1", "Bash", { command: "pnpm test" }).then(() => (granted = true));
    await tick(30);
    expect([sup.status(homer.id).state, granted]).toEqual(["queued", false]);
    expect(sup.slotStatus().hold).toMatchObject({ reason: "ci 41077 running on the Mac runner" });
    expect(existsSync(join(dir, "hold.json"))).toBe(true);

    // A second supervisor on the same state dir starts on hold.
    await sup.shutdown();
    running = running.filter((s) => s !== sup);
    const second = await setup();
    expect(second.sup.slotStatus().hold).toMatchObject({ reason: "ci 41077 running on the Mac runner" });
    expect(second.broker.toOrchestrator().join("\n")).toMatch(/still on hold/);
    second.sup.releaseHold();
    await until(() => second.sessions.length >= 1);
    expect(existsSync(join(dir, "hold.json"))).toBe(false);
    void bill;
  });
});

describe("land", () => {
  function repo(): { worktree: string; script: string } {
    const worktree = join(dir, "helix-homer");
    mkdirSync(join(worktree, "platform"), { recursive: true });
    execFileSync("git", ["init", "-q", worktree]);
    writeFileSync(join(worktree, "README"), "x");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "-c", "user.name=Homer", "-c", "user.email=h@x", "commit", "-qm", "init"]);
    const script = join(dir, "land.sh");
    writeFileSync(script, '#!/bin/sh\necho "author=$GIT_AUTHOR_NAME key=${ANTHROPIC_API_KEY:-none} pwd=$(basename "$PWD")"\nif [ -f FAIL ]; then echo "hook: ownership refused" >&2; exit 3; fi\necho landed 1a2b3c\n');
    chmodSync(script, 0o755);
    return { worktree, script };
  }

  const landConfig = (worktree: string, script: string) =>
    parseOver(`
orchestrator: Bob
state_dir: ${dir}
projects:
  helix:
    path: ${worktree}
    land: { command: [${script}] }
    env: { GIT_AUTHOR_NAME: nobody }
    roles:
      homer: { dir: ${join(worktree, "platform")}, env: { GIT_AUTHOR_NAME: Homer } }
`, (d) => d);

  it("runs the land command in the worker's worktree, with its author, in a slot, and tells the orchestrator", async () => {
    const { worktree, script } = repo();
    process.env["ANTHROPIC_API_KEY"] = "must-not-leak";
    try {
      const { sup, broker, sessions } = await setup("", landConfig(worktree, script));
      const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
      await until(() => sessions.length === 1);
      const r = await sup.land(w.id);
      expect(r.ok).toBe(true);
      expect(r.output).toMatch(/author=Homer key=none pwd=helix-homer/);
      expect(broker.toOrchestrator().at(-1)).toMatch(/Homer .* landed: landed 1a2b3c/);
      expect(sup.slotStatus().holders).toEqual([]);
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
    expect(broker.toOrchestrator().at(-1)).toMatch(/could not land \(exit 3\)/);
  });

  it("waits for the hold to end before landing", async () => {
    const { worktree, script } = repo();
    const { sup, sessions } = await setup("", landConfig(worktree, script));
    const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
    await until(() => sessions.length === 1);
    sup.hold("ci");
    let done = false;
    const landing = sup.land(w.id).then((r) => {
      done = true;
      return r;
    });
    await tick(50);
    expect(done).toBe(false);
    sup.releaseHold();
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

  it("times out, refuses self and non-consultable roles, and refuses to start one on hold", async () => {
    const { sup, sessions } = await consultSetup();
    const homer = sup.spawn({ project: "helix", role: "homer", task: "build" });
    await until(() => sessions.length === 1);
    expect(() => sup.consult(homer.id, "homer", "q")).toThrow(/own role/);
    expect(() => sup.consult(homer.id, "marvin", "q")).toThrow(/isn't consultable/);
    sup.hold("ci");
    expect(() => sup.consult(homer.id, "bill", "q")).toThrow(/on hold/);
    sup.releaseHold();
    await expect(sup.consult(homer.id, "bill", "q")).rejects.toThrow(/didn't answer within/);
  });
});

function parseOver(text: string, root: (d: string) => string = (d) => d.split("/").slice(0, 3).join("/")) {
  return parseSupervisorConfig(text, root);
}
