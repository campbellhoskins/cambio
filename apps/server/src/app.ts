import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import type { RoomConfig } from "@cambio/engine";
import { PlayerIdSchema } from "@cambio/protocol";
import { RoomConfigSchema } from "@cambio/protocol";
import { InMemoryRoomRepository, type RoomRepository } from "./persistence.js";
import { FakeClock, SystemClock, TimeoutScheduler, type Clock, type Scheduler } from "./clock.js";
import { RoomRegistry } from "./registry.js";
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

export interface CreateCambioServerOptions {
  readonly repository?: RoomRepository;
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
  readonly allowedOrigins?: readonly string[];
  readonly maxPayloadBytes?: number;
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
  const repository = options.repository ?? new InMemoryRoomRepository();
  const registry = new RoomRegistry({ repository, clock, scheduler });
  const app = Fastify({
    logger: false,
    bodyLimit: options.maxPayloadBytes ?? 16_384,
  });
  const allowedOrigins = new Set(options.allowedOrigins ?? []);

  await app.register(websocket, {
    options: {
      maxPayload: options.maxPayloadBytes ?? 16_384,
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!originAllowed(request.headers.origin, allowedOrigins)) {
      await reply.code(403).send({ error: "forbidden" });
    }
  });

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
    const seatId = firstHeader(request.headers["x-seat-id"]);
    const generationText = firstHeader(request.headers["x-session-generation"]);
    const reconnectSecret = firstHeader(request.headers["x-reconnect-secret"]);
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

  return { app, registry, repository, clock };
}

function originAllowed(origin: string | undefined, allowedOrigins: ReadonlySet<string>): boolean {
  return origin === undefined || allowedOrigins.size === 0 || allowedOrigins.has(origin);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
