import { PING, PONG, type ServerFrame } from "@bobnet/protocol";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsClient, WebSocketServer } from "ws";
import { BrokerConnection, type PushFrame } from "../src/connection.ts";
import type { Logger } from "../src/log.ts";

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** A minimal stand-in broker: answers register/peers, records frames, can drop sockets. */
function fakeBroker() {
  const wss = new WebSocketServer({ port: 0 });
  const frames: Array<Record<string, unknown>> = [];
  const headers: Array<Record<string, string | string[] | undefined>> = [];
  const sockets = new Set<import("ws").WebSocket>();
  wss.on("connection", (ws, req) => {
    sockets.add(ws);
    headers.push(req.headers);
    const send = (f: ServerFrame) => ws.send(JSON.stringify(f));
    send({ t: "welcome", v: 1, identity: { kind: "laptop", laptop: "mbp-1" } });
    ws.on("message", (raw) => {
      const data = raw.toString();
      if (data === PING) return ws.send(PONG);
      const f = JSON.parse(data) as Record<string, unknown>;
      frames.push(f);
      if (f["t"] === "register") send({ t: "ok", rid: f["rid"] as string, result: { address: `${f["name"]}@mbp-1`, queued: 0 } });
      if (f["t"] === "peers") send({ t: "ok", rid: f["rid"] as string, result: { peers: [] } });
      if (f["t"] === "send") send({ t: "error", rid: f["rid"] as string, code: "unknown_peer", message: "No such peer: X" });
    });
    ws.on("close", () => sockets.delete(ws));
  });
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  return {
    url,
    frames,
    headers,
    pushAll: (f: ServerFrame) => sockets.forEach((s) => s.send(JSON.stringify(f))),
    dropAll: () => sockets.forEach((s) => s.terminate()),
    close: () => new Promise<void>((r) => wss.close(() => r())),
  };
}

const WsImpl = WsClient as unknown as NonNullable<ConstructorParameters<typeof BrokerConnection>[0]["WebSocketImpl"]>;
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

function connect(url: string, pushes: PushFrame[] = []) {
  const c = new BrokerConnection({
    url,
    credentials: { clientId: "id.access", clientSecret: "s3cret" },
    log: quiet,
    onPush: (f) => pushes.push(f),
    WebSocketImpl: WsImpl,
  });
  c.start();
  cleanup.push(() => c.stop());
  return c;
}

describe("BrokerConnection", () => {
  it("sends the Access service-token headers", async () => {
    const b = fakeBroker();
    cleanup.push(b.close);
    const c = connect(b.url);
    await c.request({ t: "peers" });
    expect(b.headers[0]).toMatchObject({ "cf-access-client-id": "id.access", "cf-access-client-secret": "s3cret" });
    expect(c.currentLaptop).toBe("mbp-1");
  });

  it("resolves ok results and rejects broker errors with their code", async () => {
    const b = fakeBroker();
    cleanup.push(b.close);
    const c = connect(b.url);
    await expect(c.register({ name: "Mario", team: "bobnet" })).resolves.toEqual({ address: "Mario@mbp-1", queued: 0 });
    await expect(c.request({ t: "send", as: "Mario", to: ["X"], body: "hi" })).rejects.toMatchObject({ code: "unknown_peer" });
  });

  it("hands deliveries and presence to onPush", async () => {
    const b = fakeBroker();
    cleanup.push(b.close);
    const pushes: PushFrame[] = [];
    const c = connect(b.url, pushes);
    await c.request({ t: "peers" });
    b.pushAll({ t: "presence", event: "left", peer: { address: "a@b", name: "a", laptop: "b", team: null, purpose: null, expertise: [], status: null, online: false, last_seen: "" } });
    await until(() => pushes.length === 1);
    expect(pushes[0]!.t).toBe("presence");
  });

  it("reconnects after a drop and registers again", async () => {
    const b = fakeBroker();
    cleanup.push(b.close);
    const c = connect(b.url);
    await c.register({ name: "Mario", team: "bobnet" });
    b.dropAll();
    await until(() => b.frames.filter((f) => f["t"] === "register").length === 2, 5000);
    expect(b.frames.filter((f) => f["t"] === "register").at(-1)).toMatchObject({ name: "Mario", team: "bobnet" });
    await expect(c.request({ t: "peers" })).resolves.toEqual({ peers: [] });
  });

  it("does not re-register after deregistering", async () => {
    const b = fakeBroker();
    cleanup.push(b.close);
    const c = connect(b.url);
    await c.register({ name: "Mario" });
    b.frames.length = 0;
    // The fake doesn't answer deregister; the client still forgets the identity once it's sent.
    void c.deregister("Mario").catch(() => {});
    await until(() => b.frames.some((f) => f["t"] === "deregister"));
    b.dropAll();
    await new Promise((r) => setTimeout(r, 1500));
    expect(b.frames.some((f) => f["t"] === "register")).toBe(false);
  });
});
