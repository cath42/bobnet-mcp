import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { callTool, handlers, INSTRUCTIONS, TOOLS } from "./mcp.ts";
import type { Supervisor } from "./supervisor.ts";

// The orchestrator's tools for a lead worker (its project's orchestrator, run as a
// worker), served in-process: the same tools as the supervisor's MCP server, with
// no token reaching the worker. Its spawns are its own, and it never stops, resets
// or answers for itself (mcp.ts).

export const LEAD_SERVER = "supervisor";

export function leadTools(sup: Supervisor, leadId: string) {
  const h = handlers(sup, { lead: leadId });
  return createSdkMcpServer({
    name: LEAD_SERVER,
    version: "0.2.0",
    instructions: INSTRUCTIONS,
    tools: TOOLS.map((t) =>
      tool(t.name, t.description, (z.fromJSONSchema(t.inputSchema as never) as z.ZodObject).shape, (args) => callTool(h, t.name, args)),
    ),
  });
}
