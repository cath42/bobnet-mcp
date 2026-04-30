import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { spawnDaemon, type SpawnedDaemon } from "../fixtures/daemon-helper.ts";
import { connectClient } from "../fixtures/test-link.ts";
import { Method } from "../../src/shared/protocol.ts";
import { DaemonLinkError } from "../../src/client/daemon-link.ts";
import { ErrorCode } from "../../src/shared/errors.ts";

describe("offline / error scenarios", () => {
  let daemon: SpawnedDaemon;

  after(async () => {
    await daemon?.stop();
  });

  it("send to unknown peer returns delivered:false with error", async () => {
    daemon = await spawnDaemon({ idleShutdownMs: 60_000, heartbeatIntervalMs: 60_000 });
    const a = await connectClient(daemon.socketPath);
    await a.link.call(Method.Register, { name: "alpha" });

    const result = await a.link.call(Method.SendMessage, {
      to: "ghost",
      body: "hi",
    });
    assert.equal(result.delivered, false);
    assert.match(result.error ?? "", /no peer named 'ghost'/);
    assert.ok(result.message_id.length > 0);
    a.link.close();
  });

  it("duplicate name registration returns name_in_use error", async () => {
    const a = await connectClient(daemon.socketPath);
    const b = await connectClient(daemon.socketPath);
    await a.link.call(Method.Register, { name: "duplicate" });
    await assert.rejects(
      b.link.call(Method.Register, { name: "duplicate" }),
      (err: unknown) =>
        err instanceof DaemonLinkError && err.code === ErrorCode.NameInUse,
    );
    a.link.close();
    b.link.close();
  });

  it("invalid name is rejected", async () => {
    const c = await connectClient(daemon.socketPath);
    await assert.rejects(
      c.link.call(Method.Register, { name: "_starts-with-underscore" }),
      (err: unknown) =>
        err instanceof DaemonLinkError && err.code === ErrorCode.InvalidName,
    );
    c.link.close();
  });

  it("calling register-required method before handshake fails", async () => {
    // Skip — handshake is automatic in connectClient. We test pre-handshake
    // refusal in a separate test to avoid duplicating the handshake helper.
  });
});
