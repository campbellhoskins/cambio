import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkInvariants } from "./invariants.js";
import type { CardId } from "./model/cards.js";
import type { PlayerId, SlotId } from "./model/ids.js";
import type { MatchState, RoundState } from "./model/state.js";
import {
  acknowledgePowerReveal,
  attemptSnap,
  callCambio,
  chooseTransferTarget,
  decideBlackKingSwap,
  discardDrawn,
  drawCard,
  expireSnapWindow,
  removePlayer,
  reselectPowerTarget,
  replaceSlot,
  selectPowerTarget,
  skipPower,
  startingSlotId,
  type RejectionCode,
  type TransitionResult,
} from "./setup.js";
import {
  createScriptedTurnCycleMatchForTesting,
  type ScriptedPlayerGrid,
} from "./testing/index.js";

describe("power and snap engine transitions", () => {
  it("opens deterministic snap windows and optional powers on discard and replace", () => {
    let state = createMatch({
      drawPile: ["clubs:7", "hearts:5"],
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:5", "clubs:6", "clubs:8", "clubs:9"]),
      ],
    });

    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    let discarded = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" }));
    state = discarded.state;
    expect(round(state).turnStage).toBe("resolving");
    expect(round(state).activePlayerId).toBe("alice");
    expect(round(state).snapWindow).toMatchObject({
      windowId: "window:1:1",
      timerId: "timer:snap:1:1",
      generation: 1,
      triggerCardId: "clubs:7",
      triggerRank: "7",
      durationMs: 5_000,
      remainingMs: 5_000,
    });
    expect(round(state).pendingPower).toMatchObject({
      ownerId: "alice",
      sourceCardId: "clubs:7",
      kind: "peekOwn",
      stage: "offered",
    });
    expect(discarded.events.map((event) => event.type)).toContain("snapWindowOpened");
    expect(discarded.events.map((event) => event.type)).toContain("powerOffered");

    state = accepted(skipPower(state, { type: "skipPower", actorId: "alice" })).state;
    state = expireOpenSnap(state);
    state = accepted(drawCard(state, { type: "drawCard", actorId: "bob" })).state;
    discarded = accepted(
      replaceSlot(state, {
        type: "replaceSlot",
        actorId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    );
    expect(round(discarded.state).snapWindow?.windowId).toBe("window:1:2");
    expect(discarded.state.snapWindowSequence).toBe(2);
  });

  it("resolves peek powers with private owner-only reveals and acknowledgement", () => {
    for (const [cardId, kind, targetPlayerId] of [
      ["clubs:7", "peekOwn", "alice"],
      ["clubs:9", "peekOpponent", "bob"],
    ] as const) {
      let state = createMatch({
        drawPile: [cardId],
        grids: [
          grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
          grid("bob", ["clubs:5", "clubs:6", "clubs:8", "clubs:10"]),
        ],
      });
      state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
      state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;

      const selected = accepted(
        selectPowerTarget(state, {
          type: "selectPowerTarget",
          actorId: "alice",
          targetPlayerId,
          slotId: slot(targetPlayerId, "topLeft"),
        }),
      );
      state = selected.state;
      expect(round(state).pendingPower).toMatchObject({
        kind,
        stage: "awaitingRevealAck",
        revealedCardIds: [targetPlayerId === "alice" ? "clubs:A" : "clubs:5"],
      });
      expect(selected.events).toContainEqual({
        type: "powerRevealed",
        ownerId: "alice",
        recipientId: "alice",
        cardIds: [targetPlayerId === "alice" ? "clubs:A" : "clubs:5"],
        private: true,
      });

      state = accepted(
        acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" }),
      ).state;
      expect(round(state).pendingPower).toBeNull();
      expect(round(state).activePlayerId).toBe("alice");
      state = expireOpenSnap(state);
      expect(round(state).activePlayerId).toBe("bob");
    }
  });

  it("executes blind swaps, rejects duplicate targets, and conserves cards", () => {
    let state = createMatch({
      drawPile: ["clubs:J"],
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:5", "clubs:6", "clubs:7", "clubs:8"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    assertRejected(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      state,
      "E_TARGET_NOT_DISTINCT",
    );

    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    ).state;
    expect(cardAt(state, "alice", "topLeft")).toBe("clubs:5");
    expect(cardAt(state, "bob", "topLeft")).toBe("clubs:A");
    expect(round(state).pendingPower).toBeNull();
    expect(round(state).snapWindow).not.toBeNull();
  });

  it("runs black king reveal, confirm, decline, and invalid target rejection paths", () => {
    let state = createBlackKingDecisionState();
    state = accepted(
      decideBlackKingSwap(state, {
        type: "decideBlackKingSwap",
        actorId: "alice",
        decision: "confirm",
      }),
    ).state;
    expect(cardAt(state, "alice", "topLeft")).toBe("clubs:5");
    expect(cardAt(state, "bob", "topLeft")).toBe("clubs:A");

    state = createBlackKingDecisionState();
    state = accepted(
      decideBlackKingSwap(state, {
        type: "decideBlackKingSwap",
        actorId: "alice",
        decision: "decline",
      }),
    ).state;
    expect(cardAt(state, "alice", "topLeft")).toBe("clubs:A");
    expect(cardAt(state, "bob", "topLeft")).toBe("clubs:5");

    state = createBlackKingDecisionState();
    const invalid = {
      ...state,
      round: {
        ...round(state),
        slotsByPlayer: {
          ...round(state).slotsByPlayer,
          alice: (round(state).slotsByPlayer.alice ?? []).map((slotState) =>
            slotState.slotId === slot("alice", "topLeft")
              ? { ...slotState, cardId: "clubs:2" }
              : slotState.slotId === slot("alice", "topRight")
                ? { ...slotState, cardId: "clubs:A" }
                : slotState,
          ),
        },
      },
    };
    assertRejected(
      decideBlackKingSwap(invalid, {
        type: "decideBlackKingSwap",
        actorId: "alice",
        decision: "confirm",
      }),
      invalid,
      "E_TARGET_INVALID",
    );
  });

  it("keeps unrelated powers after snaps and prompts reselection for moved selected targets", () => {
    let state = createMatch({
      drawPile: ["clubs:J"],
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["spades:J", "clubs:6", "clubs:7", "clubs:8"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;

    const snapped = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: round(state).snapWindow!.windowId,
        generation: round(state).snapWindow!.generation,
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    );
    state = snapped.state;
    expect(round(state).pendingPower).toMatchObject({
      kind: "blindSwap",
      stage: "selectingSecond",
    });
    expect(snapped.events.map((event) => event.type)).not.toContain("powerTargetInvalidated");

    state = createMatch({
      drawPile: ["clubs:J"],
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["spades:J", "clubs:6", "clubs:7", "clubs:8"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    ).state;
    const invalidated = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: round(state).snapWindow!.windowId,
        generation: round(state).snapWindow!.generation,
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    );
    expect(round(invalidated.state).pendingPower).toMatchObject({
      kind: "blindSwap",
      stage: "selectingFirst",
      selections: [],
    });
    expect(invalidated.events.map((event) => event.type)).toContain("powerTargetInvalidated");
  });

  it("drops only an invalid power target when explicitly reselected", () => {
    let state = createMatch({
      drawPile: ["clubs:J"],
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["spades:J", "clubs:6", "clubs:7", "clubs:8"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;

    const invalidState: MatchState = {
      ...state,
      round: {
        ...round(state),
        slotsByPlayer: {
          ...round(state).slotsByPlayer,
          alice: (round(state).slotsByPlayer.alice ?? []).map((slotState) =>
            slotState.slotId === slot("alice", "topLeft")
              ? { ...slotState, cardId: "clubs:2" }
              : slotState.slotId === slot("alice", "topRight")
                ? { ...slotState, cardId: "clubs:A" }
                : slotState,
          ),
        },
      },
    };

    const reselected = accepted(
      reselectPowerTarget(invalidState, {
        type: "reselectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    );
    expect(round(reselected.state).pendingPower).toMatchObject({
      kind: "blindSwap",
      stage: "selectingFirst",
      selections: [],
    });
  });

  it("auto-skips invalidated power targets when no legal target remains", () => {
    let state = createMatch({
      playerIds: ["alice", "bob", "carol"],
      drawPile: ["clubs:9"],
      grids: [
        grid("alice", ["clubs:A", null, null, null]),
        grid("bob", ["spades:9", null, null, null]),
        grid("carol", [null, null, null, null]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    ).state;

    const removed = accepted(removePlayer(state, "bob"));
    expect(round(removed.state).pendingPower).toBeNull();
    expect(removed.events).toContainEqual({
      type: "powerSkipped",
      ownerId: "alice",
      kind: "peekOpponent",
      reason: "autoSkipped",
    });
  });

  it("resolves correct own and opponent snaps, transfer requirements, stale windows, and winners", () => {
    let state = createMatch({
      drawPile: ["hearts:5"],
      grids: [
        grid("alice", ["clubs:5", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:6", "clubs:7", "clubs:8", "clubs:9"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    const window = round(state).snapWindow!;
    state = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "alice",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    expect(cardAt(state, "alice", "topLeft")).toBeNull();
    expect(round(state).snapWindow).toBeNull();
    assertRejected(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "bob",
        slotId: slot("bob", "topRight"),
      }),
      state,
      "E_SNAP_ALREADY_RESOLVED",
    );

    state = createMatch({
      drawPile: ["hearts:5"],
      grids: [
        grid("alice", ["clubs:5", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:6", "clubs:7", "clubs:8", "clubs:9"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    state = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: round(state).snapWindow!.windowId,
        generation: round(state).snapWindow!.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    expect(round(state).pendingTransfer).toEqual({
      fromPlayerId: "bob",
      toPlayerId: "alice",
      targetSlotId: slot("alice", "topLeft"),
    });
    expect(round(state).activePlayerId).toBe("alice");
    state = accepted(
      chooseTransferTarget(state, {
        type: "chooseTransferTarget",
        actorId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    ).state;
    expect(cardAt(state, "alice", "topLeft")).toBe("clubs:6");
    expect(cardAt(state, "bob", "topLeft")).toBeNull();
    expect(round(state).activePlayerId).toBe("bob");

    const noCardState = accepted(
      discardDrawn(
        accepted(
          drawCard(
            createMatch({
              drawPile: ["hearts:5"],
              grids: [
                grid("alice", ["clubs:5", "clubs:2", "clubs:3", "clubs:4"]),
                grid("bob", [null, null, null, null]),
              ],
            }),
            { type: "drawCard", actorId: "alice" },
          ),
        ).state,
        { type: "discardDrawn", actorId: "alice" },
      ),
    ).state;
    assertRejected(
      attemptSnap(noCardState, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: round(noCardState).snapWindow!.windowId,
        generation: round(noCardState).snapWindow!.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      noCardState,
      "E_NO_TRANSFER_CARD",
    );
  });

  it("handles wrong snaps, penalties, stock exhaustion, and snap-window expiry", () => {
    let state = createMatch({
      drawPile: ["hearts:5", "hearts:6"],
      grids: [
        grid("alice", [null, "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:6", "clubs:7", "clubs:8", "clubs:9"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    let window = round(state).snapWindow!;
    let snapped = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    );
    state = snapped.state;
    expect(snapped.events).toContainEqual({
      type: "snapTransientReveal",
      playerId: "bob",
      target: { playerId: "bob", slotId: slot("bob", "topLeft") },
      cardId: "clubs:6",
      rank: "6",
      transient: true,
    });
    expect(cardAt(state, "bob", "topLeft")).toBe("clubs:6");
    expect(cardBySlotId(state, "bob", "slot:bob:penalty:1")).toBe("hearts:6");
    expect(round(state).snapWindow).not.toBeNull();

    const stale = accepted(
      expireSnapWindow(state, {
        type: "expireSnapWindow",
        windowId: window.windowId,
        generation: window.generation - 1,
      }),
    );
    expect(stale.state).toBe(state);
    state = accepted(
      expireSnapWindow(state, {
        type: "expireSnapWindow",
        windowId: window.windowId,
        generation: window.generation,
      }),
    ).state;
    expect(round(state).activePlayerId).toBe("bob");
    assertRejected(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
      state,
      "E_STALE_SNAP_WINDOW",
    );

    state = createMatch({
      drawPile: ["hearts:5"],
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:6", "clubs:7", "clubs:8", "clubs:9"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    window = round(state).snapWindow!;
    snapped = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    );
    expect(snapped.state.status).toBe("intermission");
    expect(round(snapped.state).endReason).toBe("stockExhausted");
  });

  it("orders power, snap window, and transfer obligations through the single gate", () => {
    let state = createMatch({
      drawPile: ["clubs:7"],
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["hearts:7", "clubs:6", "clubs:8", "clubs:9"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    state = accepted(
      acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" }),
    ).state;
    expect(round(state).activePlayerId).toBe("alice");
    state = expireOpenSnap(state);
    expect(round(state).activePlayerId).toBe("bob");

    state = createMatch({
      drawPile: ["hearts:5"],
      grids: [
        grid("alice", ["clubs:5", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:6", "clubs:7", "clubs:8", "clubs:9"]),
      ],
    });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
    state = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: round(state).snapWindow!.windowId,
        generation: round(state).snapWindow!.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    expect(round(state).activePlayerId).toBe("alice");
    state = accepted(
      chooseTransferTarget(state, {
        type: "chooseTransferTarget",
        actorId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    ).state;
    expect(round(state).activePlayerId).toBe("bob");
  });

  it("uses the active player's final-turn queue entry when snaps complete another player's command", () => {
    let state = createMatch({
      playerIds: ["alice", "bob", "carol"],
      activePlayerId: "alice",
      grids: [
        grid("alice", ["clubs:5", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:6", "clubs:7", "clubs:8", "clubs:9"]),
        grid("carol", ["clubs:A", "hearts:2", "hearts:3", "hearts:4"]),
      ],
      drawPile: ["hearts:5"],
    });
    state = accepted(callCambio(state, { type: "callCambio", actorId: "alice" })).state;
    state = accepted(drawCard(state, { type: "drawCard", actorId: "bob" })).state;
    state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "bob" })).state;
    state = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "carol",
        windowId: round(state).snapWindow!.windowId,
        generation: round(state).snapWindow!.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    state = accepted(
      chooseTransferTarget(state, {
        type: "chooseTransferTarget",
        actorId: "carol",
        slotId: slot("carol", "topLeft"),
      }),
    ).state;
    expect(round(state).cambio?.completedFinalTurns).toEqual(["bob"]);
    expect(round(state).activePlayerId).toBe("carol");
  });

  it("removes players deterministically across caller, active, dealer, transfer, and abandonment paths", () => {
    let state = createMatch({
      playerIds: ["alice", "bob", "carol"],
      activePlayerId: "alice",
    });
    state = accepted(callCambio(state, { type: "callCambio", actorId: "alice" })).state;
    let removed = accepted(removePlayer(state, "alice"));
    expect(removed.state.status).toBe("intermission");
    expect(round(removed.state).endReason).toBe("callerRemoved");

    state = createMatch({ playerIds: ["alice", "bob", "carol"], activePlayerId: "alice" });
    state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
    removed = accepted(removePlayer(state, "alice"));
    expect(round(removed.state).outOfPlay).toContain(round(state).drawnCard!.cardId);
    expect(round(removed.state).activePlayerId).toBe("bob");
    expect(removed.state.seats.find((seat) => seat.playerId === "alice")).toMatchObject({
      connection: "removed",
      withdrawn: true,
    });

    state = createMatch({ playerIds: ["alice", "bob", "carol"], dealerId: "alice" });
    removed = accepted(removePlayer(state, "alice"));
    expect(round(removed.state).dealerId).toBe("bob");

    state = createPendingTransferState("source");
    removed = accepted(removePlayer(state, "bob"));
    expect(round(removed.state).pendingTransfer).toBeNull();
    expect(cardAt(removed.state, "alice", "topLeft")).toBeNull();

    state = createPendingTransferState("victim");
    removed = accepted(removePlayer(state, "alice"));
    expect(round(removed.state).pendingTransfer).toBeNull();
    expect(cardAt(removed.state, "bob", "topLeft")).toBe("clubs:6");

    state = createMatch({ playerIds: ["alice", "bob"] });
    removed = accepted(removePlayer(state, "bob"));
    expect(removed.state.status).toBe("abandoned");
    expect(round(removed.state).endReason).toBe("insufficientPlayers");
    expect(removed.events.at(-1)?.type).toBe("matchAbandoned");
  });

  it("conserves cards across randomized legal power, snap, and transfer interleavings", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(
          fc.constantFrom("select", "ack", "skip", "wrong", "correct", "transfer", "expire"),
          {
            minLength: 1,
            maxLength: 20,
          },
        ),
        (seed, actions) => {
          let state = createMatch({
            playerIds: ["alice", "bob", "carol"],
            seed,
            activePlayerId: "alice",
            drawPile: ["clubs:7", "hearts:8", "hearts:9", "hearts:10"],
            grids: [
              grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
              grid("bob", ["hearts:7", "clubs:6", "clubs:8", "clubs:9"]),
              grid("carol", ["clubs:5", "diamonds:6", "diamonds:7", "diamonds:8"]),
            ],
          });
          state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
          state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;

          for (const action of actions) {
            const result = applyLegalAction(state, action);
            if (result !== null) {
              state = accepted(result).state;
              expect(checkInvariants(state)).toEqual({ ok: true, violations: [] });
            }
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

function createMatch(
  options: {
    readonly playerIds?: readonly PlayerId[];
    readonly activePlayerId?: PlayerId;
    readonly dealerId?: PlayerId;
    readonly seed?: number;
    readonly grids?: readonly ScriptedPlayerGrid[];
    readonly drawPile?: readonly CardId[];
    readonly discardPile?: readonly CardId[];
  } = {},
): MatchState {
  const playerIds = options.playerIds ?? ["alice", "bob"];
  return createScriptedTurnCycleMatchForTesting({
    playerIds,
    activePlayerId: options.activePlayerId ?? playerIds[0]!,
    dealerId: options.dealerId ?? playerIds[0]!,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.grids === undefined ? {} : { grids: options.grids }),
    ...(options.drawPile === undefined ? {} : { drawPile: options.drawPile }),
    ...(options.discardPile === undefined ? {} : { discardPile: options.discardPile }),
  });
}

function createBlackKingDecisionState(): MatchState {
  let state = createMatch({
    drawPile: ["clubs:K"],
    grids: [
      grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
      grid("bob", ["clubs:5", "clubs:6", "clubs:7", "clubs:8"]),
    ],
  });
  state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
  state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
  state = accepted(
    selectPowerTarget(state, {
      type: "selectPowerTarget",
      actorId: "alice",
      targetPlayerId: "alice",
      slotId: slot("alice", "topLeft"),
    }),
  ).state;
  state = accepted(
    acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" }),
  ).state;
  state = accepted(
    selectPowerTarget(state, {
      type: "selectPowerTarget",
      actorId: "alice",
      targetPlayerId: "bob",
      slotId: slot("bob", "topLeft"),
    }),
  ).state;
  expect(round(state).pendingPower?.revealedCardIds).toEqual(["clubs:A", "clubs:5"]);
  return accepted(
    acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" }),
  ).state;
}

function createPendingTransferState(branch: "source" | "victim"): MatchState {
  let state = createMatch({
    playerIds: ["alice", "bob", "carol"],
    drawPile: ["hearts:5"],
    grids: [
      grid("alice", ["clubs:5", "clubs:2", "clubs:3", "clubs:4"]),
      grid("bob", ["clubs:6", "clubs:7", "clubs:8", "clubs:9"]),
      grid("carol", ["clubs:A", "hearts:2", "hearts:3", "hearts:4"]),
    ],
  });
  state = accepted(drawCard(state, { type: "drawCard", actorId: "alice" })).state;
  state = accepted(discardDrawn(state, { type: "discardDrawn", actorId: "alice" })).state;
  state = accepted(
    attemptSnap(state, {
      type: "attemptSnap",
      actorId: "bob",
      windowId: round(state).snapWindow!.windowId,
      generation: round(state).snapWindow!.generation,
      targetPlayerId: "alice",
      slotId: slot("alice", "topLeft"),
    }),
  ).state;
  if (branch === "victim") {
    expect(round(state).pendingTransfer?.toPlayerId).toBe("alice");
  }

  return state;
}

function applyLegalAction(state: MatchState, action: string): TransitionResult | null {
  if (state.status !== "active" || round(state).phase !== "turnCycle") {
    return null;
  }

  const pendingPower = round(state).pendingPower;
  const snapWindow = round(state).snapWindow;
  const transfer = round(state).pendingTransfer;

  if (action === "select" && pendingPower !== null) {
    if (pendingPower.stage === "offered" || pendingPower.stage === "selectingFirst") {
      return selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: pendingPower.ownerId,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      });
    }
    if (pendingPower.stage === "selectingSecond") {
      return selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: pendingPower.ownerId,
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      });
    }
  }

  if (action === "ack" && pendingPower?.stage === "awaitingRevealAck") {
    return acknowledgePowerReveal(state, {
      type: "acknowledgePowerReveal",
      actorId: pendingPower.ownerId,
    });
  }

  if (action === "skip" && pendingPower?.stage === "offered") {
    return skipPower(state, { type: "skipPower", actorId: pendingPower.ownerId });
  }

  if (action === "wrong" && snapWindow !== null) {
    return attemptSnap(state, {
      type: "attemptSnap",
      actorId: "bob",
      windowId: snapWindow.windowId,
      generation: snapWindow.generation,
      targetPlayerId: "bob",
      slotId: slot("bob", "topRight"),
    });
  }

  if (action === "correct" && snapWindow !== null) {
    return attemptSnap(state, {
      type: "attemptSnap",
      actorId: "bob",
      windowId: snapWindow.windowId,
      generation: snapWindow.generation,
      targetPlayerId: "bob",
      slotId: slot("bob", "topLeft"),
    });
  }

  if (action === "transfer" && transfer !== null) {
    return chooseTransferTarget(state, {
      type: "chooseTransferTarget",
      actorId: transfer.fromPlayerId,
      slotId: slot(transfer.fromPlayerId, "topRight"),
    });
  }

  if (action === "expire" && snapWindow !== null) {
    return expireSnapWindow(state, {
      type: "expireSnapWindow",
      windowId: snapWindow.windowId,
      generation: snapWindow.generation,
    });
  }

  return null;
}

function grid(playerId: PlayerId, cards: readonly (CardId | null)[]): ScriptedPlayerGrid {
  return {
    playerId,
    cards,
  };
}

function slot(
  playerId: PlayerId,
  position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
): SlotId {
  return startingSlotId(playerId, position);
}

function round(state: MatchState): RoundState {
  if (state.round === null) {
    throw new Error("expected round");
  }

  return state.round;
}

function cardAt(
  state: MatchState,
  playerId: PlayerId,
  position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
): CardId | null {
  const found = round(state)
    .slotsByPlayer[playerId]?.find((slotState) => slotState.slotId === slot(playerId, position));
  if (found === undefined) {
    throw new Error("missing slot");
  }

  return found.cardId;
}

function cardBySlotId(state: MatchState, playerId: PlayerId, slotId: SlotId): CardId | null {
  const found = round(state).slotsByPlayer[playerId]?.find((slotState) => slotState.slotId === slotId);
  if (found === undefined) {
    throw new Error("missing slot");
  }

  return found.cardId;
}

function accepted(result: TransitionResult): Extract<TransitionResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.code);
  }

  expect(checkInvariants(result.state)).toEqual({ ok: true, violations: [] });
  return result;
}

function assertRejected(result: TransitionResult, state: MatchState, code: RejectionCode): void {
  expect(result).toEqual({
    ok: false,
    state,
    code,
    events: [],
  });
  expect(result.state).toBe(state);
}

function expireOpenSnap(state: MatchState): MatchState {
  const snapWindow = round(state).snapWindow;
  if (snapWindow === null) {
    return state;
  }

  return accepted(
    expireSnapWindow(state, {
      type: "expireSnapWindow",
      windowId: snapWindow.windowId,
      generation: snapWindow.generation,
    }),
  ).state;
}
