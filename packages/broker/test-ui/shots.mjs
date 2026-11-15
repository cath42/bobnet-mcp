// Screenshots of the roadmap's gates (BOB-7), triage and capture (BOB-8), bugs (BOB-10) at phone, tablet and desktop
// widths, against a fake broker in the page holding a copy of BobNet's board (2026-11-14; its backlog
// 2026-11-15). The page is public/ as served.
//   node test-ui/shots.mjs [prefix]   (from packages/broker; writes test-ui/shots/bob7-*.png, bob8-*.png, bob10-*.png)
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
      f("BOB-10", "R1", "Ready", "Bugs: capture, triage, 'blocks use' to Casper, close on fix", 0, 4),
      f("BOB-9", "R1", "Ready", "Move Helix's board off Backlog.md into the service", 0, 6),
      f("BOB-3", "R1", "Ready", "The roadmap across projects", 0, 9),
      f("BOB-4", "R1", "Ready", "A feature's sessions, outcomes and tasks", 0, 8),
      f("BOB-5", "R1", "Ready", "What waits on Casper, across projects", 0, 6),
      f("BOB-6", "R2", "Draft", "Start a session from the UI, as a request to poe", 0, 0),
      f("BOB-25", null, "Ready", "Device keys and signed dashboard actions (ADR 0003 steps 2 and 3)", 0, 0),
    ],
  };
  board.features.forEach((x, i) => (x.ord = (i + 1) * 1000));
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
  const releaseRecord = (r, i) => {
    const fs = board.features.filter((x) => x.release === r.ref);
    return { goal: null, ord: i + 1, spec_url: null, closed_at: r.status === "closed" ? new Date().toISOString() : null, closed_by: null, ...r,
      features: { done: fs.filter((x) => x.status === "Done").length, total: fs.length }, backlog: { items: 0, bugs: 0, oldest: null } };
  };
  const last = (release) => Math.max(0, ...board.features.filter((x) => x.release === release).map((x) => x.ord)) + 1000;
  let seq = 100;
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects: [{ key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] }] };
      case "list": {
        if (op.of === "releases") return { releases: board.releases.map(releaseRecord), total: board.releases.length, cursor: null };
        const items = op.of === "backlog" ? board.backlog : board.features;
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
  const dashboard = { peers: [], laptops: [{ laptop: "mbp-1", at: iso(0), snapshot: { supervisor: { started_at: iso(600), concurrency: 3, active: 1, queued: 0 }, workers: [worker], pending: [], usage: [] } }], boards: [], updates: [], traffic: [] };

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
  ["bob7-closed-folded", "roadmap/bobnet/edit", [(p) => p.locator("#rel-R2").getByRole("button", { name: "Close release" }).click(), (p) => p.getByRole("button", { name: "Close R2" }).click()], true, '#rel-R2 .badge[data-state="closed"]'],
];

const shots = all.filter(([name]) => name.startsWith(process.argv[2] ?? ""));
const browser = await chromium.launch();
try {
  for (const [name, hash, steps, full, until] of shots) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      await page.addInitScript(fakeBroker);
      await page.goto(`${base}#${hash}`);
      await page.waitForSelector(hash.startsWith("triage") ? ".totals" : "section.release");
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
