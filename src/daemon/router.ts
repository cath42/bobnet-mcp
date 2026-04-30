import { newMessageId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { ErrorCode, RpcError } from "../shared/errors.js";
import {
  BODY_MAX_LEN,
  Method,
  type BroadcastEvent,
  type BroadcastResult,
  type ChannelEvent,
  type MessageEvent,
  type PeerJoinedEvent,
  type PeerLeftEvent,
  type PeerLeftReason,
  type SendMessageResult,
  type StatusChangedEvent,
} from "../shared/protocol.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { RegisteredPeer, Registry } from "./registry.js";

export class Router {
  constructor(
    private readonly registry: Registry,
    private readonly conns: ConnectionManager,
  ) {}

  send(
    fromConnId: string,
    args: { to: unknown; body: unknown; in_reply_to?: unknown },
  ): SendMessageResult {
    const sender = this.registry.byConnection(fromConnId);
    if (!sender) {
      throw new RpcError(ErrorCode.NotRegistered, "you must register first");
    }

    const body = validateBody(args.body);
    const to = validateRecipientName(args.to);
    const inReplyTo =
      args.in_reply_to === undefined ? undefined : validateMessageId(args.in_reply_to);

    const messageId = newMessageId();
    const recipient = this.registry.byName(to);
    if (!recipient) {
      return {
        delivered: false,
        message_id: messageId,
        error: `no peer named '${to}' is connected`,
      };
    }

    if (recipient.connection_id === fromConnId) {
      return {
        delivered: false,
        message_id: messageId,
        error: `cannot send a message to yourself`,
      };
    }

    const evt: MessageEvent = {
      event_type: "message",
      from: sender.name,
      message_id: messageId,
      body,
      ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {}),
      sent_at: nowIso(),
    };
    this.deliver(recipient.connection_id, evt);
    return { delivered: true, message_id: messageId };
  }

  broadcast(fromConnId: string, args: { body: unknown }): BroadcastResult {
    const sender = this.registry.byConnection(fromConnId);
    if (!sender) {
      throw new RpcError(ErrorCode.NotRegistered, "you must register first");
    }
    const body = validateBody(args.body);
    const messageId = newMessageId();
    const recipients: string[] = [];

    for (const peer of this.registry.list()) {
      if (peer.connection_id === fromConnId) continue;
      const evt: BroadcastEvent = {
        event_type: "broadcast",
        from: sender.name,
        message_id: messageId,
        body,
        sent_at: nowIso(),
      };
      this.deliver(peer.connection_id, evt);
      recipients.push(peer.name);
    }
    return { recipients, message_id: messageId };
  }

  emitPeerJoined(peer: RegisteredPeer): void {
    const evt: PeerJoinedEvent = {
      event_type: "peer_joined",
      peer: this.registry.toPublicInfo(peer),
    };
    this.fanout(evt, peer.connection_id);
  }

  emitPeerLeft(peer: RegisteredPeer, reason: PeerLeftReason): void {
    const evt: PeerLeftEvent = {
      event_type: "peer_left",
      name: peer.name,
      peer_id: peer.peer_id,
      reason,
      left_at: nowIso(),
    };
    this.fanout(evt, peer.connection_id);
  }

  emitStatusChanged(peer: RegisteredPeer): void {
    const evt: StatusChangedEvent = {
      event_type: "status_changed",
      name: peer.name,
      peer_id: peer.peer_id,
      status: peer.status ?? "",
      changed_at: nowIso(),
    };
    this.fanout(evt, peer.connection_id);
  }

  private fanout(evt: ChannelEvent, exceptConnId: string): void {
    for (const peer of this.registry.list()) {
      if (peer.connection_id === exceptConnId) continue;
      this.deliver(peer.connection_id, evt);
    }
  }

  private deliver(connId: string, evt: ChannelEvent): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    conn.notify(Method.ChannelEvent, evt);
  }
}

function validateBody(body: unknown): string {
  if (typeof body !== "string") {
    throw new RpcError(ErrorCode.InvalidParams, "body must be a string");
  }
  if (body.length === 0) {
    throw new RpcError(ErrorCode.InvalidParams, "body must not be empty");
  }
  if (body.length > BODY_MAX_LEN) {
    throw new RpcError(
      ErrorCode.InvalidParams,
      `body exceeds ${BODY_MAX_LEN} chars`,
    );
  }
  return body;
}

function validateRecipientName(to: unknown): string {
  if (typeof to !== "string" || to.length === 0) {
    throw new RpcError(ErrorCode.InvalidParams, "'to' must be a non-empty string");
  }
  return to;
}

function validateMessageId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new RpcError(
      ErrorCode.InvalidParams,
      "'in_reply_to' must be a non-empty string",
    );
  }
  return id;
}
