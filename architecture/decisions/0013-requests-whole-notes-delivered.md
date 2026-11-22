# 0013. A request reaches the dashboard whole, a decision's note is the agent's next message, and the report says what Casper decided

- **Status:** accepted (Toad, 2026-11-22), for BOB-51 (session `BOB-51 design A`), which groups BOB-32 and
  BOB-29. Line numbers are at `4dd8cd9` (origin/v2). The build brief is `architecture/bob51/build-brief.md`.
  Daisy designs the screens (`design/BOB-51/`). §1, §2 and §3 are what my answer to her consult
  c_360a0445 gave her.

## Context

- **A request is cut before it leaves the laptop.** `snapshot()` builds `pending[].preview` with
  `preview()` (`supervisor/src/supervisor.ts:3760-3772`). It takes the first question's text, or the
  command, path or URL, and clips it to 400 characters. `LaptopSnapshot.pending[].preview` is
  `z.string().max(400)` (`protocol/src/frames.ts:185`). An AskUserQuestion's other questions, its
  headers and its options are never sent. This is one path for both of BOB-32's cases. A remote
  worker's request is on the report of the laptop it runs on, built by the same `snapshot()`, and the
  dashboard acts on that laptop directly (`act(p.laptop, …)`, `broker/public/app.js:1577`). The
  spawner's copy (`remote_asks.preview`, the `request` event's 160-character `oneLine`, `:3211`) is for
  its orchestrator's `pending_requests` and never reaches the dashboard.
- **A note sent with Allow is dropped.** The note is carried as far as the router. `Action.answer`
  takes a `message` with either decision (`frames.ts:419`). `onAction` passes it on (`supervisor.ts:2449`),
  and ADR 0007 §4's `answer` op carries it too (`protocol/src/remote.ts:56`, `supervisor.ts:2179`). The
  loss is in `toResult` (`supervisor/src/router.ts:227`), which returns `{ behavior: "allow",
  updatedInput }`. The SDK's allow result has no message field (`PermissionResult`, SDK 0.3.312
  `sdk.d.ts:2585`). The same happens to a message sent with `answer`. `resumeTask` (`supervisor.ts:3905`)
  drops it for an orphan's allow as well. So the dashboard says "a note goes only with Deny"
  (`app.js:1583`).
- **Nothing tells the dashboard what was decided.** The supervisor stores `decision`, `decided_by` and
  `decided_at` (`store.ts:89-93`, `settleRequest` `:415`). The report carries only open and orphaned
  requests (`supervisor.ts:3637`). "Answered from here today" lists board answers only
  (`app.js:1792`, the `waits` op with `since: midnight()`, `:1193`).
- A running worker already takes a message mid-run: `WorkerRun.inject` pushes a user turn with
  priority `next` (`supervisor/src/worker.ts:253`, `InputQueue.push` `:66`). That is how inbox messages
  reach it (`supervisor.ts:1280`).

## Decision

### 1. A pending request carries its whole ask, bounded, on the report

`pending[]` keeps `preview` exactly as it is, at most 400 characters. That way an older broker still
parses the report. Each row gains an optional `ask`:

```
ask: {
  text: string ≤ 8000,          // the whole of what preview cuts: command, file path, URL, or the first question
  cut: boolean,                 // the supervisor clipped a field; a clipped field ends in "…"
  questions: Array<{            // AskUserQuestion only, else []
    question: string ≤ 4000, header: string ≤ 40, multi: boolean,
    options: Array<{ label: string ≤ 200, description: string ≤ 1000 }> ≤ 4,   // an option's own `preview` isn't sent
  }> ≤ 4,
} | null
```

- **The supervisor enforces the bounds.** It clips each field to its maximum by whole code points
  (as `fitRunName`, `supervisor.ts:401`), so the report never fails the broker's parse. The protocol
  states the same maxima, and the broker checks them when it parses the frame.
- **One budget per report.** All the `ask`s together are at most **128 KiB** of JSON. Human-tier rows
  are filled first, then the rest in list order. A row past the budget gets `ask: null`.
- **No credential crosses.** If any field of an ask looks like a credential (`findSecret`), the
  whole ask is `null`. `preview` keeps its own check.
- **The dashboard reads one fallback.** When `ask` is absent (an older supervisor) or `null` (withheld
  or over budget), it shows `preview` as today.
- **Answering a question's options from the dashboard is not part of this.** `Action.answer` stays
  allow|deny. A worker's AskUserQuestion is orchestrator-tier (`router.ts:81`).

### 2. The report says what Casper decided from the dashboard

- **`requests` gains a column, `via TEXT`.** It is `'dashboard'` when `onAction` settled the request,
  and null otherwise. It comes with an index on `(via, decided_at)`.
- **`LaptopSnapshot` gains an optional `decided`.** It holds the requests settled with
  `via = 'dashboard'` whose `decided_at` falls in the last 24 h by the laptop's clock, newest first, at
  most 50:

  ```
  { id, worker_id, name, project, kind, tool, created_at, decided_at, decision: "allow" | "deny",
    preview: string ≤ 400, note: string ≤ 2000 | null }
  ```

  - `note` is Casper's words as he sent them. It is withheld as `preview` is if it looks like a credential.
  - The supervisor sends `[]` when there is nothing. The field's presence also tells the dashboard that
    the laptop's supervisor delivers notes (§3).
- **"Today" is the dashboard's.** It shows the rows whose `decided_at ≥ midnight()` (`app.js:1187`),
  as it already does for board answers. Casper's midnight is never more than 24 h back, so the laptop's
  24 h window always covers it.
- **The broker adds nothing.** It already stores the report whole (`laptop_reports`, `broker.ts:591`)
  and serves it in the `dashboard` reply and the `report` frames. ADR 0012 §2's 30-day sweep covers it.
- **There is no Undo:** a supervisor's answer can't be taken back.
- **The deny message changes when there is no note.** `onAction` now passes a note only when Casper
  wrote one, so that `note` means his words. A deny without one reads "Denied by Casper"
  (`toResult` with `decided_by` `human`) instead of "denied from the dashboard".

### 3. A note with Allow, or with an answer, is the agent's next message

- **Where the rule lives.** `Supervisor.answer` (`supervisor.ts:1081`) is the one place every answer
  passes: the dashboard's `onAction`, the local `answer_request`, and the target side of ADR 0007 §4's
  `answer` op (`:2183`). When it settles a request with `allow` or `answer` and a `message`, it delivers
  the message.
  - **A live request:** after `router.answer` has resolved the waiter, it runs
    `run.inject(line)`. The SDK takes the line as the next user turn, after the allowed call.
  - **An orphaned request:** `resumeTask` puts the same line in the resumed worker's first turn.
- **The line:** `Note from <who> with the Allow of request <id> (<tool>): <words>`. For an answer it
  is "…with the answer to request…". `<who>` is "Casper" when `decided_by` is `human`. Otherwise it is
  the worker's orchestrator: the project's lead, or `remote_by` for a remote spawn. The words are
  verbatim.
- **Deny is unchanged:** its message is the deny result (`toResult`).
- **The result says whether it arrived.** `note_delivered: boolean` is set whenever a note came with
  `allow` or `answer`. It is false when the run's input had closed or the resume failed, and audited
  `note:undelivered`. It is added to:
  - the `action_result` frame (`ActionResultFrame`, `frames.ts:429`, optional; the broker forwards it,
    `broker.ts:728`);
  - the `answer` op's reply;
  - `answer_request`'s result.

  When the field is absent, the target is older and dropped the note. The dashboard and the requester's
  `answer_request` both say "not delivered" in that case.

### Compatibility

Everything here is additive. `ask`, `decided` and `note_delivered` are optional, and the protocol's
objects strip what they don't know.

| | old broker | new broker |
|---|---|---|
| **old supervisor** | as today | no `ask` or `decided`: preview as today, no answered permissions; a note with Allow is dropped and `note_delivered` is absent, so the toast says so |
| **new supervisor** | report parses (preview ≤ 400) and is stored without `ask`, `decided` or `note_delivered`; the old dashboard shows what it shows today | all of it |

For the remote `answer` op, between supervisors of either version: the request already carries
`message`. An older target ignores it and replies without `note_delivered`. A newer requester tells
its orchestrator the note wasn't delivered.

## Consequences

- The report grows by up to 128 KiB of asks and about 130 KiB of `decided` in the worst case. It must
  still fit `LIMITS.boardFrameBytes` (900 KiB) with every list at its maximum. A test pins that.
- A note now reaches an agent that was allowed to go on. An agent's next turn may start with Casper's
  words rather than the tool's result. That is what he asked for.
- `via` is the first record of where a decision came from. `decided_by` stays who decided it.

## Alternatives

- **Raise `preview` past 400.** An older broker would then refuse the whole report (`max(400)`), and
  every laptop on an old rc would drop off the dashboard. Rejected.
- **Put the note in the tool result with a PostToolUse hook's `additionalContext`.** It would be tied
  to the call it was about. But it isn't "the agent's next message" (AC3), and a hook can't reach an
  orphan's resume. Rejected.
- **Report every request decided today.** Orchestrator answers run to dozens a day, and "Answered from
  here" needs only Casper's. Rejected.
- **The dashboard fetches a request's detail on demand.** That needs a new owner→supervisor request
  and reply frame, and only works while the laptop is connected. The report already goes every 3 s.
  Rejected for now.
