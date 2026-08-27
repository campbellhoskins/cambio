# Plan: End-to-End Cambio Web Application

**Task:** Build a complete, locally hosted, real-time Cambio web application for private groups.
**Rule references:** https://cambio-game.com/rules/ and https://cambiocardgame.com/
**Date:** 2026-08-27
**Status:** Plan

---

## Problem and Proposed Approach

The target directory is empty, so this is a greenfield application rather than an extension of an existing system. The implementation must establish the repository, architecture, rules engine, real-time server, persistence, client experience, tests, and local operating documentation.

Build the game as a server-authoritative TypeScript monorepo:

- A pure deterministic game engine owns every rule and state transition.
- A dedicated Node.js server serializes each room's commands, owns timers and hidden state, persists active games to SQLite, and sends a different redacted view to each player.
- A React client renders only authoritative server views. It does not predict rules or receive cards the viewer is not entitled to see.
- Shared Zod schemas version the client/server protocol.
- The online game and the offline tutorial reuse the same engine through separate adapters.
- Tests use seeded randomness, fake clocks, property checks, multiple WebSocket clients, and browser contexts to prove rules, races, privacy, restart recovery, accessibility, and complete user journeys.

The first release is intentionally local-only. It must provide reproducible development and production-like local startup, but it will not include a cloud deployment.

## Current State

The repository root had no application files, source, package manifests, repository metadata, documentation, tests, assets, configuration, CI/CD, or established conventions at the time this plan was approved. There was no prior code to preserve or migrate.

Initial implementation therefore includes:

- Git repository initialization and ignore/attribute rules.
- Node and pnpm version pinning.
- Monorepo scaffolding, package boundaries, linting, formatting, type checking, tests, and build scripts.
- Architecture and rules documentation before parallel package implementation.
- A durable local data directory and environment template.

## Confirmed Release Scope

| Area | Decision |
|---|---|
| Play mode | Online real-time private rooms only |
| Players | 2-6, using one 54-card deck |
| Identity | Guest display names with secure reconnect credentials; no accounts |
| Room discovery | Host shares a high-entropy human-friendly code or link |
| Room configuration | Round count, snap timer, and player cap |
| Defaults | 9 rounds, 5-second snap window, up to 6 players |
| Persistence | Active rooms, in-progress matches, timers, and reconnect state |
| Retention | Delete rooms after 24 hours with no connected players |
| Disconnects | Pause gameplay immediately; 120-second grace; host may remove after grace |
| Host disconnect | Immediately migrate host role to the longest-connected eligible player |
| Turn timers | None for normal turns, powers, opening-peek acknowledgements, or ready-up |
| Technology | TypeScript, React client, dedicated Node real-time server |
| Deployment | Local development and production-like local run only |
| UX | Responsive modern card table, accessibility, tutorial, rules, animations, sound, and public action history |

Explicitly excluded from release 1:

- Public matchmaking, public room browser, and spectators.
- Bots, solo play outside the tutorial, and local pass-and-play.
- Accounts, profiles, statistics, leaderboards, completed-match history, and replays.
- Text chat, emoji reactions, and social features.
- Alternative rule presets.
- Cloud deployment, Redis, horizontal scaling, and multi-server room coordination.
- Automatic turn actions, AFK bots, or power-action timeouts.
- Native mobile apps, offline/PWA game play, localization, and analytics.

## Authoritative Game Rules

### Setup and Seating

- Use a standard 52-card deck plus both Jokers.
- Randomly select the dealer in round one. Rotate the dealer to the next remaining seat after every round.
- Deal four cards face down to each player in stable positions arranged as a 2x2 grid.
- Do not create an initial discard. The discard pile begins with the first normal discard.
- Before play, privately reveal the two canonical bottom positions to their owner. Responsive layout must not change which semantic positions are the bottom two.
- Each player acknowledges the opening reveal. The first turn begins only after all non-removed players acknowledge.
- Start with the player to the dealer's left and continue clockwise through stable seat order.

### Normal Turn

At turn start, the active player chooses exactly one of:

1. Call Cambio before drawing.
2. Draw the top card from the face-down draw pile.

There is no option to draw from the discard pile.

After drawing from the draw pile:

- Keep the drawn card by replacing an occupied grid slot. The displaced grid card becomes the normal discard.
- Or discard the drawn card directly.

The resulting normal discard is placed face up on the discard pile. If that card has a power, its optional power is offered regardless of whether the card came from the draw pile or was displaced from the player's grid. The same normal discard opens the snap window.

Players cannot replace into a hole. Holes are filled only by penalty cards or an opponent-snap transfer. A player with no cards may draw and discard without replacing, or call Cambio on a later turn.

### Card Values and Powers

| Card | Match points | Optional power on normal discard |
|---|---:|---|
| Joker | 0 | None |
| Ace | 1 | None |
| 2-6 | Face value | None |
| 7-8 | Face value | Privately inspect one occupied card in the active player's grid |
| 9-10 | Face value | Privately inspect one occupied card in another player's grid |
| Jack or Queen | 10 | Blind-swap any two distinct occupied positions on the table |
| Black King | 10 | Privately inspect one own card and one opponent card, then optionally swap those two |
| Red King | -1 | None |

Power behavior:

- A power is represented by an immutable pending record containing its source card, owner, power kind, stage, and selected target references. It never depends on the current discard top after being created.
- Every power can be skipped.
- Jack/Queen target positions and the completed swap are visible to all players, but neither card rank is revealed.
- Black King reveals both selected ranks only to the active player and lets that player confirm or decline the swap.
- Private reveals remain available until their authorized player acknowledges them. Earlier peeks are not retained as a memory aid.
- A target reference includes the player, stable slot, and card identity observed at selection time. It is revalidated before use.
- If a concurrent snap, transfer, or removal moves a selected target, discard only the invalid selection and request a legal reselection. The pending power itself survives. Auto-skip only when no legal targets remain.
- Snapped cards never trigger a power.

### Snap Resolution

Every normal discard opens a server-owned reaction window, defaulting to five seconds.

- Any connected player, including the active player, may attempt to snap an occupied face-down card from any player's grid.
- Matching is by rank only.
- A snap command identifies the active snap-window generation and a stable target slot. Stale commands for another window are rejected.
- Attempts are serialized by the room actor. Server receive order, with a monotonic sequence as a tie breaker, determines the winner.
- Players may make unlimited wrong attempts during the window. Transport rate limits still protect the service from abusive traffic but do not impose a game-rule attempt count.

A correct snap is atomic:

1. Confirm that the window is open, no successful snap has resolved, and the target still contains the referenced card.
2. Remove the target card and place it face up on the discard pile as the new top.
3. Mark the snap competition resolved immediately. Do not open another window and do not trigger a power.
4. If the target belonged to the snapper, leave a hole and require no transfer.
5. If the target belonged to another player, require the snapper to choose one currently occupied card from their own grid. Move it into the exact vacated target slot and leave a hole in the snapper's source slot.
6. Reject an opponent-card snap before mutation if the snapper has no card available to transfer.

A wrong snap is atomic:

- Revalidate the attempted position.
- Reveal the mismatched card to every connected player, then return it face down in the same slot.
- Draw one penalty card face down. Fill the lowest stable hole in the offender's grid; if no hole exists, append a stable penalty slot in row-major layout.
- Keep the snap window open and allow further attempts.
- The public rank reveal is a transient presentation event and is not retained in the action history.

Late attempts, invalidated targets, or correct attempts after another success are rejected without a penalty. A wrong attempt whose penalty draw cannot be satisfied follows the stock-exhaustion safe-ending rule instead of fabricating or partially assigning a card.

### Concurrent Power and Snap Gate

The normal-discard transition may create both `pendingPower` and `snapWindow`. They are independent obligations processed through one serialized room command queue.

- Power selection can proceed while other players attempt snaps.
- A successful snap never cancels the pending power.
- A power never closes the snap window.
- A snap or transfer can invalidate a selected power target. The power returns to the relevant selection stage or auto-skips if no legal target exists.
- A power swap can move cards that would otherwise have been eligible snap targets. Every snap command revalidates its exact target before deciding success or failure.
- A pending opponent-snap transfer and a pending power may be completed in either receive order.

The next turn starts only when:

- The power is resolved, skipped, or auto-skipped.
- The snap window has expired without a success, or a successful snap has fully resolved.
- Any required transfer is complete or deterministically cancelled by removal.
- The game is not paused.

All timer callbacks enter the same room queue as player commands and carry a persisted generation. Stale callbacks cannot mutate a newer window.

### Stock Exhaustion

All card draws use one shared operation:

1. Draw from the face-down stock when available.
2. If empty, preserve the current top discard and shuffle all buried discard cards into a new stock using the persisted seeded random generator.
3. Emit a public reshuffle event without revealing the new order.
4. If no buried discard exists, end the round safely.

An unsatisfied normal draw or penalty draw ends the round with current raw hand totals and no caller adjustment. The transition records a distinct `stockExhausted` round-end reason. Card conservation must hold across stock, discard, drawn card, grids, and hidden out-of-play cards.

### Calling Cambio, Final Turns, and Scoring

- Cambio is legal only at the start of the active player's turn before drawing.
- The caller takes no normal turn.
- At the call, create and persist an immutable clockwise queue containing every other non-removed player exactly once, beginning with the next seat after the caller.
- Consume a queue entry only after that player's complete turn gate resolves.
- Calling Cambio again is not legal during final turns.
- Removing a non-caller removes that seat from the final-turn queue. Removing the active final-turn player cleans up their transient state before advancing.

For a normal Cambio round end:

1. Reveal every remaining hand and calculate each raw hand total.
2. All players tied for the lowest raw total share the round win.
3. Every non-caller records their raw total as match points.
4. A caller who is uniquely lowest records 0.
5. A caller tied for lowest records their raw total.
6. A caller who is not tied for lowest records twice the highest raw total among all players, including the caller. There is no minimum penalty.

Other round-end causes use explicit behavior:

- `stockExhausted`: score every remaining player at raw total with no caller adjustment.
- `callerRemoved`: score every remaining player at raw total with no caller adjustment.
- `hostEnded` or fewer than two players: abandon the current round without adding points; retain standings from completed rounds.

The match ends after the configured fixed round count. Lowest cumulative match points wins. Cumulative ties are shared wins; seat order is only a stable display ordering.

## Room and Player Lifecycle

### Admission

- A room code is a high-entropy, unambiguous bearer invite suitable for a shareable link.
- New guests may join only while the room is in the lobby and below its configured cap.
- A started match, including intermission, rejects new seats. There are no spectators.
- The host can change valid lobby settings and start once at least two players are present.
- Reconnect is allowed only to the same non-removed seat with a current credential.
- Removal, voluntary leave, match completion, abandonment, and TTL deletion invalidate reconnect credentials as appropriate.
- Human-readable room codes are not reused while retained room records exist.

Configuration limits should be centralized and protocol-validated:

- Player cap: 2-6.
- Round count: 1-20, default 9.
- Snap window: 2-10 seconds, default 5.

### Sessions and Duplicate Controllers

- Issue a 256-bit reconnect secret and store only a keyed digest on the server.
- Store the current credential in browser local storage so reloads and later visits can resume a retained game. Never place it in a URL, room link, log, error, or public state.
- Each successful resume rotates the secret and increments a seat session generation.
- A new controller for the same seat revokes and closes the previous socket.
- Every command is bound to the current room, seat, and session generation.
- A removed or stale controller cannot send commands.

### Disconnect, Pause, and Host Migration

- A socket disconnect enqueues a room transition; it does not mutate state directly.
- Any disconnected active seat pauses the room immediately. Gameplay commands are rejected while paused.
- Persist the remaining gameplay timer duration when pausing and resume that exact duration after all blocking pause reasons clear.
- The 120-second reconnect grace is a lifecycle timer, not a gameplay timer. Grace expiry marks the seat `removalEligible`; it never removes automatically.
- Once eligible, only the current host may remove the disconnected player.
- Host authority migrates immediately when the host disconnects to the longest-connected eligible player, breaking ties by stable seat order. A former host does not reclaim authority on reconnect.
- If no eligible connected host exists, the room remains paused and assigns host authority deterministically when an eligible player reconnects.
- The host may explicitly end a stalled match. Ending requires confirmation and abandons the current round without adding scores.
- Opening-peek acknowledgement, pending powers, pending transfers, and ready-up are intentionally unbounded. Host end-match is the escape path for a connected but stalled room.

Timer classes are explicit:

- Snap timer: game-time duration that freezes on an ordinary player disconnect.
- Reconnect grace: service-time duration that continues while the server is available.
- Empty-room TTL: absolute wall-clock expiry that continues across restarts.

After an unexpected server restart:

- Restore all retained actors and mark every active seat disconnected.
- Pause each game before accepting commands.
- Give every retained seat a fresh recovery grace period because reconnect was impossible while the service was unavailable.
- Restart an open snap window at its full configured duration after all blocking players reconnect. This deterministic fairness policy may grant extra reaction time but never consumes a window while the server is unavailable.
- Increment timer generations so callbacks from the prior process cannot apply.

### Deterministic Player Removal

Execute removal as one pure transition after authorization:

1. Require the target to be disconnected and `removalEligible`.
2. Mark the stable seat removed; never reuse or renumber it during the match.
3. Invalidate its reconnect secret and current socket generation.
4. Remove its pause reason and recompute whether the room can resume.
5. Move every card in its grid and any privately held drawn card into a server-only out-of-play zone. Project only an out-of-play count, never those ranks.
6. If the removed player owns a pending power, skip it. If their cards are selected by another power, invalidate those targets and require reselection or auto-skip.
7. If the removed player is the pending transfer source, cancel the transfer and leave the victim's hole. If they are the victim, cancel the transfer and leave the source card in place.
8. Remove their pending snap attempts. If they were the successful snapper, settle any cancelled transfer before evaluating the turn gate.
9. If they are the Cambio caller, end the round immediately with raw scores and no caller adjustment.
10. Otherwise remove them from the final-turn queue while preserving all other entries and order.
11. If they are the active player, move their drawn card out of play, clear their transient turn obligations, and advance to the next non-removed seat or final-turn entry.
12. If they are the dealer, assign the next non-removed seat as dealer and continue rotation from there.
13. Retain scores from their completed rounds for display as withdrawn, but exclude them from future rounds and final winner calculation.
14. Remove them from opening-peek and ready sets, then recompute completion against remaining seats.
15. If fewer than two players remain, abandon the match, stop timers, preserve completed standings, and retain the record until TTL cleanup.

## Architecture Decisions

### Technology

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Current supported Node.js LTS, pinned in repository | Stable local runtime without hardcoding a maintenance release |
| Workspace | pnpm workspaces with Turborepo | Reproducible installs and explicit package task graph |
| Language | Strict TypeScript | Shared types and exhaustive state transitions |
| Web | React 19, Vite, React Router, Zustand | Focused SPA and authoritative snapshot store |
| Styling/UI | Tailwind CSS, Radix primitives, class-variance-authority | Responsive design with accessible primitives |
| Motion/audio | Motion and Howler | Reduced-motion support and mobile-safe sound sprites |
| Server | Fastify with `@fastify/websocket` | Dedicated HTTP/WebSocket authority with a small versioned protocol |
| Validation | Zod | Runtime validation for configuration and every wire message |
| Database | SQLite WAL through `better-sqlite3` and Drizzle | Durable local transactions, typed migrations, simple operation |
| Randomness | Serializable seeded PRNG such as `pure-rand` | Deterministic shuffle and replayable tests |
| Logging | Pino with redaction | Structured local diagnostics without credential/card leakage |
| Tests | Vitest, fast-check, Testing Library, Playwright, axe | Rules, properties, components, races, recovery, E2E, accessibility |

### Package Layout

```text
cambio/
  apps/
    server/
      src/
        config/
        http/
        realtime/
        rooms/
        sessions/
        timers/
        persistence/
        projections/
        observability/
    web/
      src/
        routes/
        lobby/
        game/
        session/
        state/
        effects/
        accessibility/
        content/
  packages/
    engine/
      src/
        model/
        rules/
        state-machine/
        projections/
        invariants/
    protocol/
      src/
        commands/
        messages/
        views/
        errors/
    ui/
      src/
        cards/
        table/
        dialogs/
        primitives/
    tutorial/
      src/
        driver/
        scenarios/
        coach/
    testkit/
      src/
        builders/
        fixtures/
        scripted-decks/
        fake-clock/
        privacy/
  e2e/
  docs/
    architecture.md
    rules.md
    transition-contract.md
    protocol.md
    runbook.md
```

Dependency boundaries:

- `engine` is framework-free and imports no protocol, Node, browser, server, or web code.
- `protocol` depends only on Zod and defines external DTOs, envelopes, views, and error codes.
- `server` maps validated protocol commands to engine commands and maps full engine state to per-viewer protocol views.
- `ui` consumes protocol view types and contains no online game rules.
- `web` depends on protocol and UI for online play and never evaluates authoritative rules.
- `tutorial` depends on engine, protocol, and UI behind a dynamically loaded `/tutorial` route. This is the only client-bundled engine use and cannot connect to an online room.
- `testkit` may depend on engine and protocol.
- ESLint import restrictions and package manifests enforce these boundaries.

### Domain State

The full server-only room state includes:

- Room identity, invite code, schema/protocol versions, timestamps, TTL, host, configuration, and lifecycle status.
- Stable seats with join order, display name, connection state, session generation, grace/removal eligibility, and ready/peek acknowledgement.
- Match round index, configured round count, cumulative points, withdrawn players, dealer, and seeded PRNG state.
- Round phase, end reason, active seat, turn sequence, and optional final-turn queue.
- Card catalog plus ordered draw pile, ordered discard pile, stable per-player slot arrays containing cards or holes, current drawn card, and hidden out-of-play cards.
- Pending power with immutable source and staged target references.
- Snap window identifier/generation, trigger normal-discard card/rank, timing state, attempts, and success.
- Pending opponent-snap transfer.
- Pause reasons and persisted timer records.
- Public rank-safe action log entries.

Starting slots remain stable. Penalties may grow a grid beyond four cards, and all appended cards count during scoring. Moving a card leaves its source slot as a hole. Slots never encode card rank.

The client view contains only:

- Public room, seat, phase, turn, timer, pile counts, top discard, scores, and public position movements.
- Face-down placeholders for unknown occupied slots.
- Authorized current private reveals only for their viewer.
- Legal action hints derived by the server for UX, never trusted for authorization.

### State Machine

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

`paused` is orthogonal to phase. Round-end reasons are explicit: `cambio`, `stockExhausted`, `callerRemoved`, `hostEnded`, and `insufficientPlayers`.

Before engine and protocol implementation, `docs/transition-contract.md` will define every command and internal timer with:

- Allowed phase and authorized actor.
- Required state and target preconditions.
- Atomic card movements and state mutations.
- Gate or next-phase result.
- Stable rejection code.
- Public and private visibility effects.
- Persisted domain events.

This transition contract is the coordination boundary for parallel engine, server, protocol, and UI work.

### Real-Time Protocol and Command Processing

Use a versioned WebSocket envelope:

```text
{ protocolVersion, commandId, sessionGeneration, expectedRevision?, type, payload }
```

- Turn-critical commands use `expectedRevision`.
- Snap attempts omit an exact revision but include the current `snapWindowId`; their targets are revalidated in actor receive order.
- Every accepted/rejected response includes the authoritative revision and an allowlisted viewer-safe result.
- Client state messages contain a monotonic revision, server time, a complete redacted view, and viewer-safe presentation events.
- The client drops old revisions and requests a resync after gaps or stale acknowledgements.

For each room, a FIFO actor:

1. Validates protocol version, session generation, authorization, phase, and schema.
2. Checks idempotency using `(room, seat, sessionGeneration, commandId)` plus a canonical payload hash.
3. Returns the prior result for an exact duplicate, but rejects command-ID reuse with a different payload.
4. Runs the pure reducer against immutable current state.
5. Validates invariants and per-viewer projection safety.
6. In one SQLite transaction, appends domain events and the command result, writes the new snapshot, and updates timer rows.
7. Updates in-memory actor state only after commit.
8. Broadcasts a separately projected message to every current socket.
9. Emits nothing and retains the old state if persistence fails.

Room creation, join, resume, disconnect, timer firing, TTL expiry, and removal also pass through serialized room or registry operations. TTL deletion is serialized against join/resume so a deleted room cannot be revived.

## Security and Privacy

- The server is the only authority for card identities, deck order, random state, timers, legal actions, and scores.
- Card and slot identifiers are opaque and never encode rank or suit.
- One projection module is the only path from engine state/events to WebSocket messages.
- Acknowledgements, errors, reconnect responses, presentation events, action logs, and snapshots all use explicit viewer-safe schemas; raw domain events are never sent.
- The draw pile exposes a count only. Only the current discard top is visible; buried discards are hidden.
- Removed-player out-of-play cards expose only a count.
- Earlier private peeks are not retained in reconnect views. Only a currently pending, unacknowledged reveal can be restored to its authorized player.
- The public action log records actors, actions, positions, penalties, pauses, and scoring, but never retains hidden or transient card ranks.
- Automated privacy tests serialize every outbound message type for every seat and assert exact card entitlement.
- Runtime non-production assertions reject a projection containing unauthorized card data.
- Reconnect secrets use cryptographic randomness, keyed digests, constant-time comparison, rotation, expiry, and controller generations.
- Join/resume endpoints use generic errors, frame-size limits, origin checks, and separate command/join/snap rate limits.
- Validate and normalize display names; render all user text as text, never HTML.
- Use same-origin HTTP/WebSocket locally, a strict CSP, security headers, and an exact development-origin allowlist.
- Structured logs redact tokens, payload fields containing private ranks, and any future sensitive values.
- SQLite uses restrictive file permissions where supported and deletes room, event, command, session, and snapshot rows after retention expiry.

## Web Experience

### Routes

| Route | Purpose |
|---|---|
| `/` | Create room, join by code, resume retained session, rules/tutorial links |
| `/room/:code` | Lobby, game table, pause state, summaries |
| `/rules` | Searchable and printable confirmed rules reference |
| `/tutorial` | Guided scripted game using the real engine offline |

### Core Components

- Lobby: display-name entry, roster, host badge, settings, room code/link sharing, start action.
- Table: responsive seat ring, stable card grids, draw pile, discard pile, drawn-card tray, action bar, active-turn/final-turn indicators, scoreboard.
- Snap: server-synchronized countdown, keyboard snap mode, target overlay, success/failure feedback, transfer prompt.
- Powers: use/skip prompt, accessible target selection, private reveal, Black King decision, public position-only swap animation.
- Lifecycle: connection banner, pause overlay, grace/removal controls, host migration, end-match confirmation.
- Results: round raw totals, caller adjustment explanation, cumulative scores, ready-up, final shared winners.
- Support: public rank-safe action log, settings for sound/volume/reduced motion/high contrast, keyboard-help dialog.

Accessibility is a release criterion:

- Real buttons for every actionable card/slot and semantic labels that never leak unknown ranks.
- Roving tab index and arrow-key navigation within card grids.
- Keyboard completion of create, join, draw, replace, discard, every power, snap, transfer, Cambio, ready-up, and host removal.
- Focus traps and focus restoration for every modal/private reveal.
- Polite and assertive live regions for turns, snap timing, private reveals, errors, pauses, penalties, and scores.
- WCAG 2.2 AA contrast; suits communicated by symbol and text, not color alone.
- At least 44px touch targets.
- Reduced-motion behavior that removes transforms without changing state.
- Sound unlocked only after a user gesture, with persistent mute/volume control.

Animations and sounds consume viewer-safe presentation events after state rendering. They cannot delay commands, authoritative rendering, or turn advancement. Event backlog collapses to the newest state when necessary.

The tutorial dynamically loads an isolated engine adapter with fixed decks, seeded randomness, and the same view/command shape used by the online table. It teaches setup, memory, normal turns, every power, correct and wrong snaps, transfer, Cambio, caller scoring, and match completion. It makes no network calls and stores only tutorial progress locally.

## Implementation Map and Build Sequence

### Phase 0: Repository and Quality Foundation

Create:

- Git repository, `.gitignore`, `.gitattributes`, `.editorconfig`, and local data exclusions.
- pnpm/Turborepo workspace and package skeletons.
- Strict shared TypeScript, ESLint flat configuration, Prettier, Vitest workspace, and Playwright configuration.
- Root scripts for `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:integration`, and `e2e`.
- `README.md`, `AGENTS.md`, `.env.example`, and initial architecture/rules documents.

Exit criteria:

- Clean install and empty-package lint/typecheck/test/build succeed.
- Import-boundary violations fail lint.
- Development and production-like command contracts are documented.

### Phase 1: Executable Rule and Transition Contract

Create:

- Canonical card, slot, seat, room, match, round, phase, timer, command, event, and error types.
- `docs/transition-contract.md` covering every command/timer and visibility rule.
- Deterministic clock and seeded random interfaces.
- Card catalog, deck construction/shuffle, stable grid layout, invariants, and test builders.

Exit criteria:

- All 54 cards have correct identity and value.
- Seeded shuffles are reproducible.
- Deal conserves cards and exposes only the bottom two cards to each owner.
- No initial discard is created.

### Phase 2: Core Turn, Cambio, Reshuffle, and Scoring Engine

Implement:

- Draw-only-from-stock turn transitions.
- Replace/discard behavior, including powers from displaced grid cards.
- Dealer rotation, active-seat order, zero-card turns, and holes.
- Cambio call, immutable final-turn queue, and all round-end reasons.
- Raw scoring, caller adjustment, cumulative standings, and shared winners.
- Buried-discard reshuffle and unsatisfied-draw safe ending.

Exit criteria:

- Scripted full rounds reproduce exact turn/final-turn order.
- Scoring branch tables cover unique caller win, caller tie, incorrect caller, zero/negative edge values, and non-Cambio endings.
- Replay of the same commands/seed produces identical state and events.

### Phase 3: Powers, Snaps, Concurrency Gate, and Removal

Implement:

- All optional power stages and target revalidation.
- Five-second snap window, unlimited failures, single success, penalties, own/opponent snaps, and transfers.
- Orthogonal power/snap/transfer completion gate.
- Pause-aware timer generations.
- Complete removal transition and withdrawn standings.

Exit criteria:

- Interleaving matrix covers each power with success, wrong attempt, transfer, target movement, disconnect, and removal.
- Exactly one correct snap wins under concurrent clients.
- Unlimited wrong attempts each add one card until a deterministic stock-exhaustion ending.
- Property tests prove card conservation and that no turn advances with unresolved obligations.

### Phase 4: Protocol, Projection, and Privacy Contract

Implement:

- Zod command, acknowledgement, state-message, event, view, and error registries.
- Protocol versioning and compatibility rejection.
- Engine-command and engine-view mapping.
- Per-viewer projections and rank-safe public action-log generation.
- Privacy test helpers and protocol fixtures for client/server parallel work.

Exit criteria:

- Every command/message validates against exactly one registered schema.
- Every reachable state projects safely for every seat.
- Private reveals appear only for their authorized viewer.
- DOM-ready view fixtures contain no hidden card mapping or credential material.

### Phase 5: Real-Time Server and Room Lifecycle

Implement:

- Fastify composition root, local static/dev integration, WebSocket gateway, origin/security middleware, and configuration validation.
- Room registry and FIFO room actors.
- Lobby create/join/config/start flows.
- Session issuance/resume/rotation, single-controller generations, and host migration.
- Server-owned clock/timers, disconnect pause, grace eligibility, removal, and end-match controls.
- Idempotency, stale revision handling, command serialization, and viewer-specific broadcasts.

Exit criteria:

- Multiple real WebSocket clients can create, join, start, and complete a round against an in-memory repository.
- Duplicate and changed-payload command IDs behave correctly.
- Unauthorized, stale, stale-window, removed-session, and out-of-phase commands are rejected without mutation.
- Disconnect and host migration behavior is deterministic.

### Phase 6: SQLite Persistence, Recovery, and Retention

Implement:

- Drizzle schema/migrations for rooms, seats/sessions, snapshots, domain events, command receipts, and timers.
- WAL setup and transactional persist-before-publish actor repository.
- Restart recovery, recovery pause/grace policy, timer generations, and command idempotency across restart.
- Empty-room retention and serialized deletion.

Exit criteria:

- Kill/restart scenarios restore turn, pending power, current reveal, snap/transfer state, cumulative scores, and valid sessions.
- Recovery starts paused, rotates timer generations, gives fresh recovery grace, and restarts open snap windows according to policy.
- Commit failure leaves in-memory and client state unchanged.
- A 24-hour empty room is completely deleted while connected rooms are retained.

### Phase 7: Web Session, Home, and Lobby

Implement:

- React/Vite foundation, router, design tokens, error boundaries, and socket connection state.
- Viewer-state store, revision handling, command sender, reconnect token rotation, and resumable-session cards.
- Home/create/join flows and complete lobby/host settings/share/start experience.
- Mock protocol adapter and fixtures so UI work is independent of server internals.

Exit criteria:

- Two browser contexts create and join a room using keyboard only.
- Token rotation replaces stored credentials and closes an old controller.
- Old revisions are ignored and gaps trigger safe resync.
- Home and lobby have no serious accessibility violations.

### Phase 8: Accessible Game Table and Interactions

Implement:

- Responsive seat/table layout, grids, piles, card tray, action bar, turn/final-turn status, scoreboard, and pause overlay.
- Every draw/replace/discard/Cambio interaction.
- Every power targeting/reveal/swap interaction.
- Snap targeting/countdown/failure/success/transfer interactions.
- Round and match summaries, ready-up, host removal, and abandonment.
- Keyboard model, focus management, live announcements, contrast, touch sizing, and reduced motion.

Exit criteria:

- Fixture-driven component tests cover every engine phase and prompt.
- A full round is playable with keyboard and screen reader semantics.
- No unknown rank appears in text, attributes, accessibility names, client logs, or stored state.
- Layout is usable at representative phone, tablet, laptop, and desktop sizes.

### Phase 9: Presentation Effects and Public History

Implement:

- State-independent card animations for deal, draw, replace, discard, snap, penalty, transfer, swap, reshuffle, reveal, and scoring.
- Sound sprite with gesture unlock and persistent controls.
- Rank-safe public log and event-to-copy mapping.
- Backlog collapse and effect-error containment.

Exit criteria:

- Effects never block state rendering or command availability.
- Reduced-motion mode removes transforms.
- Sound never autoplays before permission.
- Burst events converge immediately to the current authoritative state.

### Phase 10: Rules Reference and Guided Tutorial

Implement:

- Confirmed rules content with caller-scoring examples, online snap arbitration, disconnect behavior, and keyboard instructions.
- Searchable/printable rules route.
- Offline scripted tutorial driver, coach overlay, fixed scenarios, and progress persistence.

Exit criteria:

- Tutorial covers every required mechanic using engine transitions.
- Tutorial has no network access and cannot join an online room.
- Rules/tutorial are keyboard accessible, axe-clean, skippable, and replayable.

### Phase 11: End-to-End Hardening and Local Release

Implement:

- Multi-context Playwright journeys for full matches, races, disconnect/resume, removal, and restart.
- Seeded soak/fuzz harness.
- Production-like build in which Fastify serves the built SPA on one local origin.
- Final README, architecture, protocol, rules, and runbook documentation.
- Optional repository CI quality workflow; no deployment workflow.

Exit criteria:

- Clean-clone `pnpm install`, `pnpm dev`, and `pnpm build && pnpm start` workflows are reproducible.
- A multi-browser two-round E2E match completes with correct scores and shared winners.
- Snap races produce exactly one success.
- Mid-power and mid-snap disconnect/restart flows recover without leaks or duplicate actions.
- All lint, type, unit, property, integration, component, accessibility, and E2E checks pass.

## Test Strategy

| Layer | Coverage |
|---|---|
| Engine unit | Card values, every transition/rejection, powers, snaps, scoring, removal, reshuffle |
| Property | Card conservation, stable slots, legal-command availability, gate safety, replay determinism |
| Interleaving | Power/snap/transfer/removal orderings and target invalidation |
| Protocol | Schema registry, version changes, payload hashes, viewer-safe ack/error/event shapes |
| Privacy | Entitlement-based serialization of every message for every viewer and DOM rank scans |
| Server integration | Real WebSockets, room actor serialization, auth, idempotency, timers, rate limits |
| Persistence | Transaction rollback, migration idempotency, crash/restart, timer recovery, TTL deletion |
| Components | Every lobby/table/prompt/summary state, keyboard behavior, focus, reduced motion |
| Accessibility | Testing Library plus axe, Playwright axe, keyboard journeys, manual screen-reader runbook |
| E2E | Multiple isolated browser contexts creating, joining, playing, disconnecting, resuming, removing |
| Soak/fuzz | Hundreds of seeded rounds with invariants and leak assertions enabled |

Testing infrastructure:

- Inject a fake clock into all engine/server timing.
- Persist and inject seeded RNG state; ban direct `Date.now()` and `Math.random()` in the engine.
- Reuse named scripted decks for rule tests, server integration, E2E, and tutorial scenarios.
- Generate reachable state/command sequences with fast-check.
- Use temporary SQLite databases per persistence test.
- Add a test-only deterministic seed endpoint only when the server is explicitly running in test mode.

Target quality thresholds:

- Game engine: at least 95% line and branch coverage.
- Server: at least 85% line and branch coverage.
- Web interaction components: at least 75% line coverage, supplemented by E2E and accessibility checks.
- Zero critical or serious axe violations on shipped routes and modal states.

## Acceptance Criteria

### Rules

- A 2-6 player private match completes the configured fixed number of rounds with correct dealer rotation and starting order.
- The client cannot draw from discard, create an initial discard, replace into a hole, or trigger powers from snapped cards.
- Powers trigger from any normal discard candidate, including a displaced grid card, and remain optional.
- Every snap rule, wrong-attempt penalty, single winner, transfer, and power concurrency ordering matches this plan.
- Caller and non-caller scoring matches every confirmed branch, including shared round and match wins.
- Stock exhaustion, zero-card players, disconnects, removals, and every round-end reason terminate deterministically.

### Real-Time Correctness and Durability

- The server accepts no client-computed cards, random results, timers, legal actions, or scores.
- Duplicate commands do not double-apply; changed-payload ID reuse is rejected.
- A snap race has one winner based on server receive order.
- Ordinary disconnects pause state and preserve exact gameplay timer remainder.
- Restart recovery restores the complete match and applies the documented recovery timer policy.
- Grace expiry creates removal eligibility but never automatically removes a player.
- Removing any player in any phase preserves card conservation and releases or redirects every pending obligation.

### Privacy and Security

- No viewer receives hidden ranks, deck order, buried discard, removed-card ranks, another player's reveal, or reconnect secrets.
- No action log, server log, error, acknowledgement, URL, or DOM attribute leaks hidden information.
- A resumed seat has exactly one current controller and a rotated credential.
- Crafted out-of-turn, host-only, stale-window, stale-revision, and cross-seat commands fail safely.

### UX and Accessibility

- Every required flow is responsive and keyboard-completable.
- Screen readers receive clear turn, snap, reveal, pause, error, penalty, and score announcements.
- Unknown cards never expose rank in accessible text.
- Animation, sound, and public history improve feedback without changing authoritative timing.
- The tutorial and rules reference teach the exact implemented variant and its online timing model.

### Local Operation

- A new developer can install, run, test, build, and start the app from the README.
- Active games survive a local server restart and remain resumable within retention.
- Local data, secrets, generated artifacts, and test output are ignored by Git.

## Parallel Implementation Strategy

Parallel work begins only after the transition contract, engine model, and protocol fixtures are stable.

- Engine subagents own deck/scoring, turn/Cambio, and power/snap/removal modules behind one reviewed reducer contract.
- Server subagents own room/session transport and persistence/recovery behind repository and clock interfaces.
- Web subagents own lobby/session, accessible table interactions, and presentation/tutorial against frozen protocol fixtures.
- A single integration owner reviews boundary changes, protocol versioning, transition tables, and privacy projections.
- No subagent independently invents rule behavior; unresolved behavior is added to the decisions ledger before implementation.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Concurrent power and snap creates stuck or double-advanced turns | One completion gate, immutable power source, exact target revalidation, exhaustive interleaving tests |
| Snap fairness varies with network latency | Server receive-time arbitration, synchronized countdown, documented no-lag-compensation policy |
| Hidden card leakage through non-snapshot messages | Viewer-safe schemas for every outbound path, runtime assertions, property and DOM tests |
| Unlimited wrong snaps enable request spam | Logical attempts remain unlimited while transport-level per-seat/window rate limits protect availability |
| Disconnect/removal breaks card conservation or final-turn order | Atomic phase-aware removal transition and generated removal tests across every transient state |
| SQLite commit and in-memory state diverge | Pure next state, transaction before actor assignment/broadcast, injected failure tests |
| Crash timing makes snap recovery ambiguous | Explicit full-window restart policy after recovery rather than pretending exact crash-time knowledge |
| No turn timeout permits a connected player to stall | Host-confirmed match abandonment; clear UI identifies the pending player/action |
| Tutorial import pulls engine into online client logic | Isolated dynamically loaded tutorial package and linted online dependency boundaries |
| Multiple subagents diverge in a greenfield repository | Architecture/rules/transition documents and protocol fixtures land before parallel feature work |

## Decisions Ledger

- `cambio-game.com` is the baseline unless this plan records an override.
- Use only Black King power behavior from the alternate source.
- Jack/Queen swaps any two distinct occupied table positions.
- All powers are optional.
- Draw only from the face-down stock.
- Do not seed the discard pile.
- A normal-discarded power activates even when it was displaced from the grid.
- Snapped cards become public discard top, trigger no power, and open no new snap window.
- Own-discard snapping is legal.
- Snap targets can be any occupied face-down grid card, known or unknown.
- Wrong attempts are unlimited, publicly reveal the attempted card transiently, and each add a penalty.
- Successful opponent snaps choose the transfer card after success.
- Power and snap proceed concurrently; neither cancels the other.
- Fill the lowest stable hole with a penalty before appending a new slot.
- A late or invalidated snap is rejected without penalty.
- Keep earlier peeks out of client memory aids and public history.
- Keep buried discards and removed-player ranks hidden.
- A zero-card player remains until a later Cambio call.
- Caller ties score raw; incorrect callers score twice the highest raw total without a floor.
- Match length is configurable fixed rounds, default 9; cumulative ties are shared wins.
- Grace expiry makes a player removable but does not remove automatically.
- Host migration is immediate and is not reclaimed on reconnect.
- Removal keeps stable seats and completed scores but excludes withdrawn players from future standings.
- Server recovery grants fresh grace and restarts an open snap window at full duration after reconnect.
- Client prediction is disabled for online play.
