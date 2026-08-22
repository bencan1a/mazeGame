/**
 * A random spanning tree over the "full" 2x2 blocks of a tileable region
 * (see tiling.ts), built with a randomized iterative depth-first search (the
 * "recursive backtracker" maze-generation algorithm, done non-recursively so
 * a 100x100 mask's 2500 blocks cannot blow a call stack). It does not claim
 * uniformity over all spanning trees — only that it is random, connected, and
 * linear time, which is everything the contour trace in contour.ts needs.
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

export function buildSpanningTree(
  blockFull: Uint8Array,
  halfWidth: number,
  halfHeight: number,
  rng: Rng,
  /** Row-major index of the block to root at; `TilingOk.firstFullBlock`. -1 when there is none. */
  start: number,
): SpanningTree {
  const open = new Uint8Array(blockFull.length * 4);
  if (start === -1) return { halfWidth, halfHeight, open };

  const visited = new Uint8Array(blockFull.length);
  visited[start] = 1;
  const stack: number[] = [start];

  // Reused scratch space for the current node's unvisited neighbours, so the
  // hot loop does not allocate on every iteration.
  const candidateDir: Direction[] = [0, 0, 0, 0];
  const candidateBlock: number[] = [0, 0, 0, 0];

  while (stack.length > 0) {
    const current = stack[stack.length - 1] as number;
    let count = 0;
    for (const dir of DIRECTIONS) {
      const next = step(current, dir, halfWidth, halfHeight);
      if (next === NO_CELL || blockFull[next] !== 1 || visited[next] === 1) continue;
      candidateDir[count] = dir;
      candidateBlock[count] = next;
      count++;
    }
    if (count === 0) {
      // Dead end: every neighbour of the current node is already in the
      // tree, so backtrack to whatever pushed it.
      stack.pop();
      continue;
    }
    const pick = rng.int(count);
    const dir = candidateDir[pick] as Direction;
    const next = candidateBlock[pick] as number;
    open[current * 4 + dir] = 1;
    open[next * 4 + opposite(dir)] = 1;
    visited[next] = 1;
    stack.push(next);
  }

  return { halfWidth, halfHeight, open };
}
