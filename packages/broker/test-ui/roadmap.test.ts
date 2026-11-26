import { beforeEach, describe, expect, it } from "vitest";
import { $, changed, click, go, iso, open, project, refuse, reply, sent, settle, text, texts, view, world, type Op } from "./page.ts";

// The Roadmap's Where it stands, its current release and what it reads (BOB-184; BOB-121 AC8). Its gates are in dashboard.test.ts.

const PROJECTS = [project("bobnet", "BobNet", "BOB"), project("helix", "Helix", "LAND")];
const feat = (ref: string, release: string | null, status: string, over: Record<string, unknown> = {}) => ({ ref, kind: "feature", type: "increment", status, title: `${ref} title`, parent: null, release, ord: 1, labels: [], progress: { checked: 0, total: 0 }, tasks: { done: 0, total: 0 }, own: { checked: 0, total: 0 }, done_at: null, open_since: null, archived_at: null, ...over });
const rel = (ref: string, title: string, status: string, done: number, total: number, over: Record<string, unknown> = {}) => ({ ref, title, goal: null, status, ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done, total }, backlog: { items: 2, bugs: 1, oldest: iso(3000) }, ...over });
// BobNet's R1: all done and not closed; R2 current; R3 planned.
const releases = [rel("R1", "R1 Central backlog view", "open", 3, 3), rel("R2", "R2 One orchestrator", "open", 1, 7), rel("R3", "R3 Dashboard", "planned", 0, 1)];
const features = [
  feat("BOB-1", "R1", "Done", { own: { checked: 11, total: 13 }, done_at: "2026-11-14T15:04:00.000Z" }),
  feat("BOB-2", "R1", "Done", { own: { checked: 16, total: 16 }, done_at: "2026-11-16T15:08:00.000Z" }),
  feat("BOB-7", "R1", "Done", { progress: { checked: 2, total: 9 } }),
  feat("BOB-44", "R2", "Done", { own: { checked: 4, total: 7 }, progress: { checked: 180, total: 183 }, done_at: "2026-11-22T12:30:00.000Z" }),
  // Its tasks have more criteria than it has of its own.
  feat("BOB-51", "R2", "In Progress", { open_since: iso(60), own: { checked: 5, total: 11 }, progress: { checked: 90, total: 120 }, tasks: { done: 9, total: 14 } }),
  feat("BOB-49", "R2", "Ready", { own: { checked: 0, total: 8 }, progress: { checked: 2, total: 40 }, tasks: { done: 1, total: 3 } }),
  feat("BOB-33", "R2", "Draft", { open_since: iso(9000), own: { checked: 6, total: 11 } }),
  feat("BOB-52", "R2", "Draft", { own: { checked: 0, total: 4 } }),
  feat("BOB-53", "R2", "Draft"),
  feat("BOB-54", "R2", "Ready", { own: { checked: 1, total: 2 } }),
  feat("BOB-60", "R3", "Draft"),
];
const stands = (ref: string) => {
  const tr = [...view().querySelectorAll("tr")].find((x) => x.querySelector("a.id")?.textContent === ref)!;
  return text(".stands", tr);
};
const lists = (key: string) => sent("list").filter((f) => f.op!["project"] === key && f.op!["of"] !== "tasks").length;
const overviews = () => sent("overview").filter((f) => f.op!["project"]).length;

beforeEach(() => {
  features[10] = feat("BOB-60", "R3", "Draft");
  localStorage.clear();
  sessionStorage.clear();
  world.laptops = [];
  world.reads = {
    projects: () => ({ projects: PROJECTS }),
    overview: (op: Op) => ({ projects: PROJECTS.filter((p) => !op["project"] || p.key === op["project"]).map((p) => ({ project: p, release: p.key === "bobnet" ? releases[1] : null, release_number: 2, open: [], next_ready: null, waits_on_you: null, backlog: { items: 0, bugs: 0, oldest: null }, no_release: { items: 3, bugs: 1, oldest: iso(3000) }, ci: [] })) }),
    waits: () => ({ waits: [], answered: [] }),
    list: (op: Op) => { const items = op["project"] !== "bobnet" ? [] : op["of"] === "releases" ? releases : features; return op["of"] === "releases" ? { releases: items, total: items.length, cursor: null } : { items, total: items.length, cursor: null }; },
    project: (op: Op) => ({ project: PROJECTS.find((p) => p.key === op["project"]), release: { ...releases[1], number: 2 }, done_unclosed: [], waits: [], backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false }, ci: [], sessions: [], other_runs: [], usage: {}, more: {} }),
    status: (op: Op) => ({ at: new Date().toISOString(), since: op["since"], projects: [] }),
    usage: (op: Op) => ({ weights: { read_at: "2026-11-22", rows: [] }, tz: op["tz"], days: [], projects: [] }),
  };
});

describe("where a feature stands on the Roadmap (BOB-184)", () => {
  it("says it in words from the feature's own criteria: done when, what is left, what it has (c1, c2)", async () => {
    await open("#roadmap/bobnet");
    expect(texts("#rel-R2 thead th")).toEqual(["# Feature", "State", "Where it stands"]);
    // Done: the day, whether its criteria are all ticked or not, and never a count.
    expect([stands("BOB-1"), stands("BOB-2"), stands("BOB-44")]).toEqual(["done 14 Nov", "done 16 Nov", "done 22 Nov"]);
    expect(stands("BOB-7")).toBe("done");
    for (const sel of ["#rel-R1 tbody", "#rel-R2 tr.done"]) expect(view().querySelector(sel)!.textContent).not.toMatch(/\d+ of \d+|not ticked/);
    expect(stands("BOB-51")).toBe("6 of 11 criteria and 5 of 14 tasks left");
    expect([...view().querySelectorAll("#rel-R2 .stands .meter")].map((m) => m.getAttribute("aria-label"))).toEqual(["5 of 11", "6 of 11"]);
    expect([stands("BOB-49"), stands("BOB-54")]).toEqual(["ready · 8 criteria to meet", "ready · 1 criterion to meet"]);
    // BOB-33, a Draft with a session open, reads as open, as its badge says (spec 2.6; Daisy, review E minor 2).
    expect([stands("BOB-33"), stands("BOB-52"), stands("BOB-53")]).toEqual(["5 of 11 criteria left", "draft · 4 criteria written", "draft · no criteria yet"]);
    expect(text(".note:last-child")).toContain("Where it stands: a feature not done says how many of its own criteria and tasks are left; a done one says when it was done. The feature's page lists any criteria it closed without.");
  });

  it("says a release all done waits for his close, beside Close, and names the current one; a planned one is never current (c3)", async () => {
    await open("#roadmap/bobnet");
    expect(text("#rel-R1 .gate .warn-t")).toBe("All done: waiting for your close");
    expect(texts("#rel-R1 .gate button")).toEqual(["Close R1"]);
    expect(view().querySelector("#rel-R2 .gate")).toBeNull();
    expect(texts(".cur-tag")).toEqual(["current"]);
    expect(view().querySelector("#rel-R2 .cur-tag")).not.toBeNull();
    await click(view().querySelector("#rel-R1 .gate button"));
    expect(text("h2", $("confirm"))).toBe("Close R1 Central backlog view?");
    await click([...$("confirm").querySelectorAll("button")].find((b) => b.textContent === "Cancel"));
    expect(sent("close_release")).toHaveLength(0);
    // Behind Edit your gates: the gates as they were, the words with them, and one Close.
    await go("#roadmap/bobnet/edit");
    expect(texts("#rel-R1 .gate button")).toEqual(["↑ Earlier", "↓ Later", "Close release"]);
    expect(text("#rel-R1 .gate .warn-t")).toBe("All done: waiting for your close");
    const was = releases.map((r) => r.status);
    releases[1]!.status = "planned";
    changed("bobnet");
    await settle(600);
    expect(view().querySelector(".cur-tag")).toBeNull();
    releases.forEach((r, i) => (r.status = was[i]!));
  });
});

describe("what a roadmap reads (BOB-184 c6; Toad, review D minor 2)", () => {
  it("a project's page reads no overview of its project; the Roadmap does, and on a change while it shows", async () => {
    await open("#project/bobnet");
    expect(text(".prel .flist li[data-ref='BOB-51'] .left")).toBe("6 of 11 criteria and 5 of 14 tasks left");
    const n = lists("bobnet");
    changed("bobnet");
    await settle(600);
    expect(overviews()).toBe(0);
    expect(lists("bobnet")).toBe(n + 2);
    await go("#roadmap/bobnet");
    await settle(600);
    expect(overviews()).toBe(1);
    expect(text("#rel-none .counts-line")).toContain("3 backlog items");
    const shown = lists("bobnet");
    changed("bobnet");
    await settle(600);
    expect([overviews(), lists("bobnet")]).toEqual([2, shown + 2]);
    // Another project's change reads nothing of this one's.
    changed("helix");
    await settle(600);
    expect([overviews(), lists("bobnet"), lists("helix")]).toEqual([2, shown + 2, 0]);
  });

  it("isn't read again while another view shows, and is when one that draws it next does", async () => {
    await open("#roadmap/bobnet");
    const n = lists("bobnet");
    await go("#overview");
    changed("bobnet");
    await settle(600);
    expect(lists("bobnet")).toBe(n);
    features[10] = feat("BOB-60", "R3", "Ready", { own: { checked: 0, total: 3 } });
    await go("#roadmap/bobnet");
    await settle(600);
    expect(lists("bobnet")).toBe(n + 2);
    expect(stands("BOB-60")).toBe("ready · 3 criteria to meet");
  });

  // Toad's probe, review E minor 1: the read in flight answers with the copy from before the change.
  it("a change while a read is in flight is read again, shown or not", async () => {
    await open("#roadmap/bobnet");
    await settle(600);
    const list = world.reads.list!;
    const old = JSON.parse(JSON.stringify(features));
    const before = sent("list").length;
    delete (world.reads as Record<string, unknown>).list;
    changed("bobnet");
    await settle(100);
    const held = sent("list").slice(before);
    expect(held.length).toBe(2);
    await go("#overview");
    features[10] = feat("BOB-60", "R3", "Ready", { own: { checked: 0, total: 3 } });
    changed("bobnet");
    await settle(100);
    for (const f of held) reply(f, (op) => (op["of"] === "releases" ? { releases, total: releases.length, cursor: null } : { items: old, total: old.length, cursor: null }));
    world.reads.list = list;
    await settle(300);
    await go("#roadmap/bobnet");
    await settle(600);
    expect(stands("BOB-60")).toBe("ready · 3 criteria to meet");
  });

  it("a change during a project's first read is read again", async () => {
    const list = world.reads.list!;
    delete (world.reads as Record<string, unknown>).list;
    await open("#roadmap/bobnet");
    const held = sent("list").filter((f) => f.op!["project"] === "bobnet");
    expect(held.length).toBe(2);
    const old = JSON.parse(JSON.stringify(features));
    features[10] = feat("BOB-60", "R3", "Ready", { own: { checked: 0, total: 3 } });
    changed("bobnet");
    await settle(100);
    world.reads.list = list;
    for (const f of held) reply(f, (op) => (op["of"] === "releases" ? { releases, total: releases.length, cursor: null } : { items: old, total: old.length, cursor: null }));
    await settle(600);
    expect(lists("bobnet")).toBe(4);
    expect(stands("BOB-60")).toBe("ready · 3 criteria to meet");
  });
});

describe("a Roadmap whose first read failed (Daisy, review E minor 18)", () => {
  it("has the error and Retry only: no counts, no \"no releases yet\"", async () => {
    const list = world.reads.list!;
    world.reads.list = () => refuse("D1 is down");
    await open("#roadmap/bobnet");
    await settle(300);
    expect(view().textContent).not.toMatch(/0 releases|no releases yet/);
    expect(view().querySelector(".gates-btn")).toBeNull();
    expect(text(".banner.down")).toBe("Board unavailableD1 is downRetry");
    world.reads.list = list;
    await click([...view().querySelectorAll(".banner.down button")].find((b) => b.textContent === "Retry"));
    await settle(600);
    expect(view().querySelector(".banner.down")).toBeNull();
    expect(text(".bar-row .muted")).toBe("3 releases · 11 features");
  });
});
