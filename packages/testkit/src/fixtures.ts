import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  ValidatedCommandEnvelopeSchema,
  type ServerMessage,
  type ValidatedCommandEnvelope,
} from "@cambio/protocol";

export const protocolCommandFixtures = {
  drawCard: ValidatedCommandEnvelopeSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    commandId: "cmd-draw-1",
    sessionGeneration: 0,
    expectedRevision: 3,
    type: "drawCard",
    payload: {},
  }),
  attemptSnap: ValidatedCommandEnvelopeSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    commandId: "cmd-snap-1",
    sessionGeneration: 0,
    type: "attemptSnap",
    payload: {
      snapWindowId: "window:1:1",
      generation: 1,
      targetPlayerId: "bob",
      slotId: "slot:bob:starting:topLeft",
    },
  }),
  updateRoomConfig: ValidatedCommandEnvelopeSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    commandId: "cmd-config-1",
    sessionGeneration: 0,
    type: "updateRoomConfig",
    payload: { config: { roundCount: 9, snapWindowMs: 5_000, playerCap: 4 } },
  }),
} satisfies Record<string, ValidatedCommandEnvelope>;

export const serverMessageFixtures = {
  commandAccepted: ServerMessageSchema.parse({
    type: "commandAccepted",
    commandId: "cmd-draw-1",
    revision: 4,
    result: { commandType: "drawCard" },
  }),
  commandRejected: ServerMessageSchema.parse({
    type: "commandRejected",
    commandId: "cmd-draw-1",
    revision: 3,
    code: "E_STALE_REVISION",
  }),
  error: ServerMessageSchema.parse({
    type: "error",
    message: "Protocol error",
  }),
} satisfies Record<string, ServerMessage>;
