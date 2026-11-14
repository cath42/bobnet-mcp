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
17. The overview is the cross-project summary. There is no separate "all projects" roadmap. (Its layout was
    redone in round 1: 31 to 34.)

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
    up a named task, session or feature. (Sharpened in round 1: 35.)
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

## Round 1 with Casper (2026-11-14; his words in Mario's lead/BOB-1-casper-feedback.md)

**Agents on tasks** ("who is working on what right now")
28. **Who is on a task shows on the task's row, live**: a dot (green working, amber waiting on you), name,
    role, state and tokens. It shows on every row of that task in the Feature view: the running session's
    **"Tasks it is on"** (the running session's version of "Tasks it moved") and the board's list beside the
    chain, where the row also names the session (Fixes 2). A row with an agent on it has a green edge.
29. An **"On it now"** card sits under the feature's head, above the Next banner: one line per agent,
    agent → session › task. A phone sees who works on the feature before the chain.
30. The source is what each worker declares at spawn: its session {feature, kind, label} and its tasks.
    Nothing is guessed from briefs. A task an agent is on shows In Progress. Leads and consults declare no
    session; they show only on the Overview, as **Other work** on their project.

**The Overview, redone** (Casper: "the overview looks bad, its not a very good UX")
31. It answers three things in this order: **Needs you**, **Working now**, **Projects**. On desktop and tablet
    the first two sit side by side and Projects runs full width under them. On a phone all three stack.
32. **Needs you** is one line per item that holds work up (kind, the question, project · feature · what it
    holds up), then "N hold work up · M more when you have time →". It's a pointer to the Waits tab, not a
    copy of its cards: no recommendation, no source and no session here.
33. **Working now** lists every agent: name, role, state, tokens, then project › feature › session › task.
    Agents with no session show "Other work (no session)" in its place.
34. **Projects** are full-width rows, not half-width cards. Each has five cells: the project (laptop, lead,
    PO), Release (meter, features done of total), Open now (title clamped to two lines, criteria, who is on
    it), Next (what waits on Casper, then the next Ready feature) and Backlog. At tablet width that's two
    cells per line. On a phone the cells stack, each with its label on the left. The totals strip is gone
    because the rows hold the same numbers.

**Waits on you**
35. **"Holds up" only appears on blocking items.** If an item is needed by a later milestone and holds up no
    work now, it says **"Needed before …"** and stays under When you have time. A-15 says "Needed before the
    demo" and Q-259 says "Needed before rehearsal 2 (49.13)". The rule: anything that says "Holds up" is in
    the first group.

## Round 2 with Casper (2026-11-14; "Round 2" in Mario's lead/BOB-1-casper-feedback.md)

**Context per call, inside a session** (Casper: "one of the strongest features of the old one")
36. Today's Usage chart moves **onto each session card**, running or closed. It isn't a separate tab. The
    card's links row gets **"Context per call · N calls"**, which opens a panel inside the card, under the
    agents and the summary and above the tasks. It is folded by default, because six open charts would bury
    the chain. More than one card can be open at a time, so two sessions can be compared.
37. The panel has today's chart, look and wording. **Whole session** is every call across all its agents,
    with context summed, so the line ends at the session's tokens read. The feature's previous session of
    the same kind is dashed (Fixes 2 against Fixes, Review 2 against Review 1). **One agent** joins its
    runs into one line: calls carry on, a new worker drops to a small context at a dotted line, and the grey
    band is the middle half of earlier runs of that role on the feature. Under the chart is today's table
    with one row per agent: model, runs, calls, peak context, a bar, tokens, and a **Session** total row.
    Clicking a row picks that agent, like today's role rows. Agents rather than roles, because two engineers
    in one build are different lines.
38. A closed session's tokens on its outcome line and a running agent's tokens now come from the same runs
    as the chart, so the numbers agree everywhere.
39. **Phone:** the panel drops the card's side padding and runs edge to edge, so the chart gets about 340
    of 390 px. The line labels move into the key, and the agent switch scrolls sideways. A tap shows the
    tooltip at that call. The table stacks into one small card per agent (runs, calls, peak, tokens) with
    no bar and no model.

**Answering from the dashboard** (Casper: "yes")
40. Every question, action and permission on **Waits on you** has its own button: **Answer**, **Mark done**,
    or **Allow or deny**. The button opens a form inside the item, and only one form is open at a time. The
    **Overview's Needs you** has the same button on each line and opens the same form in place, so Casper
    doesn't have to leave the Overview.
41. **A question:** its options as radio cards, with the recommended one first and tagged *recommended*,
    none picked to begin with, then a text box for his own words. The words are optional with an option and
    are enough without one. **Send answer** is off until he picks an option or writes something. The line
    by the button says where it goes: "Recorded on Q-258 as yours, word for word; Bob, Helix's lead, gets a
    message." The options are the question's own, from questions.md.
42. **An action:** an optional note and **Mark done**. **A permission:** an optional note to the agent,
    then **Deny** (danger) and **Allow**. Casper said yes (round 3).
43. After he sends, a toast with Undo says what was recorded and who got the message, and the item leaves
    its group. It shows under **Answered from here today** at the bottom of Waits on you: the question
    muted, the option he picked, his words in quotes exactly as typed, and "Bob, Helix's lead got a message".
    The Needs-you count and the tab's count drop at once. A review gate (BOB-1 #6) and a bug stay links;
    a review is accepted in conversation.

**Waiting on CI or a long run** (Casper: "how long its been running")
44. An agent waiting on a run gets its own state: **waiting on CI** or **waiting on a run (label)**, with
    how long it has run ("waiting on CI · 12 min"). Its dot is an accent ring, not amber, because nothing
    is Casper's to do.
45. On the session card, the agent shows a **run line**: a small spinner, "Waiting on CI · 12 min",
    the run's name as a link (`CI › e2e (staging) #4812 ↗`, opening the run on GitHub), the source (GitHub
    Actions, repo, branch) and "usually about 10 min". A local run says "run slot on mbp-1: **land**, held by
    Daisy" and what it runs. The same line shows in **On it now**. On task rows the agent's chip reads
    "waiting on CI · 12 min".
46. In **Working now**, the agent's state on the right reads "waiting on CI · 12 min" in accent, with a
    third line that names the run and links to it.
47. A run is **running long** once it passes half again its usual time (the median of that workflow's or
    slot label's recent runs). The line turns amber and says "running long, usually about 12 min". A
    **failed** run turns red and stays until the agent moves on. An agent **queued** for the laptop's run
    slot gets a dashed line naming the holder ("Luigi holds it (e2e, 23 min)"). A run that passes leaves
    the line at once. All four are on `#states`.
48. The two sources, as designed: **any CI running anywhere** for CI (Casper, round 3; the example is a
    GitHub Actions workflow run for the agent's branch or commit, but any CI system counts) and the supervisor's **run slot** for local runs (holder, label such as land or e2e, since).

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
8. **Agent state "waiting on you"** (Howard, waiting on his permission) is derived in the prototype. The
   service needs the supervisor's pending-permission record per worker to show it. Marvin's and Howard's
   session, Fixes 2, and the leads' Other work are *example*. (Toad.)
9. **Answering from the UI**: Casper said yes in round 2, designed in 40-43. Peach still has to change
   waiting-on-casper.md ("This list shows and links"). Toad has to say where an answer is written: on the
   board record once a project has moved, but in Helix's lead/questions.md until BOB-9, which BobNet
   doesn't write today. Toad also has to say how the lead's message is sent. **Permissions** from the
   dashboard: Casper said yes (round 3).
10. **Playwright isn't in packages/broker's devDependencies** (the brief said it was). The screenshots used
   helix-navigator-access's playwright-core 1.63.0, which matches the installed Chromium; nothing installed.
11. **Which CI run an agent waits on** needs a link between them: the agent's last push (branch and commit)
   matched to a CI run (any CI running anywhere, Casper round 3; GitHub Actions is the example), or the agent saying so at a checkpoint. "Usually about N min" needs the
   recent run times per workflow or slot label. Both are Toad's to place. In the sample, Marvin's run
   and Daisy's land are *example*.
12. **Context per call needs each session's runs with their calls' context sizes.** Today's dashboard has
   them for the current session; the steps view wants them for every past session too. Every chart in the
   prototype is *example* data, made from a seed.
