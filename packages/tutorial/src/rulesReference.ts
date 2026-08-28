export interface RulesSection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly bullets: readonly string[];
}

export interface CardRule {
  readonly card: string;
  readonly points: string;
  readonly power: string;
}

export interface ScoringExample {
  readonly id: string;
  readonly title: string;
  readonly rawScores: readonly string[];
  readonly result: string;
}

export interface RulesReferenceModel {
  readonly title: string;
  readonly updatedFrom: string;
  readonly cardRules: readonly CardRule[];
  readonly scoringExamples: readonly ScoringExample[];
  readonly sections: readonly RulesSection[];
  readonly keyboardInstructions: readonly string[];
}

export const rulesReference: RulesReferenceModel = {
  title: "Cambio rules reference",
  updatedFrom: "docs/rules.md",
  cardRules: [
    { card: "Joker", points: "0", power: "None" },
    { card: "Ace", points: "1", power: "None" },
    { card: "2-6", points: "Face value", power: "None" },
    { card: "7-8", points: "Face value", power: "Privately inspect one occupied card in your own grid" },
    { card: "9-10", points: "Face value", power: "Privately inspect one occupied card in another player's grid" },
    { card: "Jack or Queen", points: "10", power: "Blind-swap any two distinct occupied positions on the table" },
    { card: "Black King (clubs/spades)", points: "10", power: "Privately inspect one own card and one opponent card, then optionally swap them" },
    { card: "Red King (diamonds/hearts)", points: "-1", power: "None" },
  ],
  scoringExamples: [
    {
      id: "caller-unique-lowest",
      title: "Caller is uniquely lowest",
      rawScores: ["Caller 2", "Opponent 6"],
      result: "Caller scores 0; every non-caller scores their raw total.",
    },
    {
      id: "caller-tied-lowest",
      title: "Caller ties for lowest",
      rawScores: ["Caller 4", "Opponent 4"],
      result: "Caller scores their raw total of 4 because the lowest score is tied.",
    },
    {
      id: "caller-not-lowest",
      title: "Caller is not lowest",
      rawScores: ["Caller 8", "Opponent 3"],
      result: "Caller scores twice the highest raw total, so 16; there is no separate minimum penalty.",
    },
  ],
  keyboardInstructions: [
    "Tab and Shift+Tab move through route links, search, scenario controls, and action buttons.",
    "When focus is inside a card grid, Arrow keys move between cards; Home and End jump to the first or last slot.",
    "Enter or Space activates the focused card or button. Guided scenarios can be skipped or replayed from the scenario list.",
    "The tutorial announces coaching changes in a live region and moves focus to the current step heading.",
  ],
  sections: [
    {
      id: "players-deck",
      title: "Players and deck",
      summary: "2-6 guests play with one 54-card deck: a standard deck plus both Jokers.",
      bullets: ["Rooms are private by code or link.", "There are no accounts and no spectators."],
    },
    {
      id: "setup",
      title: "Setup and opening peek",
      summary: "Four face-down cards are dealt to stable 2x2 grid positions. The discard pile starts empty.",
      bullets: [
        "Round one dealer is random; later rounds rotate dealer to the next remaining seat.",
        "Only the owner sees the two semantic bottom positions before play.",
        "Every non-removed player acknowledges the opening reveal before the first turn starts.",
        "Play starts left of the dealer and continues clockwise.",
      ],
    },
    {
      id: "turn",
      title: "Normal turn",
      summary: "At turn start, either call Cambio before drawing or draw the top stock card.",
      bullets: [
        "Drawing from the discard pile is never allowed.",
        "After drawing, replace an occupied own slot or discard the drawn card directly.",
        "The resulting normal discard opens a snap window and may offer that card's optional power.",
        "A drawn card can never be placed into a hole; holes are filled only by penalty cards or opponent-snap transfers.",
      ],
    },
    {
      id: "powers",
      title: "Optional powers",
      summary: "Power cards are optional, immutable pending records owned by the active player.",
      bullets: [
        "7-8 inspect one own occupied card; 9-10 inspect one opponent occupied card.",
        "Jack or Queen blind-swaps any two distinct occupied table positions without revealing ranks.",
        "Black King privately reveals one own and one opponent card, then the owner confirms or declines the swap.",
        "Private reveals remain until acknowledgement, then must be remembered by the player.",
        "Snapped cards never trigger a power.",
      ],
    },
    {
      id: "snaps",
      title: "Snap resolution",
      summary: "Every normal discard opens one reaction window. Matching is by rank only and exactly one attempt can succeed.",
      bullets: [
        "Any connected player, including the active player, may snap any occupied face-down card.",
        "A correct own-card snap removes that card and leaves a hole.",
        "A correct opponent-card snap removes the target and requires the snapper to transfer one own occupied card into the vacated slot.",
        "A wrong snap publicly reveals the mismatch briefly and draws exactly one penalty card into the lowest hole or a new penalty slot.",
        "Late, stale, invalidated, or post-success attempts are rejected without penalty.",
      ],
    },
    {
      id: "concurrent",
      title: "Concurrent powers and snaps",
      summary: "A power and a snap window created by the same discard are independent obligations.",
      bullets: [
        "Power selection and snap attempts can proceed in either order.",
        "A successful snap does not cancel a pending power, and a power does not close the snap window.",
        "The next turn starts only after power, snap window, required transfer, and pause gates are clear.",
      ],
    },
    {
      id: "stock",
      title: "Stock exhaustion",
      summary: "All draws use stock first, then reshuffle buried discards while preserving the discard top.",
      bullets: [
        "A public reshuffle notice reveals no order information.",
        "If no buried discard can satisfy the draw, the round ends safely with reason stockExhausted.",
        "Stock exhaustion scores raw hand totals with no caller adjustment.",
      ],
    },
    {
      id: "cambio-scoring",
      title: "Calling Cambio and scoring",
      summary: "Cambio can be called only at turn start before drawing. Everyone else receives one final turn.",
      bullets: [
        "The final-turn queue is immutable and starts with the next clockwise non-removed seat.",
        "After final turns, all hands are revealed and raw totals are calculated.",
        "Non-callers always score their raw total in a normal Cambio end.",
        "The caller scores 0 only when uniquely lowest, raw when tied for lowest, and twice the highest raw total when not lowest.",
        "The match winner is the lowest cumulative score after the configured round count; ties share the win.",
      ],
    },
    {
      id: "lifecycle",
      title: "Room lifecycle summary",
      summary: "The host controls lobby settings and can end a stalled match; disconnects pause active play.",
      bullets: [
        "Player cap is 2-6, round count 1-20, and snap window 2-10 seconds.",
        "Reconnect credentials stay in browser storage and never appear in links, logs, or public state.",
        "A disconnected active seat pauses the room immediately; only snap and lifecycle timers are timed.",
        "Host authority migrates on host disconnect and does not return automatically.",
        "Empty rooms are deleted after 24 hours of retention.",
      ],
    },
  ],
};

export function searchRules(query: string, model: RulesReferenceModel = rulesReference): RulesReferenceModel {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return model;
  }

  return {
    ...model,
    cardRules: model.cardRules.filter((rule) => contains(rule.card, trimmed) || contains(rule.points, trimmed) || contains(rule.power, trimmed)),
    scoringExamples: model.scoringExamples.filter(
      (example) =>
        contains(example.title, trimmed) ||
        contains(example.result, trimmed) ||
        example.rawScores.some((score) => contains(score, trimmed)),
    ),
    sections: model.sections.filter(
      (section) =>
        contains(section.title, trimmed) ||
        contains(section.summary, trimmed) ||
        section.bullets.some((bullet) => contains(bullet, trimmed)),
    ),
  };
}

function contains(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}
