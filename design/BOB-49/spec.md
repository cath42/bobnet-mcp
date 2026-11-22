# BOB-49 design A: how flagged items read on Waits on you and Needs you

**Small.** This changes how existing Waits rows read: one badge label, one meta line, one muted
line. There is no new section, no new interaction and no layout change, so there is no prototype.
Luigi builds from this file and the current `packages/broker/public/app.js` (`waitItem`, `waitLine`)
and `style.css`.

Row data is from Toad (consult, 2026-11-22). It is ruled in ADR 0011
(`architecture/decisions/0011-waits-never-stale.md`). If that ADR names a field differently, the
ADR wins and the strings below stay the same. All three fields are optional on `WaitRecord`, so an
older broker sends none of them and every row reads as it does today.

- `fix: { sha, subject, landed_at, release: string|null, tags_known: boolean } | null`: only on
  `kind: "bug"`. A bug whose fix landed comes with `blocking: false`.
- `stale: { changed_at, owner: string|null, flagged_at: string|null } | null`: set when the row has
  been unchanged for more than 24 h.
- `kept: { by, at, reason } | null`: the owner's latest "still current".

Usage, ages and names are formatted with the helpers already in `app.js`: `since()` / `waitAge()`
for ages, `askedBy()` / `shortName()` for names. The examples below show `since()` output as
"26h" and "2d 3h", whatever `duration()` prints today.

---

## (a) A bug whose fix landed

The bug stays on Waits until its PO moves it to Done or archives it, but it no longer needs Casper.
Because `blocking` is `false` it moves from **Holds work up** to **When you have time**, and it
leaves Needs you on the Overview (Needs you shows only blocking rows; the "N more when you have
time →" link counts it).

### Waits on you row

Before (in Holds work up, red left edge):

```
[bug · blocks use]  BOB-27   BobNet · BOB-12                 3h
Board reports stuck since 04:10
Blocks use · from Mario · Open in triage
```

After (in When you have time, grey left edge, as every non-blocking row):

```
[bug · fix landed]  BOB-27   BobNet · BOB-12                 3h
Board reports stuck since 04:10
Fix landed 5d4617f, in v2.0.0-rc.34 · waits on Peach to close it
from Mario · Open in triage
```

- **Badge.** Label `bug · fix landed`. Use a new state `fixed`:
  `.badge[data-state="fixed"] { color: var(--ok); }`, next to `.badge[data-state="bug"]` in
  `style.css`. In `WAIT_KIND` terms: when `w.fix` is set, use `["fixed", "bug · fix landed"]`
  instead of `["bug", "bug · blocks use"]`.
- **Fix line.** A new `div.fix` between `.q` and `.meta`, 13px and `var(--text)` (it is the news on
  the row, so it is not muted). Pick its text by the first case that applies:

  | Case | Text |
  |---|---|
  | `release` set | `Fix landed <sha7>, in <release>` |
  | `release` null, `tags_known` true | `Fix landed <sha7>, not in a release yet` |
  | `release` null, `tags_known` false | `Fix landed <sha7>` |

  Then ` · waits on <PO> to close it` follows in muted text. `<PO>` is `shortName` of the project's
  `po`, falling back to its `lead`. If the project has neither: ` · waits on its PO to close it`.

  - `<sha7>` is the first 7 characters of `sha`, in the monospace of `.top .id`. Its `title` is
    `subject`, so a hover shows the commit's first line.
  - `<release>` is the tag exactly as sent (`v2.0.0-rc.34`); it is not shortened.
  - The criterion's wording is "fix landed <sha>, in <release>". On the row it starts with a
    capital because it starts the line.
- **Meta.** The red `Blocks use` span goes, because `blocking` is false. `from <asker>` and
  `Open in triage` stay as they are. There is still no answer button, as today for bugs.
- **Age** (top right) stays `waitAge(w.since)`: how long the bug has been on Waits.

### Needs you (Overview)

Before:

```
[bug · blocks use]  Board reports stuck since 04:10
                    BobNet · BOB-12 · blocks use
```

After: no line. The bug is no longer blocking, so the Needs you card doesn't draw it. The link
under the card reads, for example, `1 holds work up · 1 more when you have time →`, which is today's
string with the bug counted in "more". If it was the only blocking row, the card reads
`Nothing is held up by you.` and the link reads `Waits on you →` as today.

The tab count (`waitCount`) still counts the row. It is on Casper's list, and its own line says who
it waits on. It leaves once the PO closes it, and the PO has been told.

---

## (b) An item unchanged for over a day

Any kind of row can be stale: a question, an action, a review gate or a bug. The flag goes to the
row's owner, never to Casper: the asker for a question or action, the PO (or the lead) for a review
gate or bug. On Casper's side the row only says that its owner has been asked to check it. That
tells him the list is being kept honest; he has nothing to do about it.

### Waits on you row

Before:

```
[question]  Q-14   BobNet · BOB-6                          2d 3h
Which laptop runs the Helix supervisor after the move?
Holds up Luigi (build A) · from Mario · Open BOB-6     [Answer]
```

After:

```
[question]  Q-14   BobNet · BOB-6                          2d 3h
Which laptop runs the Helix supervisor after the move?
Holds up Luigi (build A) · from Mario · Unchanged for 2d 3h, Mario asked to check it 40m ago · Open BOB-6     [Answer]
```

The new span is `span.stale` in `.meta`, placed after `from <asker>` and before the edits fold and
the link. Its colour is `var(--warn)`, with `.waits li .stale { color: var(--warn); }`. Its text is
the first case that applies:

| Case | Text |
|---|---|
| `owner` set, `flagged_at` set | `Unchanged for <since(changed_at)>, <Owner> asked to check it <since(flagged_at)> ago` |
| `owner` set, `flagged_at` null (the first hour) | `Unchanged for <since(changed_at)>, <Owner> is asked within the hour` |
| `owner` null | `Unchanged for <since(changed_at)>, nobody to ask` |

- `<Owner>` is `askedBy(owner)`, so an agent reads as its name ("Mario", "Peach").
- Both ages use `ago()` (`data-ago`), so they tick like every other age on the page.
- On a phone the meta wraps as it does today, and no other rule is needed.

**Kept.** When `stale` is null and `kept` is set, a muted span goes in the same place:

`Kept by <askedBy(kept.by)> <since(kept.at)> ago: “<kept.reason>”`

The reason is the owner's words exactly, in curly quotes as Waits quotes Casper's own words. It
wraps; it is never cut. When the row goes stale again, the stale span replaces it: one or the other,
never both.

A fix-landed bug (a) can also be stale. Then the stale span shows in `.meta` under the fix line,
and both read.

### Needs you (Overview)

Before:

```
[question]  Which laptop runs the Helix supervisor after the move?
            BobNet · BOB-6 · holds up Luigi (build A)
```

After:

```
[question]  Which laptop runs the Helix supervisor after the move?
            BobNet · BOB-6 · holds up Luigi (build A) · unchanged 2d 3h
```

The meta gets ` · unchanged <since(changed_at)>`, lower case, in the line's own meta colour. The
detail of who was asked stays on Waits on you, because a Needs you line is one line. There is
nothing for kept here.

### Withdrawn

When the asker withdraws a question or action (`withdraw`), it leaves Waits on the next
`board_changed`, as an answered row does today. There is one case to handle. If Casper has that
row's answer form open, the form closes and a toast says:

`<ref> was withdrawn by <Asker>; it no longer waits on you.`

If the form had a draft in it, the toast adds ` Your draft: “<first 80 chars>…”` so his words
aren't lost silently. The reason for withdrawing isn't on the waits row; see Open questions.

---

## (c) A lead's board_ask question on Needs you

**No change.** Toad confirmed that a lead's `board_ask` with `holds_sessions` is an ordinary
`kind: "question"` wait with `asked_by` set to the lead and `blocking: true`. Today's code already
draws it like this:

- **Needs you:** `[question]  <text>` / `<Project> · <feature> · holds up <who> (<session>)` with
  `Answer`. This is `waitLine` → `heldNames`, which names the agents in the held session.
- **Waits on you:** in Holds work up, with `from <Lead>` in the meta.

There is no "turn ended waiting" signal to render; the fix is a rule in the leads' prompts (Toad,
Luigi). The AC 3 evidence is a real lead question seen on the live dashboard. Use the strings above
to check it.

---

## The three sizes

None of this changes the layout. Every addition is a span or a div in an existing grid or flex row
that already wraps:

- **390px.** The `.fix` line wraps after the release if it has to. The stale span wraps inside
  `.meta`. The Needs you meta is already allowed two lines.
- **1024px and 1440px.** Each addition fits on its line.

## Open questions

- **For Toad: why a question was withdrawn.** The waits op drops a withdrawn row, so the dashboard
  can't say why it was withdrawn. If `board_changed`, or the `answered` list's equivalent, carried
  `{ ref, withdrawn_by, reason }`, the toast could quote the reason. This isn't needed for BOB-49.
