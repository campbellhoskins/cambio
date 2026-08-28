import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ROOM_CONFIG_LIMITS, RoomConfigSchema } from "@cambio/protocol";
import { Button, FieldError, LiveRegion, NumberField, TextField } from "@cambio/ui";
import { useGameStore } from "../store/gameStore.js";
import type { PublicSessionDescriptor } from "../session/credentials.js";

const defaultConfig = { roundCount: 9, snapWindowMs: 5_000, playerCap: 6 };

export function HomeRoute(): React.ReactElement {
  const navigate = useNavigate();
  const sessions = useGameStore((state) => state.sessions);
  const lastError = useGameStore((state) => state.lastError);
  const connectionAnnouncement = useGameStore((state) => state.connectionAnnouncement);
  const createRoom = useGameStore((state) => state.createRoom);
  const joinRoom = useGameStore((state) => state.joinRoom);
  const resumeSession = useGameStore((state) => state.resumeSession);
  const clearError = useGameStore((state) => state.clearError);
  const [createName, setCreateName] = useState("");
  const [roundCount, setRoundCount] = useState(String(defaultConfig.roundCount));
  const [snapWindowSeconds, setSnapWindowSeconds] = useState(String(defaultConfig.snapWindowMs / 1_000));
  const [playerCap, setPlayerCap] = useState(String(defaultConfig.playerCap));
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const config = useMemo(() => ({
    roundCount: Number(roundCount),
    snapWindowMs: Number(snapWindowSeconds) * 1_000,
    playerCap: Number(playerCap),
  }), [playerCap, roundCount, snapWindowSeconds]);

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearError();
    const displayName = createName.trim();
    if (displayName.length === 0) {
      setFormError("Enter a display name.");
      return;
    }
    const parsed = RoomConfigSchema.safeParse(config);
    if (!parsed.success) {
      setFormError("Use 1-20 rounds, 2-10 snap seconds, and 2-6 players.");
      return;
    }

    setFormError(null);
    try {
      const credential = await createRoom(displayName, parsed.data);
      navigate(`/room/${credential.roomCode}`);
    } catch {
      return;
    }
  }

  async function onJoin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearError();
    const displayName = joinName.trim();
    const roomCode = joinCode.trim().toUpperCase();
    if (displayName.length === 0 || roomCode.length === 0) {
      setFormError("Enter a room code and display name.");
      return;
    }

    setFormError(null);
    try {
      const credential = await joinRoom(roomCode, displayName);
      navigate(`/room/${credential.roomCode}`);
    } catch {
      return;
    }
  }

  async function onResume(descriptor: PublicSessionDescriptor): Promise<void> {
    clearError();
    try {
      const credential = await resumeSession(descriptor);
      navigate(`/room/${credential.roomCode}`);
    } catch {
      return;
    }
  }

  return (
    <main className="app-shell" id="main-content">
      <LiveRegion>{connectionAnnouncement}</LiveRegion>
      <LiveRegion politeness="assertive">{formError ?? lastError ?? ""}</LiveRegion>
      <section className="hero panel" aria-labelledby="home-title">
        <p className="eyebrow">Private real-time rooms</p>
        <h1 id="home-title">Play Cambio</h1>
        <p>Create a room, share only the room code, and resume later from this browser.</p>
        <nav aria-label="Support links" className="link-row">
          <Link to="/rules">Rules placeholder</Link>
          <Link to="/tutorial">Tutorial placeholder</Link>
        </nav>
      </section>

      <div className="home-grid">
        <section className="panel" aria-labelledby="create-title">
          <h2 id="create-title">Create room</h2>
          <form className="form-stack" noValidate onSubmit={(event) => { void onCreate(event); }}>
            <TextField id="create-name" label="Display name for new room" value={createName} autoComplete="nickname" onChange={(event) => setCreateName(event.currentTarget.value)} />
            <NumberField label="Rounds" min={ROOM_CONFIG_LIMITS.roundCount.min} max={ROOM_CONFIG_LIMITS.roundCount.max} value={roundCount} onChange={(event) => setRoundCount(event.currentTarget.value)} />
            <NumberField label="Snap window seconds" min={ROOM_CONFIG_LIMITS.snapWindowMs.min / 1_000} max={ROOM_CONFIG_LIMITS.snapWindowMs.max / 1_000} value={snapWindowSeconds} onChange={(event) => setSnapWindowSeconds(event.currentTarget.value)} />
            <NumberField label="Player cap" min={ROOM_CONFIG_LIMITS.playerCap.min} max={ROOM_CONFIG_LIMITS.playerCap.max} value={playerCap} onChange={(event) => setPlayerCap(event.currentTarget.value)} />
            <Button type="submit" variant="primary">Create room</Button>
          </form>
        </section>

        <section className="panel" aria-labelledby="join-title">
          <h2 id="join-title">Join by code</h2>
          <form className="form-stack" noValidate onSubmit={(event) => { void onJoin(event); }}>
            <TextField id="join-code" label="Room code" value={joinCode} autoCapitalize="characters" onChange={(event) => setJoinCode(event.currentTarget.value)} />
            <TextField id="join-name" label="Display name for joined room" value={joinName} autoComplete="nickname" onChange={(event) => setJoinName(event.currentTarget.value)} />
            <Button type="submit" variant="primary">Join room</Button>
          </form>
        </section>

        <section className="panel" aria-labelledby="resume-title">
          <h2 id="resume-title">Resume retained session</h2>
          {sessions.length === 0 ? <p>No retained sessions in this browser.</p> : (
            <ul className="resume-list">
              {sessions.map((session) => (
                <li key={`${session.roomCode}-${session.seatId}`}>
                  <Button onClick={() => { void onResume(session); }}>
                    Resume room {session.roomCode} as {session.displayName}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <FieldError>{formError ?? lastError}</FieldError>
    </main>
  );
}
