import { OPENING_PEEK_POSITIONS, type CardId, type MatchState, type PlayerId, type SlotId } from "@cambio/engine";
import { ServerMessageSchema, StateSnapshotViewSchema, type CardView, type ServerMessage, type StateSnapshotView } from "@cambio/protocol";

export interface PrivacyProjection {
  (state: MatchState, viewerSeatId: PlayerId): StateSnapshotView;
}

export function assertPrivacyForEverySeat(state: MatchState, project: PrivacyProjection): void {
  for (const seat of state.seats.filter((candidate) => candidate.connection !== "removed")) {
    const view = project(state, seat.playerId);
    StateSnapshotViewSchema.parse(view);
    assertSnapshotEntitlement(state, view, seat.playerId);
    assertNoEngineCardIdsOrCredentials(view);
  }
}

export function assertServerMessageSafe(
  message: ServerMessage,
  state: MatchState,
  viewerSeatId: PlayerId,
  allowedTransientCards: readonly CardId[] = [],
): void {
  ServerMessageSchema.parse(message);
  assertNoEngineCardIdsOrCredentials(message);

  if (message.type === "stateSnapshot") {
    assertSnapshotEntitlement(state, message.view, viewerSeatId);
    return;
  }

  const allowedCards = new Set(allowedCardIdsForViewer(state, viewerSeatId));
  for (const cardId of allowedTransientCards) {
    allowedCards.add(cardId);
  }

  for (const card of findCardViews(message)) {
    if (!containsMatchingCard(state, allowedCards, card)) {
      throw new Error(`server message leaked unexpected card ${card.rank}`);
    }
  }
}

export function assertNoEngineCardIdsOrCredentials(value: unknown): void {
  visit(value, [], (candidate, path) => {
    const key = path.at(-1) ?? "";
    if (/(secret|credential|token|password)/i.test(key)) {
      throw new Error(`credential-like field leaked at ${path.join(".")}`);
    }

    if (typeof candidate === "string" && /^(clubs|diamonds|hearts|spades):(A|2|3|4|5|6|7|8|9|10|J|Q|K)$|^joker:\d+$/.test(candidate)) {
      throw new Error(`engine card id leaked at ${path.join(".")}`);
    }
  });
}

export function assertSnapshotEntitlement(state: MatchState, view: StateSnapshotView, viewerSeatId: PlayerId): void {
  const round = state.round;
  if (round === null) {
    if (findCardViews(view).length > 0) {
      throw new Error("lobby snapshot contained card data");
    }
    return;
  }

  const entitledSlots = entitledSlotKeys(state, viewerSeatId);
  for (const grid of view.grids) {
    const engineSlots = round.slotsByPlayer[grid.playerId] ?? [];
    for (const slot of grid.slots) {
      const engineSlot = engineSlots.find((candidate) => candidate.slotId === slot.slotId);
      if (engineSlot === undefined) {
        throw new Error(`unknown projected slot ${slot.slotId}`);
      }

      if (engineSlot.cardId === null) {
        if (slot.state !== "hole") {
          throw new Error(`hole ${slot.slotId} projected as ${slot.state}`);
        }
        continue;
      }

      const key = slotKey(grid.playerId, slot.slotId);
      if (entitledSlots.has(key)) {
        if (slot.state !== "revealed" || !cardMatches(state, engineSlot.cardId, slot.card)) {
          throw new Error(`entitled slot ${slot.slotId} was not correctly revealed`);
        }
      } else if (slot.state !== "hidden") {
        throw new Error(`unentitled slot ${slot.slotId} was not hidden`);
      }
    }
  }

  const discardTop = round.discardPile[0];
  if (discardTop === undefined) {
    if (view.piles.discardTop !== null) {
      throw new Error("empty discard pile projected a top card");
    }
  } else if (!cardMatches(state, discardTop, view.piles.discardTop)) {
    throw new Error("discard top projection did not match engine state");
  }

  if (round.drawnCard === null) {
    if (view.drawnCard.state !== "none") {
      throw new Error("missing drawn card projected as present");
    }
  } else if (round.drawnCard.playerId === viewerSeatId) {
    if (view.drawnCard.state !== "revealed" || !cardMatches(state, round.drawnCard.cardId, view.drawnCard.card)) {
      throw new Error("drawn card was not revealed to its owner");
    }
  } else if (view.drawnCard.state !== "hidden") {
    throw new Error("drawn card was not hidden from other viewers");
  }
}

export function allowedCardIdsForViewer(state: MatchState, viewerSeatId: PlayerId): readonly CardId[] {
  const round = state.round;
  if (round === null) {
    return [];
  }

  const allowed = new Set<CardId>();
  const discardTop = round.discardPile[0];
  if (discardTop !== undefined) {
    allowed.add(discardTop);
  }

  if (round.drawnCard?.playerId === viewerSeatId) {
    allowed.add(round.drawnCard.cardId);
  }

  for (const key of entitledSlotKeys(state, viewerSeatId)) {
    const [playerId, slotId] = key.split("\u0000") as [PlayerId, SlotId];
    const cardId = (round.slotsByPlayer[playerId] ?? []).find((slot) => slot.slotId === slotId)?.cardId;
    if (cardId !== undefined && cardId !== null) {
      allowed.add(cardId);
    }
  }

  return [...allowed];
}

function entitledSlotKeys(state: MatchState, viewerSeatId: PlayerId): ReadonlySet<string> {
  const round = state.round;
  const keys = new Set<string>();
  if (round === null) {
    return keys;
  }

  if (round.phase === "scoring" || round.phase === "complete" || state.status === "complete") {
    for (const [playerId, slots] of Object.entries(round.slotsByPlayer)) {
      for (const slot of slots) {
        if (slot.cardId !== null) {
          keys.add(slotKey(playerId, slot.slotId));
        }
      }
    }
  }

  const viewerSeat = state.seats.find((seat) => seat.playerId === viewerSeatId);
  if (round.phase === "openingPeek" && viewerSeat !== undefined && !viewerSeat.openingPeekAcknowledged) {
    for (const slot of round.slotsByPlayer[viewerSeatId] ?? []) {
      if (slot.cardId !== null && slot.kind === "starting" && slot.position !== null && OPENING_PEEK_POSITIONS.includes(slot.position)) {
        keys.add(slotKey(viewerSeatId, slot.slotId));
      }
    }
  }

  const power = round.pendingPower;
  if (power !== null && power.ownerId === viewerSeatId) {
    const revealedIds = new Set<CardId>(
      power.kind === "blackKing" && power.stage === "awaitingKingDecision"
        ? power.selections.map((selection) => selection.cardId)
        : power.stage === "awaitingRevealAck"
          ? power.revealedCardIds
          : [],
    );
    for (const [playerId, slots] of Object.entries(round.slotsByPlayer)) {
      for (const slot of slots) {
        if (slot.cardId !== null && revealedIds.has(slot.cardId)) {
          keys.add(slotKey(playerId, slot.slotId));
        }
      }
    }
  }

  return keys;
}

function slotKey(playerId: PlayerId, slotId: SlotId): string {
  return `${playerId}\u0000${slotId}`;
}

function cardMatches(state: MatchState, cardId: CardId, cardView: CardView | null | undefined): boolean {
  const card = state.round?.cards[cardId];
  return card !== undefined && cardView !== undefined && cardView !== null && card.rank === cardView.rank && card.suit === cardView.suit;
}

function containsMatchingCard(state: MatchState, cardIds: ReadonlySet<CardId>, cardView: CardView): boolean {
  return [...cardIds].some((cardId) => cardMatches(state, cardId, cardView));
}

function findCardViews(value: unknown): readonly CardView[] {
  const cards: CardView[] = [];
  visit(value, [], (candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }

    const maybe = candidate as { readonly rank?: unknown; readonly suit?: unknown };
    if (typeof maybe.rank === "string" && (typeof maybe.suit === "string" || maybe.suit === null)) {
      cards.push(maybe as CardView);
    }
  });
  return cards;
}

function visit(value: unknown, path: readonly string[], visitor: (value: unknown, path: readonly string[]) => void): void {
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, [...path, String(index)], visitor));
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    visit(child, [...path, key], visitor);
  }
}
