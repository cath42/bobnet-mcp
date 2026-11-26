// Stands in for the dashboard: it has the sources (over its socket in BobNet) and posts them in.
// The listener goes first: the viewer says hello as soon as it loads, maybe before the sources are here.
const frame = document.getElementById("v");
const sources = fetch("sources.json").then((r) => r.json());
addEventListener("message", async (e) => {
  if (e.source !== frame.contentWindow) return;
  if (e.data.t === "hello") frame.contentWindow.postMessage({ t: "sources", sources: await sources, view: location.hash.slice(1) || "containers" }, "*");
  if (e.data.t === "view") { document.getElementById("view").textContent = e.data.view; history.replaceState(null, "", "#" + e.data.view); }
  if (e.data.t === "ready") document.title = `ready ${e.data.ms} ms, ${e.data.errors} errors`;
});
