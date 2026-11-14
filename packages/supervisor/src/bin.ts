#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "@bobnet/client/config";
import { BrokerConnection } from "@bobnet/client/connection";
import { createLogger } from "@bobnet/client/log";
import ownPackage from "../package.json" with { type: "json" };
import { configDir, loadSupervisorConfig } from "./config.ts";
import { installLaunchAgent } from "./launchd.ts";
import { installSystemdUnit } from "./systemd.ts";
import { ensureToken, serveMcp } from "./mcp.ts";
import { type AccessConfig, ownerCheck } from "./owner.ts";
import { Policy } from "./policy.ts";
import { Store } from "./store.ts";
import { Supervisor } from "./supervisor.ts";

const log = createLogger();
const dir = configDir();

if (process.argv[2] === "install-launchd") {
  console.log(`Installed ${installLaunchAgent(new URL(import.meta.url).pathname)}`);
  process.exit(0);
}
if (process.argv[2] === "install-systemd") {
  console.log(`Installed ${installSystemdUnit(new URL(import.meta.url).pathname)}`);
  console.log("Start it: systemctl --user daemon-reload && systemctl --user enable --now bobnet-supervisor");
  console.log("Keep it running when you're logged out: loginctl enable-linger $USER");
  process.exit(0);
}

const config = loadSupervisorConfig(dir);

// One supervisor per laptop: a second would fight the first for every role name.
const pidFile = join(config.stateDir, "supervisor.pid");
if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, "utf8"));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    // Stale pid file from a crash.
  }
  if (alive && pid !== process.pid) {
    log.error("another supervisor is running", { pid });
    process.exit(1);
  }
}
const policy = Policy.load(dir);
const brokerConfig = loadConfig();
const store = new Store(join(config.stateDir, "supervisor.db"));

let supervisor: Supervisor | null = null;
const connection = new BrokerConnection({
  url: brokerConfig.url,
  credentials: brokerConfig.credentials,
  log,
  onPush: (frame) => supervisor?.onPush(frame),
  client: { package: ownPackage.name, version: ownPackage.version },
});
connection.start();

// Access settings in config.json let the owner act from the dashboard.
const access = (JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as { access?: AccessConfig }).access;
if (!access) log.warn("no \"access\" in config.json: dashboard actions will be refused");

supervisor = new Supervisor({
  config,
  policy,
  store,
  broker: connection,
  queryFn: query,
  log,
  ...(access ? { ownerCheck: ownerCheck(access) } : {}),
  boards: {},
});
writeFileSync(pidFile, String(process.pid));
try {
  await supervisor.start();
} catch (err) {
  log.error("supervisor failed to start", { err: (err as Error).message });
  rmSync(pidFile, { force: true });
  process.exit(1);
}

const token = ensureToken(join(dir, "supervisor.token"));
const http = await serveMcp(supervisor, { port: config.mcpPort, token, log });
log.info("supervisor ready", { mcp: `http://127.0.0.1:${config.mcpPort}/mcp`, projects: [...config.projects.keys()] });

const shutdown = async () => {
  log.info("shutting down");
  http.close();
  await supervisor?.shutdown();
  connection.stop();
  store.close();
  rmSync(pidFile, { force: true });
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
