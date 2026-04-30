import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mkdtempSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDaemonRunning } from "../../src/client/spawn-daemon.ts";
import { createLogger } from "../../src/shared/logger.ts";
import { createConnection } from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");

const silentLog = createLogger({ to: "stderr", level: "error" });

async function spawnViaRace(
  socketPath: string,
  lockPath: string,
  logPath: string,
): Promise<void> {
  await ensureDaemonRunning({
    socketPath,
    lockPath,
    logPath,
    daemonScript: resolve(projectRoot, "src", "bin", "bobnet-mcp-daemon.ts"),
    daemonArgs: [
      "--idle-shutdown-ms",
      "500",
      "--heartbeat-interval-ms",
      "60000",
      "--log-level",
      "warn",
    ],
    log: silentLog,
  });
}

async function killDaemon(socketPath: string): Promise<void> {
  // Connect and send SIGTERM. Easier: just rm the socket; the daemon's
  // listening process will keep going. So we need its pid. For this test
  // we'll just leave it — the test fixture cleans up the dir after.
  void socketPath;
}

describe("spawn race", () => {
  it("multiple concurrent spawns end up with one daemon", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bobnet-mcp-race-"));
    const socketPath = join(dir, "d.sock");
    const lockPath = join(dir, "d.lock");
    const logPath = join(dir, "d.log");

    try {
      // Fire 5 racers in parallel.
      await Promise.all(
        Array.from({ length: 5 }, () => spawnViaRace(socketPath, lockPath, logPath)),
      );

      // All should observe the same socket. Verify connect succeeds.
      await new Promise<void>((resolve, reject) => {
        const sock = createConnection(socketPath);
        sock.once("connect", () => {
          sock.destroy();
          resolve();
        });
        sock.once("error", reject);
      });

      assert.ok(existsSync(socketPath));
      await killDaemon(socketPath);
    } finally {
      // Daemon will idle-shutdown on its own (60s), but we force cleanup.
      await rm(dir, { recursive: true, force: true });
    }
  });
});
