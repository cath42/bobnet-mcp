import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, openSync, closeSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createConnection } from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");

export interface SpawnedDaemon {
  socketPath: string;
  logPath: string;
  proc: ChildProcess;
  dir: string;
  stop: () => Promise<void>;
}

async function tryConnect(path: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sock = createConnection(path);
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

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

export async function spawnDaemon(
  opts: { idleShutdownMs?: number; heartbeatIntervalMs?: number; heartbeatDeadlineMs?: number } = {},
): Promise<SpawnedDaemon> {
  const dir = mkdtempSync(join(tmpdir(), "bobnet-mcp-test-"));
  const socketPath = join(dir, "d.sock");
  const logPath = join(dir, "d.log");
  const daemonScript = resolve(projectRoot, "src", "bin", "bobnet-mcp-daemon.ts");

  const args = [
    "--import",
    "tsx",
    daemonScript,
    "--socket-path",
    socketPath,
    "--log-path",
    logPath,
    "--log-level",
    "debug",
  ];
  if (opts.idleShutdownMs !== undefined) {
    args.push("--idle-shutdown-ms", String(opts.idleShutdownMs));
  }
  if (opts.heartbeatIntervalMs !== undefined) {
    args.push("--heartbeat-interval-ms", String(opts.heartbeatIntervalMs));
  }
  if (opts.heartbeatDeadlineMs !== undefined) {
    args.push("--heartbeat-deadline-ms", String(opts.heartbeatDeadlineMs));
  }

  const logFd = openSync(logPath, "a");
  const proc = spawn(process.execPath, args, {
    detached: false,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  closeSync(logFd);

  const ready = await waitFor(() => tryConnect(socketPath, 200), 5000);
  if (!ready) {
    proc.kill("SIGKILL");
    throw new Error(`daemon failed to start; see ${logPath}`);
  }

  return {
    socketPath,
    logPath,
    proc,
    dir,
    async stop() {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGTERM");
        await new Promise<void>((r) => {
          const t = setTimeout(() => {
            proc.kill("SIGKILL");
            r();
          }, 1500);
          proc.once("exit", () => {
            clearTimeout(t);
            r();
          });
        });
      }
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
