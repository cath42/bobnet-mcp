// BOB-212 (ADR 0017 §7, as amended for Casper's Q-22): BobNet's own ERD viewer, in place of Liam's app. It draws the
// library's data-model.dbml in the sandboxed frame: each table is a node with its own control, which shows or hides
// THAT table's columns in place; every other table stays as it was. React Flow draws (pan, zoom, pinch); dagre lays
// out, left to right, a referenced table left of the tables that refer to it. In a narrow frame (a phone, under
// 700 px) it lays out top to bottom, a referenced table above, so the diagram fits the width at a zoom where a node's
// control can be tapped; there the relations join the tables' edges, not their columns' rows.
// When a table opens or closes, the diagram is laid out again: dagre's order within a rank depends on the relations
// only, never on the sizes, so the same tables stay in the same order and only the spacing changes. The toggled table
// stays where it is on screen (the viewport moves with it) and the others glide to their places in 200 ms.
// Messages (ADR 0016 §6, 0017 §7):
// - in: files {kind: "erd", files: [{path, text}], view?, focus?, expanded?: [names]}; focus {focus}; fit;
//   inset {right, bottom}; expand {tables} (sets which tables are open: the page's "expand all" and "collapse all").
// - out: hello; ready {errors, views, note, tables, enums, shown, expanded}; focus {focus} (a click on a table, or
//   null on the background); expanded {tables} (the reader opened or closed one, for the page to keep per diagram);
//   hover {table, rect?} per change of table, on a fine pointer only.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useUpdateNodeInternals } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { readDbml } from "./dbml-model.mjs";

// A coarse pointer gets a bigger control and head; the CSS has the same numbers under (pointer: coarse).
const coarse = matchMedia("(pointer: coarse)").matches;
const HEAD = coarse ? 48 : 40, ROW = 26, PAD = 12, TOG = coarse ? 64 : 52, MS = 200;
const TB = innerWidth < 700;
const post = (m) => parent.postMessage(m, "*");
const bus = new EventTarget();
const fine = matchMedia("(hover: hover) and (pointer: fine)");
const cv = document.createElement("canvas").getContext("2d");
const tw = (s, font) => ((cv.font = font), cv.measureText(s).width);
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// A table's box, open or closed; the CSS draws it at exactly this size.
function size(t, open) {
  const head = PAD + tw(t.name, `600 13.5px ${MONO}`) + 10 + TOG + PAD;
  if (!open) return { width: Math.ceil(Math.max(120, head)), height: HEAD };
  const name = Math.max(...t.columns.map((c) => tw(c.name, `12.5px ${MONO}`)));
  const type = Math.max(...t.columns.map((c) => tw(c.type + (c.notNull ? "" : "?"), `12px ${MONO}`)));
  return { width: Math.ceil(Math.max(120, head, PAD + 24 + name + 16 + type + PAD)), height: HEAD + 6 + t.columns.length * ROW };
}

function layout(tables, open, rels) {
  const g = new dagre.graphlib.Graph();
  g.setGraph(TB ? { rankdir: "TB", nodesep: 28, ranksep: 56, marginx: 0, marginy: 0 } : { rankdir: "LR", nodesep: 22, ranksep: 70, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of tables) g.setNode(t.name, size(t, open.has(t.name)));
  for (const r of rels) if (r.source !== r.target) g.setEdge(r.target, r.source);
  dagre.layout(g);
  return Object.fromEntries(tables.map((t) => { const n = g.node(t.name); return [t.name, { x: n.x - n.width / 2, y: n.y - n.height / 2 }]; }));
}

const SIDE = { L: Position.Left, R: Position.Right, T: Position.Top, B: Position.Bottom };
const Anchor = ({ id, sides = "LR" }) => [...sides].flatMap((s) => ["source", "target"].map((k) => (
  <Handle key={s + k} id={`${k[0]}:${id}:${s}`} type={k} position={SIDE[s]} isConnectable={false} />
)));

const TableNode = memo(({ id, data }) => {
  const { table: t, open, lit, dim, fk, onToggle } = data, update = useUpdateNodeInternals();
  useEffect(() => update(id), [open, id, update]);
  return (
    <div className={`tbl${open ? " open" : ""}${lit ? " lit" : ""}${dim ? " dim" : ""}`}>
      <div className="head">
        <span className="name">{t.name}</span>
        <button type="button" className="tog nodrag nopan" aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} ${t.name}'s ${t.columns.length} columns`} title={open ? "Hide its columns" : "Show its columns"}
          onClick={(e) => { e.stopPropagation(); onToggle(t.name); }}>
          {!open && <span className="n">{t.columns.length}</span>}<span className="chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
        <Anchor id="h" />
      </div>
      <Anchor id="n" sides="TB" />
      {open && (
        <ul className="cols">
          {t.columns.map((c) => (
            <li key={c.name} className={c.pk ? "pk" : fk.has(c.name) ? "fk" : ""}>
              <span className="k">{c.pk ? "PK" : fk.has(c.name) ? "FK" : ""}</span>
              <span className="cn">{c.name}</span>
              <span className="ct">{c.type}{c.notNull ? "" : "?"}</span>
              <Anchor id={`c:${c.name}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
const nodeTypes = { table: TableNode };
const ease = (x) => 1 - (1 - x) ** 3;

function Erd({ model, shown, initial, initialFocus }) {
  const rf = useReactFlow();
  const tables = useMemo(() => model.tables.filter((t) => shown.has(t.name)), [model, shown]);
  const rels = useMemo(() => tables.flatMap((t) => t.fks.filter((f) => shown.has(f.table)).map((f) => ({
    id: `${t.name}.${f.columns.join(",")}`, source: t.name, target: f.table, col: f.columns[0], tcol: f.targetColumns[0], one: f.one,
  }))), [tables, shown]);
  const [open, setOpen] = useState(() => new Set(initial.filter((n) => shown.has(n))));
  const [pos, setPos] = useState(() => layout(tables, open, rels));
  const [focus, setFocus] = useState(null);
  const st = useRef({ open, pos, inset: { right: 0, bottom: 0 }, raf: 0, fitted: true });
  st.current.open = open; st.current.pos = pos;

  // Pan just enough to show the whole of a table that grew past the frame's edge; its top first.
  const reveal = useCallback((p, sz) => {
    const box = document.querySelector(".react-flow").getBoundingClientRect(), vp = rf.getViewport(), m = 16;
    const x0 = p.x * vp.zoom + vp.x, y0 = p.y * vp.zoom + vp.y, x1 = x0 + sz.width * vp.zoom, y1 = y0 + sz.height * vp.zoom;
    const dx = x1 > box.width - m ? box.width - m - x1 : 0, dy = y1 > box.height - m ? box.height - m - y1 : 0;
    const fx = x0 + dx < m ? m - x0 : dx, fy = y0 + dy < m ? m - y0 : dy;
    if (fx || fy) rf.setViewport({ x: vp.x + fx, y: vp.y + fy, zoom: vp.zoom }, { duration: 200 });
  }, [rf]);

  // The viewport that fits the whole diagram in the frame, at 100 % at most; from the layout, not from the DOM.
  const fitting = useCallback((p, o) => {
    const box = document.querySelector(".react-flow").getBoundingClientRect(), m = 0.06;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tables) { const z = size(t, o.has(t.name)), q = p[t.name]; x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + z.width); y1 = Math.max(y1, q.y + z.height); }
    const zoom = Math.max(0.2, Math.min(1, (box.width * (1 - 2 * m)) / (x1 - x0), (box.height * (1 - 2 * m)) / (y1 - y0)));
    return { x: (box.width - (x1 - x0) * zoom) / 2 - x0 * zoom, y: (box.height - (y1 - y0) * zoom) / 2 - y0 * zoom, zoom };
  }, [tables]);

  // Lay out again for `next`, gliding there. While the reader hasn't panned or zoomed since the last fit, the
  // whole diagram stays fitted; once they have, `anchor` (the table toggled) stays put on screen, then is shown whole.
  const relayout = useCallback((next, anchor) => {
    const s = st.current, from = s.pos, to = layout(tables, next, rels), vp0 = rf.getViewport(), t0 = performance.now();
    const vp1 = s.fitted || !anchor ? fitting(to, next) : null;
    if (!anchor) s.fitted = true;
    cancelAnimationFrame(s.raf);
    setOpen(next);
    const step = (now) => {
      const k = ease(Math.min(1, (now - t0) / MS)), at = {};
      for (const n of Object.keys(to)) at[n] = { x: from[n].x + (to[n].x - from[n].x) * k, y: from[n].y + (to[n].y - from[n].y) * k };
      setPos(at);
      if (vp1) rf.setViewport({ x: vp0.x + (vp1.x - vp0.x) * k, y: vp0.y + (vp1.y - vp0.y) * k, zoom: vp0.zoom + (vp1.zoom - vp0.zoom) * k });
      else rf.setViewport({ x: vp0.x - (at[anchor].x - from[anchor].x) * vp0.zoom, y: vp0.y - (at[anchor].y - from[anchor].y) * vp0.zoom, zoom: vp0.zoom });
      if (k < 1) s.raf = requestAnimationFrame(step);
      else if (!vp1) reveal(to[anchor], size(tables.find((t) => t.name === anchor), next.has(anchor)));
    };
    s.raf = requestAnimationFrame(step);
  }, [tables, rels, rf, reveal, fitting]);

  const onToggle = useCallback((name) => {
    const next = new Set(st.current.open);
    next.has(name) ? next.delete(name) : next.add(name);
    relayout(next, name);
    post({ t: "expanded", tables: [...next].sort() });
  }, [relayout]);

  // Centre a table at 100 % in the part of the frame the entity card leaves free.
  const centre = useCallback((name) => {
    const n = rf.getNode(name); if (!n) return;
    const { right, bottom } = st.current.inset, w = n.measured?.width ?? n.width, h = n.measured?.height ?? n.height;
    st.current.fitted = false;
    rf.setCenter(n.position.x + w / 2 + right / 2, n.position.y + h / 2 + bottom / 2, { zoom: 1, duration: 300 });
  }, [rf]);
  const open1 = useCallback((name, tell) => {
    const f = name && shown.has(name) ? name : null;
    setFocus(f); if (tell) post({ t: "focus", focus: f }); if (f) centre(f);
  }, [shown, centre]);

  useEffect(() => {
    const on = ({ detail: d }) => {
      if (d.t === "focus") open1(d.focus || null, false);
      if (d.t === "fit") { st.current.fitted = true; rf.setViewport(fitting(st.current.pos, st.current.open), { duration: 300 }); }
      if (d.t === "inset") st.current.inset = { right: +d.right || 0, bottom: +d.bottom || 0 };
      if (d.t === "expand" && Array.isArray(d.tables)) relayout(new Set(d.tables.filter((n) => shown.has(n))), null);
      if (d.t === "show") relayout(d.show === "columns" ? new Set(shown) : new Set(), null); // ADR 0017's old toggle: all or none
    };
    bus.addEventListener("m", on);
    return () => bus.removeEventListener("m", on);
  }, [open1, relayout, rf, shown, fitting]);

  const near = useMemo(() => focus && new Set([focus, ...rels.filter((r) => r.source === focus || r.target === focus).flatMap((r) => [r.source, r.target])]), [focus, rels]);
  const nodes = useMemo(() => tables.map((t) => {
    const o = open.has(t.name), s = size(t, o);
    return { id: t.name, type: "table", position: pos[t.name], width: s.width, height: s.height, draggable: false, selectable: false, connectable: false,
      data: { table: t, open: o, lit: focus === t.name, dim: !!near && !near.has(t.name), fk: new Set(t.fks.flatMap((f) => f.columns)), onToggle } };
  }), [tables, open, pos, focus, near, onToggle]);
  const edges = useMemo(() => rels.map((r) => {
    const lit = !!focus && (r.source === focus || r.target === focus), sfx = lit ? "-lit" : "";
    if (TB && r.source !== r.target) {
      const [vs, vt] = pos[r.source].y > pos[r.target].y ? ["T", "B"] : ["B", "T"];
      return { id: r.id, source: r.source, target: r.target, type: "default", className: lit ? "lit" : near ? "dim" : "",
        sourceHandle: `s:n:${vs}`, targetHandle: `t:n:${vt}`, markerStart: (r.one ? "one" : "many") + sfx, markerEnd: "one" + sfx, focusable: false };
    }
    const a = pos[r.source], b = pos[r.target], wa = size(tables.find((t) => t.name === r.source), open.has(r.source)).width, wb = size(tables.find((t) => t.name === r.target), open.has(r.target)).width;
    const [ss, ts] = a.x + wa < b.x ? ["R", "L"] : b.x + wb < a.x ? ["L", "R"] : ["R", "R"];
    return { id: r.id, source: r.source, target: r.target, type: "default", className: lit ? "lit" : near ? "dim" : "",
      // A closed table that refers to itself (category.parent_id) loops from its side into its top.
      sourceHandle: `s:${open.has(r.source) ? `c:${r.col}` : "h"}:${ss}`,
      targetHandle: r.source === r.target && !open.has(r.target) ? "t:n:T" : `t:${open.has(r.target) ? `c:${r.tcol}` : "h"}:${ts}`,
      markerStart: (r.one ? "one" : "many") + sfx, markerEnd: "one" + sfx, focusable: false };
  }), [rels, pos, open, tables, focus, near]);

  const ready = useRef(false);
  const onInit = useCallback(() => {
    if (ready.current) return; ready.current = true;
    rf.setViewport(fitting(st.current.pos, st.current.open));
    post({ t: "ready", errors: [], views: model.views, note: model.note, tables: model.tables, enums: model.enums, shown: [...shown], expanded: [...st.current.open].sort() });
    if (initialFocus) setTimeout(() => open1(initialFocus, false), 50);
  }, [model, shown, initialFocus, open1, rf, fitting]);

  const hov = useRef(null);
  const hover = (id) => {
    if (!fine.matches || id === hov.current) return; hov.current = id;
    const el = id && document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
    if (!el) return post({ t: "hover", table: null });
    const r = el.getBoundingClientRect();
    post({ t: "hover", table: id, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
  };

  return (
    <>
      <svg className="defs" aria-hidden="true"><defs>
        {["", "-lit"].map((s) => [
          <marker key={"many" + s} id={"many" + s} viewBox="0 0 16 16" refX="16" refY="8" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 8H16M4 8L16 1M4 8L16 15M4 2V14" className={"mk" + s} /></marker>,
          <marker key={"one" + s} id={"one" + s} viewBox="0 0 16 16" refX="16" refY="8" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 8H16M9 2V14M13 2V14" className={"mk" + s} /></marker>,
        ])}
      </defs></svg>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={onInit}
        minZoom={0.2} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} nodesFocusable={false}
        panOnScroll zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => open1(n.id, true)} onPaneClick={() => focus && open1(null, true)}
        onNodeMouseEnter={(_, n) => hover(n.id)} onNodeMouseLeave={() => hover(null)}
        onMoveStart={(e) => { if (e) st.current.fitted = false; }}>
        <Background gap={22} size={1} />
        <Controls showInteractive={false} showFitView={false} position="bottom-left" />
      </ReactFlow>
    </>
  );
}

const root = createRoot(document.getElementById("root"));
let n = 0;
addEventListener("message", (e) => {
  if (e.source !== parent || !e.data) return;
  const d = e.data;
  if (d.t !== "files") return bus.dispatchEvent(new CustomEvent("m", { detail: d }));
  if (d.kind !== "erd") return;
  const f = d.files[0], model = readDbml(f.text);
  if (model.errors.length) return post({ t: "ready", errors: model.errors.map((x) => ({ path: f.path, ...x })), views: [], tables: [] });
  const v = d.view && model.views.find((x) => x.id === d.view);
  const shown = new Set(v ? v.tables : model.tables.map((t) => t.name));
  root.render(<ReactFlowProvider key={++n}><Erd model={model} shown={shown} initial={Array.isArray(d.expanded) ? d.expanded : []} initialFocus={d.focus || null} /></ReactFlowProvider>);
});
post({ t: "hello" });
