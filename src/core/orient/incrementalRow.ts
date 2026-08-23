/**
 * Recompute exactly one segment's outgoing blocking row.
 *
 * Occupancy never changes when a segment flips between its legal heads — only
 * where its own ray starts and points — so flipping `id` can only change
 * `id`'s row.
 *
 * Must reproduce `buildBlockingGraph`'s per-segment loop body exactly: own
 * cells never block, a doubly-crossed ray is one edge, output sorted. A silent
 * divergence here is a board that looks acyclic and is not.
 */

import { NO_CELL, step } from '../grid.js';
import type { Direction } from '../types.js';

/** `blocking.ts` carries the same check, for the reason in the throw below. */
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
  // segDir is a Uint8Array, so a stray write arrives as a byte outside 0..3
  // rather than a type error. Throwing matches buildBlockingGraph, so an
  // upstream bug surfaces the same way whichever function sees it first.
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
