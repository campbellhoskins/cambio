import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverTarget = process.env.CAMBIO_SERVER_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/rooms": {
        target: serverTarget,
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          proxy.on("proxyReqWs", (proxyReq, request) => {
            const cookies = parseCookies(request.headers.cookie);
            const seatId = cookies.cambio_ws_seat_id;
            const sessionGeneration = cookies.cambio_ws_session_generation;
            const reconnectSecret = cookies.cambio_ws_reconnect_secret;
            if (seatId !== undefined) {
              proxyReq.setHeader("x-seat-id", seatId);
            }
            if (sessionGeneration !== undefined) {
              proxyReq.setHeader("x-session-generation", sessionGeneration);
            }
            if (reconnectSecret !== undefined) {
              proxyReq.setHeader("x-reconnect-secret", reconnectSecret);
            }
            proxyReq.removeHeader("cookie");
          });
        },
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});

function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined) {
    return {};
  }

  return Object.fromEntries(header.split(";").map((part) => {
    const [name, ...value] = part.trim().split("=");
    return [name, decodeURIComponent(value.join("="))];
  }).filter((entry): entry is [string, string] => entry[0] !== undefined && entry[0].length > 0));
}
