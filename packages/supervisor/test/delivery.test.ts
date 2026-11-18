import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Envelope, findSecret } from "@bobnet/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { type RemoteOutcome, Supervisor } from "../src/supervisor.ts";
import { fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork, type FakeLink } from "./network.ts";

// How replies, events and requests cross between supervisors (ADR 0007 §2, BOB-61): the `remote`
// outbox, final codes, the resend of a swept reply, credentials withheld, the requester's record and
// deadlines, the target's in-progress dedupe. On the FakeNetwork, its clock and its sweep the test's.

const POLICY = new Policy(`rules: []`);
const PROJECTS = `  studio:
    path: /work/studio
    roles:
      ann: { dir: /work/studio-ann }
  works:
    path: /work/works
    board: service
    roles:
      kim: { dir: /work/works-kim }
`;
const SUP_MBP = "supervisor@mbp-1";
const SUP_UBU = "supervisor@ubu1";
const WITHHELD = "[withheld: looks like a credential]";
const GH = "ghp_" + "a".repeat(36);

const dirs: string[] = [];
const stores = new Set<Store>();
let running: Supervisor[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  for (const s of stores) s.close();
  stores.clear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function newStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "bobnet-delivery-"));
  dirs.push(dir);
  const store = new Store(join(dir, "supervisor.db"));
  stores.add(store);
  return { store, dir };
}

/** A real supervisor on `laptop` that lets the other laptop's supervisor spawn studio/ann and works/kim. */
async function boot(net: FakeNetwork, laptop: string, other: string, at = newStore()): Promise<{ sup: Supervisor; link: FakeLink; store: Store; sessions: ReturnType<typeof fakeQuery>["sessions"] }> {
  const { store, dir } = at;
  const link = net.link(laptop);
  const { queryFn, sessions } = fakeQuery();
  const config = testConfig(dir, `${PROJECTS}remote:\n  supervisor@${other}: { spawn: { studio: [ann], works: [kim] } }\n`);
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config, policy: POLICY, store, broker: link, queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => false, sleep: net.sleep, ciPoll });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push(sup);
  return { sup, link, store, sessions };
}

/** Another laptop's supervisor as the test plays it: what it got, and it sends by hand. */
async function scripted(net: FakeNetwork, laptop: string, names = ["supervisor"]): Promise<{ link: FakeLink; got: Envelope[] }> {
  const link = net.link(laptop);
  const got: Envelope[] = [];
  link.onPush = (f) => {
    if (f.t === "deliver") got.push(f.msg);
  };
  for (const name of names) await link.register({ name });
  return { link, got };
}

const send = (link: FakeLink, to: string, body: unknown, opts: { in_reply_to?: string; ttl_seconds?: number; as?: string } = {}) =>
  link.request<{ id: string }>({
    t: "send",
    as: opts.as ?? "supervisor",
    to: [to],
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(opts.in_reply_to ? { in_reply_to: opts.in_reply_to } : {}),
    ...(opts.ttl_seconds ? { ttl_seconds: opts.ttl_seconds } : {}),
  });

const ttlOf = (m: Envelope) => (Date.parse(m.expires_at) - Date.parse(m.created_at)) / 1000;
const notYours = (id: string) => `${id} isn't a worker ${SUP_MBP} spawned`;

describe("the store: the remote outbox and the requests' records", () => {
  it("keeps a remote row's to, its body verbatim, in_reply_to and ttl_seconds, in the order made", () => {
    const { store } = newStore();
    store.addOutbox(SUP_MBP, `{"v":2,"re":"list","req":"m_1","ok":true}`, "remote", { inReplyTo: "m_1", ttlSeconds: 86_400 });
    store.addOutbox(SUP_MBP, `{"event":"exit","worker":"w_1"}`, "remote", { ttlSeconds: 86_400 });
    store.addOutbox("Bob", "a notice");
    expect(store.outbox("remote").map((r) => [r.to_name, r.body, r.in_reply_to, r.ttl_seconds])).toEqual([
      [SUP_MBP, `{"v":2,"re":"list","req":"m_1","ok":true}`, "m_1", 86_400],
      [SUP_MBP, `{"event":"exit","worker":"w_1"}`, null, 86_400],
    ]);
    expect(store.outbox("message")).toMatchObject([{ body: "a notice", in_reply_to: null, ttl_seconds: null }]);
  });

  it("opens a database from before: the outbox gains in_reply_to and ttl_seconds, remote_requests a reply that may be null", () => {
    const { dir } = newStore();
    const file = join(dir, "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, to_name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'message');
      CREATE TABLE remote_requests (message_id TEXT PRIMARY KEY, sender TEXT NOT NULL, op TEXT NOT NULL, reply TEXT NOT NULL, at TEXT NOT NULL);
      INSERT INTO outbox (to_name, body, created_at) VALUES ('Bob', 'kept', '2026-11-01T00:00:00Z');
      INSERT INTO remote_requests VALUES ('m_old', 'poe@ubu1', 'list', '{"ok":true,"op":"list","workers":[]}', '2026-11-01T00:00:00Z');`);
    old.close();
    const store = new Store(file);
    stores.add(store);
    expect(store.outbox()).toMatchObject([{ body: "kept", kind: "message", in_reply_to: null, ttl_seconds: null }]);
    expect(store.remoteRequest("m_old")).toEqual({ sender: "poe@ubu1", op: "list", reply: '{"ok":true,"op":"list","workers":[]}', v: 1 });
    expect(store.beginRemote("m_new", SUP_MBP, "spawn", 2)).toBe(true);
    expect(store.remoteRequest("m_new")).toEqual({ sender: SUP_MBP, op: "spawn", reply: null, v: 2 });
  });

  it("records a request in progress once, then its reply", () => {
    const { store } = newStore();
    expect(store.beginRemote("m_1", SUP_MBP, "spawn", 2)).toBe(true);
    expect(store.beginRemote("m_1", SUP_MBP, "spawn", 2)).toBe(false);
    expect(store.remoteInProgress()).toEqual([{ message_id: "m_1", sender: SUP_MBP, op: "spawn", v: 2 }]);
    store.finishRemote("m_1", "{}");
    expect(store.remoteRequest("m_1")!.reply).toBe("{}");
    expect(store.remoteInProgress()).toEqual([]);
  });

  it("keeps what the requester sent: a reply settles it whenever it comes, and nothing replaces one", () => {
    const { store } = newStore();
    store.addRemoteSent({ id: "rs_1", to: SUP_UBU, op: "status", target: "w_1", body: "{}", deadline: "2026-11-17T12:00:50Z" });
    expect(store.remoteSent("rs_1")).toMatchObject({ state: "sending", message_id: null });
    store.remoteSentAs("rs_1", "m_9");
    store.settleRemoteSent("rs_1", { state: "unanswered" });
    expect(store.remoteSentByMessage("m_9")).toMatchObject({ id: "rs_1", state: "unanswered" });
    store.settleRemoteSent("rs_1", { state: "replied", reply: "late" });
    store.settleRemoteSent("rs_1", { state: "replied", reply: "again" });
    store.settleRemoteSent("rs_1", { state: "failed" });
    expect(store.remoteSent("rs_1")).toMatchObject({ state: "replied", reply: "late" });
  });
});

describe("the remote outbox: replies and events in the order made (criterion 1)", () => {
  it("queues v: 2 replies and the events verbatim, with in_reply_to and a day's ttl, never sent past the queue", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    // The broker can't be reached from ubu1.
    ubu.link.failSend = () => "timeout";
    const r1 = await send(mbp.link, SUP_UBU, { v: 2, op: "status", id: "w_1" });
    const r2 = await send(mbp.link, SUP_UBU, { op: "spawn", project: "studio", role: "ann", task: "one fix" });
    const r3 = await send(mbp.link, SUP_UBU, { v: 2, op: "list" });
    // Three replies and the spawned worker's remote_control event.
    await until(() => ubu.store.outbox("remote").length === 4);
    const queued = ubu.store.outbox("remote");
    expect(queued.map((r) => [r.to_name, r.in_reply_to, r.ttl_seconds])).toContainEqual([SUP_MBP, r1.id, 86_400]);
    expect(queued.find((r) => r.in_reply_to === r1.id)!.body).toBe(JSON.stringify({ v: 2, re: "status", req: r1.id, ok: false, error: notYours("w_1") }));
    expect(JSON.parse(queued.find((r) => r.in_reply_to === r3.id)!.body)).toMatchObject({ v: 2, re: "list", req: r3.id, ok: true, workers: [{ project: "studio", role: "ann" }] });
    expect(queued.find((r) => r.in_reply_to === r2.id)!.body).toMatch(/^\{"ok":true,"op":"spawn",/);
    expect(queued.find((r) => r.in_reply_to === null)).toMatchObject({ to_name: SUP_MBP, ttl_seconds: 86_400, body: expect.stringMatching(/^\{"event":"remote_control","worker":"w_/) });
    expect(net.log.filter((m) => m.from === SUP_UBU)).toEqual([]);

    // Back: a reply made now goes after those made before, not past them.
    ubu.link.failSend = () => null;
    const r4 = await send(mbp.link, SUP_UBU, { v: 2, op: "status", id: "w_2" });
    await until(() => mbp.got.length === 5);
    expect(mbp.got.map((m) => [m.body, m.in_reply_to])).toEqual([...queued.map((r) => [r.body, r.in_reply_to]), [JSON.stringify({ v: 2, re: "status", req: r4.id, ok: false, error: notYours("w_2") }), r4.id]]);
    expect(ubu.store.outbox()).toEqual([]);
  });
});

describe("final codes (criterion 2)", () => {
  it.each(["unknown_peer", "bad_frame", "frame_too_large"])("drops a reply refused %s, audits it remote:undeliverable, and sends the rows behind it", async (code) => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    ubu.link.failSend = () => "timeout";
    const bad = await send(mbp.link, SUP_UBU, { v: 2, op: "status", id: "w_bad" });
    const good = await send(mbp.link, SUP_UBU, { v: 2, op: "status", id: "w_ok" });
    await until(() => ubu.store.outbox("remote").length === 2);
    ubu.link.failSend = (f) => (f.body.includes(`"req":"${bad.id}"`) ? code : null);
    ubu.sup.onConnected();
    await until(() => mbp.got.length === 1);
    expect(JSON.parse(mbp.got[0]!.body)).toMatchObject({ req: good.id });
    expect(ubu.store.outbox()).toEqual([]);
    expect(ubu.store.auditLog(20).find((a) => a.action === "remote:undeliverable")).toMatchObject({ actor: "supervisor", detail: expect.stringContaining(`"code":"${code}"`) });
  });

  it("drops what the broker itself refuses: a peer it doesn't know, a body past its limit", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const at = newStore();
    at.store.addOutbox("supervisor@nowhere", `{"event":"exit","worker":"w_1"}`, "remote", { ttlSeconds: 86_400 });
    at.store.addOutbox(SUP_MBP, JSON.stringify({ event: "exit", worker: "w_2", checkpoint: "x".repeat(17_000) }), "remote", { ttlSeconds: 86_400 });
    at.store.addOutbox(SUP_MBP, `{"event":"exit","worker":"w_3"}`, "remote", { ttlSeconds: 86_400 });
    const ubu = await boot(net, "ubu1", "mbp-1", at);
    await until(() => mbp.got.length === 1);
    expect(mbp.got[0]!.body).toBe(`{"event":"exit","worker":"w_3"}`);
    expect(net.refused).toEqual([{ from: SUP_UBU, to: ["supervisor@nowhere"], code: "unknown_peer" }]);
    expect(ubu.store.auditLog(20).filter((a) => a.action === "remote:undeliverable").map((a) => JSON.parse(a.detail).code)).toEqual(["too_long", "unknown_peer"]);
    expect(ubu.store.outbox()).toEqual([]);
  });

  it("keeps a row, and all behind it, while the broker can't be reached", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    ubu.link.failSend = () => "disconnected";
    const r1 = await send(mbp.link, SUP_UBU, { v: 2, op: "status", id: "w_1" });
    const r2 = await send(mbp.link, SUP_UBU, { v: 2, op: "status", id: "w_2" });
    await until(() => ubu.store.outbox("remote").length === 2);
    ubu.sup.onConnected();
    await tick(30);
    ubu.link.failSend = () => "timeout";
    ubu.sup.onConnected();
    await tick(30);
    expect(ubu.store.outbox("remote")).toHaveLength(2);
    expect(ubu.store.auditLog(20).filter((a) => a.action === "remote:undeliverable")).toEqual([]);

    ubu.link.failSend = () => null;
    ubu.sup.onConnected();
    await until(() => mbp.got.length === 2);
    expect(mbp.got.map((m) => m.in_reply_to)).toEqual([r1.id, r2.id]);
    expect(ubu.store.outbox()).toEqual([]);
  });

  it("kind message gets the same rule: one refused for good is dropped and audited, the notices behind it go; an outage keeps them", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1", ["supervisor", "Bob"]);
    const at = newStore();
    at.store.addOutbox("Ghost@mbp-1", "lost");
    at.store.addOutbox("Bob@mbp-1", "after it");
    at.store.addOutbox("Bob@mbp-1", "and after that");
    const link = net.link("ubu1");
    link.failSend = () => "disconnected";
    const ubu = await boot(net, "ubu1", "mbp-1", at);
    await tick(30);
    expect(ubu.store.outbox("message")).toHaveLength(3);

    link.failSend = () => null;
    ubu.sup.onConnected();
    await until(() => mbp.got.length === 2);
    expect(mbp.got.map((m) => m.body.replace(/^\(sent [^)]+\) /, ""))).toEqual(["after it", "and after that"]);
    expect(ubu.store.outbox()).toEqual([]);
    expect(ubu.store.auditLog(20).find((a) => a.action === "message:undeliverable")).toMatchObject({ detail: expect.stringContaining('"code":"unknown_peer"') });
  });
});

describe("a reply whose request was swept (criterion 3)", () => {
  it("is sent again once without in_reply_to, still carrying re and req", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    ubu.link.failSend = () => "timeout";
    const req = await send(mbp.link, SUP_UBU, { v: 2, op: "status", id: "w_1" }, { ttl_seconds: 20 });
    await until(() => ubu.store.outbox("remote").length === 1);
    net.advance(21);
    net.sweep();
    ubu.link.failSend = () => null;
    ubu.sup.onConnected();
    await until(() => mbp.got.length === 1);
    expect(net.refused).toEqual([{ from: SUP_UBU, to: [SUP_MBP], code: "unknown_message" }]);
    expect(mbp.got[0]!.in_reply_to).toBeNull();
    expect(JSON.parse(mbp.got[0]!.body)).toEqual({ v: 2, re: "status", req: req.id, ok: false, error: notYours("w_1") });
    await tick(30);
    expect(mbp.got).toHaveLength(1);
    expect(ubu.store.outbox()).toEqual([]);
    expect(ubu.store.auditLog(20).filter((a) => a.action === "remote:undeliverable")).toEqual([]);
  });

  it("goes as it is while its request is only expired, not yet swept", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    ubu.link.failSend = () => "timeout";
    const req = await send(mbp.link, SUP_UBU, { v: 2, op: "list" }, { ttl_seconds: 20 });
    await until(() => ubu.store.outbox("remote").length === 1);
    net.advance(21);
    ubu.link.failSend = () => null;
    ubu.sup.onConnected();
    await until(() => mbp.got.length === 1);
    expect(mbp.got[0]!.in_reply_to).toBe(req.id);
    expect(net.refused).toEqual([]);
  });

  it("isn't sent again without in_reply_to when, read without it, it would be a request (today's replies carry op, no re): dropped and audited", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    ubu.link.failSend = () => "timeout";
    await send(mbp.link, SUP_UBU, { op: "status", id: "w_1" }, { ttl_seconds: 20 });
    await until(() => ubu.store.outbox("remote").length === 1);
    net.advance(21);
    net.sweep();
    ubu.link.failSend = () => null;
    ubu.sup.onConnected();
    await until(() => ubu.store.outbox().length === 0);
    await tick(30);
    expect(mbp.got).toEqual([]);
    expect(net.refused.map((r) => r.code)).toEqual(["unknown_message"]);
    expect(ubu.store.auditLog(20).find((a) => a.action === "remote:undeliverable")).toMatchObject({ detail: expect.stringContaining('"code":"unknown_message"') });
  });
});

describe("credentials (criterion 4)", () => {
  async function spawned(net: FakeNetwork) {
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    const r = await send(mbp.link, SUP_UBU, { op: "spawn", project: "studio", role: "ann", task: "one fix" });
    await until(() => mbp.got.some((m) => m.in_reply_to === r.id));
    const id = JSON.parse(mbp.got.find((m) => m.in_reply_to === r.id)!.body).worker.id as string;
    await until(() => mbp.got.some((m) => m.body.includes('"event":"remote_control"')));
    return { mbp, ubu, id };
  }

  it("withholds each text field's span that looks like a credential before it queues, and sends the rest", async () => {
    const net = new FakeNetwork();
    const { mbp, ubu, id } = await spawned(net);
    ubu.store.updateWorker(id, { checkpoint: `pushed with ${GH}; handoff in lead/h.md`, error: `token ${GH} refused` });
    const r = await send(mbp.link, SUP_UBU, { op: "status", id });
    await until(() => mbp.got.some((m) => m.in_reply_to === r.id));
    const worker = JSON.parse(mbp.got.find((m) => m.in_reply_to === r.id)!.body).worker;
    expect(worker).toMatchObject({ id, checkpoint: `pushed with ${WITHHELD}; handoff in lead/h.md`, error: `token ${WITHHELD} refused` });
    expect(ubu.store.remoteRequest(r.id)!.reply).not.toContain(GH);
    expect(net.refused).toEqual([]);
  });

  it("when the broker refuses it anyway (a newer detector), sends a short withheld event in its place", async () => {
    const net = new FakeNetwork();
    const { mbp, ubu, id } = await spawned(net);
    ubu.store.updateWorker(id, { checkpoint: "a NEWKIND-0123456789 token" });
    const r = await send(mbp.link, SUP_UBU, { op: "status", id });
    net.detector = (body) => (body.includes("NEWKIND-") ? "new_kind" : findSecret(body));
    await until(() => mbp.got.some((m) => m.in_reply_to === r.id));
    expect(JSON.parse(mbp.got.find((m) => m.in_reply_to === r.id)!.body)).toEqual({ event: "withheld", worker: id });
    expect(net.refused.map((x) => x.code)).toEqual(["secret_detected"]);
    expect(ubu.store.auditLog(30).find((a) => a.action === "remote:undeliverable")).toMatchObject({ detail: expect.stringContaining('"code":"secret_detected"') });
  });

  it("a v: 2 reply withheld still names its request, so the requester knows it was answered", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    ubu.link.failSend = (f) => (f.body.includes('"ok":false') ? "secret_detected" : null);
    const r = await send(mbp.link, SUP_UBU, { v: 2, op: "status", id: "w_1" });
    await until(() => mbp.got.length === 1);
    expect(mbp.got[0]!.in_reply_to).toBe(r.id);
    expect(JSON.parse(mbp.got[0]!.body)).toEqual({ v: 2, event: "withheld", re: "status", req: r.id });
  });
});

describe("the requester: deadlines and its record (criterion 5)", () => {
  async function pair() {
    const net = new FakeNetwork();
    const ubu = await scripted(net, "ubu1");
    const mbp = await boot(net, "mbp-1", "ubu1");
    return { net, ubu, mbp };
  }
  const watch = (p: Promise<RemoteOutcome>) => {
    const w: { done: RemoteOutcome | null; p: Promise<RemoteOutcome> } = { done: null, p };
    void p.then((o) => (w.done = o));
    return w;
  };
  const SPAWN = { v: 2, op: "spawn", project: "studio", role: "ann", task: "one fix", by: "poe" } as const;

  it("sends with ttl_seconds 30 for a spawn and 20 for the rest, its remote_sent row written before the send", async () => {
    const { net, ubu, mbp } = await pair();
    const status = watch(mbp.sup.remoteRequest(SUP_UBU, { v: 2, op: "status", id: "w_1" }));
    const spawn = watch(mbp.sup.remoteRequest(SUP_UBU, SPAWN));
    await until(() => ubu.got.length === 2);
    expect(ubu.got.map((m) => [JSON.parse(m.body).op, ttlOf(m)])).toEqual([
      ["status", 20],
      ["spawn", 30],
    ]);
    for (const m of ubu.got) expect(mbp.store.remoteSentByMessage(m.id)).toMatchObject({ to_name: SUP_UBU, body: m.body, state: "sent" });
    expect(mbp.store.remoteSentByMessage(ubu.got[0]!.id)!.target).toBe("w_1");
    for (const m of ubu.got) await send(ubu.link, SUP_MBP, { v: 2, re: JSON.parse(m.body).op, req: m.id, ok: true }, { in_reply_to: m.id });
    await status.p;
    await spawn.p;
    expect(net.log.filter((m) => m.from === SUP_MBP)).toHaveLength(2);

    // Written first: the row is there, sending, when the broker is asked; a send that fails marks it.
    let atSend: unknown[] = [];
    mbp.link.failSend = (f) => {
      atSend = mbp.store.remoteSentList().filter((r) => r.body === f.body);
      return "timeout";
    };
    await expect(mbp.sup.remoteRequest(SUP_UBU, { v: 2, op: "list" })).rejects.toThrow(/could not send list to supervisor@ubu1/);
    expect(atSend).toMatchObject([{ op: "list", state: "sending", message_id: null }]);
    expect(mbp.store.remoteSentList().at(-1)).toMatchObject({ op: "list", state: "failed" });
  });

  it("matches a reply on req and its sender, never on the envelope", async () => {
    const { net, ubu, mbp } = await pair();
    const other = await scripted(net, "ubu2");
    const w = watch(mbp.sup.remoteRequest(SUP_UBU, { v: 2, op: "status", id: "w_1" }));
    await until(() => ubu.got.length === 1);
    const req = ubu.got[0]!.id;
    // The envelope says it answers, but req names another request: not this one's reply.
    await send(ubu.link, SUP_MBP, { v: 2, re: "status", req: "m_other", ok: true }, { in_reply_to: req });
    // The right req, from a supervisor it wasn't sent to.
    await send(other.link, SUP_MBP, { v: 2, re: "status", req, ok: true, worker: { id: "w_1" } });
    await tick(30);
    expect(w.done).toBeNull();
    // The right req, without in_reply_to (as resent after a sweep).
    await send(ubu.link, SUP_MBP, { v: 2, re: "status", req, ok: true, worker: { id: "w_1", state: "running" } });
    expect(await w.p).toMatchObject({ outcome: "reply", reply: { re: "status", req, ok: true, worker: { id: "w_1" } } });
    expect(mbp.store.remoteSentByMessage(req)).toMatchObject({ state: "replied" });
    // Nothing went back: a reply is never answered.
    expect(net.log.filter((m) => m.from === SUP_MBP)).toHaveLength(1);
  });

  it("takes a withheld event that names its request as its reply", async () => {
    const { ubu, mbp } = await pair();
    const w = watch(mbp.sup.remoteRequest(SUP_UBU, { v: 2, op: "status", id: "w_1" }));
    await until(() => ubu.got.length === 1);
    await send(ubu.link, SUP_MBP, { v: 2, event: "withheld", re: "status", req: ubu.got[0]!.id }, { in_reply_to: ubu.got[0]!.id });
    expect(await w.p).toMatchObject({ outcome: "reply", reply: { event: "withheld" } });
  });

  it("waits 90 s for a spawn, then lists by the spawn's message id and reports the worker it made", async () => {
    const { net, ubu, mbp } = await pair();
    const w = watch(mbp.sup.remoteRequest(SUP_UBU, SPAWN));
    await until(() => ubu.got.length === 1);
    net.advance(89);
    await tick(30);
    expect(w.done).toBeNull();
    expect(ubu.got).toHaveLength(1);
    net.advance(1);
    await until(() => ubu.got.length === 2);
    const spawnId = ubu.got[0]!.id;
    expect(JSON.parse(ubu.got[1]!.body)).toEqual({ v: 2, op: "list", reqs: [spawnId] });
    expect(ttlOf(ubu.got[1]!)).toBe(20);
    expect(mbp.store.remoteSentByMessage(spawnId)).toMatchObject({ state: "unanswered" });
    await send(ubu.link, SUP_MBP, { v: 2, re: "list", req: ubu.got[1]!.id, ok: true, workers: [{ id: "w_9", state: "running" }] }, { in_reply_to: ubu.got[1]!.id });
    expect(await w.p).toMatchObject({ outcome: "found", worker: { id: "w_9", state: "running" } });
  });

  it("waits the ttl and 30 s for the rest, then lists by the worker's id", async () => {
    const { net, ubu, mbp } = await pair();
    const w = watch(mbp.sup.remoteRequest(SUP_UBU, { v: 2, op: "stop", id: "w_3" }));
    await until(() => ubu.got.length === 1);
    net.advance(49);
    await tick(30);
    expect(ubu.got).toHaveLength(1);
    net.advance(1);
    await until(() => ubu.got.length === 2);
    expect(JSON.parse(ubu.got[1]!.body)).toEqual({ v: 2, op: "list", ids: ["w_3"] });
    await send(ubu.link, SUP_MBP, { v: 2, re: "list", req: ubu.got[1]!.id, ok: true, workers: [{ id: "w_3", state: "stopped" }] });
    expect(await w.p).toMatchObject({ outcome: "found", worker: { id: "w_3", state: "stopped" } });
  });

  it("says it may or may not have run when list finds nothing or isn't answered; a late reply still counts", async () => {
    const { net, ubu, mbp } = await pair();
    const spawn = watch(mbp.sup.remoteRequest(SUP_UBU, SPAWN));
    await until(() => ubu.got.length === 1);
    net.advance(90);
    await until(() => ubu.got.length === 2);
    await send(ubu.link, SUP_MBP, { v: 2, re: "list", req: ubu.got[1]!.id, ok: true, workers: [] });
    expect(await spawn.p).toMatchObject({ outcome: "unknown", error: "no reply from supervisor@ubu1 within 90 s: the spawn may or may not have run" });

    const status = watch(mbp.sup.remoteRequest(SUP_UBU, { v: 2, op: "status", id: "w_1" }));
    await until(() => ubu.got.length === 3);
    net.advance(50);
    await until(() => ubu.got.length === 4);
    net.advance(50);
    expect(await status.p).toMatchObject({ outcome: "unknown", error: expect.stringMatching(/within 50 s: the status may or may not have run$/) });

    // The spawn's reply, late: it is kept on the record, the outcome of what was sent.
    const spawnId = ubu.got[0]!.id;
    await send(ubu.link, SUP_MBP, { v: 2, re: "spawn", req: spawnId, ok: true, worker: { id: "w_late" } }, { in_reply_to: spawnId });
    await until(() => mbp.store.remoteSentByMessage(spawnId)!.state === "replied");
    expect(JSON.parse(mbp.store.remoteSentByMessage(spawnId)!.reply!)).toMatchObject({ worker: { id: "w_late" } });
    expect(net.log.filter((m) => m.from === SUP_MBP)).toHaveLength(4);
  });

  it("keeps a reply that comes after the requester restarted", async () => {
    const net = new FakeNetwork();
    const ubu = await scripted(net, "ubu1");
    const at = newStore();
    const first = await boot(net, "mbp-1", "ubu1", at);
    void first.sup.remoteRequest(SUP_UBU, SPAWN);
    await until(() => ubu.got.length === 1);
    net.disconnect("mbp-1");
    await first.sup.shutdown();
    running = running.filter((s) => s !== first.sup);
    const req = ubu.got[0]!.id;
    // Queued at the broker while the requester is down.
    const sent = await send(ubu.link, SUP_MBP, { v: 2, re: "spawn", req, ok: true, worker: { id: "w_7" } }, { in_reply_to: req });
    expect(sent).toMatchObject({ delivered_to: [], queued_for: [SUP_MBP] });

    first.link.connected = true;
    const again = await boot(net, "mbp-1", "ubu1", at);
    await until(() => again.store.remoteSentByMessage(req)?.state === "replied");
    expect(JSON.parse(again.store.remoteSentByMessage(req)!.reply!)).toMatchObject({ worker: { id: "w_7" } });
  });
});

describe("the target: a request handled once (criterion 6)", () => {
  /** works/kim's spawn joins a board session; the join waits until the test lets it go. */
  function slowJoin(link: FakeLink): { joining: () => boolean; release: () => void } {
    let release = () => {};
    let joining = false;
    const gate = new Promise<void>((r) => (release = r));
    const original = link.boardOp.bind(link);
    link.boardOp = (async (as: string, op: Parameters<FakeLink["boardOp"]>[1], ctx?: Parameters<FakeLink["boardOp"]>[2]) => {
      if (op.op === "session_join") {
        joining = true;
        await gate;
      }
      return original(as, op, ctx);
    }) as FakeLink["boardOp"];
    return { joining: () => joining, release: () => release() };
  }
  const SLOW_SPAWN = { op: "spawn", project: "works", role: "kim", task: "build it", tasks: ["WRK-1"], session: { feature: "WRK-1", kind: "build" } };
  const deliveries = (link: FakeLink, id: string) => link.pushes.filter((f) => f.t === "deliver" && f.msg.id === id).length;

  it("acks and ignores a redelivery while the spawn is in progress; the first run's reply is the only one", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    const join = slowJoin(ubu.link);
    const req = await send(mbp.link, SUP_UBU, SLOW_SPAWN);
    await until(() => join.joining());
    expect(ubu.store.remoteRequest(req.id)).toMatchObject({ op: "spawn", reply: null });

    // The socket drops and comes back mid-spawn: the broker delivers the unacked request again.
    net.disconnect("ubu1");
    await net.reconnect("ubu1");
    await until(() => deliveries(ubu.link, req.id) === 2);
    await tick(20);
    // Acked: a third connect doesn't bring it back.
    net.disconnect("ubu1");
    await net.reconnect("ubu1");
    await tick(20);
    expect(deliveries(ubu.link, req.id)).toBe(2);

    join.release();
    await until(() => mbp.got.some((m) => m.in_reply_to === req.id));
    await tick(30);
    const replies = mbp.got.filter((m) => m.in_reply_to === req.id);
    expect(replies).toHaveLength(1);
    expect(JSON.parse(replies[0]!.body)).toMatchObject({ ok: true, op: "spawn", worker: { project: "works", role: "kim" } });
    expect(ubu.store.workers({ project: "works" })).toHaveLength(1);
    expect(ubu.sessions).toHaveLength(1);

    // Delivered again once done, it gets the same reply, and nothing is spawned.
    const msg = net.log.find((m) => m.id === req.id)!;
    ubu.sup.onPush({ t: "deliver", to: SUP_UBU, wake: true, msg } as never);
    await until(() => mbp.got.filter((m) => m.in_reply_to === req.id).length === 2);
    expect(mbp.got.filter((m) => m.in_reply_to === req.id).map((m) => m.body)).toEqual([replies[0]!.body, replies[0]!.body]);
    expect(ubu.store.workers({ project: "works" })).toHaveLength(1);
  });

  it("at start, answers a request it was handling when it stopped: list shows whether it ran", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const at = newStore();
    const first = await boot(net, "ubu1", "mbp-1", at);
    slowJoin(first.link);
    const req = await send(mbp.link, SUP_UBU, SLOW_SPAWN);
    await until(() => at.store.remoteRequest(req.id) !== null);
    // The target dies mid-spawn.
    net.disconnect("ubu1");
    await first.sup.shutdown();
    running = running.filter((s) => s !== first.sup);

    first.link.connected = true;
    const again = await boot(net, "ubu1", "mbp-1", at);
    await until(() => mbp.got.some((m) => m.in_reply_to === req.id));
    const restarted = JSON.stringify({ ok: false, op: "spawn", error: "the target restarted while handling it; list shows whether it ran" });
    expect(mbp.got.filter((m) => m.in_reply_to === req.id).map((m) => m.body)[0]).toBe(restarted);
    expect(again.store.remoteRequest(req.id)!.reply).toBe(restarted);
    expect(again.store.auditLog(20).find((a) => a.action === "remote:restarted")).toMatchObject({ actor: SUP_MBP });
  });

  it("at start, a v: 2 request in progress gets a v: 2 reply naming it", async () => {
    // Recorded as start finds it: the target stopped mid-spawn.
    const at = newStore();
    at.store.beginRemote("m_v2", SUP_MBP, "spawn", 2);
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    await boot(net, "ubu1", "mbp-1", at);
    await until(() => mbp.got.length === 1);
    // Its request isn't on this network (as if swept): the reply went again without in_reply_to.
    expect(mbp.got[0]!.in_reply_to).toBeNull();
    expect(JSON.parse(mbp.got[0]!.body)).toEqual({ v: 2, re: "spawn", req: "m_v2", ok: false, error: "the target restarted while handling it; list shows whether it ran" });
  });
});

describe("replies and events expire in a day (criterion 7)", () => {
  it("sends both with ttl_seconds 86400", async () => {
    const net = new FakeNetwork();
    const mbp = await scripted(net, "mbp-1");
    const ubu = await boot(net, "ubu1", "mbp-1");
    const frames: Array<{ body: string; ttl: number | undefined }> = [];
    ubu.link.failSend = (f) => {
      frames.push({ body: f.body, ttl: f.ttl_seconds });
      return null;
    };
    const v2 = await send(mbp.link, SUP_UBU, { v: 2, op: "list" });
    await send(mbp.link, SUP_UBU, { op: "spawn", project: "studio", role: "ann", task: "one fix" });
    await until(() => mbp.got.some((m) => m.body.includes('"event":"remote_control"')));
    await until(() => mbp.got.length === 3);
    expect(frames.map((f) => f.ttl)).toEqual([86_400, 86_400, 86_400]);
    for (const m of mbp.got) expect(ttlOf(m)).toBe(86_400);
    expect(mbp.got.find((m) => m.in_reply_to === v2.id)).toBeDefined();
  });
});
