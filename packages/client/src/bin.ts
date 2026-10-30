#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { createLogger } from "./log.ts";
import { createServer } from "./server.ts";

const log = createLogger();

// Inside a supervised worker the supervisor provides BobNet in-process; this
// server stays connected to Claude Code but offers nothing and joins nothing.
if (process.env["BOBNET_SUPERVISED"] === "1") {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  await new Server({ name: "bobnet", version: "0.2.0" }, { capabilities: {} }).connect(new StdioServerTransport());
  log.info("supervised worker: dormant");
} else {

let config;
try {
  config = loadConfig();
} catch (err) {
  log.error("config", { err: (err as Error).message });
  process.exit(1);
}

const { server, connection, register } = createServer({ url: config.url, credentials: config.credentials, log });

// Register only once the MCP client has initialized, so messages the broker
// flushes on registration can be pushed as channel events.
const identity = config.identity;
server.oninitialized = () => {
  connection.start();
  if (identity) {
    register(identity).then(
      (r) => log.info("registered", { address: r.address, queued: r.queued }),
      (err: Error) => log.error("auto-register failed", { err: err.message }),
    );
  }
};

const shutdown = () => {
  connection.stop();
  process.exit(0);
};
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await server.connect(new StdioServerTransport());
}
