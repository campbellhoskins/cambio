import { describe, expect, it } from "vitest";
import type { CardId } from "./model/cards.js";
import type { PlayerId, SlotId } from "./model/ids.js";
import type { MatchState, RoundState } from "./model/state.js";
import {
  acknowledgeOpeningPeek,
  acknowledgePowerReveal,
  attemptSnap,
  advanceAfterTurnResolution,
  callCambio,
  chooseTransferTarget,
  createMatch,
  decideBlackKingSwap,
  dealCards,
  discardDrawn,
  drawCard,
  expireSnapWindow,
  readyForNextRound,
  reduceCommand,
  removePlayer,
  reselectPowerTarget,
  replaceSlot,
  selectPowerTarget,
  skipPower,
  startMatch,
  validateRoomConfig,
} from "./setup.js";
import { addLobbySeatForTesting, createLobbyMatchForTesting } from "./testing/index.js";
import {
  accepted,
  assertRejected,
  createTurnCycleMatch,
  grid,
  round,
  slot,
} from "./testing/test-helpers.js";

describe("setup edge transitions", () => {
  it("dispatches every command through reduceCommand", () => {
    const created = accepted(
      reduceCommand(null, {
        type: "createMatch",
        roomId: "room-reduced",
        host: { playerId: "alice", displayName: "Alice" },
        seed: 9,
      }),
    ).state;
    expect(created.roomId).toBe("room-reduced");

    const lobby = createLobbyWithPlayers(["alice", "bob"]);
    const started = accepted(reduceCommand(lobby, { type: "startMatch", actorId: "alice" })).state;
    const peeked = accepted(
      reduceCommand(started, { type: "acknowledgeOpeningPeek", actorId: "alice" }),
    ).state;
    const turnCycle = accepted(
      reduceCommand(peeked, { type: "acknowledgeOpeningPeek", actorId: "bob" }),
    ).state;
    const activePlayerId = round(turnCycle).activePlayerId!;
    const drawn = accepted(reduceCommand(turnCycle, { type: "drawCard", actorId: activePlayerId })).state;
    const replaced = accepted(
      reduceCommand(drawn, {
        type: "replaceSlot",
        actorId: activePlayerId,
        slotId: round(drawn).slotsByPlayer[activePlayerId]![0]!.slotId,
      }),
    ).state;
    const window = round(replaced).snapWindow;
    const resolved = window === null ? replaced : accepted(
      reduceCommand(replaced, {
        type: "expireSnapWindow",
        windowId: window.windowId,
        generation: window.generation,
      }),
    ).state;

    expect(reduceCommand(resolved, { type: "readyForNextRound", actorId: "alice" }).ok).toBe(false);
    expect(reduceCommand(resolved, { type: "callCambio", actorId: "not-active" }).ok).toBe(false);
    expect(reduceCommand(resolved, { type: "discardDrawn", actorId: "not-active" }).ok).toBe(false);
    expect(reduceCommand(resolved, { type: "skipPower", actorId: "alice" }).ok).toBe(false);
    expect(
      reduceCommand(resolved, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }).ok,
    ).toBe(false);
    expect(reduceCommand(resolved, { type: "acknowledgePowerReveal", actorId: "alice" }).ok).toBe(false);
    expect(
      reduceCommand(resolved, {
        type: "decideBlackKingSwap",
        actorId: "alice",
        decision: "decline",
      }).ok,
    ).toBe(false);
    expect(reduceCommand(resolved, { type: "reselectPowerTarget", actorId: "alice" }).ok).toBe(false);
    expect(
      reduceCommand(resolved, {
        type: "attemptSnap",
        actorId: "alice",
        windowId: "stale",
        generation: 1,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }).ok,
    ).toBe(false);
    expect(
      reduceCommand(resolved, {
        type: "chooseTransferTarget",
        actorId: "alice",
        slotId: slot("alice", "topLeft"),
      }).ok,
    ).toBe(false);
  });

  it("covers create, reduce, start, opening peek, and next-round rejection branches", () => {
    expect(validateRoomConfig({ playerCap: 2.5 }).ok).toBe(false);
    assertRejected(
      createMatch({
        type: "createMatch",
        roomId: "room-1",
        host: { playerId: "alice", displayName: "Alice" },
        seed: 1,
        config: { roundCount: 0 },
      }),
      null,
      "E_INVALID_CONFIG",
    );
    assertRejected(reduceCommand(null, { type: "drawCard", actorId: "alice" }), null, "E_ROOM_NOT_FOUND");

    const solo = createLobbyMatchForTesting({ host: { playerId: "alice", displayName: "Alice" } });
    assertRejected(startMatch(solo, { type: "startMatch", actorId: "alice" }), solo, "E_MIN_PLAYERS");

    const lobby = createLobbyWithPlayers(["alice", "bob", "carol"]);
    assertRejected(startMatch(lobby, { type: "startMatch", actorId: "bob" }), lobby, "E_NOT_HOST");
    const active = accepted(startMatch(lobby, { type: "startMatch", actorId: "alice" })).state;
    assertRejected(startMatch(active, { type: "startMatch", actorId: "alice" }), active, "E_ALREADY_STARTED");
    assertRejected(
      acknowledgeOpeningPeek(active, { type: "acknowledgeOpeningPeek", actorId: "mallory" }),
      active,
      "E_UNAUTHORIZED",
    );

    const removedBob = withSeats(active, [
      active.seats[0]!,
      { ...active.seats[1]!, connection: "removed", withdrawn: true },
      active.seats[2]!,
    ]);
    assertRejected(
      acknowledgeOpeningPeek(removedBob, { type: "acknowledgeOpeningPeek", actorId: "bob" }),
      removedBob,
      "E_UNAUTHORIZED",
    );

    let peek = accepted(
      acknowledgeOpeningPeek(active, {
        type: "acknowledgeOpeningPeek",
        actorId: "alice",
        expectedRevision: active.revision,
      }),
    ).state;
    expect(
      accepted(
        acknowledgeOpeningPeek(peek, {
          type: "acknowledgeOpeningPeek",
          actorId: "alice",
          expectedRevision: peek.revision,
        }),
      ).state,
    ).toBe(peek);
    peek = accepted(
      acknowledgeOpeningPeek(peek, { type: "acknowledgeOpeningPeek", actorId: "bob" }),
    ).state;
    const turnCycle = accepted(
      acknowledgeOpeningPeek(peek, { type: "acknowledgeOpeningPeek", actorId: "carol" }),
    ).state;
    const intermission = { ...turnCycle, status: "intermission" as const };
    assertRejected(
      startMatch(intermission, { type: "startMatch", actorId: "alice" }),
      intermission,
      "E_OUT_OF_PHASE",
    );
    assertRejected(
      acknowledgeOpeningPeek(turnCycle, { type: "acknowledgeOpeningPeek", actorId: "alice" }),
      turnCycle,
      "E_OUT_OF_PHASE",
    );
    assertRejected(
      readyForNextRound(turnCycle, { type: "readyForNextRound", actorId: "alice" }),
      turnCycle,
      "E_OUT_OF_PHASE",
    );

    expect(() => dealCards(solo)).toThrow("dealCards requires at least two active seats");
    const abandonedLobby = accepted(removePlayer(createLobbyWithPlayers(["alice", "bob"]), "bob")).state;
    expect(abandonedLobby.status).toBe("abandoned");
    expect(abandonedLobby.round).toBeNull();

    const soloHost = createLobbyMatchForTesting({
      host: { playerId: "alice", displayName: "Alice" },
    });
    expect(accepted(removePlayer(soloHost, "alice")).state.hostPlayerId).toBeNull();
  });

  it("covers draw, replace, discard, and cambio rejection branches", () => {
    const lobby = createLobbyWithPlayers(["alice", "bob"]);
    assertRejected(drawCard(lobby, { type: "drawCard", actorId: "alice" }), lobby, "E_OUT_OF_PHASE");

    const base = createTurnCycleMatch({
      grids: [
        grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
        grid("bob", ["clubs:5", null, "clubs:7", "clubs:8"]),
      ],
      drawPile: ["hearts:5", "hearts:6"],
    });
    const drawn = accepted(drawCard(base, { type: "drawCard", actorId: "alice" })).state;
    assertRejected(drawCard(drawn, { type: "drawCard", actorId: "alice" }), drawn, "E_OUT_OF_PHASE");
    assertRejected(
      replaceSlot(drawn, { type: "replaceSlot", actorId: "bob", slotId: slot("alice", "topLeft") }),
      drawn,
      "E_NOT_ACTIVE_PLAYER",
    );
    assertRejected(
      replaceSlot({ ...drawn, pauseReasons: ["bob"] }, {
        type: "replaceSlot",
        actorId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      { ...drawn, pauseReasons: ["bob"] } as MatchState,
      "E_PAUSED",
      false,
    );
    assertRejected(
      replaceSlot(drawn, {
        type: "replaceSlot",
        actorId: "alice",
        slotId: slot("alice", "topLeft"),
        expectedRevision: drawn.revision - 1,
      }),
      drawn,
      "E_STALE_REVISION",
    );
    const missingActorSlots = withRound(drawn, {
      ...round(drawn),
      slotsByPlayer: { bob: round(drawn).slotsByPlayer.bob! },
    });
    assertRejected(
      replaceSlot(missingActorSlots, {
        type: "replaceSlot",
        actorId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      missingActorSlots,
      "E_SLOT_NOT_OCCUPIED",
    );
    assertRejected(
      discardDrawn(drawn, { type: "discardDrawn", actorId: "bob" }),
      drawn,
      "E_NOT_ACTIVE_PLAYER",
    );
    assertRejected(
      discardDrawn({ ...drawn, pauseReasons: ["bob"] }, { type: "discardDrawn", actorId: "alice" }),
      { ...drawn, pauseReasons: ["bob"] } as MatchState,
      "E_PAUSED",
      false,
    );
    assertRejected(
      discardDrawn(drawn, {
        type: "discardDrawn",
        actorId: "alice",
        expectedRevision: drawn.revision - 1,
      }),
      drawn,
      "E_STALE_REVISION",
    );

    assertRejected(callCambio(lobby, { type: "callCambio", actorId: "alice" }), lobby, "E_OUT_OF_PHASE");
    assertRejected(
      callCambio(base, { type: "callCambio", actorId: "bob" }),
      base,
      "E_NOT_ACTIVE_PLAYER",
    );
    assertRejected(
      callCambio({ ...base, pauseReasons: ["bob"] }, { type: "callCambio", actorId: "alice" }),
      { ...base, pauseReasons: ["bob"] } as MatchState,
      "E_PAUSED",
      false,
    );
    assertRejected(
      callCambio(base, {
        type: "callCambio",
        actorId: "alice",
        expectedRevision: base.revision - 1,
      }),
      base,
      "E_STALE_REVISION",
    );
    assertRejected(
      callCambio(drawn, { type: "callCambio", actorId: "alice" }),
      drawn,
      "E_CAMBIO_NOT_ALLOWED",
    );

    const immediateCambio = createTurnCycleMatch();
    const oneActive = withSeats(immediateCambio, [
      immediateCambio.seats[0]!,
      { ...immediateCambio.seats[1]!, connection: "removed", withdrawn: true },
    ]);
    const ended = accepted(callCambio(oneActive, { type: "callCambio", actorId: "alice" }));
    expect(ended.state.status).toBe("intermission");
    expect(round(ended.state).endReason).toBe("cambio");

    const actorOutsideSeats = withRound(createTurnCycleMatch(), {
      ...round(createTurnCycleMatch()),
      activePlayerId: "mallory",
    });
    const queuedAllSeats = accepted(
      callCambio(actorOutsideSeats, { type: "callCambio", actorId: "mallory" }),
    ).state;
    expect(round(queuedAllSeats).cambio?.finalTurnQueue).toEqual(["alice", "bob"]);

    const missingActive = withRound(createTurnCycleMatch(), {
      ...round(createTurnCycleMatch()),
      activePlayerId: "mallory",
    });
    expect(advanceAfterTurnResolution(missingActive).state.round?.activePlayerId).toBe("alice");
  });

  it("covers power rejection branches and target role validation", () => {
    const noPower = accepted(
      discardDrawn(
        accepted(drawCard(createTurnCycleMatch({ drawPile: ["hearts:5"] }), {
          type: "drawCard",
          actorId: "alice",
        })).state,
        { type: "discardDrawn", actorId: "alice" },
      ),
    ).state;
    assertRejected(skipPower(noPower, { type: "skipPower", actorId: "alice" }), noPower, "E_NO_PENDING_POWER");
    assertRejected(
      selectPowerTarget(noPower, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      noPower,
      "E_NO_PENDING_POWER",
    );

    const turnStart = createTurnCycleMatch();
    assertRejected(skipPower(turnStart, { type: "skipPower", actorId: "alice" }), turnStart, "E_OUT_OF_PHASE");

    let peekOwn = createPowerOfferedState("clubs:7");
    assertRejected(
      skipPower(peekOwn, {
        type: "skipPower",
        actorId: "alice",
        expectedRevision: peekOwn.revision - 1,
      }),
      peekOwn,
      "E_STALE_REVISION",
    );
    const pausedPeekOwn = { ...peekOwn, pauseReasons: ["bob"] };
    assertRejected(skipPower(pausedPeekOwn, { type: "skipPower", actorId: "alice" }), pausedPeekOwn, "E_PAUSED");
    assertRejected(
      selectPowerTarget(peekOwn, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
        expectedRevision: peekOwn.revision - 1,
      }),
      peekOwn,
      "E_STALE_REVISION",
    );
    assertRejected(skipPower(peekOwn, { type: "skipPower", actorId: "bob" }), peekOwn, "E_NOT_ACTIVE_PLAYER");
    assertRejected(
      selectPowerTarget(peekOwn, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
      peekOwn,
      "E_TARGET_INVALID",
    );
    assertRejected(
      selectPowerTarget(peekOwn, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "bottomRight"),
      }),
      peekOwn,
      "E_SLOT_NOT_OCCUPIED",
    );
    assertRejected(
      selectPowerTarget(peekOwn, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "unknown",
        slotId: "missing",
      }),
      peekOwn,
      "E_TARGET_INVALID",
    );
    peekOwn = accepted(
      selectPowerTarget(peekOwn, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    assertRejected(skipPower(peekOwn, { type: "skipPower", actorId: "alice" }), peekOwn, "E_POWER_STAGE_MISMATCH");
    assertRejected(
      selectPowerTarget(peekOwn, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topRight"),
      }),
      peekOwn,
      "E_POWER_STAGE_MISMATCH",
    );
    assertRejected(
      decideBlackKingSwap(peekOwn, {
        type: "decideBlackKingSwap",
        actorId: "alice",
        decision: "confirm",
      }),
      peekOwn,
      "E_POWER_STAGE_MISMATCH",
    );

    const peekOpponent = createPowerOfferedState("clubs:9");
    assertRejected(
      selectPowerTarget(peekOpponent, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      peekOpponent,
      "E_TARGET_INVALID",
    );
    assertRejected(
      acknowledgePowerReveal(peekOpponent, { type: "acknowledgePowerReveal", actorId: "alice" }),
      peekOpponent,
      "E_POWER_STAGE_MISMATCH",
    );
    assertRejected(
      acknowledgePowerReveal(peekOwn, {
        type: "acknowledgePowerReveal",
        actorId: "alice",
        expectedRevision: peekOwn.revision - 1,
      }),
      peekOwn,
      "E_STALE_REVISION",
    );
    assertRejected(
      acknowledgePowerReveal({ ...peekOwn, pauseReasons: ["bob"] }, {
        type: "acknowledgePowerReveal",
        actorId: "alice",
      }),
      { ...peekOwn, pauseReasons: ["bob"] } as MatchState,
      "E_PAUSED",
      false,
    );

    const invalidSelection = withRound(peekOwn, {
      ...round(peekOwn),
      pendingPower: {
        ...round(peekOwn).pendingPower!,
        stage: "selectingFirst",
        selections: [{ playerId: "alice", slotId: slot("alice", "topLeft"), cardId: "clubs:A" }],
      },
      slotsByPlayer: {
        ...round(peekOwn).slotsByPlayer,
        alice: replaceCard(round(peekOwn).slotsByPlayer.alice!, slot("alice", "topLeft"), null),
      },
      outOfPlay: [...round(peekOwn).outOfPlay, "clubs:A"],
    });
    assertRejected(
      selectPowerTarget(invalidSelection, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topRight"),
      }),
      invalidSelection,
      "E_TARGET_INVALID",
    );

    const unknownKind = withRound(createPowerOfferedState("clubs:7"), {
      ...round(createPowerOfferedState("clubs:7")),
      pendingPower: {
        ...round(createPowerOfferedState("clubs:7")).pendingPower!,
        kind: "unknown" as never,
      },
    });
    assertRejected(
      selectPowerTarget(unknownKind, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      unknownKind,
      "E_POWER_STAGE_MISMATCH",
    );

    const blindSwapAwaitingReveal = withRound(createPowerOfferedState("clubs:J"), {
      ...round(createPowerOfferedState("clubs:J")),
      pendingPower: {
        ...round(createPowerOfferedState("clubs:J")).pendingPower!,
        stage: "awaitingRevealAck",
      },
    });
    assertRejected(
      acknowledgePowerReveal(blindSwapAwaitingReveal, {
        type: "acknowledgePowerReveal",
        actorId: "alice",
      }),
      blindSwapAwaitingReveal,
      "E_POWER_STAGE_MISMATCH",
    );
  });

  it("covers black king second-selection and invalidation branches", () => {
    let state = createPowerOfferedState("clubs:K");
    assertRejected(
      decideBlackKingSwap(state, {
        type: "decideBlackKingSwap",
        actorId: "alice",
        decision: "confirm",
        expectedRevision: state.revision - 1,
      }),
      state,
      "E_STALE_REVISION",
    );
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    state = accepted(acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" })).state;
    assertRejected(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topRight"),
      }),
      state,
      "E_TARGET_INVALID",
    );
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    ).state;
    state = accepted(acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" })).state;
    assertRejected(
      acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" }),
      state,
      "E_POWER_STAGE_MISMATCH",
    );

    const invalidOwn = withRound(state, {
      ...round(state),
      slotsByPlayer: {
        ...round(state).slotsByPlayer,
        alice: replaceCard(round(state).slotsByPlayer.alice!, slot("alice", "topLeft"), null),
      },
      outOfPlay: [...round(state).outOfPlay, "clubs:A"],
    });
    assertRejected(
      reselectPowerTarget(invalidOwn, {
        type: "reselectPowerTarget",
        actorId: "bob",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      invalidOwn,
      "E_NOT_ACTIVE_PLAYER",
    );
    assertRejected(
      reselectPowerTarget(invalidOwn, {
        type: "reselectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
        expectedRevision: invalidOwn.revision - 1,
      }),
      invalidOwn,
      "E_STALE_REVISION",
    );
    const reselectedOwn = accepted(
      reselectPowerTarget(invalidOwn, {
        type: "reselectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    expect(round(reselectedOwn).pendingPower).toMatchObject({ stage: "selectingFirst", selections: [] });

    state = createPowerOfferedState("clubs:K");
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    state = accepted(acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" })).state;
    state = accepted(
      selectPowerTarget(state, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    ).state;
    state = accepted(acknowledgePowerReveal(state, { type: "acknowledgePowerReveal", actorId: "alice" })).state;
    const invalidOpponent = withRound(state, {
      ...round(state),
      slotsByPlayer: {
        ...round(state).slotsByPlayer,
        bob: replaceCard(round(state).slotsByPlayer.bob!, slot("bob", "topLeft"), null),
      },
      outOfPlay: [...round(state).outOfPlay, "hearts:A"],
    });
    const reselectedOpponent = accepted(
      reselectPowerTarget(invalidOpponent, {
        type: "reselectPowerTarget",
        actorId: "alice",
        targetPlayerId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
    ).state;
    expect(round(reselectedOpponent).pendingPower).toMatchObject({ stage: "selectingSecond" });

    assertRejected(
      reselectPowerTarget(reselectedOpponent, {
        type: "reselectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      reselectedOpponent,
      "E_TARGET_INVALID",
    );

    let samePlayerSwap = createPowerOfferedState("clubs:J");
    samePlayerSwap = accepted(
      selectPowerTarget(samePlayerSwap, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    samePlayerSwap = accepted(
      selectPowerTarget(samePlayerSwap, {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topRight"),
      }),
    ).state;
    expect(cardAt(samePlayerSwap, "alice", slot("alice", "topLeft"))).toBe("clubs:2");
    expect(cardAt(samePlayerSwap, "alice", slot("alice", "topRight"))).toBe("clubs:A");

    const invalidBlackKingSwap = withRound(state, {
      ...round(state),
      pendingPower: {
        ...round(state).pendingPower!,
        selections: [
          { playerId: "alice", slotId: slot("alice", "topLeft"), cardId: "clubs:3" },
          { playerId: "bob", slotId: slot("bob", "topLeft"), cardId: "hearts:A" },
        ],
      },
    });
    assertRejected(
      decideBlackKingSwap(invalidBlackKingSwap, {
        type: "decideBlackKingSwap",
        actorId: "alice",
        decision: "confirm",
      }),
      invalidBlackKingSwap,
      "E_TARGET_INVALID",
    );
  });

  it("covers snap and transfer rejection branches", () => {
    let state = accepted(
      discardDrawn(
        accepted(drawCard(createTurnCycleMatch({ drawPile: ["hearts:5", "hearts:6"] }), {
          type: "drawCard",
          actorId: "alice",
        })).state,
        { type: "discardDrawn", actorId: "alice" },
      ),
    ).state;
    state = withRound(state, {
      ...round(state),
      slotsByPlayer: {
        ...round(state).slotsByPlayer,
        bob: replaceCard(round(state).slotsByPlayer.bob!, slot("bob", "bottomRight"), null),
      },
      outOfPlay: [...round(state).outOfPlay, "clubs:8"],
    });
    const window = round(state).snapWindow!;
    assertRejected(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
        expectedRevision: state.revision - 1,
      }),
      state,
      "E_STALE_REVISION",
    );
    const pausedSnap = { ...state, pauseReasons: ["bob"] };
    assertRejected(
      attemptSnap(pausedSnap, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      pausedSnap,
      "E_PAUSED",
    );
    const wrongPhaseSnap = withRound(state, { ...round(state), phase: "scoring" });
    assertRejected(
      attemptSnap(wrongPhaseSnap, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      wrongPhaseSnap,
      "E_STALE_SNAP_WINDOW",
    );
    assertRejected(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "mallory",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      state,
      "E_UNAUTHORIZED",
    );
    const removedBob = withSeats(state, [
      state.seats[0]!,
      { ...state.seats[1]!, connection: "removed", withdrawn: true },
    ]);
    assertRejected(
      attemptSnap(removedBob, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      removedBob,
      "E_UNAUTHORIZED",
    );
    assertRejected(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: "other-window",
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      state,
      "E_STALE_SNAP_WINDOW",
    );
    const resolvedWindow = withRound(state, {
      ...round(state),
      snapWindow: { ...window, resolvedBy: "alice" },
    });
    assertRejected(
      attemptSnap(resolvedWindow, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
      resolvedWindow,
      "E_SNAP_ALREADY_RESOLVED",
    );
    assertRejected(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "bob",
        slotId: slot("bob", "bottomRight"),
      }),
      state,
      "E_SLOT_NOT_OCCUPIED",
    );

    const noOp = accepted(
      expireSnapWindow(state, {
        type: "expireSnapWindow",
        windowId: window.windowId,
        generation: window.generation + 1,
      }),
    );
    expect(noOp.state).toBe(state);
    const wrongPhase = withRound(state, { ...round(state), phase: "scoring" });
    expect(
      accepted(
        expireSnapWindow(wrongPhase, {
          type: "expireSnapWindow",
          windowId: window.windowId,
          generation: window.generation,
        }),
      ).state,
    ).toBe(wrongPhase);

    assertRejected(
      chooseTransferTarget(state, { type: "chooseTransferTarget", actorId: "bob", slotId: slot("bob", "topLeft") }),
      state,
      "E_NO_PENDING_TRANSFER",
    );

    state = createPendingTransferState();
    assertRejected(
      chooseTransferTarget(state, {
        type: "chooseTransferTarget",
        actorId: "bob",
        slotId: slot("bob", "topLeft"),
        expectedRevision: state.revision - 1,
      }),
      state,
      "E_STALE_REVISION",
    );
    assertRejected(
      chooseTransferTarget(state, { type: "chooseTransferTarget", actorId: "alice", slotId: slot("alice", "topLeft") }),
      state,
      "E_TARGET_INVALID",
    );
    assertRejected(
      chooseTransferTarget(state, { type: "chooseTransferTarget", actorId: "bob", slotId: slot("bob", "bottomRight") }),
      state,
      "E_SLOT_NOT_OCCUPIED",
    );
    assertRejected(
      chooseTransferTarget(state, { type: "chooseTransferTarget", actorId: "bob", slotId: "missing" }),
      state,
      "E_TARGET_INVALID",
    );
    const missingSourceSlots = withRound(state, {
      ...round(state),
      slotsByPlayer: { alice: round(state).slotsByPlayer.alice! },
    });
    assertRejected(
      chooseTransferTarget(missingSourceSlots, {
        type: "chooseTransferTarget",
        actorId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
      missingSourceSlots,
      "E_TARGET_INVALID",
    );
    assertRejected(
      chooseTransferTarget({ ...state, pauseReasons: ["alice"] }, {
        type: "chooseTransferTarget",
        actorId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
      { ...state, pauseReasons: ["alice"] } as MatchState,
      "E_PAUSED",
      false,
    );
    const occupiedTransferTarget = withRound(state, {
      ...round(state),
      slotsByPlayer: {
        ...round(state).slotsByPlayer,
        alice: replaceCard(round(state).slotsByPlayer.alice!, slot("alice", "topLeft"), "clubs:Q"),
      },
      outOfPlay: round(state).outOfPlay.filter((cardId) => cardId !== "clubs:Q"),
    });
    assertRejected(
      chooseTransferTarget(occupiedTransferTarget, {
        type: "chooseTransferTarget",
        actorId: "bob",
        slotId: slot("bob", "topLeft"),
      }),
      occupiedTransferTarget,
      "E_TARGET_INVALID",
    );
  });

  it("places unlimited wrong-snap penalties into holes before appending penalty slots", () => {
    let state = accepted(
      discardDrawn(
        accepted(
          drawCard(
            createTurnCycleMatch({
              grids: [
                grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
                grid("bob", [null, "clubs:6", "clubs:7", "clubs:8"]),
              ],
              drawPile: ["hearts:5", "hearts:6", "hearts:7"],
            }),
            { type: "drawCard", actorId: "alice" },
          ),
        ).state,
        { type: "discardDrawn", actorId: "alice" },
      ),
    ).state;
    const window = round(state).snapWindow!;
    state = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    expect(cardAt(state, "bob", slot("bob", "topLeft"))).toBe("hearts:6");
    state = accepted(
      attemptSnap(state, {
        type: "attemptSnap",
        actorId: "bob",
        windowId: window.windowId,
        generation: window.generation,
        targetPlayerId: "alice",
        slotId: slot("alice", "topRight"),
      }),
    ).state;
    expect(cardBySlotId(state, "bob", "slot:bob:penalty:1")).toBe("hearts:7");
    expect(round(state).snapWindow?.attempts).toHaveLength(2);
  });

  it("covers ready and power-reselection edge paths", () => {
    let scoring = accepted(
      drawCard(
        createTurnCycleMatch({
          drawPile: [],
          discardPile: [],
          grids: [
            grid("alice", ["clubs:A", null, null, null]),
            grid("bob", ["clubs:2", null, null, null]),
          ],
        }),
        { type: "drawCard", actorId: "alice" },
      ),
    ).state;
    const removedSeatScoring = withSeats(scoring, [
      scoring.seats[0]!,
      { ...scoring.seats[1]!, connection: "removed", withdrawn: true },
    ]);
    assertRejected(
      readyForNextRound(removedSeatScoring, {
        type: "readyForNextRound",
        actorId: "bob",
      }),
      removedSeatScoring,
      "E_OUT_OF_PHASE",
    );
    scoring = accepted(readyForNextRound(scoring, { type: "readyForNextRound", actorId: "alice" })).state;
    expect(accepted(readyForNextRound(scoring, { type: "readyForNextRound", actorId: "alice" })).state).toBe(
      scoring,
    );

    const peekOwn = accepted(
      selectPowerTarget(createPowerOfferedState("clubs:7"), {
        type: "selectPowerTarget",
        actorId: "alice",
        targetPlayerId: "alice",
        slotId: slot("alice", "topLeft"),
      }),
    ).state;
    const peekOwnInvalidWithTarget = invalidateSlots(peekOwn, "alice", [slot("alice", "topLeft")]);
    expect(
      round(
        accepted(reselectPowerTarget(peekOwnInvalidWithTarget, { type: "reselectPowerTarget", actorId: "alice" }))
          .state,
      ).pendingPower,
    ).toMatchObject({ kind: "peekOwn", stage: "selectingFirst" });

    const peekOwnInvalidWithoutTarget = invalidateSlots(peekOwn, "alice", [
      slot("alice", "topLeft"),
      slot("alice", "topRight"),
      slot("alice", "bottomLeft"),
    ]);
    const autoSkipped = accepted(
      reselectPowerTarget(peekOwnInvalidWithoutTarget, {
        type: "reselectPowerTarget",
        actorId: "alice",
      }),
    );
    expect(round(autoSkipped.state).pendingPower).toBeNull();
    expect(autoSkipped.events.map((event) => event.type)).toContain("powerSkipped");

    const blindSwap = withRound(createPowerOfferedState("clubs:J"), {
      ...round(createPowerOfferedState("clubs:J")),
      pendingPower: {
        ...round(createPowerOfferedState("clubs:J")).pendingPower!,
        stage: "selectingSecond",
        selections: [
          { playerId: "alice", slotId: slot("alice", "topLeft"), cardId: "clubs:A" },
          { playerId: "bob", slotId: slot("bob", "topLeft"), cardId: "hearts:A" },
        ],
      },
    });
    const blindSwapInvalid = invalidateSlots(blindSwap, "bob", [slot("bob", "topLeft")]);
    expect(
      round(accepted(reselectPowerTarget(blindSwapInvalid, { type: "reselectPowerTarget", actorId: "alice" })).state)
        .pendingPower,
    ).toMatchObject({ kind: "blindSwap", stage: "selectingSecond" });

    const blackKing = withRound(createPowerOfferedState("clubs:K"), {
      ...round(createPowerOfferedState("clubs:K")),
      pendingPower: {
        ...round(createPowerOfferedState("clubs:K")).pendingPower!,
        stage: "awaitingKingDecision",
        selections: [
          { playerId: "alice", slotId: slot("alice", "topLeft"), cardId: "clubs:A" },
          { playerId: "bob", slotId: slot("bob", "topLeft"), cardId: "hearts:A" },
          { playerId: "carol", slotId: slot("carol", "topLeft"), cardId: "diamonds:A" },
        ],
      },
    });
    const blackKingInvalid = invalidateSlots(blackKing, "carol", [slot("carol", "topLeft")]);
    expect(
      round(accepted(reselectPowerTarget(blackKingInvalid, { type: "reselectPowerTarget", actorId: "alice" })).state)
        .pendingPower,
    ).toMatchObject({ kind: "blackKing", stage: "awaitingKingDecision" });
  });

  it("covers remove-player branches for lobby, host migration, opening peeks, owned powers, and final queues", () => {
    const lobby = createLobbyWithPlayers(["alice", "bob", "carol"]);
    const lobbyRemoved = accepted(removePlayer(lobby, "bob")).state;
    expect(lobbyRemoved.round).toBeNull();
    expect(lobbyRemoved.status).toBe("lobby");
    expect(accepted(removePlayer(lobby, "alice")).state.hostPlayerId).toBe("bob");
    assertRejected(removePlayer(lobbyRemoved, "bob"), lobbyRemoved, "E_ALREADY_REMOVED");

    let opening = accepted(startMatch(lobby, { type: "startMatch", actorId: "alice" })).state;
    opening = accepted(acknowledgeOpeningPeek(opening, { type: "acknowledgeOpeningPeek", actorId: "alice" })).state;
    opening = accepted(acknowledgeOpeningPeek(opening, { type: "acknowledgeOpeningPeek", actorId: "bob" })).state;
    const completedByRemoval = accepted(removePlayer(opening, "carol")).state;
    expect(round(completedByRemoval).phase).toBe("turnCycle");

    const powerOwner = createPowerOfferedState("clubs:7");
    const ownerRemoved = accepted(removePlayer(powerOwner, "alice"));
    expect(ownerRemoved.events).toContainEqual({
      type: "powerSkipped",
      ownerId: "alice",
      kind: "peekOwn",
      reason: "ownerRemoved",
    });

    let finalQueue = createTurnCycleMatch({
      playerIds: ["alice", "bob", "carol"],
      activePlayerId: "bob",
      grids: [
        grid("alice", ["clubs:A", null, null, null]),
        grid("bob", ["clubs:2", null, null, null]),
        grid("carol", ["clubs:3", null, null, null]),
      ],
    });
    finalQueue = withRound(finalQueue, {
      ...round(finalQueue),
      cambio: { callerId: "alice", finalTurnQueue: ["bob"], completedFinalTurns: [] },
    });
    const ended = accepted(removePlayer(finalQueue, "bob"));
    expect(ended.state.status).toBe("intermission");
    expect(round(ended.state).endReason).toBe("cambio");

    const targetInvalidated = accepted(removePlayer(createBlindSwapSelectedState(), "bob"));
    expect(targetInvalidated.events.map((event) => event.type)).toContain("powerTargetInvalidated");

    let cambio = accepted(
      callCambio(
        createTurnCycleMatch({ playerIds: ["alice", "bob", "carol"], activePlayerId: "alice" }),
        { type: "callCambio", actorId: "alice" },
      ),
    ).state;
    expect(round(cambio).activePlayerId).toBe("bob");
    cambio = accepted(removePlayer(cambio, "bob")).state;
    expect(round(cambio).activePlayerId).toBe("carol");
  });

  it("covers exported resolution helper defensive branches", () => {
    const noRound = createLobbyMatchForTesting();
    expect(() => advanceAfterTurnResolution(noRound)).toThrow(
      "turn resolution requires an active round",
    );

    const noActive = withRound(createTurnCycleMatch(), {
      ...round(createTurnCycleMatch()),
      activePlayerId: null,
      turnStage: null,
    });
    expect(advanceAfterTurnResolution(noActive)).toEqual({ state: noActive, events: [] });

    const paused = { ...createTurnCycleMatch(), pauseReasons: ["alice"] };
    expect(advanceAfterTurnResolution(paused).state.round?.turnStage).toBe("resolving");

    const badQueue = withRound(createTurnCycleMatch(), {
      ...round(createTurnCycleMatch()),
      cambio: { callerId: "bob", finalTurnQueue: ["bob"], completedFinalTurns: [] },
    });
    expect(() => advanceAfterTurnResolution(badQueue)).toThrow(
      "completed final turn does not match the active queue entry",
    );

    const noSeats = withSeats(createTurnCycleMatch(), [
      { ...createTurnCycleMatch().seats[0]!, connection: "removed", withdrawn: true },
      { ...createTurnCycleMatch().seats[1]!, connection: "removed", withdrawn: true },
    ]);
    expect(() => advanceAfterTurnResolution(noSeats)).toThrow("next seat requires at least one active seat");
  });
});

function createLobbyWithPlayers(playerIds: readonly PlayerId[]): MatchState {
  let state = createLobbyMatchForTesting({
    seed: 7,
    host: { playerId: playerIds[0]!, displayName: playerIds[0]! },
    config: { playerCap: Math.max(2, playerIds.length) },
  });
  for (const playerId of playerIds.slice(1)) {
    state = addLobbySeatForTesting(state, { playerId, displayName: playerId });
  }

  return state;
}

function createPowerOfferedState(cardId: CardId): MatchState {
  return accepted(
    discardDrawn(
      accepted(
        drawCard(
          createTurnCycleMatch({
            playerIds: ["alice", "bob", "carol"],
            grids: [
              grid("alice", ["clubs:A", "clubs:2", "clubs:3", null]),
              grid("bob", ["hearts:A", "hearts:2", "hearts:3", null]),
              grid("carol", ["diamonds:A", "diamonds:2", "diamonds:3", null]),
            ],
            drawPile: [cardId],
          }),
          { type: "drawCard", actorId: "alice" },
        ),
      ).state,
      { type: "discardDrawn", actorId: "alice" },
    ),
  ).state;
}

function createPendingTransferState(): MatchState {
  let state = accepted(
    discardDrawn(
      accepted(
        drawCard(
          createTurnCycleMatch({
            grids: [
              grid("alice", ["clubs:5", "clubs:2", "clubs:3", "clubs:4"]),
              grid("bob", ["clubs:6", "clubs:7", "clubs:8", null]),
            ],
            drawPile: ["hearts:5"],
          }),
          { type: "drawCard", actorId: "alice" },
        ),
      ).state,
      { type: "discardDrawn", actorId: "alice" },
    ),
  ).state;
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
  return state;
}

function createBlindSwapSelectedState(): MatchState {
  const state = createPowerOfferedState("clubs:J");
  return accepted(
    selectPowerTarget(state, {
      type: "selectPowerTarget",
      actorId: "alice",
      targetPlayerId: "bob",
      slotId: slot("bob", "topLeft"),
    }),
  ).state;
}

function withRound(state: MatchState, nextRound: RoundState): MatchState {
  return { ...state, round: nextRound };
}

function withSeats(state: MatchState, seats: readonly MatchState["seats"][number][]): MatchState {
  return { ...state, seats };
}

function replaceCard(
  slots: readonly RoundState["slotsByPlayer"][string][number][],
  slotId: SlotId,
  cardId: CardId | null,
): readonly RoundState["slotsByPlayer"][string][number][] {
  return slots.map((candidate) => (candidate.slotId === slotId ? { ...candidate, cardId } : candidate));
}

function invalidateSlots(state: MatchState, playerId: PlayerId, slotIds: readonly SlotId[]): MatchState {
  const removedCardIds = (round(state).slotsByPlayer[playerId] ?? []).flatMap((candidate) =>
    slotIds.includes(candidate.slotId) && candidate.cardId !== null ? [candidate.cardId] : [],
  );
  return withRound(state, {
    ...round(state),
    slotsByPlayer: {
      ...round(state).slotsByPlayer,
      [playerId]: (round(state).slotsByPlayer[playerId] ?? []).map((candidate) =>
        slotIds.includes(candidate.slotId) ? { ...candidate, cardId: null } : candidate,
      ),
    },
    outOfPlay: [...round(state).outOfPlay, ...removedCardIds],
  });
}

function cardAt(state: MatchState, playerId: PlayerId, slotId: SlotId): CardId | null {
  const found = round(state).slotsByPlayer[playerId]?.find((candidate) => candidate.slotId === slotId);
  if (found === undefined) {
    throw new Error("missing slot");
  }

  return found.cardId;
}

function cardBySlotId(state: MatchState, playerId: PlayerId, slotId: SlotId): CardId | null {
  return cardAt(state, playerId, slotId);
}
