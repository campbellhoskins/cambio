# Transition Contract

This is the coordination boundary for parallel engine, server, protocol, and UI work.
Every command a client can send and every internal timer/system event the server
processes is listed here with its legal phase, authorized actor, preconditions, atomic
mutation, rejection codes, and visibility. Prose rules are in
[`rules.md`](rules.md); package/actor/persistence design is in
[`architecture.md`](architecture.md); envelope/message shapes are in
[`protocol.md`](protocol.md).

## Conventions

- **Phase** refers to `MatchStatus` (`lobby`/`active`/`intermission`/`complete`/
  `abandoned`) and, within an active round, `RoundPhase`
  (`dealing`/`openingPeek`/`turnCycle`/`scoring`/`complete`) and `TurnStage`
  (`turnStart`/`drawn`/`resolving`).
- **Actor** is the authorized command sender: `any guest`, `seated player`,
  `active player`, `host`, or `server` (internal/system).
- Every command is additionally gated by the checks in `protocol.md` (protocol version,
  session generation, idempotency) before phase/precondition checks run; those universal
  checks are not repeated per row.
- Every rejection leaves state and revision unchanged; no partial mutation ever occurs.
- **Mutation** entries reference the actual domain fields in `MatchState`/`RoundState`
  (for example `slotsByPlayer`, `pendingPower`, `snapWindow`, `pendingTransfer`,
  `cambio.finalTurnQueue`, `cumulativeScores`, `pauseReasons`).

### Rejection codes

| Code | Meaning |
|---|---|
| `E_BAD_ENVELOPE` | Invalid protocol version, malformed payload, or schema mismatch |
| `E_UNAUTHORIZED` | Sender is not an authorized actor for this command/room |
| `E_STALE_SESSION` | `sessionGeneration` superseded by a newer controller |
| `E_ROOM_NOT_FOUND` | Room code does not resolve to a retained room |
| `E_ROOM_FULL` | Player cap already reached |
| `E_ROOM_STARTED` | Join attempted after match start; no spectators |
| `E_NOT_HOST` | Command requires host authority |
| `E_ALREADY_STARTED` | Match already started |
| `E_MIN_PLAYERS` | Fewer than 2 players present |
| `E_OUT_OF_PHASE` | Command not legal in current phase/round phase/turn stage |
| `E_NOT_ACTIVE_PLAYER` | Command requires being the active player |
| `E_STALE_REVISION` | `expectedRevision` does not match current revision |
| `E_DUPLICATE_COMMAND` | `commandId` reused with a different payload |
| `E_PAUSED` | Room is paused; gameplay commands rejected |
| `E_NO_DRAWN_CARD` | No pending drawn card to replace/discard |
| `E_SLOT_NOT_OCCUPIED` | Target slot has no card |
| `E_SLOT_IS_HOLE` | Attempted to replace into a hole |
| `E_NO_PENDING_POWER` | No pending power to act on |
| `E_POWER_STAGE_MISMATCH` | Command does not match the power's current stage |
| `E_TARGET_INVALID` | Revalidated target no longer matches the original selection |
| `E_TARGET_NOT_DISTINCT` | Two target positions required to be distinct are not |
| `E_STALE_SNAP_WINDOW` | `snapWindowId`/`generation` does not match the open window |
| `E_SNAP_ALREADY_RESOLVED` | Window already has a successful snap |
| `E_NO_TRANSFER_CARD` | Opponent-snap transfer required but snapper has no occupied card |
| `E_NO_PENDING_TRANSFER` | No pending transfer to act on |
| `E_CAMBIO_ALREADY_CALLED` | Cambio already called this round |
| `E_CAMBIO_NOT_ALLOWED` | Cambio called outside `turnStart` before drawing |
| `E_NOT_REMOVAL_ELIGIBLE` | Target seat is not yet `removalEligible` |
| `E_ALREADY_REMOVED` | Target seat already removed |
| `E_INVALID_CONFIG` | Round count/snap window/player cap outside allowed range |
| `E_CREDENTIAL_INVALID` | Reconnect secret invalid, expired, or already rotated |

## Lobby and session commands

| Command | Phase | Actor | Preconditions | Mutation | Rejection | Visibility |
|---|---|---|---|---|---|---|
| `createRoom` | n/a (registry) | any guest | config within limits (players 2-6, rounds 1-20 default 9, snap 2-10s default 5) | Creates room row, seat 0 as host, `status=lobby`, issues reconnect secret | `E_INVALID_CONFIG` | Creator receives room code/link and session credential; nothing broadcast |
| `joinRoom` | `lobby` | any guest | room exists, not started, seat count < cap | Adds seat with next `joinOrder`, issues reconnect secret | `E_ROOM_NOT_FOUND`, `E_ROOM_STARTED`, `E_ROOM_FULL` | Broadcasts updated roster to room; new seat gets full lobby view + credential |
| `updateRoomConfig` | `lobby` | host | new values within limits | Updates `config` (roundCount/snapWindowMs/playerCap) | `E_NOT_HOST`, `E_OUT_OF_PHASE`, `E_INVALID_CONFIG` | Broadcasts updated config to room |
| `startMatch` | `lobby` | host | >= 2 seats present | Sets `status=active`; deals round 1 (see `dealCards` below) | `E_NOT_HOST`, `E_MIN_PLAYERS`, `E_ALREADY_STARTED` | Broadcasts match start + per-viewer opening deal view |
| `resumeSession` | any | seated player (via credential) | valid, non-expired reconnect secret; seat not `removed` | Rotates reconnect secret, increments `sessionGeneration`, revokes prior socket for the seat, sets `connection=connected`, clears blocking pause reason if last one | `E_CREDENTIAL_INVALID`, `E_ALREADY_REMOVED` | Resuming client receives full `stateSnapshot`; room broadcasts presence update |
| `leaveRoom` | `lobby` | seated player | seat present | Removes seat from lobby roster; invalidates its credential | `E_OUT_OF_PHASE` (leaving mid-match is disconnect, not this command) | Broadcasts updated roster |

## Round setup commands

| Command | Phase | Actor | Preconditions | Mutation | Rejection | Visibility |
|---|---|---|---|---|---|---|
| `dealCards` (server-internal, triggered by `startMatch`/round advance) | `dealing` | server | prior round scored or first round | Selects/rotates dealer, shuffles via seeded PRNG, deals 4 cards per seat into stable slots, clears discard pile (empty), sets `phase=openingPeek` | n/a | Each seat privately receives its own two canonical bottom cards; all other slots shown face-down to everyone |
| `acknowledgeOpeningPeek` | `openingPeek` | seated player | seat not already acknowledged | Sets `seats[seat].openingPeekAcknowledged=true`; when all non-removed seats acknowledged, sets `phase=turnCycle`, `activePlayerId` = seat left of dealer | `E_OUT_OF_PHASE`, `E_STALE_REVISION` | Broadcasts acknowledgement count; broadcasts turn start when all acknowledge |
| `readyForNextRound` | `intermission` | seated player | seat not already ready | Sets `seats[seat].readyForNextRound=true`; when all non-removed seats ready, advances to `dealCards` for next round or `matchComplete` if round count reached | `E_OUT_OF_PHASE`, `E_STALE_REVISION` | Broadcasts ready count; broadcasts next deal or match summary when all ready |

## Turn commands

| Command | Phase | Actor | Preconditions | Mutation | Rejection | Visibility |
|---|---|---|---|---|---|---|
| `callCambio` | `turnCycle`/`turnStart` | active player | Cambio not already called this round | Sets `cambio={callerId, finalTurnQueue: other non-removed seats clockwise from caller, completedFinalTurns: []}`; advances turn to next seat's `turnStart` | `E_NOT_ACTIVE_PLAYER`, `E_OUT_OF_PHASE`, `E_CAMBIO_ALREADY_CALLED`, `E_CAMBIO_NOT_ALLOWED`, `E_STALE_REVISION`, `E_PAUSED` | Broadcasts Cambio call and the final-turn queue (player identities and order; not cards) |
| `drawCard` | `turnCycle`/`turnStart` | active player | Cambio not called this turn | Runs shared draw operation (stock, else reshuffle, else `stockExhausted` round end); sets `drawnCard`, `turnStage=drawn` | `E_NOT_ACTIVE_PLAYER`, `E_OUT_OF_PHASE`, `E_STALE_REVISION`, `E_PAUSED` | Drawn card rank visible only to drawer; pile counts and any reshuffle notice broadcast publicly |
| `replaceSlot` | `turnCycle`/`drawn` | active player | `drawnCard` pending; target slot occupied (not a hole) | Moves target slot's card to discard top (normal discard), places `drawnCard` into target slot, clears `drawnCard`; opens power (if any) and snap window on the discarded card | `E_NOT_ACTIVE_PLAYER`, `E_NO_DRAWN_CARD`, `E_SLOT_NOT_OCCUPIED`, `E_SLOT_IS_HOLE`, `E_STALE_REVISION`, `E_PAUSED` | New discard top rank public; displaced-card rank public (it is now the discard top) |
| `discardDrawn` | `turnCycle`/`drawn` | active player | `drawnCard` pending | Places `drawnCard` directly on discard top, clears `drawnCard`; opens power (if any) and snap window | `E_NOT_ACTIVE_PLAYER`, `E_NO_DRAWN_CARD`, `E_STALE_REVISION`, `E_PAUSED` | New discard top rank public |

## Power commands

All power commands require `pendingPower` to exist and belong to the acting player's own
pending-power obligation (only the power's `ownerId` may act on it), unless noted.

| Command | Phase | Actor | Preconditions | Mutation | Rejection | Visibility |
|---|---|---|---|---|---|---|
| `skipPower` | `resolving` (`pendingPower.stage=offered`) | power owner | pending power offered | Clears `pendingPower`; re-evaluates turn-completion gate | `E_NOT_ACTIVE_PLAYER`, `E_NO_PENDING_POWER`, `E_POWER_STAGE_MISMATCH`, `E_STALE_REVISION` | No card data revealed |
| `selectPowerTarget` (peekOwn/peekOpponent: 1 target; blindSwap: 2 distinct targets; blackKing stage 1: own+opponent target) | `resolving` | power owner | matches `pendingPower.kind`'s expected selection count; target slot occupied; targets distinct where required | Appends validated `SlotRef` to `pendingPower.selections`; advances `stage`; for peek/blackKing stages populates `revealedCardIds` for the owner only | `E_NOT_ACTIVE_PLAYER`, `E_NO_PENDING_POWER`, `E_POWER_STAGE_MISMATCH`, `E_SLOT_NOT_OCCUPIED`, `E_TARGET_NOT_DISTINCT`, `E_TARGET_INVALID`, `E_STALE_REVISION` | peekOwn/peekOpponent/blackKing: revealed rank(s) sent only to owner; blindSwap: no rank ever sent |
| `acknowledgePowerReveal` | `resolving` (`pendingPower.stage=awaitingRevealAck`) | power owner | pending private reveal outstanding | Clears `revealedCardIds`/ack flag; for peek powers, clears `pendingPower` and re-evaluates gate; for blindSwap, executes the swap on acknowledgement (no reveal, so this stage does not apply) and clears `pendingPower`; for blackKing, advances to `awaitingKingDecision` | `E_NOT_ACTIVE_PLAYER`, `E_NO_PENDING_POWER`, `E_POWER_STAGE_MISMATCH`, `E_STALE_REVISION` | No new card data revealed |
| `decideBlackKingSwap` (confirm/decline) | `resolving` (`pendingPower.stage=awaitingKingDecision`) | power owner | both black-king targets still valid if confirming | If confirm: swaps the two cards between the two slots; if decline: no card movement; either way clears `pendingPower` and re-evaluates gate | `E_NOT_ACTIVE_PLAYER`, `E_NO_PENDING_POWER`, `E_POWER_STAGE_MISMATCH`, `E_TARGET_INVALID`, `E_STALE_REVISION` | Only the fact a swap occurred and the two positions are public; ranks are not |
| `reselectPowerTarget` (server-prompted after target invalidation) | `resolving` | power owner | a prior selection was invalidated by a concurrent snap/transfer/removal | Discards only the invalidated selection; if no legal target remains, server auto-skips (equivalent to `skipPower`) | `E_NO_PENDING_POWER`, `E_TARGET_INVALID` | Same as `selectPowerTarget` |

## Snap and transfer commands

| Command | Phase | Actor | Preconditions | Mutation | Rejection | Visibility |
|---|---|---|---|---|---|---|
| `attemptSnap` | `resolving`, `snapWindow` open | any connected seated player | `snapWindowId`/`generation` matches current window; window not already resolved; target slot occupied | Serialized by receive order + monotonic sequence. Correct: removes target card to discard top, sets `snapWindow.resolvedBy`; own-slot becomes a hole; opponent-slot creates `pendingTransfer` (rejected pre-mutation if snapper has no card to give). Wrong: reveals target rank as a transient event, returns it face down, draws one penalty card into offender's lowest hole or a new appended penalty slot; window stays open | `E_STALE_SNAP_WINDOW`, `E_SNAP_ALREADY_RESOLVED`, `E_SLOT_NOT_OCCUPIED`, `E_NO_TRANSFER_CARD` | Correct: new discard top rank public. Wrong: mismatched rank is a public transient presentation event only, not logged. Never reveals unattempted cards |
| `chooseTransferTarget` | `resolving`, `pendingTransfer` outstanding | the snapper (`pendingTransfer` implicit source is opponent's vacated slot) | selected own slot occupied | Moves selected card into the exact vacated slot; leaves a hole at the transfer source slot; clears `pendingTransfer`; re-evaluates gate | `E_NO_PENDING_TRANSFER`, `E_SLOT_NOT_OCCUPIED`, `E_TARGET_INVALID`, `E_STALE_REVISION` | Only the two involved positions are public; ranks are not additionally revealed |

## Host and lifecycle commands

| Command | Phase | Actor | Preconditions | Mutation | Rejection | Visibility |
|---|---|---|---|---|---|---|
| `hostRemovePlayer` | any active/paused | host | target `connection=disconnected` and `removalEligible=true` | Runs the full deterministic removal transition (seat marked `removed`; cards moved to `outOfPlay`; pending power/snap/transfer/final-turn/dealer/active-player/pause effects resolved per `rules.md`; ends round if caller or drops below 2 players) | `E_NOT_HOST`, `E_NOT_REMOVAL_ELIGIBLE`, `E_ALREADY_REMOVED` | Broadcasts removal, updated roster, out-of-play count only (no ranks); possible round-end broadcast |
| `hostEndMatch` | any active/paused | host | match `status=active` | Abandons current round (`endReason=hostEnded`, no scores added), retains completed-round standings, sets `status=abandoned`, stops timers | `E_NOT_HOST`, `E_OUT_OF_PHASE` | Broadcasts match end with final standings from completed rounds only |

## Internal timers and system events

| Timer / Event | Phase | Actor | Preconditions | Mutation | Rejection | Visibility |
|---|---|---|---|---|---|---|
| `socketDisconnected` | any | server (transport) | socket for a seat drops | Sets `seats[seat].connection=disconnected`; if seat is active player or otherwise blocking, adds a pause reason and freezes any running snap-window remaining time; enqueued as a room transition, never mutates directly | n/a (system event, not rejectable) | Broadcasts presence/pause change to remaining connected seats |
| `reconnectGraceExpiry` | any, seat `disconnected` | server (timer) | 120s elapsed since disconnect without resume; timer generation matches | Sets `seats[seat].removalEligible=true`. Does not remove the seat | Stale generation is ignored | Broadcasts removal-eligible flag to host (and generally to room) |
| `snapWindowExpiry` | `resolving`, `snapWindow` open | server (timer) | window `generation` matches; no success recorded | Closes the window (no success); re-evaluates turn-completion gate | Stale generation is ignored | Broadcasts window closed |
| `emptyRoomTtlExpiry` | any (room has 0 connected seats) | server (timer/registry) | 24h elapsed since room became empty; no seat reconnected; serialized against `joinRoom`/`resumeSession` | Deletes room, seats, sessions, snapshots, events, command receipts, and timer rows | Serialization prevents delete-after-revive races | No broadcast (no connected clients) |
| `serverRestartRecovery` | startup | server | process start with retained rooms | For each retained room: mark all seats `disconnected`; add pause reason; increment all timer generations; issue fresh reconnect-grace timers per retained seat; leave any open snap window pending restart-at-full-duration once unblocked | n/a | No broadcast until a client reconnects and receives a fresh `stateSnapshot` |
| `pauseReasonRecomputed` (internal, follows disconnect/resume/removal) | any | server | a pause-affecting event just occurred | Recomputes `pauseReasons`; if now empty, resumes any frozen snap-window remaining duration and un-pauses | n/a | Broadcasts pause/resume state change |
