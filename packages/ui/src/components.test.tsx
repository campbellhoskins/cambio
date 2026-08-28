import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, CardBack, Dialog, FieldError, HostConfigPanel, LiveRegion, Roster, ShareRoomPanel, StartMatchPanel } from "./components.js";
import type { SeatView, StateSnapshotView } from "@cambio/protocol";

const seats: SeatView[] = [
  {
    playerId: "alice",
    displayName: "Alice",
    seatIndex: 0,
    joinOrder: 0,
    connection: "connected",
    sessionGeneration: 0,
    isHost: true,
    openingPeekAcknowledged: false,
    readyForNextRound: false,
    removalEligible: false,
  },
  {
    playerId: "bob",
    displayName: "Bob",
    seatIndex: 1,
    joinOrder: 1,
    connection: "disconnected",
    sessionGeneration: 0,
    isHost: false,
    openingPeekAcknowledged: false,
    readyForNextRound: false,
    removalEligible: true,
  },
];

const config: StateSnapshotView["room"]["config"] = { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 };
const limits = {
  roundCount: { min: 1, max: 20 },
  snapWindowSeconds: { min: 2, max: 10 },
  playerCap: { min: 2, max: 6 },
};

afterEach(() => cleanup());

describe("reusable lobby components", () => {
  it("renders roster identity, host, connection, and removal state", () => {
    render(<Roster seats={seats} viewerSeatId="alice" />);

    expect(screen.getByText("Alice (you)")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Removal eligible")).toBeInTheDocument();
  });

  it("submits host configuration from keyboard-editable fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<HostConfigPanel config={config} isHost={true} limits={limits} onSubmit={onSubmit} />);

    await user.clear(screen.getByLabelText("Rounds"));
    await user.type(screen.getByLabelText("Rounds"), "12");
    await user.clear(screen.getByLabelText("Snap window seconds"));
    await user.type(screen.getByLabelText("Snap window seconds"), "7");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onSubmit).toHaveBeenCalledWith({ roundCount: 12, snapWindowMs: 7_000, playerCap: 6 });
  });

  it("disables host configuration for non-host viewers", () => {
    render(<HostConfigPanel config={config} isHost={false} limits={limits} onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(screen.getByLabelText("Player cap")).toBeDisabled();
  });

  it("shares code and link without any credential string", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(<ShareRoomPanel roomCode="ABCD12" roomLink="http://localhost/room/ABCD12" onCopy={onCopy} copied={true} />);

    expect(screen.getByText("ABCD12")).toBeInTheDocument();
    expect(screen.queryByText(/secret-token/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy room link" }));
    expect(onCopy).toHaveBeenCalled();
  });

  it("enables start only when the host has enough players", () => {
    const { rerender } = render(<StartMatchPanel canStart={false} isHost={true} playerCount={1} onStart={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start match" })).toBeDisabled();
    expect(screen.getByText("At least 2 players are required.")).toBeInTheDocument();

    rerender(<StartMatchPanel canStart={true} isHost={true} playerCount={2} onStart={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start match" })).toBeEnabled();
  });

  it("renders primitive button, live region, field error, and card back semantics", () => {
    render(
      <>
        <Button variant="danger">Danger action</Button>
        <LiveRegion politeness="assertive">Roster updated</LiveRegion>
        <FieldError>Invalid value</FieldError>
        <FieldError>{null}</FieldError>
        <CardBack label="Hidden lobby placeholder card" />
      </>,
    );

    expect(screen.getByRole("button", { name: "Danger action" })).toHaveClass("ui-button--danger");
    expect(screen.getByText("Roster updated")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid value");
    expect(screen.getByRole("img", { name: "Hidden lobby placeholder card" })).toBeInTheDocument();
  });

  it("manages dialog focus and close affordances", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog title="Confirm leave" open={true} onClose={onClose}>
        <Button>Stay in room</Button>
      </Dialog>,
    );

    expect(screen.getByRole("dialog", { name: "Confirm leave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
