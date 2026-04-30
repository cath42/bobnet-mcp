import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Registry } from "../../src/daemon/registry.ts";
import { ErrorCode, RpcError } from "../../src/shared/errors.ts";

describe("Registry", () => {
  it("registers a peer and lists it", () => {
    const r = new Registry();
    const peer = r.register("conn1", { name: "alpha", purpose: "doing things" });
    assert.equal(peer.name, "alpha");
    assert.equal(r.size(), 1);
    assert.equal(r.byName("alpha")?.connection_id, "conn1");
    assert.equal(r.byConnection("conn1")?.name, "alpha");
  });

  it("stores cwd when provided", () => {
    const r = new Registry();
    const peer = r.register("conn1", {
      name: "Bob",
      cwd: "/tmp/foo",
      purpose: "exploring",
    });
    assert.equal(peer.cwd, "/tmp/foo");
    const pub = r.toPublicInfo(peer);
    assert.equal(pub.cwd, "/tmp/foo");
  });

  it("rejects non-string cwd", () => {
    const r = new Registry();
    assert.throws(
      () => r.register("conn1", { name: "Bob", cwd: 42 as unknown as string }),
      (err) => err instanceof RpcError && err.code === ErrorCode.InvalidParams,
    );
  });

  it("rejects duplicate names", () => {
    const r = new Registry();
    r.register("conn1", { name: "alpha" });
    assert.throws(
      () => r.register("conn2", { name: "alpha" }),
      (err) => err instanceof RpcError && err.code === ErrorCode.NameInUse,
    );
  });

  it("rejects invalid names", () => {
    const r = new Registry();
    assert.throws(
      () => r.register("c", { name: "_bad" }),
      (err) => err instanceof RpcError && err.code === ErrorCode.InvalidName,
    );
    assert.throws(
      () => r.register("c", { name: "" }),
      (err) => err instanceof RpcError && err.code === ErrorCode.InvalidName,
    );
  });

  it("rejects double-register on same connection", () => {
    const r = new Registry();
    r.register("conn1", { name: "alpha" });
    assert.throws(
      () => r.register("conn1", { name: "beta" }),
      (err) => err instanceof RpcError && err.code === ErrorCode.AlreadyRegistered,
    );
  });

  it("deregister removes peer and emits left event", () => {
    const r = new Registry();
    r.register("conn1", { name: "alpha" });
    const events: string[] = [];
    r.on((e) => events.push(e.kind));
    const removed = r.deregister("conn1");
    assert.equal(removed?.name, "alpha");
    assert.equal(r.size(), 0);
    assert.deepEqual(events, ["left"]);
  });

  it("deregister of unknown connection returns null", () => {
    const r = new Registry();
    assert.equal(r.deregister("nope"), null);
  });

  it("updateStatus sets status and emits status event", () => {
    const r = new Registry();
    r.register("conn1", { name: "alpha" });
    const events: string[] = [];
    r.on((e) => events.push(e.kind));
    const updated = r.updateStatus("conn1", "busy");
    assert.equal(updated.status, "busy");
    assert.deepEqual(events, ["status"]);
  });

  it("updateStatus throws if not registered", () => {
    const r = new Registry();
    assert.throws(
      () => r.updateStatus("nope", "busy"),
      (err) => err instanceof RpcError && err.code === ErrorCode.NotRegistered,
    );
  });

  it("rejects invalid expertise", () => {
    const r = new Registry();
    assert.throws(
      () => r.register("c", { name: "alpha", expertise: [42] as unknown as string[] }),
      (err) => err instanceof RpcError && err.code === ErrorCode.InvalidParams,
    );
  });

  it("toPublicInfo strips connection_id", () => {
    const r = new Registry();
    const peer = r.register("conn1", { name: "alpha" });
    const pub = r.toPublicInfo(peer);
    assert.equal((pub as { connection_id?: unknown }).connection_id, undefined);
    assert.equal(pub.name, "alpha");
  });

  it("emits joined event on register", () => {
    const r = new Registry();
    const events: string[] = [];
    r.on((e) => events.push(e.kind));
    r.register("conn1", { name: "alpha" });
    assert.deepEqual(events, ["joined"]);
  });
});
