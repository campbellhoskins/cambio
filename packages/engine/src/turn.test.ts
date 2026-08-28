import { describe, expect, it } from "vitest";
import { checkInvariants } from "./invariants.js";
import type { PlayerId, SlotId } from "./model/ids.js";
import type { MatchState, RoundState } from "./model/state.js";
import {
  callCambio,
  discardDrawn,
  drawCard,
  readyForNextRound,
  reduceCommand,
  replaceSlot,
  startingSlotId,
  type DomainEvent,
  type EngineCommand,
  type RejectionCode,
  type TransitionResult,
} from "./setup.js";
import {
  createScriptedTurnCycleMatchForTesting,
  type ScriptedPlayerGrid,
} from "./testing/index.js";

describe("turn engine transitions", () => {
  it("plays a scripted full round through cambio final turns and scoring", () => {
    let state = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob", "carol"],
      activePlayerId: "bob",
      dealerId: "alice",
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:5", "clubs:6", "clubs:7", "clubs:8"]),
        grid("carol", ["clubs:9", "clubs:10", "clubs:J", "clubs:Q"]),
      ],
      drawPile: ["diamonds:5", "hearts:6"],
    });

    let result = accepted(callCambio(state, { type: "callCambio", actorId: "bob" }));
    state = result.state;
    expect(round(state).cambio).toEqual({
      callerId: "bob",
      finalTurnQueue: ["carol", "alice"],
      completedFinalTurns: [],
    });
    expect(round(state).activePlayerId).toBe("carol");

    result = accepted(drawCard(state, { type: "drawCard", actorId: "carol" }));
    state = result.state;
    expect(round(state).drawnCard).toEqual({ playerId: "carol", cardId: "diamonds:5" });
    result = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "carol" }));
    state = result.state;
    expect(round(state).discardPile[0]).toBe("diamonds:5");
    expect(round(state).activePlayerId).toBe("alice");

    result = accepted(drawCard(state, { type: "drawCard", actorId: "alice" }));
    state = result.state;
    result = accepted(
      replaceSlot(state, {
        type: "replaceSlot",
        actorId: "alice",
        slotId: startingSlotId("alice", "topLeft"),
      }),
    );
    state = result.state;

    expect(state.status).toBe("intermission");
    expect(state.completedRounds).toBe(1);
    expect(round(state).phase).toBe("scoring");
    expect(round(state).endReason).toBe("cambio");
    expect(round(state).cambio).toEqual({
      callerId: "bob",
      finalTurnQueue: [],
      completedFinalTurns: ["carol", "alice"],
    });
    expect(pointsFromRoundEnded(result.events)).toEqual({
      alice: { rawScore: 15, matchPoints: 15 },
      bob: { rawScore: 26, matchPoints: 78 },
      carol: { rawScore: 39, matchPoints: 39 },
    });
    expect(state.cumulativeScores).toEqual({ alice: 15, bob: 78, carol: 39 });
    expect(checkInvariants(state)).toEqual({ ok: true, violations: [] });
  });

  it("draws from stock, reshuffles buried discards, and safely ends on stock exhaustion", () => {
    const stockState = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob"],
      activePlayerId: "alice",
      drawPile: ["hearts:A"],
    });
    const stockDraw = accepted(drawCard(stockState, { type: "drawCard", actorId: "alice" }));
    expect(round(stockDraw.state).drawnCard).toEqual({ playerId: "alice", cardId: "hearts:A" });
    expect(round(stockDraw.state).drawPile).not.toContain("hearts:A");
    expect(checkInvariants(stockDraw.state)).toEqual({ ok: true, violations: [] });

    const reshuffleState = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob"],
      activePlayerId: "alice",
      drawPile: [],
      discardPile: ["hearts:K", "spades:A", "spades:2", "spades:3"],
    });
    const reshuffleDraw = accepted(
      drawCard(reshuffleState, { type: "drawCard", actorId: "alice" }),
    );
    const reshuffledRound = round(reshuffleDraw.state);
    expect(reshuffleDraw.events.map((event) => event.type)).toEqual(["reshuffled", "cardDrawn"]);
    expect(reshuffledRound.discardPile).toEqual(["hearts:K"]);
    expect(["spades:A", "spades:2", "spades:3"]).toContain(reshuffledRound.drawnCard?.cardId);
    expect(reshuffledRound.drawPile).toHaveLength(2);
    expect(checkInvariants(reshuffleDraw.state)).toEqual({ ok: true, violations: [] });

    const exhaustedState = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob"],
      activePlayerId: "alice",
      grids: [
        grid("alice", ["clubs:A", null, null, null]),
        grid("bob", ["clubs:5", null, null, null]),
      ],
      drawPile: [],
      discardPile: ["hearts:K"],
    });
    const exhausted = accepted(drawCard(exhaustedState, { type: "drawCard", actorId: "alice" }));
    expect(exhausted.state.status).toBe("intermission");
    expect(round(exhausted.state).endReason).toBe("stockExhausted");
    expect(pointsFromRoundEnded(exhausted.events)).toEqual({
      alice: { rawScore: 1, matchPoints: 1 },
      bob: { rawScore: 5, matchPoints: 5 },
    });
    expect(round(exhausted.state).discardPile).toEqual(["hearts:K"]);
    expect(checkInvariants(exhausted.state)).toEqual({ ok: true, violations: [] });
  });

  it("builds a clockwise final-turn queue, advances through it, and rejects a second cambio", () => {
    let state = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob", "carol", "dave"],
      activePlayerId: "carol",
      dealerId: "bob",
      drawPile: ["hearts:2", "hearts:3", "hearts:4"],
    });

    const called = accepted(callCambio(state, { type: "callCambio", actorId: "carol" }));
    state = called.state;
    expect(round(state).cambio?.finalTurnQueue).toEqual(["dave", "alice", "bob"]);
    expect(round(state).activePlayerId).toBe("dave");
    assertRejected(
      callCambio(state, { type: "callCambio", actorId: "dave" }),
      state,
      "E_CAMBIO_ALREADY_CALLED",
    );

    for (const playerId of ["dave", "alice", "bob"] as const) {
      state = accepted(drawCard(state, { type: "drawCard", actorId: playerId })).state;
      state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: playerId })).state;
    }

    expect(state.status).toBe("intermission");
    expect(round(state).endReason).toBe("cambio");
    expect(round(state).cambio?.completedFinalTurns).toEqual(["dave", "alice", "bob"]);
  });

  it("handles replace, discard, and gameplay rejections atomically", () => {
    const baseState = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob"],
      activePlayerId: "alice",
      grids: [
        grid("alice", [null, "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:5", "clubs:6", "clubs:7", "clubs:8"]),
      ],
      drawPile: ["hearts:5", "hearts:6"],
    });

    assertRejected(
      replaceSlot(baseState, {
        type: "replaceSlot",
        actorId: "alice",
        slotId: slot("alice", "topRight"),
      }),
      baseState,
      "E_NO_DRAWN_CARD",
    );
    assertRejected(
      discardDrawn(baseState, { type: "discardDrawn", actorId: "alice" }),
      baseState,
      "E_NO_DRAWN_CARD",
    );
    assertRejected(
      drawCard(baseState, { type: "drawCard", actorId: "bob" }),
      baseState,
      "E_NOT_ACTIVE_PLAYER",
    );
    const pausedState = { ...baseState, pauseReasons: ["bob"] };
    assertRejected(
      drawCard(pausedState, { type: "drawCard", actorId: "alice" }),
      pausedState,
      "E_PAUSED",
    );
    assertRejected(
      drawCard(baseState, {
        type: "drawCard",
        actorId: "alice",
        expectedRevision: baseState.revision - 1,
      }),
      baseState,
      "E_STALE_REVISION",
    );

    const drawn = accepted(drawCard(baseState, { type: "drawCard", actorId: "alice" })).state;
    assertRejected(
      replaceSlot(drawn, {
        type: "replaceSlot",
        actorId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      drawn,
      "E_SLOT_IS_HOLE",
    );
    assertRejected(
      replaceSlot(drawn, { type: "replaceSlot", actorId: "alice", slotId: "missing-slot" }),
      drawn,
      "E_SLOT_NOT_OCCUPIED",
    );

    const discarded = accepted(
      discardDrawn(drawn, { type: "discardDrawn", actorId: "alice" }),
    ).state;
    expect(round(discarded).discardPile[0]).toBe("hearts:5");
    expect(round(discarded).activePlayerId).toBe("bob");
  });

  it("allows a zero-occupied-slot player to draw and discard or call cambio", () => {
    let state = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob"],
      activePlayerId: "alice",
      grids: [
        grid("alice", [null, null, null, null]),
        grid("bob", ["clubs:5", "clubs:6", "clubs:7", "clubs:8"]),
      ],
      drawPile: ["hearts:5"],
    });

    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    expect(round(state).activePlayerId).toBe("bob");
    expect(checkInvariants(state)).toEqual({ ok: true, violations: [] });

    const cambioState = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob"],
      activePlayerId: "alice",
      grids: [
        grid("alice", [null, null, null, null]),
        grid("bob", ["clubs:5", "clubs:6", "clubs:7", "clubs:8"]),
      ],
    });
    const called = accepted(
      callCambio(cambioState, { type: "callCambio", actorId: "alice" }),
    ).state;
    expect(round(called).cambio?.finalTurnQueue).toEqual(["bob"]);
    expect(round(called).activePlayerId).toBe("bob");
  });

  it("accumulates standings, completes tied matches, and rotates the dealer between rounds", () => {
    let state = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob"],
      activePlayerId: "alice",
      dealerId: "alice",
      roundCount: 2,
      grids: [
        grid("alice", ["clubs:A", null, null, null]),
        grid("bob", ["clubs:5", null, null, null]),
      ],
      drawPile: [],
      discardPile: [],
    });

    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    expect(state.cumulativeScores).toEqual({ alice: 1, bob: 5 });

    assertRejected(
      readyForNextRound(state, {
        type: "readyForNextRound",
        actorId: "alice",
        expectedRevision: state.revision - 1,
      }),
      state,
      "E_STALE_REVISION",
    );
    state = accepted(
      readyForNextRound(state, { type: "readyForNextRound", actorId: "alice" }),
    ).state;
    state = accepted(readyForNextRound(state, { type: "readyForNextRound", actorId: "bob" })).state;
    expect(state.status).toBe("active");
    expect(round(state).roundNumber).toBe(2);
    expect(round(state).dealerId).toBe("bob");

    const scriptedSecondRound = createScriptedTurnCycleMatchForTesting({
      playerIds: ["alice", "bob"],
      activePlayerId: "alice",
      dealerId: "bob",
      roundNumber: 2,
      roundCount: 2,
      grids: [
        grid("alice", ["clubs:5", null, null, null]),
        grid("bob", ["clubs:A", null, null, null]),
      ],
      drawPile: [],
      discardPile: [],
    });
    state = {
      ...state,
      round: scriptedSecondRound.round,
    };

    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    expect(state.cumulativeScores).toEqual({ alice: 6, bob: 6 });
    state = accepted(
      readyForNextRound(state, { type: "readyForNextRound", actorId: "alice" }),
    ).state;
    const completed = accepted(
      readyForNextRound(state, { type: "readyForNextRound", actorId: "bob" }),
    );
    expect(completed.state.status).toBe("complete");
    expect(round(completed.state).phase).toBe("complete");
    expect(completed.events.at(-1)).toEqual({
      type: "matchCompleted",
      winners: ["alice", "bob"],
      cumulativeScores: { alice: 6, bob: 6 },
    });
  });

  it("replays the same seeded command sequence to identical states and events", () => {
    const commands: readonly EngineCommand[] = [
      { type: "drawCard", actorId: "alice" },
      { type: "discardDrawn", actorId: "alice" },
      { type: "drawCard", actorId: "bob" },
      { type: "replaceSlot", actorId: "bob", slotId: slot("bob", "topLeft") },
    ];

    const first = replay(commands);
    const second = replay(commands);
    expect(first.state).toEqual(second.state);
    expect(first.events).toEqual(second.events);
  });
});

function replay(commands: readonly EngineCommand[]): {
  readonly state: MatchState;
  readonly events: readonly DomainEvent[];
} {
  let state = createScriptedTurnCycleMatchForTesting({
    playerIds: ["alice", "bob"],
    activePlayerId: "alice",
    seed: 123,
    drawPile: [],
    discardPile: ["hearts:K", "spades:A", "spades:2", "spades:3"],
  });
  const events: DomainEvent[] = [];

  for (const command of commands) {
    const result = accepted(reduceCommand(state, command));
    state = result.state;
    events.push(...result.events);
  }

  return { state, events };
}

function grid(playerId: PlayerId, cards: readonly (string | null)[]): ScriptedPlayerGrid {
  return {
    playerId,
    cards,
  };
}

function slot(
  playerId: PlayerId,
  position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
): SlotId {
  return startingSlotId(playerId, position);
}

function round(state: MatchState): RoundState {
  if (state.round === null) {
    throw new Error("expected round");
  }

  return state.round;
}

function accepted(result: TransitionResult): Extract<TransitionResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.code);
  }

  expect(checkInvariants(result.state)).toEqual({ ok: true, violations: [] });
  return result;
}

function assertRejected(
  result: TransitionResult,
  state: MatchState,
  code: RejectionCode,
  expectSameReference = true,
): void {
  expect(result).toEqual({
    ok: false,
    state,
    code,
    events: [],
  });
  if (expectSameReference) {
    expect(result.state).toBe(state);
  }
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
