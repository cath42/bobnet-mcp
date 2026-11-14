import type {
  BoardCaller,
  BoardEvent,
  BoardOp,
  BoardResults,
  BoardWritten,
  CriterionRecord,
  GrantField,
  GrantRecord,
  ItemRecord,
  ItemSummary,
  ProjectRecord,
  ReleaseRecord,
  SessionSummary,
} from "@bobnet/protocol";
import { BoardError } from "./errors.ts";
import { Rules, type Scope } from "./rules.ts";

// The operation layer (ADR 0001 §2, §3, §5): every read and write of the board.
// Links are checked here first so a refusal names its reason; the schema's
// constraints are the backstop. Each write runs in the caller's transaction
// and records an event for every record it changes.

const PAGE = 100;
const ORD_STEP = 1000;

type Op<K extends BoardOp["op"]> = Extract<BoardOp, { op: K }>;
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

type SummaryRow = ItemRow & {
  ref: string;
  parent_ref: string | null;
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
    (SELECT ref FROM releases WHERE pk = coalesce(i.release, (SELECT f.release FROM items f WHERE f.pk = i.parent))) AS release_ref,
    (SELECT group_concat(label, char(31)) FROM (SELECT label FROM item_labels WHERE item = i.pk ORDER BY label)) AS labels,
    CASE WHEN i.kind = 'feature'
      THEN (SELECT count(*) FROM criteria c JOIN items t ON t.pk = c.item WHERE t.parent = i.pk AND t.archived_at IS NULL AND c.section = 'ac')
      ELSE (SELECT count(*) FROM criteria c WHERE c.item = i.pk AND c.section = 'ac') END AS ac_total,
    CASE WHEN i.kind = 'feature'
      THEN (SELECT count(*) FROM criteria c JOIN items t ON t.pk = c.item WHERE t.parent = i.pk AND t.archived_at IS NULL AND c.section = 'ac' AND c.state = 'checked')
      ELSE (SELECT count(*) FROM criteria c WHERE c.item = i.pk AND c.section = 'ac' AND c.state = 'checked') END AS ac_checked,
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

  read(caller: BoardCaller, op: Op<"projects" | "list" | "get" | "grants">): BoardResults["projects" | "list" | "get" | "grants"] {
    switch (op.op) {
      case "projects":
        return this.projects(caller);
      case "list":
        return this.list(caller, op);
      case "get":
        return this.get(caller, op);
      case "grants":
        return this.grants(caller, op.project);
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
    if (/^R\d+$/.test(op.ref)) {
      const r = this.release(p, op.ref);
      return { release: this.releaseRecord(r), ...(op.history ? { history: this.history("releases", r.pk) } : {}) };
    }
    const row = this.item(p, op.ref);
    return { item: this.itemRecord(row), ...(op.history ? { history: this.history("items", row.pk) } : {}) };
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
    };
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
  write(caller: BoardCaller, op: Exclude<BoardOp, Op<"projects" | "list" | "get" | "grants">>): { result: BoardWritten; changed: { project: string; seq: number; refs: string[] } | null } {
    const tx = new Tx(this.sql, caller);
    const result = this.apply(tx, op);
    if (tx.seqs.length === 0) return { result: { ...result, seq: this.lastSeq() }, changed: null };
    return { result, changed: { project: tx.projectKey ?? "*", seq: tx.seqs.at(-1)!, refs: [...tx.refs] } };
  }

  private apply(tx: Tx, op: Exclude<BoardOp, Op<"projects" | "list" | "get" | "grants">>): BoardWritten & { created?: boolean } {
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
      case "grant":
        return this.grant(tx, op);
      case "revoke":
        return this.revoke(tx, op);
      case "session_join":
        return this.sessionJoin(tx, op);
    }
  }

  private createProject(tx: Tx, op: Op<"create_project">): BoardWritten {
    ownerOnly(tx.caller, "Creating a project");
    if (this.sql.exec("SELECT 1 FROM projects WHERE key = ? OR prefix = ?", op.key, op.prefix).toArray().length > 0) {
      throw new BoardError("conflict", `A project ${op.key} or with prefix ${op.prefix} exists`);
    }
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

  private create(tx: Tx, op: Op<"create">): BoardWritten {
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
    const scope = parent ? this.scope(parent) : null;
    const where = parent ? `${scope!.ref}'s tasks` : `${op.kind === "feature" ? "features" : "the backlog"}`;
    this.rules.require(tx.caller, p, "create", scope, where);
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
        `INSERT INTO items (project, kind, type, status, title, description, notes, plan, parent, release, ord, parent_hint, bug_where, blocks_use, found_in, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
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
    for (const label of new Set(op.labels ?? [])) {
      this.sql.exec("INSERT INTO item_labels (item, label) VALUES (?, ?)", pk, label);
      changes.push(["label", null, label]);
    }
    for (const dep of deps) {
      this.sql.exec("INSERT INTO item_deps (project, item, dep) VALUES (?, ?, ?)", p.pk, pk, dep.pk);
      changes.push(["dep", null, this.refOf(dep.pk)]);
    }
    const n = { ac: 0, dod: 0 };
    for (const c of op.criteria ?? []) {
      const ord = ++n[c.section];
      this.sql.exec("INSERT INTO criteria (item, section, ord, text, casper_gate) VALUES (?, ?, ?, ?, ?)", pk, c.section, ord, c.text, c.casper_gate ? 1 : 0);
      changes.push([`${c.section} #${ord}`, null, c.text]);
      if (c.casper_gate) changes.push([`${c.section} #${ord} casper_gate`, null, true]);
    }
    return { ref, seq: tx.event("create", "items", pk, ref, changes, op.reason) };
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
      if (set.bug_where !== undefined) field("bug_where", set.bug_where);
      if (set.blocks_use !== undefined) field("blocks_use", set.blocks_use ? 1 : 0, set.blocks_use, row.blocks_use === 1);
      if (set.found_in !== undefined) {
        const f = set.found_in === null ? null : this.feature(p, set.found_in);
        field("found_in", f?.pk ?? null, set.found_in, row.found_in === null ? null : this.refOf(row.found_in));
      }
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
    this.rules.requireFlag(tx.caller, p, "sessions");
    const feature = this.feature(p, op.session.feature);
    const ref = this.refOf(feature.pk);
    if (feature.archived_at) throw new BoardError("invalid", `${ref} is archived`);
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
    return { ref: name, seq, created: !existing };
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
class Tx {
  readonly at = new Date().toISOString();
  readonly seqs: number[] = [];
  readonly refs = new Set<string>();
  projectKey: string | null = null;
  private projectPk: number | null = null;

  constructor(
    private readonly sql: SqlStorage,
    readonly caller: BoardCaller,
  ) {}

  /** Who, as the history names them. */
  get who(): string {
    return this.caller.kind === "owner" ? this.caller.email : `${this.caller.name}@${this.caller.laptop}`;
  }

  project<P extends { pk: number; key: string }>(p: P): P {
    this.projectPk = p.pk;
    this.projectKey = p.key;
    return p;
  }

  /** Records a change to one record, with one row per field that changed. */
  event(op: string, table: string, pk: number, ref: string | null, changes: Change[], reason?: string): number {
    const caller = this.caller;
    const ctx = caller.kind === "agent" && caller.ctx?.project === this.projectKey ? caller.ctx : null;
    const session = ctx?.session
      ? (this.sql
          .exec<{ pk: number }>(
            `SELECT s.pk FROM sessions s JOIN item_refs r ON r.item = s.feature
             WHERE s.project = ? AND r.ref = ? AND s.kind = ? AND s.label = ?`,
            this.projectPk,
            ctx.session.feature,
            ctx.session.kind,
            ctx.session.label,
          )
          .toArray()[0]?.pk ?? null)
      : null;
    const seq = this.sql
      .exec<{ seq: number }>(
        `INSERT INTO events (at, project, actor_kind, actor, role, worker, session, op, tbl, pk, ref, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
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

function openRelease(r: ReleaseRow): void {
  if (r.status === "closed") throw new BoardError("conflict", `${r.ref} is closed: a closed release takes no items`);
}

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
  };
}
