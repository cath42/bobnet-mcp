// Screenshots of how flagged rows read on Waits on you and Needs you (BOB-49, design/BOB-49/spec.md) at phone and
// desktop widths, against a fake broker in the page: a bug whose fix landed (in a release, not yet, no tags known),
// rows unchanged over a day (flagged, within the hour, nobody to ask), a kept row, and a lead's board_ask question.
//   node test-ui/shots-bob49.mjs   (from packages/broker; writes design/BOB-49/shots-build/*.png)
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "../public");
const out = join(here, "../../../design/BOB-49/shots-build");
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
  const projects = [
    { key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] },
    { key: "helix", name: "Helix", prefix: "LAND", draft_prefix: null, lead: "Bob@mbp-1", po: "Picard@mbp-1", repos: [] },
  ];
  const sha = "5d4617f4bed3884d73deb1a9cc71e1ed366215f4";
  const subject = "v2: BOB-27: board reports no longer stall behind a row the protocol won't take";
  const fix = (release, tags_known) => ({ sha, subject, landed_at: iso(170), release, tags_known });
  const wait = (project, kind, ref, feature, text, blocking, minAgo, over = {}) => ({
    project, kind, ref, feature, text, recommended: null, context: null, holds: { items: [], sessions: [] }, waiting_sessions: [], needed_before: null,
    asked_by: "Mario@mbp-1", since: iso(minAgo), blocking, stale: null, kept: null, fix: null, ...over,
  });
  const waits = [
    // A lead's board_ask question, holding its session (spec c), unchanged two days and flagged to its asker (spec b).
    wait("bobnet", "question", "Q-14", "BOB-6", "Which laptop runs the Helix supervisor after the move?", true, 60 * 51 + 3, {
      holds: { items: [], sessions: [{ feature: "BOB-6", kind: "build", label: "A" }] }, stale: { changed_at: iso(60 * 51 + 3), owner: "Mario@mbp-1", flagged_at: iso(40) },
      recommended: { key: "a", text: "ubu1, as today" },
    }),
    wait("helix", "question", "Q-282", "LAND-56", "Accept the prototype of the parcel picker, or one more round?", true, 60 * 3, {
      asked_by: "Bob@mbp-1", holds: { items: [], sessions: [{ feature: "LAND-56", kind: "design", label: "B" }] },
    }),
    wait("bobnet", "review_gate", "BOB-12", "BOB-12", "Casper's look at the roadmap", true, 60 * 26, { asked_by: null, holds: { items: ["BOB-12"], sessions: [] },
      stale: { changed_at: iso(60 * 26), owner: "Peach@mbp-1", flagged_at: null } }),
    // Fixed bugs: in a release, not in one yet, and a repo that never reports tags (spec a); the last also stale.
    wait("bobnet", "bug", "BOB-27", "BOB-12", "Board reports stuck since 04:10", false, 180, { fix: fix("v2.0.0-rc.34", true) }),
    wait("bobnet", "bug", "BOB-28", null, "The chart is blank after a reconnect", false, 200, { asked_by: "Peach@mbp-1", fix: fix(null, true) }),
    wait("helix", "bug", "LAND-312", null, "Tracts don't load on a cold start", false, 60 * 27, { asked_by: "Bob@mbp-1", fix: fix(null, false),
      stale: { changed_at: iso(60 * 26), owner: "Picard@mbp-1", flagged_at: iso(12) } }),
    wait("helix", "action", "A-17", null, "Sign the Mapbox terms for the commercial plan on the company account", false, 60 * 30, { asked_by: "Picard@mbp-1",
      kept: { by: "Picard@mbp-1", at: iso(95), reason: "Still needed before the demo; the account owner is back on Monday" } }),
    wait("helix", "question", "Q-290", null, "Which tract for rehearsal 2?", false, 60 * 25, { asked_by: "Casper@example.com", stale: { changed_at: iso(60 * 25), owner: null, flagged_at: null } }),
  ];
  const overviewRow = (p) => ({ project: p, release: null, release_number: null, open: [], next_ready: null, waits_on_you: null, backlog: { items: 0, bugs: 0, oldest: null } });
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "overview": return { projects: projects.map(overviewRow) };
      case "waits": return { waits, answered: [] };
      case "status": return { at: new Date(now).toISOString(), since: iso(60), projects: [] };
      case "get": return { question: { ref: op.ref, options: [], state: "open" } };
      default: return { ref: null, seq: 1 };
    }
  };
  const worker = (id, name, project, role, session) => ({ id, name, project, role, state: "running", task: session ?? role, model: "opus", effort: "high", checkpoint: null,
    started_at: iso(40), ended_at: null, last_event_at: iso(0), tokens: { input: 20_000, output: 30_000, cache_read: 900_000, cache_write: 50_000 }, session, task_ref: null, calls: 80, context: 90000, ctx: [] });
  const workersNow = [worker("w_l", "Luigi", "bobnet", "engineer", "BOB-6 build A"), worker("w_m", "Mario", "bobnet", "lead", null), worker("w_k", "kong", "helix", "designer", "LAND-56 design B")];
  const dashboard = { now: new Date(now).toISOString(), peers: [], laptops: [{ laptop: "mbp-1", at: iso(0), snapshot: { supervisor: { started_at: iso(600), concurrency: 3, active: 3, queued: 0 }, workers: workersNow, pending: [], usage: [] } }], boards: [], updates: [], traffic: [] };

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

const widths = { 390: [390, 844], 1440: [1440, 900] };
// [name, hash, selector to wait for, full page]
const all = [
  ["waits", "waits", ".waits li", true],
  ["overview-needs-you", "overview", "#needs li", false],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, hash, ready, full] of all) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      await page.addInitScript(fakeBroker);
      await page.goto(`${base}#${hash}`);
      await page.waitForSelector(ready);
      await page.waitForTimeout(400);
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
