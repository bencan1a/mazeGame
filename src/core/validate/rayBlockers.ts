/**
 * Ground-truth ray walk, deliberately independent of the declared
 * `edgeStart`/`edgeTarget` CSR that `buildBlockingGraph` derives (CONTRACTS.md
 * "blocking digraph"). A bug in that derivation is what validation exists to
 * catch, so "the CSR says X" is not evidence about the board's geometry.
 */

import { NO_CELL, step } from '../grid.js';
import type { Board, Direction, SegmentId } from '../types.js';
import { BoardInvariantError } from '../types.js';

/** Narrow a raw direction value. `segDir` is a `Uint8Array`, so a corrupt board can carry any byte. */
export function isDirection(dir: number): dir is Direction {
  return dir === 0 || dir === 1 || dir === 2 || dir === 3;
}

/**
 * The distinct other segments on segment `id`'s exit ray, in ray order.
 *
 * The direction is checked before the first step. `step()` answers NO_CELL for
 * an out-of-range one (#38), so the walk would find nothing and the segment
 * would read as free rather than as corrupt.
 */
export function rayBlockers(board: Board, id: SegmentId): SegmentId[] {
  const dir = board.segDir[id - 1] as number;
  if (!isDirection(dir)) {
    throw new BoardInvariantError(
      `segment ${id} has direction ${dir}, which is not one of 0..3 (N/E/S/W)`,
      { segment: id, segDir: dir },
    );
  }
  const head = board.segHead[id - 1] as number;
  const found: SegmentId[] = [];
  const seen = new Set<SegmentId>();
  let cell = step(head, dir, board.width, board.height);
  while (cell !== NO_CELL) {
    const other = board.occupancy[cell] as number;
    if (other !== 0 && other !== id && !seen.has(other)) {
      seen.add(other);
      found.push(other);
    }
    cell = step(cell, dir, board.width, board.height);
  }
  return found;
}
