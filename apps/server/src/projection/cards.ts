import type { Card, CardCatalog, CardId, Rank } from "@cambio/engine";
import type { CardView } from "@cambio/protocol";

export function toCardView(card: Card): CardView {
  if (card.rank === "JOKER") {
    return { rank: "JOKER", suit: null };
  }

  if (card.suit === null) {
    throw new Error(`non-joker card has no suit: ${card.id}`);
  }

  return { rank: card.rank, suit: card.suit };
}

export function cardById(cards: CardCatalog, cardId: CardId): Card {
  const card = cards[cardId];
  if (card === undefined) {
    throw new Error(`unknown card id ${cardId}`);
  }

  return card;
}

export function cardViewEqualsCard(view: CardView, card: Card): boolean {
  return view.rank === card.rank && view.suit === card.suit;
}

export function cardFromInternalId(cardId: CardId, rank: Rank): CardView {
  if (rank === "JOKER") {
    return { rank, suit: null };
  }

  const [suit] = cardId.split(":");
  if (suit !== "clubs" && suit !== "diamonds" && suit !== "hearts" && suit !== "spades") {
    throw new Error(`cannot derive public card from ${cardId}`);
  }

  return { rank, suit };
}
