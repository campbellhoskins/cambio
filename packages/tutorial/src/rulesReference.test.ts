import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rulesReference, searchRules } from "./rulesReference.js";

describe("rules reference", () => {
  const docs = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/rules.md"), "utf8");

  it("keeps the card values and powers aligned with docs/rules.md", () => {
    for (const rule of rulesReference.cardRules) {
      expect(docs).toContain(rule.card);
      expect(docs).toContain(rule.power);
    }
    expect(rulesReference.cardRules.map((rule) => rule.card)).toEqual([
      "Joker",
      "Ace",
      "2-6",
      "7-8",
      "9-10",
      "Jack or Queen",
      "Black King (clubs/spades)",
      "Red King (diamonds/hearts)",
    ]);
  });

  it("documents all caller scoring branches from the rule text", () => {
    expect(docs).toContain("uniquely lowest");
    expect(docs).toContain("ties for lowest");
    expect(docs).toContain("twice the highest raw total");
    expect(rulesReference.scoringExamples.map((example) => example.id)).toEqual([
      "caller-unique-lowest",
      "caller-tied-lowest",
      "caller-not-lowest",
    ]);
  });

  it("includes snap, stock, lifecycle, and keyboard searchable content", () => {
    expect(searchRules("wrong snap").sections.map((section) => section.id)).toContain("snaps");
    expect(searchRules("stockExhausted").sections.map((section) => section.id)).toContain("stock");
    expect(searchRules("host authority").sections.map((section) => section.id)).toContain("lifecycle");
    expect(rulesReference.keyboardInstructions.join(" ")).toContain("Arrow keys");
  });
});
