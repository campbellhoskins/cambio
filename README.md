# Cambio

Cambio is a real-time, server-authoritative card game for private groups of 2-6 players,
played online in a shared room. This repository is a TypeScript monorepo containing the
game engine, wire protocol, real-time server, web client, and an offline tutorial that
reuses the same engine.

## Project status

This repository is in early, active development. The rules engine, real-time server,
persistence layer, and web client described in this documentation **are not yet
implemented**. Repository scaffolding, package skeletons, and a partial unvalidated
engine foundation currently exist. Nothing here is runnable or playable yet. Treat the
documents below as the target design that implementation work is converging toward, not
a description of shipped behavior.

Start with [`HANDOFF.md`](HANDOFF.md) when resuming this work on another device or in a
new Copilot session.

## Documentation

| Document | Contents |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | Current state and personal-device resume instructions |
| [`docs/rules.md`](docs/rules.md) | Authoritative Cambio rules: setup, turns, powers, snaps, scoring |
| [`docs/architecture.md`](docs/architecture.md) | Package boundaries, actor/persistence/projection/privacy/timer design |
| [`docs/transition-contract.md`](docs/transition-contract.md) | Every command and internal timer: phase, actor, preconditions, mutation, rejection, visibility |
| [`docs/protocol.md`](docs/protocol.md) | Wire envelope, idempotency, session generations, window identifiers, viewer-safe messages |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Approved phased implementation plan and acceptance criteria |
| [`docs/fleet-workstreams.md`](docs/fleet-workstreams.md) | Portable todo DAG, ownership, and fleet dispatch guide |
| [`docs/new-session-prompt.md`](docs/new-session-prompt.md) | Copy-paste prompt for reconstructing the fleet in a new session |
| [`docs/runbook.md`](docs/runbook.md) | Intended local development and operating commands |
| [`AGENTS.md`](AGENTS.md) | Conventions for contributors and coding agents working in this repository |

## Intended package layout

```text
cambio/
  apps/
    server/    Fastify + WebSocket real-time authority, persistence, sessions, timers
    web/       React client rendering only authoritative server views
  packages/
    engine/     Framework-free, pure game rules and state transitions
    protocol/   Zod schemas for commands, messages, views, and errors
    ui/         Presentation components with no game rule logic
    tutorial/   Offline scripted tutorial reusing the engine
    testkit/    Shared test builders, fixtures, fake clock, scripted decks
  e2e/          Playwright end-to-end tests
  docs/         This documentation set
```

`apps/server`, `apps/web`, and `packages/engine|protocol|ui|tutorial|testkit` currently
exist only as package skeletons; most subdirectories and implementation files described
above are not yet created.

## Getting started

See [`docs/runbook.md`](docs/runbook.md) for the intended local commands. Dependencies
have not been installed in this environment, and the commands have not yet been executed
or verified end to end.
