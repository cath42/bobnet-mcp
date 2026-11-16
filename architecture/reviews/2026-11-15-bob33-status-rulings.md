# BOB-33, BOB-35, BOB-36: rulings for the Project Status page

Toad, 2026-11-15. The design is ADR 0005 (`decisions/0005-project-status.md`); this is the yes and
the how for each item, for Peach's criteria and Luigi's build. Requirements:
`product/requirements/project-status.md` (537c7f7).

## BOB-37, the status read: yes

- One read, `status {project?, since}`, in `BOARD_READS`, derived on read, not an MCP tool. It
  covers every project the caller reads in one call; the Status tab calls once and slices per
  project. Shape: ADR 0005 §2.
- Needs you is `waitsOf(p)` itself, so its counts equal Waits and the Overview. Permission requests
  come from the snapshots, as on Waits.
- `since` is required from the dashboard and clamped to 31 days; the reply carries the Board's `at`,
  which "I'm caught up" stores (ADR 0005 §1).
- Every stuck kind has a settle rule (§2); "2 h" and "thin" are Peach's defaults, constants in the
  store.
- Cost: migration 3 adds indexes on `events (project, at)`, `runs (project, ended_at)` and
  `ci_runs (project, ended_at)`. Scale test: Helix-sized board plus a month of work, a week's span
  across every project, under 250 ms like the other reads in `board-scale.test.ts`.
- Lists are capped at 100 with a `more` count.

## BOB-38, run outcome: yes

- `run_end` gains optional `outcome` (`done`, `failed`, `stopped`, `lost`) and `reason` (≤ 300).
  `done` is the criterion's "finished". Old runs: null, read as unknown, never listed as stuck.
- `lost`: the supervisor's startup sweep sends a `run_end` for each worker it marks
  `failed: supervisor restarted`, tokens zero and counted as unknown, never as zero.
- Migration 3: `runs.outcome`, `runs.outcome_reason`.
- Deploys: not recorded, not shown (releases closed only). The later way in is a `ci_run` with
  source `deploy`; captured for triage.

## BOB-35, theme tags: yes

- A closed list of sixteen themes, `Theme` in the protocol, the same for every project (ADR 0005 §4).
  Peach may change it; adding a theme is additive.
- Set by whoever closes the session (`sessions` grant), at the close only: `close_session` gains
  optional `themes: [{task, theme}]` (each a blocker or major of the close) and `findings:
  [{theme, text}]` (retro closes only).
- Stored in `session_tasks.theme` and a new `session_findings` table (migration 4).
- Old closes show as **untagged**, never guessed.
- Broker first: `close_session` isn't strict, so an old broker would drop tags without a word.

## BOB-36, the lead's note: yes

- `lead_notes (pk, project, text ≤ 600, author, at)`, append-only, latest by `pk` wins.
- Written with `board_write` op `note {text}` (no new tool), allowed by a new grant flag `notes`
  (migration 5). Peach sets it on the lead's row (BobNet: Mario). Others get `forbidden`.
- Read only through `status`: `note: {text, author, at, newer} | null`; `newer` counts sessions
  closed, features Done and releases closed after it; the page marks it old when `newer` > 0.

## Rollout

1. BOB-33 broker deploy (migration 3, the read, the tab, the Overview line).
2. Supervisor release: `outcome` on `run_end`, the `lost` sweep.
3. BOB-35 broker deploy (migration 4), then the release with `close_session`'s `themes` and `findings`.
4. BOB-36 broker deploy (migration 5), Peach sets `notes` on Mario's row, then the release with
   `board_write`'s `note`.

Each deploy is Casper's to ask for. The export stays v1 with optional new fields; an old supervisor's
backup lacks them until it is upgraded.

## Last visit

Stays on the device (`localStorage`). I agree, with one change: store the broker's `at` from the
reply, not the device clock.

## For Daisy

What changes what she draws: lands are a count only; deploys aren't shown; a note is at most 600
characters and its old mark can say how many facts followed it; Recurring problems groups by the
sixteen themes plus `untagged`; usage shows `lost` runs as "tokens unknown", and live runs only from
the snapshot.
