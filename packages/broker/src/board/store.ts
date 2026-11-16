import {
  addressKey,
  type AnsweredRecord,
  type BacklogCounts,
  type BoardCaller,
  type BoardCtx,
  type BoardEvent,
  type BoardMessage,
  type BoardOp,
  type BoardReadName,
  type BoardResults,
  type BoardWritten,
  type CriterionRecord,
  type GrantField,
  type GrantRecord,
  type OverviewRow,
  type ItemRecord,
  type ItemSummary,
  type ProjectRecord,
  type QuestionRecord,
  type ReleaseRecord,
  type RunOutcome,
  type RunRecord,
  type CiRunRecord,
  type SessionRecord,
  type SessionRef,
  type SessionSummary,
  type StatusAnsweredHolding,
  type StatusRow,
  type StatusStuckCi,
  type StatusStuckRun,
  type WaitRecord,
  type TokenTotals,
  parseRecipient,
} from "@bobnet/protocol";
import { BoardError } from "./errors.ts";
import { Rules, type Scope } from "./rules.ts";

// The operation layer (ADR 0001 §2, §3, §5): every read and write of the board.
// Links are checked here first so a refusal names its reason; the schema's
// constraints are the backstop. Each write runs in the caller's transaction
// and records an event for every record it changes.

const PAGE = 100;
const ORD_STEP = 1000;
/** How long Casper may take back his dashboard answer (§7: the toast's Undo). */
const UNDO_MS = 2 * 60 * 1000;
/** "Answered from here today" lists this many at most. */
const ANSWERED_MAX = 50;
/** How long a write's operation key is kept (§12). */
const OP_KEY_MS = 24 * 60 * 60 * 1000;
/** The status read (ADR 0005 §2): its longest span, its lists' cap, when quiet turns stuck (Peach's default). */
const SPAN_MAX_MS = 31 * 24 * 60 * 60 * 1000;
const STATUS_MAX = 100;
const STUCK_MS = 2 * 60 * 60 * 1000;
/** A heavy session: over twice its kind's median over the 30 days before it, with at least 5 to compare. */
const HEAVY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const HEAVY_MIN = 5;
/** Backlog is thin below this many Ready features with criteria while the open release has work to do. */
const THIN_READY = 2;

type Op<K extends BoardOp["op"]> = Extract<BoardOp, { op: K }>;
/** What a write answers: its record and event, and what the operation adds. */
type Written = BoardResults[Exclude<BoardOp["op"], BoardReadName>];
type Value = string | number | boolean | null | undefined;
type Change = [field: string, old: Value, now: Value];

interface ProjectRow {
  pk: number;
  key: string;
  name: string;
  prefix: string;
  draft_prefix: string | null;
  lead: string | null;
  po: string | null;
  next_item: number;
  next_release: number;
  [k: string]: SqlStorageValue;
}

interface ItemRow {
  pk: number;
  project: number;
  kind: ItemSummary["kind"];
  type: ItemSummary["type"];
  status: ItemSummary["status"];
  title: string;
  description: string | null;
  notes: string | null;
  plan: string | null;
  parent: number | null;
  release: number | null;
  ord: number | null;
  open_since: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  parent_hint: number | null;
  bug_where: ItemRecord["bug_where"];
  blocks_use: number;
  found_in: number | null;
  captured_by: string | null;
  casper_words: string | null;
  created_at: string;
  updated_at: string;
  [k: string]: SqlStorageValue;
}

/** A CI system, by its token's source (§4, §10): it makes `ci_run` and nothing else. */
export interface CiCaller {
  kind: "ci";
  source: string;
  /** The supervisor whose gh adapter reported it, as `<name>@<laptop>`; absent from POST /v1/runs. */
  via?: string;
}
type Caller = BoardCaller | CiCaller;

/** The source a supervisor's gh adapter reports as, whatever its message says (§10). */
const GH_SOURCE = "github-actions";

/** A CI run's statuses that are final: a later start changes nothing. */
const CI_ENDED = new Set(["passed", "failed", "cancelled"]);

/** An event as undo reads it. */
interface UndoneEvent {
  seq: number;
  at: string;
  op: string;
  tbl: string;
  pk: number;
  ref: string | null;
  actor_kind: string;
  actor: string;
  [k: string]: SqlStorageValue;
}

interface CiRunRow {
  pk: number;
  project: number;
  source: string;
  external_id: string;
  name: string;
  laptop: string | null;
  status: CiRunRecord["status"];
  url: string | null;
  repo: string | null;
  branch: string | null;
  sha: string | null;
  started_at: string | null;
  ended_at: string | null;
  worker: string | null;
  [k: string]: SqlStorageValue;
}

interface ReleaseRow {
  pk: number;
  ref: string;
  title: string;
  goal: string | null;
  status: ReleaseRecord["status"];
  ord: number | null;
  spec_url: string | null;
  closed_at: string | null;
  closed_by: string | null;
  [k: string]: SqlStorageValue;
}

interface SessionRow {
  pk: number;
  project: number;
  feature: number;
  kind: SessionSummary["kind"];
  label: string;
  started_at: string;
  ended_at: string | null;
  imported: number;
  need: "none" | "answer" | "casper" | null;
  minors_fixed: number | null;
  summary: string | null;
  handoff_path: string | null;
  handoff_text: string | null;
  commit_sha: string | null;
  closed_by: string | null;
  [k: string]: SqlStorageValue;
}

interface QuestionRow {
  pk: number;
  ref: string;
  kind: QuestionRecord["kind"];
  text: string;
  asked_by: string;
  state: QuestionRecord["state"];
  answer_key: string | null;
  answer_words: string | null;
  answered_via: "dashboard" | "conversation" | null;
  [k: string]: SqlStorageValue;
}

interface RunRow {
  pk: number;
  id: string;
  project: number;
  session: number | null;
  agent: string;
  role: string;
  laptop: string;
  model: string | null;
  effort: string | null;
  started_at: string;
  ended_at: string | null;
  resumed: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  calls: number;
  outcome: RunOutcome | null;
  outcome_reason: string | null;
  [k: string]: SqlStorageValue;
}

const TOKENS = "coalesce(sum(input), 0) AS input, coalesce(sum(output), 0) AS output, coalesce(sum(cache_read), 0) AS cache_read, coalesce(sum(cache_write), 0) AS cache_write";

type SummaryRow = ItemRow & {
  ref: string;
  parent_ref: string | null;
  parent_hint_ref: string | null;
  release_ref: string | null;
  labels: string | null;
  ac_total: number;
  ac_checked: number;
  tasks_total: number | null;
  tasks_done: number | null;
};

const SEP = "\u001f";

/** Items as lists show them: counts, never the tasks themselves (board-service 10). */
const SUMMARY = `
  SELECT i.*,
    (SELECT ref FROM item_refs WHERE item = i.pk AND is_primary = 1) AS ref,
    (SELECT ref FROM item_refs WHERE item = i.parent AND is_primary = 1) AS parent_ref,
    (SELECT ref FROM item_refs WHERE item = i.parent_hint AND is_primary = 1) AS parent_hint_ref,
    (SELECT ref FROM releases WHERE pk = coalesce(i.release, (SELECT f.release FROM items f WHERE f.pk = i.parent))) AS release_ref,
    (SELECT group_concat(label, char(31)) FROM (SELECT label FROM item_labels WHERE item = i.pk ORDER BY label)) AS labels,
    (SELECT count(*) FROM criteria c WHERE c.item = i.pk AND c.section = 'ac')
      + CASE WHEN i.kind = 'feature'
        THEN (SELECT count(*) FROM criteria c JOIN items t ON t.pk = c.item WHERE t.parent = i.pk AND t.archived_at IS NULL AND c.section = 'ac')
        ELSE 0 END AS ac_total,
    (SELECT count(*) FROM criteria c WHERE c.item = i.pk AND c.section = 'ac' AND c.state = 'checked')
      + CASE WHEN i.kind = 'feature'
        THEN (SELECT count(*) FROM criteria c JOIN items t ON t.pk = c.item WHERE t.parent = i.pk AND t.archived_at IS NULL AND c.section = 'ac' AND c.state = 'checked')
        ELSE 0 END AS ac_checked,
    CASE WHEN i.kind = 'feature' THEN (SELECT count(*) FROM items t WHERE t.parent = i.pk AND t.archived_at IS NULL) END AS tasks_total,
    CASE WHEN i.kind = 'feature' THEN (SELECT count(*) FROM items t WHERE t.parent = i.pk AND t.archived_at IS NULL AND t.status = 'Done') END AS tasks_done
  FROM items i`;

const ORDERED = "ORDER BY i.ord IS NULL, i.ord, i.pk";

export class BoardStore {
  private readonly rules: Rules;

  constructor(private readonly sql: SqlStorage) {
    this.rules = new Rules(sql);
  }

  // ---------- Reads ----------

  read(caller: BoardCaller, op: Op<BoardReadName>): BoardResults[BoardReadName] {
    switch (op.op) {
      case "projects":
        return this.projects(caller);
      case "list":
        return this.list(caller, op);
      case "get":
        return this.get(caller, op);
      case "grants":
        return this.grants(caller, op.project);
      case "waits":
        return this.waits(caller, op);
      case "overview":
        return this.overview(caller, op);
      case "status":
        return this.status(caller, op);
    }
  }

  private projects(caller: BoardCaller): BoardResults["projects"] {
    const readable = this.rules.readable(caller);
    const rows = this.sql.exec<ProjectRow>("SELECT * FROM projects ORDER BY key").toArray();
    return { projects: rows.filter((p) => readable === null || readable.has(p.pk)).map((p) => this.projectRecord(p)) };
  }

  private projectRecord(p: ProjectRow): ProjectRecord {
    const repos = this.sql.exec<{ repo: string }>("SELECT repo FROM project_repos WHERE project = ? ORDER BY repo", p.pk).toArray();
    return { key: p.key, name: p.name, prefix: p.prefix, draft_prefix: p.draft_prefix, lead: p.lead, po: p.po, repos: repos.map((r) => r.repo) };
  }

  private list(caller: BoardCaller, op: Op<"list">): BoardResults["list"] {
    const p = this.readable(caller, op.project);
    const offset = op.cursor ? Number.parseInt(op.cursor, 10) || 0 : 0;
    if (op.of === "releases") {
      const rows = this.sql.exec<ReleaseRow>("SELECT * FROM releases WHERE project = ? ORDER BY ord IS NULL, ord, pk", p.pk).toArray();
      const page = rows.slice(offset, offset + PAGE);
      return { releases: page.map((r) => this.releaseRecord(r)), total: rows.length, cursor: offset + PAGE < rows.length ? String(offset + PAGE) : null };
    }

    const where = ["i.project = ?"];
    const args: SqlStorageValue[] = [p.pk];
    const kind = op.of === "features" ? "feature" : op.of === "tasks" ? "task" : "backlog";
    where.push("i.kind = ?");
    args.push(kind);
    if (op.of === "tasks") {
      if (!op.feature) throw new BoardError("invalid", "Listing tasks names their feature");
      where.push("i.parent = ?");
      args.push(this.feature(p, op.feature).pk);
    }
    if (op.release !== undefined && op.of !== "tasks") {
      if (op.release === null) where.push("i.release IS NULL");
      else {
        where.push("i.release = ?");
        args.push(this.release(p, op.release).pk);
      }
    }
    where.push(op.archived ? "i.archived_at IS NOT NULL" : "i.archived_at IS NULL");
    if (op.status) {
      where.push("i.status = ?");
      args.push(op.status);
    }
    if (op.type) {
      where.push("i.type = ?");
      args.push(op.type);
    }
    if (op.label) {
      where.push("EXISTS (SELECT 1 FROM item_labels l WHERE l.item = i.pk AND l.label = ?)");
      args.push(op.label);
    }
    if (op.text) {
      const like = `%${op.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push("(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    const clause = where.join(" AND ");
    const total = this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM items i WHERE ${clause}`, ...args).one().n;
    const rows = this.sql.exec<SummaryRow>(`${SUMMARY} WHERE ${clause} ${ORDERED} LIMIT ? OFFSET ?`, ...args, PAGE, offset).toArray();
    return { items: rows.map(summary), total, cursor: offset + PAGE < total ? String(offset + PAGE) : null };
  }

  private get(caller: BoardCaller, op: Op<"get">): BoardResults["get"] {
    const p = this.readable(caller, op.project);
    if ((op.ref === undefined) === (op.session === undefined)) throw new BoardError("invalid", "get takes a ref or a session, one of them");
    if (op.session) {
      const s = this.session(p, op.session);
      return { session: this.sessionRecord(s, op.ctx === true), ...(op.history ? { history: this.history("sessions", s.pk) } : {}) };
    }
    if (op.ref === undefined) throw new BoardError("invalid", "get takes a ref or a session");
    if (/^[QA]-\d+$/.test(op.ref)) {
      const q = this.question(p, op.ref);
      return { question: this.questionRecord(q.pk), ...(op.history ? { history: this.history("questions", q.pk) } : {}) };
    }
    if (/^R\d+$/.test(op.ref)) {
      const r = this.release(p, op.ref);
      return { release: this.releaseRecord(r), ...(op.history ? { history: this.history("releases", r.pk) } : {}) };
    }
    const row = this.item(p, op.ref);
    return { item: this.itemRecord(row), ...(op.history ? { history: this.itemHistory(p, row, op.with_tasks === true) } : {}) };
  }

  /**
   * An item's events. One that came over in an import with no history of its own (a Backlog.md import
   * brings none) starts with its project's import, so the history says where it begins (BOB-14 #5).
   * `withTasks`: a feature's own events and its tasks', in the order they happened (spec: History, With its tasks).
   */
  private itemHistory(p: ProjectRow, row: ItemRow, withTasks: boolean): BoardEvent[] {
    const own = this.history("items", row.pk);
    const tasks = withTasks && row.kind === "feature" ? this.sql.exec<{ pk: number }>("SELECT pk FROM items WHERE parent = ? ORDER BY pk", row.pk).toArray() : [];
    const events = tasks.length ? [...own, ...tasks.flatMap((t) => this.history("items", t.pk))].sort((a, b) => a.seq - b.seq) : own;
    if (own.some((e) => e.op === "create" || e.op === "capture")) return events;
    const imp = this.sql.exec<{ seq: number }>("SELECT seq FROM events WHERE tbl = 'projects' AND pk = ? AND op = 'import' ORDER BY seq LIMIT 1", p.pk).toArray()[0];
    return imp ? [...this.history("projects", p.pk).filter((e) => e.seq === imp.seq), ...events] : events;
  }

  private itemRecord(row: ItemRow): ItemRecord {
    const s = summary(this.sql.exec<SummaryRow>(`${SUMMARY} WHERE i.pk = ?`, row.pk).one());
    const criteria = this.sql
      .exec<{ section: "ac" | "dod"; ord: number; text: string; evidence: string | null; state: "open" | "checked"; checked_by: string | null; checked_at: string | null; casper_gate: number }>(
        "SELECT * FROM criteria WHERE item = ? ORDER BY section, ord",
        row.pk,
      )
      .toArray()
      .map((c): CriterionRecord => ({ section: c.section, n: c.ord, text: c.text, evidence: c.evidence, state: c.state, checked_by: c.checked_by, checked_at: c.checked_at, casper_gate: c.casper_gate === 1 }));
    const refs = (sql: string) => this.sql.exec<{ ref: string }>(sql, row.pk).toArray().map((r) => r.ref);
    const sessions = row.kind === "feature" ? this.sessionsOf(row.pk, s.ref) : [];
    return {
      ...s,
      description: row.description,
      notes: row.notes,
      plan: row.plan,
      aliases: refs("SELECT ref FROM item_refs WHERE item = ? AND is_primary = 0 ORDER BY ref"),
      deps: refs("SELECT r.ref FROM item_deps d JOIN item_refs r ON r.item = d.dep AND r.is_primary = 1 WHERE d.item = ? ORDER BY d.dep"),
      criteria,
      archive_reason: row.archive_reason,
      parent_hint: row.parent_hint === null ? null : this.refOf(row.parent_hint),
      bug_where: row.bug_where,
      blocks_use: row.blocks_use === 1,
      found_in: row.found_in === null ? null : this.refOf(row.found_in),
      captured_by: row.captured_by,
      casper_words: row.casper_words,
      sessions,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private sessionsOf(feature: number, ref: string): SessionSummary[] {
    return this.sql
      .exec<{ kind: SessionSummary["kind"]; label: string; started_at: string; ended_at: string | null }>(
        "SELECT kind, label, started_at, ended_at FROM sessions WHERE feature = ? ORDER BY started_at, pk",
        feature,
      )
      .toArray()
      .map((s) => ({ feature: ref, ...s }));
  }

  private releaseRecord(r: ReleaseRow): ReleaseRecord {
    const counts = this.sql
      .exec<{ total: number; done: number | null }>(
        "SELECT count(*) AS total, sum(status = 'Done') AS done FROM items WHERE release = ? AND kind = 'feature' AND archived_at IS NULL",
        r.pk,
      )
      .one();
    return {
      ref: r.ref,
      title: r.title,
      goal: r.goal,
      status: r.status,
      ord: r.ord,
      spec_url: r.spec_url,
      closed_at: r.closed_at,
      closed_by: r.closed_by,
      features: { done: counts.done ?? 0, total: counts.total },
      backlog: this.backlogCounts("release = ?", r.pk),
    };
  }

  /** Backlog items not archived, matching `where`; its bugs are the open ones, not Done. */
  private backlogCounts(where: string, ...args: SqlStorageValue[]): BacklogCounts {
    const c = this.sql
      .exec<{ items: number; bugs: number | null; oldest: string | null }>(
        `SELECT count(*) AS items, sum(type = 'bug' AND status <> 'Done') AS bugs, min(created_at) AS oldest FROM items WHERE kind = 'backlog' AND archived_at IS NULL AND ${where}`,
        ...args,
      )
      .one();
    return { items: c.items, bugs: c.bugs ?? 0, oldest: c.oldest };
  }

  /** The projects a cross-project read covers: the one named, or every one the caller reads. */
  private readableProjects(caller: BoardCaller, key: string | undefined): ProjectRow[] {
    if (key !== undefined) return [this.readable(caller, key)];
    const readable = this.rules.readable(caller);
    return this.sql
      .exec<ProjectRow>("SELECT * FROM projects ORDER BY key")
      .toArray()
      .filter((p) => readable === null || readable.has(p.pk));
  }

  /** What waits on Casper (§7), oldest first, and what he answered from here since `since`. */
  private waits(caller: BoardCaller, op: Op<"waits">): BoardResults["waits"] {
    const projects = this.readableProjects(caller, op.project);
    const waits = projects.flatMap((p) => this.waitsOf(p)).sort(oldestFirst);
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const since = op.since === undefined ? midnight.toISOString() : new Date(op.since).toISOString();
    const keys = new Map(projects.map((p) => [p.pk, p.key]));
    const answered =
      projects.length === 0
        ? []
        : this.sql
            .exec<{ project: number; ref: string; kind: AnsweredRecord["kind"]; text: string; answer_key: string | null; answer_words: string | null; answered_at: string }>(
              `SELECT project, ref, kind, text, answer_key, answer_words, answered_at FROM questions
               WHERE project IN (${projects.map(() => "?").join(", ")}) AND answered_via = 'dashboard' AND answered_at >= ?
               ORDER BY answered_at DESC, pk DESC LIMIT ${ANSWERED_MAX}`,
              ...projects.map((p) => p.pk),
              since,
            )
            .toArray()
            .map((q) => ({ project: keys.get(q.project)!, ref: q.ref, kind: q.kind, text: q.text, key: q.answer_key, words: q.answer_words, at: q.answered_at }));
    return { waits, answered };
  }

  /**
   * One project's waits, oldest first: open questions and actions with the sessions closed on them,
   * items In Review with a Casper gate unticked, and backlog bugs that block use. The one definition
   * of a wait and of `blocking`, which Waits and the overview both read.
   */
  private waitsOf(p: ProjectRow): WaitRecord[] {
    const waits: WaitRecord[] = [];
    for (const { pk } of this.sql.exec<{ pk: number }>("SELECT pk FROM questions WHERE project = ? AND state = 'open' ORDER BY pk", p.pk).toArray()) {
      const q = this.questionRecord(pk);
      const waiting = this.sql
        .exec<{ session: number }>("SELECT session FROM session_waits_on WHERE question = ? ORDER BY session", pk)
        .toArray()
        .map((w) => this.sessionRef(w.session)!);
      const held = this.sql.exec<{ item: number }>("SELECT item FROM question_holds WHERE question = ? AND item IS NOT NULL ORDER BY rowid LIMIT 1", pk).toArray()[0];
      const recommended = q.options.find((o) => o.recommended);
      waits.push({
        project: p.key,
        kind: q.kind,
        ref: q.ref,
        feature: q.session?.feature ?? (held ? this.featureRef(held.item) : null) ?? q.holds_sessions[0]?.feature ?? waiting[0]?.feature ?? null,
        text: q.text,
        recommended: recommended ? { key: recommended.key, text: recommended.text } : null,
        // Blank is none (BOB-31 ruling): the dashboard offers Show context exactly when there is one.
        context: q.context?.trim() ? q.context : null,
        holds: { items: q.holds, sessions: q.holds_sessions },
        waiting_sessions: waiting,
        needed_before: q.needed_before,
        asked_by: q.asked_by,
        since: q.created_at,
        blocking: q.holds.length > 0 || q.holds_sessions.length > 0 || waiting.length > 0,
      });
    }
    const gated = this.sql
      .exec<ItemRow>(
        `SELECT * FROM items i WHERE i.project = ? AND i.status = 'In Review' AND i.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM criteria c WHERE c.item = i.pk AND c.casper_gate = 1 AND c.state = 'open')
         ORDER BY i.pk`,
        p.pk,
      )
      .toArray();
    for (const row of gated) {
      const ref = this.refOf(row.pk);
      // Since it went In Review, as its history says; an imported item has only its last update.
      const since = this.sql
        .exec<{ at: string | null }>(
          "SELECT max(e.at) AS at FROM events e JOIN event_changes c ON c.event = e.seq WHERE e.tbl = 'items' AND e.pk = ? AND c.field = 'status' AND c.new = 'In Review'",
          row.pk,
        )
        .one().at;
      waits.push({ ...this.itemWait(p, row, "review_gate"), holds: { items: [ref], sessions: [] }, asked_by: null, since: since ?? row.updated_at });
    }
    const bugs = this.sql
      .exec<ItemRow>("SELECT * FROM items WHERE project = ? AND kind = 'backlog' AND type = 'bug' AND blocks_use = 1 AND archived_at IS NULL AND status != 'Done' ORDER BY pk", p.pk)
      .toArray();
    for (const row of bugs) {
      waits.push({ ...this.itemWait(p, row, "bug"), feature: row.found_in === null ? null : this.refOf(row.found_in), asked_by: row.captured_by, since: row.created_at });
    }
    return waits.sort(oldestFirst);
  }

  private itemWait(p: ProjectRow, row: ItemRow, kind: "review_gate" | "bug"): WaitRecord {
    return {
      project: p.key,
      kind,
      ref: this.refOf(row.pk),
      feature: this.featureRef(row.pk),
      text: row.title,
      recommended: null,
      context: null,
      holds: { items: [], sessions: [] },
      waiting_sessions: [],
      needed_before: null,
      asked_by: null,
      since: row.created_at,
      blocking: true,
    };
  }

  /** The feature an item is or is under, by ref. */
  private featureRef(item: number): string | null {
    const row = this.sql.exec<{ kind: string; parent: number | null }>("SELECT kind, parent FROM items WHERE pk = ?", item).one();
    return row.kind === "feature" ? this.refOf(item) : row.kind === "task" && row.parent !== null ? this.refOf(row.parent) : null;
  }

  /** Each project as the overview shows it: who is on a feature now is the dashboard's, from the snapshots. */
  private overview(caller: BoardCaller, op: Op<"overview">): BoardResults["overview"] {
    return {
      projects: this.readableProjects(caller, op.project).map((p): OverviewRow => {
        const releases = this.sql.exec<ReleaseRow>("SELECT * FROM releases WHERE project = ? ORDER BY ord IS NULL, ord, pk", p.pk).toArray();
        const number = releases.findIndex((r) => r.status === "open");
        const release = releases[number];
        const open = this.sql
          .exec<SummaryRow>(`${SUMMARY} WHERE i.project = ? AND i.kind = 'feature' AND i.open_since IS NOT NULL AND i.status != 'Done' AND i.archived_at IS NULL ${ORDERED}`, p.pk)
          .toArray();
        const ready = this.sql
          .exec<SummaryRow>(
            `${SUMMARY} LEFT JOIN releases rel ON rel.pk = i.release
             WHERE i.project = ? AND i.kind = 'feature' AND i.status = 'Ready' AND i.open_since IS NULL AND i.archived_at IS NULL AND (rel.status IS NULL OR rel.status != 'closed')
             ORDER BY rel.pk IS NULL, rel.ord IS NULL, rel.ord, rel.pk, i.ord IS NULL, i.ord, i.pk LIMIT 1`,
            p.pk,
          )
          .toArray()[0];
        return {
          project: this.projectRecord(p),
          release: release ? this.releaseRecord(release) : null,
          release_number: release ? number + 1 : null,
          open: open.map(summary),
          next_ready: ready ? summary(ready) : null,
          waits_on_you: this.waitsOf(p).find((w) => w.blocking)?.ref ?? null,
          backlog: this.backlogCounts("project = ?", p.pk),
          no_release: this.backlogCounts("project = ? AND release IS NULL", p.pk),
        };
      }),
    };
  }

  /**
   * What happened over a span (ADR 0005 §2), per project the caller reads: what waits on Casper, what got
   * done, what is stuck and what settled, backlog health and usage. Derived on read, never stored; each
   * list stops at 100, and `more` says how many it left out.
   */
  private status(caller: BoardCaller, op: Op<"status">): BoardResults["status"] {
    const now = new Date();
    const at = now.toISOString();
    const asked = new Date(op.since).getTime();
    const since = new Date(Math.min(now.getTime(), Math.max(asked, now.getTime() - SPAN_MAX_MS))).toISOString();
    return { at, since, projects: this.readableProjects(caller, op.project).map((p) => this.statusRow(p, since, now)) };
  }

  private statusRow(p: ProjectRow, since: string, now: Date): StatusRow {
    const more: Record<string, number> = {};
    const cap = <T>(key: string, list: T[]): T[] => {
      if (list.length > STATUS_MAX) more[key] = list.length - STATUS_MAX;
      return list.slice(0, STATUS_MAX);
    };
    const stuckBefore = new Date(now.getTime() - STUCK_MS).toISOString();
    const sessionRefOf = (pk: number | null) => (pk === null ? null : this.sessionRef(pk));

    // What got done: features and bugs moved to Done in the span and still Done, closed sessions, lands, releases.
    const doneFeatures = this.sql
      .exec<{ pk: number; title: string; type: ItemSummary["type"]; release: string | null; at: string | null }>(
        `SELECT i.pk, i.title, i.type,
           (SELECT ref FROM releases WHERE pk = coalesce(i.release, (SELECT f.release FROM items f WHERE f.pk = i.parent))) AS release,
           (SELECT max(e.at) FROM events e JOIN event_changes c ON c.event = e.seq WHERE e.tbl = 'items' AND e.pk = i.pk AND c.field = 'status' AND c.new = 'Done') AS at
         FROM items i WHERE i.project = ? AND (i.kind = 'feature' OR i.type = 'bug') AND i.status = 'Done' AND i.archived_at IS NULL`,
        p.pk,
      )
      .toArray()
      .filter((f): f is typeof f & { at: string } => f.at !== null && f.at >= since)
      .sort((a, b) => b.at.localeCompare(a.at) || b.pk - a.pk)
      .map((f) => ({ ref: this.refOf(f.pk), title: f.title, type: f.type, release: f.release, at: f.at }));
    // Sessions closed since the span's start, and 30 days before it for what a kind's session usually takes.
    const closed = this.sql
      .exec<SessionRow & TokenTotals & { lost: number }>(
        `SELECT s.*, ${TOKENS.replace(/sum\((\w+)\)/g, "sum(r.$1)")}, coalesce(sum(r.outcome = 'lost'), 0) AS lost
         FROM sessions s LEFT JOIN runs r ON r.session = s.pk
         WHERE s.project = ? AND s.ended_at >= ? GROUP BY s.pk ORDER BY s.ended_at DESC, s.pk DESC`,
        p.pk,
        new Date(new Date(since).getTime() - HEAVY_LOOKBACK_MS).toISOString(),
      )
      .toArray();
    const inSpan = closed.filter((s) => s.ended_at! >= since);
    const roles = (session: number) =>
      this.sql.exec<{ role: string; n: number }>("SELECT role, count(*) AS n FROM session_tasks WHERE session = ? GROUP BY role", session).toArray();
    const doneSessions = inSpan.map((s) => {
      const by = new Map(roles(s.pk).map((r) => [r.role, r.n]));
      return {
        session: this.sessionRef(s.pk)!,
        ended_at: s.ended_at!,
        need: s.need!,
        summary: s.summary ?? "",
        closed_by: s.closed_by ?? "",
        tokens: tokensOf(s),
        lost: s.lost,
        counts: { blockers: by.get("blocker") ?? 0, majors: by.get("major") ?? 0, sent_back: by.get("sent_back") ?? 0 },
      };
    });
    const doneReleases = this.sql
      .exec<{ ref: string; title: string; closed_at: string }>(
        "SELECT ref, title, closed_at FROM releases WHERE project = ? AND status = 'closed' AND closed_at >= ? ORDER BY closed_at DESC, pk DESC",
        p.pk,
        since,
      )
      .toArray();
    const lands = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM pushes WHERE project = ? AND at >= ?", p.pk, since).one().n;

    // Stuck: runs that failed, stopped or were lost, until a later run starts in their session (or, with none, of their agent).
    const stuckRuns: StatusStuckRun[] = [];
    const settled: StatusRow["stuck"]["settled"] = [];
    const runs = this.sql
      .exec<RunRow>("SELECT * FROM runs WHERE project = ? AND ended_at >= ? AND outcome IN ('failed', 'stopped', 'lost') ORDER BY ended_at DESC, pk DESC", p.pk, since)
      .toArray();
    for (const r of runs) {
      const later = this.sql
        .exec<{ at: string | null }>(
          r.session === null
            ? "SELECT min(started_at) AS at FROM runs WHERE project = ? AND agent = ? AND pk != ? AND started_at > ?"
            : "SELECT min(started_at) AS at FROM runs WHERE session = ? AND pk != ? AND started_at > ?",
          ...(r.session === null ? [p.pk, r.agent, r.pk, r.started_at] : [r.session, r.pk, r.started_at]),
        )
        .one().at;
      const entry: StatusStuckRun = {
        id: r.id,
        agent: r.agent,
        role: r.role,
        session: sessionRefOf(r.session),
        outcome: r.outcome as StatusStuckRun["outcome"],
        reason: r.outcome_reason,
        ended_at: r.ended_at!,
      };
      if (later === null) stuckRuns.push(entry);
      else if (later >= since) settled.push({ kind: "runs", entry, settled_at: later });
    }

    // CI and slot runs that failed in the span, until a later pass of the same source, name and branch.
    const ci = this.sql
      .exec<CiRunRow>("SELECT * FROM ci_runs WHERE project = ? AND ended_at >= ? AND status IN ('failed', 'passed') ORDER BY ended_at, pk", p.pk, since)
      .toArray();
    const stuckCi: StatusStuckCi[] = [];
    ci.forEach((c, i) => {
      if (c.status !== "failed") return;
      const pass = ci.slice(i + 1).find((d) => d.status === "passed" && d.source === c.source && d.name === c.name && d.branch === c.branch && d.ended_at! > c.ended_at!);
      const entry: StatusStuckCi = {
        source: c.source,
        name: c.name,
        branch: c.branch,
        sha: c.sha,
        url: c.url,
        worker: c.worker,
        session: sessionRefOf((c["session"] as number | null) ?? null),
        ended_at: c.ended_at!,
      };
      if (pass) settled.push({ kind: "ci", entry, settled_at: pass.ended_at! });
      else stuckCi.push(entry);
    });
    stuckCi.reverse();

    // Open sessions with no live run, quiet for over 2 h.
    const idleSessions = this.sql
      .exec<{ pk: number; last: string }>(
        `SELECT s.pk, max(s.started_at, coalesce((SELECT max(r.ended_at) FROM runs r WHERE r.session = s.pk), '')) AS last
         FROM sessions s WHERE s.project = ? AND s.ended_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.session = s.pk AND r.ended_at IS NULL)`,
        p.pk,
      )
      .toArray()
      .filter((s) => s.last < stuckBefore)
      .sort((a, b) => b.last.localeCompare(a.last))
      .map((s) => ({ session: this.sessionRef(s.pk)!, since: s.last }));

    // Features In Progress that no session has open, quiet for over 2 h: since their last session ended, or their last status move.
    const idleFeatures = this.sql
      .exec<{ pk: number; title: string; last: string | null; updated_at: string }>(
        `SELECT i.pk, i.title, i.updated_at,
           coalesce((SELECT max(s.ended_at) FROM sessions s WHERE s.feature = i.pk),
             (SELECT max(e.at) FROM events e JOIN event_changes c ON c.event = e.seq WHERE e.tbl = 'items' AND e.pk = i.pk AND c.field = 'status')) AS last
         FROM items i WHERE i.project = ? AND i.kind = 'feature' AND i.status = 'In Progress' AND i.open_since IS NULL AND i.archived_at IS NULL`,
        p.pk,
      )
      .toArray()
      .map((f) => ({ pk: f.pk, title: f.title, since: f.last ?? f.updated_at }))
      .filter((f) => f.since < stuckBefore)
      .sort((a, b) => b.since.localeCompare(a.since))
      .map((f) => ({ ref: this.refOf(f.pk), title: f.title, since: f.since }));

    // Answered over 2 h ago and still holding: no run on the feature it names since, and not every held item Done.
    const answeredHolding: StatusAnsweredHolding[] = [];
    const answered = this.sql
      .exec<{ pk: number; ref: string; answered_at: string; session: number | null }>(
        `SELECT q.pk, q.ref, q.answered_at, q.session FROM questions q WHERE q.project = ? AND q.state IN ('answered', 'done')
           AND (EXISTS (SELECT 1 FROM question_holds h WHERE h.question = q.pk) OR EXISTS (SELECT 1 FROM session_waits_on w WHERE w.question = q.pk))
         ORDER BY q.answered_at DESC, q.pk DESC`,
        p.pk,
      )
      .toArray();
    for (const q of answered) {
      const holding = new Date(new Date(q.answered_at).getTime() + STUCK_MS).toISOString();
      if (holding > now.toISOString()) continue;
      const features = this.sql
        .exec<{ feature: number | null }>(
          `SELECT CASE WHEN i.kind = 'feature' THEN i.pk ELSE i.parent END AS feature FROM question_holds h JOIN items i ON i.pk = h.item WHERE h.question = ?
           UNION SELECT s.feature FROM question_holds h JOIN sessions s ON s.pk = h.session WHERE h.question = ?
           UNION SELECT s.feature FROM session_waits_on w JOIN sessions s ON s.pk = w.session WHERE w.question = ?`,
          q.pk,
          q.pk,
          q.pk,
        )
        .toArray()
        .flatMap((f) => (f.feature === null ? [] : [f.feature]));
      const ran = features.length
        ? this.sql
            .exec<{ at: string | null }>(
              `SELECT min(r.started_at) AS at FROM runs r JOIN sessions s ON s.pk = r.session WHERE s.feature IN (${features.map(() => "?").join(", ")}) AND r.started_at > ?`,
              ...features,
              q.answered_at,
            )
            .one().at
        : null;
      const held = this.sql
        .exec<{ pk: number; status: string }>("SELECT i.pk, i.status FROM question_holds h JOIN items i ON i.pk = h.item WHERE h.question = ?", q.pk)
        .toArray();
      const allDone =
        held.length > 0 && held.every((i) => i.status === "Done")
          ? held
              .map(
                (i) =>
                  this.sql
                    .exec<{ at: string | null }>(
                      "SELECT max(e.at) AS at FROM events e JOIN event_changes c ON c.event = e.seq WHERE e.tbl = 'items' AND e.pk = ? AND c.field = 'status' AND c.new = 'Done'",
                      i.pk,
                    )
                    .one().at ?? q.answered_at,
              )
              .sort()
              .at(-1)!
          : null;
      const entry: StatusAnsweredHolding = { ref: q.ref, answered_at: q.answered_at, feature: features.length ? this.refOf(features[0]!) : null };
      const settledAt = [ran, allDone].filter((t): t is string => t !== null).sort()[0];
      if (settledAt === undefined) answeredHolding.push(entry);
      else if (settledAt > holding && holding >= since) settled.push({ kind: "answered_holding", entry, settled_at: settledAt });
    }
    settled.sort((a, b) => b.settled_at.localeCompare(a.settled_at));

    // Backlog health: Ready features with criteria in next_ready's order, what has none, triage and the open release.
    const ready = this.sql
      .exec<SummaryRow>(
        `${SUMMARY} LEFT JOIN releases rel ON rel.pk = i.release
         WHERE i.project = ? AND i.kind = 'feature' AND i.status = 'Ready' AND i.open_since IS NULL AND i.archived_at IS NULL AND (rel.status IS NULL OR rel.status != 'closed')
         ORDER BY rel.pk IS NULL, rel.ord IS NULL, rel.ord, rel.pk, i.ord IS NULL, i.ord, i.pk`,
        p.pk,
      )
      .toArray()
      .filter((f) => f.ac_total > 0);
    const noCriteria = this.sql
      .exec<SummaryRow>(
        `${SUMMARY} LEFT JOIN releases rel ON rel.pk = i.release
         WHERE i.project = ? AND i.kind = 'feature' AND i.status != 'Done' AND i.archived_at IS NULL
         ORDER BY rel.pk IS NULL, rel.ord IS NULL, rel.ord, rel.pk, i.ord IS NULL, i.ord, i.pk`,
        p.pk,
      )
      .toArray()
      .filter((f) => f.ac_total === 0);
    const open = this.sql
      .exec<{ pk: number; ref: string }>("SELECT pk, ref FROM releases WHERE project = ? AND status = 'open' ORDER BY ord IS NULL, ord, pk LIMIT 1", p.pk)
      .toArray()[0];
    const release = open
      ? {
          ref: open.ref,
          todo: this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM items WHERE release = ? AND kind = 'feature' AND status != 'Done' AND archived_at IS NULL", open.pk).one().n,
          ready: ready.filter((f) => f.release_ref === open.ref).length,
        }
      : null;
    const triage = this.sql
      .exec<{ pk: number; created_at: string }>("SELECT pk, created_at FROM items WHERE project = ? AND kind = 'backlog' AND archived_at IS NULL ORDER BY created_at, pk", p.pk)
      .toArray();

    // Usage: runs that ended in the span, once each; a lost run's tokens are unknown, so counted apart, never as zero.
    const ended = this.sql
      .exec<RunRow>("SELECT * FROM runs WHERE project = ? AND ended_at >= ? ORDER BY ended_at, pk", p.pk, since)
      .toArray();
    const agents = new Map<string, { agent: string; role: string; tokens: TokenTotals; runs: number; lost: number }>();
    const total = zeroTokens();
    let lost = 0;
    for (const r of ended) {
      const a = agents.get(r.agent) ?? { agent: r.agent, role: r.role, tokens: zeroTokens(), runs: 0, lost: 0 };
      a.role = r.role;
      a.runs++;
      if (r.outcome === "lost") a.lost++, lost++;
      else addTokens(a.tokens, r), addTokens(total, r);
      agents.set(r.agent, a);
    }
    // A session with a lost run has unknown tokens: never heavy, and never in a kind's comparison set.
    const known = closed.filter((s) => s.lost === 0);
    const heavy = known.filter((s) => s.ended_at! >= since).flatMap((s) => {
      const from = new Date(new Date(s.ended_at!).getTime() - HEAVY_LOOKBACK_MS).toISOString();
      const like = known.filter((o) => o.pk !== s.pk && o.kind === s.kind && o.ended_at! < s.ended_at! && o.ended_at! >= from);
      if (like.length < HEAVY_MIN) return [];
      const usual = medianTokens(like.map(tokensOf));
      return sumTokens(tokensOf(s)) > 2 * sumTokens(usual) ? [{ session: this.sessionRef(s.pk)!, tokens: tokensOf(s), usual }] : [];
    });

    return {
      project: p.key,
      name: p.name,
      note: null,
      waits: cap("waits", this.waitsOf(p)),
      done: {
        counts: { features: doneFeatures.length, sessions: doneSessions.length, lands, releases: doneReleases.length },
        features: cap("done.features", doneFeatures),
        sessions: cap("done.sessions", doneSessions),
        releases: cap("done.releases", doneReleases),
      },
      stuck: {
        runs: cap("stuck.runs", stuckRuns),
        ci: cap("stuck.ci", stuckCi),
        idle_sessions: cap("stuck.idle_sessions", idleSessions),
        idle_features: cap("stuck.idle_features", idleFeatures),
        answered_holding: cap("stuck.answered_holding", answeredHolding),
        settled: cap("stuck.settled", settled),
      },
      recurring: null,
      backlog: {
        ready: cap(
          "backlog.ready",
          ready.map((f) => ({ ref: f.ref, title: f.title, release: f.release_ref, criteria: f.ac_total })),
        ),
        sessions_estimate: this.sessionsEstimate(p, ready.length),
        no_criteria: cap(
          "backlog.no_criteria",
          noCriteria.map((f) => ({ ref: f.ref, title: f.title })),
        ),
        triage: { count: triage.length, oldest: triage[0] ? { ref: this.refOf(triage[0].pk), at: triage[0].created_at } : null },
        release,
        thin: ready.length < THIN_READY && release !== null && release.todo > 0,
      },
      usage: {
        tokens: total,
        by_agent: cap(
          "usage.by_agent",
          [...agents.values()].sort((a, b) => sumTokens(b.tokens) - sumTokens(a.tokens) || b.runs - a.runs || a.agent.localeCompare(b.agent)),
        ),
        heavy: cap("usage.heavy", heavy),
        lost,
      },
      more,
    };
  }

  /**
   * About how many sessions the Ready features take: their number times the median sessions per feature
   * over the project's last 20 Done features that had any; null with fewer than 3 to go by.
   */
  private sessionsEstimate(p: ProjectRow, ready: number): number | null {
    const counts = this.sql
      .exec<{ n: number }>(
        `SELECT (SELECT count(*) FROM sessions s WHERE s.feature = i.pk) AS n,
           coalesce((SELECT max(e.at) FROM events e JOIN event_changes c ON c.event = e.seq WHERE e.tbl = 'items' AND e.pk = i.pk AND c.field = 'status' AND c.new = 'Done'), i.updated_at) AS done_at
         FROM items i WHERE i.project = ? AND i.kind = 'feature' AND i.status = 'Done' AND i.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM sessions s WHERE s.feature = i.pk)
         ORDER BY done_at DESC LIMIT 20`,
        p.pk,
      )
      .toArray()
      .map((r) => r.n)
      .sort((a, b) => a - b);
    if (counts.length < 3) return null;
    const mid = Math.floor(counts.length / 2);
    const median = counts.length % 2 ? counts[mid]! : (counts[mid - 1]! + counts[mid]!) / 2;
    return Math.round(ready * median);
  }

  /** A record's events, oldest first, with their changes. */
  private history(table: string, pk: number): BoardEvent[] {
    const events = this.sql
      .exec<{ seq: number; at: string; actor_kind: BoardEvent["actor"]["kind"]; actor: string; role: string | null; worker: string | null; session: number | null; op: string; tbl: string; ref: string | null; reason: string | null; undo_of: number | null }>(
        "SELECT * FROM events WHERE tbl = ? AND pk = ? ORDER BY seq",
        table,
        pk,
      )
      .toArray();
    return events.map((e) => ({
      seq: e.seq,
      at: e.at,
      actor: { kind: e.actor_kind, who: e.actor, role: e.role, worker: e.worker, session: e.session === null ? null : this.sessionRef(e.session) },
      op: e.op,
      record: { table: e.tbl, ref: e.ref },
      reason: e.reason,
      undo_of: e.undo_of,
      changes: this.sql.exec<{ field: string; old: string | null; new: string | null }>("SELECT field, old, new FROM event_changes WHERE event = ? ORDER BY rowid", e.seq).toArray(),
    }));
  }

  private grants(caller: BoardCaller, key: string): BoardResults["grants"] {
    const p = this.readable(caller, key);
    const rows = this.sql
      .exec<{ pk: number; project: number | null; agent: string; laptop: string; role: string; read: number; items: GrantRecord["items"]; sessions: number; questions: number; admin: number }>(
        "SELECT * FROM grants WHERE project IS NULL OR project = ? ORDER BY project IS NOT NULL, agent, laptop",
        p.pk,
      )
      .toArray();
    return {
      grants: rows.map((g) => ({
        project: g.project === null ? "*" : p.key,
        agent: g.agent,
        laptop: g.laptop,
        role: g.role,
        read: g.read === 1,
        items: g.items,
        fields: this.grantFields(g.pk),
        sessions: g.sessions === 1,
        questions: g.questions === 1,
        admin: g.admin === 1,
      })),
    };
  }

  private grantFields(grant: number): GrantField[] {
    return this.sql.exec<{ field: GrantField }>("SELECT field FROM grant_fields WHERE grant_pk = ? ORDER BY field", grant).toArray().map((f) => f.field);
  }

  // ---------- Writes ----------

  /** One write, inside the caller's transaction. Returns its result and what it changed, for the broker to push. */
  write(
    caller: BoardCaller,
    op: Exclude<BoardOp, Op<BoardReadName>>,
  ): { result: Written; changed: { project: string; seq: number; refs: string[] } | null; messages: BoardMessage[] } {
    if (op.op === "ci_run") return this.ciRun(GH_SOURCE, ghRun(caller, op), whoOf(caller));
    const tx = new Tx(this.sql, caller);
    const result = this.apply(tx, op);
    if (tx.seqs.length === 0) return { result: { ...result, seq: this.lastSeq() }, changed: null, messages: [] };
    return { result, changed: { project: tx.projectKey ?? "*", seq: tx.seqs.at(-1)!, refs: [...tx.refs] }, messages: tx.messages };
  }

  /** A CI system's report of one run (§10), from POST /v1/runs: the source is its token's. */
  ciRun(source: string, op: Op<"ci_run">, via?: string): { result: BoardResults["ci_run"]; changed: { project: string; seq: number; refs: string[] } | null; messages: BoardMessage[] } {
    const tx = new Tx<Caller>(this.sql, via === undefined ? { kind: "ci", source } : { kind: "ci", source, via });
    const result = this.reportCi(tx, source, op);
    if (tx.seqs.length === 0) return { result: { ...result, seq: this.lastSeq() }, changed: null, messages: [] };
    return { result, changed: { project: tx.projectKey!, seq: tx.seqs.at(-1)!, refs: [...tx.refs] }, messages: [] };
  }

  /**
   * A write with an operation key (§12): once per key. A repeat by the same actor and op answers the
   * first reply, messages included, and writes nothing; keys last a day. A refused write rolls back,
   * key and all, so its retry is refused again.
   */
  writeOnce(caller: BoardCaller, op: Exclude<BoardOp, Op<BoardReadName>>, key: string): ReturnType<BoardStore["write"]> {
    const at = new Date();
    this.sql.exec("DELETE FROM op_keys WHERE at < ?", new Date(at.getTime() - OP_KEY_MS).toISOString());
    const actor = whoOf(caller);
    const had = this.sql.exec<{ actor: string; op: string; reply: string }>("SELECT actor, op, reply FROM op_keys WHERE key = ?", key).toArray()[0];
    if (had) {
      if (had.actor !== actor || had.op !== op.op) throw new BoardError("invalid", `Operation key ${key} is another write's`);
      return JSON.parse(had.reply) as ReturnType<BoardStore["write"]>;
    }
    const reply = this.write(caller, op);
    this.sql.exec("INSERT INTO op_keys (key, actor, op, at, reply) VALUES (?, ?, ?, ?, ?)", key, actor, op.op, at.toISOString(), JSON.stringify(reply));
    return reply;
  }

  private apply(tx: Tx, op: Exclude<BoardOp, Op<BoardReadName>>): Written {
    switch (op.op) {
      case "create_project":
        return this.createProject(tx, op);
      case "create_release":
        return this.createRelease(tx, op);
      case "create":
        return this.create(tx, op);
      case "update":
        return this.update(tx, op);
      case "criteria":
        return this.criteria(tx, op);
      case "slot":
        return this.slot(tx, op);
      case "promote":
        return this.promote(tx, op);
      case "archive":
      case "restore":
        return this.archive(tx, op);
      case "order":
        return this.order(tx, op);
      case "set_release":
        return this.setRelease(tx, op);
      case "order_releases":
        return this.orderReleases(tx, op);
      case "close_release":
        return this.closeRelease(tx, op);
      case "grant":
        return this.grant(tx, op);
      case "revoke":
        return this.revoke(tx, op);
      case "capture":
        return this.capture(tx, op);
      case "close_session":
        return this.closeSession(tx, op);
      case "ask":
        return this.ask(tx, op);
      case "record_answer":
        return this.recordAnswer(tx, op);
      case "answer_question":
        return this.answerQuestion(tx, op);
      case "mark_done":
        return this.markDone(tx, op);
      case "undo":
        return this.undo(tx, op);
      case "session_join":
        return this.sessionJoin(tx, op);
      case "run_start":
        return this.runStart(tx, op);
      case "run_remote":
        return this.runRemote(tx, op);
      case "run_end":
        return this.runEnd(tx, op);
      case "push":
        return this.push(tx, op);
      case "slot_run":
        return this.slotRun(tx, op);
      case "ci_run":
        throw new BoardError("forbidden", "A CI run is reported by its CI system or a supervisor's gh adapter");
    }
  }

  private createProject(tx: Tx, op: Op<"create_project">): BoardWritten {
    ownerOnly(tx.caller, "Creating a project");
    for (const pre of [op.prefix, op.draft_prefix]) {
      if (pre === "Q" || pre === "A") throw new BoardError("invalid", "Prefixes Q and A are questions' and actions'");
    }
    if (this.sql.exec("SELECT 1 FROM projects WHERE key = ?", op.key).toArray().length > 0) throw new BoardError("conflict", `A project ${op.key} exists`);
    for (const pre of [op.prefix, op.draft_prefix]) {
      if (pre && this.sql.exec("SELECT 1 FROM projects WHERE prefix = ? OR draft_prefix = ?", pre, pre).toArray().length > 0) {
        throw new BoardError("conflict", `A project with prefix ${pre} exists`);
      }
    }
    if (op.prefix === op.draft_prefix) throw new BoardError("invalid", "A project's prefix and draft prefix differ");
    const pk = this.sql
      .exec<{ pk: number }>(
        "INSERT INTO projects (key, name, prefix, draft_prefix, lead, po, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING pk",
        op.key,
        op.name,
        op.prefix,
        op.draft_prefix ?? null,
        op.lead ?? null,
        op.po ?? null,
        tx.at,
      )
      .one().pk;
    for (const repo of new Set(op.repos ?? [])) this.sql.exec("INSERT INTO project_repos (project, repo) VALUES (?, ?)", pk, repo);
    tx.project({ pk, key: op.key });
    const changes: Change[] = [["key", null, op.key], ["name", null, op.name], ["prefix", null, op.prefix], ["draft_prefix", null, op.draft_prefix], ["lead", null, op.lead], ["po", null, op.po]];
    for (const repo of op.repos ?? []) changes.push(["repo", null, repo]);
    return { ref: op.key, seq: tx.event("create_project", "projects", pk, op.key, changes) };
  }

  private createRelease(tx: Tx, op: Op<"create_release">): BoardWritten {
    const p = tx.project(this.project(op.project));
    this.rules.require(tx.caller, p, "create", null, "releases");
    const ref = `R${p.next_release}`;
    this.sql.exec("UPDATE projects SET next_release = next_release + 1 WHERE pk = ?", p.pk);
    const ord = this.nextOrd("SELECT max(ord) AS m FROM releases WHERE project = ?", p.pk);
    const pk = this.sql
      .exec<{ pk: number }>(
        "INSERT INTO releases (project, ref, title, goal, ord, spec_url) VALUES (?, ?, ?, ?, ?, ?) RETURNING pk",
        p.pk,
        ref,
        op.title,
        op.goal ?? null,
        ord,
        op.spec_url ?? null,
      )
      .one().pk;
    const changes: Change[] = [["title", null, op.title], ["goal", null, op.goal], ["status", null, "planned"], ["ord", null, ord], ["spec_url", null, op.spec_url]];
    return { ref, seq: tx.event("create_release", "releases", pk, ref, changes) };
  }

  /** An item's create; a capture's (§12), which anyone may make, as a backlog item that keeps who captured it. */
  private create(tx: Tx, op: Op<"create">, capture?: { id: string; casper_words: string | null }): BoardWritten {
    const p = tx.project(this.project(op.project));
    let parent: ItemRow | null = null;
    let release: ReleaseRow | null = null;
    if (op.kind === "feature") {
      if (op.type !== "increment") throw new BoardError("invalid", "A feature is type increment");
      if (op.parent) throw new BoardError("invalid", "A feature has no parent");
    } else if (op.type === "increment") {
      throw new BoardError("invalid", `Only a feature is type increment; create a ${op.kind} as task, spike, bug or chore`);
    }
    if (op.kind === "task") {
      if (!op.parent) throw new BoardError("invalid", "A task has a feature as its parent");
      if (op.release !== undefined) throw new BoardError("invalid", "A task's release is its feature's");
      parent = this.feature(p, op.parent);
    } else if (op.parent) {
      throw new BoardError("invalid", op.kind === "backlog" ? "A backlog item has no parent; give it a parent_hint, or slot it" : "A feature has no parent");
    }
    if (op.kind !== "backlog" && op.parent_hint) throw new BoardError("invalid", "Only a backlog item has a parent_hint");
    if (op.type !== "bug" && (op.bug_where || op.blocks_use || op.found_in)) throw new BoardError("invalid", "Bug fields are for items of type bug");
    if (op.type === "bug" && op.status === "Done") throw new BoardError("conflict", `A bug is born open: ${BUG_DONE}`);
    const scope = parent ? this.scope(parent) : null;
    const where = parent ? `${scope!.ref}'s tasks` : `${op.kind === "feature" ? "features" : "the backlog"}`;
    if (!capture) this.rules.require(tx.caller, p, "create", scope, where);
    // A create-only grant makes Drafts: an item born further on takes the status right too.
    if (op.status !== undefined && op.status !== "Draft") this.rules.require(tx.caller, p, "status", scope, where);
    if (op.release) {
      release = this.release(p, op.release);
      if (op.kind === "feature") ownerOnly(tx.caller, "Putting a feature in a release");
      else this.rules.require(tx.caller, p, "triage", null, "the backlog");
      openRelease(release);
    }
    const hint = op.parent_hint ? this.feature(p, op.parent_hint) : null;
    const foundIn = op.found_in ? this.feature(p, op.found_in) : null;
    const deps = this.items(p, op.deps ?? []);

    const ref = `${p.prefix}-${p.next_item}`;
    this.sql.exec("UPDATE projects SET next_item = next_item + 1 WHERE pk = ?", p.pk);
    const ord =
      op.kind === "feature"
        ? this.nextOrd(`SELECT max(ord) AS m FROM items WHERE project = ? AND kind = 'feature' AND release ${release ? "= ?" : "IS NULL"}`, p.pk, ...(release ? [release.pk] : []))
        : op.kind === "backlog"
          ? this.nextOrd("SELECT max(ord) AS m FROM items WHERE project = ? AND kind = 'backlog'", p.pk)
          : null;
    const status = op.status ?? "Draft";
    const pk = this.sql
      .exec<{ pk: number }>(
        `INSERT INTO items (project, kind, type, status, title, description, notes, plan, parent, release, ord, parent_hint, bug_where, blocks_use, found_in,
                            captured_by, captured_session, casper_words, capture_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
        p.pk,
        op.kind,
        op.type,
        status,
        op.title,
        op.description ?? null,
        op.notes ?? null,
        op.plan ?? null,
        parent?.pk ?? null,
        release?.pk ?? null,
        ord,
        hint?.pk ?? null,
        op.bug_where ?? null,
        op.blocks_use ? 1 : 0,
        foundIn?.pk ?? null,
        capture ? tx.who : null,
        capture ? tx.sessionPk() : null,
        capture?.casper_words ?? null,
        capture?.id ?? null,
        tx.at,
        tx.at,
      )
      .one().pk;
    this.sql.exec("INSERT INTO item_refs (project, ref, item, is_primary) VALUES (?, ?, ?, 1)", p.pk, ref, pk);

    const changes: Change[] = [
      ["kind", null, op.kind],
      ["type", null, op.type],
      ["status", null, status],
      ["title", null, op.title],
      ["description", null, op.description],
      ["notes", null, op.notes],
      ["plan", null, op.plan],
      ["parent", null, parent ? this.refOf(parent.pk) : null],
      ["release", null, release?.ref],
      ["ord", null, ord],
      ["parent_hint", null, op.parent_hint],
      ["bug_where", null, op.bug_where],
      ["blocks_use", null, op.blocks_use || null],
      ["found_in", null, op.found_in],
    ];
    if (capture) changes.push(["captured_by", null, tx.who], ["casper_words", null, capture.casper_words], ["capture_id", null, capture.id]);
    for (const label of new Set(op.labels ?? [])) {
      this.sql.exec("INSERT INTO item_labels (item, label) VALUES (?, ?)", pk, label);
      changes.push(["label", null, label]);
    }
    for (const dep of deps) {
      this.sql.exec("INSERT INTO item_deps (project, item, dep) VALUES (?, ?, ?)", p.pk, pk, dep.pk);
      changes.push(["dep", null, this.refOf(dep.pk)]);
    }
    const n = { ac: 0, dod: 0 };
    const criteria = [...(op.criteria ?? [])];
    if (op.type === "bug" && !criteria.some((c) => c.section === "ac")) criteria.unshift({ section: "ac", text: NO_LONGER, casper_gate: false });
    for (const c of criteria) {
      const ord = ++n[c.section];
      this.sql.exec("INSERT INTO criteria (item, section, ord, text, casper_gate) VALUES (?, ?, ?, ?, ?)", pk, c.section, ord, c.text, c.casper_gate ? 1 : 0);
      changes.push([`${c.section} #${ord}`, null, c.text]);
      if (c.casper_gate) changes.push([`${c.section} #${ord} casper_gate`, null, true]);
    }
    return { ref, seq: tx.event(capture ? "capture" : "create", "items", pk, ref, changes, op.reason) };
  }

  private update(tx: Tx, op: Op<"update">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const row = this.item(p, op.ref);
    const ref = this.refOf(row.pk);
    const set = op.set;
    const scope = this.scope(row);
    const what = ref;
    const cols: Record<string, SqlStorageValue> = {};
    const changes: Change[] = [];
    const field = (col: string, value: string | number | null, shown: Value = value, was: Value = row[col] as Value) => {
      if (row[col] === value) return;
      cols[col] = value;
      changes.push([col, was, shown]);
    };

    if (set.status !== undefined) {
      this.rules.require(tx.caller, p, "status", scope, what);
      field("status", set.status);
    }
    const content = (["title", "description", "notes", "plan", "type", "labels", "deps", "parent", "bug_where", "blocks_use", "found_in"] as const).some((k) => set[k] !== undefined);
    if (content) this.rules.require(tx.caller, p, "content", scope, what);
    if (set.title !== undefined) field("title", set.title);
    if (set.description !== undefined) field("description", set.description);
    if (set.notes !== undefined) field("notes", set.notes);
    if (set.plan !== undefined) field("plan", set.plan);

    if (set.type !== undefined && set.type !== row.type) {
      if (row.kind === "feature") throw new BoardError("invalid", "A feature is type increment");
      if (set.type === "increment") throw new BoardError("invalid", `Only a feature is type increment; promote ${ref} to make it one`);
      // A Done item would get an open criterion while Done (Toad, BOB-10 review 2): a bug found in it is a new one.
      if (set.type === "bug" && (set.status ?? row.status) === "Done") throw new BoardError("conflict", `${ref} is Done: capture the bug as a new item, with found_in naming what it was found in`);
      field("type", set.type);
    }
    const type = set.type ?? row.type;
    if (type !== "bug") {
      if (set.bug_where || set.blocks_use || set.found_in) throw new BoardError("invalid", "Bug fields are for items of type bug");
      // An item that stops being a bug drops its bug fields, in the same event.
      field("bug_where", null);
      field("blocks_use", 0, false, row.blocks_use === 1);
      if (row.found_in !== null) field("found_in", null, null, this.refOf(row.found_in));
    } else {
      // A bug's one criterion, when it becomes one with none; an ac list it has is kept as it is.
      if (row.type !== "bug" && this.acOf(row.pk).total === 0) {
        this.sql.exec("INSERT INTO criteria (item, section, ord, text, casper_gate) VALUES (?, 'ac', 1, ?, 0)", row.pk, NO_LONGER);
        changes.push(["ac #1", null, NO_LONGER]);
      }
      if (set.bug_where !== undefined) field("bug_where", set.bug_where);
      if (set.blocks_use !== undefined) field("blocks_use", set.blocks_use ? 1 : 0, set.blocks_use, row.blocks_use === 1);
      if (set.found_in !== undefined) {
        const f = set.found_in === null ? null : this.feature(p, set.found_in);
        field("found_in", f?.pk ?? null, set.found_in, row.found_in === null ? null : this.refOf(row.found_in));
      }
    }

    // bugs.md 4: Done once the fix has landed, the commit as the evidence; closing without one is archive, with a reason.
    if (type === "bug" && set.status === "Done" && row.status !== "Done") {
      const ac = this.acOf(row.pk);
      if (ac.total === 0 || ac.open > 0) throw new BoardError("conflict", `${ref} is a bug: ${BUG_DONE}`);
    }

    if (set.parent !== undefined) {
      if (row.kind !== "task") throw new BoardError("invalid", row.kind === "backlog" ? `Slot ${ref} into a feature to give it one` : "A feature has no parent");
      const to = this.feature(p, set.parent);
      if (to.pk !== row.parent) {
        // Moving a task takes the right to both features' tasks.
        this.rules.require(tx.caller, p, "content", this.scope(to), `${this.refOf(to.pk)}'s tasks`);
        field("parent", to.pk, this.refOf(to.pk), this.refOf(row.parent!));
      }
    }
    if (set.release !== undefined) {
      if (row.kind === "feature") throw new BoardError("invalid", "A feature's release is Casper's gate: set_release");
      if (row.kind === "task") throw new BoardError("invalid", "A task's release is its feature's");
      this.rules.require(tx.caller, p, "triage", null, what);
      const to = set.release === null ? null : this.release(p, set.release);
      if (to) openRelease(to);
      field("release", to?.pk ?? null, set.release, row.release === null ? null : this.releaseRef(row.release));
    }
    if (set.parent_hint !== undefined) {
      if (row.kind !== "backlog") throw new BoardError("invalid", "Only a backlog item has a parent_hint");
      this.rules.require(tx.caller, p, "triage", null, what);
      const hint = set.parent_hint === null ? null : this.feature(p, set.parent_hint);
      field("parent_hint", hint?.pk ?? null, set.parent_hint, row.parent_hint === null ? null : this.refOf(row.parent_hint));
    }

    if (set.labels !== undefined) {
      const had = new Set(this.sql.exec<{ label: string }>("SELECT label FROM item_labels WHERE item = ?", row.pk).toArray().map((l) => l.label));
      const want = new Set(set.labels);
      for (const l of had) if (!want.has(l)) (this.sql.exec("DELETE FROM item_labels WHERE item = ? AND label = ?", row.pk, l), changes.push(["label", l, null]));
      for (const l of want) if (!had.has(l)) (this.sql.exec("INSERT INTO item_labels (item, label) VALUES (?, ?)", row.pk, l), changes.push(["label", null, l]));
    }
    if (set.deps !== undefined) {
      const had = new Set(this.sql.exec<{ dep: number }>("SELECT dep FROM item_deps WHERE item = ?", row.pk).toArray().map((d) => d.dep));
      const want = this.items(p, set.deps);
      if (want.some((d) => d.pk === row.pk)) throw new BoardError("invalid", `${ref} can't depend on itself`);
      const wantPks = new Set(want.map((d) => d.pk));
      for (const d of had) if (!wantPks.has(d)) (this.sql.exec("DELETE FROM item_deps WHERE item = ? AND dep = ?", row.pk, d), changes.push(["dep", this.refOf(d), null]));
      for (const d of wantPks) if (!had.has(d)) (this.sql.exec("INSERT INTO item_deps (project, item, dep) VALUES (?, ?, ?)", p.pk, row.pk, d), changes.push(["dep", null, this.refOf(d)]));
    }

    this.setItem(row.pk, cols, tx.at);
    return { ref, seq: changes.length > 0 ? tx.event("update", "items", row.pk, ref, changes, op.reason) : 0 };
  }

  private criteria(tx: Tx, op: Op<"criteria">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const row = this.item(p, op.ref);
    const ref = this.refOf(row.pk);
    this.rules.require(tx.caller, p, "criteria", this.scope(row), ref);
    const c = op.change;
    if (c.action === "add") {
      const ord = this.sql.exec<{ n: number }>("SELECT coalesce(max(ord), 0) + 1 AS n FROM criteria WHERE item = ? AND section = ?", row.pk, c.section).one().n;
      this.sql.exec("INSERT INTO criteria (item, section, ord, text, casper_gate) VALUES (?, ?, ?, ?, ?)", row.pk, c.section, ord, c.text, c.casper_gate ? 1 : 0);
      const changes: Change[] = [[`${c.section} #${ord}`, null, c.text]];
      if (c.casper_gate) changes.push([`${c.section} #${ord} casper_gate`, null, true]);
      return { ref, seq: tx.event("criteria", "items", row.pk, ref, changes) };
    }
    const crit = this.sql
      .exec<{ pk: number; text: string; evidence: string | null; state: string; casper_gate: number }>(
        "SELECT * FROM criteria WHERE item = ? AND section = ? AND ord = ?",
        row.pk,
        c.section,
        c.n,
      )
      .toArray()[0];
    if (!crit) throw new BoardError("invalid", `${ref} has no ${c.section} #${c.n}`);
    const name = `${c.section} #${c.n}`;
    if (c.action === "edit") {
      if (crit.text === c.text) return { ref, seq: 0 };
      this.sql.exec("UPDATE criteria SET text = ? WHERE pk = ?", c.text, crit.pk);
      return { ref, seq: tx.event("criteria", "items", row.pk, ref, [[name, crit.text, c.text]]) };
    }
    if (crit.casper_gate === 1) ownerOnly(tx.caller, `${ref} ${name} is Casper's acceptance: checking it`);
    if (c.action === "check") {
      if (crit.state === "checked" && crit.evidence === c.evidence) return { ref, seq: 0 };
      this.sql.exec("UPDATE criteria SET state = 'checked', evidence = ?, checked_by = ?, checked_at = ? WHERE pk = ?", c.evidence, tx.who, tx.at, crit.pk);
      const changes: Change[] = [[`${name} evidence`, crit.evidence, c.evidence]];
      if (crit.state !== "checked") changes.unshift([`${name} state`, crit.state, "checked"]);
      return { ref, seq: tx.event("criteria", "items", row.pk, ref, changes) };
    }
    if (crit.state === "open") return { ref, seq: 0 };
    this.sql.exec("UPDATE criteria SET state = 'open', checked_by = NULL, checked_at = NULL WHERE pk = ?", crit.pk);
    return { ref, seq: tx.event("criteria", "items", row.pk, ref, [[`${name} state`, "checked", "open"]], c.reason) };
  }

  private slot(tx: Tx, op: Op<"slot">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const row = this.item(p, op.ref);
    const ref = this.refOf(row.pk);
    if (row.kind !== "backlog") throw new BoardError("invalid", `${ref} is a ${row.kind}; only a backlog item is slotted`);
    if (row.archived_at) throw new BoardError("invalid", `${ref} is archived; restore it first`);
    const feature = this.feature(p, op.feature);
    this.rules.require(tx.caller, p, "triage", this.scope(feature), `${op.feature}'s tasks`);
    const changes: Change[] = [
      ["kind", "backlog", "task"],
      ["parent", null, this.refOf(feature.pk)],
    ];
    if (row.release !== null) changes.push(["release", this.releaseRef(row.release), null]);
    if (row.parent_hint !== null) changes.push(["parent_hint", this.refOf(row.parent_hint), null]);
    if (row.ord !== null) changes.push(["ord", row.ord, null]);
    this.setItem(row.pk, { kind: "task", parent: feature.pk, release: null, parent_hint: null, ord: null }, tx.at);
    return { ref, seq: tx.event("slot", "items", row.pk, ref, changes, op.reason) };
  }

  private promote(tx: Tx, op: Op<"promote">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const row = this.item(p, op.ref);
    const ref = this.refOf(row.pk);
    if (row.kind !== "backlog") throw new BoardError("invalid", `${ref} is a ${row.kind}; only a backlog item is promoted`);
    if (row.archived_at) throw new BoardError("invalid", `${ref} is archived; restore it first`);
    this.rules.require(tx.caller, p, "triage", null, ref);
    // A new feature is in no release until Casper's gate puts it in one (ADR 0001, point 3).
    const ord = this.nextOrd("SELECT max(ord) AS m FROM items WHERE project = ? AND kind = 'feature' AND release IS NULL", p.pk);
    const changes: Change[] = [
      ["kind", "backlog", "feature"],
      ["type", row.type, "increment"],
      ["ord", row.ord, ord],
    ];
    if (row.release !== null) changes.push(["release", this.releaseRef(row.release), null]);
    if (row.parent_hint !== null) changes.push(["parent_hint", this.refOf(row.parent_hint), null]);
    if (row.bug_where !== null) changes.push(["bug_where", row.bug_where, null]);
    if (row.blocks_use === 1) changes.push(["blocks_use", true, false]);
    if (row.found_in !== null) changes.push(["found_in", this.refOf(row.found_in), null]);
    this.setItem(row.pk, { kind: "feature", type: "increment", release: null, parent_hint: null, ord, bug_where: null, blocks_use: 0, found_in: null }, tx.at);
    return { ref, seq: tx.event("promote", "items", row.pk, ref, changes, op.reason) };
  }

  private archive(tx: Tx, op: Op<"archive" | "restore">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const row = this.item(p, op.ref);
    const ref = this.refOf(row.pk);
    this.rules.require(tx.caller, p, "triage", this.scope(row), ref);
    if (op.op === "archive") {
      if (row.archived_at) throw new BoardError("conflict", `${ref} is already archived`);
      if (row.open_since) throw new BoardError("conflict", `${ref} is open: a session on it hasn't closed`);
      this.setItem(row.pk, { archived_at: tx.at, archive_reason: op.reason }, tx.at);
      return { ref, seq: tx.event("archive", "items", row.pk, ref, [["archived_at", null, tx.at], ["archive_reason", null, op.reason]], op.reason) };
    }
    if (!row.archived_at) throw new BoardError("conflict", `${ref} isn't archived`);
    if (row.parent !== null && this.sql.exec("SELECT 1 FROM items WHERE pk = ? AND archived_at IS NOT NULL", row.parent).toArray().length > 0) {
      throw new BoardError("conflict", `${ref}'s feature ${this.refOf(row.parent)} is archived; restore it first`);
    }
    this.setItem(row.pk, { archived_at: null, archive_reason: null }, tx.at);
    return { ref, seq: tx.event("restore", "items", row.pk, ref, [["archived_at", row.archived_at, null], ["archive_reason", row.archive_reason, null]], op.reason) };
  }

  private order(tx: Tx, op: Op<"order">): BoardWritten {
    const p = tx.project(this.project(op.project));
    this.rules.require(tx.caller, p, "order", null, op.scope === "features" ? "features" : "the backlog");
    let members: ItemRow[];
    if (op.scope === "features") {
      if (op.release === undefined) throw new BoardError("invalid", "Ordering features names their release, or null for those in none");
      const release = op.release === null ? null : this.release(p, op.release);
      members = this.sql
        .exec<ItemRow>(`SELECT * FROM items WHERE project = ? AND kind = 'feature' AND archived_at IS NULL AND release ${release ? "= ?" : "IS NULL"}`, p.pk, ...(release ? [release.pk] : []))
        .toArray();
    } else {
      members = this.sql.exec<ItemRow>("SELECT * FROM items WHERE project = ? AND kind = 'backlog' AND archived_at IS NULL", p.pk).toArray();
    }
    const wanted = this.items(p, op.refs);
    const byPk = new Map(members.map((m) => [m.pk, m]));
    if (new Set(wanted.map((w) => w.pk)).size !== wanted.length || wanted.length !== members.length || wanted.some((w) => !byPk.has(w.pk))) {
      const names = members.map((m) => this.refOf(m.pk)).join(", ");
      throw new BoardError("invalid", `An order names every item in its scope once: ${names || "none"}`);
    }
    let seq = 0;
    wanted.forEach((w, i) => {
      const ord = (i + 1) * ORD_STEP;
      const was = byPk.get(w.pk)!.ord;
      if (was === ord) return;
      this.setItem(w.pk, { ord }, tx.at);
      const ref = this.refOf(w.pk);
      seq = tx.event("order", "items", w.pk, ref, [["ord", was, ord]]);
    });
    return { ref: null, seq };
  }

  private setRelease(tx: Tx, op: Op<"set_release">): BoardWritten {
    ownerOnly(tx.caller, "Moving a feature into or out of a release");
    const p = tx.project(this.project(op.project));
    const row = this.feature(p, op.ref);
    const ref = this.refOf(row.pk);
    const to = op.release === null ? null : this.release(p, op.release);
    if (to) openRelease(to);
    if ((to?.pk ?? null) === row.release) return { ref, seq: 0 };
    // Casper's move puts a feature last in its new release (notes 19).
    const ord = this.nextOrd(`SELECT max(ord) AS m FROM items WHERE project = ? AND kind = 'feature' AND release ${to ? "= ?" : "IS NULL"}`, p.pk, ...(to ? [to.pk] : []));
    this.setItem(row.pk, { release: to?.pk ?? null, ord }, tx.at);
    const changes: Change[] = [["release", row.release === null ? null : this.releaseRef(row.release), op.release], ["ord", row.ord, ord]];
    return { ref, seq: tx.event("set_release", "items", row.pk, ref, changes, op.reason) };
  }

  private orderReleases(tx: Tx, op: Op<"order_releases">): BoardWritten {
    ownerOnly(tx.caller, "Ordering releases");
    const p = tx.project(this.project(op.project));
    const all = this.sql.exec<ReleaseRow>("SELECT * FROM releases WHERE project = ?", p.pk).toArray();
    const byRef = new Map(all.map((r) => [r.ref, r]));
    if (new Set(op.refs).size !== op.refs.length || op.refs.length !== all.length || op.refs.some((r) => !byRef.has(r))) {
      throw new BoardError("invalid", `An order names every release once: ${all.map((r) => r.ref).join(", ") || "none"}`);
    }
    let seq = 0;
    op.refs.forEach((ref, i) => {
      const r = byRef.get(ref)!;
      const ord = (i + 1) * ORD_STEP;
      if (r.ord === ord) return;
      this.sql.exec("UPDATE releases SET ord = ? WHERE pk = ?", ord, r.pk);
      seq = tx.event("order_releases", "releases", r.pk, ref, [["ord", r.ord, ord]]);
    });
    return { ref: null, seq };
  }

  /**
   * Casper closes a release (§5): each feature in it that isn't Done or archived needs a destination,
   * so nothing is closed with work silently left. The features' events come first and the release's
   * last: its seq is the one undo takes, and the moves are the close events just before it.
   */
  private closeRelease(tx: Tx, op: Op<"close_release">): BoardWritten {
    ownerOnly(tx.caller, "Closing a release");
    const p = tx.project(this.project(op.project));
    const r = this.release(p, op.ref);
    if (r.status === "closed") throw new BoardError("conflict", `${r.ref} is closed already`);
    const moves = new Map<number, { row: ItemRow; ref: string; to: ReleaseRow | null }>();
    for (const m of op.moves) {
      const row = this.feature(p, m.feature);
      const ref = this.refOf(row.pk);
      if (row.release !== r.pk) throw new BoardError("invalid", `${ref} is not in ${r.ref}`);
      if (row.status === "Done") throw new BoardError("invalid", `${ref} is Done: it stays in ${r.ref}`);
      if (moves.has(row.pk)) throw new BoardError("invalid", `${ref} is moved twice`);
      const to = m.to === null ? null : this.release(p, m.to);
      if (to?.pk === r.pk) throw new BoardError("invalid", `${ref} can't go to ${r.ref}: it is the release being closed`);
      if (to) openRelease(to);
      moves.set(row.pk, { row, ref, to });
    }
    const left = this.sql
      .exec<{ pk: number }>("SELECT pk FROM items WHERE project = ? AND kind = 'feature' AND release = ? AND status != 'Done' AND archived_at IS NULL ORDER BY pk", p.pk, r.pk)
      .toArray()
      .filter((f) => !moves.has(f.pk))
      .map((f) => this.refOf(f.pk));
    if (left.length > 0) {
      throw new BoardError("invalid", `Closing ${r.ref} would leave ${left.join(", ")} not Done in it: say where each goes, another release or none`);
    }
    for (const { row, ref, to } of moves.values()) {
      // Last in its new release, as Casper's move puts it (notes 19).
      const ord = this.nextOrd(`SELECT max(ord) AS m FROM items WHERE project = ? AND kind = 'feature' AND release ${to ? "= ?" : "IS NULL"}`, p.pk, ...(to ? [to.pk] : []));
      this.setItem(row.pk, { release: to?.pk ?? null, ord }, tx.at);
      tx.event("close_release", "items", row.pk, ref, [["release", r.ref, to?.ref ?? null], ["ord", row.ord, ord]]);
    }
    this.sql.exec("UPDATE releases SET status = 'closed', closed_at = ?, closed_by = ? WHERE pk = ?", tx.at, tx.who, r.pk);
    const changes: Change[] = [["status", r.status, "closed"], ["closed_at", null, tx.at], ["closed_by", null, tx.who]];
    return { ref: r.ref, seq: tx.event("close_release", "releases", r.pk, r.ref, changes) };
  }

  private grant(tx: Tx, op: Op<"grant">): BoardWritten {
    const p = op.project === "*" ? null : tx.project(this.project(op.project));
    if (p) this.rules.requireFlag(tx.caller, p, "admin");
    else ownerOnly(tx.caller, "A rule for every project");
    const key = `${op.agent}@${op.laptop} on ${op.project}`;
    const old = this.grantRow(p?.pk ?? null, op.agent, op.laptop);
    const fields = [...new Set(op.fields)].sort();
    const values = { role: op.role, read: op.read, items: op.items, sessions: op.sessions, questions: op.questions, admin: op.admin };
    let pk: number;
    const changes: Change[] = [];
    if (old) {
      pk = old.pk;
      this.sql.exec(
        "UPDATE grants SET role = ?, read = ?, items = ?, sessions = ?, questions = ?, admin = ? WHERE pk = ?",
        op.role,
        op.read ? 1 : 0,
        op.items,
        op.sessions ? 1 : 0,
        op.questions ? 1 : 0,
        op.admin ? 1 : 0,
        pk,
      );
      for (const [k, v] of Object.entries(values)) {
        const was = typeof v === "boolean" ? old[k] === 1 : old[k];
        if (was !== v) changes.push([k, was as Value, v]);
      }
    } else {
      pk = this.sql
        .exec<{ pk: number }>(
          "INSERT INTO grants (project, agent, laptop, role, read, items, sessions, questions, admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk",
          p?.pk ?? null,
          op.agent,
          op.laptop,
          op.role,
          op.read ? 1 : 0,
          op.items,
          op.sessions ? 1 : 0,
          op.questions ? 1 : 0,
          op.admin ? 1 : 0,
        )
        .one().pk;
      changes.push(["agent", null, op.agent], ["laptop", null, op.laptop], ...Object.entries(values).map(([k, v]): Change => [k, null, v]));
    }
    const had = old ? this.grantFields(pk) : [];
    for (const f of had) if (!fields.includes(f)) (this.sql.exec("DELETE FROM grant_fields WHERE grant_pk = ? AND field = ?", pk, f), changes.push(["field", f, null]));
    for (const f of fields) if (!had.includes(f)) (this.sql.exec("INSERT INTO grant_fields (grant_pk, field) VALUES (?, ?)", pk, f), changes.push(["field", null, f]));
    return { ref: key, seq: changes.length > 0 ? tx.event("grant", "grants", pk, key, changes) : 0 };
  }

  private revoke(tx: Tx, op: Op<"revoke">): BoardWritten {
    const p = op.project === "*" ? null : tx.project(this.project(op.project));
    if (p) this.rules.requireFlag(tx.caller, p, "admin");
    else ownerOnly(tx.caller, "A rule for every project");
    const key = `${op.agent}@${op.laptop} on ${op.project}`;
    const old = this.grantRow(p?.pk ?? null, op.agent, op.laptop);
    if (!old) throw new BoardError("invalid", `No rule for ${key}`);
    const fields = this.grantFields(old.pk);
    this.sql.exec("DELETE FROM grant_fields WHERE grant_pk = ?", old.pk);
    this.sql.exec("DELETE FROM grants WHERE pk = ?", old.pk);
    const changes: Change[] = [["role", old.role as string, null], ["read", old.read === 1, null], ["items", old.items as string, null], ...fields.map((f): Change => ["field", f, null])];
    return { ref: key, seq: tx.event("revoke", "grants", old.pk, key, changes) };
  }

  private sessionJoin(tx: Tx, op: Op<"session_join">): BoardWritten & { created: boolean } {
    const p = tx.project(this.project(op.project));
    // Who may spawn into a session is decided where the spawn is made; the board takes it from the supervisor.
    const ctx = supervisorOp(tx.caller, op);
    if (!sameSession(ctx.session, op.session)) throw new BoardError("forbidden", "session_join joins the session its worker's spawn declared");
    const feature = this.feature(p, op.session.feature);
    const ref = this.refOf(feature.pk);
    if (feature.archived_at) throw new BoardError("invalid", `${ref} is archived`);
    const release = feature.release === null ? null : this.sql.exec<ReleaseRow>("SELECT * FROM releases WHERE pk = ?", feature.release).one();
    // A closed release takes no new sessions (board-writes 6; Toad's consult c_81cf334e); undo is named only while it can be.
    if (release?.status === "closed") {
      const undoable = release.closed_at !== null && Date.parse(tx.at) - Date.parse(release.closed_at) <= UNDO_MS;
      throw new BoardError("conflict", `${ref} is in ${release.ref}, which is closed: a closed release takes no new sessions${undoable ? "; undo the close first" : ""}`);
    }
    const { kind, label } = op.session;
    const name = `${ref} ${kind} ${label}`;
    const existing = this.sql
      .exec<{ pk: number; ended_at: string | null }>("SELECT pk, ended_at FROM sessions WHERE feature = ? AND kind = ? AND label = ?", feature.pk, kind, label)
      .toArray()[0];
    if (existing?.ended_at) throw new BoardError("conflict", `${name} is closed; name another label`);
    let seq = 0;
    if (!existing) {
      const pk = this.sql
        .exec<{ pk: number }>("INSERT INTO sessions (project, feature, kind, label, started_at) VALUES (?, ?, ?, ?, ?) RETURNING pk", p.pk, feature.pk, kind, label, tx.at)
        .one().pk;
      seq = tx.event("session_join", "sessions", pk, name, [["feature", null, ref], ["kind", null, kind], ["label", null, label], ["started_at", null, tx.at]]);
    }
    // The open feature is the session operations' alone (board-writes; ADR 0001 §2).
    if (!feature.open_since) {
      this.setItem(feature.pk, { open_since: tx.at }, tx.at);
      seq = tx.event("session_join", "items", feature.pk, ref, [["open_since", null, tx.at]]);
    }
    // So is opening the release: its first session opens a planned one, never a hand (board-writes 6).
    if (release?.status === "planned") {
      this.sql.exec("UPDATE releases SET status = 'open' WHERE pk = ?", release.pk);
      seq = tx.event("session_join", "releases", release.pk, release.ref, [["status", "planned", "open"]]);
    }
    return { ref: name, seq, created: !existing };
  }

  private capture(tx: Tx, op: Op<"capture">): BoardWritten & { duplicate: boolean; dropped: string[] } {
    const p = tx.project(this.project(op.project));
    const had = this.sql.exec<{ pk: number; project: number }>("SELECT pk, project FROM items WHERE capture_id = ?", op.capture_id).toArray()[0];
    if (had) {
      if (had.project !== p.pk) throw new BoardError("conflict", `Capture ${op.capture_id} is already stored in another project`);
      return { ref: this.refOf(had.pk), seq: 0, duplicate: true, dropped: [] };
    }
    // A capture never asks back (§12): a link it can't keep is dropped and named, never a refusal.
    const dropped: string[] = [];
    const keep = <T>(field: string, value: T | null | undefined, ok: (v: T) => boolean): T | undefined => {
      if (value === null || value === undefined) return undefined;
      if (ok(value)) return value;
      dropped.push(field);
      return undefined;
    };
    const release = keep("release", op.release, (r) => {
      const row = this.sql.exec<ReleaseRow>("SELECT * FROM releases WHERE project = ? AND ref = ?", p.pk, r).toArray()[0];
      return row !== undefined && row.status !== "closed" && this.rules.may(tx.caller, p, "triage", null);
    });
    const bug = op.type === "bug";
    const foundIn = keep("found_in", op.found_in, (f) => bug && this.sql.exec("SELECT 1 FROM item_refs r JOIN items i ON i.pk = r.item WHERE r.project = ? AND r.ref = ? AND i.kind = 'feature' AND i.archived_at IS NULL", p.pk, f).toArray().length > 0);
    const bugWhere = keep("bug_where", op.bug_where, () => bug);
    const blocksUse = keep("blocks_use", op.blocks_use || null, () => bug);
    const create: Op<"create"> = {
      op: "create",
      project: op.project,
      kind: "backlog",
      type: op.type,
      title: op.title,
      ...(op.description !== undefined ? { description: op.description } : {}),
      ...(release ? { release } : {}),
      ...(bugWhere ? { bug_where: bugWhere } : {}),
      ...(blocksUse ? { blocks_use: blocksUse } : {}),
      ...(foundIn ? { found_in: foundIn } : {}),
    };
    const written = this.create(tx, create, { id: op.capture_id, casper_words: op.casper_words ?? null });
    return { ...written, duplicate: false, dropped };
  }

  /** §6: applies the close's moves as status writes tagged with the session, then records the close. */
  private closeSession(tx: Tx, op: Op<"close_session">): BoardWritten & { tasks_moved: SessionRecord["tasks_moved"]; tokens: TokenTotals } {
    const p = tx.project(this.project(op.project));
    this.rules.requireFlag(tx.caller, p, "sessions");
    const s = this.session(p, op.session);
    const name = this.sessionName(s);
    if (s.ended_at) throw new BoardError("conflict", `${name} is closed already`);
    if (op.need === "casper" && op.waits_on.length === 0) throw new BoardError("invalid", "A close that needs Casper names the questions it waits on");
    if (op.need !== "casper" && op.waits_on.length > 0) throw new BoardError("invalid", "Only a close that needs Casper waits on questions");
    const waits = [...new Set(op.waits_on)].map((r) => this.question(p, r));
    const answered = waits.find((q) => q.state !== "open");
    if (answered) throw new BoardError("invalid", `${answered.ref} is ${answered.state}: a close waits only on open questions`);
    const ofFeature = (refs: string[], what: string) =>
      [...new Set(refs)].map((r) => {
        const row = this.item(p, r);
        if (row.kind !== "task" || row.parent !== s.feature) throw new BoardError("invalid", `${what} ${r} isn't a task of ${this.refOf(s.feature)}`);
        return row;
      });
    const lists = { blocker: ofFeature(op.blockers, "Blocker"), major: ofFeature(op.majors, "Major"), sent_back: ofFeature(op.sent_back, "Sent back") };

    // The moves are this boundary's status writes, checked as any is, and tagged with the session.
    tx.inSession(s.pk);
    for (const m of op.moves) this.update(tx, { op: "update", project: op.project, ref: m.task, set: { status: m.status }, reason: `${name} closed` });

    const close = {
      ended_at: tx.at,
      need: op.need,
      minors_fixed: op.minors_fixed,
      summary: op.summary,
      handoff_path: op.handoff.path,
      handoff_text: op.handoff.text,
      commit_sha: op.commit ?? null,
      closed_by: tx.who,
    };
    const keys = Object.keys(close) as Array<keyof typeof close>;
    this.sql.exec(`UPDATE sessions SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE pk = ?`, ...keys.map((k) => close[k]), s.pk);
    const changes: Change[] = keys.filter((k) => k !== "handoff_text").map((k): Change => [k, null, close[k]]);
    for (const [role, rows] of Object.entries(lists)) {
      for (const row of rows) {
        this.sql.exec("INSERT INTO session_tasks (project, session, item, role) VALUES (?, ?, ?, ?)", p.pk, s.pk, row.pk, role);
        changes.push([role, null, this.refOf(row.pk)]);
      }
    }
    for (const q of waits) {
      this.sql.exec("INSERT INTO session_waits_on (project, session, question) VALUES (?, ?, ?)", p.pk, s.pk, q.pk);
      changes.push(["waits_on", null, q.ref]);
    }
    let seq = tx.event("close_session", "sessions", s.pk, name, changes);
    const open = this.sql.exec("SELECT 1 FROM sessions WHERE feature = ? AND ended_at IS NULL", s.feature).toArray().length > 0;
    const feature = this.sql.exec<ItemRow>("SELECT * FROM items WHERE pk = ?", s.feature).one();
    if (!open && feature.open_since) {
      this.setItem(feature.pk, { open_since: null }, tx.at);
      seq = tx.event("close_session", "items", feature.pk, this.refOf(feature.pk), [["open_since", feature.open_since, null]]);
    }
    return { ref: name, seq, tasks_moved: this.tasksMoved(s.pk), tokens: this.sessionTokens(s.pk) };
  }

  private ask(tx: Tx, op: Op<"ask">): BoardWritten {
    const p = tx.project(this.project(op.project));
    this.rules.requireFlag(tx.caller, p, "questions");
    const holds = this.items(p, op.holds);
    // One row per session held: the table's UNIQUE can't see a repeat, its item being NULL.
    const holdSessions = [...new Map(op.holds_sessions.map((s) => this.session(p, s)).map((s) => [s.pk, s])).values()];
    const nb = op.needed_before;
    const nbItem = nb && "item" in nb ? this.item(p, nb.item) : null;
    const nbRelease = nb && "release" in nb ? this.release(p, nb.release) : null;
    const nbText = nb && "text" in nb ? nb.text : null;
    const keys = op.options.map((o) => o.key);
    if (new Set(keys).size !== keys.length) throw new BoardError("invalid", "Each option has its own key");
    const counter = op.kind === "question" ? "next_question" : "next_action";
    const n = this.sql.exec<{ n: number }>(`SELECT ${counter} AS n FROM projects WHERE pk = ?`, p.pk).one().n;
    this.sql.exec(`UPDATE projects SET ${counter} = ${counter} + 1 WHERE pk = ?`, p.pk);
    const ref = `${op.kind === "question" ? "Q" : "A"}-${n}`;
    const pk = this.sql
      .exec<{ pk: number }>(
        `INSERT INTO questions (project, ref, kind, text, context, asked_by, session, needed_before_item, needed_before_release, needed_before_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
        p.pk,
        ref,
        op.kind,
        op.text,
        op.context ?? null,
        tx.who,
        tx.sessionPk(),
        nbItem?.pk ?? null,
        nbRelease?.pk ?? null,
        nbText,
        tx.at,
      )
      .one().pk;
    const changes: Change[] = [["kind", null, op.kind], ["text", null, op.text], ["context", null, op.context], ["asked_by", null, tx.who]];
    if (nb) changes.push(["needed_before", null, nbItem ? this.refOf(nbItem.pk) : (nbRelease?.ref ?? nbText)]);
    op.options.forEach((o, i) => {
      this.sql.exec("INSERT INTO question_options (question, ord, key, text, recommended) VALUES (?, ?, ?, ?, ?)", pk, i + 1, o.key, o.text, o.recommended ? 1 : 0);
      changes.push([`option ${o.key}`, null, `${o.text}${o.recommended ? " (recommended)" : ""}`]);
    });
    for (const h of holds) {
      this.sql.exec("INSERT INTO question_holds (project, question, item) VALUES (?, ?, ?)", p.pk, pk, h.pk);
      changes.push(["holds", null, this.refOf(h.pk)]);
    }
    for (const s of holdSessions) {
      this.sql.exec("INSERT INTO question_holds (project, question, session) VALUES (?, ?, ?)", p.pk, pk, s.pk);
      changes.push(["holds", null, this.sessionName(s)]);
    }
    return { ref, seq: tx.event("ask", "questions", pk, ref, changes) };
  }

  /** Casper's answer given in conversation, recorded by the lead or PO (§7): write-once, his words verbatim. */
  private recordAnswer(tx: Tx, op: Op<"record_answer">): BoardWritten & { told: string[] } {
    const p = tx.project(this.project(op.project));
    this.rules.requireFlag(tx.caller, p, "questions");
    const q = this.question(p, op.ref);
    if (q.state !== "open") throw new BoardError("conflict", `${q.ref} is ${q.state} already: an answer is written once`);
    if (op.key !== undefined && !this.sql.exec("SELECT 1 FROM question_options WHERE question = ? AND key = ?", q.pk, op.key).toArray().length) {
      throw new BoardError("invalid", `${q.ref} has no option ${op.key}`);
    }
    const state = q.kind === "action" ? "done" : "answered";
    this.sql.exec(
      "UPDATE questions SET state = ?, answer_key = ?, answer_words = ?, answered_by = ?, answered_at = ?, answered_via = 'conversation' WHERE pk = ?",
      state,
      op.key ?? null,
      op.words,
      tx.who,
      tx.at,
      q.pk,
    );
    const changes: Change[] = [["state", "open", state], ["answer_key", null, op.key], ["answer_words", null, op.words], ["answered_via", null, "conversation"]];
    const seq = tx.event("record_answer", "questions", q.pk, q.ref, changes);
    // Whoever waits on it hears, so nobody has to remember to forward it; the recorder knows.
    const lines = [`Casper answered ${q.ref} (${p.key}), in conversation, recorded by ${tx.who}: ${q.text}`];
    if (op.key !== undefined) {
      const option = this.option(q, op.key);
      lines.push(`Option ${option.key}: ${option.text}`);
    }
    lines.push(`His words: ${op.words}`);
    return { ref: q.ref, seq, told: this.notify(tx, p, q, lines.join("\n"), tx.caller) };
  }

  /** Casper's answer from the dashboard (§7): write-once, the owner's alone, and the lead hears it. */
  private answerQuestion(tx: Tx, op: Op<"answer_question">): BoardWritten & { told: string[] } {
    ownerOnly(tx.caller, "Answering a question");
    const p = tx.project(this.project(op.project));
    const q = this.question(p, op.ref);
    if (q.kind === "action") throw new BoardError("invalid", `${q.ref} is an action: mark it done`);
    if (op.key === undefined && op.words === undefined) throw new BoardError("invalid", `An answer to ${q.ref} picks an option, says something, or both`);
    if (q.state !== "open") throw new BoardError("conflict", `${q.ref} is ${q.state} already: an answer is written once`);
    const option = op.key === undefined ? null : this.option(q, op.key);
    const seq = this.answer(tx, q, "answered", op.key ?? null, op.words ?? null, "answer_question");
    const lines = [`Casper answered ${q.ref} (${p.key}): ${q.text}`];
    if (option) lines.push(`Option ${option.key}: ${option.text}`);
    if (op.words !== undefined) lines.push(`His words: ${op.words}`);
    return { ref: q.ref, seq, told: this.notify(tx, p, q, lines.join("\n")) };
  }

  /** Casper marks an action done from the dashboard (§7), with an optional note: write-once, the owner's alone. */
  private markDone(tx: Tx, op: Op<"mark_done">): BoardWritten & { told: string[] } {
    ownerOnly(tx.caller, "Marking an action done");
    const p = tx.project(this.project(op.project));
    const q = this.question(p, op.ref);
    if (q.kind === "question") throw new BoardError("invalid", `${q.ref} is a question: answer it`);
    if (q.state !== "open") throw new BoardError("conflict", `${q.ref} is ${q.state} already: an action is marked done once`);
    const seq = this.answer(tx, q, "done", null, op.note ?? null, "mark_done");
    const lines = [`Casper marked ${q.ref} done (${p.key}): ${q.text}`];
    if (op.note !== undefined) lines.push(`His note: ${op.note}`);
    return { ref: q.ref, seq, told: this.notify(tx, p, q, lines.join("\n")) };
  }

  /** Writes an answer from the dashboard and its event. */
  private answer(tx: Tx, q: QuestionRow, state: "answered" | "done", key: string | null, words: string | null, op: string): number {
    this.sql.exec(
      "UPDATE questions SET state = ?, answer_key = ?, answer_words = ?, answered_by = ?, answered_at = ?, answered_via = 'dashboard' WHERE pk = ?",
      state,
      key,
      words,
      tx.who,
      tx.at,
      q.pk,
    );
    const changes: Change[] = [["state", "open", state], ["answer_key", null, key], ["answer_words", null, words], ["answered_via", null, "dashboard"]];
    return tx.event(op, "questions", q.pk, q.ref, changes);
  }

  /**
   * The owner takes back one of his own events, as a new event that names it (§5), within two
   * minutes: his dashboard answer or done mark (§7), a feature's release, or a release's close. An
   * order of releases isn't undone here: the dashboard sends the inverse order.
   */
  private undo(tx: Tx, op: Op<"undo">): BoardWritten & { told: string[] } {
    ownerOnly(tx.caller, "Undo");
    const p = tx.project(this.project(op.project));
    const e = this.sql
      .exec<UndoneEvent>("SELECT seq, at, op, tbl, pk, ref, actor_kind, actor FROM events WHERE seq = ? AND project = ?", op.seq, p.pk)
      .toArray()[0];
    if (!e) throw new BoardError("invalid", `No event ${op.seq} in ${p.key}`);
    if (e.actor_kind === "owner" && (e.op === "set_release" || e.op === "close_release")) {
      if (e.op === "close_release" && e.tbl !== "releases") throw new BoardError("invalid", `Event ${op.seq} is one of a close's moves: undo the close, not one of its moves`);
      if (this.sql.exec("SELECT 1 FROM events WHERE undo_of = ?", e.seq).toArray().length > 0) throw new BoardError("conflict", `Event ${op.seq} on ${e.ref} is undone already`);
      if (Date.parse(tx.at) - Date.parse(e.at) > UNDO_MS) throw new BoardError("conflict", `Too late to undo event ${op.seq} on ${e.ref}: Undo lasts two minutes; make the change again instead`);
      return { ...(e.op === "set_release" ? this.undoSetRelease(tx, p, e) : this.undoClose(tx, p, e)), told: [] };
    }
    if (e.tbl !== "questions" || (e.op !== "answer_question" && e.op !== "mark_done") || e.actor_kind !== "owner") {
      throw new BoardError("invalid", `Event ${op.seq} is a ${e.op}: undo takes back only Casper's answer or done mark, a feature's release or a release's close, from the dashboard`);
    }
    const q = this.questionRow(e.pk!);
    const last = this.sql
      .exec<{ seq: number }>(
        "SELECT max(seq) AS seq FROM events WHERE tbl = 'questions' AND pk = ? AND op IN ('answer_question', 'mark_done', 'record_answer', 'undo')",
        q.pk,
      )
      .one().seq;
    if (q.state === "open" || last !== e.seq) throw new BoardError("conflict", `Event ${op.seq} on ${q.ref} is undone already`);
    if (Date.parse(tx.at) - Date.parse(e.at) > UNDO_MS) {
      throw new BoardError("conflict", `Too late to undo ${q.ref}'s answer: Undo lasts two minutes; ask the lead to reopen it`);
    }
    this.sql.exec("UPDATE questions SET state = 'open', answer_key = NULL, answer_words = NULL, answered_by = NULL, answered_at = NULL, answered_via = NULL WHERE pk = ?", q.pk);
    const changes: Change[] = [
      ["state", q.state, "open"],
      ["answer_key", q.answer_key, null],
      ["answer_words", q.answer_words, null],
      ["answered_via", q.answered_via, null],
    ];
    const seq = tx.event("undo", "questions", q.pk, q.ref, changes, undefined, e.seq);
    const what = q.kind === "action" ? "his done mark on" : "his answer to";
    const lines = [`Casper withdrew ${what} ${q.ref} (${p.key}); it is open again: ${q.text}`];
    if (q.answer_key !== null) lines.push(`Withdrawn option: ${q.answer_key}`);
    if (q.answer_words !== null) lines.push(`Withdrawn words: ${q.answer_words}`);
    return { ref: q.ref, seq, told: this.notify(tx, p, q, lines.join("\n")) };
  }

  /** Puts a feature back in the release Casper moved it out of, unless it has moved since. */
  private undoSetRelease(tx: Tx, p: ProjectRow, e: UndoneEvent): BoardWritten {
    const row = this.sql.exec<ItemRow>("SELECT * FROM items WHERE pk = ?", e.pk).one();
    const seq = this.moveBack(tx, p, row, e, "since");
    return { ref: this.refOf(row.pk), seq };
  }

  /**
   * Reopens a release Casper closed and puts each feature the close moved back in it, at its old
   * place. The close's moves are the close events just before its release event, in its transaction:
   * same time, same actor.
   */
  private undoClose(tx: Tx, p: ProjectRow, e: UndoneEvent): BoardWritten {
    const r = this.sql.exec<ReleaseRow>("SELECT * FROM releases WHERE pk = ?", e.pk).one();
    if (r.status !== "closed" || r.closed_at !== e.at) throw new BoardError("conflict", `${r.ref} isn't closed by event ${e.seq} any more`);
    const moves: UndoneEvent[] = [];
    for (const m of this.sql.exec<UndoneEvent>(
      "SELECT seq, at, op, tbl, pk, ref, actor_kind, actor FROM events WHERE project = ? AND seq < ? ORDER BY seq DESC LIMIT 201",
      p.pk,
      e.seq,
    )) {
      if (m.op !== "close_release" || m.tbl !== "items" || m.at !== e.at || m.actor !== e.actor) break;
      moves.push(m);
    }
    const rows = moves.map((m) => ({ m, row: this.sql.exec<ItemRow>("SELECT * FROM items WHERE pk = ?", m.pk).one() }));
    // Reopened first, so its features may go back into it; a refused move rolls the whole undo back.
    const status = this.changesOf(e.seq).get("status")?.old ?? "open";
    this.sql.exec("UPDATE releases SET status = ?, closed_at = NULL, closed_by = NULL WHERE pk = ?", status, r.pk);
    for (const { m, row } of rows.reverse()) this.moveBack(tx, p, row, m, "since the close");
    const changes: Change[] = [["status", "closed", status], ["closed_at", r.closed_at, null], ["closed_by", r.closed_by, null]];
    return { ref: r.ref, seq: tx.event("undo", "releases", r.pk, r.ref, changes, undefined, e.seq) };
  }

  /** Refuses to move a feature back when it is no longer where event `e` put it, or is now in a closed release. Its release's change. */
  private movedSince(row: ItemRow, e: UndoneEvent, when: string): { old: string | null; new: string | null } {
    const ref = this.refOf(row.pk);
    const moved = this.changesOf(e.seq).get("release")!;
    const now = row.release === null ? null : this.sql.exec<ReleaseRow>("SELECT * FROM releases WHERE pk = ?", row.release).one();
    if ((now?.ref ?? null) !== moved.new) throw new BoardError("conflict", `${ref} has moved ${when}: it is in ${now?.ref ?? "no release"}`);
    if (now?.status === "closed") throw new BoardError("conflict", `${ref} is in ${now.ref}, which is closed now`);
    return moved;
  }

  /** Moves a feature back to where it was before event `e`, at its old place, as an undo event. */
  private moveBack(tx: Tx, p: ProjectRow, row: ItemRow, e: UndoneEvent, when: string): number {
    const moved = this.movedSince(row, e, when);
    const back = moved.old === null ? null : this.release(p, moved.old);
    if (back?.status === "closed") throw new BoardError("conflict", `${this.refOf(row.pk)} came from ${back.ref}, which is closed now`);
    const was = this.changesOf(e.seq).get("ord");
    const ord = was ? (was.old === null ? null : Number(was.old)) : row.ord;
    this.setItem(row.pk, { release: back?.pk ?? null, ord }, tx.at);
    const ref = this.refOf(row.pk);
    return tx.event("undo", "items", row.pk, ref, [["release", moved.new, moved.old], ["ord", row.ord, ord]], undefined, e.seq);
  }

  /** An event's changes, by field, as stored. */
  private changesOf(seq: number): Map<string, { old: string | null; new: string | null }> {
    const rows = this.sql.exec<{ field: string; old: string | null; new: string | null }>("SELECT field, old, new FROM event_changes WHERE event = ?", seq).toArray();
    return new Map(rows.map((c) => [c.field, { old: c.old, new: c.new }]));
  }

  /**
   * The board's message about a question (§7): to the project's lead, and to whoever asked if that is
   * someone else, never to `except`, who made the write. Whom it went to.
   */
  private notify(tx: Tx, p: ProjectRow, q: QuestionRow, body: string, except?: BoardCaller): string[] {
    const to = new Map<string, string>();
    const skip = except?.kind === "agent" ? addressKey({ name: except.name, laptop: except.laptop }) : null;
    for (const raw of [p.lead, q.asked_by]) {
      // asked_by is an email when the owner asked: not an address, and he knows.
      const addr = raw?.includes("@") ? parseRecipient(raw, "") : null;
      if (addr && addressKey(addr) !== skip && !to.has(addressKey(addr))) to.set(addressKey(addr), raw!);
    }
    if (to.size > 0) tx.messages.push({ to: [...to.values()], body });
    return [...to.values()];
  }

  private option(q: QuestionRow, key: string): { key: string; text: string } {
    const row = this.sql.exec<{ key: string; text: string }>("SELECT key, text FROM question_options WHERE question = ? AND key = ?", q.pk, key).toArray()[0];
    if (!row) throw new BoardError("invalid", `${q.ref} has no option ${key}`);
    return row;
  }

  /** A worker's run (§9), once per id: a replay from the supervisor's outbox changes nothing. */
  private runStart(tx: Tx, op: Op<"run_start">): BoardWritten & { unknown_tasks: string[] } {
    const p = tx.project(this.project(op.project));
    const ctx = supervisorOp(tx.caller, op);
    // The run's row and its events name the same worker and session: the ctx's.
    if (op.id !== ctx.worker) throw new BoardError("forbidden", `run_start ${op.id} is for worker ${ctx.worker}, whose run it is`);
    if (!sameSession(op.session, ctx.session)) throw new BoardError("forbidden", `run_start ${op.id} is in the session its spawn declared`);
    const had = this.runRow(op.id);
    if (had && had.project !== p.pk) throw new BoardError("conflict", `Run ${op.id} is another project's`);
    if (had) return { ref: op.id, seq: 0, unknown_tasks: [] };
    const session = op.session ? this.session(p, op.session) : null;
    // A run is recorded whatever its spawn named: ids that aren't items here are reported, not refused.
    const tasks: ItemRow[] = [];
    const unknown: string[] = [];
    for (const ref of new Set(op.tasks)) {
      const row = this.sql.exec<ItemRow>("SELECT i.* FROM item_refs r JOIN items i ON i.pk = r.item WHERE r.project = ? AND r.ref = ?", p.pk, ref).toArray()[0];
      if (row) tasks.push(row);
      else unknown.push(ref);
    }
    const caller = tx.caller as Extract<BoardCaller, { kind: "agent" }>;
    const pk = this.sql
      .exec<{ pk: number }>(
        `INSERT INTO runs (id, project, session, agent, role, laptop, model, effort, started_at, resumed, remote_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
        op.id,
        p.pk,
        session?.pk ?? null,
        caller.name,
        ctx.role,
        caller.laptop,
        op.model ?? null,
        op.effort ?? null,
        op.started_at,
        op.resumed ? 1 : 0,
        op.remote_url ?? null,
      )
      .one().pk;
    for (const t of tasks) this.sql.exec("INSERT INTO run_tasks (project, run, item) VALUES (?, ?, ?)", p.pk, pk, t.pk);
    const changes: Change[] = [
      ["agent", null, caller.name],
      ["role", null, ctx.role],
      ["session", null, session ? this.sessionName(session) : null],
      ["model", null, op.model],
      ["effort", null, op.effort],
      ["started_at", null, op.started_at],
      ["resumed", null, op.resumed || null],
      ...tasks.map((t): Change => ["task", null, this.refOf(t.pk)]),
    ];
    return { ref: op.id, seq: tx.event("run_start", "runs", pk, op.id, changes), unknown_tasks: unknown };
  }

  /** A run's Remote Control link, set once (§9): no run, or a link already, and nothing changes. */
  private runRemote(tx: Tx, op: Op<"run_remote">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const ctx = supervisorOp(tx.caller, op);
    if (op.id !== ctx.worker) throw new BoardError("forbidden", `run_remote ${op.id} is for worker ${ctx.worker}, whose run it is`);
    const set = this.sql
      .exec<{ pk: number }>("UPDATE runs SET remote_url = ? WHERE project = ? AND id = ? AND remote_url IS NULL RETURNING pk", op.remote_url, p.pk, op.id)
      .toArray()[0];
    if (!set) return { ref: op.id, seq: 0 };
    return { ref: op.id, seq: tx.event("run_remote", "runs", set.pk, op.id, [["remote_url", null, op.remote_url]]) };
  }

  /** A run's end with its tokens and context per call; a second end for an ended run changes nothing. */
  private runEnd(tx: Tx, op: Op<"run_end">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const ctx = supervisorOp(tx.caller, op);
    if (op.id !== ctx.worker) throw new BoardError("forbidden", `run_end ${op.id} is for worker ${ctx.worker}, whose run it is`);
    const run = this.runRow(op.id);
    if (!run || run.project !== p.pk) throw new BoardError("invalid", `No run ${op.id} in ${p.key}`);
    if (run.ended_at) return { ref: op.id, seq: 0 };
    const t = op.tokens;
    // How it ended (ADR 0005 §3): left out by an older supervisor, it stays null, unknown. A finished run has no reason.
    const outcome = op.outcome ?? null;
    const reason = outcome === null || outcome === "done" ? null : op.reason?.trim() || null;
    this.sql.exec(
      "UPDATE runs SET ended_at = ?, input = ?, output = ?, cache_read = ?, cache_write = ?, calls = ?, ctx = ?, outcome = ?, outcome_reason = ? WHERE pk = ?",
      op.ended_at,
      t.input,
      t.output,
      t.cache_read,
      t.cache_write,
      op.calls,
      op.ctx.length > 0 ? ctxBlob(op.ctx) : null,
      outcome,
      reason,
      run.pk,
    );
    const changes: Change[] = [
      ["ended_at", null, op.ended_at],
      ["input", 0, t.input],
      ["output", 0, t.output],
      ["cache_read", 0, t.cache_read],
      ["cache_write", 0, t.cache_write],
      ["calls", 0, op.calls],
      ["outcome", null, outcome],
      ["outcome_reason", null, reason],
    ];
    return { ref: op.id, seq: tx.event("run_end", "runs", run.pk, op.id, changes) };
  }

  /** What a land pushed (§10), once per (repo, sha). */
  private push(tx: Tx, op: Op<"push">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const ctx = supervisorOp(tx.caller, op);
    const ref = `${op.repo}@${op.sha.slice(0, 12)}`;
    if (this.sql.exec("SELECT 1 FROM pushes WHERE repo = ? AND sha = ?", op.repo, op.sha).toArray().length > 0) return { ref, seq: 0 };
    // The worker who landed it, and so its run, session and tasks (§10).
    const run = this.workerRun(p, ctx.worker);
    const pk = this.sql
      .exec<{ pk: number }>(
        "INSERT INTO pushes (project, repo, branch, sha, worker, run, at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING pk",
        p.pk,
        op.repo,
        op.branch,
        op.sha,
        ctx.worker,
        run?.pk ?? null,
        tx.at,
      )
      .one().pk;
    const changes: Change[] = [["repo", null, op.repo], ["branch", null, op.branch], ["sha", null, op.sha], ["worker", null, ctx.worker], ["run", null, run?.id]];
    const seq = tx.event("push", "pushes", pk, ref, changes);
    // A CI run on this commit that reported before the push ties now.
    const untied = this.sql
      .exec<{ pk: number; source: string; external_id: string }>(
        "SELECT pk, source, external_id FROM ci_runs WHERE project = ? AND lower(repo) = lower(?) AND sha = ? AND worker IS NULL AND source != 'slot'",
        p.pk,
        op.repo,
        op.sha,
      )
      .toArray();
    for (const c of untied) {
      const worker = this.tieCi(p, c.pk, op.repo, op.sha);
      tx.event("push", "ci_runs", c.pk, `${c.source} ${c.external_id}`, [["worker", null, worker]]);
    }
    return { ref, seq };
  }

  /**
   * A CI run (§10), upserted by its source and id: one post at its start, one at its end, in either
   * order. Its project is fixed by its first post. An ended status is final, so a late start changes
   * nothing, but what the run lacked is filled in. It ties to the worker whose push it ran on.
   */
  private reportCi(tx: Tx<Caller>, source: string, op: Op<"ci_run">): BoardResults["ci_run"] {
    const ref = `${source} ${op.external_id}`;
    const had = this.sql.exec<CiRunRow>("SELECT * FROM ci_runs WHERE source = ? AND external_id = ?", source, op.external_id).toArray()[0];
    let p: ProjectRow;
    if (had) {
      p = this.sql.exec<ProjectRow>("SELECT * FROM projects WHERE pk = ?", had.project).one();
      if (op.project !== undefined && op.project !== p.key) throw new BoardError("conflict", `Run ${ref} is ${p.key}'s, not ${op.project}'s`);
    } else p = op.project !== undefined ? this.project(op.project) : this.projectOfRepo(op.repo ?? null);
    tx.project(p);
    const fields = ["url", "repo", "branch", "sha", "started_at", "ended_at"] as const;
    if (!had) {
      const pk = this.sql
        .exec<{ pk: number }>(
          `INSERT INTO ci_runs (source, external_id, project, name, url, repo, branch, sha, status, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
          source,
          op.external_id,
          p.pk,
          op.name,
          ...fields.slice(0, 4).map((f) => op[f] ?? null),
          op.status,
          op.started_at ?? null,
          op.ended_at ?? null,
        )
        .one().pk;
      const tied = this.tieCi(p, pk, op.repo ?? null, op.sha ?? null);
      const changes: Change[] = [["name", null, op.name], ["status", null, op.status], ...fields.map((f): Change => [f, null, op[f]]), ["worker", null, tied]];
      return { ref, seq: tx.event("ci_run", "ci_runs", pk, ref, changes), tied };
    }
    const ended = CI_ENDED.has(had.status);
    const cols: Record<string, SqlStorageValue> = {};
    const changes: Change[] = [];
    if (!ended && op.status !== had.status) (cols.status = op.status), changes.push(["status", had.status, op.status]);
    for (const f of fields) {
      const v = op[f];
      if (v === undefined || v === null || v === had[f] || (ended && had[f] !== null)) continue;
      cols[f] = v;
      changes.push([f, had[f], v]);
    }
    const keys = Object.keys(cols);
    if (keys.length > 0) this.sql.exec(`UPDATE ci_runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE pk = ?`, ...keys.map((k) => cols[k]!), had.pk);
    // The push may come before the run or after it, so an untied run looks again each time.
    const tied = had.worker ?? this.tieCi(p, had.pk, (cols.repo as string | undefined) ?? had.repo, (cols.sha as string | undefined) ?? had.sha);
    if (had.worker === null && tied !== null) changes.push(["worker", null, tied]);
    if (changes.length === 0) return { ref, seq: 0, tied };
    return { ref, seq: tx.event("ci_run", "ci_runs", had.pk, ref, changes), tied };
  }

  /** Ties a CI run to the worker that pushed its commit, and so its session and tasks (§10). The worker, or null. */
  private tieCi(p: ProjectRow, ciRun: number, repo: string | null, sha: string | null): string | null {
    if (repo === null || sha === null) return null;
    const push = this.sql
      .exec<{ worker: string; run: number | null }>("SELECT worker, run FROM pushes WHERE project = ? AND lower(repo) = lower(?) AND sha = ?", p.pk, repo, sha)
      .toArray()[0];
    if (!push) return null;
    const run = push.run === null ? undefined : this.sql.exec<RunRow>("SELECT * FROM runs WHERE pk = ?", push.run).one();
    this.sql.exec("UPDATE ci_runs SET worker = ?, session = ? WHERE pk = ?", push.worker, run?.session ?? null, ciRun);
    if (run) this.sql.exec("INSERT OR IGNORE INTO ci_run_tasks (project, ci_run, item) SELECT project, ?, item FROM run_tasks WHERE run = ?", ciRun, run.pk);
    return push.worker;
  }

  /** The one project whose repos include `repo`, for a CI run that doesn't name its project. */
  private projectOfRepo(repo: string | null): ProjectRow {
    const rows = repo === null ? [] : this.sql.exec<ProjectRow>("SELECT p.* FROM project_repos r JOIN projects p ON p.pk = r.project WHERE lower(r.repo) = lower(?)", repo).toArray();
    if (rows.length === 1) return rows[0]!;
    throw new BoardError("invalid", repo === null ? "A CI run names its project, or a repo that is one project's" : `${repo} is ${rows.length === 0 ? "no" : "more than one"} project's repo: name the project`);
  }

  /** A run-slot run (§10): made at its grant, its status and end updated at its release. */
  private slotRun(tx: Tx, op: Op<"slot_run">): BoardWritten {
    const p = tx.project(this.project(op.project));
    const ctx = supervisorOp(tx.caller, op);
    const laptop = (tx.caller as Extract<BoardCaller, { kind: "agent" }>).laptop;
    const ref = `slot ${op.external_id}`;
    const had = this.sql
      .exec<{ pk: number; project: number; laptop: string | null; status: string; started_at: string | null; ended_at: string | null }>(
        "SELECT pk, project, laptop, status, started_at, ended_at FROM ci_runs WHERE source = 'slot' AND external_id = ?",
        op.external_id,
      )
      .toArray()[0];
    if (had) {
      if (had.project !== p.pk || had.laptop !== laptop) throw new BoardError("conflict", `Slot run ${op.external_id} is another ${had.project !== p.pk ? "project" : "laptop"}'s`);
      const changes: Change[] = [];
      const cols: Record<string, SqlStorageValue> = {};
      if (op.status !== had.status) (cols.status = op.status), changes.push(["status", had.status, op.status]);
      if (op.started_at && op.started_at !== had.started_at) (cols.started_at = op.started_at), changes.push(["started_at", had.started_at, op.started_at]);
      if (op.ended_at && op.ended_at !== had.ended_at) (cols.ended_at = op.ended_at), changes.push(["ended_at", had.ended_at, op.ended_at]);
      if (changes.length === 0) return { ref, seq: 0 };
      const keys = Object.keys(cols);
      this.sql.exec(`UPDATE ci_runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE pk = ?`, ...keys.map((k) => cols[k]!), had.pk);
      return { ref, seq: tx.event("slot_run", "ci_runs", had.pk, ref, changes) };
    }
    // The holder is the ctx's worker; its run, if it has one, ties the slot run to a session and tasks.
    const run = this.workerRun(p, ctx.worker);
    const pk = this.sql
      .exec<{ pk: number }>(
        `INSERT INTO ci_runs (source, external_id, project, name, laptop, status, started_at, ended_at, worker, session)
         VALUES ('slot', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
        op.external_id,
        p.pk,
        op.name,
        laptop,
        op.status,
        op.started_at ?? null,
        op.ended_at ?? null,
        ctx.worker,
        run?.session ?? null,
      )
      .one().pk;
    // The tie is direct: the holder's run names its session and tasks (§10).
    if (run) this.sql.exec("INSERT INTO ci_run_tasks (project, ci_run, item) SELECT project, ?, item FROM run_tasks WHERE run = ?", pk, run.pk);
    const changes: Change[] = [["name", null, op.name], ["status", null, op.status], ["started_at", null, op.started_at], ["ended_at", null, op.ended_at], ["worker", null, ctx.worker], ["run", null, run?.id]];
    return { ref, seq: tx.event("slot_run", "ci_runs", pk, ref, changes) };
  }

  // ---------- Sessions, questions, runs ----------

  private sessionRecord(s: SessionRow, withCtx = false): SessionRecord {
    const feature = this.refOf(s.feature);
    const tasks = (role: string) =>
      this.sql.exec<{ item: number }>("SELECT item FROM session_tasks WHERE session = ? AND role = ? ORDER BY item", s.pk, role).toArray().map((r) => this.refOf(r.item));
    const runs = this.sql.exec<RunRow>("SELECT * FROM runs WHERE session = ? ORDER BY started_at, pk", s.pk).toArray();
    return {
      feature,
      kind: s.kind,
      label: s.label,
      started_at: s.started_at,
      ended_at: s.ended_at,
      imported: s.imported === 1,
      close:
        s.need === null
          ? null
          : {
              need: s.need,
              waits_on: this.sql
                .exec<{ ref: string }>("SELECT q.ref FROM session_waits_on w JOIN questions q ON q.pk = w.question WHERE w.session = ? ORDER BY q.pk", s.pk)
                .toArray()
                .map((r) => r.ref),
              blockers: tasks("blocker"),
              majors: tasks("major"),
              minors_fixed: s.minors_fixed ?? 0,
              sent_back: tasks("sent_back"),
              summary: s.summary ?? "",
              handoff_path: s.handoff_path,
              handoff_text: s.handoff_text,
              commit: s.commit_sha,
              closed_by: s.closed_by ?? "",
            },
      tasks_moved: this.tasksMoved(s.pk),
      tokens: this.sessionTokens(s.pk),
      runs: runs.map((r) => this.runRecord(r, withCtx)),
      ci_runs: this.sql
        .exec<CiRunRow>("SELECT * FROM ci_runs WHERE session = ? ORDER BY coalesce(started_at, ended_at), pk", s.pk)
        .toArray()
        .map((c) => this.ciRunRecord(c)),
    };
  }

  private ciRunRecord(c: CiRunRow): CiRunRecord {
    return {
      source: c.source,
      external_id: c.external_id,
      name: c.name,
      url: c.url,
      repo: c.repo,
      branch: c.branch,
      sha: c.sha,
      laptop: c.laptop,
      status: c.status,
      started_at: c.started_at,
      ended_at: c.ended_at,
      worker: c.worker,
      usual_ms: this.usualMs(c),
    };
  }

  /** "Usually about N min" (§10): the median of the last 20 passed runs of the same project, source and name (a slot run's: laptop and name), once there are three. */
  private usualMs(c: CiRunRow): number | null {
    const like =
      c.source === "slot"
        ? this.sql.exec<{ ms: number }>(
            `SELECT (julianday(ended_at) - julianday(started_at)) * 86400000 AS ms FROM ci_runs
             WHERE source = 'slot' AND laptop IS ? AND name = ? AND status = 'passed' AND started_at IS NOT NULL AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 20`,
            c.laptop,
            c.name,
          )
        : this.sql.exec<{ ms: number }>(
            `SELECT (julianday(ended_at) - julianday(started_at)) * 86400000 AS ms FROM ci_runs
             WHERE project = ? AND source = ? AND name = ? AND status = 'passed' AND started_at IS NOT NULL AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 20`,
            c.project,
            c.source,
            c.name,
          );
    const ms = like.toArray().map((r) => r.ms).sort((a, b) => a - b);
    if (ms.length < 3) return null;
    const mid = Math.floor(ms.length / 2);
    return Math.round(ms.length % 2 ? ms[mid]! : (ms[mid - 1]! + ms[mid]!) / 2);
  }

  /** A run; its context per call only when asked (§9): up to 2000 numbers an agent's board_get has no use for. */
  private runRecord(r: RunRow, withCtx = false): RunRecord {
    return {
      id: r.id,
      agent: r.agent,
      role: r.role,
      laptop: r.laptop,
      model: r.model,
      effort: r.effort,
      started_at: r.started_at,
      ended_at: r.ended_at,
      resumed: r.resumed === 1,
      tokens: { input: r.input, output: r.output, cache_read: r.cache_read, cache_write: r.cache_write },
      calls: r.calls,
      ...(withCtx ? { ctx: ctxPoints(r["ctx"] ?? null) } : {}),
      remote_url: (r["remote_url"] as string | null) ?? null,
      tasks: this.sql.exec<{ item: number }>("SELECT item FROM run_tasks WHERE run = ? ORDER BY item", r.pk).toArray().map((t) => this.refOf(t.item)),
      outcome: r.outcome ?? null,
      outcome_reason: r.outcome_reason ?? null,
    };
  }

  /** Every status write tagged with the session, with the last status each item was left in (§6). */
  private tasksMoved(session: number): SessionRecord["tasks_moved"] {
    const rows = this.sql
      .exec<{ pk: number; status: ItemSummary["status"] }>(
        `SELECT e.pk, c.new AS status FROM events e JOIN event_changes c ON c.event = e.seq
         WHERE e.session = ? AND e.tbl = 'items' AND c.field = 'status' ORDER BY e.seq`,
        session,
      )
      .toArray();
    const last = new Map<number, ItemSummary["status"]>();
    for (const r of rows) last.set(r.pk, r.status);
    return [...last].map(([pk, status]) => ({ task: this.refOf(pk), status }));
  }

  private sessionTokens(session: number): TokenTotals {
    return this.sql.exec<TokenTotals>(`SELECT ${TOKENS} FROM runs WHERE session = ?`, session).one();
  }

  private questionRecord(pk: number): QuestionRecord {
    const q = this.sql
      .exec<{
        ref: string;
        kind: QuestionRecord["kind"];
        text: string;
        context: string | null;
        asked_by: string;
        session: number | null;
        needed_before_item: number | null;
        needed_before_release: number | null;
        needed_before_text: string | null;
        state: QuestionRecord["state"];
        answer_key: string | null;
        answer_words: string | null;
        answered_by: string | null;
        answered_at: string | null;
        answered_via: "dashboard" | "conversation" | null;
        created_at: string;
      }>("SELECT * FROM questions WHERE pk = ?", pk)
      .one();
    const holds = this.sql.exec<{ item: number | null; session: number | null }>("SELECT item, session FROM question_holds WHERE question = ? ORDER BY rowid", pk).toArray();
    return {
      ref: q.ref,
      kind: q.kind,
      text: q.text,
      context: q.context,
      asked_by: q.asked_by,
      session: q.session === null ? null : this.sessionRef(q.session),
      needed_before:
        q.needed_before_item !== null
          ? { item: this.refOf(q.needed_before_item) }
          : q.needed_before_release !== null
            ? { release: this.releaseRef(q.needed_before_release) }
            : q.needed_before_text !== null
              ? { text: q.needed_before_text }
              : null,
      options: this.sql
        .exec<{ key: string; text: string; recommended: number }>("SELECT key, text, recommended FROM question_options WHERE question = ? ORDER BY ord", pk)
        .toArray()
        .map((o) => ({ key: o.key, text: o.text, recommended: o.recommended === 1 })),
      holds: holds.flatMap((h) => (h.item !== null ? [this.refOf(h.item)] : [])),
      holds_sessions: holds.flatMap((h) => (h.session !== null ? [this.sessionRef(h.session)!] : [])),
      state: q.state,
      answer:
        q.answered_at === null
          ? null
          : { key: q.answer_key, words: q.answer_words, by: q.answered_by ?? "", at: q.answered_at, via: q.answered_via ?? "conversation" },
      created_at: q.created_at,
    };
  }

  private session(p: ProjectRow, ref: SessionRef): SessionRow {
    const feature = this.item(p, ref.feature);
    const row = this.sql.exec<SessionRow>("SELECT * FROM sessions WHERE feature = ? AND kind = ? AND label = ?", feature.pk, ref.kind, ref.label).toArray()[0];
    if (!row) throw new BoardError("invalid", `No session ${ref.feature} ${ref.kind} ${ref.label} in ${p.key}`);
    return row;
  }

  private sessionName(s: Pick<SessionRow, "feature" | "kind" | "label">): string {
    return `${this.refOf(s.feature)} ${s.kind} ${s.label}`;
  }

  private question(p: ProjectRow, ref: string): QuestionRow {
    const row = this.sql.exec<QuestionRow>("SELECT * FROM questions WHERE project = ? AND ref = ?", p.pk, ref).toArray()[0];
    if (!row) throw new BoardError("invalid", `No question ${ref} in ${p.key}`);
    return row;
  }

  private questionRow(pk: number): QuestionRow {
    return this.sql.exec<QuestionRow>("SELECT * FROM questions WHERE pk = ?", pk).one();
  }

  private runRow(id: string): RunRow | undefined {
    return this.sql.exec<RunRow>("SELECT * FROM runs WHERE id = ?", id).toArray()[0];
  }

  /** A worker's run in this project: its id is the worker's. */
  private workerRun(p: ProjectRow, worker: string): RunRow | undefined {
    const run = this.runRow(worker);
    return run?.project === p.pk ? run : undefined;
  }

  // ---------- Lookups ----------

  private project(key: string): ProjectRow {
    const row = this.sql.exec<ProjectRow>("SELECT * FROM projects WHERE key = ?", key).toArray()[0];
    if (!row) throw new BoardError("invalid", `No project ${key}`);
    return row;
  }

  private readable(caller: BoardCaller, key: string): ProjectRow {
    const p = this.project(key);
    this.rules.requireRead(caller, p);
    return p;
  }

  /** An item's acceptance criteria: how many, and how many still open. */
  private acOf(item: number): { total: number; open: number } {
    const c = this.sql.exec<{ total: number; open: number | null }>("SELECT count(*) AS total, sum(state = 'open') AS open FROM criteria WHERE item = ? AND section = 'ac'", item).one();
    return { total: c.total, open: c.open ?? 0 };
  }

  /** An item of this project by any id it has had. A ref from another project is refused as such. */

  private item(p: ProjectRow, ref: string): ItemRow {
    const row = this.sql.exec<ItemRow>("SELECT i.* FROM item_refs r JOIN items i ON i.pk = r.item WHERE r.project = ? AND r.ref = ?", p.pk, ref).toArray()[0];
    if (row) return row;
    const elsewhere = this.sql.exec("SELECT 1 FROM item_refs WHERE ref = ? AND project != ?", ref, p.pk).toArray().length > 0;
    throw new BoardError("invalid", elsewhere ? `${ref} is not an item of ${p.key}: links stay in one project` : `No item ${ref} in ${p.key}`);
  }

  private items(p: ProjectRow, refs: string[]): ItemRow[] {
    return [...new Set(refs)].map((r) => this.item(p, r));
  }

  private feature(p: ProjectRow, ref: string): ItemRow {
    const row = this.item(p, ref);
    if (row.kind !== "feature") throw new BoardError("invalid", `${ref} is a ${row.kind}, not a feature`);
    if (row.archived_at) throw new BoardError("invalid", `${ref} is archived`);
    return row;
  }

  private release(p: ProjectRow, ref: string): ReleaseRow {
    const row = this.sql.exec<ReleaseRow>("SELECT * FROM releases WHERE project = ? AND ref = ?", p.pk, ref).toArray()[0];
    if (!row) throw new BoardError("invalid", `No release ${ref} in ${p.key}`);
    return row;
  }

  private refOf(item: number): string {
    return this.sql.exec<{ ref: string }>("SELECT ref FROM item_refs WHERE item = ? AND is_primary = 1", item).one().ref;
  }

  private releaseRef(release: number): string {
    return this.sql.exec<{ ref: string }>("SELECT ref FROM releases WHERE pk = ?", release).one().ref;
  }

  private sessionRef(session: number): BoardEvent["actor"]["session"] {
    const s = this.sql.exec<{ feature: number; kind: SessionSummary["kind"]; label: string }>("SELECT feature, kind, label FROM sessions WHERE pk = ?", session).one();
    return { feature: this.refOf(s.feature), kind: s.kind, label: s.label };
  }

  /** The feature an item is under, for the rules. */
  private scope(row: ItemRow): Scope | null {
    const feature = row.kind === "feature" ? row : row.kind === "task" ? this.sql.exec<ItemRow>("SELECT * FROM items WHERE pk = ?", row.parent).one() : null;
    return feature ? { ref: this.refOf(feature.pk), open: feature.open_since !== null } : null;
  }

  private grantRow(project: number | null, agent: string, laptop: string): Record<string, SqlStorageValue> & { pk: number } | undefined {
    return this.sql
      .exec<Record<string, SqlStorageValue> & { pk: number }>(
        "SELECT * FROM grants WHERE ifnull(project, 0) = ifnull(?, 0) AND lower(agent) = lower(?) AND lower(laptop) = lower(?)",
        project,
        agent,
        laptop,
      )
      .toArray()[0];
  }

  private nextOrd(sql: string, ...args: SqlStorageValue[]): number {
    return (this.sql.exec<{ m: number | null }>(sql, ...args).one().m ?? 0) + ORD_STEP;
  }

  private setItem(pk: number, cols: Record<string, SqlStorageValue>, at: string): void {
    const keys = Object.keys(cols);
    if (keys.length === 0) return;
    this.sql.exec(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE pk = ?`, ...keys.map((k) => cols[k]!), at, pk);
  }

  private lastSeq(): number {
    return this.sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM events").one().seq ?? 0;
  }
}

/** One write's caller, time and events. */
/** A caller as the history names them: the owner's email, or an agent's address. */
function whoOf(caller: Caller): string {
  return caller.kind === "owner" ? caller.email : caller.kind === "ci" ? (caller.via ? `${caller.source} via ${caller.via}` : caller.source) : `${caller.name}@${caller.laptop}`;
}

class Tx<C extends Caller = BoardCaller> {
  readonly at = new Date().toISOString();
  readonly seqs: number[] = [];
  readonly refs = new Set<string>();
  /** What the write sends, from the board (§7), in the same transaction. */
  readonly messages: BoardMessage[] = [];
  projectKey: string | null = null;
  private projectPk: number | null = null;
  /** The session a close tags its writes with, whatever the caller's ctx says. */
  private session: number | null = null;

  constructor(
    private readonly sql: SqlStorage,
    readonly caller: C,
  ) {}

  /** Who, as the history names them. */
  get who(): string {
    return whoOf(this.caller);
  }

  inSession(pk: number): void {
    this.session = pk;
  }

  /** The session this write is made in: a close's, or the one the caller's supervisor declared. */
  sessionPk(): number | null {
    if (this.session !== null) return this.session;
    const caller = this.caller;
    const ctx = caller.kind === "agent" && caller.ctx?.project === this.projectKey ? caller.ctx : null;
    if (!ctx?.session) return null;
    return (
      this.sql
        .exec<{ pk: number }>(
          `SELECT s.pk FROM sessions s JOIN item_refs r ON r.item = s.feature
           WHERE s.project = ? AND r.ref = ? AND s.kind = ? AND s.label = ?`,
          this.projectPk,
          ctx.session.feature,
          ctx.session.kind,
          ctx.session.label,
        )
        .toArray()[0]?.pk ?? null
    );
  }

  project<P extends { pk: number; key: string }>(p: P): P {
    this.projectPk = p.pk;
    this.projectKey = p.key;
    return p;
  }

  /** Records a change to one record, with one row per field that changed. */
  event(op: string, table: string, pk: number, ref: string | null, changes: Change[], reason?: string, undoOf?: number): number {
    const caller = this.caller;
    const ctx = caller.kind === "agent" && caller.ctx?.project === this.projectKey ? caller.ctx : null;
    const session = this.sessionPk();
    const seq = this.sql
      .exec<{ seq: number }>(
        `INSERT INTO events (at, project, actor_kind, actor, role, worker, session, op, tbl, pk, ref, reason, undo_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
        this.at,
        this.projectPk,
        caller.kind,
        this.who,
        ctx?.role ?? null,
        ctx?.worker ?? null,
        session,
        op,
        table,
        pk,
        ref,
        reason ?? null,
        undoOf ?? null,
      )
      .one().seq;
    for (const [field, old, now] of changes) {
      if (old === now || ((old === null || old === undefined) && (now === null || now === undefined))) continue;
      this.sql.exec("INSERT INTO event_changes (event, field, old, new) VALUES (?, ?, ?, ?)", seq, field, shown(old), shown(now));
    }
    this.seqs.push(seq);
    if (ref) this.refs.add(ref);
    return seq;
  }
}

function shown(v: Value): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function ownerOnly(caller: BoardCaller, what: string): void {
  if (caller.kind !== "owner") throw new BoardError("forbidden", `${what} is Casper's gate; only the owner may`);
}

/**
 * The supervisor's own operations (ADR 0001 §4, §8): made only over the laptop's pinned supervisor
 * connection, for a worker of the project. None is the owner's: no operation opens a feature by hand.
 */
function supervisorOp(caller: BoardCaller, op: { op: string; project: string }): BoardCtx {
  if (caller.kind === "owner") throw new BoardError("forbidden", `${op.op} is the supervisor's, for a worker it runs; no one makes it by hand`);
  if (!caller.supervisor || !caller.ctx) throw new BoardError("forbidden", `${op.op} is made only by a laptop's supervisor, for a worker it runs`);
  if (caller.ctx.project !== op.project) throw new BoardError("forbidden", `${op.op} for ${op.project} comes from a worker of ${op.project}, not ${caller.ctx.project}`);
  return caller.ctx;
}

function sameSession(a: SessionRef | null, b: SessionRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.feature === b.feature && a.kind === b.kind && a.label === b.label;
}

/** Context per call as the runs table keeps it: little-endian uint32s (§9). */
function ctxPoints(blob: SqlStorageValue): number[] {
  if (!(blob instanceof ArrayBuffer)) return [];
  const view = new DataView(blob);
  return Array.from({ length: Math.floor(blob.byteLength / 4) }, (_, i) => view.getUint32(i * 4, true));
}

/** Context per call as the runs table keeps it: little-endian uint32s (§9). */
function ctxBlob(points: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(points.length * 4);
  const view = new DataView(buf);
  points.forEach((v, i) => view.setUint32(i * 4, v, true));
  return buf;
}

/**
 * A supervisor's gh adapter's run (§10): over its pinned connection, for a project its config puts on
 * the service, as registered. It has no worker, so no ctx; this is the only supervisor op without one.
 */
function ghRun(caller: BoardCaller, op: Op<"ci_run">): Op<"ci_run"> {
  if (caller.kind !== "agent" || !caller.supervisor) throw new BoardError("forbidden", "A CI run is reported by its CI system (POST /v1/runs) or a supervisor's gh adapter");
  if (op.project === undefined) throw new BoardError("invalid", "A supervisor's CI run names its project");
  if (!(caller.serves ?? []).includes(op.project)) {
    throw new BoardError("forbidden", `${caller.laptop}'s supervisor didn't register ${op.project} as a project it serves on the board, so it reports none of its CI runs`);
  }
  return op;
}

function oldestFirst(a: WaitRecord, b: WaitRecord): number {
  return a.since.localeCompare(b.since) || a.project.localeCompare(b.project) || a.ref.localeCompare(b.ref, undefined, { numeric: true });
}

function openRelease(r: ReleaseRow): void {
  if (r.status === "closed") throw new BoardError("conflict", `${r.ref} is closed: a closed release takes no items`);
}

/** A bug's acceptance criterion (bugs.md 5), given when it is created or becomes a bug with none. */
export const NO_LONGER = "It no longer happens";
const BUG_DONE = `it is Done once its fix has landed and every criterion ("${NO_LONGER}") is checked, with the landed commit as the evidence; to close it without a fix, archive it with a reason`;

function summary(r: SummaryRow): ItemSummary {
  return {
    ref: r.ref,
    kind: r.kind,
    type: r.type,
    status: r.status,
    title: r.title,
    parent: r.parent_ref,
    release: r.release_ref,
    ord: r.ord,
    labels: r.labels ? r.labels.split(SEP) : [],
    progress: { checked: r.ac_checked, total: r.ac_total },
    tasks: r.kind === "feature" ? { done: r.tasks_done ?? 0, total: r.tasks_total ?? 0 } : null,
    open_since: r.open_since,
    archived_at: r.archived_at,
    created_at: r.created_at,
    ...(r.kind === "backlog" ? triage(r) : {}),
  };
}

/** Casper's words on a list row, clipped; board_get has them whole (Toad, BOB-8 review 4). */
export const WORDS_CLIP = 280;

/** A backlog row's triage fields, those it has: a page of rows is paid for in tokens. */
function triage(r: SummaryRow): Partial<ItemSummary> {
  const words = r.casper_words && r.casper_words.length > WORDS_CLIP ? `${r.casper_words.slice(0, WORDS_CLIP - 1)}…` : r.casper_words;
  const out: Partial<ItemSummary> = {};
  if (r.captured_by) out.captured_by = r.captured_by;
  if (words) out.casper_words = words;
  if (r.bug_where) out.bug_where = r.bug_where;
  if (r.blocks_use === 1) out.blocks_use = true;
  if (r.parent_hint_ref) out.parent_hint = r.parent_hint_ref;
  return out;
}

function zeroTokens(): TokenTotals {
  return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
}

function tokensOf(r: TokenTotals): TokenTotals {
  return { input: r.input, output: r.output, cache_read: r.cache_read, cache_write: r.cache_write };
}

function addTokens(to: TokenTotals, r: TokenTotals): void {
  to.input += r.input;
  to.output += r.output;
  to.cache_read += r.cache_read;
  to.cache_write += r.cache_write;
}

/** All four kinds together, as a heavy session is measured. */
function sumTokens(t: TokenTotals): number {
  return t.input + t.output + t.cache_read + t.cache_write;
}

/** The median of totals by their sum: the middle one, or the mean of the middle two. */
function medianTokens(list: TokenTotals[]): TokenTotals {
  const sorted = [...list].sort((a, b) => sumTokens(a) - sumTokens(b));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid]!;
  const [a, b] = [sorted[mid - 1]!, sorted[mid]!];
  return { input: Math.round((a.input + b.input) / 2), output: Math.round((a.output + b.output) / 2), cache_read: Math.round((a.cache_read + b.cache_read) / 2), cache_write: Math.round((a.cache_write + b.cache_write) / 2) };
}
