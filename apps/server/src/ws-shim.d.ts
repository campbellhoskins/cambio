declare module "ws" {
  import type { IncomingHttpHeaders } from "node:http";

  export interface ClientOptions {
    readonly headers?: IncomingHttpHeaders;
    readonly origin?: string;
  }

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export default class WebSocket {
    static readonly OPEN: number;
    readonly readyState: number;
    constructor(address: string, options?: ClientOptions);
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: RawData) => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }
}
