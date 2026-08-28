import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@cambio/protocol";
import {
  reduceCommand,
  startingSlotId,
  type DomainEvent,
  type EngineCommand,
  type MatchState,
  type PlayerId,
  type RoomId,
} from "@cambio/engine";
import { FakeClock } from "./clock.js";
import { createCambioServer } from "./app.js";
import { EMPTY_ROOM_TTL_MS } from "./actor.js";
import type { SeatController } from "./actor.js";
import {
  InMemoryRoomRepository,
  type CommandReceiptRecord,
  type CreateRoomRecord,
  type RoomRepository,
  type SessionRecord,
  type TimerRecord,
} from "./persistence.js";
import { RoomRegistry } from "./registry.js";
import { SessionIssuer } from "./sessions.js";
import { SqliteRoomRepository } from "./sqlite-repository.js";

const createdPaths: string[] = [];

afterEach(() => {
  for (const path of createdPaths.splice(0)) {
    cleanupDatabase(path);
  }
});

describe.each([
  {
    name: "in-memory",
    open: () => ({ repository: new InMemoryRoomRepository(), close: () => undefined }),
  },
  {
    name: "sqlite",
    open: () => {
      const path = testDatabasePath();
      const repository = new SqliteRoomRepository({ path });
      return {
        repository,
        close: () => {
          repository.close();
          cleanupDatabase(path);
        },
      };
    },
  },
] satisfies readonly {
  readonly name: string;
  readonly open: () => { readonly repository: RoomRepository; readonly close: () => void };
}[])("RoomRepository contract ($name)", ({ open }) => {
  it("matches create, commit, receipt, timer replacement, and delete semantics", async () => {
    const { repository, close } = open();
    try {
      const created = createRoomRecord("room:contract");
      await repository.createRoom(created);
      await expect(repository.createRoom(created)).rejects.toThrow();
      expect(await repository.getRoomByCode(created.roomCode)).toEqual(await repository.getRoom(created.roomId));

      const joined = accepted(created.state, {
        type: "joinRoom",
        seat: { playerId: "bob", displayName: "Bob" },
      });
      const bobSession = session(created.roomId, "bob", 0, 20);
      const timer = timerRecord(created.roomId, "timer:empty:1", 1, 86_400_000);
      const receipt = receiptRecord(created.roomId, "alice", 0, "cmd-join", "hash-a", "accepted", joined.state.revision);
      await repository.commitRoom({
        roomId: created.roomId,
        state: joined.state,
        events: joined.events,
        receipt,
        sessions: [bobSession],
        timers: [timer],
      });

      expect(await repository.getCommandReceipt(created.roomId, "alice", 0, "cmd-join")).toEqual(receipt);
      expect((await repository.getRoom(created.roomId))?.sessions).toEqual([created.sessions[0], bobSession]);
      expect((await repository.getRoom(created.roomId))?.timers).toEqual([timer]);

      await repository.commitRoom({
        roomId: created.roomId,
        state: { ...joined.state, revision: joined.state.revision + 1 },
        events: [],
        timers: [],
      });
      expect((await repository.getRoom(created.roomId))?.timers).toEqual([]);

      await repository.deleteRoom(created.roomId);
      expect(await repository.getRoom(created.roomId)).toBeNull();
      expect(await repository.getRoomByCode(created.roomCode)).toBeNull();
      expect(await repository.getCommandReceipt(created.roomId, "alice", 0, "cmd-join")).toBeNull();
    } finally {
      close();
    }
  });
});

describe("SqliteRoomRepository", () => {
  it("applies idempotent migrations, enables WAL, and round-trips retained room state from a fresh instance", async () => {
    const path = testDatabasePath();
    const repository = new SqliteRoomRepository({ path });
    const created = createRoomRecord("room:roundtrip");
    await repository.createRoom(created);

    const joined = accepted(created.state, {
      type: "joinRoom",
      seat: { playerId: "bob", displayName: "Bob" },
    });
    await repository.commitRoom({
      roomId: created.roomId,
      state: joined.state,
      events: joined.events,
      sessions: [session(created.roomId, "bob", 0, 10)],
      timers: [timerRecord(created.roomId, "timer:empty:1", 1, 86_400_000)],
    });

    const richState = stateWithDurableRecoveryFields(joined.state);
    const snapTimer = richState.round?.snapWindow === null || richState.round?.snapWindow === undefined
      ? []
      : [{
          timerId: richState.round.snapWindow.timerId,
          roomId: richState.roomId,
          kind: "snapWindow" as const,
          generation: richState.round.snapWindow.generation,
          dueAtMs: 5_000,
          windowId: richState.round.snapWindow.windowId,
          remainingMs: richState.round.snapWindow.remainingMs,
        }];
    const receipt = receiptRecord(created.roomId, "alice", 0, "cmd-rich", "hash-rich", "accepted", richState.revision);
    await repository.commitRoom({
      roomId: created.roomId,
      state: richState,
      events: [{ type: "snapWindowOpened", windowId: "window:test", generation: 1, timerId: "timer:snap:test", triggerCardId: "clubs:7", triggerRank: "7", durationMs: 5_000 } as DomainEvent],
      receipt,
      timers: [
        ...snapTimer,
        timerRecord(created.roomId, "timer:grace:alice:0", 0, 120_000, "reconnectGrace", "alice"),
      ],
    });
    repository.close();

    const reopened = new SqliteRoomRepository({ path });
    try {
      const freshRoom = await reopened.getRoom(created.roomId);
      expect(freshRoom?.state).toEqual(richState);
      expect(freshRoom?.state.round?.pendingPower).not.toBeNull();
      expect(freshRoom?.state.round?.pendingTransfer).not.toBeNull();
      expect(freshRoom?.state.round?.snapWindow).not.toBeNull();
      expect(freshRoom?.state.cumulativeScores).toEqual({ alice: 12, bob: 7 });
      expect(await reopened.listRetainedRooms()).toEqual([freshRoom]);
      expect(await reopened.getCommandReceipt(created.roomId, "alice", 0, "cmd-rich")).toEqual(receipt);

      const sqlite = new Database(path);
      try {
        expect((sqlite.pragma("journal_mode", { simple: true }) as string).toLowerCase()).toBe("wal");
      } finally {
        sqlite.close();
      }
    } finally {
      reopened.close();
    }
  });

  it("preserves idempotency receipts across repository restarts", async () => {
    const path = testDatabasePath();
    const created = createRoomRecord("room:receipt");
    const receipt = receiptRecord(created.roomId, "alice", 0, "cmd-idem", "hash-one", "accepted", 1);
    const repository = new SqliteRoomRepository({ path });
    await repository.createRoom(created);
    await repository.commitRoom({
      roomId: created.roomId,
      state: { ...created.state, revision: created.state.revision + 1 },
      events: [],
      receipt,
    });
    repository.close();

    const reopened = new SqliteRoomRepository({ path });
    try {
      const stored = await reopened.getCommandReceipt(created.roomId, "alice", 0, "cmd-idem");
      expect(stored).toEqual(receipt);
      expect(stored?.payloadHash).not.toBe("hash-two");
    } finally {
      reopened.close();
    }
  });

  it("rolls back the entire commit transaction when a later write fails", async () => {
    const path = testDatabasePath();
    const repository = new SqliteRoomRepository({ path });
    const created = createRoomRecord("room:atomic");
    await repository.createRoom(created);
    const before = await repository.getRoom(created.roomId);
    const invalidReceipt = {
      ...receiptRecord(created.roomId, "alice", 0, "cmd-invalid", "hash", "accepted", 1),
      status: "invalid",
    } as unknown as CommandReceiptRecord;

    await expect(repository.commitRoom({
      roomId: created.roomId,
      state: { ...created.state, revision: created.state.revision + 1 },
      events: [{ type: "matchStarted", roomId: created.roomId } as unknown as DomainEvent],
      receipt: invalidReceipt,
      timers: [timerRecord(created.roomId, "timer:empty:atomic", 1, 1)],
    })).rejects.toThrow();

    expect(await repository.getRoom(created.roomId)).toEqual(before);
    repository.close();

    const sqlite = new Database(path);
    try {
      expect((sqlite.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as { readonly count: number }).count).toBe(0);
      expect((sqlite.prepare("SELECT COUNT(*) AS count FROM command_receipts").get() as { readonly count: number }).count).toBe(0);
      expect((sqlite.prepare("SELECT COUNT(*) AS count FROM timers").get() as { readonly count: number }).count).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

describe("SQLite restart recovery and retention", () => {
  it("restores rooms through a fresh registry with paused seats, refreshed timers, open snap policy, and valid sessions", async () => {
    const path = testDatabasePath();
    const clock = new FakeClock(1_000);
    const key = Buffer.alloc(32, 3);
    const repository = new SqliteRoomRepository({ path });
    const registry = registryWith(repository, clock, key);
    const created = await createdTwoSeatRoom(registry);
    const actor = await requireActor(registry, created.roomCode);
    await driveToOpenSnapWindow(actor, created.alice.seatId);
    const openGeneration = actor.snapshot().round?.snapWindow?.generation;
    repository.close();

    const restartedRepository = new SqliteRoomRepository({ path });
    const restarted = registryWith(restartedRepository, clock, key);
    await restarted.recoverFromRestart();
    const restored = await requireActor(restarted, created.roomCode);
    const recovered = restored.snapshot();

    expect(recovered.seats.every((seat) => seat.connection === "disconnected")).toBe(true);
    expect(recovered.pauseReasons.length).toBeGreaterThan(0);
    expect(recovered.round?.snapWindow?.generation).toBe((openGeneration ?? 0) + 1);
    expect(recovered.round?.snapWindow?.remainingMs).toBe(recovered.config.snapWindowMs);

    const resumed = await restarted.resumeSession(created.roomCode, created.alice.seatId, created.alice.reconnectSecret);
    expect(typeof resumed).not.toBe("string");
    if (typeof resumed === "string") {
      throw new Error(resumed);
    }
    expect(resumed.sessionGeneration).toBe(1);
    restartedRepository.close();
  });

  it("keeps empty-room TTL durable across restart while connected rooms are retained", async () => {
    const path = testDatabasePath();
    const clock = new FakeClock(10_000);
    const key = Buffer.alloc(32, 4);
    const repository = new SqliteRoomRepository({ path });
    const registry = registryWith(repository, clock, key);

    const emptyRoom = await registry.createRoom({ displayName: "Alice" });
    const connectedRoom = await registry.createRoom({ displayName: "Bob" });
    if (typeof emptyRoom === "string" || typeof connectedRoom === "string") {
      throw new Error("room creation failed");
    }
    const emptyActor = await requireActor(registry, emptyRoom.roomCode);
    const emptyController = controller(emptyRoom.seatId, emptyRoom.sessionGeneration);
    await emptyActor.attachController(emptyController);
    await emptyActor.detachController(emptyRoom.seatId, emptyRoom.sessionGeneration, emptyController);

    await clock.advanceBy(60 * 60 * 1_000);
    repository.close();

    const restartedRepository = new SqliteRoomRepository({ path });
    const restartClock = new FakeClock(clock.nowMs());
    const restarted = registryWith(restartedRepository, restartClock, key);
    await restarted.recoverFromRestart();
    await restartClock.advanceBy(EMPTY_ROOM_TTL_MS - 60 * 60 * 1_000);

    expect(await restarted.getActorByCode(emptyRoom.roomCode)).toBeNull();
    expect(await restarted.joinRoom(emptyRoom.roomCode, "Carol")).toBe("E_ROOM_NOT_FOUND");
    expect(await restarted.getActorByCode(connectedRoom.roomCode)).not.toBeNull();
    restartedRepository.close();
  });

  it("wires SQLite through createCambioServer options and environment path selection", async () => {
    const path = testDatabasePath();
    const server = await createCambioServer({ sqlite: { path }, clock: new FakeClock() });
    try {
      expect(server.repository).toBeInstanceOf(SqliteRoomRepository);
      const created = await server.registry.createRoom({ displayName: "Alice" });
      if (typeof created === "string") {
        throw new Error(created);
      }
      expect(await server.repository.getRoomByCode(created.roomCode)).not.toBeNull();
    } finally {
      await server.app.close();
    }
  });
});

function registryWith(repository: RoomRepository, clock: FakeClock, key: Buffer): RoomRegistry {
  return new RoomRegistry({
    repository,
    clock,
    scheduler: clock,
    sessionIssuer: new SessionIssuer({ key, nowMs: () => clock.nowMs() }),
  });
}

function createRoomRecord(roomId: RoomId): CreateRoomRecord {
  const state = accepted(null, {
    type: "createMatch",
    roomId,
    host: { playerId: "alice", displayName: "Alice" },
    seed: 7,
    config: { roundCount: 2, snapWindowMs: 5_000, playerCap: 3 },
  }).state;
  return {
    roomId,
    roomCode: `${roomId.slice("room:".length).toUpperCase()}1`,
    state,
    sessions: [session(roomId, "alice", 0, 0)],
  };
}

function stateWithDurableRecoveryFields(state: MatchState): MatchState {
  const powerState = firstPowerState(state.roomId);
  if (powerState.round === null || powerState.round.snapWindow === null || powerState.round.pendingPower === null) {
    throw new Error("missing rich round state");
  }

  return {
    ...powerState,
    cumulativeScores: { alice: 12, bob: 7 },
    round: {
      ...powerState.round,
      pendingTransfer: {
        fromPlayerId: "bob",
        toPlayerId: "alice",
        targetSlotId: startingSlotId("alice", "topLeft"),
      },
    },
  };
}

function firstPowerState(roomId: RoomId): MatchState {
  for (let seed = 1; seed < 500; seed += 1) {
    let state = accepted(null, {
      type: "createMatch",
      roomId,
      host: { playerId: "alice", displayName: "Alice" },
      seed,
      config: { roundCount: 2, snapWindowMs: 5_000, playerCap: 2 },
    }).state;
    state = accepted(state, { type: "joinRoom", seat: { playerId: "bob", displayName: "Bob" } }).state;
    state = accepted(state, { type: "startMatch", actorId: "alice" }).state;
    for (const seat of state.seats) {
      state = accepted(state, { type: "acknowledgeOpeningPeek", actorId: seat.playerId, expectedRevision: state.revision }).state;
    }
    state = accepted(state, { type: "drawCard", actorId: state.round?.activePlayerId ?? "alice", expectedRevision: state.revision }).state;
    state = accepted(state, { type: "discardDrawn", actorId: state.round?.activePlayerId ?? "alice", expectedRevision: state.revision }).state;
    if (state.round?.snapWindow !== null && state.round?.pendingPower !== null) {
      return state;
    }
  }

  throw new Error("could not find power state");
}

async function createdTwoSeatRoom(registry: RoomRegistry): Promise<{
  readonly roomCode: string;
  readonly alice: { readonly seatId: PlayerId; readonly reconnectSecret: string };
  readonly bob: { readonly seatId: PlayerId; readonly reconnectSecret: string };
}> {
  const alice = await registry.createRoom({ displayName: "Alice", config: { playerCap: 2, snapWindowMs: 2_000 } });
  if (typeof alice === "string") {
    throw new Error(alice);
  }
  const bob = await registry.joinRoom(alice.roomCode, "Bob");
  if (typeof bob === "string") {
    throw new Error(bob);
  }

  return {
    roomCode: alice.roomCode,
    alice: { seatId: alice.seatId, reconnectSecret: alice.reconnectSecret },
    bob: { seatId: bob.seatId, reconnectSecret: bob.reconnectSecret },
  };
}

async function requireActor(
  registry: RoomRegistry,
  roomCode: string,
): Promise<NonNullable<Awaited<ReturnType<RoomRegistry["getActorByCode"]>>>> {
  const actor = await registry.getActorByCode(roomCode);
  if (actor === null) {
    throw new Error("missing actor");
  }
  return actor;
}

async function driveToOpenSnapWindow(
  actor: NonNullable<Awaited<ReturnType<RoomRegistry["getActorByCode"]>>>,
  hostSeatId: PlayerId,
): Promise<void> {
  await actor.submitCommand(hostSeatId, command("startMatch", "start", 0, {}));
  let state = actor.snapshot();
  for (const seat of state.seats) {
    await actor.submitCommand(seat.playerId, command("acknowledgeOpeningPeek", `ack-${seat.playerId}`, 0, {}, state.revision));
    state = actor.snapshot();
  }

  const activePlayerId = state.round?.activePlayerId;
  if (activePlayerId === undefined || activePlayerId === null) {
    throw new Error("missing active player");
  }
  await actor.submitCommand(activePlayerId, command("drawCard", "draw", 0, {}, state.revision));
  state = actor.snapshot();
  await actor.submitCommand(activePlayerId, command("discardDrawn", "discard", 0, {}, state.revision));
  expect(actor.snapshot().round?.snapWindow).not.toBeNull();
}

function accepted(
  state: MatchState | null,
  command: EngineCommand,
): { readonly state: MatchState; readonly events: readonly DomainEvent[] } {
  const result = reduceCommand(state, command);
  if (!result.ok) {
    throw new Error(result.code);
  }
  return result;
}

function session(roomId: RoomId, seatId: PlayerId, sessionGeneration: number, atMs: number): SessionRecord {
  return {
    roomId,
    seatId,
    sessionGeneration,
    secretDigest: `${seatId}:secret:${sessionGeneration}`,
    createdAtMs: atMs,
    updatedAtMs: atMs,
    revokedAtMs: null,
  };
}

function receiptRecord(
  roomId: RoomId,
  seatId: PlayerId,
  sessionGeneration: number,
  commandId: string,
  payloadHash: string,
  status: CommandReceiptRecord["status"],
  revision: number,
): CommandReceiptRecord {
  return {
    roomId,
    seatId,
    sessionGeneration,
    commandId,
    payloadHash,
    status,
    revision,
    commandType: "test",
    rejectionCode: null,
  };
}

function timerRecord(
  roomId: RoomId,
  timerId: string,
  generation: number,
  dueAtMs: number,
  kind: TimerRecord["kind"] = "emptyRoomTtl",
  seatId?: PlayerId,
): TimerRecord {
  return {
    roomId,
    timerId,
    kind,
    generation,
    dueAtMs,
    ...(seatId === undefined ? {} : { seatId }),
  };
}

function controller(seatId: PlayerId, sessionGeneration: number): SeatController & { readonly messages: ServerMessage[]; closed: boolean } {
  return {
    seatId,
    sessionGeneration,
    messages: [],
    closed: false,
    send(message) {
      this.messages.push(message);
    },
    close() {
      this.closed = true;
    },
  };
}

function command(
  type: string,
  commandId: string,
  sessionGeneration: number,
  payload: unknown,
  expectedRevision?: number,
): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    sessionGeneration,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    type,
    payload,
  };
}

function testDatabasePath(): string {
  const directory = join(process.cwd(), "apps/server/.test-data");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${randomUUID()}.sqlite`);
  createdPaths.push(path);
  return path;
}

function cleanupDatabase(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}
