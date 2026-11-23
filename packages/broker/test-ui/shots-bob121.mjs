// Screenshots of BOB-121's build C (design/BOB-121/spec.md) at phone, tablet and desktop widths, against a fake broker in
// the page: the header and Triage (BOB-174), Laptops (BOB-175), Needs you (BOB-176), an agent's ask (BOB-177), CI (BOB-178).
//   node test-ui/shots-bob121.mjs [prefix]   (from packages/broker; writes test-ui/shots/bob121-*.png)
// Prints any page error and any page wider than its window.
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

/** Runs in the page: a broker that answers the dashboard and the board's reads from memory, as `scene` has it. */
function fakeBroker(scene) {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
  const H = 60, D = 24 * 60;
  const project = (key, name, prefix, lead, po) => ({ key, name, prefix, draft_prefix: null, lead, po, repos: [] });
  const projects = [project("bobnet", "BobNet", "BOB", "Mario@mbp-1", "Peach@mbp-1"), project("helix", "Helix", "LAND", "Picard@mbp-1", "Bill@mbp-1")];
  const feat = (ref, status, title, over = {}) => ({ ref, kind: "feature", type: "increment", status, title, parent: null, release: "R2", ord: 1000, labels: [], progress: { checked: 4, total: 11 }, tasks: { done: 9, total: 14 }, open_since: null, archived_at: null, ...over });
  const features = {
    bobnet: [feat("BOB-121", "In Progress", "The dashboard, use case first", { release: "R3", open_since: iso(300) }), feat("BOB-9", "Ready", "Move Helix's board off Backlog.md into the service", { release: "R3" })],
    helix: [feat("LAND-50", "In Progress", "An agent proposes a change to a recorded lease", { open_since: iso(400) }), feat("LAND-38", "Ready", "Partner audit view of a tract's changes")],
  };
  const release = (ref, title, done, total) => ({ ref, title, goal: null, status: "open", ord: 1000, spec_url: null, closed_at: null, closed_by: null, features: { done, total }, backlog: { items: 2, bugs: 1, oldest: iso(6 * D) } });
  const run = (status, startMin, tookMin, sha, agent = null, over = {}) => ({ name: "ci", branch: "main", status, sha, url: `https://github.com/example/repo/actions/runs/${sha}`, started_at: iso(startMin), ended_at: tookMin === null ? null : iso(startMin - tookMin), agent, ...over });
  const passed = (n, from) => Array.from({ length: n }, (_, i) => run("passed", from + i * 180, 9, `${(0xa1b2c3 + i * 4097).toString(16)}d4`));
  const ci = {
    bobnet: [{ name: "test", usual_ms: 6 * 60_000, runs: [run("failed", 2 * H + 11, 6, "4be01c77aa", "Toad", { branch: "v2" }), ...passed(3, 5 * H), run("failed", 16 * H, 5, "77aa01bd2c"), run("cancelled", 20 * H, 2, "0c19dd27aa")] }],
    helix: [
      { name: "ci", usual_ms: 9 * 60_000, runs: [run("running", 4, null, "7c1e2a9d01", "Howard"), ...passed(5, 70)] },
      { name: "e2e", usual_ms: 14 * 60_000, runs: [run("passed", 66, 14, "57e7002bfa"), run("passed", 5 * H, 13, "a39bd05c11"), run("failed", 8 * H, 12, "99ac01dd20")] },
      { name: "nightly", runs: [run("cancelled", 7 * H, 3, "57e7002bfa")] },
    ],
  };
  const overview = (p) => ({
    project: p, release: p.key === "helix" ? release("R2", "R2 Edit and audit", 1, 6) : release("R3", "R3 Vitals", 2, 9), release_number: p.key === "helix" ? 2 : 3,
    open: features[p.key].filter((x) => x.open_since), next_ready: features[p.key].find((x) => x.status === "Ready"), waits_on_you: p.key === "helix" ? "Q-261" : null,
    backlog: { items: p.key === "helix" ? 9 : 12, bugs: 3, oldest: iso(14 * D) }, no_release: { items: 4, bugs: 1, oldest: iso(9 * D) }, ci: scene === "oldboard" ? undefined : ci[p.key],
  });
  const wait = (over) => ({ project: "helix", kind: "question", feature: null, context: null, recommended: null, holds: { items: [], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Bill@mbp-1", blocking: false, edits: [], stale: null, kept: null, fix: null, ...over });
  const howard = { feature: "LAND-50", kind: "build", label: "2" };
  const change = (field, old, nw) => ({ field, old, new: nw });
  const waits = [
    wait({ ref: "Q-261", feature: "LAND-50", text: "A lease change that touches two recorded tracts: one change set, or one for each tract? Howard's build needs it to write the migration.\nOne set keeps the audit trail whole; two can be taken back one by one.", recommended: { key: "one", text: "One change set, with each tract's part shown apart" }, context: "The recorder's office accepts a lease amendment as one instrument.\n\nTwo change sets would give two instrument numbers for one document, and the audit view would show half an amendment between them.", holds: { items: [], sessions: [howard] }, since: iso(3 * H + 10), blocking: true, asked_by: "Picard@mbp-1",
      edits: [{ seq: 2, at: iso(100), by: "Picard@mbp-1", reason: "Howard asked for the trade-off", changes: [change("text", "One change set or two?", "…")] }, { seq: 3, at: iso(90), by: "Picard@mbp-1", reason: null, changes: [change("options", "two", "one")] }] }),
    wait({ ref: "A-20", kind: "action", feature: "LAND-50", text: "Add the second company to the staging account in Clerk, so the e2e can switch between the two", holds: { items: ["LAND-50"], sessions: [] }, since: iso(4 * D + 30), blocking: true, asked_by: "Picard@mbp-1", stale: { changed_at: iso(2 * D + 60), owner: "Picard@mbp-1", flagged_at: iso(3 * H) }, needed_before: { release: "R2" } }),
    wait({ ref: "DRAFT-118", kind: "bug", text: "The map drops a tract's east line when its lease is edited twice in a minute", since: iso(D + 200), blocking: true, asked_by: null, fix: { sha: "57e7002bfa01", subject: "land: keep both lines", release: "v0.9", tags_known: true } }),
    wait({ ref: "Q-14", project: "bobnet", feature: "BOB-121", text: "May a product owner create, edit, order, close and reopen its project's releases, with you keeping the same on the dashboard?", since: iso(26 * H), asked_by: "Peach@mbp-1", waiting_sessions: [{ feature: "BOB-121", kind: "review", label: "B" }] }),
    wait({ ref: "Q-240", text: "Does the partner demo show the audit trail, or only the proposed change?", recommended: { key: "both", text: "Both, the trail folded" }, since: iso(5 * H), kept: { at: iso(60), by: "Bill@mbp-1", reason: "still open until the demo's date is set" } }),
    wait({ ref: "A-9", project: "bobnet", kind: "action", text: "Where do Vitals' restart checks run from? Say which when it is done.", since: iso(8 * H), asked_by: "Peach@mbp-1" }),
    wait({ ref: "Q-243", text: "Keep the recorded instrument's scan beside the change, or only its number?", since: iso(40 * H), needed_before: { item: "LAND-38" }, stale: { changed_at: iso(40 * H), owner: "Bill@mbp-1", flagged_at: null } }),
  ];
  const question = (ref) => {
    const w = waits.find((x) => x.ref === ref) ?? { text: ref, kind: "question", since: iso(60) };
    const options = {
      "Q-261": [{ key: "one", text: "One change set, with each tract's part shown apart", recommended: true }, { key: "two", text: "One change set for each tract", recommended: false }],
      "A-9": [{ key: "cron", text: "A cron entry on mbp-1, outside the supervisor", recommended: false }, { key: "sup", text: "The supervisor's own check, every five minutes, with its result on the Laptops page", recommended: true }, { key: "none", text: "Leave it by hand for now", recommended: false }],
    }[ref] ?? null;
    return { ...w, options, state: "open", answer: null };
  };
  const answered = [{ project: "bobnet", ref: "Q-13", kind: "question", text: "Build the dashboard as prototyped?", key: null, words: "yes build it with the changes", at: new Date(Math.max(new Date().setHours(0, 5, 0, 0), now - 4 * H * 60_000)).toISOString() }];

  const worker = (id, name, role, over = {}) => ({ id, name, project: "helix", role, state: "running", task: `${name}'s brief`, model: "opus", effort: "high", checkpoint: null, started_at: iso(47), ended_at: null, last_event_at: iso(0),
    tokens: { input: 420_000, output: 310_000, cache_read: 14_200_000, cache_write: 860_000 }, session: "LAND-50 build 2", task_ref: null, calls: 212, context: 148_000, ctx: [], ...over });
  const asks = {
    text: "Which account should the change-set migration treat as the owner of a lease that two companies share?",
    cut: false,
    questions: [
      { question: "Which account should the change-set migration treat as the owner of a lease that two companies share? The recorded instrument names both, and the land service has one owner column today. The audit view shows whichever the migration picks, and the partner reads it as the company that can change the lease.", header: "Account", multi: false, options: [
        { label: "The first named grantee", description: "As the recorder indexes it. The second company sees the lease through its tract." }, { label: "Both, with a join table", description: "One migration more, and every lease query changes." }, { label: "The company that proposed the change", description: "Only for changes made here; a recorded lease keeps its grantee." }] },
      { question: "Which of these does the change show to the partner?", header: "Shown", multi: true, options: [{ label: "The tract's line on the map", description: "" }, { label: "The instrument number", description: "Not assigned until it is recorded." }, { label: "Who proposed it", description: "Name and company." }] },
      { question: "When a change is taken back, what happens to the note on it?", header: "Note", multi: false, options: [{ label: "It stays, struck through", description: "" }, { label: "It goes with the change", description: "" }] },
      { question: "Is a second review needed before recording?", header: "Review", multi: false, options: [{ label: "Yes", description: "Picard reads it first." }, { label: "No", description: "Howard's tests are enough." }] },
    ],
  };
  const command = "pnpm exec playwright test e2e/land/change-sets.spec.ts --project=chromium --workers=2 --reporter=line \\\n  && git clean -n .cache/tiles/staging \\\n  && pnpm run tiles:build --only staging --zoom 8-14";
  const pending = [
    { id: "r_5", worker_id: "w_h", name: "Howard", kind: "approval", tool: "Bash", tier: "human", created_at: iso(14), preview: command.slice(0, 90), ask: { text: command, cut: false, questions: [] } },
    { id: "r_6", worker_id: "w_m", name: "Marvin", kind: "question", tool: "AskUserQuestion", tier: "orchestrator", created_at: iso(6), preview: asks.text, ask: asks },
  ];
  const decided = [
    { id: "r_1", worker_id: "w_h", name: "Howard", project: "helix", kind: "approval", tool: "Bash", created_at: iso(70), decided_at: iso(64), decision: "allow", preview: "pnpm run tiles:build --only staging", note: "Fine. Keep the stash; clear only the tile cache." },
    { id: "r_2", worker_id: "w_x", name: "Bender", project: "helix", kind: "approval", tool: "WebFetch", created_at: iso(130), decided_at: iso(126), decision: "deny", preview: "https://example.com/recorder/api", note: null },
  ];
  const cleanup = { at: iso(5 * H), trigger: "schedule", skipped: null, freed_bytes: 3_400_000_000, projects: [{ project: "helix", freed_bytes: 3_100_000_000, steps: [{ step: "worktrees", ok: true, error: null, skipped: null, acted: 4, freed_bytes: 3_100_000_000 }] }, { project: "bobnet", freed_bytes: null, steps: [{ step: "runner", ok: true, error: null, skipped: "a runner job is running", acted: 0, freed_bytes: null }] }], steps: [] };
  const snapshot = (over) => ({ supervisor: { started_at: iso(52 * H), concurrency: 4, active: 3, queued: 1 }, workers: [], pending: [], usage: [], cleanup: null, board_outbox: { count: 0, oldest_at: null, code: null }, decided: [], ...over });
  const quiet = scene === "quiet";
  const nothing = scene === "nothing";
  const mbp = { laptop: "mbp-1", at: iso(0.3), snapshot: snapshot({ workers: nothing ? [] : [
    worker("w_h", "Howard", "engineer", { state: "waiting-approval", task_refs: ["LAND-50.2"] }), worker("w_m", "Marvin", "engineer", { state: "waiting-approval", started_at: iso(31), checkpoint: "LAND-50.4 · migration written, two owners open", calls: 98, context: 91_000, remote_url: "https://claude.ai/code/x" }),
    worker("w_p", "Picard", "lead", { started_at: iso(300), session: "LAND-50 build 2", calls: 402, context: 210_000 }), worker("w_q", "Scotty", "engineer", { state: "queued", started_at: null })],
  pending: nothing ? [] : pending, decided: nothing ? [] : decided, cleanup }) };
  if (scene === "older") { delete mbp.snapshot.decided; mbp.snapshot.pending = mbp.snapshot.pending.map(({ ask, ...p }) => p); }
  const ubu = { laptop: "ubu1", at: iso(quiet ? 9 : 0.6), snapshot: snapshot({ supervisor: { started_at: iso(20 * H), concurrency: 2, active: 1, queued: 0 }, workers: [worker("w_t", "Toad", "architect", { project: "bobnet", session: "BOB-121 review B", started_at: iso(22), calls: 61, context: 77_000, tokens: { input: 90_000, output: 60_000, cache_read: 3_900_000, cache_write: 210_000 } })],
    pending: quiet ? [{ id: "r_8", worker_id: "w_t", name: "Toad", kind: "approval", tool: "Bash", tier: "human", created_at: iso(20), preview: "node bench.mjs" }] : [], board_outbox: quiet ? { count: 14, oldest_at: iso(11), code: "unavailable" } : { count: 0, oldest_at: null, code: null } }) };
  const peer = (name, laptop, online, over = {}) => ({ address: `${name}@${laptop}`, name, laptop, team: "bobnet", purpose: null, expertise: [], status: online ? "working" : null, online, last_seen: iso(online ? 0 : 200), connected_at: online ? iso(90) : null, client: { package: "@bobnet/supervisor", version: laptop === "ubu1" ? "2.0.0-rc.54" : "2.0.0-rc.55", protocol: 1 }, stats: { sent_24h: 12, received_24h: 31, inbox: 0 }, ...over });
  const peers = [peer("Mario", "mbp-1", true), peer("Peach", "mbp-1", false), peer("Toad", "ubu1", true), peer("Picard", "mbp-1", true, { team: "helix" }), peer("Howard", "mbp-1", true, { team: "helix", stats: { sent_24h: 4, received_24h: 9, inbox: 1 } }), peer("poe", "mbp-1", true, { team: "ops", client: { package: "@bobnet/client", version: "2.0.0-rc.55", protocol: 1 } })];
  const traffic = [[4, "Picard@mbp-1", "Howard@mbp-1"], [6, "Marvin@mbp-1", "Picard@mbp-1"], [11, "poe@mbp-1", "Mario@mbp-1"], [14, "Toad@ubu1", "Daisy@mbp-1"]].map(([m, from, to], i) => ({ id: `m_${i}`, type: "message", from, to: [to], urgent: false, at: iso(m) }));
  const dashboard = { now: new Date(now).toISOString(), peers, laptops: [mbp, ubu], boards: [], updates: [], traffic };

  const bl = (key) => Array.from({ length: key === "helix" ? 9 : 12 }, (_, i) => ({ ref: `DRAFT-${100 + i}`, kind: "backlog", type: i < 3 ? "bug" : ["task", "chore", "spike"][i % 3], status: null, title: ["The map drops a tract's east line when its lease is edited twice", "The audit view shows the proposer's id, not the name", "A retried import writes the instrument twice", "Export a tract's changes as a PDF for the partner", "Sort the lease list by its recorded date", "Say which account a change was made in", "A shortcut to the last tract looked at", "The e2e's seed takes four minutes", "Rename 'grantee' where the partner reads it", "One look for every empty page", "A run that ended while the laptop slept", "Keep the filter when the project changes"][i], description: null,
    release: i % 4 === 0 ? (key === "helix" ? "R2" : "R3") : null, labels: [], created_at: iso((14 - i) * D + 30), casper_words: i === 3 ? "the partner wants to take it to the bank" : null, parent_hint: null, blocks_use: i === 0, bug_where: null, found_in: null, archived_at: null }));
  const status = (p) => ({ project: p.key, name: p.name, waits: waits.filter((w) => w.project === p.key), stuck: { runs: [], ci: [], idle_sessions: [], idle_features: [], answered_holding: [], settled: [] }, recurring: null,
    done: { counts: { features: 1, sessions: 4, lands: 3, releases: 0 }, features: [], sessions: [], releases: [] }, backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false },
    usage: { tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, by_agent: [], heavy: [], lost: 0 }, more: {} });
  const rule = (agent, over = {}) => ({ project: "*", agent, laptop: "mbp-1", role: "backup", read: true, items: "none", fields: [], sessions: false, questions: false, admin: false, ...over });
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "overview": return { projects: projects.filter((p) => !op.project || p.key === op.project).map(overview) };
      case "waits": return nothing ? { waits: [], answered: [] } : { waits, answered };
      case "status": return { at: iso(0), since: iso(7 * H), projects: projects.map(status) };
      case "grants": return { grants: [rule("poe", { role: "admin", admin: true }), rule("Mario")] };
      case "list": {
        if (op.of === "releases") return { releases: [release(op.project === "helix" ? "R2" : "R3", op.project === "helix" ? "R2 Edit and audit" : "R3 Vitals", 1, 6)], total: 1, cursor: null };
        const items = op.of === "features" ? features[op.project] : op.of === "backlog" ? bl(op.project) : [];
        return { items, total: items.length, cursor: null };
      }
      case "get": {
        if (/^[QA]-/.test(op.ref ?? "")) return { question: question(op.ref) };
        const item = features[op.project]?.find((x) => x.ref === op.ref);
        return { item: { ...item, description: null, criteria: [{ section: "ac", n: 1, text: "It holds.", evidence: null, state: "open" }], sessions: [], bug_where: null, found_in: null, casper_words: null }, history: [], item_titles: {} };
      }
      case "answer_question": case "mark_done": return { ref: op.ref, seq: 9, told: ["Picard@mbp-1"], waiting: [], supervisor: "mbp-1" };
      default: return { ref: null, seq: 1 };
    }
  };

  const fails = (op) => (scene === "down" ? true : scene === "listdown" ? op.op === "projects" : false);
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
      if (f.t === "board_op") setTimeout(() => this.frame(fails(f.op) ? { t: "error", rid: f.rid, code: "unavailable", message: "The board's database isn't answering." } : { t: "ok", rid: f.rid, result: answer(f.op) }), 30);
      if (f.t === "action") setTimeout(() => {
        this.frame({ t: "ok", rid: f.rid, result: { id: "act_1" } });
        setTimeout(() => this.frame({ t: "action_result", id: "act_1", laptop: f.laptop, ok: true, message: "Allowed.", ...(scene === "older" ? {} : { note_delivered: true }) }), 50);
      });
    }
    close() {}
  }
  window.WebSocket = FakeSocket;
  window.confirm = () => true;
}

const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };
// [name, scene, hash, selector to wait for, steps, element to shoot (none: the whole page; "top": the window), widths (none: all)]
const all = [
  ["bob121-header", "live", "overview", ".prow", [], "header"],
  ["bob121-header-quiet", "quiet", "overview", ".prow", [], "header"],
  ["bob121-header-feature", "live", "feature/helix/LAND-50", "#feature-head", [], "top"],
  ["bob121-header-usage", "live", "usage/bobnet", ".seg.projects", [], "top"],
  ["bob121-triage-bobnet", "live", "triage/bobnet", ".totals", []],
  ["bob121-triage-helix", "live", "triage/helix", ".totals", []],
  ["bob121-laptops", "live", "laptops", "#global-rules", []],
  ["bob121-laptops-quiet", "quiet", "laptops", "#global-rules", [(p) => p.locator("details.msgs summary").click()]],
];

const shots = all.filter(([name]) => name.startsWith(process.argv[2] ?? ""));
const browser = await chromium.launch();
try {
  for (const [name, scene, hash, wait, steps, el, only] of shots) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      if (only && !only.includes(Number(w))) continue;
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: name.includes("-dark") ? "dark" : "light", isMobile: width < 600, hasTouch: width < 600 });
      page.on("pageerror", (e) => console.log(`${name}-${w}: ${e.message}`));
      await page.addInitScript(fakeBroker, scene);
      await page.goto(`${base}#${hash}`);
      await page.waitForSelector(wait);
      await page.waitForTimeout(500);
      for (const step of steps) {
        await step(page);
        await page.waitForTimeout(400);
      }
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) console.log(`${name}-${w}: ${over} px wider than its window`);
      // A full page reads top to bottom: the header not stuck mid-page, the toast left out.
      await page.addStyleTag({ content: `header { position: static !important; } ${name.includes("toast") ? "" : "#toast { display: none !important; }"}` });
      const path = join(out, `${name}-${w}.png`);
      if (el === "top") await page.screenshot({ path });
      else if (el) await page.locator(el).first().screenshot({ path });
      else await page.screenshot({ path, fullPage: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
