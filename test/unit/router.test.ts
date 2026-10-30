import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Registry } from "../../src/daemon/registry.ts";
import { Router } from "../../src/daemon/router.ts";
import type { Connection, ConnectionManager } from "../../src/daemon/connection-manager.ts";

interface Notification {
  method: string;
  params: unknown;
}

class FakeConn {
  public sent: Notification[] = [];
  constructor(public readonly id: string) {}
  notify(method: string, params: unknown) {
    this.sent.push({ method, params });
  }
}

class FakeConnManager {
  private map = new Map<string, FakeConn>();
  add(c: FakeConn) {
    this.map.set(c.id, c);
  }
  get(id: string) {
    return this.map.get(id) as unknown as Connection | undefined;
  }
  size() {
    return this.map.size;
  }
  all() {
    return Array.from(this.map.values()) as unknown as Iterable<Connection>;
  }
  remove(id: string) {
    this.map.delete(id);
  }
  closeAll() {
    this.map.clear();
  }
  accept() {
    throw new Error("not used");
  }
}

function setupTwo() {
  const reg = new Registry();
  const mgr = new FakeConnManager();
  const a = new FakeConn("connA");
  const b = new FakeConn("connB");
  mgr.add(a);
  mgr.add(b);
  const router = new Router(reg, mgr as unknown as ConnectionManager);
  reg.register("connA", { name: "alpha", purpose: "A's purpose" });
  reg.register("connB", { name: "beta" });
  return { reg, mgr, a, b, router };
}

function setupTeam() {
  const reg = new Registry();
  const mgr = new FakeConnManager();
  const a = new FakeConn("connA");
  const b = new FakeConn("connB");
  const c = new FakeConn("connC");
  mgr.add(a);
  mgr.add(b);
  mgr.add(c);
  const router = new Router(reg, mgr as unknown as ConnectionManager);
  reg.register("connA", { name: "alpha", team: "frontend" });
  reg.register("connB", { name: "beta", team: "frontend" });
  reg.register("connC", { name: "gamma", team: "backend" });
  return { reg, mgr, a, b, c, router };
}

describe("Router", () => {
  it("send delivers message and returns delivered:true", () => {
    const { router, b } = setupTwo();
    const result = router.send("connA", { to: "beta", body: "hello" });
    assert.equal(result.delivered, true);
    assert.equal(b.sent.length, 1);
    assert.equal(b.sent[0]!.method, "channel/event");
    const params = b.sent[0]!.params as { event_type: string; from: string; body: string };
    assert.equal(params.event_type, "message");
    assert.equal(params.from, "alpha");
    assert.equal(params.body, "hello");
  });

  it("send to unknown peer returns delivered:false", () => {
    const { router } = setupTwo();
    const result = router.send("connA", { to: "ghost", body: "hi" });
    assert.equal(result.delivered, false);
    assert.match(result.error ?? "", /no peer named 'ghost'/);
  });

  it("send to self is rejected", () => {
    const { router } = setupTwo();
    const result = router.send("connA", { to: "alpha", body: "hi" });
    assert.equal(result.delivered, false);
    assert.match(result.error ?? "", /cannot send a message to yourself/);
  });

  it("broadcast with no teams goes to everyone except sender", () => {
    const { router, a, b } = setupTwo();
    const result = router.broadcast("connA", { body: "all hands", scope: "all" });
    assert.deepEqual(result.recipients, ["beta"]);
    assert.equal(a.sent.length, 0);
    assert.equal(b.sent.length, 1);
    const params = b.sent[0]!.params as { event_type: string; body: string; scope: string };
    assert.equal(params.event_type, "broadcast");
    assert.equal(params.body, "all hands");
    assert.equal(params.scope, "all");
  });

  it("emitPeerJoined notifies all others", () => {
    const { reg, router, mgr, a, b } = setupTwo();
    a.sent.length = 0;
    b.sent.length = 0;
    const c = new FakeConn("connC");
    (mgr as unknown as { add: (x: FakeConn) => void }).add(c);
    const peer = reg.register("connC", { name: "gamma" });
    router.emitPeerJoined(peer);
    assert.equal(a.sent.length, 1);
    assert.equal(b.sent.length, 1);
    assert.equal(c.sent.length, 0); // self excluded
    const p = a.sent[0]!.params as { event_type: string; peer: { name: string } };
    assert.equal(p.event_type, "peer_joined");
    assert.equal(p.peer.name, "gamma");
  });

  it("emitPeerLeft notifies all others", () => {
    const { reg, router, a, b } = setupTwo();
    const peer = reg.byName("alpha")!;
    a.sent.length = 0;
    b.sent.length = 0;
    router.emitPeerLeft(peer, "deregistered");
    assert.equal(a.sent.length, 0); // departing peer excluded
    assert.equal(b.sent.length, 1);
    const p = b.sent[0]!.params as { event_type: string; reason: string; name: string };
    assert.equal(p.event_type, "peer_left");
    assert.equal(p.reason, "deregistered");
    assert.equal(p.name, "alpha");
  });

  it("rejects empty body", () => {
    const { router } = setupTwo();
    assert.throws(() => router.send("connA", { to: "beta", body: "" }));
  });

  it("rejects non-string body", () => {
    const { router } = setupTwo();
    assert.throws(() => router.send("connA", { to: "beta", body: 42 }));
  });

  it("team broadcast only reaches team members", () => {
    const { router, a, b, c } = setupTeam();
    const result = router.broadcast("connA", { body: "frontend update" });
    assert.deepEqual(result.recipients, ["beta"]);
    assert.equal(a.sent.length, 0);
    assert.equal(b.sent.length, 1);
    assert.equal(c.sent.length, 0);
  });

  it("all-scope broadcast reaches everyone", () => {
    const { router, a, b, c } = setupTeam();
    const result = router.broadcast("connA", { body: "global", scope: "all" });
    assert.deepEqual(result.recipients, ["beta", "gamma"]);
    assert.equal(a.sent.length, 0);
    assert.equal(b.sent.length, 1);
    assert.equal(c.sent.length, 1);
  });

  it("cross-team send_message includes warning", () => {
    const { router, c } = setupTeam();
    const result = router.send("connA", { to: "gamma", body: "hey" });
    assert.equal(result.delivered, true);
    assert.ok(result.cross_team_warning);
    assert.match(result.cross_team_warning!, /not on your team/);
    assert.equal(c.sent.length, 1);
    const params = c.sent[0]!.params as { cross_team?: boolean };
    assert.equal(params.cross_team, true);
  });

  it("same-team send_message has no warning", () => {
    const { router } = setupTeam();
    const result = router.send("connA", { to: "beta", body: "hey" });
    assert.equal(result.delivered, true);
    assert.equal(result.cross_team_warning, undefined);
  });

  it("emitPeerJoined scoped to team", () => {
    const { reg, router, mgr, a, b, c } = setupTeam();
    a.sent.length = 0;
    b.sent.length = 0;
    c.sent.length = 0;
    const d = new FakeConn("connD");
    (mgr as unknown as { add: (x: FakeConn) => void }).add(d);
    const peer = reg.register("connD", { name: "delta", team: "frontend" });
    router.emitPeerJoined(peer);
    assert.equal(a.sent.length, 1);
    assert.equal(b.sent.length, 1);
    assert.equal(c.sent.length, 0);
    assert.equal(d.sent.length, 0);
  });

  it("emitStatusChanged scoped to team", () => {
    const { reg, router, a, b, c } = setupTeam();
    a.sent.length = 0;
    b.sent.length = 0;
    c.sent.length = 0;
    reg.updateStatus("connA", "busy");
    const peer = reg.byConnection("connA")!;
    router.emitStatusChanged(peer);
    assert.equal(a.sent.length, 0);
    assert.equal(b.sent.length, 1);
    assert.equal(c.sent.length, 0);
  });

  it("sendMulti delivers one message_id to each recipient with cc", () => {
    const { router, a, b, c } = setupTeam();
    const result = router.sendMulti("connA", { to: ["beta", "gamma"], body: "sync?" });
    assert.equal(result.delivered, true);
    assert.deepEqual(result.results, [
      { to: "beta", delivered: true },
      { to: "gamma", delivered: true },
    ]);
    assert.equal(a.sent.length, 0);
    const toB = b.sent[0]!.params as { message_id: string; cc?: string[]; cross_team?: boolean };
    const toC = c.sent[0]!.params as { message_id: string; cc?: string[]; cross_team?: boolean };
    assert.equal(toB.message_id, result.message_id);
    assert.equal(toC.message_id, result.message_id);
    assert.deepEqual(toB.cc, ["gamma"]);
    assert.deepEqual(toC.cc, ["beta"]);
    assert.equal(toB.cross_team, undefined);
    assert.equal(toC.cross_team, true);
    assert.match(result.cross_team_warning ?? "", /'gamma' is not on your team/);
  });

  it("sendMulti dedupes names and reports per-recipient failures", () => {
    const { router, b } = setupTwo();
    const result = router.sendMulti("connA", {
      to: ["beta", "beta", "ghost", "alpha"],
      body: "hi",
    });
    assert.equal(result.delivered, false);
    assert.equal(b.sent.length, 1);
    assert.deepEqual(
      result.results.map((r) => [r.to, r.delivered]),
      [["beta", true], ["ghost", false], ["alpha", false]],
    );
    assert.match(result.results[1]!.error ?? "", /no peer named 'ghost'/);
    assert.match(result.results[2]!.error ?? "", /yourself/);
    // cc never lists the sender back to the recipient
    assert.deepEqual((b.sent[0]!.params as { cc?: string[] }).cc, ["ghost"]);
  });

  it("sendMulti rejects empty and oversized lists", () => {
    const { router } = setupTwo();
    assert.throws(() => router.sendMulti("connA", { to: [], body: "x" }), /must not be empty/);
    const many = Array.from({ length: 33 }, (_, i) => `p${i}`);
    assert.throws(() => router.sendMulti("connA", { to: many, body: "x" }), /use broadcast/);
  });

  it("broadcast carries urgent only when set", () => {
    const { router, b } = setupTwo();
    router.broadcast("connA", { body: "fyi" });
    router.broadcast("connA", { body: "HOLD", urgent: true });
    const [plain, urgent] = b.sent.map((n) => n.params as { urgent?: boolean });
    assert.equal(plain!.urgent, undefined);
    assert.equal(urgent!.urgent, true);
    assert.throws(() => router.broadcast("connA", { body: "x", urgent: "yes" }), /boolean/);
  });
});
