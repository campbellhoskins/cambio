import { describe, expect, it } from "vitest";
import { SessionIssuer } from "./sessions.js";

describe("session issuer", () => {
  it("stores keyed digests, verifies in constant-time-compatible form, rotates, and revokes", () => {
    let now = 100;
    const issuer = new SessionIssuer({ key: Buffer.alloc(32, 7), nowMs: () => now });
    const issued = issuer.create("room-1", "alice");

    expect(issued.reconnectSecret).not.toContain(issued.record.secretDigest);
    expect(issuer.verify(issued.record, issued.reconnectSecret)).toBe(true);
    expect(issuer.verify(issued.record, "wrong")).toBe(false);

    now = 200;
    const rotated = issuer.rotate(issued.record);
    expect(rotated.record.sessionGeneration).toBe(1);
    expect(rotated.reconnectSecret).not.toBe(issued.reconnectSecret);
    expect(issuer.verify(rotated.record, rotated.reconnectSecret)).toBe(true);
    expect(issuer.verify(rotated.record, issued.reconnectSecret)).toBe(false);

    const revoked = issuer.revoke(rotated.record);
    expect(revoked.revokedAtMs).toBe(200);
    expect(issuer.verify(revoked, rotated.reconnectSecret)).toBe(false);
  });
});
