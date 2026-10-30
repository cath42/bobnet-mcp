#!/usr/bin/env node
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "@bobnet/client/config";
import { BrokerConnection } from "@bobnet/client/connection";
import { createLogger } from "@bobnet/client/log";
import { configDir, loadSupervisorConfig } from "./config.ts";
import { installLaunchAgent } from "./launchd.ts";
import { ensureToken, serveMcp } from "./mcp.ts";
import { Policy } from "./policy.ts";
import { Store } from "./store.ts";
import { Supervisor } from "./supervisor.ts";

const log = createLogger();
const dir = configDir();

if (process.argv[2] === "install-launchd") {
  console.log(`Installed ${installLaunchAgent(new URL(import.meta.url).pathname)}`);
  process.exit(0);
}

const config = loadSupervisorConfig(dir);
const policy = Policy.load(dir);
const brokerConfig = loadConfig();
const store = new Store(join(config.stateDir, "supervisor.db"));

let supervisor: Supervisor | null = null;
const connection = new BrokerConnection({
  url: brokerConfig.url,
  credentials: brokerConfig.credentials,
  log,
  onPush: (frame) => supervisor?.onPush(frame),
});
connection.start();

supervisor = new Supervisor({ config, policy, store, broker: connection, queryFn: query, log });
await supervisor.start();

const token = ensureToken(join(dir, "supervisor.token"));
const http = await serveMcp(supervisor, { port: config.mcpPort, token, log });
log.info("supervisor ready", { mcp: `http://127.0.0.1:${config.mcpPort}/mcp`, projects: [...config.projects.keys()] });

const shutdown = async () => {
  log.info("shutting down");
  http.close();
  await supervisor?.shutdown();
  connection.stop();
  store.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
