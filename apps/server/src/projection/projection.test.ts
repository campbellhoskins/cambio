import { describe, expect, it } from "vitest";
import {
  acknowledgePowerReveal,
  attemptSnap,
  discardDrawn,
  drawCard,
  removePlayer,
  selectPowerTarget,
  type DomainEvent,
  type MatchState,
  type TransitionResult,
} from "@cambio/engine";
import { assertPrivacyForEverySeat, assertServerMessageSafe, createStateForTesting, grid, slotId } from "@cambio/testkit";
import { ServerMessageSchema, type CardView, type StateSnapshotView } from "@cambio/protocol";
import { assertViewerSafe, buildActionLogEntries, projectPresentationEvents, projectStateSnapshot } from "./index.js";

const baseGrids = [
  grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
  grid("bob", ["hearts:5", "hearts:6", "hearts:7", "hearts:8"]),
] as const;

describe("viewer-safe state projection", () => {
  it("reveals only the viewer's pending opening peek bottom slots", () => {
    const state = {
      ...createStateForTesting({ phase: "openingPeek", turnStage: null, grids: baseGrids }),
      round: { ...createStateForTesting({ phase: "openingPeek", turnStage: null, grids: baseGrids }).round!, activePlayerId: null },
    };

    assertPrivacyForEverySeat(state, projectStateSnapshot);
    const alice = projectStateSnapshot(state, "alice");
    const bob = projectStateSnapshot(state, "bob");
    expect(revealedSlots(alice, "alice")).toEqual(["bottomLeft", "bottomRight"]);
    expect(revealedSlots(alice, "bob")).toEqual([]);
    expect(revealedSlots(bob, "bob")).toEqual(["bottomLeft", "bottomRight"]);
  });

  it("hides acknowledged opening peeks and reveals only a drawer's drawn card", () => {
    let state = createStateForTesting({ activePlayerId: "alice", grids: baseGrids, drawPile: ["spades:9"] });
    state = accept(drawCard(state, { type: "drawCard", actorId: "alice", expectedRevision: state.revision })).state;

    assertPrivacyForEverySeat(state, projectStateSnapshot);
    expect(projectStateSnapshot(state, "alice").drawnCard).toEqual({ state: "revealed", playerId: "alice", card: { rank: "9", suit: "spades" } });
    expect(projectStateSnapshot(state, "bob").drawnCard).toEqual({ state: "hidden", playerId: "alice" });
  });

  it("reveals pending peek powers only to the power owner", () => {
    const state = pendingPeekState();

    assertPrivacyForEverySeat(state, projectStateSnapshot);
    expect(findSlot(projectStateSnapshot(state, "alice"), "bob", slotId("bob", "topLeft"))).toEqual({ state: "revealed", slotId: slotId("bob", "topLeft"), kind: "starting", position: "topLeft", card: { rank: "5", suit: "hearts" } });
    expect(findSlot(projectStateSnapshot(state, "bob"), "bob", slotId("bob", "topLeft"))?.state).toBe("hidden");
  });

  it("reveals black king selected cards through acknowledgement and decision stages to the owner only", () => {
    const revealState = pendingBlackKingRevealState();
    assertPrivacyForEverySeat(revealState, projectStateSnapshot);
    expect(revealedSlots(projectStateSnapshot(revealState, "alice"), "alice")).toEqual(["topLeft"]);
    expect(revealedSlots(projectStateSnapshot(revealState, "bob"), "alice")).toEqual([]);

    let decisionState = accept(acknowledgePowerReveal(revealState, { type: "acknowledgePowerReveal", actorId: "alice", expectedRevision: revealState.revision })).state;
    decisionState = accept(selectPowerTarget(decisionState, { type: "selectPowerTarget", actorId: "alice", targetPlayerId: "bob", slotId: slotId("bob", "topLeft"), expectedRevision: decisionState.revision })).state;
    decisionState = accept(acknowledgePowerReveal(decisionState, { type: "acknowledgePowerReveal", actorId: "alice", expectedRevision: decisionState.revision })).state;

    assertPrivacyForEverySeat(decisionState, projectStateSnapshot);
    expect(revealedSlots(projectStateSnapshot(decisionState, "alice"), "alice")).toContain("topLeft");
    expect(revealedSlots(projectStateSnapshot(decisionState, "alice"), "bob")).toContain("topLeft");
    expect(revealedSlots(projectStateSnapshot(decisionState, "bob"), "alice")).toEqual([]);
  });

  it("projects snap windows, pending transfers, removed out-of-play counts, holes, and buried discard privacy", () => {
    const snapState = openSnapState();
    expect(projectStateSnapshot(snapState, "alice").snapWindow).toMatchObject({ windowId: "window:1:1", generation: 1, remainingMs: 5_000 });
    assertPrivacyForEverySeat(snapState, projectStateSnapshot);

    const transferState = pendingTransferState();
    expect(projectStateSnapshot(transferState, "bob").pendingTransfer).toEqual({ fromPlayerId: "bob", toPlayerId: "alice", targetSlotId: slotId("alice", "topLeft") });
    assertPrivacyForEverySeat(transferState, projectStateSnapshot);

    const removed = removePlayerState();
    const view = projectStateSnapshot(removed, "alice");
    expect(view.piles.outOfPlayCount).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain("spades:Q");
    expect(hasCardView(view, { rank: "Q", suit: "spades" })).toBe(false);

    const buried = createStateForTesting({ grids: baseGrids, discardPile: ["diamonds:K", "spades:Q", "clubs:10"] });
    const buriedView = projectStateSnapshot(buried, "alice");
    expect(buriedView.piles.discardTop).toEqual({ rank: "K", suit: "diamonds" });
    expect(hasCardView(buriedView, { rank: "Q", suit: "spades" })).toBe(false);
    expect(hasCardView(buriedView, { rank: "10", suit: "clubs" })).toBe(false);
  });

  it("throws when a projected view is tampered to reveal an unauthorized opponent rank", () => {
    const state = createStateForTesting({ grids: baseGrids });
    const view = projectStateSnapshot(state, "alice");
    const bobGrid = view.grids.find((candidate) => candidate.playerId === "bob")!;
    const firstSlot = bobGrid.slots[0]!;
    bobGrid.slots[0] = { ...firstSlot, state: "revealed", card: { rank: "5", suit: "hearts" } };

    expect(() => assertViewerSafe(view, state, "alice")).toThrow(/unauthorized viewer/);
  });

  it("serializes every server message type through testkit privacy checks", () => {
    const state = pendingPeekState();
    for (const seat of state.seats) {
      const view = projectStateSnapshot(state, seat.playerId);
      const messages = [
        ServerMessageSchema.parse({ type: "stateSnapshot", revision: state.revision, serverTime: { epochMs: 1, iso: "1970-01-01T00:00:00.001Z" }, view }),
        ServerMessageSchema.parse({ type: "commandAccepted", commandId: "cmd-1", revision: state.revision, result: { commandType: "drawCard" } }),
        ServerMessageSchema.parse({ type: "commandRejected", commandId: "cmd-1", revision: state.revision, code: "E_STALE_REVISION" }),
        ServerMessageSchema.parse({ type: "presentationEvent", revision: state.revision, payload: { type: "wrongSnapReveal", playerId: "bob", target: { playerId: "alice", slotId: slotId("alice", "topRight") }, card: { rank: "2", suit: "clubs" } } }),
        ServerMessageSchema.parse({ type: "error", revision: state.revision, message: "Protocol error" }),
      ];
      for (const message of messages) {
        assertServerMessageSafe(message, state, seat.playerId, ["clubs:2"]);
      }
    }
  });
});

describe("rank-safe event projections", () => {
  it("omits hidden card ids from the action log and emits wrong snaps as presentation events only", () => {
    const events: DomainEvent[] = [
      { type: "cardDrawn", playerId: "alice", cardId: "clubs:7" },
      { type: "slotReplaced", playerId: "alice", slotId: slotId("alice", "topLeft"), drawnCardId: "clubs:7", discardedCardId: "hearts:5" },
      { type: "snapTransientReveal", playerId: "bob", target: { playerId: "alice", slotId: slotId("alice", "topRight") }, cardId: "clubs:2", rank: "2", transient: true },
      { type: "penaltyCardDrawn", playerId: "bob", slotId: slotId("bob", "topLeft"), cardId: "spades:9" },
    ];

    const log = buildActionLogEntries(events);
    expect(log.map((entry) => entry.type)).toEqual(["cardDrawn", "slotReplaced", "penaltyCardDrawn"]);
    expect(JSON.stringify(log)).not.toMatch(/clubs:7|hearts:5|clubs:2|spades:9|"rank"/);

    expect(projectPresentationEvents(events, "alice")).toEqual([{ type: "wrongSnapReveal", playerId: "bob", target: { playerId: "alice", slotId: slotId("alice", "topRight") }, card: { rank: "2", suit: "clubs" } }]);
  });
});

function pendingPeekState(): MatchState {
  let state = createStateForTesting({ activePlayerId: "alice", grids: baseGrids, drawPile: ["clubs:9"] });
  state = accept(drawCard(state, { type: "drawCard", actorId: "alice", expectedRevision: state.revision })).state;
  state = accept(discardDrawn(state, { type: "discardDrawn", actorId: "alice", expectedRevision: state.revision })).state;
  return accept(selectPowerTarget(state, { type: "selectPowerTarget", actorId: "alice", targetPlayerId: "bob", slotId: slotId("bob", "topLeft"), expectedRevision: state.revision })).state;
}

function pendingBlackKingRevealState(): MatchState {
  let state = createStateForTesting({ activePlayerId: "alice", grids: baseGrids, drawPile: ["clubs:K"] });
  state = accept(drawCard(state, { type: "drawCard", actorId: "alice", expectedRevision: state.revision })).state;
  state = accept(discardDrawn(state, { type: "discardDrawn", actorId: "alice", expectedRevision: state.revision })).state;
  return accept(selectPowerTarget(state, { type: "selectPowerTarget", actorId: "alice", targetPlayerId: "alice", slotId: slotId("alice", "topLeft"), expectedRevision: state.revision })).state;
}

function openSnapState(): MatchState {
  let state = createStateForTesting({ activePlayerId: "alice", grids: baseGrids, drawPile: ["diamonds:8"] });
  state = accept(drawCard(state, { type: "drawCard", actorId: "alice", expectedRevision: state.revision })).state;
  return accept(discardDrawn(state, { type: "discardDrawn", actorId: "alice", expectedRevision: state.revision })).state;
}

function pendingTransferState(): MatchState {
  let state = createStateForTesting({
    activePlayerId: "alice",
    grids: [
      grid("alice", ["hearts:5", "clubs:2", "clubs:3", "clubs:4"]),
      grid("bob", ["hearts:A", "hearts:6", "hearts:7", "hearts:8"]),
    ],
    drawPile: ["clubs:5"],
  });
  state = accept(drawCard(state, { type: "drawCard", actorId: "alice", expectedRevision: state.revision })).state;
  state = accept(discardDrawn(state, { type: "discardDrawn", actorId: "alice", expectedRevision: state.revision })).state;
  return accept(attemptSnap(state, { type: "attemptSnap", actorId: "bob", windowId: state.round!.snapWindow!.windowId, generation: state.round!.snapWindow!.generation, targetPlayerId: "alice", slotId: slotId("alice", "topLeft") })).state;
}

function removePlayerState(): MatchState {
  const state = createStateForTesting({
    playerIds: ["alice", "bob", "carol"],
    grids: [
      grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
      grid("bob", ["spades:Q", "hearts:Q", "diamonds:Q", "clubs:Q"]),
      grid("carol", ["hearts:5", "hearts:6", "hearts:7", "hearts:8"]),
    ],
  });
  return accept(removePlayer(state, "bob")).state;
}

function accept(result: TransitionResult): Extract<TransitionResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.code);
  }
  return result;
}

function revealedSlots(view: StateSnapshotView, playerId: string): readonly string[] {
  return view.grids
    .find((gridView) => gridView.playerId === playerId)!
    .slots.filter((slot) => slot.state === "revealed")
    .map((slot) => slot.position ?? slot.slotId);
}

function findSlot(view: StateSnapshotView, playerId: string, id: string): StateSnapshotView["grids"][number]["slots"][number] | undefined {
  return view.grids.find((gridView) => gridView.playerId === playerId)?.slots.find((slot) => slot.slotId === id);
}

function hasCardView(value: unknown, card: CardView): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasCardView(item, card));
  }

  const candidate = value as { readonly rank?: unknown; readonly suit?: unknown };
  if (candidate.rank === card.rank && candidate.suit === card.suit) {
    return true;
  }

  return Object.values(value).some((item) => hasCardView(item, card));
}
