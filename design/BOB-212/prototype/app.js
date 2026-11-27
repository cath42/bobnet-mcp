// BOB-212 prototype, version 4 (the library standard, ADR 0017): the Projects menu, a project's Work · Library tabs,
// and a library in its seven fixed sections, each one file or folder under library/ on main, the same in every repo.
// The library shown is Toolshed, the standard's sample (architecture/spikes/bob212/sample/; data.js). BobNet, Helix
// and Vitals have no library/ yet, so theirs show the sections not written. Everything else is a stand-in.
(function () {
  "use strict";
  const LIBS = window.LIBS;
  const PROJECTS = [
    { key: "toolshed", name: "Toolshed", sample: true, lead: "Otto", po: "Wren" },
    { key: "bobnet", name: "BobNet", repo: "cath42/bobnet-mcp", ref: "v2", lead: "Mario", po: "Peach" },
    { key: "helix", name: "Helix", repo: "cath42/helix-navigator", ref: "main", lead: "Bob", po: "Picard" },
    { key: "vitals", name: "Vitals", repo: "cath42/vitals", ref: "main" },
  ];
  // ADR 0017 §1: the standard. One file or folder per section, fixed; the labels and "holds" lines are the page's.
  const SECTIONS = [
    { id: "overview", label: "Overview", role: "product owner", who: "product-owner", path: "library/overview.md", holds: "Goals, stakeholders, scope, constraints and quality goals." },
    { id: "architecture", label: "Architecture", role: "architect", who: "architect", path: "library/architecture/", holds: "The C4 model, from context to containers to components, each use case's flow, and where it runs." },
    { id: "data", label: "Data model", role: "architect", who: "architect", path: "library/data-model.dbml", holds: "Every table, its columns and relations, as diagrams: all tables, and the named ones." },
    { id: "decisions", label: "Decisions", role: "architect", who: "architect", path: "library/decisions/", card: "Decision", holds: "One record per decision: its context, the options, the decision, its consequences and its status." },
    { id: "usecases", label: "Use cases", role: "product owner", who: "product-owner", path: "library/usecases/", card: "Use case", holds: "One card per use case: its actor, goal, scenario and acceptance." },
    { id: "ux", label: "UX design", role: "designer", who: "designer", path: "library/ux/", card: "UX card", holds: "One card per feature: its screens and states, its prototype, and the owner's verdict with its date." },
    { id: "glossary", label: "Glossary", role: "product owner", who: "product-owner", path: "library/glossary.md", holds: "Terms in users' words, A to Z." },
  ];
  const GUIDE = "https://github.com/cath42/bobnet-mcp/blob/v2/architecture/library-standard.md";
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
  const dayYear = (iso) => { const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
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
  const listOf = (v) => (v || "").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
  const andJoin = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const store = { get: (k) => { try { return localStorage.getItem(`bob212.${k}`); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(`bob212.${k}`, v); } catch { /* private mode */ } } };

  // ---------- the route (ADR 0017 build A task 4) ----------
  // #overview · #project/<key> (Work) · #project/<key>/library[/<section>[/<item>[/<focus>]]]
  // <item>: a heading (overview), a view id (architecture), a diagram, "all" or a DiagramView (data), a card's number
  // (decisions, use cases, UX), a term (glossary). <focus>: a table (data), a heading (a card).
  function route() {
    const parts = (location.hash || "#project/toolshed/library").slice(1).split("/").map(decodeURIComponent);
    if (parts[0] === "project" && PROJECTS.some((p) => p.key === parts[1])) {
      const lib = parts[2] === "library";
      return { view: "project", key: parts[1], tab: lib ? "library" : "work", section: lib ? parts[3] || null : null, item: lib ? parts[4] || null : null, focus: lib ? parts[5] || null : null };
    }
    return { view: parts[0] || "overview" };
  }
  const libHref = (key, sec, item, focus) =>
    `#project/${key}/library${sec ? `/${sec}` : ""}${sec && item ? `/${encodeURIComponent(item)}` : ""}${sec && item && focus ? `/${encodeURIComponent(focus)}` : ""}`;

  // ---------- what the broker would answer (ADR 0015 §4, 0017 §4) ----------
  // The prototype's "breaks the standard" state adds a card that breaks two rules and a file the standard doesn't
  // name: what ADR 0017 §5 shows. The errors state breaks one line of the model and of the DBML, for the viewers.
  const BAD_ADR = { path: "library/decisions/0004-photos-in-object-storage.md", section: "decisions",
    text: "---\nstatus: decided\ndate: 2026-11-20\ndecision-makers: [Otto]\n---\n# Tool photos live in object storage\n\n## Context\n\nPhotos are most of the data by size, and the database's backups were slow with them in it.\n\n## Decision\n\nThe bytes go to the photo bucket; `photo.object_key` points at them.\n\n## Consequences\n\n- A photo and its row can drift apart; a nightly job lists the orphans.\n" };
  const PROBLEMS = [
    { kind: "standard", path: BAD_ADR.path, line: 2, message: "status is \"decided\": it is one of proposed, accepted, rejected, deprecated or superseded" },
    { kind: "standard", path: BAD_ADR.path, line: 12, message: "the heading Options is missing: Context, Options, Decision, Consequences, in that order" },
    { kind: "standard", path: "library/notes/counter-ideas.md", message: "the standard doesn't name this file, so it isn't shown" },
  ];
  /** The library as the read gives it, under the prototype's state. null: the laptop sent none. index null: no library/. */
  function libraryOf(key) {
    if (proto.state === "none") return null;
    const p = PROJECTS.find((x) => x.key === key), src = LIBS[key];
    const checked = { behind: 5 * 60, failed: 3 * 60 }[proto.state] ?? 4;
    if (!src) {
      // No library/ on main: what BobNet, Helix and Vitals show until each converts (ADR 0017 §5).
      return { key, title: p.name, ref: p.ref, commit: "5ed684a9c01d2e62e475d0a8fbe3cd9d22600000", committed_at: iso(NOW - 3 * 3600e3), checked_at: iso(NOW - checked * 60000),
        laptop: "mbp-1", github: `https://github.com/${p.repo}`, root: "", index: null, files: [], texts: {}, problems: [], owners: {} };
    }
    let files = src.index.files, problems = [];
    const texts = { ...src.texts };
    if (proto.state === "problems") {
      files = [...files, { path: BAD_ADR.path, section: "decisions", changed: { sha: "9c01d2e", date: iso(NOW - 2 * 86400e3) }, title: "Tool photos live in object storage",
        head: { status: "decided", date: "2026-11-20", "decision-makers": "[Otto]" } }];
      texts[BAD_ADR.path] = BAD_ADR.text;
      problems = PROBLEMS;
    }
    if (proto.state === "gloss") files = files.filter((f) => f.section !== "glossary");
    if (proto.state === "nodiagram") {
      texts["library/architecture/views.c4"] = texts["library/architecture/views.c4"].replace("toolshed.api.reservations -> toolshed.db", "toolshed.api.reservation -> toolshed.db");
      texts["library/data-model.dbml"] = texts["library/data-model.dbml"].replace("shed_id uuid [not null, ref: > shed.id]", "shed_id uuid [not null, ref: > sheds.id]");
    }
    if (proto.state === "failed") problems = [{ kind: "fetch", at: iso(NOW - 12 * 60000), message: "git fetch origin: Could not resolve host: github.com" }];
    const ov = files.find((f) => f.section === "overview")?.head ?? {};
    return { ...src, title: ov.title || p.name, tagline: ov.tagline || "", owners: { "product-owner": ov["product-owner"], architect: ov.architect, designer: ov.designer },
      checked_at: iso(NOW - checked * 60000), files, texts, problems };
  }
  const filesOf = (lib, sid) => lib.files.filter((f) => f.section === sid);
  const written = (lib, sid) => filesOf(lib, sid).length > 0;
  const behind = (m) => NOW - Date.parse(m.checked_at) > 2 * 3600e3;
  const ghBlob = (m, path, frag) => `${m.github}/blob/${m.commit}/${m.root}${path}${frag ? `#${frag}` : ""}`;
  const ghTree = (m, path) => `${m.github}/tree/${m.commit}/${m.root}${path}`;
  const secOf = (id) => SECTIONS.find((s) => s.id === id);
  const ownerOf = (lib, s) => lib.owners?.[s.who];
  const numOf = (path) => path.match(/\/(\d{4})-[^/]*$/)?.[1] ?? "";
  const cardsOf = (lib, sid) => filesOf(lib, sid).map((f) => ({ ...f, num: numOf(f.path), head: f.head ?? {} })).sort((a, b) => b.num.localeCompare(a.num));
  const problemsIn = (lib, sid) => lib.problems.filter((x) => x.kind === "standard" && (!sid || lib.files.find((f) => f.path === x.path)?.section === sid));
  // A use case's flow is the architecture's dynamic view uc<NNNN> (ADR 0017 §2). The page finds it in the .c4 text.
  const flowOf = (lib, num) => (filesOf(lib, "architecture").some((f) => new RegExp(`\\bdynamic\\s+view\\s+uc${num}\\b`).test(lib.texts[f.path] ?? "")) ? `uc${num}` : null);
  // The UX cards that name a use case, by its number.
  const uxFor = (lib, num) => cardsOf(lib, "ux").filter((c) => listOf(c.head["use-cases"]).includes(num));

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

  /** Where a library file opens in the page: its section, and a card's number. null: not a file the library shows. */
  function findInLib(lib, path, frag) {
    const f = lib.files.find((x) => x.path === path);
    if (!f) return null;
    if (secOf(f.section).card) return libHref(lib.key, f.section, numOf(path), frag ? slug(frag) : null);
    return libHref(lib.key, f.section, frag && ["overview", "glossary"].includes(f.section) ? slug(frag) : null);
  }
  /** A link in a page: to a library file in place, to any other repo file on GitHub at the commit shown, http(s) out; anything else is dead text. */
  function link(href, label, ctx) {
    if (href.startsWith("#")) return ctx.headHref ? `<a href="${ctx.headHref(slug(href.slice(1)))}">${label}</a>` : `<a href="#h-${slug(href.slice(1))}" data-scroll>${label}</a>`;
    if (/^https?:\/\//.test(href)) return `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return `<span class="dead" title="Not a web link">${label}</span>`;
    const [path, frag] = href.split("#");
    const target = path ? normPath(ctx.base.replace(/[^/]*$/, "") + path) : ctx.base;
    const hit = findInLib(ctx.lib, target, frag);
    if (hit) return `<a href="${hit}">${label}</a>`;
    return `<a class="ext" href="${esc(ghBlob(ctx.lib, target, frag))}" target="_blank" rel="noopener" title="${esc(target)} on GitHub at ${sha7(ctx.lib.commit)}">${label}</a>`;
  }
  function normPath(p) {
    const out = [];
    for (const s of p.split("/")) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); }
    return out.join("/");
  }
  const mdCtx = (lib, sid, base, title, headHref) => ({ key: lib.key, lib, sid, page: { title }, base, headHref, toc: [], diagrams: [] });
  /** A Markdown file's text without its front matter and its # title (the page shows both its own way). */
  const bodyOf = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^\s*# .*\n/, "");

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


  // ---------- zoomable diagrams: LikeC4 and BobNet's own ERD viewer in a sandboxed frame (ADR 0016 §6, 0017 §7; spec §9, §10) ----------
  const FRAMES = new Set();
  addEventListener("message", (e) => { for (const f of FRAMES) if (e.source === f.win()) f.on(e.data || {}); });
  const coarse = matchMedia("(pointer: coarse)");
  const phoneQ = matchMedia("(max-width: 760px)");
  const diagramLabel = (id) => (id === "all" ? "All tables" : cap(id.replace(/[_-]+/g, " ")));
  // ADR 0017 §2's fixed view ids, grouped for the picker; any other id is a deployment view.
  const viewKind = (id) => (id === "index" || id === "containers" || /Components$/.test(id) ? "c4" : /^uc\d{4}$/.test(id) ? "flow" : "deploy");

  function viewerFrame(kind, ctx, item, focus) {
    const c4 = kind === "likec4", lib = ctx.lib;
    const diagram = c4 ? null : item || "all";
    const dbml = c4 ? null : filesOf(lib, "data")[0];
    const files = c4 ? filesOf(lib, "architecture").map((f) => ({ path: f.path, text: lib.texts[f.path] })) : [{ path: dbml.path, text: lib.texts[dbml.path] }];
    // Version 5: which tables are open, per diagram, kept on the device (ADR 0017 §7, Q-22). None, the first time.
    const openKey = c4 ? null : `expanded.${lib.key}.${diagram}`;
    const cachedViews = c4 ? [] : JSON.parse(store.get(`views.${dbml.blob}`) || "null");
    const st = { ready: false, views: c4 ? [] : cachedViews || [], tables: [], enums: new Map(), note: "", shown: new Set(), errors: [], timer: 0,
      focus: c4 ? item || "index" : focus || "", open: c4 ? [] : JSON.parse(store.get(openKey) || "[]") };
    const post = (m) => iframe.contentWindow?.postMessage(m, "*");
    const go = (f) => {
      if (c4) { nav(libHref(ctx.key, "architecture", f || "index")); setFocus(f || "index"); return; }
      if (f && st.ready && !st.shown.has(f)) return nav(libHref(ctx.key, "data", "all", f), false, true); // another diagram: a new frame
      nav(libHref(ctx.key, "data", diagram, f || null)); setFocus(f || "");
    };
    const crumb = h("div", { class: "vf-crumb", "aria-label": c4 ? "Level" : "Table" });
    const sub = h("span", { class: "vf-title" });
    const back = h("button", { type: "button", class: "vf-back", title: "One level out", "aria-label": "One level out", onclick: () => go(parentOf()) }, "↑ Out");
    const pick = h("select", { class: "vf-pick", "aria-label": c4 ? "Go to a view" : "Find a table", onchange: (e) => {
      go(e.target.value);
      if (box.getBoundingClientRect().bottom > innerHeight) wrap.scrollIntoView({ block: "start" }); // a phone: bring the frame up
    } });
    // Version 5: each table opens on its own node, in the frame. The bar has only a small extra: open or close them all.
    const expAll = h("button", { type: "button", class: "lnk", disabled: true, onclick: () => setOpen([...st.shown], true) }, "Expand all");
    const colAll = h("button", { type: "button", class: "lnk", disabled: true, onclick: () => setOpen([], true) }, "Collapse all");
    const seg = c4 ? null : h("span", { class: "vf-all", role: "group", "aria-label": "Every table in this diagram" }, expAll, colAll);
    const fit = h("button", { type: "button", onclick: () => post({ t: "fit" }) }, "Fit");
    const fullB = h("button", { type: "button", class: "vf-full-b", onclick: () => full(!wrap.classList.contains("full")) }, "Full screen");
    const done = h("button", { type: "button", class: "vf-done", onclick: () => wrap.classList.remove("exploring") }, "Done");
    const iframe = h("iframe", { sandbox: "allow-scripts", src: c4 ? "vendor/likec4-viewer.html" : "vendor/erd-viewer.html", title: c4 ? `${lib.title}'s architecture: a diagram you can zoom and open` : `${lib.title}'s data model, ${diagramLabel(diagram)}: the tables and their relations` });
    const veil = h("div", { class: "vf-veil" }, h("div", { class: "vf-load" }, h("b", null, c4 ? "Drawing the model…" : "Drawing the data model…"),
      h("span", null, `The first time on this device, the viewer downloads (${c4 ? "2.4" : "0.9"} MB).`), h("div", { class: "skel" }, h("i"), h("i"), h("i"))));
    const touch = h("button", { type: "button", class: "vf-touch", onclick: () => wrap.classList.add("exploring") },
      h("b", null, "Tap to explore"), h("span", null, c4 ? "Then pinch to zoom, drag to move, tap a box to open it" : "Then tap ▸ on a table for its columns, tap its name for its card"));
    const peek = h("div", { class: "ent-peek", hidden: true, "aria-hidden": "true" });
    const ent = h("div", { class: "ent-slot" });
    const box = h("div", { class: "vf-box" }, iframe, veil, touch, peek, ent);
    const warnLine = h("div", { class: "vf-warn", hidden: true });
    const lineLink = (x) => {
      const path = c4 ? `library/architecture/${x.path}` : x.path;
      return [h("a", { href: ghBlob(lib, path, x.line ? `L${x.line}` : null), target: "_blank", rel: "noopener" }, `${path.split("/").pop()}${x.line ? ` line ${x.line}` : ""} ↗`), `: ${x.message}`];
    };
    const foot = h("div", { class: "vf-foot" }, c4
      ? ["Model: ", h("a", { href: ghTree(lib, "library/architecture"), target: "_blank", rel: "noopener" }, "library/architecture/ ↗"), ` · LikeC4 · ${lib.ref} at ${sha7(lib.commit)}`]
      : ["Model: ", h("a", { href: ghBlob(lib, dbml.path), target: "_blank", rel: "noopener" }, "data-model.dbml ↗"), ` · DBML · ${lib.ref} at ${sha7(lib.commit)}`]);
    const wrap = h("div", { class: `vf vf-${kind}` },
      h("div", { class: "vf-bar" }, h("div", { class: "vf-where" }, crumb, sub), h("span", { class: "vf-act" }, c4 ? back : seg, pick, h("span", { class: "vf-btns" }, fit, fullB, done))),
      warnLine, box, foot);

    // ---- the diagrams, as tabs in the section's head (spec §10.1): All tables, then each DiagramView ----
    const tabs = c4 ? null : h("nav", { class: "sec-tabs dia-tabs", "aria-label": "Diagrams" });
    function drawTabs() {
      if (c4) return;
      const all = [{ id: "all", n: st.tables.length || null }, ...st.views.map((v) => ({ id: v.id, n: v.tables.length }))];
      tabs.replaceChildren(...all.map((d) => h("a", { href: libHref(ctx.key, "data", d.id, st.focus && (d.id === "all" || st.views.find((v) => v.id === d.id)?.tables.includes(st.focus)) ? st.focus : null),
        "aria-current": d.id === diagram ? "page" : null }, diagramLabel(d.id), d.n ? h("span", { class: "n" }, ` ${d.n}`) : null)),
        ...(!st.ready && !cachedViews ? [h("span", { class: "skel-t", "aria-hidden": "true" })] : []));
    }

    // ---- the ERD's entity card (spec §10.2): what the table is, where it is drawn, its relations and fields ----
    const T = new Map(), refBy = new Map();
    function index() {
      T.clear(); refBy.clear();
      for (const t of st.tables) T.set(t.name, t);
      for (const t of st.tables) for (const f of t.fks) if (f.table !== t.name) refBy.set(f.table, [...(refBy.get(f.table) ?? []), t.name]);
    }
    const uniq = (xs) => [...new Set(xs)];
    // A one-to-one: the foreign key's column is unique (ADR 0017 §3).
    const oneToOne = (t, f) => f.columns.length === 1 && t.columns.find((c) => c.name === f.columns[0])?.unique;
    function relChips(names, dir, one) {
      const more = names.length > 8;
      const chip = (n) => {
        const out = st.ready && !st.shown.has(n);
        return h("button", { type: "button", class: `chip-b mono${out ? " out" : ""}`, title: out ? `Not in ${diagramLabel(diagram)}: opens it in All tables` : null, onclick: () => go(n) },
          dir === "out" ? "→ " : "← ", n, one.has(n) ? h("span", { class: "one" }, " 1:1") : null);
      };
      const row = h("div", { class: "ent-rel" }, names.slice(0, 8).map(chip));
      if (more) row.append(h("button", { type: "button", class: "chip-b ghost", onclick: (e) => { e.currentTarget.replaceWith(...names.slice(8).map(chip)); } }, `${names.length - 8} more`));
      return row;
    }
    function colRow(t, c, fkOf) {
      const to = fkOf.get(c.name), en = st.enums.get(c.type), pk = t.pk.includes(c.name);
      return h("li", null, h("span", { class: "cn" }, c.name),
        h("span", { class: "ct" }, c.type, pk ? h("span", { class: "tag" }, "PK") : null, c.unique && !pk ? h("span", { class: "tag u" }, "unique") : null,
          !c.notNull && !pk ? h("span", { class: "tag n" }, "may be null") : null, c.default != null ? h("span", { class: "dflt" }, ` = ${c.default}`) : null),
        to ? h("button", { type: "button", class: "ent-to", onclick: () => go(to) }, `→ ${to}`) : null,
        c.comment ? h("small", null, clip(plain(c.comment), 170)) : null,
        en ? h("ul", { class: "ent-enum", "aria-label": `${c.type}'s values` }, en.values.map((v) => h("li", null, h("code", null, v.name), v.note ? ` ${v.note}` : null))) : null);
    }
    function entCard(t) {
      const fkOf = new Map(t.fks.flatMap((f) => f.columns.map((c) => [c, f.table])));
      const key = t.columns.filter((c) => t.pk.includes(c.name) || fkOf.has(c.name)), rest = t.columns.filter((c) => !key.includes(c));
      const outs = uniq(t.fks.map((f) => f.table).filter((n) => n !== t.name)), ins = uniq(refBy.get(t.name) ?? []);
      const one = new Set([...t.fks.filter((f) => oneToOne(t, f)).map((f) => f.table),
        ...ins.filter((n) => T.get(n).fks.some((f) => f.table === t.name && oneToOne(T.get(n), f)))]);
      const inViews = st.views.filter((v) => v.tables.includes(t.name));
      return h("aside", { class: "ent", "aria-label": `${t.name}: what it is` },
        h("div", { class: "ent-h" }, h("b", null, t.name), h("span", { class: "muted" }, `${t.columns.length} columns`),
          h("button", { type: "button", class: "ent-x", "aria-label": "Close: show all tables", onclick: () => go("") }, "×")),
        t.comment ? h("p", { class: "ent-d" }, plain(t.comment)) : h("p", { class: "ent-d none" }, "No note: the data model has no Note on this table."),
        inViews.length ? h("div", { class: "ent-in" }, h("span", { class: "ent-sub" }, "Drawn in"),
          [{ id: "all" }, ...inViews].map((v) => v.id === diagram ? h("span", { class: "chip-b here", "aria-current": "true" }, diagramLabel(v.id))
            : h("a", { class: "chip-b", href: libHref(ctx.key, "data", v.id, t.name) }, diagramLabel(v.id)))) : null,
        outs.length || ins.length ? h("div", { class: "ent-s" }, h("div", { class: "lab" }, "Relations"),
          outs.length ? [h("span", { class: "ent-sub" }, "It refers to"), relChips(outs, "out", one)] : null,
          ins.length ? [h("span", { class: "ent-sub" }, "Referred to by"), relChips(ins, "in", one)] : null) : null,
        key.length ? h("div", { class: "ent-s" }, h("div", { class: "lab" }, "Key fields"), h("ul", { class: "ent-cols" }, key.map((c) => colRow(t, c, fkOf)))) : null,
        rest.length ? h("details", { class: "ent-all", open: !key.length || null }, h("summary", null, `${key.length ? "The other" : "All"} ${rest.length} column${rest.length > 1 ? "s" : ""}`),
          h("ul", { class: "ent-cols" }, rest.map((c) => colRow(t, c, fkOf)))) : null,
        t.line ? h("a", { class: "ent-dict", href: ghBlob(lib, dbml.path, `L${t.line}`), target: "_blank", rel: "noopener" }, `In data-model.dbml, line ${t.line} ↗`) : null);
    }
    function drawEnt() {
      if (c4) return;
      const t = st.focus && T.get(st.focus);
      ent.replaceChildren(...(t ? [entCard(t)] : []));
      wrap.classList.toggle("has-ent", !!t);
      // The part of the frame the card covers, so the viewer puts an opened table where it can be seen (spec §10.2).
      const b = box.getBoundingClientRect(), c = ent.firstChild?.getBoundingClientRect();
      post({ t: "inset", right: c && !phoneQ.matches ? Math.round(b.right - c.left) : 0, bottom: c && phoneQ.matches ? Math.round(b.bottom - c.top) : 0 });
      if (t && peek.dataset.t === t.name) peek.hidden = true;
    }
    function hover(name, r) {
      const t = name && T.get(name);
      if (!t || name === st.focus || coarse.matches) { peek.hidden = true; delete peek.dataset.t; return; }
      peek.dataset.t = name;
      peek.replaceChildren(h("b", null, name), t.comment ? h("span", null, clip(plain(t.comment), 150)) : null, h("small", null, "Click for its fields and relations"));
      peek.hidden = false;
      const W = box.clientWidth, H = box.clientHeight, pw = peek.offsetWidth, ph = peek.offsetHeight;
      peek.style.left = `${Math.max(8, Math.min(r.x, W - pw - 8))}px`;
      peek.style.top = `${r.y + r.h + 8 + ph < H ? r.y + r.h + 8 : Math.max(8, r.y - ph - 8)}px`;
    }
    function setOpen(names, mine) {
      st.open = [...names].sort();
      store.set(openKey, JSON.stringify(st.open));
      expAll.disabled = !st.ready || st.open.length >= st.shown.size;
      colAll.disabled = !st.ready || !st.open.length;
      if (mine) post({ t: "expand", tables: st.open });
    }

    const viewOf = (id) => st.views.find((v) => v.id === id);
    function parentOf() {
      const cr = viewOf(st.focus)?.crumb ?? [];
      return cr.length > 1 ? cr[cr.length - 2] : null;
    }
    // What level a view is, under the crumb (hidden on a phone): the C4 level, a use case's flow, or a deployment.
    function levelOf(v) {
      const k = viewKind(v.id);
      if (k === "flow") {
        const n = v.id.slice(2), uc = cardsOf(lib, "usecases").find((c) => c.num === n);
        return uc ? h("a", { href: libHref(ctx.key, "usecases", n) }, `The flow of use case ${n}: ${uc.title} ›`) : `A flow: use case ${n} has no card`;
      }
      if (k === "deploy") return "Where it runs";
      return v.id === "index" ? "Level 1: the context" : v.id === "containers" ? "Level 2: its containers" : `Level 3: the components of ${v.label}`;
    }
    function draw() {
      if (c4) {
        const v = viewOf(st.focus), cr = v?.crumb ?? [st.focus];
        crumb.replaceChildren(...cr.flatMap((id, i) => {
          const lab = viewOf(id)?.label ?? id, last = i === cr.length - 1;
          return [i ? h("span", { class: "sep", "aria-hidden": "true" }, "›") : null,
            last ? h("b", { "aria-current": "location" }, lab) : h("a", { href: libHref(ctx.key, "architecture", id), onclick: (e) => { e.preventDefault(); go(id); } }, lab)].filter(Boolean);
        }));
        sub.replaceChildren(v ? levelOf(v) : "");
        back.disabled = cr.length < 2;
        const group = (k, label, name) => {
          const vs = st.views.filter((x) => viewKind(x.id) === k);
          return vs.length ? h("optgroup", { label }, vs.map((x) => h("option", { value: x.id, selected: x.id === st.focus }, name(x)))) : null;
        };
        pick.replaceChildren(h("option", { value: "", disabled: true }, `${st.views.length} views`),
          group("c4", "C4 levels", (x) => (x.id === "index" ? "Context" : x.id === "containers" ? "Containers" : `${x.label}: components`)),
          group("flow", "Use-case flows", (x) => `${x.id.slice(2)} · ${x.title}`),
          group("deploy", "Deployment", (x) => x.title));
      } else {
        const n = st.shown.size || st.tables.length, dl = diagramLabel(diagram);
        crumb.replaceChildren(st.focus ? h("a", { href: libHref(ctx.key, "data", diagram), onclick: (e) => { e.preventDefault(); go(""); } }, dl) : h("b", null, dl),
          ...(st.focus ? [h("span", { class: "sep", "aria-hidden": "true" }, "›"), h("b", { "aria-current": "location" }, st.focus)] : []));
        sub.replaceChildren(st.note ? clip(st.note, 140) : "");
        pick.replaceChildren(h("option", { value: "", selected: !st.focus }, `Find a table (${n})`),
          ...st.tables.filter((t) => st.shown.has(t.name)).sort((a, b) => a.name.localeCompare(b.name)).map((t) => h("option", { value: t.name, selected: t.name === st.focus }, t.name)));
        drawTabs();
        drawEnt();
      }
      pick.disabled = !(c4 ? st.views.length : st.tables.length);
    }
    function setFocus(f) {
      f = f || (c4 ? "index" : "");
      if (f === st.focus) return;
      st.focus = f;
      post({ t: "focus", focus: f });
      draw();
    }
    function fail(why, errors) {
      clearTimeout(st.timer);
      st.ready = true;
      drawTabs();
      const what = c4 ? "This model" : "This data model";
      box.replaceWith(h("div", { class: "vf-fail" }, h("b", null, `${what} couldn't be drawn here.`), h("p", null, why),
        errors?.length ? h("ul", { class: "errs" }, errors.map((x) => h("li", null, lineLink(x)))) : null,
        h("p", { class: "muted" }, `Its ${files.length === 1 ? "file" : `${files.length} files`} on GitHub at ${sha7(lib.commit)}:`),
        h("ul", { class: "files" }, files.map((f) => h("li", null, h("a", { href: ghBlob(lib, f.path), target: "_blank", rel: "noopener" }, `${f.path} ↗`), h("span", { class: "muted" }, ` ${kb(f.text)}`)))),
        h("div", { class: "actions" }, h("button", { type: "button", onclick: () => render(true) }, "Try again"))));
      for (const b of [back, fit, fullB, pick, ...(seg ? seg.querySelectorAll("button") : [])]) b.disabled = true;
    }
    function full(on) {
      wrap.classList.toggle("full", on);
      document.body.classList.toggle("vf-lock", on);
      fullB.textContent = on ? "Close" : "Full screen";
      if (on) fullB.focus();
      if (!c4) queueMicrotask(drawEnt);
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
          post(c4 ? { t: "files", kind, files, focus: st.focus } : { t: "files", kind: "erd", files, view: diagram === "all" ? null : diagram, expanded: st.open, focus: st.focus });
        }
        if (d.t === "ready") {
          clearTimeout(st.timer);
          st.ready = true; st.errors = d.errors || [];
          if (c4) {
            st.views = d.views || [];
            if (!st.views.length) return fail("The viewer found errors in it:", st.errors);
            if (!viewOf(st.focus)) st.focus = "index";
          } else {
            if (!d.tables?.length) return fail("The viewer found errors in it:", st.errors);
            st.views = d.views || []; st.note = d.note || ""; st.shown = new Set(d.shown || []);
            // The viewer's model calls a note `note`; the card reads `comment`.
            st.tables = d.tables.map((t) => ({ ...t, comment: t.note, columns: t.columns.map((c) => ({ ...c, comment: c.note })) }));
            setOpen(d.expanded || [], false);
            st.enums = new Map((d.enums || []).map((x) => [x.name, x]));
            store.set(`views.${dbml.blob}`, JSON.stringify(st.views));
            if (diagram !== "all" && !st.views.some((v) => v.id === diagram)) return fail(`It has no diagram "${diagram}". `, []);
            index();
            if (st.focus && !st.shown.has(st.focus)) st.focus = "";
          }
          veil.hidden = true;
          if (st.errors.length) {
            warnLine.hidden = false;
            warnLine.replaceChildren(h("details", null, h("summary", null, `${st.errors.length} problem${st.errors.length > 1 ? "s" : ""} in the model: what they touch may be missing`),
              h("ul", { class: "errs" }, st.errors.map((x) => h("li", null, lineLink(x))))));
          }
          draw();
        }
        if (d.t === "focus") {
          st.focus = d.focus || (c4 ? "index" : "");
          nav(c4 ? libHref(ctx.key, "architecture", st.focus) : libHref(ctx.key, "data", diagram, d.focus || null));
          draw();
        }
        if (d.t === "expanded" && !c4) setOpen(d.tables || [], false); // the reader opened or closed one on its node
        if (d.t === "hover" && !c4) hover(d.table, d.rect);
      },
    };
    st.timer = setTimeout(() => { if (!st.ready) fail("The viewer didn't answer within 15 seconds."); }, 15000);
    FRAMES.add(me);
    draw();
    wrap.frame = me;
    wrap.tabs = tabs;
    return wrap;
  }

  // ---------- status pills: the standard's values for each card (ADR 0017 §2) ----------
  const TONE = { accepted: "ok", agreed: "ok", built: "ok", approved: "ok", proposed: "warn", draft: "warn", "in review": "warn", "changes asked": "warn",
    superseded: "mute", rejected: "mute", deprecated: "mute", retired: "mute" };
  const pill = (word) => (word ? h("span", { class: `st ${TONE[word] ?? "odd"}`, title: TONE[word] ? null : "Not one of the standard's statuses" }, TONE[word] ? word : `${clip(word, 12)} ?`) : null);

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
        h("a", { class: "pm-name", href: `#project/${p.key}` }, p.name, p.sample ? h("span", { class: "proto-tag" }, "sample") : null),
        h("span", { class: "pm-sub" }, lib?.index ? lib.tagline : "Library not written yet"),
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
      h("div", { class: "p-title" }, h("a", { class: "back", href: "#overview" }, "‹ Overview"), h("h2", { class: "p-h" }, p.name, p.sample ? h("span", { class: "proto-tag" }, "sample") : null),
        h("span", { class: "muted" }, p.sample ? "The library standard's sample project: fictional, every section written" : [p.lead && `lead ${p.lead}`, p.po && `PO ${p.po}`, "mbp-1", p.repo].filter(Boolean).join(" · "))),
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
  /** As of <ref> at <sha>, <date> · checked <ago> from <laptop> · n problems. */
  function fresh(m) {
    const late = behind(m) || m.problems.some((x) => x.kind === "fetch"), n = problemsIn(m).length;
    return h("span", { class: `fresh${late ? " warn" : ""}` }, `As of ${m.ref} at `,
      h("a", { href: `${m.github}/commit/${m.commit}`, target: "_blank", rel: "noopener", title: "This commit on GitHub" }, h("code", null, sha7(m.commit))),
      `, ${dayOf(m.committed_at)} ${clock(m.committed_at)} · checked ${ago(NOW - Date.parse(m.checked_at))} from ${m.laptop}`,
      n ? [" · ", h("a", { class: "probs-n", href: `${libHref(m.key)}` }, `${n} problem${n > 1 ? "s" : ""}`)] : null);
  }

  function work(p) {
    return h("div", { class: "card proto-asis" }, h("h3", null, `${p.name}'s page as built (BOB-182)`),
      h("p", { class: "muted" }, "Current release, Running now, Who ran lately, Waits on you, CI, Usage and Backlog health, unchanged. It is the Work tab now; Library is beside it."));
  }

  function banners(m) {
    const out = [];
    const fail = m.problems.find((x) => x.kind === "fetch");
    if (fail) out.push(h("div", { class: "banner" }, h("b", null, `${m.laptop} couldn't fetch ${m.title} ${ago(NOW - Date.parse(fail.at))}`),
      h("span", null, `${fail.message}. The library is ${m.ref} at ${sha7(m.commit)} (${dayOf(m.committed_at)}), last checked ${ago(NOW - Date.parse(m.checked_at))}. It updates at the next fetch.`)));
    else if (behind(m)) out.push(h("div", { class: "banner" }, h("b", null, `This may be behind ${m.ref}`),
      h("span", null, `${m.laptop} last checked ${ago(NOW - Date.parse(m.checked_at))}; it checks every 10 minutes while it runs. The library is ${m.ref} at ${sha7(m.commit)} (${dayOf(m.committed_at)}).`)));
    return out;
  }
  /** The files that break the standard (ADR 0017 §4, §5): by file and line, each to GitHub. Never fatal. */
  function problemList(lib, sid, open) {
    const ps = problemsIn(lib, sid);
    if (!ps.length) return null;
    const what = sid ? `${ps.length} problem${ps.length > 1 ? "s" : ""} in ${secOf(sid).label}` : `${ps.length} problem${ps.length > 1 ? "s" : ""} with the library standard`;
    return h("details", { class: "probs", open: open || null, id: sid ? null : "problems" }, h("summary", null, what),
      h("ul", null, ps.map((x) => h("li", null, h("a", { href: ghBlob(lib, x.path, x.line ? `L${x.line}` : null), target: "_blank", rel: "noopener" }, h("code", null, x.path.replace(/^library\//, "")), x.line ? ` line ${x.line}` : "", " ↗"), `: ${x.message}`))),
      h("p", { class: "muted" }, "Its owner fixes the file on main; ", h("a", { href: GUIDE, target: "_blank", rel: "noopener" }, "the library standard ↗"), " has the rules and templates."));
  }

  function library(p, r) {
    const lib = libraryOf(p.key);
    if (proto.state === "loading") {
      return h("div", { class: "lib" }, h("div", { class: "lib-rail" }, h("div", { class: "skel" }, h("i"), h("i"), h("i"), h("i"), h("i"), h("i"), h("i"))),
        h("div", { class: "doc-page" }, h("p", { class: "muted" }, "Reading the library…"), h("div", { class: "lib-tiles" }, [1, 2, 3, 4, 5, 6].map(() => h("div", { class: "card lib-tile skel" }, h("i"), h("i"))))));
    }
    if (!lib) {
      return h("div", { class: "empty-card lib-empty" }, h("b", null, `No library from ${p.name}'s laptop yet.`),
        h("p", null, "The supervisor on a project's laptop reads its ", h("code", null, "library/"), " folder on main and sends it here. One older than the release with libraries sends none."));
    }
    if (!r.section) return libFrame(p, lib, r, null, home(p, lib));
    const sec = secOf(r.section);
    if (!sec) return libFrame(p, lib, r, null, h("div", { class: "empty-card lib-empty" }, h("b", null, `A library has no section "${r.section}".`), h("p", null, h("a", { href: libHref(p.key) }, `${lib.title}'s sections`))));
    if (!written(lib, sec.id)) return libFrame(p, lib, r, sec, notWritten(p, lib, sec));
    return libFrame(p, lib, r, sec, sectionView(p, lib, sec, r));
  }

  /** The rail: the seven sections in their fixed order, a missing one muted with who writes it. */
  function libFrame(p, lib, r, sec, content) {
    const navLinks = [h("a", { href: libHref(p.key), "aria-current": !sec ? "page" : null }, h("span", null, "Home")),
      ...SECTIONS.map((s) => {
        const ok = written(lib, s.id), n = problemsIn(lib, s.id).length;
        return h("a", { href: libHref(p.key, s.id), class: ok ? null : "missing", "aria-current": sec?.id === s.id ? (r.item && secOf(s.id).card ? "true" : "page") : null },
          h("span", null, s.label, n ? h("span", { class: "pdot", title: `${n} problem${n > 1 ? "s" : ""}` }, ` ${n}`) : null), ok ? null : h("small", null, `not written yet · ${s.role}`));
      })];
    const curName = sec ? sec.label : "Home";
    const rail = h("nav", { class: "lib-rail", "aria-label": `${lib.title} sections` },
      h("button", { type: "button", class: "secs-pick", "aria-expanded": "false", onclick: (e) => {
        const on = rail.classList.toggle("open"); e.currentTarget.setAttribute("aria-expanded", String(on));
      } }, h("span", null, h("span", { class: "muted" }, "Section: "), curName), h("span", { "aria-hidden": "true" }, "▾")),
      h("div", { class: "lab" }, `${lib.title} library`),
      h("div", { class: "secs-nav" }, navLinks),
      h("div", { class: "foot" }, h("a", { href: lib.index ? ghTree(lib, "library") : lib.github, target: "_blank", rel: "noopener" }, lib.index ? "library/ on GitHub ↗" : "Repository ↗"),
        h("a", { href: GUIDE, target: "_blank", rel: "noopener" }, "The library standard ↗")));
    // A diagram page folds the rail into its head, at every width: the section's name opens the sections, and the
    // frame gets the page's width (spec §5).
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

  /** The library's home: the seven sections as tiles, each with what is in it at a glance (from the index only). */
  const NOUN = { decisions: ["decision", "decisions"], usecases: ["use case", "use cases"], ux: ["card", "cards"] };
  function home(p, lib) {
    if (!lib.index) return notConverted(p, lib);
    const tiles = SECTIONS.map((s) => {
      const fs = filesOf(lib, s.id), n = problemsIn(lib, s.id).length;
      if (!fs.length) return h("a", { class: "card lib-tile missing", href: libHref(p.key, s.id) }, h("b", null, s.label),
        h("span", { class: "nw" }, "Not written yet"), h("span", { class: "by" }, `the ${s.role}${ownerOf(lib, s) ? `, ${ownerOf(lib, s)},` : ""} writes it`));
      return h("a", { class: "card lib-tile", href: libHref(p.key, s.id) }, h("b", null, s.label, n ? h("span", { class: "pdot" }, ` ${n} problem${n > 1 ? "s" : ""}`) : null),
        h("ul", { class: "gl" }, glance(lib, s)),
        h("span", { class: "by" }, h("span", null, ownerOf(lib, s) ?? s.role), h("span", null, `changed ${dayOf(fs.map((f) => f.changed.date).sort().pop())}`)));
    });
    const k = SECTIONS.filter((s) => written(lib, s.id)).length;
    const who = SECTIONS.map((s) => s.who).filter((w, i, a) => a.indexOf(w) === i).map((w) => lib.owners[w] && `${lib.owners[w]}, ${w.replace("-", " ")}`).filter(Boolean);
    return h("div", { class: "doc-page wide lib-home" },
      h("div", { class: "doc-head" }, h("h1", { class: "doc-title" }, lib.title), h("p", { class: "lede" }, lib.tagline), who.length ? h("p", { class: "muted who" }, who.join(" · ")) : null),
      problemList(lib, null, true),
      h("div", { class: "lib-tiles" }, tiles),
      h("p", { class: "lib-how" }, `${k} of 7 sections written. Each is a file or a folder under library/ on ${lib.ref}, the same in every project: `,
        h("a", { href: GUIDE, target: "_blank", rel: "noopener" }, "the library standard ↗"), ". To change one, ask its owner."));
  }
  function glance(lib, s) {
    const tag = (t) => h("span", { class: "k" }, t);
    if (s.id === "overview") return h("li", null, tag("page"), " Goals, scope and quality goals");
    if (s.id === "architecture") return h("li", null, tag("C4 diagram"), " Context, containers, components and flows");
    if (s.id === "data") return h("li", null, tag("ERD"), " All tables, and the named diagrams");
    if (s.id === "glossary") return h("li", null, tag("A–Z"), " Terms in users' words");
    const cs = cardsOf(lib, s.id), [one, many] = NOUN[s.id];
    const by = {};
    for (const c of cs) by[c.head.status || "no status"] = (by[c.head.status || "no status"] ?? 0) + 1;
    return [h("li", null, tag(`${cs.length} ${cs.length === 1 ? one : many}`), h("span", { class: "nw-s" }, ` latest: ${clip(cs[0].title, 64)}`)),
      h("li", { class: "sts" }, Object.entries(by).map(([w, n]) => `${n} ${w}`).join(" · "))];
  }
  /** No library/ on main (ADR 0017 §5): the seven sections, each not written yet, and the standard's guide. */
  function notConverted(p, lib) {
    return h("div", { class: "doc-page wide lib-home" },
      h("div", { class: "doc-head" }, h("h1", { class: "doc-title" }, `${p.name}'s library`)),
      h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, `${p.name} has no library on ${lib.ref} yet.`),
        h("p", null, "A library is seven sections in a ", h("code", null, "library/"), ` folder on main, in the same files in every project. ${p.name}'s ${lib.ref} at ${sha7(lib.commit)} has none, so each section below is not written yet.`),
        h("p", null, `Its team writes them from the templates in `, h("a", { href: GUIDE, target: "_blank", rel: "noopener" }, "the library standard ↗"), `. Files elsewhere in the repo aren't read.`)),
      h("div", { class: "lib-tiles" }, SECTIONS.map((s) => h("a", { class: "card lib-tile missing", href: libHref(p.key, s.id) }, h("b", null, s.label),
        h("span", { class: "nw" }, "Not written yet"), h("span", { class: "by" }, h("code", null, s.path))))));
  }

  /** A section with no file (ADR 0016 §3, 0017 §5): what it holds, who writes it, and where. */
  function notWritten(p, lib, s) {
    const owner = ownerOf(lib, s);
    return h("div", { class: "doc-page" },
      h("div", { class: "doc-head" }, h("h1", { class: "doc-title" }, s.label)),
      h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, `${s.label} isn't written yet.`),
        h("p", null, `It holds: ${s.holds.charAt(0).toLowerCase()}${s.holds.slice(1)}`),
        h("p", null, `The ${s.role}${owner ? ` (${owner})` : ""} writes it as `, h("code", null, s.path), ` on ${lib.ref}, from its template in `,
          h("a", { href: GUIDE, target: "_blank", rel: "noopener" }, "the library standard ↗"), ".")));
  }

  /** A section: its title and owner, its problems, then what it is. */
  function sectionView(p, lib, sec, r) {
    const owner = ownerOf(lib, sec) ?? sec.role;
    const head = h("div", { class: "sec-head" }, h("h1", { class: "doc-title" }, sec.label), h("span", { class: "muted" }, `owner ${owner}`));
    const ctx = { key: p.key, lib, sid: sec.id };
    if (sec.id === "architecture" || sec.id === "data") {
      const f = viewerFrame(sec.id === "architecture" ? "likec4" : "erd", ctx, r.item, r.focus);
      const el = h("div", { class: "doc-page wide" }, head, f.tabs, problemList(lib, sec.id), h("div", { class: "page-diagram" }, f));
      el.frame = f.frame; el.diagram = true; el.head = head;
      return el;
    }
    let body;
    if (sec.card) body = r.item ? cardPage(p, lib, sec, r) : cardList(p, lib, sec);
    else if (sec.id === "glossary") body = glossary(p, lib, r);
    else body = prosePage(p, lib, sec);
    const el = h("div", { class: `doc-page${body.wide ? " wide" : ""}` }, r.item && sec.card ? null : head, r.item && sec.card ? null : problemList(lib, sec.id), body);
    el.toc = body.toc; el.tocHref = body.tocHref; el.term = body.term;
    return el;
  }
  const metaLine = (lib, f, owner) => h("div", { class: "doc-meta" }, owner ? h("span", null, `owner ${owner}`) : null,
    h("span", null, "changed ", h("code", null, f.changed.sha), `, ${dayOf(f.changed.date)}`),
    h("a", { href: ghBlob(lib, f.path), target: "_blank", rel: "noopener" }, `${f.path} ↗`));

  /** The overview: its front matter is the library's title, tagline and owners; then its fixed headings. */
  function prosePage(p, lib, sec) {
    const f = filesOf(lib, sec.id)[0];
    const ctx = mdCtx(lib, sec.id, f.path, f.title, (id) => libHref(p.key, sec.id, id));
    const doc = h("div", { class: "doc", html: md(bodyOf(lib.texts[f.path]), ctx) });
    const meta = metaLine(lib, f);
    const el = h("article", { class: "doc-body" }, lib.tagline ? h("p", { class: "lede" }, lib.tagline) : null, meta, doc);
    if (ctx.toc.length >= 3) meta.after(h("details", { class: "toc-fold" }, h("summary", null, `On this page · ${ctx.toc.filter((t) => t.n === 2).length} sections`), tocList(ctx.toc, ctx.headHref)));
    if (ctx.diagrams.length) queueMicrotask(() => drawDiagrams(el, ctx));
    el.toc = ctx.toc; el.tocHref = ctx.headHref;
    return el;
  }

  // ---------- cards: decisions, use cases, UX (ADR 0017 §2), their lists from the index's heads ----------
  /** "Superseded by" is derived from the other decisions' supersedes (ADR 0017 §2). */
  const supersededBy = (lib, num) => cardsOf(lib, "decisions").filter((c) => listOf(c.head.supersedes).includes(num)).map((c) => c.num);
  const cardRef = (p, lib, sid, num) => {
    const c = cardsOf(lib, sid).find((x) => x.num === num);
    return h("a", { href: libHref(p.key, sid, num) }, h("span", { class: "num" }, num), c ? ` ${c.title}` : " (no such card)");
  };
  /** The first paragraph under a heading, for a card's face. */
  const paraUnder = (text, heading) => {
    const m = bodyOf(text).match(new RegExp(`\\n## ${heading}\\s*\\n+([\\s\\S]*?)(\\n\\s*\\n|$)`));
    return m ? plain(m[1].replace(/\n/g, " ")).trim() : "";
  };

  function cardList(p, lib, sec) {
    const cards = cardsOf(lib, sec.id), [one, many] = NOUN[sec.id];
    const st = { q: "", status: "" };
    const words = [...new Set(cards.map((c) => c.head.status).filter(Boolean))];
    const q = h("input", { type: "search", placeholder: `Find a ${one}`, "aria-label": `Find a ${one}`, oninput: () => { st.q = q.value.trim().toLowerCase(); draw(); } });
    const seg = words.length > 1 ? h("span", { class: "seg filters" }, [["", "All"], ...words.map((w) => [w, w])].map(([v, t]) =>
      h("button", { type: "button", "aria-pressed": String(v === ""), onclick: (e) => { st.status = v; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } },
        t, h("span", { class: "count" }, ` ${v ? cards.filter((c) => c.head.status === v).length : cards.length}`)))) : null;
    const count = h("span", { class: "count muted", "aria-live": "polite" });
    const hay = cards.map((c) => `${c.num} ${c.title} ${Object.values(c.head).join(" ")} ${(lib.texts[c.path] ?? "").slice(0, 4000)}`.toLowerCase());
    const items = cards.map((c) => (sec.id === "decisions" ? adrRow(p, lib, c) : sec.id === "usecases" ? ucCard(p, lib, c) : uxCard(p, lib, c)));
    const none = h("p", { class: "muted none", hidden: true }, `No ${one} matches. Clear the find${seg ? " or pick All" : ""}.`);
    const holder = sec.id === "decisions" ? h("ol", { class: "adr-list" }, items) : h("div", { class: sec.id === "ux" ? "ux-grid" : "uc-grid" }, items);
    function draw() {
      let k = 0;
      cards.forEach((c, i) => { const on = (!st.status || c.head.status === st.status) && (!st.q || hay[i].includes(st.q)); items[i].hidden = !on; k += on; });
      count.textContent = st.q || st.status ? `${k} of ${cards.length} ${many}` : `${cards.length} ${cards.length === 1 ? one : many}, newest first`;
      none.hidden = k > 0;
    }
    draw();
    const el = h("div", { class: "cards-page" }, h("div", { class: "tax-bar" }, q, seg, count), holder, none);
    el.wide = true;
    return el;
  }
  function adrRow(p, lib, c) {
    const by = supersededBy(lib, c.num);
    return h("li", null, h("a", { class: "adr", href: libHref(p.key, "decisions", c.num) },
      h("span", { class: "n" }, c.num), h("span", { class: "t" }, c.title, by.length ? h("small", null, ` superseded by ${andJoin(by)}`) : null), h("span", { class: "s" }, pill(c.head.status)),
      h("span", { class: "d" }, c.head.date ? dayYear(c.head.date) : ""), h("span", { class: "b" }, andJoin(listOf(c.head["decision-makers"])))));
  }
  function ucCard(p, lib, c) {
    const flow = flowOf(lib, c.num), ux = uxFor(lib, c.num), goal = paraUnder(lib.texts[c.path] ?? "", "Goal");
    return h("article", { class: "card ucard" },
      h("div", { class: "uc-h" }, h("span", { class: "num" }, c.num), pill(c.head.status)),
      h("a", { class: "uc-t", href: libHref(p.key, "usecases", c.num) }, c.title),
      h("dl", { class: "uc-f" }, h("div", null, h("dt", null, "Actor"), h("dd", null, c.head.actor || "—")), goal ? h("div", null, h("dt", null, "Goal"), h("dd", null, clip(goal, 150))) : null),
      flow || ux.length ? h("div", { class: "uc-links" }, flow ? h("a", { class: "chip-b", href: libHref(p.key, "architecture", flow) }, "Its flow ›") : null,
        ux.map((u) => h("a", { class: "chip-b", href: libHref(p.key, "ux", u.num) }, `UX ${u.num}`))) : null);
  }
  function uxCard(p, lib, c) {
    const f = c.head, ucs = listOf(f["use-cases"]);
    const verdict = f.verdict ? h("div", { class: "ux-v" }, h("q", null, f.verdict), h("span", { class: "muted" }, f["verdict-date"] ? `the verdict, ${dayYear(f["verdict-date"])}` : "the verdict"))
      : ["in review", "changes asked"].includes(f.status) ? h("div", { class: "ux-v wait" }, f.status === "in review" ? "Waiting on a verdict" : "Changes asked")
      : h("div", { class: "ux-v none" }, "No verdict yet");
    return h("article", { class: "card ux-card" },
      h("div", { class: "ux-top" }, h("span", { class: "num" }, c.num), f.feature ? h("span", { class: "id" }, f.feature) : null, pill(f.status)),
      h("a", { class: "ux-t", href: libHref(p.key, "ux", c.num) }, c.title), verdict,
      ucs.length ? h("div", { class: "uc-links" }, h("span", { class: "muted" }, "Use cases"), ucs.map((n) => h("a", { class: "chip-b", href: libHref(p.key, "usecases", n) }, n))) : null,
      h("div", { class: "actions" }, h("a", { class: "btn", href: libHref(p.key, "ux", c.num) }, "The card"),
        f.prototype ? h("a", { class: "btn", href: f.prototype, target: "_blank", rel: "noopener" }, "Prototype ↗") : null));
  }

  /** One card: its number, title and head as fields, its problems, then its fixed headings. */
  function cardPage(p, lib, sec, r) {
    const c = cardsOf(lib, sec.id).find((x) => x.num === r.item);
    const back = h("a", { class: "back", href: libHref(p.key, sec.id) }, `‹ ${sec.label}`);
    if (!c) return h("div", { class: "doc-body" }, back, h("div", { class: "empty-card lib-empty" }, h("b", null, `${sec.label} has no card ${r.item}.`), h("p", null, `Its cards are the files `, h("code", null, `${sec.path}NNNN-slug.md`), ` on ${lib.ref}.`)));
    const f = c.head, text = lib.texts[c.path] ?? "";
    const row = (k, v) => (v == null || v === "" || (Array.isArray(v) && !v.length) ? null : h("div", null, h("dt", null, k), h("dd", null, v)));
    const refs = (sid, nums) => nums.map((n, i) => [i ? h("br") : null, cardRef(p, lib, sid, n)]);
    let fields;
    if (sec.id === "decisions") {
      fields = [row("Status", pill(f.status)), row("Date", f.date && dayYear(f.date)), row("Decided by", andJoin(listOf(f["decision-makers"]))),
        row("Supersedes", refs("decisions", listOf(f.supersedes))), row("Superseded by", refs("decisions", supersededBy(lib, c.num))), row("Feature", f.feature)];
    } else if (sec.id === "usecases") {
      const flow = flowOf(lib, c.num);
      fields = [row("Status", pill(f.status)), row("Actor", f.actor), row("Date", f.date && dayYear(f.date)), row("Feature", f.feature),
        row("Flow", flow ? h("a", { href: libHref(p.key, "architecture", flow) }, "Its flow, in the architecture ›") : null),
        row("UX design", refs("ux", uxFor(lib, c.num).map((u) => u.num)))];
    } else {
      fields = [row("Status", pill(f.status)), row("Verdict", f.verdict ? [h("q", null, f.verdict), f["verdict-date"] ? ` · ${dayYear(f["verdict-date"])}` : ""] : null),
        row("Prototype", f.prototype ? h("a", { href: f.prototype, target: "_blank", rel: "noopener" }, "Open it ↗") : null),
        row("Use cases", refs("usecases", listOf(f["use-cases"]))), row("Date", f.date && dayYear(f.date)), row("Feature", f.feature)];
    }
    const mine = lib.problems.filter((x) => x.path === c.path);
    const ctx = mdCtx(lib, sec.id, c.path, c.title, (id) => libHref(p.key, sec.id, c.num, id));
    let body = bodyOf(text);
    // Use cases: Given, when and then stand out in the acceptance (Given/When/Then, ADR 0017 §1).
    if (sec.id === "usecases") body = body.replace(/(\n## Acceptance\s*\n)([\s\S]*?)(?=\n## |$)/, (_, hd, s) => hd + s.replace(/\b(Given|when|then)\b/g, "**$1**"));
    const meta = metaLine(lib, c, ownerOf(lib, sec));
    const head = h("div", { class: "child-head" }, back, h("span", { class: "eyebrow" }, `${sec.card} ${c.num}`), h("h2", { class: "child-t" }, c.title),
      mine.length ? h("ul", { class: "probs-in" }, mine.map((x) => h("li", null, x.line ? `Line ${x.line}: ` : "", x.message))) : null,
      h("dl", { class: "uc-f wide head-box" }, fields), meta);
    const doc = h("div", { class: "doc", html: md(body, ctx) });
    const el = h("article", { class: "doc-body" }, head, doc);
    if (ctx.toc.length >= 3) meta.after(h("details", { class: "toc-fold" }, h("summary", null, `On this page · ${ctx.toc.filter((t) => t.n === 2).length} sections`), tocList(ctx.toc, ctx.headHref)));
    if (ctx.diagrams.length) queueMicrotask(() => drawDiagrams(el, ctx));
    el.toc = ctx.toc; el.tocHref = ctx.headHref;
    return el;
  }

  // ---------- the glossary: one ## Term per entry, A to Z; "Also:" its other words (ADR 0017 §2) ----------
  function glossary(p, lib, r) {
    const f = filesOf(lib, "glossary")[0], text = bodyOf(lib.texts[f.path] ?? "");
    const terms = [];
    for (const part of text.split(/\n(?=## )/)) {
      const m = part.match(/^## +(.+)\n([\s\S]*)$/);
      if (!m) continue;
      let body = m[2].trim(), also = [];
      const a = body.match(/^Also: *(.+)\n/);
      if (a) { also = a[1].split(",").map((x) => x.trim()); body = body.slice(a[0].length).trim(); }
      terms.push({ term: m[1].trim(), id: slug(m[1]), also, body });
    }
    const ctx = mdCtx(lib, "glossary", f.path, "Glossary", null);
    const q = h("input", { type: "search", placeholder: "Find a term", "aria-label": "Find a term", oninput: () => draw() });
    const count = h("span", { class: "count muted", "aria-live": "polite" });
    const letters = [...new Set(terms.map((t) => t.term[0].toUpperCase()))];
    const az = h("nav", { class: "az", "aria-label": "Letters" }, letters.map((l) => h("a", { href: libHref(p.key, "glossary", terms.find((t) => t.term[0].toUpperCase() === l).id) }, l)));
    const rows = terms.map((t) => h("div", { class: "term", id: `t-${t.id}` },
      h("dt", null, h("a", { href: libHref(p.key, "glossary", t.id) }, t.term), t.also.length ? h("span", { class: "muted also" }, ` also ${t.also.join(", ")}`) : null),
      h("dd", { html: md(t.body, ctx) })));
    const none = h("p", { class: "muted none", hidden: true }, "No term matches. Clear the find.");
    function draw() {
      const s = q.value.trim().toLowerCase();
      let k = 0;
      terms.forEach((t, i) => { const on = !s || `${t.term} ${t.also.join(" ")} ${t.body}`.toLowerCase().includes(s); rows[i].hidden = !on; k += on; });
      count.textContent = s ? `${k} of ${terms.length} terms` : `${terms.length} terms`;
      none.hidden = k > 0;
    }
    draw();
    const el = h("div", { class: "doc-body gloss" }, metaLine(lib, f), h("div", { class: "tax-bar" }, q, count), az, h("dl", { class: "terms" }, rows), none);
    el.term = (id) => {
      for (const x of rows) x.classList.toggle("on", x.id === `t-${id}`);
      document.getElementById(`t-${id}`)?.scrollIntoView({ block: "center" });
    };
    return el;
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
  // The frame, the cards and the glossary move the address themselves (a drill, a table, a term): nav() keeps
  // render() from drawing that address again.
  let last = null, cur = null, lastHref = null;
  function nav(href, replace, redraw) {
    if (location.hash === href) return;
    history[replace ? "replaceState" : "pushState"](null, "", href);
    if (redraw) return render();
    lastHref = location.href;
  }
  /** What makes a new page. Architecture: the view is the focus. Data: the diagram is a new frame, the table the focus.
   *  Cards: each card is a page. Overview and glossary: the item is a heading or a term. */
  function pageKey(r) {
    if (r.view !== "project") return `${r.view}`;
    const base = `${r.key}/${r.tab}/${r.section ?? ""}/${proto.state}`;
    if (r.section === "data") return `${base}/${r.item || "all"}`;
    if (secOf(r.section)?.card) return `${base}/${r.item ?? ""}`;
    return base;
  }
  function render(force) {
    if (!force && location.href === lastHref) return;
    lastHref = location.href;
    const r = route();
    header(r);
    const main = $("view");
    main.classList.add("wide");
    const key = pageKey(r), same = !force && last === key;
    last = key;
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
      } else els = [h("div", { class: "empty-card" }, "Not part of this prototype. ", h("a", { href: libHref("toolshed") }, "Toolshed's library"))];
      main.replaceChildren(...els);
      window.scrollTo(0, 0);
    }
    if (!cur) return;
    if (cur.frame) cur.frame.setFocus(r.section === "architecture" ? r.item || "" : r.focus || "");
    else if (cur.term && r.item) cur.term(r.item);
    else {
      const at = secOf(r.section)?.card ? r.focus : r.item;
      const el = at && document.getElementById(`h-${at}`);
      if (el) el.scrollIntoView({ block: "start", behavior: same ? "smooth" : "auto" });
    }
  }

  // ---------- the prototype's state switch (not built) ----------
  const STATES = [["ok", "Checked 4 min ago"], ["behind", "May be behind main (5h)"], ["failed", "Last fetch failed"], ["problems", "Files that break the standard"],
    ["gloss", "A section not written (Glossary)"], ["slow", "A diagram still drawing (15 s, then its files)"], ["nodiagram", "A diagram with errors"],
    ["loading", "Reading the library"], ["none", "No library sent"]];
  document.body.append(h("details", { class: "proto-states" }, h("summary", null, "Prototype: states"),
    h("fieldset", null, STATES.map(([v, t]) => h("label", null, h("input", { type: "radio", name: "st", value: v, checked: v === "ok", onchange: () => { proto.state = v; render(true); } }), t)))));

  window.addEventListener("hashchange", () => render());
  window.addEventListener("popstate", () => render());
  render();
})();
