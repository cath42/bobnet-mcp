import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { $, changed, click, go, iso, key, open, project, report, settle, snapshot, text, texts, view, worker, world, type Op } from "./page.ts";

// The Overview, Casper's start page (BOB-179; BOB-121 AC3, AC4, AC5), on a fake broker's `overview` and `waits`.

const BOBNET = project("bobnet", "BobNet", "BOB"), HELIX = project("helix", "Helix", "LAND"), VITALS = project("vitals", "Vitals", "VIT");
const PROJECTS = [BOBNET, HELIX, VITALS];
const release = (ref: string, title: string, done: number, total: number) => ({ ref, title, goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done, total }, backlog: { items: 0, bugs: 0, oldest: null } });
const feat = (ref: string, title: string, over: Record<string, unknown> = {}) => ({ ref, kind: "feature", type: "increment", status: "In Progress", title, parent: null, release: "R2", ord: 1, labels: [], progress: { checked: 6, total: 11 }, tasks: { done: 0, total: 0 }, open_since: iso(300), archived_at: null, ...over });
const ciOf = (...statuses: string[]) => statuses.map((status, i) => ({ name: `wf${i}`, runs: [{ name: `wf${i}`, branch: "main", status, sha: "4be01c77aa", url: null, started_at: iso(9), ended_at: status === "running" || status === "queued" ? null : iso(5), agent: null }] }));
const wait = (ref: string, over: Record<string, unknown> = {}) => ({ project: "helix", ref, kind: "question", text: `${ref} text`, feature: null, since: iso(60), blocking: false, holds: { sessions: [], items: [] }, waiting_sessions: [], asked_by: "Bill@mbp-1", recommended: null, context: null, needed_before: null, edits: [], ...over });

let rows: Record<string, Record<string, unknown>>;
let waits: unknown[];
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  world.laptops = [];
  world.boards = [];
  waits = [];
  const base = (p: unknown, over: Record<string, unknown>) => ({ project: p, release: null, release_number: null, done_unclosed: [], open: [], next_ready: null, waits_on_you: null, backlog: { items: 0, bugs: 0, oldest: null }, no_release: null, ci: [], ...over });
  rows = {
    // BobNet's and Helix's shapes: R1 all done and not closed; R2 the current one of each.
    bobnet: base(BOBNET, { release: release("R2", "R2 Start a session from the UI", 0, 1), release_number: 2, done_unclosed: [{ ref: "R1", title: "R1 Central backlog view" }], open: [feat("BOB-121", "Dashboard redesign")], next_ready: feat("BOB-52", "Stop or reset", { status: "Ready", open_since: null }), backlog: { items: 10, bugs: 1, oldest: iso(8 * 24 * 60) }, ci: ciOf("failed", "passed") }),
    helix: base(HELIX, { release: release("R2", "Edit and audit", 1, 6), release_number: 2, done_unclosed: [{ ref: "R1", title: "R1 Read" }], open: [feat("LAND-50", "Edit a tract"), feat("LAND-51", "Audit")], backlog: { items: 9, bugs: 3, oldest: iso(14 * 24 * 60) }, ci: ciOf("running", "passed") }),
    vitals: base(VITALS, {}),
  };
  Object.assign(world.reads, {
    projects: () => ({ projects: PROJECTS }),
    overview: () => ({ projects: Object.values(rows) }),
    waits: () => ({ waits, answered: [] }),
    status: (op: Op) => ({ at: iso(0), since: op["since"], projects: [] }),
    list: () => ({ items: [], releases: [], total: 0, cursor: null }),
    project: () => { throw new Error("unread"); },
    usage: () => { throw new Error("unread"); },
  });
});
const group = (k: string) => view().querySelector(`.now-p[data-project="${k}"]`)!;
const row = (k: string) => view().querySelector(`.prow[data-project="${k}"]`)!;
const cells = (k: string) => texts(".pc", row(k));
const helixLive = () => snapshot([worker({ id: "w_p", name: "Picard", role: "lead", project: "helix", session: "LAND-50 build Fixes" }), worker({ id: "w_h", name: "Howard", role: "builder", project: "helix", session: "LAND-50 build Fixes", state: "waiting-approval" }), worker({ id: "w_m", name: "Marvin", role: "qa", project: "helix", session: "LAND-50 build Fixes" })]);

describe("the Overview (BOB-179)", () => {
  it("Needs you: every item that holds work up, three when he has time then a link, each with its age, and the freshness line (c1)", async () => {
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([]) }];
    waits = [...[1, 2, 3, 4].map((i) => wait(`Q-${i}`, { blocking: true, since: iso(60 * 24 * i + 60) })), ...[5, 6, 7, 8, 9].map((i) => wait(`Q-${i}`, { since: iso(60 * i) }))];
    await open("#overview");
    expect(texts("#needs-holding .l-t")).toEqual(["Q-4 text", "Q-3 text", "Q-2 text", "Q-1 text"]);
    expect(texts("#needs-holding .age")).toEqual(["4 days", "3 days", "2 days", "1 day"]);
    expect(texts("#needs-rest h3")).toEqual(["When you have time 5"]);
    expect(texts("#needs-rest .l-t")).toEqual(["Q-9 text", "Q-8 text", "Q-7 text"]);
    expect(texts("#needs-rest .age")).toEqual(["9h 0m", "8h 0m", "7h 0m"]);
    expect(text(".ov-needs a.more")).toBe("2 more when you have time, and today's answers, on Needs you →");
    expect(text(".fresh")).toMatch(/^Up to date: mbp-1 reported \ds ago\./);
    waits = [];
    changed("helix");
    await settle();
    expect(text(".ov-needs .card")).toMatch(/^Nothing needs you\. Anything new shows here within a minute\.Up to date/);
  });

  it("Working now: a group per project in its order, its laptops, nobody's with who ran last, its queued (c2)", async () => {
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: helixLive() }, { laptop: "ubu1", at: iso(0), snapshot: snapshot([worker({ id: "w_d", name: "Daisy", project: "bobnet", session: "BOB-121 design A", state: "done", ended_at: iso(10) }), worker({ id: "w_t", name: "Toad", project: "bobnet", session: "BOB-51 review A", state: "failed", ended_at: iso(40) }), worker({ id: "w_q", name: "Luigi", project: "bobnet", state: "queued", started_at: null })]) }];
    await open("#overview");
    expect(text(".ov-now h2")).toBe("Working now 3");
    expect([...view().querySelectorAll(".now-p")].map((g) => g.getAttribute("data-project"))).toEqual(["bobnet", "helix", "vitals"]);
    expect(text(".nobody", group("bobnet"))).toBe("Nobody is running. Last: Daisy on BOB-121design A, ended 10m ago.");
    expect(text(".queued", group("bobnet"))).toBe("1 queued: Luigi");
    expect(text(".nobody", group("vitals"))).toBe("Nobody is running.");
    expect(texts(".grp-h", view())).toEqual(["BobNet", "Helixmbp-1", "Vitals"]);
    expect([...view().querySelectorAll(".grp-h a")].map((a) => a.getAttribute("href"))).toEqual(["#project/bobnet", "#project/helix", "#project/vitals"]);
    expect(texts(".l-who b", group("helix"))).toEqual(["Picard", "Howard", "Marvin"]);
    expect(texts(".l-path", group("helix"))[0]).toBe("LAND-50Fixes");
    // An agent of a project the service doesn't have keeps its line, last.
    report("mbp-1", snapshot([worker({ id: "w_s", name: "Writer", project: "sandbox" })]));
    await settle();
    expect([...view().querySelectorAll(".now-p")].map((g) => g.getAttribute("data-project"))).toEqual(["bobnet", "helix", "vitals", "sandbox"]);
    expect(text(".grp-h", group("sandbox"))).toBe("sandboxmbp-1");
    expect(group("sandbox").querySelector(".grp-h a")).toBeNull();
    // One detail row, as before, kept over a redraw.
    await click(group("sandbox").querySelector(".a-btn"));
    report("mbp-1", snapshot([worker({ id: "w_s", name: "Writer", project: "sandbox" })]));
    await settle();
    expect(group("sandbox").querySelector(".a-detail")).not.toBeNull();
  });

  it("Projects: the current release and its own count, what waits for his close, who is on what; the whole row opens its page (c3; AC5)", async () => {
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: helixLive() }];
    waits = [wait("Q-261", { blocking: true }), wait("DRAFT-118", { kind: "bug", blocking: true, since: iso(50) }), wait("Q-1")];
    await open("#overview");
    expect(cells("helix")).toEqual([
      "Helix ›mbp-1 · lead LeadLAND · PO PoLANDCI running3 running",
      "ReleaseR2 Edit and audit1 of 6 features doneR1 all done: waiting for your close",
      "Open nowLAND-50Edit a tractPicard, Howard, Marvin on itand 1 more open",
      "NextWaits on you: Q-261, DRAFT-118none Ready yet",
      "Backlog9 items3 bugs · oldest 14 days",
    ]);
    expect(cells("bobnet").slice(0, 4)).toEqual([
      "BobNet ›lead LeadBOB · PO PoBOBCI failednobody running",
      "ReleaseR2 Start a session from the UI0 of 1 feature doneR1 all done: waiting for your close",
      "Open nowBOB-121Dashboard redesignnobody on it now",
      "NextReady: BOB-52Stop or reset",
    ]);
    expect(cells("vitals")[1]).toBe("Releaseno open release");
    expect(row("helix").querySelector("a.warn-t")!.getAttribute("href")).toBe("#roadmap/helix");
    // The row's own link, and a tap between its cells' links.
    expect(row("helix").querySelector(".pname a")!.getAttribute("href")).toBe("#project/helix");
    expect(readFileSync(join(import.meta.dirname, "../public/style.css"), "utf8")).toContain('.prow .pname a::after { content: ""; position: absolute; inset: 0;');
    await click(row("helix").querySelector(".meter"));
    expect(location.hash).toBe("#project/helix");
    await go("#overview");
    await click(row("helix").querySelector("a.warn-t.v"));
    await go("#needs");
    expect(view().querySelector('.seg.filters [aria-pressed="true"]')!.textContent).toBe("Helix 3");
  });

  it("has who runs and CI per project, the quiet laptop's banner and the Status line (c4; AC3)", async () => {
    localStorage.setItem("bobnet.status.lastVisit", iso(7 * 60));
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: helixLive() }, { laptop: "ubu1", at: iso(9), snapshot: snapshot([]) }];
    await open("#overview");
    expect(text(".stale-banners .banner b")).toBe("ubu1 stopped reporting");
    expect(text(".st-line")).toBe("Since your last visit (7 h ago): 0 done, 0 stuckStatus →");
    expect(texts("#ci .ci-p")).toEqual(["BobNet", "", "Helix", ""]);
    expect([...view().querySelectorAll(".ov > *")].map((x) => x.className.split(" ")[0])).toEqual(["st-line", "ov-needs", "ov-side", "ov-proj"]);
    expect([...view().querySelectorAll(".ov-side > *")].map((x) => x.className)).toEqual(["ov-now", "ov-ci"]);
  });

  it("has no 'show other states' panel anywhere (c5)", () => {
    for (const f of ["app.js", "style.css", "index.html"]) expect(readFileSync(join(import.meta.dirname, "../public", f), "utf8")).not.toMatch(/proto-states|show other states/i);
  });

  it("a project's CI is its worst workflow's: failed, then running or queued, then passed; a cancelled run ranks nothing (c6)", async () => {
    await open("#overview");
    const pill = async (...statuses: string[]) => {
      rows["bobnet"]!["ci"] = ciOf(...statuses);
      changed("bobnet");
      await settle();
      const p = row("bobnet").querySelector<HTMLElement>(".ci-pill");
      return p && [p.textContent, p.dataset["tone"]];
    };
    expect(await pill("running", "failed", "passed")).toEqual(["CI failed", "bad"]);
    expect(await pill("passed", "running")).toEqual(["CI running", "run"]);
    expect(await pill("queued")).toEqual(["CI queued", "idle"]);
    expect(await pill("passed", "queued")).toEqual(["CI queued", "idle"]);
    expect(await pill("cancelled", "passed")).toEqual(["CI passed", "ok"]);
    expect(await pill("cancelled", "failed")).toEqual(["CI failed", "bad"]);
    expect(await pill("cancelled")).toEqual(["CI cancelled", "idle"]);
    expect(await pill()).toBeNull();
  });

  it("says how long an item is unchanged as its age reads, once when it is opened, its links last (c7; Daisy m6)", async () => {
    const stale = (min: number) => ({ changed_at: iso(min), owner: "Peach@mbp-1", flagged_at: iso(180) });
    waits = [wait("Q-1", { blocking: true, since: iso(60 * 60), stale: stale(190) }), wait("Q-2", { blocking: true, since: iso(60 * 50), stale: stale(60 * 49) }), wait("Q-3", { since: iso(60 * 73), stale: stale(60 * 73), context: "Long." })];
    await open("#overview");
    const item = (ref: string) => view().querySelector(`li[data-ref="${ref}"]`)!;
    expect(text(".stale", item("Q-1"))).toBe("Unchanged for 3h 10m, Peach asked to check it 3h 0m ago");
    expect(text(".stale", item("Q-2"))).toBe("Unchanged for 2 days, Peach asked to check it 3h 0m ago");
    expect(text(".l-m", item("Q-3"))).toBe("Helix · from Bill · unchanged 3 days");
    await key(item("Q-3").querySelector(".l-t"), "Enter");
    expect(text(".l-m", item("Q-3"))).toBe("Helix · from Bill");
    expect(text(".whole", item("Q-3"))).toBe("Unchanged for 3 days, Peach asked to check it 3h 0m ago");
    expect([...item("Q-3").children].map((c) => c.className).slice(-2)).toEqual(["m-row", "n-links"]);
    expect(texts(".n-links a", item("Q-3"))).toEqual(["Its context, on Needs you →", "Answer it on Needs you →"]);
    // From another project's Needs you, its link still lands on the item.
    await go("#needs");
    await click([...view().querySelectorAll(".seg.filters button")].find((b) => b.textContent!.startsWith("BobNet")));
    await go("#overview");
    await click(item("Q-3").querySelectorAll(".n-links a")[1]);
    await go("#needs");
    expect($("w-helix/Q-3")).not.toBeNull();
  });
});
