#!/usr/bin/env node
import { runDaemon } from "../daemon/index.js";

runDaemon(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`bobnet-mcp-daemon: ${(err as Error).message}\n`);
  process.exit(1);
});
