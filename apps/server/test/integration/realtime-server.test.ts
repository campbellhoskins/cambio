import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type ServerMessage } from "@cambio/protocol";
import { assertServerMessageSafe } from "@cambio/testkit";
import { createCambioServer, FakeClock } from "../../src/index.js";
import type { CambioServer } from "../../src/app.js";

const servers: CambioServer[] = [];

describe("real-time server integration", () => {
  afterEach(async () => {
    await Promise.all(servers.map((server) => server.app.close()));
    servers.length = 0;
  });

  it("creates, joins, plays through a scored round, and rejects duplicates/stale sessions", async () => {
    const clock = new FakeClock();
    const server = await createCambioServer({ clock, scheduler: clock, allowedOrigins: ["http://localhost"] });
    servers.push(server);
    await server.app.listen({ port: 0, host: "127.0.0.1" });
    const address = server.app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("server did not bind to a TCP port");
    }
    const boundAddress: AddressInfo = address;
    const base = `http://127.0.0.1:${boundAddress.port}`;

    const alice = await postCredential(base, "/rooms", { displayName: "Alice", config: { roundCount: 1, snapWindowMs: 2_000, playerCap: 2 } });
    const bob = await postCredential(base, `/rooms/${alice.roomCode}/join`, { displayName: "Bob" });
    const actor = await server.registry.getActorByCode(alice.roomCode);
    if (actor === null) {
      throw new Error("missing actor");
    }

    const aliceClient = await connectClient(base, alice);
    const bobClient = await connectClient(base, bob);
    await Promise.all([aliceClient.next("stateSnapshot"), bobClient.next("stateSnapshot")]);

    aliceClient.send(command("startMatch", "start", alice.sessionGeneration, {}));
    await aliceClient.next("commandAccepted");

    let state = actor.snapshot();
    for (const seat of state.seats) {
      clientFor(seat.playerId, alice, aliceClient, bobClient).send(command("acknowledgeOpeningPeek", `ack-${seat.playerId}`, 0, {}, state.revision));
      await clientFor(seat.playerId, alice, aliceClient, bobClient).next("commandAccepted");
      state = actor.snapshot();
    }

    const callerId = state.round?.activePlayerId;
    if (callerId === undefined || callerId === null) {
      throw new Error("missing active player");
    }
    clientFor(callerId, alice, aliceClient, bobClient).send(command("callCambio", "cambio", 0, {}, state.revision));
    await clientFor(callerId, alice, aliceClient, bobClient).next("commandAccepted");
    state = actor.snapshot();

    const finalPlayerId = state.round?.activePlayerId;
    if (finalPlayerId === undefined || finalPlayerId === null) {
      throw new Error("missing final player");
    }
    const finalClient = clientFor(finalPlayerId, alice, aliceClient, bobClient);
    finalClient.send(command("drawCard", "final-draw", 0, {}, state.revision));
    await finalClient.next("commandAccepted");
    state = actor.snapshot();
    finalClient.send(command("discardDrawn", "final-discard", 0, {}, state.revision));
    await finalClient.next("commandAccepted");
    await settleResolution(actor, finalClient, clock);

    state = actor.snapshot();
    if (state.status === "intermission") {
      for (const seat of state.seats) {
        clientFor(seat.playerId, alice, aliceClient, bobClient).send(command("readyForNextRound", `ready-${seat.playerId}`, 0, {}, state.revision));
        await clientFor(seat.playerId, alice, aliceClient, bobClient).next("commandAccepted");
        state = actor.snapshot();
      }
    }
    expect(state.status).toBe("complete");
    expect(state.completedRounds).toBe(1);
    expect(Object.keys(state.cumulativeScores)).toHaveLength(2);

    const latestAliceSnapshot = aliceClient.messages.filter((message) => message.type === "stateSnapshot").at(-1);
    const latestBobSnapshot = bobClient.messages.filter((message) => message.type === "stateSnapshot").at(-1);
    if (latestAliceSnapshot?.type !== "stateSnapshot" || latestBobSnapshot?.type !== "stateSnapshot") {
      throw new Error("missing final snapshots");
    }
    assertServerMessageSafe(latestAliceSnapshot, state, alice.seatId);
    assertServerMessageSafe(latestBobSnapshot, state, bob.seatId);

    aliceClient.send(command("startMatch", "start", 0, {}));
    expect(await aliceClient.next("commandAccepted")).toMatchObject({ type: "commandAccepted" });
    aliceClient.send(command("hostEndMatch", "start", 0, {}, state.revision));
    expect(await aliceClient.next("commandRejected")).toMatchObject({ type: "commandRejected", code: "E_DUPLICATE_COMMAND" });
    aliceClient.send(command("drawCard", "stale", 99, {}, state.revision));
    expect(await aliceClient.next("commandRejected")).toMatchObject({ type: "commandRejected", code: "E_STALE_SESSION" });

    aliceClient.ws.close();
    bobClient.ws.close();
  });
});

async function settleResolution(
  actor: NonNullable<Awaited<ReturnType<CambioServer["registry"]["getActorByCode"]>>>,
  activeClient: TestClient,
  clock: FakeClock,
): Promise<void> {
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const state = actor.snapshot();
    if (state.status === "complete" || state.status === "intermission") {
      return;
    }

    if (state.round?.pendingPower?.stage === "offered") {
      activeClient.send(command("skipPower", `skip-${attempts}`, 0, {}, state.revision));
      await activeClient.next("commandAccepted");
    }

    if (actor.snapshot().round?.snapWindow !== null) {
      await clock.advanceBy(2_000);
    }
  }
}

interface Credential {
  readonly roomId: string;
  readonly roomCode: string;
  readonly seatId: string;
  readonly sessionGeneration: number;
  readonly reconnectSecret: string;
}

interface TestClient {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[];
  next(type: ServerMessage["type"]): Promise<ServerMessage>;
  send(payload: unknown): void;
}

async function postCredential(base: string, path: string, body: unknown): Promise<Credential> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return await response.json() as Credential;
}

async function connectClient(base: string, credential: Credential): Promise<TestClient> {
  const url = `${base.replace("http:", "ws:")}/rooms/${credential.roomCode}/ws`;
  const messages: ServerMessage[] = [];
  const waiters: ((message: ServerMessage) => void)[] = [];
  let cursor = 0;
  const ws = new WebSocket(url, {
    headers: {
      origin: "http://localhost",
      "x-seat-id": credential.seatId,
      "x-session-generation": String(credential.sessionGeneration),
      "x-reconnect-secret": credential.reconnectSecret,
    },
  });
  const client: TestClient = {
    ws,
    messages,
    next: (type) => new Promise((resolve, reject) => {
      const existingIndex = messages.findIndex((message, index) => index >= cursor && message.type === type);
      if (existingIndex !== -1) {
        cursor = existingIndex + 1;
        resolve(messages[existingIndex]!);
        return;
      }
      const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 2_000);
      waiters.push((message) => {
        if (message.type === type) {
          cursor = messages.length;
          clearTimeout(timeout);
          resolve(message);
        }
      });
    }),
    send: (payload) => ws.send(JSON.stringify(payload)),
  };

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    messages.push(message);
    for (const waiter of waiters) {
      waiter(message);
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  return client;
}

function clientFor(
  seatId: string,
  alice: Credential,
  aliceClient: TestClient,
  bobClient: TestClient,
): TestClient {
  return seatId === alice.seatId ? aliceClient : bobClient;
}

function command(
  type: string,
  commandId: string,
  sessionGeneration: number,
  payload: unknown,
  expectedRevision?: number,
): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    sessionGeneration,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    type,
    payload,
  };
}
