import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ROOM_CONFIG_LIMITS, RoomConfigSchema, type RoomConfig } from "@cambio/protocol";
import { Button, FieldError, HostConfigPanel, LiveRegion, Roster, ShareRoomPanel, StartMatchPanel } from "@cambio/ui";
import { useGameStore } from "../store/gameStore.js";
import type { PublicSessionDescriptor } from "../session/credentials.js";

export function RoomRoute(): React.ReactElement {
  const params = useParams();
  const navigate = useNavigate();
  const roomCode = (params.code ?? "").toUpperCase();
  const snapshot = useGameStore((state) => state.snapshot);
  const credential = useGameStore((state) => state.credential);
  const sessions = useGameStore((state) => state.sessions);
  const lastError = useGameStore((state) => state.lastError);
  const connectionStatus = useGameStore((state) => state.connectionStatus);
  const connectionAnnouncement = useGameStore((state) => state.connectionAnnouncement);
  const sendCommand = useGameStore((state) => state.sendCommand);
  const resumeSession = useGameStore((state) => state.resumeSession);
  const leaveCurrentRoom = useGameStore((state) => state.leaveCurrentRoom);
  const [configError, setConfigError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const matchingSession = useMemo(
    () => sessions.find((session) => session.roomCode === roomCode),
    [roomCode, sessions],
  );

  if (snapshot === null || credential?.roomCode !== roomCode) {
    return (
      <main className="app-shell" id="main-content">
        <LiveRegion>{connectionAnnouncement}</LiveRegion>
        <LiveRegion politeness="assertive">{lastError ?? ""}</LiveRegion>
        <section className="panel" aria-labelledby="room-resume-title">
          <p className="eyebrow">Room {roomCode}</p>
          <h1 id="room-resume-title">Connect to this room</h1>
          {matchingSession === undefined ? (
            <p>Use the home page to join this room from a shared code.</p>
          ) : (
            <Button variant="primary" onClick={() => { void resumeAndStay(matchingSession); }}>
              Resume room {matchingSession.roomCode} as {matchingSession.displayName}
            </Button>
          )}
          <Link className="text-link" to="/">Return home</Link>
          <FieldError>{lastError}</FieldError>
        </section>
      </main>
    );
  }

  const viewer = snapshot.seats.find((seat) => seat.playerId === snapshot.viewerSeatId);
  const isHost = viewer?.isHost ?? false;
  const activePlayers = snapshot.seats.filter((seat) => seat.connection !== "removed");
  const roomLink = `${window.location.origin}/room/${roomCode}`;

  async function resumeAndStay(descriptor: PublicSessionDescriptor): Promise<void> {
    try {
      await resumeSession(descriptor);
    } catch {
      return;
    }
  }

  function onConfigSubmit(config: RoomConfig): void {
    const parsed = RoomConfigSchema.safeParse(config);
    if (!parsed.success) {
      setConfigError("Use 1-20 rounds, 2-10 snap seconds, and 2-6 players.");
      return;
    }

    setConfigError(undefined);
    sendCommand("updateRoomConfig", { config: parsed.data });
  }

  function onCopy(): void {
    const write = navigator.clipboard?.writeText(roomLink) ?? Promise.resolve();
    void write.then(() => setCopied(true));
  }

  function onLeave(): void {
    sendCommand("leaveRoom", {});
    leaveCurrentRoom();
    navigate("/");
  }

  return (
    <main className="app-shell" id="main-content">
      <LiveRegion>{connectionAnnouncement}</LiveRegion>
      <LiveRegion politeness="assertive">{lastError ?? configError ?? ""}</LiveRegion>
      <header className="room-header panel">
        <div>
          <p className="eyebrow">Room {roomCode}</p>
          <h1>{snapshot.room.status === "lobby" ? "Lobby" : "Match starting"}</h1>
        </div>
        <span className={`connection-pill connection-pill--${connectionStatus}`}>{connectionStatus}</span>
      </header>

      {snapshot.room.status === "lobby" ? (
        <div className="lobby-grid">
          <Roster seats={snapshot.seats} viewerSeatId={snapshot.viewerSeatId} />
          <HostConfigPanel
            config={snapshot.room.config}
            isHost={isHost}
            limits={{
              roundCount: ROOM_CONFIG_LIMITS.roundCount,
              snapWindowSeconds: { min: ROOM_CONFIG_LIMITS.snapWindowMs.min / 1_000, max: ROOM_CONFIG_LIMITS.snapWindowMs.max / 1_000 },
              playerCap: ROOM_CONFIG_LIMITS.playerCap,
            }}
            onSubmit={onConfigSubmit}
            {...(configError === undefined ? {} : { error: configError })}
          />
          <ShareRoomPanel roomCode={roomCode} roomLink={roomLink} copied={copied} onCopy={onCopy} />
          <StartMatchPanel
            isHost={isHost}
            playerCount={activePlayers.length}
            canStart={isHost && activePlayers.length >= 2}
            onStart={() => sendCommand("startMatch", {})}
          />
          <section className="panel" aria-labelledby="leave-title">
            <h2 id="leave-title">Leave room</h2>
            <p>Your browser will forget this reconnect credential.</p>
            <Button variant="danger" onClick={onLeave}>Leave room</Button>
          </section>
        </div>
      ) : (
        <section className="panel" aria-live="polite">
          <h2>Match starting</h2>
          <p>The game table arrives in Phase 8. This client will continue to render only server snapshots.</p>
          <Button variant="danger" onClick={onLeave}>Leave room</Button>
        </section>
      )}

      <FieldError>{lastError}</FieldError>
    </main>
  );
}
