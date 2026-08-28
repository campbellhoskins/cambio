import { describe, expect, it } from "vitest";
import type { Card, DomainEvent, MatchState } from "@cambio/engine";
import { discardDrawn, drawCard, type TransitionResult } from "@cambio/engine";
import { createStateForTesting, grid, slotId } from "@cambio/testkit";
import { assertViewerSafe, buildActionLogEntries, cardById, cardFromInternalId, computeViewerEntitlement, projectPresentationEvents, projectStateSnapshot, toCardView } from "./index.js";

describe("projection branch coverage", () => {
  it("covers card conversion and error branches", () => {
    expect(toCardView({ id: "joker:1", rank: "JOKER", suit: null })).toEqual({ rank: "JOKER", suit: null });
    expect(() => toCardView({ id: "bad", rank: "A", suit: null } as Card)).toThrow(/non-joker/);
    expect(cardFromInternalId("joker:1", "JOKER")).toEqual({ rank: "JOKER", suit: null });
    expect(() => cardFromInternalId("bad", "A")).toThrow(/cannot derive/);
    expect(() => cardById({}, "clubs:A")).toThrow(/unknown card id/);
  });

  it("covers lobby, scoring, pause, ready, host, and power legal-action branches", () => {
    const active = createStateForTesting({ grids: baseGrids, discardPile: ["spades:K"] });
    const lobby: MatchState = { ...active, status: "lobby", round: null };
    expect(projectStateSnapshot(lobby, "alice").grids).toEqual([]);
    expect(computeViewerEntitlement(lobby, "alice").drawnCardId).toBeNull();

    const scoring: MatchState = { ...active, status: "intermission", round: { ...active.round!, phase: "scoring", turnStage: null, activePlayerId: null, endReason: "cambio" } };
    expect(projectStateSnapshot(scoring, "alice").grids.flatMap((gridView) => gridView.slots).filter((slot) => slot.state === "revealed")).toHaveLength(8);
    expect(projectStateSnapshot(scoring, "alice").legalActions).toContain("readyForNextRound");

    const paused: MatchState = { ...active, pauseReasons: ["bob"], seats: active.seats.map((seat) => seat.playerId === "bob" ? { ...seat, removalEligible: true } : seat) };
    expect(projectStateSnapshot(paused, "alice").legalActions).toEqual(["hostRemovePlayer"]);

    let drawn = createStateForTesting({ activePlayerId: "alice", grids: baseGrids, drawPile: ["clubs:J"] });
    drawn = accept(drawCard(drawn, { type: "drawCard", actorId: "alice", expectedRevision: drawn.revision })).state;
    expect(projectStateSnapshot(drawn, "alice").legalActions).toEqual(["replaceSlot", "discardDrawn"]);
    drawn = accept(discardDrawn(drawn, { type: "discardDrawn", actorId: "alice", expectedRevision: drawn.revision })).state;
    expect(projectStateSnapshot(drawn, "alice").legalActions).toContain("attemptSnap");
    expect(projectStateSnapshot(drawn, "alice").legalActions).toContain("skipPower");
  });

  it("covers pending selection legal actions and hidden drawn-card assertion failures", () => {
    let state = createStateForTesting({ activePlayerId: "alice", grids: baseGrids, drawPile: ["clubs:J"] });
    state = accept(drawCard(state, { type: "drawCard", actorId: "alice", expectedRevision: state.revision })).state;
    state = accept(discardDrawn(state, { type: "discardDrawn", actorId: "alice", expectedRevision: state.revision })).state;
    const selecting: MatchState = { ...state, round: { ...state.round!, pendingPower: { ...state.round!.pendingPower!, stage: "selectingFirst" } } };
    expect(projectStateSnapshot(selecting, "alice").legalActions).toContain("reselectPowerTarget");

    const view = projectStateSnapshot(state, "bob");
    view.drawnCard = { state: "revealed", playerId: "alice", card: { rank: "J", suit: "clubs" } };
    expect(() => assertViewerSafe(view, state, "bob")).toThrow(/drawn card/);
  });

  it("rejects malformed or misplaced card data in snapshots", () => {
    const state = createStateForTesting({ grids: baseGrids });
    const view = projectStateSnapshot(state, "alice");
    view.piles.discardTop = { rank: "A", suit: "clubs" };
    expect(() => assertViewerSafe(view, state, "alice")).toThrow(/discard top/);

    const mismatchedDiscard = createStateForTesting({ grids: baseGrids, discardPile: ["spades:K"] });
    const discardView = projectStateSnapshot(mismatchedDiscard, "alice");
    discardView.piles.discardTop = { rank: "A", suit: "clubs" };
    expect(() => assertViewerSafe(discardView, mismatchedDiscard, "alice")).toThrow(/does not match/);


    const withForbiddenKey = projectStateSnapshot(state, "alice");
    withForbiddenKey.actionLog = [{ cardId: "opaque" }] as never;
    expect(() => assertViewerSafe(withForbiddenKey, state, "alice")).toThrow(/invalid_union|forbidden private field/);

    const withId = projectStateSnapshot(state, "alice");
    withId.actionLog = ["clubs:A"] as never;
    expect(() => assertViewerSafe(withId, state, "alice")).toThrow(/invalid_(union|type)|engine card id/);
  });

  it("maps every domain event to rank-safe log entries", () => {
    const events: DomainEvent[] = [
      { type: "roundDealt", roundNumber: 1, dealerId: "alice" },
      { type: "openingPeekAcknowledged", playerId: "alice", acknowledgedCount: 1, requiredCount: 2 },
      { type: "turnStarted", activePlayerId: "bob" },
      { type: "cardDrawn", playerId: "bob", cardId: "clubs:3" },
      { type: "reshuffled", cardCount: 3 },
      { type: "slotReplaced", playerId: "bob", slotId: slotId("bob", "topLeft"), drawnCardId: "clubs:3", discardedCardId: "hearts:5" },
      { type: "cardDiscarded", playerId: "bob", cardId: "clubs:3" },
      { type: "cambioCalled", callerId: "bob", finalTurnQueue: ["alice"] },
      { type: "turnAdvanced", previousPlayerId: "bob", activePlayerId: "alice" },
      { type: "roundEnded", reason: "cambio", scores: [{ playerId: "alice", rawScore: 10, matchPoints: 10, isRoundWinner: true }] },
      { type: "readyForNextRound", playerId: "alice", readyCount: 1, requiredCount: 2 },
      { type: "matchCompleted", winners: ["alice"], cumulativeScores: { alice: 0, bob: 10 } },
      { type: "snapWindowOpened", windowId: "window:1:1", generation: 1, timerId: "timer:snap:1:1", triggerCardId: "clubs:3", triggerRank: "3" },
      { type: "snapWindowClosed", windowId: "window:1:1", generation: 1, resolvedBy: null },
      { type: "powerOffered", ownerId: "bob", sourceCardId: "clubs:7", kind: "peekOwn" },
      { type: "powerSkipped", ownerId: "bob", kind: "peekOwn", reason: "skipped" },
      { type: "powerTargetSelected", ownerId: "bob", kind: "peekOwn", target: { playerId: "bob", slotId: slotId("bob", "topLeft") } },
      { type: "powerRevealed", ownerId: "bob", recipientId: "bob", cardIds: ["clubs:3"], private: true },
      { type: "powerRevealAcknowledged", ownerId: "bob", kind: "peekOwn" },
      { type: "blackKingSwapDecided", ownerId: "bob", confirmed: true, swapped: true, targets: [{ playerId: "bob", slotId: slotId("bob", "topLeft") }] },
      { type: "powerTargetInvalidated", ownerId: "bob", kind: "peekOwn", targets: [{ playerId: "bob", slotId: slotId("bob", "topLeft") }] },
      { type: "snapAttempted", playerId: "alice", target: { playerId: "bob", slotId: slotId("bob", "topLeft") }, correct: false, receivedOrder: 0 },
      { type: "snapTransientReveal", playerId: "alice", target: { playerId: "bob", slotId: slotId("bob", "topLeft") }, cardId: "clubs:3", rank: "3", transient: true },
      { type: "penaltyCardDrawn", playerId: "alice", slotId: slotId("alice", "topLeft"), cardId: "clubs:3" },
      { type: "transferCompleted", fromPlayerId: "alice", toPlayerId: "bob", fromSlotId: slotId("alice", "topLeft"), toSlotId: slotId("bob", "topLeft") },
      { type: "playerRemoved", playerId: "bob" },
      { type: "matchAbandoned", reason: "insufficientPlayers", cumulativeScores: { alice: 0 } },
    ];

    const log = buildActionLogEntries(events);
    expect(log).toHaveLength(events.length - 1);
    expect(JSON.stringify(log)).not.toMatch(/clubs:3|hearts:5|triggerRank|sourceCardId|cardIds|discardedCardId|drawnCardId/);
    expect(projectPresentationEvents(events, "bob")).toEqual([
      { type: "reshuffled", cardCount: 3 },
      { type: "wrongSnapReveal", playerId: "alice", target: { playerId: "bob", slotId: slotId("bob", "topLeft") }, card: { rank: "3", suit: "clubs" } },
    ]);
  });
});

const baseGrids = [
  grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
  grid("bob", ["hearts:5", "hearts:6", "hearts:7", "hearts:8"]),
] as const;

function accept(result: TransitionResult): Extract<TransitionResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.code);
  }
  return result;
}
