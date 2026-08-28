import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createCambioServer } from "./app.js";
import { FakeClock } from "./clock.js";

describe("server app factory", () => {
  it("handles room lifecycle HTTP endpoints with generic errors", async () => {
    const clock = new FakeClock();
    const server = await createCambioServer({ clock, scheduler: clock, allowedOrigins: ["http://allowed.test"] });
    try {
      const forbidden = await server.app.inject({
        method: "POST",
        url: "/rooms",
        headers: { origin: "http://blocked.test" },
        payload: { displayName: "Alice" },
      });

      expect(forbidden.statusCode).toBe(403);

      const malformed = await server.app.inject({
        method: "POST",
        url: "/rooms",
        headers: { origin: "http://allowed.test" },
        payload: {},
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({ code: "E_BAD_ENVELOPE" });

      const created = await server.app.inject({
        method: "POST",
        url: "/rooms",
        headers: { origin: "http://allowed.test" },
        payload: { displayName: "Alice", config: { playerCap: 2 } },
      });
      expect(created.statusCode).toBe(200);
      const credential = created.json() as {
        readonly roomCode: string;
        readonly seatId: string;
        readonly reconnectSecret: string;
      };
      expect(credential.reconnectSecret).toEqual(expect.any(String));

      const joined = await server.app.inject({
        method: "POST",
        url: `/rooms/${credential.roomCode}/join`,
        headers: { origin: "http://allowed.test" },
        payload: { displayName: "Bob" },
      });
      expect(joined.statusCode).toBe(200);

      const full = await server.app.inject({
        method: "POST",
        url: `/rooms/${credential.roomCode}/join`,
        headers: { origin: "http://allowed.test" },
        payload: { displayName: "Carol" },
      });
      expect(full.statusCode).toBe(409);
      expect(full.json()).toEqual({ code: "E_ROOM_FULL" });

      const missing = await server.app.inject({
        method: "POST",
        url: "/rooms/MISSING/join",
        headers: { origin: "http://allowed.test" },
        payload: { displayName: "Carol" },
      });
      expect(missing.statusCode).toBe(404);

      const badResume = await server.app.inject({
        method: "POST",
        url: `/rooms/${credential.roomCode}/resume`,
        headers: { origin: "http://allowed.test" },
        payload: { seatId: credential.seatId, reconnectSecret: "bad" },
      });
      expect(badResume.statusCode).toBe(401);

      const resumed = await server.app.inject({
        method: "POST",
        url: `/rooms/${credential.roomCode}/resume`,
        headers: { origin: "http://allowed.test" },
        payload: { seatId: credential.seatId, reconnectSecret: credential.reconnectSecret },
      });
      expect(resumed.statusCode).toBe(200);
      expect(resumed.json().sessionGeneration).toBe(1);
    } finally {
      await server.app.close();
    }
  });

  it("allows same-process requests without an Origin allowlist", async () => {
    const server = await createCambioServer();
    try {
      const created = await server.app.inject({
        method: "POST",
        url: "/rooms",
        payload: { displayName: "Alice", config: { roundCount: 2, snapWindowMs: 3_000 } },
      });
      expect(created.statusCode).toBe(200);
      const credential = created.json() as { readonly roomCode: string };

      const badJoin = await server.app.inject({
        method: "POST",
        url: `/rooms/${credential.roomCode}/join`,
        payload: {},
      });
      expect(badJoin.statusCode).toBe(400);

      const badResume = await server.app.inject({
        method: "POST",
        url: `/rooms/${credential.roomCode}/resume`,
        payload: {},
      });
      expect(badResume.statusCode).toBe(400);
    } finally {
      await server.app.close();
    }
  });

  it("rejects stale websocket credentials", async () => {
    const clock = new FakeClock();
    const server = await createCambioServer({ clock, scheduler: clock });
    try {
      await server.app.listen({ port: 0, host: "127.0.0.1" });
      const address = server.app.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("server did not bind to a TCP port");
      }
      const base = `ws://127.0.0.1:${(address as AddressInfo).port}`;
      const created = await server.registry.createRoom({ displayName: "Alice" });
      if (typeof created === "string") {
        throw new Error(created);
      }

      expect(await closedSocket(`${base}/rooms/${created.roomCode}/ws`, {
        "x-seat-id": created.seatId,
        "x-reconnect-secret": created.reconnectSecret,
      })).toBe(1008);
      expect(await closedSocket(`${base}/rooms/${created.roomCode}/ws`, {
        "x-seat-id": created.seatId,
        "x-session-generation": "1",
        "x-reconnect-secret": created.reconnectSecret,
      })).toBe(1008);
    } finally {
      await server.app.close();
    }
  });

  it("rejects unauthorized sockets and sends generic protocol errors", async () => {
    const clock = new FakeClock();
    const server = await createCambioServer({ clock, scheduler: clock, allowedOrigins: ["http://allowed.test"], maxPayloadBytes: 64 });
    try {
      await server.app.listen({ port: 0, host: "127.0.0.1" });
      const address = server.app.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("server did not bind to a TCP port");
      }
      const base = `ws://127.0.0.1:${(address as AddressInfo).port}`;

      const missingAuth = await closedSocket(`${base}/rooms/MISSING/ws`, { origin: "http://allowed.test" });
      expect(missingAuth).toBe(1008);

      const created = await server.registry.createRoom({ displayName: "Alice" });
      if (typeof created === "string") {
        throw new Error(created);
      }
      const client = new WebSocket(`${base}/rooms/${created.roomCode}/ws`, {
        headers: {
          origin: "http://allowed.test",
          "x-seat-id": created.seatId,
          "x-session-generation": String(created.sessionGeneration),
          "x-reconnect-secret": created.reconnectSecret,
        },
      });
      await new Promise<void>((resolve, reject) => {
        client.on("open", resolve);
        client.on("error", reject);
      });
      const error = new Promise<unknown>((resolve) => {
        client.on("message", (data) => {
          const parsed = JSON.parse(data.toString()) as { readonly type: string };
          if (parsed.type === "error") {
            resolve(parsed);
          }
        });
      });
      client.send("{");
      await expect(error).resolves.toMatchObject({ type: "error", message: "Protocol error" });
      client.send("x".repeat(65));
      await expect(closed(client)).resolves.toBe(1009);
    } finally {
      await server.app.close();
    }
  });
});

async function closedSocket(url: string, headers: Record<string, string>): Promise<number> {
  const ws = new WebSocket(url, { headers });
  return closed(ws);
}

async function closed(ws: WebSocket): Promise<number> {
  return await new Promise((resolve, reject) => {
    ws.on("close", (code) => resolve(code));
    ws.on("error", reject);
  });
}
