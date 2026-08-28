import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { StateSnapshotViewSchema } from "@cambio/protocol";
import { COACH_ID, LEARNER_ID, projectTutorialSnapshot } from "./adapter.js";
import {
  createTutorialSession,
  currentStep,
  runGuidedAction,
  runScenarioScript,
  scenarioComplete,
  tutorialScenarios,
} from "./scenarios.js";

describe("tutorial scenarios", () => {
  it("runs every guided script to completion with the real reducer", () => {
    for (const scenario of tutorialScenarios) {
      const session = runScenarioScript(scenario);
      expect(session.error, scenario.id).toBeNull();
      expect(scenarioComplete(session), scenario.id).toBe(true);
      expect(() => StateSnapshotViewSchema.parse(projectTutorialSnapshot(session.state, LEARNER_ID, { actionLog: session.actionLog }))).not.toThrow();
    }
  });

  it("reveals only the learner's bottom two cards during setup memory", () => {
    const session = createTutorialSession("setup-memory");
    const snapshot = projectTutorialSnapshot(session.state, LEARNER_ID);
    const learnerGrid = snapshot.grids.find((grid) => grid.playerId === LEARNER_ID)!;
    const coachGrid = snapshot.grids.find((grid) => grid.playerId === COACH_ID)!;

    expect(learnerGrid.slots.filter((slot) => slot.state === "revealed").map((slot) => slot.position)).toEqual([
      "bottomLeft",
      "bottomRight",
    ]);
    expect(coachGrid.slots.every((slot) => slot.state === "hidden")).toBe(true);
    expect(snapshot.piles.discardTop).toBeNull();
    expect(snapshot.legalActions).toContain("acknowledgeOpeningPeek");
  });

  it("adds exactly one penalty card for a wrong snap and leaves the window open", () => {
    let session = createTutorialSession("snap-wrong-correct");
    session = runGuidedAction(session);
    session = runGuidedAction(session);
    const beforeWrongCount = session.state.round!.slotsByPlayer[LEARNER_ID]!.length;
    session = runGuidedAction(session);
    const afterWrongSlots = session.state.round!.slotsByPlayer[LEARNER_ID]!;

    expect(afterWrongSlots).toHaveLength(beforeWrongCount + 1);
    expect(afterWrongSlots.at(-1)?.kind).toBe("penalty");
    expect(session.state.round?.snapWindow).not.toBeNull();
    expect(session.actionLog).toContainEqual(expect.objectContaining({ type: "penaltyCardDrawn", playerId: LEARNER_ID }));
  });

  it("removes a correctly snapped own card without transfer", () => {
    let session = createTutorialSession("snap-wrong-correct");
    while (currentStep(session).id !== "correct") {
      session = runGuidedAction(session);
    }
    session = runGuidedAction(session);
    const bottomLeft = session.state.round!.slotsByPlayer[LEARNER_ID]!.find((slot) => slot.position === "bottomLeft")!;

    expect(bottomLeft.cardId).toBeNull();
    expect(session.state.round?.pendingTransfer).toBeNull();
    expect(session.actionLog).toContainEqual(expect.objectContaining({ type: "snapWindowClosed", resolvedBy: LEARNER_ID }));
  });

  it("requires and completes a transfer after an opponent-card snap", () => {
    let session = createTutorialSession("opponent-transfer");
    session = runGuidedAction(session);
    session = runGuidedAction(session);
    session = runGuidedAction(session);

    expect(session.state.round?.pendingTransfer).toEqual({
      fromPlayerId: LEARNER_ID,
      toPlayerId: COACH_ID,
      targetSlotId: "slot:coach:starting:topLeft",
    });

    session = runGuidedAction(session);
    const learnerTopRight = session.state.round!.slotsByPlayer[LEARNER_ID]!.find((slot) => slot.position === "topRight")!;
    const coachTopLeft = session.state.round!.slotsByPlayer[COACH_ID]!.find((slot) => slot.position === "topLeft")!;
    expect(learnerTopRight.cardId).toBeNull();
    expect(coachTopLeft.cardId).toBe("diamonds:3");
    expect(session.state.round?.pendingTransfer).toBeNull();
  });

  it.each([
    ["cambio-unique-lowest", 0, 6],
    ["cambio-tied-lowest", 4, 4],
    ["cambio-not-lowest", 16, 4],
  ])("scores %s with the documented caller branch", (scenarioId, learnerPoints, coachPoints) => {
    const session = runScenarioScript(tutorialScenarios.find((scenario) => scenario.id === scenarioId)!);
    const roundEnd = session.actionLog.find((entry) => entry.type === "roundEnded");
    if (roundEnd?.type !== "roundEnded") {
      throw new Error("missing roundEnded event");
    }
    expect(roundEnd.reason).toBe("cambio");
    expect(roundEnd.scores.find((score) => score.playerId === LEARNER_ID)?.matchPoints).toBe(learnerPoints);
    expect(roundEnd.scores.find((score) => score.playerId === COACH_ID)?.matchPoints).toBe(coachPoints);
  });

  it("completes a one-round match after both players ready", () => {
    const session = runScenarioScript(tutorialScenarios.find((scenario) => scenario.id === "match-completion")!);
    expect(session.state.status).toBe("complete");
    expect(session.actionLog).toContainEqual(expect.objectContaining({ type: "matchCompleted" }));
  });

  it("ends safely with raw scores on stock exhaustion", () => {
    const session = runScenarioScript(tutorialScenarios.find((scenario) => scenario.id === "stock-exhaustion")!);
    const roundEnd = session.actionLog.find((entry) => entry.type === "roundEnded");
    if (roundEnd?.type !== "roundEnded") {
      throw new Error("missing roundEnded event");
    }
    expect(roundEnd.reason).toBe("stockExhausted");
    expect(roundEnd.scores.every((score) => score.matchPoints === score.rawScore)).toBe(true);
  });

  it("does not include socket or fetch networking in tutorial sources", () => {
    const sourceDir = resolve("src");
    const contents = readdirSync(sourceDir)
      .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
      .map((name) => readFileSync(join(sourceDir, name), "utf8"))
      .join("\n");

    expect(contents).not.toMatch(/\bWebSocket\b/);
    expect(contents).not.toMatch(/\bfetch\s*\(/);
  });
});
