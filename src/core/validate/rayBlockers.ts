/**
 * Ground-truth ray walk, independent of the declared `edgeStart`/`edgeTarget`
 * CSR.
 *
 * This mirrors what S3's `buildBlockingGraph` is supposed to do (CONTRACTS.md
 * "blocking digraph"): starting one step past a segment's head, in its exit
 * direction, walk to the board edge and collect each *distinct other* segment
 * id the ray crosses, in the order it meets them. A segment's own cells never
 * block it.
 *
 * `validateBoard` uses this as ground truth to check the declared edge CSR
 * against, rather than trusting it the way a runtime consumer would — a bug in
 * S3's derivation is exactly what validation exists to catch, and "the CSR
 * says X" is not evidence the board is actually solvable.
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
 * Throws before taking a single step if `segDir` is not 0..3. `step()`
 * returns `NaN` (not `NO_CELL`) for an out-of-range direction (#38), and
 * `NaN !== NO_CELL` is always true, so an unguarded `while (cell !== NO_CELL)`
 * loop below would never terminate. Validating the direction first is the
 * guard; #38 itself is a shared-file bug this stream does not own.
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
