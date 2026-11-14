import { BrokerConnection, type ConnectionOptions, type PushFrame } from "@bobnet/client/connection";
import type { Logger } from "@bobnet/client/log";
import type { PeerInfo, ServerFrame } from "@bobnet/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { laptopToken, upgrade } from "./helpers.ts";

// The real client against the real broker: BOB-2's board_op tests build on this harness.

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };
type Deliver = Extract<ServerFrame, { t: "deliver" }>;

/**
 * Stands in for Cloudflare Access at the edge: takes the client's service-token
 * headers and opens the Worker's socket with that laptop's Access JWT.
 */
function accessEdge(jwts: Record<string, string>): NonNullable<ConnectionOptions["WebSocketImpl"]> {
  class EdgeSocket {
    private ws: WebSocket | null = null;
    private readonly listeners: Array<[string, EventListener]> = [];

    constructor(_url: string, init: { headers: Record<string, string> }) {
      const jwt = jwts[init.headers["CF-Access-Client-Id"] ?? ""] ?? null;
      void upgrade(jwt).then((res) => {
        if (!res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
        for (const [type, listener] of this.listeners) res.webSocket.addEventListener(type, listener);
        res.webSocket.accept();
        this.ws = res.webSocket;
      });
    }

    addEventListener(type: string, listener: EventListener): void {
      this.listeners.push([type, listener]);
      this.ws?.addEventListener(type, listener);
    }

    send(data: string): void {
      this.ws!.send(data);
    }

    close(code?: number, reason?: string): void {
      this.ws?.close(code, reason);
    }
  }
  return EdgeSocket as unknown as NonNullable<ConnectionOptions["WebSocketImpl"]>;
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

async function connect(laptop: 1 | 2, pushes: PushFrame[] = []): Promise<BrokerConnection> {
  const c = new BrokerConnection({
    url: "wss://bobnet.test/v1/ws",
    credentials: { clientId: `id-${laptop}.access`, clientSecret: "s3cret" },
    log: quiet,
    onPush: (f) => pushes.push(f),
    WebSocketImpl: accessEdge({ [`id-${laptop}.access`]: await laptopToken(laptop) }),
  });
  c.start();
  stops.push(() => c.stop());
  return c;
}

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("client to broker", () => {
  it("registers, sends and receives across laptops, and acks what it got", async () => {
    const billPushes: PushFrame[] = [];
    const bob = await connect(1);
    const bill = await connect(2, billPushes);
    await expect(bob.register({ name: "Bob", team: "land" })).resolves.toEqual({ address: "Bob@mbp-1", queued: 0 });
    await expect(bill.register({ name: "Bill", team: "land" })).resolves.toEqual({ address: "Bill@mbp-2", queued: 0 });
    expect(bob.currentLaptop).toBe("mbp-1");

    const sent = await bob.request<{ id: string; delivered_to: string[] }>({ t: "send", as: "Bob", to: ["Bill@mbp-2"], body: "LAND-41.18 is yours" });
    expect(sent.delivered_to).toEqual(["Bill@mbp-2"]);
    await until(() => billPushes.some((f) => f.t === "deliver"));
    const got = billPushes.find((f): f is Deliver => f.t === "deliver")!;
    expect(got).toMatchObject({ to: "Bill@mbp-2", wake: true, msg: { id: sent.id, from: "Bob@mbp-1", body: "LAND-41.18 is yours" } });

    bill.sendRaw({ t: "ack", as: "Bill", ids: [sent.id] });
    bill.stop();
    const again = await connect(2);
    await expect(again.register({ name: "Bill", team: "land" })).resolves.toMatchObject({ queued: 0 });
  });

  it("tells the broker which client it is", async () => {
    const bob = await connect(1);
    await bob.register({ name: "Bob" });
    const { peers } = await bob.request<{ peers: PeerInfo[] }>({ t: "peers" });
    expect(peers[0]!.client).toMatchObject({ package: "@bobnet/client", protocol: 1 });
  });

  it("says the broker is older than this client for a frame it doesn't know", async () => {
    const bob = await connect(1);
    await bob.register({ name: "Bob" });
    await expect(bob.request({ t: "board_op", as: "Bob" } as never)).rejects.toMatchObject({
      code: "unsupported",
      message: "the broker doesn't know board_op; it is older than this client",
    });
  });
});
