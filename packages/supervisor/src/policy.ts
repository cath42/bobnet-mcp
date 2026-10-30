import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// policy.yaml decides every permission request a worker raises that its own
// Claude Code settings don't already settle. Rules are tried in order and the
// first match wins; with no match the default applies, which is escalate.
// Policy can never be weaker than the built-in guards below.
//
//   default: escalate            # escalate | deny; never allow
//   rules:
//     - id: read-only
//       tools: [Read, Glob, Grep]
//       decision: allow
//     - id: tests
//       tools: [Bash]
//       command: "^pnpm (test|typecheck|lint)( |$)"
//       decision: allow
//     - id: push
//       tools: [Bash]
//       command: "^git push"
//       decision: escalate
//       tier: human

export type Decision = "allow" | "deny" | "escalate";
export type Tier = "orchestrator" | "human";

const Rule = z.object({
  id: z.string().min(1),
  roles: z.array(z.string()).default(["*"]),
  projects: z.array(z.string()).default(["*"]),
  tools: z.array(z.string()).min(1),
  /** Regex on a Bash command. */
  command: z.string().optional(),
  /** Regex on a file tool's path, made relative to the role's write root when inside it. */
  path: z.string().optional(),
  /** Bash allow rules only match commands without shell chaining unless this is set. */
  allow_compound: z.boolean().default(false),
  decision: z.enum(["allow", "deny", "escalate"]),
  tier: z.enum(["orchestrator", "human"]).optional(),
  reason: z.string().optional(),
});

const PolicyFile = z.object({
  default: z.enum(["escalate", "deny"]).default("escalate"),
  rules: z.array(Rule).default([]),
});

export interface Verdict {
  decision: Decision;
  rule: string;
  tier: Tier;
  reason: string;
}

export interface PolicyContext {
  project: string;
  role: string;
  writeRoots: string[];
  cwd: string;
}

const FILE_WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const FILE_TOOLS = new Set([...FILE_WRITE_TOOLS, "Read", "Glob", "Grep"]);
/** Chaining, substitution or redirection: an allow rule can't vouch for what follows. */
const COMPOUND = /[;&|`\n<>]|\$\(/;

export function filePath(tool: string, input: Record<string, unknown>): string | undefined {
  if (!FILE_TOOLS.has(tool)) return undefined;
  const p = input["file_path"] ?? input["notebook_path"] ?? input["path"];
  return typeof p === "string" ? p : undefined;
}

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const globMatch = (pattern: string, value: string) =>
  pattern === "*" ||
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value);

export class Policy {
  private readonly file: z.infer<typeof PolicyFile>;
  private readonly compiled: Array<{ rule: z.infer<typeof Rule>; command?: RegExp; path?: RegExp }>;

  constructor(text: string) {
    this.file = PolicyFile.parse(parse(text) ?? {});
    this.compiled = this.file.rules.map((rule) => ({
      rule,
      ...(rule.command ? { command: new RegExp(rule.command) } : {}),
      ...(rule.path ? { path: new RegExp(rule.path) } : {}),
    }));
  }

  static load(dir: string): Policy {
    return new Policy(readFileSync(join(dir, "policy.yaml"), "utf8"));
  }

  evaluate(tool: string, input: Record<string, unknown>, ctx: PolicyContext): Verdict {
    const rawPath = filePath(tool, input);
    const absPath = rawPath === undefined ? undefined : resolve(ctx.cwd, rawPath);

    // Built-in guards, before any rule.
    if (tool === "Bash" && /\bgit\b[^\n]*--no-verify\b/.test(String(input["command"] ?? ""))) {
      return { decision: "deny", rule: "builtin:no-verify", tier: "human", reason: "Hooks are never skipped" };
    }
    if (FILE_WRITE_TOOLS.has(tool) && absPath !== undefined && !ctx.writeRoots.some((r) => inside(r, absPath))) {
      return {
        decision: "deny",
        rule: "builtin:write-scope",
        tier: "human",
        reason: `Writes are limited to ${ctx.writeRoots.join(", ")}`,
      };
    }

    for (const { rule, command, path } of this.compiled) {
      if (!rule.roles.some((r) => globMatch(r, ctx.role))) continue;
      if (!rule.projects.some((p) => globMatch(p, ctx.project))) continue;
      if (!rule.tools.some((t) => globMatch(t, tool))) continue;
      if (command) {
        const cmd = typeof input["command"] === "string" ? input["command"].trim() : null;
        if (cmd === null || !command.test(cmd)) continue;
        if (rule.decision === "allow" && !rule.allow_compound && COMPOUND.test(cmd)) continue;
      }
      if (path) {
        if (absPath === undefined) continue;
        const root = ctx.writeRoots.find((r) => inside(r, absPath));
        if (!path.test(root ? relative(root, absPath) : absPath)) continue;
      }
      return {
        decision: rule.decision,
        rule: rule.id,
        tier: rule.tier ?? "human",
        reason: rule.reason ?? `policy rule ${rule.id}`,
      };
    }
    return {
      decision: this.file.default,
      rule: "default",
      tier: "human",
      reason: "No policy rule matched",
    };
  }
}
