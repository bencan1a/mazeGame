/**
 * Seeded PRNG. The only source of randomness allowed inside src/core — ESLint
 * bans Math.random there, because a board must be a pure function of its seed.
 *
 * sfc32, seeded through splitmix32 so that adjacent integer seeds (1, 2, 3 ...)
 * produce uncorrelated streams. Boards are keyed by small integer seeds, so this
 * matters more than it usually would.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, boundExclusive). */
  int(boundExclusive: number): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Approximately normal, via Box-Muller. */
  normal(mean: number, stdDev: number): number;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const seeder = splitmix32(seed >>> 0);
  let a = seeder();
  let b = seeder();
  let c = seeder();
  let d = seeder();

  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Discard the first few outputs; sfc32 needs a short warm-up to decorrelate.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    int: (boundExclusive) => Math.floor(next() * boundExclusive),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    normal: (mean, stdDev) => {
      // next() can return exactly 0, and log(0) is -Infinity.
      const u = 1 - next();
      const v = next();
      return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

/** Fisher-Yates, in place. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}
