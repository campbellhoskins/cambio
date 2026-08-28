import { z } from "zod";

export const PlayerIdSchema = z.string().min(1);
export const RoomIdSchema = z.string().min(1);
export const SlotIdSchema = z.string().min(1);
export const WindowIdSchema = z.string().min(1);
export const TimerIdSchema = z.string().min(1);
export const CommandIdSchema = z.string().min(1);

export const RankSchema = z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "JOKER"]);
export const SuitSchema = z.enum(["clubs", "diamonds", "hearts", "spades"]);

export const CardSchema = z.discriminatedUnion("rank", [
  z.object({ rank: z.literal("JOKER"), suit: z.null() }).strict(),
  z.object({ rank: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]), suit: SuitSchema }).strict(),
]);

export const SlotTargetSchema = z.object({
  playerId: PlayerIdSchema,
  slotId: SlotIdSchema,
}).strict();

export const ServerTimeSchema = z.object({
  epochMs: z.number().int().nonnegative(),
  iso: z.string().min(1),
}).strict();

export type PlayerId = z.infer<typeof PlayerIdSchema>;
export type RoomId = z.infer<typeof RoomIdSchema>;
export type SlotId = z.infer<typeof SlotIdSchema>;
export type WindowId = z.infer<typeof WindowIdSchema>;
export type CardView = z.infer<typeof CardSchema>;
export type SlotTarget = z.infer<typeof SlotTargetSchema>;
export type ServerTime = z.infer<typeof ServerTimeSchema>;
