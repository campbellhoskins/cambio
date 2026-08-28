import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { RulesRoute } from "@cambio/tutorial/rules";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
});

describe("rules and tutorial routes", () => {
  it("renders the searchable rules reference", async () => {
    const user = userEvent.setup();
    render(<RulesRoute />);

    expect(screen.getByRole("heading", { name: "Cambio rules reference" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search by card, action, score, or lifecycle rule"), "Black King");

    expect(screen.getByRole("row", { name: /black king.*privately inspect/i })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /joker/i })).not.toBeInTheDocument();
  });

  it("lazy-loads the tutorial route and renders the first guided step", async () => {
    const module = await import("@cambio/tutorial");
    render(<module.TutorialRoute />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Guided Cambio tutorial" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Peek at your bottom row" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
});
