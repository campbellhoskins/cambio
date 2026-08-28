import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { SeatView, StateSnapshotView } from "@cambio/protocol";

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
