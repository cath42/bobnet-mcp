import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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
//     - id: package-tests
//       tools: [Bash]
//       command: "^pnpm (--filter \\S+ )?(test|vitest)( |$)"
//       decision: allow
//       slot: true           # runs only in one of the laptop's run slots

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
  /** A heavy run: once allowed, it waits for one of the laptop's run slots and holds it until it returns. */
  slot: z.boolean().default(false),
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
  /** The call must hold a run slot while it runs. */
  slot: boolean;
}

export interface PolicyContext {
  project: string;
  role: string;
  writeRoots: string[];
  cwd: string;
}

const FILE_WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const FILE_TOOLS = new Set([...FILE_WRITE_TOOLS, "Read", "Glob", "Grep"]);
/** Chaining: an allow rule on the first command can't vouch for what follows. */
const COMPOUND = /[;&|\n]/;
/** Substitution or redirection (other than 2>&1): never allowed by a rule. */
const OPAQUE = /`|\$\(|<|>(?!&1)|(?<!2)>&1/;
/** The fallback split for a command whose quotes don't balance: ignores quoting, so it only ever splits too much. */
const SEGMENTS = /&&|\|\||[;|\n]/;

export interface Scan {
  /** The commands chained by && || ; | & or a newline, outside quotes. */
  segments: string[];
  /** Substitution anywhere but single quotes, or redirection (other than 2>&1) outside quotes. */
  opaque: boolean;
}

/**
 * Reads a Bash command the way the shell splits it, so a quoted commit message
 * with newlines or <email> is one argument, not more commands. Returns null when
 * the quotes don't balance; the caller then falls back to the conservative split.
 */
export function scanCommand(cmd: string): Scan | null {
  const segments: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  let opaque = false;
  const cut = () => {
    if (cur.trim()) segments.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    const next = cmd[i + 1];
    if (quote === "'") {
      if (c === "'") quote = null;
      cur += c;
      continue;
    }
    if (c === "\\") {
      cur += c + (next ?? "");
      i++;
      continue;
    }
    if (c === "`" || (c === "$" && next === "(")) opaque = true;
    if (quote === '"') {
      if (c === '"') quote = null;
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === ">" && cmd[i - 1] === "2" && cmd.slice(i + 1, i + 3) === "&1") {
      cur += ">&1";
      i += 2;
    } else if (c === "<" || c === ">") {
      opaque = true;
      cur += c;
    } else if ((c === "&" || c === "|") && next === c) {
      cut();
      i++;
    } else if (c === "&" || c === "|" || c === ";" || c === "\n") {
      cut();
    } else {
      cur += c;
    }
  }
  if (quote !== null) return null;
  cut();
  return { segments, opaque };
}
const SEVERITY: Record<Decision, number> = { allow: 0, escalate: 1, deny: 2 };

export function filePath(tool: string, input: Record<string, unknown>): string | undefined {
  if (!FILE_TOOLS.has(tool)) return undefined;
  const p = input["file_path"] ?? input["notebook_path"] ?? input["path"];
  return typeof p === "string" ? p : undefined;
}

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);

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
      return { decision: "deny", rule: "builtin:no-verify", tier: "human", reason: "Hooks are never skipped", slot: false };
    }
    if (FILE_WRITE_TOOLS.has(tool) && absPath !== undefined && !ctx.writeRoots.some((r) => inside(r, absPath))) {
      return {
        decision: "deny",
        rule: "builtin:write-scope",
        tier: "human",
        reason: `Writes are limited to ${ctx.writeRoots.join(", ")}`,
        slot: false,
      };
    }

    // Changing into the worker's own tree does nothing by itself; the rest of the chain decides.
    const cdTo = tool === "Bash" && typeof input["command"] === "string" ? /^cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)$/.exec(input["command"].trim()) : null;
    if (cdTo) {
      const target = resolve(ctx.cwd, cdTo[1]!.replace(/^["']|["']$/g, "").replace(/^~(?=\/|$)/, homedir()));
      if (ctx.writeRoots.some((r) => inside(r, target))) {
        return { decision: "allow", rule: "builtin:cd", tier: "human", reason: "cd inside the worker's write roots", slot: false };
      }
    }

    // A chained Bash command is decided segment by segment: allowed only if
    // every segment is allowed alone, denied if any segment is denied.
    const cmd = tool === "Bash" && typeof input["command"] === "string" ? input["command"].trim() : null;
    const scan = cmd === null ? null : scanCommand(cmd);
    if (cmd !== null && (scan ? scan.segments.length > 1 : COMPOUND.test(cmd.replace(/2>&1/g, "")))) {
      const segments = scan ? scan.segments : cmd.split(SEGMENTS).map((s) => s.trim()).filter(Boolean);
      if (segments.length > 1) {
        const verdicts = segments.map((s) => this.evaluate(tool, { ...input, command: s }, ctx));
        const worst = verdicts.reduce((a, b) => (SEVERITY[b.decision] > SEVERITY[a.decision] ? b : a));
        const slot = verdicts.some((v) => v.slot);
        if (worst.decision !== "allow") return { ...worst, slot, reason: `${worst.reason} (in "${clip(segments[verdicts.indexOf(worst)]!)}")` };
        return { decision: "allow", rule: verdicts.map((v) => v.rule).join("+"), tier: "human", reason: "every segment allowed", slot };
      }
    }

    // A deny rule that matches anywhere in a Bash command wins over any allow,
    // whatever the order: quoted text isn't split off, but it can't hide either.
    if (cmd !== null) {
      for (const { rule, command } of this.compiled) {
        if (rule.decision !== "deny" || !command || !command.test(cmd)) continue;
        if (!rule.roles.some((r) => globMatch(r, ctx.role)) || !rule.projects.some((p) => globMatch(p, ctx.project))) continue;
        if (!rule.tools.some((t) => globMatch(t, tool))) continue;
        return { decision: "deny", rule: rule.id, tier: rule.tier ?? "human", reason: rule.reason ?? `policy rule ${rule.id}`, slot: false };
      }
    }

    for (const { rule, command, path } of this.compiled) {
      if (!rule.roles.some((r) => globMatch(r, ctx.role))) continue;
      if (!rule.projects.some((p) => globMatch(p, ctx.project))) continue;
      if (!rule.tools.some((t) => globMatch(t, tool))) continue;
      if (command) {
        const cmd = typeof input["command"] === "string" ? input["command"].trim() : null;
        if (cmd === null || !command.test(cmd)) continue;
        const scanned = scanCommand(cmd);
        const chained = scanned ? scanned.segments.length > 1 : COMPOUND.test(cmd.replace(/2>&1/g, ""));
        const opaque = scanned ? scanned.opaque : OPAQUE.test(cmd);
        if (rule.decision === "allow" && !rule.allow_compound && (chained || opaque)) continue;
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
        slot: rule.slot,
      };
    }
    return {
      decision: this.file.default,
      rule: "default",
      tier: "human",
      reason: "No policy rule matched",
      slot: false,
    };
  }
}
