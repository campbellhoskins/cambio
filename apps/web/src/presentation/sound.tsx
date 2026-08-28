import { useCallback, useEffect, useRef, useState } from "react";
import { Button, LiveRegion } from "@cambio/ui";
import type { SoundCue } from "./effects.js";

export const PRESENTATION_PREFERENCES_KEY = "cambio.presentation.v1";

export interface PresentationPreferences {
  readonly muted: boolean;
  readonly volume: number;
  readonly reduceMotion: boolean;
}

export interface PresentationSettingsState {
  readonly preferences: PresentationPreferences;
  readonly setMuted: (muted: boolean) => void;
  readonly setVolume: (volume: number) => void;
  readonly setReduceMotion: (reduceMotion: boolean) => void;
  readonly prefersReducedMotion: boolean;
  readonly effectiveReducedMotion: boolean;
}

export interface SoundState {
  readonly unlocked: boolean;
  readonly available: boolean;
  readonly status: string;
  readonly unlock: () => Promise<void>;
}

const defaultPreferences: PresentationPreferences = {
  muted: false,
  volume: 0.45,
  reduceMotion: false,
};

export function usePresentationSettings(): PresentationSettingsState {
  const [preferences, setPreferences] = useState(loadPresentationPreferences);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(readMediaReducedMotion);

  useEffect(() => {
    try {
      window.localStorage.setItem(PRESENTATION_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      return;
    }
  }, [preferences]);

  useEffect(() => {
    try {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const listener = (event: MediaQueryListEvent): void => setPrefersReducedMotion(event.matches);
      query.addEventListener("change", listener);
      setPrefersReducedMotion(query.matches);
      return () => query.removeEventListener("change", listener);
    } catch {
      return undefined;
    }
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    setPreferences((current) => ({ ...current, muted }));
  }, []);

  const setVolume = useCallback((volume: number) => {
    setPreferences((current) => ({ ...current, volume: clampVolume(volume) }));
  }, []);

  const setReduceMotion = useCallback((reduceMotion: boolean) => {
    setPreferences((current) => ({ ...current, reduceMotion }));
  }, []);

  return {
    preferences,
    setMuted,
    setVolume,
    setReduceMotion,
    prefersReducedMotion,
    effectiveReducedMotion: prefersReducedMotion || preferences.reduceMotion,
  };
}

export function usePresentationSound(
  cues: readonly SoundCue[],
  preferences: PresentationPreferences,
): SoundState {
  const [unlocked, setUnlocked] = useState(false);
  const [available, setAvailable] = useState(true);
  const [status, setStatus] = useState("Sound is locked until enabled.");
  const engine = useRef<SoundEngine | null>(null);
  const seenCueIds = useRef<Set<string>>(new Set());

  const unlock = useCallback(async () => {
    try {
      engine.current = engine.current ?? createSoundEngine();
      await engine.current.resume();
      setUnlocked(true);
      setAvailable(true);
      setStatus(preferences.muted ? "Sound enabled and muted." : "Sound enabled.");
    } catch {
      setUnlocked(false);
      setAvailable(false);
      setStatus("Sound is unavailable in this browser.");
    }
  }, [preferences.muted]);

  useEffect(() => {
    const fresh = cues.filter((cue) => {
      if (seenCueIds.current.has(cue.id)) {
        return false;
      }
      seenCueIds.current.add(cue.id);
      return true;
    });

    if (fresh.length === 0 || !unlocked || preferences.muted) {
      return;
    }

    try {
      const player = engine.current;
      if (player === null) {
        return;
      }
      for (const cue of fresh) {
        player.play(cue.kind, preferences.volume);
      }
    } catch {
      setAvailable(false);
      setStatus("Sound was disabled after a playback error.");
    }
  }, [cues, preferences.muted, preferences.volume, unlocked]);

  return { unlocked, available, status, unlock };
}

export function PresentationSettingsControls({
  settings,
  sound,
}: {
  readonly settings: PresentationSettingsState;
  readonly sound: SoundState;
}): React.ReactElement {
  const volumePercent = Math.round(settings.preferences.volume * 100);
  const motionLabel = settings.prefersReducedMotion
    ? "Reduced motion is active from your system setting."
    : settings.effectiveReducedMotion
      ? "Reduced motion is active."
      : "Motion effects are on.";

  return (
    <section className="presentation-controls" aria-labelledby="presentation-controls-title">
      <div>
        <h2 id="presentation-controls-title">Presentation</h2>
        <p className="ui-muted">{motionLabel}</p>
      </div>
      <div className="presentation-controls__row">
        <Button
          onClick={() => {
            void sound.unlock();
          }}
          disabled={sound.unlocked || !sound.available}
        >
          {sound.unlocked
            ? "Sound enabled"
            : sound.available
              ? "Enable sound"
              : "Sound unavailable"}
        </Button>
        <Button
          aria-pressed={settings.preferences.muted}
          onClick={() => settings.setMuted(!settings.preferences.muted)}
        >
          {settings.preferences.muted ? "Unmute sound" : "Mute sound"}
        </Button>
        <label className="presentation-controls__range">
          <span>Sound volume: {volumePercent}%</span>
          <input
            aria-label="Sound volume"
            type="range"
            min={0}
            max={100}
            step={5}
            value={volumePercent}
            onChange={(event) => settings.setVolume(Number(event.currentTarget.value) / 100)}
          />
        </label>
        <label className="presentation-controls__checkbox">
          <input
            type="checkbox"
            checked={settings.preferences.reduceMotion}
            onChange={(event) => settings.setReduceMotion(event.currentTarget.checked)}
          />
          Reduce motion
        </label>
      </div>
      <LiveRegion>{`${sound.status} ${settings.preferences.muted ? "Muted." : `Volume ${volumePercent} percent.`}`}</LiveRegion>
    </section>
  );
}

interface SoundEngine {
  readonly resume: () => Promise<void>;
  readonly play: (cue: SoundCue["kind"], volume: number) => void;
}

function createSoundEngine(): SoundEngine {
  const AudioContextConstructor = getAudioContextConstructor();
  if (AudioContextConstructor === null) {
    throw new Error("AudioContext unavailable");
  }

  const context = new AudioContextConstructor();
  return {
    resume: async () => {
      if (context.state === "suspended") {
        await context.resume();
      }
    },
    play: (cue, volume) => playTone(context, cue, clampVolume(volume)),
  };
}

function playTone(context: AudioContext, cue: SoundCue["kind"], volume: number): void {
  const pattern = soundPattern(cue);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillator.type = pattern.wave;
  oscillator.frequency.setValueAtTime(pattern.frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.08), now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + pattern.duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + pattern.duration + 0.02);
}

function soundPattern(cue: SoundCue["kind"]): {
  readonly frequency: number;
  readonly duration: number;
  readonly wave: OscillatorType;
} {
  switch (cue) {
    case "deal":
      return { frequency: 360, duration: 0.08, wave: "triangle" };
    case "draw":
      return { frequency: 440, duration: 0.08, wave: "sine" };
    case "discard":
      return { frequency: 260, duration: 0.1, wave: "square" };
    case "snap":
      return { frequency: 740, duration: 0.09, wave: "triangle" };
    case "wrongSnap":
      return { frequency: 150, duration: 0.12, wave: "sawtooth" };
    case "penalty":
      return { frequency: 190, duration: 0.1, wave: "square" };
    case "transfer":
      return { frequency: 520, duration: 0.08, wave: "triangle" };
    case "swap":
      return { frequency: 610, duration: 0.1, wave: "sine" };
    case "reshuffle":
      return { frequency: 300, duration: 0.16, wave: "triangle" };
    case "reveal":
      return { frequency: 660, duration: 0.1, wave: "sine" };
    case "score":
      return { frequency: 500, duration: 0.18, wave: "triangle" };
  }
}

function loadPresentationPreferences(): PresentationPreferences {
  try {
    const raw = window.localStorage.getItem(PRESENTATION_PREFERENCES_KEY);
    if (raw === null) {
      return defaultPreferences;
    }

    const parsed = JSON.parse(raw) as Partial<PresentationPreferences>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : defaultPreferences.muted,
      volume:
        typeof parsed.volume === "number" ? clampVolume(parsed.volume) : defaultPreferences.volume,
      reduceMotion:
        typeof parsed.reduceMotion === "boolean"
          ? parsed.reduceMotion
          : defaultPreferences.reduceMotion,
    };
  } catch {
    return defaultPreferences;
  }
}

function readMediaReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function getAudioContextConstructor(): (new () => AudioContext) | null {
  const audioWindow = window as Window &
    typeof globalThis & { readonly webkitAudioContext?: new () => AudioContext };
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return defaultPreferences.volume;
  }

  return Math.min(1, Math.max(0, volume));
}
