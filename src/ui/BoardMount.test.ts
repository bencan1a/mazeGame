import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN_PARAMS } from '../core/types.js';
import { genParamsForShape, paramsFromLocation, seedForShape } from './BoardMount.js';

describe('seedForShape', () => {
  it('is deterministic: the same id always derives the same seed', () => {
    expect(seedForShape('house')).toBe(seedForShape('house'));
  });

  it('diverges between ids that differ only in one character', () => {
    expect(seedForShape('house')).not.toBe(seedForShape('mouse'));
  });

  it('diverges between ids where one is a prefix of the other', () => {
    expect(seedForShape('cat')).not.toBe(seedForShape('cats'));
  });

  it('lands inside the unsigned 32-bit range a seed must fit', () => {
    for (const id of ['', 'a', 'ring', 'a very long shape id indeed']) {
      const seed = seedForShape(id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('genParamsForShape', () => {
  it('opens the same shape on the same board every time', () => {
    expect(genParamsForShape('ring')).toEqual(genParamsForShape('ring'));
  });

  it('derives the seed from the shape id and keeps every other default', () => {
    const params = genParamsForShape('ring');
    expect(params).toEqual({ ...DEFAULT_GEN_PARAMS, seed: seedForShape('ring') });
  });

  it('gives two different shapes two different seeds', () => {
    expect(genParamsForShape('ring').seed).not.toBe(genParamsForShape('house').seed);
  });
});

describe('paramsFromLocation', () => {
  const base = genParamsForShape('ring');

  it('falls back to the base params with no query string available', () => {
    expect(paramsFromLocation(base, undefined)).toEqual(base);
  });

  it('keeps the base params when neither override is present', () => {
    expect(paramsFromLocation(base, '')).toEqual(base);
  });

  it('overrides the grid size from ?grid=', () => {
    expect(paramsFromLocation(base, '?grid=40').gridSize).toBe(40);
  });

  it('overrides the seed from ?seed=, taking priority over the shape-derived one', () => {
    expect(paramsFromLocation(base, '?seed=7').seed).toBe(7);
  });

  it('ignores an out-of-range or non-integer override', () => {
    expect(paramsFromLocation(base, '?grid=3').gridSize).toBe(base.gridSize);
    expect(paramsFromLocation(base, '?grid=2.5').gridSize).toBe(base.gridSize);
    expect(paramsFromLocation(base, '?seed=-1').seed).toBe(base.seed);
  });

  it('ignores an empty parameter rather than reading it as zero', () => {
    expect(paramsFromLocation(base, '?seed=').seed).toBe(base.seed);
  });
});
