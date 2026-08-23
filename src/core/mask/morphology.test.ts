import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toIndex } from '../grid.js';
import type { Blob } from './blob.js';
import { dilate, erode, morphologicalOpen } from './morphology.js';

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

describe('erode', () => {
  it('keeps only cells whose all four 4-neighbours are inside (the plus structuring element)', () => {
    const grid = blobFromRows(['###', '###', '###']);
    // Only the centre cell has all 4 neighbours inside; every edge and
    // corner cell of a 3x3 block is missing at least one.
    expect(toRows(erode(grid))).toEqual(['...', '.#.', '...']);
  });

  it('erodes every cell touching the grid border, since an off-grid neighbour never counts as inside', () => {
    const grid = blobFromRows(['#']);
    expect(toRows(erode(grid))).toEqual(['.']);
  });

  it('erodes a 1-cell-wide corridor entirely (no cell there has all 4 neighbours)', () => {
    const grid = blobFromRows(['.....', '.###.', '.....']);
    expect(toRows(erode(grid))).toEqual(['.....', '.....', '.....']);
  });
});

describe('dilate', () => {
  it('grows a single cell into a plus', () => {
    const grid = blobFromRows(['.....', '.....', '..#..', '.....', '.....']);
    expect(toRows(dilate(grid))).toEqual(['.....', '..#..', '.###.', '..#..', '.....']);
  });

  it('never shrinks the input (dilation is extensive)', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const result = dilate(grid);
        for (let i = 0; i < grid.inside.length; i++) {
          if (grid.inside[i] === 1) expect(result.inside[i]).toBe(1);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('morphologicalOpen', () => {
  it('amputates a 1-cell spur off a corner, where the base cell still lacks a neighbour', () => {
    // A 4x4 solid block (x, y in 1..4) with a spur at (1, 0), directly above
    // its top-left corner (1, 1). The corner's west neighbour (0, 1) is
    // outside regardless of the spur, so the corner never gets full
    // 4-neighbour support and cannot regrow the spur in the dilate step —
    // unlike a spur off a flat edge, whose base often does gain full support
    // from the spur itself.
    const grid = blobFromRows(['.#....', '.####.', '.####.', '.####.', '.####.', '......']);
    const opened = morphologicalOpen(grid);
    expect(opened.inside[toIndex(1, 0, 6)]).toBe(0); // the spur cell
    expect(opened.inside[toIndex(2, 2, 6)]).toBe(1); // deep interior of the block survives
  });

  it('does not, by itself, remove every single-cell spur (documented limitation)', () => {
    // A spur off a flat edge: the base cell (1, 3) gains a 4th neighbour
    // (the spur itself) and so survives erosion and regrows the spur in the
    // dilate step. A property of `morphologicalOpen` alone.
    const grid = blobFromRows(['####', '####', '####', '####', '.#..']);
    const opened = morphologicalOpen(grid);
    expect(opened.inside[toIndex(1, 4, 4)]).toBe(1); // the spur survives
  });

  it('is anti-extensive: the result is always a subset of the input', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const opened = morphologicalOpen(grid);
        for (let i = 0; i < opened.inside.length; i++) {
          if (opened.inside[i] === 1) expect(grid.inside[i]).toBe(1);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('is idempotent: opening twice is the same as opening once', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const once = morphologicalOpen(grid);
        const twice = morphologicalOpen(once);
        expect([...twice.inside]).toEqual([...once.inside]);
      }),
      { numRuns: 200 },
    );
  });
});

const gridArb = fc
  .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }))
  .chain(([width, height]) =>
    fc
      .array(fc.boolean(), { minLength: width * height, maxLength: width * height })
      .map((bits): Blob => ({ width, height, inside: Uint8Array.from(bits, (b) => (b ? 1 : 0)) })),
  );
