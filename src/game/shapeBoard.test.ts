import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN_PARAMS } from '../core/types.js';
import { genParamsForShape, seedForShape, shapeGenerateOptions } from './shapeBoard.js';

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

describe('shapeGenerateOptions', () => {
  const edge = 96;

  function ringInk(): Uint8Array {
    const ink = new Uint8Array(edge * edge);
    for (let y = 0; y < edge; y++) {
      for (let x = 0; x < edge; x++) {
        const radius = Math.hypot(x + 0.5 - edge / 2, y + 0.5 - edge / 2);
        if (radius > 40 || (radius > 18 && radius < 22)) ink[y * edge + x] = 1;
      }
    }
    return ink;
  }

  it('cuts the board from a silhouette the size of the grid', () => {
    const options = shapeGenerateOptions({ ink: ringInk(), edge }, 40);
    expect(options.silhouette?.width).toBe(40);
    expect(options.silhouette?.height).toBe(40);
    expect(options.silhouette?.inside.some((cell) => cell === 1)).toBe(true);
  });

  it('keeps every enclosed void, since each one is a face the player fills', () => {
    expect(shapeGenerateOptions({ ink: ringInk(), edge }, 40).repair?.holeAreaThreshold).toBe(0);
  });

  it('resamples the one bake to whatever grid size the board asks for', () => {
    const drawing = { ink: ringInk(), edge };
    expect(shapeGenerateOptions(drawing, 60).silhouette?.width).toBe(60);
    expect(shapeGenerateOptions(drawing, 78).silhouette?.width).toBe(78);
  });

  it('refuses a drawing with no enclosed face rather than generating from nothing', () => {
    const solid = new Uint8Array(edge * edge).fill(1);
    expect(() => shapeGenerateOptions({ ink: solid, edge }, 40)).toThrow(/enclosed face/);
  });
});
