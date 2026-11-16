# 10. Project status: catch up after hours away

**Who needs it:** Casper, on a phone, back after a night, a workday or a weekend, with agents having
run the whole time. Each project's lead and product owner, to see what the team's last stretch
looked like.

**State: Draft** (BOB-33). Casper's words (2026-11-16, brainstorming): he wants "an update on the
status of the project, any blockers/questions, progress, issues, retro problems reocurring, any other
challenges or upcoming backlog is weak or undefined". The sections and the options below are
proposals to react to, not rulings; his picks are Q-2 to Q-5 (see Open questions).

**What it is:** one page that answers two things, in this order: *do I need to do anything?* and *is it
going OK?* It looks back over a span ("since 23:10, 7h ago") and is computed from the board, never
typed in.

## How it differs from the Overview

The Overview ([2](roadmap-view.md), BOB-3 AC 7) is **now**: Needs you, Working now, Projects. This is
**since**: what changed while Casper was away. They share data and don't duplicate each other: the
Overview stays as it is and gains one line linking here ("since 23:10: 4 done, 1 stuck"). The
Needs-you section here reads the same waits as the Overview and the Waits tab ([4](waiting-on-casper.md)),
so the counts always agree. Q-2 asks whether this is its own tab (proposed) or folded into the
Overview.

## Criteria (proposed)

1. **The span.** The page opens on "since <time of your last visit on this device>, <n> h ago", with
   chips to widen it (24 h, a week). The last visit is kept per device and moves only when Casper
   taps "I'm caught up", never by opening or refreshing the page. First visit on a device: 24 h.
   *Evidence: test (span, chips, marker moves only on the tap); screenshot on phone.* (Q-3)
2. **Phone first.** The top screen, without scrolling, says whether anything needs Casper (count,
   oldest) and whether it is going OK (done count, stuck count, red CI), then the sections. On a
   phone sections are folded to their headline and open on tap. *Evidence: screenshots on phone,
   tablet and desktop.*
3. **Per project, with a summary across projects.** The all-projects digest shows one row per project
   (needs you, done, stuck) and opens that project's page. *Evidence: screenshot with two projects.*
4. **Sections.** Each shows its count in the headline and links every item to its record. Proposed
   first version (Q-4):
   1. **Needs you:** open questions, actions, review gates, bugs and permission requests, oldest first,
      each with what it holds up and its age. Anything older than the span says so. (BOB-34 makes the
      list itself free of stale items; this section shows the same list.)
   2. **What got done:** a count line on top (features Done, sessions closed, lands, releases closed),
      then features moved to Done and sessions closed in the span with their one-line summaries.
   3. **What's stuck:** runs that failed or were stopped, lands and CI runs that failed, open sessions
      with no agent on them for more than 2 h, features In Progress with no open run, questions
      answered but still holding work up.
   4. **Backlog health:** Ready features with criteria written, and how many sessions of work that is
      ("3 Ready features, about 5 sessions"); features without criteria; backlog items in triage with
      the oldest age; a release with nothing Ready next. A project is flagged **thin** when it has
      fewer than 2 Ready features with criteria and the open release has more to do.
   5. **Usage:** tokens in the span by project and by agent, and sessions much heavier than their
      kind's usual, flagged. Tokens, never money.
   6. **Recurring problems** (later, Q-4): review blockers and majors grouped by theme, features sent
      back more than once, a retro finding that comes back. Needs new data (see below).
   *Evidence: a test per section on a seeded board (an item that is in the span, one just outside it,
   one in another project); screenshot per section on phone.*
5. **Nothing here is typed in.** Every fact is derived on read from records; when its source says it is
   settled it leaves the page (a stuck run that was restarted, a question answered). *Evidence: test.*
6. **Optional note at the top.** A lead may leave a three-sentence summary at the end of a stretch of
   work; the page shows the latest above the facts, dated, and marks it old when newer facts follow.
   Only if Casper wants it (Q-5). *Evidence: test; screenshot.*
7. **Fast on a Helix-sized board** (29 features, ~700 tasks): one read, not one per project.
   *Evidence: scale test next to `board-scale.test.ts`.*

## What exists, what is new

From the board and the supervisor today (checked 2026-11-16 in `packages/broker/src/board/schema.ts`
and `packages/protocol/src/board.ts`):

| Needed for | Already recorded |
|---|---|
| Needs you | `waits` read (questions, actions, review gates, bugs, `since`, what each holds); the read already takes a `since` |
| Done, lands | Board events (every write: who, when, old and new, so "moved to Done at 02:10"); sessions with `ended_at`, `summary`, `need`, `commit_sha`; `pushes` (a land: sha, worker, time); releases `closed_at` |
| Stuck: failed CI, failed lands | `ci_runs` (source, status, worker, session), run-slot runs included |
| Stuck: no agent on it | Open sessions (`ended_at` null), `runs` (started, ended, session), `open_since`, item status |
| Backlog health | Item status, criteria counts, backlog counts and ages (the overview read has them) |
| Usage | `runs` tokens (input, output, cache), calls, agent, session, project |
| Recurring (partly) | `session_tasks` roles (blocker, major, sent_back): *counts*, not themes |

**New, would need building:**

- **A "status" read** over a span, derived on read like `waits` and `overview` (one read for every
  project). Toad shapes it.
- **How a run ended.** A failed or stopped worker is in the supervisor's live state, but the board's
  `runs` carry no outcome. A run end would report it (additive).
- **Deploys.** Nothing records a broker deploy; "releases and deploys" needs a record, or the page
  shows releases closed only.
- **Last visit per device:** kept in the browser; no broker change. (Per device key, ADR 0004 / BOB-25,
  if Casper wants it to follow him across devices.)
- **Themes for section 6:** a theme tag on a review's blockers and majors and on retro findings at
  session close. Today they are free text (`summary`, `handoff_text`). Only if section 6 is in the
  first version.
- **The lead's note** (criterion 6): a small record per project, if wanted.

## Must not break

- The Overview and the Waits tab keep their criteria ([2](roadmap-view.md), [4](waiting-on-casper.md)).
- The page reads only; Casper answering a question still happens on Waits.
- Usage is tokens, never dollars. The page has BobNet's own look and works on a phone.

## Open questions

For Casper (asked 2026-11-16, linked to BOB-33):

- **Q-2, where:** its own Status tab (proposed), folded into the Overview, or per project only.
- **Q-3, "since":** last visit per device with chips (proposed), fixed spans, or last visit only.
- **Q-4, which sections first:** 1 to 3, 5 and 6 first with Recurring as its own feature (proposed),
  all six, or the smallest three.
- **Q-5, the written note:** computed facts only for now (proposed), or the lead's note now.

Peach's defaults, which Casper may change: "no agent for 2 h" is stuck; "thin" means fewer than 2
Ready features with criteria; first visit on a device shows 24 h; the page is not in a release until
Casper puts it in one (release scope is his).

For Toad: the shape of the status read, the run outcome, and where deploys are recorded. For Daisy,
after Casper answers: the prototype, phone first.
