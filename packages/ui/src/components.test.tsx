import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, CardBack, CardGrid, Dialog, DrawnCardTray, FieldError, HostConfigPanel, LiveRegion, PileSummary, PublicActionLog, Roster, Scoreboard, ShareRoomPanel, StartMatchPanel } from "./components.js";
import type { SeatGridView, SeatView, StateSnapshotView } from "@cambio/protocol";

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

  it("renders hidden, hole, and revealed slots without hidden ranks", () => {
    const grid: SeatGridView = {
      playerId: "alice",
      slots: [
        { slotId: "a", kind: "starting", position: "topLeft", state: "hidden" },
        { slotId: "b", kind: "starting", position: "topRight", state: "hole" },
        { slotId: "c", kind: "starting", position: "bottomLeft", state: "revealed", card: { rank: "Q", suit: "hearts" } },
        { slotId: "d", kind: "starting", position: "bottomRight", state: "hidden" },
      ],
    };

    render(<CardGrid seat={seats[0]!} grid={grid} viewerSeatId="alice" />);

    expect(screen.getByRole("button", { name: /top left face-down card/i })).toHaveTextContent("Face down");
    expect(screen.getByRole("button", { name: /top right empty slot/i })).toHaveTextContent("Empty");
    expect(screen.getByRole("button", { name: /bottom left revealed queen of hearts/i })).toBeInTheDocument();
    expect(screen.getAllByText("Face down")).toHaveLength(2);
    expect(screen.getByLabelText(/top left face-down card/i)).not.toHaveTextContent("Queen");
    expect(screen.getByLabelText(/top left face-down card/i)).not.toHaveAccessibleName(/queen|heart|Q/i);
  });

  it("supports roving keyboard navigation in card grids", async () => {
    const user = userEvent.setup();
    const grid: SeatGridView = {
      playerId: "alice",
      slots: [
        { slotId: "a", kind: "starting", position: "topLeft", state: "hidden" },
        { slotId: "b", kind: "starting", position: "topRight", state: "hidden" },
        { slotId: "c", kind: "starting", position: "bottomLeft", state: "hidden" },
        { slotId: "d", kind: "starting", position: "bottomRight", state: "hidden" },
      ],
    };

    render(<CardGrid seat={seats[0]!} grid={grid} viewerSeatId="alice" getSlotAction={() => ({ label: "Attempt snap", onSelect: vi.fn() })} />);
    const topLeft = screen.getByRole("button", { name: /top left face-down card/i });
    topLeft.focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: /top right face-down card/i })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /bottom right face-down card/i })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(topLeft).toHaveFocus();
  });

  it("formats public history without card ranks for snap and power entries", () => {
    render(
      <PublicActionLog
        seats={seats}
        entries={[
          { type: "powerTargetSelected", ownerId: "alice", kind: "blindSwap", target: { playerId: "bob", slotId: "bob-top-left" } },
          { type: "snapAttempted", playerId: "bob", target: { playerId: "alice", slotId: "alice-top-right" }, correct: false, receivedOrder: 1 },
        ]}
      />,
    );

    expect(screen.getByText(/selected a blind swap target/i)).toBeInTheDocument();
    expect(screen.getByText(/wrong, penalty drawn/i)).toBeInTheDocument();
    expect(screen.queryByText(/queen|king|ace|hearts|spades|clubs|diamonds/i)).not.toBeInTheDocument();
  });

  it("renders pile, drawn-card, and score summaries", () => {
    render(
      <>
        <PileSummary piles={{ drawPileCount: 12, discardPileCount: 0, discardTop: null, outOfPlayCount: 2 }} />
        <DrawnCardTray drawnCard={{ state: "hidden", playerId: "bob" }} viewerSeatId="alice" ownerName="Bob" />
        <Scoreboard
          seats={seats}
          scores={[
            { playerId: "alice", cumulativeScore: 3, lastRoundRawScore: 3, lastRoundMatchPoints: 0, isRoundWinner: true },
            { playerId: "bob", cumulativeScore: 12 },
          ]}
        />
      </>,
    );

    expect(screen.getByText("No discard")).toBeInTheDocument();
    expect(screen.getByText("Bob has a drawn card.")).toBeInTheDocument();
    expect(screen.getByText("Round winner")).toBeInTheDocument();
  });
});
