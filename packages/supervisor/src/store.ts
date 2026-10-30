import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Envelope } from "@bobnet/protocol";
import type { Tier } from "./policy.ts";

// Everything the supervisor must not lose across a restart: workers, open
// approval and question requests, messages waiting for a role, and the audit
// log. One SQLite file in the state dir.

export type WorkerState = "queued" | "running" | "waiting-approval" | "waiting-answer" | "done" | "failed" | "stopped";
export const ACTIVE_STATES: readonly WorkerState[] = ["running", "waiting-approval", "waiting-answer"];

export interface WorkerRow {
  id: string;
  project: string;
  role: string;
  task: string;
  handoff: string | null;
  state: WorkerState;
  priority: number;
  resume_session: string | null;
  session_id: string | null;
  checkpoint: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  last_event_at: string | null;
}

export type RequestKind = "approval" | "question";
export type RequestState = "open" | "answered" | "expired" | "orphaned";

export interface RequestRow {
  id: string;
  worker_id: string;
  kind: RequestKind;
  tool: string;
  input: string;
  tier: Tier;
  rule: string;
  reason: string;
  state: RequestState;
  decision: string | null;
  message: string | null;
  answers: string | null;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface InboxRow {
  id: string;
  project: string;
  role: string;
  envelope: string;
  received_at: string;
  consumed_by: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, role TEXT NOT NULL, task TEXT NOT NULL, handoff TEXT,
  state TEXT NOT NULL, priority INTEGER NOT NULL, resume_session TEXT, session_id TEXT, checkpoint TEXT,
  error TEXT, created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT, last_event_at TEXT
);
CREATE INDEX IF NOT EXISTS workers_state ON workers (state);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, kind TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL,
  tier TEXT NOT NULL, rule TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL, decision TEXT,
  message TEXT, answers TEXT, decided_by TEXT, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE INDEX IF NOT EXISTS requests_state ON requests (state);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, role TEXT NOT NULL, envelope TEXT NOT NULL,
  received_at TEXT NOT NULL, consumed_by TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  worker_id TEXT, detail TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();

export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private all<T>(sql: string, ...args: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }

  private one<T>(sql: string, ...args: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }

  private run(sql: string, ...args: SQLInputValue[]): void {
    this.db.prepare(sql).run(...args);
  }

  // ---------- Workers ----------

  createWorker(w: {
    project: string;
    role: string;
    task: string;
    handoff: string | null;
    priority: number;
    resume_session: string | null;
  }): WorkerRow {
    const id = `w_${randomUUID().slice(0, 8)}`;
    this.run(
      `INSERT INTO workers (id, project, role, task, handoff, state, priority, resume_session, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      id, w.project, w.role, w.task, w.handoff, w.priority, w.resume_session, now(),
    );
    return this.worker(id)!;
  }

  worker(id: string): WorkerRow | undefined {
    return this.one<WorkerRow>("SELECT * FROM workers WHERE id = ?", id);
  }

  workers(filter: { project?: string; states?: readonly WorkerState[] } = {}): WorkerRow[] {
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    if (filter.project) {
      where.push("project = ?");
      args.push(filter.project);
    }
    if (filter.states) {
      where.push(`state IN (${filter.states.map(() => "?").join(",")})`);
      args.push(...filter.states);
    }
    return this.all<WorkerRow>(
      `SELECT * FROM workers ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at`,
      ...args,
    );
  }

  /** Queued workers in run order: project priority, then age. */
  queued(): WorkerRow[] {
    return this.all<WorkerRow>("SELECT * FROM workers WHERE state = 'queued' ORDER BY priority, created_at");
  }

  updateWorker(id: string, patch: Partial<Omit<WorkerRow, "id">>): void {
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    this.run(
      `UPDATE workers SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
      ...keys.map((k) => (patch as Record<string, SQLInputValue>)[k] ?? null),
      id,
    );
  }

  // ---------- Requests ----------

  createRequest(r: Omit<RequestRow, "id" | "state" | "decision" | "message" | "answers" | "decided_by" | "created_at" | "decided_at">): RequestRow {
    const id = `r_${randomUUID().slice(0, 8)}`;
    this.run(
      `INSERT INTO requests (id, worker_id, kind, tool, input, tier, rule, reason, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      id, r.worker_id, r.kind, r.tool, r.input, r.tier, r.rule, r.reason, now(),
    );
    return this.request(id)!;
  }

  request(id: string): RequestRow | undefined {
    return this.one<RequestRow>("SELECT * FROM requests WHERE id = ?", id);
  }

  requests(states: readonly RequestState[] = ["open", "orphaned"]): RequestRow[] {
    return this.all<RequestRow>(
      `SELECT * FROM requests WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY created_at`,
      ...states,
    );
  }

  /** Settles a request once; returns false if it was already settled. */
  settleRequest(
    id: string,
    patch: { state: "answered" | "expired"; decision: string; message: string | null; answers: string | null; decided_by: string },
  ): boolean {
    const before = this.request(id);
    if (!before || (before.state !== "open" && before.state !== "orphaned")) return false;
    this.run(
      "UPDATE requests SET state = ?, decision = ?, message = ?, answers = ?, decided_by = ?, decided_at = ? WHERE id = ?",
      patch.state, patch.decision, patch.message, patch.answers, patch.decided_by, now(), id,
    );
    return true;
  }

  /** An open request whose worker died with the supervisor; answering it resumes the worker. */
  markOrphaned(id: string): void {
    this.run("UPDATE requests SET state = 'orphaned' WHERE id = ? AND state = 'open'", id);
  }

  // ---------- Inbox ----------

  /** Stores a message for a role with no running worker; false if already stored. */
  addInbox(project: string, role: string, msg: Envelope): boolean {
    if (this.one("SELECT 1 AS x FROM inbox WHERE id = ?", msg.id)) return false;
    this.run(
      "INSERT INTO inbox (id, project, role, envelope, received_at) VALUES (?, ?, ?, ?, ?)",
      msg.id, project, role, JSON.stringify(msg), now(),
    );
    return true;
  }

  waiting(project: string, role: string): Envelope[] {
    return this.all<InboxRow>(
      "SELECT * FROM inbox WHERE project = ? AND role = ? AND consumed_by IS NULL ORDER BY received_at",
      project, role,
    ).map((r) => JSON.parse(r.envelope) as Envelope);
  }

  consumeInbox(ids: string[], workerId: string): void {
    for (const id of ids) this.run("UPDATE inbox SET consumed_by = ? WHERE id = ?", workerId, id);
  }

  // ---------- Audit ----------

  audit(actor: string, action: string, workerId: string | null, detail: Record<string, unknown> = {}): void {
    this.run(
      "INSERT INTO audit (ts, actor, action, worker_id, detail) VALUES (?, ?, ?, ?, ?)",
      now(), actor, action, workerId, JSON.stringify(detail),
    );
  }

  auditLog(limit = 100): Array<{ ts: string; actor: string; action: string; worker_id: string | null; detail: string }> {
    return this.all("SELECT ts, actor, action, worker_id, detail FROM audit ORDER BY seq DESC LIMIT ?", limit);
  }
}
