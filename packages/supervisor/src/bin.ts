#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "@bobnet/client/config";
import { BrokerConnection } from "@bobnet/client/connection";
import { createLogger } from "@bobnet/client/log";
import ownPackage from "../package.json" with { type: "json" };
import { importBacklogCommand } from "./backlog-import.ts";
import { BoardBackup, exportFetcher, importPoster } from "./board-backup.ts";
import { preflight } from "./check.ts";
import { configDir, guardedFolders, loadSupervisorConfig, releaseRoot, strandedState } from "./config.ts";
import { installLaunchAgent } from "./launchd.ts";
import { installSystemdUnit } from "./systemd.ts";
import { ensureToken, serveMcp } from "./mcp.ts";
import { type AccessConfig, ownerCheck } from "./owner.ts";
import { Policy } from "./policy.ts";
import { Store } from "./store.ts";
import { Supervisor } from "./supervisor.ts";
import { EXIT_UPGRADE, GitReleases, serviceBin } from "./upgrade.ts";

const log = createLogger();
const dir = configDir();

// The one-off Backlog.md import (ADR 0001 §11): a dry run unless --post.
if (process.argv[2] === "import-backlog") {
  process.exit(
    await importBacklogCommand(process.argv.slice(3), () => {
      const broker = loadConfig();
      return importPoster(broker.url, broker.credentials);
    }),
  );
}

// The preflight of an upgrade (ADR 0008 §4): run by the new release before the switch. Its modules
// imported to get here; it reads the configs and nothing else.
if (process.argv[2] === "check") {
  const problems = preflight(dir, join(dirname(new URL(import.meta.url).pathname), "..", "..", ".."));
  for (const p of problems) console.error(p);
  if (problems.length === 0) console.log(`ok: ${ownPackage.version} on node ${process.versions.node}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

// Run from a release under <root>, the service runs <root>/current, which an upgrade switches (ADR 0008 §1).
const serviceBinPath = () => serviceBin(new URL(import.meta.url).pathname, releaseRoot(dir));
if (process.argv[2] === "install-launchd") {
  console.log(`Installed ${installLaunchAgent(serviceBinPath())}`);
  process.exit(0);
}
if (process.argv[2] === "install-systemd") {
  console.log(`Installed ${installSystemdUnit(serviceBinPath())}`);
  console.log("Start it: systemctl --user daemon-reload && systemctl --user enable --now bobnet-supervisor");
  console.log("Keep it running when you're logged out: loginctl enable-linger $USER");
  process.exit(0);
}

const config = loadSupervisorConfig(dir);
const stranded = strandedState(readFileSync(join(dir, "supervisor.yaml"), "utf8"), config.stateDir);
if (stranded) {
  log.error(stranded);
  process.exit(1);
}

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
// Workers never touch the releases (ADR 0008, Consequences) or the clone upgrades come from (ruling 5).
const policy = Policy.load(dir, guardedFolders(config));
const brokerConfig = loadConfig();
const store = new Store(join(config.stateDir, "supervisor.db"));

let supervisor: Supervisor | null = null;
const connection = new BrokerConnection({
  url: brokerConfig.url,
  credentials: brokerConfig.credentials,
  log,
  onPush: (frame) => supervisor?.onPush(frame),
  // Board reports and captures that waited for the broker go once it is back.
  onReady: () => supervisor?.onConnected(),
  client: { package: ownPackage.name, version: ownPackage.version },
});
connection.start();

// Access settings in config.json let the owner act from the dashboard.
const access = (JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as { access?: AccessConfig }).access;
if (!access) log.warn("no \"access\" in config.json: dashboard actions will be refused");

/** Set once everything has started; until then an upgrade's exit only removes the pid file. */
let shutdown: ((code?: number) => Promise<void>) | null = null;
supervisor = new Supervisor({
  config,
  policy,
  store,
  broker: connection,
  queryFn: query,
  log,
  ...(access ? { ownerCheck: ownerCheck(access) } : {}),
  boards: {},
  version: ownPackage.version,
  releases: config.upgrade ? new GitReleases(config.upgrade, { configDir: dir }) : null,
  // An upgrade switched current: shut down as on SIGTERM, but exit 75 so the service manager starts it again (§4).
  restart: () => {
    if (shutdown) return void shutdown(EXIT_UPGRADE);
    rmSync(pidFile, { force: true });
    process.exit(EXIT_UPGRADE);
  },
});
writeFileSync(pidFile, String(process.pid));
try {
  await supervisor.start();
} catch (err) {
  log.error("supervisor failed to start", { err: (err as Error).message });
  rmSync(pidFile, { force: true });
  process.exit(1);
}

// The board's nightly backup, on the laptop whose config names a repository for it.
const backup = config.boardBackup
  ? new BoardBackup({ ...config.boardBackup, fetchExport: exportFetcher(brokerConfig.url, brokerConfig.credentials), log })
  : null;
backup?.start();

const token = ensureToken(join(dir, "supervisor.token"));
const http = await serveMcp(supervisor, { port: config.mcpPort, token, log });
log.info("supervisor ready", { mcp: `http://127.0.0.1:${config.mcpPort}/mcp`, projects: [...config.projects.keys()] });

let stopping = false;
shutdown = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  log.info("shutting down", { code });
  http.close();
  backup?.stop();
  await supervisor?.shutdown();
  connection.stop();
  store.close();
  rmSync(pidFile, { force: true });
  process.exit(code);
};
process.on("SIGTERM", () => void shutdown?.());
process.on("SIGINT", () => void shutdown?.());
