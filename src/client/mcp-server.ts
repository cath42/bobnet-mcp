import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { PACKAGE_VERSION } from "../shared/version.js";
import type { Logger } from "../shared/logger.js";
import { ChannelForwarder } from "./channel-forward.js";
import { DaemonLink } from "./daemon-link.js";
import { dispatchTool, toolDefinitions } from "./tools.js";
import { buildInstructions } from "./instructions.js";
import { SessionStateBox } from "./state.js";

export interface McpServerOptions {
  link: DaemonLink;
  log: Logger;
}

export function createMcpServer(opts: McpServerOptions): {
  server: Server;
  state: SessionStateBox;
} {
  const { link, log } = opts;
  const state = new SessionStateBox();
  const forwarder = new ChannelForwarder();

  const server = new Server(
    { name: "bobnet-mcp", version: PACKAGE_VERSION },
    {
      capabilities: {
        tools: {},
        experimental: { "claude/channel": {} },
      },
      instructions: buildInstructions(),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    log.debug("tool call", { tool: name });
    const result = await dispatchTool({ link, state }, name, args);
    // The session is already awake, so hand over anything queued for it.
    const digest = forwarder.drainDigest();
    if (digest !== null) {
      result.content.push({ type: "text", text: digest });
    }
    return result as CallToolResult;
  });

  link.onChannelEvent((evt) => {
    const payload = forwarder.handle(evt);
    if (payload === null) {
      log.debug("channel event queued", { event: evt.event_type });
      return;
    }
    server
      .notification({
        method: "notifications/claude/channel",
        params: payload as unknown as Record<string, unknown>,
      })
      .catch((err) => {
        log.warn("notification send failed", { err: (err as Error).message });
      });
  });

  link.onClose(() => {
    log.warn("daemon link closed");
    state.reset();
  });

  return { server, state };
}
