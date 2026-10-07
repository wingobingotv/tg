/**
 * Deterministic pseudo-randomness.
 *
 * Every viewer receives the same `seed` in the event, so seeding the engine
 * from it makes the celebration identical on every screen: the same rockets
 * at the same coordinates, the same confetti drift. `Math.random()` would
 * give each viewer a private show, which looks wrong the moment two people
 * watch the same broadcast next to each other.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** Uniform in [-spread, +spread). */
  spread(spread: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/**
 * mulberry32 — 32 bits of state, no dependencies, good enough distribution
 * for particle work and fast enough to call tens of thousands of times per
 * second.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  // A zero seed degenerates into a constant stream.
  if (state === 0) state = 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    spread: (s) => (next() * 2 - 1) * s,
    chance: (p) => next() < p,
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
  };
}
