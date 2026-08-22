import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng, shuffle } from './rng.js';

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('decorrelates adjacent integer seeds', () => {
    // Boards are keyed by seeds 1, 2, 3..., so neighbouring seeds must not
    // produce visibly similar streams.
    const first = [1, 2, 3, 4, 5].map((s) => createRng(s).next());
    expect(new Set(first).size).toBe(first.length);
    const spread = Math.max(...first) - Math.min(...first);
    expect(spread).toBeGreaterThan(0.05);
  });

  it('stays inside [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() stays inside the requested bound', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 30 }),
        fc.integer({ min: 1, max: 1000 }),
        (seed, bound) => {
          const rng = createRng(seed);
          for (let i = 0; i < 50; i++) {
            const v = rng.int(bound);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(bound);
            expect(Number.isInteger(v)).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('produces a roughly uniform distribution', () => {
    const rng = createRng(99);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[rng.int(10)]! += 1;
    for (const count of buckets) expect(Math.abs(count - n / 10)).toBeLessThan(n / 10 / 5);
  });

  it('normal() has approximately the requested mean and spread', () => {
    const rng = createRng(4);
    const samples = Array.from({ length: 20_000 }, () => rng.normal(14, 5));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    expect(mean).toBeCloseTo(14, 0);
    expect(Math.sqrt(variance)).toBeCloseTo(5, 0);
  });

  it('chance() honours its probability', () => {
    const rng = createRng(11);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (rng.chance(0.25)) hits++;
    expect(hits / 20_000).toBeCloseTo(0.25, 1);
  });
});

describe('shuffle', () => {
  it('is a permutation and is seed-stable', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 0, max: 1e6 }),
        (items, seed) => {
          const a = shuffle([...items], createRng(seed));
          const b = shuffle([...items], createRng(seed));
          expect(a).toEqual(b);
          expect([...a].sort((x, y) => x - y)).toEqual([...items].sort((x, y) => x - y));
        },
      ),
      { numRuns: 100 },
    );
  });
});
