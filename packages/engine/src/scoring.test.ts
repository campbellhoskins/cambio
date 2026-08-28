import { describe, expect, it } from "vitest";
import { createDeck } from "./deck.js";
import type { CardSlot } from "./model/state.js";
import { calculateRawScores, cumulativeWinners, occupiedCardIds, scoreRound } from "./scoring.js";

describe("scoring helpers", () => {
  it("scores a unique winning cambio caller as zero", () => {
    expect(
      points(scoreRound({ caller: 3, p2: 4, p3: 5 }, ["caller", "p2", "p3"], "cambio", "caller")),
    ).toEqual({
      caller: 0,
      p2: 4,
      p3: 5,
    });
  });

  it("scores a cambio caller tied for lowest as raw points and shares round winners", () => {
    const scores = scoreRound(
      { caller: 3, p2: 3, p3: 5 },
      ["caller", "p2", "p3"],
      "cambio",
      "caller",
    );

    expect(points(scores)).toEqual({ caller: 3, p2: 3, p3: 5 });
    expect(scores.filter((score) => score.isRoundWinner).map((score) => score.playerId)).toEqual([
      "caller",
      "p2",
    ]);
  });

  it("scores a losing cambio caller as twice the highest raw score", () => {
    expect(
      points(scoreRound({ caller: 9, p2: 3, p3: 7 }, ["caller", "p2", "p3"], "cambio", "caller")),
    ).toEqual({
      caller: 18,
      p2: 3,
      p3: 7,
    });
  });

  it("scores non-callers as raw points", () => {
    expect(
      points(scoreRound({ caller: 9, p2: 3, p3: 7 }, ["caller", "p2", "p3"], "cambio", "caller"))
        .p2,
    ).toBe(3);
    expect(
      points(scoreRound({ caller: 9, p2: 3, p3: 7 }, ["caller", "p2", "p3"], "cambio", "caller"))
        .p3,
    ).toBe(7);
  });

  it("scores non-cambio round ends as raw points without caller adjustment", () => {
    expect(
      points(
        scoreRound({ caller: 9, p2: 3, p3: 7 }, ["caller", "p2", "p3"], "stockExhausted", "caller"),
      ),
    ).toEqual({
      caller: 9,
      p2: 3,
      p3: 7,
    });
  });

  it("adds no points for abandoned round-end reasons", () => {
    expect(points(scoreRound({ p1: 9, p2: 3 }, ["p1", "p2"], "hostEnded", null))).toEqual({
      p1: 0,
      p2: 0,
    });
    expect(points(scoreRound({ p1: 9, p2: 3 }, ["p1", "p2"], "insufficientPlayers", null))).toEqual(
      {
        p1: 0,
        p2: 0,
      },
    );
  });

  it("returns empty scoring and winner lists when no players are eligible", () => {
    expect(scoreRound({}, [], "cambio", null)).toEqual([]);
    expect(cumulativeWinners({}, [])).toEqual([]);
  });

  it("returns every player tied for the lowest cumulative score", () => {
    expect(cumulativeWinners({ alice: 3, bob: 3, carol: 7 }, ["alice", "bob", "carol"])).toEqual([
      "alice",
      "bob",
    ]);
    expect(cumulativeWinners({ alice: 0 }, ["alice", "bob"])).toEqual(["alice", "bob"]);
  });

  it("filters holes when listing occupied cards and treats missing score grids as empty", () => {
    const slots: readonly CardSlot[] = [
      { slotId: "slot:alice:starting:topLeft", kind: "starting", position: "topLeft", cardId: "clubs:A" },
      { slotId: "slot:alice:starting:topRight", kind: "starting", position: "topRight", cardId: null },
      { slotId: "slot:alice:penalty:1", kind: "penalty", position: null, cardId: "joker:1" },
    ];

    expect(occupiedCardIds(slots)).toEqual(["clubs:A", "joker:1"]);
    expect(calculateRawScores({ alice: slots }, createDeck().cards, ["alice", "missing"])).toEqual({
      alice: 1,
      missing: 0,
    });
  });
});

function points(
  scores: readonly { readonly playerId: string; readonly matchPoints: number }[],
): Record<string, number> {
  return Object.fromEntries(scores.map((score) => [score.playerId, score.matchPoints]));
}
