import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIRECTIONS, NO_CELL, step, toIndex } from '../grid.js';
import type { Blob } from './blob.js';
import { dropSmallComponents } from './components.js';

function blobFromRows(rows: string[]): Blob {
  const height = rows.length;
  const width = (rows[0] as string).length;
  const inside = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = rows[y] as string;
    for (let x = 0; x < width; x++) {
      if (row[x] === '#') inside[toIndex(x, y, width)] = 1;
    }
  }
  return { width, height, inside };
}

function componentCount(blob: Blob): number {
  const seen = new Uint8Array(blob.inside.length);
  let count = 0;
  for (let start = 0; start < blob.inside.length; start++) {
    if (blob.inside[start] !== 1 || seen[start] === 1) continue;
    count++;
    seen[start] = 1;
    const stack = [start];
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      for (const dir of DIRECTIONS) {
        const next = step(cell, dir, blob.width, blob.height);
        if (next === NO_CELL || blob.inside[next] !== 1 || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return count;
}

function insideCount(inside: Uint8Array): number {
  let count = 0;
  for (const v of inside) if (v === 1) count++;
  return count;
}

describe('dropSmallComponents', () => {
  // A 2-cell island, a 3-cell island, and a 5-cell island, none touching
  // (a blank row separates every pair).
  const islands = ['##.....', '.......', '..###..', '.......', '.#####.', '.......'];

  it('keeps every island at or above the threshold', () => {
    const blob = blobFromRows(islands);
    expect(componentCount(blob)).toBe(3);

    const result = dropSmallComponents(blob, 3);
    expect(componentCount(result)).toBe(2);
    expect(insideCount(result.inside)).toBe(8);
    expect(result.inside[toIndex(2, 2, 7)]).toBe(1);
    expect(result.inside[toIndex(1, 4, 7)]).toBe(1);
    // The 2-cell island is below the threshold.
    expect(result.inside[toIndex(0, 0, 7)]).toBe(0);
  });

  it('keeps all three islands at a threshold none of them falls below', () => {
    const result = dropSmallComponents(blobFromRows(islands), 2);
    expect(componentCount(result)).toBe(3);
    expect(insideCount(result.inside)).toBe(10);
  });

  it('drops everything when no island reaches the threshold', () => {
    const result = dropSmallComponents(blobFromRows(islands), 6);
    expect(insideCount(result.inside)).toBe(0);
  });

  it('is a no-op on a grid with no inside cells', () => {
    const blob: Blob = { width: 4, height: 4, inside: new Uint8Array(16) };
    const result = dropSmallComponents(blob, 3);
    expect(insideCount(result.inside)).toBe(0);
  });

  it('is a no-op when every component clears the threshold', () => {
    const blob = blobFromRows(['.##.', '####', '.##.']);
    const result = dropSmallComponents(blob, 1);
    expect([...result.inside]).toEqual([...blob.inside]);
  });
});

describe('dropSmallComponents property tests', () => {
  const gridArb = fc
    .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }))
    .chain(([width, height]) =>
      fc
        .array(fc.boolean(), { minLength: width * height, maxLength: width * height })
        .map((bits): Blob => ({
          width,
          height,
          inside: Uint8Array.from(bits, (b) => (b ? 1 : 0)),
        })),
    );
  const thresholdArb = fc.integer({ min: 1, max: 6 });

  it('result is a subset of the input', () => {
    fc.assert(
      fc.property(gridArb, thresholdArb, (grid, minCells) => {
        const result = dropSmallComponents(grid, minCells);
        for (let i = 0; i < grid.inside.length; i++) {
          if (result.inside[i] === 1) expect(grid.inside[i]).toBe(1);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('keeps exactly the components at or above the threshold, whole', () => {
    fc.assert(
      fc.property(gridArb, thresholdArb, (grid, minCells) => {
        const before = componentSizes(grid);
        const result = dropSmallComponents(grid, minCells);
        const after = componentSizes(result);
        expect([...after].sort((a, b) => a - b)).toEqual(
          before.filter((size) => size >= minCells).sort((a, b) => a - b),
        );
      }),
      { numRuns: 300 },
    );
  });
});

function componentSizes(blob: Blob): number[] {
  const seen = new Uint8Array(blob.inside.length);
  const sizes: number[] = [];
  for (let start = 0; start < blob.inside.length; start++) {
    if (blob.inside[start] !== 1 || seen[start] === 1) continue;
    seen[start] = 1;
    const stack = [start];
    let size = 1;
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      for (const dir of DIRECTIONS) {
        const next = step(cell, dir, blob.width, blob.height);
        if (next === NO_CELL || blob.inside[next] !== 1 || seen[next] === 1) continue;
        seen[next] = 1;
        size++;
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  return sizes;
}
