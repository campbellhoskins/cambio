export type RoomId = string;
export type PlayerId = string;
export type SlotId = string;
export type CommandId = string;
export type WindowId = string;
export type TimerId = string;

export interface SlotRef {
  readonly playerId: PlayerId;
  readonly slotId: SlotId;
  readonly cardId: string;
}
