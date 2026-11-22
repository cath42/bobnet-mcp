import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { EFFORTS, type Effort, isValidSegment } from "@bobnet/protocol";
import { parse } from "yaml";
import { z } from "zod";

// One config folder, ~/.config/bobnet/:
//   config.json      broker URL and Keychain item names (shared with the client)
//   supervisor.yaml  this laptop: limits, the orchestrator, projects and their roles
//   policy.yaml      approval rules (see policy.ts)

const expand = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const path = z.string().min(1).transform(expand);

/**
 * Variables that would bill a worker's model calls to an API key or another
 * provider instead of the Claude subscription it runs under. Never passed to
 * a worker, and refused in config.
 */
export const BILLING_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

const Env = z
  .record(z.string(), z.string())
  .default({})
  .refine((env) => !BILLING_ENV.some((k) => k in env), `must not set ${BILLING_ENV.join(", ")}: workers bill to the subscription`);

/** Reasoning effort levels, lowest first (the remote wire's too). */
export { EFFORTS, type Effort };
const EffortLevel = z.enum(EFFORTS);

/**
 * What a worker runs on: its role's default, which a spawn may override within the
 * role's limits (`models` it may use, `max_effort`). A role takes the project's
 * values for whatever it leaves unset.
 */
const Power = {
  model: z.string().optional(),
  effort: EffortLevel.optional(),
  /** Models a spawn may choose instead of the default; unset allows any. */
  models: z.array(z.string()).min(1).optional(),
  /** The highest effort a spawn may choose; unset allows any. */
  max_effort: EffortLevel.optional(),
  /**
   * "auto": Claude Code's classifier approves or denies each call, as for an
   * interactive agent; policy.yaml's rules still run first and win. "default":
   * policy.yaml decides every call no settings already allow.
   */
  permission_mode: z.enum(["default", "auto"]).optional(),
  /** Lets sandboxed Bash connect to (and listen on) localhost: the local database, a dev server. */
  sandbox_localhost: z.boolean().optional(),
  /**
   * Claude Code's OS sandbox for Bash (default on). Off, Bash runs as in the CLI:
   * auto mode's classifier and policy.yaml are then the only guards.
   */
  sandbox: z.boolean().optional(),
};

const Role = z.object({
  /** BobNet name; defaults to the role key with a capital first letter. */
  name: z.string().refine(isValidSegment, "must be a valid BobNet name").optional(),
  dir: path,
  ...Power,
  allowed_tools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  /** Built-in tools the worker has, in place of WORKER_TOOLS. */
  tools: z.array(z.string()).optional(),
  /** Servers from the project's .mcp.json the worker gets; no other MCP server reaches it. */
  mcp: z.array(z.string()).default([]),
  /** Auto-memory folder (its MEMORY.md is the index the worker loads); false turns memory off. */
  memory_dir: z.union([path, z.literal(false)]).optional(),
  env: Env,
  /** Where the worker may write; defaults to the git worktree that holds `dir`. */
  write_roots: z.array(path).optional(),
  /** Claude Code's OS sandbox for Bash; off only for roles that truly need it off. */
  sandbox: z.boolean().optional(),
  purpose: z.string().optional(),
  /** Remote Control for this role's workers; unset takes the project's, then the supervisor's (on). */
  remote_control: z.boolean().optional(),
  /**
   * A lead role: one that may run as a lead, a long-lived session Casper talks to (Casper,
   * 2026-11-07: as many per project as it needs). Whether a run is one is its spawn's `as`, a
   * worker unless it says lead: a lead stays alive between turns (a result doesn't end it; a stop
   * does), holds no worker slot and is never stalled by the clock; run as a worker, the role ends
   * after its result like any other. A lead role runs in auto mode unless told otherwise. The one
   * named as the project's orchestrator is also the orchestrator when run as a lead: the
   * orchestrator's tools, no policy rules but the guards, its own requests Casper's. Any other lead
   * is under policy.yaml like the rest.
   */
  lead: z.boolean().default(false),
});

/** A command a worker may have the supervisor run outside the sandbox: one a browser needs, say. */
const Run = z.object({
  command: z.array(z.string()).min(1),
  /** What it does, for the worker's tool description. */
  description: z.string().min(1),
  /** Where it runs, relative to the worker's worktree. */
  cwd: z.string().default(".").refine((d) => !isAbsolute(d) && !d.split("/").includes(".."), "must be inside the worktree"),
  roles: z.array(z.string()).default(["*"]),
  /** A regex every extra argument must match; without it the command takes none. */
  args: z.string().optional(),
  timeout_minutes: z.number().positive().default(10),
  /** Variables for this command on top of the role's; paths in them are relative to `cwd`. */
  env: Env,
  /** Holds one of the laptop's run slots while it runs. */
  slot: z.boolean().default(true),
});

const Project = z.object({
  path,
  /** Lower runs first when workers queue. */
  priority: z.number().int().default(10),
  ...Power,
  team: z.string().refine(isValidSegment, "must be a valid BobNet team").optional(),
  /** This project's orchestrator, when it isn't the laptop's. */
  orchestrator: z.string().refine(isValidSegment, "must be a valid BobNet name").optional(),
  /** The folder the orchestrator's Claude Code session runs in: its transcripts there are its usage on the board. */
  orchestrator_dir: path.optional(),
  /** Environment for every role in the project; a role's own env wins. */
  env: Env,
  /** Every role's memory_dir, unless the role sets its own. */
  memory_dir: z.union([path, z.literal(false)]).optional(),
  /** Remote Control for the project's workers, unless a role says otherwise; unset takes the supervisor's. */
  remote_control: z.boolean().optional(),
  /** How a worker lands its commits: run by the supervisor in the worker's worktree, in a run slot. */
  land: z
    .object({
      command: z.array(z.string()).min(1),
      timeout_minutes: z.number().positive().default(30),
      /** Prints `export NAME='value'` lines for the land's environment (read at run time, never stored). */
      env_command: z.array(z.string()).min(1).optional(),
      /** Variables the land refuses to run without, naming the one missing. */
      requires_env: z.array(z.string()).default([]),
      /** The exit code meaning "held": the tip waits and lands after the hold, so it isn't a refusal. */
      held_exit: z.number().int().optional(),
      /** The exit code meaning "flaky": nothing of the author's is wrong (ADR 0093 §4 (d)), so the same tip may land once more. */
      flaky_exit: z.number().int().optional(),
      /**
       * The branch the land pushes to, as remote/branch (BobNet's: origin/v2). Set, a tip behind it
       * is rebased onto it in the slot before the check, and a run it moved under is "stale", not
       * refused. Unset (Helix: its integrator replays onto main), neither.
       */
      target: z.string().regex(/^[\w.-]+\/[\w./-]+$/, "must be remote/branch, e.g. origin/main").optional(),
    })
    .optional(),
  /**
   * Gives workers a rebase tool: the supervisor rebases the worker's branch onto `onto`
   * outside the sandbox, which write-protects .claude/ even in the worker's own tree.
   */
  rebase: z.object({ onto: z.string().regex(/^[\w.-]+\/[\w./-]+$/, "must be remote/branch, e.g. origin/main") }).optional(),
  /** Commands workers may run outside the sandbox through the run tool, by name. */
  runs: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, "must be lowercase, digits and -"), Run).default({}),
  /** A hold file (for helix, `pnpm integrate hold`'s): reported in run_slots; the land command itself answers a land under it with "held". */
  hold_file: path.optional(),
  /**
   * A Backlog.md backlog the dashboard shows as boards: its folder in the repository, read at `ref`
   * (default: the rebase target, else origin/main) through git, never from a worktree.
   */
  backlog: z
    .object({
      dir: z.string().regex(/^[\w.-]+(\/[\w.-]+)*$/, "must be a path inside the repository, e.g. product/backlog"),
      ref: z.string().regex(/^[\w.-]+(\/[\w./-]+)?$/).optional(),
    })
    .optional(),
  /**
   * `service`: the project's board is BobNet's board service (ADR 0001 §8), not Backlog.md. Spawns
   * join their declared session on it, and runs, pushes and slot runs are reported to it.
   */
  board: z.literal("service").optional(),
  /** Roles any worker in the project may consult mid-task. */
  consult: z.array(z.string()).default([]),
  /**
   * The steps of this project's disk cleanup (BOB-123), from a fixed set: a name, or a one-key map
   * for a step's own settings (`ignored: [globs]`, `paths: [dirs]`, `worktrees: { line }`). Nothing
   * runs that isn't listed. Read by parseCleanupSteps, which names an unknown step.
   */
  cleanup: z.array(z.unknown()).default([]),
  roles: z.record(z.string(), Role),
}).refine((p) => !(p.board && p.backlog), { message: "a project's board is the service or a backlog, not both", path: ["board"] });

const SupervisorFile = z.object({
  /** BobNet name of the orchestrator session on this laptop. */
  orchestrator: z.string().refine(isValidSegment, "must be a valid BobNet name"),
  /** BobNet name the supervisor itself registers as. */
  name: z.string().refine(isValidSegment).default("supervisor"),
  team: z.string().refine(isValidSegment).optional(),
  concurrency: z.number().int().positive().default(3),
  /** A worker with no events this long, between tool calls, is stuck: interrupted, asked for its handoff, the orchestrator told. */
  stall_minutes: z.number().positive().default(15),
  /** The same for a tool call that runs this long with no output (a long verify is quiet; a hung one stays so). */
  tool_stall_minutes: z.number().positive().default(45),
  request_timeout_minutes: z.number().positive().default(60),
  // prefault, not default: zod 4 hands a default out unparsed, so "~" would stay literal.
  state_dir: path.prefault("~/.local/state/bobnet"),
  mcp_port: z.number().int().min(1024).max(65535).default(7425),
  /** Heavy runs (tests, probes, landing) at once on this laptop (ADR 0094 §2: one). */
  run_slots: z.number().int().positive().default(1),
  /** How long a consulted role has to answer. */
  consult_timeout_minutes: z.number().positive().default(10),
  /** What a consult runs on: a short advisory answer needs less than the role's own work. */
  consult_model: z.string().optional(),
  consult_effort: EffortLevel.optional(),
  /** More paths every sandboxed worker may write, e.g. fnm's multishell folder. */
  sandbox_write: z.array(path).default([]),
  /**
   * Every worker starts with Remote Control on (Casper, 2026-11-07): its session shows in
   * claude.ai/code under its name, and Casper can follow it and type to it there; its URL is in
   * worker_status and on the dashboard. A project or role may turn it off; a consult never has it.
   */
  remote_control: z.boolean().default(true),
  /**
   * Who may ask this supervisor, over BobNet, to spawn: a sender's address (name@laptop, as the
   * broker stamps it) to the roles it may spawn, by project. It may follow and stop only what it
   * spawned, and (`v: 2`, ADR 0007 §4) answer those workers' requests while its entry still lists
   * their project and role: the entry grants the orchestrator on the requester's laptop what a local
   * one has over the workers it spawned, any orchestrator there, since the spawner is the laptop's
   * supervisor. Its `user_decided` is its assertion, as locally, so it makes human-tier decisions too.
   * Removing the entry, or the role from it, ends answering too, from the next start (the config is
   * read then), whenever the worker was spawned. It changes no policy or role.
   * Anyone else is refused.
   * `upgrade: true` also lets it upgrade and restart this supervisor (ADR 0008 §2): off unless said,
   * apart from `spawn`; an entry has either or both.
   */
  remote: z
    .record(
      z.string().refine((a) => a.split("@").length === 2 && a.split("@").every(isValidSegment), "must be name@laptop"),
      z
        .object({ spawn: z.record(z.string(), z.array(z.string()).min(1)).optional(), upgrade: z.boolean().default(false), cleanup: z.boolean().default(false) })
        .refine((e) => e.spawn !== undefined || e.upgrade || e.cleanup, "must grant spawn, upgrade: true, cleanup: true, or more than one"),
    )
    .default({}),
  /**
   * When this laptop's disk cleanup runs (BOB-123): daily at `schedule` (HH:MM, this laptop's time),
   * and when free space falls below `floor_gib`, at most once per `floor_min_interval` (30m, 6h, 1d).
   * What runs is each project's `cleanup` list. Without this section, it runs only when asked.
   */
  cleanup: z
    .object({
      schedule: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM").optional(),
      floor_gib: z.number().positive().optional(),
      floor_min_interval: z.string().regex(/^\d+[mhd]$/, "must be a number and m, h or d, e.g. 6h").default("6h"),
      /** A step running longer is killed, its whole process group with it. */
      step_timeout_minutes: z.number().positive().default(30),
      /** How long a run waits for the run slot before it is "skipped: busy". */
      slot_wait_minutes: z.number().positive().default(10),
      /**
       * The supervisor's own worker logs (state_dir/logs), cleared in every run unless false: a log older
       * than keep_days goes, then the oldest until they take keep_mb at most. A live worker's never.
       */
      logs: z
        .union([z.literal(false), z.object({ keep_days: z.number().positive().default(14), keep_mb: z.number().positive().default(1024) })])
        .default({ keep_days: 14, keep_mb: 1024 }),
    })
    .optional(),
  /**
   * Where this supervisor's releases come from when it upgrades itself (ADR 0008 §3): tags on
   * `origin/<line>` of the local clone `repo`, installed under `root`. Without it, no upgrade.
   */
  upgrade: z
    .object({
      repo: path,
      root: path.optional(),
      line: z.string().regex(/^[\w.-]+(\/[\w.-]+)*$/, "must be a branch name, e.g. v2").default("v2"),
    })
    .optional(),
  /**
   * The board's nightly backup (ADR 0001 §11): at `at` (HH:MM, this laptop's time) the board's export
   * is written to `board.json` in the git repository `repo` and committed. Never read back but by an import.
   */
  board_backup: z
    .object({
      repo: path,
      at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM"),
    })
    .optional(),
  projects: z.record(z.string(), Project),
});

export interface RoleConfig {
  key: string;
  project: string;
  name: string;
  dir: string;
  team: string | undefined;
  model: string | undefined;
  effort: Effort | undefined;
  models: string[] | undefined;
  maxEffort: Effort | undefined;
  permissionMode: "default" | "auto";
  sandboxLocalhost: boolean;
  allowedTools: string[] | undefined;
  disallowedTools: string[] | undefined;
  tools: string[] | undefined;
  /** Server name to config, read from the project's .mcp.json. */
  mcpServers: Record<string, unknown>;
  /** undefined: Claude Code's default folder. */
  memoryDir: string | false | undefined;
  env: Record<string, string>;
  /** A consult's short life; a worker has none, only stuck detection. */
  maxRuntimeMinutes?: number;
  writeRoots: string[];
  sandbox: boolean;
  purpose: string | undefined;
  remoteControl: boolean;
  lead: boolean;
  /** The lead named as its project's orchestrator: the orchestrator, run as a worker. */
  orchestrator: boolean;
}

export interface RunConfig {
  name: string;
  command: string[];
  description: string;
  cwd: string;
  roles: string[];
  args: RegExp | undefined;
  timeoutMinutes: number;
  env: Record<string, string>;
  slot: boolean;
}

export interface ProjectConfig {
  key: string;
  path: string;
  priority: number;
  team: string | undefined;
  orchestrator: string;
  orchestratorDir: string | undefined;
  land: { command: string[]; timeoutMinutes: number; envCommand: string[] | undefined; requiresEnv: string[]; heldExit: number | undefined; flakyExit: number | undefined; target?: { remote: string; branch: string } | undefined } | undefined;
  rebase: { remote: string; branch: string } | undefined;
  runs: Map<string, RunConfig>;
  holdFile: string | undefined;
  backlog: { dir: string; ref: string } | undefined;
  board: "service" | undefined;
  consult: string[];
  /** Its disk cleanup's steps (BOB-123), in the order listed; empty, none runs. */
  cleanup: CleanupStepConfig[];
  roles: Map<string, RoleConfig>;
}

/** One step of a project's cleanup (BOB-123). Globs and paths are relative to each of its worktrees. */
export type CleanupStepConfig =
  | { step: "worktrees"; line: string }
  | { step: "ignored"; globs: string[] }
  | { step: "paths"; paths: string[] }
  | { step: "docker"; volumes: boolean }
  | { step: "runner"; dirs: string[] }
  | { step: "playwright" | "pnpm-store" | "old-pnpm-stores" };

export interface CleanupConfig {
  schedule: string | undefined;
  floorBytes: number | undefined;
  floorMinIntervalMs: number;
  stepTimeoutMs: number;
  slotWaitMs: number;
  /** The supervisor's own logs: kept this long and this big at most; null leaves them alone. */
  logs: { keepMs: number; keepBytes: number } | null;
}

/** What the logs keep when there is no `cleanup` section to say. */
export const DEFAULT_LOG_KEEP = { keepMs: 14 * 86_400_000, keepBytes: 1024 * 2 ** 20 };

export interface SupervisorConfig {
  orchestrator: string;
  name: string;
  team: string | undefined;
  concurrency: number;
  stallMinutes: number;
  toolStallMinutes: number;
  requestTimeoutMinutes: number;
  stateDir: string;
  mcpPort: number;
  runSlots: number;
  consultTimeoutMinutes: number;
  consultModel: string | undefined;
  consultEffort: Effort | undefined;
  sandboxWrite: string[];
  /** Remote requesters, by lowercase address: project → roles each may spawn. */
  remote: Map<string, Map<string, Set<string>>>;
  /** The remote requesters, by lowercase address, that may upgrade this supervisor (ADR 0008 §2). */
  remoteUpgrade: Set<string>;
  /** The remote requesters, by lowercase address, that may run a cleanup here (BOB-123). */
  remoteCleanup: Set<string>;
  /** When the cleanup runs by itself; undefined, only when asked. */
  cleanup: CleanupConfig | undefined;
  /** Where upgrades come from and go (§3); undefined without an `upgrade` section, and then none runs. */
  upgrade: UpgradeConfig | undefined;
  /** The releases' folder (§1): `upgrade.root`, else ~/.local/share/bobnet. Workers never touch it. */
  releaseRoot: string;
  /** The board's nightly backup, if this laptop makes it. */
  boardBackup: { repo: string; at: string } | undefined;
  projects: Map<string, ProjectConfig>;
}

export interface UpgradeConfig {
  /** The local clone tags are fetched in. */
  repo: string;
  /** Releases go in `<root>/<tag>`; `current` and `previous` link to them. */
  root: string;
  /** The branch on origin a tag must be on. */
  line: string;
}

/** Where releases are installed unless `upgrade.root` says otherwise (ADR 0008 §1). */
export const DEFAULT_RELEASE_ROOT = expand("~/.local/share/bobnet");

/**
 * The releases' folder supervisor.yaml names, read loosely: install-systemd and install-launchd run
 * before (and without) a config that parses, so any problem gives the default.
 */
export function releaseRoot(dir = configDir()): string {
  try {
    const raw = parse(readFileSync(join(dir, "supervisor.yaml"), "utf8")) as { upgrade?: { root?: unknown } } | null;
    const root = raw?.upgrade?.root;
    return typeof root === "string" && root ? expand(root) : DEFAULT_RELEASE_ROOT;
  } catch {
    return DEFAULT_RELEASE_ROOT;
  }
}

/**
 * The folders besides the config folder that no worker may touch (ADR 0008, rulings 4 and 5): the
 * releases' (the default and upgrade.root's), and the clone upgrades come from, wherever it is.
 */
export function guardedFolders(config: Pick<SupervisorConfig, "releaseRoot" | "upgrade">): string[] {
  return [...new Set([DEFAULT_RELEASE_ROOT, config.releaseRoot, ...(config.upgrade ? [config.upgrade.repo] : [])])];
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return expand(env["BOBNET_CONFIG_DIR"] ?? "~/.config/bobnet");
}

function gitRoot(dir: string): string {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return dir;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Parses supervisor.yaml text; `resolveRoot` finds a role's default write root. */
export function parseSupervisorConfig(
  text: string,
  resolveRoot: (dir: string) => string = gitRoot,
): SupervisorConfig {
  const file = SupervisorFile.parse(parse(text));
  const projects = new Map<string, ProjectConfig>();
  const names = new Map<string, string>();
  names.set(file.name.toLowerCase(), "the supervisor");
  names.set(file.orchestrator.toLowerCase(), "the orchestrator");
  for (const [pKey, p] of Object.entries(file.projects)) {
    if (!p.orchestrator) continue;
    const clash = names.get(p.orchestrator.toLowerCase());
    if (clash && clash !== "the orchestrator" && !clash.startsWith("orchestrator of ")) {
      throw new Error(`${pKey}: orchestrator ${p.orchestrator} is already used by ${clash}`);
    }
    names.set(p.orchestrator.toLowerCase(), `orchestrator of ${pKey}`);
  }

  for (const [pKey, p] of Object.entries(file.projects)) {
    const roles = new Map<string, RoleConfig>();
    const orchestrator = p.orchestrator ?? file.orchestrator;
    for (const [rKey, r] of Object.entries(p.roles)) {
      const name = r.name ?? capitalize(rKey);
      if (!isValidSegment(name)) throw new Error(`${pKey}.${rKey}: "${name}" is not a valid BobNet name`);
      // A lead named as the project's orchestrator is the orchestrator, run as a worker: that name is its own.
      const isOrchestrator = r.lead && name.toLowerCase() === orchestrator.toLowerCase();
      const clash = isOrchestrator ? undefined : names.get(name.toLowerCase());
      if (clash) throw new Error(`${pKey}.${rKey}: BobNet name ${name} is already used by ${clash}`);
      names.set(name.toLowerCase(), `${pKey}.${rKey}`);
      const dir = isAbsolute(r.dir) ? r.dir : resolve(p.path, r.dir);
      roles.set(rKey, {
        key: rKey,
        project: pKey,
        name,
        dir,
        team: p.team,
        model: r.model ?? p.model,
        effort: r.effort ?? p.effort,
        models: r.models ?? p.models,
        maxEffort: r.max_effort ?? p.max_effort,
        // A lead runs as the interactive orchestrator does, in auto mode, unless told otherwise: policy doesn't
        // settle its calls, so in "default" every one would go to Casper (Phelps on ubu1, 2026-11-07).
        permissionMode: r.permission_mode ?? p.permission_mode ?? (r.lead ? "auto" : "default"),
        sandboxLocalhost: r.sandbox_localhost ?? p.sandbox_localhost ?? false,
        allowedTools: r.allowed_tools,
        disallowedTools: r.disallowed_tools,
        tools: r.tools,
        mcpServers: pickMcp(`${pKey}.${rKey}`, r.mcp, () => readMcp(p.path)),
        memoryDir: r.memory_dir ?? p.memory_dir,
        env: { ...p.env, ...r.env },
        writeRoots: r.write_roots ?? [resolveRoot(dir)],
        sandbox: r.sandbox ?? p.sandbox ?? true,
        purpose: r.purpose,
        remoteControl: r.remote_control ?? p.remote_control ?? file.remote_control,
        lead: r.lead,
        orchestrator: isOrchestrator,
      });
    }
    for (const c of p.consult) if (!roles.has(c)) throw new Error(`${pKey}.consult: no role ${c}`);
    const runs = new Map<string, RunConfig>();
    for (const [name, r] of Object.entries(p.runs)) {
      for (const role of r.roles) if (role !== "*" && !roles.has(role)) throw new Error(`${pKey}.runs.${name}: no role ${role}`);
      runs.set(name, { name, command: r.command, description: r.description, cwd: r.cwd, roles: r.roles, args: r.args === undefined ? undefined : new RegExp(r.args), timeoutMinutes: r.timeout_minutes, env: r.env, slot: r.slot });
    }
    projects.set(pKey, {
      key: pKey,
      path: p.path,
      priority: p.priority,
      team: p.team,
      orchestrator,
      orchestratorDir: p.orchestrator_dir,
      land: p.land
        ? { command: p.land.command, timeoutMinutes: p.land.timeout_minutes, envCommand: p.land.env_command, requiresEnv: p.land.requires_env, heldExit: p.land.held_exit, flakyExit: p.land.flaky_exit, target: p.land.target ? remoteBranch(p.land.target) : undefined }
        : undefined,
      rebase: p.rebase ? remoteBranch(p.rebase.onto) : undefined,
      runs,
      holdFile: p.hold_file,
      backlog: p.backlog ? { dir: p.backlog.dir, ref: p.backlog.ref ?? (p.rebase?.onto ?? "origin/main") } : undefined,
      board: p.board,
      consult: p.consult,
      cleanup: parseCleanupSteps(pKey, p.cleanup, p.land?.target ?? p.rebase?.onto ?? "origin/main"),
      roles,
    });
  }

  const remote = new Map<string, Map<string, Set<string>>>();
  const remoteUpgrade = new Set<string>();
  const remoteCleanup = new Set<string>();
  for (const [address, r] of Object.entries(file.remote)) {
    const may = new Map<string, Set<string>>();
    if (r.upgrade) remoteUpgrade.add(address.toLowerCase());
    if (r.cleanup) remoteCleanup.add(address.toLowerCase());
    for (const [pKey, roles] of Object.entries(r.spawn ?? {})) {
      const p = projects.get(pKey);
      if (!p) throw new Error(`remote.${address}: no project ${pKey}`);
      for (const role of roles) if (!p.roles.has(role)) throw new Error(`remote.${address}: no role ${role} in ${pKey}`);
      may.set(pKey, new Set(roles));
    }
    remote.set(address.toLowerCase(), may);
  }

  return {
    orchestrator: file.orchestrator,
    name: file.name,
    team: file.team,
    concurrency: file.concurrency,
    stallMinutes: file.stall_minutes,
    toolStallMinutes: file.tool_stall_minutes,
    requestTimeoutMinutes: file.request_timeout_minutes,
    stateDir: file.state_dir,
    mcpPort: file.mcp_port,
    runSlots: file.run_slots,
    consultTimeoutMinutes: file.consult_timeout_minutes,
    consultModel: file.consult_model,
    consultEffort: file.consult_effort,
    sandboxWrite: file.sandbox_write,
    remote,
    remoteUpgrade,
    remoteCleanup,
    cleanup: file.cleanup
      ? {
          schedule: file.cleanup.schedule,
          floorBytes: file.cleanup.floor_gib === undefined ? undefined : Math.round(file.cleanup.floor_gib * 2 ** 30),
          floorMinIntervalMs: durationMs(file.cleanup.floor_min_interval),
          stepTimeoutMs: file.cleanup.step_timeout_minutes * 60_000,
          slotWaitMs: file.cleanup.slot_wait_minutes * 60_000,
          logs: file.cleanup.logs === false ? null : { keepMs: file.cleanup.logs.keep_days * 86_400_000, keepBytes: Math.round(file.cleanup.logs.keep_mb * 2 ** 20) },
        }
      : undefined,
    upgrade: file.upgrade ? { repo: file.upgrade.repo, root: file.upgrade.root ?? DEFAULT_RELEASE_ROOT, line: file.upgrade.line } : undefined,
    releaseRoot: file.upgrade?.root ?? DEFAULT_RELEASE_ROOT,
    boardBackup: file.board_backup,
    projects,
  };
}

/** "30m", "6h", "1d" in milliseconds. */
const durationMs = (d: string) => Number(d.slice(0, -1)) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[d.slice(-1) as "m" | "h" | "d"];

/** The cleanup steps there are (BOB-123): nothing else may be listed. */
export const CLEANUP_STEP_NAMES = ["worktrees", "ignored", "paths", "docker", "playwright", "pnpm-store", "old-pnpm-stores", "runner"] as const;

/** What `ignored` clears unless it lists its own globs. */
export const DEFAULT_IGNORED = [".turbo", "dist", "test-results", ".wrangler"];

/** A path inside the repository: relative, without "..". */
const repoPath = (p: unknown) => typeof p === "string" && p.length > 0 && !isAbsolute(p) && !p.split("/").includes("..") && p !== ".";

/**
 * A project's `cleanup` list as its steps (BOB-123), refusing what isn't one of the fixed set, a step
 * listed twice, or a path outside the repository, each named. `line` is the worktrees step's default.
 */
export function parseCleanupSteps(project: string, raw: unknown[], line: string): CleanupStepConfig[] {
  const where = `${project}.cleanup`;
  const steps: CleanupStepConfig[] = [];
  const known = (name: string) => (CLEANUP_STEP_NAMES as readonly string[]).includes(name);
  for (const entry of raw) {
    let name: string;
    let value: unknown;
    if (typeof entry === "string") [name, value] = [entry, undefined];
    else if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 1) [name, value] = Object.entries(entry)[0]!;
    else throw new Error(`${where}: each step is a name or a one-key map, not ${JSON.stringify(entry)}`);
    if (!known(name)) throw new Error(`${where}: unknown step "${name}"; the steps are ${CLEANUP_STEP_NAMES.join(", ")}`);
    if (steps.some((s) => s.step === name)) throw new Error(`${where}: step "${name}" is listed twice`);
    const list = (what: string): string[] => {
      if (!Array.isArray(value) || value.length === 0) throw new Error(`${where}.${name}: must list ${what}`);
      for (const p of value) if (!repoPath(p)) throw new Error(`${where}.${name}: ${JSON.stringify(p)} must be a path inside the repository`);
      return value as string[];
    };
    switch (name) {
      case "worktrees": {
        const l = value === undefined ? line : (value as { line?: unknown } | null)?.line;
        if (typeof l !== "string" || !/^[\w.-]+\/[\w./-]+$/.test(l) || (value !== undefined && Object.keys(value as object).some((k) => k !== "line"))) {
          throw new Error(`${where}.worktrees: takes only line, a remote/branch such as origin/main`);
        }
        steps.push({ step: "worktrees", line: l });
        break;
      }
      case "ignored":
        steps.push({ step: "ignored", globs: value === undefined ? DEFAULT_IGNORED : list("globs") });
        break;
      case "paths":
        steps.push({ step: "paths", paths: list("paths") });
        break;
      case "docker": {
        const v = value === undefined ? {} : value;
        if (!v || typeof v !== "object" || Array.isArray(v) || Object.entries(v).some(([k, x]) => k !== "volumes" || typeof x !== "boolean")) throw new Error(`${where}.docker: takes only volumes: true or false`);
        steps.push({ step: "docker", volumes: (v as { volumes?: boolean }).volumes ?? false });
        break;
      }
      case "runner": {
        if (!Array.isArray(value) || value.length === 0) throw new Error(`${where}.runner: must list the actions-runner folders`);
        const dirs = value.map((d) => (typeof d === "string" ? expand(d) : ""));
        for (const d of dirs) if (!isAbsolute(d)) throw new Error(`${where}.runner: ${JSON.stringify(value[dirs.indexOf(d)])} must be an absolute path (or start with ~/)`);
        steps.push({ step: "runner", dirs });
        break;
      }
      default:
        if (value !== undefined) throw new Error(`${where}.${name}: takes no settings`);
        steps.push({ step: name as "playwright" | "pnpm-store" | "old-pnpm-stores" });
    }
  }
  return steps;
}

/**
 * Refuses a project's cleanup `paths` git doesn't ignore in its repository (BOB-123): a tracked or
 * unignored folder is never cleared, and there is no exception list; it goes in .gitignore.
 * `ignored` answers whether git ignores a path in a repository.
 */
export function checkCleanupPaths(config: Pick<SupervisorConfig, "projects">, ignored: (repo: string, path: string) => boolean): void {
  for (const p of config.projects.values()) {
    for (const s of p.cleanup) {
      if (s.step !== "paths") continue;
      for (const path of s.paths) {
        if (!ignored(p.path, path)) throw new Error(`${p.key}.cleanup.paths: ${path} isn't ignored by git in ${p.path}; add it to .gitignore to clear it`);
      }
    }
  }
}

/** Whether git ignores `path` in `repo`, as a file or a folder; one that is, or holds, a tracked file never is. */
export function gitIgnores(repo: string, path: string): boolean {
  try {
    if (execFileSync("git", ["-C", repo, "ls-files", "--", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) return false;
  } catch {
    return false;
  }
  for (const p of [path, `${path.replace(/\/+$/, "")}/`]) {
    try {
      execFileSync("git", ["-C", repo, "check-ignore", "-q", "--", p], { stdio: "ignore" });
      return true;
    } catch {
      // 1: not ignored; anything else (not a repository) is no better
    }
  }
  return false;
}

function pickMcp(where: string, names: string[], read: () => Record<string, unknown>): Record<string, unknown> {
  if (names.length === 0) return {};
  const all = read();
  const out: Record<string, unknown> = {};
  for (const n of names) {
    if (!(n in all)) throw new Error(`${where}.mcp: no server ${n} in the project's .mcp.json`);
    out[n] = all[n];
  }
  return out;
}

function readMcp(projectPath: string): Record<string, unknown> {
  try {
    const file = JSON.parse(readFileSync(join(projectPath, ".mcp.json"), "utf8")) as { mcpServers?: Record<string, unknown> };
    return file.mcpServers ?? {};
  } catch {
    return {};
  }
}

/**
 * Why the supervisor must not start, or null (BOB-74). Before rc.40 a supervisor.yaml without
 * `state_dir` kept the db and pid file under `<cwd>/~/.local/state/bobnet`, a literal "~"; rc.40 and
 * later read the real one, so that laptop would start over on another db. Nothing is moved: the
 * files are the laptop owner's to move.
 */
export function strandedState(text: string, stateDir: string, cwd = process.cwd()): string | null {
  const raw = parse(text) as unknown;
  if (raw && typeof raw === "object" && "state_dir" in raw) return null;
  const old = join(cwd, "~", ".local", "state", "bobnet");
  if (!existsSync(join(old, "supervisor.db"))) return null;
  return `supervisor.yaml sets no state_dir, and a supervisor db from before rc.40 is at ${join(old, "supervisor.db")}; this release would start on ${join(stateDir, "supervisor.db")} without its workers and outbox. Move the files in ${old} to ${stateDir}, or set state_dir: ${old}, then start again.`;
}

export function loadSupervisorConfig(dir = configDir()): SupervisorConfig {
  return parseSupervisorConfig(readFileSync(join(dir, "supervisor.yaml"), "utf8"));
}

/** "origin/release/v2" as its remote and its branch. */
const remoteBranch = (s: string) => ({ remote: s.split("/")[0]!, branch: s.slice(s.indexOf("/") + 1) });
