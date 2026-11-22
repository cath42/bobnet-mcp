# BOB-6: Start a session from the feature page, spec

Daisy, 2026-11-22 (session `BOB-6 design A`). From a feature's page, Casper asks for its next session
(design, build, review, retro). BobNet fills in the brief, he may edit it, he confirms, and the request goes
to the supervisor that runs the project, who starts it or says why not. Luigi builds from this file and the
prototype (`prototype/index.html`; tasks 14-17 of `architecture/bob6/build-brief.md`).

Sources: BOB-6 AC1-AC4, `product/requirements/start-session.md`, ADR 0010
(`architecture/decisions/0010-start-requests.md`: `start_options`, `start_request`, `withdraw_start`,
`decline_start`, the reason sentences, the brief). Where this spec says what the service sends or refuses,
ADR 0010 rules; this file only says how it looks.

**Words.** The project's declaration is its **start rules** (ADR 0010), never "gates" on screen: "gates"
on the dashboard are Casper's own (Edit your gates). The request is a **request**, its ref `S-n`. The
supervisor is named by its address, `poe@mbp-1`, with the laptop always shown (it is where the request
goes; BOB-44's `.lap` span, muted, warn when offline).

## Where it lives

One place: the feature's page (`#feature/<project>/<ref>`), in two spots that say the same thing:

1. **The Next banner** at the top (today's `nextBanner`). It keeps its text ("Next · a build session")
   and gains the primary **Start** button on its right. On a phone it is a full-width 44 px button under
   the text, so Start is above the fold on 390 px.
2. **The Next card** at the end of the sessions chain (today's `nextItem`). It holds every kind that may
   start, where the request goes, and why the others can't.

Start is nowhere else (not the roadmap, not Status, not Overview). Casper's words in the requirement: "from
a feature in the steps view".

## States of the feature page

The page reads `start_options { project, ref }` with the feature, and again on `board_changed` for the
project. Each kind in `kinds` is either `ok` or carries `code` and `reason`. A kind the project doesn't
offer is absent and shown nowhere.

### 1. Start offered (shot `s1-offered`)

- **Banner:** `Next · a build session` and the button **Start build A**.
- **Next card** (`step next`, dashed accent, as today), under its title:
  - one button per `ok` kind: **Start build A** (primary), **Start design B** (plain). The label is
    the service's proposal (`kinds[].label`). The primary is the kind the Next line names (`nextOf`:
    design → "a build session" → build) if it is ok, else the first ok kind in `kinds` order.
    Phone: the primary is full width, the others share a row; all 44 px.
  - `Goes to ● poe@mbp-1, who decides who runs it.` The dot is the supervisor's presence (green
    online, grey offline). Offline: `Goes to ○ poe@mbp-1, offline now: it gets the request when it is
    back.` in warn.
  - **Not now**: the refused kinds' `reason` sentences, verbatim, as a muted list under a rule, the Next
    kind's first, each sentence once. A ref in a reason (`LAND-56`, `Q-140`) is a link to that item or
    question.
- Start never moves status, release or order (must-not-break). The page's foot note says so once.

### 2. Nothing may start (shots `s2-limit`, `s3-held`, `s13-no-supervisor`)

When no kind is `ok`:

- **Banner:** `Next · a design session` and, where the button would be, `can't start: <reason>` in
  muted text, the reason of the kind the Next line names (Helix: "helix allows one open feature at a time:
  LAND-56 is open", with LAND-56 a link). On a phone it wraps under the text.
- **Next card:** **Can't start a session now** in bold, then the reasons, one per line (a single reason is
  a sentence, not a one-item list). No disabled buttons: a disabled button is a target on a phone that
  does nothing.
- **Held by his own question** (`code: held`): the banner stays today's amber "Next: waits on you · Q-140
  …", since that is his to do; the card adds "BOB-19 is held by Q-140" with Q-140 a link to answer it.
- **No supervisor** (`start_options.supervisor` null): the one reason is "no supervisor runs bobnet",
  whatever the kinds say.
- **Done feature:** no Next card at all, as today; nothing to start.

### 3. The pending request (shots `s8-pending`, `s9-pending-offline`): AC4

While `start_options.pending` (or the feature's `requests`) has one in state `pending`, the page shows it
instead of Start. There is at most one per feature, so no Start buttons show (ADR 0010 `pending`).

- **Banner:** `Requested · build A · waiting for poe@mbp-1 to start it` (accent edge). Supervisor
  offline: `Requested · build A · poe@mbp-1 is offline; it gets it when it is back`, the second half in warn.
  Tapping it scrolls to the card, like today's banner.
- **The card** takes the Next card's place in the chain: dashed, its dot dashed in the kind's colour.
  - Top: `REQUESTED  build A  S-7  sent 10:20` and a badge `requested` (accent), or `supervisor
    offline` (warn).
  - `Waiting for ● poe@mbp-1 to start it. It decides who runs it.` Offline, in warn: `○ poe@mbp-1 is
    offline: no report since 09:12. It gets your request when it is back; nothing is lost.` Online or
    not comes from the presence the dashboard already has; "no report since" is the laptop's last report.
  - `Sent by you at 10:20 · brief edited by you · 1,106 characters` (or `BobNet's brief`).
  - A fold, closed: **The brief you sent**, opening to the text verbatim in today's `pre.handoff` box.
  - **Withdraw request** (plain button; full width on a phone). It asks first (dialog below).
  - Muted: `One request at a time on a feature: withdraw this one to ask for another kind.`
- No "delivered" state and no expiry (ADR 0010 §5): it is pending until one of the three below.

### 4. Declined (shot `s10-declined`)

`state: declined`, with `reason` and `resolved_by`.

- **Banner** (grey edge, not amber: nothing waits on him; not red: nothing failed): `Declined · build A ·
  poe: "Luigi is on BOB-44 until rc.51 ships, about an hour. Ask again after that."` and the Start button
  again.
- **Next card:** back to state 1 or 2, with a line at its top, grey edge: **poe@mbp-1 declined build A**
  (S-7) at 10:31: *"<reason>"*.
- **Starting again opens the editor on the brief he sent**, not BobNet's fresh one, with "Your brief from
  the declined request" in the editor's status line and **Use BobNet's brief** beside it.
- The line stays until the next request or session on the feature replaces it (the newest of `requests`).

### 5. Withdrawn (shot `s12-withdraw` is the dialog)

Same as declined, without a reason: the Next card's top line reads `You withdrew build A (S-7) at 10:26;
poe was told.` in muted text, and Start reopens the editor on his brief. No banner change: the banner is
Next as in state 1.

### 6. Started (shot `s11-started`)

`state: started`, with the session. The request becomes the new session in the chain, which is how the page
already shows a running session (agents, On it now, the running badge), plus one muted line in that
session's card:

`From your request S-7: sent 10:20, started 10:24 by poe@mbp-1. Brief edited by you.` and the fold **The
brief you sent**.

- If poe started it under another label (ADR 0010 §5: the label need not match), the line reads `From your
  request S-7 for build A: started as build B, 10:24, by poe@mbp-1.`
- The Next banner and card move on as today ("a review session, once build A closes").

### History

ADR 0010 writes each request's life as board events. The History section shows them in its usual form:
`Casper asked poe@mbp-1 to start build A (S-7)`, `poe@mbp-1 declined S-7: "<reason>"`, `Casper withdrew
S-7`, `S-7 started as build A`. Older requests than the newest are only here.

## The brief editor (shots `s4-editor`, `s5-edited`, `s5-label-taken`): AC2

A page of its own, `#feature/<project>/<ref>/start/<kind>`, not a dialog: the brief is a page of text and
a phone keyboard leaves a dialog no room. Back (browser or `‹ BOB-6`) and **Cancel** return to the feature,
keeping his draft on this device for that feature and kind until he sends it or leaves the dashboard.

From the top:

- `‹ BOB-6  <title>` (back link, muted title).
- `START A SESSION` (h2 style), then **BOB-6 build A** big, and the project muted. It follows the kind
  and label as he changes them.
- **Session:** a segmented switch of the ok kinds (Design · Build), the chosen one pressed. Switching
  changes the URL, the proposed label and the brief; edits are kept per kind. With one ok kind, it is
  plain text, not a one-button switch.
- **Label:** a text field, the service's proposal filled in, 1 to 40 characters (`maxlength`). Under it,
  muted: `BOB-6 build A. BobNet proposed A.` Errors, in red, replace that line and disable Send:
  - empty: `A label is 1 to 40 characters.`
  - a session of that feature and kind has it (the page has the sessions): `BOB-6 design A already ran.
    Pick another label.` The service checks it again on send (`code: label`; state 7).
  - While the brief is unedited, a new label rewrites it (the brief names the session); once edited,
    the brief is his and a label change leaves it alone.
- **Goes to:** `● poe@mbp-1 · online`, or `○ poe@mbp-1 · offline since 09:12; it gets it when it is
  back` in warn. Offline doesn't block sending.
- A muted note: `Nothing starts until poe starts it. poe decides who runs it and declares the session
  and its tasks, as with any spawn.`
- **Brief:** the service's `kinds[].brief`, one plain text (ADR 0010 §3: feature and title, the session,
  the skill, the last session's close with its handoff *path*, his answers on the feature verbatim, "Read
  the feature first"). A textarea that grows with its text, so the page scrolls, never the box; the
  system font, 14.5 px on a desktop and 16 px on a phone or any touch screen (iOS zooms below 16).
  Under it, one line:
  - `BobNet's brief` (muted), or **Edited by you** (warn, bold) and **Use BobNet's brief** (link-button;
    it restores the service's text, with a toast `BobNet's brief is back.` and **Undo**);
  - on the right, `1,106 of 16,384 characters`; past the cap, in red, `220 characters over the 16,384
    limit`, and Send is disabled.
- **Cancel** and **Send to poe…** (primary; the ellipsis because a confirmation follows). On a phone the
  two stick to the bottom of the screen above the home indicator, each half the width, 44 px; on a tablet
  and desktop they sit under the brief, on the right.

Desktop and tablet (≥ 900 px): two columns, the fields in a 280 px column on the left (sticky), the brief
on the right, on the wide main (1320 px). Phone: one column, fields first, then the brief.

### Confirm (shot `s6-confirm`): AC3

**Send to poe…** opens today's dialog (a bottom sheet on a phone, `dialog` in style.css):

- Title: `Ask poe to start BOB-6 build A?`
- `poe@mbp-1 gets this brief as you wrote it and decides who runs it. Nothing starts until it does, and
  you can withdraw the request until then.`
- If the supervisor is offline, in warn: `poe@mbp-1 is offline now. The request waits for it; nothing is
  lost.`
- Muted: `Sent as Casper · brief edited by you · 1,106 characters`. "Casper" is the owner the dashboard
  is signed in as; his email never shows and never goes in the request.
- **Back to the brief** · **Ask poe** (primary).

**Ask poe** sends `start_request` with a §12 key (a double tap or a resend asks once), then returns to the
feature page, which shows state 3, with a toast built from the reply's `told`, `waiting`, `supervisor`
(ADR 0009 §5):

- told: `Asked: S-7, sent to poe@mbp-1. It starts build A or says why not.`
- waiting: `Asked: S-7, saved; waiting for poe@mbp-1 to come online.`

### 7. Refused on send (shot `s7-refused`)

A start rule changed since the page loaded (Helix: another feature opened), or the label is taken: the reply is
`conflict` with the service's reason. The dialog closes, he stays in the editor with his text and label as
they were, and a red-edged banner sits above the fields:

**Not sent** `helix allows one open feature at a time: LAND-56 opened at 10:18. Nothing was asked; your brief
is still here.` **Copy your brief**

He can change the label and send again, copy the text, or leave. The feature page behind it re-reads
`start_options`, so going back shows the new state.

### Withdraw (shot `s12-withdraw`)

The dialog: `Withdraw the request for build A?` / `poe is told, and won't start it. You can ask again
later; the brief you sent comes back in the editor.` / **Keep it** · **Withdraw** (danger). Then the toast
`Withdrawn: S-7. poe@mbp-1 is told.` (or `Waiting for poe@mbp-1 to come online to tell it.`). No Undo:
asking again is a new request.

### Live changes while the page is open

On `board_changed` the page re-reads. A request that starts or is declined while he looks at it changes in
place, with a toast: `poe started BOB-6 build A.` or `poe@mbp-1 declined build A: "<reason>"` (grey edge,
`data-ok="idle"`, new in style.css). An open editor whose kind stops being ok (another request, a rule) keeps
his text; Send then gets state 7.

## Sizes

| | Phone 390 | Tablet 1024 | Desktop 1440 |
|---|---|---|---|
| Banner Start | under the text, full width, 44 px | right of the text | right of the text |
| Next card buttons | primary full width, others share a row, 44 px | one row | one row |
| Editor | one column; Cancel/Send stuck to the bottom | two columns (280 px fields, brief) | same, wide main |
| Dialogs | bottom sheet, buttons half width, 44 px | centred dialog | centred dialog |
| Brief text | 16 px | 14.5 px (16 px on touch) | 14.5 px |

Dark mode follows style.css's tokens; nothing new (shot `s1-offered-dark`).

## The prototype

`prototype/index.html`, self-contained (its own copy of `style.css`, relative paths, sample data only), for
a static host. Its bar (dashed underline, not the design) lets Casper walk every state by tapping:

- **Scenario**: *Start offered* (BOB-6, after design A), *Helix: one open feature* (LAND-58), *Held by your
  question* (BOB-19), *Refused on send* (LAND-57: Start works, Ask is refused). The Feature picker switches
  them too.
- **Supervisor**: *poe@mbp-1 online*, *offline*, *none runs it*.
- **Then poe**: *starts it*, *declines it*, once a request is pending and poe is online.
- **Reset**.

`proto.css` holds the new rules (everything but `.proto-bar` moves into style.css as one block, "Start a
session"); `proto.js` is the prototype's code, not the build's. Shots: `node design/BOB-6/shots/take.mjs`
(390, 1024, 1440).

## For Luigi

- Render `start_options`; never compute the start rules or word a reason in the dashboard (ADR 0010 §2).
- The label check against sessions is a convenience; the service's `label` refusal is the rule.
- Keep the editor's draft per feature and kind in `sessionStorage`, dropped on a successful send.
- Tests (task 17): offered/refused rendering for bobnet's and helix's rules, the editor's prefill and edit
  flag, conflict keeps the text, pending/declined/withdrawn/started on the page, withdraw.

## Open questions

- **Toad:** does `start_options` return the request's supervisor for a *resolved* request (for the
  "declined by" line), or only `resolved_by`? The spec uses `resolved_by`'s address.
- **Toad:** the page needs the time of the laptop's last report for "offline since 09:12"; the dashboard
  has it from presence today (BOB-44 `staleReport`). If not, the line drops the time.
