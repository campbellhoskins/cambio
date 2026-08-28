import { describe, expect, it } from "vitest";
import {
  AcknowledgeOpeningPeekCommandSchema,
  AcknowledgePowerRevealCommandSchema,
  AttemptSnapCommandSchema,
  CallCambioCommandSchema,
  ChooseTransferTargetCommandSchema,
  CommandEnvelopeSchema,
  CreateRoomCommandSchema,
  DecideBlackKingSwapCommandSchema,
  DiscardDrawnCommandSchema,
  DrawCardCommandSchema,
  HostEndMatchCommandSchema,
  HostRemovePlayerCommandSchema,
  JoinRoomCommandSchema,
  LeaveRoomCommandSchema,
  PROTOCOL_VERSION,
  PartialRoomConfigSchema,
  ReadyForNextRoundCommandSchema,
  ReselectPowerTargetCommandSchema,
  ResumeSessionCommandSchema,
  RejectionCodeSchema,
  ReplaceSlotCommandSchema,
  ServerMessageSchema,
  SkipPowerCommandSchema,
  StartMatchCommandSchema,
  StateSnapshotViewSchema,
  SelectPowerTargetCommandSchema,
  UpdateRoomConfigCommandSchema,
  ValidatedCommandEnvelopeSchema,
  checkProtocolVersion,
  type ServerMessage,
  type StateSnapshotView,
  type ValidatedCommandEnvelope,
} from "./index.js";

const schemas = [
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
] as const;

const envelopes = [
  env("createRoom", undefined, { displayName: "Alice", config: { playerCap: 4 } }),
  env("joinRoom", undefined, { roomCode: "ABCD", displayName: "Bob" }),
  env("updateRoomConfig", undefined, { config: { roundCount: 8, snapWindowMs: 6_000, playerCap: 5 } }),
  env("startMatch", undefined, {}),
  env("resumeSession", undefined, { roomCode: "ABCD", reconnectSecret: "secret" }),
  env("leaveRoom", undefined, {}),
  env("acknowledgeOpeningPeek", 1, {}),
  env("readyForNextRound", 1, {}),
  env("callCambio", 1, {}),
  env("drawCard", 1, {}),
  env("replaceSlot", 1, { slotId: "slot:alice:starting:topLeft" }),
  env("discardDrawn", 1, {}),
  env("skipPower", 1, {}),
  env("selectPowerTarget", 1, { targetPlayerId: "bob", slotId: "slot:bob:starting:topLeft" }),
  env("acknowledgePowerReveal", 1, {}),
  env("decideBlackKingSwap", 1, { decision: "confirm" }),
  env("reselectPowerTarget", 1, { targetPlayerId: "bob", slotId: "slot:bob:starting:topRight" }),
  env("attemptSnap", undefined, { snapWindowId: "window:1:1", generation: 1, targetPlayerId: "bob", slotId: "slot:bob:starting:topLeft" }),
  env("chooseTransferTarget", 1, { slotId: "slot:alice:starting:bottomLeft" }),
  env("hostRemovePlayer", 1, { targetPlayerId: "bob" }),
  env("hostEndMatch", 1, {}),
] as const;

describe("protocol command schemas", () => {
  it("validates every command against exactly one command schema", () => {
    for (const envelope of envelopes) {
      expect(ValidatedCommandEnvelopeSchema.parse(envelope).type).toBe(envelope.type);
      expect(schemas.filter((schema) => schema.safeParse(envelope).success)).toHaveLength(1);
    }
  });

  it("rejects unknown command types", () => {
    expect(ValidatedCommandEnvelopeSchema.safeParse(env("unknown", 1, {})).success).toBe(false);
    expect(CommandEnvelopeSchema.safeParse(env("unknown", 1, {})).success).toBe(true);
  });

  it("checks protocol version before payload validation", () => {
    const valid = { protocolVersion: PROTOCOL_VERSION, type: "drawCard", payload: "not payload" };
    const mismatched = { protocolVersion: PROTOCOL_VERSION + 1, type: "drawCard", payload: "not payload" };
    expect(checkProtocolVersion(valid)).toBe(true);
    expect(checkProtocolVersion(mismatched)).toEqual({ ok: false, code: "E_BAD_ENVELOPE", message: "incompatible protocol version" });
    expect(checkProtocolVersion(null)).toEqual({ ok: false, code: "E_BAD_ENVELOPE", message: "incompatible protocol version" });
    expect(checkProtocolVersion({ type: "drawCard" })).toEqual({ ok: false, code: "E_BAD_ENVELOPE", message: "incompatible protocol version" });
  });

  it("enforces room config limits", () => {
    expect(PartialRoomConfigSchema.safeParse({ playerCap: 2, roundCount: 1, snapWindowMs: 2_000 }).success).toBe(true);
    expect(PartialRoomConfigSchema.safeParse({ playerCap: 6, roundCount: 20, snapWindowMs: 10_000 }).success).toBe(true);
    expect(PartialRoomConfigSchema.safeParse({ playerCap: 1 }).success).toBe(false);
    expect(PartialRoomConfigSchema.safeParse({ roundCount: 21 }).success).toBe(false);
    expect(PartialRoomConfigSchema.safeParse({ snapWindowMs: 1_999 }).success).toBe(false);
  });

  it("requires snap shape and omits revision", () => {
    expect(AttemptSnapCommandSchema.safeParse(env("attemptSnap", undefined, { snapWindowId: "window:1:1", generation: 1, targetPlayerId: "alice", slotId: "slot:alice:starting:topLeft" })).success).toBe(true);
    expect(AttemptSnapCommandSchema.safeParse(env("attemptSnap", 1, { snapWindowId: "window:1:1", generation: 1, targetPlayerId: "alice", slotId: "slot:alice:starting:topLeft" })).success).toBe(false);
    expect(AttemptSnapCommandSchema.safeParse(env("attemptSnap", undefined, { targetPlayerId: "alice", slotId: "slot:alice:starting:topLeft" })).success).toBe(false);
  });

  it("exports z.infer-compatible DTO types", () => {
    const command: ValidatedCommandEnvelope = ValidatedCommandEnvelopeSchema.parse(env("drawCard", 1, {}));
    const view: StateSnapshotView = StateSnapshotViewSchema.parse({
      room: { roomId: "room-1", config: { roundCount: 9, snapWindowMs: 5_000, playerCap: 2 }, status: "lobby", hostPlayerId: "alice" },
      seats: [{ playerId: "alice", displayName: "Alice", seatIndex: 0, joinOrder: 0, connection: "connected", sessionGeneration: 0, isHost: true, openingPeekAcknowledged: false, readyForNextRound: false, removalEligible: false }],
      viewerSeatId: "alice",
      round: { roundNumber: null, phase: null, turnStage: null, dealerId: null, activePlayerId: null, endReason: null, cambio: null },
      piles: { drawPileCount: 0, discardPileCount: 0, outOfPlayCount: 0, discardTop: null },
      drawnCard: { state: "none" },
      grids: [],
      snapWindow: null,
      pendingPower: null,
      pendingTransfer: null,
      pauseReasons: [],
      scores: [{ playerId: "alice", cumulativeScore: 0 }],
      publicMovements: [],
      actionLog: [],
      legalActions: [],
    });
    const message: ServerMessage = ServerMessageSchema.parse({ type: "stateSnapshot", revision: 0, serverTime: { epochMs: 0, iso: "1970-01-01T00:00:00.000Z" }, view });
    expect(command.type).toBe("drawCard");
    expect(message.type).toBe("stateSnapshot");
  });

  it("includes every documented rejection code", () => {
    expect(RejectionCodeSchema.options).toEqual([
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
  });
});

function env(type: string, expectedRevision: number | undefined, payload: unknown): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: `cmd-${type}`,
    sessionGeneration: 0,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    type,
    payload,
  };
}
