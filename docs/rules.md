# Cambio Rules

Authoritative rules for the online, server-authoritative implementation. This document
describes player-visible rules. See [`transition-contract.md`](transition-contract.md)
for the exact command/timer mechanics that implement them.

## Players and deck

- 2-6 players, one standard 52-card deck plus both Jokers (54 cards).
- No accounts; guests join a private room by code or link.

## Setup and seating

- Round one dealer is chosen at random. The dealer rotates to the next remaining seat
  after every round.
- Each player is dealt four cards face down into stable positions arranged as a 2x2 grid.
  Grid positions never move once assigned; only their occupancy (card, hole, or penalty
  addition) changes.
- **No initial discard is created.** The discard pile begins empty and receives its first
  card only from a normal discard during play.
- Before play, each player privately sees their own two canonical bottom grid positions
  only. This is the only card knowledge a player starts with. Responsive layout never
  changes which positions are semantically "bottom".
- Every non-removed player must acknowledge the opening reveal before the first turn
  begins.
- Play starts with the seat to the dealer's left and proceeds clockwise through stable
  seat order.

## Normal turn

At the start of their turn, the active player chooses exactly one of:

1. **Call Cambio** before drawing (see [Calling Cambio](#calling-cambio-final-turns-and-scoring)).
2. **Draw** the top card of the face-down draw pile. Drawing from the discard pile is
   never allowed.

After drawing, the player either:

- **Replace**: swap the drawn card into one occupied grid position. The displaced grid
  card becomes the new normal discard.
- **Discard**: place the drawn card directly as the new normal discard.

A player with no occupied grid positions may still draw and discard without replacing,
or call Cambio on a later turn. A drawn card can never be placed into a hole; holes are
filled only by a penalty card or an opponent-snap transfer.

Whichever card becomes the normal discard opens that card's optional power (if any) and
opens a snap window (see below), regardless of whether the card was drawn or displaced
from the grid.

## Card values and powers

| Card | Match points | Optional power on normal discard |
|---|---:|---|
| Joker | 0 | None |
| Ace | 1 | None |
| 2-6 | Face value | None |
| 7-8 | Face value | Privately inspect one occupied card in your own grid |
| 9-10 | Face value | Privately inspect one occupied card in another player's grid |
| Jack or Queen | 10 | Blind-swap any two distinct occupied positions on the table |
| Black King (clubs/spades) | 10 | Privately inspect one own card and one opponent card, then optionally swap them |
| Red King (diamonds/hearts) | -1 | None |

Power rules:

- Every power is optional and can be skipped.
- A power's target selections are fixed at the moment they are chosen and do not depend
  on later changes to the discard pile.
- Jack/Queen: the two swapped positions and the fact a swap occurred are visible to
  everyone; neither card's rank is revealed to anyone.
- Black King: both selected ranks are revealed privately to the active player only, who
  then confirms or declines the swap. Declining leaves both cards in place.
- A private reveal stays available until its authorized player acknowledges it. Earlier
  peeks are not retained as a memory aid; a player must remember what they saw.
- If a snap, transfer, or removal invalidates a selected power target before it is used,
  only that selection is discarded and the player is asked to reselect. The pending power
  itself is never cancelled by this. If no legal target remains, the power is
  auto-skipped.
- A card removed by a successful snap never triggers a power.

## Snap resolution

Every normal discard opens a reaction window (default 5 seconds, configurable 2-10s per
room).

- Any connected player, including the active player, may attempt to snap: claim that an
  occupied face-down card at a chosen position (their own or any opponent's) matches the
  rank of the current discard top.
- Matching is by rank only.
- Players may make unlimited wrong attempts during the window. There is no game-rule cap
  on attempts; only transport-level rate limiting applies.
- Exactly one attempt can succeed. The server orders concurrent attempts by receive
  order, breaking ties with a monotonic sequence number.

**A correct snap:**

1. Removes the target card and places it face up as the new discard top.
2. Immediately resolves the snap competition. No new snap window opens and this card
   never triggers a power.
3. If the snapped card belonged to the snapper, their slot becomes a hole; no transfer is
   needed.
4. If the snapped card belonged to another player, the snapper must immediately choose
   one of their own occupied cards to move into the exact vacated slot, leaving a hole
   at the transferred card's original slot. If the snapper has no occupied card to give,
   the snap attempt is rejected before any mutation occurs.

**A wrong snap:**

- Briefly and publicly reveals the mismatched card's rank at that position, then returns
  it face down in the same slot. This reveal is a transient presentation event; it is not
  written to the public action log.
- Draws one penalty card face down into the offender's lowest-numbered stable hole, or
  appends a new stable penalty slot (in row-major order) if no hole exists.
- Leaves the snap window open for further attempts.

A late attempt (window already closed), an attempt against an already-invalidated target,
or a technically-correct attempt made after another success has already resolved the
window, is rejected without a penalty draw.

## Concurrent powers and snaps

A single normal discard can create both a pending power and an open snap window at the
same time. Both are tracked independently and resolved through one serialized per-room
command queue:

- Players may attempt snaps while a power is still being selected, and vice versa.
- A successful snap never cancels a pending power. A power never closes the snap window.
- A power and a pending opponent-snap transfer may complete in either order.
- The next turn starts only once the power is resolved/skipped/auto-skipped, the snap
  window has closed (expired or resolved by success), any required transfer is complete
  or cancelled by removal, and the room is not paused.

## Stock exhaustion

All draws (normal draw and penalty draw) use the same rule:

1. Draw from the face-down stock if it has cards.
2. If the stock is empty, keep the current discard top in place and shuffle every other
   discard card back into a new stock using the room's seeded random generator, then emit
   a public reshuffle notice (no order is revealed).
3. If there are no other discard cards to reshuffle, the draw cannot be satisfied and the
   round ends immediately and safely with reason `stockExhausted` (see below). No card is
   fabricated and no partial card is dealt.

## Calling Cambio, final turns, and scoring

- Cambio may only be called at the very start of the active player's turn, before
  drawing. It cannot be called again once any final turn is underway.
- The caller takes no further normal turn this round.
- Calling creates an immutable, ordered queue of every other non-removed player, starting
  with the seat after the caller and proceeding clockwise. Each entry is consumed only
  after that player fully completes their final turn (including any power/snap/transfer
  obligations).

**Round ends normally (`cambio`) once the queue is exhausted:**

1. Every remaining hand is revealed and each player's raw hand total is calculated.
2. Every non-caller scores their raw total as match points for the round.
3. If the caller has the uniquely lowest raw total, the caller scores 0.
4. If the caller ties for lowest, the caller scores their raw total.
5. Otherwise, the caller scores twice the highest raw total among all players (including
   themselves), with no separate minimum penalty.
6. Every player tied for the lowest raw total shares the round win (a display fact; it
   does not change scoring above).

**Other round-end reasons:**

| Reason | Scoring |
|---|---|
| `stockExhausted` | Every remaining player scores their raw hand total; no caller adjustment |
| `callerRemoved` | Every remaining player scores their raw hand total; no caller adjustment |
| `hostEnded` | Round is abandoned; no points are added; prior completed-round standings stand |
| `insufficientPlayers` | Round is abandoned; no points are added; prior completed-round standings stand |

The match runs for a fixed configured number of rounds (default 9, range 1-20). The
player(s) with the lowest cumulative match points win the match; ties share the win.
Seat order is a display detail only.

## Room and player lifecycle (summary)

See `transition-contract.md` for exact mechanics.

- 2-6 players per room; host configures round count (1-20, default 9), snap window
  (2-10s, default 5), and player cap (2-6) while in the lobby.
- A started match accepts no new players; there are no spectators.
- A disconnected active seat pauses the room immediately; gameplay commands are rejected
  while paused. A 120-second reconnect grace makes the seat removal-eligible, but only
  the current host can actually remove them.
- If the host disconnects, host authority immediately migrates to the longest-connected
  eligible player (ties broken by stable seat order). A former host does not reclaim
  authority on reconnect.
- The host may end a stalled match at any time (with confirmation); this abandons the
  current round without adding scores.
- There are no turn timers for normal turns, powers, opening-peek acknowledgement, or
  ready-up between rounds; only the snap window and lifecycle timers (reconnect grace,
  empty-room retention) are timed.
- Empty rooms (no connected players) are deleted after 24 hours of retention.
