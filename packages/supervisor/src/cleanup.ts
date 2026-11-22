import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { lstat, readdir, readFile, readlink, rm, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CleanupReport, CleanupStepReport } from "@bobnet/protocol";
import type { Logger } from "@bobnet/client/log";
import { parse } from "yaml";
import { nextRun } from "./board-backup.ts";
import { type CleanupConfig, type CleanupStepConfig, DEFAULT_LOG_KEEP, type ProjectConfig } from "./config.ts";
import { SlotAbortedError } from "./slots.ts";

// The laptop's disk cleanup (BOB-123; Toad's design, c_425d73b6): each project's steps from its
// config, on a schedule, when free space falls below a floor, and when asked (the cleanup tool),
// and the supervisor's own logs in every run. A run holds the run slot, so no test or land runs
// under it; a dry run plans only and takes none.
//
// What it never removes: a tracked file (git check-ignore and ls-files, never --no-index), a live
// or queued worker's worktree or anything in one, a standing role's worktree, a dirty worktree, one
// whose HEAD isn't on the line, a folder holding .git, anything outside the repository, symlinks
// included (a path whose realpath isn't itself is kept), helix-navigator-maps' pipeline output
// (Casper's ruling), a pnpm store in use, a runner's files while a job runs from it, the browsers an
// installed Playwright needs, or a live worker's log. Worktrees go with `git worktree remove`, which
// refuses an unclean one, never --force; folders with rm, once each check passed. Docker and the pnpm
// store prune with their own commands. Each step is timed out on its own, its process group killed;
// a failed step is recorded and the rest still run.

export type CleanupTrigger = "schedule" | "floor" | "demand";

/** How often the schedule, the floor and a busy run's retry are looked at. */
export const CLEANUP_TICK_MS = 5 * 60_000;
/** What a step lists of the paths it acted on or kept, in a tool's answer; the report has counts only. */
const LISTED = 50;
/** A command's output kept for its error. */
const OUTPUT_MAX = 8_000;

/** The prunes run with each tool's own command, in the project's folder. */
export const PRUNE_COMMANDS: Record<"docker" | "pnpm-store", string[]> = {
  // No volumes unless the step says `volumes: true`; Docker.raw's compaction isn't the cleanup's.
  docker: ["docker", "system", "prune", "--force"],
  // Frees little while node_modules clone the store's blocks; freed_bytes says what it was (df, not du).
  "pnpm-store": ["pnpm", "store", "prune"],
};

/**
 * Casper's ruling (via poe, 2026-11-21): helix-navigator-maps' pipeline cache and out are never
 * cleaned, though git ignores them, by `ignored` or by a `paths` entry. Anywhere in a repository.
 */
const NEVER_CLEAN = /(^|\/)services\/read\/maps\/pipeline\/(cache|out)(\/|$)/;
const NEVER_WHY = "never cleaned: Casper's ruling, 2026-11-21";

/** A browser build's folder in Playwright's registry: chromium-1243, chromium_headless_shell-1243, ffmpeg-1011. */
const BROWSER_DIR = /^[a-z][a-z0-9_]*-\d+$/;

/** Playwright's registry, where `playwright install` puts browsers. */
export function playwrightDir(env: NodeJS.ProcessEnv = process.env): string {
  const set = env["PLAYWRIGHT_BROWSERS_PATH"];
  if (set && set !== "0") return set;
  return process.platform === "darwin" ? join(homedir(), "Library", "Caches", "ms-playwright") : join(env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "ms-playwright");
}

export interface CommandResult {
  code: number | null;
  out: string;
  err: string;
}

/** Runs a command as its own process group; an abort kills the whole group. A missing command rejects. */
export function runCommand(command: string[], cwd: string, signal: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const child = spawn(command[0]!, command.slice(1), { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out = (out + d.toString()).slice(-OUTPUT_MAX)));
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-OUTPUT_MAX)));
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    };
    signal.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => {
      signal.removeEventListener("abort", kill);
      const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
      reject(missing && !existsSync(cwd) ? new Error(`${cwd}: no such folder`) : missing ? new Error(`${command[0]}: not found`) : e);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", kill);
      resolve({ code, out, err });
    });
  });
}

/** Free bytes on the volume holding `path`, or null when it can't be read. */
export async function freeBytes(path: string): Promise<number | null> {
  try {
    const s = await statfs(path);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/** What a step does or would do: a folder or file removed, a worktree removed, a prune run. */
export interface CleanupAction {
  kind: "dir" | "file" | "worktree" | "command";
  /** A path, or the command as one line. */
  target: string;
  /** Its size on disk, where known (a prune's isn't). */
  bytes: number | null;
  /** Set once acted on: why it failed. */
  error?: string;
}

export interface CleanupKept {
  path: string;
  why: string;
}

export interface StepOutcome {
  step: CleanupStepConfig["step"] | "logs";
  ok: boolean;
  error: string | null;
  /** Why it did nothing although it could run. */
  skipped: string | null;
  freed_bytes: number | null;
  actions: CleanupAction[];
  kept: CleanupKept[];
}

export interface ProjectOutcome {
  project: string;
  freed_bytes: number | null;
  steps: StepOutcome[];
}

export interface CleanupOutcome {
  dry_run: boolean;
  trigger: CleanupTrigger;
  /** A real run's, as the dashboard shows it; a dry run has none. */
  report: CleanupReport | null;
  projects: ProjectOutcome[];
  /** The supervisor's own: its logs. */
  steps: StepOutcome[];
}

export interface CleanupDeps {
  /** Every project on the laptop: those whose `cleanup` lists steps run them; all are looked at for what they use. */
  projects: () => ProjectConfig[];
  /** When it runs by itself; undefined, only when asked. */
  config: CleanupConfig | undefined;
  /** Folders live or queued workers run in: their worktrees are left whole. */
  busyDirs: () => string[];
  /** Standing roles' folders, and folders no worker may touch: a worktree holding one is never removed. */
  standingDirs: () => string[];
  /** The supervisor's worker logs (state_dir/logs); unset, the logs step doesn't run. */
  logsDir?: string;
  /** The logs live or queued workers write. */
  liveLogs?: () => string[];
  /** The run slot, waited for until `signal` aborts (SlotAbortedError). */
  acquireSlot: (signal: AbortSignal) => Promise<() => void>;
  /** A real run's report: kept, audited and sent with the next snapshot. */
  record: (report: CleanupReport) => void;
  log: Logger;
  now?: () => Date;
  freeBytes?: (path: string) => Promise<number | null>;
  run?: (command: string[], cwd: string, signal: AbortSignal) => Promise<CommandResult>;
  /** The prune commands; tests give their own. */
  commands?: Partial<typeof PRUNE_COMMANDS>;
  /** Playwright's registry; default playwrightDir(). */
  playwrightDir?: string;
  /** `pnpm store path` in a folder; null when pnpm can't say. */
  pnpmStorePath?: (cwd: string, signal: AbortSignal) => Promise<string | null>;
  /** Every process's command line (`ps -axo command`), to see a runner's job. */
  processes?: (signal: AbortSignal) => Promise<string[]>;
  /** Defaults when there is no `cleanup` section to say: a run asked for still times its steps out and waits for the slot. */
  stepTimeoutMs?: number;
  slotWaitMs?: number;
}

export class CleanupBusy extends Error {}

/** A step cut short by its timeout: what it did up to then stands. */
class StepTimeout extends Error {}

/** A step as run: a project's from its config, or the supervisor's own `logs`. */
type Step = CleanupStepConfig | { step: "logs" };

/** Steps that act on the whole laptop, whichever project lists them: they run once a run. */
const LAPTOP_WIDE = new Set(["docker", "playwright", "pnpm-store", "old-pnpm-stores"]);

export class Cleanup {
  private readonly deps: CleanupDeps;
  private readonly now: () => Date;
  private readonly free: (path: string) => Promise<number | null>;
  private readonly exec: (command: string[], cwd: string, signal: AbortSignal) => Promise<CommandResult>;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** The next scheduled run; null without a schedule. */
  private nextAt: Date | null = null;
  /** When the floor last started a run. */
  private floorAt: number | null = null;
  /** A run that got no slot: tried again at the next tick. */
  private retry: { trigger: CleanupTrigger; project?: string } | null = null;

  constructor(deps: CleanupDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.free = deps.freeBytes ?? freeBytes;
    this.exec = deps.run ?? runCommand;
    if (deps.config?.schedule) this.nextAt = nextRun(this.now(), deps.config.schedule);
  }

  start(): void {
    if (!this.deps.config || this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((err) => this.deps.log.error("cleanup tick failed", { err: (err as Error).message })), CLEANUP_TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private get stepTimeoutMs(): number {
    return this.deps.config?.stepTimeoutMs ?? this.deps.stepTimeoutMs ?? 30 * 60_000;
  }

  private get slotWaitMs(): number {
    return this.deps.config?.slotWaitMs ?? this.deps.slotWaitMs ?? 10 * 60_000;
  }

  /** What the logs keep: the config's, its defaults without a `cleanup` section, null when it says logs: false. */
  private get logKeep(): { keepMs: number; keepBytes: number } | null {
    return this.deps.config ? this.deps.config.logs : DEFAULT_LOG_KEEP;
  }

  /**
   * One look (every CLEANUP_TICK_MS): a run that got no slot goes again; else the schedule, if its
   * time passed; else the floor, if free space is below it and its last run is an interval old.
   * Null when nothing ran.
   */
  async tick(): Promise<CleanupOutcome | null> {
    if (this.running) return null;
    const now = this.now();
    let go: { trigger: CleanupTrigger; project?: string } | null = this.retry;
    const due = this.nextAt !== null && now >= this.nextAt;
    if (due) this.nextAt = nextRun(now, this.deps.config!.schedule!);
    if (!go && due) go = { trigger: "schedule" };
    if (!go && (await this.belowFloor(now))) {
      this.floorAt = now.getTime();
      go = { trigger: "floor" };
    }
    if (!go) return null;
    return this.run({ ...go, dryRun: false });
  }

  /** Free space under the floor on any project's volume, and the floor's last run at least its interval ago. */
  private async belowFloor(now: Date): Promise<boolean> {
    const c = this.deps.config;
    if (c?.floorBytes === undefined) return false;
    if (this.floorAt !== null && now.getTime() - this.floorAt < c.floorMinIntervalMs) return false;
    for (const p of this.deps.projects()) {
      const free = await this.free(p.path);
      if (free !== null && free < c.floorBytes) return true;
    }
    return false;
  }

  /**
   * A run: every project with steps, or `project`'s, then (for every project) the logs. A dry run
   * plans and changes nothing, and takes no slot; a real one waits for the slot up to slotWaitMs,
   * else is recorded "skipped: busy" and tried again at the next tick.
   */
  async run(opts: { trigger: CleanupTrigger; dryRun: boolean; project?: string }): Promise<CleanupOutcome> {
    const projects = this.deps.projects().filter((p) => p.cleanup.length > 0 && (opts.project === undefined || p.key === opts.project));
    if (opts.project !== undefined && projects.length === 0) throw new Error(`no project ${opts.project} with cleanup steps on this laptop`);
    if (this.running) throw new CleanupBusy("a cleanup is already running here");
    this.running = true;
    try {
      const at = this.now().toISOString();
      let release: (() => void) | null = null;
      if (!opts.dryRun) {
        try {
          release = await this.deps.acquireSlot(AbortSignal.timeout(this.slotWaitMs));
        } catch (err) {
          if (!(err instanceof SlotAbortedError)) throw err;
          this.retry = { trigger: opts.trigger, ...(opts.project !== undefined ? { project: opts.project } : {}) };
          const report: CleanupReport = { at, trigger: opts.trigger, skipped: "busy", freed_bytes: null, projects: [], steps: [] };
          this.deps.log.warn("cleanup skipped: the run slot is busy; it runs at the next tick", { trigger: opts.trigger });
          this.deps.record(report);
          return { dry_run: false, trigger: opts.trigger, report, projects: [], steps: [] };
        }
        this.retry = null;
      }
      try {
        const done = new Set<string>();
        const outcomes: ProjectOutcome[] = [];
        for (const p of projects) outcomes.push(await this.project(p, opts.dryRun, done));
        const own: StepOutcome[] = [];
        if (opts.project === undefined && this.deps.logsDir && this.logKeep) own.push(await this.step(this.deps.logsDir, "supervisor", { step: "logs" }, opts.dryRun));
        if (opts.dryRun) return { dry_run: true, trigger: opts.trigger, report: null, projects: outcomes, steps: own };
        const report: CleanupReport = {
          at,
          trigger: opts.trigger,
          skipped: null,
          freed_bytes: sum([...outcomes.map((o) => o.freed_bytes), ...own.map((s) => s.freed_bytes)]),
          projects: outcomes.map((o) => ({ project: o.project, freed_bytes: o.freed_bytes, steps: o.steps.map(stepReport) })),
          steps: own.map(stepReport),
        };
        this.deps.record(report);
        return { dry_run: false, trigger: opts.trigger, report, projects: outcomes, steps: own };
      } finally {
        release?.();
      }
    } finally {
      this.running = false;
    }
  }

  /** A project's steps in order; a laptop-wide one listed by several projects runs once a run (`done`). */
  private async project(p: ProjectConfig, dryRun: boolean, done: Set<string>): Promise<ProjectOutcome> {
    const before = dryRun ? null : await this.free(p.path);
    const steps: StepOutcome[] = [];
    for (const s of p.cleanup) {
      if (LAPTOP_WIDE.has(s.step)) {
        if (done.has(s.step)) continue;
        done.add(s.step);
      }
      steps.push(await this.step(p.path, p.key, s, dryRun, p));
    }
    const after = dryRun ? null : await this.free(p.path);
    return { project: p.key, freed_bytes: before === null || after === null ? null : after - before, steps };
  }

  /** One step under its timeout: its plan, then (unless dry) its actions, its freed bytes read at `where`. A failure is its own. */
  private async step(where: string, of: string, s: Step, dryRun: boolean, p?: ProjectConfig): Promise<StepOutcome> {
    const out: StepOutcome = { step: s.step, ok: true, error: null, skipped: null, freed_bytes: null, actions: [], kept: [] };
    const ctl = new AbortController();
    const ms = this.stepTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new StepTimeout(`timed out after ${fmtMs(ms)}`));
      }, ms);
    });
    const before = dryRun ? null : await this.free(where);
    try {
      await Promise.race([this.work(s, p, dryRun, ctl.signal, out), timedOut]);
      const failed = out.actions.filter((a) => a.error);
      if (failed.length) {
        out.ok = false;
        out.error = cut(`${failed.length} of ${out.actions.length} failed: ${failed[0]!.target}: ${failed[0]!.error}`, 300);
      }
    } catch (err) {
      out.ok = false;
      out.error = cut((err as Error).message, 300);
    } finally {
      clearTimeout(timer);
      ctl.abort();
    }
    if (!dryRun) {
      const after = await this.free(where);
      out.freed_bytes = before === null || after === null ? null : after - before;
      this.deps.log.info("cleanup step", { of, step: s.step, ok: out.ok, error: out.error, skipped: out.skipped, acted: out.actions.length, freed_bytes: out.freed_bytes });
    }
    return out;
  }

  private async work(s: Step, p: ProjectConfig | undefined, dryRun: boolean, signal: AbortSignal, out: StepOutcome): Promise<void> {
    switch (s.step) {
      case "worktrees":
        return this.worktrees(p!, s.line, dryRun, signal, out);
      case "ignored":
      case "paths":
        return this.ignored(p!, s, dryRun, signal, out);
      case "playwright":
        return this.playwright(dryRun, signal, out);
      case "old-pnpm-stores":
        return this.oldPnpmStores(dryRun, signal, out);
      case "runner":
        return this.runner(s.dirs, dryRun, signal, out);
      case "logs":
        return this.logs(dryRun, signal, out);
      case "docker":
      case "pnpm-store": {
        const command = [...(this.deps.commands?.[s.step] ?? PRUNE_COMMANDS[s.step]), ...(s.step === "docker" && s.volumes ? ["--volumes"] : [])];
        const action: CleanupAction = { kind: "command", target: command.join(" "), bytes: null };
        out.actions.push(action);
        if (dryRun) return;
        const r = await this.exec(command, p!.path, signal);
        if (r.code !== 0) throw new Error(`${action.target} exited ${r.code ?? "on a signal"}: ${lastLine(r.err) || lastLine(r.out)}`);
      }
    }
  }

  /** A command in a folder, its output; git's non-zero exit is an error. */
  private async git(args: string[], cwd: string, signal: AbortSignal): Promise<CommandResult> {
    return this.exec(["git", "-C", cwd, ...args], cwd, signal);
  }

  /** The project's worktrees, its main one first, as `git worktree list --porcelain` says. */
  private async worktreeList(p: ProjectConfig, signal: AbortSignal): Promise<Worktree[]> {
    const r = await this.git(["worktree", "list", "--porcelain"], p.path, signal);
    if (r.code !== 0) throw new Error(`git worktree list: ${lastLine(r.err)}`);
    return parseWorktrees(r.out);
  }

  /** Every configured project's worktree roots, its own and linked, that are there; a project git can't list gives its path. */
  private async allRoots(signal: AbortSignal): Promise<string[]> {
    const roots: string[] = [];
    for (const p of this.deps.projects()) {
      try {
        roots.push(...(await this.worktreeList(p, signal)).filter((w) => !w.bare && w.prunable === null).map((w) => w.path));
      } catch {
        roots.push(p.path);
      }
    }
    return [...new Set(roots.map(real))];
  }

  /** Removes a folder or file it has listed, unless dry; a failure is the action's own. */
  private async remove(action: CleanupAction, dryRun: boolean): Promise<void> {
    if (dryRun) return;
    try {
      await rm(action.target, { recursive: action.kind === "dir" });
    } catch (err) {
      action.error = (err as Error).message;
    }
  }

  /**
   * Each linked worktree that no live or queued worker uses, holds no standing role's folder, is
   * clean, and whose HEAD is on the line, removed with `git worktree remove` (no --force).
   */
  private async worktrees(p: ProjectConfig, line: string, dryRun: boolean, signal: AbortSignal, out: StepOutcome): Promise<void> {
    const list = await this.worktreeList(p, signal);
    const roots = list.map((w) => real(w.path));
    const busy = owners(this.deps.busyDirs(), roots);
    const standing = owners(this.deps.standingDirs(), roots);
    for (const wt of list.slice(1)) {
      signal.throwIfAborted();
      const keep = (why: string) => out.kept.push({ path: wt.path, why });
      if (wt.bare || wt.prunable !== null) continue;
      if (wt.locked !== null) {
        keep("locked");
        continue;
      }
      const root = real(wt.path);
      if (busy.has(root)) {
        keep("a live or queued worker uses it");
        continue;
      }
      if (standing.has(root)) {
        keep("a standing role's worktree");
        continue;
      }
      const status = await this.git(["status", "--porcelain"], wt.path, signal);
      if (status.code !== 0) {
        keep(`git status failed: ${lastLine(status.err)}`);
        continue;
      }
      if (status.out.trim()) {
        keep("its tree isn't clean");
        continue;
      }
      if (!wt.head) {
        keep("no commit");
        continue;
      }
      const merged = await this.git(["merge-base", "--is-ancestor", wt.head, line], p.path, signal);
      if (merged.code === 1) {
        keep(`${wt.branch ?? wt.head.slice(0, 12)} has commits not on ${line}`);
        continue;
      }
      if (merged.code !== 0) {
        keep(`can't tell whether it is on ${line}: ${lastLine(merged.err)}`);
        continue;
      }
      const action: CleanupAction = { kind: "worktree", target: wt.path, bytes: (await measure(wt.path, signal)).bytes };
      out.actions.push(action);
      if (dryRun) continue;
      const r = await this.git(["worktree", "remove", wt.path], p.path, signal);
      if (r.code !== 0) action.error = lastLine(r.err) || `exited ${r.code}`;
    }
  }

  /**
   * In each worktree no live or queued worker uses: `ignored`'s globs over what git lists as ignored
   * (`ls-files --others --ignored --directory`, so nothing inside an ignored folder, node_modules
   * say, is looked into), or `paths`' folders. Each is cleared only if git ignores it and tracks
   * nothing in it, its realpath is itself and inside the worktree, it isn't a worktree, and it holds
   * no .git, no live worker's or standing role's folder, and nothing Casper's ruling keeps.
   */
  private async ignored(p: ProjectConfig, s: Extract<CleanupStepConfig, { step: "ignored" | "paths" }>, dryRun: boolean, signal: AbortSignal, out: StepOutcome): Promise<void> {
    const list = await this.worktreeList(p, signal);
    const roots = list.filter((w) => !w.bare && w.prunable === null).map((w) => w.path);
    const allRoots = [...this.deps.projects().map((q) => q.path), ...roots].map(real);
    const busyDirs = this.deps.busyDirs().map(real);
    const busy = owners(busyDirs, roots.map(real));
    const standing = this.deps.standingDirs().map(real);
    const match = s.step === "ignored" ? globMatcher(s.globs) : null;
    for (const root of roots) {
      signal.throwIfAborted();
      const rootReal = real(root);
      if (busy.has(rootReal)) {
        out.kept.push({ path: root, why: "a live or queued worker uses this worktree" });
        continue;
      }
      let candidates: string[];
      if (s.step === "paths") candidates = s.paths.map((x) => x.replace(/\/+$/, ""));
      else {
        const r = await this.git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], root, signal);
        if (r.code !== 0) throw new Error(`git ls-files in ${root}: ${lastLine(r.err)}`);
        const entries = r.out.split("\0").filter(Boolean).map((x) => x.replace(/\/+$/, ""));
        // What the ruling keeps is listed, so a dry run shows it was looked at and left.
        for (const e of entries) if (NEVER_CLEAN.test(e) && !entries.some((o) => o !== e && NEVER_CLEAN.test(o) && e.startsWith(`${o}/`))) out.kept.push({ path: join(root, e), why: NEVER_WHY });
        candidates = entries.filter((x) => !NEVER_CLEAN.test(x) && match!(x));
      }
      for (const rel of candidates) {
        signal.throwIfAborted();
        const path = join(root, rel);
        const keep = (why: string) => out.kept.push({ path, why });
        let st;
        try {
          st = await lstat(path);
        } catch {
          continue; // not there in this worktree
        }
        if (NEVER_CLEAN.test(rel)) {
          keep(NEVER_WHY);
          continue;
        }
        if (st.isSymbolicLink()) {
          keep("a symlink");
          continue;
        }
        const target = real(path);
        if (target !== join(rootReal, rel)) {
          keep("a symlink in its path");
          continue;
        }
        if (!target.startsWith(rootReal + sep)) {
          keep("outside the repository");
          continue;
        }
        if (allRoots.some((r) => within(r, target))) {
          keep("a worktree, or holds one");
          continue;
        }
        if (busyDirs.some((d) => within(d, target))) {
          keep("holds a live or queued worker's folder");
          continue;
        }
        if (standing.some((d) => within(d, target))) {
          keep("holds a standing role's folder");
          continue;
        }
        if ((await this.git(["check-ignore", "-q", "--", rel], root, signal)).code !== 0 && (await this.git(["check-ignore", "-q", "--", `${rel}/`], root, signal)).code !== 0) {
          keep("not ignored by git");
          continue;
        }
        const tracked = await this.git(["ls-files", "-z", "--", rel], root, signal);
        if (tracked.code !== 0 || tracked.out.length > 0) {
          keep("git tracks files in it");
          continue;
        }
        const size = await measure(target, signal, (inner) => NEVER_CLEAN.test(relative(rootReal, inner)));
        if (size.git) {
          keep("holds a .git");
          continue;
        }
        if (size.flagged) {
          keep(`holds what is ${NEVER_WHY}`);
          continue;
        }
        const action: CleanupAction = { kind: st.isDirectory() ? "dir" : "file", target, bytes: size.bytes };
        out.actions.push(action);
        await this.remove(action, dryRun);
      }
    }
  }

  /**
   * The browser builds in Playwright's registry that no installed Playwright needs: the installed
   * ones are those its registry links to (each `playwright install` adds one) and those in the
   * projects' worktrees, each needing the builds its browsers.json names. With none found, all stay.
   */
  private async playwright(dryRun: boolean, signal: AbortSignal, out: StepOutcome): Promise<void> {
    const dir = this.deps.playwrightDir ?? playwrightDir();
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      out.skipped = `no Playwright browsers in ${dir}`;
      return;
    }
    const need = new Map<string, string>();
    const installs = new Set<string>();
    const links = await readdir(join(dir, ".links")).catch(() => [] as string[]);
    const linked = await Promise.all(links.map((l) => readFile(join(dir, ".links", l), "utf8").then((t) => t.trim(), () => null)));
    const local: string[] = [];
    for (const root of await this.allRoots(signal)) {
      local.push(join(root, "node_modules", "playwright-core"));
      const pnpmDir = join(root, "node_modules", ".pnpm");
      for (const e of await readdir(pnpmDir).catch(() => [] as string[])) if (e.startsWith("playwright-core@")) local.push(join(pnpmDir, e, "node_modules", "playwright-core"));
    }
    for (const pkg of [...linked.filter((x): x is string => !!x), ...local]) {
      signal.throwIfAborted();
      const builds = await browserBuilds(pkg);
      if (!builds) continue;
      installs.add(real(pkg));
      for (const b of builds) if (!need.has(b)) need.set(b, pkg);
    }
    if (installs.size === 0) {
      out.skipped = "no installed Playwright found, so every browser build is kept";
      return;
    }
    for (const name of names.filter((n) => BROWSER_DIR.test(n)).sort()) {
      signal.throwIfAborted();
      const path = join(dir, name);
      if (need.has(name)) {
        out.kept.push({ path, why: `needed by ${need.get(name)}` });
        continue;
      }
      if ((await lstat(path)).isSymbolicLink()) {
        out.kept.push({ path, why: "a symlink" });
        continue;
      }
      const action: CleanupAction = { kind: "dir", target: path, bytes: (await measure(path, signal)).bytes };
      out.actions.push(action);
      await this.remove(action, dryRun);
    }
  }

  /**
   * pnpm store versions beside the current one (~/Library/pnpm/store/v3 beside v11) that no
   * project's node_modules/.modules.yaml names as its storeDir. The current ones are what
   * `pnpm store path` says in each project.
   */
  private async oldPnpmStores(dryRun: boolean, signal: AbortSignal, out: StepOutcome): Promise<void> {
    const storePath = this.deps.pnpmStorePath ?? ((cwd: string, sig: AbortSignal) => this.exec(["pnpm", "store", "path"], cwd, sig).then((r) => (r.code === 0 ? lastLine(r.out) || null : null)));
    const current = new Set<string>();
    for (const p of this.deps.projects()) {
      const sp = existsSync(p.path) ? await storePath(p.path, signal) : null;
      if (sp) current.add(real(sp));
    }
    if (current.size === 0) throw new Error("pnpm store path named no store in any project");
    const named = new Map<string, string>();
    for (const root of await this.allRoots(signal)) {
      for (const file of await modulesYamls(root, signal)) {
        const dir = await readFile(file, "utf8").then((t) => (parse(t) as { storeDir?: unknown } | null)?.storeDir, () => undefined);
        if (typeof dir === "string" && !named.has(real(dir))) named.set(real(dir), file);
      }
    }
    for (const storeRoot of new Set([...current].map((c) => dirname(c)))) {
      for (const name of (await readdir(storeRoot).catch(() => [] as string[])).filter((n) => /^v\d+$/.test(n)).sort()) {
        signal.throwIfAborted();
        const path = join(storeRoot, name);
        const keep = (why: string) => out.kept.push({ path, why });
        if (current.has(real(path))) {
          keep("the current store");
          continue;
        }
        if (named.has(real(path))) {
          keep(`named by ${named.get(real(path))}`);
          continue;
        }
        if ((await lstat(path)).isSymbolicLink()) {
          keep("a symlink");
          continue;
        }
        const action: CleanupAction = { kind: "dir", target: path, bytes: (await measure(path, signal)).bytes };
        out.actions.push(action);
        await this.remove(action, dryRun);
      }
    }
  }

  /**
   * Each actions-runner folder, while no job (Runner.Worker) or update runs from it: the bin.* and
   * externals.* versions its `bin` and `externals` links don't point at, the last update's copy in
   * _work/_update, and the tool cache _work/_tool. A busy one is skipped, said so.
   */
  private async runner(dirs: string[], dryRun: boolean, signal: AbortSignal, out: StepOutcome): Promise<void> {
    const ps = this.deps.processes ?? ((sig: AbortSignal) => this.exec(["ps", "-axo", "command"], "/", sig).then((r) => r.out.split("\n")));
    const procs = await ps(signal);
    const skipped: string[] = [];
    for (const dir of dirs) {
      signal.throwIfAborted();
      const root = real(dir);
      if (!existsSync(join(root, "config.sh")) || !existsSync(join(root, "bin"))) {
        out.actions.push({ kind: "dir", target: dir, bytes: null, error: "isn't an actions-runner folder (no config.sh and bin)" });
        continue;
      }
      const from = (c: string) => c.includes(`${root}/`) || c.includes(`${resolve(dir)}/`);
      if (procs.some((c) => from(c) && (c.includes("Runner.Worker") || c.includes("_update.sh")))) {
        out.kept.push({ path: dir, why: "a runner job or update is running from it" });
        skipped.push(dir);
        continue;
      }
      const current = new Map<string, string | null>();
      for (const link of ["bin", "externals"]) current.set(link, await readlink(join(root, link)).then((t) => basename(t), () => null));
      const targets: string[] = [];
      for (const name of (await readdir(root)).sort()) {
        const m = /^(bin|externals)\.\d+\.\d+\.\d+$/.exec(name);
        if (!m) continue;
        const now = current.get(m[1]!);
        if (now === null) out.kept.push({ path: join(root, name), why: `${m[1]} isn't a link to a version, so which is current can't be told` });
        else if (name === now) out.kept.push({ path: join(root, name), why: "the current version" });
        else targets.push(join(root, name));
      }
      for (const sub of ["_work/_update", "_work/_tool"]) if (existsSync(join(root, sub))) targets.push(join(root, sub));
      for (const path of targets) {
        if ((await lstat(path)).isSymbolicLink()) {
          out.kept.push({ path, why: "a symlink" });
          continue;
        }
        const action: CleanupAction = { kind: "dir", target: path, bytes: (await measure(path, signal)).bytes };
        out.actions.push(action);
        await this.remove(action, dryRun);
      }
    }
    if (skipped.length) out.skipped = cut(`a runner job is running from ${skipped.join(", ")}`, 200);
  }

  /**
   * The supervisor's worker logs: those older than keepMs, then the oldest until they take keepBytes
   * at most. A live or queued worker's log is never removed, however old or large.
   */
  private async logs(dryRun: boolean, signal: AbortSignal, out: StepOutcome): Promise<void> {
    const keep = this.logKeep!;
    const live = new Set((this.deps.liveLogs?.() ?? []).map(real));
    const files: Array<{ path: string; mtime: number; bytes: number }> = [];
    const walk = async (p: string): Promise<void> => {
      for (const e of await readdir(p, { withFileTypes: true }).catch(() => [])) {
        signal.throwIfAborted();
        const path = join(p, e.name);
        if (e.isDirectory()) await walk(path);
        else if (e.isFile()) {
          const st = await lstat(path);
          files.push({ path, mtime: st.mtimeMs, bytes: st.size });
        }
      }
    };
    await walk(this.deps.logsDir!);
    files.sort((a, b) => a.mtime - b.mtime);
    const now = this.now().getTime();
    let total = files.reduce((a, f) => a + f.bytes, 0);
    for (const f of files) {
      const old = now - f.mtime > keep.keepMs;
      if (!old && total <= keep.keepBytes) continue;
      if (live.has(real(f.path))) {
        out.kept.push({ path: f.path, why: "a live worker's open log" });
        continue;
      }
      const action: CleanupAction = { kind: "file", target: f.path, bytes: f.bytes };
      out.actions.push(action);
      total -= f.bytes;
      await this.remove(action, dryRun);
    }
  }
}

interface Worktree {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  locked: string | null;
  prunable: string | null;
}

/** `git worktree list --porcelain`'s blocks. */
export function parseWorktrees(text: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n").filter(Boolean);
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    const value = (key: string) => {
      const l = lines.find((x) => x === key || x.startsWith(`${key} `));
      return l === undefined ? null : l.slice(key.length + 1);
    };
    out.push({ path, head: value("HEAD"), branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null, bare: value("bare") !== null, locked: value("locked"), prunable: value("prunable") });
  }
  return out;
}

/**
 * A matcher for `ignored`'s globs, as .gitignore reads them: one without a slash matches a name at
 * any depth; one with a slash, the path from the repository's root. `*` stays within a name, `**`
 * crosses them.
 */
export function globMatcher(globs: string[]): (path: string) => boolean {
  const res = globs.map((g) => {
    const anchored = g.replace(/^\/+|\/+$/g, "");
    const body = anchored
      .split(/(\*\*\/?|\*|\?)/)
      .map((part) => (part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
      .join("");
    return { re: new RegExp(`^${body}$`), name: !anchored.includes("/") };
  });
  return (path) => res.some(({ re, name }) => re.test(name ? path.slice(path.lastIndexOf("/") + 1) : path));
}

/**
 * A folder's size on disk (blocks, not following symlinks), whether anything in it is named .git,
 * and whether `flag` holds for any path in it.
 */
export async function measure(path: string, signal: AbortSignal, flag?: (path: string) => boolean): Promise<{ bytes: number; git: boolean; flagged: boolean }> {
  let bytes = 0;
  let git = false;
  let flagged = false;
  const walk = async (p: string): Promise<void> => {
    signal.throwIfAborted();
    const st = await lstat(p);
    bytes += st.blocks * 512;
    if (flag?.(p)) flagged = true;
    if (!st.isDirectory()) return;
    for (const e of await readdir(p, { withFileTypes: true })) {
      if (e.name === ".git") git = true;
      await walk(join(p, e.name));
    }
  };
  await walk(path);
  return { bytes, git, flagged };
}

/** The browser builds a Playwright package needs, as its browsers.json names them (every platform's override too); null if it has none. */
async function browserBuilds(pkg: string): Promise<string[] | null> {
  try {
    const json = JSON.parse(await readFile(join(pkg, "browsers.json"), "utf8")) as { browsers?: Array<{ name: string; revision: string; revisionOverrides?: Record<string, string> }> };
    if (!Array.isArray(json.browsers)) return null;
    return json.browsers.flatMap((b) => [b.revision, ...Object.values(b.revisionOverrides ?? {})].map((rev) => `${b.name.replace(/-/g, "_")}-${rev}`));
  } catch {
    return null;
  }
}

/** The node_modules/.modules.yaml files in a worktree and two levels of folders below it (a workspace's packages). */
async function modulesYamls(root: string, signal: AbortSignal): Promise<string[]> {
  const out: string[] = [];
  const look = async (dir: string, depth: number): Promise<void> => {
    signal.throwIfAborted();
    const file = join(dir, "node_modules", ".modules.yaml");
    if (existsSync(file)) out.push(file);
    if (depth === 0) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") await look(join(dir, e.name), depth - 1);
    }
  };
  await look(root, 2);
  return out;
}

/** A path's realpath, or itself resolved as far as it exists. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const up = dirname(p);
    return up === p ? p : join(real(up), p.slice(up.length + 1));
  }
}

/** The worktrees (realpaths, of `roots`) holding each folder: its innermost, as worktrees nest under .worktrees/. */
function owners(dirs: string[], roots: string[]): Set<string> {
  const out = new Set<string>();
  for (const d of dirs.map(real)) {
    const holding = roots.filter((r) => within(d, r)).sort((a, b) => b.length - a.length)[0];
    if (holding) out.add(holding);
  }
  return out;
}

/** Whether `inner` is `outer` or inside it. */
const within = (inner: string, outer: string) => {
  const rel = relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const stepReport = (s: StepOutcome): CleanupStepReport => ({ step: s.step, ok: s.ok, error: s.error, skipped: s.skipped, acted: s.actions.filter((a) => !a.error).length, freed_bytes: s.freed_bytes });
const sum = (xs: Array<number | null>) => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, x) => a + x!, 0));
const lastLine = (s: string) => s.trim().split("\n").at(-1)?.trim() ?? "";
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fmtMs = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${ms} ms`);

/**
 * An outcome as a tool answers it, each step's paths listed up to `listed` (the rest counted), so a
 * remote reply fits its body: the caller lowers `listed` until it does.
 */
export function cleanupView(o: CleanupOutcome, listed = LISTED): Record<string, unknown> {
  const step = (s: StepOutcome) => ({
    step: s.step,
    ok: s.ok,
    ...(s.error ? { error: s.error } : {}),
    ...(s.skipped ? { skipped: s.skipped } : {}),
    ...(o.dry_run ? {} : { freed_bytes: s.freed_bytes }),
    [o.dry_run ? "would" : "acted"]: s.actions.slice(0, listed).map((a) => ({ [a.kind === "command" ? "command" : "path"]: a.target, bytes: a.bytes, ...(a.error ? { error: a.error } : {}) })),
    ...(s.actions.length > listed ? { more: s.actions.length - listed } : {}),
    kept: s.kept.slice(0, listed),
    ...(s.kept.length > listed ? { more_kept: s.kept.length - listed } : {}),
  });
  const wouldFree = (steps: StepOutcome[]) => sum(steps.flatMap((s) => s.actions.map((a) => a.bytes)).filter((b) => b !== null));
  return {
    dry_run: o.dry_run,
    trigger: o.trigger,
    ...(o.report ? { at: o.report.at, skipped: o.report.skipped, freed_bytes: o.report.freed_bytes } : {}),
    projects: o.projects.map((p) => ({ project: p.project, ...(o.dry_run ? { would_free_bytes: wouldFree(p.steps) } : { freed_bytes: p.freed_bytes }), steps: p.steps.map(step) })),
    ...(o.steps.length ? { supervisor: o.steps.map(step) } : {}),
  };
}
