import { useMemo, useState } from "react";
import type { CommandType, SeatGridView, SlotView, StateSnapshotView } from "@cambio/protocol";
import {
  Button,
  CardGrid,
  DrawnCardTray,
  FieldError,
  PileSummary,
  PublicActionLog,
  Scoreboard,
  type SlotAction,
} from "@cambio/ui";

interface TutorialTableProps {
  readonly snapshot: StateSnapshotView;
  readonly transientReveals: readonly { readonly playerId: string; readonly slotId: string; readonly card: StateSnapshotView["piles"]["discardTop"] }[];
  readonly error: string | null;
  readonly onCommand: (type: CommandType, payload?: unknown) => void;
}

type SlotMode = "replace" | "power" | "snap" | "transfer" | null;

export function TutorialTable({
  snapshot,
  transientReveals,
  error,
  onCommand,
}: TutorialTableProps): React.ReactElement {
  const [snapMode, setSnapMode] = useState(false);
  const legal = useMemo(() => new Set(snapshot.legalActions), [snapshot.legalActions]);
  const seats = useMemo(
    () => [...snapshot.seats].sort((left, right) => left.seatIndex - right.seatIndex),
    [snapshot.seats],
  );
  const names = useMemo(
    () => new Map(snapshot.seats.map((seat) => [seat.playerId, seat.displayName])),
    [snapshot.seats],
  );
  const mode = currentSlotMode(snapshot, legal, snapMode);
  const activeName =
    snapshot.round.activePlayerId === null
      ? "No active player"
      : (names.get(snapshot.round.activePlayerId) ?? snapshot.round.activePlayerId);

  function send(type: CommandType, payload: unknown = {}): void {
    onCommand(type, payload);
  }

  function slotAction(grid: SeatGridView, slot: SlotView): SlotAction | null {
    if (slot.state === "hole") {
      return null;
    }
    if (mode === "snap" && snapshot.snapWindow !== null) {
      return {
        label: "Attempt snap",
        onSelect: () =>
          send("attemptSnap", {
            snapWindowId: snapshot.snapWindow?.windowId,
            generation: snapshot.snapWindow?.generation,
            targetPlayerId: grid.playerId,
            slotId: slot.slotId,
          }),
      };
    }
    if (mode === "transfer" && grid.playerId === snapshot.viewerSeatId) {
      return { label: "Transfer this card", onSelect: () => send("chooseTransferTarget", { slotId: slot.slotId }) };
    }
    if (mode === "replace" && grid.playerId === snapshot.viewerSeatId) {
      return { label: "Replace with drawn card", onSelect: () => send("replaceSlot", { slotId: slot.slotId }) };
    }
    if (mode === "power" && powerCanTarget(snapshot, grid.playerId, slot)) {
      return {
        label: legal.has("reselectPowerTarget") ? "Reselect power target" : "Select power target",
        selected:
          snapshot.pendingPower?.selections.some(
            (target) => target.playerId === grid.playerId && target.slotId === slot.slotId,
          ) ?? false,
        onSelect: () =>
          send(legal.has("reselectPowerTarget") ? "reselectPowerTarget" : "selectPowerTarget", {
            targetPlayerId: grid.playerId,
            slotId: slot.slotId,
          }),
      };
    }
    return null;
  }

  return (
    <section className="tutorial-table panel" aria-labelledby="tutorial-table-title">
      <div className="tutorial-table__status">
        <div>
          <p className="eyebrow">Offline practice table</p>
          <h2 id="tutorial-table-title">Tutorial table</h2>
          <p>
            Round {snapshot.round.roundNumber ?? "—"} · {snapshot.round.phase ?? snapshot.room.status} · Active: {activeName}
          </p>
        </div>
        {snapshot.snapWindow === null ? null : (
          <div role="timer" aria-label="Tutorial snap timer">
            Snap window: {Math.ceil(snapshot.snapWindow.remainingMs / 1_000)}s
          </div>
        )}
      </div>

      <div className="table-surface" aria-label="Offline tutorial card table">
        <div className="table-center">
          <PileSummary piles={snapshot.piles} reducedMotion />
          <DrawnCardTray drawnCard={snapshot.drawnCard} viewerSeatId={snapshot.viewerSeatId} reducedMotion />
        </div>
        <div className="seat-ring">
          {seats.map((seat) => {
            const grid = snapshot.grids.find((candidate) => candidate.playerId === seat.playerId);
            return grid === undefined ? null : (
              <CardGrid
                key={seat.playerId}
                seat={seat}
                grid={grid}
                viewerSeatId={snapshot.viewerSeatId}
                transientReveals={transientReveals.filter((reveal): reveal is { readonly playerId: string; readonly slotId: string; readonly card: NonNullable<StateSnapshotView["piles"]["discardTop"]> } => reveal.card !== null)}
                reducedMotion
                getSlotAction={(slot) => slotAction(grid, slot)}
              />
            );
          })}
        </div>
      </div>

      <div className="action-bar" aria-labelledby="tutorial-actions-title">
        <h3 id="tutorial-actions-title">Available learner actions</h3>
        <p className="ui-muted">Use these controls or the guided action button above.</p>
        <div className="action-bar__buttons">
          <Button disabled={!legal.has("acknowledgeOpeningPeek")} onClick={() => send("acknowledgeOpeningPeek")}>Acknowledge opening peek</Button>
          <Button disabled={!legal.has("drawCard")} onClick={() => send("drawCard")}>Draw card</Button>
          <Button disabled={!legal.has("discardDrawn")} onClick={() => send("discardDrawn")}>Discard drawn card</Button>
          <Button disabled={!legal.has("callCambio")} onClick={() => send("callCambio")}>Call Cambio</Button>
          <Button disabled={!legal.has("skipPower")} onClick={() => send("skipPower")}>Skip power</Button>
          <Button
            disabled={!legal.has("attemptSnap") || snapshot.snapWindow === null}
            aria-pressed={snapMode}
            onClick={() => setSnapMode((value) => !value)}
          >
            {snapMode ? "Exit snap mode" : "Enter snap mode"}
          </Button>
          <Button disabled={!legal.has("acknowledgePowerReveal")} onClick={() => send("acknowledgePowerReveal")}>Acknowledge reveal</Button>
          <Button disabled={!legal.has("decideBlackKingSwap")} onClick={() => send("decideBlackKingSwap", { decision: "confirm" })}>Confirm swap</Button>
          <Button disabled={!legal.has("decideBlackKingSwap")} onClick={() => send("decideBlackKingSwap", { decision: "decline" })}>Decline swap</Button>
          <Button disabled={!legal.has("readyForNextRound")} onClick={() => send("readyForNextRound")}>Ready for next round</Button>
        </div>
        <FieldError>{error}</FieldError>
      </div>

      <div className="side-panels">
        <Scoreboard seats={snapshot.seats} scores={snapshot.scores} reducedMotion />
        <PublicActionLog entries={snapshot.actionLog} seats={snapshot.seats} />
      </div>
    </section>
  );
}

function currentSlotMode(snapshot: StateSnapshotView, legal: ReadonlySet<string>, snapMode: boolean): SlotMode {
  if (snapMode && legal.has("attemptSnap") && snapshot.snapWindow !== null) {
    return "snap";
  }
  if (snapshot.pendingTransfer !== null && legal.has("chooseTransferTarget")) {
    return "transfer";
  }
  if (legal.has("replaceSlot") && snapshot.drawnCard.state !== "none") {
    return "replace";
  }
  if (snapshot.pendingPower?.ownerId === snapshot.viewerSeatId && (legal.has("selectPowerTarget") || legal.has("reselectPowerTarget"))) {
    return "power";
  }
  return null;
}

function powerCanTarget(snapshot: StateSnapshotView, playerId: string, slot: SlotView): boolean {
  if (snapshot.pendingPower === null || slot.state === "hole") {
    return false;
  }
  const own = playerId === snapshot.viewerSeatId;
  switch (snapshot.pendingPower.kind) {
    case "peekOwn":
      return own;
    case "peekOpponent":
      return !own;
    case "blindSwap":
      return true;
    case "blackKing":
      return snapshot.pendingPower.stage === "selectingFirst" ? own : !own;
  }
}
