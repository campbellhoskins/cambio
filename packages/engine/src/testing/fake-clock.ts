import type { Clock } from "../clock.js";

export class FakeClock implements Clock {
  #currentTimeMs: number;

  public constructor(initialTimeMs = 0) {
    this.#currentTimeMs = initialTimeMs;
  }

  public now(): number {
    return this.#currentTimeMs;
  }

  public advanceBy(durationMs: number): number {
    this.#currentTimeMs += durationMs;
    return this.#currentTimeMs;
  }

  public set(timeMs: number): number {
    this.#currentTimeMs = timeMs;
    return this.#currentTimeMs;
  }
}
