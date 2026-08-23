import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { directionBetween } from '../grid.js';
import { createRng } from '../rng.js';
import type { GenParams, HamiltonianPath } from '../types.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { makeMask, makePath } from '../../../test/fixtures/index.js';
import { segmentPath } from './segmentPath.js';

/** A GenParams for a `width x height` rectangle, overriding only what a test cares about. */
function paramsFor(width: number, overrides: Partial<GenParams>): GenParams {
  return { ...DEFAULT_GEN_PARAMS, gridSize: width, ...overrides };
}

/**
 * Independent check of the minStraightRun postcondition (CONTRACTS.md §S3):
 * re-derived from `path` and `segStart` alone, since a test sharing
 * segmentPath's own dirs/runStart/runEnd bookkeeping could pass by
 * construction.
 *
 * A cut is judged against the run it sits inside narrowed to the neighbouring
 * cuts, not the run's full geometric extent: the escape hatch ("the path
 * offers none") means none given what earlier cuts already fixed, not none in
 * a hypothetical replay with no other cuts.
 */
function straightRunViolations(
  path: HamiltonianPath,
  width: number,
  segStart: Uint32Array,
  minStraightRun: number,
): string[] {
  const violations: string[] = [];
  const cells = path.cells;
  const dirs: number[] = [];
  for (let i = 0; i < cells.length - 1; i++) {
    dirs.push(directionBetween(cells[i] as number, cells[i + 1] as number, width));
  }

  for (let s = 1; s < segStart.length - 1; s++) {
    const k = (segStart[s] as number) - 1; // cut: segment ends at cell k, next starts at k+1
    if (k <= 0 || k >= dirs.length) continue;
    const before = dirs[k - 1];
    const after = dirs[k];
    if (before !== after) continue; // a corner cut is always fine

    // Walk outward from k to find the full geometric extent of the run.
    let runStart = k;
    while (runStart > 0 && dirs[runStart - 1] === after) runStart--;
    let runEnd = k;
    while (runEnd < dirs.length - 1 && dirs[runEnd + 1] === after) runEnd++;

    // Narrow that extent to what this cut actually had available: it cannot
    // reach past the previous cut on the left, or the next cut on the right.
    const windowStart = Math.max(runStart, segStart[s - 1] as number);
    const windowEnd = Math.min(runEnd + 1, (segStart[s + 1] as number) - 1);
    const windowCells = windowEnd - windowStart + 1;
    if (windowCells < 2 * minStraightRun) continue; // no compliant split was ever available here

    const leftCells = k - windowStart + 1;
    const rightCells = windowEnd - k;
    if (leftCells < minStraightRun || rightCells < minStraightRun) {
      violations.push(
        `cut after path index ${k} splits an available ${windowCells}-cell straight run into ` +
          `${leftCells}/${rightCells}, minStraightRun is ${minStraightRun}`,
      );
    }
  }
  return violations;
}

const dims = fc.integer({ min: 1, max: 20 });
const mean = fc.integer({ min: 1, max: 12 });
const variance = fc.integer({ min: 0, max: 6 });
const minRun = fc.integer({ min: 1, max: 5 });
const seed = fc.integer({ min: 1, max: 1_000_000 });

describe('segmentPath', () => {
  it('partitions the path exactly: concatenating segments reproduces path.cells', () => {
    fc.assert(
      fc.property(dims, dims, mean, variance, minRun, seed, (w, h, m, v, r, s) => {
        const mask = makeMask({ width: w, height: h });
        const path = makePath(mask);
        const params = paramsFor(w, {
          seed: s,
          meanPieceLength: m,
          pieceLengthVariance: v,
          minStraightRun: r,
        });

        const result = segmentPath(path, params, createRng(s));

        expect(Array.from(result.segCells)).toEqual(Array.from(path.cells));
        expect(result.segStart[0]).toBe(0);
        expect(result.segStart[result.segStart.length - 1]).toBe(path.cells.length);
      }),
      { numRuns: 200 },
    );
  });

  it('never produces an empty segment; segStart is strictly increasing (well-formed CSR)', () => {
    fc.assert(
      fc.property(dims, dims, mean, variance, minRun, seed, (w, h, m, v, r, s) => {
        const mask = makeMask({ width: w, height: h });
        const path = makePath(mask);
        const params = paramsFor(w, {
          seed: s,
          meanPieceLength: m,
          pieceLengthVariance: v,
          minStraightRun: r,
        });

        const { segStart, segCells } = segmentPath(path, params, createRng(s));

        for (let i = 1; i < segStart.length; i++) {
          expect(segStart[i] as number).toBeGreaterThan(segStart[i - 1] as number);
        }
        expect(segStart[segStart.length - 1]).toBe(segCells.length);
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic for a given (path, params, seed)', () => {
    fc.assert(
      fc.property(dims, dims, mean, variance, minRun, seed, (w, h, m, v, r, s) => {
        const mask = makeMask({ width: w, height: h });
        const path = makePath(mask);
        const params = paramsFor(w, {
          seed: s,
          meanPieceLength: m,
          pieceLengthVariance: v,
          minStraightRun: r,
        });

        const a = segmentPath(path, params, createRng(s));
        const b = segmentPath(path, params, createRng(s));

        expect(Array.from(a.segStart)).toEqual(Array.from(b.segStart));
        expect(Array.from(a.segCells)).toEqual(Array.from(b.segCells));
      }),
      { numRuns: 100 },
    );
  });

  it('never leaves a straight run shorter than minStraightRun, except where none is possible', () => {
    fc.assert(
      fc.property(dims, dims, mean, variance, minRun, seed, (w, h, m, v, r, s) => {
        const mask = makeMask({ width: w, height: h });
        const path = makePath(mask);
        const params = paramsFor(w, {
          seed: s,
          meanPieceLength: m,
          pieceLengthVariance: v,
          minStraightRun: r,
        });

        const { segStart } = segmentPath(path, params, createRng(s));

        expect(straightRunViolations(path, w, segStart, Math.max(1, r))).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });

  it('handles a single-cell path without a cut', () => {
    const mask = makeMask({ width: 1, height: 1 });
    const path = makePath(mask);
    const params = paramsFor(1, { seed: 1 });

    const { segStart, segCells } = segmentPath(path, params, createRng(1));

    expect(Array.from(segStart)).toEqual([0, 1]);
    expect(Array.from(segCells)).toEqual([0]);
  });

  it('handles a degenerate empty path without a cut', () => {
    const params = paramsFor(1, { seed: 1 });

    const { segStart, segCells } = segmentPath({ cells: new Uint32Array(0) }, params, createRng(1));

    expect(Array.from(segStart)).toEqual([0]);
    expect(Array.from(segCells)).toEqual([]);
  });

  it('rejects a path whose consecutive cells are not 4-neighbours', () => {
    const params = paramsFor(4, { seed: 1 });

    // Cells 0 and 5 are a diagonal jump on a width-4 grid, not a step.
    expect(() => segmentPath({ cells: Uint32Array.from([0, 5]) }, params, createRng(1))).toThrow(
      /not 4-neighbours/,
    );
  });

  it('cuts a straight 10-cell run at the target length when both slices honour minStraightRun', () => {
    // Zero variance makes rng.normal deterministic (== mean) regardless of
    // seed, so this example is exact rather than merely "in range".
    const mask = makeMask({ width: 10, height: 1 });
    const path = makePath(mask);
    const params = paramsFor(10, {
      seed: 1,
      meanPieceLength: 3,
      pieceLengthVariance: 0,
      minStraightRun: 2,
    });

    const { segStart, segCells } = segmentPath(path, params, createRng(1));

    // Targets land at cuts after index 2, 5, 8. The last one (8) would leave
    // only 1 cell on its right (index 9), below minStraightRun=2, so it is
    // pulled back to 7, the nearest cut that leaves >= 2 cells on both sides.
    expect(Array.from(segStart)).toEqual([0, 3, 6, 8, 10]);
    expect(Array.from(segCells)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(straightRunViolations(path, 10, segStart, 2)).toEqual([]);
  });

  it('leaves a run whole rather than forcing a cut it can never honour minStraightRun for', () => {
    // The whole path is one 6-cell straight run and minStraightRun=5 needs 10
    // cells to split validly anywhere inside it, so no cut here could ever be
    // compliant. The contract's escape hatch is "the path offers none": the
    // best a generator can do is not force a violation into existence, i.e.
    // leave the run as a single segment rather than pick an arbitrary cut.
    const mask = makeMask({ width: 6, height: 1 });
    const path = makePath(mask);
    const params = paramsFor(6, {
      seed: 1,
      meanPieceLength: 3,
      pieceLengthVariance: 0,
      minStraightRun: 5,
    });

    const { segStart, segCells } = segmentPath(path, params, createRng(1));

    expect(Array.from(segStart)).toEqual([0, 6]);
    expect(Array.from(segCells)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(straightRunViolations(path, 6, segStart, 5)).toEqual([]);
  });

  it('mean segment length tracks meanPieceLength within tolerance, over 100 boards', () => {
    const gridSize = 40;
    const meanPieceLength = 14;
    const pieceLengthVariance = 5;
    const minStraightRun = 2;

    let totalCells = 0;
    let totalSegments = 0;
    for (let boardSeed = 1; boardSeed <= 100; boardSeed++) {
      const mask = makeMask({ width: gridSize, height: gridSize });
      const path = makePath(mask);
      const params = paramsFor(gridSize, {
        seed: boardSeed,
        meanPieceLength,
        pieceLengthVariance,
        minStraightRun,
      });

      const { segStart } = segmentPath(path, params, createRng(boardSeed));
      totalSegments += segStart.length - 1;
      totalCells += path.cells.length;
    }

    const observedMean = totalCells / totalSegments;
    expect(observedMean).toBeGreaterThan(meanPieceLength * 0.85);
    expect(observedMean).toBeLessThan(meanPieceLength * 1.15);
  });
});
