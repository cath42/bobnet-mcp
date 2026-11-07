import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Policy } from "../src/policy.ts";
import { readRequest } from "../src/remote.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { FakeBroker, fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";

const POLICY = new Policy(`rules: []`);
const OVER = `  studio:
    path: /work/studio
    roles:
      bob: { dir: /work/studio-bob, lead: true, remote_control: true }
      ann: { dir: /work/studio-ann }
`;
const REMOTE = `remote:\n  poe@ubu1: { spawn: { studio: [bob] } }\n`;

let dir: string;
let store: Store;
let running: Supervisor[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bobnet-remote-"));
  store = new Store(join(dir, "supervisor.db"));
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// The remote list sits at the top level, after the projects.
const testConfigWithRemote = () => testConfig(dir, `${OVER}${REMOTE}`);

async function setup() {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery();
  const sup = new Supervisor({ config: testConfigWithRemote(), policy: POLICY, store, broker, queryFn, log: quiet, ownerCheck: async () => false });
  await sup.start();
  running.push(sup);
  let n = 0;
  /** Sends the supervisor a request from `from`; resolves with its JSON answer. */
  const ask = async (from: string, body: unknown, id = `m_r${++n}`) => {
    const before = broker.sent.length;
    sup.onPush({
      t: "message",
      to: "supervisor@mbp-1",
      wake: true,
      msg: { id, type: "message", from, to: ["supervisor@mbp-1"], team: "portfolio", laptop: from.split("@")[1], in_reply_to: null, urgent: false, body: typeof body === "string" ? body : JSON.stringify(body), created_at: "2026-11-07T00:00:00Z", expires_at: "2026-12-07T00:00:00Z" },
    } as never);
    await until(() => broker.sent.slice(before).some((s) => s.to.includes(from)));
    return JSON.parse(broker.sent.slice(before).find((s) => s.to.includes(from))!.body);
  };
  return { sup, broker, sessions, ask };
}

const SPAWN = { op: "spawn", project: "studio", role: "bob", task: "Lead LAND-42 build 3", session: { feature: "LAND-42", kind: "build", label: "3" } };

describe("remote config", () => {
  it("lists who may spawn which roles, checked against the projects", () => {
    expect(testConfigWithRemote().remote.get("poe@ubu1")!.get("studio")).toEqual(new Set(["bob"]));
    expect(() => testConfig(dir, `${OVER}remote:\n  poe@ubu1: { spawn: { studio: [zed] } }\n`)).toThrow(/no role zed in studio/);
    expect(() => testConfig(dir, `${OVER}remote:\n  poe: { spawn: { studio: [bob] } }\n`)).toThrow(/name@laptop/);
  });
});

describe("a remote request", () => {
  it("reads one JSON object, bare or fenced, and leaves plain messages alone", () => {
    expect(readRequest(JSON.stringify({ op: "list" }))).toEqual({ request: { op: "list" } });
    expect(readRequest('```json\n{"op":"status","id":"w_1"}\n```')).toEqual({ request: { op: "status", id: "w_1" } });
    expect(readRequest("Hi supervisor, how are you?")).toBeNull();
    expect(readRequest('{"op":"spawn","project":"studio"}')).toMatchObject({ error: expect.stringMatching(/^bad request: role/) });
    // No resumed sessions or handoff files from afar.
    expect(readRequest(JSON.stringify({ ...SPAWN, resume_session: "sess-x" }))).toMatchObject({ error: expect.stringMatching(/resume_session/) });
  });

  it("spawns an allowed role as the requester's, through the usual path, and tells it the session URL and the end", async () => {
    const { sup, broker, sessions, ask } = await setup();
    const r = await ask("poe@ubu1", SPAWN);
    expect(r).toMatchObject({ ok: true, op: "spawn", worker: { project: "studio", role: "bob", name: "Bob", session: "LAND-42 build 3" } });
    const id = r.worker.id as string;
    expect(store.worker(id)!.spawned_by).toBe("poe@ubu1");
    expect(store.auditLog(20).find((a) => a.action === "spawn" && a.worker_id === id)!.actor).toBe("poe@ubu1");
    expect(store.auditLog(20).find((a) => a.action === "remote:spawn")).toMatchObject({ actor: "poe@ubu1", worker_id: id });
    await until(() => broker.sent.some((s) => s.to.includes("poe@ubu1") && s.body.includes('"event":"remote_control"')));
    expect(JSON.parse(broker.sent.find((s) => s.body.includes('"event":"remote_control"'))!.body)).toEqual({ event: "remote_control", worker: id, url: "https://claude.ai/code/session_test" });
    expect(await ask("poe@ubu1", { op: "status", id })).toMatchObject({ ok: true, worker: { id, state: "running", remote_url: "https://claude.ai/code/session_test" } });
    expect((await ask("poe@ubu1", { op: "list" })).workers.map((w: { id: string }) => w.id)).toEqual([id]);

    const stopping = ask("poe@ubu1", { op: "stop", id });
    await until(() => sessions[0]!.inputs.length === 2);
    sessions[0]!.turnDone("handoff written");
    expect(await stopping).toMatchObject({ ok: true, op: "stop" });
    await until(() => broker.sent.some((s) => s.body.includes('"event":"exit"')));
    expect(JSON.parse(broker.sent.find((s) => s.body.includes('"event":"exit"'))!.body)).toMatchObject({ event: "exit", worker: id, state: "stopped", error: "stopped by poe@ubu1" });
    expect(sup.status(id).state).toBe("stopped");
  });

  it("refuses anyone not listed, any role not listed, and workers it didn't spawn", async () => {
    const { sup, sessions, ask } = await setup();
    expect(await ask("mallory@ubu1", SPAWN)).toEqual({ ok: false, op: "spawn", error: "mallory@ubu1 may not make requests here: it isn't in this supervisor's remote list" });
    expect(await ask("poe@ubu1", { ...SPAWN, role: "ann" })).toMatchObject({ ok: false, error: "poe@ubu1 may not spawn studio/ann; it may spawn studio/bob" });
    expect(await ask("poe@ubu1", { ...SPAWN, project: "helix", role: "bill" })).toMatchObject({ ok: false, error: expect.stringMatching(/may not spawn helix\/bill/) });
    const local = sup.spawn({ project: "studio", role: "ann", task: "x" });
    expect(await ask("poe@ubu1", { op: "stop", id: local.id })).toMatchObject({ ok: false, error: `${local.id} isn't a worker poe@ubu1 spawned` });
    expect(await ask("poe@ubu1", { op: "status", id: local.id })).toMatchObject({ ok: false });
    expect(await ask("poe@ubu1", { op: "answer", id: "r_1", decision: "allow" })).toMatchObject({ ok: false, error: expect.stringMatching(/^bad request/) });
    expect(await ask("poe@ubu1", '{"op":"spawn"}')).toMatchObject({ ok: false, op: "invalid" });
    await tick(20);
    expect(sessions.length).toBe(1);
    expect(store.auditLog(50).filter((a) => a.action === "remote:refused").length).toBe(7);
  });

  it("is acted on once when the broker delivers it twice", async () => {
    const { sessions, ask } = await setup();
    const first = await ask("poe@ubu1", SPAWN, "m_dup");
    const again = await ask("poe@ubu1", SPAWN, "m_dup");
    expect(again).toEqual(first);
    await tick(20);
    expect(sessions.length).toBe(1);
    expect(store.workers({ project: "studio" }).length).toBe(1);
  });

  it("leaves a plain message to the supervisor unanswered", async () => {
    const { sup, broker } = await setup();
    sup.onPush({ t: "message", to: "supervisor@mbp-1", wake: true, msg: { id: "m_hi", type: "message", from: "poe@ubu1", to: ["supervisor@mbp-1"], team: "portfolio", laptop: "ubu1", in_reply_to: null, urgent: false, body: "hello", created_at: "2026-11-07T00:00:00Z", expires_at: "2026-12-07T00:00:00Z" } } as never);
    await tick(30);
    expect(broker.sent.filter((s) => s.to.includes("poe@ubu1"))).toEqual([]);
    expect(broker.acks.some((a) => a.ids.includes("m_hi"))).toBe(true);
  });
});
