# BOB-31: `WaitRecord.context`, ruling

Toad, 2026-11-15. On Daisy's spec `design/BOB-31/spec.md` (8864520), "For Luigi", Data.

**Verdict: agreed, as specified, with two precisions.** No ADR needed beyond a sentence in ADR 0001's
view reads; no schema change, no migration.

## Shape

`WaitRecord` (`protocol/src/board.ts:468`) gets, after `recommended`:

```ts
/** The question's or action's context, whole (≤ 16 KB); null when it has none, and for a review gate or a bug. */
context: string | null;
```

Always present (not optional): the broker is the only producer and the dashboard ships with it.

## Where it's filled from

`QuestionRecord.context`: the `ask` op's `context` field (`board.ts:304`, `text`, ≤ 16 KB), stored in
`questions.context`. `store.ts waitsOf` already calls `questionRecord(pk)` for each open question, so it
is `context: q.context` with no extra query. `itemWait` sets `context: null` (a gate's or bug's
description is not a question's context; the item view has it).

Precision 1: **blank is none.** `ask` doesn't trim `context`, so fill it as
`q.context?.trim() ? q.context : null`. The dashboard then offers Show context exactly when
`w.context` is truthy, and never opens an empty block.

Precision 2: **the dashboard reads it as possibly absent** (`w.context ?? null`), so a dashboard
served against a broker without the field shows no button rather than failing. They deploy together,
but it costs nothing.

## Why the whole text, not a `has_context` flag

`waits` is read on the Overview and refetched on `board_changed` (`app.js` `loadOverview`), not
polled. Open questions are few at a time; the worst case is their count × 16 KB, and in practice
contexts are a paragraph or two. A flag would save bytes only by adding a `get` round trip on every
Show context, and the spec's link from the Overview opens it straight away. If a project ever holds
dozens of open questions with long contexts, revisit: `has_context: boolean` plus a `get` on open,
which is additive too.

## Compatibility

Additive on a result type: an old dashboard ignores the field. `waits` isn't one of the agents' MCP
tools, so no agent's context grows. `overview` doesn't carry waits and is untouched.

## ADR 0001

§ "The view reads", the `waits` bullet gains: a question's or action's wait carries its `context`
(null when blank), a review gate's and a bug's carry null. Amended in the same commit.

## Open question 1 (permission text cut at 400, no options)

Not BOB-31's, agreed. Sending a permission's whole question and options is a supervisor → broker
snapshot change (`supervisor.ts preview()`, the permission frame). It wants its own item and, when
built, an additive optional field on the permission record; I'll rule on its shape when Peach slots it.

## Tests Luigi adds (broker store)

A question with a context: its wait carries it whole; one with none, or whitespace only: null;
a review gate and a bug: null.
