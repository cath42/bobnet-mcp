# BOB-211 design A: Usage, from a session's bar to its agents

Daisy, 2026-11-26. Covers BOB-211 AC1-AC5 (release R9, "R3.1 Usage drill-down"). It builds on BOB-121 spec §2.9
(`design/BOB-121/spec.md`) and changes nothing there that isn't named here.

- **Prototype:** `prototype/` (static; `index.html` opens from `file://`). Deployed for Casper:
  <https://bobnet-prototype-bob-211.casper-cth.workers.dev/#usage/bobnet/2026-11-25/BOB-121/review/E>.
  `proto.css` is new rules on `style.css`'s tokens; they move into `style.css`. `app.js` draws each piece the way the
  dashboard's `app.js` should. `data.js` is the data.
- **Shots:** `shots/`, at 390 (phone, touch), 1024 (tablet, touch) and 1440 (desktop, mouse), by
  `node design/BOB-211/shots/take.mjs` (§6).
- **Data in the prototype:** BOB-121 build E and review E are the board's own records: runs, agents, tokens, Sonnet-equivalent,
  calls, outcomes, and review E split over 23, 25 and 26 Nov. The other sessions are shaped like them. The per-call context
  curves are drawn to add up to each run's real context tokens, because the reads I can make don't carry `ctx`.
- **Data in the build:** no new read and no new field (Toad, consult c_f473022c; §3).

Casper's words (BOB-211): "my first question after seeing a bar for a build session is 1) what is the build session (could I
hover to see it?) and 2) what was the spend by agent (bar chart maybe?) and then I'd want to click on an agent to see the
context/call graph 3) i'd still want to be able to see the context/graph total and with all agents on it for a build session".

---

## 1. What changes, in plain words

- **A day's bar is split into its sessions.** The day's three biggest sessions are stacked, the biggest at the foot. The rest
  of the day is one pale part on top. The bar keeps its colour (accent, or amber on a spike) and its height.
- **Point at a part and a tip says which session it is:** feature, kind, label, the feature's title, that day's tokens, and
  the whole session's tokens. The session's parts light up on every day it ran. On a phone or tablet, tapping the day lists
  the same sessions under the bar.
- **Under a picked day, "Biggest" becomes a list of the day's sessions.** It doubles as the bar's key, and each row opens the
  session.
- **Opening a session shows a panel in the card.** It has **spend per agent** as a bar chart, one bar per agent, whose runs
  are the bar's parts, adding up to the session's total. Beside or under it is the session's **context per call**: "All
  agents" is one summed line coloured by agent, and picking an agent shows its own runs against its earlier runs on the
  feature.
- **Unchanged:** the controls, the weighing, the median day and spikes, the day line's models, the day's detail (Total | By
  agent), the notes, and the feature page.

## 2. The views

### 2.1 A day's bar, in its sessions (AC1)

- **Parts, bottom up:** the day's `top` sorted by the figure shown (raw or Sonnet-equivalent), the first three, then "the
  rest" = the day's figure − the three, clamped at 0 (the read rounds each entry). A `session: null` entry among the three is
  its own part, "Outside any session". It is never merged into the rest.
- **Colour:** the bar's colour as today (`--accent`, `--warn` on a spike), at full, 68% and 46% strength for the three. The
  rest is 26%. Outside any session is `--idle` at 55%. A 1 px `--surface` line separates parts. Today's bar keeps its
  lighter look (50% on every part).
- **A mouse** (`(hover: hover) and (pointer: fine)`): each part is a target the full width of the day's column.
  - **Pointing** at a part shows its tip. That session's parts on every day are outlined in `--text` at full strength. Every
    other part on the graph dims to 35%, so a session that ran over several days reads as one.
  - **The tip** sits beside the bar, never over it: to its right, else to its left. It is level with the part and stays
    inside the graph. Max 240 px wide, the `.tip` look. It reads:
    - **BOB-121 build E** (`· running` in `--ok` for an open session)
    - the feature's title, two lines at most;
    - "Mon 23 Nov: 16.3M tokens · 13% of the day" ("so far" on today);
    - "Whole session: 16.3M · ran 23 Nov" (or "ran 23–26 Nov, 3 days"; "so far" while open);
    - "Click for its agents" (muted).
  - **The rest's tip:** "The rest · 68.4M … Smaller sessions, and work outside any. The day's three biggest are named."
  - **Outside any session's tip:** "Runs that declared no session: fix passes, board moves, consults."
  - **A click** on a session's part picks the day and opens that session's panel (§2.3). A click on the rest, on outside any
    session, or above the bar picks the day, as today.
- **A touch screen** (phone and tablet): the bar stays one target. A tap picks the day, as today, and the day line (§2.2) names
  the bar's sessions under it, which is what "tapping shows which session" means on a 9 px bar. A tap on a session's row
  opens it.
- The bar's `aria-label` names the parts: "Mon 23 Nov: 124.4M tokens, a spike; BOB-121 build C 21.6M, BOB-121 build D
  18.1M, BOB-121 build E 16.3M".

### 2.2 The picked day's sessions (the day line)

Under the day line's head (‹ › and the day's total) and its models, **"Biggest: …" becomes a list**, one row per part, in
the bar's order, biggest first:

- **A session's row** is a button (`aria-pressed` when its panel is open): its swatch (the part's shade), **BOB-121** build
  E, then the title (muted, one line with an ellipsis), the day's tokens and ›.
  - On a phone the title takes a second line, two lines at most, and the row is ≥44 px.
  - Pointing at or focusing a row lights its parts on the graph, as pointing at the part does.
  - A tap opens the panel. A tap on the open session's row closes it.
- **The rest** and **Outside any session** are rows too, muted and not buttons: "smaller sessions, and work outside any",
  "runs that declared no session".
- A running session's row has a `--ok` "●" after its name.
- The link to the feature page moves into the panel (§2.3). Before, a Biggest name linked straight to the feature page.

### 2.3 A session's panel (AC2)

Opening a session replaces the day's detail (BOB-121 §2.9) in the card. It stays under the day line, the card's full
width. There is one panel per card. Opening another session, from the bar or a row, swaps it. Closing it brings the day's
detail back (§2.7). Other cards are untouched.

- **Head:** the kind (`.kind` with its colour square, as the feature page), **BOB-121** (link) review E, "running" (badge,
  `--ok`) while open, and × (`aria-label="Close BOB-121 review E"`).
- **Under it:**
  - the feature's title;
  - "Mon 23 Nov 20:13 – Thu 26 Nov 02:51 · 3 agents · 5 runs · 185 calls" ("– now" while open);
  - "**15.9M tokens**, whole session · Wed 25 Nov: 9.5M of it". The day's share shows when the session ran on more than
    one day, or still runs.
- **Spend per agent** (`h4`), one row per agent. An agent is the run's `agent` name, its runs summed. Biggest first by the
  figure shown.
  - **A row** is a button, ≥44 px tall, `aria-pressed` when picked. It shows the swatch and **name**, then muted
    "opus · 2 runs, 1 stopped" ("1 run, stopped"; "· running"), and the figure on the right ("so far" while running).
  - **The bar** spans the row under it, scaled to the biggest agent. Its parts are the agent's runs in start order, 2 px
    apart, in the agent's colour. Each part's `title` is "20:13–20:16 · stopped by the orchestrator · 1.4M · 13 calls".
  - **"Session"** and the session's total close the list, over a hairline. It is the sum of the rows, and it is what the
    feature page's session card says (AC2's "numbers matching the session's total"; Toad: `ss.weighted` = Σ runs'
    `weighted`).
  - The note under it says "Pick an agent for its own context per call; pick it again for all of them." With one agent:
    "Pick the agent for its own context per call, against its earlier runs."
- **Agent colours:** `--ag-1` … `--ag-6`, by order in the chart (biggest first). A 7th and later agent is `--idle`. The same
  colour is used for the agent's row, its bar, its stretch of the summed line and its picker button. The first is
  `--accent`'s value, so a one-agent session looks like today's line. Each is ≥3:1 on `--surface`, light and dark
  (`proto.css`).
- **Foot:** "Tokens are the whole session's, every run's, as its card on BOB-121's page has them. BOB-121's page ›". The
  link opens the feature page at the session's card (`stepId`).
- **Tokens only.** No currency, no price, anywhere in the panel.

### 2.4 Context per call: all agents (AC4) or one (AC3)

Beside or under the spend chart (§2.5), headed by the picker: **[All agents | Daisy | Mario | Toad]** (`.seg`, each agent
with its swatch, the chart's order). The picker and the spend rows are the same choice. Picking one updates the other.
Picking the picked agent's row again goes back to All agents.

- **All agents** (heading "Context, summed call by call"; AC4):
  - **The line:** every call in the session, its runs in start order, context summed as it goes. This is the feature page's
    "Whole session", and the same data. Each run's stretch is drawn in its agent's colour, so the total and every agent are
    on one line.
  - **Dashed `--muted`:** the session of the same kind before it on the feature ("review D"), as the session card draws it.
    With none: "No dashed line: no review on BOB-121 before it."
  - **The key:** "Daisy · 83 calls", "Mario · 67 calls", "Toad · 35 calls", then "- - review D · 113 calls".
  - **The note:** "Every call in the session, its runs in the order they started, with context summed as they go; each stretch
    is the agent whose call it was. Dashed: review D, the review before it."
  - **The tip:** "call 120 · Daisy · 9.8M context summed · review D 8.1M".
  - **A click on a stretch** (or Enter at a call) picks that agent.
- **One agent** (heading "Daisy's context per call"; AC3: only that agent's calls):
  - **The line:** the agent's runs one after another, each call's own context (not summed), in its colour. A new run starts
    again from a small context, with a dotted line at the reset, as the session card's `roleLine` does.
  - **The band and dashed median:** the middle half and median of the earlier runs of that role on this feature, at the same
    call, while 3 or more reach it (Toad: feature-scoped, not `usage_day`'s period medians). With fewer: "No band: fewer
    than 3 earlier Mario runs on BOB-121."
  - **The key:** "Daisy · 83 calls", "earlier Daisy runs on BOB-121, middle half", "their median", "a new run starts".
  - **The note:** "Daisy's 2 runs in the session, one after another; each new run starts again from a small context (dotted).
    The grey band is the middle half of 4 earlier Daisy runs on BOB-121 at the same call, dashed their median. A line above
    it carried more context per call than usual."
  - **The tip:** "call 34 · 96k context · median 71k".
- **Both views:**
  - The x axis is "1 … N calls" and the y axis has three labels, as the day's detail.
  - Context is raw tokens whatever the switch. Under Sonnet-equivalent the note adds "Context is raw tokens: weighing applies
    to the bars."
  - A running session adds "Running: Daisy's calls so far, from mbp-1's last report."
  - An older supervisor's short series (BOB-195) keeps the session card's "approximate … reports only the last 400 calls"
    note. It is never padded.

### 2.5 Widths

- **Phone (390):** everything stacks. The panel's parts come in this order: head, meta, spend, picker, graph (190 px tall),
  key, notes.
  - The picker scrolls sideways and doesn't wrap, with buttons ≥44 px.
  - Every row and the × are ≥44 px. The day line's session rows are two lines, ≥44 px.
- **Tablet (1024, one column of cards, ~960 px):** the panel's body is two columns: spend 42%, context 58%, 220 px tall. The
  bar stays one target (touch).
- **Desktop (1440, two columns, each card ~650 px):** stacked as on a phone, the graph 220 px tall. The card grows down. The
  card beside it keeps its height (the grid aligns to the start), as the day's detail does.
- **The rule:** the panel's body goes side by side when its width is ≥820 px. Pointing (tips, per-part targets) depends on the
  pointer, not on the width.

### 2.6 States

- **Loading:** the head, the title and "Mon 23 Nov: 16.3M of it" show at once (from `top`). The body is a frame of the
  graph's height reading "Reading BOB-121 build E's agents…", so nothing jumps.
- **Failed:** in the same frame, "Couldn't read BOB-121 build E's agents." and Retry. The head and × stay.
- **One agent** (build E, Luigi): one row, the picker [All agents | Luigi]. All agents is Luigi's summed line.
- **A running session:** the "running" badge, "so far" on its figures, and the meta's "– now". Its runs come from the laptop
  report as the session card's `runsOf` merges them. The figures update with each report, and the picked agent and tip stay.
- **A lost run:** its agent's row shows "tokens unknown" in `--warn` for that run, with no bar part (Toad). It is never 0,
  and it isn't in the Session sum. It shows in the meta as "1 run lost". An agent whose every run was lost has a row with
  "tokens unknown" and no picker button.
- **A run with no context recorded:** its stretch is missing from the line. The note adds "Toad's first run has no context
  recorded."
- **No weighted figure** (an older broker's reply, `weighted` absent): the panel shows raw, and under Sonnet-equivalent it
  says "This session's runs aren't weighed: raw tokens."
- **Many agents (7+):** later agents are `--idle`, and the picker scrolls.
- **The session isn't in the period** (a link from 30 days, then 14): the panel and the day close, as the day's detail does.

### 2.7 Keyboard, taps, closing

- **The graph** stays one tab stop, as today: Left and Right move along the days, and Enter picks the day.
  - Up and Down go through the focused day's parts, bottom up. The tip shows for each, and the part is outlined.
  - Enter on a session's part opens its panel and keeps focus on the bar. Enter on the rest picks the day.
- **The day line's rows** are buttons in tab order, after ‹ ›.
- **Inside the panel:** the × closes it, then the spend rows, the picker, and the context graph (`tabindex=0`; Left and
  Right move along the calls, Home and End jump to the ends, Enter in All agents picks the agent at the call).
- **Closing the panel** (×, a tap on its open row, or Escape in the card) brings back the day's detail and focuses the
  session's row. Escape again closes the day, as today. Escape closes the innermost first.
- **Focus on open:** opening by click or tap focuses the panel's ×, and the panel scrolls into view (`block: nearest`).
- **Taps and switches:** every tap target on a phone is ≥44 px. The seg switches are ≥32 px elsewhere, as today.

### 2.8 The link

`#usage/<project>/<day>/<feature>/<kind>/<label>[/<agent>]`, for example `#usage/bobnet/2026-11-25/BOB-121/review/E/Daisy`.
Each part is URI-encoded, since a label can be "Fixes" or "discovery". The filters stay (`?weigh=1&days=30`).

- Opening the link scrolls to the card with the day picked and the panel open (and the agent picked).
- Closing the panel takes the link back to `#usage/<project>/<day>`.

### 2.9 What stays (AC5)

BOB-121 §2.9 holds, except where this spec names a change:

- the controls and What's factored;
- a card per project with its head;
- each project's own scale;
- the median day over days with raw tokens, and spikes in `--warn` with their value;
- today lighter;
- ‹ › and the day line's head and models;
- the spike, unnamed-model and lost-run lines;
- the day's detail (Total | By agent) with its states, baseline and link;
- the project page's small graph, which gets the parts and the tip but no panel; its day line links to `#usage/…` for the
  panel.

BOB-121's Usage tests must still pass, once two strings are updated: the footnote and "Biggest:" become §2.2's list. The
foot note reads: "Each bar is its day's sessions, the biggest at its foot: point at a part, or tap the day, to see which
session it is; open one for its agents. A run's tokens are spread over the days it ran; today's include the workers running
now, so far."

## 3. Data

Toad, consult c_f473022c (advisory; he folds it into his BOB-211 note), read against 421840e/7a870d3. **Nothing here needs a
new read or a new field.**

| Need | Where it is | Gap? |
|---|---|---|
| Which sessions make a day's bar, with feature, kind, label, title, tokens | `usage` → each point's `top`: `{session: SessionRef \| null, feature_title, raw, weighted}`, the top 3 by raw ∪ the top 3 by weighted (≤6), so it holds the top 3 under either switch (store.ts:1140) | None. Re-sort by the shown figure and take 3; the rest = point − Σ, clamped at 0 (entries are rounded, ±1-2) |
| Work outside any session | a `session: null` entry in `top` when it ranks | None. It is its own part, never merged into the other sessions |
| Today's running work on the bar | the laptop report's worker `session` (declared by spawn), as `usageSoFar` already adds tokens | None. It is named only from the declared session; no session declared → the rest. It is marked running |
| Spend per agent in a session | feature `get` with `ctx: true` → the session's `runs[]`: agent, role, model, effort, tokens, `weighted`, calls, outcome, ctx (store.ts:3238-3275) | None. Σ runs by agent. `weighted` is always set by this broker; absent means an older broker, so show raw |
| The session's total, matching | `ss.tokens` / `ss.weighted` = Σ its runs' (store.ts:3271-3274) | None |
| Each agent's context per call | the same runs' `ctx` (≤ RUN_CTX_MAX = 2000, downsampled by the broker) | None for ended runs. **A running run's `ctx` is empty on the board** (board.ts:769); its live calls come from the laptop report, which `runsOf` already merges. An older supervisor's report has only the last 400 calls (BOB-195): show what arrives, marked partial |
| The combined all-agents graph | the same `ctx` arrays, runs in start order | None |
| The agent's band | earlier sessions' runs of that role on the feature, as the session card's `ctxPanel` computes them, from the same `get` | None |
| A session's share of the day vs its whole | `top` (the day's share, apportioned by wall time, store.ts:1091) vs the runs' sum | None. The panel says "whole session" and "<day>: X of it" |

**Not available, and not designed for:**

- **Per agent per day.** Neither read splits an agent's tokens within a session by day. The panel shows the whole session's
  per-agent figures, never "Daisy on Wed 25 Nov".
- **Per-call time.** The calls carry no timestamp. The combined line runs in start order of the runs (as the feature page's
  "Whole session"). Two agents running in parallel show one after the other, not interleaved.
- **More than three named sessions a day.** On a busy day the rest is large. BobNet's 23 Nov in the prototype is 68.4M of
  124.4M. Naming more is a broker change, not a new field: `top`'s 3 → N (store.ts:1140). See §7, Q1.

**Reads:** one feature `get` (with `ctx`) per opened session. It is kept per session like `usage_day`'s reads, and read again
when that feature's board changes or a run of it ends. Never prefetched (Toad).

## 4. CSS

New rules are in `prototype/proto.css`, on `style.css`'s tokens only:

- the new tokens `--ag-1` … `--ag-6` (light and dark);
- `.ugraph .sg / .shit / .dim / .hl / .open / .kf`;
- `.u-tip`;
- `.u-ss / .u-s` with the `.sw` swatches;
- `.sp`, `.sp-h`, `.sp-m`, `.sp-body(.side)`, `.sp-rows`, `.sp-row`, `.sp-bar`, `.sp-sum`, `.sp-ctx`, `.sp-ctx-h`, `.sp-pick`,
  `.sp-foot`;
- the phone block at ≤600 px.

`.proto-asis` stands in for the day's detail and stays out of `style.css`. The prototype's `style.css` is a copy of the live
one at ef29e56.

## 5. Tests the build needs (beyond each AC's evidence)

- **Parts:**
  - A day with 5 sessions draws 3 named parts plus the rest.
  - The parts' sum equals the bar's figure under both switches, and the rest is never negative.
  - A `session: null` entry in the top 3 is its own part.
  - Switching weigh re-ranks the parts.
- **Pointing:**
  - With a fine pointer, hovering build E's part shows a tip with "BOB-121 build E", the title, the day's figure and "Whole
    session".
  - Its parts on every day get `.hl`.
  - A coarse pointer has no per-part targets, and a tap picks the day.
- **The day line** lists the parts in order. A session's row is a button. A tap opens the panel with one feature `get`; a
  second open of the same session doesn't read again.
- **Spend:**
  - One row per agent, its runs summed, biggest first.
  - The Session sum equals `ss.tokens` (raw) and `ss.weighted` (weighted).
  - A lost run shows "tokens unknown" and isn't summed.
  - No "$", "USD", "cost" or "price" in the panel.
- **Context:**
  - All agents draws one stretch per run in its agent's colour, in start order, with the same points as the session card's
    "Whole session".
  - Picking Daisy draws only Daisy's runs' points (AC3) with resets.
  - The band appears only with ≥3 earlier role runs.
  - A click on a stretch picks its agent.
  - The weigh switch changes no context figure.
- **Keyboard:**
  - Up and Down on a focused bar move through its parts, and Enter on a session's part opens the panel.
  - Escape closes the panel, then the day.
  - × focuses the session's row.
- **Link:** `#usage/bobnet/<day>/BOB-121/review/E/Daisy` opens with the panel and Daisy picked. 30 → 14 days with the day out
  of the span closes both.
- **Running:** today's running worker with a declared session is named on today's bar and in its panel, with "so far".
- **BOB-121's Usage tests** pass, with the two strings updated (§2.9).

## 6. Shots (`shots/<n>-<what>-<width>.png`)

| Shot | Shows | AC |
|---|---|---|
| 01-bar-names-its-session | 1440: pointing at build E's part of 23 Nov, its tip, its part lit and the rest dimmed. 390 and 1024: the day tapped, its sessions named under the bar | 1 |
| 02-session-build-e | Build E opened: one agent (Luigi 16.3M = the session), All agents | 2, 4 |
| 03-session-review-e-all-agents | Review E: Daisy 7.2M, Mario 6.3M, Toad 2.5M = 15.9M; the summed line coloured by agent; review D dashed | 2, 4 |
| 04-review-e-daisy | Daisy picked: her two runs with the reset, the band of her earlier runs on BOB-121 | 3 |
| 05-review-e-mario-no-band | Mario picked: no band (fewer than 3 earlier runs) | 3 |
| 06-review-e-from-its-bar-on-23-nov | 1440: pointing at review E's small part on 23 Nov ("ran 23–26 Nov, 3 days"). Touch: opened from 25 Nov's row | 1, 2 |
| 07-running-session-today | BOB-211 design A running today: badge, "so far", the running note | 2 |
| 08-review-e-weighted | Sonnet-equivalent: every figure re-weighed, the sum still matches; "Context is raw tokens" | 2 |
| 09-review-e-dark | Dark scheme, Toad picked | 3 |
| 10-helix-fixes-running | Helix's LAND-50 Fixes: three agents running across two days | 2, 4 |

## 7. Rulings (Peach, 2026-11-26; Casper's Q-17 "Build it as shown" for the prototype)

1. **Busy days keep a big "rest": out of BOB-211.** Its criteria ask which session a bar is, not every one. Build keeps `top`'s
   three named parts and the rest. Backlog: BOB-213 (broker `top` 3 → N).
2. **The feature page's session card: no change in BOB-211.** No criterion asks for it. Backlog: BOB-214, after this ships.
3. **The project page's small graph: parts and the tip, no panel** (§2.9 as written). Its day line links to `#usage/…`,
   which opens the panel. Enough for AC1 and AC5.

Build: BOB-211 is split into BOB-215 to BOB-221, all build A; there is no build B.
