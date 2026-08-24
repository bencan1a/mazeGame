/**
 * A random spanning tree over the "full" 2x2 blocks of a region: the
 * recursive-backtracker maze algorithm, written iteratively so a few thousand
 * blocks cannot blow the call stack. Not uniform over all spanning trees.
 */

import { DIRECTIONS, NO_CELL, opposite, step } from '../grid.js';
import type { Direction } from '../types.js';
import type { Rng } from '../rng.js';

export interface SpanningTree {
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** One bit per (block, direction): `open[block * 4 + dir] === 1` means the tree has an edge that way. */
  readonly open: Uint8Array;
}

/**
 * Picks one of `count` candidates uniformly, or — when `straightIndex` names
 * a candidate that continues the direction the walk arrived on — weights that
 * one at `1 - turnBias` and splits the remainder evenly over the rest.
 * `straightIndex` of -1 (no candidate continues straight, or there is no
 * incoming direction yet) falls back to uniform.
 */
function weightedPick(count: number, straightIndex: number, turnBias: number, rng: Rng): number {
  if (straightIndex === -1 || count === 1) return rng.int(count);
  const roll = rng.next();
  if (roll < 1 - turnBias) return straightIndex;
  const turnShare = turnBias / (count - 1);
  let cursor = 1 - turnBias;
  for (let i = 0; i < count; i++) {
    if (i === straightIndex) continue;
    cursor += turnShare;
    if (roll < cursor) return i;
  }
  return count - 1 === straightIndex ? count - 2 : count - 1;
}

export function buildSpanningTree(
  blockFull: Uint8Array,
  halfWidth: number,
  halfHeight: number,
  rng: Rng,
  /** Row-major index of the block to root at, or -1 when there is none. */
  start: number,
  /**
   * Bias toward turning rather than continuing straight, in `[0, 1]`.
   * `undefined` picks uniformly among available directions, matching the
   * walk's behaviour with no bias applied.
   */
  turnBias?: number,
): SpanningTree {
  const open = new Uint8Array(blockFull.length * 4);
  if (start === -1) return { halfWidth, halfHeight, open };

  const visited = new Uint8Array(blockFull.length);
  visited[start] = 1;
  const stack: number[] = [start];
  const incomingDir: (Direction | -1)[] = [-1];

  // Reused scratch space for the current node's unvisited neighbours, so the
  // hot loop does not allocate on every iteration.
  const candidateDir: Direction[] = [0, 0, 0, 0];
  const candidateBlock: number[] = [0, 0, 0, 0];

  while (stack.length > 0) {
    const current = stack[stack.length - 1] as number;
    const arrivedFrom = incomingDir[incomingDir.length - 1] as Direction | -1;
    let count = 0;
    let straightIndex = -1;
    for (const dir of DIRECTIONS) {
      const next = step(current, dir, halfWidth, halfHeight);
      if (next === NO_CELL || blockFull[next] !== 1 || visited[next] === 1) continue;
      if (dir === arrivedFrom) straightIndex = count;
      candidateDir[count] = dir;
      candidateBlock[count] = next;
      count++;
    }
    if (count === 0) {
      stack.pop();
      incomingDir.pop();
      continue;
    }
    const pick =
      turnBias === undefined ? rng.int(count) : weightedPick(count, straightIndex, turnBias, rng);
    const dir = candidateDir[pick] as Direction;
    const next = candidateBlock[pick] as number;
    open[current * 4 + dir] = 1;
    open[next * 4 + opposite(dir)] = 1;
    visited[next] = 1;
    stack.push(next);
    incomingDir.push(dir);
  }

  return { halfWidth, halfHeight, open };
}
