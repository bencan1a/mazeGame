/**
 * Whether a Mask's path cells can be partitioned into a perfect grid of 2x2
 * blocks at half resolution — the precondition the spanning-tree contour
 * method needs (PRD 4.2 step 2, docs/CONTRACTS.md `Mask -> HamiltonianPath`).
 *
 * A block is "full" only when all four of its full-resolution cells are path
 * cells (inside and not unvisited), and "empty" only when all four are
 * outside. Anything else — a mixed block, an odd dimension, or a lone
 * unvisited cell breaking a block's homogeneity — cannot be traced by the
 * contour method. That is reported, not thrown: a non-tileable region is an
 * expected outcome the backbite fallback exists for (#6), not a bug.
 */

import { DIRECTIONS, NO_CELL, step, toIndex } from '../grid.js';
import type { Mask } from '../types.js';

export interface TilingOk {
  readonly ok: true;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** 1 where the half-res block at `by * halfWidth + bx` is a "full" (path) block. */
  readonly blockFull: Uint8Array;
}

export interface TilingFailed {
  readonly ok: false;
  readonly reason: string;
}

export type TilingResult = TilingOk | TilingFailed;

export function classifyTiling(mask: Mask): TilingResult {
  const { width, height } = mask;

  if (width % 2 !== 0 || height % 2 !== 0) {
    return {
      ok: false,
      reason:
        `mask is ${width}x${height}; the spanning-tree contour method needs both ` +
        'dimensions even so the region can tile into 2x2 blocks',
    };
  }
  if (mask.pathCellCount === 0) {
    return { ok: false, reason: 'mask has no path cells' };
  }

  // unvisited marks parity-absorbed cells that must sit off the path (S1,
  // PRD 4.2 step 1.6). A 2x2 block is either wholly a path block or wholly
  // not; one unvisited cell inside an otherwise-full block breaks that
  // homogeneity, so any unvisited cell fails the tiling check outright rather
  // than being special-cased away.
  let unvisitedCount = 0;
  for (let i = 0; i < mask.unvisited.length; i++) if (mask.unvisited[i] === 1) unvisitedCount++;
  if (unvisitedCount > 0) {
    return {
      ok: false,
      reason:
        `mask has ${unvisitedCount} unvisited cell(s); the contour method traces every ` +
        'cell of a full block and cannot exclude one from inside it',
    };
  }

  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const blockFull = new Uint8Array(halfWidth * halfHeight);

  for (let by = 0; by < halfHeight; by++) {
    for (let bx = 0; bx < halfWidth; bx++) {
      const x0 = bx * 2;
      const y0 = by * 2;
      const nw = toIndex(x0, y0, width);
      const ne = toIndex(x0 + 1, y0, width);
      const sw = toIndex(x0, y0 + 1, width);
      const se = toIndex(x0 + 1, y0 + 1, width);

      let insideCount = 0;
      if (mask.inside[nw] === 1) insideCount++;
      if (mask.inside[ne] === 1) insideCount++;
      if (mask.inside[sw] === 1) insideCount++;
      if (mask.inside[se] === 1) insideCount++;

      if (insideCount === 4) {
        blockFull[by * halfWidth + bx] = 1;
      } else if (insideCount !== 0) {
        return {
          ok: false,
          reason:
            `the 2x2 block at full-res (${x0}, ${y0}) has ${insideCount} of 4 cells inside; ` +
            'a tileable region needs every block wholly inside or wholly outside',
        };
      }
    }
  }

  // The path is one walk, so its blocks must be a single 4-connected piece —
  // a spanning tree cannot span two components with one tree.
  const total = countOnes(blockFull);
  const reached = floodFillCount(blockFull, halfWidth, halfHeight);
  if (reached !== total) {
    return {
      ok: false,
      reason:
        `the region's 2x2 blocks are not one 4-connected piece: reached ${reached} of ` +
        `${total} from the first block`,
    };
  }

  return { ok: true, halfWidth, halfHeight, blockFull };
}

function countOnes(arr: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] === 1) n++;
  return n;
}

function floodFillCount(blockFull: Uint8Array, halfWidth: number, halfHeight: number): number {
  const start = blockFull.indexOf(1);
  if (start === -1) return 0;

  const seen = new Uint8Array(blockFull.length);
  seen[start] = 1;
  const stack = [start];
  let count = 1;
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    for (const dir of DIRECTIONS) {
      const next = step(cur, dir, halfWidth, halfHeight);
      if (next === NO_CELL || seen[next] === 1 || blockFull[next] !== 1) continue;
      seen[next] = 1;
      count++;
      stack.push(next);
    }
  }
  return count;
}
