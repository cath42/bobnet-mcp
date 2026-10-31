import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// policy.yaml decides every permission request a worker raises that its own
// Claude Code settings don't already settle. Rules are tried in order and the
// first match wins; with no match the default applies, which is escalate to
// the orchestrator.
// Policy can never be weaker than the built-in guards below.
//
//   default: escalate            # escalate (to the orchestrator) | deny; never allow
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
  /** Regex on a Bash command; `{role}` stands for the worker's role key. */
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
/** Substitution or redirection (other than to /dev/null or between stdout and stderr): never allowed by a rule. */
const OPAQUE = /`|\$\(|<|>(?!&[12]|\s*\/dev\/null\b)/;
/** Redirections that write nothing: 2>&1, >&2, 2>/dev/null, &>/dev/null and the like. */
const HARMLESS_REDIRECT = /^(?:[12]?>&[12]|(?:[12&]?>>?)\s*\/dev\/null(?![\w/.-]))/;
/** Harmless redirections at a part's end, outside quotes (only stripped when the scan read the quotes). */
const TRAILING_HARMLESS = /(?:\s+(?:[12]?>&[12]|[12&]?>>?\s*\/dev\/null))+$/;
/** A heredoc's start: <<EOF, <<-'EOF', <<"EOF". Its body is skipped, not split. */
const HEREDOC = /^<<(-?)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w-]*))/;
/** Leading assignments that only set who a commit is by. */
const GIT_NAME_PREFIX = /^(?:GIT_[A-Z]+_NAME=(?:'[^']*'|"[^"$`\\]*"|[^\s'"$`\\;&|<>]*)\s+)+/;
/** Shell keywords that open a part whose command follows them. */
const KEYWORD_PREFIX = /^(?:(?:do|then|else|elif|if|while|until|!)\s+)+/;
/** Parts that are only shell syntax: a loop's header, or a block's end. */
const SYNTAX_ONLY = /^(?:done|fi|else|for\s+[A-Za-z_]\w*(?:\s+in(?:\s.*)?)?)$/s;
/** The fallback split for a command whose quotes don't balance: ignores quoting, so it only ever splits too much. */
const SEGMENTS = /&&|\|\||[;|\n]/;

export interface Scan {
  /** The commands chained by && || ; | & or a newline, outside quotes. */
  segments: string[];
  /** Substitution anywhere but single quotes or a quoted heredoc, or redirection (other than to /dev/null or 2>&1) outside quotes. */
  opaque: boolean;
}

/**
 * Reads a Bash command the way the shell splits it, so a quoted commit message
 * with newlines or <email> is one argument, not more commands, and a heredoc's
 * body is input, not commands. Returns null when the quotes don't balance or a
 * heredoc doesn't end; the caller then falls back to the conservative split.
 */
export function scanCommand(cmd: string): Scan | null {
  const segments: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  let opaque = false;
  const heredocs: Array<{ delim: string; tabs: boolean; expands: boolean }> = [];
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
    } else if ((c === ">" || (c === "&" && next === ">")) && HARMLESS_REDIRECT.test(cmd.slice(/[12]/.test(cmd[i - 1] ?? "") ? i - 1 : i))) {
      const start = /[12]/.test(cmd[i - 1] ?? "") ? i - 1 : i;
      const m = HARMLESS_REDIRECT.exec(cmd.slice(start))!;
      cur += m[0].slice(i - start);
      i = start + m[0].length - 1;
    } else if (c === "<" && next === "<" && cmd[i + 2] !== "<" && HEREDOC.test(cmd.slice(i))) {
      const m = HEREDOC.exec(cmd.slice(i))!;
      heredocs.push({ delim: m[2] ?? m[3] ?? m[4]!, tabs: m[1] === "-", expands: m[4] !== undefined });
      cur += m[0];
      i += m[0].length - 1;
    } else if (c === "\n" && heredocs.length > 0) {
      // Each body runs to its delimiter's own line. It is input, not commands;
      // only an unquoted delimiter lets the shell substitute inside it.
      let pos = i + 1;
      for (const h of heredocs) {
        for (;;) {
          if (pos >= cmd.length) return null;
          const eol = cmd.indexOf("\n", pos);
          const line = cmd.slice(pos, eol === -1 ? cmd.length : eol);
          pos = eol === -1 ? cmd.length : eol + 1;
          if ((h.tabs ? line.replace(/^\t+/, "") : line) === h.delim) break;
          if (h.expands && /`|\$\(/.test(line)) opaque = true;
        }
      }
      heredocs.length = 0;
      cut();
      i = pos - 1;
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
/** Deny beats escalate beats allow; between escalations, the human's beats the orchestrator's. */
const rank = (v: Verdict) => SEVERITY[v.decision] * 2 + (v.tier === "human" ? 1 : 0);

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

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A rule's command regex, built per role when it names `{role}`. */
function commandRegex(source: string): RegExp | ((role: string) => RegExp) {
  if (!source.includes("{role}")) return new RegExp(source);
  const cache = new Map<string, RegExp>();
  return (role) => cache.get(role) ?? cache.set(role, new RegExp(source.replaceAll("{role}", escapeRegex(role)))).get(role)!;
}

const forRole = (r: RegExp | ((role: string) => RegExp), role: string) => (typeof r === "function" ? r(role) : r);

const globMatch = (pattern: string, value: string) =>
  pattern === "*" ||
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value);

export class Policy {
  private readonly file: z.infer<typeof PolicyFile>;
  private readonly compiled: Array<{ rule: z.infer<typeof Rule>; command?: RegExp | ((role: string) => RegExp); path?: RegExp }>;

  constructor(text: string) {
    this.file = PolicyFile.parse(parse(text) ?? {});
    this.compiled = this.file.rules.map((rule) => ({
      rule,
      ...(rule.command ? { command: commandRegex(rule.command) } : {}),
      ...(rule.path ? { path: new RegExp(rule.path) } : {}),
    }));
  }

  static load(dir: string): Policy {
    return new Policy(readFileSync(join(dir, "policy.yaml"), "utf8"));
  }

  /**
   * A deny rule that matches anywhere in a Bash command wins over any allow,
   * whatever the order: quoted text and heredoc bodies aren't split off, but they can't hide either.
   */
  private denyAnywhere(tool: string, text: string, ctx: PolicyContext): Verdict | null {
    for (const { rule, command } of this.compiled) {
      if (rule.decision !== "deny" || !command || !forRole(command, ctx.role).test(text)) continue;
      if (!rule.roles.some((r) => globMatch(r, ctx.role)) || !rule.projects.some((p) => globMatch(p, ctx.project))) continue;
      if (!rule.tools.some((t) => globMatch(t, tool))) continue;
      return { decision: "deny", rule: rule.id, tier: rule.tier ?? "human", reason: rule.reason ?? `policy rule ${rule.id}`, slot: false };
    }
    return null;
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

    // A chained Bash command is decided part by part: allowed only if every
    // part is allowed alone; otherwise the worst part decides.
    const raw = tool === "Bash" && typeof input["command"] === "string" ? input["command"].trim() : null;
    const scan = raw === null ? null : scanCommand(raw);
    if (raw !== null) {
      const denied = this.denyAnywhere(tool, raw, ctx);
      if (denied) return denied;
    }
    if (raw !== null && (scan ? scan.segments.length > 1 : COMPOUND.test(raw.replace(/2>&1/g, "")))) {
      const segments = scan ? scan.segments : raw.split(SEGMENTS).map((s) => s.trim()).filter(Boolean);
      if (segments.length > 1) {
        const verdicts = segments.map((s) => this.evaluate(tool, { ...input, command: s }, ctx));
        const worst = verdicts.reduce((a, b) => (rank(b) > rank(a) ? b : a));
        const slot = verdicts.some((v) => v.slot);
        if (worst.decision !== "allow") return { ...worst, slot, reason: `${worst.reason} (in "${clip(segments[verdicts.indexOf(worst)]!)}")` };
        return { decision: "allow", rule: verdicts.map((v) => v.rule).join("+"), tier: "human", reason: "every segment allowed", slot };
      }
    }

    // One part: its shell keywords and GIT_*_NAME= prefixes say nothing about
    // what it runs, and a heredoc's body is input, not part of the command.
    // Nor do trailing redirections that write nothing, so `git branch -a 2>&1` meets a rule anchored at $.
    const part = raw === null ? null : (scan?.segments[0] ?? raw).replace(KEYWORD_PREFIX, "").replace(GIT_NAME_PREFIX, "").trim();
    const cmd = part !== null && scan ? part.replace(TRAILING_HARMLESS, "") : part;
    if (cmd !== null && scan && !scan.opaque && SYNTAX_ONLY.test(cmd)) {
      return { decision: "allow", rule: "builtin:syntax", tier: "human", reason: "shell syntax only", slot: false };
    }

    // Changing into the worker's own tree does nothing by itself; the rest of the chain decides.
    const cdTo = cmd === null ? null : /^cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)$/.exec(cmd);
    if (cdTo) {
      const target = resolve(ctx.cwd, cdTo[1]!.replace(/^["']|["']$/g, "").replace(/^~(?=\/|$)/, homedir()));
      if (ctx.writeRoots.some((r) => inside(r, target))) {
        return { decision: "allow", rule: "builtin:cd", tier: "human", reason: "cd inside the worker's write roots", slot: false };
      }
    }

    if (cmd !== null) {
      const denied = this.denyAnywhere(tool, cmd, ctx);
      if (denied) return denied;
    }

    for (const { rule, command, path } of this.compiled) {
      if (!rule.roles.some((r) => globMatch(r, ctx.role))) continue;
      if (!rule.projects.some((p) => globMatch(p, ctx.project))) continue;
      if (!rule.tools.some((t) => globMatch(t, tool))) continue;
      if (command) {
        if (cmd === null || raw === null) continue;
        // allow_compound rules see the command whole, as written.
        if (!forRole(command, ctx.role).test(rule.allow_compound ? raw : cmd)) continue;
        const chained = scan ? scan.segments.length > 1 : COMPOUND.test(raw.replace(/2>&1/g, ""));
        const opaque = scan ? scan.opaque : OPAQUE.test(raw);
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
      tier: "orchestrator",
      reason: "No policy rule matched",
      slot: false,
    };
  }
}
