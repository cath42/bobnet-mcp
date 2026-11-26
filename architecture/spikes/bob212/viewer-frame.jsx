// BOB-212 spike: the LikeC4 viewer as BobNet would frame it. Opaque origin (sandbox="allow-scripts"),
// no network: the dashboard posts {sources, view}; the viewer posts back {view} when the reader drills.
import { fromSources } from "@likec4/language-services/browser";
import { LikeC4ModelProvider, ReactLikeC4 } from "likec4/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

function App({ model, start }) {
  const [viewId, setViewId] = useState(start);
  return (
    <LikeC4ModelProvider likec4model={model}>
      <ReactLikeC4 viewId={viewId} pannable zoomable fitView injectFontCss={false} colorScheme="light"
        style={{ width: "100vw", height: "100vh" }}
        onNavigateTo={(to) => { setViewId(to); parent.postMessage({ t: "view", view: to }, "*"); }} />
    </LikeC4ModelProvider>
  );
}

addEventListener("message", async (e) => {
  if (e.source !== parent || e.data?.t !== "sources") return;
  const t0 = performance.now();
  const likec4 = await fromSources(e.data.sources);
  const model = await likec4.layoutedModel();
  parent.postMessage({ t: "ready", ms: Math.round(performance.now() - t0), errors: likec4.getErrors().length }, "*");
  createRoot(document.getElementById("root")).render(<App model={model} start={e.data.view ?? "index"} />);
});
parent.postMessage({ t: "hello" }, "*");
