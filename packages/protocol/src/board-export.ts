import { z } from "zod";
import {
  BoardSessionKind,
  BugWhere,
  CiStatus,
  CriterionSection,
  GrantField,
  GrantItems,
  ItemKind,
  ItemRef,
  ItemStatus,
  ItemType,
  ProjectKey,
  QuestionRef,
  ReleaseRef,
  ReleaseStatus,
  SessionRef,
} from "./board.ts";

// The board as one document (ADR 0001 §11): what GET /v1/board/export returns,
// what the nightly backup commits, and what POST /v1/board/import takes. Every
// table of §2 is here as rows, with refs instead of pks; a table that only
// hangs off one record (labels, criteria, options) is nested in that record.
// Documented in docs/board-export-v1.md. A new shape is a new version, and the
// importer reads every version it knows.

export const BOARD_EXPORT_FORMAT = "bobnet-board";

const at = z.string().datetime({ offset: true });
const text = z.string();
const count = z.number().int().nonnegative();
/** Any id an item has had: its ref, or an old one such as Backlog.md's `LAND-1.3`. */
export const ItemAlias = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d{1,6}(\.\d{1,4})*$/);

const Criterion = z.object({
  section: CriterionSection,
  n: z.number().int().positive(),
  text: z.string().min(1),
  evidence: text.nullable(),
  state: z.enum(["open", "checked"]),
  checked_by: text.nullable(),
  checked_at: at.nullable(),
  casper_gate: z.boolean(),
});

const Release = z.object({
  ref: ReleaseRef,
  title: z.string().min(1),
  goal: text.nullable(),
  status: ReleaseStatus,
  ord: z.number().int().nullable(),
  spec_url: text.nullable(),
  closed_at: at.nullable(),
  closed_by: text.nullable(),
});

const Item = z.object({
  ref: ItemRef,
  /** Every other id it has had, which still find it. */
  aliases: z.array(ItemAlias),
  kind: ItemKind,
  type: ItemType,
  status: ItemStatus,
  title: z.string().min(1),
  description: text.nullable(),
  notes: text.nullable(),
  plan: text.nullable(),
  parent: ItemRef.nullable(),
  release: ReleaseRef.nullable(),
  ord: z.number().int().nullable(),
  open_since: at.nullable(),
  archived_at: at.nullable(),
  archive_reason: text.nullable(),
  captured_by: text.nullable(),
  captured_session: SessionRef.nullable(),
  casper_words: text.nullable(),
  capture_id: text.nullable(),
  parent_hint: ItemRef.nullable(),
  bug_where: BugWhere.nullable(),
  blocks_use: z.boolean(),
  found_in: ItemRef.nullable(),
  labels: z.array(z.string().min(1)),
  deps: z.array(ItemRef),
  criteria: z.array(Criterion),
  created_at: at,
  updated_at: at,
});

const Session = z.object({
  feature: ItemRef,
  kind: BoardSessionKind,
  label: z.string().min(1),
  started_at: at,
  ended_at: at.nullable(),
  imported: z.boolean(),
  need: z.enum(["none", "answer", "casper"]).nullable(),
  minors_fixed: count.nullable(),
  summary: text.nullable(),
  handoff_path: text.nullable(),
  handoff_text: text.nullable(),
  commit_sha: text.nullable(),
  closed_by: text.nullable(),
  /** A close's blockers, majors and tasks sent back. */
  tasks: z.array(z.object({ item: ItemRef, role: z.enum(["blocker", "major", "sent_back"]) })),
  /** A close's need: casper questions. */
  waits_on: z.array(QuestionRef),
});

const Question = z.object({
  ref: QuestionRef,
  kind: z.enum(["question", "action"]),
  text: z.string().min(1),
  context: text.nullable(),
  asked_by: z.string(),
  session: SessionRef.nullable(),
  needed_before: z.union([z.object({ item: ItemRef }), z.object({ release: ReleaseRef }), z.object({ text: z.string() })]).nullable(),
  state: z.enum(["open", "answered", "done", "withdrawn"]),
  answer_key: text.nullable(),
  answer_words: text.nullable(),
  answered_by: text.nullable(),
  answered_at: at.nullable(),
  answered_via: z.enum(["dashboard", "conversation"]).nullable(),
  created_at: at,
  options: z.array(z.object({ key: z.string().min(1), text: z.string(), recommended: z.boolean() })),
  holds: z.array(z.union([z.object({ item: ItemRef }), z.object({ session: SessionRef })])),
});

const Run = z.object({
  id: z.string().min(1),
  session: SessionRef.nullable(),
  agent: z.string(),
  role: z.string(),
  laptop: z.string(),
  model: text.nullable(),
  effort: text.nullable(),
  started_at: at,
  ended_at: at.nullable(),
  resumed: z.boolean(),
  input: count,
  output: count,
  cache_read: count,
  cache_write: count,
  calls: count,
  /** Context per call: the blob's uint32s as numbers. */
  ctx: z.array(count).nullable(),
  remote_url: text.nullable(),
  tasks: z.array(ItemRef),
});

const Push = z.object({ repo: z.string(), branch: z.string(), sha: z.string(), worker: z.string(), run: text.nullable(), at });

const CiRun = z.object({
  source: z.string().min(1),
  external_id: z.string().min(1),
  name: z.string(),
  url: text.nullable(),
  repo: text.nullable(),
  branch: text.nullable(),
  sha: text.nullable(),
  laptop: text.nullable(),
  status: CiStatus,
  started_at: at.nullable(),
  ended_at: at.nullable(),
  worker: text.nullable(),
  session: SessionRef.nullable(),
  tasks: z.array(ItemRef),
});

const Grant = z.object({
  agent: z.string().min(1),
  laptop: z.string().min(1),
  role: z.string(),
  read: z.boolean(),
  items: GrantItems,
  fields: z.array(GrantField),
  sessions: z.boolean(),
  questions: z.boolean(),
  admin: z.boolean(),
});

/** The tables an event's record is in. */
export const ExportTable = z.enum(["projects", "releases", "items", "sessions", "questions", "runs", "pushes", "ci_runs", "grants"]);
export type ExportTable = z.infer<typeof ExportTable>;

const Event = z.object({
  /** Its number in the exporting board: what `undo_of` points at. Import numbers events anew. */
  seq: z.number().int().positive(),
  at,
  actor: z.object({
    kind: z.enum(["owner", "agent", "ci", "board"]),
    who: z.string(),
    role: text.nullable(),
    worker: text.nullable(),
    session: SessionRef.nullable(),
  }),
  op: z.string().min(1),
  table: ExportTable,
  /** The record's key as it is now (see `recordKey`); null when the record is gone (a revoked rule). */
  record: text.nullable(),
  /** The record's label when the event was made, as recorded. */
  ref: text.nullable(),
  reason: text.nullable(),
  undo_of: z.number().int().positive().nullable(),
  changes: z.array(z.object({ field: z.string(), old: text.nullable(), new: text.nullable() })),
});

const Project = z.object({
  key: ProjectKey,
  name: z.string().min(1),
  prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/),
  draft_prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/).nullable(),
  lead: text.nullable(),
  po: text.nullable(),
  repos: z.array(z.string().min(1)),
  /** The next number each counter gives. An import sets each past every id it brings, whatever this says. */
  next: z.object({ item: z.number().int().positive(), release: z.number().int().positive(), question: z.number().int().positive(), action: z.number().int().positive() }),
  created_at: at,
  releases: z.array(Release),
  items: z.array(Item),
  sessions: z.array(Session),
  questions: z.array(Question),
  runs: z.array(Run),
  pushes: z.array(Push),
  ci_runs: z.array(CiRun),
  /** The project's own rules; rules for every project are the document's. */
  grants: z.array(Grant),
  events: z.array(Event),
});

export const BoardExportV1 = z.object({
  format: z.literal(BOARD_EXPORT_FORMAT),
  version: z.literal(1),
  exported_at: at,
  /** Where it came from, for the import's event: "BobNet's board", "Backlog.md at helix 922d533a8". */
  source: z.string().max(300).nullable(),
  /** The last event in the exporting board; 0 for a document made from elsewhere. */
  last_event_seq: count,
  /** Rules for every project, and their history. */
  grants: z.array(Grant),
  events: z.array(Event),
  projects: z.array(Project),
});
export type BoardExportV1 = z.infer<typeof BoardExportV1>;
export type ExportProject = BoardExportV1["projects"][number];
export type ExportItem = ExportProject["items"][number];
export type ExportSession = ExportProject["sessions"][number];
export type ExportQuestion = ExportProject["questions"][number];
export type ExportEvent = BoardExportV1["events"][number];
export type ExportGrant = BoardExportV1["grants"][number];

/** Every version the importer reads. */
export const BoardExport = z.discriminatedUnion("version", [BoardExportV1]);
export type BoardExport = z.infer<typeof BoardExport>;

/** What an import answers: per project, what came in and where its counters now start. */
export type BoardImportReply =
  | { ok: true; projects: Array<{ key: string; items: number; events: number; next_item: number }> }
  | { ok: false; code: "invalid" | "conflict" | "forbidden"; message: string };

/** A session's name, the key events use for it: `BOB-2 build 1`. */
export const sessionKey = (s: { feature: string; kind: string; label: string }) => `${s.feature} ${s.kind} ${s.label}`;

/**
 * How an event names its record (`record`), per table: a project by key; a release, item or
 * question by ref; a session by name; a run by id; a push as repo@sha; a CI run as source:id;
 * a rule as agent@laptop.
 */
export const recordKey = {
  push: (p: { repo: string; sha: string }) => `${p.repo}@${p.sha}`,
  ciRun: (c: { source: string; external_id: string }) => `${c.source}:${c.external_id}`,
  grant: (g: { agent: string; laptop: string }) => `${g.agent}@${g.laptop}`,
};
