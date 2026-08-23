/**
 * Recompute exactly one segment's outgoing blocking row.
 *
 * `occupancy` - which cells belong to which segment - never changes when a
 * segment moves between its two legal heads; only where its ray starts and
 * which way it points does. So flipping segment `id` can only change `id`'s
 * own row: every other segment's own head/dir and the shared occupancy are
 * unchanged, so no other ray crosses a different set of cells than before.
 * That is the whole justification for recomputing one row per flip instead
 * of calling `buildBlockingGraph` (this issue's report has the measurement:
 * ~1.3ms per full rebuild at ~700 segments on a 100x100 board, dominated by
 * exactly the n-1 rows that a flip cannot have changed).
 *
 * This has to reproduce `buildBlockingGraph`'s per-segment loop body exactly
 * - own cells never block, a ray crossing another segment twice still yields
 * one edge, output sorted - because a silent divergence here is a board that
 * looks acyclic to the search but isn't really (docs/CONTRACTS.md "blocking
 * digraph"). `incrementalRow.test.ts` is the actual guarantee: it diffs this
 * against a from-scratch `buildBlockingGraph` call after every step of long
 * random flip sequences, not just this comment.
 */

import { NO_CELL, step } from '../grid.js';
import type { Direction } from '../types.js';

export function recomputeRow(
  id: number,
  head: number,
  dir: Direction,
  occupancy: Uint16Array,
  width: number,
  height: number,
): Uint32Array {
  const seen = new Set<number>();
  const blockers: number[] = [];
  let cell = step(head, dir, width, height);
  while (cell !== NO_CELL) {
    const other = occupancy[cell] as number;
    if (other !== 0 && other !== id && !seen.has(other)) {
      seen.add(other);
      blockers.push(other);
    }
    cell = step(cell, dir, width, height);
  }
  blockers.sort((a, b) => a - b);
  return Uint32Array.from(blockers);
}
