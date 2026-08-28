import { describe, expect, it } from "vitest";
import { createMemoryStorage, loadCredentials, publicDescriptors, upsertCredential } from "./credentials.js";
import type { SessionCredential } from "../connection/types.js";

const credential: SessionCredential = {
  roomId: "room-1",
  roomCode: "ABCD12",
  seatId: "alice",
  sessionGeneration: 0,
  reconnectSecret: "secret-token-that-must-stay-private",
  displayName: "Alice",
  updatedAt: 1,
};

describe("credential storage", () => {
  it("stores reconnect secrets only in local storage credentials", () => {
    const storage = createMemoryStorage();
    const stored = upsertCredential(storage, credential);

    expect(loadCredentials(storage)).toEqual(stored);
    expect(JSON.stringify(publicDescriptors(stored))).not.toContain(credential.reconnectSecret);
    expect(publicDescriptors(stored)[0]).toMatchObject({ roomCode: "ABCD12", displayName: "Alice" });
  });

  it("replaces a rotated credential for the same room and seat", () => {
    const storage = createMemoryStorage();
    upsertCredential(storage, credential);
    upsertCredential(storage, { ...credential, sessionGeneration: 1, reconnectSecret: "new-secret", updatedAt: 2 });

    const credentials = loadCredentials(storage);
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.sessionGeneration).toBe(1);
    expect(credentials[0]?.reconnectSecret).toBe("new-secret");
  });
});
