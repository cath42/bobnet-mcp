import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { expect, it } from "vitest";

// Claude Code won't register a channel server that negotiates MCP revision
// 2026-07-28 (it can't carry channel messages). Staying on SDK 1.x keeps the
// server on the earlier handshake; this fails loudly if an upgrade changes that.
it("does not speak the MCP revision that can't carry channel messages", () => {
  expect(SUPPORTED_PROTOCOL_VERSIONS).not.toContain("2026-07-28");
});
