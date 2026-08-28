import { useId, useMemo, useState, type ReactNode } from "react";
import { Button, Dialog, TextField } from "./components.js";

export interface RulesCardRule {
  readonly card: string;
  readonly points: string;
  readonly power: string;
}

export interface RulesScoringExample {
  readonly id: string;
  readonly title: string;
  readonly rawScores: readonly string[];
  readonly result: string;
}

export interface RulesSubsection {
  readonly heading: string;
  readonly body: string;
}

export interface RulesSection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly points: readonly string[];
  readonly subsections: readonly RulesSubsection[];
}

export interface RulesContentModel {
  readonly title: string;
  readonly tagline: string;
  readonly objective: string;
  readonly sourcedFrom: string;
  readonly cardRules: readonly RulesCardRule[];
  readonly scoringExamples: readonly RulesScoringExample[];
  readonly sections: readonly RulesSection[];
}

export const rulesContent: RulesContentModel = {
  title: "How to play Cambio",
  tagline: "Keep the lowest hand, remember what you can, and snap fast.",
  objective:
    "Cambio is a game of memory and nerve. Every card in front of you counts against you, so you want the lowest total when a round ends. You only get to see two of your four cards at the start, so half the game is remembering what you have and guessing what everyone else is hiding.",
  sourcedFrom: "docs/rules.md",
  cardRules: [
    { card: "Joker", points: "0", power: "None" },
    { card: "Ace", points: "1", power: "None" },
    { card: "2-6", points: "Face value", power: "None" },
    { card: "7-8", points: "Face value", power: "Privately inspect one occupied card in your own grid" },
    { card: "9-10", points: "Face value", power: "Privately inspect one occupied card in another player's grid" },
    { card: "Jack or Queen", points: "10", power: "Blind-swap any two distinct occupied positions on the table" },
    {
      card: "Black King (clubs/spades)",
      points: "10",
      power: "Privately inspect one own card and one opponent card, then optionally swap them",
    },
    { card: "Red King (diamonds/hearts)", points: "-1", power: "None" },
  ],
  scoringExamples: [
    {
      id: "caller-unique-lowest",
      title: "You call and have the lowest hand",
      rawScores: ["You 2", "Opponent 6"],
      result: "You score 0. Everyone else scores the value of the cards left in their hand.",
    },
    {
      id: "caller-tied-lowest",
      title: "You call but tie for lowest",
      rawScores: ["You 4", "Opponent 4"],
      result: "You score your hand as normal (4 here) and share the round win with whoever tied you.",
    },
    {
      id: "caller-not-lowest",
      title: "You call but someone beats you",
      rawScores: ["You 8", "Opponent 3"],
      result: "You are penalised twice the highest hand at the table, so 16. There is no separate minimum penalty.",
    },
  ],
  sections: [
    {
      id: "setup",
      title: "Setting up",
      summary:
        "You start with four cards dealt face down in a 2x2 grid in front of you. Before the first turn you get one private look at your own two bottom cards, then they flip back down for good.",
      points: [
        "2 to 6 players share one 54-card deck: a standard deck plus both Jokers.",
        "The discard pile starts empty. The first card played is what creates it.",
        "Everyone peeks at the same time and confirms when they are ready. Play begins to the dealer's left and goes clockwise.",
        "The dealer is chosen at random for the first round and passes to the next player each round after that.",
      ],
      subsections: [],
    },
    {
      id: "turn",
      title: "Taking your turn",
      summary:
        "When it is your turn you do one of two things: call Cambio to start the endgame, or draw the top card of the face-down deck. You can never take from the discard pile.",
      points: [
        "After you draw, either swap the new card into one of your slots (the old card goes face up onto the discard pile), or discard the card you just drew.",
        "You can't slide a card into an empty slot; gaps are only filled by penalty cards or by an opponent's snap.",
        "Whatever card lands face up on the discard pile may trigger its power and always opens a snap window for everyone.",
      ],
      subsections: [],
    },
    {
      id: "powers",
      title: "Card powers",
      summary:
        "Some cards do something extra when they are discarded on a normal turn. Using a power is always optional, and you never have to say what you saw.",
      points: [
        "7 and 8 let you privately peek at one of your own cards.",
        "9 and 10 let you privately peek at one card in someone else's grid.",
        "A Jack or Queen lets you blindly swap any two cards on the table without anyone seeing their faces.",
        "A Black King lets you look at one of your cards and one opponent's, then decide whether to swap them.",
        "A red King is worth -1, the best card in the game. A card snapped off the table never triggers its power.",
      ],
      subsections: [],
    },
    {
      id: "snaps",
      title: "Snapping",
      summary:
        "The instant a card lands on top of the discard pile a short window opens (five seconds by default). During that window any player, even the one whose turn it is, may snap: play a table card that matches the rank of the discard top. Matching is by rank only, and exactly one snap can win.",
      points: [
        "You may keep trying during the window, but every miss costs you a card.",
        "Late attempts, or attempts after someone has already snapped successfully, are simply ignored with no penalty.",
      ],
      subsections: [
        {
          heading: "A correct snap",
          body:
            "Snap one of your own cards and it goes straight to the discard pile, leaving a gap. Your hand just got smaller. Snap an opponent's card and it leaves their grid, then you hand one of your own cards into the empty slot: your hand shrinks and theirs stays the same size but gains a mystery card.",
        },
        {
          heading: "A wrong snap",
          body:
            "If the card you flip doesn't match, everyone gets a brief look at it, it goes back face down where it was, and you draw a penalty card face down. Your hand grows by one.",
        },
      ],
    },
    {
      id: "cambio",
      title: "Calling Cambio",
      summary:
        "Think you have the lowest hand? At the very start of your turn, before you draw, call Cambio. You take no turn, everyone else gets exactly one more turn, and then all hands are revealed.",
      points: [
        "You can't call Cambio once the final turns have started.",
        "Snaps and powers still happen during those final turns, so the round isn't over until every last one resolves.",
      ],
      subsections: [],
    },
    {
      id: "scoring",
      title: "Scoring and winning",
      summary:
        "Add up the cards left in your hand: Aces are 1, number cards are face value, Jacks, Queens and black Kings are 10, red Kings are -1, and Jokers are 0. Lower is better, and everyone tied for the lowest hand shares the round win.",
      points: [
        "If you called Cambio and are uniquely lowest, you score 0.",
        "If you called and tied for lowest, you score your hand as normal.",
        "If you called and someone beat you, you score double the highest hand at the table.",
        "After the agreed number of rounds, the lowest total across all rounds wins the match; ties share the win.",
      ],
      subsections: [],
    },
    {
      id: "room",
      title: "Playing in a shared room",
      summary:
        "Cambio here is played online in a private room. The host sets the number of rounds, how long the snap window lasts, and how many players can join, then starts once at least two people are in.",
      points: [
        "Share only the room code or link, never your reconnect details.",
        "If someone drops, the game pauses and holds their seat for a couple of minutes so they can rejoin from the same browser.",
        "The host can end a stalled game, and host duties pass on automatically if the host disconnects.",
      ],
      subsections: [],
    },
  ],
};

export function searchRules(query: string, model: RulesContentModel = rulesContent): RulesContentModel {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return model;
  }

  return {
    ...model,
    cardRules: model.cardRules.filter(
      (rule) => contains(rule.card, trimmed) || contains(rule.points, trimmed) || contains(rule.power, trimmed),
    ),
    scoringExamples: model.scoringExamples.filter(
      (example) =>
        contains(example.title, trimmed) ||
        contains(example.result, trimmed) ||
        example.rawScores.some((score) => contains(score, trimmed)),
    ),
    sections: model.sections.filter((section) => sectionMatches(section, trimmed)),
  };
}

export function RulesContent({
  model = rulesContent,
  searchable = false,
}: {
  readonly model?: RulesContentModel;
  readonly searchable?: boolean;
}): ReactNode {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => (searchable ? searchRules(query, model) : model), [model, query, searchable]);
  const matchCount = filtered.sections.length + filtered.cardRules.length + filtered.scoringExamples.length;

  return (
    <div className="rules-content">
      <p className="rules-objective">{model.objective}</p>

      {searchable ? (
        <div className="rules-search no-print">
          <TextField
            label="Search by card, action, score, or lifecycle rule"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <p className="ui-muted" role="status">
            {matchCount} matching rule groups.
          </p>
        </div>
      ) : null}

      <section className="rules-card-values" aria-labelledby="rules-card-values-title">
        <h3 id="rules-card-values-title">Card values and powers</h3>
        <table className="rules-table">
          <thead>
            <tr>
              <th scope="col">Card</th>
              <th scope="col">Points</th>
              <th scope="col">Optional power</th>
            </tr>
          </thead>
          <tbody>
            {filtered.cardRules.map((rule) => (
              <tr key={rule.card}>
                <th scope="row">{rule.card}</th>
                <td>{rule.points}</td>
                <td>{rule.power}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="rules-sections">
        {filtered.sections.map((section) => (
          <section key={section.id} id={`rule-${section.id}`} className="rules-section" aria-label={section.title}>
            <h3>{section.title}</h3>
            <p>{section.summary}</p>
            {section.points.length > 0 ? (
              <ul>
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
            {section.subsections.map((subsection) => (
              <div key={subsection.heading} className="rules-subsection">
                <h4>{subsection.heading}</h4>
                <p>{subsection.body}</p>
              </div>
            ))}
          </section>
        ))}
      </div>

      {filtered.scoringExamples.length > 0 ? (
        <section className="rules-scoring" aria-labelledby="rules-scoring-title">
          <h3 id="rules-scoring-title">Scoring examples</h3>
          <div className="rules-example-grid">
            {filtered.scoringExamples.map((example) => (
              <article key={example.id} className="rules-example">
                <h4>{example.title}</h4>
                <p className="rules-example__scores">{example.rawScores.join(" \u00b7 ")}</p>
                <p>{example.result}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function RulesLauncher({
  label = "How to play",
  model = rulesContent,
}: {
  readonly label?: string;
  readonly model?: RulesContentModel;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const buttonId = useId();

  return (
    <>
      <Button id={buttonId} variant="ghost" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog title={model.title} open={open} onClose={() => setOpen(false)} closeLabel="Close rules">
        <div className="rules-dialog-body">
          <RulesContent model={model} searchable />
        </div>
      </Dialog>
    </>
  );
}

function sectionMatches(section: RulesSection, query: string): boolean {
  return (
    contains(section.title, query) ||
    contains(section.summary, query) ||
    section.points.some((point) => contains(point, query)) ||
    section.subsections.some((subsection) => contains(subsection.heading, query) || contains(subsection.body, query))
  );
}

function contains(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}
