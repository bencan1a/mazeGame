import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIRECTIONS, NO_CELL, parityOf, step, toIndex, xOf, yOf } from '../grid.js';
import { generateBlob } from './blob.js';

const seedArb = fc.integer({ min: 0, max: 1_000_000 });
// Small grids can legitimately have a bounding box the blob fills entirely
// (there just isn't room for a lobe), so shape-organic-ness tests use a floor
// big enough to give the boundary somewhere to wander.
const gridSizeArb = fc.integer({ min: 20, max: 80 });

function insideCount(inside: Uint8Array): number {
  let count = 0;
  for (const v of inside) if (v === 1) count++;
  return count;
}

describe('generateBlob determinism', () => {
  it('is a pure function of (seed, gridSize) — identical grid every call', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, (seed, gridSize) => {
        const a = generateBlob({ seed, gridSize });
        const b = generateBlob({ seed, gridSize });
        expect(a.width).toBe(b.width);
        expect(a.height).toBe(b.height);
        expect([...a.inside]).toEqual([...b.inside]);
      }),
      { numRuns: 100 },
    );
  });

  it('is stable across repeated calls including fillFraction', () => {
    fc.assert(
      fc.property(
        seedArb,
        gridSizeArb,
        fc.double({ min: 0.05, max: 0.85, noNaN: true }),
        (seed, gridSize, fillFraction) => {
          const a = generateBlob({ seed, gridSize, fillFraction });
          const b = generateBlob({ seed, gridSize, fillFraction });
          expect([...a.inside]).toEqual([...b.inside]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('different seeds produce different grids (same gridSize)', () => {
    // Not a hard contract, but a sanity check that the shape actually varies
    // with the seed rather than being some seed-independent constant.
    const a = generateBlob({ seed: 1, gridSize: 40 });
    const b = generateBlob({ seed: 2, gridSize: 40 });
    expect([...a.inside]).not.toEqual([...b.inside]);
  });
});

describe('generateBlob output shape', () => {
  it('always produces a non-empty region that fits inside the grid', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: 0.05, max: 0.85, noNaN: true }),
        (seed, gridSize, fillFraction) => {
          const blob = generateBlob({ seed, gridSize, fillFraction });
          expect(blob.width).toBe(gridSize);
          expect(blob.height).toBe(gridSize);
          expect(blob.inside.length).toBe(gridSize * gridSize);
          expect(insideCount(blob.inside)).toBeGreaterThan(0);
          expect(insideCount(blob.inside)).toBeLessThanOrEqual(gridSize * gridSize);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is non-empty even at the extreme corners of gridSize and fillFraction', () => {
    for (const gridSize of [1, 2, 3, 20, 100]) {
      for (const fillFraction of [0.01, 0.05, 0.45, 0.85, 0.99]) {
        const blob = generateBlob({ seed: 7, gridSize, fillFraction });
        expect(insideCount(blob.inside)).toBeGreaterThan(0);
      }
    }
  });

  it('rejects a non-positive or fractional gridSize', () => {
    expect(() => generateBlob({ seed: 1, gridSize: 0 })).toThrow();
    expect(() => generateBlob({ seed: 1, gridSize: -5 })).toThrow();
    expect(() => generateBlob({ seed: 1, gridSize: 4.5 })).toThrow();
  });
});

describe('generateBlob is organically shaped', () => {
  it('does not fill its own bounding box (rules out a plain rectangle)', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, (seed, gridSize) => {
        const { inside, width, height } = generateBlob({ seed, gridSize, fillFraction: 0.4 });
        let minX = width;
        let maxX = -1;
        let minY = height;
        let maxY = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (inside[toIndex(x, y, width)] !== 1) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        const boundingArea = (maxX - minX + 1) * (maxY - minY + 1);
        expect(insideCount(inside)).toBeLessThan(boundingArea);
      }),
      { numRuns: 100 },
    );
  });

  it('has a boundary radius that varies enough not to be a disc', () => {
    fc.assert(
      fc.property(seedArb, gridSizeArb, (seed, gridSize) => {
        const { inside, width, height } = generateBlob({ seed, gridSize, fillFraction: 0.4 });

        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let i = 0; i < inside.length; i++) {
          if (inside[i] !== 1) continue;
          sx += xOf(i, width);
          sy += yOf(i, width);
          n++;
        }
        const cx = sx / n;
        const cy = sy / n;

        // Boundary cells: inside, with at least one outside (or off-grid)
        // 4-neighbour. A disc's boundary sits at a near-constant distance
        // from the centroid; an organic blob's should not.
        const radii: number[] = [];
        for (let i = 0; i < inside.length; i++) {
          if (inside[i] !== 1) continue;
          const isBoundary = DIRECTIONS.some((dir) => {
            const nb = step(i, dir, width, height);
            return nb === NO_CELL || inside[nb] !== 1;
          });
          if (!isBoundary) continue;
          const x = xOf(i, width);
          const y = yOf(i, width);
          radii.push(Math.hypot(x - cx, y - cy));
        }

        const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
        const variance = radii.reduce((a, b) => a + (b - mean) ** 2, 0) / radii.length;
        const stdDev = Math.sqrt(variance);

        // A perfect disc has stdDev/mean near 0 (all boundary points at the
        // same radius); an axis-aligned square is also unusually uniform in
        // Euclidean radius terms. Organic lobing pushes this well above a
        // disc's near-zero baseline.
        expect(stdDev / mean).toBeGreaterThan(0.05);
      }),
      { numRuns: 100 },
    );
  });
});

describe('generateBlob area is a tunable fraction of the grid', () => {
  it('grows monotonically with fillFraction for a fixed seed and gridSize', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 40, max: 100 }), (seed, gridSize) => {
        // Harmonics are drawn from the seed before fillFraction rescales the
        // radius, so the shape is self-similar across fractions and area
        // should increase monotonically as long as nothing clips against the
        // grid edge — hence a moderate range, comfortably below the point
        // where a big blob starts pressing against the boundary.
        const fractions = [0.1, 0.2, 0.3, 0.4];
        const areas = fractions.map((fillFraction) =>
          insideCount(generateBlob({ seed, gridSize, fillFraction }).inside),
        );
        for (let i = 1; i < areas.length; i++) {
          expect(areas[i]).toBeGreaterThanOrEqual(areas[i - 1] as number);
        }
        // And the low and high ends of the range must actually differ, so
        // "monotonic" isn't trivially true because fillFraction is ignored.
        expect(areas[areas.length - 1]).toBeGreaterThan(areas[0] as number);
      }),
      { numRuns: 100 },
    );
  });

  it('lands in the right ballpark of the requested fraction', () => {
    // Not exact — the harmonics perturb the disc's area away from the ideal
    // circle formula — but it should be the same order of magnitude, and
    // clearly distinguish a small ask from a large one.
    const gridSize = 60;
    for (const fillFraction of [0.15, 0.3, 0.5]) {
      const { inside } = generateBlob({ seed: 3, gridSize, fillFraction });
      const actualFraction = insideCount(inside) / (gridSize * gridSize);
      expect(actualFraction).toBeGreaterThan(fillFraction * 0.4);
      expect(actualFraction).toBeLessThan(fillFraction * 2.5);
    }
  });
});

describe('invalid parameters', () => {
  it('rejects a non-finite fillFraction rather than returning an empty mask', () => {
    // NaN survives clamp() and poisons the radius and centre; every cell test
    // then fails and the non-empty fallback writes to inside[NaN], which a
    // Uint8Array silently ignores. Empty output would break the one invariant
    // this module states outright.
    for (const fillFraction of [NaN, Infinity, -Infinity]) {
      expect(() => generateBlob({ seed: 1, gridSize: 20, fillFraction })).toThrow(
        /fillFraction must be a finite number/,
      );
    }
  });

  it('still accepts an absent fillFraction', () => {
    expect(insideCount(generateBlob({ seed: 1, gridSize: 20 }).inside)).toBeGreaterThan(0);
  });
});

// Issue #58: the blob is drawn at half resolution and upscaled 2x so that
// every region tiles into 2x2 blocks, which is what the spanning-tree contour
// path method (#5) needs. These tests pin that postcondition down directly,
// rather than trusting that "draw at half res, upscale by 2" produced it.
describe('generateBlob tiles into 2x2 blocks at offset (0, 0)', () => {
  it('never produces a 2x2 block that is partially inside', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: 0.05, max: 0.85, noNaN: true }),
        (seed, gridSize, fillFraction) => {
          const { width, height, inside } = generateBlob({ seed, gridSize, fillFraction });
          const halfWidth = Math.floor(width / 2);
          const halfHeight = Math.floor(height / 2);
          for (let by = 0; by < halfHeight; by++) {
            for (let bx = 0; bx < halfWidth; bx++) {
              const x0 = bx * 2;
              const y0 = by * 2;
              const count =
                (inside[toIndex(x0, y0, width)] as number) +
                (inside[toIndex(x0 + 1, y0, width)] as number) +
                (inside[toIndex(x0, y0 + 1, width)] as number) +
                (inside[toIndex(x0 + 1, y0 + 1, width)] as number);
              expect(count === 0 || count === 4).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
    // 200 runs at up to gridSize 100 measures ~2.7s idle, over half of vitest's
    // 5s default, so it reddens CI whenever a runner is loaded. Budget, not hang.
  }, 20_000);

  it('leaves any leftover row/column from an odd gridSize entirely outside', () => {
    // halfResSize rounds gridSize/2 down, so an odd gridSize has exactly one
    // full-resolution row and one column (the last of each) that fall outside
    // every 2x2 block. Those must never be marked inside, or classifyTiling
    // would reject the region as having a path cell no block covers.
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 1, max: 101 }), (seed, gridSize) => {
        const { width, height, inside } = generateBlob({ seed, gridSize });
        // Mirrors halfResSize's own floor-with-a-floor-of-1: below gridSize 2
        // there is no room for even one full-resolution 2x2 block, so the
        // generator clips a single conceptual block down to whatever the grid
        // actually has rather than leaving it empty — see the non-empty
        // guarantee in generateRadialBlob.
        const half = Math.max(1, Math.floor(width / 2));
        const coveredWidth = Math.min(width, half * 2);
        const coveredHeight = Math.min(height, half * 2);
        for (let y = 0; y < height; y++) {
          if (y < coveredHeight) {
            for (let x = coveredWidth; x < width; x++) {
              expect(inside[toIndex(x, y, width)]).toBe(0);
            }
            continue;
          }
          for (let x = 0; x < width; x++) {
            expect(inside[toIndex(x, y, width)]).toBe(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('picks an odd gridSize deliberately by rounding down, not rejecting it', () => {
    // Documents the judgement call: odd gridSize is a valid input, handled by
    // flooring to the nearest even coverage rather than throwing.
    for (const gridSize of [21, 41, 63, 99]) {
      expect(() => generateBlob({ seed: 1, gridSize })).not.toThrow();
      expect(insideCount(generateBlob({ seed: 1, gridSize }).inside)).toBeGreaterThan(0);
    }
  });
});

describe('generateBlob has zero checkerboard parity mismatch', () => {
  it('|black - white| is exactly 0, not merely within {0, ±1}', () => {
    // A block-aligned region is built from whole 2x2 blocks, and every 2x2
    // block on a checkerboard has exactly two black and two white cells
    // regardless of where it sits — so the region-wide counts cancel exactly.
    // This is the empirical confirmation issue #58 asks for: parity
    // absorption (#4) has nothing left to do on a blob from this generator.
    // gridSize 1 is excluded: there is no room for even one whole 2x2 block,
    // so halfResSize's floor-of-1 clamp trims the block to a single cell (see
    // the "leaves any leftover..." test above) and the guarantee genuinely
    // does not apply — a corner case, not the game's operating range of
    // 20..100 (PRD §3.1).
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 2, max: 100 }),
        fc.double({ min: 0.05, max: 0.85, noNaN: true }),
        (seed, gridSize, fillFraction) => {
          const { width, inside } = generateBlob({ seed, gridSize, fillFraction });
          let black = 0;
          let white = 0;
          for (let i = 0; i < inside.length; i++) {
            if (inside[i] !== 1) continue;
            if (parityOf(i, width) === 0) black++;
            else white++;
          }
          expect(black).toBe(white);
        },
      ),
      { numRuns: 200 },
    );
  });
});
