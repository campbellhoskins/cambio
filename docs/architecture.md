# Architecture

## Overview

Cambio is a server-authoritative real-time card game. One dedicated Node.js server
process is the sole authority for game rules, hidden state, timers, and persistence. A
React client renders only the redacted view the server sends it; it never predicts rules
and never receives cards it is not entitled to see. An offline tutorial reuses the same
engine through a separate, isolated adapter.

## Package boundaries

```text
cambio/
  apps/
    server/   Fastify + WebSocket real-time authority, sessions, timers, persistence
    web/      React SPA, online play only
  packages/
    engine/     Framework-free pure game rules and state transitions
    protocol/   Zod command/message/view/error schemas (external DTOs)
    ui/         Presentation components, protocol view types only
    tutorial/   Offline scripted tutorial, dynamically loaded /tutorial route
    testkit/    Shared builders, fixtures, fake clock, scripted decks
  e2e/          Playwright end-to-end tests
  docs/         Architecture, rules, transition contract, protocol, runbook
```

Dependency rules (enforced by ESLint import restrictions and package manifests):

- `engine` imports nothing from `protocol`, Node, the browser, `server`, or `web`. It
  depends only on its own modules and a seeded random/clock interface.
- `protocol` depends only on Zod. It defines external DTOs, envelopes, views, and error
  codes, and contains no game rules.
- `server` is the only package that maps validated protocol commands to engine commands
  and maps full engine state to per-viewer protocol views. It is the only package that
  touches persistence or holds unredacted domain state.
- `ui` consumes protocol view types only and contains no online game rules.
- `web` depends on `protocol` and `ui` for online play and never evaluates authoritative
  rules.
- `tutorial` depends on `engine`, `protocol`, and `ui` behind a dynamically loaded
  `/tutorial` route. It is the only client-bundled use of `engine` and cannot connect to
  an online room.
- `testkit` may depend on `engine` and `protocol` only.

## Domain state (server-only)

Full room state, held only by `server` and persisted to SQLite, includes:

- Room identity, invite code, schema/protocol versions, timestamps, TTL, host, and
  configuration (round count, snap window duration, player cap).
- Stable seats: join order, display name, connection state, session generation,
  grace/removal eligibility, opening-peek acknowledgement, and ready state.
- Match round index, configured round count, cumulative scores, withdrawn players,
  dealer, and seeded PRNG state.
- Round phase, end reason, active seat, turn stage, and an optional final-turn queue.
- Card catalog, ordered draw pile, ordered discard pile, stable per-player slot arrays
  (each holding a card id or a hole), the current drawn card, and hidden out-of-play
  cards for removed players.
- A pending power: an immutable record of source card, owner, kind, stage, and staged
  target references, independent of later discard-pile changes.
- A snap window: id, generation, trigger card/rank, duration, remaining time, timer id,
  attempts, and resolution.
- A pending opponent-snap transfer.
- Pause reasons and persisted timer rows.
- A public, rank-safe action log.

Starting grid slots are stable and never renumbered; penalties may grow a grid beyond
four slots, and every appended slot counts during scoring. Moving a card always leaves
its source slot as a hole. Slot identifiers never encode rank or suit.

## Client view (per viewer)

The projection sent to each client contains only:

- Public room, seat, phase, turn, timer, pile counts, current discard top, scores, and
  public position movements (not ranks) from powers and snaps.
- Face-down placeholders for occupied slots the viewer cannot see.
- Currently pending, unacknowledged private reveals authorized for that viewer only.
- Server-derived legal-action hints for UX only; the server never trusts a client's own
  notion of legality.

## State machine

```text
lobby
  -> dealing
  -> openingPeek
  -> turnCycle
       turnStart
       draw
       decide
       normalDiscard
       concurrentResolution { optionalPower, snapWindow, optionalTransfer }
       turnComplete
  -> scoring
  -> intermissionReady
  -> dealing | matchComplete
```

`paused` is orthogonal to phase; gameplay commands are rejected while paused regardless
of phase. Round-end reasons are exactly `cambio`, `stockExhausted`, `callerRemoved`,
`hostEnded`, and `insufficientPlayers`.

## Actor design

Each room is owned by one FIFO, in-process actor that serializes every command and
internal timer callback. Processing a command:

1. Validates protocol version, session generation, authorization, phase, and schema.
2. Checks idempotency on `(room, seat, sessionGeneration, commandId)` plus a canonical
   payload hash; an exact duplicate returns the prior result, a reused id with a
   different payload is rejected.
3. Runs the pure engine reducer against the current immutable state.
4. Validates invariants and per-viewer projection safety.
5. In one SQLite transaction: appends domain events, appends the command result, writes
   the new snapshot, and updates timer rows.
6. Updates in-memory actor state only after the transaction commits.
7. Broadcasts a separately projected, viewer-safe message to every connected socket for
   the room.
8. On persistence failure, emits nothing and leaves prior in-memory and client state
   unchanged.

Room creation, join, resume, disconnect, timer firing, TTL expiry, and removal all pass
through this same serialized path. Room-registry-level operations (for example TTL
deletion) are serialized against join/resume so a room cannot be revived after deletion
begins.

## Timer design

Timer callbacks enter the same room actor queue as player commands and carry a persisted
generation; a stale callback from a superseded window or a prior process cannot mutate
current state. Three timer classes:

| Timer | Duration kind | Behavior on disconnect/restart |
|---|---|---|
| Snap window | Game-time | Freezes on an ordinary player disconnect |
| Reconnect grace | Service-time | Continues while the server is available; does not survive a restart |
| Empty-room TTL | Absolute wall-clock | Continues across restarts |

After an unexpected server restart:

- Every retained room actor is restored and every active seat is marked disconnected.
- Each game is paused before accepting any command.
- Every retained seat gets a fresh reconnect grace period (reconnect was impossible while
  the service was down).
- An open snap window restarts at its full configured duration once all blocking players
  reconnect. This may grant extra reaction time but never consumes window time while the
  server was unavailable.
- All timer generations are incremented so callbacks from the prior process cannot apply.

## Persistence design

- `apps/server` depends on a stable persistence port. The in-memory adapter is used by
  default; `SqliteRoomRepository` is selected by `CAMBIO_SQLITE_PATH` or app options.
- SQLite runs in WAL mode via `better-sqlite3`; startup applies idempotent Drizzle-schema
  migrations and enables foreign keys, `NORMAL` synchronous mode, and a busy timeout.
- Tables: rooms, sessions, snapshots, domain events, command receipts, and timers.
- Snapshots store the authoritative `MatchState` JSON exactly as server-only state.
- Room deletion removes the room row and cascades sessions, snapshots, events, receipts,
  and timers.
- The actor persists before it publishes: state is committed in one transaction before
  any broadcast, and in-memory state updates only after commit succeeds.
- Command receipts back the idempotency check described in Actor design, including across
  a restart.
- Retention: rooms with no connected player are deleted 24 hours after becoming empty.
  The durable `emptyRoomTtl` timer preserves the original due time across repository or
  process restarts. Deletion is serialized against join/resume at the registry level.

## Projection and privacy design

- Exactly one projection module maps engine state/events to per-viewer WebSocket
  messages; no other code path may construct a client-facing message.
- Every outbound message type (acknowledgements, errors, reconnect responses,
  presentation events, action-log entries, state snapshots) uses an explicit viewer-safe
  schema. Raw domain events are never sent to a client.
- The draw pile exposes only a count. Only the current discard top is visible; buried
  discards are hidden.
- A removed player's out-of-play cards expose only a count, never ranks.
- Earlier private peeks are not restored on reconnect; only a still-pending,
  unacknowledged reveal can be redelivered to its authorized viewer.
- The public action log records actors, actions, positions, penalties, pauses, and
  scoring, but never hidden or transient card ranks (for example, a wrong-snap reveal is
  a transient presentation event, not a log entry).
- Non-production runtime assertions reject any projection found to contain unauthorized
  card data; automated tests serialize every outbound message type for every seat and
  assert exact card entitlement.

## Security

- Reconnect secrets are 256-bit, generated with cryptographic randomness, stored on the
  server only as a keyed digest, compared in constant time, and rotated on each resume
  together with an incremented session generation. The local server uses
  `CAMBIO_SESSION_SECRET` or a local-only development key so retained sessions remain
  verifiable after a process restart. A new controller for a seat revokes and closes the
  previous socket.
- Every command is bound to the current room, seat, and session generation; a removed or
  stale controller cannot send commands.
- Join/resume endpoints use generic errors, frame-size limits, origin checks, and
  separate rate limits for commands, joins, and snaps.
- Display names are validated and normalized; all user text renders as text, never HTML.
- The local production-like server serves `apps/web/dist`, HTTP APIs, and WebSockets from
  one origin. Browser WebSocket authentication uses a `cambio.auth.*` subprotocol plus
  short-lived scoped cookies; Node integration tests may use the equivalent explicit
  headers. Static responses include a strict local CSP, security headers, and an exact
  local-origin allowlist.
- Structured logs redact tokens and any payload field containing private card ranks.
- SQLite files use restrictive permissions where supported; retention-expired rows are
  deleted.

## Real-time protocol summary

See [`protocol.md`](protocol.md) for the full envelope, idempotency key, and message
definitions, and [`transition-contract.md`](transition-contract.md) for every command and
internal timer.
