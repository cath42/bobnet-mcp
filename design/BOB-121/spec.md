# BOB-121 design A: the dashboard, use case first

Daisy, 2026-11-22. Covers BOB-121 AC1 (`use-cases.md`) and AC2's prototype. It also gives the design
for AC3-16, which Luigi builds and I review against. Prototype: `prototype/` (static,
self-contained; `index.html` at its root, deployable as an assets-only Worker, and it opens from
`file://`). Shots: `shots/`, every view at 390, 1024 and 1440 (`node design/BOB-121/shots/take.mjs`).
Today's views: `current/`.

Data: ADR 0014 (`architecture/decisions/0014-usage-weighting-and-project-page.md`: weighting §1,
the `usage` and `project` reads §3, the current release §4) and ADR 0013 (a request's ask,
`decided`, `note_delivered`). Where a name differs there, Toad's files win and the screens stay.

**How the prototype maps to the build.** `prototype/proto.css` is new rules on `style.css`'s tokens
only; they move into `style.css`. `core.js` and `views.js` draw each piece the way `app.js` should.
`data.js` is made-up data in the reads' shapes.

**"Prototype: show other states" is not part of the product. Don't build it.** The panel at the foot
of the prototype's pages is a preview switch for the prototype only (Casper, Q-13: "weird"): it swaps
the sample to a quiet laptop, nothing on Needs you, or an older supervisor, so those states can be
seen. The dashboard shows them when they are true, never by a switch; `.proto-states` stays out of
`style.css` (§3). The prototype doesn't draw a day's detail; §2.9 is the design for it.

---

## 1. What changes, in plain words

- **Needs you** is one name: the tab is no longer "Waits on you".
- **The Overview** shows both groups of Needs you: "Holds work up", then "When you have time"
  (three, then a link). Every line shows its age. **Working now** is grouped by project.
  **CI** is its own card: every workflow's last run (passed too), when, and the five runs before it
  as dots.
- **Projects at a glance** shows the true current release (Helix: R2 Edit and audit, 1 of 6), and
  says when an earlier one is all done and waits for his close. **A click opens the project's
  page.**
- **A project page** (new): current release, running now, who ran lately (sessions, runs, tokens,
  outcomes), waits on you, CI, usage, backlog health.
- **Roadmap** shows no "x of y criteria" on a Done feature. Every row says where it stands, in words.
- **Features** lists the board's features. It never shows the Backlog.md empty state.
- **Usage** is one graph per project, all on the page, with **Weigh by model** (Raw tokens /
  Sonnet-equivalent).
- **Sessions** is gone. Its parts went to the project page, the feature page and a small
  **Laptops** page (header "live · 2 laptops").
- **The header**: no project dropdown. On a phone the tabs wrap onto two rows instead of scrolling
  out of sight.
- **BOB-51's dashboard half** is folded in. A worker's AskUserQuestion shows whole on its agent's
  row, with Show all. A permission shows whole on Needs you, with "Note to Howard (optional)" sent
  with Allow. "Answered from here today" lists decided permissions, with no Undo.

Unchanged: Status (it must work), Triage, Capture, the feature page's chain, history and context
per call, the quiet-laptop banner, the answer forms, the gates.

---

## 2. The views

### 2.0 Header (every view)

- `BobNet` (a link to the Overview), then the tabs: **Overview · Needs you `n` · Status · Roadmap ·
  Features · Triage · Usage**. `n` is the same count as the Overview's Needs you (blocked + when you
  have time, live permissions included).
- A project page highlights Overview. A feature page highlights Features. Laptops highlights none.
- Right: **+ Capture** (unchanged), then the connection: `● live · 2 laptops`. It is a link to
  Laptops. With a quiet laptop it reads `● 1 quiet` in warn.
- **≤760 px**: the tabs wrap onto a second row (all seven visible; no sideways scroll), and
  "· 2 laptops" drops.
- **Old links**: `#waits` → `#needs`. `#sessions` → `#project/<first>`, with the toast "Sessions
  moved: who ran is on each project's page; laptops and agents are under Laptops."
  `#feature/<ref>` → `#feature/<project>/<ref>`, and `#feature` alone → `#features`. AC13's test
  covers `#sessions`.

### 2.1 Overview (`#overview`): Casper's start page (AC3, AC4, AC14)

Top to bottom. On ≥900 px it is two columns: Needs you on the left (1.15fr); Working now, then CI,
on the right. Projects run full width under both.

1. **Quiet laptop banner** (BOB-48, unchanged), then the **Status line**:
   `Since your last visit (7h ago): 9 done, 3 stuck, CI red on BobNet →` (to `#status`).
2. **Needs you `n`**, a card with two groups (2.2): **Holds work up `n`** (its heading in `--bad`)
   lists every item. **When you have time `n`** lists its first three, compact: no button, a tap
   opens it. Then the link `N more when you have time, and today's answers, on Needs you →`, and
   the freshness line (2.2).
   Empty: "Nothing needs you. Anything new shows here within a minute." (`.st-empty.ok`).
3. **Working now `n`**: a card with one group per project, in project order. The group head is the
   project's name (a link to its page) and, at the right, the laptops its agents run on.
   - Each agent is today's line: dot, name (with `@laptop` when the project spans laptops), role;
     under it feature › step › task; at the right, its state when not "working", and its tokens so
     far.
   - A project with nobody running reads: "Nobody is running. Last: **Daisy** on BOB-121 design A,
     ended 10m ago." It is never left out, so Casper sees every project.
   - Queued agents: "1 queued: Luigi", as today.
4. **The agent's detail row** (tap a line; one open at a time; kept across redraws). Today's
   contents: model · effort · laptop · worked · context · calls, then the checkpoint. Then:
   - **A worker's AskUserQuestion (tier orchestrator)** (AC14): "**Marvin asks** · 6m · Helix's
     lead, Picard, answers", then the ask block (BOB-51 spec §1). Folded, it shows the first
     question clamped to 3 lines (2 on a phone). **Show all** opens every question, its header
     ("1 · Account"), "Pick one"/"Pick any", and every option with its description. It then reads
     **Show less**. Open stays open across redraws (`state.whole`). When open, a muted line: "Picking
     an option here is BOB-161, in the backlog for your verdict. Today Allow and Deny override the
     lead." That marks where BOB-161 would sit without building it.
   - A human-tier request of this agent: "**Howard wants Bash** · 14m · on Needs you →" (it is
     answered there).
   - Links: Open in Claude ↗, Its session →. Then two button groups, as today: [Allow][Deny] for an
     orchestrator-tier request, and [Stop][Reset].
5. **CI** (AC3; 2.4), a card listing every project's workflows.
6. **Projects** (AC5): a row per project. The whole row is a link to `#project/<key>`.
   - **Name ›**, then laptops · lead · PO, then a CI pill (`CI failed` / `CI running` / `CI passed`,
     the worst of its workflows) and "3 running" / "nobody running".
   - **Release**: the current release (ADR 0014 §4) as `R2 Edit and audit`, a meter, "1 of 6
     features done". Under it, for each earlier release that is all done and not closed: "R1 all
     done: waiting for your close" in warn, a link to the Roadmap.
   - **Open now**: the first open feature, then "Picard, Howard, Marvin on it" (green) or "nobody on
     it now".
   - **Next**: "Waits on you: Q-261, DRAFT-118" (warn, to Needs you) when a blocking wait is the
     project's, then "Ready: LAND-38 …".
   - **Backlog**: "9 items" (to Triage), "3 bugs · oldest 14 days".
   - Widths: five cells at ≥1100, two columns under, one column with labels at the left at ≤520
     (today's `.prow` rules).

### 2.2 Needs you (`#needs`, the Overview's card, the project page) (AC4, AC15, AC16)

**An item** (`li.need`, one function for every place):

| Part | Desktop and tablet | Phone ≤520 |
|---|---|---|
| Badge | kind badge (question, action, bug · blocks use, review gate, permission), spanning two rows | its own row, the age at its right |
| Text | bold, one line, cut with "…"; a tap or Enter opens it whole (`pre-line`) | full width, two lines |
| Age | right, muted: `14m`, `3h 10m` under a day, then `4 days`; the title has the stamp | right of the badge |
| Meta | `Helix › LAND-50 · holds up ● Howard, ● Marvin (Fixes)`, each held agent with its live dot. A bug: `· blocks use`. When you have time: `· from Bill`, never "holds up". `· needed before R2` when set | under the text |
| Action | one button at the right of the meta row: Answer / Mark done / Allow or deny / Open in triage (a link) | right of the meta, 44 px |
| Open | the recommendation under the text (`Recommended …`); a permission's command whole, as a code block | same |

A permission's text is `Howard wants Bash: ` and the command in monospace (`ask.text`, else
`preview`). Compact items (Overview's later group, the project page, Status) have no button.

**The page**: a project switch (All projects `n` / BobNet `n` / Helix `n`), then one card with both
groups, **oldest first in each**, as today: what has been held up longest leads. Every item is full, with its button, and the answer form opens under the
item (today's forms).

**Staleness (AC4).** This is what makes "never stale" visible:

- every item shows its age;
- a permission shows only while its laptop's report is under 3 minutes old and the request under a
  day old, and only while its worker runs (BOB-48's rules);
- an item leaves as soon as it's answered, or when its worker is gone;
- the freshness line at the foot of the card: "Up to date: mbp-1 reported 18s ago, ubu1 reported
  36s ago. An item leaves when it's answered or its worker stops." A quiet laptop is left out of it
  and gets its banner at the top;
- counts (tab, Overview, the project switch) count exactly what is shown.

**Permission form (AC16)**, as BOB-51 spec §3:

- Label "Note to Howard (optional)". Foot "Howard gets your decision, and your note as its next
  message. It can't be taken back." Cancel · Deny · Allow.
- On a laptop whose report has no `decided` (an older supervisor), the form is today's: "Note to
  Howard, sent with Deny (optional)".
- Toasts follow Toad's ruling. `ok:false` shows the error. On `ok:true`: `note_delivered: true` →
  "Allowed Howard's Bash; your note went to Howard". `false` → "…but your note didn't reach Howard
  (it had stopped)". Absent → "…but mbp-1's supervisor is older and dropped your note" (warn).

**Answered from here today `n` (AC15)**, under the card: the board's answers and the laptops'
`decided` rows since midnight, newest first.

- A permission row: badge **allowed** or **denied** (a denied row's edge is `--bad`), the tool,
  the project, `today 13:06`.
- Under it, "Bender wanted Bash: `pnpm …`", "You allowed it", the note as a quote if one went, then
  "Bender got your note as its next message · on mbp-1". **No Undo.**
- A laptop that sends no `decided` adds no rows, and nothing is said about it.
- A board answer keeps its Undo, as today.

Foot note: "Oldest first in each group. Answer here or in the project's conversation… A permission
request shows for a day at most, and only while its worker runs; a quiet laptop's requests wait
under its banner."

### 2.3 A project's page (`#project/<key>`) (AC6, AC13)

- **Head**: "‹ Overview", the name (24 px), then "lead · PO · laptops · repo". At the right a
  project switch (BobNet / Helix), as on Roadmap.
- **≥1000 px**: two columns, the main one (what it's doing) and an aside of 320-400 px (what it
  needs and costs). Under that, one column in this order: release, running now, who ran lately,
  waits on you, CI, usage, backlog health.

Main:

1. **Current release**: `R2 Edit and audit` · "1 of 6 features done", then a meter. Under it, each
   `done_unclosed`: "R1 Central backlog view: all done, waiting for your close. Close it on the
   Roadmap →". Then the release's features, one row each: id, title, and under the title where it
   stands (2.6), with "· Picard, Howard, Marvin on it" in green. The open one has the green left
   edge. Links: Roadmap · All features · Triage.
2. **Running now `n`**: Working now's lines for this project, with the same detail row (2.1.4).
   With nobody running: "Nobody is running. Last: …".
3. **Who ran lately**, the last 14 days (ADR 0014 `ProjectPage.sessions`), newest activity first.
   - Each session: the kind in its colour (DESIGN, BUILD…), its label in bold, the feature id (a
     link to the feature page), its title muted and cut, "open since 5h ago" or "21 Nov 23:10 –
     07:50 · 8h 40m", and at the right its tokens ("15.8M so far" while open).
   - Under it, the close: `need: none|answer|casper` in its colour; "2 majors · 2 sent back", or "no
     findings"; and the summary.
   - Then a line per run: agent, role · model · effort ("default model" for null), the outcome
     (done; running in green; `failed: land refused: CI red on main` or `lost: …` in `--bad`), and
     tokens.
   - A lost run's tokens read **"tokens unknown"** (warn), never 0. A running worker's tokens come
     from its laptop report.
   - Weigh by model, when on, applies here too.
   - Empty: "Nobody ran in the last 14 days."

Aside:

4. **Waits on you `n`**: this project's items, compact, then "Answer them on Needs you →" (it
   opens Needs you on this project). Empty: "Nothing waits on you."
5. **CI**: this project's workflows (2.4), in a narrower layout: the status on its own row.
6. **Usage**: "571.9M tokens, 14 days", this project's graph (2.9, small), the picked day's line, the
   Weigh by model switch (shared with Usage), and "Usage, every project →".
7. **Backlog health** (`StatusRow.backlog`): Ready to start · Without criteria · To triage (a link)
   · oldest · Open bugs. A warn line when the current release has nothing Ready and work left: "R2
   has nothing Ready: its next feature needs criteria."

### 2.4 CI (Overview card, project page) (AC3)

One line per workflow, from the laptop's board report (`ci`, as `ciLines` reads it), the projects
in order:

`Helix │ ◔ ci on main │ running 4m · usually 9 min · 7c1e2a9 · Howard's land │ ●●●●● │ Run ↗`

- Project: on the first workflow of each project; later rows leave the cell blank.
- Mark and words in tone: ✓ "passed 52m ago" (ok); ✕ "failed 2h 5m ago" (bad, bold); ◔ "running
  4m" (accent, the mark turns unless reduced motion is set). Then the short sha and who landed it
  when known. A failure adds its first line in `--bad` ("packages/broker: 2 tests failed").
- History: the last five runs, newest first, as 8 px dots in their tone; each has a title (status
  · sha · age).
- "Run ↗" opens the run on GitHub.
- ≤1099 px: the status words take the row under the name, the dots stay right, and "Run ↗" drops
  (the name is the link).
- Today a passed run isn't shown. **This needs the report's `ci` to keep the last five runs per
  workflow, passed ones too.** That is a data question for Toad (§6).

### 2.5 Status (`#status`, `#status/<key>`) (AC7)

As BOB-33 designed it and as built. It must work on production data; that is Luigi's fix.

- The page: the span bar (Since 08:12 · 24 h · A week, and I'm caught up), the two answers (Needs
  you; Is it going OK?), the project cards, then the Needs you list (compact) with "Answer them on
  Needs you →".
- A project card opens its digest (`#status/<key>`) with the six sections. The digest's head gains
  one link: "Helix's page →".
- In the prototype the digest's sections are drawn simply, from sample rows. The build keeps
  BOB-33's.

### 2.6 Roadmap (`#roadmap/<key>`) (AC8)

As today (release heads, the order, Edit your gates, Close), with one change: the **Criteria** and
**Tasks** columns become one column, **Where it stands**, in words:

| Feature | Where it stands |
|---|---|
| Done | `done 21 Nov` (muted). No count, ever. |
| Open (a session on it) | `6 of 11 criteria and 5 of 14 tasks left`, with the criteria meter under it |
| Ready | `ready · 8 criteria to meet` |
| Draft | `draft · no criteria yet`, or `draft · 4 criteria written`; a draft with some ticked (BOB-33) reads `draft · 5 of 11 criteria left` |

- Criteria here are the feature's **own** acceptance and DoD criteria, not its tasks' (a data point
  for Toad, §6).
- A release whose features are all done and that isn't closed: "All done: waiting for your close"
  beside **Close R1**.
- The current release has a small "CURRENT" tag.
- From BOB-189 (keep them): a planned release has the badge "planned" (idle colour, dashed); its goal, if it
  has one, is a muted line under the head, above the counts line; behind Edit your gates a closed release has
  **Reopen** (plain, no confirm, no Undo) where Close was. CURRENT is never on a planned release.
- Foot note: "…Where it stands: a feature not done says how many of its own criteria and tasks are
  left; a done one says when it was done. The feature's page lists any criteria it closed without."

### 2.7 Features (`#features/<key>`) (AC9)

- A project switch and a find box ("Find a feature: id or words", 16 px so a phone doesn't zoom).
- Filters: **All `n` · Open now · Ready · Draft · Done**, All by default.
- A list: id, title (a link to the feature page), then the badge, where it stands (2.6), who's on
  it, its release ("Not in a release"), and any note. Sorted open first, then Ready, Draft, Done
  (oldest done first).
- Empty states say only what's true: "Helix has no draft feature. [Show all]"; with words: "No
  feature of BobNet's matches “x”." Never "no backlog configured". A project whose board hasn't
  loaded reads "Reading the board…".

### 2.8 A feature's page (`#feature/<key>/<ref>`) (AC8, AC13)

Today's page, with these changes:

- **Head**: id, project (a link to its page), release, badge, the title, then where it stands (2.6),
  sessions, who's on it.
- **A Done feature with criteria not ticked**: a fold under the head in warn, "Done 22 Nov, with 3
  criteria not ticked". Open, it lists each one ("**AC 1** The dashboard half: … Moved to BOB-121
  criterion 14"), then "BobNet's PO closed it with these open; the board keeps them as they were."
  This is AC8's "says in words what the unchecked ones are". With every criterion ticked there is
  no fold.
- **Each session card** keeps its outcome and summary.
  - It gains a table of its runs: agent role · model · effort · outcome (`running` green, `failed`
    / `lost` bad) · tokens (`unknown` for a lost run), weighted when Weigh by model is on.
  - The links: Handoff · Context per call · N calls (it moves here from Usage) · **Review evidence**
    on a review (its findings and shots, from the close).
- The criteria sit beside the chain at ≥1100 (under it on a phone): "5 of 11 criteria met", and each
  with ✓ or ○. Then History →.

### 2.9 Usage (`#usage`) (AC11, AC12)

- **Controls**: "Weigh by model" [Raw tokens | Sonnet-equivalent] (one switch; the project page
  uses the same setting, kept per device) and [14 days | 30 days].
- **What the page says**, under the controls, in Toad's words (ADR 0014 §1):
  - On: "Sonnet-equivalent: each model's tokens count at its list-price ratio to Sonnet 5.5 (Opus
    5.5 ×2, Haiku 5.5 ×0.05, Fable 5.1 ×5). Effort isn't weighted: higher effort already shows as
    more tokens. Tokens only, nothing is priced."
  - Off: "Raw tokens: input, output, cache reads and writes as reported, every model counted the
    same."
  - Then **What's factored**, a disclosure with the table drawn from the read's `weights` (model,
    ×input, ×output, ×cache write, ×cache read), and "Ratios of each model's list price to Sonnet
    5.5's, per kind of token, read 2026-11-22. Effort is ×1 at every level. A model not in the table
    counts ×1 and is named under its graph."
- **A card per project, every project, no filter.** Two columns at ≥1200 px, one below.
  - Head: the name (a link to its page), the span's total ("1.12B tokens, 30 days", or
    "Sonnet-equivalent tokens"), then "today so far 27.6M · median day 40.4M".
  - The graph: a bar per day, with a y axis in tokens and dates under it. Each project has its own
    scale, so a small project's spike shows.
  - A day over twice the span's median (and over 4M) is a **spike**: its bar in `--warn` with its
    value on top. Today's bar is lighter ("so far").
- Tap or Enter on a day selects it (outlined) and adds the day's line under the graph: "Fri 13 Nov:
  139.1M Sonnet-equivalent tokens", its split by model ("opus 128.0M · sonnet 11.0M · haiku 115k"),
  and "Biggest: LAND-49 build 2 104.0M, …" (links to the feature page; `usage`'s `top`, the three
  biggest by the switch). Under the day line the **day's detail** opens (below, after Q-13).
- Under the graph:
  - "1 spike over twice the median day: 21 Nov 84.3M" (each a button that selects the day);
  - "98.0M tokens on an unnamed model, counted at ×1" (only when N > 0);
  - "1 run lost, tokens unknown: not counted".
- Foot: "Tap a day for what made it and its context per call. A run's tokens are spread over the days
  it ran; today's include the workers running now, so far. A session's own context per call is on its
  card, on the feature's page."
- Tokens only, everywhere: no currency, no price.

#### A day's detail (after Q-13)

Casper: "I liked the calls/context line graphs, would i click on a bar to see the detailed
context/call by agent and in total?" Yes: the tap above opens them for that day. The data is
`usage_day` (ADR 0014 §3a, build brief D8), fetched on the tap and kept per project, day, span and
tz (D5); the calls per day come from `usage` (each point's `calls` and `by_role`), already loaded.

- **Where:** inside the project's card, under the day line, the card's full width. One open day per
  card; tapping another day moves it there. Other cards are untouched.
- **Head:** "Fri 13 Nov in detail", a [Total | By agent] switch (`.seg`, as the session card's
  "Whole session"), and a Close button (×, `aria-label="Close Fri 13 Nov's detail"`).
  - **By agent** adds a second row of buttons, one per role with calls that day, most calls first
    ("luigi · 212 calls"). The first is picked. On a phone the row scrolls sideways; it doesn't wrap.
- **Graph 1, Context per call:** x is the call (1 … the day's calls), y is context in tokens.
  - Total: the day's runs in start order, their points summed as they go, solid `--accent`, 2.5 px.
    Today's line is named "Sun 22 Nov so far" and includes the running workers (D5).
  - By agent: the role's runs that day, one after another; a new run starts again from a small
    context, drawn as today's `roleLine` does (the reset dotted). The role's p25-p75 is the grey band,
    as on the session card today.
  - The baseline, dashed `--muted`, 2 px: `baseline.total.p50` or the role's `p50`, as "Baseline
    (Toad)" below says. It stops where it stops; the day's line goes on.
  - Hover or focus on a call shows a tip: "call 120 · 84k context · median 61k" (the median only
    where the baseline reaches).
  - Context is the model's own window, so it is **raw tokens with the weigh switch on or off**. Under
    Sonnet-equivalent the graph says so in its note: "Context is raw tokens: weighing applies to the
    bars."
- **Graph 2, Calls per day:** x is the period's days (as the bars), y is calls. A solid `--accent`
  line of the day's calls (Total: `calls`; By agent: that role's `by_role` calls), the median day
  dashed `--muted` across, and the tapped day a filled dot with its value on it. Today's point is
  hollow ("so far"). A day with no calls is 0, not a gap.
- **Key** under both graphs: "Fri 13 Nov · 412 calls" (solid) and "median day · 286 calls"
  (dashed); By agent adds "luigi's runs, middle half" (band). Then Toad's sentence, as below, with
  the period's days and the role's name filled in.
- **Widths:**
  - Phone (390): the graphs stack, Context then Calls, each the card's width and 180 px tall. Axis
    labels: three on y, first and last call (or first and last day) on x.
  - Tablet (1024, one column of cards): the two graphs side by side, Context 3/5 of the width and
    Calls 2/5, 220 px tall.
  - Desktop (1440, two columns, each card ~680 px): stacked as on a phone, 220 px tall. The card grows
    downward; the card beside it keeps its height (the grid aligns to the start, not stretch).
- **States:**
  - Loading: the day line shows at once (from `usage`); the detail shows its head and a frame the
    graphs' height with "Loading Fri 13 Nov's calls…", so nothing jumps when they arrive. The switch
    works while loading.
  - Failed: "Couldn't load Fri 13 Nov's calls." and a Retry button, in the same frame.
  - No calls that day: "No calls on Fri 13 Nov." in the frame, no graphs; plus "1 run lost: no context
    recorded" when `lost` > 0. The Total/By agent switch is hidden.
  - No baseline (fewer than 3 days reach call 1, or 3 of the role's runs): no dashed line or band, and
    the note says "No dashed line: fewer than 3 days in these 30 to compare with" (By agent: "fewer than
    3 luigi runs in these 30 days").
  - A role whose runs that day were all lost isn't in the By agent row. Lost runs show as "1 run lost:
    no context recorded" under the key, whatever the switch.
- **Closing:** the Close button, tapping the selected bar again, or Escape while focus is in the card.
  Focus goes back to the day's bar. Switching 14/30 days refetches it for the new period; if the day
  falls outside it, the detail and the day line close. The weigh switch doesn't close or refetch it.
- **Link:** the open day is in the hash, `#usage/<key>/<YYYY-MM-DD>` (with Total or By agent and the
  role as the session card keeps them in `state`). Opening that link scrolls to the card with the
  detail open.

**Baseline (Toad):** the dashed line on a day's context-per-call graphs is the **median over the
chosen period** (14 or 30 days). It is the same span and the same kind of figure as the bars' "median
day", so the whole page compares against one thing. A median isn't pulled up by the spikes the page is
there to show. A trailing average is, and it would shift with every day tapped. It is the median, call
by call, of:
- **Total:** the period's days, each day's calls in order with their context summed (as the session
  card's "Whole session" draws it).
- **By agent:** that role's runs in the period, each from its own first call. Their middle half stays
  the grey band of today's chart.
- **Calls:** the median day's calls (the day's, or the role's), in the key beside the day's own.

Where fewer than 3 days (Total) or 3 runs (By agent) reach a call, the line stops: there is nothing to
compare against. Under the graphs, the page says: "Dashed: the median over these 30 days. Total: a
day's calls, call by call. By agent: Luigi's runs at the same call, the band their middle half. A line
above it carried more context per call than usual." The key reads "Fri 13 Nov · 412 calls" and
"median day · 286 calls".

### 2.10 Triage (`#triage/<key>`) (AC10)

As it is: the project switch, the filters (All, Bugs, each open release, No release), Edit your
gates, the totals, the table (bugs first, then oldest), and the foot note. Nothing changes.

### 2.11 Laptops (`#laptops`, not a tab)

Reached from the header's "live · 2 laptops" and from a quiet laptop's banner (whose "Laptops →"
went to Sessions). Contents, all from the Sessions tab and drawn as there:

- **Laptops**: today's cards (supervisor up/no recent report, slots, queued, up, reported, the
  supervisor's version, outbox, last cleanup).
- **Agents**: online of total, the table (agent, team, client version, status or last seen, in/out
  24 h, inbox).
- **Rules for every project** (BOB-118): each global admin with Remove admin, as `#rules` today.
- **Messages in the last 24 hours**, folded: who messaged whom. Kept for debugging, as Casper
  agreed (Q-13, §6 Q5).

Session updates and "Workers ended in the last 24 hours" are dropped. The first are the checkpoint
on each agent's detail row and the summaries on the feature page. The second are runs on the
project page.

---

## 3. CSS

Every new rule is in `prototype/proto.css`, on `style.css`'s tokens only (`--bg --surface --text
--muted --line --accent --ok --warn --bad --idle --k-*`). It is light and dark (`shots/22-*-dark`).
New classes: `.st-line`, `.ov-side`, `.ngrp`, `li.need`, `.who-live`, `.fresh`, `.now-p`, `.nobody`,
`.ci-*`, `.link-card`, `.pmini`, `.p-top/.p-h/.pgrid/.pmain/.pside`, `.prel`, `.flist`, `.health`,
`.lately/.lt-h/.runs`, `.ugrid/.ucard/.ugraph/.uday/.u-*`, `.factored`, `.cur-tag`, `.find`,
`.unticked`, `.runs-t`, `.crit-list`, `.warn-t/.bad-t/.on-t`, and the BOB-51 `.ask` rules. The
`.proto-states` rule stays out of the build.

Touch targets: every button on a phone is ≥44 px tall (the item actions, Show all, the answer
forms). The seg switches are ≥32 px, as today.

## 4. Tests the build needs (beyond each AC's evidence)

- The current release rule (Helix: R2, 1 of 6; BobNet: R2, with R1 under `done_unclosed`).
- Needs you:
  - with the clock held, a request at 24 h + 1 min is neither shown nor counted;
  - a quiet laptop's requests are not offered and its banner shows;
  - an answered item leaves;
  - a stopped worker's request leaves;
  - oldest first in each group.
- Roadmap: a Done feature with unticked criteria shows no count; its page lists them.
- Features: BobNet and Helix list their features from the board; no "no backlog configured" string
  remains in `app.js`.
- Usage: one series per project, with no project picked; the toggle switches every number on the
  page; the unknown line shows only when N > 0; a lost run is never 0.
- Usage, a day's detail (fake broker answering `usage_day`):
  - a tap and Enter on a bar each open it with one `usage_day` call; a second tap on the same day
    doesn't fetch again; Close, a second tap on the bar and Escape close it and focus the bar;
  - Total's key reads "<day> · <n> calls" and "median day · <m> calls"; the dashed line has as many
    points as `baseline.total.p50`, and none when it is empty (with the "No dashed line" note);
  - By agent lists the day's roles, most calls first; picking one draws its band and median;
  - a day with no calls shows "No calls on <day>." and no switch; a failed read shows Retry;
  - the weigh switch changes no context figure; 30 → 14 days with a day 20 days back closes it;
  - `#usage/<key>/<day>` opens with the detail open;
  - today's detail includes a running worker's calls (D5's test).
- Old links: `#sessions` and `#waits` land as §2.0 says; no Sessions tab exists.
- BOB-51's dashboard tests (BOB-51 spec, "Tests"), unchanged.

## 5. Shots (`shots/<n>-<what>-<width>.png`; 390, 1024, 1440)

| Shot | Shows | ACs |
|---|---|---|
| 01-overview | Start page: Needs you's two groups with ages; Working now by project (BobNet nobody, Helix three); CI with BobNet failing and Helix running; Projects with true releases | 3, 4, 5 |
| 02-overview-agent-ask | Marvin's row open: his four-question AskUserQuestion whole after Show all; where BOB-161 would sit | 14 |
| 03-overview-quiet-laptop | ubu1 stopped reporting: its banner, the header's "1 quiet" | 4 |
| 04-overview-nothing-needs-you | Needs you empty | 4 |
| 05-needs-you | The page: both groups, oldest first; Answered from here today with an allowed Bash (note), a board answer (Undo), a denied WebFetch | 4, 15 |
| 06-needs-you-allow-note | Howard's Bash, the form "Note to Howard (optional)" with a note typed | 16 |
| 07-project-helix-running | A project page with three running, who ran lately (a failed run), waits, CI running, usage | 6, 13 |
| 08-project-bobnet-nobody-running | One with nobody running; R1 all done waiting for close; a lost run's "tokens unknown"; CI failed | 5, 6, 13 |
| 09-status, 10-status-helix | Status and a project's digest, with the link to its page | 7 |
| 11-roadmap-bobnet | R1 all done and its Close; R2 current; where each stands, in words | 8 |
| 12-roadmap-helix-done-shown | R1's done features unfolded: "done <date>", no counts | 8 |
| 13-features-bobnet, 14-features-helix-done | Features: the board's features, filters, find | 9 |
| 15-feature-land-50-open | An open feature: on it now, sessions with runs and tokens, criteria | 13 |
| 16-feature-bob-51-done-unticked | A Done feature naming its 3 unticked criteria | 8, 13 |
| 17-triage-bobnet, 18-triage-helix | Triage as it is | 10 |
| 19-usage-raw | A graph per project, raw; spikes, the unknown-model line, the lost run | 11 |
| 20-usage-weighted-day | Sonnet-equivalent on, What's factored open, a day picked on Helix | 12 |
| 21-laptops | Laptops, agents, rules, messages folded | 13 |
| 22-overview-dark | The Overview in the dark scheme, an ask open | — |

## 6. Open questions

**For Peach**

1. **AC4 "nothing over a day old is shown".** I read it as the live requests: a permission, or a
   worker's question, from a laptop report. A board question or action stays while it is open,
   however old (A-20, 4 days), because it is still true. Its age shows, and it leaves when answered
   or withdrawn. If Peach meant board items too, Needs you would hide real open questions; I'd
   rather Peach confirms.
**For Toad**

2. **CI history.** *Answered by Toad (ADR 0014 §3a, build brief D9): the board's `ci_runs`, latest
   and 5 before per workflow, the landing agent through `pushes`.* Passed runs and the five before need the laptop's board report `ci` to keep, per
   workflow, its last five runs (passed included), each with its sha, start, end and conclusion.
   "Who landed it" ("Toad's land") needs a land→run link. If there is none, drop it: the sha stays.
3. *Answered by Toad (ADR 0014 §3a, build brief D10).* **A feature's own criteria count** (Roadmap's "where it stands") apart from its tasks', and the
   unticked ones' text for a Done feature. I assume the `get` of a feature has them. The roadmap
   list needs the own count.
4. *Answered by Toad (ADR 0014 §3a, build brief D3): each `usage` point gains `top`.* **A day's
   biggest sessions** on Usage: the `usage` read has `by_model` per day but no per-session
   split. The day line can show models only, or the read gains `top: [{ session, raw, weighted }]`
   (≤3).

**For Casper (through Mario)**

5. *Covered by Casper's "yes build it with the changes" (Q-13): build the Laptops page and the
   folded message log as prototyped (§2.11).* **The Laptops page and the message log.** Is it right that laptop health, agents and rules live
   there, off the tabs? And should "who messaged whom" stay at all?
