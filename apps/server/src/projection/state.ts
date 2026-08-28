import type { CardSlot, MatchState, PlayerId } from "@cambio/engine";
import type { LegalAction, StateSnapshotView } from "@cambio/protocol";
import { cardById, toCardView } from "./cards.js";
import { assertViewerSafe } from "./safety.js";
import { computeViewerEntitlement, slotKey } from "./entitlements.js";

export function projectStateSnapshot(state: MatchState, viewerSeatId: PlayerId): StateSnapshotView {
  const round = state.round;
  const entitlement = computeViewerEntitlement(state, viewerSeatId);
  const discardTopId = round?.discardPile[0];
  const view: StateSnapshotView = {
    room: {
      roomId: state.roomId,
      config: state.config,
      status: state.status,
      hostPlayerId: state.hostPlayerId,
    },
    seats: [...state.seats]
      .sort((left, right) => left.seatIndex - right.seatIndex)
      .map((seat) => ({
        playerId: seat.playerId,
        displayName: seat.displayName,
        seatIndex: seat.seatIndex,
        joinOrder: seat.joinOrder,
        connection: seat.connection,
        sessionGeneration: seat.sessionGeneration,
        isHost: seat.playerId === state.hostPlayerId,
        openingPeekAcknowledged: seat.openingPeekAcknowledged,
        readyForNextRound: seat.readyForNextRound,
        removalEligible: seat.removalEligible,
      })),
    viewerSeatId,
    round: {
      roundNumber: round?.roundNumber ?? null,
      phase: round?.phase ?? null,
      turnStage: round?.turnStage ?? null,
      dealerId: round?.dealerId ?? null,
      activePlayerId: round?.activePlayerId ?? null,
      endReason: round?.endReason ?? null,
      cambio: round?.cambio === undefined || round.cambio === null
        ? null
        : {
            callerId: round.cambio.callerId,
            finalTurnQueue: [...round.cambio.finalTurnQueue],
            completedFinalTurns: [...round.cambio.completedFinalTurns],
          },
    },
    piles: {
      drawPileCount: round?.drawPile.length ?? 0,
      discardPileCount: round?.discardPile.length ?? 0,
      outOfPlayCount: round?.outOfPlay.length ?? 0,
      discardTop: round === null || discardTopId === undefined ? null : toCardView(cardById(round.cards, discardTopId)),
    },
    drawnCard: projectDrawnCard(state, viewerSeatId),
    grids: round === null
      ? []
      : [...state.seats]
          .sort((left, right) => left.seatIndex - right.seatIndex)
          .map((seat) => ({
            playerId: seat.playerId,
            slots: (round.slotsByPlayer[seat.playerId] ?? []).map((slot) => projectSlot(slot, seat.playerId, state, entitlement.slotIds)),
          })),
    snapWindow: round?.snapWindow === undefined || round.snapWindow === null
      ? null
      : {
          windowId: round.snapWindow.windowId,
          generation: round.snapWindow.generation,
          remainingMs: round.snapWindow.remainingMs,
          durationMs: round.snapWindow.durationMs,
          resolvedBy: round.snapWindow.resolvedBy,
        },
    pendingPower: round?.pendingPower === undefined || round.pendingPower === null
      ? null
      : {
          ownerId: round.pendingPower.ownerId,
          kind: round.pendingPower.kind,
          stage: round.pendingPower.stage,
          selections: round.pendingPower.selections.map((selection) => ({
            playerId: selection.playerId,
            slotId: selection.slotId,
          })),
        },
    pendingTransfer: round?.pendingTransfer === undefined || round.pendingTransfer === null
      ? null
      : {
          fromPlayerId: round.pendingTransfer.fromPlayerId,
          toPlayerId: round.pendingTransfer.toPlayerId,
          targetSlotId: round.pendingTransfer.targetSlotId,
        },
    pauseReasons: [...state.pauseReasons],
    scores: [...state.seats]
      .sort((left, right) => left.seatIndex - right.seatIndex)
      .map((seat) => ({ playerId: seat.playerId, cumulativeScore: state.cumulativeScores[seat.playerId] ?? 0 })),
    publicMovements: [],
    actionLog: [],
    legalActions: legalActionsForViewer(state, viewerSeatId),
  };

  assertViewerSafe(view, state, viewerSeatId);
  return view;
}

function projectSlot(slot: CardSlot, playerId: PlayerId, state: MatchState, entitledSlotIds: ReadonlySet<string>): StateSnapshotView["grids"][number]["slots"][number] {
  if (slot.cardId === null) {
    return { state: "hole", slotId: slot.slotId, kind: slot.kind, position: slot.position };
  }

  if (!entitledSlotIds.has(slotKey(playerId, slot.slotId))) {
    return { state: "hidden", slotId: slot.slotId, kind: slot.kind, position: slot.position };
  }

  const round = state.round;
  if (round === null) {
    throw new Error("cannot reveal a slot without a round");
  }

  return { state: "revealed", slotId: slot.slotId, kind: slot.kind, position: slot.position, card: toCardView(cardById(round.cards, slot.cardId)) };
}

function projectDrawnCard(state: MatchState, viewerSeatId: PlayerId): StateSnapshotView["drawnCard"] {
  const round = state.round;
  if (round?.drawnCard === undefined || round.drawnCard === null) {
    return { state: "none" };
  }

  if (round.drawnCard.playerId !== viewerSeatId) {
    return { state: "hidden", playerId: round.drawnCard.playerId };
  }

  return {
    state: "revealed",
    playerId: viewerSeatId,
    card: toCardView(cardById(round.cards, round.drawnCard.cardId)),
  };
}

function legalActionsForViewer(state: MatchState, viewerSeatId: PlayerId): LegalAction[] {
  const seat = state.seats.find((candidate) => candidate.playerId === viewerSeatId);
  if (seat === undefined || seat.connection === "removed") {
    return [];
  }

  const actions: LegalAction[] = [];
  const round = state.round;
  if (state.hostPlayerId === viewerSeatId && state.seats.some((candidate) => candidate.removalEligible && candidate.connection !== "removed")) {
    actions.push("hostRemovePlayer");
  }

  if (state.hostPlayerId === viewerSeatId && state.status === "active") {
    actions.push("hostEndMatch");
  }

  if (state.status === "active" && round?.phase === "openingPeek" && !seat.openingPeekAcknowledged) {
    actions.push("acknowledgeOpeningPeek");
  }

  if (state.status === "intermission" && !seat.readyForNextRound) {
    actions.push("readyForNextRound");
  }

  if (state.pauseReasons.length > 0 || state.status !== "active" || round === null || round.phase !== "turnCycle") {
    return actions;
  }

  if (round.snapWindow !== null && round.turnStage === "resolving") {
    actions.push("attemptSnap");
  }

  if (round.pendingTransfer?.fromPlayerId === viewerSeatId) {
    actions.push("chooseTransferTarget");
  }

  if (round.activePlayerId !== viewerSeatId) {
    return actions;
  }

  if (round.turnStage === "turnStart") {
    actions.push("callCambio", "drawCard");
  }

  if (round.turnStage === "drawn") {
    actions.push("replaceSlot", "discardDrawn");
  }

  if (round.turnStage === "resolving" && round.pendingPower?.ownerId === viewerSeatId) {
    if (round.pendingPower.stage === "offered") {
      actions.push("skipPower", "selectPowerTarget");
    } else if (round.pendingPower.stage === "selectingFirst" || round.pendingPower.stage === "selectingSecond") {
      actions.push("selectPowerTarget", "reselectPowerTarget");
    } else if (round.pendingPower.stage === "awaitingRevealAck") {
      actions.push("acknowledgePowerReveal");
    } else if (round.pendingPower.stage === "awaitingKingDecision") {
      actions.push("decideBlackKingSwap");
    }
  }

  return actions;
}
