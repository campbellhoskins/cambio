# Protocol

Wire-level contract between `apps/web` and `apps/server`, defined with Zod in
`packages/protocol`. This document describes the envelope, identifiers, and message
shapes; see [`transition-contract.md`](transition-contract.md) for per-command semantics
and [`architecture.md`](architecture.md) for the projection/privacy design that produces
these messages.

## Versioning

- Every envelope carries `protocolVersion`. The server rejects a mismatched
  `protocolVersion` with a generic incompatibility error before evaluating any other
  field.
- Protocol, command, message, view, and error schemas are versioned together in
  `packages/protocol`. A breaking schema change bumps `protocolVersion`.

## Command envelope (client -> server)

```text
{
  protocolVersion: number,
  commandId: string,          // client-generated, unique per (room, seat, sessionGeneration)
  sessionGeneration: number,  // current controller generation for this seat
  expectedRevision?: number,  // required for turn-critical commands
  type: string,               // discriminates the payload schema
  payload: unknown,           // validated against exactly one registered command schema
}
```

- `commandId` is the idempotency key alongside `room`, `seat`, and `sessionGeneration`
  (see [Idempotency](#idempotency)).
- `expectedRevision` is required for turn-critical commands (draw, replace, discard,
  power selections/decisions, Cambio call, host actions) and omitted for snap attempts.
- Snap attempts (`attemptSnap`) omit `expectedRevision` but include the current
  `snapWindowId` and its `generation` instead; the target slot is revalidated at receive
  time rather than gated on the state revision.

## Session generation

- Each seat has a `sessionGeneration`, incremented every time that seat's reconnect
  credential is resumed by a new controller (browser tab/reload/device).
- Every command is bound to the room, seat, and session generation that issued it. A
  command from a superseded generation is rejected as unauthorized; it never mutates
  state.
- Resuming rotates the stored reconnect secret and revokes/closes the previous socket for
  that seat.

## Window and revision identifiers

- `revision`: a monotonic integer on `MatchState`, incremented by every committed
  mutation. Every server message includes the current revision. A client drops a message
  with a revision it has already surpassed and requests a resync after a detected gap or
  a stale acknowledgement.
- `snapWindowId` + `generation`: identifies one specific open snap-reaction period. A
  timer callback or attempt carrying a stale generation is rejected without mutating
  state (see `architecture.md` Timer design).
- `timerId`: identifies a persisted timer row (snap window, reconnect grace, empty-room
  TTL) so a restart can restore or invalidate exactly the right timer.

## Idempotency

- Key: `(roomId, seatId, sessionGeneration, commandId)` plus a canonical hash of the
  payload.
- An exact duplicate (same key and same payload hash) returns the previously committed
  result without re-running the reducer or re-broadcasting a new mutation.
- The same `commandId` reused with a different payload is rejected; it never partially
  applies.
- Idempotency records persist in the command-receipts table so this holds across a
  server restart.

## Server messages (server -> client)

All server -> client messages are viewer-safe: each client receives only what its own
seat is entitled to see (see `architecture.md` Projection and privacy design). No message
type ever carries a raw domain event.

| Message | Purpose | Contents |
|---|---|---|
| `commandAccepted` | Ack for a successful command | `commandId`, new `revision`, allowlisted result summary |
| `commandRejected` | Ack for a failed command | `commandId`, `revision` at rejection time, stable rejection code |
| `stateSnapshot` | Full current authoritative view for this viewer | `revision`, server time, complete redacted view (see below) |
| `presentationEvent` | Ephemeral, non-authoritative UI event | Viewer-safe payload only (for example a transient wrong-snap reveal); never persisted to the action log |
| `error` | Transport/protocol-level failure | Generic message, no internal detail |

### `stateSnapshot` view contents

- Public room/seat/phase/turn/timer state, pile counts, current discard top, scores, and
  public position movements (never ranks) from powers and snaps.
- Face-down placeholders for slots the viewer cannot see the rank of.
- Any currently pending, unacknowledged private reveal authorized for this viewer.
- Server-derived legal-action hints for UX only; never authoritative.

### Resync behavior

- The client tracks the last `revision` it applied. On a detected gap (a message whose
  `revision` is not exactly one greater than the last applied) or a stale acknowledgement,
  the client discards local optimistic state and requests a fresh `stateSnapshot`.
- Old-revision messages (revision <= last applied) are dropped without effect.

## Error/rejection codes

Rejection codes are stable, allowlisted strings returned in `commandRejected` and defined
in `packages/protocol`. See [`transition-contract.md`](transition-contract.md) for the
full code list and which commands can return each one. Codes never include internal
detail (stack traces, SQL errors, or card identities).

## Transport

- WebSocket, same-origin locally, one connection per seat controller.
- Frame-size limits and separate rate limits for join/resume, commands, and snap
  attempts are enforced at the transport layer, independent of the unlimited-attempt
  game rule for wrong snaps.
