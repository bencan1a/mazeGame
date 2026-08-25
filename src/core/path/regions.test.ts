import { describe, expect, it } from 'vitest';
import { makeMask } from '../../../test/fixtures/mask.js';
import { pathViolations } from '../../../test/fixtures/postconditions.js';
import { maskFrom } from '../mask/index.js';
import { createRng } from '../rng.js';
import { buildRegionPaths } from './regions.js';

/** Three 4x4 lobes in a row, each separated by two empty columns. */
function threeLobes(): ReturnType<typeof makeMask> {
  return makeMask(
    ['####..####..####', '####..####..####', '####..####..####', '####..####..####'].join('\n'),
  );
}

describe('buildRegionPaths', () => {
  it('walks every region and marks the boundaries between them', () => {
    const mask = threeLobes();
    expect(mask.regionCount).toBe(3);

    const result = buildRegionPaths(mask, createRng(1), 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.path.cells.length).toBe(mask.pathCellCount);
    expect([...result.path.regionStart]).toEqual([0, 16, 32, 48]);
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('is deterministic for a given (mask, seed)', () => {
    const mask = threeLobes();
    const a = buildRegionPaths(mask, createRng(9), 0.5);
    const b = buildRegionPaths(mask, createRng(9), 0.5);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect([...a.path.cells]).toEqual([...b.path.cells]);
  });

  it('fails, naming the region, when one lobe will not tile into 2x2 blocks', () => {
    // A 4x4 lobe, then a plus: five cells, which no lattice offset partitions
    // into whole blocks.
    const mask = makeMask(['####..#..', '####.###.', '####..#..', '####.....'].join('\n'));
    expect(mask.regionCount).toBe(2);

    const result = buildRegionPaths(mask, createRng(7), 0.5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^region 2 of 2 \(5 cells\)/);
      expect(result.reason).toMatch(/contour declined/);
    }
  });

  it('returns an empty path for a mask with no regions', () => {
    const empty = maskFrom({
      width: 2,
      height: 2,
      inside: new Uint8Array(4),
      unvisited: new Uint8Array(4),
    });
    const result = buildRegionPaths(empty, createRng(1), 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path.cells.length).toBe(0);
    expect([...result.path.regionStart]).toEqual([0]);
  });
});
