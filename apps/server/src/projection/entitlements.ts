import { OPENING_PEEK_POSITIONS, type CardId, type MatchState, type PlayerId, type SlotId } from "@cambio/engine";

export interface ViewerEntitlement {
  readonly slotIds: ReadonlySet<string>;
  readonly drawnCardId: CardId | null;
  readonly publicCardIds: ReadonlySet<CardId>;
}

export function computeViewerEntitlement(state: MatchState, viewerSeatId: PlayerId): ViewerEntitlement {
  const slotIds = new Set<string>();
  const publicCardIds = new Set<CardId>();
  const round = state.round;

  if (round === null) {
    return { slotIds, drawnCardId: null, publicCardIds };
  }

  const discardTop = round.discardPile[0];
  if (discardTop !== undefined) {
    publicCardIds.add(discardTop);
  }

  if (round.phase === "scoring" || round.phase === "complete" || state.status === "complete") {
    for (const [playerId, slots] of Object.entries(round.slotsByPlayer)) {
      for (const slot of slots) {
        if (slot.cardId !== null) {
          slotIds.add(slotKey(playerId, slot.slotId));
        }
      }
    }
  }

  const viewerSeat = state.seats.find((seat) => seat.playerId === viewerSeatId);
  if (
    round.phase === "openingPeek" &&
    viewerSeat !== undefined &&
    viewerSeat.connection !== "removed" &&
    !viewerSeat.openingPeekAcknowledged
  ) {
    for (const slot of round.slotsByPlayer[viewerSeatId] ?? []) {
      if (
        slot.cardId !== null &&
        slot.kind === "starting" &&
        slot.position !== null &&
        OPENING_PEEK_POSITIONS.includes(slot.position)
      ) {
        slotIds.add(slotKey(viewerSeatId, slot.slotId));
      }
    }
  }

  const power = round.pendingPower;
  if (power !== null && power.ownerId === viewerSeatId) {
    const revealCardIds = visiblePowerCardIds(power);
    for (const [playerId, slots] of Object.entries(round.slotsByPlayer)) {
      for (const slot of slots) {
        if (slot.cardId !== null && revealCardIds.has(slot.cardId)) {
          slotIds.add(slotKey(playerId, slot.slotId));
        }
      }
    }
  }

  return {
    slotIds,
    drawnCardId: round.drawnCard?.playerId === viewerSeatId ? round.drawnCard.cardId : null,
    publicCardIds,
  };
}

export function slotKey(playerId: PlayerId, slotId: SlotId): string {
  return `${playerId}\u0000${slotId}`;
}

function visiblePowerCardIds(power: NonNullable<NonNullable<MatchState["round"]>["pendingPower"]>): ReadonlySet<CardId> {
  if (power.kind === "blackKing" && power.stage === "awaitingKingDecision") {
    return new Set(power.selections.map((selection) => selection.cardId));
  }

  if (power.stage === "awaitingRevealAck") {
    return new Set(power.revealedCardIds);
  }

  return new Set();
}
