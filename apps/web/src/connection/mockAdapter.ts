import { ServerMessageSchema, ValidatedCommandEnvelopeSchema, type ServerMessage, type StateSnapshotView, type ValidatedCommandEnvelope } from "@cambio/protocol";
import { friendlyError } from "./rejections.js";
import type { ConnectionController, ConnectionHandlers, CreateRoomInput, JoinRoomInput, ProtocolAdapter, SessionCredential } from "./types.js";
import { makeLobbyView, makeSeat } from "./fixtures.js";

interface MockSeatSession {
  credential: SessionCredential;
  controller: MockConnectionController | null;
}

interface MockRoom {
  roomCode: string;
  revision: number;
  view: StateSnapshotView;
  sessions: Map<string, MockSeatSession>;
}

export class MockProtocolAdapter implements ProtocolAdapter {
  readonly rooms = new Map<string, MockRoom>();
  readonly sentEnvelopes: ValidatedCommandEnvelope[] = [];
  resyncRequests = 0;
  closedControllers = 0;
  private codeCounter = 1;

  async createRoom(input: CreateRoomInput): Promise<SessionCredential> {
    const roomCode = `MOCK${String(this.codeCounter).padStart(2, "0")}`;
    this.codeCounter += 1;
    const credential = credentialFor(roomCode, "seat-alice", input.displayName, 0);
    const seat = makeSeat({
      playerId: credential.seatId,
      displayName: input.displayName,
      seatIndex: 0,
      isHost: true,
      sessionGeneration: credential.sessionGeneration,
    });
    const view = makeLobbyView({ roomCode, viewerSeatId: credential.seatId, config: input.config, seats: [seat] });
    this.rooms.set(roomCode, {
      roomCode,
      revision: 0,
      view,
      sessions: new Map([[credential.seatId, { credential, controller: null }]]),
    });
    return credential;
  }

  async joinRoom(input: JoinRoomInput): Promise<SessionCredential> {
    const room = this.rooms.get(input.roomCode) ?? this.createFallbackRoom(input.roomCode);
    if (room.view.room.status !== "lobby") {
      throw new Error("E_ROOM_STARTED");
    }
    if (room.view.seats.filter((seat) => seat.connection !== "removed").length >= room.view.room.config.playerCap) {
      throw new Error("E_ROOM_FULL");
    }

    const seatNumber = room.view.seats.length + 1;
    const credential = credentialFor(input.roomCode, `seat-${input.displayName.toLowerCase().replace(/[^a-z0-9]/g, "") || seatNumber}`, input.displayName, 0);
    const seat = makeSeat({
      playerId: credential.seatId,
      displayName: input.displayName,
      seatIndex: room.view.seats.length,
      joinOrder: room.view.seats.length,
      sessionGeneration: credential.sessionGeneration,
    });
    room.sessions.set(credential.seatId, { credential, controller: null });
    room.view = makeLobbyView({
      roomCode: input.roomCode,
      revision: room.revision,
      viewerSeatId: credential.seatId,
      config: room.view.room.config,
      seats: [...room.view.seats, seat],
    });
    this.broadcast(room);
    return credential;
  }

  async resumeSession(credential: SessionCredential): Promise<SessionCredential> {
    const room = this.rooms.get(credential.roomCode) ?? this.createFallbackRoom(credential.roomCode, credential);
    const existing = room.sessions.get(credential.seatId);
    if (existing === undefined || existing.credential.reconnectSecret !== credential.reconnectSecret) {
      throw new Error("E_CREDENTIAL_INVALID");
    }

    const rotated = {
      ...existing.credential,
      sessionGeneration: existing.credential.sessionGeneration + 1,
      reconnectSecret: `mock-secret-${credential.seatId}-${existing.credential.sessionGeneration + 1}`,
      updatedAt: Date.now(),
    };
    existing.controller?.close();
    room.sessions.set(credential.seatId, { credential: rotated, controller: null });
    room.view = {
      ...room.view,
      seats: room.view.seats.map((seat) => seat.playerId === credential.seatId
        ? { ...seat, sessionGeneration: rotated.sessionGeneration, connection: "connected" }
        : seat),
    };
    return rotated;
  }

  connect(credential: SessionCredential, handlers: ConnectionHandlers): ConnectionController {
    const room = this.rooms.get(credential.roomCode) ?? this.createFallbackRoom(credential.roomCode, credential);
    const session = room.sessions.get(credential.seatId);
    if (session === undefined || session.credential.reconnectSecret !== credential.reconnectSecret) {
      queueMicrotask(() => handlers.onError(friendlyError("E_CREDENTIAL_INVALID")));
      return new MockConnectionController(this, room, credential.seatId, handlers, true);
    }

    session.controller?.close();
    const controller = new MockConnectionController(this, room, credential.seatId, handlers, false);
    room.sessions.set(credential.seatId, { credential, controller });
    queueMicrotask(() => {
      handlers.onOpen();
      controller.deliver(snapshotMessage(room, credential.seatId));
    });
    return controller;
  }

  private createFallbackRoom(roomCode: string, credential?: SessionCredential): MockRoom {
    const hostCredential = credential?.seatId === "seat-host"
      ? credential
      : credentialFor(roomCode, "seat-host", "Host", 0);
    const hostSeat = makeSeat({
      playerId: hostCredential.seatId,
      displayName: hostCredential.displayName,
      seatIndex: 0,
      isHost: true,
      sessionGeneration: hostCredential.sessionGeneration,
    });
    const view = makeLobbyView({ roomCode, viewerSeatId: hostCredential.seatId, seats: [hostSeat] });
    const room: MockRoom = {
      roomCode,
      revision: 0,
      view,
      sessions: new Map([[hostCredential.seatId, { credential: hostCredential, controller: null }]]),
    };
    this.rooms.set(roomCode, room);
    return room;
  }

  handleEnvelope(room: MockRoom, seatId: string, envelope: ValidatedCommandEnvelope): void {
    this.sentEnvelopes.push(envelope);
    switch (envelope.type) {
      case "updateRoomConfig":
      {
        room.revision += 1;
        const nextConfig = { ...room.view.room.config };
        if (envelope.payload.config.roundCount !== undefined) {
          nextConfig.roundCount = envelope.payload.config.roundCount;
        }
        if (envelope.payload.config.snapWindowMs !== undefined) {
          nextConfig.snapWindowMs = envelope.payload.config.snapWindowMs;
        }
        if (envelope.payload.config.playerCap !== undefined) {
          nextConfig.playerCap = envelope.payload.config.playerCap;
        }
        room.view = {
          ...room.view,
          room: { ...room.view.room, config: nextConfig },
        };
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      }
      case "startMatch":
        room.revision += 1;
        room.view = { ...room.view, room: { ...room.view.room, status: "active" } };
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "leaveRoom":
        room.revision += 1;
        room.view = {
          ...room.view,
          seats: room.view.seats.map((seat) => seat.playerId === seatId ? { ...seat, connection: "removed" } : seat),
        };
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      default:
        room.sessions.get(seatId)?.controller?.deliver(ServerMessageSchema.parse({
          type: "commandRejected",
          commandId: envelope.commandId,
          revision: room.revision,
          code: "E_OUT_OF_PHASE",
        }));
    }
  }

  private ackAndBroadcast(room: MockRoom, seatId: string, envelope: ValidatedCommandEnvelope): void {
    room.sessions.get(seatId)?.controller?.deliver(ServerMessageSchema.parse({
      type: "commandAccepted",
      commandId: envelope.commandId,
      revision: room.revision,
      result: { commandType: envelope.type },
    }));
    this.broadcast(room);
  }

  private broadcast(room: MockRoom): void {
    for (const [seatId, session] of room.sessions) {
      session.controller?.deliver(snapshotMessage(room, seatId));
    }
  }
}

class MockConnectionController implements ConnectionController {
  private closed = false;

  constructor(
    private readonly adapter: MockProtocolAdapter,
    private readonly room: MockRoom,
    private readonly seatId: string,
    private readonly handlers: ConnectionHandlers,
    closed: boolean,
  ) {
    this.closed = closed;
  }

  send(envelope: ValidatedCommandEnvelope): void {
    if (this.closed) {
      return;
    }

    const parsed = ValidatedCommandEnvelopeSchema.parse(envelope);
    this.adapter.handleEnvelope(this.room, this.seatId, parsed);
  }

  requestSnapshot(): void {
    if (this.closed) {
      return;
    }

    this.adapter.resyncRequests += 1;
    this.deliver(snapshotMessage(this.room, this.seatId));
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.adapter.closedControllers += 1;
    this.handlers.onClose("closed");
  }

  deliver(message: ServerMessage): void {
    if (!this.closed) {
      this.handlers.onMessage(ServerMessageSchema.parse(message));
    }
  }
}

function credentialFor(roomCode: string, seatId: string, displayName: string, sessionGeneration: number): SessionCredential {
  return {
    roomId: `room-${roomCode}`,
    roomCode,
    seatId,
    sessionGeneration,
    reconnectSecret: `mock-secret-${seatId}-${sessionGeneration}`,
    displayName,
    updatedAt: Date.now(),
  };
}

function snapshotMessage(room: MockRoom, viewerSeatId: string): ServerMessage {
  const viewerView = makeLobbyView({
    roomCode: room.roomCode,
    revision: room.revision,
    viewerSeatId,
    status: room.view.room.status,
    config: room.view.room.config,
    seats: room.view.seats,
  });
  return ServerMessageSchema.parse({
    type: "stateSnapshot",
    revision: room.revision,
    serverTime: { epochMs: Date.now(), iso: new Date().toISOString() },
    view: viewerView,
  });
}
