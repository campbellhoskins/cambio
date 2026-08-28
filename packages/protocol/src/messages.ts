import { z } from "zod";
import { CardSchema, CommandIdSchema, PlayerIdSchema, ServerTimeSchema, SlotTargetSchema } from "./common.js";
import { CommandTypeSchema } from "./commands.js";
import { RejectionCodeSchema } from "./errors.js";
import { StateSnapshotViewSchema } from "./views.js";

export const CommandResultSummarySchema = z.object({
  commandType: CommandTypeSchema,
}).strict();

export const PresentationEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wrongSnapReveal"), playerId: PlayerIdSchema, target: SlotTargetSchema, card: CardSchema }).strict(),
  z.object({ type: z.literal("reshuffled"), cardCount: z.number().int().nonnegative() }).strict(),
]);

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("commandAccepted"), commandId: CommandIdSchema, revision: z.number().int().nonnegative(), result: CommandResultSummarySchema }).strict(),
  z.object({ type: z.literal("commandRejected"), commandId: CommandIdSchema, revision: z.number().int().nonnegative(), code: RejectionCodeSchema }).strict(),
  z.object({ type: z.literal("stateSnapshot"), revision: z.number().int().nonnegative(), serverTime: ServerTimeSchema, view: StateSnapshotViewSchema }).strict(),
  z.object({ type: z.literal("presentationEvent"), revision: z.number().int().nonnegative(), payload: PresentationEventPayloadSchema }).strict(),
  z.object({ type: z.literal("error"), revision: z.number().int().nonnegative().optional(), message: z.string().min(1) }).strict(),
]);

export type CommandResultSummary = z.infer<typeof CommandResultSummarySchema>;
export type PresentationEventPayload = z.infer<typeof PresentationEventPayloadSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
