import { describe, expect, it } from 'vitest';
import { PLUS_MASK, UNVISITED_MASK, makeMask } from '../../../test/fixtures/mask.js';
import { pathViolations } from '../../../test/fixtures/postconditions.js';
import { createRng } from '../rng.js';
import { maskFrom } from '../mask/index.js';
import { buildContourPath } from './contour.js';
import { DEFAULT_MIXING_MOVES_PER_CELL, buildBackbitePath } from './backbite.js';

describe('buildBackbitePath: handles regions the contour method rejects', () => {
  it('succeeds on a mixed-block plus shape that buildContourPath reports ok: false for', () => {
    const contourResult = buildContourPath(PLUS_MASK, createRng(1));
    expect(contourResult.ok).toBe(false);

    const result = buildBackbitePath(PLUS_MASK, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pathViolations(result.path, PLUS_MASK)).toEqual([]);
  });

  it('succeeds on a ring around one absorbed centre cell that a 3x3 grid cannot tile', () => {
    const contourResult = buildContourPath(UNVISITED_MASK, createRng(1));
    expect(contourResult.ok).toBe(false);

    const result = buildBackbitePath(UNVISITED_MASK, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pathViolations(result.path, UNVISITED_MASK)).toEqual([]);
  });

  it('satisfies every S2 postcondition on a full odd-height rectangle the contour method cannot tile', () => {
    const mask = makeMask({ width: 4, height: 5 });
    const contourResult = buildContourPath(mask, createRng(1));
    expect(contourResult.ok).toBe(false);

    const result = buildBackbitePath(mask, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pathViolations(result.path, mask)).toEqual([]);
  });
});

describe('buildBackbitePath: mask.pathCellCount disagreeing with inside/unvisited (regression)', () => {
  it('reports ok: false instead of a garbage path for an all-empty mask claiming path cells', () => {
    const mask = {
      ...maskFrom({ width: 2, height: 2, inside: new Uint8Array(4), unvisited: new Uint8Array(4) }),
      pathCellCount: 4,
    };
    const result = buildBackbitePath(mask, createRng(1));
    expect(result.ok).toBe(false);
  });
});

describe('buildBackbitePath: basic postconditions', () => {
  it('satisfies every S2 postcondition on a small rectangle', () => {
    const mask = makeMask({ width: 6, height: 6 });
    const result = buildBackbitePath(mask, createRng(7));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path.cells.length).toBe(mask.pathCellCount);
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('is deterministic for a given (mask, seed)', () => {
    const mask = makeMask({ width: 10, height: 8 });
    const a = buildBackbitePath(mask, createRng(123));
    const b = buildBackbitePath(mask, createRng(123));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(Array.from(a.path.cells)).toEqual(Array.from(b.path.cells));
    expect(a.moves).toBe(b.moves);
  });

  it('varies with the seed', () => {
    const mask = makeMask({ width: 10, height: 10 });
    const cellsFor = (seed: number): number[] => {
      const result = buildBackbitePath(mask, createRng(seed));
      if (!result.ok) throw new Error('expected a full rectangle to be growable');
      return Array.from(result.path.cells);
    };
    const seeds = [1, 2, 3, 4, 5];
    const outcomes = new Set(seeds.map((seed) => cellsFor(seed).join(',')));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('returns an empty path for a mask with zero path cells, without throwing', () => {
    const mask = makeMask({ width: 2, height: 2 });
    const emptyMask = { ...mask, inside: new Uint8Array(4), pathCellCount: 0 };
    const result = buildBackbitePath(emptyMask, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path.cells.length).toBe(0);
  });

  it('handles a single-cell region trivially', () => {
    const mask = makeMask('#');
    const result = buildBackbitePath(mask, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.path.cells)).toEqual([0]);
  });
});

describe('buildBackbitePath: mixing iteration count', () => {
  it('is a parameter with a documented, positive default', () => {
    expect(DEFAULT_MIXING_MOVES_PER_CELL).toBeGreaterThan(0);
  });

  it('runs exactly the requested number of extra moves after growth completes', () => {
    const mask = makeMask({ width: 8, height: 8 });
    const growthOnly = buildBackbitePath(mask, createRng(5), { mixingMoves: 0 });
    const withMixing = buildBackbitePath(mask, createRng(5), { mixingMoves: 250 });
    expect(growthOnly.ok).toBe(true);
    expect(withMixing.ok).toBe(true);
    if (!growthOnly.ok || !withMixing.ok) return;
    // Growth consumes the rng identically in both calls (mixingMoves cannot
    // affect it), so the only difference in move count is the mixing budget.
    expect(withMixing.moves).toBe(growthOnly.moves + 250);
  });

  it('defaults to DEFAULT_MIXING_MOVES_PER_CELL times pathCellCount', () => {
    const mask = makeMask({ width: 5, height: 5 });
    const growthOnly = buildBackbitePath(mask, createRng(5), { mixingMoves: 0 });
    const defaulted = buildBackbitePath(mask, createRng(5));
    expect(growthOnly.ok).toBe(true);
    expect(defaulted.ok).toBe(true);
    if (!growthOnly.ok || !defaulted.ok) return;
    expect(defaulted.moves).toBe(
      growthOnly.moves + DEFAULT_MIXING_MOVES_PER_CELL * mask.pathCellCount,
    );
  });
});

describe('buildBackbitePath: time box', () => {
  it('reports ok: false instead of spinning when the growth budget is too small to finish', () => {
    const mask = makeMask({ width: 12, height: 12 });
    const result = buildBackbitePath(mask, createRng(1), { maxGrowthMoves: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('3 moves');
  });

  it('reports ok: false immediately for a region with more than two dead-end path cells', () => {
    // A comb: three single-cell teeth (degree 1) on a shared base. No
    // Hamiltonian path can have three cells that must all be endpoints.
    const mask = makeMask(['#.#.#', '#.#.#', '#####'].join('\n'));
    const result = buildBackbitePath(mask, createRng(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('dead end');
  });

  it('reports ok: false for a path cell with no path-cell neighbour at all', () => {
    // Two separate single cells: each has zero path-cell neighbours.
    const mask = makeMask(['#.#'].join('\n'));
    const result = buildBackbitePath(mask, createRng(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('no path-cell neighbour');
  });

  it('reports ok: false for path cells that are not one 4-connected piece', () => {
    // Two disjoint 2x2 blocks, each internally a 4-cycle (no dead ends on
    // their own) but with no adjacency between them.
    const mask = makeMask(['##...##', '##...##'].join('\n'));
    const result = buildBackbitePath(mask, createRng(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not one 4-connected piece');
  });

  it('reports ok: false immediately for a checkerboard imbalance greater than 1', () => {
    // A full 6x6 grid (balanced 18/18) with three same-colour cells absorbed
    // — an imbalance of 3, which no routing can fix. None of the three
    // removals drops any neighbour below 2 remaining path-cell neighbours, so
    // this is a pure parity failure, not also a dead-end or connectivity one.
    const mask = makeMask(['######', '#o#o##', '######', '#o####', '######', '######'].join('\n'));
    const result = buildBackbitePath(mask, createRng(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('checkerboard parity');
  });
});

describe('buildBackbitePath: dev invariant checking', () => {
  it('does not throw with validateEveryMove enabled on a healthy region', () => {
    const mask = makeMask({ width: 9, height: 7 });
    expect(() => buildBackbitePath(mask, createRng(3), { validateEveryMove: true })).not.toThrow();
  });
});

describe('buildBackbitePath: stallLimit-driven restarts', () => {
  it('still produces a valid Hamiltonian path when a tiny stallLimit forces many restarts', () => {
    // stallLimit: 8 is far below the default (60 * pathCellCount = 2160 for
    // this 6x6 mask) and measured to force dozens of restarts before growth
    // completes, not merely make them possible — this exercises the restart
    // path deliberately rather than relying on it firing incidentally inside
    // some other test's random walk.
    const mask = makeMask({ width: 6, height: 6 });
    const result = buildBackbitePath(mask, createRng(1), {
      stallLimit: 8,
      maxGrowthMoves: 200_000,
      validateEveryMove: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('still terminates when a caller passes stallLimit 0', () => {
    // 0 survives the ?? default and makes growth structurally impossible, so
    // the only correct outcome is a reported failure. This pins termination,
    // which the budget charge in the restart branch provides; it does not
    // distinguish the clamp, since either guard alone reaches the budget.
    const mask = makeMask({ width: 4, height: 4 });
    const result = buildBackbitePath(mask, createRng(1), {
      stallLimit: 0,
      maxGrowthMoves: 500,
    });
    expect(result.ok).toBe(false);
  }, 5_000);
});
