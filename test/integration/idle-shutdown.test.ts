import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { spawnDaemon } from "../fixtures/daemon-helper.ts";
import { connectClient } from "../fixtures/test-link.ts";

describe("idle shutdown", () => {
  it("daemon exits and cleans up socket after idle timeout", async () => {
    const d = await spawnDaemon({
      idleShutdownMs: 250,
      heartbeatIntervalMs: 60_000,
    });

    // Connect, then immediately disconnect — idle timer arms.
    const a = await connectClient(d.socketPath);
    a.link.close();

    // Wait for daemon process to exit.
    const exited = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 4000);
      d.proc.once("exit", () => {
        clearTimeout(t);
        resolve(true);
      });
    });
    assert.equal(exited, true, "daemon did not exit within 4s of idle");

    assert.equal(
      existsSync(d.socketPath),
      false,
      "socket file should be removed on shutdown",
    );

    await d.stop();
  });
});
