import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { MockProtocolAdapter } from "../connection/mockAdapter.js";
import { createMemoryStorage, saveCredentials } from "../session/credentials.js";
import type { ProtocolAdapter, SessionCredential } from "../connection/types.js";
import { GameProvider } from "../store/gameStore.js";
import { HomeRoute } from "./HomeRoute.js";

const retained: SessionCredential = {
  roomId: "room-ABCD12",
  roomCode: "ABCD12",
  seatId: "alice",
  sessionGeneration: 0,
  reconnectSecret: "secret-token-that-must-not-render",
  displayName: "Alice",
  updatedAt: 1,
};

afterEach(() => cleanup());

describe("home route", () => {
  it("validates create-room config before sending", async () => {
    const user = userEvent.setup();
    renderHome(new MockProtocolAdapter(), createMemoryStorage());

    await user.type(screen.getByLabelText("Display name for new room"), "Alice");
    await user.clear(screen.getByLabelText("Rounds"));
    await user.type(screen.getByLabelText("Rounds"), "21");
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(document.body).toHaveTextContent("Use 1-20 rounds, 2-10 snap seconds, and 2-6 players.");
  });

  it("renders friendly join errors", async () => {
    const user = userEvent.setup();
    const adapter = new RejectingJoinAdapter();
    renderHome(adapter, createMemoryStorage());

    await user.type(screen.getByLabelText("Room code"), "missing");
    await user.type(screen.getByLabelText("Display name for joined room"), "Bob");
    await user.click(screen.getByRole("button", { name: "Join room" }));

    await waitFor(() => expect(document.body).toHaveTextContent("No retained room was found for that code."));
  });

  it("renders resumable sessions without exposing reconnect secrets", () => {
    const storage = createMemoryStorage();
    saveCredentials(storage, [retained]);
    renderHome(new MockProtocolAdapter(), storage);

    expect(screen.getByRole("button", { name: "Resume room ABCD12 as Alice" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(retained.reconnectSecret);
  });

  it("opens the human-readable rules panel from the start screen", async () => {
    const user = userEvent.setup();
    renderHome(new MockProtocolAdapter(), createMemoryStorage());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "How to play" }));

    const dialog = screen.getByRole("dialog", { name: "How to play Cambio" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Snapping" })).toBeInTheDocument();
  });
});

function renderHome(adapter: ProtocolAdapter, storage: ReturnType<typeof createMemoryStorage>): void {
  render(
    <GameProvider adapter={adapter} storage={storage}>
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>
    </GameProvider>,
  );
}

class RejectingJoinAdapter extends MockProtocolAdapter {
  override async joinRoom(): Promise<SessionCredential> {
    throw new Error("No retained room was found for that code.");
  }
}
