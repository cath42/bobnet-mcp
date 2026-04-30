import { spawn } from "node:child_process";
import { openSync, closeSync, existsSync, unlinkSync } from "node:fs";
import { createConnection } from "node:net";
import lockfile from "proper-lockfile";
import type { Logger } from "../shared/logger.js";

export interface SpawnDaemonOptions {
  socketPath: string;
  lockPath: string;
  logPath: string;
  daemonScript: string;
  daemonArgs?: string[];
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  lockWaitMs?: number;
  log: Logger;
}

async function tryConnect(socketPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sock = createConnection(socketPath);
    let resolved = false;
    const done = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs).unref();
  });
}

function ensureLockfileExists(path: string): void {
  if (!existsSync(path)) {
    const fd = openSync(path, "a");
    closeSync(fd);
  }
}

async function pollUntilConnect(
  socketPath: string,
  intervalMs: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryConnect(socketPath, intervalMs)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function ensureDaemonRunning(opts: SpawnDaemonOptions): Promise<void> {
  const {
    socketPath,
    lockPath,
    logPath,
    daemonScript,
    daemonArgs = [],
    pollIntervalMs = 25,
    pollTimeoutMs = 2000,
    lockWaitMs = 5000,
    log,
  } = opts;

  if (await tryConnect(socketPath, 200)) {
    log.debug("daemon already running");
    return;
  }

  ensureLockfileExists(lockPath);
  const release = await lockfile.lock(lockPath, {
    retries: { retries: Math.ceil(lockWaitMs / 100), minTimeout: 50, maxTimeout: 100 },
    stale: 10_000,
  });

  try {
    if (await tryConnect(socketPath, 200)) {
      log.debug("daemon spawned by another client during lock wait");
      return;
    }

    if (existsSync(socketPath)) {
      log.info("removing stale socket file before spawn", { path: socketPath });
      try {
        unlinkSync(socketPath);
      } catch (err) {
        log.warn("unlink stale socket failed", { err: (err as Error).message });
      }
    }

    const logFd = openSync(logPath, "a");
    log.info("spawning daemon", { script: daemonScript });
    const nodeArgs: string[] = [];
    if (daemonScript.endsWith(".ts")) {
      // Dev/test path: load tsx so Node can execute the TS source.
      nodeArgs.push("--import", "tsx");
    }
    const child = spawn(
      process.execPath,
      [
        ...nodeArgs,
        daemonScript,
        "--socket-path",
        socketPath,
        "--log-path",
        logPath,
        ...daemonArgs,
      ],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, BOBNET_DAEMON: "1" },
      },
    );
    child.unref();
    closeSync(logFd);

    const ready = await pollUntilConnect(socketPath, pollIntervalMs, pollTimeoutMs);
    if (!ready) {
      throw new Error(
        `daemon failed to bind socket within ${pollTimeoutMs}ms (see ${logPath})`,
      );
    }
    log.info("daemon spawn confirmed", { pid: child.pid ?? null });
  } finally {
    await release();
  }
}
