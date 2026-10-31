import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isValidSegment } from "@bobnet/protocol";
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

const Role = z.object({
  /** BobNet name; defaults to the role key with a capital first letter. */
  name: z.string().refine(isValidSegment, "must be a valid BobNet name").optional(),
  dir: path,
  model: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  /** Built-in tools the worker has, in place of WORKER_TOOLS. */
  tools: z.array(z.string()).optional(),
  /** Servers from the project's .mcp.json the worker gets; no other MCP server reaches it. */
  mcp: z.array(z.string()).default([]),
  /** Auto-memory folder (its MEMORY.md is the index the worker loads); false turns memory off. */
  memory_dir: z.union([path, z.literal(false)]).optional(),
  env: Env,
  max_runtime_minutes: z.number().positive().optional(),
  /** Where the worker may write; defaults to the git worktree that holds `dir`. */
  write_roots: z.array(path).optional(),
  /** Claude Code's OS sandbox for Bash; off only for roles that truly need it off. */
  sandbox: z.boolean().default(true),
  purpose: z.string().optional(),
});

const Project = z.object({
  path,
  /** Lower runs first when workers queue. */
  priority: z.number().int().default(10),
  team: z.string().refine(isValidSegment, "must be a valid BobNet team").optional(),
  /** This project's orchestrator, when it isn't the laptop's. */
  orchestrator: z.string().refine(isValidSegment, "must be a valid BobNet name").optional(),
  /** Environment for every role in the project; a role's own env wins. */
  env: Env,
  /** Every role's memory_dir, unless the role sets its own. */
  memory_dir: z.union([path, z.literal(false)]).optional(),
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
    })
    .optional(),
  /** A hold file (for helix, `pnpm integrate hold`'s): while it exists, no slot and no new worker. */
  hold_file: path.optional(),
  /** Roles any worker in the project may consult mid-task. */
  consult: z.array(z.string()).default([]),
  roles: z.record(z.string(), Role),
});

const SupervisorFile = z.object({
  /** BobNet name of the orchestrator session on this laptop. */
  orchestrator: z.string().refine(isValidSegment, "must be a valid BobNet name"),
  /** BobNet name the supervisor itself registers as. */
  name: z.string().refine(isValidSegment).default("supervisor"),
  team: z.string().refine(isValidSegment).optional(),
  concurrency: z.number().int().positive().default(3),
  stall_minutes: z.number().positive().default(15),
  request_timeout_minutes: z.number().positive().default(60),
  max_runtime_minutes: z.number().positive().default(180),
  state_dir: path.default("~/.local/state/bobnet"),
  mcp_port: z.number().int().min(1024).max(65535).default(7425),
  /** Heavy runs (tests, probes, landing) at once on this laptop (ADR 0094 §2: one). */
  run_slots: z.number().int().positive().default(1),
  /** How long a consulted role has to answer. */
  consult_timeout_minutes: z.number().positive().default(10),
  /** More paths every sandboxed worker may write, e.g. fnm's multishell folder. */
  sandbox_write: z.array(path).default([]),
  projects: z.record(z.string(), Project),
});

export interface RoleConfig {
  key: string;
  project: string;
  name: string;
  dir: string;
  team: string | undefined;
  model: string | undefined;
  allowedTools: string[] | undefined;
  disallowedTools: string[] | undefined;
  tools: string[] | undefined;
  /** Server name to config, read from the project's .mcp.json. */
  mcpServers: Record<string, unknown>;
  /** undefined: Claude Code's default folder. */
  memoryDir: string | false | undefined;
  env: Record<string, string>;
  maxRuntimeMinutes: number;
  writeRoots: string[];
  sandbox: boolean;
  purpose: string | undefined;
}

export interface ProjectConfig {
  key: string;
  path: string;
  priority: number;
  team: string | undefined;
  orchestrator: string;
  land: { command: string[]; timeoutMinutes: number; envCommand: string[] | undefined; requiresEnv: string[]; heldExit: number | undefined } | undefined;
  holdFile: string | undefined;
  consult: string[];
  roles: Map<string, RoleConfig>;
}

export interface SupervisorConfig {
  orchestrator: string;
  name: string;
  team: string | undefined;
  concurrency: number;
  stallMinutes: number;
  requestTimeoutMinutes: number;
  stateDir: string;
  mcpPort: number;
  runSlots: number;
  consultTimeoutMinutes: number;
  sandboxWrite: string[];
  projects: Map<string, ProjectConfig>;
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
    for (const [rKey, r] of Object.entries(p.roles)) {
      const name = r.name ?? capitalize(rKey);
      if (!isValidSegment(name)) throw new Error(`${pKey}.${rKey}: "${name}" is not a valid BobNet name`);
      const clash = names.get(name.toLowerCase());
      if (clash) throw new Error(`${pKey}.${rKey}: BobNet name ${name} is already used by ${clash}`);
      names.set(name.toLowerCase(), `${pKey}.${rKey}`);
      const dir = isAbsolute(r.dir) ? r.dir : resolve(p.path, r.dir);
      roles.set(rKey, {
        key: rKey,
        project: pKey,
        name,
        dir,
        team: p.team,
        model: r.model,
        allowedTools: r.allowed_tools,
        disallowedTools: r.disallowed_tools,
        tools: r.tools,
        mcpServers: pickMcp(`${pKey}.${rKey}`, r.mcp, () => readMcp(p.path)),
        memoryDir: r.memory_dir ?? p.memory_dir,
        env: { ...p.env, ...r.env },
        maxRuntimeMinutes: r.max_runtime_minutes ?? file.max_runtime_minutes,
        writeRoots: r.write_roots ?? [resolveRoot(dir)],
        sandbox: r.sandbox,
        purpose: r.purpose,
      });
    }
    for (const c of p.consult) if (!roles.has(c)) throw new Error(`${pKey}.consult: no role ${c}`);
    projects.set(pKey, {
      key: pKey,
      path: p.path,
      priority: p.priority,
      team: p.team,
      orchestrator: p.orchestrator ?? file.orchestrator,
      land: p.land
        ? { command: p.land.command, timeoutMinutes: p.land.timeout_minutes, envCommand: p.land.env_command, requiresEnv: p.land.requires_env, heldExit: p.land.held_exit }
        : undefined,
      holdFile: p.hold_file,
      consult: p.consult,
      roles,
    });
  }

  return {
    orchestrator: file.orchestrator,
    name: file.name,
    team: file.team,
    concurrency: file.concurrency,
    stallMinutes: file.stall_minutes,
    requestTimeoutMinutes: file.request_timeout_minutes,
    stateDir: file.state_dir,
    mcpPort: file.mcp_port,
    runSlots: file.run_slots,
    consultTimeoutMinutes: file.consult_timeout_minutes,
    sandboxWrite: file.sandbox_write,
    projects,
  };
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

export function loadSupervisorConfig(dir = configDir()): SupervisorConfig {
  return parseSupervisorConfig(readFileSync(join(dir, "supervisor.yaml"), "utf8"));
}
