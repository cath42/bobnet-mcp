# BOB-44 spike: two laptops on the real broker (ADR 0007 §13)

Luigi, 2026-11-17, BOB-44 design A step 3. Today's code only: hand-written remote.ts JSON sent by
`Luigi@mbp-1` (an agent, never mbp-1's supervisor) to `supervisor@ubu1`, which runs **rc.37**
(`v2.0.0-rc.37`). ubu1's entry, live since 13:23:57Z (Casper's OK, staged by poe@ubu1):
`remote: { "Luigi@mbp-1": { spawn: { athletic: [reviewer] } } }`. The grant came off after the last
send (13:31Z; Mario told).

Every task said: no commits, pushes, PRs, board writes or files except the handoff; `session: null`,
`tasks: []`. Four spawns, not the planned one or two: spawns 2-4 were each an attempt to make the worker
raise a permission request, and none did (§13.4 below). No athletic worker was running before,
between or after.

## The log

Times are UTC and coarse: the harness doesn't timestamp incoming messages, so a reply's time is "seen
by" the next `date` I ran. Every reply below reached me before my next tool call returned, and none
took more than ~2 s. Each send's result was `"delivered_to": ["supervisor@ubu1"], "queued_for": []`.

| Sent | Request (verbatim) | Reply / event (verbatim) |
|---|---|---|
| 13:26:25 `m_d5632184` | `{"op":"spawn","project":"athletic","role":"phelps","task":"BOB-44 spike: this spawn should be refused (role not in the remote entry)."}` | `m_82250496`, re `m_d5632184`: `{"ok":false,"op":"spawn","error":"Luigi@mbp-1 may not spawn athletic/phelps; it may spawn athletic/reviewer"}` |
| 13:26:25 `m_c7b844f5` | `{"op":"spawn","project":"athletic","role":"reviewer","task":"BOB-44 spike: this spawn should be refused as a bad request (handoff).","handoff":"/tmp/x.md"}` | `m_4a086246`, re `m_c7b844f5`: `{"ok":false,"op":"invalid","error":"bad request: op Unrecognized key: \"handoff\""}` |
| 13:26:25 `m_2d14eb45` | `{"op":"list"}` | `m_ed9f54da`, re `m_2d14eb45`: `{"ok":true,"op":"list","workers":[]}` |
| 13:26:47 `m_376db3a1` | spawn 1 (as below) **without** `tasks` | `m_4642377d`, re `m_376db3a1`: `{"ok":false,"op":"spawn","error":"athletic has a board: say which items this worker works on or reviews, tasks: [\"LAND-41.3\", …] (a feature id for the feature as a whole; [] for none)"}` |
| ~13:27:00 `m_5de5ebc7` | `{"op":"spawn","project":"athletic","role":"reviewer","tasks":[],"session":null,"effort":"low","task":"BOB-44 spike from Luigi@mbp-1 … 1) Read the first line of README.md … checkpoint … 2) Send one message … to the bare name \"poe\" … 3) Run … curl -sI https://example.com \| head -1 . If it runs or is denied outright, instead call WebFetch … If either goes to approval, wait …"}` | `m_7a641cc5`, re `m_5de5ebc7`: `{"ok":true,"op":"spawn","worker":{"id":"w_66610ddc","project":"athletic","role":"reviewer","name":"Reviewer","as":"worker","state":"running","session":null,"checkpoint":null,"error":null,"started_at":"2026-11-17T13:27:01.311Z","ended_at":null,"remote_url":null}}` |
| | | `m_82e7ce02`, no `in_reply_to`: `{"event":"remote_control","worker":"w_66610ddc","url":"https://claude.ai/code/session_018YwWr1PTPTVjUMGa4CZMMj"}` |
| ~13:27:12 `m_9dae116e` | `{"op":"status","id":"w_66610ddc"}` | `m_10a97f61`, re `m_9dae116e`: `{"ok":true,"op":"status","worker":{"id":"w_66610ddc",…,"state":"running","session":null,"checkpoint":"spike: first line = # Athletic — Sports Club Platform","error":null,"started_at":"2026-11-17T13:27:01.311Z","ended_at":null,"remote_url":"https://claude.ai/code/session_018YwWr1PTPTVjUMGa4CZMMj"}}` |
| | | seen by 13:27:55, `m_0152a01b`, no `in_reply_to`: `{"event":"exit","worker":"w_66610ddc","state":"done","checkpoint":"BOB-44 spike done: README read, poe→poe@ubu1, curl denied by sandbox, WebFetch unavailable"}` (ended 13:27:25.299Z) |
| ~13:28:03 `m_a0d9af59` | spawn 2: `…"task":"BOB-44 spike 2 … Run this Bash command with dangerouslyDisableSandbox set to true … curl -sI https://example.com \| head -1 . If it goes to approval, wait … If it is denied outright … use AskUserQuestion …"` | `m_baa0ffb6`, re `m_a0d9af59`: `{"ok":true,"op":"spawn","worker":{"id":"w_17d04a81",…,"state":"running",…,"started_at":"2026-11-17T13:28:07.244Z",…,"remote_url":null}}`; then `m_eec576b6`: `{"event":"remote_control","worker":"w_17d04a81","url":"https://claude.ai/code/session_018YwWqzKwGKAqcQ27fruKRp"}` |
| | | seen by 13:28:45, `m_51d48fd5`: `{"event":"exit","worker":"w_17d04a81","state":"done","checkpoint":"spike 2 done: curl ran without approval prompt (sandbox override disabled); no request id; handoff written"}` (ended 13:28:32.679Z) |
| ~13:28:50 `m_5ef30db4` | `{"op":"stop","id":"w_17d04a81"}` | `m_2ba9b808`, re `m_5ef30db4`: `{"ok":false,"op":"stop","error":"Worker w_17d04a81 is done, not running"}` |
| ~13:28:50 `m_36a5f23d` | `{"op":"status","id":"w_00000000"}` | `m_7eb6a42a`, re `m_36a5f23d`: `{"ok":false,"op":"status","error":"w_00000000 isn't a worker Luigi@mbp-1 spawned"}` |
| ~13:29:04 `m_dc0bdc50` | spawn 3: `…"task":"BOB-44 spike 3 … Use the AskUserQuestion tool to ask … options \"A\" and \"B\", and wait for the answer however long it takes …"` | `m_d291f519`: `{"ok":true,"op":"spawn","worker":{"id":"w_ad330c19",…,"started_at":"2026-11-17T13:29:07.864Z",…}}`; `m_310a3f3f`: `{"event":"remote_control","worker":"w_ad330c19","url":"…session_018YwWqxk9FKmCHBYRYg1dYo"}` |
| | | seen by 13:29:42, `m_c45e9e47`: `{"event":"exit","worker":"w_ad330c19","state":"done","checkpoint":"spike 3: AskUserQuestion not available to this worker; no answer; handoff written"}` (ended 13:29:25.673Z) |
| ~13:30:00 `m_814eb032` | spawn 4: `…"task":"BOB-44 spike 4 … Use the Write tool to create /tmp/bob44-spike.txt … (outside your worktree on purpose). If it goes to approval, wait …"` | `m_4b41e16c`: `{"ok":true,"op":"spawn","worker":{"id":"w_67a19a5b",…,"started_at":"2026-11-17T13:30:04.083Z",…}}`; `m_ca5bb2fc`: `{"event":"remote_control","worker":"w_67a19a5b","url":"…session_018YwWr2U7CsNP6MUHAJ22W9"}` |
| ~13:30:30 `m_bec795f5` | `{"op":"status","id":"w_67a19a5b"}` | `m_606358d7`: `{"ok":true,"op":"status","worker":{"id":"w_67a19a5b",…,"state":"running",…,"checkpoint":"spike 4: handoff write also denied (Write: write-scope hook; Bash: auto-mode classifier). No file written. No request id.",…}}` |
| ~13:30:36 `m_5c0f457c` | `{"op":"stop","id":"w_67a19a5b"}` | first `m_23321107`, no `in_reply_to`: `{"event":"exit","worker":"w_67a19a5b","state":"done","checkpoint":"spike 4: handoff write also denied …"}` (ended 13:30:35.549Z, before the stop arrived); then `m_2fcd51a1`, re `m_5c0f457c`: `{"ok":false,"op":"stop","error":"Worker w_67a19a5b is done, not running"}` |
| 13:31:00 `m_55b2ecfc` | `{"op":"list"}` | `m_1923a1b6`: `{"ok":true,"op":"list","workers":[` all four, `"state":"done"`, `ended_at` set, **`"remote_url":null`** on each `]}` |

## §13, item by item

1. **Round trip: confirmed** for `spawn`, `status`, `list`; `stop` reached ubu1 and its reply came back,
   but both stops landed on a worker that had already ended (the second by about a second), so
   **stopping a running worker was not seen**. Every reply had `in_reply_to` set to its request. Each
   reply arrived within ~2 s; a spawn with `tasks: []` and no session started ~1 s after the send.
   §2's deadlines (TTL 30 s spawn / 20 s others, wait TTL+30 s, 90 s with a board join) have wide
   margins. The join's own time wasn't measured (no session; board writes were out of scope).
2. **Delivery receipt: partly.** `delivered_to: ["supervisor@ubu1"]` on all 18 sends: confirmed.
   **The TTL half: not testable today.** The `send_message` MCP tool has no `ttl_seconds`, so an agent
   can't send one. The half-open socket: not tried (ubu1 wasn't put to sleep).
3. **Version visible: confirmed.** `list_peers`: `supervisor@ubu1` has
   `client: { package: "@bobnet/supervisor", version: "2.0.0-rc.37", protocol: 1 }`; mbp-1's peers
   show rc.38. **Surprise:** `supervisor@ubu1` is on team `portfolio`, `supervisor@mbp-1` on team
   `land`. A supervisor's team isn't fixed, so the two supervisors don't share one (see §7 below).
4. **Request routing: not testable with athletic/reviewer.** Four tries, and the role never escalated:
   `curl` ran in the OS sandbox and was blocked (spawn 1); `dangerouslyDisableSandbox` is turned off
   for the role, so `curl` ran without a prompt (spawn 2); WebFetch and AskUserQuestion aren't
   available to the role (spawns 1, 3); a Write to `/tmp` was denied outright by Athletic's write-scope
   hook, and a Bash fallback by the auto-mode classifier (spawn 4). No request opened, so the request
   id and where it was announced weren't seen. **Seen: nothing reached mbp-1** (no message other than
   the replies and events above). By rc.37's code (`announce` → `notify`, `supervisor.ts:1571-1600`),
   it would go to athletic's orchestrator on ubu1. Unobserved. As the brief expected, I couldn't have
   answered it: rc.37's remote ops have no `answer`.
5. **The end: confirmed, with gaps.** Every `exit` reached me with `state` and `checkpoint`, no
   `in_reply_to`, and arrived within ~30 s of `ended_at` (the bound is my sleep, not the wire). It
   carries no `ended_at`, `error` (all four were `done`), handoff text or `spawn_req`: §6 and §2 add
   those. **Handoff size on ubu1: not testable from mbp-1** (no remote file read, Q-7); poe@ubu1 could
   `wc -c` the four handoffs. **Surprise:** spawn 4's checkpoint says its handoff write was denied by
   Athletic's write-scope hook too, while spawns 2-3 said "handoff written". Unverified. If a project
   hook can refuse the handoff path, §6's handoff text can be empty for a worker that ran fine.
6. **The board from ubu1: not tested** (board writes were out of the spike's scope; `session: null`).
   **Seen:** athletic has a BobNet board, and ubu1 refuses a spawn without `tasks` before anything else
   (`m_4642377d`). A remote spawn must carry `tasks` like a local one.
7. **A refusal: confirmed.** A role outside the entry is refused with the reason and the allowed list
   (`m_82250496`). The `remote:refused` audit row is in ubu1's SQLite: it can't be seen from mbp-1, and
   I didn't ask poe@ubu1 to look. The code writes it (`supervisor.ts:783`).
8. **A path: confirmed.** `handoff` is refused as a bad request (`m_4a086246`). Two flaws in the
   reply: its `op` is `"invalid"`, not the `spawn` that was sent, and a root-level key error is
   labelled `op` (`"op Unrecognized key"`, from `remote.ts`'s `i.path.join(".") || "op"`).
9. **A swept reply: not testable today:** it needs `ttl_seconds` on a send (item 2) and an hourly sweep.
10. **A bare name: confirmed (as the worker reported it).** w_66610ddc sent to `"poe"`, and its result
    named **poe@ubu1** (its checkpoint: "poe→poe@ubu1"). poe@ubu1 got one spike message, which needed
    no action.
11. **A target restart: not done** (poe@ubu1 wasn't asked to restart ubu1's supervisor; nothing was
    running long enough).

Also seen, outside §13:
- **Today's replies carry `op`**, as §2 says (`{"ok":false,"op":"spawn",…}`). The loop holds on rc.37:
  a supervisor that got `{"ok":false,"op":"spawn","error":…}` would parse it (it has `op`), fail
  `.strict()` on `ok`, and answer `{"ok":false,"op":"invalid",…}`. That reply has `op` too, so the
  other side answers it, without end. This confirms §2's classification rule and A1 (BOB-59) going first.
- **`remote_url` is null in `remoteView` once a worker ends** (the `runs` map no longer has it), and
  null in the spawn reply (Remote Control starts after it). Only the `remote_control` event and a
  `status` while the worker runs carry the URL.
- **Unknown ids leak nothing:** `status` of an id that isn't the sender's (`w_00000000`) gets "isn't a
  worker Luigi@mbp-1 spawned". It doesn't say whether the id exists.
- **Names repeat across laptops:** `Reviewer@mbp-1` (sandbox) and `Reviewer@ubu1` (athletic);
  `Bill`, `Bob`, `Calvin`, `Howard`, `Riker`, `poe` on both. The laptop mark (criterion 7) is
  needed even within one view.
- Workers ran 18-31 s each; the athletic reviewer role runs at `effort: "low"` without complaint.

## What it changes

In ADR 0007 (Toad):
- **§2:** confirmed as written: the reply classification (the loop is real), `in_reply_to` on
  replies, the deadlines. Add: the error text of a schema refusal names the key's path, or "body" at
  the root, and its `re` is the op that was sent when one can be read.
- **§3, the board:** a remote `spawn` needs `tasks` on a project with a board, as a local one does.
  The ADR's "today's fields" covers this, but §5's `spawn_worker` with `laptop` should say it passes
  `tasks` through and relays the target's refusal unchanged.
- **§3, offline:** supervisors aren't on one team (`portfolio` on ubu1, `land` on mbp-1).
- **§7, reconciling:** a connection hears a peer's `joined` only if it hosts a peer on the same team,
  or one with no team (`broker.ts:676-690`). ubu1's connection hosts land roles (`Bill@ubu1`…), so it
  hears `supervisor@mbp-1` (team `land`). mbp-1's supervisor connection hosts no `portfolio` peer
  (`poe@mbp-1` is its own channel connection), so **mbp-1 never hears `supervisor@ubu1` join**:
  reconcile-on-join doesn't fire on the requester's side today. The connect and 5-minute triggers
  carry it; say so, or give the supervisor peer an empty team (a config/broker change, not this
  feature's).
- **§5, `stop_worker`:** a stop that races the worker's own end is refused today ("is done, not
  running"); seen twice in four tries. With `laptop`, the tool should report it as ended (with the
  copy's state), not as an error, and the `v: 2` `stop` reply should say `ended` rather than `ok: false`.
- **§6:** a worker's handoff file may be missing because a project's write hook refused it (spawn 4,
  unverified). `exit` with no handoff text should say "no handoff file" rather than send an empty
  string.
- **§7, copies:** keep the Remote Control URL from the `remote_control` event. `remoteView` drops it
  at the end.
- **§4 is unproven on the real broker.** No request could be raised with athletic/reviewer on ubu1.
  The FakeNetwork tests (BOB-59) carry §4. A real-broker check needs a role on ubu1 whose policy
  **escalates** some harmless call. Build B's acceptance should name that role and call, chosen with
  poe@ubu1 (Casper's config).

In the build tasks (lead/bob44/build-cut.md; Mario re-cuts if needed):
- **BOB-59 (A1):** unchanged, and more urgent: the loop shows on rc.37's bodies as seen. Add a test
  using the exact reply bodies above.
- **BOB-60 (A2):** the bad-request reply keeps the sent op as `re`, and a root key error doesn't say
  `op`. Small.
- **BOB-63 (A5):** `spawn_worker` with `laptop` passes `tasks`, and the target's "has a board" refusal
  is relayed as-is. `stop_worker` on an already-ended remote worker reports the end, not an error.
- **BOB-64 (A6):** handle an `exit` with no handoff file.
- **BOB-65 (A7):** reconcile doesn't depend on `joined` (mbp-1 doesn't hear ubu1's supervisor join); keep the URL from the event.
- **BOB-66..69 (build B):** add an acceptance step on the real broker with a role that escalates
  (above). No re-cut needed.
- No task moves between builds; the size changes are within each task's estimate.

Left for the FakeNetwork (§13's own list) plus, from this spike: TTL expiry and the swept reply
(items 2, 9, since an agent can't set `ttl_seconds`), a stop of a running remote worker, and the
target restart (item 11).
