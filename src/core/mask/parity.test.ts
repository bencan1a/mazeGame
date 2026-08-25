import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { maskViolations } from '../../../test/fixtures/postconditions.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { DIRECTIONS, NO_CELL, parityOf, step, toIndex } from '../grid.js';
import { classifyTiling } from '../path/tiling.js';
import type { Mask } from '../types.js';
import { generateBlob } from './blob.js';
import { absorbParity } from './parity.js';
import { maskFrom } from './regions.js';
import { MaskRepairError } from './errors.js';
import { repairMask } from './repair.js';

function countColours(mask: Mask): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (let i = 0; i < mask.inside.length; i++) {
    if (mask.inside[i] !== 1 || mask.unvisited[i] === 1) continue;
    if (parityOf(i, mask.width) === 0) black++;
    else white++;
  }
  return { black, white };
}

/**
 * Component count over the *path* cells (`inside && !unvisited`), not raw
 * `inside` — absorbParity only ever writes `unvisited`, so counting
 * components of `inside` alone is identical for every call site here
 * regardless of which cells got absorbed, and would pass for an
 * implementation that ignored connectivity entirely.
 */
function componentCount(mask: Mask): number {
  const isPathCell = (i: number): boolean => mask.inside[i] === 1 && mask.unvisited[i] !== 1;
  const seen = new Uint8Array(mask.inside.length);
  let count = 0;
  for (let start = 0; start < mask.inside.length; start++) {
    if (!isPathCell(start) || seen[start] === 1) continue;
    count++;
    seen[start] = 1;
    const stack = [start];
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      for (const dir of DIRECTIONS) {
        const next = step(cell, dir, mask.width, mask.height);
        if (next === NO_CELL || !isPathCell(next) || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return count;
}

function unvisitedCells(mask: Mask): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.unvisited.length; i++) if (mask.unvisited[i] === 1) out.push(i);
  return out;
}

/**
 * A single horizontal corridor of `spineLength` cells with a black leaf cell
 * hanging below every odd spine position, up to `toothCount` of them. Spine
 * positions are 2 apart, so leaves never touch each other, and each leaf's
 * only edge is to its own spine cell — a pendant, never an articulation
 * point, whatever else is removed. An even `spineLength` keeps the spine
 * itself exactly colour-balanced (alternating parity, equal run lengths), so
 * the whole mask's imbalance is exactly `toothCount`: a controllable knob for
 * exercising `absorbParity` at every `needed` count from 0 up to a throw.
 */
function leafyCorridor(spineLength: number, toothCount: number): Mask {
  const width = spineLength;
  const height = 2;
  const inside = new Uint8Array(width * height);
  for (let x = 0; x < spineLength; x++) inside[toIndex(x, 0, width)] = 1;
  for (let t = 0; t < toothCount; t++) {
    const x = 2 * t + 1;
    inside[toIndex(x, 1, width)] = 1;
  }
  return maskFrom({ width, height, inside, unvisited: new Uint8Array(width * height) });
}

const spineArb = fc.integer({ min: 4, max: 60 }).map((n) => n - (n % 2)); // even
const toothArb = fc.integer({ min: 0, max: 8 });

// Lower than the synthetic-shape properties below because this one drives the
// full generateBlob + repairMask pipeline every run, and the suite runs in
// parallel under coverage instrumentation.
const HEAVY_NUM_RUNS = 80;
const NUM_RUNS = 500;

describe('absorbParity: guard case (this generator + repair never needs it)', () => {
  it('is a no-op over generateBlob + repairMask outputs', () => {
    const seedArb = fc.integer({ min: 0, max: 1_000_000 });
    const gridSizeArb = fc.integer({ min: 20, max: 100 });
    const fillFractionArb = fc.double({ min: 0.05, max: 0.85, noNaN: true });
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        let mask: Mask;
        try {
          mask = repairMask(blob);
        } catch (err) {
          // Only the "no 2-cell-thick interior" case is an expected skip.
          // repairMask now also composes absorbParity, whose own
          // MaskRepairError (parity absorption exceeding the 3-cell budget)
          // would otherwise be swallowed here too — silently hiding exactly
          // the regression this guard test exists to catch.
          if (err instanceof MaskRepairError && /removed the entire region/.test(err.message)) {
            return;
          }
          throw err;
        }
        ran++;
        // repairMask already composes absorbParity; re-running it must find
        // nothing left to do.
        const before = countColours(mask);
        const after = absorbParity(mask);
        expect(after).toBe(mask);
        expect(before.black).toBe(before.white);
        expect(unvisitedCells(mask).length).toBe(0);
      }),
      { numRuns: HEAVY_NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(HEAVY_NUM_RUNS / 2);
  });
});

describe('absorbParity: minimal absorption over leafy-corridor fixtures', () => {
  it('adds exactly max(0, |d| - 1) cells, all majority-colour, keeping one component', () => {
    // Counts runs that actually absorb (1 <= needed <= 3), not every run fc
    // executes: toothCount 0-1 needs nothing and passes trivially, so a total
    // run count cannot tell a suite of no-ops from one that exercises
    // absorption.
    let absorbing = 0;
    fc.assert(
      fc.property(spineArb, toothArb, (spineLength, toothCount) => {
        fc.pre(2 * toothCount - 1 < spineLength);
        const mask = leafyCorridor(spineLength, toothCount);
        const needed = Math.max(0, toothCount - 1);
        if (needed >= 1 && needed <= 3) absorbing++;

        if (needed > 3) {
          expect(() => absorbParity(mask)).toThrow(MaskRepairError);
          return;
        }

        const result = absorbParity(mask);
        const added = unvisitedCells(result);
        expect(added.length).toBe(needed);
        for (const cell of added) expect(parityOf(cell, result.width)).toBe(0); // black is majority

        const { black, white } = countColours(result);
        expect(Math.abs(black - white)).toBeLessThanOrEqual(1);
        expect(componentCount(result)).toBe(1);

        let counted = 0;
        for (let i = 0; i < result.inside.length; i++) {
          if (result.inside[i] === 1 && result.unvisited[i] !== 1) counted++;
        }
        expect(result.pathCellCount).toBe(counted);
      }),
      { numRuns: NUM_RUNS },
    );
    // Measured across several runs (see PR body): roughly 175-190 of 500
    // land in this range; fast-check does not fix a seed here, so the exact
    // count varies run to run.
    expect(absorbing).toBeGreaterThan(NUM_RUNS / 5);
  }, 30000);

  it('fails loudly rather than degrading when more than 3 cells would be needed', () => {
    const mask = leafyCorridor(20, 6); // needed = 5
    expect(() => absorbParity(mask)).toThrow(MaskRepairError);
    expect(() => absorbParity(mask)).toThrow(/exceeding the 3-cell per-region limit/);
  });
});

describe('absorbParity: skips an articulation point for a safe cell of the same colour', () => {
  it('does not choose a majority-colour cell whose removal would split the region', () => {
    // Corridor x=0..7 at y=0, with pendant leaves at (0,1) [white, makes (0,0)
    // an articulation point], and black leaves at (3,1), (5,1), (7,1).
    // Every black corridor cell (x=0,2,4,6) is an articulation point (removing
    // any of them splits the corridor, or — for x=0 — strands its leaf); the
    // first safe black cell in row-major scan order is (3,1). |d| = 2, so
    // exactly one cell must be absorbed.
    const mask = makeMask(['########', '#..#.#.#'].join('\n'));
    const before = countColours(mask);
    expect(before.black - before.white).toBe(2);

    const result = absorbParity(mask);
    const added = unvisitedCells(result);
    expect(added).toEqual([toIndex(3, 1, 8)]);
    expect(componentCount(result)).toBe(1);
    const after = countColours(result);
    expect(Math.abs(after.black - after.white)).toBeLessThanOrEqual(1);
  });
});

describe('absorbParity: pre-existing unvisited cells count toward the 3-cell budget', () => {
  it('adds only what is still needed when some cells are already unvisited', () => {
    // Spine of 12 with black leaves at x=1,3,5; the x=1 leaf starts out
    // already unvisited. |d| = 2 among the remaining path cells, so exactly
    // one more must be absorbed — for a total of 2, under the limit.
    const mask = makeMask(['############', '.o.#.#......'].join('\n'));
    const before = countColours(mask);
    expect(before.black - before.white).toBe(2);

    const result = absorbParity(mask);
    expect(unvisitedCells(result).length).toBe(2);
    expect(componentCount(result)).toBe(1);
    const after = countColours(result);
    expect(Math.abs(after.black - after.white)).toBeLessThanOrEqual(1);
  });

  it('fails loudly when existing-plus-new unvisited would exceed the budget', () => {
    // Same idea with 4 leaves and one already unvisited: 3 more are needed on
    // top of the 1 that already exists, for a total of 4 over one region.
    const mask = makeMask(['################', '.o.#.#.#.#......'].join('\n'));
    expect(() => absorbParity(mask)).toThrow(MaskRepairError);
    expect(() => absorbParity(mask)).toThrow(/leave 4 unvisited cell\(s\) across 1 region\(s\)/);
  });
});

describe('absorbParity: a region containing a cycle', () => {
  it('still finds a safe cell and stays connected when the alive graph has a loop', () => {
    // A 2x2 block (a 4-cycle: every block cell has two in-block neighbours)
    // with four black pendant leaves off the two white corners. |d| = 4, so
    // 3 cells must be absorbed — every round's articulation-point search runs
    // over a graph that still contains the cycle.
    const mask = makeMask(['..#.', '.###', '###.', '.#..'].join('\n'));
    const before = countColours(mask);
    expect(before.black - before.white).toBe(4);

    const result = absorbParity(mask);
    expect(unvisitedCells(result).length).toBe(3);
    expect(componentCount(result)).toBe(1);
    const after = countColours(result);
    expect(Math.abs(after.black - after.white)).toBeLessThanOrEqual(1);
  });
});

describe('absorbParity: articulation points must be recomputed every round', () => {
  it("round 2's safe cell differs from round 1's stale table", () => {
    // black=4 white=7, d=-3, needed=2, majority=white. Removing (3,0) first
    // makes (2,1) a cut vertex it was not before — a table computed once
    // against the original region does not know that, and picks (2,1) for
    // round 2, splitting the region into 2 components. Recomputing per
    // round (what absorbParity does) picks (1,2) instead and stays at 1.
    // Every other fixture in this file only ever removes pendant leaves,
    // which can never promote another cell into a cut vertex, so none of
    // them can tell a per-round recompute apart from a once-computed table.
    const mask = makeMask(['####', '#.##', '##.#', '#...'].join('\n'));
    const before = countColours(mask);
    expect(before.black - before.white).toBe(-3);

    const result = absorbParity(mask);
    expect(unvisitedCells(result)).toEqual([toIndex(3, 0, 4), toIndex(1, 2, 4)]);
    expect(componentCount(result)).toBe(1);
  });
});

describe('absorbParity: balanced input is untouched', () => {
  it('returns the same mask, by reference, when |black - white| <= 1', () => {
    const mask = makeMask({ width: 6, height: 4 });
    expect(absorbParity(mask)).toBe(mask);
  });

  it('leaves an already-balanced odd-cell-count mask alone (|d| = 1 is acceptable)', () => {
    const mask = makeMask(['###', '###', '###'].join('\n'));
    // Reference identity, not just "no new unvisited cells": mutating the
    // `|d| <= 1` guard to `<= 0` still produces a result with zero
    // unvisited cells here (needed becomes 0, so the round loop is a
    // no-op) — only checking that the object is the same `mask`, returned
    // early, catches it.
    expect(absorbParity(mask)).toBe(mask);
  });
});

describe('classifyTiling implies exact checkerboard balance', () => {
  // This is the corollary absorbParity's docstring rests its "nothing to
  // prefer among candidates" claim on: a tileable region is built entirely
  // of whole 2x2 blocks, and every such block holds exactly two cells of
  // each colour regardless of where it sits, so ok === true forces
  // black === white exactly. Checked directly against classifyTiling here,
  // not via absorbParity's output — every leafyCorridor fixture is
  // non-tileable *before* absorption runs (a 2-row corridor with teeth 2
  // apart has no full 2x2 block at any offset), so asserting
  // non-tileability on that output cannot distinguish a correct
  // implementation from `return mask` unchanged; it was passing for the
  // wrong reason.
  it('holds for arbitrary rectangles', () => {
    let tileableCount = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        (width, height) => {
          const mask = makeMask({ width, height });
          if (!classifyTiling(mask).ok) return;
          tileableCount++;
          const { black, white } = countColours(mask);
          expect(black).toBe(white);
        },
      ),
      { numRuns: 300 },
    );
    // A full rectangle tiles at offset (0, 0) exactly when both dimensions
    // are even — roughly a quarter of the [1, 30] x [1, 30] square — so the
    // premise is true often enough that this cannot pass vacuously.
    expect(tileableCount).toBeGreaterThan(30);
  });

  it('holds for generateBlob + repairMask output, which is always tileable', () => {
    const mask = repairMask(generateBlob({ seed: 7, gridSize: 40, fillFraction: 0.45 }));
    expect(classifyTiling(mask).ok).toBe(true);
    const { black, white } = countColours(mask);
    expect(black).toBe(white);
  });
});

describe('absorbParity: postconditions on masks that already satisfy the S1 min-degree invariant', () => {
  it('produces a mask maskViolations accepts, over generateBlob + repairMask (guard case)', () => {
    const mask = repairMask(generateBlob({ seed: 7, gridSize: 40, fillFraction: 0.45 }));
    expect(maskViolations(absorbParity(mask))).toEqual([]);
  });
});
