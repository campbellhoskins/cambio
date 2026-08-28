import type { CommandType, RoomConfig, ServerMessage, ValidatedCommandEnvelope } from "@cambio/protocol";

export interface SessionCredential {
  readonly roomId: string;
  readonly roomCode: string;
  readonly seatId: string;
  readonly sessionGeneration: number;
  readonly reconnectSecret: string;
  readonly displayName: string;
  readonly updatedAt: number;
}

export interface CreateRoomInput {
  readonly displayName: string;
  readonly config: Partial<RoomConfig>;
}

export interface JoinRoomInput {
  readonly roomCode: string;
  readonly displayName: string;
}

export interface ConnectionHandlers {
  readonly onOpen: () => void;
  readonly onClose: (reason: string) => void;
  readonly onError: (message: string) => void;
  readonly onMessage: (message: ServerMessage) => void;
}

export interface ConnectionController {
  readonly send: (envelope: ValidatedCommandEnvelope) => void;
  readonly requestSnapshot: () => void;
  readonly close: () => void;
}

export interface ProtocolAdapter {
  readonly createRoom: (input: CreateRoomInput) => Promise<SessionCredential>;
  readonly joinRoom: (input: JoinRoomInput) => Promise<SessionCredential>;
  readonly resumeSession: (credential: SessionCredential) => Promise<SessionCredential>;
  readonly connect: (credential: SessionCredential, handlers: ConnectionHandlers) => ConnectionController;
}

export interface SendCommandOptions {
  readonly expectedRevision?: number;
}

export interface CommandDraft<TType extends CommandType = CommandType> {
  readonly type: TType;
  readonly payload: unknown;
  readonly options?: SendCommandOptions;
}
