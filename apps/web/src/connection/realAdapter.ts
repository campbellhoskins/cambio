import { ServerMessageSchema, ValidatedCommandEnvelopeSchema, type ValidatedCommandEnvelope } from "@cambio/protocol";
import { friendlyError } from "./rejections.js";
import type { ConnectionController, ConnectionHandlers, CreateRoomInput, JoinRoomInput, ProtocolAdapter, SessionCredential } from "./types.js";

interface CredentialResponse {
  readonly roomId: string;
  readonly roomCode: string;
  readonly seatId: string;
  readonly sessionGeneration: number;
  readonly reconnectSecret: string;
}

const WS_COOKIE_NAMES = {
  seatId: "cambio_ws_seat_id",
  sessionGeneration: "cambio_ws_session_generation",
  reconnectSecret: "cambio_ws_reconnect_secret",
} as const;

export class RealProtocolAdapter implements ProtocolAdapter {
  constructor(private readonly baseUrl = "") {}

  async createRoom(input: CreateRoomInput): Promise<SessionCredential> {
    return this.toCredential(await this.fetchCredential("/rooms", {
      method: "POST",
      body: JSON.stringify({ displayName: input.displayName, config: input.config }),
    }), input.displayName);
  }

  async joinRoom(input: JoinRoomInput): Promise<SessionCredential> {
    return this.toCredential(await this.fetchCredential(`/rooms/${encodeURIComponent(input.roomCode)}/join`, {
      method: "POST",
      body: JSON.stringify({ displayName: input.displayName }),
    }), input.displayName);
  }

  async resumeSession(credential: SessionCredential): Promise<SessionCredential> {
    return this.toCredential(await this.fetchCredential(`/rooms/${encodeURIComponent(credential.roomCode)}/resume`, {
      method: "POST",
      body: JSON.stringify({ seatId: credential.seatId, reconnectSecret: credential.reconnectSecret }),
    }), credential.displayName);
  }

  connect(credential: SessionCredential, handlers: ConnectionHandlers): ConnectionController {
    let closed = false;
    let socket: WebSocket | null = null;

    const open = (): void => {
      writeWebSocketAuthCookies(credential);
      const next = new WebSocket(this.websocketUrl(credential.roomCode));
      socket = next;
      next.addEventListener("open", () => handlers.onOpen());
      next.addEventListener("close", (event) => {
        if (socket !== next) {
          return;
        }
        if (closed) {
          clearWebSocketAuthCookies(credential.roomCode);
          return;
        }
        clearWebSocketAuthCookies(credential.roomCode);
        handlers.onClose(event.reason || `closed ${event.code}`);
      });
      next.addEventListener("error", () => handlers.onError("Unable to connect to the room socket."));
      next.addEventListener("message", (event: MessageEvent<string>) => {
        try {
          const parsed = ServerMessageSchema.parse(JSON.parse(event.data) as unknown);
          handlers.onMessage(parsed);
        } catch {
          handlers.onError("The server sent a message this client could not read.");
        }
      });
    };

    open();

    return {
      send: (envelope: ValidatedCommandEnvelope) => {
        if (closed || socket?.readyState !== WebSocket.OPEN) {
          handlers.onError("The room socket is not connected.");
          return;
        }
        socket.send(JSON.stringify(ValidatedCommandEnvelopeSchema.parse(envelope)));
      },
      requestSnapshot: () => {
        if (closed) {
          return;
        }
        handlers.onClose("resync requested");
        socket?.close(4000, "resync");
        open();
      },
      close: () => {
        if (closed) {
          return;
        }
        closed = true;
        clearWebSocketAuthCookies(credential.roomCode);
        socket?.close(1000, "client closed");
      },
    };
  }

  private async fetchCredential(path: string, init: RequestInit): Promise<CredentialResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) {
      const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
        ? body.code
        : "E_BAD_ENVELOPE";
      throw new Error(friendlyError(code));
    }

    if (!isCredentialResponse(body)) {
      throw new Error("The server returned an unreadable credential.");
    }

    return body;
  }

  private toCredential(response: CredentialResponse, displayName: string): SessionCredential {
    return { ...response, displayName, updatedAt: Date.now() };
  }

  private websocketUrl(roomCode: string): string {
    const path = `${this.baseUrl}/rooms/${encodeURIComponent(roomCode)}/ws`;
    if (path.startsWith("http://")) {
      return `ws://${path.slice("http://".length)}`;
    }
    if (path.startsWith("https://")) {
      return `wss://${path.slice("https://".length)}`;
    }

    const base = new URL(path, window.location.href);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    return base.toString();
  }
}

export function writeWebSocketAuthCookies(credential: SessionCredential): void {
  const path = `/rooms/${encodeURIComponent(credential.roomCode)}/ws`;
  writeCookie(WS_COOKIE_NAMES.seatId, credential.seatId, path);
  writeCookie(WS_COOKIE_NAMES.sessionGeneration, String(credential.sessionGeneration), path);
  writeCookie(WS_COOKIE_NAMES.reconnectSecret, credential.reconnectSecret, path);
}

export function clearWebSocketAuthCookies(roomCode?: string): void {
  const paths = roomCode === undefined ? ["/"] : ["/", `/rooms/${encodeURIComponent(roomCode)}/ws`];
  for (const name of Object.values(WS_COOKIE_NAMES)) {
    for (const path of paths) {
      document.cookie = `${name}=; Max-Age=0; Path=${path}; SameSite=Strict`;
    }
  }
}

function writeCookie(name: string, value: string, path: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=Strict`;
}

function isCredentialResponse(value: unknown): value is CredentialResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.roomId === "string" &&
    typeof candidate.roomCode === "string" &&
    typeof candidate.seatId === "string" &&
    typeof candidate.sessionGeneration === "number" &&
    Number.isInteger(candidate.sessionGeneration) &&
    typeof candidate.reconnectSecret === "string";
}
