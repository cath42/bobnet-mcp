// A project's library (BOB-212; ADR 0015, 0017; design/BOB-212/spec.md v6): seven sections, each one file or folder
// under library/ on the project's main, the same in every repo. The Board keeps them as a cache its supervisor sends;
// this page reads the `library` read (the index: paths, titles, heads) and a section's texts with `library_page`, and
// renders Markdown in the page with markdown-it (html off), so no laptop-made HTML is ever shown. The diagrams
// (Architecture, Data model) come with build B: their sections say what they hold and link their files.

const VENDOR = {
  markdown: new URL("./vendor/markdown-it-15.0.3.min.js", import.meta.url).href,
  mermaid: new URL("./vendor/mermaid-11.17.2.min.js", import.meta.url).href,
};
const GUIDE = "https://github.com/cath42/bobnet-mcp/blob/v2/architecture/library-standard.md";
/** What each section holds, in the page's words (spec §7). */
const HOLDS = {
  overview: "Goals, stakeholders, scope, constraints and quality goals.",
  architecture: "The C4 model, from context to containers to components, each use case's flow, and where it runs.",
  data: "Every table, its columns and relations, as diagrams: all tables, and the named ones.",
  decisions: "One record per decision: its context, the options, the decision, its consequences and its status.",
  usecases: "One card per use case: its actor, goal, scenario and acceptance.",
  ux: "One card per feature: its screens and states, its prototype, and the owner's verdict with its date.",
  glossary: "Terms in users' words, A to Z.",
};
/** A card section's noun, one and many (spec §6, §9). */
const NOUN = { decisions: ["decision", "decisions"], usecases: ["use case", "use cases"], ux: ["card", "cards"] };
/** Status pills (spec §9): what each of the standard's values means; anything else is shown as written, with "?". */
const TONE = { accepted: "ok", agreed: "ok", built: "ok", approved: "ok", proposed: "warn", draft: "warn", "in review": "warn", "changes asked": "warn",
  superseded: "mute", rejected: "mute", deprecated: "mute", retired: "mute" };
/** A library may be behind main once its last check is this old, by the broker's clock (ADR 0015 §5). */
const BEHIND_MS = 2 * 3600e3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n) => String(n).padStart(2, "0");
const dateOf = (iso) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
const dayOf = (iso) => { const d = dateOf(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const dayYear = (iso) => { const d = dateOf(iso); return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const hm = (iso) => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
/** "4 min ago", "5h ago", "3 days ago". */
function agoWords(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  return hr < 48 ? `${hr}h ago` : `${Math.round(hr / 24)} days ago`;
}
/** A slug (spec §2): lower case, each run of anything but a-z and 0-9 one "-". */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sha7 = (s) => s.slice(0, 7);
const plain = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*|__/g, "").replace(/`/g, "");
const clip = (s, n) => (s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n - 1) > n * 0.6 ? s.lastIndexOf(" ", n - 1) : n - 1)}…` : s);
const listOf = (v) => (v || "").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
const andJoin = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
const numOf = (path) => /\/(\d{4})-[^/]*$/.exec(path)?.[1] ?? "";
/** A Markdown file's text without its front matter and its # title: the page shows both its own way. */
const bodyOf = (text) => text.replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^\s*# .*\n/, "");
function normPath(p) {
  const out = [];
  for (const s of p.split("/")) {
    if (s === "..") out.pop();
    else if (s && s !== ".") out.push(s);
  }
  return out.join("/");
}

/** The library's address (spec §2): #project/<key>/library[/<section>[/<item>[/<focus>]]]. */
export const libHref = (key, sec, item, focus) =>
  `#project/${key}/library${sec ? `/${sec}` : ""}${sec && item ? `/${encodeURIComponent(item)}` : ""}${sec && item && focus ? `/${encodeURIComponent(focus)}` : ""}`;

/**
 * The library's pages, on the dashboard's own helpers: `h` builds elements; `keptRead` reads and keeps a board read,
 * reading it again on board_changed while `shown`; `scheduleRender` redraws; `toast` says; `brokerNow` is the
 * broker's clock.
 */
export function libraryPages(app) {
  const { h, keptRead, scheduleRender, toast, brokerNow } = app;

  // ---------- the route ----------
  /** The library's part of the address: section, item, focus, decoded. null when the page isn't a library's. */
  function route() {
    const parts = location.hash.slice(1).split("?")[0].split("/");
    if (parts[0] !== "project" || parts[2] !== "library") return null;
    const dec = (s) => { try { return s ? decodeURIComponent(s) : null; } catch { return s; } };
    return { key: parts[1], section: dec(parts[3]), item: dec(parts[4]), focus: dec(parts[5]) };
  }
  const shownKey = () => route()?.key ?? null;

  // ---------- reads ----------
  const libraryRead = (key, again = false) => keptRead({ op: "library", project: key }, key, () => shownKey() === key, again);
  const pageRead = (key, section, path, again = false) => keptRead({ op: "library_page", project: key, section, ...(path ? { path } : {}) }, key, () => shownKey() === key, again);

  // markdown-it, loaded when a library first renders prose (ADR 0015 §6).
  const md = { lib: null, loading: null, error: null };
  function markdown() {
    if (md.lib || md.error) return md.lib;
    // A page that has markdown-it already (the dashboard's tests) uses it.
    md.loading ??= (globalThis.markdownit ? Promise.resolve({ default: globalThis.markdownit }) : import(VENDOR.markdown)).then(
      (m) => { md.lib = m.default({ html: false, linkify: false, typographer: false }); scheduleRender(); },
      (err) => { md.error = err.message; md.loading = null; scheduleRender(); },
    );
    return null;
  }

  // ---------- what the index says ----------
  const sectionsOf = (read) => read.standard.sections;
  const filesOf = (lib, sid) => (lib.index?.files ?? []).filter((f) => f.section === sid);
  const written = (lib, sid) => filesOf(lib, sid).length > 0;
  const overviewHead = (lib) => filesOf(lib, "overview")[0]?.head ?? {};
  const ownerOf = (lib, s) => overviewHead(lib)[s.owner] || null;
  const branchOf = (lib) => lib.ref.replace(/^[^/]+\//, "");
  const ghBlob = (lib, path, frag) => (lib.github ? `${lib.github}/blob/${lib.commit}/${path}${frag ? `#${frag}` : ""}` : null);
  const ghTree = (lib, path) => (lib.github ? `${lib.github}/tree/${lib.commit}/${path}` : null);
  const cardsOf = (lib, sid) => filesOf(lib, sid).map((f) => ({ ...f, num: numOf(f.path), head: f.head ?? {} })).sort((a, b) => b.num.localeCompare(a.num));
  /** The section a problem's path is under: its file's, else the folder's or file's the standard names. */
  const sectionOfPath = (read, lib, path) => lib.index?.files.find((f) => f.path === path)?.section
    ?? sectionsOf(read).find((s) => (s.path.endsWith("/") ? path.startsWith(s.path) : path === s.path))?.id ?? null;
  const problemsIn = (read, lib, sid) => lib.problems.filter((x) => x.kind !== "fetch_failed" && (!sid || sectionOfPath(read, lib, x.path) === sid));
  const behind = (lib) => brokerNow() - Date.parse(lib.checked_at) >= BEHIND_MS;
  /** "Superseded by" is derived from the other decisions' supersedes (ADR 0017 §2). */
  const supersededBy = (lib, num) => cardsOf(lib, "decisions").filter((c) => listOf(c.head.supersedes).includes(num)).map((c) => c.num);
  /** The UX cards that name a use case. */
  const uxFor = (lib, num) => cardsOf(lib, "ux").filter((c) => listOf(c.head["use-cases"]).includes(num));
  /** A use case's flow: the architecture's dynamic view uc<NNNN> (0017 §2, §7), found in the .c4 text. */
  const flowOf = (c4, num) => (c4 && c4.some((f) => new RegExp(`\\bdynamic\\s+view\\s+uc${num}\\b`).test(f.text)) ? `uc${num}` : null);

  const pill = (word) => (word ? h("span", { class: `st ${TONE[word] ?? "odd"}`, title: TONE[word] ? null : "Not one of the standard's statuses" }, TONE[word] ? word : `${clip(word, 12)} ?`) : null);
  const ext = (href, ...kids) => (href ? h("a", { href, target: "_blank", rel: "noopener" }, ...kids) : h("span", null, ...kids));
  const guide = (label = "the library standard ↗") => h("a", { href: GUIDE, target: "_blank", rel: "noopener" }, label);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // ---------- Markdown: rendered by markdown-it, then the page's rules on its links, headings, tables and diagrams ----------

  /**
   * One file's Markdown as an element (spec §14). `ctx`: the library, the file's path, and where a heading goes
   * (`headHref(slug)`), or null where headings have no address. Collects the headings (`toc`) and the mermaid fences.
   */
  function renderDoc(read, lib, text, ctx) {
    const doc = h("div", { class: "doc" });
    const mdit = markdown();
    if (!mdit) {
      doc.append(md.error ? h("p", { class: "warn-t" }, `The text couldn't be shown: ${md.error}`) : h("p", { class: "muted" }, "Reading…"));
      return { doc, toc: [], diagrams: 0 };
    }
    // markdown-it escapes everything (html off); an aligned cell's style becomes a class, which the CSP allows.
    const html = mdit.render(text).replace(/ style="text-align:(left|right|center)"/g, ' class="al-$1"');
    const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
    const toc = [];
    const seen = new Map();
    for (const hd of parsed.querySelectorAll("h1, h2, h3")) {
      if (hd.tagName === "H1") continue;
      let id = slug(hd.textContent);
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      hd.id = `h-${id}`;
      toc.push({ id, text: hd.textContent, n: Number(hd.tagName[1]) });
      if (ctx.headHref) hd.append(h("a", { class: "hl", href: ctx.headHref(id), "aria-label": `Link to ${hd.textContent}` }, "#"));
    }
    for (const a of parsed.querySelectorAll("a[href]")) link(read, lib, a, ctx);
    // A repo image links to it on GitHub: the CSP has no GitHub for images (0015 §6). A data: image shows.
    for (const img of parsed.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      if (/^data:image\//.test(src)) continue;
      const target = /^https?:\/\//.test(src) ? src : ghBlob(lib, normPath(ctx.base.replace(/[^/]*$/, "") + src.split("#")[0]));
      img.replaceWith(target ? h("a", { class: "ext", href: target, target: "_blank", rel: "noopener" }, img.getAttribute("alt") || "Picture") : h("span", { class: "dead" }, img.getAttribute("alt") || "Picture"));
    }
    for (const t of parsed.querySelectorAll("table")) {
      const tw = h("div", { class: "tw" });
      t.replaceWith(tw);
      tw.append(t);
    }
    let diagrams = 0;
    for (const code of parsed.querySelectorAll("pre > code.language-mermaid")) {
      const box = h("div", { class: "dia", dataset: { src: code.textContent } });
      code.parentElement.replaceWith(box);
      diagrams++;
    }
    doc.append(...parsed.childNodes);
    if (diagrams) queueMicrotask(() => drawDiagrams(lib, doc, ctx));
    return { doc, toc, diagrams };
  }

  /** Where a library file opens in the page: its section, and a card's number. null: not a file the library shows. */
  function inLibrary(key, lib, path, frag) {
    const f = lib.index?.files.find((x) => x.path === path);
    if (!f) {
      // A section's folder: the section.
      const dir = /^library\/(architecture|decisions|usecases|ux)\/?$/.exec(path);
      return dir ? libHref(key, dir[1]) : null;
    }
    if (["decisions", "usecases", "ux"].includes(f.section)) return libHref(key, f.section, numOf(path), frag ? slug(frag) : null);
    return libHref(key, f.section, frag && ["overview", "glossary"].includes(f.section) ? slug(frag) : null);
  }
  /** A link's rule (spec §14): a library file in place, any other repo file on GitHub at the commit, http(s) out; else text. */
  function link(read, lib, a, ctx) {
    const href = a.getAttribute("href");
    const dead = () => a.replaceWith(h("span", { class: "dead", title: "Not a web link" }, ...a.childNodes));
    if (href.startsWith("#")) {
      if (!ctx.headHref) return dead();
      a.setAttribute("href", ctx.headHref(slug(href.slice(1))));
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      Object.assign(a, { target: "_blank", rel: "noopener" });
      a.classList.add("ext");
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return dead();
    const [path, frag] = href.split("#");
    const target = path ? normPath(ctx.base.replace(/[^/]*$/, "") + decodeURI(path)) : ctx.base;
    const hit = inLibrary(read.library.project, lib, target, frag);
    if (hit) return void a.setAttribute("href", hit);
    const gh = ghBlob(lib, target, frag);
    if (!gh) return dead();
    Object.assign(a, { href: gh, target: "_blank", rel: "noopener", title: `${target} on GitHub at ${sha7(lib.commit)}` });
    a.classList.add("ext");
  }

  // ---------- small diagrams: mermaid 11.x, drawn as an image fitted to the column; Full size; Source (0015 §6) ----------
  const mm = { loading: null, n: 0 };
  function loadMermaid() {
    // Its build is a classic script that sets globalThis.mermaid: loaded as one, from 'self' (the CSP's script-src).
    mm.loading ??= globalThis.mermaid ? Promise.resolve(globalThis.mermaid) : new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = VENDOR.mermaid;
      s.onload = () => (globalThis.mermaid ? ok(globalThis.mermaid) : no(new Error("mermaid didn't load")));
      s.onerror = () => no(new Error("mermaid didn't load"));
      document.head.append(s);
    }).catch((err) => {
      mm.loading = null;
      throw err;
    });
    return mm.loading;
  }
  function drawDiagrams(lib, root, ctx) {
    for (const box of root.querySelectorAll(".dia:not([data-drawn])")) {
      box.dataset.drawn = "";
      const code = box.dataset.src;
      delete box.dataset.src;
      const src = h("pre", null, h("code", null, code));
      const bar = (...btns) => h("div", { class: "dia-bar" }, h("span", null, "Diagram"), h("span", { class: "actions" }, btns));
      const gh = ghBlob(lib, ctx.base);
      box.replaceChildren(bar(), h("div", { class: "dia-note" }, "Drawing the diagram…"), src);
      loadMermaid().then(async (mermaid) => {
        const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", htmlLabels: false, flowchart: { htmlLabels: false },
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          themeVariables: { background: v("--surface"), primaryColor: v("--surface"), primaryTextColor: v("--text"), primaryBorderColor: v("--accent"),
            lineColor: v("--muted"), secondaryColor: v("--bg"), tertiaryColor: v("--bg"), textColor: v("--text"), mainBkg: v("--surface"), nodeBorder: v("--accent"),
            clusterBkg: v("--bg"), clusterBorder: v("--line"), edgeLabelBackground: v("--surface"), actorBkg: v("--surface"), actorBorder: v("--accent"),
            actorTextColor: v("--text"), signalColor: v("--muted"), signalTextColor: v("--text"), noteBkgColor: v("--bg"), noteTextColor: v("--text"), noteBorderColor: v("--line") } });
        const { svg } = await mermaid.render(`lib-dia-${++mm.n}`, code);
        // An image keeps the page's CSP: the drawn SVG's own <style> applies inside it only (0015 §6).
        const img = h("img", { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: `A diagram in ${ctx.base.replace(/^library\//, "")}. Its source is under Source.` });
        const full = h("button", { type: "button", "aria-pressed": "false", onclick: () => {
          const on = box.classList.toggle("full");
          full.setAttribute("aria-pressed", String(on));
          full.textContent = on ? "Fit" : "Full size";
        } }, "Full size");
        const sb = h("button", { type: "button", "aria-pressed": "false", onclick: () => {
          src.hidden = !src.hidden;
          sb.setAttribute("aria-pressed", String(!src.hidden));
        } }, "Source");
        src.hidden = true;
        box.replaceChildren(bar(full, sb), h("div", { class: "dia-view" }, img), src);
      }).catch(() => {
        box.replaceChildren(bar(gh ? h("a", { href: gh, target: "_blank", rel: "noopener" }, "On GitHub ↗") : null),
          h("div", { class: "dia-note warn" }, "This diagram couldn't be drawn here. Its source is below."), src);
      });
    }
  }

  // ---------- the "as of" line and the banners (spec §4, §13) ----------

  /** As of main at <sha>, 26 Nov 21:34 · checked 4 min ago from mbp-1 · 3 problems. */
  function asOf(key) {
    const read = libraryRead(key).reply, lib = read?.library;
    if (!lib) return null;
    const failed = lib.problems.find((x) => x.kind === "fetch_failed");
    const n = problemsIn(read, lib, null).length;
    return h("span", { class: `fresh${behind(lib) || failed ? " warn" : ""}` }, `As of ${branchOf(lib)} at `,
      ext(lib.github ? `${lib.github}/commit/${lib.commit}` : null, h("code", null, sha7(lib.commit))),
      `, ${dayOf(lib.committed_at)} ${hm(lib.committed_at)} · checked ${agoWords(brokerNow() - Date.parse(lib.checked_at))} from ${lib.laptop}`,
      n ? [" · ", h("a", { class: "probs-n", href: `${libHref(key)}` }, plural(n, "problem"))] : null);
  }
  function banners(lib, name) {
    const fail = lib.problems.find((x) => x.kind === "fetch_failed");
    const at = `${branchOf(lib)} at ${sha7(lib.commit)} (${dayOf(lib.committed_at)})`;
    if (fail) {
      return h("div", { class: "banner" }, h("b", null, `${lib.laptop} couldn't fetch ${name} ${agoWords(brokerNow() - Date.parse(fail.at))}.`),
        h("span", null, `${fail.message}. The library is ${at}, last checked ${agoWords(brokerNow() - Date.parse(lib.checked_at))}. It updates at the next fetch.`));
    }
    if (behind(lib)) {
      return h("div", { class: "banner" }, h("b", null, `This may be behind ${branchOf(lib)}.`),
        h("span", null, `${lib.laptop} last checked ${agoWords(brokerNow() - Date.parse(lib.checked_at))}; it checks every 10 minutes while it runs. The library is ${at}.`));
    }
    return null;
  }

  /** The files that break the standard (0017 §4, §5): by file and line, each to GitHub. Never fatal. */
  function problemList(read, lib, sid, open) {
    const ps = problemsIn(read, lib, sid);
    if (!ps.length) return null;
    const label = sid ? `${plural(ps.length, "problem")} in ${sectionsOf(read).find((s) => s.id === sid).label}` : `${plural(ps.length, "problem")} with the library standard`;
    return h("details", { class: "probs", open: open || null, id: sid ? null : "problems" }, h("summary", null, label),
      h("ul", null, ps.map((x) => h("li", null, ext(ghBlob(lib, x.path, x.line ? `L${x.line}` : null), h("code", null, x.path.replace(/^library\//, "")), x.line ? ` line ${x.line}` : "", lib.github ? " ↗" : ""), `: ${x.message}`))),
      h("p", { class: "muted" }, "Its owner fixes the file on main; ", guide(), " has the rules and templates."));
  }

  // ---------- the page ----------

  /** The page's cache: the same address and the same reads draw the same element, so a live redraw keeps its state. */
  const drawn = { key: null, el: null, scrolled: null, scrolling: null };

  /**
   * The Library tab's body for a project (`p`: its record, `name` its name). null until the route is a library's.
   * The "as of" line and the banners are drawn each time; the rest only when what it shows changed.
   */
  function view(p) {
    const r = route();
    if (!r) return null;
    const key = r.key, name = p?.name ?? key;
    const read = libraryRead(key);
    if (!read.reply) {
      if (read.error) return [h("div", { class: "banner down" }, h("b", null, "The library couldn't be read"), h("span", null, read.error), app.button("Retry", "", () => { libraryRead(key, true); scheduleRender(); }))];
      return [skeleton()];
    }
    const lib = read.reply.library;
    noteMoved(key, name, lib);
    const err = read.error ? h("div", { class: "banner down" }, h("b", null, "The library couldn't be read"), h("span", null, `${read.error} What was read is below.`),
      app.button("Retry", "", () => { libraryRead(key, true); scheduleRender(); })) : null;
    if (!lib) {
      return [err, h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, `No library from ${name}'s laptop yet.`),
        h("p", null, "The supervisor on a project's laptop reads its ", h("code", null, "library/"), " folder on main and sends it here. One older than the release with libraries sends none."))];
    }
    const sec = r.section ? sectionsOf(read.reply).find((s) => s.id === r.section) : null;
    const pages = pagesFor(key, read.reply, lib, sec, r);
    const pageKey = [location.hash.split("?")[0].split("/").slice(0, sec && ["decisions", "usecases", "ux"].includes(sec.id) ? 5 : 4).join("/"), read.read,
      ...pages.map((x) => (x ? `${x.read}:${x.error ?? ""}` : "-")), Boolean(md.lib), md.error ?? ""].join("|");
    if (drawn.key !== pageKey) {
      drawn.key = pageKey;
      drawn.el = frame(key, name, read.reply, lib, sec, r, pages);
    }
    scrollTo(r);
    return [err, banners(lib, name), drawn.el];
  }

  /** The reads a page needs beyond the index: its texts, and for use cases the architecture's, for their flows. */
  function pagesFor(key, read, lib, sec, r) {
    if (!sec || !written(lib, sec.id)) return [];
    const out = [];
    const cards = ["decisions", "usecases", "ux"].includes(sec.id);
    if (cards && r.item) {
      const c = cardsOf(lib, sec.id).find((x) => x.num === r.item);
      out.push(c && !c.too_large ? pageRead(key, sec.id, c.path) : null);
    } else if (sec.id !== "architecture" && sec.id !== "data") out.push(pageRead(key, sec.id));
    if (sec.id === "usecases" && written(lib, "architecture") && !filesOf(lib, "architecture").some((f) => f.too_large)) out.push(pageRead(key, "architecture"));
    return out;
  }

  /** "Main moved while open" (spec §13): the page is redrawn where it was, and says so. */
  const commits = new Map();
  function noteMoved(key, name, lib) {
    const was = commits.get(key);
    commits.set(key, lib?.commit ?? null);
    if (was && lib?.commit && was !== lib.commit) toast(`${name}'s library is now ${branchOf(lib)} at ${sha7(lib.commit)}.`);
  }

  /** A heading, a term or a card's heading in the address is brought into view once, after the page is drawn. */
  function scrollTo(r) {
    const card = r.section && ["decisions", "usecases", "ux"].includes(r.section);
    const at = card ? r.focus : ["overview", "glossary"].includes(r.section) ? r.item : null;
    const want = location.hash;
    if (drawn.scrolled === want || drawn.scrolling === want) return;
    if (!at) return void (drawn.scrolled = want);
    // After the hash change's own scroll to the top; until the page has the target, a later draw tries again.
    drawn.scrolling = want;
    setTimeout(() => {
      drawn.scrolling = null;
      if (location.hash !== want) return;
      const el = document.getElementById(r.section === "glossary" ? `t-${at}` : `h-${at}`);
      if (!el) return;
      drawn.scrolled = want;
      if (r.section === "glossary") for (const x of document.querySelectorAll(".term")) x.classList.toggle("on", x === el);
      el.scrollIntoView({ block: r.section === "glossary" ? "center" : "start" });
    }, 0);
  }

  function skeleton() {
    return h("div", { class: "lib" }, h("div", { class: "lib-rail" }, h("div", { class: "skel" }, h("i"), h("i"), h("i"), h("i"), h("i"), h("i"), h("i"))),
      h("div", { class: "doc-page wide" }, h("p", { class: "muted" }, "Reading the library…"),
        h("div", { class: "lib-tiles" }, [1, 2, 3, 4, 5, 6].map(() => h("div", { class: "card lib-tile skel" }, h("i"), h("i"))))));
  }

  /** The rail and the page: the seven sections in the standard's order (spec §5), a missing one muted with who writes it. */
  function frame(key, name, read, lib, sec, r, pages) {
    const title = overviewHead(lib).title || name;
    let content;
    if (!r.section) content = home(key, name, read, lib);
    else if (!sec) content = h("div", { class: "doc-page" }, h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, `A library has no section "${r.section}".`), h("p", null, h("a", { href: libHref(key) }, `${title}'s sections`))));
    else if (!written(lib, sec.id)) content = notWritten(lib, sec);
    else content = section(key, read, lib, sec, r, pages);

    const rail = h("nav", { class: "lib-rail", "aria-label": `${title} library` });
    const pick = h("button", { type: "button", class: "secs-pick", "aria-expanded": "false", onclick: () => {
      const on = rail.classList.toggle("open");
      pick.setAttribute("aria-expanded", String(on));
    } }, h("span", null, h("span", { class: "muted" }, "Section: "), sec ? sec.label : "Home"), h("span", { "aria-hidden": "true" }, "▾"));
    rail.append(pick, h("div", { class: "lab" }, `${title} library`),
      h("div", { class: "secs-nav" },
        h("a", { href: libHref(key), "aria-current": !r.section ? "page" : null }, h("span", null, "Home")),
        sectionsOf(read).map((s) => {
          const ok = written(lib, s.id), n = problemsIn(read, lib, s.id).length;
          return h("a", { href: libHref(key, s.id), class: ok ? null : "missing", "aria-current": sec?.id === s.id ? (r.item ? "true" : "page") : null },
            h("span", null, s.label, n ? h("span", { class: "pdot", title: plural(n, "problem") }, ` ${n}`) : null), ok ? null : h("small", null, `not written yet · ${s.role}`));
        })),
      h("div", { class: "foot" }, lib.github ? ext(lib.index ? ghTree(lib, "library") : lib.github, lib.index ? "library/ on GitHub ↗" : "Repository ↗") : null, guide("The library standard ↗")));
    const toc = content.toc?.length >= 3 ? h("aside", { class: "lib-toc", "aria-label": "On this page" }, h("div", { class: "lab" }, "On this page"), tocList(content.toc, content.tocHref)) : null;
    const wrap = h("div", { class: `lib${toc ? " has-toc" : ""}` }, rail, h("div", { class: "doc-col" }, content), toc);
    if (toc) queueMicrotask(() => spy(wrap));
    return wrap;
  }
  const tocList = (toc, href) => h("ul", null, toc.map((t) => h("li", { class: `h${t.n}` }, h("a", { href: href ? href(t.id) : `#h-${t.id}`, dataset: { h: t.id } }, t.text))));
  /** On a wide screen, On this page marks the section being read. */
  function spy(root) {
    if (typeof IntersectionObserver === "undefined") return;
    const links = [...root.querySelectorAll(".lib-toc a")];
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.dataset.h === e.target.id.slice(2)));
    }, { rootMargin: "-80px 0px -70% 0px" });
    for (const a of links) {
      const el = root.querySelector(`#h-${CSS.escape(a.dataset.h)}`);
      if (el) io.observe(el);
    }
  }

  // ---------- the home: seven tiles, from the index only (spec §6) ----------

  function home(key, name, read, lib) {
    if (!lib.index) return notConverted(key, name, read, lib);
    const head = overviewHead(lib);
    const tiles = sectionsOf(read).map((s) => {
      const fs = filesOf(lib, s.id), n = problemsIn(read, lib, s.id).length, owner = ownerOf(lib, s);
      if (!fs.length) {
        return h("a", { class: "card lib-tile missing", href: libHref(key, s.id) }, h("b", null, s.label), h("span", { class: "nw" }, "Not written yet"),
          h("span", { class: "by" }, `the ${s.role}${owner ? `, ${owner},` : ""} writes it`));
      }
      return h("a", { class: "card lib-tile", href: libHref(key, s.id) }, h("b", null, s.label, n ? h("span", { class: "pdot" }, ` ${plural(n, "problem")}`) : null),
        h("ul", { class: "gl" }, glance(lib, s)),
        h("span", { class: "by" }, h("span", null, owner ?? s.role), h("span", null, `changed ${dayOf(fs.map((f) => f.changed.date).sort().pop())}`)));
    });
    const k = sectionsOf(read).filter((s) => written(lib, s.id)).length;
    const who = [["product-owner", "product owner"], ["architect", "architect"], ["designer", "designer"]].filter(([w]) => head[w]).map(([w, role]) => `${head[w]}, ${role}`);
    return h("div", { class: "doc-page wide lib-home" },
      h("div", { class: "doc-head" }, h("h1", { class: "doc-title" }, head.title || name), head.tagline ? h("p", { class: "lede" }, head.tagline) : null, who.length ? h("p", { class: "muted who" }, who.join(" · ")) : null),
      problemList(read, lib, null, true),
      h("div", { class: "lib-tiles" }, tiles),
      h("p", { class: "lib-how" }, `${k} of 7 sections written. Each is a file or a folder under library/ on ${branchOf(lib)}, the same in every project: `, guide(), ". To change one, ask its owner."));
  }
  function glance(lib, s) {
    const tag = (t) => h("span", { class: "k" }, t);
    if (s.id === "overview") return h("li", null, tag("page"), " Goals, scope and quality goals");
    if (s.id === "architecture") return h("li", null, tag("C4 diagram"), " Context, containers, components and flows");
    if (s.id === "data") return h("li", null, tag("ERD"), " All tables, in Liam");
    if (s.id === "glossary") return h("li", null, tag("A–Z"), " Terms in users' words");
    const cs = cardsOf(lib, s.id), [one, many] = NOUN[s.id];
    const by = new Map();
    for (const c of cs) by.set(c.head.status || "no status", (by.get(c.head.status || "no status") ?? 0) + 1);
    return [h("li", null, tag(`${cs.length} ${cs.length === 1 ? one : many}`), h("span", { class: "nw-s" }, ` latest: ${clip(cs[0].title ?? cs[0].path, 64)}`)),
      h("li", { class: "sts" }, [...by].map(([w, n]) => `${n} ${w}`).join(" · "))];
  }
  /** No library/ on main (0017 §5): the seven sections, each not written yet, and the guide. */
  function notConverted(key, name, read, lib) {
    return h("div", { class: "doc-page wide lib-home" },
      h("div", { class: "doc-head" }, h("h1", { class: "doc-title" }, `${name}'s library`)),
      h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, `${name} has no library on ${branchOf(lib)} yet.`),
        h("p", null, "A library is seven sections in a ", h("code", null, "library/"), ` folder on main, in the same files in every project. ${name}'s ${branchOf(lib)} at ${sha7(lib.commit)} has none, so each section below is not written yet.`),
        h("p", null, "Its team writes them from the templates in ", guide(), ". Files elsewhere in the repo aren't read.")),
      h("div", { class: "lib-tiles" }, sectionsOf(read).map((s) => h("a", { class: "card lib-tile missing", href: libHref(key, s.id) }, h("b", null, s.label),
        h("span", { class: "nw" }, "Not written yet"), h("span", { class: "by" }, h("code", null, s.path))))));
  }
  /** A section with no file (0016 §3, 0017 §5): what it holds, who writes it, and where. */
  function notWritten(lib, s) {
    const owner = lib.index ? ownerOf(lib, s) : null;
    return h("div", { class: "doc-page" },
      h("div", { class: "doc-head" }, h("h1", { class: "doc-title" }, s.label)),
      h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, `${s.label} isn't written yet.`),
        h("p", null, `It holds: ${HOLDS[s.id].charAt(0).toLowerCase()}${HOLDS[s.id].slice(1)}`),
        h("p", null, `The ${s.role}${owner ? ` (${owner})` : ""} writes it as `, h("code", null, s.path), ` on ${branchOf(lib)}, from its template in `, guide(), ".")));
  }

  // ---------- a section ----------

  function section(key, read, lib, sec, r, pages) {
    const owner = ownerOf(lib, sec) ?? sec.role;
    const head = h("div", { class: "sec-head" }, h("h1", { class: "doc-title" }, sec.label), h("span", { class: "muted" }, `owner ${owner}`));
    if (sec.id === "architecture" || sec.id === "data") return h("div", { class: "doc-page wide" }, head, problemList(read, lib, sec.id), diagramSoon(lib, sec));
    const cards = ["decisions", "usecases", "ux"].includes(sec.id);
    const [texts, c4] = pages;
    const fail = pages.find((x) => x?.error && !x.reply);
    if (fail) {
      return h("div", { class: "doc-page" }, head, h("div", { class: "banner down" }, h("b", null, `${sec.label} couldn't be read`), h("span", null, fail.error),
        app.button("Retry", "", () => { for (const x of pages) if (x?.error) keptRead(x.op, key, () => shownKey() === key, true); scheduleRender(); })));
    }
    let body;
    if (cards && r.item) return cardPage(key, read, lib, sec, r, texts, sec.id === "usecases" ? c4 : null);
    if (cards) body = cardList(key, lib, sec, texts, c4);
    else if (sec.id === "glossary") body = glossary(key, read, lib, texts);
    else body = prose(key, read, lib, sec, texts);
    const el = h("div", { class: `doc-page${body.wide ? " wide" : ""}` }, head, problemList(read, lib, sec.id), body);
    el.toc = body.toc;
    el.tocHref = body.tocHref;
    return el;
  }
  const textOf = (page, path) => page?.reply?.files.find((f) => f.path === path)?.text ?? null;
  const reading = () => h("p", { class: "muted" }, "Reading…");
  /** A file too large to show (0017 §4): its link on GitHub. */
  const tooLarge = (lib, f) => h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, "This file is too large to show here."),
    h("p", null, `${f.path} is ${kb(f.bytes)}, over the 512 KB a file may be. `, ext(ghBlob(lib, f.path), "Read it on GitHub ↗")));

  /** Build B draws these; until then the section says so, and links its files. */
  function diagramSoon(lib, sec) {
    const fs = filesOf(lib, sec.id);
    const kind = sec.id === "architecture" ? "LikeC4" : "DBML";
    return [
      h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, sec.id === "architecture" ? "The model isn't drawn here yet." : "The data model isn't drawn here yet."),
        h("p", null, `Its diagram${sec.id === "architecture" ? "s come" : " comes"} with the library's viewers, in the next build. Its ${fs.length === 1 ? "file is" : "files are"} on GitHub:`),
        h("ul", { class: "files" }, fs.map((f) => h("li", null, ext(ghBlob(lib, f.path), h("code", null, f.path.replace(/^library\//, "")), lib.github ? " ↗" : ""), h("span", { class: "muted" }, ` ${kb(f.bytes)}`))))),
      h("p", { class: "src-line" }, h("b", null, "Model: "), ext(sec.id === "architecture" ? ghTree(lib, "library/architecture") : ghBlob(lib, "library/data-model.dbml"),
        sec.id === "architecture" ? "library/architecture/" : "data-model.dbml", lib.github ? " ↗" : ""), ` · ${kind} · ${branchOf(lib)} at ${sha7(lib.commit)}`),
    ];
  }

  const metaLine = (lib, f, owner) => h("div", { class: "doc-meta" }, owner ? h("span", null, `owner ${owner}`) : null,
    h("span", null, "changed ", h("code", null, sha7(f.changed.sha)), `, ${dayOf(f.changed.date)}`),
    ext(ghBlob(lib, f.path), `${f.path}${lib.github ? " ↗" : ""}`));
  const tocFold = (toc, href) => h("details", { class: "toc-fold" }, h("summary", null, `On this page · ${plural(toc.filter((t) => t.n === 2).length, "section")}`), tocList(toc, href));

  /** The overview (spec §12): its tagline as the lede, its meta line, its fixed headings. Front matter heads the home. */
  function prose(key, read, lib, sec, page) {
    const f = filesOf(lib, sec.id)[0];
    if (f.too_large) return tooLarge(lib, f);
    const text = textOf(page, f.path);
    if (text === null) return reading();
    const headHref = (id) => libHref(key, sec.id, id);
    const { doc, toc } = renderDoc(read, lib, bodyOf(text), { base: f.path, headHref });
    const meta = metaLine(lib, f);
    const tagline = sec.id === "overview" ? overviewHead(lib).tagline : null;
    const el = h("article", { class: "doc-body" }, tagline ? h("p", { class: "lede" }, tagline) : null, meta, toc.length >= 3 ? tocFold(toc, headHref) : null, doc);
    el.toc = toc;
    el.tocHref = headHref;
    return el;
  }

  // ---------- cards: decisions, use cases, UX (0017 §2; spec §9), their lists from the index's heads ----------

  const cardRef = (key, lib, sid, num) => {
    const c = cardsOf(lib, sid).find((x) => x.num === num);
    return h("a", { href: libHref(key, sid, num) }, h("span", { class: "cnum" }, num), c ? ` ${c.title ?? ""}` : " (no such card)");
  };
  /** The first paragraph under a heading, for a card's face. */
  const paraUnder = (text, heading) => {
    const m = new RegExp(`\\n## ${heading}\\s*\\n+([\\s\\S]*?)(\\n\\s*\\n|$)`).exec(`\n${bodyOf(text)}`);
    return m ? plain(m[1].replace(/\n/g, " ")).trim() : "";
  };

  function cardList(key, lib, sec, texts, c4) {
    const cards = cardsOf(lib, sec.id), [one, many] = NOUN[sec.id];
    const st = { q: "", status: "" };
    const words = [...new Set(cards.map((c) => c.head.status).filter(Boolean))];
    const q = h("input", { type: "search", class: "find", placeholder: `Find a ${one}`, "aria-label": `Find a ${one}`, "data-fk": `lib-find-${sec.id}`, oninput: () => { st.q = q.value.trim().toLowerCase(); draw(); } });
    const seg = words.length > 1 ? h("span", { class: "seg filters" }, [["", "All"], ...words.map((w) => [w, w.charAt(0).toUpperCase() + w.slice(1)])].map(([v, t]) =>
      h("button", { type: "button", "aria-pressed": String(v === ""), onclick: (e) => { st.status = v; for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === e.currentTarget)); draw(); } },
        t, h("span", { class: "count" }, ` ${v ? cards.filter((c) => c.head.status === v).length : cards.length}`)))) : null;
    const count = h("span", { class: "count muted", "aria-live": "polite" });
    const hay = cards.map((c) => `${c.num} ${c.title ?? ""} ${Object.values(c.head).join(" ")} ${(textOf(texts, c.path) ?? "").slice(0, 4000)}`.toLowerCase());
    const arch = c4?.reply?.files ?? null;
    const items = cards.map((c) => (sec.id === "decisions" ? adrRow(key, lib, c) : sec.id === "usecases" ? ucCard(key, lib, c, textOf(texts, c.path), arch) : uxCard(key, c)));
    const none = h("p", { class: "muted none", hidden: true }, `No ${one} matches. Clear the find${seg ? " or pick All" : ""}.`);
    const holder = sec.id === "decisions" ? h("ol", { class: "adr-list" }, items) : h("div", { class: sec.id === "ux" ? "ux-grid" : "uc-grid" }, items);
    function draw() {
      let k = 0;
      cards.forEach((c, i) => {
        const on = (!st.status || c.head.status === st.status) && (!st.q || hay[i].includes(st.q));
        items[i].hidden = !on;
        k += on;
      });
      count.textContent = st.q || st.status ? `${k} of ${cards.length} ${many}` : `${cards.length} ${cards.length === 1 ? one : many}, newest first`;
      none.hidden = k > 0;
    }
    draw();
    const el = h("div", { class: "cards-page" }, h("div", { class: "find-bar" }, q, seg, count), holder, none);
    el.wide = true;
    return el;
  }
  function adrRow(key, lib, c) {
    const by = supersededBy(lib, c.num);
    return h("li", null, h("a", { class: "adr", href: libHref(key, "decisions", c.num) },
      h("span", { class: "n" }, c.num), h("span", { class: "t" }, c.title ?? c.path, by.length ? h("small", null, ` superseded by ${andJoin(by)}`) : null), h("span", { class: "s" }, pill(c.head.status)),
      h("span", { class: "d" }, c.head.date ? dayYear(c.head.date) : ""), h("span", { class: "b" }, andJoin(listOf(c.head["decision-makers"])))));
  }
  function ucCard(key, lib, c, text, arch) {
    const flow = flowOf(arch, c.num), ux = uxFor(lib, c.num), goal = text ? paraUnder(text, "Goal") : "";
    return h("article", { class: "card uc-card" },
      h("div", { class: "uc-h" }, h("span", { class: "cnum" }, c.num), pill(c.head.status)),
      h("a", { class: "uc-t", href: libHref(key, "usecases", c.num) }, c.title ?? c.path),
      h("dl", { class: "uc-f" }, h("div", null, h("dt", null, "Actor"), h("dd", null, c.head.actor || "–")), goal ? h("div", null, h("dt", null, "Goal"), h("dd", null, clip(goal, 150))) : null),
      flow || ux.length ? h("div", { class: "uc-links" }, flow ? h("a", { class: "chip-b", href: libHref(key, "architecture", flow) }, "Its flow ›") : null,
        ux.map((u) => h("a", { class: "chip-b", href: libHref(key, "ux", u.num) }, `UX ${u.num}`))) : null);
  }
  function verdictOf(f) {
    if (f.verdict) return h("div", { class: "ux-v" }, h("q", null, f.verdict), h("span", { class: "muted" }, f["verdict-date"] ? `the verdict, ${dayYear(f["verdict-date"])}` : "the verdict"));
    if (f.status === "in review") return h("div", { class: "ux-v wait" }, "Waiting on a verdict");
    if (f.status === "changes asked") return h("div", { class: "ux-v wait" }, "Changes asked");
    return h("div", { class: "ux-v none" }, "No verdict yet");
  }
  function uxCard(key, c) {
    const f = c.head, ucs = listOf(f["use-cases"]);
    return h("article", { class: "card ux-card" },
      h("div", { class: "ux-top" }, h("span", { class: "cnum" }, c.num), f.feature ? h("span", { class: "id" }, f.feature) : null, pill(f.status)),
      h("a", { class: "ux-t", href: libHref(key, "ux", c.num) }, c.title ?? c.path), verdictOf(f),
      ucs.length ? h("div", { class: "uc-links" }, h("span", { class: "muted" }, "Use cases"), ucs.map((n) => h("a", { class: "chip-b", href: libHref(key, "usecases", n) }, n))) : null,
      h("div", { class: "actions" }, h("a", { class: "btn", href: libHref(key, "ux", c.num) }, "The card"),
        /^https?:\/\//.test(f.prototype ?? "") ? h("a", { class: "btn", href: f.prototype, target: "_blank", rel: "noopener" }, "Prototype ↗") : null));
  }

  /** One card: its kind and number, its title, its head as fields, its problems, then its fixed headings. */
  function cardPage(key, read, lib, sec, r, page, c4) {
    const c = cardsOf(lib, sec.id).find((x) => x.num === r.item);
    const back = h("a", { class: "back", href: libHref(key, sec.id) }, `‹ ${sec.label}`);
    if (!c) {
      return h("div", { class: "doc-page" }, h("div", { class: "doc-body" }, back, h("div", { class: "empty-card lib-empty nw-card" }, h("b", null, `${sec.label} has no card ${r.item}.`),
        h("p", null, "Its cards are the files ", h("code", null, `${sec.path}NNNN-slug.md`), ` on ${branchOf(lib)}.`))));
    }
    const f = c.head;
    const row = (k, v) => (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) ? null : h("div", null, h("dt", null, k), h("dd", null, v)));
    const refs = (sid, nums) => nums.map((n, i) => [i ? h("br") : null, cardRef(key, lib, sid, n)]);
    let fields;
    if (sec.id === "decisions") {
      fields = [row("Status", pill(f.status)), row("Date", f.date && dayYear(f.date)), row("Decided by", andJoin(listOf(f["decision-makers"]))),
        row("Supersedes", refs("decisions", listOf(f.supersedes))), row("Superseded by", refs("decisions", supersededBy(lib, c.num))), row("Feature", f.feature)];
    } else if (sec.id === "usecases") {
      const flow = flowOf(c4?.reply?.files ?? null, c.num);
      fields = [row("Status", pill(f.status)), row("Actor", f.actor), row("Date", f.date && dayYear(f.date)), row("Feature", f.feature),
        row("Flow", flow ? h("a", { href: libHref(key, "architecture", flow) }, "Its flow, in the architecture ›") : null),
        row("UX design", refs("ux", uxFor(lib, c.num).map((u) => u.num)))];
    } else {
      fields = [row("Status", pill(f.status)), row("Verdict", f.verdict ? [h("q", null, f.verdict), f["verdict-date"] ? ` · ${dayYear(f["verdict-date"])}` : ""] : null),
        row("Prototype", /^https?:\/\//.test(f.prototype ?? "") ? h("a", { href: f.prototype, target: "_blank", rel: "noopener" }, "Open it ↗") : null),
        row("Use cases", refs("usecases", listOf(f["use-cases"]))), row("Date", f.date && dayYear(f.date)), row("Feature", f.feature)];
    }
    const mine = lib.problems.filter((x) => x.kind !== "fetch_failed" && x.path === c.path);
    const meta = metaLine(lib, c, ownerOf(lib, sec));
    const head = h("div", { class: "child-head" }, back, h("span", { class: "eyebrow" }, `${sec.card} ${c.num}`), h("h2", { class: "child-t" }, c.title ?? c.path),
      mine.length ? h("ul", { class: "probs-in" }, mine.map((x) => h("li", null, x.line ? `Line ${x.line}: ` : "", x.message))) : null,
      h("dl", { class: "uc-f wide head-box" }, fields), meta);
    const article = h("article", { class: "doc-body" }, head);
    const wrap = h("div", { class: "doc-page" }, article);
    if (c.too_large) return article.append(tooLarge(lib, c)), wrap;
    const text = textOf(page, c.path);
    if (text === null) return article.append(page?.error ? h("p", { class: "warn-t" }, `The card couldn't be read: ${page.error}`) : reading()), wrap;
    let body = bodyOf(text);
    // Use cases: Given, when and then stand out in the acceptance (spec §9.2).
    if (sec.id === "usecases") body = body.replace(/(\n## Acceptance\s*\n)([\s\S]*?)(?=\n## |$)/, (_, hd, s) => hd + s.replace(/\b(Given|when|then)\b/g, "**$1**"));
    const headHref = (id) => libHref(key, sec.id, c.num, id);
    const { doc, toc } = renderDoc(read, lib, body, { base: c.path, headHref });
    if (toc.length >= 3) meta.after(tocFold(toc, headHref));
    article.append(doc);
    wrap.toc = toc;
    wrap.tocHref = headHref;
    return wrap;
  }

  // ---------- the glossary: one ## Term per entry, A to Z; "Also:" its other words (0017 §2; spec §12) ----------

  function glossary(key, read, lib, page) {
    const f = filesOf(lib, "glossary")[0];
    if (f.too_large) return tooLarge(lib, f);
    const raw = textOf(page, f.path);
    if (raw === null) return reading();
    const terms = [];
    for (const part of bodyOf(raw).split(/\n(?=## )/)) {
      const m = /^## +(.+)\n?([\s\S]*)$/.exec(part.trim());
      if (!m) continue;
      let body = m[2].trim(), also = [];
      const a = /^Also: *(.+)(\n|$)/.exec(body);
      if (a) {
        also = a[1].split(",").map((x) => x.trim());
        body = body.slice(a[0].length).trim();
      }
      terms.push({ term: m[1].trim(), id: slug(m[1]), also, body });
    }
    const q = h("input", { type: "search", class: "find", placeholder: "Find a term", "aria-label": "Find a term", "data-fk": "lib-find-glossary", oninput: () => draw() });
    const count = h("span", { class: "count muted", "aria-live": "polite" });
    const letters = [...new Set(terms.map((t) => t.term[0].toUpperCase()))];
    const az = h("nav", { class: "az", "aria-label": "Letters" }, letters.map((l) => h("a", { href: libHref(key, "glossary", terms.find((t) => t.term[0].toUpperCase() === l).id) }, l)));
    const rows = terms.map((t) => h("div", { class: "term", id: `t-${t.id}` },
      h("dt", null, h("a", { href: libHref(key, "glossary", t.id) }, t.term), t.also.length ? h("span", { class: "muted also" }, ` also ${t.also.join(", ")}`) : null),
      h("dd", null, renderDoc(read, lib, t.body, { base: f.path, headHref: null }).doc)));
    const none = h("p", { class: "muted none", hidden: true }, "No term matches. Clear the find.");
    function draw() {
      const s = q.value.trim().toLowerCase();
      let k = 0;
      terms.forEach((t, i) => {
        const on = !s || `${t.term} ${t.also.join(" ")} ${t.body}`.toLowerCase().includes(s);
        rows[i].hidden = !on;
        k += on;
      });
      count.textContent = s ? `${k} of ${terms.length} terms` : plural(terms.length, "term");
      none.hidden = k > 0;
    }
    draw();
    return h("div", { class: "doc-body gloss" }, metaLine(lib, f), h("div", { class: "find-bar" }, q, count), az, h("dl", { class: "terms" }, rows), none);
  }

  // ---------- the Projects menu (spec §3) and the project's tabs (spec §4) ----------

  /** A project's row in the Projects menu: its library's tagline, or that it isn't written; and its Library link. */
  function menuRow(p, here) {
    const l = p.library;
    return h("li", { class: `pm-row${here ? " here" : ""}` },
      h("a", { class: "pm-name", href: `#project/${p.key}` }, p.name),
      h("span", { class: "pm-sub" }, l?.written ? l.tagline || l.title || "" : "Library not written yet"),
      l ? h("a", { class: "pm-lib", href: libHref(p.key), "aria-label": `${p.name}'s library` }, "Library") : h("span", { class: "pm-nolib" }, "no library"));
  }

  return { route, view, asOf, menuRow, libraryRead };
}
