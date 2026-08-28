import { describe, expect, it } from "vitest";
import { scoreRound } from "./scoring.js";

describe("scoring helpers", () => {
  it("scores a unique winning cambio caller as zero", () => {
    expect(points(scoreRound({ caller: 3, p2: 4, p3: 5 }, ["caller", "p2", "p3"], "cambio", "caller"))).toEqual({
      caller: 0,
      p2: 4,
      p3: 5,
    });
  });

  it("scores a cambio caller tied for lowest as raw points and shares round winners", () => {
    const scores = scoreRound({ caller: 3, p2: 3, p3: 5 }, ["caller", "p2", "p3"], "cambio", "caller");

    expect(points(scores)).toEqual({ caller: 3, p2: 3, p3: 5 });
    expect(scores.filter((score) => score.isRoundWinner).map((score) => score.playerId)).toEqual(["caller", "p2"]);
  });

  it("scores a losing cambio caller as twice the highest raw score", () => {
    expect(points(scoreRound({ caller: 9, p2: 3, p3: 7 }, ["caller", "p2", "p3"], "cambio", "caller"))).toEqual({
      caller: 18,
      p2: 3,
      p3: 7,
    });
  });

  it("scores non-callers as raw points", () => {
    expect(points(scoreRound({ caller: 9, p2: 3, p3: 7 }, ["caller", "p2", "p3"], "cambio", "caller")).p2).toBe(3);
    expect(points(scoreRound({ caller: 9, p2: 3, p3: 7 }, ["caller", "p2", "p3"], "cambio", "caller")).p3).toBe(7);
  });

  it("scores non-cambio round ends as raw points without caller adjustment", () => {
    expect(
      points(scoreRound({ caller: 9, p2: 3, p3: 7 }, ["caller", "p2", "p3"], "stockExhausted", "caller")),
    ).toEqual({
      caller: 9,
      p2: 3,
      p3: 7,
    });
  });
});

function points(scores: readonly { readonly playerId: string; readonly matchPoints: number }[]): Record<string, number> {
  return Object.fromEntries(scores.map((score) => [score.playerId, score.matchPoints]));
}
