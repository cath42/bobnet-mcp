import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BoardItem, ProjectBoard, SessionKind, TokenCounts } from "@bobnet/protocol";
import type { Logger } from "@bobnet/client/log";
import { parse as parseYaml } from "yaml";
import type { ProjectConfig } from "./config.ts";
import type { Store, WorkerRow } from "./store.ts";

// A project's board for the dashboard: its backlog read from git, its workers grouped into
// sessions with their tokens and context per call, recent commits and CI. Sent to the broker
// when it changes, apart from the laptop snapshot, which goes out every few seconds.

const REFRESH_MS = 60_000;
const CI_EVERY_MS = 120_000;
const EXEC_TIMEOUT_MS = 20_000;
const COMMITS_SINCE = "72.hours";
/** A worker whose brief names no session belongs to the last one if it started within this of that session's last activity. */
const SESSION_GAP_MS = 6 * 3600_000;
/** How many of the latest sessions keep their runs, each with its context per call, on the board. */
const SESSIONS_WITH_RUNS = 4;
const CTX_POINTS = 400;
const BASELINE_MIN_RUNS = 5;

// ---------- Sessions ----------

export interface Session {
  name: string;
  kind: SessionKind;
}

const SESSION_RE = /\b([A-Z][A-Z0-9]*-\d+) (design|build|review|retro)\b(?: session)?(?: (\d+))?/i;

/** A session as a spawn declares it: its feature, kind and the label the orchestrator calls it by ("3", "B"). */
export interface DeclaredSession {
  feature: string;
  kind: "design" | "build" | "review" | "retro";
  label?: string;
}

/** A declared session's name, its label as given: "LAND-43 build B", "LAND-43 design". */
export const sessionName = (d: DeclaredSession) => `${d.feature} ${d.kind}${d.label ? ` ${d.label}` : ""}`;

/**
 * The session a brief names: "LAND-41 build 3", "LAND-41 design session". A build with no number is
 * build 1. Only for a worker spawned before spawns declared their session.
 */
export function namedSession(task: string): Session | null {
  const m = SESSION_RE.exec(task);
  if (!m) return null;
  const kind = m[2]!.toLowerCase() as SessionKind;
  const n = m[3] ?? (kind === "build" ? "1" : "");
  return { name: `${m[1]!.toUpperCase()} ${kind}${n ? ` ${n}` : ""}`, kind };
}

const OTHER: Session = { name: "Other work", kind: "other" };

/**
 * Every worker's session: the one its spawn declared, or "Other work" for none. A worker spawned
 * before spawns declared one keeps how it was read then: the session its brief names, else the one
 * last active in its project when it started, else "Other work".
 */
export function assignSessions(workers: WorkerRow[]): Map<string, Session> {
  const out = new Map<string, Session>();
  const last = new Map<string, { s: Session; at: number }>();
  for (const w of [...workers].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const at = Date.parse(w.created_at);
    let s: Session;
    if (w.declared_session !== null) {
      const d = JSON.parse(w.declared_session) as DeclaredSession | null;
      s = d ? { name: sessionName(d), kind: d.kind } : OTHER;
    } else {
      const prev = last.get(w.project);
      s = namedSession(w.task) ?? (prev && at - prev.at <= SESSION_GAP_MS ? prev.s : OTHER);
    }
    out.set(w.id, s);
    if (s.kind !== "other") last.set(w.project, { s, at: Math.max(at, Date.parse(w.ended_at ?? w.created_at)) });
  }
  return out;
}

/** The backlog item a brief is about: the one it calls its task, else the most specific id near its start. */
export function briefTask(task: string): string | null {
  const named = /\b[Tt]ask:?\s+([A-Z][A-Z0-9]*-\d+(?:\.\d+)*)/.exec(task);
  if (named) return named[1]!;
  let best: string | null = null;
  for (const [ref] of task.slice(0, 400).matchAll(/\b[A-Z][A-Z0-9]*-\d+(?:\.\d+)+\b/g)) {
    if (!best || ref.split(".").length > best.split(".").length) best = ref;
  }
  return best;
}

/** The backlog items a worker works on, as its spawn named them; a worker spawned before spawns did falls back to its brief. */
export function workerTasks(w: Pick<WorkerRow, "task" | "tasks">): string[] {
  if (w.tasks !== null) return JSON.parse(w.tasks) as string[];
  const t = briefTask(w.task);
  return t ? [t] : [];
}

// ---------- Context per call ----------

/** At most `max` points, evenly picked, first and last kept. */
export function downsample(xs: number[], max = CTX_POINTS): number[] {
  if (xs.length <= max) return xs;
  return Array.from({ length: max }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (max - 1))]!);
}

const quantile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
};

/** Middle half and median, call by call, while at least `min` runs are that long. */
export function baseline(runs: number[][], min = BASELINE_MIN_RUNS): ProjectBoard["baseline"] {
  const out = { runs: runs.length, p25: [] as number[], p50: [] as number[], p75: [] as number[] };
  for (let i = 0; i < CTX_POINTS; i++) {
    const v = runs.filter((r) => r.length > i).map((r) => r[i]!).sort((a, b) => a - b);
    if (v.length < min) break;
    out.p25.push(Math.round(quantile(v, 0.25)));
    out.p50.push(Math.round(quantile(v, 0.5)));
    out.p75.push(Math.round(quantile(v, 0.75)));
  }
  return out;
}

/** Context per call from a Claude Code transcript, for the calls between `from` and `to`; subagent calls left out. */
export function transcriptCtx(jsonl: string, from: string, to: string | null): number[] {
  const out: number[] = [];
  const seen = new Set<string>();
  for (const line of jsonl.split("\n")) {
    if (!line.includes('"assistant"')) continue;
    let d: { type?: string; isSidechain?: boolean; timestamp?: string; message?: { id?: string; usage?: Record<string, number> } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const u = d.message?.usage, id = d.message?.id;
    if (d.type !== "assistant" || d.isSidechain || !u || !id || seen.has(id)) continue;
    if (!d.timestamp || d.timestamp < from || (to && d.timestamp > to)) continue;
    seen.add(id);
    out.push((u["input_tokens"] ?? 0) + (u["cache_read_input_tokens"] ?? 0) + (u["cache_creation_input_tokens"] ?? 0));
  }
  return out;
}

/** One model call in a transcript: its tokens, and the context it carried (null for a subagent's). */
export interface TranscriptCall {
  id: string;
  at: string;
  model: string | null;
  tokens: TokenCounts;
  ctx: number | null;
}

/** Every model call in a transcript, once each; a subagent's file, or a sidechain line, counts tokens but no context. */
export function transcriptCalls(jsonl: string, subagent = false): TranscriptCall[] {
  const out = new Map<string, TranscriptCall>();
  for (const line of jsonl.split("\n")) {
    if (!line.includes('"assistant"')) continue;
    let d: { type?: string; isSidechain?: boolean; timestamp?: string; message?: { id?: string; model?: string; usage?: Record<string, number> } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const u = d.message?.usage, id = d.message?.id;
    if (d.type !== "assistant" || !u || !id || !d.timestamp) continue;
    // A response's later content blocks repeat its usage; the last line has the final count.
    const tokens = { input: u["input_tokens"] ?? 0, output: u["output_tokens"] ?? 0, cache_read: u["cache_read_input_tokens"] ?? 0, cache_write: u["cache_creation_input_tokens"] ?? 0 };
    const main = !subagent && !d.isSidechain;
    out.set(id, { id, at: out.get(id)?.at ?? d.timestamp, model: d.message?.model ?? null, tokens, ctx: main ? tokens.input + tokens.cache_read + tokens.cache_write : null });
  }
  return [...out.values()];
}

/** Claude Code's transcript folder for a working folder: every character but a letter or digit becomes "-". */
export const transcriptFolder = (root: string, dir: string) => join(root, dir.replace(/[^A-Za-z0-9]/g, "-"));

/** The session whose span holds `at`, the latest started if spans overlap; "Other work" has none. */
export function sessionAt(sessions: Array<{ name: string; kind: string; started_at: string; ended_at: string | null }>, at: string, now: string): string | null {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]!;
    if (s.kind !== "other" && s.started_at <= at && at <= (s.ended_at ?? now)) return s.name;
  }
  return null;
}

// ---------- Backlog (Backlog.md: Markdown files with YAML front matter) ----------

const section = (text: string, name: string) =>
  new RegExp(`<!-- SECTION:${name}:BEGIN -->\\n?([\\s\\S]*?)\\n?<!-- SECTION:${name}:END -->`).exec(text)?.[1]?.trim() ?? null;

export function parseBacklogItem(text: string): BoardItem | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fm) return null;
  let d: Record<string, unknown>;
  try {
    d = (parseYaml(fm[1]!) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof d["id"] !== "string") return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const desc = section(text, "DESCRIPTION");
  const ac = [...text.matchAll(/^- \[( |x)\] #\d+ (.*)$/gm)].map((m) => [m[1] === "x", m[2]!.slice(0, 300)] as [boolean, string]);
  return {
    id: d["id"].toUpperCase(),
    title: String(d["title"] ?? "").slice(0, 300),
    status: String(d["status"] ?? ""),
    type: str(d["type"]),
    parent: str(d["parent_task_id"])?.toUpperCase() ?? null,
    milestone: str(d["milestone"]),
    assignee: list(d["assignee"]).map((a) => a.replace(/^@/, "")).slice(0, 10),
    labels: list(d["labels"]).slice(0, 20),
    deps: list(d["dependencies"]).map((x) => x.toUpperCase()).slice(0, 40),
    desc: desc ? desc.slice(0, 600) : null,
    ac: ac.slice(0, 40),
  };
}

const idOrder = (id: string) => id.split("-")[1]?.split(".").map(Number) ?? [];
const byId = (a: { id: string }, b: { id: string }) => {
  const [x, y] = [idOrder(a.id), idOrder(b.id)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  return 0;
};

/** What the board carries: increments, the tasks of open ones, other open items; accepted increments' tasks as counts. */
export function shapeBacklog(items: BoardItem[]): Pick<NonNullable<ProjectBoard["backlog"]>, "items" | "done_counts"> {
  const incs = new Map(items.filter((x) => x.type === "increment").map((x) => [x.id, x]));
  const keep: BoardItem[] = [];
  const done: Record<string, number> = {};
  for (const x of items) {
    const parent = x.parent ? incs.get(x.parent) : undefined;
    if (x.type === "increment" || !parent || parent.status !== "Done" || x.status !== "Done") {
      keep.push(x.status === "Done" && x.type !== "increment" ? { ...x, desc: null, ac: [] } : x);
    } else done[parent.id] = (done[parent.id] ?? 0) + 1;
  }
  return { items: keep.sort(byId), done_counts: done };
}

// ---------- The board ----------

export interface BoardDeps {
  projects: Map<string, ProjectConfig>;
  store: Store;
  log: Logger;
  send: (board: ProjectBoard) => Promise<void>;
  /** A running worker's context per call, from its live run. */
  liveCtx: (workerId: string) => number[] | undefined;
  ownTokens: (w: WorkerRow) => TokenCounts;
  nameOf: (w: WorkerRow) => string;
  /** Where Claude Code keeps transcripts, for runs from before the supervisor recorded context. */
  transcriptsDir?: string;
}

type Exec = (cmd: string, args: string[], cwd: string) => Promise<string>;

const exec: Exec = (cmd, args, cwd) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, encoding: "utf8", timeout: EXEC_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))),
  );

/** Reads many files at one commit through one `git cat-file --batch`. */
function catFiles(cwd: string, specs: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", ["-C", cwd, "cat-file", "--batch"], { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => p.kill(), EXEC_TIMEOUT_MS);
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", reject);
    p.on("close", () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const out: string[] = [];
      let at = 0;
      while (at < buf.length) {
        const nl = buf.indexOf(10, at);
        if (nl < 0) break;
        const header = buf.subarray(at, nl).toString();
        const size = Number(header.split(" ")[2]);
        if (!Number.isFinite(size)) {
          out.push("");
          at = nl + 1;
          continue;
        }
        out.push(buf.subarray(nl + 1, nl + 1 + size).toString("utf8"));
        at = nl + 1 + size + 1;
      }
      resolve(out);
    });
    p.stdin.end(specs.map((s) => `${s}\n`).join(""));
  });
}

export class Boards {
  private readonly deps: BoardDeps;
  private readonly exec: Exec;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly sent = new Map<string, string>();
  private readonly backlogs = new Map<string, { ref: string; backlog: ProjectBoard["backlog"] }>();
  private readonly ci = new Map<string, { at: number; runs: ProjectBoard["ci"] }>();
  private backfilled = false;
  /** Orchestrator transcripts read so far: where each file was read to, and its calls. */
  private readonly transcripts = new Map<string, { offset: number; calls: TranscriptCall[] }>();

  constructor(deps: BoardDeps, execImpl: Exec = exec) {
    this.deps = deps;
    this.exec = execImpl;
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Rebuilds every project's board and sends the ones that changed; one pass at a time. */
  refresh(force = false): Promise<void> {
    if (this.running) return this.running;
    if (force) this.sent.clear();
    this.running = (async () => {
      try {
        if (!this.backfilled) this.backfill();
        for (const p of this.deps.projects.values()) {
          const board = await this.build(p);
          const json = JSON.stringify(board);
          if (this.sent.get(p.key) === json) continue;
          await this.deps.send(board);
          this.sent.set(p.key, json);
        }
      } catch (err) {
        this.deps.log.warn("could not build a project board", { err: (err as Error).message });
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Context per call for ended runs from before the supervisor recorded it, read once from their transcripts. */
  private backfill(): void {
    this.backfilled = true;
    const dir = this.transcriptsRoot;
    const missing = this.deps.store.workers().filter((w) => w.ended_at && w.ctx === null);
    if (missing.length === 0) return;
    const files = new Map<string, string>();
    try {
      for (const d of readdirSync(dir)) {
        try {
          for (const f of readdirSync(join(dir, d))) if (f.endsWith(".jsonl")) files.set(f.slice(0, -6), join(dir, d, f));
        } catch {
          // not a folder
        }
      }
    } catch {
      // no transcripts here
    }
    for (const w of missing) {
      const file = w.session_id ? files.get(w.session_id) : undefined;
      let ctx: number[] = [];
      if (file && existsSync(file)) {
        try {
          ctx = transcriptCtx(readFileSync(file, "utf8"), w.started_at ?? w.created_at, w.ended_at);
        } catch {
          // unreadable: leave it empty
        }
      }
      this.deps.store.updateWorker(w.id, { ctx: JSON.stringify(ctx) });
    }
    this.deps.log.info("context per call backfilled from transcripts", { workers: missing.length });
  }

  private get transcriptsRoot(): string {
    return this.deps.transcriptsDir ?? join(process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude"), "projects");
  }

  /**
   * The orchestrator's calls, from its folder's transcripts and their subagents', once each; a file is
   * read on only from where it grew. The first read can be hundreds of MB: it yields between files.
   * A worker's session in the same folder (a lead runs in the orchestrator's) is the worker's usage, not this.
   */
  private async orchestratorCalls(dir: string): Promise<TranscriptCall[]> {
    const folder = transcriptFolder(this.transcriptsRoot, dir);
    const workers = new Set(this.deps.store.workers().flatMap((w) => (w.session_id ? [w.session_id] : [])));
    const files: Array<[string, boolean]> = [];
    try {
      for (const f of readdirSync(folder)) {
        if (workers.has(f.replace(/\.jsonl$/, ""))) continue;
        if (f.endsWith(".jsonl")) files.push([join(folder, f), false]);
        else {
          try {
            for (const a of readdirSync(join(folder, f, "subagents"))) if (a.endsWith(".jsonl")) files.push([join(folder, f, "subagents", a), true]);
          } catch {
            // no subagents
          }
        }
      }
    } catch {
      return [];
    }
    const byId = new Map<string, TranscriptCall>();
    for (const [file, subagent] of files) {
      let e = this.transcripts.get(file);
      try {
        const size = statSync(file).size;
        if (!e || size < e.offset) e = { offset: 0, calls: [] };
        if (size > e.offset) {
          const buf = Buffer.alloc(size - e.offset);
          const fd = openSync(file, "r");
          try {
            readSync(fd, buf, 0, buf.length, e.offset);
          } finally {
            closeSync(fd);
          }
          // Whole lines only: the last may still be being written.
          const end = buf.lastIndexOf(10);
          if (end >= 0) {
            for (const c of transcriptCalls(buf.subarray(0, end).toString("utf8"), subagent)) e.calls.push(c);
            e.offset += end + 1;
          }
          await new Promise((r) => setImmediate(r));
        }
        this.transcripts.set(file, e);
      } catch {
        continue;
      }
      // A resumed session's file repeats the calls before it; later lines have the final counts.
      for (const c of e.calls) byId.set(c.id, c);
    }
    return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
  }

  private ctxOf(w: WorkerRow): number[] {
    return this.deps.liveCtx(w.id) ?? (w.ctx ? (JSON.parse(w.ctx) as number[]) : []);
  }

  async build(p: ProjectConfig): Promise<ProjectBoard> {
    const all = this.deps.store.workers({ project: p.key });
    const sessions = assignSessions(all);
    const total = (t: TokenCounts) => t.input + t.output + t.cache_read + t.cache_write;

    const bySession = new Map<string, { s: Session; ws: WorkerRow[] }>();
    for (const w of all) {
      const s = sessions.get(w.id)!;
      const e = bySession.get(s.name) ?? { s, ws: [] };
      e.ws.push(w);
      bySession.set(s.name, e);
    }
    const sessionList = [...bySession.values()]
      .map(({ s, ws }) => {
        const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
        let calls = 0;
        for (const w of ws) {
          const t = this.deps.ownTokens(w);
          for (const k of ["input", "output", "cache_read", "cache_write"] as const) tokens[k] += t[k];
          calls += this.ctxOf(w).length;
        }
        const ended = ws.every((w) => w.ended_at) ? ws.map((w) => w.ended_at!).sort().at(-1)! : null;
        return { name: s.name, kind: s.kind, started_at: ws[0]!.created_at, ended_at: ended, workers: ws.length, calls, tokens, orchestrator: null as ProjectBoard["sessions"][number]["orchestrator"] };
      })
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      // One place kept for the orchestrator's "Other work".
      .slice(-199);

    // The orchestrator's calls go to the session whose span holds them; the rest to "Other work".
    const orch = new Map<string, TranscriptCall[]>();
    if (p.orchestratorDir) {
      const now = new Date().toISOString();
      for (const c of await this.orchestratorCalls(p.orchestratorDir)) {
        const name = sessionAt(sessionList, c.at, now) ?? "Other work";
        orch.set(name, [...(orch.get(name) ?? []), c]);
      }
    }
    for (const [name, cs] of orch) {
      let ss = sessionList.find((x) => x.name === name);
      if (!ss) {
        ss = { name, kind: "other", started_at: cs[0]!.at, ended_at: cs.at(-1)!.at, workers: 0, calls: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, orchestrator: null };
        sessionList.unshift(ss);
      }
      for (const c of cs) for (const k of ["input", "output", "cache_read", "cache_write"] as const) ss.tokens[k] += c.tokens[k];
      const calls = cs.filter((c) => c.ctx !== null).length;
      ss.calls += calls;
      ss.orchestrator = { name: p.orchestrator, calls, tokens: cs.reduce((n, c) => n + total(c.tokens), 0) };
    }

    const recent = new Set(sessionList.slice(-SESSIONS_WITH_RUNS).map((s) => s.name));
    const builds = sessionList.filter((s) => s.kind === "build");
    const latestBuild = builds.at(-1)?.name;
    const prevBuild = builds.at(-2)?.name;
    if (prevBuild) recent.add(prevBuild);
    const runs = all
      .filter((w) => w.ended_at && recent.has(sessions.get(w.id)!.name))
      .slice(-300)
      .map((w) => ({
        id: w.id,
        name: this.deps.nameOf(w),
        role: w.role,
        session: sessions.get(w.id)!.name,
        task_ref: workerTasks(w)[0] ?? null,
        task_refs: workerTasks(w),
        model: w.model,
        effort: w.effort,
        started_at: w.started_at,
        ended_at: w.ended_at,
        resumed: w.resume_session !== null,
        tokens: total(this.deps.ownTokens(w)),
        ctx: downsample(this.ctxOf(w)),
      }));
    // The orchestrator as one run per recent session, so its share and context show beside its workers'.
    for (const [name, cs] of orch) {
      if (!recent.has(name)) continue;
      const main = cs.filter((c) => c.ctx !== null);
      runs.push({
        id: `orchestrator:${name}`.slice(0, 40),
        name: p.orchestrator,
        role: p.orchestrator,
        session: name,
        task_ref: null,
        task_refs: [],
        model: main.at(-1)?.model ?? null,
        effort: null,
        started_at: cs[0]!.at,
        ended_at: cs.at(-1)!.at,
        resumed: false,
        tokens: cs.reduce((n, c) => n + total(c.tokens), 0),
        ctx: downsample(main.map((c) => c.ctx!)),
      });
    }
    const earlier = all.filter((w) => w.ended_at && sessions.get(w.id)!.name !== latestBuild).map((w) => this.ctxOf(w)).filter((c) => c.length > 0);

    const ref = p.backlog?.ref ?? (p.rebase ? `${p.rebase.remote}/${p.rebase.branch}` : "origin/main");
    const [backlog, commits, ci] = await Promise.all([this.backlog(p), this.commits(p, ref), this.ciRuns(p)]);
    return {
      project: p.key,
      ref: this.backlogs.get(p.key)?.ref ?? null,
      backlog,
      sessions: sessionList,
      runs,
      baseline: baseline(earlier),
      commits,
      ci,
    };
  }

  private async backlog(p: ProjectConfig): Promise<ProjectBoard["backlog"]> {
    if (!p.backlog) return null;
    const { dir, ref } = p.backlog;
    let sha: string;
    try {
      sha = (await this.exec("git", ["rev-parse", "--short=12", ref], p.path)).trim();
    } catch (err) {
      this.deps.log.warn("could not read the backlog's commit", { project: p.key, err: (err as Error).message });
      return this.backlogs.get(p.key)?.backlog ?? null;
    }
    const cached = this.backlogs.get(p.key);
    if (cached?.ref === sha) return cached.backlog;
    const files = (await this.exec("git", ["ls-tree", "-r", "--name-only", sha, "--", `${dir}/tasks`, `${dir}/drafts`, `${dir}/milestones`], p.path))
      .split("\n")
      .filter((f) => f.endsWith(".md"));
    const texts = await catFiles(p.path, files.map((f) => `${sha}:${f}`));
    const items: BoardItem[] = [];
    const drafts: NonNullable<ProjectBoard["backlog"]>["drafts"] = [];
    const milestones: NonNullable<ProjectBoard["backlog"]>["milestones"] = [];
    files.forEach((f, i) => {
      const text = texts[i] ?? "";
      if (f.startsWith(`${dir}/milestones/`)) {
        const fm = /^---\n([\s\S]*?)\n---/.exec(text);
        const d = fm ? ((parseYaml(fm[1]!) ?? {}) as Record<string, unknown>) : {};
        if (typeof d["id"] === "string") milestones.push({ id: d["id"], title: String(d["title"] ?? d["id"]).slice(0, 200) });
        return;
      }
      const item = parseBacklogItem(text);
      if (!item) return;
      if (f.startsWith(`${dir}/drafts/`)) {
        const updated = /^updated_date:\s*'?([^'\n]+)'?/m.exec(text)?.[1] ?? null;
        drafts.push({ id: item.id, title: item.title, updated });
      } else items.push(item);
    });
    const backlog = { milestones, ...shapeBacklog(items), drafts: drafts.slice(0, 300) };
    this.backlogs.set(p.key, { ref: sha, backlog });
    return backlog;
  }

  private async commits(p: ProjectConfig, ref: string): Promise<ProjectBoard["commits"]> {
    try {
      const out = await this.exec("git", ["log", ref, `--since=${COMMITS_SINCE}`, "-n", "200", "--format=%h%x1f%cI%x1f%an%x1f%s"], p.path);
      return out
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [sha, at, author, subject] = l.split("\x1f");
          return { sha: sha!.slice(0, 12), at: at!, author: author!.slice(0, 60), subject: subject!.slice(0, 200) };
        });
    } catch {
      return [];
    }
  }

  private async ciRuns(p: ProjectConfig): Promise<ProjectBoard["ci"]> {
    const cached = this.ci.get(p.key);
    const anyRunning = cached?.runs?.some((r) => r.status !== "completed");
    if (cached && Date.now() - cached.at < (anyRunning ? REFRESH_MS : CI_EVERY_MS)) return cached.runs;
    let runs: ProjectBoard["ci"] = null;
    try {
      const out = await this.exec("gh", ["run", "list", "-L", "10", "--json", "name,status,conclusion,createdAt,headSha"], p.path);
      runs = (JSON.parse(out) as Array<{ name: string; status: string; conclusion: string; createdAt: string; headSha: string }>).map((r) => ({
        name: r.name.slice(0, 80),
        status: r.status.slice(0, 20),
        conclusion: r.conclusion ? r.conclusion.slice(0, 20) : null,
        created_at: r.createdAt,
        sha: r.headSha.slice(0, 12),
      }));
    } catch {
      // no gh, not signed in, or no GitHub remote: the dashboard shows no CI
    }
    this.ci.set(p.key, { at: Date.now(), runs });
    return runs;
  }
}
