import type { RejectionCode } from "@cambio/protocol";

export const rejectionMessages: Record<RejectionCode, string> = {
  E_BAD_ENVELOPE: "That request was not understood. Refresh and try again.",
  E_UNAUTHORIZED: "This session is not authorized for that room.",
  E_STALE_SESSION: "This tab was replaced by a newer session.",
  E_ROOM_NOT_FOUND: "No retained room was found for that code.",
  E_ROOM_FULL: "That room is full.",
  E_ROOM_STARTED: "That room has already started.",
  E_NOT_HOST: "Only the host can do that.",
  E_ALREADY_STARTED: "The match has already started.",
  E_MIN_PLAYERS: "At least two players are required.",
  E_OUT_OF_PHASE: "That action is not available right now.",
  E_NOT_ACTIVE_PLAYER: "It is not your turn.",
  E_STALE_REVISION: "The room changed before that action arrived. Resyncing.",
  E_DUPLICATE_COMMAND: "That command was already submitted with different details.",
  E_PAUSED: "The room is paused until blocking players reconnect.",
  E_NO_DRAWN_CARD: "There is no drawn card to use.",
  E_SLOT_NOT_OCCUPIED: "Choose an occupied slot.",
  E_SLOT_IS_HOLE: "That slot is a hole.",
  E_NO_PENDING_POWER: "There is no pending power.",
  E_POWER_STAGE_MISMATCH: "That power choice is not available right now.",
  E_TARGET_INVALID: "That target is no longer valid.",
  E_TARGET_NOT_DISTINCT: "Choose two distinct targets.",
  E_STALE_SNAP_WINDOW: "That snap window has closed.",
  E_SNAP_ALREADY_RESOLVED: "That snap was already resolved.",
  E_NO_TRANSFER_CARD: "No transfer card is available.",
  E_NO_PENDING_TRANSFER: "There is no pending transfer.",
  E_CAMBIO_ALREADY_CALLED: "Cambio has already been called.",
  E_CAMBIO_NOT_ALLOWED: "Cambio is not available right now.",
  E_NOT_REMOVAL_ELIGIBLE: "That player is not removal eligible.",
  E_ALREADY_REMOVED: "That player was already removed.",
  E_INVALID_CONFIG: "Use valid lobby settings.",
  E_CREDENTIAL_INVALID: "That reconnect credential is no longer valid.",
};

export function friendlyError(code: RejectionCode | string): string {
  return code in rejectionMessages ? rejectionMessages[code as RejectionCode] : "Something went wrong. Try again.";
}
