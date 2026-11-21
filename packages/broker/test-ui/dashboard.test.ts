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

const $ = (id: string) => document.getElementById(id)!;
const view = () => $("view");
const go = async (hash: string) => {
  location.hash = hash;
  window.dispatchEvent(new Event("hashchange"));
  await settle();
};

beforeAll(async () => {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>|<link[^>]*>/g, "");
  (globalThis as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
  await import("../public/app.js");
  const ws = FakeSocket.last;
  ws.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
  const req = ws.sent.find((f) => f["t"] === "dashboard")!;
  ws.frame({ t: "ok", rid: req["rid"], result: dashboard });
});

describe("Now's parts on the Overview (BOB-5 as built 3)", () => {
  beforeAll(() => go("#now"));

  it("connects to its own host, shows live once rendered, and opens the Overview on #now, Now gone from the tabs", () => {
    expect(FakeSocket.last.url).toMatch(/\/v1\/ws$/);
    expect($("conn").dataset["state"]).toBe("live");
    expect([...$("tabs").querySelectorAll("a")].map((a) => a.textContent!.replace(/\d+$/, "").trim())).toEqual(["Overview", "Waits on you", "Status", "Roadmap", "Feature", "Triage", "Usage", "Sessions"]);
    expect($("tabs").querySelector("[aria-current]")!.getAttribute("href")).toBe("#overview");
    expect($("working").textContent).toContain("records-agent");
    expect(view().textContent).not.toMatch(/\$\d/);
  });

  it("puts a muted line per CI run in progress under Working now, a failed one in red, and nothing once it passes", async () => {
    const ws = FakeSocket.last;
    const lines = () => [...view().querySelectorAll(".ov-now .ci-line")];
    expect(lines().map((l) => l.textContent)).toEqual(["CI running: helix · ci on 437577e9 · started 5m ago"]);
    expect(lines()[0]!.hasAttribute("data-failed")).toBe(false);
    const ci = (runs: unknown[]) => ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board: { ...board, ci: runs } });
    // A failed run shows until its workflow runs again; an older failure of the same workflow doesn't.
    ci([{ name: "ci", status: "completed", conclusion: "failure", created_at: iso(5), sha: "437577e9aa00" }, { name: "ci", status: "completed", conclusion: "failure", created_at: iso(60), sha: "1111111100" }]);
    await settle();
    expect(lines().map((l) => l.textContent)).toEqual(["CI failed: helix · ci on 437577e9 · started 5m ago"]);
    expect(lines()[0]!.hasAttribute("data-failed")).toBe(true);
    ci([{ name: "ci", status: "completed", conclusion: "success", created_at: iso(2), sha: "2222222200" }, { name: "ci", status: "completed", conclusion: "failure", created_at: iso(5), sha: "437577e9aa00" }]);
    await settle();
    expect(lines()).toHaveLength(0);
    ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board });
    await settle();
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

describe("Usage", () => {
  it("charts context per call for the session, a role, and the sessions' tokens", async () => {
    await go("#usage");
    (view().querySelector(".seg button") as HTMLButtonElement).click(); // Whole session
    await settle();
    expect(view().querySelector(".key")!.textContent).toContain("LAND-41 build 3 so far · 7 calls");
    expect(view().querySelector(".key")!.textContent).toContain("LAND-41 build 2 · 2 calls");
    const roles = [...$("roles").querySelectorAll("tbody tr")].map((r) => r.querySelector("b")!.textContent);
    expect(roles).toEqual(["changesets", "records"]);
    expect($("roles").textContent).toContain("360k");

    ($("roles").querySelectorAll("tbody tr")[1] as HTMLElement).click();
    await settle();
    expect(view().querySelector(".key")!.textContent).toContain("records, LAND-41 build 3 · 3 calls");
    expect(view().querySelector(".key")!.textContent).toContain("records, LAND-41 build 2 · 2 calls");
    expect(view().querySelector(".key")!.textContent).toContain("earlier runs, middle half and median");

    const bars = view().querySelectorAll('svg[aria-label="Tokens per session"] path');
    expect(bars).toHaveLength(3);
  });
});

describe("Sessions", () => {
  it("keeps the feeds, ended workers, laptops and agents for debugging, agent text as text", async () => {
    await go("#sessions");
    expect($("updates").textContent).toContain("started");
    expect($("traffic").textContent).toContain("supervisor@mbp-1 → Bob@mbp-1");
    expect($("laptops").textContent).toContain("1 of 3 slots busy");
    expect($("agents-count").textContent).toBe("1 online of 2");
    const rows = [...$("agents").querySelectorAll("tbody tr")].map((r) => r.querySelector(".client")?.textContent);
    expect(rows).toEqual(["supervisor 0.2.0 · protocol 1", "client version unknown"]);
    const ended = $("ended").textContent!;
    expect(ended).toContain("Write a <b>haiku</b>");
    expect($("ended").querySelector("b")).toBeNull();
  });

  it("marks a laptop that stopped reporting and never offers its last requests (BOB-26)", async () => {
    const ws = FakeSocket.last;
    const old = { id: "r_old", worker_id: "w_gone", name: "Luigi", kind: "approval", tool: "Bash", tier: "human", created_at: iso(600), preview: "rm -rf dist" };
    // Its last report came 10 min ago, by the broker's clock: mbp-1's heartbeat since says what time it is now.
    const heartbeat = () => ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    ws.frame({ t: "report", laptop: "mbp-2", at: iso(10), snapshot: { supervisor: { started_at: iso(900), concurrency: 2, active: 0, queued: 0 }, workers: [], pending: [old], usage: [] } });
    heartbeat();
    await settle();
    const card = [...$("laptops").children].find((c) => c.textContent!.includes("mbp-2"))!;
    expect(card.textContent).toContain("no recent report");
    expect(card.textContent).toContain("1 request from its last report not offered");
    await go("#waits");
    expect(view().querySelector('[data-ref="r_old"]')).toBeNull();
    await go("#overview");
    expect(view().textContent).not.toContain("rm -rf dist");
    // Not dropped silently: Needs you ends with a line naming the laptop (spec, BOB-4 as built).
    expect(view().querySelector(".ov-needs .stale-line")!.textContent).toBe("mbp-2 hasn't reported for 10 min: 1 request from it waits until it does.");
    // Reporting again makes it live: its requests are offered.
    ws.frame({ t: "report", laptop: "mbp-2", at: iso(0), snapshot: { supervisor: { started_at: iso(900), concurrency: 2, active: 0, queued: 0 }, workers: [], pending: [old], usage: [] } });
    await settle();
    await go("#waits");
    expect(view().querySelector('[data-ref="r_old"]')).not.toBeNull();
    ws.frame({ t: "report", laptop: "mbp-2", at: iso(10), snapshot: { supervisor: { started_at: iso(900), concurrency: 2, active: 0, queued: 0 }, workers: [], pending: [], usage: [] } });
    heartbeat();
    await settle();
    await go("#sessions");
  });

  it("judges a report's age by the broker's clock, not this device's (Toad, BOB-26 minor 6)", async () => {
    const ws = FakeSocket.last;
    const ask = { id: "r_skew", worker_id: "w_1", name: "records-agent", kind: "approval", tool: "Bash", tier: "human", created_at: iso(12), preview: "git status" };
    // This device runs 10 min ahead: the report the broker stamps now reads 10 min old here, and is live.
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(10), snapshot: { ...dashboard.laptops[0]!.snapshot, pending: [ask] } });
    await settle();
    await go("#waits");
    expect(view().querySelector('[data-ref="r_skew"]')).not.toBeNull();
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    await settle();
    await go("#sessions");
  });

  it("filters the feed by task", async () => {
    const ws = FakeSocket.last;
    ws.frame({ t: "update", item: { seq: 2, from: "Bob@mbp-1", laptop: "mbp-1", text: "LAND-41.16 · landed", at: iso(0) } });
    await settle();
    expect($("updates").children).toHaveLength(2);
    ($("updates").querySelector(".chip") as HTMLButtonElement).click();
    expect($("updates").children).toHaveLength(1);
    expect($("updates-filter").textContent).toContain("LAND-41.16 only");
  });
});

describe("a review session", () => {
  it("becomes the session Usage shows, with no build lane marked now", async () => {
    const ws = FakeSocket.last;
    const next = structuredClone(board);
    next.sessions.push({ name: "LAND-41 review", kind: "review", started_at: iso(30), ended_at: null, workers: 1, calls: 10, tokens: tokens(5_000_000) });
    next.runs.push({ id: "w_r", name: "Bill", role: "bill", session: "LAND-41 review", task_ref: "LAND-41.16", model: "opus", effort: "high", started_at: iso(30), ended_at: iso(10), resumed: false, tokens: 5_000_000, ctx: [30000, 70000] });
    ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board: next });
    await go("#usage");
    (view().querySelector(".seg button") as HTMLButtonElement).click();
    await settle();
    expect(view().querySelector(".key")!.textContent).toContain("LAND-41 review so far · 2 calls");
    expect(view().querySelector(".key")!.textContent).not.toContain("build 3");
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

describe("the orchestrator's usage", () => {
  it("shows the orchestrator as a row beside its workers in the session", async () => {
    const ws = FakeSocket.last;
    const next = structuredClone(board) as typeof board & { sessions: Array<Record<string, unknown>> };
    next.sessions[2]!.orchestrator = { name: "Bob", calls: 40, tokens: 7_000_000 };
    next.sessions.unshift({ name: "Other work", kind: "other", started_at: iso(2000), ended_at: iso(1), workers: 0, calls: 9000, tokens: tokens(2_000_000_000), orchestrator: { name: "Bob", calls: 9000, tokens: 2_000_000_000 } });
    next.runs.push({ id: "orchestrator:LAND-41 build 3", name: "Bob", role: "Bob", session: "LAND-41 build 3", task_ref: null, model: "claude-opus-5-5", effort: null as never, started_at: iso(200), ended_at: iso(1), resumed: false, tokens: 7_000_000, ctx: [40000, 90000] });
    ws.frame({ t: "board", laptop: "mbp-1", at: iso(0), board: next });
    await go("#usage");
    await settle();
    const bob = [...$("roles").querySelectorAll("tbody tr")].find((r) => r.textContent!.includes("Bob"))!;
    expect(bob.textContent).toContain("7.0M");
    expect(bob.querySelector('[data-label="Calls"]')!.textContent).toBe("2");
    // Other work sets no scale: it has no bar.
    expect(view().querySelectorAll('svg[aria-label="Tokens per session"] path')).toHaveLength(3);
    expect(view().querySelector('svg[aria-label="Tokens per session"]')!.textContent).not.toContain("other");
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

  it("reads the service's projects on connect, and shows a project still on Backlog.md as before", async () => {
    const [projects] = pending("projects");
    expect(projects).toBeDefined();
    reply(projects!, { projects: [{ key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] }] });
    await go("#roadmap");
    expect(view().querySelector(".col-h")).not.toBeNull();
    expect([...$("project").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["helix", "bobnet"]);
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
    // With the Waits on you tab, the wording BOB-8 held back comes back (spec, BOB-8 as built, gap 3).
    expect(dlg.textContent).toContain("A bug that blocks use also goes on Waits on you until it is slotted or closed.");
    expect((dlg.querySelector("textarea") as HTMLTextAreaElement).value).toContain("The roadmap jumps");
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    const cap = pending("capture").at(-1);
    expect(cap!.op).toEqual({
      op: "capture", project: "bobnet", capture_id: expect.stringMatching(/^[0-9a-f-]{36}$/), title: "The roadmap jumps on a phone.",
      casper_words: "The roadmap jumps on a phone. It scrolls back to the top when a feature moves.", type: "bug", bug_where: "production", blocks_use: true,
    });
    reply(cap!, { ref: "BOB-131", seq: 210, duplicate: false, dropped: [] });
    await settle();
    expect($("toast").textContent).toBe("Captured as BOB-131 in BobNet's triage list, and on Waits on you.");
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
    // A line that fits shows no Show all (BOB-31).
    expect([...lines[3]!.querySelectorAll("button:not([hidden])")].map((b) => b.textContent)).toEqual(["Allow or deny"]);
    expect([...lines[0]!.querySelectorAll("button:not([hidden])")].map((b) => b.textContent)).toEqual(["Answer"]);
    expect(lines[2]!.querySelector("button:not([hidden])")).toBeNull();
    expect(lines[0]!.querySelector(".l-t")!.textContent).toBe("Which roadmap order wins?");
    // Holds-up wording (spec, BOB-3 gap 5): its own feature's session by who is in it, another's with its feature,
    // BOB-3 counted once with its session, two named then "+N more"; a session with nobody in it by kind and label.
    expect(lines[3]!.querySelector(".l-m")!.textContent).toBe("helix · LAND-41 · holds up records-agent (build 3)");
    expect(lines[0]!.querySelector(".l-m")!.textContent).toBe("BobNet · BOB-3 · holds up Luigi (build A), BOB-9 build B +1 more");
    expect(lines[1]!.querySelector(".l-m")!.textContent).toBe("BobNet · BOB-3 · holds up Fixes, review 2");
    expect(lines[2]!.querySelector(".l-m")!.textContent).toBe("BobNet · BOB-3 · blocks use");
    expect(view().querySelector(".ov-needs .more")!.textContent).toBe("4 hold work up · 1 more when you have time →");
    expect(view().querySelector(".ov-needs .more")!.getAttribute("href")).toBe("#waits");
    // The count shows on the tab too (waiting-on-casper 3).
    expect($("waits-count").textContent).toBe("5");
  });

  it("lists who is working on what from their declared sessions, and others as Other work", () => {
    const lines = [...$("working").querySelectorAll("li")];
    expect(lines.map((l) => l.querySelector(".l-who b")!.textContent)).toEqual(["records-agent", "Luigi", "Mario"]);
    expect(lines[0]!.querySelector(".dot")!.classList.contains("warn")).toBe(true);
    expect(lines[0]!.querySelector(".l-m")!.textContent).toBe("waiting on you · 1.5M tokens");
    expect(lines[0]!.querySelector(".l-path")!.textContent).toBe("helix › LAND-41build 3 › LAND-41.18land: tracts take updates");
    expect(lines[0]!.querySelector(".l-path a.id")!.getAttribute("href")).toBe("#feature/LAND-41");
    expect(lines[1]!.querySelector(".l-path")!.textContent).toBe("BobNet › BOB-3build A");
    expect(lines[1]!.querySelector(".l-m")!.textContent).toBe("2.4M tokens");
    expect(lines[2]!.querySelector(".l-path")!.textContent).toBe("BobNet › Other work (no session)");
  });

  it("gives each project a row: release, open now and who is on it, next, backlog; a Backlog.md one its name", () => {
    const rows = [...$("plist").querySelectorAll(".prow")];
    expect(rows.map((r) => r.getAttribute("data-project"))).toEqual(["bobnet", "helix"]);
    const cells = [...rows[0]!.querySelectorAll(".pc")].map((c) => c.textContent);
    expect(cells).toEqual([
      "BobNetmbp-1 · lead Mario · PO Peach",
      "Release1 R1 Central backlog view2 of 10 features done",
      "Open nowBOB-3The roadmap across projects0 of 8 criteria · Luigi on itand 1 more open",
      "NextWaits on you: Q-4Then Ready: BOB-9Move Helix's board",
      "Backlog13 items2 bugs · oldest 4 days",
    ]);
    expect(rows[0]!.querySelector(".pname a")!.getAttribute("href")).toBe("#roadmap/bobnet");
    expect(rows[0]!.querySelector('a[href="#feature/bobnet/BOB-3"]')).not.toBeNull();
    expect(rows[0]!.querySelector('a[href="#triage/bobnet"]')).not.toBeNull();
    expect(rows[1]!.textContent).toContain("Its board is still on Backlog.md");
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
    expect(view().querySelector(".ov-needs .card")!.textContent).toBe("Nothing is held up by you.");
    expect($("needs-count").textContent).toBe("");
    // Nothing waits: the count leaves the tab.
    expect($("waits-count").textContent).toBe("");
    expect(view().querySelector(".ov-now .empty-card")!.textContent).toBe("No agent is working.CI running: helix · ci on 437577e9 · started 5m ago");
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

  describe("Waits on you (BOB-5)", () => {
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
    const item = (ref: string) => view().querySelector(`.waits li[data-ref="${ref}"]`)!;
    const refs = (id: string) => [...$(id).querySelectorAll(".waits > li")].map((li) => li.getAttribute("data-ref"));
    const frameOf = (rid: string) => FakeSocket.last.sent.find((f) => f["rid"] === rid)!;

    beforeAll(async () => {
      // Two projects' boards in the service, so the list is across projects and has a project filter.
      FakeSocket.last.frame({ t: "board_changed", project: "helix", seq: 1, refs: [] });
      for (const f of pending("projects", true)) reply(f, { projects: [project, helix] });
      const snap = structuredClone(dashboard.laptops[0]!.snapshot);
      snap.workers = [worker({ state: "waiting-approval" })] as never;
      snap.pending = [perm] as never;
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
      await go("#waits");
      await answerWith([a15, gate, q258, bug, q259]);
    });

    it("is the second tab, with its count, and lists everything across projects in two groups, each oldest first (#1, #2, #6)", () => {
      expect([...document.querySelectorAll("#tabs a")].map((a) => a.getAttribute("href")).slice(0, 2)).toEqual(["#overview", "#waits"]);
      expect(document.querySelector('#tabs a[aria-current]')!.getAttribute("href")).toBe("#waits");
      expect($("waits-count").textContent).toBe("6");
      expect(refs("waits-holding")).toEqual(["BOB-12", "Q-258", "BOB-31", "r_9"]);
      expect(refs("waits-rest")).toEqual(["A-15", "Q-259"]);
      expect([...$("waits-holding").querySelectorAll(".badge")].map((b) => b.textContent)).toEqual(["review gate", "question", "bug · blocks use", "permission"]);
      // The permission is records-agent's, a Helix agent's.
      expect(view().querySelector(".bar-row")!.textContent).toBe("All projects 6BobNet 2Helix 46 items, oldest first");
    });

    it("gives each item its project, feature, age, question, recommendation, who asked, what it holds up or what it is needed before, and a link (#1, #2)", () => {
      const q = item("Q-258");
      expect(q.querySelector(".top")!.textContent).toBe("questionQ-258Helix · LAND-491 day");
      expect(q.querySelector(".top a")!.getAttribute("href")).toBe("#feature/helix/LAND-49");
      expect(q.querySelector(".q")!.textContent).toBe("Ship rehearsal 1 with the known gap?");
      // The session closed on it shows on the question, not as an item of its own (notes 23).
      // The recommendation on its own line, then the meta line with the button at its right (BOB-5 as built).
      expect(q.querySelector(".rec")!.textContent).toBe("Recommended: Ship it, note the gap");
      expect(q.querySelector(".meta")!.textContent).toBe("Holds up FixesfromBobFixes closed on it (need: casper)Open LAND-49Answer".replace("fromBob", "from Bob"));
      expect(item("Q-259").querySelector(".rec")!.nextElementSibling!.classList.contains("meta")).toBe(true);
      expect(q.querySelector(".holds")!.textContent).toBe("Holds up Fixes");
      // Needed before, muted, and no Holds up, on what waits for a later milestone (notes 35).
      expect(item("A-15").querySelector(".before")!.textContent).toBe("Needed before the demo");
      expect(item("Q-259").querySelector(".before")!.textContent).toBe("Needed before rehearsal 2 (49.13)");
      expect(item("A-15").querySelector(".holds")).toBeNull();
      expect(item("Q-259").querySelector(".holds")).toBeNull();
      expect(item("A-15").querySelector(".top .age")!.textContent).toBe("3 days");
      // A review gate and a bug stay links (notes 43); the permission holds up its agent.
      expect(item("BOB-12").querySelector("button")).toBeNull();
      expect(item("BOB-12").querySelector('a[href="#feature/bobnet/BOB-12"]')!.textContent).toBe("Open BOB-12");
      expect(item("BOB-31").querySelector('a[href="#triage/bobnet"]')!.textContent).toBe("Open in triage");
      expect(item("BOB-31").querySelector(".holds")!.textContent).toBe("Blocks use");
      expect(item("r_9").querySelector(".q")!.textContent).toBe("records-agent wants Bash");
      expect(item("r_9").querySelector(".holds")!.textContent).toBe("Holds up records-agent (build 3)");
    });

    it("filters by project, with counts", async () => {
      ([...view().querySelectorAll(".bar-row .seg button")].find((b) => b.textContent!.startsWith("Helix")) as HTMLButtonElement).click();
      expect(refs("waits-holding")).toEqual(["Q-258", "r_9"]);
      expect(refs("waits-rest")).toEqual(["A-15", "Q-259"]);
      ([...view().querySelectorAll(".bar-row .seg button")].find((b) => b.textContent!.startsWith("All")) as HTMLButtonElement).click();
      expect(refs("waits-holding")).toHaveLength(4);
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
      expect(refs("waits-holding")).toEqual(["BOB-12", "BOB-31", "r_9"]);
      expect($("waits-count").textContent).toBe("5");
      await answerWith([a15, gate, bug, q259], [{ project: "helix", ref: "Q-258", kind: "question", text: q258.text, key: "b", words: words.trim(), at: iso(0) }]);
      const done = $("waits-answered").querySelector("li")!;
      expect(done.querySelector(".said")!.textContent).toBe(`You picked Ship it, note the gap“${words.trim()}”`);
      expect(done.querySelector(".meta")!.textContent).toBe("Bob, Helix's lead, got a messagefrom the dashboard");
      // Undo, within two minutes: the board takes back his own event.
      ($("toast").querySelector("button") as HTMLButtonElement).click();
      const [undo] = pending("undo");
      expect(undo!.op).toEqual({ op: "undo", project: "helix", seq: 77 });
      reply(undo!, { ref: "Q-258", seq: 78, told: ["Bob@mbp-1"] });
      await settle();
      expect($("toast").textContent).toBe("Undone: Q-258 waits on you again; sent to Bob.");
      await answerWith([a15, gate, q258, bug, q259]);
      expect(refs("waits-holding")).toContain("Q-258");
      expect($("waits-answered")).toBeNull();
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
      const box = form.querySelector("textarea") as HTMLTextAreaElement;
      box.value = "Room 2, Thursday";
      box.dispatchEvent(new Event("input"));
      (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      const [op] = pending("mark_done");
      expect(op!.op).toEqual({ op: "mark_done", project: "helix", ref: "A-15", note: "Room 2, Thursday" });
      reply(op!, { ref: "A-15", seq: 80, told: ["Bob@mbp-1", "Peach@mbp-1"] });
      await settle();
      expect($("toast").textContent).toBe("Marked A-15 done. Recorded as your words; sent to Bob and Peach.Undo");
      await answerWith([gate, q258, bug, q259], [{ project: "helix", ref: "A-15", kind: "action", text: a15.text, key: null, words: "Room 2, Thursday", at: iso(0) }]);
      expect($("waits-answered").querySelector(".badge")!.textContent).toBe("done");
      expect($("waits-answered").querySelector("blockquote")!.textContent).toBe("“Room 2, Thursday”");
    });

    it("allows or denies a permission, the note only with Deny, confirming Allow as today, no Undo (#5; BOB-5 as built 1, 2)", async () => {
      (item("r_9").querySelector(".answer-btn") as HTMLButtonElement).click();
      const form = () => item("r_9").querySelector("form.answer")!;
      expect(form().querySelector(".preview")!.textContent).toBe("git push origin HEAD");
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
      expect(item("r_9").querySelector("form.answer")).toBeNull();
      FakeSocket.last.frame({ t: "ok", rid: allow["rid"], result: { id: "a_allow" } });
      FakeSocket.last.frame({ t: "action_result", id: "a_allow", laptop: "mbp-1", ok: true, message: "r_9 allowed" });
      expect($("toast").textContent).toBe("Allowed records-agent's Bash.");
      expect($("toast").querySelector("button")).toBeNull();
      // Deny needs no confirmation; its note goes, and the toast says so.
      (item("r_9").querySelector(".answer-btn") as HTMLButtonElement).click();
      box.value = "";
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
      (item("r_9").querySelector(".answer-btn") as HTMLButtonElement).click();
      const empty = form().querySelector("textarea") as HTMLTextAreaElement;
      empty.value = "";
      empty.dispatchEvent(new Event("input"));
      ([...form().querySelectorAll("button")].find((b) => b.textContent === "Deny") as HTMLButtonElement).click();
      FakeSocket.last.frame({ t: "ok", rid: FakeSocket.last.sent.at(-1)!["rid"], result: { id: "a_deny2" } });
      FakeSocket.last.frame({ t: "action_result", id: "a_deny2", laptop: "mbp-1", ok: true, message: "r_9 denied" });
      expect($("toast").textContent).toBe("Denied records-agent's Bash.");
      FakeSocket.last.frame({ t: "action_result", id: "a_other", laptop: "mbp-1", ok: false, message: "r_9 isn't pending" });
      expect($("toast").textContent).toBe("r_9 isn't pending");
      // No line under Answered from here today for a permission.
      expect($("waits-answered")?.querySelector('[data-ref="r_9"]') ?? null).toBeNull();
    });

    it("names a permission's session by its step on both lists: Holds up records-agent (Fixes) (BOB-5 as built)", async () => {
      const snap = structuredClone(dashboard.laptops[0]!.snapshot);
      snap.workers = [worker({ state: "waiting-approval", session: "LAND-41 build Fixes" })] as never;
      snap.pending = [perm] as never;
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
      await settle();
      expect(item("r_9").querySelector(".holds")!.textContent).toBe("Holds up records-agent (Fixes)");
      await go("#overview");
      const line = [...$("needs").querySelectorAll("li")].find((l) => l.textContent!.includes("records-agent wants Bash"))!;
      expect(line.querySelector(".l-m")!.textContent).toBe("Helix · LAND-41 · holds up records-agent (Fixes)");
      snap.workers = [worker({ state: "waiting-approval" })] as never;
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
      await go("#waits");
    });

    it("answers from the Overview's Needs you in place, with the same form (notes 40)", async () => {
      await go("#overview");
      await answerWith([q258]);
      const line = () => [...$("needs").querySelectorAll("li")].find((li) => li.textContent!.includes("Ship rehearsal"))!;
      (line().querySelector(".answer-btn") as HTMLButtonElement).click();
      expect(line().querySelector("form.answer .opt-row")!.textContent).toBe("Ship it, note the gaprecommended");
      (line().querySelector("form.answer button[type=button]") as HTMLButtonElement).click();
    });

    it("drops an item once its source says it is answered, keeping nothing of its own (#3)", async () => {
      await go("#waits");
      FakeSocket.last.frame({ t: "board_changed", project: "helix", seq: 99, refs: ["Q-258"] });
      await answerWith([]);
      const snap = structuredClone(dashboard.laptops[0]!.snapshot);
      snap.pending = [];
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
      await settle();
      expect($("waits-holding").textContent).toBe("Holds work up Nothing is held up by you.");
      expect($("waits-count").textContent).toBe("");
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
    const more = (id: string) => line(id).querySelector(".acts .more-t") as HTMLButtonElement;
    const shown = (id: string) => [...line(id).querySelectorAll("button:not([hidden])")].map((b) => b.textContent);
    const report = (pend: unknown[]) => {
      const snap = structuredClone(dashboard.laptops[0]!.snapshot);
      snap.workers = [worker({ state: "waiting-answer" })] as never;
      snap.pending = pend as never;
      FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    };
    // happy-dom lays nothing out: a line's text is as wide as its characters, 7 px each, in a 300 px column.
    const lt = (el: Element) => el.classList.contains("l-t");
    beforeAll(async () => {
      Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get() { return lt(this) ? this.textContent!.length * 7 : 0; } });
      Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return lt(this) ? 300 : 0; } });
      sessionStorage.removeItem("bobnet.open");
      report([perm]);
      await go("#overview");
      await answerWith([q1, q7, gate, a12, old]);
    });
    afterAll(async () => {
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      report([]);
      sessionStorage.removeItem("bobnet.open");
      await answerWith([]);
    });

    it("shows Show all on a cut line and none on one that fits", () => {
      expect(shown("bobnet/Q-1")).toEqual(["Show all", "Answer"]);
      expect(shown("perm/mbp-1/r_4")).toEqual(["Show all", "Allow or deny"]);
      expect(shown("bobnet/Q-7")).toEqual(["Answer"]);
      expect(shown("bobnet/BOB-5")).toEqual([]);
      expect(line("bobnet/Q-1").querySelector(".l-t")!.hasAttribute("data-cut")).toBe(true);
      expect(line("bobnet/Q-7").querySelector(".l-t")!.hasAttribute("data-cut")).toBe(false);
      expect(line("bobnet/Q-1").querySelector(".whole")).toBeNull();
    });

    it("opens to the whole text, its line breaks kept, the recommendation and the context link; Show less folds it", async () => {
      const b = more("bobnet/Q-1");
      // A button the keyboard reaches; Enter on it is a click.
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
      expect(b.getAttribute("tabindex")).toBeNull();
      expect([b.getAttribute("aria-expanded"), b.getAttribute("aria-controls"), b.getAttribute("aria-label")]).toEqual(["false", "t-bobnet/Q-1", "Show all of Q-1"]);
      expect(line("bobnet/Q-1").querySelector(".l-t")!.getAttribute("title")).toBe(long);
      b.focus();
      b.click();
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(true);
      const t = line("bobnet/Q-1").querySelector(".l-t")!;
      expect(t.id).toBe("t-bobnet/Q-1");
      expect(t.textContent).toBe(long);
      expect(t.textContent).toContain("\n");
      expect(t.hasAttribute("title")).toBe(false);
      const whole = line("bobnet/Q-1").querySelector(".whole")!;
      expect(whole.querySelector(".rec")!.textContent).toBe("Recommended Accept the scale test now");
      expect(whole.querySelector("a")!.textContent).toBe("Its context, on Waits on you →");
      expect(whole.querySelector("a")!.getAttribute("href")).toBe("#waits");
      // The context itself stays off the Overview.
      expect(view().querySelector(".ov-needs")!.textContent).not.toContain("700 tasks");
      expect(shown("bobnet/Q-1")).toEqual(["Show less", "Answer"]);
      expect([more("bobnet/Q-1").getAttribute("aria-expanded"), more("bobnet/Q-1").getAttribute("aria-label")]).toEqual(["true", "Show less of Q-1"]);
      // DOM order: badge, text, what opened, meta, acts.
      expect([...line("bobnet/Q-1").children].map((c) => c.className)).toEqual(["badge", "l-t", "whole", "l-m", "acts"]);
      // A short question with no recommendation or context opens to nothing more than its text.
      more("bobnet/Q-1").click();
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(false);
      expect(line("bobnet/Q-1").querySelector(".whole")).toBeNull();
      expect(shown("bobnet/Q-1")).toEqual(["Show all", "Answer"]);
    });

    it("opens from a tap on the cut text, but not while text is selected, and not on a line that fits", () => {
      const sel = vi.spyOn(globalThis, "getSelection").mockReturnValue({ toString: () => "map tiles" } as Selection);
      (line("perm/mbp-1/r_4").querySelector(".l-t") as HTMLElement).click();
      expect(line("perm/mbp-1/r_4").classList.contains("open")).toBe(false);
      sel.mockRestore();
      (line("perm/mbp-1/r_4").querySelector(".l-t") as HTMLElement).click();
      expect(line("perm/mbp-1/r_4").classList.contains("open")).toBe(true);
      expect(line("perm/mbp-1/r_4").querySelector(".l-t")!.textContent).toBe(`records-agent asks: ${perm.preview}`);
      expect(more("perm/mbp-1/r_4").getAttribute("aria-label")).toBe("Show less of records-agent's question");
      (line("bobnet/Q-7").querySelector(".l-t") as HTMLElement).click();
      expect(line("bobnet/Q-7").classList.contains("open")).toBe(false);
      more("perm/mbp-1/r_4").click();
    });

    it("opens the line when Answer is pressed; a redraw and a Show less keep the pick, the words and the caret", async () => {
      (line("bobnet/Q-1").querySelector(".answer-btn") as HTMLButtonElement).click();
      reply(pending("get")[0]!, { question: { ref: "Q-1", options: [{ key: "fixture", text: "Accept the scale test now", recommended: true }, { key: "hold", text: "Hold AC 8", recommended: false }] } });
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
      // Show less redraws at once: the line folds, the form, the pick, the words and the caret stay.
      more("bobnet/Q-1").click();
      expect(line("bobnet/Q-1").classList.contains("open")).toBe(false);
      expect(box().value).toBe("Fixture is fine, and note it on BOB-9");
      expect(document.activeElement).toBe(box());
      expect(box().selectionStart).toBe(8);
      expect((line("bobnet/Q-1").querySelector('input[value="hold"]') as HTMLInputElement).checked).toBe(true);
      // Closing the form leaves the line as it is; Show all opens it again, the form untouched.
      more("bobnet/Q-1").click();
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
      await go("#waits");
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

    it("on Waits on you keeps the line breaks and shows Show context / Hide context only where there is a context", async () => {
      await go("#waits");
      const it = (ref: string) => view().querySelector(`.waits li[data-ref="${ref}"]`)!;
      expect(it("Q-1").querySelector(".q")!.textContent).toBe(long);
      expect(it("A-12").querySelector(".q")!.textContent).toBe("Sign the Mapbox terms.\nThe link is in lead/questions.md.");
      for (const ref of ["Q-7", "BOB-5", "Q-8"]) expect(it(ref).querySelector(".ctx-row")).toBeNull();
      const b = () => it("A-12").querySelector(".ctx-row button") as HTMLButtonElement;
      expect([b().textContent, b().getAttribute("aria-expanded"), b().getAttribute("aria-controls")]).toEqual(["Show context", "false", "c-bobnet/A-12"]);
      expect(it("A-12").querySelector(".ctx")).toBeNull();
      b().click();
      expect([b().textContent, b().getAttribute("aria-expanded")]).toEqual(["Hide context", "true"]);
      expect(it("A-12").querySelector(".ctx")!.id).toBe("c-bobnet/A-12");
      expect(it("A-12").querySelector(".ctx")!.textContent).toBe("Free tier: 50,000 loads a month.");
      // Above the meta line.
      expect([...it("A-12").children].map((c) => c.className)).toEqual(["top", "q", "ctx-row", "meta"]);
      b().click();
      expect(it("A-12").querySelector(".ctx")).toBeNull();
      expect(b().textContent).toBe("Show context");
    });

    it("lands the Overview's context link on Waits on you with that context open and scrolled into view", async () => {
      await go("#overview");
      more("bobnet/Q-1").click();
      const into = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
      (line("bobnet/Q-1").querySelector(".whole a") as HTMLAnchorElement).click();
      await go("#waits");
      const it = view().querySelector('.waits li[data-ref="Q-1"]')!;
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
        { source: "github-actions", external_id: "4812", name: "e2e (staging)", url: "https://github.com/cath42/bobnet-mcp/actions/runs/4812", repo: "cath42/bobnet-mcp", branch: "v2", sha: "abc", laptop: null, status: "running", started_at: iso(12), ended_at: null, worker: "w_l", usual_ms: 20 * 60_000 },
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
    expect(line("Luigi").querySelector(".l-path")!.textContent).toBe("BobNet › BOB-4Fixes › BOB-42 · BOB-43");
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

  it("answers on top: Needs you and Is it going OK?, then one card per project, an old board's muted, and Needs you across projects (c2, c3)", async () => {
    const answers = [...view().querySelectorAll(".answers .ans")];
    expect(answers.map((a) => a.querySelector("b")!.textContent)).toEqual(["1", "Needs a look"]);
    expect(answers[0]!.querySelector(".sub")!.textContent).toBe("1 holds work up · oldest 1\u00a0d");
    expect(answers[1]!.querySelector(".sub")!.textContent).toBe("2 stuck · 2 done");
    expect(answers[0]!.getAttribute("href")).toBe("#status/needs");
    const card = view().querySelector('.pcard[data-project="bobnet"]')!;
    expect(card.getAttribute("href")).toBe("#status/bobnet");
    expect([...card.querySelectorAll(".pstat")].map((s) => s.textContent)).toEqual(["Needs you1", "Done21 feature", "Stuck2", "Tokens8.3M+ 1 unknown"]);
    expect([...card.querySelectorAll(".pflags .badge")].map((b) => b.textContent)).toEqual(["Run failed", "backlog thin", "R2 has nothing Ready"]);
    // helix is reported by a laptop and isn't on the service: its card says so and isn't a link.
    const old = view().querySelector('.pcard.old[data-project="helix"]')!;
    expect(old.tagName).toBe("DIV");
    expect(old.textContent).toContain("Its board is still on Backlog.md; Status starts when it moves to BobNet.");
    const needs = $("status-needs");
    expect(needs.querySelector("li .l-t")!.getAttribute("href")).toBe("#waits");
    expect(needs.querySelector("li .l-m")!.textContent).toContain("BobNet · BOB-9 · holds up");
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
    expect(view().textContent).toContain("Its board is still on Backlog.md; Status starts when it moves to BobNet.");
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
    expect(line.textContent).toMatch(/^Since .+: 2 done, 2 stuckStatus ›$/);
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
    await answerStatus(rows);
    await answerStatus(rows);
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

  it("puts the spawner on an ended worker's card in Sessions", async () => {
    const snap = { supervisor: { started_at: iso(300), concurrency: 3, active: 0, queued: 0 }, pending: [], usage: [],
      workers: [worker({ id: "w_e", name: "Luigi", project: "bobnet", role: "luigi", state: "done", ended_at: iso(2), remote_from: "supervisor@mbp-1", remote_by: "poe" })] };
    FakeSocket.last.frame({ t: "report", laptop: "ubu1", at: iso(0), snapshot: snap });
    await go("#sessions");
    const card = [...$("ended").querySelectorAll(".card")].find((c) => c.textContent!.includes("w_e"))!;
    expect(card.querySelector(".sub")!.textContent).toMatch(/· ubu1 · .*· spawned by poe@mbp-1$/);
    FakeSocket.last.frame({ t: "report", laptop: "ubu1", at: iso(0), snapshot: { ...snap, workers: [] } });
    FakeSocket.last.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: helixOnMbp });
    await settle();
  });
});

describe("a reload (BOB-31)", () => {
  it("opens again what was open in this tab: the page reads it from sessionStorage", async () => {
    await go("#overview");
    sessionStorage.setItem("bobnet.open", JSON.stringify(["bobnet/Q-1", "ctx:bobnet/Q-1"]));
    // A fresh page: the dashboard loads again, over a new socket.
    vi.resetModules();
    await import("../public/app.js");
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
    expect(li.querySelector(".acts .more-t")!.textContent).toBe("Show less");
    expect(JSON.parse(sessionStorage.getItem("bobnet.open")!)).toEqual(["bobnet/Q-1", "ctx:bobnet/Q-1"]);
  });
});
