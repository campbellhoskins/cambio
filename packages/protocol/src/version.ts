import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);

export interface VersionCompatibilityError {
  readonly ok: false;
  readonly code: "E_BAD_ENVELOPE";
  readonly message: "incompatible protocol version";
}

export function checkProtocolVersion(raw: unknown): true | VersionCompatibilityError {
  if (typeof raw !== "object" || raw === null || !("protocolVersion" in raw)) {
    return {
      ok: false,
      code: "E_BAD_ENVELOPE",
      message: "incompatible protocol version",
    };
  }

  return (raw as { readonly protocolVersion?: unknown }).protocolVersion === PROTOCOL_VERSION
    ? true
    : {
        ok: false,
        code: "E_BAD_ENVELOPE",
        message: "incompatible protocol version",
      };
}
