import { z } from "zod";
import { CommandIdSchema, PlayerIdSchema, SlotIdSchema, WindowIdSchema } from "./common.js";
import { ProtocolVersionSchema } from "./version.js";

export const ROOM_CONFIG_LIMITS = {
  playerCap: { min: 2, max: 6 },
  roundCount: { min: 1, max: 20 },
  snapWindowMs: { min: 2_000, max: 10_000 },
} as const;

export const RoomConfigSchema = z.object({
  roundCount: z.number().int().min(ROOM_CONFIG_LIMITS.roundCount.min).max(ROOM_CONFIG_LIMITS.roundCount.max),
  snapWindowMs: z.number().int().min(ROOM_CONFIG_LIMITS.snapWindowMs.min).max(ROOM_CONFIG_LIMITS.snapWindowMs.max),
  playerCap: z.number().int().min(ROOM_CONFIG_LIMITS.playerCap.min).max(ROOM_CONFIG_LIMITS.playerCap.max),
}).strict();

export const PartialRoomConfigSchema = RoomConfigSchema.partial().strict();

const EmptyPayloadSchema = z.object({}).strict();
const BaseEnvelopeShape = {
  protocolVersion: ProtocolVersionSchema,
  commandId: CommandIdSchema,
  sessionGeneration: z.number().int().nonnegative(),
} as const;

function noRevisionCommand<TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
): z.ZodObject<{ readonly protocolVersion: typeof ProtocolVersionSchema; readonly commandId: typeof CommandIdSchema; readonly sessionGeneration: z.ZodNumber; readonly expectedRevision: z.ZodOptional<z.ZodNever>; readonly type: z.ZodLiteral<TType>; readonly payload: TPayload }> {
  return z.object({
    ...BaseEnvelopeShape,
    expectedRevision: z.never().optional(),
    type: z.literal(type),
    payload,
  }).strict();
}

function revisionCommand<TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
): z.ZodObject<{ readonly protocolVersion: typeof ProtocolVersionSchema; readonly commandId: typeof CommandIdSchema; readonly sessionGeneration: z.ZodNumber; readonly expectedRevision: z.ZodNumber; readonly type: z.ZodLiteral<TType>; readonly payload: TPayload }> {
  return z.object({
    ...BaseEnvelopeShape,
    expectedRevision: z.number().int().nonnegative(),
    type: z.literal(type),
    payload,
  }).strict();
}

const DisplayNameSchema = z.string().trim().min(1).max(32);

export const CreateRoomCommandSchema = noRevisionCommand(
  "createRoom",
  z.object({ displayName: DisplayNameSchema, config: PartialRoomConfigSchema.optional() }).strict(),
);
export const JoinRoomCommandSchema = noRevisionCommand(
  "joinRoom",
  z.object({ roomCode: z.string().trim().min(1).max(32), displayName: DisplayNameSchema }).strict(),
);
export const UpdateRoomConfigCommandSchema = noRevisionCommand(
  "updateRoomConfig",
  z.object({ config: PartialRoomConfigSchema }).strict(),
);
export const StartMatchCommandSchema = noRevisionCommand("startMatch", EmptyPayloadSchema);
export const ResumeSessionCommandSchema = noRevisionCommand(
  "resumeSession",
  z.object({ roomCode: z.string().trim().min(1).max(32), reconnectSecret: z.string().min(1) }).strict(),
);
export const LeaveRoomCommandSchema = noRevisionCommand("leaveRoom", EmptyPayloadSchema);
export const AcknowledgeOpeningPeekCommandSchema = revisionCommand("acknowledgeOpeningPeek", EmptyPayloadSchema);
export const ReadyForNextRoundCommandSchema = revisionCommand("readyForNextRound", EmptyPayloadSchema);
export const CallCambioCommandSchema = revisionCommand("callCambio", EmptyPayloadSchema);
export const DrawCardCommandSchema = revisionCommand("drawCard", EmptyPayloadSchema);
export const ReplaceSlotCommandSchema = revisionCommand("replaceSlot", z.object({ slotId: SlotIdSchema }).strict());
export const DiscardDrawnCommandSchema = revisionCommand("discardDrawn", EmptyPayloadSchema);
export const SkipPowerCommandSchema = revisionCommand("skipPower", EmptyPayloadSchema);
export const SelectPowerTargetCommandSchema = revisionCommand(
  "selectPowerTarget",
  z.object({ targetPlayerId: PlayerIdSchema, slotId: SlotIdSchema }).strict(),
);
export const AcknowledgePowerRevealCommandSchema = revisionCommand("acknowledgePowerReveal", EmptyPayloadSchema);
export const DecideBlackKingSwapCommandSchema = revisionCommand(
  "decideBlackKingSwap",
  z.object({ decision: z.enum(["confirm", "decline"]) }).strict(),
);
export const ReselectPowerTargetCommandSchema = revisionCommand(
  "reselectPowerTarget",
  z.object({ targetPlayerId: PlayerIdSchema.optional(), slotId: SlotIdSchema.optional() }).strict(),
);
export const AttemptSnapCommandSchema = noRevisionCommand(
  "attemptSnap",
  z.object({
    snapWindowId: WindowIdSchema,
    generation: z.number().int().nonnegative(),
    targetPlayerId: PlayerIdSchema,
    slotId: SlotIdSchema,
  }).strict(),
);
export const ChooseTransferTargetCommandSchema = revisionCommand(
  "chooseTransferTarget",
  z.object({ slotId: SlotIdSchema }).strict(),
);
export const HostRemovePlayerCommandSchema = revisionCommand(
  "hostRemovePlayer",
  z.object({ targetPlayerId: PlayerIdSchema }).strict(),
);
export const HostEndMatchCommandSchema = revisionCommand("hostEndMatch", EmptyPayloadSchema);

export const CommandEnvelopeSchema = z.object({
  protocolVersion: z.number().int(),
  commandId: CommandIdSchema,
  sessionGeneration: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative().optional(),
  type: z.string().min(1),
  payload: z.unknown(),
}).strict();

export const ValidatedCommandEnvelopeSchema = z.discriminatedUnion("type", [
  CreateRoomCommandSchema,
  JoinRoomCommandSchema,
  UpdateRoomConfigCommandSchema,
  StartMatchCommandSchema,
  ResumeSessionCommandSchema,
  LeaveRoomCommandSchema,
  AcknowledgeOpeningPeekCommandSchema,
  ReadyForNextRoundCommandSchema,
  CallCambioCommandSchema,
  DrawCardCommandSchema,
  ReplaceSlotCommandSchema,
  DiscardDrawnCommandSchema,
  SkipPowerCommandSchema,
  SelectPowerTargetCommandSchema,
  AcknowledgePowerRevealCommandSchema,
  DecideBlackKingSwapCommandSchema,
  ReselectPowerTargetCommandSchema,
  AttemptSnapCommandSchema,
  ChooseTransferTargetCommandSchema,
  HostRemovePlayerCommandSchema,
  HostEndMatchCommandSchema,
]);

export const CommandTypeSchema = z.enum([
  "createRoom",
  "joinRoom",
  "updateRoomConfig",
  "startMatch",
  "resumeSession",
  "leaveRoom",
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

export type RoomConfig = z.infer<typeof RoomConfigSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type ValidatedCommandEnvelope = z.infer<typeof ValidatedCommandEnvelopeSchema>;
export type CommandType = z.infer<typeof CommandTypeSchema>;
