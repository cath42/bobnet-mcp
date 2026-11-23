import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
/** Live frames re-render after a short debounce. */
const settle = () => new Promise((r) => setTimeout(r, 320));

const worker = (over: Record<string, unknown>) => ({
  id: "w_1", name: "records-agent", project: "helix", role: "records", state: "running", task: "Bob's brief, LAND-41 build 3. Your task: LAND-41.18",
  model: "opus", effort: "high", checkpoint: "tracts take update items", started_at: iso(25), ended_at: null, last_event_at: iso(0),
  tokens: tokens(1_500_000), cost_usd: 0, session: "LAND-41 build 3", task_ref: "LAND-41.18", calls: 3, context: 61000, ctx: [30000, 45000, 61000], ...over,
});

const item = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, title: `${id} title`, status, type: "task", parent: id.includes(".") ? id.split(".")[0] : null, milestone: "m-2", assignee: [], labels: [], deps: [], desc: null, ac: [], ...over,
});

const board = {
  project: "helix",
  ref: "1b8c34f4aa00",
  backlog: {
    milestones: [{ id: "m-2", title: "R1 Partner demo" }, { id: "m-3", title: "R2 Write path" }],
    items: [
      item("LAND-40", "Done", { type: "increment", title: "Build and CI" }),
      item("LAND-41", "Ready", { type: "increment", title: "An agent proposes changes to recorded records", desc: "R1 increment 7c.", ac: [[false, "An agent proposes a change (e2e)"]] }),
      item("LAND-41.1", "In Review", { labels: ["build:design"], title: "ADR: changing a recorded record" }),
      item("LAND-41.16", "Ready", { labels: ["build:3"], title: "changesets: update items" }),
      item("LAND-41.18", "Ready", { title: "land: tracts take updates", assignee: ["records-agent"], deps: ["LAND-41.16"] }),
      item("LAND-41.20", "Ready", { labels: ["build:4"], title: "leases take updates", deps: ["LAND-41.16"] }),
      item("LAND-42", "Draft", { type: "increment", title: "Demo polish" }),
    ],
    done_counts: { "LAND-40": 12 },
    drafts: [{ id: "DRAFT-1", title: "An <i>idea</i>", updated: "2026-10-31 09:00" }],
  },
  sessions: [
    { name: "LAND-41 design", kind: "design", started_at: iso(900), ended_at: iso(800), workers: 4, calls: 200, tokens: tokens(80_000_000) },
    { name: "LAND-41 build 2", kind: "build", started_at: iso(400), ended_at: iso(300), workers: 3, calls: 120, tokens: tokens(20_000_000) },
    { name: "LAND-41 build 3", kind: "build", started_at: iso(200), ended_at: null, workers: 2, calls: 90, tokens: tokens(40_000_000) },
  ],
  runs: [
    { id: "w_0", name: "changesets-agent", role: "changesets", session: "LAND-41 build 3", task_ref: "LAND-41.16", model: "opus", effort: "high", started_at: iso(190), ended_at: iso(120), resumed: false, tokens: 30_000_000, ctx: [30000, 90000, 200000, 360000] },
    { id: "w_p", name: "records-agent", role: "records", session: "LAND-41 build 2", task_ref: "LAND-41.17", model: "opus", effort: "high", started_at: iso(390), ended_at: iso(350), resumed: false, tokens: 9_000_000, ctx: [29000, 50000] },
  ],
  baseline: { runs: 9, p25: [25000, 30000], p50: [30000, 40000], p75: [35000, 55000] },
  commits: [{ sha: "ae54c540", at: iso(60), author: "records-agent", subject: "LAND-41.18: land: tracts and their geometry take updates" }],
  ci: [{ name: "ci", status: "in_progress", conclusion: null, created_at: iso(5), sha: "437577e9aa00" }],
};

const dashboard = {
  peers: [
    { address: "Bob@mbp-1", name: "Bob", laptop: "mbp-1", team: "land", purpose: null, expertise: [], status: "running build 3", online: true, last_seen: iso(1), connected_at: iso(30), client: { package: "@bobnet/supervisor", version: "0.2.0", protocol: 1 }, stats: { sent_24h: 2, received_24h: 5, inbox: 0 } },
    { address: "Riker@mbp-1", name: "Riker", laptop: "mbp-1", team: "land", purpose: null, expertise: [], status: null, online: false, last_seen: iso(60), connected_at: null, client: null, stats: { sent_24h: 0, received_24h: 1, inbox: 1 } },
  ],
  laptops: [
    {
      laptop: "mbp-1",
      at: iso(0),
      snapshot: {
        supervisor: { started_at: iso(120), concurrency: 3, active: 1, queued: 0 },
        workers: [
          worker({}),
          worker({ id: "w_9", name: "Writer", project: "sandbox", role: "writer", state: "done", task: "Write a <b>haiku</b>", session: null, task_ref: null, checkpoint: "haiku written", started_at: iso(10), ended_at: iso(9), calls: 0, context: null, ctx: [] }),
        ],
        pending: [],
        usage: [],
      },
    },
  ],
  boards: [{ laptop: "mbp-1", at: iso(1), board }],
  updates: [{ seq: 1, from: "Bob@mbp-1", laptop: "mbp-1", text: "LAND-41.18 · started", at: iso(8) }],
  traffic: [{ id: "m_1", type: "message", from: "supervisor@mbp-1", to: ["Bob@mbp-1"], urgent: false, at: iso(9) }],
};

const HELIX = { key: "helix", name: "helix", prefix: "LAND", draft_prefix: null, lead: "Bob@mbp-1", po: "Picard@mbp-1", repos: [] };

const $ = (id: string) => document.getElementById(id)!;
const view = () => $("view");
const go = async (hash: string) => {
  location.hash = hash;
  window.dispatchEvent(new Event("hashchange"));
  await settle();
};

/** The page that is open: what it listens to and what ticks in it, let go when a fresh one opens. */
const page = { timers: [] as ReturnType<typeof setInterval>[], listeners: [] as Array<[string, EventListener]> };
/** The dashboard loaded again, over a new socket, as a reload does: the one before it stops. */
const freshPage = async () => {
  await settle();
  for (const t of page.timers.splice(0)) clearInterval(t);
  for (const [type, f] of page.listeners.splice(0)) window.removeEventListener(type, f);
  vi.resetModules();
  const every = globalThis.setInterval, listen = window.addEventListener.bind(window);
  globalThis.setInterval = ((...a: Parameters<typeof setInterval>) => { const t = every(...a); page.timers.push(t); return t; }) as typeof setInterval;
  window.addEventListener = ((type: string, f: EventListener) => { page.listeners.push([type, f]); listen(type, f); }) as typeof window.addEventListener;
  try {
    return await import("../public/app.js");
  } finally {
    globalThis.setInterval = every;
    window.addEventListener = listen;
  }
};

beforeAll(async () => {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>|<link[^>]*>/g, "");
  (globalThis as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
  await freshPage();
  const ws = FakeSocket.last;
  ws.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
  const req = ws.sent.find((f) => f["t"] === "dashboard")!;
  // As the broker answers from ADR 0012 on: no boards in the reply, then one frame each.
  ws.frame({ t: "ok", rid: req["rid"], result: { ...dashboard, boards: [] } });
  for (const b of dashboard.boards) ws.frame({ t: "board", ...b });
  // The service's list, which every board drawn is of (ADR 0012 §2): helix is in it.
  const projects = ws.sent.find((f) => (f["op"] as { op?: string } | undefined)?.op === "projects")!;
  ws.frame({ t: "ok", rid: projects["rid"], result: { projects: [HELIX] } });
});

describe("Now's parts on the Overview (BOB-5 as built 3)", () => {
  beforeAll(() => go("#now"));

  it("connects to its own host, shows live once rendered, and opens the Overview on #now, Now gone from the tabs", () => {
    expect(FakeSocket.last.url).toMatch(/\/v1\/ws$/);
    expect($("conn").dataset["state"]).toBe("live");
    expect([...$("tabs").querySelectorAll("a")].map((a) => a.textContent!.replace(/\d+$/, "").trim())).toEqual(["Overview", "Needs you", "Status", "Roadmap", "Features", "Triage", "Usage"]);
    expect($("tabs").querySelector("[aria-current]")!.getAttribute("href")).toBe("#overview");
    expect($("working").textContent).toContain("records-agent");
    expect(view().textContent).not.toMatch(/\$\d/);
  });

  it("shows a refused action and re-enables its button", async () => {
    const ws = FakeSocket.last;
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers[0] = worker({ state: "waiting-approval" });
    snap.pending.push({ id: "r_9", worker_id: "w_1", name: "records-agent", kind: "approval", tool: "Bash", tier: "human", created_at: iso(0), preview: "git push origin HEAD:main" } as never);
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    await settle();
    ($("needs").querySelector(".answer-btn") as HTMLButtonElement).click();
    const deny = [...view().querySelectorAll("form.answer button")].find((b) => b.textContent === "Deny") as HTMLButtonElement;
    deny.click();
    const rid = ws.sent.at(-1)!["rid"];
    ws.frame({ t: "error", rid, code: "offline", message: "No supervisor is online on mbp-1" });
    expect($("toast").textContent).toBe("No supervisor is online on mbp-1");
    expect($("toast").dataset["ok"]).toBe("false");
    expect(deny.disabled).toBe(false);
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    await settle();
  });
});

describe("Feature", () => {
  it("shows the current build's feature by session, with agents on their tasks", async () => {
    await go("#feature");
    const text = view().textContent!;
    expect(text).toContain("An agent proposes changes to recorded records");
    const lanes = [...view().querySelectorAll(".lane-h b")].map((b) => b.textContent);
    // Labels place 41.1, 41.16 and 41.20; the build 3 worker's brief places 41.18.
    expect(lanes).toEqual(["Design", "Build 3", "Build 4"]);
    const card = view().querySelector('[data-id="LAND-41.18"]')!;
    expect(card.classList.contains("live")).toBe(true);
    expect(card.textContent).toContain("records-agent");
    expect(card.textContent).toContain("board says Ready until the session closes");
    // The design lane is all built and folded.
    expect(view().querySelector('[data-id="LAND-41.1"]')).toBeNull();
  });

  it("opens a task's details on click and keeps them across a re-render", async () => {
    const card = view().querySelector('[data-id="LAND-41.20"]') as HTMLElement;
    expect(card.getAttribute("aria-expanded")).toBe("false");
    card.click();
    await settle();
    const again = view().querySelector('[data-id="LAND-41.20"]')!;
    expect(again.getAttribute("aria-expanded")).toBe("true");
    expect(again.textContent).toContain("waits on 41.16");
  });
});

describe("Roadmap", () => {
  it("puts features in columns by where they stand, agents on their feature, accepted ones folded", async () => {
    await go("#roadmap");
    // Below desktop width (the test window is 1024px), empty columns are left out.
    const cols = [...view().querySelectorAll(".col-h")].map((c) => c.textContent);
    expect(cols).toEqual(["Shaping1", "Building1", "Accepted1"]);
    const building = view().querySelectorAll(".col")[1]!;
    expect(building.textContent).toContain("LAND-41");
    expect(building.textContent).toContain("records-agent");
    expect(view().textContent).toContain("Show all 1");
    expect(view().textContent).toContain("Drafts, not yet placed 1");
    expect(view().querySelector(".feed i")).toBeNull();
  });

  it("opens a feature's board from its card", async () => {
    (view().querySelector(".col .kc") as HTMLElement).click();
    await settle();
    expect(location.hash).toBe("#feature");
    expect((view().querySelector("#inc-pick") as HTMLSelectElement).value).toBe("LAND-42");
  });
});

describe("Laptops (BOB-175)", () => {
  it("has the laptops, the agents, the rules and the message log folded; no session updates nor ended workers", async () => {
    await go("#laptops");
    expect([...view().querySelectorAll("h2")].map((x) => x.textContent!.replace(/ \d.*$/, "").trim())).toEqual(["Laptops", "Agents", "Rules for every project", "Make an agent global admin"]);
    const messages = view().querySelector("details.msgs") as HTMLDetailsElement;
    expect(messages.open).toBe(false);
    expect(messages.querySelector("summary")!.textContent).toBe("Messages in the last 24 hours 1");
    expect($("traffic").textContent).toContain("supervisor@mbp-1 → Bob@mbp-1");
    expect($("laptops").textContent).toContain("1 of 3 slots busy");
    expect($("laptops").textContent).toContain("supervisor 0.2.0");
    expect($("agents-count").textContent).toBe("1 online of 2");
    const rows = [...$("agents").querySelectorAll("tbody tr")].map((r) => r.querySelector(".client")?.textContent);
    expect(rows).toEqual(["supervisor 0.2.0 · protocol 1", "client version unknown"]);
    expect([...$("agents").querySelectorAll("tbody tr")].map((r) => r.children[1]!.textContent)).toEqual(["running build 3", "last seen 1h 0m ago"]);
    // Dropped (spec 2.11), and the haiku's writer, ended, is on no card.
    expect(view().textContent).not.toMatch(/Session updates|Workers ended|haiku/);
    // An update still arrives from an agent's status; the page has no list of them.
    FakeSocket.last.frame({ t: "update", item: { seq: 2, from: "Bob@mbp-1", laptop: "mbp-1", text: "LAND-41.16 · landed", at: iso(0) } });
    await settle();
    expect(view().textContent).not.toContain("landed");
  });

  it("keeps the message log open across a redraw, and takes messages as they come", async () => {
    const messages = () => view().querySelector("details.msgs") as HTMLDetailsElement;
    messages().open = true;
    messages().dispatchEvent(new Event("toggle"));
    FakeSocket.last.frame({ t: "traffic", item: { id: "m_2", type: "message", from: "Bob@mbp-1", to: ["Riker@mbp-1"], urgent: true, at: iso(0) } });
    await settle();
    expect(messages().open).toBe(true);
    expect($("traffic").children[0]!.textContent).toContain("Bob@mbp-1 → Riker@mbp-1 (urgent)");
    expect(messages().querySelector("summary")!.textContent).toBe("Messages in the last 24 hours 2");
    messages().open = false;
    messages().dispatchEvent(new Event("toggle"));
  });

  it("is where the header's connection and a quiet laptop's banner lead (c3)", async () => {
    const heartbeat = (snapshot: unknown = dashboard.laptops[0]!.snapshot) => FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot });
    FakeSocket.last.frame({ t: "report", laptop: "mbp-2", at: iso(10), snapshot: { supervisor: { started_at: iso(900), concurrency: 2, active: 0, queued: 0 }, workers: [], pending: [], usage: [] } });
    heartbeat();
    await go("#overview");
    for (const a of [$("conn"), view().querySelector(".stale-banners a")!]) {
      expect(a.getAttribute("href")).toBe("#laptops");
      await go(a.getAttribute("href")!);
      expect($("laptops")).not.toBeNull();
      await go("#overview");
    }
    await go("#laptops");
  });

  it("marks a laptop that stopped reporting and never offers its last requests (BOB-26)", async () => {
    const ws = FakeSocket.last;
    const old = { id: "r_old", worker_id: "w_gone", name: "Luigi", kind: "approval", tool: "Bash", tier: "human", created_at: iso(600), preview: "rm -rf dist" };
    // Its last report came 10 min ago, by the broker's clock: mbp-1's heartbeat since says what time it is now.
    const heartbeat = () => ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    ws.frame({ t: "report", laptop: "mbp-2", at: iso(10), snapshot: { supervisor: { started_at: iso(900), concurrency: 2, active: 0, queued: 0 }, workers: [worker({ id: "w_gone", name: "Luigi", project: "bobnet" })], pending: [old], usage: [] } });
    heartbeat();
    await settle();
    const card = [...$("laptops").children].find((c) => c.textContent!.includes("mbp-2"))!;
    expect(card.textContent).toContain("no recent report");
    expect(card.textContent).toContain("1 request waits until it reports again");
    await go("#needs");
    expect(view().querySelector('[data-ref="r_old"]')).toBeNull();
    await go("#overview");
    expect(view().textContent).not.toContain("rm -rf dist");
    // Not dropped silently: a banner names the laptop (design/BOB-48/spec.md §1).
    expect(view().querySelector(".stale-banners .banner")!.textContent).toBe("mbp-2 stopped reportinglast report 10m ago1 request for you from it waits until it reports againLaptops →");
    // Reporting again makes it live: its requests are offered.
    ws.frame({ t: "report", laptop: "mbp-2", at: iso(0), snapshot: { supervisor: { started_at: iso(900), concurrency: 2, active: 0, queued: 0 }, workers: [worker({ id: "w_gone", name: "Luigi", project: "bobnet" })], pending: [old], usage: [] } });
    await settle();
    await go("#needs");
    expect(view().querySelector('[data-ref="r_old"]')).not.toBeNull();
    ws.frame({ t: "report", laptop: "mbp-2", at: iso(10), snapshot: { supervisor: { started_at: iso(900), concurrency: 2, active: 0, queued: 0 }, workers: [], pending: [], usage: [] } });
    heartbeat();
    await settle();
    await go("#laptops");
  });

  it("judges a report's age by the broker's clock, not this device's (Toad, BOB-26 minor 6)", async () => {
    const ws = FakeSocket.last;
    const ask = { id: "r_skew", worker_id: "w_1", name: "records-agent", kind: "approval", tool: "Bash", tier: "human", created_at: iso(12), preview: "git status" };
    // This device runs 10 min ahead: the report the broker stamps now reads 10 min old here, and is live.
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(10), snapshot: { ...dashboard.laptops[0]!.snapshot, pending: [ask] } });
    await settle();
    await go("#needs");
    expect(view().querySelector('[data-ref="r_skew"]')).not.toBeNull();
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    await settle();
    await go("#laptops");
  });

  it("shows each laptop's last cleanup on its row: when, why, freed per project (unknown as such), failed and skipped steps; none yet (BOB-123 AC 6)", async () => {
    const ws = FakeSocket.last;
    const card = () => [...$("laptops").children].find((c) => c.querySelector(".name")!.textContent === "mbp-1")!;
    const line = () => card().querySelector(".cleanup")!;
    // An older supervisor's snapshot has no cleanup: it reads as none yet.
    expect(dashboard.laptops[0]!.snapshot).not.toHaveProperty("cleanup");
    expect(line().textContent).toBe("No cleanup yet");
    const cleanup = {
      at: iso(90), trigger: "floor", skipped: null, freed_bytes: 3_400_000_000,
      projects: [
        { project: "helix", freed_bytes: 3_100_000_000, steps: [{ step: "worktrees", ok: true, error: null, skipped: null, acted: 4, freed_bytes: 3_000_000_000 }, { step: "docker", ok: false, error: "timed out after 30 min", skipped: null, acted: 0, freed_bytes: null }] },
        { project: "bobnet", freed_bytes: null, steps: [{ step: "runner", ok: true, error: null, skipped: "a runner job is running from /Users/ct/actions-runner", acted: 0, freed_bytes: null }] },
      ],
      steps: [{ step: "logs", ok: true, error: null, skipped: null, acted: 12, freed_bytes: 300_000_000 }],
    };
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: { ...dashboard.laptops[0]!.snapshot, cleanup } });
    await settle();
    expect(line().querySelector(":scope > span")!.textContent).toBe("Last cleanup 1h 30m ago · disk low · freed 3.4 GB");
    expect([...line().querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "helix 3.1 GBdocker failed: timed out after 30 min",
      "bobnet unknownrunner skipped: a runner job is running from /Users/ct/actions-runner",
      "supervisor logs 300 MB",
    ]);
    expect(line().querySelector(".fail")!.textContent).toBe("docker failed: timed out after 30 min");
    expect(view().textContent).not.toMatch(/\$\d/);
    // A run that got no run slot says so.
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: { ...dashboard.laptops[0]!.snapshot, cleanup: { at: iso(5), trigger: "schedule", skipped: "busy", freed_bytes: null, projects: [], steps: [] } } });
    await settle();
    expect(line().textContent).toBe("Cleanup skipped · the run slot was busy · scheduled · 5m ago · it tries again at the next check");
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    await settle();
  });
});

describe("laptops that stopped reporting, dead requests and a stuck board outbox (BOB-48; design/BOB-48/spec.md)", () => {
  const snap = (pending: unknown[] = []) => ({ supervisor: { started_at: iso(900), concurrency: 2, active: 0, queued: 0 }, workers: pending.length ? [worker({})] : [], pending, usage: [] });
  const ask = (id: string, minAgo: number, tier = "human") => ({ id, worker_id: "w_1", name: "records-agent", kind: "approval", tool: "Bash", tier, created_at: iso(minAgo), preview: `${id} preview` });
  /** Each laptop's report, then mbp-1's, last: the latest report sets the broker's clock. */
  const reports = async (rs: Array<[string, number, unknown]>, mbp: Record<string, unknown> = {}) => {
    for (const [laptop, at, snapshot] of rs) FakeSocket.last.frame({ t: "report", laptop, at: iso(at), snapshot });
    FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: { ...dashboard.laptops[0]!.snapshot, ...mbp } });
    await settle();
  };
  const banners = () => [...view().querySelectorAll(".stale-banners .banner")];
  const card = (name: string) => [...$("laptops").children].find((c) => c.querySelector(".name")?.textContent === name)!;
  const DAY = 24 * 60;

  it("never shows, offers or counts a request over a day old, from a fresh laptop too (BOB-26; ADR 0012 §1)", async () => {
    await reports([], { pending: [ask("r_dead", DAY + 60), ask("r_live", 5)] });
    await go("#needs");
    expect(view().querySelector('[data-ref="r_live"]')).not.toBeNull();
    expect(view().querySelector('[data-ref="r_dead"]')).toBeNull();
    await go("#overview");
    expect($("needs").querySelector('li[data-id*="r_live"]')).not.toBeNull();
    expect($("needs").querySelector('li[data-id*="r_dead"]')).toBeNull();
    await reports([]);
  });

  it("shows a stale laptop's banner on Overview and Waits, counting only its requests for you under a day old (BOB-23 AC 3)", async () => {
    await reports([["mbp-2", 12, snap([ask("r_h", 30), ask("r_o", 30, "orchestrator"), ask("r_old", DAY + 5)])]]);
    for (const page of ["#overview", "#needs"]) {
      await go(page);
      expect(banners()).toHaveLength(1);
      const b = banners()[0]!;
      expect([...b.children].map((c) => c.textContent)).toEqual(["mbp-2 stopped reporting", "last report 12m ago", "1 request for you from it waits until it reports again", "Laptops →"]);
      expect(b.querySelector("b")).not.toBeNull();
      expect(b.querySelector("a")!.getAttribute("href")).toBe("#laptops");
      expect(b.querySelector("[data-ago]")!.getAttribute("data-ago")).toBe(iso(12));
      expect(b.getAttribute("title")).toMatch(/^No report from mbp-2's supervisor since .+\. Its requests are not offered here until it reports; nothing is lost\.$/);
    }
    // First on Overview, above Needs you.
    await go("#overview");
    expect(view().firstElementChild!.classList.contains("stale-banners")).toBe(true);
    // Its card: all tiers under a day, marked, never offered.
    await go("#laptops");
    expect(card("mbp-2").querySelector(".meta")!.textContent).toContain("2 requests wait until it reports again");
    // With none for you: no count, never "0".
    await reports([["mbp-2", 12, snap([ask("r_o", 30, "orchestrator")])]]);
    await go("#overview");
    expect(banners()[0]!.textContent).toBe("mbp-2 stopped reportinglast report 12m agoLaptops →");
  });

  it("draws two banners oldest report first, and one for three or more", async () => {
    await reports([["ubu1", 200, snap([ask("r_u", 60)])], ["mbp-2", 12, snap([ask("r_h", 30)])]]);
    await go("#overview");
    expect(banners().map((b) => b.querySelector("b")!.textContent)).toEqual(["ubu1 stopped reporting", "mbp-2 stopped reporting"]);
    await reports([["ubu1", 200, snap([ask("r_u", 60)])], ["mini", 40, snap()], ["mbp-2", 12, snap([ask("r_h", 30), ask("r_h2", 20)])]]);
    expect(banners()).toHaveLength(1);
    expect([...banners()[0]!.children].map((c) => c.textContent)).toEqual([
      "3 laptops stopped reporting",
      "ubu1 3h 20m · mini 40m · mbp-2 12m",
      "3 requests for you from them wait until they report again",
      "Laptops →",
    ]);
  });

  it("draws none while this page is cut off, nor for a report over a day old, which its card still marks", async () => {
    $("conn").dataset["state"] = "down";
    await go("#overview");
    expect(view().querySelector(".stale-banners")).toBeNull();
    $("conn").dataset["state"] = "live";
    await reports([["ubu1", DAY + 10, snap([ask("r_u", DAY + 60)])], ["mini", DAY + 10, snap()], ["mbp-2", DAY + 10, snap([ask("r_h", DAY + 30)])]]);
    await go("#overview");
    expect(view().querySelector(".stale-banners")).toBeNull();
    await go("#laptops");
    expect(card("mbp-2").querySelector(".badge")!.textContent).toBe("no recent report");
    expect(card("mbp-2").querySelector(".meta")!.textContent).not.toContain("wait");
  });

  it("shows a stuck board outbox on the Laptops card: at 6 min, not at 2, with its last error when there is one (BOB-28 AC 1)", async () => {
    await go("#laptops");
    const line = () => card("mbp-1").querySelector(".outbox");
    await reports([], { board_outbox: { count: 14, oldest_at: iso(2), code: "unavailable" } });
    expect(line()).toBeNull();
    await reports([], { board_outbox: { count: 14, oldest_at: iso(6), code: "unavailable" } });
    expect(line()!.textContent).toBe("Board reports stuck · 14 waiting · oldest 6m · last error unavailable");
    expect(line()!.querySelector("b")!.textContent).toBe("Board reports stuck");
    expect(line()!.getAttribute("title")).toMatch(/^This laptop's supervisor has board reports it couldn't send since .+\. It retries every minute; the board on the dashboard is behind until they go through\.$/);
    // After the meta row, before the cleanup line.
    expect(line()!.previousElementSibling!.classList.contains("meta")).toBe(true);
    expect(line()!.nextElementSibling!.classList.contains("cleanup")).toBe(true);
    await reports([], { board_outbox: { count: 3, oldest_at: iso(660), code: null } });
    expect(line()!.textContent).toBe("Board reports stuck · 3 waiting · oldest 11h 0m");
    // Empty, or an older supervisor's snapshot without the field: no line, never "0".
    await reports([], { board_outbox: { count: 0, oldest_at: null, code: null } });
    expect(line()).toBeNull();
    await reports([]);
    expect(dashboard.laptops[0]!.snapshot).not.toHaveProperty("board_outbox");
    expect(line()).toBeNull();
    expect($("laptops").textContent).not.toMatch(/\b0 waiting|\b0 requests/);
  });

  it("says so when no laptop has reported in 30 days, and a fresh reply clears the old boards before its frames", async () => {
    const reply = (result: unknown) => FakeSocket.last.frame({ t: "ok", rid: FakeSocket.last.sent.filter((f) => f["t"] === "dashboard").at(-1)!["rid"], result });
    reply({ ...dashboard, laptops: [], boards: [] });
    await settle();
    expect($("laptops").querySelector(".empty")!.textContent).toBe("No laptop has reported in the last 30 days.");
    await go("#roadmap");
    expect(view().textContent).not.toContain("Switch to a company");
    reply({ ...dashboard, boards: [] });
    for (const b of dashboard.boards) FakeSocket.last.frame({ t: "board", ...b });
    await settle();
    await go("#laptops");
    expect($("laptops").querySelector(".empty")).toBeNull();
  });
});

describe("a review session", () => {
  it("marks no build lane now", async () => {
    const ws = FakeSocket.last;
    const next = structuredClone(board);
    next.sessions.push({ name: "LAND-41 review", kind: "review", started_at: iso(30), ended_at: null, workers: 1, calls: 10, tokens: tokens(5_000_000) });
    next.runs.push({ id: "w_r", name: "Bill", role: "bill", session: "LAND-41 review", task_ref: "LAND-41.16", model: "opus", effort: "high", started_at: iso(30), ended_at: iso(10), resumed: false, tokens: 5_000_000, ctx: [30000, 70000] });
    ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board: next });
    await go("#feature");
    expect(view().querySelector(".lane-h .now")).toBeNull();
    ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board });
    await settle();
  });

  it("shows each agent on the items its spawn named, opening a finished build's lane while one is on it", async () => {
    const ws = FakeSocket.last;
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers = [
      worker({ id: "w_b", name: "Bill", role: "bill", task: "LAND-41 review 1", session: "LAND-41 review 1", task_ref: "LAND-41", task_refs: ["LAND-41"] }),
      worker({ id: "w_h", name: "Homer", role: "homer", task: "LAND-41 review 1: QUICK fix of R1-1", session: "LAND-41 review 1", task_ref: "LAND-41.1", task_refs: ["LAND-41.1", "LAND-41.16"] }),
    ] as never;
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    await go("#feature");
    const pick = $("inc-pick") as HTMLSelectElement;
    pick.value = "LAND-41";
    pick.dispatchEvent(new Event("change"));
    await settle();
    expect(view().textContent).toContain("2 agents on it now");
    expect(view().textContent).toContain("On the feature as a whole");
    // The design lane is all reviewed, so it would fold; Homer on 41.1 keeps it open.
    expect(view().querySelector('[data-id="LAND-41.1"] .agent')!.textContent).toContain("Homer");
    expect(view().querySelector('[data-id="LAND-41.16"] .agent')!.textContent).toContain("Homer");
    expect(view().querySelector('[data-id="LAND-41.18"] .agent')).toBeNull();
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    await settle();
  });
});

describe("build lanes", () => {
  it("follow the order their sessions started, labels as declared", async () => {
    const ws = FakeSocket.last;
    const next = structuredClone(board) as typeof board & { sessions: Array<Record<string, unknown>> };
    next.backlog.items.push(item("LAND-41.30", "Ready", { title: "a task of build A" }), item("LAND-41.31", "Ready", { title: "a task of build B" }));
    next.sessions.push(
      { name: "LAND-41 build A", kind: "build", started_at: iso(100), ended_at: iso(60), workers: 1, calls: 5, tokens: tokens(1_000_000) },
      { name: "LAND-41 build B", kind: "build", started_at: iso(50), ended_at: null, workers: 1, calls: 5, tokens: tokens(1_000_000) },
    );
    next.runs.push(
      { id: "w_b", name: "records-agent", role: "records", session: "LAND-41 build B", task_ref: "LAND-41.31", model: "opus", effort: "high", started_at: iso(50), ended_at: iso(40), resumed: false, tokens: 1, ctx: [1] },
      { id: "w_a", name: "records-agent", role: "records", session: "LAND-41 build A", task_ref: "LAND-41.30", model: "opus", effort: "high", started_at: iso(100), ended_at: iso(60), resumed: false, tokens: 1, ctx: [1] },
    );
    ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board: next });
    await go("#feature");
    const pick = $("inc-pick") as HTMLSelectElement;
    pick.value = "LAND-41";
    pick.dispatchEvent(new Event("change"));
    await settle();
    const titles = [...view().querySelectorAll(".lane-h b")].map((x) => x.textContent).filter((t) => /^Build/.test(t!));
    // Build 4 is only a build:4 label, no session yet: after them.
    expect(titles).toEqual(["Build 3", "Build A", "Build B", "Build 4"]);
    ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board });
    await settle();
  });
});

describe("live frames", () => {
  it("takes a new board", async () => {
    await go("#roadmap");
    const ws = FakeSocket.last;
    const next = structuredClone(board);
    next.backlog.items.push(item("LAND-43", "Draft", { type: "increment", title: "Switch to a company" }));
    ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board: next });
    await settle();
    expect(view().querySelectorAll(".col")[0]!.textContent).toContain("Switch to a company");
  });
});

describe("the roadmap from the board, and Casper's gates (BOB-7)", () => {
  const answered = new Set<unknown>();
  /** The board operations the page sent and the test hasn't answered, oldest first. */
  const pending = (name?: string) =>
    FakeSocket.last.sent.filter((f) => f["t"] === "board_op" && !answered.has(f["rid"]) && (!name || (f["op"] as { op: string }).op === name)) as Array<{ rid: string; key?: string; op: Record<string, unknown> }>;
  const reply = (f: { rid: string }, result: unknown) => {
    answered.add(f.rid);
    FakeSocket.last.frame({ t: "ok", rid: f.rid, result });
  };
  const refuse = (f: { rid: string }, message: string) => {
    answered.add(f.rid);
    FakeSocket.last.frame({ t: "error", rid: f.rid, code: "conflict", message });
  };

  const rel = (ref: string, title: string, status: string, done: number, total: number, over: Record<string, unknown> = {}) => ({
    ref, title, goal: null, status, ord: Number(ref.slice(1)), spec_url: null, closed_at: status === "closed" ? "2026-11-10T10:00:00.000Z" : null, closed_by: null,
    features: { done, total }, backlog: { items: 2, bugs: 1, oldest: iso(60 * 24 * 3) }, ...over,
  });
  const feat = (ref: string, release: string | null, status: string, over: Record<string, unknown> = {}) => ({
    ref, kind: "feature", type: "increment", status, title: `${ref} title`, parent: null, release, ord: 1000, labels: [], progress: { checked: 0, total: 0 },
    tasks: { done: 0, total: 0 }, open_since: null, archived_at: null, ...over,
  });
  const releases = [rel("R1", "R1 Central backlog view", "open", 5, 6), rel("R2", "R2 Start a session", "planned", 0, 1), rel("R3", "R3 Old", "closed", 1, 1)];
  const features = [
    ...["BOB-1", "BOB-2", "BOB-3", "BOB-4", "BOB-5"].map((r) => feat(r, "R1", "Done", { progress: { checked: 2, total: 2 } })),
    feat("BOB-7", "R1", "Ready", { title: "Who may write what", open_since: iso(30), progress: { checked: 3, total: 10 } }),
    feat("BOB-8", "R2", "Ready"),
    feat("BOB-6", "R3", "Done"),
    feat("BOB-20", null, "Draft", { ord: null }),
  ];
  const noRelease = { items: 3, bugs: 1, oldest: iso(60 * 24 * 5) };
  /** Answers every list the page is waiting on with the board above, and the project's overview row for its counts in no release. */
  const lists = async (rs = releases, fs = features, none: unknown = noRelease) => {
    for (const f of pending("list").filter((x) => x.op["of"] !== "tasks")) reply(f, f.op["of"] === "releases" ? { releases: rs, total: rs.length, cursor: null } : { items: fs, total: fs.length, cursor: null });
    for (const f of pending("overview").filter((x) => x.op["project"])) reply(f, { projects: [{ no_release: none }] });
    await settle();
  };
  const toastEl = () => $("toast");
  /** Answers the steps view's reads of a feature: the item with its history, its tasks (none here), its sessions (none). */
  const opened = async (fs = features) => {
    for (const f of pending("get")) {
      const x = fs.find((y) => y.ref === f.op["ref"]);
      if (x) reply(f, { item: { ...x, sessions: [], criteria: [], description: null }, history: [] });
      else { answered.add(f.rid); FakeSocket.last.frame({ t: "error", rid: f.rid, code: "invalid", message: `No item ${f.op["ref"]}` }); }
    }
    for (const f of pending("list").filter((x) => x.op["of"] === "tasks")) reply(f, { items: [], total: 0, cursor: null });
    for (const f of pending("waits")) reply(f, { waits: [], answered: [] });
    for (const f of pending("overview").filter((x) => !x.op["project"])) reply(f, { projects: [] });
    await settle();
  };

  it("reads the service's projects again when one it doesn't know changes, and draws a project that left nowhere, its board still here (ADR 0012 §2, BOB-193)", async () => {
    // The first read's, answered as the page connected.
    for (const f of pending("projects")) answered.add(f.rid);
    await go("#roadmap");
    expect(view().querySelector(".col-h")).not.toBeNull();
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 1, refs: [] });
    reply(pending("projects")[0]!, { projects: [{ key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] }] });
    await settle();
    expect(view().querySelector(".col-h")).toBeNull();
    expect([...view().querySelectorAll(".bar-row > b")].map((b) => b.textContent)).toEqual(["BobNet"]);
  });

  it("numbers releases and features in their order, folds done ones and a closed release, and puts features in no release last", async () => {
    await go("#roadmap/bobnet");
    expect(view().textContent).toContain("Reading the board…");
    await lists();
    const sections = [...view().querySelectorAll("section.release")];
    expect(sections.map((s) => s.querySelector(".rel-h b")!.textContent)).toEqual(["R1 Central backlog view", "R2 Start a session", "R3 Old", "Not in a release"]);
    expect(sections.map((s) => s.querySelector(".rel-h .n")?.textContent ?? null)).toEqual(["1", "2", "3", null]);
    const r1 = sections[0]!;
    expect(r1.textContent).toContain("5 of 6 features done");
    expect(r1.textContent).toContain("2 backlog items");
    expect(r1.querySelector("tr.fold")!.textContent).toBe("5 done (1–5): show them");
    const open = r1.querySelector("tr.is-open")!;
    expect(open.textContent).toContain("BOB-7");
    expect(open.textContent).toContain("open · nobody on it now");
    expect(open.textContent).toContain("3 of 10");
    expect(sections[2]!.querySelector(".badge")!.textContent).toBe("closed");
    expect(sections[2]!.textContent).toContain("Closed, folded: 1 feature. Show them");
    expect(sections[2]!.textContent).not.toContain("BOB-6");
    expect(sections[3]!.querySelector(".ord.unset")).not.toBeNull();
    // Nothing to change until Edit your gates.
    expect(view().querySelector("select.move")).toBeNull();
    expect(view().querySelector(".gate")).toBeNull();
    expect(view().querySelector(".gates-btn")!.textContent).toBe("Edit your gates");
  });

  it("links each feature, counts backlog items per release and in no release, each opening the triage list on it (BOB-3 #6)", async () => {
    const sections = [...view().querySelectorAll("section.release")];
    expect(sections[0]!.querySelector("tr.is-open a.id")!.getAttribute("href")).toBe("#feature/bobnet/BOB-7");
    expect(sections[0]!.querySelector(".counts-line")!.textContent).toBe("2 backlog items1 open bugoldest 3 days");
    const none = sections[3]!;
    expect(none.querySelector(".counts-line")!.textContent).toBe("3 backlog items1 open bugoldest 5 days");
    expect(none.querySelector(".counts-line a")!.getAttribute("href")).toBe("#triage/bobnet");
  });

  it("leaves the no-release counts line out when the board doesn't count it, and shows the section for items alone", async () => {
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 70, refs: [] });
    await lists(releases, features, null);
    expect(view().querySelector("#rel-none .counts-line")).toBeNull();
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 71, refs: [] });
    await lists(releases, features.filter((f) => f.release !== null));
    expect(view().querySelector("#rel-none")!.textContent).toContain("No features out of a release.");
    expect(view().querySelector("#rel-none .counts-line")!.textContent).toContain("3 backlog items");
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 72, refs: [] });
    await lists();
  });

  it("opens a feature in the service on its head card: release and number, state, criteria, tasks, who is on it", async () => {
    await go("#feature/bobnet/BOB-7");
    expect(view().textContent).toContain("Reading the board…");
    await opened();
    const head = $("feature-head");
    expect(head.classList.contains("is-open")).toBe(true);
    expect(head.textContent).toContain("BobNet · R1 Central backlog view · number 6");
    expect(head.querySelector("h2")!.textContent).toBe("Who may write what");
    expect(head.textContent).toContain("3 of 10 criteria");
    expect(head.textContent).toContain("nobody on it now");
    await go("#feature/bobnet/BOB-1");
    await opened();
    expect($("feature-head").textContent).toContain("2 of 2 criteria");
    await go("#feature/bobnet/BOB-99");
    await opened();
    expect(view().textContent).toBe("No feature BOB-99 in BobNet.");
    await go("#roadmap/bobnet");
  });

  it("shows a Done feature with unticked criteria as Done, its real count, and 'Done, criteria not ticked' (BOB-3 #3)", async () => {
    const land22 = feat("BOB-22", "R1", "Done", { title: "Tracts through the write path", progress: { checked: 3, total: 138 } });
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 73, refs: [] });
    await lists(releases, [...features, land22]);
    (view().querySelector("#rel-R1 tr.fold button") as HTMLElement).click();
    await settle();
    const row = [...view().querySelectorAll("#rel-R1 tr")].find((tr) => tr.querySelector("a.id")?.textContent === "BOB-22")!;
    expect(row.querySelector(".badge")!.textContent).toBe("done");
    expect(row.textContent).toContain("3 of 138");
    expect(row.querySelector(".sub-note")!.textContent).toBe("Done, criteria not ticked");
    // A Done feature with every criterion ticked has no note.
    const ticked = [...view().querySelectorAll("#rel-R1 tr")].find((tr) => tr.querySelector("a.id")?.textContent === "BOB-1")!;
    expect(ticked.querySelector(".sub-note")).toBeNull();
    await go("#feature/bobnet/BOB-22");
    await opened([...features, land22]);
    expect($("feature-head").textContent).toContain("3 of 138 criteria");
    expect($("feature-head").querySelector(".sub-note")!.textContent).toBe("Done, criteria not ticked");
    // A Done feature has no Next: no banner, no dashed step (spec, BOB-4 as built 1).
    expect(view().querySelector(".next-banner")).toBeNull();
    expect($("next")).toBeNull();
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 74, refs: [] });
    await go("#roadmap/bobnet");
    await lists();
  });

  it("turns the gates on behind Edit your gates, naming the PO for anything else", async () => {
    (view().querySelector(".gates-btn") as HTMLButtonElement).click();
    await settle();
    expect(location.hash).toBe("#roadmap/bobnet/edit");
    await lists();
    expect(view().querySelector(".banner.editing")!.textContent).toContain("Anything else is a request to Peach.");
    const select = view().querySelector('select[aria-label="Release of BOB-7"]') as HTMLSelectElement;
    // A closed release takes no features.
    expect([...select.options].map((o) => o.value)).toEqual(["R1", "R2", ""]);
    expect(select.value).toBe("R1");
    const gates = [...view().querySelectorAll(".rel-h .gate")];
    expect((gates[0]!.querySelector('[aria-label^="Move R1"][aria-label$="earlier"]') as HTMLButtonElement).disabled).toBe(true);
    expect((gates[2]!.querySelector('[aria-label$="later"]') as HTMLButtonElement).disabled).toBe(true);
    expect(gates[2]!.textContent).not.toContain("Close release");
    expect(view().querySelector(".gates-btn")!.textContent).toBe("Done");
  });

  it("moves a feature at once, last in its new release, with Undo", async () => {
    const select = view().querySelector('select[aria-label="Release of BOB-7"]') as HTMLSelectElement;
    select.value = "R2";
    select.dispatchEvent(new Event("change"));
    const [move] = pending("set_release");
    expect(move!.op).toEqual({ op: "set_release", project: "bobnet", ref: "BOB-7", release: "R2" });
    expect(move!.key).toEqual(expect.any(String));
    reply(move!, { ref: "BOB-7", seq: 41 });
    await settle();
    expect(toastEl().textContent).toContain("Moved BOB-7 to “R2 Start a session”, last in its order (Peach orders it). Recorded as yours.");
    await lists();
    (toastEl().querySelector("button.undo") as HTMLButtonElement).click();
    const [undo] = pending("undo");
    expect(undo!.op).toEqual({ op: "undo", project: "bobnet", seq: 41 });
    reply(undo!, { ref: "BOB-7", seq: 42, told: [] });
    await settle();
    expect(toastEl().textContent).toBe("Undone.");
    await lists();
  });

  it("moves a feature out of any release, and says why when the board refuses", async () => {
    const select = view().querySelector('select[aria-label="Release of BOB-8"]') as HTMLSelectElement;
    select.value = "";
    select.dispatchEvent(new Event("change"));
    const [move] = pending("set_release");
    expect(move!.op["release"]).toBeNull();
    refuse(move!, "R2 is closed: a closed release takes no features");
    await settle();
    expect(toastEl().dataset["ok"]).toBe("false");
    expect(toastEl().textContent).toBe("R2 is closed: a closed release takes no features");
    await lists();
  });

  it("reorders releases, its Undo the order before", async () => {
    (view().querySelector('[aria-label="Move R1 Central backlog view later"]') as HTMLButtonElement).click();
    const [order] = pending("order_releases");
    expect(order!.op).toEqual({ op: "order_releases", project: "bobnet", refs: ["R2", "R1", "R3"] });
    reply(order!, { ref: null, seq: 50 });
    await settle();
    expect(toastEl().textContent).toContain("R1 Central backlog view is now release 2.");
    await lists();
    (toastEl().querySelector("button.undo") as HTMLButtonElement).click();
    const [back] = pending("order_releases");
    expect(back!.op).toEqual({ op: "order_releases", project: "bobnet", refs: ["R1", "R2", "R3"] });
    reply(back!, { ref: null, seq: 51 });
    await settle();
    await lists();
  });

  it("closes a release only after naming each feature not done and where it goes, the next open release by default", async () => {
    const r1 = view().querySelector("#rel-R1")!;
    (r1.querySelector(".gate button.danger") as HTMLButtonElement).click();
    const dlg = $("confirm");
    expect(dlg.querySelector("h2")!.textContent).toBe("Close R1 Central backlog view?");
    const items = [...dlg.querySelectorAll(".dest li")];
    expect(items.map((li) => li.querySelector(".id")!.textContent)).toEqual(["BOB-7"]);
    const where = dlg.querySelector('select[data-ref="BOB-7"]') as HTMLSelectElement;
    expect(where.value).toBe("R2");
    expect([...where.options].map((o) => o.textContent)).toEqual(["To R2 Start a session", "Out of any release"]);
    expect(pending("close_release")).toEqual([]);
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    const [close] = pending("close_release");
    expect(close!.op).toEqual({ op: "close_release", project: "bobnet", ref: "R1", moves: [{ feature: "BOB-7", to: "R2" }] });
    reply(close!, { ref: "R1", seq: 60 });
    await settle();
    expect(toastEl().textContent).toContain("Closed R1 Central backlog view; 1 open feature moved.");
    await lists();
    (toastEl().querySelector("button.undo") as HTMLButtonElement).click();
    expect(pending("undo")[0]!.op).toEqual({ op: "undo", project: "bobnet", seq: 60 });
    reply(pending("undo")[0]!, { ref: "R1", seq: 61, told: [] });
    await settle();
    await lists();
  });

  it("closes a release with every feature done in one sentence", async () => {
    const done = features.map((f) => (f.release === "R1" ? { ...f, status: "Done", open_since: null } : f));
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 70, refs: ["BOB-7"] });
    await lists(releases, done);
    (view().querySelector("#rel-R1 .gate button.danger") as HTMLButtonElement).click();
    const dlg = $("confirm");
    expect(dlg.querySelector(".dest")).toBeNull();
    expect(dlg.querySelector("p")!.textContent).toContain("Every feature in it is done.");
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(pending("close_release")[0]!.op["moves"]).toEqual([]);
    reply(pending("close_release")[0]!, { ref: "R1", seq: 71 });
    await settle();
    await lists();
  });

  it("counts a closed release without 0 of 0, and says an empty one is closed in muted text (Daisy, BOB-7 1, 2)", async () => {
    const closed = [...releases, rel("R4", "R4 Empty", "closed", 0, 0)];
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 72, refs: [] });
    await lists(closed, features);
    expect(view().querySelector("#rel-R3 .rel-h .muted")!.textContent).toBe("1 feature, all done · closed 2026-11-10");
    expect(view().querySelector("#rel-R4 .rel-h .muted")!.textContent).toBe("No features · closed 2026-11-10");
    const empty = view().querySelector("#rel-R4 .empty-card")!;
    expect(empty.textContent).toBe("Closed, with no features");
    expect(view().querySelector("#rel-R4 button")?.textContent ?? "").not.toContain("Closed");
    expect(view().querySelector("#rel-R1 .rel-h .muted")!.textContent).toBe("5 of 6 features done");
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 73, refs: [] });
    await lists();
  });

  it("badges a planned release, shows a release's goal, and reopens a closed one without Undo; the PO's gates too (BOB-189 R6)", async () => {
    const goal = "Start a session from the roadmap, the brief written for you";
    const shown = [rel("R1", "R1 Central backlog view", "open", 5, 6), rel("R2", "R2 Start a session", "planned", 0, 1, { goal }), rel("R3", "R3 Old", "closed", 1, 1), rel("R4", "R4 Empty", "closed", 0, 0)];
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 74, refs: [] });
    await lists(shown, features);
    expect(view().querySelector("#rel-R2 .rel-h .badge")!.textContent).toBe("planned");
    expect(view().querySelector("#rel-R2 .rel-h .badge")!.getAttribute("data-state")).toBe("planned");
    expect(view().querySelector("#rel-R2 .rel-goal")!.textContent).toBe(goal);
    expect(view().querySelector("#rel-R1 .rel-goal")).toBeNull();
    expect(view().querySelector("#rel-R4 .empty-card")!.textContent).toBe("Closed, with no features");
    expect(view().querySelector(".banner.editing")!.textContent).toContain("close or reopen a release: yours, and Peach's.");
    expect(view().querySelector(".note")!.textContent).toContain("the order of releases is yours, and Peach's.");

    const gate = view().querySelector("#rel-R3 .rel-h .gate")!;
    expect(gate.textContent).not.toContain("Close release");
    expect(view().querySelector("#rel-R1 .rel-h .gate")!.textContent).not.toContain("Reopen");
    const reopen = [...gate.querySelectorAll("button")].find((b) => b.textContent === "Reopen")!;
    expect(reopen.classList.contains("danger")).toBe(false);
    reopen.click();
    expect(pending("reopen_release")[0]!.op).toEqual({ op: "reopen_release", project: "bobnet", ref: "R3" });
    reply(pending("reopen_release")[0]!, { ref: "R3", seq: 75 });
    await settle();
    expect(toastEl().textContent).toContain("Reopened R3 Old.");
    expect(toastEl().querySelector("button.undo")).toBeNull();
    await lists();
  });

  it("toasts a move the board didn't need to write without Undo (Toad, BOB-7 1)", async () => {
    const select = view().querySelector('select[aria-label="Release of BOB-8"]') as HTMLSelectElement;
    select.value = "R1";
    select.dispatchEvent(new Event("change"));
    reply(pending("set_release")[0]!, { ref: "BOB-8", seq: 0 });
    await settle();
    expect(toastEl().textContent).toContain("Moved BOB-8");
    expect(toastEl().querySelector("button.undo")).toBeNull();
    await lists();
  });

  it("sends a write the connection dropped again after the welcome, under its key, and answers it (Toad, BOB-7 2)", async () => {
    const select = view().querySelector('select[aria-label="Release of BOB-7"]') as HTMLSelectElement;
    select.value = "R2";
    select.dispatchEvent(new Event("change"));
    const [move] = pending("set_release");
    const old = FakeSocket.last;
    old.dispatchEvent(new Event("close"));
    await new Promise((r) => setTimeout(r, 1100));
    expect(FakeSocket.last).not.toBe(old);
    expect(toastEl().dataset["ok"]).not.toBe("false");
    FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    const [again] = pending("set_release");
    expect(again).toMatchObject({ rid: move!.rid, key: move!.key, op: move!.op });
    reply(again!, { ref: "BOB-7", seq: 90 });
    await settle();
    expect(toastEl().textContent).toContain("Moved BOB-7 to “R2");
    expect(toastEl().querySelector("button.undo")).not.toBeNull();
    reply(pending("projects")[0]!, { projects: [{ key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] }] });
    await settle();
    await lists();
  });

  it("refetches the project when the board changes", async () => {
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 80, refs: ["BOB-8"] });
    expect(pending("list").length).toBe(2);
    await lists(releases, features.map((f) => (f.ref === "BOB-8" ? { ...f, title: "Capture in one step" } : f)));
    expect(view().textContent).toContain("Capture in one step");
    expect(view().textContent).not.toMatch(/\$\d/);
  });

  it("lists the rules for every project and makes an agent global admin, poe@mbp-1 by default (BOB-118)", async () => {
    const rule = (agent: string, over: Record<string, unknown> = {}) => ({ project: "*", agent, laptop: "mbp-1", role: "backup", read: true, items: "none", fields: [], sessions: false, questions: false, admin: false, ...over });
    // Laptops has drawn them before: what it asked then is answered, and a change reads them again.
    for (const f of FakeSocket.last.sent.filter((x) => (x["op"] as { op?: string } | undefined)?.op === "grants")) reply(f as never, { grants: [] });
    await go("#laptops");
    if (!pending("grants").length) FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 2, refs: [] });
    const read = pending("grants").at(-1);
    expect(read!.op).toEqual({ op: "grants", project: "bobnet" });
    reply(read!, { grants: [rule("Mario"), { ...rule("Peach"), project: "bobnet", admin: true }] });
    await settle();
    // Only the '*' rules: a project's own stay that project's.
    expect([...view().querySelectorAll("#global-rules tbody tr")].map((r) => r.querySelector("b")!.textContent)).toEqual(["Mario@mbp-1"]);
    const who = view().querySelector("#rule-who") as HTMLInputElement;
    expect(who.value).toBe("poe@mbp-1");
    (view().querySelector("form.rule-form") as HTMLFormElement).requestSubmit();
    const [grant] = pending("grant");
    expect(grant!.key).toBeTruthy();
    expect(grant!.op).toEqual({ op: "grant", project: "*", agent: "poe", laptop: "mbp-1", role: "admin", read: true, items: "none", fields: [], sessions: false, questions: false, admin: true });
    reply(grant!, { ref: "poe@mbp-1 on *", seq: 90 });
    await settle();
    expect(toastEl().textContent).toContain("poe@mbp-1 is admin on every project");
    reply(pending("grants")[0]!, { grants: [rule("Mario"), rule("poe", { role: "admin", admin: true })] });
    await settle();
    // An agent's rule it already has keeps the rest: Mario stays backup, admin now.
    (view().querySelector("#global-rules tbody tr button") as HTMLButtonElement).click();
    const [mario] = pending("grant");
    expect(mario!.op).toMatchObject({ agent: "Mario", role: "backup", items: "none", admin: true });
    refuse(mario!, "A rule for every project is Casper's gate; only the owner may");
    await settle();
    expect(toastEl().dataset["ok"]).toBe("false");
    reply(pending("grants")[0]!, { grants: [rule("Mario")] });
    await settle();
  });
});

describe("triage and capture (BOB-8)", () => {
  let mark = 0;
  beforeAll(() => {
    mark = FakeSocket.last.sent.length;
  });
  const answered = new Set<unknown>();
  const pending = (name?: string) =>
    FakeSocket.last.sent
      .slice(FakeSocket.last.sent.length < mark ? 0 : mark)
      .filter((f) => f["t"] === "board_op" && !answered.has(f["rid"]) && (!name || (f["op"] as { op: string }).op === name)) as Array<{ rid: string; key?: string; op: Record<string, unknown> }>;
  const reply = (f: { rid: string }, result: unknown) => {
    answered.add(f.rid);
    FakeSocket.last.frame({ t: "ok", rid: f.rid, result });
  };
  const releases = [
    { ref: "R1", title: "R1 Central backlog view", goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done: 1, total: 3 } },
    { ref: "R2", title: "R2 Start a session", goal: null, status: "planned", ord: 2, spec_url: null, closed_at: null, closed_by: null, features: { done: 0, total: 1 } },
    { ref: "R3", title: "R3 Old", goal: null, status: "closed", ord: 3, spec_url: null, closed_at: iso(9000), closed_by: "owner@example.com", features: { done: 1, total: 1 } },
  ];
  const backlogItem = (n: number, over: Record<string, unknown> = {}) => ({
    ref: `BOB-${100 + n}`, kind: "backlog", type: "task", status: "Draft", title: `Item ${n}`, parent: null, release: null, ord: n * 1000, labels: [],
    progress: { checked: 0, total: 0 }, tasks: null, open_since: null, archived_at: null, created_at: iso(60 * 24 * (n + 1)),
    captured_by: "Peach@mbp-1", casper_words: null, bug_where: null, blocks_use: false, parent_hint: null, ...over,
  });
  // 30 items, a day apart (BOB-101 is 2 days old, BOB-130 31 days); two bugs, one that blocks use; three in R1.
  const items = Array.from({ length: 30 }, (_, i) => backlogItem(i + 1, {
    ...(i === 4 ? { type: "bug", bug_where: "production", blocks_use: true, casper_words: "Login fails on a phone. Twice today.", parent_hint: "BOB-7" } : {}),
    ...(i === 29 ? { parent_hint: "BOB-2" } : {}),
    ...(i === 1 ? { type: "bug" } : {}),
    ...(i < 3 ? { release: "R1" } : {}),
  }));
  const lists = async (its = items) => {
    for (const f of pending("list")) reply(f, f.op["of"] === "releases" ? { releases, total: releases.length, cursor: null } : { items: its, total: its.length, cursor: null });
    await settle();
  };
  const rows = () => [...view().querySelectorAll("table.triage tbody tr:not(.fold)")];

  it("lists a project's backlog items, bugs first then oldest, 25 rows then Show all, with the totals", async () => {
    await go("#triage/bobnet");
    expect(view().textContent).toContain("Reading the board…");
    const asked = pending("list").map((f) => [f.op["of"], f.op["project"]]);
    expect(asked).toEqual([["releases", "bobnet"], ["backlog", "bobnet"]]);
    await lists();
    expect([...view().querySelectorAll(".totals div")].map((d) => d.textContent)).toEqual([
      "30backlog items", "2open bugs", "31 doldest", "17 dmedian age", "5captured this week",
    ]);
    expect(view().querySelector(".totals .hot")!.textContent).toBe("2open bugs");
    const r = rows();
    expect(r).toHaveLength(25);
    expect(r.map((x) => x.querySelector(".id")!.textContent).slice(0, 4)).toEqual(["BOB-105", "BOB-102", "BOB-130", "BOB-129"]);
    expect(r[0]!.textContent).toContain("bug · blocks use");
    // A parent hint is one muted line under Casper's words, or under the title; the ref links to its feature (spec: BOB-8 as built 1).
    const subs = (x: Element) => [...x.querySelectorAll("td.wide .sub")].map((s) => s.textContent);
    expect(subs(r[0]!)).toEqual(["Casper: “Login fails on a phone. Twice today.”", "Parent hint: BOB-7"]);
    expect(subs(r[2]!)).toEqual(["Parent hint: BOB-2"]);
    expect(r[2]!.querySelector(".sub a")!.getAttribute("href")).toBe("#feature/bobnet/BOB-2");
    expect(subs(r[1]!)).toEqual([]);
    expect(r[0]!.querySelector(".sub")!.textContent).toBe("Casper: “Login fails on a phone. Twice today.”");
    expect(r[0]!.textContent).toContain("6 days");
    expect(r[1]!.querySelector(".badge")!.textContent).toBe("bug");
    expect(r[1]!.textContent).toContain("R1");
    expect(r[2]!.textContent).toContain("none");
    const fold = view().querySelector("table.triage tr.fold button") as HTMLButtonElement;
    expect(fold.textContent).toBe("Show all 30");
    fold.click();
    expect(rows()).toHaveLength(30);
    expect(view().querySelector(".note")!.textContent).toContain("Triage is Peach's, with the board tools");
    // Nothing to change until Edit your gates.
    expect(view().querySelector("select.move")).toBeNull();
  });

  it("filters by bugs, by release and by no release, with counts", async () => {
    const filters = [...view().querySelectorAll(".seg.filters button")] as HTMLButtonElement[];
    expect(filters.map((b) => b.textContent)).toEqual(["All 30", "Bugs 2", "R1 3", "R2 0", "No release 27"]);
    filters[1]!.click();
    expect(rows().map((x) => x.querySelector(".id")!.textContent)).toEqual(["BOB-105", "BOB-102"]);
    (view().querySelectorAll(".seg.filters button")[2] as HTMLButtonElement).click();
    expect(rows().map((x) => x.querySelector(".id")!.textContent)).toEqual(["BOB-102", "BOB-103", "BOB-101"]);
    (view().querySelectorAll(".seg.filters button")[4] as HTMLButtonElement).click();
    expect(rows()).toHaveLength(25);
    (view().querySelectorAll(".seg.filters button")[0] as HTMLButtonElement).click();
  });

  it("puts an item in a release or takes it out behind Edit your gates, at once, with Undo (c8-gates-backlog-item)", async () => {
    (view().querySelector(".gates-btn") as HTMLButtonElement).click();
    await settle();
    expect(location.hash).toBe("#triage/bobnet/edit");
    await lists();
    expect(view().querySelector(".banner.editing")!.textContent).toContain("Everything else on an item is Peach's triage.");
    const select = view().querySelector('select[aria-label="Release of BOB-130"]') as HTMLSelectElement;
    // A closed release takes nothing.
    expect([...select.options].map((o) => o.value)).toEqual(["R1", "R2", ""]);
    expect((select.querySelector("option[selected]") as HTMLOptionElement).value).toBe("");
    select.value = "R2";
    select.dispatchEvent(new Event("change"));
    const [move] = pending("update");
    expect(move!.op).toEqual({ op: "update", project: "bobnet", ref: "BOB-130", set: { release: "R2" } });
    expect(move!.key).toEqual(expect.any(String));
    reply(move!, { ref: "BOB-130", seq: 200 });
    await settle();
    expect($("toast").textContent).toContain("BOB-130 is in “R2 Start a session”. Recorded as yours.");
    await lists();
    ($("toast").querySelector("button.undo") as HTMLButtonElement).click();
    const [back] = pending("update");
    expect(back!.op).toEqual({ op: "update", project: "bobnet", ref: "BOB-130", set: { release: null } });
    reply(back!, { ref: "BOB-130", seq: 201 });
    await settle();
    expect($("toast").textContent).toBe("Undone.");
    await lists();
    await go("#triage/bobnet");
    await lists();
  });

  it("captures in one field from the header, the project preset, the first sentence the title and the whole text Casper's words", async () => {
    const open = $("capture-open") as HTMLButtonElement;
    expect(open.hidden).toBe(false);
    open.click();
    const dlg = $("capture");
    expect(dlg.querySelector("h2")!.textContent).toBe("Capture");
    const text = dlg.querySelector("textarea") as HTMLTextAreaElement;
    expect(text.placeholder).toBe("What is it? A title and a sentence is enough.");
    expect(dlg.textContent).toContain("It goes to BobNet's triage list");
    text.value = "The roadmap jumps on a phone. It scrolls back to the top when a feature moves.";
    // Bug adds where and blocks use, keeping what was typed.
    ([...dlg.querySelectorAll("button")].find((b) => b.textContent === "Bug") as HTMLButtonElement).click();
    ([...dlg.querySelectorAll("button")].find((b) => b.textContent === "production") as HTMLButtonElement).click();
    const blocks = dlg.querySelector("#cap-blocks") as HTMLInputElement;
    blocks.checked = true;
    blocks.dispatchEvent(new Event("change"));
    // With the tab of what waits on Casper, the wording BOB-8 held back comes back (spec, BOB-8 as built, gap 3).
    expect(dlg.textContent).toContain("A bug that blocks use also goes on Needs you until it is slotted or closed.");
    expect((dlg.querySelector("textarea") as HTMLTextAreaElement).value).toContain("The roadmap jumps");
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    const cap = pending("capture").at(-1);
    expect(cap!.op).toEqual({
      op: "capture", project: "bobnet", capture_id: expect.stringMatching(/^[0-9a-f-]{36}$/), title: "The roadmap jumps on a phone.",
      casper_words: "The roadmap jumps on a phone. It scrolls back to the top when a feature moves.", type: "bug", bug_where: "production", blocks_use: true,
    });
    reply(cap!, { ref: "BOB-131", seq: 210, duplicate: false, dropped: [] });
    await settle();
    expect($("toast").textContent).toBe("Captured as BOB-131 in BobNet's triage list, and on Needs you.");
    await lists([backlogItem(31, { ref: "BOB-131", title: "The roadmap jumps on a phone.", type: "bug", blocks_use: true, created_at: new Date().toISOString(), casper_words: cap!.op["casper_words"] }), ...items]);
    // Bugs first, then oldest: the new bug comes after the two older ones.
    const fresh = rows()[2]!;
    expect(fresh.querySelector(".id")!.textContent).toBe("BOB-131");
    expect(fresh.textContent).toContain("just captured, from the dashboard");
    expect(fresh.textContent).toContain("today");
  });

  it("captures a plain item with only its text", async () => {
    $("capture-open").click();
    const dlg = $("capture");
    (dlg.querySelector("textarea") as HTMLTextAreaElement).value = "Show tokens per release\nso Casper sees the cost of each";
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    const cap = pending("capture").at(-1);
    expect(cap!.op).toMatchObject({ title: "Show tokens per release", type: "task", casper_words: "Show tokens per release\nso Casper sees the cost of each" });
    expect(cap!.op).not.toHaveProperty("bug_where");
    reply(cap!, { ref: "BOB-132", seq: 211, duplicate: false, dropped: [] });
    await settle();
    expect($("toast").textContent).toBe("Captured as BOB-132 in BobNet's triage list.");
    await lists();
  });

  it("keeps a capture on this device while the board is away and sends it, same id, once it is back", async () => {
    const old = FakeSocket.last;
    old.readyState = 3;
    $("capture-open").click();
    const dlg = $("capture");
    (dlg.querySelector("textarea") as HTMLTextAreaElement).value = "Offline idea. Written on the train.";
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect($("toast").textContent).toBe("Captured. It waits on this device and goes to BobNet's triage list when the board is back.");
    const stored = JSON.parse(localStorage.getItem("bobnet.captures")!);
    expect(stored).toHaveLength(1);
    old.dispatchEvent(new Event("close"));
    await new Promise((r) => setTimeout(r, 2100));
    expect(FakeSocket.last).not.toBe(old);
    mark = 0;
    FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    reply(pending("projects")[0]!, { projects: [{ key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] }] });
    await settle();
    const cap = pending("capture").at(-1);
    expect(cap!.op).toEqual(stored[0]);
    reply(cap!, { ref: "BOB-133", seq: 212, duplicate: false, dropped: [] });
    await settle();
    expect(localStorage.getItem("bobnet.captures")).toBeNull();
    expect($("toast").textContent).toBe("Sent 1 capture that waited on this device.");
    await lists();
  });

  const refuse = (f: { rid: string }, code: string, message: string) => {
    answered.add(f.rid);
    FakeSocket.last.frame({ t: "error", rid: f.rid, code, message });
  };
  const type = (text: string) => {
    $("capture-open").click();
    const dlg = $("capture");
    (dlg.querySelector("textarea") as HTMLTextAreaElement).value = text;
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  };

  // Toad, BOB-8 review 1: only a refusal takes a capture off this device, and its text comes back.
  it("keeps a capture the board can't take now on this device", async () => {
    type("Board away. Keep this.");
    const [cap] = pending("capture");
    refuse(cap!, "unavailable", "The board can't be reached (boom); retry");
    await settle();
    expect($("toast").textContent).toBe("Captured. It waits on this device and goes to BobNet's triage list when the board is back.");
    expect(JSON.parse(localStorage.getItem("bobnet.captures")!)).toEqual([cap!.op]);
    localStorage.removeItem("bobnet.captures");
  });

  it("gives a refused capture back in the dialog, as typed", async () => {
    $("capture-open").click();
    const dlg = $("capture");
    (dlg.querySelector("textarea") as HTMLTextAreaElement).value = "Too long a thing. With words.";
    ([...dlg.querySelectorAll("button")].find((b) => b.textContent === "Bug") as HTMLButtonElement).click();
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    const [cap] = pending("capture");
    refuse(cap!, "invalid", "title: too long");
    await settle();
    expect(dlg.open).toBe(true);
    expect((dlg.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Too long a thing. With words.");
    expect(dlg.querySelector(".note.refused")!.textContent).toBe("Not captured: title: too long");
    expect(dlg.querySelector('[aria-pressed="true"]')!.textContent).toBe("Bug");
    expect(localStorage.getItem("bobnet.captures")).toBeNull();
    dlg.close();
  });

  it("gives a queued capture the board refuses back in the dialog, and sends the rest once it is dealt with", async () => {
    const op = (n: number) => ({ op: "capture", project: "bobnet", capture_id: `00000000-0000-4000-8000-00000000000${n}`, title: `Queued ${n}.`, casper_words: `Queued ${n}. Words.`, type: "task" });
    localStorage.setItem("bobnet.captures", JSON.stringify([op(1), op(2)]));
    FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    reply(pending("projects")[0]!, { projects: [{ key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] }] });
    await settle();
    const [first] = pending("capture");
    expect(first!.op).toEqual(op(1));
    refuse(first!, "forbidden", "not yours");
    await settle();
    const dlg = $("capture");
    expect(dlg.open).toBe(true);
    expect((dlg.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Queued 1. Words.");
    expect(JSON.parse(localStorage.getItem("bobnet.captures")!)).toEqual([op(2)]);
    expect(pending("capture")).toHaveLength(0);
    dlg.close();
    await settle();
    const [second] = pending("capture");
    expect(second!.op).toEqual(op(2));
    reply(second!, { ref: "BOB-134", seq: 213, duplicate: false, dropped: [] });
    await settle();
    expect(localStorage.getItem("bobnet.captures")).toBeNull();
    await lists();
  });

  // Toad, BOB-10 review 6.
  it("holds a refused queued capture until Casper closes the capture he is typing", async () => {
    $("capture-open").click();
    const dlg = $("capture");
    (dlg.querySelector("textarea") as HTMLTextAreaElement).value = "Mine, half typed";
    const op = { op: "capture", project: "bobnet", capture_id: "00000000-0000-4000-8000-000000000009", title: "Queued 9.", casper_words: "Queued 9. Words.", type: "task" };
    localStorage.setItem("bobnet.captures", JSON.stringify([op]));
    FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    reply(pending("projects")[0]!, { projects: [{ key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] }] });
    await settle();
    refuse(pending("capture")[0]!, "forbidden", "not yours");
    await settle();
    expect((dlg.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Mine, half typed");
    dlg.close();
    await settle();
    expect(dlg.open).toBe(true);
    expect((dlg.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Queued 9. Words.");
    expect(localStorage.getItem("bobnet.captures")).toBeNull();
    dlg.close();
    await settle();
    await lists();
  });

  // Toad, BOB-8 review 3.
  it("shows an item's closed release under Edit, selected and not to be picked", async () => {
    await go("#triage/bobnet/edit");
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 301, refs: ["BOB-129"] });
    await lists(items.map((d) => (d.ref === "BOB-129" ? { ...d, release: "R3" } : d)));
    const select = view().querySelector('select[aria-label="Release of BOB-129"]') as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.disabled])).toEqual([["R3", true], ["R1", false], ["R2", false], ["", false]]);
    expect(select.value).toBe("R3");
    expect([...(view().querySelector('select[aria-label="Release of BOB-130"]') as HTMLSelectElement).options].map((o) => o.value)).toEqual(["R1", "R2", ""]);
    await go("#triage/bobnet");
    await lists();
  });

  it("refetches on board_changed, and says when there is nothing to triage", async () => {
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 300, refs: ["BOB-101"] });
    expect(pending("list").map((f) => f.op["of"])).toContain("backlog");
    await lists([]);
    expect(view().querySelector(".empty-card")!.textContent).toBe("Nothing to triage in BobNet. Capture something with + Capture; it lands here.");
    expect(view().querySelector(".totals")).toBeNull();
  });
});

describe("the overview: needs you, working now, projects (BOB-3 #7)", () => {
  let mark = 0;
  beforeAll(() => {
    mark = FakeSocket.last.sent.length;
  });
  const answered = new Set<unknown>();
  const pending = (name?: string, all = false) =>
    FakeSocket.last.sent
      .slice(all ? 0 : mark)
      .filter((f) => f["t"] === "board_op" && !answered.has(f["rid"]) && (!name || (f["op"] as { op: string }).op === name)) as Array<{ rid: string; op: Record<string, unknown> }>;
  const reply = (f: { rid: string }, result: unknown) => {
    answered.add(f.rid);
    FakeSocket.last.frame({ t: "ok", rid: f.rid, result });
  };
  const project = { key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] };
  const summary = (ref: string, title: string, checked: number, total: number, over: Record<string, unknown> = {}) => ({
    ref, kind: "feature", type: "increment", status: "Ready", title, parent: null, release: "R1", ord: 1000, labels: [], progress: { checked, total },
    tasks: { done: 0, total: 0 }, open_since: null, archived_at: null, created_at: iso(9000), ...over,
  });
  const row = {
    project,
    release: { ref: "R1", title: "R1 Central backlog view", goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done: 2, total: 10 } },
    release_number: 1,
    open: [summary("BOB-3", "The roadmap across projects", 0, 8, { open_since: iso(30) }), summary("BOB-8", "Capture", 0, 7, { open_since: iso(90) })],
    next_ready: summary("BOB-9", "Move Helix's board", 0, 8),
    waits_on_you: "Q-4",
    backlog: { items: 13, bugs: 2, oldest: iso(60 * 24 * 4) },
    no_release: { items: 13, bugs: 2, oldest: iso(60 * 24 * 4) },
  };
  const wait = (ref: string, kind: string, text: string, blocking: boolean, over: Record<string, unknown> = {}) => ({
    project: "bobnet", kind, ref, feature: "BOB-3", text, recommended: null, holds: { items: [], sessions: [] }, waiting_sessions: [], needed_before: null,
    asked_by: "Mario@mbp-1", since: iso(60), blocking, ...over,
  });
  const waits = [
    wait("Q-4", "question", "Which roadmap order wins?", true, {
      holds: { items: ["BOB-3", "BOB-3.1"], sessions: [{ feature: "BOB-9", kind: "build", label: "B" }] }, waiting_sessions: [{ feature: "BOB-3", kind: "build", label: "A" }],
    }),
    wait("Q-5", "question", "Ship the fixes?", true, { waiting_sessions: [{ feature: "BOB-3", kind: "build", label: "Fixes" }, { feature: "BOB-3", kind: "review", label: "review 2" }] }),
    wait("A-2", "action", "Add the token", false, { feature: null }),
    wait("BOB-31", "bug", "Login fails on a phone", true),
  ];
  const answerOverview = async () => {
    for (const f of pending("overview", true)) reply(f, f.op["project"] ? { projects: [{ ...row, project: { ...project, key: String(f.op["project"]) } }] } : { projects: [row] });
    for (const f of pending("waits", true)) reply(f, { waits, answered: [] });
    await settle();
  };

  it("reads the overview and the waits, and lists what holds work up, then how much more waits", async () => {
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers = [
      worker({ state: "waiting-approval" }),
      worker({ id: "w_2", name: "Luigi", project: "bobnet", role: "engineer", session: "BOB-3 build A", task_ref: null, task_refs: [], tokens: tokens(2_400_000) }),
      worker({ id: "w_3", name: "Mario", project: "bobnet", role: "lead", session: null, task_ref: null, task_refs: [] }),
    ] as never;
    snap.pending = [{ id: "r_7", worker_id: "w_1", name: "records-agent", kind: "approval", tool: "Bash", tier: "human", created_at: iso(1), preview: "git push" }] as never;
    FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    // helix is in the service again, so its board is drawn (ADR 0012 §2).
    FakeSocket.last.frame({ t: "board_changed", project: "helix", seq: 1, refs: [] });
    for (const f of pending("projects", true)) reply(f, { projects: [project, HELIX] });
    await go("#overview");
    expect(pending("overview", true).some((f) => !f.op["project"])).toBe(true);
    await answerOverview();
    expect(document.querySelector('#tabs a[aria-current]')!.getAttribute("href")).toBe("#overview");
    // The waits and the permission: four, the action not holding work up.
    expect($("needs-count").textContent).toBe("5");
    // Oldest first, as Waits on you (BOB-5 as built): the waits since an hour, the permission a minute.
    const lines = [...$("needs").querySelectorAll("li")];
    expect(lines.map((l) => l.querySelector(".badge")!.textContent)).toEqual(["question", "question", "bug · blocks use", "permission"]);
    expect(lines[3]!.textContent).toContain("records-agent wants Bash");
    // Each answerable line has its one button; the form opens in place (notes 40).
    expect([...lines[3]!.querySelectorAll("button:not([hidden])")].map((b) => b.textContent)).toEqual(["Allow or deny"]);
    expect([...lines[0]!.querySelectorAll("button:not([hidden])")].map((b) => b.textContent)).toEqual(["Answer"]);
    expect(lines[2]!.querySelector("button:not([hidden])")).toBeNull();
    expect(lines[0]!.querySelector(".l-t")!.textContent).toBe("Which roadmap order wins?");
    // Holds-up wording (spec, BOB-3 gap 5): its own feature's session by who is in it, another's with its feature,
    // BOB-3 counted once with its session, two named then "+N more"; a session with nobody in it by kind and label.
    expect(lines[3]!.querySelector(".l-m")!.textContent).toBe("helix › LAND-41 · holds up records-agent (build 3) · on mbp-1");
    expect(lines[0]!.querySelector(".l-m")!.textContent).toBe("BobNet › BOB-3 · holds up Luigi (build A), BOB-9 build B +1 more · from Mario · build A closed on it (need: casper)");
    expect(lines[1]!.querySelector(".l-m")!.textContent).toBe("BobNet › BOB-3 · holds up Fixes, review 2 · from Mario · Fixes, review 2 closed on it (need: casper)");
    expect(lines[2]!.querySelector(".l-m")!.textContent).toBe("BobNet › BOB-3 · blocks use · from Mario");
    // Each agent it holds up with its live dot: Luigi works, records-agent waits.
    expect([lines[0]!, lines[3]!].map((l) => l.querySelector(".who-live .dot")!.className)).toEqual(["dot on", "dot warn"]);
    // What can wait: three at most, compact, with no button (BOB-176).
    expect([...$("needs-rest").querySelectorAll("li")].map((l) => [l.className, l.getAttribute("data-ref"), l.querySelectorAll("button").length])).toEqual([["need compact", "A-2", 0]]);
    expect(view().querySelector(".ov-needs .more")!.textContent).toBe("Needs you, with today's answers →");
    expect(view().querySelector(".ov-needs .more")!.getAttribute("href")).toBe("#needs");
    // The count shows on the tab too (waiting-on-casper 3).
    expect($("needs-n").textContent).toBe("5");
  });

  it("lists who is working on what from their declared sessions, and others as Other work", () => {
    const all = [...$("working").querySelectorAll("li")];
    // A group per project, the service's first; helix isn't in it here.
    expect(all.map((l) => [l.closest<HTMLElement>(".now-p")!.dataset["project"], l.querySelector(".l-who b")!.textContent])).toEqual([["bobnet", "Luigi"], ["bobnet", "Mario"], ["helix", "records-agent"]]);
    const lines = [all[2], all[0], all[1]];
    expect(lines[0]!.querySelector(".dot")!.classList.contains("warn")).toBe(true);
    expect(lines[0]!.querySelector(".l-m")!.textContent).toBe("waiting on you · 1.5M tokens");
    expect(lines[0]!.querySelector(".l-path")!.textContent).toBe("LAND-41build 3 › LAND-41.18land: tracts take updates");
    expect(lines[0]!.querySelector(".l-path a.id")!.getAttribute("href")).toBe("#feature/helix/LAND-41");
    expect(lines[1]!.querySelector(".l-path")!.textContent).toBe("BOB-3build A");
    expect(lines[1]!.querySelector(".l-m")!.textContent).toBe("2.4M tokens");
    expect(lines[2]!.querySelector(".l-path")!.textContent).toBe("Other work (no session)");
  });

  it("gives each project the overview has a row: release, open now and who is on it, next, backlog; none for a laptop's board alone", () => {
    const rows = [...$("plist").querySelectorAll(".prow")];
    expect(rows.map((r) => r.getAttribute("data-project"))).toEqual(["bobnet"]);
    const cells = [...rows[0]!.querySelectorAll(".pc")].map((c) => c.textContent);
    expect(cells).toEqual([
      "BobNet ›mbp-1 · lead Mario · PO Peach2 running",
      "ReleaseR1 Central backlog view2 of 10 features done",
      "Open nowBOB-3The roadmap across projectsLuigi on itand 1 more open",
      "NextWaits on you: Q-4, Q-5, BOB-31Then Ready: BOB-9Move Helix's board",
      "Backlog13 items2 bugs · oldest 4 days",
    ]);
    expect(rows[0]!.querySelector(".pname a")!.getAttribute("href")).toBe("#project/bobnet");
    expect(rows[0]!.querySelector('a[href="#feature/bobnet/BOB-3"]')).not.toBeNull();
    expect(rows[0]!.querySelector('a[href="#triage/bobnet"]')).not.toBeNull();
    expect(view().textContent).not.toContain("Backlog.md");
    expect(view().textContent).not.toMatch(/\$\d/);
  });

  it("refetches on board_changed, and says when nothing is held up or working", async () => {
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 400, refs: ["Q-4"] });
    expect(pending("waits").length).toBe(1);
    for (const f of pending("overview", true)) reply(f, { projects: [{ ...row, waits_on_you: null, open: [] }] });
    for (const f of pending("waits", true)) reply(f, { waits: [], answered: [] });
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers = [];
    snap.pending = [];
    FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    await settle();
    expect(view().querySelector(".ov-needs .card .st-empty.ok")!.textContent).toBe("Nothing needs you. Anything new shows here within a minute.");
    expect($("needs-count").textContent).toBe("");
    // Nothing waits: the count leaves the tab.
    expect($("needs-n").textContent).toBe("");
    expect([...$("working").querySelectorAll(".a-line")]).toEqual([]);
    expect($("working").textContent).toContain("Nobody is running.");
    const cells = [...view().querySelectorAll('.prow[data-project="bobnet"] .pc')].map((c) => c.textContent);
    expect(cells[2]).toBe("Open nowno feature open");
    expect(cells[3]).toBe("NextReady: BOB-9Move Helix's board");
  });

  it("hints that a question of Casper's is answered through the orchestrator, as Now did", async () => {
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers = [worker({ state: "waiting-approval" })] as never;
    snap.pending = [{ id: "r_8", worker_id: "w_1", name: "records-agent", kind: "question", tool: "AskUserQuestion", tier: "human", created_at: iso(1), preview: "Which one?" }] as never;
    FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    await settle();
    const line = () => $("needs").querySelector("li")!;
    (line().querySelector(".answer-btn") as HTMLButtonElement).click();
    // A question by the tool: answered through the orchestrator, or denied here; no Allow.
    expect(line().querySelector(".who-gets")!.textContent).toBe("Answer it through the orchestrator, or deny it here; records-agent gets your note. It can't be taken back.");
    expect([...line().querySelectorAll("form.answer button")].map((b) => b.textContent)).toEqual(["Cancel", "Deny"]);
    (line().querySelector(".answer-btn") as HTMLButtonElement).click();
  });

  describe("Needs you, the page (BOB-5; BOB-176)", () => {
    const helix = { key: "helix", name: "Helix", prefix: "LAND", draft_prefix: "DRAFT", lead: "Bob@mbp-1", po: "Peach@mbp-1", repos: [] };
    const fixes = { feature: "LAND-49", kind: "build", label: "Fixes" };
    // As in the prototype (notes 22, 35): A-15 and Q-259 wait for a later milestone; Q-258 holds LAND-49's fixes up.
    const q258 = wait("Q-258", "question", "Ship rehearsal 1 with the known gap?", true, { project: "helix", feature: "LAND-49", since: iso(60 * 30),
      recommended: { key: "b", text: "Ship it, note the gap" }, waiting_sessions: [fixes], asked_by: "Bob@mbp-1" });
    const a15 = wait("A-15", "action", "Book the demo room", false, { project: "helix", feature: null, since: iso(60 * 24 * 3), needed_before: { text: "the demo" }, asked_by: "Peach@mbp-1" });
    const q259 = wait("Q-259", "question", "Which tract for rehearsal 2?", false, { project: "helix", feature: "LAND-49", since: iso(60 * 5), needed_before: { text: "rehearsal 2 (49.13)" }, asked_by: "Bob@mbp-1", recommended: { key: "b", text: "Tract 7" } });
    const gate = wait("BOB-12", "review_gate", "Casper's look at the roadmap", true, { feature: "BOB-12", since: iso(60 * 24 * 2), asked_by: null, holds: { items: ["BOB-12"], sessions: [] } });
    const bug = wait("BOB-31", "bug", "Login fails on a phone", true, { feature: null, since: iso(60 * 4) });
    const perm = { id: "r_9", worker_id: "w_1", name: "records-agent", kind: "approval", tool: "Bash", tier: "human", created_at: iso(90), preview: "git push origin HEAD" };
    const answerWith = async (ws: unknown[], answered: unknown[] = []) => {
      for (const f of pending("overview", true)) reply(f, { projects: [row] });
      for (const f of pending("waits", true)) reply(f, { waits: ws, answered });
      await settle();
    };
    const item = (ref: string) => view().querySelector(`li.need[data-ref="${ref}"]`)!;
    const refs = (id: string) => [...$(id).querySelectorAll("li.need")].map((li) => li.getAttribute("data-ref"));
    const frameOf = (rid: string) => FakeSocket.last.sent.find((f) => f["rid"] === rid)!;

    beforeAll(async () => {
      // Two projects' boards in the service, so the list is across projects and has a project filter.
      FakeSocket.last.frame({ t: "board_changed", project: "not-known", seq: 1, refs: [] });
      for (const f of pending("projects", true)) reply(f, { projects: [project, helix] });
      const snap = structuredClone(dashboard.laptops[0]!.snapshot);
      snap.workers = [worker({ state: "waiting-approval" })] as never;
      snap.pending = [perm] as never;
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
      await go("#needs");
      await answerWith([a15, gate, q258, bug, q259]);
    });

    it("is the second tab, with its count, and lists everything across projects in two groups, each oldest first (#1, #2, #6)", () => {
      expect([...document.querySelectorAll("#tabs a")].map((a) => a.getAttribute("href")).slice(0, 2)).toEqual(["#overview", "#needs"]);
      expect(document.querySelector('#tabs a[aria-current]')!.getAttribute("href")).toBe("#needs");
      expect($("needs-n").textContent).toBe("6");
      expect(refs("needs-holding")).toEqual(["BOB-12", "Q-258", "BOB-31", "r_9"]);
      expect(refs("needs-rest")).toEqual(["A-15", "Q-259"]);
      expect([...$("needs-holding").querySelectorAll(".badge")].map((b) => b.textContent)).toEqual(["review gate", "question", "bug · blocks use", "permission"]);
      // The permission is records-agent's, a Helix agent's.
      expect(view().querySelector(".bar-row")!.textContent).toBe("All projects 6BobNet 2Helix 46 items, oldest first");
    });

    it("gives each item its badge, id, text, age, where it is, what it holds up or is needed before, who asked, and one action (#1, #2; BOB-176 c4)", () => {
      const q = item("Q-258");
      expect(q.querySelector(".n-b")!.textContent).toBe("questionQ-258");
      expect(q.querySelector(".l-t")!.textContent).toBe("Ship rehearsal 1 with the known gap?");
      expect(q.querySelector(".age")!.textContent).toBe("1 day");
      expect(q.querySelector(".age")!.getAttribute("title")).toMatch(/^since \d+ \w{3} /);
      expect(q.querySelector(".l-m a")!.getAttribute("href")).toBe("#feature/helix/LAND-49");
      // The session closed on it shows on the question, last, not as an item of its own (notes 23).
      expect(q.querySelector(".l-m")!.textContent).toBe("Helix › LAND-49 · holds up Fixes · from Bob · Fixes closed on it (need: casper)");
      expect(q.querySelector(".holds")!.textContent).toBe("holds up Fixes");
      expect([...q.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Answer"]);
      // The recommendation opens under the text (spec 2.2).
      expect(q.querySelector(".rec")).toBeNull();
      // Needed before and who asked, and never holds up, on what waits for a later milestone (notes 35).
      expect(item("A-15").querySelector(".l-m")!.textContent).toBe("Helix · from Peach · needed before the demo");
      expect(item("Q-259").querySelector(".needed")!.textContent).toBe("needed before rehearsal 2 (49.13)");
      expect(item("A-15").querySelector(".holds")).toBeNull();
      expect(item("Q-259").querySelector(".holds")).toBeNull();
      expect(item("A-15").querySelector(".age")!.textContent).toBe("3 days");
      // A review gate and a bug stay links (notes 43); the permission holds up its agent.
      expect(item("BOB-12").querySelector("button")).toBeNull();
      expect(item("BOB-12").querySelector('a.answer-btn[href="#feature/bobnet/BOB-12"]')!.textContent).toBe("Open BOB-12");
      expect(item("BOB-31").querySelector('a.answer-btn[href="#triage/bobnet"]')!.textContent).toBe("Open in triage");
      expect(item("BOB-31").querySelector(".holds")!.textContent).toBe("blocks use");
      // An older supervisor's preview stands for the ask it doesn't send.
      expect(item("r_9").querySelector(".l-t")!.textContent).toBe("records-agent wants Bash: git push origin HEAD");
      expect(item("r_9").querySelector(".l-t code")!.textContent).toBe("git push origin HEAD");
      expect(item("r_9").querySelector(".holds")!.textContent).toBe("holds up records-agent (build 3)");
    });

    it("filters by project, with counts", async () => {
      ([...view().querySelectorAll(".bar-row .seg button")].find((b) => b.textContent!.startsWith("Helix")) as HTMLButtonElement).click();
      expect(refs("needs-holding")).toEqual(["Q-258", "r_9"]);
      expect(refs("needs-rest")).toEqual(["A-15", "Q-259"]);
      ([...view().querySelectorAll(".bar-row .seg button")].find((b) => b.textContent!.startsWith("All")) as HTMLButtonElement).click();
      expect(refs("needs-holding")).toHaveLength(4);
    });

    it("answers a question from here: options recommended first, his words verbatim, one write under one key, Undo (#4)", async () => {
      (item("Q-258").querySelector(".answer-btn") as HTMLButtonElement).click();
      const [get] = pending("get");
      expect(get!.op).toEqual({ op: "get", project: "helix", ref: "Q-258" });
      reply(get!, { question: { ref: "Q-258", kind: "question", text: q258.text, options: [{ key: "a", text: "Hold it for the fix", recommended: false }, { key: "b", text: "Ship it, note the gap", recommended: true }] } });
      await settle();
      const form = () => item("Q-258").querySelector("form.answer")!;
      expect([...form().querySelectorAll(".opt-row")].map((o) => o.textContent)).toEqual(["Ship it, note the gaprecommended", "Hold it for the fix"]);
      expect([...form().querySelectorAll("input[type=radio]")].some((r) => (r as HTMLInputElement).checked)).toBe(false);
      expect(form().querySelector(".who-gets")!.textContent).toBe("Recorded on Q-258 as yours, word for word; Bob, Helix's lead, gets a message.");
      const send = () => form().querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(send().disabled).toBe(true);
      const words = "  Ship it. Say so in the notes, “gap” and all.  ";
      const box = form().querySelector("textarea") as HTMLTextAreaElement;
      box.value = words;
      box.dispatchEvent(new Event("input"));
      expect(send().disabled).toBe(false);
      const radio = form().querySelector('input[value="b"]') as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
      send().click();
      send().click();
      const ops = pending("answer_question");
      expect(ops).toHaveLength(1);
      expect(ops[0]!.op).toEqual({ op: "answer_question", project: "helix", ref: "Q-258", key: "b", words: words.trim() });
      expect(typeof frameOf(ops[0]!.rid)["key"]).toBe("string");
      reply(ops[0]!, { ref: "Q-258", seq: 77, told: ["Bob@mbp-1"] });
      await settle();
      expect($("toast").textContent).toBe("Answered Q-258. Recorded as your words; sent to Bob.Undo");
      // It leaves its group at once, and the counts drop.
      expect(refs("needs-holding")).toEqual(["BOB-12", "BOB-31", "r_9"]);
      expect($("needs-n").textContent).toBe("5");
      await answerWith([a15, gate, bug, q259], [{ project: "helix", ref: "Q-258", kind: "question", text: q258.text, key: "b", words: words.trim(), at: iso(0) }]);
      const done = $("needs-answered").querySelector("li")!;
      expect(done.querySelector(".said")!.textContent).toBe(`You picked Ship it, note the gap“${words.trim()}”`);
      expect(done.querySelector(".meta")!.textContent).toBe("Bob, Helix's lead, got a messagefrom the dashboardUndo");
      // Undo, within two minutes: the board takes back his own event.
      ($("toast").querySelector("button") as HTMLButtonElement).click();
      const [undo] = pending("undo");
      expect(undo!.op).toEqual({ op: "undo", project: "helix", seq: 77 });
      reply(undo!, { ref: "Q-258", seq: 78, told: ["Bob@mbp-1"] });
      await settle();
      expect($("toast").textContent).toBe("Undone: Q-258 waits on you again; sent to Bob.");
      await answerWith([a15, gate, q258, bug, q259]);
      expect(refs("needs-holding")).toContain("Q-258");
      expect($("needs-answered")).toBeNull();
    });

    it("says who was told, who it waits for to come online, and when no supervisor runs the project (ADR 0009 §5; BOB-111 AC4)", async () => {
      // Its options were read by the answer before: no read again.
      (item("Q-258").querySelector(".answer-btn") as HTMLButtonElement).click();
      expect(pending("get")).toEqual([]);
      const box = item("Q-258").querySelector("form.answer textarea") as HTMLTextAreaElement;
      box.value = "The north tract";
      box.dispatchEvent(new Event("input"));
      (item("Q-258").querySelector('form.answer button[type="submit"]') as HTMLButtonElement).click();
      const [op] = pending("answer_question");
      reply(op!, { ref: "Q-258", seq: 90, told: ["Bob@mbp-1", "kong@mbp-1", "poe@mbp-1"], waiting: ["kong@mbp-1"], supervisor: "poe@mbp-1" });
      await settle();
      expect($("toast").textContent).toBe("Answered Q-258. Recorded as your words; sent to Bob, kong and poe; waiting for kong to come online.Undo");
      ($("toast").querySelector("button") as HTMLButtonElement).click();
      const [undo] = pending("undo");
      reply(undo!, { ref: "Q-258", seq: 91, told: ["Bob@mbp-1"], waiting: [], supervisor: null });
      await settle();
      expect($("toast").textContent).toBe("Undone: Q-258 waits on you again; sent to Bob; no supervisor runs Helix.");
      await answerWith([a15, gate, q258, bug, q259]);
    });

    it("says why when the board refuses an answer, and keeps the form", async () => {
      (item("Q-259").querySelector(".answer-btn") as HTMLButtonElement).click();
      reply(pending("get")[0]!, { question: { ref: "Q-259", options: [] } });
      await settle();
      const form = item("Q-259").querySelector("form.answer")!;
      expect(form.querySelector(".words span")!.textContent).toBe("Your answer");
      const box = form.querySelector("textarea") as HTMLTextAreaElement;
      box.value = "The north tract";
      box.dispatchEvent(new Event("input"));
      (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      const [op] = pending("answer_question");
      expect(op!.op).toEqual({ op: "answer_question", project: "helix", ref: "Q-259", words: "The north tract" });
      FakeSocket.last.frame({ t: "error", rid: op!.rid, code: "conflict", message: "Q-259 is answered already: an answer is written once" });
      await settle();
      expect($("toast").textContent).toBe("Q-259 is answered already: an answer is written once");
      expect((item("Q-259").querySelector("textarea") as HTMLTextAreaElement).value).toBe("The north tract");
      (item("Q-259").querySelector("form.answer button[type=button]") as HTMLButtonElement).click();
      expect(item("Q-259").querySelector("form.answer")).toBeNull();
    });

    it("marks an action done with a note, one form open at a time", async () => {
      (item("A-15").querySelector(".answer-btn") as HTMLButtonElement).click();
      (item("Q-259").querySelector(".answer-btn") as HTMLButtonElement).click();
      expect(view().querySelectorAll("form.answer")).toHaveLength(1);
      (item("A-15").querySelector(".answer-btn") as HTMLButtonElement).click();
      const form = item("A-15").querySelector("form.answer")!;
      expect(form.querySelector(".filed")).toBeNull();
      expect(form.querySelector(".words span")!.textContent).toBe("Note (optional)");
      const box = form.querySelector("textarea") as HTMLTextAreaElement;
      box.value = "Room 2, Thursday";
      box.dispatchEvent(new Event("input"));
      (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      const [op] = pending("mark_done");
      expect(op!.op).toEqual({ op: "mark_done", project: "helix", ref: "A-15", note: "Room 2, Thursday" });
      for (const f of pending("get").filter((x) => x.op["ref"] === "A-15")) reply(f, { question: { ref: "A-15", kind: "action", options: [] } });
      reply(op!, { ref: "A-15", seq: 80, told: ["Bob@mbp-1", "Peach@mbp-1"] });
      await settle();
      expect($("toast").textContent).toBe("Marked A-15 done. Recorded as your words; sent to Bob and Peach.Undo");
      await answerWith([gate, q258, bug, q259], [{ project: "helix", ref: "A-15", kind: "action", text: a15.text, key: null, words: "Room 2, Thursday", at: iso(0) }]);
      expect($("needs-answered").querySelector(".badge")!.textContent).toBe("done");
      expect($("needs-answered").querySelector("blockquote")!.textContent).toBe("“Room 2, Thursday”");
    });

    it("allows or denies an older supervisor's permission as before: the note only with Deny, confirming Allow, no Undo (#5; BOB-5 as built 1, 2; BOB-176 c5)", async () => {
      (item("r_9").querySelector(".answer-btn") as HTMLButtonElement).click();
      const form = () => item("r_9").querySelector("form.answer")!;
      const reported = async (rows: unknown[]) => {
        FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: { ...dashboard.laptops[0]!.snapshot, workers: [worker({ state: "waiting-approval" })], pending: rows } });
        await settle();
      };
      /** Taken, it left; asked again, it is there again with its form. */
      const askedAgain = async () => {
        expect(item("r_9")).toBeNull();
        await reported([]);
        await reported([perm]);
        (item("r_9").querySelector(".answer-btn") as HTMLButtonElement).click();
      };
      // The item is open above it, its command whole: the form doesn't say it again.
      expect(item("r_9").classList.contains("open")).toBe(true);
      expect(form().querySelector(".preview")).toBeNull();
      expect(form().querySelector(".words span")!.textContent).toBe("Note to records-agent, sent with Deny (optional)");
      expect(form().querySelector("textarea")!.getAttribute("placeholder")).toBe("e.g. not that process; use the pool's stop script");
      expect(form().querySelector(".who-gets")!.textContent).toBe("records-agent gets your decision; a note goes only with Deny. It can't be taken back.");
      expect([...form().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancel", "Deny", "Allow"]);
      const box = form().querySelector("textarea") as HTMLTextAreaElement;
      box.value = "go ahead, it's idle";
      box.dispatchEvent(new Event("input"));
      const asked: string[] = [];
      globalThis.confirm = (q?: string) => (asked.push(String(q)), false);
      ([...form().querySelectorAll("button")].find((b) => b.textContent === "Allow") as HTMLButtonElement).click();
      expect(asked).toEqual(["Allow records-agent to run Bash?\n\ngit push origin HEAD"]);
      expect(FakeSocket.last.sent.at(-1)!["t"]).not.toBe("action");
      globalThis.confirm = () => true;
      // Allow with text still allows; the note doesn't go with it.
      ([...form().querySelectorAll("button")].find((b) => b.textContent === "Allow") as HTMLButtonElement).click();
      const allow = FakeSocket.last.sent.at(-1)!;
      expect(allow).toMatchObject({ t: "action", laptop: "mbp-1", action: { kind: "answer", request: "r_9", decision: "allow" } });
      expect((allow["action"] as Record<string, unknown>)["message"]).toBeUndefined();
      expect([...form().querySelectorAll("button")].map((b) => b.disabled)).toEqual([true, true, true]);
      FakeSocket.last.frame({ t: "ok", rid: allow["rid"], result: { id: "a_allow" } });
      FakeSocket.last.frame({ t: "action_result", id: "a_allow", laptop: "mbp-1", ok: true, message: "r_9 allowed" });
      expect($("toast").textContent).toBe("Allowed records-agent's Bash.");
      expect($("toast").querySelector("button")).toBeNull();
      // Deny needs no confirmation; its note goes, and the toast says so.
      await askedAgain();
      const note = form().querySelector("textarea") as HTMLTextAreaElement;
      note.value = "use the pool's stop script";
      note.dispatchEvent(new Event("input"));
      ([...form().querySelectorAll("button")].find((b) => b.textContent === "Deny") as HTMLButtonElement).click();
      const deny = FakeSocket.last.sent.at(-1)!;
      expect(deny).toMatchObject({ t: "action", action: { kind: "answer", request: "r_9", decision: "deny", message: "use the pool's stop script" } });
      FakeSocket.last.frame({ t: "ok", rid: deny["rid"], result: { id: "a_deny" } });
      FakeSocket.last.frame({ t: "action_result", id: "a_deny", laptop: "mbp-1", ok: true, message: "r_9 denied" });
      expect($("toast").textContent).toBe("Denied records-agent's Bash; your note went to records-agent.");
      // No note: no "; your note …". A refusal reads as the supervisor's own words.
      await askedAgain();
      const empty = form().querySelector("textarea") as HTMLTextAreaElement;
      empty.value = "";
      empty.dispatchEvent(new Event("input"));
      ([...form().querySelectorAll("button")].find((b) => b.textContent === "Deny") as HTMLButtonElement).click();
      FakeSocket.last.frame({ t: "ok", rid: FakeSocket.last.sent.at(-1)!["rid"], result: { id: "a_deny2" } });
      FakeSocket.last.frame({ t: "action_result", id: "a_deny2", laptop: "mbp-1", ok: true, message: "r_9 denied" });
      expect($("toast").textContent).toBe("Denied records-agent's Bash.");
      FakeSocket.last.frame({ t: "action_result", id: "a_other", laptop: "mbp-1", ok: false, message: "r_9 isn't pending" });
      expect($("toast").textContent).toBe("r_9 isn't pending");
      await reported([]);
      await reported([perm]);
      // A laptop that sends no decided adds no row, and nothing is said about it (BOB-176 c6).
      expect($("needs-answered")?.querySelector('[data-ref="r_9"]') ?? null).toBeNull();
    });

    it("names a permission's session by its step on both lists: holds up records-agent (Fixes) (BOB-5 as built)", async () => {
      const snap = structuredClone(dashboard.laptops[0]!.snapshot);
      snap.workers = [worker({ state: "waiting-approval", session: "LAND-41 build Fixes" })] as never;
      snap.pending = [perm] as never;
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
      await settle();
      expect(item("r_9").querySelector(".holds")!.textContent).toBe("holds up records-agent (Fixes)");
      await go("#overview");
      const line = [...$("needs").querySelectorAll("li")].find((l) => l.textContent!.includes("records-agent wants Bash"))!;
      expect(line.querySelector(".l-m")!.textContent).toBe("Helix › LAND-41 · holds up records-agent (Fixes) · on mbp-1");
      snap.workers = [worker({ state: "waiting-approval" })] as never;
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
      await go("#needs");
    });

    it("answers from the Overview's Needs you in place, with the same form (notes 40)", async () => {
      await go("#overview");
      await answerWith([q258]);
      const line = () => [...$("needs").querySelectorAll("li")].find((li) => li.textContent!.includes("Ship rehearsal"))!;
      (line().querySelector(".answer-btn") as HTMLButtonElement).click();
      expect(line().querySelector("form.answer .opt-row")!.textContent).toBe("Ship it, note the gaprecommended");
      (line().querySelector("form.answer button[type=button]") as HTMLButtonElement).click();
    });

    /** The board changed: Waits reads again and gets `ws`. */
    let changes = 300;
    const reread = async (ws: unknown[]) => {
      FakeSocket.last.frame({ t: "board_changed", project: "helix", seq: ++changes, refs: [] });
      await answerWith(ws);
    };

    it("marks an edited question \"edited ×n\" after its text, its edits newest first, and moves the A-24 case to Holds work up once it holds (BOB-119 AC 4, AC 7)", async () => {
      await go("#needs");
      // As helix A-24 was asked: needed before the demo, holding nothing, so it waited as if nothing were held up.
      const a24 = wait("A-24", "action", "Book the demo room", false, { project: "helix", feature: null, since: iso(60 * 6), needed_before: { text: "the demo" }, asked_by: "Peach@mbp-1", edits: [] });
      await reread([a15, gate, q258, bug, q259, a24]);
      expect(refs("needs-rest")).toContain("A-24");
      expect(item("A-24").querySelector(".edits")).toBeNull();
      // An older broker's waits carry no edits: nothing is marked.
      expect(item("Q-258").querySelector(".edits")).toBeNull();
      const edit = (seq: number, min: number, by: string, reason: string | null, changes: unknown[]) => ({ seq, at: iso(min), by, reason, changes });
      const edited = {
        ...a24,
        text: "Book the demo room for Friday",
        blocking: true,
        holds: { items: ["LAND-49"], sessions: [fixes] },
        edits: [
          edit(301, 30, "Peach@mbp-1", "holds were left out", [{ field: "holds", old: null, new: "LAND-49" }, { field: "holds_sessions", old: null, new: "LAND-49 build Fixes" }]),
          edit(302, 10, "owner@example.com", null, [{ field: "text", old: "Book the demo room", new: "Book the demo room for Friday" }, { field: "option b", old: "Lines", new: "Thin lines" }]),
        ],
      };
      await reread([a15, gate, q258, bug, q259, edited]);
      // Holding now, it is among what holds work up, with its current text.
      expect(refs("needs-holding")).toContain("A-24");
      expect(refs("needs-rest")).not.toContain("A-24");
      const a = item("A-24");
      expect(a.querySelector(".l-t")!.textContent).toBe("Book the demo room for Friday");
      expect(a.querySelector(".holds")!.textContent).toBe("holds up LAND-49 Fixes");
      // A muted tag after the text, outside its cut, not a badge; closed (spec 2.2).
      const d = a.querySelector(".l-h > details.edits") as HTMLDetailsElement;
      expect(d.previousElementSibling!.classList.contains("l-t")).toBe(true);
      expect(d.querySelector("summary")!.textContent).toBe("edited ×2");
      expect(d.querySelector(".badge")).toBeNull();
      expect(d.open).toBe(false);
      const lines = [...d.querySelectorAll("li")];
      expect(lines.map((l) => l.dataset["seq"])).toEqual(["302", "301"]);
      expect(lines[0]!.querySelector(".ed-h")!.textContent).toMatch(/^\d+ \w{3} .+ · you · text, options$/);
      expect(lines[0]!.querySelector(".ed-why")).toBeNull();
      expect(lines[0]!.querySelector("del")!.textContent).toBe("Book the demo room");
      expect(lines[0]!.textContent).toContain("option b: Lines → Thin lines");
      expect(lines[1]!.querySelector(".ed-h")!.textContent).toMatch(/ · Peach · holds, sessions held$/);
      expect(lines[1]!.querySelector(".ed-why")!.textContent).toBe("“holds were left out”");
      expect(lines[1]!.textContent).toContain("holds: none → LAND-49");
      // Opened, it stays open across a redraw.
      d.open = true;
      d.dispatchEvent(new Event("toggle"));
      await reread([a15, gate, q258, bug, q259, edited]);
      expect((item("A-24").querySelector("details.edits") as HTMLDetailsElement).open).toBe(true);
      await reread([a15, gate, q258, bug, q259]);
    });

    it("keeps his draft when the question is edited under his open form, and says so with its edits open; an untouched form just redraws (BOB-119 AC 7)", async () => {
      (item("Q-259").querySelector(".answer-btn") as HTMLButtonElement).click();
      // Read before, its record may be here already.
      const first = pending("get").find((f) => f.op["ref"] === "Q-259");
      if (first) reply(first, { question: { ref: "Q-259", options: [] } });
      await settle();
      const form = () => item("Q-259").querySelector("form.answer")!;
      const box = form().querySelector("textarea") as HTMLTextAreaElement;
      box.value = "Tract 7, if it's dry";
      box.dispatchEvent(new Event("input"));
      const q259b = { ...q259, text: "Which tract for rehearsal 2, given the rain?", edits: [{ seq: 310, at: iso(1), by: "Bob@mbp-1", reason: "the rain", changes: [{ field: "text", old: q259.text, new: "Which tract for rehearsal 2, given the rain?" }, { field: "option a", old: "Tract 3", new: "Tract 3 (covered)" }] }] };
      await reread([a15, gate, q258, bug, q259b]);
      // He is in the form, so the page doesn't redraw under him; the note goes in at once, the draft untouched.
      expect(form().contains(document.activeElement)).toBe(true);
      expect(form().querySelector(".edited-note")!.textContent).toBe("Question edited since you opened this");
      expect((form().querySelector("textarea") as HTMLTextAreaElement).value).toBe("Tract 7, if it's dry");
      // Once he leaves it, it redraws: the draft stays, the note says why the question reads differently, and its edits are open.
      (document.activeElement as HTMLElement).blur();
      await settle();
      expect((form().querySelector("textarea") as HTMLTextAreaElement).value).toBe("Tract 7, if it's dry");
      expect(form().querySelectorAll(".edited-note")).toHaveLength(1);
      expect((item("Q-259").querySelector("details.edits") as HTMLDetailsElement).open).toBe(true);
      expect(item("Q-259").querySelector(".l-t")!.textContent).toBe("Which tract for rehearsal 2, given the rain?");
      // Its options are read again; the keys stand, so the answer still goes.
      const [again] = pending("get").filter((f) => f.op["ref"] === "Q-259");
      reply(again!, { question: { ref: "Q-259", options: [{ key: "a", text: "Tract 3 (covered)", recommended: false }, { key: "b", text: "Tract 7", recommended: true }] } });
      await settle();
      expect([...form().querySelectorAll(".opt-row")].map((o) => o.textContent)).toEqual(["Tract 7recommended", "Tract 3 (covered)"]);
      (form().querySelector('button[type="submit"]') as HTMLButtonElement).click();
      const op = pending("answer_question").at(-1);
      expect(op!.op).toEqual({ op: "answer_question", project: "helix", ref: "Q-259", words: "Tract 7, if it's dry" });
      reply(op!, { ref: "Q-259", seq: 311, told: ["Bob@mbp-1"] });
      await reread([a15, gate, q258, bug]);

      // An untouched form: no note, the edits as he left them.
      (item("Q-258").querySelector(".answer-btn") as HTMLButtonElement).click();
      const get = pending("get").find((f) => f.op["ref"] === "Q-258");
      if (get) reply(get, { question: { ref: "Q-258", options: [] } });
      await settle();
      const q258b = { ...q258, text: "Ship rehearsal 1, gap noted?", edits: [{ seq: 312, at: iso(0), by: "Bob@mbp-1", reason: null, changes: [{ field: "text", old: q258.text, new: "Ship rehearsal 1, gap noted?" }] }] };
      await reread([a15, gate, q258b, bug]);
      expect(item("Q-258").querySelector(".edited-note")).toBeNull();
      (document.activeElement as HTMLElement).blur();
      await settle();
      expect(item("Q-258").querySelector("form.answer")).not.toBeNull();
      expect(item("Q-258").querySelector(".edited-note")).toBeNull();
      expect((item("Q-258").querySelector("details.edits") as HTMLDetailsElement).open).toBe(false);
      expect(item("Q-258").querySelector(".l-t")!.textContent).toBe("Ship rehearsal 1, gap noted?");
      (item("Q-258").querySelector(".answer-btn, form.answer button[type=button]") as HTMLButtonElement)?.click();
      for (const f of pending("get")) reply(f, { question: { ref: String(f.op["ref"]), options: [] } });
      await reread([a15, gate, q258, bug, q259]);
    });

    describe("a fixed bug, a row unchanged over a day, a kept one (BOB-49; design/BOB-49/spec.md)", () => {
      const sha = "5d4617f4bed3884d73deb1a9cc71e1ed366215f4";
      const subject = "v2: BOB-27: board reports no longer stall behind a row the protocol won't take";
      const fix = (release: string | null, tags_known: boolean) => ({ sha, subject, landed_at: iso(170), release, tags_known });
      const bob27 = wait("BOB-27", "bug", "Board reports stuck since 04:10", false, { feature: "BOB-12", since: iso(180), fix: fix("v2.0.0-rc.34", true) });
      const bob28 = wait("BOB-28", "bug", "The chart is blank", false, { feature: null, since: iso(200), fix: fix(null, true) });
      const land9 = wait("LAND-9", "bug", "Tracts don't load", false, { project: "helix", feature: null, since: iso(210), asked_by: "Bob@mbp-1", fix: fix(null, false),
        stale: { changed_at: iso(60 * 26), owner: "Peach@mbp-1", flagged_at: iso(10) } });
      const q14 = wait("Q-14", "question", "Which laptop runs the Helix supervisor after the move?", true, { feature: "BOB-6", since: iso(60 * 51),
        holds: { items: [], sessions: [{ feature: "BOB-6", kind: "build", label: "A" }] }, stale: { changed_at: iso(60 * 51), owner: "Mario@mbp-1", flagged_at: iso(40) } });
      const a30 = wait("A-30", "action", "Rotate the CI token", false, { feature: null, since: iso(60 * 24 + 10), asked_by: "Peach@mbp-1", stale: { changed_at: iso(60 * 24 + 10), owner: "Peach@mbp-1", flagged_at: null } });
      const gate6 = wait("BOB-6", "review_gate", "Casper's look at Start", true, { feature: "BOB-6", since: iso(60 * 26), asked_by: null, holds: { items: ["BOB-6"], sessions: [] },
        stale: { changed_at: iso(60 * 26), owner: null, flagged_at: null } });
      const q15 = wait("Q-15", "question", "Keep the old tab?", false, { feature: "BOB-6", since: iso(60 * 30), kept: { by: "Mario@mbp-1", at: iso(90), reason: "Still waits on the move, which is Friday" } });
      const meta = (ref: string) => item(ref).querySelector(".m-row")!;

      // Its rows' times are from when the file loaded, and the suite runs past a minute: the clock is held there.
      afterAll(() => {
        vi.useRealTimers();
      });

      beforeAll(async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now);
        // Luigi in BOB-6 build A, so Q-14 holds him up by name.
        const snap = structuredClone(dashboard.laptops[0]!.snapshot);
        snap.workers = [worker({ id: "w_6", name: "Luigi", project: "bobnet", role: "engineer", session: "BOB-6 build A", task_ref: null, task_refs: [] })] as never;
        snap.pending = [];
        FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
        await go("#needs");
        await reread([bob27, bob28, land9, q14, a30, gate6, q15]);
      });

      it("moves a bug whose fix landed to When you have time, badged fix landed, with its commit, release and who closes it (spec a)", () => {
        expect(refs("needs-holding")).toEqual(["Q-14", "BOB-6"]);
        expect(refs("needs-rest")).toEqual(["Q-15", "A-30", "LAND-9", "BOB-28", "BOB-27"]);
        expect(item("BOB-27").getAttribute("data-blocking")).toBe("false");
        const badge = item("BOB-27").querySelector(".badge")!;
        expect(badge.textContent).toBe("bug · fix landed");
        expect(badge.getAttribute("data-state")).toBe("fixed");
        // The fix line sits right under the text, its age beside it, and above the meta.
        const line = item("BOB-27").querySelector(".fix")!;
        expect(line.previousElementSibling!.classList.contains("age")).toBe(true);
        expect(line.previousElementSibling!.previousElementSibling!.classList.contains("l-h")).toBe(true);
        expect(line.nextElementSibling!.classList.contains("m-row")).toBe(true);
        expect(line.textContent).toBe("Fix landed 5d4617f, in v2.0.0-rc.34 · waits on Peach to close it");
        expect(line.querySelector(".sha")!.getAttribute("title")).toBe(subject);
        expect(line.querySelector(".muted")!.textContent).toBe(" · waits on Peach to close it");
        expect(item("BOB-28").querySelector(".fix")!.textContent).toBe("Fix landed 5d4617f, not in a release yet · waits on Peach to close it");
        expect(item("LAND-9").querySelector(".fix")!.textContent).toBe("Fix landed 5d4617f · waits on Peach to close it");
        // No Blocks use; from and the triage link stay, and no button.
        expect(item("BOB-27").querySelector(".holds")).toBeNull();
        expect(meta("BOB-27").textContent).toBe("BobNet › BOB-12 · from MarioOpen in triage");
        expect(item("BOB-27").querySelector("button")).toBeNull();
        expect(item("BOB-27").querySelector(".age")!.textContent).toBe("3h 0m");
      });

      it("says a row unchanged over a day, and whom the board asked to check it: flagged, within the hour, nobody (spec b)", () => {
        const stale = (ref: string) => item(ref).querySelector(".m-row .stale")!;
        expect(stale("Q-14").textContent).toBe("Unchanged for 2 days, Mario asked to check it 40m ago");
        // At the right of the meta row, before the button.
        expect(meta("Q-14").textContent).toBe("BobNet › BOB-6 · holds up Luigi (build A) · from MarioUnchanged for 2 days, Mario asked to check it 40m agoAnswer");
        expect(stale("Q-14").nextElementSibling!.classList.contains("acts")).toBe(true);
        expect(stale("A-30").textContent).toBe("Unchanged for 1 day, Peach is asked within the hour");
        expect(stale("BOB-6").textContent).toBe("Unchanged for 1 day, nobody to ask");
        // Both ages tick as every age on the page does.
        expect([...stale("Q-14").querySelectorAll("[data-ago]")].map((x) => x.getAttribute("data-ago"))).toEqual([q14.stale.flagged_at]);
        // A fixed bug can be stale too: the fix line, then the stale span in the meta.
        expect(item("LAND-9").querySelector(".fix")).not.toBeNull();
        expect(stale("LAND-9").textContent).toBe("Unchanged for 1 day, Peach asked to check it 10m ago");
        expect(item("LAND-9").querySelector(".kept")).toBeNull();
      });

      it("quotes the owner's keep, muted, when the row isn't stale; never both (spec b)", () => {
        expect(item("Q-15").querySelector(".kept")!.textContent).toBe("Kept by Mario 1h 30m ago: “Still waits on the move, which is Friday”");
        expect(item("Q-15").querySelector(".stale")).toBeNull();
      });

      it("shows a lead's board_ask question on Needs you as any question, with how long it has been unchanged; the fixed bug only in the count (spec b, c)", async () => {
        await go("#overview");
        await answerWith([bob27, bob28, land9, q14, a30, gate6, q15]);
        const lines = [...$("needs").querySelectorAll("li")];
        expect(lines.map((l) => l.getAttribute("data-id"))).toEqual(["bobnet/Q-14", "bobnet/BOB-6"]);
        expect(lines[0]!.querySelector(".badge")!.textContent).toBe("question");
        expect(lines[0]!.querySelector(".m-row")!.textContent).toBe("BobNet › BOB-6 · holds up Luigi (build A) · from MarioUnchanged for 2 days, Mario asked to check it 40m agoAnswer");
        expect([...lines[0]!.querySelectorAll("button:not([hidden])")].map((b) => b.textContent)).toEqual(["Answer"]);
        // Compact: the fix line stays, and how long it has been unchanged is short, in the meta.
        const rest = [...$("needs-rest").querySelectorAll("li")];
        expect(rest.map((l) => l.getAttribute("data-ref"))).toEqual(["Q-15", "A-30", "LAND-9"]);
        expect(rest[1]!.querySelector(".l-m")!.textContent).toBe("BobNet · from Peach · unchanged 1 day");
        expect(rest[2]!.querySelector(".fix")!.textContent).toBe("Fix landed 5d4617f · waits on Peach to close it");
        expect(rest[0]!.querySelector(".kept")).toBeNull();
        // Opened, it says the rest.
        (rest[0]!.querySelector(".l-t") as HTMLElement).click();
        const q15open = $("needs-rest").querySelector('li[data-ref="Q-15"]')!;
        expect(q15open.querySelector(".whole .kept")!.textContent).toBe("Kept by Mario 1h 30m ago: “Still waits on the move, which is Friday”");
        expect(q15open.querySelector(".n-links a")!.textContent).toBe("Answer it on Needs you →");
        (q15open.querySelector(".l-t") as HTMLElement).click();
        expect(view().querySelector(".ov-needs .more")!.textContent).toBe("2 more when you have time, and today's answers, on Needs you →");
        expect($("needs-n").textContent).toBe("7");
        await go("#needs");
      });

      it("closes his open form when its question is withdrawn, and keeps his draft in the toast (spec b, Withdrawn)", async () => {
        (item("Q-14").querySelector(".answer-btn") as HTMLButtonElement).click();
        for (const f of pending("get").filter((x) => x.op["ref"] === "Q-14")) reply(f, { question: { ref: "Q-14", options: [] } });
        await settle();
        const box = item("Q-14").querySelector("form.answer textarea") as HTMLTextAreaElement;
        box.value = "The Mac mini in the hall cupboard, once it has the new disk and the UPS is wired; ask me again on Friday";
        box.dispatchEvent(new Event("input"));
        (document.activeElement as HTMLElement)?.blur?.();
        await reread([bob27, bob28, land9, a30, gate6, q15]);
        const get = pending("get").find((f) => f.op["ref"] === "Q-14")!;
        expect(get.op).toEqual({ op: "get", project: "bobnet", ref: "Q-14" });
        reply(get, { question: { ref: "Q-14", state: "withdrawn", asked_by: "Mario@mbp-1", options: [] } });
        await settle();
        expect(view().querySelector("form.answer")).toBeNull();
        expect($("toast").textContent).toBe("Q-14 was withdrawn by Mario; it no longer waits on you. Your draft: “The Mac mini in the hall cupboard, once it has the new disk and the UPS is wired…”×");
        ($("toast").querySelector(".close-t") as HTMLButtonElement).click();
        // An answer form whose question was answered elsewhere isn't closed with a toast.
        (item("Q-15").querySelector(".answer-btn") as HTMLButtonElement).click();
        for (const f of pending("get").filter((x) => x.op["ref"] === "Q-15")) reply(f, { question: { ref: "Q-15", options: [] } });
        await reread([bob27, bob28, land9, a30, gate6]);
        reply(pending("get").find((f) => f.op["ref"] === "Q-15")!, { question: { ref: "Q-15", state: "answered", asked_by: "Mario@mbp-1", options: [] } });
        await settle();
        expect($("toast").hidden).toBe(true);
        (document.querySelector(".answer-btn, form.answer button[type=button]") as HTMLButtonElement | null)?.click();
        await reread([a15, gate, q258, bug, q259]);
      });
    });

    it("drops an item once its source says it is answered, keeping nothing of its own (#3)", async () => {
      await go("#needs");
      FakeSocket.last.frame({ t: "board_changed", project: "helix", seq: 99, refs: ["Q-258"] });
      await answerWith([]);
      const snap = structuredClone(dashboard.laptops[0]!.snapshot);
      snap.pending = [];
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
      await settle();
      expect(view().querySelector(".needs-page .st-empty.ok")!.textContent).toBe("Nothing needs you. Anything new shows here within a minute.");
      expect(view().querySelectorAll("li.need")).toHaveLength(0);
      expect($("needs-n").textContent).toBe("");
      // Back to one project in the service, as the tests after these expect.
      FakeSocket.last.frame({ t: "board_changed", project: "nowhere", seq: 100, refs: [] });
      for (const f of pending("projects", true)) reply(f, { projects: [project] });
      await answerWith([]);
    });
  });

  describe("a cut question opens in place (BOB-31)", () => {
    const long = "BOB-3 AC 8 says a Helix-sized board stays fast on a phone, checked on Helix's board.\nAccept the scale test now, or hold AC 8 until BOB-9?";
    const context = "The scale test seeds 700 tasks.\nThe phone shot would be the roadmap at 390 px.";
    const q1 = wait("Q-1", "question", long, true, { recommended: { key: "fixture", text: "Accept the scale test now" }, context });
    const q7 = wait("Q-7", "question", "Ship BOB-29 first?", true, { context: null });
    const a12 = wait("A-12", "action", "Sign the Mapbox terms.\nThe link is in lead/questions.md.", false, { feature: null, context: "Free tier: 50,000 loads a month." });
    const gate = wait("BOB-5", "review_gate", "Overview: Now leaves the tabs", true, { feature: "BOB-5", context: null });
    // An older broker sends no context at all: no button, no failure.
    const old = wait("Q-8", "question", "From an older broker?", false);
    const perm = { id: "r_4", worker_id: "w_1", name: "records-agent", kind: "question", tool: "AskUserQuestion", tier: "human", created_at: iso(2),
      preview: "The e2e run on staging fails on the map tiles because the key rotated. Point e2e at the new key, or skip the map step?" };
    const answerWith = async (ws: unknown[]) => {
      for (const f of pending("overview", true)) reply(f, { projects: [row] });
      for (const f of pending("waits", true)) reply(f, { waits: ws, answered: [] });
      await settle();
    };
    const line = (id: string) => $("needs").querySelector(`li[data-id="${id}"]`)!;
    const text = (id: string) => line(id).querySelector(".l-t") as HTMLElement;
    const report = (pend: unknown[]) => {
      const snap = structuredClone(dashboard.laptops[0]!.snapshot);
      snap.workers = [worker({ state: "waiting-answer" })] as never;
      snap.pending = pend as never;
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    };
    beforeAll(async () => {
      sessionStorage.removeItem("bobnet.open");
      report([perm]);
      await go("#overview");
      await answerWith([q1, q7, gate, a12, old]);
    });
    afterAll(async () => {
      report([]);
      sessionStorage.removeItem("bobnet.open");
      await answerWith([]);
    });

    it("opens whole from a tap or Enter on its text, its line breaks kept, the recommendation and the context link; again folds it", async () => {
      const t = text("bobnet/Q-1");
      expect([t.getAttribute("role"), t.getAttribute("tabindex"), t.getAttribute("aria-expanded"), t.id]).toEqual(["button", "0", "false", "t-bobnet/Q-1"]);
      expect(line("bobnet/Q-1").querySelector(".whole")).toBeNull();
      t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(true);
      // The keyboard stays where it was, across the redraw.
      expect(document.activeElement).toBe(text("bobnet/Q-1"));
      expect(text("bobnet/Q-1").getAttribute("aria-expanded")).toBe("true");
      expect(text("bobnet/Q-1").textContent).toBe(long);
      expect(text("bobnet/Q-1").textContent).toContain("\n");
      const whole = line("bobnet/Q-1").querySelector(".whole")!;
      expect(whole.querySelector(".rec")!.textContent).toBe("Recommended Accept the scale test now");
      const its = line("bobnet/Q-1").querySelector(".n-links a")!;
      expect([its.textContent, its.getAttribute("href")]).toEqual(["Its context, on Needs you →", "#needs"]);
      // The context itself stays off the Overview.
      expect(view().querySelector(".ov-needs")!.textContent).not.toContain("700 tasks");
      // DOM order: badge and id, text, age, what opened, the meta row, its links with its one button.
      expect([...line("bobnet/Q-1").children].map((c) => c.className)).toEqual(["n-b", "l-h", "age", "whole", "m-row", "n-links"]);
      expect([...line("bobnet/Q-1").querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Answer"]);
      text("bobnet/Q-1").click();
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(false);
      expect(line("bobnet/Q-1").querySelector(".whole")).toBeNull();
    });

    it("opens a request's ask whole, as a code block for a command, and not while its text is selected", () => {
      const sel = vi.spyOn(globalThis, "getSelection").mockReturnValue({ toString: () => "map tiles" } as Selection);
      text("perm/mbp-1/r_4").click();
      expect(line("perm/mbp-1/r_4").classList.contains("open")).toBe(false);
      sel.mockRestore();
      text("perm/mbp-1/r_4").click();
      expect(line("perm/mbp-1/r_4").classList.contains("open")).toBe(true);
      expect(text("perm/mbp-1/r_4").textContent).toBe(`records-agent asks: ${perm.preview}`);
      text("perm/mbp-1/r_4").click();
      const command = `pnpm exec playwright test ${"e2e/change-sets.spec.ts ".repeat(60)}`;
      report([{ ...perm, id: "r_c", kind: "approval", tool: "Bash", preview: command.slice(0, 399) + "…", ask: { text: command, cut: true, questions: [] } }]);
      return settle().then(() => {
        text("perm/mbp-1/r_c").click();
        expect(text("perm/mbp-1/r_c").querySelector("code")!.textContent).toBe(command);
        expect(line("perm/mbp-1/r_c").querySelector(".whole .cutnote")!.textContent).toBe("Cut at the laptop: too long to send whole.");
        text("perm/mbp-1/r_c").click();
        report([perm]);
        return settle();
      });
    });

    it("opens the line when Answer is pressed; a redraw and folding it keep the pick, the words and the caret", async () => {
      (line("bobnet/Q-1").querySelector(".answer-btn") as HTMLButtonElement).click();
      reply(pending("get").find((f) => f.op["ref"] === "Q-1")!, { question: { ref: "Q-1", options: [{ key: "fixture", text: "Accept the scale test now", recommended: true }, { key: "hold", text: "Hold AC 8", recommended: false }] } });
      await settle();
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(true);
      const box = () => line("bobnet/Q-1").querySelector("form.answer textarea") as HTMLTextAreaElement;
      const radio = line("bobnet/Q-1").querySelector('input[value="hold"]') as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
      box().value = "Fixture is fine, and note it on BOB-9";
      box().dispatchEvent(new Event("input"));
      box().focus();
      box().setSelectionRange(8, 8);
      // A live frame while he types: the words stay.
      report([perm]);
      await settle();
      expect(box().value).toBe("Fixture is fine, and note it on BOB-9");
      // Folding it redraws at once: the form, the pick, the words and the caret stay.
      text("bobnet/Q-1").click();
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(false);
      expect(box().value).toBe("Fixture is fine, and note it on BOB-9");
      expect(document.activeElement).toBe(box());
      expect(box().selectionStart).toBe(8);
      expect((line("bobnet/Q-1").querySelector('input[value="hold"]') as HTMLInputElement).checked).toBe(true);
      // Closing the form leaves the line as it is; opened again, the form is untouched.
      text("bobnet/Q-1").click();
      expect(box().value).toBe("Fixture is fine, and note it on BOB-9");
      (line("bobnet/Q-1").querySelector(".answer-btn") as HTMLButtonElement).click();
      expect(line("bobnet/Q-1").querySelector("form.answer")).toBeNull();
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(true);
    });

    it("keeps what is open across redraws, a tab switch and in sessionStorage, and drops ids no longer waiting", async () => {
      expect(JSON.parse(sessionStorage.getItem("bobnet.open")!)).toEqual(["bobnet/Q-1"]);
      FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 7, refs: [] });
      await answerWith([q1, q7, gate, a12, old]);
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(true);
      await go("#needs");
      await go("#overview");
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(true);
      // Answered elsewhere: it leaves the waits, and what is open forgets it.
      FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 8, refs: ["Q-1"] });
      await answerWith([q7, gate, a12, old]);
      expect(JSON.parse(sessionStorage.getItem("bobnet.open")!)).toEqual([]);
      FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 9, refs: [] });
      await answerWith([q1, q7, gate, a12, old]);
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(false);
    });

    it("on the Needs you page keeps the line breaks and shows Show context / Hide context only where there is a context", async () => {
      await go("#needs");
      const it = (ref: string) => view().querySelector(`li.need[data-ref="${ref}"]`)!;
      expect(it("Q-1").querySelector(".l-t")!.textContent).toBe(long);
      expect(it("A-12").querySelector(".l-t")!.textContent).toBe("Sign the Mapbox terms.\nThe link is in lead/questions.md.");
      for (const ref of ["Q-7", "BOB-5", "Q-8"]) expect(it(ref).querySelector(".ctx-row")).toBeNull();
      const b = () => it("A-12").querySelector(".ctx-row button") as HTMLButtonElement;
      expect([b().textContent, b().getAttribute("aria-expanded"), b().getAttribute("aria-controls")]).toEqual(["Show context", "false", "c-bobnet/A-12"]);
      expect(it("A-12").querySelector(".ctx")).toBeNull();
      b().click();
      expect([b().textContent, b().getAttribute("aria-expanded")]).toEqual(["Hide context", "true"]);
      expect(it("A-12").querySelector(".ctx")!.id).toBe("c-bobnet/A-12");
      expect(it("A-12").querySelector(".ctx")!.textContent).toBe("Free tier: 50,000 loads a month.");
      // The item's last row, above an open answer form (spec 2.2).
      expect([...it("A-12").children].map((c) => c.className)).toEqual(["n-b", "l-h", "age", "m-row", "ctx-row"]);
      (it("A-12").querySelector(".answer-btn") as HTMLButtonElement).click();
      expect([...it("A-12").children].slice(-2).map((c) => c.className)).toEqual(["ctx-row", "answer"]);
      for (const f of pending("get").filter((x) => x.op["ref"] === "A-12")) reply(f, { question: { ref: "A-12", kind: "action", options: [] } });
      (it("A-12").querySelector(".answer-btn") as HTMLButtonElement).click();
      b().click();
      expect(it("A-12").querySelector(".ctx")).toBeNull();
      expect(b().textContent).toBe("Show context");
    });

    it("lands the Overview's context link on the Needs you page with that context open and scrolled into view", async () => {
      await go("#overview");
      text("bobnet/Q-1").click();
      const into = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
      (line("bobnet/Q-1").querySelector(".n-links a") as HTMLAnchorElement).click();
      await go("#needs");
      const it = view().querySelector('li.need[data-ref="Q-1"]')!;
      expect(it.querySelector(".ctx")!.textContent).toBe(context);
      expect(it.querySelector(".ctx-row button")!.textContent).toBe("Hide context");
      expect(into.mock.contexts.map((li) => (li as HTMLElement).dataset["ref"])).toEqual(["Q-1"]);
      into.mockRestore();
      await go("#overview");
    });
  });

  it("opens the triage list on a release from the roadmap's counts line (BOB-3 #6)", async () => {
    await go("#roadmap/bobnet");
    await answerOverview();
    const link = view().querySelector("#rel-none .counts-line a") as HTMLAnchorElement;
    link.click();
    await settle();
    await answerOverview();
    expect(location.hash).toBe("#triage/bobnet");
    const item = { ref: "BOB-40", kind: "backlog", type: "chore", status: "Draft", title: "Tidy", parent: null, release: null, ord: null, labels: [], progress: { checked: 0, total: 0 }, tasks: null,
      open_since: null, archived_at: null, created_at: iso(60), captured_by: "Peach@mbp-1", casper_words: null, bug_where: null, blocks_use: false, parent_hint: null };
    for (const f of pending("list", true)) reply(f, f.op["of"] === "releases" ? { releases: [], total: 0, cursor: null } : f.op["of"] === "backlog" ? { items: [item], total: 1, cursor: null } : { items: [], total: 0, cursor: null });
    await settle();
    expect(view().querySelector('.filters [aria-pressed="true"]')!.textContent).toMatch(/^No release/);
  });
});

describe("the steps view: a feature's sessions, outcomes and tasks (BOB-4)", () => {
  let mark = 0;
  const answered = new Set<unknown>();
  const pending = (name?: string) =>
    FakeSocket.last.sent.slice(mark).filter((f) => f["t"] === "board_op" && !answered.has(f["rid"]) && (!name || (f["op"] as { op: string }).op === name)) as Array<{ rid: string; op: Record<string, unknown> }>;
  const reply = (f: { rid: string }, result: unknown) => {
    answered.add(f.rid);
    FakeSocket.last.frame({ t: "ok", rid: f.rid, result });
  };
  const tok = (n: number) => ({ input: n, output: 0, cache_read: 0, cache_write: 0 });
  const feat = (ref: string, status: string, over: Record<string, unknown> = {}) => ({
    ref, kind: "feature", type: "increment", status, title: `${ref} title`, parent: null, release: "R1", ord: 1000, labels: [], progress: { checked: 1, total: 9 },
    tasks: { done: 1, total: 4 }, open_since: null, archived_at: null, created_at: iso(9000), ...over,
  });
  const bob4 = feat("BOB-4", "Ready", { title: "A feature's sessions, outcomes and tasks", open_since: iso(300) });
  const task = (ref: string, status: string, checked: number, total: number) => ({ ...feat(ref, status, { kind: "task", type: "task", parent: "BOB-4", progress: { checked, total }, tasks: null }), title: `${ref} title` });
  const tasks = [task("BOB-41", "Done", 2, 2), task("BOB-42", "In Progress", 0, 3), task("BOB-43", "Ready", 1, 2), task("BOB-44", "Draft", 0, 0)];
  const run = (id: string, agent: string, role: string, started: number, ended: number | null, ctx: number[], over: Record<string, unknown> = {}) => ({
    id, agent, role, laptop: "mbp-2", model: "opus", effort: "high", started_at: iso(started), ended_at: ended === null ? null : iso(ended), resumed: false, tokens: tok(1_000_000), calls: ctx.length, ctx, remote_url: null, tasks: [], ...over,
  });
  const close = (over: Record<string, unknown> = {}) => ({ need: "none", waits_on: [], blockers: [], majors: [], minors_fixed: 0, sent_back: [], summary: "", handoff_path: null, handoff_text: null, commit: null, closed_by: "Mario@mbp-1", ...over });
  const session = (kind: string, label: string, started: number, ended: number | null, over: Record<string, unknown> = {}) => ({
    feature: "BOB-4", kind, label, started_at: iso(started), ended_at: ended === null ? null : iso(ended), imported: false, close: null, tasks_moved: [], tokens: tok(0), runs: [], ci_runs: [], ...over,
  });
  const sessions = [
    session("build", "Fixes", 60, null, {
      tasks_moved: [{ task: "BOB-42", status: "In Progress" }],
      runs: [run("w_l", "Luigi", "luigi", 50, null, [])],
      ci_runs: [
        { source: "github-actions", external_id: "4812", name: "e2e (staging)", url: "https://github.com/cath42/bobnet-mcp/actions/runs/4812", repo: "cath42/bobnet-mcp", branch: "v2", sha: "abc", laptop: null, status: "running",
          // Twelve and a half minutes before the frame is sent, not before the suite began: the suite runs past a minute.
          get started_at() { return new Date(Date.now() - 12.5 * 60_000).toISOString(); },
          ended_at: null, worker: "w_l", usual_ms: 20 * 60_000 },
        { source: "slot", external_id: "s_1", name: "land", url: null, repo: null, branch: null, sha: null, laptop: "mbp-2", status: "passed", started_at: iso(40), ended_at: iso(35), worker: "w_l", usual_ms: null },
      ],
    }),
    session("design", "A", 600, 500, { close: close({ summary: "Spec for the chain.", handoff_path: "~/h/w_d.md", handoff_text: "# Daisy's handoff" }), tasks_moved: [{ task: "BOB-41", status: "Ready" }], tokens: tok(2_000_000), runs: [run("w_d", "Daisy", "daisy", 600, 500, [10_000, 20_000])] }),
    session("build", "A", 400, 300, { close: close({ minors_fixed: 2, commit: "abcdef1234567", summary: "Built the chain." }), tasks_moved: [{ task: "BOB-41", status: "Done" }, { task: "BOB-42", status: "In Review" }], tokens: tok(5_000_000),
      runs: [run("w_a", "Luigi", "luigi", 400, 350, [30_000, 60_000, 90_000], { remote_url: "https://claude.ai/code/s_9" }), run("w_b", "Luigi", "luigi", 340, 300, [20_000, 40_000])] }),
    session("review", "1", 250, 200, { close: close({ need: "casper", waits_on: ["Q-7"], majors: ["BOB-42"], sent_back: ["BOB-42"], summary: "One major." }), tasks_moved: [{ task: "BOB-42", status: "In Progress" }], tokens: tok(1_500_000), runs: [run("w_t", "Toad", "toad", 250, 200, [15_000])] }),
  ];
  const ev = (seq: number, minAgo: number, op: string, ref: string, changes: Array<[string, string | null, string | null]>, over: Record<string, unknown> = {}) => ({
    seq, at: iso(minAgo), actor: { kind: "agent", who: "Peach@mbp-1", role: "po", worker: "w_p", session: null }, op, record: { table: "items", ref }, reason: null, undo_of: null,
    changes: changes.map(([field, old, n]) => ({ field, old, new: n })), ...over,
  });
  const owner = { kind: "owner", who: "owner@example.com", role: null, worker: null, session: null };
  const history = [
    { seq: 1, at: iso(5000), actor: { kind: "board", who: "import@mbp-1", role: null, worker: null, session: null }, op: "import", record: { table: "projects", ref: "bobnet" },
      reason: "imported from Backlog.md at bobnet 1234567 (bobnet-board v1, exported 2026-11-15)", undo_of: null, changes: [] },
    ...Array.from({ length: 50 }, (_, i) => ev(100 + i, 4000 - i, "update", "BOB-4", [["label", null, `l${i}`]])),
    ev(200, 700, "update", "BOB-4", [["status", "Draft", "Ready"]], { reason: "ready for build" }),
    ev(201, 450, "criteria", "BOB-4", [["ac #1 state", "open", "checked"], ["ac #1 evidence", null, "test-ui/dashboard.test.ts"]], { actor: { kind: "agent", who: "Peach@mbp-1", role: "po", worker: "w_p", session: { feature: "BOB-4", kind: "build", label: "A" } } }),
    ev(202, 420, "update", "BOB-41", [["status", "Ready", "Done"]]),
    ev(203, 100, "set_release", "BOB-4", [["release", "R2", "R1"]], { actor: owner }),
    ev(204, 99, "undo", "BOB-4", [["release", "R1", "R2"]], { actor: owner, undo_of: 203 }),
    ev(205, 10, "update", "BOB-4", [["title", "Steps", "A feature's sessions, outcomes and tasks"]]),
  ];
  const remote = "https://claude.ai/code/s_live";
  const luigi = worker({ id: "w_l", name: "Luigi", project: "bobnet", role: "luigi", session: "BOB-4 build Fixes", task: "BOB-4", task_ref: null, task_refs: ["BOB-42", "BOB-43"], laptop: "mbp-2", remote_url: remote, ctx: [5000, 9000], calls: 2, context: 9000, tokens: tok(700_000), checkpoint: "chain drawn" });
  const toad = worker({ id: "w_t2", name: "Toad", project: "bobnet", role: "toad", session: null, task: "consult", task_ref: null, last_event_at: iso(23) });
  const daisy = worker({ id: "w_d2", name: "Daisy", project: "bobnet", role: "daisy", session: null, task: "spec", task_ref: null, state: "waiting-approval" });
  const yoshi = worker({ id: "w_y", name: "Yoshi", project: "bobnet", role: "y", session: null, task: "later", task_ref: null, state: "queued" });
  const snapshot = {
    supervisor: { started_at: iso(120), concurrency: 3, active: 3, queued: 1 }, workers: [luigi, toad, daisy, yoshi],
    pending: [{ id: "r_m", worker_id: "w_d2", name: "Daisy", kind: "approval", tool: "Bash", tier: "lead", created_at: iso(1), preview: "git push" }], usage: [],
  };
  const answer = async (waits: unknown[] = []) => {
    for (let i = 0; i < 3; i++) {
      for (const f of pending("get")) {
        if (f.op["session"]) { const s = f.op["session"] as { kind: string; label: string }; reply(f, { session: sessions.find((x) => x.kind === s.kind && x.label === s.label) }); }
        else reply(f, { item: { ...bob4, sessions: sessions.map(({ feature, kind, label, started_at, ended_at }) => ({ feature, kind, label, started_at, ended_at })) }, history });
      }
      for (const f of pending("list")) reply(f, f.op["of"] === "tasks" ? { items: tasks, total: tasks.length, cursor: null } : f.op["of"] === "releases" ? { releases: [{ ref: "R1", title: "R1 Central backlog view", status: "open", features: { done: 0, total: 1 } }], total: 1, cursor: null } : { items: [bob4], total: 1, cursor: null });
      for (const f of pending("overview")) reply(f, { projects: [] });
      for (const f of pending("waits")) reply(f, { waits, answered: [] });
      await settle();
    }
  };

  beforeAll(async () => {
    // Reads an earlier describe left unanswered are answered here too: the page ignores a reply it isn't waiting for.
    mark = 0;
    FakeSocket.last.frame({ t: "report", laptop: "mbp-2", at: iso(0), snapshot });
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 90, refs: [] });
    await go("#feature/bobnet/BOB-4");
    await answer();
  });

  it("opens on #feature/<project>/<id>, its sessions in the order they ran, the next step last and dashed and as a banner (#1)", () => {
    const steps = [...view().querySelectorAll(".steps > li.step:not(.next)")];
    expect(steps.map((s) => `${s.querySelector(".kind")!.textContent} ${s.querySelector(".top b")!.textContent} ${s.querySelector(".badge")!.textContent}`))
      .toEqual(["design A closed", "build A closed", "review 1 closed", "build Fixes running"]);
    expect(steps[0]!.querySelector(".when")!.textContent).toMatch(/– .* · 1h 40m$/);
    expect(steps[3]!.querySelector(".when")!.textContent).toMatch(/^since /);
    const next = view().querySelector(".steps > li.step.next")!;
    expect(next).toBe(view().querySelector(".steps")!.lastElementChild);
    expect(next.querySelector(".top")!.textContent).toBe("Nexta review session");
    expect(next.textContent).toContain("Once Fixes closes");
    expect(view().querySelector(".next-banner")!.textContent).toBe("Nexta review session, once Fixes closes");
    // Not Casper's: accent, not amber (spec, BOB-4 as built 1).
    expect(view().querySelector(".next-banner")!.classList.contains("you")).toBe(false);
    expect(next.classList.contains("you")).toBe(false);
  });

  it("finds a bare #feature/<id>'s project by its prefix (Toad, BOB-3 finding 2)", async () => {
    await go("#feature/BOB-4");
    expect($("feature-head").querySelector(".id")!.textContent).toBe("BOB-4");
    expect(view().querySelectorAll(".steps > li.step")).toHaveLength(5);
    await go("#feature/bobnet/BOB-4");
  });

  it("gives a closed session's outcome in one line from its close, tokens last and muted, then its summary and links (#2, #7, #8)", () => {
    const [design, build, review] = [...view().querySelectorAll(".steps > li.step")];
    expect([...review!.querySelector(".outcome")!.children].map((x) => x.textContent)).toEqual(["need: casper (Q-7)", "0 blockers · 1 major", "1 sent back", "moved 1 task", "1.5M tokens"]);
    expect(review!.querySelector(".outcome .need")!.getAttribute("data-need")).toBe("casper");
    expect(review!.querySelector(".outcome > :last-child")!.className).toBe("muted");
    expect([...build!.querySelector(".outcome")!.children].map((x) => x.textContent)).toEqual(["need: none", "0 blockers · 0 majors", "2 minors fixed", "closed 1 task", "5.0M tokens"]);
    expect(build!.querySelector(".sub")!.textContent).toBe("Built the chain.");
    const links = [...build!.querySelectorAll(".links > *")].map((x) => x.textContent);
    expect(links).toEqual(["No handoff", "Close abcdef1", "Remote Control ↗", "Context per call · 5 calls"]);
    expect(build!.querySelector('.links a[href="https://claude.ai/code/s_9"]')).not.toBeNull();
    // The handoff the close stored opens in the card; its path is on the link.
    const hand = [...design!.querySelectorAll(".links button")].find((b) => b.textContent === "Handoff") as HTMLButtonElement;
    expect(hand.title).toBe("~/h/w_d.md");
    hand.click();
    expect(view().querySelector(".steps pre.handoff")!.textContent).toBe("# Daisy's handoff");
    expect(view().textContent).not.toMatch(/\$\s?\d/);
  });

  it("lists under each session the tasks it moved, with the status it left and criteria now; the rest in no session yet; all as the board has them (#3)", () => {
    const steps = [...view().querySelectorAll(".steps > li.step")];
    const moved = steps[1]!.querySelector("details.moved")!;
    expect(moved.querySelector("summary")!.textContent).toBe("Tasks it moved (2)");
    expect(moved.hasAttribute("open")).toBe(false);
    expect([...moved.querySelectorAll(".tasks li")].map((li) => `${li.querySelector(".id")!.textContent} ${li.querySelector(".badge")!.textContent} ${li.querySelector(".ac")!.textContent}`)).toEqual(["BOB-41 Done 2/2", "BOB-42 In Review 0/3"]);
    // The latest session's list is open; a running one lists the tasks it is on.
    const fixes = steps[3]!.querySelector("details.moved")!;
    expect(fixes.hasAttribute("open")).toBe(true);
    expect(fixes.querySelector("summary")!.textContent).toBe("Tasks it is on (2)");
    expect(view().querySelector(".loose")!.textContent).toContain("In no session yet");
    expect([...view().querySelectorAll(".loose .tasks li .id")].map((x) => x.textContent)).toEqual(["BOB-44"]);
    expect($("all-tasks").querySelector("summary")!.textContent).toBe("All 4, as the board has them now");
    expect([...$("all-tasks").querySelectorAll(".tasks li")].map((li) => li.querySelector(".badge")!.textContent)).toEqual(["Done", "In Progress", "Ready", "Draft"]);
  });

  it("lists who is on it now from the declared session and tasks, and the same agent live on its tasks' rows (#4)", () => {
    const now = $("on-now");
    expect(now.querySelectorAll(".a-line")).toHaveLength(1);
    const line = now.querySelector(".a-line")!;
    expect(line.querySelector(".l-who")!.textContent).toBe("Luigi luigi · waiting on CI · 700k tokens");
    expect(line.querySelector(".l-m")!.textContent).toBe("Fixes › BOB-42BOB-42 title · BOB-43BOB-43 title");
    const rows = [...$("all-tasks").querySelectorAll(".tasks li.on")];
    expect(rows.map((li) => li.querySelector(".id")!.textContent)).toEqual(["BOB-42", "BOB-43"]);
    // One state per agent, everywhere; the session by its step name (spec, BOB-4 as built).
    expect(rows[0]!.querySelector(".who")!.textContent).toBe("Luigi luigi · waiting on CI · 700k tokens · Fixes");
    expect(rows[0]!.querySelector(".who .dot")!.classList.contains("run")).toBe(true);
    // A consult and a lead show nowhere on the feature: they declared no session.
    expect(now.textContent).not.toContain("Toad");
  });

  it("shows a CI run an agent waits on, how long it has gone and its usual time; a passed run leaves (#6)", () => {
    const lines = [...view().querySelectorAll(".runw")];
    expect(lines).toHaveLength(2); // On it now, and the running session's agent line
    expect(lines[0]!.textContent).toBe("Waiting on CI · 12m · CI › e2e (staging) ↗ · github-actions, cath42/bobnet-mcp, v2 · usually about 20 min");
    expect(lines[0]!.querySelector("a")!.getAttribute("href")).toBe("https://github.com/cath42/bobnet-mcp/actions/runs/4812");
    expect(view().textContent).not.toContain("run slot on mbp-2");
  });

  it("charts context per call inside a session card, for the session and per agent, in tokens (#5)", async () => {
    const build = view().querySelectorAll(".steps > li.step")[1]!;
    (build.querySelector(".links .ctx-btn:last-child") as HTMLButtonElement).click();
    await settle();
    const panel = view().querySelectorAll(".steps > li.step")[1]!.querySelector(".ctxp")!;
    expect(panel.querySelector('.seg [aria-pressed="true"]')!.textContent).toBe("Whole session");
    expect(panel.querySelector(".key")!.textContent).toBe("build A · 5 calls");
    expect([...panel.querySelectorAll(".ctx-agents tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent).join("|"))).toEqual([
      "Luigi|opus|2|5|90k||2.0M",
      "Session||2|5|90k||5.0M",
    ]);
    (panel.querySelector(".ctx-agents tbody tr") as HTMLElement).click();
    await settle();
    const one = view().querySelectorAll(".steps > li.step")[1]!.querySelector(".ctxp")!;
    expect(one.querySelector('.seg [aria-pressed="true"]')!.textContent).toBe("Luigi");
    expect(one.querySelector(".key")!.textContent).toBe("Luigi, build A · 5 calls");
    expect(one.querySelectorAll("svg line[stroke-dasharray]").length).toBeGreaterThan(0); // a new worker starts: the dotted drop
    expect(one.querySelector(".note")!.textContent).toContain("fewer than three earlier Luigi runs");
  });

  it("opens an agent's detail row on its line, one at a time: model, laptop, worked, context, Open in Claude, Context per call, Stop and Reset (BOB-3 gap 2)", async () => {
    const line = () => $("on-now").querySelector(".a-line")!;
    (line().querySelector(".a-btn") as HTMLElement).click();
    expect(line().classList.contains("open")).toBe(true);
    const row = line().querySelector(".a-detail")!;
    // worked: 25m at the fixture's `now`, more once a slow suite has run past a minute
    expect(row.querySelector(".muted")!.textContent).toMatch(/^opus · high · mbp-2 · worked 2\dm · context 9k · 2 calls$/);
    expect(row.querySelector(`a[href="${remote}"]`)!.textContent).toBe("Open in Claude ↗");
    expect([...row.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Context per call", "Stop", "Reset"]);
    const asked: string[] = [];
    globalThis.confirm = (q?: string) => (asked.push(String(q)), false);
    ([...row.querySelectorAll("button")].find((b) => b.textContent === "Stop") as HTMLButtonElement).click();
    expect(asked).toEqual(["Stop Luigi (w_l)? It is interrupted, then ended."]);
    // Its Context per call opens its session card's panel on it.
    ([...row.querySelectorAll("button")].find((b) => b.textContent === "Context per call") as HTMLButtonElement).click();
    const fixes = view().querySelectorAll(".steps > li.step")[3]!;
    expect(fixes.querySelector('.ctxp .seg [aria-pressed="true"]')!.textContent).toBe("Luigi");
    // The session card's own agent line opens instead, and the first shuts.
    (fixes.querySelector(".s-agents .a-btn") as HTMLElement).click();
    expect(view().querySelectorAll(".a-detail")).toHaveLength(1);
    expect(view().querySelector(".steps .s-agents .a-detail")).not.toBeNull();
    (view().querySelector(".steps .s-agents .a-btn") as HTMLElement).click();
    expect(view().querySelectorAll(".a-detail")).toHaveLength(0);
  });

  it("shows what waits on Casper as the next step and the banner, with the question and the recommendation (#1, steps-view 5)", async () => {
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 91, refs: [] });
    await answer([{ project: "bobnet", kind: "question", ref: "Q-7", feature: "BOB-4", text: "Ship it with one major?", recommended: { key: "a", text: "Fix it first" },
      holds: { items: ["BOB-4"], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Toad@mbp-1", since: iso(200), blocking: true }]);
    expect(view().querySelector(".next-banner")!.textContent).toBe("Next: waits on youQ-7 · Ship it with one major?");
    const next = $("next");
    expect(next.textContent).toBe("NextWaits on youQ-7 Ship it with one major?Recommended: Fix it first");
    // Amber means "you".
    expect(next.classList.contains("you")).toBe(true);
    expect(view().querySelector(".next-banner")!.classList.contains("you")).toBe(true);
  });

  it("marks an edited question on the next step with the same render, open when it has two edits or fewer (BOB-119 AC 7)", async () => {
    const edit = (seq: number) => ({ seq, at: iso(100 - seq), by: "Toad@mbp-1", reason: seq === 2 ? "the major is fixed" : null, changes: [{ field: "text", old: `Ship it with ${seq} majors?`, new: "Ship it with one major?" }] });
    const q7 = { project: "bobnet", kind: "question", ref: "Q-7", feature: "BOB-4", text: "Ship it with one major?", recommended: null, context: null,
      holds: { items: ["BOB-4"], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Toad@mbp-1", since: iso(200), blocking: true };
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 92, refs: [] });
    await answer([{ ...q7, edits: [edit(1), edit(2)] }]);
    const d = () => $("next").querySelector(".meta > details.edits") as HTMLDetailsElement;
    expect(d().querySelector("summary")!.textContent).toBe("edited ×2");
    expect(d().open).toBe(true);
    expect([...d().querySelectorAll("li")].map((l) => l.dataset["seq"])).toEqual(["2", "1"]);
    expect(d().querySelector("li .ed-why")!.textContent).toBe("“the major is fixed”");
    expect(d().querySelector("li del")!.textContent).toBe("Ship it with 2 majors?");
    // Three and more fold to the count on the item page too.
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 93, refs: [] });
    await answer([{ ...q7, ref: "Q-8", edits: [edit(1), edit(2), edit(3)] }]);
    expect(d().querySelector("summary")!.textContent).toBe("edited ×3");
    expect(d().open).toBe(false);
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 94, refs: [] });
    await answer([q7]);
    expect($("next").querySelector(".edits")).toBeNull();
  });

  it("folds its history to a count, and opens it newest first in words, with reasons, take-backs, the import and its tasks (BOB-14 #5)", async () => {
    const btn = () => view().querySelector(".hist-btn") as HTMLButtonElement;
    expect(btn().textContent).toMatch(/^History · 56 changes since \d+ \w{3}$/);
    btn().click();
    await settle();
    const lines = () => [...view().querySelectorAll(".events > li")];
    expect(lines()).toHaveLength(50);
    expect(lines()[0]!.querySelector(".ev-what")!.textContent).toBe("title changed ShowStepsA feature's sessions, outcomes and tasks");
    expect(lines()[0]!.querySelector(".ev-who")!.textContent).toBe("Peach, PO");
    expect(lines()[1]!.querySelector(".ev-what")!.textContent).toMatch(/^Casper took back his change of \d+ \w{3} /);
    expect(lines()[1]!.querySelector(".ev-who")!.textContent).toBe("Casper");
    expect(lines()[2]!.classList.contains("undone")).toBe(true);
    expect(lines()[2]!.querySelector(".ev-what")!.textContent).toBe("release R2 → R1");
    expect(lines()[3]!.querySelector(".ev-what")!.textContent).toBe("criterion 1 checkedtest-ui/dashboard.test.ts");
    expect(lines()[3]!.querySelector(".ev-who")!.textContent).toBe("Peach, PO · build A");
    expect(lines()[4]!.querySelector(".ev-what")!.textContent).toBe("status Draft → Ready");
    expect(lines()[4]!.querySelector(".ev-why")!.textContent).toBe("“ready for build”");
    (view().querySelector(".hist .more-btn") as HTMLButtonElement).click();
    await settle();
    expect(lines()).toHaveLength(56);
    expect(lines().at(-1)!.textContent).toMatch(/^Came over from Backlog\.md in the import, \d+ \w{3} \d{4}\. Its history before that is in git \(1234567\)\.$/);
    expect(view().querySelector(".hist .more-btn")).toBeNull();
    // Each side of the switch counts the lines it lists (spec, BOB-4 as built 2).
    expect([...view().querySelectorAll(".hist .seg button")].map((b) => b.textContent)).toEqual(["This feature (56)", "With its tasks (57)"]);
    // With its tasks: each task's line leads with its id, in a column of its own, empty on the feature's own lines (as built 5).
    const withTasks = [...view().querySelectorAll(".hist .seg button")].find((b) => b.textContent === "With its tasks (57)") as HTMLButtonElement;
    withTasks.click();
    await settle();
    expect(view().querySelector(".events.with-tasks")!.getAttribute("style")).toBe("--idw:6ch");
    const task = lines().find((li) => li.querySelector(".ev-h a.id"))!;
    expect(task.querySelector(".ev-task a.id")!.textContent).toBe("BOB-41");
    expect(task.querySelector(".ev-what")!.textContent).toBe("status Ready → Done");
    expect(lines()[0]!.querySelector(".ev-task")!.textContent).toBe("");
    // The folded button counts the feature's own, whichever side was open.
    expect(btn().textContent).toMatch(/^History · 56 changes/);
  });

  it("presets found in when capturing from the feature, clears it on ×, and on another project (BOB-10 gap 1)", async () => {
    $("capture-open").click();
    const found = () => $("capture").querySelector(".found-in");
    expect(found()!.textContent).toBe("Found in BOB-4 · A feature's sessions, outcomes and tasks×");
    ($("cap-text") as HTMLTextAreaElement).value = "The chain jumps on a phone.";
    ($("capture").querySelector("button[type=submit]") as HTMLButtonElement).click();
    const cap = pending("capture").at(-1);
    expect(cap!.op).toMatchObject({ op: "capture", project: "bobnet", found_in: "BOB-4", title: "The chain jumps on a phone." });
    reply(cap!, { ref: "BOB-60", seq: 300, duplicate: false, dropped: [] });
    await settle();
    $("capture-open").click();
    (found()!.querySelector("button.x") as HTMLButtonElement).click();
    expect(found()).toBeNull();
    ($("cap-text") as HTMLTextAreaElement).value = "Another.";
    ($("capture").querySelector("button[type=submit]") as HTMLButtonElement).click();
    expect(pending("capture").at(-1)!.op).not.toHaveProperty("found_in");
    reply(pending("capture").at(-1)!, { ref: "BOB-61", seq: 301, duplicate: false, dropped: [] });
    // Any other screen leaves it empty.
    await go("#roadmap/bobnet");
    $("capture-open").click();
    expect(found()).toBeNull();
    ($("capture") as HTMLDialogElement).close();
  });

  it("opens an agent's line on the Overview too: quiet in its state, a lead's permission as waiting on Mario with Allow and Deny, the queued named", async () => {
    await go("#overview");
    const line = (name: string) => [...$("working").querySelectorAll(".a-line")].find((li) => li.querySelector(".l-who b")!.textContent === name)!;
    // 23 min before the suite started; the suite itself takes a minute or more.
    expect(line("Toad").querySelector(".l-m")!.textContent).toBe(`quiet ${Math.floor((Date.now() - Date.parse(toad.last_event_at as string)) / 60_000)} min · 1.5M tokens`);
    expect(line("Toad").querySelector(".a-st")!.classList.contains("warn")).toBe(true);
    expect(line("Daisy").querySelector(".l-m")!.textContent).toBe("waiting on Mario · 1.5M tokens");
    expect(line("Daisy").querySelector(".a-st")!.classList.contains("muted")).toBe(true);
    expect($("needs")?.textContent ?? "").not.toContain("Daisy");
    (line("Daisy").querySelector(".a-btn") as HTMLElement).click();
    expect([...line("Daisy").querySelectorAll(".a-detail button")].map((b) => b.textContent)).toEqual(["Allow", "Deny", "Stop", "Reset"]);
    // Two groups: Allow · Deny, then Stop · Reset, never Stop beside Deny (spec, BOB-4 as built).
    expect([...line("Daisy").querySelectorAll(".a-detail .grp")].map((g) => g.textContent)).toEqual(["AllowDeny", "StopReset"]);
    // Working now names the session by its step, and its tasks apart.
    expect(line("Luigi").querySelector(".l-path")!.textContent).toBe("BOB-4Fixes › BOB-42 · BOB-43");
    expect(view().querySelector(".more.queued")!.textContent).toBe("1 queued: Yoshi");
    // Context per call from the Overview goes to the feature, its session card's panel open on the agent.
    (line("Luigi").querySelector(".a-btn") as HTMLElement).click();
    ([...line("Luigi").querySelectorAll(".a-detail button")].find((b) => b.textContent === "Context per call") as HTMLButtonElement).click();
    await settle();
    expect(location.hash).toBe("#feature/bobnet/BOB-4");
    expect(view().querySelectorAll(".steps > li.step")[3]!.querySelector('.ctxp .seg [aria-pressed="true"]')!.textContent).toBe("Luigi");
    FakeSocket.last.frame({ t: "report", laptop: "mbp-2", at: iso(0), snapshot: { ...snapshot, workers: [], pending: [] } });
  });
});

describe("the Status tab (BOB-39, BOB-40; design/BOB-33/spec.md)", () => {
  const answered = new Set<unknown>();
  const statusOps = () =>
    FakeSocket.last.sent.filter((f) => f["t"] === "board_op" && (f["op"] as { op: string }).op === "status" && !answered.has(f["rid"])) as Array<{ rid: string; op: { since: string } }>;
  const tk = (n: number) => ({ input: 0, output: 0, cache_read: n, cache_write: 0 });
  const ss = (feature: string, kind: string, label: string) => ({ feature, kind, label });
  const statusRow = (over: Record<string, unknown> = {}) => ({
    project: "bobnet", name: "BobNet", note: null, recurring: null,
    waits: [{ project: "bobnet", kind: "question", ref: "Q-6", feature: "BOB-9", text: "Keep BOB-9 in R1?", recommended: null, context: null, holds: { items: ["BOB-9"], sessions: [] },
      waiting_sessions: [], needed_before: null, asked_by: "Mario@mbp-1", since: iso(60 * 30), blocking: true }],
    done: {
      counts: { features: 1, sessions: 2, lands: 3, releases: 0 },
      features: [{ ref: "BOB-27", title: "Waits shows a closed bug as stale", type: "bug", release: "R1", at: iso(100) }],
      sessions: [
        { session: ss("BOB-31", "build", "a"), ended_at: iso(80), need: "none", summary: "A cut question opens in place.", closed_by: "Mario@mbp-1", tokens: tk(6_200_000), lost: 1, counts: { blockers: 1, majors: 2, sent_back: 1 } },
        { session: ss("BOB-30", "review", "1"), ended_at: iso(160), need: "answer", summary: "Signed off.", closed_by: "Mario@mbp-1", tokens: tk(2_100_000), lost: 0, counts: { blockers: 0, majors: 0, sent_back: 0 } },
      ],
      releases: [],
    },
    stuck: {
      runs: [{ id: "w_x", agent: "Luigi", role: "engineer", session: ss("BOB-33", "build", "a"), outcome: "failed", reason: "pnpm test exited 1", ended_at: iso(50), laptop: "ubu1" }],
      ci: [], idle_sessions: [{ session: ss("BOB-32", "build", "1"), since: iso(300) }], idle_features: [], answered_holding: [],
      settled: [{ kind: "ci", entry: { source: "github-actions", name: "test", branch: "v2", sha: null, url: null, worker: null, session: null, ended_at: iso(90) }, settled_at: iso(70) }],
    },
    backlog: { ready: [{ ref: "BOB-9", title: "Move Helix", release: "R2", criteria: 8 }], sessions_estimate: 3, no_criteria: [], triage: { count: 20, oldest: { ref: "BOB-11", at: iso(2 * 1440) } },
      release: { ref: "R2", todo: 4, ready: 0 }, thin: true },
    usage: { tokens: tk(8_300_000), by_agent: [{ agent: "Luigi", role: "engineer", tokens: tk(8_300_000), runs: 3, lost: 0 }, { agent: "Toad", role: "architect", tokens: tk(0), runs: 1, lost: 1 }], heavy: [], lost: 1 },
    more: {},
    ...over,
  });
  const reply = (since: string, rows = [statusRow()]) => ({ at: now.toISOString(), since, projects: rows });
  /** Answers every status read pending, each with its own since. */
  const answerStatus = async (rows?: unknown[]) => {
    for (const f of statusOps()) {
      answered.add(f.rid);
      FakeSocket.last.frame({ t: "ok", rid: f.rid, result: reply(f.op.since, rows as never) });
    }
    await settle();
  };
  const statusTab = () => $("tabs").querySelector('a[href="#status"]') as HTMLElement;

  beforeAll(() => localStorage.removeItem("bobnet.status.lastVisit"));

  it("is the third tab; a first visit reads the last 24 hours, in one read for every project", async () => {
    await answerStatus();
    await go("#status");
    expect([...$("tabs").querySelectorAll("a")].map((a) => a.getAttribute("href"))[2]).toBe("#status");
    expect(statusTab().hasAttribute("aria-current")).toBe(true);
    expect(view().querySelector(".span-bar .when")!.textContent).toMatch(/^The last 24 hours/);
    expect(view().querySelector(".span-note")!.textContent).toMatch(/^First visit on this device/);
    // The first visit has no "Since" chip: 24 h is pressed.
    expect([...view().querySelectorAll(".span-chips button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["24 h", "true"], ["A week", "false"]]);
    await answerStatus();
    const ops = FakeSocket.last.sent.filter((f) => f["t"] === "board_op" && (f["op"] as { op: string }).op === "status");
    const since = Date.parse((ops.at(-1)!["op"] as { since: string }).since);
    expect(Math.abs(now.getTime() - 86_400_000 - since)).toBeLessThan(120_000);
    expect(ops.at(-1)!["op"]).not.toHaveProperty("project");
  });

  it("answers on top: Needs you and Is it going OK?, then one card per project of the read, and Needs you across projects (c2, c3)", async () => {
    const answers = [...view().querySelectorAll(".answers .ans")];
    expect(answers.map((a) => a.querySelector("b")!.textContent)).toEqual(["1", "Needs a look"]);
    expect(answers[0]!.querySelector(".sub")!.textContent).toBe("1 holds work up · oldest 1\u00a0d");
    expect(answers[1]!.querySelector(".sub")!.textContent).toBe("2 stuck · 2 done");
    expect(answers[0]!.getAttribute("href")).toBe("#status/needs");
    const card = view().querySelector('.pcard[data-project="bobnet"]')!;
    expect(card.getAttribute("href")).toBe("#status/bobnet");
    expect([...card.querySelectorAll(".pstat")].map((s) => s.textContent)).toEqual(["Needs you1", "Done21 feature", "Stuck2", "Tokens8.3M+ 1 unknown"]);
    expect([...card.querySelectorAll(".pflags .badge")].map((b) => b.textContent)).toEqual(["Run failed", "backlog thin", "R2 has nothing Ready"]);
    // helix's board is a laptop's: the read has no helix, so it has no card (ADR 0012 §2).
    expect([...view().querySelectorAll(".pcard")].map((c) => c.getAttribute("data-project"))).toEqual(["bobnet"]);
    const needs = $("status-needs");
    // The one item, compact: a tap opens it here, and it is answered on Needs you (BOB-176).
    expect(needs.querySelector("li")!.className).toBe("need compact");
    (needs.querySelector("li .l-t") as HTMLElement).click();
    expect($("status-needs").querySelector("li .n-links a.more-t:last-child")!.textContent).toBe("Answer it on Needs you →");
    expect($("status-needs").querySelector("li .n-links a.more-t:last-child")!.getAttribute("href")).toBe("#needs");
    ($("status-needs").querySelector("li .l-t") as HTMLElement).click();
    expect(needs.querySelector("li .l-m")!.textContent).toContain("BobNet › BOB-9 · holds up");
    expect(needs.querySelector("li .before")!.textContent).toMatch(/^from before /);
    // Read only: no answer button here.
    expect(needs.querySelector("button")).toBeNull();
    // The dot: something closed since this device's marker.
    expect(statusTab().dataset["new"]).toBe("true");
    expect(view().textContent).not.toMatch(/\$\d/);
  });

  it("opens a project's six sections from one read; Recurring says it comes with theme tags, and there is no lead's note (c3, s8)", async () => {
    const before = statusOps().length + answered.size;
    await go("#status/bobnet");
    // A project page is a slice of the same reply: no read of its own.
    expect(statusOps().length + answered.size).toBe(before);
    const secs = [...view().querySelectorAll("details.sec")];
    expect(secs.map((d) => d.id)).toEqual(["sec-needs", "sec-done", "sec-stuck", "sec-recurring", "sec-backlog", "sec-usage"]);
    expect(view().querySelector(".lead-note")).toBeNull();
    const rec = $("sec-recurring");
    expect(rec.querySelector(".n")!.textContent).toBe("–");
    expect(rec.querySelector(".hl")!.textContent).toBe("Comes with theme tags (BOB-35)");
    expect($("sec-done").querySelector(".hl")!.textContent).toBe("1 feature Done · 2 sessions closed · 3 lands");
    expect($("sec-done").textContent).toContain("bug fixed");
    expect($("sec-done").querySelector(".srow")!.textContent).toContain("1 blocker, 2 majors, 1 sent back");
    expect($("sec-done").querySelector(".srow")!.textContent).toContain("+ 1 run unknown");
    expect($("sec-done").querySelector('a.id[href="#feature/bobnet/BOB-27"]')).not.toBeNull();
    expect($("sec-stuck").querySelector(".hl")!.textContent).toBe("Run failed · Nobody on it");
    expect($("sec-stuck").querySelector("li .what")!.textContent).toContain("Luigi's run on BOB-33 build a failed");
    // The laptop it ran on, before the reason (BOB-44).
    expect($("sec-stuck").querySelector("li .what .m")!.textContent).toBe("on ubu1 · pnpm test exited 1");
    expect($("sec-stuck").querySelector(".settled summary")!.textContent).toMatch(/^Settled since .*: 1$/);
    expect($("sec-backlog").querySelector(".thin")!.textContent).toBe("Thin: fewer than 2 Ready features with criteria, and R2 has 4 more to do.");
    expect($("sec-backlog").querySelector('li[data-warn="true"]')!.textContent).toContain("nothing Ready");
    // Usage in tokens; a run whose tokens were never reported is unknown, not zero.
    const usage = $("sec-usage");
    expect(usage.querySelector(".hl")!.textContent).toBe("8.3M tokens · 1 run's tokens unknown");
    expect([...usage.querySelectorAll(".rows.usage li")][1]!.querySelector(".num")!.textContent).toBe("1 run unknown");
    expect(usage.textContent).toContain("Not counted as zero.");
    expect(view().querySelector(".foot-note")!.textContent).toContain("I'm caught up is on All projects");
    expect(view().querySelector(".span-bar .caught")).toBeNull();
  });

  it("says when a project isn't on BobNet, and a list cut at 100 says how many more", async () => {
    await go("#status/nowhere");
    expect(view().textContent).toContain("No project nowhere on BobNet, or you can't read its board.");
    await go("#status/helix");
    expect(view().textContent).toContain("No project helix on BobNet, or you can't read its board.");
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 99, refs: [] });
    await new Promise((r) => setTimeout(r, 5200));
    const hundred = Array.from({ length: 100 }, (_, i) => ({ ...statusRow().done.sessions[1]!, session: ss("BOB-30", "review", String(i + 1)), ended_at: iso(10 + i) }));
    const cut = statusRow({ done: { ...statusRow().done, counts: { features: 1, sessions: 112, lands: 3, releases: 0 }, sessions: hundred }, more: { "done.sessions": 12 } });
    await answerStatus([cut]);
    await go("#status/bobnet");
    expect($("sec-done").querySelector(".hl")!.textContent).toContain("112 sessions closed");
    expect($("sec-done").querySelectorAll(".srow")).toHaveLength(5);
    expect($("sec-done").querySelector(".show-all button")!.textContent).toBe("Show all 112 sessions");
    ($("sec-done").querySelector(".show-all button") as HTMLButtonElement).click();
    await settle();
    expect($("sec-done").querySelectorAll(".srow")).toHaveLength(100);
    expect($("sec-done").querySelector(".note.cut")!.textContent).toMatch(/^and 12 more, older\. The board lists the newest 100\./);
  }, 10_000);

  it("refetches on board_changed at most once per 5 s while Status shows (c4)", async () => {
    await answerStatus();
    const count = () => FakeSocket.last.sent.filter((f) => f["t"] === "board_op" && (f["op"] as { op: string }).op === "status").length;
    await new Promise((r) => setTimeout(r, 5100));
    const n = count();
    for (let i = 0; i < 3; i++) FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 100 + i, refs: [] });
    await settle();
    expect(count()).toBe(n + 1);
    await answerStatus();
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 200, refs: [] });
    await settle();
    // Inside the 5 s: it waits, then reads once.
    expect(count()).toBe(n + 1);
    await new Promise((r) => setTimeout(r, 5000));
    expect(count()).toBe(n + 2);
    await answerStatus();
  }, 15_000);

  it("moves the marker only on I'm caught up, to the broker's at, with Undo; a chip widens without moving it (c1)", async () => {
    await go("#status");
    expect(localStorage.getItem("bobnet.status.lastVisit")).toBeNull();
    const caught = view().querySelector(".span-bar .caught") as HTMLButtonElement;
    caught.click();
    await settle();
    expect(localStorage.getItem("bobnet.status.lastVisit")).toBe(now.toISOString());
    expect($("toast").textContent).toMatch(/^Caught up at \d\d:\d\d\. This device's next visit starts from here\.Undo×$/);
    // The next read starts at the marker; quiet, the dot goes.
    expect(statusOps().at(-1)!.op.since).toBe(now.toISOString());
    await answerStatus([statusRow({ done: { counts: { features: 0, sessions: 0, lands: 0, releases: 0 }, features: [], sessions: [], releases: [] }, stuck: { ...statusRow().stuck, runs: [], idle_sessions: [], settled: [] } })]);
    expect(statusTab().dataset["new"]).toBe("false");
    expect(view().querySelector(".span-bar .when b")!.textContent).toBe("Since your last visit");
    // A chip reads its span too and leaves the marker alone.
    ([...view().querySelectorAll(".span-chips button")].find((b) => b.textContent === "A week") as HTMLButtonElement).click();
    await settle();
    // The marker's read first, then the week's, from the reply's at.
    await answerStatus();
    expect(Date.parse(statusOps().at(-1)?.op.since ?? "")).toBeLessThan(now.getTime() - 6 * 86_400_000);
    await answerStatus();
    expect(view().querySelector(".span-note")!.textContent).toMatch(/^Widened\. Your last visit stays at/);
    expect(localStorage.getItem("bobnet.status.lastVisit")).toBe(now.toISOString());
    // Undo puts the old marker back: none, a first visit.
    ($("toast").querySelector(".undo") as HTMLButtonElement).click();
    await settle();
    expect(localStorage.getItem("bobnet.status.lastVisit")).toBeNull();
    await answerStatus();
  });

  it("puts one line on the Overview above Needs you, from the same read, and none on a read error (BOB-40)", async () => {
    await go("#overview");
    const line = view().querySelector(".ov > a.st-line") as HTMLAnchorElement;
    expect(line.getAttribute("href")).toBe("#status");
    expect(line.nextElementSibling!.classList.contains("ov-needs")).toBe(true);
    expect(line.dataset["tone"]).toBe("bad");
    expect(line.textContent).toMatch(/^Since .+: 2 done, 2 stuckStatus →$/);
    // A read the board refuses: no line on the Overview, the banner on Status with what it said last.
    await new Promise((r) => setTimeout(r, 5100));
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 300, refs: [] });
    await settle();
    for (const f of statusOps()) {
      answered.add(f.rid);
      FakeSocket.last.frame({ t: "error", rid: f.rid, code: "invalid", message: "Invalid operation" });
    }
    await settle();
    expect(view().querySelector(".st-line")).toBeNull();
    await go("#status");
    expect(view().querySelector(".banner.down")!.textContent).toMatch(/^Board unavailableShowing what it said at \d\d:\d\d\.$/);
    expect(view().querySelector(".pcard")).not.toBeNull();
  }, 10_000);

  it("says a stuck run's laptop: a lost one's is that laptop's restart; an older broker's says none (BOB-44)", async () => {
    await go("#status/bobnet");
    // A chip reads its span: a fresh read to answer.
    ([...view().querySelectorAll(".span-chips button")].find((b) => b.textContent === "A week") as HTMLButtonElement).click();
    await settle();
    const runs = [
      { id: "w_l", agent: "Toad", role: "architect", session: ss("BOB-44", "build", "B"), outcome: "lost", reason: "supervisor restarted", ended_at: iso(40), laptop: "ubu1" },
      { id: "w_o", agent: "Daisy", role: "designer", session: ss("BOB-45", "build", "A"), outcome: "stopped", reason: "stopped by Casper", ended_at: iso(45) },
    ];
    const rows = [statusRow({ stuck: { ...statusRow().stuck, runs, idle_sessions: [], settled: [] } })];
    // Every read of it, the page's own each minute too, which may come while this one goes.
    while (statusOps().length || !$("sec-stuck")) await answerStatus(rows);
    const metas = [...$("sec-stuck").querySelectorAll("li .what")].map((x) => x.querySelector(".m")?.textContent);
    expect(metas).toEqual(["on ubu1 · Running when its supervisor restarted; nobody has started it again.", "stopped by Casper"]);
  });
});

describe("the laptop mark (BOB-44; design/BOB-44/laptop-mark.md)", () => {
  const helixOnMbp = structuredClone(dashboard.laptops[0]!.snapshot);
  /** bobnet spans mbp-1 and ubu1; helix runs on mbp-1 only. */
  const report = (ubuAt = 0, pending: unknown[] = []) => {
    const mbp = structuredClone(helixOnMbp);
    mbp.workers = [worker({}), worker({ id: "w_m", name: "Mario", project: "bobnet", role: "lead", session: null, task_ref: null, task_refs: [] })] as never;
    const ubu = {
      supervisor: { started_at: iso(300), concurrency: 3, active: 3, queued: 1 },
      workers: [
        worker({ id: "w_l", name: "Luigi", project: "bobnet", role: "luigi", session: null, task_ref: null, task_refs: [], state: "waiting-approval", remote_from: "supervisor@mbp-1", remote_by: "poe" }),
        worker({ id: "w_d", name: "Daisy", project: "bobnet", role: "daisy", session: null, task_ref: null, task_refs: [], state: "waiting-approval", remote_from: "supervisor@mbp-1", remote_by: "poe" }),
        // An older supervisor's worker: no remote_from or remote_by at all.
        worker({ id: "w_t", name: "Toad", project: "bobnet", role: "toad", session: null, task_ref: null, task_refs: [], state: "waiting-approval" }),
        worker({ id: "w_q", name: "Peach", project: "bobnet", role: "peach", session: null, task_ref: null, task_refs: [], state: "queued", started_at: null }),
      ],
      pending,
      usage: [],
    };
    // The broker's clock is read from the latest report: ubu1's first, so it can be the stale one.
    FakeSocket.last.frame({ t: "report", laptop: "ubu1", at: iso(ubuAt), snapshot: ubu });
    FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: mbp });
  };
  const ask = (id: string, worker_id: string, name: string, tier: string) => ({ id, worker_id, name, kind: "approval", tool: "Bash", tier, created_at: iso(1), preview: "git push" });
  const line = (id: string) => $("working").querySelector(`li[data-worker="${id}"]`)!;

  it("marks each worker of a project that spans laptops, local ones too, and none of a one-laptop project's", async () => {
    report(0, [ask("r_1", "w_l", "Luigi", "human"), ask("r_2", "w_d", "Daisy", "orchestrator"), ask("r_3", "w_t", "Toad", "orchestrator")]);
    await go("#overview");
    expect(line("w_l").querySelector(".l-who .who-at")!.textContent).toBe("Luigi@ubu1");
    expect(line("w_l").querySelector(".lap")!.getAttribute("title")).toBe("Runs on ubu1");
    expect(line("w_m").querySelector(".l-who .who-at")!.textContent).toBe("Mario@mbp-1");
    expect(line("w_1").querySelector(".l-who .who-at")!.textContent).toBe("records-agent");
    expect(line("w_1").querySelector(".lap")).toBeNull();
    // Queued waits for that laptop's slot.
    expect(view().querySelector(".queued")!.textContent).toBe("1 queued: Peach@ubu1");
    // Needs you: the permission names who it holds up, with the mark.
    expect($("needs").querySelector('li[data-id*="r_1"] .l-m')!.textContent).toContain("holds up Luigi@ubu1");
  });

  it("waits on a remote spawn's spawner, poe@mbp-1; an older supervisor's worker waits on the lead as before", async () => {
    expect(line("w_d").querySelector(".a-st")!.textContent).toBe("waiting on poe@mbp-1");
    expect(line("w_t").querySelector(".a-st")!.textContent).toBe("waiting on Mario");
  });

  it("says who spawned it under the detail row, and nothing for an older supervisor's worker (AC 3)", async () => {
    (line("w_d").querySelector(".a-btn") as HTMLElement).click();
    await settle();
    expect(line("w_d").querySelector(".a-detail .spawned")!.textContent).toBe("spawned by poe@mbp-1");
    expect(line("w_d").querySelector(".a-detail")!.textContent).toContain("· ubu1 ·");
    (line("w_t").querySelector(".a-btn") as HTMLElement).click();
    await settle();
    expect(line("w_t").querySelector(".a-detail")).not.toBeNull();
    expect(line("w_t").querySelector(".a-detail .spawned")).toBeNull();
    (line("w_t").querySelector(".a-btn") as HTMLElement).click();
    await settle();
  });

  it("turns a quiet laptop's mark warn with its minutes, in every project", async () => {
    report(5);
    await settle();
    const lap = line("w_l").querySelector(".lap")!;
    expect(lap.classList.contains("stale")).toBe(true);
    expect(lap.getAttribute("title")).toBe("Runs on ubu1; no report for 5 min");
    expect(line("w_l").querySelector(".who-at")!.textContent).toBe("Luigi@ubu1 · no report 5 min");
    expect(line("w_m").querySelector(".lap")!.classList.contains("stale")).toBe(false);
  });
});

describe("usage data (BOB-172)", () => {
  /** The service's list, read again: a project the page doesn't know is asked for. */
  const projectsAre = async (list: Array<[string, string]>) => {
    FakeSocket.last.frame({ t: "board_changed", project: "not-known" });
    const projects = list.map(([key, prefix]) => ({ key, name: key, prefix, draft_prefix: null, lead: null, po: null, repos: [] }));
    FakeSocket.last.frame({ t: "ok", rid: FakeSocket.last.sent.findLast((f) => (f["op"] as { op?: string } | undefined)?.op === "projects")!["rid"], result: { projects } });
    await settle();
  };
  type Tok = { input: number; output: number; cache_read: number; cache_write: number };
  type Pt = { raw: Tok; weighted: number; unknown: number; calls: number; so_far?: boolean; by_model: Array<Record<string, unknown>>; by_role: Array<Record<string, unknown>>; top: unknown[] };
  type Line = { calls: number; pts: number[]; known?: number };
  type Run = { id: string; started_at: string; ended_at: string | null; first: number; ctx: Line; live?: boolean };
  type Detail = { project: string; day: string; days: string[]; runs: Run[]; baseline: unknown; lost: number };
  let app: {
    state: { weigh: boolean; project: string | null; laptops: Map<string, unknown> };
    usageFigure: (x: unknown) => number;
    setWeigh: (on: boolean) => void;
    usageSoFar: (reply: unknown, key: string) => { points: Pt[] };
    usageDay: (key: string, day: string, days: number, again?: boolean) => { reply: Detail | null; error: string | null; loading: boolean };
    dayRuns: (reply: Detail) => Run[];
    callAt: (line: Line, i: number) => number;
    totalLine: (runs: Run[]) => Array<{ call: number; sum: number }>;
    oldLink: (hash: string) => { to: string; toast?: string } | null;
  };
  const each = (n: number) => ({ input: n, output: n, cache_read: n, cache_write: n });
  const pad = (n: number) => String(n).padStart(2, "0");
  const dayOf = (back: number) => {
    const d = new Date();
    d.setDate(d.getDate() - back);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const days = [dayOf(2), dayOf(1), dayOf(0)];
  const zero = (): Pt => ({ raw: each(0), weighted: 0, unknown: 0, calls: 0, by_model: [], by_role: [], top: [] });
  const ended: Pt = { raw: each(10), weighted: 80, unknown: 0, calls: 5, by_model: [{ model: "claude-opus-5-5", raw: 40, weighted: 80 }], by_role: [{ role: "luigi", calls: 5, raw: 40, weighted: 80 }], top: [] };
  // Not the real ratios: a figure made with hard-coded ones is wrong here.
  const rows = [
    { model: "claude-opus-5-5", alias: "opus", input: 3, output: 3, cache_read: 7, cache_write: 3 },
    { model: "claude-sonnet-5-5", alias: "sonnet", input: 1, output: 1, cache_read: 1, cache_write: 1 },
  ];
  const reply = (points: Pt[]) => ({ weights: { read_at: "2026-11-22", rows }, tz: "UTC", days, projects: [{ project: "usage-x", name: "X", points, lost: 0 }] });
  const live = (over: Record<string, unknown>) =>
    worker({ project: "usage-x", role: "luigi", name: "Luigi", session: "BOB-1 build 2", task_ref: null, tokens: each(100), calls: 4, ctx: [10, 20, 30, 40], started_at: startToday, ...over });
  /** A minute ago, or midnight if that was yesterday. */
  const startToday = new Date(Math.max(Date.now() - 60_000, new Date(`${dayOf(0)}T00:00:00`).getTime())).toISOString();
  const report = (...workers: unknown[]) => FakeSocket.last.frame({ t: "report", laptop: "usage-1", at: new Date().toISOString(), snapshot: { supervisor: { started_at: iso(9), concurrency: 1, active: 0, queued: 0 }, workers, pending: [], usage: [] } });
  const asked = () => FakeSocket.last.sent.filter((f) => (f["op"] as { op?: string } | undefined)?.op === "usage_day");
  const answer = (f: Record<string, unknown>, over: Partial<Detail> = {}) => {
    const op = f["op"] as { project: string; day: string };
    FakeSocket.last.frame({ t: "ok", rid: f["rid"], result: { project: op.project, day: op.day, days, runs: [], baseline: { total: { days: 0, calls: 0, p50: { calls: 0, pts: [] } }, roles: [] }, lost: 0, ...over } });
  };

  beforeAll(async () => {
    app = (await import("../public/app.js")) as unknown as typeof app;
  });
  afterAll(() => report());

  it("adds a running, waiting or queued worker to today's point, and not an ended one's, another project's or yesterday's", () => {
    report(
      live({ id: "w_run" }),
      live({ id: "w_wait", state: "waiting-answer", role: "toad", model: "claude-sonnet-5-5" }),
      live({ id: "w_q", state: "queued", started_at: null, tokens: each(0), calls: 0, ctx: [] }),
      live({ id: "w_done", state: "done", ended_at: iso(0) }),
      live({ id: "w_other", project: "usage-y" }),
    );
    const got = app.usageSoFar(reply([zero(), ended, ended]), "usage-x");
    expect(got.points.slice(0, 2)).toEqual([zero(), ended]);
    // Opus at this table's 3 (cache reads 7): 100 × 3 × 3 + 100 × 7; Sonnet 400.
    expect(got.points[2]).toEqual({
      raw: each(210),
      weighted: 80 + 1600 + 400,
      unknown: 0,
      calls: 13,
      so_far: true,
      by_model: [
        { model: "claude-opus-5-5", raw: 440, weighted: 1680 },
        { model: "claude-sonnet-5-5", raw: 400, weighted: 400 },
      ],
      by_role: [
        { role: "luigi", calls: 9, raw: 440, weighted: 1680 },
        { role: "toad", calls: 4, raw: 400, weighted: 400 },
      ],
      top: [],
    });
    report(live({ id: "w_run", state: "done", ended_at: iso(0) }));
    expect(app.usageSoFar(reply([zero(), ended, ended]), "usage-x").points[2]).toEqual({ ...ended, so_far: true });
  });

  it("spreads a quiet laptop's workers to its last report, not to now: one asleep since yesterday puts nothing in today (BOB-180 c7)", () => {
    const midnight = new Date(`${dayOf(0)}T00:00:00`).getTime();
    const at = (ms: number) => new Date(midnight + ms).toISOString();
    const snap = (started: string) => ({ supervisor: { started_at: iso(9), concurrency: 1, active: 0, queued: 0 }, workers: [live({ id: "w_asleep", started_at: started, calls: 100, ctx: [1] })], pending: [], usage: [] });
    app.state.laptops.set("usage-1", { laptop: "usage-1", at: at(-3600_000), snapshot: snap(at(-7200_000)) });
    expect(app.usageSoFar(reply([zero(), zero(), zero()]), "usage-x").points[2]).toEqual({ ...zero(), so_far: true });
    expect(app.dayRuns({ project: "usage-x", day: days[2]!, days, runs: [], baseline: null, lost: 0 })).toEqual([]);
    // Nor one that started, by its own clock, after the report's.
    app.state.laptops.set("usage-1", { laptop: "usage-1", at: at(-3600_000), snapshot: snap(at(-3599_000)) });
    expect(app.usageSoFar(reply([zero(), zero(), zero()]), "usage-x").points[2]).toEqual({ ...zero(), so_far: true });
    report();
  });

  it("counts an undeclared model at ×1 as unknown, splits a worker that began before today, and adds nothing to a reply from before midnight", () => {
    const midnight = new Date(`${dayOf(0)}T00:00:00`).getTime();
    const began = new Date(midnight - (Date.now() - midnight)).toISOString();
    report(live({ id: "w_old", model: null, started_at: began, tokens: each(1000) }));
    const pt = app.usageSoFar(reply([zero(), zero(), zero()]), "usage-x").points[2]!;
    // Half its time was yesterday's, so about half its tokens.
    expect(pt.raw.input).toBeGreaterThan(490);
    expect(pt.raw.input).toBeLessThan(510);
    expect([pt.unknown, pt.weighted]).toEqual([pt.raw.input * 4, pt.raw.input * 4]);
    expect(pt.by_model.map((m) => m["model"])).toEqual(["unknown"]);
    const stale = { ...reply([zero(), zero(), zero()]), days: [dayOf(3), dayOf(2), dayOf(1)] };
    expect(app.usageSoFar(stale, "usage-x").points[2]).toEqual(zero());
  });

  it("shows raw figures equal to the read's with the toggle off, weighted with it on; the setting is in state, the hash and the device", async () => {
    await go("#usage");
    app.setWeigh(false);
    expect(app.usageFigure(ended)).toBe(40);
    expect(app.usageFigure(ended.by_role[0])).toBe(40);
    expect([app.state.weigh, location.hash, localStorage.getItem("bobnet.weigh")]).toEqual([false, "#usage?weigh=0", "0"]);
    app.setWeigh(true);
    expect([app.usageFigure(ended), app.usageFigure(ended.by_model[0])]).toEqual([80, 80]);
    expect([app.state.weigh, location.hash, localStorage.getItem("bobnet.weigh")]).toEqual([true, "#usage?weigh=1", "1"]);
    expect($("tabs").querySelector("a[aria-current]")!.getAttribute("href")).toBe("#usage");
    // A link's setting holds for the page, and isn't the device's.
    await go("#usage?weigh=0");
    expect([app.state.weigh, localStorage.getItem("bobnet.weigh")]).toEqual([false, "1"]);
    await go("#status");
    expect(app.state.weigh).toBe(false);
    localStorage.removeItem("bobnet.weigh");
  });

  it("asks for a day's detail once per project, day, span and tz", async () => {
    const before = asked().length;
    expect(app.usageDay("usage-x", days[1]!, 30).loading).toBe(true);
    app.usageDay("usage-x", days[1]!, 30);
    expect(asked().length).toBe(before + 1);
    expect(asked().at(-1)!["op"]).toEqual({ op: "usage_day", project: "usage-x", day: days[1], days: 30, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    answer(asked().at(-1)!);
    await settle();
    expect(app.usageDay("usage-x", days[1]!, 30)).toMatchObject({ loading: false, error: null, reply: { day: days[1] } });
    FakeSocket.last.frame({ t: "board_changed", project: "usage-x" });
    app.usageDay("usage-x", days[1]!, 30);
    expect(asked().length).toBe(before + 1);
    app.usageDay("usage-x", days[1]!, 14);
    app.usageDay("usage-x", days[0]!, 30);
    app.usageDay("usage-y", days[1]!, 30);
    expect(asked().length).toBe(before + 4);
  });

  it("keeps a failed read's error until Retry, and asks today's again once the board has changed", async () => {
    const before = asked().length;
    app.usageDay("usage-x", days[2]!, 30);
    FakeSocket.last.frame({ t: "error", rid: asked().at(-1)!["rid"], code: "invalid", message: "No" });
    await settle();
    expect(app.usageDay("usage-x", days[2]!, 30)).toMatchObject({ loading: false, error: "No", reply: null });
    expect(asked().length).toBe(before + 1);
    app.usageDay("usage-x", days[2]!, 30, true);
    answer(asked().at(-1)!);
    await settle();
    FakeSocket.last.frame({ t: "board_changed", project: "usage-x" });
    // Not twice in half a minute; what it has stays.
    expect(app.usageDay("usage-x", days[2]!, 30).reply).not.toBeNull();
    expect(asked().length).toBe(before + 2);
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => at + 31_000);
    expect(app.usageDay("usage-x", days[2]!, 30)).toMatchObject({ loading: true, reply: { day: days[2] } });
    expect(asked().length).toBe(before + 3);
    clock.mockRestore();
    answer(asked().at(-1)!);
    await settle();
  });

  it("has a running worker's context per call in today's detail, and not in yesterday's nor twice once its run is the board's", () => {
    report(live({ id: "w_run" }), live({ id: "w_done", state: "done", ended_at: iso(0) }));
    const detail = (day: string, runs: Run[] = []): Detail => ({ project: "usage-x", day, days, runs, baseline: null, lost: 0 });
    expect(app.dayRuns(detail(days[2]!))).toMatchObject([{ id: "w_run", agent: "Luigi", role: "luigi", ended_at: null, live: true, first: 1, ctx: { calls: 4, pts: [10, 20, 30, 40] } }]);
    expect(app.dayRuns(detail(days[1]!))).toEqual([]);
    const board: Run = { id: "w_run", started_at: startToday, ended_at: iso(0), first: 1, ctx: { calls: 1, pts: [9] } };
    expect(app.dayRuns(detail(days[2]!, [board]))).toEqual([board]);
  });

  it("puts a downsampled line's points at the calls they stand for, and sums Total by the calls each counts for", () => {
    const line = { calls: 10, pts: [1, 2, 3, 4] };
    expect(line.pts.map((_, i) => app.callAt(line, i))).toEqual([1, 4, 7, 10]);
    expect(app.callAt({ calls: 1, pts: [5] }, 0)).toBe(1);
    const run = (ctx: Line): Run => ({ id: "r", started_at: iso(1), ended_at: iso(0), first: 1, ctx });
    expect(app.totalLine([run({ calls: 2, pts: [100, 200] }), run({ calls: 3, pts: [] }), run(line)])).toEqual([
      { call: 1, sum: 100 },
      { call: 2, sum: 300 },
      { call: 3, sum: 302.5 },
      { call: 6, sum: 307.5 },
      { call: 9, sum: 315 },
      { call: 12, sum: 325 },
    ]);
    // A running worker's report has its last 400 calls: they are drawn where they were made.
    report(live({ id: "w_long", calls: 500, ctx: Array.from({ length: 400 }, (_, i) => i) }));
    const [long] = app.dayRuns({ project: "usage-x", day: days[2]!, days, runs: [], baseline: null, lost: 0 });
    expect([long!.ctx.calls, app.callAt(long!.ctx, 0), app.callAt(long!.ctx, 399)]).toEqual([500, 101, 500]);
  });

  it("draws a running worker's evenly taken line as an ended run's, Total equal to it; without the flag the last 400 where they were made (BOB-195 c3)", () => {
    const ctx = Array.from({ length: 1000 }, (_, i) => i + 1);
    const even = Array.from({ length: 400 }, (_, i) => ctx[Math.round((i * 999) / 399)]!);
    const of = (runs: Run[] = []): Detail => ({ project: "usage-x", day: days[2]!, days, runs, baseline: null, lost: 0 });
    report(live({ id: "w_even", calls: 1000, ctx: even, ctx_even: true }));
    const [run] = app.dayRuns(of());
    expect(run).toMatchObject({ first: 1, ctx: { calls: 1000, pts: even }, live: true });
    expect(run!.ctx).not.toHaveProperty("known");
    // Point i is where it was made: 1 + round(i x (calls - 1) / (pts.length - 1)), and its context here is its call.
    expect(even.map((v, i) => app.callAt(run!.ctx, i) === v)).toEqual(even.map(() => true));
    // The same run ended, as the board has it (up to 2000 points): the same Total at the end.
    const ended: Run = { id: "w_even", started_at: startToday, ended_at: iso(0), first: 1, ctx: { calls: 1000, pts: ctx } };
    expect(app.totalLine([run!]).at(-1)).toEqual({ call: 1000, sum: 500_500 });
    expect(app.totalLine([ended]).at(-1)).toEqual({ call: 1000, sum: 500_500 });
    // And with the board's points cut to the same 400, the same line throughout.
    expect(app.totalLine([run!])).toEqual(app.totalLine([{ ...ended, ctx: { calls: 1000, pts: even } }]));
    // Split over days: half its time was yesterday's, so today has its second half, call by call.
    const midnight = new Date(`${dayOf(0)}T00:00:00`).getTime();
    report(live({ id: "w_even", calls: 1000, ctx: even, ctx_even: true, started_at: new Date(midnight - (Date.now() - midnight)).toISOString() }));
    const [half] = app.dayRuns(of());
    expect(half!.first).toBeGreaterThan(480);
    expect(half!.first).toBeLessThan(520);
    expect([half!.ctx.calls, half!.ctx.pts.length]).toEqual([1001 - half!.first, 1001 - half!.first]);
    expect(half!.ctx.pts.at(-1)).toBe(1000);
    expect(Math.abs(half!.ctx.pts[0]! - half!.first)).toBeLessThanOrEqual(2);
    // An older supervisor's: `known`, as before, and Total too steep until it ends (the page says so).
    report(live({ id: "w_old", calls: 1000, ctx: ctx.slice(-400) }));
    const [old] = app.dayRuns(of());
    expect(old!.ctx).toMatchObject({ calls: 1000, known: 601 });
    expect([app.callAt(old!.ctx, 0), app.callAt(old!.ctx, 399)]).toEqual([601, 1000]);
  });

  it("resolves the old links to pages that exist, #sessions to the first project's, a malformed % too (BOB-174 c2, c7; BOB-182 c7)", async () => {
    await projectsAre([["bobnet", "BOB"], ["helix", "LAND"]]);
    const toast = "Sessions moved: who ran is on each project's page; laptops and agents are under Laptops.";
    for (const hash of ["#sessions", "#sessions/helix", "#sessions/BOB-4%20build%202", "#sessions/gone", "#sessions/%E0%A4%A"]) expect(app.oldLink(hash)).toEqual({ to: "#project/bobnet", toast });
    expect(app.oldLink("#rules")).toEqual({ to: "#laptops" });
    expect(app.oldLink("#waits")).toEqual({ to: "#needs" });
    expect(app.oldLink("#feature/BOB-4")).toEqual({ to: "#feature/bobnet/BOB-4" });
    expect(app.oldLink("#feature/LAND-50")).toEqual({ to: "#feature/helix/LAND-50" });
    // The Features tab and a feature of no project's stay today's feature view (until BOB-185), as do the links that stand.
    for (const hash of ["#feature", "#feature/helix", "#feature/%E0%A4%A", "#feature/XX-1", "#feature/bobnet/BOB-4", "#laptops", "#usage", ""]) expect(app.oldLink(hash)).toBeNull();
  });

  it("takes an old link to where it goes, with the toast of one whose parts moved (BOB-174 c2, AC13)", async () => {
    const t = $("toast");
    for (const [from, to, said] of [["#sessions", "#project/bobnet", true], ["#sessions/helix", "#project/bobnet", true], ["#rules", "#laptops", false], ["#waits", "#needs", false], ["#feature/BOB-4", "#feature/bobnet/BOB-4", false]] as const) {
      t.hidden = true;
      await go(from);
      expect(location.hash).toBe(to);
      expect(t.hidden).toBe(!said);
      if (said) expect(t.textContent).toBe("Sessions moved: who ran is on each project's page; laptops and agents are under Laptops.");
      if (said) expect([...$("tabs").querySelectorAll("[aria-current]")].map((a) => a.textContent)).toEqual(["Overview"]);
    }
    // A malformed % opens a page all the same.
    await go("#sessions/%E0%A4%A");
    expect(location.hash).toBe("#project/bobnet");
    await go("#feature/%E0%A4%A");
    expect(view().children.length).toBeGreaterThan(0);
  });

  it("highlights Features on a feature's page and no tab on Laptops; the connection goes to Laptops, warn with a quiet one (BOB-174 c1, c3)", async () => {
    await go("#feature/bobnet/BOB-4");
    expect([...$("tabs").querySelectorAll("[aria-current]")].map((a) => a.textContent)).toEqual(["Features"]);
    await go("#laptops");
    expect($("tabs").querySelector("[aria-current]")).toBeNull();
    expect($("laptops")).not.toBeNull();
    const conn = $("conn");
    conn.dataset["state"] = "live";
    expect(conn.getAttribute("href")).toBe("#laptops");
    const report = (laptop: string, at: number) => FakeSocket.last.frame({ t: "report", laptop, at: iso(at), snapshot: dashboard.laptops[0]!.snapshot });
    const names = [...app.state.laptops.keys()];
    // Every laptop this file has reported so far reports now.
    for (const l of [...names, "ubu1"]) report(l, 0);
    await settle();
    const n = new Set([...names, "ubu1"]).size;
    expect(conn.textContent).toBe(`live · ${n} laptops`);
    expect(conn.hasAttribute("data-quiet")).toBe(false);
    report("ubu1", 9);
    report("mbp-1", 0);
    await settle();
    expect(conn.textContent).toBe("1 quiet");
    expect(conn.hasAttribute("data-quiet")).toBe(true);
    // The page's own state stays live: a quiet laptop isn't a dropped connection.
    expect(conn.dataset["state"]).toBe("live");
    report("ubu1", 60 * 30);
    report("mbp-1", 0);
    await settle();
    // Over a day old it is gone, not quiet, as its banner.
    expect(conn.textContent).toBe(`live · ${n - 1} laptop${n === 2 ? "" : "s"}`);
    expect(document.getElementById("project")).toBeNull();
    expect([...$("tabs").querySelectorAll("a")].some((a) => /Sessions|Waits/.test(a.textContent!))).toBe(false);
  });

  it("reaches a second project on Roadmap, Triage and the feature view without the dropdown, and stays on the page (BOB-174 c6)", async () => {
    const pressed = () => view().querySelector('.seg.projects [aria-pressed="true"]')?.textContent;
    const to = async (name: string) => {
      ([...view().querySelectorAll<HTMLButtonElement>(".seg.projects button")].find((b) => b.textContent === name)!).click();
      window.dispatchEvent(new Event("hashchange"));
      await settle();
    };
    for (const page of ["roadmap", "triage", "feature"]) {
      await go(`#${page}/bobnet`);
      expect([page, pressed()]).toEqual([page, "bobnet"]);
      await to("helix");
      expect([page, location.hash, pressed()]).toEqual([page, `#${page}/helix`, "helix"]);
    }
    // The feature view shows that project's: helix has a laptop's board, bobnet none here.
    expect(view().querySelector("#inc-pick")).not.toBeNull();
    await to("bobnet");
    expect(view().querySelector("#inc-pick")).toBeNull();
    // Usage has every project at once, no switch (BOB-180).
    await go("#usage");
    expect(view().querySelector(".seg.projects")).toBeNull();
  });

  it("opens a page whose link names no project on the one last picked, as the dropdown's was (BOB-174 c6)", async () => {
    const pressed = () => view().querySelector('.seg.projects [aria-pressed="true"]')?.textContent;
    const to = async (name: string) => {
      ([...view().querySelectorAll<HTMLButtonElement>(".seg.projects button")].find((b) => b.textContent === name)!).click();
      window.dispatchEvent(new Event("hashchange"));
      await settle();
    };
    await go("#triage");
    expect(pressed()).toBe("bobnet");
    await go("#feature/bobnet/BOB-4");
    expect(pressed()).toBe("bobnet");
    await to("helix");
    expect([location.hash, pressed()]).toEqual(["#feature/helix", "helix"]);
  });

  it("draws the project switch on a Backlog.md roadmap too, and no switch with one project (BOB-174 c6)", async () => {
    app.state.project = null;
    await go("#roadmap");
    expect(view().querySelectorAll(".seg.projects button")).toHaveLength(2);
    await projectsAre([["helix", "LAND"]]);
    for (const page of ["#feature", "#roadmap"]) {
      await go(page);
      expect(view().querySelector(".seg.projects")).toBeNull();
    }
  });
});

describe("a project the service doesn't have (ADR 0012 §2, BOB-193)", () => {
  const answered = new Set<unknown>();
  const service = (key: string, prefix: string) => ({ key, name: key, prefix, draft_prefix: null, lead: null, po: null, repos: [] });
  const bobnet = service("bobnet", "BOB"), athletic = service("athletic", "ATH");
  const row = (project: unknown) => ({ project, release: null, release_number: null, open: [], next_ready: null, waits_on_you: null, backlog: { items: 0, bugs: 0, oldest: null }, no_release: null });
  const op = (f: Record<string, unknown>) => (f["op"] as { op?: string } | undefined)?.op;
  const pending = (name: string) => FakeSocket.last.sent.filter((f) => f["t"] === "board_op" && !answered.has(f["rid"]) && op(f) === name);
  const ok = (f: Record<string, unknown>, result: unknown) => {
    answered.add(f["rid"]);
    FakeSocket.last.frame({ t: "ok", rid: f["rid"], result });
  };
  const status = (key: string) => ({
    project: key, name: key, waits: [], stuck: { runs: [], ci: [], idle_sessions: [], idle_features: [], answered_holding: [], settled: [] }, recurring: null,
    done: { counts: { features: 0, sessions: 0, lands: 0, releases: 0 }, features: [], sessions: [], releases: [] },
    backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false },
    usage: { tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, by_agent: [], heavy: [], lost: 0 }, more: {},
  });
  /** The board's answers as they come, its list of projects as told; a refused list when it is null. */
  const answer = async (projects: Array<{ key: string }> | null) => {
    do {
      for (const f of pending("projects")) {
        if (projects) ok(f, { projects });
        else {
          answered.add(f["rid"]);
          FakeSocket.last.frame({ t: "error", rid: f["rid"], code: "internal", message: "The board is down" });
        }
      }
      for (const f of pending("overview")) ok(f, { projects: (projects ?? []).map(row) });
      for (const f of pending("waits")) ok(f, { waits: [], answered: [] });
      for (const f of pending("status")) ok(f, { at: now.toISOString(), since: iso(1440), projects: (projects ?? []).map((p) => status(p.key)) });
      await settle();
    } while (["projects", "overview", "waits", "status"].some((name) => pending(name).length > 0));
  };
  /** A retired project's board, drawn anywhere a board is: its CI failed, its session and runs, its backlog. */
  const retired = (key: string) => ({ ...board, project: key, sessions: board.sessions.map((x) => ({ ...x, name: `${key} session` })), ci: [{ ...board.ci[0]!, name: `${key}-ci` }] });
  const frames = () => {
    for (const key of ["alexa-mcp", "sandbox"]) FakeSocket.last.frame({ t: "board", laptop: "mbp-1", at: iso(1), board: retired(key) });
  };
  const read = async (project: string, projects: Array<{ key: string }> | null) => {
    FakeSocket.last.frame({ t: "board_changed", project, seq: 1, refs: [] });
    await answer(projects);
  };
  /** The projects Triage's switch offers. */
  const picker = async () => {
    await go("#triage");
    const of = [...view().querySelectorAll(".seg.projects button")].map((b) => b.textContent);
    await go("#overview");
    return of;
  };

  beforeAll(async () => {
    frames();
    await read("not-known", [bobnet, athletic]);
  });

  it("is on no list and no page, a page's project switch included; a listed one with no releases is", async () => {
    await go("#overview");
    await answer([bobnet, athletic]);
    expect([...$("plist").querySelectorAll(".prow")].map((r) => r.getAttribute("data-project"))).toEqual(["bobnet", "athletic"]);
    expect(await picker()).toEqual(["bobnet", "athletic"]);
    // Neither its CI nor its board's work, on any page that draws a laptop's board.
    expect(view().textContent).not.toMatch(/alexa|sandbox/);
    await go("#status");
    expect([...view().querySelectorAll(".pcard")].map((c) => c.getAttribute("data-project"))).toEqual(["bobnet", "athletic"]);
    await go("#status/sandbox");
    expect(view().textContent).toContain("No project sandbox on BobNet");
    await go("#usage");
    expect(view().textContent).not.toMatch(/alexa|sandbox/);
    await go("#laptops");
    const sessions = [...view().querySelectorAll(".card, li")].map((x) => x.textContent!);
    expect(sessions.some((t) => /alexa-mcp|sandbox session|sandbox-ci/.test(t))).toBe(false);
    await go("#feature");
    expect(view().textContent).not.toMatch(/alexa|sandbox/);
  });

  it("keeps a live worker and its request, whose project isn't in the service", async () => {
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers = [worker({ id: "w_s", name: "Writer", project: "sandbox", role: "writer", state: "waiting-approval", session: null, task_ref: null })] as never;
    snap.pending = [{ id: "r_s", worker_id: "w_s", name: "Writer", kind: "approval", tool: "Bash", tier: "human", created_at: iso(1), preview: "ls" }] as never;
    FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: new Date().toISOString(), snapshot: snap });
    await go("#overview");
    expect($("working").textContent).toContain("Writer");
    expect($("needs").textContent).toContain("Writer wants Bash");
    FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: new Date().toISOString(), snapshot: { ...snap, workers: [], pending: [] } });
    await settle();
  });

  it("is drawn once the service lists it, and leaves by itself when it doesn't", async () => {
    await go("#overview");
    await read("sandbox", [bobnet, athletic, service("sandbox", "SAN")]);
    expect($("plist").textContent).toContain("sandbox");
    // Its laptop's board is drawn with it: which laptop it runs on is that board's.
    expect(view().querySelector('.prow[data-project="sandbox"] .pname')!.textContent).toContain("mbp-1");
    expect(await picker()).toContain("sandbox");
    await read("not-known", [bobnet, athletic]);
    expect(view().textContent).not.toMatch(/sandbox/);
    expect(await picker()).toEqual(["bobnet", "athletic"]);
  });

  it("keeps the last list when a read of it fails", async () => {
    await go("#overview");
    await read("not-known", null);
    expect(await picker()).toEqual(["bobnet", "athletic"]);
    expect(view().textContent).not.toMatch(/alexa|sandbox/);
  });

  it("shows its reading state before the first read, and the error when that fails: never 'No project's board yet' nor a board (c2)", async () => {
    await go("#overview");
    await freshPage();
    const ws = FakeSocket.last;
    // A fresh page numbers its requests from 1 again.
    answered.clear();
    ws.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    ws.frame({ t: "ok", rid: ws.sent.find((f) => f["t"] === "dashboard")!["rid"], result: { ...dashboard, boards: [] } });
    frames();
    await settle();
    expect($("plist").textContent).toBe("Reading the board…");
    expect(view().textContent).not.toMatch(/alexa|Board unavailable/);
    await answer(null);
    expect(view().querySelector(".banner.down")!.textContent).toBe("Board unavailableThe board is down");
    expect(view().textContent).not.toContain("No project's board yet");
    expect(view().textContent).not.toMatch(/alexa/);
  });

  it("says the error on every page that lists projects, until the list is read (c2)", async () => {
    for (const hash of ["#needs", "#usage", "#triage", "#laptops", "#roadmap"]) {
      await go(hash);
      expect(view().querySelector(".banner.down")!.textContent).toBe("Board unavailableThe board is down");
    }
    // Read once the board is back.
    await go("#overview");
    await read("bobnet", [bobnet, athletic]);
    expect(view().querySelector(".banner.down")).toBeNull();
    expect([...$("plist").querySelectorAll(".prow")].map((r) => r.getAttribute("data-project"))).toEqual(["bobnet", "athletic"]);
  });
});

describe("Needs you is never stale (BOB-176; BOB-121 AC4, AC15, AC16)", () => {
  const H = 60, DAY = 24 * 60;
  const bobnet = { key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] };
  const helix = { ...HELIX, name: "Helix" };
  let ci: Record<string, unknown[] | undefined> = {};
  const overviewRow = (project: { key: string }) => ({ project, release: null, release_number: null, open: [], next_ready: null, waits_on_you: null, backlog: { items: 0, bugs: 0, oldest: null }, no_release: null, ci: ci[project.key] });
  const wait = (ref: string, min: number, over: Record<string, unknown> = {}) => ({ project: "bobnet", kind: "question", ref, feature: "BOB-3", text: `${ref} text`, recommended: null, context: null, holds: { items: [], sessions: [] }, waiting_sessions: [],
    needed_before: null, asked_by: "Mario@mbp-1", since: iso(min), blocking: true, edits: [], ...over });
  const ask = (id: string, min: number, over: Record<string, unknown> = {}) => ({ id, worker_id: "w_h", name: "Howard", kind: "approval", tool: "Bash", tier: "human", created_at: iso(min), preview: `${id} preview`, ask: { text: `${id} command`, cut: false, questions: [] }, ...over });
  const howard = worker({ id: "w_h", name: "Howard", project: "helix", role: "engineer", state: "waiting-approval", session: "LAND-50 build 2", task_ref: null });
  const snap = (over: Record<string, unknown> = {}) => ({ supervisor: { started_at: iso(900), concurrency: 2, active: 1, queued: 0 }, workers: [howard], pending: [], usage: [], decided: [], ...over });
  const report = (laptop: string, at: number, over: Record<string, unknown> = {}) => FakeSocket.last.frame({ t: "report", laptop, at: new Date(Date.now() - at * 60_000).toISOString(), snapshot: snap(over) });
  const done = new Set<unknown>();
  let waits: unknown[] = [], answered: unknown[] = [], question: Record<string, unknown> | null = null;
  /** The operations the board refuses. */
  let down: string[] = [];
  const answer = async () => {
    for (let i = 0; i < 4; i++) {
      for (const f of FakeSocket.last.sent.filter((x) => x["t"] === "board_op" && !done.has(x["rid"]))) {
        const op = f["op"] as { op: string };
        if (["mark_done", "answer_question"].includes(op.op)) continue;
        done.add(f["rid"]);
        if (down.includes(op.op)) FakeSocket.last.frame({ t: "error", rid: f["rid"], code: "unavailable", message: "The board is down" });
        else FakeSocket.last.frame({ t: "ok", rid: f["rid"], result: op.op === "projects" ? { projects: [bobnet, helix] } : op.op === "overview" ? { projects: [bobnet, helix].map(overviewRow) } : op.op === "waits" ? { waits, answered }
          : op.op === "get" ? { question } : op.op === "status" ? { at: iso(0), since: iso(DAY), projects: [] } : {} });
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    await settle();
  };
  /** A fresh page on these laptops. */
  const open = async (laptops: unknown[] = []) => {
    sessionStorage.removeItem("bobnet.open");
    await freshPage();
    done.clear();
    FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    refresh(laptops);
    await answer();
  };
  const refresh = (laptops: unknown[]) => FakeSocket.last.frame({ t: "ok", rid: FakeSocket.last.sent.findLast((f) => f["t"] === "dashboard")!["rid"], result: { ...dashboard, now: new Date().toISOString(), laptops, boards: [] } });
  const reread = async () => {
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 1, refs: [] });
    await answer();
  };
  const laptop = (name: string, at: number, over: Record<string, unknown> = {}) => ({ laptop: name, at: iso(at), snapshot: snap(over) });
  const item = (ref: string) => view().querySelector(`li.need[data-ref="${ref}"]`)!;
  const refs = (id: string) => [...($(id)?.querySelectorAll("li.need") ?? [])].map((li) => li.getAttribute("data-ref"));
  const segs = () => [...view().querySelectorAll(".bar-row .seg button")].map((b) => b.textContent);
  const click = (el: Element | null | undefined) => (el as HTMLElement).click();

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("shows a live request only under a day old, from a laptop that reports, while its worker runs; every count is what is shown (c1)", async () => {
    waits = [wait("Q-2", 30), wait("Q-1", 3 * H), wait("A-1", 5 * H, { kind: "action", blocking: false, project: "helix", feature: null }), wait("A-0", 9 * H, { kind: "action", blocking: false, project: "helix", feature: null })];
    const ended = worker({ id: "w_e", name: "Scotty", project: "helix", state: "stopped", ended_at: iso(3) });
    await open([laptop("mbp-1", 0, { workers: [howard, ended], pending: [ask("r_old", DAY + 1), ask("r_live", DAY - 1), ask("r_ended", 4, { worker_id: "w_e", name: "Scotty" }), ask("r_gone", 4, { worker_id: "w_none" }), ask("r_gone_before", 901, { worker_id: "w_none" }), ask("r_lead", 4, { tier: "orchestrator" })] }),
      laptop("ubu1", 4, { pending: [ask("r_quiet", 10)] })]);
    await go("#needs");
    // A worker the report doesn't list is past its 100, not stopped: its request stays, made since the supervisor started.
    expect(refs("needs-holding")).toEqual(["r_live", "Q-1", "Q-2", "r_gone"]);
    expect(refs("needs-rest")).toEqual(["A-0", "A-1"]);
    expect(view().querySelector(".stale-banners .banner")!.textContent).toContain("ubu1 stopped reporting");
    expect(segs()).toEqual(["All projects 6", "BobNet 2", "Helix 3"]);
    expect(view().querySelectorAll("li.need")).toHaveLength(6);
    expect($("needs-n").textContent).toBe("6");
    // The Overview: the same items, the same count.
    await go("#overview");
    expect($("needs-count").textContent).toBe($("needs-n").textContent);
    expect(view().querySelectorAll(".ov-needs li.need")).toHaveLength(6);
    expect(view().querySelector(".stale-banners .banner")).not.toBeNull();
    // Two minutes on, the one at 23 h 59 min is over a day old.
    vi.setSystemTime(now.getTime() + 2 * 60_000);
    report("mbp-1", 0, { pending: [ask("r_live", DAY - 1)] });
    await settle();
    expect(view().querySelector('[data-ref="r_live"]')).toBeNull();
    expect([$("needs-count").textContent, $("needs-n").textContent]).toEqual(["4", "4"]);
    // An active worker past the report's 100: its request stays, unless it was made before the supervisor started.
    const others = Array.from({ length: 100 }, (_, i) => worker({ id: `w_x${i}`, project: "bobnet", state: "done", ended_at: iso(5) }));
    report("mbp-1", 0, { workers: others, pending: [ask("r_old_lead", 899), ask("r_before", 901)] });
    await settle();
    expect(view().querySelector('[data-ref="r_old_lead"]')).not.toBeNull();
    expect(view().querySelector('[data-ref="r_before"]')).toBeNull();
    expect($("needs-n").textContent).toBe("5");
    // Its worker is listed and stopped: the request leaves with it.
    report("mbp-1", 0, { pending: [ask("r_new", 1)] });
    await settle();
    expect($("needs-n").textContent).toBe("5");
    report("mbp-1", 0, { workers: [{ ...howard, state: "stopped", ended_at: iso(0) }], pending: [ask("r_new", 1)] });
    await settle();
    expect(view().querySelector('[data-ref="r_new"]')).toBeNull();
    expect($("needs-n").textContent).toBe("4");
    // Answered: it leaves.
    waits = [wait("Q-2", 30)];
    await reread();
    expect([$("needs-n").textContent, refs("needs-holding")]).toEqual(["1", ["Q-2"]]);
    vi.setSystemTime(now);
  });

  it("keeps a board question while it is open, with its age in days, until it is answered or withdrawn (c2)", async () => {
    waits = [wait("Q-4", 4 * DAY + 30), wait("A-4", 4 * DAY, { kind: "action" })];
    await open([laptop("mbp-1", 0)]);
    await go("#needs");
    expect(item("Q-4").querySelector(".age")!.textContent).toBe("4 days");
    expect($("needs-n").textContent).toBe("2");
    waits = [wait("A-4", 4 * DAY, { kind: "action" })];
    await reread();
    expect(refs("needs-holding")).toEqual(["A-4"]);
    waits = [];
    await reread();
    expect(view().querySelector(".needs-page .st-empty.ok")!.textContent).toBe("Nothing needs you. Anything new shows here within a minute.");
    expect($("needs-n").textContent).toBe("");
  });

  it("says what it is up to date with, a quiet laptop left out, and that the page itself is behind when it is (c3)", async () => {
    waits = [wait("Q-1", H)];
    await open([laptop("mbp-1", 0.3), laptop("ubu1", 0.6), laptop("mini", 9)]);
    for (const page of ["#needs", "#overview"]) {
      await go(page);
      expect(view().querySelector(".fresh")!.textContent).toBe("Up to date: mbp-1 reported 18s ago, ubu1 reported 36s ago. An item leaves when it's answered or its worker stops for good.");
      expect(view().querySelector(".fresh")!.classList.contains("late")).toBe(false);
    }
    // Four minutes with no refresh of its own: it says so instead, with no frame to tell it.
    vi.setSystemTime(now.getTime() + 4 * 60_000);
    await new Promise((r) => setTimeout(r, 1000));
    await settle();
    expect(view().querySelector(".fresh")!.textContent).toBe("Last updated 4m ago");
    expect(view().querySelector(".fresh")!.classList.contains("late")).toBe(true);
    refresh([laptop("mbp-1", -4)]);
    await settle();
    expect(view().querySelector(".fresh")!.textContent).toBe("Up to date: mbp-1 reported 0s ago. An item leaves when it's answered or its worker stops for good.");
    // Its own read failed: the items stay, with when they were read.
    down = ["waits"];
    await reread();
    expect(view().querySelector(".fresh")!.textContent).toBe("Last updated 4m ago");
    expect(refs("needs-holding")).toEqual(["Q-1"]);
    down = [];
    await reread();
    expect(view().querySelector(".fresh")!.textContent).toMatch(/^Up to date: /);
  });

  it("says so too when it is cut off (c3)", async () => {
    vi.setSystemTime(now.getTime() + 4 * 60_000);
    FakeSocket.last.dispatchEvent(new Event("close"));
    await settle();
    expect(view().querySelector(".fresh")!.classList.contains("late")).toBe(true);
    vi.setSystemTime(now);
    // It connects again, so no page left behind does under the next.
    await new Promise((r) => setTimeout(r, 1100));
  });

  it("says so after a reconnect until the waits are read again (c3; Toad, review C minor 2)", async () => {
    waits = [wait("Q-1", H)];
    await open([laptop("mbp-1", 0)]);
    await go("#needs");
    expect(view().querySelector(".fresh")!.textContent).toMatch(/^Up to date: /);
    // An hour asleep, then the socket is new: the laptops are read again before the waits are.
    FakeSocket.last.dispatchEvent(new Event("close"));
    await new Promise((x) => setTimeout(x, 1100));
    vi.setSystemTime(now.getTime() + 60 * 60_000);
    FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    refresh([laptop("mbp-1", -60)]);
    expect(view().querySelector(".fresh.late")!.textContent).toBe("Last updated 1h 0m ago");
    waits = [];
    await answer();
    expect(refs("needs-holding")).toEqual([]);
    expect(view().querySelector(".fresh")!.textContent).toBe("Up to date: mbp-1 reported 0s ago. An item leaves when it's answered or its worker stops for good.");
    vi.setSystemTime(now);
  });

  it("reads again after a board_changed that came during the first read (c11)", async () => {
    waits = [wait("Q-1", H)];
    await freshPage();
    done.clear();
    FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    refresh([laptop("mbp-1", 0)]);
    const ops = (op: string) => FakeSocket.last.sent.filter((f) => (f["op"] as { op?: string } | undefined)?.op === op);
    FakeSocket.last.frame({ t: "ok", rid: ops("projects")[0]!["rid"], result: { projects: [bobnet, helix] } });
    done.add(ops("projects")[0]!["rid"]);
    await new Promise((x) => setTimeout(x, 20));
    expect(ops("waits")).toHaveLength(1);
    // Asked, and not yet answered: the change isn't in what this read answers.
    FakeSocket.last.frame({ t: "board_changed", project: "bobnet", seq: 2, refs: ["Q-2"] });
    FakeSocket.last.frame({ t: "ok", rid: ops("waits")[0]!["rid"], result: { waits: [wait("Q-1", H)], answered: [] } });
    done.add(ops("waits")[0]!["rid"]);
    waits = [wait("Q-1", H), wait("Q-2", 1)];
    await answer();
    await go("#needs");
    expect(refs("needs-holding")).toEqual(["Q-1", "Q-2"]);
  });

  describe("answering a permission (c10)", () => {
    const asked: string[] = [];
    const form = (ref: string) => item(ref).querySelector("form.answer")!;
    const press = (ref: string, label: string) => click([...form(ref).querySelectorAll("button")].find((b) => b.textContent === label));
    const type = (ref: string, words: string) => {
      const box = form(ref).querySelector("textarea") as HTMLTextAreaElement;
      box.value = words;
      box.dispatchEvent(new Event("input"));
    };
    const off = (ref: string) => [...item(ref).querySelectorAll("form.answer button, .acts button")].map((b) => (b as HTMLButtonElement).disabled);
    const ok = () => {
      const sent = FakeSocket.last.sent.at(-1)!;
      FakeSocket.last.frame({ t: "ok", rid: sent["rid"], result: { id: `act-${sent["rid"]}` } });
      return (over: Record<string, unknown> = {}) => FakeSocket.last.frame({ t: "action_result", id: `act-${sent["rid"]}`, laptop: "mbp-1", ok: true, message: "taken", ...over });
    };

    beforeAll(() => {
      globalThis.confirm = (q?: string) => (asked.push(String(q)), true);
    });

    it("takes the item and its count away at once when it is taken, until the report drops it (m3)", async () => {
      waits = [];
      await open([laptop("mbp-1", 0, { pending: [ask("r_1", 3), ask("r_2", 2)] })]);
      await go("#needs");
      click(item("r_1").querySelector(".answer-btn"));
      press("r_1", "Allow");
      const result = ok();
      expect($("needs-n").textContent).toBe("2");
      result();
      expect(refs("needs-holding")).toEqual(["r_2"]);
      expect($("needs-n").textContent).toBe("1");
      // The laptop's next report was made before it heard: still away, on a full refresh too.
      report("mbp-1", 0, { pending: [ask("r_1", 3), ask("r_2", 2)] });
      await settle();
      refresh([laptop("mbp-1", 0, { pending: [ask("r_1", 3), ask("r_2", 2)] })]);
      await settle();
      expect(refs("needs-holding")).toEqual(["r_2"]);
      report("mbp-1", 0, { pending: [ask("r_2", 2)] });
      await settle();
      expect($("needs-n").textContent).toBe("1");
    });

    it("keeps the form and his words until the result, its buttons off; refused, they are his again (m4)", async () => {
      await open([laptop("mbp-1", 0, { pending: [ask("r_1", 3)] })]);
      await go("#needs");
      click(item("r_1").querySelector(".answer-btn"));
      type("r_1", "Keep the stash");
      expect(off("r_1")).toEqual([false, false, false, false]);
      const words = () => (form("r_1").querySelector("textarea") as HTMLTextAreaElement).value;
      press("r_1", "Allow");
      expect([off("r_1"), words()]).toEqual([[true, true, true, true], "Keep the stash"]);
      // A redraw meanwhile keeps both.
      report("mbp-1", 0, { pending: [ask("r_1", 3)] });
      await settle();
      expect([off("r_1"), words()]).toEqual([[true, true, true, true], "Keep the stash"]);
      ok()({ ok: false, message: "r_1 is already answered" });
      expect($("toast").textContent).toBe("r_1 is already answered");
      expect([off("r_1"), words()]).toEqual([[false, false, false, false], "Keep the stash"]);
      // Refused by the broker, before it got to the laptop.
      press("r_1", "Deny");
      FakeSocket.last.frame({ t: "error", rid: FakeSocket.last.sent.at(-1)!["rid"], code: "offline", message: "No supervisor is online on mbp-1" });
      expect([off("r_1"), words(), $("toast").textContent]).toEqual([[false, false, false, false], "Keep the stash", "No supervisor is online on mbp-1"]);
      // Cut off before the result: his again too, and the result that comes over the next socket still closes it.
      press("r_1", "Allow");
      const result = ok();
      FakeSocket.last.dispatchEvent(new Event("close"));
      expect([off("r_1"), words(), $("toast").dataset["ok"]]).toEqual([[false, false, false, false], "Keep the stash", "warn"]);
      await new Promise((x) => setTimeout(x, 1100));
      result({ note_delivered: true });
      expect(item("r_1")).toBeNull();
      expect($("toast").textContent).toBe("Allowed Howard's Bash; your note went to Howard.");
    });

    it("gives the form back when the supervisor never answers (m4)", async () => {
      await open([laptop("mbp-1", 0, { pending: [ask("r_1", 3)] })]);
      await go("#needs");
      click(item("r_1").querySelector(".answer-btn"));
      const real = globalThis.setTimeout, late: Array<() => void> = [];
      globalThis.setTimeout = ((f: () => void, ms?: number) => (ms === 30_000 ? (late.push(f), 0) : real(f, ms))) as typeof setTimeout;
      try { press("r_1", "Deny"); } finally { globalThis.setTimeout = real; }
      ok();
      expect(off("r_1")).toEqual([true, true, true, true]);
      for (const f of late) f();
      expect([off("r_1"), $("toast").textContent]).toEqual([[false, false, false, false], "mbp-1's supervisor hasn't answered yet."]);
    });

    it("opens on the command: the item's top under the header, the note not focused (m5)", async () => {
      waits = [wait("Q-1", H)];
      await open([laptop("mbp-1", 0, { pending: [ask("r_1", 3)] })]);
      await go("#needs");
      const was = window.scrollBy, scrolled: unknown[][] = [];
      const rect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) { return { top: this.id === "w-perm/mbp-1/r_1" ? 500 : 0, bottom: this.tagName === "HEADER" ? 120 : 0 } as DOMRect; };
      window.scrollBy = ((...a: unknown[]) => void scrolled.push(a)) as typeof window.scrollBy;
      try {
        click(item("r_1").querySelector(".answer-btn"));
        expect(scrolled).toEqual([[0, 372]]);
        expect(form("r_1").contains(document.activeElement)).toBe(false);
        // A question's box is where he writes, as before.
        question = { ref: "Q-1", kind: "question", options: [] };
        click(item("Q-1").querySelector(".answer-btn"));
        expect(form("Q-1").contains(document.activeElement)).toBe(true);
        expect(scrolled).toHaveLength(1);
      } finally {
        window.scrollBy = was;
        Element.prototype.getBoundingClientRect = rect;
      }
      waits = [];
    });

    it("says in Allow's confirmation when the command is cut there, and how much of it is above (Toad 4)", async () => {
      const long = `${"x".repeat(399)}…`;
      const rows = [ask("r_1", 4, { preview: long, ask: { text: "x".repeat(2000), cut: false, questions: [] } }), ask("r_2", 3, { preview: long, ask: { text: `${"x".repeat(7999)}…`, cut: true, questions: [] } }),
        ask("r_3", 2, { preview: "pnpm test", ask: { text: "pnpm test", cut: false, questions: [] } }), ask("r_4", 1, { preview: long, ask: null })];
      await open([laptop("mbp-1", 0, { pending: rows })]);
      await go("#needs");
      const says: string[] = [];
      globalThis.confirm = (q?: string) => (says.push(String(q)), false);
      for (const ref of ["r_1", "r_2", "r_3", "r_4"]) {
        click(item(ref).querySelector(".answer-btn"));
        press(ref, "Allow");
      }
      globalThis.confirm = () => true;
      expect(says).toEqual([
        `Allow Howard to run Bash?\n\n${long}\n\nThe command is cut here; it is shown whole above.`,
        `Allow Howard to run Bash?\n\n${long}\n\nThe command is cut here; more of it is shown above.`,
        "Allow Howard to run Bash?\n\npnpm test",
        `Allow Howard to run Bash?\n\n${long}`,
      ]);
    });
  });

  describe("an orphaned request: its worker stopped by a restart (c14, c15)", () => {
    const START = 10;
    const stopped = { ...howard, state: "failed", started_at: iso(60), ended_at: iso(START) };
    const sup = { started_at: iso(START), concurrency: 2, active: 0, queued: 0 };
    const orphan = (over: Record<string, unknown> = {}) => ask("r_o", 14, { preview: "pnpm build", ask: { text: "pnpm build", cut: false, questions: [] }, ...over });
    const mbp = (over: Record<string, unknown> = {}, at = 0) => laptop("mbp-1", at, { supervisor: sup, workers: [stopped], pending: [orphan()], ...over });
    const role = (over: Record<string, unknown>) => ({ ...howard, id: "w_new", ...over });
    const shows = (laptops: unknown[]) => {
      refresh(laptops);
      return [refs("needs-holding").includes("r_o"), $("needs-n").textContent];
    };

    beforeAll(async () => {
      waits = [wait("Q-1", H)];
      await open([mbp()]);
      await go("#needs");
    });

    it("is shown and counted, in Holds work up, oldest first", async () => {
      expect(refs("needs-holding")).toEqual(["Q-1", "r_o"]);
      expect($("needs-n").textContent).toBe("2");
      expect(segs()).toEqual(["All projects 2", "BobNet 1", "Helix 1"]);
    });

    it("is not shown when any condition doesn't hold, and is again when all do", () => {
      const ubu = (w: Record<string, unknown>, at = 0) => laptop("ubu1", at, { workers: [w] });
      const not: Record<string, unknown[]> = {
        "orchestrator tier": [mbp({ pending: [orphan({ tier: "orchestrator" })] })],
        "over a day": [mbp({ pending: [orphan({ created_at: iso(DAY + 1) })] })],
        "a quiet laptop": [mbp({}, 4)],
        "created since the start": [mbp({ pending: [orphan({ created_at: iso(START - 1) })] })],
        "worker absent": [mbp({ workers: [] })],
        "worker stopped": [mbp({ workers: [{ ...stopped, state: "stopped" }] })],
        "worker done": [mbp({ workers: [{ ...stopped, state: "done" }] })],
        "a fresh worker active on the other laptop": [mbp(), ubu(role({ state: "running", started_at: iso(2) }))],
        "one queued": [mbp({ workers: [stopped, role({ state: "queued", started_at: null })] })],
        "one started since and ended": [mbp({ workers: [stopped, role({ state: "done", started_at: iso(8), ended_at: iso(5) })] })],
      };
      for (const [why, laptops] of Object.entries(not)) {
        expect([why, ...shows(laptops)]).toEqual([why, false, "1"]);
        expect(shows([mbp()])).toEqual([true, "2"]);
      }
      // Another role or project, or one of its role that ran before, doesn't count.
      const others = [role({ role: "architect", state: "running", started_at: iso(2) }), role({ id: "w_p", project: "bobnet", state: "running", started_at: iso(2) }), role({ id: "w_e", state: "done", started_at: iso(50), ended_at: iso(40) })];
      expect(shows([mbp({ workers: [stopped, ...others] })])).toEqual([true, "2"]);
      // Answered, it leaves.
      expect(shows([mbp({ pending: [] })])).toEqual([false, "1"]);
      shows([mbp()]);
    });

    it("counts a quiet laptop's last report as its role running only when made after its worker ended (c16)", () => {
      const ubu = (w: Record<string, unknown>, at: number) => laptop("ubu1", at, { workers: [role({ started_at: iso(50), ...w })] });
      for (const w of [{ state: "running" }, { state: "queued", started_at: null }]) {
        // Made before it ended, minutes or days: it can't show a replacement.
        for (const at of [START + 1, 3 * DAY]) expect([w.state, at, ...shows([mbp(), ubu(w, at)])]).toEqual([w.state, at, true, "2"]);
        // Made after it ended, though quiet since.
        expect([w.state, ...shows([mbp(), ubu(w, START - 2)])]).toEqual([w.state, false, "1"]);
        // A laptop that reports now counts.
        expect([w.state, ...shows([mbp(), ubu(w, 0)])]).toEqual([w.state, false, "1"]);
      }
      shows([mbp()]);
    });

    it("says its worker stopped, and that answering starts it again; Working now has no row for it (c15)", async () => {
      const li = () => item("r_o");
      expect(li().querySelector(".l-m")!.textContent).toBe("Helix › LAND-50 · stopped by a restart 10m ago · on mbp-1");
      expect(li().querySelector(".stopped")!.textContent).toBe("stopped by a restart 10m ago");
      expect(li().querySelector(".dot, .holds")).toBeNull();
      const foot = () => {
        click(li().querySelector(".answer-btn"));
        const said = li().querySelector(".who-gets")!.textContent;
        click(li().querySelector(".answer-btn"));
        return said;
      };
      expect(foot()).toBe("Howard stopped when mbp-1 restarted. Allow or Deny starts it again, with your decision and your note. It can't be taken back.");
      shows([mbp({ decided: undefined })]);
      expect(foot()).toBe("Howard stopped when mbp-1 restarted. Allow or Deny starts it again, with your decision; a note goes only with Deny. It can't be taken back.");
      // A question of his own can only be denied.
      shows([mbp({ pending: [orphan({ kind: "question", tool: "AskUserQuestion" })] })]);
      expect(foot()).toBe("Howard stopped when mbp-1 restarted. Deny starts it again, with your note. It can't be taken back.");
      shows([mbp()]);
      await go("#overview");
      expect(view().querySelector("#working .a-line")).toBeNull();
      expect(view().querySelector('.ov-needs [data-ref="r_o"]')).not.toBeNull();
      await go("#needs");
    });

    it("confirms and toasts that it starts again (c15)", () => {
      const asked: string[] = [];
      globalThis.confirm = (q?: string) => (asked.push(String(q)), true);
      const decide = (label: string, note: string, result: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => {
        refresh([mbp({ pending: [] })]);
        refresh([mbp(over)]);
        click(item("r_o").querySelector(".answer-btn"));
        const box = item("r_o").querySelector("form.answer textarea") as HTMLTextAreaElement;
        box.value = note;
        box.dispatchEvent(new Event("input"));
        click([...item("r_o").querySelectorAll("form.answer button")].find((b) => b.textContent === label));
        const sent = FakeSocket.last.sent.at(-1)!;
        FakeSocket.last.frame({ t: "ok", rid: sent["rid"], result: { id: `act-${sent["rid"]}` } });
        FakeSocket.last.frame({ t: "action_result", id: `act-${sent["rid"]}`, laptop: "mbp-1", ok: true, message: "r_o allowed", ...result });
        expect(item("r_o")).toBeNull();
        return [$("toast").textContent, $("toast").dataset["ok"]];
      };
      expect(decide("Allow", "")).toEqual(["Allowed Howard's Bash; it starts again on mbp-1.", "true"]);
      expect(asked.at(-1)).toBe("Allow Howard to run Bash?\n\npnpm build\n\nHoward stopped when mbp-1 restarted. Allow starts it again.");
      expect(decide("Allow", "Keep the stash", { note_delivered: true })).toEqual(["Allowed Howard's Bash; it starts again on mbp-1, with your note.", "true"]);
      expect(asked.at(-1)).toBe("Allow Howard to run Bash?\n\npnpm build\n\nHoward stopped when mbp-1 restarted. Allow starts it again.\n\nYour note goes with it.");
      expect(decide("Allow", "Keep the stash", { note_delivered: false })).toEqual(["Allowed Howard's Bash; it starts again on mbp-1, but your note didn't reach Howard (it had stopped).", "warn"]);
      expect(decide("Allow", "Keep the stash")).toEqual(["Allowed Howard's Bash; it starts again on mbp-1, but mbp-1's supervisor is older and dropped your note.", "warn"]);
      expect(decide("Allow", "Keep the stash", {}, { decided: undefined })).toEqual(["Allowed Howard's Bash; it starts again on mbp-1.", "true"]);
      expect(decide("Deny", "")).toEqual(["Denied Howard's Bash; it starts again on mbp-1.", "true"]);
      expect(decide("Deny", "Not that")).toEqual(["Denied Howard's Bash; it starts again on mbp-1, with your note.", "true"]);
      globalThis.confirm = () => true;
    });
  });

  it("sends a note with Allow where the supervisor takes one, and says what became of it (c5)", async () => {
    waits = [];
    const asked: string[] = [];
    globalThis.confirm = (q?: string) => (asked.push(String(q)), true);
    const decide = async (label: string, note: string, result: Record<string, unknown> | null) => {
      if (!item("r_1")) {
        // Taken, it left; here it is asked again.
        report("mbp-1", 0);
        report("mbp-1", 0, { pending: [ask("r_1", 3)] });
        await settle();
      }
      if (!item("r_1").querySelector("form.answer")) click(item("r_1").querySelector(".answer-btn"));
      const box = item("r_1").querySelector("form.answer textarea") as HTMLTextAreaElement;
      box.value = note;
      box.dispatchEvent(new Event("input"));
      click([...item("r_1").querySelectorAll("form.answer button")].find((b) => b.textContent === label));
      const sent = FakeSocket.last.sent.at(-1)!;
      FakeSocket.last.frame({ t: "ok", rid: sent["rid"], result: { id: `act-${sent["rid"]}` } });
      FakeSocket.last.frame({ t: "action_result", id: `act-${sent["rid"]}`, laptop: "mbp-1", ok: true, message: "r_1 allowed", ...result });
      return [$("toast").textContent, $("toast").dataset["ok"], (sent["action"] as Record<string, unknown>)["message"]];
    };
    await open([laptop("mbp-1", 0, { pending: [ask("r_1", 3)] })]);
    await go("#needs");
    click(item("r_1").querySelector(".answer-btn"));
    expect(item("r_1").querySelector(".words span")!.textContent).toBe("Note to Howard (optional)");
    expect(item("r_1").querySelector(".who-gets")!.textContent).toBe("Howard gets your decision, and your note as its next message. It can't be taken back.");
    expect(item("r_1").querySelector(".l-t code")!.textContent).toBe("r_1 command");
    const note = "Fine, keep the stash";
    expect(await decide("Allow", note, { note_delivered: true })).toEqual(["Allowed Howard's Bash; your note went to Howard.", "true", note]);
    expect(asked.at(-1)).toBe("Allow Howard to run Bash?\n\nr_1 preview\n\nYour note goes with it.");
    expect(await decide("Allow", note, { note_delivered: false })).toEqual(["Allowed Howard's Bash, but your note didn't reach Howard (it had stopped).", "warn", note]);
    expect(await decide("Allow", note, {})).toEqual(["Allowed Howard's Bash, but mbp-1's supervisor is older and dropped your note.", "warn", note]);
    expect(await decide("Allow", " ", { note_delivered: true })).toEqual(["Allowed Howard's Bash.", "true", undefined]);
    expect(await decide("Deny", note, {})).toEqual(["Denied Howard's Bash; your note went to Howard.", "true", note]);
    expect(await decide("Allow", note, { ok: false, message: "r_1 isn't pending" })).toEqual(["r_1 isn't pending", "false", note]);
    // An older supervisor's report has no decided: today's form, and Allow sends no note.
    report("mbp-1", 0, { pending: [ask("r_1", 3)], decided: undefined });
    await settle();
    expect(item("r_1").querySelector(".words span")!.textContent).toBe("Note to Howard, sent with Deny (optional)");
    expect(await decide("Allow", note, {})).toEqual(["Allowed Howard's Bash.", "true", undefined]);
  });

  it("lists what he decided from here today with the board's answers, newest first: no Undo on a permission, nothing from an older supervisor (c6)", async () => {
    // Noon, so today and yesterday are what they say wherever this runs.
    const noon = new Date(now);
    noon.setHours(12, 0, 0, 0);
    vi.setSystemTime(noon);
    const at = (h: number) => new Date(noon.getTime() - h * 3600_000).toISOString();
    const decided = (id: string, h: number, over: Record<string, unknown> = {}) => ({ id, worker_id: "w_h", name: "Howard", project: "helix", kind: "approval", tool: "Bash", created_at: at(h + 1), decided_at: at(h), decision: "allow", preview: "pnpm test", note: null, ...over });
    waits = [];
    answered = [{ project: "bobnet", ref: "Q-13", kind: "question", text: "Build it?", key: null, words: "yes", at: at(2) }];
    const mbp = { laptop: "mbp-1", at: noon.toISOString(), snapshot: snap({ decided: [decided("r_1", 1, { note: "Only the tract-edit suite" }), decided("r_2", 3, { decision: "deny", tool: "WebFetch", name: "Bender", preview: "https://example.com" }), decided("r_y", 13)] }) };
    const older = { laptop: "mini", at: noon.toISOString(), snapshot: snap({ decided: undefined }) };
    // A quiet laptop's decided rows happened all the same.
    const quiet = { laptop: "ubu1", at: at(1), snapshot: snap({ decided: [decided("r_1", 4, { project: "bobnet", kind: "question", tool: "AskUserQuestion", decision: "deny", preview: "Which one?" })] }) };
    await open([mbp, older, quiet]);
    await go("#needs");
    const rows = () => [...$("needs-answered").querySelectorAll("li.answered")];
    expect($("needs-answered").querySelector("h2 .count")!.textContent).toBe("4");
    expect(rows().map((r) => [r.getAttribute("data-ref"), r.querySelector(".badge")!.textContent])).toEqual([["r_1", "allowed"], ["Q-13", "answered"], ["r_2", "denied"], ["r_1", "denied"]]);
    expect(rows()[0]!.querySelector(".top")!.textContent).toMatch(/^allowedBashHelixtoday \d\d:\d\d/);
    expect(rows()[0]!.querySelector(".q")!.textContent).toBe("Howard wanted Bash: pnpm test");
    expect(rows()[0]!.querySelector(".said")!.textContent).toBe("You allowed it · on mbp-1your note: “Only the tract-edit suite”");
    // Never a claim that it arrived: the report doesn't say.
    expect($("needs-answered").textContent).not.toMatch(/got your note|got your decision/);
    expect(rows()[2]!.querySelector(".said")!.textContent).toBe("You denied it · on mbp-1");
    expect(rows()[2]!.getAttribute("data-decision")).toBe("deny");
    expect(rows()[3]!.querySelector(".q")!.textContent).toBe("Howard asked: Which one?");
    expect($("needs-answered").querySelector("button")).toBeNull();
    // The project switch filters them too.
    click([...view().querySelectorAll(".bar-row .seg button")].find((b) => b.textContent!.startsWith("BobNet")));
    expect(rows().map((r) => r.getAttribute("data-ref"))).toEqual(["Q-13", "r_1"]);
    click([...view().querySelectorAll(".bar-row .seg button")][0]);
    answered = [];
    vi.setSystemTime(now);
  });

  it("shows an action's options as text above Mark done, never to pick from, and marks it done whatever the read says (c7, BOB-187)", async () => {
    waits = [wait("A-9", 8 * H, { kind: "action", blocking: false, text: "Where do the restart checks run from?" }), wait("A-10", 2 * H, { kind: "action", blocking: false })];
    question = { ref: "A-9", kind: "action", options: [{ key: "a", text: "A cron entry", recommended: false }, { key: "b", text: "The supervisor's own check", recommended: true }, { key: "c", text: "By hand", recommended: false }] };
    await open([laptop("mbp-1", 0)]);
    await go("#needs");
    const form = () => item("A-9").querySelector("form.answer")!;
    click(item("A-9").querySelector(".answer-btn"));
    // Until it is read, today's form.
    expect(form().querySelector(".filed")).toBeNull();
    const box = () => form().querySelector("textarea") as HTMLTextAreaElement;
    box().value = "the second";
    box().dispatchEvent(new Event("input"));
    box().focus();
    await answer();
    expect(form().querySelector(".filed p")!.textContent).toBe("It was filed with these options:");
    expect([...form().querySelectorAll(".filed li")].map((li) => li.textContent)).toEqual(["A cron entry", "The supervisor's own check (recommended)", "By hand"]);
    expect(form().querySelectorAll("input, .filed button, .filed [tabindex]")).toHaveLength(0);
    expect([...form().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancel", "Mark done"]);
    expect(form().querySelector(".words span")!.textContent).toBe("Note (optional): if you chose one, say which");
    // His draft and his focus came through the redraw.
    expect([box().value, document.activeElement === box()]).toEqual(["the second", true]);
    click(form().querySelector('button[type="submit"]'));
    expect(FakeSocket.last.sent.at(-1)!["op"]).toEqual({ op: "mark_done", project: "bobnet", ref: "A-9", note: "the second" });
    FakeSocket.last.frame({ t: "ok", rid: FakeSocket.last.sent.at(-1)!["rid"], result: { ref: "A-9", seq: 5, told: [] } });
    await settle();
    // The read fails: today's form, and Mark done works.
    down = ["get"];
    click(item("A-10").querySelector(".answer-btn"));
    await answer();
    expect(item("A-10").querySelector(".filed")).toBeNull();
    expect(item("A-10").querySelector(".words span")!.textContent).toBe("Note (optional)");
    expect((item("A-10").querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    click(item("A-10").querySelector("form.answer .foot button"));
    down = [];
    question = null;
  });

  it("keeps his Undo on the answer's row for the two minutes the board takes it back (c6)", async () => {
    answered = [{ project: "bobnet", ref: "A-9", kind: "action", text: "Where?", key: null, words: "the second", at: new Date().toISOString() }];
    waits = [];
    await reread();
    const undo = () => $("needs-answered")?.querySelector('li[data-ref="A-9"] button');
    expect(undo()!.textContent).toBe("Undo");
    click(undo());
    expect(FakeSocket.last.sent.at(-1)!["op"]).toEqual({ op: "undo", project: "bobnet", seq: 5 });
    // Taken back, and refused or not, it isn't offered twice.
    FakeSocket.last.frame({ t: "error", rid: FakeSocket.last.sent.at(-1)!["rid"], code: "conflict", message: "Too late" });
    await answer();
    expect(undo() ?? null).toBeNull();
    // Another, left alone: it goes by itself when the two minutes are up.
    waits = [wait("A-11", H, { kind: "action", blocking: false })];
    answered = [];
    await reread();
    click(item("A-11").querySelector(".answer-btn"));
    click(item("A-11").querySelector('button[type="submit"]'));
    FakeSocket.last.frame({ t: "ok", rid: FakeSocket.last.sent.at(-1)!["rid"], result: { ref: "A-11", seq: 8, told: [] } });
    waits = [];
    answered = [{ project: "bobnet", ref: "A-11", kind: "action", text: "Where?", key: null, words: null, at: new Date().toISOString() }];
    await answer();
    const undo11 = () => $("needs-answered").querySelector('li[data-ref="A-11"] button');
    expect(undo11()!.textContent).toBe("Undo");
    vi.setSystemTime(now.getTime() + 121_000);
    await new Promise((r) => setTimeout(r, 1000));
    await settle();
    expect(undo11()).toBeNull();
    vi.setSystemTime(now);
    answered = [];
  });

  it("says what couldn't be read when every read fails, and never '0 items' nor 'Reading' (c8, m1)", async () => {
    down = ["projects", "overview", "waits", "status"];
    waits = [];
    await open([laptop("mbp-1", 0, { workers: [], pending: [] })]);
    for (const page of ["#needs", "#overview"]) {
      await go(page);
      await answer();
      expect(view().querySelector(".banner.down")!.textContent).toBe("Board unavailableThe board is down");
      expect(view().textContent).toContain("What waits on you couldn't be read.");
      expect(view().textContent).not.toMatch(/Reading the board|0 items|Nothing needs you|Nothing is held up|Up to date/);
    }
    // A live request still shows: it comes from the laptop's report.
    report("mbp-1", 0, { pending: [ask("r_1", 3)] });
    await go("#needs");
    expect(refs("needs-holding")).toEqual(["r_1"]);
    expect(view().textContent).toContain("What waits on you couldn't be read.");
    expect(view().querySelector(".bar-row .muted")).toBeNull();
    // Read once the board is back.
    down = [];
    waits = [wait("Q-1", H)];
    await reread();
    expect(view().querySelector(".banner.down")).toBeNull();
    expect(refs("needs-holding")).toEqual(["Q-1", "r_1"]);
  });

  it("reads the overview and the waits when only the projects' list fails, and names the projects from them (c8, m2, m3)", async () => {
    down = ["projects"];
    waits = [wait("Q-1", H)];
    await open([laptop("mbp-1", 0)]);
    await go("#overview");
    await answer();
    expect(view().querySelector(".banner.down")!.textContent).toBe("Board unavailableThe board is down");
    expect(refs("needs-holding")).toEqual(["Q-1"]);
    expect(item("Q-1").querySelector(".l-m")!.textContent).toBe("BobNet › BOB-3 · holds up BOB-3 · from Mario");
    expect([...$("plist").querySelectorAll(".prow")].map((r) => r.getAttribute("data-project"))).toEqual(["bobnet", "helix"]);
    expect($("working").querySelector(".l-path")!.textContent).toBe("LAND-50build 2");
    await go("#needs");
    expect(segs()).toEqual(["All projects 1", "BobNet 1", "Helix 0"]);
    down = [];
    await reread();
    expect(view().querySelector(".banner.down")).toBeNull();
  });

  describe("the CI card (BOB-178; BOB-121 AC3)", () => {
    const run = (status: string, start: number | null, end: number | null, sha: string | null, over: Record<string, unknown> = {}) => ({ name: "ci", branch: "main", status, sha, url: sha ? `https://github.com/x/y/actions/runs/${sha}` : null, started_at: start === null ? null : iso(start), ended_at: end === null ? null : iso(end), agent: null, ...over });
    const row = (name: string) => [...$("ci").querySelectorAll("li")].find((li) => li.querySelector(".ci-wf b")!.textContent === name)!;
    const words = (name: string) => row(name).querySelector(".ci-word")!.textContent;
    const dots = (name: string) => [...row(name).querySelectorAll(".ci-dot")].map((d) => d.className.replace("ci-dot ", ""));

    beforeAll(async () => {
      waits = [];
      const before = (n: number) => Array.from({ length: n }, (_, i) => run("passed", 100 + i * 60, 90 + i * 60, `aaaaaaa${i}bb`));
      ci = {
        bobnet: [{ name: "test", usual_ms: 6 * 60_000, runs: [run("failed", 130, 125, "4be01c77aa", { agent: "Toad@mbp-1", branch: "v2" }), run("cancelled", 300, 290, "0c19dd27aa"), run("queued", null, null, "1111111222")] }],
        helix: [
          { name: "ci", usual_ms: 9 * 60_000, runs: [run("running", 4, null, "7c1e2a9d01", { agent: "Howard" }), ...before(5)] },
          { name: "e2e", runs: [run("passed", 66, 52, "57e7002bfa"), ...before(2)] },
          { name: "lint", runs: [run("running", 2, null, "7c1e2a9d01")] },
          { name: "nightly", runs: [run("cancelled", 30, 20, "57e7002bfa")] },
          { name: "pages", runs: [run("queued", null, null, "7c1e2a9d01", { url: null })] },
          { name: "waiting", runs: [run("queued", 3, null, null)] },
        ],
      };
      await open([laptop("mbp-1", 0, { workers: [howard] })]);
      await go("#overview");
      await answer();
    });
    afterAll(() => {
      ci = {};
    });

    it("says each workflow's latest run in words, its mark and tone, a passed one too, from the board's CI and no laptop's", () => {
      expect([...$("ci").querySelectorAll("li")].map((li) => [li.querySelector(".ci-p")!.textContent, li.querySelector(".ci-wf b")!.textContent, li.querySelector(".ci-mark")!.textContent, li.dataset["tone"]])).toEqual([
        ["BobNet", "test", "✕", "bad"], ["Helix", "ci", "◔", "run"], ["", "e2e", "✓", "ok"], ["", "lint", "◔", "run"], ["", "nightly", "●", "idle"], ["", "pages", "○", "idle"], ["", "waiting", "○", "idle"],
      ]);
      expect(["test", "ci", "e2e", "lint", "nightly", "pages", "waiting"].map(words)).toEqual([
        "failed 2h 5m ago", "running 4m · usually 9 min", "passed 52m ago", "running 2m", "cancelled 20m ago", "queued", "queued 3m",
      ]);
      expect(row("test").querySelector(".ci-wf")!.textContent).toBe("✕test on v2");
      // A laptop's own report of CI is read nowhere on it.
      FakeSocket.last.frame({ t: "board", laptop: "mbp-1", at: iso(0), board: { ...board, ci: [{ ...board.ci[0]!, name: "from-a-laptop" }] } });
      expect(view().textContent).not.toContain("from-a-laptop");
      expect(view().querySelectorAll(".ov-side > section.ov-ci")).toHaveLength(1);
    });

    it("draws the runs before it as dots, newest first, five at most, each with its title", () => {
      expect(dots("ci")).toEqual(["ok", "ok", "ok", "ok", "ok"]);
      expect(dots("e2e")).toEqual(["ok", "ok"]);
      expect(dots("nightly")).toEqual([]);
      // Cancelled filled, queued hollow, neither of them red.
      expect(dots("test")).toEqual(["idle", "idle hollow"]);
      expect([...row("test").querySelectorAll(".ci-dot")].map((d) => d.getAttribute("title"))).toEqual(["cancelled · 0c19dd2 · 4h 50m ago", "queued · 1111111"]);
    });

    it("says who landed it when the board knows, links the run when it has one, and has no failure line", () => {
      expect(row("test").querySelector(".ci-st .muted")!.textContent).toBe(" · 4be01c7 · Toad's land");
      expect(row("ci").querySelector(".ci-st .muted")!.textContent).toBe(" · 7c1e2a9 · Howard's land");
      expect(row("e2e").querySelector(".ci-st .muted")!.textContent).toBe(" · 57e7002");
      for (const a of row("test").querySelectorAll("a.ci-wf, a.ci-link")) expect([a.getAttribute("href"), a.getAttribute("target")]).toEqual(["https://github.com/x/y/actions/runs/4be01c77aa", "_blank"]);
      expect([...row("test").querySelectorAll("a")].map((a) => a.textContent)).toEqual(["BobNet", "✕test on v2", "Run ↗"]);
      expect(row("pages").querySelectorAll("a")).toHaveLength(0);
      expect([...row("test").children].map((c) => c.className)).toEqual(["ci-p", "ci-wf", "ci-st", "ci-hist", "ci-link"]);
      expect(view().textContent).not.toMatch(/\$\d/);
    });

    it("turns only a running run's mark, and not at all under reduced motion", () => {
      expect([...$("ci").querySelectorAll(".ci-mark.spin")].map((m) => m.nextElementSibling!.textContent)).toEqual(["ci", "lint"]);
      const css = readFileSync(join(import.meta.dirname, "../public/style.css"), "utf8");
      const rules = css.split("\n").filter((l) => l.includes(".ci-mark.spin"));
      expect(rules).toEqual(["@media (prefers-reduced-motion: no-preference) { .ci-mark.spin { animation: spin 1.6s linear infinite; } }"]);
    });

    it("says a queued and a cancelled run in words that read: 4.5:1 or more in light and dark, its mark and dots in --idle (c5)", () => {
      const css = readFileSync(join(import.meta.dirname, "../public/style.css"), "utf8");
      const [light, dark] = [css.split("@media (prefers-color-scheme: dark)")[0]!, css.split("@media (prefers-color-scheme: dark)")[1]!];
      const colour = (scheme: string, name: string) => new RegExp(`--${name}: (#[0-9a-f]{6})`).exec(scheme)![1]!;
      const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
      for (const scheme of [light, dark]) expect(ratio(colour(scheme, "muted"), colour(scheme, "surface"))).toBeGreaterThanOrEqual(4.5);
      const rule = (of: string) => css.split("\n").find((l) => l.startsWith(`.ci-row[data-tone="idle"] ${of} `));
      expect(rule(".ci-word")).toContain("var(--muted)");
      expect(rule(".ci-mark")).toContain("var(--idle)");
    });

    it("has no row for a project with no CI, and no card with none at all or from an older broker", async () => {
      ci = { bobnet: [], helix: ci["helix"] };
      await reread();
      expect([...$("ci").querySelectorAll("li")].map((li) => li.querySelector(".ci-p")!.textContent)).not.toContain("BobNet");
      ci = {};
      await reread();
      expect($("ci")).toBeNull();
      expect(view().querySelector(".ov-ci")).toBeNull();
    });
  });

  describe("an agent's row: its detail, and a worker's question whole (BOB-177; BOB-121 AC14)", () => {
    const opt = (label: string, description = "") => ({ label, description });
    const four = [
      { question: "Which account owns a shared lease?", header: "Account", multi: false, options: [opt("The first grantee", "As the recorder indexes it."), opt("Both", "With a join table.")] },
      { question: "What does the partner see?", header: "Shown", multi: true, options: [opt("The line"), opt("The number", "Once recorded.")] },
      { question: "What of the note?", header: "Note", multi: false, options: [opt("It stays"), opt("It goes")] },
      { question: "A second review?", header: "", multi: false, options: [opt("Yes"), opt("No")] },
    ];
    const marvin = worker({ id: "w_m", name: "Marvin", project: "helix", role: "engineer", state: "waiting-answer", session: "LAND-50 build 2", task_ref: null, checkpoint: "migration written", remote_url: "https://claude.ai/code/x" });
    const asked = (over: Record<string, unknown> = {}) => ask("r_q", 6, { worker_id: "w_m", name: "Marvin", kind: "question", tool: "AskUserQuestion", tier: "orchestrator", preview: "Which account owns", ask: { text: four[0]!.question, cut: false, questions: four }, ...over });
    const human = ask("r_h", 14);
    const line = (name: string) => [...$("working").querySelectorAll(".a-line")].find((l) => l.querySelector(".l-who")!.textContent!.startsWith(name))!;
    const detail = (name: string) => line(name).querySelector(".a-detail")!;
    const now2 = (pending: unknown[]) => report("mbp-1", 0, { workers: [howard, marvin], pending });

    beforeAll(async () => {
      waits = [];
      await open([laptop("mbp-1", 0, { workers: [howard, marvin], pending: [asked(), human] })]);
      await go("#overview");
      await answer();
    });

    it("shows its detail on a tap: model, laptop, context, checkpoint, its links and buttons, and the question folded to its first", () => {
      click(line("Marvin").querySelector(".a-btn"));
      const d = detail("Marvin");
      expect(d.querySelector(":scope > .muted")!.textContent).toMatch(/^opus · high · mbp-1 · worked 25m · context 61k · 3 calls$/);
      expect(d.querySelector(".checkpoint")!.textContent).toBe("migration written");
      expect(d.querySelector(".ask-h")!.textContent).toBe("Marvin asks · 6m · Helix's lead, Bob, answers");
      expect(d.querySelector(".ask")!.classList.contains("folded")).toBe(true);
      expect([...d.querySelectorAll(".qt")].map((x) => x.textContent)).toEqual([four[0]!.question]);
      expect(d.querySelector(".hd")!.textContent).toBe("1 · Account");
      expect(d.querySelectorAll(".opts, .pick")).toHaveLength(0);
      const more = d.querySelector(".ask-more") as HTMLButtonElement;
      expect([more.textContent, more.hidden, more.getAttribute("aria-expanded")]).toEqual(["Show all", false, "false"]);
      expect([...d.querySelectorAll(".actions a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Open in Claude ↗", "https://claude.ai/code/x"], ["Its session →", "#feature/helix/LAND-50"]]);
      expect([...d.querySelectorAll(".grp")].map((g) => g.textContent)).toEqual(["Deny", "StopReset"]);
      // It lives here, not on Needs you: its lead answers it.
      expect($("needs").textContent).not.toContain("Marvin");
      expect($("needs-n").textContent).toBe("1");
    });

    it("opens every question on Show all, with its header, Pick one or Pick any and every option, to read and not to pick, and folds back", () => {
      click(detail("Marvin").querySelector(".ask-more"));
      const d = detail("Marvin");
      expect([...d.querySelectorAll(".aq")].map((q) => [q.querySelector(".hd")?.textContent ?? null, q.querySelector(".qt")!.textContent, q.querySelector(".pick")!.textContent])).toEqual([
        ["1 · Account", four[0]!.question, "Pick one"], ["2 · Shown", four[1]!.question, "Pick any"], ["3 · Note", four[2]!.question, "Pick one"], [null, four[3]!.question, "Pick one"],
      ]);
      expect([...d.querySelectorAll(".opts li")].map((li) => [...li.children].map((c) => c.textContent).join(": "))).toEqual([
        "The first grantee: As the recorder indexes it.", "Both: With a join table.", "The line", "The number: Once recorded.", "It stays", "It goes", "Yes", "No",
      ]);
      // BOB-161 isn't built: nothing picks.
      expect(d.querySelectorAll(".ask input, .ask button, .ask [role], .ask [tabindex]")).toHaveLength(0);
      expect(d.querySelector(".later")!.textContent).toBe("Picking an option here is BOB-161, planned for later. Today its lead answers it; Deny sends Marvin on without an answer.");
      expect(d.querySelector(".ask-more")!.textContent).toBe("Show less");
      click(d.querySelector(".ask-more"));
      expect(detail("Marvin").querySelectorAll(".aq")).toHaveLength(1);
      expect(detail("Marvin").querySelector(".later")).toBeNull();
    });

    it("stays open across redraws, one detail row at a time", async () => {
      click(detail("Marvin").querySelector(".ask-more"));
      now2([asked(), human]);
      await settle();
      await reread();
      expect(detail("Marvin").querySelectorAll(".aq")).toHaveLength(4);
      click(line("Howard").querySelector(".a-btn"));
      expect(view().querySelectorAll(".a-detail")).toHaveLength(1);
      expect(detail("Howard")).not.toBeNull();
      // Closed and opened again, the question is as he left it.
      click(line("Marvin").querySelector(".a-btn"));
      expect(view().querySelectorAll(".a-detail")).toHaveLength(1);
      expect(detail("Marvin").querySelectorAll(".aq")).toHaveLength(4);
    });

    it("points to Needs you for his own request, with no Allow or Deny there", () => {
      click(line("Howard").querySelector(".a-btn"));
      const d = detail("Howard");
      expect(d.querySelector(".ask-h")!.textContent).toBe("Howard wants Bash · 14m · on Needs you →");
      expect(d.querySelector(".ask-h a")!.getAttribute("href")).toBe("#needs");
      expect(d.querySelector(".ask")).toBeNull();
      expect([...d.querySelectorAll(".grp")].map((g) => g.textContent)).toEqual(["StopReset"]);
      click(line("Marvin").querySelector(".a-btn"));
    });

    it("says a clipped ask was cut, and shows only the preview when the laptop withheld it or is older", async () => {
      now2([asked({ ask: { text: "Which…", cut: true, questions: [{ ...four[0]!, question: "Which account owns…" }] } })]);
      await settle();
      expect(detail("Marvin").querySelector(".qt")!.textContent).toBe("Which account owns…");
      expect(detail("Marvin").querySelector(".cutnote")!.textContent).toBe("Cut at the laptop: too long to send whole.");
      for (const older of [{ ask: null }, { ask: undefined }]) {
        now2([asked(older)]);
        await settle();
        expect([...detail("Marvin").querySelector(".ask")!.children].map((c) => [c.className, c.textContent])).toEqual([["preview", "Which account owns"]]);
        expect(detail("Marvin").querySelectorAll(".aq, .ask-more, .later")).toHaveLength(0);
      }
      // An approval its lead answers: the command, and who wants it.
      now2([asked({ kind: "approval", tool: "Bash", ask: { text: "pnpm test", cut: false, questions: [] } })]);
      await settle();
      expect(detail("Marvin").querySelector(".ask-h b")!.textContent).toBe("Marvin wants Bash");
      expect(detail("Marvin").querySelector(".ask .preview")!.textContent).toBe("pnpm test");
      // An approval can be allowed; a question, never.
      expect([...detail("Marvin").querySelectorAll(".grp")].map((g) => g.textContent)).toEqual(["AllowDeny", "StopReset"]);
      expect(detail("Marvin").querySelector(".later")).toBeNull();
    });

    it("shows a question of his own whole on Needs you too", async () => {
      now2([asked({ tier: "human", id: "r_mine" })]);
      await go("#needs");
      click(item("r_mine").querySelector(".l-t"));
      expect(item("r_mine").querySelector(".l-t")!.textContent).toBe(`Marvin asks: ${four[0]!.question}`);
      expect(item("r_mine").querySelectorAll(".whole .aq")).toHaveLength(4);
    });
  });
});

describe("a reload (BOB-31)", () => {
  it("opens again what was open in this tab: the page reads it from sessionStorage", async () => {
    await go("#overview");
    sessionStorage.setItem("bobnet.open", JSON.stringify(["bobnet/Q-1", "ctx:bobnet/Q-1"]));
    // A fresh page: the dashboard loads again, over a new socket.
    await freshPage();
    const ws = FakeSocket.last;
    ws.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    const project = { key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] };
    const q1 = { project: "bobnet", kind: "question", ref: "Q-1", feature: "BOB-3", text: "A long question, and its second line.\nAccept now, or hold?", recommended: null, context: "Why.",
      holds: { items: [], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Mario@mbp-1", since: iso(60), blocking: true };
    const done = new Set<unknown>();
    const answer = () => {
      for (const f of ws.sent.filter((x) => !done.has(x["rid"]))) {
        done.add(f["rid"]);
        const op = (f["op"] as { op?: string } | undefined)?.op;
        const result = f["t"] === "dashboard" ? dashboard : op === "projects" ? { projects: [project] } : op === "overview" ? { projects: [] } : op === "waits" ? { waits: [q1], answered: [] } : {};
        ws.frame({ t: "ok", rid: f["rid"], result });
      }
    };
    for (let i = 0; i < 4; i++) {
      answer();
      await settle();
    }
    const li = $("needs").querySelector('li[data-id="bobnet/Q-1"]')!;
    expect(li.classList.contains("open")).toBe(true);
    expect(li.querySelector(".l-t")!.getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(sessionStorage.getItem("bobnet.open")!)).toEqual(["bobnet/Q-1", "ctx:bobnet/Q-1"]);
  });
});
