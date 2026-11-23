// BOB-121 review C: the dashboard as built (65f2f84), on the reviewer's own data: long words, many items, a quiet laptop,
// failed reads, open forms. Prints each shot's counts, page errors, sideways overflow and (at 390) tap targets under 44 px.
//   node design/BOB-121/shots-review-C/shots.mjs <out dir> [name prefix]
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
const { chromium } = createRequire(new URL("../../../packages/broker/package.json", import.meta.url))("playwright-core");

const pub = new URL("../../../packages/broker/public/", import.meta.url).pathname;
const [out, prefix = ""] = process.argv.slice(2);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    const body = await readFile(join(pub, path === "/" ? "index.html" : path));
    res.writeHead(200, { "content-type": types[extname(path || ".html")] ?? "text/html" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

/** In the page: a broker from memory, as `scene` has it. */
function fakeBroker(scene) {
  const now = Date.now(), iso = (m) => new Date(now - m * 60_000).toISOString(), H = 60, D = 1440;
  const is = (...xs) => xs.includes(scene);
  const LONG = "Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft_migration_2026_11_23T18_00_00Z_rollback_candidate";
  const tokens = (n) => ({ input: n, output: 100, cache_read: n * 9, cache_write: 0 });
  const proj = (key, name, prefix, lead, po) => ({ key, name, prefix, draft_prefix: null, lead, po, repos: [] });
  let projects = [proj("bobnet", "BobNet", "BOB", "Mario@mbp-1", "Peach@mbp-1"), proj("helix", "Helix", "LAND", "Picard@mbp-1", "Bill@mbp-1")];
  if (is("many")) projects.push(proj("athletic", "athletic", "ATH", "Coach@mbp-1", "Scout@mbp-1"), proj("vitals", "Vitals", "VIT", "Crusher@ubu1", null), proj("alexa", "Alexa MCP for the kitchen display", "ALX", null, null), proj("recorder", "Recorderofficeintegrationpartnerships", "REC", "Riker@ubu1", "Troi@ubu1"), proj("sand", "sandbox", "SAN", "Data@ubu1", null));
  if (is("one")) projects = projects.slice(0, 1);
  const counts = (items, bugs) => ({ items, bugs, oldest: items ? iso(D * 4) : null });
  const f = (ref, release, status, title, over = {}) => ({ ref, kind: "feature", type: "increment", status, title, parent: null, release, ord: 1000, labels: [], progress: { checked: 4, total: 11 }, tasks: { done: 2, total: 5 }, open_since: null, archived_at: null, ...over });
  const feats = (p) => [f(`${p.prefix}-121`, "R3", "In Progress", "The dashboard, use case first", { open_since: iso(90) }), f(`${p.prefix}-9`, "R3", "Ready", "Move the board into the service")];
  const run = (status, at, took, over = {}) => ({ name: "ci", branch: "main", status, sha: "57e7002bfa01", url: "https://github.com/example/repo/actions/runs/1", started_at: at === null ? null : iso(at), ended_at: took === null ? null : iso(at - took), agent: null, ...over });
  const ci = (p) => p.key === "bobnet" ? [{ name: "test", usual_ms: 360_000, runs: [run("failed", 131, 6, { agent: "Toad@mbp-1" }), ...Array.from({ length: 7 }, (_, i) => run(i % 3 ? "passed" : "failed", 200 + i * 60, 5))] }]
    : p.key === "helix" ? [{ name: "ci", usual_ms: 540_000, runs: [run("running", 4, null, { agent: "Howard@mbp-1" }), run("passed", 90, 9), run("passed", 200, 9)] },
      { name: "deploy-production-and-smoke-test-every-partner-tenant", runs: [run("passed", 66, 14, { branch: "release/2026-11-recorder-partner-demo-rehearsal", agent: LONG.slice(0, 40) })] },
      { name: "nightly", runs: [run("cancelled", 400, 3, { url: null })] }, { name: "pages", runs: [run("queued", null, null, { url: null }), run("running", 30, null), run("cancelled", 60, 1)] }, { name: "e2e", runs: [run("running", 44, null)] }]
    : is("many") && p.key === "recorder" ? [{ name: LONG, runs: [run("failed", 9 * D, 20)] }] : [];
  const row = (p) => ({ project: p, release: { ref: "R3", title: "R3 A project's page", goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done: 1, total: 6 }, backlog: counts(2, 1) }, release_number: 3,
    open: feats(p).slice(0, 1), next_ready: feats(p)[1], waits_on_you: null, backlog: counts(12, 3), no_release: counts(0, 0), ci: is("noci") ? [] : ci(p) });
  const wait = (o) => ({ project: "helix", kind: "question", feature: null, context: null, recommended: null, holds: { items: [], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Bill@mbp-1", blocking: false, edits: [], stale: null, kept: null, fix: null, ...o });
  const build = { feature: "LAND-121", kind: "build", label: "Fixes" };
  let waits = [
    wait({ ref: "A-20", kind: "action", feature: "LAND-121", text: "Add the second company to the staging account in Clerk", holds: { items: ["LAND-121"], sessions: [] }, since: iso(4 * D + 30), blocking: true, needed_before: { text: "the partner's rehearsal on Thursday morning" }, stale: { changed_at: iso(2 * D + 60), owner: "Picard@mbp-1", flagged_at: iso(3 * H) } }),
    wait({ ref: "Q-261", feature: "LAND-121", text: `${LONG} or the plain name?\nSecond line of it.\n\nhttps://example.com/${"a/very/long/path/".repeat(14)}`, recommended: { key: "a", text: `Keep ${LONG}` }, context: `Paragraph one.\n\n${LONG}\n\n${"A sentence that goes on about the recorder's office and its instruments. ".repeat(14)}`, holds: { items: ["LAND-9", "LAND-10"], sessions: [build] }, since: iso(190), blocking: true, asked_by: "Picard@mbp-1", waiting_sessions: [build],
      edits: [1, 2, 3].map((n) => ({ seq: n, at: iso(100 - n), by: "Picard@mbp-1", reason: n === 2 ? `Because ${LONG}` : null, changes: [{ field: "text", old: `Old ${n}: ${LONG}`, new: "x" }, { field: "needed_before", old: null, new: "R2" }] })) }),
    wait({ ref: "DRAFT-118", kind: "bug", text: "The map drops a tract's east line when its lease is edited twice in a minute", since: iso(D + 200), asked_by: null, fix: { sha: "57e7002bfa01", subject: "x", release: "v0.9", tags_known: true }, stale: { changed_at: iso(3 * D), owner: null, flagged_at: null } }),
    wait({ ref: "DRAFT-119", kind: "bug", feature: "LAND-121", text: "Saving an edit on a phone loses the reason", since: iso(20 * H), blocking: true, asked_by: null }),
    wait({ ref: "A-9", project: "bobnet", kind: "action", text: "Where do Vitals' restart checks run from? Say which when it is done.", since: iso(8 * H), asked_by: "Peach@mbp-1" }),
    wait({ ref: "BOB-121", project: "bobnet", kind: "review_gate", text: "Design A waits for your review", since: iso(5 * H), asked_by: "Daisy@mbp-1", feature: "BOB-121" }),
    wait({ ref: "Q-240", text: "Does the partner demo show the audit trail?", since: iso(5 * H), kept: { at: iso(60), by: "Bill@mbp-1", reason: `still open until the demo's date is set, and ${LONG.slice(0, 70)}` } }),
  ];
  if (is("many")) for (let i = 0; i < 34; i++) waits.push(wait({ ref: `Q-${300 + i}`, project: projects[i % projects.length].key, text: `Question ${i}: should the ${["map", "audit view", "import", "lease list", "export"][i % 5]} keep ${"the older and longer form of ".repeat(i % 4)}its name?`, since: iso(50 + i * 400), blocking: i % 4 === 0, holds: { items: i % 4 === 0 ? [`X-${i}`] : [], sessions: [] } }));
  if (is("nothing")) waits = [];
  const question = (ref) => ({ ...(waits.find((x) => x.ref === ref) ?? {}), state: "open", answer: null, options: ref === "Q-261" ? [["a", "Keep it"], ["b", LONG], ["c", "One for each tract, with the older instrument's number in front, the year it was recorded and the county's own book and page, so the partner's index stays sorted"], ["d", "Ask the partner"]].map(([key, text], i) => ({ key, text, recommended: i === 2 }))
    : ref === "A-9" ? [["a", "A cron entry on mbp-1"], ["b", `The supervisor's own check, with ${LONG}`], ["c", "Leave it by hand"]].map(([key, text], i) => ({ key, text, recommended: i === 1 })) : null });
  const worker = (id, name, over = {}) => ({ id, name, project: "helix", role: "engineer", state: "running", task: "brief", model: "opus", effort: "high", checkpoint: null, started_at: iso(47), ended_at: null, last_event_at: iso(0), tokens: tokens(800_000), session: "LAND-121 build Fixes", task_ref: null, calls: 212, context: 148_000, ctx: [], ...over });
  const cmd = `cd ~/Code/helix-howard && ${Array.from({ length: 40 }, (_, i) => `pnpm exec playwright test e2e/land/change-sets-${i}.spec.ts --project=chromium`).join(" \\\n  && ")} \\\n  && git clean -fdx ${LONG}`;
  const q = (text, header, multi, n) => ({ question: text, header, multi, options: Array.from({ length: n }, (_, i) => ({ label: i ? `Option ${i}` : LONG, description: i % 2 ? "" : "As the recorder indexes it. The second company sees the lease through its tract." })) });
  const asks = { text: "x", cut: true, questions: [q(`${"Which account should the change-set migration treat as the owner of a lease that two companies share? ".repeat(4)}${LONG}`, "Account", false, 4), q("Which of these does the change show?", "Shown", true, 3), q("And the note?", "", false, 2), q("A second review?", "Review", false, 2)] };
  const pend = (id, w, name, over = {}) => ({ id, worker_id: w, name, kind: "approval", tool: "Bash", tier: "human", created_at: iso(14), preview: cmd.slice(0, 400), ask: { text: cmd, cut: true, questions: [] }, ...over });
  const pending = is("nothing") ? [] : [pend("r_5", "w_h", "Howard"), { ...pend("r_6", "w_m", "Marvin"), kind: "question", tool: "AskUserQuestion", tier: "orchestrator", created_at: iso(6), preview: asks.questions[0].question.slice(0, 200), ask: asks }];
  const workers = [worker("w_h", "Howard", { state: "waiting-approval" }), worker("w_m", "Marvin", { state: "waiting-answer", remote_url: "https://claude.ai/code/x", checkpoint: `LAND-121.4 · ${LONG}` }), worker("w_p", "Picard", { role: "lead" })];
  if (is("orphan")) { Object.assign(workers[0], { state: "failed", ended_at: iso(5), error: "supervisor restarted" }); }
  if (is("many")) for (let i = 0; i < 12; i++) { workers.push(worker(`w_${i}`, ["Scotty", "Bender", "Calvin", "Worf"][i % 4] + i, { project: projects[i % projects.length].key, session: null, state: i % 3 ? "running" : "waiting-approval" })); if (i % 3 === 0) pending.push(pend(`r_${20 + i}`, `w_${i}`, workers.at(-1).name, { created_at: iso(30 + i), tool: i % 2 ? "Bash" : "mcp__claude_ai_Google_Calendar__create_event", ask: { text: "{\"summary\":\"Partner rehearsal\"}", cut: false, questions: [] } })); }
  const decided = is("nothing") ? [] : [{ id: "r_1", worker_id: "w_h", name: "Howard", project: "helix", kind: "approval", tool: "Bash", created_at: iso(70), decided_at: new Date(Math.max(new Date().setHours(0, 2, 0, 0), now - 64 * 60_000)).toISOString(), decision: "allow", preview: `pnpm run tiles:build --only ${LONG}`, note: `Fine, but ${LONG}. ${"Keep the stash; clear only the tile cache. ".repeat(6)}` }];
  const snap = (over) => ({ supervisor: { started_at: iso(52 * H), concurrency: 4, active: 3, queued: 1 }, workers: [], pending: [], usage: [], cleanup: null, board_outbox: { count: 0, oldest_at: null, code: null }, decided: [], ...over });
  const mbpAge = is("quietboth") ? 14 : 0.3;
  const laptops = [{ laptop: "mbp-1", at: iso(mbpAge), snapshot: snap({ workers, pending, decided }) }];
  const ubuPend = [pend("r_8", "w_t", "Toad", { created_at: iso(20), preview: "node bench.mjs", ask: null })];
  laptops.push({ laptop: "ubu1", at: iso(is("quiet", "quietboth") ? 9 : 0.6), snapshot: snap({ supervisor: { started_at: iso(20 * H), concurrency: 2, active: 1, queued: 0 }, workers: [worker("w_t", "Toad", { project: "bobnet", role: "architect", session: "BOB-121 review B", state: is("quiet", "quietboth") ? "waiting-approval" : "running" })], pending: is("quiet", "quietboth") ? ubuPend : [], board_outbox: is("quiet") ? { count: 14, oldest_at: iso(11), code: "unavailable" } : { count: 0, oldest_at: null, code: null } }) });
  if (is("many")) for (const n of ["jetson-orin-nano-in-the-garage", "t480s"]) laptops.push({ laptop: n, at: iso(0.5), snapshot: snap({}) });
  if (is("nolaptop")) laptops.length = 0;
  if (is("older")) for (const l of laptops) { delete l.snapshot.decided; l.snapshot.pending = l.snapshot.pending.map(({ ask, ...p }) => p); }
  const peer = (name, laptop, online) => ({ address: `${name}@${laptop}`, name, laptop, team: "bobnet", purpose: null, expertise: [], status: online ? (name === "Mario" ? `waiting for ${LONG}` : "working") : null, online, last_seen: iso(online ? 0 : 200), connected_at: online ? iso(90) : null, client: { package: "@bobnet/supervisor", version: "2.0.0-rc.55", protocol: 1 }, stats: { sent_24h: 12, received_24h: 31, inbox: 0 } });
  const peers = Array.from({ length: is("many") ? 40 : 4 }, (_, i) => peer(["Mario", "Peach", "Toad", "poe"][i] ?? `agent-number-${i}`, i % 3 ? "mbp-1" : "jetson-orin-nano-in-the-garage", i % 2 === 0));
  const dash = () => ({ now: new Date().toISOString(), peers, laptops, boards: [], updates: [], traffic: Array.from({ length: is("many") ? 50 : 3 }, (_, i) => ({ id: `m_${i}`, type: "message", from: `Picard@mbp-1`, to: ["Howard@mbp-1"], urgent: false, at: iso(i) })) });
  const status = (p) => ({ project: p.key, name: p.name, waits: waits.filter((w) => w.project === p.key), stuck: { runs: [], ci: [], idle_sessions: [], idle_features: [], answered_holding: [], settled: [] }, recurring: null, done: { counts: { features: 1, sessions: 2, lands: 3, releases: 0 }, features: [], sessions: [], releases: [] }, backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false }, usage: { tokens: tokens(0), by_agent: [], heavy: [], lost: 0 }, more: {} });
  let down = is("down"), reads = 0;
  const fails = (op) => down || (is("listdown") && op.op === "projects") || (is("waitsdown") && op.op === "waits") || (is("overviewdown") && op.op === "overview") || (is("sendfails") && op.op === "answer_question");
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "overview": return { projects: projects.map(row) };
      case "waits": return { waits, answered: [{ project: "bobnet", ref: "Q-13", kind: "question", text: "Build the dashboard as prototyped?", key: null, words: "yes build it with the changes", at: new Date().toISOString() }].slice(0, is("nothing") ? 0 : 1) };
      case "status": return { at: iso(0), since: iso(420), projects: projects.map(status) };
      case "grants": return { grants: [{ project: "*", agent: "poe", laptop: "mbp-1", role: "admin", read: true, items: "none", fields: [], sessions: false, questions: false, admin: true }] };
      case "list": return op.of === "releases" ? { releases: [row(projects[0]).release], total: 1, cursor: null } : { items: op.of === "features" ? feats(projects.find((p) => p.key === op.project)) : [], total: 0, cursor: null };
      case "get": return /^[QA]-/.test(op.ref ?? "") ? { question: question(op.ref) } : { item: { ...f(op.ref, "R3", "In Progress", "The dashboard, use case first"), description: null, criteria: [], sessions: [], bug_where: null, found_in: null, casper_words: null }, history: [], item_titles: {} };
      case "answer_question": case "mark_done": waits = waits.filter((w) => w.ref !== op.ref); return { ref: op.ref, seq: 9, told: ["Picard@mbp-1"], waiting: [], supervisor: "mbp-1" };
      default: return { ref: null, seq: 1 };
    }
  };
  class FakeSocket extends EventTarget {
    static OPEN = 1; readyState = 1;
    constructor() { super(); window.sock = this; setTimeout(() => this.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } })); }
    frame(x) { this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(x) })); }
    send(data) {
      const x = JSON.parse(data);
      if (window.mute) return;
      if (x.t === "dashboard") setTimeout(() => this.frame({ t: "ok", rid: x.rid, result: dash() }));
      if (x.t === "board_op" && scene !== "reading") setTimeout(() => this.frame(fails(x.op) ? { t: "error", rid: x.rid, code: "unavailable", message: "The board's database isn't answering." } : { t: "ok", rid: x.rid, result: answer(x.op) }), 30);
      if (x.t === "action") { window.acted = x; setTimeout(() => { this.frame({ t: "ok", rid: x.rid, result: { id: "act_1" } }); setTimeout(() => this.frame({ t: "action_result", id: "act_1", laptop: x.laptop, ok: scene !== "actfails", message: "r_5 is already answered", note_delivered: scene === "undelivered" ? false : true }), 50); }); }
    }
    close() {}
  }
  window.setDown = (v) => { down = v; };
  window.WebSocket = FakeSocket;
  window.confirm = (t) => { (window.confirms ??= []).push(t); return true; };
}

const sizes = { 360: [360, 740], 390: [390, 844], 768: [768, 1024], 1024: [1024, 768], 1440: [1440, 900] };
const main = [390, 1024, 1440], ends = [390, 1440];
const agent = (n) => (p) => p.locator("#working .a-line", { hasText: n }).first().locator(".a-btn").click();
const tap = (r) => (p) => p.locator(`li[data-ref="${r}"] .l-t`).first().click();
const ans = (r) => (p) => p.locator(`li[data-ref="${r}"] .answer-btn`).first().click();
const wait = (ms) => (p) => p.waitForTimeout(ms);
// [name, scene, hash, steps, widths, part: an element, "top" the window, none the whole page]
const all = [
  ["first-overview", "base", "overview", [], [360, 390, 768, 1024, 1440], "top"],
  ["first-quiet", "quiet", "overview", [], ends, "top"],
  ["first-down", "down", "overview", [], ends, "top"],
  ["first-many", "many", "overview", [], [390, 1024, 1440], "top"],
  ["first-nothing", "nothing", "overview", [], ends, "top"],
  ["first-needs", "base", "needs", [], [390], "top"],
  ["first-status", "base", "status", [], [390], "top"],
  ["overview", "base", "overview", [], [360, 390, 768, 1024, 1440]],
  ["overview-dark", "base", "overview", [], main],
  ["overview-many", "many", "overview", [], main],
  ["overview-noci", "noci", "overview", [], ends],
  ["overview-nothing-dark", "nothing", "overview", [], ends],
  ["overview-waitsdown", "waitsdown", "overview", [], ends],
  ["overview-overviewdown", "overviewdown", "overview", [], ends],
  ["overview-listdown", "listdown", "overview", [], ends],
  ["overview-nolaptop", "nolaptop", "overview", [], ends],
  ["overview-quietboth", "quietboth", "overview", [], ends],
  ["overview-tap", "base", "overview", [tap("Q-261"), tap("DRAFT-118"), tap("r_5")], main, ".ov-needs"],
  ["overview-form", "base", "overview", [ans("Q-261"), wait(300)], main, ".ov-needs"],
  ["needs", "base", "needs", [], [360, 390, 768, 1024, 1440]],
  ["needs-dark", "base", "needs", [tap("Q-261"), ans("r_5")], main],
  ["needs-many", "many", "needs", [], main],
  ["needs-open", "base", "needs", [tap("Q-261"), (p) => p.locator('li[data-ref="Q-261"] .edits summary').click(), (p) => p.locator('li[data-ref="Q-261"] .ctx-row button').click()], main],
  ["needs-question", "base", "needs", [ans("Q-261"), wait(300)], main, 'li[data-ref="Q-261"]'],
  ["needs-action", "base", "needs", [ans("A-9"), wait(300)], main, 'li[data-ref="A-9"]'],
  ["needs-permission", "base", "needs", [ans("r_5")], [360, ...main], 'li[data-ref="r_5"]'],
  ["needs-older", "older", "needs", [ans("r_5")], ends, 'li[data-ref="r_5"]'],
  ["needs-quiet", "quiet", "needs", [], main],
  ["needs-down", "down", "needs", [], ends],
  ["needs-waitsdown", "waitsdown", "needs", [], ends],
  ["needs-listdown", "listdown", "needs", [], ends],
  ["needs-overviewdown", "overviewdown", "needs", [], ends],
  ["needs-reading", "reading", "needs", [], [390], "top"],
  ["needs-late", "base", "needs", [(p) => p.evaluate(() => { window.setDown(true); window.sock.frame({ t: "board_changed", project: "bobnet", seq: 1, refs: [] }); }), wait(1500)], ends],
  ["needs-cut", "base", "needs", [(p) => p.evaluate(() => { window.mute = true; window.sock.dispatchEvent(new Event("close")); }), wait(1500)], ends],
  ["needs-orphan", "orphan", "needs", [], ends],
  ["needs-allow", "base", "needs", [ans("r_5"), (p) => p.fill("form.answer textarea", "Fine."), (p) => p.getByRole("button", { name: "Allow", exact: true }).click(), wait(600)], ends, "top"],
  ["needs-undelivered", "undelivered", "needs", [ans("r_5"), (p) => p.fill("form.answer textarea", "Fine."), (p) => p.getByRole("button", { name: "Allow", exact: true }).click(), wait(600)], [390], "top"],
  ["needs-actfails", "actfails", "needs", [ans("r_5"), (p) => p.fill("form.answer textarea", "Fine."), (p) => p.getByRole("button", { name: "Allow", exact: true }).click(), wait(600)], [390], "top"],
  ["needs-answered", "base", "needs", [ans("A-9"), wait(300), (p) => p.locator('form.answer button[type="submit"]').click(), wait(900)], ends],
  ["needs-keyboard", "base", "needs", [ans("Q-261"), wait(300), (p) => p.setViewportSize({ width: 390, height: 480 }), (p) => p.locator("form.answer textarea").click(), wait(300)], [390], "top"],
  ["needs-form-redraw", "base", "needs", [ans("Q-261"), wait(300), (p) => p.fill("form.answer textarea", "Keep it, and"), (p) => p.evaluate(() => window.sock.frame({ t: "board_changed", project: "helix", seq: 3, refs: [] })), wait(900)], [390], 'li[data-ref="Q-261"]'],
  ["ask-folded", "base", "overview", [agent("Marvin")], [360, ...main], ".ov-now"],
  ["ask-open", "base", "overview", [agent("Marvin"), (p) => p.locator(".ask-more").click()], main, ".ov-now"],
  ["ask-dark", "base", "overview", [agent("Marvin"), (p) => p.locator(".ask-more").click()], ends, ".ov-now"],
  ["ask-human", "base", "overview", [agent("Howard")], ends, ".ov-now"],
  ["ask-older", "older", "overview", [agent("Marvin")], ends, ".ov-now"],
  ["ci", "base", "overview", [], [360, 390, 768, 1024, 1440], ".ov-ci"],
  ["ci-dark", "base", "overview", [], ends, ".ov-ci"],
  ["laptops", "base", "laptops", [], main],
  ["laptops-dark", "quiet", "laptops", [], ends],
  ["laptops-many", "many", "laptops", [(p) => p.locator("details.msgs summary").click()], main],
  ["laptops-none", "nolaptop", "laptops", [], [390]],
  ["laptops-listdown", "listdown", "laptops", [], [390]],
  ["usage", "many", "usage", [], main, "top"],
  ["feature", "many", "feature/helix/LAND-121", [], main, "top"],
  ["feature-agent", "base", "feature/helix/LAND-121", [], [390]],
  ["triage", "many", "triage/recorder", [], main, "top"],
  ["status", "base", "status", [], main],
  ["status-tap", "base", "status", [tap("Q-261")], ends, "#status-needs"],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, scene, hash, steps, widths, part] of all) {
    if (!name.startsWith(prefix)) continue;
    for (const w of widths) {
      const phone = w < 600;
      const page = await browser.newPage({ viewport: { width: sizes[w][0], height: sizes[w][1] }, colorScheme: name.includes("dark") ? "dark" : "light", isMobile: phone, hasTouch: phone, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(fakeBroker, scene);
      await page.goto(`${base}#${hash}`);
      await page.waitForTimeout(900);
      try { for (const step of steps) { await step(page); await page.waitForTimeout(250); } } catch (e) { errors.push(`step: ${e.message.split("\n")[0]}`); }
      const says = await page.evaluate(([phone, want]) => {
        const seen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const small = !phone ? [] : [...document.querySelectorAll("header a, header button, #view button, #view a, #view summary, #view input, #view textarea, #view [role=button]")].filter(seen).map((e) => { const r = (e.type === "radio" ? e.closest("label") : e).getBoundingClientRect(); return [e, r]; }).filter(([, r]) => r.height < 43.5)
          .map(([e, r]) => `${e.tagName.toLowerCase()}.${(e.className || e.id || "").toString().split(" ")[0]} ${Math.round(r.width)}x${Math.round(r.height)}`);
        const n = (s) => document.querySelector(s)?.textContent.trim();
        return { tab: n("#needs-n"), ov: n("#needs-count"), items: document.querySelectorAll("li.need").length, seg: [...document.querySelectorAll(".seg.filters button")].map((b) => b.textContent).join(" | "), fresh: n(".fresh"), conn: n("#conn"), banner: [...document.querySelectorAll(".banner")].map((x) => x.textContent.slice(0, 110)).join(" // "), toast: document.querySelector("#toast")?.hidden ? "" : n("#toast"),
          over: Math.max(0, document.documentElement.scrollWidth - want), wide: [...document.querySelectorAll('#view *')].filter((e) => e.getBoundingClientRect().right > want + 1 && !e.closest('.table-wrap')).map((e) => `${e.tagName.toLowerCase()}.${e.className}`).slice(-2), focus: document.activeElement?.tagName, confirms: window.confirms?.map((t) => t.length),
          small: [...new Set(small)].slice(0, 30) };
      }, [phone, sizes[w][0]]);
      console.log(`${name}-${w}`, JSON.stringify({ ...says, errors }));
      if (part !== "top") await page.addStyleTag({ content: "header { position: static !important; }" + (part ? "#toast { display: none !important; }" : "") });
      const path = join(out, `${name}-${w}.png`);
      const shot = part === "top" ? page.screenshot({ path }) : part ? page.locator(part).first().screenshot({ path }) : page.screenshot({ path, fullPage: true });
      await shot.catch((e) => console.log(`${name}-${w} no shot: ${e.message.split("\n")[0]}`));
      await page.close();
    }
  }
} finally { await browser.close(); server.close(); }
