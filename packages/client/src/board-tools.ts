import { BoardOp, type BoardOpInput, BugWhere, findSecret, HANDOFF_MAX, LIMITS, ItemRef, ItemStatus, QuestionRef, ReleaseRef, SessionRef } from "@bobnet/protocol";
import { z } from "zod";
import type { CaptureInput, CaptureOutcome } from "./capture-queue.ts";

// The board's seven tools (ADR 0001 §8), defined once: the channel client serves
// them to interactive agents and the supervisor to its workers. Each stamps who
// calls through the transport it is given; none takes an identity as an argument.
// Few tools on purpose: every tool's schema costs context on every call.

export interface BoardToolDeps {
  /** Runs one operation as the caller: waits up to 60 s for the broker, then fails saying since when. */
  op: (op: BoardOpInput) => Promise<unknown>;
  /** Queues and sends a capture (§12): never waits on the broker. */
  capture: (input: CaptureInput) => Promise<CaptureOutcome>;
  /** The project a call that names none is about: the caller's only one, or a refusal saying to name it. */
  project: () => Promise<string>;
  /** A close's handoff file, read on this laptop. Throws if it may not be read. */
  readHandoff: (path: string) => string;
}

export interface BoardTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (deps: BoardToolDeps, args: Record<string, unknown>) => Promise<unknown>;
}

const projectArg = z.string().optional().describe("Project key, e.g. helix; defaults to your only project.");
/** Operation-specific fields, checked against the board's own schema when called. */
const fields = z.record(z.string(), z.unknown());

const WRITES = ["create", "update", "criteria", "slot", "promote", "archive", "restore", "order"] as const;

async function project(deps: BoardToolDeps, args: Record<string, unknown>): Promise<string> {
  return typeof args["project"] === "string" ? args["project"] : deps.project();
}

/** Parsed here, so a mistake comes back naming the field before anything is sent. */
function checked(op: Record<string, unknown>): BoardOpInput {
  const parsed = BoardOp.safeParse(op);
  if (!parsed.success) {
    throw new Error(`bad_arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || op["op"]} ${i.message}`).join("; ")}`);
  }
  return op as BoardOpInput;
}

/** What a frame leaves a close's handoff text: the frame less the rest of the op, with room for the frame's own fields and a ctx. */
export function handoffBudget(op: Record<string, unknown>): number {
  const rest = Buffer.byteLength(JSON.stringify({ t: "board_op", rid: "0000000000", as: "x".repeat(32), op: { ...op, handoff: { path: (op["handoff"] as { path: string }).path, text: "" } } }));
  return LIMITS.frameBytes - rest - 2 * 1024;
}

/** A frame stays under 64 KB: a handoff longer than what fits is cut at its end, and says so. */
export function fitHandoff(text: string, budget = LIMITS.frameBytes - 8 * 1024): string {
  const size = (t: string) => Buffer.byteLength(JSON.stringify(t));
  if (size(text) <= budget && text.length <= HANDOFF_MAX) return text;
  const note = "\n\n[… cut here: the rest didn't fit the board's frame; the file has it all]";
  let lo = 0;
  let hi = Math.min(text.length, HANDOFF_MAX - note.length);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(text.slice(0, mid) + note) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + note;
}

export const BOARD_TOOLS: BoardTool[] = [
  {
    name: "board_list",
    description:
      "List the board: of releases (the project's), features (a release's, or release null for none), tasks (a feature's) or backlog (the triage list). " +
      "Summaries with counts; pass cursor for the next 100.",
    shape: {
      project: projectArg,
      of: z.enum(["releases", "features", "tasks", "backlog"]),
      release: ReleaseRef.nullable().optional(),
      feature: ItemRef.optional(),
      status: ItemStatus.optional(),
      type: z.enum(["increment", "task", "spike", "bug", "chore"]).optional(),
      label: z.string().optional(),
      text: z.string().optional().describe("Matches title or description."),
      archived: z.boolean().optional(),
      cursor: z.string().optional(),
    },
    run: async (deps, a) => deps.op(checked({ ...a, op: "list", project: await project(deps, a) })),
  },
  {
    name: "board_get",
    description:
      "One record in full: an item, release, question (Q-n) or action (A-n) by ref, or a session by {feature, kind, label} with its close, tasks moved, runs and tokens. history: true adds its events.",
    shape: { project: projectArg, ref: z.string().optional(), session: SessionRef.optional(), history: z.boolean().optional() },
    run: async (deps, a) => deps.op(checked({ ...a, op: "get", project: await project(deps, a) })),
  },
  {
    name: "board_capture",
    description:
      "Capture something to triage: a title and a sentence. Anyone may, into any project. Never waits: it is queued on this laptop and sent, " +
      "and answers its id if the board is there, else that it is queued. casper_words: what Casper said, verbatim.",
    shape: {
      project: projectArg,
      title: z.string().min(1).max(300),
      sentence: z.string().max(2000).optional(),
      type: z.enum(["task", "spike", "bug", "chore"]).optional(),
      release: ReleaseRef.optional(),
      casper_words: z.string().optional(),
      bug_where: BugWhere.optional(),
      blocks_use: z.boolean().optional(),
      found_in: ItemRef.optional(),
    },
    run: async (deps, a) => {
      const { sentence, project: _, ...rest } = a;
      const input = { ...rest, project: await project(deps, a), ...(typeof sentence === "string" ? { description: sentence } : {}) };
      const op = checked({ ...input, op: "capture", capture_id: "00000000-0000-4000-8000-000000000000" });
      const { op: _op, capture_id: _id, ...capture } = op as Extract<BoardOpInput, { op: "capture" }>;
      return deps.capture(capture);
    },
  },
  {
    name: "board_write",
    description:
      `Change the board, checked against your rights per field. op is one of ${WRITES.join(", ")}; fields are that operation's: ` +
      "create {kind feature|task|backlog, type, title, parent?, description?, criteria?: [{text, section?}], …}; update {ref, set: {status?, title?, description?, notes?, labels?, deps?, parent?, …}, reason?}; " +
      "criteria {ref, change: {action add|edit|check|uncheck, n?, text?, evidence?, reason?}}; slot {ref, feature}; promote {ref}; archive {ref, reason}; restore {ref}; " +
      "order {scope features|backlog, release?, refs}.",
    shape: { project: projectArg, op: z.enum(WRITES), fields },
    run: async (deps, a) => deps.op(checked({ ...(a["fields"] as Record<string, unknown>), op: a["op"], project: await project(deps, a) })),
  },
  {
    name: "board_ask",
    description:
      "Ask Casper a question or an action only he can answer or do: {text, kind?: question|action, context?, options?: [{key, text, recommended?}], holds?: [item refs], " +
      "holds_sessions?, needed_before?: {item}|{release}|{text}}. Or record his answer given in conversation, verbatim: answer {ref, key?, words}.",
    shape: {
      project: projectArg,
      ask: fields.optional(),
      answer: z.object({ ref: QuestionRef, key: z.string().optional(), words: z.string().min(1) }).optional(),
    },
    run: async (deps, a) => {
      if (Boolean(a["ask"]) === Boolean(a["answer"])) throw new Error("bad_arguments: pass ask or answer, one of them");
      const p = await project(deps, a);
      if (a["answer"]) return deps.op(checked({ ...(a["answer"] as Record<string, unknown>), op: "record_answer", project: p }));
      return deps.op(checked({ ...(a["ask"] as Record<string, unknown>), op: "ask", project: p }));
    },
  },
  {
    name: "close_session",
    description:
      "Close a session at its boundary (the lead or session PO). Applies moves as status writes, records findings (tasks of the feature), " +
      "stores the handoff file's text, and closes the feature's open state with its last session. need casper names waits_on (question refs). Tasks moved and tokens come from the board.",
    shape: {
      project: projectArg,
      session: SessionRef,
      need: z.enum(["none", "answer", "casper"]),
      waits_on: z.array(QuestionRef).optional(),
      blockers: z.array(ItemRef).optional(),
      majors: z.array(ItemRef).optional(),
      minors_fixed: z.number().int().nonnegative().optional(),
      sent_back: z.array(ItemRef).optional(),
      moves: z.array(z.object({ task: ItemRef, status: ItemStatus })).optional(),
      summary: z.string().min(1).max(300),
      handoff: z.string().min(1).describe("Path of the handoff file on this laptop."),
      commit: z.string().optional(),
    },
    run: async (deps, a) => {
      const path = a["handoff"] as string;
      const text = deps.readHandoff(path);
      const secret = findSecret(text);
      if (secret) throw new Error(`secret_detected: the handoff holds what looks like a credential (${secret}); take it out and close again`);
      const op = { ...a, op: "close_session", project: await project(deps, a), handoff: { path, text: "" } };
      return deps.op(checked({ ...op, handoff: { path, text: fitHandoff(text, handoffBudget(op)) } }));
    },
  },
  {
    name: "board_grants",
    description: "Read the project's rules: who may write what. With change (an admin's), set one agent's rule {agent, role, read, items, fields, sessions?, questions?, admin?, laptop?}, or revoke: {agent, revoke: true}.",
    shape: { project: projectArg, change: fields.optional() },
    run: async (deps, a) => {
      const p = await project(deps, a);
      const change = a["change"] as Record<string, unknown> | undefined;
      if (!change) return deps.op(checked({ op: "grants", project: p }));
      const { revoke, ...rest } = change;
      return deps.op(checked(revoke ? { op: "revoke", project: p, agent: rest["agent"], ...(rest["laptop"] ? { laptop: rest["laptop"] } : {}) } : { ...rest, op: "grant", project: p }));
    },
  },
];

/** The project a call means when it names none: the only one the caller may read. */
export async function onlyProject(op: BoardToolDeps["op"]): Promise<string> {
  const { projects } = (await op({ op: "projects" })) as { projects: Array<{ key: string }> };
  if (projects.length === 1) return projects[0]!.key;
  throw new Error(`bad_arguments: name the project (${projects.length === 0 ? "you may read none" : projects.map((p) => p.key).join(", ")})`);
}
