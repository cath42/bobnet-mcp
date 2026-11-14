import { z } from "zod";
import { BoardCtx, BoardOp, type BoardResults } from "./board.ts";

// Wire protocol v1: JSON text frames over one WebSocket per connection.
// A connection authenticates as a laptop (or as the owner, for the UI) and
// can host several peers; every client frame that acts names the hosted
// peer it acts `as`.

export const PROTOCOL_VERSION = 1;

/**
 * Keepalive. The broker registers this pair as its WebSocket auto-response,
 * so the edge answers without waking the Durable Object.
 */
export const PING = '{"t":"ping"}';
export const PONG = '{"t":"pong"}';

export const LIMITS = {
  frameBytes: 64 * 1024,
  /**
   * What a supervisor reports may be larger: its snapshot carries a day of workers, and a project
   * board (backlog, sessions, past runs) is sent only when it changes.
   */
  boardFrameBytes: 900 * 1024,
  bodyChars: 16 * 1024,
  recipients: 32,
  statusChars: 200,
  purposeChars: 300,
  expertiseTags: 12,
  defaultMessageTtlSeconds: 30 * 24 * 3600,
  defaultBroadcastTtlSeconds: 24 * 3600,
  maxTtlSeconds: 30 * 24 * 3600,
} as const;

const segment = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/);
const rid = z.string().min(1).max(64);
const body = z.string().min(1).max(LIMITS.bodyChars);
const ttl = z.number().int().positive().max(LIMITS.maxTtlSeconds);

// ---------- Envelope: what is stored and delivered ----------

export const MessageType = z.enum(["message", "broadcast"]);
export type MessageType = z.infer<typeof MessageType>;

export const Envelope = z.object({
  id: z.string(),
  type: MessageType,
  from: z.string(),
  to: z.array(z.string()),
  team: z.string().nullable(),
  laptop: z.string(),
  in_reply_to: z.string().nullable(),
  urgent: z.boolean(),
  body: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
});
export type Envelope = z.infer<typeof Envelope>;

/** Which client a peer runs, as it said when it registered. */
export const ClientInfo = z.object({
  package: z.string().min(1).max(64),
  version: z.string().min(1).max(64),
  protocol: z.number().int().positive(),
});
export type ClientInfo = z.infer<typeof ClientInfo>;

export const PeerInfo = z.object({
  address: z.string(),
  name: z.string(),
  laptop: z.string(),
  team: z.string().nullable(),
  purpose: z.string().nullable(),
  expertise: z.array(z.string()),
  status: z.string().nullable(),
  online: z.boolean(),
  last_seen: z.string(),
  /** Null for a client too old to say; absent from a broker too old to keep it. */
  client: ClientInfo.nullable().optional(),
});
export type PeerInfo = z.infer<typeof PeerInfo>;

// ---------- Laptop snapshot: what a supervisor reports ----------

const tokens = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cache_read: z.number().nonnegative(),
  cache_write: z.number().nonnegative(),
});
export type TokenCounts = z.infer<typeof tokens>;

export const WorkerSnapshot = z.object({
  id: z.string().max(40),
  name: z.string().max(40),
  project: z.string().max(40),
  role: z.string().max(40),
  state: z.enum(["queued", "running", "waiting-approval", "waiting-answer", "done", "failed", "stopped"]),
  task: z.string().max(200),
  /** What it runs on; null is Claude Code's default. */
  model: z.string().max(60).nullable().default(null),
  effort: z.string().max(10).nullable().default(null),
  checkpoint: z.string().max(300).nullable(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  last_event_at: z.string().nullable(),
  tokens,
  /** Usage is tokens: nothing computes or shows money. Optional until it leaves with the legacy board (ADR 0001 §9). */
  cost_usd: z.number().nonnegative().optional(),
  /** The session it works in, as its brief names it ("LAND-41 build 3"), or the one running when it started. */
  session: z.string().max(60).nullable().default(null),
  /** The first of `task_refs`, for a dashboard that reads only one. */
  task_ref: z.string().max(40).nullable().default(null),
  /** The backlog items its spawn named (an older worker's: the one its brief names, if any). */
  task_refs: z.array(z.string().max(40)).max(50).default([]),
  /** Model calls so far, and the context the latest one carried. */
  calls: z.number().int().nonnegative().default(0),
  context: z.number().int().nonnegative().nullable().default(null),
  /** Context per call, for a worker that is running; a past run's is on its project's board. */
  ctx: z.array(z.number().int().nonnegative()).max(400).default([]),
  /** Its Remote Control session on claude.ai, while it runs with one. */
  remote_url: z.string().url().startsWith("https://claude.ai/").max(200).nullable().default(null),
});
export type WorkerSnapshot = z.infer<typeof WorkerSnapshot>;

export const LaptopSnapshot = z.object({
  supervisor: z.object({
    started_at: z.string(),
    concurrency: z.number().int().positive(),
    active: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
  }),
  /** Active workers plus those that ended in the last 24 hours. */
  workers: z.array(WorkerSnapshot).max(100),
  pending: z
    .array(
      z.object({
        id: z.string().max(40),
        worker_id: z.string().max(40),
        name: z.string().max(40),
        kind: z.enum(["approval", "question"]),
        tool: z.string().max(80),
        tier: z.enum(["orchestrator", "human"]),
        created_at: z.string(),
        /** What is being asked, shortened; redacted if it looks like it holds a credential. */
        preview: z.string().max(400),
      }),
    )
    .max(100),
  /** Daily totals per project role, last 14 days. */
  usage: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        project: z.string().max(40),
        role: z.string().max(40),
        model: z.string().max(60).nullable().default(null),
        workers: z.number().int().nonnegative(),
        tokens,
        /** Usage is tokens: optional, never shown (ADR 0001 §9). */
        cost_usd: z.number().nonnegative().optional(),
      }),
    )
    .max(500),
});
export type LaptopSnapshot = z.infer<typeof LaptopSnapshot>;

// ---------- Project board: what a supervisor reports when it changes ----------

export const SessionKind = z.enum(["design", "build", "review", "retro", "other"]);
export type SessionKind = z.infer<typeof SessionKind>;

const short = (n: number) => z.string().max(n);

export const BoardItem = z.object({
  id: short(40),
  title: short(300),
  status: short(40),
  type: short(20).nullable(),
  parent: short(40).nullable(),
  milestone: short(40).nullable(),
  assignee: z.array(short(60)).max(10),
  labels: z.array(short(60)).max(20),
  deps: z.array(short(40)).max(40),
  /** Open items only: what it is and how it's accepted, shortened. */
  desc: short(600).nullable(),
  ac: z.array(z.tuple([z.boolean(), short(300)])).max(40),
});
export type BoardItem = z.infer<typeof BoardItem>;

export const ProjectBoard = z.object({
  project: short(40),
  /** The commit the backlog was read at. */
  ref: short(40).nullable(),
  backlog: z
    .object({
      milestones: z.array(z.object({ id: short(40), title: short(200) })).max(50),
      /** Increments, every task of an open increment, and any other open item. */
      items: z.array(BoardItem).max(1500),
      /** Tasks of accepted increments, counted rather than listed. */
      done_counts: z.record(z.string(), z.number().int().nonnegative()),
      drafts: z.array(z.object({ id: short(40), title: short(300), updated: short(40).nullable() })).max(300),
    })
    .nullable(),
  sessions: z
    .array(
      z.object({
        name: short(60),
        kind: SessionKind,
        started_at: z.string(),
        ended_at: z.string().nullable(),
        workers: z.number().int().nonnegative(),
        calls: z.number().int().nonnegative(),
        /** Workers' and orchestrator's together. */
        tokens,
        /** The orchestrator's share: its calls in the session's span. */
        orchestrator: z.object({ name: short(40), calls: z.number().int().nonnegative(), tokens: z.number().nonnegative() }).nullable().default(null),
      }),
    )
    .max(200),
  /** Ended runs of the latest sessions, each with its context per call. */
  runs: z
    .array(
      z.object({
        id: short(40),
        name: short(40),
        role: short(40),
        session: short(60).nullable(),
        task_ref: short(40).nullable(),
        task_refs: z.array(short(40)).max(50).default([]),
        model: short(60).nullable(),
        effort: short(10).nullable(),
        started_at: z.string().nullable(),
        ended_at: z.string().nullable(),
        resumed: z.boolean(),
        tokens: z.number().nonnegative(),
        ctx: z.array(z.number().int().nonnegative()).max(400),
      }),
    )
    .max(300),
  /** Middle half and median of earlier runs' context, call by call, outside the latest build session. */
  baseline: z.object({ runs: z.number().int().nonnegative(), p25: z.array(z.number()), p50: z.array(z.number()), p75: z.array(z.number()) }),
  commits: z.array(z.object({ sha: short(12), at: z.string(), author: short(60), subject: short(200) })).max(200),
  /** null when the CI can't be read (no gh, or not signed in). */
  ci: z.array(z.object({ name: short(80), status: short(20), conclusion: short(20).nullable(), created_at: z.string(), sha: short(12) })).max(20).nullable(),
});
export type ProjectBoard = z.infer<typeof ProjectBoard>;

/** A short session update for the dashboard feed, e.g. from the orchestrator. */
export const UpdateItem = z.object({
  seq: z.number().int(),
  from: z.string(),
  laptop: z.string(),
  text: z.string(),
  at: z.string(),
});
export type UpdateItem = z.infer<typeof UpdateItem>;

/** Message metadata for the dashboard: never the body. */
export interface TrafficItem {
  id: string;
  type: MessageType;
  from: string;
  to: string[];
  urgent: boolean;
  at: string;
}

export interface PeerStats {
  sent_24h: number;
  received_24h: number;
  inbox: number;
}

export interface Dashboard {
  peers: Array<PeerInfo & { connected_at: string | null; stats: PeerStats }>;
  laptops: Array<{ laptop: string; at: string; snapshot: LaptopSnapshot }>;
  boards: Array<{ laptop: string; at: string; board: ProjectBoard }>;
  updates: UpdateItem[];
  traffic: TrafficItem[];
}

// ---------- Client → broker ----------

export const RegisterFrame = z.object({
  t: z.literal("register"),
  rid,
  name: segment,
  team: segment.optional(),
  purpose: z.string().max(LIMITS.purposeChars).optional(),
  expertise: z.array(z.string().min(1).max(40)).max(LIMITS.expertiseTags).optional(),
  /**
   * Random per client process. A name held by a connection with the same
   * instance is this process reconnecting, and is handed over at once.
   */
  instance: z.string().min(8).max(64).optional(),
  /**
   * This name is its laptop's supervisor: the one peer whose `report` the broker
   * takes for the laptop and whom dashboard actions go to. Pinned until it is gone.
   */
  supervisor: z.literal(true).optional(),
  /** Which client this is. Optional: clients before it still register. */
  client: ClientInfo.optional(),
});

export const DeregisterFrame = z.object({ t: z.literal("deregister"), rid, as: segment });

export const SendFrame = z.object({
  t: z.literal("send"),
  rid,
  as: segment,
  to: z.array(z.string().min(1).max(65)).min(1).max(LIMITS.recipients),
  body,
  in_reply_to: z.string().max(64).optional(),
  urgent: z.boolean().optional(),
  ttl_seconds: ttl.optional(),
});

export const BroadcastFrame = z.object({
  t: z.literal("broadcast"),
  rid,
  as: segment,
  scope: z.enum(["team", "all"]),
  body,
  urgent: z.boolean().optional(),
  ttl_seconds: ttl.optional(),
});

export const StatusFrame = z.object({
  t: z.literal("status"),
  rid,
  as: segment,
  status: z.string().max(LIMITS.statusChars).nullable(),
});

export const PeersFrame = z.object({ t: z.literal("peers"), rid });

export const ReportFrame = z.object({ t: z.literal("report"), rid, as: segment, snapshot: LaptopSnapshot });

export const BoardFrame = z.object({ t: z.literal("board"), rid, as: segment, board: ProjectBoard });

export const UpdateFrame = z.object({ t: z.literal("update"), rid, as: segment, text: z.string().min(1).max(500) });

/** Owner only: everything the dashboard shows, in one reply. */
export const DashboardFrame = z.object({ t: z.literal("dashboard"), rid });

/** What the owner can do from the dashboard. */
export const Action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer"), request: z.string().max(40), decision: z.enum(["allow", "deny"]) }),
  z.object({ kind: z.literal("stop"), worker: z.string().max(40) }),
  z.object({ kind: z.literal("reset"), worker: z.string().max(40) }),
]);
export type Action = z.infer<typeof Action>;

/** Owner only: an action for one laptop's supervisor. */
export const ActionFrame = z.object({ t: z.literal("action"), rid, laptop: segment, action: Action });

/** A supervisor's outcome for an action it was handed. */
export const ActionResultFrame = z.object({
  t: z.literal("action_result"),
  as: segment,
  id: z.string().max(64),
  ok: z.boolean(),
  message: z.string().max(500),
});

export const AckFrame = z.object({
  t: z.literal("ack"),
  as: segment,
  ids: z.array(z.string().max(64)).min(1).max(256),
});

/**
 * A board operation (ADR 0001 §8). A laptop makes it `as` a peer it hosts, and a supervisor adds
 * `ctx` for the worker it speaks for; the owner's socket names no peer.
 */
export const BoardOpFrame = z.object({ t: z.literal("board_op"), rid, as: segment.optional(), ctx: BoardCtx.optional(), op: BoardOp });

export const ClientFrame = z.discriminatedUnion("t", [
  RegisterFrame,
  DeregisterFrame,
  SendFrame,
  BroadcastFrame,
  StatusFrame,
  PeersFrame,
  ReportFrame,
  BoardFrame,
  UpdateFrame,
  DashboardFrame,
  ActionFrame,
  ActionResultFrame,
  AckFrame,
  BoardOpFrame,
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

/** Every frame type this protocol knows; any other `t` is answered `unsupported`. */
export const CLIENT_FRAME_TYPES: readonly string[] = ClientFrame.options.map((o) => o.shape.t.value);

// ---------- Broker → client ----------

export const ErrorCode = z.enum([
  "bad_frame",
  "frame_too_large",
  "forbidden",
  "not_hosted",
  "name_in_use",
  "unknown_peer",
  "no_team",
  "secret_detected",
  "unknown_message",
  "offline",
  /** A frame type the broker doesn't know: the client is newer than the broker. */
  "unsupported",
  /** Board operations (ADR 0001 §8): refused as invalid, in conflict with the board, or the board can't be reached. */
  "invalid",
  "conflict",
  "unavailable",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export type Identity =
  | { kind: "laptop"; laptop: string }
  | { kind: "owner"; email: string };

export type ServerFrame =
  | { t: "welcome"; v: typeof PROTOCOL_VERSION; identity: Identity }
  | { t: "ok"; rid: string; result: unknown }
  | { t: "error"; rid: string | null; code: ErrorCode; message: string }
  | { t: "deliver"; to: string; wake: boolean; msg: Envelope }
  | { t: "presence"; event: "joined" | "left" | "status"; peer: PeerInfo }
  // To owner connections only:
  | { t: "report"; laptop: string; at: string; snapshot: LaptopSnapshot }
  | { t: "board"; laptop: string; at: string; board: ProjectBoard }
  | { t: "update"; item: UpdateItem }
  | { t: "traffic"; item: TrafficItem }
  | { t: "action_result"; id: string; laptop: string; ok: boolean; message: string }
  /** A board write committed: refetch what shows these records. */
  | { t: "board_changed"; project: string; seq: number; refs: string[] }
  // To a laptop's supervisor. `token` is the owner's Access JWT, for the
  // supervisor to verify itself: the broker alone can't act as the owner.
  | { t: "action"; id: string; to: string; by: string; token: string; action: Action };

/** Results carried by `ok` frames, per request type. */
export interface Results {
  register: { address: string; queued: number };
  deregister: { address: string };
  send: { id: string; queued_for: string[]; delivered_to: string[] };
  broadcast: { id: string; recipients: number };
  status: { address: string };
  peers: { peers: PeerInfo[] };
  report: { laptop: string };
  board: { laptop: string; project: string };
  update: { seq: number };
  dashboard: Dashboard;
  action: { id: string };
  /** Per operation: `BoardResults[op]`. */
  board_op: BoardResults[keyof BoardResults];
}
