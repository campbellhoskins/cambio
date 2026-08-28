import type { CardId, MatchState, PlayerId } from "@cambio/engine";
import { StateSnapshotViewSchema, type CardView, type StateSnapshotView } from "@cambio/protocol";
import { cardById, cardViewEqualsCard } from "./cards.js";
import { computeViewerEntitlement, slotKey } from "./entitlements.js";

const INTERNAL_CARD_ID_PATTERN = /^(clubs|diamonds|hearts|spades):(A|2|3|4|5|6|7|8|9|10|J|Q|K)$|^joker:\d+$/;
const FORBIDDEN_KEYS = new Set(["drawPile", "discardPile", "outOfPlay", "cardId"]);
const FORBIDDEN_KEY_PATTERN = /(secret|credential|token|password)/i;

export function assertViewerSafe(view: StateSnapshotView, state: MatchState, viewerSeatId: PlayerId): void {
  StateSnapshotViewSchema.parse(view);
  assertNoForbiddenKeysOrIds(view);

  const entitlement = computeViewerEntitlement(state, viewerSeatId);
  const round = state.round;
  if (round === null) {
    assertNoCardViewsOutsideAllowedPaths(view, new Set());
    return;
  }

  const allowedCardPaths = new Set<string>();
  const discardTop = round.discardPile[0];
  if (discardTop !== undefined) {
    assertCardViewAtPath(view.piles.discardTop, round.cards, discardTop, "piles.discardTop");
    allowedCardPaths.add("piles.discardTop");
  } else if (view.piles.discardTop !== null) {
    throw new Error("discard top is present when the engine discard pile is empty");
  }

  if (view.drawnCard.state === "revealed") {
    if (entitlement.drawnCardId === null) {
      throw new Error("drawn card is revealed to an unauthorized viewer");
    }
    assertCardViewAtPath(view.drawnCard.card, round.cards, entitlement.drawnCardId, "drawnCard.card");
    allowedCardPaths.add("drawnCard.card");
  }

  for (let gridIndex = 0; gridIndex < view.grids.length; gridIndex += 1) {
    const grid = view.grids[gridIndex]!;
    const engineSlots = round.slotsByPlayer[grid.playerId] ?? [];
    for (let slotIndex = 0; slotIndex < grid.slots.length; slotIndex += 1) {
      const slot = grid.slots[slotIndex]!;
      if (slot.state !== "revealed") {
        continue;
      }

      const path = `grids.${gridIndex}.slots.${slotIndex}.card`;
      const engineSlot = engineSlots.find((candidate) => candidate.slotId === slot.slotId);
      if (engineSlot === undefined || engineSlot.cardId === null) {
        throw new Error(`revealed slot ${slot.slotId} has no engine card`);
      }

      if (!entitlement.slotIds.has(slotKey(grid.playerId, slot.slotId))) {
        throw new Error(`slot ${slot.slotId} is revealed to an unauthorized viewer`);
      }

      assertCardViewAtPath(slot.card, round.cards, engineSlot.cardId, path);
      allowedCardPaths.add(path);
    }
  }

  assertNoCardViewsOutsideAllowedPaths(view, allowedCardPaths);
}

function assertCardViewAtPath(view: CardView | null, cards: MatchState["round"] extends null ? never : NonNullable<MatchState["round"]>["cards"], cardId: CardId, path: string): void {
  if (view === null || !cardViewEqualsCard(view, cardById(cards, cardId))) {
    throw new Error(`card view at ${path} does not match authorized engine card`);
  }
}

function assertNoForbiddenKeysOrIds(value: unknown): void {
  visit(value, [], (candidate, path) => {
    const key = path.at(-1);
    if (key !== undefined && (FORBIDDEN_KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key))) {
      throw new Error(`forbidden private field in projection: ${path.join(".")}`);
    }

    if (typeof candidate === "string" && INTERNAL_CARD_ID_PATTERN.test(candidate)) {
      throw new Error(`engine card id leaked at ${path.join(".")}`);
    }
  });
}

function assertNoCardViewsOutsideAllowedPaths(value: unknown, allowedCardPaths: ReadonlySet<string>): void {
  visit(value, [], (candidate, path) => {
    if (!isCardView(candidate)) {
      return;
    }

    const pathKey = path.join(".");
    if (!allowedCardPaths.has(pathKey)) {
      throw new Error(`card rank leaked at ${pathKey}`);
    }
  });
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

function isCardView(value: unknown): value is CardView {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { readonly rank?: unknown; readonly suit?: unknown };
  return typeof candidate.rank === "string" && (typeof candidate.suit === "string" || candidate.suit === null);
}
