import { useMemo, useState } from "react";
import { Button, TextField } from "@cambio/ui";
import { rulesReference, searchRules } from "./rulesReference.js";

export function RulesRoute(): React.ReactElement {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => searchRules(query), [query]);

  return (
    <main className="app-shell rules-route" id="main-content">
      <section className="hero panel" aria-labelledby="rules-title">
        <p className="eyebrow">Rules reference</p>
        <h1 id="rules-title">{rulesReference.title}</h1>
        <p>Searchable, printable reference sourced from {rulesReference.updatedFrom}.</p>
        <div className="link-row no-print">
          <a className="text-link" href="/">Home</a>
          <a className="text-link" href="/tutorial">Guided tutorial</a>
          <Button onClick={() => window.print()}>Print rules</Button>
        </div>
      </section>

      <section className="panel no-print" aria-labelledby="rules-search-title">
        <h2 id="rules-search-title">Search rules</h2>
        <TextField label="Search by card, action, score, or lifecycle rule" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <p className="ui-muted" role="status">
          {filtered.sections.length + filtered.cardRules.length + filtered.scoringExamples.length} matching rule groups.
        </p>
      </section>

      <section className="panel" aria-labelledby="card-values-title">
        <h2 id="card-values-title">Card values and powers</h2>
        <table className="rules-table">
          <thead>
            <tr><th scope="col">Card</th><th scope="col">Match points</th><th scope="col">Optional power</th></tr>
          </thead>
          <tbody>
            {filtered.cardRules.map((rule) => (
              <tr key={rule.card}><th scope="row">{rule.card}</th><td>{rule.points}</td><td>{rule.power}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rules-grid" aria-label="Rule sections">
        {filtered.sections.map((section) => (
          <article key={section.id} className="panel" id={section.id}>
            <h2>{section.title}</h2>
            <p>{section.summary}</p>
            <ul>
              {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
            </ul>
          </article>
        ))}
      </section>

      <section className="panel" aria-labelledby="scoring-examples-title">
        <h2 id="scoring-examples-title">Caller scoring examples</h2>
        <div className="rules-grid">
          {filtered.scoringExamples.map((example) => (
            <article key={example.id} className="rules-example">
              <h3>{example.title}</h3>
              <p>{example.rawScores.join(" · ")}</p>
              <p>{example.result}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="keyboard-title">
        <h2 id="keyboard-title">Keyboard instructions</h2>
        <ul>
          {rulesReference.keyboardInstructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
        </ul>
      </section>
    </main>
  );
}
