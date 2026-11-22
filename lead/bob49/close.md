# BOB-49: close (Mario, 2026-11-22)

need: none. Release: **v2.0.0-rc.51** (0884df3, tag pushed) for poe to roll to mbp-1 and ubu1.

## What is live
- Broker deployed twice from clean trees: 9a25376 (build A + review A's B1/M1, migration 7; version b5d6ad4c),
  then 03c52f4 (build B's store/export and dashboard, Toad signed off; version 9eb4316a).
- Supervisor half (reads `Fixes:` at land, sends `release_tag` after an upgrade, forwards `board_notice`, the
  router's lead text, `keep`/`withdraw` in the MCP tools): live only once rc.51 runs. Until then workers can't
  call keep or withdraw (Toad, review-B m1), so roll it soon.
- BOB-49's own rc sends no release_tag (the old supervisor installs it); "in <release>" shows from rc.52 on
  (review-B m2).

## Sessions and files
design A (lead/bob49/design-close.md), build A + B (build-close.md), review A (review-A-close.md), review B
(architecture/bob49/review-B.md, signed off, no findings to build), accept (Peach). ADR 0011,
architecture/bob49/build-brief.md, design/BOB-49/spec.md.

## For poe
1. Roll v2.0.0-rc.51 to mbp-1 and ubu1 (`upgrade_supervisor`; my handoff is current, `restart: now` is fine).
2. Expect a one-time burst of "has waited a day" notices at the broker's first hourly alarm (already running
   since the deploy): every Waits row unchanged for over a day, once, to its owner. Each owner can `keep` (with
   why), edit or `withdraw`, but only after rc.51 is live on their laptop.
3. Check with `board_grants` that each project's lead (Helix's Bob, Athletic's Phelps, Vitals' Vita) has
   `questions`.
4. Send each of those orchestrators these lines for their lead's prompt, with their own prefix in the example:

> Ask Casper on the board, not only in your session. When you need his answer before work can go on,
> call `board_ask` with the question, your options (mark the one you recommend), context, and
> `holds_sessions` for the session that waits on it (or `holds` for the items). Then end your turn;
> you may also say the question in your reply. A question asked only in plain text doesn't show on
> his dashboard. If he answers by typing in your session, record it at once with `board_ask answer
> { ref, key, words }`, his words verbatim. If BobNet tells you a question of yours has waited a day
> unchanged, `keep` it with why it still stands, edit it, or `withdraw` it. A commit that fixes a bug
> ends with the trailer `Fixes: <REF>` (e.g. `Fixes: LAND-312`), so the board marks the bug for your
> PO to close.

5. AC3's last evidence: the first real lead `board_ask` with `holds_sessions` seen on Needs you on the live
   dashboard. Tell Peach (or me) its ref; she checks AC3 and closes BOB-154.

BobNet's own lines are in lead/CLAUDE.md ("Asking Casper"), the `Fixes:` rule in CLAUDE.md (6f8af40).
