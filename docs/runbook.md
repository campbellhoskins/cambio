# Runbook

Local operating commands for Cambio. Commands run from the repository root.

## Prerequisites

- Node.js from `.nvmrc` (`>=22.20.0 <23`).
- pnpm from `packageManager` (`pnpm@10.12.4`).
- Playwright Chromium for E2E: `pnpm exec playwright install chromium` if the browser is
  not already installed.

For this environment, shell commands were run with:

```sh
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22.20.0 >/dev/null 2>&1
```

## Verified commands

Observed on 2026-08-28 in `/Users/campbellhoskins/repos/cambio`.

| Command | Observed result |
|---|---|
| `pnpm install` | Passed after `rm -rf node_modules`; lockfile reused; native allowed build scripts completed. |
| `pnpm dev` | Script is wired as `turbo run dev --parallel` for package watchers plus server/web dev. Not run because it is persistent. |
| `pnpm build` | Passed for all 7 workspace packages. |
| `pnpm start` | Builds, then starts `@cambio/server`; serves `apps/web/dist`, API, and WebSocket on one origin. Verified with `CAMBIO_PORT=3301 CAMBIO_SQLITE_PATH=apps/server/data/clean-start.sqlite pnpm start`, `/healthz`, `/`, and a Chromium create-room lobby smoke. |
| `pnpm lint` | Passed for all 7 workspace packages. |
| `pnpm typecheck` | Passed for all 7 workspace packages. |
| `pnpm test` | Passed: 32 files, 171 tests. |
| `pnpm integration` | Passed: server integration, 1 file, 1 test. |
| `pnpm e2e` | Passed: top-level production-like Playwright suite, then web mock Playwright suite; 8 total tests. |
| `pnpm soak` | Passed: 400 seeded matches, 13,160 commands, 1,184 snap attempts, 1,556 power skips. |

## Everyday commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run server, web, and package watch tasks for development. The web dev server proxies `/rooms` to the server and forwards scoped WS cookies as headers. |
| `pnpm build` | Build every package with Turborepo. |
| `pnpm start` | Production-like local run: build, then serve the built SPA and API/WebSocket from Fastify on one origin. |
| `pnpm lint` | ESLint across workspace packages. |
| `pnpm typecheck` | TypeScript checks across workspace packages. |
| `pnpm test` | Unit, property, component, and server tests via the Vitest workspace. |
| `pnpm integration` | Real WebSocket server integration tests. |
| `pnpm e2e` | Production-like top-level Playwright suite and the web package Playwright suite. |
| `pnpm soak` | Deterministic seeded engine/projection soak harness. |
| `pnpm format` | Apply Prettier formatting. |
| `pnpm format:check` | Check Prettier formatting. |

## Local data and configuration

- `pnpm start` uses SQLite by default through `@cambio/server`.
- `CAMBIO_SQLITE_PATH` sets the database file. Without it, the server uses
  `apps/server/data/cambio.sqlite` from the repository root.
- SQLite runs in WAL mode. Expect `*.sqlite`, `*.sqlite-wal`, and `*.sqlite-shm` files
  beside the selected database path.
- `apps/server/data/` and SQLite sidecar files are git-ignored. Do not commit database
  files or copied local data.
- `CAMBIO_PORT` or `PORT` sets the HTTP port; default is `3000`.
- `CAMBIO_HOST` sets the bind host; default is `127.0.0.1`.
- `CAMBIO_ALLOWED_ORIGINS` may add comma-separated local origins. The server also allows
  the selected local origin and the Vite dev origins.
- `CAMBIO_SESSION_SECRET` sets the stable local HMAC key used to verify reconnect
  secrets across process restarts. If omitted, the local-only server uses a built-in
  development key.
- `CAMBIO_TEST_MODE=1` enables test-only fake-clock/recovery/state endpoints used by the
  top-level E2E suite. Do not use it for ordinary local play.

## Production-like same-origin local run

`pnpm start` builds the workspace and runs `apps/server/dist/index.js`. Fastify serves:

- `GET /` and SPA fallbacks from `apps/web/dist`.
- `POST /rooms`, `POST /rooms/:roomCode/join`, `POST /rooms/:roomCode/resume`.
- `GET /rooms/:roomCode/ws` on the same origin.

Browser WebSocket authentication uses a `cambio.auth.*` subprotocol plus short-lived,
path-scoped `cambio_ws_seat_id`, `cambio_ws_session_generation`, and
`cambio_ws_reconnect_secret` cookies. Node integration tests may still use the matching
`x-seat-id`, `x-session-generation`, and `x-reconnect-secret` headers.

Static responses include `Content-Security-Policy`, `X-Content-Type-Options`,
`Referrer-Policy`, and `X-Frame-Options`.

## Known limitations

- This release is local-only. There is no cloud deployment, hosted database, or CI
  deployment workflow in this runbook.
- `pnpm dev` is a persistent watch workflow; verify readiness manually by opening the web
  dev origin and creating a room.
- Test-only endpoints are available only with `CAMBIO_TEST_MODE=1`.
