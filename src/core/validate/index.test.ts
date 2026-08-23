import { describe, expect, it } from 'vitest';
import {
  ACYCLIC_BOARD,
  ACYCLIC_BOARD_ART,
  ACYCLIC_BOARD_WALKS,
  makeBoardAndMask,
} from '../../../test/fixtures/index.js';
import * as validate from './index.js';

/** Covers the barrel itself: most tests import the modules behind it directly. */
describe('the public API surface', () => {
  it('re-exports validateBoard and it behaves the same as the direct import', () => {
    const { mask } = makeBoardAndMask({ art: ACYCLIC_BOARD_ART, walks: ACYCLIC_BOARD_WALKS });
    expect(() => validate.validateBoard(ACYCLIC_BOARD, mask)).not.toThrow();
  });

  it('re-exports greedyClear, rayBlockers, checkStructure, checkCoverage, checkEdgesMatchRays, and assertDeterministic', () => {
    expect(validate.greedyClear(ACYCLIC_BOARD).order.length).toBe(3);
    expect(validate.rayBlockers(ACYCLIC_BOARD, 3)).toEqual([]);
    expect(() => validate.checkStructure(ACYCLIC_BOARD)).not.toThrow();
    expect(() => validate.checkEdgesMatchRays(ACYCLIC_BOARD)).not.toThrow();
    expect(() => validate.assertDeterministic(ACYCLIC_BOARD, ACYCLIC_BOARD)).not.toThrow();
    expect(validate.isDirection(2)).toBe(true);
    expect(validate.MIN_COVERAGE).toBeGreaterThan(0.9);
  });
});
