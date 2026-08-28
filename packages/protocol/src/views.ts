import { z } from "zod";
import { CardSchema, PlayerIdSchema, RoomIdSchema, SlotIdSchema, SlotTargetSchema, WindowIdSchema } from "./common.js";
import { RoomConfigSchema } from "./commands.js";

export const MatchStatusSchema = z.enum(["lobby", "active", "intermission", "complete", "abandoned"]);
export const ConnectionStateSchema = z.enum(["connected", "disconnected", "removed"]);
export const RoundPhaseSchema = z.enum(["dealing", "openingPeek", "turnCycle", "scoring", "complete"]);
export const TurnStageSchema = z.enum(["turnStart", "drawn", "resolving"]);
export const SlotKindSchema = z.enum(["starting", "penalty"]);
export const StartingSlotPositionSchema = z.enum(["topLeft", "topRight", "bottomLeft", "bottomRight"]);
export const PowerKindSchema = z.enum(["peekOwn", "peekOpponent", "blindSwap", "blackKing"]);
export const PowerStageSchema = z.enum(["offered", "selectingFirst", "selectingSecond", "awaitingRevealAck", "awaitingKingDecision"]);
export const RoundEndReasonSchema = z.enum(["cambio", "stockExhausted", "callerRemoved", "hostEnded", "insufficientPlayers"]);

const SlotBaseSchema = z.object({
  slotId: SlotIdSchema,
  kind: SlotKindSchema,
  position: StartingSlotPositionSchema.nullable(),
});

export const HoleSlotViewSchema = SlotBaseSchema.extend({ state: z.literal("hole") }).strict();
export const HiddenSlotViewSchema = SlotBaseSchema.extend({ state: z.literal("hidden") }).strict();
export const RevealedSlotViewSchema = SlotBaseSchema.extend({ state: z.literal("revealed"), card: CardSchema }).strict();
export const SlotViewSchema = z.discriminatedUnion("state", [HoleSlotViewSchema, HiddenSlotViewSchema, RevealedSlotViewSchema]);

export const SeatViewSchema = z.object({
  playerId: PlayerIdSchema,
  displayName: z.string(),
  seatIndex: z.number().int().nonnegative(),
  joinOrder: z.number().int().nonnegative(),
  connection: ConnectionStateSchema,
  sessionGeneration: z.number().int().nonnegative(),
  isHost: z.boolean(),
  openingPeekAcknowledged: z.boolean(),
  readyForNextRound: z.boolean(),
  removalEligible: z.boolean(),
}).strict();

export const SeatGridViewSchema = z.object({
  playerId: PlayerIdSchema,
  slots: z.array(SlotViewSchema),
}).strict();

export const SnapWindowViewSchema = z.object({
  windowId: WindowIdSchema,
  generation: z.number().int().nonnegative(),
  remainingMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  resolvedBy: PlayerIdSchema.nullable(),
}).strict();

export const DrawnCardViewSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z.object({ state: z.literal("hidden"), playerId: PlayerIdSchema }).strict(),
  z.object({ state: z.literal("revealed"), playerId: PlayerIdSchema, card: CardSchema }).strict(),
]);

export const PendingPowerViewSchema = z.object({
  ownerId: PlayerIdSchema,
  kind: PowerKindSchema,
  stage: PowerStageSchema,
  selections: z.array(SlotTargetSchema),
}).strict();

export const PendingTransferViewSchema = z.object({
  fromPlayerId: PlayerIdSchema,
  toPlayerId: PlayerIdSchema,
  targetSlotId: SlotIdSchema,
}).strict();

export const ScoreViewSchema = z.object({
  playerId: PlayerIdSchema,
  cumulativeScore: z.number().int(),
  lastRoundRawScore: z.number().int().optional(),
  lastRoundMatchPoints: z.number().int().optional(),
  isRoundWinner: z.boolean().optional(),
}).strict();

export const PublicMovementViewSchema = z.object({
  type: z.enum(["blindSwap", "blackKingSwap", "snapRemoval", "transfer", "playerRemoval"]),
  actorId: PlayerIdSchema.optional(),
  targets: z.array(SlotTargetSchema),
}).strict();


export const ActionLogEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roundDealt"), roundNumber: z.number().int().positive(), dealerId: PlayerIdSchema }).strict(),
  z.object({ type: z.literal("openingPeekAcknowledged"), playerId: PlayerIdSchema, acknowledgedCount: z.number().int().nonnegative(), requiredCount: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("turnStarted"), activePlayerId: PlayerIdSchema }).strict(),
  z.object({ type: z.literal("cardDrawn"), playerId: PlayerIdSchema }).strict(),
  z.object({ type: z.literal("reshuffled"), cardCount: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("slotReplaced"), playerId: PlayerIdSchema, slotId: SlotIdSchema }).strict(),
  z.object({ type: z.literal("cardDiscarded"), playerId: PlayerIdSchema }).strict(),
  z.object({ type: z.literal("cambioCalled"), callerId: PlayerIdSchema, finalTurnQueue: z.array(PlayerIdSchema) }).strict(),
  z.object({ type: z.literal("turnAdvanced"), previousPlayerId: PlayerIdSchema, activePlayerId: PlayerIdSchema }).strict(),
  z.object({ type: z.literal("roundEnded"), reason: RoundEndReasonSchema, scores: z.array(z.object({ playerId: PlayerIdSchema, rawScore: z.number().int(), matchPoints: z.number().int(), isRoundWinner: z.boolean() }).strict()) }).strict(),
  z.object({ type: z.literal("readyForNextRound"), playerId: PlayerIdSchema, readyCount: z.number().int().nonnegative(), requiredCount: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("matchCompleted"), winners: z.array(PlayerIdSchema), cumulativeScores: z.record(PlayerIdSchema, z.number().int()) }).strict(),
  z.object({ type: z.literal("snapWindowOpened"), windowId: WindowIdSchema, generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("snapWindowClosed"), windowId: WindowIdSchema, generation: z.number().int().nonnegative(), resolvedBy: PlayerIdSchema.nullable() }).strict(),
  z.object({ type: z.literal("powerOffered"), ownerId: PlayerIdSchema, kind: PowerKindSchema }).strict(),
  z.object({ type: z.literal("powerSkipped"), ownerId: PlayerIdSchema, kind: PowerKindSchema, reason: z.enum(["skipped", "autoSkipped", "ownerRemoved"]) }).strict(),
  z.object({ type: z.literal("powerTargetSelected"), ownerId: PlayerIdSchema, kind: PowerKindSchema, target: SlotTargetSchema }).strict(),
  z.object({ type: z.literal("powerRevealed"), ownerId: PlayerIdSchema, recipientId: PlayerIdSchema, cardCount: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("powerRevealAcknowledged"), ownerId: PlayerIdSchema, kind: PowerKindSchema }).strict(),
  z.object({ type: z.literal("blackKingSwapDecided"), ownerId: PlayerIdSchema, confirmed: z.boolean(), swapped: z.boolean(), targets: z.array(SlotTargetSchema) }).strict(),
  z.object({ type: z.literal("powerTargetInvalidated"), ownerId: PlayerIdSchema, kind: PowerKindSchema, targets: z.array(SlotTargetSchema) }).strict(),
  z.object({ type: z.literal("snapAttempted"), playerId: PlayerIdSchema, target: SlotTargetSchema, correct: z.boolean(), receivedOrder: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("penaltyCardDrawn"), playerId: PlayerIdSchema, slotId: SlotIdSchema }).strict(),
  z.object({ type: z.literal("transferCompleted"), fromPlayerId: PlayerIdSchema, toPlayerId: PlayerIdSchema, fromSlotId: SlotIdSchema, toSlotId: SlotIdSchema }).strict(),
  z.object({ type: z.literal("playerRemoved"), playerId: PlayerIdSchema }).strict(),
  z.object({ type: z.literal("matchAbandoned"), reason: z.enum(["hostEnded", "insufficientPlayers"]), cumulativeScores: z.record(PlayerIdSchema, z.number().int()) }).strict(),
]);

export const LegalActionSchema = z.enum([
  "acknowledgeOpeningPeek",
  "readyForNextRound",
  "callCambio",
  "drawCard",
  "replaceSlot",
  "discardDrawn",
  "skipPower",
  "selectPowerTarget",
  "acknowledgePowerReveal",
  "decideBlackKingSwap",
  "reselectPowerTarget",
  "attemptSnap",
  "chooseTransferTarget",
  "hostRemovePlayer",
  "hostEndMatch",
]);

export const StateSnapshotViewSchema = z.object({
  room: z.object({ roomId: RoomIdSchema, config: RoomConfigSchema, status: MatchStatusSchema, hostPlayerId: PlayerIdSchema.nullable() }).strict(),
  seats: z.array(SeatViewSchema),
  viewerSeatId: PlayerIdSchema,
  round: z.object({
    roundNumber: z.number().int().positive().nullable(),
    phase: RoundPhaseSchema.nullable(),
    turnStage: TurnStageSchema.nullable(),
    dealerId: PlayerIdSchema.nullable(),
    activePlayerId: PlayerIdSchema.nullable(),
    endReason: RoundEndReasonSchema.nullable(),
    cambio: z.object({
      callerId: PlayerIdSchema,
      finalTurnQueue: z.array(PlayerIdSchema),
      completedFinalTurns: z.array(PlayerIdSchema),
    }).strict().nullable(),
  }).strict(),
  piles: z.object({
    drawPileCount: z.number().int().nonnegative(),
    discardPileCount: z.number().int().nonnegative(),
    outOfPlayCount: z.number().int().nonnegative(),
    discardTop: CardSchema.nullable(),
  }).strict(),
  drawnCard: DrawnCardViewSchema,
  grids: z.array(SeatGridViewSchema),
  snapWindow: SnapWindowViewSchema.nullable(),
  pendingPower: PendingPowerViewSchema.nullable(),
  pendingTransfer: PendingTransferViewSchema.nullable(),
  pauseReasons: z.array(PlayerIdSchema),
  scores: z.array(ScoreViewSchema),
  publicMovements: z.array(PublicMovementViewSchema),
  actionLog: z.array(ActionLogEntrySchema),
  legalActions: z.array(LegalActionSchema),
}).strict();

export type SlotView = z.infer<typeof SlotViewSchema>;
export type StateSnapshotView = z.infer<typeof StateSnapshotViewSchema>;
export type SeatView = z.infer<typeof SeatViewSchema>;
export type SeatGridView = z.infer<typeof SeatGridViewSchema>;
export type PublicMovementView = z.infer<typeof PublicMovementViewSchema>;
export type ActionLogEntry = z.infer<typeof ActionLogEntrySchema>;
export type LegalAction = z.infer<typeof LegalActionSchema>;
