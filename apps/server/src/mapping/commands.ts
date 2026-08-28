import type { EngineCommand, PlayerId } from "@cambio/engine";
import {
  ValidatedCommandEnvelopeSchema,
  checkProtocolVersion,
  type CommandType,
  type ProtocolError,
  type RejectionCode,
  type ServerMessage,
  type ValidatedCommandEnvelope,
} from "@cambio/protocol";

export interface UnsupportedProtocolCommand {
  readonly unsupported: true;
  readonly type: CommandType;
}

export interface RemovePlayerEngineCommand {
  readonly type: "removePlayer";
  readonly actorId: PlayerId;
  readonly targetPlayerId: PlayerId;
  readonly expectedRevision: number;
}

export type MappedEngineCommand = EngineCommand | RemovePlayerEngineCommand;

export function decodeEnvelope(raw: unknown): ValidatedCommandEnvelope | ProtocolError {
  const versionResult = checkProtocolVersion(raw);
  if (versionResult !== true) {
    return versionResult;
  }

  const parsed = ValidatedCommandEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "E_BAD_ENVELOPE",
      message: "malformed command envelope",
    };
  }

  return parsed.data;
}

export function mapProtocolCommandToEngineCommand(
  envelope: ValidatedCommandEnvelope,
  authenticatedSeatId: PlayerId,
): MappedEngineCommand | UnsupportedProtocolCommand {
  switch (envelope.type) {
    case "startMatch":
      return { type: "startMatch", actorId: authenticatedSeatId };
    case "acknowledgeOpeningPeek":
      return { type: "acknowledgeOpeningPeek", actorId: authenticatedSeatId, expectedRevision: envelope.expectedRevision };
    case "readyForNextRound":
      return { type: "readyForNextRound", actorId: authenticatedSeatId, expectedRevision: envelope.expectedRevision };
    case "callCambio":
      return { type: "callCambio", actorId: authenticatedSeatId, expectedRevision: envelope.expectedRevision };
    case "drawCard":
      return { type: "drawCard", actorId: authenticatedSeatId, expectedRevision: envelope.expectedRevision };
    case "replaceSlot":
      return { type: "replaceSlot", actorId: authenticatedSeatId, slotId: envelope.payload.slotId, expectedRevision: envelope.expectedRevision };
    case "discardDrawn":
      return { type: "discardDrawn", actorId: authenticatedSeatId, expectedRevision: envelope.expectedRevision };
    case "skipPower":
      return { type: "skipPower", actorId: authenticatedSeatId, expectedRevision: envelope.expectedRevision };
    case "selectPowerTarget":
      return { type: "selectPowerTarget", actorId: authenticatedSeatId, targetPlayerId: envelope.payload.targetPlayerId, slotId: envelope.payload.slotId, expectedRevision: envelope.expectedRevision };
    case "acknowledgePowerReveal":
      return { type: "acknowledgePowerReveal", actorId: authenticatedSeatId, expectedRevision: envelope.expectedRevision };
    case "decideBlackKingSwap":
      return { type: "decideBlackKingSwap", actorId: authenticatedSeatId, decision: envelope.payload.decision, expectedRevision: envelope.expectedRevision };
    case "reselectPowerTarget":
      return envelope.payload.targetPlayerId === undefined || envelope.payload.slotId === undefined
        ? { type: "reselectPowerTarget", actorId: authenticatedSeatId, expectedRevision: envelope.expectedRevision }
        : { type: "reselectPowerTarget", actorId: authenticatedSeatId, targetPlayerId: envelope.payload.targetPlayerId, slotId: envelope.payload.slotId, expectedRevision: envelope.expectedRevision };
    case "attemptSnap":
      return { type: "attemptSnap", actorId: authenticatedSeatId, windowId: envelope.payload.snapWindowId, generation: envelope.payload.generation, targetPlayerId: envelope.payload.targetPlayerId, slotId: envelope.payload.slotId };
    case "chooseTransferTarget":
      return { type: "chooseTransferTarget", actorId: authenticatedSeatId, slotId: envelope.payload.slotId, expectedRevision: envelope.expectedRevision };
    case "hostRemovePlayer":
      return { type: "removePlayer", actorId: authenticatedSeatId, targetPlayerId: envelope.payload.targetPlayerId, expectedRevision: envelope.expectedRevision };
    case "createRoom":
    case "joinRoom":
    case "updateRoomConfig":
    case "resumeSession":
    case "leaveRoom":
    case "hostEndMatch":
      return { unsupported: true, type: envelope.type };
  }
}

export function projectAcceptedCommand(envelope: ValidatedCommandEnvelope, revision: number): ServerMessage {
  return {
    type: "commandAccepted",
    commandId: envelope.commandId,
    revision,
    result: { commandType: envelope.type },
  };
}

export function projectRejection(commandId: string, revision: number, code: RejectionCode): ServerMessage {
  return { type: "commandRejected", commandId, revision, code };
}
