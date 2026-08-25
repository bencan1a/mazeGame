/**
 * Spanning-tree contour. Each full 2x2 block starts as its own clockwise
 * 4-cycle in `next`, and each tree edge redirects one corner of a block into
 * its neighbour, splicing the two cycles into one. A direction rewrites only
 * its own corner (EAST only NE, SOUTH only SE, WEST only SW, NORTH only NW),
 * so a block with several tree edges never has two rewrites collide.
 */

import { EAST, NORTH, SOUTH, WEST, toIndex, xOf, yOf } from '../grid.js';
import type { Rng } from '../rng.js';
import type { HamiltonianPath, Mask } from '../types.js';
import { buildSpanningTree } from './spanningTree.js';
import { classifyTiling } from './tiling.js';
import type { TilingFailed } from './tiling.js';

export interface ContourOk {
  readonly ok: true;
  readonly path: HamiltonianPath;
  /** Which of the 4 lattice offsets was accepted. */
  readonly offsetX: 0 | 1;
  readonly offsetY: 0 | 1;
}

export type ContourFailed = TilingFailed;

export type ContourResult = ContourOk | ContourFailed;

export function buildContourPath(
  mask: Mask,
  rng: Rng,
  /**
   * Bias toward turning rather than carrying straight on, in `[0, 1]`, applied
   * while the spanning tree grows. `undefined` picks uniformly among the
   * directions available at each step.
   */
  turnBias?: number,
): ContourResult {
  if (mask.regionCount > 1) {
    return {
      ok: false,
      reason:
        `mask has ${mask.regionCount} regions and the contour method fills one at a time; ` +
        'call it per region',
    };
  }

  const tiling = classifyTiling(mask);
  if (!tiling.ok) return tiling;

  const { halfWidth, halfHeight, blockFull, offsetX, offsetY } = tiling;
  const tree = buildSpanningTree(
    blockFull,
    halfWidth,
    halfHeight,
    rng,
    tiling.firstFullBlock,
    turnBias,
  );

  const width = mask.width;
  const next = new Uint32Array(width * mask.height);

  for (let by = 0; by < halfHeight; by++) {
    for (let bx = 0; bx < halfWidth; bx++) {
      const block = by * halfWidth + bx;
      if (blockFull[block] !== 1) continue;

      const x0 = offsetX + bx * 2;
      const y0 = offsetY + by * 2;
      const nw = toIndex(x0, y0, width);
      const ne = toIndex(x0 + 1, y0, width);
      const sw = toIndex(x0, y0 + 1, width);
      const se = toIndex(x0 + 1, y0 + 1, width);

      // Default in-block clockwise 4-cycle, overridden per corner below.
      next[nw] = ne;
      next[ne] = se;
      next[se] = sw;
      next[sw] = nw;

      // No bounds check: tiling guarantees any neighbour a tree edge points at
      // is itself a full block within bounds.
      if (tree.open[block * 4 + EAST] === 1) next[ne] = toIndex(x0 + 2, y0, width);
      if (tree.open[block * 4 + SOUTH] === 1) next[se] = toIndex(x0 + 1, y0 + 2, width);
      if (tree.open[block * 4 + WEST] === 1) next[sw] = toIndex(x0 - 1, y0 + 1, width);
      if (tree.open[block * 4 + NORTH] === 1) next[nw] = toIndex(x0, y0 - 1, width);
    }
  }

  // Any cell would do — the contour is a cycle, so every cut yields a valid
  // Hamiltonian path.
  const startBlock = tiling.firstFullBlock;
  // Guarded because a -1 wraps into a huge Uint32Array index below rather
  // than failing loudly.
  if (startBlock === -1) {
    throw new Error(
      'classifyTiling reported ok:true with no full block; this is a contract violation, not ' +
        'a tileable-or-not outcome the caller can recover from',
    );
  }
  const startBx = xOf(startBlock, halfWidth);
  const startBy = yOf(startBlock, halfWidth);
  const start = toIndex(offsetX + startBx * 2, offsetY + startBy * 2, width);

  const cells = new Uint32Array(mask.pathCellCount);
  let cell = start;
  for (let i = 0; i < cells.length; i++) {
    cells[i] = cell;
    cell = next[cell] as number;
  }

  return {
    ok: true,
    path: { cells, regionStart: Uint32Array.from([0, cells.length]) },
    offsetX,
    offsetY,
  };
}
