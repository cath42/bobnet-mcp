import { existsSync, unlinkSync } from "node:fs";
import { chmod, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { parseArgs } from "node:util";
import { assertSunPath, logPath, socketPath } from "../shared/paths.js";
import { createLogger, type Logger } from "../shared/logger.js";
import { ErrorCode, RpcError } from "../shared/errors.js";
import { nowIso } from "../shared/time.js";
import { Method } from "../shared/protocol.js";
import {
  Connection,
  ConnectionManager,
  type IncomingNotification,
  type IncomingRequest,
  rpcErrorFromUnknown,
} from "./connection-manager.js";
import { handlers, type DaemonContext } from "./handlers.js";
import { HeartbeatMonitor } from "./heartbeat.js";
import { Lifecycle } from "./lifecycle.js";
import { Registry } from "./registry.js";
import { Router } from "./router.js";

interface DaemonArgs {
  socketPath: string;
  logPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  idleShutdownMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatDeadlineMs?: number;
}

function parseDaemonArgs(argv: string[]): DaemonArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "socket-path": { type: "string" },
      "log-path": { type: "string" },
      "log-level": { type: "string" },
      "idle-shutdown-ms": { type: "string" },
      "heartbeat-interval-ms": { type: "string" },
      "heartbeat-deadline-ms": { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });
  const lvl = (values["log-level"] as string | undefined) ?? "info";
  if (lvl !== "debug" && lvl !== "info" && lvl !== "warn" && lvl !== "error") {
    throw new Error(`invalid --log-level: ${lvl}`);
  }
  const args: DaemonArgs = {
    socketPath: (values["socket-path"] as string | undefined) ?? socketPath(),
    logPath: (values["log-path"] as string | undefined) ?? logPath(),
    logLevel: lvl,
  };
  const idle = values["idle-shutdown-ms"] as string | undefined;
  if (idle !== undefined) args.idleShutdownMs = Number(idle);
  const hi = values["heartbeat-interval-ms"] as string | undefined;
  if (hi !== undefined) args.heartbeatIntervalMs = Number(hi);
  const hd = values["heartbeat-deadline-ms"] as string | undefined;
  if (hd !== undefined) args.heartbeatDeadlineMs = Number(hd);
  return args;
}

async function isStaleSocket(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  return await new Promise<boolean>((resolve) => {
    const probe = createConnection(path);
    let resolved = false;
    const done = (stale: boolean) => {
      if (resolved) return;
      resolved = true;
      probe.destroy();
      resolve(stale);
    };
    probe.once("connect", () => done(false));
    probe.once("error", () => done(true));
    setTimeout(() => done(true), 250).unref();
  });
}

export async function runDaemon(rawArgs: string[]): Promise<void> {
  const args = parseDaemonArgs(rawArgs);
  assertSunPath(args.socketPath);

  const log = createLogger({
    to: { file: args.logPath },
    level: args.logLevel,
    base: { component: "daemon", pid: process.pid },
  });

  log.info("daemon starting", {
    socket_path: args.socketPath,
    log_path: args.logPath,
  });

  if (await isStaleSocket(args.socketPath)) {
    log.info("removing stale socket file", { path: args.socketPath });
    try {
      unlinkSync(args.socketPath);
    } catch (err) {
      log.warn("failed to unlink stale socket", { err: (err as Error).message });
    }
  }

  const daemonStartedAt = nowIso();
  const registry = new Registry();
  const conns = new ConnectionManager(log);
  const router = new Router(registry, conns);
  const ctx: DaemonContext = { registry, router, daemonStartedAt };

  const heartbeat = new HeartbeatMonitor(
    conns,
    (connId) => {
      const peer = registry.byConnection(connId);
      if (peer) {
        registry.deregister(connId);
        router.emitPeerLeft(peer, "crashed");
      }
    },
    log,
    {
      ...(args.heartbeatIntervalMs !== undefined
        ? { intervalMs: args.heartbeatIntervalMs }
        : {}),
      ...(args.heartbeatDeadlineMs !== undefined
        ? { deadlineMs: args.heartbeatDeadlineMs }
        : {}),
    },
  );

  let server: Server | null = null;
  const lifecycle = new Lifecycle(log, {
    ...(args.idleShutdownMs !== undefined
      ? { idleShutdownMs: args.idleShutdownMs }
      : {}),
    onShutdown: async () => {
      heartbeat.stop();
      // Notify connected peers we're going down (best-effort).
      for (const peer of registry.list()) {
        router.emitPeerLeft(peer, "daemon_shutdown");
      }
      conns.closeAll("daemon_shutdown");
      if (server) {
        await new Promise<void>((res) => server!.close(() => res()));
      }
      try {
        await unlink(args.socketPath);
      } catch {
        /* already gone */
      }
      log.close();
    },
  });

  server = createServer((socket) => {
    lifecycle.noteConnect();
    conns.accept(socket, {
      onRequest: async (conn, req) => onRequest(ctx, log, conn, req),
      onNotification: async (conn, note) => onNotification(log, conn, note),
      onClose: (conn) => {
        const peer = registry.byConnection(conn.id);
        if (peer) {
          registry.deregister(conn.id);
          router.emitPeerLeft(peer, "disconnected");
        }
        conns.remove(conn.id);
        lifecycle.noteDisconnect();
      },
    });
  });

  server.on("error", (err) => {
    log.error("server error", { err: err.message });
  });

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(args.socketPath, () => {
      server!.removeListener("error", reject);
      resolve();
    });
  });

  await chmod(args.socketPath, 0o600);
  heartbeat.start();
  lifecycle.start();
  log.info("daemon listening", { socket_path: args.socketPath });

  const shutdown = async (sig: string) => {
    log.info("signal received", { signal: sig });
    await lifecycle.beginShutdown(`signal:${sig}`);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException", { err: err.message, stack: err.stack });
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    log.error("unhandledRejection", {
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

async function onRequest(
  ctx: DaemonContext,
  log: Logger,
  conn: Connection,
  req: IncomingRequest,
): Promise<void> {
  const handler = handlers[req.method];
  if (!handler) {
    conn.replyError(req.id, ErrorCode.MethodNotFound, `method '${req.method}' not found`);
    return;
  }
  try {
    const result = await handler(ctx, conn, req.params);
    conn.reply(req.id, result);
  } catch (err) {
    const rpc = rpcErrorFromUnknown(err);
    if (!(err instanceof RpcError)) {
      log.error("handler threw", {
        method: req.method,
        connection_id: conn.id,
        err: (err as Error).message,
      });
    }
    conn.replyError(req.id, rpc.code, rpc.message, rpc.data);
  }
}

function onNotification(
  log: Logger,
  conn: Connection,
  note: IncomingNotification,
): void {
  // The daemon does not currently consume notifications (heartbeat ping
  // responses arrive as success replies, not notifications). Log and ignore.
  log.debug("ignoring notification", {
    connection_id: conn.id,
    method: note.method,
  });
}

