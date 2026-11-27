// BOB-212 prototype, version 3 (the entity card on the ERD, spec §10.2): the Projects menu, a project's Work · Library tabs, and each project's library in
// ADR 0016's seven fixed sections: cards and diagrams first, the prose behind them. The libraries are real (data.js,
// from each repo's main); everything else on the page is a stand-in for what is built.
(function () {
  "use strict";
  const LIBS = window.LIBS;
  const PROJECTS = [
    { key: "bobnet", name: "BobNet", repo: "cath42/bobnet-mcp", lead: "Mario", po: "Peach" },
    { key: "helix", name: "Helix", repo: "cath42/helix-navigator", lead: "Bob", po: "Picard" },
    { key: "vitals", name: "Vitals", repo: "cath42/vitals" },
  ];
  // ADR 0016 §1: the skeleton. Ids fixed; the labels and the "what it holds" lines are the page's wording.
  const SECTIONS = [
    { id: "overview", label: "Overview", role: "product owner", holds: "Goals, scope, constraints and quality goals." },
    { id: "architecture", label: "Architecture", role: "architect", holds: "The C4 model, from context to containers to components, and how the parts run and deploy." },
    { id: "data", label: "Data model", role: "architect", holds: "The schema as a diagram, the data dictionary and the taxonomy." },
    { id: "decisions", label: "Decisions", role: "architect", holds: "One record per decision: its context, the options, the decision, its consequences and its status." },
    { id: "usecases", label: "Use cases", role: "product owner", holds: "One card per use case, with its scenarios under it." },
    { id: "ux", label: "UX design", role: "designer", holds: "One card per feature: its spec, its prototype, and Casper's verdict with its date." },
    { id: "glossary", label: "Glossary", role: "product owner", holds: "Terms in users' words." },
  ];
  const $ = (id) => document.getElementById(id);
  const NOW = Date.now();
  // The prototype's switch: what the read says (spec §11). Not built.
  const proto = { state: "ok" };

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayOf = (iso) => { const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const dayYear = (iso) => { const d = new Date(iso + "T12:00:00"); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function ago(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const hr = Math.round(m / 60);
    return hr < 48 ? `${hr}h ago` : `${Math.round(hr / 24)} days ago`;
  }
  const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const sha7 = (s) => s.slice(0, 7);
  const iso = (ms) => new Date(ms).toISOString();
  const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]);
  const plain = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*|__/g, "").replace(/`/g, "");
  const clip = (s, n) => (s.length > n ? s.slice(0, s.lastIndexOf(" ", n - 1) > n * 0.6 ? s.lastIndexOf(" ", n - 1) : n - 1) + "…" : s);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const kb = (s) => `${Math.max(1, Math.round(new Blob([s]).size / 1024))} KB`;

  // ---------- the route ----------
  // #overview · #project/<key> (Work) · #project/<key>/library[/<section>[/<page>[/<focus>]]]
  // <focus>: a heading (a page), a card or a child (cards), a C4 view (likec4), a table (erd).
  function route() {
    const parts = (location.hash || "#project/bobnet/library").slice(1).split("/").map(decodeURIComponent);
    if (parts[0] === "project" && PROJECTS.some((p) => p.key === parts[1])) {
      const lib = parts[2] === "library";
      return { view: "project", key: parts[1], tab: lib ? "library" : "work", section: lib ? parts[3] || null : null, page: lib ? parts[4] || null : null, focus: lib ? parts[5] || null : null };
    }
    return { view: parts[0] || "overview" };
  }
  const libHref = (key, sec, page, focus) =>
    `#project/${key}/library${sec ? `/${sec}` : ""}${sec && page ? `/${page}` : ""}${sec && page && focus ? `/${encodeURIComponent(focus)}` : ""}`;

  // ---------- what the broker would answer (ADR 0015 §4, 0016 §2) ----------
  /** The library as the read gives it, under the prototype's state. null: the project has none. */
  function libraryOf(key) {
    const lib = LIBS[key];
    if (!lib || proto.state === "none") return null;
    const checked = { behind: 5 * 60, failed: 3 * 60 }[proto.state] ?? 4;
    const m = { ...lib, checked_at: iso(NOW - checked * 60000), problems: [] };
    if (proto.state === "failed") m.problems = [{ what: "fetch", at: iso(NOW - 12 * 60000), text: "git fetch origin: Could not resolve host: github.com" }];
    if (proto.state === "missing") {
      const sid = ["decisions", "overview", "architecture"].find((s) => m.sections[s]?.pages.some((p) => p.kind === "md"));
      const sec = m.sections[sid], pg = sec.pages.find((p) => p.kind === "md");
      m.sections = { ...m.sections, [sid]: { ...sec, pages: sec.pages.map((p) => (p === pg ? { ...p, missing: true, text: null } : p)) } };
      m.problems = [{ what: "missing", section: sid, page: pg.id, text: `${pg.src} is not on main at ${sha7(m.commit)}` }];
    }
    return m;
  }
  const pagesOf = (lib, sid) => lib.sections[sid]?.pages ?? [];
  const behind = (m) => NOW - Date.parse(m.checked_at) > 2 * 3600e3;
  const ghBlob = (m, path, frag) => `${m.github}/blob/${m.commit}/${path}${frag ? `#${frag}` : ""}`;
  const ghTree = (m, path) => `${m.github}/tree/${m.commit}/${path}`;
  const secOf = (id) => SECTIONS.find((s) => s.id === id);

  // ---------- markdown: blocks, then inline. Raw HTML in a file shows as text, never runs. ----------
  function md(text, ctx) {
    const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
    return blocks(lines, ctx);
  }
  const reList = /^( *)([-*+]|\d+[.)]) +(.*)$/;
  const reFence = /^ {0,3}(```+|~~~+)\s*([\w-]*)/;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
  const startsBlock = (l, next) => /^ {0,3}#{1,6} /.test(l) || reFence.test(l) || /^ {0,3}> ?/.test(l) || /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(l) || reList.test(l) || (l.trim().startsWith("|") && next != null && isTableSep(next));
  function blocks(lines, ctx) {
    let out = "", i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = l.match(reFence))) {
        const fence = m[1], lang = m[2], code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[0].repeat(3))) code.push(lines[i++]);
        i++;
        out += lang === "mermaid" ? diagramSlot(code.join("\n"), ctx) : `<pre><code>${esc(code.join("\n"))}</code></pre>`;
        continue;
      }
      if ((m = l.match(/^ {0,3}(#{1,6}) +(.*?)#*\s*$/))) {
        const n = m[1].length, inner = inline(m[2], ctx), id = slug(m[2]);
        if (n === 2 || n === 3) ctx.toc.push({ n, id, text: unesc(inner.replace(/<[^>]+>/g, "")) });
        const hl = (n === 2 || n === 3) && ctx.headHref ? `<a class="hl" href="${ctx.headHref(id)}" aria-label="Link to this section">#</a>` : "";
        out += `<h${n} id="h-${id}">${inner}${hl}</h${n}>`;
        i++;
        continue;
      }
      if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out += "<hr>"; i++; continue; }
      if (l.trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
        out += table(rows, ctx);
        continue;
      }
      if (/^ {0,3}> ?/.test(l)) {
        const q = [];
        while (i < lines.length && /^ {0,3}> ?/.test(lines[i])) q.push(lines[i++].replace(/^ {0,3}> ?/, ""));
        out += `<blockquote>${blocks(q, ctx)}</blockquote>`;
        continue;
      }
      if (reList.test(l)) { const r = list(lines, i, ctx); out += r.html; i = r.next; continue; }
      const para = [l.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++].trim());
      out += `<p>${inline(para.join("\n"), ctx)}</p>`;
    }
    return out;
  }
  function list(lines, i, ctx) {
    const first = lines[i].match(reList), indent = first[1].length, ordered = /\d/.test(first[2]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let cur = null, loose = false;
    while (i < lines.length) {
      const l = lines[i], m = l.match(reList);
      if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) { cur = [m[3]]; items.push(cur); i++; continue; }
      if (!l.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        const nx = lines[j];
        if (nx == null) break;
        const nm = nx.match(reList), nind = nx.match(/^ */)[0].length;
        if (nind > indent) { cur.push(""); i++; continue; }
        if (nm && nm[1].length === indent && /\d/.test(nm[2]) === ordered) { loose = true; i = j; continue; }
        break;
      }
      const ind = l.match(/^ */)[0].length;
      if (ind > indent) { cur.push(l.slice(Math.min(ind, indent + 2))); i++; continue; }
      if (m || startsBlock(l, lines[i + 1])) break;
      cur.push(l.trim());
      i++;
    }
    const lis = items.map((it) => {
      let body = blocks(it, ctx);
      if (!loose) body = body.replace(/^<p>([\s\S]*?)<\/p>/, "$1");
      return `<li>${body}</li>`;
    }).join("");
    return { html: ordered ? `<ol${start !== 1 ? ` start="${start}"` : ""}>${lis}</ol>` : `<ul>${lis}</ul>`, next: i };
  }
  function cells(row) {
    return row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  }
  function table(rows, ctx) {
    const head = cells(rows[0]), body = rows.slice(2).map(cells);
    return `<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inline(c, ctx)}</th>`).join("")}</tr></thead><tbody>${
      body.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? "", ctx)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function inline(s, ctx) {
    const keep = [];
    const stash = (html) => `\u0000${keep.push(html) - 1}\u0000`;
    s = s.replace(/\\([\\`*_\[\]()#|>-])/g, (_, c) => stash(esc(c)));
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) => stash(`<code>${esc(code.trim())}</code>`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => stash(link(href, inline(label, ctx), ctx)));
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => stash(link(u, esc(u), ctx)));
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/ {2,}\n/g, "<br>").replace(/\n/g, " ");
    return s.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[+n]);
  }
  /** Where a repo path is in the library: a page, or a child of a children page. */
  function findInLib(lib, path) {
    for (const [sid, sec] of Object.entries(lib.sections)) for (const p of sec.pages) {
      if (p.src === path) return { sid, page: p.id };
      const c = p.children?.find((x) => x.src === path);
      if (c) return { sid, page: p.id, child: c.id };
    }
    return null;
  }
  /** A link in a page: to a library page in place, to any other repo file on GitHub at the commit shown, http(s) out; anything else is dead text. */
  function link(href, label, ctx) {
    if (href.startsWith("#")) return ctx.headHref ? `<a href="${ctx.headHref(slug(href.slice(1)))}">${label}</a>` : `<a href="#h-${slug(href.slice(1))}" data-scroll>${label}</a>`;
    if (/^https?:\/\//.test(href)) return `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return `<span class="dead" title="Not a web link">${label}</span>`;
    const [path, frag] = href.split("#");
    const target = path ? normPath(ctx.base.replace(/[^/]*$/, "") + path) : ctx.base;
    const hit = findInLib(ctx.lib, target);
    if (hit) return `<a href="${libHref(ctx.key, hit.sid, hit.page, hit.child || (frag ? slug(frag) : null))}">${label}</a>`;
    return `<a class="ext" href="${esc(ghBlob(ctx.lib, target, frag))}" target="_blank" rel="noopener" title="${esc(target)} on GitHub at ${sha7(ctx.lib.commit)}">${label}</a>`;
  }
  function normPath(p) {
    const out = [];
    for (const s of p.split("/")) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); }
    return out.join("/");
  }
  const mdCtx = (key, lib, sid, page, base, headHref) => ({ key, lib, sid, page, base, headHref, toc: [], diagrams: [] });

  // ---------- small diagrams (mermaid): an image fitted to the column; Full size; Source ----------
  let mermaidP = null, dn = 0;
  function diagramSlot(code, ctx) {
    ctx.diagrams.push(code);
    return `<div class="dia" data-dia="${ctx.diagrams.length - 1}"></div>`;
  }
  function loadMermaid() {
    // Prototype: from a CDN. The build vendors mermaid 11.x in public/vendor/ and loads it only for a page with a diagram.
    return (mermaidP ||= new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
      s.onload = () => ok(window.mermaid);
      s.onerror = () => { mermaidP = null; no(new Error("load")); };
      document.head.append(s);
    }));
  }
  function drawDiagrams(root, ctx) {
    root.querySelectorAll(".dia").forEach((box) => {
      const code = ctx.diagrams[+box.dataset.dia];
      const src = h("pre", null, h("code", null, code));
      const bar = (status, ...btns) => h("div", { class: "dia-bar" }, h("span", null, status), h("span", { class: "actions" }, btns));
      const srcLink = h("a", { href: ghBlob(ctx.lib, ctx.base), target: "_blank", rel: "noopener" }, "On GitHub ↗");
      const fallback = (why) => box.replaceChildren(bar("Diagram", srcLink), h("div", { class: "dia-note warn" }, why), src);
      box.replaceChildren(bar("Diagram"), h("div", { class: "dia-note" }, "Drawing the diagram…"), src);
      loadMermaid().then(async (mm) => {
        const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
        mm.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", htmlLabels: false, flowchart: { htmlLabels: false },
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          themeVariables: { background: v("--surface"), primaryColor: v("--surface"), primaryTextColor: v("--text"), primaryBorderColor: v("--accent"),
            lineColor: v("--muted"), secondaryColor: v("--bg"), tertiaryColor: v("--bg"), textColor: v("--text"), mainBkg: v("--surface"), nodeBorder: v("--accent"),
            clusterBkg: v("--bg"), clusterBorder: v("--line"), edgeLabelBackground: v("--surface"), attributeBackgroundColorOdd: v("--surface"), attributeBackgroundColorEven: v("--bg") } });
        const { svg } = await mm.render(`dia${++dn}`, code);
        const img = h("img", { src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), alt: `Diagram: ${ctx.page.title}. Its source is under Source.` });
        const view = h("div", { class: "dia-view" }, img);
        let showSrc = false;
        const full = h("button", { type: "button", "aria-pressed": "false", onclick: () => { const on = box.classList.toggle("full"); full.setAttribute("aria-pressed", String(on)); full.textContent = on ? "Fit" : "Full size"; } }, "Full size");
        const sb = h("button", { type: "button", "aria-pressed": "false", onclick: () => { showSrc = !showSrc; sb.setAttribute("aria-pressed", String(showSrc)); src.hidden = !showSrc; } }, "Source");
        src.hidden = true;
        box.replaceChildren(bar("Diagram", full, sb), view, src);
      }).catch(() => fallback("This diagram couldn't be drawn here. Its source is below."));
    });
  }

  // ---------- zoomable diagrams: LikeC4 and Liam ERD in a sandboxed frame (ADR 0016 §6; spec §9, §10) ----------
  const FRAMES = new Set();
  addEventListener("message", (e) => { for (const f of FRAMES) if (e.source === f.win()) f.on(e.data || {}); });
  const coarse = matchMedia("(pointer: coarse)");

  function viewerFrame(kind, page, ctx, focus) {
    const c4 = kind === "likec4";
    const st = { ready: false, views: [], tables: [], errors: [], focus: focus || (c4 ? page.view : ""), timer: 0 };
    const files = c4 ? page.files : [{ path: page.src, text: page.text, changed: page.changed }];
    const post = (m) => iframe.contentWindow?.postMessage(m, "*");
    const go = (f) => { nav(libHref(ctx.key, ctx.sid, page.id, f || null)); setFocus(f || ""); };
    const crumb = h("div", { class: "vf-crumb", "aria-label": c4 ? "Level" : "Table" });
    const back = h("button", { type: "button", class: "vf-back", title: "One level out", "aria-label": "One level out", onclick: () => go(parentOf()) }, "↑ Out");
    // Version 3: the views and the tables are one picker in the bar, not a row of chips under the frame.
    const pick = h("select", { class: "vf-pick", "aria-label": c4 ? "Go to a view" : "Find a table", onchange: (e) => {
      go(e.target.value);
      if (box.getBoundingClientRect().bottom > innerHeight) wrap.scrollIntoView({ block: "start" }); // a phone: bring the frame up
    } });
    const fit = h("button", { type: "button", onclick: () => post({ t: "fit" }) }, "Fit");
    const fullB = h("button", { type: "button", class: "vf-full-b", onclick: () => full(!wrap.classList.contains("full")) }, "Full screen");
    const done = h("button", { type: "button", class: "vf-done", onclick: () => wrap.classList.remove("exploring") }, "Done");
    const iframe = h("iframe", { sandbox: "allow-scripts", src: c4 ? "vendor/likec4-viewer.html" : "vendor/erd-viewer.html", title: c4 ? `${page.title}: an architecture diagram you can zoom and open` : `${page.title}: the tables and their relations` });
    const veil = h("div", { class: "vf-veil" }, h("div", { class: "vf-load" }, h("b", null, c4 ? "Drawing the model…" : "Drawing the schema…"),
      h("span", null, `The first time on this device, the viewer downloads (${c4 ? "2.4" : "1.3"} MB).`), h("div", { class: "skel" }, h("i"), h("i"), h("i"))));
    const touch = h("button", { type: "button", class: "vf-touch", onclick: () => wrap.classList.add("exploring") },
      h("b", null, "Tap to explore"), h("span", null, c4 ? "Then pinch to zoom, drag to move, tap a box to open it" : "Then pinch to zoom, drag to move, tap a table to open it"));
    const peek = h("div", { class: "ent-peek", hidden: true, "aria-hidden": "true" });
    const ent = h("div", { class: "ent-slot" });
    const box = h("div", { class: "vf-box" }, iframe, veil, touch, peek, ent);
    const warnLine = h("div", { class: "vf-warn", hidden: true });
    const src = (path, label) => h("a", { href: ghBlob(ctx.lib, path), target: "_blank", rel: "noopener" }, `${label ?? path.split("/").pop()} ↗`);
    const foot = h("div", { class: "vf-foot" }, c4
      ? ["Model: ", h("a", { href: ghTree(ctx.lib, page.dir), target: "_blank", rel: "noopener" }, `${page.dir}/ ↗`), ` · LikeC4 · main at ${sha7(ctx.lib.commit)}`]
      : page.standin
        ? [h("span", { class: "proto-tag" }, "Prototype"), " Drawn from ", src(page.standin, page.standin), ` until Helix's build writes ${page.src} · Liam ERD · main at ${sha7(ctx.lib.commit)}`]
        : ["Schema: ", src(page.src), page.about ? [" · descriptions: ", src(page.about.path)] : null, ` · Liam ERD · main at ${sha7(ctx.lib.commit)}`]);
    const wrap = h("div", { class: `vf vf-${kind}` }, h("div", { class: "vf-bar" }, crumb, h("span", { class: "vf-act" }, c4 ? back : null, pick, fit, fullB, done)), warnLine, box, foot);

    // ---- the ERD's entity card (spec §10.2): the table's description, key fields and relations, from the table ----
    const T = new Map(), refBy = new Map();
    const about = !c4 && page.about ? aboutOf(page.about.text) : new Map();
    const dict = !c4 && page.about ? pagesOf(ctx.lib, ctx.sid).find((x) => x.src === page.about.path) : null;
    const descOf = (t) => t.comment || about.get(t.name)?.desc || "";
    function index() {
      T.clear(); refBy.clear();
      for (const t of st.tables) T.set(t.name, t);
      for (const t of st.tables) for (const f of t.fks) if (f.table !== t.name) refBy.set(f.table, [...(refBy.get(f.table) ?? []), t.name]);
    }
    const uniq = (xs) => [...new Set(xs)];
    function relChips(names, dir) {
      const more = names.length > 8;
      const chip = (n) => h("button", { type: "button", class: "chip-b mono", onclick: () => go(n) }, dir === "out" ? "→ " : "← ", n);
      const row = h("div", { class: "ent-rel" }, names.slice(0, 8).map(chip));
      if (more) row.append(h("button", { type: "button", class: "chip-b ghost", onclick: (e) => { e.currentTarget.replaceWith(...names.slice(8).map(chip)); } }, `${names.length - 8} more`));
      return row;
    }
    function colRow(t, c, fkOf) {
      const note = c.comment || about.get(t.name)?.cols[c.name] || "";
      const to = fkOf.get(c.name);
      return h("li", null, h("span", { class: "cn" }, c.name),
        h("span", { class: "ct" }, c.type, t.pk.includes(c.name) ? h("span", { class: "tag" }, "PK") : null),
        to ? h("button", { type: "button", class: "ent-to", onclick: () => go(to) }, `→ ${to}`) : null,
        note ? h("small", null, clip(plain(note), 170)) : null);
    }
    function entCard(t) {
      const a = about.get(t.name), desc = descOf(t);
      const fkOf = new Map(t.fks.flatMap((f) => f.columns.map((c) => [c, f.table])));
      const key = t.columns.filter((c) => t.pk.includes(c.name) || fkOf.has(c.name));
      const outs = uniq(t.fks.map((f) => f.table).filter((n) => n !== t.name)), ins = uniq(refBy.get(t.name) ?? []);
      const dictLink = dict && a ? h("a", { class: "ent-dict", href: libHref(ctx.key, ctx.sid, dict.id, a.id) }, `${t.name} in the ${dict.title.toLowerCase()} →`) : null;
      return h("aside", { class: "ent", "aria-label": `${t.name}: what it is` },
        h("div", { class: "ent-h" }, h("b", null, t.name), h("span", { class: "muted" }, `${t.columns.length} columns`),
          h("button", { type: "button", class: "ent-x", "aria-label": "Close: show all tables", onclick: () => go("") }, "×")),
        desc ? h("p", { class: "ent-d" }, cap(plain(desc))) : h("p", { class: "ent-d none" }, `No description: the schema has no comment on it${page.about ? ", and the data dictionary no heading for it" : ""}.`),
        outs.length || ins.length ? h("div", { class: "ent-s" }, h("div", { class: "lab" }, "Relations"),
          outs.length ? [h("span", { class: "ent-sub" }, "It refers to"), relChips(outs, "out")] : null,
          ins.length ? [h("span", { class: "ent-sub" }, "Referred to by"), relChips(ins, "in")] : null) : null,
        key.length ? h("div", { class: "ent-s" }, h("div", { class: "lab" }, "Key fields"), h("ul", { class: "ent-cols" }, key.map((c) => colRow(t, c, fkOf)))) : null,
        h("details", { class: "ent-all" }, h("summary", null, `All ${t.columns.length} columns`), h("ul", { class: "ent-cols" }, t.columns.map((c) => colRow(t, c, fkOf)))),
        a?.more.length ? h("details", { class: "ent-all" }, h("summary", null, "More from the data dictionary"), h("p", { class: "ent-more" }, clip(plain(a.more.join(" ")), 700))) : null,
        dictLink);
    }
    function drawEnt() {
      if (c4) return;
      const t = st.focus && T.get(st.focus);
      ent.replaceChildren(...(t ? [entCard(t)] : []));
      wrap.classList.toggle("has-ent", !!t);
      // The part of the frame the card covers, so the viewer puts an opened table where it can be seen (spec §10.2).
      const b = box.getBoundingClientRect(), c = ent.firstChild?.getBoundingClientRect();
      const phone = matchMedia("(max-width: 760px)").matches;
      post({ t: "inset", right: c && !phone ? Math.round(b.right - c.left) : 0, bottom: c && phone ? Math.round(b.bottom - c.top) : 0 });
      if (t && peek.dataset.t === t.name) peek.hidden = true;
    }
    function hover(name, r) {
      const t = name && T.get(name);
      if (!t || name === st.focus || coarse.matches) { peek.hidden = true; delete peek.dataset.t; return; }
      const desc = descOf(t);
      peek.dataset.t = name;
      peek.replaceChildren(h("b", null, name), desc ? h("span", null, clip(cap(plain(desc)), 150)) : null, h("small", null, "Click for its fields and relations"));
      peek.hidden = false;
      const W = box.clientWidth, H = box.clientHeight, pw = peek.offsetWidth, ph = peek.offsetHeight;
      peek.style.left = `${Math.max(8, Math.min(r.x, W - pw - 8))}px`;
      peek.style.top = `${r.y + r.h + 8 + ph < H ? r.y + r.h + 8 : Math.max(8, r.y - ph - 8)}px`;
    }

    const viewOf = (id) => st.views.find((v) => v.id === id);
    function parentOf() {
      if (!c4) return "";
      const cr = viewOf(st.focus)?.crumb ?? [];
      return cr.length > 1 ? cr[cr.length - 2] : null;
    }
    function draw() {
      if (c4) {
        const v = viewOf(st.focus), cr = v?.crumb ?? [st.focus];
        crumb.replaceChildren(...cr.flatMap((id, i) => {
          const lab = viewOf(id)?.label ?? id, last = i === cr.length - 1;
          return [i ? h("span", { class: "sep", "aria-hidden": "true" }, "›") : null,
            last ? h("b", { "aria-current": "location" }, lab) : h("a", { href: libHref(ctx.key, ctx.sid, page.id, id), onclick: (e) => { e.preventDefault(); go(id); } }, lab)].filter(Boolean);
        }), ...(v && v.title !== v.label ? [h("span", { class: "vf-title" }, v.title)] : []));
        back.disabled = cr.length < 2;
        pick.replaceChildren(h("option", { value: "", disabled: true }, `${st.views.length} views`),
          ...st.views.map((x) => h("option", { value: x.id, selected: x.id === st.focus }, `${x.title}${x.dynamic ? " · steps" : ""}`)));
      } else {
        const n = st.tables.length;
        crumb.replaceChildren(st.focus ? h("a", { href: libHref(ctx.key, ctx.sid, page.id), onclick: (e) => { e.preventDefault(); go(""); } }, `All ${n} tables`) : h("b", null, `All ${n} tables`),
          ...(st.focus ? [h("span", { class: "sep", "aria-hidden": "true" }, "›"), h("b", { "aria-current": "location" }, st.focus)] : []));
        pick.replaceChildren(h("option", { value: "", selected: !st.focus }, `Find a table (${n})`),
          ...[...st.tables].sort((a, b) => a.name.localeCompare(b.name)).map((t) => h("option", { value: t.name, selected: t.name === st.focus }, t.name)));
        drawEnt();
      }
      pick.disabled = !(c4 ? st.views.length : st.tables.length);
    }
    function setFocus(f) {
      f = f || (c4 ? page.view : "");
      if (f === st.focus) return;
      st.focus = f;
      post({ t: "focus", focus: f });
      draw();
    }
    function fail(why, errors) {
      clearTimeout(st.timer);
      const what = c4 ? "This model" : "This schema";
      box.replaceWith(h("div", { class: "vf-fail" }, h("b", null, `${what} couldn't be drawn here.`), h("p", null, why),
        errors?.length ? h("ul", { class: "errs" }, errors.map((x) => h("li", null, h("code", null, x.path), x.line ? ` line ${x.line}: ` : ": ", x.message))) : null,
        h("p", { class: "muted" }, `Its ${files.length === 1 ? "file" : `${files.length} files`} on GitHub at ${sha7(ctx.lib.commit)}:`),
        h("ul", { class: "files" }, files.map((f) => h("li", null, h("a", { href: ghBlob(ctx.lib, f.path), target: "_blank", rel: "noopener" }, `${f.path} ↗`), h("span", { class: "muted" }, ` ${kb(f.text)}`)))),
        h("div", { class: "actions" }, h("button", { type: "button", onclick: () => render(true) }, "Try again"))));
      back.disabled = true; fit.disabled = true; fullB.disabled = true; pick.disabled = true;
    }
    function full(on) {
      wrap.classList.toggle("full", on);
      document.body.classList.toggle("vf-lock", on);
      fullB.textContent = on ? "Close" : "Full screen";
      if (on) fullB.focus();
    }
    wrap.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (wrap.classList.contains("full")) full(false);
      else if (!c4 && st.focus) go("");
    });

    const me = {
      win: () => iframe.contentWindow,
      setFocus,
      on(d) {
        if (d.t === "hello") {
          if (proto.state === "slow") return; // the viewer never answers: loading, then the fallback at 15 s
          if (proto.state === "nodiagram") return fail("The viewer found errors in it:", c4
            ? [{ path: "bobnet.c4", line: 54, message: "Could not resolve reference to Element named 'bobnet.brokr'" }]
            : [{ path: "schema.sql", line: 12, message: 'syntax error at or near "CONSTRAINT"' }]);
          post(c4 ? { t: "files", kind, files: files.map(({ path, text }) => ({ path, text })), focus: st.focus }
            : { t: "files", kind, format: page.format, files: files.map(({ path, text }) => ({ path, text })), schema: page.schema, focus: st.focus });
        }
        if (d.t === "ready") {
          clearTimeout(st.timer);
          st.ready = true; st.views = d.views || []; st.tables = d.tables || []; st.errors = d.errors || [];
          if (c4 && !st.views.length) return fail("The viewer found no views in it.", st.errors);
          if (c4 && !viewOf(st.focus)) st.focus = page.view;
          if (!c4) { index(); if (st.focus && !T.has(st.focus)) st.focus = ""; }
          veil.hidden = true;
          if (st.errors.length) {
            warnLine.hidden = false;
            warnLine.replaceChildren(h("details", null, h("summary", null, `${st.errors.length} problem${st.errors.length > 1 ? "s" : ""} in the model: what they touch may be missing`),
              h("ul", { class: "errs" }, st.errors.map((x) => h("li", null, h("code", null, x.path), ` line ${x.line}: ${x.message}`)))));
          }
          draw();
        }
        if (d.t === "focus") {
          st.focus = d.focus || (c4 ? page.view : "");
          nav(libHref(ctx.key, ctx.sid, page.id, d.focus || null));
          draw();
        }
        if (d.t === "hover" && !c4) hover(d.table, d.rect);
      },
    };
    st.timer = setTimeout(() => { if (!st.ready) fail("The viewer didn't answer within 15 seconds."); }, 15000);
    FRAMES.add(me);
    draw();
    wrap.frame = me;
    return wrap;
  }

  /** An erd page's `about` file (spec §10.2; 0016 §2 as amended): a heading naming a table in backticks. The text
   *  after its dash is the description, the Notes column of its table the columns' notes, and its other prose
   *  "more". A table with no heading gets nothing, and no error. */
  function aboutOf(text) {
    const out = new Map(), lines = text.replace(/\r\n?/g, "\n").split("\n");
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], hm = l.match(/^#{2,4}\s+(.*?)\s*$/);
      if (hm) {
        const nm = hm[1].match(/^`([A-Za-z0-9_.]+)`\s*(?:[—–-]+\s*(.*))?$/);
        cur = nm ? { desc: nm[2] ?? "", cols: {}, more: [], id: slug(hm[1]) } : null;
        if (cur) out.set(nm[1].toLowerCase(), cur);
        continue;
      }
      if (!cur) continue;
      if (l.trim().startsWith("|") && isTableSep(lines[i + 1] ?? "")) {
        const head = cells(l).map((c) => plain(c).toLowerCase()), ci = head.findIndex((c) => c.startsWith("column")), ni = head.findIndex((c) => c.startsWith("note"));
        for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
          const row = cells(lines[i]), note = ni >= 0 ? plain(row[ni] ?? "").trim() : "";
          if (ci >= 0 && note) for (const n of (row[ci] ?? "").match(/`[^`]+`/g) ?? []) cur.cols[n.slice(1, -1)] = note;
        }
        i--;
        continue;
      }
      if (l.trim()) cur.more.push(l.trim());
    }
    return out;
  }

  // ---------- card heads: front matter, or the Key: value lines under the title (spec §8) ----------
  const reKey = /^(?:- )?(?:\*\*)?([A-Z][A-Za-z0-9 ]{1,28}?)(?::\*\*|\*\*:|:)(?:\s+(.*)|\s*$)/;
  /** {fields: [[key, value]], rest: the text without them}. */
  function headOf(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (fm) return { fields: fm[1].split("\n").map((l) => l.match(/^([\w ]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]), rest: text.slice(fm[0].length) };
    let i = lines.findIndex((l) => l.startsWith("# "));
    if (i < 0) return { fields: [], rest: text };
    const top = i;
    i++;
    while (i < lines.length && !lines[i].trim()) i++;
    const fields = [];
    let j = i;
    for (; j < lines.length && lines[j].trim(); j++) {
      const m = lines[j].match(reKey);
      if (m && !/^\s/.test(lines[j])) fields.push([m[1].trim(), (m[2] ?? "").trim()]);
      else if (fields.length) fields[fields.length - 1][1] += " " + lines[j].trim();
      else break;
    }
    if (!fields.length) return { fields, rest: text };
    return { fields, rest: [...lines.slice(0, top + 1), ...lines.slice(j)].join("\n") };
  }
  const field = (fs, ...names) => fs.find(([k]) => names.includes(k.toLowerCase()))?.[1] ?? "";
  const STATUS = /^(handled|partly|not yet|accepted|proposed|superseded|rejected|deprecated|draft|built|approved|waiting|designing|done|open)\b/i;
  const TONE = { handled: "ok", accepted: "ok", built: "ok", approved: "ok", done: "ok", partly: "warn", proposed: "warn", waiting: "warn", draft: "warn", designing: "warn" };
  const statusWord = (v) => { const m = plain(v).trim().match(STATUS); return m ? m[1].toLowerCase() : plain(v).trim().split(/[\s(;,.]/)[0].toLowerCase(); };
  const pill = (word) => (word ? h("span", { class: `st ${TONE[word] ?? "mute"}` }, STATUS.test(word) ? word : clip(word, 12)) : null);

  // ---------- cards from a markdown page: each h3 a card under its h2 (Vitals' use cases, Helix's scenarios) ----------
  function splitMd(text) {
    const out = { intro: [], groups: [] };
    let g = null, c = null, fence = false;
    for (const l of text.replace(/\r\n?/g, "\n").split("\n")) {
      if (/^ {0,3}(```|~~~)/.test(l)) fence = !fence;
      let m;
      if (!fence && /^# /.test(l)) continue;
      if (!fence && (m = l.match(/^## +(.*?)\s*#*$/))) { g = { title: m[1], body: [], cards: [] }; c = null; out.groups.push(g); continue; }
      if (!fence && g && (m = l.match(/^### +(.*?)\s*#*$/))) { c = { title: m[1], body: [] }; g.cards.push(c); continue; }
      (c ? c.body : g ? g.body : out.intro).push(l);
    }
    return out;
  }
  const cardCount = (text) => splitMd(text).groups.reduce((n, g) => n + g.cards.length, 0);
  /** The leading "- **Key:** value · **Key:** value" lines of a card. */
  function cardFields(body) {
    const fs = [];
    let i = 0;
    while (i < body.length && !body[i].trim()) i++;
    for (; i < body.length; i++) {
      const l = body[i];
      if (/^- \*\*[^*]+:\*\*/.test(l)) {
        for (const part of l.slice(2).split(/\s+·\s+(?=\*\*[^*]+:\*\*)/)) { const m = part.match(/^\*\*([^*]+?):\*\*\s*(.*)$/); if (m) fs.push([m[1], m[2], false]); }
      } else if (/^\s{2,}\S/.test(l) && fs.length) {
        if (/^\s+(\d+[.)]|-)\s/.test(l)) fs[fs.length - 1][2] = true; else if (!fs[fs.length - 1][2]) fs[fs.length - 1][1] += " " + l.trim();
      } else if (l.trim()) break;
    }
    return fs;
  }
  const FACE = ["actor", "door", "goal", "case", "expected", "who", "trigger"];
  function mdCards(text, ctx, focus, noun) {
    const doc = splitMd(text);
    const all = [];
    const st = { q: "", status: "" };
    const groups = doc.groups.map((g) => {
      if (!g.cards.length) {
        const ps = h("details", { class: "ucg-prose" }, h("summary", null, g.title), h("div", { class: "doc", html: md(g.body.join("\n"), ctx) }));
        return { el: ps, cards: [] };
      }
      const cards = g.cards.map((c) => {
        const fs = cardFields(c.body), id = slug(c.title);
        const status = statusWord(field(fs.map(([k, v]) => [k, v]), "status"));
        const face = fs.filter(([k]) => FACE.includes(k.toLowerCase()));
        const shown = (face.length ? face : fs.filter(([k]) => k.toLowerCase() !== "status")).slice(0, 3);
        const more = fs.map(([k]) => k).filter((k) => !shown.some(([s]) => s === k) && k.toLowerCase() !== "status");
        const det = h("details", { class: "uc-more", ontoggle: (e) => { if (e.target.open && !ctx.child) nav(libHref(ctx.key, ctx.sid, ctx.page.id, id), true); } },
          h("summary", null, more.length ? more.slice(0, 4).join(" · ") : "Read it"), h("div", { class: "doc", html: md(c.body.join("\n"), ctx) }));
        const el = h("article", { class: "card ucard", id: `c-${id}` },
          h("div", { class: "uc-h" }, h("b", null, c.title), fs.some(([k]) => k.toLowerCase() === "status") ? pill(status) : null),
          shown.length ? h("dl", { class: "uc-f" }, shown.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, clip(plain(v), 150))))) : null,
          det);
        const card = { el, det, id, status, hay: (c.title + " " + c.body.join(" ")).toLowerCase() };
        all.push(card);
        return card;
      });
      const count = h("span", { class: "muted" });
      const el = h("section", { class: "ucg" }, h("h3", { class: "ucg-h" }, g.title, " ", count), h("div", { class: "uc-grid" }, cards.map((c) => c.el)));
      return { el, cards, count };
    });
    const statuses = [...new Set(all.map((c) => c.status).filter((s) => s && STATUS.test(s)))];
    const n = all.length, areas = groups.filter((g) => g.cards.length).length;
    const count = h("span", { class: "count muted", "aria-live": "polite" });
    const q = h("input", { type: "search", placeholder: `Find ${noun.one === "case" ? "a case" : `a ${noun.one}`}`, "aria-label": `Find ${noun.one === "case" ? "a case" : `a ${noun.one}`}`, oninput: () => { st.q = q.value.trim().toLowerCase(); apply(); } });
    const seg = statuses.length > 1 ? h("span", { class: "seg filters" }, [["", "All"], ...statuses.map((s) => [s, s])].map(([v, t]) =>
      h("button", { type: "button", "aria-pressed": String(v === ""), onclick: (e) => { st.status = v; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); apply(); } },
        t, v ? h("span", { class: "count" }, ` ${all.filter((c) => c.status === v).length}`) : null))) : null;
    function apply() {
      let shown = 0;
      for (const g of groups) {
        if (!g.cards.length) { g.el.hidden = !!(st.q || st.status); continue; }
        let k = 0;
        for (const c of g.cards) { const on = (!st.q || c.hay.includes(st.q)) && (!st.status || c.status === st.status); c.el.hidden = !on; k += on; }
        g.el.hidden = !k; g.count.textContent = String(k); shown += k;
      }
      count.textContent = st.q || st.status ? `${shown} of ${n} ${noun.many}` : `${n} ${noun.many}${areas > 1 ? ` in ${areas} groups` : ""}`;
      none.hidden = shown > 0;
    }
    const none = h("p", { class: "muted", hidden: true }, `No ${noun.one} matches. Clear the find${seg ? " or pick All" : ""}.`);
    const intro = doc.intro.join("\n").trim() ? h("details", { class: "intro" }, h("summary", null, "About this page"), h("div", { class: "doc", html: md(doc.intro.join("\n"), ctx) })) : null;
    const el = h("div", { class: "cards-page" }, h("div", { class: "tax-bar" }, q, seg, count), intro, groups.map((g) => g.el), none);
    apply();
    el.open = (f) => { const c = all.find((x) => x.id === f); if (c) { c.det.open = true; c.el.scrollIntoView({ block: "start" }); } };
    return el;
  }

  // ---------- header: the Projects menu ----------
  function header(r) {
    const tabs = $("tabs");
    tabs.querySelectorAll(":scope > a").forEach((a) => (a.getAttribute("href") === `#${r.view}` ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const here = r.view === "project" ? PROJECTS.find((p) => p.key === r.key) : null;
    const btn = $("pm-btn");
    btn.firstChild.textContent = here ? here.name : "Projects";
    btn.setAttribute("aria-label", here ? `Projects: ${here.name}` : "Projects");
    here ? btn.setAttribute("aria-current", "page") : btn.removeAttribute("aria-current");
    $("pm-list").replaceChildren(...PROJECTS.map((p) => {
      const lib = libraryOf(p.key);
      return h("li", { class: `pm-row${here?.key === p.key ? " here" : ""}` },
        h("a", { class: "pm-name", href: `#project/${p.key}` }, p.name),
        h("span", { class: "pm-sub" }, LIBS[p.key]?.tagline ?? ""),
        lib ? h("a", { class: "pm-lib", href: libHref(p.key) }, "Library") : h("span", { class: "pm-nolib" }, "no library"));
    }));
  }
  function menu(open) {
    const btn = $("pm-btn"), pop = $("pm-pop");
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) pop.querySelector("a")?.focus();
  }
  $("pm-btn").addEventListener("click", () => menu($("pm-pop").hidden));
  $("pm-pop").addEventListener("click", (e) => { if (e.target.closest("a")) menu(false); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".pm")) menu(false);
    const a = e.target.closest("a[data-scroll]");
    if (a) { e.preventDefault(); document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ block: "start", behavior: "smooth" }); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("pm-pop").hidden) { menu(false); $("pm-btn").focus(); }
    if (!$("pm-pop").hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const links = [...$("pm-pop").querySelectorAll("a")], i = links.indexOf(document.activeElement);
      links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length].focus();
      e.preventDefault();
    }
  });

  // ---------- views ----------
  function overview() {
    return [
      h("div", { class: "card proto-asis" }, h("h3", null, "The Overview as built"), h("p", { class: "muted" }, "Needs you, Working now, CI and the rest are unchanged. Only the Projects rows below change: a Library link by each name.")),
      h("section", { class: "ov-proj" }, h("h2", null, "Projects"),
        h("div", { class: "plist" }, PROJECTS.map((p) => {
          const lib = libraryOf(p.key);
          return h("div", { class: "card prow" },
            h("div", { class: "pc pname" }, h("a", { href: `#project/${p.key}` }, p.name, h("span", { class: "chev", "aria-hidden": "true" }, " ›")),
              h("span", { class: "muted" }, [p.lead && `lead ${p.lead}`, p.po && `PO ${p.po}`, "mbp-1"].filter(Boolean).join(" · ")),
              lib ? h("a", { class: "plib", href: libHref(p.key) }, "Library") : null),
            ["Release", "Open now", "Next", "Backlog"].map((lab) => h("div", { class: "pc" }, h("span", { class: "lab" }, lab), h("span", { class: "muted" }, "as built"))));
        }))),
    ];
  }

  function projectHead(p, r) {
    const head = h("div", { class: "p-top" },
      h("div", { class: "p-title" }, h("a", { class: "back", href: "#overview" }, "‹ Overview"), h("h2", { class: "p-h" }, p.name),
        h("span", { class: "muted" }, [p.lead && `lead ${p.lead}`, p.po && `PO ${p.po}`, "mbp-1", p.repo].filter(Boolean).join(" · "))),
      h("span", { class: "seg projects" }, PROJECTS.map((q) => h("button", { type: "button", "aria-pressed": String(q.key === p.key), onclick: () => {
        // Another project keeps the tab, and the section.
        if (r.tab === "work") location.hash = `#project/${q.key}`;
        else location.hash = libHref(q.key, r.section);
      } }, q.name))));
    const lib = libraryOf(p.key);
    const tabs = h("div", { class: "p-tabs" },
      h("nav", { "aria-label": `${p.name}` },
        h("a", { href: `#project/${p.key}`, "aria-current": r.tab === "work" ? "page" : null }, "Work"),
        h("a", { href: libHref(p.key), "aria-current": r.tab === "library" ? "page" : null }, "Library")),
      r.tab === "library" && lib && proto.state !== "loading" ? fresh(lib) : null);
    return [head, tabs];
  }
  /** As of <ref> at <sha>, <date> · checked <ago> from <laptop>. */
  function fresh(m) {
    const late = behind(m) || m.problems.some((x) => x.what === "fetch");
    return h("span", { class: `fresh${late ? " warn" : ""}` }, `As of ${m.ref} at `,
      h("a", { href: `${m.github}/commit/${m.commit}`, target: "_blank", rel: "noopener", title: "This commit on GitHub" }, h("code", null, sha7(m.commit))),
      `, ${dayOf(m.committed_at)} ${clock(m.committed_at)} · checked ${ago(NOW - Date.parse(m.checked_at))} from ${m.laptop}`);
  }

  function work(p) {
    return h("div", { class: "card proto-asis" }, h("h3", null, `${p.name}'s page as built (BOB-182)`),
      h("p", { class: "muted" }, "Current release, Running now, Who ran lately, Waits on you, CI, Usage and Backlog health, unchanged. It is the Work tab now; Library is beside it."));
  }

  function banners(m) {
    const out = [];
    const fail = m.problems.find((x) => x.what === "fetch");
    if (fail) out.push(h("div", { class: "banner" }, h("b", null, `${m.laptop} couldn't fetch ${m.github.split("/").pop()} ${ago(NOW - Date.parse(fail.at))}`),
      h("span", null, `${fail.text}. The pages are ${m.ref} at ${sha7(m.commit)} (${dayOf(m.committed_at)}), last checked ${ago(NOW - Date.parse(m.checked_at))}. They update at its next fetch.`)));
    else if (behind(m)) out.push(h("div", { class: "banner" }, h("b", null, `This may be behind ${m.ref}`),
      h("span", null, `${m.laptop} last checked ${ago(NOW - Date.parse(m.checked_at))}; it checks every 10 minutes while it runs. The pages are ${m.ref} at ${sha7(m.commit)} (${dayOf(m.committed_at)}).`)));
    const miss = m.problems.filter((x) => x.what === "missing");
    if (miss.length) out.push(h("div", { class: "banner" }, h("b", null, `${miss.length === 1 ? "A page is" : `${miss.length} pages are`} missing on ${m.ref}`), h("span", null, miss.map((x) => x.text).join("; "), ".")));
    return out;
  }

  function library(p, r) {
    const lib = libraryOf(p.key);
    if (proto.state === "loading") {
      return h("div", { class: "lib" }, h("div", { class: "lib-rail" }, h("div", { class: "skel" }, h("i"), h("i"), h("i"), h("i"), h("i"), h("i"), h("i"))),
        h("div", { class: "doc-page" }, h("p", { class: "muted" }, "Reading the library…"), h("div", { class: "lib-tiles" }, [1, 2, 3, 4, 5, 6].map(() => h("div", { class: "card lib-tile skel" }, h("i"), h("i"))))));
    }
    if (!lib) {
      return h("div", { class: "empty-card lib-empty" }, h("b", null, `${p.name} has no library yet.`),
        h("p", null, "A library is a project's architecture, data model, decisions, use cases, UX design and glossary, from files on its main that ", h("code", null, ".bobnet/library.json"), " lists. Its architect writes that file; the supervisor on its laptop sends them here."),
        h("p", null, "A laptop whose supervisor is older than the release with libraries sends none."));
    }
    if (!r.section) return libFrame(p, lib, r, null, home(p, lib));
    const sec = secOf(r.section);
    if (!sec) return libFrame(p, lib, r, null, h("div", { class: "empty-card lib-empty" }, h("b", null, `A library has no section "${r.section}".`), h("p", null, h("a", { href: libHref(p.key) }, `${lib.title}'s sections`))));
    const pages = pagesOf(lib, sec.id);
    if (!pages.length) return libFrame(p, lib, r, sec, notWritten(p, lib, sec));
    const page = r.page ? pages.find((x) => x.id === r.page) : pages[0];
    if (!page) return libFrame(p, lib, r, sec, h("div", { class: "empty-card lib-empty" }, h("b", null, `${sec.label} has no page "${r.page}".`),
      h("p", null, "It may have been renamed in ", h("code", null, ".bobnet/library.json"), ". ", h("a", { href: libHref(p.key, sec.id) }, `${sec.label}'s pages`))));
    return libFrame(p, lib, r, sec, sectionView(p, lib, sec, page, r));
  }

  /** The rail: the seven sections in their fixed order, a missing one muted with who writes it. */
  function libFrame(p, lib, r, sec, content) {
    const owner = (s) => lib.sections[s.id]?.owner;
    const navLinks = [h("a", { href: libHref(p.key), "aria-current": !sec ? "page" : null }, h("span", null, "Home")),
      ...SECTIONS.flatMap((s) => {
        const pages = pagesOf(lib, s.id), cur = sec?.id === s.id;
        const row = h("a", { href: libHref(p.key, s.id), class: pages.length ? null : "missing", "aria-current": cur && (!r.page || pages.length < 2) ? "page" : cur ? "true" : null },
          h("span", null, s.label), pages.length ? null : h("small", null, `not written yet · ${s.role}`));
        const subs = cur && pages.length > 1 ? pages.map((x, i) => h("a", { class: "sub", href: libHref(p.key, s.id, x.id), "aria-current": (r.page ? r.page === x.id : i === 0) ? "page" : null }, h("span", null, pageLabel(x)))) : [];
        return [row, ...subs];
      })];
    const curName = sec ? sec.label : "Home";
    const rail = h("nav", { class: "lib-rail", "aria-label": `${lib.title} sections` },
      h("button", { type: "button", class: "secs-pick", "aria-expanded": "false", onclick: (e) => {
        const on = rail.classList.toggle("open"); e.currentTarget.setAttribute("aria-expanded", String(on));
      } }, h("span", null, h("span", { class: "muted" }, "Section: "), curName), h("span", { "aria-hidden": "true" }, "▾")),
      h("div", { class: "lab" }, lib.title),
      h("div", { class: "secs-nav" }, navLinks),
      h("div", { class: "foot" }, h("a", { href: lib.github, target: "_blank", rel: "noopener" }, "Repository ↗"),
        h("span", null, "Sections from ", h("a", { href: ghBlob(lib, ".bobnet/library.json"), target: "_blank", rel: "noopener" }, h("code", null, ".bobnet/library.json")))));
    // Version 3: a diagram page folds the rail into its head, at every width: the section's name opens the
    // sections, and the frame gets the page's width (spec §5).
    if (content.diagram) { rail.classList.add("folded"); content.head.prepend(rail); }
    const aside = content.toc?.length >= 3 ? h("aside", { class: "lib-toc", "aria-label": "On this page" }, h("div", { class: "lab" }, "On this page"), tocList(content.toc, content.tocHref)) : null;
    const wrap = h("div", { class: `lib${aside ? " has-toc" : ""}${content.diagram ? " diagram" : ""}` }, content.diagram ? null : rail, h("div", { class: "doc-col" }, banners(lib), content), aside);
    if (aside && window.innerWidth >= 1280) queueMicrotask(() => spy(wrap));
    return wrap;
  }
  const tocList = (toc, href) => h("ul", null, toc.map((t) => h("li", { class: `h${t.n}` }, href ? h("a", { href: href(t.id), dataset: { h: t.id } }, t.text) : h("a", { href: `#h-${t.id}`, "data-scroll": "", dataset: { h: t.id } }, t.text))));
  // A folded rail closes on a click outside it or on Escape.
  addEventListener("click", (e) => { for (const r of document.querySelectorAll(".lib-rail.folded.open")) if (!r.contains(e.target)) { r.classList.remove("open"); r.querySelector(".secs-pick").setAttribute("aria-expanded", "false"); } });
  addEventListener("keydown", (e) => { if (e.key !== "Escape") return; for (const r of document.querySelectorAll(".lib-rail.folded.open")) { r.classList.remove("open"); r.querySelector(".secs-pick").setAttribute("aria-expanded", "false"); r.querySelector(".secs-pick").focus(); } });
  function pageLabel(x) {
    return { likec4: x.title, erd: x.title, children: x.title }[x.kind] ?? x.title;
  }

  /** The library's home: the seven sections as tiles, each with what is in it at a glance. */
  function home(p, lib) {
    const tiles = SECTIONS.map((s) => {
      const pages = pagesOf(lib, s.id), owner = lib.sections[s.id]?.owner;
      if (!pages.length) return h("a", { class: "card lib-tile missing", href: libHref(p.key, s.id) }, h("b", null, s.label),
        h("span", { class: "nw" }, "Not written yet"), h("span", { class: "by" }, `the ${s.role} writes it`));
      return h("a", { class: "card lib-tile", href: libHref(p.key, s.id) }, h("b", null, s.label),
        h("ul", { class: "gl" }, pages.slice(0, 3).map((x) => h("li", null, glance(x, s)))),
        h("span", { class: "by" }, h("span", null, owner ?? s.role), h("span", null, `changed ${dayOf(latest(pages))}`)));
    });
    const written = SECTIONS.filter((s) => pagesOf(lib, s.id).length).length;
    return h("div", { class: "doc-page wide lib-home" },
      h("div", { class: "doc-head" }, h("h1", { class: "doc-title" }, lib.title), h("p", { class: "lede" }, lib.tagline)),
      h("div", { class: "lib-tiles" }, tiles),
      h("p", { class: "lib-how" }, `${written} of 7 sections written. Each is files on ${lib.ref} in ${lib.github.replace("https://github.com/", "")}; to change one, ask its owner.`));
  }
  const latest = (pages) => pages.map((x) => x.changed?.date).filter(Boolean).sort().pop() ?? "";
  const NOUN = { decisions: ["decision", "decisions"], ux: ["feature", "features"] };
  function glance(x, s) {
    const tag = (t) => h("span", { class: "k" }, t);
    if (x.kind === "likec4") return [tag("C4 diagram"), ` ${x.title}`];
    if (x.kind === "erd") return [tag("ERD"), ` ${x.title}`];
    if (x.kind === "mermaid") return [tag("diagram"), ` ${x.title}`];
    if (x.kind === "table") return [tag("table"), ` ${x.title}`];
    if (x.kind === "children") {
      const n = x.children.length, [one, many] = NOUN[s.id] ?? ["file", x.title.toLowerCase()];
      const newest = [...x.children].sort((a, b) => (b.changed?.date ?? "").localeCompare(a.changed?.date ?? "") || b.src.localeCompare(a.src, "en", { numeric: true }))[0];
      return [tag(`${n} ${n === 1 ? one : many}`), h("span", { class: "nw-s" }, ` latest: ${clip(cap(newest.title.replace(/^(?:ADR\s*)?\d{4}[.:]?\s*(?:[—–-]\s*)?|^BOB-\d+(?: design [A-Z])?:\s*/, "")), 64)}`)];
    }
    return [tag("page"), ` ${x.title}`];
  }

  /** A section with no pages: what it holds and who writes it (ADR 0016 §3). */
  function notWritten(p, lib, s) {
    return h("div", { class: "doc-page" },
      h("div", { class: "doc-head" }, h("h1", { class: "doc-title" }, s.label)),
      h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, `${s.label} isn't written yet.`),
        h("p", null, `It holds: ${s.holds.charAt(0).toLowerCase()}${s.holds.slice(1)}`),
        h("p", null, `The ${s.role} writes it${lib.sections[s.id]?.owner ? ` (${lib.sections[s.id].owner})` : ""}, as files on ${lib.ref}, and lists them under `, h("code", null, `sections.${s.id}`), " in ",
          h("a", { href: ghBlob(lib, ".bobnet/library.json"), target: "_blank", rel: "noopener" }, h("code", null, ".bobnet/library.json"), " ↗"), ".")));
  }

  /** A section: its title, its pages as tabs when it has more than one, then the page. */
  function sectionView(p, lib, sec, page, r) {
    const pages = pagesOf(lib, sec.id);
    const owner = page.owner ?? lib.sections[sec.id].owner;
    const head = h("div", { class: "sec-head" }, h("h1", { class: "doc-title" }, sec.label), h("span", { class: "muted" }, `owner ${owner}`));
    const tabs = pages.length > 1 ? h("nav", { class: "sec-tabs", "aria-label": `${sec.label} pages` }, pages.map((x) =>
      h("a", { href: libHref(p.key, sec.id, x.id), "aria-current": x === page ? "page" : null }, pageLabel(x), x.missing ? h("small", null, " missing") : null))) : null;
    const body = pageBody(p, lib, sec, page, r);
    const el = h("div", { class: `doc-page${["likec4", "erd", "table", "children"].includes(page.kind) || body.wide ? " wide" : ""}` }, head, tabs, body);
    el.toc = body.toc; el.tocHref = body.tocHref; el.frame = body.frame; el.cards = body.cards;
    el.diagram = !!body.frame; el.head = head;
    return el;
  }

  function pageBody(p, lib, sec, page, r) {
    if (page.missing) {
      return h("div", { class: "empty-card lib-empty" }, h("b", null, `${page.src} isn't on ${lib.ref} at ${sha7(lib.commit)}.`),
        h("p", null, `The library still lists it. Its owner (${page.owner ?? lib.sections[sec.id].owner}) moves the entry in `, h("code", null, ".bobnet/library.json"), " or puts the file back."),
        h("p", null, h("a", { href: `${lib.github}/commits/${lib.commit}/${page.src}`, target: "_blank", rel: "noopener" }, "Its history on GitHub ↗")));
    }
    if (page.kind === "likec4" || page.kind === "erd") {
      const ctx = { key: p.key, lib, sid: sec.id };
      const f = viewerFrame(page.kind, page, ctx, r.focus);
      const el = h("div", { class: "page-diagram" }, f);
      el.frame = f.frame;
      return el;
    }
    if (page.kind === "children") {
      if (r.focus) {
        const child = page.children.find((c) => c.id === r.focus);
        if (child) return childPage(p, lib, sec, page, child, r);
      }
      return childList(p, lib, sec, page);
    }
    const ctx = mdCtx(p.key, lib, sec.id, page, page.src, (id) => libHref(p.key, sec.id, page.id, id));
    const meta = h("div", { class: "doc-meta" },
      page.title ? h("b", { class: "pt" }, page.title) : null,
      page.changed ? h("span", null, "changed ", h("code", null, page.changed.sha), `, ${dayOf(page.changed.date)}`) : null,
      h("a", { href: ghBlob(lib, page.src), target: "_blank", rel: "noopener" }, `${page.src} ↗`));
    // A use-case page whose cases are h3s reads as cards, the prose behind each (spec §8).
    if (page.kind === "md" && sec.id === "usecases" && cardCount(page.text) >= 3) {
      ctx.headHref = null;
      const cards = mdCards(page.text, ctx, r.focus, { one: "use case", many: "use cases" });
      const el = h("div", { class: "doc-page wide" }, meta, cards);
      el.cards = cards; el.wide = true;
      return el;
    }
    let html;
    if (page.kind === "mermaid") html = md(`${page.intro}\n\n\`\`\`mermaid\n${page.text.trim()}\n\`\`\`\n`, ctx);
    else html = md(page.text, ctx);
    const doc = h("div", { class: "doc", html });
    const el = h("article", { class: "doc-body" }, meta, doc);
    if (ctx.toc.length >= 3) meta.after(h("details", { class: "toc-fold" }, h("summary", null, `On this page · ${ctx.toc.filter((t) => t.n === 2).length} sections`), tocList(ctx.toc, ctx.headHref)));
    if (page.kind === "table") { el.append(taxonomy(page)); el.wide = true; }
    if (ctx.diagrams.length) queueMicrotask(() => drawDiagrams(el, ctx));
    el.toc = page.kind === "table" ? null : ctx.toc; el.tocHref = ctx.headHref;
    return el;
  }

  // ---------- children: ADRs as a list, UX cards, use-case files (spec §8) ----------
  function childList(p, lib, sec, page) {
    const href = (c) => libHref(p.key, sec.id, page.id, c.id);
    if (sec.id === "decisions") return adrList(page, lib, href);
    if (sec.id === "ux") return uxCards(page, href);
    // Use cases: a card per file, its count of cases; the folder's README behind "About".
    const ctx = mdCtx(p.key, lib, sec.id, page, page.dir + "/README.md", null);
    const groups = [...new Set(page.children.map((c) => c.group))];
    return h("div", { class: "cards-page" },
      page.intro ? h("details", { class: "intro" }, h("summary", null, `About ${page.title.toLowerCase()}`), h("div", { class: "doc", html: md(page.intro, ctx) })) : null,
      groups.map((g) => h("section", { class: "ucg" }, g ? h("h3", { class: "ucg-h" }, g, " ", h("span", { class: "muted" }, String(page.children.filter((c) => c.group === g).length))) : null,
        h("div", { class: "uc-grid" }, page.children.filter((c) => c.group === g).map((c) => {
          const n = cardCount(c.text), crit = criteriaCount(c.text);
          return h("a", { class: "card ucard file", href: href(c) }, h("div", { class: "uc-h" }, h("b", null, c.title)),
            h("p", { class: "lede-s" }, clip(plain(ledeOf(c.text)), 170)),
            h("span", { class: "by" }, h("span", null, n >= 3 ? `${n} cases` : crit ? `${crit} criteria` : "a page"), c.owner ? h("span", null, c.owner) : null, h("span", null, `changed ${dayOf(c.changed.date)}`)));
        })))));
  }
  function ledeOf(text) {
    const { rest } = headOf(text);
    const para = [];
    for (const l of rest.split("\n")) {
      if (/^#/.test(l) || /^\s*[|>-]/.test(l) || /^\*\*[^*]+\*\*$/.test(l.trim())) { if (para.length) break; continue; }
      if (!l.trim()) { if (para.length) break; continue; }
      para.push(l.trim());
    }
    return para.join(" ").split(/(?<=[.!?])\s/)[0] ?? "";
  }
  function criteriaCount(text) {
    const m = text.match(/\n## Criteria[^\n]*\n([\s\S]*?)(\n## |$)/);
    return m ? (m[1].match(/^(?:\d+[.)]|-) /gm) || []).length : 0;
  }

  const SHOW_ADR = 40;
  function adrList(page, lib, href) {
    const rows = page.children.map((c) => {
      const { fields } = headOf(c.text);
      const status = field(fields, "status");
      const date = field(fields, "date").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? status.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
      const by = plain(field(fields, "decided by")).split(/[(,;]/)[0].trim() || plain(status).match(/\(([A-Z][a-z]+)[,)]/)?.[1] || "";
      return { c, num: c.src.match(/(\d{4})[-.][^/]*$/)?.[1] ?? "", title: c.title.replace(/^(?:ADR\s*)?\d{4}[.:]?\s*(?:[—–-]\s*)?/, ""), word: statusWord(status), date, by };
    }).sort((a, b) => b.num.localeCompare(a.num));
    const st = { q: "", status: "", all: false };
    const words = [...new Set(rows.map((r) => r.word))].filter((w) => w && STATUS.test(w));
    const q = h("input", { type: "search", placeholder: "Find a decision", "aria-label": "Find a decision", oninput: () => { st.q = q.value.trim().toLowerCase(); st.all = false; draw(); } });
    const seg = words.length > 1 ? h("span", { class: "seg filters" }, [["", "All"], ...words.map((w) => [w, w])].map(([v, t]) =>
      h("button", { type: "button", "aria-pressed": String(v === ""), onclick: (e) => { st.status = v; st.all = false; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } },
        t, h("span", { class: "count" }, ` ${v ? rows.filter((r) => r.word === v).length : rows.length}`)))) : null;
    const count = h("span", { class: "count muted", "aria-live": "polite" });
    const list = h("ol", { class: "adr-list" });
    const more = h("button", { type: "button", class: "tax-more", onclick: () => { st.all = true; draw(); } });
    const hay = rows.map((r) => `${r.num} ${r.title} ${r.word} ${r.by} ${r.c.text.slice(0, 4000)}`.toLowerCase());
    function draw() {
      const hit = rows.filter((r, i) => (!st.status || r.word === st.status) && (!st.q || hay[i].includes(st.q)));
      const shown = st.all ? hit : hit.slice(0, SHOW_ADR);
      count.textContent = st.q || st.status ? `${hit.length} of ${rows.length} decisions` : `${rows.length} decisions, newest first`;
      list.replaceChildren(...(shown.length ? shown.map((r) => h("li", null, h("a", { class: "adr", href: href(r.c) },
        h("span", { class: "n" }, r.num), h("span", { class: "t" }, r.title), h("span", { class: "s" }, pill(r.word)),
        h("span", { class: "d" }, r.date ? dayYear(r.date) : ""), h("span", { class: "b" }, r.by)))) : [h("li", { class: "muted none" }, "No decision matches. Clear the find or pick All.")]));
      more.hidden = hit.length <= shown.length;
      more.textContent = `Show the other ${hit.length - shown.length}`;
    }
    draw();
    return h("div", { class: "cards-page" }, h("div", { class: "tax-bar" }, q, seg, count), list, more);
  }

  function uxCards(page, href) {
    const cards = page.children.map((c) => {
      const f = c.head ?? Object.fromEntries(headOf(c.text).fields.map(([k, v]) => [k.toLowerCase(), v]));
      return { c, f, n: +(f.feature || "").replace(/\D/g, "") || 0 };
    }).sort((a, b) => b.n - a.n);
    return h("div", { class: "cards-page" }, h("div", { class: "tax-bar" }, h("span", { class: "count muted" }, `${cards.length} features, newest first`)),
      h("div", { class: "ux-grid" }, cards.map(({ c, f }) => {
        const title = cap(c.title.replace(/^BOB-\d+(?: design [A-Z])?:\s*/, "").replace(/,\s*spec$/, ""));
        const verdict = f.verdict ? h("div", { class: "ux-v" }, h("q", null, f.verdict), h("span", { class: "muted" }, [f["verdict by"], f["verdict date"] && dayOf(f["verdict date"])].filter(Boolean).join(" · ")))
          : statusWord(f.status || "") === "waiting" ? h("div", { class: "ux-v wait" }, "Waiting on Casper's verdict")
          : h("div", { class: "ux-v none" }, "No verdict on the card yet");
        return h("article", { class: "card ux-card" },
          h("div", { class: "ux-top" }, h("span", { class: "id" }, f.feature), pill(statusWord(f.status || ""))),
          h("b", { class: "ux-t" }, title), verdict,
          h("div", { class: "actions" }, h("a", { class: "btn", href: href(c) }, "Spec"),
            f.prototype ? h("a", { class: "btn", href: f.prototype, target: "_blank", rel: "noopener" }, "Prototype ↗") : null));
      })));
  }

  /** One child: its head as chips and fields, then the prose (or its cases as cards). */
  function childPage(p, lib, sec, page, child, r) {
    const { fields, rest } = headOf(child.text);
    const ctx = mdCtx(p.key, lib, sec.id, page, child.src, null);
    ctx.child = child.id;
    const status = field(fields, "status");
    const back = h("a", { class: "back", href: libHref(p.key, sec.id, page.id) }, `‹ ${page.title}`);
    const f = child.head;
    const chips = h("div", { class: "kv" },
      f ? [pill(statusWord(f.status || "")), f.verdict ? h("span", null, h("q", null, f.verdict), f["verdict by"] ? ` · ${f["verdict by"]}` : "", f["verdict date"] ? ` · ${dayOf(f["verdict date"])}` : "") : null,
        f.prototype ? h("a", { href: f.prototype, target: "_blank", rel: "noopener" }, "Prototype ↗") : null] : null,
      fields.length ? h("dl", { class: "uc-f wide" }, fields.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", { html: k.toLowerCase() === "status" ? `${pill(statusWord(v))?.outerHTML ?? ""} ${inline(v, ctx)}` : inline(v, ctx) })))) : null);
    const meta = h("div", { class: "doc-meta" },
      child.owner ? h("span", null, `owner ${child.owner}`) : null,
      h("span", null, "changed ", h("code", null, child.changed.sha), `, ${dayOf(child.changed.date)}`),
      h("a", { href: ghBlob(lib, child.src), target: "_blank", rel: "noopener" }, `${child.src} ↗`));
    const head = h("div", { class: "child-head" }, back, h("h2", { class: "child-t" }, child.title), chips, meta);
    if (sec.id === "usecases" && cardCount(child.text) >= 3) {
      const cards = mdCards(rest, ctx, null, { one: "case", many: "cases" });
      const el = h("div", { class: "doc-page wide" }, head, cards);
      el.wide = true;
      return el;
    }
    const html = md(rest, ctx);
    const el = h("article", { class: "doc-body" }, head, h("div", { class: "doc", html }));
    if (ctx.toc.length >= 3) meta.after(h("details", { class: "toc-fold" }, h("summary", null, `On this page · ${ctx.toc.filter((t) => t.n === 2).length} sections`), tocList(ctx.toc, null)));
    el.toc = ctx.toc; el.tocHref = null;
    return el;
  }

  // ---------- Helix's taxonomy: one table of every area's elements (build.py's merge), found and filtered here ----------
  const SHOW = 200;
  function taxonomy(page) {
    const rows = [];
    for (const a of page.areas) {
      const lines = a.text.split("\n").filter((l) => l.trim().startsWith("|"));
      const hdr = cells(lines[0]);
      for (const l of lines.slice(2)) { const c = cells(l), o = { area: a.label }; hdr.forEach((k, i) => (o[k] = (c[i] ?? "").replace(/`/g, ""))); rows.push(o); }
    }
    const st = { q: "", area: "", kind: "", all: false };
    const q = h("input", { type: "search", placeholder: "Find a key, element, calculation or source", "aria-label": "Find an element", oninput: () => { st.q = q.value.trim().toLowerCase(); st.all = false; draw(); } });
    const area = h("select", { "aria-label": "Area", onchange: () => { st.area = area.value; st.all = false; draw(); } }, h("option", { value: "" }, "All areas"), page.areas.map((a) => h("option", null, a.label)));
    const kinds = h("span", { class: "seg" }, [["", "All"], ["stored", "Stored"], ["derived", "Derived"]].map(([v, t]) =>
      h("button", { type: "button", "aria-pressed": String(v === ""), onclick: (e) => { st.kind = v; st.all = false; kinds.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } }, t)));
    const count = h("span", { class: "count muted", "aria-live": "polite" });
    const tb = h("tbody");
    const more = h("button", { type: "button", class: "tax-more", onclick: () => { st.all = true; draw(); } });
    const hay = rows.map((r) => Object.values(r).join(" ").toLowerCase());
    function draw() {
      const hit = rows.filter((r, i) => (!st.area || r.area === st.area) && (!st.kind || (r["stored or derived"] || "").startsWith(st.kind)) && (!st.q || hay[i].includes(st.q)));
      const shown = st.all ? hit : hit.slice(0, SHOW);
      count.textContent = `${hit.length} of ${rows.length} elements`;
      tb.replaceChildren(...(shown.length ? shown.map((r) => {
        const der = (r["stored or derived"] || "").startsWith("derived");
        return h("tr", null, h("td", { class: "k" }, r.key), h("td", { class: "ar", "data-label": "Area" }, r.area), h("td", { class: "ty", "data-label": "Type" }, r.type),
          h("td", { class: "un", "data-label": "Unit" }, r["unit of measure"]), h("td", { class: "kd" }, h("span", { class: `sd${der ? " d" : ""}` }, r["stored or derived"])),
          h("td", { class: "calc", "data-label": "Calculation" }, r.calculation), h("td", { class: "src", "data-label": "Source" }, r.source));
      }) : [h("tr", null, h("td", { colspan: "7", class: "muted" }, "No element matches. Clear the find or pick All areas."))]));
      more.hidden = hit.length <= shown.length;
      more.textContent = `Show the other ${hit.length - shown.length}`;
    }
    draw();
    return h("section", { class: "doc-page wide", style: "gap:10px" },
      h("h2", { class: "doc-title", style: "font-size:20px", id: "h-all-elements" }, "All elements"),
      h("div", { class: "tax-bar" }, q, area, kinds, count),
      h("div", { class: "tw tax-w" }, h("table", { class: "tax stack" },
        h("thead", null, h("tr", null, ["Key", "Area", "Type", "Unit", "Stored or derived", "Calculation", "Source"].map((t) => h("th", null, t)))), tb)),
      more);
  }

  /** On a wide screen, On this page marks the section being read. */
  function spy(root) {
    const links = [...root.querySelectorAll(".lib-toc a")];
    const hs = links.map((a) => document.getElementById(`h-${a.dataset.h}`)).filter(Boolean);
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.dataset.h === e.target.id.slice(2)));
    }, { rootMargin: "-80px 0px -70% 0px" });
    hs.forEach((x) => io.observe(x));
  }

  // ---------- draw ----------
  // The frame and the cards move the address themselves (a drill, a table, a card opened): nav() keeps render() from
  // drawing that address again.
  let last = null, cur = null, lastHref = null;
  function nav(href, replace) {
    if (location.hash === href) return;
    history[replace ? "replaceState" : "pushState"](null, "", href);
    lastHref = location.href;
  }
  function render(force) {
    if (!force && location.href === lastHref) return;
    lastHref = location.href;
    const r = route();
    header(r);
    const main = $("view");
    main.classList.add("wide");
    // Only the focus changed: the frame, the card or the heading moves; the page stays (a diagram isn't redrawn).
    // On a children page the focus is the child, so a new one is a new page.
    const kids = r.view === "project" && isChildrenPage(r);
    const same = !force && last && r.view === "project" && last.view === "project" && last.key === r.key && last.tab === r.tab && last.section === r.section && last.page === r.page && last.state === proto.state
      && (!kids || r.focus === last.focus);
    last = { ...r, state: proto.state };
    if (!same) {
      FRAMES.clear();
      document.body.classList.remove("vf-lock");
      let els;
      cur = null;
      if (r.view === "overview") els = overview();
      else if (r.view === "project") {
        const p = PROJECTS.find((x) => x.key === r.key);
        const body = r.tab === "work" ? work(p) : library(p, r);
        cur = body.querySelector?.(".doc-col > :last-child") ?? null;
        els = [...projectHead(p, r), body];
        document.title = r.tab === "library" ? `${p.name} library${r.section ? ` · ${secOf(r.section)?.label ?? ""}` : ""} · BobNet` : `${p.name} · BobNet`;
      } else els = [h("div", { class: "empty-card" }, "Not part of this prototype. ", h("a", { href: libHref("bobnet") }, "BobNet's library"))];
      main.replaceChildren(...els);
      window.scrollTo(0, 0);
    }
    if (!cur) return;
    if (cur.frame) cur.frame.setFocus(r.focus || "");
    else if (r.focus && kids) return;
    else if (r.focus && cur.cards) cur.cards.open(r.focus);
    else if (r.focus) { const el = document.getElementById(`h-${r.focus}`); if (el) el.scrollIntoView({ block: "start", behavior: same ? "smooth" : "auto" }); }
  }
  function isChildrenPage(r) {
    const lib = libraryOf(r.key);
    if (!lib || r.tab !== "library" || !r.section) return false;
    const pages = pagesOf(lib, r.section), page = r.page ? pages.find((x) => x.id === r.page) : pages[0];
    return page?.kind === "children";
  }

  // ---------- the prototype's state switch (not built) ----------
  const STATES = [["ok", "Checked 4 min ago"], ["behind", "May be behind main (5h)"], ["failed", "Last fetch failed"], ["missing", "A page missing on main"],
    ["slow", "A diagram still drawing (15 s, then its files)"], ["nodiagram", "A diagram with errors"], ["loading", "Reading the library"], ["none", "No library"]];
  document.body.append(h("details", { class: "proto-states" }, h("summary", null, "Prototype: states"),
    h("fieldset", null, STATES.map(([v, t]) => h("label", null, h("input", { type: "radio", name: "st", value: v, checked: v === "ok", onchange: () => { proto.state = v; render(true); } }), t)))));

  window.addEventListener("hashchange", () => render());
  window.addEventListener("popstate", () => render());
  render();
})();
