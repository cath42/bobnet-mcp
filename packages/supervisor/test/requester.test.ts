import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { callTool, handlers } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { REMOTE_TOOLS_SINCE, Supervisor } from "../src/supervisor.ts";
import { fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork, type FakeLink } from "./network.ts";

// The requester's tools with `laptop` (ADR 0007 §1, §5, §3 offline, §9 versions; BOB-63): two real
// supervisors on the FakeNetwork, mbp-1's orchestrator (Bob) driving ubu1. Without `laptop` every
// tool is today's (mcp.test.ts, lead.test.ts, unchanged).

const POLICY = new Policy(`rules: []`);
const UBU_PROJECTS = `  studio:
    path: /work/studio
    roles:
      ann: { dir: /work/studio-ann }
      bea: { dir: /work/studio-bea }
      cal: { dir: /work/studio-cal }
      zed: { dir: /work/studio-zed }
  works:
    path: /work/works
    board: service
    roles:
      kim: { dir: /work/works-kim, max_effort: high }
remote:
  supervisor@mbp-1: { spawn: { studio: [ann, bea, cal], works: [kim] } }
`;
const SUP_MBP = "supervisor@mbp-1";
const SUP_UBU = "supervisor@ubu1";
const ANN = { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" };

const dirs: string[] = [];
const stores = new Set<Store>();
const running: Supervisor[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  for (const s of stores) s.close();
  stores.clear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(net: FakeNetwork, laptop: string, over: string) {
  const dir = mkdtempSync(join(tmpdir(), "bobnet-requester-"));
  dirs.push(dir);
  const store = new Store(join(dir, "supervisor.db"));
  stores.add(store);
  const link = net.link(laptop);
  const { queryFn, sessions } = fakeQuery();
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config: testConfig(dir, over), policy: POLICY, store, broker: link, queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => false, sleep: net.sleep, ciPoll });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push(sup);
  return { sup, store, link, sessions };
}

/** mbp-1's supervisor and its orchestrator Bob (to hear its notes), ubu1's supervisor (concurrency 2), its studio and works. */
async function setup(opts: { ubu1Version?: string } = {}) {
  const net = new FakeNetwork();
  net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: opts.ubu1Version ?? REMOTE_TOOLS_SINCE, protocol: 1 });
  const ubu = await boot(net, "ubu1", UBU_PROJECTS);
  const mbp = await boot(net, "mbp-1", "");
  await mbp.link.register({ name: "Bob" });
  const tools = handlers(mbp.sup);
  /** A tool as the orchestrator calls it: its JSON result, or its error text thrown. */
  const call = async (name: string, args: Record<string, unknown> = {}, h = tools) => {
    const r = await callTool(h, name, args);
    const text = r.content[0]!.text;
    if (r.isError) throw new Error(text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const sent = () => net.between(SUP_MBP, SUP_UBU).map((b) => JSON.parse(b) as Record<string, unknown>);
  return { net, ubu, mbp, call, sent };
}

/** The target's reply to the last request sent, as the requester recorded it. */
const lastReply = (store: Store) => JSON.parse(store.remoteSentList().at(-1)!.reply!) as Record<string, unknown>;

describe("the tools take laptop (criterion 1)", () => {
  it("spawn_worker with laptop runs the worker on ubu1 and returns it with its laptop", async () => {
    const { ubu, call, sent } = await setup();
    const w = await call("spawn_worker", ANN);
    expect(w).toMatchObject({ project: "studio", role: "ann", name: "Ann", state: "running", laptop: "ubu1" });
    expect(typeof w.as_of).toBe("string");
    expect(ubu.store.worker(w.id)).toMatchObject({ spawned_by: SUP_MBP, remote_by: "Bob", state: "running" });
    expect(sent()).toEqual([{ v: 2, op: "spawn", project: "studio", role: "ann", task: "one fix", by: "Bob" }]);
  });

  it("worker_status, tail_worker and worker_summary find a worker spawned on ubu1 without laptop", async () => {
    const { ubu, call, sent } = await setup();
    const { id } = await call("spawn_worker", ANN);
    await until(() => ubu.sessions.length === 1);
    expect(await call("worker_status", { id })).toMatchObject({ id, state: "running", laptop: "ubu1" });
    expect(typeof (await call("tail_worker", { id, n: 5 }))).toBe("string");
    expect(await call("worker_summary", { id })).toMatchObject({ laptop: "ubu1", worker: { id }, tool_calls: expect.any(Object) });
    expect(sent().map((b) => b["op"])).toEqual(["spawn", "status", "tail", "summary"]);
  });

  it("stop_worker with laptop stops it on ubu1 with its last turn", async () => {
    const { ubu, call } = await setup();
    const { id } = await call("spawn_worker", ANN);
    await until(() => ubu.sessions.length === 1);
    const stopping = call("stop_worker", { id, laptop: "ubu1" });
    await until(() => ubu.sessions[0]!.inputs.length === 2);
    ubu.sessions[0]!.turnDone("handoff written");
    expect(await stopping).toMatchObject({ id, laptop: "ubu1" });
    await until(() => ubu.store.worker(id)!.state === "stopped");
    expect((await stopping).already_ended).toBeUndefined();
  });

  it("without laptop, or with this laptop's, every tool acts here as today", async () => {
    const { mbp, call, sent } = await setup();
    const here = await call("spawn_worker", { project: "games", role: "mario", task: "local" });
    expect(here).toMatchObject({ project: "games", spawned_by: "orchestrator" });
    const mine = await call("spawn_worker", { project: "helix", role: "bill", task: "also local", laptop: "mbp-1" });
    expect(mbp.store.worker(mine.id)).toBeTruthy();
    expect((await call("worker_status", { id: here.id, laptop: "mbp-1" })).id).toBe(here.id);
    expect((await call("list_workers", {})).map((w: { id: string }) => w.id)).toEqual([here.id, mine.id]);
    expect((await call("list_workers", { laptop: "mbp-1" })).map((w: { id: string }) => w.id)).toEqual([here.id, mine.id]);
    expect(await call("run_slots", { laptop: "mbp-1" })).toBeTruthy();
    expect(sent()).toEqual([]);
  });
});

describe("spawn_worker with laptop (criteria 2, 9)", () => {
  it("refuses handoff, resume_session and as: lead before sending anything", async () => {
    const { call, sent } = await setup();
    await expect(call("spawn_worker", { ...ANN, handoff: "/tmp/h.md" })).rejects.toThrow("handoff isn't sent to another laptop");
    await expect(call("spawn_worker", { ...ANN, resume_session: "sess-1" })).rejects.toThrow("resume_session isn't sent to another laptop");
    await expect(call("spawn_worker", { ...ANN, as: "lead" })).rejects.toThrow("a lead isn't spawned on another laptop");
    expect(sent()).toEqual([]);
  });

  it("passes tasks, session, model and effort through unchanged, with by", async () => {
    const { ubu, call, sent } = await setup();
    const session = { feature: "WRK-1", kind: "build", label: "A" };
    const w = await call("spawn_worker", { project: "works", role: "kim", task: "build it", tasks: ["WRK-1.2"], session, model: "claude-sonnet-5-5", effort: "medium", laptop: "ubu1" });
    expect(sent()[0]).toEqual({ v: 2, op: "spawn", project: "works", role: "kim", task: "build it", tasks: ["WRK-1.2"], session, model: "claude-sonnet-5-5", effort: "medium", by: "Bob" });
    expect(ubu.store.worker(w.id)).toMatchObject({ tasks: '["WRK-1.2"]', model: "claude-sonnet-5-5", effort: "medium", remote_by: "Bob" });
    expect(JSON.parse(ubu.store.worker(w.id)!.declared_session!)).toEqual(session);
  });

  it("relays the target's refusal word for word: its admit, a role not allowed, busy and full (criterion 6)", async () => {
    const { mbp, call } = await setup();
    const refused = async (args: Record<string, unknown>) => {
      const err = await call("spawn_worker", args).then(
        () => null,
        (e: Error) => e.message,
      );
      expect(err).toBe(lastReply(mbp.store)["error"]);
      return err;
    };
    // Its admit: a project with a board needs tasks, which the requester never checks itself.
    expect(await refused({ project: "works", role: "kim", task: "x", laptop: "ubu1" })).toMatch(/tasks/);
    expect(await refused({ ...ANN, effort: "max", project: "works", role: "kim", tasks: [], session: null })).toMatch(/effort/);
    expect(await refused({ ...ANN, role: "zed" })).toBe(`${SUP_MBP} may not spawn studio/zed; it may spawn studio/ann, studio/bea, studio/cal, works/kim`);
    await call("spawn_worker", ANN);
    expect(await refused(ANN)).toMatch(/studio\/ann already has a worker running/);
    await call("spawn_worker", { ...ANN, role: "bea" });
    expect(await refused({ ...ANN, role: "cal" })).toMatch(/2 workers running, the laptop's limit/);
  });

  it("stop_worker of a worker already ended on ubu1 reports its end, not an error", async () => {
    const { ubu, call } = await setup();
    const { id } = await call("spawn_worker", ANN);
    await until(() => ubu.sessions.length === 1);
    ubu.sessions[0]!.finish("all done");
    await until(() => ubu.store.worker(id)!.state === "done");
    const r = await call("stop_worker", { id });
    expect(r).toMatchObject({ id, state: "done", laptop: "ubu1", already_ended: true, note: `${id} had already ended (done) on ubu1` });
    // The record the tools resolve and list from has the end.
    expect(await call("list_workers", { laptop: "ubu1", all: true })).toMatchObject([{ id, state: "done" }]);
  });
});

describe("which laptop a worker id is on (criterion 3)", () => {
  it("laptop, if given, must match; an id on two laptops asks for it", async () => {
    const { mbp, call, sent } = await setup();
    const { id } = await call("spawn_worker", ANN);
    expect((await call("worker_status", { id, laptop: "ubu1" })).laptop).toBe("ubu1");
    await expect(call("worker_status", { id, laptop: "mbp-1" })).rejects.toThrow(`No worker ${id}`);
    await expect(call("tail_worker", { id, laptop: "pi" })).rejects.toThrow(`${id} runs on ubu1, not pi`);
    const local = await call("spawn_worker", { project: "games", role: "mario", task: "local" });
    await expect(call("worker_status", { id: local.id, laptop: "ubu1" })).rejects.toThrow(`${local.id} runs on this laptop (mbp-1), not ubu1`);
    // The same id here and there (ids are random, so this is made by hand).
    mbp.store.createWorker({ id, project: "games", role: "mario", task: "twin", handoff: null, priority: 5, resume_session: null });
    await expect(call("worker_summary", { id })).rejects.toThrow(`${id} is a worker on mbp-1 and ubu1: say which with laptop`);
    expect((await call("worker_summary", { id, laptop: "mbp-1" })).task).toBe("twin");
    expect(sent().map((b) => b["op"])).toEqual(["spawn", "status"]);
  });

  it("list_workers with laptop lists what this supervisor spawned there; \"*\" lists here and there, each row with laptop", async () => {
    const { ubu, call } = await setup();
    const ann = await call("spawn_worker", ANN);
    const bea = await call("spawn_worker", { ...ANN, role: "bea" });
    // ubu1's own worker, not this supervisor's, is never listed.
    ubu.sup.spawn({ project: "studio", role: "zed", task: "ubu1's own" });
    const local = await call("spawn_worker", { project: "games", role: "mario", task: "local" });
    const there = await call("list_workers", { laptop: "ubu1" });
    expect(there.map((w: { id: string }) => w.id)).toEqual([ann.id, bea.id]);
    for (const w of there) expect(w).toMatchObject({ laptop: "ubu1", as_of: expect.any(String) });
    expect((await call("list_workers", { laptop: "ubu1", project: "works" })).length).toBe(0);
    const all = await call("list_workers", { laptop: "*" });
    expect(all.map((w: { id: string; laptop: string }) => [w.id, w.laptop])).toEqual([
      [local.id, "mbp-1"],
      [ann.id, "ubu1"],
      [bea.id, "ubu1"],
    ]);
    expect(all[0].as_of).toBeUndefined();
    expect(all[1].as_of).toEqual(expect.any(String));
  });

  it("\"*\" says in its place why a laptop couldn't be asked", async () => {
    const { net, call } = await setup();
    const ann = await call("spawn_worker", ANN);
    net.disconnect("ubu1");
    const all = await call("list_workers", { laptop: "*" });
    expect(all).toEqual([{ laptop: "ubu1", unreachable: expect.stringMatching(/^ubu1's supervisor is offline \(last seen /) }]);
    expect(ann.id).toBeTruthy();
  });
});

describe("a lead's tools and the tools of this laptop only (criterion 4)", () => {
  it("a lead's tools refuse another laptop and list no remote rows", async () => {
    const { mbp, call, sent } = await setup();
    await call("spawn_worker", ANN);
    const lead = handlers(mbp.sup, { lead: "w_lead" });
    const refusal = /A lead's tools act on its own laptop only \(mbp-1\); laptop ubu1 is the orchestrator's/;
    await expect(call("spawn_worker", ANN, lead)).rejects.toThrow(refusal);
    await expect(call("list_workers", { laptop: "ubu1" }, lead)).rejects.toThrow(refusal);
    const ann = (await call("list_workers", { laptop: "ubu1" }))[0].id as string;
    // Its tools never resolve a remote id: here, it is no worker of this laptop's.
    await expect(call("worker_status", { id: ann }, lead)).rejects.toThrow(`No worker ${ann}`);
    await expect(call("stop_worker", { id: ann, laptop: "ubu1" }, lead)).rejects.toThrow(refusal);
    const local = await call("spawn_worker", { project: "games", role: "mario", task: "local", laptop: "mbp-1" }, lead);
    expect(await call("list_workers", { laptop: "*" }, lead)).toMatchObject([{ id: local.id, laptop: "mbp-1" }]);
    expect(sent().map((b) => b["op"])).toEqual(["spawn", "list"]);
  });

  it("run_slots, reset_worker, take_slot, free_slot and order_run_queue refuse another laptop", async () => {
    const { call, sent } = await setup();
    const { id } = await call("spawn_worker", ANN);
    for (const [tool, args] of [
      ["run_slots", {}],
      ["reset_worker", { id }],
      ["take_slot", { project: "helix", name: "Ann", label: "probe" }],
      ["free_slot", { name: "Ann" }],
      ["order_run_queue", { names: ["Ann"] }],
    ] as const) {
      await expect(call(tool, { ...args, laptop: "ubu1" })).rejects.toThrow(`${tool} acts on this laptop only (mbp-1); ubu1's is its own orchestrator's`);
    }
    expect(sent().length).toBe(1);
  });
});

describe("before sending: the peer list (criteria 5, 8)", () => {
  it("refuses a target that is offline at once, naming when it was last seen, and sends nothing", async () => {
    const { net, call, sent } = await setup();
    net.disconnect("ubu1");
    const seen = net.peerList().find((p) => p.address === SUP_UBU)!.last_seen;
    await expect(call("spawn_worker", ANN)).rejects.toThrow(`ubu1's supervisor is offline (last seen ${seen}): nothing was sent to ${SUP_UBU}`);
    await expect(call("list_workers", { laptop: "ubu1" })).rejects.toThrow("ubu1's supervisor is offline");
    // With no copies yet (A7), status of a worker there refuses with the offline reason too.
    await expect(call("worker_status", { id: "w_1", laptop: "ubu1" })).rejects.toThrow("ubu1's supervisor is offline");
    expect(sent()).toEqual([]);
  });

  it("refuses a laptop with no supervisor on BobNet", async () => {
    const { call, net } = await setup();
    await expect(call("spawn_worker", { ...ANN, laptop: "pi" })).rejects.toThrow("pi's supervisor isn't on BobNet: no supervisor@pi in the peer list");
    expect(net.log.filter((m) => m.from === SUP_MBP)).toEqual([]);
  });

  it("refuses a target older than the release that serves v: 2, and sends nothing", async () => {
    const { call, sent } = await setup({ ubu1Version: "2.0.0-rc.37" });
    await expect(call("spawn_worker", ANN)).rejects.toThrow(`ubu1's supervisor runs 2.0.0-rc.37; the remote tools need ${REMOTE_TOOLS_SINCE} there: nothing was sent`);
    expect(sent()).toEqual([]);
  });

  it("sends anyway when the target's version is missing or doesn't parse", async () => {
    for (const version of [undefined, "dev-build"]) {
      const { net, call, sent } = await setup();
      if (version === undefined) net.clients.delete(SUP_UBU);
      else net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version, protocol: 1 });
      expect(await call("spawn_worker", ANN)).toMatchObject({ laptop: "ubu1", state: "running" });
      expect(sent().length).toBe(1);
    }
  });

  it("refuses the same way when the target drops between the check and the send; if it is back in time, the orchestrator hears it spawned after all (criterion 7)", async () => {
    const { net, ubu, mbp, call } = await setup();
    const link = mbp.link as FakeLink;
    const request = link.request.bind(link);
    link.request = (async (frame: Parameters<FakeLink["request"]>[0]) => {
      if (frame.t === "send" && frame.to.includes(SUP_UBU)) net.disconnect("ubu1");
      return request(frame);
    }) as FakeLink["request"];
    await expect(call("spawn_worker", ANN)).rejects.toThrow("ubu1's supervisor is offline (it dropped as the spawn was sent; it runs only if ubu1 is back within 30 s, and you are told then)");
    link.request = request as FakeLink["request"];
    expect(ubu.store.workers()).toEqual([]);
    net.advance(10);
    await net.reconnect("ubu1");
    await until(() => net.between(SUP_MBP, "Bob@mbp-1").length > 0);
    const w = ubu.store.workers()[0]!;
    expect(net.between(SUP_MBP, "Bob@mbp-1")).toEqual([`Ann (${w.id}, studio/ann) on ubu1 spawned after all: its reply came after spawn_worker had given up on it. worker_status ${w.id} for more.`]);
    expect(mbp.store.auditLog(5).some((a) => a.action === "remote:spawned_after_all" && a.worker_id === w.id)).toBe(true);
    // Now known: its id resolves to ubu1.
    expect((await call("worker_status", { id: w.id })).laptop).toBe("ubu1");
  });

  it("a reply that comes in time makes no note", async () => {
    const { net, call } = await setup();
    await call("spawn_worker", ANN);
    await tick(20);
    expect(net.between(SUP_MBP, "Bob@mbp-1")).toEqual([]);
  });
});

describe("no reply in time, list finds the worker", () => {
  /** mbp-1's real supervisor, and ubu1's played by the test: it answers only list. */
  async function scriptedTarget() {
    const net = new FakeNetwork();
    net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
    const ubu = net.link("ubu1");
    const got: Array<{ id: string; body: Record<string, unknown> }> = [];
    ubu.onPush = (f) => {
      if (f.t !== "deliver") return;
      const body = JSON.parse(f.msg.body) as Record<string, unknown>;
      got.push({ id: f.msg.id, body });
      if (body["op"] === "list") void ubu.request({ t: "send", as: "supervisor", to: [SUP_MBP], body: JSON.stringify({ v: 2, re: "list", req: f.msg.id, ok: true, workers: [{ id: "w_9", state: "running" }] }) });
    };
    await ubu.register({ name: "supervisor" });
    const mbp = await boot(net, "mbp-1", "");
    const tools = handlers(mbp.sup);
    const result = (name: string, args: Record<string, unknown>) => callTool(tools, name, args).then((r) => ({ error: r.isError === true, text: r.content[0]!.text }));
    return { net, got, result };
  }

  it("status and stop answer from what list found, saying so; tail and summary ask again", async () => {
    const { net, got, result } = await scriptedTarget();
    for (const [tool, ok] of [["worker_status", true], ["stop_worker", true], ["tail_worker", false], ["worker_summary", false]] as const) {
      const r = result(tool, { id: "w_9", laptop: "ubu1" });
      const before = got.length;
      await until(() => got.length === before + 1);
      net.advance(50);
      const out = await r;
      expect(out.error).toBe(!ok);
      if (ok) expect(JSON.parse(out.text)).toMatchObject({ id: "w_9", state: "running", laptop: "ubu1", note: expect.stringMatching(/^no reply in time; ubu1's list shows it/) });
      else expect(out.text).toBe(`no reply from ubu1 to the ${tool === "tail_worker" ? "tail" : "summary"} in time; its list shows w_9 running: ask again`);
    }
  });
});
