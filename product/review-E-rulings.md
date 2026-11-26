# BOB-121 review E: what goes in the fix pass, what waits (Peach, 2026-11-25)

Sources: Toad `architecture/bob121/review-E.md` (0/0/4), Daisy `design/BOB-121/review-E.md` (0/0/25).
Both: deploy-safe, no blockers or majors. Ruling rule: a fix goes before the deploy when it shows Casper a
false statement, a wrong clock, or text he can't read; everything else follows once the deploy has been looked at.

## 1. Luigi's fix pass, before the broker deploy (9 minors)

| From | Minor | Why now |
|---|---|---|
| Toad m1 | `roadmapsChanged` loses a change that arrives while a read is in flight (reproduced; also a change during a project's first read). Fix as Toad says (`svc.again` when `svc.loading.has(key)`), add his probe as a test | 184 c6 says the Roadmap follows a change; today it can stay old until the next one. Casper would see a stale "draft" |
| Toad m2 | "No feature X in P" said while the roadmap is unread, failed, or stale | Untrue statement; the same thing AC9 forbids on Features. Say it only when the roadmap is fresh and without error; else "Reading the board…" or the error with Retry |
| Daisy m1 | Two clocks (24 h vs 12 h) | `clock` with `hourCycle: "h23"`, feature page dates through it |
| Daisy m2 | Open badge beside "draft · 5 of 11 criteria left" | Contradicts itself; spec §2.6 now says open words win |
| Daisy m3 | Phone Features: filters wrap, "Done 15" alone | Phone layout of a main control |
| Daisy m5 | "build 2 ›" with nothing after it | One condition |
| Daisy m18 | Roadmap, first read failed: "0 releases · 0 features" and "has no releases yet" | Untrue, same class as Toad m2: error and nothing read means banner and Retry only |
| Daisy m19 | Contrast of draft/planned badges and "All done: waiting for your close" under 4.5:1 | On every Roadmap and Features row |
| Daisy m22 | Phone taps under 44 px (switch, filters, Edit your gates, fold, History, span bar, summaries) | Phone is a ground rule; one rule block at ≤520 (with m3) |

These nine are one task, BOB-202. Acceptance: Toad's probe as a test, the dashboard suite green, shots at 390 of Features
(filters one row), a failed Roadmap and a missing feature, and the contrast pairs measured.

## 2. Later, as board tasks (Draft, under BOB-121; slot after the deploy has been looked at)

- **BOB-203, words and numbers** (Daisy m9, m10, m13, m14, m15, m23, m24; Toad nit 3, a `..` in a handoff path): one wording
  for findings ("no findings"), "moved n tasks" only when n > 0, `day()` for a closed release, Backlog health "OK" only
  when it is, the ref once in What's stuck, one age wording, no empty "Nothing stuck" body, "Vitals' board", no dead
  GitHub link for a `..` path.
- **BOB-204, layout** (Daisy m4, m6, m7, m8, m11, m12, m16, m17, m20, m21): phone row heights on Features, the session
  card's agent lines dropped (the table only), raw or weighed tokens said alike, feature page phone spacing, fixed
  columns on the Roadmap, Edit your gates on a phone, the ▶ on "What's factored", margin under `.unticked .note`,
  `overflow-wrap: anywhere` on release names, Retry and "‹ Helix's features" on a failed or unknown feature page.
- **BOB-205, reads** (Toad m3, nits 1 and 2): a change rereads only the feature page in view, not every one opened in the
  tab's life; an uncounted reread keeps `current` and `none`; the Features find box takes its text back (check on iOS
  Safari).

## 3. Dropped

- **Daisy m25** (the sticky criteria box's count scrolls out of its own scroll at ≥1100): it works; the box scrolls on its
  own and 28 criteria is far from usual. Reopen if Casper meets it.

## 4. Spec and the rest

Toad Q5 (CURRENT on a planned release: Luigi's rule stands) and Q3 (keep listing an open session of a Done feature)
need nothing from me. Q3's cleanup is done: the twelve forgotten sessions are closed (BOB-33's ten, BOB-14 `cutover`,
BOB-48 `accept`; seq 10778 to 10792). Daisy's spec edits in §2.6 are in her land. Daisy's rulings on Luigi's questions
stand (picker gone, Close R1 outside Edit your gates, "waits on you: Q-6", inline links under 44 px may stay, doubled
"ready ready" stays).

## 5. Build E's tasks

BOB-183, 184, 185, 186 and 200 were Ready; review E passes them. They move to **In Review** now and to **Done only
after the deploy and a signed-in look at production** (183 c1 and c4 need production data; AC5 on Helix's board, 179 c3,
likewise). BOB-202 goes into the fix pass before the deploy. Nothing of R4 or later starts: a PO closing R3 is not
Casper's approval (his rule, 2026-11-25).
