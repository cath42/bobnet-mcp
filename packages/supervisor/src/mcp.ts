import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "@bobnet/client/log";
import { z } from "zod";
import { EFFORTS } from "./config.ts";
import { AnswerError } from "./router.ts";
import { LIST_ALL_DEFAULT, type Supervisor, SupervisorError } from "./supervisor.ts";

// The orchestrator's tools, over MCP Streamable HTTP on 127.0.0.1 only, behind
// a bearer token kept in ~/.config/bobnet/supervisor.token (mode 0600).
// With `laptop`, the orchestrator's tools act on another laptop's supervisor (ADR 0007 §5).

/** Another laptop by its BobNet id; none, or this one's, is this laptop as before. */
const Laptop = z.string().min(1).optional();

const Spawn = z.object({
  project: z.string(),
  role: z.string(),
  task: z.string().min(1),
  tasks: z.array(z.string()).max(50).optional(),
  session: z.object({ feature: z.string(), kind: z.enum(["design", "build", "review", "retro"]), label: z.string().optional() }).nullable().optional(),
  handoff: z.string().optional(),
  resume_session: z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(EFFORTS).optional(),
  as: z.enum(["lead", "worker"]).optional(),
  laptop: Laptop,
});
const Id = z.object({ id: z.string() });
const WorkerId = z.object({ id: z.string(), laptop: Laptop });
const Reset = z.object({ id: z.string(), model: z.string().optional(), effort: z.enum(EFFORTS).optional(), laptop: Laptop });
const TakeSlot = z.object({ project: z.string(), name: z.string().min(1), label: z.string().min(1), laptop: Laptop });
const FreeSlot = z.object({ name: z.string().min(1), laptop: Laptop });
const OrderQueue = z.object({ names: z.array(z.string()).min(1), laptop: Laptop });
const Here = z.object({ laptop: Laptop });
const Tail = z.object({ id: z.string(), n: z.number().int().positive().max(500).default(40), laptop: Laptop });
const ListArgs = z.object({ project: z.string().optional(), all: z.boolean().default(false), limit: z.number().int().positive().max(500).optional(), since: z.string().optional(), laptop: Laptop });
const StatusArgs = z.object({ id: z.string(), full: z.boolean().default(false), laptop: Laptop });
const AnswerArgs = z.object({
  id: z.string(),
  decision: z.enum(["allow", "deny", "answer"]),
  message: z.string().optional(),
  answers: z.record(z.string(), z.string()).optional(),
  user_decided: z.boolean().default(false),
  resume: z.boolean().default(true),
});
const AuditArgs = z.object({ limit: z.number().int().positive().max(500).default(50) });

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/** A spawn's model and effort: the role's defaults unless the task needs more or less. */
const POWER = {
  model: { type: "string", description: "Override the role's default model (opus, sonnet, haiku) for this task; the role may limit which." },
  effort: { type: "string", enum: [...EFFORTS], description: "Override the role's default effort: less for routine work, more for hard design; capped by the role's max_effort." },
};

/** `laptop` on the tools that act on a worker or spawn one. */
const AT = {
  laptop: {
    type: "string",
    description: "Another laptop's BobNet id (e.g. ubu1): act there, through its supervisor. Default: this laptop. A worker spawned elsewhere is found without it.",
  },
};
/** `laptop` on the tools that act on this laptop only (§5): another is refused. */
const HERE = { laptop: { type: "string", description: "This laptop only; another laptop's is its own orchestrator's." } };

export const TOOLS = [
  {
    name: "spawn_worker",
    description:
      "Start (or queue, past the concurrency cap) a headless worker for a project role, in the role's folder with its own CLAUDE.md, skills and settings. Returns the worker id.",
    inputSchema: obj(
      {
        project: { type: "string" },
        role: { type: "string" },
        task: { type: "string", description: "The whole task: what to do, what done means, which files to read." },
        tasks: {
          type: "array",
          items: { type: "string" },
          description:
            "The backlog items it builds, fixes or reviews, e.g. [\"LAND-41.3\", \"LAND-41.32\"]; a feature id (\"LAND-41\") for work on the feature as a whole, [] for none. Required for a project with a backlog: the dashboard shows the worker on these cards and guesses nothing from the brief.",
        },
        session: {
          type: ["object", "null"],
          properties: {
            feature: { type: "string", description: "The feature's id, e.g. LAND-43." },
            kind: { type: "string", enum: ["design", "build", "review", "retro"] },
            label: { type: "string", description: "What you call it, shown as given: \"B\", \"3\". Sessions of a kind with different labels are apart." },
          },
          required: ["feature", "kind"],
          additionalProperties: false,
          description:
            "The session it works in, e.g. { feature: \"LAND-43\", kind: \"build\", label: \"B\" }; null for none (a consult, a fix between sessions: Other work). Required for a project with a backlog: the dashboard groups workers, tokens and build lanes by it and reads nothing from the brief.",
        },
        handoff: { type: "string", description: "Handoff file path to read first and write before finishing." },
        resume_session: { type: "string", description: "Resume this session id instead of starting fresh (review-to-build fix loops)." },
        as: {
          type: "string",
          enum: ["lead", "worker"],
          description:
            "worker (the default): ends after its result and holds a worker slot. lead: a long-lived session Casper talks to, alive until stopped, holding no slot; only for a role with lead: true, and only when Casper asks for one.",
        },
        ...POWER,
        laptop: {
          type: "string",
          description:
            "Another laptop's BobNet id (e.g. ubu1): spawn there, under its supervisor's config, now or refused with its reason, never queued. Not with handoff, resume_session or as: lead. Default: this laptop.",
        },
      },
      ["project", "role", "task"],
    ),
  },
  { name: "stop_worker", description: "Interrupt a worker, then kill it after a grace period.", inputSchema: obj({ id: { type: "string" }, ...AT }, ["id"]) },
  {
    name: "reset_worker",
    description: "Stop a worker and queue a fresh one for the same role and task, with no prior context, on what it ran on unless you set model or effort (a retry that failed for lack of power).",
    inputSchema: obj({ id: { type: "string" }, ...POWER, ...HERE }, ["id"]),
  },
  {
    name: "list_workers",
    description: "Live workers (queued or running) and their states, tasks cut short, optionally for one project. all: true includes finished ones, the newest 20 unless limit says otherwise.",
    inputSchema: obj({
      project: { type: "string" },
      all: { type: "boolean", description: "Include finished workers." },
      limit: { type: "number", description: "The newest this many (all: true defaults to 20; at most 500)." },
      since: { type: "string", description: "ISO time: only workers that started or ended at or after it." },
      laptop: {
        type: "string",
        description: "Another laptop's BobNet id: the workers this supervisor spawned there, asked live, each with as_of. \"*\": this laptop's and every laptop's, each row with laptop. Default: this laptop.",
      },
    }),
  },
  {
    name: "worker_status",
    description: "A worker's state, task (its first 500 characters unless full), last activity, session id and how to open its transcript.",
    inputSchema: obj({ id: { type: "string" }, full: { type: "boolean", description: "The whole brief." }, ...AT }, ["id"]),
  },
  { name: "tail_worker", description: "The worker's last n events, one line each.", inputSchema: obj({ id: { type: "string" }, n: { type: "number" }, ...AT }, ["id"]) },
  { name: "worker_summary", description: "A short digest of what a worker has done: tools used, files changed, last message, result.", inputSchema: obj({ id: { type: "string" }, ...AT }, ["id"]) },
  { name: "pending_requests", description: "Open approvals and questions across all workers (including ones orphaned by a restart, until they can no longer resume or are a day old), one line each. request_detail gives one in full.", inputSchema: obj({}) },
  { name: "request_detail", description: "One request in full, its whole input included. Only when the one-line preview isn't enough to decide.", inputSchema: obj({ id: { type: "string" } }, ["id"]) },
  {
    name: "answer_request",
    description:
      "Allow or deny an approval, or answer a question (answers: question text → answer). Requests with tier \"human\" need the user's own decision: set user_decided only when the user gave this exact decision in this conversation, never on your own judgement. Answering an orphaned request resumes its worker; to just close one without resuming anything, deny it with resume: false.",
    inputSchema: obj(
      {
        id: { type: "string" },
        decision: { type: "string", enum: ["allow", "deny", "answer"] },
        message: { type: "string" },
        answers: { type: "object", additionalProperties: { type: "string" } },
        user_decided: { type: "boolean" },
        resume: { type: "boolean", description: "Orphaned requests only: false closes it without resuming the worker." },
      },
      ["id", "decision"],
    ),
  },
  { name: "list_projects", description: "Projects registered on this laptop and their roles.", inputSchema: obj({}) },
  { name: "audit_log", description: "The supervisor's most recent actions, newest first.", inputSchema: obj({ limit: { type: "number" } }) },
  {
    name: "take_slot",
    description:
      "Queue an interactive agent (not a worker) for the laptop's one run slot, for a test, probe, browser run or land. You are told when it's given; tell the agent to go, then free_slot when it reports done. Workers queue themselves.",
    inputSchema: obj({ project: { type: "string" }, name: { type: "string" }, label: { type: "string", description: "What will run" }, ...HERE }, ["project", "name", "label"]),
  },
  { name: "free_slot", description: "Free the run slot (or a place in its queue) held by an agent or worker, by name or worker id.", inputSchema: obj({ name: { type: "string" }, ...HERE }, ["name"]) },
  {
    name: "order_run_queue",
    description: "Put these agents (names or worker ids) first in the run queue, in this order, e.g. by the critical path. The rest keep their order.",
    inputSchema: obj({ names: { type: "array", items: { type: "string" } }, ...HERE }, ["names"]),
  },
  { name: "run_slots", description: "The run slot: the hold if any (read from the projects' hold files, e.g. pnpm integrate hold), who holds the slot and for what, and who is waiting, in order.", inputSchema: obj({ ...HERE }) },
] as const;

/**
 * The tools' bodies. With `lead`, they run for a lead worker (its project's orchestrator, run as a
 * worker): its spawns are its own, and it never stops, resets or answers for itself.
 */
export function handlers(sup: Supervisor, opts: { lead?: string } = {}): Record<string, (args: unknown) => Promise<unknown> | unknown> {
  const notSelf = (id: string, what: string) => {
    if (opts.lead && id === opts.lead) throw new SupervisorError(`You can't ${what} yourself; Casper does that from the dashboard`);
    return id;
  };
  /** A tool that acts on this laptop only (§5), or any tool of a lead's (§1): another laptop is refused. */
  const here = (laptop: string | undefined, tool: string) => {
    if (sup.isHere(laptop)) return;
    if (opts.lead) throw new SupervisorError(`A lead's tools act on its own laptop only (${sup.laptopName}); laptop ${laptop} is the orchestrator's`);
    throw new SupervisorError(`${tool} acts on this laptop only (${sup.laptopName}); ${laptop}'s is its own orchestrator's`);
  };
  /** The laptop a worker id is on: null for this one. A lead's are all here. */
  const where = (id: string, laptop: string | undefined, tool: string): string | null => {
    if (!opts.lead) return sup.remoteWhere(id, laptop);
    here(laptop, tool);
    return null;
  };
  /** A remote worker as a tool shows it: where it is and when that was so. */
  const remoteRow = (w: unknown, laptop: string, as_of: string) => ({ ...(w as Record<string, unknown>), laptop, as_of });
  /** What a reply the requester didn't get in time, its worker found by list instead, says. */
  const found = (r: Record<string, unknown>, laptop: string, what: string) => (r["found"] ? { note: `no reply in time; ${laptop}'s list shows ${what}` } : {});
  /**
   * The workers this supervisor spawned on `laptop`, from its copies (§7) once reconciled: those not
   * ended, or with `all` every one. A laptop that can't be asked leaves the copies as they were, each
   * saying why; with no copies there, it is refused as any request would be.
   */
  const remoteList = async (laptop: string, l: z.infer<typeof ListArgs>): Promise<Array<Record<string, unknown>>> => {
    if (sup.remoteCopies(laptop).length === 0) {
      await sup.remoteTarget(laptop);
      return [];
    }
    const why = await sup.reconcileOn(laptop);
    let ws = sup.remoteCopies(laptop).filter((c) => l.all || !c.ended).map((c) => sup.copyRow(c));
    if (l.project) ws = ws.filter((w) => w["project"] === l.project);
    if (l.since) ws = ws.filter((w) => !w["ended_at"] || String(w["ended_at"]) >= l.since! || String(w["started_at"] ?? "") >= l.since!);
    const limit = l.limit ?? (l.all ? LIST_ALL_DEFAULT : undefined);
    if (limit !== undefined) ws = ws.slice(-limit);
    if (!why) return ws;
    return ws.length > 0 ? ws.map((w) => ({ ...w, unreachable: why })) : [{ laptop, unreachable: why }];
  };
  /** What a tool answered from a copy says (§5): why the target wasn't asked, and how old the copy is. */
  const fromCopy = (r: Record<string, unknown>) => (r["from_copy"] ? { note: `${String(r["from_copy"])}: this is its copy as of ${String(r["as_of"])}` } : {});
  return {
    spawn_worker: async (a) => {
      const s = Spawn.parse(a);
      if (!sup.isHere(s.laptop)) {
        if (opts.lead) here(s.laptop, "spawn_worker");
        const laptop = s.laptop!;
        // Never a path, a session or a lead to another laptop (§3): refused here, before anything is sent.
        if (s.handoff) throw new SupervisorError(`handoff isn't sent to another laptop: a path names nothing on ${laptop}; put what the worker needs in task`);
        if (s.resume_session) throw new SupervisorError(`resume_session isn't sent to another laptop: a spawn on ${laptop} starts fresh`);
        if (s.as === "lead") throw new SupervisorError(`a lead isn't spawned on another laptop; ${laptop}'s own orchestrator spawns its leads`);
        const r = await sup.remoteCall(laptop, {
          v: 2,
          op: "spawn",
          project: s.project,
          role: s.role,
          task: s.task,
          ...(s.tasks ? { tasks: s.tasks } : {}),
          ...(s.session !== undefined ? { session: s.session ? { feature: s.session.feature, kind: s.session.kind, ...(s.session.label ? { label: s.session.label } : {}) } : null } : {}),
          ...(s.model ? { model: s.model } : {}),
          ...(s.effort ? { effort: s.effort } : {}),
          by: sup.orchestratorOf(s.project),
        });
        const c = sup.remoteCopy(laptop, String((r["worker"] as Record<string, unknown>)["id"]));
        return { ...(c ? sup.copyRow(c) : remoteRow(r["worker"], laptop, r.as_of)), ...found(r, laptop, "the worker this spawn made") };
      }
      return sup.spawnJoined({
        project: s.project,
        role: s.role,
        task: s.task,
        ...(s.tasks ? { tasks: s.tasks } : {}),
        ...(s.session !== undefined ? { session: s.session ? { feature: s.session.feature, kind: s.session.kind, ...(s.session.label ? { label: s.session.label } : {}) } : null } : {}),
        ...(s.handoff ? { handoff: s.handoff } : {}),
        ...(s.resume_session ? { resume_session: s.resume_session } : {}),
        ...(s.model ? { model: s.model } : {}),
        ...(s.effort ? { effort: s.effort } : {}),
        ...(s.as ? { as: s.as } : {}),
        ...(opts.lead ? { spawnedBy: opts.lead } : {}),
      });
    },
    stop_worker: async (a) => {
      const x = WorkerId.parse(a);
      const laptop = where(x.id, x.laptop, "stop_worker");
      if (laptop === null) return sup.stop(notSelf(x.id, "stop"));
      const r = await sup.remoteCall(laptop, { v: 2, op: "stop", id: x.id });
      const w = r["worker"] as Record<string, unknown>;
      // A stop that races the worker's own end is common (§5): it is reported as ended, not an error.
      return { ...remoteRow(w, laptop, r.as_of), ...found(r, laptop, `it ${w["state"]}`), ...(r["already_ended"] ? { already_ended: true, note: `${x.id} had already ended (${w["state"]}) on ${laptop}` } : {}) };
    },
    reset_worker: (a) => {
      const r = Reset.parse(a);
      here(r.laptop, "reset_worker");
      return sup.reset(notSelf(r.id, "reset"), { ...(r.model ? { model: r.model } : {}), ...(r.effort ? { effort: r.effort } : {}) }, opts.lead);
    },
    list_workers: async (a) => {
      const l = ListArgs.parse(a);
      const local = () => sup.list(l.project, l.all, { ...(l.limit ? { limit: l.limit } : {}), ...(l.since ? { since: l.since } : {}) });
      if (l.laptop === "*") {
        const rows: Array<Record<string, unknown>> = local().map((w) => ({ ...w, laptop: sup.laptopName }));
        if (opts.lead) return rows;
        // All at once, so a silent laptop costs one wait; one that can't be asked says why, in its place.
        const lists = await Promise.all(sup.remoteLaptops().map((laptop) => remoteList(laptop, l).catch((err: Error) => [{ laptop, unreachable: err.message }])));
        for (const list of lists) rows.push(...list);
        return rows;
      }
      if (sup.isHere(l.laptop)) return local();
      if (opts.lead) here(l.laptop, "list_workers");
      return remoteList(l.laptop!, l);
    },
    worker_status: async (a) => {
      const s = StatusArgs.parse(a);
      const laptop = where(s.id, s.laptop, "worker_status");
      if (laptop === null) return sup.status(s.id, s.full);
      const r = await sup.remoteCall(laptop, { v: 2, op: "status", id: s.id }, { copy: s.id });
      // The copy, once the reply is in it: only forward, its url kept (§7).
      const c = sup.remoteCopy(laptop, s.id);
      return { ...(c ? sup.copyRow(c) : remoteRow(r["worker"], laptop, r.as_of)), ...found(r, laptop, "it"), ...fromCopy(r) };
    },
    tail_worker: async (a) => {
      const t = Tail.parse(a);
      const laptop = where(t.id, t.laptop, "tail_worker");
      if (laptop === null) return sup.tail(t.id, t.n).join("\n") || "(no events yet)";
      const r = await sup.remoteCall(laptop, { v: 2, op: "tail", id: t.id, n: t.n });
      const lines = (r["lines"] as string[]).join("\n") || "(no events yet)";
      return r["truncated"] ? `${lines}\n(cut to fit a message from ${laptop}; ask for fewer lines)` : lines;
    },
    worker_summary: async (a) => {
      const x = WorkerId.parse(a);
      const laptop = where(x.id, x.laptop, "worker_summary");
      if (laptop === null) return sup.summary(x.id);
      const r = await sup.remoteCall(laptop, { v: 2, op: "summary", id: x.id }, { copy: x.id });
      const { from_copy: _f, ...fields } = r;
      // The handoff the copy keeps (§6), where the reply has none.
      return { ...sup.copyHandoff(sup.remoteCopy(laptop, x.id)), ...fields, laptop, ...fromCopy(r) };
    },
    pending_requests: () => sup.pending(),
    request_detail: (a) => sup.requestDetail(Id.parse(a).id),
    answer_request: (a) => {
      const x = AnswerArgs.parse(a);
      if (x.decision === "answer" && !x.answers) throw new AnswerError("decision \"answer\" needs answers");
      // A lead's own requests are Casper's: it never approves its own call.
      if (opts.lead && sup.requestDetail(x.id).worker_id === opts.lead) throw new AnswerError(`${x.id} is your own request; Casper answers it`);
      const answer =
        x.decision === "answer"
          ? { decision: "answer" as const, answers: x.answers!, ...(x.message ? { message: x.message } : {}) }
          : { decision: x.decision, ...(x.message ? { message: x.message } : {}) };
      // Only what was settled: the request's input is already known to whoever answered it.
      const r = sup.answer(x.id, answer, x.user_decided ? "human" : "orchestrator", x.resume);
      return { id: r.request.id, state: r.request.state, decision: r.request.decision, ...(r.resumed ? { resumed: r.resumed.id } : {}) };
    },
    list_projects: () => sup.projects(),
    audit_log: (a) => sup.audit(AuditArgs.parse(a).limit),
    take_slot: (a) => {
      const t = TakeSlot.parse(a);
      here(t.laptop, "take_slot");
      return sup.takeSlot(t.project, t.name, t.label);
    },
    free_slot: (a) => {
      const f = FreeSlot.parse(a);
      here(f.laptop, "free_slot");
      return sup.freeSlot(f.name);
    },
    order_run_queue: (a) => {
      const o = OrderQueue.parse(a);
      here(o.laptop, "order_run_queue");
      return sup.orderRunQueue(o.names);
    },
    run_slots: (a) => {
      here(Here.parse(a).laptop, "run_slots");
      return sup.slotStatus();
    },
  };
}

export const INSTRUCTIONS =
  "Controls the headless workers on this laptop, and with laptop, on another laptop's supervisor. Spawn a fresh worker per story phase; read worker_summary and handoff files, not raw logs. " +
  "Escalations and worker completions arrive as BobNet messages from the supervisor; answer with answer_request. " +
  "Surface to the user anything you can't decide, and every tier-\"human\" request.";

/** Runs one tool, its result or refusal as the tool's text. */
export async function callTool(h: ReturnType<typeof handlers>, name: string, args: unknown): Promise<{ isError?: true; content: Array<{ type: "text"; text: string }> }> {
  const fn = h[name];
  if (!fn) return { isError: true, content: [{ type: "text", text: `Unknown tool ${name}` }] };
  try {
    const result = await fn(args ?? {});
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
}

function mcpServer(sup: Supervisor): Server {
  const server = new Server({ name: "bobnet-supervisor", version: "0.2.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  const h = handlers(sup);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(h, req.params.name, req.params.arguments));
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
