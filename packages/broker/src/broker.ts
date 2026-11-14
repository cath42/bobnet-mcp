import {
  type Action,
  addressKey,
  BOARD_READS,
  type BoardCaller,
  type BoardReply,
  CLIENT_FRAME_TYPES,
  ClientFrame,
  type ClientInfo,
  type Dashboard,
  type LaptopSnapshot,
  type ProjectBoard,
  type PeerStats,
  type TrafficItem,
  type UpdateItem,
  type Envelope,
  type ErrorCode,
  findSecret,
  formatAddress,
  type Identity,
  LIMITS,
  type PeerInfo,
  parseRecipient,
  PING,
  PONG,
  PROTOCOL_VERSION,
  type Results,
  type ServerFrame,
} from "@bobnet/protocol";
import { DurableObject } from "cloudflare:workers";
import { migrate } from "./schema.ts";

const SWEEP_INTERVAL_MS = 3600_000;
/** Clients ping every 30 s; a socket silent for longer than this is presumed dead. */
const SILENT_AFTER_MS = 90_000;
const PEER_RETENTION_MS = 30 * 24 * 3600_000;
const AUDIT_RETENTION_MS = 90 * 24 * 3600_000;
const UPDATE_RETENTION_MS = 30 * 24 * 3600_000;
const DASHBOARD_ITEMS = 50;
/** Session updates are the owner's progress view: more of them than of traffic. */
const DASHBOARD_UPDATES = 200;
/** Every project's board is one `Board` object (ADR 0001 §1). */
const BOARD = "board";

interface Conn {
  connId: string;
  identity: Identity;
  connectedAt: number;
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
  instance: string | null;
  client: string | null;
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
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    });
  }

  // ---------- Connection lifecycle ----------

  override async fetch(req: Request): Promise<Response> {
    const identity = JSON.parse(req.headers.get("x-bobnet-identity") ?? "null") as Identity | null;
    if (!identity) return new Response("Missing identity", { status: 400 });

    const { 0: client, 1: server } = new WebSocketPair();
    const conn: Conn = { connId: crypto.randomUUID(), identity, connectedAt: Date.now() };
    this.ctx.acceptWebSocket(server, [conn.connId]);
    const ownerToken = req.headers.get("x-bobnet-owner-token");
    if (identity.kind === "owner" && ownerToken) {
      this.sql.exec("INSERT INTO owner_tokens (conn_id, token) VALUES (?, ?)", conn.connId, ownerToken);
    }
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
      // A supervisor's snapshot and boards may be larger than other frames.
      const t = (raw as { t?: unknown } | null)?.t;
      const limit = t === "board" || t === "report" ? LIMITS.boardFrameBytes : LIMITS.frameBytes;
      if (encoder.encode(data).byteLength > limit) {
        throw new FrameError("frame_too_large", `Frames are limited to ${limit} bytes`);
      }
      if (typeof t === "string" && !CLIENT_FRAME_TYPES.includes(t)) {
        throw new FrameError("unsupported", `This broker doesn't know the frame type ${JSON.stringify(t)}`);
      }
      const parsed = ClientFrame.safeParse(raw);
      if (!parsed.success) throw new FrameError("bad_frame", parsed.error.issues[0]?.message ?? "Invalid frame");
      if (parsed.data.t === "board_op") await this.boardOp(conn, parsed.data);
      else this.dispatch(ws, conn, parsed.data);
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
    this.sql.exec("DELETE FROM owner_tokens WHERE conn_id = ?", conn.connId);
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
      case "report":
        return this.ok(ws, frame.rid, this.report(conn, frame.as, frame.snapshot));
      case "board":
        return this.ok(ws, frame.rid, this.board(conn, frame.as, frame.board));
      case "update":
        return this.ok(ws, frame.rid, this.postUpdate(conn, frame.as, frame.text));
      case "dashboard":
        if (conn.identity.kind !== "owner") throw new FrameError("forbidden", "Only the owner reads the dashboard");
        return this.ok(ws, frame.rid, this.dashboard());
      case "action":
        return this.ok(ws, frame.rid, this.forwardAction(conn, frame.laptop, frame.action));
      case "action_result":
        return this.actionResult(conn, frame);
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
    const pinned = this.supervisorOf(laptop);
    const pinnedConn = pinned && pinned !== frame.name ? this.peer(addressKey({ name: pinned, laptop }))?.conn_id : null;
    if (frame.supervisor && pinnedConn && this.isLive(pinnedConn)) {
      throw new FrameError("forbidden", `${pinned} is the supervisor on ${laptop}`);
    }
    if (existing?.conn_id && existing.conn_id !== conn.connId && this.isLive(existing.conn_id)) {
      const holder = this.socket(existing.conn_id)!;
      const sameProcess = frame.instance !== undefined && existing.instance === frame.instance;
      if (!sameProcess && !this.isSilent(holder)) {
        throw new FrameError("name_in_use", `${frame.name} is already online on ${laptop}`);
      }
      // Either the same process reconnecting before the broker noticed its old
      // socket die, or a holder that stopped answering pings (a sleeping
      // laptop, a dropped network): close it so its names free up.
      this.audit(conn, "takeover", { peer: key, from: existing.conn_id });
      try {
        holder.close(4001, "silent; replaced by a new connection");
      } catch {
        // Already closing.
      }
      this.disconnect(holder.deserializeAttachment() as Conn);
    }

    const peer = this.sql
      .exec<PeerRow>(
        `INSERT INTO peers (key, name, laptop, team, purpose, expertise, status, conn_id, last_seen, instance, client)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET name = excluded.name, team = excluded.team, purpose = excluded.purpose,
           expertise = excluded.expertise, conn_id = excluded.conn_id, last_seen = excluded.last_seen,
           instance = excluded.instance, client = excluded.client
         RETURNING *`,
        key,
        frame.name,
        laptop,
        frame.team ?? null,
        frame.purpose ?? null,
        JSON.stringify(frame.expertise ?? []),
        conn.connId,
        new Date().toISOString(),
        frame.instance ?? null,
        frame.client ? JSON.stringify(frame.client) : null,
      )
      .one();

    if (frame.supervisor) {
      this.sql.exec("INSERT INTO laptop_supervisors (laptop, name) VALUES (?, ?) ON CONFLICT (laptop) DO UPDATE SET name = excluded.name", laptop, frame.name);
      this.sql.exec("UPDATE laptop_reports SET reporter = ? WHERE laptop = ?", frame.name, laptop);
      if (pinned !== frame.name) this.audit(conn, "supervisor", { laptop, name: frame.name, was: pinned ?? null });
    }

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
    this.toOwners({ t: "traffic", item: traffic(msg) });
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
    this.toOwners({ t: "traffic", item: traffic(msg) });
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

  // ---------- Board ----------

  /**
   * A board operation, made by the `Board` object (ADR 0001 §1). The only frame that awaits, so
   * other frames (a register, a takeover, a disconnect) may run while it does: the caller is read
   * before the call and passed as values, and anything needed after it is read again then.
   */
  private async boardOp(conn: Conn, frame: Extract<ClientFrame, { t: "board_op" }>): Promise<void> {
    const caller = this.boardCaller(conn, frame);
    const write = !BOARD_READS.includes(frame.op.op);
    if (write) this.audit(conn, "board_op", { op: frame.op.op, as: frame.as ?? null });
    let reply: BoardReply;
    try {
      // RPC's types can't carry an `unknown` result; the reply is the protocol's.
      reply = (await this.env.BOARD.getByName(BOARD).apply(caller, frame.op)) as unknown as BoardReply;
    } catch (err) {
      reply = { ok: false, code: "unavailable", message: `The board can't be reached (${err instanceof Error ? err.message : String(err)}); retry` };
    }
    // Committed, whatever became of the caller's socket meanwhile: the owners refetch.
    if (reply.ok && reply.changed) this.toOwners({ t: "board_changed", ...reply.changed });
    const ws = this.socket(conn.connId);
    if (!ws) return;
    if (reply.ok) this.ok(ws, frame.rid, reply.result);
    else this.send(ws, { t: "error", rid: frame.rid, code: reply.code, message: reply.message });
  }

  /** Who makes a board operation (ADR 0001 §4): the owner, or a peer this connection hosts, with what its supervisor says. */
  private boardCaller(conn: Conn, frame: Extract<ClientFrame, { t: "board_op" }>): BoardCaller {
    if (conn.identity.kind === "owner") {
      if (frame.as !== undefined || frame.ctx !== undefined) throw new FrameError("bad_frame", "The owner's board operations name no peer and no ctx");
      return { kind: "owner", email: conn.identity.email };
    }
    if (frame.as === undefined) throw new FrameError("bad_frame", "A board operation names the peer it is made as");
    const peer = this.hosted(conn, frame.as);
    return { kind: "agent", name: peer.name, laptop: peer.laptop, ctx: frame.ctx ?? null };
  }

  // ---------- Dashboard ----------

  /** The name the laptop's supervisor registered as, if it has. */
  private supervisorOf(laptop: string): string | undefined {
    return this.sql.exec<{ name: string }>("SELECT name FROM laptop_supervisors WHERE laptop = ?", laptop).toArray()[0]?.name;
  }

  private report(conn: Conn, as: string, snapshot: LaptopSnapshot): Results["report"] {
    const peer = this.hosted(conn, as);
    const pinned = this.supervisorOf(peer.laptop);
    // Reports name whom the owner's actions, and token, go to: only the supervisor's count.
    if (pinned && pinned !== peer.name) throw new FrameError("forbidden", `Only ${pinned}, the supervisor, reports for ${peer.laptop}`);
    const at = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO laptop_reports (laptop, snapshot, at, reporter) VALUES (?, ?, ?, ?)
       ON CONFLICT (laptop) DO UPDATE SET snapshot = excluded.snapshot, at = excluded.at, reporter = excluded.reporter`,
      peer.laptop,
      JSON.stringify(snapshot),
      at,
      peer.name,
    );
    this.toOwners({ t: "report", laptop: peer.laptop, at, snapshot });
    return { laptop: peer.laptop };
  }

  private board(conn: Conn, as: string, board: ProjectBoard): Results["board"] {
    const peer = this.hosted(conn, as);
    const at = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO project_boards (laptop, project, board, at) VALUES (?, ?, ?, ?)
       ON CONFLICT (laptop, project) DO UPDATE SET board = excluded.board, at = excluded.at`,
      peer.laptop,
      board.project,
      JSON.stringify(board),
      at,
    );
    this.toOwners({ t: "board", laptop: peer.laptop, at, board });
    return { laptop: peer.laptop, project: board.project };
  }

  private postUpdate(conn: Conn, as: string, text: string): Results["update"] {
    const peer = this.hosted(conn, as);
    this.rejectSecrets(text);
    const item = this.sql
      .exec<{ seq: number; from_addr: string; laptop: string; text: string; at: string }>(
        "INSERT INTO updates (laptop, from_addr, text, at) VALUES (?, ?, ?, ?) RETURNING *",
        peer.laptop,
        formatAddress(peer),
        text,
        new Date().toISOString(),
      )
      .one();
    this.toOwners({ t: "update", item: { seq: item.seq, from: item.from_addr, laptop: item.laptop, text: item.text, at: item.at } });
    return { seq: item.seq };
  }

  private dashboard(): Dashboard {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const stats = new Map<string, PeerStats>();
    const statFor = (address: string) => {
      let s = stats.get(address.toLowerCase());
      if (!s) stats.set(address.toLowerCase(), (s = { sent_24h: 0, received_24h: 0, inbox: 0 }));
      return s;
    };
    const recent = this.sql
      .exec<{ envelope: string }>("SELECT envelope FROM messages WHERE created_at > ? ORDER BY created_at DESC", since)
      .toArray()
      .map((r) => JSON.parse(r.envelope) as Envelope);
    for (const m of recent) {
      statFor(m.from).sent_24h++;
      for (const to of m.to) statFor(to).received_24h++;
    }
    for (const r of this.sql.exec<{ to_key: string; n: number }>("SELECT to_key, count(*) AS n FROM deliveries GROUP BY to_key")) {
      statFor(r.to_key).inbox = r.n;
    }

    const connectedAt = new Map<string, number>();
    for (const ws of this.ctx.getWebSockets()) {
      const c = ws.deserializeAttachment() as Conn;
      connectedAt.set(c.connId, c.connectedAt);
    }
    const peers = this.sql
      .exec<PeerRow>("SELECT * FROM peers ORDER BY laptop, name")
      .toArray()
      .map((p) => {
        const at = p.conn_id ? connectedAt.get(p.conn_id) : undefined;
        return { ...this.info(p), connected_at: at ? new Date(at).toISOString() : null, stats: statFor(formatAddress(p)) };
      });

    return {
      peers,
      laptops: this.sql
        .exec<{ laptop: string; snapshot: string; at: string }>("SELECT * FROM laptop_reports ORDER BY laptop")
        .toArray()
        .map((r) => ({ laptop: r.laptop, at: r.at, snapshot: JSON.parse(r.snapshot) as LaptopSnapshot })),
      boards: this.sql
        .exec<{ laptop: string; board: string; at: string }>("SELECT laptop, board, at FROM project_boards ORDER BY laptop, project")
        .toArray()
        .map((r) => ({ laptop: r.laptop, at: r.at, board: JSON.parse(r.board) as ProjectBoard })),
      updates: this.sql
        .exec<{ seq: number; from_addr: string; laptop: string; text: string; at: string }>(
          "SELECT * FROM updates ORDER BY seq DESC LIMIT ?",
          DASHBOARD_UPDATES,
        )
        .toArray()
        .map((u): UpdateItem => ({ seq: u.seq, from: u.from_addr, laptop: u.laptop, text: u.text, at: u.at })),
      traffic: recent.slice(0, DASHBOARD_ITEMS).map(traffic),
    };
  }

  /** Hands an owner's action to the laptop's supervisor, with the owner's own token. */
  private forwardAction(conn: Conn, laptop: string, action: Action): Results["action"] {
    if (conn.identity.kind !== "owner") throw new FrameError("forbidden", "Only the owner acts from the dashboard");
    const report = this.sql
      .exec<{ reporter: string | null }>("SELECT reporter FROM laptop_reports WHERE laptop = ?", laptop)
      .toArray()[0];
    const supervisor = report?.reporter ? this.peer(addressKey({ name: report.reporter, laptop })) : undefined;
    const ws = supervisor?.conn_id ? this.socket(supervisor.conn_id) : undefined;
    if (!supervisor || !ws) throw new FrameError("offline", `No supervisor is online on ${laptop}`);
    const token = this.sql.exec<{ token: string }>("SELECT token FROM owner_tokens WHERE conn_id = ?", conn.connId).toArray()[0]?.token;
    if (!token) throw new FrameError("forbidden", "This connection carries no owner token; reload the page");

    const id = `a_${crypto.randomUUID()}`;
    this.send(ws, { t: "action", id, to: formatAddress(supervisor), by: conn.identity.email, token, action });
    this.audit(conn, "action", { id, laptop, action });
    return { id };
  }

  private actionResult(conn: Conn, frame: Extract<ClientFrame, { t: "action_result" }>): void {
    const peer = this.hosted(conn, frame.as);
    this.audit(conn, "action_result", { id: frame.id, ok: frame.ok });
    this.toOwners({ t: "action_result", id: frame.id, laptop: peer.laptop, ok: frame.ok, message: frame.message });
  }

  private toOwners(frame: ServerFrame): void {
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Conn).identity.kind === "owner") this.send(ws, frame);
    }
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
      client: p.client ? (JSON.parse(p.client) as ClientInfo) : null,
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

  /** No keepalive answered recently, and not just connected. */
  private isSilent(ws: WebSocket): boolean {
    const conn = ws.deserializeAttachment() as Conn;
    const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
    return Date.now() - Math.max(lastPing, conn.connectedAt) > SILENT_AFTER_MS;
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
    this.sql.exec("DELETE FROM updates WHERE at <= ?", new Date(now - UPDATE_RETENTION_MS).toISOString());
    await this.ctx.storage.setAlarm(now + SWEEP_INTERVAL_MS);
  }
}

function traffic(msg: Envelope): TrafficItem {
  return { id: msg.id, type: msg.type, from: msg.from, to: msg.to, urgent: msg.urgent, at: msg.created_at };
}

/** A directed message always wakes its reader; a broadcast only when urgent. */
function wakes(msg: Envelope): boolean {
  return msg.type === "message" || msg.urgent;
}
