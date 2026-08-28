import { expect } from "vitest";
import { checkInvariants } from "../invariants.js";
import type { CardId } from "../model/cards.js";
import type { PlayerId, SlotId } from "../model/ids.js";
import type { MatchState, RoundState, StartingSlotPosition } from "../model/state.js";
import {
  acknowledgeOpeningPeek,
  expireSnapWindow,
  startingSlotId,
  type RejectionCode,
  type TransitionResult,
} from "../setup.js";
import {
  createScriptedTurnCycleMatchForTesting,
  type ScriptedPlayerGrid,
  type ScriptedTurnCycleOptions,
} from "./scripted-round.js";

export function grid(playerId: PlayerId, cards: readonly (CardId | null)[]): ScriptedPlayerGrid {
  return { playerId, cards };
}

export function slot(playerId: PlayerId, position: StartingSlotPosition): SlotId {
  return startingSlotId(playerId, position);
}

export function round(state: MatchState): RoundState {
  if (state.round === null) {
    throw new Error("expected round");
  }

  return state.round;
}

export function accepted(result: TransitionResult): Extract<TransitionResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.code);
  }

  expect(checkInvariants(result.state)).toEqual({ ok: true, violations: [] });
  return result;
}

export function assertRejected(
  result: TransitionResult,
  state: MatchState | null,
  code: RejectionCode,
  expectSameReference = true,
): void {
  expect(result).toEqual({
    ok: false,
    state,
    code,
    events: [],
  });
  if (expectSameReference) {
    expect(result.state).toBe(state);
  }
}

export function expireOpenSnap(state: MatchState): MatchState {
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

export function createTurnCycleMatch(
  options: Partial<Omit<ScriptedTurnCycleOptions, "playerIds">> & {
    readonly playerIds?: readonly PlayerId[];
  } = {},
): MatchState {
  const playerIds = options.playerIds ?? ["alice", "bob"];
  return createScriptedTurnCycleMatchForTesting({
    ...options,
    playerIds,
    activePlayerId: options.activePlayerId ?? playerIds[0]!,
    dealerId: options.dealerId ?? playerIds[0]!,
  });
}

export function acknowledgeAllOpeningPeeks(state: MatchState): MatchState {
  let next = state;
  for (const seat of state.seats) {
    if (seat.connection !== "removed" && !seat.withdrawn) {
      next = accepted(
        acknowledgeOpeningPeek(next, {
          type: "acknowledgeOpeningPeek",
          actorId: seat.playerId,
          expectedRevision: next.revision,
        }),
      ).state;
    }
  }

  return next;
}
