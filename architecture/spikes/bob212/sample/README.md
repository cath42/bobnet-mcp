# Toolshed: a sample library to the BobNet standard

Toolshed is fictional: a neighbourhood tool library where members borrow tools from sheds. Its `library/` is written
to the BobNet library standard (ADR 0017, `architecture/library-standard.md`), every section filled. It is public.
Daisy's v4 prototype draws it, and build A and B use it as their fixture, in place of any real project's repo.

| Section | File | What is in it |
|---|---|---|
| Overview | `library/overview.md` | Goals, stakeholders, scope, constraints, quality goals; the owners' names |
| Architecture | `library/architecture/` | `spec.c4` (the standard's), `model.c4`, `views.c4`: 2 people, 2 external systems, 6 containers (1 `#planned`), 7 components; the views `index`, `containers`, `apiComponents`, `workerComponents`, the flows `uc0001` and `uc0002`, and the deployment `prod` |
| Data model | `library/data-model.dbml` | 9 tables, 2 enums, 15 relations (one one-to-one), notes on every table; the diagrams `catalogue` and `lending`, which share `tool` |
| Decisions | `library/decisions/` | 3 ADRs: 0002 is superseded by 0003 |
| Use cases | `library/usecases/` | 3: two built, one agreed; 0001 and 0002 have flows in the architecture |
| UX design | `library/ux/` | 2 cards: one approved with the owner's verdict, one in review |
| Glossary | `library/glossary.md` | 10 terms |

## Checked (Toad, 2026-11-26)

- **The rules:** `node architecture/spikes/bob212/check-library.mjs architecture/spikes/bob212/sample` reports 0
  problems. On a broken copy, it reports each kind of problem in ADR 0017 §4.
- **The architecture:** `likec4 validate` (1.61.1) passes. Drawn in the spike's sandboxed LikeC4 viewer
  (`frame-test.mjs`), every view draws with 0 errors in about 0.3 s:
  - the context: 5 nodes;
  - `uc0001`: 5 nodes; `uc0002`: 8 nodes;
  - the deployment: 9 nodes.

  The drill from the containers to the API works at 1280 wide by a click, and at 390 wide by firing the button's
  click. The node is too small there to tap: ADR 0017 §7.
- **The data model:** `@dbml/parse` 13.0.0 parses it with no errors. The ERD viewer (`pack-erd-dbml.mjs`, Liam
  0.7.24's app) draws it in a sandboxed frame with no `'unsafe-eval'` (`frame-dbml-test.mjs`), at 1280 and at
  390 wide:
  - "All tables" as names only: 9 tables. Toggled live, it shows 52 attribute rows.
  - `lending` with its attributes: 6 tables and 41 rows. Toggled live, it shows names only.

  The only console error is Liam's Google Fonts request, which the CSP blocks. Build B's theme drops it.

- **Each table on its own (Q-22, 2026-11-27).** BobNet's own ERD viewer (`pack-erd-viewer.mjs`,
  `frame-erd-own-test.mjs`) draws it with a control on every table. At 1280 by mouse and 390 by tap: all closed;
  loan open among closed tables; loan and member open; loan closed with member still open. 0 errors and no
  overlapping tables. The shots are in `../shots-per-entity/`. Dropped after Q-23.
- **Liam as is (Q-23, 2026-11-27).** `@dbml/core` 13.1.0's exporter turns it into 178 lines of PostgreSQL DDL
  (2 enums, 9 tables, 15 foreign keys, 27 `COMMENT ON`s). Liam's own parser reads that exactly as Liam's CLI 0.7.24
  does, and Liam's unpatched app draws the 9 tables in a sandboxed frame at 1280 and at 390 wide
  (`../liam-as-is-test.mjs`). The notes show in Liam's side pane. The shots are in `../shots-liam-as-is/`.
