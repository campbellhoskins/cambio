import { describe, expect, it } from "vitest";
import { ServerMessageSchema } from "@cambio/protocol";
import { assertNoEngineCardIdsOrCredentials, assertServerMessageSafe, protocolCommandFixtures, serverMessageFixtures } from "./index.js";
import { createStateForTesting, grid } from "./builders.js";

const state = createStateForTesting({
  grids: [
    grid("alice", ["clubs:A", "clubs:2", "clubs:3", "clubs:4"]),
    grid("bob", ["hearts:A", "hearts:2", "hearts:3", "hearts:4"]),
  ],
  discardPile: ["spades:K"],
});

describe("testkit fixtures and privacy scans", () => {
  it("exports protocol fixtures that satisfy schemas", () => {
    expect(protocolCommandFixtures.drawCard.type).toBe("drawCard");
    expect(serverMessageFixtures.commandRejected.type).toBe("commandRejected");
  });

  it("rejects engine card ids and credential-like keys", () => {
    expect(() => assertNoEngineCardIdsOrCredentials({ slot: "clubs:A" })).toThrow(/engine card id/);
    expect(() => assertNoEngineCardIdsOrCredentials({ reconnectSecret: "secret" })).toThrow(/credential-like/);
  });

  it("asserts non-snapshot message card entitlement", () => {
    const message = ServerMessageSchema.parse({
      type: "presentationEvent",
      revision: 1,
      payload: { type: "wrongSnapReveal", playerId: "alice", target: { playerId: "bob", slotId: "slot:bob:starting:topLeft" }, card: { rank: "A", suit: "hearts" } },
    });
    assertServerMessageSafe(message, state, "alice", ["hearts:A"]);
    expect(() => assertServerMessageSafe(message, state, "alice")).toThrow(/unexpected card/);
  });

  it("accepts stock server message fixtures", () => {
    for (const message of Object.values(serverMessageFixtures)) {
      expect(() => assertServerMessageSafe(message, state, "alice")).not.toThrow();
    }
  });
});
