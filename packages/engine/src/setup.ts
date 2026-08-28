import { createDeck } from "./deck.js";
import { powerKind } from "./model/cards.js";
import type { CardId, PowerKind, Rank } from "./model/cards.js";
import type { PlayerId, RoomId, SlotId, SlotRef, TimerId, WindowId } from "./model/ids.js";
import type {
  CardSlot,
  MatchState,
  PendingPower,
  RandomState,
  RoomConfig,
  RoundEndReason,
  RoundState,
  SeatState,
  StartingSlotPosition,
} from "./model/state.js";
import { createSeededRng, randomInt, shuffle } from "./random.js";
import { assertInvariants } from "./invariants.js";
import { calculateRawScores, cumulativeWinners, scoreRound, type RoundScore } from "./scoring.js";

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  roundCount: 9,
  snapWindowMs: 5_000,
  playerCap: 6,
};

export const OPENING_PEEK_POSITIONS: readonly StartingSlotPosition[] = [
  "bottomLeft",
  "bottomRight",
];

export const STARTING_SLOT_POSITIONS: readonly StartingSlotPosition[] = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
];

export type RejectionCode =
  | "E_BAD_ENVELOPE"
  | "E_UNAUTHORIZED"
  | "E_STALE_SESSION"
  | "E_ROOM_NOT_FOUND"
  | "E_ROOM_FULL"
  | "E_ROOM_STARTED"
  | "E_NOT_HOST"
  | "E_ALREADY_STARTED"
  | "E_MIN_PLAYERS"
  | "E_OUT_OF_PHASE"
  | "E_NOT_ACTIVE_PLAYER"
  | "E_STALE_REVISION"
  | "E_DUPLICATE_COMMAND"
  | "E_PAUSED"
  | "E_NO_DRAWN_CARD"
  | "E_SLOT_NOT_OCCUPIED"
  | "E_SLOT_IS_HOLE"
  | "E_NO_PENDING_POWER"
  | "E_POWER_STAGE_MISMATCH"
  | "E_TARGET_INVALID"
  | "E_TARGET_NOT_DISTINCT"
  | "E_STALE_SNAP_WINDOW"
  | "E_SNAP_ALREADY_RESOLVED"
  | "E_NO_TRANSFER_CARD"
  | "E_NO_PENDING_TRANSFER"
  | "E_CAMBIO_ALREADY_CALLED"
  | "E_CAMBIO_NOT_ALLOWED"
  | "E_NOT_REMOVAL_ELIGIBLE"
  | "E_ALREADY_REMOVED"
  | "E_INVALID_CONFIG"
  | "E_CREDENTIAL_INVALID";

export interface RoundDealtEvent {
  readonly type: "roundDealt";
  readonly roundNumber: number;
  readonly dealerId: PlayerId;
}

export interface OpeningPeekAcknowledgedEvent {
  readonly type: "openingPeekAcknowledged";
  readonly playerId: PlayerId;
  readonly acknowledgedCount: number;
  readonly requiredCount: number;
}

export interface TurnStartedEvent {
  readonly type: "turnStarted";
  readonly activePlayerId: PlayerId;
}

export interface CardDrawnEvent {
  readonly type: "cardDrawn";
  readonly playerId: PlayerId;
  readonly cardId: CardId;
}

export interface ReshuffledEvent {
  readonly type: "reshuffled";
  readonly cardCount: number;
}

export interface SlotReplacedEvent {
  readonly type: "slotReplaced";
  readonly playerId: PlayerId;
  readonly slotId: SlotId;
  readonly drawnCardId: CardId;
  readonly discardedCardId: CardId;
}

export interface CardDiscardedEvent {
  readonly type: "cardDiscarded";
  readonly playerId: PlayerId;
  readonly cardId: CardId;
}

export interface CambioCalledEvent {
  readonly type: "cambioCalled";
  readonly callerId: PlayerId;
  readonly finalTurnQueue: readonly PlayerId[];
}

export interface TurnAdvancedEvent {
  readonly type: "turnAdvanced";
  readonly previousPlayerId: PlayerId;
  readonly activePlayerId: PlayerId;
}

export interface RoundEndedEvent {
  readonly type: "roundEnded";
  readonly reason: RoundEndReason;
  readonly scores: readonly RoundScore[];
}

export interface ReadyForNextRoundEvent {
  readonly type: "readyForNextRound";
  readonly playerId: PlayerId;
  readonly readyCount: number;
  readonly requiredCount: number;
}

export interface MatchCompletedEvent {
  readonly type: "matchCompleted";
  readonly winners: readonly PlayerId[];
  readonly cumulativeScores: Readonly<Record<PlayerId, number>>;
}

export interface SnapWindowOpenedEvent {
  readonly type: "snapWindowOpened";
  readonly windowId: WindowId;
  readonly generation: number;
  readonly timerId: TimerId;
  readonly triggerCardId: CardId;
  readonly triggerRank: Rank;
}

export interface SnapWindowClosedEvent {
  readonly type: "snapWindowClosed";
  readonly windowId: WindowId;
  readonly generation: number;
  readonly resolvedBy: PlayerId | null;
}

export interface PowerOfferedEvent {
  readonly type: "powerOffered";
  readonly ownerId: PlayerId;
  readonly sourceCardId: CardId;
  readonly kind: PowerKind;
}

export interface PowerSkippedEvent {
  readonly type: "powerSkipped";
  readonly ownerId: PlayerId;
  readonly kind: PowerKind;
  readonly reason: "skipped" | "autoSkipped" | "ownerRemoved";
}

export interface PowerTargetSelectedEvent {
  readonly type: "powerTargetSelected";
  readonly ownerId: PlayerId;
  readonly kind: PowerKind;
  readonly target: PublicSlotTarget;
}

export interface PowerRevealedEvent {
  readonly type: "powerRevealed";
  readonly ownerId: PlayerId;
  readonly recipientId: PlayerId;
  readonly cardIds: readonly CardId[];
  readonly private: true;
}

export interface PowerRevealAcknowledgedEvent {
  readonly type: "powerRevealAcknowledged";
  readonly ownerId: PlayerId;
  readonly kind: PowerKind;
}

export interface BlackKingSwapDecidedEvent {
  readonly type: "blackKingSwapDecided";
  readonly ownerId: PlayerId;
  readonly confirmed: boolean;
  readonly swapped: boolean;
  readonly targets: readonly PublicSlotTarget[];
}

export interface PowerTargetInvalidatedEvent {
  readonly type: "powerTargetInvalidated";
  readonly ownerId: PlayerId;
  readonly kind: PowerKind;
  readonly targets: readonly PublicSlotTarget[];
}

export interface SnapAttemptedEvent {
  readonly type: "snapAttempted";
  readonly playerId: PlayerId;
  readonly target: PublicSlotTarget;
  readonly correct: boolean;
  readonly receivedOrder: number;
}

export interface SnapTransientRevealEvent {
  readonly type: "snapTransientReveal";
  readonly playerId: PlayerId;
  readonly target: PublicSlotTarget;
  readonly cardId: CardId;
  readonly rank: Rank;
  readonly transient: true;
}

export interface PenaltyCardDrawnEvent {
  readonly type: "penaltyCardDrawn";
  readonly playerId: PlayerId;
  readonly slotId: SlotId;
  readonly cardId: CardId;
}

export interface TransferCompletedEvent {
  readonly type: "transferCompleted";
  readonly fromPlayerId: PlayerId;
  readonly toPlayerId: PlayerId;
  readonly fromSlotId: SlotId;
  readonly toSlotId: SlotId;
}

export interface PlayerRemovedEvent {
  readonly type: "playerRemoved";
  readonly playerId: PlayerId;
}

export interface MatchAbandonedEvent {
  readonly type: "matchAbandoned";
  readonly reason: Extract<RoundEndReason, "hostEnded" | "insufficientPlayers">;
  readonly cumulativeScores: Readonly<Record<PlayerId, number>>;
}

export interface PublicSlotTarget {
  readonly playerId: PlayerId;
  readonly slotId: SlotId;
}

export type DomainEvent =
  | RoundDealtEvent
  | OpeningPeekAcknowledgedEvent
  | TurnStartedEvent
  | CardDrawnEvent
  | ReshuffledEvent
  | SlotReplacedEvent
  | CardDiscardedEvent
  | CambioCalledEvent
  | TurnAdvancedEvent
  | RoundEndedEvent
  | ReadyForNextRoundEvent
  | MatchCompletedEvent
  | SnapWindowOpenedEvent
  | SnapWindowClosedEvent
  | PowerOfferedEvent
  | PowerSkippedEvent
  | PowerTargetSelectedEvent
  | PowerRevealedEvent
  | PowerRevealAcknowledgedEvent
  | BlackKingSwapDecidedEvent
  | PowerTargetInvalidatedEvent
  | SnapAttemptedEvent
  | SnapTransientRevealEvent
  | PenaltyCardDrawnEvent
  | TransferCompletedEvent
  | PlayerRemovedEvent
  | MatchAbandonedEvent;

export interface AcceptedTransition {
  readonly ok: true;
  readonly state: MatchState;
  readonly events: readonly DomainEvent[];
}

export interface RejectedTransition {
  readonly ok: false;
  readonly state: MatchState | null;
  readonly code: RejectionCode;
  readonly events: readonly [];
}

export type TransitionResult = AcceptedTransition | RejectedTransition;

export interface CreateSeatInput {
  readonly playerId: PlayerId;
  readonly displayName: string;
}

export interface CreateMatchCommand {
  readonly type: "createMatch";
  readonly roomId: RoomId;
  readonly host: CreateSeatInput;
  readonly seed: number;
  readonly config?: Partial<RoomConfig>;
}

export interface StartMatchCommand {
  readonly type: "startMatch";
  readonly actorId: PlayerId;
}

export interface AcknowledgeOpeningPeekCommand {
  readonly type: "acknowledgeOpeningPeek";
  readonly actorId: PlayerId;
  readonly expectedRevision?: number;
}

export interface DrawCardCommand {
  readonly type: "drawCard";
  readonly actorId: PlayerId;
  readonly expectedRevision?: number;
}

export interface ReplaceSlotCommand {
  readonly type: "replaceSlot";
  readonly actorId: PlayerId;
  readonly slotId: SlotId;
  readonly expectedRevision?: number;
}

export interface DiscardDrawnCommand {
  readonly type: "discardDrawn";
  readonly actorId: PlayerId;
  readonly expectedRevision?: number;
}

export interface CallCambioCommand {
  readonly type: "callCambio";
  readonly actorId: PlayerId;
  readonly expectedRevision?: number;
}

export interface ReadyForNextRoundCommand {
  readonly type: "readyForNextRound";
  readonly actorId: PlayerId;
  readonly expectedRevision?: number;
}

export interface SkipPowerCommand {
  readonly type: "skipPower";
  readonly actorId: PlayerId;
  readonly expectedRevision?: number;
}

export interface SelectPowerTargetCommand {
  readonly type: "selectPowerTarget";
  readonly actorId: PlayerId;
  readonly targetPlayerId: PlayerId;
  readonly slotId: SlotId;
  readonly expectedRevision?: number;
}

export interface AcknowledgePowerRevealCommand {
  readonly type: "acknowledgePowerReveal";
  readonly actorId: PlayerId;
  readonly expectedRevision?: number;
}

export interface DecideBlackKingSwapCommand {
  readonly type: "decideBlackKingSwap";
  readonly actorId: PlayerId;
  readonly decision: "confirm" | "decline";
  readonly expectedRevision?: number;
}

export interface ReselectPowerTargetCommand {
  readonly type: "reselectPowerTarget";
  readonly actorId: PlayerId;
  readonly targetPlayerId?: PlayerId;
  readonly slotId?: SlotId;
  readonly expectedRevision?: number;
}

export interface AttemptSnapCommand {
  readonly type: "attemptSnap";
  readonly actorId: PlayerId;
  readonly windowId: WindowId;
  readonly generation: number;
  readonly targetPlayerId: PlayerId;
  readonly slotId: SlotId;
  readonly expectedRevision?: number;
}

export interface ChooseTransferTargetCommand {
  readonly type: "chooseTransferTarget";
  readonly actorId: PlayerId;
  readonly slotId: SlotId;
  readonly expectedRevision?: number;
}

export interface ExpireSnapWindowCommand {
  readonly type: "expireSnapWindow";
  readonly windowId: WindowId;
  readonly generation: number;
}

export type EngineCommand =
  | CreateMatchCommand
  | StartMatchCommand
  | AcknowledgeOpeningPeekCommand
  | DrawCardCommand
  | ReplaceSlotCommand
  | DiscardDrawnCommand
  | CallCambioCommand
  | ReadyForNextRoundCommand
  | SkipPowerCommand
  | SelectPowerTargetCommand
  | AcknowledgePowerRevealCommand
  | DecideBlackKingSwapCommand
  | ReselectPowerTargetCommand
  | AttemptSnapCommand
  | ChooseTransferTargetCommand
  | ExpireSnapWindowCommand;

export interface ConfigAccepted {
  readonly ok: true;
  readonly config: RoomConfig;
}

export interface ConfigRejected {
  readonly ok: false;
  readonly code: "E_INVALID_CONFIG";
}

export type ConfigValidationResult = ConfigAccepted | ConfigRejected;

export function validateRoomConfig(config: Partial<RoomConfig> = {}): ConfigValidationResult {
  const resolved: RoomConfig = {
    roundCount: config.roundCount ?? DEFAULT_ROOM_CONFIG.roundCount,
    snapWindowMs: config.snapWindowMs ?? DEFAULT_ROOM_CONFIG.snapWindowMs,
    playerCap: config.playerCap ?? DEFAULT_ROOM_CONFIG.playerCap,
  };

  if (
    !isIntegerInRange(resolved.playerCap, 2, 6) ||
    !isIntegerInRange(resolved.roundCount, 1, 20) ||
    !isIntegerInRange(resolved.snapWindowMs, 2_000, 10_000)
  ) {
    return { ok: false, code: "E_INVALID_CONFIG" };
  }

  return { ok: true, config: resolved };
}

export function createMatch(command: CreateMatchCommand): TransitionResult {
  const configResult = validateRoomConfig(command.config);
  if (!configResult.ok) {
    return reject(null, configResult.code);
  }

  const hostSeat = createSeat(command.host, 0);
  const state: MatchState = {
    roomId: command.roomId,
    config: configResult.config,
    status: "lobby",
    revision: 0,
    randomState: createSeededRng(command.seed).state,
    snapWindowSequence: 0,
    lastResolvedSnapWindow: null,
    hostPlayerId: command.host.playerId,
    seats: [hostSeat],
    round: null,
    cumulativeScores: { [command.host.playerId]: 0 },
    completedRounds: 0,
    pauseReasons: [],
  };

  return accept(state, []);
}

export function reduceCommand(state: MatchState | null, command: EngineCommand): TransitionResult {
  if (command.type === "createMatch") {
    return createMatch(command);
  }

  if (state === null) {
    return reject(null, "E_ROOM_NOT_FOUND");
  }

  switch (command.type) {
    case "startMatch":
      return startMatch(state, command);
    case "acknowledgeOpeningPeek":
      return acknowledgeOpeningPeek(state, command);
    case "drawCard":
      return drawCard(state, command);
    case "replaceSlot":
      return replaceSlot(state, command);
    case "discardDrawn":
      return discardDrawn(state, command);
    case "callCambio":
      return callCambio(state, command);
    case "readyForNextRound":
      return readyForNextRound(state, command);
    case "skipPower":
      return skipPower(state, command);
    case "selectPowerTarget":
      return selectPowerTarget(state, command);
    case "acknowledgePowerReveal":
      return acknowledgePowerReveal(state, command);
    case "decideBlackKingSwap":
      return decideBlackKingSwap(state, command);
    case "reselectPowerTarget":
      return reselectPowerTarget(state, command);
    case "attemptSnap":
      return attemptSnap(state, command);
    case "chooseTransferTarget":
      return chooseTransferTarget(state, command);
    case "expireSnapWindow":
      return expireSnapWindow(state, command);
  }
}

export function startMatch(state: MatchState, command: StartMatchCommand): TransitionResult {
  if (state.status !== "lobby") {
    return reject(state, state.status === "active" ? "E_ALREADY_STARTED" : "E_OUT_OF_PHASE");
  }

  if (state.hostPlayerId !== command.actorId) {
    return reject(state, "E_NOT_HOST");
  }

  if (activeSeats(state.seats).length < 2) {
    return reject(state, "E_MIN_PLAYERS");
  }

  const dealt = dealCards({
    ...state,
    status: "active",
    seats: resetRoundSeatFlags(state.seats),
  });

  return accept(dealt.state, [dealt.event]);
}

export function acknowledgeOpeningPeek(
  state: MatchState,
  command: AcknowledgeOpeningPeekCommand,
): TransitionResult {
  if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) {
    return reject(state, "E_STALE_REVISION");
  }

  if (state.status !== "active" || state.round?.phase !== "openingPeek") {
    return reject(state, "E_OUT_OF_PHASE");
  }

  const seat = state.seats.find((candidate) => candidate.playerId === command.actorId);
  if (seat === undefined || seat.connection === "removed") {
    return reject(state, "E_UNAUTHORIZED");
  }

  if (seat.openingPeekAcknowledged) {
    return accept(state, []);
  }

  const seats = state.seats.map((candidate) =>
    candidate.playerId === command.actorId
      ? { ...candidate, openingPeekAcknowledged: true }
      : candidate,
  );
  const requiredSeats = activeSeats(seats);
  const acknowledgedCount = requiredSeats.filter(
    (candidate) => candidate.openingPeekAcknowledged,
  ).length;
  const acknowledgementEvent: OpeningPeekAcknowledgedEvent = {
    type: "openingPeekAcknowledged",
    playerId: command.actorId,
    acknowledgedCount,
    requiredCount: requiredSeats.length,
  };

  if (acknowledgedCount !== requiredSeats.length) {
    return accept(
      {
        ...state,
        revision: state.revision + 1,
        seats,
      },
      [acknowledgementEvent],
    );
  }

  const activePlayerId = nextActiveSeatId(requiredSeats, state.round.dealerId);
  const round: RoundState = {
    ...state.round,
    phase: "turnCycle",
    activePlayerId,
    turnStage: "turnStart",
  };
  const nextState: MatchState = {
    ...state,
    revision: state.revision + 1,
    seats,
    round,
  };

  return accept(nextState, [
    acknowledgementEvent,
    {
      type: "turnStarted",
      activePlayerId,
    },
  ]);
}

export function drawCard(state: MatchState, command: DrawCardCommand): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const round = state.round;
  if (
    state.status !== "active" ||
    round === null ||
    round.phase !== "turnCycle" ||
    round.turnStage !== "turnStart"
  ) {
    return reject(state, "E_OUT_OF_PHASE");
  }

  if (round.activePlayerId !== command.actorId) {
    return reject(state, "E_NOT_ACTIVE_PLAYER");
  }

  const drawResult = drawFromSharedStock(state, round);
  if (drawResult.type === "roundEnded") {
    return accept(drawResult.state, drawResult.events);
  }

  return accept(
    {
      ...drawResult.state,
      round: {
        ...drawResult.round,
        drawnCard: {
          playerId: command.actorId,
          cardId: drawResult.cardId,
        },
        turnStage: "drawn",
      },
      revision: state.revision + 1,
    },
    [
      ...drawResult.events,
      {
        type: "cardDrawn",
        playerId: command.actorId,
        cardId: drawResult.cardId,
      },
    ],
  );
}

export function replaceSlot(state: MatchState, command: ReplaceSlotCommand): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const round = state.round;
  if (round?.activePlayerId !== command.actorId) {
    return reject(state, "E_NOT_ACTIVE_PLAYER");
  }

  if (round.phase !== "turnCycle" || round.turnStage !== "drawn" || round.drawnCard === null) {
    return reject(state, "E_NO_DRAWN_CARD");
  }

  const slots = round.slotsByPlayer[command.actorId] ?? [];
  const slot = slots.find((candidate) => candidate.slotId === command.slotId);
  if (slot === undefined) {
    return reject(state, "E_SLOT_NOT_OCCUPIED");
  }

  if (slot.cardId === null) {
    return reject(state, "E_SLOT_IS_HOLE");
  }

  const discardedCardId = slot.cardId;
  const drawnCardId = round.drawnCard.cardId;
  const nextSlots = slots.map((candidate) =>
    candidate.slotId === command.slotId ? { ...candidate, cardId: drawnCardId } : candidate,
  );
  const nextRound: RoundState = {
    ...round,
    slotsByPlayer: {
      ...round.slotsByPlayer,
      [command.actorId]: nextSlots,
    },
    discardPile: [discardedCardId, ...round.discardPile],
    drawnCard: null,
  };

  const opened = openNormalDiscardResolution(state, nextRound, command.actorId, discardedCardId);
  const turnResult = advanceAfterTurnResolution(opened.state);

  return accept(
    {
      ...turnResult.state,
      revision: state.revision + 1,
    },
    [
      {
        type: "slotReplaced",
        playerId: command.actorId,
        slotId: command.slotId,
        drawnCardId,
        discardedCardId,
      },
      ...opened.events,
      ...turnResult.events,
    ],
  );
}

export function discardDrawn(state: MatchState, command: DiscardDrawnCommand): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const round = state.round;
  if (round?.activePlayerId !== command.actorId) {
    return reject(state, "E_NOT_ACTIVE_PLAYER");
  }

  if (round.phase !== "turnCycle" || round.turnStage !== "drawn" || round.drawnCard === null) {
    return reject(state, "E_NO_DRAWN_CARD");
  }

  const discardedCardId = round.drawnCard.cardId;
  const nextRound: RoundState = {
    ...round,
    discardPile: [discardedCardId, ...round.discardPile],
    drawnCard: null,
  };

  const opened = openNormalDiscardResolution(state, nextRound, command.actorId, discardedCardId);
  const turnResult = advanceAfterTurnResolution(opened.state);

  return accept(
    {
      ...turnResult.state,
      revision: state.revision + 1,
    },
    [
      {
        type: "cardDiscarded",
        playerId: command.actorId,
        cardId: discardedCardId,
      },
      ...opened.events,
      ...turnResult.events,
    ],
  );
}

export function skipPower(state: MatchState, command: SkipPowerCommand): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const powerCheck = requirePowerOwner(state, command.actorId);
  if (!powerCheck.ok) {
    return reject(state, powerCheck.code);
  }

  if (powerCheck.power.stage !== "offered") {
    return reject(state, "E_POWER_STAGE_MISMATCH");
  }

  const round = powerCheck.round;
  const turnResult = advanceAfterTurnResolution({
    ...state,
    round: {
      ...round,
      pendingPower: null,
    },
  });

  return accept(
    {
      ...turnResult.state,
      revision: state.revision + 1,
    },
    [
      {
        type: "powerSkipped",
        ownerId: command.actorId,
        kind: powerCheck.power.kind,
        reason: "skipped",
      },
      ...turnResult.events,
    ],
  );
}

export function selectPowerTarget(
  state: MatchState,
  command: SelectPowerTargetCommand,
): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const powerCheck = requirePowerOwner(state, command.actorId);
  if (!powerCheck.ok) {
    return reject(state, powerCheck.code);
  }

  const { round, power } = powerCheck;
  const target = occupiedSlotRef(round, command.targetPlayerId, command.slotId);
  if (target === null) {
    return reject(state, slotExists(round, command.targetPlayerId, command.slotId) ? "E_SLOT_NOT_OCCUPIED" : "E_TARGET_INVALID");
  }

  const stageCheck = expectedTargetRole(power);
  if (stageCheck === null) {
    return reject(state, "E_POWER_STAGE_MISMATCH");
  }

  if (!targetMatchesRole(command.actorId, command.targetPlayerId, stageCheck)) {
    return reject(state, "E_TARGET_INVALID");
  }

  if (
    power.selections.some(
      (selection) => selection.playerId === target.playerId && selection.slotId === target.slotId,
    )
  ) {
    return reject(state, "E_TARGET_NOT_DISTINCT");
  }

  if (!allSelectionsValid(round, power.selections)) {
    return reject(state, "E_TARGET_INVALID");
  }

  const nextSelections = appendPowerSelection(power, target);
  const selectedEvent: PowerTargetSelectedEvent = {
    type: "powerTargetSelected",
    ownerId: command.actorId,
    kind: power.kind,
    target: publicTarget(target),
  };

  if (power.kind === "peekOwn" || power.kind === "peekOpponent") {
    const nextPower: PendingPower = {
      ...power,
      selections: nextSelections,
      revealedCardIds: [target.cardId],
      stage: "awaitingRevealAck",
    };
    return accept(
      {
        ...state,
        revision: state.revision + 1,
        round: {
          ...round,
          pendingPower: nextPower,
        },
      },
      [
        selectedEvent,
        {
          type: "powerRevealed",
          ownerId: command.actorId,
          recipientId: command.actorId,
          cardIds: [target.cardId],
          private: true,
        },
      ],
    );
  }

  if (power.kind === "blindSwap") {
    if (nextSelections.length === 1) {
      return accept(
        {
          ...state,
          revision: state.revision + 1,
          round: {
            ...round,
            pendingPower: {
              ...power,
              selections: nextSelections,
              stage: "selectingSecond",
            },
          },
        },
        [selectedEvent],
      );
    }

    const [first, second] = nextSelections;
    if (first === undefined || second === undefined) {
      throw new Error("blind swap requires two selections");
    }

    const swapResult = swapSelectedSlots(round, first, second);
    if (swapResult === null) {
      return reject(state, "E_TARGET_INVALID");
    }

    const revalidated = revalidatePendingPowerSelections({
      ...state,
      round: {
        ...swapResult,
        pendingPower: null,
      },
    });
    const turnResult = advanceAfterTurnResolution(revalidated.state);

    return accept(
      {
        ...turnResult.state,
        revision: state.revision + 1,
      },
      [selectedEvent, ...revalidated.events, ...turnResult.events],
    );
  }

  if (power.kind === "blackKing") {
    const revealedCardIds = nextSelections.map((selection) => selection.cardId);
    const nextPower: PendingPower = {
      ...power,
      selections: nextSelections,
      revealedCardIds,
      stage: "awaitingRevealAck",
    };

    return accept(
      {
        ...state,
        revision: state.revision + 1,
        round: {
          ...round,
          pendingPower: nextPower,
        },
      },
      [
        selectedEvent,
        {
          type: "powerRevealed",
          ownerId: command.actorId,
          recipientId: command.actorId,
          cardIds: revealedCardIds,
          private: true,
        },
      ],
    );
  }

  return reject(state, "E_POWER_STAGE_MISMATCH");
}

export function acknowledgePowerReveal(
  state: MatchState,
  command: AcknowledgePowerRevealCommand,
): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const powerCheck = requirePowerOwner(state, command.actorId);
  if (!powerCheck.ok) {
    return reject(state, powerCheck.code);
  }

  const { round, power } = powerCheck;
  if (power.stage !== "awaitingRevealAck") {
    return reject(state, "E_POWER_STAGE_MISMATCH");
  }

  const ackEvent: PowerRevealAcknowledgedEvent = {
    type: "powerRevealAcknowledged",
    ownerId: command.actorId,
    kind: power.kind,
  };

  if (power.kind === "peekOwn" || power.kind === "peekOpponent") {
    const turnResult = advanceAfterTurnResolution({
      ...state,
      round: {
        ...round,
        pendingPower: null,
      },
    });

    return accept(
      {
        ...turnResult.state,
        revision: state.revision + 1,
      },
      [ackEvent, ...turnResult.events],
    );
  }

  if (power.kind !== "blackKing") {
    return reject(state, "E_POWER_STAGE_MISMATCH");
  }

  const nextStage = power.selections.length < 2 ? "selectingSecond" : "awaitingKingDecision";
  return accept(
    {
      ...state,
      revision: state.revision + 1,
      round: {
        ...round,
        pendingPower: {
          ...power,
          revealedCardIds: [],
          stage: nextStage,
        },
      },
    },
    [ackEvent],
  );
}

export function decideBlackKingSwap(
  state: MatchState,
  command: DecideBlackKingSwapCommand,
): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const powerCheck = requirePowerOwner(state, command.actorId);
  if (!powerCheck.ok) {
    return reject(state, powerCheck.code);
  }

  const { round, power } = powerCheck;
  if (power.kind !== "blackKing" || power.stage !== "awaitingKingDecision") {
    return reject(state, "E_POWER_STAGE_MISMATCH");
  }

  const [ownSelection, opponentSelection] = power.selections;
  if (
    ownSelection === undefined ||
    opponentSelection === undefined ||
    !allSelectionsValid(round, power.selections)
  ) {
    return reject(state, "E_TARGET_INVALID");
  }

  const swappedRound =
    command.decision === "confirm"
      ? swapSelectedSlots(round, ownSelection, opponentSelection)
      : round;
  if (swappedRound === null) {
    return reject(state, "E_TARGET_INVALID");
  }

  const revalidated = revalidatePendingPowerSelections({
    ...state,
    round: {
      ...swappedRound,
      pendingPower: null,
    },
  });
  const turnResult = advanceAfterTurnResolution(revalidated.state);

  return accept(
    {
      ...turnResult.state,
      revision: state.revision + 1,
    },
    [
      {
        type: "blackKingSwapDecided",
        ownerId: command.actorId,
        confirmed: command.decision === "confirm",
        swapped: command.decision === "confirm",
        targets: power.selections.map(publicTarget),
      },
      ...revalidated.events,
      ...turnResult.events,
    ],
  );
}

export function reselectPowerTarget(
  state: MatchState,
  command: ReselectPowerTargetCommand,
): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const powerCheck = requirePowerOwner(state, command.actorId);
  if (!powerCheck.ok) {
    return reject(state, powerCheck.code);
  }

  const { round, power } = powerCheck;
  const dropped = power.selections.filter((selection) =>
    command.targetPlayerId === undefined || command.slotId === undefined
      ? !isSelectionValid(round, selection)
      : selection.playerId === command.targetPlayerId && selection.slotId === command.slotId,
  );

  if (dropped.length === 0 || dropped.some((selection) => isSelectionValid(round, selection))) {
    return reject(state, "E_TARGET_INVALID");
  }

  const nextPower = rebuildPowerAfterInvalidation(
    round,
    {
      ...power,
      selections: power.selections.filter((selection) => !dropped.includes(selection)),
      revealedCardIds: power.revealedCardIds.filter(
        (cardId) => !dropped.some((selection) => selection.cardId === cardId),
      ),
    },
    dropped,
  );

  const nextState = {
    ...state,
    round: {
      ...round,
      pendingPower: nextPower,
    },
  };
  const turnResult = nextPower === null ? advanceAfterTurnResolution(nextState) : { state: nextState, events: [] };

  return accept(
    {
      ...turnResult.state,
      revision: state.revision + 1,
    },
    [
      {
        type: "powerTargetInvalidated",
        ownerId: command.actorId,
        kind: power.kind,
        targets: dropped.map(publicTarget),
      },
      ...(nextPower === null
        ? [
            {
              type: "powerSkipped" as const,
              ownerId: command.actorId,
              kind: power.kind,
              reason: "autoSkipped" as const,
            },
          ]
        : []),
      ...turnResult.events,
    ],
  );
}

export function attemptSnap(state: MatchState, command: AttemptSnapCommand): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const round = state.round;
  if (!canSendSnap(state, command.actorId)) {
    return reject(state, "E_UNAUTHORIZED");
  }

  if (round?.snapWindow === null || round === null) {
    if (
      state.lastResolvedSnapWindow?.windowId === command.windowId &&
      state.lastResolvedSnapWindow.generation === command.generation
    ) {
      return reject(state, "E_SNAP_ALREADY_RESOLVED");
    }

    return reject(state, "E_STALE_SNAP_WINDOW");
  }

  if (state.status !== "active" || round.phase !== "turnCycle" || round.turnStage !== "resolving") {
    return reject(state, "E_STALE_SNAP_WINDOW");
  }

  if (
    round.snapWindow.windowId !== command.windowId ||
    round.snapWindow.generation !== command.generation
  ) {
    return reject(state, "E_STALE_SNAP_WINDOW");
  }

  if (round.snapWindow.resolvedBy !== null) {
    return reject(state, "E_SNAP_ALREADY_RESOLVED");
  }

  const target = occupiedSlotRef(round, command.targetPlayerId, command.slotId);
  if (target === null) {
    return reject(state, "E_SLOT_NOT_OCCUPIED");
  }

  const correct = round.cards[target.cardId]!.rank === round.snapWindow.triggerRank;
  const receivedOrder = round.snapWindow.attempts.length;
  const attempt = {
    playerId: command.actorId,
    target,
    correct,
    receivedOrder,
  };

  if (correct && command.targetPlayerId !== command.actorId && occupiedSlots(round, command.actorId).length === 0) {
    return reject(state, "E_NO_TRANSFER_CARD");
  }

  if (correct) {
    const targetSlots = (round.slotsByPlayer[command.targetPlayerId] ?? []).map((slot) =>
      slot.slotId === command.slotId ? { ...slot, cardId: null } : slot,
    );
    const pendingTransfer =
      command.targetPlayerId === command.actorId
        ? null
        : {
            fromPlayerId: command.actorId,
            toPlayerId: command.targetPlayerId,
            targetSlotId: command.slotId,
          };
    const closedWindow = round.snapWindow;
    const movedRound: RoundState = {
      ...round,
      slotsByPlayer: {
        ...round.slotsByPlayer,
        [command.targetPlayerId]: targetSlots,
      },
      discardPile: [target.cardId, ...round.discardPile],
      snapWindow: null,
      pendingTransfer,
    };
    const revalidated = revalidatePendingPowerSelections({
      ...state,
      lastResolvedSnapWindow: {
        windowId: closedWindow.windowId,
        generation: closedWindow.generation,
      },
      round: movedRound,
    });
    const turnResult = advanceAfterTurnResolution(revalidated.state);

    return accept(
      {
        ...turnResult.state,
        revision: state.revision + 1,
      },
      [
        {
          type: "snapAttempted",
          playerId: command.actorId,
          target: publicTarget(target),
          correct,
          receivedOrder,
        },
        {
          type: "snapWindowClosed",
          windowId: closedWindow.windowId,
          generation: closedWindow.generation,
          resolvedBy: command.actorId,
        },
        ...revalidated.events,
        ...turnResult.events,
      ],
    );
  }

  const windowWithAttempt = {
    ...round.snapWindow,
    attempts: [...round.snapWindow.attempts, attempt],
  };
  const drawResult = drawFromSharedStock(state, {
    ...round,
    snapWindow: windowWithAttempt,
  });
  const snapEvents: DomainEvent[] = [
    {
      type: "snapAttempted",
      playerId: command.actorId,
      target: publicTarget(target),
      correct,
      receivedOrder,
    },
    {
      type: "snapTransientReveal",
      playerId: command.actorId,
      target: publicTarget(target),
      cardId: target.cardId,
      rank: round.cards[target.cardId]!.rank,
      transient: true,
    },
  ];

  if (drawResult.type === "roundEnded") {
    return accept(drawResult.state, [...snapEvents, ...drawResult.events]);
  }

  const penaltyPlacement = placePenaltyCard(drawResult.round, command.actorId, drawResult.cardId);
  const revalidated = revalidatePendingPowerSelections({
    ...drawResult.state,
    round: penaltyPlacement.round,
  });

  return accept(
    {
      ...revalidated.state,
      revision: state.revision + 1,
    },
    [
      ...snapEvents,
      ...drawResult.events,
      {
        type: "penaltyCardDrawn",
        playerId: command.actorId,
        slotId: penaltyPlacement.slotId,
        cardId: drawResult.cardId,
      },
      ...revalidated.events,
    ],
  );
}

export function chooseTransferTarget(
  state: MatchState,
  command: ChooseTransferTargetCommand,
): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const round = state.round;
  if (state.status !== "active" || round?.phase !== "turnCycle" || round.pendingTransfer === null) {
    return reject(state, "E_NO_PENDING_TRANSFER");
  }

  const transfer = round.pendingTransfer;
  if (transfer.fromPlayerId !== command.actorId) {
    return reject(state, "E_TARGET_INVALID");
  }

  const source = occupiedSlotRef(round, command.actorId, command.slotId);
  if (source === null) {
    return reject(state, slotExists(round, command.actorId, command.slotId) ? "E_SLOT_NOT_OCCUPIED" : "E_TARGET_INVALID");
  }

  const targetSlots = round.slotsByPlayer[transfer.toPlayerId] ?? [];
  const targetSlot = targetSlots.find((slot) => slot.slotId === transfer.targetSlotId);
  if (targetSlot === undefined || targetSlot.cardId !== null) {
    return reject(state, "E_TARGET_INVALID");
  }

  const sourceSlots = (round.slotsByPlayer[command.actorId] ?? []).map((slot) =>
    slot.slotId === command.slotId ? { ...slot, cardId: null } : slot,
  );
  const nextTargetSlots = targetSlots.map((slot) =>
    slot.slotId === transfer.targetSlotId ? { ...slot, cardId: source.cardId } : slot,
  );
  const movedRound: RoundState = {
    ...round,
    slotsByPlayer: {
      ...round.slotsByPlayer,
      [command.actorId]: sourceSlots,
      [transfer.toPlayerId]: nextTargetSlots,
    },
    pendingTransfer: null,
  };
  const revalidated = revalidatePendingPowerSelections({
    ...state,
    round: movedRound,
  });
  const turnResult = advanceAfterTurnResolution(revalidated.state);

  return accept(
    {
      ...turnResult.state,
      revision: state.revision + 1,
    },
    [
      {
        type: "transferCompleted",
        fromPlayerId: command.actorId,
        toPlayerId: transfer.toPlayerId,
        fromSlotId: command.slotId,
        toSlotId: transfer.targetSlotId,
      },
      ...revalidated.events,
      ...turnResult.events,
    ],
  );
}

export function expireSnapWindow(
  state: MatchState,
  command: ExpireSnapWindowCommand,
): TransitionResult {
  const round = state.round;
  if (
    state.status !== "active" ||
    round?.phase !== "turnCycle" ||
    round.snapWindow === null ||
    round.snapWindow.windowId !== command.windowId ||
    round.snapWindow.generation !== command.generation ||
    round.snapWindow.resolvedBy !== null
  ) {
    return accept(state, []);
  }

  const closedWindow = round.snapWindow;
  const turnResult = advanceAfterTurnResolution({
    ...state,
    round: {
      ...round,
      snapWindow: null,
    },
  });

  return accept(
    {
      ...turnResult.state,
      revision: state.revision + 1,
    },
    [
      {
        type: "snapWindowClosed",
        windowId: closedWindow.windowId,
        generation: closedWindow.generation,
        resolvedBy: null,
      },
      ...turnResult.events,
    ],
  );
}

export function callCambio(state: MatchState, command: CallCambioCommand): TransitionResult {
  const rejected = rejectStaleOrPaused(state, command.expectedRevision);
  if (rejected !== null) {
    return rejected;
  }

  const round = state.round;
  if (state.status !== "active" || round === null || round.phase !== "turnCycle") {
    return reject(state, "E_OUT_OF_PHASE");
  }

  if (round.activePlayerId !== command.actorId) {
    return reject(state, "E_NOT_ACTIVE_PLAYER");
  }

  if (round.cambio !== null) {
    return reject(state, "E_CAMBIO_ALREADY_CALLED");
  }

  if (round.turnStage !== "turnStart" || round.drawnCard !== null) {
    return reject(state, "E_CAMBIO_NOT_ALLOWED");
  }

  const finalTurnQueue = orderedPlayerIdsAfter(state.seats, command.actorId).filter(
    (playerId) => playerId !== command.actorId,
  );
  const nextActivePlayerId = finalTurnQueue[0] ?? null;
  const nextRound: RoundState = {
    ...round,
    cambio: {
      callerId: command.actorId,
      finalTurnQueue,
      completedFinalTurns: [],
    },
    activePlayerId: nextActivePlayerId,
    turnStage: nextActivePlayerId === null ? null : "turnStart",
  };
  const nextState: MatchState = {
    ...state,
    round: nextRound,
  };

  if (nextActivePlayerId === null) {
    const ended = endRound(nextState, "cambio");
    return accept(
      {
        ...ended.state,
        revision: state.revision + 1,
      },
      [
        {
          type: "cambioCalled",
          callerId: command.actorId,
          finalTurnQueue,
        },
        ...ended.events,
      ],
    );
  }

  return accept(
    {
      ...nextState,
      revision: state.revision + 1,
    },
    [
      {
        type: "cambioCalled",
        callerId: command.actorId,
        finalTurnQueue,
      },
      {
        type: "turnAdvanced",
        previousPlayerId: command.actorId,
        activePlayerId: nextActivePlayerId,
      },
    ],
  );
}

export function readyForNextRound(
  state: MatchState,
  command: ReadyForNextRoundCommand,
): TransitionResult {
  if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) {
    return reject(state, "E_STALE_REVISION");
  }

  if (state.status !== "intermission" || state.round === null || state.round.phase !== "scoring") {
    return reject(state, "E_OUT_OF_PHASE");
  }

  const seat = state.seats.find((candidate) => candidate.playerId === command.actorId);
  if (seat === undefined || seat.connection === "removed") {
    return reject(state, "E_OUT_OF_PHASE");
  }

  if (seat.readyForNextRound) {
    return accept(state, []);
  }

  const seats = state.seats.map((candidate) =>
    candidate.playerId === command.actorId ? { ...candidate, readyForNextRound: true } : candidate,
  );
  const requiredSeats = activeSeats(seats);
  const readyCount = requiredSeats.filter((candidate) => candidate.readyForNextRound).length;
  const readyEvent: ReadyForNextRoundEvent = {
    type: "readyForNextRound",
    playerId: command.actorId,
    readyCount,
    requiredCount: requiredSeats.length,
  };

  if (readyCount !== requiredSeats.length) {
    return accept(
      {
        ...state,
        revision: state.revision + 1,
        seats,
      },
      [readyEvent],
    );
  }

  if (state.completedRounds === state.config.roundCount) {
    const eligiblePlayerIds = requiredSeats.map((candidate) => candidate.playerId);
    const winners = cumulativeWinners(state.cumulativeScores, eligiblePlayerIds);
    const round: RoundState = {
      ...state.round,
      phase: "complete",
    };
    return accept(
      {
        ...state,
        status: "complete",
        revision: state.revision + 1,
        seats,
        round,
      },
      [
        readyEvent,
        {
          type: "matchCompleted",
          winners,
          cumulativeScores: state.cumulativeScores,
        },
      ],
    );
  }

  const dealt = dealCards({
    ...state,
    status: "active",
    seats: resetRoundSeatFlags(seats),
  });

  return accept(dealt.state, [readyEvent, dealt.event]);
}

export function removePlayer(state: MatchState, targetPlayerId: PlayerId): TransitionResult {
  const targetSeat = state.seats.find((seat) => seat.playerId === targetPlayerId);
  if (targetSeat === undefined || targetSeat.connection === "removed" || targetSeat.withdrawn) {
    return reject(state, "E_ALREADY_REMOVED");
  }

  const seats = state.seats.map((seat) =>
    seat.playerId === targetPlayerId
      ? {
          ...seat,
          connection: "removed" as const,
          withdrawn: true,
          openingPeekAcknowledged: false,
          readyForNextRound: false,
          removalEligible: false,
        }
      : seat,
  );
  const hostPlayerId =
    state.hostPlayerId === targetPlayerId
      ? (activeSeats(seats).find((seat) => seat.connection === "connected")?.playerId ?? null)
      : state.hostPlayerId;
  const baseState: MatchState = {
    ...state,
    seats,
    hostPlayerId,
    pauseReasons: state.pauseReasons.filter((playerId) => playerId !== targetPlayerId),
  };
  const removalEvent: PlayerRemovedEvent = {
    type: "playerRemoved",
    playerId: targetPlayerId,
  };

  if (activeSeats(seats).length < 2) {
    const stateWithCardsRemoved = moveRemovedCardsOutOfPlay(baseState, targetPlayerId, true);
    const abandoned = abandonMatch(stateWithCardsRemoved, "insufficientPlayers");
    return accept(
      {
        ...abandoned.state,
        revision: state.revision + 1,
      },
      [removalEvent, ...abandoned.events],
    );
  }

  if (baseState.round === null) {
    return accept(
      {
        ...baseState,
        revision: state.revision + 1,
      },
      [removalEvent],
    );
  }

  const movedState = moveRemovedCardsOutOfPlay(baseState, targetPlayerId, true);
  const movedRound = movedState.round!;
  const skippedOwnedPower =
    movedRound.pendingPower !== null && movedRound.pendingPower.ownerId === targetPlayerId
      ? movedRound.pendingPower
      : null;
  const transfer = movedRound.pendingTransfer;
  const activeWasRemoved = movedRound.activePlayerId === targetPlayerId;
  const snapWindow =
    activeWasRemoved && movedRound.snapWindow !== null
      ? null
      : movedRound.snapWindow === null
        ? null
        : {
            ...movedRound.snapWindow,
            attempts: movedRound.snapWindow.attempts.filter(
              (attempt) => attempt.playerId !== targetPlayerId,
            ),
          };
  let round: RoundState = {
    ...movedRound,
    dealerId:
      movedRound.dealerId === targetPlayerId
        ? nextSeatIdAfter(state.seats, targetPlayerId, seats)
        : movedRound.dealerId,
    pendingPower: skippedOwnedPower === null ? movedRound.pendingPower : null,
    pendingTransfer:
      transfer?.fromPlayerId === targetPlayerId || transfer?.toPlayerId === targetPlayerId
        ? null
        : transfer,
    snapWindow,
    cambio:
      movedRound.cambio === null
        ? null
        : {
            ...movedRound.cambio,
            finalTurnQueue: movedRound.cambio.finalTurnQueue.filter(
              (playerId) => playerId !== targetPlayerId,
            ),
          },
  };

  const events: DomainEvent[] = [removalEvent];
  if (skippedOwnedPower !== null) {
    events.push({
      type: "powerSkipped",
      ownerId: targetPlayerId,
      kind: skippedOwnedPower.kind,
      reason: "ownerRemoved",
    });
  }

  if (round.cambio?.callerId === targetPlayerId) {
    const ended = endRound(
      {
        ...movedState,
        seats,
        hostPlayerId,
        pauseReasons: baseState.pauseReasons,
        round,
      },
      "callerRemoved",
    );
    return accept(
      {
        ...ended.state,
        revision: state.revision + 1,
      },
      [...events, ...ended.events],
    );
  }

  if (round.phase === "openingPeek") {
    const remainingSeats = activeSeats(seats);
    if (remainingSeats.every((seat) => seat.openingPeekAcknowledged)) {
      const activePlayerId = nextActiveSeatId(remainingSeats, round.dealerId);
      round = {
        ...round,
        phase: "turnCycle",
        activePlayerId,
        turnStage: "turnStart",
      };
      events.push({
        type: "turnStarted",
        activePlayerId,
      });
    }
  }

  if (activeWasRemoved && round.phase === "turnCycle") {
    const advanced = advanceAfterRemovedActivePlayer(
      { ...movedState, seats, hostPlayerId, round },
      targetPlayerId,
    );
    round = advanced.round;
    events.push(...advanced.events);
  }

  if (round.cambio !== null && round.activePlayerId === null && round.phase === "turnCycle") {
    const ended = endRound(
      {
        ...movedState,
        seats,
        hostPlayerId,
        pauseReasons: baseState.pauseReasons,
        round,
      },
      "cambio",
    );
    return accept(
      {
        ...ended.state,
        revision: state.revision + 1,
      },
      [...events, ...ended.events],
    );
  }

  const revalidated = revalidatePendingPowerSelections({
    ...movedState,
    seats,
    hostPlayerId,
    pauseReasons: baseState.pauseReasons,
    round,
  });
  const turnResult =
    revalidated.state.round?.phase === "turnCycle" &&
    revalidated.state.round.turnStage === "resolving" &&
    !activeWasRemoved
      ? advanceAfterTurnResolution(revalidated.state)
      : { state: revalidated.state, events: [] };

  return accept(
    {
      ...turnResult.state,
      revision: state.revision + 1,
    },
    [...events, ...revalidated.events, ...turnResult.events],
  );
}

export function dealCards(state: MatchState): {
  readonly state: MatchState;
  readonly event: RoundDealtEvent;
} {
  const seats = activeSeats(state.seats);
  if (seats.length < 2) {
    throw new Error("dealCards requires at least two active seats");
  }

  const roundNumber = state.completedRounds + 1;
  const dealerResult =
    roundNumber === 1 || state.round === null
      ? randomDealer(state.randomState, seats)
      : rotateDealer(state.randomState, state.seats, state.round.dealerId);
  const shuffled = shuffle(createDeck().order, dealerResult.randomState);
  const deck = createDeck();
  const slotsByPlayer: Record<PlayerId, readonly CardSlot[]> = {};
  let deckOffset = 0;

  for (const seat of seats) {
    const dealtCards = shuffled.items.slice(
      deckOffset,
      deckOffset + STARTING_SLOT_POSITIONS.length,
    );
    slotsByPlayer[seat.playerId] = createStartingSlots(seat.playerId, dealtCards);
    deckOffset += STARTING_SLOT_POSITIONS.length;
  }

  const round: RoundState = {
    roundNumber,
    phase: "openingPeek",
    turnStage: null,
    dealerId: dealerResult.dealerId,
    activePlayerId: null,
    cards: deck.cards,
    drawPile: shuffled.items.slice(deckOffset),
    discardPile: [],
    slotsByPlayer,
    outOfPlay: [],
    drawnCard: null,
    pendingPower: null,
    snapWindow: null,
    pendingTransfer: null,
    cambio: null,
    endReason: null,
  };
  const nextState: MatchState = {
    ...state,
    status: "active",
    revision: state.revision + 1,
    randomState: shuffled.state,
    round,
  };

  return {
    state: nextState,
    event: {
      type: "roundDealt",
      roundNumber,
      dealerId: dealerResult.dealerId,
    },
  };
}

export function openingPeekSlots(round: RoundState, playerId: PlayerId): readonly CardSlot[] {
  return (round.slotsByPlayer[playerId] ?? []).filter(
    (slot) =>
      slot.kind === "starting" &&
      slot.position !== null &&
      OPENING_PEEK_POSITIONS.includes(slot.position),
  );
}

export function startingSlotId(playerId: PlayerId, position: StartingSlotPosition): SlotId {
  return `slot:${playerId}:starting:${position}`;
}

function createSeat(input: CreateSeatInput, seatIndex: number): SeatState {
  return {
    playerId: input.playerId,
    displayName: input.displayName,
    seatIndex,
    joinOrder: seatIndex,
    connection: "connected",
    sessionGeneration: 0,
    openingPeekAcknowledged: false,
    readyForNextRound: false,
    removalEligible: false,
    withdrawn: false,
  };
}

function createStartingSlots(playerId: PlayerId, cardIds: readonly CardId[]): readonly CardSlot[] {
  if (cardIds.length !== STARTING_SLOT_POSITIONS.length) {
    throw new Error("starting slots require exactly four cards");
  }

  return STARTING_SLOT_POSITIONS.map((position, index) => {
    const cardId = cardIds[index];
    if (cardId === undefined) {
      throw new Error("missing dealt card");
    }

    return {
      slotId: startingSlotId(playerId, position),
      kind: "starting",
      position,
      cardId,
    };
  });
}

function randomDealer(
  randomState: RandomState,
  seats: readonly SeatState[],
): {
  readonly dealerId: PlayerId;
  readonly randomState: RandomState;
} {
  const result = randomInt(randomState, seats.length);
  const seat = seats[result.value];
  if (seat === undefined) {
    throw new Error("dealer selection returned an out-of-range seat");
  }

  return {
    dealerId: seat.playerId,
    randomState: result.state,
  };
}

function rotateDealer(
  randomState: RandomState,
  seats: readonly SeatState[],
  previousDealerId: PlayerId,
): { readonly dealerId: PlayerId; readonly randomState: RandomState } {
  const orderedSeats = sortSeats(seats);
  const previousIndex = orderedSeats.findIndex((seat) => seat.playerId === previousDealerId);
  const startIndex = previousIndex === -1 ? 0 : previousIndex + 1;

  for (let offset = 0; offset < orderedSeats.length; offset += 1) {
    const seat = orderedSeats[(startIndex + offset) % orderedSeats.length];
    if (seat !== undefined && seat.connection !== "removed" && !seat.withdrawn) {
      return {
        dealerId: seat.playerId,
        randomState,
      };
    }
  }

  throw new Error("dealer rotation requires at least one active seat");
}

interface DrawSucceeded {
  readonly type: "drawSucceeded";
  readonly state: MatchState;
  readonly round: RoundState;
  readonly cardId: CardId;
  readonly events: readonly DomainEvent[];
}

interface DrawEndedRound {
  readonly type: "roundEnded";
  readonly state: MatchState;
  readonly events: readonly DomainEvent[];
}

type SharedDrawResult = DrawSucceeded | DrawEndedRound;

function drawFromSharedStock(state: MatchState, round: RoundState): SharedDrawResult {
  if (round.drawPile.length > 0) {
    const cardId = round.drawPile[0]!;
    return {
      type: "drawSucceeded",
      state,
      round: {
        ...round,
        drawPile: round.drawPile.slice(1),
      },
      cardId,
      events: [],
    };
  }

  if (round.discardPile.length > 1) {
    const discardTop = round.discardPile[0]!;
    const buriedCards = round.discardPile.slice(1);
    const shuffled = shuffle(buriedCards, state.randomState);
    const cardId = shuffled.items[0];
    if (cardId === undefined) {
      throw new Error("reshuffle draw requires a card");
    }

    return {
      type: "drawSucceeded",
      state: {
        ...state,
        randomState: shuffled.state,
      },
      round: {
        ...round,
        drawPile: shuffled.items.slice(1),
        discardPile: [discardTop],
      },
      cardId,
      events: [
        {
          type: "reshuffled",
          cardCount: buriedCards.length,
        },
      ],
    };
  }

  const ended = endRound(
    {
      ...state,
      round,
    },
    "stockExhausted",
  );

  return {
    type: "roundEnded",
    state: {
      ...ended.state,
      revision: state.revision + 1,
    },
    events: ended.events,
  };
}

function openNormalDiscardResolution(
  state: MatchState,
  round: RoundState,
  ownerId: PlayerId,
  discardedCardId: CardId,
): { readonly state: MatchState; readonly events: readonly DomainEvent[] } {
  const generation = state.snapWindowSequence + 1;
  const windowId: WindowId = `window:${round.roundNumber}:${generation}`;
  const timerId: TimerId = `timer:snap:${round.roundNumber}:${generation}`;
  const discardedCard = round.cards[discardedCardId]!;
  const kind = powerKind(discardedCard);
  const pendingPower: PendingPower | null =
    kind === null
      ? null
      : {
          ownerId,
          sourceCardId: discardedCardId,
          kind,
          stage: "offered",
          selections: [],
          revealedCardIds: [],
        };
  const snapWindow = {
    windowId,
    generation,
    triggerCardId: discardedCardId,
    triggerRank: discardedCard.rank,
    durationMs: state.config.snapWindowMs,
    remainingMs: state.config.snapWindowMs,
    timerId,
    attempts: [],
    resolvedBy: null,
  };
  const events: DomainEvent[] = [
    {
      type: "snapWindowOpened",
      windowId,
      generation,
      timerId,
      triggerCardId: discardedCardId,
      triggerRank: discardedCard.rank,
    },
  ];

  if (kind !== null) {
    events.push({
      type: "powerOffered",
      ownerId,
      sourceCardId: discardedCardId,
      kind,
    });
  }

  return {
    state: {
      ...state,
      snapWindowSequence: generation,
      lastResolvedSnapWindow: null,
      round: {
        ...round,
        pendingPower,
        snapWindow,
        turnStage: "resolving",
      },
    },
    events,
  };
}

export function advanceAfterTurnResolution(
  state: MatchState,
): { readonly state: MatchState; readonly events: readonly DomainEvent[] } {
  const round = state.round;
  if (round === null) {
    throw new Error("turn resolution requires an active round");
  }

  const completedPlayerId = round.activePlayerId;
  if (completedPlayerId === null) {
    return { state, events: [] };
  }

  if (
    round.pendingPower !== null ||
    round.snapWindow !== null ||
    round.pendingTransfer !== null ||
    state.pauseReasons.length > 0
  ) {
    return {
      state: {
        ...state,
        round: {
          ...round,
          turnStage: "resolving",
        },
      },
      events: [],
    };
  }

  if (round.cambio !== null) {
    const [queuedPlayerId, ...remainingQueue] = round.cambio.finalTurnQueue;
    const completedFinalTurns = [...round.cambio.completedFinalTurns, completedPlayerId];

    if (queuedPlayerId !== completedPlayerId) {
      throw new Error("completed final turn does not match the active queue entry");
    }

    const nextActivePlayerId = remainingQueue[0] ?? null;
    const nextRound: RoundState = {
      ...round,
      cambio: {
        ...round.cambio,
        finalTurnQueue: remainingQueue,
        completedFinalTurns,
      },
      activePlayerId: nextActivePlayerId,
      turnStage: nextActivePlayerId === null ? null : "turnStart",
    };
    const nextState: MatchState = {
      ...state,
      round: nextRound,
    };

    if (nextActivePlayerId === null) {
      return endRound(nextState, "cambio");
    }

    return {
      state: nextState,
      events: [
        {
          type: "turnAdvanced",
          previousPlayerId: completedPlayerId,
          activePlayerId: nextActivePlayerId,
        },
      ],
    };
  }

  const activePlayerId = nextActiveSeatId(activeSeats(state.seats), completedPlayerId);
  return {
    state: {
      ...state,
      round: {
        ...round,
        activePlayerId,
        turnStage: "turnStart",
      },
    },
    events: [
      {
        type: "turnAdvanced",
        previousPlayerId: completedPlayerId,
        activePlayerId,
      },
    ],
  };
}

function endRound(
  state: MatchState,
  reason: RoundEndReason,
): { readonly state: MatchState; readonly events: readonly [RoundEndedEvent] } {
  const round = state.round;
  if (round === null) {
    throw new Error("round end requires a round");
  }

  const eligiblePlayerIds = activeSeats(state.seats).map((seat) => seat.playerId);
  const rawScores = calculateRawScores(round.slotsByPlayer, round.cards, eligiblePlayerIds);
  const callerId = reason === "cambio" ? (round.cambio?.callerId ?? null) : null;
  const scores = scoreRound(rawScores, eligiblePlayerIds, reason, callerId);
  const cumulativeScores = scores.reduce<Record<PlayerId, number>>(
    (nextScores, score) => ({
      ...nextScores,
      [score.playerId]: (nextScores[score.playerId] ?? 0) + score.matchPoints,
    }),
    { ...state.cumulativeScores },
  );
  const endedRound: RoundState = {
    ...round,
    phase: "scoring",
    turnStage: null,
    activePlayerId: null,
    drawnCard: null,
    pendingPower: null,
    snapWindow: null,
    pendingTransfer: null,
    endReason: reason,
  };

  return {
    state: {
      ...state,
      status: "intermission",
      round: endedRound,
      cumulativeScores,
      completedRounds: state.completedRounds + 1,
    },
    events: [
      {
        type: "roundEnded",
        reason,
        scores,
      },
    ],
  };
}

function abandonMatch(
  state: MatchState,
  reason: Extract<RoundEndReason, "hostEnded" | "insufficientPlayers">,
): { readonly state: MatchState; readonly events: readonly [MatchAbandonedEvent] } {
  const round =
    state.round === null
      ? null
      : {
          ...state.round,
          phase: "complete" as const,
          turnStage: null,
          activePlayerId: null,
          drawnCard: null,
          pendingPower: null,
          snapWindow: null,
          pendingTransfer: null,
          endReason: reason,
        };

  return {
    state: {
      ...state,
      status: "abandoned",
      round,
    },
    events: [
      {
        type: "matchAbandoned",
        reason,
        cumulativeScores: state.cumulativeScores,
      },
    ],
  };
}

interface PowerOwnerAccepted {
  readonly ok: true;
  readonly round: RoundState;
  readonly power: PendingPower;
}

interface PowerOwnerRejected {
  readonly ok: false;
  readonly code: Extract<
    RejectionCode,
    "E_OUT_OF_PHASE" | "E_NO_PENDING_POWER" | "E_NOT_ACTIVE_PLAYER"
  >;
}

function requirePowerOwner(state: MatchState, actorId: PlayerId): PowerOwnerAccepted | PowerOwnerRejected {
  const round = state.round;
  if (state.status !== "active" || round === null || round.phase !== "turnCycle" || round.turnStage !== "resolving") {
    return { ok: false, code: "E_OUT_OF_PHASE" };
  }

  if (round.pendingPower === null) {
    return { ok: false, code: "E_NO_PENDING_POWER" };
  }

  if (round.pendingPower.ownerId !== actorId || round.activePlayerId !== actorId) {
    return { ok: false, code: "E_NOT_ACTIVE_PLAYER" };
  }

  return { ok: true, round, power: round.pendingPower };
}

type TargetRole = "own" | "opponent" | "any";

function expectedTargetRole(power: PendingPower): TargetRole | null {
  if (power.kind === "peekOwn") {
    return power.stage === "offered" || power.stage === "selectingFirst" ? "own" : null;
  }

  if (power.kind === "peekOpponent") {
    return power.stage === "offered" || power.stage === "selectingFirst" ? "opponent" : null;
  }

  if (power.kind === "blindSwap") {
    if (power.stage === "offered" || power.stage === "selectingFirst") {
      return "any";
    }

    return power.stage === "selectingSecond" && power.selections.length === 1 ? "any" : null;
  }

  if (power.kind === "blackKing") {
    if (power.stage === "offered" || power.stage === "selectingFirst") {
      return "own";
    }

    return power.stage === "selectingSecond" && hasOwnBlackKingSelection(power) ? "opponent" : null;
  }

  return null;
}

function targetMatchesRole(ownerId: PlayerId, targetPlayerId: PlayerId, role: TargetRole): boolean {
  if (role === "own") {
    return targetPlayerId === ownerId;
  }

  if (role === "opponent") {
    return targetPlayerId !== ownerId;
  }

  return true;
}

function appendPowerSelection(power: PendingPower, target: SlotRef): readonly SlotRef[] {
  if (power.kind !== "blackKing") {
    return [...power.selections, target];
  }

  const ownSelections = power.selections.filter((selection) => selection.playerId === power.ownerId);
  const opponentSelections = power.selections.filter((selection) => selection.playerId !== power.ownerId);
  return target.playerId === power.ownerId
    ? [target, ...opponentSelections]
    : [...ownSelections, target];
}

function hasOwnBlackKingSelection(power: PendingPower): boolean {
  return power.selections.some((selection) => selection.playerId === power.ownerId);
}

function occupiedSlotRef(round: RoundState, playerId: PlayerId, slotId: SlotId): SlotRef | null {
  const slot = (round.slotsByPlayer[playerId] ?? []).find((candidate) => candidate.slotId === slotId);
  if (slot?.cardId === undefined || slot.cardId === null) {
    return null;
  }

  return {
    playerId,
    slotId,
    cardId: slot.cardId,
  };
}

function slotExists(round: RoundState, playerId: PlayerId, slotId: SlotId): boolean {
  return (round.slotsByPlayer[playerId] ?? []).some((slot) => slot.slotId === slotId);
}

function occupiedSlots(round: RoundState, playerId: PlayerId): readonly CardSlot[] {
  return (round.slotsByPlayer[playerId] ?? []).filter((slot) => slot.cardId !== null);
}

function publicTarget(target: SlotRef | PublicSlotTarget): PublicSlotTarget {
  return {
    playerId: target.playerId,
    slotId: target.slotId,
  };
}

function allSelectionsValid(round: RoundState, selections: readonly SlotRef[]): boolean {
  return selections.every((selection) => isSelectionValid(round, selection));
}

function isSelectionValid(round: RoundState, selection: SlotRef): boolean {
  return occupiedSlotRef(round, selection.playerId, selection.slotId)?.cardId === selection.cardId;
}

function swapSelectedSlots(round: RoundState, first: SlotRef, second: SlotRef): RoundState | null {
  const firstCurrent = occupiedSlotRef(round, first.playerId, first.slotId);
  const secondCurrent = occupiedSlotRef(round, second.playerId, second.slotId);
  if (
    firstCurrent?.cardId !== first.cardId ||
    secondCurrent?.cardId !== second.cardId ||
    (first.playerId === second.playerId && first.slotId === second.slotId)
  ) {
    return null;
  }

  const firstSlots = (round.slotsByPlayer[first.playerId] ?? []).map((slot) =>
    slot.slotId === first.slotId ? { ...slot, cardId: second.cardId } : slot,
  );
  const secondSlots = (round.slotsByPlayer[second.playerId] ?? []).map((slot) =>
    slot.slotId === second.slotId ? { ...slot, cardId: first.cardId } : slot,
  );

  return {
    ...round,
    slotsByPlayer:
      first.playerId === second.playerId
        ? {
            ...round.slotsByPlayer,
            [first.playerId]: firstSlots.map((slot) =>
              slot.slotId === second.slotId ? { ...slot, cardId: first.cardId } : slot,
            ),
          }
        : {
            ...round.slotsByPlayer,
            [first.playerId]: firstSlots,
            [second.playerId]: secondSlots,
          },
  };
}

function placePenaltyCard(
  round: RoundState,
  playerId: PlayerId,
  cardId: CardId,
): { readonly round: RoundState; readonly slotId: SlotId } {
  const slots = round.slotsByPlayer[playerId] ?? [];
  const hole = slots.find((slot) => slot.cardId === null);

  if (hole !== undefined) {
    return {
      slotId: hole.slotId,
      round: {
        ...round,
        slotsByPlayer: {
          ...round.slotsByPlayer,
          [playerId]: slots.map((slot) =>
            slot.slotId === hole.slotId ? { ...slot, cardId } : slot,
          ),
        },
      },
    };
  }

  const penaltyIndex = slots.filter((slot) => slot.kind === "penalty").length + 1;
  const slotId: SlotId = `slot:${playerId}:penalty:${penaltyIndex}`;
  const penaltySlot: CardSlot = {
    slotId,
    kind: "penalty",
    position: null,
    cardId,
  };

  return {
    slotId,
    round: {
      ...round,
      slotsByPlayer: {
        ...round.slotsByPlayer,
        [playerId]: [...slots, penaltySlot],
      },
    },
  };
}

function revalidatePendingPowerSelections(state: MatchState): {
  readonly state: MatchState;
  readonly events: readonly DomainEvent[];
} {
  const round = state.round;
  const power = round?.pendingPower ?? null;
  if (round === null || power === null || power.selections.length === 0) {
    return { state, events: [] };
  }

  const invalidSelections = power.selections.filter((selection) => !isSelectionValid(round, selection));
  if (invalidSelections.length === 0) {
    return { state, events: [] };
  }

  const filteredPower: PendingPower = {
    ...power,
    selections: power.selections.filter((selection) => !invalidSelections.includes(selection)),
    revealedCardIds: power.revealedCardIds.filter(
      (cardId) => !invalidSelections.some((selection) => selection.cardId === cardId),
    ),
  };
  const nextPower = rebuildPowerAfterInvalidation(round, filteredPower, invalidSelections);
  const events: DomainEvent[] = [
    {
      type: "powerTargetInvalidated",
      ownerId: power.ownerId,
      kind: power.kind,
      targets: invalidSelections.map(publicTarget),
    },
  ];

  if (nextPower === null) {
    events.push({
      type: "powerSkipped",
      ownerId: power.ownerId,
      kind: power.kind,
      reason: "autoSkipped",
    });
  }

  return {
    state: {
      ...state,
      round: {
        ...round,
        pendingPower: nextPower,
      },
    },
    events,
  };
}

function rebuildPowerAfterInvalidation(
  round: RoundState,
  power: PendingPower,
  invalidSelections: readonly SlotRef[],
): PendingPower | null {
  if (invalidSelections.length === 0) {
    return power;
  }

  if (!hasLegalTargetForPower(round, power)) {
    return null;
  }

  if (power.kind === "peekOwn" || power.kind === "peekOpponent") {
    return {
      ...power,
      selections: [],
      revealedCardIds: [],
      stage: "selectingFirst",
    };
  }

  if (power.kind === "blindSwap") {
    return {
      ...power,
      revealedCardIds: [],
      stage: power.selections.length === 0 ? "selectingFirst" : "selectingSecond",
    };
  }

  const ownSelections = power.selections.filter((selection) => selection.playerId === power.ownerId);
  const opponentSelections = power.selections.filter((selection) => selection.playerId !== power.ownerId);
  if (ownSelections.length === 0) {
    return {
      ...power,
      selections: [],
      revealedCardIds: [],
      stage: "selectingFirst",
    };
  }

  if (opponentSelections.length === 0) {
    return {
      ...power,
      selections: ownSelections,
      revealedCardIds: [],
      stage: "selectingSecond",
    };
  }

  return {
    ...power,
    selections: [ownSelections[0]!, opponentSelections[0]!],
    revealedCardIds: [],
    stage: "awaitingKingDecision",
  };
}

function hasLegalTargetForPower(round: RoundState, power: PendingPower): boolean {
  if (power.kind === "peekOwn") {
    return occupiedSlots(round, power.ownerId).length > 0;
  }

  if (power.kind === "peekOpponent") {
    return otherActivePlayerIdsWithOccupiedSlots(round, power.ownerId).length > 0;
  }

  if (power.kind === "blindSwap") {
    const occupied = Object.values(round.slotsByPlayer).flatMap((slots) =>
      slots.flatMap((slot) => (slot.cardId === null ? [] : [{ playerId: "", slot }])),
    );
    if (power.selections.length === 0) {
      return occupied.length >= 2;
    }

    return Object.entries(round.slotsByPlayer).some(([playerId, slots]) =>
      slots.some(
        (slot) =>
          slot.cardId !== null &&
          !power.selections.some(
            (selection) => selection.playerId === playerId && selection.slotId === slot.slotId,
          ),
      ),
    );
  }

  const hasOwn = power.selections.some((selection) => selection.playerId === power.ownerId);
  const hasOpponent = power.selections.some((selection) => selection.playerId !== power.ownerId);
  const ownAvailable = occupiedSlots(round, power.ownerId).length > 0;
  const opponentAvailable = otherActivePlayerIdsWithOccupiedSlots(round, power.ownerId).length > 0;
  if (!hasOwn) {
    return ownAvailable && opponentAvailable;
  }

  return hasOpponent || opponentAvailable;
}

function otherActivePlayerIdsWithOccupiedSlots(round: RoundState, ownerId: PlayerId): readonly PlayerId[] {
  return Object.entries(round.slotsByPlayer)
    .filter(([playerId, slots]) => playerId !== ownerId && slots.some((slot) => slot.cardId !== null))
    .map(([playerId]) => playerId);
}

function canSendSnap(state: MatchState, playerId: PlayerId): boolean {
  const seat = state.seats.find((candidate) => candidate.playerId === playerId);
  return seat !== undefined && seat.connection === "connected" && !seat.withdrawn;
}

function moveRemovedCardsOutOfPlay(
  state: MatchState,
  targetPlayerId: PlayerId,
  includeDrawnCard: boolean,
): MatchState {
  const round = state.round;
  if (round === null) {
    return state;
  }

  const targetSlots = round.slotsByPlayer[targetPlayerId] ?? [];
  const removedCardIds = targetSlots.flatMap((slot) => (slot.cardId === null ? [] : [slot.cardId]));
  const drawnCardIds =
    includeDrawnCard && round.drawnCard?.playerId === targetPlayerId ? [round.drawnCard.cardId] : [];

  return {
    ...state,
    round: {
      ...round,
      slotsByPlayer: {
        ...round.slotsByPlayer,
        [targetPlayerId]: targetSlots.map((slot) => ({ ...slot, cardId: null })),
      },
      outOfPlay: [...round.outOfPlay, ...removedCardIds, ...drawnCardIds],
      drawnCard:
        includeDrawnCard && round.drawnCard?.playerId === targetPlayerId ? null : round.drawnCard,
    },
  };
}

function nextSeatIdAfter(
  originalSeats: readonly SeatState[],
  fromPlayerId: PlayerId,
  nextSeats: readonly SeatState[],
): PlayerId {
  const orderedOriginal = sortSeats(originalSeats);
  const fromIndex = orderedOriginal.findIndex((seat) => seat.playerId === fromPlayerId);
  for (let offset = 1; offset <= orderedOriginal.length; offset += 1) {
    const candidate = orderedOriginal[(fromIndex + offset + orderedOriginal.length) % orderedOriginal.length];
    if (
      candidate !== undefined &&
      nextSeats.some(
        (seat) =>
          seat.playerId === candidate.playerId &&
          seat.connection !== "removed" &&
          !seat.withdrawn,
      )
    ) {
      return candidate.playerId;
    }
  }

  throw new Error("next remaining seat requires an active seat");
}

function advanceAfterRemovedActivePlayer(
  state: MatchState,
  removedPlayerId: PlayerId,
): { readonly round: RoundState; readonly events: readonly DomainEvent[] } {
  const round = state.round;
  if (round === null) {
    throw new Error("active-player removal requires a round");
  }

  if (round.cambio !== null) {
    const nextActivePlayerId = round.cambio.finalTurnQueue[0] ?? null;
    return {
      round: {
        ...round,
        activePlayerId: nextActivePlayerId,
        turnStage: nextActivePlayerId === null ? null : "turnStart",
      },
      events:
        nextActivePlayerId === null
          ? []
          : [
              {
                type: "turnAdvanced",
                previousPlayerId: removedPlayerId,
                activePlayerId: nextActivePlayerId,
              },
            ],
    };
  }

  const activePlayerId = nextSeatIdAfter(state.seats, removedPlayerId, state.seats);
  return {
    round: {
      ...round,
      activePlayerId,
      turnStage: "turnStart",
      drawnCard: null,
      pendingPower: null,
      snapWindow: null,
      pendingTransfer: null,
    },
    events: [
      {
        type: "turnAdvanced",
        previousPlayerId: removedPlayerId,
        activePlayerId,
      },
    ],
  };
}

function orderedPlayerIdsAfter(
  seats: readonly SeatState[],
  fromPlayerId: PlayerId,
): readonly PlayerId[] {
  const seatsInOrder = activeSeats(seats);
  const fromIndex = seatsInOrder.findIndex((seat) => seat.playerId === fromPlayerId);
  if (fromIndex === -1) {
    return seatsInOrder.map((seat) => seat.playerId);
  }

  return seatsInOrder
    .slice(fromIndex + 1)
    .concat(seatsInOrder.slice(0, fromIndex + 1))
    .map((seat) => seat.playerId);
}

function rejectStaleOrPaused(
  state: MatchState,
  expectedRevision: number | undefined,
): RejectedTransition | null {
  if (expectedRevision !== undefined && expectedRevision !== state.revision) {
    return reject(state, "E_STALE_REVISION");
  }

  if (state.pauseReasons.length > 0) {
    return reject(state, "E_PAUSED");
  }

  return null;
}

function nextActiveSeatId(seats: readonly SeatState[], fromPlayerId: PlayerId): PlayerId {
  const orderedSeats = sortSeats(seats);
  const fromIndex = orderedSeats.findIndex((seat) => seat.playerId === fromPlayerId);
  const nextIndex = fromIndex === -1 ? 0 : (fromIndex + 1) % orderedSeats.length;
  const nextSeat = orderedSeats[nextIndex];
  if (nextSeat === undefined) {
    throw new Error("next seat requires at least one active seat");
  }

  return nextSeat.playerId;
}

export function activeSeats(seats: readonly SeatState[]): readonly SeatState[] {
  return sortSeats(seats.filter((seat) => seat.connection !== "removed" && !seat.withdrawn));
}

function sortSeats(seats: readonly SeatState[]): readonly SeatState[] {
  return [...seats].sort((left, right) => left.seatIndex - right.seatIndex);
}

function resetRoundSeatFlags(seats: readonly SeatState[]): readonly SeatState[] {
  return seats.map((seat) => ({
    ...seat,
    openingPeekAcknowledged: false,
    readyForNextRound: false,
  }));
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function reject(state: MatchState | null, code: RejectionCode): RejectedTransition {
  return {
    ok: false,
    state,
    code,
    events: [],
  };
}

function accept(state: MatchState, events: readonly DomainEvent[]): AcceptedTransition {
  assertInvariants(state);
  return {
    ok: true,
    state,
    events,
  };
}
