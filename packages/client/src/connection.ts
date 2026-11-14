import { randomUUID } from "node:crypto";
import {
  type BoardCtx,
  type BoardOpInput,
  type BoardResults,
  type ClientFrame,
  type ClientInfo,
  type ErrorCode,
  PING,
  PONG,
  PROTOCOL_VERSION,
  type ServerFrame,
} from "@bobnet/protocol";
import ownPackage from "../package.json" with { type: "json" };
import type { Credentials, Identity } from "./config.ts";
import type { Logger } from "./log.ts";

const PING_EVERY_MS = 30_000;
const PONG_WITHIN_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const REREGISTER_EVERY_MS = 5_000;
/** How long a board operation waits for the broker before it fails (ADR 0001 §12). */
export const BOARD_WAIT_MS = 60_000;

export type RequestFrame = ClientFrame extends infer F ? (F extends { rid: string } ? Omit<F, "rid"> : never) : never;
export type PushFrame = Extract<ServerFrame, { t: "deliver" | "presence" | "action" }>;

export class BrokerError extends Error {
  readonly code: ErrorCode | "disconnected" | "timeout";

  constructor(code: BrokerError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

interface Pending {
  t: string;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ConnectionOptions {
  url: string;
  credentials: Credentials;
  log: Logger;
  onPush: (frame: PushFrame) => void;
  /** Called after every (re)connect once registrations are restored. */
  onReady?: (laptop: string) => void;
  /** The package hosting this connection, sent on register. Defaults to this one, @bobnet/client. */
  client?: Omit<ClientInfo, "protocol">;
  /** For tests: a WebSocket constructor that accepts headers. */
  WebSocketImpl?: new (url: string, init: { headers: Record<string, string> }) => WebSocket;
}

/**
 * One WebSocket to the broker, kept alive across drops. Requests made while
 * disconnected wait for the next connection (up to the request timeout), and
 * every peer registered over it is registered again on each reconnect, so the
 * broker flushes anything queued while it was away. A session hosts one peer;
 * the supervisor hosts one per worker.
 */
export class BrokerConnection {
  private ws: WebSocket | null = null;
  private ready = false;
  /** When the broker was last lost, or this connection started without it; null while connected. */
  private downSince: Date | null = new Date();
  private laptop: string | null = null;
  private seq = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly waitingForReady: Array<() => void> = [];
  private readonly registrations = new Map<string, Identity>();
  /** Sent with every registration, so the broker knows a reconnect from this process. */
  private readonly instance = randomUUID();
  private readonly client: ClientInfo;
  /** Registrations a reconnect couldn't restore yet; retried until they are. */
  private readonly unrestored = new Set<string>();
  private retryTimer: NodeJS.Timeout | null = null;
  private backoff = BACKOFF_MIN_MS;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly opts: ConnectionOptions;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
    this.client = { ...(opts.client ?? { package: ownPackage.name, version: ownPackage.version }), protocol: PROTOCOL_VERSION };
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.clearTimers();
    this.ws?.close(1000, "client stopping");
    this.failPending("disconnected", "Client stopped");
  }

  get currentLaptop(): string | null {
    return this.laptop;
  }

  /** Remembers the identity so reconnects restore it, then registers. */
  async register(identity: Identity): Promise<{ address: string; queued: number }> {
    const result = await this.request<{ address: string; queued: number }>({ t: "register", ...identity, instance: this.instance, client: this.client });
    this.registrations.set(identity.name.toLowerCase(), identity);
    this.unrestored.delete(identity.name.toLowerCase());
    return result;
  }

  /** Forgets the identity first, so a drop mid-request can't re-register it. */
  async deregister(name: string): Promise<{ address: string }> {
    this.registrations.delete(name.toLowerCase());
    this.unrestored.delete(name.toLowerCase());
    return this.request<{ address: string }>({ t: "deregister", as: name });
  }

  async request<R>(frame: RequestFrame): Promise<R> {
    await this.whenReady();
    return this.sendRequest<R>(frame);
  }

  /**
   * One board operation as a peer this connection hosts. It waits up to `waitMs` for the broker,
   * then fails saying since when the board has been unavailable, for the agent to retry.
   */
  async boardOp<K extends keyof BoardResults>(as: string, op: BoardOpInput & { op: K }, ctx?: BoardCtx, waitMs = BOARD_WAIT_MS): Promise<BoardResults[K]> {
    try {
      await this.whenReady(waitMs);
    } catch {
      throw new BrokerError("unavailable", `the board is unavailable since ${(this.downSince ?? new Date()).toISOString()}; wait and retry`);
    }
    return this.sendRequest<BoardResults[K]>({ t: "board_op", as, ...(ctx ? { ctx } : {}), op } as RequestFrame);
  }

  get connected(): boolean {
    return this.ready;
  }

  /** Fire-and-forget frames (acks). Dropped if disconnected; the broker redelivers. */
  sendRaw(frame: ClientFrame): void {
    if (this.ready) this.ws?.send(JSON.stringify(frame));
  }

  // ---------- Internals ----------

  private sendRequest<R>(frame: RequestFrame): Promise<R> {
    const rid = String(++this.seq);
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new BrokerError("timeout", `No reply to ${frame.t} within ${REQUEST_TIMEOUT_MS} ms`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(rid, { t: frame.t, resolve: resolve as (r: unknown) => void, reject, timer });
      this.ws!.send(JSON.stringify({ ...frame, rid }));
    });
  }

  private whenReady(timeoutMs = REQUEST_TIMEOUT_MS): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waitingForReady.indexOf(done);
        if (i !== -1) this.waitingForReady.splice(i, 1);
        reject(new BrokerError("disconnected", "Not connected to the BobNet broker; retrying in the background"));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waitingForReady.push(done);
    });
  }

  private connect(): void {
    if (this.stopped) return;
    const Impl = this.opts.WebSocketImpl ?? (WebSocket as unknown as NonNullable<ConnectionOptions["WebSocketImpl"]>);
    const ws = new Impl(this.opts.url, {
      headers: {
        "CF-Access-Client-Id": this.opts.credentials.clientId,
        "CF-Access-Client-Secret": this.opts.credentials.clientSecret,
      },
    });
    this.ws = ws;
    ws.addEventListener("message", (e) => this.onMessage(ws, String(e.data)));
    ws.addEventListener("close", (e) => this.onClose(ws, e.code, e.reason));
    ws.addEventListener("error", () => this.opts.log.warn("socket error", { url: this.opts.url }));
  }

  private onMessage(ws: WebSocket, data: string): void {
    if (ws !== this.ws) return;
    if (data === PONG) {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
      return;
    }
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      this.opts.log.warn("unparseable frame from broker");
      return;
    }
    switch (frame.t) {
      case "welcome":
        if (frame.identity.kind === "laptop") this.laptop = frame.identity.laptop;
        void this.onWelcome();
        return;
      case "ok":
      case "error": {
        const p = frame.rid === null ? undefined : this.pending.get(frame.rid);
        if (!p) {
          if (frame.t === "error") this.opts.log.warn("broker error", { code: frame.code, message: frame.message });
          return;
        }
        this.pending.delete(frame.rid!);
        clearTimeout(p.timer);
        if (frame.t === "ok") p.resolve(frame.result);
        else if (frame.code === "unsupported") p.reject(new BrokerError(frame.code, `the broker doesn't know ${p.t}; it is older than this client`));
        else p.reject(new BrokerError(frame.code, frame.message));
        return;
      }
      case "deliver":
      case "presence":
      case "action":
        this.opts.onPush(frame);
        return;
    }
  }

  private async onWelcome(): Promise<void> {
    this.backoff = BACKOFF_MIN_MS;
    this.startPings();
    for (const [key, identity] of this.registrations) {
      try {
        await this.sendRequest({ t: "register", ...identity, instance: this.instance, client: this.client });
        this.unrestored.delete(key);
      } catch (err) {
        this.unrestored.add(key);
        this.opts.log.error("re-register failed; retrying", { name: identity.name, err: (err as Error).message });
      }
    }
    if (this.unrestored.size > 0) this.scheduleRetry();
    this.ready = true;
    this.downSince = null;
    for (const w of this.waitingForReady.splice(0)) w();
    this.opts.log.info("connected", { laptop: this.laptop });
    this.opts.onReady?.(this.laptop ?? "");
  }

  private onClose(ws: WebSocket, code: number, reason: string): void {
    if (ws !== this.ws) return;
    this.ready = false;
    this.downSince ??= new Date();
    this.ws = null;
    this.clearTimers();
    this.failPending("disconnected", "Connection to the BobNet broker dropped");
    if (this.stopped) return;
    const delay = Math.min(this.backoff, BACKOFF_MAX_MS) * (0.5 + Math.random() / 2);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
    this.opts.log.warn("disconnected; reconnecting", { code, reason, in_ms: Math.round(delay) });
    setTimeout(() => this.connect(), delay).unref();
  }

  /** Keeps retrying registrations a reconnect couldn't restore: an agent must never silently drop off. */
  private scheduleRetry(): void {
    if (this.retryTimer || this.stopped) return;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (!this.ready) return; // the next welcome retries them
      for (const key of [...this.unrestored]) {
        const identity = this.registrations.get(key);
        if (!identity) {
          this.unrestored.delete(key);
          continue;
        }
        try {
          await this.sendRequest({ t: "register", ...identity, instance: this.instance, client: this.client });
          this.unrestored.delete(key);
          this.opts.log.info("re-registered", { name: identity.name });
        } catch {
          // Still held; try again.
        }
      }
      if (this.unrestored.size > 0) this.scheduleRetry();
    }, REREGISTER_EVERY_MS);
    this.retryTimer.unref();
  }

  private startPings(): void {
    this.clearTimers();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.pongTimer) return;
      this.ws.send(PING);
      this.pongTimer = setTimeout(() => {
        this.opts.log.warn("no pong; dropping connection");
        this.ws?.close(4000, "keepalive timeout");
      }, PONG_WITHIN_MS);
    }, PING_EVERY_MS);
    this.pingTimer.unref();
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = this.pongTimer = null;
  }

  private failPending(code: "disconnected", message: string): void {
    for (const [rid, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BrokerError(code, message));
      this.pending.delete(rid);
    }
  }
}
