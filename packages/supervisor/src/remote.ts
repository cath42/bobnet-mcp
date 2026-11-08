import { z } from "zod";
import { EFFORTS } from "./config.ts";

// Spawn requests from another laptop's orchestrator, over BobNet: a directed
// message to the supervisor whose body is one JSON request. The sender is who the
// broker says it is (Casper, 2026-11-07: the BobNet sender is trusted); what it may
// do is supervisor.yaml's `remote` allowlist. It spawns the roles listed for it and
// follows and stops only what it spawned: no answers, no policy, no roles, no
// resumed sessions or handoff files, which could reach another worker's context.

const Session = z.object({ feature: z.string(), kind: z.enum(["design", "build", "review", "retro"]), label: z.string().optional() }).strict();

export const RemoteRequest = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("spawn"),
      project: z.string(),
      role: z.string(),
      task: z.string().min(1),
      tasks: z.array(z.string()).max(50).optional(),
      session: Session.nullable().optional(),
      model: z.string().optional(),
      effort: z.enum(EFFORTS).optional(),
      as: z.enum(["lead", "worker"]).optional(),
    })
    .strict(),
  z.object({ op: z.literal("status"), id: z.string() }).strict(),
  z.object({ op: z.literal("stop"), id: z.string() }).strict(),
  z.object({ op: z.literal("list") }).strict(),
]);
export type RemoteRequest = z.infer<typeof RemoteRequest>;

/**
 * The request in a message body: one JSON object, bare or in a ```json fence. Null when the
 * body isn't one (a plain message to the supervisor, which it only logs); a parse error when
 * it is one but malformed.
 */
export function readRequest(body: string): { request: RemoteRequest } | { error: string } | null {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(body);
  const text = (fenced ? fenced[1]! : body).trim();
  if (!text.startsWith("{")) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || !("op" in json)) return null;
  const parsed = RemoteRequest.safeParse(json);
  if (!parsed.success) return { error: `bad request: ${parsed.error.issues.map((i) => `${i.path.join(".") || "op"} ${i.message}`).join("; ")}` };
  return { request: parsed.data };
}

/** How each request's answer reads: one JSON object, so the requester parses it the way it sent. */
export const reply = (value: Record<string, unknown>) => JSON.stringify(value);
