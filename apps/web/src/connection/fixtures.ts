import { StateSnapshotViewSchema, type SeatView, type StateSnapshotView } from "@cambio/protocol";

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
