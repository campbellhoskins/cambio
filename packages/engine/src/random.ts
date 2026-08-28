import { uniformIntDistribution, xoroshiro128plus } from "pure-rand";
import type { RandomGenerator } from "pure-rand";
import type { RandomState } from "./model/state.js";

export interface RandomResult {
  readonly value: number;
  readonly state: RandomState;
}

export interface SeededRng {
  readonly state: RandomState;
  readonly nextInt: (exclusiveMax: number) => RandomResult;
}

function fromGenerator(generator: RandomGenerator): SeededRng {
  return {
    state: generator.getState(),
    nextInt(exclusiveMax: number): RandomResult {
      if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax <= 0) {
        throw new RangeError("exclusiveMax must be a positive safe integer");
      }

      const [value, nextGenerator] = uniformIntDistribution(0, exclusiveMax - 1, generator);
      return {
        value,
        state: nextGenerator.getState(),
      };
    },
  };
}

export function createSeededRng(seed: number): SeededRng {
  return fromGenerator(xoroshiro128plus(seed));
}

export function restoreSeededRng(state: RandomState): SeededRng {
  return fromGenerator(xoroshiro128plus.fromState(state));
}

export function randomInt(state: RandomState, exclusiveMax: number): RandomResult {
  return restoreSeededRng(state).nextInt(exclusiveMax);
}

export function shuffle<T>(items: readonly T[], initialState: RandomState): { items: readonly T[]; state: RandomState } {
  const shuffled = [...items];
  let state = initialState;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const result = randomInt(state, index + 1);
    state = result.state;
    const target = result.value;
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }

  return { items: shuffled, state };
}
