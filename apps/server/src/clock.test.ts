import { describe, expect, it } from "vitest";
import { SystemClock, TimeoutScheduler } from "./clock.js";

describe("real clock adapters", () => {
  it("exposes wall time and cancellable timeout scheduling", async () => {
    expect(new SystemClock().nowMs()).toBeGreaterThan(0);
    const scheduler = new TimeoutScheduler();
    let fired = false;
    const task = scheduler.schedule(1, () => {
      fired = true;
    });
    task.cancel();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fired).toBe(false);
  });
});
