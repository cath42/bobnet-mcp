import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "@bobnet/client/log";
import { z } from "zod";
import { AnswerError } from "./router.ts";
import { type Supervisor, SupervisorError } from "./supervisor.ts";

// The orchestrator's tools, over MCP Streamable HTTP on 127.0.0.1 only, behind
// a bearer token kept in ~/.config/bobnet/supervisor.token (mode 0600).

const Spawn = z.object({
  project: z.string(),
  role: z.string(),
  task: z.string().min(1),
  handoff: z.string().optional(),
  resume_session: z.string().optional(),
});
const Id = z.object({ id: z.string() });
const Tail = z.object({ id: z.string(), n: z.number().int().positive().max(500).default(40) });
const ListArgs = z.object({ project: z.string().optional() });
const AnswerArgs = z.object({
  id: z.string(),
  decision: z.enum(["allow", "deny", "answer"]),
  message: z.string().optional(),
  answers: z.record(z.string(), z.string()).optional(),
  user_decided: z.boolean().default(false),
});
const AuditArgs = z.object({ limit: z.number().int().positive().max(500).default(50) });

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const TOOLS = [
  {
    name: "spawn_worker",
    description:
      "Start (or queue, past the concurrency cap) a headless worker for a project role, in the role's folder with its own CLAUDE.md, skills and settings. Returns the worker id.",
    inputSchema: obj(
      {
        project: { type: "string" },
        role: { type: "string" },
        task: { type: "string", description: "The whole task: what to do, what done means, which files to read." },
        handoff: { type: "string", description: "Handoff file path to read first and write before finishing." },
        resume_session: { type: "string", description: "Resume this session id instead of starting fresh (review-to-build fix loops)." },
      },
      ["project", "role", "task"],
    ),
  },
  { name: "stop_worker", description: "Interrupt a worker, then kill it after a grace period.", inputSchema: obj({ id: { type: "string" } }, ["id"]) },
  { name: "reset_worker", description: "Stop a worker and queue a fresh one for the same role and task, with no prior context.", inputSchema: obj({ id: { type: "string" } }, ["id"]) },
  { name: "list_workers", description: "Workers and their states, optionally for one project.", inputSchema: obj({ project: { type: "string" } }) },
  { name: "worker_status", description: "A worker's state, task, last activity, session id and how to open its transcript.", inputSchema: obj({ id: { type: "string" } }, ["id"]) },
  { name: "tail_worker", description: "The worker's last n events, one line each.", inputSchema: obj({ id: { type: "string" }, n: { type: "number" } }, ["id"]) },
  { name: "worker_summary", description: "A short digest of what a worker has done: tools used, files changed, last message, result.", inputSchema: obj({ id: { type: "string" } }, ["id"]) },
  { name: "pending_requests", description: "Open approvals and questions across all workers, including ones orphaned by a restart.", inputSchema: obj({}) },
  {
    name: "answer_request",
    description:
      "Allow or deny an approval, or answer a question (answers: question text → answer). Requests with tier \"human\" need the user's own decision: set user_decided only when the user gave this exact decision in this conversation, never on your own judgement. Answering an orphaned request resumes its worker.",
    inputSchema: obj(
      {
        id: { type: "string" },
        decision: { type: "string", enum: ["allow", "deny", "answer"] },
        message: { type: "string" },
        answers: { type: "object", additionalProperties: { type: "string" } },
        user_decided: { type: "boolean" },
      },
      ["id", "decision"],
    ),
  },
  { name: "list_projects", description: "Projects registered on this laptop and their roles.", inputSchema: obj({}) },
  { name: "audit_log", description: "The supervisor's most recent actions, newest first.", inputSchema: obj({ limit: { type: "number" } }) },
] as const;

function handlers(sup: Supervisor): Record<string, (args: unknown) => Promise<unknown> | unknown> {
  return {
    spawn_worker: (a) => {
      const s = Spawn.parse(a);
      return sup.spawn({
        project: s.project,
        role: s.role,
        task: s.task,
        ...(s.handoff ? { handoff: s.handoff } : {}),
        ...(s.resume_session ? { resume_session: s.resume_session } : {}),
      });
    },
    stop_worker: (a) => sup.stop(Id.parse(a).id),
    reset_worker: (a) => sup.reset(Id.parse(a).id),
    list_workers: (a) => sup.list(ListArgs.parse(a).project),
    worker_status: (a) => sup.status(Id.parse(a).id),
    tail_worker: (a) => {
      const t = Tail.parse(a);
      return sup.tail(t.id, t.n).join("\n") || "(no events yet)";
    },
    worker_summary: (a) => sup.summary(Id.parse(a).id),
    pending_requests: () => sup.pending(),
    answer_request: (a) => {
      const x = AnswerArgs.parse(a);
      if (x.decision === "answer" && !x.answers) throw new AnswerError("decision \"answer\" needs answers");
      const answer =
        x.decision === "answer"
          ? { decision: "answer" as const, answers: x.answers!, ...(x.message ? { message: x.message } : {}) }
          : { decision: x.decision, ...(x.message ? { message: x.message } : {}) };
      return sup.answer(x.id, answer, x.user_decided ? "human" : "orchestrator");
    },
    list_projects: () => sup.projects(),
    audit_log: (a) => sup.audit(AuditArgs.parse(a).limit),
  };
}

function mcpServer(sup: Supervisor): Server {
  const server = new Server(
    { name: "bobnet-supervisor", version: "0.2.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Controls the headless workers on this laptop. Spawn a fresh worker per story phase; read worker_summary and handoff files, not raw logs. " +
        "Escalations and worker completions arrive as BobNet messages from the supervisor; answer with answer_request. " +
        "Surface to the user anything you can't decide, and every tier-\"human\" request.",
    },
  );
  const h = handlers(sup);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const fn = h[req.params.name];
    if (!fn) return { isError: true, content: [{ type: "text", text: `Unknown tool ${req.params.name}` }] };
    try {
      const result = await fn(req.params.arguments ?? {});
      return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const known = err instanceof SupervisorError || err instanceof AnswerError;
      const text =
        err instanceof z.ZodError
          ? `bad_arguments: ${err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`
          : known
            ? (err as Error).message
            : `error: ${(err as Error).message}`;
      return { isError: true, content: [{ type: "text", text }] };
    }
  });
  return server;
}

/** Reads the bearer token, creating it (0600) on first run. */
export function ensureToken(file: string): string {
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const token = randomBytes(32).toString("base64url");
  writeFileSync(file, `${token}\n`, { mode: 0o600, flag: "wx" });
  return token;
}

export function serveMcp(sup: Supervisor, opts: { port: number; token: string; log: Logger }): Promise<HttpServer> {
  const expected = Buffer.from(`Bearer ${opts.token}`);
  const http = createHttpServer(async (req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? "");
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404).end("Not found");
      return;
    }
    // Stateless (no session id generator): a fresh server and transport per request.
    const server = mcpServer(sup);
    const transport = new StreamableHTTPServerTransport({});
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      opts.log.error("mcp request failed", { err: (err as Error).message });
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, "127.0.0.1", () => resolve(http));
  });
}
