// BOB-212 (ADR 0017 §7, Q-22): the dashboard frames BobNet's own ERD viewer (opaque origin, the viewer's CSP with
// only its hash: no 'unsafe-eval') and posts the sample's data-model.dbml in. At 1280 x 800 by mouse and at
// 390 x 844 by tap, on "All tables", it shows: (a) every table closed; (b) loan opened by its own control, the rest
// closed; (c) member opened too; then loan closed again with member left open. After each step it checks which
// tables show columns, that no two tables overlap, and the viewer's `expanded` message. Then: the state handed back
// in `files` (as the page keeps it per diagram), a click on a table (focus), hover, expand all / collapse all, and
// the lending diagram. The shots go to <out>.
//   TOOLS=<dir with playwright> EXE=<chrome-headless-shell> node frame-erd-own-test.mjs <dir with erd-viewer.html> <data-model.dbml> <out>
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import assert from "node:assert/strict";
const [root, dbml, out] = process.argv.slice(2), hash = fs.readFileSync(path.join(root, "erd-viewer.hash"), "utf8").trim();
const { chromium } = await import(path.join(process.env.TOOLS, "node_modules/playwright/index.mjs"));
const DASH = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const VIEWER = `default-src 'none'; script-src ${hash}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
const pages = {
  "/dashboard.html": `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="dash.css"><iframe id="v" sandbox="allow-scripts" src="erd-viewer.html"></iframe><script type="module" src="dash.js"></script>`,
  "/dash.css": "body{margin:0}iframe{border:0;width:100vw;height:100vh;display:block}",
  "/dash.js": `const f=document.getElementById("v"),q=new URLSearchParams(location.search);const s=fetch("data-model.dbml").then(r=>r.text());window.log=[];
addEventListener("message",async e=>{if(e.source!==f.contentWindow)return;window.log.push(e.data);if(e.data.t==="hello")f.contentWindow.postMessage({t:"files",kind:"erd",files:[{path:"library/data-model.dbml",text:await s}],view:q.get("view")||undefined,expanded:q.get("open")?q.get("open").split(","):undefined,focus:q.get("focus")||undefined},"*");if(e.data.t==="ready")window.ready=e.data});
window.send=m=>f.contentWindow.postMessage(m,"*");`,
  "/data-model.dbml": fs.readFileSync(dbml, "utf8"),
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".dbml": "text/plain" };
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const body = pages[p] ?? (p === "/erd-viewer.html" ? fs.readFileSync(path.join(root, p)) : null);
  if (body == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)], "content-security-policy": p.includes("viewer") ? VIEWER : DASH }); res.end(body);
}).listen(0);
const base = `http://localhost:${srv.address().port}/dashboard.html`;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.EXE });
const results = [];
for (const [name, vp] of [["1280", { width: 1280, height: 800 }], ["390", { width: 390, height: 844 }]]) {
  const touch = name === "390";
  const open = async (qs = "") => {
    const pg = await b.newPage({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 3 : 1 });
    const errs = []; pg.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text().slice(0, 160)); }); pg.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
    await pg.goto(`${base}?${qs}`); await pg.waitForFunction(() => window.ready); await pg.waitForTimeout(400);
    return { pg, errs, fr: pg.frameLocator("#v") };
  };
  // Which tables show columns, how many rows each, and whether any two boxes overlap.
  const state = (fr) => fr.locator("body").evaluate(() => {
    const ns = [...document.querySelectorAll(".react-flow__node")].map((n) => ({ id: n.dataset.id, rows: n.querySelectorAll(".cols li").length, r: n.getBoundingClientRect() }));
    const hit = []; for (const a of ns) for (const c of ns) if (a.id < c.id && a.r.left < c.r.right - 1 && c.r.left < a.r.right - 1 && a.r.top < c.r.bottom - 1 && c.r.top < a.r.bottom - 1) hit.push(`${a.id}/${c.id}`);
    const btn = document.querySelector('.react-flow__node[data-id="loan"] .tog').getBoundingClientRect();
    return { open: ns.filter((n) => n.rows).map((n) => `${n.id}:${n.rows}`).sort(), nodes: ns.length, overlaps: hit, loanButton: `${Math.round(btn.width)}x${Math.round(btn.height)}` };
  });
  const toggle = async (pg, fr, t) => {
    const btn = fr.locator(`.react-flow__node[data-id="${t}"] .tog`);
    touch ? await btn.tap() : await btn.click();
    await pg.waitForTimeout(450);
  };
  const last = (pg, t) => pg.evaluate((t) => window.log.filter((m) => m.t === t).at(-1) ?? null, t);

  // The feature: one table at a time, on the table itself.
  {
    const { pg, errs, fr } = await open();
    const a = await state(fr); await pg.screenshot({ path: `${out}/${name}-a-all-collapsed.png` });
    assert.deepEqual(a.open, []); assert.equal(a.nodes, 9); assert.deepEqual(a.overlaps, []);
    await toggle(pg, fr, "loan");
    const bb = await state(fr); await pg.screenshot({ path: `${out}/${name}-b-loan-expanded.png` });
    assert.deepEqual(bb.open, ["loan:9"]); assert.deepEqual(bb.overlaps, []); assert.deepEqual((await last(pg, "expanded")).tables, ["loan"]);
    await toggle(pg, fr, "member");
    const cc = await state(fr); await pg.screenshot({ path: `${out}/${name}-c-loan-member-expanded.png` });
    assert.deepEqual(cc.open, ["loan:9", "member:7"]); assert.deepEqual(cc.overlaps, []); assert.deepEqual((await last(pg, "expanded")).tables, ["loan", "member"]);
    await toggle(pg, fr, "loan");
    const dd = await state(fr); await pg.screenshot({ path: `${out}/${name}-d-member-only.png` });
    assert.deepEqual(dd.open, ["member:7"]); assert.deepEqual(dd.overlaps, []);
    // No focus from a toggle: the control isn't the table's click.
    assert.equal(await last(pg, "focus"), null);
    // A click (or tap) on the table's name opens it: the page's entity card.
    const nm = fr.locator('.react-flow__node[data-id="tool"] .name'); touch ? await nm.tap() : await nm.click(); await pg.waitForTimeout(450);
    assert.equal((await last(pg, "focus")).focus, "tool");
    if (!touch) { await fr.locator('.react-flow__node[data-id="shed"] .name').hover(); await pg.waitForTimeout(100); assert.equal((await last(pg, "hover")).table, "shed"); }
    // Expand all, collapse all: the page's extras, by message.
    await pg.evaluate(() => window.send({ t: "expand", tables: window.ready.shown })); await pg.waitForTimeout(450);
    const all = await state(fr); assert.equal(all.open.length, 9); assert.deepEqual(all.overlaps, []);
    await pg.evaluate(() => window.send({ t: "fit" })); await pg.waitForTimeout(450); await pg.screenshot({ path: `${out}/${name}-e-expand-all.png` });
    await pg.evaluate(() => window.send({ t: "expand", tables: [] })); await pg.waitForTimeout(450);
    assert.deepEqual((await state(fr)).open, []);
    results.push({ vp: name, a: a.open, b: bb.open, c: cc.open, d: dd.open, loanButtonAtFit: a.loanButton, errs: [...new Set(errs)] });
    await pg.close();
  }
  // The page keeps the state per diagram and hands it back: the diagram opens as the reader left it.
  {
    const { pg, errs, fr } = await open("open=loan,member");
    const s = await state(fr); assert.deepEqual(s.open, ["loan:9", "member:7"]); assert.deepEqual((await pg.evaluate(() => window.ready.expanded)), ["loan", "member"]);
    await pg.close(); if (errs.length) results.push({ vp: name, restore: errs });
  }
  // A DiagramView: only its tables, each with its own control.
  {
    const { pg, errs, fr } = await open("view=lending&open=loan");
    const s = await state(fr); assert.equal(s.nodes, 6); assert.deepEqual(s.open, ["loan:9"]); assert.deepEqual(s.overlaps, []);
    await pg.screenshot({ path: `${out}/${name}-f-lending-loan-expanded.png` });
    const r = await pg.evaluate(() => window.ready); assert.deepEqual(r.shown.length, 6); assert.equal(r.tables.length, 9);
    assert.ok(r.enums.find((e) => e.name === "loan_state").values[0].note); assert.equal(r.tables.find((t) => t.name === "loan").line, 82);
    results.push({ vp: name, lending: s.open, errs: [...new Set(errs)] });
    await pg.close();
  }
}
console.log(JSON.stringify(results, null, 1));
await b.close(); srv.close();
