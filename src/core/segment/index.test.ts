import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { makeMask, makePath } from '../../../test/fixtures/index.js';
import { segmentPath } from './index.js';

// Every other test file imports directly, so only this catches a bad re-export.
describe('segment barrel export', () => {
  it('re-exports a working segmentPath', () => {
    const mask = makeMask({ width: 6, height: 1 });
    const path = makePath(mask);
    const params = { ...DEFAULT_GEN_PARAMS, gridSize: 6, meanPieceLength: 3 };

    const { segStart, segCells } = segmentPath(path, params, createRng(1));

    expect(segStart[0]).toBe(0);
    expect(segStart[segStart.length - 1]).toBe(segCells.length);
  });
});
