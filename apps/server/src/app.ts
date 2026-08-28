import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import type { RoomConfig } from "@cambio/engine";
import { PlayerIdSchema } from "@cambio/protocol";
import { RoomConfigSchema } from "@cambio/protocol";
import { InMemoryRoomRepository, type RoomRepository } from "./persistence.js";
import { SqliteRoomRepository } from "./sqlite-repository.js";
import { FakeClock, SystemClock, TimeoutScheduler, type Clock, type Scheduler } from "./clock.js";
import { RoomRegistry } from "./registry.js";
import { SessionIssuer } from "./sessions.js";
import type { SeatController } from "./actor.js";

const DisplayNameSchema = z.string().trim().min(1).max(32);
const CreateRoomBodySchema = z.object({
  displayName: DisplayNameSchema,
  config: RoomConfigSchema.partial().strict().optional(),
}).strict();
const JoinRoomBodySchema = z.object({ displayName: DisplayNameSchema }).strict();
const ResumeBodySchema = z.object({
  seatId: PlayerIdSchema,
  reconnectSecret: z.string().min(1),
}).strict();
const TestClockAdvanceBodySchema = z.object({ ms: z.number().int().nonnegative() }).strict();
const WebSocketAuthProtocolSchema = z.object({
  seatId: PlayerIdSchema,
  sessionGeneration: z.number().int().nonnegative(),
  reconnectSecret: z.string().min(1),
}).strict();

export interface CreateCambioServerOptions {
  readonly repository?: RoomRepository;
  readonly sqlite?: boolean | { readonly path?: string };
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
  readonly allowedOrigins?: readonly string[];
  readonly maxPayloadBytes?: number;
  readonly webDistPath?: string;
  readonly testMode?: boolean;
  readonly sessionKey?: Buffer;
}

export interface CambioServer {
  readonly app: FastifyInstance;
  readonly registry: RoomRegistry;
  readonly repository: RoomRepository;
  readonly clock: Clock;
}

export async function createCambioServer(options: CreateCambioServerOptions = {}): Promise<CambioServer> {
  const clock = options.clock ?? new SystemClock();
  const scheduler = options.scheduler ?? (clock instanceof FakeClock ? clock : new TimeoutScheduler());
  const repository = options.repository ?? createRepository(options.sqlite);
  const registry = new RoomRegistry({
    repository,
    clock,
    scheduler,
    sessionIssuer: new SessionIssuer({
      ...(options.sessionKey === undefined ? {} : { key: options.sessionKey }),
      nowMs: () => clock.nowMs(),
    }),
  });
  const app = Fastify({
    logger: false,
    bodyLimit: options.maxPayloadBytes ?? 16_384,
  });
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const staticRoot = options.webDistPath === undefined ? undefined : resolve(options.webDistPath);

  await app.register(websocket, {
    options: {
      maxPayload: options.maxPayloadBytes ?? 16_384,
    },
  });
  app.addHook("onClose", async () => {
    if (repository instanceof SqliteRoomRepository) {
      repository.close();
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!originAllowed(request.headers.origin, allowedOrigins)) {
      await reply.code(403).send({ error: "forbidden" });
    }
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("content-security-policy", cspHeader());
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/rooms", async (request, reply) => {
    const parsed = CreateRoomBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendCode(reply, 400, "E_BAD_ENVELOPE");
    }

    const result = await registry.createRoom({
      displayName: parsed.data.displayName,
      ...(parsed.data.config === undefined ? {} : { config: definedConfig(parsed.data.config) }),
    });
    if (typeof result === "string") {
      return sendCode(reply, 400, result);
    }

    return {
      roomId: result.roomId,
      roomCode: result.roomCode,
      seatId: result.seatId,
      sessionGeneration: result.sessionGeneration,
      reconnectSecret: result.reconnectSecret,
    };
  });

  app.post("/rooms/:roomCode/join", async (request, reply) => {
    const parsed = JoinRoomBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendCode(reply, 400, "E_BAD_ENVELOPE");
    }

    const params = z.object({ roomCode: z.string().min(1) }).parse(request.params);
    const result = await registry.joinRoom(params.roomCode, parsed.data.displayName);
    if (typeof result === "string") {
      return sendCode(reply, statusFor(result), result);
    }

    return {
      roomId: result.roomId,
      roomCode: result.roomCode,
      seatId: result.seatId,
      sessionGeneration: result.sessionGeneration,
      reconnectSecret: result.reconnectSecret,
    };
  });

  app.post("/rooms/:roomCode/resume", async (request, reply) => {
    const parsed = ResumeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendCode(reply, 400, "E_BAD_ENVELOPE");
    }

    const params = z.object({ roomCode: z.string().min(1) }).parse(request.params);
    const result = await registry.resumeSession(
      params.roomCode,
      parsed.data.seatId,
      parsed.data.reconnectSecret,
    );
    if (typeof result === "string") {
      return sendCode(reply, statusFor(result), result);
    }

    return {
      roomId: result.roomId,
      roomCode: result.roomCode,
      seatId: result.seatId,
      sessionGeneration: result.sessionGeneration,
      reconnectSecret: result.reconnectSecret,
    };
  });

  app.get("/rooms/:roomCode/ws", { websocket: true }, async (socket, request) => {
    if (!originAllowed(request.headers.origin, allowedOrigins)) {
      socket.close(1008, "forbidden");
      return;
    }

    const params = z.object({ roomCode: z.string().min(1) }).parse(request.params);
    const cookies = parseCookies(firstHeader(request.headers.cookie));
    const subprotocolAuth = parseWebSocketAuthProtocol(firstHeader(request.headers["sec-websocket-protocol"]));
    const seatId = firstHeader(request.headers["x-seat-id"]) ?? subprotocolAuth?.seatId ?? cookies.cambio_ws_seat_id;
    const generationText = firstHeader(request.headers["x-session-generation"]) ?? subprotocolAuth?.sessionGenerationText ?? cookies.cambio_ws_session_generation;
    const reconnectSecret = firstHeader(request.headers["x-reconnect-secret"]) ?? subprotocolAuth?.reconnectSecret ?? cookies.cambio_ws_reconnect_secret;
    const sessionGeneration = generationText === undefined ? NaN : Number(generationText);
    if (seatId === undefined || reconnectSecret === undefined || !Number.isInteger(sessionGeneration)) {
      socket.close(1008, "unauthorized");
      return;
    }

    const actor = await registry.getActorByCode(params.roomCode);
    if (actor === null) {
      socket.close(1008, "unauthorized");
      return;
    }

    const authError = await actor.authenticateSeat(seatId, sessionGeneration, reconnectSecret);
    if (authError !== null) {
      socket.close(1008, "unauthorized");
      return;
    }

    const controller: SeatController = {
      seatId,
      sessionGeneration,
      send: (message) => socket.send(JSON.stringify(message)),
      close: (code, reason) => socket.close(code, reason),
    };
    const attachError = await actor.attachController(controller);
    if (attachError !== null) {
      return;
    }

    socket.on("message", (data: { readonly byteLength: number; toString(): string }) => {
      if (data.byteLength > (options.maxPayloadBytes ?? 16_384)) {
        socket.close(1009, "message too large");
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        controller.send({ type: "error", revision: actor.snapshot().revision, message: "Protocol error" });
        return;
      }

      void actor.submitCommand(seatId, raw);
    });
    socket.on("close", () => {
      void actor.detachController(seatId, sessionGeneration, controller);
    });
  });

  if (options.testMode === true && clock instanceof FakeClock) {
    app.post("/__test/clock/advance", async (request, reply) => {
      const parsed = TestClockAdvanceBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendCode(reply, 400, "E_BAD_ENVELOPE");
      }
      await clock.advanceBy(parsed.data.ms);
      return { epochMs: clock.nowMs() };
    });

    app.post("/__test/recover", async () => {
      await registry.recoverFromRestart();
      return { ok: true };
    });

    app.get("/__test/rooms/:roomCode/state", async (request, reply) => {
      const params = z.object({ roomCode: z.string().min(1) }).parse(request.params);
      const actor = await registry.getActorByCode(params.roomCode);
      if (actor === null) {
        return sendCode(reply, 404, "E_ROOM_NOT_FOUND");
      }
      return actor.snapshot();
    });
  }

  if (staticRoot !== undefined && await directoryExists(staticRoot)) {
    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      const url = new URL(request.url, "http://local.invalid");
      const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const filePath = safeStaticPath(staticRoot, requestedPath);
      const existing = filePath === null ? null : await existingFile(filePath);
      const responsePath = existing ?? join(staticRoot, "index.html");
      reply.type(contentType(responsePath));
      return reply.send(createReadStream(responsePath));
    };
    app.get("/", handler);
    app.get("/*", handler);
  }

  return { app, registry, repository, clock };
}

function createRepository(sqlite: CreateCambioServerOptions["sqlite"]): RoomRepository {
  if (sqlite !== undefined || process.env.CAMBIO_SQLITE_PATH !== undefined) {
    return new SqliteRoomRepository(
      typeof sqlite === "object" && sqlite.path !== undefined ? { path: sqlite.path } : {},
    );
  }

  return new InMemoryRoomRepository();
}

function originAllowed(origin: string | undefined, allowedOrigins: ReadonlySet<string>): boolean {
  return origin === undefined || allowedOrigins.size === 0 || allowedOrigins.has(origin);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined) {
    return {};
  }

  return Object.fromEntries(header.split(";").flatMap((part): readonly [string, string][] => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === undefined || rawName.length === 0) {
      return [];
    }

    try {
      return [[rawName, decodeURIComponent(rawValue.join("="))]];
    } catch {
      return [[rawName, rawValue.join("=")]];
    }
  }));
}

function parseWebSocketAuthProtocol(header: string | undefined): {
  readonly seatId: string;
  readonly sessionGenerationText: string;
  readonly reconnectSecret: string;
} | null {
  const token = header
    ?.split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("cambio.auth."));
  if (token === undefined) {
    return null;
  }

  try {
    const encoded = token.slice("cambio.auth.".length);
    const parsed = WebSocketAuthProtocolSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown,
    );
    return {
      seatId: parsed.seatId,
      sessionGenerationText: String(parsed.sessionGeneration),
      reconnectSecret: parsed.reconnectSecret,
    };
  } catch {
    return null;
  }
}

function statusFor(code: string): number {
  if (code === "E_ROOM_NOT_FOUND") {
    return 404;
  }

  if (code === "E_CREDENTIAL_INVALID" || code === "E_UNAUTHORIZED" || code === "E_STALE_SESSION") {
    return 401;
  }

  return 409;
}

async function sendCode(reply: FastifyReply, status: number, code: string): Promise<void> {
  await reply.code(status).send({ code });
}

function definedConfig(config: { readonly roundCount?: number | undefined; readonly snapWindowMs?: number | undefined; readonly playerCap?: number | undefined }): Partial<RoomConfig> {
  return {
    ...(config.roundCount === undefined ? {} : { roundCount: config.roundCount }),
    ...(config.snapWindowMs === undefined ? {} : { snapWindowMs: config.snapWindowMs }),
    ...(config.playerCap === undefined ? {} : { playerCap: config.playerCap }),
  };
}

function cspHeader(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  ].join("; ");
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function safeStaticPath(root: string, pathname: string): string | null {
  const normalized = normalize(pathname).replace(/^(\.\.(?:[/\\]|$))+/, "");
  const relative = normalized.startsWith(sep) ? normalized.slice(1) : normalized;
  if (relative.split(/[\\/]/).some((part) => part.startsWith("."))) {
    return null;
  }

  const candidate = resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

async function existingFile(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return null;
    }
    await access(path);
    return path;
  } catch {
    return null;
  }
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".webmanifest":
      return "application/manifest+json";
    default:
      return "application/octet-stream";
  }
}
