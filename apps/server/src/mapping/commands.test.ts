import { describe, expect, it } from "vitest";
import { reduceCommand, type EngineCommand } from "@cambio/engine";
import { createStateForTesting, protocolCommandFixtures } from "@cambio/testkit";
import { PROTOCOL_VERSION, type CommandType } from "@cambio/protocol";
import { decodeEnvelope, mapProtocolCommandToEngineCommand, projectAcceptedCommand, projectRejection } from "./index.js";

const engineBacked = [
  ["startMatch", undefined, {}, { type: "startMatch", actorId: "alice" }],
  ["acknowledgeOpeningPeek", 2, {}, { type: "acknowledgeOpeningPeek", actorId: "alice", expectedRevision: 2 }],
  ["readyForNextRound", 2, {}, { type: "readyForNextRound", actorId: "alice", expectedRevision: 2 }],
  ["callCambio", 2, {}, { type: "callCambio", actorId: "alice", expectedRevision: 2 }],
  ["drawCard", 2, {}, { type: "drawCard", actorId: "alice", expectedRevision: 2 }],
  ["replaceSlot", 2, { slotId: "slot:alice:starting:topLeft" }, { type: "replaceSlot", actorId: "alice", slotId: "slot:alice:starting:topLeft", expectedRevision: 2 }],
  ["discardDrawn", 2, {}, { type: "discardDrawn", actorId: "alice", expectedRevision: 2 }],
  ["skipPower", 2, {}, { type: "skipPower", actorId: "alice", expectedRevision: 2 }],
  ["selectPowerTarget", 2, { targetPlayerId: "bob", slotId: "slot:bob:starting:topLeft" }, { type: "selectPowerTarget", actorId: "alice", targetPlayerId: "bob", slotId: "slot:bob:starting:topLeft", expectedRevision: 2 }],
  ["acknowledgePowerReveal", 2, {}, { type: "acknowledgePowerReveal", actorId: "alice", expectedRevision: 2 }],
  ["decideBlackKingSwap", 2, { decision: "decline" }, { type: "decideBlackKingSwap", actorId: "alice", decision: "decline", expectedRevision: 2 }],
  ["reselectPowerTarget", 2, {}, { type: "reselectPowerTarget", actorId: "alice", expectedRevision: 2 }],
  ["reselectPowerTarget", 2, { targetPlayerId: "bob", slotId: "slot:bob:starting:topRight" }, { type: "reselectPowerTarget", actorId: "alice", targetPlayerId: "bob", slotId: "slot:bob:starting:topRight", expectedRevision: 2 }],
  ["attemptSnap", undefined, { snapWindowId: "window:1:1", generation: 1, targetPlayerId: "bob", slotId: "slot:bob:starting:topLeft" }, { type: "attemptSnap", actorId: "alice", windowId: "window:1:1", generation: 1, targetPlayerId: "bob", slotId: "slot:bob:starting:topLeft" }],
  ["chooseTransferTarget", 2, { slotId: "slot:alice:starting:bottomLeft" }, { type: "chooseTransferTarget", actorId: "alice", slotId: "slot:alice:starting:bottomLeft", expectedRevision: 2 }],
  ["hostRemovePlayer", 2, { targetPlayerId: "bob" }, { type: "removePlayer", actorId: "alice", targetPlayerId: "bob", expectedRevision: 2 }],
] as const;

describe("protocol command mapping", () => {
  it("decodes valid envelopes and maps every engine-backed command", () => {
    for (const [type, revision, payload, expected] of engineBacked) {
      const decoded = decodeEnvelope(envelope(type, revision, payload));
      expect("ok" in decoded).toBe(false);
      if ("ok" in decoded) {
        throw new Error(decoded.message);
      }
      expect(mapProtocolCommandToEngineCommand(decoded, "alice")).toEqual(expected);
    }
  });

  it("returns explicit unsupported markers for Phase 5 lobby/session commands", () => {
    for (const type of ["createRoom", "joinRoom", "updateRoomConfig", "resumeSession", "leaveRoom", "hostEndMatch"] as const) {
      const decoded = decodeEnvelope(envelope(type, type === "hostEndMatch" ? 1 : undefined, payloadFor(type)));
      expect("ok" in decoded).toBe(false);
      if ("ok" in decoded) {
        throw new Error(decoded.message);
      }
      expect(mapProtocolCommandToEngineCommand(decoded, "alice")).toEqual({ unsupported: true, type });
    }
  });

  it("checks protocol version before payload validation", () => {
    expect(decodeEnvelope({ protocolVersion: PROTOCOL_VERSION + 1, type: "drawCard", payload: "bad" })).toEqual({ ok: false, code: "E_BAD_ENVELOPE", message: "incompatible protocol version" });
    expect(decodeEnvelope({ protocolVersion: PROTOCOL_VERSION, type: "drawCard", payload: "bad" })).toEqual({ ok: false, code: "E_BAD_ENVELOPE", message: "malformed command envelope" });
  });

  it("projects accepted and rejected command acks through protocol schemas", () => {
    const decoded = decodeEnvelope(protocolCommandFixtures.drawCard);
    expect("ok" in decoded).toBe(false);
    if ("ok" in decoded) {
      throw new Error(decoded.message);
    }
    expect(projectAcceptedCommand(decoded, 3)).toEqual({ type: "commandAccepted", commandId: "cmd-draw-1", revision: 3, result: { commandType: "drawCard" } });
    expect(projectRejection("cmd-draw-1", 2, "E_STALE_REVISION")).toEqual({ type: "commandRejected", commandId: "cmd-draw-1", revision: 2, code: "E_STALE_REVISION" });
  });

  it("supports a decode to map to reduceCommand happy path", () => {
    const state = createStateForTesting({ activePlayerId: "alice", drawPile: ["spades:9"] });
    const decoded = decodeEnvelope(envelope("drawCard", state.revision, {}));
    expect("ok" in decoded).toBe(false);
    if ("ok" in decoded) {
      throw new Error(decoded.message);
    }
    const mapped = mapProtocolCommandToEngineCommand(decoded, "alice");
    expect("unsupported" in mapped).toBe(false);
    if ("unsupported" in mapped || mapped.type === "removePlayer") {
      throw new Error("expected EngineCommand");
    }
    const result = reduceCommand(state, mapped as EngineCommand);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.revision).toBe(state.revision + 1);
      expect(result.events.map((event) => event.type)).toEqual(["cardDrawn"]);
    }
  });
});

function envelope(type: CommandType, expectedRevision: number | undefined, payload: unknown): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: `cmd-${type}`,
    sessionGeneration: 0,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    type,
    payload,
  };
}

function payloadFor(type: CommandType): unknown {
  switch (type) {
    case "createRoom":
      return { displayName: "Alice" };
    case "joinRoom":
      return { roomCode: "ABCD", displayName: "Bob" };
    case "updateRoomConfig":
      return { config: { playerCap: 4 } };
    case "resumeSession":
      return { roomCode: "ABCD", reconnectSecret: "secret" };
    default:
      return {};
  }
}
