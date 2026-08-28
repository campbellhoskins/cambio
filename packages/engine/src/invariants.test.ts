import { describe, expect, it } from "vitest";
import { createDeck } from "./deck.js";
import {
  assertInvariants,
  checkCardCatalog,
  checkCardConservation,
  checkInvariants,
  checkStableSlots,
} from "./invariants.js";
import type { CardId } from "./model/cards.js";
import type { CardSlot, MatchState, RoundState } from "./model/state.js";
import { createLobbyMatchForTesting } from "./testing/index.js";
import { createTurnCycleMatch, grid, round, slot } from "./testing/test-helpers.js";

describe("engine invariants", () => {
  it("accepts match states that have no active round", () => {
    const lobby = createLobbyMatchForTesting();

    expect(checkInvariants(lobby)).toEqual({ ok: true, violations: [] });
    expect(() => assertInvariants(lobby)).not.toThrow();
  });

  it("reports card conservation failures for unknown, duplicate, and missing cards", () => {
    const valid = round(
      createTurnCycleMatch({
        grids: [
          grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
          grid("bob", ["clubs:5", "clubs:6", "clubs:7", "clubs:8"]),
        ],
        drawPile: ["hearts:A"],
        discardPile: ["spades:A"],
      }),
    );

    expect(checkCardConservation({ ...valid, drawPile: ["not-a-card", ...valid.drawPile] }).map(code)).toContain(
      "CARD_UNKNOWN",
    );
    expect(checkCardConservation({ ...valid, discardPile: ["clubs:A", ...valid.discardPile] }).map(code)).toContain(
      "CARD_DUPLICATE",
    );

    const missingCard = valid.outOfPlay[0]!;
    expect(
      checkCardConservation({
        ...valid,
        outOfPlay: valid.outOfPlay.filter((cardId) => cardId !== missingCard),
      }).map(code),
    ).toContain("CARD_MISSING");
  });

  it("reports card catalog drift from the canonical deck", () => {
    const deck = createDeck();

    expect(
      checkCardCatalog({
        ...deck.cards,
        "fake:1": { id: "fake:1", rank: "A", suit: "clubs" },
      }).map(code),
    ).toContain("CARD_CATALOG_UNKNOWN");

    expect(
      checkCardCatalog({
        ...deck.cards,
        "clubs:A": { id: "wrong-id", rank: "A", suit: "clubs" },
      }).map(code),
    ).toContain("CARD_CATALOG_MISMATCH");

    const missingCatalog = { ...deck.cards };
    delete missingCatalog["clubs:A"];
    expect(checkCardCatalog(missingCatalog).map(code)).toContain("CARD_CATALOG_MISSING");
  });

  it("reports every stable-slot violation branch", () => {
    const slots: readonly CardSlot[] = [
      { slotId: slot("alice", "topLeft"), kind: "starting", position: "topLeft", cardId: "clubs:A" },
      { slotId: slot("alice", "topLeft"), kind: "starting", position: "topRight", cardId: "clubs:2" },
      { slotId: "slot:alice:custom-null", kind: "starting", position: null, cardId: "clubs:3" },
      { slotId: "slot:alice:wrong", kind: "starting", position: "bottomLeft", cardId: "clubs:4" },
      { slotId: slot("alice", "bottomLeft"), kind: "starting", position: "bottomLeft", cardId: "clubs:5" },
      { slotId: "slot:alice:penalty:1", kind: "penalty", position: "bottomRight", cardId: "clubs:6" },
    ];

    expect(checkStableSlots({ ...round(createTurnCycleMatch()), slotsByPlayer: { alice: slots } }).map(code)).toEqual(
      expect.arrayContaining([
        "SLOT_DUPLICATE",
        "SLOT_POSITION_MISSING",
        "SLOT_ID_UNSTABLE",
        "SLOT_POSITION_DUPLICATE",
        "SLOT_PENALTY_POSITION",
      ]),
    );
  });

  it("causes assertInvariants to throw with aggregated violation messages", () => {
    const valid = createTurnCycleMatch({
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:5", "clubs:6", "clubs:7", "clubs:8"]),
      ],
    });
    const invalid = withRound(valid, {
      ...round(valid),
      drawPile: ["not-a-card" as CardId, ...round(valid).drawPile],
      slotsByPlayer: {
        ...round(valid).slotsByPlayer,
        alice: round(valid).slotsByPlayer.alice!.slice(0, 3),
      },
    });

    expect(() => assertInvariants(invalid)).toThrow(/Unknown card id not-a-card/);
    expect(checkInvariants(invalid).violations.map(code)).toEqual(
      expect.arrayContaining(["CARD_UNKNOWN", "SLOT_POSITION_MISSING"]),
    );
  });
});

function code(violation: { readonly code: string }): string {
  return violation.code;
}

function withRound(state: MatchState, nextRound: RoundState): MatchState {
  return {
    ...state,
    round: nextRound,
  };
}
