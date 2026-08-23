import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toIndex } from '../grid.js';
import type { Blob } from './blob.js';
import { fillHoles } from './holes.js';

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

function toRows(blob: Blob): string[] {
  const rows: string[] = [];
  for (let y = 0; y < blob.height; y++) {
    let row = '';
    for (let x = 0; x < blob.width; x++)
      row += blob.inside[toIndex(x, y, blob.width)] === 1 ? '#' : '.';
    rows.push(row);
  }
  return rows;
}

describe('fillHoles', () => {
  it('fills a single enclosed cell when its area is at or below the threshold', () => {
    const grid = blobFromRows(['#####', '#.###', '##.##', '###.#', '#####']);
    const result = fillHoles(grid, 1);
    expect(toRows(result)).toEqual(['#####', '#####', '#####', '#####', '#####']);
  });

  it('leaves outside background alone — only enclosed cells are candidates', () => {
    // The '.' cells here all reach the border, so none are holes.
    const grid = blobFromRows(['.....', '.###.', '.#.#.', '.###.', '.....']);
    const result = fillHoles(grid, 100);
    // The one enclosed cell (centre) is filled...
    expect(result.inside[toIndex(2, 2, 5)]).toBe(1);
    // ...but the outside ring, reachable from the border, is untouched.
    expect(result.inside[0]).toBe(0);
  });

  it('leaves a hole larger than the threshold unfilled', () => {
    const grid = blobFromRows(['#######', '#.....#', '#.....#', '#.....#', '#######']);
    const holeSize = 3 * 5; // interior 5x3 hole
    const result = fillHoles(grid, holeSize - 1);
    expect(result.inside[toIndex(3, 2, 7)]).toBe(0); // hole centre stays a hole
  });

  it('fills a hole exactly at the threshold and leaves one just above it unfilled', () => {
    const grid = blobFromRows(['#######', '#.....#', '#.....#', '#.....#', '#######']);
    const holeSize = 3 * 5;
    expect(fillHoles(grid, holeSize).inside[toIndex(3, 2, 7)]).toBe(1);
    expect(fillHoles(grid, holeSize - 1).inside[toIndex(3, 2, 7)]).toBe(0);
  });

  it('is a no-op on a grid with no enclosed background', () => {
    const grid = blobFromRows(['.....', '.###.', '.###.', '.###.', '.....']);
    const result = fillHoles(grid, 100);
    expect([...result.inside]).toEqual([...grid.inside]);
  });
});

describe('fillHoles property tests', () => {
  const gridArb = randomGridArb(3, 12);

  it('never turns an inside cell into an outside one', () => {
    fc.assert(
      fc.property(gridArb, fc.integer({ min: 0, max: 20 }), (grid, threshold) => {
        const result = fillHoles(grid, threshold);
        for (let i = 0; i < grid.inside.length; i++) {
          if (grid.inside[i] === 1) expect(result.inside[i]).toBe(1);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('a higher threshold never fills less than a lower one', () => {
    fc.assert(
      fc.property(gridArb, fc.integer({ min: 0, max: 20 }), (grid, threshold) => {
        const low = fillHoles(grid, threshold);
        const high = fillHoles(grid, threshold + 5);
        for (let i = 0; i < grid.inside.length; i++) {
          if (low.inside[i] === 1) expect(high.inside[i]).toBe(1);
        }
      }),
      { numRuns: 300 },
    );
  });
});

/** Arbitrary random binary grid, width/height each in `[minSize, maxSize]`. */
function randomGridArb(minSize: number, maxSize: number): fc.Arbitrary<Blob> {
  return fc
    .tuple(fc.integer({ min: minSize, max: maxSize }), fc.integer({ min: minSize, max: maxSize }))
    .chain(([width, height]) =>
      fc
        .array(fc.boolean(), { minLength: width * height, maxLength: width * height })
        .map((bits) => blobFromBits(width, height, bits)),
    );
}

function blobFromBits(width: number, height: number, bits: readonly boolean[]): Blob {
  return { width, height, inside: Uint8Array.from(bits, (b) => (b ? 1 : 0)) };
}
