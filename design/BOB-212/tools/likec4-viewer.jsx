// BOB-212 prototype: the LikeC4 viewer as the library frames it (ADR 0016 §6), from Toad's spike viewer
// (architecture/spikes/bob212/viewer-frame.jsx). Opaque origin, no network. What it adds for the spec (§9):
// - the messages of 0016 §6: hello; files {kind, files: [{path, text}], focus}; ready {errors, views}; focus; open;
// - two the page sends for BobNet's bar: {t: "focus", focus} (back out, pick a view) and {t: "fit"};
// - LikeC4's own top-left panel (logo, back and forward, title) hidden: BobNet's bar has the crumb.
// Built with the spike's esbuild flags, then packed by architecture/spikes/bob212/pack-viewer.mjs.
import { fromSources } from "@likec4/language-services/browser";
import { LikeC4ModelProvider, ReactLikeC4, useDiagram } from "likec4/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const post = (m) => parent.postMessage(m, "*");

/** Each view's way down from the context: the views of the element's ancestors that have one. */
function crumbs(model) {
  const out = [];
  for (const v of model.views()) {
    const trail = [];
    const of = v.viewOf;
    if (of) for (const a of of.ancestors()) if (a.defaultView && a.defaultView.id !== v.id) trail.unshift(a.defaultView.id);
    if (v.id !== "index" && trail[0] !== "index") trail.unshift("index");
    // The crumb names a level by its element ("Broker"); the context view is "Context".
    const label = of ? of.title : v.id === "index" ? "Context" : v.titleOrId;
    out.push({ id: v.id, title: v.titleOrId, label, dynamic: v.isDynamicView(), crumb: [...trail, v.id] });
  }
  return out;
}

function Fit() {
  const diagram = useDiagram();
  useEffect(() => {
    const on = (e) => { if (e.source === parent && e.data?.t === "fit") diagram.fitDiagram(300); };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [diagram]);
  return null;
}

function App({ model, start }) {
  const [viewId, setViewId] = useState(start);
  useEffect(() => {
    const on = (e) => { if (e.source === parent && e.data?.t === "focus" && e.data.focus) setViewId(e.data.focus); };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, []);
  return (
    <LikeC4ModelProvider likec4model={model}>
      <ReactLikeC4 viewId={viewId} pannable zoomable fitView fitViewPadding="24px" injectFontCss={false}
        controls={false} showNavigationButtons={false} enableSearch={false} enableNotations={false}
        enableCompareWithLatest={false} enableElementDetails enableRelationshipDetails enableFocusMode
        enableDynamicViewWalkthrough background="dots" style={{ width: "100vw", height: "100vh" }}
        onNavigateTo={(to) => { setViewId(to); post({ t: "focus", focus: to }); }}>
        <Fit />
      </ReactLikeC4>
    </LikeC4ModelProvider>
  );
}

let root = null;
addEventListener("message", async (e) => {
  if (e.source !== parent || e.data?.t !== "files" || e.data.kind !== "likec4") return;
  const t0 = performance.now();
  try {
    const likec4 = await fromSources(Object.fromEntries(e.data.files.map((f) => [f.path, f.text])));
    const model = await likec4.layoutedModel();
    const errors = likec4.getErrors().map((d) => ({ path: d.sourceFsPath.replace(/^.*?\/(?=[^/]+$)/, ""), line: d.line + 1, message: d.message }));
    const views = crumbs(model);
    const start = views.some((v) => v.id === e.data.focus) ? e.data.focus : "index";
    post({ t: "ready", errors, views, ms: Math.round(performance.now() - t0) });
    (root ??= createRoot(document.getElementById("root"))).render(<App model={model} start={start} />);
  } catch (err) {
    post({ t: "ready", errors: [{ path: "", line: 0, message: String(err?.message ?? err) }], views: [] });
  }
});
post({ t: "hello" });
