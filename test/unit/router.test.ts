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

  it("broadcast goes to everyone except sender", () => {
    const { router, a, b } = setupTwo();
    const result = router.broadcast("connA", { body: "all hands" });
    assert.deepEqual(result.recipients, ["beta"]);
    assert.equal(a.sent.length, 0);
    assert.equal(b.sent.length, 1);
    const params = b.sent[0]!.params as { event_type: string; body: string };
    assert.equal(params.event_type, "broadcast");
    assert.equal(params.body, "all hands");
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
});
