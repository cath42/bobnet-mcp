import { createConnection, type Socket } from "node:net";
import { newRequestId } from "../shared/ids.js";
import { encode, FramingError, LineFramer } from "../shared/framing.js";
import {
  isFailure,
  isNotification,
  isRequest,
  isSuccess,
  JSONRPC_VERSION,
  Method,
  type ChannelEvent,
  type JsonRpcId,
  type MethodMap,
} from "../shared/protocol.js";
import type { Logger } from "../shared/logger.js";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

export class DaemonLinkError extends Error {
  public readonly code: number | undefined;
  public readonly userMessage: string;
  public readonly data: unknown;

  constructor(message: string, opts: { code?: number; data?: unknown; userMessage?: string } = {}) {
    super(message);
    this.name = "DaemonLinkError";
    if (opts.code !== undefined) this.code = opts.code;
    this.userMessage = opts.userMessage ?? message;
    this.data = opts.data;
  }
}

export type ChannelEventListener = (evt: ChannelEvent) => void;
export type CloseListener = (err?: Error) => void;

export class DaemonLink {
  private socket: Socket | null = null;
  private framer = new LineFramer();
  private pending = new Map<JsonRpcId, PendingCall>();
  private closed = false;
  private channelListeners = new Set<ChannelEventListener>();
  private closeListeners = new Set<CloseListener>();

  constructor(
    private readonly socketPath: string,
    private readonly log: Logger,
  ) {}

  async connect(): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection(this.socketPath);
      const onError = (err: Error) => {
        sock.removeListener("connect", onConnect);
        reject(err);
      };
      const onConnect = () => {
        sock.removeListener("error", onError);
        this.attach(sock);
        resolve();
      };
      sock.once("error", onError);
      sock.once("connect", onConnect);
    });
  }

  isConnected(): boolean {
    return this.socket !== null && !this.closed;
  }

  async call<M extends keyof MethodMap>(
    method: M,
    params: MethodMap[M]["params"],
  ): Promise<MethodMap[M]["result"]> {
    return this.callRaw(method, params) as Promise<MethodMap[M]["result"]>;
  }

  async callRaw(method: string, params: unknown): Promise<unknown> {
    if (!this.socket || this.closed) {
      throw new DaemonLinkError("broker daemon disconnected", {
        userMessage: "broker daemon disconnected",
      });
    }
    const id = newRequestId();
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try {
        this.socket!.write(encode({ jsonrpc: JSONRPC_VERSION, id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        reject(
          new DaemonLinkError(`write failed: ${(err as Error).message}`, {
            userMessage: "broker daemon write failed",
          }),
        );
      }
    });
  }

  onChannelEvent(cb: ChannelEventListener): () => void {
    this.channelListeners.add(cb);
    return () => this.channelListeners.delete(cb);
  }

  onClose(cb: CloseListener): () => void {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.socket.destroy();
      this.socket = null;
    }
    for (const p of this.pending.values()) {
      p.reject(
        new DaemonLinkError("daemon connection closed", {
          userMessage: "broker daemon disconnected",
        }),
      );
    }
    this.pending.clear();
  }

  private attach(sock: Socket): void {
    this.socket = sock;
    sock.setNoDelay(true);
    sock.on("data", (chunk) => this.onData(chunk));
    sock.on("close", () => this.onSocketClosed());
    sock.on("error", (err) => this.log.warn("daemon socket error", { err: err.message }));
  }

  private onData(chunk: Buffer): void {
    let frames: unknown[];
    try {
      frames = this.framer.feed(chunk);
    } catch (err) {
      if (err instanceof FramingError) {
        this.log.error("framing error from daemon", { err: err.message });
        this.handleClose(err);
        return;
      }
      throw err;
    }
    for (const frame of frames) this.dispatch(frame);
  }

  private dispatch(frame: unknown): void {
    if (isSuccess(frame)) {
      const pending = this.pending.get(frame.id);
      if (!pending) {
        this.log.debug("response for unknown id", { id: String(frame.id) });
        return;
      }
      this.pending.delete(frame.id);
      pending.resolve(frame.result);
      return;
    }
    if (isFailure(frame)) {
      if (frame.id === null) {
        this.log.warn("daemon error without id", { code: frame.error.code });
        return;
      }
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      pending.reject(
        new DaemonLinkError(frame.error.message, {
          code: frame.error.code,
          data: frame.error.data,
          userMessage: frame.error.data?.user_message ?? frame.error.message,
        }),
      );
      return;
    }
    if (isNotification(frame)) {
      if (frame.method === Method.ChannelEvent) {
        const evt = frame.params as ChannelEvent | undefined;
        if (evt && typeof evt === "object") {
          for (const l of this.channelListeners) {
            try {
              l(evt);
            } catch (err) {
              this.log.warn("channel listener threw", {
                err: (err as Error).message,
              });
            }
          }
        }
        return;
      }
      // Daemon doesn't currently send other notifications.
      return;
    }
    if (isRequest(frame)) {
      // The daemon sends ping requests for heartbeat. Reply immediately.
      if (frame.method === Method.Ping) {
        const params = (frame.params ?? {}) as { nonce?: unknown };
        const nonce = typeof params.nonce === "string" ? params.nonce : "";
        try {
          this.socket?.write(
            encode({ jsonrpc: JSONRPC_VERSION, id: frame.id, result: { nonce } }),
          );
        } catch {
          /* ignore */
        }
        return;
      }
      // Unknown request from daemon → error reply.
      try {
        this.socket?.write(
          encode({
            jsonrpc: JSONRPC_VERSION,
            id: frame.id,
            error: { code: -32601, message: `method '${frame.method}' not supported` },
          }),
        );
      } catch {
        /* ignore */
      }
      return;
    }
    this.log.debug("ignoring unrecognized frame from daemon");
  }

  private onSocketClosed(): void {
    this.handleClose();
  }

  private handleClose(err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      p.reject(
        new DaemonLinkError("daemon connection closed", {
          userMessage: "broker daemon disconnected",
        }),
      );
    }
    this.pending.clear();
    for (const l of this.closeListeners) {
      try {
        l(err);
      } catch {
        /* ignore */
      }
    }
  }
}
