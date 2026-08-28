import { z } from "zod";

export const RejectionCodeSchema = z.enum([
  "E_BAD_ENVELOPE",
  "E_UNAUTHORIZED",
  "E_STALE_SESSION",
  "E_ROOM_NOT_FOUND",
  "E_ROOM_FULL",
  "E_ROOM_STARTED",
  "E_NOT_HOST",
  "E_ALREADY_STARTED",
  "E_MIN_PLAYERS",
  "E_OUT_OF_PHASE",
  "E_NOT_ACTIVE_PLAYER",
  "E_STALE_REVISION",
  "E_DUPLICATE_COMMAND",
  "E_PAUSED",
  "E_NO_DRAWN_CARD",
  "E_SLOT_NOT_OCCUPIED",
  "E_SLOT_IS_HOLE",
  "E_NO_PENDING_POWER",
  "E_POWER_STAGE_MISMATCH",
  "E_TARGET_INVALID",
  "E_TARGET_NOT_DISTINCT",
  "E_STALE_SNAP_WINDOW",
  "E_SNAP_ALREADY_RESOLVED",
  "E_NO_TRANSFER_CARD",
  "E_NO_PENDING_TRANSFER",
  "E_CAMBIO_ALREADY_CALLED",
  "E_CAMBIO_NOT_ALLOWED",
  "E_NOT_REMOVAL_ELIGIBLE",
  "E_ALREADY_REMOVED",
  "E_INVALID_CONFIG",
  "E_CREDENTIAL_INVALID",
]);

export type RejectionCode = z.infer<typeof RejectionCodeSchema>;

export interface ProtocolError {
  readonly ok: false;
  readonly code: "E_BAD_ENVELOPE";
  readonly message: string;
}
