// Screenshots of the roadmap's releases (BOB-189 R6, AC5) at phone and desktop widths, against a fake broker in the
// page: a closed release with features (folded), an open one, two planned ones (one with its goal) and a closed one
// with no features, in the read view and behind Edit your gates (Reopen where Close was).
//   node test-ui/shots-bob189.mjs   (from packages/broker; writes design/BOB-189/shots-build/*.png)
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "../public");
const out = join(here, "../../../design/BOB-189/shots-build");
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

/** Runs in the page: a broker that answers the dashboard and the roadmap's reads from memory. */
function fakeBroker() {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
  const projects = [{ key: "helix", name: "Helix", prefix: "LAND", draft_prefix: null, lead: "Picard@mbp-1", po: "Picard@mbp-1", repos: [] }];
  const counts = (items, bugs) => ({ items, bugs, oldest: items ? iso(60 * 24 * 4) : null });
  const rel = (ref, title, status, done, total, over = {}) => ({
    ref, title, goal: null, status, ord: Number(ref.slice(1)) * 1000, spec_url: null, closed_at: status === "closed" ? "2026-11-20T10:00:00.000Z" : null,
    closed_by: status === "closed" ? "Picard@mbp-1" : null, features: { done, total }, backlog: counts(0, 0), ...over,
  });
  const releases = [
    rel("R0", "R0 Foundations", "closed", 3, 3),
    rel("R1", "R1 The land app on a phone", "open", 1, 3, { backlog: counts(4, 1) }),
    rel("R2", "R2 Steps you can trust", "planned", 0, 2, { goal: "Every step shows what it did and what it waits on, without opening a terminal." }),
    rel("R3", "R3 Nightly", "planned", 0, 0, { goal: "Every day starts green: the nightly run finishes before anyone looks." }),
    rel("R4", "R4 Offline drafts (dropped)", "closed", 0, 0),
  ];
  const f = (ref, release, status, title, checked, total, over = {}) => ({
    ref, kind: "feature", type: "increment", status, title, parent: null, release, ord: null, labels: [], progress: { checked, total },
    tasks: { done: 0, total: 0 }, open_since: null, archived_at: null, ...over,
  });
  const features = [
    f("LAND-1", "R0", "Done", "Sign in with a device key", 4, 4),
    f("LAND-2", "R0", "Done", "One list of lands", 3, 3),
    f("LAND-3", "R0", "Done", "A land's log", 2, 2),
    f("LAND-12", "R1", "Done", "The lands list on a phone", 5, 5),
    f("LAND-14", "R1", "Ready", "Start a land from the phone", 2, 6, { open_since: iso(90) }),
    f("LAND-15", "R1", "Ready", "Push notices for a failed land", 0, 4),
    f("LAND-21", "R2", "Draft", "Steps in their order, each with its state", 0, 0),
    f("LAND-22", "R2", "Draft", "What a step waits on, and since when", 0, 0),
    f("LAND-30", null, "Draft", "Dark mode", 0, 0),
  ];
  features.forEach((x, i) => (x.ord = (i + 1) * 1000));
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "overview": return { projects: projects.map((p) => ({ project: p, release: null, release_number: null, open: [], next_ready: null, waits_on_you: null, backlog: counts(0, 0), no_release: counts(2, 0) })) };
      case "list": return op.of === "releases" ? { releases, total: releases.length, cursor: null } : { items: op.of === "features" ? features : [], total: features.length, cursor: null };
      case "waits": return { waits: [], answered: [] };
      case "status": return { at: new Date(now).toISOString(), since: iso(60), projects: [] };
      default: return { ref: null, seq: 1 };
    }
  };
  const dashboard = { now: new Date(now).toISOString(), peers: [], laptops: [], boards: [], updates: [], traffic: [] };

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
// [name, hash]
const all = [
  ["roadmap-read", "roadmap/helix"],
  ["roadmap-edit", "roadmap/helix/edit"],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, hash] of all) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      await page.addInitScript(fakeBroker);
      await page.goto(`${base}#${hash}`);
      await page.waitForSelector("#rel-R4");
      await page.waitForTimeout(1000);
      await page.screenshot({ path: join(out, `${name}-${w}.png`), fullPage: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
