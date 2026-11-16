# BOB-33: the Status tab, spec

Daisy, 2026-11-15. Luigi builds from this file and the prototype. Requirements: `product/requirements/project-status.md`;
tasks BOB-37 (status read), BOB-38 (run outcome), BOB-39 (the tab), BOB-40 (the Overview line). Data: ADR 0005 §1 to §3,
with the additions Toad agreed for this spec (below, "What the read gains"). Casper accepted the prototype's 12 choices
(`notes.md`, 2026-11-15).

- **Prototype:** `design/BOB-33/prototype/index.html` (works from `file://`). It uses `packages/broker/public/style.css` as
  is plus `prototype/proto.css`; those rules use only style.css's tokens and move into style.css as one block,
  "Status: catch up after hours away". `.proto-bar`, `.proto-only` and the prototype's toast for links ("In the build,
  this opens …") are the prototype's own: don't build them.
- **The prototype bar's "Ships" switch:** *BOB-33 only* is what you build now. *With BOB-35, 36* shows what comes later.
- **Shots:** `shots/<shot>-<width>.png` at 390, 1024 and 1440. Retake with `node design/BOB-33/shots/take.mjs`.

## What is BOB-33's, and what isn't

| Part | Ticket | In this build |
|---|---|---|
| The span, chips, I'm caught up, Undo, the dot on the tab | BOB-39 | yes |
| The two answers, project cards, Needs you on All projects | BOB-39 | yes |
| Project page: Needs you, What got done, What's stuck, Backlog health, Usage | BOB-39 (read: BOB-37, BOB-38) | yes |
| Project page: **Recurring problems** | section in BOB-39, content BOB-35 | **the section shows, folded content says "Comes with theme tags"** (below) |
| The Overview's one line | BOB-40 | yes |
| **The lead's note** (on the project page, the start of it on the card, its old mark) | BOB-36 | **no**: nothing drawn, no empty box |
| Recurring's groups, "came back", sent back twice, the card's "N came back" flag | BOB-35 | **no** |

Build it so BOB-35 and BOB-36 only fill in: `row.recurring` and `row.note` are null until they ship, and the page draws
from null exactly as *BOB-33 only* does (`s8-bob33-only`). When they turn non-null the drawn parts appear with no other
change. Their drawing is in this file under "Later: BOB-35" and "Later: BOB-36" so the CSS block can carry it, but no
code for them is needed now.

## What the read gains (Toad, consult c_f1c4cbc5; Toad records it in ADR 0005 §2)

All additive to §2's `StatusRow`, no schema change:

- `stuck.settled: [{ kind, ref | session, settled_at }]`: items that were stuck and settled, both inside the span. Capped
  100 + `more`. A kind with no stored time it settled isn't listed.
- `usage.by_agent[].lost`: that agent's runs in `lost`. The row total stays.
- `done.sessions[]`: `tokens: TokenTotals`, `counts: { blockers, majors, sent_back }`. The kind is in the SessionRef.
- `done.features[]`: `type` (a `bug` shows "bug fixed").
- `backlog.release.ready`: Ready features of the open release. **Flag when it is 0** ("R2 has nothing Ready"). The
  prototype's flag on the *next* release (`nextEmpty`) is dropped.
- `backlog.triage.oldest: { ref, at } | null`.

## Routes and reads

- Routes: `#status` (All projects), `#status/needs` (All projects, scrolled to its Needs you), `#status/<project>`,
  `#status/<project>/<section>` (that section open and scrolled to; sections: `needs done stuck recurring backlog usage`).
- **Status is the third tab**, after Waits on you (choice 1).
- **One read for the whole tab:** `status { since }`, no `project`. A project page is a slice of the same reply; tapping
  a card doesn't read again (ADR 0005 §2).
- `since` is: the chip's choice (now − 24 h, now − 7 d, measured from the last reply's `at`, else the device clock), else
  this device's marker, else (first visit) now − 24 h.
- **Refetch:** on `board_changed` for any project, at most once per 5 s, only while Status or Overview is showing; else on
  the 60 s tick (for the dot). Never a spinner on a refetch: the page keeps what it shows and swaps in place. Sections a
  person opened or folded stay so (kept per project and section in `sessionStorage`, `bobnet.status.open`).
- **Permission requests** come from the laptops' snapshots and are added to Needs you, as on Waits on you (`humanPerms()`);
  they count as holding work up. **Running now** comes from the snapshots (`running()`), never from the read.

## The marker (choice 5, ADR 0005 §1)

- `localStorage` `bobnet.status.lastVisit`: an ISO time, **the broker's** `at` from the reply on screen when Casper tapped
  I'm caught up. One per device, for every project.
- It moves only on **I'm caught up**. Opening, refreshing, a chip, a project page: never.
- I'm caught up stores the reply's `at`, sets the span back to "since your last visit", scrolls to the top and shows the
  toast "Caught up at 06:12. This device's next visit starts from here." with **Undo** (puts the old marker and chip back)
  and ×. The toast stays until closed or the next tab change.
- I'm caught up is only on All projects: in the span bar on tablet and desktop; on a phone (≤760 px) at the end of the
  page, full width, 48 px, with "Next time, this page starts at 06:12." under it. A project page's foot says
  "I'm caught up is on All projects: this device keeps one last visit for every project."

## All projects (`s1-status`, `s1-status-top`)

Top to bottom:

1. **Span bar.** Bold head and a muted line under it:
   - marker set, span = visit: **Since your last visit** / "23:10, 7 h ago" (`clock()` and `age()` in proto.js: same day
     "23:10", yesterday "Sun 23:10", this week "Fri 23:10", older "Mon 9 Nov"; ages non-breaking: "7 h", "2 h 15 min"
     under 3 h, "3 d").
   - chips: a segmented control **Since 23:10 · 24 h · A week**, the current one pressed. The first chip is absent on a
     first visit. Widened, a muted line: "Widened. Your last visit stays at 23:10."; at visit: "Opening this page doesn't
     move it; only I'm caught up does."
   - first visit (`s6-first-visit`): **The last 24 hours** / "since Sun 06:12", the 24 h chip pressed, and "First visit
     on this device, so the last 24 hours. From now on it starts at your last “I'm caught up”."
   - just caught up (`s5-caught-up`): "06:12, just now"; the chip reads "Since now"; the page has nothing in the span.
2. **The two answers** (choice 2), side by side at every width, each a link:
   - **Needs you**: the count (or "Nothing"), "N hold work up · oldest 3 d" (or "Nothing waits on you"). Left border and
     number: `--bad` when anything holds work up, `--warn` when something waits, `--ok` when nothing. Goes to `#status/needs`.
   - **Is it going OK?**: **Going OK** (`--ok`, nothing stuck), **Mostly OK** (`--warn`, stuck but nothing failed),
     **Needs a look** (`--bad`, a run failed or CI or a land failed). Under it: "CI red on Helix · 4 stuck · 11 done",
     leaving out what is zero except done. On All projects it scrolls to the project cards.
3. **Projects**, with a count: one card per StatusRow, in the reply's order (the overview's). A card is a link to
   `#status/<project>`: name, the verdict badge (`running`/`waiting`/`failed` badge colours), ›; four stats **Needs you,
   Done, Stuck, Tokens** (Done = sessions closed, sub "2 features" when any; Tokens sub "+ 1 unknown" when `lost`); then
   flags: a `failed` badge per failed stuck item, "backlog thin", "R2 has nothing Ready". Cards fill columns of at least
   300 px (`repeat(auto-fit, minmax(300px, 1fr))`): one on a phone, more as the width allows.
   - A project on the old board (no StatusRow: its board isn't on the service yet) gets a muted card: its name and
     "Its board is still on Backlog.md; Status starts when it moves to BobNet." No stats, not a link. Use the Overview's
     list of laptop-reported boards to find them (`projects()` minus the reply's keys), as `legacyRow` does.
4. **Needs you**, with a count: every wait of every project, oldest first, the Overview's line (`waitLine`,
   `permissionLine`) with the project name in its meta line. A wait whose `since` is before the span's `since` adds
   "from before 23:10". A line opens Waits on you at that item (choice 12); the section ends with "Answer them on Waits
   on you →". Nothing: "Nothing waits on you."
5. On a phone, the I'm caught up foot.

## A project's page (`s2-helix`, `s2-helix-open`, `s3-bobnet`)

1. "‹ All projects", the name and "lead Mario · PO Peach" (from the overview's project record; leave out what isn't known).
2. The span bar without I'm caught up.
3. The two answers for that project; "Is it going OK?" goes to `#status/<project>/stuck`.
4. **Sections** (choice 4, 7), each a `<details>` card: the summary line holds the title, its count (coloured by tone),
   the scope ("since 23:10", "open now", "now") and a one-line headline. Closed below 700 px, except the one the route
   names; open from 700 px; two columns from 1100 px (CSS columns, no section split across them).

| Section | Count | Scope | Headline |
|---|---|---|---|
| Needs you | waits + permissions | open now | "2 hold work up · oldest 3 d" / "Nothing waits on you" |
| What got done | sessions closed | since 23:10 | "2 features Done · 9 sessions closed · 6 lands · 1 release closed", zeros left out except sessions / "Nothing closed since 23:10" |
| What's stuck | items | open now | the items' labels joined: "CI red · Land failed · Nobody on it" / "Nothing stuck" |
| Recurring problems | "–" (BOB-33) | none (BOB-33) | "Comes with theme tags (BOB-35)" |
| Backlog health | "thin" or "OK" | now | "1 Ready feature with criteria, about 2 sessions · 20 in triage" |
| Usage | tokens, `tok()` ("1.4M") | since 23:10 | "1.4M tokens · 1 run's tokens unknown · 1 heavy session" |

Every ref in a section is a link to its record: a feature or task to `#feature/<project>/<ref>`, a session to the
Sessions tab at it, a release to the Roadmap at it, a wait to Waits on you. (The prototype's links only toast.)

### Needs you
The All projects lines for this project, without the project name. "Answer on Waits on you →".

### What got done (choice 3)
- **Moved to Done**: releases closed (`done` badge "release") then features (`done` badge "Done", or `bug` "bug fixed"),
  each ref, title, time. Only when there are any.
- **Sessions closed**, newest first: kind (the `--k-<kind>` colour), ref, label, closed by; a line "needs you" /
  "waited on an answer" / "need none", the counts "1 blocker, 2 majors, 1 sent back" and "340k tokens" (in `--warn` when it
  is in `usage.heavy`); the summary (two lines, clamped); the time. Five show; "Show all 9 sessions" opens the rest in place.
- **Lands are a count only** in the headline. **No deploys** anywhere (ADR 0005 §7).
- Nothing: "Nothing closed or landed since 23:10."

### What's stuck (choice 8)
Bad first, then newest. Each: a badge, the ref and a line of what, a muted line of detail, "since 05:31" and, when before
the span, "before 23:10".

| From | Badge | Tone | What | Detail |
|---|---|---|---|---|
| `runs`, outcome `failed` | Run failed | bad | "<agent>'s run on <session> failed" | `reason` |
| `runs`, `stopped` | Run stopped | warn | "<agent>'s run on <session> was stopped" | `reason` |
| `runs`, `lost` | Run lost | warn | "<agent>'s run on <session> was lost" | "Running when the supervisor restarted; nobody has started it again." |
| `ci`, a run-slot land | Land failed | bad | "<worker>'s land failed" | name, branch, sha (linked to `url`) |
| `ci`, other | CI red | bad | "<name> failed on <branch>" | worker, sha (linked to `url`) |
| `idle_sessions` | Nobody on it | warn | "<session> is open with no agent for 4 h 42 min" | |
| `idle_features` | No run | warn | "<ref> is In Progress with no open run for 25 h" | the title |
| `answered_holding` | Answered, still holding | warn | "<Q-ref> was answered 3 h ago; nothing has started on <feature>" | |

Under the list, folded: **"Settled since 23:10: 2"**, opening to `settled` rows (a `done` badge "settled", what it was, the
time it settled). Nothing stuck: "Nothing stuck." in `--ok`; the settled fold still shows when there are any.

### Recurring problems (BOB-33: the section, empty)
Count "–", no scope, headline **"Comes with theme tags (BOB-35)"**, body: "Review findings get a theme when their session
closes, from BOB-35 on. Until then this section has nothing to group." It shows, folded or open like the others (Casper,
2026-11-15: it stays visible).

### Backlog health
`thin` → a `--warn` line first: "Thin: fewer than 2 Ready features with criteria, and R1 has 3 more to do." Then rows:
**Ready, with criteria** (n features, "about n sessions of work" when `sessions_estimate` isn't null; refs with their
criteria counts); **No criteria yet** (refs and titles, or "None"); **In triage** ("20 items, the oldest 2 d, BOB-11");
**Open release** (ref, "3 features to do"; `--warn` and "nothing Ready" when `release.ready` is 0). No open release: the
row says "No open release".

### Usage (choice 10)
- One row per agent, heaviest first: name and role, a bar to the heaviest, the total; "+ 1 run unknown" in `--warn` under
  it when `lost` > 0 (an agent with only lost runs shows "1 run unknown" and no bar).
- With `lost`: "1 run's tokens unknown: it was running when the supervisor restarted, so its use was never reported. Not
  counted as zero."
- **Heavier than usual**: `waiting` badge "2.6×", ref, label, agent, "340k tokens, a build's usual is 130k", time.
- **Running now**, from the snapshots, for this project: a dot, name and role, "120k so far"; "From the laptops. Counted
  above when each run ends." Never in the total.
- No runs ended: "No runs ended since 23:10." Tokens only, never money.

## The Overview's line (BOB-40, `s7-overview-line`)

Above Needs you, a full-width banner link to `#status`: "**Since 23:10** (7 h ago): 11 done, 4 stuck, CI red on Helix
· Status ›", left border by the same verdict tone. Done and stuck are the same numbers as the Status tab's answers (the same
read, the same since). First visit: "Since Sun 06:12". While the read is loading the line isn't drawn (no jump: it appears
above everything once); on a read error it isn't drawn. Nothing else on the Overview changes.

## The dot on the tab (choice 1)

The Status tab shows an accent dot when, for this device's marker, the reply has any session closed, feature Done,
release closed or stuck item. Computed from a read with `since` = the marker (or now − 24 h), even when a chip is pressed;
the Overview's line uses the same read. No dot right after I'm caught up.

## States

| State | What shows |
|---|---|
| **First load** (no reply yet) | The span bar (it needs no read); the two answers with "…" in place of the number and "Reading the board…" as the sub; under them an `empty-card` "Reading the board…". A project page the same, without sections. No skeletons. |
| **Refetch** | Nothing changes until the reply; then it swaps in place. Open sections stay open. |
| **Read error, nothing shown yet** | `banner down`: **Board unavailable** and the error's message ("Not connected; try again in a moment."). The span bar stays. It reads again on the next `board_changed`, reconnect or tick. |
| **Read error after a reply** | `banner down`: **Board unavailable** "Showing what it said at 06:04." (the last reply's `at`), then the last reply as it was. |
| **Broker down** (`conn` offline) | `banner down`: "Can't reach the broker since 06:04. This is what this device read then; I'm caught up still works." I'm caught up stores the last reply's `at`: he is caught up on what he saw. |
| **No project readable** (empty `projects`, no old boards) | `empty-card` "No project's board on BobNet yet." |
| **Unknown project** in the route | "No project helix on BobNet, or you can't read its board." and "‹ All projects". |
| **Old board** (no StatusRow) | its muted card on All projects; its route says "Its board is still on Backlog.md; Status starts when it moves to BobNet." |
| **Span clamped** (reply `since` later than asked: a marker over 31 days old) | the span bar's muted line: "Your last visit was 40 days ago; this shows the last 31 days." |
| **Quiet** (nothing in the span) | each section's empty line (above); the answers read **Nothing** / **Going OK** (`s5-caught-up`). |
| **Runs before BOB-38's release** (outcome null) | never listed as stuck; nothing on the page says so. |

### A list past 100 (`more`)

Every list in the reply stops at 100 with `more` beside it.

- **Counts and headlines use the whole number**, `length + more`: "112 sessions closed", the card's Done, the Overview
  line. The two answers likewise.
- Under a cut list, a muted line: "and 12 more, older. The board lists the newest 100." with a link where one exists:
  sessions → "on Sessions", features Done → "on the Roadmap", waits → "on Waits on you", backlog no-criteria / ready →
  "on Triage" or "on the Roadmap". Stuck, settled and heavy: the line without a link.
- Waits are oldest first, so their cut drops the newest: the line reads "and 12 more, newer."
- A week of Helix is about 100 session summaries, so a widened page can reach this; "Show all N sessions" opens the 100
  it has, then the line.

## Breakpoints (choice 7)

| Width | Layout | Shots |
|---|---|---|
| ≤ 699 px | Sections folded to their headline; the lead's note (BOB-36) folds to 5 lines. | 390 |
| ≤ 760 px | Span bar: the head on its own line, the chips full width (40 px tall), I'm caught up at the end of the page; the stats four across. | 390 |
| 700 px and up | Sections open. | 1024 |
| 1100 px and up | Sections in two columns. `main.wide` up to 1320 px. | 1440 |

Touch targets on a phone are at least 40 px (chips, summaries) and 48 px (I'm caught up). Dark mode from style.css's
tokens only (`-dark` shots).

## Which shot shows what

| Shot | Shows |
|---|---|
| `s1-status-top` | the phone's first screen without scrolling: span, both answers, first card (BOB-39 c2) |
| `s1-status`, `-dark` | All projects whole: answers, two project cards, Needs you, the phone's I'm caught up (c1, c3) |
| `s2-helix`, `-dark` | Helix's page, sections folded on a phone, open in two columns at 1440 (c3) |
| `s2-helix-open` | the phone with every section open: Done's sessions, Stuck with settled, Backlog, Usage with a lost run and Running now |
| `s3-bobnet` | BobNet's page: bug fixed, release closed, backlog thin, an old lead's note (the note is BOB-36) |
| `s4-week` | widened to a week: "Widened. Your last visit stays at 23:10.", longer lists, "Show all" |
| `s5-caught-up` | just after I'm caught up: the toast with Undo, quiet sections |
| `s6-first-visit` | first visit on the device: the last 24 hours (c1) |
| `s7-overview-line` | the Overview with its one line (BOB-40) |
| `s8-bob33-only` | **what this build looks like**: no note, Recurring "Comes with theme tags" |

`s1` to `s7` are drawn with BOB-35 and BOB-36 shipped; for this build, read them with `s8`: no lead's note on cards or
pages, no "came back" flag, Recurring as in `s8`. Loading, errors and a cut list have no shot: build them from the table.

## Later: BOB-35 (Recurring problems)

When `row.recurring` isn't null: count = themes that came back + features sent back; scope "since 23:10 · repeats: 30
days"; headline "2 came back · 6 findings · 3 themes · 2 untagged". Body: **Blockers, majors and retro findings, by theme**
(a theme pill; "N findings in N sessions"; "came back: 3 sessions in 30 days" for `repeated`; the findings, each "<ref>
<label>, blocker: text · 4 h"; `untagged` last, muted, "Closed without a theme; never guessed."), then **Sent back twice
or more** ("3×", ref, title, its sessions). The card gains a `waiting` badge "2 came back". See the prototype with "Ships:
with BOB-35, 36" and `s2-helix`, `s4-week`.

## Later: BOB-36 (the lead's note)

When `row.note` isn't null: on the project page a card above the answers, "<author>'s note", role, "05:40, 32 min ago",
the text (up to 600 characters, line breaks kept); when `newer` > 0 it turns `--warn` and adds "4 things since: 4 sessions
closed" (from the counts the read gives). On a phone (≤699 px) a note over about 280 characters folds to five lines with
Show all / Show less. The card shows the note's start, two lines, with the author and time. No note: nothing. See `s3-bobnet`.

## Open questions

- Peach: the board's "next release" flag is gone (only the open release is flagged); the criterion 4.5 wording "a release
  with nothing Ready next" now means the open release. If Peach wants the next one too, it is a read change for Toad.
- Luigi: the Land failed / CI red split needs a way to tell a run-slot land from another CI run (its `source` or `name`);
  if `ci_runs` can't tell, show all as **CI red** with the name.
