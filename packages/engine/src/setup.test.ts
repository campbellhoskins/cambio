import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkInvariants } from "./invariants.js";
import type { MatchState, RoundState } from "./model/state.js";
import {
  OPENING_PEEK_POSITIONS,
  acknowledgeOpeningPeek,
  openingPeekSlots,
  startMatch,
  validateRoomConfig,
} from "./setup.js";
import { addLobbySeatForTesting, createLobbyMatchForTesting } from "./testing/index.js";

describe("setup transitions", () => {
  it("validates config defaults, boundaries, and out-of-range values", () => {
    expect(validateRoomConfig()).toEqual({
      ok: true,
      config: { playerCap: 6, roundCount: 9, snapWindowMs: 5_000 },
    });
    expect(validateRoomConfig({ playerCap: 2, roundCount: 1, snapWindowMs: 2_000 }).ok).toBe(true);
    expect(validateRoomConfig({ playerCap: 6, roundCount: 20, snapWindowMs: 10_000 }).ok).toBe(true);

    expect(validateRoomConfig({ playerCap: 1 })).toEqual({ ok: false, code: "E_INVALID_CONFIG" });
    expect(validateRoomConfig({ playerCap: 7 })).toEqual({ ok: false, code: "E_INVALID_CONFIG" });
    expect(validateRoomConfig({ roundCount: 0 })).toEqual({ ok: false, code: "E_INVALID_CONFIG" });
    expect(validateRoomConfig({ roundCount: 21 })).toEqual({ ok: false, code: "E_INVALID_CONFIG" });
    expect(validateRoomConfig({ snapWindowMs: 1_999 })).toEqual({ ok: false, code: "E_INVALID_CONFIG" });
    expect(validateRoomConfig({ snapWindowMs: 10_001 })).toEqual({ ok: false, code: "E_INVALID_CONFIG" });
  });

  it("deals a conserved opening round with no initial discard", () => {
    const result = startMatch(createLobbyWithPlayers(4, 42), { type: "startMatch", actorId: "player-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const round = expectRound(result.state);
    expect(round.phase).toBe("openingPeek");
    expect(round.discardPile).toEqual([]);
    expect(round.drawPile).toHaveLength(54 - 4 * 4);
    expect(Object.values(round.slotsByPlayer).flatMap((slots) => slots)).toHaveLength(16);
    expect(checkInvariants(result.state)).toEqual({ ok: true, violations: [] });
  });

  it("marks only each owner's canonical bottom cards as opening peek slots", () => {
    const result = startMatch(createLobbyWithPlayers(3, 7), { type: "startMatch", actorId: "player-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const round = expectRound(result.state);
    for (const seat of result.state.seats) {
      const peekSlots = openingPeekSlots(round, seat.playerId);
      expect(peekSlots).toHaveLength(2);
      expect(peekSlots.map((slot) => slot.position)).toEqual(OPENING_PEEK_POSITIONS);
      expect(peekSlots.every((slot) => slot.cardId !== null)).toBe(true);
    }
  });

  it("moves to turn cycle after every opening peek is acknowledged", () => {
    const startResult = startMatch(createLobbyWithPlayers(3, 11), { type: "startMatch", actorId: "player-1" });
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const dealerId = expectRound(startResult.state).dealerId;
    const firstAck = acknowledgeOpeningPeek(startResult.state, {
      type: "acknowledgeOpeningPeek",
      actorId: "player-1",
      expectedRevision: startResult.state.revision,
    });
    expect(firstAck.ok).toBe(true);
    if (!firstAck.ok) {
      return;
    }
    expect(expectRound(firstAck.state).phase).toBe("openingPeek");
    expect(firstAck.state.revision).toBe(startResult.state.revision + 1);

    const secondAck = acknowledgeOpeningPeek(firstAck.state, {
      type: "acknowledgeOpeningPeek",
      actorId: "player-2",
      expectedRevision: firstAck.state.revision,
    });
    expect(secondAck.ok).toBe(true);
    if (!secondAck.ok) {
      return;
    }

    const finalAck = acknowledgeOpeningPeek(secondAck.state, {
      type: "acknowledgeOpeningPeek",
      actorId: "player-3",
      expectedRevision: secondAck.state.revision,
    });
    expect(finalAck.ok).toBe(true);
    if (!finalAck.ok) {
      return;
    }

    const round = expectRound(finalAck.state);
    expect(round.phase).toBe("turnCycle");
    expect(round.turnStage).toBe("turnStart");
    expect(round.activePlayerId).toBe(expectedSeatLeftOf(finalAck.state, dealerId));
  });

  it("rejects stale revisions and wrong-phase opening peek acknowledgements without mutation", () => {
    const startResult = startMatch(createLobbyWithPlayers(2, 5), { type: "startMatch", actorId: "player-1" });
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const staleResult = acknowledgeOpeningPeek(startResult.state, {
      type: "acknowledgeOpeningPeek",
      actorId: "player-1",
      expectedRevision: startResult.state.revision - 1,
    });
    expect(staleResult).toEqual({
      ok: false,
      state: startResult.state,
      code: "E_STALE_REVISION",
      events: [],
    });
    expect(staleResult.state).toBe(startResult.state);

    const lobby = createLobbyWithPlayers(2, 5);
    const outOfPhase = acknowledgeOpeningPeek(lobby, { type: "acknowledgeOpeningPeek", actorId: "player-1" });
    expect(outOfPhase).toEqual({
      ok: false,
      state: lobby,
      code: "E_OUT_OF_PHASE",
      events: [],
    });
    expect(outOfPhase.state).toBe(lobby);
  });

  it("conserves cards after deals across many seeds and player counts", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 2, max: 6 }), (seed, playerCount) => {
        const result = startMatch(createLobbyWithPlayers(playerCount, seed), {
          type: "startMatch",
          actorId: "player-1",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }

        expect(checkInvariants(result.state)).toEqual({ ok: true, violations: [] });
      }),
    );
  });
});

function createLobbyWithPlayers(playerCount: number, seed: number): MatchState {
  let state = createLobbyMatchForTesting({ seed, config: { playerCap: 6 } });
  for (let index = 2; index <= playerCount; index += 1) {
    state = addLobbySeatForTesting(state, {
      playerId: `player-${index}`,
      displayName: `Player ${index}`,
    });
  }

  return state;
}

function expectRound(state: MatchState): RoundState {
  if (state.round === null) {
    throw new Error("expected round");
  }

  return state.round;
}

function expectedSeatLeftOf(state: MatchState, playerId: string): string {
  const seats = [...state.seats].sort((left, right) => left.seatIndex - right.seatIndex);
  const index = seats.findIndex((seat) => seat.playerId === playerId);
  const nextSeat = seats[(index + 1) % seats.length];
  if (nextSeat === undefined) {
    throw new Error("expected next seat");
  }

  return nextSeat.playerId;
}
