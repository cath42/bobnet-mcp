import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { EFFORTS } from "./config.ts";
import type { Answer } from "./router.ts";

// The tools a lead worker gets in place of the orchestrator's MCP server, served
// in-process: no token reaches the worker, and every tool acts in the lead's own
// project only. It answers only its own workers' requests, and never one a
// person decides (the supervisor checks both, not this file).

export interface LeadToolDeps {
  project: string;
  spawn: (a: {
    role: string;
    task: string;
    tasks?: string[];
    session?: { feature: string; kind: "design" | "build" | "review" | "retro"; label?: string } | null;
    handoff?: string;
    resume_session?: string;
    model?: string;
    effort?: (typeof EFFORTS)[number];
  }) => unknown;
  stop: (id: string) => Promise<unknown>;
  reset: (id: string, power: { model?: string; effort?: (typeof EFFORTS)[number] }) => Promise<unknown>;
  list: (all: boolean, opts: { limit?: number; since?: string }) => unknown;
  status: (id: string, full: boolean) => unknown;
  tail: (id: string, n: number) => string[];
  summary: (id: string) => unknown;
  pending: () => unknown;
  detail: (id: string) => unknown;
  answer: (id: string, answer: Answer) => unknown;
  project_info: () => unknown;
  runSlots: () => unknown;
  takeSlot: (name: string, label: string) => unknown;
  freeSlot: (name: string) => unknown;
  orderRunQueue: (names: string[]) => unknown;
}

export const LEAD_SERVER = "supervisor";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const failed = (err: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: (err as Error).message }],
});

/** Runs a tool's body, turning a thrown refusal into the tool's error text. */
const safely =
  <A>(fn: (a: A) => unknown) =>
  async (a: A) => {
    try {
      return text(await fn(a));
    } catch (err) {
      return failed(err);
    }
  };

const Effort = z.enum(EFFORTS);

export function leadTools(deps: LeadToolDeps) {
  return createSdkMcpServer({
    name: LEAD_SERVER,
    version: "0.1.0",
    instructions:
      `The supervisor's tools for ${deps.project}'s lead: spawn and follow its workers, and answer their orchestrator-tier requests. ` +
      "They act in this project only. Requests Casper decides (tier human) aren't yours to answer: he answers them on the dashboard or in your Remote Control session. " +
      "Worker completions and escalations reach you as BobNet messages from the supervisor.",
    tools: [
      tool(
        "spawn_worker",
        `Start (or queue, past the worker cap) a headless worker for one of ${deps.project}'s roles. Returns the worker id.`,
        {
          role: z.string(),
          task: z.string().min(1).describe("The whole task: what to do, what done means, which files to read."),
          tasks: z.array(z.string()).max(50).optional().describe('The backlog items it works on, e.g. ["LAND-41.3"]; a feature id for the feature as a whole, [] for none.'),
          session: z
            .object({ feature: z.string(), kind: z.enum(["design", "build", "review", "retro"]), label: z.string().optional() })
            .nullable()
            .optional()
            .describe('The session it works in, e.g. { feature: "LAND-43", kind: "build", label: "B" }; null for none.'),
          handoff: z.string().optional(),
          resume_session: z.string().optional(),
          model: z.string().optional(),
          effort: Effort.optional(),
        },
        safely((a) =>
          deps.spawn({
            role: a.role,
            task: a.task,
            ...(a.tasks ? { tasks: a.tasks } : {}),
            ...(a.session !== undefined ? { session: a.session ? { feature: a.session.feature, kind: a.session.kind, ...(a.session.label ? { label: a.session.label } : {}) } : null } : {}),
            ...(a.handoff ? { handoff: a.handoff } : {}),
            ...(a.resume_session ? { resume_session: a.resume_session } : {}),
            ...(a.model ? { model: a.model } : {}),
            ...(a.effort ? { effort: a.effort } : {}),
          }),
        ),
      ),
      tool("stop_worker", "Interrupt one of your project's workers, then kill it after a grace period.", { id: z.string() }, safely((a) => deps.stop(a.id))),
      tool(
        "reset_worker",
        "Stop a worker and queue a fresh one for the same role and task, with no prior context.",
        { id: z.string(), model: z.string().optional(), effort: Effort.optional() },
        safely((a) => deps.reset(a.id, { ...(a.model ? { model: a.model } : {}), ...(a.effort ? { effort: a.effort } : {}) })),
      ),
      tool(
        "list_workers",
        "Your project's live workers (queued or running), tasks cut short. all: true includes finished ones, the newest 20 unless limit says otherwise.",
        { all: z.boolean().default(false), limit: z.number().int().positive().max(500).optional(), since: z.string().optional() },
        safely((a) => deps.list(a.all, { ...(a.limit ? { limit: a.limit } : {}), ...(a.since ? { since: a.since } : {}) })),
      ),
      tool(
        "worker_status",
        "A worker's state, task (its first 500 characters unless full), last activity and session id.",
        { id: z.string(), full: z.boolean().default(false) },
        safely((a) => deps.status(a.id, a.full)),
      ),
      tool(
        "tail_worker",
        "The worker's last n events, one line each.",
        { id: z.string(), n: z.number().int().positive().max(500).default(40) },
        safely((a) => deps.tail(a.id, a.n).join("\n") || "(no events yet)"),
      ),
      tool("worker_summary", "A short digest of what a worker has done: tools used, files changed, last message, result.", { id: z.string() }, safely((a) => deps.summary(a.id))),
      tool("pending_requests", "Your project's open approvals and questions, one line each, with who decides each.", {}, safely(() => deps.pending())),
      tool("request_detail", "One of your project's requests in full, its whole input included.", { id: z.string() }, safely((a) => deps.detail(a.id))),
      tool(
        "answer_request",
        "Allow or deny an approval, or answer a question (answers: question text → answer), for a worker you spawned. A tier-human request is Casper's, not yours.",
        {
          id: z.string(),
          decision: z.enum(["allow", "deny", "answer"]),
          message: z.string().optional(),
          answers: z.record(z.string(), z.string()).optional(),
        },
        safely((a) => {
          if (a.decision === "answer" && !a.answers) throw new Error('decision "answer" needs answers');
          const answer: Answer =
            a.decision === "answer"
              ? { decision: "answer", answers: a.answers!, ...(a.message ? { message: a.message } : {}) }
              : { decision: a.decision, ...(a.message ? { message: a.message } : {}) };
          return deps.answer(a.id, answer);
        }),
      ),
      tool("list_projects", "Your project as registered on this laptop: its roles, their names and folders.", {}, safely(() => deps.project_info())),
      tool("run_slots", "The laptop's run slots: who holds one, who waits, and any hold.", {}, safely(() => deps.runSlots())),
      tool(
        "take_slot",
        "Queue one of your project's interactive agents for a run slot; you hear when it's granted. Free it with free_slot when the agent reports done.",
        { name: z.string().min(1), label: z.string().min(1) },
        safely((a) => deps.takeSlot(a.name, a.label)),
      ),
      tool("free_slot", "Free a slot (or a place in the queue) held by one of your project's agents or workers, by name or worker id.", { name: z.string().min(1) }, safely((a) => deps.freeSlot(a.name))),
      tool(
        "order_run_queue",
        "Put these of your project's holders (names or worker ids) first in the run queue, in this order.",
        { names: z.array(z.string()).min(1) },
        safely((a) => deps.orderRunQueue(a.names)),
      ),
    ],
  });
}
