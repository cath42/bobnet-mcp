import {
  addressKey,
  ClientFrame,
  type Envelope,
  type ErrorCode,
  findSecret,
  formatAddress,
  type Identity,
  LIMITS,
  type PeerInfo,
  parseRecipient,
  PROTOCOL_VERSION,
  type Results,
  type ServerFrame,
} from "@bobnet/protocol";
import { DurableObject } from "cloudflare:workers";
import { migrate } from "./schema.ts";

const SWEEP_INTERVAL_MS = 3600_000;
const PEER_RETENTION_MS = 30 * 24 * 3600_000;
const AUDIT_RETENTION_MS = 90 * 24 * 3600_000;

interface Conn {
  connId: string;
  identity: Identity;
}

interface PeerRow {
  key: string;
  name: string;
  laptop: string;
  team: string | null;
  purpose: string | null;
  expertise: string;
  status: string | null;
  conn_id: string | null;
  last_seen: string;
  [k: string]: SqlStorageValue;
}

class FrameError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();

/**
 * The BobNet broker: the roster, every stored message and its pending
 * deliveries, and the audit log, for the whole network. Sockets hibernate
 * between frames, so all state lives in SQLite or the socket attachment.
 */
export class Broker extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.storage.transactionSync(() => migrate(this.sql));
    void ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    });
  }

  // ---------- Connection lifecycle ----------

  override async fetch(req: Request): Promise<Response> {
    const identity = JSON.parse(req.headers.get("x-bobnet-identity") ?? "null") as Identity | null;
    if (!identity) return new Response("Missing identity", { status: 400 });

    const { 0: client, 1: server } = new WebSocketPair();
    const conn: Conn = { connId: crypto.randomUUID(), identity };
    this.ctx.acceptWebSocket(server, [conn.connId]);
    server.serializeAttachment(conn);
    this.send(server, { t: "welcome", v: PROTOCOL_VERSION, identity });
    this.audit(conn, "connect", {});
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const conn = ws.deserializeAttachment() as Conn;
    let rid: string | null = null;
    try {
      if (typeof data !== "string") throw new FrameError("bad_frame", "Frames must be JSON text");
      // Parsed before the size check so even an oversized request gets its
      // rid back; the runtime already caps a WebSocket message at 1 MiB.
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        throw new FrameError("bad_frame", "Frame is not valid JSON");
      }
      if (typeof raw === "object" && raw !== null && typeof (raw as { rid?: unknown }).rid === "string") {
        rid = (raw as { rid: string }).rid;
      }
      if (encoder.encode(data).byteLength > LIMITS.frameBytes) {
        throw new FrameError("frame_too_large", `Frames are limited to ${LIMITS.frameBytes} bytes`);
      }
      const parsed = ClientFrame.safeParse(raw);
      if (!parsed.success) throw new FrameError("bad_frame", parsed.error.issues[0]?.message ?? "Invalid frame");
      this.dispatch(ws, conn, parsed.data);
    } catch (err) {
      if (!(err instanceof FrameError)) throw err;
      this.send(ws, { t: "error", rid, code: err.code, message: err.message });
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.disconnect(ws.deserializeAttachment() as Conn);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.disconnect(ws.deserializeAttachment() as Conn);
  }

  private disconnect(conn: Conn): void {
    const now = new Date().toISOString();
    const left = this.sql
      .exec<PeerRow>("UPDATE peers SET conn_id = NULL, last_seen = ? WHERE conn_id = ? RETURNING *", now, conn.connId)
      .toArray();
    for (const peer of left) this.presence("left", peer);
    this.audit(conn, "disconnect", { peers: left.map((p) => p.key) });
  }

  // ---------- Frames ----------

  private dispatch(ws: WebSocket, conn: Conn, frame: ClientFrame): void {
    switch (frame.t) {
      case "register":
        return this.register(ws, conn, frame);
      case "deregister":
        return this.ok(ws, frame.rid, this.deregister(conn, frame.as));
      case "send":
        return this.ok(ws, frame.rid, this.sendMessage(conn, frame));
      case "broadcast":
        return this.ok(ws, frame.rid, this.broadcast(conn, frame));
      case "status":
        return this.ok(ws, frame.rid, this.setStatus(conn, frame.as, frame.status));
      case "peers":
        return this.ok(ws, frame.rid, { peers: this.listPeers() } satisfies Results["peers"]);
      case "ack":
        return this.ack(conn, frame.as, frame.ids);
    }
  }

  private register(
    ws: WebSocket,
    conn: Conn,
    frame: Extract<ClientFrame, { t: "register" }>,
  ): void {
    if (conn.identity.kind !== "laptop") throw new FrameError("forbidden", "Only laptops host peers");
    const laptop = conn.identity.laptop;
    const key = addressKey({ name: frame.name, laptop });
    const existing = this.peer(key);
    if (existing?.conn_id && existing.conn_id !== conn.connId && this.isLive(existing.conn_id)) {
      throw new FrameError("name_in_use", `${frame.name} is already online on ${laptop}`);
    }

    const peer = this.sql
      .exec<PeerRow>(
        `INSERT INTO peers (key, name, laptop, team, purpose, expertise, status, conn_id, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (key) DO UPDATE SET name = excluded.name, team = excluded.team, purpose = excluded.purpose,
           expertise = excluded.expertise, conn_id = excluded.conn_id, last_seen = excluded.last_seen
         RETURNING *`,
        key,
        frame.name,
        laptop,
        frame.team ?? null,
        frame.purpose ?? null,
        JSON.stringify(frame.expertise ?? []),
        conn.connId,
        new Date().toISOString(),
      )
      .one();

    const wasOnline = existing?.conn_id === conn.connId;
    if (!wasOnline) this.presence("joined", peer);
    this.audit(conn, "register", { peer: key, team: peer.team });

    const pending = this.pendingFor(key);
    // The ok goes first so the client knows the address before deliveries arrive.
    this.ok(ws, frame.rid, { address: formatAddress(peer), queued: pending.length } satisfies Results["register"]);
    for (const msg of pending) this.send(ws, { t: "deliver", to: formatAddress(peer), wake: wakes(msg), msg });
  }

  private deregister(conn: Conn, as: string): Results["deregister"] {
    const peer = this.hosted(conn, as);
    this.sql.exec("DELETE FROM deliveries WHERE to_key = ?", peer.key);
    this.sql.exec("DELETE FROM peers WHERE key = ?", peer.key);
    this.presence("left", peer);
    this.audit(conn, "deregister", { peer: peer.key });
    return { address: formatAddress(peer) };
  }

  private sendMessage(conn: Conn, frame: Extract<ClientFrame, { t: "send" }>): Results["send"] {
    const sender = this.hosted(conn, frame.as);
    this.rejectSecrets(frame.body);

    const recipients: PeerRow[] = [];
    const unknown: string[] = [];
    for (const raw of new Set(frame.to)) {
      const addr = parseRecipient(raw, sender.laptop);
      const peer = addr ? this.peer(addressKey(addr)) : undefined;
      if (peer) recipients.push(peer);
      else unknown.push(raw);
    }
    if (unknown.length > 0) throw new FrameError("unknown_peer", `No such peer: ${unknown.join(", ")}`);
    if (frame.in_reply_to !== undefined && !this.messageExists(frame.in_reply_to)) {
      throw new FrameError("unknown_message", `No message ${frame.in_reply_to}`);
    }

    const msg = this.store(sender, "message", recipients, {
      body: frame.body,
      urgent: frame.urgent ?? false,
      in_reply_to: frame.in_reply_to ?? null,
      ttlSeconds: frame.ttl_seconds ?? LIMITS.defaultMessageTtlSeconds,
    });
    const delivered = this.fanOut(msg, recipients);
    this.audit(conn, "send", { id: msg.id, from: sender.key, to: recipients.map((p) => p.key) });
    return {
      id: msg.id,
      delivered_to: delivered.map(formatAddress),
      queued_for: recipients.filter((p) => !delivered.includes(p)).map(formatAddress),
    };
  }

  private broadcast(conn: Conn, frame: Extract<ClientFrame, { t: "broadcast" }>): Results["broadcast"] {
    const sender = this.hosted(conn, frame.as);
    this.rejectSecrets(frame.body);
    if (frame.scope === "team" && sender.team === null) {
      throw new FrameError("no_team", "Register with a team to broadcast to it, or use scope \"all\"");
    }

    const recipients =
      frame.scope === "team"
        ? this.sql.exec<PeerRow>("SELECT * FROM peers WHERE team = ? AND key != ?", sender.team, sender.key).toArray()
        : this.sql.exec<PeerRow>("SELECT * FROM peers WHERE key != ?", sender.key).toArray();

    const msg = this.store(sender, "broadcast", recipients, {
      body: frame.body,
      urgent: frame.urgent ?? false,
      in_reply_to: null,
      ttlSeconds: frame.ttl_seconds ?? LIMITS.defaultBroadcastTtlSeconds,
    });
    this.fanOut(msg, recipients);
    this.audit(conn, "broadcast", { id: msg.id, from: sender.key, scope: frame.scope, recipients: recipients.length });
    return { id: msg.id, recipients: recipients.length };
  }

  private setStatus(conn: Conn, as: string, status: string | null): Results["status"] {
    const peer = this.hosted(conn, as);
    const updated = this.sql
      .exec<PeerRow>("UPDATE peers SET status = ? WHERE key = ? RETURNING *", status, peer.key)
      .one();
    this.presence("status", updated);
    return { address: formatAddress(updated) };
  }

  private ack(conn: Conn, as: string, ids: string[]): void {
    const peer = this.hosted(conn, as);
    for (const id of ids) this.sql.exec("DELETE FROM deliveries WHERE message_id = ? AND to_key = ?", id, peer.key);
  }

  // ---------- Messages ----------

  private store(
    sender: PeerRow,
    type: Envelope["type"],
    recipients: PeerRow[],
    opts: { body: string; urgent: boolean; in_reply_to: string | null; ttlSeconds: number },
  ): Envelope {
    const now = Date.now();
    const msg: Envelope = {
      id: `m_${crypto.randomUUID()}`,
      type,
      from: formatAddress(sender),
      to: recipients.map(formatAddress),
      team: sender.team,
      laptop: sender.laptop,
      in_reply_to: opts.in_reply_to,
      urgent: opts.urgent,
      body: opts.body,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + opts.ttlSeconds * 1000).toISOString(),
    };
    this.sql.exec(
      "INSERT INTO messages (id, envelope, created_at, expires_at) VALUES (?, ?, ?, ?)",
      msg.id,
      JSON.stringify(msg),
      msg.created_at,
      msg.expires_at,
    );
    for (const peer of recipients) {
      this.sql.exec("INSERT INTO deliveries (message_id, to_key) VALUES (?, ?)", msg.id, peer.key);
    }
    return msg;
  }

  /** Pushes to every recipient that is online now; returns those it reached. */
  private fanOut(msg: Envelope, recipients: PeerRow[]): PeerRow[] {
    const reached: PeerRow[] = [];
    for (const peer of recipients) {
      const ws = peer.conn_id ? this.socket(peer.conn_id) : undefined;
      if (ws && this.send(ws, { t: "deliver", to: formatAddress(peer), wake: wakes(msg), msg })) reached.push(peer);
    }
    return reached;
  }

  private pendingFor(key: string): Envelope[] {
    return this.sql
      .exec<{ envelope: string }>(
        `SELECT m.envelope FROM deliveries d JOIN messages m ON m.id = d.message_id
         WHERE d.to_key = ? AND m.expires_at > ? ORDER BY m.created_at, m.id`,
        key,
        new Date().toISOString(),
      )
      .toArray()
      .map((r) => JSON.parse(r.envelope) as Envelope);
  }

  private messageExists(id: string): boolean {
    return this.sql.exec("SELECT 1 FROM messages WHERE id = ?", id).toArray().length > 0;
  }

  private rejectSecrets(body: string): void {
    const found = findSecret(body);
    if (found) throw new FrameError("secret_detected", `Message looks like it contains a credential (${found}); send a path instead`);
  }

  // ---------- Roster ----------

  private peer(key: string): PeerRow | undefined {
    return this.sql.exec<PeerRow>("SELECT * FROM peers WHERE key = ?", key).toArray()[0];
  }

  /** The peer `as` names, which must be hosted by this connection. */
  private hosted(conn: Conn, as: string): PeerRow {
    if (conn.identity.kind !== "laptop") throw new FrameError("forbidden", "Only laptops host peers");
    const peer = this.peer(addressKey({ name: as, laptop: conn.identity.laptop }));
    if (!peer || peer.conn_id !== conn.connId) throw new FrameError("not_hosted", `${as} is not registered on this connection`);
    return peer;
  }

  private listPeers(): PeerInfo[] {
    return this.sql
      .exec<PeerRow>("SELECT * FROM peers ORDER BY laptop, name")
      .toArray()
      .map((p) => this.info(p));
  }

  private info(p: PeerRow): PeerInfo {
    return {
      address: formatAddress(p),
      name: p.name,
      laptop: p.laptop,
      team: p.team,
      purpose: p.purpose,
      expertise: JSON.parse(p.expertise) as string[],
      status: p.status,
      online: p.conn_id !== null && this.isLive(p.conn_id),
      last_seen: p.last_seen,
    };
  }

  /**
   * Tells every other connection about a peer's change. A connection hears it
   * if it hosts a peer on the same team or a peer with no team, and owner
   * connections hear everything.
   */
  private presence(event: "joined" | "left" | "status", subject: PeerRow): void {
    const frame: ServerFrame = { t: "presence", event, peer: this.info(subject) };
    const listeners = new Set<string>();
    for (const p of this.sql.exec<PeerRow>("SELECT * FROM peers WHERE conn_id IS NOT NULL AND key != ?", subject.key)) {
      if (p.team === null || p.team === subject.team) listeners.add(p.conn_id!);
    }
    for (const ws of this.ctx.getWebSockets()) {
      const conn = ws.deserializeAttachment() as Conn;
      if (conn.identity.kind === "owner" || listeners.has(conn.connId)) this.send(ws, frame);
    }
  }

  // ---------- Sockets ----------

  private socket(connId: string): WebSocket | undefined {
    return this.ctx.getWebSockets(connId)[0];
  }

  private isLive(connId: string): boolean {
    return this.socket(connId) !== undefined;
  }

  private send(ws: WebSocket, frame: ServerFrame): boolean {
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private ok(ws: WebSocket, rid: string, result: unknown): void {
    this.send(ws, { t: "ok", rid, result });
  }

  // ---------- Housekeeping ----------

  private audit(conn: Conn, action: string, detail: Record<string, unknown>): void {
    const actor = conn.identity.kind === "laptop" ? `laptop:${conn.identity.laptop}` : `owner:${conn.identity.email}`;
    this.sql.exec(
      "INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)",
      new Date().toISOString(),
      actor,
      action,
      JSON.stringify(detail),
    );
  }

  /** Drops expired messages, long-gone peers and old audit rows. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    const iso = new Date(now).toISOString();
    this.sql.exec("DELETE FROM deliveries WHERE message_id IN (SELECT id FROM messages WHERE expires_at <= ?)", iso);
    this.sql.exec("DELETE FROM messages WHERE expires_at <= ?", iso);
    const stale = new Date(now - PEER_RETENTION_MS).toISOString();
    this.sql.exec("DELETE FROM deliveries WHERE to_key IN (SELECT key FROM peers WHERE conn_id IS NULL AND last_seen <= ?)", stale);
    this.sql.exec("DELETE FROM peers WHERE conn_id IS NULL AND last_seen <= ?", stale);
    this.sql.exec("DELETE FROM audit WHERE ts <= ?", new Date(now - AUDIT_RETENTION_MS).toISOString());
    await this.ctx.storage.setAlarm(now + SWEEP_INTERVAL_MS);
  }
}

/** A directed message always wakes its reader; a broadcast only when urgent. */
function wakes(msg: Envelope): boolean {
  return msg.type === "message" || msg.urgent;
}
