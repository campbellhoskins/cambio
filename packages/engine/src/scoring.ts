import { cardValue, type CardCatalog, type CardId } from "./model/cards.js";
import type { PlayerId } from "./model/ids.js";
import type { CardSlot, RoundEndReason } from "./model/state.js";

export interface RoundScore {
  readonly playerId: PlayerId;
  readonly rawScore: number;
  readonly matchPoints: number;
  readonly isRoundWinner: boolean;
}

export function calculateRawScore(slots: readonly CardSlot[], cards: CardCatalog): number {
  return slots.reduce((total, slot) => {
    if (slot.cardId === null) {
      return total;
    }

    return total + cardValue(cards[slot.cardId]!);
  }, 0);
}

export function calculateRawScores(
  slotsByPlayer: Readonly<Record<PlayerId, readonly CardSlot[]>>,
  cards: CardCatalog,
  eligiblePlayerIds: readonly PlayerId[],
): Readonly<Record<PlayerId, number>> {
  return Object.fromEntries(
    eligiblePlayerIds.map((playerId) => [
      playerId,
      calculateRawScore(slotsByPlayer[playerId] ?? [], cards),
    ]),
  );
}

export function scoreRound(
  rawScores: Readonly<Record<PlayerId, number>>,
  eligiblePlayerIds: readonly PlayerId[],
  endReason: RoundEndReason,
  callerId: PlayerId | null,
): readonly RoundScore[] {
  if (eligiblePlayerIds.length === 0) {
    return [];
  }

  const values = eligiblePlayerIds.map((playerId) => rawScores[playerId]!);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const lowestPlayers = eligiblePlayerIds.filter((playerId) => rawScores[playerId] === lowest);

  return eligiblePlayerIds.map((playerId) => {
    const rawScore = rawScores[playerId]!;
    let matchPoints = rawScore;

    if (endReason === "hostEnded" || endReason === "insufficientPlayers") {
      matchPoints = 0;
    }

    if (endReason === "cambio" && playerId === callerId) {
      if (lowestPlayers.length === 1 && lowestPlayers[0] === callerId) {
        matchPoints = 0;
      } else if (!lowestPlayers.includes(callerId)) {
        matchPoints = highest * 2;
      }
    }

    return {
      playerId,
      rawScore,
      matchPoints,
      isRoundWinner: rawScore === lowest,
    };
  });
}

export function cumulativeWinners(
  cumulativeScores: Readonly<Record<PlayerId, number>>,
  eligiblePlayerIds: readonly PlayerId[],
): readonly PlayerId[] {
  if (eligiblePlayerIds.length === 0) {
    return [];
  }

  const lowest = Math.min(...eligiblePlayerIds.map((playerId) => cumulativeScores[playerId] ?? 0));
  return eligiblePlayerIds.filter((playerId) => (cumulativeScores[playerId] ?? 0) === lowest);
}

export function occupiedCardIds(slots: readonly CardSlot[]): readonly CardId[] {
  return slots.flatMap((slot) => (slot.cardId === null ? [] : [slot.cardId]));
}
