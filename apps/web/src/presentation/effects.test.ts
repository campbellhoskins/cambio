import { describe, expect, it } from "vitest";
import { slotEffectKey } from "@cambio/ui";
import { card, makeGameView } from "../connection/fixtures.js";
import { derivePresentationEffects } from "./effects.js";

describe("presentation effect derivation", () => {
  it("collapses many public events to current cosmetic effects", () => {
    const view = makeGameView({
      actionLog: [
        { type: "roundDealt", roundNumber: 1, dealerId: "seat-alice" },
        { type: "cardDrawn", playerId: "seat-alice" },
        { type: "slotReplaced", playerId: "seat-alice", slotId: "seat-alice-top-left" },
        {
          type: "snapAttempted",
          playerId: "seat-bob",
          target: { playerId: "seat-alice", slotId: "seat-alice-top-right" },
          correct: true,
          receivedOrder: 7,
        },
        { type: "penaltyCardDrawn", playerId: "seat-bob", slotId: "seat-bob-penalty-1" },
        {
          type: "transferCompleted",
          fromPlayerId: "seat-bob",
          toPlayerId: "seat-alice",
          fromSlotId: "seat-bob-top-left",
          toSlotId: "seat-alice-top-right",
        },
        {
          type: "blackKingSwapDecided",
          ownerId: "seat-alice",
          confirmed: true,
          swapped: true,
          targets: [{ playerId: "seat-alice", slotId: "seat-alice-bottom-left" }],
        },
        {
          type: "roundEnded",
          reason: "cambio",
          scores: [{ playerId: "seat-alice", rawScore: 4, matchPoints: 0, isRoundWinner: true }],
        },
      ],
      publicMovements: [
        {
          type: "blindSwap",
          actorId: "seat-alice",
          targets: [{ playerId: "seat-bob", slotId: "seat-bob-top-right" }],
        },
        {
          type: "playerRemoval",
          targets: [{ playerId: "seat-bob", slotId: "seat-bob-bottom-left" }],
        },
      ],
    });

    const effects = derivePresentationEffects(view, view.actionLog, view.publicMovements, [
      {
        type: "wrongSnapReveal",
        playerId: "seat-alice",
        target: { playerId: "seat-bob", slotId: "seat-bob-bottom-right" },
        card: card("3", "diamonds"),
      },
    ]);

    expect(effects.slotEffects.get(slotEffectKey("seat-alice", "seat-alice-top-left"))).toBe(
      "replace",
    );
    expect(effects.slotEffects.get(slotEffectKey("seat-alice", "seat-alice-bottom-left"))).toBe(
      "swap",
    );
    expect(effects.slotEffects.get(slotEffectKey("seat-bob", "seat-bob-top-right"))).toBe("swap");
    expect(effects.slotEffects.get(slotEffectKey("seat-bob", "seat-bob-bottom-left"))).toBe(
      "discard",
    );
    expect(effects.slotEffects.get(slotEffectKey("seat-bob", "seat-bob-bottom-right"))).toBe(
      "reveal",
    );
    expect(effects.scoreEffect).toBe(true);
    expect(effects.soundCues.map((cue) => cue.kind)).toContain("wrongSnap");
    expect(effects.announcement).toBe("Wrong snap reveal shown briefly.");
  });

  it("maps reshuffle presentation events without depending on action history", () => {
    const effects = derivePresentationEffects(
      makeGameView({ actionLog: [] }),
      [],
      [],
      [{ type: "reshuffled", cardCount: 3 }],
    );

    expect(effects.pileEffect).toBe("reshuffle");
    expect(effects.soundCues).toEqual([{ id: "presentation:reshuffled:3", kind: "reshuffle" }]);
  });
});
