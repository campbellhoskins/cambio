import { useEffect, useMemo, useRef, useState } from "react";
import { Button, LiveRegion } from "@cambio/ui";
import {
  applyLearnerCommand,
  createTutorialSession,
  currentStep,
  projectSession,
  restartScenario,
  runGuidedAction,
  scenarioComplete,
  selectScenario,
  transientRevealsForSession,
  tutorialScenarios,
  type TutorialSession,
} from "./scenarios.js";
import { TutorialTable } from "./TutorialTable.js";

export function TutorialRoute(): React.ReactElement {
  const [session, setSession] = useState<TutorialSession>(() => createTutorialSession());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const complete = scenarioComplete(session);
  const step = complete ? null : currentStep(session);
  const snapshot = useMemo(() => projectSession(session), [session]);
  const revealData = transientRevealsForSession(session);

  useEffect(() => {
    headingRef.current?.focus();
  }, [session.scenario.id, session.stepIndex]);

  return (
    <main className="app-shell tutorial-route" id="main-content">
      <LiveRegion>{step === null ? `${session.scenario.title} complete.` : step.title}</LiveRegion>
      <section className="hero panel" aria-labelledby="tutorial-title">
        <p className="eyebrow">Offline guided tutorial</p>
        <h1 id="tutorial-title">Guided Cambio tutorial</h1>
        <p>The tutorial uses the real deterministic engine locally and never connects to a room.</p>
        <nav aria-label="Support links" className="link-row">
          <a className="text-link" href="/">Home</a>
          <a className="text-link" href="/rules">Rules reference</a>
        </nav>
      </section>

      <div className="tutorial-layout">
        <aside className="panel tutorial-nav" aria-labelledby="scenario-list-title">
          <h2 id="scenario-list-title">Scenarios</h2>
          <ol>
            {tutorialScenarios.map((scenario) => {
              const completed = session.completedScenarioIds.includes(scenario.id);
              return (
                <li key={scenario.id}>
                  <Button
                    variant={scenario.id === session.scenario.id ? "primary" : "secondary"}
                    aria-current={scenario.id === session.scenario.id ? "step" : undefined}
                    onClick={() => setSession((current) => selectScenario(current, scenario.id))}
                  >
                    {scenario.title}{completed ? " ✓" : ""}
                  </Button>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className="panel coach-panel" aria-labelledby="coach-step-title">
          <p className="eyebrow">{session.scenario.ruleMapping}</p>
          <h2 id="coach-step-title" ref={headingRef} tabIndex={-1}>
            {step?.title ?? "Scenario complete"}
          </h2>
          <p>{step?.body ?? "Replay this scenario or choose another one from the list."}</p>
          {step === null ? null : <p className="ui-muted">Rule: {step.rule}</p>}
          <div className="action-bar__buttons">
            <Button variant="primary" onClick={() => setSession((current) => runGuidedAction(current))}>
              {step?.actionLabel ?? "Continue"}
            </Button>
            <Button onClick={() => setSession((current) => skipScenario(current))}>Skip scenario</Button>
            <Button onClick={() => setSession((current) => restartScenario(current))}>Replay scenario</Button>
          </div>
          <p className="ui-muted" aria-live="polite">
            Step {Math.min(session.stepIndex + 1, session.scenario.steps.length)} of {session.scenario.steps.length}
          </p>
        </section>
      </div>

      <TutorialTable
        snapshot={snapshot}
        transientReveals={revealData.transientReveals}
        error={session.error}
        onCommand={(type, payload) => setSession((current) => applyLearnerCommand(current, type, payload))}
      />
    </main>
  );
}

function skipScenario(session: TutorialSession): TutorialSession {
  const currentIndex = tutorialScenarios.findIndex((scenario) => scenario.id === session.scenario.id);
  const nextScenario = tutorialScenarios[(currentIndex + 1) % tutorialScenarios.length];
  return selectScenario(session, nextScenario?.id ?? tutorialScenarios[0]!.id);
}
