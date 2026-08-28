import {
  DEFAULT_ROOM_CONFIG,
  STARTING_SLOT_POSITIONS,
  createDeck,
  createSeededRng,
  startingSlotId,
  type CardId,
  type CardSlot,
  type MatchState,
  type PlayerId,
  type RoomConfig,
  type RoundState,
  type SeatState,
} from "@cambio/engine";

export interface GridInput {
  readonly playerId: PlayerId;
  readonly cards: readonly (CardId | null)[];
}

export interface MatchBuilderOptions {
  readonly playerIds?: readonly PlayerId[];
  readonly activePlayerId?: PlayerId;
  readonly dealerId?: PlayerId;
  readonly phase?: RoundState["phase"];
  readonly turnStage?: RoundState["turnStage"];
  readonly revision?: number;
  readonly config?: Partial<RoomConfig>;
  readonly grids?: readonly GridInput[];
  readonly drawPile?: readonly CardId[];
  readonly discardPile?: readonly CardId[];
  readonly outOfPlay?: readonly CardId[];
  readonly pauseReasons?: readonly PlayerId[];
}

export function grid(playerId: PlayerId, cards: readonly (CardId | null)[]): GridInput {
  return { playerId, cards };
}

export function createStateForTesting(options: MatchBuilderOptions = {}): MatchState {
  const playerIds = options.playerIds ?? ["alice", "bob"];
  const deck = createDeck();
  const config = { ...DEFAULT_ROOM_CONFIG, ...options.config };
  const grids = options.grids ?? defaultGrids(playerIds, deck.order);
  const gridAndDiscardCardIds = new Set<CardId>([
    ...grids.flatMap((gridInput) => gridInput.cards.filter((cardId): cardId is CardId => cardId !== null)),
    ...(options.discardPile ?? []),
  ]);
  const drawPile = options.drawPile ?? deck.order.filter((cardId) => !gridAndDiscardCardIds.has(cardId));
  const usedCardIds = new Set<CardId>([...gridAndDiscardCardIds, ...drawPile]);
  const outOfPlay = options.outOfPlay ?? deck.order.filter((cardId) => !usedCardIds.has(cardId));
  const round: RoundState = {
    roundNumber: 1,
    phase: options.phase ?? "turnCycle",
    turnStage: options.turnStage ?? "turnStart",
    dealerId: options.dealerId ?? playerIds[0]!,
    activePlayerId: options.activePlayerId ?? playerIds[0]!,
    cards: deck.cards,
    drawPile,
    discardPile: options.discardPile ?? [],
    slotsByPlayer: Object.fromEntries(grids.map((gridInput) => [gridInput.playerId, createSlots(gridInput)])),
    outOfPlay,
    drawnCard: null,
    pendingPower: null,
    snapWindow: null,
    pendingTransfer: null,
    cambio: null,
    endReason: null,
  };

  return {
    roomId: "room-1",
    config,
    status: "active",
    revision: options.revision ?? 1,
    randomState: createSeededRng(1).state,
    snapWindowSequence: 0,
    lastResolvedSnapWindow: null,
    hostPlayerId: playerIds[0]!,
    seats: playerIds.map((playerId, index) => createSeat(playerId, index)),
    round,
    cumulativeScores: Object.fromEntries(playerIds.map((playerId) => [playerId, 0])),
    completedRounds: 0,
    pauseReasons: options.pauseReasons ?? [],
  };
}

export function slotId(playerId: PlayerId, position: (typeof STARTING_SLOT_POSITIONS)[number]): string {
  return startingSlotId(playerId, position);
}

function createSeat(playerId: PlayerId, index: number): SeatState {
  return {
    playerId,
    displayName: playerId.charAt(0).toUpperCase() + playerId.slice(1),
    seatIndex: index,
    joinOrder: index,
    connection: "connected",
    sessionGeneration: 0,
    openingPeekAcknowledged: false,
    readyForNextRound: false,
    removalEligible: false,
    withdrawn: false,
  };
}

function createSlots(gridInput: GridInput): readonly CardSlot[] {
  if (gridInput.cards.length !== STARTING_SLOT_POSITIONS.length) {
    throw new Error("grid needs exactly four starting slot entries");
  }

  return STARTING_SLOT_POSITIONS.map((position, index) => ({
    slotId: startingSlotId(gridInput.playerId, position),
    kind: "starting" as const,
    position,
    cardId: gridInput.cards[index] ?? null,
  }));
}

function defaultGrids(playerIds: readonly PlayerId[], deckOrder: readonly CardId[]): readonly GridInput[] {
  return playerIds.map((playerId, index) => ({
    playerId,
    cards: deckOrder.slice(index * STARTING_SLOT_POSITIONS.length, (index + 1) * STARTING_SLOT_POSITIONS.length),
  }));
}
