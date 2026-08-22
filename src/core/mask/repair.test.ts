import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { maskViolations } from '../../../test/fixtures/postconditions.js';
import { DIRECTIONS, NO_CELL, parityOf, step } from '../grid.js';
import type { Mask } from '../types.js';
import type { Blob } from './blob.js';
import { generateBlob } from './blob.js';
import { repairMask } from './repair.js';

const seedArb = fc.integer({ min: 0, max: 1_000_000 });
const gridSizeArb = fc.integer({ min: 20, max: 100 });
const fillFractionArb = fc.double({ min: 0.05, max: 0.85, noNaN: true });

/**
 * A blob with too little 2-cell-thick interior for anything to survive the
 * open step (measured: small grids at low fillFraction, e.g. gridSize 20 with
 * fillFraction <= 0.1 — see the issue #3 report) is a documented, expected
 * throw, not a bug. Property tests that only care about the shape of a
 * *successful* repair skip that case here rather than either asserting
 * against a Mask that does not exist or silently swallowing every other kind
 * of failure.
 */
function attemptRepair(blob: Blob): Mask | null {
  try {
    return repairMask(blob);
  } catch (err) {
    if (err instanceof Error && /removed the entire region/.test(err.message)) return null;
    throw err;
  }
}

function insideCount(inside: Uint8Array): number {
  let count = 0;
  for (const v of inside) if (v === 1) count++;
  return count;
}

function componentCount(width: number, height: number, inside: Uint8Array): number {
  const seen = new Uint8Array(inside.length);
  let count = 0;
  for (let start = 0; start < inside.length; start++) {
    if (inside[start] !== 1 || seen[start] === 1) continue;
    count++;
    seen[start] = 1;
    const stack = [start];
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      for (const dir of DIRECTIONS) {
        const next = step(cell, dir, width, height);
        if (next === NO_CELL || inside[next] !== 1 || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return count;
}

describe('repairMask acceptance criteria', () => {
  it('produces a mask with exactly one 4-connected component, over hundreds of random blobs', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        expect(componentCount(mask.width, mask.height, mask.inside)).toBe(1);
      }),
      { numRuns: 300 },
    );
  }, 20000);

  it('never leaves an inside cell with fewer than 2 inside-neighbours, over hundreds of random blobs', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        for (let i = 0; i < mask.inside.length; i++) {
          if (mask.inside[i] !== 1) continue;
          let neighbours = 0;
          for (const dir of DIRECTIONS) {
            const n = step(i, dir, mask.width, mask.height);
            if (n !== NO_CELL && mask.inside[n] === 1) neighbours++;
          }
          expect(neighbours).toBeGreaterThanOrEqual(2);
        }
      }),
      { numRuns: 300 },
    );
  }, 20000);

  it('pathCellCount matches the actual count of inside-and-not-unvisited cells', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        let counted = 0;
        for (let i = 0; i < mask.inside.length; i++) {
          if (mask.inside[i] === 1 && mask.unvisited[i] !== 1) counted++;
        }
        expect(mask.pathCellCount).toBe(counted);
      }),
      { numRuns: 300 },
    );
  }, 20000);

  it('leaves unvisited all-zero — parity absorption is separate work (#4)', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        expect(insideCount(mask.unvisited)).toBe(0);
      }),
      { numRuns: 200 },
    );
  }, 20000);

  it('satisfies every S1 postcondition maskViolations checks (except parity, deferred to #4)', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        const violations = maskViolations(mask).filter((v) => !v.includes('checkerboard parity'));
        expect(violations).toEqual([]);
      }),
      { numRuns: 300 },
    );
  }, 20000);
});

describe('repairMask: half-resolution repair keeps checkerboard parity at 0', () => {
  it('|black - white| is exactly 0 after repair, not merely within {0, ±1}', () => {
    // generateBlob's own 2x2 block alignment gives |black - white| === 0
    // before repair; repairing at half resolution and upscaling with the same
    // whole-block mapping should preserve that exactly, since every write
    // this pipeline makes is in whole half-resolution-cell (i.e. full 2x2
    // block) units. This is the empirical confirmation issue #3 asks for:
    // parity absorption (#4) should have nothing left to do downstream of
    // this generator + repair pair.
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        let black = 0;
        let white = 0;
        for (let i = 0; i < mask.inside.length; i++) {
          if (mask.inside[i] !== 1) continue;
          if (parityOf(i, mask.width) === 0) black++;
          else white++;
        }
        expect(black).toBe(white);
      }),
      { numRuns: 300 },
    );
  }, 20000);
});

describe('repairMask: block alignment survives repair', () => {
  it('every 2x2 block at offset (0, 0) is wholly inside or wholly outside', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        const halfWidth = Math.floor(mask.width / 2);
        const halfHeight = Math.floor(mask.height / 2);
        for (let by = 0; by < halfHeight; by++) {
          for (let bx = 0; bx < halfWidth; bx++) {
            const x0 = bx * 2;
            const y0 = by * 2;
            const count =
              (mask.inside[y0 * mask.width + x0] as number) +
              (mask.inside[y0 * mask.width + x0 + 1] as number) +
              (mask.inside[(y0 + 1) * mask.width + x0] as number) +
              (mask.inside[(y0 + 1) * mask.width + x0 + 1] as number);
            expect(count === 0 || count === 4).toBe(true);
          }
        }
      }),
      { numRuns: 300 },
    );
  }, 20000);
});

describe('repairMask determinism', () => {
  it('is a pure function of its input blob — identical mask every call', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const a = attemptRepair(blob);
        const b = attemptRepair(blob);
        expect(a === null).toBe(b === null);
        if (a === null || b === null) return;
        expect([...a.inside]).toEqual([...b.inside]);
        expect([...a.unvisited]).toEqual([...b.unvisited]);
        expect(a.pathCellCount).toBe(b.pathCellCount);
      }),
      { numRuns: 100 },
    );
  }, 20000);
});

describe('repairMask edge cases', () => {
  it('throws when the region has no 2-cell-thick interior to survive the open', () => {
    // A single-cell-wide ring: every cell has exactly 2 inside neighbours (so
    // it passes the maskViolations spur check unrepaired) but none has all 4,
    // so erosion removes everything and there is nothing left to dilate back.
    const width = 6;
    const height = 6;
    const inside = new Uint8Array(width * height);
    for (let y = 1; y <= 4; y++) {
      for (let x = 1; x <= 4; x++) {
        const isRingCell = y === 1 || y === 4 || x === 1 || x === 4;
        if (isRingCell) inside[y * width + x] = 1;
      }
    }
    const blob: Blob = { width, height, inside };
    expect(() => repairMask(blob)).toThrow(/removed the entire region/);
  });

  it('throws on a real generateBlob output too small to have any 2-cell-thick interior', () => {
    // Measured directly (see the issue #3 report): a gridSize-20 blob at the
    // GenParams floor of fillFraction 0.05 is small enough that morphological
    // open erases it entirely. This is a real, if rare, consequence of the
    // documented GenParams range, not a hand-built pathology.
    const blob = generateBlob({ seed: 0, gridSize: 20, fillFraction: 0.05 });
    expect(() => repairMask(blob)).toThrow(/removed the entire region/);
  });

  it('fills a hand-built hole no larger than the default threshold', () => {
    // A 16x16 solid block — large enough that plenty of erosion survivors
    // remain even next to the gap, so the result is not the degenerate
    // "single isolated survivor" case that pruning would erase entirely —
    // with a single enclosed 2x2 gap at full-res (6,6)-(7,7), block-aligned
    // so it downsamples to exactly one enclosed half-resolution cell, well
    // under the default hole-area threshold of 4. It should come back filled
    // rather than surviving as an interior hole.
    const width = 16;
    const height = 16;
    const inside = new Uint8Array(width * height).fill(1);
    for (const [x, y] of [
      [6, 6],
      [7, 6],
      [6, 7],
      [7, 7],
    ]) {
      inside[(y as number) * width + (x as number)] = 0;
    }
    const blob: Blob = { width, height, inside };
    const mask = repairMask(blob);
    expect(mask.inside[6 * width + 6]).toBe(1);
    expect(mask.inside[7 * width + 7]).toBe(1);
  });
});
