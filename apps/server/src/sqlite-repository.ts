import { existsSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import type { DomainEvent, MatchState, PlayerId, RejectionCode, RoomId } from "@cambio/engine";
import type {
  CommandReceiptRecord,
  CreateRoomRecord,
  PersistRoomCommit,
  RoomRepository,
  SessionRecord,
  StoredRoom,
  TimerKind,
  TimerRecord,
} from "./persistence.js";
import { sqliteSchema } from "./sqlite-schema.js";

export interface SqliteRoomRepositoryOptions {
  readonly path?: string;
}

interface RoomRow {
  readonly room_id: string;
  readonly room_code: string;
}

interface SnapshotRow {
  readonly state_json: string;
}

interface SessionRow {
  readonly room_id: string;
  readonly seat_id: string;
  readonly session_generation: number;
  readonly secret_digest: string;
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
  readonly revoked_at_ms: number | null;
}

interface ReceiptRow {
  readonly room_id: string;
  readonly seat_id: string;
  readonly session_generation: number;
  readonly command_id: string;
  readonly payload_hash: string;
  readonly status: "accepted" | "rejected";
  readonly revision: number;
  readonly command_type: string;
  readonly rejection_code: RejectionCode | null;
}

interface TimerRow {
  readonly room_id: string;
  readonly timer_id: string;
  readonly kind: TimerKind;
  readonly generation: number;
  readonly due_at_ms: number;
  readonly seat_id: string | null;
  readonly window_id: string | null;
  readonly remaining_ms: number | null;
}

export class SqliteRoomRepository implements RoomRepository {
  private readonly database: BetterSqliteDatabase;

  constructor(options: SqliteRoomRepositoryOptions = {}) {
    const databasePath = options.path ?? defaultSqlitePath();
    ensureDatabaseParent(databasePath);
    const existed = existsSync(databasePath);
    this.database = new Database(databasePath);
    if (!existed) {
      chmodSync(databasePath, 0o600);
    }

    void drizzle(this.database, { schema: sqliteSchema });
    configureDatabase(this.database);
    runMigrations(this.database);
  }

  async createRoom(record: CreateRoomRecord): Promise<void> {
    const create = this.database.transaction((room: CreateRoomRecord) => {
      if (this.findRoomIdByCode(room.roomCode) !== null || this.findRoomRow(room.roomId) !== null) {
        throw new Error("room already exists");
      }

      const nowMs = Date.now();
      this.database.prepare(`
        INSERT INTO rooms (room_id, room_code, created_at_ms, updated_at_ms)
        VALUES (@roomId, @roomCode, @createdAtMs, @updatedAtMs)
      `).run({
        roomId: room.roomId,
        roomCode: room.roomCode,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      });
      this.writeSnapshot(room.roomId, room.state, nowMs);
      this.upsertSessions(room.sessions);
      this.replaceTimers(room.roomId, room.timers ?? []);
    });
    create(record);
  }

  async getRoomByCode(roomCode: string): Promise<StoredRoom | null> {
    const roomId = this.findRoomIdByCode(roomCode);
    return roomId === null ? null : this.getRoom(roomId);
  }

  async getRoom(roomId: RoomId): Promise<StoredRoom | null> {
    const room = this.findRoomRow(roomId);
    if (room === null) {
      return null;
    }

    return this.loadStoredRoom(room);
  }

  async listRetainedRooms(): Promise<readonly StoredRoom[]> {
    const rows = this.database.prepare(`
      SELECT room_id, room_code
      FROM rooms
      ORDER BY created_at_ms, rowid
    `).all() as RoomRow[];
    return rows.map((room) => this.loadStoredRoom(room));
  }

  async getCommandReceipt(
    roomId: RoomId,
    seatId: PlayerId,
    sessionGeneration: number,
    commandId: string,
  ): Promise<CommandReceiptRecord | null> {
    if (this.findRoomRow(roomId) === null) {
      return null;
    }

    const row = this.database.prepare(`
      SELECT room_id, seat_id, session_generation, command_id, payload_hash, status, revision, command_type, rejection_code
      FROM command_receipts
      WHERE room_id = ? AND seat_id = ? AND session_generation = ? AND command_id = ?
    `).get(roomId, seatId, sessionGeneration, commandId) as ReceiptRow | undefined;
    return row === undefined ? null : receiptFromRow(row);
  }

  async commitRoom(commit: PersistRoomCommit): Promise<void> {
    const commitTransaction = this.database.transaction((next: PersistRoomCommit) => {
      if (this.findRoomRow(next.roomId) === null) {
        throw new Error("room not found");
      }

      if (next.deleteRoom === true) {
        this.database.prepare("DELETE FROM rooms WHERE room_id = ?").run(next.roomId);
        return;
      }

      const nowMs = Date.now();
      this.appendEvents(next.roomId, next.state.revision, next.events, nowMs);
      if (next.receipt !== undefined) {
        this.upsertReceipt(next.receipt);
      }
      this.writeSnapshot(next.roomId, next.state, nowMs);
      if (next.timers !== undefined) {
        this.replaceTimers(next.roomId, next.timers);
      }
      if (next.sessions !== undefined) {
        this.upsertSessions(next.sessions);
      }
      this.database.prepare("UPDATE rooms SET updated_at_ms = ? WHERE room_id = ?").run(nowMs, next.roomId);
    });
    commitTransaction(commit);
  }

  async deleteRoom(roomId: RoomId): Promise<void> {
    this.database.prepare("DELETE FROM rooms WHERE room_id = ?").run(roomId);
  }

  close(): void {
    this.database.close();
  }

  private findRoomIdByCode(roomCode: string): RoomId | null {
    const row = this.database.prepare("SELECT room_id FROM rooms WHERE room_code = ?")
      .get(roomCode) as { readonly room_id: RoomId } | undefined;
    return row?.room_id ?? null;
  }

  private findRoomRow(roomId: RoomId): RoomRow | null {
    const row = this.database.prepare("SELECT room_id, room_code FROM rooms WHERE room_id = ?")
      .get(roomId) as RoomRow | undefined;
    return row ?? null;
  }

  private loadStoredRoom(room: RoomRow): StoredRoom {
    const snapshot = this.database.prepare("SELECT state_json FROM snapshots WHERE room_id = ?")
      .get(room.room_id) as SnapshotRow | undefined;
    if (snapshot === undefined) {
      throw new Error(`room snapshot missing: ${room.room_id}`);
    }

    const state = parseJson<MatchState>(snapshot.state_json);
    const sessions = (this.database.prepare(`
      SELECT room_id, seat_id, session_generation, secret_digest, created_at_ms, updated_at_ms, revoked_at_ms
      FROM sessions
      WHERE room_id = ?
    `).all(room.room_id) as SessionRow[]).map(sessionFromRow);
    const seatOrder = new Map(state.seats.map((seat, index) => [seat.playerId, index]));
    sessions.sort((left, right) =>
      (seatOrder.get(left.seatId) ?? Number.MAX_SAFE_INTEGER) -
      (seatOrder.get(right.seatId) ?? Number.MAX_SAFE_INTEGER) ||
      left.createdAtMs - right.createdAtMs ||
      left.seatId.localeCompare(right.seatId)
    );

    const timers = (this.database.prepare(`
      SELECT room_id, timer_id, kind, generation, due_at_ms, seat_id, window_id, remaining_ms
      FROM timers
      WHERE room_id = ?
      ORDER BY timer_index
    `).all(room.room_id) as TimerRow[]).map(timerFromRow);
    return {
      roomId: room.room_id as RoomId,
      roomCode: room.room_code,
      state,
      sessions,
      timers,
      deleted: false,
    };
  }

  private writeSnapshot(roomId: RoomId, state: MatchState, updatedAtMs: number): void {
    this.database.prepare(`
      INSERT INTO snapshots (room_id, revision, state_json, updated_at_ms)
      VALUES (@roomId, @revision, @stateJson, @updatedAtMs)
      ON CONFLICT(room_id) DO UPDATE SET
        revision = excluded.revision,
        state_json = excluded.state_json,
        updated_at_ms = excluded.updated_at_ms
    `).run({
      roomId,
      revision: state.revision,
      stateJson: JSON.stringify(state),
      updatedAtMs,
    });
  }

  private appendEvents(
    roomId: RoomId,
    revision: number,
    events: readonly DomainEvent[],
    createdAtMs: number,
  ): void {
    const statement = this.database.prepare(`
      INSERT INTO domain_events (room_id, revision, event_index, event_type, event_json, created_at_ms)
      VALUES (@roomId, @revision, @eventIndex, @eventType, @eventJson, @createdAtMs)
    `);
    events.forEach((event, eventIndex) => {
      statement.run({
        roomId,
        revision,
        eventIndex,
        eventType: event.type,
        eventJson: JSON.stringify(event),
        createdAtMs,
      });
    });
  }

  private upsertReceipt(receipt: CommandReceiptRecord): void {
    this.database.prepare(`
      INSERT INTO command_receipts (
        room_id, seat_id, session_generation, command_id, payload_hash, status, revision, command_type, rejection_code
      )
      VALUES (
        @roomId, @seatId, @sessionGeneration, @commandId, @payloadHash, @status, @revision, @commandType, @rejectionCode
      )
      ON CONFLICT(room_id, seat_id, session_generation, command_id) DO UPDATE SET
        payload_hash = excluded.payload_hash,
        status = excluded.status,
        revision = excluded.revision,
        command_type = excluded.command_type,
        rejection_code = excluded.rejection_code
    `).run(receipt);
  }

  private upsertSessions(sessions: readonly SessionRecord[]): void {
    const statement = this.database.prepare(`
      INSERT INTO sessions (
        room_id, seat_id, session_generation, secret_digest, created_at_ms, updated_at_ms, revoked_at_ms
      )
      VALUES (
        @roomId, @seatId, @sessionGeneration, @secretDigest, @createdAtMs, @updatedAtMs, @revokedAtMs
      )
      ON CONFLICT(room_id, seat_id) DO UPDATE SET
        session_generation = excluded.session_generation,
        secret_digest = excluded.secret_digest,
        created_at_ms = excluded.created_at_ms,
        updated_at_ms = excluded.updated_at_ms,
        revoked_at_ms = excluded.revoked_at_ms
    `);
    for (const session of sessions) {
      statement.run(session);
    }
  }

  private replaceTimers(roomId: RoomId, timers: readonly TimerRecord[]): void {
    this.database.prepare("DELETE FROM timers WHERE room_id = ?").run(roomId);
    const statement = this.database.prepare(`
      INSERT INTO timers (
        room_id, timer_id, timer_index, kind, generation, due_at_ms, seat_id, window_id, remaining_ms
      )
      VALUES (
        @roomId, @timerId, @timerIndex, @kind, @generation, @dueAtMs, @seatId, @windowId, @remainingMs
      )
    `);
    timers.forEach((timer, timerIndex) => {
      statement.run({
        roomId: timer.roomId,
        timerId: timer.timerId,
        timerIndex,
        kind: timer.kind,
        generation: timer.generation,
        dueAtMs: timer.dueAtMs,
        seatId: timer.seatId ?? null,
        windowId: timer.windowId ?? null,
        remainingMs: timer.remainingMs ?? null,
      });
    });
  }
}

function configureDatabase(database: BetterSqliteDatabase): void {
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("temp_store = MEMORY");
}

function runMigrations(database: BetterSqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL UNIQUE,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      room_id TEXT PRIMARY KEY REFERENCES rooms(room_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      seat_id TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      secret_digest TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      revoked_at_ms INTEGER,
      PRIMARY KEY (room_id, seat_id)
    );

    CREATE TABLE IF NOT EXISTS domain_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      event_index INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command_receipts (
      room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      seat_id TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      command_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
      revision INTEGER NOT NULL,
      command_type TEXT NOT NULL,
      rejection_code TEXT,
      PRIMARY KEY (room_id, seat_id, session_generation, command_id)
    );

    CREATE TABLE IF NOT EXISTS timers (
      room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      timer_id TEXT NOT NULL,
      timer_index INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('snapWindow', 'reconnectGrace', 'emptyRoomTtl')),
      generation INTEGER NOT NULL,
      due_at_ms INTEGER NOT NULL,
      seat_id TEXT,
      window_id TEXT,
      remaining_ms INTEGER,
      PRIMARY KEY (room_id, timer_id)
    );

    CREATE INDEX IF NOT EXISTS domain_events_room_revision_idx
      ON domain_events(room_id, revision, event_id);
    CREATE INDEX IF NOT EXISTS timers_due_idx
      ON timers(kind, due_at_ms);
    PRAGMA user_version = 1;
  `);
}

function receiptFromRow(row: ReceiptRow): CommandReceiptRecord {
  return {
    roomId: row.room_id as RoomId,
    seatId: row.seat_id,
    sessionGeneration: row.session_generation,
    commandId: row.command_id,
    payloadHash: row.payload_hash,
    status: row.status,
    revision: row.revision,
    commandType: row.command_type,
    rejectionCode: row.rejection_code,
  };
}

function sessionFromRow(row: SessionRow): SessionRecord {
  return {
    roomId: row.room_id as RoomId,
    seatId: row.seat_id,
    sessionGeneration: row.session_generation,
    secretDigest: row.secret_digest,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    revokedAtMs: row.revoked_at_ms,
  };
}

function timerFromRow(row: TimerRow): TimerRecord {
  return {
    timerId: row.timer_id,
    roomId: row.room_id as RoomId,
    kind: row.kind,
    generation: row.generation,
    dueAtMs: row.due_at_ms,
    ...(row.seat_id === null ? {} : { seatId: row.seat_id }),
    ...(row.window_id === null ? {} : { windowId: row.window_id }),
    ...(row.remaining_ms === null ? {} : { remainingMs: row.remaining_ms }),
  };
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function ensureDatabaseParent(databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
}

export function defaultSqlitePath(): string {
  if (process.env.CAMBIO_SQLITE_PATH !== undefined && process.env.CAMBIO_SQLITE_PATH.length > 0) {
    return process.env.CAMBIO_SQLITE_PATH;
  }

  const cwd = process.cwd();
  return cwd.split(/[\\/]/).slice(-2).join("/") === "apps/server"
    ? join(cwd, "data/cambio.sqlite")
    : join(cwd, "apps/server/data/cambio.sqlite");
}
