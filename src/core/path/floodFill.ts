/**
 * Cells reachable from `start` by 4-adjacency, restricted to cells where
 * `member[i] === 1`.
 */

import { DIRECTIONS, NO_CELL, step } from '../grid.js';

export function floodFillCount(
  member: Uint8Array,
  width: number,
  height: number,
  start: number,
): number {
  if (start === -1) return 0;

  const seen = new Uint8Array(member.length);
  seen[start] = 1;
  const stack = [start];
  let count = 1;
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    for (const dir of DIRECTIONS) {
      const next = step(cur, dir, width, height);
      if (next === NO_CELL || seen[next] === 1 || member[next] !== 1) continue;
      seen[next] = 1;
      count++;
      stack.push(next);
    }
  }
  return count;
}
