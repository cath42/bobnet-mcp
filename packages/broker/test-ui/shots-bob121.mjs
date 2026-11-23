// Screenshots of BOB-121's builds C and D (design/BOB-121/spec.md) at phone, tablet and desktop widths, against a fake broker
// in the page: the header and Triage (BOB-174), Laptops (BOB-175), Needs you (BOB-176), an agent's ask (BOB-177), CI (BOB-178),
// Usage (BOB-180), a day's detail (BOB-181), a project's page (BOB-182), the Overview (BOB-179).
//   node test-ui/shots-bob121.mjs [prefix]   (from packages/broker; writes test-ui/shots/bob121-*.png)
// Prints any page error, any page wider than its viewport, a CI row whose words run into what is beside them, and at 390
// the tap targets under 44 px, by what they say (BOB-176 c12, c13).
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
  const projects = [project("bobnet", "BobNet", "BOB", "Mario@mbp-1", "Peach@mbp-1"), project("helix", "Helix", "LAND", "Picard@mbp-1", "Bill@mbp-1"),
    ...(scene === "many" ? ["Vitals", "Wildcatter land services", "Northlight mapping", "Field notes and surveys", "County recorder imports"].map((n) => project(n.toLowerCase().replaceAll(" ", "-"), n, n.slice(0, 3).toUpperCase(), "Data@mbp-1", "Troi@mbp-1")) : [])];
  // Words that don't break: a tool's name of 44 characters, a link of 50, a branch, an agent.
  const long = scene === "long", tool = "mcp__claude_ai_Google_Calendar__create_event", url = "https://github.com/example/land/issues/new?title=xy";
  const feat = (ref, status, title, over = {}) => ({ ref, kind: "feature", type: "increment", status, title, parent: null, release: "R2", ord: 1000, labels: [], progress: { checked: 4, total: 11 }, tasks: { done: 9, total: 14 }, open_since: null, archived_at: null, ...over });
  const features = {
    bobnet: [feat("BOB-121", "In Progress", "The dashboard, use case first", { release: "R3", open_since: iso(300) }), feat("BOB-9", "Ready", "Move Helix's board off Backlog.md into the service", { release: "R3" })],
    ...Object.fromEntries(projects.slice(2).map((p) => [p.key, []])),
    helix: [feat("LAND-50", "In Progress", "An agent proposes a change to a recorded lease", { open_since: iso(400) }), feat("LAND-38", "Ready", "Partner audit view of a tract's changes")],
  };
  if (["page", "nobody", "long"].includes(scene)) {
    const own = (checked, total) => ({ own: { checked, total } });
    features.helix = [feat("LAND-45", "Done", "Build and CI in R2: cheaper and safer, and how we work", { done_at: iso(2 * D) }), { ...features.helix[0], ...own(5, 11) }, { ...features.helix[1], ...own(0, 6) },
      feat("LAND-51", "Ready", "An audit trail on every record: who changed what, when, and why", own(0, 8)), feat("LAND-53", "Draft", "Undo a change within a day", own(0, 0)), feat("LAND-55", "Draft", "Rehearsal 3 pick-up: what Casper finds rehearsing the edit flow", own(0, 0))];
    features.bobnet = [feat("BOB-6", "Draft", "Start a session from the UI, as a request to poe", { release: "R3", ...own(0, 0) }), ...features.bobnet.map((f) => ({ ...f, release: "R4" }))];
  }
  const release = (ref, title, done, total) => ({ ref, title, goal: null, status: "open", ord: 1000, spec_url: null, closed_at: null, closed_by: null, features: { done, total }, backlog: { items: 2, bugs: 1, oldest: iso(6 * D) } });
  const run = (status, startMin, tookMin, sha, agent = null, over = {}) => ({ name: "ci", branch: "main", status, sha, url: `https://github.com/example/repo/actions/runs/${sha}`, started_at: iso(startMin), ended_at: tookMin === null ? null : iso(startMin - tookMin), agent, ...over });
  const passed = (n, from) => Array.from({ length: n }, (_, i) => run("passed", from + i * 180, 9, `${(0xa1b2c3 + i * 4097).toString(16)}d4`));
  const ci = {
    bobnet: [{ name: "test", usual_ms: 6 * 60_000, runs: [run("failed", 2 * H + 11, 6, "4be01c77aa", "Toad", { branch: "v2" }), ...passed(3, 5 * H), run("failed", 16 * H, 5, "77aa01bd2c"), run("cancelled", 20 * H, 2, "0c19dd27aa")] }],
    helix: [
      { name: "ci", usual_ms: 9 * 60_000, runs: [run("running", 4, null, "7c1e2a9d01", "Howard"), ...passed(5, 70)] },
      { name: "e2e", usual_ms: 14 * 60_000, runs: [run("passed", 66, 14, "57e7002bfa"), run("passed", 5 * H, 13, "a39bd05c11"), run("failed", 8 * H, 12, "99ac01dd20")] },
      { name: "nightly", runs: [run("cancelled", 7 * H, 3, "57e7002bfa")] },
      { name: "pages", runs: [run("queued", 0, null, "7c1e2a9d01", null, { started_at: null, url: null }), run("queued", 30, null, "57e7002bfa"), run("passed", 90, 2, "a39bd05c11")] },
    ],
  };
  if (long) Object.assign(ci.helix[0], { name: "release_and_publish_every_package_to_the_registry" }, { runs: [{ ...ci.helix[0].runs[0], agent: "TheLandServiceEndToEndEngineerOnTheNightShift" }, ...ci.helix[0].runs.slice(1)] });
  const overview = (p) => ({
    project: p, release: p.key === "helix" ? release("R2", "R2 Edit and audit", 1, 6) : release("R3", "R3 Vitals", 2, 9), release_number: p.key === "helix" ? 2 : 3,
    open: features[p.key].filter((x) => x.open_since), next_ready: features[p.key].find((x) => x.status === "Ready"), waits_on_you: p.key === "helix" ? "Q-261" : null, done_unclosed: p.key === "bobnet" ? [{ ref: "R1", title: "R1 Central backlog view" }] : [],
    backlog: { items: p.key === "helix" ? 9 : 12, bugs: 3, oldest: iso(14 * D) }, no_release: { items: 4, bugs: 1, oldest: iso(9 * D) }, ci: scene === "oldboard" ? undefined : ci[p.key],
  });
  const wait = (over) => ({ project: "helix", kind: "question", feature: null, context: null, recommended: null, holds: { items: [], sessions: [] }, waiting_sessions: [], needed_before: null, asked_by: "Bill@mbp-1", blocking: false, edits: [], stale: null, kept: null, fix: null, ...over });
  const howard = { feature: "LAND-50", kind: "build", label: "2" };
  const change = (field, old, nw) => ({ field, old, new: nw });
  const waits = [
    wait({ ref: "Q-261", feature: "LAND-50", text: "A lease change that touches two recorded tracts: one change set, or one for each tract? Howard's build needs it to write the migration.\nOne set keeps the audit trail whole; two can be taken back one by one.", recommended: { key: "one", text: "One change set, with each tract's part shown apart" }, context: "The recorder's office accepts a lease amendment as one instrument.\n\nTwo change sets would give two instrument numbers for one document, and the audit view would show half an amendment between them.", holds: { items: [], sessions: [howard] }, since: iso(3 * H + 10), blocking: true, asked_by: "Picard@mbp-1",
      edits: [{ seq: 2, at: iso(100), by: "Picard@mbp-1", reason: "Howard asked for the trade-off", changes: [change("text", "One change set or two?", "…")] }, { seq: 3, at: iso(90), by: "Picard@mbp-1", reason: null, changes: [change("options", "two", "one")] }] }),
    wait({ ref: "A-20", kind: "action", feature: "LAND-50", text: "Add the second company to the staging account in Clerk, so the e2e can switch between the two", holds: { items: ["LAND-50"], sessions: [] }, since: iso(4 * D + 30), blocking: true, asked_by: "Picard@mbp-1", stale: { changed_at: iso(2 * D + 60), owner: "Picard@mbp-1", flagged_at: iso(3 * H) }, needed_before: { release: "R2" } }),
    wait({ ref: "DRAFT-118", kind: "bug", text: "The map drops a tract's east line when its lease is edited twice in a minute", since: iso(D + 200), asked_by: null, fix: { sha: "57e7002bfa01", subject: "land: keep both lines", release: "v0.9", tags_known: true } }),
    wait({ ref: "DRAFT-119", kind: "bug", feature: "LAND-50", text: "Saving an edit on a phone loses the reason I typed when the keyboard closes", since: iso(20 * H), blocking: true, asked_by: null }),
    wait({ ref: "Q-14", project: "bobnet", feature: "BOB-121", text: "May a product owner create, edit, order, close and reopen its project's releases, with you keeping the same on the dashboard?", since: iso(26 * H), asked_by: "Peach@mbp-1", waiting_sessions: [{ feature: "BOB-121", kind: "review", label: "B" }] }),
    wait({ ref: "Q-240", text: "Does the partner demo show the audit trail, or only the proposed change?", recommended: { key: "both", text: "Both, the trail folded" }, since: iso(5 * H), kept: { at: iso(60), by: "Bill@mbp-1", reason: "still open until the demo's date is set" } }),
    wait({ ref: "A-9", project: "bobnet", kind: "action", text: "Where do Vitals' restart checks run from? Say which when it is done.", since: iso(8 * H), asked_by: "Peach@mbp-1" }),
    wait({ ref: "Q-243", text: "Keep the recorded instrument's scan beside the change, or only its number?", since: iso(40 * H), needed_before: { item: "LAND-38" }, stale: { changed_at: iso(40 * H), owner: "Bill@mbp-1", flagged_at: null } }),
  ];
  if (long) waits[0].edits.push({ seq: 4, at: iso(80), by: "Picard@mbp-1", reason: null, changes: [change("holds", "LAND-50-build-2-the-change-set-migration-and-its-audit-view", "LAND-50-build-3-the-change-set-migration-and-its-audit-view")] });
  const question = (ref) => {
    const w = waits.find((x) => x.ref === ref) ?? { text: ref, kind: "question", since: iso(60) };
    const options = {
      "Q-261": [{ key: "one", text: "One change set, with each tract's part shown apart", recommended: true }, { key: "two", text: long ? `Let it call ${tool} for each tract` : "One change set for each tract", recommended: false }, ...(long ? [{ key: "three", text: url, recommended: false }] : [])],
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
  if (long) asks.questions[0].options[1] = { label: tool, description: url };
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
  // mbp-1's supervisor started again 5 minutes ago: Howard stopped, and his request is what is left of it.
  if (scene === "orphan" || scene === "orphanolder") {
    mbp.snapshot.supervisor.started_at = iso(5);
    mbp.snapshot.workers = [worker("w_h", "Howard", "engineer", { state: "failed", ended_at: iso(5), task_refs: ["LAND-50.2"] }), worker("w_p", "Picard", "lead", { started_at: iso(4), calls: 12, context: 41_000 })];
    mbp.snapshot.pending = pending.slice(0, 1);
    if (scene === "orphanolder") delete mbp.snapshot.decided;
  }
  if (scene === "older") { delete mbp.snapshot.decided; mbp.snapshot.pending = mbp.snapshot.pending.map(({ ask, ...p }) => p); }
  const ubu = { laptop: "ubu1", at: iso(quiet ? 9 : 0.6), snapshot: snapshot({ supervisor: { started_at: iso(20 * H), concurrency: 2, active: 1, queued: 0 }, workers: [worker("w_t", "Toad", "architect", { project: "bobnet", session: "BOB-121 review B", started_at: iso(22), calls: 61, context: 77_000, tokens: { input: 90_000, output: 60_000, cache_read: 3_900_000, cache_write: 210_000 } })],
    pending: quiet ? [{ id: "r_8", worker_id: "w_t", name: "Toad", kind: "approval", tool: "Bash", tier: "human", created_at: iso(20), preview: "node bench.mjs" }] : [], board_outbox: quiet ? { count: 14, oldest_at: iso(11), code: "unavailable" } : { count: 0, oldest_at: null, code: null } }) };
  // Nobody runs in BobNet: Toad ended ten minutes ago, and Luigi is queued.
  if (scene === "nobody") ubu.snapshot.workers = [{ ...ubu.snapshot.workers[0], state: "done", ended_at: iso(10) }, worker("w_lq", "Luigi", "engineer", { project: "bobnet", state: "queued", started_at: null, session: null })];
  const peer = (name, laptop, online, over = {}) => ({ address: `${name}@${laptop}`, name, laptop, team: "bobnet", purpose: null, expertise: [], status: online ? (long ? `waiting on ${tool}${tool}` : "working") : null, online, last_seen: iso(online ? 0 : 200), connected_at: online ? iso(90) : null, client: { package: "@bobnet/supervisor", version: laptop === "ubu1" ? "2.0.0-rc.54" : "2.0.0-rc.55", protocol: 1 }, stats: { sent_24h: 12, received_24h: 31, inbox: 0 }, ...over });
  const peers = [peer("Mario", "mbp-1", true), peer("Peach", "mbp-1", false), peer("Toad", "ubu1", true), peer("Picard", "mbp-1", true, { team: "helix" }), peer("Howard", "mbp-1", true, { team: "helix", stats: { sent_24h: 4, received_24h: 9, inbox: 1 } }), peer("poe", "mbp-1", true, { team: "ops", client: { package: "@bobnet/client", version: "2.0.0-rc.55", protocol: 1 } })];
  const traffic = [[4, "Picard@mbp-1", "Howard@mbp-1"], [6, "Marvin@mbp-1", "Picard@mbp-1"], [11, "poe@mbp-1", "Mario@mbp-1"], [14, "Toad@ubu1", "Daisy@mbp-1"]].map(([m, from, to], i) => ({ id: `m_${i}`, type: "message", from, to: [to], urgent: false, at: iso(m) }));
  const dashboard = { now: new Date(now).toISOString(), peers, laptops: [mbp, ubu], boards: [], updates: [], traffic };

  const bl = (key) => Array.from({ length: key === "helix" ? 9 : 12 }, (_, i) => ({ ref: `DRAFT-${100 + i}`, kind: "backlog", type: i < 3 ? "bug" : ["task", "chore", "spike"][i % 3], status: null, title: ["The map drops a tract's east line when its lease is edited twice", "The audit view shows the proposer's id, not the name", "A retried import writes the instrument twice", "Export a tract's changes as a PDF for the partner", "Sort the lease list by its recorded date", "Say which account a change was made in", "A shortcut to the last tract looked at", "The e2e's seed takes four minutes", "Rename 'grantee' where the partner reads it", "One look for every empty page", "A run that ended while the laptop slept", "Keep the filter when the project changes"][i], description: null,
    release: i % 4 === 0 ? (key === "helix" ? "R2" : "R3") : null, labels: [], created_at: iso((14 - i) * D + 30), casper_words: i === 3 ? "the partner wants to take it to the bank" : null, parent_hint: null, blocks_use: i === 0, bug_where: null, found_in: null, archived_at: null }));
  const status = (p) => ({ project: p.key, name: p.name, waits: waits.filter((w) => w.project === p.key), stuck: { runs: [], ci: [], idle_sessions: [], idle_features: [], answered_holding: [], settled: [] }, recurring: null,
    done: { counts: { features: 1, sessions: 4, lands: 3, releases: 0 }, features: [], sessions: [], releases: [] }, backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false },
    usage: { tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, by_agent: [], heavy: [], lost: 0 }, more: {} });
  const rule = (agent, over = {}) => ({ project: "*", agent, laptop: "mbp-1", role: "backup", read: true, items: "none", fields: [], sessions: false, questions: false, admin: false, ...over });
  // Usage: each project's days, deterministic, the last one today's; a spike on two of them.
  const two = (n) => String(n).padStart(2, "0");
  const dayBack = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
  const row = (model, alias, input, cache_read) => ({ model, alias, input, output: input, cache_read, cache_write: input });
  const weights = { read_at: "2026-11-22", rows: [row("claude-sonnet-5-5", "sonnet", 1, 1), row("claude-opus-5-5", "opus", 2, 2), row("claude-haiku-5-5", "haiku", 0.05, 0.1), row("claude-fable-5-1", "fable", 5, 2.5), row("claude-fable-5-2", null, 4, 2), row("claude-opus-5", null, 2.5, 5), row("claude-sonnet-4-6", null, 1.5, 3), row("claude-haiku-4-5", null, 0.5, 1)] };
  const wave = (i, seed) => 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + seed)) - (i % 7 < 2 ? 0.3 : 0);
  const point = (key, back) => {
    const spike = (key === "bobnet" && back === 1) || (key === "helix" && back === 10);
    const base = { bobnet: 21e6, helix: 44e6 }[key] ?? 1.6e6, total = Math.round(base * (spike ? 3.1 : back === 0 ? 0.3 : wave(back, key.length)));
    const opus = Math.round(total * 0.82), haiku = Math.round(total * 0.004), unknown = key === "bobnet" && back % 9 === 2 ? Math.round(total * 0.14) : 0, sonnet = total - opus - haiku - unknown;
    const weighted = Math.round(2 * opus + sonnet + 0.1 * haiku + unknown), calls = key === "helix" && back === 10 ? 412 : Math.round(total / 130_000);
    const [lead, eng, arch] = key === "helix" ? ["lead", "engineer", "fixer"] : ["lead", "luigi", "toad"];
    const roles = [[eng, 212 / 412], [lead, 120 / 412], [arch, 80 / 412]].map(([role, f]) => ({ role, calls: Math.round(calls * f), raw: Math.round(total * f), weighted: Math.round(weighted * f) }));
    const ss = (feature, kind, label) => ({ feature, kind, label });
    const top = key === "helix" ? [[ss("LAND-49", "build", "2"), "Edit a recorded lease", 0.62], [ss("LAND-49", "review", "1"), "Edit a recorded lease", 0.2], [null, null, 0.11]] : [[ss("BOB-121", "build", "C"), "The dashboard, use case first", 0.55], [ss("BOB-121", "review", "C"), "The dashboard, use case first", 0.3], [ss("BOB-51", "build", "A"), "Permission messages whole", 0.1]];
    const raw = { input: Math.round(total * 0.02), output: Math.round(total * 0.03), cache_write: Math.round(total * 0.09), cache_read: 0 };
    raw.cache_read = total - raw.input - raw.output - raw.cache_write;
    return { raw, weighted, unknown, calls, by_model: [["claude-opus-5-5", opus, 2 * opus], ["claude-sonnet-5-5", sonnet, sonnet], ["claude-haiku-5-5", haiku, Math.round(haiku * 0.1)], ["unknown", unknown, unknown]].filter(([, r]) => r > 0).map(([model, r, w]) => ({ model, raw: r, weighted: w })), by_role: roles, top: top.map(([session, feature_title, f]) => ({ session, feature_title, raw: Math.round(total * f), weighted: Math.round(weighted * f) })) };
  };
  const usageSeries = (p, n) => ({ project: p.key, name: p.name, lost: p.key === "bobnet" ? 1 : 0, points: Array.from({ length: n }, (_, i) => point(p.key, n - 1 - i)) });
  const usageDays = (n) => Array.from({ length: n }, (_, i) => dayBack(n - 1 - i));
  // A day's detail: its runs by start, each from a small context up, and the period's medians.
  const climb = (n, from, to, seed) => Array.from({ length: n }, (_, i) => Math.round(from + (to - from) * Math.sqrt(i / n) + 4000 * Math.sin(i / 3 + seed)));
  const dayOfUsage = (op) => {
    const roles = op.project === "helix" ? ["lead", "engineer", "fixer"] : ["lead", "luigi", "toad"];
    const mk = (id, role, n, from, to, start) => ({ id, agent: role === "luigi" ? "Luigi" : role, role, session: null, model: "opus", started_at: `${op.day}T0${start}:00:00.000Z`, ended_at: `${op.day}T0${start + 1}:00:00.000Z`, resumed: false, first: 1, ctx: { calls: n, pts: climb(n, from, to, start) } });
    const runs = [mk("d1", roles[0], 60, 30_000, 120_000, 1), mk("d2", roles[1], 150, 28_000, 190_000, 2), mk("d3", roles[1], 62, 30_000, 110_000, 4), mk("d4", roles[2], 80, 25_000, 90_000, 5), mk("d5", roles[0], 60, 32_000, 100_000, 7)];
    let t = 0;
    const line = (pts) => ({ calls: pts.length, pts });
    const band = (n, k) => line(climb(n, 26_000 * k, 130_000 * k, 1));
    return { project: op.project, day: op.day, days: usageDays(op.days), runs, lost: op.project === "bobnet" ? 1 : 0,
      baseline: { total: { days: op.days - 3, calls: 286, p50: line(climb(286, 28_000, 110_000, 2).map((v) => (t += v))) }, roles: roles.map((role, i) => ({ role, runs: 20 - 9 * i, calls: [60, 120, 40][i], p25: i === 2 ? line([]) : band(120, 0.75), p50: i === 2 ? line([]) : band(120, 1), p75: i === 2 ? line([]) : band(120, 1.3) })) } };
  };
  // A project's page: Helix with agents running, BobNet with nobody in a quiet office (scene "nobody").
  const tokn = (n) => ({ input: Math.round(n * 0.02), output: Math.round(n * 0.03), cache_write: Math.round(n * 0.09), cache_read: n - Math.round(n * 0.02) - Math.round(n * 0.03) - Math.round(n * 0.09) });
  const prun = (id, agent, role, model, effort, m, from, took, over = {}) => ({ id, agent, role, laptop: "mbp-1", model, effort, started_at: iso(from), ended_at: took === null ? null : iso(from - took), tokens: tokn(took === null ? 0 : m * 1e6), weighted: Math.round((took === null ? 0 : m) * 1e6 * ({ opus: 2, sonnet: 1, haiku: 0.1 }[model] ?? 1)), calls: 40, outcome: took === null ? null : "done", outcome_reason: null, ...over });
  const psess = (feature, kind, label, title, from, took, close, runs) => ({ session: { feature, kind, label }, feature_title: title, started_at: iso(from), ended_at: took === null ? null : iso(from - took), close: close && { need: close[0], summary: close[1], blockers: 0, majors: close[2] ?? 0, sent_back: close[3] ?? 0 },
    tokens: runs.reduce((t, r) => Object.fromEntries(Object.keys(t).map((k) => [k, t[k] + r.tokens[k]])), tokn(0)), weighted: runs.reduce((n, r) => n + r.weighted, 0), unknown: 0, lost: runs.filter((r) => r.outcome === "lost").length, runs });
  const lateSessions = {
    helix: [
      psess("LAND-50", "build", "2", "A person edits a recorded tract: the edit is proposed, approved and audited", 300, null, null, [prun("w_p", "Picard", "lead", "opus", "high", 0, 290, null), prun("w_h", "Howard", "engineer", "opus", "high", 0, 120, null), prun("w_m", "Marvin", "qa", "sonnet", "medium", 0, 60, null), prun("w_h0", "Howard", "engineer", "opus", "high", 8.3, 280, 120)]),
      psess("LAND-50", "review", "1", "A person edits a recorded tract: the edit is proposed, approved and audited", 500, 110, ["answer", "Two majors: an edit under review is lost; the audit row misses the reason. Sent back to a Fixes build.", 2, 2], [prun("r1", "Bill", "reviewer", "sonnet", "high", 3.3, 500, 100), prun("r2", "Calvin", "qa", "sonnet", "medium", 2.1, 490, 90)]),
      psess("LAND-50", "build", "1", "A person edits a recorded tract: the edit is proposed, approved and audited", 3000, 480, ["none", "Propose an edit; the change set holds it."], [prun("b1", "Howard", "engineer", "opus", "high", 21.5, 3000, 470), prun("b2", "Bender", "devops", "haiku", "low", 0.3, 2900, 20, { outcome: "failed", outcome_reason: "land refused: CI red on main" })]),
      psess("LAND-50", "design", "A", "A person edits a recorded tract: the edit is proposed, approved and audited", 4400, 360, ["casper", "Spec and prototype of the edit flow; Casper accepted it (Q-255)."], [prun("d1", "Riker", "designer", "opus", "high", 5.2, 4400, 300), prun("d2", "Data", "architect", "fable", "high", 9.8, 4390, 300, { outcome: "stopped", outcome_reason: "by Picard" })]),
    ],
    bobnet: [
      psess("BOB-121", "design", "A", "The dashboard, use case first", 120, null, null, [prun("t1", "Toad", "architect", "opus", "high", 2.6, 118, 60), prun("t2", "Daisy", "designer", "opus", "high", 6.1, 110, 90)]),
      psess("BOB-48", "review", "A", "A laptop that stops reporting says so, everywhere it matters", 4600, 120, ["none", "Quiet-laptop banners reviewed on phone and desktop; no findings."], [prun("q1", "Daisy", "designer", "opus", "high", 1.8, 4600, 110), prun("q2", "Toad", "architect", "opus", "high", 0, 4590, 30, { laptop: "ubu1", outcome: "lost", outcome_reason: "ubu1 restarted mid-run" })]),
      psess("BOB-48", "build", "A", "A laptop that stops reporting says so, everywhere it matters", 5200, 360, ["none", "Banners on Overview and Waits; the laptop card on Sessions."], [prun("q3", "Luigi", "engineer", null, null, 12.4, 5200, 350)]),
    ],
  };
  const projectPage = (p) => {
    const helix = p.key === "helix", sp = features[p.key];
    return { project: p, release: helix ? { ...release("R2", "R2 Edit and audit", 1, 6), number: 2 } : { ...release("R3", "R3 Vitals", 0, 1), number: 3 }, done_unclosed: helix ? [] : [{ ref: "R1", title: "R1 Central backlog view" }], waits: [],
      backlog: { ready: helix ? [{ ref: "LAND-38", title: "x", release: "R2", criteria: 6 }, { ref: "LAND-51", title: "x", release: "R2", criteria: 8 }] : [], sessions_estimate: null, no_criteria: sp.filter((f) => f.status === "Draft").map((f) => ({ ref: f.ref, title: f.title })), triage: { count: helix ? 9 : 12, oldest: { ref: "DRAFT-100", at: iso(14 * D) } }, release: helix ? { ref: "R2", todo: 5, ready: 2 } : { ref: "R3", todo: 1, ready: 0 }, thin: !helix },
      ci: ci[p.key] ?? [], sessions: lateSessions[p.key] ?? [], other_runs: helix ? [] : [prun("c1", "Peach", "product", "opus", "high", 1.1, 900, 20), prun("c2", "Toad", "architect", "sonnet", "medium", 0.4, 800, 10)], usage: {}, more: {} };
  };
  const answer = (op) => {
    switch (op.op) {
      case "project": return projectPage(projects.find((p) => p.key === op.project));
      case "usage_day": return dayOfUsage(op);
      case "usage": return { weights, tz: op.tz, days: usageDays(op.days), projects: projects.filter((p) => !op.project || p.key === op.project).map((p) => usageSeries(p, op.days)) };
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

  const fails = (op) => (scene === "down" ? true : scene === "listdown" ? op.op === "projects" : scene === "failday" ? op.op === "usage_day" : scene === "failpage" || scene === "forbidden" ? op.op === "project" : false);
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
      if (f.t === "board_op" && !(scene === "noday" && f.op.op === "usage_day")) setTimeout(() => this.frame(fails(f.op) ? { t: "error", rid: f.rid, code: "unavailable", message: "The board's database isn't answering." } : { t: "ok", rid: f.rid, result: answer(f.op) }), 30);
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

// 768, a tablet held upright, only for the scenes that name it.
const widths = { 390: [390, 844], 768: [768, 1024], 1024: [1024, 768], 1440: [1440, 900] };
const agent = (name) => (p) => p.locator("#working .a-line", { hasText: name }).first().locator(".a-btn").click();
const tap = (ref) => (p) => p.locator(`li[data-ref="${ref}"] .l-t`).click();
const back = (n) => { const d = new Date(), two = (x) => String(x).padStart(2, "0"); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const bar = (key, n) => (p) => p.locator(`.ucard[data-project="${key}"] .bar[data-day="${back(n)}"]`).click();
const byAgent = (p) => p.getByRole("button", { name: "By agent", exact: true }).click();
const weigh = (p) => p.getByRole("button", { name: "Sonnet-equivalent", exact: true }).click();
const answer = (ref) => (p) => p.locator(`li[data-ref="${ref}"] .answer-btn`).click();
// [name, scene, hash, selector to wait for, steps, element to shoot (none: the whole page; "top": the window), widths (none: all)]
const all = [
  ["bob121-header", "live", "overview", ".prow", [], "header"],
  ["bob121-header-quiet", "quiet", "overview", ".prow", [], "header"],
  ["bob121-header-feature", "live", "feature/helix/LAND-50", "#feature-head", [], "top"],
  ["bob121-header-usage", "live", "usage", ".ugrid", [], "top"],
  ["bob121-triage-bobnet", "live", "triage/bobnet", ".totals", []],
  ["bob121-triage-helix", "live", "triage/helix", ".totals", []],
  ["bob121-laptops", "live", "laptops", "#global-rules", []],
  ["bob121-laptops-quiet", "quiet", "laptops", "#global-rules", [(p) => p.locator("details.msgs summary").click()]],
  ["bob121-needs", "live", "needs", "#needs-rest li", []],
  ["bob121-needs-dark", "live", "needs", "#needs-rest li", [tap("Q-261"), tap("r_5")], null, [390, 1440]],
  ["bob121-needs-open", "live", "needs", "#needs-rest li", [tap("Q-261"), (p) => p.locator('li[data-ref="Q-261"] .edits summary').click(), (p) => p.locator('li[data-ref="Q-261"] .ctx-row button').click(), tap("r_5")]],
  ["bob121-needs-allow-note", "live", "needs", "#needs-rest li", [answer("r_5"), (p) => p.fill("form.answer textarea", "Fine. Keep the stash; clear only the tile cache.")]],
  ["bob121-needs-allow-toast", "live", "needs", "#needs-rest li", [answer("r_5"), (p) => p.fill("form.answer textarea", "Fine. Keep the stash."), (p) => p.getByRole("button", { name: "Allow", exact: true }).click(), (p) => p.waitForTimeout(200)], "#toast", [390, 1440]],
  ["bob121-needs-older", "older", "needs", "#needs-rest li", [answer("r_5")], null, [390, 1440]],
  ["bob121-needs-action-options", "live", "needs", "#needs-rest li", [answer("A-9")], "#needs-rest"],
  ["bob121-needs-quiet", "quiet", "needs", "#needs-rest li", [], null, [390, 1440]],
  ["bob121-needs-down", "down", "needs", ".banner.down", [], null, [390, 1440]],
  ["bob121-needs-listdown", "listdown", "needs", ".banner.down", [], null, [390, 1440]],
  ["bob121-needs-long", "long", "needs", "#needs-rest li", [answer("Q-261"), (p) => p.locator('li[data-ref="Q-261"] .edits summary').click()], '#needs-holding li[data-ref="Q-261"]'],
  ["bob121-needs-many", "many", "needs", "#needs-rest li", [], "top"],
  ["bob121-needs-orphan", "orphan", "needs", "#needs-rest li", [answer("r_5")]],
  ["bob121-needs-orphan-older", "orphanolder", "needs", "#needs-rest li", [answer("r_5")], '[data-ref="r_5"]', [390, 1440]],
  ["bob121-needs-orphan-toast", "orphan", "needs", "#needs-rest li", [answer("r_5"), (p) => p.fill("form.answer textarea", "Fine. Keep the stash."), (p) => p.getByRole("button", { name: "Allow", exact: true }).click(), (p) => p.waitForTimeout(200)], "#toast", [390, 1440]],
  ["bob121-overview-orphan", "orphan", "overview", ".prow", [], null, [390, 1440]],
  ["bob121-overview-long", "long", "overview", ".prow", [agent("Marvin"), (p) => p.locator(".ask-more").click()], ".ov-side"],
  ["bob121-laptops-long", "long", "laptops", "#global-rules", [], "#agents"],
  ["bob121-triage-many", "many", "triage/bobnet", ".totals", [], "top"],
  ["bob121-overview", "live", "overview", ".prow", []],
  ["bob121-overview-tablet", "live", "overview", ".prow", [], "top", [768]],
  ["bob121-header-tablet", "quiet", "needs", "#needs-rest li", [], "top", [768]],
  ["bob121-overview-dark", "page", "overview", ".prow", [], null, [390, 1440]],
  ["bob121-overview-nobody", "nobody", "overview", ".prow", [agent("Howard")], null, [390, 1024, 1440]],
  ["bob121-overview-tap", "live", "overview", ".prow", [tap("Q-243")], ".ov-needs", [390, 1440]],
  ["bob121-overview-quiet", "quiet", "overview", ".prow", [], null, [390, 1440]],
  ["bob121-overview-nothing", "nothing", "overview", ".prow", [], null, [390, 1440]],
  ["bob121-overview-down", "down", "overview", ".banner.down", [], null, [390, 1440]],
  ["bob121-overview-listdown", "listdown", "overview", ".banner.down", [], null, [390, 1440]],
  ["bob121-ask-folded", "live", "overview", ".prow", [agent("Marvin")], ".ov-now", [390, 1440]],
  ["bob121-ask-open", "live", "overview", ".prow", [agent("Marvin"), (p) => p.locator(".ask-more").click()]],
  ["bob121-ask-open-dark", "live", "overview", ".prow", [agent("Marvin"), (p) => p.locator(".ask-more").click()], ".ov-now", [390, 1440]],
  ["bob121-ask-human", "live", "overview", ".prow", [agent("Howard")], ".ov-now", [390, 1440]],
  ["bob121-ask-older", "older", "overview", ".prow", [agent("Marvin")], ".ov-now", [390, 1440]],
  ["bob121-ci", "live", "overview", "#ci li", [], ".ov-ci"],
  ["bob121-ci-dark", "live", "overview", "#ci li", [], ".ov-ci", [390, 1440]],
  ["bob121-usage-raw", "live", "usage", ".ugrid", []],
  ["bob121-usage-weighted-day", "live", "usage", ".ugrid", [weigh, (p) => p.locator(".factored summary").click(), bar("helix", 10)]],
  ["bob121-day-total", "live", "usage", ".ugrid", [bar("helix", 10)]],
  ["bob121-day-agent", "live", "usage", ".ugrid", [bar("helix", 10), byAgent, (p) => p.locator(".ud-roles button").first().click(), (p) => p.locator(".ud svg").first().press("ArrowLeft")]],
  ["bob121-day-agent-nobase", "live", "usage", ".ugrid", [bar("helix", 10), byAgent, (p) => p.locator(".ud-roles button").last().click()], ".ucard[data-project=helix]", [390, 1440]],
  ["bob121-day-today-weighted", "live", "usage", ".ugrid", [weigh, bar("bobnet", 0)], ".ucard[data-project=bobnet]", [390, 1440]],
  ["bob121-day-dark", "live", "usage", ".ugrid", [bar("helix", 10), byAgent], ".ucard[data-project=helix]", [390, 1440]],
  ["bob121-day-loading", "noday", "usage", ".ugrid", [bar("helix", 10)], ".ucard[data-project=helix]", [390, 1024]],
  ["bob121-day-failed", "failday", "usage", ".ugrid", [bar("helix", 10)], ".ucard[data-project=helix]", [390, 1440]],
  ["bob121-project-helix", "page", "project/helix", ".lately", []],
  ["bob121-project-helix-weighed", "page", "project/helix", ".lately", [weigh, (p) => p.locator(".puse .bar").nth(8).click()], ".pside", [390, 1440]],
  ["bob121-project-helix-open", "page", "project/helix", ".lately", [(p) => p.locator(".prun .a-line", { hasText: "Marvin" }).locator(".a-btn").click(), (p) => p.locator(".pwaits .l-t").first().click()], null, [390, 1440]],
  ["bob121-project-bobnet", "nobody", "project/bobnet", ".lately", [(p) => p.locator(".others summary").click()]],
  ["bob121-project-dark", "page", "project/helix", ".lately", [], null, [390, 1440]],
  ["bob121-project-failed", "failpage", "project/bobnet", ".banner.down", [], null, [390, 1440]],
  ["bob121-project-forbidden", "forbidden", "project/secret", ".banner.down", [], null, [390]],
  ["bob121-project-long", "long", "project/helix", ".lately", []],
  ["bob121-usage-dark", "live", "usage", ".ugrid", [bar("bobnet", 0)], null, [390, 1440]],
  ["bob121-usage-many", "many", "usage", ".ugrid", [], null, [390, 1024]],
  ["bob121-usage-down", "down", "usage", ".banner.down", [], null, [390]],
  ["bob121-status-needs", "live", "status", "#status-needs li", [], "#status-needs", [390, 1440]],
  ["bob121-status-tap", "live", "status", "#status-needs li", [tap("Q-261"), tap("DRAFT-119")], "#status-needs", [390, 1440]],
];

const shots = all.filter(([name]) => name.startsWith(process.argv[2] ?? ""));
const taps = new Map();
const browser = await chromium.launch();
try {
  for (const [name, scene, hash, wait, steps, el, only] of shots) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      if (only ? !only.includes(Number(w)) : w === "768") continue;
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
      // The viewport's own width: on a phone (isMobile) innerWidth grows with a page that is too wide.
      const over = (await page.evaluate(() => document.documentElement.scrollWidth)) - width;
      if (over > 0) console.log(`${name}-${w}: ${over} px wider than its viewport`);
      const overlaps = await page.evaluate(() => [...document.querySelectorAll(".ci-row")].flatMap((row) => {
        const boxes = [...row.children].map((c) => { const r = document.createRange(); r.selectNodeContents(c); return { c, b: c.querySelector("i, a") || !c.textContent ? c.getBoundingClientRect() : r.getBoundingClientRect() }; }).filter((x) => x.b.width);
        return boxes.flatMap((x, i) => boxes.slice(i + 1).filter((y) => x.b.right > y.b.left + 1 && y.b.right > x.b.left + 1 && x.b.bottom > y.b.top + 1 && y.b.bottom > x.b.top + 1).map((y) => `${x.c.className} over ${y.c.className}`));
      }));
      if (overlaps.length) console.log(`${name}-${w}: CI ${[...new Set(overlaps)].join(", ")}`);
      if (w === "390") {
        const small = await page.evaluate(() => [...document.querySelectorAll("a, button, summary, [role=button]")].filter((el) => { const b = el.getBoundingClientRect(); return b.height > 0 && b.height < 43.5; })
          .map((el) => `${el.textContent.trim().slice(0, 28)} (${el.className || el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().height)})`));
        for (const t of small) taps.set(t, [...(taps.get(t) ?? []), name]);
      }
      // A full page reads top to bottom: the header not stuck mid-page, the toast left out.
      await page.addStyleTag({ content: `header { position: static !important; } ${name.includes("toast") ? "" : "#toast { display: none !important; }"}` });
      const path = join(out, `${name}-${w}.png`);
      if (el === "top") await page.screenshot({ path });
      else if (el) await page.locator(el).first().screenshot({ path });
      else await page.screenshot({ path, fullPage: true });
      await page.close();
    }
  }
  console.log(`Under 44 px at 390:\n${[...taps].map(([t, names]) => `  ${t}: ${names.length === 1 ? names[0] : `${names.length} scenes`}`).join("\n")}`);
} finally {
  await browser.close();
  server.close();
}
