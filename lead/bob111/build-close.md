# BOB-111 build A: close (Mario, 2026-11-21)

- Luigi (w_371a34f2) landed c87bd1a: tasks 1-6 of architecture/bob111/build-brief.md. typecheck + test pass.
  Handoff (AC-to-test map): /Users/ct/.local/state/bobnet/handoffs/bobnet/w_371a34f2.md.
- Choices: BoardMessage and BoardReply.messages removed; the four answer ops return told/waiting/supervisor; `lead`
  added to the notice JSON for supervisor resolution (a deviation, additive); a supervisor dedupes in its own
  board_notices table.
- AC4 shots, from the local fake broker: packages/broker/test-ui/shots/bob111-answer-toast{,-nosup}-{390,1440}.png.
- Mario read the broker and supervisor diff: the drain stores under fixed ids before marking taken, and there's no
  await between the store and the mark. Nothing found. Next: review A (Toad).
