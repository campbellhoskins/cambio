import { describe, expect, it } from "vitest";
import { checkInvariants } from "./invariants.js";
import type { CardId } from "./model/cards.js";
import type { PlayerId } from "./model/ids.js";
import type { MatchState } from "./model/state.js";
import {
  addLobbySeatForTesting,
  createScriptedTurnCycleMatchForTesting,
} from "./testing/index.js";
import { grid, round, slot } from "./testing/test-helpers.js";
import { reduceCommand, type DomainEvent, type EngineCommand, type TransitionResult } from "./setup.js";

describe("end-to-end engine game", () => {
  it("plays an organic lobby into two deterministic rounds and completes the match", () => {
    const created = accepted(
      reduceCommand(null, {
        type: "createMatch",
        roomId: "room-e2e",
        host: { playerId: "alice", displayName: "Alice" },
        seed: 314_159,
        config: { roundCount: 2, playerCap: 3, snapWindowMs: 5_000 },
      }),
    );
    let state = addLobbySeatForTesting(created.state, { playerId: "bob", displayName: "Bob" });
    state = addLobbySeatForTesting(state, { playerId: "carol", displayName: "Carol" });

    state = step(state, { type: "startMatch", actorId: "alice" }).state;
    expect(round(state).phase).toBe("openingPeek");
    for (const playerId of ["alice", "bob", "carol"] as const) {
      state = step(state, { type: "acknowledgeOpeningPeek", actorId: playerId }).state;
    }
    expect(round(state).phase).toBe("turnCycle");

    state = withScriptedRound(state, {
      roundNumber: 1,
      dealerId: "carol",
      activePlayerId: "alice",
      grids: [
        grid("alice", ["clubs:5", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["diamonds:9", "clubs:6", "clubs:10", "clubs:J"]),
        grid("carol", ["spades:7", "diamonds:2", "diamonds:3", "diamonds:4"]),
      ],
      drawPile: ["hearts:2", "hearts:6", "clubs:7", "clubs:8", "hearts:5", "spades:6"],
    });

    state = step(state, { type: "drawCard", actorId: "alice" }).state;
    state = step(state, {
      type: "replaceSlot",
      actorId: "alice",
      slotId: slot("alice", "topRight"),
    }).state;
    state = step(state, {
      type: "attemptSnap",
      actorId: "bob",
      windowId: round(state).snapWindow!.windowId,
      generation: round(state).snapWindow!.generation,
      targetPlayerId: "bob",
      slotId: slot("bob", "topLeft"),
    }).state;
    expect(cardAt(state, "bob", "slot:bob:penalty:1")).toBe("hearts:6");
    state = expire(state).state;
    expect(round(state).activePlayerId).toBe("bob");

    state = step(state, { type: "drawCard", actorId: "bob" }).state;
    state = step(state, { type: "discardDrawn", actorId: "bob" }).state;
    state = step(state, {
      type: "attemptSnap",
      actorId: "alice",
      windowId: round(state).snapWindow!.windowId,
      generation: round(state).snapWindow!.generation,
      targetPlayerId: "carol",
      slotId: slot("carol", "topLeft"),
    }).state;
    expect(round(state).pendingTransfer).toEqual({
      fromPlayerId: "alice",
      toPlayerId: "carol",
      targetSlotId: slot("carol", "topLeft"),
    });
    state = step(state, {
      type: "chooseTransferTarget",
      actorId: "alice",
      slotId: slot("alice", "topLeft"),
    }).state;
    state = step(state, {
      type: "selectPowerTarget",
      actorId: "bob",
      targetPlayerId: "bob",
      slotId: slot("bob", "topLeft"),
    }).state;
    state = step(state, { type: "acknowledgePowerReveal", actorId: "bob" }).state;
    expect(round(state).activePlayerId).toBe("carol");

    state = step(state, { type: "drawCard", actorId: "carol" }).state;
    state = step(state, { type: "discardDrawn", actorId: "carol" }).state;
    state = step(state, { type: "skipPower", actorId: "carol" }).state;
    state = expire(state).state;
    expect(round(state).activePlayerId).toBe("alice");

    state = step(state, { type: "callCambio", actorId: "alice" }).state;
    expect(round(state).cambio?.finalTurnQueue).toEqual(["bob", "carol"]);
    state = step(state, { type: "drawCard", actorId: "bob" }).state;
    state = step(state, { type: "discardDrawn", actorId: "bob" }).state;
    state = expire(state).state;
    state = step(state, { type: "drawCard", actorId: "carol" }).state;
    state = step(state, {
      type: "replaceSlot",
      actorId: "carol",
      slotId: slot("carol", "bottomRight"),
    }).state;
    const roundEnded = expire(state);
    state = roundEnded.state;

    expect(state.status).toBe("intermission");
    expect(round(state).endReason).toBe("cambio");
    expect(pointsFromRoundEnded(roundEnded.events)).toEqual({
      alice: { rawScore: 9, matchPoints: 0 },
      bob: { rawScore: 41, matchPoints: 41 },
      carol: { rawScore: 16, matchPoints: 16 },
    });
    expect(state.cumulativeScores).toEqual({ alice: 0, bob: 41, carol: 16 });

    for (const playerId of ["alice", "bob", "carol"] as const) {
      state = step(state, { type: "readyForNextRound", actorId: playerId }).state;
    }
    expect(state.status).toBe("active");
    expect(round(state).roundNumber).toBe(2);
    expect(round(state).dealerId).toBe("alice");

    for (const playerId of ["alice", "bob", "carol"] as const) {
      state = step(state, { type: "acknowledgeOpeningPeek", actorId: playerId }).state;
    }
    state = withScriptedRound(state, {
      roundNumber: 2,
      dealerId: "alice",
      activePlayerId: "alice",
      grids: [
        grid("alice", ["clubs:A", null, null, null]),
        grid("bob", ["clubs:2", null, null, null]),
        grid("carol", ["clubs:3", null, null, null]),
      ],
      drawPile: [],
      discardPile: [],
    });
    state = step(state, { type: "drawCard", actorId: "alice" }).state;
    expect(state.status).toBe("intermission");
    expect(state.completedRounds).toBe(2);
    expect(state.cumulativeScores).toEqual({ alice: 1, bob: 43, carol: 19 });

    state = step(state, { type: "readyForNextRound", actorId: "alice" }).state;
    state = step(state, { type: "readyForNextRound", actorId: "bob" }).state;
    const completed = step(state, { type: "readyForNextRound", actorId: "carol" });
    state = completed.state;

    expect(state.status).toBe("complete");
    expect(round(state).phase).toBe("complete");
    expect(completed.events.at(-1)).toEqual({
      type: "matchCompleted",
      winners: ["alice"],
      cumulativeScores: { alice: 1, bob: 43, carol: 19 },
    });
  });
});

function step(
  state: MatchState,
  command: Exclude<EngineCommand, { readonly type: "createMatch" }>,
): Extract<TransitionResult, { ok: true }> {
  return accepted(reduceCommand(state, command));
}

function expire(state: MatchState): Extract<TransitionResult, { ok: true }> {
  const snapWindow = round(state).snapWindow;
  if (snapWindow === null) {
    throw new Error("expected snap window");
  }

  return step(state, {
    type: "expireSnapWindow",
    windowId: snapWindow.windowId,
    generation: snapWindow.generation,
  });
}

function withScriptedRound(
  state: MatchState,
  options: {
    readonly roundNumber: number;
    readonly dealerId: PlayerId;
    readonly activePlayerId: PlayerId;
    readonly grids: readonly ReturnType<typeof grid>[];
    readonly drawPile: readonly CardId[];
    readonly discardPile?: readonly CardId[];
  },
): MatchState {
  const scripted = createScriptedTurnCycleMatchForTesting({
    playerIds: state.seats.map((seat) => seat.playerId),
    roundCount: state.config.roundCount,
    roundNumber: options.roundNumber,
    dealerId: options.dealerId,
    activePlayerId: options.activePlayerId,
    grids: options.grids,
    drawPile: options.drawPile,
    ...(options.discardPile === undefined ? {} : { discardPile: options.discardPile }),
    seed: 271_828,
  });
  const nextState = {
    ...state,
    status: "active" as const,
    randomState: scripted.randomState,
    snapWindowSequence: 0,
    lastResolvedSnapWindow: null,
    round: scripted.round,
  };
  expect(checkInvariants(nextState)).toEqual({ ok: true, violations: [] });
  return nextState;
}

function cardAt(state: MatchState, playerId: PlayerId, slotId: string): CardId | null {
  const found = round(state).slotsByPlayer[playerId]?.find((candidate) => candidate.slotId === slotId);
  if (found === undefined) {
    throw new Error("missing slot");
  }

  return found.cardId;
}

function accepted(result: TransitionResult): Extract<TransitionResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.code);
  }

  expect(checkInvariants(result.state)).toEqual({ ok: true, violations: [] });
  return result;
}

function pointsFromRoundEnded(
  events: readonly DomainEvent[],
): Record<string, { readonly rawScore: number; readonly matchPoints: number }> {
  const event = events.find((candidate) => candidate.type === "roundEnded");
  if (event?.type !== "roundEnded") {
    throw new Error("expected roundEnded event");
  }

  return Object.fromEntries(
    event.scores.map((score) => [
      score.playerId,
      {
        rawScore: score.rawScore,
        matchPoints: score.matchPoints,
      },
    ]),
  );
}
