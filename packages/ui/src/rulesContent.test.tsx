import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { RulesContent, RulesLauncher, rulesContent, searchRules } from "./rulesContent.js";

afterEach(cleanup);

const docs = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/rules.md"), "utf8");

describe("rules content", () => {
  it("renders human-readable objective, card values, sections, and examples", () => {
    render(<RulesContent />);
    expect(screen.getByText(rulesContent.objective)).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /black king.*privately inspect/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Snapping" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A wrong snap" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /someone beats you/i })).toBeInTheDocument();
  });

  it("filters cards, sections, and examples by search text", () => {
    expect(searchRules("").sections).toHaveLength(rulesContent.sections.length);
    expect(searchRules("black king").cardRules).toHaveLength(1);
    expect(searchRules("snap").sections.map((section) => section.id)).toContain("snaps");
    expect(searchRules("nonsense-token-xyz").sections).toHaveLength(0);
  });

  it("stays aligned with the authoritative docs/rules.md card values and scoring branches", () => {
    for (const rule of rulesContent.cardRules) {
      expect(docs).toContain(rule.card);
      expect(docs).toContain(rule.power);
    }
    expect(docs).toContain("uniquely lowest");
    expect(docs).toContain("ties for lowest");
    expect(docs).toContain("twice the highest raw total");
    expect(rulesContent.scoringExamples.map((example) => example.id)).toEqual([
      "caller-unique-lowest",
      "caller-tied-lowest",
      "caller-not-lowest",
    ]);
  });
});

describe("rules launcher", () => {
  it("opens an accessible rules dialog and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<RulesLauncher label="How to play" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "How to play" }));

    const dialog = screen.getByRole("dialog", { name: rulesContent.title });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /black king.*privately inspect/i })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters within the panel and hides non-matching cards", async () => {
    const user = userEvent.setup();
    render(<RulesLauncher />);
    await user.click(screen.getByRole("button", { name: "How to play" }));

    await user.type(screen.getByLabelText("Search by card, action, score, or lifecycle rule"), "Black King");
    expect(screen.getByRole("row", { name: /black king.*privately inspect/i })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /joker/i })).not.toBeInTheDocument();
  });
});
