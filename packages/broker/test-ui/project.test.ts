import { beforeEach, describe, expect, it } from "vitest";
import { $, changed, click, go, iso, open, project, refuse, report, sent, settle, snapshot, text, texts, tok, view, worker, world, type Op } from "./page.ts";

// A project's page (BOB-182; BOB-121 AC6, AC13), on a fake broker's `project`, `usage`, `overview` and `list`.

const BOBNET = project("bobnet", "BobNet", "BOB"), HELIX = project("helix", "Helix", "LAND");
const PROJECTS = [BOBNET, HELIX];
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (back: number) => {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const weights = { read_at: "2026-11-22", rows: [{ model: "claude-opus-5-5", alias: "opus", input: 2, output: 2, cache_read: 2, cache_write: 2 }, { model: "claude-sonnet-5-5", alias: "sonnet", input: 1, output: 1, cache_read: 1, cache_write: 1 }] };
const point = (m: number) => ({ raw: tok(m * 1e6), weighted: m * 2e6, unknown: 0, calls: 10, by_model: [{ model: "claude-opus-5-5", raw: m * 1e6, weighted: m * 2e6 }], by_role: [], top: [] });
const usage = (op: Op) => {
  const n = op["days"] as number;
  return { weights, tz: op["tz"], days: Array.from({ length: n }, (_, i) => dayOf(n - 1 - i)), projects: PROJECTS.filter((p) => !op["project"] || op["project"] === p.key).map((p) => ({ project: p.key, name: p.name, lost: 0, points: Array.from({ length: n }, () => point(2)) })) };
};
const release = (ref: string, title: string, done: number, total: number) => ({ ref, title, goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done, total }, backlog: { items: 0, bugs: 0, oldest: null } });
const feat = (ref: string, status: string, title: string, over: Record<string, unknown> = {}) => ({ ref, kind: "feature", type: "increment", status, title, parent: null, release: "R2", ord: 1, labels: [], progress: { checked: 0, total: 0 }, tasks: { done: 0, total: 0 }, own: { checked: 0, total: 0 }, done_at: null, open_since: null, archived_at: null, ...over });
const ss = (feature: string, kind: string, label: string) => ({ feature, kind, label });
const run = (id: string, agent: string, over: Record<string, unknown> = {}) => ({ id, agent, role: agent.toLowerCase(), laptop: "mbp-1", model: "opus", effort: "high", started_at: iso(300), ended_at: iso(200), tokens: tok(1e6), weighted: 2e6, calls: 9, outcome: "done", outcome_reason: null, ...over });
const ciRun = (status: string, min: number) => ({ name: "test", branch: "v2", status, sha: "4be01c77aa", url: "https://github.com/example/r/actions/runs/1", started_at: iso(min + 5), ended_at: iso(min), agent: "Toad@mbp-1" });
const wait = (ref: string, over: Record<string, unknown> = {}) => ({ project: "bobnet", ref, kind: "question", text: `${ref} text`, feature: null, since: iso(60), blocking: false, holds: { sessions: [], items: [] }, waiting_sessions: [], asked_by: "Mario@mbp-1", recommended: null, context: null, needed_before: null, edits: [], ...over });

let page: Record<string, Record<string, unknown>>;
let features: Record<string, unknown[]>;
let waits: unknown[];
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  world.laptops = [];
  waits = [];
  features = {
    bobnet: [feat("BOB-6", "Draft", "Start a session from the UI"), feat("BOB-1", "Done", "Central backlog", { release: "R1" })],
    helix: [
      feat("LAND-45", "Done", "Build and CI", { done_at: "2026-11-21T10:00:00Z" }),
      feat("LAND-50", "In Progress", "Edit a recorded tract", { open_since: iso(300), own: { checked: 5, total: 11 }, tasks: { done: 9, total: 14 } }),
      feat("LAND-38", "Ready", "Agents self-register", { own: { checked: 0, total: 6 } }),
      feat("LAND-53", "Draft", "Undo a change", { own: { checked: 0, total: 4 } }),
      feat("LAND-54", "Draft", "Rehearsal", { own: { checked: 6, total: 11 } }),
      feat("LAND-99", "Ready", "Another release's", { release: "R3" }),
    ],
  };
  const base = (p: unknown, over: Record<string, unknown>) => ({ project: p, release: null, done_unclosed: [], waits: [], backlog: { ready: [], sessions_estimate: null, no_criteria: [{ ref: "BOB-6", title: "x" }], triage: { count: 10, oldest: { ref: "DRAFT-1", at: iso(8 * 24 * 60) } }, release: { ref: "R2", todo: 1, ready: 0 }, thin: true }, ci: [], sessions: [], other_runs: [], usage: {}, more: {}, ...over });
  page = {
    // BobNet's R1 shape: all done and not closed, R2 current with nothing Ready; nobody runs.
    bobnet: base(BOBNET, {
      release: { ...release("R2", "R2 Start a session from the UI", 0, 1), number: 2 }, done_unclosed: [{ ref: "R1", title: "R1 Central backlog view" }],
      sessions: [
        { session: ss("BOB-48", "review", "A"), feature_title: "A laptop that stops reporting", started_at: iso(3000), ended_at: iso(2900), close: { need: "none", summary: "Reviewed on phone and desktop.", blockers: 0, majors: 0, sent_back: 0 }, tokens: tok(1.8e6), weighted: 3.6e6, unknown: 0, lost: 1, runs: [run("w_1", "Daisy", { tokens: tok(1.8e6), weighted: 3.6e6, started_at: iso(3000), ended_at: iso(2900) }), run("w_2", "Toad", { tokens: tok(0), weighted: 0, outcome: "lost", outcome_reason: "ubu1 restarted mid-run", model: null, effort: null, started_at: iso(3000), ended_at: iso(2950) })] },
        { session: ss("BOB-48", "build", "B"), feature_title: "A laptop that stops reporting", started_at: iso(4000), ended_at: iso(3900), close: { need: "casper", summary: "Two majors.", blockers: 0, majors: 2, sent_back: 2 }, tokens: tok(0), weighted: 0, unknown: 0, lost: 1, runs: [run("w_3", "Luigi", { tokens: tok(0), weighted: 0, outcome: "lost", outcome_reason: "no heartbeat", started_at: iso(4000), ended_at: iso(3900) })] },
      ],
      other_runs: [run("w_c", "Peach", { ended_at: iso(4200), tokens: tok(3e5), weighted: 6e5 })],
    }),
    helix: base(HELIX, {
      release: { ...release("R2", "Edit and audit", 1, 6), number: 2 }, backlog: { ready: [{ ref: "LAND-38", title: "x", release: "R2", criteria: 6 }], sessions_estimate: 2, no_criteria: [], triage: { count: 0, oldest: null }, release: { ref: "R2", todo: 5, ready: 1 }, thin: false },
      sessions: [
        { session: ss("LAND-50", "build", "Fixes"), feature_title: "Edit a recorded tract", started_at: iso(300), ended_at: null, close: null, tokens: tok(1e6), weighted: 2e6, unknown: 0, lost: 0, runs: [run("w_old", "Howard"), run("w_h", "Howard", { ended_at: null, outcome: null, tokens: tok(0), weighted: 0 }), run("w_gone", "Marvin", { ended_at: null, outcome: null, tokens: tok(0), weighted: 0, laptop: "ubu1" })] },
        { session: ss("LAND-50", "build", "1"), feature_title: "Edit a recorded tract", started_at: iso(1000), ended_at: iso(900), close: { need: "answer", summary: "Propose an edit.", blockers: 1, majors: 0, sent_back: 0 }, tokens: tok(3e5), weighted: 6e5, unknown: 0, lost: 0, runs: [run("w_b", "Bender", { outcome: "failed", outcome_reason: "land refused: CI red on main", tokens: tok(3e5), weighted: 6e5 })] },
      ],
    }),
  };
  Object.assign(world.reads, {
    projects: () => ({ projects: PROJECTS }),
    overview: () => ({ projects: PROJECTS.map((p) => ({ project: p, release: null, release_number: null, open: [], next_ready: null, waits_on_you: null, backlog: { items: 4, bugs: p.key === "bobnet" ? 1 : 3, oldest: iso(60) }, no_release: null, ci: p.key === "bobnet" ? [{ name: "test", runs: [ciRun("failed", 125), ciRun("passed", 300)] }] : [] })) }),
    waits: () => ({ waits, answered: [] }),
    status: (op: Op) => ({ at: iso(0), since: op["since"], projects: [] }),
    list: (op: Op) => (op["of"] === "releases" ? { releases: [], total: 0, cursor: null } : { items: features[op["project"] as string] ?? [], total: 0, cursor: null }),
    project: (op: Op) => page[op["project"] as string] ?? refuse(`You may not read ${op["project"]}'s board`, "forbidden"),
    usage,
  });
});

const card = (cls: string) => view().querySelector(`.${cls}`)!;
const session = (name: string) => view().querySelector(`.lately > li[data-session="${name}"]`)!;
const helixRuns = () => [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({ id: "w_h", name: "Howard", role: "howard", project: "helix", session: "LAND-50 build Fixes", tokens: tok(1.4e6) })]) }];

describe("a project's page (BOB-182)", () => {
  it("shows its release, who runs and ran, what waits, CI, usage and backlog health, from its reads (c1; AC6)", async () => {
    world.laptops = helixRuns();
    waits = [wait("Q-1", { project: "helix", blocking: true, text: "Which tract?" }), wait("Q-2", { project: "bobnet" }), wait("A-3", { project: "helix", kind: "action", text: "Add the token", since: iso(9999) })];
    await open("#project/helix");
    expect(sent("project").map((f) => f.op)).toEqual([{ op: "project", project: "helix", days: 14, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }]);
    expect(sent("usage").map((f) => [f.op!["project"], f.op!["days"]])).toEqual([["helix", 14]]);
    expect(text(".p-top .back")).toBe("‹ Overview");
    expect(text(".p-h")).toBe("Helix");
    expect(text(".p-title .muted")).toBe("lead LeadLAND · PO PoLAND · mbp-1 · example/helix");
    expect(texts(".pgrid h3")).toEqual(["Current release", "Running now 1", "Who ran lately last 14 days", "Waits on you 2", "CI", "Usage 29.4M tokens, 14 days", "Backlog health"]);
    expect(text(".rel-line")).toBe("R2 Edit and audit1 of 6 features done");
    expect(text(".prun .l-who")).toBe("Howard howard");
    expect(text(".prun .l-path")).toBe("LAND-50Fixes");
    // Holds work up first, whichever is older; compact, on the Needs you page they are answered.
    expect(texts(".pwaits .l-t")).toEqual(["Which tract?", "Add the token"]);
    expect(card("pwaits").querySelector(".answer-btn")).toBeNull();
    await click(card("pwaits").querySelector(":scope > a.more-t"));
    await go("#needs");
    expect(view().querySelector('.seg.filters [aria-pressed="true"]')!.textContent).toBe("Helix 2");
  });

  it("who ran lately: tokens unknown for a lost run and never 0, so far from the laptop for one that runs, a failed run's reason, its close (c2)", async () => {
    world.laptops = helixRuns();
    await open("#project/helix");
    const fixes = session("LAND-50 build Fixes");
    expect(fixes.classList.contains("is-open")).toBe(true);
    expect(text(".lt-at", fixes)).toMatch(/^open since 5h 0m ago$/);
    // 1M that ended and 1.4M running; Marvin's laptop says nothing of him.
    expect(text(".lt-tok", fixes)).toBe("2.4M so far");
    expect(texts(".runs li", fixes)).toEqual(["Howardhoward · opus · highdone1.0M", "Howardhoward · opus · highrunning1.4M so far", "Marvinmarvin · opus · highrunningno report"]);
    const b1 = session("LAND-50 build 1");
    expect(text(".need", b1)).toBe("need: answer");
    expect(text(".outcome", b1)).toBe("need: answer1 blockerPropose an edit.");
    expect(text(".runs .bad-t", b1)).toBe("failed: land refused: CI red on main");
    // A worker the board has no run of yet runs too.
    report("mbp-1", snapshot([...(world.laptops[0]!.snapshot as { workers: unknown[] }).workers, worker({ id: "w_new", name: "Calvin", role: "qa", project: "helix", session: "LAND-50 build Fixes", tokens: tok(1e5) })]));
    await settle();
    expect(text(".lt-tok", session("LAND-50 build Fixes"))).toBe("2.5M so far");
    await go("#project/bobnet");
    const a = session("BOB-48 review A");
    expect(texts(".runs li", a)).toEqual(["Daisydaisy · opus · highdone1.8M", "Toadtoad · default modellost: ubu1 restarted mid-runtokens unknown"]);
    expect(a.querySelector(".r-tok .warn-t")).not.toBeNull();
    expect(text(".outcome .muted", a)).toBe("no findings");
    expect(text(".lt-tok", session("BOB-48 build B"))).toBe("tokens unknown");
    expect(text(".outcome", session("BOB-48 build B"))).toBe("need: casper2 majors · 2 sent backTwo majors.");
    expect(text(".others summary")).toBe("1 run outside any session · 300k");
    page["bobnet"]!["sessions"] = [];
    page["bobnet"]!["other_runs"] = [];
    changed("bobnet");
    await settle();
    expect(text(".plate p")).toBe("Nobody ran in the last 14 days.");
  });

  it("says who ran last when nobody runs, and its queued", async () => {
    await open("#project/bobnet");
    expect(text(".prun .nobody")).toBe("Nobody is running. Last: Daisy on BOB-48review A, ended 2d 0h ago.");
    report("mbp-1", snapshot([worker({ id: "w_e", name: "Toad", project: "bobnet", session: "BOB-121 review C", state: "done", ended_at: iso(10) }), worker({ id: "w_q", name: "Luigi", project: "bobnet", state: "queued", started_at: null }), worker({ id: "w_q2", name: "Ann", project: "helix", state: "queued", started_at: null })]));
    await settle();
    expect(text(".prun .nobody")).toBe("Nobody is running. Last: Toad on BOB-121review C, ended 10m ago.");
    expect(text(".prun .queued")).toBe("1 queued: Luigi");
  });

  it("the release block: each earlier one all done waits for his close, the features say where they stand, the open one has the edge (c3)", async () => {
    await open("#project/bobnet");
    expect(text(".prel .warn-t")).toBe("R1 Central backlog view: all done, waiting for your close. Close it on the Roadmap →");
    expect(card("prel").querySelector(".warn-t a")!.getAttribute("href")).toBe("#roadmap/bobnet");
    expect(text(".rel-line")).toBe("R2 Start a session from the UI0 of 1 feature done");
    expect(texts(".flist li")).toEqual(["BOB-6Start a session from the UIdraft · no criteria yet"]);
    expect(text(".pback .warn-t")).toBe("R2 has nothing Ready: its next feature needs criteria.");
    expect(texts(".p-health dd")).toEqual(["0 features", "1 feature", "10 items · oldest 8 days", "1 bug"]);
    world.laptops = helixRuns();
    report("mbp-1", helixRuns()[0]!.snapshot);
    await go("#project/helix");
    expect(texts(".flist .fs")).toEqual(["done 21 Nov", "6 of 11 criteria and 5 of 14 tasks left · Howard on it", "ready · 6 criteria to meet", "draft · 4 criteria written", "draft · 5 of 11 criteria left"]);
    expect([...view().querySelectorAll(".flist li.is-open")].map((li) => li.getAttribute("data-ref"))).toEqual(["LAND-50"]);
    expect(card("pback").querySelector(".warn-t")).toBeNull();
    page["helix"]!["release"] = null;
    changed("helix");
    await settle();
    expect(text(".prel p.muted")).toBe("No open release.");
    expect(card("prel").querySelector(".flist")).toBeNull();
  });

  it("the weigh switch is Usage's: it weighs the page's tokens, and set on one it shows on the other (c4)", async () => {
    world.laptops = helixRuns();
    await open("#project/helix");
    await click([...card("puse").querySelectorAll(".seg button")].find((b) => b.textContent === "Sonnet-equivalent"));
    expect(text(".puse h3")).toBe("Usage 58.8M Sonnet-equivalent tokens, 14 days");
    expect(text(".lt-tok", session("LAND-50 build Fixes"))).toBe("4.8M so far");
    expect(text(".lt-tok", session("LAND-50 build 1"))).toBe("600k");
    expect(location.hash).toBe("#project/helix?weigh=1");
    const all = [...card("puse").querySelectorAll("a")].find((a) => a.textContent === "Usage, every project →")!;
    expect(all.getAttribute("href")).toBe("#usage");
    await go("#usage");
    expect(text('.seg.weigh [aria-pressed="true"]')).toBe("Sonnet-equivalent");
    await click([...view().querySelectorAll(".seg.weigh button")].find((b) => b.textContent === "Raw tokens"));
    await go("#project/helix");
    expect(text(".puse h3")).toBe("Usage 29.4M tokens, 14 days");
    // A day on its graph has its line here, and no detail.
    await click(card("puse").querySelector(`.bar[data-day="${dayOf(3)}"]`));
    expect(text(".puse .uday b")).toMatch(/: 2\.0M tokens$/);
    expect(view().querySelector(".ud")).toBeNull();
    expect(location.hash).toBe("#project/helix");
  });

  it("#sessions and #sessions/<x> open the first project's page, with one toast (c5, c7, c10; AC13)", async () => {
    await open("#sessions");
    expect(location.hash).toBe("#project/bobnet");
    expect(text(".p-h")).toBe("BobNet");
    const said = "Sessions moved: who ran is on each project's page; laptops and agents are under Laptops.";
    expect([$("toast").textContent, $("toast").hidden]).toEqual([said, false]);
    $("toast").hidden = true;
    await go("#overview");
    await go("#project/bobnet");
    expect($("toast").hidden).toBe(true);
    await go("#sessions/helix");
    expect([location.hash, $("toast").textContent, $("toast").hidden]).toEqual(["#project/bobnet", said, false]);
    expect($("tabs").textContent).not.toContain("Sessions");
  });

  it("says what the broker says of a project he can't read, not an empty page (c6)", async () => {
    await open("#project/secret");
    expect(text(".banner.down")).toBe("secret couldn't be readYou may not read secret's boardRetry");
    expect(view().querySelector(".pgrid")).toBeNull();
    expect(sent("usage")).toEqual([]);
    page["secret"] = { ...page["helix"], project: project("secret", "Secret", "SEC") };
    await click(view().querySelector(".banner.down button"));
    await settle();
    expect(text(".p-h")).toBe("Secret");
  });

  it("highlights Overview, and has the CI rows of the Overview's card without the project (c8)", async () => {
    await open("#project/bobnet");
    expect([...$("tabs").querySelectorAll("[aria-current]")].map((a) => a.textContent)).toEqual(["Overview"]);
    const row = card("pci").querySelector(".ci-row")!;
    expect([...row.children].map((c) => c.className)).toEqual(["ci-wf", "ci-st", "ci-hist", "ci-link"]);
    expect(text(".ci-st", row)).toBe("failed 2h 5m ago · 4be01c7 · Toad's land");
    await go("#project/helix");
    expect(text(".pci p")).toBe("No CI run on the board yet.");
  });

  it("is where the CI card's and the Overview's project names go (c10)", async () => {
    await open("#overview");
    expect($("ci").querySelector(".ci-p a")!.getAttribute("href")).toBe("#project/bobnet");
    expect([...view().querySelectorAll(".prow")].map((r) => r.querySelector('a[href^="#project/"]')?.getAttribute("href"))).toEqual(["#project/bobnet", "#project/helix"]);
    await go("#usage");
    expect([...view().querySelectorAll(".u-name")].map((a) => a.getAttribute("href"))).toEqual(["#project/bobnet", "#project/helix"]);
  });

  it("a `project` read that fails leaves waits, running, CI and usage drawn from their own, and says which part couldn't be read (c10)", async () => {
    const answer = world.reads["project"]!;
    world.reads["project"] = () => refuse("The board's database isn't answering.");
    await open("#project/bobnet");
    expect(text(".banner.down")).toBe("The board couldn't be readThe board's database isn't answering. Its release, who ran and its backlog aren't shown.Retry");
    expect(text(".prel p")).toBe("Its release couldn't be read.");
    expect(text(".plate p")).toBe("Who ran couldn't be read.");
    expect(text(".pback p")).toBe("Its backlog couldn't be read.");
    expect(card("pci").querySelectorAll(".ci-row")).toHaveLength(1);
    expect(card("puse").querySelectorAll(".bar")).toHaveLength(14);
    expect(text(".pwaits .st-empty")).toBe("Nothing waits on you.");
    world.reads["project"] = answer;
    await click(view().querySelector(".banner.down button"));
    await settle();
    expect(view().querySelector(".banner.down")).toBeNull();
    expect(text(".rel-line b")).toBe("R2 Start a session from the UI");
    // And the other way round.
    world.reads["usage"] = () => refuse("No usage.");
    await go("#project/helix");
    expect(text(".puse p")).toBe("Usage couldn't be read. No usage.");
    expect(text(".rel-line b")).toBe("R2 Edit and audit");
  });

  it("usage down: the read's message and Retry in its card, and a running run isn't 'not weighed' (BOB-200 c4)", async () => {
    localStorage.setItem("bobnet.weigh", "1");
    world.laptops = helixRuns();
    const was = world.reads["usage"]!;
    world.reads["usage"] = () => refuse("The board's database isn't answering.");
    await open("#project/helix");
    expect(text(".puse p")).toBe("Usage couldn't be read. The board's database isn't answering.");
    expect(text("li[data-run='w_h'] .r-tok")).toBe("1.4M raw so far");
    expect(card("plate").textContent).not.toContain("not weighed");
    world.reads["usage"] = was;
    await click(card("puse").querySelector("button.u-retry"));
    await settle();
    expect(card("puse").querySelector(".ugraph")).not.toBeNull();
    expect(text("li[data-run='w_h'] .r-tok")).toBe("2.8M so far");
  });

  it("folds a session's consults to one line at its end, and marks only a running run's quiet laptop (BOB-200 c1)", async () => {
    const consult = (id: string) => run(id, "Bill", { outcome: "stopped", outcome_reason: "consult answered", tokens: tok(15_000), weighted: 30_000, laptop: "ubu1" });
    (page["helix"]!["sessions"] as Array<{ runs: unknown[] }>)[0]!.runs.push(consult("w_c1"), consult("w_c2"), run("w_u", "Bill", { laptop: "ubu1" }));
    world.laptops = [...helixRuns(), { laptop: "ubu1", at: iso(14), snapshot: snapshot([worker({ id: "w_gone", name: "Marvin", project: "helix", session: "LAND-50 build Fixes" })]) }];
    await open("#project/helix");
    const li = session("LAND-50 build Fixes");
    const fold = li.querySelector("details.consults") as HTMLDetailsElement;
    expect([fold.open, text("summary", fold)]).toEqual([false, "2 consults · 30k"]);
    expect(li.lastElementChild).toBe(fold);
    expect([...li.querySelectorAll(":scope > .runs > li")].map((x) => x.getAttribute("data-run"))).toEqual(["w_old", "w_h", "w_gone", "w_u"]);
    expect(texts("details.consults li .r-out", li)).toEqual(["stopped: consult answered", "stopped: consult answered"]);
    expect(text("li[data-run='w_gone'] .who-at", li)).toBe("Marvin@ubu1 · no report 14 min");
    expect(text("li[data-run='w_u'] .who-at", li)).toBe("Bill@ubu1");
  });

  it("in one column: release, running, waits, CI, who ran, usage, backlog (BOB-200 c1)", async () => {
    const order = () => [...view().querySelectorAll(".pgrid .card")].map((c) => c.className.split(" ")[1]);
    await open("#project/helix");
    expect(order()).toEqual(["prel", "prun", "plate", "pwaits", "pci", "puse", "pback"]);
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
    await open("#project/helix");
    expect(order()).toEqual(["prel", "prun", "pwaits", "pci", "plate", "puse", "pback"]);
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  });

  it("reads again on board_changed, its own project's only, and shows every session past eight on Show all", async () => {
    const one = (page["helix"]!["sessions"] as Array<Record<string, unknown>>)[1]!;
    page["helix"]!["sessions"] = Array.from({ length: 12 }, (_, i) => ({ ...one, session: ss("LAND-50", "build", String(i)) }));
    await open("#project/helix");
    expect(view().querySelectorAll(".lately > li")).toHaveLength(8);
    await click([...view().querySelectorAll("button")].find((b) => b.textContent === "Show all 12 sessions"));
    expect(view().querySelectorAll(".lately > li")).toHaveLength(12);
    changed("bobnet");
    await settle();
    expect(sent("project")).toHaveLength(1);
    changed("helix");
    await settle();
    expect(sent("project")).toHaveLength(2);
    await click([...view().querySelectorAll(".seg.projects button")].find((b) => b.textContent === "BobNet"));
    window.dispatchEvent(new Event("hashchange"));
    await settle();
    expect([location.hash, text(".p-h")]).toEqual(["#project/bobnet", "BobNet"]);
  });
});
