import { z } from "zod";

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
});
export type PeerInfo = z.infer<typeof PeerInfo>;

// ---------- Client → broker ----------

export const RegisterFrame = z.object({
  t: z.literal("register"),
  rid,
  name: segment,
  team: segment.optional(),
  purpose: z.string().max(LIMITS.purposeChars).optional(),
  expertise: z.array(z.string().min(1).max(40)).max(LIMITS.expertiseTags).optional(),
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

export const AckFrame = z.object({
  t: z.literal("ack"),
  as: segment,
  ids: z.array(z.string().max(64)).min(1).max(256),
});

export const ClientFrame = z.discriminatedUnion("t", [
  RegisterFrame,
  DeregisterFrame,
  SendFrame,
  BroadcastFrame,
  StatusFrame,
  PeersFrame,
  AckFrame,
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

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
  | { t: "presence"; event: "joined" | "left" | "status"; peer: PeerInfo };

/** Results carried by `ok` frames, per request type. */
export interface Results {
  register: { address: string; queued: number };
  deregister: { address: string };
  send: { id: string; queued_for: string[]; delivered_to: string[] };
  broadcast: { id: string; recipients: number };
  status: { address: string };
  peers: { peers: PeerInfo[] };
}
