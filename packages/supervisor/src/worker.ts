import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { CanUseTool, HookCallback, McpServerConfig, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TokenCounts } from "@bobnet/protocol";
import { BILLING_ENV, type RoleConfig } from "./config.ts";

// One headless Claude Code session per worker, on the Agent SDK. Input is a
// stream, so the supervisor can hand a running worker a message mid-task; the
// worker ends when its turn produces a result and the input is closed.

/** The subset of the SDK's Query the supervisor drives. */
export interface QueryHandle extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
}
export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => QueryHandle;

/** Cumulative usage as the SDK reports it for this session (a resumed one includes its past). */
export interface Usage {
  tokens: TokenCounts;
  cost_usd: number;
}

export const ZERO_USAGE: Usage = { tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd: 0 };

export type Outcome =
  | { state: "done"; result: string }
  | { state: "failed"; error: string }
  | { state: "stopped"; reason: string };

const GRACE_MS = 10_000;
/** v0.1's server; workers use only the supervisor's in-process `bobnet` tools. */
const ALWAYS_DISALLOWED = ["mcp__bobnet-mcp"];
/**
 * A worker's built-in tools; its BobNet tools come from the supervisor's server.
 * Grep and Glob are named, or native builds drop them for Bash.
 */
export const WORKER_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];
/** The only key source that means the session runs on the Claude subscription's login (ADR 0094 §3). */
const SUBSCRIPTION_SOURCE = "none";

/** An async iterable the supervisor can keep pushing user messages into. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private ended = false;

  push(text: string): void {
    if (this.ended) return;
    this.items.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, priority: "next" });
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    for (;;) {
      const item = this.items.shift();
      if (item) {
        yield item;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

/** A preflight can wait out a land (up to its timeout), so its hook gets as long as a land can take. */
const PRE_TOOL_USE_TIMEOUT_S = 2 * 3600;

export interface WorkerRunOptions {
  id: string;
  role: RoleConfig;
  prompt: string;
  systemAppend: string;
  resumeSession: string | null;
  logPath: string;
  queryFn: QueryFn;
  canUseTool: CanUseTool;
  /**
   * In auto mode, runs before the classifier on every call: "deny" is final, "ask"
   * sends the call to canUseTool past the classifier, null leaves it to the classifier.
   */
  preToolUse?: (tool: string, input: Record<string, unknown>, server: string | undefined, signal: AbortSignal) => Promise<{ decision: "deny" | "ask"; reason: string } | null>;
  mcpServers: Record<string, McpServerConfig>;
  onEvent: (msg: SDKMessage) => void;
  /** A tool call has returned (or failed). */
  onToolResult?: (toolUseId: string) => void;
  onExit: (outcome: Outcome) => void;
}

export class WorkerRun {
  readonly id: string;
  sessionId: string | null = null;
  lastEventAt = Date.now();
  /** Tool calls started and not yet answered: a long build is not a stall. */
  toolsInFlight = 0;
  /**
   * Live token counts summed from each model response, until a result
   * reports the session's exact cumulative totals and cost.
   */
  usage: Usage = structuredClone(ZERO_USAGE);
  /** What each response has added so far: the SDK repeats a response's usage on every content block. */
  private readonly counted = new Map<string, TokenCounts>();

  private readonly opts: WorkerRunOptions;
  private readonly input = new InputQueue();
  private readonly abort = new AbortController();
  private query: QueryHandle | null = null;
  private log: WriteStream | null = null;
  private stopReason: string | null = null;
  private result: Outcome | null = null;
  private runtimeTimer: NodeJS.Timeout | null = null;

  constructor(opts: WorkerRunOptions) {
    this.opts = opts;
    this.id = opts.id;
  }

  start(): void {
    const { role } = this.opts;
    mkdirSync(dirname(this.opts.logPath), { recursive: true });
    this.log = createWriteStream(this.opts.logPath, { flags: "a", mode: 0o600 });
    // A lost log line must never take the supervisor down.
    this.log.on("error", () => {});

    const options: Options = {
      cwd: role.dir,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code", append: this.opts.systemAppend, snapshot: true },
      permissionMode: role.permissionMode,
      canUseTool: this.opts.canUseTool,
      ...(this.opts.preToolUse ? { hooks: { PreToolUse: [{ hooks: [this.preToolUseHook(this.opts.preToolUse)], timeout: PRE_TOOL_USE_TIMEOUT_S }] } } : {}),
      tools: role.tools ?? WORKER_TOOLS,
      // Only the role's own servers: nothing from ~/.claude.json or the worktree's .mcp.json.
      mcpServers: { ...(role.mcpServers as Record<string, McpServerConfig>), ...this.opts.mcpServers },
      strictMcpConfig: true,
      ...(role.memoryDir !== undefined
        ? { settings: role.memoryDir === false ? { autoMemoryEnabled: false } : { autoMemoryDirectory: role.memoryDir } }
        : {}),
      disallowedTools: [...ALWAYS_DISALLOWED, ...(role.disallowedTools ?? [])],
      env: { ...workerEnv(process.env), ...role.env, BOBNET_SUPERVISED: "1", BOBNET_WORKER_ID: this.id, ENABLE_TOOL_SEARCH: "false" },
      abortController: this.abort,
      stderr: (data) => this.write({ type: "stderr", data }),
      ...(role.model ? { model: role.model } : {}),
      ...(role.effort ? { effort: role.effort } : {}),
      ...(role.allowedTools ? { allowedTools: role.allowedTools } : {}),
      ...(this.opts.resumeSession ? { resume: this.opts.resumeSession } : {}),
      ...(role.sandbox
        ? {
            sandbox: {
              enabled: true,
              failIfUnavailable: true,
              allowUnsandboxedCommands: false,
              autoAllowBashIfSandboxed: false,
              filesystem: { allowWrite: [...role.writeRoots, ...gitWriteDirs(role.dir, role.writeRoots)] },
            },
          }
        : {}),
    };

    this.input.push(this.opts.prompt);
    this.query = this.opts.queryFn({ prompt: this.input, options });
    this.runtimeTimer = setTimeout(
      () => void this.stop(`max runtime of ${role.maxRuntimeMinutes} minutes reached`),
      role.maxRuntimeMinutes * 60_000,
    );
    this.runtimeTimer.unref();
    void this.consume();
  }

  private preToolUseHook(guard: NonNullable<WorkerRunOptions["preToolUse"]>): HookCallback {
    return async (input, _toolUseId, { signal }) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const server = input.mcp_server?.source === "sdk" ? input.mcp_server.name : undefined;
      const d = await guard(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, server, signal);
      return d ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d.decision, permissionDecisionReason: d.reason } } : {};
    };
  }

  /** Hands the running worker a message, as its next user turn. */
  inject(text: string): void {
    this.input.push(text);
  }

  /** Interrupts, then ends the session; kills it if it hasn't ended after a grace period. */
  async stop(reason: string): Promise<void> {
    if (this.stopReason || this.result) return;
    this.stopReason = reason;
    const kill = setTimeout(() => this.abort.abort(), GRACE_MS);
    kill.unref();
    try {
      await this.query?.interrupt();
    } catch {
      // Already finished or not interruptible; the abort covers it.
    }
    this.input.end();
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.query!) {
        this.lastEventAt = Date.now();
        this.write(msg);
        this.track(msg);
        this.opts.onEvent(msg);
        if (msg.type === "result") {
          this.result =
            msg.subtype === "success"
              ? { state: "done", result: msg.result }
              : { state: "failed", error: msg.subtype };
          this.input.end();
        }
      }
    } catch (err) {
      if (!this.result && !this.stopReason) this.result = { state: "failed", error: (err as Error).message };
    } finally {
      if (this.runtimeTimer) clearTimeout(this.runtimeTimer);
      this.query?.close();
      this.log?.end();
      const outcome: Outcome = this.stopReason
        ? { state: "stopped", reason: this.stopReason }
        : (this.result ?? { state: "failed", error: "session ended without a result" });
      this.opts.onExit(outcome);
    }
  }

  private track(msg: SDKMessage): void {
    if (msg.type === "system" && msg.subtype === "init") {
      this.sessionId = msg.session_id;
      // The billing guard: a worker never runs on an API key.
      const source = (msg as { apiKeySource?: string }).apiKeySource;
      if (source !== undefined && source !== SUBSCRIPTION_SOURCE) {
        void this.stop(`billing guard: the session would bill to an API key (apiKeySource ${source}), not the subscription`);
      }
    }
    if (msg.type === "assistant") {
      // Between results, count each response once on top of the last reported total.
      const u = msg.message.usage;
      const now: TokenCounts = {
        input: u.input_tokens,
        output: u.output_tokens,
        cache_read: u.cache_read_input_tokens ?? 0,
        cache_write: u.cache_creation_input_tokens ?? 0,
      };
      const id = msg.message.id as string | undefined;
      const before = (id && this.counted.get(id)) || ZERO_USAGE.tokens;
      for (const k of ["input", "output", "cache_read", "cache_write"] as const) this.usage.tokens[k] += now[k] - before[k];
      if (id) this.counted.set(id, now);
    }
    if (msg.type === "result") {
      // modelUsage covers every model call (subagents too) and is cumulative for the session.
      const models = Object.values(msg.modelUsage);
      const sum = (pick: (m: (typeof models)[number]) => number) => models.reduce((n, m) => n + pick(m), 0);
      this.usage = {
        tokens: {
          input: sum((m) => m.inputTokens),
          output: sum((m) => m.outputTokens),
          cache_read: sum((m) => m.cacheReadInputTokens),
          cache_write: sum((m) => m.cacheCreationInputTokens),
        },
        cost_usd: msg.total_cost_usd,
      };
    }
    const content = (msg.type === "assistant" || msg.type === "user") && Array.isArray(msg.message.content)
      ? (msg.message.content as Array<{ type: string }>)
      : [];
    for (const block of content) {
      if (block.type === "tool_use") this.toolsInFlight++;
      if (block.type === "tool_result") {
        this.toolsInFlight = Math.max(0, this.toolsInFlight - 1);
        const id = (block as { tool_use_id?: string }).tool_use_id;
        if (id) this.opts.onToolResult?.(id);
      }
    }
  }

  private write(event: unknown): void {
    this.log?.write(JSON.stringify({ ts: new Date().toISOString(), event }) + "\n");
  }
}

/**
 * What git commit needs outside a linked worktree: its own git dir and the
 * shared objects, refs, logs and packed-refs in the main checkout's .git. Not hooks or
 * config, which the sandbox write-protects anyway. Empty for a plain checkout
 * whose .git is already inside a write root.
 */
export function gitWriteDirs(
  dir: string,
  writeRoots: string[],
  gitDirs: (dir: string) => [string, string] | null = revParseGitDirs,
): string[] {
  const dirs = gitDirs(dir);
  if (!dirs) return [];
  const [gitDir, common] = dirs;
  const out = [gitDir, ...(gitDir === common ? [] : ["objects", "refs", "logs", "packed-refs", "packed-refs.lock"].map((d) => join(common, d)))];
  return out.filter((d) => !writeRoots.some((r) => inside(r, d)));
}

function revParseGitDirs(dir: string): [string, string] | null {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const [gitDir, common] = out.trim().split("\n");
    return gitDir && common ? [gitDir, common] : null;
  } catch {
    return null;
  }
}

const inside = (root: string, p: string) => {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** The supervisor's environment without anything that would move billing off the subscription. */
export function workerEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const blocked = new Set<string>(BILLING_ENV);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !blocked.has(k)) out[k] = v;
  return out;
}
