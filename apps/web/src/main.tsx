import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { ErrorBoundary } from "./app/ErrorBoundary.js";
import { GameProvider } from "./store/gameStore.js";
import { MockProtocolAdapter } from "./connection/mockAdapter.js";
import { RealProtocolAdapter } from "./connection/realAdapter.js";
import "./styles.css";

const adapterMode = resolveAdapterMode();
const adapter = adapterMode === "mock" ? new MockProtocolAdapter() : new RealProtocolAdapter(import.meta.env.VITE_CAMBIO_HTTP_BASE ?? "");
const root = document.getElementById("root");

if (root === null) {
  throw new Error("Missing root element.");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <GameProvider adapter={adapter} storage={window.localStorage}>
        <App />
      </GameProvider>
    </ErrorBoundary>
  </StrictMode>,
);

function resolveAdapterMode(): "mock" | "real" {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("adapter");
  if (requested === "mock") {
    window.localStorage.setItem("cambio.adapter", "mock");
    return "mock";
  }
  if (requested === "real") {
    window.localStorage.removeItem("cambio.adapter");
    return "real";
  }

  return window.localStorage.getItem("cambio.adapter") === "mock" || import.meta.env.VITE_CAMBIO_ADAPTER === "mock"
    ? "mock"
    : "real";
}
