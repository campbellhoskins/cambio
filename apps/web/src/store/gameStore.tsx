import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import {
  PROTOCOL_VERSION,
  RoomConfigSchema,
  ServerMessageSchema,
  ValidatedCommandEnvelopeSchema,
  type CommandType,
  type RejectionCode,
  type RoomConfig,
  type ServerMessage,
  type StateSnapshotView,
  type ValidatedCommandEnvelope,
} from "@cambio/protocol";
import { friendlyError } from "../connection/rejections.js";
import type { BrowserStorage, PublicSessionDescriptor } from "../session/credentials.js";
import { loadCredentials, publicDescriptors, removeCredential, upsertCredential } from "../session/credentials.js";
import type { ConnectionController, ProtocolAdapter, SessionCredential } from "../connection/types.js";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

export interface GameState {
  readonly adapter: ProtocolAdapter;
  readonly storage: BrowserStorage;
  readonly snapshot: StateSnapshotView | null;
  readonly revision: number | null;
  readonly connectionStatus: ConnectionStatus;
  readonly connectionAnnouncement: string;
  readonly credential: SessionCredential | null;
  readonly sessions: PublicSessionDescriptor[];
  readonly lastError: string | null;
  readonly rejections: Partial<Record<RejectionCode, string>>;
  readonly needsResync: boolean;
  readonly controller: ConnectionController | null;
  readonly hydrateSessions: () => void;
  readonly createRoom: (displayName: string, config: Partial<RoomConfig>) => Promise<SessionCredential>;
  readonly joinRoom: (roomCode: string, displayName: string) => Promise<SessionCredential>;
  readonly resumeSession: (descriptor: PublicSessionDescriptor) => Promise<SessionCredential>;
  readonly connectWithCredential: (credential: SessionCredential) => void;
  readonly sendCommand: (type: CommandType, payload: unknown) => void;
  readonly applyServerMessage: (message: ServerMessage) => void;
  readonly clearError: () => void;
  readonly leaveCurrentRoom: () => void;
}

export type GameStore = StoreApi<GameState>;

const revisionCommandTypes = new Set<CommandType>([
  "acknowledgeOpeningPeek",
  "readyForNextRound",
  "callCambio",
  "drawCard",
  "replaceSlot",
  "discardDrawn",
  "skipPower",
  "selectPowerTarget",
  "acknowledgePowerReveal",
  "decideBlackKingSwap",
  "reselectPowerTarget",
  "chooseTransferTarget",
  "hostRemovePlayer",
  "hostEndMatch",
]);

function definedPartialConfig(config: { readonly roundCount?: number | undefined; readonly snapWindowMs?: number | undefined; readonly playerCap?: number | undefined }): Partial<RoomConfig> {
  return {
    ...(config.roundCount === undefined ? {} : { roundCount: config.roundCount }),
    ...(config.snapWindowMs === undefined ? {} : { snapWindowMs: config.snapWindowMs }),
    ...(config.playerCap === undefined ? {} : { playerCap: config.playerCap }),
  };
}

export function createGameStore(adapter: ProtocolAdapter, storage: BrowserStorage): GameStore {
  let commandCounter = 0;

  return createStore<GameState>((set, get) => {
    const persistAndConnect = (credential: SessionCredential): SessionCredential => {
      const sessions = upsertCredential(storage, credential);
      set({ credential, sessions: publicDescriptors(sessions) });
      get().connectWithCredential(credential);
      return credential;
    };

    const toFailure = (error: unknown): Error => {
      const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
      set({ lastError: message, connectionStatus: "error", connectionAnnouncement: message });
      return error instanceof Error ? error : new Error(message);
    };

    return {
      adapter,
      storage,
      snapshot: null,
      revision: null,
      connectionStatus: "idle",
      connectionAnnouncement: "Not connected.",
      credential: null,
      sessions: publicDescriptors(loadCredentials(storage)),
      lastError: null,
      rejections: {},
      needsResync: false,
      controller: null,
      hydrateSessions: () => set({ sessions: publicDescriptors(loadCredentials(storage)) }),
      createRoom: async (displayName, config) => {
        const parsedConfig = definedPartialConfig(RoomConfigSchema.partial().strict().parse(config));
        try {
          return persistAndConnect(await adapter.createRoom({ displayName: displayName.trim(), config: parsedConfig }));
        } catch (error) {
          throw toFailure(error);
        }
      },
      joinRoom: async (roomCode, displayName) => {
        try {
          return persistAndConnect(await adapter.joinRoom({ roomCode: roomCode.trim().toUpperCase(), displayName: displayName.trim() }));
        } catch (error) {
          throw toFailure(error);
        }
      },
      resumeSession: async (descriptor) => {
        const stored = loadCredentials(storage).find((credential) =>
          credential.roomCode === descriptor.roomCode && credential.seatId === descriptor.seatId
        );
        if (stored === undefined) {
          const message = friendlyError("E_CREDENTIAL_INVALID");
          set({ lastError: message, connectionStatus: "error", connectionAnnouncement: message });
          throw new Error(message);
        }

        try {
          const rotated = await adapter.resumeSession(stored);
          get().controller?.close();
          return persistAndConnect(rotated);
        } catch (error) {
          throw toFailure(error);
        }
      },
      connectWithCredential: (credential) => {
        get().controller?.close();
        set({ connectionStatus: "connecting", connectionAnnouncement: `Connecting to room ${credential.roomCode}.`, lastError: null });
        const controller = adapter.connect(credential, {
          onOpen: () => set({ connectionStatus: "connected", connectionAnnouncement: `Connected to room ${credential.roomCode}.` }),
          onClose: (reason) => set({ connectionStatus: reason === "resync requested" ? "reconnecting" : "closed", connectionAnnouncement: reason === "resync requested" ? "Resyncing room state." : "Disconnected from the room." }),
          onError: (message) => set({ connectionStatus: "error", connectionAnnouncement: message, lastError: message }),
          onMessage: (message) => get().applyServerMessage(message),
        });
        set({ controller });
      },
      sendCommand: (type, payload) => {
        const { credential, revision, controller } = get();
        if (credential === null || controller === null) {
          set({ lastError: "Connect to a room before sending commands." });
          return;
        }
        const expectedRevision = revisionCommandTypes.has(type) ? revision : null;
        if (revisionCommandTypes.has(type) && expectedRevision === null) {
          set({ lastError: "Waiting for a room snapshot before sending that action." });
          return;
        }

        commandCounter += 1;
        const envelope = ValidatedCommandEnvelopeSchema.parse({
          protocolVersion: PROTOCOL_VERSION,
          commandId: `${credential.seatId}-${credential.sessionGeneration}-${commandCounter}`,
          sessionGeneration: credential.sessionGeneration,
          ...(expectedRevision === null ? {} : { expectedRevision }),
          type,
          payload,
        }) as ValidatedCommandEnvelope;
        controller.send(envelope);
      },
      applyServerMessage: (message) => {
        const parsed = ServerMessageSchema.parse(message);
        const currentRevision = get().revision;
        if (parsed.type === "error") {
          set({ lastError: parsed.message });
          return;
        }

        if (parsed.revision <= (currentRevision ?? -1)) {
          if ((parsed.type === "commandAccepted" || parsed.type === "commandRejected") && currentRevision !== null && parsed.revision < currentRevision) {
            get().controller?.requestSnapshot();
            set({ needsResync: true, connectionAnnouncement: "Command acknowledged against an old revision. Resyncing." });
          }
          return;
        }

        if (parsed.type !== "stateSnapshot" && currentRevision !== null && parsed.revision > currentRevision + 1) {
          get().controller?.requestSnapshot();
          set({ needsResync: true, connectionAnnouncement: "Room update gap detected. Resyncing." });
          return;
        }

        if (parsed.type === "stateSnapshot") {
          set({
            snapshot: parsed.view,
            revision: parsed.revision,
            needsResync: false,
            connectionAnnouncement: `Room state updated to revision ${parsed.revision}.`,
          });
          return;
        }

        if (parsed.type === "commandRejected") {
          const friendly = friendlyError(parsed.code);
          set((state) => ({
            rejections: { ...state.rejections, [parsed.code]: friendly },
            lastError: friendly,
            connectionAnnouncement: friendly,
          }));
        }
      },
      clearError: () => set({ lastError: null, rejections: {} }),
      leaveCurrentRoom: () => {
        const current = get().credential;
        if (current !== null) {
          const sessions = removeCredential(storage, current.roomCode, current.seatId);
          get().controller?.close();
          set({ credential: null, sessions: publicDescriptors(sessions), snapshot: null, revision: null, controller: null, connectionStatus: "idle" });
        }
      },
    };
  });
}

const GameStoreContext = createContext<GameStore | null>(null);

export function GameProvider({
  adapter,
  storage,
  children,
}: {
  readonly adapter: ProtocolAdapter;
  readonly storage: BrowserStorage;
  readonly children: ReactNode;
}): ReactNode {
  const store = useMemo(() => createGameStore(adapter, storage), [adapter, storage]);

  useEffect(() => {
    store.getState().hydrateSessions();
  }, [store]);

  return <GameStoreContext.Provider value={store}>{children}</GameStoreContext.Provider>;
}

export function useGameStore<T>(selector: (state: GameState) => T): T {
  const store = useContext(GameStoreContext);
  if (store === null) {
    throw new Error("GameProvider is missing.");
  }

  return useStore(store, selector);
}
