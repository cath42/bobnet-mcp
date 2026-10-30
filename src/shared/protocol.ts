import type { ErrorCodeValue, RpcErrorData } from "./errors.js";

export const JSONRPC_VERSION = "2.0" as const;

export type JsonRpcId = string | number;

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: P;
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result: R;
}

export interface JsonRpcFailure {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId | null;
  error: { code: ErrorCodeValue | number; message: string; data?: RpcErrorData };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure;

export function isRequest(m: unknown): m is JsonRpcRequest {
  return (
    isObj(m) &&
    (m as { jsonrpc?: unknown }).jsonrpc === JSONRPC_VERSION &&
    typeof (m as { method?: unknown }).method === "string" &&
    (m as { id?: unknown }).id !== undefined
  );
}

export function isNotification(m: unknown): m is JsonRpcNotification {
  return (
    isObj(m) &&
    (m as { jsonrpc?: unknown }).jsonrpc === JSONRPC_VERSION &&
    typeof (m as { method?: unknown }).method === "string" &&
    (m as { id?: unknown }).id === undefined
  );
}

export function isSuccess(m: unknown): m is JsonRpcSuccess {
  return (
    isObj(m) &&
    (m as { jsonrpc?: unknown }).jsonrpc === JSONRPC_VERSION &&
    "result" in m &&
    (m as { id?: unknown }).id !== undefined
  );
}

export function isFailure(m: unknown): m is JsonRpcFailure {
  return (
    isObj(m) &&
    (m as { jsonrpc?: unknown }).jsonrpc === JSONRPC_VERSION &&
    "error" in m
  );
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// ---------- Method names ----------

export const Method = {
  Hello: "hello",
  Register: "register",
  Deregister: "deregister",
  ListPeers: "list_peers",
  SendMessage: "send_message",
  Broadcast: "broadcast",
  UpdateStatus: "update_status",
  Ping: "ping",
  ChannelEvent: "channel/event",
} as const;

export type MethodName = (typeof Method)[keyof typeof Method];

// ---------- Request/response shapes ----------

export interface HelloParams {
  protocol_version: number;
  client_pid: number;
  client_started_at: string;
}

export interface HelloResult {
  daemon_pid: number;
  daemon_started_at: string;
  protocol_version: number;
}

export interface RegisterParams {
  name: string;
  team?: string;
  cwd?: string;
  purpose?: string;
  expertise?: string[];
}

export interface RegisterResult {
  peer_id: string;
  name: string;
  team?: string;
  registered_at: string;
}

export interface DeregisterParams {}
export interface DeregisterResult {
  ok: true;
}

export interface ListPeersParams {}
export interface ListPeersResult {
  peers: PeerInfo[];
}

export interface SendMessageParams {
  /** One peer name, or a list of names for a multi-recipient message. */
  to: string | string[];
  body: string;
  in_reply_to?: string;
}

export interface SendMessageResult {
  delivered: boolean;
  message_id: string;
  error?: string;
  cross_team_warning?: string;
}

export interface MultiSendRecipientResult {
  to: string;
  delivered: boolean;
  error?: string;
}

export interface MultiSendMessageResult {
  message_id: string;
  /** True only if every recipient received the message. */
  delivered: boolean;
  results: MultiSendRecipientResult[];
  cross_team_warning?: string;
}

export type BroadcastScope = "team" | "all";

export interface BroadcastParams {
  body: string;
  scope?: BroadcastScope;
  /** Wake every recipient immediately. Reserve for holds and stop-work notices. */
  urgent?: boolean;
}

export interface BroadcastResult {
  recipients: string[];
  message_id: string;
}

export interface UpdateStatusParams {
  status: string;
}

export interface UpdateStatusResult {
  ok: true;
}

export interface PingParams {
  nonce: string;
}

export interface PingResult {
  nonce: string;
}

// ---------- Peer info ----------

export interface PeerInfo {
  peer_id: string;
  name: string;
  team?: string;
  cwd?: string;
  purpose?: string;
  expertise?: string[];
  status?: string;
  joined_at: string;
}

// ---------- channel/event payloads ----------

export type PeerLeftReason =
  | "deregistered"
  | "disconnected"
  | "crashed"
  | "daemon_shutdown";

export interface PeerJoinedEvent {
  event_type: "peer_joined";
  peer: PeerInfo;
}

export interface PeerLeftEvent {
  event_type: "peer_left";
  name: string;
  peer_id: string;
  reason: PeerLeftReason;
  left_at: string;
}

export interface MessageEvent {
  event_type: "message";
  from: string;
  message_id: string;
  body: string;
  in_reply_to?: string;
  cross_team?: boolean;
  /** Other recipients of the same multi-recipient message. */
  cc?: string[];
  sent_at: string;
}

export interface BroadcastEvent {
  event_type: "broadcast";
  from: string;
  message_id: string;
  body: string;
  scope: BroadcastScope;
  urgent?: boolean;
  sent_at: string;
}

export interface StatusChangedEvent {
  event_type: "status_changed";
  name: string;
  peer_id: string;
  status: string;
  changed_at: string;
}

export type ChannelEvent =
  | PeerJoinedEvent
  | PeerLeftEvent
  | MessageEvent
  | BroadcastEvent
  | StatusChangedEvent;

// ---------- Method → param/result map (for typed RPC) ----------

export interface MethodMap {
  hello: { params: HelloParams; result: HelloResult };
  register: { params: RegisterParams; result: RegisterResult };
  deregister: { params: DeregisterParams; result: DeregisterResult };
  list_peers: { params: ListPeersParams; result: ListPeersResult };
  send_message: {
    params: SendMessageParams;
    result: SendMessageResult | MultiSendMessageResult;
  };
  broadcast: { params: BroadcastParams; result: BroadcastResult };
  update_status: { params: UpdateStatusParams; result: UpdateStatusResult };
  ping: { params: PingParams; result: PingResult };
}

// ---------- Naming validation ----------

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function isValidName(name: unknown): name is string {
  return typeof name === "string" && NAME_RE.test(name);
}

export function isValidExpertise(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "string" && v.length > 0 && v.length <= 64)
  );
}

export const STATUS_MAX_LEN = 200;
export const PURPOSE_MAX_LEN = 500;
export const BODY_MAX_LEN = 64 * 1024;
export const TEAM_MAX_LEN = 64;
export const MAX_RECIPIENTS = 32;

export function isValidTeam(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= TEAM_MAX_LEN;
}
