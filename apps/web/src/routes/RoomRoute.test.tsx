import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerMessageSchema } from "@cambio/protocol";
import { MockProtocolAdapter } from "../connection/mockAdapter.js";
import { makeLobbyView, makeSeat } from "../connection/fixtures.js";
import { createMemoryStorage } from "../session/credentials.js";
import { GameProvider, useGameStore } from "../store/gameStore.js";
import { RoomRoute } from "./RoomRoute.js";

afterEach(() => cleanup());

describe("room lobby route", () => {
  it("wires host settings, sharing, and start actions without rendering secrets", async () => {
    const user = userEvent.setup();
    const adapter = new MockProtocolAdapter();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    renderRoom(adapter);

    expect(await screen.findByRole("heading", { name: "Lobby" })).toBeInTheDocument();
    expect(await screen.findByText("Bob")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Rounds"));
    await user.type(screen.getByLabelText("Rounds"), "10");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(adapter.sentEnvelopes.at(-1)).toMatchObject({ type: "updateRoomConfig", payload: { config: { roundCount: 10, snapWindowMs: 5_000, playerCap: 6 } } });

    expect(document.body).not.toHaveTextContent("mock-secret");
    await user.click(screen.getByRole("button", { name: "Copy room link" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/room/MOCK01`);

    await user.click(screen.getByRole("button", { name: "Start match" }));
    await waitFor(() => expect(screen.getAllByRole("heading", { name: "Game table" }).length).toBeGreaterThan(0));
  });
});

function renderRoom(adapter: MockProtocolAdapter): void {
  render(
    <GameProvider adapter={adapter} storage={createMemoryStorage()}>
      <MemoryRouter initialEntries={["/room/MOCK01"]}>
        <Routes>
          <Route path="/room/:code" element={<><Bootstrap /><RoomRoute /></>} />
        </Routes>
      </MemoryRouter>
    </GameProvider>,
  );
}

function Bootstrap(): null {
  const createRoom = useGameStore((state) => state.createRoom);
  const applyServerMessage = useGameStore((state) => state.applyServerMessage);
  useEffect(() => {
    void (async () => {
      await createRoom("Alice", { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 });
      await Promise.resolve();
      const seats = [
        makeSeat({ playerId: "seat-alice", displayName: "Alice", seatIndex: 0, isHost: true }),
        makeSeat({ playerId: "seat-bob", displayName: "Bob", seatIndex: 1, joinOrder: 1 }),
      ];
      applyServerMessage(ServerMessageSchema.parse({
        type: "stateSnapshot",
        revision: 1,
        serverTime: { epochMs: 1, iso: "1970-01-01T00:00:00.001Z" },
        view: makeLobbyView({ roomCode: "MOCK01", viewerSeatId: "seat-alice", seats }),
      }));
    })();
  }, [applyServerMessage, createRoom]);

  return null;
}
