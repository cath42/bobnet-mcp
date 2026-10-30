import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import type { CanUseTool, McpServerConfig, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RoleConfig } from "./config.ts";

// One headless Claude Code session per worker, on the Agent SDK. Input is a
// stream, so the supervisor can hand a running worker a message mid-task; the
// worker ends when its turn produces a result and the input is closed.

/** The subset of the SDK's Query the supervisor drives. */
export interface QueryHandle extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
}
export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => QueryHandle;

export type Outcome =
  | { state: "done"; result: string }
  | { state: "failed"; error: string }
  | { state: "stopped"; reason: string };

const GRACE_MS = 10_000;
/** v0.1's server; workers use only the supervisor's in-process `bobnet` tools. */
const ALWAYS_DISALLOWED = ["mcp__bobnet-mcp"];

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

export interface WorkerRunOptions {
  id: string;
  role: RoleConfig;
  prompt: string;
  systemAppend: string;
  resumeSession: string | null;
  logPath: string;
  queryFn: QueryFn;
  canUseTool: CanUseTool;
  mcpServers: Record<string, McpServerConfig>;
  onEvent: (msg: SDKMessage) => void;
  onExit: (outcome: Outcome) => void;
}

export class WorkerRun {
  readonly id: string;
  sessionId: string | null = null;
  lastEventAt = Date.now();
  /** Tool calls started and not yet answered: a long build is not a stall. */
  toolsInFlight = 0;

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
      permissionMode: "default",
      canUseTool: this.opts.canUseTool,
      mcpServers: this.opts.mcpServers,
      disallowedTools: [...ALWAYS_DISALLOWED, ...(role.disallowedTools ?? [])],
      env: { ...stringEnv(process.env), ...role.env, BOBNET_SUPERVISED: "1", BOBNET_WORKER_ID: this.id },
      abortController: this.abort,
      stderr: (data) => this.write({ type: "stderr", data }),
      ...(role.model ? { model: role.model } : {}),
      // The supervisor's own BobNet tools need no approval.
      allowedTools: ["mcp__bobnet", ...(role.allowedTools ?? [])],
      ...(this.opts.resumeSession ? { resume: this.opts.resumeSession } : {}),
      ...(role.sandbox
        ? {
            sandbox: {
              enabled: true,
              failIfUnavailable: true,
              allowUnsandboxedCommands: false,
              autoAllowBashIfSandboxed: false,
              filesystem: { allowWrite: role.writeRoots },
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
    if (msg.type === "system" && msg.subtype === "init") this.sessionId = msg.session_id;
    const content = (msg.type === "assistant" || msg.type === "user") && Array.isArray(msg.message.content)
      ? (msg.message.content as Array<{ type: string }>)
      : [];
    for (const block of content) {
      if (block.type === "tool_use") this.toolsInFlight++;
      if (block.type === "tool_result") this.toolsInFlight = Math.max(0, this.toolsInFlight - 1);
    }
  }

  private write(event: unknown): void {
    this.log?.write(JSON.stringify({ ts: new Date().toISOString(), event }) + "\n");
  }
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}
