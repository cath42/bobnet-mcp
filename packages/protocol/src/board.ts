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
/** A release's id within its project, `R1`. */
export const ReleaseRef = z.string().regex(/^R\d{1,4}$/);
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/);
const laptop = z.string().regex(/^(\*|[A-Za-z][A-Za-z0-9_-]{0,31})$/);
const title = z.string().trim().min(1).max(300);
const text = z.string().max(16 * 1024);
const reason = z.string().trim().min(1).max(500);

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

/** Who makes an operation, as the broker verified it (§4). */
export type BoardCaller =
  | { kind: "owner"; email: string }
  | { kind: "agent"; name: string; laptop: string; ctx: BoardCtx | null };

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
  z.object({ op: z.literal("get"), ...project, ref: z.union([ItemRef, ReleaseRef]), history: z.boolean().optional() }),
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
  /** A spawn into a session (§6): creates it if new and opens its feature. */
  z.object({ op: z.literal("session_join"), ...project, session: SessionRef }),
]);
export type BoardOp = z.infer<typeof BoardOp>;
export type BoardOpInput = z.input<typeof BoardOp>;
export type BoardOpName = BoardOp["op"];

export const BOARD_READS: readonly BoardOpName[] = ["projects", "list", "get", "grants"];

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
  get: { item?: ItemRecord; release?: ReleaseRecord; history?: BoardEvent[] };
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
  session_join: BoardWritten & { created: boolean };
}

export const BoardErrorCode = z.enum(["invalid", "conflict", "forbidden", "unavailable"]);
export type BoardErrorCode = z.infer<typeof BoardErrorCode>;

/** What `Board` answers the broker: the result, and what changed for the broker to push (§8). */
export type BoardReply =
  | { ok: true; result: unknown; changed: { project: string; seq: number; refs: string[] } | null }
  | { ok: false; code: BoardErrorCode; message: string };
