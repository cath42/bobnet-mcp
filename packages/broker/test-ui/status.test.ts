import { beforeEach, describe, expect, it } from "vitest";
import { $, changed, click, FakeSocket, go, iso, open, project, refuse, reply, report, sent, settle, snapshot, text, texts, tok, view, worker, world, type Op } from "./page.ts";

// Status on data as production has it (BOB-183; BOB-121 AC7): a laptop that reports every few seconds, a read that
// takes a while, sessions nobody closed. The view itself is BOB-33's; its tests are in dashboard.test.ts.

const MARK = "bobnet.status.lastVisit";
const ss = (feature: string, kind: string, label: string) => ({ feature, kind, label });
const wait = { project: "bobnet", kind: "question", ref: "Q-6", feature: "BOB-9", text: "Keep BOB-9 in R1?", recommended: null, context: null, holds: { items: ["BOB-9"], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Mario@mbp-1", since: iso(600), blocking: true, edits: [], stale: null, kept: null, fix: null };
const row = (key: string, name: string, over: Record<string, unknown> = {}) => ({
  project: key, name, note: null, recurring: null, waits: [],
  done: { counts: { features: 0, sessions: 0, lands: 0, releases: 0 }, features: [], sessions: [], releases: [] },
  stuck: { runs: [], ci: [], idle_sessions: [], idle_features: [], answered_holding: [], settled: [] },
  backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false },
  usage: { tokens: tok(0), by_agent: [], heavy: [], lost: 0 }, more: {}, ...over,
});
// BobNet's board, 2026-11-23: BOB-33's sessions of 16 Nov still open, and BOB-48 Done with one.
const busy = row("bobnet", "BobNet", {
  waits: [wait],
  done: { counts: { features: 1, sessions: 1, lands: 12, releases: 0 }, features: [{ ref: "BOB-111", title: "An answer wakes whoever it holds up", type: "increment", release: "R2", at: iso(400) }],
    sessions: [{ session: ss("BOB-121", "review", "D"), ended_at: iso(60), need: "none", summary: "Passed.", closed_by: "Peach@mbp-1", tokens: tok(4_000_000), lost: 0, counts: { blockers: 0, majors: 1, sent_back: 0 } }], releases: [] },
  stuck: { runs: [], ci: [], idle_features: [], answered_holding: [],
    idle_sessions: [...["reqs", "proto", "arch", "spec", "adr-amend", "ready"].map((l) => ({ session: ss("BOB-33", "design", l), since: iso(7 * 1440) })), { session: ss("BOB-48", "build", "Fixes"), since: iso(1500) }],
    settled: [{ kind: "ci", entry: { source: "github-actions", name: "test", branch: "v2", sha: null, url: null, worker: null, session: null, ended_at: iso(90) }, settled_at: iso(70) }] },
});
const quiet = row("vitals", "Vitals");
const status = (op: Op) => ({ at: new Date().toISOString(), since: op["since"], projects: [busy, quiet] });
const press = (label: string) => click([...view().querySelectorAll(".span-chips button")].find((b) => b.textContent!.startsWith(label)));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  world.reads = { projects: () => ({ projects: [project("bobnet", "BobNet", "BOB"), project("vitals", "Vitals", "VIT")] }), overview: () => ({ projects: [] }), waits: () => ({ waits: [], answered: [] }), status };
  world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({})]) }];
});

describe("Status on production's data (BOB-183 c1)", () => {
  it("keeps Settled since open while the laptops report", async () => {
    await open("#status/bobnet");
    const fold = () => view().querySelector("details.settled") as HTMLDetailsElement;
    fold().open = true;
    await settle(20);
    for (let i = 0; i < 2; i++) {
      report("mbp-1", snapshot([worker({ calls: 4 + i })]));
      await settle();
      expect(fold().open).toBe(true);
    }
    fold().open = false;
    await settle(20);
    report("mbp-1", snapshot([worker({ calls: 9 })]));
    await settle();
    expect(fold().open).toBe(false);
  });

  it("takes a chip pressed while a read is on its way: no error, and the week's read after it", async () => {
    localStorage.setItem(MARK, iso(120));
    const { status: answer, ...rest } = world.reads;
    world.reads = rest;
    await open("#status");
    await press("A week");
    // The marker's read is still on its way: it must not read a week from "visit".
    const first = sent("status").at(-1)!;
    world.reads = { ...rest, status: answer! };
    reply(first, answer!);
    await settle(600);
    expect(view().querySelector(".banner.down")).toBeNull();
    expect(text(".span-bar .when b")).toBe("The last week");
    expect(sent("status").map((f) => Math.round((Date.now() - Date.parse(f.op!["since"] as string)) / 3_600_000))).toEqual([2, 2, 168]);
    expect(view().querySelectorAll(".pcard")).toHaveLength(2);
    expect(localStorage.getItem(MARK)).not.toBeNull();
  });

  it("says the board couldn't be read, with Retry, never 'Reading the board…' for good", async () => {
    world.reads["status"] = () => refuse("The board can't be reached");
    await open("#status");
    expect(text(".banner.down")).toBe("Board unavailableThe board can't be reachedRetry");
    expect(texts(".ans .sub")).toEqual(["The board couldn't be read", "The board couldn't be read"]);
    expect(view().textContent).not.toContain("Reading the board…");
    await go("#status/bobnet");
    expect(text(".st .empty-card")).toBe("The board couldn't be read. It is tried again each minute.");
    world.reads["status"] = status;
    await click(view().querySelector(".banner.down button"));
    await settle();
    expect(view().querySelector(".banner.down")).toBeNull();
    expect(view().querySelectorAll("details.sec")).toHaveLength(6);
  });

  it("keeps what it read since the visit when only the wider read fails", async () => {
    localStorage.setItem(MARK, iso(120));
    world.reads["status"] = (op: Op) => (Date.now() - Date.parse(op["since"] as string) > 100 * 3_600_000 ? refuse("Too long a read") : status(op));
    await open("#status");
    await press("A week");
    await settle();
    expect(text(".banner.down span")).toBe("Too long a read");
    await press("Since");
    expect(view().querySelectorAll(".pcard")).toHaveLength(2);
    expect(text(".pcard .pstat:nth-child(3) b")).toBe("7");
  });

  it("draws a project with work and one without, each with its six sections", async () => {
    await open("#status");
    expect(texts(".pcard .name")).toEqual(["BobNet", "Vitals"]);
    expect(texts(".pcard .top .badge")).toEqual(["Mostly OK", "Going OK"]);
    await go("#status/vitals");
    expect(texts("details.sec .hl")).toEqual(["Nothing waits on you", expect.stringMatching(/^Nothing closed since /), "Nothing stuck", "Comes with theme tags (BOB-35)", expect.stringMatching(/^0 Ready features/), "0 tokens"]);
    await go("#status/bobnet");
    expect(text("#sec-stuck .n")).toBe("7");
    expect(text("#sec-stuck .hl")).toBe("Nobody on it");
  });
});

describe("the marker moves only on I'm caught up (BOB-183 c2)", () => {
  it("not on open, a change, a minute's refresh, a wider span, a digest; on the button, with Undo", async () => {
    const before = iso(120);
    localStorage.setItem(MARK, before);
    const still = () => expect(localStorage.getItem(MARK)).toBe(before);
    await open("#overview");
    still();
    await go("#status");
    still();
    changed("bobnet");
    FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
    await settle(600);
    still();
    await press("24 h");
    await press("A week");
    await settle();
    still();
    await go("#status/bobnet");
    await go("#status/bobnet/stuck");
    await go("#status/needs");
    still();
    await click(view().querySelector(".span-bar .caught"));
    expect(localStorage.getItem(MARK)).not.toBe(before);
    await click($("toast").querySelector(".undo"));
    still();
  });
});

describe("Status's links (BOB-183 c3)", () => {
  it("lists Needs you compact with the link to answer them, and a digest's head opens its project's page", async () => {
    await open("#status");
    const needs = $("status-needs");
    expect(needs.querySelector("li")!.className).toBe("need compact");
    expect(needs.querySelector("button")).toBeNull();
    const all = needs.querySelector("a.sec-link")!;
    expect([all.textContent, all.getAttribute("href")]).toEqual(["Answer them on Needs you →", "#needs"]);
    await go("#status/bobnet");
    const link = view().querySelector(".p-head .p-link")!;
    expect([link.textContent, link.getAttribute("href")]).toEqual(["BobNet's page →", "#project/bobnet"]);
    expect(text("#sec-needs .sec-link")).toBe("Answer them on Needs you →");
  });
});
