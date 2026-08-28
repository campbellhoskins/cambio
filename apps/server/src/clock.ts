export interface Clock {
  nowMs(): number;
}

export interface ScheduledTask {
  cancel(): void;
}

export interface Scheduler {
  schedule(delayMs: number, callback: () => void | Promise<void>): ScheduledTask;
}

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

export class TimeoutScheduler implements Scheduler {
  schedule(delayMs: number, callback: () => void | Promise<void>): ScheduledTask {
    const timeout = setTimeout(() => {
      void callback();
    }, delayMs);
    return {
      cancel: () => clearTimeout(timeout),
    };
  }
}

export class FakeClock implements Clock, Scheduler {
  private currentMs: number;
  private readonly tasks = new Map<number, { readonly dueAt: number; readonly callback: () => void | Promise<void>; canceled: boolean }>();
  private nextId = 1;

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  nowMs(): number {
    return this.currentMs;
  }

  schedule(delayMs: number, callback: () => void | Promise<void>): ScheduledTask {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, {
      dueAt: this.currentMs + Math.max(0, delayMs),
      callback,
      canceled: false,
    });

    return {
      cancel: () => {
        const task = this.tasks.get(id);
        if (task !== undefined) {
          task.canceled = true;
        }
      },
    };
  }

  async advanceBy(delayMs: number): Promise<void> {
    await this.advanceTo(this.currentMs + delayMs);
  }

  async advanceTo(targetMs: number): Promise<void> {
    if (targetMs < this.currentMs) {
      throw new Error("fake clock cannot move backwards");
    }

    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => !task.canceled && task.dueAt <= targetMs)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];

      if (next === undefined) {
        break;
      }

      const [id, task] = next;
      this.tasks.delete(id);
      this.currentMs = task.dueAt;
      await task.callback();
    }

    this.currentMs = targetMs;
    await Promise.resolve();
  }
}
