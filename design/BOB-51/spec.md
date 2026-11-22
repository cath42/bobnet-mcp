# BOB-51 design A: a permission shown whole, decided permissions on Waits, a note sent with Allow

**More than small → prototype.** AC2 and AC3 are wording and a row in existing patterns. AC1 is
not: a question's options and headers are a new block (`.ask`) that shows in three places, and the
agent detail row gains a Show all it hasn't had. Prototype: `design/BOB-51/prototype/` (self-contained,
its own copy of `style.css`, deployable as is; open `index.html` from `file://` too). Shots: `shots/`
at 390, 1024 and 1440 (`node design/BOB-51/shots/take.mjs`).

Daisy, 2026-11-22. Covers BOB-51 AC1-3 (tasks BOB-32, BOB-29). Luigi builds from this file, the
prototype (`proto.js` draws each piece the way `app.js` should; `proto.css` rules move into
`style.css`, using only its tokens) and `packages/broker/public/app.js` (`permText`, `permissionLine`,
`permItem`, `permissionForm`, `agentDetail`, `answeredItem`, `viewWaits`).

## Data (Toad, consult c_360a0445, 2026-11-22)

Ruled in `architecture/decisions/0013-requests-whole-notes-delivered.md` (§1-§3) and
`architecture/bob51/build-brief.md` task 7; if names differ there, Toad's files win and the screens
below stay the same.

- `pending[i].preview` stays (≤400, cut with "…"). New optional **`ask`**:
  `{ text, cut, questions: [{ question, header, multi, options: [{ label, description }] }] }`.
  `text`: the whole command / path / URL / first question (≤8000). `questions`: AskUserQuestion only,
  ≤4, else `[]`. `cut`: the supervisor clipped some field (that field ends in "…").
- `ask` **absent** (older supervisor) or **null** (looks like a credential, or over the size budget):
  show `preview` exactly as today. No new state for it.
- A worker's AskUserQuestion is always tier `orchestrator`, so it **never shows on Needs you or Waits**:
  its home is the agent's detail row (Overview › On it now, a session card). Human-tier requests are
  approvals (a long Bash command is the case that matters there).
- Options are **read-only** in BOB-51: the answer op takes only allow|deny. Answering a question by
  picking an option is a follow-up Toad suggests to Peach.
- Snapshot gains optional **`decided`**: only requests decided **from the dashboard**, 24 h, newest
  first, ≤50: `{ id, worker_id, name, project, kind, tool, created_at, decided_at, decision, preview, note }`.
  The dashboard keeps `decided_at >= midnight()`, as for board answers.
- Allow with a note: delivered as the agent's next turn, `Casper's note with his Allow of <tool> (<id>): <words>`.
  The action result gains optional `note_delivered` (true / false); absent = an older supervisor dropped it.

---

## 1. A permission shown whole (AC1)

### The ask block (`askBlock(p, open)`), one function for all three places

**An approval** (Bash, Edit, WebFetch, …): `ask.text` in a `code.preview` block (monospace, `pre-wrap`,
line breaks kept).

**A question** (AskUserQuestion), for each of its questions in order:

1. The **header** (`ask.questions[i].header`, e.g. "Map key"): small caps label, muted, 11.5 px, as
   `.whole .rec b`. When there are 2+ questions, prefix it with its number: "1 · Map key".
2. The **question**, text colour, 14 px, weight 600, `white-space: pre-line`.
3. **"Pick one"** or **"Pick any"** (`multi`), muted 12 px, after the question.
4. The **options**, a list (`ul.opts`): each a row with a 3 px `--line` left border, padding 4px 10px;
   the **label** in text colour 14 px, the **description** under it, muted 13 px, `pre-line`. No radio,
   no checkbox, not clickable: they are what was asked, not a form.

Between two questions: 10 px and a 1 px `--line` rule.

**Cut** (`ask.cut`): one muted line under the block, 12.5 px: **"Cut at the laptop: too long to send
whole."** Nothing else (Casper has no request_detail).

**Fallback** (`ask` absent or null): `code.preview` with `p.preview`, as today. A `[hidden: …]`
preview reads as it does today.

### a. Agent detail row (On it now, a session card): where a question lives

Today: `Howard wants AskUserQuestion: <first 80 characters>`. New, in the `.a-detail` box, between the
spawned line and the actions:

- A line, 13 px: **`Howard asks`** (a question) or **`Howard wants Bash`** (an approval), then muted
  ` · <age>` (`since(p.created_at)`), then ` · the orchestrator answers` (tier orchestrator: who decides
  it, so Casper knows his Allow/Deny there overrides it).
- The ask block, **folded**: a question shows only its first question's text, clamped to 3 lines
  (2 on a phone ≤520 px), no options; an approval shows the code clamped to 3 lines.
- **Show all** (`button.more-t`), under it, left-aligned, when there is more: the text is measured as
  cut (as `measureNeeds`), **or** the question has options or a second question (always, for a real
  AskUserQuestion). It opens the whole block: every question, header, Pick one/any, every option with
  its description. It then reads **Show less**. On a phone it is 44 px tall.
- Open/closed is kept in `state.whole` (sessionStorage) under `permId(p)`, as Needs you's lines are,
  so a live redraw doesn't fold it. The detail row being closed and opened again keeps it open.
- The Allow / Deny buttons stay as they are (no note here; the note belongs to the form on Waits).

### b. Needs you line (Overview), a human-tier approval

- The line's text: `Howard wants Bash: ` then the command (`ask.text`, else `preview`) in a `code`
  span (monospace 13 px, normal weight), on the same one line (two on a phone), cut with "…". It is
  cut nearly always, so Show all shows, as BOB-31 measures.
- **Open**: the `code` becomes a block (`display:block; white-space:pre-wrap`), the whole command,
  then the cut line if `ask.cut`. Show less folds it.
- A human-tier question (none today, but the router could send one): `Howard asks: <first question>`,
  and open adds the rest of the ask block (options etc.) in `.whole`.

### c. Waits on you, a permission item

- `.q` stays `Howard wants Bash` (bold). **Under it, always, the ask block, whole** (Waits shows things
  whole, BOB-31): the command in `code.preview`. A command over 12 lines is clamped to 12 with **Show
  all** under it (`more-t`, state.whole id `perm/…`); under that, everything.
- The form no longer repeats the preview (it is right above). The Allow confirm keeps `p.preview`
  (≤400) so the dialog stays short.

## 2. "Answered from here today" for permissions (AC2)

The existing section takes the laptops' `decided` rows (today's, by `decided_at >= midnight()`, every
laptop including a stale one, de-duplicated on `laptop/id`) together with the board's answers, **newest
first** by `decided_at` / `at`. The section's count counts both. The project filter applies (row's
`project`).

A permission row, `li.answered` (green left edge, as the board's):

| Part | Allowed | Denied |
|---|---|---|
| top | badge **allowed** (`data-state="done"`), the tool in `.id` style (`Bash`), project muted, age `today 14:02` | badge **denied** (`data-state="failed"`), the same |
| `.q` (muted, as answered questions) | `Howard wanted Bash: <preview>` / `Howard asked: <preview>` | the same |
| `.said` | `You allowed it` then the note as a blockquote if any | `You denied it` then the note |
| meta | `Howard got your note as its next message` if a note, else `Howard got your decision`; then `on mbp-1` | `Howard got your decision and note`/`Howard got your decision`; `on mbp-1` |

**No Undo** (the supervisor's answer can't be taken back), and no "from the dashboard" (every row is).
A denied row's left edge is `--bad`.

Empty: as today, no section when nothing was answered today.

## 3. A note sent with Allow (AC3)

Permission form (an approval):

- **Only on a laptop whose report has `decided`** (even empty): its supervisor delivers the note.
  A laptop whose report has no `decided` runs an older supervisor that drops a note with Allow: there
  the form stays exactly as today (label `Note to Howard, sent with Deny (optional)`, today's foot
  text, Allow sends no message). Toad, ADR 0013.

- Label: **`Note to Howard (optional)`**. Placeholder: `e.g. fine, but use the pool's stop script next time`.
- Foot text: **`Howard gets your decision, and your note as its next message. It can't be taken back.`**
- Allow sends `message` when the note isn't blank, as Deny does.
- Allow's confirm: `Allow Howard to run Bash?\n\n<preview>` and, with a note, `\n\nYour note goes with it.`
- Toasts (act's `done` becomes a function of the result):
  - Allow, no note: `Allowed Howard's Bash.`
  - Allow with note, `note_delivered: true`: `Allowed Howard's Bash; your note went to Howard.`
  - Allow with note, `false`: `Allowed Howard's Bash, but your note didn't reach Howard (it had stopped).` (warn toast)
  - Allow with note, absent: `Allowed Howard's Bash, but mbp-2's supervisor is older and dropped your note.` (warn toast)
  - Deny: unchanged (`Denied …; your note went to Howard.`).
- A question on the form (kind question, Deny only) keeps its wording: `Answer it through the
  orchestrator, or deny it here; Howard gets your note.` and the label `Note to Howard (optional)`.

## Widths

- **Phone 390**: Needs you's acts row under the line as today (Show all / Allow or deny, 44 px); the
  agent detail's Show all is 44 px; options stack full width; the code wraps (`overflow-wrap:anywhere`).
- **Tablet 1024 / desktop 1440**: Show all at the end of a Needs you line; in the detail row under the
  block; options take the block's width, at most 72ch for reading.

## Tests (dashboard)

A 3000-character Bash command reaches Needs you cut with Show all, opens whole, and shows whole on
Waits (clamped to 12 lines, Show all); a two-question AskUserQuestion in the agent detail row shows
folded with Show all, opens to both headers, questions, Pick one/any and every option with its
description, and stays open across a redraw; `ask: null` and no `ask` show `preview` as today; `cut`
shows the cut line; a `decided` row from today shows under Answered from here today with its note and
no Undo, one from yesterday doesn't; Allow with a note sends `message`; the four Allow toasts.

## Open questions

None for Peach. Answering an AskUserQuestion by picking an option (not in BOB-51) is Toad's follow-up
suggestion to Peach.

## Shots (`shots/<what>-<width>.png`, 390 / 1024 / 1440)

| Shot | Shows |
|---|---|
| `ac1-overview-folded` | Needs you: Howard's Bash cut with Show all; Riker's detail row, his AskUserQuestion folded to its first question with Show all. |
| `ac1-overview-open` | Both open: the whole command; both questions, headers, Pick one/any, every option with its description. |
| `ac1-overview-open-dark` | The same in the dark scheme. |
| `ac2-ac3-waits-allow-note` | Waits: the command whole (clamped at 12 lines on a phone, Show all), the form with "Note to Howard (optional)" and a note typed; Answered from here today with an allowed Bash (its note), a board answer and a denied WebFetch, no Undo. |
