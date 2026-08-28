import type { SessionCredential } from "../connection/types.js";

export const CREDENTIAL_STORAGE_KEY = "cambio.sessions.v1";

export type PublicSessionDescriptor = Omit<SessionCredential, "reconnectSecret">;

export interface BrowserStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export function loadCredentials(storage: BrowserStorage): SessionCredential[] {
  const raw = storage.getItem(CREDENTIAL_STORAGE_KEY);
  if (raw === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSessionCredential);
  } catch {
    return [];
  }
}

export function saveCredentials(storage: BrowserStorage, credentials: readonly SessionCredential[]): void {
  storage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(credentials));
}

export function upsertCredential(storage: BrowserStorage, credential: SessionCredential): SessionCredential[] {
  const credentials = loadCredentials(storage)
    .filter((candidate) => !(candidate.roomCode === credential.roomCode && candidate.seatId === credential.seatId));
  const next = [credential, ...credentials].sort((left, right) => right.updatedAt - left.updatedAt);
  saveCredentials(storage, next);
  return next;
}

export function removeCredential(storage: BrowserStorage, roomCode: string, seatId: string): SessionCredential[] {
  const next = loadCredentials(storage).filter((candidate) => candidate.roomCode !== roomCode || candidate.seatId !== seatId);
  if (next.length === 0) {
    storage.removeItem(CREDENTIAL_STORAGE_KEY);
  } else {
    saveCredentials(storage, next);
  }
  return next;
}

export function publicDescriptor(credential: SessionCredential): PublicSessionDescriptor {
  return {
    roomId: credential.roomId,
    roomCode: credential.roomCode,
    seatId: credential.seatId,
    sessionGeneration: credential.sessionGeneration,
    displayName: credential.displayName,
    updatedAt: credential.updatedAt,
  };
}

export function publicDescriptors(credentials: readonly SessionCredential[]): PublicSessionDescriptor[] {
  return credentials.map(publicDescriptor);
}

export function createMemoryStorage(initial?: Record<string, string>): BrowserStorage & { readonly values: Record<string, string> } {
  const values: Record<string, string> = { ...(initial ?? {}) };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
    removeItem: (key) => {
      delete values[key];
    },
  };
}

function isSessionCredential(value: unknown): value is SessionCredential {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.roomId === "string" &&
    typeof candidate.roomCode === "string" &&
    typeof candidate.seatId === "string" &&
    typeof candidate.sessionGeneration === "number" &&
    Number.isInteger(candidate.sessionGeneration) &&
    typeof candidate.reconnectSecret === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.updatedAt === "number";
}
