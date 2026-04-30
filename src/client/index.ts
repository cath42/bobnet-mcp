import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLogger, type Logger } from "../shared/logger.js";
import { lockPath, logPath, socketPath } from "../shared/paths.js";
import { PROTOCOL_VERSION } from "../shared/version.js";
import { nowIso } from "../shared/time.js";
import { Method } from "../shared/protocol.js";
import { DaemonLink, DaemonLinkError } from "./daemon-link.js";
import { ensureDaemonRunning } from "./spawn-daemon.js";
import { createMcpServer } from "./mcp-server.js";

const ENV_DEBUG = process.env["BOBNET_DEBUG"] === "1";

function resolveDaemonScript(): string {
  // When running from `dist/`: dist/client/index.js → dist/bin/bobnet-mcp-daemon.js
  // When running from tsx: src/client/index.ts → src/bin/bobnet-mcp-daemon.ts
  const here = dirname(fileURLToPath(import.meta.url));
  const isDist = here.includes(`${"/"}dist${"/"}`) || here.endsWith("/dist/client");
  if (isDist) {
    return resolve(here, "../bin/bobnet-mcp-daemon.js");
  }
  return resolve(here, "../bin/bobnet-mcp-daemon.ts");
}

async function performHandshake(link: DaemonLink, log: Logger): Promise<void> {
  await link.call(Method.Hello, {
    protocol_version: PROTOCOL_VERSION,
    client_pid: process.pid,
    client_started_at: nowIso(),
  });
  log.debug("handshake complete");
}

export async function runClient(): Promise<void> {
  const log = createLogger({
    to: "stderr",
    level: ENV_DEBUG ? "debug" : "info",
    base: { component: "client", pid: process.pid },
  });

  const sock = socketPath();
  const lockP = lockPath();
  const logP = logPath();
  const daemonScript = resolveDaemonScript();

  log.debug("client starting", {
    socket_path: sock,
    daemon_script: daemonScript,
  });

  const link = new DaemonLink(sock, log);

  try {
    await ensureDaemonRunning({
      socketPath: sock,
      lockPath: lockP,
      logPath: logP,
      daemonScript,
      log,
    });
    await link.connect();
    await performHandshake(link, log);
  } catch (err) {
    const msg = err instanceof DaemonLinkError ? err.userMessage : (err as Error).message;
    log.error("daemon connection failed at startup", { err: msg });
    // We still want to expose tools to Claude (they'll return errors) so the
    // session can recover by retrying, but for now bail out: there's nothing
    // useful we can do without the daemon.
    process.exit(1);
  }

  const { server, state } = createMcpServer({ link, log });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP stdio server connected");

  const cleanup = async (signal: string) => {
    log.info("client shutting down", { signal });
    try {
      if (state.isRegistered()) {
        await link.callRaw(Method.Deregister, {}).catch(() => undefined);
      }
    } finally {
      link.close();
      try {
        await server.close();
      } catch {
        /* ignore */
      }
    }
  };

  // stdio EOF is the canonical Claude Code "shutdown" signal.
  process.stdin.on("end", () => {
    void cleanup("stdin_end").then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void cleanup("SIGTERM").then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void cleanup("SIGINT").then(() => process.exit(0));
  });
}

