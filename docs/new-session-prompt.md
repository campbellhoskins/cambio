# Fresh-session fleet prompt

Copy the prompt below verbatim into a new Copilot CLI session opened at the Cambio
repository. It is intentionally self-contained and treats repository documentation as
the durable authority rather than chat history or a prior session database.

```text
You are resuming implementation of the Cambio repository in fleet/autopilot mode.
Work from the repository checkout and do not rely on any previous chat, agent IDs, or
session database state.

First inspect the repository, AGENTS.md, README.md, and all authoritative documents in
docs/. Start with HANDOFF.md and docs/implementation-plan.md. Read
docs/fleet-state.json, docs/fleet-bootstrap.sql, and docs/fleet-workstreams.md. Treat
those files plus docs/rules.md, docs/transition-contract.md, docs/architecture.md,
docs/protocol.md, and docs/runbook.md as the source of truth. Do not invent rules,
dependencies, statuses, package boundaries, or validation expectations. If
implementation and documentation disagree, stop and reconcile against the
authoritative contract before proceeding.

Use the Copilot session SQL tool to load and execute the complete contents of
docs/fleet-bootstrap.sql. Do not recreate the built-in todos or todo_deps tables.
Verify with SQL that exactly the 14 portable implementation todos are present in the
graph, that the three foundation todos are done, that all eleven downstream feature
todos are pending, and that dependency rows match docs/fleet-state.json. Ignore
temporary handoff todos; do not make them part of the portable graph.

Inspect the current files and status before claiming any phase is complete. In
particular, packages/engine/src/model/*, deck.ts, random.ts, scoring.ts, and index.ts
are partial unvalidated implementation, not a completed cambio-transition-contract
phase. Review and validate them when that todo becomes ready. Do not assume README
scaffolding statements or existing source files prove feature completion.

On this personal device, install the pinned dependencies using the commands in
docs/runbook.md. Installation is allowed here even though the handoff creation did not
install anything. Run the baseline checks after installation, using the narrowest
applicable existing commands and then escalating as needed:
pnpm typecheck
pnpm lint
pnpm test
Use pnpm integration for server/actor/persistence work, pnpm e2e for browser and
accessibility work, and pnpm build plus production-like pnpm start before release
hardening. Never report an unobserved command as passing.

Before making a commit, configure the clone's repository-local identity with
`git config --local user.name "Campbell Hoskins"` and
`git config --local user.email "campbellhoskins@gmail.com"`. Push authentication must
also use the personal GitHub account; commit identity and remote authentication are
separate.

Resume strictly according to the dependency DAG in docs/fleet-workstreams.md. Query
ready work with the documented SQL. Before starting a ready todo, set its status to
in_progress with the SQL tool. Dispatch equivalent work to the recommended specialist
or agent type from the workstream table, respecting ownership boundaries and avoiding
overlapping edits. Do not persist agent IDs. Keep protocol, rules, transition, and
architecture docs synchronized with implementation changes.

After a workstream meets every exit criterion and its targeted validation passes, set
that todo to done with the SQL tool. If a factual blocker prevents progress, set it to
blocked and append a concise blocker to its description. Re-run the ready-work query
after each status change. Never mark a downstream todo done early, never change
dependency edges because work is inconvenient, and never claim the partial engine phase
is complete without tests and contract review.

Continue autonomously in fleet/autopilot mode until all currently ready work is
complete or a concrete blocker is recorded. At the end, summarize completed work,
validation observed, remaining ready/pending/blocked todos, and any blockers. Do not
ask the user to reconstruct context that is already present in the repository docs.
```
