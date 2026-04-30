#!/usr/bin/env node
import { runClient } from "../client/index.js";

runClient().catch((err: unknown) => {
  process.stderr.write(`bobnet-mcp: ${(err as Error).message}\n`);
  process.exit(1);
});
