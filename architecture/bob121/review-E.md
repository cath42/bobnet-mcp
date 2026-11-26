# BOB-121 review E: what build E landed (Toad, 2026-11-25)

`ff466f9..421840e` on v2 (Luigi), light review of the code: BOB-183 Status, 184 the Roadmap, 185 Features,
186 a feature's page, 200 review D's minors. Line numbers are at `421840e`.

**Verdict: 0 blockers, 0 majors, 4 minors (one reproduced). Deploy-safe: yes.**

**Deploy-safe line: yes. The broker deploy of the v2 tip `421840e` over the live `8630fe4` adds only page
files (`public/app.js`, `index.html`, `style.css`) and tests; no broker source, protocol, schema or supervisor
change. Rollback is the old page.**

## What I checked

- **Light, confirmed.** `git diff --name-only ff466f9 421840e`: only `packages/broker/public/{app.js,index.html,style.css}`
  and `packages/broker/test-ui/` (tests, shots). `8630fe4..ff466f9` adds one line of
  `product/requirements/dashboard-redesign.md`. I did not check that `8630fe4` is what Cloudflare serves; that is the
  deploy's own check.
- **The dashboard suite, run here once:** 237 passed, 8 files.
- **`app.js`**, all of the diff against the criteria of 183-186 and 200, the broker's status read
  (`board/store.ts:787-1060`), spec §2.5-2.9, ADR 0005 §2 and 0014 §4.
- **`style.css`:** additions and removals only of page classes; the removed `.lane-h` and `.step.next .kind` have no
  use left or are moved below `.kind` so they still win. Phone taps are 44 px or grow by `::after` with `inset: -12px 0`
  (review D m2); the find box is 16 px so iOS doesn't zoom. Nothing that reaches outside `style.css`'s own look.
- **`index.html`:** one line, the nav's Features goes to `#features`. An old `#feature` link still lands: bare
  `#feature` goes to `#features`, `#feature/<ref>` finds its project by prefix (`app.js:3849-3856`, tested in
  `feature.test.ts` "is where an old #feature/<ref> link lands").
- **The new tests** (`roadmap`, `features`, `feature`, `status` and the changes to `dashboard`, `overview`, `project`,
  `usage`): each criterion named in a test title has a test that reads the page, not the code. None covers a change
  while a read is in flight (minor 1).

Found right, by reading: text is all text nodes (`h`, `:74`); evidence links start at `https://github.com/` and the
close's commit is a `sha` by the protocol; reads don't loop on an error (`counted` set on failure, `keptRead`'s `old`);
removed names (`state.inc`, `openCards`, `openLanes`, `lanesOf`, `sessionRuns`) have no use left; 186 c5, a live run's
calls are counted and placed with and without `ctx_even`; criteria states are only `open` and `checked`. BOB-183:
nothing that stops Status opening (`answered_at` null is excluded by the schema CHECK, `schema.ts:198`; `since` is the
reply's `at`; a dropped socket rejects the sent reads). One correction to Luigi's handoff: a feature's page does make a
`usage` read when Weigh is on, a run is live and none is kept (`weightsNow`, `:3088`); it doesn't loop. Harmless.

## Minors

1. **A change while a read is in flight is lost (184 c6). Reproduced.** `roadmapsChanged` (`:990`) marks `d.stale` on the
   kept entry when its page isn't shown, but the read already in flight then replaces the entry with `stale: false`
   (`:1007`, `:1009`). Probe (`/tmp/toadE-probe.test.ts`, not committed): Roadmap shown, a change starts a read, held;
   go to Overview; the board changes and a second `board_changed` arrives; the held read answers with the old copy;
   back on the Roadmap there is **no new read** (lists 4 → 4) and BOB-60 still says "draft · no criteria yet". The copy
   stays old until the project's next change or a reconnect. Fix: in `roadmapsChanged`, when `svc.loading.has(key)`,
   `svc.again.add(key)` whether shown or not (or let `loadRoadmap` keep `stale` if it was set while it read). Also older
   than E: a change during a project's **first** read is missed, since the loop is over `svc.roadmaps`' keys; the same
   `svc.loading` check covers it. Add the probe as a test.
2. **"No feature X in P" can be untrue.** `viewServiceFeature` (`:545-553`): with the roadmap read failed and nothing
   kept, `features` is `[]` and the page says there is no such feature (older than E). New with E: a feature made while
   another page showed is "not found" until its stale roadmap is read again. Fix: say it only when the roadmap is fresh
   and without error; else "Reading the board…" or the error with Retry, as Features does (185 c3).
3. **A change rereads every feature opened in the tab's life** (`board_changed`, `feats.keys()`, near `:4034`): a `get` per
   session with `ctx` each, shown or not. Older than E; it is what 184 c6 fixed for roadmaps. Backlog, not this deploy.
4. **Nits.** An uncounted reread drops `current` and `none`, so the Roadmap draws a moment without CURRENT until its
   own counted read; `render()`'s find path (`:3820`) doesn't write `state.features.text` back into the box, so Show
   all relies on focus having left it (not checked on iOS Safari); a `..` in a handoff path makes a dead GitHub link
   (`reviewEvidence`, `:627` on).

## Rulings

- **Q5, CURRENT on a planned release: Luigi's rule stands.** Spec §2.6: CURRENT is never on a planned release, and the
  Roadmap follows it (`roadmap.test.ts` c3). ADR 0014 §4 may still pick a planned release with work as a project's
  current one; the Overview and a project's page name it as such, the Roadmap doesn't tag it. Not a conflict: §4 says
  which release the work is in, §2.6 what the Roadmap's tag means. No change to the ADR.
- **Q3, an open session of a Done feature: keep listing it.** By ADR 0005 §2 as written it is open (no close), has no
  live run and is quiet over 2 h, so it counts, as does any session nobody closed. Hiding it would hide that a close is
  missing. The cleanup is closing those sessions (Peach, `close_session`), not a page rule.

## Run here

The dashboard suite once at `421840e`: **237 passed, 8 files** (195 s, log `/tmp/toadE2-ui.log`). The probe of minor 1 alone: 1 failed, as it should while
the minor stands. No probe in a browser; the shots are Luigi's and I didn't look at them all.
