import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { spawnDaemon, type SpawnedDaemon } from "../fixtures/daemon-helper.ts";
import { connectClient } from "../fixtures/test-link.ts";
import { Method } from "../../src/shared/protocol.ts";

describe("two clients full lifecycle", () => {
  let daemon: SpawnedDaemon;

  after(async () => {
    await daemon?.stop();
  });

  it("registers two peers and exchanges messages", async () => {
    daemon = await spawnDaemon({ idleShutdownMs: 60_000, heartbeatIntervalMs: 60_000 });

    const a = await connectClient(daemon.socketPath);
    const b = await connectClient(daemon.socketPath);

    // alpha registers first
    const reg1 = await a.link.call(Method.Register, {
      name: "alpha",
      cwd: "/code/widgets/api",
      purpose: "doing things",
      expertise: ["ts"],
    });
    assert.equal(reg1.name, "alpha");
    // alpha shouldn't see its own peer_joined
    assert.equal(a.events.length, 0);

    // beta registers — alpha should see peer_joined including cwd
    const reg2 = await b.link.call(Method.Register, {
      name: "beta",
      cwd: "/code/frontend",
    });
    assert.equal(reg2.name, "beta");
    const joined = await a.waitFor((e) => e.event_type === "peer_joined");
    assert.equal(joined.event_type, "peer_joined");
    if (joined.event_type === "peer_joined") {
      assert.equal(joined.peer.name, "beta");
      assert.equal(joined.peer.cwd, "/code/frontend");
    }
    // beta shouldn't see its own peer_joined
    assert.equal(b.events.filter((e) => e.event_type === "peer_joined").length, 0);

    // list_peers from alpha should show beta
    const peers = await a.link.call(Method.ListPeers, {});
    assert.equal(peers.peers.length, 1);
    assert.equal(peers.peers[0]!.name, "beta");

    // alpha sends to beta
    a.drainEvents();
    b.drainEvents();
    const sendResult = await a.link.call(Method.SendMessage, {
      to: "beta",
      body: "hello beta",
    });
    assert.equal(sendResult.delivered, true);
    const msg = await b.waitFor((e) => e.event_type === "message");
    if (msg.event_type === "message") {
      assert.equal(msg.from, "alpha");
      assert.equal(msg.body, "hello beta");
      assert.equal(msg.message_id, sendResult.message_id);
    }

    // beta replies
    if (msg.event_type !== "message") throw new Error("expected message");
    a.drainEvents();
    const reply = await b.link.call(Method.SendMessage, {
      to: "alpha",
      body: "hi alpha",
      in_reply_to: msg.message_id,
    });
    assert.equal(reply.delivered, true);
    const replyMsg = await a.waitFor((e) => e.event_type === "message");
    if (replyMsg.event_type === "message") {
      assert.equal(replyMsg.from, "beta");
      assert.equal(replyMsg.in_reply_to, msg.message_id);
    }

    // alpha broadcasts
    a.drainEvents();
    b.drainEvents();
    const bc = await a.link.call(Method.Broadcast, { body: "heads up everyone" });
    assert.deepEqual(bc.recipients, ["beta"]);
    const bcEvt = await b.waitFor((e) => e.event_type === "broadcast");
    if (bcEvt.event_type === "broadcast") {
      assert.equal(bcEvt.body, "heads up everyone");
      assert.equal(bcEvt.from, "alpha");
    }

    // beta updates status — alpha sees status_changed
    a.drainEvents();
    await b.link.call(Method.UpdateStatus, { status: "busy" });
    const sc = await a.waitFor((e) => e.event_type === "status_changed");
    if (sc.event_type === "status_changed") {
      assert.equal(sc.name, "beta");
      assert.equal(sc.status, "busy");
    }

    // beta deregisters — alpha sees peer_left
    a.drainEvents();
    await b.link.call(Method.Deregister, {});
    const left = await a.waitFor((e) => e.event_type === "peer_left");
    if (left.event_type === "peer_left") {
      assert.equal(left.name, "beta");
      assert.equal(left.reason, "deregistered");
    }

    a.link.close();
    b.link.close();
  });
});
