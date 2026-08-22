import { describe, expect, it } from 'vitest';
import { makeMask } from '../../../test/fixtures/mask.js';
import { pathViolations } from '../../../test/fixtures/postconditions.js';
import { createRng } from '../rng.js';
import type { Mask } from '../types.js';
import { buildContourPath } from './contour.js';

describe('buildContourPath: mask.pathCellCount disagreeing with inside/unvisited (regression)', () => {
  // Before classifyTiling reconciled the two, this exact mask produced
  // cells = [4294967286, 0, 0, 0]: blockFull.indexOf(1) was -1 (no cell is
  // actually inside), and toIndex(-2, 0, width) wrapped to a huge value once
  // stored in the Uint32Array start index — an ok: true result no caller
  // could tell apart from a real path.
  it('reports ok: false instead of a garbage path for an all-empty mask claiming 4 path cells', () => {
    const mask: Mask = {
      width: 2,
      height: 2,
      inside: new Uint8Array(4),
      unvisited: new Uint8Array(4),
      pathCellCount: 4,
    };
    const result = buildContourPath(mask, createRng(1));
    expect(result.ok).toBe(false);
  });
});

describe('buildContourPath: merge derivation, worked by hand', () => {
  // These two cases are the smallest possible instance of a tree edge in
  // each axis (exactly one edge, no choice of direction for the spanning
  // tree to make), so the exact cell order is a hand-checkable proof that
  // the corner-rewrite rule in contour.ts's header comment is right, not
  // merely plausible. Both strips have no interior cells, so the only
  // Hamiltonian cycle over them is the strip's own perimeter — which is
  // exactly what falls out of the construction below.
  it('traces a horizontal (EAST/WEST) merge as the perimeter of a 4x2 strip', () => {
    const mask = makeMask({ width: 4, height: 2 });
    const result = buildContourPath(mask, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.path.cells)).toEqual([0, 1, 2, 3, 7, 6, 5, 4]);
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('traces a vertical (NORTH/SOUTH) merge as the perimeter of a 2x4 strip', () => {
    const mask = makeMask({ width: 2, height: 4 });
    const result = buildContourPath(mask, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.path.cells)).toEqual([0, 1, 3, 5, 7, 6, 4, 2]);
    expect(pathViolations(result.path, mask)).toEqual([]);
  });
});

describe('buildContourPath', () => {
  it('satisfies every S2 postcondition on the smallest possible region, a single 2x2 block', () => {
    const mask = makeMask({ width: 2, height: 2 });
    const result = buildContourPath(mask, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path.cells.length).toBe(4);
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('satisfies every S2 postcondition on a rectangle', () => {
    const mask = makeMask({ width: 8, height: 6 });
    const result = buildContourPath(mask, createRng(9));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('satisfies every S2 postcondition on a non-rectangular tileable region (a block-scale plus)', () => {
    const mask = makeMask(
      ['..####..', '..####..', '########', '########', '..####..', '..####..'].join('\n'),
    );
    const result = buildContourPath(mask, createRng(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('is deterministic for a given (mask, seed)', () => {
    const mask = makeMask({ width: 10, height: 8 });
    const a = buildContourPath(mask, createRng(123));
    const b = buildContourPath(mask, createRng(123));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(Array.from(a.path.cells)).toEqual(Array.from(b.path.cells));
  });

  it('varies with the seed (the spanning tree is genuinely randomized)', () => {
    // Large enough that a coincidental match across seeds would be surprising.
    const mask = makeMask({ width: 20, height: 20 });
    const cellsFor = (seed: number): number[] => {
      const result = buildContourPath(mask, createRng(seed));
      if (!result.ok) throw new Error('expected the full rectangle to tile');
      return Array.from(result.path.cells);
    };
    const seeds = [1, 2, 3, 4, 5];
    const outcomes = new Set(seeds.map((seed) => cellsFor(seed).join(',')));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('reports cleanly instead of throwing when the region will not tile', () => {
    // A full odd-height rectangle: every cell is on the path, so no lattice
    // offset can avoid leaving a path-carrying border strip uncovered.
    const mask = makeMask({ width: 4, height: 5 });
    const result = buildContourPath(mask, createRng(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('reports cleanly for a mixed-block region that cannot tile', () => {
    const mask = makeMask(['.##.', '####', '####', '.##.'].join('\n'));
    const result = buildContourPath(mask, createRng(1));
    expect(result.ok).toBe(false);
  });

  it('accepts an odd-sized grid holding a block-aligned even silhouette', () => {
    // Only the region needs to tile, not the whole grid — a 5x5 mask whose
    // silhouette is a block-aligned 4x4 tiles at offset (0, 0) even though
    // the grid itself is odd on both axes.
    const mask = makeMask(['####.', '####.', '####.', '####.', '.....'].join('\n'));
    const result = buildContourPath(mask, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('accepts a region with an absorbed cell when a non-zero lattice offset routes around it', () => {
    // Interior 2x2 block plus one absorbed corner cell that would make the
    // (0, 0)-offset block mixed; offset (1, 1) lines up on the interior block
    // instead, where the absorbed cell falls outside any block.
    const mask = makeMask(['o...', '.##.', '.##.', '....'].join('\n'));
    const result = buildContourPath(mask, createRng(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offsetX).toBe(1);
    expect(result.offsetY).toBe(1);
    expect(pathViolations(result.path, mask)).toEqual([]);
  });

  it('completes a 100x100 region in well under 100ms', () => {
    const mask = makeMask({ width: 100, height: 100 });
    const started = performance.now();
    const result = buildContourPath(mask, createRng(1));
    const elapsedMs = performance.now() - started;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pathViolations(result.path, mask)).toEqual([]);
    console.log(`contour 100x100: ${elapsedMs.toFixed(2)}ms`);
    expect(elapsedMs).toBeLessThan(100);
  });
});
