import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "@cambio/protocol";
import { assertServerMessageSafe } from "@cambio/testkit";
import { FakeClock } from "./clock.js";
import { InMemoryRoomRepository } from "./persistence.js";
import { RoomRegistry } from "./registry.js";
import { SessionIssuer } from "./sessions.js";
import { EMPTY_ROOM_TTL_MS } from "./actor.js";
import type { SeatController } from "./actor.js";

describe("real-time room actor", () => {
  it("serializes joins and uses projection for broadcasts", async () => {
    const { registry } = setup();
    const created = await registry.createRoom({ displayName: "Alice" });
    expect(typeof created).not.toBe("string");
    if (typeof created === "string") {
      throw new Error(created);
    }

    const actor = await registry.getActorByCode(created.roomCode);
    expect(actor).not.toBeNull();
    if (actor === null) {
      throw new Error("missing actor");
    }
    const alice = controller(created.seatId, created.sessionGeneration);
    await actor.attachController(alice);

    const joined = await registry.joinRoom(created.roomCode, "Bob");
    expect(typeof joined).not.toBe("string");
    if (typeof joined === "string") {
      throw new Error(joined);
    }
    expect(actor.snapshot().seats.map((seat) => seat.displayName)).toEqual(["Alice", "Bob"]);
    const latest = alice.messages.at(-1);
    expect(latest?.type).toBe("stateSnapshot");
    if (latest?.type === "stateSnapshot") {
      assertServerMessageSafe(latest, actor.snapshot(), created.seatId);
    }
  });

  it("deduplicates exact command ids and rejects changed payloads without mutation", async () => {
    const { registry } = setup();
    const created = await createdTwoSeatRoom(registry);
    const actor = await registry.getActorByCode(created.roomCode);
    if (actor === null) {
      throw new Error("missing actor");
    }

    const alice = controller(created.alice.seatId, 0);
    const bobSeatId = actor.snapshot().seats.find((seat) => seat.playerId !== created.alice.seatId)?.playerId;
    if (bobSeatId === undefined) {
      throw new Error("missing bob");
    }
    const bob = controller(bobSeatId, 0);
    await actor.attachController(alice);
    await actor.attachController(bob);
    const start = command("updateRoomConfig", "cmd-config", 0, { config: { playerCap: 4 } });
    await actor.submitCommand(created.alice.seatId, start);
    const revision = actor.snapshot().revision;
    await actor.submitCommand(created.alice.seatId, start);
    expect(actor.snapshot().revision).toBe(revision);
    expect(alice.messages.filter((message) => message.type === "commandAccepted").length).toBe(2);

    await actor.submitCommand(created.alice.seatId, { ...start, payload: { config: { playerCap: 5 } } });
    expect(actor.snapshot().revision).toBe(revision);
    expect(alice.messages.at(-1)).toMatchObject({ type: "commandRejected", code: "E_DUPLICATE_COMMAND" });
  });

  it("does not publish or update memory when persistence fails", async () => {
    const repository = new FailingCommitRepository();
    const clock = new FakeClock();
    const registry = new RoomRegistry({
      repository,
      clock,
      scheduler: clock,
      sessionIssuer: new SessionIssuer({ key: Buffer.alloc(32, 1), nowMs: () => clock.nowMs() }),
    });
    const created = await registry.createRoom({ displayName: "Alice" });
    if (typeof created === "string") {
      throw new Error(created);
    }
    await registry.joinRoom(created.roomCode, "Bob");
    const actor = await registry.getActorByCode(created.roomCode);
    if (actor === null) {
      throw new Error("missing actor");
    }
    const alice = controller(created.seatId, 0);
    await actor.attachController(alice);
    repository.failCommits = true;

    await expect(actor.submitCommand(created.seatId, command("startMatch", "cmd-start", 0, {}))).rejects.toThrow("commit failed");
    expect(actor.snapshot().status).toBe("lobby");
    expect(alice.messages.filter((message) => message.type === "commandAccepted")).toHaveLength(0);
  });

  it("rejects stale sessions and pauses on active-seat disconnect with deterministic grace", async () => {
    const { registry, clock } = setup();
    const created = await createdTwoSeatRoom(registry);
    const actor = await registry.getActorByCode(created.roomCode);
    if (actor === null) {
      throw new Error("missing actor");
    }
    const alice = controller(created.alice.seatId, 0);
    const bob = controller(created.bob.seatId, 0);
    await actor.attachController(alice);
    await actor.attachController(bob);
    await actor.submitCommand(created.alice.seatId, command("startMatch", "cmd-start", 0, {}));
    let state = actor.snapshot();
    for (const seat of state.seats) {
      await actor.submitCommand(seat.playerId, command("acknowledgeOpeningPeek", `cmd-ack-${seat.playerId}`, 0, {}, state.revision));
      state = actor.snapshot();
    }

    await actor.detachController(state.round?.activePlayerId ?? created.alice.seatId, 0);
    expect(actor.snapshot().pauseReasons).toEqual([state.round?.activePlayerId]);

    const pausedDraw = await actor.submitCommand(created.alice.seatId, command("drawCard", "cmd-draw", 0, {}, actor.snapshot().revision));
    expect(pausedDraw.message).toMatchObject({ type: "commandRejected", code: "E_PAUSED" });

    await clock.advanceBy(120_000);
    expect(actor.snapshot().seats.some((seat) => seat.removalEligible)).toBe(true);

    const stale = await actor.submitCommand(created.alice.seatId, { ...command("drawCard", "cmd-stale", 1, {}, actor.snapshot().revision) });
    expect(stale.message).toMatchObject({ type: "commandRejected", code: "E_STALE_SESSION" });
  });

  it("rotates secrets on resume and revokes the previous controller", async () => {
    const { registry } = setup();
    const created = await registry.createRoom({ displayName: "Alice" });
    if (typeof created === "string") {
      throw new Error(created);
    }
    const actor = await registry.getActorByCode(created.roomCode);
    if (actor === null) {
      throw new Error("missing actor");
    }
    const first = controller(created.seatId, 0);
    await actor.attachController(first);
    await actor.detachController(created.seatId, 0, first);

    const resumed = await registry.resumeSession(created.roomCode, created.seatId, created.reconnectSecret);
    expect(typeof resumed).not.toBe("string");
    if (typeof resumed === "string") {
      throw new Error(resumed);
    }
    expect(resumed.sessionGeneration).toBe(1);
    expect(resumed.reconnectSecret).not.toBe(created.reconnectSecret);
    expect(await registry.resumeSession(created.roomCode, created.seatId, created.reconnectSecret)).toBe("E_CREDENTIAL_INVALID");

    const second = controller(created.seatId, 1);
    await actor.attachController(second);
    const third = controller(created.seatId, 1);
    await actor.attachController(third);
    expect(second.closed).toBe(true);
  });

  it("expires snap windows, deletes empty rooms, and recovers timers after restart", async () => {
    const { registry, clock } = setup();
    const created = await createdTwoSeatRoom(registry);
    const actor = await registry.getActorByCode(created.roomCode);
    if (actor === null) {
      throw new Error("missing actor");
    }
    await driveToTurnCycle(actor, created.alice.seatId);

    let state = actor.snapshot();
    const activePlayerId = state.round?.activePlayerId;
    if (activePlayerId === undefined || activePlayerId === null) {
      throw new Error("missing active player");
    }
    await actor.submitCommand(activePlayerId, command("drawCard", "draw", 0, {}, state.revision));
    state = actor.snapshot();
    await actor.submitCommand(activePlayerId, command("discardDrawn", "discard", 0, {}, state.revision));
    const openGeneration = actor.snapshot().round?.snapWindow?.generation;
    expect(openGeneration).toBeDefined();

    await registry.recoverFromRestart();
    const recovered = actor.snapshot();
    expect(recovered.seats.every((seat) => seat.connection === "disconnected")).toBe(true);
    expect(recovered.pauseReasons.length).toBeGreaterThan(0);
    expect(recovered.round?.snapWindow?.generation).toBe((openGeneration ?? 0) + 1);

    await clock.advanceBy(120_000);
    expect(actor.snapshot().seats.every((seat) => seat.removalEligible)).toBe(true);
  });

  it("migrates host on disconnect and serializes empty-room ttl deletion", async () => {
    const { registry, clock } = setup();
    const created = await createdTwoSeatRoom(registry);
    const actor = await registry.getActorByCode(created.roomCode);
    if (actor === null) {
      throw new Error("missing actor");
    }
    const alice = controller(created.alice.seatId, 0);
    const bob = controller(created.bob.seatId, 0);
    await actor.attachController(alice);
    await actor.attachController(bob);
    await actor.detachController(created.alice.seatId, 0, alice);
    expect(actor.snapshot().hostPlayerId).toBe(created.bob.seatId);

    await actor.detachController(created.bob.seatId, 0, bob);
    await clock.advanceBy(EMPTY_ROOM_TTL_MS);
    expect(await registry.getActorByCode(created.roomCode)).toBeNull();
    expect(await registry.joinRoom(created.roomCode, "Carol")).toBe("E_ROOM_NOT_FOUND");
  });
});

function setup(): { readonly registry: RoomRegistry; readonly clock: FakeClock } {
  const clock = new FakeClock();
  const repository = new InMemoryRoomRepository();
  return {
    clock,
    registry: new RoomRegistry({
      repository,
      clock,
      scheduler: clock,
      sessionIssuer: new SessionIssuer({ key: Buffer.alloc(32, 1), nowMs: () => clock.nowMs() }),
    }),
  };
}

async function createdTwoSeatRoom(registry: RoomRegistry): Promise<{
  readonly roomCode: string;
  readonly alice: { readonly seatId: string };
  readonly bob: { readonly seatId: string };
}> {
  const alice = await registry.createRoom({ displayName: "Alice" });
  if (typeof alice === "string") {
    throw new Error(alice);
  }
  const bob = await registry.joinRoom(alice.roomCode, "Bob");
  if (typeof bob === "string") {
    throw new Error(bob);
  }

  return { roomCode: alice.roomCode, alice: { seatId: alice.seatId }, bob: { seatId: bob.seatId } };
}

async function driveToTurnCycle(
  actor: NonNullable<Awaited<ReturnType<RoomRegistry["getActorByCode"]>>>,
  hostSeatId: string,
): Promise<void> {
  await actor.submitCommand(hostSeatId, command("startMatch", "start", 0, {}));
  let state = actor.snapshot();
  for (const seat of state.seats) {
    await actor.submitCommand(seat.playerId, command("acknowledgeOpeningPeek", `ack-${seat.playerId}`, 0, {}, state.revision));
    state = actor.snapshot();
  }
}

function controller(seatId: string, sessionGeneration: number): SeatController & { readonly messages: ServerMessage[]; closed: boolean } {
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

class FailingCommitRepository extends InMemoryRoomRepository {
  failCommits = false;

  override async commitRoom(...args: Parameters<InMemoryRoomRepository["commitRoom"]>): Promise<void> {
    if (this.failCommits) {
      throw new Error("commit failed");
    }

    await super.commitRoom(...args);
  }
}
