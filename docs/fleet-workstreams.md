# Cambio implementation fleet

This document is the dispatch guide for a fresh Copilot CLI session. The portable
machine-readable graph is [`fleet-state.json`](fleet-state.json), and
[`fleet-bootstrap.sql`](fleet-bootstrap.sql) restores its 14 implementation todos to
the session SQL database. The three foundation todos are done. The eleven downstream
feature todos are intentionally pending.

## Authority and current state

Use `AGENTS.md`, `README.md`, and the documents in `docs/` as the repository authority.
In particular:

- `docs/rules.md` is the player-visible rules authority.
- `docs/transition-contract.md` is the command, timer, rejection, mutation, and
  visibility contract.
- `docs/architecture.md` is the package, actor, persistence, projection, privacy, and
  timer design.
- `docs/protocol.md` is the versioned wire and viewer-safety contract.
- `docs/runbook.md` is the local operating and validation guide.

The engine files currently present under `packages/engine/src` are a partial,
unvalidated implementation. Specifically, `packages/engine/src/model/*`, `deck.ts`,
`random.ts`, `scoring.ts`, and `index.ts` are not evidence that
`cambio-transition-contract` is complete. Inspect and test them as part of that
workstream.

## Dependency DAG

```text
cambio-foundation-docs ─┐
                        ├─ cambio-foundation
cambio-foundation-tooling┘
          │
          v
cambio-transition-contract
          │
          v
cambio-core-engine
          │
          v
cambio-concurrency-engine
          │
          v
cambio-protocol-privacy
          │
          v
cambio-realtime-server ───────┬─ cambio-persistence ───────┐
                              │                            │
                              └─ cambio-web-table ── cambio-presentation ─┤
                                      ^                                    │
                                      │                                    │
                              cambio-web-lobby                             │
                                                                           │
cambio-concurrency-engine ─────────────── cambio-tutorial ─────────────────┤
                                                                           v
                                                            cambio-release-hardening
```

The exact dependency rows are the ones in `fleet-state.json` and
`fleet-bootstrap.sql`; do not add inferred edges. `cambio-web-lobby` depends on
`cambio-protocol-privacy`. `cambio-web-table` depends on both
`cambio-realtime-server` and `cambio-web-lobby`. `cambio-tutorial` depends on both
`cambio-concurrency-engine` and `cambio-web-table`.

## Workstream dispatch

| Todo | Depends on | Ownership boundary | Recommended specialist/agent |
|---|---|---|---|
| `cambio-foundation` | foundation docs, tooling | Integrate repository-wide scaffolding; do not claim feature behavior | General-purpose |
| `cambio-foundation-docs` | — | Contract and architecture docs | `code-architect` |
| `cambio-foundation-tooling` | — | Workspace manifests and quality entry points | Task/build agent |
| `cambio-transition-contract` | foundation | Pure engine model, deterministic primitives, invariants, contract alignment | General-purpose engine agent |
| `cambio-core-engine` | transition contract | Normal turns, Cambio, round ends, scores | General-purpose engine agent |
| `cambio-concurrency-engine` | core engine | Powers, snaps, transfers, gates, timer generations, removal | General-purpose concurrency agent |
| `cambio-protocol-privacy` | concurrency engine | Zod DTOs and the single viewer-safe projection boundary | General-purpose protocol/privacy agent |
| `cambio-realtime-server` | protocol/privacy | Room actors, sessions, authorization, timers, broadcasts | General-purpose server agent |
| `cambio-persistence` | realtime server | SQLite schema/repositories, transactions, recovery, retention | General-purpose persistence agent |
| `cambio-web-lobby` | protocol/privacy | React connection, session, routing, and lobby | General-purpose web agent |
| `cambio-web-table` | realtime server, web lobby | Responsive authoritative table and all game interactions | General-purpose web/accessibility agent |
| `cambio-presentation` | web table | Effects, sound, motion, rank-safe history | General-purpose UI agent |
| `cambio-tutorial` | concurrency engine, web table | Offline tutorial and exact rules reference | General-purpose tutorial agent |
| `cambio-release-hardening` | persistence, presentation, tutorial | Full local release validation and operating docs | General-purpose release agent, followed by read-only code review |

Each worker owns only its listed boundary and its tests/docs needed to keep the
contracts synchronized. A worker must not silently redefine a rule, protocol shape,
package boundary, or dependency edge. Use a separate read-only review agent for a
completed change when the workstream calls for review; do not persist agent IDs in
repository documents.

## Ready work and status updates

After executing `fleet-bootstrap.sql`, find ready work with this SQL query. The
explicit ID list excludes temporary handoff records and prevents unrelated session
todos from entering the fleet:

```sql
SELECT t.id, t.title, t.status
FROM todos AS t
WHERE t.id IN (
  'cambio-foundation',
  'cambio-foundation-docs',
  'cambio-foundation-tooling',
  'cambio-transition-contract',
  'cambio-core-engine',
  'cambio-concurrency-engine',
  'cambio-protocol-privacy',
  'cambio-realtime-server',
  'cambio-persistence',
  'cambio-web-lobby',
  'cambio-web-table',
  'cambio-presentation',
  'cambio-tutorial',
  'cambio-release-hardening'
)
AND t.status = 'pending'
AND NOT EXISTS (
  SELECT 1
  FROM todo_deps AS d
  JOIN todos AS dependency ON dependency.id = d.depends_on
  WHERE d.todo_id = t.id
    AND dependency.status != 'done'
)
ORDER BY t.id;
```

Before starting a workstream:

```sql
UPDATE todos
SET status = 'in_progress'
WHERE id = 'cambio-transition-contract';
```

Replace the example ID with the claimed todo. On verified completion:

```sql
UPDATE todos
SET status = 'done'
WHERE id = 'cambio-transition-contract';
```

If work cannot proceed, record the concrete blocker in the todo description and use:

```sql
UPDATE todos
SET status = 'blocked',
    description = description || ' Blocker: <short factual blocker>.'
WHERE id = 'cambio-transition-contract';
```

Only mark a todo done after its exit criteria and targeted validation pass. Status
changes do not authorize changing dependency rows. Re-run the ready-work query after
each completed workstream.

## Parallelization gates

1. Foundation is the baseline. `cambio-foundation-docs` and
   `cambio-foundation-tooling` are already done; no feature work should bypass the
   foundation gate.
2. Complete and validate `cambio-transition-contract` before starting the core engine.
3. Complete `cambio-core-engine`, then `cambio-concurrency-engine`; the protocol/privacy
   boundary follows concurrency.
4. After `cambio-protocol-privacy` is done, `cambio-realtime-server` is the only next
   server gate. Lobby work may start only after protocol/privacy.
5. Once the realtime server is done, `cambio-persistence` and (with the protocol
   dependency already satisfied) `cambio-web-lobby` can proceed in parallel.
6. `cambio-web-table` waits for both the realtime server and lobby. Presentation waits
   for the table. Tutorial waits for both concurrency and table.
7. Release hardening waits for persistence, presentation, and tutorial. It is the final
   gate and must use a clean installed workspace.

Parallel workers must not edit the same implementation boundary concurrently. Keep
cross-boundary contract changes coordinated through the authoritative docs and
dependency order.

## Validation expectations

This handoff does not install dependencies or run packages. On the personal device,
follow `docs/runbook.md` to install the pinned toolchain first, then establish a
baseline with the narrowest applicable checks:

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

Use `pnpm integration` for actor/server/persistence changes, `pnpm e2e` for web,
accessibility, and multi-client changes, and `pnpm build` plus production-like
`pnpm start` before release hardening. Test engine work with deterministic seeds and
fake clocks; test protocol/server work for idempotency, stale generations, projection
privacy, and serialized races; test persistence across restart and retention; test web
work at responsive sizes with reduced motion and keyboard/screen-reader paths.

Do not treat a green typecheck as proof of rule correctness. Do not claim a command has
been run unless its output was observed on the current device. Do not invent a missing
rule or implementation status: inspect the repository and return to the docs when
something is ambiguous.
