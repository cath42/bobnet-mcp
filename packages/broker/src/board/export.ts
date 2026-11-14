import {
  BOARD_EXPORT_FORMAT,
  BoardExport,
  type BoardExportV1,
  type BoardImportReply,
  type ExportEvent,
  type ExportGrant,
  type ExportItem,
  type ExportProject,
  type ExportTable,
  type Identity,
  recordKey,
  type SessionRef,
  sessionKey,
} from "@bobnet/protocol";
import { BoardError } from "./errors.ts";
import { Rules } from "./rules.ts";

// Export and import (ADR 0001 §11): the whole board as one document, rows with
// refs instead of pks, in a stable order so the nightly git diff shows only what
// changed; and that document brought back into projects the board doesn't have.
// An import never merges: it refuses a project that exists.

type Row = Record<string, SqlStorageValue>;
type Rows<T> = T & Row;

const bool = (v: unknown) => v === 1;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Context per call as runs keep it: little-endian uint32s (§9). */
function ctxPoints(blob: unknown): number[] | null {
  if (!(blob instanceof ArrayBuffer)) return null;
  const view = new DataView(blob);
  return Array.from({ length: Math.floor(blob.byteLength / 4) }, (_, i) => view.getUint32(i * 4, true));
}

function ctxBlob(points: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(points.length * 4);
  const view = new DataView(buf);
  points.forEach((v, i) => view.setUint32(i * 4, v, true));
  return buf;
}

// ---------- Export ----------

/**
 * The board as one document for `by`: the owner gets every project; a laptop gets the projects its
 * read rules cover, and the rules for every project only with at least one of them.
 */
export function exportBoard(sql: SqlStorage, by: Identity, source: string | null = "BobNet's board"): BoardExportV1 {
  const readable = by.kind === "owner" ? null : new Rules(sql).readableByLaptop(by.laptop);
  const all = <T extends Row>(q: string, ...args: unknown[]) => sql.exec<T>(q, ...args).toArray();
  const itemRef = new Map(all<Rows<{ item: number; ref: string }>>("SELECT item, ref FROM item_refs WHERE is_primary = 1").map((r) => [r.item, r.ref]));
  const releaseRef = new Map(all<Rows<{ pk: number; ref: string }>>("SELECT pk, ref FROM releases").map((r) => [r.pk, r.ref]));
  const questionRef = new Map(all<Rows<{ pk: number; ref: string }>>("SELECT pk, ref FROM questions").map((r) => [r.pk, r.ref]));
  const runId = new Map(all<Rows<{ pk: number; id: string }>>("SELECT pk, id FROM runs").map((r) => [r.pk, r.id]));
  const sessionRef = new Map(
    all<Rows<{ pk: number; feature: number; kind: SessionRef["kind"]; label: string }>>("SELECT pk, feature, kind, label FROM sessions").map((s) => [
      s.pk,
      { feature: itemRef.get(s.feature)!, kind: s.kind, label: s.label },
    ]),
  );
  const ref = (pk: unknown) => (pk === null || pk === undefined ? null : itemRef.get(pk as number)!);
  const session = (pk: unknown) => (pk === null || pk === undefined ? null : sessionRef.get(pk as number)!);

  /** An event's record as it is named now; null when it is gone. */
  const record = (table: string, pk: number): string | null => {
    const one = <T extends Row>(q: string) => sql.exec<T>(q, pk).toArray()[0];
    switch (table) {
      case "projects":
        return one<Rows<{ key: string }>>("SELECT key FROM projects WHERE pk = ?")?.key ?? null;
      case "releases":
        return releaseRef.get(pk) ?? null;
      case "items":
        return itemRef.get(pk) ?? null;
      case "sessions": {
        const s = sessionRef.get(pk);
        return s ? sessionKey(s) : null;
      }
      case "questions":
        return questionRef.get(pk) ?? null;
      case "runs":
        return runId.get(pk) ?? null;
      case "pushes": {
        const p = one<Rows<{ repo: string; sha: string }>>("SELECT repo, sha FROM pushes WHERE pk = ?");
        return p ? recordKey.push(p) : null;
      }
      case "ci_runs": {
        const c = one<Rows<{ source: string; external_id: string }>>("SELECT source, external_id FROM ci_runs WHERE pk = ?");
        return c ? recordKey.ciRun(c) : null;
      }
      case "grants": {
        const g = one<Rows<{ agent: string; laptop: string }>>("SELECT agent, laptop FROM grants WHERE pk = ?");
        return g ? recordKey.grant(g) : null;
      }
    }
    return null;
  };

  const grants = (where: string, ...args: unknown[]): ExportGrant[] =>
    all<Row>(`SELECT * FROM grants WHERE ${where} ORDER BY lower(agent), lower(laptop)`, ...args).map((g) => ({
      agent: g["agent"] as string,
      laptop: g["laptop"] as string,
      role: g["role"] as string,
      read: bool(g["read"]),
      items: g["items"] as ExportGrant["items"],
      fields: all<Rows<{ field: ExportGrant["fields"][number] }>>("SELECT field FROM grant_fields WHERE grant_pk = ? ORDER BY field", g["pk"]).map((f) => f.field),
      sessions: bool(g["sessions"]),
      questions: bool(g["questions"]),
      admin: bool(g["admin"]),
    }));

  const events = (where: string, ...args: unknown[]): ExportEvent[] =>
    all<Row>(`SELECT * FROM events WHERE ${where} ORDER BY seq`, ...args).map((e) => ({
      seq: e["seq"] as number,
      at: e["at"] as string,
      actor: { kind: e["actor_kind"] as ExportEvent["actor"]["kind"], who: e["actor"] as string, role: str(e["role"]), worker: str(e["worker"]), session: session(e["session"]) },
      op: e["op"] as string,
      table: e["tbl"] as ExportTable,
      record: record(e["tbl"] as string, e["pk"] as number),
      ref: str(e["ref"]),
      reason: str(e["reason"]),
      undo_of: (e["undo_of"] as number | null) ?? null,
      changes: all<Rows<{ field: string; old: string | null; new: string | null }>>("SELECT field, old, new FROM event_changes WHERE event = ? ORDER BY rowid", e["seq"]).map((c) => ({
        field: c.field,
        old: c.old,
        new: c.new,
      })),
    }));

  const projects = all<Row>("SELECT * FROM projects ORDER BY key").filter((p) => readable === null || readable.has(p["pk"] as number)).map((p): ExportProject => {
    const pk = p["pk"] as number;
    const tasksOf = (q: string, of: unknown) => all<Rows<{ item: number }>>(q, of).map((t) => ref(t.item)!).sort();
    return {
      key: p["key"] as string,
      name: p["name"] as string,
      prefix: p["prefix"] as string,
      draft_prefix: str(p["draft_prefix"]),
      lead: str(p["lead"]),
      po: str(p["po"]),
      repos: all<Rows<{ repo: string }>>("SELECT repo FROM project_repos WHERE project = ? ORDER BY repo", pk).map((r) => r.repo),
      next: { item: p["next_item"] as number, release: p["next_release"] as number, question: p["next_question"] as number, action: p["next_action"] as number },
      created_at: p["created_at"] as string,
      releases: all<Row>("SELECT * FROM releases WHERE project = ? ORDER BY pk", pk).map((r) => ({
        ref: r["ref"] as string,
        title: r["title"] as string,
        goal: str(r["goal"]),
        status: r["status"] as ExportProject["releases"][number]["status"],
        ord: (r["ord"] as number | null) ?? null,
        spec_url: str(r["spec_url"]),
        closed_at: str(r["closed_at"]),
        closed_by: str(r["closed_by"]),
      })),
      items: all<Row>("SELECT * FROM items WHERE project = ? ORDER BY pk", pk).map((i): ExportItem => ({
        ref: ref(i["pk"])!,
        aliases: all<Rows<{ ref: string }>>("SELECT ref FROM item_refs WHERE item = ? AND is_primary = 0 ORDER BY ref", i["pk"]).map((r) => r.ref),
        kind: i["kind"] as ExportItem["kind"],
        type: i["type"] as ExportItem["type"],
        status: i["status"] as ExportItem["status"],
        title: i["title"] as string,
        description: str(i["description"]),
        notes: str(i["notes"]),
        plan: str(i["plan"]),
        parent: ref(i["parent"]),
        release: i["release"] === null ? null : releaseRef.get(i["release"] as number)!,
        ord: (i["ord"] as number | null) ?? null,
        open_since: str(i["open_since"]),
        archived_at: str(i["archived_at"]),
        archive_reason: str(i["archive_reason"]),
        captured_by: str(i["captured_by"]),
        captured_session: session(i["captured_session"]),
        casper_words: str(i["casper_words"]),
        capture_id: str(i["capture_id"]),
        parent_hint: ref(i["parent_hint"]),
        bug_where: i["bug_where"] as ExportItem["bug_where"],
        blocks_use: bool(i["blocks_use"]),
        found_in: ref(i["found_in"]),
        labels: all<Rows<{ label: string }>>("SELECT label FROM item_labels WHERE item = ? ORDER BY label", i["pk"]).map((l) => l.label),
        deps: tasksOf("SELECT dep AS item FROM item_deps WHERE item = ?", i["pk"]),
        criteria: all<Row>("SELECT * FROM criteria WHERE item = ? ORDER BY section, ord", i["pk"]).map((c) => ({
          section: c["section"] as "ac" | "dod",
          n: c["ord"] as number,
          text: c["text"] as string,
          evidence: str(c["evidence"]),
          state: c["state"] as "open" | "checked",
          checked_by: str(c["checked_by"]),
          checked_at: str(c["checked_at"]),
          casper_gate: bool(c["casper_gate"]),
        })),
        created_at: i["created_at"] as string,
        updated_at: i["updated_at"] as string,
      })),
      sessions: all<Row>("SELECT * FROM sessions WHERE project = ? ORDER BY pk", pk).map((s) => ({
        ...sessionRef.get(s["pk"] as number)!,
        started_at: s["started_at"] as string,
        ended_at: str(s["ended_at"]),
        imported: bool(s["imported"]),
        need: s["need"] as ExportProject["sessions"][number]["need"],
        minors_fixed: (s["minors_fixed"] as number | null) ?? null,
        summary: str(s["summary"]),
        handoff_path: str(s["handoff_path"]),
        handoff_text: str(s["handoff_text"]),
        commit_sha: str(s["commit_sha"]),
        closed_by: str(s["closed_by"]),
        tasks: all<Rows<{ item: number; role: "blocker" | "major" | "sent_back" }>>("SELECT item, role FROM session_tasks WHERE session = ? ORDER BY role, item", s["pk"]).map((t) => ({
          item: ref(t.item)!,
          role: t.role,
        })),
        waits_on: all<Rows<{ question: number }>>("SELECT question FROM session_waits_on WHERE session = ? ORDER BY question", s["pk"]).map((w) => questionRef.get(w.question)!),
      })),
      questions: all<Row>("SELECT * FROM questions WHERE project = ? ORDER BY pk", pk).map((q) => ({
        ref: q["ref"] as string,
        kind: q["kind"] as "question" | "action",
        text: q["text"] as string,
        context: str(q["context"]),
        asked_by: q["asked_by"] as string,
        session: session(q["session"]),
        needed_before:
          q["needed_before_item"] !== null
            ? { item: ref(q["needed_before_item"])! }
            : q["needed_before_release"] !== null
              ? { release: releaseRef.get(q["needed_before_release"] as number)! }
              : q["needed_before_text"] !== null
                ? { text: q["needed_before_text"] as string }
                : null,
        state: q["state"] as ExportProject["questions"][number]["state"],
        answer_key: str(q["answer_key"]),
        answer_words: str(q["answer_words"]),
        answered_by: str(q["answered_by"]),
        answered_at: str(q["answered_at"]),
        answered_via: q["answered_via"] as "dashboard" | "conversation" | null,
        created_at: q["created_at"] as string,
        options: all<Row>("SELECT * FROM question_options WHERE question = ? ORDER BY ord", q["pk"]).map((o) => ({ key: o["key"] as string, text: o["text"] as string, recommended: bool(o["recommended"]) })),
        holds: all<Rows<{ item: number | null; session: number | null }>>("SELECT item, session FROM question_holds WHERE question = ? ORDER BY rowid", q["pk"]).map((h) =>
          h.item !== null ? { item: ref(h.item)! } : { session: session(h.session)! },
        ),
      })),
      runs: all<Row>("SELECT * FROM runs WHERE project = ? ORDER BY pk", pk).map((r) => ({
        id: r["id"] as string,
        session: session(r["session"]),
        agent: r["agent"] as string,
        role: r["role"] as string,
        laptop: r["laptop"] as string,
        model: str(r["model"]),
        effort: str(r["effort"]),
        started_at: r["started_at"] as string,
        ended_at: str(r["ended_at"]),
        resumed: bool(r["resumed"]),
        input: r["input"] as number,
        output: r["output"] as number,
        cache_read: r["cache_read"] as number,
        cache_write: r["cache_write"] as number,
        calls: r["calls"] as number,
        ctx: ctxPoints(r["ctx"]),
        remote_url: str(r["remote_url"]),
        tasks: tasksOf("SELECT item FROM run_tasks WHERE run = ?", r["pk"]),
      })),
      pushes: all<Row>("SELECT * FROM pushes WHERE project = ? ORDER BY pk", pk).map((x) => ({
        repo: x["repo"] as string,
        branch: x["branch"] as string,
        sha: x["sha"] as string,
        worker: x["worker"] as string,
        run: x["run"] === null ? null : runId.get(x["run"] as number)!,
        at: x["at"] as string,
      })),
      ci_runs: all<Row>("SELECT * FROM ci_runs WHERE project = ? ORDER BY pk", pk).map((c) => ({
        source: c["source"] as string,
        external_id: c["external_id"] as string,
        name: c["name"] as string,
        url: str(c["url"]),
        repo: str(c["repo"]),
        branch: str(c["branch"]),
        sha: str(c["sha"]),
        laptop: str(c["laptop"]),
        status: c["status"] as ExportProject["ci_runs"][number]["status"],
        started_at: str(c["started_at"]),
        ended_at: str(c["ended_at"]),
        worker: str(c["worker"]),
        session: session(c["session"]),
        tasks: tasksOf("SELECT item FROM ci_run_tasks WHERE ci_run = ?", c["pk"]),
      })),
      grants: grants("project = ?", pk),
      events: events("project = ?", pk),
    };
  });

  const last = sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM events").one().seq ?? 0;
  return {
    format: BOARD_EXPORT_FORMAT,
    version: 1,
    exported_at: new Date().toISOString(),
    source,
    last_event_seq: last,
    grants: projects.length > 0 ? grants("project IS NULL") : [],
    events: projects.length > 0 ? events("project IS NULL") : [],
    projects,
  };
}

// ---------- Import ----------

/** Who imports, as the Worker verified them: the owner, or a laptop (its supervisor's import command). */
export type Importer = Identity;

/** The highest n among ids `<prefix>-n` (and `<prefix>-n.m`), or 0. */
function highest(refs: Iterable<string>, prefix: string): number {
  let n = 0;
  const re = new RegExp(`^${prefix}-(\\d+)(?:\\.\\d+)*$`);
  for (const r of refs) {
    const m = re.exec(r);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n;
}

/**
 * Brings a document's projects into the board, in the caller's transaction: every row, its history
 * kept, plus one event per project saying where it came from. Refuses a project the board has, by key
 * or prefix; never merges. Each counter starts past every id the project brings, its aliases too.
 */
export function importBoard(sql: SqlStorage, by: Importer, input: unknown): Extract<BoardImportReply, { ok: true }> {
  const parsed = BoardExport.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BoardError("invalid", `Not a board export: ${issue?.path.join(".") || "document"}: ${issue?.message ?? "invalid"}`);
  }
  const doc = parsed.data;
  const exists = (q: string, ...args: SqlStorageValue[]) => sql.exec(q, ...args).toArray().length > 0;

  const keys = new Set<string>();
  const prefixes = new Set<string>();
  for (const p of doc.projects) {
    for (const pre of [p.prefix, p.draft_prefix]) {
      if (pre === "Q" || pre === "A") throw new BoardError("invalid", `${p.key}: prefixes Q and A are questions' and actions'`);
      if (pre !== null && (prefixes.has(pre) || exists("SELECT 1 FROM projects WHERE prefix = ? OR draft_prefix = ?", pre, pre))) {
        throw new BoardError("conflict", `${p.key}: a project with prefix ${pre} exists; an import brings new projects only`);
      }
      if (pre !== null) prefixes.add(pre);
    }
    if (keys.has(p.key) || exists("SELECT 1 FROM projects WHERE key = ?", p.key)) {
      throw new BoardError("conflict", `Project ${p.key} exists; an import brings new projects only, never into one the board has`);
    }
    keys.add(p.key);
  }
  if (doc.grants.length > 0 || doc.events.length > 0) {
    // Only the owner makes rules for every project; a laptop brings them only to rebuild an empty board.
    if (by.kind !== "owner" && exists("SELECT 1 FROM projects UNION ALL SELECT 1 FROM grants UNION ALL SELECT 1 FROM events")) {
      throw new BoardError("forbidden", "Only the owner brings rules for every project into a board that isn't empty");
    }
    if (exists("SELECT 1 FROM events WHERE project IS NULL UNION ALL SELECT 1 FROM grants WHERE project IS NULL")) {
      throw new BoardError("conflict", "The board has rules for every project; an import brings them only into a board without any");
    }
  }

  const at = new Date().toISOString();
  const who = by.kind === "owner" ? { kind: "owner", who: by.email } : { kind: "board", who: `import@${by.laptop}` };
  /** The exporting board's event numbers, to this board's. */
  const seqs = new Map<number, number>();
  const out: Extract<BoardImportReply, { ok: true }>["projects"] = [];

  if (doc.grants.length > 0 || doc.events.length > 0) {
    const records = new Map<ExportTable, Map<string, number>>([["grants", insertGrants(sql, null, doc.grants)]]);
    insertEvents(sql, null, doc.events, records, new Map(), seqs);
  }
  for (const p of doc.projects) out.push(importProject(sql, p, doc, at, who, seqs));
  return { ok: true, projects: out };
}

function importProject(sql: SqlStorage, p: ExportProject, doc: BoardExport, at: string, who: { kind: string; who: string }, seqs: Map<number, number>) {
  const bad = (what: string): never => {
    throw new BoardError("invalid", `${p.key}: ${what}`);
  };

  // Every id once, primary or alias; each primary under the project's prefixes.
  const refs = new Map<string, ExportItem>();
  for (const i of p.items) {
    if (!i.ref.startsWith(`${p.prefix}-`) && !(p.draft_prefix && i.ref.startsWith(`${p.draft_prefix}-`))) bad(`${i.ref} isn't under prefix ${p.prefix}${p.draft_prefix ? ` or ${p.draft_prefix}` : ""}`);
    for (const r of [i.ref, ...i.aliases]) {
      if (refs.has(r)) bad(`${r} is the id of two items`);
      refs.set(r, i);
    }
  }
  const releases = new Set(p.releases.map((r) => r.ref));
  if (releases.size !== p.releases.length) bad("a release ref appears twice");
  const item = (r: string, what: string) => refs.get(r) ?? bad(`${what} ${r} is not in the export`);
  const feature = (r: string, what: string) => {
    const f = item(r, what);
    if (f.kind !== "feature") bad(`${what} ${r} is a ${f.kind}, not a feature`);
    return f;
  };
  for (const i of p.items) {
    if (i.parent) feature(i.parent, `${i.ref}'s parent`);
    if (i.parent_hint) feature(i.parent_hint, `${i.ref}'s parent_hint`);
    if (i.found_in) feature(i.found_in, `${i.ref}'s found_in`);
    if (i.release && !releases.has(i.release)) bad(`${i.ref}'s release ${i.release} is not in the export`);
    for (const d of i.deps) item(d, `${i.ref}'s dependency`);
    if (i.capture_id && sql.exec("SELECT 1 FROM items WHERE capture_id = ?", i.capture_id).toArray().length > 0) {
      throw new BoardError("conflict", `${p.key}: ${i.ref}'s capture ${i.capture_id} is already on the board`);
    }
  }
  for (const r of p.runs) {
    if (sql.exec("SELECT 1 FROM runs WHERE id = ?", r.id).toArray().length > 0) throw new BoardError("conflict", `${p.key}: run ${r.id} is already on the board`);
  }

  // Counters past every id the project brings, aliases included, whatever the document says.
  const allRefs = p.items.flatMap((i) => [i.ref, ...i.aliases]);
  const next = {
    item: Math.max(p.next.item, highest(allRefs, p.prefix) + 1),
    release: Math.max(p.next.release, highest(p.releases.map((r) => r.ref.replace(/^R/, "R-")), "R") + 1),
    question: Math.max(p.next.question, highest(p.questions.map((q) => q.ref), "Q") + 1),
    action: Math.max(p.next.action, highest(p.questions.map((q) => q.ref), "A") + 1),
  };
  const project = sql
    .exec<{ pk: number }>(
      `INSERT INTO projects (key, name, prefix, draft_prefix, lead, po, next_item, next_release, next_question, next_action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
      p.key,
      p.name,
      p.prefix,
      p.draft_prefix,
      p.lead,
      p.po,
      next.item,
      next.release,
      next.question,
      next.action,
      p.created_at,
    )
    .one().pk;
  for (const repo of new Set(p.repos)) sql.exec("INSERT INTO project_repos (project, repo) VALUES (?, ?)", project, repo);

  const releasePk = new Map<string, number>();
  for (const r of p.releases) {
    const pk = sql
      .exec<{ pk: number }>(
        "INSERT INTO releases (project, ref, title, goal, status, ord, spec_url, closed_at, closed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk",
        project,
        r.ref,
        r.title,
        r.goal,
        r.status,
        r.ord,
        r.spec_url,
        r.closed_at,
        r.closed_by,
      )
      .one().pk;
    releasePk.set(r.ref, pk);
  }

  // Items keep the document's order as their pks, so a re-export lists them the same way. Features go
  // in first: every other item's links are to features.
  const base = (sql.exec<{ m: number | null }>("SELECT max(pk) AS m FROM items").one().m ?? 0) + 1;
  const itemPk = new Map<string, number>();
  p.items.forEach((i, n) => itemPk.set(i.ref, base + n));
  const pkOf = (r: string | null) => (r === null ? null : itemPk.get(refs.get(r)!.ref)!);
  for (const i of [...p.items.filter((i) => i.kind === "feature"), ...p.items.filter((i) => i.kind !== "feature")]) {
    const pk = itemPk.get(i.ref)!;
    sql.exec(
      `INSERT INTO items (pk, project, kind, type, status, title, description, notes, plan, parent, release, ord, open_since, archived_at, archive_reason,
                          captured_by, casper_words, capture_id, parent_hint, bug_where, blocks_use, found_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      pk,
      project,
      i.kind,
      i.type,
      i.status,
      i.title,
      i.description,
      i.notes,
      i.plan,
      pkOf(i.parent),
      i.release === null ? null : releasePk.get(i.release)!,
      i.ord,
      i.open_since,
      i.archived_at,
      i.archive_reason,
      i.captured_by,
      i.casper_words,
      i.capture_id,
      pkOf(i.parent_hint),
      i.bug_where,
      i.blocks_use ? 1 : 0,
      pkOf(i.found_in),
      i.created_at,
      i.updated_at,
    );
    sql.exec("INSERT INTO item_refs (project, ref, item, is_primary) VALUES (?, ?, ?, 1)", project, i.ref, pk);
    for (const a of i.aliases) sql.exec("INSERT INTO item_refs (project, ref, item, is_primary) VALUES (?, ?, ?, 0)", project, a, pk);
    for (const l of new Set(i.labels)) sql.exec("INSERT INTO item_labels (item, label) VALUES (?, ?)", pk, l);
    for (const c of i.criteria) {
      sql.exec(
        "INSERT INTO criteria (item, section, ord, text, evidence, state, checked_by, checked_at, casper_gate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        pk,
        c.section,
        c.n,
        c.text,
        c.evidence,
        c.state,
        c.checked_by,
        c.checked_at,
        c.casper_gate ? 1 : 0,
      );
    }
  }
  for (const i of p.items) for (const d of new Set(i.deps.map((d) => pkOf(d)!))) sql.exec("INSERT INTO item_deps (project, item, dep) VALUES (?, ?, ?)", project, itemPk.get(i.ref)!, d);

  const sessionPk = new Map<string, number>();
  const sessionOf = (s: SessionRef | null, what: string) => {
    if (s === null) return null;
    const ref = { ...s, feature: refs.get(s.feature)?.ref ?? s.feature };
    return sessionPk.get(sessionKey(ref)) ?? bad(`${what}: session ${sessionKey(s)} is not in the export`);
  };
  for (const s of p.sessions) {
    const f = feature(s.feature, `session ${sessionKey(s)}'s feature`);
    const key = sessionKey({ ...s, feature: f.ref });
    if (sessionPk.has(key)) bad(`session ${key} appears twice`);
    const pk = sql
      .exec<{ pk: number }>(
        `INSERT INTO sessions (project, feature, kind, label, started_at, ended_at, imported, need, minors_fixed, summary, handoff_path, handoff_text, commit_sha, closed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
        project,
        itemPk.get(f.ref)!,
        s.kind,
        s.label,
        s.started_at,
        s.ended_at,
        s.imported ? 1 : 0,
        s.need,
        s.minors_fixed,
        s.summary,
        s.handoff_path,
        s.handoff_text,
        s.commit_sha,
        s.closed_by,
      )
      .one().pk;
    sessionPk.set(key, pk);
    for (const t of s.tasks) sql.exec("INSERT INTO session_tasks (project, session, item, role) VALUES (?, ?, ?, ?)", project, pk, pkOf(item(t.item, `session ${key}'s task`).ref), t.role);
  }
  for (const i of p.items) if (i.captured_session) sql.exec("UPDATE items SET captured_session = ? WHERE pk = ?", sessionOf(i.captured_session, `${i.ref}'s capture`), itemPk.get(i.ref)!);

  const questionPk = new Map<string, number>();
  for (const q of p.questions) {
    if (questionPk.has(q.ref)) bad(`question ${q.ref} appears twice`);
    const nb = q.needed_before;
    const pk = sql
      .exec<{ pk: number }>(
        `INSERT INTO questions (project, ref, kind, text, context, asked_by, session, needed_before_item, needed_before_release, needed_before_text, state,
                                answer_key, answer_words, answered_by, answered_at, answered_via, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
        project,
        q.ref,
        q.kind,
        q.text,
        q.context,
        q.asked_by,
        sessionOf(q.session, q.ref),
        nb && "item" in nb ? pkOf(item(nb.item, `${q.ref}'s needed_before`).ref) : null,
        nb && "release" in nb ? (releasePk.get(nb.release) ?? bad(`${q.ref}'s needed_before ${nb.release} is not in the export`)) : null,
        nb && "text" in nb ? nb.text : null,
        q.state,
        q.answer_key,
        q.answer_words,
        q.answered_by,
        q.answered_at,
        q.answered_via,
        q.created_at,
      )
      .one().pk;
    questionPk.set(q.ref, pk);
    q.options.forEach((o, n) => sql.exec("INSERT INTO question_options (question, ord, key, text, recommended) VALUES (?, ?, ?, ?, ?)", pk, n + 1, o.key, o.text, o.recommended ? 1 : 0));
    for (const h of q.holds) {
      if ("item" in h) sql.exec("INSERT INTO question_holds (project, question, item) VALUES (?, ?, ?)", project, pk, pkOf(item(h.item, `${q.ref}'s hold`).ref));
      else sql.exec("INSERT INTO question_holds (project, question, session) VALUES (?, ?, ?)", project, pk, sessionOf(h.session, `${q.ref}'s hold`));
    }
  }
  for (const s of p.sessions) {
    for (const w of s.waits_on) {
      const q = questionPk.get(w) ?? bad(`session ${sessionKey(s)} waits on ${w}, which is not in the export`);
      sql.exec("INSERT INTO session_waits_on (project, session, question) VALUES (?, ?, ?)", project, sessionOf(s, "a close"), q);
    }
  }

  const runPk = new Map<string, number>();
  for (const r of p.runs) {
    const pk = sql
      .exec<{ pk: number }>(
        `INSERT INTO runs (id, project, session, agent, role, laptop, model, effort, started_at, ended_at, resumed, input, output, cache_read, cache_write, calls, ctx, remote_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
        r.id,
        project,
        sessionOf(r.session, `run ${r.id}`),
        r.agent,
        r.role,
        r.laptop,
        r.model,
        r.effort,
        r.started_at,
        r.ended_at,
        r.resumed ? 1 : 0,
        r.input,
        r.output,
        r.cache_read,
        r.cache_write,
        r.calls,
        r.ctx === null ? null : ctxBlob(r.ctx),
        r.remote_url,
      )
      .one().pk;
    runPk.set(r.id, pk);
    for (const t of new Set(r.tasks)) sql.exec("INSERT INTO run_tasks (project, run, item) VALUES (?, ?, ?)", project, pk, pkOf(item(t, `run ${r.id}'s task`).ref));
  }
  const pushPk = new Map<string, number>();
  for (const x of p.pushes) {
    const run = x.run === null ? null : (runPk.get(x.run) ?? bad(`push ${recordKey.push(x)}'s run ${x.run} is not in the export`));
    const pk = sql
      .exec<{ pk: number }>("INSERT INTO pushes (project, repo, branch, sha, worker, run, at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING pk", project, x.repo, x.branch, x.sha, x.worker, run, x.at)
      .one().pk;
    pushPk.set(recordKey.push(x), pk);
  }
  const ciPk = new Map<string, number>();
  for (const c of p.ci_runs) {
    const pk = sql
      .exec<{ pk: number }>(
        `INSERT INTO ci_runs (source, external_id, project, name, url, repo, branch, sha, laptop, status, started_at, ended_at, worker, session)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk`,
        c.source,
        c.external_id,
        project,
        c.name,
        c.url,
        c.repo,
        c.branch,
        c.sha,
        c.laptop,
        c.status,
        c.started_at,
        c.ended_at,
        c.worker,
        sessionOf(c.session, `CI run ${recordKey.ciRun(c)}`),
      )
      .one().pk;
    ciPk.set(recordKey.ciRun(c), pk);
    for (const t of new Set(c.tasks)) sql.exec("INSERT INTO ci_run_tasks (project, ci_run, item) VALUES (?, ?, ?)", project, pk, pkOf(item(t, `CI run ${recordKey.ciRun(c)}'s task`).ref));
  }

  const records = new Map<ExportTable, Map<string, number>>([
    ["projects", new Map([[p.key, project]])],
    ["releases", releasePk],
    ["items", new Map([...refs].map(([r, i]) => [r, itemPk.get(i.ref)!]))],
    ["sessions", sessionPk],
    ["questions", questionPk],
    ["runs", runPk],
    ["pushes", pushPk],
    ["ci_runs", ciPk],
    ["grants", insertGrants(sql, project, p.grants)],
  ]);
  insertEvents(sql, project, p.events, records, sessionPk, seqs, (s) => sessionOf(s, "an event"), p.key);

  // The one event the import adds: where the project came from.
  const source = doc.source ?? "an export";
  const reason = `imported from ${source} (${doc.format} v${doc.version}, exported ${doc.exported_at}${doc.last_event_seq ? `, through event ${doc.last_event_seq}` : ""})`;
  sql.exec(
    "INSERT INTO events (at, project, actor_kind, actor, op, tbl, pk, ref, reason) VALUES (?, ?, ?, ?, 'import', 'projects', ?, ?, ?)",
    at,
    project,
    who.kind,
    who.who,
    project,
    p.key,
    reason.slice(0, 500),
  );
  return { key: p.key, items: p.items.length, events: p.events.length, next_item: next.item };
}

function insertGrants(sql: SqlStorage, project: number | null, grants: ExportGrant[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of grants) {
    const pk = sql
      .exec<{ pk: number }>(
        "INSERT INTO grants (project, agent, laptop, role, read, items, sessions, questions, admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pk",
        project,
        g.agent,
        g.laptop,
        g.role,
        g.read ? 1 : 0,
        g.items,
        g.sessions ? 1 : 0,
        g.questions ? 1 : 0,
        g.admin ? 1 : 0,
      )
      .one().pk;
    for (const f of new Set(g.fields)) sql.exec("INSERT INTO grant_fields (grant_pk, field) VALUES (?, ?)", pk, f);
    out.set(recordKey.grant(g).toLowerCase(), pk);
  }
  return out;
}

/** A project's history, as it was, renumbered; each event's record found by its key. A record gone (a revoked rule) is pk 0. */
function insertEvents(
  sql: SqlStorage,
  project: number | null,
  events: ExportEvent[],
  records: Map<ExportTable, Map<string, number>>,
  sessions: Map<string, number>,
  seqs: Map<number, number>,
  sessionOf: (s: SessionRef | null) => number | null = (s) => (s === null ? null : (sessions.get(sessionKey(s)) ?? null)),
  key = "*",
): void {
  for (const e of events) {
    let pk = 0;
    if (e.record !== null) {
      const found = records.get(e.table)?.get(e.table === "grants" ? e.record.toLowerCase() : e.record);
      if (found === undefined) throw new BoardError("invalid", `${key}: event ${e.seq}'s record ${e.table} ${e.record} is not in the export`);
      pk = found;
    }
    const undo = e.undo_of === null ? null : (seqs.get(e.undo_of) ?? null);
    if (e.undo_of !== null && undo === null) throw new BoardError("invalid", `${key}: event ${e.seq} undoes ${e.undo_of}, which is not before it in the export`);
    const seq = sql
      .exec<{ seq: number }>(
        `INSERT INTO events (at, project, actor_kind, actor, role, worker, session, op, tbl, pk, ref, reason, undo_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
        e.at,
        project,
        e.actor.kind,
        e.actor.who,
        e.actor.role,
        e.actor.worker,
        sessionOf(e.actor.session),
        e.op,
        e.table,
        pk,
        e.ref,
        e.reason,
        undo,
      )
      .one().seq;
    if (seqs.has(e.seq)) throw new BoardError("invalid", `${key}: event ${e.seq} appears twice`);
    seqs.set(e.seq, seq);
    for (const c of e.changes) sql.exec("INSERT INTO event_changes (event, field, old, new) VALUES (?, ?, ?, ?)", seq, c.field, c.old, c.new);
  }
}
