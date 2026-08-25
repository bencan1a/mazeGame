/**
 * Backbite: the fallback Hamiltonian path builder, for regions the contour
 * method cannot tile into 2x2 blocks.
 *
 * The path is a position array `pathCells` plus its inverse `pathIndex`
 * (cell -> position, -1 when off the path). Every move picks an endpoint —
 * tail or head, 50/50 — and a uniformly random 4-neighbour of it:
 *
 *   - Off the path: append it. This is growth, the only way `length` rises.
 *     At the head that is O(1); a fixed array has no O(1) prepend, so growth
 *     at the tail first reverses the whole path to relabel the tail as head.
 *   - On the path at position `p`: the new edge closes a cycle, and the only
 *     rewrite back to a simple path reverses the arc strictly between the
 *     endpoint and `p` — `[p+1, length-1]` at the head, `[0, p-1]` at the
 *     tail. That arc is empty when the neighbour picked is the endpoint's
 *     current path-neighbour, and `reverseRange` no-ops on it, so neither
 *     case needs its own guard.
 *
 * Growth alone can trap: once covered cells wall off an uncovered pocket, no
 * move reaches it, because moves only reorder the covered vertex set. A long
 * run without growth therefore restarts from a fresh random cell.
 */

import { DIRECTIONS, NO_CELL, directionBetween, parityOf, step as gridStep } from '../grid.js';
import type { Rng } from '../rng.js';
import type { HamiltonianPath, Mask } from '../types.js';
import { floodFillCount } from './floodFill.js';

export interface BackbiteOk {
  readonly ok: true;
  readonly path: HamiltonianPath;
  /** Growth + mixing moves actually taken. */
  readonly moves: number;
}

export interface BackbiteFailed {
  readonly ok: false;
  readonly reason: string;
}

export type BackbiteResult = BackbiteOk | BackbiteFailed;

/**
 * Mixing moves run once growth completes, to move the path away from whatever
 * order growth produced and toward near-uniform among the region's
 * Hamiltonian paths. Scaled by cell count, and small next to growth's own
 * cost, so mixing adds only a modest fraction to the total.
 */
export const DEFAULT_MIXING_MOVES_PER_CELL = 8;

/**
 * Growth-move budget, as a multiple of `pathCellCount`. Growth is randomized
 * with no worst-case bound, so this is a box rather than an estimate: it turns
 * a pathological region into a clean `ok: false` instead of a runaway loop.
 *
 * It clears every realistic shape measured but not every conceivable one — a
 * region that exhausts it reports `ok: false`, and the caller retries with a
 * new seed rather than depending on this call succeeding.
 */
export const DEFAULT_MAX_GROWTH_MOVES_PER_CELL = 400;

/**
 * Consecutive moves without growth before restarting from a fresh random cell.
 *
 * Not tuned to an observed trapping threshold: no input has been found where
 * the exact value changes the outcome, only whether restarts happen at all.
 * It is simply comfortably larger than the handful of moves a healthy attempt
 * needs between growth events, so restarts fire on genuine stalls rather than
 * on ordinary slow patches.
 */
export const DEFAULT_STALL_LIMIT_PER_CELL = 60;

export interface BackbiteOptions {
  /** Extra moves after growth completes. Default `DEFAULT_MIXING_MOVES_PER_CELL * pathCellCount`. */
  readonly mixingMoves?: number;
  /** Total growth move budget, across all restarts, before reporting failure. Default `DEFAULT_MAX_GROWTH_MOVES_PER_CELL * pathCellCount`. */
  readonly maxGrowthMoves?: number;
  /** Moves without growth before restarting from a new start cell. Default `DEFAULT_STALL_LIMIT_PER_CELL * pathCellCount`. */
  readonly stallLimit?: number;
  /**
   * Check path invariants after every move rather than only at the end.
   * O(pathCellCount) per move, so it is opt-in.
   */
  readonly validateEveryMove?: boolean;
}

/**
 * Build a Hamiltonian path over `mask` via backbite growth and mixing.
 *
 * Unlike the contour method, this places no shape requirement on the region
 * beyond what a Hamiltonian path needs at all: `pathCellCount` cells, one
 * 4-connected component, balanced checkerboard parity, no path cell with zero
 * or more-than-two-dead-ends-worth of path-cell neighbours. A region that
 * fails that is reported as `ok: false`, not thrown — a multi-region mask
 * included, since it is not one 4-connected piece.
 */
export function buildBackbitePath(
  mask: Mask,
  rng: Rng,
  options: BackbiteOptions = {},
): BackbiteResult {
  const target = mask.pathCellCount;
  if (target === 0) {
    return {
      ok: true,
      path: { cells: new Uint32Array(0), regionStart: Uint32Array.from([0]) },
      moves: 0,
    };
  }

  const { width, height } = mask;
  const size = width * height;
  const isPathCell = new Uint8Array(size);
  const pathCellList = new Uint32Array(target);
  let listed = 0;
  for (let i = 0; i < mask.inside.length; i++) {
    if (mask.inside[i] === 1 && mask.unvisited[i] !== 1) {
      isPathCell[i] = 1;
      if (listed < target) pathCellList[listed] = i;
      listed++;
    }
  }
  if (listed !== target) {
    return {
      ok: false,
      reason:
        `mask.pathCellCount is ${target} but ${listed} cells are actually inside and not ` +
        'unvisited; the mask is internally inconsistent',
    };
  }

  const infeasible = findInfeasibility(isPathCell, pathCellList, width, height);
  if (infeasible !== null) return { ok: false, reason: infeasible };

  const mixingMoves = options.mixingMoves ?? DEFAULT_MIXING_MOVES_PER_CELL * target;
  const maxGrowthMoves = options.maxGrowthMoves ?? DEFAULT_MAX_GROWTH_MOVES_PER_CELL * target;
  // Clamped to >= 1 because 0 survives the ?? default and makes growth
  // structurally impossible: the restart branch below would fire before every
  // move, so the path could never reach length 2. Termination is guaranteed by
  // that branch charging the move budget, not by this clamp.
  const stallLimit = Math.max(1, options.stallLimit ?? DEFAULT_STALL_LIMIT_PER_CELL * target);
  const validateEveryMove = options.validateEveryMove ?? false;

  const pathCells = new Uint32Array(target);
  const pathIndex = new Int32Array(size).fill(-1);

  // Clears only the cells currently on the path, so a restart costs O(live
  // path length) rather than O(width * height) — which for a sparse silhouette
  // in a large grid can exceed the moves the restart sits between.
  const restart = (liveLength: number): void => {
    for (let i = 0; i < liveLength; i++) pathIndex[pathCells[i] as number] = -1;
    const start = pathCellList[rng.int(target)] as number;
    pathCells[0] = start;
    pathIndex[start] = 0;
  };
  restart(0);
  let length = 1;

  // Reused per-move scratch, so the hot loop does not allocate.
  const candidates = new Int32Array(4);

  let moves = 0;
  let movesSinceGrowth = 0;
  while (length < target) {
    if (moves >= maxGrowthMoves) {
      return {
        ok: false,
        reason:
          `backbite did not grow to a Hamiltonian path within ${maxGrowthMoves} moves ` +
          `(reached ${length} of ${target} cells) — findInfeasibility already ruled out a ` +
          'disconnected region, a zero-degree path cell and an impossible parity, so either ' +
          'growth trapped itself repeatedly or the budget is too tight for this shape',
      };
    }
    if (movesSinceGrowth >= stallLimit) {
      // Growth trapped itself: an uncovered pocket is walled off from both
      // endpoints and every reachable reordering of them.
      restart(length);
      length = 1;
      movesSinceGrowth = 0;
      // Charged to the budget like any other move: without this, a stallLimit
      // low enough to fire every time iterates for free and never terminates.
      moves++;
      continue;
    }
    const before = length;
    length = backbiteMove(isPathCell, pathCells, pathIndex, length, rng, width, height, candidates);
    moves++;
    movesSinceGrowth = length > before ? 0 : movesSinceGrowth + 1;
    if (validateEveryMove) {
      assertPartialPathInvariants(pathCells, pathIndex, length, isPathCell, width);
    }
  }

  for (let i = 0; i < mixingMoves; i++) {
    length = backbiteMove(isPathCell, pathCells, pathIndex, length, rng, width, height, candidates);
    moves++;
    if (validateEveryMove) {
      assertPartialPathInvariants(pathCells, pathIndex, length, isPathCell, width);
    }
  }

  return {
    ok: true,
    path: { cells: pathCells, regionStart: Uint32Array.from([0, pathCells.length]) },
    moves,
  };
}

/**
 * Cheap necessary conditions for a Hamiltonian path to exist, checked up front
 * so an infeasible region fails immediately instead of burning the growth
 * budget on restarts that cannot succeed:
 *
 *   - Checkerboard parity: a path alternates colour every step, so the two
 *     counts can differ by at most one however it is routed.
 *   - A path cell with no path-cell neighbours can never be reached.
 *   - A path cell with exactly one (a dead end) can only be an endpoint, and
 *     there is room for two.
 *   - The path cells are not one 4-connected piece.
 *
 * None is sufficient, so passing this only means growth is not provably
 * doomed before it starts.
 */
function findInfeasibility(
  isPathCell: Uint8Array,
  pathCellList: Uint32Array,
  width: number,
  height: number,
): string | null {
  let deadEnds = 0;
  let black = 0;
  let white = 0;
  for (let k = 0; k < pathCellList.length; k++) {
    const cell = pathCellList[k] as number;
    if (parityOf(cell, width) === 0) black++;
    else white++;

    let degree = 0;
    for (const dir of DIRECTIONS) {
      const neighbour = gridStep(cell, dir, width, height);
      if (neighbour !== NO_CELL && isPathCell[neighbour] === 1) degree++;
    }
    if (degree === 0 && pathCellList.length > 1) {
      return `path cell ${cell} has no path-cell neighbour, so it can never be reached`;
    }
    if (degree === 1) deadEnds++;
  }

  if (Math.abs(black - white) > 1) {
    return (
      `checkerboard parity is off by ${Math.abs(black - white)} (${black} vs ${white} cells); ` +
      'a Hamiltonian path alternates colour every step, so an imbalance greater than 1 makes ' +
      'the region infeasible'
    );
  }
  if (deadEnds > 2) {
    return (
      `${deadEnds} path cells have exactly one path-cell neighbour; a Hamiltonian path has ` +
      'only two endpoints, so more than two dead ends makes the region infeasible'
    );
  }

  const reached = floodFillCount(isPathCell, width, height, pathCellList[0] as number);
  if (reached !== pathCellList.length) {
    return (
      `path cells are not one 4-connected piece: reached ${reached} of ${pathCellList.length} ` +
      'from the first cell'
    );
  }

  return null;
}

/**
 * One growth-or-backbite move at a randomly chosen endpoint. Returns the new
 * length.
 */
function backbiteMove(
  isPathCell: Uint8Array,
  pathCells: Uint32Array,
  pathIndex: Int32Array,
  length: number,
  rng: Rng,
  width: number,
  height: number,
  candidates: Int32Array,
): number {
  const atTail = rng.chance(0.5);
  const endpoint = (atTail ? pathCells[0] : pathCells[length - 1]) as number;

  let count = 0;
  for (const dir of DIRECTIONS) {
    const neighbour = gridStep(endpoint, dir, width, height);
    if (neighbour !== NO_CELL && isPathCell[neighbour] === 1) candidates[count++] = neighbour;
  }
  if (count === 0) return length;

  const neighbour = candidates[rng.int(count)] as number;
  const p = pathIndex[neighbour] as number;

  if (p === -1) {
    // Growth. The tail has no O(1) prepend, so relabel it as the head first.
    if (atTail) reverseRange(pathCells, pathIndex, 0, length - 1);
    pathCells[length] = neighbour;
    pathIndex[neighbour] = length;
    return length + 1;
  }

  if (atTail) reverseRange(pathCells, pathIndex, 0, p - 1);
  else reverseRange(pathCells, pathIndex, p + 1, length - 1);
  return length;
}

function reverseRange(pathCells: Uint32Array, pathIndex: Int32Array, lo: number, hi: number): void {
  while (lo < hi) {
    const a = pathCells[lo] as number;
    const b = pathCells[hi] as number;
    pathCells[lo] = b;
    pathCells[hi] = a;
    pathIndex[b] = lo;
    pathIndex[a] = hi;
    lo++;
    hi--;
  }
}

/**
 * The path postconditions restricted to a path still under construction: no
 * repeats, every entry a mask path cell, consecutive entries 4-neighbours.
 * Length is checked by the caller once growth ends, since it is not true of a
 * partial path by definition.
 */
function assertPartialPathInvariants(
  pathCells: Uint32Array,
  pathIndex: Int32Array,
  length: number,
  isPathCell: Uint8Array,
  width: number,
): void {
  for (let i = 0; i < length; i++) {
    const cell = pathCells[i] as number;
    if (isPathCell[cell] !== 1) {
      throw new Error(
        `backbite invariant violated: pathCells[${i}] = ${cell} is not a mask path cell`,
      );
    }
    if (pathIndex[cell] !== i) {
      throw new Error(
        `backbite invariant violated: pathIndex[${cell}] = ${pathIndex[cell] as number}, expected ${i}`,
      );
    }
    if (i > 0) {
      const prev = pathCells[i - 1] as number;
      if (directionBetween(prev, cell, width) === -1) {
        throw new Error(
          `backbite invariant violated: pathCells[${i - 1}] = ${prev} and pathCells[${i}] = ${cell} are not 4-neighbours`,
        );
      }
    }
  }
}
