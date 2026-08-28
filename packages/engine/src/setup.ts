import { createDeck } from "./deck.js";
import type { CardId } from "./model/cards.js";
import type { PlayerId, RoomId, SlotId } from "./model/ids.js";
import type {
  CardSlot,
  MatchState,
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
  | MatchCompletedEvent;

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

export type EngineCommand =
  | CreateMatchCommand
  | StartMatchCommand
  | AcknowledgeOpeningPeekCommand
  | DrawCardCommand
  | ReplaceSlotCommand
  | DiscardDrawnCommand
  | CallCambioCommand
  | ReadyForNextRoundCommand;

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

  const turnResult = advanceAfterTurnResolution(
    {
      ...state,
      round: nextRound,
    },
    command.actorId,
  );

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

  const turnResult = advanceAfterTurnResolution(
    {
      ...state,
      round: nextRound,
    },
    command.actorId,
  );

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

export function advanceAfterTurnResolution(
  state: MatchState,
  completedPlayerId: PlayerId,
): { readonly state: MatchState; readonly events: readonly DomainEvent[] } {
  const round = state.round;
  if (round === null) {
    throw new Error("turn resolution requires an active round");
  }

  if (round.pendingPower !== null || round.snapWindow !== null || round.pendingTransfer !== null) {
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
