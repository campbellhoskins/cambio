import type { DomainEvent, PlayerId } from "@cambio/engine";
import type { ActionLogEntry, PresentationEventPayload } from "@cambio/protocol";
import { cardFromInternalId } from "./cards.js";

export function buildActionLogEntries(events: readonly DomainEvent[]): readonly ActionLogEntry[] {
  return events.flatMap((event): readonly ActionLogEntry[] => {
    switch (event.type) {
      case "roundDealt":
        return [{ type: event.type, roundNumber: event.roundNumber, dealerId: event.dealerId }];
      case "openingPeekAcknowledged":
        return [{ type: event.type, playerId: event.playerId, acknowledgedCount: event.acknowledgedCount, requiredCount: event.requiredCount }];
      case "turnStarted":
        return [{ type: event.type, activePlayerId: event.activePlayerId }];
      case "cardDrawn":
        return [{ type: event.type, playerId: event.playerId }];
      case "reshuffled":
        return [{ type: event.type, cardCount: event.cardCount }];
      case "slotReplaced":
        return [{ type: event.type, playerId: event.playerId, slotId: event.slotId }];
      case "cardDiscarded":
        return [{ type: event.type, playerId: event.playerId }];
      case "cambioCalled":
        return [{ type: event.type, callerId: event.callerId, finalTurnQueue: [...event.finalTurnQueue] }];
      case "turnAdvanced":
        return [{ type: event.type, previousPlayerId: event.previousPlayerId, activePlayerId: event.activePlayerId }];
      case "roundEnded":
        return [{ type: event.type, reason: event.reason, scores: [...event.scores] }];
      case "readyForNextRound":
        return [{ type: event.type, playerId: event.playerId, readyCount: event.readyCount, requiredCount: event.requiredCount }];
      case "matchCompleted":
        return [{ type: event.type, winners: [...event.winners], cumulativeScores: { ...event.cumulativeScores } }];
      case "snapWindowOpened":
        return [{ type: event.type, windowId: event.windowId, generation: event.generation }];
      case "snapWindowClosed":
        return [{ type: event.type, windowId: event.windowId, generation: event.generation, resolvedBy: event.resolvedBy }];
      case "powerOffered":
        return [{ type: event.type, ownerId: event.ownerId, kind: event.kind }];
      case "powerSkipped":
        return [{ type: event.type, ownerId: event.ownerId, kind: event.kind, reason: event.reason }];
      case "powerTargetSelected":
        return [{ type: event.type, ownerId: event.ownerId, kind: event.kind, target: event.target }];
      case "powerRevealed":
        return [{ type: event.type, ownerId: event.ownerId, recipientId: event.recipientId, cardCount: event.cardIds.length }];
      case "powerRevealAcknowledged":
        return [{ type: event.type, ownerId: event.ownerId, kind: event.kind }];
      case "blackKingSwapDecided":
        return [{ type: event.type, ownerId: event.ownerId, confirmed: event.confirmed, swapped: event.swapped, targets: [...event.targets] }];
      case "powerTargetInvalidated":
        return [{ type: event.type, ownerId: event.ownerId, kind: event.kind, targets: [...event.targets] }];
      case "snapAttempted":
        return [{ type: event.type, playerId: event.playerId, target: event.target, correct: event.correct, receivedOrder: event.receivedOrder }];
      case "snapTransientReveal":
        return [];
      case "penaltyCardDrawn":
        return [{ type: event.type, playerId: event.playerId, slotId: event.slotId }];
      case "transferCompleted":
        return [{ type: event.type, fromPlayerId: event.fromPlayerId, toPlayerId: event.toPlayerId, fromSlotId: event.fromSlotId, toSlotId: event.toSlotId }];
      case "playerRemoved":
        return [{ type: event.type, playerId: event.playerId }];
      case "matchAbandoned":
        return [{ type: event.type, reason: event.reason, cumulativeScores: { ...event.cumulativeScores } }];
    }
  });
}

export function projectPresentationEvents(events: readonly DomainEvent[], viewerSeatId: PlayerId): readonly PresentationEventPayload[] {
  return events.flatMap((event): readonly PresentationEventPayload[] => {
    void viewerSeatId;
    if (event.type === "snapTransientReveal") {
      return [{ type: "wrongSnapReveal", playerId: event.playerId, target: event.target, card: cardFromInternalId(event.cardId, event.rank) }];
    }

    if (event.type === "reshuffled") {
      return [{ type: "reshuffled", cardCount: event.cardCount }];
    }

    return [];
  });
}
