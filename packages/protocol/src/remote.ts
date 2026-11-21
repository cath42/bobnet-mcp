import { z } from "zod";

// Requests, replies and events between supervisors (ADR 0007 §2): message bodies, one JSON object
// each, sent to another laptop's supervisor. Two supervisors may run different releases, so the
// wire is defined here, once. A request without `v` is today's (rc.37's): spawn, status, stop,
// list, answered `{ ok, op, ... }`. A request with `v: 2` is the remote tools' and is answered
// `{ v: 2, re, req, ok, ... }`. Both are `.strict()`: an old target refuses `v`, and nobody sends a
// path (`handoff`, `resume_session`) to another worker's context.

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

const Session = z.object({ feature: z.string(), kind: z.enum(["design", "build", "review", "retro"]), label: z.string().optional() }).strict();

const spawnFields = {
  project: z.string(),
  role: z.string(),
  task: z.string().min(1),
  tasks: z.array(z.string()).max(50).optional(),
  session: Session.nullable().optional(),
  model: z.string().optional(),
  effort: z.enum(EFFORTS).optional(),
};

/** Today's request, without `v`: what rc.37 serves and hand-written requests send. */
export const RemoteRequestV1 = z.discriminatedUnion("op", [
  z.object({ op: z.literal("spawn"), ...spawnFields, as: z.enum(["lead", "worker"]).optional() }).strict(),
  z.object({ op: z.literal("status"), id: z.string() }).strict(),
  z.object({ op: z.literal("stop"), id: z.string() }).strict(),
  z.object({ op: z.literal("list") }).strict(),
]);
export type RemoteRequestV1 = z.infer<typeof RemoteRequestV1>;

const v = z.literal(2);
const id = z.string().min(1);

/** A release tag a supervisor may upgrade to (ADR 0008 §3): v<semver>, or one of its rcs. */
export const UPGRADE_TAG = /^v\d+\.\d+\.\d+(-rc\.\d+)?$/;
/** When an upgraded supervisor restarts (§4): at its first idle, now (its workers orphaned), or not. */
export const UPGRADE_RESTARTS = ["when_idle", "now", "no"] as const;
export type UpgradeRestart = (typeof UPGRADE_RESTARTS)[number];

/** A `v: 2` request (§2's table). `id` is a worker id, or a request id for `request` and `answer`. */
export const RemoteRequestV2 = z.discriminatedUnion("op", [
  // Never a lead from afar; `by` is the requester's orchestrator, kept for the record, never authorised on.
  z.object({ v, op: z.literal("spawn"), ...spawnFields, as: z.literal("worker").optional(), by: z.string().min(1) }).strict(),
  z.object({ v, op: z.literal("status"), id }).strict(),
  z.object({ v, op: z.literal("stop"), id }).strict(),
  z.object({ v, op: z.literal("list"), ids: z.array(id).max(100).optional(), reqs: z.array(id).max(100).optional() }).strict(),
  z.object({ v, op: z.literal("tail"), id, n: z.number().int().positive().max(500) }).strict(),
  z.object({ v, op: z.literal("summary"), id }).strict(),
  z.object({ v, op: z.literal("request"), id }).strict(),
  z
    .object({
      v,
      op: z.literal("answer"),
      id,
      decision: z.enum(["allow", "deny", "answer"]),
      message: z.string().optional(),
      answers: z.record(z.string(), z.string()).optional(),
      user_decided: z.boolean(),
      resume: z.boolean(),
    })
    .strict(),
  // A tag on the line, built on the target from its own clone (ADR 0008 §2, §3): never a path, an archive or code.
  z
    .object({
      v,
      op: z.literal("upgrade"),
      tag: z.string().regex(UPGRADE_TAG, "must be a release tag, v<x.y.z> or v<x.y.z>-rc.<n>"),
      restart: z.enum(UPGRADE_RESTARTS).optional(),
    })
    .strict(),
]);
export type RemoteRequestV2 = z.infer<typeof RemoteRequestV2>;
export type RemoteOp = RemoteRequestV2["op"];

export type RemoteRequest = RemoteRequestV1 | RemoteRequestV2;

/** A worker as a reply names it: its id at least; the rest is the target's view, read loosely (the additive rule). */
const View = z.looseObject({ id });

/** A `v: 2` reply: one per request, matched on `req` (the request's message id), never on the envelope. */
export const RemoteReply = z.union([
  z.looseObject({ v, re: z.string(), req: id, ok: z.literal(true), worker: View.optional(), workers: z.array(View).optional() }),
  z.looseObject({ v, re: z.string(), req: id, ok: z.literal(false), error: z.string() }),
]);
export type RemoteReply = z.infer<typeof RemoteReply>;

export const REMOTE_EVENTS = ["remote_control", "request", "settled", "resumed", "exit", "withheld"] as const;
export type RemoteEventName = (typeof REMOTE_EVENTS)[number];

/** A `v: 2` event, requester-bound and unasked; `spawn_req` is the message id of the spawn that made the worker. */
export const RemoteEvent = z.looseObject({ v, event: z.enum(REMOTE_EVENTS), worker: id, spawn_req: id });
export type RemoteEvent = z.infer<typeof RemoteEvent>;

/** An upgrade's stages, as its events report them to the requester (ADR 0008 §5). */
export const UPGRADE_STAGES = ["installed", "restarting", "ready", "failed"] as const;
export type UpgradeStage = (typeof UPGRADE_STAGES)[number];

/**
 * An upgrade's event (§5): about the supervisor, not a worker, so not a RemoteEvent; a requester routes
 * `event: "upgrade"` here first. `req` is the upgrade's message id; `from` and `to` the versions. An
 * older requester's RemoteEvent refuses it (no worker, an unknown event), and it is dropped.
 */
export const RemoteUpgrade = z.looseObject({ v, event: z.literal("upgrade"), req: id, stage: z.enum(UPGRADE_STAGES), from: z.string().nullable(), to: z.string() });
export type RemoteUpgrade = z.infer<typeof RemoteUpgrade>;

/** The states that end a worker, as an `exit` says them. */
export const EXIT_STATES = ["done", "failed", "stopped"] as const;

/** An `exit` event (§6): an end the requester takes as final, so its state is one that ends a worker. */
export const RemoteExit = RemoteEvent.extend({ event: z.literal("exit"), state: z.enum(EXIT_STATES) });
export type RemoteExit = z.infer<typeof RemoteExit>;

/**
 * What stands in for a reply or event the broker refused as a credential (§2): who it was about, as
 * far as the body said. A reply's keeps `re` and `req`, so the requester takes it as the answer.
 */
export const RemoteWithheld = z.looseObject({ v: v.optional(), event: z.literal("withheld"), worker: id.optional(), spawn_req: id.optional(), re: z.string().optional(), req: id.optional() });
export type RemoteWithheld = z.infer<typeof RemoteWithheld>;

export type RemoteKind = "request" | "reply" | "event";

/**
 * What a message to a supervisor is (ADR 0007 §2), with its JSON: one object, bare or in a ```json
 * fence. A supervisor never answers an answer: a request has `op`, isn't sent in reply
 * (`inReplyTo`, the envelope's), and carries neither `re` nor `event`; anything else that is an
 * object is a reply, or an event when it has `event`. Today's replies carry `op`; answered as
 * malformed requests, two supervisors would answer each other without end. Null for a body that
 * isn't one JSON object (a plain message).
 */
export function classifyRemote(body: string, inReplyTo: string | null = null): { kind: RemoteKind; json: Record<string, unknown> } | null {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(body);
  const text = (fenced ? fenced[1]! : body).trim();
  if (!text.startsWith("{")) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if ("event" in o) return { kind: "event", json: o };
  if (inReplyTo !== null || "re" in o || !("op" in o)) return { kind: "reply", json: o };
  return { kind: "request", json: o };
}

/** A read request: `v` 1 (none on the wire) or 2; when malformed, `re` is its op if it has a string one, else "invalid". */
export type ReadRequest = { v: 1; request: RemoteRequestV1 } | { v: 2; request: RemoteRequestV2 } | { v: 1 | 2; re: string; error: string };

/**
 * The request in a message body, or null for anything else (a plain message, a reply, an event).
 * `v: 2` parses as the new; without `v`, as today's; any other `v` is today's request with an
 * unknown key. A bad key is named by its path, or `body` at the root.
 */
export function readRemoteRequest(body: string, inReplyTo: string | null = null): ReadRequest | null {
  const c = classifyRemote(body, inReplyTo);
  return c?.kind === "request" ? parseRemoteRequest(c.json) : null;
}

/** Any JSON value as a request, by its `v`; what isn't an object fails at `body`. */
export function parseRemoteRequest(json: unknown): ReadRequest {
  const o = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const re = typeof o?.["op"] === "string" ? (o["op"] as string) : "invalid";
  if (!o) return { v: 1, re, error: "bad request: body must be one JSON object" };
  if (o["v"] === 2) {
    const p = RemoteRequestV2.safeParse(o);
    return p.success ? { v: 2, request: p.data } : { v: 2, re, error: badRequest(p.error) };
  }
  const p = RemoteRequestV1.safeParse(o);
  return p.success ? { v: 1, request: p.data } : { v: 1, re, error: badRequest(p.error) };
}

/** "bad request: " and each issue by its key path; zod puts unknown keys in `keys`, at the object's path. */
function badRequest(error: z.ZodError): string {
  const at = (path: PropertyKey[]) => (path.length ? path.map(String).join(".") : "body");
  return `bad request: ${error.issues
    .map((i) => {
      if (i.code === "unrecognized_keys") return i.keys.map((k) => `${at([...i.path, k])} is not allowed`).join("; ");
      return `${at(i.path)} ${i.message}`;
    })
    .join("; ")}`;
}

/**
 * Orders two supervisor versions, `x.y.z` or `x.y.z-rc.n` (§9): rc numbers numerically, any rc
 * before its release. Null when either is missing or doesn't parse: unknown, not older.
 */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  return 0;
}

/** [x, y, z, rc], a release's rc as Infinity so it sorts after every rc of its version. */
function parseVersion(s: string | null | undefined): [number, number, number, number] | null {
  const m = typeof s === "string" ? /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(s.trim()) : null;
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Infinity : Number(m[4])];
}
