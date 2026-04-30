import { Method } from "../shared/protocol.js";
import { DaemonLink, DaemonLinkError } from "./daemon-link.js";
import type { SessionStateBox } from "./state.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export const toolDefinitions: ToolDef[] = [
  {
    name: "register",
    description:
      "Register this Claude session with the broker so peers can find you. Must be called before any other tool. The name must be unique among connected peers.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Unique short identifier for this session (e.g. 'backend', 'frontend'). Must match /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.",
        },
        purpose: {
          type: "string",
          description:
            "One-line description of what this session is doing — helps peers decide who to ask.",
        },
        expertise: {
          type: "array",
          items: { type: "string" },
          description:
            "Tags describing this session's domain (e.g. ['python','fastapi']).",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "deregister",
    description:
      "Leave the broker. Your peers will see a peer_left event. Useful before changing your name.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_peers",
    description:
      "Return the current roster of connected peers (excluding yourself), each with name, purpose, expertise, status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "send_message",
    description:
      "Send a directed message to one peer by name. Returns delivered:true on success, or delivered:false with an error string if the peer is not connected.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Target peer name." },
        body: { type: "string", description: "Message content (markdown allowed)." },
        in_reply_to: {
          type: "string",
          description: "Optional message_id this message is responding to.",
        },
      },
      required: ["to", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "reply",
    description:
      "Reply to a specific inbound message. Convenience wrapper around send_message that requires the message_id you're replying to.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Sender's name (the 'from' attribute on the channel event)." },
        body: { type: "string" },
        in_reply_to: {
          type: "string",
          description: "The message_id from the inbound channel event you are replying to.",
        },
      },
      required: ["to", "body", "in_reply_to"],
      additionalProperties: false,
    },
  },
  {
    name: "broadcast",
    description:
      "Send a message to all connected peers. Use sparingly — only for announcements that affect everyone.",
    inputSchema: {
      type: "object",
      properties: { body: { type: "string" } },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "update_status",
    description:
      "Set this session's free-text status visible to peers (e.g. 'busy', 'running migration'). Triggers a status_changed event.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", maxLength: 200 } },
      required: ["status"],
      additionalProperties: false,
    },
  },
];

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function ok(value: unknown): ToolResult {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

interface DispatchDeps {
  link: DaemonLink;
  state: SessionStateBox;
}

async function callDaemon(
  deps: DispatchDeps,
  method: string,
  params: unknown,
): Promise<ToolResult> {
  try {
    const result = await deps.link.callRaw(method, params);
    return ok(result);
  } catch (e) {
    if (e instanceof DaemonLinkError) return err(e.userMessage);
    return err(`internal error: ${(e as Error).message}`);
  }
}

export async function dispatchTool(
  deps: DispatchDeps,
  toolName: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  if (toolName !== "register" && !deps.state.isRegistered()) {
    return err(
      "You must call the `register` tool before using this tool. " +
        "See the bobnet-mcp instructions for the suggested name/purpose/expertise.",
    );
  }

  switch (toolName) {
    case "register": {
      if (deps.state.isRegistered()) {
        return err(
          `already registered as '${(deps.state.get() as { name: string }).name}'. Call deregister first if you want to re-register.`,
        );
      }
      try {
        const result = await deps.link.call(Method.Register, {
          name: args["name"] as string,
          // The cwd of this Claude Code session is auto-injected from the
          // broker-client subprocess; Claude doesn't need to think about it.
          cwd: process.cwd(),
          ...(args["purpose"] !== undefined ? { purpose: args["purpose"] as string } : {}),
          ...(args["expertise"] !== undefined
            ? { expertise: args["expertise"] as string[] }
            : {}),
        });
        deps.state.setRegistered({ peer_id: result.peer_id, name: result.name });
        return ok(result);
      } catch (e) {
        if (e instanceof DaemonLinkError) return err(e.userMessage);
        return err(`internal error: ${(e as Error).message}`);
      }
    }
    case "deregister": {
      const result = await callDaemon(deps, Method.Deregister, {});
      if (!result.isError) deps.state.reset();
      return result;
    }
    case "list_peers":
      return callDaemon(deps, Method.ListPeers, {});
    case "send_message":
      return callDaemon(deps, Method.SendMessage, {
        to: args["to"],
        body: args["body"],
        ...(args["in_reply_to"] !== undefined
          ? { in_reply_to: args["in_reply_to"] }
          : {}),
      });
    case "reply":
      return callDaemon(deps, Method.SendMessage, {
        to: args["to"],
        body: args["body"],
        in_reply_to: args["in_reply_to"],
      });
    case "broadcast":
      return callDaemon(deps, Method.Broadcast, { body: args["body"] });
    case "update_status":
      return callDaemon(deps, Method.UpdateStatus, { status: args["status"] });
    default:
      return err(`unknown tool: ${toolName}`);
  }
}
