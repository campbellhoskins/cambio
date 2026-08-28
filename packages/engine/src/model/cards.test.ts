import { describe, expect, it } from "vitest";
import { createDeck } from "../deck.js";
import { cardValue, isPowerCard, powerKind, RANKS, SUITS, type Card } from "./cards.js";

describe("card catalog", () => {
  it("contains the 54 canonical card identities", () => {
    const deck = createDeck();

    expect(deck.order).toHaveLength(54);
    expect(new Set(deck.order).size).toBe(54);
    expect(Object.keys(deck.cards)).toHaveLength(54);

    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const id = `${suit}:${rank}`;
        expect(deck.cards[id]).toEqual({ id, rank, suit });
      }
    }

    expect(deck.cards["joker:1"]).toEqual({ id: "joker:1", rank: "JOKER", suit: null });
    expect(deck.cards["joker:2"]).toEqual({ id: "joker:2", rank: "JOKER", suit: null });
  });

  it("assigns card values from the rules table", () => {
    const cases: readonly [Card, number][] = [
      [{ id: "joker:1", rank: "JOKER", suit: null }, 0],
      [{ id: "clubs:A", rank: "A", suit: "clubs" }, 1],
      [{ id: "clubs:2", rank: "2", suit: "clubs" }, 2],
      [{ id: "clubs:6", rank: "6", suit: "clubs" }, 6],
      [{ id: "clubs:7", rank: "7", suit: "clubs" }, 7],
      [{ id: "clubs:10", rank: "10", suit: "clubs" }, 10],
      [{ id: "clubs:J", rank: "J", suit: "clubs" }, 10],
      [{ id: "clubs:Q", rank: "Q", suit: "clubs" }, 10],
      [{ id: "clubs:K", rank: "K", suit: "clubs" }, 10],
      [{ id: "spades:K", rank: "K", suit: "spades" }, 10],
      [{ id: "diamonds:K", rank: "K", suit: "diamonds" }, -1],
      [{ id: "hearts:K", rank: "K", suit: "hearts" }, -1],
    ];

    for (const [card, expectedValue] of cases) {
      expect(cardValue(card)).toBe(expectedValue);
    }
  });

  it("classifies powers from ranks and suit color", () => {
    const cases: readonly [Card, ReturnType<typeof powerKind>][] = [
      [{ id: "clubs:7", rank: "7", suit: "clubs" }, "peekOwn"],
      [{ id: "clubs:8", rank: "8", suit: "clubs" }, "peekOwn"],
      [{ id: "clubs:9", rank: "9", suit: "clubs" }, "peekOpponent"],
      [{ id: "clubs:10", rank: "10", suit: "clubs" }, "peekOpponent"],
      [{ id: "clubs:J", rank: "J", suit: "clubs" }, "blindSwap"],
      [{ id: "clubs:Q", rank: "Q", suit: "clubs" }, "blindSwap"],
      [{ id: "clubs:K", rank: "K", suit: "clubs" }, "blackKing"],
      [{ id: "spades:K", rank: "K", suit: "spades" }, "blackKing"],
      [{ id: "diamonds:K", rank: "K", suit: "diamonds" }, null],
      [{ id: "hearts:K", rank: "K", suit: "hearts" }, null],
      [{ id: "joker:1", rank: "JOKER", suit: null }, null],
      [{ id: "clubs:6", rank: "6", suit: "clubs" }, null],
    ];

    for (const [card, expectedPower] of cases) {
      expect(powerKind(card)).toBe(expectedPower);
      expect(isPowerCard(card)).toBe(expectedPower !== null);
    }
  });
});
