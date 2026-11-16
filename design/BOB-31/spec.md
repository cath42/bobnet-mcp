# BOB-31: a cut question opens to its whole text, spec

Daisy, 2026-11-15. Casper: "i can't read the whole question in the UI it gets truncated - i need a way to
expand the text to read the whole question." Luigi builds from this file and the prototype.

- **Prototype:** `design/BOB-31/prototype/index.html` (works from `file://`). It uses
  `packages/broker/public/style.css` as is, plus `prototype/proto.css`; those rules use only style.css's tokens
  and move into style.css. Sample: BobNet's Q-1 as asked (with a context added), a short question, a permission
  question, a review gate, an action. The page draws again every 5 s, as the live dashboard does.
- **Shots:** `shots/<criterion>-<what>-<width>.png` at 390, 1024 and 1440. Retake with
  `node design/BOB-31/shots/take.mjs` (playwright-core from `@bobnet/broker`).

## Where a question is cut today (app.js as of f83f88a)

| Place | Code | Cut? |
|---|---|---|
| Overview, **Needs you** line: the question, action, permission or review text | `waitLine`, `permissionLine`; `.ov-needs .l-t` | **Yes**: one line with an ellipsis (tablet, desktop), two lines on a phone. The only CSS cut. `title=` shows it on hover, which a phone doesn't have. |
| Overview, Needs you: the recommendation | `waitLine` | **Not shown at all.** |
| Waits on you: question text, recommendation | `waitItem`, `.waits li .q`, `.rec` | Whole, but the asker's line breaks are folded into one paragraph. |
| Waits on you and Overview: the question's **context** (`QuestionRecord.context`, up to 16 KB) | nowhere | **Never shown** on the dashboard. `WaitRecord` doesn't carry it. |
| Answer form: the options | `answerForm`, `.opt-row` | Whole. |
| Waits on you, Answered from here today | `answeredItem` | Whole. |
| Feature view: Next card and Next banner | `nextItem`, `nextBanner` | Whole (they wrap). |
| Projects row, Next cell | "Waits on you: Q-258" | Only the ref, by design; not a cut. |
| A permission's text ("Howard asks: …") | supervisor `preview()` | Cut to 400 characters **by the supervisor**, before the dashboard sees it. Out of scope (open question 1). |

So the work is: Needs you lines open in place; the recommendation shows when one is open; the context shows
on Waits on you; line breaks are kept.

## Overview, Needs you (c1, c2)

**Folded (as today, plus a control).** A line whose text doesn't fit (one line on tablet and desktop, two on a
phone) gets **Show all**: an accent-coloured text button at the end of the line, before the answer button
(Answer, Mark done, Allow or deny). A line whose text fits shows no control. A review gate or bug line that is
cut gets Show all on its own.

- Desktop and tablet: `badge | text (one line, …) | Show all [Answer]`, the meta line under the text.
- Phone (≤520 px): the acts row under the line, as today, now holding **[Show all] [Answer]** side by side,
  each `flex: 1`, 44 px tall; there Show all is a bordered button like Answer, its label in the accent colour.
- Tapping or clicking the cut text itself opens it too (the big target on a phone), except while text is
  selected (`getSelection()` not empty), so he can still copy it. The cut text has `cursor: pointer`.

**Open.** The line shows, in this order:
1. The whole text, wrapping, its own line breaks kept (`white-space: pre-line`), bold as now.
2. When the question has one: **RECOMMENDED** (small caps label, muted) and the recommended option's text, in
   the text colour, 13.5 px.
3. When it has a context: a link **"Its context, on Waits on you →"**. It goes to `#waits` with that item's
   context open (below), scrolled into view. The context stays off the Overview: it can be pages long.
4. The meta line (project · feature · holds up …), as now.
5. On tablet and desktop the open text takes the line's whole width, and Show less with the answer button move
   to the end of the line, under the meta line (right-aligned). On a phone they are in the acts row as folded.

The control reads **Show less**; it folds the line back to one line (two on a phone). The tooltip `title` goes
while open (it would repeat the text).

**Answering opens it.** Pressing Answer / Mark done / Allow or deny opens the line whole, as well as the form:
he answers what he has read. Closing the form leaves the line open; Show less folds it.

## Waits on you (c1)

- The question's text keeps its line breaks (`.waits li .q { white-space: pre-line; overflow-wrap: anywhere }`).
  Same for the recommendation and the "Answered from here today" question.
- When the question or action has a **context**: a **Show context** text button under the recommendation (above
  the meta line). It opens the context under it: a block with a 3 px `--line` left border, 13.5 px, text colour,
  line breaks kept, no height limit. The button then reads **Hide context**. On a phone (≤600 px) it is 44 px
  tall. No context: no button.
- The form, options and recommendation are unchanged: they already show whole.

## What stays open, and the answer being typed (c2)

- What is open is a set of ids in `state.open`: `waitId(w)` / `permId(p)` for a Needs you line, `ctx:` + that id
  for a context on Waits. Kept in `sessionStorage` (`bobnet.open`), so it survives the dashboard's live redraws,
  a tab switch and a browser reload; a new tab starts folded. Ids no longer waiting are dropped on the next
  load of the waits.
- Opening or folding never touches `state.answering`: the picked option and the words typed stay. Render keeps
  the caret in the textarea as `loadQuestion` already does (the prototype does the same in `render()`).
- Show all is measured, not guessed: after every render and on `resize` (a phone turning), each folded `.l-t`
  in `#needs` is cut when `scrollWidth > clientWidth + 1 || scrollHeight > clientHeight + 1`. Render the button
  with `hidden`, then unhide it from that check (`proto.js`, `measure()`): no flash, and no control on a line
  that fits. An open line always shows its Show less.

## For Luigi

- **Data (Toad's to agree, additive):** `WaitRecord` gets `context: string | null`: the question's or action's
  context, `null` for a review gate or a bug. `store.ts waitsOf` fills it from `questionRecord`. Without it the
  Waits list would need a `get` per item to know whether to offer Show context.
- **app.js:**
  - `waitLine` / `permissionLine`: every Needs you line gets the `.acts` cell (drop the `.can` class and its grid
    rules; proto.css replaces them); `.acts` holds the Show all button, then the answer toggle. DOM order:
    badge, text, the open block (`.whole`), meta, acts, form, so on a phone the acts row falls under the meta.
  - The open block: `.whole` with `.rec` (`<b>Recommended</b>` + text) and the context link, only when open and
    there is something to put in it.
  - `answerToggle`: opening also adds the id to `state.open`.
  - `waitItem`: the Show context row; `answeredItem` untouched but for the CSS.
  - The measuring pass after render and on resize.
- **Accessibility:** the button is a `<button aria-expanded aria-controls="t-<id>">` with
  `aria-label="Show all of Q-1"` / `"Show less of Q-1"`; the text's tap is only a shortcut, the button is the
  keyboard's way. Show context has `aria-expanded` and `aria-controls` too.
- **Tests (dashboard):** a long question shows Show all, a short one none; Show all opens it to its whole text and
  the recommendation, Show less folds it; a tap on the cut text opens it; Answer opens it whole; typing in the
  form, then a redraw (and a Show less) keeps the words and the pick; open survives a redraw and a reload
  (sessionStorage); Show context on Waits opens and hides the context; no context, no button; a line break in a
  question is kept on Waits and in an open line.

## Acceptance shots (390, 1024, 1440)

| Shot | Shows |
|---|---|
| `c1-needs-cut` | Needs you folded: Show all on the cut question and the cut permission, none on the short question and the review gate. |
| `c1-needs-open` | Q-1 open (whole text, Recommended, the context link) and the permission opened by a tap on its text; Show less. |
| `c1-needs-open-dark` | The same in the dark scheme. |
| `c2-needs-answering` | Answer on Q-1: the line open, the form under it, words typed, taken after a redraw (5.5 s): words and caret kept. |
| `c1-waits-context` | Waits on you, Q-1's context open (Hide context), A-12's line breaks kept and its Show context folded. |

The build's shots retake these on the live dashboard with a long question.

## Open questions

1. **A permission question is cut to 400 characters by the supervisor** (`supervisor.ts preview()`), and its
   options are never sent. Show all shows what reaches the dashboard, which can end in "…". Sending the whole
   question and its options for an AskUserQuestion permission is a supervisor and protocol change (Toad,
   Luigi), not BOB-31's: Peach to triage it as its own item, or into BOB-31 if Casper wants it now.
2. Peach: BOB-31's criteria say "expanded in place to its whole text". The spec reads that as the question's
   text and recommendation in place on the Overview, and the context on Waits on you (one tap away, via the
   link). If Casper wants the context in place on the Overview too, it is one more block in `.whole`.
