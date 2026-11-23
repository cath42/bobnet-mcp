# BOB-120 discovery: BobNet's view (Mario, with Toad and Daisy)

2026-11-22. Mario's own view, plus Toad's and Daisy's consult answers (advisory: c_c5cf880b, c_196d2723; each records
what is adopted in its own folder). Luigi was building BOB-121 wave A and wasn't asked; Peach adds the PO's view
herself.

## What the routine should cover

**Mario (lead, weekly)**
- Board hygiene: open questions and actions on Waits (any over a day `keep`, edit or `withdraw`), fixes landed
  but not closed, Drafts with no plan, stale backlog captures.
- Model and effort fit: each role's tokens per session from the Usage page (BOB-121), against the work it did.
  Propose default changes to poe (the config is Casper's).
- Handoff files and `lead/bob*/` folders of closed features: archive.
- Test gate health: slow or flaky tests that refuse good lands (BOB-165), and the land's run time.
- Installed releases on each laptop: superseded rcs. This is poe's to run (the install folder is off limits to
  workers), and the supervisor's cleanup (BOB-123) already does part of it.

**Toad (architect)**
- Weekly: ADRs 0001-0014 against the code (0004 and 0005 drift most); mark superseded ones. There is no
  decisions index yet.
- Weekly: CLAUDE.md growth, the root file and the five role files. Look for duplicate rules, and role rules that
  restate the root. Cap their size.
- Weekly: repo hygiene. Prune merged `<role>/work` branches and stale worktrees. Never touch the live config or
  the installed releases.
- Weekly: broker D1, read-only. Row counts and size per table (`ci_runs`, runs, laptop reports), that age-out
  works, and schema against migrations.
- Per-feature work folders (`architecture/bob*`, `design/BOB-*`, spikes, reviews): archive them once the feature
  closes, keeping the decision in an ADR.

**Daisy (designer)**
- Weekly: each `design/<feature>/` spec against what was built. Log drift as a spec fix or a question to Peach.
- Weekly: the live dashboard at 390, 1024 and 1440, in empty, loading, error and thousand-item states. A miss is a
  BOB bug.
- Monthly: prune prototypes and shots superseded by a built screen. Check the prototype Worker against the
  latest spec.
- Monthly: a `style.css` audit (growth, duplicate rules, unused tokens, nothing borrowed from another product),
  and a wording pass: tokens, never dollars.

## BobNet's library (Casper's standard set, without the data model and taxonomy)

| Item | Now | Missing | Owner (proposed) |
|---|---|---|---|
| Architecture overview + details | ADR 0004 is the de facto overview | a standalone doc split out of 0004 | Toad |
| Use cases + scenarios | `design/BOB-121/use-cases.md` (dashboard only) | promoted to a project-level file citing Peach's criteria | Peach owns, Daisy writes UI flows |
| Decisions index | `architecture/decisions/` 0001-0014 | the index | Toad |
| Glossary | none | all | Toad drafts, Peach owns the terms |
| Requirements and board | `product/requirements/`, `product/BOARD.md`, `product/roadmap.md` | n/a | Peach |
| Loose docs | `docs/board-export-v1.md`, `docs/ci-reporting.md` | an owner | Toad (proposed) |

- The hub page ("BobNet · Library") and publishing: Peach.
- The weekly reconcile, source against the published page: each source's owner fixes drift. A script to diff
  them would be Luigi's, if BOB-120's design calls for one.
- Specs and prototypes are design views, not the standard set. Prototype HTML stays out of Docs, where it would
  go stale.
