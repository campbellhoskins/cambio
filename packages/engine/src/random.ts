export interface RandomResult {
  readonly value: number;
  readonly state: number;
}

export function normalizeSeed(seed: number): number {
  const normalized = seed >>> 0;
  return normalized === 0 ? 0x6d2b79f5 : normalized;
}

export function nextRandom(state: number): RandomResult {
  let next = normalizeSeed(state);
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;

  return {
    value: next / 0x1_0000_0000,
    state: next,
  };
}

export function shuffle<T>(items: readonly T[], initialState: number): { items: T[]; state: number } {
  const shuffled = [...items];
  let state = normalizeSeed(initialState);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const result = nextRandom(state);
    state = result.state;
    const target = Math.floor(result.value * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }

  return { items: shuffled, state };
}
