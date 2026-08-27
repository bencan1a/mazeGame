import { describe, expect, it } from 'vitest';
import { genParamsForShape } from '../game/shapeBoard.js';
import { DEFAULT_GEN_PARAMS, DEFAULT_PLAY_PARAMS } from '../core/types.js';
import { debugEnabled, paramsFromLocation, untouched } from './BoardMount.js';

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

describe('debugEnabled', () => {
  it('is false when there is no location to read a query string from', () => {
    expect(debugEnabled()).toBe(false);
  });

  it('is false without ?debug', () => {
    expect(debugEnabled('?grid=40&seed=7')).toBe(false);
  });

  it('is true for a bare ?debug and for ?debug=1', () => {
    expect(debugEnabled('?debug')).toBe(true);
    expect(debugEnabled('?debug=1')).toBe(true);
  });
});

describe('untouched', () => {
  const base = {
    genParams: DEFAULT_GEN_PARAMS,
    playParams: DEFAULT_PLAY_PARAMS,
    segmentCount: 10,
    status: 'playing' as const,
    shapeId: 'ring',
  };

  it('is true for a board straight off the generator', () => {
    expect(
      untouched({
        ...base,
        snapshot: { removedSegments: [], lives: DEFAULT_PLAY_PARAMS.lives },
      }),
    ).toBe(true);
  });

  it('is false once a segment has gone', () => {
    expect(
      untouched({
        ...base,
        snapshot: { removedSegments: [3], lives: DEFAULT_PLAY_PARAMS.lives },
      }),
    ).toBe(false);
  });

  it('is false once a tap has bounced, even with every segment still on the board', () => {
    expect(
      untouched({
        ...base,
        snapshot: {
          removedSegments: [],
          bouncedSegments: [2],
          lives: DEFAULT_PLAY_PARAMS.lives,
        },
      }),
    ).toBe(false);
  });

  it('is false once a life has gone', () => {
    expect(
      untouched({
        ...base,
        snapshot: { removedSegments: [], lives: DEFAULT_PLAY_PARAMS.lives - 1 },
      }),
    ).toBe(false);
  });
});
