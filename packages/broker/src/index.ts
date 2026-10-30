import { authenticate } from "./auth.ts";

export { Broker } from "./broker.ts";

// The whole network lives in one Durable Object: one user, low volume, and
// no cross-object routing for messages that cross teams.
const NETWORK = "network";

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/v1/ws") return new Response("Not found", { status: 404 });
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const identity = await authenticate(req, env);
    if (!identity) return new Response("Unauthorized", { status: 401 });

    // Browsers send Origin; only the broker's own UI may open an owner socket.
    const origin = req.headers.get("origin");
    if (identity.kind === "owner" && origin !== url.origin) {
      return new Response("Forbidden origin", { status: 403 });
    }

    // A fresh request, so nothing the client sent reaches the object except
    // the identity this Worker vouches for.
    const forwarded = new Request("https://broker.internal/connect", {
      headers: { upgrade: "websocket", "x-bobnet-identity": JSON.stringify(identity) },
    });
    return env.BROKER.getByName(NETWORK).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
