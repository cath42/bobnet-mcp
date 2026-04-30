import type { Socket } from "node:net";
import { newConnectionId } from "../shared/ids.js";
import { encode, FramingError, LineFramer } from "../shared/framing.js";
import { ErrorCode, RpcError } from "../shared/errors.js";
import {
  isNotification,
  isRequest,
  isSuccess,
  isFailure,
  JSONRPC_VERSION,
  type JsonRpcId,
} from "../shared/protocol.js";
import type { Logger } from "../shared/logger.js";

export type ConnectionState = "accepted" | "handshaken" | "closed";

export interface IncomingRequest {
  id: JsonRpcId;
  method: string;
  params: unknown;
}

export interface IncomingNotification {
  method: string;
  params: unknown;
}

export interface ConnectionListeners {
  onRequest(conn: Connection, req: IncomingRequest): Promise<void> | void;
  onNotification(conn: Connection, note: IncomingNotification): Promise<void> | void;
  onClose(conn: Connection): void;
}

export class Connection {
  public readonly id: string;
  public state: ConnectionState = "accepted";
  public lastActivity: number = Date.now();
  private framer = new LineFramer();
  private closed = false;
  private notifiedClose = false;

  constructor(
    public readonly socket: Socket,
    private readonly listeners: ConnectionListeners,
    private readonly log: Logger,
  ) {
    this.id = newConnectionId();
    this.socket.setNoDelay(true);
    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("close", () => this.onSocketClosed());
    this.socket.on("error", (err) => this.onError(err));
  }

  send(obj: unknown): void {
    if (this.closed) return;
    try {
      this.socket.write(encode(obj));
    } catch (err) {
      this.log.warn("write failed", {
        connection_id: this.id,
        err: (err as Error).message,
      });
      this.close("write_failed");
    }
  }

  reply(id: JsonRpcId, result: unknown): void {
    this.send({ jsonrpc: JSONRPC_VERSION, id, result });
  }

  replyError(
    id: JsonRpcId | null,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    this.send({
      jsonrpc: JSONRPC_VERSION,
      id,
      error: data === undefined ? { code, message } : { code, message, data },
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: JSONRPC_VERSION, method, params });
  }

  close(reason: string): void {
    if (this.closed) {
      this.notifyClosed();
      return;
    }
    this.closed = true;
    this.state = "closed";
    this.log.debug("closing connection", { connection_id: this.id, reason });
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
    this.socket.destroy();
    // Fire onClose synchronously — the kernel 'close' event may arrive
    // arbitrarily later (or, in pathological cases, not at all if the socket
    // is already detached). Without this, the connection would remain in the
    // ConnectionManager and Lifecycle.active would stay pinned, leaving
    // zombie entries that the heartbeat re-evicts on every tick.
    this.notifyClosed();
  }

  private onData(chunk: Buffer): void {
    this.lastActivity = Date.now();
    let frames: unknown[];
    try {
      frames = this.framer.feed(chunk);
    } catch (err) {
      if (err instanceof FramingError) {
        this.log.warn("framing error", {
          connection_id: this.id,
          err: err.message,
        });
        this.close("framing_error");
        return;
      }
      throw err;
    }

    for (const frame of frames) {
      this.dispatch(frame);
    }
  }

  private dispatch(frame: unknown): void {
    if (isRequest(frame)) {
      void this.listeners.onRequest(this, {
        id: frame.id,
        method: frame.method,
        params: frame.params,
      });
      return;
    }
    if (isNotification(frame)) {
      void this.listeners.onNotification(this, {
        method: frame.method,
        params: frame.params,
      });
      return;
    }
    if (isSuccess(frame) || isFailure(frame)) {
      // Daemon does not initiate calls in v0.1, so responses to it
      // are ignored. Heartbeat pings from daemon → client expect a
      // ping response; the heartbeat monitor handles it via lastActivity.
      return;
    }
    this.log.warn("unrecognized frame", {
      connection_id: this.id,
      preview: JSON.stringify(frame).slice(0, 200),
    });
    this.replyError(null, ErrorCode.InvalidRequest, "unrecognized JSON-RPC frame");
  }

  private onSocketClosed(): void {
    this.closed = true;
    this.state = "closed";
    this.notifyClosed();
  }

  private notifyClosed(): void {
    if (this.notifiedClose) return;
    this.notifiedClose = true;
    this.listeners.onClose(this);
  }

  private onError(err: Error): void {
    this.log.warn("socket error", {
      connection_id: this.id,
      err: err.message,
    });
  }
}

export class ConnectionManager {
  private byId = new Map<string, Connection>();

  constructor(private readonly log: Logger) {}

  accept(socket: Socket, listeners: ConnectionListeners): Connection {
    const conn = new Connection(socket, listeners, this.log);
    this.byId.set(conn.id, conn);
    this.log.info("connection accepted", { connection_id: conn.id });
    return conn;
  }

  remove(connectionId: string): void {
    this.byId.delete(connectionId);
  }

  get(connectionId: string): Connection | undefined {
    return this.byId.get(connectionId);
  }

  size(): number {
    return this.byId.size;
  }

  all(): Iterable<Connection> {
    return this.byId.values();
  }

  closeAll(reason: string): void {
    for (const c of this.byId.values()) c.close(reason);
    this.byId.clear();
  }
}

export function rpcErrorFromUnknown(err: unknown): RpcError {
  if (err instanceof RpcError) return err;
  if (err instanceof Error) {
    return new RpcError(ErrorCode.InternalError, err.message);
  }
  return new RpcError(ErrorCode.InternalError, "internal error");
}
