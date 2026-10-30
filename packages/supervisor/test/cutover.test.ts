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

  it("on hold (the hold file), starts no worker and grants no slot, then resumes when it is lifted", async () => {
    const { sup, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "t" });
    await until(() => sessions.length === 1);
    hold(sup, "closing ci");
    const homer = sup.spawn({ project: "helix", role: "homer", task: "t" });
    let granted = false;
    void sessions[0]!.askCall("tu1", "Bash", { command: "pnpm test" }).then(() => (granted = true));
    await tick(30);
    expect([sup.status(homer.id).state, granted]).toEqual(["queued", false]);
    expect(sup.slotStatus().hold).toMatchObject({ reason: "closing ci", allow: [] });
    hold(sup, null);
    await until(() => granted && sessions.length === 2);
  });

  it("under a hold with --allow, lets only the allowed author run and start", async () => {
    const { sup, sessions } = await setup();
    hold(sup, "red main", ["Homer"]);
    const bill = sup.spawn({ project: "helix", role: "bill", task: "t" });
    const homer = sup.spawn({ project: "helix", role: "homer", task: "fix" });
    await until(() => sessions.length === 1);
    expect([sup.status(bill.id).state, sup.status(homer.id).state]).toEqual(["queued", "running"]);
    await expect(sessions[0]!.askCall("tu1", "Bash", { command: "pnpm test" })).resolves.toMatchObject({ behavior: "allow" });
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

describe("land", () => {
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

  it("runs the land command in the worker's worktree, with its author, in a slot, and tells the orchestrator", async () => {
    const { worktree, script } = repo();
    process.env["ANTHROPIC_API_KEY"] = "must-not-leak";
    try {
      const { sup, broker, sessions } = await setup("", landConfig(worktree, script));
      const w = sup.spawn({ project: "helix", role: "homer", task: "t" });
      await until(() => sessions.length === 1);
      const r = await sup.land(w.id);
      expect(r.ok).toBe(true);
      expect(r.output).toMatch(/author=Homer key=none pg=postgres:\/\/admin:pw@127\.0\.0\.1:5432\/postgres pwd=helix-homer/);
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
    // The same HEAD again is a retry loop: refused without running.
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/Nothing has changed since your last land/) });
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
    await expect(sup.land(w.id)).resolves.toMatchObject({ ok: true, output: expect.stringMatching(/^Held, not refused/) });
    expect(broker.toOrchestrator().at(-1)).toMatch(/is held/);
    await expect(sup.land(w.id)).resolves.toMatchObject({ output: expect.not.stringMatching(/Nothing has changed/) });
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
    hold(sup, "closing ci");
    expect(() => sup.consult(homer.id, "bill", "q")).toThrow(/on hold/);
    hold(sup, null);
    await expect(sup.consult(homer.id, "bill", "q")).rejects.toThrow(/didn't answer within/);
  });
});

function parseOver(text: string, root: (d: string) => string = (d) => d.split("/").slice(0, 3).join("/")) {
  return parseSupervisorConfig(text, root);
}
