// BOB-121 review B: the dashboard before (07cdc3b) and after (0a7df68) BOB-172 and BOB-193, same data, clock frozen.
//   node design/BOB-121/shots-review-B/shots.mjs <public dir> <out dir> [scene,scene] [width,width]
// Prints what each shot says: the header's picker, the project rows and cards, any banner, any page error, overflow.
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
const { chromium } = createRequire(new URL("../../../packages/broker/package.json", import.meta.url))("playwright-core");

const [pub, out, only, ws] = process.argv.slice(2);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    const body = await readFile(join(pub, path === "/" ? "index.html" : path));
    res.writeHead(200, { "content-type": types[extname(path || ".html")] ?? "text/html" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

function fakeBroker(scene) {
  const now = Date.now(), iso = (m) => new Date(now - m * 60_000).toISOString();
  const tokens = (n) => ({ input: n, output: 100, cache_read: n * 9, cache_write: 0 });
  const proj = (key, name, prefix, lead, po) => ({ key, name, prefix, draft_prefix: null, lead, po, repos: [] });
  const projects = [proj("bobnet", "BobNet", "BOB", "Mario@mbp-1", "Peach@mbp-1"), proj("helix", "Helix", "LAND", "Bob@mbp-1", "Picard@mbp-1"), proj("athletic", "athletic", "ATH", "Coach@mbp-1", "Scout@mbp-1")];
  const counts = (items, bugs) => ({ items, bugs, oldest: items ? iso(60 * 24 * 4) : null });
  const f = (ref, release, status, title, checked, total, over = {}) => ({ ref, kind: "feature", type: "increment", status, title, parent: null, release, ord: 1000, labels: [], progress: { checked, total }, tasks: { done: 0, total: 0 }, open_since: null, archived_at: null, ...over });
  const rel = (ref, title, status, done, total) => ({ ref, title, goal: null, status, ord: 1000, spec_url: null, closed_at: null, closed_by: null, features: { done, total }, backlog: counts(0, 0) });
  const rels = { bobnet: [rel("R3", "R3 A project's page", "open", 1, 3)], helix: [rel("R2", "R2 Steps you can trust", "open", 5, 11)], athletic: [] };
  const feats = {
    bobnet: [f("BOB-121", "R3", "In Progress", "The dashboard's new pages", 4, 13, { open_since: iso(90) }), f("BOB-189", "R3", "Done", "Releases a PO can write", 5, 5), f("BOB-190", "R3", "Draft", "Needs you, one list", 0, 0)],
    helix: [f("LAND-49", "R2", "In Progress", "An account with two companies", 2, 6, { open_since: iso(300) })],
    athletic: Array.from({ length: 22 }, (_, i) => f(`ATH-${i + 1}`, null, i < 9 ? "Done" : i < 14 ? "Ready" : "Draft", `Athletic feature ${i + 1}`, i < 9 ? 3 : 0, 3)),
  };
  const row = (p) => ({ project: p, release: rels[p.key][0] ?? null, release_number: rels[p.key].length ? 1 : null, open: feats[p.key].filter((x) => x.open_since), next_ready: feats[p.key].find((x) => x.status === "Ready") ?? null, waits_on_you: p.key === "helix" ? "Q-5" : null,
    backlog: p.key === "athletic" ? counts(0, 0) : counts(12, 3), no_release: counts(p.key === "athletic" ? 4 : 0, 0), ci: [] });
  const status = (p) => ({ project: p.key, name: p.name, waits: [], stuck: { runs: [], ci: [], idle_sessions: [], idle_features: [], answered_holding: [], settled: [] }, recurring: null,
    done: { counts: { features: 1, sessions: 2, lands: 3, releases: 0 }, features: [], sessions: [], releases: [] },
    backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false }, usage: { tokens: tokens(800000), by_agent: [], heavy: [], lost: 0 }, more: {} });
  const waits = [{ project: "helix", kind: "question", ref: "Q-5", feature: "LAND-49", text: "How does staging get an account with two companies?", context: null, recommended: null, holds: { items: ["LAND-49"], sessions: [] }, waiting_sessions: [], blocking: true, since: iso(200), asked_by: "Bob@mbp-1", edits: [], options: [] }];
  const dead = scene === "down", listDown = scene === "listdown";
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "overview": return { projects: projects.filter((p) => !op.project || p.key === op.project).map(row) };
      case "list": return op.of === "releases" ? { releases: rels[op.project], total: rels[op.project].length, cursor: null } : { items: op.of === "features" ? feats[op.project] : [], total: op.of === "features" ? feats[op.project].length : 0, cursor: null };
      case "waits": return { waits, answered: [] };
      case "status": return { at: iso(0), since: iso(60 * 24), projects: projects.map(status) };
      case "grants": return { grants: [] };
      default: return { ref: null, seq: 1 };
    }
  };
  const worker = (over) => ({ id: "w_1", name: "Luigi", project: "bobnet", role: "engineer", state: "running", task: "BOB-121 build B", model: "opus", effort: "high", checkpoint: null, started_at: iso(40), ended_at: null, last_event_at: iso(0), tokens: tokens(240_000), session: "BOB-121 build B", task_ref: null, calls: 60, context: 90000, ctx: [20000, 60000, 90000], ...over });
  const item = (id, st, over = {}) => ({ id, title: `${id} title`, status: st, type: "task", parent: id.includes(".") ? id.split(".")[0] : null, milestone: "m-1", assignee: [], labels: [], deps: [], desc: null, ac: [], ...over });
  const board = (project, pre, at, ci) => ({ laptop: "mbp-1", at: iso(at), board: { project, ref: "1b8c34f4aa00",
    backlog: { milestones: [{ id: "m-1", title: `${project} first` }], items: [item(`${pre}-1`, "Ready", { type: "increment", title: `${project} increment` }), item(`${pre}-1.1`, "Ready")], done_counts: {}, drafts: [] },
    sessions: [{ name: `${pre}-1 build 1`, kind: "build", started_at: iso(at + 60), ended_at: iso(at), workers: 2, calls: 90, tokens: tokens(4_000_000) }],
    runs: [{ id: `w_${project}`, name: `${project}-agent`, role: "engineer", session: `${pre}-1 build 1`, task_ref: null, model: "opus", effort: "high", started_at: iso(at + 60), ended_at: iso(at), resumed: false, tokens: 9_000_000, ctx: [30000, 50000, 90000] }],
    baseline: { runs: 9, p25: [25000, 30000], p50: [30000, 40000], p75: [35000, 55000] }, commits: [], ci } });
  // The service's: BobNet's and Helix's boards; athletic's none. Retired: the two, the most recent work of all, their CI failed.
  const own = [board("bobnet", "BOB", 200, [{ name: "test", status: "in_progress", conclusion: null, created_at: iso(4), sha: "1a2b3c4d5e6f" }]), board("helix", "LAND", 300, [])];
  const bad = (n) => [{ name: n, status: "completed", conclusion: "failure", created_at: iso(50), sha: "9f8e7d6c5b4a" }];
  const retired = [board("alexa-mcp", "ALX", 30, bad("alexa-ci")), board("sandbox", "SAN", 20, bad("sandbox-ci"))];
  const boards = scene === "control" ? own : scene === "onlyretired" ? retired : [...own, ...retired];
  const live = scene === "live";
  const snapshot = { supervisor: { started_at: iso(600), concurrency: 3, active: 1, queued: 0 }, usage: [],
    workers: [worker({}), ...(live ? [worker({ id: "w_s", name: "Writer", project: "sandbox", role: "writer", state: "waiting-approval", session: null, task: "a haiku" })] : [])],
    pending: live ? [{ id: "r_s", worker_id: "w_s", name: "Writer", kind: "approval", tool: "Bash", tier: "human", created_at: iso(9), preview: "ls" }] : [] };
  const dashboard = { now: iso(0), peers: [], laptops: [{ laptop: "mbp-1", at: iso(0), snapshot }], boards: [], updates: [{ seq: 1, from: "Writer@mbp-1", laptop: "mbp-1", text: "sandbox haiku written", at: iso(8) }], traffic: [] };
  let projectReads = 0;
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() { super(); window.sock = this; setTimeout(() => this.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } })); }
    frame(x) { this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(x) })); }
    send(data) {
      const x = JSON.parse(data);
      if (x.t === "dashboard") setTimeout(() => { this.frame({ t: "ok", rid: x.rid, result: dashboard }); for (const b of boards) this.frame({ t: "board", ...b }); });
      if (x.t !== "board_op") return;
      const isList = x.op.op === "projects";
      if (isList) projectReads++;
      if (scene === "reading") return;
      const fail = dead || (isList && (listDown || (scene === "retry" && projectReads === 1) || (scene === "reread" && projectReads > 1)));
      setTimeout(() => this.frame(fail ? { t: "error", rid: x.rid, code: "internal", message: "The board is down" } : { t: "ok", rid: x.rid, result: answer(x.op) }), 30);
    }
    close() {}
  }
  window.WebSocket = FakeSocket;
}

const sizes = { 390: [390, 844], 1024: [1024, 1366], 1440: [1440, 900] };
const every = ["overview", "waits", "status", "status/sandbox", "roadmap", "roadmap/athletic", "feature", "triage/athletic", "usage", "sessions", "rules", "capture"];
const scenes = {
  control: [...every, "usage?weigh=1", "sessions/helix"], retired: every, live: ["overview", "waits", "status"], onlyretired: ["overview", "feature", "usage", "roadmap"],
  reread: ["overview", "status", "usage"], down: ["overview", "waits", "status", "roadmap", "feature", "triage", "usage", "rules", "sessions"], listdown: ["overview", "waits", "status"], reading: ["overview", "waits", "status", "usage", "roadmap", "triage"],
  // The first read of the list fails; the page's own minute tick reads it again (its own clock, run on 61 s).
  retry: ["overview"],
  // What picking athletic (no laptop's board) in the header does on Usage.
  pick: ["usage", "overview"],
};
const widths = ws ? ws.split(",") : Object.keys(sizes);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [scene, hashes] of Object.entries(scenes)) {
    if (only && !only.split(",").includes(scene)) continue;
    for (const hash of hashes) for (const w of widths) {
      const page = await browser.newPage({ viewport: { width: sizes[w][0], height: sizes[w][1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      if (scene === "retry") await page.clock.install({ time: new Date("2026-11-23T18:00:00Z") });
      else await page.clock.setFixedTime(new Date("2026-11-23T18:00:00Z"));
      await page.addInitScript(fakeBroker, scene);
      await page.goto(`${base}#${hash === "capture" ? "overview" : hash}`);
      await page.waitForTimeout(2000);
      if (scene === "reread") { await page.evaluate(() => window.sock.frame({ t: "board_changed", project: "not-known", seq: 1, refs: [] })); await page.waitForTimeout(1500); }
      if (scene === "retry") {
        console.log("before:", await page.locator("#view .banner.down").allTextContents());
        await page.clock.runFor(61_000);
        await page.waitForTimeout(1500);
      }
      if (scene === "pick") { await page.selectOption("#project", "athletic"); await page.waitForTimeout(1000); }
      if (hash === "capture") { await page.click("#capture-open"); await page.waitForTimeout(300); }
      const name = `${scene}-${hash.replace(/[/?=]/g, "_")}-${w}`;
      if (hash !== "capture") await page.addStyleTag({ content: "header { position: static !important; }" });
      await page.screenshot({ path: join(out, `${name}.png`), fullPage: hash !== "capture" });
      const says = await page.evaluate(() => ({
        picker: document.querySelector("#project").hidden ? "hidden" : [...document.querySelectorAll("#project option")].map((o) => (o.selected ? `*${o.textContent}` : o.textContent)).join(" "),
        rows: [...document.querySelectorAll("#plist .prow, .pcards .pcard")].map((x) => x.dataset.project).join(" "),
        seg: [...document.querySelectorAll("#view .seg button, dialog[open] .seg button")].map((x) => x.textContent).join(" | ").slice(0, 120),
        banner: [...document.querySelectorAll(".banner")].map((x) => x.textContent.slice(0, 90)).join(" // "),
        empty: [...document.querySelectorAll(".empty-card")].map((x) => x.textContent.slice(0, 80)).join(" // "),
        retired: (document.body.innerText.match(/[^\n]*(alexa|sandbox|ALX-|SAN-)[^\n]*/gi) ?? []).slice(0, 6).join(" // "),
        over: document.documentElement.scrollWidth > innerWidth ? document.documentElement.scrollWidth : 0,
      }));
      console.log(name, JSON.stringify({ ...says, errors }));
      await page.close();
    }
  }
} finally { await browser.close(); server.close(); }
