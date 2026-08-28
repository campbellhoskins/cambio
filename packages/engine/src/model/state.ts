import type { CardCatalog, CardId, PowerKind, Rank } from "./cards.js";
import type { PlayerId, RoomId, SlotId, SlotRef, TimerId, WindowId } from "./ids.js";

export type RandomState = readonly number[];

export interface RoomConfig {
  readonly roundCount: number;
  readonly snapWindowMs: number;
  readonly playerCap: number;
}

export type ConnectionState = "connected" | "disconnected" | "removed";

export interface SeatState {
  readonly playerId: PlayerId;
  readonly displayName: string;
  readonly seatIndex: number;
  readonly joinOrder: number;
  readonly connection: ConnectionState;
  readonly sessionGeneration: number;
  readonly openingPeekAcknowledged: boolean;
  readonly readyForNextRound: boolean;
  readonly removalEligible: boolean;
  readonly withdrawn: boolean;
}

export type SlotKind = "starting" | "penalty";

export type StartingSlotPosition = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export interface CardSlot {
  readonly slotId: SlotId;
  readonly kind: SlotKind;
  readonly position: StartingSlotPosition | null;
  readonly cardId: CardId | null;
}

export type RoundEndReason =
  | "cambio"
  | "stockExhausted"
  | "callerRemoved"
  | "hostEnded"
  | "insufficientPlayers";

export type RoundPhase = "dealing" | "openingPeek" | "turnCycle" | "scoring" | "complete";

export type TurnStage = "turnStart" | "drawn" | "resolving";

export interface DrawnCard {
  readonly playerId: PlayerId;
  readonly cardId: CardId;
}

export type PowerStage =
  | "offered"
  | "selectingFirst"
  | "selectingSecond"
  | "awaitingRevealAck"
  | "awaitingKingDecision";

export interface PendingPower {
  readonly ownerId: PlayerId;
  readonly sourceCardId: CardId;
  readonly kind: PowerKind;
  readonly stage: PowerStage;
  readonly selections: readonly SlotRef[];
  readonly revealedCardIds: readonly CardId[];
}

export interface SnapAttempt {
  readonly playerId: PlayerId;
  readonly target: SlotRef;
  readonly correct: boolean;
  readonly receivedOrder: number;
}

export interface SnapWindow {
  readonly windowId: WindowId;
  readonly generation: number;
  readonly triggerCardId: CardId;
  readonly triggerRank: Rank;
  readonly durationMs: number;
  readonly remainingMs: number;
  readonly timerId: TimerId;
  readonly attempts: readonly SnapAttempt[];
  readonly resolvedBy: PlayerId | null;
}

export interface PendingTransfer {
  readonly fromPlayerId: PlayerId;
  readonly toPlayerId: PlayerId;
  readonly targetSlotId: SlotId;
}

export interface CambioState {
  readonly callerId: PlayerId;
  readonly finalTurnQueue: readonly PlayerId[];
  readonly completedFinalTurns: readonly PlayerId[];
}

export interface RoundState {
  readonly roundNumber: number;
  readonly phase: RoundPhase;
  readonly turnStage: TurnStage | null;
  readonly dealerId: PlayerId;
  readonly activePlayerId: PlayerId | null;
  readonly cards: CardCatalog;
  readonly drawPile: readonly CardId[];
  readonly discardPile: readonly CardId[];
  readonly slotsByPlayer: Readonly<Record<PlayerId, readonly CardSlot[]>>;
  readonly outOfPlay: readonly CardId[];
  readonly drawnCard: DrawnCard | null;
  readonly pendingPower: PendingPower | null;
  readonly snapWindow: SnapWindow | null;
  readonly pendingTransfer: PendingTransfer | null;
  readonly cambio: CambioState | null;
  readonly endReason: RoundEndReason | null;
}

export type MatchStatus = "lobby" | "active" | "intermission" | "complete" | "abandoned";

export interface MatchState {
  readonly roomId: RoomId;
  readonly config: RoomConfig;
  readonly status: MatchStatus;
  readonly revision: number;
  readonly randomState: RandomState;
  readonly hostPlayerId: PlayerId | null;
  readonly seats: readonly SeatState[];
  readonly round: RoundState | null;
  readonly cumulativeScores: Readonly<Record<PlayerId, number>>;
  readonly completedRounds: number;
  readonly pauseReasons: readonly PlayerId[];
}
