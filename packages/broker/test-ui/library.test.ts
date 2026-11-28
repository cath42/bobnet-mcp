import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkLibrary, LIBRARY_STANDARD } from "@bobnet/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { viewerPath } from "../src/csp.ts";
import { $, click, FakeSocket, go, iso, key, open, project, refuse, sent, settle, text, texts, view, world, type Op } from "./page.ts";
// markdown-it as the page vendors it: the page takes the one already loaded.
(globalThis as { markdownit?: unknown }).markdownit = (await import("../public/vendor/markdown-it-15.0.3.min.js" as string)).default;

// A project's library (BOB-212; design/BOB-212/spec.md v6) on a fake broker's `library` and `library_page`, the
// library standard's sample, Toolshed, as its supervisor would send it.

const SAMPLE = join(import.meta.dirname, "../../../architecture/spikes/bob212/sample");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const SAMPLE_FILES = walk(join(SAMPLE, "library")).map((f) => ({ path: relative(SAMPLE, f), text: readFileSync(f, "utf8") }));
const COMMIT = "1c83f2b0000000000000000000000000000000aa";
const GH = "https://github.com/cath42/toolshed";

const TOOLSHED = { ...project("toolshed", "Toolshed", "TS"), library: { commit: COMMIT, committed_at: "2026-11-26T21:34:00Z", checked_at: iso(4), written: true, title: "Toolshed", tagline: "A neighbourhood tool library: borrow the drill, don't buy it", problems: 0 } };
const HELIX = { ...project("helix", "Helix", "LAND"), library: { commit: COMMIT, committed_at: "2026-11-26T21:34:00Z", checked_at: iso(4), written: false, title: null, tagline: null, problems: 0 } };
const VITALS = { ...project("vitals", "Vitals", "VIT"), library: null };

let files: Array<{ path: string; text: string }>;
let lib: Record<string, Record<string, unknown> | null>;

/** The library as the Board keeps it (0017 §4): the index from protocol's own check of the files. */
function libraryOf(key: string, fs: Array<{ path: string; text: string }> | null, over: Record<string, unknown> = {}) {
  const checked = fs && checkLibrary(fs.map((f) => ({ ...f, bytes: Buffer.byteLength(f.text) })));
  return {
    project: key, ref: "origin/main", commit: COMMIT, committed_at: "2026-11-26T21:34:00Z", checked_at: iso(4), laptop: "mbp-1", github: GH,
    index: checked ? { standard: 1, files: checked.files.map((f, i) => ({ ...f, blob: String(i).padStart(40, "0"), changed: { sha: "1c83f2b", date: "2026-11-26T21:34:00Z" } })) } : null,
    problems: checked?.problems ?? [],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  world.laptops = [];
  files = SAMPLE_FILES;
  lib = { toolshed: libraryOf("toolshed", files), helix: libraryOf("helix", null), vitals: null };
  Object.assign(world.reads, {
    projects: () => ({ projects: [TOOLSHED, HELIX, VITALS] }),
    overview: () => ({ projects: [] }),
    waits: () => ({ waits: [], answered: [] }),
    library: (op: Op) => ({ library: lib[op["project"] as string] ?? null, standard: LIBRARY_STANDARD, now: new Date().toISOString() }),
    library_page: (op: Op) => {
      const l = lib[op["project"] as string] as { index: { files: Array<{ path: string; section: string }> } };
      const paths = l.index.files.filter((f) => f.section === op["section"] && (!op["path"] || f.path === op["path"])).map((f) => f.path);
      return { commit: COMMIT, files: files.filter((f) => paths.includes(f.path)) };
    },
  });
});

/** Opens a library address and waits for markdown-it and the reads. */
async function at(hash: string) {
  await open(hash);
  await settle(600);
}
const hrefs = (sel: string) => [...view().querySelectorAll(sel)].map((a) => a.getAttribute("href"));

describe("the library's page (spec §4-§8)", () => {
  it("shows the seven sections in the standard's order, the owners from the overview, and the home's tiles from the index alone", async () => {
    await at("#project/toolshed/library");
    expect(texts(".secs-nav a")).toEqual(["Home", "Overview", "Architecture", "Data model", "Decisions", "Use cases", "UX design", "Glossary"]);
    expect(text(".lib-home .doc-title")).toBe("Toolshed");
    expect(text(".lib-home .who")).toBe("Wren, product owner · Otto, architect · Ines, designer");
    expect(texts(".lib-tile b")).toEqual(["Overview", "Architecture", "Data model", "Decisions", "Use cases", "UX design", "Glossary"]);
    expect(text(".lib-tile:nth-child(4) .sts")).toBe("2 accepted · 1 superseded");
    expect(text(".lib-how")).toMatch(/^7 of 7 sections written/);
    // The home reads only the index: no section's texts.
    expect(sent("library_page")).toEqual([]);
    expect(text(".p-tabs .fresh")).toMatch(/^As of main at 1c83f2b, 26 Nov \d\d:34 · checked 4 min ago from mbp-1$/);
    expect(view().querySelector(".p-tabs nav a[aria-current]")?.textContent).toBe("Library");
  });

  it("marks a section not written with who writes it, and lists the problems with their count, by file and line", async () => {
    files = SAMPLE_FILES.filter((f) => f.path !== "library/glossary.md").map((f) => (f.path.startsWith("library/decisions/0001") ? { ...f, text: f.text.replace("status: accepted", "status: decided") } : f));
    lib["toolshed"] = libraryOf("toolshed", [...files, { path: "library/notes/ideas.md", text: "# Ideas\n" }]);
    await at("#project/toolshed/library");
    expect(text(".secs-nav a.missing")).toBe("Glossarynot written yet · product owner");
    expect(text(".lib-tile.missing")).toBe("GlossaryNot written yetthe product owner, Wren, writes it");
    expect(text(".probs summary")).toBe("2 problems with the library standard");
    expect(texts(".probs li")).toEqual([
      'decisions/0001-reservations-hold-for-24-hours.md line 2 ↗: status is "decided": it is one of proposed, accepted, rejected, deprecated or superseded',
      "notes/ideas.md ↗: the standard doesn't name this file, so it isn't shown",
    ]);
    expect(hrefs(".probs li a")[0]).toBe(`${GH}/blob/${COMMIT}/library/decisions/0001-reservations-hold-for-24-hours.md#L2`);
    expect(text(".p-tabs .fresh .probs-n")).toBe("2 problems");
    expect(text('.secs-nav a[href$="/decisions"]')).toBe("Decisions 1");
    await go("#project/toolshed/library/glossary");
    expect(text(".nw-card")).toBe("Glossary isn't written yet.It holds: terms in users' words, A to Z.The product owner (Wren) writes it as library/glossary.md on main, from its template in the library standard ↗.");
    // A status outside the standard shows as written, with "?".
    await go("#project/toolshed/library/decisions");
    expect(text(".adr-list li:last-child .st.odd")).toBe("decided ?");
  });

  it("says a project with no library/ on main has none, and one whose laptop sent none", async () => {
    await at("#project/helix/library");
    expect(text(".lib-empty b")).toBe("Helix has no library on main yet.");
    expect(texts(".lib-tile.missing code")).toEqual(LIBRARY_STANDARD.sections.map((s) => s.path));
    await go("#project/vitals/library");
    expect(text(".lib-empty b")).toBe("No library from Vitals's laptop yet.");
  });

  it("warns when the check is 2 hours old or the last fetch failed", async () => {
    lib["toolshed"] = libraryOf("toolshed", files, { checked_at: iso(5 * 60) });
    await at("#project/toolshed/library");
    expect(view().querySelector(".fresh")!.classList.contains("warn")).toBe(true);
    expect(text(".banner b")).toBe("This may be behind main.");
    lib["toolshed"] = libraryOf("toolshed", files, { problems: [{ kind: "fetch_failed", at: iso(12), message: "git fetch origin main: Could not resolve host: github.com" }] });
    await at("#project/toolshed/library");
    expect(text(".banner b")).toBe("mbp-1 couldn't fetch Toolshed 12 min ago.");
  });

  it("reads the library again on its board_changed, and says main moved", async () => {
    await at("#project/toolshed/library/overview");
    lib["toolshed"] = libraryOf("toolshed", files, { commit: "9c01d2e".padEnd(40, "0") });
    $("toast").hidden = true;
    FakeSocket.last.frame({ t: "board_changed", project: "toolshed", seq: 1, refs: ["library"] });
    await settle(600);
    expect(text(".p-tabs .fresh")).toMatch(/^As of main at 9c01d2e/);
    expect($("toast").textContent).toBe("Toolshed's library is now main at 9c01d2e.");
  });
});

describe("the library's addresses and links (spec §2, §14)", () => {
  it("opens each section, card and term at its address, and an unknown one says so", async () => {
    await at("#project/toolshed/library/overview/quality-goals");
    expect(text(".sec-head .doc-title")).toBe("Overview");
    expect(view().querySelector("#h-quality-goals")).not.toBeNull();
    expect(hrefs(".lib-toc a")).toContain("#project/toolshed/library/overview/quality-goals");
    await go("#project/toolshed/library/decisions/0003/consequences");
    expect(text(".eyebrow")).toBe("Decision 0003");
    expect(text(".child-t")).toBe("Reminders go by push, with email as the fallback");
    expect(sent("library_page").at(-1)!.op).toMatchObject({ section: "decisions", path: "library/decisions/0003-push-reminders-email-fallback.md" });
    await go("#project/toolshed/library/glossary/hold");
    expect(texts(".az a")).toEqual(["C", "D", "H", "L", "M", "R", "S", "T"]);
    expect(text(".find-bar > .count")).toBe("10 terms");
    await settle(50);
    expect(view().querySelector("#t-hold")!.classList.contains("on")).toBe(true);
    await go("#project/toolshed/library/notes");
    expect(text(".lib-empty b")).toBe('A library has no section "notes".');
    await go("#project/toolshed/library/decisions/0009");
    expect(text(".lib-empty b")).toBe("Decisions has no card 0009.");
  });

  it("keeps a library link in place, sends another repo file to GitHub at the commit, and leaves other schemes as text", async () => {
    files = SAMPLE_FILES.map((f) => (f.path.startsWith("library/usecases/0001")
      ? { ...f, text: `${f.text}\nSee [the hold](../decisions/0001-reservations-hold-for-24-hours.md#decision), [terms](../glossary.md#hold), [the code](../../src/hold.ts), [goals](#goal), [web](https://example.com/x), [mail](mailto:wren@example.com), [bad](javascript:alert(1)) and ![shot](../ux/images/0001.png).\n` }
      : f));
    lib["toolshed"] = libraryOf("toolshed", files);
    await at("#project/toolshed/library/usecases/0001");
    const a = (label: string) => [...view().querySelectorAll(".doc a")].find((x) => x.textContent === label);
    expect(a("the hold")!.getAttribute("href")).toBe("#project/toolshed/library/decisions/0001/decision");
    expect(a("terms")!.getAttribute("href")).toBe("#project/toolshed/library/glossary/hold");
    expect(a("the code")!.getAttribute("href")).toBe(`${GH}/blob/${COMMIT}/src/hold.ts`);
    expect(a("the code")!.getAttribute("target")).toBe("_blank");
    expect(a("goals")!.getAttribute("href")).toBe("#project/toolshed/library/usecases/0001/goal");
    expect(a("web")!.getAttribute("rel")).toBe("noopener");
    // markdown-it refuses javascript: itself; any other scheme is plain text.
    expect(a("bad")).toBeUndefined();
    expect(text(".doc")).toContain("[bad](javascript:alert(1))");
    expect(a("mail")).toBeUndefined();
    expect(text(".doc .dead")).toBe("mail");
    expect(view().querySelector(".doc img")).toBeNull();
    expect(a("shot")!.getAttribute("href")).toBe(`${GH}/blob/${COMMIT}/library/ux/images/0001.png`);
  });

  it("renders a file with a malformed escape in a link, the link's path kept as written (Toad, review A 5)", async () => {
    files = SAMPLE_FILES.map((f) => (f.path.startsWith("library/usecases/0001") ? { ...f, text: `${f.text}\nSee [x](a%zz.md) and [y](notes%20on%20holds.md).\n` } : f));
    lib["toolshed"] = libraryOf("toolshed", files);
    await at("#project/toolshed/library/usecases/0001");
    expect(text(".child-t")).toBe("Reserve a tool");
    expect(text(".doc")).toContain("See x and y.");
    const a = (label: string) => [...view().querySelectorAll(".doc a")].find((x) => x.textContent === label);
    expect(a("x")!.getAttribute("href")).toBe(`${GH}/blob/${COMMIT}/library/usecases/a%zz.md`);
    expect(a("y")!.getAttribute("title")).toBe("library/usecases/notes on holds.md on GitHub at 1c83f2b");
  });

  it("shows raw HTML in a file as text, never as markup", async () => {
    files = SAMPLE_FILES.map((f) => (f.path === "library/overview.md" ? { ...f, text: `${f.text}\n<script>window.pwned = 1</script><b onclick="x()">bold</b>\n` } : f));
    lib["toolshed"] = libraryOf("toolshed", files);
    await at("#project/toolshed/library/overview");
    expect(view().querySelector(".doc script, .doc b[onclick]")).toBeNull();
    expect(text(".doc")).toContain("<script>window.pwned = 1</script>");
  });
});

describe("the cards (spec §9)", () => {
  it("derives superseded by from the others' supersedes, and links both ways", async () => {
    await at("#project/toolshed/library/decisions");
    expect(texts(".adr .t")).toEqual(["Reminders go by push, with email as the fallback", "Reminders go by email superseded by 0003", "Reservations hold a tool until 24 hours after the pickup day"]);
    expect(text(".find-bar > .count")).toBe("3 decisions, newest first");
    await go("#project/toolshed/library/decisions/0002");
    const field = (k: string) => [...view().querySelectorAll(".head-box div")].find((d) => d.querySelector("dt")?.textContent === k);
    expect(field("Superseded by")!.querySelector("a")!.getAttribute("href")).toBe("#project/toolshed/library/decisions/0003");
    await go("#project/toolshed/library/decisions/0003");
    expect(field("Supersedes")!.textContent).toBe("Supersedes0002 Reminders go by email");
  });

  it("links a use case to its uc<NNNN> flow when the model has one, and to the UX cards that name it; and a UX card back", async () => {
    await at("#project/toolshed/library/usecases");
    const card = (n: string) => [...view().querySelectorAll(".uc-card")].find((c) => c.querySelector(".cnum")?.textContent === n)!;
    expect([...card("0001").querySelectorAll(".uc-links a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Its flow ›", "#project/toolshed/library/architecture/uc0001"],
      ["UX 0001", "#project/toolshed/library/ux/0001"],
    ]);
    expect(card("0003").querySelector(".uc-links a")!.textContent).toBe("UX 0002");
    expect(text(".uc-f dd", card("0003")!)).toBe("Member");
    await go("#project/toolshed/library/ux");
    expect(texts(".ux-card .ux-v")).toEqual(["Waiting on a verdict", "Yes, this is it. Make the free days bigger.the verdict, 9 Mar 2026"]);
    expect(hrefs(".ux-card:last-child .uc-links a")).toEqual(["#project/toolshed/library/usecases/0001"]);
  });

  it("finds a card by its words and filters by status", async () => {
    await at("#project/toolshed/library/decisions");
    const find = view().querySelector<HTMLInputElement>(".find-bar input")!;
    find.value = "email";
    find.dispatchEvent(new Event("input"));
    expect(text(".find-bar > .count")).toBe("2 of 3 decisions");
    find.value = "";
    find.dispatchEvent(new Event("input"));
    await click([...view().querySelectorAll(".find-bar .seg button")].find((b) => b.textContent!.startsWith("Superseded")));
    expect(text(".find-bar > .count")).toBe("1 of 3 decisions");
  });
});

describe("the Projects menu (spec §3) and the Overview's Library link", () => {
  it("names the project shown, lists every project with its library's line, and closes on Escape", async () => {
    await at("#project/toolshed/library");
    expect(text("#pm-btn", document)).toBe("Toolshed▾");
    expect($("pm-btn").hasAttribute("aria-current")).toBe(true);
    expect(document.querySelector('#tabs > a[aria-current]')).toBeNull();
    await click($("pm-btn"));
    expect($("pm-btn").getAttribute("aria-expanded")).toBe("true");
    expect(texts(".pm-row", $("pm-list"))).toEqual([
      "ToolshedA neighbourhood tool library: borrow the drill, don't buy itLibrary",
      "HelixLibrary not written yetLibrary",
      "VitalsLibrary not written yetno library",
    ]);
    expect(document.activeElement?.textContent).toBe("Toolshed");
    await key(document.activeElement, "ArrowDown");
    expect(document.activeElement?.getAttribute("href")).toBe("#project/toolshed/library");
    await key(document.activeElement, "Escape");
    expect($("pm-pop").hidden).toBe(true);
    expect(document.activeElement).toBe($("pm-btn"));
    await go("#overview");
    expect(text("#pm-btn", document)).toBe("Projects▾");
  });

  it("keeps the section when the project switch picks another project", async () => {
    await at("#project/toolshed/library/decisions");
    await click([...view().querySelectorAll(".seg.projects button")].find((b) => b.textContent === "Helix"));
    expect(location.hash).toBe("#project/helix/library/decisions");
  });

  it("says the library couldn't be read, with Retry", async () => {
    world.reads["library"] = () => refuse("The board can't be reached");
    await at("#project/toolshed/library");
    expect(text(".banner.down")).toBe("The library couldn't be readThe board can't be reachedRetry");
  });
});

// ---------- the architecture: the LikeC4 frame (BOB-234; ADR 0016 §6, 0017 §7; spec §10) ----------

/** The views as the vendored viewer says them for the sample (tools/vendor/likec4-viewer.jsx; frame-test.mjs). */
const VIEWS = [
  { id: "index", title: "Context", label: "Context", dynamic: false, crumb: ["index"] },
  { id: "containers", title: "Containers", label: "Toolshed", dynamic: false, crumb: ["index", "containers"] },
  { id: "apiComponents", title: "API", label: "API", dynamic: false, crumb: ["index", "containers", "apiComponents"] },
  { id: "workerComponents", title: "Reminder worker", label: "Reminder worker", dynamic: false, crumb: ["index", "containers", "workerComponents"] },
  { id: "uc0001", title: "Reserve a tool", label: "Reserve a tool", dynamic: true, crumb: ["index", "uc0001"] },
  { id: "uc0002", title: "Borrow and return a tool", label: "Borrow and return a tool", dynamic: true, crumb: ["index", "uc0002"] },
  { id: "prod", title: "Production", label: "Production", dynamic: false, crumb: ["index", "prod"] },
];
const C4 = () => SAMPLE_FILES.filter((f) => f.path.startsWith("library/architecture/"));

/** The frame on the page, as the viewer in it: what the page posts it, and a message from it. happy-dom loads no frame. */
function frame() {
  const el = view().querySelector("iframe")!;
  const posted: Array<Record<string, unknown>> = [];
  const win = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
  Object.defineProperty(el, "contentWindow", { value: win, configurable: true });
  const say = async (data: unknown, source: unknown = win) => {
    window.dispatchEvent(new MessageEvent("message", { data, source: source as Window }));
    await settle(20);
  };
  return { el, posted, say };
}

const crumb = () => texts(".vf-crumb > *").join(" ");

describe("the architecture (spec §10; ADR 0016 §6, 0017 §7)", () => {
  it("frames the pinned LikeC4 viewer at the address the Worker gives its own content policy", async () => {
    const vendor = JSON.parse(readFileSync(join(import.meta.dirname, "../public/vendor/viewers.json"), "utf8")) as { likec4: { file: string } };
    expect(viewerPath("likec4")).toBe(`/vendor/${vendor.likec4.file.replace(/\.html$/, "")}`);
    await at("#project/toolshed/library/architecture");
    const el = view().querySelector(".vf-box iframe")!;
    expect(el.getAttribute("src")!.endsWith(viewerPath("likec4"))).toBe(true);
    expect(el.getAttribute("sandbox")).toBe("allow-scripts");
    expect(el.getAttribute("title")).toBe("Toolshed's architecture: a diagram you can zoom and open");
  });

  it("hands the viewer the model's files and the address's view, and draws the bar from its ready", async () => {
    await at("#project/toolshed/library/architecture/apiComponents");
    expect(sent("library_page").at(-1)!.op).toMatchObject({ section: "architecture" });
    // A diagram page folds the rail into its head at every width: the section's name opens the sections.
    expect(view().querySelector(".lib.diagram .sec-head .lib-rail.folded")).not.toBeNull();
    expect(text(".sec-head .secs-pick")).toBe("Section: Architecture▾");
    expect(text(".sec-head > .muted")).toBe("owner Otto");
    expect(text(".vf-veil")).toBe("Drawing the model…The first time on this device, the viewer downloads (2.5 MB).");
    expect(text(".src-line")).toBe("Model: library/architecture/ ↗ · LikeC4 · main at 1c83f2b");
    expect(hrefs(".src-line a")).toEqual([`${GH}/tree/${COMMIT}/library/architecture`]);
    const v = frame();
    await v.say({ t: "hello" });
    expect(v.posted).toEqual([{ t: "files", kind: "likec4", files: C4(), focus: "apiComponents" }]);
    await v.say({ t: "ready", errors: [], views: VIEWS });
    expect(view().querySelector<HTMLElement>(".vf-veil")!.hidden).toBe(true);
    expect(crumb()).toBe("Context › Toolshed › API");
    expect(text(".vf-crumb b")).toBe("API");
    expect(text(".vf-where .vf-title")).toBe("Level 3: the components of API");
    expect([...view().querySelectorAll(".vf-pick optgroup")].map((g) => [g.getAttribute("label"), [...g.querySelectorAll("option")].map((o) => o.textContent)])).toEqual([
      ["C4 levels", ["Context", "Containers", "API: components", "Reminder worker: components"]],
      ["Use-case flows", ["0001 · Reserve a tool", "0002 · Borrow and return a tool"]],
      ["Deployment", ["Production"]],
    ]);
    expect(view().querySelector<HTMLSelectElement>(".vf-pick")!.value).toBe("apiComponents");
    expect(view().querySelector<HTMLButtonElement>(".vf-back")!.disabled).toBe(false);
    expect(view().querySelector(".vf-warn")!.hasAttribute("hidden")).toBe(true);
  });

  it("puts the reader's drill in the address as a history entry, and moves the frame from the bar, the crumb and Back", async () => {
    await at("#project/toolshed/library/architecture");
    const v = frame();
    await v.say({ t: "hello" });
    expect(v.posted[0]).toMatchObject({ focus: "index" });
    await v.say({ t: "ready", errors: [], views: VIEWS });
    expect(view().querySelector<HTMLButtonElement>(".vf-back")!.disabled).toBe(true);
    expect(text(".vf-where .vf-title")).toBe("Level 1: the context");
    // The viewer drilled: the address follows, and nothing goes back to it.
    const entries = history.length;
    await v.say({ t: "focus", focus: "containers" });
    expect(location.hash).toBe("#project/toolshed/library/architecture/containers");
    expect(history.length).toBe(entries + 1);
    expect(crumb()).toBe("Context › Toolshed");
    expect(v.posted).toHaveLength(1);
    // ↑ Out, the views and the crumb send it focus.
    await click(view().querySelector(".vf-back"));
    expect(location.hash).toBe("#project/toolshed/library/architecture");
    expect(v.posted.at(-1)).toEqual({ t: "focus", focus: "index" });
    const pick = view().querySelector<HTMLSelectElement>(".vf-pick")!;
    pick.value = "uc0001";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(20);
    expect(location.hash).toBe("#project/toolshed/library/architecture/uc0001");
    expect(v.posted.at(-1)).toEqual({ t: "focus", focus: "uc0001" });
    // A flow links its use case; its level up is the context.
    expect(text(".vf-where .vf-title")).toBe("The flow of use case 0001: Reserve a tool ›");
    expect(hrefs(".vf-where .vf-title a")).toEqual(["#project/toolshed/library/usecases/0001"]);
    expect(crumb()).toBe("Context › Reserve a tool");
    await click(view().querySelector(".vf-crumb a"));
    expect(v.posted.at(-1)).toEqual({ t: "focus", focus: "index" });
    // The address moves it too (Back, a link): the same frame, not drawn again; and Fit.
    await go("#project/toolshed/library/architecture/prod");
    expect(v.posted.at(-1)).toEqual({ t: "focus", focus: "prod" });
    expect(text(".vf-where .vf-title")).toBe("Where it runs");
    expect(view().querySelector("iframe")).toBe(v.el);
    await click([...view().querySelectorAll(".vf-btns button")].find((b) => b.textContent === "Fit"));
    expect(v.posted.at(-1)).toEqual({ t: "fit" });
    // A redraw of the page (a read, a report) leaves the frame where it is: an iframe moved loads anew.
    FakeSocket.last.frame({ t: "board_changed", project: "toolshed", seq: 2, refs: ["library"] });
    await settle(600);
    expect(view().querySelector("iframe")).toBe(v.el);
    expect(v.el.isConnected).toBe(true);
  });

  it("opens a link in the model in a tab of its own, and takes no message from any window but its frame's", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    await at("#project/toolshed/library/architecture");
    const v = frame();
    await v.say({ t: "hello" }, { postMessage() {} });
    expect(v.posted).toEqual([]);
    await v.say({ t: "hello" });
    await v.say({ t: "ready", errors: [], views: VIEWS });
    await v.say({ t: "focus", focus: "containers" }, window);
    expect(location.hash).toBe("#project/toolshed/library/architecture");
    await v.say({ t: "open", url: "https://example.com/adr" });
    await v.say({ t: "open", url: "javascript:alert(1)" });
    expect(opened.mock.calls).toEqual([["https://example.com/adr", "_blank", "noopener"]]);
    opened.mockRestore();
  });

  it("lists the model's errors by file and line: over a drawn model, or in its place with its files and Try again", async () => {
    await at("#project/toolshed/library/architecture/nope");
    let v = frame();
    await v.say({ t: "hello" });
    const errors = [{ path: "views.c4", line: 30, message: "Could not resolve reference to 'toolshed.api.reservation'" }];
    await v.say({ t: "ready", errors, views: VIEWS });
    // An unknown view opens the context, and says nothing.
    expect(location.hash).toBe("#project/toolshed/library/architecture");
    expect(crumb()).toBe("Context");
    expect(text(".vf-warn summary")).toBe("1 problem in the model: what they touch may be missing");
    expect(text(".vf-warn li")).toBe("views.c4 line 30 ↗: Could not resolve reference to 'toolshed.api.reservation'");
    expect(hrefs(".vf-warn li a")).toEqual([`${GH}/blob/${COMMIT}/library/architecture/views.c4#L30`]);

    await at("#project/toolshed/library/architecture");
    v = frame();
    await v.say({ t: "hello" });
    await v.say({ t: "ready", errors: [...errors, { path: "", line: 0, message: "The model couldn't be read" }], views: [] });
    expect(view().querySelector(".vf-box")).toBeNull();
    expect(text(".vf-fail b")).toBe("This model couldn't be drawn here.");
    expect(texts(".vf-fail p")[0]).toBe("The viewer found errors in it:");
    expect(texts(".vf-fail .errs li")).toEqual(["views.c4 line 30 ↗: Could not resolve reference to 'toolshed.api.reservation'", "The model couldn't be read"]);
    expect(texts(".vf-fail .files li")).toEqual(C4().map((f) => expect.stringMatching(new RegExp(`^${f.path.slice(8)} ↗ \\d+ KB$`))));
    expect(view().querySelector<HTMLElement>(".vf-bar")!.hidden).toBe(true);
    await click([...view().querySelectorAll(".vf-fail button")].find((b) => b.textContent === "Try again"));
    await settle(400);
    expect(view().querySelector(".vf-fail")).toBeNull();
    expect(view().querySelector(".vf-box iframe")).not.toBe(v.el);
  });

  it("says a model over the limits is too large, with its files on GitHub, and draws no frame", async () => {
    const l = libraryOf("toolshed", files) as { index: { files: Array<{ section: string; too_large?: true }> } };
    for (const f of l.index.files) if (f.section === "architecture") f.too_large = true;
    lib["toolshed"] = l as unknown as Record<string, unknown>;
    await at("#project/toolshed/library/architecture");
    expect(view().querySelector("iframe")).toBeNull();
    expect(sent("library_page")).toEqual([]);
    expect(text(".vf-fail b")).toBe("This model is too large to show here");
    expect(text(".vf-fail p")).toMatch(/^3 files, \d+ KB: a model shows here up to 64 files and 512 KB\. Its files on GitHub:$/);
    expect(hrefs(".vf-fail .files a")).toEqual(C4().map((f) => `${GH}/blob/${COMMIT}/${f.path}`));
  });

  it("opens the sections from the folded title, and closes them on a click outside or Escape, the focus back on the title", async () => {
    await at("#project/toolshed/library/architecture");
    const pick = view().querySelector<HTMLButtonElement>(".lib-rail.folded .secs-pick")!;
    await click(pick);
    expect(pick.getAttribute("aria-expanded")).toBe("true");
    expect(texts(".lib-rail.folded .secs-nav a")).toEqual(["Home", "Overview", "Architecture", "Data model", "Decisions", "Use cases", "UX design", "Glossary"]);
    await click(view().querySelector(".src-line"));
    expect(pick.getAttribute("aria-expanded")).toBe("false");
    await click(pick);
    await key(document.body, "Escape");
    expect(pick.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(pick);
  });
});

// ---------- the data model: Liam ERD as is (BOB-235; ADR 0017 §7; spec §11) ----------

describe("the data model (spec §11; ADR 0017 §7)", () => {
  const DBML = () => SAMPLE_FILES.filter((f) => f.path === "library/data-model.dbml");

  it("frames Liam ERD as is, hands it the DBML once, and shows how many tables it drew, the source line and Full screen", async () => {
    await at("#project/toolshed/library/data");
    const el = view().querySelector(".vf-erd .vf-box iframe")!;
    expect(el.getAttribute("src")!.endsWith(viewerPath("erd"))).toBe(true);
    expect(el.getAttribute("sandbox")).toBe("allow-scripts");
    expect(sent("library_page").at(-1)!.op).toMatchObject({ section: "data" });
    expect(text(".sec-head .secs-pick")).toBe("Section: Data model▾");
    expect(text(".vf-veil")).toBe("Drawing the data model…The first time on this device, the viewer downloads (1.4 MB).");
    // Until ready the bar's left is empty, not a placeholder.
    expect(text(".vf-count")).toBe("");
    expect(text(".src-line")).toBe("Model: data-model.dbml ↗ · DBML · main at 1c83f2b");
    expect(hrefs(".src-line a")).toEqual([`${GH}/blob/${COMMIT}/library/data-model.dbml`]);
    const v = frame();
    await v.say({ t: "hello" });
    expect(v.posted).toEqual([{ t: "files", kind: "erd", files: DBML() }]);
    await v.say({ t: "ready", errors: [], tables: 9 });
    expect(view().querySelector<HTMLElement>(".vf-veil")!.hidden).toBe(true);
    expect(text(".vf-count")).toBe("9 tables");
    // Nothing else crosses: no crumb, no picker, no Fit; the bar's one control is the page's Full screen.
    expect(view().querySelector(".vf-erd .vf-crumb, .vf-erd .vf-pick")).toBeNull();
    expect(texts(".vf-erd .vf-bar button")).toEqual(["Full screen"]);
    const full = view().querySelector<HTMLButtonElement>(".vf-full-b")!;
    await click(full);
    expect(view().querySelector(".vf-erd")!.classList.contains("full")).toBe(true);
    expect(full.textContent).toBe("Close");
    await key(full, "Escape");
    expect(view().querySelector(".vf-erd")!.classList.contains("full")).toBe(false);
    // The library's staleness is the page's head, as on every section.
    expect(text(".p-tabs .fresh")).toMatch(/^As of main at 1c83f2b/);
  });

  it("lists the DBML's errors by line, linked, in place of the frame: no half-drawn ERD", async () => {
    await at("#project/toolshed/library/data");
    const v = frame();
    await v.say({ t: "hello" });
    await v.say({ t: "ready", errors: [{ path: "library/data-model.dbml", line: 51, message: "Table 'sheds' does not exist in Schema 'public'" }], tables: 0 });
    expect(view().querySelector(".vf-box")).toBeNull();
    expect(text(".vf-fail b")).toBe("This data model couldn't be drawn here.");
    expect(texts(".vf-fail p")[0]).toBe("The viewer found errors in it:");
    expect(texts(".vf-fail .errs li")).toEqual(["data-model.dbml line 51 ↗: Table 'sheds' does not exist in Schema 'public'"]);
    expect(hrefs(".vf-fail .errs a")).toEqual([`${GH}/blob/${COMMIT}/library/data-model.dbml#L51`]);
    expect(texts(".vf-fail .files li")).toEqual([expect.stringMatching(/^data-model\.dbml ↗ \d+ KB$/)]);
    expect(texts(".vf-fail p")[1]).toBe("Its file on GitHub at 1c83f2b:");
    expect(view().querySelector<HTMLElement>(".vf-erd .vf-bar")!.hidden).toBe(true);
  });

  it("says when Liam can't read the converted model: one error, no line", async () => {
    await at("#project/toolshed/library/data");
    const v = frame();
    await v.say({ t: "hello" });
    await v.say({ t: "ready", errors: [{ path: "library/data-model.dbml", line: 0, message: "The viewer couldn't read the converted model: syntax error at or near \"(\"" }], tables: 0 });
    expect(text(".vf-fail p b")).toBe("The viewer couldn't read the converted model.");
    expect(texts(".vf-fail .errs li")).toEqual(['syntax error at or near "("']);
    expect(texts(".vf-fail button")).toEqual(["Try again"]);
  });

  it("says a data model over 512 KB is too large, with its file on GitHub, and draws no frame", async () => {
    const l = libraryOf("toolshed", files) as { index: { files: Array<{ section: string; too_large?: true }> } };
    for (const f of l.index.files) if (f.section === "data") f.too_large = true;
    lib["toolshed"] = l as unknown as Record<string, unknown>;
    await at("#project/toolshed/library/data");
    expect(view().querySelector("iframe")).toBeNull();
    expect(text(".vf-fail b")).toBe("This data model is too large to show here");
    expect(text(".vf-fail p")).toMatch(/^1 file, \d+ KB: a file shows here up to 512 KB\. Its file on GitHub:$/);
    expect(hrefs(".vf-fail .files a")).toEqual([`${GH}/blob/${COMMIT}/library/data-model.dbml`]);
  });

  it("drops the hint about zooming once the frame has been touched, on this device", async () => {
    await at("#project/toolshed/library/data");
    expect(text(".vf-hint")).toBe("Pinch to zoom, tap a table for its columns.");
    const v = frame();
    v.el.focus();
    window.dispatchEvent(new Event("blur"));
    await settle(20);
    expect(view().querySelector<HTMLElement>(".vf-hint")!.hidden).toBe(true);
    await at("#project/toolshed/library/data");
    expect(view().querySelector<HTMLElement>(".vf-hint")!.hidden).toBe(true);
  });
});
