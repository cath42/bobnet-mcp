// BOB-212 prototype: the Projects menu, a project's Work · Library tabs, and each project's library from its repo's main.
// The libraries are real (data.js, from origin/main). Everything else on the page is a stand-in for what is built.
(function () {
  "use strict";
  const LIBS = window.LIBS;
  const PROJECTS = [
    { key: "bobnet", name: "BobNet", sub: "Agents across Casper's laptops", repo: "cath42/bobnet", lead: "Mario", po: "Peach" },
    { key: "helix", name: "Helix", sub: LIBS.helix.tagline, repo: "cath42/helix-navigator", lead: "Bob", po: "Picard" },
    { key: "vitals", name: "Vitals", sub: LIBS.vitals.tagline, repo: "cath42/vitals" },
  ];
  const $ = (id) => document.getElementById(id);
  const NOW = Date.now();
  // The prototype's switch: what the read says (spec §5). Not built.
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

  // ---------- the route ----------
  // #overview · #project/<key> (Work) · #project/<key>/library[/<page>[/<heading>]]
  function route() {
    const parts = (location.hash || "#overview").slice(1).split("/").map(decodeURIComponent);
    if (parts[0] === "project" && PROJECTS.some((p) => p.key === parts[1])) {
      return { view: "project", key: parts[1], tab: parts[2] === "library" ? "library" : "work", page: parts[3] || null, heading: parts[4] || null };
    }
    return { view: parts[0] || "overview" };
  }
  const libHref = (key, page, heading) => `#project/${key}/library${page ? `/${page}` : ""}${heading ? `/${heading}` : ""}`;

  // ---------- what the broker would answer (Toad, consult c_820aa69f; ADR 0015) ----------
  /** The library manifest as the read gives it, under the prototype's state. null: the project has none. */
  function libraryOf(key) {
    const lib = LIBS[key];
    if (!lib || proto.state === "none") return null;
    const checked = { ok: 4, behind: 5 * 60, failed: 3 * 60 }[proto.state] ?? 4;
    const m = { ...lib, checked_at: new Date(NOW - checked * 60000).toISOString(), problems: [] };
    if (proto.state === "failed") m.problems = [{ at: new Date(NOW - 12 * 60000).toISOString(), what: "fetch", text: "git fetch origin: Could not resolve host: github.com" }];
    if (proto.state === "missing") {
      m.pages = m.pages.map((p) => (p.id === "decisions" ? { ...p, missing: true, text: null } : p));
      m.problems = [{ what: "missing", page: "decisions", text: `${m.pages.find((p) => p.id === "decisions").src} is not on main at ${sha7(m.commit)}` }];
    }
    return m;
  }
  const behind = (m) => NOW - Date.parse(m.checked_at) > 2 * 3600e3;
  const ghBlob = (m, path, frag) => `${m.github}/blob/${m.commit}/${path}${frag ? `#${frag}` : ""}`;

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
        if (n === 2 || n === 3) ctx.toc.push({ n, id, text: inner.replace(/<[^>]+>/g, "") });
        out += `<h${n} id="h-${id}">${inner}${n === 2 || n === 3 ? `<a class="hl" href="${libHref(ctx.key, ctx.page.id, id)}" aria-label="Link to this section">#</a>` : ""}</h${n}>`;
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
      cur.push(l.trim()); // a lazy continuation of the item's text
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
  /** A link in a page: to a library page in place, to any other repo file on GitHub at the commit shown, http(s) out; anything else is dead text. */
  function link(href, label, ctx) {
    if (href.startsWith("#")) return `<a href="${libHref(ctx.key, ctx.page.id, slug(href.slice(1)))}">${label}</a>`;
    if (/^https?:\/\//.test(href)) return `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return `<span class="dead" title="Not a web link">${label}</span>`;
    const [path, frag] = href.split("#");
    const target = path ? normPath(ctx.page.src.replace(/[^/]*$/, "") + path) : ctx.page.src;
    const hit = ctx.lib.pages.find((p) => p.src === target);
    if (hit) return `<a href="${libHref(ctx.key, hit.id, frag ? slug(frag) : null)}">${label}</a>`;
    return `<a class="ext" href="${esc(ghBlob(ctx.lib, target, frag))}" target="_blank" rel="noopener" title="${esc(target)} on GitHub at ${sha7(ctx.lib.commit)}">${label}</a>`;
  }
  function normPath(p) {
    const out = [];
    for (const s of p.split("/")) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); }
    return out.join("/");
  }

  // ---------- diagrams: drawn as an image (the CSP stays as it is, ADR 0015), the source while drawing or when it can't be ----------
  let mermaidP = null, dn = 0;
  function diagramSlot(code, ctx) {
    ctx.diagrams.push(code);
    return `<div class="dia" data-dia="${ctx.diagrams.length - 1}"></div>`;
  }
  function loadMermaid() {
    // Prototype: from a CDN. The build vendors a pinned copy in public/vendor/ and loads it only for a page with a diagram.
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
      const srcLink = h("a", { href: ghBlob(ctx.lib, ctx.page.src), target: "_blank", rel: "noopener" }, "On GitHub ↗");
      const fallback = (why) => box.replaceChildren(bar("Diagram", srcLink),
        h("div", { class: "dia-note warn" }, why), src);
      box.replaceChildren(bar("Diagram"), h("div", { class: "dia-note" }, "Drawing the diagram…"), src);
      if (proto.state === "nodiagram") return fallback("This diagram couldn't be drawn here. Its source is below.");
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
      }).catch((e) => { console.warn("diagram", e); fallback("This diagram couldn't be drawn here. Its source is below."); });
    });
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
        h("span", { class: "pm-sub" }, p.sub),
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
  document.addEventListener("click", (e) => { if (!e.target.closest(".pm")) menu(false); });
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
        // Picking another project stays on the tab, and on the same section when it has one.
        if (r.tab === "work") location.hash = `#project/${q.key}`;
        else { const lib = libraryOf(q.key); location.hash = libHref(q.key, lib?.pages.some((x) => x.id === r.page) ? r.page : null); }
      } }, q.name))));
    const lib = libraryOf(p.key);
    const tabs = h("div", { class: "p-tabs" },
      h("nav", { "aria-label": `${p.name}` },
        h("a", { href: `#project/${p.key}`, "aria-current": r.tab === "work" ? "page" : null }, "Work"),
        h("a", { href: libHref(p.key), "aria-current": r.tab === "library" ? "page" : null }, "Library")),
      r.tab === "library" && lib && proto.state !== "loading" ? fresh(lib) : null);
    return [head, tabs];
  }
  /** As of main at <sha>, <date> · checked <ago> from <laptop>. */
  function fresh(m) {
    const late = behind(m) || m.problems.some((x) => x.what === "fetch");
    return h("span", { class: `fresh${late ? " warn" : ""}` }, "As of main at ",
      h("a", { href: `${m.github}/commit/${m.commit}`, target: "_blank", rel: "noopener", title: "This commit on GitHub" }, h("code", null, sha7(m.commit))),
      `, ${dayOf(m.committed_at)} ${clock(m.committed_at)} · checked ${ago(NOW - Date.parse(m.checked_at))} from ${m.laptop}`);
  }

  function work(p) {
    return h("div", { class: "card proto-asis" }, h("h3", null, `${p.name}'s page as built (BOB-182)`),
      h("p", { class: "muted" }, "Current release, Running now, Who ran lately, Waits on you, CI, Usage and Backlog health, unchanged. It is the Work tab now; Library is beside it."));
  }

  function library(p, r) {
    const lib = libraryOf(p.key);
    if (proto.state === "loading") {
      return h("div", { class: "lib" }, h("div", { class: "lib-rail" }, h("div", { class: "skel" }, h("i"), h("i"), h("i"), h("i"))),
        h("div", { class: "doc-page" }, h("p", { class: "muted" }, "Reading the library…"), h("div", { class: "skel" }, h("i"), h("i"), h("i"), h("i"), h("i"), h("i"))));
    }
    if (!lib) {
      return h("div", { class: "empty-card lib-empty" }, h("b", null, `${p.name} has no library yet.`),
        h("p", null, "A library is the pages a project lists in ", h("code", null, ".bobnet/library.json"), " on its main: architecture, data model, decisions and the like. Its architect writes the file; the supervisor on its laptop sends the pages here."),
        h("p", null, "A laptop whose supervisor is older than the release with libraries sends none."));
    }
    const page = r.page ? lib.pages.find((x) => x.id === r.page) : null;
    if (r.page && !page) {
      return libFrame(p, lib, null, h("div", { class: "empty-card lib-empty" }, h("b", null, `${lib.title} has no page "${r.page}".`),
        h("p", null, "It may have been renamed in ", h("code", null, ".bobnet/library.json"), ". ", h("a", { href: libHref(p.key) }, "The library's sections"))));
    }
    return page ? libFrame(p, lib, page, null) : libFrame(p, lib, null, home(p, lib));
  }

  function banners(m) {
    const out = [];
    const fail = m.problems.find((x) => x.what === "fetch");
    if (fail) out.push(h("div", { class: "banner" }, h("b", null, `${m.laptop} couldn't fetch ${m.github.split("/").pop()} ${ago(NOW - Date.parse(fail.at))}`),
      h("span", null, `${fail.text}. The pages are main at ${sha7(m.commit)} (${dayOf(m.committed_at)}), last checked ${ago(NOW - Date.parse(m.checked_at))}. They update at its next fetch.`)));
    else if (behind(m)) out.push(h("div", { class: "banner" }, h("b", null, "This may be behind main"),
      h("span", null, `${m.laptop} last checked ${ago(NOW - Date.parse(m.checked_at))}; it checks every 10 minutes while it runs. The pages are main at ${sha7(m.commit)} (${dayOf(m.committed_at)}).`)));
    return out;
  }

  function libFrame(p, lib, page, body) {
    const ctx = { key: p.key, lib, page, toc: [], diagrams: [] };
    let content;
    if (page && page.missing) {
      content = h("div", { class: "empty-card lib-empty" }, h("b", null, `${page.src} isn't on main at ${sha7(lib.commit)}.`),
        h("p", null, `The library still lists it. Its owner (${page.owner}) moves the entry in `, h("code", null, ".bobnet/library.json"), " or puts the file back."),
        h("p", null, h("a", { href: `${lib.github}/commits/${lib.commit}/${page.src}`, target: "_blank", rel: "noopener" }, "Its history on GitHub ↗")));
    } else if (page) {
      content = pageBody(page, ctx);
    } else content = body;

    const cur = page ? page.id : r0().page ? null : "home";
    const navLinks = [h("a", { href: libHref(p.key), "aria-current": cur === "home" ? "page" : null }, h("span", null, "Home")),
      ...lib.pages.map((x) => h("a", { href: libHref(p.key, x.id), class: [x.parent ? "sub" : "", x.missing ? "missing" : ""].join(" ").trim() || null, "aria-current": cur === x.id ? "page" : null },
        h("span", null, x.nav), x.missing ? h("small", null, "missing") : x.group ? h("small", null, x.group) : null)),
      ...lib.coming.map((c) => h("span", { class: "soon" }, c.nav, h("small", null, "soon")))];
    const curName = page ? page.nav : "Home";
    const rail = h("nav", { class: "lib-rail", "aria-label": `${lib.title} sections` },
      h("button", { type: "button", class: "secs-pick", "aria-expanded": "false", onclick: (e) => {
        const on = rail.classList.toggle("open"); e.currentTarget.setAttribute("aria-expanded", String(on));
      } }, h("span", null, h("span", { class: "muted" }, "Section: "), curName), h("span", { "aria-hidden": "true" }, "▾")),
      h("div", { class: "lab" }, lib.title),
      h("div", { class: "secs-nav" }, navLinks),
      h("div", { class: "foot" }, h("a", { href: lib.github, target: "_blank", rel: "noopener" }, "Repository ↗"),
        h("span", null, "Sections from ", h("a", { href: ghBlob(lib, ".bobnet/library.json"), target: "_blank", rel: "noopener" }, h("code", null, ".bobnet/library.json")))));

    const toc = ctx.toc.length >= 3 ? ctx.toc : [];
    const tocList = (cls) => h("ul", null, toc.map((t) => h("li", { class: `h${t.n}` }, h("a", { href: libHref(p.key, page.id, t.id), dataset: { h: t.id } }, t.text))));
    const aside = toc.length && page.kind !== "table" ? h("aside", { class: "lib-toc", "aria-label": "On this page" }, h("div", { class: "lab" }, "On this page"), tocList()) : null;
    if (toc.length && content.querySelector) {
      const fold = h("details", { class: `toc-fold${aside ? "" : " always"}` }, h("summary", null, `On this page · ${toc.filter((t) => t.n === 2).length} sections`), tocList());
      content.querySelector(".doc-head")?.after(fold);
    }
    const wrap = h("div", { class: `lib${aside ? " has-toc" : ""}` }, rail, h("div", { class: "doc-col", style: "min-width:0;display:grid;gap:14px;align-content:start" }, banners(lib), content), aside);
    if (ctx.diagrams.length) queueMicrotask(() => drawDiagrams(wrap, ctx));
    if (aside && window.innerWidth >= 1280) queueMicrotask(() => spy(wrap));
    return wrap;
  }
  const r0 = () => route();

  function pageBody(page, ctx) {
    const parent = page.parent ? ctx.lib.pages.find((x) => x.id === page.parent) : null;
    const head = h("div", { class: "doc-head" },
      h("div", { class: "eyebrow" }, parent ? `${parent.nav}${page.group ? ` · ${page.group}` : ""}` : page.nav),
      h("h1", { class: "doc-title" }, page.title),
      h("div", { class: "doc-meta" }, h("span", null, `owner ${page.owner}`),
        h("span", null, "changed ", h("code", null, sha7(page.changed.sha)), `, ${dayOf(page.changed.date)}`),
        h("a", { href: ghBlob(ctx.lib, page.src), target: "_blank", rel: "noopener" }, `${page.src} ↗`)));
    let html;
    if (page.kind === "mermaid") html = md(`${page.intro}\n\n\`\`\`mermaid\n${page.text.trim()}\n\`\`\`\n`, ctx);
    else html = md(page.text, ctx);
    const doc = h("div", { class: "doc", html });
    const el = h("article", { class: `doc-page${page.kind === "table" ? " wide" : ""}` }, head, doc);
    if (page.kind === "table") el.append(taxonomy(page, ctx));
    return el;
  }

  // ---------- Helix's taxonomy: one table of every area's elements (build.py's merge), found and filtered here ----------
  const SHOW = 200;
  function taxonomy(page, ctx) {
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

  function home(p, lib) {
    const missing = lib.problems.filter((x) => x.what === "missing");
    return h("div", { class: "doc-page lib-home" },
      h("div", { class: "doc-head" }, h("div", { class: "eyebrow" }, "Library"), h("h1", { class: "doc-title" }, lib.title)),
      h("p", { class: "lede" }, lib.tagline, ": how it is built, what it stores, and the cases it has to get right."),
      missing.length ? h("div", { class: "banner" }, h("b", null, `${missing.length === 1 ? "A page is" : `${missing.length} pages are`} missing on main`), h("span", null, missing.map((x) => x.text).join("; "), ".")) : null,
      h("div", { class: "lib-cards" },
        lib.pages.filter((x) => !x.parent).map((x) => h("a", { class: `card lib-card${x.missing ? " missing" : ""}`, href: libHref(p.key, x.id) },
          h("b", null, x.nav), h("span", { class: "what" }, x.missing ? x.src : x.title),
          h("span", { class: "by" }, h("span", null, x.owner), x.missing ? h("span", { class: "pill" }, "missing") : h("span", null, `changed ${dayOf(x.changed.date)}`)))),
        lib.coming.map((c) => h("div", { class: "card lib-card soon" }, h("b", null, c.nav), h("span", { class: "what" }, c.what), h("span", { class: "by" }, h("span", null, c.owner), h("span", { class: "pill" }, "soon"))))),
      h("p", { class: "lib-how" }, "Each page is a file on ", h("code", null, "main"), ` in ${lib.github.replace("https://github.com/", "")}, sent by ${lib.laptop}'s supervisor. The repository is the source: to change a page, ask its owner, who changes the file and lands it. It shows here at the next check.`));
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
  let last = null;
  function render() {
    const r = route();
    header(r);
    const main = $("view");
    main.classList.add("wide");
    // A heading on the same page only scrolls.
    const same = last && r.view === "project" && last.view === "project" && last.key === r.key && last.tab === r.tab && last.page === r.page && last.state === proto.state;
    last = { ...r, state: proto.state };
    if (!same) {
      let kids;
      if (r.view === "overview") kids = overview();
      else if (r.view === "project") {
        const p = PROJECTS.find((x) => x.key === r.key);
        kids = [...projectHead(p, r), r.tab === "work" ? work(p) : library(p, r)];
        document.title = r.tab === "library" ? `${p.name} library · BobNet` : `${p.name} · BobNet`;
      } else kids = [h("div", { class: "empty-card" }, "Not part of this prototype. ", h("a", { href: libHref("helix") }, "Helix's library"))];
      main.replaceChildren(...kids);
    }
    if (r.heading) {
      const el = document.getElementById(`h-${r.heading}`);
      if (el) el.scrollIntoView({ block: "start", behavior: same ? "smooth" : "auto" });
    } else if (!same) window.scrollTo(0, 0);
  }

  // ---------- the prototype's state switch (not built) ----------
  const STATES = [["ok", "Checked 4 min ago"], ["behind", "May be behind main (5h)"], ["failed", "Last fetch failed"], ["missing", "A page missing on main"],
    ["nodiagram", "Diagram can't be drawn"], ["loading", "Reading the library"], ["none", "No library"]];
  document.body.append(h("details", { class: "proto-states" }, h("summary", null, "Prototype: states"),
    h("fieldset", null, STATES.map(([v, t]) => h("label", null, h("input", { type: "radio", name: "st", value: v, checked: v === "ok", onchange: () => { proto.state = v; render(); } }), t)))));

  window.addEventListener("hashchange", render);
  render();
})();
