import {
  OPENING_PEEK_POSITIONS,
  createDeck,
  reduceCommand,
  startingSlotId,
  type Card,
  type CardId,
  type CardSlot,
  type DomainEvent,
  type EngineCommand,
  type MatchState,
  type PlayerId,
  type RoundState,
  type SlotId,
  type StartingSlotPosition,
  type TransitionResult,
} from "@cambio/engine";
import {
  StateSnapshotViewSchema,
  type ActionLogEntry,
  type CardView,
  type CommandType,
  type LegalAction,
  type PublicMovementView,
  type SlotTarget,
  type SlotView,
  type StateSnapshotView,
} from "@cambio/protocol";

export const LEARNER_ID = "learner";
export const COACH_ID = "coach";
export const RIVAL_ID = "rival";
export const TUTORIAL_ROOM_ID = "tutorial-room";

export interface TutorialPlayers {
  readonly learnerId: PlayerId;
  readonly coachId: PlayerId;
  readonly rivalId?: PlayerId;
}

export interface ScriptedRoundOptions {
  readonly seed?: number;
  readonly roundCount?: number;
  readonly players?: TutorialPlayers;
  readonly activePlayerId?: PlayerId | null;
  readonly dealerId?: PlayerId;
  readonly phase?: RoundState["phase"];
  readonly turnStage?: RoundState["turnStage"];
  readonly learnerCards?: readonly CardId[];
  readonly coachCards?: readonly CardId[];
  readonly rivalCards?: readonly CardId[];
  readonly drawPile?: readonly CardId[];
  readonly fillDrawPile?: boolean;
  readonly discardPile?: readonly CardId[];
  readonly cambio?: RoundState["cambio"];
}

export interface TutorialProjectionOptions {
  readonly actionLog?: readonly ActionLogEntry[];
}

export interface TutorialCommandRejected extends Error {
  readonly code: string;
}

export function createScriptedMatch(options: ScriptedRoundOptions = {}): MatchState {
  const players: Required<TutorialPlayers> = {
    learnerId: options.players?.learnerId ?? LEARNER_ID,
    coachId: options.players?.coachId ?? COACH_ID,
    rivalId: options.players?.rivalId ?? RIVAL_ID,
  };
  const roundCount = options.roundCount ?? 1;
  let state = mustAccept(
    reduceCommand(null, {
      type: "createMatch",
      roomId: TUTORIAL_ROOM_ID,
      host: { playerId: players.learnerId, displayName: "You" },
      seed: options.seed ?? 101,
      config: { roundCount, snapWindowMs: 5_000, playerCap: 3 },
    }),
  ).state;
  state = mustAccept(
    reduceCommand(state, {
      type: "joinRoom",
      seat: { playerId: players.coachId, displayName: "Coach" },
    }),
  ).state;

  if (options.rivalCards !== undefined) {
    state = mustAccept(
      reduceCommand(state, {
        type: "joinRoom",
        seat: { playerId: players.rivalId, displayName: "Rival" },
      }),
    ).state;
  }

  state = mustAccept(reduceCommand(state, { type: "startMatch", actorId: players.learnerId })).state;
  const round = state.round;
  if (round === null) {
    throw new Error("scripted match did not create a round");
  }

  const learnerCards = options.learnerCards ?? ["clubs:2", "diamonds:3", "hearts:4", "spades:5"];
  const coachCards = options.coachCards ?? ["clubs:6", "diamonds:7", "hearts:8", "spades:9"];
  const slotsByPlayer: Record<PlayerId, readonly CardSlot[]> = {
    ...round.slotsByPlayer,
    [players.learnerId]: makeStartingSlots(players.learnerId, learnerCards),
    [players.coachId]: makeStartingSlots(players.coachId, coachCards),
  };
  const usedCards = new Set<CardId>([...learnerCards, ...coachCards, ...(options.drawPile ?? []), ...(options.discardPile ?? [])]);

  if (options.rivalCards !== undefined) {
    slotsByPlayer[players.rivalId] = makeStartingSlots(players.rivalId, options.rivalCards);
    for (const cardId of options.rivalCards) {
      usedCards.add(cardId);
    }
  }

  const remainingCards = createDeck().order.filter((cardId) => !usedCards.has(cardId));
  const fillerDrawPile = options.fillDrawPile === false ? [] : remainingCards;
  const drawPile = [...(options.drawPile ?? []), ...fillerDrawPile];
  const outOfPlay = options.fillDrawPile === false ? remainingCards : [];
  const acknowledged = options.phase === "openingPeek" ? false : true;
  const seats = state.seats.map((seat) => ({
    ...seat,
    openingPeekAcknowledged: acknowledged,
    readyForNextRound: false,
  }));
  const dealerId = options.dealerId ?? players.coachId;

  return {
    ...state,
    seats,
    revision: state.revision + 1,
    round: {
      ...round,
      phase: options.phase ?? "turnCycle",
      turnStage: options.turnStage ?? "turnStart",
      dealerId,
      activePlayerId: options.activePlayerId ?? players.learnerId,
      cards: createDeck().cards,
      drawPile,
      discardPile: options.discardPile ?? [],
      slotsByPlayer,
      outOfPlay,
      drawnCard: null,
      pendingPower: null,
      snapWindow: null,
      pendingTransfer: null,
      cambio: options.cambio ?? null,
      endReason: null,
    },
  };
}

export function projectTutorialSnapshot(
  state: MatchState,
  viewerSeatId: PlayerId = LEARNER_ID,
  options: TutorialProjectionOptions = {},
): StateSnapshotView {
  const round = state.round;
  const entitledSlots = viewerEntitledSlots(state, viewerSeatId);
  const discardTopId = round?.discardPile[0];
  const latestRoundScores = latestRoundEnded(options.actionLog ?? []);
  const snapshot: StateSnapshotView = {
    room: {
      roomId: state.roomId,
      config: state.config,
      status: state.status,
      hostPlayerId: state.hostPlayerId,
    },
    seats: orderedSeats(state).map((seat) => ({
      playerId: seat.playerId,
      displayName: seat.displayName,
      seatIndex: seat.seatIndex,
      joinOrder: seat.joinOrder,
      connection: seat.connection,
      sessionGeneration: seat.sessionGeneration,
      isHost: seat.playerId === state.hostPlayerId,
      openingPeekAcknowledged: seat.openingPeekAcknowledged,
      readyForNextRound: seat.readyForNextRound,
      removalEligible: seat.removalEligible,
    })),
    viewerSeatId,
    round: {
      roundNumber: round?.roundNumber ?? null,
      phase: round?.phase ?? null,
      turnStage: round?.turnStage ?? null,
      dealerId: round?.dealerId ?? null,
      activePlayerId: round?.activePlayerId ?? null,
      endReason: round?.endReason ?? null,
      cambio:
        round?.cambio === null || round?.cambio === undefined
          ? null
          : {
              callerId: round.cambio.callerId,
              finalTurnQueue: [...round.cambio.finalTurnQueue],
              completedFinalTurns: [...round.cambio.completedFinalTurns],
            },
    },
    piles: {
      drawPileCount: round?.drawPile.length ?? 0,
      discardPileCount: round?.discardPile.length ?? 0,
      outOfPlayCount: round?.outOfPlay.length ?? 0,
      discardTop: round === null || discardTopId === undefined ? null : cardView(round.cards[discardTopId]!),
    },
    drawnCard: projectDrawnCard(state, viewerSeatId),
    grids:
      round === null
        ? []
        : orderedSeats(state).map((seat) => ({
            playerId: seat.playerId,
            slots: (round.slotsByPlayer[seat.playerId] ?? []).map((slot) =>
              projectSlot(state, viewerSeatId, seat.playerId, slot, entitledSlots),
            ),
          })),
    snapWindow:
      round?.snapWindow === null || round?.snapWindow === undefined
        ? null
        : {
            windowId: round.snapWindow.windowId,
            generation: round.snapWindow.generation,
            remainingMs: round.snapWindow.remainingMs,
            durationMs: round.snapWindow.durationMs,
            resolvedBy: round.snapWindow.resolvedBy,
          },
    pendingPower:
      round?.pendingPower === null || round?.pendingPower === undefined
        ? null
        : {
            ownerId: round.pendingPower.ownerId,
            kind: round.pendingPower.kind,
            stage: round.pendingPower.stage,
            selections: round.pendingPower.selections.map(publicTarget),
          },
    pendingTransfer:
      round?.pendingTransfer === null || round?.pendingTransfer === undefined
        ? null
        : {
            fromPlayerId: round.pendingTransfer.fromPlayerId,
            toPlayerId: round.pendingTransfer.toPlayerId,
            targetSlotId: round.pendingTransfer.targetSlotId,
          },
    pauseReasons: [...state.pauseReasons],
    scores: orderedSeats(state).map((seat) => {
      const lastRound = latestRoundScores?.scores.find((score) => score.playerId === seat.playerId);
      return {
        playerId: seat.playerId,
        cumulativeScore: state.cumulativeScores[seat.playerId] ?? 0,
        ...(lastRound === undefined
          ? {}
          : {
              lastRoundRawScore: lastRound.rawScore,
              lastRoundMatchPoints: lastRound.matchPoints,
              isRoundWinner: lastRound.isRoundWinner,
            }),
      };
    }),
    publicMovements: [],
    actionLog: [...(options.actionLog ?? [])],
    legalActions: legalActionsForViewer(state, viewerSeatId),
  };

  return StateSnapshotViewSchema.parse(snapshot);
}

export function applyEngineCommands(
  state: MatchState,
  commands: readonly EngineCommand[],
): { readonly state: MatchState; readonly events: readonly DomainEvent[] } {
  let current = state;
  const events: DomainEvent[] = [];
  for (const command of commands) {
    const withRevision = addExpectedRevision(current, command);
    const result = reduceCommand(current, withRevision);
    if (!result.ok) {
      const error = new Error(`Tutorial command ${command.type} rejected with ${result.code}`) as TutorialCommandRejected;
      Object.defineProperty(error, "code", { value: result.code });
      throw error;
    }
    current = result.state;
    events.push(...result.events);
  }

  return { state: current, events };
}

export function protocolCommandToEngine(
  state: MatchState,
  actorId: PlayerId,
  type: CommandType,
  payload: unknown,
): EngineCommand | null {
  switch (type) {
    case "acknowledgeOpeningPeek":
    case "readyForNextRound":
    case "callCambio":
    case "drawCard":
    case "discardDrawn":
    case "skipPower":
    case "acknowledgePowerReveal":
      return { type, actorId, expectedRevision: state.revision };
    case "replaceSlot":
      return { type, actorId, slotId: payloadSlotId(payload), expectedRevision: state.revision };
    case "selectPowerTarget":
      return { type, actorId, ...payloadTarget(payload), expectedRevision: state.revision };
    case "reselectPowerTarget":
      return { type, actorId, ...payloadOptionalTarget(payload), expectedRevision: state.revision };
    case "decideBlackKingSwap":
      return { type, actorId, decision: payloadDecision(payload), expectedRevision: state.revision };
    case "attemptSnap": {
      const snap = payloadSnap(payload);
      return {
        type,
        actorId,
        windowId: snap.snapWindowId,
        generation: snap.generation,
        targetPlayerId: snap.targetPlayerId,
        slotId: snap.slotId,
      };
    }
    case "chooseTransferTarget":
      return { type, actorId, slotId: payloadSlotId(payload), expectedRevision: state.revision };
    case "hostRemovePlayer":
      return { type: "removePlayer", actorId, targetPlayerId: payloadTargetPlayerId(payload), expectedRevision: state.revision };
    case "hostEndMatch":
      return { type, actorId, expectedRevision: state.revision };
    case "createRoom":
    case "joinRoom":
    case "updateRoomConfig":
    case "startMatch":
    case "resumeSession":
    case "leaveRoom":
      return null;
  }
}

export function toActionLogEntries(events: readonly DomainEvent[]): readonly ActionLogEntry[] {
  return events.flatMap((event): ActionLogEntry[] => {
    switch (event.type) {
      case "roundDealt":
      case "openingPeekAcknowledged":
      case "turnStarted":
      case "cardDrawn":
      case "reshuffled":
      case "slotReplaced":
      case "cardDiscarded":
      case "cambioCalled":
      case "turnAdvanced":
      case "roundEnded":
      case "readyForNextRound":
      case "matchCompleted":
      case "snapWindowOpened":
      case "snapWindowClosed":
      case "powerOffered":
      case "powerSkipped":
      case "powerTargetSelected":
      case "powerRevealAcknowledged":
      case "blackKingSwapDecided":
      case "powerTargetInvalidated":
      case "snapAttempted":
      case "penaltyCardDrawn":
      case "transferCompleted":
      case "playerRemoved":
      case "matchAbandoned":
        return [sanitizeActionLogEntry(event)];
      case "powerRevealed":
        return [
          {
            type: "powerRevealed",
            ownerId: event.ownerId,
            recipientId: event.recipientId,
            cardCount: event.cardIds.length,
          },
        ];
      case "snapTransientReveal":
        return [];
    }
  });
}

export function toPublicMovements(events: readonly DomainEvent[]): readonly PublicMovementView[] {
  return events.flatMap((event): PublicMovementView[] => {
    if (event.type === "blackKingSwapDecided" && event.swapped) {
      return [{ type: "blackKingSwap", actorId: event.ownerId, targets: [...event.targets] }];
    }
    if (event.type === "snapAttempted" && event.correct) {
      return [{ type: "snapRemoval", actorId: event.playerId, targets: [event.target] }];
    }
    if (event.type === "transferCompleted") {
      return [
        {
          type: "transfer",
          actorId: event.fromPlayerId,
          targets: [
            { playerId: event.fromPlayerId, slotId: event.fromSlotId },
            { playerId: event.toPlayerId, slotId: event.toSlotId },
          ],
        },
      ];
    }
    if (event.type === "playerRemoved") {
      return [{ type: "playerRemoval", actorId: event.playerId, targets: [] }];
    }
    return [];
  });
}

export function transientRevealTargets(
  state: MatchState,
  events: readonly DomainEvent[],
): readonly (SlotTarget & { readonly card: CardView })[] {
  const round = state.round;
  if (round === null) {
    return [];
  }

  return events.flatMap((event) => {
    if (event.type !== "snapTransientReveal") {
      return [];
    }
    return [
      {
        playerId: event.target.playerId,
        slotId: event.target.slotId,
        card: cardView(round.cards[event.cardId]!),
      },
    ];
  });
}

export function cardView(card: Card): CardView {
  if (card.rank === "JOKER") {
    return { rank: "JOKER", suit: null };
  }
  if (card.suit === null) {
    throw new Error("non-joker card is missing a suit");
  }
  return { rank: card.rank, suit: card.suit };
}

export function findSlotId(
  state: MatchState,
  playerId: PlayerId,
  position: StartingSlotPosition,
): SlotId {
  const slot = state.round?.slotsByPlayer[playerId]?.find((candidate) => candidate.position === position);
  if (slot === undefined) {
    throw new Error(`missing ${playerId} ${position} slot`);
  }
  return slot.slotId;
}

export function expireOpenSnapWindow(state: MatchState): EngineCommand[] {
  const snapWindow = state.round?.snapWindow;
  if (snapWindow === undefined || snapWindow === null) {
    return [];
  }
  return [{ type: "expireSnapWindow", windowId: snapWindow.windowId, generation: snapWindow.generation }];
}

export function command(
  type: EngineCommand["type"],
  fields: Omit<EngineCommand, "type">,
): EngineCommand {
  return { type, ...fields } as EngineCommand;
}

function makeStartingSlots(playerId: PlayerId, cards: readonly CardId[]): readonly CardSlot[] {
  const positions: readonly StartingSlotPosition[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
  return positions.map((position, index) => {
    const cardId = cards[index];
    if (cardId === undefined) {
      throw new Error("scripted hands require four cards");
    }
    return {
      slotId: startingSlotId(playerId, position),
      kind: "starting",
      position,
      cardId,
    };
  });
}

function addExpectedRevision(state: MatchState, commandToApply: EngineCommand): EngineCommand {
  if ("expectedRevision" in commandToApply && commandToApply.expectedRevision === undefined) {
    return { ...commandToApply, expectedRevision: state.revision } as EngineCommand;
  }
  return commandToApply;
}

function orderedSeats(state: MatchState): MatchState["seats"] {
  return [...state.seats].sort((left, right) => left.seatIndex - right.seatIndex);
}

function projectSlot(
  state: MatchState,
  viewerSeatId: PlayerId,
  playerId: PlayerId,
  slot: CardSlot,
  entitledSlots: ReadonlySet<string>,
): SlotView {
  if (slot.cardId === null) {
    return { state: "hole", slotId: slot.slotId, kind: slot.kind, position: slot.position };
  }
  if (!entitledSlots.has(slotKey(playerId, slot.slotId))) {
    return { state: "hidden", slotId: slot.slotId, kind: slot.kind, position: slot.position };
  }
  const card = state.round?.cards[slot.cardId];
  if (card === undefined) {
    throw new Error("missing card for entitled slot");
  }
  return { state: "revealed", slotId: slot.slotId, kind: slot.kind, position: slot.position, card: cardView(card) };
}

function projectDrawnCard(state: MatchState, viewerSeatId: PlayerId): StateSnapshotView["drawnCard"] {
  const drawn = state.round?.drawnCard;
  if (drawn === undefined || drawn === null) {
    return { state: "none" };
  }
  if (drawn.playerId !== viewerSeatId) {
    return { state: "hidden", playerId: drawn.playerId };
  }
  const card = state.round?.cards[drawn.cardId];
  if (card === undefined) {
    throw new Error("missing drawn card");
  }
  return { state: "revealed", playerId: viewerSeatId, card: cardView(card) };
}

function viewerEntitledSlots(state: MatchState, viewerSeatId: PlayerId): ReadonlySet<string> {
  const slotIds = new Set<string>();
  const round = state.round;
  if (round === null) {
    return slotIds;
  }

  if (round.phase === "scoring" || round.phase === "complete" || state.status === "complete") {
    for (const [playerId, slots] of Object.entries(round.slotsByPlayer)) {
      for (const slot of slots) {
        if (slot.cardId !== null) {
          slotIds.add(slotKey(playerId, slot.slotId));
        }
      }
    }
  }

  const viewerSeat = state.seats.find((seat) => seat.playerId === viewerSeatId);
  if (
    round.phase === "openingPeek" &&
    viewerSeat !== undefined &&
    !viewerSeat.openingPeekAcknowledged
  ) {
    for (const slot of round.slotsByPlayer[viewerSeatId] ?? []) {
      if (slot.cardId !== null && slot.position !== null && OPENING_PEEK_POSITIONS.includes(slot.position)) {
        slotIds.add(slotKey(viewerSeatId, slot.slotId));
      }
    }
  }

  const power = round.pendingPower;
  if (power !== null && power.ownerId === viewerSeatId) {
    const revealed = visiblePowerCardIds(power);
    for (const [playerId, slots] of Object.entries(round.slotsByPlayer)) {
      for (const slot of slots) {
        if (slot.cardId !== null && revealed.has(slot.cardId)) {
          slotIds.add(slotKey(playerId, slot.slotId));
        }
      }
    }
  }

  return slotIds;
}

function visiblePowerCardIds(power: NonNullable<RoundState["pendingPower"]>): ReadonlySet<CardId> {
  if (power.stage === "awaitingRevealAck") {
    return new Set(power.revealedCardIds);
  }
  if (power.kind === "blackKing" && power.stage === "awaitingKingDecision") {
    return new Set(power.selections.map((selection) => selection.cardId));
  }
  return new Set();
}

function legalActionsForViewer(state: MatchState, viewerSeatId: PlayerId): LegalAction[] {
  const seat = state.seats.find((candidate) => candidate.playerId === viewerSeatId);
  if (seat === undefined || seat.connection === "removed") {
    return [];
  }
  const actions: LegalAction[] = [];
  const round = state.round;
  if (state.status === "active" && round?.phase === "openingPeek" && !seat.openingPeekAcknowledged) {
    actions.push("acknowledgeOpeningPeek");
  }
  if (state.status === "intermission" && !seat.readyForNextRound) {
    actions.push("readyForNextRound");
  }
  if (state.pauseReasons.length > 0 || state.status !== "active" || round === null || round.phase !== "turnCycle") {
    return actions;
  }
  if (round.snapWindow !== null && round.turnStage === "resolving") {
    actions.push("attemptSnap");
  }
  if (round.pendingTransfer?.fromPlayerId === viewerSeatId) {
    actions.push("chooseTransferTarget");
  }
  if (round.activePlayerId !== viewerSeatId) {
    return actions;
  }
  if (round.turnStage === "turnStart") {
    actions.push("callCambio", "drawCard");
  }
  if (round.turnStage === "drawn") {
    actions.push("replaceSlot", "discardDrawn");
  }
  if (round.turnStage === "resolving" && round.pendingPower?.ownerId === viewerSeatId) {
    if (round.pendingPower.stage === "offered") {
      actions.push("skipPower", "selectPowerTarget");
    } else if (round.pendingPower.stage === "selectingFirst" || round.pendingPower.stage === "selectingSecond") {
      actions.push("selectPowerTarget", "reselectPowerTarget");
    } else if (round.pendingPower.stage === "awaitingRevealAck") {
      actions.push("acknowledgePowerReveal");
    } else if (round.pendingPower.stage === "awaitingKingDecision") {
      actions.push("decideBlackKingSwap");
    }
  }
  return actions;
}

function slotKey(playerId: PlayerId, slotId: SlotId): string {
  return `${playerId}\u0000${slotId}`;
}

function publicTarget(target: { readonly playerId: PlayerId; readonly slotId: SlotId }): SlotTarget {
  return { playerId: target.playerId, slotId: target.slotId };
}

function latestRoundEnded(actionLog: readonly ActionLogEntry[]): Extract<ActionLogEntry, { type: "roundEnded" }> | null {
  for (const entry of [...actionLog].reverse()) {
    if (entry.type === "roundEnded") {
      return entry;
    }
  }
  return null;
}

function sanitizeActionLogEntry(event: Exclude<DomainEvent, { type: "powerRevealed" } | { type: "snapTransientReveal" }>): ActionLogEntry {
  switch (event.type) {
    case "roundDealt":
      return { type: event.type, roundNumber: event.roundNumber, dealerId: event.dealerId };
    case "openingPeekAcknowledged":
      return {
        type: event.type,
        playerId: event.playerId,
        acknowledgedCount: event.acknowledgedCount,
        requiredCount: event.requiredCount,
      };
    case "turnStarted":
      return { type: event.type, activePlayerId: event.activePlayerId };
    case "cardDrawn":
      return { type: event.type, playerId: event.playerId };
    case "reshuffled":
      return { type: event.type, cardCount: event.cardCount };
    case "slotReplaced":
      return { type: event.type, playerId: event.playerId, slotId: event.slotId };
    case "cardDiscarded":
      return { type: event.type, playerId: event.playerId };
    case "cambioCalled":
      return { type: event.type, callerId: event.callerId, finalTurnQueue: [...event.finalTurnQueue] };
    case "turnAdvanced":
      return { type: event.type, previousPlayerId: event.previousPlayerId, activePlayerId: event.activePlayerId };
    case "roundEnded":
      return { type: event.type, reason: event.reason, scores: event.scores.map((score) => ({ ...score })) };
    case "readyForNextRound":
      return {
        type: event.type,
        playerId: event.playerId,
        readyCount: event.readyCount,
        requiredCount: event.requiredCount,
      };
    case "matchCompleted":
      return {
        type: event.type,
        winners: [...event.winners],
        cumulativeScores: { ...event.cumulativeScores },
      };
    case "snapWindowOpened":
      return { type: event.type, windowId: event.windowId, generation: event.generation };
    case "snapWindowClosed":
      return {
        type: event.type,
        windowId: event.windowId,
        generation: event.generation,
        resolvedBy: event.resolvedBy,
      };
    case "powerOffered":
      return { type: event.type, ownerId: event.ownerId, kind: event.kind };
    case "powerSkipped":
      return { type: event.type, ownerId: event.ownerId, kind: event.kind, reason: event.reason };
    case "powerTargetSelected":
      return { type: event.type, ownerId: event.ownerId, kind: event.kind, target: event.target };
    case "powerRevealAcknowledged":
      return { type: event.type, ownerId: event.ownerId, kind: event.kind };
    case "blackKingSwapDecided":
      return {
        type: event.type,
        ownerId: event.ownerId,
        confirmed: event.confirmed,
        swapped: event.swapped,
        targets: [...event.targets],
      };
    case "powerTargetInvalidated":
      return {
        type: event.type,
        ownerId: event.ownerId,
        kind: event.kind,
        targets: [...event.targets],
      };
    case "snapAttempted":
      return {
        type: event.type,
        playerId: event.playerId,
        target: event.target,
        correct: event.correct,
        receivedOrder: event.receivedOrder,
      };
    case "penaltyCardDrawn":
      return { type: event.type, playerId: event.playerId, slotId: event.slotId };
    case "transferCompleted":
      return {
        type: event.type,
        fromPlayerId: event.fromPlayerId,
        toPlayerId: event.toPlayerId,
        fromSlotId: event.fromSlotId,
        toSlotId: event.toSlotId,
      };
    case "playerRemoved":
      return { type: event.type, playerId: event.playerId };
    case "matchAbandoned":
      return { type: event.type, reason: event.reason, cumulativeScores: { ...event.cumulativeScores } };
  }
}

function mustAccept(result: TransitionResult): Extract<TransitionResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`tutorial setup rejected with ${result.code}`);
  }
  return result;
}

function payloadSlotId(payload: unknown): SlotId {
  return requireString(objectPayload(payload).slotId, "slotId");
}

function payloadTargetPlayerId(payload: unknown): PlayerId {
  return requireString(objectPayload(payload).targetPlayerId, "targetPlayerId");
}

function payloadTarget(payload: unknown): { readonly targetPlayerId: PlayerId; readonly slotId: SlotId } {
  const object = objectPayload(payload);
  return {
    targetPlayerId: requireString(object.targetPlayerId, "targetPlayerId"),
    slotId: requireString(object.slotId, "slotId"),
  };
}

function payloadOptionalTarget(payload: unknown): { readonly targetPlayerId?: PlayerId; readonly slotId?: SlotId } {
  const object = objectPayload(payload);
  const result: { targetPlayerId?: PlayerId; slotId?: SlotId } = {};
  if (object.targetPlayerId !== undefined) {
    result.targetPlayerId = requireString(object.targetPlayerId, "targetPlayerId");
  }
  if (object.slotId !== undefined) {
    result.slotId = requireString(object.slotId, "slotId");
  }
  return result;
}

function payloadDecision(payload: unknown): "confirm" | "decline" {
  const decision = objectPayload(payload).decision;
  if (decision !== "confirm" && decision !== "decline") {
    throw new Error("invalid black king decision");
  }
  return decision;
}

function payloadSnap(payload: unknown): {
  readonly snapWindowId: string;
  readonly generation: number;
  readonly targetPlayerId: PlayerId;
  readonly slotId: SlotId;
} {
  const object = objectPayload(payload);
  return {
    snapWindowId: requireString(object.snapWindowId, "snapWindowId"),
    generation: requireNumber(object.generation, "generation"),
    targetPlayerId: requireString(object.targetPlayerId, "targetPlayerId"),
    slotId: requireString(object.slotId, "slotId"),
  };
}

function objectPayload(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object") {
    return {};
  }
  return payload as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`missing ${label}`);
  }
  return value;
}
