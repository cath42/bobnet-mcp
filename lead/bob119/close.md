# BOB-119 build A: close (Mario, 2026-11-21)

- Built by Luigi in 3deb1e6 and reviewed by Mario (broker store, client, phone screenshot). The criteria map to tests as Luigi
  listed them: broker board.test "editing an open question or action (BOB-119)" covers AC1-5; client board.test
  board_ask edit covers AC6; dashboard.test BOB-119 tests and shots bob119-* at 390 and 1440 cover AC4 and AC7.
- Nit (not a finding): on Waits, with an action's history expanded, "edited ×n" sits under the button rather than on
  the meta row.
- Broker deployed from a tree with the same broker code as 3deb1e6: version bf8f3ff7-2528-4a02-a62b-8c31dd0c7265
  (poe's window, m_0f363615).
- Supervisor release v2.0.0-rc.47 at 3789893 on origin/v2, tag pushed. Notes: lead/bob119/rc47-notes.md.
  poe rolls it to the laptops.
- Land flakes: three loaded runs (load 16-25, the land CI runner and its VM) failed timing tests. Three bounds got
  room under BOB-117's rule: a13984f (scale per-read 250 -> 1000 ms) and 6a38143 (withHandoff 50 -> 250 ms; the BOB-91
  archive test 30 s).
- Open: none. Next: Peach accepts BOB-119 against its criteria.
