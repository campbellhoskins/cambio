import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandType, PresentationEventPayload, StateSnapshotView } from "@cambio/protocol";
import { card, makeGameView, makeGrid, makeSeat } from "../connection/fixtures.js";
import { GameTable } from "./GameTable.js";

afterEach(() => cleanup());

describe("game table", () => {
  it("renders opening peek with only the viewer bottom cards revealed", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    renderTable(makeGameView({
      phase: "openingPeek",
      turnStage: null,
      activePlayerId: null,
      grids: [makeGrid("seat-alice", true), makeGrid("seat-bob", false)],
      legalActions: ["acknowledgeOpeningPeek"],
    }), onCommand);

    expect(screen.getByRole("button", { name: /bottom left revealed 5 of clubs for alice/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bottom right revealed king of spades for alice/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bottom left face-down card for bob/i })).not.toHaveAccessibleName(/5 of clubs|king of spades/i);
    await user.click(screen.getByRole("button", { name: "Acknowledge opening peek" }));
    expect(onCommand).toHaveBeenCalledWith("acknowledgeOpeningPeek", {});
  });

  it("enables only legal turn-start actions", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    renderTable(makeGameView({ legalActions: ["drawCard", "callCambio"], turnStage: "turnStart" }), onCommand);

    expect(screen.getByRole("button", { name: "Draw card" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Call Cambio" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard drawn card" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Draw card" }));
    await user.click(screen.getByRole("button", { name: "Call Cambio" }));
    expect(onCommand).toHaveBeenNthCalledWith(1, "drawCard", {});
    expect(onCommand).toHaveBeenNthCalledWith(2, "callCambio", {});
  });

  it("replaces or discards a drawn card only when legal", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    renderTable(makeGameView({
      turnStage: "drawn",
      drawnCard: { state: "revealed", playerId: "seat-alice", card: card("J", "clubs") },
      legalActions: ["replaceSlot", "discardDrawn"],
    }), onCommand);

    await user.click(screen.getByRole("button", { name: /top left face-down card for alice.*replace with drawn card/i }));
    await user.click(screen.getByRole("button", { name: "Discard drawn card" }));
    expect(onCommand).toHaveBeenNthCalledWith(1, "replaceSlot", { slotId: "seat-alice-top-left" });
    expect(onCommand).toHaveBeenNthCalledWith(2, "discardDrawn", {});
  });

  it("supports power selection, reveal acknowledgement, black-king decisions, and reselect", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const { rerender } = renderTable(makeGameView({
      pendingPower: { ownerId: "seat-alice", kind: "peekOwn", stage: "selectingFirst", selections: [] },
      legalActions: ["selectPowerTarget", "skipPower"],
    }), onCommand);

    await user.click(screen.getByRole("button", { name: /top left face-down card for alice.*select power target/i }));
    expect(onCommand).toHaveBeenLastCalledWith("selectPowerTarget", { targetPlayerId: "seat-alice", slotId: "seat-alice-top-left" });

    const revealGrid = makeGrid("seat-alice", false);
    revealGrid.slots = revealGrid.slots.map((slot) => slot.slotId === "seat-alice-top-left" ? { ...slot, state: "revealed", card: card("8", "hearts") } : slot);
    rerender(tableElement(makeGameView({
      grids: [revealGrid, makeGrid("seat-bob", false)],
      pendingPower: { ownerId: "seat-alice", kind: "peekOwn", stage: "awaitingRevealAck", selections: [{ playerId: "seat-alice", slotId: "seat-alice-top-left" }] },
      legalActions: ["acknowledgePowerReveal"],
    }), onCommand));

    expect(screen.getByRole("dialog", { name: "Private power reveal" })).toHaveTextContent("8 of hearts");
    await user.click(screen.getByRole("button", { name: "Acknowledge reveal" }));
    expect(onCommand).toHaveBeenLastCalledWith("acknowledgePowerReveal", {});

    rerender(tableElement(makeGameView({
      pendingPower: { ownerId: "seat-alice", kind: "blackKing", stage: "awaitingKingDecision", selections: [] },
      legalActions: ["decideBlackKingSwap"],
    }), onCommand));
    await user.click(screen.getByRole("button", { name: "Confirm swap" }));
    expect(onCommand).toHaveBeenLastCalledWith("decideBlackKingSwap", { decision: "confirm" });

    rerender(tableElement(makeGameView({
      pendingPower: { ownerId: "seat-alice", kind: "peekOpponent", stage: "selectingFirst", selections: [] },
      legalActions: ["reselectPowerTarget"],
    }), onCommand));
    await user.click(screen.getByRole("button", { name: /top left face-down card for bob.*reselect power target/i }));
    expect(onCommand).toHaveBeenLastCalledWith("reselectPowerTarget", { targetPlayerId: "seat-bob", slotId: "seat-bob-top-left" });
  });

  it("supports snap mode, countdown, transient wrong reveal, and transfer selection", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const wrongReveal: PresentationEventPayload = {
      type: "wrongSnapReveal",
      playerId: "seat-bob",
      target: { playerId: "seat-bob", slotId: "seat-bob-top-left" },
      card: card("3", "diamonds"),
    };
    const { rerender } = renderTable(makeGameView({
      snapWindow: { windowId: "snap-1", generation: 2, remainingMs: 3_000, durationMs: 5_000, resolvedBy: null },
      legalActions: ["attemptSnap"],
    }), onCommand, [wrongReveal]);

    expect(screen.getByRole("timer", { name: "Snap countdown" })).toHaveTextContent("3s");
    expect(screen.getByRole("button", { name: /top left transient wrong snap reveal, 3 of diamonds, for bob/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enter snap mode" }));
    await user.click(screen.getByRole("button", { name: /top right face-down card for bob.*attempt snap/i }));
    expect(onCommand).toHaveBeenLastCalledWith("attemptSnap", {
      snapWindowId: "snap-1",
      generation: 2,
      targetPlayerId: "seat-bob",
      slotId: "seat-bob-top-right",
    });

    rerender(tableElement(makeGameView({
      pendingTransfer: { fromPlayerId: "seat-bob", toPlayerId: "seat-alice", targetSlotId: "seat-bob-top-right" },
      legalActions: ["chooseTransferTarget"],
    }), onCommand));
    await user.click(screen.getByRole("button", { name: /top left face-down card for alice.*transfer this card/i }));
    expect(onCommand).toHaveBeenLastCalledWith("chooseTransferTarget", { slotId: "seat-alice-top-left" });
  });

  it("renders pause, host removal, round results, ready-up, and final summary", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const seats = [
      makeSeat({ playerId: "seat-alice", displayName: "Alice", seatIndex: 0, isHost: true, readyForNextRound: false }),
      makeSeat({ playerId: "seat-bob", displayName: "Bob", seatIndex: 1, joinOrder: 1, connection: "disconnected", removalEligible: true, readyForNextRound: true }),
    ];
    const { rerender } = renderTable(makeGameView({
      seats,
      pauseReasons: ["seat-bob"],
      legalActions: ["hostRemovePlayer"],
    }), onCommand);

    expect(screen.getByRole("alert", { name: /match paused/i })).toHaveTextContent("Bob");
    await user.click(screen.getByRole("button", { name: "Remove Bob" }));
    expect(onCommand).toHaveBeenLastCalledWith("hostRemovePlayer", { targetPlayerId: "seat-bob" });

    rerender(tableElement(makeGameView({
      seats,
      status: "intermission",
      phase: "complete",
      turnStage: null,
      activePlayerId: null,
      legalActions: ["readyForNextRound"],
      cambio: { callerId: "seat-alice", finalTurnQueue: ["seat-bob"], completedFinalTurns: ["seat-bob"] },
      scores: [
        { playerId: "seat-alice", cumulativeScore: 0, lastRoundRawScore: 4, lastRoundMatchPoints: 0, isRoundWinner: true },
        { playerId: "seat-bob", cumulativeScore: 8, lastRoundRawScore: 8, lastRoundMatchPoints: 8, isRoundWinner: false },
      ],
    }), onCommand));
    expect(screen.getByRole("heading", { name: "Round results" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ready for next round" }));
    expect(onCommand).toHaveBeenLastCalledWith("readyForNextRound", {});

    rerender(tableElement(makeGameView({
      seats,
      status: "complete",
      phase: "complete",
      turnStage: null,
      actionLog: [{ type: "matchCompleted", winners: ["seat-alice"], cumulativeScores: { "seat-alice": 0, "seat-bob": 8 } }],
      scores: [
        { playerId: "seat-alice", cumulativeScore: 0 },
        { playerId: "seat-bob", cumulativeScore: 8 },
      ],
    }), onCommand));
    expect(screen.getByRole("heading", { name: "Final match summary" })).toHaveTextContent("Final match summary");
    expect(screen.getAllByText(/winners?: alice/i).length).toBeGreaterThan(0);
  });
});

function renderTable(view: StateSnapshotView, onCommand = vi.fn(), events: readonly PresentationEventPayload[] = []) {
  return render(tableElement(view, onCommand, events));
}

function tableElement(view: StateSnapshotView, onCommand: (type: CommandType, payload: unknown) => void, events: readonly PresentationEventPayload[] = []) {
  return (
    <GameTable
      snapshot={view}
      connectionStatus="connected"
      connectionAnnouncement="Connected"
      lastError={null}
      presentationEvents={events}
      onCommand={onCommand}
      onLeave={vi.fn()}
    />
  );
}
