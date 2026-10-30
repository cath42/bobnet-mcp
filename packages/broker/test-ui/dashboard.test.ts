import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const html = readFileSync(join(import.meta.dirname, "../public/index.html"), "utf8");

/** Stands in for the browser WebSocket; the test plays the broker. */
class FakeSocket extends EventTarget {
  static last: FakeSocket;
  static readonly OPEN = 1;
  readyState = 1;
  readonly sent: Array<Record<string, unknown>> = [];
  constructor(readonly url: string) {
    super();
    FakeSocket.last = this;
  }
  send(data: string): void {
    if (data !== '{"t":"ping"}') this.sent.push(JSON.parse(data));
  }
  close(): void {}
  frame(f: unknown): void {
    this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(f) }));
  }
}

const now = new Date();
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();
const tokens = (input: number) => ({ input, output: 100, cache_read: 0, cache_write: 0 });

const dashboard = {
  peers: [
    { address: "Orchestrator@mbp-1", name: "Orchestrator", laptop: "mbp-1", team: "sandbox", purpose: null, expertise: [], status: "running story 3", online: true, last_seen: iso(1), connected_at: iso(30), stats: { sent_24h: 2, received_24h: 5, inbox: 0 } },
    { address: "Writer@mbp-1", name: "Writer", laptop: "mbp-1", team: "sandbox", purpose: null, expertise: [], status: null, online: false, last_seen: iso(60), connected_at: null, stats: { sent_24h: 0, received_24h: 1, inbox: 1 } },
  ],
  laptops: [
    {
      laptop: "mbp-1",
      at: iso(0),
      snapshot: {
        supervisor: { started_at: iso(120), concurrency: 3, active: 0, queued: 0 },
        workers: [
          { id: "w_1", name: "Writer", project: "sandbox", role: "writer", state: "done", task: "Write a <b>haiku</b>", checkpoint: "haiku written", started_at: iso(10), ended_at: iso(9), last_event_at: iso(9), tokens: tokens(1500), cost_usd: 0.12 },
        ],
        pending: [],
        usage: [{ day: now.toISOString().slice(0, 10), project: "sandbox", role: "writer", workers: 1, tokens: tokens(1500), cost_usd: 0.12 }],
      },
    },
  ],
  updates: [{ seq: 1, from: "Orchestrator@mbp-1", laptop: "mbp-1", text: "Writer done, reviewer next", at: iso(8) }],
  traffic: [{ id: "m_1", type: "message", from: "supervisor@mbp-1", to: ["Orchestrator@mbp-1"], urgent: false, at: iso(9) }],
};

const $ = (id: string) => document.getElementById(id)!;

beforeAll(async () => {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>|<link[^>]*>/g, "");
  (globalThis as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
  await import("../public/app.js");
  const ws = FakeSocket.last;
  ws.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
  const req = ws.sent.find((f) => f["t"] === "dashboard")!;
  ws.frame({ t: "ok", rid: req["rid"], result: dashboard });
});

describe("dashboard page", () => {
  it("connects to its own host and shows live once rendered", () => {
    expect(FakeSocket.last.url).toMatch(/\/v1\/ws$/);
    expect($("conn").dataset["state"]).toBe("live");
  });

  it("lists agents with status, uptime, counts and inbox", () => {
    const rows = [...$("agents").querySelectorAll("tbody tr")].map((r) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Orchestrator@mbp-1");
    expect(rows[0]).toContain("running story 3");
    expect(rows[0]).toContain("5 / 2");
    expect(rows[1]).toContain("Writer@mbp-1");
    expect(rows[1]).toContain("last seen");
    expect($("agents-count").textContent).toBe("1 online of 2");
  });

  it("shows ended workers with tokens and cost, and renders agent text as text", () => {
    expect($("workers").textContent).toContain("No workers running.");
    expect($("ended-wrap").hidden).toBe(false);
    const card = $("ended").textContent!;
    expect(card).toContain("Writer");
    expect(card).toContain("haiku written");
    expect(card).toContain("1.6k tokens");
    expect(card).toContain("$0.12");
    expect($("ended").querySelector("b")).toBeNull();
    expect(card).toContain("Write a <b>haiku</b>");
  });

  it("shows usage, the feeds and the laptop", () => {
    expect($("usage-totals").textContent).toContain("$0.12");
    expect($("usage").textContent).toContain("sandbox / writer");
    expect($("updates").textContent).toContain("Writer done, reviewer next");
    expect($("traffic").textContent).toContain("supervisor@mbp-1 → Orchestrator@mbp-1");
    expect($("laptops").textContent).toContain("0 of 3 slots busy");
  });

  it("applies live frames", () => {
    const ws = FakeSocket.last;
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers.push({ id: "w_2", name: "Reviewer", project: "sandbox", role: "reviewer", state: "waiting-approval", task: "Review haiku", checkpoint: null, started_at: iso(1), ended_at: null, last_event_at: iso(0), tokens: tokens(200), cost_usd: 0 });
    snap.pending.push({ id: "r_1", worker_id: "w_2", name: "Reviewer", kind: "approval", tool: "Bash", tier: "human", created_at: iso(0) } as never);
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    expect($("workers").textContent).toContain("Reviewer");
    expect($("workers").textContent).toContain("waiting-approval");
    expect($("needs").hidden).toBe(false);
    expect($("needs-list").textContent).toContain("Reviewer wants Bash");
    expect($("needs-list").textContent).toContain("needs you");

    ws.frame({ t: "update", item: { seq: 2, from: "Orchestrator@mbp-1", laptop: "mbp-1", text: "Review started", at: iso(0) } });
    expect($("updates").firstElementChild!.textContent).toContain("Review started");

    ws.frame({ t: "presence", event: "joined", peer: { ...dashboard.peers[1], online: true, status: "reviewing" } });
    expect($("agents-count").textContent).toBe("2 online of 2");
  });
});
