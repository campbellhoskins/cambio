import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PlayerId, RoomId } from "@cambio/engine";
import type { SessionRecord } from "./persistence.js";

export interface IssuedSession {
  readonly record: SessionRecord;
  readonly reconnectSecret: string;
}

export interface SessionIssuerOptions {
  readonly key?: Buffer;
  readonly nowMs: () => number;
}

export class SessionIssuer {
  private readonly key: Buffer;
  private readonly nowMs: () => number;

  constructor(options: SessionIssuerOptions) {
    this.key = options.key ?? randomBytes(32);
    this.nowMs = options.nowMs;
  }

  create(roomId: RoomId, seatId: PlayerId, generation = 0): IssuedSession {
    const reconnectSecret = randomBytes(32).toString("base64url");
    return {
      reconnectSecret,
      record: {
        roomId,
        seatId,
        sessionGeneration: generation,
        secretDigest: this.digest(reconnectSecret),
        createdAtMs: this.nowMs(),
        updatedAtMs: this.nowMs(),
        revokedAtMs: null,
      },
    };
  }

  rotate(record: SessionRecord): IssuedSession {
    const issued = this.create(record.roomId, record.seatId, record.sessionGeneration + 1);
    return {
      reconnectSecret: issued.reconnectSecret,
      record: {
        ...issued.record,
        createdAtMs: record.createdAtMs,
      },
    };
  }

  verify(record: SessionRecord, reconnectSecret: string): boolean {
    if (record.revokedAtMs !== null) {
      return false;
    }

    const expected = Buffer.from(record.secretDigest, "hex");
    const actual = Buffer.from(this.digest(reconnectSecret), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  revoke(record: SessionRecord): SessionRecord {
    return {
      ...record,
      revokedAtMs: this.nowMs(),
      updatedAtMs: this.nowMs(),
    };
  }

  private digest(reconnectSecret: string): string {
    return createHmac("sha256", this.key).update(reconnectSecret).digest("hex");
  }
}
