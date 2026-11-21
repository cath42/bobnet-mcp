// Screenshots of the Status tab (BOB-33, design/BOB-33/spec.md "Which shot shows what") at phone, tablet and desktop
// widths, against a fake broker in the page answering the status read with a sample shaped like BobNet's and Helix's
// boards (design/BOB-33/prototype/data.js). This build is BOB-33 only: no lead's note, Recurring "Comes with theme tags".
//   node test-ui/shots-bob33.mjs [prefix]   (from packages/broker; writes test-ui/shots/bob33-*.png, and bob44-status-*.png)
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

/** Runs in the page: a broker that answers the dashboard and the board's reads from memory. */
function fakeBroker() {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
  const tk = (n) => ({ input: Math.round(n * 0.02), output: Math.round(n * 0.03), cache_read: Math.round(n * 0.9), cache_write: Math.round(n * 0.05) });
  const zero = tk(0);
  const ss = (feature, kind, label) => ({ feature, kind, label });
  const projects = [
    { key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] },
    { key: "helix", name: "Helix", prefix: "LAND", draft_prefix: null, lead: "Bob@mbp-1", po: "Picard@mbp-1", repos: [] },
  ];
  const wait = (project, kind, ref, feature, text, blocking, minAgo, over = {}) => ({
    project, kind, ref, feature, text, recommended: null, context: null, holds: { items: blocking && kind !== "bug" ? [feature] : [], sessions: [] }, waiting_sessions: [], needed_before: null,
    asked_by: "Bob@mbp-1", since: iso(minAgo), blocking, ...over,
  });
  const waits = {
    bobnet: [
      wait("bobnet", "question", "Q-6", "BOB-9", "Picard's date for moving Helix's board isn't set. Keep BOB-9 in R1, or move it to R2?", false, 2900),
      wait("bobnet", "review_gate", "BOB-31", "BOB-31", "Accept the build of BOB-31: a cut question opens in place", true, 74),
    ],
    helix: [
      wait("helix", "action", "A-17", "LAND-52", "Sign the Mapbox terms for the commercial plan on the company account", false, 4400),
      wait("helix", "question", "Q-258", "LAND-49", "How does staging get an account with two companies for the second rehearsal?", true, 1500, { holds: { items: ["LAND-49.19"], sessions: [] } }),
    ],
  };
  const session = (feature, kind, label, minAgo, closed_by, tokens, summary, over = {}) => ({
    session: ss(feature, kind, label), ended_at: iso(minAgo), need: "none", summary, closed_by, tokens: tk(tokens), lost: 0, counts: { blockers: 0, majors: 0, sent_back: 0 }, ...over,
  });
  const helixSessions = [
    session("LAND-49", "review", "3", 95, "Picard@mbp-1", 9_800_000, "Two majors. Sent back 49.17 (third time) and 49.21. Waits on Q-258 for the second company.", { need: "answer", counts: { blockers: 0, majors: 2, sent_back: 2 } }),
    session("LAND-49", "build", "Fixes 2", 212, "Picard@mbp-1", 14_200_000, "Fixed 17 of Review 2's 20 tasks. 49.17 (tiles on a cold start) and 49.21 are left.", { lost: 1 }),
    session("LAND-52", "review", "1", 300, "Picard@mbp-1", 3_400_000, "Signed off: the demo account resets cleanly. Deploy window open."),
    session("LAND-52", "build", "2", 410, "Picard@mbp-1", 11_600_000, "The demo account resets in one step; the rehearsal script reads the reset account's name."),
  ];
  const olderHelix = [
    session("LAND-52", "build", "1", 1000, "Picard@mbp-1", 9_100_000, "First cut of the one-step reset; the script still names the old account."),
    session("LAND-49", "review", "2", 1300, "Picard@mbp-1", 4_000_000, "Twenty findings, three majors; sent back for Fixes 2."),
    session("LAND-49", "build", "Fixes 1", 2600, "Picard@mbp-1", 8_800_000, "The map tiles load on a warm cache; cold start still slow."),
  ];
  const bobnetSessions = [
    session("BOB-31", "build", "a", 80, "Mario@mbp-1", 6_200_000, "A cut question opens in place on the dashboard; shots at three widths."),
    session("BOB-30", "review", "1", 160, "Mario@mbp-1", 2_100_000, "Signed off for rc.36: push after each commit, a failed push warns."),
    session("BOB-30", "build", "a", 260, "Mario@mbp-1", 7_300_000, "The nightly backup pushes board.json to its remote."),
    session("BOB-27", "build", "fix", 330, "Mario@mbp-1", 1_900_000, "Waits no longer shows a closed bug as stale."),
    session("BOB-33", "design", "1", 380, "Mario@mbp-1", 5_400_000, "Prototype and spec for the Status tab; Casper accepted the twelve choices."),
    session("BOB-33", "design", "spec", 395, "Mario@mbp-1", 2_800_000, "Spec agrees with ADR 0005's amendments."),
    session("BOB-33", "review", "adr", 405, "Mario@mbp-1", 1_200_000, "ADR 0005 accepted with rulings."),
  ];
  const usage = (by, lost, heavy) => ({ tokens: by.reduce((t, a) => ({ input: t.input + a.tokens.input, output: t.output + a.tokens.output, cache_read: t.cache_read + a.tokens.cache_read, cache_write: t.cache_write + a.tokens.cache_write }), zero), by_agent: by, heavy, lost });
  const agent = (name, role, n, runs, lost = 0) => ({ agent: name, role, tokens: tk(n), runs, lost });

  function row(key, since) {
    const quiet = Date.parse(since) > now - 5 * 60_000;
    const within = (list, at) => list.filter((x) => at(x) >= since);
    const helix = key === "helix";
    const sessions = quiet ? [] : within(helix ? [...helixSessions, ...olderHelix] : bobnetSessions, (s) => s.ended_at);
    const stuckRuns = helix ? [{ id: "w_ma", agent: "Marvin", role: "tester", session: ss("LAND-49", "build", "Fixes 2"), outcome: "lost", reason: "supervisor restarted", ended_at: iso(250), ...(window.BOB44 ? { laptop: "ubu1" } : {}) },
      // BOB-44: a run on another laptop, and one from a broker before the field (no laptop).
      ...(window.BOB44 ? [{ id: "w_ho9", agent: "Howard", role: "engineer", session: ss("LAND-49", "build", "Fixes 2"), outcome: "failed", reason: "pnpm test exited 1", ended_at: iso(230), laptop: "mbp-1" },
        { id: "w_bi9", agent: "Bill", role: "reviewer", session: ss("LAND-52", "review", "1"), outcome: "stopped", reason: "stopped by Casper", ended_at: iso(240) }] : [])] : [];
    return {
      project: key, name: helix ? "Helix" : "BobNet", note: null, recurring: null,
      waits: waits[key],
      done: {
        counts: { features: quiet ? 0 : 1, sessions: sessions.length, lands: quiet ? 0 : helix ? 3 : 6, releases: !quiet && !helix ? 1 : 0 },
        features: quiet ? [] : helix ? [{ ref: "LAND-52", title: "Rehearsal 2 pick-up: the demo account resets in one step", type: "increment", release: "R1", at: iso(298) }]
          : [{ ref: "BOB-27", title: "Waits shows a closed bug as stale", type: "bug", release: "R1", at: iso(330) }],
        sessions,
        releases: !quiet && !helix ? [{ ref: "R1", title: "R1 Central backlog view", closed_at: iso(120) }] : [],
      },
      stuck: {
        runs: stuckRuns,
        ci: helix ? [
          { source: "slot", name: "land", branch: null, sha: null, url: null, worker: "w_ma2", session: ss("LAND-49", "build", "Fixes 2"), ended_at: iso(77) },
          { source: "github-actions", name: "e2e", branch: "v2", sha: "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e", url: "https://github.com/cath42/helix/actions/runs/1", worker: "w_ho", session: null, ended_at: iso(134) },
        ] : [],
        idle_sessions: helix ? [{ session: ss("LAND-45", "build", "1"), since: iso(282) }] : [],
        idle_features: [],
        answered_holding: helix ? [] : [{ ref: "Q-5", answered_at: iso(500), feature: "BOB-9" }],
        settled: quiet ? [] : helix ? [
          { kind: "ci", entry: { source: "github-actions", name: "test", branch: "v2", sha: null, url: null, worker: null, session: null, ended_at: iso(300) }, settled_at: iso(260) },
          { kind: "runs", entry: { id: "w_ho1", agent: "Howard", role: "engineer", session: ss("LAND-52", "build", "2"), outcome: "failed", reason: "pnpm test exited 1", ended_at: iso(420) }, settled_at: iso(415) },
        ] : [],
      },
      backlog: helix
        ? { ready: [{ ref: "LAND-49", title: "Fixes", release: "R1", criteria: 20 }], sessions_estimate: 2, no_criteria: [{ ref: "LAND-42", title: "Demo polish: what the demo shows reads right" }, { ref: "LAND-45", title: "Build and CI in R2: cheaper and safer" }],
            triage: { count: 103, oldest: { ref: "LAND-58", at: iso(19 * 1440) } }, release: { ref: "R1", todo: 2, ready: 1 }, thin: true }
        : { ready: [{ ref: "BOB-9", title: "Move Helix's board", release: "R2", criteria: 8 }, { ref: "BOB-35", title: "Theme tags", release: "R2", criteria: 5 }], sessions_estimate: 6, no_criteria: [],
            triage: { count: 20, oldest: { ref: "BOB-11", at: iso(2 * 1440) } }, release: { ref: "R2", todo: 4, ready: 0 }, thin: false },
      usage: quiet ? usage([], 0, []) : helix
        ? usage([agent("Howard", "engineer", 25_800_000, 4), agent("Bob", "lead", 11_300_000, 2), agent("Bill", "reviewer", 9_800_000, 1), agent("Bender", "reviewer", 3_400_000, 1), agent("Marvin", "tester", 0, 1, 1)], 1,
          [{ session: ss("LAND-49", "review", "3"), tokens: tk(9_800_000), usual: tk(3_700_000) }])
        : usage([agent("Luigi", "engineer", 14_000_000, 3), agent("Daisy", "designer", 8_200_000, 2), agent("Mario", "lead", 9_600_000, 1), agent("Toad", "architect", 5_000_000, 2)], 0, []),
      more: {},
    };
  }
  const status = (since) => {
    const at = new Date(now).toISOString();
    const used = new Date(Math.max(Date.parse(since), now - 31 * 86_400_000)).toISOString();
    return { at, since: used, projects: projects.map((p) => row(p.key, used)) };
  };
  const overviewRow = (p) => ({ project: p, release: null, release_number: null, open: [], next_ready: null, waits_on_you: null, backlog: { items: 0, bugs: 0, oldest: null } });
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "overview": return { projects: projects.map(overviewRow) };
      case "waits": return { waits: [...waits.bobnet, ...waits.helix].sort((a, b) => a.since.localeCompare(b.since)), answered: [] };
      case "status": return status(op.since);
      default: return { ref: null, seq: 1 };
    }
  };
  const worker = (id, name, project, role, session, tokens, state = "running") => ({ id, name, project, role, state, task: session ?? role, model: "opus", effort: "high", checkpoint: null,
    started_at: iso(40), ended_at: null, last_event_at: iso(0), tokens, session, task_ref: null, calls: 80, context: 90000, ctx: [] });
  const workersNow = [
    worker("w_ho", "Howard", "helix", "engineer", "LAND-49 build Fixes 3", 600_000, "waiting-approval"),
    worker("w_bo", "Bob", "helix", "lead", null, 7_400_000),
    worker("w_ma2", "Marvin", "helix", "tester", "LAND-49 build Fixes 3", 2_200_000),
    worker("w_m", "Mario", "bobnet", "lead", null, 5_600_000),
  ];
  const pending = [{ id: "r_5", worker_id: "w_ho", name: "Howard", kind: "approval", tool: "Bash", tier: "human", created_at: iso(6), preview: "put the rotated tile key from the team vault into the e2e config" }];
  const dashboard = { now: new Date(now).toISOString(), peers: [], laptops: [{ laptop: "mbp-1", at: iso(0), snapshot: { supervisor: { started_at: iso(600), concurrency: 3, active: 3, queued: 0 }, workers: workersNow, pending, usage: [] } }], boards: [], updates: [], traffic: [] };

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
const openAll = (p) => p.evaluate(() => document.querySelectorAll("details.sec").forEach((d) => (d.open = true)));
// [name, hash, steps, full page, first visit, colour scheme, widths]
const all = [
  ["bob33-s1-status-top", "status", [], false],
  ["bob33-s1-status", "status", [], true],
  ["bob33-s1-status-dark", "status", [], true, false, "dark"],
  ["bob33-s2-helix", "status/helix", [], true],
  ["bob33-s2-helix-dark", "status/helix", [], true, false, "dark"],
  ["bob33-s2-helix-open", "status/helix", [openAll], true, false, "light", ["390"]],
  ["bob33-s3-bobnet", "status/bobnet", [], true],
  ["bob33-s4-week", "status/helix", [(p) => p.getByRole("button", { name: "A week" }).click(), openAll], true],
  ["bob33-s5-caught-up", "status", [(p) => p.getByRole("button", { name: "I'm caught up" }).last().click(), (p) => p.waitForTimeout(400)], false],
  ["bob33-s6-first-visit", "status", [], false, true],
  ["bob33-s7-overview-line", "overview", [], false],
  ["bob33-s8-bob33-only", "status/helix", [], true],
  // BOB-44: a stuck run shows the laptop it ran on (design/BOB-44/laptop-mark.md, Status).
  ["bob44-status-stuck", "status/helix", [(p) => p.evaluate(() => { document.getElementById("sec-stuck").open = true; }), (p) => p.locator("#sec-stuck").scrollIntoViewIfNeeded()], false, false, "light", ["390", "1440"]],
];

const shots = all.filter(([name]) => name.startsWith(process.argv[2] ?? ""));
const browser = await chromium.launch();
try {
  for (const [name, hash, steps, full, first, scheme, only] of shots) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      if (only && !only.includes(w)) continue;
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme ?? "light" });
      // This device's last visit, 7 h ago (Sun 23:10 in the prototype); none on a first visit.
      if (!first) await page.addInitScript(() => localStorage.setItem("bobnet.status.lastVisit", new Date(Date.now() - 7 * 3600_000).toISOString()));
      if (name.startsWith("bob44")) await page.addInitScript(() => (window.BOB44 = true));
      await page.addInitScript(fakeBroker);
      await page.goto(`${base}#${hash}`);
      await page.waitForSelector(hash.startsWith("overview") ? ".st-line" : hash.includes("/") ? ".secs" : ".pcards");
      for (const step of steps) {
        await step(page);
        await page.waitForTimeout(400);
      }
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
