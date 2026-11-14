import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { CanUseTool, HookCallback, McpServerConfig, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TokenCounts } from "@bobnet/protocol";
import { BILLING_ENV, configDir, type RoleConfig } from "./config.ts";

// One headless Claude Code session per worker, on the Agent SDK. Input is a
// stream, so the supervisor can hand a running worker a message mid-task; the
// worker ends when its turn produces a result with no background command of its
// still running (one that is wakes it for another turn when it ends). A
// long-lived worker (a lead) instead waits for its next message after a
// result, and ends only when stopped.

/** The subset of the SDK's Query the supervisor drives. */
export interface QueryHandle extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
  /**
   * Turns Remote Control on or off. Not in the SDK's types (0.3.312): it sends the CLI a
   * remote_control request and returns the bridge's answer, session_url among it. Pinned,
   * and checked for at run time.
   */
  enableRemoteControl?(enabled: boolean, name?: string): Promise<unknown>;
}

/** Remote Control as the worker got it: the session's URL, or why it has none. */
export type RemoteControl = { url: string } | { error: string };
export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => QueryHandle;

/** Cumulative usage as the SDK reports it for this session (a resumed one includes its past): tokens, never money. */
export interface Usage {
  tokens: TokenCounts;
}

export const ZERO_USAGE: Usage = { tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 } };

export type Outcome =
  | { state: "done"; result: string }
  | { state: "failed"; error: string }
  | { state: "stopped"; reason: string };

const GRACE_MS = 10_000;
/** How long a worker whose background work has finished waits for the turn that work wakes, before it ends. */
export const PARKED_WAKE_MS = 2 * 60_000;
/** How long a stopped worker's last turn, for its handoff, may take. */
const LAST_TURN_MS = 3 * 60_000;
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

  /** False once the input has closed: nothing will read it. */
  push(text: string, uuid?: string): boolean {
    if (this.ended) return false;
    this.items.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, priority: "next", ...(uuid ? { uuid: uuid as SDKUserMessage["uuid"] & string } : {}) });
    this.wake?.();
    return true;
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
   * In auto mode, runs before the classifier on every call: "allow" and "deny" are
   * final, "ask" sends the call to canUseTool past the classifier, null leaves it to the classifier.
   */
  preToolUse?: (
    tool: string,
    input: Record<string, unknown>,
    server: string | undefined,
    toolUseId: string | undefined,
    signal: AbortSignal,
  ) => Promise<{ decision: "allow" | "deny" | "ask"; reason: string } | null>;
  mcpServers: Record<string, McpServerConfig>;
  /** Turns Remote Control on at the session's start, under this name. */
  remoteControl?: string;
  onRemoteControl?: (rc: RemoteControl) => void;
  /** A result leaves it waiting for its next message; only a stop ends it. */
  longLived?: boolean;
  onEvent: (msg: SDKMessage) => void;
  /** A tool call has returned (or failed). */
  onToolResult?: (toolUseId: string) => void;
  /** A turn was interrupted to hand the worker a message: its tool calls won't return. */
  onInterrupted?: () => void;
  /** Inbox messages the brief carries: taken, with it, by the worker's first turn. */
  promptRefs?: string[];
  /** A turn has taken input that carried these inbox messages (the CLI stamps its reply with the input's uuid). */
  onInputTaken?: (refs: string[]) => void;
  onExit: (outcome: Outcome) => void;
}

export class WorkerRun {
  readonly id: string;
  sessionId: string | null = null;
  lastEventAt = Date.now();
  /** Tool calls started and not yet answered: a long build is not a stall. */
  toolsInFlight = 0;
  /** Background tasks still running (a build started with run_in_background), as the session last listed them. */
  backgroundTasks = 0;
  /**
   * Live token counts summed from each model response, until a result
   * reports the session's exact cumulative totals.
   */
  usage: Usage = structuredClone(ZERO_USAGE);
  /** What each response has added so far: the SDK repeats a response's usage on every content block. */
  private readonly counted = new Map<string, TokenCounts>();
  /** Context each model call carried (its input, cached or not), in call order. */
  readonly ctx: number[] = [];
  /** Remote Control once asked for: its URL, or why it has none. */
  remote: RemoteControl | null = null;
  /** A long-lived worker between turns: waiting for a message, not stuck. */
  idle = false;
  /** Resolves once the worker's exit is reported and recorded: a shutdown waits for it before closing the store. */
  readonly exited: Promise<void>;
  private markExited!: () => void;
  private lastCallId: string | null = null;

  private readonly opts: WorkerRunOptions;
  private readonly input = new InputQueue();
  /** Input handed to the session and not yet taken by a turn, by uuid: the inbox messages it carries. */
  private readonly untaken = new Map<string, string[]>();
  private readonly abort = new AbortController();
  private query: QueryHandle | null = null;
  private log: WriteStream | null = null;
  private stopReason: string | null = null;
  private result: Outcome | null = null;
  private runtimeTimer: NodeJS.Timeout | null = null;
  /** The message an interrupted turn hands over: the next turn, not the end. */
  private nextTurn: string | null = null;
  private ending = false;
  /** Whether the model has answered in this run: a turn before that is the last run's leftovers, not the brief's. */
  private modelTurn = false;
  /**
   * A worker whose turn ended with background work running: the outcome it ends with if that work
   * finishes and no turn follows. A background task's end normally wakes it for a turn of its own.
   */
  private parked: Outcome | null = null;
  private parkedTimer: NodeJS.Timeout | null = null;

  constructor(opts: WorkerRunOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.exited = new Promise((r) => (this.markExited = r));
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
              // Never the supervisor's own folder: its MCP token would let a worker answer its own requests.
              filesystem: { allowWrite: [...role.writeRoots, ...gitWriteDirs(role.dir, role.writeRoots)], denyRead: [configDir()] },
              ...(role.sandboxLocalhost ? { network: { allowLocalBinding: true } } : {}),
            },
          }
        : {}),
    };

    this.input.push(this.opts.prompt, this.stamp(this.opts.promptRefs ?? []));
    this.query = this.opts.queryFn({ prompt: this.input, options });
    if (role.maxRuntimeMinutes !== undefined) {
      this.runtimeTimer = setTimeout(() => void this.stop(`max runtime of ${role.maxRuntimeMinutes} minutes reached`), role.maxRuntimeMinutes * 60_000);
      this.runtimeTimer.unref();
    }
    void this.consume();
  }

  private preToolUseHook(guard: NonNullable<WorkerRunOptions["preToolUse"]>): HookCallback {
    return async (input, toolUseId, { signal }) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const server = input.mcp_server?.source === "sdk" ? input.mcp_server.name : undefined;
      const d = await guard(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, server, toolUseId ?? input.tool_use_id, signal);
      return d ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d.decision, permissionDecisionReason: d.reason } } : {};
    };
  }

  /**
   * Hands the running worker a message, as its next user turn; false if its input has closed.
   * `refs` are the inbox messages it carries, reported through onInputTaken once a turn takes it.
   */
  inject(text: string, refs: string[] = []): boolean {
    const uuid = this.stamp(refs);
    if (!this.input.push(text, uuid)) {
      if (uuid) this.untaken.delete(uuid);
      return false;
    }
    this.idle = false;
    return true;
  }

  /** Inbox messages handed to the session that no turn has taken yet. */
  untakenRefs(): string[] {
    return [...this.untaken.values()].flat();
  }

  /** A uuid for input carrying inbox messages, so the turn that takes it can be told; none for other input. */
  private stamp(refs: string[]): string | undefined {
    if (refs.length === 0) return undefined;
    const uuid = randomUUID();
    this.untaken.set(uuid, refs);
    return uuid;
  }

  /** The CLI stamps a turn's reply with the uuid of each input it takes (user_message_uuid), and echoes a replayed input with its own. */
  private taken(msg: SDKMessage): void {
    if (this.untaken.size === 0) return;
    const uuid = msg.type === "assistant" ? msg.user_message_uuid : msg.type === "user" && "isReplay" in msg && msg.isReplay ? msg.uuid : undefined;
    const refs = uuid ? this.untaken.get(uuid) : undefined;
    if (!refs) return;
    this.untaken.delete(uuid!);
    this.opts.onInputTaken?.(refs);
  }

  /**
   * Interrupts the turn in progress, a hung tool call with it, and hands the worker `text`
   * as its next turn: the session goes on.
   */
  async nudge(text: string): Promise<void> {
    if (this.stopReason || this.result) return;
    return this.interruptWith(text);
  }

  /**
   * Stops the worker. With `lastTurn`, it first gets one turn, cut short after a few
   * minutes, to write its handoff; without, the session ends now.
   */
  async stop(reason: string, lastTurn?: string): Promise<void> {
    if (this.result) return;
    // A stop with no last turn (a shutdown) ends one already in its last turn.
    if (this.stopReason) return lastTurn ? undefined : this.end();
    this.stopReason = reason;
    if (!lastTurn) return this.end();
    setTimeout(() => void this.end(), LAST_TURN_MS).unref();
    return this.interruptWith(lastTurn);
  }

  private async interruptWith(text: string): Promise<void> {
    // Between turns there is nothing to interrupt: the message is simply the next turn.
    if (this.idle) {
      this.inject(text);
      return;
    }
    this.nextTurn = text;
    try {
      await this.query?.interrupt();
    } catch {
      // Already finished; the result ends it.
    }
  }

  /** A turn has started after a parked result: that turn's result decides. */
  private unpark(): void {
    this.parked = null;
    if (this.parkedTimer) clearTimeout(this.parkedTimer);
    this.parkedTimer = null;
  }

  /** Background work is done; if no turn follows within a while, the worker ends with its parked result. */
  private endParkedSoon(): void {
    if (this.parkedTimer) return;
    this.parkedTimer = setTimeout(() => {
      if (!this.parked || !this.idle) return;
      this.result = this.parked;
      this.parked = null;
      this.input.end();
      this.query?.close();
    }, PARKED_WAKE_MS);
    this.parkedTimer.unref();
  }

  /** Interrupts, then ends the session; kills it if it hasn't ended after a grace period. */
  private async end(): Promise<void> {
    if (this.ending || this.result) return;
    this.ending = true;
    this.nextTurn = null;
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
        this.taken(msg);
        this.opts.onEvent(msg);
        if (msg.type === "system" && msg.subtype === "init" && this.opts.remoteControl && !this.remote) void this.startRemoteControl();
        if (msg.type === "assistant") {
          this.modelTurn = true;
          this.unpark();
        }
        if (msg.type === "system" && msg.subtype === "background_tasks_changed") {
          this.backgroundTasks = msg.tasks.filter((t) => !t.ambient).length;
          if (this.parked && this.backgroundTasks === 0) this.endParkedSoon();
        }
        // A resumed session can open with a turn for the last run's leftovers (a background command's
        // "stopped" notice) that never calls the model; the brief is still to come, so it isn't the end.
        if (msg.type === "result" && msg.num_turns === 0 && !this.modelTurn && !this.stopReason && this.nextTurn === null) {
          this.write({ type: "supervisor", note: "a turn with no model call before the brief's: not the end" });
          continue;
        }
        if (msg.type === "result" && this.opts.longLived && !this.stopReason && this.nextTurn === null) {
          // A lead's turn is over, not its work: it waits for its next message.
          this.idle = true;
          this.toolsInFlight = 0;
        } else if (msg.type === "result" && this.nextTurn !== null) {
          // The interrupted turn's end: its tool calls are over, and the worker gets the message.
          this.input.push(this.nextTurn);
          this.nextTurn = null;
          this.toolsInFlight = 0;
          this.opts.onInterrupted?.();
        } else if (msg.type === "result" && this.backgroundTasks > 0 && !this.stopReason) {
          // Its turn is over, not its work (Casper, 2026-11-12): a background command it started (a long
          // build) wakes it when it ends, and it ends at a result with nothing left running.
          this.parked = msg.subtype === "success" ? { state: "done", result: msg.result } : { state: "failed", error: msg.subtype };
          this.idle = true;
          this.toolsInFlight = 0;
        } else if (msg.type === "result") {
          this.unpark();
          this.result =
            msg.subtype === "success"
              ? { state: "done", result: msg.result }
              : { state: "failed", error: msg.subtype };
          this.input.end();
          // Its work is over: a background command it left running would hold the session open,
          // and the worker with it, past its result.
          this.query?.close();
        }
      }
    } catch (err) {
      if (!this.result && !this.stopReason) this.result = { state: "failed", error: (err as Error).message };
    } finally {
      if (this.runtimeTimer) clearTimeout(this.runtimeTimer);
      this.query?.close();
      // The exit is reported once the log is on disk, so a summary read at "done" sees the result.
      // close follows a finished flush or a failed one, so a broken log can't hold the exit.
      const log = this.log;
      if (log && !log.closed) await new Promise<void>((r) => log.once("close", () => r()).end());
      const outcome: Outcome = this.stopReason
        ? { state: "stopped", reason: this.stopReason }
        : (this.result ?? { state: "failed", error: "session ended without a result" });
      try {
        this.opts.onExit(outcome);
      } finally {
        this.markExited();
      }
    }
  }

  /**
   * Once per session (the SDK sends an init every turn). A failure is reported, not fatal:
   * the worker goes on unwatched.
   */
  private async startRemoteControl(): Promise<void> {
    const q = this.query!;
    if (typeof q.enableRemoteControl !== "function") {
      this.remote = { error: "this Agent SDK has no enableRemoteControl (it was in 0.3.312, undocumented); the worker runs without Remote Control" };
    } else {
      this.remote = { error: "connecting" };
      try {
        const r = (await q.enableRemoteControl(true, this.opts.remoteControl)) as { session_url?: unknown } | undefined;
        this.remote = typeof r?.session_url === "string" ? { url: r.session_url } : { error: `Remote Control answered without a session_url: ${JSON.stringify(r)?.slice(0, 200)}` };
      } catch (err) {
        this.remote = { error: `Remote Control failed: ${(err as Error).message}` };
      }
    }
    this.write({ type: "remote_control", ...this.remote });
    this.opts.onRemoteControl?.(this.remote);
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
      // One call per response: its later content blocks repeat the same usage. A subagent's calls
      // carry its own context, not the worker's, so they're left out.
      if (!(msg as { parent_tool_use_id?: string | null }).parent_tool_use_id) {
        const context = now.input + now.cache_read + now.cache_write;
        if (id && id === this.lastCallId) this.ctx[this.ctx.length - 1] = context;
        else this.ctx.push(context);
        this.lastCallId = id ?? null;
      }
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

/** The laptop's broker credentials, in the supervisor's environment where there's no Keychain (Linux): never a worker's. */
const BROKER_CREDENTIALS = ["BOBNET_ACCESS_CLIENT_ID", "BOBNET_ACCESS_CLIENT_SECRET"];

/** The supervisor's environment without anything that would move billing off the subscription, or the laptop's broker credentials. */
export function workerEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const blocked = new Set<string>([...BILLING_ENV, ...BROKER_CREDENTIALS]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !blocked.has(k)) out[k] = v;
  return out;
}
