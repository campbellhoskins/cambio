import type { MatchState, SeatState } from "../model/state.js";
import { createMatch, type CreateMatchCommand, type CreateSeatInput } from "../setup.js";

export function createLobbyMatchForTesting(
  overrides: Partial<Omit<CreateMatchCommand, "type" | "host">> & { readonly host?: CreateSeatInput } = {},
): MatchState {
  const command: CreateMatchCommand = {
    type: "createMatch",
    roomId: overrides.roomId ?? "room-1",
    host: overrides.host ?? { playerId: "player-1", displayName: "Player 1" },
    seed: overrides.seed ?? 1,
  };
  const result = createMatch(
    overrides.config === undefined
      ? command
      : {
          ...command,
          config: overrides.config,
        },
  );

  if (!result.ok) {
    throw new Error(result.code);
  }

  return result.state;
}

export function addLobbySeatForTesting(
  state: MatchState,
  input: CreateSeatInput,
  overrides: Partial<SeatState> = {},
): MatchState {
  const seatIndex = state.seats.length;
  const seat: SeatState = {
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
    ...overrides,
  };

  return {
    ...state,
    seats: [...state.seats, seat],
    cumulativeScores: {
      ...state.cumulativeScores,
      [seat.playerId]: state.cumulativeScores[seat.playerId] ?? 0,
    },
  };
}
