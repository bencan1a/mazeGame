import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIRECTIONS, NO_CELL, step } from '../grid.js';
import { createRng } from '../rng.js';
import type { Rng } from '../rng.js';
import type { Mask } from '../types.js';
import { PLUS_MASK, SQUARE_MASK, UNVISITED_MASK, makeMask } from '../../../test/fixtures/mask.js';
import { pathViolations } from '../../../test/fixtures/postconditions.js';
import { buildContourPath } from './contour.js';

/**
 * A random connected subset of a halfWidth x halfHeight block grid, grown one
 * block at a time from an existing member's unvisited neighbour. Connected by
 * construction, so it is always a fair input to the contour method once
 * expanded to full resolution.
 */
function randomConnectedBlocks(
  halfWidth: number,
  halfHeight: number,
  blockCount: number,
  rng: Rng,
): Uint8Array {
  const blockFull = new Uint8Array(halfWidth * halfHeight);
  const frontier: number[] = [rng.int(halfWidth * halfHeight)];
  blockFull[frontier[0] as number] = 1;
  let placed = 1;

  while (placed < blockCount && frontier.length > 0) {
    const pick = rng.int(frontier.length);
    const from = frontier[pick] as number;
    const candidates: number[] = [];
    for (const dir of DIRECTIONS) {
      const next = step(from, dir, halfWidth, halfHeight);
      if (next !== NO_CELL && blockFull[next] !== 1) candidates.push(next);
    }
    if (candidates.length === 0) {
      // Fully surrounded — remove it from the frontier and try another member.
      frontier.splice(pick, 1);
      continue;
    }
    const next = candidates[rng.int(candidates.length)] as number;
    blockFull[next] = 1;
    placed++;
    frontier.push(next);
  }
  return blockFull;
}

/** Expand a block-resolution footprint into the full-resolution Mask it tiles. */
function maskFromBlocks(blockFull: Uint8Array, halfWidth: number, halfHeight: number): Mask {
  const width = halfWidth * 2;
  const height = halfHeight * 2;
  const inside = new Uint8Array(width * height);
  let pathCellCount = 0;
  for (let by = 0; by < halfHeight; by++) {
    for (let bx = 0; bx < halfWidth; bx++) {
      if (blockFull[by * halfWidth + bx] !== 1) continue;
      const x0 = bx * 2;
      const y0 = by * 2;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        inside[(y0 + (dy as number)) * width + (x0 + (dx as number))] = 1;
        pathCellCount++;
      }
    }
  }
  return { width, height, inside, unvisited: new Uint8Array(width * height), pathCellCount };
}

describe('buildContourPath: property tests', () => {
  it('visits every path cell exactly once, with 4-neighbour consecutive steps, over full rectangles', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 25 }),
        fc.integer({ min: 1, max: 25 }),
        fc.integer({ min: 0, max: 2 ** 30 }),
        (halfWidth, halfHeight, seed) => {
          const mask = makeMask({ width: halfWidth * 2, height: halfHeight * 2 });
          const result = buildContourPath(mask, createRng(seed));
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(pathViolations(result.path, mask)).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('visits every path cell exactly once, with 4-neighbour consecutive steps, over random tileable shapes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 12 }),
        fc.integer({ min: 3, max: 12 }),
        fc.integer({ min: 0, max: 2 ** 30 }),
        (halfWidth, halfHeight, seed) => {
          const growthRng = createRng(seed);
          const blockCount = 1 + growthRng.int(halfWidth * halfHeight);
          const blockFull = randomConnectedBlocks(halfWidth, halfHeight, blockCount, growthRng);
          const mask = maskFromBlocks(blockFull, halfWidth, halfHeight);

          const result = buildContourPath(mask, createRng(seed + 1));
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(pathViolations(result.path, mask)).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('never throws on any fixture mask, tileable or not', () => {
    for (const mask of [SQUARE_MASK, PLUS_MASK, UNVISITED_MASK]) {
      expect(() => buildContourPath(mask, createRng(1))).not.toThrow();
    }
  });

  it('visits every path cell exactly once under any turnBias, over full rectangles', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 25 }),
        fc.integer({ min: 1, max: 25 }),
        fc.integer({ min: 0, max: 2 ** 30 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (halfWidth, halfHeight, seed, bias) => {
          const mask = makeMask({ width: halfWidth * 2, height: halfHeight * 2 });
          const result = buildContourPath(mask, createRng(seed), bias);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(pathViolations(result.path, mask)).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });
});
