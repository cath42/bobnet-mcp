// Screenshots of the roadmap's gates (BOB-7), triage and capture (BOB-8), bugs (BOB-10), the overview and roadmap (BOB-3) at phone, tablet and desktop
// widths, against a fake broker in the page holding a copy of BobNet's board (2026-11-14; its backlog
// 2026-11-15). The page is public/ as served.
//   node test-ui/shots.mjs [prefix]   (from packages/broker; writes test-ui/shots/bob7-*.png, bob8-*.png, bob10-*.png, bob3-*.png)
// Chromium: pnpm --filter @bobnet/broker exec playwright-core install chromium (once per machine).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "../public");
const out = join(here, "shots");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    const body = await readFile(join(pub, path === "/" ? "index.html" : path));
    res.writeHead(200, { "content-type": types[extname(path || ".html")] ?? "text/html" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

/** Runs in the page: a broker that answers the dashboard and the board's operations from memory. */
function fakeBroker() {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
  const f = (ref, release, status, title, checked, total, over = {}) => ({
    ref, kind: "feature", type: "increment", status, title, parent: null, release, ord: null, labels: [], progress: { checked, total },
    tasks: { done: 0, total: 0 }, open_since: null, archived_at: null, ...over,
  });
  const board = {
    releases: [
      { ref: "R1", title: "R1 Central backlog view", status: "open" },
      { ref: "R2", title: "R2 Start a session from the UI", status: "planned" },
    ],
    features: [
      f("BOB-1", "R1", "Done", "Prototype the central backlog view, for Casper to accept before building", 2, 2, { tasks: { done: 1, total: 1 } }),
      f("BOB-2", "R1", "Ready", "The board service: a database with API and MCP tools", 9, 12, { open_since: iso(300) }),
      f("BOB-7", "R1", "Ready", "Who may write what, and Casper's gates from the dashboard", 0, 6, { open_since: iso(40) }),
      f("BOB-14", "R1", "Ready", "Move BobNet's own board into the service (pilot)", 0, 7, { open_since: iso(45) }),
      f("BOB-8", "R1", "Ready", "Capture backlog items in one step, and triage them", 0, 6),
      f("BOB-10", "R1", "Ready", "Bugs: capture, triage, 'blocks use' to Casper, close on fix", 0, 4, { open_since: iso(40) }),
      f("BOB-9", "R1", "Ready", "Move Helix's board off Backlog.md into the service", 0, 6),
      f("BOB-3", "R1", "Ready", "The roadmap across projects", 0, 9),
      f("BOB-4", "R1", "Ready", "A feature's sessions, outcomes and tasks", 0, 8),
      f("BOB-5", "R1", "Ready", "What waits on Casper, across projects", 0, 6),
      f("BOB-6", "R2", "Draft", "Start a session from the UI, as a request to poe", 0, 0),
      f("BOB-25", null, "Ready", "Device keys and signed dashboard actions (ADR 0003 steps 2 and 3)", 0, 0),
    ],
  };
  board.features.forEach((x, i) => (x.ord = (i + 1) * 1000));
  // BOB-3's shots: the board as on 2026-11-15, BOB-3 open, three done before it to fold.
  if (window.BOB3) {
    for (const ref of ["BOB-2", "BOB-7", "BOB-14"]) Object.assign(board.features.find((x) => x.ref === ref), { status: "Done", open_since: null });
    board.features.find((x) => x.ref === "BOB-2").progress = { checked: 10, total: 12 };
    board.features.find((x) => x.ref === "BOB-7").progress = { checked: 6, total: 6 };
    board.features.find((x) => x.ref === "BOB-14").progress = { checked: 4, total: 7 };
    Object.assign(board.features.find((x) => x.ref === "BOB-3"), { open_since: iso(20) });
  }
  // BOB-4's shots: BOB-4 open on its fixes, with a design, a build and a review closed before them. The sessions, runs,
  // tasks and events are made up in BobNet's shape: no board has them yet.
  const bob4 = window.BOB4 && (() => {
    Object.assign(board.features.find((x) => x.ref === "BOB-3"), { status: "Done", progress: { checked: 9, total: 9 } });
    const fx = board.features.find((x) => x.ref === "BOB-4");
    Object.assign(fx, { open_since: iso(400), progress: { checked: 5, total: 9 }, tasks: { done: 3, total: 7 } });
    const tok = (n) => ({ input: Math.round(n * 0.02), output: Math.round(n * 0.03), cache_read: Math.round(n * 0.9), cache_write: Math.round(n * 0.05) });
    const ctx = (n, start, step, seed) => Array.from({ length: n }, (_, i) => Math.round(start + i * step + ((i * 7919 + seed) % 13) * step * 0.6));
    const run = (id, agent, role, a, b, c, over = {}) => ({ id, agent, role, laptop: "mbp-1", model: "opus", effort: "high", started_at: iso(a), ended_at: b === null ? null : iso(b), resumed: false,
      tokens: tok(c.reduce((n, v) => n + v, 0)), calls: c.length, ctx: c, remote_url: null, tasks: [], ...over });
    const close = (over) => ({ need: "none", waits_on: [], blockers: [], majors: [], minors_fixed: 0, sent_back: [], summary: "", handoff_path: null, handoff_text: null, commit: null, closed_by: "Mario@mbp-1", ...over });
    const sum = (runs) => runs.reduce((t, r) => ({ input: t.input + r.tokens.input, output: t.output + r.tokens.output, cache_read: t.cache_read + r.tokens.cache_read, cache_write: t.cache_write + r.tokens.cache_write }), tok(0));
    const ss = (kind, label, a, b, runs, over = {}) => ({ feature: "BOB-4", kind, label, started_at: iso(a), ended_at: b === null ? null : iso(b), imported: false, close: null, tasks_moved: [], tokens: sum(runs), runs, ci_runs: [], ...over });
    const t = (n, status, title, checked, total) => ({ ref: `BOB-4${n}`, kind: "task", type: "task", status, title, parent: "BOB-4", release: "R1", ord: n * 1000, labels: [], progress: { checked, total }, tasks: null, open_since: null, archived_at: null, created_at: iso(900) });
    const tasks = [t(1, "Done", "Sessions as a chain, with the next step", 3, 3), t(2, "Done", "A closed session's outcome from its close", 4, 4), t(3, "Done", "Tasks under each session, and in no session yet", 2, 2),
      t(4, "In Progress", "On it now, and agents on their tasks", 1, 3), t(5, "In Progress", "Context per call inside a session", 0, 2), t(6, "Ready", "The run line for CI and the run slot", 0, 3), t(7, "Draft", "History on the Feature view", 0, 0)];
    const sessions = [
      ss("design", "spec", 1500, 1380, [run("w_d1", "Daisy", "daisy", 1500, 1380, ctx(60, 18000, 900, 3))], { close: close({ summary: "The steps view specced: the chain, outcomes, run lines and context per call.", handoff_path: "~/.local/state/bobnet/handoffs/bobnet/w_d38c1154.md", handoff_text: "# Daisy: BOB-4 spec\n\nThe chain, the outcome line, the run line, context per call, history.", commit: "44bf8f4aa1" }), tasks_moved: [{ task: "BOB-41", status: "Ready" }, { task: "BOB-42", status: "Ready" }, { task: "BOB-43", status: "Ready" }] }),
      ss("build", "A", 900, 560, [run("w_l1", "Luigi", "luigi", 900, 700, ctx(120, 22000, 1100, 5), { remote_url: "https://claude.ai/code/session_1" }), run("w_l2", "Luigi", "luigi", 690, 560, ctx(70, 21000, 1000, 9))],
        { close: close({ minors_fixed: 2, summary: "The chain, outcomes and task lists built and tested; shots taken.", handoff_path: "~/.local/state/bobnet/handoffs/bobnet/w_a53c1f42.md", handoff_text: "# Luigi: BOB-4 build A", commit: "6733f0a6aa" }),
          tasks_moved: [{ task: "BOB-41", status: "Done" }, { task: "BOB-42", status: "Done" }, { task: "BOB-43", status: "Done" }, { task: "BOB-44", status: "In Review" }] }),
      ss("review", "1", 540, 470, [run("w_t1", "Toad", "toad", 540, 470, ctx(45, 25000, 1300, 2))], { close: close({ majors: ["BOB-44"], sent_back: ["BOB-44"], summary: "One major: an agent on two tasks shows once. Sent back to a fixes build." }), tasks_moved: [{ task: "BOB-44", status: "In Progress" }] }),
      ss("build", "Fixes", 60, null, [run("w_9ff16006", "Luigi", "luigi", 50, null, [])], {
        tasks_moved: [{ task: "BOB-44", status: "In Progress" }],
        ci_runs: [{ source: "github-actions", external_id: "4812", name: "test (v2)", url: "https://github.com/cath42/bobnet-mcp/actions", repo: "cath42/bobnet-mcp", branch: "v2", sha: "abc", laptop: null, status: "running", started_at: iso(12), ended_at: null, worker: "w_9ff16006", usual_ms: 9 * 60_000 }],
      }),
    ];
    const ev = (seq, minAgo, op, ref, changes, over = {}) => ({ seq, at: iso(minAgo), actor: { kind: "agent", who: "Peach@mbp-1", role: "po", worker: "w_p", session: null }, op, record: { table: "items", ref }, reason: null, undo_of: null,
      changes: changes.map(([field, old, n]) => ({ field, old, new: n })), ...over });
    const owner = { kind: "owner", who: "owner@example.com", role: null, worker: null, session: null };
    const luigiIn = (label) => ({ kind: "agent", who: "Luigi@mbp-1", role: "luigi", worker: "w_l1", session: { feature: "BOB-4", kind: "build", label } });
    const history = [
      { seq: 1, at: iso(2000), actor: { kind: "board", who: "import@mbp-1", role: null, worker: null, session: null }, op: "import", record: { table: "projects", ref: "bobnet" }, reason: "imported from Backlog.md at bobnet 0c1d2e3 (bobnet-board v1, exported 2026-11-15)", undo_of: null, changes: [] },
      ev(20, 1600, "update", "BOB-4", [["status", "Draft", "Ready"]], { reason: "Spec landed at 44bf8f4; ready for build" }),
      ev(21, 1370, "create", "BOB-41", []), ev(22, 1370, "create", "BOB-42", []),
      ev(30, 880, "update", "BOB-41", [["status", "Ready", "In Progress"]], { actor: luigiIn("A") }),
      ev(31, 600, "criteria", "BOB-4", [["ac #1 state", "open", "checked"], ["ac #1 evidence", null, "test-ui/dashboard.test.ts 'opens on #feature/<project>/<id>, its sessions in the order they ran'; shots bob4-feature-390, bob4-feature-1440"]], { actor: luigiIn("A") }),
      ev(32, 590, "update", "BOB-41", [["status", "In Progress", "Done"]], { actor: luigiIn("A") }),
      ev(40, 300, "set_release", "BOB-4", [["release", "R1", "R2"]], { actor: owner }),
      ev(41, 299, "undo", "BOB-4", [["release", "R2", "R1"]], { actor: owner, undo_of: 40 }),
      ev(50, 30, "update", "BOB-4", [["description", "Capability 3.", "Capability 3, product/requirements/steps-view.md, as the approved prototype shows it."]]),
    ];
    return { fx, tasks, sessions, history };
  })();

  // BobNet's backlog as imported (BOB-14), all chores in no release; their ages are made up, a few hours to a few days.
  const b = (ref, title, hoursAgo, over = {}) => ({
    ref, kind: "backlog", type: "chore", status: "Ready", title, parent: null, release: null, ord: null, labels: [], progress: { checked: 0, total: 0 }, tasks: null,
    open_since: null, archived_at: null, created_at: iso(hoursAgo * 60), captured_by: "Peach@mbp-1", casper_words: null, bug_where: null, blocks_use: false, parent_hint: null, ...over,
  });
  board.backlog = [
    b("BOB-11", "Land refuses a stale tip before the check", 80, { parent_hint: "BOB-2" }), b("BOB-12", "Owner JWT: pin the laptop reporter, correct the README claim", 80),
    b("BOB-13", "Supervisor stores an inbound message before acking it", 80), b("BOB-15", "Guard Keychain reads and correct the worker-isolation claim", 60),
    b("BOB-16", "Protocol: client version on register, and an unsupported error code", 60), b("BOB-22", "Tests: silence board.test noise, one client-to-broker end-to-end test, Playwright decision", 30),
    b("BOB-21", "Tokens only: cost_usd optional, then remove the brief fallbacks", 30), b("BOB-17", "Broker: boards after the dashboard reply; sweep old reports", 30),
    b("BOB-24", "Replace Helix's ADR citations and Helix-specific strings in code", 20), b("BOB-18", "Split the Supervisor class, one step at a time", 20),
    b("BOB-19", "Type-check the dashboard's app.js", 20), b("BOB-20", "Message store: numbered migrations and a daily retention sweep", 6),
    b("BOB-23", "Broker: internal error with the rid, audit tail read, stale-report banner", 6),
  ];
  let next = 26;
  // BOB-3's acceptance (AC 1, 3, 8): a second project in the service, Helix's real board as Daisy's sample has it
  // (design/BOB-1/sample/helix.js, 282cca2fe: 29 features, 3 releases, 103 drafts; LAND-22 Done at 3 of 138).
  const hx = window.TWO && window.SAMPLES?.helix;
  const helix = hx && {
    releases: hx.releases.map((r, i) => ({ ref: `R${i + 1}`, title: r.title.replace(/^"|"$/g, ""), status: ["closed", "open", "planned"][i] ?? "planned" })),
    features: [
      ...hx.releases.flatMap((r, i) => r.features.map((x) => f(x.id, `R${i + 1}`, x.status, x.title, x.ac[0], x.ac[1], { ord: Number(x.ordinal), tasks: { done: x.tasksDone, total: x.tasks }, open_since: x.id === hx.feature ? iso(90) : null }))),
      ...hx.noRelease.map((x) => f(x.id, null, x.status, x.title, 0, 0, { ord: null })),
    ],
    backlog: hx.drafts.map((d) => ({ ref: d.id, kind: "backlog", type: d.type === "bug" ? "bug" : "chore", status: "Draft", title: d.title, parent: null, release: null, ord: null, labels: [], progress: { checked: 0, total: 0 },
      tasks: null, open_since: null, archived_at: null, created_at: iso(d.age * 24 * 60), captured_by: "Picard@mbp-1", casper_words: null, bug_where: null, blocks_use: false, parent_hint: null })),
  };
  const boardOf = (key) => (key === "helix" && helix ? helix : board);
  const releaseRecord = (r, i, bd = board) => {
    const fs = bd.features.filter((x) => x.release === r.ref);
    return { goal: null, ord: i + 1, spec_url: null, closed_at: r.status === "closed" ? new Date().toISOString() : null, closed_by: null, ...r,
      features: { done: fs.filter((x) => x.status === "Done").length, total: fs.length }, backlog: counts((d) => d.release === r.ref, bd) };
  };
  const counts = (pick, bd = board) => {
    const its = bd.backlog.filter(pick);
    return { items: its.length, bugs: its.filter((d) => d.type === "bug").length, oldest: its.map((d) => d.created_at).sort()[0] ?? null };
  };
  const project = { key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] };
  const projects = helix ? [project, { key: "helix", name: "Helix", prefix: "LAND", draft_prefix: "DRAFT", lead: "Picard@mbp-1", po: "Picard@mbp-1", repos: [] }] : [project];
  // Example waits for the overview's shots: no record of them exists to sample (as Daisy's prototype marks them).
  const waits = [
    { project: "bobnet", kind: "question", ref: "Q-3", feature: "BOB-9", text: "Import Helix's board at its current main, or at the last release tag?", recommended: null,
      holds: { items: ["BOB-9"], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Peach@mbp-1", since: iso(180), blocking: true },
    { project: "bobnet", kind: "action", ref: "A-1", feature: null, text: "Add the CI token to the broker's secrets", recommended: null,
      holds: { items: [], sessions: [] }, waiting_sessions: [], needed_before: { release: "R2" }, asked_by: "Mario@mbp-1", since: iso(600), blocking: false },
  ];
  const overviewRow = (p = project) => {
    const bd = boardOf(p.key);
    const open = bd.releases.findIndex((r) => r.status === "open");
    const live = bd.features.filter((x) => x.open_since && x.status !== "Done");
    return {
      project: p, release: open < 0 ? null : releaseRecord(bd.releases[open], open, bd), release_number: open < 0 ? null : open + 1,
      open: live, next_ready: bd.features.find((x) => x.status === "Ready" && !x.open_since) ?? null,
      waits_on_you: p === project ? (waits.find((w) => w.blocking)?.ref ?? null) : null, backlog: counts(() => true, bd), no_release: counts((d) => d.release === null, bd),
    };
  };
  const last = (release) => Math.max(0, ...board.features.filter((x) => x.release === release).map((x) => x.ord)) + 1000;
  let seq = 100;
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "overview": return { projects: projects.filter((p) => !op.project || p.key === op.project).map(overviewRow) };
      case "waits": return { waits, answered: [] };
      case "get":
        if (!bob4) return { item: { ...boardOf(op.project).features.find((x) => x.ref === op.ref), sessions: [] }, history: [] };
        if (op.session) return { session: bob4.sessions.find((x) => x.kind === op.session.kind && x.label === op.session.label) };
        return { item: { ...bob4.fx, sessions: bob4.sessions.map(({ feature, kind, label, started_at, ended_at }) => ({ feature, kind, label, started_at, ended_at })) }, history: bob4.history };
      case "list": {
        const bd = boardOf(op.project);
        if (op.of === "releases") return { releases: bd.releases.map((r, i) => releaseRecord(r, i, bd)), total: bd.releases.length, cursor: null };
        if (op.of === "tasks") return { items: bob4?.tasks ?? [], total: bob4?.tasks.length ?? 0, cursor: null };
        const items = op.of === "backlog" ? bd.backlog : bd.features;
        return { items, total: items.length, cursor: null };
      }
      case "update": { const x = board.backlog.find((y) => y.ref === op.ref); Object.assign(x, op.set); return { ref: op.ref, seq: ++seq }; }
      case "capture": {
        const ref = `BOB-${next++}`;
        board.backlog.push(b(ref, op.title, 0, { type: op.type, casper_words: op.casper_words, captured_by: "owner@example.com", bug_where: op.bug_where ?? null, blocks_use: !!op.blocks_use }));
        return { ref, seq: ++seq, duplicate: false, dropped: [] };
      }
      case "set_release": { const x = board.features.find((y) => y.ref === op.ref); x.release = op.release; x.ord = last(op.release); return { ref: op.ref, seq: ++seq }; }
      case "order_releases": board.releases.sort((a, b) => op.refs.indexOf(a.ref) - op.refs.indexOf(b.ref)); return { ref: null, seq: ++seq };
      case "close_release":
        for (const m of op.moves) { const x = board.features.find((y) => y.ref === m.feature); x.release = m.to; x.ord = last(m.to); }
        board.releases.find((r) => r.ref === op.ref).status = "closed";
        return { ref: op.ref, seq: ++seq };
      default: return { ref: null, seq: ++seq, told: [] };
    }
  };
  const worker = { id: "w_9ff16006", name: "Luigi", project: "bobnet", role: "engineer", state: "running", task: "BOB-7", model: "opus", effort: "high", checkpoint: null,
    started_at: iso(40), ended_at: null, last_event_at: iso(0), tokens: 2_000_000, session: "BOB-7 build A", task_ref: null, calls: 80, context: 90000, ctx: [] };
  const others = window.BOB3 ? [
    { ...worker, id: "w_441c4622", session: "BOB-3 build A", task: "BOB-3", tokens: 3_100_000, started_at: iso(20) },
    { ...worker, id: "w_9453f36a", name: "Toad", role: "architect", session: "BOB-10 review 1", task: "BOB-10", tokens: 900_000, state: "waiting-approval" },
    { ...worker, id: "w_m", name: "Mario", role: "lead", session: null, task: "lead", tokens: 5_600_000 },
  ] : [worker];
  if (window.BOB4) {
    others.splice(0, others.length,
      { ...worker, id: "w_9ff16006", session: "BOB-4 build Fixes", task: "BOB-4", task_refs: ["BOB-44", "BOB-45"], tokens: { input: 40_000, output: 90_000, cache_read: 2_700_000, cache_write: 160_000 }, started_at: iso(50),
        remote_url: "https://claude.ai/code/session_2", ctx: Array.from({ length: 64 }, (_, i) => 21000 + i * 1200), calls: 64, context: 97000, checkpoint: "BOB-44: one line per agent and session; waiting on CI" },
      { ...worker, id: "w_9453f36a", name: "Toad", role: "architect", session: null, task: "consult", tokens: 600_000, last_event_at: iso(23) },
      { ...worker, id: "w_da", name: "Daisy", role: "designer", session: null, task: "spec", tokens: 400_000, state: "waiting-approval" },
      { ...worker, id: "w_m", name: "Mario", role: "lead", session: null, task: "lead", tokens: 5_600_000 },
      { ...worker, id: "w_pe", name: "Peach", role: "po", session: null, task: "accept", state: "queued", tokens: 0 });
  }
  const pending = window.BOB4 ? [{ id: "r_2", worker_id: "w_da", name: "Daisy", kind: "approval", tool: "Bash", tier: "lead", created_at: iso(2), preview: "git push origin HEAD" }] : window.BOB3 ? [{ id: "r_1", worker_id: "w_9453f36a", name: "Toad", kind: "approval", tool: "Bash", tier: "human", created_at: iso(2), preview: "git log --oneline v2..origin/v2" }] : [];
  const dashboard = { peers: [], laptops: [{ laptop: "mbp-1", at: iso(0), snapshot: { supervisor: { started_at: iso(600), concurrency: 3, active: 1, queued: 0 }, workers: others, pending, usage: [] } }], boards: [], updates: [], traffic: [] };

  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      setTimeout(() => this.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } }));
    }
    frame(f) { this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(f) })); }
    send(data) {
      const f = JSON.parse(data);
      if (f.t === "dashboard") setTimeout(() => this.frame({ t: "ok", rid: f.rid, result: dashboard }));
      if (f.t === "board_op") setTimeout(() => this.frame({ t: "ok", rid: f.rid, result: answer(f.op) }), 30);
    }
    close() {}
  }
  window.WebSocket = FakeSocket;
}

const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };
const words = "The roadmap jumps to the top on my phone when I move a feature. Happens every time, on the train too.";
const capture = [(p) => p.click("#capture-open"), (p) => p.fill("#cap-text", words), (p) => p.getByRole("button", { name: "Bug", exact: true }).click(),
  (p) => p.getByRole("button", { name: "production" }).click(), (p) => p.check("#cap-blocks")];
// [file, hash, steps, full page?, what to wait for after the steps]
const all = [
  ["bob7-roadmap", "roadmap/bobnet", [], true],
  ["bob7-gates-edit", "roadmap/bobnet/edit", [], true],
  ["bob7-gates-moved", "roadmap/bobnet/edit", [(p) => p.selectOption('select[aria-label="Release of BOB-25"]', "R2")], false],
  ["bob7-close-release", "roadmap/bobnet/edit", [(p) => p.locator("#rel-R2").getByRole("button", { name: "Close release" }).click()], false],
  ["bob8-triage", "triage/bobnet", [], true],
  ["bob8-triage-edit", "triage/bobnet/edit", [], true],
  ["bob8-gates-backlog-item", "triage/bobnet/edit", [(p) => p.selectOption('select[aria-label="Release of BOB-11"]', "R2")], false],
  ["bob8-capture", "triage/bobnet", capture, false],
  ["bob8-triage-after-capture", "triage/bobnet", [...capture, (p) => p.getByRole("button", { name: "Capture", exact: true }).click()], false, "table.triage .now"],
  // BOB-10: a bug captured in one field (#1), then first in the triage list, marked (#2).
  ["bob10-capture-bug", "triage/bobnet", capture, false],
  ["bob10-triage-bugs", "triage/bobnet", [...capture, (p) => p.getByRole("button", { name: "Capture", exact: true }).click(), (p) => p.getByRole("button", { name: /^Bugs / }).click()], true, "table.triage .now"],
  // BOB-3: the overview (#7), the roadmap with its counts lines and links (#1-6), unfolded, a feature's head card.
  ["bob3-overview", "overview", [], true],
  ["bob3-roadmap", "roadmap/bobnet", [], true],
  ["bob3-roadmap-unfolded", "roadmap/bobnet", [(p) => p.getByRole("button", { name: /done \(/ }).click()], true],
  ["bob3-feature", "feature/BOB-3", [], false],
  // BOB-3's acceptance (Peach, w_a2341d79): two service projects (AC 1), LAND-22 Done at 3 of 138 (AC 3), Helix-sized on a phone (AC 8).
  ["bob3acc-overview-two-projects", "overview", [], true],
  ["bob3acc-roadmap-two-projects", "roadmap/bobnet", [], false],
  ["bob3acc-roadmap-helix", "roadmap/helix", [(p) => p.locator("#rel-R2").getByRole("button", { name: /done \(/ }).click()], true],
  ["bob3acc-feature-done-unticked", "feature/LAND-22", [], false],
  // BOB-4: the steps view (#1-4, 6-9), context per call in a session (#5), history (BOB-14 #5), capture's found in, an agent's detail row.
  ["bob4-feature", "feature/bobnet/BOB-4", [], true],
  ["bob4-feature-ctx", "feature/bobnet/BOB-4", [(p) => p.locator("#step-build-A").getByRole("button", { name: /^Context per call/ }).click(), (p) => p.locator("#step-build-A .ctxp .seg button", { hasText: "Luigi" }).click(), (p) => p.locator("#step-build-A").scrollIntoViewIfNeeded()], false],
  ["bob4-feature-history", "feature/bobnet/BOB-4", [(p) => p.getByRole("button", { name: /^History/ }).click(), (p) => p.getByRole("button", { name: /^With its tasks/ }).click(), (p) => p.locator(".hist").scrollIntoViewIfNeeded()], false],
  ["bob4-capture-found-in", "feature/bobnet/BOB-4", [(p) => p.click("#capture-open")], false],
  ["bob4-overview-agent", "overview", [(p) => p.locator("#working .a-line", { hasText: "Luigi" }).locator(".a-btn").click()], false],
  ["bob4-overview-lead-permission", "overview", [(p) => p.locator("#working .a-line", { hasText: "Daisy" }).locator(".a-btn").click()], false],
  ["bob7-closed-folded", "roadmap/bobnet/edit", [(p) => p.locator("#rel-R2").getByRole("button", { name: "Close release" }).click(), (p) => p.getByRole("button", { name: "Close R2" }).click()], true, '#rel-R2 .badge[data-state="closed"]'],
];

const shots = all.filter(([name]) => name.startsWith(process.argv[2] ?? ""));
const browser = await chromium.launch();
try {
  for (const [name, hash, steps, full, until] of shots) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      if (name.startsWith("bob3")) await page.addInitScript(() => (window.BOB3 = true));
      if (name.startsWith("bob4")) await page.addInitScript(() => (window.BOB4 = true));
      if (name.startsWith("bob3acc")) {
        await page.addInitScript(() => (window.TWO = true));
        await page.addInitScript({ path: join(here, "../../../design/BOB-1/sample/helix.js") });
      }
      await page.addInitScript(fakeBroker);
      await page.goto(`${base}#${hash}`);
      await page.waitForSelector(hash.startsWith("triage") ? ".totals" : hash.startsWith("overview") ? ".prow" : hash.startsWith("feature") ? "#feature-head" : "section.release");
      for (const step of steps) {
        await step(page);
        await page.waitForTimeout(400);
      }
      if (until) await page.waitForSelector(until);
      // A full page reads top to bottom: the header not stuck mid-page, the toast left out (Daisy, BOB-7 3).
      if (full) {
        await page.addStyleTag({ content: "header { position: static !important; } #toast { display: none !important; }" });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await page.screenshot({ path: join(out, `${name}-${w}.png`), fullPage: full });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
