/** 4-connected component filtering. */

import { DIRECTIONS, NO_CELL, step } from '../grid.js';
import type { Blob } from './blob.js';

/**
 * Zeroes every component of `grid.inside` holding fewer than `minCells` cells,
 * and keeps the rest. A silhouette is several lobes, so this drops the ones
 * too small to hold a path rather than reducing the grid to one lobe.
 */
export function dropSmallComponents(grid: Blob, minCells: number): Blob {
  const { width, height, inside } = grid;
  const size = width * height;
  const out = new Uint8Array(size);
  const seen = new Uint8Array(size);
  const members: number[] = [];

  for (let start = 0; start < size; start++) {
    if (inside[start] !== 1 || seen[start] === 1) continue;
    members.length = 0;
    collectComponent(start, inside, seen, width, height, members);
    if (members.length < minCells) continue;
    for (const cell of members) out[cell] = 1;
  }

  return { width, height, inside: out };
}

/** Appends the 4-connected component of `inside` cells containing `start` to `members`. */
function collectComponent(
  start: number,
  inside: Uint8Array,
  seen: Uint8Array,
  width: number,
  height: number,
  members: number[],
): void {
  seen[start] = 1;
  members.push(start);
  const stack = [start];
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    for (const dir of DIRECTIONS) {
      const next = step(cell, dir, width, height);
      if (next === NO_CELL || inside[next] !== 1 || seen[next] === 1) continue;
      seen[next] = 1;
      members.push(next);
      stack.push(next);
    }
  }
}
