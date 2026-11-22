# BOB-48 design A: a laptop that stopped reporting, and a stuck board outbox

**Small.** Nothing here is a new pattern: the banner is the dashboard's existing `.banner`
(as "Board unavailable" uses it), and the Laptops card gains one line in its existing `.card`
layout and has one line reworded. There is no new interaction, so there is no prototype. Luigi
builds from this file, `packages/broker/public/app.js` (`staleReport`, `staleLines`,
`viewOverview`, `viewWaits`, the Laptops section of `viewSessions`) and `style.css`.

Covers BOB-48 AC2 and AC3 (BOB-23 AC3, BOB-28). AC1 and AC4 have no screen of their own.

## Data (Toad, consult 2026-11-22)

Toad records these as rulings in `architecture/bob48/build-brief.md` and ADR 0012. If they name
something differently, Toad's files win and the strings below stay the same.

- **Stale** = the laptop's last report `at` is more than 3 min old (three missed 60 s heartbeats).
  The dashboard decides, as today: `staleReport(l)` with the skew-corrected `brokerNow()`. Unchanged.
- **Pending rows older than 24 h** (`created_at`, the supervisor's ORPHAN_TTL) are never shown or
  counted, from any laptop, stale or not. So a laptop quiet for a day counts 0 requests.
- **Sweep**: a `laptop_reports` row whose `at` is over 30 days old is deleted by the broker; the
  laptop then leaves the Laptops card. Between 3 min and 30 days it shows as stale.
- **`snapshot.board_outbox`**: optional, `{ count, oldest_at: ISO|null, code: string|null }`. A new
  supervisor always sends it (`{0, null, null}` when empty); an older one doesn't. `code` is the
  error the oldest row last met (`"unavailable"`, `"timeout"`, …), null if it hasn't failed.
- **Stuck** = `count > 0` and `oldest_at` more than 5 min ago. Under 5 min the outbox is in flight
  and the dashboard shows nothing.

In the mock-ups, `<age>` is `since()` output ("12m", "3h 20m", "2d 4h") and `N` is a count with
`plural()`.

---

## 1. The stale-report banner

### Where

At the top of **Overview** and of **Waits on you**, the two pages that would offer that laptop's
requests, above everything else on the page (on Overview, after a "Board unavailable" banner if
there is one). One function, `staleBanners()`, draws it for both.

It **replaces** `staleLines()` in the Needs you card: the banner says the same thing once, where
it is seen first. Remove the `.stale-line` paragraph.

### When

- A laptop is stale (`staleReport(l)`) **and** its last report is under 24 h old.
- After 24 h the banner goes: by then none of its requests are counted, and a laptop that has been
  off for a day (ubu1 shut down on purpose) is not news on every page load. The Laptops card keeps
  saying so until the sweep (section 2).
- **Not while the dashboard itself is disconnected** (`$("conn").dataset.state !== "live"`): then
  every laptop looks stale because reports aren't reaching *this page*, and the header already says
  "reconnecting". Draw no stale banner until the connection is live again.

### What it says

`div.banner` (warn left edge, the default). Three spans, which wrap on their own (`.banner` is
`flex-wrap`):

1. `b`: **`<laptop> stopped reporting`**
2. `span`: `last report <age> ago` (an `ago(l.at)`, so it ticks)
3. `span`, only when the count is > 0: `N request(s) for you from it wait(s) until it reports again`.
   N = its `snapshot.pending` rows with `tier === "human"` and `created_at` under 24 h, as
   `staleLines` counts today plus the 24 h rule.
4. `a href="#sessions"`: `Laptops →`, to the card below.

A `title` on the banner: `No report from <laptop>'s supervisor since <l.at, local time>. Its requests
are not offered here until it reports; nothing is lost.`

Desktop (1440), Overview:

```
┃ mbp-1 stopped reporting   last report 12m ago   2 requests for you from it wait until it reports again   Laptops →
```

Phone (390), the same banner wraps:

```
┃ mbp-1 stopped reporting
┃ last report 12m ago
┃ 2 requests for you from it wait
┃ until it reports again   Laptops →
```

With no requests from it:

```
┃ ubu1 stopped reporting   last report 3h 20m ago   Laptops →
```

### More than one stale laptop

- Two: two banners, oldest report first, 8 px apart (the page's own gap).
- Three or more: **one** banner, so a bad network morning doesn't push Needs you off a phone screen:
  - `b`: **`3 laptops stopped reporting`**
  - `span`: the names with each age, `mbp-1 12m · ubu1 3h 20m · mini 40m`, oldest first
  - `span`, when the total is > 0: `N request(s) for you from them wait(s) until they report again`
  - `a`: `Laptops →`

### When it reports again

The next report makes it fresh; the banner goes on that render with no toast. Its requests reappear
on Needs you and Waits as they do today.

---

## 2. The Laptops card (Sessions page)

The card stays as it is: name and badge on top, the meta row, the cleanup line. Two changes.

### (a) A stale laptop's last pending list: marked, not dropped

It is already never offered on Now, Overview, Waits or agent lines (BOB-26). Keep that. On the card
the meta span that counts it is reworded, and counts only rows under 24 h old (all tiers, as today):

- Before: `3 requests from its last report not offered`
- After: `3 requests wait until it reports again`

Shown only while stale and N > 0. After 24 h N is 0 and the span goes; the card then reads just
`no recent report` (badge) and `reported <age> ago` (meta), which is all there is to say.

The badge stays `no recent report` (state `stopped`, idle grey). No new badge for "over a day".

Fresh laptops: the 24 h rule also applies to their pending list everywhere it is shown, with no
wording of its own: a request older than a day simply isn't there.

### (b) The board-report backlog (AC3)

A new `div.outbox`, after the meta row and before the cleanup line, **only when stuck**
(`count > 0` and `oldest_at` over 5 min ago). Missing `board_outbox` (an older supervisor), an empty
one, or one under 5 min: no line at all, never "0".

Text: `b` **`Board reports stuck`** then ` · N waiting · oldest <age>` then, when `code` is set,
` · last error <code>`. A `title` on the line: `This laptop's supervisor has board reports it
couldn't send since <oldest_at, local time>. It retries every minute; the board on the dashboard is
behind until they go through.`

Style (add next to `.card .cleanup`):

```css
.card .outbox { font-size: 13px; color: var(--warn); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.card .outbox b { font-weight: 600; }
```

Colour is `--warn`, not `--bad`: nothing is lost, it is late. It wraps like the cleanup line.

Desktop (1440), a card in the auto-fill grid (each card ≥ 280 px):

```
┌──────────────────────────────────────────────┐
│ mbp-1                         (supervisor up) │
│ 2 of 3 slots busy  0 queued  up 2d 4h        │
│ reported 14s ago                              │
│ Board reports stuck · 14 waiting · oldest     │
│ 11h 2m · last error unavailable               │
│ Cleanup · scheduled · 3h 10m ago · …          │
└──────────────────────────────────────────────┘
```

Phone (390), cards are one column, full width; same lines, wrapping:

```
┌────────────────────────────────────┐
│ mbp-1               (supervisor up) │
│ 2 of 3 slots busy  0 queued         │
│ up 2d 4h  reported 14s ago          │
│ Board reports stuck · 14 waiting ·  │
│ oldest 11h 2m · last error          │
│ unavailable                         │
│ Cleanup · scheduled · 3h 10m ago …  │
└────────────────────────────────────┘
```

A stale laptop with a stuck outbox shows both: the badge, the "wait until it reports again" span,
and the outbox line as of its last report. The age keeps counting from `oldest_at`, which is true:
those reports are still unsent as far as anyone knows.

### (c) No laptops

When `state.laptops` is empty (all swept, or a new broker), the cards grid shows
`div.empty`: `No laptop has reported in the last 30 days.` (`.cards .empty` exists.)

---

## States, all together

| Laptop | Overview / Waits | Laptops card |
|---|---|---|
| Fresh, outbox empty or in flight | nothing | as today |
| Fresh, outbox stuck | nothing (see open question) | + `Board reports stuck · …` |
| Stale, under 24 h | banner (one per laptop, one for 3+) | badge `no recent report`, `N requests wait until it reports again` |
| Stale, 24 h to 30 days | nothing | badge `no recent report`, `reported <age> ago` |
| Last report over 30 days | nothing | gone (swept) |
| Dashboard disconnected | no stale banners | as today (ages keep ticking) |
| Older supervisor (no `board_outbox`) | as above | no outbox line |

## Review checks (for the build)

- Screenshots at 390 and 1440: Overview with one stale laptop with requests, with three stale
  laptops; Laptops card with a stuck outbox (with and without `code`), and a stale laptop.
- The stale banner does not show while the header reads "reconnecting".
- No "0 waiting" or "0 requests" anywhere.

## Open questions

- **For Peach:** AC3 puts the stuck outbox only on the Laptops card, which is on Sessions. BOB-27
  went 11 h unnoticed because nobody looked. Should a stuck outbox over some age (say 30 min) also
  raise a banner on Overview, like a stale laptop? Designed without it, per the AC; adding it is one
  more `.banner` in `staleBanners()` with the outbox line's text.
