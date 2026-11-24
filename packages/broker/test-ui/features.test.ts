import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { $, changed, click, go, iso, open, project, refuse, report, settle, snapshot, text, texts, view, worker, world, type Op } from "./page.ts";

// Features (BOB-185; BOB-121 AC9): a project's features from the board service, by state and by words.

const PROJECTS = [project("bobnet", "BobNet", "BOB"), project("helix", "Helix", "LAND")];
const feat = (ref: string, status: string, title: string, over: Record<string, unknown> = {}) => ({ ref, kind: "feature", type: "increment", status, title, parent: null, release: "R2", ord: 1, labels: [], progress: { checked: 0, total: 0 }, tasks: { done: 0, total: 0 }, own: { checked: 0, total: 0 }, done_at: null, open_since: null, archived_at: null, ...over });
const rel = (ref: string, title: string) => ({ ref, title, goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done: 0, total: 1 }, backlog: { items: 0, bugs: 0, oldest: null } });
const RELEASES = { bobnet: [rel("R1", "R1 Central backlog view"), rel("R2", "R2 One orchestrator")], helix: [rel("R2", "Edit and audit")] } as Record<string, unknown[]>;
let features: Record<string, unknown[]>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  features = {
    bobnet: [
      feat("BOB-9", "Done", "Move Helix's board", { release: "R1", done_at: "2026-11-17T15:21:44.397Z" }),
      feat("BOB-1", "Done", "Central backlog prototype", { release: "R1", done_at: "2026-11-14T15:04:00.000Z", own: { checked: 11, total: 13 } }),
      feat("BOB-35", "Draft", "Status: recurring problems", { release: null, own: { checked: 0, total: 4 } }),
      feat("BOB-49", "Ready", "Waits on you is never stale", { own: { checked: 0, total: 8 } }),
      feat("BOB-33", "Draft", "Status tab: catch up after hours away", { open_since: iso(9000), own: { checked: 0, total: 1 } }),
      feat("BOB-121", "Ready", "Dashboard redesign, use case first", { open_since: iso(60), own: { checked: 6, total: 20 } }),
      feat("BOB-6", "Ready", "Start a session from the UI", { release: "R1", own: { checked: 0, total: 10 } }),
    ],
    helix: [feat("LAND-45", "Done", "Build and CI", { done_at: "2026-11-21T10:00:00Z" }), feat("LAND-50", "In Progress", "Edit a recorded tract", { open_since: iso(300), own: { checked: 5, total: 11 } })],
  };
  world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({ session: "BOB-121 build E" })]) }];
  world.reads = {
    projects: () => ({ projects: PROJECTS }),
    overview: () => ({ projects: [] }),
    waits: () => ({ waits: [{ project: "bobnet", kind: "question", ref: "Q-6", feature: "BOB-49", text: "Which?", recommended: null, context: null, holds: { items: [], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Mario@mbp-1", since: iso(60), blocking: false, edits: [], stale: null, kept: null, fix: null }], answered: [] }),
    list: (op: Op) => { const items = (op["of"] === "releases" ? RELEASES : features)[op["project"] as string] ?? []; return op["of"] === "releases" ? { releases: items, total: items.length, cursor: null } : { items, total: items.length, cursor: null }; },
    status: (op: Op) => ({ at: new Date().toISOString(), since: op["since"], projects: [] }),
    project: (op: Op) => ({ project: PROJECTS.find((p) => p.key === op["project"]), release: null, done_unclosed: [], waits: [], backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false }, ci: [], sessions: [], other_runs: [], usage: {}, more: {} }),
    usage: (op: Op) => ({ weights: { read_at: "2026-11-22", rows: [] }, tz: op["tz"], days: [], projects: [] }),
  };
});
const refs = () => [...view().querySelectorAll(".flist.big li")].map((li) => li.getAttribute("data-ref"));
const filter = (label: string) => click([...view().querySelectorAll(".filters button")].find((b) => b.textContent!.startsWith(label)));
const find = async (words: string) => {
  const box = $("find") as HTMLInputElement;
  box.focus();
  box.value = words;
  box.dispatchEvent(new Event("input"));
  await settle(20);
};

describe("Features (BOB-185)", () => {
  it("lists BobNet's and Helix's features from the board, open first, then Ready, Draft and Done, the oldest done first (c1, c2)", async () => {
    await open("#features/bobnet");
    expect(refs()).toEqual(["BOB-33", "BOB-121", "BOB-6", "BOB-49", "BOB-35", "BOB-1", "BOB-9"]);
    expect(texts(".flist.big .fs")).toEqual([
      "open draft · 1 criterion written · R2 One orchestrator",
      "open 14 of 20 criteria left · Luigi on it · R2 One orchestrator",
      "ready ready · 10 criteria to meet · R1 Central backlog view",
      "ready ready · 8 criteria to meet · R2 One orchestrator · waits on you: Q-6",
      "draft draft · 4 criteria written · Not in a release",
      "done done 14 Nov · R1 Central backlog view",
      "done done 17 Nov · R1 Central backlog view",
    ]);
    expect(view().querySelector("li[data-ref='BOB-6'] a.ft")!.getAttribute("href")).toBe("#feature/bobnet/BOB-6");
    expect(texts("#tabs [aria-current]", document)).toEqual(["Features"]);
    await go("#features/helix");
    expect(refs()).toEqual(["LAND-50", "LAND-45"]);
    expect(text("li[data-ref='LAND-50'] .fs")).toBe("open 6 of 11 criteria left · R2 Edit and audit");
    expect(view().textContent).not.toMatch(/no backlog/i);
  });

  it("has no 'no backlog configured' left in the page's source (c1)", () => {
    expect(readFileSync(join(import.meta.dirname, "../public/app.js"), "utf8")).not.toMatch(/backlog configured/i);
  });

  it("counts each filter as it lists, and finds by id and by words (c2)", async () => {
    await open("#features/bobnet");
    const counts = () => Object.fromEntries(texts(".filters button").map((b) => [b.replace(/ \d+$/, ""), Number(/\d+$/.exec(b)![0])]));
    expect(counts()).toEqual({ All: 7, "Open now": 2, Ready: 3, Draft: 2, Done: 2 });
    for (const [label, n] of Object.entries(counts())) {
      await filter(label);
      expect([label, refs().length]).toEqual([label, n]);
    }
    await filter("All");
    await find("bob-4");
    expect(refs()).toEqual(["BOB-49"]);
    await find("status  UP");
    expect(refs()).toEqual(["BOB-33"]);
    await find("status");
    expect(refs()).toEqual(["BOB-33", "BOB-35"]);
    expect(counts()).toEqual({ All: 2, "Open now": 1, Ready: 0, Draft: 2, Done: 0 });
  });

  it("keeps the find box, its words and its caret while he types and while the laptops report", async () => {
    await open("#features/bobnet");
    await find("status");
    const box = $("find") as HTMLInputElement;
    box.setSelectionRange(2, 2);
    report("mbp-1", snapshot([]));
    features["bobnet"]!.push(feat("BOB-52", "Draft", "Status shows broker deploys"));
    changed("bobnet");
    await settle(700);
    expect($("find")).toBe(box);
    expect([box.value, box.selectionStart, document.activeElement === box]).toEqual(["status", 2, true]);
    expect(refs()).toEqual(["BOB-33", "BOB-52", "BOB-35"]);
  });

  it("says only what is true when nothing is listed (c3)", async () => {
    features["helix"] = features["helix"]!.slice(0, 1);
    await open("#features/helix");
    await filter("Draft");
    expect(text("#features-list .empty-card")).toBe("Helix has no draft feature. Show all");
    await click(view().querySelector("#features-list .empty-card button"));
    expect(refs()).toEqual(["LAND-45"]);
    await go("#features/bobnet");
    await find("zeppelin");
    expect(text("#features-list .empty-card")).toBe("No feature of BobNet's matches “zeppelin”. Show all");
    ($("find") as HTMLInputElement).blur();
    await click(view().querySelector("#features-list .empty-card button"));
    expect(refs()).toHaveLength(7);
    expect(($("find") as HTMLInputElement).value).toBe("");
  });

  it("says it reads the board until it has, and that it couldn't with Retry, never 'no feature' (c3)", async () => {
    const { list, ...rest } = world.reads;
    world.reads = rest;
    await open("#features/bobnet");
    expect(text("#features-list")).toBe("Reading the board…");
    world.reads = { ...rest, list: () => refuse("The board can't be reached") };
    await open("#features/bobnet");
    expect(text("#features-list")).toBe("Board unavailableThe board can't be reachedRetry");
    world.reads["list"] = list!;
    await click(view().querySelector("#features-list .banner button"));
    await settle();
    expect(refs()).toHaveLength(7);
  });

  it("is where a project's All features and the old Features links go (c4)", async () => {
    await open("#project/helix");
    const link = [...view().querySelectorAll(".prel .links a")].find((a) => a.textContent === "All features")!;
    expect(link.getAttribute("href")).toBe("#features/helix");
    await go(link.getAttribute("href")!);
    expect(text(".projects [aria-pressed='true']")).toBe("Helix");
    expect(refs()).toEqual(["LAND-50", "LAND-45"]);
    await go("#feature");
    expect(location.hash).toBe("#features");
    await go("#feature/bobnet");
    expect(location.hash).toBe("#features/bobnet");
  });
});
