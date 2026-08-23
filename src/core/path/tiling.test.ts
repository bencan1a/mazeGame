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

  // Every cell is on the path, so whichever offset is tried leaves a border
  // strip that is both uncovered by any block and on the path.
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
    // Only the region has to tile, not the grid: a 4x4 silhouette in a 5x5
    // grid tiles at offset (0, 0).
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
    // Even dimensions, but the parity-absorbed centre cells sit inside a block
    // no offset can route around.
    const mask = makeMask(['####', '#oo#', '####', '####'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
  });

  it('accepts a region with an absorbed cell when some other offset routes around it', () => {
    // Interior 2x2 block of path cells at (1,1)-(2,2), plus one absorbed cell
    // at the (0,0) corner. Offset (0,0) puts that corner in a block with path
    // cells, making it mixed; offset (1,1) lines the lattice up on the
    // interior block, where the absorbed cell falls outside every block.
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
    // A lone block with one absorbed corner is mixed at every offset.
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
  // Deliberately malformed: mask.pathCellCount disagrees with what
  // `inside`/`unvisited` contain. Each must come back as ok: false.

  it('rejects an all-empty mask that falsely claims 4 path cells (the -1 start-index case)', () => {
    // No cell is inside, so the block partition finds zero full blocks; the
    // claimed count of 4 is what must still be caught.
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
          // A deterministic "random" fill from the seed, without Math.random.
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
    // The offset that succeeds is not always (0, 0).
    const result = classifyTiling(makeMask(['....', '.##.', '.##.', '....'].join('\n')));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.firstFullBlock).toBe(result.blockFull.indexOf(1));
    expect(result.blockFull[result.firstFullBlock]).toBe(1);
  });
});
