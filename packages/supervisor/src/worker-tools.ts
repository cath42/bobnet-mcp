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
  /** Lands this worker's commits with the project's land command, in a run slot. Absent if the project has none. */
  land?: () => Promise<{ ok: boolean; output: string }>;
  /** Rebases this worker's branch onto the project's main, outside the sandbox. Absent if the project has none. */
  rebase?: () => Promise<{ ok: boolean; output: string }>;
  /** Commands this worker may have the supervisor run outside the sandbox, and how. */
  runs: Array<{ name: string; description: string; takesArgs: boolean }>;
  run: (name: string, args: string[]) => Promise<{ ok: boolean; output: string }>;
  /** Roles this worker may consult, and how. */
  consultable: string[];
  consult: (role: string, question: string) => Promise<string>;
  answerConsult: (id: string, answer: string) => void;
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
      ...(deps.land
        ? [
            tool(
              "land",
              "Land your committed work: the supervisor runs the project's land command in your worktree, through the hook, in a run slot (you may wait for it). " +
                "Commit first; the tree must be clean. One attempt: on failure, read the output, fix, and call it again only once the cause is fixed.",
              {},
              async () => {
                try {
                  const r = await deps.land!();
                  return r.ok ? text(r.output) : { isError: true, content: [{ type: "text" as const, text: r.output }] };
                } catch (err) {
                  return failed(err);
                }
              },
            ),
          ]
        : []),
      ...(deps.rebase
        ? [
            tool(
              "rebase",
              "Rebase your branch onto the latest main: the supervisor fetches it and rebases in your worktree (don't run git rebase yourself; the sandbox can't write .claude/). " +
                "Commit first; the tree must be clean. On a conflict it aborts and your branch is left exactly as it was.",
              {},
              async () => {
                try {
                  const r = await deps.rebase!();
                  return r.ok ? text(r.output) : { isError: true, content: [{ type: "text" as const, text: r.output }] };
                } catch (err) {
                  return failed(err);
                }
              },
            ),
          ]
        : []),
      ...(deps.runs.length > 0
        ? [
            tool(
              "run",
              "Run one of these commands outside the sandbox, in your worktree (for what a browser needs, which can't start in your Bash): " +
                deps.runs.map((r) => `${r.name}: ${r.description}${r.takesArgs ? "" : " (no args)"}`).join("; ") +
                ". It may wait for a run slot. Arguments stay inside your worktree: no absolute paths, ~ or ..",
              { name: z.enum(deps.runs.map((r) => r.name) as [string, ...string[]]), args: z.array(z.string()).max(20).default([]) },
              async (a) => {
                try {
                  const r = await deps.run(a.name, a.args);
                  return r.ok ? text(r.output) : { isError: true, content: [{ type: "text" as const, text: r.output }] };
                } catch (err) {
                  return failed(err);
                }
              },
            ),
          ]
        : []),
      ...(deps.consultable.length > 0
        ? [
            tool(
              "consult",
              `Ask another role a question mid-task and wait for its answer (a few minutes at most). You may consult: ${deps.consultable.join(", ")}. ` +
                "The answer is advisory until its owner records it in their file; don't cite it as a ruling.",
              { role: z.enum(deps.consultable as [string, ...string[]]), question: z.string().min(1).max(4000) },
              async (a) => {
                try {
                  return text(await deps.consult(a.role, a.question));
                } catch (err) {
                  return failed(err);
                }
              },
            ),
          ]
        : []),
      tool(
        "answer_consult",
        "Answer a consult another worker sent you (the id is in the [Consult …] message).",
        { id: z.string(), answer: z.string().min(1) },
        async (a) => {
          try {
            deps.answerConsult(a.id, a.answer);
            return text("sent");
          } catch (err) {
            return failed(err);
          }
        },
      ),
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
