import { readRemoteRequest, type RemoteRequestV1 } from "@bobnet/protocol";

// Spawn requests from another laptop's orchestrator, over BobNet: a directed
// message to the supervisor whose body is one JSON request. The sender is who the
// broker says it is (Casper, 2026-11-07: the BobNet sender is trusted); what it may
// do is supervisor.yaml's `remote` allowlist. It spawns the roles listed for it and
// follows and stops only what it spawned: no policy, no roles, no resumed sessions or
// handoff files, which could reach another worker's context. With `v: 2` it also
// answers the requests of what it spawned (ADR 0007 §4), while its entry still lists
// the worker's project and role: the orchestrator on the requester's laptop answers
// and stops what that laptop spawned here, and its `user_decided` is its own
// assertion, as a local orchestrator's is, so it makes human-tier decisions too.
// The wire (schemas, the classification) is packages/protocol's remote.ts (ADR 0007 §2).

export type RemoteRequest = RemoteRequestV1;

/**
 * Today's request (no `v`) in a message body, read with protocol's `readRemoteRequest`: null for
 * anything that isn't a request (a plain message, a reply, an event); a parse error when it is one
 * but malformed, a `v: 2` request included.
 */
export function readRequest(body: string, inReplyTo: string | null = null): { request: RemoteRequest } | { error: string } | null {
  const read = readRemoteRequest(body, inReplyTo);
  if (!read) return null;
  if ("error" in read) return { error: read.error };
  return read.v === 1 ? { request: read.request } : { error: `bad request: v: 2 requests aren't served by this supervisor yet` };
}

/** How each request's answer reads: one JSON object, so the requester parses it the way it sent. */
export const reply = (value: Record<string, unknown>) => JSON.stringify(value);
