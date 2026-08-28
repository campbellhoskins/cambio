import type { CommandType, StateSnapshotView } from "@cambio/protocol";
import type {
  DomainEvent,
  EngineCommand,
  MatchState,
  PlayerId,
  PowerKind,
  StartingSlotPosition,
} from "@cambio/engine";
import {
  COACH_ID,
  LEARNER_ID,
  applyEngineCommands,
  createScriptedMatch,
  expireOpenSnapWindow,
  findSlotId,
  projectTutorialSnapshot,
  protocolCommandToEngine,
  toActionLogEntries,
  transientRevealTargets,
  type TutorialProjectionOptions,
} from "./adapter.js";

export interface TutorialStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly rule: string;
  readonly actionLabel?: string;
  readonly actions?: readonly StepAction[];
}

export type StepAction = (state: MatchState) => readonly EngineCommand[];

export interface TutorialScenario {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly ruleMapping: string;
  readonly createInitialState: () => MatchState;
  readonly steps: readonly TutorialStep[];
}

export interface TutorialSession {
  readonly scenario: TutorialScenario;
  readonly state: MatchState;
  readonly stepIndex: number;
  readonly actionLog: readonly ReturnType<typeof toActionLogEntries>[number][];
  readonly lastEvents: readonly DomainEvent[];
  readonly completedScenarioIds: readonly string[];
  readonly error: string | null;
}

export const tutorialScenarios: readonly TutorialScenario[] = [
  {
    id: "setup-memory",
    title: "Setup and memory",
    description: "See the opening bottom-two-card peek and acknowledge it before play begins.",
    ruleMapping: "Setup: no initial discard, stable 2x2 positions, and private bottom-two opening peek.",
    createInitialState: () =>
      createScriptedMatch({
        phase: "openingPeek",
        turnStage: null,
        activePlayerId: null,
        learnerCards: ["clubs:2", "diamonds:3", "hearts:7", "spades:K"],
        coachCards: ["clubs:4", "diamonds:5", "hearts:6", "spades:8"],
        drawPile: ["clubs:A"],
      }),
    steps: [
      info("opening", "Peek at your bottom row", "Only your bottom-left and bottom-right cards are revealed. The discard pile is empty.", "Opening knowledge is private and must be remembered."),
      act("ack-learner", "Acknowledge your peek", "Acknowledge when you are ready. The coach still needs to acknowledge before the first turn.", "All non-removed players must acknowledge before play starts.", "Acknowledge as learner", [{ type: "acknowledgeOpeningPeek", actorId: LEARNER_ID }]),
      act("ack-coach", "Coach acknowledges", "The coach acknowledges, then the engine starts the first turn with the seat left of the dealer.", "Turn order starts clockwise from the dealer's left.", "Let coach acknowledge", [{ type: "acknowledgeOpeningPeek", actorId: COACH_ID }]),
    ],
  },
  {
    id: "normal-turn",
    title: "Normal turns",
    description: "Practice draw→replace, draw→discard, and snap-window expiry.",
    ruleMapping: "Normal turn: draw from stock, then replace an occupied slot or discard the drawn card.",
    createInitialState: () =>
      createScriptedMatch({
        learnerCards: ["clubs:4", "diamonds:3", "hearts:2", "spades:6"],
        coachCards: ["clubs:9", "diamonds:5", "hearts:6", "spades:8"],
        drawPile: ["hearts:5", "diamonds:2", "clubs:A"],
      }),
    steps: [
      act("draw-replace-draw", "Draw a card", "Draw from the face-down stock. The discard pile cannot be drawn from.", "At turn start you may draw or call Cambio.", "Draw", [{ type: "drawCard", actorId: LEARNER_ID }]),
      dynamicAct("draw-replace-slot", "Replace an occupied slot", "Put the drawn card into your top-left slot. The displaced card becomes the normal discard and opens a snap window.", "Drawn cards can replace occupied slots only.", "Replace top-left", (state) => [{ type: "replaceSlot", actorId: LEARNER_ID, slotId: slot(state, LEARNER_ID, "topLeft") }]),
      dynamicAct("expire-first", "Close the snap window", "No one snaps this discard, so the timer expiry lets the turn advance.", "The next turn waits for the snap window to resolve or expire.", "Expire snap window", expireOpenSnapWindow),
      act("coach-draw", "Coach draws", "The coach takes a quick turn so you can practice the other drawn-card choice.", "Turns proceed clockwise.", "Coach draws", [{ type: "drawCard", actorId: COACH_ID }]),
      act("coach-discard", "Coach discards", "The coach discards the drawn card directly.", "Discarding the drawn card creates the normal discard.", "Coach discards", [{ type: "discardDrawn", actorId: COACH_ID }]),
      dynamicAct("expire-coach", "Close coach snap window", "The window expires and play returns to you.", "Snap windows are server-owned timers.", "Expire snap window", expireOpenSnapWindow),
      act("draw-discard-draw", "Draw again", "Draw a fresh stock card for the discard branch.", "A player may draw and discard without replacing.", "Draw", [{ type: "drawCard", actorId: LEARNER_ID }]),
      act("draw-discard", "Discard drawn card", "Discard the drawn card directly. The table uses the same command shape as the online game.", "A direct discard also opens snap and power resolution.", "Discard drawn card", [{ type: "discardDrawn", actorId: LEARNER_ID }]),
    ],
  },
  powerScenario("peek-own", "Peek own power", "clubs:7", "peekOwn", "Select one of your own occupied cards and acknowledge the private reveal."),
  powerScenario("peek-opponent", "Peek opponent power", "clubs:9", "peekOpponent", "Select one opponent occupied card and acknowledge the private reveal."),
  {
    id: "blind-swap",
    title: "Blind swap power",
    description: "Discard a Jack or Queen, then swap two occupied positions without revealing ranks.",
    ruleMapping: "Jack/Queen power: blind-swap any two distinct occupied slots on the table.",
    createInitialState: () =>
      createScriptedMatch({
        learnerCards: ["clubs:J", "diamonds:2", "hearts:3", "spades:4"],
        coachCards: ["clubs:5", "diamonds:6", "hearts:7", "spades:8"],
        drawPile: ["hearts:A"],
      }),
    steps: [
      ...discardTopLeftPowerSteps("Prepare the Jack"),
      dynamicAct("first-target", "Select first blind-swap target", "Select your top-right card. The rank stays hidden.", "Blind swaps reveal positions, not ranks.", "Select your top-right", (state) => [{ type: "selectPowerTarget", actorId: LEARNER_ID, targetPlayerId: LEARNER_ID, slotId: slot(state, LEARNER_ID, "topRight") }]),
      dynamicAct("second-target", "Select second blind-swap target", "Select the coach's bottom-left card to complete the swap.", "The two targets must be distinct occupied positions.", "Select coach bottom-left", (state) => [{ type: "selectPowerTarget", actorId: LEARNER_ID, targetPlayerId: COACH_ID, slotId: slot(state, COACH_ID, "bottomLeft") }]),
      dynamicAct("expire", "Close the snap window", "The pending power is complete; the turn advances after the snap window expires.", "Power resolution does not close the snap window.", "Expire snap window", expireOpenSnapWindow),
    ],
  },
  blackKingScenario("black-king-confirm", "Black King confirm", "confirm"),
  blackKingScenario("black-king-decline", "Black King decline", "decline"),
  {
    id: "snap-wrong-correct",
    title: "Wrong and correct snaps",
    description: "Make a wrong snap to take one penalty card, then make a correct own-card snap.",
    ruleMapping: "Wrong snaps add exactly one penalty; correct snaps remove a rank-matching card.",
    createInitialState: () =>
      createScriptedMatch({
        learnerCards: ["clubs:2", "diamonds:3", "clubs:5", "spades:6"],
        coachCards: ["clubs:4", "diamonds:8", "hearts:9", "spades:10"],
        drawPile: ["hearts:5", "spades:9"],
      }),
    steps: [
      act("draw", "Draw", "Draw the five from the scripted stock.", "The next discard opens the reaction window.", "Draw", [{ type: "drawCard", actorId: LEARNER_ID }]),
      act("discard", "Discard a 5", "Discard the drawn 5 so a card of rank 5 is snappable.", "Snap matching is by rank only.", "Discard drawn card", [{ type: "discardDrawn", actorId: LEARNER_ID }]),
      dynamicAct("wrong", "Try a wrong snap", "Snap the coach's top-left 4. The engine reveals the mismatch and draws exactly one penalty card for you.", "Wrong snaps keep the window open and add one penalty card.", "Wrong snap coach top-left", (state) => [{ type: "attemptSnap", actorId: LEARNER_ID, windowId: snapId(state), generation: snapGeneration(state), targetPlayerId: COACH_ID, slotId: slot(state, COACH_ID, "topLeft") }]),
      dynamicAct("correct", "Snap your matching 5", "Now snap your own bottom-left 5. The card is removed and no transfer is needed.", "Correct own-card snaps leave a hole.", "Correct snap own bottom-left", (state) => [{ type: "attemptSnap", actorId: LEARNER_ID, windowId: snapId(state), generation: snapGeneration(state), targetPlayerId: LEARNER_ID, slotId: slot(state, LEARNER_ID, "bottomLeft") }]),
    ],
  },
  {
    id: "opponent-transfer",
    title: "Opponent-card snap transfer",
    description: "Snap an opponent's matching card, then transfer one of your cards into the vacated slot.",
    ruleMapping: "Correct opponent-card snaps require a transfer from the snapper's own grid.",
    createInitialState: () =>
      createScriptedMatch({
        learnerCards: ["clubs:2", "diamonds:3", "hearts:4", "spades:5"],
        coachCards: ["clubs:6", "diamonds:8", "hearts:9", "spades:10"],
        drawPile: ["hearts:6"],
      }),
    steps: [
      act("draw", "Draw", "Draw the scripted 6.", "Every normal discard opens a snap window.", "Draw", [{ type: "drawCard", actorId: LEARNER_ID }]),
      act("discard", "Discard a 6", "Discard the drawn 6 to make a coach card match by rank.", "Matching ignores suit.", "Discard drawn card", [{ type: "discardDrawn", actorId: LEARNER_ID }]),
      dynamicAct("snap-opponent", "Snap coach's 6", "The correct snap removes the coach's card and creates a pending transfer for you.", "Opponent-card snaps are rejected only if the snapper has no transfer card.", "Snap coach top-left", (state) => [{ type: "attemptSnap", actorId: LEARNER_ID, windowId: snapId(state), generation: snapGeneration(state), targetPlayerId: COACH_ID, slotId: slot(state, COACH_ID, "topLeft") }]),
      dynamicAct("transfer", "Transfer one own card", "Move your top-right card into the coach's vacated slot. Your source slot becomes a hole.", "The transfer fills the exact vacated target slot.", "Transfer your top-right", (state) => [{ type: "chooseTransferTarget", actorId: LEARNER_ID, slotId: slot(state, LEARNER_ID, "topRight") }]),
    ],
  },
  {
    id: "stock-exhaustion",
    title: "Stock exhaustion",
    description: "Try to draw from an empty stock when only the discard top remains.",
    ruleMapping: "Stock exhaustion: if no buried discard can be reshuffled, the round ends safely with raw scores.",
    createInitialState: () =>
      createScriptedMatch({
        learnerCards: ["clubs:A", "diamonds:2", "hearts:K", "joker:1"],
        coachCards: ["clubs:3", "diamonds:4", "hearts:5", "spades:6"],
        drawPile: [],
        fillDrawPile: false,
        discardPile: ["spades:9"],
      }),
    steps: [
      act("draw-empty-stock", "Draw from exhausted stock", "The stock is empty and there are no buried discards, so the engine ends the round safely.", "Stock exhaustion uses raw scores and no caller adjustment.", "Attempt draw", [{ type: "drawCard", actorId: LEARNER_ID }]),
    ],
  },
  cambioScenario("cambio-unique-lowest", "Cambio: uniquely lowest caller", ["joker:1", "diamonds:K", "hearts:K", "clubs:4"], ["clubs:A", "diamonds:A", "clubs:2", "diamonds:2"], "Caller scores 0 when uniquely lowest."),
  cambioScenario("cambio-tied-lowest", "Cambio: caller tied for lowest", ["joker:1", "diamonds:K", "hearts:K", "clubs:6"], ["clubs:A", "diamonds:A", "hearts:A", "spades:A"], "Caller scores raw points when tied for lowest."),
  cambioScenario("cambio-not-lowest", "Cambio: caller not lowest", ["joker:1", "diamonds:K", "hearts:K", "clubs:10"], ["joker:2", "clubs:A", "diamonds:A", "clubs:2"], "Caller scores twice the highest raw total when not lowest."),
  {
    id: "match-completion",
    title: "Match completion",
    description: "Ready up after a one-round match and see the final winner summary.",
    ruleMapping: "After the configured round count, lowest cumulative score wins; ties share the win.",
    createInitialState: () =>
      createScriptedMatch({
        learnerCards: ["joker:1", "diamonds:K", "hearts:K", "clubs:4"],
        coachCards: ["clubs:A", "diamonds:A", "clubs:2", "diamonds:2"],
        drawPile: ["hearts:3"],
        roundCount: 1,
      }),
    steps: [
      ...finishCambioRoundSteps("Call Cambio and finish one round"),
      act("learner-ready", "Ready as learner", "After scoring, mark yourself ready for the match summary.", "Ready-up has no timer.", "Ready as learner", [{ type: "readyForNextRound", actorId: LEARNER_ID }]),
      act("coach-ready", "Coach readies", "The coach readies too. Because this match was configured for one round, the match completes.", "The lowest cumulative score wins the completed match.", "Coach readies", [{ type: "readyForNextRound", actorId: COACH_ID }]),
    ],
  },
];

export function createTutorialSession(scenarioId = tutorialScenarios[0]!.id): TutorialSession {
  const scenario = findScenario(scenarioId);
  return {
    scenario,
    state: scenario.createInitialState(),
    stepIndex: 0,
    actionLog: [],
    lastEvents: [],
    completedScenarioIds: readCompletedScenarioIds(),
    error: null,
  };
}

export function restartScenario(session: TutorialSession): TutorialSession {
  return {
    ...session,
    state: session.scenario.createInitialState(),
    stepIndex: 0,
    actionLog: [],
    lastEvents: [],
    error: null,
  };
}

export function selectScenario(session: TutorialSession, scenarioId: string): TutorialSession {
  const scenario = findScenario(scenarioId);
  return {
    ...session,
    scenario,
    state: scenario.createInitialState(),
    stepIndex: 0,
    actionLog: [],
    lastEvents: [],
    error: null,
  };
}

export function skipStep(session: TutorialSession): TutorialSession {
  return finishStep({ ...session, error: null, lastEvents: [] });
}

export function runGuidedAction(session: TutorialSession): TutorialSession {
  const step = session.scenario.steps[session.stepIndex];
  if (step?.actions === undefined || step.actions.length === 0) {
    return finishStep({ ...session, error: null, lastEvents: [] });
  }

  return applyStepActions(session, step.actions);
}

export function applyLearnerCommand(
  session: TutorialSession,
  type: CommandType,
  payload: unknown = {},
): TutorialSession {
  const engineCommand = protocolCommandToEngine(session.state, LEARNER_ID, type, payload);
  if (engineCommand === null) {
    return { ...session, error: "That command is not part of the offline tutorial." };
  }
  try {
    const result = applyEngineCommands(session.state, [engineCommand]);
    const actionLog = [...session.actionLog, ...toActionLogEntries(result.events)];
    return maybeAdvance({ ...session, state: result.state, lastEvents: result.events, actionLog, error: null }, type);
  } catch (error) {
    return { ...session, error: error instanceof Error ? error.message : String(error) };
  }
}

export function projectSession(session: TutorialSession): StateSnapshotView {
  const snapshot = projectTutorialSnapshot(session.state, LEARNER_ID, { actionLog: session.actionLog });
  return {
    ...snapshot,
    publicMovements: [],
  };
}

export function currentStep(session: TutorialSession): TutorialStep {
  return session.scenario.steps[Math.min(session.stepIndex, session.scenario.steps.length - 1)]!;
}

export function scenarioComplete(session: TutorialSession): boolean {
  return session.stepIndex >= session.scenario.steps.length;
}

export function runScenarioScript(scenario: TutorialScenario): TutorialSession {
  let session = createTutorialSession(scenario.id);
  while (!scenarioComplete(session)) {
    session = runGuidedAction(session);
    if (session.error !== null) {
      throw new Error(session.error);
    }
  }
  return session;
}

export { transientRevealTargets };

function applyStepActions(session: TutorialSession, actions: readonly StepAction[]): TutorialSession {
  try {
    let state = session.state;
    const events: DomainEvent[] = [];
    for (const makeCommands of actions) {
      const result = applyEngineCommands(state, makeCommands(state));
      state = result.state;
      events.push(...result.events);
    }
    const actionLog = [...session.actionLog, ...toActionLogEntries(events)];
    return finishStep({ ...session, state, actionLog, lastEvents: events, error: null });
  } catch (error) {
    return { ...session, error: error instanceof Error ? error.message : String(error) };
  }
}

function maybeAdvance(session: TutorialSession, type: CommandType): TutorialSession {
  const step = currentStep(session);
  const expected = step.actions?.flatMap((action) => action(session.state).map((commandToRun) => commandToRun.type));
  return expected?.map(String).includes(type) === true ? finishStep(session) : session;
}

function finishStep(session: TutorialSession): TutorialSession {
  const nextIndex = Math.min(session.stepIndex + 1, session.scenario.steps.length);
  const completedScenarioIds =
    nextIndex >= session.scenario.steps.length && !session.completedScenarioIds.includes(session.scenario.id)
      ? [...session.completedScenarioIds, session.scenario.id]
      : session.completedScenarioIds;
  writeCompletedScenarioIds(completedScenarioIds);
  return { ...session, stepIndex: nextIndex, completedScenarioIds };
}

function findScenario(scenarioId: string): TutorialScenario {
  return tutorialScenarios.find((scenario) => scenario.id === scenarioId) ?? tutorialScenarios[0]!;
}

function info(id: string, title: string, body: string, rule: string): TutorialStep {
  return { id, title, body, rule };
}

function act(
  id: string,
  title: string,
  body: string,
  rule: string,
  actionLabel: string,
  commands: readonly EngineCommand[],
): TutorialStep {
  return dynamicAct(id, title, body, rule, actionLabel, () => commands);
}

function dynamicAct(
  id: string,
  title: string,
  body: string,
  rule: string,
  actionLabel: string,
  action: StepAction,
): TutorialStep {
  return { id, title, body, rule, actionLabel, actions: [action] };
}

function discardTopLeftPowerSteps(prefix: string): readonly TutorialStep[] {
  return [
    act("draw-power", `${prefix}: draw`, "Draw a low card from stock.", "A power is offered only after a normal discard.", "Draw", [{ type: "drawCard", actorId: LEARNER_ID }]),
    dynamicAct("replace-power", `${prefix}: replace`, "Replace your top-left power card. The displaced card becomes the normal discard and offers its power.", "The discarded card's power is optional.", "Replace top-left", (state) => [{ type: "replaceSlot", actorId: LEARNER_ID, slotId: slot(state, LEARNER_ID, "topLeft") }]),
  ];
}

function powerScenario(
  id: string,
  title: string,
  powerCard: string,
  expectedKind: PowerKind,
  description: string,
): TutorialScenario {
  const opponentTarget = expectedKind === "peekOpponent";
  return {
    id,
    title,
    description,
    ruleMapping: `Power card ${powerCard}: ${description}`,
    createInitialState: () =>
      createScriptedMatch({
        learnerCards: [powerCard, "diamonds:2", "hearts:3", "spades:4"],
        coachCards: ["clubs:5", "diamonds:6", "hearts:7", "spades:8"],
        drawPile: ["hearts:A"],
      }),
    steps: [
      ...discardTopLeftPowerSteps("Prepare the power"),
      dynamicAct("select", "Select the legal target", description, "The active player chooses a legal occupied target for the power.", opponentTarget ? "Select coach top-left" : "Select your top-right", (state) => [{ type: "selectPowerTarget", actorId: LEARNER_ID, targetPlayerId: opponentTarget ? COACH_ID : LEARNER_ID, slotId: slot(state, opponentTarget ? COACH_ID : LEARNER_ID, opponentTarget ? "topLeft" : "topRight") }]),
      act("ack", "Acknowledge the reveal", "The revealed card is available only until you acknowledge it.", "Private peeks are not retained as a memory aid.", "Acknowledge reveal", [{ type: "acknowledgePowerReveal", actorId: LEARNER_ID }]),
      dynamicAct("expire", "Close the snap window", "The snap timer must close before the turn can advance.", "A power does not close the snap window.", "Expire snap window", expireOpenSnapWindow),
    ],
  };
}

function blackKingScenario(id: string, title: string, decision: "confirm" | "decline"): TutorialScenario {
  return {
    id,
    title,
    description: `Reveal one own card and one opponent card, then ${decision} the Black King swap.`,
    ruleMapping: "Black King: inspect one own and one opponent card, then optionally swap them.",
    createInitialState: () =>
      createScriptedMatch({
        learnerCards: ["clubs:K", "diamonds:2", "hearts:3", "spades:4"],
        coachCards: ["clubs:5", "diamonds:6", "hearts:7", "spades:8"],
        drawPile: ["hearts:A"],
      }),
    steps: [
      ...discardTopLeftPowerSteps("Prepare the Black King"),
      dynamicAct("select-own", "Select your card", "Choose your top-right card for the first private reveal.", "Black King first selects an own occupied card.", "Select your top-right", (state) => [{ type: "selectPowerTarget", actorId: LEARNER_ID, targetPlayerId: LEARNER_ID, slotId: slot(state, LEARNER_ID, "topRight") }]),
      act("ack-own", "Acknowledge own reveal", "Acknowledge the first reveal before selecting the opponent card.", "Black King reveal stages are acknowledged privately.", "Acknowledge reveal", [{ type: "acknowledgePowerReveal", actorId: LEARNER_ID }]),
      dynamicAct("select-opponent", "Select opponent card", "Choose the coach's top-left card for the second reveal.", "Black King second selects an opponent occupied card.", "Select coach top-left", (state) => [{ type: "selectPowerTarget", actorId: LEARNER_ID, targetPlayerId: COACH_ID, slotId: slot(state, COACH_ID, "topLeft") }]),
      act("ack-opponent", "Acknowledge both revealed ranks", "The selected ranks are visible only to you.", "Private reveals remain until acknowledgement.", "Acknowledge reveal", [{ type: "acknowledgePowerReveal", actorId: LEARNER_ID }]),
      act("decide", `${decision === "confirm" ? "Confirm" : "Decline"} the swap`, decision === "confirm" ? "Swap the two selected cards." : "Leave both selected cards in place.", "Black King can confirm or decline after the reveal.", decision === "confirm" ? "Confirm swap" : "Decline swap", [{ type: "decideBlackKingSwap", actorId: LEARNER_ID, decision }]),
      dynamicAct("expire", "Close the snap window", "The power is complete; expire the snap window to advance.", "A successful or expired snap gate is required before the next turn.", "Expire snap window", expireOpenSnapWindow),
    ],
  };
}

function cambioScenario(
  id: string,
  title: string,
  learnerCards: readonly string[],
  coachCards: readonly string[],
  scoringRule: string,
): TutorialScenario {
  return {
    id,
    title,
    description: scoringRule,
    ruleMapping: `Calling Cambio scoring branch: ${scoringRule}`,
    createInitialState: () =>
      createScriptedMatch({
        learnerCards,
        coachCards,
        drawPile: ["hearts:3"],
        roundCount: 1,
      }),
    steps: finishCambioRoundSteps(title),
  };
}

function finishCambioRoundSteps(prefix: string): readonly TutorialStep[] {
  return [
    act("call", `${prefix}: call Cambio`, "Call Cambio before drawing. You take no normal turn and the coach receives the final turn.", "Cambio is legal only at turn start before drawing.", "Call Cambio", [{ type: "callCambio", actorId: LEARNER_ID }]),
    act("coach-draw", `${prefix}: coach final draw`, "The coach takes the one queued final turn.", "Every other non-removed player appears once in the final-turn queue.", "Coach draws", [{ type: "drawCard", actorId: COACH_ID }]),
    act("coach-discard", `${prefix}: coach final discard`, "The coach discards directly to complete the normal action.", "A final turn still resolves normal power and snap gates.", "Coach discards", [{ type: "discardDrawn", actorId: COACH_ID }]),
    dynamicAct("expire", `${prefix}: finish scoring`, "Expire the final snap window so the round ends and the caller adjustment is visible in Scores.", "When the final-turn queue is exhausted, remaining hands reveal and scores are assigned.", "Expire snap window", expireOpenSnapWindow),
  ];
}

function slot(state: MatchState, playerId: PlayerId, position: StartingSlotPosition): string {
  return findSlotId(state, playerId, position);
}

function snapId(state: MatchState): string {
  const windowId = state.round?.snapWindow?.windowId;
  if (windowId === undefined) {
    throw new Error("expected an open snap window");
  }
  return windowId;
}

function snapGeneration(state: MatchState): number {
  const generation = state.round?.snapWindow?.generation;
  if (generation === undefined) {
    throw new Error("expected an open snap window");
  }
  return generation;
}

const progressKey = "cambio.tutorial.progress.v1";

function readCompletedScenarioIds(): readonly string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(progressKey);
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function writeCompletedScenarioIds(ids: readonly string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(progressKey, JSON.stringify([...ids]));
}

export function transientRevealsForSession(session: TutorialSession): TutorialProjectionOptions & {
  readonly transientReveals: ReturnType<typeof transientRevealTargets>;
} {
  return { transientReveals: transientRevealTargets(session.state, session.lastEvents) };
}
