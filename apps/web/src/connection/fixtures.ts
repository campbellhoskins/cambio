import { StateSnapshotViewSchema, type CardView, type LegalAction, type SeatGridView, type SeatView, type StateSnapshotView } from "@cambio/protocol";

export interface LobbyFixtureOptions {
  readonly roomId?: string;
  readonly roomCode?: string;
  readonly revision?: number;
  readonly viewerSeatId?: string;
  readonly status?: StateSnapshotView["room"]["status"];
  readonly config?: Partial<StateSnapshotView["room"]["config"]>;
  readonly seats?: readonly SeatView[];
}

export function makeSeat(overrides: Partial<SeatView> & Pick<SeatView, "playerId" | "displayName" | "seatIndex">): SeatView {
  return {
    joinOrder: overrides.seatIndex,
    connection: "connected",
    sessionGeneration: 0,
    isHost: false,
    openingPeekAcknowledged: false,
    readyForNextRound: false,
    removalEligible: false,
    ...overrides,
  };
}

export function makeLobbyView(options: LobbyFixtureOptions = {}): StateSnapshotView {
  const seats = options.seats ?? [
    makeSeat({ playerId: "seat-alice", displayName: "Alice", seatIndex: 0, isHost: true }),
  ];
  const host = seats.find((seat) => seat.isHost)?.playerId ?? seats[0]?.playerId ?? null;
  const viewerSeatId = options.viewerSeatId ?? seats[0]?.playerId ?? "seat-alice";

  return StateSnapshotViewSchema.parse({
    room: {
      roomId: options.roomId ?? `room-${options.roomCode ?? "MOCK01"}`,
      config: {
        roundCount: options.config?.roundCount ?? 9,
        snapWindowMs: options.config?.snapWindowMs ?? 5_000,
        playerCap: options.config?.playerCap ?? 6,
      },
      status: options.status ?? "lobby",
      hostPlayerId: host,
    },
    seats,
    viewerSeatId,
    round: {
      roundNumber: null,
      phase: null,
      turnStage: null,
      dealerId: null,
      activePlayerId: null,
      endReason: null,
      cambio: null,
    },
    piles: {
      drawPileCount: 0,
      discardPileCount: 0,
      outOfPlayCount: 0,
      discardTop: null,
    },
    drawnCard: { state: "none" },
    grids: [],
    snapWindow: null,
    pendingPower: null,
    pendingTransfer: null,
    pauseReasons: [],
    scores: seats.map((seat) => ({ playerId: seat.playerId, cumulativeScore: 0 })),
    publicMovements: [],
    actionLog: [],
    legalActions: [],
  });
}

export interface GameFixtureOptions {
  readonly roomCode?: string;
  readonly viewerSeatId?: string;
  readonly seats?: readonly SeatView[];
  readonly status?: StateSnapshotView["room"]["status"];
  readonly phase?: StateSnapshotView["round"]["phase"];
  readonly turnStage?: StateSnapshotView["round"]["turnStage"];
  readonly activePlayerId?: string | null;
  readonly grids?: readonly SeatGridView[];
  readonly drawnCard?: StateSnapshotView["drawnCard"];
  readonly discardTop?: CardView | null;
  readonly legalActions?: readonly LegalAction[];
  readonly pendingPower?: StateSnapshotView["pendingPower"];
  readonly pendingTransfer?: StateSnapshotView["pendingTransfer"];
  readonly snapWindow?: StateSnapshotView["snapWindow"];
  readonly pauseReasons?: readonly string[];
  readonly scores?: StateSnapshotView["scores"];
  readonly actionLog?: StateSnapshotView["actionLog"];
  readonly cambio?: StateSnapshotView["round"]["cambio"];
  readonly endReason?: StateSnapshotView["round"]["endReason"];
}

export function makeGameView(options: GameFixtureOptions = {}): StateSnapshotView {
  const seats = options.seats ?? [
    makeSeat({ playerId: "seat-alice", displayName: "Alice", seatIndex: 0, isHost: true, openingPeekAcknowledged: true }),
    makeSeat({ playerId: "seat-bob", displayName: "Bob", seatIndex: 1, joinOrder: 1, openingPeekAcknowledged: true }),
  ];
  const viewerSeatId = options.viewerSeatId ?? seats[0]?.playerId ?? "seat-alice";
  const host = seats.find((seat) => seat.isHost)?.playerId ?? seats[0]?.playerId ?? null;
  const grids = options.grids ?? seats.map((seat) => makeGrid(seat.playerId, seat.playerId === viewerSeatId));

  return StateSnapshotViewSchema.parse({
    room: {
      roomId: `room-${options.roomCode ?? "MOCK01"}`,
      config: { roundCount: 1, snapWindowMs: 5_000, playerCap: 6 },
      status: options.status ?? "active",
      hostPlayerId: host,
    },
    seats,
    viewerSeatId,
    round: {
      roundNumber: 1,
      phase: options.phase ?? "turnCycle",
      turnStage: options.turnStage ?? "turnStart",
      dealerId: seats[0]?.playerId ?? null,
      activePlayerId: options.activePlayerId === undefined ? viewerSeatId : options.activePlayerId,
      endReason: options.endReason ?? null,
      cambio: options.cambio ?? null,
    },
    piles: {
      drawPileCount: 36,
      discardPileCount: options.discardTop === null ? 0 : 1,
      outOfPlayCount: 0,
      discardTop: options.discardTop === undefined ? card("7", "hearts") : options.discardTop,
    },
    drawnCard: options.drawnCard ?? { state: "none" },
    grids,
    snapWindow: options.snapWindow ?? null,
    pendingPower: options.pendingPower ?? null,
    pendingTransfer: options.pendingTransfer ?? null,
    pauseReasons: options.pauseReasons ?? [],
    scores: options.scores ?? seats.map((seat) => ({ playerId: seat.playerId, cumulativeScore: 0 })),
    publicMovements: [],
    actionLog: options.actionLog ?? [{ type: "roundDealt", roundNumber: 1, dealerId: seats[0]?.playerId ?? "seat-alice" }],
    legalActions: options.legalActions ?? [],
  });
}

export function makeGrid(playerId: string, revealBottom = false): SeatGridView {
  return {
    playerId,
    slots: [
      { slotId: `${playerId}-top-left`, kind: "starting", position: "topLeft", state: "hidden" },
      { slotId: `${playerId}-top-right`, kind: "starting", position: "topRight", state: "hidden" },
      revealBottom
        ? { slotId: `${playerId}-bottom-left`, kind: "starting", position: "bottomLeft", state: "revealed", card: card("5", "clubs") }
        : { slotId: `${playerId}-bottom-left`, kind: "starting", position: "bottomLeft", state: "hidden" },
      revealBottom
        ? { slotId: `${playerId}-bottom-right`, kind: "starting", position: "bottomRight", state: "revealed", card: card("K", "spades") }
        : { slotId: `${playerId}-bottom-right`, kind: "starting", position: "bottomRight", state: "hidden" },
      { slotId: `${playerId}-penalty-1`, kind: "penalty", position: null, state: "hidden" },
    ],
  };
}

export function card(rank: Exclude<CardView["rank"], "JOKER">, suit: Exclude<CardView, { readonly rank: "JOKER" }>["suit"]): CardView {
  return { rank, suit };
}
