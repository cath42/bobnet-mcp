import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { PeerInfo } from "@bobnet/protocol";
import { z } from "zod";

// The BobNet tools a worker gets, served in-process. Messages go out under the
// worker's role name over the supervisor's one broker connection, so a worker
// can't speak as anyone else.

export interface WorkerToolDeps {
  name: string;
  send: (to: string[], body: string, inReplyTo?: string) => Promise<unknown>;
  peers: () => Promise<PeerInfo[]>;
  checkpoint: (line: string) => void;
}

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const failed = (err: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: (err as Error).message }],
});

export const WORKER_SERVER = "bobnet";

export function workerTools(deps: WorkerToolDeps) {
  return createSdkMcpServer({
    name: WORKER_SERVER,
    version: "0.2.0",
    instructions:
      `You are ${deps.name} on BobNet. Messages from other agents reach you as user turns starting "[BobNet]". ` +
      "Reply with send_message (in_reply_to = the message id). Message only the agents involved; no acknowledgements. " +
      "Send paths, not copies, and never a credential. Before you finish, call checkpoint with one line.",
    tools: [
      tool(
        "send_message",
        "Message one agent or several (name on this laptop, or name@laptop). Offline agents get it when they return.",
        { to: z.union([z.string(), z.array(z.string()).min(1)]), body: z.string(), in_reply_to: z.string().optional() },
        async (a) => {
          try {
            return text(await deps.send(typeof a.to === "string" ? [a.to] : a.to, a.body, a.in_reply_to));
          } catch (err) {
            return failed(err);
          }
        },
      ),
      tool("list_peers", "Every agent on BobNet with team, purpose and status.", {}, async () => {
        try {
          return text(await deps.peers());
        } catch (err) {
          return failed(err);
        }
      }),
      tool(
        "checkpoint",
        "Record a one-line phase checkpoint, e.g. \"F12-b · story 3 · review passed · 2 issues fixed\". The orchestrator sees it when you finish.",
        { line: z.string().min(1).max(300) },
        async (a) => {
          deps.checkpoint(a.line);
          return text("recorded");
        },
      ),
    ],
  });
}
