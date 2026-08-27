# Runbook

Intended local development and operating commands for this repository. This runbook
describes commands as designed against the current workspace scripts; only their
presence in `package.json`/`turbo.json` has been checked in this environment.
**Dependency installation has not been run here, and none of the commands below have
been executed or verified in this environment.** Run and verify them yourself before
relying on this document as confirmation that the build/test pipeline works end to end.

## Prerequisites

- Node.js pinned by `.nvmrc` (`>=22.20.0 <23`).
- pnpm, pinned via `packageManager` in `package.json` (`pnpm@10.12.4`). Use Corepack
  (`corepack enable`) or install this exact pnpm version directly.

## Install

```powershell
Copy-Item '.env.example' '.env'
pnpm install
```

Not yet run in this environment. Run this first; every command below depends on it.

## Everyday commands

All commands run from the repository root and fan out per-package via Turborepo unless
noted otherwise.

| Command | Purpose |
|---|---|
| `pnpm dev` | Run every package's `dev` task in parallel (server + web + watchers) |
| `pnpm build` | Build every package (`turbo run build`) |
| `pnpm start` | Run every package's `start` task against a production-like build |
| `pnpm lint` | Run ESLint across the workspace, including import-boundary rules |
| `pnpm typecheck` | Run TypeScript project-reference type checking across the workspace |
| `pnpm test` | Run the Vitest workspace (`vitest.workspace.ts`) for unit/rules/property tests |
| `pnpm integration` | Run integration tests (multi-client server/actor/persistence scenarios) |
| `pnpm e2e` | Run Playwright end-to-end and accessibility tests |
| `pnpm format` | Apply Prettier formatting to the whole repository |
| `pnpm format:check` | Check Prettier formatting without writing changes |

## Local data and configuration

- The server persists to a local SQLite database file (WAL mode). Expect a local,
  git-ignored data directory once `apps/server` implements persistence; do not commit
  database files.
- Copy `.env.example` to `.env` for local server configuration. Replace
  `CAMBIO_SESSION_SECRET` with a locally generated secret before starting the server.
  No cloud configuration is required; this release targets local-only operation.

## Recommended local workflow

1. `pnpm install`
2. `pnpm typecheck` and `pnpm lint` for a fast feedback loop while editing.
3. `pnpm test` for engine/protocol/unit-level changes.
4. `pnpm dev` to run the server and web client together for manual play-testing.
5. `pnpm integration` before merging server/persistence/timer changes.
6. `pnpm e2e` before merging web-client/accessibility changes.
7. `pnpm build` (and `pnpm start` against the build) before treating a change as
   production-like locally.

## Known limitations of this document

- This repository currently contains only package scaffolding (see `README.md` for
  status); most `dev`/`build`/`start`/`test` implementations referenced above may not
  yet exist in every package, so a given command may currently no-op, fail, or partially
  succeed depending on how far implementation has progressed.
- No cloud deployment, CI pipeline invocation, or hosting instructions are included;
  this release is local-only by design.
