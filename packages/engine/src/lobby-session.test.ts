import { describe, expect, it } from "vitest";
import {
  createLobbyMatchForTesting,
  addLobbySeatForTesting,
} from "./testing/builders.js";
import {
  hostEndMatch,
  hostRemovePlayer,
  joinRoom,
  leaveRoom,
  reduceCommand,
  startMatch,
  updateRoomConfig,
} from "./setup.js";
import { accepted, assertRejected } from "./testing/test-helpers.js";

describe("lobby/session reducer commands", () => {
  it("adds lobby seats with stable join order and enforces capacity and phase", () => {
    let state = createLobbyMatchForTesting({
      roomId: "room-1",
      host: { playerId: "alice", displayName: "Alice" },
      config: { playerCap: 2 },
    });

    state = accepted(joinRoom(state, { type: "joinRoom", seat: { playerId: "bob", displayName: "Bob" } })).state;
    expect(state.revision).toBe(1);
    expect(state.seats.map((seat) => [seat.playerId, seat.seatIndex, seat.joinOrder])).toEqual([
      ["alice", 0, 0],
      ["bob", 1, 1],
    ]);

    assertRejected(joinRoom(state, { type: "joinRoom", seat: { playerId: "carol", displayName: "Carol" } }), state, "E_ROOM_FULL");

    const active = accepted(startMatch(state, { type: "startMatch", actorId: "alice" })).state;
    assertRejected(joinRoom(active, { type: "joinRoom", seat: { playerId: "carol", displayName: "Carol" } }), active, "E_ROOM_STARTED");
  });

  it("updates config only for the host while still in lobby", () => {
    let state = createLobbyMatchForTesting({ host: { playerId: "alice", displayName: "Alice" } });
    state = addLobbySeatForTesting(state, { playerId: "bob", displayName: "Bob" });

    assertRejected(updateRoomConfig(state, { type: "updateRoomConfig", actorId: "bob", config: { playerCap: 4 } }), state, "E_NOT_HOST");

    const updated = accepted(updateRoomConfig(state, { type: "updateRoomConfig", actorId: "alice", config: { playerCap: 4, roundCount: 3 } })).state;
    expect(updated.config).toMatchObject({ playerCap: 4, roundCount: 3 });

    assertRejected(updateRoomConfig(updated, { type: "updateRoomConfig", actorId: "alice", config: { playerCap: 1 } }), updated, "E_INVALID_CONFIG");
    assertRejected(updateRoomConfig(updated, { type: "updateRoomConfig", actorId: "alice", config: { playerCap: 1.5 } }), updated, "E_INVALID_CONFIG");

    const active = accepted(startMatch(updated, { type: "startMatch", actorId: "alice" })).state;
    assertRejected(updateRoomConfig(active, { type: "updateRoomConfig", actorId: "alice", config: { roundCount: 2 } }), active, "E_OUT_OF_PHASE");
  });

  it("removes lobby seats and migrates host without starting a match", () => {
    let state = createLobbyMatchForTesting({ host: { playerId: "alice", displayName: "Alice" } });
    state = addLobbySeatForTesting(state, { playerId: "bob", displayName: "Bob" });
    state = addLobbySeatForTesting(state, { playerId: "carol", displayName: "Carol" });

    const bobLeft = accepted(leaveRoom(state, { type: "leaveRoom", actorId: "bob" })).state;
    expect(bobLeft.seats.map((seat) => seat.playerId)).toEqual(["alice", "carol"]);
    expect(bobLeft.cumulativeScores.bob).toBeUndefined();

    const hostLeft = accepted(leaveRoom(bobLeft, { type: "leaveRoom", actorId: "alice" })).state;
    expect(hostLeft.hostPlayerId).toBe("carol");

    assertRejected(leaveRoom(hostLeft, { type: "leaveRoom", actorId: "alice" }), hostLeft, "E_ALREADY_REMOVED");
    const active = accepted(startMatch(addLobbySeatForTesting(hostLeft, { playerId: "drew", displayName: "Drew" }), { type: "startMatch", actorId: "carol" })).state;
    assertRejected(leaveRoom(active, { type: "leaveRoom", actorId: "carol" }), active, "E_OUT_OF_PHASE");
  });

  it("lets the host abandon an active match without adding scores", () => {
    let state = createLobbyMatchForTesting({ host: { playerId: "alice", displayName: "Alice" } });
    state = addLobbySeatForTesting(state, { playerId: "bob", displayName: "Bob" });
    const active = accepted(startMatch(state, { type: "startMatch", actorId: "alice" })).state;

    assertRejected(hostEndMatch(active, { type: "hostEndMatch", actorId: "bob", expectedRevision: active.revision }), active, "E_NOT_HOST");
    assertRejected(hostEndMatch(active, { type: "hostEndMatch", actorId: "alice", expectedRevision: active.revision + 1 }), active, "E_STALE_REVISION");

    const ended = accepted(hostEndMatch(active, { type: "hostEndMatch", actorId: "alice", expectedRevision: active.revision })).state;
    expect(ended.status).toBe("abandoned");
    expect(ended.round?.endReason).toBe("hostEnded");
    expect(ended.cumulativeScores).toEqual(active.cumulativeScores);
  });

  it("maps host removal through the reducer with host and eligibility checks", () => {
    const state = createLobbyMatchForTesting({ host: { playerId: "alice", displayName: "Alice" } });
    const active = accepted(startMatch(addLobbySeatForTesting(state, { playerId: "bob", displayName: "Bob" }), { type: "startMatch", actorId: "alice" })).state;
    const disconnected = {
      ...active,
      seats: active.seats.map((seat) =>
        seat.playerId === "bob"
          ? { ...seat, connection: "disconnected" as const, removalEligible: true }
          : seat,
      ),
    };

    assertRejected(hostRemovePlayer(disconnected, { type: "removePlayer", actorId: "bob", targetPlayerId: "alice", expectedRevision: disconnected.revision }), disconnected, "E_NOT_HOST");
    const removed = accepted(reduceCommand(disconnected, { type: "removePlayer", actorId: "alice", targetPlayerId: "bob", expectedRevision: disconnected.revision })).state;
    expect(removed.seats.find((seat) => seat.playerId === "bob")?.connection).toBe("removed");
  });
});
