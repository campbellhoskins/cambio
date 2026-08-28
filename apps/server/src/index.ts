import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCambioServer } from "./app.js";
import { FakeClock } from "./clock.js";

export * from "./actor.js";
export * from "./app.js";
export * from "./clock.js";
export * from "./mapping/index.js";
export * from "./persistence.js";
export * from "./projection/index.js";
export * from "./registry.js";
export * from "./sessions.js";
export * from "./sqlite-repository.js";

if (isMainModule()) {
  void startServer();
}

async function startServer(): Promise<void> {
  const port = Number(process.env.CAMBIO_PORT ?? process.env.PORT ?? 3000);
  const host = process.env.CAMBIO_HOST ?? "127.0.0.1";
  const testMode = process.env.CAMBIO_TEST_MODE === "1";
  const clock = testMode ? new FakeClock() : undefined;
  const server = await createCambioServer({
    sqlite: true,
    ...(clock === undefined ? {} : { clock, scheduler: clock }),
    allowedOrigins: allowedOrigins(host, port),
    webDistPath: defaultWebDistPath(),
    testMode,
    sessionKey: sessionKey(),
  });

  await server.registry.recoverFromRestart();
  await server.app.listen({ host, port });
  console.log(`Cambio server listening on http://${host}:${port}`);
}

function allowedOrigins(host: string, port: number): string[] {
  const configured = (process.env.CAMBIO_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const localHosts = new Set([
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
  for (const origin of configured) {
    localHosts.add(origin);
  }
  return [...localHosts];
}

function defaultWebDistPath(): string {
  const serverSourceDir = dirname(fileURLToPath(import.meta.url));
  return resolve(serverSourceDir, "../../web/dist");
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

function sessionKey(): Buffer {
  return createHash("sha256")
    .update(process.env.CAMBIO_SESSION_SECRET ?? "cambio-local-release-session-secret")
    .digest();
}
