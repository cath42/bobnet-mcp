import { z } from "zod";

// The board service (ADR 0001): every operation once, as `BoardOp`, with the
// records and results it returns. The socket carries it in a `board_op` frame;
// the broker calls its `Board` object with the caller it verified.

// ---------- Closed lists (ADR 0001 §2) ----------

export const ItemKind = z.enum(["feature", "task", "backlog"]);
export type ItemKind = z.infer<typeof ItemKind>;

export const ItemType = z.enum(["increment", "task", "spike", "bug", "chore"]);
export type ItemType = z.infer<typeof ItemType>;

export const ItemStatus = z.enum(["Draft", "Ready", "In Progress", "In Review", "Done"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const ReleaseStatus = z.enum(["planned", "open", "closed"]);
export type ReleaseStatus = z.infer<typeof ReleaseStatus>;

/** A session record's kind. "Other work" is a run with no session, never a kind (§9). */
export const BoardSessionKind = z.enum(["design", "build", "review", "retro"]);
export type BoardSessionKind = z.infer<typeof BoardSessionKind>;

export const CriterionSection = z.enum(["ac", "dod"]);
export type CriterionSection = z.infer<typeof CriterionSection>;

export const BugWhere = z.enum(["staging", "production"]);
export type BugWhere = z.infer<typeof BugWhere>;

/** Which items a grant covers (§5). */
export const GrantItems = z.enum(["all", "open_feature", "not_open_feature", "none"]);
export type GrantItems = z.infer<typeof GrantItems>;

/** Which fields a grant may write: `content` is title, description, notes, plan, type, labels, dependencies and parent. */
export const GrantField = z.enum(["status", "order", "content", "criteria", "triage", "create"]);
export type GrantField = z.infer<typeof GrantField>;

// ---------- Values ----------

export const ProjectKey = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const prefix = z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/);
/** An item's id, `LAND-49`. */
export const ItemRef = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d{1,6}$/);
/** A question's id, `Q-258`, or an action's, `A-17`: no project has prefix Q or A. */
export const QuestionRef = z.string().regex(/^[QA]-\d{1,6}$/);
/** A release's id within its project, `R1`. */
export const ReleaseRef = z.string().regex(/^R\d{1,4}$/);
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/);
const laptop = z.string().regex(/^(\*|[A-Za-z][A-Za-z0-9_-]{0,31})$/);
const title = z.string().trim().min(1).max(300);
const text = z.string().max(16 * 1024);
const reason = z.string().trim().min(1).max(500);
const at = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();
/** A run's id: the supervisor's worker id. */
const runId = z.string().regex(/^[A-Za-z0-9_./-]{1,60}$/);
const sha = z.string().regex(/^[0-9a-f]{7,40}$/);

/** A session by what a spawn declares: the feature, the kind and a label ("3"). */
export const SessionRef = z.object({ feature: ItemRef, kind: BoardSessionKind, label: z.string().trim().min(1).max(40) });
export type SessionRef = z.infer<typeof SessionRef>;

/** What a supervisor says about the worker it speaks for (§4): the board stamps it on every event. */
export const BoardCtx = z.object({
  worker: z.string().min(1).max(40),
  role: z.string().min(1).max(40),
  project: ProjectKey,
  session: SessionRef.nullable(),
  tasks: z.array(ItemRef).max(50),
});
export type BoardCtx = z.infer<typeof BoardCtx>;

/**
 * Who makes an operation, as the broker verified it (§4). `supervisor`: the connection hosts the
 * laptop's pinned supervisor peer, which alone may say `ctx` and make the supervisor's own operations.
 */
export type BoardCaller =
  | { kind: "owner"; email: string }
  | { kind: "agent"; name: string; laptop: string; supervisor: boolean; ctx: BoardCtx | null };

const NewCriterion = z.object({
  text: z.string().trim().min(1).max(1000),
  section: CriterionSection.default("ac"),
  /** Only Casper's acceptance checks it (§2). */
  casper_gate: z.boolean().default(false),
});

/** Fields an item's create or update may set. A task's release is its feature's: set a feature's with `set_release`. */
const ItemFields = z.object({
  type: ItemType,
  title,
  status: ItemStatus,
  description: text.nullable(),
  notes: text.nullable(),
  plan: text.nullable(),
  /** A task's feature. */
  parent: ItemRef,
  /** A backlog item's release, a triage field (board-writes 4). */
  release: ReleaseRef.nullable(),
  labels: z.array(z.string().trim().min(1).max(60)).max(20),
  deps: z.array(ItemRef).max(40),
  /** A backlog item's hint at its feature. */
  parent_hint: ItemRef.nullable(),
  bug_where: BugWhere.nullable(),
  blocks_use: z.boolean(),
  found_in: ItemRef.nullable(),
});

/** Tokens, never money (§9). */
export const TokenTotals = z.object({ input: count, output: count, cache_read: count, cache_write: count });
export type TokenTotals = z.infer<typeof TokenTotals>;

export const CiStatus = z.enum(["queued", "running", "passed", "failed", "cancelled"]);
export type CiStatus = z.infer<typeof CiStatus>;

/** The most context-per-call points a run keeps (§9). */
export const RUN_CTX_MAX = 2000;
/** A handoff's text as a close stores it (§6). */
export const HANDOFF_MAX = 64 * 1024;

const project = { project: ProjectKey };
const item = { project: ProjectKey, ref: ItemRef };

// ---------- Operations (§8) ----------

export const BoardOp = z.discriminatedUnion("op", [
  // Reads
  z.object({ op: z.literal("projects") }),
  z.object({
    op: z.literal("list"),
    ...project,
    /** releases: the project's; features: a release's (or none: `release` null), or all; tasks: a feature's; backlog: the triage list. */
    of: z.enum(["releases", "features", "tasks", "backlog"]),
    release: ReleaseRef.nullable().optional(),
    feature: ItemRef.optional(),
    status: ItemStatus.optional(),
    type: ItemType.optional(),
    label: z.string().max(60).optional(),
    text: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
    cursor: z.string().max(20).optional(),
  }),
  /** One record by `ref` (an item, release, question or action), or a session by `session`. */
  z.object({
    op: z.literal("get"),
    ...project,
    ref: z.union([QuestionRef, ItemRef, ReleaseRef]).optional(),
    session: SessionRef.optional(),
    history: z.boolean().optional(),
  }),
  z.object({ op: z.literal("grants"), ...project }),

  // Writes
  z.object({
    op: z.literal("create_project"),
    key: ProjectKey,
    name: title,
    prefix,
    draft_prefix: prefix.nullable().optional(),
    lead: z.string().max(65).nullable().optional(),
    po: z.string().max(65).nullable().optional(),
    repos: z.array(z.string().min(1).max(200)).max(10).optional(),
  }),
  z.object({
    op: z.literal("create_release"),
    ...project,
    title,
    goal: text.nullable().optional(),
    spec_url: z.string().url().max(500).nullable().optional(),
  }),
  z.object({
    op: z.literal("create"),
    ...project,
    kind: ItemKind,
    ...ItemFields.partial().shape,
    type: ItemType,
    title,
    criteria: z.array(NewCriterion).max(40).optional(),
    reason: reason.optional(),
  }),
  /** `set` names only fields an operation may set: the open feature, for one, is the session operations'. */
  z.object({ op: z.literal("update"), ...item, set: ItemFields.partial().strict(), reason: reason.optional() }),
  z.object({
    op: z.literal("criteria"),
    ...item,
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("add"), ...NewCriterion.shape }),
      z.object({ action: z.literal("edit"), section: CriterionSection.default("ac"), n: z.number().int().positive(), text: NewCriterion.shape.text }),
      z.object({ action: z.literal("check"), section: CriterionSection.default("ac"), n: z.number().int().positive(), evidence: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("uncheck"), section: CriterionSection.default("ac"), n: z.number().int().positive(), reason }),
    ]),
  }),
  /** A backlog item into a feature: it becomes a task. */
  z.object({ op: z.literal("slot"), ...item, feature: ItemRef, reason: reason.optional() }),
  /** A backlog item becomes a feature, in no release until Casper puts it in one. */
  z.object({ op: z.literal("promote"), ...item, reason: reason.optional() }),
  z.object({ op: z.literal("archive"), ...item, reason }),
  z.object({ op: z.literal("restore"), ...item, reason: reason.optional() }),
  /** The whole order of one scope: a release's features (`release` null: features in none), or the triage list. */
  z.object({
    op: z.literal("order"),
    ...project,
    scope: z.enum(["features", "backlog"]),
    release: ReleaseRef.nullable().optional(),
    refs: z.array(ItemRef).min(1).max(1000),
  }),
  /** Casper's gates (§5): a feature's release and the order of releases. */
  z.object({ op: z.literal("set_release"), ...item, release: ReleaseRef.nullable(), reason: reason.optional() }),
  z.object({ op: z.literal("order_releases"), ...project, refs: z.array(ReleaseRef).min(1).max(200) }),
  /** A project's rule for one agent; `project` "*" is every project (owner only). */
  z.object({
    op: z.literal("grant"),
    project: z.union([ProjectKey, z.literal("*")]),
    agent: name,
    laptop: laptop.default("*"),
    role: z.string().trim().min(1).max(40),
    read: z.boolean(),
    items: GrantItems,
    fields: z.array(GrantField).max(GrantField.options.length),
    sessions: z.boolean().default(false),
    questions: z.boolean().default(false),
    admin: z.boolean().default(false),
  }),
  z.object({ op: z.literal("revoke"), project: z.union([ProjectKey, z.literal("*")]), agent: name, laptop: laptop.default("*") }),
  /** Anyone's capture into the triage list (§12): `capture_id` is made where it was captured, so a second send stores nothing. */
  z.object({
    op: z.literal("capture"),
    ...project,
    capture_id: z.string().uuid(),
    title,
    description: text.nullable().optional(),
    type: z.enum(["task", "spike", "bug", "chore"]).default("task"),
    /** Kept only for a caller who may triage; otherwise the capture is stored without it, and says so. */
    release: ReleaseRef.nullable().optional(),
    casper_words: text.nullable().optional(),
    bug_where: BugWhere.nullable().optional(),
    blocks_use: z.boolean().optional(),
    found_in: ItemRef.nullable().optional(),
  }),
  /** The structured session close (§6): applies its moves, stores the handoff's text, clears the open feature with the last open session. */
  z.object({
    op: z.literal("close_session"),
    ...project,
    session: SessionRef,
    need: z.enum(["none", "answer", "casper"]),
    waits_on: z.array(QuestionRef).max(20).default([]),
    blockers: z.array(ItemRef).max(50).default([]),
    majors: z.array(ItemRef).max(50).default([]),
    minors_fixed: count.default(0),
    sent_back: z.array(ItemRef).max(50).default([]),
    moves: z.array(z.object({ task: ItemRef, status: ItemStatus })).max(100).default([]),
    summary: z.string().trim().min(1).max(300),
    /** The handoff file, read on the laptop by the tool: its text is stored, never parsed. */
    handoff: z.object({ path: z.string().min(1).max(500), text: z.string().max(HANDOFF_MAX) }),
    commit: sha.optional(),
  }),
  /** A question or action only Casper can answer or do (§7). */
  z.object({
    op: z.literal("ask"),
    ...project,
    kind: z.enum(["question", "action"]).default("question"),
    text: z.string().trim().min(1).max(4000),
    context: text.nullable().optional(),
    options: z
      .array(z.object({ key: z.string().trim().min(1).max(20), text: z.string().trim().min(1).max(1000), recommended: z.boolean().default(false) }))
      .max(10)
      .default([]),
    /** What it holds up: items, and sessions. */
    holds: z.array(ItemRef).max(20).default([]),
    holds_sessions: z.array(SessionRef).max(10).default([]),
    needed_before: z.union([z.object({ item: ItemRef }), z.object({ release: ReleaseRef }), z.object({ text: z.string().trim().min(1).max(100) })]).optional(),
  }),
  /** Casper's answer given in conversation, verbatim (§7): write-once. */
  z.object({
    op: z.literal("record_answer"),
    ...project,
    ref: QuestionRef,
    key: z.string().trim().min(1).max(20).optional(),
    words: z.string().trim().min(1).max(4000),
  }),

  // The supervisor's own (§6, §9, §10): authorised by the connection, idempotent by key. Who the
  // worker is (its id, which is its run's, its role and its session) comes from the verified ctx.
  /** A spawn into a session (§6): creates it if new and opens its feature. */
  z.object({ op: z.literal("session_join"), ...project, session: SessionRef }),
  z.object({
    op: z.literal("run_start"),
    ...project,
    /** The worker's id, as its ctx says. */
    id: runId,
    model: z.string().max(100).nullable().optional(),
    effort: z.string().max(20).nullable().optional(),
    started_at: at,
    resumed: z.boolean().default(false),
    session: SessionRef.nullable(),
    tasks: z.array(ItemRef).max(50).default([]),
    remote_url: z.string().url().max(500).nullable().optional(),
  }),
  z.object({
    op: z.literal("run_end"),
    ...project,
    id: runId,
    ended_at: at,
    tokens: TokenTotals,
    calls: count,
    /** Context per call, in order. */
    ctx: z.array(z.number().int().nonnegative().max(0xffffffff)).max(RUN_CTX_MAX).default([]),
  }),
  /** What a land pushed (§10), which ties a CI run on that commit to its worker. */
  z.object({
    op: z.literal("push"),
    ...project,
    repo: z.string().min(1).max(200),
    branch: z.string().min(1).max(200),
    sha,
  }),
  /** A run-slot run (§10), reported at its grant and again at its release; external_id is unique to the laptop's run. */
  z.object({
    op: z.literal("slot_run"),
    ...project,
    external_id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    status: CiStatus,
    started_at: at.nullable().optional(),
    ended_at: at.nullable().optional(),
  }),
]);
export type BoardOp = z.infer<typeof BoardOp>;
export type BoardOpInput = z.input<typeof BoardOp>;
export type BoardOpName = BoardOp["op"];

export const BOARD_READS: readonly BoardOpName[] = ["projects", "list", "get", "grants"];
/** The supervisor's own operations, which only its connection makes (§8). */
export const SUPERVISOR_OPS: readonly BoardOpName[] = ["session_join", "run_start", "run_end", "push", "slot_run"];

// ---------- Records ----------

export interface Progress {
  /** Acceptance criteria checked, of total: a task's own, a feature's across its tasks. */
  checked: number;
  total: number;
}

export interface ProjectRecord {
  key: string;
  name: string;
  prefix: string;
  draft_prefix: string | null;
  lead: string | null;
  po: string | null;
  repos: string[];
}

export interface ReleaseRecord {
  ref: string;
  title: string;
  goal: string | null;
  status: ReleaseStatus;
  ord: number | null;
  spec_url: string | null;
  closed_at: string | null;
  closed_by: string | null;
  features: { done: number; total: number };
}

export interface ItemSummary {
  ref: string;
  kind: ItemKind;
  type: ItemType;
  status: ItemStatus;
  title: string;
  parent: string | null;
  release: string | null;
  ord: number | null;
  labels: string[];
  progress: Progress;
  /** A feature's tasks, Done of total. */
  tasks: { done: number; total: number } | null;
  open_since: string | null;
  archived_at: string | null;
}

export interface CriterionRecord {
  section: CriterionSection;
  n: number;
  text: string;
  evidence: string | null;
  state: "open" | "checked";
  checked_by: string | null;
  checked_at: string | null;
  casper_gate: boolean;
}

export interface SessionSummary {
  feature: string;
  kind: BoardSessionKind;
  label: string;
  started_at: string;
  ended_at: string | null;
}

export interface ItemRecord extends ItemSummary {
  description: string | null;
  notes: string | null;
  plan: string | null;
  /** Ids it had before, which still find it. */
  aliases: string[];
  deps: string[];
  criteria: CriterionRecord[];
  archive_reason: string | null;
  parent_hint: string | null;
  bug_where: BugWhere | null;
  blocks_use: boolean;
  found_in: string | null;
  captured_by: string | null;
  casper_words: string | null;
  sessions: SessionSummary[];
  created_at: string;
  updated_at: string;
}

export interface RunRecord {
  id: string;
  agent: string;
  role: string;
  laptop: string;
  model: string | null;
  effort: string | null;
  started_at: string;
  ended_at: string | null;
  resumed: boolean;
  tokens: TokenTotals;
  calls: number;
  tasks: string[];
}

export interface SessionRecord extends SessionSummary {
  imported: boolean;
  close: {
    need: "none" | "answer" | "casper";
    waits_on: string[];
    blockers: string[];
    majors: string[];
    minors_fixed: number;
    sent_back: string[];
    summary: string;
    handoff_path: string | null;
    handoff_text: string | null;
    commit: string | null;
    closed_by: string;
  } | null;
  /** Read from the log (§6): every status event tagged with the session, with the last status each task was left in. */
  tasks_moved: Array<{ task: string; status: ItemStatus }>;
  /** Summed from the session's runs, never declared. */
  tokens: TokenTotals;
  runs: RunRecord[];
}

export interface QuestionRecord {
  ref: string;
  kind: "question" | "action";
  text: string;
  context: string | null;
  asked_by: string;
  session: SessionRef | null;
  needed_before: { item: string } | { release: string } | { text: string } | null;
  options: Array<{ key: string; text: string; recommended: boolean }>;
  holds: string[];
  holds_sessions: SessionRef[];
  state: "open" | "answered" | "done" | "withdrawn";
  answer: { key: string | null; words: string | null; by: string; at: string; via: "dashboard" | "conversation" } | null;
  created_at: string;
}

export interface BoardEvent {
  seq: number;
  at: string;
  actor: { kind: "owner" | "agent" | "ci" | "board"; who: string; role: string | null; worker: string | null; session: SessionRef | null };
  op: string;
  record: { table: string; ref: string | null };
  reason: string | null;
  undo_of: number | null;
  changes: Array<{ field: string; old: string | null; new: string | null }>;
}

export interface GrantRecord {
  project: string;
  agent: string;
  laptop: string;
  role: string;
  read: boolean;
  items: GrantItems;
  fields: GrantField[];
  sessions: boolean;
  questions: boolean;
  admin: boolean;
}

// ---------- Results ----------

export interface BoardWritten {
  /** The record written, and the last event the write made. */
  ref: string | null;
  seq: number;
}

export interface BoardResults {
  projects: { projects: ProjectRecord[] };
  list: { releases?: ReleaseRecord[]; items?: ItemSummary[]; total: number; cursor: string | null };
  get: { item?: ItemRecord; release?: ReleaseRecord; session?: SessionRecord; question?: QuestionRecord; history?: BoardEvent[] };
  grants: { grants: GrantRecord[] };
  create_project: BoardWritten;
  create_release: BoardWritten;
  create: BoardWritten;
  update: BoardWritten;
  criteria: BoardWritten;
  slot: BoardWritten;
  promote: BoardWritten;
  archive: BoardWritten;
  restore: BoardWritten;
  order: BoardWritten;
  set_release: BoardWritten;
  order_releases: BoardWritten;
  grant: BoardWritten;
  revoke: BoardWritten;
  capture: BoardWritten & { duplicate: boolean; dropped: string[] };
  close_session: BoardWritten & { tasks_moved: SessionRecord["tasks_moved"]; tokens: TokenTotals };
  ask: BoardWritten;
  record_answer: BoardWritten;
  session_join: BoardWritten & { created: boolean };
  run_start: BoardWritten & { unknown_tasks: string[] };
  run_end: BoardWritten;
  push: BoardWritten;
  slot_run: BoardWritten;
}

export const BoardErrorCode = z.enum(["invalid", "conflict", "forbidden", "unavailable"]);
export type BoardErrorCode = z.infer<typeof BoardErrorCode>;

/** What `Board` answers the broker: the result, and what changed for the broker to push (§8). */
export type BoardReply =
  | { ok: true; result: unknown; changed: { project: string; seq: number; refs: string[] } | null }
  | { ok: false; code: BoardErrorCode; message: string };
