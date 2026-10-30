import { ErrorCode, RpcError } from "../shared/errors.js";
import { nowIso } from "../shared/time.js";
import { PROTOCOL_VERSION } from "../shared/version.js";
import {
  Method,
  type DeregisterResult,
  type HelloParams,
  type HelloResult,
  type ListPeersResult,
  type PingParams,
  type PingResult,
  type RegisterParams,
  type RegisterResult,
  type UpdateStatusResult,
} from "../shared/protocol.js";
import type { Connection } from "./connection-manager.js";
import type { Registry } from "./registry.js";
import type { Router } from "./router.js";

export interface DaemonContext {
  registry: Registry;
  router: Router;
  daemonStartedAt: string;
}

export type Handler = (
  ctx: DaemonContext,
  conn: Connection,
  params: unknown,
) => Promise<unknown> | unknown;

export const handlers: Record<string, Handler> = {
  [Method.Hello]: handleHello,
  [Method.Register]: handleRegister,
  [Method.Deregister]: handleDeregister,
  [Method.ListPeers]: handleListPeers,
  [Method.SendMessage]: handleSendMessage,
  [Method.Broadcast]: handleBroadcast,
  [Method.UpdateStatus]: handleUpdateStatus,
  [Method.Ping]: handlePing,
};

function ensureObject(params: unknown, methodName: string): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new RpcError(
      ErrorCode.InvalidParams,
      `${methodName}: params must be an object`,
    );
  }
  return params as Record<string, unknown>;
}

function requireHandshaken(conn: Connection): void {
  if (conn.state !== "handshaken") {
    throw new RpcError(
      ErrorCode.NotHandshaken,
      `must call '${Method.Hello}' before any other method`,
    );
  }
}

function handleHello(
  _ctx: DaemonContext,
  conn: Connection,
  params: unknown,
): HelloResult {
  const p = ensureObject(params, Method.Hello) as Partial<HelloParams>;
  const version = p.protocol_version;
  if (typeof version !== "number") {
    throw new RpcError(
      ErrorCode.InvalidParams,
      `${Method.Hello}: protocol_version (number) required`,
    );
  }
  if (version !== PROTOCOL_VERSION) {
    throw new RpcError(
      ErrorCode.ProtocolVersionMismatch,
      `protocol version mismatch: client=${version}, daemon=${PROTOCOL_VERSION}`,
      { daemon_version: PROTOCOL_VERSION },
    );
  }
  conn.state = "handshaken";
  return {
    daemon_pid: process.pid,
    daemon_started_at: _ctx.daemonStartedAt,
    protocol_version: PROTOCOL_VERSION,
  };
}

function handleRegister(
  ctx: DaemonContext,
  conn: Connection,
  params: unknown,
): RegisterResult {
  requireHandshaken(conn);
  const p = ensureObject(params, Method.Register) as Partial<RegisterParams>;
  const peer = ctx.registry.register(conn.id, {
    name: p.name,
    team: p.team,
    cwd: p.cwd,
    purpose: p.purpose,
    expertise: p.expertise,
  });
  ctx.router.emitPeerJoined(peer);
  return {
    peer_id: peer.peer_id,
    name: peer.name,
    ...(peer.team !== undefined ? { team: peer.team } : {}),
    registered_at: peer.joined_at,
  };
}

function handleDeregister(
  ctx: DaemonContext,
  conn: Connection,
  _params: unknown,
): DeregisterResult {
  requireHandshaken(conn);
  const peer = ctx.registry.deregister(conn.id);
  if (peer) ctx.router.emitPeerLeft(peer, "deregistered");
  return { ok: true };
}

function handleListPeers(
  ctx: DaemonContext,
  conn: Connection,
  _params: unknown,
): ListPeersResult {
  requireHandshaken(conn);
  const self = ctx.registry.byConnection(conn.id);
  const peers = ctx.registry.list().filter((p) => p.connection_id !== conn.id);
  return {
    peers: peers.map((p) => ctx.registry.toPublicInfo(p)),
    ...(self ? {} : {}),
  };
}

function handleSendMessage(
  ctx: DaemonContext,
  conn: Connection,
  params: unknown,
) {
  requireHandshaken(conn);
  const p = ensureObject(params, Method.SendMessage);
  const to = p["to"];
  if (Array.isArray(to)) {
    return ctx.router.sendMulti(conn.id, {
      to,
      body: p["body"],
      in_reply_to: p["in_reply_to"],
    });
  }
  return ctx.router.send(conn.id, {
    to,
    body: p["body"],
    in_reply_to: p["in_reply_to"],
  });
}

function handleBroadcast(ctx: DaemonContext, conn: Connection, params: unknown) {
  requireHandshaken(conn);
  const p = ensureObject(params, Method.Broadcast);
  return ctx.router.broadcast(conn.id, {
    body: p["body"],
    scope: p["scope"],
    urgent: p["urgent"],
  });
}

function handleUpdateStatus(
  ctx: DaemonContext,
  conn: Connection,
  params: unknown,
): UpdateStatusResult {
  requireHandshaken(conn);
  const p = ensureObject(params, Method.UpdateStatus);
  const peer = ctx.registry.updateStatus(conn.id, p["status"]);
  ctx.router.emitStatusChanged(peer);
  return { ok: true };
}

function handlePing(
  _ctx: DaemonContext,
  conn: Connection,
  params: unknown,
): PingResult {
  // Ping is allowed pre-handshake — clients may use it for raw liveness checks.
  void conn;
  const p = ensureObject(params, Method.Ping) as Partial<PingParams>;
  if (typeof p.nonce !== "string") {
    throw new RpcError(ErrorCode.InvalidParams, "ping: nonce (string) required");
  }
  void nowIso(); // suppress unused-import warning if any; cheap
  return { nonce: p.nonce };
}
