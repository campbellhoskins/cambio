import { ServerMessageSchema, StateSnapshotViewSchema, ValidatedCommandEnvelopeSchema, type ServerMessage, type StateSnapshotView, type ValidatedCommandEnvelope } from "@cambio/protocol";
import { friendlyError } from "./rejections.js";
import type { ConnectionController, ConnectionHandlers, CreateRoomInput, JoinRoomInput, ProtocolAdapter, SessionCredential } from "./types.js";
import { card, makeGameView, makeGrid, makeLobbyView, makeSeat } from "./fixtures.js";

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

  constructor() {
    this.restoreRooms();
  }

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
    this.persistRooms();
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
    this.persistRooms();
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
    this.persistRooms();
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
    this.persistRooms();
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
        room.view = makeGameView({
          roomCode: room.roomCode,
          seats: room.view.seats.map((seat) => ({ ...seat, openingPeekAcknowledged: false, readyForNextRound: false })),
          phase: "openingPeek",
          turnStage: null,
          activePlayerId: null,
          grids: room.view.seats.map((seat) => makeGrid(seat.playerId, false)),
          discardTop: card("7", "hearts"),
          actionLog: [{ type: "roundDealt", roundNumber: 1, dealerId: room.view.seats[0]?.playerId ?? seatId }],
        });
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "acknowledgeOpeningPeek":
        room.revision += 1;
        {
          const seats = room.view.seats.map((seat) => seat.playerId === seatId ? { ...seat, openingPeekAcknowledged: true } : seat);
          const everyoneAcked = seats.every((seat) => seat.connection === "removed" || seat.openingPeekAcknowledged);
          room.view = {
            ...room.view,
            seats,
            round: {
              ...room.view.round,
              phase: everyoneAcked ? "turnCycle" : "openingPeek",
              turnStage: everyoneAcked ? "turnStart" : null,
              activePlayerId: everyoneAcked ? seats[0]?.playerId ?? null : null,
            },
            actionLog: [...room.view.actionLog, { type: "openingPeekAcknowledged", playerId: seatId, acknowledgedCount: seats.filter((seat) => seat.openingPeekAcknowledged).length, requiredCount: seats.length }],
          };
        }
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "drawCard":
        room.revision += 1;
        room.view = {
          ...room.view,
          round: { ...room.view.round, turnStage: "drawn" },
          drawnCard: { state: "revealed", playerId: seatId, card: card("J", "clubs") },
          actionLog: [...room.view.actionLog, { type: "cardDrawn", playerId: seatId }],
        };
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "replaceSlot":
      case "discardDrawn":
        room.revision += 1;
        {
          const afterFinalTurn = room.view.round.cambio !== null && room.view.round.activePlayerId === seatId;
          const action = envelope.type === "replaceSlot"
            ? { type: "slotReplaced" as const, playerId: seatId, slotId: envelope.payload.slotId }
            : { type: "cardDiscarded" as const, playerId: seatId };
          room.view = afterFinalTurn
            ? {
                ...room.view,
                room: { ...room.view.room, status: "intermission" },
                round: { ...room.view.round, phase: "complete", turnStage: null, activePlayerId: null, endReason: "cambio" },
                drawnCard: { state: "none" },
                snapWindow: null,
                pendingPower: null,
                scores: room.view.seats.map((seat, index) => ({
                  playerId: seat.playerId,
                  cumulativeScore: index === 0 ? 0 : 8,
                  lastRoundRawScore: index === 0 ? 4 : 8,
                  lastRoundMatchPoints: index === 0 ? 0 : 8,
                  isRoundWinner: index === 0,
                })),
                actionLog: [...room.view.actionLog, action, { type: "roundEnded", reason: "cambio", scores: room.view.seats.map((seat, index) => ({ playerId: seat.playerId, rawScore: index === 0 ? 4 : 8, matchPoints: index === 0 ? 0 : 8, isRoundWinner: index === 0 })) }],
              }
            : {
                ...room.view,
                round: { ...room.view.round, turnStage: "resolving" },
                drawnCard: { state: "none" },
                piles: { ...room.view.piles, discardTop: card("J", "clubs"), discardPileCount: room.view.piles.discardPileCount + 1 },
                snapWindow: { windowId: "mock-snap-1", generation: 0, remainingMs: 5_000, durationMs: 5_000, resolvedBy: null },
                pendingPower: { ownerId: seatId, kind: "blindSwap", stage: "offered", selections: [] },
                actionLog: [...room.view.actionLog, action, { type: "snapWindowOpened", windowId: "mock-snap-1", generation: 0 }, { type: "powerOffered", ownerId: seatId, kind: "blindSwap" }],
              };
        }
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "skipPower":
        room.revision += 1;
        room.view = {
          ...room.view,
          pendingPower: null,
          actionLog: room.view.pendingPower === null ? room.view.actionLog : [...room.view.actionLog, { type: "powerSkipped", ownerId: seatId, kind: room.view.pendingPower.kind, reason: "skipped" }],
        };
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "attemptSnap":
        room.revision += 1;
        if (envelope.payload.slotId.includes("top-left")) {
          room.view = {
            ...room.view,
            actionLog: [...room.view.actionLog, { type: "snapAttempted", playerId: seatId, target: { playerId: envelope.payload.targetPlayerId, slotId: envelope.payload.slotId }, correct: false, receivedOrder: room.revision }, { type: "penaltyCardDrawn", playerId: seatId, slotId: `${seatId}-penalty-${room.revision}` }],
          };
          room.sessions.get(seatId)?.controller?.deliver(ServerMessageSchema.parse({
            type: "commandAccepted",
            commandId: envelope.commandId,
            revision: room.revision,
            result: { commandType: envelope.type },
          }));
          this.broadcast(room);
          for (const [, session] of room.sessions) {
            session.controller?.deliver(ServerMessageSchema.parse({
              type: "presentationEvent",
              revision: room.revision,
              payload: { type: "wrongSnapReveal", playerId: seatId, target: { playerId: envelope.payload.targetPlayerId, slotId: envelope.payload.slotId }, card: card("3", "diamonds") },
            }));
          }
          return;
        }
        room.view = {
          ...room.view,
          snapWindow: null,
          pendingTransfer: envelope.payload.targetPlayerId === seatId ? null : { fromPlayerId: envelope.payload.targetPlayerId, toPlayerId: seatId, targetSlotId: envelope.payload.slotId },
          actionLog: [...room.view.actionLog, { type: "snapAttempted", playerId: seatId, target: { playerId: envelope.payload.targetPlayerId, slotId: envelope.payload.slotId }, correct: true, receivedOrder: room.revision }],
        };
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "chooseTransferTarget":
        room.revision += 1;
        room.view = {
          ...room.view,
          round: { ...room.view.round, turnStage: "turnStart", activePlayerId: seatId },
          pendingTransfer: null,
          actionLog: room.view.pendingTransfer === null ? room.view.actionLog : [...room.view.actionLog, { type: "transferCompleted", fromPlayerId: room.view.pendingTransfer.fromPlayerId, toPlayerId: room.view.pendingTransfer.toPlayerId, fromSlotId: room.view.pendingTransfer.targetSlotId, toSlotId: envelope.payload.slotId }],
        };
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "callCambio":
        room.revision += 1;
        {
          const queue = room.view.seats.filter((seat) => seat.playerId !== seatId && seat.connection !== "removed").map((seat) => seat.playerId);
          room.view = {
            ...room.view,
            round: { ...room.view.round, cambio: { callerId: seatId, finalTurnQueue: queue, completedFinalTurns: [] }, activePlayerId: queue[0] ?? null, turnStage: "turnStart" },
            actionLog: [...room.view.actionLog, { type: "cambioCalled", callerId: seatId, finalTurnQueue: queue }],
          };
        }
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "readyForNextRound":
        room.revision += 1;
        {
          const seats = room.view.seats.map((seat) => seat.playerId === seatId ? { ...seat, readyForNextRound: true } : seat);
          const readyCount = seats.filter((seat) => seat.readyForNextRound).length;
          const allReady = readyCount === seats.filter((seat) => seat.connection !== "removed").length;
          room.view = {
            ...room.view,
            seats,
            room: allReady ? { ...room.view.room, status: "complete" } : room.view.room,
            actionLog: [
              ...room.view.actionLog,
              { type: "readyForNextRound", playerId: seatId, readyCount, requiredCount: seats.length },
              ...(allReady ? [{ type: "matchCompleted" as const, winners: [seats[0]?.playerId ?? seatId], cumulativeScores: Object.fromEntries(room.view.scores.map((score) => [score.playerId, score.cumulativeScore])) }] : []),
            ],
          };
        }
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "hostRemovePlayer":
        room.revision += 1;
        room.view = {
          ...room.view,
          seats: room.view.seats.map((seat) => seat.playerId === envelope.payload.targetPlayerId ? { ...seat, connection: "removed" } : seat),
          actionLog: [...room.view.actionLog, { type: "playerRemoved", playerId: envelope.payload.targetPlayerId }],
        };
        this.ackAndBroadcast(room, seatId, envelope);
        return;
      case "hostEndMatch":
        room.revision += 1;
        room.view = {
          ...room.view,
          room: { ...room.view.room, status: "abandoned" },
          actionLog: [...room.view.actionLog, { type: "matchAbandoned", reason: "hostEnded", cumulativeScores: Object.fromEntries(room.view.scores.map((score) => [score.playerId, score.cumulativeScore])) }],
        };
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
    this.persistRooms();
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

  private persistRooms(): void {
    const storage = browserStorage();
    if (storage === null) {
      return;
    }

    storage.setItem("cambio.mock.rooms", JSON.stringify([...this.rooms.values()].map((room) => ({
      roomCode: room.roomCode,
      revision: room.revision,
      view: room.view,
      sessions: [...room.sessions.values()].map((session) => session.credential),
    }))));
  }

  private restoreRooms(): void {
    const storage = browserStorage();
    const stored = storage?.getItem("cambio.mock.rooms");
    if (stored === null || stored === undefined) {
      return;
    }

    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return;
    }

    let maxCode = 0;
    for (const candidate of parsed) {
      if (!isStoredRoom(candidate)) {
        continue;
      }
      this.rooms.set(candidate.roomCode, {
        roomCode: candidate.roomCode,
        revision: candidate.revision,
        view: StateSnapshotViewSchema.parse(candidate.view),
        sessions: new Map(candidate.sessions.map((credential) => [credential.seatId, { credential, controller: null }])),
      });
      const numeric = Number(candidate.roomCode.replace(/\D/g, ""));
      if (Number.isFinite(numeric)) {
        maxCode = Math.max(maxCode, numeric);
      }
    }
    this.codeCounter = Math.max(this.codeCounter, maxCode + 1);
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
  if (room.view.room.status !== "lobby") {
    return ServerMessageSchema.parse({
      type: "stateSnapshot",
      revision: room.revision,
      serverTime: { epochMs: Date.now(), iso: new Date().toISOString() },
      view: mockGameViewFor(room, viewerSeatId),
    });
  }

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

interface StoredRoom {
  readonly roomCode: string;
  readonly revision: number;
  readonly view: StateSnapshotView;
  readonly sessions: readonly SessionCredential[];
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined" || window.localStorage.getItem("cambio.adapter") !== "mock") {
    return null;
  }
  return window.localStorage;
}

function isStoredRoom(value: unknown): value is StoredRoom {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StoredRoom>;
  return typeof candidate.roomCode === "string" &&
    typeof candidate.revision === "number" &&
    candidate.view !== undefined &&
    Array.isArray(candidate.sessions);
}

function mockGameViewFor(room: MockRoom, viewerSeatId: string): StateSnapshotView {
  const viewer = room.view.seats.find((seat) => seat.playerId === viewerSeatId);
  const legalActions = legalActionsFor(room.view, viewerSeatId);
  const grids = room.view.grids.map((grid) => {
    if (room.view.round.phase === "openingPeek") {
      const shouldRevealBottom = grid.playerId === viewerSeatId && viewer?.openingPeekAcknowledged !== true;
      return makeGrid(grid.playerId, shouldRevealBottom);
    }
    return grid;
  });
  const drawnCard = room.view.drawnCard.state === "revealed" && room.view.drawnCard.playerId !== viewerSeatId
    ? { state: "hidden" as const, playerId: room.view.drawnCard.playerId }
    : room.view.drawnCard;

  return StateSnapshotViewSchema.parse({
    ...room.view,
    viewerSeatId,
    grids,
    drawnCard,
    legalActions,
  });
}

function legalActionsFor(view: StateSnapshotView, viewerSeatId: string): StateSnapshotView["legalActions"] {
  const legal = new Set<StateSnapshotView["legalActions"][number]>();
  const viewer = view.seats.find((seat) => seat.playerId === viewerSeatId);
  if (view.round.phase === "openingPeek" && viewer?.openingPeekAcknowledged === false) {
    legal.add("acknowledgeOpeningPeek");
  }
  if (view.round.activePlayerId === viewerSeatId && view.round.turnStage === "turnStart") {
    legal.add("drawCard");
    legal.add("callCambio");
  }
  if (view.round.activePlayerId === viewerSeatId && view.round.turnStage === "drawn") {
    legal.add("replaceSlot");
    legal.add("discardDrawn");
  }
  if (view.pendingPower?.ownerId === viewerSeatId) {
    if (view.pendingPower.stage === "offered") {
      legal.add("skipPower");
    }
    if (view.pendingPower.stage === "selectingFirst" || view.pendingPower.stage === "selectingSecond") {
      legal.add("selectPowerTarget");
    }
    if (view.pendingPower.stage === "awaitingRevealAck") {
      legal.add("acknowledgePowerReveal");
    }
    if (view.pendingPower.stage === "awaitingKingDecision") {
      legal.add("decideBlackKingSwap");
    }
  }
  if (view.snapWindow !== null) {
    legal.add("attemptSnap");
  }
  if (view.pendingTransfer?.toPlayerId === viewerSeatId) {
    legal.add("chooseTransferTarget");
  }
  if (view.room.status === "intermission" && viewer?.readyForNextRound !== true) {
    legal.add("readyForNextRound");
  }
  if (viewer?.isHost === true && view.seats.some((seat) => seat.removalEligible)) {
    legal.add("hostRemovePlayer");
  }
  if (viewer?.isHost === true && view.room.status === "active") {
    legal.add("hostEndMatch");
  }
  return [...legal];
}
