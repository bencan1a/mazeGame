/**
 * Whether a Mask's path cells can be partitioned into a perfect grid of 2x2
 * blocks at half resolution — the precondition the spanning-tree contour
 * method needs (PRD 4.2 step 2, docs/CONTRACTS.md `Mask -> HamiltonianPath`).
 *
 * Only the REGION (the `inside && !unvisited` cells, i.e. the path cells) has
 * to tile — not the whole grid. A silhouette sitting inside a larger,
 * possibly odd-sized, grid tiles exactly when some placement of the 2x2
 * lattice lines the region's cells up into whole blocks, so this tries all
 * four lattice offsets — (0,0), (1,0), (0,1), (1,1) — and accepts the first
 * one that works.
 *
 * A block is "full" only when all four of its cells are path cells and "empty"
 * only when none are. `unvisited` cells count as outside for tiling purposes,
 * so a block that is part unvisited and part path is mixed and fails — the
 * contour would otherwise route through a cell that must stay off the path.
 *
 * All of this is reported, not thrown: a non-tileable region is an expected
 * outcome the backbite fallback exists for (#6), not a bug.
 */

import { DIRECTIONS, NO_CELL, step, toIndex } from '../grid.js';
import type { Mask } from '../types.js';

export interface TilingOk {
  readonly ok: true;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** 1 where the half-res block at `by * halfWidth + bx` is a "full" (path) block. */
  readonly blockFull: Uint8Array;
  /**
   * The lattice offset the region tiled under, i.e. the full-resolution
   * origin of block (0, 0) is (offsetX, offsetY). Every other block sits at
   * (offsetX + 2*bx, offsetY + 2*by). Reported so callers and tests can see
   * which of the four placements succeeded, since it is not always (0, 0).
   */
  readonly offsetX: 0 | 1;
  readonly offsetY: 0 | 1;
  /**
   * Index into `blockFull` of the first full block, row-major. Carried rather
   * than re-derived so the spanning tree root and the contour's cut point
   * cannot disagree about what "no full block" means.
   */
  readonly firstFullBlock: number;
}

export interface TilingFailed {
  readonly ok: false;
  readonly reason: string;
}

export type TilingResult = TilingOk | TilingFailed;

const LATTICE_OFFSETS: ReadonlyArray<readonly [0 | 1, 0 | 1]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

export function classifyTiling(mask: Mask): TilingResult {
  // pathCellCount is the mask's claim about itself. A mask whose arrays
  // disagree with it can otherwise tile "successfully" over the wrong number
  // of cells, which contour.ts turns into a truncated path with no ok:false.
  const actualPathCells = countPathCells(mask);
  if (actualPathCells !== mask.pathCellCount) {
    return {
      ok: false,
      reason:
        `mask.pathCellCount is ${mask.pathCellCount} but ${actualPathCells} cells are actually ` +
        'inside and not unvisited; the mask is internally inconsistent',
    };
  }
  if (mask.pathCellCount === 0) {
    return { ok: false, reason: 'mask has no path cells' };
  }

  const attempts: string[] = [];
  for (const [offsetX, offsetY] of LATTICE_OFFSETS) {
    const result = classifyAtOffset(mask, offsetX, offsetY);
    if (result.ok) return result;
    attempts.push(`offset (${offsetX}, ${offsetY}): ${result.reason}`);
  }

  return {
    ok: false,
    reason: `mask does not tile into 2x2 blocks under any lattice offset — ${attempts.join('; ')}`,
  };
}

/** A cell that the path must cover: inside the silhouette and not parity-absorbed. */
function isPathCell(mask: Mask, index: number): boolean {
  return mask.inside[index] === 1 && mask.unvisited[index] !== 1;
}

function countPathCells(mask: Mask): number {
  let count = 0;
  for (let i = 0; i < mask.inside.length; i++) if (isPathCell(mask, i)) count++;
  return count;
}

function classifyAtOffset(mask: Mask, offsetX: 0 | 1, offsetY: 0 | 1): TilingResult {
  const { width, height } = mask;
  const halfWidth = Math.floor((width - offsetX) / 2);
  const halfHeight = Math.floor((height - offsetY) / 2);

  if (halfWidth <= 0 || halfHeight <= 0) {
    return {
      ok: false,
      reason: `a ${width}x${height} mask has no room for a full 2x2 block at this offset`,
    };
  }

  // Cells the lattice does not cover — a near-edge row/column when the offset
  // is 1, a far-edge strip when the remaining span is odd — belong to no block
  // and can never be traced, so none of them may be on the path.
  const coveredWidth = 2 * halfWidth;
  const coveredHeight = 2 * halfHeight;
  for (let y = 0; y < height; y++) {
    const yCovered = y >= offsetY && y < offsetY + coveredHeight;
    for (let x = 0; x < width; x++) {
      if (yCovered && x >= offsetX && x < offsetX + coveredWidth) continue;
      const index = toIndex(x, y, width);
      if (isPathCell(mask, index)) {
        return {
          ok: false,
          reason:
            `path cell (${x}, ${y}) falls outside every 2x2 block at this offset, so it ` +
            'cannot be covered',
        };
      }
    }
  }

  const blockFull = new Uint8Array(halfWidth * halfHeight);

  for (let by = 0; by < halfHeight; by++) {
    for (let bx = 0; bx < halfWidth; bx++) {
      const x0 = offsetX + bx * 2;
      const y0 = offsetY + by * 2;
      const nw = toIndex(x0, y0, width);
      const ne = toIndex(x0 + 1, y0, width);
      const sw = toIndex(x0, y0 + 1, width);
      const se = toIndex(x0 + 1, y0 + 1, width);

      let pathCount = 0;
      if (isPathCell(mask, nw)) pathCount++;
      if (isPathCell(mask, ne)) pathCount++;
      if (isPathCell(mask, sw)) pathCount++;
      if (isPathCell(mask, se)) pathCount++;

      if (pathCount === 4) {
        blockFull[by * halfWidth + bx] = 1;
      } else if (pathCount !== 0) {
        return {
          ok: false,
          reason:
            `the 2x2 block at full-res (${x0}, ${y0}) has ${pathCount} of 4 cells on the ` +
            'path; a tileable region needs every block wholly on the path or wholly off it',
        };
      }
    }
  }

  // The path is one walk, so its blocks must be a single 4-connected piece —
  // a spanning tree cannot span two components with one tree.
  const total = countOnes(blockFull);
  const firstFullBlock = blockFull.indexOf(1);
  const reached = floodFillCount(blockFull, halfWidth, halfHeight, firstFullBlock);
  if (reached !== total) {
    return {
      ok: false,
      reason:
        `the region's 2x2 blocks are not one 4-connected piece: reached ${reached} of ` +
        `${total} from the first block`,
    };
  }

  // Redundant once the checks above hold, but it is the direct guard against
  // contour.ts tracing a block count that disagrees with the path length it
  // allocates.
  if (4 * total !== mask.pathCellCount) {
    return {
      ok: false,
      reason: `block partition covers ${4 * total} cells but mask.pathCellCount is ${mask.pathCellCount}`,
    };
  }

  return { ok: true, halfWidth, halfHeight, blockFull, offsetX, offsetY, firstFullBlock };
}

function countOnes(arr: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] === 1) n++;
  return n;
}

function floodFillCount(
  blockFull: Uint8Array,
  halfWidth: number,
  halfHeight: number,
  start: number,
): number {
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
