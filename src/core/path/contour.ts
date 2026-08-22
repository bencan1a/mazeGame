/**
 * Spanning-tree contour: the primary Hamiltonian path method (PRD 4.2 step 2,
 * docs/CONTRACTS.md `Mask -> HamiltonianPath`).
 *
 * The construction, corner by corner:
 *
 * Every full 2x2 block starts as its own 4-cycle, walked clockwise
 * NW -> NE -> SE -> SW -> NW. Written as a `next` pointer per cell, that is
 * `next[NW]=NE, next[NE]=SE, next[SE]=SW, next[SW]=NW` — a bijection on the
 * block's own four cells, i.e. a tiny disjoint cycle per block.
 *
 * A tree edge between two adjacent blocks merges their two disjoint cycles
 * into one, by redirecting exactly one corner of each block to jump into its
 * neighbour instead of continuing around its own block. Concretely, for a
 * block with a tree edge in a given direction:
 *
 *   EAST  edge -> next[NE] = the east neighbour's NW cell
 *   SOUTH edge -> next[SE] = the south neighbour's NE cell
 *   WEST  edge -> next[SW] = the west neighbour's SE cell
 *   NORTH edge -> next[NW] = the north neighbour's SW cell
 *
 * This is the only rewrite each direction ever makes, and each of a block's
 * four corners is the rewrite target of exactly one direction (NE only for
 * EAST, SE only for SOUTH, SW only for WEST, NW only for NORTH) — so a block
 * with tree edges in several directions never has two rules fight over the
 * same corner. Proving each rewrite keeps `next` a bijection (nothing is
 * pointed at twice, nothing is orphaned) is exactly the standard argument for
 * why splicing two disjoint cycles together via a matched pair of crossing
 * edges yields one bigger cycle rather than two: this repo's write-up of that
 * argument, with a worked 2x2-block example per direction, lives in
 * `contour.test.ts` (see `describe('merge derivation')`) since it is the kind
 * of claim that wants a runnable check next to it, not just prose.
 *
 * Because the base graph is a spanning TREE (connected, no cycles), merging
 * every tree edge in turn always joins two previously-separate cycles and
 * never re-merges a cycle with itself, so the result of merging all of them
 * is exactly one cycle spanning every path cell. Cutting that cycle at an
 * arbitrary cell yields the Hamiltonian path.
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
  /** Which of the 4 lattice offsets classifyTiling accepted; see tiling.ts. */
  readonly offsetX: 0 | 1;
  readonly offsetY: 0 | 1;
}

export type ContourFailed = TilingFailed;

export type ContourResult = ContourOk | ContourFailed;

/**
 * Build a Hamiltonian path over `mask` via the spanning-tree contour method.
 *
 * Returns `{ ok: false, reason }` instead of throwing when the region will
 * not tile into 2x2 blocks. That is an expected, common outcome — most
 * masks a real silhouette pipeline produces will not tile — and the backbite
 * fallback (#6) exists precisely to handle it, so it is reported cleanly
 * rather than treated as an error.
 */
export function buildContourPath(mask: Mask, rng: Rng): ContourResult {
  const tiling = classifyTiling(mask);
  if (!tiling.ok) return tiling;

  const { halfWidth, halfHeight, blockFull, offsetX, offsetY } = tiling;
  const tree = buildSpanningTree(blockFull, halfWidth, halfHeight, rng);

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

      // Tiling already guarantees any neighbour a tree edge points at is
      // itself a full block within bounds, so these targets are always
      // valid path cells — no separate bounds check needed here.
      if (tree.open[block * 4 + EAST] === 1) next[ne] = toIndex(x0 + 2, y0, width);
      if (tree.open[block * 4 + SOUTH] === 1) next[se] = toIndex(x0 + 1, y0 + 2, width);
      if (tree.open[block * 4 + WEST] === 1) next[sw] = toIndex(x0 - 1, y0 + 1, width);
      if (tree.open[block * 4 + NORTH] === 1) next[nw] = toIndex(x0, y0 - 1, width);
    }
  }

  // Cut the cycle at the first full block's NW corner. Any cell would do —
  // the contour is a cycle, so every cut yields a valid Hamiltonian path.
  const startBlock = blockFull.indexOf(1);
  // classifyTiling's ok:true guarantees at least one full, connected block
  // (mask.pathCellCount === 0 and an empty blockFull are both rejected there),
  // so this should be unreachable. Guarded anyway: a negative index here would
  // silently wrap into a huge Uint32Array value below rather than fail loudly.
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

  return { ok: true, path: { cells }, offsetX, offsetY };
}
