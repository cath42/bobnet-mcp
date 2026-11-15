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

describe("Now", () => {
  it("connects to its own host and shows live once rendered", () => {
    expect(FakeSocket.last.url).toMatch(/\/v1\/ws$/);
    expect($("conn").dataset["state"]).toBe("live");
    expect($("now-count").textContent).toBe("1");
  });

  it("shows who is running, on what task, with model, machine, tokens and context, and CI being waited on", () => {
    const row = $("running").querySelector("tbody tr")!.textContent!;
    expect(row).toContain("records-agent");
    expect(row).toContain("LAND-41.18");
    expect(row).toContain("land: tracts take updates");
    expect(row).toContain("opus · high");
    expect(row).toContain("mbp-1");
    expect(row).toContain("1.5M");
    expect(row).toContain("61k · 3 calls");
    expect(view().textContent).toContain("Waiting on CI");
    expect(view().textContent).not.toMatch(/\$\d/);
    expect($("running").querySelector("a")).toBeNull();
  });

  it("flags a running worker quiet for 15 minutes or more, for Casper to judge", async () => {
    expect($("running").querySelector(".quiet")).toBeNull();
    const ws = FakeSocket.last;
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers = snap.workers.map((w) => (w.state === "running" ? { ...w, last_event_at: iso(16) } : w)) as never;
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    await settle();
    expect($("running").querySelector(".quiet")!.textContent).toBe("quiet 16 min");
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    await settle();
  });

  it("links a worker running with Remote Control to its session", async () => {
    const ws = FakeSocket.last;
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers = snap.workers.map((w) => (w.state === "running" ? { ...w, remote_url: "https://claude.ai/code/session_abc" } : w)) as never;
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    await settle();
    const link = $("running").querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://claude.ai/code/session_abc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toBe("Open in Claude ↗");
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: dashboard.laptops[0]!.snapshot });
    await settle();
  });

  it("sends actions for pending requests and running workers, confirming the risky ones", async () => {
    const ws = FakeSocket.last;
    const snap = structuredClone(dashboard.laptops[0]!.snapshot);
    snap.workers[0] = worker({ state: "waiting-approval" });
    snap.pending.push({ id: "r_9", worker_id: "w_1", name: "records-agent", kind: "approval", tool: "Bash", tier: "human", created_at: iso(0), preview: "git push origin HEAD:main" } as never);
    ws.frame({ t: "report", laptop: "mbp-1", at: iso(0), snapshot: snap });
    await settle();
    expect($("needs-list").textContent).toContain("git push origin HEAD:main");
    expect($("needs-list").textContent).toContain("needs you");

    const asked: string[] = [];
    let answer = false;
    globalThis.confirm = (q?: string) => (asked.push(String(q)), answer);
    const buttons = (root: Element) => [...root.querySelectorAll("button")] as HTMLButtonElement[];
    const allow = buttons($("needs-list")).find((b) => b.textContent === "Allow")!;
    allow.click(); // declined
    expect(asked[0]).toContain("git push origin HEAD:main");
    expect(ws.sent.filter((f) => f["t"] === "action")).toHaveLength(0);
    answer = true;
    allow.click();
    expect(ws.sent.filter((f) => f["t"] === "action").at(-1)).toMatchObject({ laptop: "mbp-1", action: { kind: "answer", request: "r_9", decision: "allow" } });
    expect(allow.disabled).toBe(true);
    ws.frame({ t: "action_result", id: "a_1", laptop: "mbp-1", ok: true, message: "r_9 allowed" });
    expect($("toast").textContent).toBe("r_9 allowed");

    const stop = buttons($("running")).find((b) => b.textContent === "Stop")!;
    stop.click();
    expect(ws.sent.filter((f) => f["t"] === "action").at(-1)).toMatchObject({ action: { kind: "stop", worker: "w_1" } });
    // Stop doesn't also open the agent's chart.
    expect(location.hash).not.toBe("#usage");
  });

  it("shows a refused action and re-enables its button", () => {
    const ws = FakeSocket.last;
    const deny = [...$("needs-list").querySelectorAll("button")].find((b) => b.textContent === "Deny") as HTMLButtonElement;
    deny.click();
    const rid = ws.sent.at(-1)!["rid"];
    ws.frame({ t: "error", rid, code: "offline", message: "No supervisor is online on mbp-1" });
    expect($("toast").textContent).toBe("No supervisor is online on mbp-1");
    expect($("toast").dataset["ok"]).toBe("false");
    expect(deny.disabled).toBe(false);
  });

  it("opens an agent's context per call when its row is clicked", async () => {
    ($("running").querySelector("tbody tr") as HTMLElement).click();
    await settle();
    expect(location.hash).toBe("#usage");
    expect(view().textContent).toContain("showing records-agent's run");
    expect(view().querySelector("#role-pick option[selected]")!.textContent).toBe("records");
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
    await go("#now");
    // Two items and no headline: a chip each, never a stringified array.
    const homer = [...$("running").querySelectorAll("tbody tr")].find((r) => r.textContent!.includes("Homer"))!;
    expect(homer.textContent).not.toContain("[object");
    expect(homer.querySelectorAll(".chip")).toHaveLength(2);
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
  /** Answers every list the page is waiting on with the board above. */
  const lists = async (rs = releases, fs = features) => {
    for (const f of pending("list")) reply(f, f.op["of"] === "releases" ? { releases: rs, total: rs.length, cursor: null } : { items: fs, total: fs.length, cursor: null });
    await settle();
  };
  const toastEl = () => $("toast");

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
    expect(toastEl().textContent).toContain("Moved BOB-7 to R2 Start a session, last in its order (Peach orders it). Recorded as yours.");
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
    expect(toastEl().textContent).toContain("Moved BOB-7 to R2");
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
