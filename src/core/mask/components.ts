/**
 * Largest 4-connected component extraction (PRD §4.2 step 1.2 and 1.4). Used
 * twice by the repair pipeline: once on the raw blob, and again after the
 * morphological open, which can split the region.
 */

import { DIRECTIONS, NO_CELL, step } from '../grid.js';
import type { Blob } from './blob.js';

/**
 * Zeroes every cell outside the largest 4-connected component of `grid.inside`.
 * A tie between two equally large components keeps whichever one row-major
 * scan order finds first — deterministic, not meaningful beyond that.
 *
 * A grid with no inside cells is returned unchanged rather than throwing:
 * "nothing to keep" is a valid, if useless, input, and the caller decides
 * whether an empty result is fatal.
 */
export function largestComponent(grid: Blob): Blob {
  const { width, height, inside } = grid;
  const size = width * height;
  const seen = new Uint8Array(size);
  let bestStart = NO_CELL;
  let bestSize = 0;

  for (let start = 0; start < size; start++) {
    if (inside[start] !== 1 || seen[start] === 1) continue;
    const memberCount = floodFill(start, inside, seen, width, height, undefined);
    if (memberCount > bestSize) {
      bestSize = memberCount;
      bestStart = start;
    }
  }

  const out = new Uint8Array(size);
  if (bestStart !== NO_CELL) {
    const members = new Uint8Array(size);
    floodFill(bestStart, inside, members, width, height, out);
  }
  return { width, height, inside: out };
}

/**
 * Flood-fills the 4-connected component of `inside` cells containing `start`.
 * `seen` is marked for every visited cell (so a caller sweeping all cells
 * does not revisit a component it already measured); `mark`, if given, also
 * gets those cells set to 1 (used to materialise the winning component once
 * it is known, without a second seen array).
 */
function floodFill(
  start: number,
  inside: Uint8Array,
  seen: Uint8Array,
  width: number,
  height: number,
  mark: Uint8Array | undefined,
): number {
  seen[start] = 1;
  if (mark) mark[start] = 1;
  const stack = [start];
  let count = 1;
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    for (const dir of DIRECTIONS) {
      const next = step(cell, dir, width, height);
      if (next === NO_CELL || inside[next] !== 1 || seen[next] === 1) continue;
      seen[next] = 1;
      if (mark) mark[next] = 1;
      count++;
      stack.push(next);
    }
  }
  return count;
}
