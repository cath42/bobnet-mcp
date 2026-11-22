import { z } from "zod";
import { SEGMENT } from "./address.ts";

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
export const GrantField = z.enum(["status", "order", "content", "criteria", "triage", "create", "release"]);
export type GrantField = z.infer<typeof GrantField>;

// ---------- Values ----------

export const ProjectKey = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const prefix = z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/);
/** A ref the caller means as the item's own, `LAND-49`, or dotted when imported, `LAND-49.14` (§2, §8). */
export const ItemRef = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d{1,6}(\.\d{1,4})*$/);
/** Any id an item has had: its ref, or an old one it was renumbered from. Same pattern as `ItemRef`; only `get` takes one, and a reply names the ref. */
export const ItemAlias = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d{1,6}(\.\d{1,4})*$/);
/** A question's id, `Q-258`, or an action's, `A-17`: no project has prefix Q or A. */
export const QuestionRef = z.string().regex(/^[QA]-\d{1,6}$/);
/** A release's id within its project, `R1`. */
export const ReleaseRef = z.string().regex(/^R\d{1,4}$/);
const segment = SEGMENT.source.slice(1, -1);
const name = z.string().regex(SEGMENT);
const laptop = z.string().regex(new RegExp(`^(\\*|${segment})$`));
/** Where a project's answers go (§7): an agent's `name@laptop`, never a bare name or the board's own laptop. */
export const PeerAddress = z
  .string()
  .regex(new RegExp(`^${segment}@${segment}$`), "is not name@laptop")
  .refine((a) => a.slice(a.indexOf("@") + 1).toLowerCase() !== BOARD_SENDER.laptop, "is the board's own laptop");
const title = z.string().trim().min(1).max(300);
const text = z.string().max(16 * 1024);
const reason = z.string().trim().min(1).max(500);
const at = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();
/** A run's id: the supervisor's worker id. */
const runId = z.string().regex(/^[A-Za-z0-9_./-]{1,60}$/);
/** A run's Remote Control link: a claude.ai page, as the snapshot's (frames.ts), since the dashboard renders it as an href. */
const remoteUrl = z.string().url().startsWith("https://claude.ai/").max(500);
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
  | {
      kind: "agent";
      name: string;
      laptop: string;
      supervisor: boolean;
      ctx: BoardCtx | null;
      /** The supervisor's projects on the service, as it registered them (§10); set only when `supervisor`. */
      serves?: string[];
    };

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

/** How a run ended (ADR 0005 §3): the supervisor's exit states, and `lost` for a run it didn't see end. */
export const RunOutcome = z.enum(["done", "failed", "stopped", "lost"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

export const CiStatus = z.enum(["queued", "running", "passed", "failed", "cancelled"]);
export type CiStatus = z.infer<typeof CiStatus>;

/** The most context-per-call points a run keeps (§9). */
export const RUN_CTX_MAX = 2000;
/** A run's end reason as the board keeps it (ADR 0005 §3): the supervisor cuts a longer one. */
export const RUN_REASON_MAX = 300;
/** A handoff's text as a close stores it (§6). */
export const HANDOFF_MAX = 64 * 1024;

/** A question's options, what it holds up and what it is needed before (§7): as asked, and as edited. */
const QuestionOptions = z
  .array(z.object({ key: z.string().trim().min(1).max(20), text: z.string().trim().min(1).max(1000), recommended: z.boolean().default(false) }))
  .max(10);
const QuestionHolds = z.array(ItemRef).max(20);
const QuestionHoldsSessions = z.array(SessionRef).max(10);
const NeededBefore = z.union([z.object({ item: ItemRef }), z.object({ release: ReleaseRef }), z.object({ text: z.string().trim().min(1).max(100) })]);

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
    ref: z.union([QuestionRef, ItemAlias, ReleaseRef]).optional(),
    session: SessionRef.optional(),
    history: z.boolean().optional(),
    /** With `history`, a feature's history includes its tasks' events, merged in order (spec: History, With its tasks). */
    with_tasks: z.boolean().optional(),
    /** A session's runs with their context per call (§9): the dashboard's chart asks; an agent's read leaves it out. */
    ctx: z.boolean().optional(),
  }),
  z.object({ op: z.literal("grants"), ...project }),
  /**
   * What waits on Casper (§7), across every project the caller reads, or one: derived on read, never
   * stored. `since` starts "answered from here today" (his day, which only the dashboard knows; UTC
   * midnight by default).
   */
  z.object({ op: z.literal("waits"), project: ProjectKey.optional(), since: at.optional() }),
  /** One row per project the caller reads, or one: its release, open features, next Ready feature and backlog. */
  z.object({ op: z.literal("overview"), project: ProjectKey.optional() }),
  /**
   * What happened over a span (ADR 0005 §2), across every project the caller reads, or one: derived on
   * read, never stored. `since` is clamped to the last 31 days, and the reply says what it used.
   */
  z.object({ op: z.literal("status"), project: ProjectKey.optional(), since: at }),

  // Writes
  z.object({
    op: z.literal("create_project"),
    key: ProjectKey,
    name: title,
    prefix,
    draft_prefix: prefix.nullable().optional(),
    lead: PeerAddress.nullable().optional(),
    po: PeerAddress.nullable().optional(),
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
  /**
   * Casper closes a release (§5): every feature in it not Done and not archived goes somewhere, to
   * another release that isn't closed or out of any (`to` null), last in its new release. Undo takes
   * the whole close back.
   */
  z.object({
    op: z.literal("close_release"),
    ...project,
    ref: ReleaseRef,
    moves: z.array(z.object({ feature: ItemRef, to: ReleaseRef.nullable() })).max(200).default([]),
  }),
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
    options: QuestionOptions.default([]),
    /** What it holds up: items, and sessions. */
    holds: QuestionHolds.default([]),
    holds_sessions: QuestionHoldsSessions.default([]),
    needed_before: NeededBefore.optional(),
  }),
  /**
   * Its asker or an admin edits an open question or action (BOB-119): only the fields given change.
   * An option's key stays once set: its text may change and options may be added. An answered or
   * closed one isn't edited. Its history keeps each edit, before and after.
   */
  z.object({
    op: z.literal("edit_question"),
    ...project,
    ref: QuestionRef,
    set: z
      .object({
        text: z.string().trim().min(1).max(4000),
        context: text.nullable(),
        options: QuestionOptions,
        holds: QuestionHolds,
        holds_sessions: QuestionHoldsSessions,
        needed_before: NeededBefore.nullable(),
      })
      .partial()
      .strict(),
    reason: reason.optional(),
  }),
  /** Casper's answer given in conversation, verbatim (§7): write-once. */
  z.object({
    op: z.literal("record_answer"),
    ...project,
    ref: QuestionRef,
    key: z.string().trim().min(1).max(20).optional(),
    words: z.string().trim().min(1).max(4000),
  }),
  /** Casper's answer from the dashboard (§7): an option's key, his words verbatim, or both. Write-once, the owner's alone. */
  z.object({
    op: z.literal("answer_question"),
    ...project,
    ref: QuestionRef,
    key: z.string().trim().min(1).max(20).optional(),
    words: z.string().trim().min(1).max(4000).optional(),
  }),
  /** Casper marks an action done from the dashboard (§7), with an optional note. Write-once, the owner's alone. */
  z.object({ op: z.literal("mark_done"), ...project, ref: QuestionRef, note: z.string().trim().min(1).max(4000).optional() }),
  /**
   * The owner takes back one of his own events, as a new event (§5, §7), within two minutes: his
   * dashboard answer or done mark (the question reopens), a feature's release, or a release's close
   * (the release reopens and its features go back). An order of releases is undone by the inverse order.
   */
  z.object({ op: z.literal("undo"), ...project, seq: z.number().int().positive() }),

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
    remote_url: remoteUrl.nullable().optional(),
  }),
  /**
   * A run's Remote Control link (§9), once the worker has it, which is after its run_start: set once,
   * on a run that exists; a replay, or a run with a link already, changes nothing.
   */
  z.object({
    op: z.literal("run_remote"),
    ...project,
    id: runId,
    remote_url: remoteUrl,
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
    /** How it ended (ADR 0005 §3); left out by a supervisor before it, which reads as unknown. `lost`: tokens unknown, sent as zeros. */
    outcome: RunOutcome.optional(),
    /** The error or the stop reason; none for `done`. */
    reason: z.string().max(RUN_REASON_MAX).nullable().optional(),
  }),
  /** What a land pushed (§10), which ties a CI run on that commit to its worker. */
  z.object({
    op: z.literal("push"),
    ...project,
    repo: z.string().min(1).max(200),
    branch: z.string().min(1).max(200),
    sha,
  }),
  /**
   * A CI run from anywhere (§10), posted to /v1/runs with a CI token at its start and its end: upserted
   * by the token's source and `external_id`. `project` may be left out when `repo` is one project's.
   * A supervisor's gh adapter sends it too, ctx-less, as source github-actions, for a project it serves:
   * the one supervisor operation without a worker, and no precedent for another.
   */
  z.object({
    op: z.literal("ci_run"),
    project: ProjectKey.optional(),
    external_id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    url: z.string().url().max(500).nullable().optional(),
    repo: z.string().min(1).max(200).nullable().optional(),
    branch: z.string().min(1).max(200).nullable().optional(),
    sha: z.string().regex(/^[0-9a-f]{40}$/).nullable().optional(),
    status: CiStatus,
    started_at: at.nullable().optional(),
    ended_at: at.nullable().optional(),
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

export type BoardReadName = "projects" | "list" | "get" | "grants" | "waits" | "overview" | "status";
export const BOARD_READS: readonly BoardOpName[] = ["projects", "list", "get", "grants", "waits", "overview", "status"] satisfies BoardReadName[];
/** The supervisor's own operations, which only its connection makes (§8). */
export const SUPERVISOR_OPS: readonly BoardOpName[] = ["session_join", "run_start", "run_remote", "run_end", "push", "slot_run", "ci_run"];

// ---------- Records ----------

export interface Progress {
  /** Acceptance criteria checked, of total: a task's own; a feature's own and its tasks' (BobNet's features carry their own). */
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
  /** Backlog items that name it as their release (roadmap-view's counts line). */
  backlog?: BacklogCounts;
}

/** A triage list's counts: items not archived, the bugs among them, and the oldest's creation. */
export interface BacklogCounts {
  items: number;
  bugs: number;
  oldest: string | null;
}

/**
 * One thing that waits on Casper (§7, waiting-on-casper 1), derived on read. `blocking`: it holds up a
 * named task, session or feature (notes 22, 35): a question or action with holds or a session waiting
 * on it, a review gate (it holds its item), a bug that blocks use. A session closed on a question is
 * folded onto it (`waiting_sessions`, notes 23).
 */
export interface WaitRecord {
  project: string;
  kind: "question" | "action" | "review_gate" | "bug";
  /** The question's or action's ref, or the item's. */
  ref: string;
  feature: string | null;
  /** The question's text, or the item's title. */
  text: string;
  recommended: { key: string; text: string } | null;
  /** The question's or action's context, whole (≤ 16 KB); null when it has none, and for a review gate or a bug. */
  context: string | null;
  holds: { items: string[]; sessions: SessionRef[] };
  waiting_sessions: SessionRef[];
  needed_before: QuestionRecord["needed_before"];
  /** Who asked, or who captured the bug; null for a review gate. */
  asked_by: string | null;
  /** Since when it waits: asked, captured, or put In Review. */
  since: string;
  blocking: boolean;
  /** A question's or action's edits since it was asked (BOB-119), oldest first; none for a review gate or a bug. An older broker sends no field. */
  edits: QuestionEdit[];
}

/** One edit of an open question or action (BOB-119): the fields it changed, before and after, who, when and why. */
export interface QuestionEdit {
  seq: number;
  at: string;
  /** An agent's `name@laptop`, or the owner's email. */
  by: string;
  reason: string | null;
  changes: Array<{ field: string; old: string | null; new: string | null }>;
}

/** An answer or done mark Casper sent from the dashboard (spec: "Answered from here today"). */
export interface AnsweredRecord {
  project: string;
  ref: string;
  kind: "question" | "action";
  text: string;
  key: string | null;
  words: string | null;
  at: string;
}

/** A project on the overview (spec: Overview, Projects). Who is on a feature now is the snapshot's. */
export interface OverviewRow {
  project: ProjectRecord;
  /** The first open release, by order, and its number in that order (1, 2, 3). */
  release: ReleaseRecord | null;
  release_number: number | null;
  /** Its open features: `open_since` set and not Done (notes 15). */
  open: ItemSummary[];
  /** The next Ready feature that isn't open: by release order, then the board's order. */
  next_ready: ItemSummary | null;
  /** The oldest wait that holds work up, if any. */
  waits_on_you: string | null;
  backlog: BacklogCounts;
  /** Backlog items in no release (the roadmap's "Not in a release" counts line). */
  no_release?: BacklogCounts;
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
  created_at: string;
  /** A backlog item's triage fields, on the triage list's rows (capture 3, 4; spec: Triage); a feature's or task's has none. */
  captured_by?: string | null;
  casper_words?: string | null;
  bug_where?: BugWhere | null;
  blocks_use?: boolean;
  parent_hint?: string | null;
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
  /** Context per call, in tokens, as its run_end reported it (§9); empty while it runs. Only on a `get` with `ctx`. */
  ctx?: number[];
  /** Its Remote Control session, when it ran with one. */
  remote_url: string | null;
  tasks: string[];
  /** How it ended (ADR 0005 §3); null while it runs, and for a run that ended before outcomes: unknown. */
  outcome?: RunOutcome | null;
  outcome_reason?: string | null;
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
  /** CI and run-slot runs tied to it through its workers' pushes or slots (§10), oldest first. */
  ci_runs: CiRunRecord[];
}

/** A CI or run-slot run (§10). `usual_ms`: the median of the last 20 like it that passed, once there are three. */
export interface CiRunRecord {
  source: string;
  external_id: string;
  name: string;
  url: string | null;
  repo: string | null;
  branch: string | null;
  sha: string | null;
  laptop: string | null;
  status: "queued" | "running" | "passed" | "failed" | "cancelled";
  started_at: string | null;
  ended_at: string | null;
  worker: string | null;
  usual_ms: number | null;
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

/** What a project's status page shows over a span (ADR 0005 §2): derived on read, never stored. */
export interface StatusRow {
  project: string;
  name: string;
  /** The lead's note (BOB-36): null until it ships, and when there is none. */
  note: { text: string; author: string; at: string; newer: { sessions: number; features: number; releases: number } } | null;
  /** waitsOf(p), oldest first: the very list the waits read returns. */
  waits: WaitRecord[];
  done: {
    /** Whole numbers, before any list is cut. */
    counts: { features: number; sessions: number; lands: number; releases: number };
    /** Moved to Done in the span and still Done, newest first. */
    features: Array<{ ref: string; title: string; type: ItemType; release: string | null; at: string }>;
    sessions: Array<{
      session: SessionRef;
      ended_at: string;
      need: "none" | "answer" | "casper";
      summary: string;
      closed_by: string;
      /** All the session's runs; `lost`: those of them that ended `lost`, whose tokens are unknown. */
      tokens: TokenTotals;
      lost: number;
      counts: { blockers: number; majors: number; sent_back: number };
    }>;
    releases: Array<{ ref: string; title: string; closed_at: string }>;
  };
  stuck: {
    runs: StatusStuckRun[];
    ci: StatusStuckCi[];
    idle_sessions: Array<{ session: SessionRef; since: string }>;
    idle_features: Array<{ ref: string; title: string; since: string }>;
    answered_holding: StatusAnsweredHolding[];
    /** Stuck and settled, both in the span, newest settled first; `entry` as its list shows it. */
    settled: Array<
      | { kind: "runs"; entry: StatusStuckRun; settled_at: string }
      | { kind: "ci"; entry: StatusStuckCi; settled_at: string }
      | { kind: "answered_holding"; entry: StatusAnsweredHolding; settled_at: string }
    >;
  };
  /** BOB-35's theme groups: null until it ships. */
  recurring: unknown | null;
  backlog: {
    /** Ready features with criteria, in next_ready's order. */
    ready: Array<{ ref: string; title: string; release: string | null; criteria: number }>;
    sessions_estimate: number | null;
    /** Features not Done, not archived, with no criteria. */
    no_criteria: Array<{ ref: string; title: string }>;
    triage: { count: number; oldest: { ref: string; at: string } | null };
    /** The open release: its features not Done, and those Ready with criteria. */
    release: { ref: string; todo: number; ready: number } | null;
    thin: boolean;
  };
  usage: {
    /** Runs that ended in the span, lost ones left out. */
    tokens: TokenTotals;
    by_agent: Array<{ agent: string; role: string; tokens: TokenTotals; runs: number; lost: number }>;
    heavy: Array<{ session: SessionRef; tokens: TokenTotals; usual: TokenTotals }>;
    /** Runs that ended in the span with tokens unknown. */
    lost: number;
  };
  /** How many more each cut list had, by its path ("done.sessions"): only lists past 100. */
  more: Record<string, number>;
}

export interface StatusStuckRun {
  id: string;
  agent: string;
  role: string;
  session: SessionRef | null;
  outcome: "failed" | "stopped" | "lost";
  reason: string | null;
  ended_at: string;
  /** The laptop it ran on (`RunRecord.laptop`); absent from an older broker's. */
  laptop?: string;
}

export interface StatusStuckCi {
  source: string;
  name: string;
  branch: string | null;
  sha: string | null;
  url: string | null;
  worker: string | null;
  session: SessionRef | null;
  ended_at: string;
}

export interface StatusAnsweredHolding {
  ref: string;
  answered_at: string;
  feature: string | null;
}

// ---------- Results ----------

export interface BoardWritten {
  /** The record written, and the last event the write made. */
  ref: string | null;
  seq: number;
}

/**
 * Whom an answer's message went to (§7, ADR 0009 §5). `told`: every address it was sent to, the
 * project's supervisor included; empty when nobody was. `waiting`: those of them that weren't online
 * when it was sent. `supervisor`: the supervisor told, or null when none runs the project. The broker
 * sets all three; `waiting` and `supervisor` are absent when the board answers without it.
 */
export interface BoardTold {
  told: string[];
  waiting?: string[];
  supervisor?: string | null;
}

export interface BoardResults {
  projects: { projects: ProjectRecord[] };
  list: { releases?: ReleaseRecord[]; items?: ItemSummary[]; total: number; cursor: string | null };
  get: { item?: ItemRecord; release?: ReleaseRecord; session?: SessionRecord; question?: QuestionRecord; history?: BoardEvent[] };
  grants: { grants: GrantRecord[] };
  /** Oldest first; `answered` newest first, 50 at most. */
  waits: { waits: WaitRecord[]; answered: AnsweredRecord[] };
  overview: { projects: OverviewRow[] };
  /** `at`: the Board's now; `since`: the span's start as it used it. */
  status: { at: string; since: string; projects: StatusRow[] };
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
  close_release: BoardWritten;
  grant: BoardWritten;
  revoke: BoardWritten;
  capture: BoardWritten & { duplicate: boolean; dropped: string[] };
  close_session: BoardWritten & { tasks_moved: SessionRecord["tasks_moved"]; tokens: TokenTotals };
  ask: BoardWritten;
  edit_question: BoardWritten;
  record_answer: BoardWritten & BoardTold;
  answer_question: BoardWritten & BoardTold;
  mark_done: BoardWritten & BoardTold;
  undo: BoardWritten & BoardTold;
  session_join: BoardWritten & { created: boolean };
  run_start: BoardWritten & { unknown_tasks: string[] };
  run_remote: BoardWritten;
  run_end: BoardWritten;
  push: BoardWritten;
  /** `tied`: the worker whose push the run ran on, once known. */
  ci_run: BoardWritten & { tied: string | null };
  slot_run: BoardWritten;
}

export const BoardErrorCode = z.enum(["invalid", "conflict", "forbidden", "unavailable"]);
export type BoardErrorCode = z.infer<typeof BoardErrorCode>;

/** The reserved sender of the board's messages (§7): no laptop may take its laptop id. */
export const BOARD_SENDER = { name: "BobNet", laptop: "board" } as const;

/** Whether a message is the board's (§7): from its reserved laptop, which nobody else may hold, and which takes no reply. */
export function fromBoard(msg: { laptop: string }): boolean {
  return msg.laptop.toLowerCase() === BOARD_SENDER.laptop;
}

/** What `Board` answers the broker: the result, and what changed for the broker to push (§8). An answer's messages are notice rows the broker drains (ADR 0009 §1). */
export type BoardReply =
  | { ok: true; result: unknown; changed: { project: string; seq: number; refs: string[] } | null }
  | { ok: false; code: BoardErrorCode; message: string };
