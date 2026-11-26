# BOB-121 DoD 3: the question for Casper (Peach, 2026-11-25)

For Mario/poe to ask with `board_ask` (project bobnet; `holds`: BOB-121, BOB-33; `needed_before`: R3 close and R4's start).

**kind:** question

**text:**
The redesigned dashboard is live: Overview, Needs you, Projects and a project's page, Status, Roadmap, Features, a
feature's page, Usage. Do you accept it?

**context:**
You saw the prototype (Q-12, Q-13) and asked for it built. All five builds are live on the broker (build E's fix pass,
BOB-202, at version e2188d27, 2026-11-26 05:50Z). Daisy and Toad reviewed every build: no blockers, no majors.
What is still open is only what needs a signed-in look at production data: Status on Helix's real board (BOB-183),
Projects at a glance showing Helix on R2 (BOB-179), and Needs you's live items (BOB-176). Minors that are not in yet
(BOB-203, 204, 205: wording, layout, reads) are Drafts. Look at the dashboard (Overview, Status, Roadmap, Features,
a project's page, Usage) on your phone and your desktop. Spec and shots: `design/BOB-121/spec.md`,
`design/BOB-121/review-E.md`; review notes: `architecture/bob121/review-E.md`; rulings: `product/review-E-rulings.md`.

**options:**
- `accept` (recommended): R3's last gate for BOB-121 is met; I close the production checks as I see them and
  put the minors in R3's tail or R4 as you choose.
- `accept_with_changes`: say what to change, in your words; they become tasks under BOB-121 before it is Done.
- `not_yet`: say what is wrong; BOB-121 stays open and R3 doesn't complete.

**recommendation:** accept. The criteria that tests and Daisy's shots can meet are checked; nothing found is a blocker.
The open minors are polish, not things that stop you using a page. If you see Status or the Overview wrong on
production, say `accept_with_changes` with what you saw: that is the one place the reviews could not look.

**what it moves:** BOB-121's DoD 3; with the production checks, BOB-33 (Status) and the close of R3. Release gates
stay yours: R3's close and R4's scope are separate questions, asked after this one.
