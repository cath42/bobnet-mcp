// BOB-212 prototype v5: the per-table shots (Casper's Q-22 check, lead/bob212/frameworks-decision.md), taken from the
// staged deploy dir served as Cloudflare would: its _headers applied (each viewer's CSP by its hash, noindex).
// At 1280 by mouse, at 390 by tap: (a) Toolshed's All tables, all closed; (b) loan opened on its node; (c) member too;
// (d) loan's card open. After each step it checks which tables show columns in the frame, what the page kept for
// the diagram, and, at 390, the control's tap target on screen.
//   node design/BOB-212/tools/shots-v5.mjs <staged dir, from stage.sh>   (writes design/BOB-212/shots-v5/*.png)
import { readFile } from "node:fs/promises";
import { readFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(join(here, "../../../packages/broker/node_modules/playwright-core/index.mjs"));
const pub = join(process.argv[2], "public"), out = join(here, "../shots-v5");
mkdirSync(out, { recursive: true });
// _headers: a path line, then its indented headers.
const rules = [];
for (const line of readFileSync(join(pub, "_headers"), "utf8").split("\n")) {
  if (/^\S/.test(line)) rules.push([line.trim(), {}]);
  else if (line.trim()) { const [k, ...v] = line.trim().split(": "); rules.at(-1)[1][k.toLowerCase()] = v.join(": "); }
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname, file = path === "/" ? "/index.html" : path;
  try {
    const body = await readFile(join(pub, file)), head = { "content-type": types[extname(file)] ?? "text/html" };
    for (const [p, hs] of rules) if (p === "/*" || p === path) Object.assign(head, hs);
    res.writeHead(200, head).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const T = "#project/toolshed/library/data";
const browser = await chromium.launch(process.env.EXE ? { executablePath: process.env.EXE } : {});
let bad = 0;
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
for (const [w, h, touch] of [[1280, 800, false], [390, 844, true]]) {
  console.log(w);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { bad++; console.log("  page error:", e.message); });
  p.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) { bad++; console.log("  console:", m.text().slice(0, 200)); } });
  const res = await p.goto(base + "index.html" + T);
  check(res.headers()["x-robots-tag"] === "noindex", "noindex");
  await p.waitForFunction(() => document.querySelector(".vf-veil")?.hidden, null, { timeout: 30000 });
  await p.waitForTimeout(900);
  const fr = p.frameLocator(".vf-box iframe"), frame = p.frames().find((f) => f.url().includes("erd-viewer"));
  const node = (n) => fr.locator(`.react-flow__node[data-id="${n}"]`);
  const opened = () => frame.evaluate(() => [...document.querySelectorAll(".react-flow__node")].filter((n) => n.querySelector(".tbl.open")).map((n) => n.dataset.id).sort().join(","));
  const kept = () => p.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes("expanded.toolshed.all")).map(([, v]) => JSON.parse(v).join(","))[0] ?? "");
  const shot = async (name) => {
    // The frame brought up as a reader would; the mouse off the diagram, so no hover peek covers it.
    await p.evaluate(() => document.querySelector(".vf").scrollIntoView({ block: "start" }));
    if (!touch) await p.mouse.move(2, 2);
    await p.waitForTimeout(500);
    await p.screenshot({ path: join(out, `${w}-${name}.png`) });
  };
  const tog = async (n) => { const b = node(n).locator(".tog"); touch ? await b.tap() : await b.click(); await p.waitForTimeout(700); };
  if (touch) { await p.tap(".vf-touch"); await p.waitForTimeout(300); }
  check((await opened()) === "", "a: every table closed");
  // The control's target on screen: the frame's points around the chip that land on it.
  if (touch) {
    const t = await frame.evaluate(() => {
      const b = document.querySelector('.react-flow__node[data-id="loan"] .tog'), r = b.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const reach = (dx, dy) => { let d = 0; while (d < 80 && b.contains(document.elementFromPoint(cx + dx * (d + 1), cy + dy * (d + 1)))) d++; return d; };
      return { drawn: [Math.round(r.width), Math.round(r.height)], w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1, z: getComputedStyle(document.documentElement).getPropertyValue("--z") };
    });
    console.log(`  loan's control: drawn ${t.drawn.join(" x ")} px, its tap target ${t.w} x ${t.h} px on screen, at zoom ${(+t.z).toFixed(2)}`);
    check(t.w >= 44 && t.h >= 44, "the tap target is at least 44 x 44");
  }
  await shot("a-all-collapsed");
  await tog("loan");
  check((await opened()) === "loan", "b: loan open, the rest closed");
  check((await kept()) === "loan", "b: the page keeps [loan] for All tables");
  check(!(await p.$(".ent")), "b: the toggle doesn't open the card");
  await shot("b-loan-expanded");
  await tog("member");
  check((await opened()) === "loan,member", "c: loan and member open, the rest closed");
  check((await kept()) === "loan,member", "c: the page keeps [loan, member]");
  await shot("c-loan-member-expanded");
  const name = node("loan").locator(".name");
  touch ? await name.tap() : await name.click();
  await p.waitForTimeout(1200);
  check((await p.textContent(".ent-h b").catch(() => "")) === "loan", "d: loan's card is open");
  check((await opened()) === "loan,member", "d: the card leaves the open tables as they were");
  await shot("d-loan-card");
  // The state is the diagram's, on the device: a reload draws loan and member open again.
  await p.reload(); await p.waitForFunction(() => document.querySelector(".vf-veil")?.hidden, null, { timeout: 30000 }); await p.waitForTimeout(900);
  const f2 = p.frames().find((f) => f.url().includes("erd-viewer"));
  check((await f2.evaluate(() => [...document.querySelectorAll(".react-flow__node")].filter((n) => n.querySelector(".tbl.open")).map((n) => n.dataset.id).sort().join(","))) === "loan,member", "reload: loan and member still open");
  await ctx.close();
}
await browser.close();
server.close();
console.log(bad ? `${bad} problem(s)` : "all checks pass");
process.exit(bad ? 1 : 0);
