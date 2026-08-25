import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIRECTIONS, NO_CELL, step, toIndex } from '../grid.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { labelRegions, maskFrom, regionSizes, regionSubMask } from './regions.js';

describe('labelRegions', () => {
  it('gives one region to a connected silhouette', () => {
    const { regionOf, regionCount } = labelRegions(makeMask({ width: 4, height: 3 }));
    expect(regionCount).toBe(1);
    expect([...new Set(regionOf)]).toEqual([1]);
  });

  it('gives each disjoint lobe its own id, numbered in row-major order', () => {
    const mask = makeMask(['##.##', '##.##', '.....', '#####'].join('\n'));
    expect(mask.regionCount).toBe(3);
    expect(mask.regionOf[toIndex(0, 0, 5)]).toBe(1);
    expect(mask.regionOf[toIndex(3, 0, 5)]).toBe(2);
    expect(mask.regionOf[toIndex(0, 3, 5)]).toBe(3);
  });

  it('labels an unvisited cell 0 even though it is inside', () => {
    const mask = makeMask(['###', '#o#', '###'].join('\n'));
    expect(mask.regionCount).toBe(1);
    expect(mask.regionOf[toIndex(1, 1, 3)]).toBe(0);
    expect(mask.pathCellCount).toBe(8);
  });

  it('splits a region an unvisited cell severs', () => {
    const mask = makeMask(['#o#'].join('\n'));
    expect(mask.regionCount).toBe(2);
  });

  it('reports no regions for an empty grid', () => {
    const { regionCount } = labelRegions({
      width: 3,
      height: 3,
      inside: new Uint8Array(9),
      unvisited: new Uint8Array(9),
    });
    expect(regionCount).toBe(0);
  });
});

describe('regionSizes', () => {
  it('counts each region and sums to pathCellCount', () => {
    const mask = makeMask(['##.###', '##.###'].join('\n'));
    expect([...regionSizes(mask)]).toEqual([4, 6]);
    expect(regionSizes(mask).reduce((a, b) => a + b, 0)).toBe(mask.pathCellCount);
  });
});

describe('regionSubMask', () => {
  const mask = makeMask(['##.###', '##.###'].join('\n'));

  it('keeps only the requested region, on the same grid', () => {
    const sub = regionSubMask(mask, 2);
    expect(sub.width).toBe(mask.width);
    expect(sub.height).toBe(mask.height);
    expect(sub.regionCount).toBe(1);
    expect(sub.pathCellCount).toBe(6);
    expect(sub.inside[toIndex(0, 0, 6)]).toBe(0);
    expect(sub.inside[toIndex(3, 0, 6)]).toBe(1);
  });

  it('reads every unvisited cell as outside, so the sub-mask has none', () => {
    const withHole = makeMask(['###', '#o#', '###'].join('\n'));
    const sub = regionSubMask(withHole, 1);
    expect([...sub.unvisited]).toEqual(Array(9).fill(0));
    expect(sub.inside[toIndex(1, 1, 3)]).toBe(0);
  });

  it('rejects a region id the mask does not have', () => {
    expect(() => regionSubMask(mask, 0)).toThrow(/not one of 1\.\.2/);
    expect(() => regionSubMask(mask, 3)).toThrow(/not one of 1\.\.2/);
  });
});

describe('labelRegions property tests', () => {
  const geometryArb = fc
    .tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }))
    .chain(([width, height]) =>
      fc
        .array(fc.integer({ min: 0, max: 2 }), {
          minLength: width * height,
          maxLength: width * height,
        })
        .map((codes) => ({
          width,
          height,
          inside: Uint8Array.from(codes, (c) => (c === 0 ? 0 : 1)),
          unvisited: Uint8Array.from(codes, (c) => (c === 2 ? 1 : 0)),
        })),
    );

  it('labels exactly the path cells, and each label is one 4-connected piece', () => {
    fc.assert(
      fc.property(geometryArb, (geometry) => {
        const mask = maskFrom(geometry);
        const { width, height, inside, unvisited } = geometry;
        for (let i = 0; i < inside.length; i++) {
          const isPathCell = inside[i] === 1 && unvisited[i] !== 1;
          expect((mask.regionOf[i] as number) !== 0).toBe(isPathCell);
        }
        const sizes = regionSizes(mask);
        for (let r = 1; r <= mask.regionCount; r++) {
          let seed = NO_CELL;
          for (let i = 0; i < mask.regionOf.length && seed === NO_CELL; i++) {
            if (mask.regionOf[i] === r) seed = i;
          }
          expect(seed).not.toBe(NO_CELL);
          const seen = new Set([seed]);
          const stack = [seed];
          while (stack.length > 0) {
            const cell = stack.pop() as number;
            for (const dir of DIRECTIONS) {
              const next = step(cell, dir, width, height);
              if (next === NO_CELL || seen.has(next) || mask.regionOf[next] !== r) continue;
              seen.add(next);
              stack.push(next);
            }
          }
          expect(seen.size).toBe(sizes[r - 1]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('partitions the path cells: the region sizes sum to pathCellCount', () => {
    fc.assert(
      fc.property(geometryArb, (geometry) => {
        const mask = maskFrom(geometry);
        const total = regionSizes(mask).reduce((a, b) => a + b, 0);
        expect(total).toBe(mask.pathCellCount);
      }),
      { numRuns: 300 },
    );
  });
});
