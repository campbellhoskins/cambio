import { randomBytes, randomInt } from "node:crypto";
import {
  reduceCommand,
  type MatchState,
  type PlayerId,
  type RejectionCode,
  type RoomId,
  type RoomConfig,
} from "@cambio/engine";
import type { Clock, Scheduler } from "./clock.js";
import { RoomActor, type IssuedCredential, type ResumeSeatResult } from "./actor.js";
import type { RoomRepository, StoredRoom } from "./persistence.js";
import { SessionIssuer } from "./sessions.js";

export interface RoomRegistryOptions {
  readonly repository: RoomRepository;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly sessionIssuer?: SessionIssuer;
}

export interface CreateRoomInput {
  readonly displayName: string;
  readonly config?: Partial<RoomConfig>;
}

export interface JoinRoomResult extends IssuedCredential {
  readonly state: MatchState;
}

export class RoomRegistry {
  private readonly repository: RoomRepository;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly sessionIssuer: SessionIssuer;
  private readonly actors = new Map<RoomId, RoomActor>();
  private queue = Promise.resolve();

  constructor(options: RoomRegistryOptions) {
    this.repository = options.repository;
    this.clock = options.clock;
    this.scheduler = options.scheduler;
    this.sessionIssuer = options.sessionIssuer ?? new SessionIssuer({ nowMs: () => this.clock.nowMs() });
  }

  async createRoom(input: CreateRoomInput): Promise<JoinRoomResult | RejectionCode> {
    return this.serialize(async () => {
      const roomId = createId("room");
      const roomCode = await this.uniqueRoomCode();
      const seatId = createId("seat");
      const result = reduceCommand(null, {
        type: "createMatch",
        roomId,
        host: { playerId: seatId, displayName: input.displayName },
        seed: randomInt(1, 2_147_483_647),
        ...(input.config === undefined ? {} : { config: input.config }),
      });
      if (!result.ok) {
        return result.code;
      }

      const issued = this.sessionIssuer.create(roomId, seatId);
      await this.repository.createRoom({
        roomId,
        roomCode,
        state: result.state,
        sessions: [issued.record],
      });
      const actor = this.actorFrom({
        roomId,
        roomCode,
        state: result.state,
        sessions: [issued.record],
        timers: [],
        deleted: false,
      });
      return {
        roomId,
        roomCode,
        seatId,
        sessionGeneration: issued.record.sessionGeneration,
        reconnectSecret: issued.reconnectSecret,
        state: actor.snapshot(),
      };
    });
  }

  async joinRoom(roomCode: string, displayName: string): Promise<JoinRoomResult | RejectionCode> {
    return this.serialize(async () => {
      const actor = await this.actorByCode(roomCode);
      if (actor === null) {
        return "E_ROOM_NOT_FOUND";
      }

      const seatId = createId("seat");
      const issued = this.sessionIssuer.create(actor.roomId, seatId);
      const credential = await actor.addSeat({
        seatId,
        displayName,
        session: issued.record,
        reconnectSecret: issued.reconnectSecret,
      });
      if (typeof credential === "string") {
        return credential;
      }

      return {
        ...credential,
        reconnectSecret: issued.reconnectSecret,
        state: actor.snapshot(),
      };
    });
  }

  async resumeSession(
    roomCode: string,
    seatId: PlayerId,
    reconnectSecret: string,
  ): Promise<ResumeSeatResult | RejectionCode> {
    return this.serialize(async () => {
      const actor = await this.actorByCode(roomCode);
      if (actor === null) {
        return "E_ROOM_NOT_FOUND";
      }

      return actor.resumeSeat(seatId, reconnectSecret);
    });
  }

  async getActorByCode(roomCode: string): Promise<RoomActor | null> {
    return this.actorByCode(roomCode);
  }

  async getActor(roomId: RoomId): Promise<RoomActor | null> {
    const existing = this.actors.get(roomId);
    if (existing !== undefined) {
      return existing;
    }

    const room = await this.repository.getRoom(roomId);
    return room === null ? null : this.actorFrom(room);
  }

  async expireEmptyRoom(roomId: RoomId, generation: number): Promise<boolean> {
    return this.serialize(async () => {
      const actor = await this.getActor(roomId);
      if (actor === null) {
        return false;
      }

      const deleted = await actor.deleteIfEmpty(generation);
      if (deleted) {
        this.actors.delete(roomId);
      }
      return deleted;
    });
  }

  async recoverFromRestart(): Promise<void> {
    const rooms = await this.repository.listRetainedRooms();
    await Promise.all(rooms.map((room) => this.actorFrom(room).recoverAfterRestart()));
  }

  private async actorByCode(roomCode: string): Promise<RoomActor | null> {
    const room = await this.repository.getRoomByCode(roomCode);
    if (room === null) {
      return null;
    }

    return this.actors.get(room.roomId) ?? this.actorFrom(room);
  }

  private actorFrom(room: StoredRoom): RoomActor {
    const existing = this.actors.get(room.roomId);
    if (existing !== undefined) {
      return existing;
    }

    const actor = new RoomActor({
      room,
      repository: this.repository,
      clock: this.clock,
      scheduler: this.scheduler,
      sessionIssuer: this.sessionIssuer,
      onEmptyRoomTtl: (roomId, generation) => this.expireEmptyRoom(roomId, generation).then(() => undefined),
    });
    this.actors.set(room.roomId, actor);
    return actor;
  }

  private async uniqueRoomCode(): Promise<string> {
    for (let attempts = 0; attempts < 10; attempts += 1) {
      const code = randomCode();
      if (await this.repository.getRoomByCode(code) === null) {
        return code;
      }
    }

    return createId("code").slice(5, 17).toUpperCase();
  }

  private async serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function createId(prefix: string): string {
  return `${prefix}:${randomBytes(12).toString("base64url")}`;
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 10; index += 1) {
    code += alphabet[randomInt(0, alphabet.length)];
  }
  return code;
}
