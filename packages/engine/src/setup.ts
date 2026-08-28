import { createDeck } from "./deck.js";
import type { CardId } from "./model/cards.js";
import type { PlayerId, RoomId, SlotId } from "./model/ids.js";
import type {
  CardSlot,
  MatchState,
  RandomState,
  RoomConfig,
  RoundState,
  SeatState,
  StartingSlotPosition,
} from "./model/state.js";
import { createSeededRng, randomInt, shuffle } from "./random.js";

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  roundCount: 9,
  snapWindowMs: 5_000,
  playerCap: 6,
};

export const OPENING_PEEK_POSITIONS: readonly StartingSlotPosition[] = ["bottomLeft", "bottomRight"];

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

export type DomainEvent = RoundDealtEvent | OpeningPeekAcknowledgedEvent | TurnStartedEvent;

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

export type EngineCommand = CreateMatchCommand | StartMatchCommand | AcknowledgeOpeningPeekCommand;

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

  return {
    ok: true,
    state,
    events: [],
  };
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

  return {
    ok: true,
    state: dealt.state,
    events: [dealt.event],
  };
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
    return {
      ok: true,
      state,
      events: [],
    };
  }

  const seats = state.seats.map((candidate) =>
    candidate.playerId === command.actorId ? { ...candidate, openingPeekAcknowledged: true } : candidate,
  );
  const requiredSeats = activeSeats(seats);
  const acknowledgedCount = requiredSeats.filter((candidate) => candidate.openingPeekAcknowledged).length;
  const acknowledgementEvent: OpeningPeekAcknowledgedEvent = {
    type: "openingPeekAcknowledged",
    playerId: command.actorId,
    acknowledgedCount,
    requiredCount: requiredSeats.length,
  };

  if (acknowledgedCount !== requiredSeats.length) {
    return {
      ok: true,
      state: {
        ...state,
        revision: state.revision + 1,
        seats,
      },
      events: [acknowledgementEvent],
    };
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

  return {
    ok: true,
    state: nextState,
    events: [
      acknowledgementEvent,
      {
        type: "turnStarted",
        activePlayerId,
      },
    ],
  };
}

export function dealCards(state: MatchState): { readonly state: MatchState; readonly event: RoundDealtEvent } {
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
    const dealtCards = shuffled.items.slice(deckOffset, deckOffset + STARTING_SLOT_POSITIONS.length);
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
    (slot) => slot.kind === "starting" && slot.position !== null && OPENING_PEEK_POSITIONS.includes(slot.position),
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

function randomDealer(randomState: RandomState, seats: readonly SeatState[]): {
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

function activeSeats(seats: readonly SeatState[]): readonly SeatState[] {
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
