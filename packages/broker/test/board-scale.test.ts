import { BoardExportV1, type BoardCaller, type BoardOpInput, type BoardReply, type BoardResults, type ExportItem } from "@bobnet/protocol";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

// A Helix-sized board (BOB-2 #10, board-service 10): 3 releases, 29 features, 698 tasks, 103 backlog
// items, as Helix's board was at BOB-1's sample. Lists carry counts, an opened feature loads its tasks,
// and each read stays well inside a dashboard's render.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const board = () => env.BOARD.getByName("board");
const at = (day: number) => new Date(Date.UTC(2026, 8, 1 + day)).toISOString();

async function ok<K extends keyof BoardResults>(op: BoardOpInput & { op: K }): Promise<BoardResults[K]> {
  const reply = (await board().apply(owner, op)) as unknown as BoardReply;
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result as BoardResults[K];
}

/** Each read's slowest of three, in ms, wall clock in the test's worker: the board's DO and its SQLite included. */
async function timed<T>(read: () => Promise<T>): Promise<{ ms: number; result: T }> {
  let ms = 0;
  let result!: T;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    result = await read();
    ms = Math.max(ms, performance.now() - t);
  }
  return { ms, result };
}

async function listAll(op: BoardOpInput & { op: "list" }): Promise<{ items: number; pages: number }> {
  let cursor: string | null = null;
  let items = 0, pages = 0;
  do {
    const r: BoardResults["list"] = await ok({ ...op, ...(cursor ? { cursor } : {}) });
    items += r.items!.length;
    pages++;
    cursor = r.cursor;
  } while (cursor);
  return { items, pages };
}

function helixSized(): BoardExportV1 {
  const items: ExportItem[] = [];
  let n = 0;
  const item = (i: Partial<ExportItem>): ExportItem => ({
    ref: `LAND-${++n}`, aliases: [], kind: "task", type: "task", status: "Draft", title: `Item ${n}`, description: "A sentence or two of description, as Helix's tasks have.",
    notes: null, plan: null, parent: null, release: null, ord: null, open_since: null, archived_at: null, archive_reason: null,
    captured_by: null, captured_session: null, casper_words: null, capture_id: null, parent_hint: null, bug_where: null, blocks_use: false,
    found_in: null, labels: [], deps: [], criteria: [], created_at: at(n % 60), updated_at: at(n % 60), ...i,
  });
  const criteria = (k: number, checked: number) =>
    Array.from({ length: k }, (_, j) => ({ section: "ac" as const, n: j + 1, text: `Criterion ${j + 1}`, evidence: null, state: j < checked ? ("checked" as const) : ("open" as const), checked_by: j < checked ? "Picard@mbp-1" : null, checked_at: j < checked ? at(1) : null, casper_gate: false }));
  // 29 features over 3 releases; 698 tasks spread unevenly, as Helix's are (LAND-49 has 20, a few have 60).
  const sizes: number[] = Array.from({ length: 29 }, (_, f) => (f < 3 ? 60 : f < 10 ? 30 : 17));
  sizes[28] = sizes[28]! + 698 - sizes.reduce((a, b) => a + b, 0);
  sizes.forEach((size, f) => {
    const feature = item({ kind: "feature", type: "increment", status: f < 20 ? "Done" : "Ready", release: `R${1 + (f % 3)}`, ord: f * 1000, criteria: criteria(4, 2), labels: ["svc:land"] });
    items.push(feature);
    for (let t = 0; t < size; t++) items.push(item({ parent: feature.ref, status: f < 20 ? "Done" : "Draft", ord: t, criteria: criteria(3, f < 20 ? 3 : 1), labels: t % 5 ? [] : ["phone"] }));
  });
  for (let d = 0; d < 103; d++) items.push(item({ kind: "backlog", type: d % 9 ? "task" : "bug", release: d % 4 ? null : "R2", ord: d, casper_words: d % 7 ? null : "his words" }));
  return {
    format: "bobnet-board", version: 1, exported_at: at(0), source: "a Helix-sized board", last_event_seq: 0, grants: [], events: [],
    projects: [{
      key: "helix", name: "Helix", prefix: "LAND", draft_prefix: null, lead: null, po: null, repos: [],
      next: { item: n + 1, release: 4, question: 1, action: 1 }, created_at: at(0),
      releases: [1, 2, 3].map((r) => ({ ref: `R${r}`, title: `Release ${r}`, goal: null, status: r === 1 ? "open" : "planned", ord: r, spec_url: null, closed_at: null, closed_by: null })),
      items, sessions: [], questions: [], runs: [], pushes: [], ci_runs: [], grants: [], events: [],
    } as unknown as BoardExportV1["projects"][number]],
  };
}

it("reads a Helix-sized board fast: lists carry counts, a feature loads its tasks (BOB-2 #10)", async () => {
  const imported = await board().importBoard({ kind: "laptop", laptop: "mbp-1" }, BoardExportV1.parse(helixSized()));
  expect(imported, JSON.stringify(imported)).toMatchObject({ ok: true });

  const reads: Record<string, () => Promise<unknown>> = {
    "list releases": () => ok({ op: "list", project: "helix", of: "releases" }),
    "list features (all 29)": () => ok({ op: "list", project: "helix", of: "features" }),
    "list a release's features": () => ok({ op: "list", project: "helix", of: "features", release: "R1" }),
    "a feature's tasks (60)": () => ok({ op: "list", project: "helix", of: "tasks", feature: "LAND-1" }),
    "get a feature in full": () => ok({ op: "get", project: "helix", ref: "LAND-1" }),
    "the whole backlog (103, 2 pages)": () => listAll({ op: "list", project: "helix", of: "backlog" }),
    "search tasks by text": () => ok({ op: "list", project: "helix", of: "tasks", feature: "LAND-1", text: "Item 1" }),
    overview: () => ok({ op: "overview", project: "helix" }),
    waits: () => ok({ op: "waits", project: "helix" }),
  };
  const ms: Record<string, number> = {};
  for (const [name, read] of Object.entries(reads)) ms[name] = Math.round((await timed(read)).ms * 10) / 10;
  console.log("Helix-sized board, slowest of 3 per read (ms):", JSON.stringify(ms));

  // Lists carry counts, never the tasks themselves (board-service 10).
  const features = (await ok({ op: "list", project: "helix", of: "features" })).items!;
  expect(features).toHaveLength(29);
  expect(features[0]).toMatchObject({ ref: "LAND-1", tasks: { done: 60, total: 60 }, progress: { checked: 2 + 180, total: 4 + 180 } });
  expect(features[0]).not.toHaveProperty("criteria");
  expect(features.reduce((a, f) => a + f.tasks!.total, 0)).toBe(698);
  expect((await ok({ op: "list", project: "helix", of: "releases" })).releases!.map((r) => r.backlog)).toEqual([
    { items: 0, bugs: 0, oldest: null },
    { items: 26, bugs: 3, oldest: expect.any(String) },
    { items: 0, bugs: 0, oldest: null },
  ]);
  expect(await listAll({ op: "list", project: "helix", of: "backlog" })).toEqual({ items: 103, pages: 2 });
  // Generous for a CI machine; on mbp-1 each read takes a few ms (the handoff says what was measured).
  for (const [name, t] of Object.entries(ms)) expect(t, name).toBeLessThan(250);
});

/** A month of work on the Helix-sized board (ADR 0005 §2): 300 sessions, 1,500 runs, 3,000 CI runs, 20,000 events. */
function aMonth(doc: BoardExportV1, key = "helix", prefix = "LAND"): BoardExportV1 {
  const p = doc.projects.find((x) => x.key === key)!;
  const now = Date.now();
  const back = (min: number) => new Date(now - min * 60_000).toISOString();
  const month = 30 * 24 * 60;
  const features = p.items.filter((i) => i.kind === "feature").map((i) => i.ref);
  const tasks = p.items.filter((i) => i.kind === "task").map((i) => i.ref);
  const kinds = ["design", "build", "review", "retro"] as const;
  p.sessions = Array.from({ length: 300 }, (_, n) => {
    const end = month - n * 140;
    return {
      feature: features[n % features.length]!, kind: kinds[n % 4]!, label: String(n), started_at: back(end + 120), ended_at: n % 50 === 49 ? null : back(end),
      imported: false, need: n % 50 === 49 ? null : ("none" as const), minors_fixed: n % 50 === 49 ? null : 0, summary: n % 50 === 49 ? null : "A summary of up to three hundred characters, as a close has.".repeat(4),
      handoff_path: null, handoff_text: null, commit_sha: null, closed_by: n % 50 === 49 ? null : "Riker@mbp-1", tasks: [], waits_on: [],
    };
  });
  const ref = (s: (typeof p.sessions)[number]) => ({ feature: s.feature, kind: s.kind, label: s.label });
  p.runs = Array.from({ length: 1500 }, (_, n) => {
    const s = p.sessions[n % 300]!;
    const end = month - (n % 300) * 140 - Math.floor(n / 300) * 5;
    return {
      id: `w_${n}`, session: ref(s), agent: ["Bill", "Ann", "Toad", "Daisy"][n % 4]!, role: "builder", laptop: "mbp-1", model: null, effort: null,
      started_at: back(end + 30), ended_at: back(end), resumed: false, input: 1000, output: 2000, cache_read: 50_000, cache_write: 3000, calls: 40, ctx: null, remote_url: null,
      tasks: [], outcome: (["done", "done", "done", "failed", "lost"] as const)[n % 5], outcome_reason: n % 5 === 3 ? "Bash exited 1" : null,
    };
  });
  p.ci_runs = Array.from({ length: 3000 }, (_, n) => ({
    source: n % 3 ? "github-actions" : "slot", external_id: `${key}-${n}`, name: n % 3 ? ["test", "lint", "build"][n % 3]! : "land", url: null, repo: null,
    branch: "main", sha: null, laptop: n % 3 ? null : "mbp-1", status: n % 7 === 0 ? ("failed" as const) : ("passed" as const), started_at: back(month - n * 14 + 5), ended_at: back(month - n * 14),
    worker: null, session: null, tasks: [],
  }));
  p.events = Array.from({ length: 20_000 }, (_, n) => ({
    seq: n + 1, at: back(month - n * 2), actor: { kind: "agent" as const, who: "Riker@mbp-1", role: null, worker: null, session: null }, op: "update", table: "items" as const,
    record: tasks[n % tasks.length]!, ref: tasks[n % tasks.length]!, reason: null, undo_of: null, changes: [{ field: "status", old: "In Progress", new: n % 2 ? "Done" : "In Progress" }],
  }));
  p.key = key;
  p.prefix = prefix;
  return doc;
}

it("answers the status read across a Helix-sized board with a month of work, and a second project, in one call (BOB-37 AC 4)", async () => {
  const helix = aMonth(helixSized());
  const second = aMonth(helixSized());
  const other = second.projects[0]!;
  // The second project is a renamed copy: its own key, prefix and refs.
  const json = JSON.stringify(other).replaceAll("LAND-", "BOB-").replaceAll("helix-", "bobnet-").replaceAll('"w_', '"b_');
  const parsed = JSON.parse(json) as typeof other;
  const bobnet = { ...parsed, key: "bobnet", name: "BobNet", prefix: "BOB", events: parsed.events.map((e) => ({ ...e, seq: e.seq + 20_000 })) };
  const imported = await board().importBoard({ kind: "laptop", laptop: "mbp-1" }, BoardExportV1.parse({ ...helix, projects: [helix.projects[0], bobnet] }));
  expect(imported, JSON.stringify(imported)).toMatchObject({ ok: true });

  const week = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { ms, result } = await timed(() => ok({ op: "status", since: week }));
  console.log("Status read, Helix-sized board with a month of work and a second project, a week's span, slowest of 3 (ms):", Math.round(ms * 10) / 10);
  expect(result.projects.map((p) => p.project)).toEqual(["bobnet", "helix"]);
  const h = result.projects[1]!;
  expect(h.done.counts.sessions).toBeGreaterThan(60);
  expect(h.usage.lost).toBeGreaterThan(0);
  // Each failure passed again later: settled, not stuck.
  expect(h.stuck.settled.some((x) => x.kind === "ci")).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThan(1024 * 1024);
  // Well under 250 ms on a quiet laptop (the log line above); the land runs it beside every other suite, so room (BOB-117's rule).
  expect(ms).toBeLessThan(1000);
  // Importing 40,000 events is the slow part, not the read.
}, 60_000);
