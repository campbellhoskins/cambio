import { useEffect, useRef, useState } from "react";
import type {
  ActionLogEntry,
  PresentationEventPayload,
  PublicMovementView,
  StateSnapshotView,
} from "@cambio/protocol";
import {
  slotEffectKey,
  type CardSlotEffect,
  type DrawnCardEffect,
  type PileEffect,
} from "@cambio/ui";

export type SoundCueKind =
  | "deal"
  | "draw"
  | "discard"
  | "snap"
  | "wrongSnap"
  | "penalty"
  | "transfer"
  | "swap"
  | "reshuffle"
  | "reveal"
  | "score";

export interface SoundCue {
  readonly id: string;
  readonly kind: SoundCueKind;
}

export interface PresentationEffects {
  readonly slotEffects: ReadonlyMap<string, CardSlotEffect>;
  readonly pileEffect: PileEffect | null;
  readonly drawnCardEffect: DrawnCardEffect | null;
  readonly scoreEffect: boolean;
  readonly announcement: string;
  readonly soundCues: readonly SoundCue[];
}

interface SnapshotMarkers {
  readonly roomId: string;
  readonly actionLogLength: number;
  readonly movementLength: number;
}

const emptyEffects: PresentationEffects = {
  slotEffects: new Map(),
  pileEffect: null,
  drawnCardEffect: null,
  scoreEffect: false,
  announcement: "",
  soundCues: [],
};

const MAX_EFFECT_EVENTS = 12;
const EFFECT_DURATION_MS = 1_200;

export function usePresentationEffects(
  snapshot: StateSnapshotView,
  presentationEvents: readonly PresentationEventPayload[],
): PresentationEffects {
  const [effects, setEffects] = useState<PresentationEffects>(emptyEffects);
  const previous = useRef<SnapshotMarkers | null>(null);
  const clearHandle = useRef<number | null>(null);
  const seenPresentationEvents = useRef<string[]>([]);

  useEffect(() => {
    try {
      const prior = previous.current;
      const markers = {
        roomId: snapshot.room.roomId,
        actionLogLength: snapshot.actionLog.length,
        movementLength: snapshot.publicMovements.length,
      };
      previous.current = markers;

      const isNewRoom = prior === null || prior.roomId !== snapshot.room.roomId;
      if (isNewRoom) {
        seenPresentationEvents.current = [];
      }
      const actionStart = isNewRoom
        ? snapshot.actionLog.length
        : Math.min(prior.actionLogLength, snapshot.actionLog.length);
      const movementStart = isNewRoom
        ? snapshot.publicMovements.length
        : Math.min(prior.movementLength, snapshot.publicMovements.length);
      const actionEntries = snapshot.actionLog.slice(actionStart).slice(-MAX_EFFECT_EVENTS);
      const movements = snapshot.publicMovements.slice(movementStart).slice(-MAX_EFFECT_EVENTS);
      const freshPresentationEvents = presentationEvents
        .filter((event) => {
          const key = presentationEventKey(event);
          if (seenPresentationEvents.current.includes(key)) {
            return false;
          }
          seenPresentationEvents.current.push(key);
          if (seenPresentationEvents.current.length > MAX_EFFECT_EVENTS * 2) {
            seenPresentationEvents.current = seenPresentationEvents.current.slice(
              -MAX_EFFECT_EVENTS * 2,
            );
          }
          return true;
        })
        .slice(-MAX_EFFECT_EVENTS);

      const next = derivePresentationEffects(
        snapshot,
        actionEntries,
        movements,
        freshPresentationEvents,
      );
      if (hasEffects(next)) {
        setEffects(next);
        if (clearHandle.current !== null) {
          window.clearTimeout(clearHandle.current);
        }
        clearHandle.current = window.setTimeout(() => {
          setEffects(emptyEffects);
          clearHandle.current = null;
        }, EFFECT_DURATION_MS);
        return;
      }

      if (actionEntries.length > 0 || movements.length > 0 || freshPresentationEvents.length > 0) {
        setEffects(emptyEffects);
      }
    } catch {
      setEffects({
        ...emptyEffects,
        announcement: "Presentation effects were skipped.",
      });
    }

    return undefined;
  }, [snapshot, presentationEvents]);

  useEffect(
    () => () => {
      if (clearHandle.current !== null) {
        window.clearTimeout(clearHandle.current);
      }
    },
    [],
  );

  return effects;
}

export function derivePresentationEffects(
  snapshot: StateSnapshotView,
  actionEntries: readonly ActionLogEntry[],
  movements: readonly PublicMovementView[],
  presentationEvents: readonly PresentationEventPayload[],
): PresentationEffects {
  const slotEffects = new Map<string, CardSlotEffect>();
  let pileEffect: PileEffect | null = null;
  let drawnCardEffect: DrawnCardEffect | null = null;
  let scoreEffect = false;
  const announcements: string[] = [];
  const soundCues: SoundCue[] = [];

  for (const entry of actionEntries) {
    const cueId = `log:${snapshot.room.roomId}:${snapshot.actionLog.indexOf(entry)}:${entry.type}`;
    switch (entry.type) {
      case "roundDealt":
        for (const grid of snapshot.grids) {
          for (const slot of grid.slots) {
            if (slot.state !== "hole") {
              slotEffects.set(slotEffectKey(grid.playerId, slot.slotId), "deal");
            }
          }
        }
        announcements.push(`Round ${entry.roundNumber} cards dealt.`);
        soundCues.push({ id: cueId, kind: "deal" });
        break;
      case "cardDrawn":
        pileEffect = "draw";
        drawnCardEffect = "draw";
        announcements.push("A card was drawn.");
        soundCues.push({ id: cueId, kind: "draw" });
        break;
      case "slotReplaced":
        slotEffects.set(slotEffectKey(entry.playerId, entry.slotId), "replace");
        pileEffect = "discard";
        drawnCardEffect = "discard";
        announcements.push("A slot was replaced.");
        soundCues.push({ id: cueId, kind: "discard" });
        break;
      case "cardDiscarded":
        pileEffect = "discard";
        drawnCardEffect = "discard";
        announcements.push("A card was discarded.");
        soundCues.push({ id: cueId, kind: "discard" });
        break;
      case "reshuffled":
        pileEffect = "reshuffle";
        announcements.push(`${entry.cardCount} cards reshuffled.`);
        soundCues.push({ id: cueId, kind: "reshuffle" });
        break;
      case "snapAttempted":
        slotEffects.set(slotEffectKey(entry.target.playerId, entry.target.slotId), "snap");
        announcements.push(
          entry.correct ? "A snap matched." : "A snap missed and a penalty was drawn.",
        );
        soundCues.push({ id: cueId, kind: entry.correct ? "snap" : "wrongSnap" });
        break;
      case "penaltyCardDrawn":
        slotEffects.set(slotEffectKey(entry.playerId, entry.slotId), "penalty");
        announcements.push("A penalty card was drawn.");
        soundCues.push({ id: cueId, kind: "penalty" });
        break;
      case "transferCompleted":
        slotEffects.set(slotEffectKey(entry.fromPlayerId, entry.fromSlotId), "transfer");
        slotEffects.set(slotEffectKey(entry.toPlayerId, entry.toSlotId), "transfer");
        announcements.push("A transfer completed.");
        soundCues.push({ id: cueId, kind: "transfer" });
        break;
      case "blackKingSwapDecided":
        if (entry.swapped) {
          for (const target of entry.targets) {
            slotEffects.set(slotEffectKey(target.playerId, target.slotId), "swap");
          }
          announcements.push("A Black King swap completed.");
          soundCues.push({ id: cueId, kind: "swap" });
        }
        break;
      case "powerRevealed":
        drawnCardEffect = "reveal";
        announcements.push("A private reveal is available.");
        soundCues.push({ id: cueId, kind: "reveal" });
        break;
      case "roundEnded":
      case "matchCompleted":
        scoreEffect = true;
        announcements.push("Scores updated.");
        soundCues.push({ id: cueId, kind: "score" });
        break;
      case "powerOffered":
      case "powerSkipped":
      case "powerTargetSelected":
      case "powerRevealAcknowledged":
      case "powerTargetInvalidated":
      case "snapWindowOpened":
      case "snapWindowClosed":
      case "turnStarted":
      case "turnAdvanced":
      case "openingPeekAcknowledged":
      case "cambioCalled":
      case "readyForNextRound":
      case "playerRemoved":
      case "matchAbandoned":
        break;
    }
  }

  for (const movement of movements) {
    const cueId = `movement:${snapshot.room.roomId}:${movement.type}:${movement.targets.map((target) => `${target.playerId}:${target.slotId}`).join("|")}`;
    switch (movement.type) {
      case "blindSwap":
      case "blackKingSwap":
        for (const target of movement.targets) {
          slotEffects.set(slotEffectKey(target.playerId, target.slotId), "swap");
        }
        announcements.push("A public swap completed.");
        soundCues.push({ id: cueId, kind: "swap" });
        break;
      case "snapRemoval":
        for (const target of movement.targets) {
          slotEffects.set(slotEffectKey(target.playerId, target.slotId), "snap");
        }
        announcements.push("A snapped card was removed.");
        soundCues.push({ id: cueId, kind: "snap" });
        break;
      case "transfer":
        for (const target of movement.targets) {
          slotEffects.set(slotEffectKey(target.playerId, target.slotId), "transfer");
        }
        announcements.push("A card transfer completed.");
        soundCues.push({ id: cueId, kind: "transfer" });
        break;
      case "playerRemoval":
        for (const target of movement.targets) {
          slotEffects.set(slotEffectKey(target.playerId, target.slotId), "discard");
        }
        break;
    }
  }

  for (const event of presentationEvents) {
    const cueId = `presentation:${presentationEventKey(event)}`;
    switch (event.type) {
      case "wrongSnapReveal":
        slotEffects.set(slotEffectKey(event.target.playerId, event.target.slotId), "reveal");
        announcements.push("Wrong snap reveal shown briefly.");
        soundCues.push({ id: cueId, kind: "wrongSnap" });
        break;
      case "reshuffled":
        pileEffect = "reshuffle";
        announcements.push(`${event.cardCount} cards reshuffled.`);
        soundCues.push({ id: cueId, kind: "reshuffle" });
        break;
    }
  }

  return {
    slotEffects,
    pileEffect,
    drawnCardEffect,
    scoreEffect,
    announcement: announcements.at(-1) ?? "",
    soundCues: collapseSoundCues(soundCues),
  };
}

function collapseSoundCues(cues: readonly SoundCue[]): readonly SoundCue[] {
  const latest = new Map<SoundCueKind, SoundCue>();
  for (const cue of cues) {
    latest.set(cue.kind, cue);
  }
  return [...latest.values()];
}

function hasEffects(effects: PresentationEffects): boolean {
  return (
    effects.slotEffects.size > 0 ||
    effects.pileEffect !== null ||
    effects.drawnCardEffect !== null ||
    effects.scoreEffect ||
    effects.announcement !== "" ||
    effects.soundCues.length > 0
  );
}

function presentationEventKey(event: PresentationEventPayload): string {
  switch (event.type) {
    case "wrongSnapReveal":
      return `${event.type}:${event.playerId}:${event.target.playerId}:${event.target.slotId}:${event.card.rank}:${"suit" in event.card ? event.card.suit : "joker"}`;
    case "reshuffled":
      return `${event.type}:${event.cardCount}`;
  }
}
