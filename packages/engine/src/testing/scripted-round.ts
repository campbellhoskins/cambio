import { createDeck } from "../deck.js";
import type { CardId } from "../model/cards.js";
import type { PlayerId } from "../model/ids.js";
import type { CardSlot, MatchState, RoundState } from "../model/state.js";
import { createSeededRng } from "../random.js";
import { STARTING_SLOT_POSITIONS, startingSlotId } from "../setup.js";
import { addLobbySeatForTesting, createLobbyMatchForTesting } from "./builders.js";

export interface ScriptedPlayerGrid {
  readonly playerId: PlayerId;
  readonly cards: readonly (CardId | null)[];
}

export interface ScriptedTurnCycleOptions {
  readonly playerIds: readonly PlayerId[];
  readonly activePlayerId?: PlayerId;
  readonly dealerId?: PlayerId;
  readonly seed?: number;
  readonly revision?: number;
  readonly roundNumber?: number;
  readonly roundCount?: number;
  readonly grids?: readonly ScriptedPlayerGrid[];
  readonly drawPile?: readonly CardId[];
  readonly discardPile?: readonly CardId[];
  readonly outOfPlay?: readonly CardId[];
  readonly snapWindowSequence?: number;
}

export function createScriptedTurnCycleMatchForTesting(
  options: ScriptedTurnCycleOptions,
): MatchState {
  if (options.playerIds.length < 2) {
    throw new Error("scripted turn-cycle state requires at least two players");
  }

  const seed = options.seed ?? 1;
  let state = createLobbyMatchForTesting({
    seed,
    config: {
      roundCount: options.roundCount ?? 9,
      playerCap: Math.max(2, options.playerIds.length),
    },
    host: {
      playerId: options.playerIds[0]!,
      displayName: displayName(options.playerIds[0]!),
    },
  });

  for (const playerId of options.playerIds.slice(1)) {
    state = addLobbySeatForTesting(state, {
      playerId,
      displayName: displayName(playerId),
    });
  }

  const deck = createDeck();
  const grids = options.grids ?? defaultGrids(options.playerIds, deck.order);
  const slotsByPlayer = Object.fromEntries(
    grids.map((grid) => [grid.playerId, createSlots(grid.playerId, grid.cards)]),
  );
  const usedCards = new Set<CardId>([
    ...(options.drawPile ?? defaultDrawPile(deck.order, grids)),
    ...(options.discardPile ?? []),
    ...(options.outOfPlay ?? []),
    ...grids.flatMap((grid) => grid.cards.filter((cardId): cardId is CardId => cardId !== null)),
  ]);
  const outOfPlay = options.outOfPlay ?? deck.order.filter((cardId) => !usedCards.has(cardId));
  const round: RoundState = {
    roundNumber: options.roundNumber ?? 1,
    phase: "turnCycle",
    turnStage: "turnStart",
    dealerId: options.dealerId ?? options.playerIds[0]!,
    activePlayerId: options.activePlayerId ?? options.playerIds[0]!,
    cards: deck.cards,
    drawPile: options.drawPile ?? defaultDrawPile(deck.order, grids),
    discardPile: options.discardPile ?? [],
    slotsByPlayer,
    outOfPlay,
    drawnCard: null,
    pendingPower: null,
    snapWindow: null,
    pendingTransfer: null,
    cambio: null,
    endReason: null,
  };

  return {
    ...state,
    status: "active",
    revision: options.revision ?? 1,
    randomState: createSeededRng(seed).state,
    snapWindowSequence: options.snapWindowSequence ?? 0,
    lastResolvedSnapWindow: null,
    round,
  };
}

function defaultGrids(
  playerIds: readonly PlayerId[],
  deckOrder: readonly CardId[],
): readonly ScriptedPlayerGrid[] {
  return playerIds.map((playerId, playerIndex) => ({
    playerId,
    cards: deckOrder.slice(
      playerIndex * STARTING_SLOT_POSITIONS.length,
      (playerIndex + 1) * STARTING_SLOT_POSITIONS.length,
    ),
  }));
}

function defaultDrawPile(
  deckOrder: readonly CardId[],
  grids: readonly ScriptedPlayerGrid[],
): readonly CardId[] {
  const gridCardIds = new Set(
    grids.flatMap((grid) => grid.cards.filter((cardId): cardId is CardId => cardId !== null)),
  );
  return deckOrder.filter((cardId) => !gridCardIds.has(cardId));
}

function createSlots(playerId: PlayerId, cards: readonly (CardId | null)[]): readonly CardSlot[] {
  if (cards.length !== STARTING_SLOT_POSITIONS.length) {
    throw new Error("scripted grids require exactly four starting slots");
  }

  return STARTING_SLOT_POSITIONS.map((position, index) => ({
    slotId: startingSlotId(playerId, position),
    kind: "starting",
    position,
    cardId: cards[index] ?? null,
  }));
}

function displayName(playerId: PlayerId): string {
  return playerId.charAt(0).toUpperCase() + playerId.slice(1);
}
