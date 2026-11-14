import type { Options, PermissionResult, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Identity } from "@bobnet/client/config";
import type { RequestFrame } from "@bobnet/client/connection";
import type { Logger } from "@bobnet/client/log";
import { parseSupervisorConfig, type SupervisorConfig } from "../src/config.ts";
import type { BrokerLink } from "../src/supervisor.ts";
import type { QueryFn, QueryHandle } from "../src/worker.ts";

export const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** A scripted stand-in for one SDK session. */
export class FakeSession implements QueryHandle {
  readonly options: Options;
  readonly inputs: string[] = [];
  /** Each input's uuid, as the supervisor stamped it. */
  readonly uuids: Array<string | undefined> = [];
  private readonly queue: SDKMessage[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  interrupted = false;
  /** A background command still running: the session outlives its closed input until closed. */
  background = false;
  /** Remote Control calls, as [enabled, name]. */
  readonly remoteCalls: Array<[boolean, string | undefined]> = [];
  /** As the SDK's undocumented method; deleted to play an SDK without it. */
  enableRemoteControl?: (enabled: boolean, name?: string) => Promise<unknown> = async (enabled, name) => {
    this.remoteCalls.push([enabled, name]);
    return { session_url: "https://claude.ai/code/session_test", bridge_session_id: "cse_test", bridge_epoch: 1 };
  };

  constructor(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) {
    this.options = params.options;
    void (async () => {
      for await (const m of params.prompt) {
        const c = m.message.content;
        this.inputs.push(typeof c === "string" ? c : JSON.stringify(c));
        this.uuids.push(m.uuid);
      }
      // As the SDK: with its input closed, the session ends, unless a background command holds it open.
      if (!this.background) this.end();
    })();
    this.emit({ type: "system", subtype: "init", session_id: `sess-${Math.random().toString(36).slice(2, 8)}` } as unknown as SDKMessage);
  }

  emit(msg: SDKMessage): void {
    this.queue.push(msg);
    this.wake?.();
  }

  say(text: string, usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }): void {
    this.emit({ type: "assistant", message: { content: [{ type: "text", text }], usage } } as unknown as SDKMessage);
  }

  /** A turn takes input i: as the CLI, its first reply carries that input's uuid. */
  take(i: number): void {
    this.emit({ type: "assistant", user_message_uuid: this.uuids[i], message: { content: [{ type: "text", text: "on it" }], usage: { input_tokens: 1, output_tokens: 1 } } } as unknown as SDKMessage);
  }

  /** Asks permission the way the CLI would, through canUseTool. */
  ask(tool: string, input: Record<string, unknown>): Promise<PermissionResult | null> {
    return this.options.canUseTool!(tool, input, { signal: new AbortController().signal } as never);
  }

  /** Asks for one specific tool call, as the CLI does with its tool use id. */
  askCall(toolUseID: string, tool: string, input: Record<string, unknown>): Promise<PermissionResult | null> {
    return this.options.canUseTool!(tool, input, { signal: new AbortController().signal, toolUseID } as never);
  }

  /** The tool call has returned. */
  toolResult(toolUseID: string): void {
    this.emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseID, content: "ok" }] } } as unknown as SDKMessage);
  }

  /** Cumulative session totals, as the SDK reports them on every result. */
  totals = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 };

  finish(result = "all done"): void {
    this.emit({ type: "result", subtype: "success", result, modelUsage: { "claude-sonnet-5-5": this.totals }, total_cost_usd: this.totals.costUSD } as unknown as SDKMessage);
    this.end();
  }

  /** A turn's result with the session left open, as the SDK does while its input is: a lead's next turn may follow. */
  turnDone(result = "turn done"): void {
    this.emit({ type: "result", subtype: "success", result, modelUsage: { "claude-sonnet-5-5": this.totals }, total_cost_usd: this.totals.costUSD } as unknown as SDKMessage);
  }

  /** The SDK sends an init at every turn. */
  init(): void {
    this.emit({ type: "system", subtype: "init", session_id: "sess-again" } as unknown as SDKMessage);
  }

  fail(subtype = "error_during_execution"): void {
    this.emit({ type: "result", subtype, modelUsage: {}, total_cost_usd: 0 } as unknown as SDKMessage);
    this.end();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  /** As the SDK: the turn ends with a result, and the session waits for its next input. */
  async interrupt(): Promise<void> {
    this.interrupted = true;
    if (!this.ended) this.emit({ type: "result", subtype: "error_during_execution", modelUsage: {}, total_cost_usd: 0 } as unknown as SDKMessage);
  }

  closed = false;
  /** As the SDK: closing ends the session, background commands and all. */
  close(): void {
    this.closed = true;
    this.end();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    for (;;) {
      const m = this.queue.shift();
      if (m) {
        yield m;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

export function fakeQuery(opts: { remoteControl?: boolean } = {}): { queryFn: QueryFn; sessions: FakeSession[] } {
  const sessions: FakeSession[] = [];
  return {
    sessions,
    queryFn: (params) => {
      const s = new FakeSession(params);
      if (opts.remoteControl === false) delete s.enableRemoteControl;
      sessions.push(s);
      return s;
    },
  };
}

export class FakeBroker implements BrokerLink {
  readonly registered: Identity[] = [];
  readonly sent: Array<{ as: string; to: string[]; body: string }> = [];
  readonly acks: Array<{ as: string; ids: string[] }> = [];
  readonly statuses: Array<{ as: string; status: string | null }> = [];
  /** Session updates posted, as "Name: text". */
  readonly updates: string[] = [];

  async register(identity: Identity): Promise<unknown> {
    this.registered.push(identity);
    return { address: `${identity.name}@mbp-1`, queued: 0 };
  }

  readonly reports: unknown[] = [];

  async request<R>(frame: RequestFrame): Promise<R> {
    if (frame.t === "peers") return { peers: [] } as R;
    if (frame.t === "report") {
      this.reports.push(frame.snapshot);
      return { laptop: "mbp-1" } as R;
    }
    if (frame.t === "status") this.statuses.push({ as: frame.as, status: frame.status });
    if (frame.t === "update") this.updates.push(`${frame.as}: ${frame.text}`);
    if (frame.t !== "send") return {} as R;
    this.sent.push({ as: frame.as, to: frame.to, body: frame.body });
    return { id: `m_${this.sent.length}`, delivered_to: frame.to, queued_for: [] } as R;
  }

  readonly results: Array<{ id: string; ok: boolean; message: string }> = [];

  sendRaw(frame: Parameters<BrokerLink["sendRaw"]>[0]): void {
    if (frame.t === "ack") this.acks.push({ as: frame.as, ids: frame.ids });
    else this.results.push({ id: frame.id, ok: frame.ok, message: frame.message });
  }

  toOrchestrator(): string[] {
    return this.sent.filter((s) => s.to.includes("Bob")).map((s) => s.body);
  }
}

export function testConfig(stateDir: string, over = ""): SupervisorConfig {
  return parseSupervisorConfig(
    `
orchestrator: Bob
concurrency: 2
state_dir: ${stateDir}
projects:
  helix:
    path: /work/helix
    priority: 1
    team: land
    hold_file: ${stateDir}/land-hold
    roles:
      bill: { dir: /work/helix-bill/architecture }
      marvin: { dir: /work/helix-marvin/qa }
      homer: { dir: /work/helix-homer/platform }
  games:
    path: /work/games
    priority: 5
    roles:
      mario: { dir: /work/games/mario, name: Mario }
${over}`,
    (dir) => dir.split("/").slice(0, 3).join("/"),
  );
}

export const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await tick(5);
  }
}
