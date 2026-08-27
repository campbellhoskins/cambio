# AGENTS.md

Instructions for contributors and coding agents working in this repository.

## Project

Cambio is a server-authoritative, real-time card game for private rooms of 2-6 players.
See [`docs/rules.md`](docs/rules.md) for the game rules and [`docs/architecture.md`](docs/architecture.md)
for the system design. The repository is under active early development; do not assume
any runtime behavior beyond what a package actually implements.

## Package boundaries

These boundaries are enforced by ESLint import restrictions and package manifests. Do not
introduce an import that violates them:

- `packages/engine` is framework-free. It imports no protocol, Node, browser, server, or
  web code. It depends only on its own modules and a seeded random/clock abstraction.
- `packages/protocol` depends only on Zod. It defines external command/message/view/error
  DTOs and never contains game rule logic.
- `apps/server` maps validated protocol commands to engine commands and maps engine state
  to per-viewer protocol views. It is the only package that touches persistence and holds
  full (unredacted) domain state.
- `packages/ui` consumes protocol view types only. It contains no online game rules.
- `apps/web` depends on `protocol` and `ui` for online play. It never evaluates
  authoritative rules and never predicts hidden state.
- `packages/tutorial` depends on `engine`, `protocol`, and `ui` behind a dynamically
  loaded `/tutorial` route. It is the only client-bundled use of `engine` and never
  connects to an online room.
- `packages/testkit` may depend on `engine` and `protocol` only.

## Documentation as contract

`docs/transition-contract.md` and `docs/protocol.md` are the coordination boundary
between engine, protocol, server, and client implementation work. Update the relevant
doc in the same change that adds or alters a command, internal timer, message, or
rejection code. Do not let these docs drift from implemented behavior.

## Comment and documentation style

- Default to no comments. Add a comment only when the code is not self-explanatory from
  names and structure.
- A comment or doc sentence states what the code does or a fact needed to use it
  correctly. It never explains why a decision was made, records history, or references
  external plans, tickets, or discussions.
- Do not restate an identifier's name in prose.
- Keep documentation concise and implementation-grade: prefer tables and short
  declarative statements over narrative explanation.

## Privacy and authority rules

- The server is the only authority for card identities, deck order, random state,
  timers, legal actions, and scores.
- Card and slot identifiers are opaque and never encode rank or suit.
- Only one projection module may turn engine state/events into WebSocket messages.
- Never send a raw domain event to a client. Every outbound message uses an explicit
  viewer-safe schema.

## Working conventions

- Use strict TypeScript throughout.
- Prefer editing existing files over introducing parallel/duplicate implementations.
- Keep the game engine deterministic: no wall-clock reads, no non-seeded randomness, and
  no I/O inside `packages/engine`.
- See [`docs/runbook.md`](docs/runbook.md) for local commands. Do not assume a command
  has been verified in this environment unless the runbook says so.
