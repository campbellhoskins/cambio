import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerMessageSchema } from "@cambio/protocol";
import { MockProtocolAdapter } from "../connection/mockAdapter.js";
import { makeLobbyView, makeSeat } from "../connection/fixtures.js";
import { createMemoryStorage, loadCredentials } from "../session/credentials.js";
import { createGameStore } from "./gameStore.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("game store revision and session handling", () => {
  it("drops old snapshots without replacing authoritative state", async () => {
    const adapter = new MockProtocolAdapter();
    const storage = createMemoryStorage();
    const store = createGameStore(adapter, storage);
    await store
      .getState()
      .createRoom("Alice", { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 });
    await Promise.resolve();

    const nextView = makeLobbyView({
      roomCode: "MOCK01",
      viewerSeatId: "seat-alice",
      seats: [
        makeSeat({
          playerId: "seat-alice",
          displayName: "Alice updated",
          seatIndex: 0,
          isHost: true,
        }),
      ],
    });
    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "stateSnapshot",
        revision: 1,
        serverTime: { epochMs: 1, iso: "1970-01-01T00:00:00.001Z" },
        view: nextView,
      }),
    );
    const oldView = makeLobbyView({
      roomCode: "MOCK01",
      viewerSeatId: "seat-alice",
      seats: [
        makeSeat({ playerId: "seat-alice", displayName: "Old Alice", seatIndex: 0, isHost: true }),
      ],
    });
    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "stateSnapshot",
        revision: 1,
        serverTime: { epochMs: 1, iso: "1970-01-01T00:00:00.001Z" },
        view: oldView,
      }),
    );

    expect(store.getState().snapshot?.seats[0]?.displayName).toBe("Alice updated");
  });

  it("requests resync on revision gaps and stale acknowledgements", async () => {
    const adapter = new MockProtocolAdapter();
    const storage = createMemoryStorage();
    const store = createGameStore(adapter, storage);
    await store
      .getState()
      .createRoom("Alice", { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 });
    await Promise.resolve();

    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "presentationEvent",
        revision: 2,
        payload: { type: "reshuffled", cardCount: 12 },
      }),
    );
    expect(adapter.resyncRequests).toBe(1);
    expect(store.getState().needsResync).toBe(true);

    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "stateSnapshot",
        revision: 2,
        serverTime: { epochMs: 2, iso: "1970-01-01T00:00:00.002Z" },
        view: makeLobbyView({ roomCode: "MOCK01", viewerSeatId: "seat-alice" }),
      }),
    );
    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "commandRejected",
        commandId: "old-command",
        revision: 1,
        code: "E_STALE_REVISION",
      }),
    );

    expect(adapter.resyncRequests).toBe(2);
  });

  it("validates command envelopes and attaches expected revisions for turn-critical commands", async () => {
    const adapter = new MockProtocolAdapter();
    const storage = createMemoryStorage();
    const store = createGameStore(adapter, storage);
    await store
      .getState()
      .createRoom("Alice", { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 });
    await Promise.resolve();

    store.getState().sendCommand("hostEndMatch", {});
    expect(adapter.sentEnvelopes.at(-1)).toMatchObject({
      protocolVersion: 1,
      sessionGeneration: 0,
      expectedRevision: 0,
      type: "hostEndMatch",
      payload: {},
    });
  });

  it("surfaces same-revision rejections and stores transient presentation events", async () => {
    const adapter = new MockProtocolAdapter();
    const storage = createMemoryStorage();
    const store = createGameStore(adapter, storage);
    await store
      .getState()
      .createRoom("Alice", { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 });
    await Promise.resolve();

    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "commandRejected",
        commandId: "same-revision",
        revision: 0,
        code: "E_NOT_ACTIVE_PLAYER",
      }),
    );
    expect(store.getState().lastError).toBe("It is not your turn.");

    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "presentationEvent",
        revision: 0,
        payload: {
          type: "wrongSnapReveal",
          playerId: "seat-alice",
          target: { playerId: "seat-bob", slotId: "seat-bob-top-left" },
          card: { rank: "4", suit: "clubs" },
        },
      }),
    );
    expect(store.getState().presentationEvents).toHaveLength(1);
  });

  it("collapses presentation-event backlog to the latest public transient state", async () => {
    vi.useFakeTimers();
    const adapter = new MockProtocolAdapter();
    const storage = createMemoryStorage();
    const store = createGameStore(adapter, storage);
    await store
      .getState()
      .createRoom("Alice", { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 });
    await Promise.resolve();

    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "presentationEvent",
        revision: 0,
        payload: {
          type: "wrongSnapReveal",
          playerId: "seat-alice",
          target: { playerId: "seat-bob", slotId: "seat-bob-top-left" },
          card: { rank: "4", suit: "clubs" },
        },
      }),
    );
    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "presentationEvent",
        revision: 0,
        payload: {
          type: "wrongSnapReveal",
          playerId: "seat-bob",
          target: { playerId: "seat-bob", slotId: "seat-bob-top-left" },
          card: { rank: "5", suit: "diamonds" },
        },
      }),
    );
    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "presentationEvent",
        revision: 0,
        payload: { type: "reshuffled", cardCount: 12 },
      }),
    );
    store.getState().applyServerMessage(
      ServerMessageSchema.parse({
        type: "presentationEvent",
        revision: 0,
        payload: { type: "reshuffled", cardCount: 3 },
      }),
    );

    expect(store.getState().presentationEvents).toEqual([
      {
        type: "wrongSnapReveal",
        playerId: "seat-bob",
        target: { playerId: "seat-bob", slotId: "seat-bob-top-left" },
        card: { rank: "5", suit: "diamonds" },
      },
      { type: "reshuffled", cardCount: 3 },
    ]);

    vi.advanceTimersByTime(1_800);
    expect(store.getState().presentationEvents).toEqual([]);
  });

  it("rotates resume credentials, replaces storage, and closes the old controller", async () => {
    const adapter = new MockProtocolAdapter();
    const storage = createMemoryStorage();
    const store = createGameStore(adapter, storage);
    const created = await store
      .getState()
      .createRoom("Alice", { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 });
    await Promise.resolve();
    const descriptor = store.getState().sessions[0];
    if (descriptor === undefined) {
      throw new Error("missing descriptor");
    }

    await store.getState().resumeSession(descriptor);
    await Promise.resolve();
    const stored = loadCredentials(storage)[0];

    expect(stored?.sessionGeneration).toBe(1);
    expect(stored?.reconnectSecret).not.toBe(created.reconnectSecret);
    expect(adapter.closedControllers).toBeGreaterThanOrEqual(1);
  });
});
