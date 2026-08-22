import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { directionBetween } from '../../src/core/grid.js';
import { makeMask } from './mask.js';
import { makePath, makePathFromCells, pathDirections } from './path.js';
import { pathViolations } from './postconditions.js';

describe('makePath', () => {
  it('snakes: rows alternate direction so every row change is one step', () => {
    const path = makePath(makeMask({ width: 4, height: 4 }));

    expect(Array.from(path.cells)).toEqual([0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12]);
  });

  it('covers a single column', () => {
    expect(Array.from(makePath(makeMask({ width: 1, height: 3 })).cells)).toEqual([0, 1, 2]);
  });

  it('visits every mask cell exactly once, at every rectangle size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        (width, height) => {
          const mask = makeMask({ width, height });
          const path = makePath(mask);

          expect(pathViolations(path, mask)).toEqual([]);
          expect(path.cells.length).toBe(width * height);
          expect(new Set(path.cells).size).toBe(width * height);
        },
      ),
    );
  });

  it('only ever steps to a 4-neighbour', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        (width, height) => {
          const mask = makeMask({ width, height });
          expect(pathDirections(makePath(mask), mask)).not.toContain(-1);
        },
      ),
    );
  });

  it('refuses a mask with a hole, because a serpentine would skip it', () => {
    expect(() => makePath(makeMask(['###', '#.#', '###'].join('\n')))).toThrow(
      /full rectangles only: 3x3 has 1 outside and 0 unvisited/,
    );
  });

  it('refuses a mask with an unvisited cell', () => {
    expect(() => makePath(makeMask(['###', '#o#', '###'].join('\n')))).toThrow(
      /0 outside and 1 unvisited/,
    );
  });
});

describe('makePathFromCells', () => {
  const ring = makeMask(['###', '#.#', '###'].join('\n'));

  it('accepts a hand-written walk that satisfies the contract', () => {
    const path = makePathFromCells(ring, [0, 1, 2, 5, 8, 7, 6, 3]);

    expect(path.cells).toBeInstanceOf(Uint32Array);
    expect(pathViolations(path, ring)).toEqual([]);
  });

  it('rejects a walk that teleports', () => {
    expect(() => makePathFromCells(ring, [0, 1, 2, 5, 8, 7, 6, 4])).toThrow(/not 4-neighbours/);
  });

  it('rejects a walk that misses a cell', () => {
    expect(() => makePathFromCells(ring, [0, 1, 2, 5, 8, 7, 6])).toThrow(/pathCellCount is 8/);
  });

  it('rejects a walk through the hole', () => {
    expect(() => makePathFromCells(ring, [0, 1, 2, 5, 4, 3, 6, 7])).toThrow(/outside the mask/);
  });
});

describe('path postconditions', () => {
  it('catches a repeated cell', () => {
    const mask = makeMask({ width: 2, height: 2 });
    const violations = pathViolations({ cells: Uint32Array.from([0, 1, 3, 1]) }, mask);

    expect(violations).toContainEqual(expect.stringContaining('more than once'));
  });

  it('catches a cell off the grid', () => {
    const mask = makeMask({ width: 2, height: 2 });
    const violations = pathViolations({ cells: Uint32Array.from([0, 1, 3, 99]) }, mask);

    expect(violations).toContainEqual(expect.stringContaining('outside the grid'));
  });

  it('agrees with directionBetween about what a step is', () => {
    const mask = makeMask({ width: 3, height: 3 });
    expect(directionBetween(0, 1, mask.width)).not.toBe(-1);
    expect(pathViolations({ cells: Uint32Array.from([0, 2]) }, mask)).toContainEqual(
      expect.stringContaining('not 4-neighbours'),
    );
  });
});
