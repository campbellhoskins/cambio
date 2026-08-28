import { Button, RulesContent, rulesContent } from "@cambio/ui";

const keyboardInstructions = [
  "Tab and Shift+Tab move through route links, search, scenario controls, and action buttons.",
  "When focus is inside a card grid, Arrow keys move between cards; Home and End jump to the first or last slot.",
  "Enter or Space activates the focused card or button. Guided scenarios can be skipped or replayed from the scenario list.",
  "The tutorial announces coaching changes in a live region and moves focus to the current step heading.",
];

export function RulesRoute(): React.ReactElement {
  return (
    <main className="app-shell rules-route" id="main-content">
      <section className="hero panel" aria-labelledby="rules-title">
        <p className="eyebrow">Rules reference</p>
        <h1 id="rules-title">Cambio rules reference</h1>
        <p>
          {rulesContent.tagline} This searchable, printable page is sourced from {rulesContent.sourcedFrom}.
        </p>
        <div className="link-row no-print">
          <a className="text-link" href="/">Home</a>
          <a className="text-link" href="/tutorial">Guided tutorial</a>
          <Button onClick={() => window.print()}>Print rules</Button>
        </div>
      </section>

      <section className="panel">
        <RulesContent searchable />
      </section>

      <section className="panel" aria-labelledby="keyboard-title">
        <h2 id="keyboard-title">Keyboard instructions</h2>
        <ul>
          {keyboardInstructions.map((instruction) => (
            <li key={instruction}>{instruction}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
