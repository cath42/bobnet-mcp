import { newMessageId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { ErrorCode, RpcError } from "../shared/errors.js";
import {
  BODY_MAX_LEN,
  MAX_RECIPIENTS,
  Method,
  type BroadcastEvent,
  type BroadcastResult,
  type BroadcastScope,
  type ChannelEvent,
  type MessageEvent,
  type MultiSendMessageResult,
  type MultiSendRecipientResult,
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
    const sender = this.requireSender(fromConnId);
    const body = validateBody(args.body);
    const to = validateRecipientName(args.to);
    const inReplyTo =
      args.in_reply_to === undefined ? undefined : validateMessageId(args.in_reply_to);

    const messageId = newMessageId();
    const outcome = this.sendOne(sender, to, body, messageId, inReplyTo, undefined);
    if (!outcome.delivered) {
      return { delivered: false, message_id: messageId, error: outcome.error };
    }
    const result: SendMessageResult = { delivered: true, message_id: messageId };
    if (outcome.crossTeam) {
      result.cross_team_warning =
        `'${to}' is not on your team — they likely lack context on your team's activities. Provide sufficient background in your message.`;
    }
    return result;
  }

  /**
   * One message to several named peers. Each recipient wakes once and sees
   * the others in `cc`, so they can coordinate without a broadcast.
   */
  sendMulti(
    fromConnId: string,
    args: { to: unknown[]; body: unknown; in_reply_to?: unknown },
  ): MultiSendMessageResult {
    const sender = this.requireSender(fromConnId);
    const body = validateBody(args.body);
    const names = validateRecipientList(args.to);
    const inReplyTo =
      args.in_reply_to === undefined ? undefined : validateMessageId(args.in_reply_to);

    const messageId = newMessageId();
    const results: MultiSendRecipientResult[] = [];
    const crossTeamNames: string[] = [];
    for (const to of names) {
      const cc = names.filter((n) => n !== to && n !== sender.name);
      const outcome = this.sendOne(sender, to, body, messageId, inReplyTo, cc);
      if (outcome.delivered) {
        results.push({ to, delivered: true });
        if (outcome.crossTeam) crossTeamNames.push(to);
      } else {
        results.push({ to, delivered: false, error: outcome.error });
      }
    }
    const result: MultiSendMessageResult = {
      message_id: messageId,
      delivered: results.every((r) => r.delivered),
      results,
    };
    if (crossTeamNames.length > 0) {
      const list = crossTeamNames.map((n) => `'${n}'`).join(", ");
      const verb = crossTeamNames.length === 1 ? "is" : "are";
      result.cross_team_warning =
        `${list} ${verb} not on your team — they likely lack context on your team's activities. Provide sufficient background in your message.`;
    }
    return result;
  }

  private sendOne(
    sender: RegisteredPeer,
    to: string,
    body: string,
    messageId: string,
    inReplyTo: string | undefined,
    cc: string[] | undefined,
  ): { delivered: true; crossTeam: boolean } | { delivered: false; error: string } {
    const recipient = this.registry.byName(to);
    if (!recipient) {
      return { delivered: false, error: `no peer named '${to}' is connected` };
    }
    if (recipient.connection_id === sender.connection_id) {
      return { delivered: false, error: `cannot send a message to yourself` };
    }

    const crossTeam = !this.registry.sameTeam(sender, recipient);
    const evt: MessageEvent = {
      event_type: "message",
      from: sender.name,
      message_id: messageId,
      body,
      ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {}),
      ...(crossTeam ? { cross_team: true } : {}),
      ...(cc !== undefined && cc.length > 0 ? { cc } : {}),
      sent_at: nowIso(),
    };
    this.deliver(recipient.connection_id, evt);
    return { delivered: true, crossTeam };
  }

  broadcast(
    fromConnId: string,
    args: { body: unknown; scope?: unknown; urgent?: unknown },
  ): BroadcastResult {
    const sender = this.requireSender(fromConnId);
    const body = validateBody(args.body);
    const scope = validateScope(args.scope);
    const urgent = validateUrgent(args.urgent);
    const messageId = newMessageId();
    const recipients: string[] = [];

    const targets =
      scope === "team" && sender.team
        ? this.registry.teamMembers(sender.team, fromConnId)
        : this.registry.list().filter((p) => p.connection_id !== fromConnId);

    for (const peer of targets) {
      const evt: BroadcastEvent = {
        event_type: "broadcast",
        from: sender.name,
        message_id: messageId,
        body,
        scope,
        ...(urgent ? { urgent: true } : {}),
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
    this.teamFanout(evt, peer);
  }

  emitPeerLeft(peer: RegisteredPeer, reason: PeerLeftReason): void {
    const evt: PeerLeftEvent = {
      event_type: "peer_left",
      name: peer.name,
      peer_id: peer.peer_id,
      reason,
      left_at: nowIso(),
    };
    this.teamFanout(evt, peer);
  }

  emitStatusChanged(peer: RegisteredPeer): void {
    const evt: StatusChangedEvent = {
      event_type: "status_changed",
      name: peer.name,
      peer_id: peer.peer_id,
      status: peer.status ?? "",
      changed_at: nowIso(),
    };
    this.teamFanout(evt, peer);
  }

  private teamFanout(evt: ChannelEvent, source: RegisteredPeer): void {
    const targets = source.team
      ? this.registry.teamMembers(source.team, source.connection_id)
      : this.registry.list().filter((p) => p.connection_id !== source.connection_id);
    for (const peer of targets) {
      this.deliver(peer.connection_id, evt);
    }
  }

  private requireSender(connId: string): RegisteredPeer {
    const sender = this.registry.byConnection(connId);
    if (!sender) {
      throw new RpcError(ErrorCode.NotRegistered, "you must register first");
    }
    return sender;
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
    throw new RpcError(
      ErrorCode.InvalidParams,
      "'to' must be a non-empty string or a list of them",
    );
  }
  return to;
}

function validateRecipientList(to: unknown[]): string[] {
  if (to.length === 0) {
    throw new RpcError(ErrorCode.InvalidParams, "'to' list must not be empty");
  }
  const names: string[] = [];
  for (const n of to) {
    const name = validateRecipientName(n);
    if (!names.includes(name)) names.push(name);
  }
  if (names.length > MAX_RECIPIENTS) {
    throw new RpcError(
      ErrorCode.InvalidParams,
      `'to' list exceeds ${MAX_RECIPIENTS} recipients — use broadcast instead`,
    );
  }
  return names;
}

function validateUrgent(urgent: unknown): boolean {
  if (urgent === undefined || urgent === false) return false;
  if (urgent === true) return true;
  throw new RpcError(ErrorCode.InvalidParams, "'urgent' must be a boolean");
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

function validateScope(scope: unknown): BroadcastScope {
  if (scope === undefined || scope === "team") return "team";
  if (scope === "all") return "all";
  throw new RpcError(
    ErrorCode.InvalidParams,
    `'scope' must be "team" or "all"`,
  );
}
