import {
  checkInvariants,
  reduceCommand,
  type CardSlot,
  type EngineCommand,
  type MatchState,
  type PlayerId,
  type RejectionCode,
} from "@cambio/engine";
import { assertPrivacyForEverySeat } from "@cambio/testkit";
import { projectStateSnapshot } from "./projection/index.js";

const ROUND_COUNT = Number(process.env.CAMBIO_SOAK_ROUNDS ?? 400);
const MAX_STEPS_PER_MATCH = 1_500;

interface Rng {
  next(maxExclusive: number): number;
}

interface RunStats {
  readonly matches: number;
  readonly commands: number;
  readonly snapAttempts: number;
  readonly powerSkips: number;
}

function main(): void {
  const stats = runSoak(ROUND_COUNT);
  console.log(
    `Cambio soak passed: ${stats.matches} seeded matches, ${stats.commands} commands, ${stats.snapAttempts} snap attempts, ${stats.powerSkips} power skips.`,
  );
}

export function runSoak(matches: number): RunStats {
  let commands = 0;
  let snapAttempts = 0;
  let powerSkips = 0;

  for (let seed = 1; seed <= matches; seed += 1) {
    const rng = lcg(seed);
    let state = createStartedMatch(seed, 2 + rng.next(4));
    assertSafe(state);

    for (let step = 0; state.status !== "complete" && step < MAX_STEPS_PER_MATCH; step += 1) {
      const command = nextCommand(state, rng);
      const result = reduceCommand(state, command);
      if (!result.ok) {
        throw new Error(`seed ${seed} rejected ${command.type}: ${result.code satisfies RejectionCode}`);
      }

      state = result.state;
      commands += 1;
      if (command.type === "attemptSnap") {
        snapAttempts += 1;
      }
      if (command.type === "skipPower") {
        powerSkips += 1;
      }
      assertSafe(state);
    }

    if (state.status !== "complete") {
      throw new Error(`seed ${seed} did not complete within ${MAX_STEPS_PER_MATCH} commands`);
    }
  }

  return { matches, commands, snapAttempts, powerSkips };
}

function createStartedMatch(seed: number, playerCount: number): MatchState {
  const hostId = playerId(0);
  let state = accepted(null, {
    type: "createMatch",
    roomId: `room:${seed}`,
    host: { playerId: hostId, displayName: "Player 1" },
    seed,
    config: { roundCount: 1, snapWindowMs: 2_000, playerCap: Math.max(2, playerCount) },
  });

  for (let index = 1; index < playerCount; index += 1) {
    state = accepted(state, {
      type: "joinRoom",
      seat: { playerId: playerId(index), displayName: `Player ${index + 1}` },
    });
  }

  state = accepted(state, { type: "startMatch", actorId: hostId });
  for (const seat of state.seats) {
    state = accepted(state, {
      type: "acknowledgeOpeningPeek",
      actorId: seat.playerId,
      expectedRevision: state.revision,
    });
  }
  return state;
}

function nextCommand(state: MatchState, rng: Rng): EngineCommand {
  if (state.status === "intermission") {
    const seat = state.seats.find((candidate) => !candidate.readyForNextRound && candidate.connection !== "removed");
    if (seat === undefined) {
      throw new Error("intermission without a ready target");
    }
    return { type: "readyForNextRound", actorId: seat.playerId, expectedRevision: state.revision };
  }

  const round = state.round;
  if (round === null) {
    throw new Error(`state ${state.status} has no round`);
  }

  if (round.pendingTransfer !== null) {
    return {
      type: "chooseTransferTarget",
      actorId: round.pendingTransfer.fromPlayerId,
      slotId: firstOccupiedSlot(state, round.pendingTransfer.fromPlayerId).slotId,
      expectedRevision: state.revision,
    };
  }

  if (round.pendingPower !== null) {
    if (round.pendingPower.stage === "offered") {
      return { type: "skipPower", actorId: round.pendingPower.ownerId, expectedRevision: state.revision };
    }
    return powerCommand(state, rng);
  }

  if (round.snapWindow !== null) {
    const correctTarget = firstSlotWithRank(state, round.snapWindow.triggerRank);
    if (correctTarget !== null && rng.next(3) !== 0) {
      return {
        type: "attemptSnap",
        actorId: correctTarget.playerId,
        windowId: round.snapWindow.windowId,
        generation: round.snapWindow.generation,
        targetPlayerId: correctTarget.playerId,
        slotId: correctTarget.slot.slotId,
      };
    }

    return {
      type: "expireSnapWindow",
      windowId: round.snapWindow.windowId,
      generation: round.snapWindow.generation,
    };
  }

  if (round.turnStage === "turnStart" && round.activePlayerId !== null) {
    if (state.revision > 16 && round.cambio === null && rng.next(4) === 0) {
      return { type: "callCambio", actorId: round.activePlayerId, expectedRevision: state.revision };
    }
    return { type: "drawCard", actorId: round.activePlayerId, expectedRevision: state.revision };
  }

  if (round.turnStage === "drawn" && round.activePlayerId !== null) {
    if (rng.next(2) === 0) {
      return { type: "discardDrawn", actorId: round.activePlayerId, expectedRevision: state.revision };
    }
    return {
      type: "replaceSlot",
      actorId: round.activePlayerId,
      slotId: firstOccupiedSlot(state, round.activePlayerId).slotId,
      expectedRevision: state.revision,
    };
  }

  throw new Error(`no command available at revision ${state.revision}`);
}

function powerCommand(state: MatchState, rng: Rng): EngineCommand {
  const power = state.round?.pendingPower;
  if (power === undefined || power === null) {
    throw new Error("missing power");
  }

  if (power.stage === "awaitingRevealAck") {
    return { type: "acknowledgePowerReveal", actorId: power.ownerId, expectedRevision: state.revision };
  }
  if (power.stage === "awaitingKingDecision") {
    return {
      type: "decideBlackKingSwap",
      actorId: power.ownerId,
      decision: rng.next(2) === 0 ? "confirm" : "decline",
      expectedRevision: state.revision,
    };
  }

  const own = power.ownerId;
  const opponents = state.seats.filter((seat) => seat.playerId !== own && seat.connection !== "removed");
  const opponent = opponents[rng.next(opponents.length)]?.playerId ?? own;
  const selected = new Set(power.selections.map((selection) => `${selection.playerId}\u0000${selection.slotId}`));
  const targetPlayerId =
    power.kind === "peekOwn" || (power.kind === "blackKing" && power.stage === "selectingFirst")
      ? own
      : power.kind === "peekOpponent" || power.kind === "blackKing"
        ? opponent
        : rng.next(2) === 0
          ? own
          : opponent;
  const slot = firstOccupiedSlot(state, targetPlayerId, selected);
  return {
    type: "selectPowerTarget",
    actorId: power.ownerId,
    targetPlayerId,
    slotId: slot.slotId,
    expectedRevision: state.revision,
  };
}

function firstOccupiedSlot(
  state: MatchState,
  playerId: PlayerId,
  excluded: ReadonlySet<string> = new Set(),
): CardSlot {
  const slot = state.round?.slotsByPlayer[playerId]?.find(
    (candidate) => candidate.cardId !== null && !excluded.has(`${playerId}\u0000${candidate.slotId}`),
  );
  if (slot === undefined) {
    throw new Error(`no occupied slot for ${playerId}`);
  }
  return slot;
}

function firstSlotWithRank(
  state: MatchState,
  rank: NonNullable<MatchState["round"]>["snapWindow"] extends infer T ? T extends { readonly triggerRank: infer TRank } ? TRank : never : never,
): { readonly playerId: PlayerId; readonly slot: CardSlot } | null {
  const round = state.round;
  if (round === null) {
    return null;
  }

  for (const [playerId, slots] of Object.entries(round.slotsByPlayer)) {
    for (const slot of slots) {
      if (slot.cardId !== null && round.cards[slot.cardId]?.rank === rank) {
        return { playerId, slot };
      }
    }
  }

  return null;
}

function accepted(state: MatchState | null, command: EngineCommand): MatchState {
  const result = reduceCommand(state, command);
  if (!result.ok) {
    throw new Error(`${command.type} rejected: ${result.code}`);
  }
  return result.state;
}

function assertSafe(state: MatchState): void {
  const invariants = checkInvariants(state);
  if (!invariants.ok) {
    throw new Error(invariants.violations.map((violation) => violation.message).join("; "));
  }
  assertNoAdvancedWithObligations(state);
  assertPrivacyForEverySeat(state, projectStateSnapshot);
}

function assertNoAdvancedWithObligations(state: MatchState): void {
  const round = state.round;
  if (round === null || round.turnStage === "resolving") {
    return;
  }
  if (round.pendingPower !== null || round.pendingTransfer !== null || round.snapWindow !== null) {
    throw new Error(`revision ${state.revision} advanced with unresolved obligations`);
  }
}

function playerId(index: number): PlayerId {
  return `player-${index + 1}`;
}

function lcg(seed: number): Rng {
  let value = seed >>> 0;
  return {
    next(maxExclusive: number): number {
      value = (1664525 * value + 1013904223) >>> 0;
      return value % Math.max(1, maxExclusive);
    },
  };
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main();
}
