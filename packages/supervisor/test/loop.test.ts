import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Policy } from "../src/policy.ts";
import { readRequest } from "../src/remote.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork, type FakeLink } from "./network.ts";

// A supervisor never answers an answer (ADR 0007 §2). Today's replies carry `op`, so a supervisor that
// read one as a request would answer it with another that has `op`, and two supervisors would answer
// each other until a broker gave out. The guard pinned here is protocol's `classifyRemote` (through `readRequest`): a request has `op`, no
// `in_reply_to`, and neither `re` nor `event`.

const POLICY = new Policy(`rules: []`);
const STUDIO = `  studio:
    path: /work/studio
    roles:
      ann: { dir: /work/studio-ann }
`;

// rc.37's replies and events as ubu1 sent them in the BOB-44 spike (architecture/spikes/bob44-two-laptops.md,
// c5ecfd0): both refusals, the "invalid" reply, and the others it sends.
const RC37 = {
  refusedRole: `{"ok":false,"op":"spawn","error":"Luigi@mbp-1 may not spawn athletic/phelps; it may spawn athletic/reviewer"}`,
  refusedBoard: `{"ok":false,"op":"spawn","error":"athletic has a board: say which items this worker works on or reviews, tasks: [\\"LAND-41.3\\", …] (a feature id for the feature as a whole; [] for none)"}`,
  invalid: `{"ok":false,"op":"invalid","error":"bad request: op Unrecognized key: \\"handoff\\""}`,
  list: `{"ok":true,"op":"list","workers":[]}`,
  spawned: `{"ok":true,"op":"spawn","worker":{"id":"w_66610ddc","project":"athletic","role":"reviewer","name":"Reviewer","as":"worker","state":"running","session":null,"checkpoint":null,"error":null,"started_at":"2026-11-17T13:27:01.311Z","ended_at":null,"remote_url":null}}`,
  stopRefused: `{"ok":false,"op":"stop","error":"Worker w_17d04a81 is done, not running"}`,
  notYours: `{"ok":false,"op":"status","error":"w_00000000 isn't a worker Luigi@mbp-1 spawned"}`,
  remoteControl: `{"event":"remote_control","worker":"w_17d04a81","url":"https://claude.ai/code/session_018YwWqzKwGKAqcQ27fruKRp"}`,
  exit: `{"event":"exit","worker":"w_67a19a5b","state":"done","checkpoint":"spike 4: handoff write also denied …"}`,
};

// What a v: 2 supervisor will send (§2): replies with `re` and `req`, events with `event`.
const V2 = {
  reply: `{"v":2,"re":"list","req":"m_00000001","ok":true,"workers":[]}`,
  refusal: `{"v":2,"re":"spawn","req":"m_00000001","ok":false,"error":"refused"}`,
  // A reply with `op` too: `re` alone makes it a reply.
  replyWithOp: `{"v":2,"re":"spawn","op":"spawn","req":"m_00000001","ok":false,"error":"refused"}`,
  event: `{"v":2,"event":"exit","worker":"w_1","spawn_req":"m_00000001","state":"done"}`,
  eventWithOp: `{"v":2,"event":"settled","op":"answer","worker":"w_1","spawn_req":"m_00000001"}`,
};

const dirs: string[] = [];
let running: Array<{ sup: Supervisor; store: Store }> = [];
afterEach(async () => {
  await Promise.all(running.map((r) => r.sup.shutdown()));
  await tick(20);
  for (const r of running.splice(0)) r.store.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A supervisor on `laptop`, on the network, that lets the other laptop's supervisor spawn studio/ann. */
async function boot(net: FakeNetwork, laptop: string, other: string): Promise<{ sup: Supervisor; link: FakeLink; store: Store }> {
  const dir = mkdtempSync(join(tmpdir(), `bobnet-loop-${laptop}-`));
  dirs.push(dir);
  const store = new Store(join(dir, "supervisor.db"));
  const link = net.link(laptop);
  const { queryFn } = fakeQuery();
  const config = testConfig(dir, `${STUDIO}remote:\n  supervisor@${other}: { spawn: { studio: [ann] } }\n`);
  const sup = new Supervisor({ config, policy: POLICY, store, broker: link, queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => false });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push({ sup, store });
  return { sup, link, store };
}

async function twoSupervisors() {
  const net = new FakeNetwork();
  const mbp = await boot(net, "mbp-1", "ubu1");
  const ubu = await boot(net, "ubu1", "mbp-1");
  return { net, mbp, ubu };
}

/** Sends a body as a laptop's supervisor, the way a requester (today a hand-written message) does. */
const send = (link: FakeLink, to: string, body: string, in_reply_to?: string) =>
  link.request<{ id: string }>({ t: "send", as: "supervisor", to: [to], body, ...(in_reply_to ? { in_reply_to } : {}) });

/** Waits until the network has been quiet a while: an exchange that keeps going never is, and hits the limit. */
async function settle(net: FakeNetwork): Promise<void> {
  let n = -1;
  while (n !== net.log.length) {
    n = net.log.length;
    await tick(40);
  }
}

const SUP_MBP = "supervisor@mbp-1";
const SUP_UBU = "supervisor@ubu1";

describe("the loop test: two supervisors never answer each other's replies", () => {
  it("today's request (no v): request, reply and the worker's event, and nothing back", async () => {
    const { net, mbp, ubu } = await twoSupervisors();
    const req = await send(mbp.link, SUP_UBU, JSON.stringify({ op: "spawn", project: "studio", role: "ann", task: "one fix" }));
    await until(() => net.between(SUP_UBU, SUP_MBP).some((b) => b.includes('"event":"remote_control"')));
    await settle(net);
    const reply = net.log.find((m) => m.from === SUP_UBU && m.in_reply_to === req.id)!;
    expect(JSON.parse(reply.body)).toMatchObject({ ok: true, op: "spawn", worker: { role: "ann" } });
    // Request, reply, event: mbp-1 answered neither the reply (it has `op`) nor the event.
    expect(net.log.map((m) => [m.from, m.in_reply_to, Object.keys(JSON.parse(m.body)).slice(0, 2).join(",")])).toEqual([
      [SUP_MBP, null, "op,project"],
      [SUP_UBU, req.id, "ok,op"],
      [SUP_UBU, null, "event,worker"],
    ]);
    expect(net.refused).toEqual([]);
    expect(ubu.store.auditLog(20).filter((a) => a.action.startsWith("remote:"))).toHaveLength(1);
    expect(mbp.store.auditLog(20).filter((a) => a.action.startsWith("remote:"))).toEqual([]);
  });

  it("a v: 2 request: the target refuses it with a v: 2 reply until it serves them, and the requester doesn't answer the refusal", async () => {
    const { net, mbp, ubu } = await twoSupervisors();
    const req = await send(ubu.link, SUP_MBP, JSON.stringify({ v: 2, op: "list" }));
    await until(() => net.log.some((m) => m.in_reply_to === req.id));
    await settle(net);
    expect(net.log.map((m) => [m.from, m.in_reply_to])).toEqual([
      [SUP_UBU, null],
      [SUP_MBP, req.id],
    ]);
    // The v: 2 ops are served from BOB-62 on; the refusal is a reply (rc.37's own, RC37.invalid, is below).
    expect(JSON.parse(net.log[1]!.body)).toEqual({ v: 2, re: "list", req: req.id, ok: false, error: "this supervisor doesn't serve v: 2 requests yet" });
    expect(mbp.store.auditLog(20).filter((a) => a.action.startsWith("remote:")).map((a) => a.action)).toEqual(["remote:refused"]);
    expect(ubu.store.auditLog(20).filter((a) => a.action.startsWith("remote:"))).toEqual([]);
  });

  it("both at once, crossing: each answers the other's request once, and nothing more", async () => {
    const { net, mbp, ubu } = await twoSupervisors();
    await Promise.all([send(mbp.link, SUP_UBU, JSON.stringify({ op: "list" })), send(ubu.link, SUP_MBP, JSON.stringify({ v: 2, op: "list" }))]);
    await until(() => net.log.length >= 4);
    await settle(net);
    expect(net.log).toHaveLength(4);
    expect(net.log.filter((m) => m.in_reply_to !== null)).toHaveLength(2);
  });

  it("v: 2 replies and events, with in_reply_to and resent without it, are never answered", async () => {
    const { net, mbp, ubu } = await twoSupervisors();
    const hello = await send(mbp.link, SUP_UBU, "hello");
    for (const body of Object.values(V2)) {
      await send(ubu.link, SUP_MBP, body, hello.id);
      // The resend after `unknown_message` (§2): no in_reply_to, `re` or `event` still there.
      await send(ubu.link, SUP_MBP, body);
    }
    await settle(net);
    expect(net.log).toHaveLength(1 + 2 * Object.keys(V2).length);
    expect(net.between(SUP_MBP, SUP_UBU)).toEqual(["hello"]);
    expect(mbp.store.auditLog(50).filter((a) => a.action.startsWith("remote:"))).toEqual([]);
  });

  it("rc.37's exact replies and events, as it sends them, are never answered", async () => {
    const { net, mbp, ubu } = await twoSupervisors();
    // rc.37 sends each reply with in_reply_to its request, and each event without.
    const req = await send(mbp.link, SUP_UBU, "a request rc.37 answered");
    for (const [kind, body] of Object.entries(RC37)) await send(ubu.link, SUP_MBP, body, kind.startsWith("remote") || kind === "exit" ? undefined : req.id);
    // And the other way, at ubu1.
    const back = await send(ubu.link, SUP_MBP, "a request rc.37 answered");
    for (const [kind, body] of Object.entries(RC37)) await send(mbp.link, SUP_UBU, body, kind.startsWith("remote") || kind === "exit" ? undefined : back.id);
    await settle(net);
    const n = Object.keys(RC37).length;
    expect(net.log).toHaveLength(2 + 2 * n);
    expect(net.between(SUP_MBP, SUP_UBU)).toEqual(["a request rc.37 answered", ...Object.values(RC37)]);
    expect(net.between(SUP_UBU, SUP_MBP)).toEqual([...Object.values(RC37), "a request rc.37 answered"]);
    for (const s of [mbp, ubu]) expect(s.store.auditLog(50).filter((a) => a.action.startsWith("remote:"))).toEqual([]);
  });
});

describe("what a supervisor answers: a request only with op, no in_reply_to, and neither re nor event", () => {
  it("reads a request", () => {
    expect(readRequest(`{"op":"list"}`)).toEqual({ request: { op: "list" } });
    expect(readRequest(`{"op":"list"}`, null)).toEqual({ request: { op: "list" } });
    // Malformed, but a request: it gets its refusal.
    expect(readRequest(`{"op":"nope"}`, null)).toMatchObject({ error: expect.stringMatching(/^bad request/) });
    expect(readRequest(`{"v":2,"op":"list"}`, null)).toMatchObject({ error: expect.stringMatching(/^bad request/) });
  });

  it("leaves anything sent in reply alone, whatever its body", () => {
    expect(readRequest(`{"op":"list"}`, "m_1")).toBeNull();
    for (const body of Object.values(RC37)) expect(readRequest(body, "m_1")).toBeNull();
  });

  it("leaves a body with re or event alone, with or without in_reply_to", () => {
    for (const body of Object.values(V2)) {
      expect(readRequest(body, null)).toBeNull();
      expect(readRequest(body, "m_1")).toBeNull();
    }
    expect(readRequest(`{"op":"list","re":null}`)).toBeNull();
    expect(readRequest('```json\n{"op":"list","event":"exit"}\n```')).toBeNull();
  });

  it("leaves a body without op alone, as before", () => {
    expect(readRequest(RC37.exit, null)).toBeNull();
    expect(readRequest(`{"id":"w_1"}`, null)).toBeNull();
    expect(readRequest("hello", null)).toBeNull();
  });
});
