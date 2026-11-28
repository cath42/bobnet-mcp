// BOB-212 (ADR 0016 §6, §7; 0017 §7): the LikeC4 viewer the library frames, from Daisy's prototype
// (design/BOB-212/tools/likec4-viewer.jsx) and Toad's spike (architecture/spikes/bob212/viewer-frame.jsx).
// Opaque origin, no network. Its messages are 0016 §6's:
// - hello; files {kind: "likec4", files: [{path, text}], focus}; ready {errors, views}; focus, both ways; open; fit;
// - LikeC4's own controls, navigation, search and notations off: BobNet's bar has the crumb and the picker.
// build.mjs bundles it and packs it into one file.
import { fromSources } from "@likec4/language-services/browser";
import { LikeC4ModelProvider, ReactLikeC4, useDiagram } from "likec4/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const post = (m) => parent.postMessage(m, "*");

// A link in the model can't open from the sandbox (no popups, no top navigation): the page opens it, by its own rule.
addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a || !/^https?:/i.test(a.href)) return;
  e.preventDefault();
  post({ t: "open", url: a.href });
}, true);

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
