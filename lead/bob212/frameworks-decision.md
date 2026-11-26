# BOB-212: structure and zoomable diagrams (Casper, 2026-11-26, in Mario's session)

Casper asked what the library is built with ("just custom html pages?") and wanted "some structure around
architecture, data models, use cases, prototypes, ux design", then: "Its a lot of text though, could we think about
applying some architectural frameworks to be a bit more structured around our designs? And also recommend some
diagramming options that may even allow on to interact with and focus/zoom on details of a component or model or zoom
out and see bigger picture?"

Mario's recommendation:
- Frameworks: C4 (context / container / component / code, the zoom levels) for architecture; arc42-lite as the fixed
  section skeleton; short ADRs (context, options, decision, consequences, status); a use-case card template with its
  scenarios under it; UX design as one card per feature (spec, prototype link, Casper's verdict and date).
- Diagrams: LikeC4 (MIT, architecture as code in the repo, one model -> many views, click to drill in, pan/zoom,
  embeddable) for architecture; Liam ERD (Apache-2.0, interactive ER from the schema file, focus a table) for data
  models; Mermaid only for small sequence/flow diagrams. Not Structurizr (needs a server), not IcePanel (SaaS: the
  model would live outside the repo).
- Scope: BOB-212 brings the library in with the fixed skeleton and renders LikeC4 and Liam when a repo has them.
  Converting each project's content is that project's own item afterwards (BobNet first as the example). First a
  spike: one LikeC4 drill-down of BobNet itself and one Liam diagram of Vitals' schema, in the prototype, so Casper
  can try the zoom.

Casper: "Yes agreee go ahead".

So: Q-19 (verdict on the site-map prototype) withdrawn; Toad spikes and amends ADR 0015; Daisy reworks the spec and
prototype; then one verdict ask with the new link.
