import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIRECTIONS, NO_CELL, step, toIndex } from '../grid.js';
import type { Blob } from './blob.js';
import { largestComponent } from './components.js';

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

describe('largestComponent', () => {
  it('keeps only the biggest of three islands', () => {
    // A 2-cell island, a 3-cell island, and a 5-cell island, none touching
    // (a blank row separates every pair).
    const blob = blobFromRows(['##.....', '.......', '..###..', '.......', '.#####.', '.......']);
    expect(componentCount(blob)).toBe(3);

    const result = largestComponent(blob);
    expect(componentCount(result)).toBe(1);
    expect(insideCount(result.inside)).toBe(5);
    // The 5-cell island (row 4) survives...
    expect(result.inside[toIndex(1, 4, 7)]).toBe(1);
    expect(result.inside[toIndex(5, 4, 7)]).toBe(1);
    // ...the 2-cell and 3-cell islands do not.
    expect(result.inside[toIndex(0, 0, 7)]).toBe(0);
    expect(result.inside[toIndex(2, 2, 7)]).toBe(0);
  });

  it('is a no-op on a grid with no inside cells', () => {
    const blob: Blob = { width: 4, height: 4, inside: new Uint8Array(16) };
    const result = largestComponent(blob);
    expect(insideCount(result.inside)).toBe(0);
  });

  it('is a no-op when the grid is already one component', () => {
    const blob = blobFromRows(['.##.', '####', '.##.']);
    const result = largestComponent(blob);
    expect([...result.inside]).toEqual([...blob.inside]);
  });
});

describe('largestComponent property tests', () => {
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

  it('result is a subset of the input and at most one 4-connected component', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const result = largestComponent(grid);
        for (let i = 0; i < grid.inside.length; i++) {
          if (result.inside[i] === 1) expect(grid.inside[i]).toBe(1);
        }
        expect(componentCount(result)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps a component at least as large as every other component in the input', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const sizes = componentSizes(grid);
        const result = largestComponent(grid);
        const kept = insideCount(result.inside);
        for (const size of sizes) expect(kept).toBeGreaterThanOrEqual(size);
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
