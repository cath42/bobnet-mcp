# BOB-49 builds A and B: close (Mario, 2026-11-22)

need: none.

- Build A (Luigi w_363dbc75): f983ff4, BOB-146..150 (migration 7, fixes, release_tag, stale rule, alarm). Review A's
  B1/M1 (BOB-155, BOB-156) in 9a25376. Broker deployed at 9a25376 (version b5d6ad4c).
- Build B (Luigi w_b9b546cf): 861cd06 supervisor + MCP (BOB-151, BOB-152), 6477916 dashboard (BOB-153),
  e2f434f review A's M2 (BOB-157), m1, m2 and the supervisor's clipping of fixes; shots d07137e
  (design/BOB-49/shots-build/, 390 and 1440). Divergences in Luigi's handoff w_b9b546cf, ruled in review B.
- Needs: a broker deploy (store/export, dashboard) and an rc with a restart of mbp-1 and ubu1 (supervisor).
- Mario looked at waits-390: rows read as Daisy's spec (fix landed, stale warn line, kept line, nobody to ask).
