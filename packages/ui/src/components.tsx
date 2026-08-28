import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ActionLogEntry, CardView, SeatGridView, SeatView, SlotTarget, SlotView, StateSnapshotView } from "@cambio/protocol";

export function Button({
  children,
  type = "button",
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "danger" | "ghost";
}): ReactNode {
  return (
    <button type={type} className={`ui-button ui-button--${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function FieldError({ id, children }: { readonly id?: string; readonly children: ReactNode }): ReactNode {
  if (children === null || children === undefined || children === "") {
    return null;
  }

  return (
    <p id={id} className="ui-field-error" role="alert">
      {children}
    </p>
  );
}

export function TextField({
  label,
  error,
  description,
  className = "",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  readonly label: string;
  readonly error?: string;
  readonly description?: string;
}): ReactNode {
  const generated = useId();
  const inputId = props.id ?? generated;
  const errorId = `${inputId}-error`;
  const descriptionId = `${inputId}-description`;
  const describedBy = [description === undefined ? undefined : descriptionId, error === undefined ? undefined : errorId]
    .filter((value): value is string => value !== undefined)
    .join(" ") || undefined;

  return (
    <label className={`ui-field ${className}`.trim()} htmlFor={inputId}>
      <span className="ui-field__label">{label}</span>
      {description === undefined ? null : <span id={descriptionId} className="ui-field__description">{description}</span>}
      <input {...props} id={inputId} type="text" aria-invalid={error === undefined ? undefined : true} aria-describedby={describedBy} />
      <FieldError id={errorId}>{error}</FieldError>
    </label>
  );
}

export function NumberField({
  label,
  error,
  description,
  className = "",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  readonly label: string;
  readonly error?: string;
  readonly description?: string;
}): ReactNode {
  const generated = useId();
  const inputId = props.id ?? generated;
  const errorId = `${inputId}-error`;
  const descriptionId = `${inputId}-description`;
  const describedBy = [description === undefined ? undefined : descriptionId, error === undefined ? undefined : errorId]
    .filter((value): value is string => value !== undefined)
    .join(" ") || undefined;

  return (
    <label className={`ui-field ${className}`.trim()} htmlFor={inputId}>
      <span className="ui-field__label">{label}</span>
      {description === undefined ? null : <span id={descriptionId} className="ui-field__description">{description}</span>}
      <input {...props} id={inputId} type="number" aria-invalid={error === undefined ? undefined : true} aria-describedby={describedBy} />
      <FieldError id={errorId}>{error}</FieldError>
    </label>
  );
}

export function LiveRegion({
  children,
  politeness = "polite",
}: {
  readonly children: ReactNode;
  readonly politeness?: "polite" | "assertive";
}): ReactNode {
  return (
    <div className="sr-only" aria-live={politeness} aria-atomic="true">
      {children}
    </div>
  );
}

export function Dialog({
  title,
  children,
  open,
  onClose,
  closeLabel = "Close dialog",
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly closeLabel?: string;
}): ReactNode {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();

    return () => previousFocus.current?.focus();
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="ui-dialog" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-dialog__panel"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
      >
        <div className="ui-dialog__header">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" aria-label={closeLabel} onClick={onClose}>×</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Roster({
  seats,
  viewerSeatId,
}: {
  readonly seats: readonly SeatView[];
  readonly viewerSeatId?: string;
}): ReactNode {
  return (
    <section className="ui-card" aria-labelledby="roster-title">
      <div className="ui-card__header">
        <h2 id="roster-title">Players</h2>
        <span>{seats.length}/6</span>
      </div>
      <ul className="ui-roster" aria-label="Room roster">
        {seats.map((seat) => (
          <li key={seat.playerId} className="ui-roster__item">
            <span className="ui-roster__name">
              {seat.displayName}{seat.playerId === viewerSeatId ? " (you)" : ""}
            </span>
            <span className="ui-roster__meta">
              {seat.isHost ? <span className="ui-badge">Host</span> : null}
              <span className={`ui-status ui-status--${seat.connection}`}>{connectionLabel(seat.connection)}</span>
              {seat.removalEligible ? <span className="ui-badge ui-badge--warning">Removal eligible</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface HostConfigLimits {
  readonly roundCount: { readonly min: number; readonly max: number };
  readonly snapWindowSeconds: { readonly min: number; readonly max: number };
  readonly playerCap: { readonly min: number; readonly max: number };
}

export function HostConfigPanel({
  config,
  isHost,
  limits,
  disabled = false,
  error,
  onSubmit,
}: {
  readonly config: StateSnapshotView["room"]["config"];
  readonly isHost: boolean;
  readonly limits: HostConfigLimits;
  readonly disabled?: boolean;
  readonly error?: string;
  readonly onSubmit: (config: StateSnapshotView["room"]["config"]) => void;
}): ReactNode {
  const [roundCount, setRoundCount] = useState(String(config.roundCount));
  const [snapWindowSeconds, setSnapWindowSeconds] = useState(String(config.snapWindowMs / 1_000));
  const [playerCap, setPlayerCap] = useState(String(config.playerCap));

  useEffect(() => {
    setRoundCount(String(config.roundCount));
    setSnapWindowSeconds(String(config.snapWindowMs / 1_000));
    setPlayerCap(String(config.playerCap));
  }, [config.playerCap, config.roundCount, config.snapWindowMs]);

  const controlsDisabled = disabled || !isHost;

  return (
    <section className="ui-card" aria-labelledby="settings-title">
      <div className="ui-card__header">
        <h2 id="settings-title">Lobby settings</h2>
        {isHost ? <span className="ui-badge">Host controls</span> : <span className="ui-muted">Waiting for host</span>}
      </div>
      <form
        className="ui-form ui-form--compact"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSubmit({
            roundCount: Number(roundCount),
            snapWindowMs: Number(snapWindowSeconds) * 1_000,
            playerCap: Number(playerCap),
          });
        }}
      >
        <NumberField
          label="Rounds"
          min={limits.roundCount.min}
          max={limits.roundCount.max}
          step={1}
          value={roundCount}
          disabled={controlsDisabled}
          onChange={(event) => setRoundCount(event.currentTarget.value)}
        />
        <NumberField
          label="Snap window seconds"
          min={limits.snapWindowSeconds.min}
          max={limits.snapWindowSeconds.max}
          step={1}
          value={snapWindowSeconds}
          disabled={controlsDisabled}
          onChange={(event) => setSnapWindowSeconds(event.currentTarget.value)}
        />
        <NumberField
          label="Player cap"
          min={limits.playerCap.min}
          max={limits.playerCap.max}
          step={1}
          value={playerCap}
          disabled={controlsDisabled}
          onChange={(event) => setPlayerCap(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary" disabled={controlsDisabled}>Save settings</Button>
        <FieldError>{error}</FieldError>
      </form>
    </section>
  );
}

export function ShareRoomPanel({
  roomCode,
  roomLink,
  onCopy,
  copied = false,
}: {
  readonly roomCode: string;
  readonly roomLink: string;
  readonly onCopy: () => void;
  readonly copied?: boolean;
}): ReactNode {
  return (
    <section className="ui-card" aria-labelledby="share-title">
      <div className="ui-card__header">
        <h2 id="share-title">Invite players</h2>
      </div>
      <p className="ui-muted">Share the room code or link. Reconnect credentials are never included.</p>
      <dl className="ui-share">
        <dt>Room code</dt>
        <dd><code>{roomCode}</code></dd>
        <dt>Room link</dt>
        <dd><code>{roomLink}</code></dd>
      </dl>
      <Button onClick={onCopy}>Copy room link</Button>
      <span className="ui-copy-status" aria-live="polite">{copied ? "Copied room link" : ""}</span>
    </section>
  );
}

export function StartMatchPanel({
  canStart,
  isHost,
  playerCount,
  onStart,
}: {
  readonly canStart: boolean;
  readonly isHost: boolean;
  readonly playerCount: number;
  readonly onStart: () => void;
}): ReactNode {
  const reason = isHost
    ? playerCount < 2
      ? "At least 2 players are required."
      : "Ready to start."
    : "Only the host can start the match.";

  return (
    <section className="ui-card" aria-labelledby="start-title">
      <h2 id="start-title">Start match</h2>
      <p>{reason}</p>
      <Button variant="primary" disabled={!canStart} onClick={onStart}>Start match</Button>
    </section>
  );
}

export function CardBack({ label = "Face-down card" }: { readonly label?: string }): ReactNode {
  return <div className="ui-card-back" role="img" aria-label={label} />;
}

export interface SlotAction {
  readonly label: string;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly onSelect: () => void;
}

export function CardGrid({
  seat,
  grid,
  viewerSeatId,
  transientReveals = [],
  getSlotAction,
}: {
  readonly seat: SeatView;
  readonly grid: SeatGridView;
  readonly viewerSeatId: string;
  readonly transientReveals?: readonly (SlotTarget & { readonly card: CardView })[];
  readonly getSlotAction?: (slot: SlotView) => SlotAction | null;
}): ReactNode {
  const slots = [...grid.slots].sort(compareSlots);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (focusIndex >= slots.length) {
      setFocusIndex(0);
    }
  }, [focusIndex, slots.length]);

  function moveFocus(nextIndex: number): void {
    const bounded = ((nextIndex % slots.length) + slots.length) % slots.length;
    setFocusIndex(bounded);
    buttonRefs.current[bounded]?.focus();
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (slots.length === 0) {
      return;
    }

    const current = buttonRefs.current.findIndex((button) => button === event.target);
    const base = current === -1 ? focusIndex : current;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocus(base + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(base - 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(base + 2);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(base - 2);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(slots.length - 1);
        break;
    }
  }

  return (
    <section className="ui-seat-grid" aria-labelledby={`seat-${seat.playerId}-title`}>
      <div className="ui-seat-grid__header">
        <h3 id={`seat-${seat.playerId}-title`}>
          {seat.displayName}{seat.playerId === viewerSeatId ? " (you)" : ""}
        </h3>
        <span className={`ui-status ui-status--${seat.connection}`}>{connectionLabel(seat.connection)}</span>
      </div>
      <div
        className="ui-card-grid"
        role="group"
        aria-label={`${seat.displayName} card grid`}
        onKeyDown={onGridKeyDown}
      >
        {slots.map((slot, index) => {
          const action = getSlotAction?.(slot) ?? null;
          const reveal = transientReveals.find((candidate) => candidate.playerId === grid.playerId && candidate.slotId === slot.slotId);
          const unavailable = action === null || action.disabled === true;
          return (
            <button
              key={slot.slotId}
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              type="button"
              className={[
                "ui-slot",
                `ui-slot--${slot.state}`,
                action?.selected === true ? "ui-slot--selected" : "",
                unavailable ? "ui-slot--unavailable" : "ui-slot--actionable",
              ].filter(Boolean).join(" ")}
              aria-label={slotAriaLabel(slot, seat, action, reveal?.card)}
              aria-disabled={unavailable}
              aria-selected={action?.selected === true ? true : undefined}
              tabIndex={index === focusIndex ? 0 : -1}
              data-slot-id={slot.slotId}
              data-position={slot.position ?? "penalty"}
              onFocus={() => setFocusIndex(index)}
              onClick={() => {
                if (!unavailable) {
                  action.onSelect();
                }
              }}
            >
              <span className="ui-slot__position">{slotPositionLabel(slot)}</span>
              {renderSlotContents(slot, reveal?.card)}
              {action === null ? null : <span className="ui-slot__action">{action.label}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Scoreboard({
  seats,
  scores,
}: {
  readonly seats: readonly SeatView[];
  readonly scores: StateSnapshotView["scores"];
}): ReactNode {
  const names = playerNames(seats);

  return (
    <section className="ui-card" aria-labelledby="scoreboard-title">
      <div className="ui-card__header">
        <h2 id="scoreboard-title">Scores</h2>
      </div>
      <table className="ui-scoreboard">
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Round raw</th>
            <th scope="col">Round points</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((score) => (
            <tr key={score.playerId}>
              <th scope="row">
                {names.get(score.playerId) ?? score.playerId}
                {score.isRoundWinner === true ? <span className="ui-badge">Round winner</span> : null}
              </th>
              <td>{score.lastRoundRawScore ?? "—"}</td>
              <td>{score.lastRoundMatchPoints ?? "—"}</td>
              <td>{score.cumulativeScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function PileSummary({ piles }: { readonly piles: StateSnapshotView["piles"] }): ReactNode {
  return (
    <section className="ui-piles" aria-label="Card piles">
      <div className="ui-pile">
        <span className="ui-pile__label">Draw pile</span>
        <CardBack label={`Draw pile, ${piles.drawPileCount} cards remaining`} />
        <strong>{piles.drawPileCount} cards</strong>
      </div>
      <div className="ui-pile">
        <span className="ui-pile__label">Discard pile</span>
        {piles.discardTop === null ? <span className="ui-empty-card">No discard</span> : <CardFace card={piles.discardTop} />}
        <strong>{piles.discardPileCount} cards</strong>
      </div>
      <div className="ui-pile">
        <span className="ui-pile__label">Out of play</span>
        <strong>{piles.outOfPlayCount} cards</strong>
      </div>
    </section>
  );
}

export function DrawnCardTray({ drawnCard, viewerSeatId, ownerName }: {
  readonly drawnCard: StateSnapshotView["drawnCard"];
  readonly viewerSeatId: string;
  readonly ownerName?: string;
}): ReactNode {
  const owner = ownerName ?? (drawnCard.state === "none" ? "" : drawnCard.playerId);
  return (
    <section className="ui-drawn-tray" aria-labelledby="drawn-card-title">
      <h2 id="drawn-card-title">Drawn card</h2>
      {drawnCard.state === "none" ? (
        <p>No card is drawn.</p>
      ) : drawnCard.state === "hidden" ? (
        <div>
          <CardBack label={`Drawn card held by ${owner}`} />
          <p>{drawnCard.playerId === viewerSeatId ? "Your drawn card is face down." : `${owner} has a drawn card.`}</p>
        </div>
      ) : (
        <div>
          <CardFace card={drawnCard.card} />
          <p>{drawnCard.playerId === viewerSeatId ? "Your drawn card." : `Drawn card held by ${owner}.`}</p>
        </div>
      )}
    </section>
  );
}

export function PublicActionLog({
  entries,
  seats,
}: {
  readonly entries: readonly ActionLogEntry[];
  readonly seats: readonly SeatView[];
}): ReactNode {
  const names = playerNames(seats);
  const visibleEntries = entries.slice(-12).reverse();

  return (
    <section className="ui-card" aria-labelledby="action-log-title">
      <div className="ui-card__header">
        <h2 id="action-log-title">Public history</h2>
      </div>
      {visibleEntries.length === 0 ? (
        <p className="ui-muted">No public actions yet.</p>
      ) : (
        <ol className="ui-action-log">
          {visibleEntries.map((entry, index) => (
            <li key={`${entry.type}-${index}`}>{formatActionLogEntry(entry, names)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function CardFace({ card }: { readonly card: CardView }): ReactNode {
  if (card.rank === "JOKER") {
    return (
      <span className="ui-card-face" role="img" aria-label="Joker">
        <span className="ui-card-face__rank">Joker</span>
      </span>
    );
  }

  const suit = suitLabel(card.suit);
  return (
    <span className={`ui-card-face ui-card-face--${card.suit}`} role="img" aria-label={`${rankLabel(card.rank)} of ${suit.text}`}>
      <span className="ui-card-face__rank">{rankLabel(card.rank)}</span>
      <span className="ui-card-face__suit" aria-hidden="true">{suit.symbol}</span>
      <span className="sr-only">{suit.text}</span>
    </span>
  );
}

export function formatCard(card: CardView): string {
  return card.rank === "JOKER" ? "Joker" : `${rankLabel(card.rank)} of ${suitLabel(card.suit).text}`;
}

export function slotPositionLabel(slot: SlotView | SlotTarget): string {
  if ("position" in slot) {
    switch (slot.position) {
      case "topLeft":
        return "Top left";
      case "topRight":
        return "Top right";
      case "bottomLeft":
        return "Bottom left";
      case "bottomRight":
        return "Bottom right";
      case null:
        return `Penalty ${slot.slotId}`;
    }
  }

  return `Slot ${slot.slotId}`;
}

export function formatActionLogEntry(entry: ActionLogEntry, names: ReadonlyMap<string, string>): string {
  switch (entry.type) {
    case "roundDealt":
      return `Round ${entry.roundNumber} dealt by ${nameFor(names, entry.dealerId)}.`;
    case "openingPeekAcknowledged":
      return `${nameFor(names, entry.playerId)} acknowledged opening peek (${entry.acknowledgedCount}/${entry.requiredCount}).`;
    case "turnStarted":
      return `${nameFor(names, entry.activePlayerId)} started a turn.`;
    case "cardDrawn":
      return `${nameFor(names, entry.playerId)} drew a card.`;
    case "reshuffled":
      return `${entry.cardCount} discard cards were reshuffled into the draw pile.`;
    case "slotReplaced":
      return `${nameFor(names, entry.playerId)} replaced slot ${entry.slotId}.`;
    case "cardDiscarded":
      return `${nameFor(names, entry.playerId)} discarded the drawn card.`;
    case "cambioCalled":
      return `${nameFor(names, entry.callerId)} called Cambio. Final turns: ${entry.finalTurnQueue.map((playerId) => nameFor(names, playerId)).join(", ") || "none"}.`;
    case "turnAdvanced":
      return `Turn advanced from ${nameFor(names, entry.previousPlayerId)} to ${nameFor(names, entry.activePlayerId)}.`;
    case "roundEnded":
      return `Round ended (${entry.reason}). Scores recorded for ${entry.scores.length} players.`;
    case "readyForNextRound":
      return `${nameFor(names, entry.playerId)} is ready for the next round (${entry.readyCount}/${entry.requiredCount}).`;
    case "matchCompleted":
      return `Match complete. Winner${entry.winners.length === 1 ? "" : "s"}: ${entry.winners.map((playerId) => nameFor(names, playerId)).join(", ")}.`;
    case "snapWindowOpened":
      return "A snap window opened.";
    case "snapWindowClosed":
      return entry.resolvedBy === null ? "The snap window closed." : `${nameFor(names, entry.resolvedBy)} resolved the snap window.`;
    case "powerOffered":
      return `${nameFor(names, entry.ownerId)} may use ${powerLabel(entry.kind)}.`;
    case "powerSkipped":
      return `${nameFor(names, entry.ownerId)} skipped ${powerLabel(entry.kind)}.`;
    case "powerTargetSelected":
      return `${nameFor(names, entry.ownerId)} selected a ${powerLabel(entry.kind)} target.`;
    case "powerRevealed":
      return `${nameFor(names, entry.recipientId)} received a private ${entry.cardCount}-card reveal.`;
    case "powerRevealAcknowledged":
      return `${nameFor(names, entry.ownerId)} acknowledged ${powerLabel(entry.kind)} reveal.`;
    case "blackKingSwapDecided":
      return `${nameFor(names, entry.ownerId)} ${entry.swapped ? "completed" : "declined"} the Black King swap.`;
    case "powerTargetInvalidated":
      return `${nameFor(names, entry.ownerId)} must reselect a ${powerLabel(entry.kind)} target.`;
    case "snapAttempted":
      return `${nameFor(names, entry.playerId)} attempted a snap at slot ${entry.target.slotId}; ${entry.correct ? "correct" : "wrong, penalty drawn"}.`;
    case "penaltyCardDrawn":
      return `${nameFor(names, entry.playerId)} drew a penalty card into slot ${entry.slotId}.`;
    case "transferCompleted":
      return `${nameFor(names, entry.toPlayerId)} transferred a card to ${nameFor(names, entry.fromPlayerId)}.`;
    case "playerRemoved":
      return `${nameFor(names, entry.playerId)} was removed.`;
    case "matchAbandoned":
      return `Match abandoned (${entry.reason}).`;
  }
}

function connectionLabel(connection: SeatView["connection"]): string {
  switch (connection) {
    case "connected":
      return "Connected";
    case "disconnected":
      return "Disconnected";
    case "removed":
      return "Removed";
  }
}

function renderSlotContents(slot: SlotView, transientCard?: CardView): ReactNode {
  if (transientCard !== undefined) {
    return (
      <span className="ui-slot__card">
        <CardFace card={transientCard} />
        <span className="ui-slot__state">Wrong snap reveal</span>
      </span>
    );
  }

  switch (slot.state) {
    case "hole":
      return <span className="ui-slot__state">Empty</span>;
    case "hidden":
      return (
        <span className="ui-slot__card">
          <CardBack />
          <span className="ui-slot__state">Face down</span>
        </span>
      );
    case "revealed":
      return (
        <span className="ui-slot__card">
          <CardFace card={slot.card} />
          <span className="ui-slot__state">Revealed</span>
        </span>
      );
  }
}

function slotAriaLabel(slot: SlotView, seat: SeatView, action: SlotAction | null, transientCard?: CardView): string {
  const position = slotPositionLabel(slot);
  const base = transientCard !== undefined
    ? `${position} transient wrong snap reveal, ${formatCard(transientCard)}, for ${seat.displayName}`
    : slot.state === "hole"
      ? `${position} empty slot for ${seat.displayName}`
      : slot.state === "hidden"
        ? `${position} face-down card for ${seat.displayName}`
        : `${position} revealed ${formatCard(slot.card)} for ${seat.displayName}`;
  return action === null ? base : `${base}. ${action.label}`;
}

function compareSlots(left: SlotView, right: SlotView): number {
  return slotOrder(left) - slotOrder(right);
}

function slotOrder(slot: SlotView): number {
  switch (slot.position) {
    case "topLeft":
      return 0;
    case "topRight":
      return 1;
    case "bottomLeft":
      return 2;
    case "bottomRight":
      return 3;
    case null:
      return 4 + Number(slot.slotId.replace(/\D/g, "") || "0");
  }
}

function playerNames(seats: readonly SeatView[]): ReadonlyMap<string, string> {
  return new Map(seats.map((seat) => [seat.playerId, seat.displayName]));
}

function nameFor(names: ReadonlyMap<string, string>, playerId: string): string {
  return names.get(playerId) ?? playerId;
}

function rankLabel(rank: CardView["rank"]): string {
  switch (rank) {
    case "A":
      return "Ace";
    case "J":
      return "Jack";
    case "Q":
      return "Queen";
    case "K":
      return "King";
    case "JOKER":
      return "Joker";
    default:
      return rank;
  }
}

function suitLabel(suit: Exclude<CardView, { readonly rank: "JOKER" }>["suit"]): { readonly text: string; readonly symbol: string } {
  switch (suit) {
    case "clubs":
      return { text: "clubs", symbol: "♣" };
    case "diamonds":
      return { text: "diamonds", symbol: "♦" };
    case "hearts":
      return { text: "hearts", symbol: "♥" };
    case "spades":
      return { text: "spades", symbol: "♠" };
  }
}

function powerLabel(kind: NonNullable<StateSnapshotView["pendingPower"]>["kind"]): string {
  switch (kind) {
    case "peekOwn":
      return "own-card peek";
    case "peekOpponent":
      return "opponent-card peek";
    case "blindSwap":
      return "blind swap";
    case "blackKing":
      return "Black King";
  }
}
