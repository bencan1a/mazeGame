/** Largest 4-connected component extraction. */

import { DIRECTIONS, NO_CELL, step } from '../grid.js';
import type { Blob } from './blob.js';

/**
 * Zeroes every cell outside the largest 4-connected component of `grid.inside`.
 * A tie keeps whichever component row-major scan order finds first —
 * deterministic, not meaningful beyond that. A grid with no inside cells comes
 * back unchanged rather than throwing.
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
 * Every visited cell is set in `seen`, and in `mark` too when it is given.
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
