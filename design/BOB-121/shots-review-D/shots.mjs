// BOB-121 review D: Usage, a day's detail, a project's page and the Overview as built (c82f3e0), on the reviewer's own data:
// seven projects, long names, a young project, an empty one, failed reads, a quiet laptop, dark, weighed, taps.
// Prints each shot's page errors, sideways overflow, what is cut, contrast under 4.5:1 and (at 390) tap targets under 44 px.
//   node design/BOB-121/shots-review-D/shots.mjs <out dir> [name prefix]
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
  if (is("many", "seven", "long")) projects.push(proj("athletic", "athletic", "ATH", "Coach@mbp-1", "Scout@mbp-1"), proj("vitals", "Vitals", "VIT", "Crusher@ubu1", null), proj("alexa", "Alexa MCP for the kitchen display", "ALX", null, null), proj("recorder", "Recorderofficeintegrationpartnerships", "REC", "Riker@ubu1", "Troi@ubu1"), proj("sand", "sandbox", "SAN", "Data@ubu1", null));
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
  const row = (p) => ({ project: p, done_unclosed: p.key === "bobnet" ? [{ ref: "R1", title: "R1 Central backlog view" }, { ref: "R2", title: "R2 Run the team" }] : [], release: p.key === "vitals" ? null : { ref: "R3", title: "R3 A project's page", goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done: 1, total: 6 }, backlog: counts(2, 1) }, release_number: 3,
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
  const mbpAge = is("quietboth") ? 14 : is("asleep") ? 14 * H : 0.3;
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
  const fails = (op) => down || (is("listdown") && op.op === "projects") || (is("waitsdown") && op.op === "waits") || (is("overviewdown") && op.op === "overview") || ((is("usagedown") && op.op === "usage") || (is("daydown") && op.op === "usage_day") || (is("pagedown") && op.op === "project"));
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "usage": return { weights, tz: op.tz, days: usageDaysOf(op.days), projects: (is("none") ? [] : projects).filter((p) => !op.project || p.key === op.project).map((p) => ({ project: p.key, name: p.name, lost: p.key === "helix" ? 3 : 0, points: Array.from({ length: op.days }, (_, i) => point(p.key, op.days - 1 - i)) })) };
      case "usage_day": return dayOf(op);
      case "project": return pageOf(projects.find((p) => p.key === op.project));
      case "overview": return { projects: projects.map(row) };
      case "waits": return { waits, answered: [{ project: "bobnet", ref: "Q-13", kind: "question", text: "Build the dashboard as prototyped?", key: null, words: "yes build it with the changes", at: new Date().toISOString() }].slice(0, is("nothing") ? 0 : 1) };
      case "status": return { at: iso(0), since: iso(420), projects: projects.map(status) };
      case "grants": return { grants: [{ project: "*", agent: "poe", laptop: "mbp-1", role: "admin", read: true, items: "none", fields: [], sessions: false, questions: false, admin: true }] };
      case "list": return op.of === "releases" ? { releases: [row(projects[0]).release], total: 1, cursor: null } : { items: op.of === "features" ? featsOf(projects.find((p) => p.key === op.project)) : [], total: 0, cursor: null };
      case "get": return /^[QA]-/.test(op.ref ?? "") ? { question: question(op.ref) } : { item: { ...f(op.ref, "R3", "In Progress", "The dashboard, use case first"), description: null, criteria: [], sessions: [], bug_where: null, found_in: null, casper_words: null }, history: [], item_titles: {} };
      case "answer_question": case "mark_done": waits = waits.filter((w) => w.ref !== op.ref); return { ref: op.ref, seq: 9, told: ["Picard@mbp-1"], waiting: [], supervisor: "mbp-1" };
      default: return { ref: null, seq: 1 };
    }
  };

  // Build D's reads: usage (30 or 14 days), a day of it, a project's page.
  const two = (n) => String(n).padStart(2, "0");
  const dayBack = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
  const wrow = (model, alias, n, cr) => ({ model, alias, input: n, output: n, cache_read: cr, cache_write: n });
  const weights = { read_at: "2026-11-22", rows: [wrow("claude-sonnet-5-5", "sonnet", 1, 1), wrow("claude-opus-5-5", "opus", 2, 2), wrow("claude-haiku-5-5", "haiku", 0.05, 0.1), wrow("claude-fable-5-1", "fable", 5, 2.5), wrow("claude-fable-5-2", null, 4, 2), wrow("claude-opus-5", null, 2.5, 2.5), wrow("claude-sonnet-4-6", null, 1.5, 1.5), wrow("claude-haiku-4-5", null, 0.5, 0.1)] };
  // BobNet began ten days ago; Helix is old and has three spikes in a row; athletic is tiny with one spike; Vitals never ran; the rest are steady.
  const mega = (key, b) => key === "bobnet" ? (b > 10 ? 0 : [41, 86, 92, 88, 20, 6, 31, 70, 150, 140, 26][b] * 1e6) : key === "helix" ? (b === 0 ? 12e6 : [6, 7, 8].includes(b) ? (190 + b) * 1e6 : (30 + 14 * Math.abs(Math.sin(b * 1.7)) - (b % 7 < 2 ? 25 : 0)) * 1e6)
    : key === "athletic" ? (b === 5 ? 6.2e6 : b % 3 ? 0.3e6 : 0.9e6) : key === "vitals" ? 0 : key === "sand" ? (b === 12 ? 900 : 0) : (3 + 2 * Math.sin(b)) * 1e6;
  const point = (key, b) => {
    const t = Math.round(mega(key, b)), unknown = b % 8 === 3 ? Math.round(t * 0.1) : 0, opus = Math.round((t - unknown) * 0.9), sonnet = t - unknown - opus;
    const roles = [["engineer", .5], ["lead", .3], ["architect", .2]].map(([role, f]) => ({ role, calls: Math.round(t / 130_000 * f), raw: Math.round(t * f), weighted: Math.round(t * f * 1.9) }));
    const s2 = (feature, kind, label) => ({ feature, kind, label }), w = Math.round(2 * opus + sonnet + unknown);
    return { raw: { input: Math.round(t * .02), output: Math.round(t * .03), cache_write: Math.round(t * .05), cache_read: t - Math.round(t * .02) - Math.round(t * .03) - Math.round(t * .05) }, weighted: w, unknown, calls: roles.reduce((n, r) => n + r.calls, 0),
      by_model: t ? [["claude-opus-5-5", opus, 2 * opus], ["claude-sonnet-5-5", sonnet, sonnet], ["unknown", unknown, unknown]].filter((x) => x[1]).map(([model, raw, weighted]) => ({ model, raw, weighted })) : [], by_role: t ? roles : [],
      top: t ? [[s2("BOB-121", "build", "Fixes after review C, second round"), "The dashboard", .5], [s2("BOB-1204", "design", "A"), "Long", .2], [null, null, .1]].map(([session, feature_title, f]) => ({ session, feature_title, raw: Math.round(t * f), weighted: Math.round(w * f) })) : [] };
  };
  const usageDaysOf = (n) => Array.from({ length: n }, (_, i) => dayBack(n - 1 - i));
  const climb = (n, a, z) => Array.from({ length: n }, (_, i) => Math.round(a + (z - a) * Math.sqrt(i / Math.max(1, n)) + 3000 * Math.sin(i / 3)));
  const dayOf = (op) => {
    if (op.project === "vitals") return { project: op.project, day: op.day, days: usageDaysOf(op.days), runs: [], lost: 2, baseline: { total: { days: 0, calls: 0, p50: { calls: 0, pts: [] } }, roles: [] } };
    const b = usageDaysOf(op.days).length - 1 - usageDaysOf(op.days).indexOf(op.day), calls = point(op.project, b).calls;
    const mk = (id, role, n, i) => ({ id, agent: role, role, session: null, model: "opus", started_at: `${op.day}T${two(i + 1)}:00:00.000Z`, ended_at: `${op.day}T${two(i + 2)}:00:00.000Z`, resumed: false, first: 1, ctx: { calls: n, pts: climb(Math.min(n, 120), 25_000, 40_000 + 400 * Math.min(n, 400)) } });
    const runs = []; for (let i = 0; i < (is("many") ? 30 : 9); i++) runs.push(mk(`d${i}`, i % 3 === 0 ? "engineer" : i % 3 === 1 ? "lead" : is("many") && i % 4 === 0 ? `the-role-number-${i}-with-a-long-name` : "architect", Math.max(1, Math.round(calls / 9 * (i % 5 === 0 ? .1 : 1.2))), i % 20));
    let t = 0; const med = climb(260, 26_000, 110_000).map((v) => (t += v)), line = (pts) => ({ calls: pts.length, pts });
    const young = op.project === "bobnet";
    return { project: op.project, day: op.day, days: usageDaysOf(op.days), runs, lost: 1, baseline: { total: { days: young ? 11 : 28, calls: young ? (op.days === 30 ? 0 : 410) : 260, p50: line(med) }, roles: ["engineer", "lead", "architect"].map((role, k) => ({ role, runs: 20, calls: young && op.days === 30 ? 0 : 90, p25: line(k === 2 ? [] : climb(90, 20_000, 70_000)), p50: line(k === 2 ? [] : climb(90, 26_000, 100_000)), p75: line(k === 2 ? [] : climb(90, 32_000, 140_000)) })) } };
  };
  const tk = (n) => ({ input: Math.round(n * .02), output: Math.round(n * .03), cache_write: Math.round(n * .05), cache_read: n - Math.round(n * .1) });
  const pr = (id, agent, role, model, n, from, took, over = {}) => ({ id, agent, role, laptop: "mbp-1", model, effort: model ? "high" : null, started_at: iso(from), ended_at: took === null ? null : iso(from - took), tokens: tk(n), weighted: n * 2, unknown: 0, calls: 10, resumed: false, remote_url: null, tasks: [], outcome: took === null ? null : "done", outcome_reason: null, ...over });
  const consult = (i, from) => pr(`c${i}_${from}`, ["Toad", "Bill", "Peach"][i % 3], ["toad", "po", "product"][i % 3], null, 15_118 + i * 900, from - i, 1, { outcome: "stopped", outcome_reason: "consult answered" });
  const ps = (feature, kind, label, title, from, took, close, runs) => ({ session: { feature, kind, label }, feature_title: title, started_at: iso(from), ended_at: took === null ? null : iso(from - took), close: close && { need: close[0], summary: close[1], blockers: close[2] ?? 0, majors: close[3] ?? 0, minors_fixed: 0, sent_back: close[4] ?? 0 }, tokens: runs.reduce((t, r) => Object.fromEntries(Object.keys(t).map((k) => [k, t[k] + r.tokens[k]])), tk(0)), weighted: runs.reduce((n, r) => n + r.weighted, 0), unknown: 0, lost: 0, runs });
  const LT = "A person edits a recorded tract: the edit is proposed, approved and audited, and the partner sees it";
  const SUM = "All five tasks are landed on v2; the tip is c82f3e0. Usage (180), a day's detail (181), a project's page (182) and the Overview (179), with the review C fix pass; one broker deploy, then the rc with BOB-195's half. Two majors sent back.";
  const sessOf = (key) => key === "vitals" ? [] : [
    ps("LAND-121", "build", "Fixes", LT, 300, null, null, [pr("w_p", "Picard", "lead", "opus", 0, 290, null), pr("w_h", "Howard", "engineer", "opus", 0, 120, null), pr("w_zz", "Ghost", "engineer", "opus", 0, 100, null), pr("b9", "Howard", "engineer", "opus", 8_300_000, 280, 100, { outcome: "failed", outcome_reason: `land refused: CI red on main, ${is("long") ? LONG : "e2e timed out"}` }), ...Array.from({ length: 14 }, (_, i) => consult(i, 260))]),
    ps("LAND-121", "review", "1", LT, 500, 110, ["answer", SUM, 1, 2, 2], [pr("r1", "Bill", "reviewer", "sonnet", 3_300_000, 490, 80), pr("r2", "Calvin", "qa", null, 0, 480, 60, { outcome: "lost", outcome_reason: "mbp-1 restarted mid-run" })]),
    ps("LAND-121", "design", "A", LT, 1900, 700, ["casper", "Spec and prototype; Casper accepted it (Q-255)."], [pr("d1", "Riker", "designer", "opus", 5_200_000, 1900, 300)]),
    ...Array.from({ length: is("many") ? 26 : 2 }, (_, i) => ps(`LAND-${i + 20}`, ["build", "review", "retro"][i % 3], is("long") ? LONG.slice(0, 40) : `B${i}`, i % 2 ? LT : "Short", 4000 + i * 300, 120, ["none", i % 2 ? SUM : null], [pr(`x${i}`, "Howard", "engineer", "opus", 2_000_000, 4000 + i * 300, 100), ...Array.from({ length: 5 }, (_, k) => consult(k, 3990 + i * 300))])),
  ];
  const own = (a, b) => ({ own: { checked: a, total: b } });
  const featsOf = (p) => p.key === "vitals" ? [] : [f(`${p.prefix}-45`, "R3", "Done", "Build and CI", { done_at: iso(2 * D) }), f(`${p.prefix}-121`, "R3", "In Progress", is("long") ? LONG : "The dashboard, use case first", { open_since: iso(90), ...own(5, 20) }), f(`${p.prefix}-9`, "R3", "Ready", "Move the board into the service", own(0, 6)),
    ...Array.from({ length: is("many") ? 18 : 2 }, (_, i) => f(`${p.prefix}-${60 + i}`, "R3", i % 2 ? "Draft" : "Done", `Feature number ${i} of the release, in a title of the usual length`, own(0, i % 2 ? 0 : 5)))];
  const pageOf = (p) => ({ project: p, release: p.key === "vitals" ? null : { ref: "R3", title: is("long") ? `R3 ${LONG.slice(0, 60)}` : "R3 A project's page", goal: null, status: "open", ord: 1, spec_url: null, closed_at: null, closed_by: null, features: { done: 1, total: 6 }, backlog: counts(2, 1), number: 3 }, done_unclosed: p.key === "bobnet" ? [{ ref: "R1", title: "R1 Central backlog view" }, { ref: "R2", title: "R2 Run the team from your phone" }] : [], waits: [],
    backlog: { ready: [], sessions_estimate: null, no_criteria: [{ ref: "X", title: "x" }], triage: { count: p.key === "vitals" ? 0 : 12, oldest: p.key === "vitals" ? null : { ref: "DRAFT-1", at: iso(14 * D) } }, release: { ref: "R3", ready: 0, todo: 4 }, thin: true }, ci: ci(p), sessions: sessOf(p.key), other_runs: p.key === "vitals" ? [] : Array.from({ length: 12 }, (_, i) => consult(i, 900)), usage: {}, more: is("many") ? { sessions: 31 } : {} });
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

const sizes = { 360: [360, 740], 390: [390, 844], 768: [768, 1024], 1024: [1024, 768], 1100: [1100, 800], 1280: [1280, 800], 1440: [1440, 900] };
const main = [390, 1024, 1440], ends = [390, 1440];
const agent = (n) => (p) => p.locator("#working .a-line", { hasText: n }).first().locator(".a-btn").click();
const tap = (r) => (p) => p.locator(`li[data-ref="${r}"] .l-t`).first().click();
const ans = (r) => (p) => p.locator(`li[data-ref="${r}"] .answer-btn`).first().click();
const wait = (ms) => (p) => p.waitForTimeout(ms);
const bar = (key, n) => async (p) => { const d = await p.evaluate((n) => { const d = new Date(), two = (x) => String(x).padStart(2, "0"); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; }, n); await p.locator(`.ucard[data-project="${key}"] .bar[data-day="${d}"]`).click(); };
const btn = (name) => (p) => p.getByRole("button", { name, exact: true }).first().click();
const weigh = btn("Sonnet-equivalent");
const key = (k) => (p) => p.keyboard.press(k);
const roles = (n) => (p) => p.locator(".ud-roles button").nth(n).click();
const tapGraph = (frac) => async (p) => { const b = await p.locator(".ud-plot svg").first().boundingBox(); await p.locator(".ud-plot svg").first().scrollIntoViewIfNeeded(); const c = await p.locator(".ud-plot svg").first().boundingBox(); (b && p.touchscreen ? await p.touchscreen.tap(c.x + c.width * frac, c.y + 60) : 0); };
// [name, scene, hash, steps, widths, part: an element, "top" the window, none the whole page]
const all = [
  ["first-overview", "base", "overview", [], [360, 390, 768, 1024, 1440], "top"],
  ["first-quiet", "quiet", "overview", [], ends, "top"],
  ["first-down", "down", "overview", [], ends, "top"],
  ["first-nothing", "nothing", "overview", [], ends, "top"],
  ["first-usage", "seven", "usage", [], main, "top"],
  ["first-project", "base", "project/helix", [], main, "top"],
  ["overview", "base", "overview", [], [360, 390, 768, 1024, 1440]],
  ["overview-many", "many", "overview", [], main],
  ["overview-long", "long", "overview", [], main],
  ["overview-dark", "many", "overview", [], main],
  ["overview-nothing", "nothing", "overview", [], ends],
  ["overview-overviewdown", "overviewdown", "overview", [], ends],
  ["overview-noci", "noci", "overview", [], ends],
  ["overview-quietboth", "quietboth", "overview", [], ends],
  ["ci", "base", "overview", [], [360, 390, 768, 1024, 1100, 1280, 1440], ".ov-ci"],
  ["ci-long", "long", "overview", [], [360, 390, 1024, 1100, 1440], ".ov-ci"],
  ["usage", "seven", "usage", [], [360, 390, 768, 1024, 1440]],
  ["usage-14", "seven", "usage", [btn("14 days")], main],
  ["usage-weighed", "seven", "usage", [weigh, (p) => p.locator(".factored summary").click()], main],
  ["usage-dark", "seven", "usage", [weigh, bar("helix", 7)], main],
  ["usage-none", "none", "usage", [], ends],
  ["usage-one", "one", "usage", [], ends],
  ["usage-down", "usagedown", "usage", [], ends],
  ["usage-late", "base", "usage", [(p) => p.evaluate(() => { window.setDown(true); window.sock.frame({ t: "board_changed", project: "bobnet", seq: 1, refs: [] }); }), wait(1500)], ends],
  ["usage-asleep", "asleep", "usage", [], ends],
  ["usage-reading", "reading", "usage", [], [390], "top"],
  ["day-helix", "base", "usage", [bar("helix", 7)], main, ".ucard[data-project=helix]"],
  ["day-agent", "base", "usage", [bar("helix", 7), btn("By agent")], main, ".ucard[data-project=helix]"],
  ["day-agent-noband", "base", "usage", [bar("helix", 7), btn("By agent"), roles(2)], ends, ".ucard[data-project=helix]"],
  ["day-many", "many", "usage", [bar("helix", 7), btn("By agent")], main, ".ucard[data-project=helix]"],
  ["day-young", "base", "usage", [bar("bobnet", 8)], main, ".ucard[data-project=bobnet]"],
  ["day-empty", "seven", "usage", [bar("vitals", 4)], ends, ".ucard[data-project=vitals]"],
  ["day-today", "base", "usage", [bar("helix", 0)], main, ".ucard[data-project=helix]"],
  ["day-first", "base", "usage", [bar("helix", 29), btn("By agent")], ends, ".ucard[data-project=helix]"],
  ["day-failed", "daydown", "usage", [bar("helix", 7)], ends, ".ucard[data-project=helix]"],
  ["day-tap", "base", "usage", [bar("helix", 7), tapGraph(.4)], [390], "top"],
  ["day-scrolled", "seven", "usage", [bar("helix", 7)], [390], "top"],
  ["day-esc", "base", "usage", [bar("helix", 7), key("Escape")], ends, "top"],
  ["day-two", "base", "usage", [bar("helix", 7), bar("bobnet", 9)], [390, 1440]],
  ["project", "base", "project/helix", [], [360, 390, 768, 1024, 1440]],
  ["project-bobnet", "base", "project/bobnet", [], main],
  ["project-empty", "seven", "project/vitals", [], main],
  ["project-many", "many", "project/helix", [], main],
  ["project-all", "many", "project/helix", [(p) => p.getByRole("button", { name: /Show all/ }).first().click()], ends],
  ["project-long", "long", "project/recorder", [], main],
  ["project-longhelix", "long", "project/helix", [], main],
  ["project-dark", "base", "project/helix", [weigh, (p) => p.locator(".puse .bar").nth(6).click()], main],
  ["project-down", "pagedown", "project/helix", [], ends],
  ["project-usagedown", "usagedown", "project/helix", [weigh], ends],
  ["project-waitsdown", "waitsdown", "project/helix", [], ends],
  ["project-quiet", "quietboth", "project/helix", [], main],
  ["project-others", "base", "project/helix", [(p) => p.locator(".others summary").click()], ends, ".plate"],
  ["old-sessions", "base", "sessions", [], [390], "top"],
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
      await page.waitForTimeout(2200);
      try { for (const step of steps) { await step(page); await page.waitForTimeout(250); } } catch (e) { errors.push(`step: ${e.message.split("\n")[0]}`); }
      const says = await page.evaluate(([phone, want]) => {
        const seen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const small = !phone ? [] : [...document.querySelectorAll("header a, header button, #view button, #view a, #view summary, #view input, #view textarea, #view [role=button]")].filter(seen).map((e) => { const r = (e.type === "radio" ? e.closest("label") : e).getBoundingClientRect(); return [e, r]; }).filter(([, r]) => r.height < 43.5)
          .map(([e, r]) => `${e.tagName.toLowerCase()}.${(e.className || e.id || "").toString().split(" ")[0]} ${Math.round(r.width)}x${Math.round(r.height)}`);
        // Text under 4.5:1 on its own background, and text cut by its box.
        const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
        const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
        const bg = (e) => { for (; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || c[3] === 1) return c; } return [255, 255, 255]; };
        const low = new Map();
        for (const e of document.querySelectorAll("#view *")) {
          if (![...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) || !seen(e)) continue;
          const st = getComputedStyle(e), fg = rgb(e.namespaceURI.includes("svg") ? st.fill : st.color);
          const a = lum(fg.slice(0, 3)), b = lum(bg(e.closest("svg")?.parentElement ?? e).slice(0, 3)), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          if (ratio < 4.45) low.set(`${e.tagName.toLowerCase()}.${e.getAttribute("class") ?? ""} ${ratio.toFixed(1)}`, e.textContent.trim().slice(0, 24));
        }
        return { over: Math.max(0, document.documentElement.scrollWidth - want), h: document.documentElement.scrollHeight, low: [...low].slice(0, 5), toast: document.querySelector("#toast")?.hidden ? "" : document.querySelector("#toast").textContent, tip: [...document.querySelectorAll(".ud .tip")].map((t) => t.hidden ? "" : t.textContent).join(), hash: location.hash, y: scrollY,
          focus: document.activeElement?.getAttribute("data-fk") ?? document.activeElement?.tagName,
          bars: [...document.querySelectorAll(".ugraph")].map((g) => Math.round(g.querySelector(".hit").getBoundingClientRect().width * 10) / 10).join(" "),
          tops: Object.fromEntries([...document.querySelectorAll(".ov-needs, .ov-now, .ov-ci, .ov-proj, .prel, .prun, .plate, .pwaits, .pci, .puse, .pback, .ucard, .ud")].map((e) => [e.className.replace("card ", "") + (e.dataset.project ?? ""), Math.round(e.getBoundingClientRect().top + scrollY)])),
          wide: [...document.querySelectorAll("#view *")].filter((e) => e.getBoundingClientRect().right > want + 1 && !e.closest(".table-wrap, .ud-roles")).map((e) => `${e.tagName.toLowerCase()}.${e.getAttribute("class")}`).slice(-2),
          small: [...new Set(small)].slice(0, 30) };
      }, [phone, sizes[w][0]]);
      console.log(`${name}-${w}`, JSON.stringify({ ...says, errors }));
      if (part !== "top") await page.addStyleTag({ content: "header { position: static !important; }" + (part ? "#toast { display: none !important; }" : "") });
      await page.waitForTimeout(300);
      const path = join(out, `${name}-${w}.png`);
      const shot = part === "top" ? page.screenshot({ path }) : part ? page.locator(part).first().screenshot({ path }).catch(() => page.locator(part).first().screenshot({ path })) : page.screenshot({ path, fullPage: true });
      await shot.catch((e) => console.log(`${name}-${w} no shot: ${e.message.split("\n")[0]}`));
      await page.close();
    }
  }
} finally { await browser.close(); server.close(); }
