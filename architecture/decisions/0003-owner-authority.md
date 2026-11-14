# 0003. Owner authority for dashboard actions: device keys, not a travelling token

- **Status:** proposed (Toad, 2026-11-14). Accepting it is Casper's.
- **For:** review finding 2 (`architecture/reviews/2026-11-14-system-review.md`): the owner's JWT is a
  bearer token handed to laptops, and `README.md:47` claims more than holds. BOB-12 is its first
  step (§5).
- **Reads:** `packages/broker/src/index.ts:30-39`, `broker.ts:96-99, 147, 331-338, 429-443`,
  `schema.ts:71-76`, `packages/supervisor/src/owner.ts`, `supervisor.ts:696-722`,
  `packages/protocol/src/frames.ts:328-345, 404`; ADR 0001 §4, §5, §7; Luigi's note on Access's `iat`
  (2026-11-14).

## Context

A dashboard action (answer a permission request, stop or reset a worker: `frames.ts:328-332`) goes
from the owner's socket to the broker, which hands it to the laptop's supervisor with the owner's
Access JWT. The Worker took that JWT from the WebSocket upgrade (`index.ts:37`), and the `Broker`
keeps it in `owner_tokens` for the socket's life (`broker.ts:96-99`, deleted on close at `:147`). It
sends it with every action to the peer named in `laptop_reports.reporter` (`:431-441`). The
supervisor verifies signature, issuer, audience and email, and `exp` through `jwtVerify`
(`owner.ts:20-27`). Nothing binds the token to one action, one laptop or one moment.

So the token is a bearer credential for as long as Access's session lasts:

- whoever controls the broker's storage, or reads a token in flight, can replay it to any supervisor
  until it expires;
- any process with a laptop's service token can make itself the reporter with one `report` frame
  (`broker.ts:331-338`) and collect owner tokens;
- a token that reaches a laptop is a credential for Access itself, usable from a script (unverified;
  treated as if it does).

**Freshness can't be bolted on.** The review proposed a short `iat` window. Luigi found that the
Access JWT is the application session's token (the `CF_Authorization` cookie): its `iat` is the
sign-in, hours before most actions, and a reconnect sends the same cookie and so the same token. A
few-minutes window would refuse almost every action. An Access session of a few minutes would make
the dashboard sign in again all day.

## Decision

### 1. Two kinds of owner authority

| Kind | What | Who checks the owner | Why |
|---|---|---|---|
| **Broker-held** | Reading the dashboard; writing broker data: board writes and Casper's gates (ADR 0001 §5), answers to board questions (§7) | The Worker, from Access, on the owner's socket (`index.ts:21-31`) | The broker holds that data. Whoever controls the broker controls it anyway, so a proof it can't forge would protect nothing. |
| **Laptop-verified** | Anything that makes a laptop do something: today's `answer`, `stop`, `reset`, and any later action that changes what runs on a laptop | The supervisor, from a proof the broker can't make (§2) | The broker must not be able to act on a laptop as the owner. |

The rule for a new action: if it changes what runs, or what a running agent may do, on a laptop, it
is laptop-verified. If it writes only broker data, it is broker-held. Answering a permission request
is laptop-verified even when the dashboard shows it beside board questions.

### 2. Device keys sign laptop-verified actions

- **A device key** is made once per browser the owner uses (desk, phone, tablet): an ECDSA P-256
  key pair from WebCrypto, `extractable: false`, kept in that browser's IndexedDB. The private key
  never leaves the browser. Its id is the public key's JWK thumbprint (RFC 7638), and Casper names it
  ("phone").
- **A supervisor id**: each supervisor makes a random id at its first start, keeps it in its state
  folder, and reports it in its snapshot. The broker can relay that id but can't change which
  supervisor holds it.
- **Each action is signed.** The dashboard signs the canonical JSON of
  `{ v: 1, to: <supervisor id>, action, nonce: <uuid>, at: <ms> }` with the device key, and sends the
  payload, the signature and the key's id. The broker relays them unchanged.
- **The supervisor acts only if** all of these hold, and records which one failed otherwise:
  - the key is enrolled on this supervisor (§3) and not revoked;
  - the signature verifies;
  - `to` is this supervisor's own id, so an action can't be redirected to another laptop;
  - `at` is within two minutes of its own clock;
  - the nonce hasn't been seen in the last ten minutes (kept in its store, swept).
- **The broker learns nothing it can reuse.** A captured action is spent by its nonce. It is no good
  on another laptop because of `to`, or later because of `at`. No owner token travels with an
  action.

### 3. Enrolment uses a fresh sign-in

- A device enrols on each laptop through a laptop-verified action, `enrol { key (public JWK), name }`.
  That action is signed by the new key, as proof that the device holds it. It is also the one action
  the broker sends with the owner's JWT, as today's actions are sent.
- **The supervisor accepts an enrolment only with a fresh JWT:** it verifies as today (`owner.ts`),
  and its `iat` is within ten minutes. Enrolment is rare, so this time `iat` works: the dashboard's
  "add this device" sends Casper through Access's sign-out and sign-in first, reconnects its socket so the
  broker holds the new token, then enrols on every laptop that is online. A laptop offline then shows "not enrolled" and offers the same step later.
- **Every enrolment is shown.** Each laptop's snapshot lists its enrolled keys (name, short id,
  enrolled, last used). The dashboard shows them under the laptop, and flags any enrolment from the
  last day on every device. An enrolment Casper didn't make is visible from every device he has.
- **Revoking:** from the dashboard, a signed `revoke { key }` from any enrolled device; or on the
  laptop, with a supervisor command (`bobnet-supervisor keys`, list and revoke). With every device
  lost, Casper enrols again with a fresh sign-in.
- Keys live in the supervisor's store (`owner_keys`: id, name, public JWK, enrolled_at, last_used,
  revoked_at) and are never deleted, only revoked, so the audit can name the key behind every action.

### 4. The broker and the owner's token

- **The reporter is pinned.** The supervisor names itself when it registers (its configured `name`).
  The broker pins `laptop_reports.reporter` to that name and ignores `report` from any other name on
  the laptop, so another process with the laptop's token can't take the actions or the snapshot.
- **The broker holds the owner's JWT only for the socket's life**, as today: kept in `owner_tokens`
  while the socket is open, deleted when it closes, never written to the audit, the logs or a
  message. Once every laptop takes signed actions (§5, step 3), it is sent only with `enrol`.
- **What the broker can still do**, which the README says plainly: drop or delay an action, show a
  stale or false snapshot, and read and write broker-held data (§1). It can't make a laptop act as
  the owner without a device's signature.
- **The trust root is Casper's Cloudflare account.** The broker serves the dashboard's code
  (`index.ts:41-46`). Whoever can deploy the Worker can serve a dashboard that signs whatever it
  wants while Casper has it open. Device keys protect against a broker whose storage or traffic is
  read, and against a stolen laptop token. They don't protect against a malicious deploy.

### 5. Order of work

1. **BOB-12, now:** the reporter pin (§4), and `README.md:47` corrected to say what holds today: while
   an owner token is live (Access's session length), whoever controls the broker, or a process that
   makes itself the reporter, can replay it for dashboard actions. A shorter Access session for the
   dashboard app narrows that window; it is Casper's setting. No `iat` check: it can't work (Context).
2. **Device keys, accepted alongside the JWT:** the protocol additions (§6), enrolment, signing,
   and the supervisor's checks. The dashboard signs when the laptop has its key enrolled, and sends
   today's JWT-only action when it doesn't.
3. **Signed only:** once each laptop shows every one of Casper's devices enrolled, the supervisor
   refuses an unsigned action other than `enrol` (a supervisor option, on by default from the release
   that says so). The README then says "The broker alone can't act as you" again, with the
   Cloudflare account caveat (§4).

Steps 2 and 3 are one board item for Peach, size M, after BOB-2's core.

### 6. Protocol, additive

- `Action` gains `enrol { key, name }` and `revoke { key }`.
- The client `action` frame gains optional `signed: { payload, sig, key }`, where `payload` is the
  exact signed string. The broker checks only that `payload` parses and that its `action` equals the
  frame's, then relays it.
- The server `action` frame gains the same optional `signed`, and `token` becomes optional. A new
  supervisor that gets no `signed` falls back to the token until step 3. An old supervisor ignores
  `signed` and checks the token, as today. An old dashboard keeps working until step 3.
- `LaptopSnapshot` gains `supervisor_id` and `owner_keys` (the list in §3), both optional.

## Consequences

- A captured action or token no longer lets the broker act on a laptop, once step 3 is on.
- Each new browser costs Casper one fresh sign-in and an enrolment per laptop. Clearing a browser's
  storage loses that device's key, and it enrols again.
- A supervisor's clock must be within two minutes of the browser's. Laptops keep NTP time. A
  refusal for clock skew says so, with both times.
- The supervisor keeps two more small tables (`owner_keys`, seen nonces) in its store, under P7's
  migration and retention rules.
- Board gates stay broker-held (ADR 0001 §4 stands): a broker that is taken over can change the board.
  That is recoverable from the event log and the nightly export (ADR 0001 §3, §11), which is why the
  board doesn't need device signatures.

## Alternatives considered

- **A short `iat` window on every action:** doesn't work. Access's `iat` is the sign-in (Context).
- **A short Access session for the dashboard:** it narrows the window and changes nothing else. It
  stays available to Casper as a setting, and step 1's README says so. It isn't the fix.
- **A challenge per action from the supervisor:** the broker relays both the challenge and the
  answer, and the answer is still the bearer JWT. Rejected.
- **A passkey (WebAuthn) assertion per action**, with the action's hash as the challenge: it adds
  user presence, but asks for Face ID or a touch on every allow and deny, and the authenticator
  doesn't show what it signs, so a malicious deploy gets the same signature. Kept in reserve for
  enrolment if a stronger proof is ever wanted there.
- **Keys entered in each supervisor's config by Casper:** no fresh sign-in needed and no enrolment
  action, but a config edit per device per laptop, and the config is Casper's to edit by hand.
  Rejected for §3. The supervisor command can still revoke on the laptop.
- **Laptop-verified board gates:** each gate signed and checked by... nobody: the board lives in
  the broker, so the broker is the only checker. Rejected (§1).
