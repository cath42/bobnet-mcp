import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ServerFrame } from "@bobnet/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsClient, WebSocketServer } from "ws";
import { BOARD_TOOLS, fitHandoff } from "../src/board-tools.ts";
import { CaptureQueue, type CaptureSend } from "../src/capture-queue.ts";
import { BrokerConnection, BrokerError } from "../src/connection.ts";
import type { Logger } from "../src/log.ts";
import { createServer } from "../src/server.ts";

// The board from an interactive agent (ADR 0001 §8, §12): the seven tools, the
// capture queue that never waits, and the 60 s wait for everything else.

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const WsImpl = WsClient as unknown as NonNullable<ConstructorParameters<typeof BrokerConnection>[0]["WebSocketImpl"]>;
const dir = () => mkdtempSync(join(tmpdir(), "bobnet-captures-"));
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const queued = (d: string) => readdirSync(d).filter((n) => n.endsWith(".json"));

/** A broker that answers registers, and board_op with what `board` says. */
function fakeBroker(board: (op: Record<string, unknown>) => { ok: unknown } | { code: string; message: string } = () => ({ ok: {} })) {
  const wss = new WebSocketServer({ port: 0 });
  const ops: Array<Record<string, unknown>> = [];
  const sockets = new Set<import("ws").WebSocket>();
  wss.on("connection", (ws) => {
    sockets.add(ws);
    const send = (f: ServerFrame) => ws.send(JSON.stringify(f));
    send({ t: "welcome", v: 1, identity: { kind: "laptop", laptop: "mbp-1" } });
    ws.on("message", (raw) => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      const rid = f["rid"] as string;
      if (f["t"] === "register") send({ t: "ok", rid, result: { address: `${f["name"]}@mbp-1`, queued: 0 } });
      if (f["t"] === "board_op") {
        ops.push(f);
        const r = board(f["op"] as Record<string, unknown>);
        if ("ok" in r) send({ t: "ok", rid, result: r.ok } as ServerFrame);
        else send({ t: "error", rid, code: r.code, message: r.message } as ServerFrame);
      }
    });
    ws.on("close", () => sockets.delete(ws));
  });
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    ops,
    close: () => new Promise<void>((r) => wss.close(() => r())),
  };
}

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

describe("the capture queue", () => {
  it("writes the capture first, and answers its id when the board takes it within two seconds", async () => {
    const d = dir();
    const sent: Array<{ as: string; id: string }> = [];
    const send: CaptureSend = async (as, op) => {
      sent.push({ as, id: op.capture_id });
      expect(queued(d)).toEqual([`${op.capture_id}.json`]);
      return { ref: "LAND-7", seq: 3, duplicate: false, dropped: [] };
    };
    const out = await new CaptureQueue(send, { dir: d }).capture("Luigi", { project: "helix", title: "Slow chart" });
    expect(out).toMatchObject({ ref: "LAND-7", queued: false, capture_id: sent[0]!.id });
    expect(sent[0]!.as).toBe("Luigi");
    expect(queued(d)).toEqual([]);
  });

  it("says queued when the board is away, and the next flush sends it under the same id", async () => {
    const d = dir();
    let up = false;
    const ids: string[] = [];
    const send: CaptureSend = async (_as, op) => {
      ids.push(op.capture_id);
      if (!up) throw new BrokerError("unavailable", "the board is unavailable since then; wait and retry");
      return { ref: "LAND-8", seq: 4, duplicate: false, dropped: [] };
    };
    const q = new CaptureQueue(send, { dir: d, answerMs: 50 });
    const out = await q.capture("Luigi", { project: "helix", title: "x" });
    expect(out).toEqual({ capture_id: expect.any(String), queued: true, message: "queued; it gets its id when the board is back" });
    expect(queued(d)).toHaveLength(1);

    up = true;
    // Only the process hosting the name it was captured as sends it.
    expect(await q.flush((n) => n === "Mario")).toEqual({ sent: 0, kept: 1 });
    expect(await q.flush((n) => n === "Luigi")).toEqual({ sent: 1, kept: 0 });
    expect(new Set(ids)).toEqual(new Set([out.capture_id]));
    expect(queued(d)).toEqual([]);
  });

  it("keeps what the board refuses in refused/, never dropping it in silence", async () => {
    const d = dir();
    const errors: string[] = [];
    const send: CaptureSend = async () => {
      throw new BrokerError("invalid", "No project hlix");
    };
    await expect(new CaptureQueue(send, { dir: d, onError: (m) => errors.push(m) }).capture("Luigi", { project: "hlix", title: "x" })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(queued(d)).toEqual([]);
    expect(readdirSync(join(d, "refused"))).toHaveLength(1);
    expect(errors).toEqual(["capture refused by the board"]);
  });
});

describe("a board operation while the broker is away", () => {
  it("waits, then fails saying since when the board is unavailable", async () => {
    const conn = new BrokerConnection({ url: "ws://127.0.0.1:9", credentials: { clientId: "x", clientSecret: "y" }, log: quiet, onPush() {}, WebSocketImpl: WsImpl });
    conn.start();
    cleanup.push(() => conn.stop());
    const t0 = Date.now();
    await expect(conn.boardOp("Luigi", { op: "projects" }, undefined, 200)).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringMatching(/^the board is unavailable since \d{4}-\d\d-\d\dT.*; wait and retry$/),
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
  });
});

describe("the board tools in the channel client", () => {
  async function session(board?: Parameters<typeof fakeBroker>[0], captureDir = dir()) {
    const broker = fakeBroker(board);
    cleanup.push(broker.close);
    const s = createServer({ url: broker.url, credentials: { clientId: "x", clientSecret: "y" }, log: quiet, WebSocketImpl: WsImpl, captureDir });
    s.connection.start();
    cleanup.push(() => s.connection.stop());
    await s.register({ name: "Luigi" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([s.server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
      return { isError: r.isError ?? false, text: r.content[0]!.text };
    };
    return { broker, client, call, captureDir };
  }

  it("lists the seven tools beside the messaging ones", async () => {
    const { client } = await session();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["board_list", "board_get", "board_capture", "board_write", "board_ask", "close_session", "board_grants"]));
    expect(BOARD_TOOLS).toHaveLength(7);
  });

  it("sends operations as the session's own name, with no ctx, and defaults the project to its only one", async () => {
    const { broker, call } = await session((op) => (op["op"] === "projects" ? { ok: { projects: [{ key: "helix" }] } } : { ok: { items: [], total: 0, cursor: null } }));
    await call("board_list", { of: "backlog" });
    expect(broker.ops.at(-1)).toMatchObject({ t: "board_op", as: "Luigi", op: { op: "list", project: "helix", of: "backlog" } });
    expect(broker.ops.at(-1)).not.toHaveProperty("ctx");
    await call("board_write", { project: "helix", op: "update", fields: { ref: "LAND-2", set: { status: "Done" } } });
    expect(broker.ops.at(-1)).toMatchObject({ op: { op: "update", project: "helix", ref: "LAND-2", set: { status: "Done" } } });
  });

  it("answers a refusal and a bad argument as errors naming why", async () => {
    const { call } = await session(() => ({ code: "forbidden", message: "Luigi may not change status on LAND-2 in helix; Picard may" }));
    expect(await call("board_write", { project: "helix", op: "update", fields: { ref: "LAND-2", set: { status: "Done" } } })).toEqual({
      isError: true,
      text: "forbidden: Luigi may not change status on LAND-2 in helix; Picard may",
    });
    const bad = await call("board_write", { project: "helix", op: "update", fields: { ref: "LAND-2", set: { status: "Blocked" } } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/bad_arguments: set.status/);
  });

  it("captures through the queue, and closes a session with its handoff's text", async () => {
    const { broker, call } = await session((op) => (op["op"] === "capture" ? { ok: { ref: "LAND-9", seq: 1, duplicate: false, dropped: [] } } : { ok: { ref: "x", seq: 2 } }));
    expect(JSON.parse((await call("board_capture", { project: "helix", title: "Slow", sentence: "The chart crawls." })).text)).toMatchObject({ ref: "LAND-9", queued: false });
    expect(broker.ops.at(-1)).toMatchObject({ op: { op: "capture", title: "Slow", description: "The chart crawls.", capture_id: expect.any(String) } });

    const handoff = join(dir(), "handoff.md");
    writeFileSync(handoff, "# Handoff\nAll done.");
    const s = { feature: "LAND-1", kind: "build", label: "1" };
    await call("close_session", { project: "helix", session: s, need: "none", summary: "Built", handoff });
    expect(broker.ops.at(-1)).toMatchObject({ op: { op: "close_session", session: s, handoff: { path: handoff, text: "# Handoff\nAll done." } } });
    writeFileSync(handoff, "token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH");
    expect((await call("close_session", { project: "helix", session: s, need: "none", summary: "Built", handoff })).text).toMatch(/secret_detected/);
  });

  it("flushes captures made while the broker was away once it is back", async () => {
    const captureDir = dir();
    let up = false;
    const { broker, call } = await session((op) => (up ? { ok: { ref: "LAND-3", seq: 1, duplicate: false, dropped: [] } } : { code: "unavailable", message: `board down (${String(op["op"])})` }), captureDir);
    expect(JSON.parse((await call("board_capture", { project: "helix", title: "Later" })).text)).toMatchObject({ queued: true });
    expect(queued(captureDir)).toHaveLength(1);
    up = true;
    // A reconnect flushes: here, a fresh session of the same name over the same folder.
    await session(() => ({ ok: { ref: "LAND-3", seq: 1, duplicate: false, dropped: [] } }), captureDir);
    await until(() => queued(captureDir).length === 0);
    expect(existsSync(join(captureDir, "refused"))).toBe(false);
    expect(broker.ops.filter((o) => (o["op"] as { op: string }).op === "capture")).toHaveLength(1);
  });
});

it("cuts a handoff that won't fit a frame at its end, and says so", () => {
  const big = "x".repeat(70_000);
  const cut = fitHandoff(big);
  expect(Buffer.byteLength(JSON.stringify(cut))).toBeLessThanOrEqual(56 * 1024);
  expect(cut).toMatch(/cut here/);
  expect(fitHandoff("short")).toBe("short");
});
