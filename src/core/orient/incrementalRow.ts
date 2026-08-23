/**
 * Recompute exactly one segment's outgoing blocking row.
 *
 * Occupancy (which cells belong to which segment) never changes when a
 * segment flips between its two legal heads - only where its own ray starts
 * and which way it points does - so flipping segment `id` can only change
 * `id`'s own row. That is the whole justification for recomputing one row
 * instead of calling `buildBlockingGraph` for every flip.
 *
 * Must reproduce that function's per-segment loop body exactly (own cells
 * never block, a doubly-crossed ray is one edge, output sorted); a silent
 * divergence here is a board that looks acyclic but isn't.
 * `incrementalRow.test.ts` is the actual guarantee, diffing this against a
 * from-scratch rebuild after every step of long random flip sequences.
 */

import { NO_CELL, step } from '../grid.js';
import type { Direction } from '../types.js';

/** `blocking.ts` has its own copy of this same one-line check, for the same reason: see the throw below. */
function isDirection(dir: number): dir is Direction {
  return dir === 0 || dir === 1 || dir === 2 || dir === 3;
}

export function recomputeRow(
  id: number,
  head: number,
  dir: Direction,
  occupancy: Uint16Array,
  width: number,
  height: number,
): Uint32Array {
  // buildBlockingGraph throws here rather than silently walking a ray from a
  // corrupt direction (segDir is a Uint8Array; a stray write arrives as some
  // byte outside 0..3, not a type error) - matching that means a bug
  // upstream surfaces as a loud, attributable error in either function, not
  // as an empty row in this one and a thrown one in that one.
  if (!isDirection(dir)) {
    throw new Error(`segment ${id} has direction ${String(dir)}, expected 0..3`);
  }

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
