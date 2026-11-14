import { authenticate } from "./auth.ts";

export { Board } from "./board/board.ts";
export { Broker } from "./broker.ts";

// The whole network lives in one Durable Object: one user, low volume, and
// no cross-object routing for messages that cross teams.
const NETWORK = "network";
// Every project's board is one Board object (ADR 0001 §1).
const BOARD = "board";

/** connect-src names the socket explicitly: Safari doesn't count wss:// as 'self'. */
const csp = (host: string) =>
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://${host}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

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
    if (url.pathname === "/v1/board/export" || url.pathname === "/v1/board/import") {
      // The owner, or a laptop as far as its rules go; any other identity (CI's, §4) never gets the board.
      if (identity.kind !== "owner" && identity.kind !== "laptop") return new Response("Forbidden", { status: 403 });
    }
    if (url.pathname === "/v1/board/export") {
      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return json(await env.BOARD.getByName(BOARD).exportBoard(identity));
    }
    if (url.pathname === "/v1/board/import") {
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

    // The dashboard is for the owner only; laptops get the socket and nothing else.
    if (identity.kind !== "owner") return new Response("Not found", { status: 404 });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const asset = await env.ASSETS.fetch(req);
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    res.headers.set("content-security-policy", csp(url.host));
    return res;
  },
} satisfies ExportedHandler<Env>;
