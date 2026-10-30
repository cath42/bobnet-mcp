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

const Role = z.object({
  /** BobNet name; defaults to the role key with a capital first letter. */
  name: z.string().refine(isValidSegment, "must be a valid BobNet name").optional(),
  dir: path,
  model: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).default({}),
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
        env: r.env,
        maxRuntimeMinutes: r.max_runtime_minutes ?? file.max_runtime_minutes,
        writeRoots: r.write_roots ?? [resolveRoot(dir)],
        sandbox: r.sandbox,
        purpose: r.purpose,
      });
    }
    projects.set(pKey, { key: pKey, path: p.path, priority: p.priority, team: p.team, roles });
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
    projects,
  };
}

export function loadSupervisorConfig(dir = configDir()): SupervisorConfig {
  return parseSupervisorConfig(readFileSync(join(dir, "supervisor.yaml"), "utf8"));
}
