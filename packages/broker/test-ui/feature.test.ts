import { beforeEach, describe, expect, it } from "vitest";
import { changed, click, go, iso, open, project, refuse, reply, report, sent, settle, snapshot, text, texts, tok, view, worker, world, type Op } from "./page.ts";

// A feature's page (BOB-186; BOB-121 AC8, AC13): where it stands, what it closed without, its sessions with their runs.
// Its chain, history and who is on it are BOB-4's, in dashboard.test.ts.

const PROJECTS = [project("bobnet", "BobNet", "BOB"), project("helix", "Helix", "LAND")];
const feat = (ref: string, status: string, title: string, over: Record<string, unknown> = {}) => ({ ref, kind: "feature", type: "increment", status, title, parent: null, release: "R2", ord: 1, labels: [], progress: { checked: 180, total: 183 }, tasks: { done: 6, total: 7 }, own: { checked: 4, total: 7 }, done_at: null, open_since: null, archived_at: null, ...over });
const crit = (section: string, n: number, checked: boolean, words: string, evidence: string | null = null) => ({ section, n, text: words, evidence, state: checked ? "checked" : "open", checked_by: null, checked_at: null, casper_gate: false });
const run = (id: string, agent: string, over: Record<string, unknown> = {}) => ({ id, agent, role: agent.toLowerCase(), laptop: "mbp-1", model: "opus", effort: "high", started_at: iso(300), ended_at: iso(200), resumed: false, tokens: tok(1e6), weighted: 2e6, unknown: 0, calls: 2, ctx: [10_000, 20_000], remote_url: null, tasks: [], outcome: "done", outcome_reason: null, ...over });
const close = (over: Record<string, unknown> = {}) => ({ need: "none", waits_on: [], blockers: [], majors: [], minors_fixed: 0, sent_back: [], summary: "", handoff_path: null, handoff_text: null, commit: null, closed_by: "Mario@mbp-1", ...over });
const session = (kind: string, label: string, from: number, to: number | null, runs: unknown[], over: Record<string, unknown> = {}) => ({ feature: "BOB-51", kind, label, started_at: iso(from), ended_at: to === null ? null : iso(to), imported: false, close: to === null ? null : close(), tasks_moved: [], tokens: tok(2e6), weighted: 4e6, unknown: 0, runs, ci_runs: [], ...over });
const ASK = "The dashboard half: a worker's AskUserQuestion shown whole. Moved to BOB-121 criterion 14";

let features: Array<ReturnType<typeof feat>>;
let sessions: Array<ReturnType<typeof session>>;
let criteria: Record<string, unknown[]>;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  world.laptops = [];
  features = [
    feat("BOB-51", "Done", "A permission shown whole", { done_at: "2026-11-22T12:30:00.000Z" }),
    feat("BOB-44", "Done", "One orchestrator across laptops", { done_at: "2026-11-21T12:30:00.000Z", own: { checked: 2, total: 2 } }),
    feat("BOB-121", "Ready", "Dashboard redesign", { open_since: iso(400), own: { checked: 1, total: 3 }, tasks: { done: 9, total: 14 } }),
  ];
  criteria = {
    "BOB-51": [crit("ac", 1, false, ASK), crit("ac", 2, true, "Supervisor sends the ask", "a test"), crit("dod", 1, false, "Seen live", "Casper sees it with BOB-121")],
    "BOB-44": [crit("ac", 1, true, "A"), crit("ac", 2, true, "B")],
    "BOB-121": [crit("ac", 1, true, "The use-case map"), crit("ac", 2, false, "The prototype"), crit("dod", 1, false, "Landed")],
  };
  sessions = [
    session("build", "A", 400, 190, [run("w_1", "Luigi"), run("w_2", "Toad", { role: "toad", model: null, effort: null, outcome: "failed", outcome_reason: "land refused: CI red", tokens: tok(3e5), weighted: 3e5 }), run("w_3", "Daisy", { outcome: "lost", outcome_reason: "its laptop restarted", tokens: tok(0), weighted: 0 })]),
    session("review", "A", 180, 100, [run("w_4", "Toad", { calls: 1, ctx: [9000] })], { close: close({ majors: ["BOB-51.1"], sent_back: ["BOB-51.1"], minors_fixed: 2, summary: "One major.", commit: "abcdef1234567",
      handoff_text: "Wrote design/BOB-51/review-A.md and design/BOB-51/shots-review-A/needs-390.png; see /Users/ct/x/y.md, notes/z.md" }) }),
  ];
  world.reads = {
    projects: () => ({ projects: PROJECTS }),
    overview: () => ({ projects: [] }),
    waits: () => ({ waits: [], answered: [] }),
    list: (op: Op) => {
      if (op["of"] === "releases") return { releases: [{ ref: "R2", title: "Edit and audit", goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done: 2, total: 3 }, backlog: null }], total: 1, cursor: null };
      const items = op["of"] === "tasks" ? [{ ...feat("BOB-51.1", "Ready", "The note under the form"), kind: "task", parent: "BOB-51", tasks: null }] : op["project"] === "bobnet" ? features : [];
      return { items, total: items.length, cursor: null };
    },
    get: (op: Op) => {
      if (op["session"]) { const s = op["session"] as { kind: string; label: string }; return { session: sessions.find((x) => x.kind === s.kind && x.label === s.label) }; }
      const f = features.find((x) => x.ref === op["ref"])!;
      return { item: { ...f, description: null, criteria: criteria[f.ref], sessions: f.ref === "BOB-44" ? [] : sessions.map(({ feature, kind, label, started_at, ended_at }) => ({ feature, kind, label, started_at, ended_at })) }, history: [] };
    },
    status: (op: Op) => ({ at: new Date().toISOString(), since: op["since"], projects: [] }),
    usage: (op: Op) => ({ weights: { read_at: "2026-11-22", rows: [{ model: "claude-opus-5-5", alias: "opus", input: 2, output: 2, cache_read: 2, cache_write: 2 }] }, tz: op["tz"], days: [], projects: [] }),
  };
});
const step = (i: number) => view().querySelectorAll(".steps > li.step")[i]!;
const rows = (i: number) => [...step(i).querySelectorAll(".runs-t tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
const link = (i: number, label: string) => [...step(i).querySelectorAll(".links button")].find((b) => b.textContent!.startsWith(label));

describe("what a Done feature closed without (BOB-186 c1)", () => {
  it("folds its criteria not ticked, each with its text and where it went", async () => {
    await open("#feature/bobnet/BOB-51");
    const fold = view().querySelector("details.unticked") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(text("summary", fold)).toBe("Done 22 Nov, with 2 criteria not ticked");
    expect(texts("li", fold)).toEqual([`AC 1 ${ASK}`, "DoD 1 Seen live Casper sees it with BOB-121"]);
    expect(text(".note", fold)).toBe("BobNet's PO closed it with these open; the board keeps them as they were.");
    expect(text("#feature-head .fh-m")).toBe("done 22 Nov6 of 7 tasks done2 sessions");
    expect(view().querySelector("#feature-head")!.textContent).not.toMatch(/criteria|183/);
  });

  it("has no fold when every one is ticked, nor on a feature that isn't Done", async () => {
    await open("#feature/bobnet/BOB-44");
    expect(view().querySelector(".unticked")).toBeNull();
    expect(text(".crit-list p")).toBe("2 of 2 criteria met");
    await go("#feature/bobnet/BOB-121");
    await settle(400);
    expect(view().querySelector(".unticked")).toBeNull();
    expect(text("#feature-head .stands")).toBe("2 of 3 criteria and 5 of 14 tasks left");
    expect(texts(".crit-list li")).toEqual(["✓AC 1 The use-case map", "○AC 2 The prototype", "○DoD 1 Landed"]);
    expect(text(".crit-list p")).toBe("1 of 3 criteria met");
  });
});

describe("a session's card (BOB-186 c2, c3)", () => {
  it("has its runs: model, effort, outcome and tokens; a lost one's unknown, weighted with the switch on", async () => {
    await open("#feature/bobnet/BOB-51");
    expect(rows(0)).toEqual([
      ["Luigi luigi", "opus · high", "done", "1.0M"],
      ["Toad toad", "default model", "failed: land refused: CI red", "300k"],
      ["Daisy daisy", "opus · high", "lost: its laptop restarted", "unknown"],
    ]);
    expect(texts(".runs-t thead th", step(0))).toEqual(["Agent", "Model", "Outcome", "Tokens"]);
    localStorage.setItem("bobnet.weigh", "1");
    await open("#feature/bobnet/BOB-51");
    expect(rows(0).map((r) => r[3])).toEqual(["2.0M", "300k", "unknown"]);
    expect(text(".runs-t thead th:last-child", step(0))).toBe("Sonnet-equivalent");
    expect(text(".outcome .muted", step(0))).toBe("4.0M Sonnet-equivalent tokens");
  });

  it("has a running one's tokens so far, from its laptop, weighed with the read's table", async () => {
    sessions = [session("build", "B", 90, null, [run("w_9", "Luigi", { ended_at: null, outcome: null, tokens: tok(0), weighted: 0, calls: 0, ctx: [] })])];
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({ id: "w_9", session: "BOB-51 build B", tokens: tok(7e5) })]) }];
    await open("#feature/bobnet/BOB-51");
    expect(rows(0)).toEqual([["Luigi luigi", "opus · high", "running", "700k so far"]]);
    localStorage.setItem("bobnet.weigh", "1");
    await open("#feature/bobnet/BOB-51");
    await settle(400);
    expect(rows(0)[0]![3]).toBe("1.4M so far");
  });

  it("links a review's evidence: its findings, and the reports and shots its close names; no other session's", async () => {
    await open("#feature/bobnet/BOB-51");
    expect(link(0, "Review evidence")).toBeUndefined();
    expect(link(0, "Context per call")!.textContent).toBe("Context per call · 6 calls");
    await click(link(1, "Review evidence"));
    const ev = step(1).querySelector(".evidence")!;
    expect(texts("div > b", ev)).toEqual(["Majors", "Sent back", "Reports and shots its close names"]);
    expect(texts("li", ev)).toEqual(["BOB-51.1 The note under the form", "BOB-51.1 The note under the form", "design/BOB-51/review-A.md ↗", "design/BOB-51/shots-review-A/needs-390.png ↗", "notes/z.md"]);
    expect(ev.querySelector("a")!.getAttribute("href")).toBe("https://github.com/example/bobnet/tree/abcdef1234567/design/BOB-51/review-A.md");
    expect(text("p.muted", ev)).toBe("2 minors fixed");
    await click(link(1, "Review evidence"));
    expect(step(1).querySelector(".evidence")).toBeNull();
  });

  it("is where an old #feature/<ref> link lands, its project found by prefix (c3)", async () => {
    await open("#feature/BOB-51");
    expect(location.hash).toBe("#feature/bobnet/BOB-51");
    expect(text("#feature-head h2")).toBe("A permission shown whole");
    expect(texts("#tabs a", document)).not.toContain("Sessions");
  });
});

describe("its head (BOB-186 c4)", () => {
  it("links to its project's page and its project's features, and Features is highlighted", async () => {
    await open("#feature/bobnet/BOB-121");
    expect(texts("#feature-head .fh-top > *")).toEqual(["BOB-121", "BobNet", "R2 Edit and audit", "open"]);
    expect(view().querySelector("#feature-head .fh-top a")!.getAttribute("href")).toBe("#project/bobnet");
    expect(view().querySelector("a.back")!.getAttribute("href")).toBe("#features/bobnet");
    expect(texts("#tabs [aria-current]", document)).toEqual(["Features"]);
  });
});

describe("a live run's calls on its card (BOB-186 c5; Toad, review D minor 3)", () => {
  // 1,000 calls from 10k of context up by 10 tokens a call, as an ended run and as a live one reports it.
  const at = (i: number) => 10_000 + 10 * i;
  const whole = Array.from({ length: 1000 }, (_, i) => at(i));
  const even = Array.from({ length: 400 }, (_, i) => at(Math.round((i * 999) / 399)));
  const key = (i: number) => texts(".ctxp .key span", step(i));
  const lineOf = (i: number, k: number) => [...step(i).querySelectorAll(".ctxp svg polyline")][k]!.getAttribute("points")!.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
  const live = async (over: Record<string, unknown>) => {
    sessions = [session("build", "A", 400, 190, [run("w_1", "Luigi", { calls: 1000, ctx: whole })]), session("build", "B", 90, null, [run("w_9", "Luigi", { ended_at: null, outcome: null, tokens: tok(0), weighted: 0, calls: 0, ctx: [] })])];
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({ id: "w_9", session: "BOB-51 build B", calls: 1000, ...over })]) }];
    await open("#feature/bobnet/BOB-51");
    await click(link(1, "Context per call"));
  };

  it("Whole session sums 1,000 calls of a run whose points are evenly taken, along the ended session's line", async () => {
    await live({ ctx: even, ctx_even: true });
    expect(link(1, "Context per call")!.textContent).toBe("Context per call · 1,000 calls");
    expect(key(1)).toEqual(["build B so far · 1,000 calls", "build A · 1,000 calls"]);
    const [mine, before] = [lineOf(1, 0), lineOf(1, 1)];
    // The same run live and ended: the same line, to its end (a pixel and a half of 240).
    expect(Math.abs(mine.at(-1)![0] - before.at(-1)![0])).toBeLessThan(1);
    expect(Math.abs(mine.at(-1)![1] - before.at(-1)![1])).toBeLessThan(1.5);
    expect(step(1).querySelector(".ud-approx")).toBeNull();
    // By agent, its line is as long and at the same context.
    await click([...step(1).querySelectorAll(".ctxp .seg button")].find((b) => b.textContent === "Luigi"));
    expect(key(1)[0]).toBe("Luigi, build B · 1,000 calls");
    expect(text(".ctx-agents tbody td[data-label='Calls']", step(1))).toBe("1000");
  });

  it("without the flag its last 400 calls are where they were made, counting for the 1,000, and the panel says it is approximate", async () => {
    await live({ ctx: whole.slice(600) });
    expect(key(1)[0]).toBe("build B so far · 1,000 calls");
    const [mine, before] = [lineOf(1, 0), lineOf(1, 1)];
    expect(Math.abs(mine.at(-1)![0] - before.at(-1)![0])).toBeLessThan(1);
    // It starts at call 601, not at 1.
    expect(mine[0]![0]).toBeGreaterThan(before[0]![0] + 0.5 * (before.at(-1)![0] - before[0]![0]));
    expect(text(".ud-approx", step(1))).toBe("The session's line is approximate while Luigi runs: its laptop's supervisor reports only the last 400 calls.");
    report("mbp-1", snapshot([]));
    await settle();
  });
});

describe("what it says when the board's list isn't fresh (Toad, review E minor 2)", () => {
  it("says no such feature only when the list is read without error; else the error with Retry", async () => {
    const list = world.reads.list!;
    world.reads.list = (op: Op) => (op["of"] === "tasks" ? list(op) : refuse("D1 is down"));
    await open("#feature/bobnet/BOB-121");
    await settle(300);
    expect(view().textContent).not.toContain("No feature");
    expect(text(".banner.down")).toContain("D1 is down");
    world.reads.list = list;
    await click([...view().querySelectorAll(".banner.down button")].find((b) => b.textContent === "Retry"));
    await settle(300);
    expect(text("#feature-head h2")).toBe("Dashboard redesign");
    await go("#feature/bobnet/BOB-999");
    expect(text(".empty-card")).toBe("No feature BOB-999 in BobNet.");
  });

  it("a feature made while another page showed is read, not \"not found\"", async () => {
    await open("#feature/bobnet/BOB-121");
    await go("#overview");
    features.push(feat("BOB-99", "Draft", "Made a moment ago"));
    criteria["BOB-99"] = [];
    changed("bobnet");
    await settle(300);
    const list = world.reads.list!;
    delete (world.reads as Record<string, unknown>).list;
    const before = sent("list").length;
    await go("#feature/bobnet/BOB-99");
    expect(text(".empty-card")).toBe("Reading the board…");
    for (const f of sent("list").slice(before)) reply(f, list);
    world.reads.list = list;
    await settle(300);
    expect(text("#feature-head h2")).toBe("Made a moment ago");
  });
});

describe("its times and who is on it (Daisy, review E minors 1, 5)", () => {
  it("says a session's times on the 24-hour clock", async () => {
    await open("#feature/bobnet/BOB-51");
    expect(view().textContent).not.toMatch(/\d\d:\d\d\s?[AP]M/);
    expect(view().textContent).toMatch(/\d\d:\d\d/);
  });

  it("has no › after the step of an agent on no task", async () => {
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({ id: "w_9", name: "Marvin", project: "bobnet", role: "luigi", session: "BOB-51 build A", task_ref: "BOB-51", task_refs: [] })]) }];
    await open("#feature/bobnet/BOB-51");
    expect(text("#on-now .l-m")).toBe("build A");
  });
});
