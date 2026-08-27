import { RANKS, SUITS, type Card, type CardCatalog, type CardId } from "./model/cards.js";
import { shuffle } from "./random.js";

export interface Deck {
  readonly cards: CardCatalog;
  readonly order: readonly CardId[];
}

export function createDeck(): Deck {
  const cards: Record<CardId, Card> = {};
  const order: CardId[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const id = `${suit}:${rank}`;
      cards[id] = { id, rank, suit };
      order.push(id);
    }
  }

  for (let index = 1; index <= 2; index += 1) {
    const id = `joker:${index}`;
    cards[id] = { id, rank: "JOKER", suit: null };
    order.push(id);
  }

  return { cards, order };
}

export function createShuffledDeck(seed: number): Deck & { readonly randomState: number } {
  const deck = createDeck();
  const result = shuffle(deck.order, seed);
  return {
    cards: deck.cards,
    order: result.items,
    randomState: result.state,
  };
}
