import { createHash } from "node:crypto";
import {
  reduceCommand,
  type DomainEvent,
  type EngineCommand,
  type MatchState,
  type PlayerId,
  type RejectionCode,
  type RoomId,
  type TimerId,
} from "@cambio/engine";
import type { ServerMessage, ValidatedCommandEnvelope } from "@cambio/protocol";
import { decodeEnvelope, mapProtocolCommandToEngineCommand, projectAcceptedCommand, projectRejection } from "./mapping/index.js";
import { projectPresentationEvents, projectStateSnapshot } from "./projection/index.js";
import type { Clock, ScheduledTask, Scheduler } from "./clock.js";
import type {
  CommandReceiptRecord,
  RoomRepository,
  SessionRecord,
  StoredRoom,
  TimerRecord,
} from "./persistence.js";
import type { SessionIssuer } from "./sessions.js";

export const RECONNECT_GRACE_MS = 120_000;
export const EMPTY_ROOM_TTL_MS = 86_400_000;

export interface SeatController {
  readonly seatId: PlayerId;
  readonly sessionGeneration: number;
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

export interface CommandDispatchResult {
  readonly message: ServerMessage;
  readonly mutated: boolean;
}

export interface IssuedCredential {
  readonly roomId: RoomId;
  readonly roomCode: string;
  readonly seatId: PlayerId;
  readonly sessionGeneration: number;
  readonly reconnectSecret: string;
}

export interface JoinSeatInput {
  readonly seatId: PlayerId;
  readonly displayName: string;
  readonly session: SessionRecord;
  readonly reconnectSecret: string;
}

export interface ResumeSeatResult extends IssuedCredential {
  readonly state: MatchState;
}

interface QueueItem<T> {
  readonly run: () => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

export interface RoomActorOptions {
  readonly room: StoredRoom;
  readonly repository: RoomRepository;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly sessionIssuer: SessionIssuer;
  readonly onEmptyRoomTtl: (roomId: RoomId, generation: number) => void | Promise<void>;
}

export class RoomActor {
  private state: MatchState;
  private readonly roomCode: string;
  private sessions: readonly SessionRecord[];
  private timers: readonly TimerRecord[];
  private readonly repository: RoomRepository;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly sessionIssuer: SessionIssuer;
  private readonly onEmptyRoomTtl: (roomId: RoomId, generation: number) => void | Promise<void>;
  private readonly controllers = new Map<PlayerId, SeatController>();
  private readonly scheduled = new Map<TimerId, ScheduledTask>();
  private queue = Promise.resolve();

  constructor(options: RoomActorOptions) {
    this.state = options.room.state;
    this.roomCode = options.room.roomCode;
    this.sessions = options.room.sessions;
    this.timers = options.room.timers;
    this.repository = options.repository;
    this.clock = options.clock;
    this.scheduler = options.scheduler;
    this.sessionIssuer = options.sessionIssuer;
    this.onEmptyRoomTtl = options.onEmptyRoomTtl;
    this.rescheduleTimers();
  }

  get roomId(): RoomId {
    return this.state.roomId;
  }

  snapshot(): MatchState {
    return clone(this.state);
  }

  getRoomCode(): string {
    return this.roomCode;
  }

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = { run, resolve, reject };
      this.queue = this.queue.then(() => this.execute(item), () => this.execute(item));
    });
  }

  async addSeat(input: JoinSeatInput): Promise<IssuedCredential | RejectionCode> {
    return this.enqueue(async () => {
      const result = reduceCommand(this.state, {
        type: "joinRoom",
        seat: { playerId: input.seatId, displayName: input.displayName },
      });
      if (!result.ok) {
        return result.code;
      }

      const timers = this.nextTimers(result.state);
      await this.repository.commitRoom({
        roomId: this.roomId,
        state: result.state,
        events: result.events,
        sessions: [input.session],
        timers,
      });

      this.state = result.state;
      this.sessions = [...this.sessions, input.session];
      this.timers = timers;
      this.rescheduleTimers();
      this.broadcastSnapshots();
      return {
        roomId: this.roomId,
        roomCode: this.roomCode,
        seatId: input.seatId,
        sessionGeneration: input.session.sessionGeneration,
        reconnectSecret: input.reconnectSecret,
      };
    });
  }

  async resumeSeat(seatId: PlayerId, reconnectSecret: string): Promise<ResumeSeatResult | RejectionCode> {
    return this.enqueue(async () => {
      const session = this.sessions.find((candidate) => candidate.seatId === seatId);
      const seat = this.state.seats.find((candidate) => candidate.playerId === seatId);
      if (seat?.connection === "removed" || seat?.withdrawn) {
        return "E_ALREADY_REMOVED";
      }

      if (session === undefined || seat === undefined || !this.sessionIssuer.verify(session, reconnectSecret)) {
        return "E_CREDENTIAL_INVALID";
      }

      const issued = this.sessionIssuer.rotate(session);
      const state = recomputeLifecycle({
        ...this.state,
        revision: this.state.revision + 1,
        seats: this.state.seats.map((candidate) =>
          candidate.playerId === seatId
            ? {
                ...candidate,
                connection: "connected" as const,
                sessionGeneration: issued.record.sessionGeneration,
                removalEligible: false,
              }
            : candidate,
        ),
        pauseReasons: this.state.pauseReasons.filter((playerId) => playerId !== seatId),
      });
      const timers = this.nextTimers(state);
      await this.repository.commitRoom({
        roomId: this.roomId,
        state,
        events: [],
        sessions: [issued.record],
        timers,
      });

      this.state = state;
      this.sessions = this.sessions.map((candidate) =>
        candidate.seatId === seatId ? issued.record : candidate,
      );
      this.timers = timers;
      this.revokeController(seatId);
      this.rescheduleTimers();
      this.broadcastSnapshots();
      return {
        roomId: this.roomId,
        roomCode: this.roomCode,
        seatId,
        sessionGeneration: issued.record.sessionGeneration,
        reconnectSecret: issued.reconnectSecret,
        state: clone(this.state),
      };
    });
  }

  async attachController(controller: SeatController): Promise<RejectionCode | null> {
    return this.enqueue(async () => {
      const seat = this.state.seats.find((candidate) => candidate.playerId === controller.seatId);
      if (seat === undefined || seat.connection === "removed" || seat.withdrawn) {
        controller.close(1008, "unauthorized");
        return "E_UNAUTHORIZED";
      }

      if (seat.sessionGeneration !== controller.sessionGeneration) {
        controller.close(1008, "stale session");
        return "E_STALE_SESSION";
      }

      this.revokeController(controller.seatId);
      this.controllers.set(controller.seatId, controller);
      controller.send(this.snapshotMessage(controller.seatId));
      return null;
    });
  }

  async authenticateSeat(
    seatId: PlayerId,
    sessionGeneration: number,
    reconnectSecret: string,
  ): Promise<RejectionCode | null> {
    return this.enqueue(async () => {
      const seat = this.state.seats.find((candidate) => candidate.playerId === seatId);
      const session = this.sessions.find((candidate) => candidate.seatId === seatId);
      if (seat === undefined || session === undefined || !this.sessionIssuer.verify(session, reconnectSecret)) {
        return "E_UNAUTHORIZED";
      }

      if (seat.connection === "removed" || seat.withdrawn) {
        return "E_ALREADY_REMOVED";
      }

      return seat.sessionGeneration === sessionGeneration ? null : "E_STALE_SESSION";
    });
  }

  async detachController(
    seatId: PlayerId,
    sessionGeneration: number,
    controller?: SeatController,
  ): Promise<void> {
    await this.enqueue(async () => {
      const current = this.controllers.get(seatId);
      if (
        current?.sessionGeneration !== sessionGeneration ||
        (controller !== undefined && current !== controller)
      ) {
        return;
      }

      this.controllers.delete(seatId);
      await this.markDisconnected(seatId, sessionGeneration);
    });
  }

  async submitCommand(seatId: PlayerId, raw: unknown): Promise<CommandDispatchResult> {
    return this.enqueue(async () => {
      const decoded = decodeEnvelope(raw);
      const commandId = typeof raw === "object" && raw !== null && "commandId" in raw && typeof raw.commandId === "string"
        ? raw.commandId
        : "unknown";

      if ("ok" in decoded) {
        return this.rejectToController(seatId, commandId, decoded.code);
      }

      const authError = this.validateController(seatId, decoded);
      if (authError !== null) {
        return this.rejectToController(seatId, decoded.commandId, authError);
      }

      const payloadHash = commandPayloadHash(decoded);
      const receipt = await this.repository.getCommandReceipt(
        this.roomId,
        seatId,
        decoded.sessionGeneration,
        decoded.commandId,
      );
      if (receipt !== null) {
        if (receipt.payloadHash !== payloadHash) {
          return this.rejectToController(seatId, decoded.commandId, "E_DUPLICATE_COMMAND");
        }

        const message = receipt.status === "accepted"
          ? projectAcceptedCommand(decoded, receipt.revision)
          : projectRejection(decoded.commandId, receipt.revision, receipt.rejectionCode ?? "E_UNAUTHORIZED");
        this.controllers.get(seatId)?.send(message);
        return { message, mutated: false };
      }

      const mapped = mapProtocolCommandToEngineCommand(decoded, seatId);
      if ("unsupported" in mapped) {
        return this.rejectToController(seatId, decoded.commandId, "E_BAD_ENVELOPE");
      }

      const result = reduceCommand(this.state, mapped);
      if (!result.ok) {
        const message = projectRejection(decoded.commandId, this.state.revision, result.code);
        await this.repository.commitRoom({
          roomId: this.roomId,
          state: this.state,
          events: [],
          receipt: makeReceipt(this.roomId, decoded, seatId, payloadHash, "rejected", this.state.revision, result.code),
        });
        this.controllers.get(seatId)?.send(message);
        return { message, mutated: false };
      }

      const state = recomputeLifecycle(result.state);
      const timers = this.nextTimers(state);
      const receiptRecord = makeReceipt(this.roomId, decoded, seatId, payloadHash, "accepted", state.revision, null);
      const changedSessions = this.sessionsToPersistAfterCommand(mapped, seatId);
      await this.repository.commitRoom({
        roomId: this.roomId,
        state,
        events: result.events,
        receipt: receiptRecord,
        sessions: changedSessions,
        timers,
      });

      this.state = state;
      this.sessions = changedSessions.length === 0
        ? this.sessions
        : this.sessions.map((session) =>
            changedSessions.find((changed) => changed.seatId === session.seatId) ?? session,
          );
      this.timers = timers;
      this.rescheduleTimers();
      const message = projectAcceptedCommand(decoded, state.revision);
      this.controllers.get(seatId)?.send(message);
      if (mapped.type === "leaveRoom") {
        this.revokeController(seatId);
      }
      this.broadcastMutation(result.events);
      return { message, mutated: true };
    });
  }

  async expireSnapWindow(windowId: string, generation: number): Promise<void> {
    await this.enqueue(async () => {
      const result = reduceCommand(this.state, { type: "expireSnapWindow", windowId, generation });
      if (!result.ok || result.state === this.state) {
        return;
      }

      const state = recomputeLifecycle(result.state);
      const timers = this.nextTimers(state);
      await this.repository.commitRoom({
        roomId: this.roomId,
        state,
        events: result.events,
        timers,
      });
      this.state = state;
      this.timers = timers;
      this.rescheduleTimers();
      this.broadcastMutation(result.events);
    });
  }

  async expireReconnectGrace(seatId: PlayerId, generation: number): Promise<void> {
    await this.enqueue(async () => {
      const timer = this.timers.find((candidate) =>
        candidate.kind === "reconnectGrace" &&
        candidate.seatId === seatId &&
        candidate.generation === generation
      );
      const seat = this.state.seats.find((candidate) => candidate.playerId === seatId);
      if (timer === undefined || seat === undefined || seat.connection !== "disconnected") {
        return;
      }

      const state = {
        ...this.state,
        revision: this.state.revision + 1,
        seats: this.state.seats.map((candidate) =>
          candidate.playerId === seatId ? { ...candidate, removalEligible: true } : candidate,
        ),
      };
      const timers = this.nextTimers(state).filter((candidate) => candidate.timerId !== timer.timerId);
      await this.repository.commitRoom({ roomId: this.roomId, state, events: [], timers });
      this.state = state;
      this.timers = timers;
      this.rescheduleTimers();
      this.broadcastSnapshots();
    });
  }

  async deleteIfEmpty(generation: number): Promise<boolean> {
    return this.enqueue(async () => {
      const timer = this.timers.find((candidate) =>
        candidate.kind === "emptyRoomTtl" && candidate.generation === generation
      );
      if (timer === undefined || connectedSeats(this.state).length > 0) {
        return false;
      }

      await this.repository.commitRoom({
        roomId: this.roomId,
        state: this.state,
        events: [],
        deleteRoom: true,
      });
      this.cancelTimers();
      return true;
    });
  }

  async recoverAfterRestart(): Promise<void> {
    await this.enqueue(async () => {
      const restartedState = this.restartSnapWindow(recomputeLifecycle({
        ...this.state,
        revision: this.state.revision + 1,
        seats: this.state.seats.map((seat) =>
          seat.connection === "removed"
            ? seat
            : { ...seat, connection: "disconnected" as const, removalEligible: false },
        ),
      }));
      const timers = this.nextTimers(restartedState);
      await this.repository.commitRoom({ roomId: this.roomId, state: restartedState, events: [], timers });
      this.state = restartedState;
      this.timers = timers;
      this.controllers.clear();
      this.rescheduleTimers();
    });
  }

  private async execute<T>(item: QueueItem<T>): Promise<void> {
    try {
      item.resolve(await item.run());
    } catch (error) {
      item.reject(error);
    }
  }

  private validateController(
    seatId: PlayerId,
    envelope: ValidatedCommandEnvelope,
  ): RejectionCode | null {
    const seat = this.state.seats.find((candidate) => candidate.playerId === seatId);
    if (seat === undefined || seat.connection === "removed" || seat.withdrawn) {
      return "E_UNAUTHORIZED";
    }

    if (seat.sessionGeneration !== envelope.sessionGeneration) {
      return "E_STALE_SESSION";
    }

    if (envelope.type === "createRoom" || envelope.type === "resumeSession") {
      return "E_BAD_ENVELOPE";
    }

    return null;
  }

  private async rejectToController(
    seatId: PlayerId,
    commandId: string,
    code: RejectionCode,
  ): Promise<CommandDispatchResult> {
    const message = projectRejection(commandId, this.state.revision, code);
    this.controllers.get(seatId)?.send(message);
    return { message, mutated: false };
  }

  private async markDisconnected(seatId: PlayerId, sessionGeneration: number): Promise<void> {
    const seat = this.state.seats.find((candidate) => candidate.playerId === seatId);
    if (seat === undefined || seat.sessionGeneration !== sessionGeneration || seat.connection !== "connected") {
      return;
    }

    const state = recomputeLifecycle({
      ...this.freezeSnapIfNeeded(seatId),
      revision: this.state.revision + 1,
      seats: this.state.seats.map((candidate) =>
        candidate.playerId === seatId
          ? { ...candidate, connection: "disconnected" as const, removalEligible: false }
          : candidate,
      ),
    });
    const timers = this.nextTimers(state);
    await this.repository.commitRoom({ roomId: this.roomId, state, events: [], timers });
    this.state = state;
    this.timers = timers;
    this.rescheduleTimers();
    this.broadcastSnapshots();
  }

  private freezeSnapIfNeeded(seatId: PlayerId): MatchState {
    const round = this.state.round;
    if (round === null) {
      return this.state;
    }

    const snapWindow = round?.snapWindow;
    if (snapWindow === undefined || snapWindow === null || !isBlockingSeat(this.state, seatId)) {
      return this.state;
    }

    const timer = this.timers.find((candidate) =>
      candidate.kind === "snapWindow" &&
      candidate.windowId === snapWindow.windowId &&
      candidate.generation === snapWindow.generation
    );
    const remainingMs = timer === undefined
      ? snapWindow.remainingMs
      : Math.max(0, timer.dueAtMs - this.clock.nowMs());

    return {
      ...this.state,
      round: {
        ...round,
        snapWindow: {
          ...snapWindow,
          remainingMs,
        },
      },
    };
  }

  private revokeController(seatId: PlayerId): void {
    const previous = this.controllers.get(seatId);
    if (previous !== undefined) {
      previous.close(4001, "superseded");
      this.controllers.delete(seatId);
    }
  }

  private sessionsToPersistAfterCommand(
    command: EngineCommand,
    actorSeatId: PlayerId,
  ): readonly SessionRecord[] {
    if (command.type === "leaveRoom") {
      const session = this.sessions.find((candidate) => candidate.seatId === actorSeatId);
      return session === undefined ? [] : [this.sessionIssuer.revoke(session)];
    }

    if (command.type === "removePlayer") {
      const session = this.sessions.find((candidate) => candidate.seatId === command.targetPlayerId);
      return session === undefined ? [] : [this.sessionIssuer.revoke(session)];
    }

    return [];
  }

  private broadcastMutation(events: readonly DomainEvent[]): void {
    this.broadcastSnapshots();
    for (const controller of this.controllers.values()) {
      for (const payload of projectPresentationEvents(events, controller.seatId)) {
        controller.send({ type: "presentationEvent", revision: this.state.revision, payload });
      }
    }
  }

  private broadcastSnapshots(): void {
    for (const controller of this.controllers.values()) {
      controller.send(this.snapshotMessage(controller.seatId));
    }
  }

  private snapshotMessage(seatId: PlayerId): ServerMessage {
    return {
      type: "stateSnapshot",
      revision: this.state.revision,
      serverTime: {
        epochMs: this.clock.nowMs(),
        iso: new Date(this.clock.nowMs()).toISOString(),
      },
      view: projectStateSnapshot(this.state, seatId),
    };
  }

  private nextTimers(state: MatchState): readonly TimerRecord[] {
    const timers: TimerRecord[] = [];
    const snap = state.round?.snapWindow;
    if (snap !== undefined && snap !== null && snap.resolvedBy === null && state.pauseReasons.length === 0) {
      const existing = this.timers.find((timer) =>
        timer.kind === "snapWindow" &&
        timer.windowId === snap.windowId &&
        timer.generation === snap.generation
      );
      const remainingMs = existing === undefined
        ? snap.remainingMs
        : Math.max(0, existing.dueAtMs - this.clock.nowMs());
      timers.push({
        timerId: snap.timerId,
        roomId: state.roomId,
        kind: "snapWindow",
        generation: snap.generation,
        windowId: snap.windowId,
        dueAtMs: existing?.dueAtMs ?? this.clock.nowMs() + remainingMs,
        remainingMs,
      });
    }

    for (const seat of state.seats) {
      if (seat.connection === "disconnected" && !seat.withdrawn && !seat.removalEligible) {
        const timerId = reconnectTimerId(seat.playerId, seat.sessionGeneration);
        const existing = this.timers.find((timer) => timer.timerId === timerId);
        timers.push({
          timerId,
          roomId: state.roomId,
          kind: "reconnectGrace",
          generation: seat.sessionGeneration,
          seatId: seat.playerId,
          dueAtMs: existing?.dueAtMs ?? this.clock.nowMs() + RECONNECT_GRACE_MS,
        });
      }
    }

    if (connectedSeats(state).length === 0) {
      const existing = this.timers.find((timer) => timer.kind === "emptyRoomTtl");
      timers.push({
        timerId: existing?.timerId ?? emptyRoomTimerId(state.roomId, state.revision),
        roomId: state.roomId,
        kind: "emptyRoomTtl",
        generation: existing?.generation ?? state.revision,
        dueAtMs: existing?.dueAtMs ?? this.clock.nowMs() + EMPTY_ROOM_TTL_MS,
      });
    }

    return timers;
  }

  private rescheduleTimers(): void {
    this.cancelTimers();
    for (const timer of this.timers) {
      const delayMs = Math.max(0, timer.dueAtMs - this.clock.nowMs());
      if (timer.kind === "snapWindow" && timer.windowId !== undefined) {
        this.scheduled.set(
          timer.timerId,
          this.scheduler.schedule(delayMs, () => this.expireSnapWindow(timer.windowId!, timer.generation)),
        );
      } else if (timer.kind === "reconnectGrace" && timer.seatId !== undefined) {
        this.scheduled.set(
          timer.timerId,
          this.scheduler.schedule(delayMs, () => this.expireReconnectGrace(timer.seatId!, timer.generation)),
        );
      } else if (timer.kind === "emptyRoomTtl") {
        this.scheduled.set(
          timer.timerId,
          this.scheduler.schedule(delayMs, async () => this.onEmptyRoomTtl(this.roomId, timer.generation)),
        );
      }
    }
  }

  private cancelTimers(): void {
    for (const task of this.scheduled.values()) {
      task.cancel();
    }
    this.scheduled.clear();
  }

  private restartSnapWindow(state: MatchState): MatchState {
    const round = state.round;
    if (round?.snapWindow === undefined || round.snapWindow === null) {
      return state;
    }

    return {
      ...state,
      round: {
        ...round,
        snapWindow: {
          ...round.snapWindow,
          generation: round.snapWindow.generation + 1,
          remainingMs: state.config.snapWindowMs,
        },
      },
    };
  }
}

export function commandPayloadHash(envelope: ValidatedCommandEnvelope): string {
  return createHash("sha256")
    .update(canonicalJson({
      type: envelope.type,
      expectedRevision: envelope.expectedRevision ?? null,
      payload: envelope.payload,
    }))
    .digest("hex");
}

function makeReceipt(
  roomId: RoomId,
  envelope: ValidatedCommandEnvelope,
  seatId: PlayerId,
  payloadHash: string,
  status: "accepted" | "rejected",
  revision: number,
  rejectionCode: RejectionCode | null,
): CommandReceiptRecord {
  return {
    roomId,
    seatId,
    sessionGeneration: envelope.sessionGeneration,
    commandId: envelope.commandId,
    payloadHash,
    status,
    revision,
    commandType: envelope.type,
    rejectionCode,
  };
}

function recomputeLifecycle(state: MatchState): MatchState {
  const pauseReasons = state.seats
    .filter((seat) =>
      seat.connection === "disconnected" &&
      !seat.withdrawn &&
      isBlockingSeat(state, seat.playerId)
    )
    .map((seat) => seat.playerId);
  const hostPlayerId = state.hostPlayerId === null || state.seats.some((seat) =>
    seat.playerId === state.hostPlayerId && seat.connection === "connected" && !seat.withdrawn
  )
    ? state.hostPlayerId
    : (connectedSeats(state)[0]?.playerId ?? state.hostPlayerId);

  return {
    ...state,
    hostPlayerId,
    pauseReasons,
  };
}

function connectedSeats(state: MatchState): readonly MatchState["seats"][number][] {
  return [...state.seats]
    .filter((seat) => seat.connection === "connected" && !seat.withdrawn)
    .sort((left, right) => left.joinOrder - right.joinOrder || left.seatIndex - right.seatIndex);
}

function isBlockingSeat(state: MatchState, seatId: PlayerId): boolean {
  const round = state.round;
  if (state.status !== "active") {
    return false;
  }

  if (round === null) {
    return true;
  }

  if (round.phase === "openingPeek") {
    return !state.seats.find((seat) => seat.playerId === seatId)?.openingPeekAcknowledged;
  }

  return state.status === "active" && (
    round.activePlayerId === seatId ||
    round.pendingPower?.ownerId === seatId ||
    round.pendingTransfer?.fromPlayerId === seatId ||
    round.pendingTransfer?.toPlayerId === seatId
  );
}

function reconnectTimerId(seatId: PlayerId, generation: number): TimerId {
  return `timer:grace:${seatId}:${generation}`;
}

function emptyRoomTimerId(roomId: RoomId, revision: number): TimerId {
  return `timer:empty:${roomId}:${revision}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
