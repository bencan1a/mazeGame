/**
 * A Hamiltonian path alternates checkerboard colour every step, so one can
 * only exist when the two colour counts differ by at most 1. Absorbing the
 * difference marks cells `unvisited` rather than editing the silhouette.
 */

import { DIRECTIONS, NO_CELL, parityOf, step } from '../grid.js';
import type { Direction, Mask } from '../types.js';
import { MaskRepairError } from './errors.js';

/** `unvisited` may mark at most this many cells. */
const MAX_UNVISITED_CELLS = 3;

/**
 * Marks the minimum set of `inside` cells `unvisited` so that `|black - white|`
 * over the remaining path cells is at most 1: given an imbalance `d`, exactly
 * `|d| - 1` majority-colour cells are removed, never more and never from the
 * minority.
 *
 * Every removal keeps the region one 4-connected component, and the
 * articulation-point table is recomputed each round rather than once up front:
 * a cell that was safe becomes a cut vertex once a neighbour of it is gone.
 *
 * Throws if more than `MAX_UNVISITED_CELLS` would be needed.
 */
export function absorbParity(mask: Mask): Mask {
  const { width, height, inside, unvisited } = mask;
  const size = width * height;

  const alive = new Uint8Array(size);
  let black = 0;
  let white = 0;
  let existingUnvisited = 0;
  for (let i = 0; i < size; i++) {
    if (inside[i] !== 1) continue;
    if (unvisited[i] === 1) {
      existingUnvisited++;
      continue;
    }
    alive[i] = 1;
    if (parityOf(i, width) === 0) black++;
    else white++;
  }

  const imbalance = black - white;
  if (Math.abs(imbalance) <= 1) return mask;

  const needed = Math.abs(imbalance) - 1;
  if (existingUnvisited + needed > MAX_UNVISITED_CELLS) {
    throw new MaskRepairError(
      `checkerboard parity absorption needs ${needed} more cell(s) on top of ` +
        `${existingUnvisited} already unvisited to bring |black - white| (currently ` +
        `${Math.abs(imbalance)}) within 1, exceeding the ${MAX_UNVISITED_CELLS}-cell limit — ` +
        'the silhouette needs to change, this cannot be absorbed',
    );
  }

  const majorityParity: 0 | 1 = imbalance > 0 ? 0 : 1;
  const outUnvisited = unvisited.slice();

  for (let round = 0; round < needed; round++) {
    const isArticulation = findArticulationPoints(alive, width, height);
    let chosen = NO_CELL;
    for (let i = 0; i < size; i++) {
      if (alive[i] !== 1 || isArticulation[i] === 1) continue;
      if (parityOf(i, width) !== majorityParity) continue;
      chosen = i;
      break;
    }
    if (chosen === NO_CELL) {
      // A defensive assertion, not a reachable case: a spanning tree of the
      // region always has a majority-colour leaf, and a leaf is never a cut
      // vertex.
      throw new MaskRepairError(
        `checkerboard parity absorption could not find a majority-colour cell (round ` +
          `${round + 1} of ${needed}) whose removal keeps the region a single connected piece ` +
          '— this should be unreachable',
      );
    }
    alive[chosen] = 0;
    outUnvisited[chosen] = 1;
  }

  let pathCellCount = 0;
  for (let i = 0; i < size; i++) if (alive[i] === 1) pathCellCount++;

  return { width, height, inside, unvisited: outUnvisited, pathCellCount };
}

/**
 * Articulation points of the 4-connected graph over `alive` cells, by Tarjan's
 * algorithm. Iterative because one DFS branch can be as long as the mask has
 * cells: `stack` stands in for the call stack, and `nextDir` records how far
 * each cell's neighbour scan got, so resuming the top of `stack` continues
 * rather than restarting it.
 */
function findArticulationPoints(alive: Uint8Array, width: number, height: number): Uint8Array {
  const size = width * height;
  const disc = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const parent = new Int32Array(size).fill(NO_CELL);
  const nextDir = new Uint8Array(size);
  const isArticulation = new Uint8Array(size);
  let timer = 0;

  for (let start = 0; start < size; start++) {
    if (alive[start] !== 1 || disc[start] !== -1) continue;

    let rootChildren = 0;
    disc[start] = timer;
    low[start] = timer;
    timer++;
    nextDir[start] = 0;
    const stack: number[] = [start];

    while (stack.length > 0) {
      const node = stack[stack.length - 1] as number;
      const dirIdx = nextDir[node] as number;
      if (dirIdx < DIRECTIONS.length) {
        nextDir[node] = dirIdx + 1;
        const dir = DIRECTIONS[dirIdx] as Direction;
        const neighbour = step(node, dir, width, height);
        if (neighbour === NO_CELL || alive[neighbour] !== 1 || neighbour === parent[node]) {
          continue;
        }
        if (disc[neighbour] === -1) {
          parent[neighbour] = node;
          if (node === start) rootChildren++;
          disc[neighbour] = timer;
          low[neighbour] = timer;
          timer++;
          nextDir[neighbour] = 0;
          stack.push(neighbour);
        } else {
          low[node] = Math.min(low[node] as number, disc[neighbour] as number);
        }
      } else {
        stack.pop();
        const p = parent[node] as number;
        if (p !== NO_CELL) {
          low[p] = Math.min(low[p] as number, low[node] as number);
          if (p !== start && (low[node] as number) >= (disc[p] as number)) {
            isArticulation[p] = 1;
          }
        }
      }
    }

    if (rootChildren > 1) isArticulation[start] = 1;
  }

  return isArticulation;
}
