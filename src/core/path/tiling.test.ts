import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Mask } from '../types.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { classifyTiling } from './tiling.js';

describe('classifyTiling', () => {
  it('accepts a full rectangle with even dimensions', () => {
    const mask = makeMask({ width: 6, height: 4 });
    const result = classifyTiling(mask);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.halfWidth).toBe(3);
      expect(result.halfHeight).toBe(2);
      expect(result.blockFull).toEqual(new Uint8Array(6).fill(1));
      expect(result.offsetX).toBe(0);
      expect(result.offsetY).toBe(0);
    }
  });

  // A whole-grid rectangle with an odd dimension genuinely cannot tile at any
  // lattice offset: every cell is on the path, so whichever offset is tried
  // leaves some border strip both leftover (uncovered by any block) and on
  // the path. This is a real non-tileable region, not an artifact of the old
  // whole-grid-even-dimensions rule — see the 5x5-holding-a-4x4 test below for
  // the case that rule used to reject wrongly.
  it('rejects a full rectangle with an odd width (no offset can cover every path cell)', () => {
    const mask = makeMask({ width: 5, height: 4 });
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
  });

  it('rejects a full rectangle with an odd height (no offset can cover every path cell)', () => {
    const mask = makeMask({ width: 4, height: 5 });
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
  });

  it('accepts an odd-sized grid holding a block-aligned even silhouette (only the region has to tile)', () => {
    // 5x5 grid, but the silhouette is the top-left 4x4 — exactly the case the
    // whole-grid even-dimensions rule used to reject outright even though the
    // region itself tiles perfectly at offset (0, 0).
    const mask = makeMask(['####.', '####.', '####.', '####.', '.....'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offsetX).toBe(0);
      expect(result.offsetY).toBe(0);
      expect(result.halfWidth).toBe(2);
      expect(result.halfHeight).toBe(2);
    }
  });

  it('rejects a mask whose unvisited cells break every block at every offset', () => {
    // Even dimensions, but the two centre-ish cells are parity-absorbed and
    // sit inside a block no offset can route around: this is a genuinely
    // non-tileable shape, not a case the old blanket "any unvisited cell
    // rejects everything" rule got right by accident. See the offset test
    // below for the shape that rule wrongly rejected.
    const mask = makeMask(['####', '#oo#', '####', '####'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
  });

  it('accepts a region with an absorbed cell when some other offset routes around it', () => {
    // Interior 2x2 block of path cells at (1,1)-(2,2); everything else is
    // outside except one absorbed (unvisited) cell at the (0,0) corner. At
    // offset (0,0) that corner cell sits inside a block with the path cells,
    // making it mixed and rejecting that offset — exactly the failure mode
    // the old blanket rule conflated with "not tileable at all". Offset
    // (1, 1) lines the lattice up on the interior block instead, where the
    // absorbed cell and every other non-path cell fall outside any block.
    const mask = makeMask(['o...', '.##.', '.##.', '....'].join('\n'));
    expect(mask.pathCellCount).toBe(4);
    const result = classifyTiling(mask);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offsetX).toBe(1);
      expect(result.offsetY).toBe(1);
      expect(result.halfWidth).toBe(1);
      expect(result.halfHeight).toBe(1);
      expect(result.blockFull).toEqual(new Uint8Array([1]));
    }
  });

  it('still rejects a 2x2 block that is partly absorbed and partly on the path, at every offset', () => {
    // The contract this must never violate: a block cannot be traced if the
    // contour would have to route through a cell that must stay off the
    // path. A lone block with one absorbed corner has no offset that avoids
    // this — fixing the blanket rejection must not "fix" this too.
    const mask = makeMask(['o#', '##'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
  });

  it('rejects a block that mixes inside and outside cells', () => {
    // PLUS_MASK's top-left 2x2 corner is `.#` over `##` — three inside, one
    // outside, so no clean tiling exists despite even overall dimensions.
    const mask = makeMask(['.##.', '####', '####', '.##.'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/block at full-res/);
  });

  it('accepts a non-rectangular region built from whole 2x2 blocks', () => {
    // A plus shape drawn at block resolution (each block is 2x2), so every
    // block is either wholly inside or wholly outside.
    const mask = makeMask(
      ['..####..', '..####..', '########', '########', '..####..', '..####..'].join('\n'),
    );
    const result = classifyTiling(mask);
    expect(result.ok).toBe(true);
  });

  it('rejects two full blocks that do not touch', () => {
    const mask = makeMask(['##....', '##....', '......', '......', '....##', '....##'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not one 4-connected piece/);
  });

  it('rejects a mask with no inside cells', () => {
    const mask = makeMask(['....', '....'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no path cells/);
  });
});

describe('classifyTiling: trusting mask.pathCellCount without reconciling it (regression)', () => {
  // These three masks are deliberately malformed: mask.pathCellCount disagrees
  // with what `inside`/`unvisited` actually contain. Before the reconciliation
  // check, all three returned ok: true with a blockFull that did not actually
  // cover pathCellCount cells, which downstream (contour.ts) turned into a
  // negative, wrapped start index, a duplicated cycle, or a silently truncated
  // path — never an ok: false a caller could see and fall back from.

  it('rejects an all-empty mask that falsely claims 4 path cells (the -1 start-index case)', () => {
    // No cell is inside at all, so classifyAtOffset's own block partition
    // would find zero full blocks — but the claimed count of 4 must still be
    // caught, since it is what previously drove `blockFull.indexOf(1)` to -1
    // and a garbage, wrapped Uint32Array start index in contour.ts.
    const mask: Mask = {
      width: 2,
      height: 2,
      inside: new Uint8Array(4),
      unvisited: new Uint8Array(4),
      pathCellCount: 4,
    };
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pathCellCount/);
  });

  it('rejects a mask with an inflated pathCellCount (would wrap the cycle and duplicate cells)', () => {
    // Only one real 2x2 block (4 real path cells), but the mask claims 8.
    // Tracing 8 steps around a 4-cell cycle would revisit cells 0 and 1 —
    // repeats a Hamiltonian path must never have.
    const mask: Mask = {
      width: 2,
      height: 2,
      inside: new Uint8Array([1, 1, 1, 1]),
      unvisited: new Uint8Array(4),
      pathCellCount: 8,
    };
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pathCellCount/);
  });

  it('rejects a mask with a deflated pathCellCount (would silently truncate the path)', () => {
    // Same real 4-cell block, but the mask claims only 2 — a path allocated
    // at length 2 would cover only half the actual region.
    const mask: Mask = {
      width: 2,
      height: 2,
      inside: new Uint8Array([1, 1, 1, 1]),
      unvisited: new Uint8Array(4),
      pathCellCount: 2,
    };
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pathCellCount/);
  });

  it('never returns ok: true when pathCellCount disagrees with inside/unvisited, for any shape', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 2 ** 30 }),
        fc.integer({ min: -4, max: 4 }),
        (width, height, seed, delta) => {
          if (delta === 0) return;
          const size = width * height;
          // A deterministic-enough "random" inside/unvisited fill from the seed,
          // without reaching for Math.random (core lint forbids it).
          const inside = new Uint8Array(size);
          const unvisited = new Uint8Array(size);
          let real = 0;
          for (let i = 0; i < size; i++) {
            const bit = (seed >>> (i % 30)) & 1;
            inside[i] = bit;
            if (bit === 1) real++;
          }
          const mask: Mask = { width, height, inside, unvisited, pathCellCount: real + delta };
          const result = classifyTiling(mask);
          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('firstFullBlock', () => {
  it('points at the first full block, so callers need not rescan for it', () => {
    // The offset that succeeds is not always (0,0), and the spanning tree and
    // the cycle cut both root here — the whole point of carrying it is that
    // those two cannot drift from this one.
    const result = classifyTiling(makeMask(['....', '.##.', '.##.', '....'].join('\n')));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.firstFullBlock).toBe(result.blockFull.indexOf(1));
    expect(result.blockFull[result.firstFullBlock]).toBe(1);
  });
});
