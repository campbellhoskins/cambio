import { describe, expect, it } from "vitest";
import * as engine from "../index.js";

describe("public engine barrel", () => {
  it("exports runtime helpers from the package entrypoint", () => {
    expect(engine.createDeck).toBeTypeOf("function");
    expect(engine.createMatch).toBeTypeOf("function");
    expect(engine.reduceCommand).toBeTypeOf("function");
    expect(engine.checkInvariants).toBeTypeOf("function");
    expect(engine.scoreRound).toBeTypeOf("function");
    expect(engine.createSeededRng).toBeTypeOf("function");
  });
});
