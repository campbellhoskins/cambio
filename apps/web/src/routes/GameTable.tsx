import { useEffect, useMemo, useState } from "react";
import type {
  CommandType,
  PresentationEventPayload,
  SeatGridView,
  SeatView,
  SlotView,
  StateSnapshotView,
} from "@cambio/protocol";
import {
  Button,
  CardGrid,
  Dialog,
  DrawnCardTray,
  FieldError,
  LiveRegion,
  PileSummary,
  PublicActionLog,
  RulesLauncher,
  Scoreboard,
  formatCard,
  slotPositionLabel,
  type SlotAction,
} from "@cambio/ui";
import { usePresentationEffects } from "../presentation/effects.js";
import {
  PresentationSettingsControls,
  usePresentationSettings,
  usePresentationSound,
} from "../presentation/sound.js";

interface GameTableProps {
  readonly snapshot: StateSnapshotView;
  readonly connectionStatus: string;
  readonly connectionAnnouncement: string;
  readonly lastError: string | null;
  readonly presentationEvents: readonly PresentationEventPayload[];
  readonly onCommand: (type: CommandType, payload: unknown) => void;
  readonly onLeave: () => void;
}

type SlotMode = "replace" | "power" | "snap" | "transfer" | null;

export function GameTable({
  snapshot,
  connectionStatus,
  connectionAnnouncement,
  lastError,
  presentationEvents,
  onCommand,
  onLeave,
}: GameTableProps): React.ReactElement {
  const [snapMode, setSnapMode] = useState(false);
  const [hostEndOpen, setHostEndOpen] = useState(false);
  const legal = useMemo(() => new Set(snapshot.legalActions), [snapshot.legalActions]);
  const seats = useMemo(
    () => [...snapshot.seats].sort((left, right) => left.seatIndex - right.seatIndex),
    [snapshot.seats],
  );
  const names = useMemo(
    () => new Map(snapshot.seats.map((seat) => [seat.playerId, seat.displayName])),
    [snapshot.seats],
  );
  const viewer = seats.find((seat) => seat.playerId === snapshot.viewerSeatId);
  const activeName =
    snapshot.round.activePlayerId === null
      ? "No active player"
      : (names.get(snapshot.round.activePlayerId) ?? snapshot.round.activePlayerId);
  const countdown = useSnapCountdown(snapshot.snapWindow);
  const transientReveals = presentationEvents.flatMap((event) =>
    event.type === "wrongSnapReveal" ? [{ ...event.target, card: event.card }] : [],
  );
  const mode = currentSlotMode(snapshot, legal, snapMode);
  const pendingPowerOwned = snapshot.pendingPower?.ownerId === snapshot.viewerSeatId;
  const privateRevealSlots = privateRevealTargets(snapshot);
  const winners = matchWinners(snapshot);
  const drawnOwnerName =
    snapshot.drawnCard.state === "none" ? undefined : names.get(snapshot.drawnCard.playerId);
  const drawnOwnerProps = drawnOwnerName === undefined ? {} : { ownerName: drawnOwnerName };
  const presentationSettings = usePresentationSettings();
  const effects = usePresentationEffects(snapshot, presentationEvents);
  const sound = usePresentationSound(effects.soundCues, presentationSettings.preferences);
  const privateRevealEffectActive =
    effects.drawnCardEffect === "reveal" && !presentationSettings.effectiveReducedMotion;

  useEffect(() => {
    if (!legal.has("attemptSnap")) {
      setSnapMode(false);
    }
  }, [legal]);

  function send(type: CommandType, payload: unknown = {}): void {
    onCommand(type, payload);
  }

  function slotAction(grid: SeatGridView, slot: SlotView): SlotAction | null {
    if (slot.state === "hole") {
      return null;
    }

    if (mode === "snap" && snapshot.snapWindow !== null) {
      const { windowId, generation } = snapshot.snapWindow;
      return {
        label: "Attempt snap",
        onSelect: () =>
          send("attemptSnap", {
            snapWindowId: windowId,
            generation,
            targetPlayerId: grid.playerId,
            slotId: slot.slotId,
          }),
      };
    }

    if (mode === "transfer" && grid.playerId === snapshot.viewerSeatId) {
      return {
        label: "Transfer this card",
        onSelect: () => send("chooseTransferTarget", { slotId: slot.slotId }),
      };
    }

    if (mode === "replace" && grid.playerId === snapshot.viewerSeatId) {
      return {
        label: "Replace with drawn card",
        onSelect: () => send("replaceSlot", { slotId: slot.slotId }),
      };
    }

    if (mode === "power" && powerCanTarget(snapshot, grid.playerId, slot)) {
      const selected =
        snapshot.pendingPower?.selections.some(
          (target) => target.playerId === grid.playerId && target.slotId === slot.slotId,
        ) ?? false;
      const command = legal.has("reselectPowerTarget")
        ? "reselectPowerTarget"
        : "selectPowerTarget";
      return {
        label: legal.has("reselectPowerTarget") ? "Reselect power target" : "Select power target",
        selected,
        onSelect: () =>
          send(
            command,
            command === "reselectPowerTarget"
              ? { targetPlayerId: grid.playerId, slotId: slot.slotId }
              : { targetPlayerId: grid.playerId, slotId: slot.slotId },
          ),
      };
    }

    return null;
  }

  return (
    <div
      className="game-table"
      data-reduced-motion={presentationSettings.effectiveReducedMotion ? "true" : "false"}
    >
      <LiveRegion>{connectionAnnouncement}</LiveRegion>
      <LiveRegion>{turnAnnouncement(snapshot, names)}</LiveRegion>
      <LiveRegion>
        {countdown === null ? "" : `Snap window ${Math.ceil(countdown / 1_000)} seconds remaining.`}
      </LiveRegion>
      <LiveRegion>{effects.announcement}</LiveRegion>
      <LiveRegion politeness="assertive">
        {lastError ??
          pauseAnnouncement(snapshot, names) ??
          transientAnnouncement(presentationEvents)}
      </LiveRegion>

      <header className="room-header panel">
        <div>
          <p className="eyebrow">Room {snapshot.room.roomId}</p>
          <h2>{snapshot.room.status === "complete" ? "Match complete" : "Game table status"}</h2>
          <p>
            Round {snapshot.round.roundNumber ?? "—"} · {phaseLabel(snapshot)} · Active:{" "}
            {activeName}
          </p>
          {snapshot.round.cambio === null ? null : (
            <p className="final-turn-banner">
              Cambio called by{" "}
              {names.get(snapshot.round.cambio.callerId) ?? snapshot.round.cambio.callerId}. Final
              turns:{" "}
              {snapshot.round.cambio.finalTurnQueue
                .map((playerId) => names.get(playerId) ?? playerId)
                .join(", ")}
              .
            </p>
          )}
        </div>
        <span className={`connection-pill connection-pill--${connectionStatus}`}>
          {connectionStatus}
        </span>
        <div className="room-header__actions no-print">
          <RulesLauncher label="Rules" />
        </div>
      </header>

      {snapshot.pauseReasons.length === 0 ? null : (
        <section className="pause-overlay panel" role="alert" aria-labelledby="pause-title">
          <h2 id="pause-title">Match paused</h2>
          <p>{pauseAnnouncement(snapshot, names)}</p>
        </section>
      )}

      <section className="table-surface panel" aria-label="Authoritative card table">
        <div className="table-center">
          <PileSummary
            piles={snapshot.piles}
            pileEffect={effects.pileEffect}
            reducedMotion={presentationSettings.effectiveReducedMotion}
          />
          <DrawnCardTray
            drawnCard={snapshot.drawnCard}
            viewerSeatId={snapshot.viewerSeatId}
            effect={effects.drawnCardEffect}
            reducedMotion={presentationSettings.effectiveReducedMotion}
            {...drawnOwnerProps}
          />
          {snapshot.snapWindow === null ? null : (
            <div className="snap-countdown" role="timer" aria-label="Snap countdown">
              Snap window: {Math.ceil((countdown ?? snapshot.snapWindow.remainingMs) / 1_000)}s
              <progress
                value={countdown ?? snapshot.snapWindow.remainingMs}
                max={snapshot.snapWindow.durationMs}
              />
            </div>
          )}
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
                transientReveals={transientReveals}
                slotEffects={effects.slotEffects}
                reducedMotion={presentationSettings.effectiveReducedMotion}
                getSlotAction={(slot) => slotAction(grid, slot)}
              />
            );
          })}
        </div>
      </section>

      <section className="action-bar panel" aria-labelledby="actions-title">
        <h2 id="actions-title">Actions</h2>
        <p className="ui-muted">{actionPrompt(snapshot, mode)}</p>
        <div className="action-bar__buttons">
          <Button
            variant="primary"
            disabled={!legal.has("acknowledgeOpeningPeek")}
            onClick={() => send("acknowledgeOpeningPeek")}
          >
            Acknowledge opening peek
          </Button>
          <Button
            variant="primary"
            disabled={!legal.has("drawCard")}
            onClick={() => send("drawCard")}
          >
            Draw card
          </Button>
          <Button disabled={!legal.has("discardDrawn")} onClick={() => send("discardDrawn")}>
            Discard drawn card
          </Button>
          <Button disabled={!legal.has("callCambio")} onClick={() => send("callCambio")}>
            Call Cambio
          </Button>
          <Button
            disabled={!legal.has("skipPower") || !pendingPowerOwned}
            onClick={() => send("skipPower")}
          >
            Skip power
          </Button>
          <Button
            variant={snapMode ? "primary" : "secondary"}
            disabled={!legal.has("attemptSnap") || snapshot.snapWindow === null}
            aria-pressed={snapMode}
            onClick={() => setSnapMode((value) => !value)}
          >
            {snapMode ? "Exit snap mode" : "Enter snap mode"}
          </Button>
          <Button
            variant="primary"
            disabled={!legal.has("readyForNextRound")}
            onClick={() => send("readyForNextRound")}
          >
            Ready for next round
          </Button>
          <Button variant="danger" onClick={onLeave}>
            Leave room
          </Button>
        </div>
        <FieldError>{lastError}</FieldError>
        <PresentationSettingsControls settings={presentationSettings} sound={sound} />
      </section>

      <div className="side-panels">
        <Scoreboard
          seats={snapshot.seats}
          scores={snapshot.scores}
          highlight={effects.scoreEffect}
          reducedMotion={presentationSettings.effectiveReducedMotion}
        />
        <section className="ui-card" aria-labelledby="lifecycle-title">
          <div className="ui-card__header">
            <h2 id="lifecycle-title">Host and lifecycle</h2>
          </div>
          <p>
            Host:{" "}
            {snapshot.room.hostPlayerId === null
              ? "none"
              : (names.get(snapshot.room.hostPlayerId) ?? snapshot.room.hostPlayerId)}
          </p>
          {seats
            .filter((seat) => seat.removalEligible)
            .map((seat) => (
              <Button
                key={seat.playerId}
                disabled={!legal.has("hostRemovePlayer")}
                onClick={() => send("hostRemovePlayer", { targetPlayerId: seat.playerId })}
              >
                Remove {seat.displayName}
              </Button>
            ))}
          <Button
            variant="danger"
            disabled={viewer?.isHost !== true || snapshot.room.status === "complete"}
            onClick={() => setHostEndOpen(true)}
          >
            End match
          </Button>
        </section>
        <PublicActionLog entries={snapshot.actionLog} seats={snapshot.seats} />
      </div>

      {snapshot.room.status === "intermission" ? (
        <section className="panel result-panel" aria-labelledby="round-results-title">
          <h2 id="round-results-title">Round results</h2>
          <p>{callerAdjustmentText(snapshot, names)}</p>
          <p>
            Ready players: {snapshot.seats.filter((seat) => seat.readyForNextRound).length}/
            {snapshot.seats.filter((seat) => seat.connection !== "removed").length}
          </p>
        </section>
      ) : null}

      {snapshot.room.status === "complete" ? (
        <section className="panel result-panel" aria-labelledby="match-summary-title">
          <h2 id="match-summary-title">Final match summary</h2>
          <p>
            Winner{winners.length === 1 ? "" : "s"}:{" "}
            {winners.map((playerId) => names.get(playerId) ?? playerId).join(", ")}.
          </p>
        </section>
      ) : null}

      <Dialog
        title="Private power reveal"
        open={pendingPowerOwned && snapshot.pendingPower?.stage === "awaitingRevealAck"}
        onClose={() => send("acknowledgePowerReveal")}
      >
        <div
          className={privateRevealEffectActive ? "private-reveal-effect" : undefined}
          data-effect={privateRevealEffectActive ? "reveal" : undefined}
        >
          <p>Only your server-authorized view is shown here.</p>
          <ul>
            {privateRevealSlots.map(({ seat, slot }) => (
              <li key={`${seat.playerId}-${slot.slotId}`}>
                {seat.displayName}, {slotPositionLabel(slot)}:{" "}
                {slot.state === "revealed" ? formatCard(slot.card) : "face down"}
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            disabled={!legal.has("acknowledgePowerReveal")}
            onClick={() => send("acknowledgePowerReveal")}
          >
            Acknowledge reveal
          </Button>
        </div>
      </Dialog>

      <Dialog
        title="Black King decision"
        open={pendingPowerOwned && snapshot.pendingPower?.stage === "awaitingKingDecision"}
        onClose={() => send("decideBlackKingSwap", { decision: "decline" })}
      >
        <p>Confirm to swap the selected positions, or decline to leave them in place.</p>
        <div className="action-bar__buttons">
          <Button
            variant="primary"
            disabled={!legal.has("decideBlackKingSwap")}
            onClick={() => send("decideBlackKingSwap", { decision: "confirm" })}
          >
            Confirm swap
          </Button>
          <Button
            disabled={!legal.has("decideBlackKingSwap")}
            onClick={() => send("decideBlackKingSwap", { decision: "decline" })}
          >
            Decline swap
          </Button>
        </div>
      </Dialog>

      <Dialog title="End match?" open={hostEndOpen} onClose={() => setHostEndOpen(false)}>
        <p>This host action abandons the active match. Scores from completed rounds remain.</p>
        <Button
          variant="danger"
          onClick={() => {
            setHostEndOpen(false);
            send("hostEndMatch");
          }}
        >
          Confirm end match
        </Button>
      </Dialog>
    </div>
  );
}

function useSnapCountdown(windowView: StateSnapshotView["snapWindow"]): number | null {
  const [remaining, setRemaining] = useState<number | null>(windowView?.remainingMs ?? null);

  useEffect(() => {
    if (windowView === null) {
      setRemaining(null);
      return;
    }

    const startedAt = Date.now();
    setRemaining(windowView.remainingMs);
    const handle = window.setInterval(() => {
      setRemaining(Math.max(0, windowView.remainingMs - (Date.now() - startedAt)));
    }, 250);
    return () => window.clearInterval(handle);
  }, [windowView]);

  return remaining;
}

function currentSlotMode(
  snapshot: StateSnapshotView,
  legal: ReadonlySet<string>,
  snapMode: boolean,
): SlotMode {
  if (snapMode && legal.has("attemptSnap") && snapshot.snapWindow !== null) {
    return "snap";
  }
  if (snapshot.pendingTransfer !== null && legal.has("chooseTransferTarget")) {
    return "transfer";
  }
  if (legal.has("replaceSlot") && snapshot.drawnCard.state !== "none") {
    return "replace";
  }
  if (
    snapshot.pendingPower?.ownerId === snapshot.viewerSeatId &&
    (legal.has("selectPowerTarget") || legal.has("reselectPowerTarget"))
  ) {
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

function actionPrompt(snapshot: StateSnapshotView, mode: SlotMode): string {
  if (mode === "snap") {
    return "Snap mode is active. Choose any occupied slot with mouse, touch, or keyboard.";
  }
  if (mode === "transfer") {
    return "Choose one of your occupied slots to transfer after the successful opponent snap.";
  }
  if (mode === "replace") {
    return "Choose one of your occupied slots to replace with the drawn card.";
  }
  if (mode === "power" && snapshot.pendingPower !== null) {
    return `${snapshot.pendingPower.kind} power: choose the requested target.`;
  }
  return "Available buttons are enabled from the latest server legal-action hints.";
}

function phaseLabel(snapshot: StateSnapshotView): string {
  if (snapshot.round.phase === null) {
    return snapshot.room.status;
  }
  return snapshot.round.turnStage === null
    ? snapshot.round.phase
    : `${snapshot.round.phase} / ${snapshot.round.turnStage}`;
}

function pauseAnnouncement(
  snapshot: StateSnapshotView,
  names: ReadonlyMap<string, string>,
): string | null {
  if (snapshot.pauseReasons.length === 0) {
    return null;
  }
  return `Paused for ${snapshot.pauseReasons.map((playerId) => names.get(playerId) ?? playerId).join(", ")}.`;
}

function turnAnnouncement(snapshot: StateSnapshotView, names: ReadonlyMap<string, string>): string {
  if (snapshot.round.activePlayerId === null) {
    return "";
  }
  return `${names.get(snapshot.round.activePlayerId) ?? snapshot.round.activePlayerId} is active.`;
}

function transientAnnouncement(events: readonly PresentationEventPayload[]): string {
  return events.some((event) => event.type === "wrongSnapReveal")
    ? "Wrong snap reveal shown briefly."
    : "";
}

function privateRevealTargets(
  snapshot: StateSnapshotView,
): { readonly seat: SeatView; readonly slot: SlotView }[] {
  if (snapshot.pendingPower === null) {
    return [];
  }

  const targets = snapshot.pendingPower.selections;
  return targets.flatMap((target) => {
    const seat = snapshot.seats.find((candidate) => candidate.playerId === target.playerId);
    const grid = snapshot.grids.find((candidate) => candidate.playerId === target.playerId);
    const slot = grid?.slots.find((candidate) => candidate.slotId === target.slotId);
    return seat === undefined || slot === undefined ? [] : [{ seat, slot }];
  });
}

function matchWinners(snapshot: StateSnapshotView): string[] {
  const completed = [...snapshot.actionLog]
    .reverse()
    .find((entry) => entry.type === "matchCompleted");
  if (completed?.type === "matchCompleted") {
    return completed.winners;
  }

  const lowest = Math.min(...snapshot.scores.map((score) => score.cumulativeScore));
  return snapshot.scores
    .filter((score) => score.cumulativeScore === lowest)
    .map((score) => score.playerId);
}

function callerAdjustmentText(
  snapshot: StateSnapshotView,
  names: ReadonlyMap<string, string>,
): string {
  if (snapshot.round.cambio === null) {
    return "No Cambio caller adjustment applies to this round ending.";
  }
  const caller = names.get(snapshot.round.cambio.callerId) ?? snapshot.round.cambio.callerId;
  const callerScore = snapshot.scores.find(
    (score) => score.playerId === snapshot.round.cambio?.callerId,
  );
  if (callerScore?.lastRoundMatchPoints === 0) {
    return `${caller} called Cambio and had the unique lowest raw total, so the caller scores 0.`;
  }
  return `${caller} called Cambio. The score table shows the server-provided caller adjustment.`;
}
