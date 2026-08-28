import { describe, expect, it } from "vitest";
import { createShuffledDeck } from "./deck.js";
import { createSeededRng, randomInt, restoreSeededRng } from "./random.js";

describe("seeded rng", () => {
  it("shuffles reproducibly for the same seed", () => {
    const first = createShuffledDeck(123_456);
    const second = createShuffledDeck(123_456);

    expect(first.order).toEqual(second.order);
    expect(first.randomState).toEqual(second.randomState);
  });

  it("generally shuffles differently for different seeds", () => {
    expect(createShuffledDeck(1).order).not.toEqual(createShuffledDeck(2).order);
  });

  it("restores from serialized state and continues the same sequence", () => {
    const rng = createSeededRng(99);
    const first = rng.nextInt(1_000);
    const second = randomInt(first.state, 1_000);
    const restoredSecond = restoreSeededRng(first.state).nextInt(1_000);

    expect(restoredSecond).toEqual(second);
  });
});
