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

## Q-21, v3 verdict (Casper, 2026-11-26, in Mario's session): changes

"Not a big fan of the data model layout, it seems to be either table or table with attributes for all in the diagram, I
was hoping to be able to toggle that by diagram. It also seems its sourcing from various types of files in each repo,
make it consistent for all and prototype using a sample instead of trying to use the repo, its confusing you and it
seems to create different diagram options for different repos thats definitely not what I want im looking for standards
and frameworks not \"work with what I've got\" please."

So:
- One standard for every project: each library section has one source format and one place in the repo, the same in
  every repo (no per-repo mapping of whatever files exist; build.py's mapping is not the model). A project that
  doesn't follow it yet shows the section as not written; converting is that project's own item.
- The data model diagram: a toggle per diagram between tables only and tables with their attributes (Daisy designs
  the control; per-table expand may sit beside it).
- Prototype v4 uses one sample project written to the standard, not Helix's or Vitals' repos.
- The project menu (A/B/C) is still open: asked again with v4.

## Q-22, v4 verdict (Casper, 2026-11-27, on the board): redo

"You still didn't get it, I want to be able to toggle column/attribute level details PER ENTITY, its still attribute
details for all or nothing that's not what I want"

The requirement, as a check the prototype must visibly pass before it goes back to him:
- On a data-model diagram, every entity (table node) has its own control on the node itself. Using it shows or hides
  THAT entity's attributes (columns) on the diagram, in place. Every other entity stays as it was. So one diagram can
  show Loan expanded with its columns, and Member and Tool as names only, at the same time.
- Works with a mouse and with a tap on a phone. Optional extras ("expand all", "collapse all") may sit beside it, but they
  are not the feature. The state is kept per diagram.
- Evidence before the ask: screenshots at 1280 and 390 showing one entity expanded among collapsed ones, then a
  second one expanded too. Mario looks at them.
Everything else from v4 stands (the standard, ADR 0017, Toolshed, the entity card, the C4 views). Menu A/B/C still open.

## The viewer: a framework or our own? (Casper, 2026-11-27, in Mario's session)

Casper on v5: "Is that a custom build? I wanted to try and stick to some good frameworks". Mario: the formats are all
open standards (DBML, LikeC4/C4, ADRs, arc42-lite); the LikeC4 viewer is off the shelf; the ERD viewer is a thin layer
of ours on React Flow + dagre + @dbml/parse, because Liam shows columns for all tables or none. Recommendation: keep the
standard at the source so the viewer can be swapped later, and first run a short, time-boxed check of off-the-shelf
DBML viewers (Azimutt, ChartDB, drawDB, others) against his needs; use one if it passes, else keep the thin layer.

Casper: "Agreed, keep the standard with an open standard as the data model foundation so the viewer can be replaced
later if needed. Let's go with that please"

So: DBML stays the data model's foundation; the viewer is replaceable. Toad runs the time-boxed check; Q-23 stays open
until it is done.
