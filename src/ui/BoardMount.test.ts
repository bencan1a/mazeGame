import { describe, expect, it } from 'vitest';
import { genParamsForShape } from '../game/shapeBoard.js';
import { paramsFromLocation } from './BoardMount.js';

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
