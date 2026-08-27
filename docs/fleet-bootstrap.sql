-- Restore the portable implementation graph without recreating the Copilot built-in tables.
-- Re-running this script intentionally resets foundation and downstream statuses below.

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-foundation', 'Establishing repository foundation', 'Implement plan Phase 0: initialize the repository and create the pnpm/Turborepo workspace, strict TypeScript, quality tooling, package skeletons, and baseline documentation.', 'done')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-foundation-docs', 'Documenting architecture and rules', 'Create README, AGENTS guidance, architecture, canonical rules, and executable transition-contract documentation for the greenfield workspace.', 'done')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-foundation-tooling', 'Scaffolding workspace tooling', 'Create root workspace configuration, package manifests, TypeScript configs, lint/format/test/build configuration, and package entry points without installing dependencies.', 'done')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-transition-contract', 'Defining executable rule contract', 'Implement plan Phase 1: define canonical domain types, deterministic clock/RNG, card/deck/setup foundations, invariants, and the command/timer transition contract.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-core-engine', 'Building core turn engine', 'Implement plan Phase 2: build normal turns, Cambio final-turn queues, dealer rotation, reshuffling, end reasons, scoring, and cumulative standings.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-concurrency-engine', 'Building power and snap engine', 'Implement plan Phase 3: build optional powers, snap races and penalties, opponent transfers, concurrent completion gates, timer generations, and deterministic removal.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-protocol-privacy', 'Defining protocol and privacy projections', 'Implement plan Phase 4: create versioned Zod wire contracts, server mapping, per-viewer projections, public logs, fixtures, and automated privacy assertions.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-realtime-server', 'Building real-time room server', 'Implement plan Phase 5: build Fastify/WebSocket room actors, lobby lifecycle, guest sessions, host migration, command authorization, idempotency, timers, and broadcasts.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-persistence', 'Adding persistence and recovery', 'Implement plan Phase 6: add SQLite migrations and repositories, transactional persist-before-publish, crash recovery, timer recovery policy, and 24-hour cleanup.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-web-lobby', 'Building web session and lobby', 'Implement plan Phase 7: build React routing, connection/state management, create/join/resume flows, host configuration, room sharing, and accessible lobby UI.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-web-table', 'Building accessible game table', 'Implement plan Phase 8: build responsive table rendering and every authoritative turn, power, snap, transfer, pause, removal, ready-up, and result interaction.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-presentation', 'Adding presentation effects and history', 'Implement plan Phase 9: add non-blocking card animations, sound controls, rank-safe action history, reduced-motion behavior, and effect backlog handling.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-tutorial', 'Building rules and tutorial', 'Implement plan Phase 10: add the exact rules reference and dynamically loaded offline guided tutorial covering every required mechanic.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO todos (id, title, description, status) VALUES
  ('cambio-release-hardening', 'Hardening the local release', 'Implement plan Phase 11: add multi-client E2E, race/recovery/privacy/accessibility/soak coverage, production-like local serving, and final operating documentation.', 'pending')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM todo_deps
WHERE todo_id IN (
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
OR depends_on IN (
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
);

INSERT INTO todo_deps (todo_id, depends_on) VALUES
  ('cambio-foundation', 'cambio-foundation-docs'),
  ('cambio-foundation', 'cambio-foundation-tooling'),
  ('cambio-transition-contract', 'cambio-foundation'),
  ('cambio-core-engine', 'cambio-transition-contract'),
  ('cambio-concurrency-engine', 'cambio-core-engine'),
  ('cambio-protocol-privacy', 'cambio-concurrency-engine'),
  ('cambio-realtime-server', 'cambio-protocol-privacy'),
  ('cambio-persistence', 'cambio-realtime-server'),
  ('cambio-web-lobby', 'cambio-protocol-privacy'),
  ('cambio-web-table', 'cambio-realtime-server'),
  ('cambio-web-table', 'cambio-web-lobby'),
  ('cambio-presentation', 'cambio-web-table'),
  ('cambio-tutorial', 'cambio-concurrency-engine'),
  ('cambio-tutorial', 'cambio-web-table'),
  ('cambio-release-hardening', 'cambio-persistence'),
  ('cambio-release-hardening', 'cambio-presentation'),
  ('cambio-release-hardening', 'cambio-tutorial');
