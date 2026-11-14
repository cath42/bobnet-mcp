# BOB-1: what the prototype settles, and what stays open

Daisy, 2026-11-13 (BOB-1.1 #2). The requirements say what the screens need. This says what the prototype
decided where they leave it open, so Casper can accept or correct each one. Casper's words when he accepts
or corrects go in BOB-1's notes (BOB-1 #6), not here.

## Settled by the prototype (Daisy's design, for Casper to accept)

**The steps view (steps-view.md: "the layout is Daisy's")**
1. A feature's sessions are a **vertical chain**, oldest at the top, one card per session, with the **next
   step as the last, dashed link**. Vertical, not a horizontal row of steps: LAND-49 already has six sessions,
   and a vertical chain reads the same on a phone and a desktop.
2. The next step also shows as a **banner at the top** of the feature, so a phone sees what waits without
   scrolling past six sessions.
3. A closed session's outcome is **one line**: need (colour-coded), blockers and majors, then minors fixed or
   tasks sent back, then tasks closed or moved. Then one sentence of summary, then links.
4. **Under each session, the tasks it moved, with the status it left them in** (a task can show under
   Build 1 as In Review and under Review 1 as Done), and their criteria now. Folded except on the latest
   session. The board's current status of every task is in a separate list beside the chain (desktop) or
   below it (folded, on tablet and phone).
5. Tasks no session has touched sit under **"In no session yet"** (LAND-49.13 and 49.14).
6. A **"fixes" session is a build with the label Fixes** in the chain (as Helix records it). Its kind colour is
   build's. Whether "fixes" becomes a kind of its own stays Peach's question (steps-view.md).
7. Session kinds use style.css's existing kind colours (design, build, review, retro).
8. Tokens show on running agents (with context and model), and a closed session's **total tokens** sit last on
   its outcome line, muted (Peach, steps-view 7).

**What shows at phone width**
9. Tabs scroll sideways (as today); **Waits on you comes second**, so its count is never off-screen.
   **+ Capture** stays in the header on every screen.
10. Roadmap rows become cards (style.css's `table.stack`). **Done features in a release fold into one row**
    that names their order numbers, once there are more than three: R1's 21 done features would otherwise
    push the open work 800 px down.
11. Done rows show only number, id and title on a phone.
12. Capture and the close-release confirmation are **bottom sheets** with full-width buttons; capture's text
    is 16 px so the phone doesn't zoom.
13. The feature's full task list folds below 1100 px (it repeats the chain's tasks).

**The roadmap and overview**
14. Releases are numbered in their order and features in theirs; a feature with no order on the board gets an
    italic number (Peach, roadmap-view 3).
15. The **open feature** has a green edge and "nobody on it now" when no agent is. Here open means "has
    sessions and isn't Done": LAND-49 is open though Helix's file says Ready (see open point 2).
16. Per release: backlog items, open bugs and oldest age, linking to the triage list (roadmap-view 7).
17. The overview is the cross-project summary: one card per project with its open feature, next Ready
    feature, waits on Casper and backlog. There is no separate "all projects" roadmap.

**Casper's gates**
18. Gates sit behind **Edit your gates** (roadmap and triage), not always on: the roadmap is mostly read on
    a phone, where a stray tap shouldn't move a feature.
19. Each change **saves at once with Undo** in a toast, rather than a Save step. A moved feature goes last in
    its new release; the PO orders it.
20. Closing a release with open features: a dialog names each one, with a select for where it goes
    (default: the next open release). (Peach, board-writes 5.)
21. A closed release stays on the roadmap, folded, and can't receive features.

**Waits on Casper**
22. Two groups, **Holds work up** and **When you have time**, each oldest first. Blocking means it holds
    up a named task, session or feature.
23. A session closed with `need: casper` shows **on the question it waits for**, not as a second item
    (LAND-49's fixes session on Q-258).
24. Kinds: question, action (A-n, Peach), review gate, permission, bug · blocks use.

**Triage and capture**
25. Triage list: **bugs first, then oldest first**; 25 rows, then "Show all". Totals: items, bugs, oldest,
    median age, captured this week.
26. Triage actions (slot, make a feature, drop) aren't on Casper's dashboard: they're the PO's (board-writes).
    Casper's gate on an item is its release.
27. Capture: one text field, project preset from the screen, then optional **Bug**, which adds **where**
    (staging, production) and **blocks use**. The first sentence becomes the title; the whole text is kept as
    Casper's words.

## Settled with Peach during this task (2026-11-13; in the requirements, eba0a15)

- A Done feature shows its real criteria count with "Done, criteria not ticked" (roadmap-view 4).
- A-n actions are on the waits-on-Casper list as kind "action" (waiting-on-casper 1).
- Features with no order follow the ordered ones by id, still numbered (roadmap-view 3, migration 3).
- "Release scope" is features and backlog items in or out of a release, the order of releases, and closing
  one; no text editing (board-writes 4).
- Closing with open features needs a confirmation naming each and where it goes (board-writes 5).
- A closed session shows its total tokens (all its agents, plus the orchestrator's share where known),
  secondary, after the outcome (steps-view 7).

## Open points

1. **Session outcomes have no source yet.** LAND-49's six sessions are transcribed by hand from close
   handoffs and git log. Build 2, Review 2 and Fixes have no close file in Helix's handoffs at all. The chain
   needs Toad's structured session close (need, blockers, majors, tasks moved, handoff link) before it can be
   built. (Toad; steps-view 2.)
2. **"Open" isn't on Helix's board.** LAND-49 has had six sessions and its file still says Ready. The prototype
   derives open from sessions. The service has to keep it (roadmap-view 9, board-writes). (Peach, Toad.)
3. **Criteria are rarely ticked on Helix.** Many Done features show low counts (LAND-22: 3 of 138, LAND-35: 3 of
   39), so criteria are a weak progress measure on today's data. Shown as it is (Peach's ruling). Worth raising
   with Picard before the migration.
4. **Nothing in the sample marks a bug "blocks use", records a pending permission, or counts a session's
   tokens.** All three are shown as *example* (the bug is shaped on LAND-49.20); the token figures are
   placeholders until the service reads BobNet's run records.
5. **One laptop only.** Both real projects run on mbp-1, so the prototype can't show two laptops. Envision,
   Echo and Vitals aren't in the sample.
6. **"Fixes" as a session kind** stays Peach's open question (steps-view.md); shown as a build labelled Fixes.
7. **Playwright isn't in packages/broker's devDependencies** (the brief said it was). The screenshots used
   helix-navigator-access's playwright-core 1.63.0, which matches the installed Chromium; nothing installed.
