# 10. Project status: catch up after hours away

**Who needs it:** Casper, on a phone, back after a night, a workday or a weekend, with agents having
run the whole time. Each project's lead and product owner, to see what the team's last stretch
looked like.

**State: Settled by Casper (2026-11-16), split into BOB-33, BOB-35 and BOB-36.** His words: he wants "an
update on the status of the project, any blockers/questions, progress, issues, retro problems
reocurring, any other challenges or upcoming backlog is weak or undefined". His picks: **Q-2** "tab";
**Q-3** "last_visit and yes the widen to 24 hours or a week are important, i like the 'im caught up'
button great idea"; **Q-4** "all six"; **Q-5** "good idea i like it" (the lead's note, now).

**What it is:** one page that answers two things, in this order: *do I need to do anything?* and *is it
going OK?* It looks back over a span ("since 23:10, 7h ago") and is computed from the board, never
typed in.

## How it differs from the Overview

The Overview ([2](roadmap-view.md), BOB-3 AC 7) is **now**: Needs you, Working now, Projects. This is
**since**: what changed while Casper was away. They share data and don't duplicate each other: the
Overview stays as it is and gains one line linking here ("since 23:10: 4 done, 1 stuck"). The
Needs-you section here reads the same waits as the Overview and the Waits tab ([4](waiting-on-casper.md)),
so the counts always agree. It is **its own Status tab** (Q-2): the all-projects digest on top, tap a
project for its page.

## Criteria (Casper's picks applied)

Built in three steps: **BOB-33** the tab with sections 1, 2, 3, 5 and 6 (everything the board already
records, plus run outcome), **BOB-35** the theme tags and section 4 Recurring problems, **BOB-36** the
lead's note. Criteria 1 to 5 and 7 are BOB-33's, 6 is BOB-36's, section 4 is BOB-35's. Sections are
numbered as Casper listed them.

1. **The span.** The page opens on "since <time of your last visit on this device>, <n> h ago", with
   chips to widen it: **24 h** and **a week**. The last visit is kept per device (in the browser) and
   moves only when Casper taps **"I'm caught up"**, never by opening or refreshing the page. After the
   tap the page reads "caught up" and the span restarts from that moment. First visit on a device:
   24 h. Widening is for this view only and does not move the marker. *Evidence: test (span, chips,
   marker moves only on the tap); screenshot on phone.* (Q-3)
2. **Phone first.** The top screen, without scrolling, says whether anything needs Casper (count,
   oldest) and whether it is going OK (done count, stuck count, red CI), then the sections. On a
   phone sections are folded to their headline and open on tap. *Evidence: screenshots on phone,
   tablet and desktop.*
3. **Per project, with a summary across projects.** The Status tab opens on one row per project
   (needs you, done, stuck); tapping a row opens that project's page. *Evidence: screenshot with two
   projects.* (Q-2)
4. **Sections.** Each shows its count in the headline and links every item to its record. All six are
   in the first version (Q-4):
   1. **Needs you:** open questions, actions, review gates, bugs and permission requests, oldest first,
      each with what it holds up and its age. Anything older than the span says so. (BOB-34 makes the
      list itself free of stale items; this section shows the same list.)
   2. **What got done:** a count line on top (features Done, sessions closed, lands, releases closed),
      then features moved to Done and sessions closed in the span with their one-line summaries.
   3. **What's stuck:** runs that failed or were stopped, lands and CI runs that failed, open sessions
      with no agent on them for more than 2 h, features In Progress with no open run, questions
      answered but still holding work up.
   4. **Recurring problems** (BOB-35): review blockers and majors grouped by theme, features sent
      back more than once, a retro finding that comes back (same theme in 2 or more sessions). Each
      group lists its sessions. Needs theme tags (below).
   5. **Backlog health:** Ready features with criteria written, and how many sessions of work that is
      ("3 Ready features, about 5 sessions"); features without criteria; backlog items in triage with
      the oldest age; a release with nothing Ready next. A project is flagged **thin** when it has
      fewer than 2 Ready features with criteria and the open release has more to do.
   6. **Usage:** tokens in the span by project and by agent, and sessions much heavier than their
      kind's usual, flagged. Tokens, never money.
   *Evidence: a test per section on a seeded board (an item that is in the span, one just outside it,
   one in another project); screenshot per section on phone.*
5. **Nothing here is typed in** (except the lead's note, 6). Every fact is derived on read from
   records; when its source says it is settled it leaves the page (a stuck run that was restarted, a
   question answered). *Evidence: test.*
6. **The lead's note** (BOB-36): a lead writes a short summary (about three sentences) at the end of a
   stretch of work, per project. The page shows the latest one, dated, above the facts, and marks it
   old when newer facts follow it. No note: nothing is shown, no empty box. Only a lead of that
   project writes it. *Evidence: test (latest wins, old mark, no note, who may write); screenshot.*
   (Q-5)
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
- **Themes for section 4** (BOB-35, **needs Toad**): a theme tag on each review blocker and major and
  on each retro finding, given when a session is closed (`close_session`). Today they are free text
  (`summary`, `handoff_text`). Toad decides the shape: a fixed list or free labels, where the tag is
  stored, and how existing sessions without tags are shown (as "untagged", never guessed).
- **The lead's note** (BOB-36, **needs Toad**): a small record per project (text, author, time), written
  by a lead, latest wins. Toad decides the record, the write tool and its rights.

## Must not break

- The Overview and the Waits tab keep their criteria ([2](roadmap-view.md), [4](waiting-on-casper.md)).
- The page reads only; Casper answering a question still happens on Waits.
- Usage is tokens, never dollars. The page has BobNet's own look and works on a phone.

## Open questions

Answered by Casper 2026-11-16 (Q-2 to Q-5, see State). Peach's defaults, which Casper may change: "no
agent for 2 h" is stuck; "thin" means fewer than 2 Ready features with criteria; first visit on a
device shows 24 h; the page is not in a release until Casper puts it in one (release scope is his).

For Toad: the shape of the status read, the run outcome, where deploys are recorded, the theme tags
and the lead-note record. For Daisy: the prototype, phone first, with the span chips, "I'm caught up",
the digest, the six sections and the note.
