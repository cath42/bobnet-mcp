# BOB-212 review B close, and the R3.1 gate (Mario, 2026-11-28)

The last session of R3.1 (board R9). Code reviewed: v2 a461b23..e269120 (build B's 8 tasks).

## Built

- **Reviews:** Toad, [architecture/reviews/bob212-review-B.md](https://github.com/cath42/bobnet-mcp/blob/v2/architecture/reviews/bob212-review-B.md):
  0 blockers, 0 majors, 4 minors, "deploy: go". Daisy, [design/BOB-212/review-B.md](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-212/review-B.md):
  pass, 0 majors, 4 minors. With no majors, no fix tasks were needed inside the review.
- **Accepted (Peach):** BOB-241, 242, 233, 243, 234, 235, 236 and 244 are Done, and none was reopened. BOB-212's criteria
  are all checked on review evidence, and BOB-212 is Done. BOB-211 was already Done (2026-11-26).
- **Land fix (mine, as lead):** Toad's land failed on a supervisor hook timeout under load, the third such flake.
  `packages/supervisor/vitest.config.ts` now gives every test and hook 30 s. It landed with Toad's review at 78222ff.
- **Broker deployed** from v2 78222ff in poe's window (version 9bcd6c80-082a-4b94-85cb-39ef3ea74da6). Checks: both
  supervisors reconnected, board reads and writes work, everything sits behind Access.
- **rc.59 tagged and pushed:** v2.0.0-rc.59 = 671e190. It is rc.58 plus build B, the lockfile-binary test and the
  supervisor timeouts, with no lockfile change. poe rolls it to ubu1 first, then to mbp-1 at a clean point.

## Left

- 8 minors, in the backlog with no release: BOB-245 to BOB-248 (Toad), BOB-249 to BOB-252 (Daisy). Details are below.
- Casper's live look at the R3.1 gate (below).

## Next

- R3.1 waits for Casper's gate. Nothing in R4 has started.

---

## R3.1 gate

**R3.1 "Usage drill-down and project docs" is complete: 2 of 2 features Done.** These were your two follow-ups to
R3. R9 is not closed on the board: closing it is your approval. Nothing in R4 starts until you approve R3.1 and
review R4's scope.

**See it:** the live dashboard, https://bobnet-broker.casper-cth.workers.dev (broker version 9bcd6c80, deployed
2026-11-28; sign in as usual).

### What R3.1 delivered

| Feature | In plain words | Read |
|---|---|---|
| BOB-211 | **Usage, from a bar to its agents.** On Usage, click a session's bar to see which session it is and which agents ran in it, the tokens each agent spent, and each agent's context per call as a graph. | [spec](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-211/spec.md), [Daisy's review A](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-211/review-A.md) |
| BOB-212 | **Each project's library in BobNet, and the project menu back.** The project menu (menu A, your Q-23 "Its fine") is back: the "<Project> ▾" button first in the header lists every project with a Library link; each project's page now has Work and Library tabs. A project's library is read from its repo's main by the supervisor on the laptop, with no new credential, and the repo stays the source. The architecture page draws LikeC4 diagrams you can zoom and drill. The data model page shows Liam ERD as is, as you chose ("Liam as is", Q-23). Both run in sandboxed frames. A standard (ADR 0017) says how a project writes its library. | [spec v6](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-212/spec.md), [ADR 0017](https://github.com/cath42/bobnet-mcp/blob/v2/architecture/decisions/0017-library-standard.md), [author's guide](https://github.com/cath42/bobnet-mcp/blob/v2/architecture/library-standard.md), [shots](https://github.com/cath42/bobnet-mcp/tree/v2/packages/broker/test-ui/shots) (bob212-*) |

### What to look at (about five minutes)

1. Open https://bobnet-broker.casper-cth.workers.dev/#project/bobnet/library, then open the **BobNet ▾** button, first
   in the header. You should see every project, each with a one-line description (or "Library not written yet") and a
   Library link. That is menu A, as in [the menu shot](https://github.com/cath42/bobnet-mcp/blob/v2/packages/broker/test-ui/shots/bob212-17-menu-1280.png).
2. Look at the library page itself. **No real project has a library written yet**: converting Helix's, Vitals' and
   BobNet's own are separate backlog items (BOB-237, 238, 239). So this page shows "BobNet has no library on main yet", with seven
   "Not written yet" cards, each with its file and owner, as in [the no-library shot](https://github.com/cath42/bobnet-mcp/blob/v2/packages/broker/test-ui/shots/bob212-15-no-library-1280.png).
   A filled library is the Toolshed sample in the shots: [architecture](https://github.com/cath42/bobnet-mcp/blob/v2/packages/broker/test-ui/shots/bob212-03-architecture-1280.png),
   [data model](https://github.com/cath42/bobnet-mcp/blob/v2/packages/broker/test-ui/shots/bob212-27-data-1280.png), [phone](https://github.com/cath42/bobnet-mcp/blob/v2/packages/broker/test-ui/shots/bob212-27-data-390.png).
3. If you can, do the same on your phone.

### Known and not in R3.1 (so you can judge it)

- **Liam ERD's text is in Times, not its own font** (BOB-249). The frame's security policy blocks the Google Font
  Liam asks for. The fix is to vendor the font into BobNet. It shows only on a data model page, so no live page shows
  it until a project has a data model.
- Other minors (BOB-245 to 248 Toad, 250 to 252 Daisy) are hardening and wording: a viewer opened on its own address
  isn't sandboxed, two vendor files are cached as immutable, one oversized blob is reported as an older broker, an
  empty data model shows as an error, the fail card's font and its "on GitHub" wording, and the header pill's shape at
  390. None makes a page unusable.
- Libraries for real projects: BOB-239 (BobNet's own), BOB-237 (Helix), BOB-238 (Vitals, held).

### Next: R4 "Runs without you" (planned, waits for you)

Goal: work goes on through the night, lands don't fail on a busy laptop, and poe changes a laptop's config without
your hands. Features: BOB-188 (resume after a usage limit resets), BOB-190 (lands fail only for real; run the land
hook on another laptop), BOB-158 (poe edits another laptop's supervisor.yaml remotely).

**Recommendation:** approve R3.1 (close R9), then R4 in Peach's order, BOB-188 first. BOB-190 matters more after
today: lands failed three times on timeouts under load in this release. Separately, if you want to see a real
library live soon, have Peach slot BOB-239 (BobNet's own library) where you like; it is writing work, not code.
