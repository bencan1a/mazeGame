import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { maskViolations } from '../../../test/fixtures/postconditions.js';
import { DIRECTIONS, NO_CELL, parityOf, step, toIndex } from '../grid.js';
import type { Mask } from '../types.js';
import type { Blob } from './blob.js';
import { generateBlob, upscale2x } from './blob.js';
import { MaskRepairError, repairMask } from './repair.js';

const seedArb = fc.integer({ min: 0, max: 1_000_000 });
const gridSizeArb = fc.integer({ min: 20, max: 100 });
const fillFractionArb = fc.double({ min: 0.05, max: 0.85, noNaN: true });

// Property tests over random blobs run this many times each; small enough to
// stay comfortably under vitest's default per-test timeout even under
// coverage instrumentation (see issue #3 review), while still exercising a
// spread of grid sizes and fill fractions.
const NUM_RUNS = 80;

/**
 * A blob with no 2-cell-thick interior for anything to survive the open step
 * (rare — measured well under 1% across the legal GenParams range) is a
 * documented `MaskRepairError`, not a bug. Property tests that only care
 * about the shape of a *successful* repair skip that case.
 */
function attemptRepair(blob: Blob): Mask | null {
  try {
    return repairMask(blob);
  } catch (err) {
    if (err instanceof MaskRepairError) return null;
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
    // A raw blob is disconnected in only a handful of the sampled cases, so
    // most of what this pins down is that generateBlob (and the first
    // largestComponent call) stay connected; the dumbbell fixture below is
    // what actually exercises the largestComponent call *after* the open.
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        ran++;
        expect(componentCount(mask.width, mask.height, mask.inside)).toBe(1);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(NUM_RUNS / 2);
  });

  it('never leaves an inside cell with fewer than 2 inside-neighbours (guaranteed by upscale2x writing whole 2x2 blocks, not by repair itself)', () => {
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        ran++;
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
      { numRuns: NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(NUM_RUNS / 2);
  });

  it('pathCellCount matches the actual count of inside-and-not-unvisited cells', () => {
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        ran++;
        let counted = 0;
        for (let i = 0; i < mask.inside.length; i++) {
          if (mask.inside[i] === 1 && mask.unvisited[i] !== 1) counted++;
        }
        expect(mask.pathCellCount).toBe(counted);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(NUM_RUNS / 2);
  });

  it('leaves unvisited all-zero — parity absorption is separate work (#4)', () => {
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        ran++;
        expect(insideCount(mask.unvisited)).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(NUM_RUNS / 2);
  });

  it('satisfies every S1 postcondition maskViolations checks (except parity, deferred to #4)', () => {
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        ran++;
        const violations = maskViolations(mask).filter((v) => !v.includes('checkerboard parity'));
        expect(violations).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(NUM_RUNS / 2);
  });
});

describe('repairMask: half-resolution repair keeps checkerboard parity at 0', () => {
  it('|black - white| is exactly 0 after repair, not merely within {0, ±1}', () => {
    // Empirical confirmation issue #3 asks for: parity absorption (#4) should
    // have nothing left to do downstream of this generator + repair pair.
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        ran++;
        let black = 0;
        let white = 0;
        for (let i = 0; i < mask.inside.length; i++) {
          if (mask.inside[i] !== 1) continue;
          if (parityOf(i, mask.width) === 0) black++;
          else white++;
        }
        expect(black).toBe(white);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(NUM_RUNS / 2);
  });
});

describe('repairMask: block alignment survives repair', () => {
  it('every 2x2 block at offset (0, 0) is wholly inside or wholly outside', () => {
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        ran++;
        const halfWidth = Math.floor(mask.width / 2);
        const halfHeight = Math.floor(mask.height / 2);
        for (let by = 0; by < halfHeight; by++) {
          for (let bx = 0; bx < halfWidth; bx++) {
            const x0 = bx * 2;
            const y0 = by * 2;
            const count =
              (mask.inside[toIndex(x0, y0, mask.width)] as number) +
              (mask.inside[toIndex(x0 + 1, y0, mask.width)] as number) +
              (mask.inside[toIndex(x0, y0 + 1, mask.width)] as number) +
              (mask.inside[toIndex(x0 + 1, y0 + 1, mask.width)] as number);
            expect(count === 0 || count === 4).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(NUM_RUNS / 2);
  });
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
      { numRuns: NUM_RUNS },
    );
  });
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
        if (isRingCell) inside[toIndex(x, y, width)] = 1;
      }
    }
    const blob: Blob = { width, height, inside };
    expect(() => repairMask(blob)).toThrow(MaskRepairError);
  });

  it('throws on a real generateBlob output too small to have any 2-cell-thick interior', () => {
    // Measured directly (see the issue #3 report): a gridSize-20 blob at the
    // GenParams floor of fillFraction 0.05 is small enough that morphological
    // open erases it entirely. This is a real, if rare, consequence of the
    // documented GenParams range, not a hand-built pathology.
    const blob = generateBlob({ seed: 0, gridSize: 20, fillFraction: 0.05 });
    expect(() => repairMask(blob)).toThrow(MaskRepairError);
  });

  it('throws MaskRepairError, not a generic Error, when a blob is not block-aligned', () => {
    // Odd dimensions with an inside cell in the leftover row: downsampling
    // cannot represent it as a half-resolution block, and must say so rather
    // than silently dropping it.
    const width = 5;
    const height = 4;
    const inside = new Uint8Array(width * height);
    inside[toIndex(4, 0, width)] = 1; // in the leftover column (x === 4)
    const blob: Blob = { width, height, inside };
    expect(() => repairMask(blob)).toThrow(MaskRepairError);
    expect(() => repairMask(blob)).toThrow(/not block-aligned/);
  });

  it('re-takes the largest component after the open severs a thin neck (dumbbell fixture)', () => {
    // Two solid blocks of unequal size joined by a single-half-resolution-
    // cell-wide neck. The neck has no 2D thickness (every neck cell's
    // perpendicular neighbours are outside), so erosion removes it entirely
    // and dilation cannot bridge the gap back — the open step splits one
    // connected raw blob into two disconnected lobes. Only the second
    // largestComponent call (after the open) drops the smaller lobe; without
    // it both lobes would still be present but disconnected, which is
    // exactly what mutation-testing the issue #3 review found untested.
    const halfWidth = 11;
    const halfHeight = 5;
    const halfInside = new Uint8Array(halfWidth * halfHeight);
    const setHalf = (x: number, y: number): void => {
      halfInside[toIndex(x, y, halfWidth)] = 1;
    };
    // Left block (15 half-res cells): x in 0..2, y in 0..4.
    for (let y = 0; y <= 4; y++) for (let x = 0; x <= 2; x++) setHalf(x, y);
    // Right block (9 half-res cells, smaller): x in 8..10, y in 1..3.
    for (let y = 1; y <= 3; y++) for (let x = 8; x <= 10; x++) setHalf(x, y);
    // Neck (5 half-res cells, 1 wide): y = 2, x in 3..7.
    for (let x = 3; x <= 7; x++) setHalf(x, 2);

    const halfBlob: Blob = { width: halfWidth, height: halfHeight, inside: halfInside };
    const blob = upscale2x(halfBlob, halfWidth * 2, halfHeight * 2);

    const mask = repairMask(blob);
    expect(componentCount(mask.width, mask.height, mask.inside)).toBe(1);
    expect(maskViolations(mask).filter((v) => !v.includes('parity'))).toEqual([]);
    // The bigger (left) lobe survives...
    expect(mask.inside[toIndex(2, 2, mask.width)]).toBe(1);
    // ...the smaller (right) lobe does not.
    expect(mask.inside[toIndex(18, 4, mask.width)]).toBe(0);
  });

  it('fills a hand-built hole no larger than the default threshold', () => {
    // A 16x16 solid block — large enough that plenty of erosion survivors
    // remain even next to the gap, so the result is not the degenerate
    // "single isolated survivor" case — with a single enclosed 2x2 gap at
    // full-res (6,6)-(7,7), block-aligned so it downsamples to exactly one
    // enclosed half-resolution cell, well under the default hole-area
    // threshold of 4. It should come back filled rather than surviving as an
    // interior hole.
    const width = 16;
    const height = 16;
    const inside = new Uint8Array(width * height).fill(1);
    for (const [x, y] of [
      [6, 6],
      [7, 6],
      [6, 7],
      [7, 7],
    ]) {
      inside[toIndex(x as number, y as number, width)] = 0;
    }
    const blob: Blob = { width, height, inside };
    const mask = repairMask(blob);
    expect(mask.inside[toIndex(6, 6, width)]).toBe(1);
    expect(mask.inside[toIndex(7, 7, width)]).toBe(1);
  });
});
