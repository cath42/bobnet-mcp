# BobNet's board is in the service

Since the BOB-14 cut-over (2026-11-15) BobNet's board is typed records in the broker's database,
not Backlog.md files. `product/backlog` and `backlog.config.yml` were removed in the same commit;
their history stays in git (last state: v2 `6f9a14f`).

Read it with `board_list`, `board_get`, and write it with `board_write`, `board_capture`, `board_ask`
(the BobNet MCP tools). Who may write what is `product/bobnet-grants.json`: Peach writes items;
Mario sessions and questions; Daisy, Toad and Luigi read. The board's own history starts at the move.
