import { createDeck } from "./deck.js";
import { cardValue } from "./model/cards.js";
import type { CardCatalog, CardId } from "./model/cards.js";
import type { PlayerId, SlotId } from "./model/ids.js";
import type { CardSlot, MatchState, RoundState, StartingSlotPosition } from "./model/state.js";
import { STARTING_SLOT_POSITIONS, startingSlotId } from "./setup.js";

export interface InvariantViolation {
  readonly code: string;
  readonly message: string;
}

export interface InvariantCheckResult {
  readonly ok: boolean;
  readonly violations: readonly InvariantViolation[];
}

export function checkInvariants(state: MatchState): InvariantCheckResult {
  if (state.round === null) {
    return { ok: true, violations: [] };
  }

  const violations = [
    ...checkCardCatalog(state.round.cards),
    ...checkCardConservation(state.round),
    ...checkStableSlots(state.round),
  ];

  return {
    ok: violations.length === 0,
    violations,
  };
}

export function checkCardConservation(round: RoundState): readonly InvariantViolation[] {
  const expectedCardIds = new Set(Object.keys(round.cards));
  const seen = new Set<CardId>();
  const violations: InvariantViolation[] = [];

  for (const cardId of collectCardIds(round)) {
    if (!expectedCardIds.has(cardId)) {
      violations.push({
        code: "CARD_UNKNOWN",
        message: `Unknown card id ${cardId}`,
      });
      continue;
    }

    if (seen.has(cardId)) {
      violations.push({
        code: "CARD_DUPLICATE",
        message: `Duplicate card id ${cardId}`,
      });
      continue;
    }

    seen.add(cardId);
  }

  for (const cardId of expectedCardIds) {
    if (!seen.has(cardId)) {
      violations.push({
        code: "CARD_MISSING",
        message: `Missing card id ${cardId}`,
      });
    }
  }

  return violations;
}

export function checkStableSlots(round: RoundState): readonly InvariantViolation[] {
  return Object.entries(round.slotsByPlayer).flatMap(([playerId, slots]) =>
    checkPlayerSlots(playerId, slots),
  );
}

export function checkCardCatalog(cards: CardCatalog): readonly InvariantViolation[] {
  const canonicalCards = createDeck().cards;
  const canonicalIds = new Set(Object.keys(canonicalCards));
  const violations: InvariantViolation[] = [];

  for (const [cardId, card] of Object.entries(cards)) {
    const canonicalCard = canonicalCards[cardId];
    if (canonicalCard === undefined) {
      violations.push({
        code: "CARD_CATALOG_UNKNOWN",
        message: `Card ${cardId} is not in the canonical catalog`,
      });
      continue;
    }

    if (
      card.id !== cardId ||
      card.rank !== canonicalCard.rank ||
      card.suit !== canonicalCard.suit ||
      cardValue(card) !== cardValue(canonicalCard)
    ) {
      violations.push({
        code: "CARD_CATALOG_MISMATCH",
        message: `Card ${cardId} does not match the canonical catalog`,
      });
    }
  }

  for (const cardId of canonicalIds) {
    if (cards[cardId] === undefined) {
      violations.push({
        code: "CARD_CATALOG_MISSING",
        message: `Canonical card ${cardId} is absent`,
      });
    }
  }

  return violations;
}

export function assertInvariants(state: MatchState): void {
  const result = checkInvariants(state);
  if (!result.ok) {
    throw new Error(result.violations.map((violation) => violation.message).join("; "));
  }
}

function collectCardIds(round: RoundState): readonly CardId[] {
  const slotCards = Object.values(round.slotsByPlayer).flatMap((slots) =>
    slots.flatMap((slot) => (slot.cardId === null ? [] : [slot.cardId])),
  );
  const drawnCards = round.drawnCard === null ? [] : [round.drawnCard.cardId];

  return [...round.drawPile, ...round.discardPile, ...slotCards, ...drawnCards, ...round.outOfPlay];
}

function checkPlayerSlots(playerId: PlayerId, slots: readonly CardSlot[]): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const seenSlotIds = new Set<SlotId>();
  const seenStartingPositions = new Set<StartingSlotPosition>();

  for (const slot of slots) {
    if (seenSlotIds.has(slot.slotId)) {
      violations.push({
        code: "SLOT_DUPLICATE",
        message: `Duplicate slot ${slot.slotId}`,
      });
      continue;
    }

    seenSlotIds.add(slot.slotId);

    if (slot.kind === "starting") {
      if (slot.position === null) {
        violations.push({
          code: "SLOT_POSITION_MISSING",
          message: `Starting slot ${slot.slotId} has no position`,
        });
        continue;
      }

      if (slot.slotId !== startingSlotId(playerId, slot.position)) {
        violations.push({
          code: "SLOT_ID_UNSTABLE",
          message: `Starting slot ${slot.slotId} does not match its stable position`,
        });
      }

      if (seenStartingPositions.has(slot.position)) {
        violations.push({
          code: "SLOT_POSITION_DUPLICATE",
          message: `Duplicate starting position ${slot.position} for ${playerId}`,
        });
      }

      seenStartingPositions.add(slot.position);
    } else if (slot.position !== null) {
      violations.push({
        code: "SLOT_PENALTY_POSITION",
        message: `Penalty slot ${slot.slotId} has a starting-grid position`,
      });
    }
  }

  for (const position of STARTING_SLOT_POSITIONS) {
    if (!seenStartingPositions.has(position)) {
      violations.push({
        code: "SLOT_POSITION_MISSING",
        message: `Missing starting position ${position} for ${playerId}`,
      });
    }
  }

  return violations;
}
