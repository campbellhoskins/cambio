import type { DomainEvent, MatchState, PlayerId, RoomId, TimerId, WindowId } from "@cambio/engine";
import type { RejectionCode } from "@cambio/protocol";

export type TimerKind = "snapWindow" | "reconnectGrace" | "emptyRoomTtl";
export type CommandReceiptStatus = "accepted" | "rejected";

export interface SessionRecord {
  readonly roomId: RoomId;
  readonly seatId: PlayerId;
  readonly sessionGeneration: number;
  readonly secretDigest: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly revokedAtMs: number | null;
}

export interface CommandReceiptRecord {
  readonly roomId: RoomId;
  readonly seatId: PlayerId;
  readonly sessionGeneration: number;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly status: CommandReceiptStatus;
  readonly revision: number;
  readonly commandType: string;
  readonly rejectionCode: RejectionCode | null;
}

export interface TimerRecord {
  readonly timerId: TimerId;
  readonly roomId: RoomId;
  readonly kind: TimerKind;
  readonly generation: number;
  readonly dueAtMs: number;
  readonly seatId?: PlayerId;
  readonly windowId?: WindowId;
  readonly remainingMs?: number;
}

export interface StoredRoom {
  readonly roomId: RoomId;
  readonly roomCode: string;
  readonly state: MatchState;
  readonly sessions: readonly SessionRecord[];
  readonly timers: readonly TimerRecord[];
  readonly deleted: boolean;
}

export interface PersistRoomCommit {
  readonly roomId: RoomId;
  readonly state: MatchState;
  readonly events: readonly DomainEvent[];
  readonly receipt?: CommandReceiptRecord;
  readonly sessions?: readonly SessionRecord[];
  readonly timers?: readonly TimerRecord[];
  readonly deleteRoom?: boolean;
}

export interface CreateRoomRecord {
  readonly roomId: RoomId;
  readonly roomCode: string;
  readonly state: MatchState;
  readonly sessions: readonly SessionRecord[];
  readonly timers?: readonly TimerRecord[];
}

export interface RoomRepository {
  createRoom(record: CreateRoomRecord): Promise<void>;
  getRoomByCode(roomCode: string): Promise<StoredRoom | null>;
  getRoom(roomId: RoomId): Promise<StoredRoom | null>;
  listRetainedRooms(): Promise<readonly StoredRoom[]>;
  getCommandReceipt(
    roomId: RoomId,
    seatId: PlayerId,
    sessionGeneration: number,
    commandId: string,
  ): Promise<CommandReceiptRecord | null>;
  commitRoom(commit: PersistRoomCommit): Promise<void>;
  deleteRoom(roomId: RoomId): Promise<void>;
}

interface MutableRoom {
  roomId: RoomId;
  roomCode: string;
  state: MatchState;
  sessions: Map<PlayerId, SessionRecord>;
  receipts: Map<string, CommandReceiptRecord>;
  timers: Map<TimerId, TimerRecord>;
  events: DomainEvent[];
  deleted: boolean;
}

export class InMemoryRoomRepository implements RoomRepository {
  private readonly roomsById = new Map<RoomId, MutableRoom>();
  private readonly roomIdsByCode = new Map<string, RoomId>();

  async createRoom(record: CreateRoomRecord): Promise<void> {
    if (this.roomIdsByCode.has(record.roomCode) || this.roomsById.has(record.roomId)) {
      throw new Error("room already exists");
    }

    const room: MutableRoom = {
      roomId: record.roomId,
      roomCode: record.roomCode,
      state: clone(record.state),
      sessions: new Map(record.sessions.map((session) => [session.seatId, clone(session)])),
      receipts: new Map(),
      timers: new Map((record.timers ?? []).map((timer) => [timer.timerId, clone(timer)])),
      events: [],
      deleted: false,
    };
    this.roomsById.set(room.roomId, room);
    this.roomIdsByCode.set(room.roomCode, room.roomId);
  }

  async getRoomByCode(roomCode: string): Promise<StoredRoom | null> {
    const roomId = this.roomIdsByCode.get(roomCode);
    return roomId === undefined ? null : this.getRoom(roomId);
  }

  async getRoom(roomId: RoomId): Promise<StoredRoom | null> {
    const room = this.roomsById.get(roomId);
    if (room === undefined || room.deleted) {
      return null;
    }

    return snapshot(room);
  }

  async listRetainedRooms(): Promise<readonly StoredRoom[]> {
    return [...this.roomsById.values()]
      .filter((room) => !room.deleted)
      .map((room) => snapshot(room));
  }

  async getCommandReceipt(
    roomId: RoomId,
    seatId: PlayerId,
    sessionGeneration: number,
    commandId: string,
  ): Promise<CommandReceiptRecord | null> {
    const room = this.roomsById.get(roomId);
    if (room === undefined || room.deleted) {
      return null;
    }

    return clone(room.receipts.get(receiptKey(seatId, sessionGeneration, commandId)) ?? null);
  }

  async commitRoom(commit: PersistRoomCommit): Promise<void> {
    const room = this.roomsById.get(commit.roomId);
    if (room === undefined || room.deleted) {
      throw new Error("room not found");
    }

    if (commit.deleteRoom === true) {
      room.deleted = true;
      this.roomIdsByCode.delete(room.roomCode);
      return;
    }

    room.state = clone(commit.state);
    room.events.push(...clone(commit.events));

    if (commit.receipt !== undefined) {
      room.receipts.set(
        receiptKey(
          commit.receipt.seatId,
          commit.receipt.sessionGeneration,
          commit.receipt.commandId,
        ),
        clone(commit.receipt),
      );
    }

    for (const session of commit.sessions ?? []) {
      room.sessions.set(session.seatId, clone(session));
    }

    if (commit.timers !== undefined) {
      room.timers = new Map(commit.timers.map((timer) => [timer.timerId, clone(timer)]));
    }
  }

  async deleteRoom(roomId: RoomId): Promise<void> {
    const room = this.roomsById.get(roomId);
    if (room === undefined || room.deleted) {
      return;
    }

    room.deleted = true;
    this.roomIdsByCode.delete(room.roomCode);
  }
}

export function receiptKey(
  seatId: PlayerId,
  sessionGeneration: number,
  commandId: string,
): string {
  return `${seatId}\u0000${sessionGeneration}\u0000${commandId}`;
}

function snapshot(room: MutableRoom): StoredRoom {
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    state: clone(room.state),
    sessions: [...room.sessions.values()].map((session) => clone(session)),
    timers: [...room.timers.values()].map((timer) => clone(timer)),
    deleted: room.deleted,
  };
}

function clone<T>(value: T): T {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value)) as T;
}
