# Handoff

Start here when opening this repository in a new device or session.

## What this is

This is a personal repository intended for `campbellhoskins@gmail.com`. It is not a
team or organizational project. Cambio is a server-authoritative, real-time card game
for private rooms of 2-6 players; see `docs/rules.md` for the full rules.

## Current state

The workspace is greenfield scaffolding plus a partial engine foundation. Concretely:

- Phase 0 (repository, workspace tooling, and baseline documentation) is complete.
- Phase 1 (the executable rule/transition contract and the deterministic engine
  foundation) has been started but is **not** complete or validated. Some engine model
  files already exist under `packages/engine/src` (deck, card/id/state model, seeded
  random, scoring), but they are unvalidated partial work, not a finished phase. Treat
  them as a starting point to review and test, not as proof that any feature is done.
- No phase after Phase 1 has been started.

Dependency installation and every dependency-based validation command (`pnpm install`,
`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, etc.) were blocked by
work-device admin policy and were **not run** during this handoff. No claim in this
repository's documentation should be read as "verified to run" unless it says so
explicitly. Because install has never succeeded here, **no lockfile exists yet**; the
first successful `pnpm install` on a capable device will create it.

This release is local-only by design. No cloud deployment, hosting, or CI/CD deployment
step is in scope.

## Authoritative documents, in reading order

1. [`AGENTS.md`](AGENTS.md) - contributor/agent conventions and package boundaries.
2. [`docs/rules.md`](docs/rules.md) - the player-visible rules authority.
3. [`docs/architecture.md`](docs/architecture.md) - package, actor, persistence,
   projection, privacy, and timer design.
4. [`docs/transition-contract.md`](docs/transition-contract.md) - every command and
   internal timer: phase, actor, preconditions, mutation, rejection, visibility.
5. [`docs/protocol.md`](docs/protocol.md) - the versioned wire and viewer-safety
   contract.
6. [`docs/implementation-plan.md`](docs/implementation-plan.md) - the full approved
   end-to-end implementation plan (scope, rules, architecture, phased build sequence,
   test strategy, acceptance criteria, risks, and decisions ledger).
7. [`docs/runbook.md`](docs/runbook.md) - intended local development and operating
   commands (none have been executed in this environment).

If implementation and documentation ever disagree, treat the documents as authoritative
and reconcile the code, rather than assuming the code is correct.

## Source already present

- Root workspace: `package.json`, `pnpm-workspace.yaml`, `turbo.json`,
  `tsconfig.base.json`/`tsconfig.json`, `eslint.config.mjs`, `vitest.workspace.ts`,
  `.nvmrc`, and standard Git/editor/formatter dotfiles.
- `apps/server` and `apps/web`, and `packages/engine`, `packages/protocol`,
  `packages/ui`, `packages/tutorial`, `packages/testkit`: package manifests and
  TypeScript project configs exist for every package.
- `packages/engine/src`: partial, unvalidated Phase 1 work only - deck construction,
  card/id/state model types, a seeded random abstraction, and scoring helpers.
- No other implementation source exists yet. No `node_modules` and no lockfile exist.

## Resuming on a personal device

1. Clone/open this repository on the personal device.
2. Configure the clone's repository-local commit identity:
   `git config --local user.name "Campbell Hoskins"` and
   `git config --local user.email "campbellhoskins@gmail.com"`. Local Git configuration
   does not transfer with a clone.
3. Install the pinned toolchain and dependencies per `docs/runbook.md` (pinned Node via
   `.nvmrc`, pinned pnpm via `packageManager`, then `pnpm install`). This is the first
   time installation is expected to actually run.
4. Establish a baseline with the narrowest applicable checks first, then escalate:
   `pnpm typecheck`, `pnpm lint`, `pnpm test`; use `pnpm integration` for
   server/actor/persistence work, `pnpm e2e` for web/accessibility work, and
   `pnpm build` plus a production-like `pnpm start` before release hardening. Only
   report a command as passing if you observed it run.
5. Before resuming feature work, load the portable todo graph described below and use
   it (not chat memory) to find the next ready workstream.
6. Read [`docs/new-session-prompt.md`](docs/new-session-prompt.md) for the exact
   fresh-session bootstrap prompt, and the portable todo/dependency graph described
   there (a machine-readable state file, a SQL restoration script, and a workstream
   dispatch guide under `docs/`) for how to load implementation todos into a new
   session and pick up work in dependency order.

## Publishing this handoff

The repository was initialized on branch `main` with the repository-local identity
`Campbell Hoskins <campbellhoskins@gmail.com>`. Git identity configuration is local
metadata and is not committed. No GitHub remote is configured by this handoff.

After creating an empty repository under the personal GitHub account:

```powershell
git remote add origin 'https://github.com/<personal-github-username>/cambio.git'
git push -u origin main
```

Push authentication is separate from commit identity. Authenticate Git Credential
Manager or GitHub CLI with the personal account before pushing.
