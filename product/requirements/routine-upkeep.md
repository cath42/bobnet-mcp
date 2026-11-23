# Routine upkeep (BOB-120 discovery)

Status: discovery, 2026-11-22. Owner: Peach. Collects every project's answer to "what should the weekly
routine cover", with sources. AC2 (Casper's agreement) comes once every project has answered; nothing here
is a ruling yet.

## Casper's input: the library

Source: Casper via poe, 2026-11-22 ~18:5x; structure recorded in `portfolio-orchestrator/portfolio.yaml`
under `orchestrator.library` (read only).

- The weekly routine also reconciles each project's **library**.
- Each project keeps a **standard set in its repo**: architecture (overview and details), data model (entity
  level and detailed), use cases and business scenarios, taxonomy (data elements, definitions,
  calculations), decisions index (ADRs, PDRs) and a glossary. A project with no domain data model skips the
  data model and taxonomy (BobNet).
- Published **Docs and Sheets pages are views** of that set (Docs for prose, Sheets for the taxonomy), with
  **one hub page per project** ("<Project> · Library") listing each item, its source path, owner and
  published link. Titles are "<Project> · <Item>". Who Casper brings in to comment is his choice.
- The **weekly check** compares source with the published page, flags what is stale, and folds in comments
  from the people Casper brings in.

## BobNet

Source: Mario, with Toad's and Daisy's consult answers (advisory), 2026-11-22:
`lead/bob120/bobnet-view.md` on mario/work (`/Users/ct/Code/bobnet-mcp-mario`). Luigi was building BOB-121
wave A and wasn't asked. The PO view is Peach's own.

### What the routine should cover

**Mario (lead, weekly)**
- Board hygiene: open questions and actions on Waits (any over a day `keep`, edit or `withdraw`), fixes
  landed but not closed, Drafts with no plan, stale backlog captures.
- Model and effort fit: each role's tokens per session from the Usage page (BOB-121), against the work it
  did. Propose default changes to poe (the config is Casper's).
- Handoff files and `lead/bob*/` folders of closed features: archive.
- Test gate health: slow or flaky tests that refuse good lands (BOB-165), and the land's run time.
- Installed releases on each laptop: superseded rcs. This is poe's to run (the install folder is off limits
  to workers); the supervisor's cleanup (BOB-123) already does part of it.

**Toad (architect)**
- Weekly: ADRs 0001-0014 against the code (0004 and 0005 drift most); mark superseded ones. There is no
  decisions index yet.
- Weekly: CLAUDE.md growth, the root file and the five role files: duplicate rules, role rules that restate
  the root. Cap their size.
- Weekly: repo hygiene. Prune merged `<role>/work` branches and stale worktrees. Never touch the live config
  or the installed releases.
- Weekly: broker D1, read-only. Row counts and size per table (`ci_runs`, runs, laptop reports), that
  age-out works, and schema against migrations.
- Per-feature work folders (`architecture/bob*`, `design/BOB-*`, spikes, reviews): archive them once the
  feature closes, keeping the decision in an ADR.

**Daisy (designer)**
- Weekly: each `design/<feature>/` spec against what was built. Log drift as a spec fix or a question to
  Peach.
- Weekly: the live dashboard at 390, 1024 and 1440, in empty, loading, error and thousand-item states. A
  miss is a BOB bug.
- Monthly: prune prototypes and shots superseded by a built screen. Check the prototype Worker against the
  latest spec.
- Monthly: a `style.css` audit (growth, duplicate rules, unused tokens, nothing borrowed from another
  product) and a wording pass: tokens, never dollars.

**Peach (product owner, weekly): the PO's view**
- Board: every item has the right status for its evidence; Done features have all criteria checked with
  evidence; Ready tasks still have criteria that name their evidence; Drafts older than two weeks are slotted,
  archived or asked about; landed bug fixes are closed (the board message "fix landed" is the trigger, but
  the weekly pass catches any that were missed).
- Release plan: `product/roadmap.md` and the releases on the board agree; features sit in the release Casper
  set; anything Mario or poe captured is slotted or has a reason to wait. Release scope and order stay
  Casper's; I only report the drift.
- Requirements: each file in `product/requirements/` against what shipped. Mark criteria that were
  superseded, fold settled Q-answers into the file they change, and retire a file when its feature is
  replaced.
- Library: own the hub page ("BobNet · Library") and its publishing, and the requirements and use-case
  entries below. Run the weekly reconcile (below) and send each owner their stale list.
- Cost to Peach: this adds roughly one worker session per week; keep it to one pass over the board and the
  library table, not a re-read of every file.

### BobNet's library

BobNet has no domain data model or taxonomy, so it skips those two.

| Item | Now | Missing | Owner (proposed) |
|---|---|---|---|
| Architecture overview + details | ADR 0004 is the de facto overview | a standalone doc split out of 0004 | Toad |
| Use cases + scenarios | `design/BOB-121/use-cases.md` (dashboard only) | promoted to a project-level file citing Peach's criteria | Peach owns, Daisy writes UI flows |
| Decisions index | `architecture/decisions/` 0001-0014 | the index | Toad |
| Glossary | none | all | Toad drafts, Peach owns the terms |
| Requirements and board | `product/requirements/`, `product/BOARD.md`, `product/roadmap.md` | n/a | Peach |
| Loose docs | `docs/board-export-v1.md`, `docs/ci-reporting.md` | an owner | Toad (proposed) |

- The hub page and publishing: Peach (Mario's note: Toad proposes this).
- The weekly reconcile, source against the published page: each source's owner fixes drift. A script to diff
  them would be Luigi's, if BOB-120's design calls for one.
- Specs and prototypes are design views, not the standard set. Prototype HTML stays out of Docs, where it
  would go stale.

### Peach's notes on this view

- The routine is a list of checks per role; the board should carry each as a recurring item or the
  supervisor should schedule it. Which one is a BOB-120 design question, not decided here.
- The BobNet glossary needs terms that are used loosely today: feature, increment, task, session, release,
  wave. Peach owns the definitions, so a first pass should come from the board and `requirements/README.md`.

## Helix

Source: pending. PLACEHOLDER: Helix lead's (Bob's) view, which poe sends when it arrives. Context already
known from Casper's library input (Bob, 2026-11-22 18:54, via portfolio.yaml): architecture is an old
proposal plus CLAUDE.md plus call-graph (missing current overview, Bill); data model has detailed yaml and
generated html (missing entity one-pager, Bill; version label v5 against A-41 v7 to check); use cases
partial (missing catalogue, Picard); taxonomy missing (Bill and Picard); decisions exist in
`architecture/decisions`, `product/decisions`, `lead/rulings.md` (missing combined pointer); glossary missing
(Picard). Next, per poe: taxonomy first, published as Sheets. This is library inventory only; the weekly
routine's own scope for Helix is still to come.

## Vitals

Source: pending. PLACEHOLDER: Vitals lead's (Vita's) view, which poe sends when it arrives. Context already
known (Vita, 2026-11-22 18:54, via portfolio.yaml): data model exists (`data-model.mmd`,
`docs/design/data-model.html`, `schema.sql`); architecture in parts (missing deploy-topology overview); use
cases partial (missing catalogue); taxonomy partial (missing field dictionary); decisions exist
(`docs/decisions` 0001-0011; missing README and board rulings); glossary missing. Next, per poe: after
VIT-27, one docs PR, then a use-case catalogue. This is library inventory only; the routine's scope for
Vitals is still to come.

## Athletic

PLACEHOLDER: held (Casper: Envision can wait); at its next session.
