import type { BoardReply, BoardResults } from "@bobnet/protocol";
import { authenticate } from "./auth.ts";
import { cspFor } from "./csp.ts";

export { Board } from "./board/board.ts";
export { Broker } from "./broker.ts";

// The whole network lives in one Durable Object: one user, low volume, and
// no cross-object routing for messages that cross teams.
const NETWORK = "network";
// Every project's board is one Board object (ADR 0001 §1).
const BOARD = "board";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...SECURITY_HEADERS } });

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const identity = await authenticate(req, env);
    if (!identity) return new Response("Unauthorized", { status: 401 });

    if (url.pathname === "/v1/ws") {
      // A CI token reports runs over HTTP and holds no socket (ADR 0001 §4).
      if (identity.kind === "ci") return new Response("Forbidden", { status: 403 });
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      // Browsers send Origin; only the broker's own UI may open an owner socket.
      if (identity.kind === "owner" && req.headers.get("origin") !== url.origin) {
        return new Response("Forbidden origin", { status: 403 });
      }
      // A fresh request, so nothing the client sent reaches the object except
      // the identity this Worker vouches for.
      const headers: Record<string, string> = { upgrade: "websocket", "x-bobnet-identity": JSON.stringify(identity) };
      // The owner's own token travels with their actions, for supervisors to verify.
      if (identity.kind === "owner") headers["x-bobnet-owner-token"] = req.headers.get("cf-access-jwt-assertion")!;
      const forwarded = new Request("https://broker.internal/connect", { headers });
      return env.BROKER.getByName(NETWORK).fetch(forwarded);
    }

    // The board as one document (ADR 0001 §11): out for the nightly backup, in for new projects only.
    // The owner, or a laptop as far as its rules go; any other identity (CI's, §4) never gets the board.
    if ((url.pathname === "/v1/board/export" || url.pathname === "/v1/board/import") && identity.kind === "ci") return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/v1/board/export" && identity.kind !== "ci") {
      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return json(await env.BOARD.getByName(BOARD).exportBoard(identity));
    }
    if (url.pathname === "/v1/board/import" && identity.kind !== "ci") {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      // A browser's cookie must not import on the owner's behalf from another site.
      if (identity.kind === "owner" && req.headers.get("origin") !== url.origin) return new Response("Forbidden origin", { status: 403 });
      let doc: unknown;
      try {
        doc = await req.json();
      } catch {
        return json({ ok: false, code: "invalid", message: "The body is not JSON" }, 400);
      }
      const reply = await env.BOARD.getByName(BOARD).importBoard(identity, doc);
      return json(reply, reply.ok ? 200 : reply.code === "conflict" ? 409 : reply.code === "forbidden" ? 403 : 400);
    }

    // A CI run's start or end, from any CI with a CI token (ADR 0001 §10). The source is the token's.
    if (url.pathname === "/v1/runs") {
      if (identity.kind !== "ci") return new Response("Forbidden", { status: 403 });
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, code: "invalid", message: "The body is not JSON" }, 400);
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ ok: false, code: "invalid", message: "The body is a JSON object" }, 400);
      const { source, op: _op, ...run } = body as Record<string, unknown>;
      if (source !== undefined && source !== identity.source) {
        return json({ ok: false, code: "forbidden", message: `This token reports as ${identity.source}, not ${String(source)}` }, 403);
      }
      const reply = (await env.BOARD.getByName(BOARD).reportCi(identity.source, run)) as unknown as BoardReply;
      if (!reply.ok) return json(reply, reply.code === "conflict" ? 409 : reply.code === "forbidden" ? 403 : reply.code === "unavailable" ? 503 : 400);
      // The owners refetch, as after a board_op.
      if (reply.changed) await env.BROKER.getByName(NETWORK).boardChanged(reply.changed);
      const result = reply.result as BoardResults["ci_run"];
      return json({ ok: true, ref: result.ref, tied: result.tied });
    }

    // The dashboard is for the owner only; laptops get the socket and nothing else.
    if (identity.kind !== "owner") return new Response("Not found", { status: 404 });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const asset = await env.ASSETS.fetch(req);
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    res.headers.set("content-security-policy", cspFor(url.pathname, url.host));
    // The vendored libraries are named by their version, so a phone downloads each once (ADR 0015 §6): the one
    // exception to no-store. Not a missing file: that may yet be deployed.
    if (url.pathname.startsWith("/vendor/") && res.ok) res.headers.set("cache-control", "private, max-age=31536000, immutable");
    return res;
  },
} satisfies ExportedHandler<Env>;
