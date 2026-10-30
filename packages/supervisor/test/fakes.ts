import type { Options, PermissionResult, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Identity } from "@bobnet/client/config";
import type { Logger } from "@bobnet/client/log";
import { parseSupervisorConfig, type SupervisorConfig } from "../src/config.ts";
import type { BrokerLink } from "../src/supervisor.ts";
import type { QueryFn, QueryHandle } from "../src/worker.ts";

export const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** A scripted stand-in for one SDK session. */
export class FakeSession implements QueryHandle {
  readonly options: Options;
  readonly inputs: string[] = [];
  private readonly queue: SDKMessage[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  interrupted = false;

  constructor(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) {
    this.options = params.options;
    void (async () => {
      for await (const m of params.prompt) {
        const c = m.message.content;
        this.inputs.push(typeof c === "string" ? c : JSON.stringify(c));
      }
    })();
    this.emit({ type: "system", subtype: "init", session_id: `sess-${Math.random().toString(36).slice(2, 8)}` } as unknown as SDKMessage);
  }

  emit(msg: SDKMessage): void {
    this.queue.push(msg);
    this.wake?.();
  }

  say(text: string): void {
    this.emit({ type: "assistant", message: { content: [{ type: "text", text }] } } as unknown as SDKMessage);
  }

  /** Asks permission the way the CLI would, through canUseTool. */
  ask(tool: string, input: Record<string, unknown>): Promise<PermissionResult | null> {
    return this.options.canUseTool!(tool, input, { signal: new AbortController().signal } as never);
  }

  finish(result = "all done"): void {
    this.emit({ type: "result", subtype: "success", result } as unknown as SDKMessage);
    this.end();
  }

  fail(subtype = "error_during_execution"): void {
    this.emit({ type: "result", subtype } as unknown as SDKMessage);
    this.end();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
    this.end();
  }

  close(): void {}

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

export function fakeQuery(): { queryFn: QueryFn; sessions: FakeSession[] } {
  const sessions: FakeSession[] = [];
  return {
    sessions,
    queryFn: (params) => {
      const s = new FakeSession(params);
      sessions.push(s);
      return s;
    },
  };
}

export class FakeBroker implements BrokerLink {
  readonly registered: Identity[] = [];
  readonly sent: Array<{ as: string; to: string[]; body: string }> = [];
  readonly acks: Array<{ as: string; ids: string[] }> = [];

  async register(identity: Identity): Promise<unknown> {
    this.registered.push(identity);
    return { address: `${identity.name}@mbp-1`, queued: 0 };
  }

  async request<R>(frame: { t: "send"; as: string; to: string[]; body: string } | { t: "peers" }): Promise<R> {
    if (frame.t === "peers") return { peers: [] } as R;
    this.sent.push({ as: frame.as, to: frame.to, body: frame.body });
    return { id: `m_${this.sent.length}`, delivered_to: frame.to, queued_for: [] } as R;
  }

  sendRaw(frame: { t: "ack"; as: string; ids: string[] }): void {
    this.acks.push({ as: frame.as, ids: frame.ids });
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
