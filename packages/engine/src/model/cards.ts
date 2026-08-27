export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number] | "JOKER";
export type CardId = string;

export interface Card {
  readonly id: CardId;
  readonly rank: Rank;
  readonly suit: Suit | null;
}

export type CardCatalog = Readonly<Record<CardId, Card>>;

export function cardValue(card: Card): number {
  if (card.rank === "JOKER") {
    return 0;
  }

  if (card.rank === "A") {
    return 1;
  }

  if (card.rank === "J" || card.rank === "Q") {
    return 10;
  }

  if (card.rank === "K") {
    return card.suit === "diamonds" || card.suit === "hearts" ? -1 : 10;
  }

  return Number(card.rank);
}

export function isPowerCard(card: Card): boolean {
  return (
    card.rank === "7" ||
    card.rank === "8" ||
    card.rank === "9" ||
    card.rank === "10" ||
    card.rank === "J" ||
    card.rank === "Q" ||
    (card.rank === "K" && (card.suit === "clubs" || card.suit === "spades"))
  );
}

export function powerKind(card: Card): PowerKind | null {
  if (card.rank === "7" || card.rank === "8") {
    return "peekOwn";
  }

  if (card.rank === "9" || card.rank === "10") {
    return "peekOpponent";
  }

  if (card.rank === "J" || card.rank === "Q") {
    return "blindSwap";
  }

  if (card.rank === "K" && (card.suit === "clubs" || card.suit === "spades")) {
    return "blackKing";
  }

  return null;
}

export type PowerKind = "peekOwn" | "peekOpponent" | "blindSwap" | "blackKing";
