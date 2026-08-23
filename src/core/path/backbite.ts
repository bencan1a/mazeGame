/**
 * Backbite: the fallback Hamiltonian path builder (PRD 4.2 step 2,
 * docs/CONTRACTS.md `Mask -> HamiltonianPath`), for regions the spanning-tree
 * contour method (contour.ts) cannot tile into 2x2 blocks — expected to be
 * common, since parity absorption (#4) can leave an `unvisited` hole that
 * breaks tiling without breaking connectivity.
 *
 * The path is kept as a position array `pathCells` (the walk, in order) plus
 * its inverse `pathIndex` (cell -> position, -1 if the cell is not yet on the
 * path). Every move picks an endpoint — `pathCells[0]` (the tail) or
 * `pathCells[length - 1]` (the head), 50/50 — and a uniformly random
 * 4-neighbour of it that the mask allows on the path at all (on-path or not):
 *
 *   - Not yet on the path (`pathIndex[neighbour] === -1`): append it. This is
 *     growth; it is the only way `length` increases. At the head this is
 *     `pathCells[length] = neighbour` — O(1). A fixed array has no O(1) way to
 *     prepend, so growth at the tail is the one case that pays a full reversal
 *     of `pathCells[0 .. length - 1]` first, which relabels the tail as the
 *     head and turns the append into the O(1) case above. Growth only ever
 *     happens `pathCellCount - 1` times in total, so this cost is paid rarely
 *     relative to the total move count, not on every move.
 *   - Already on the path at position `p`: adding the edge (endpoint,
 *     neighbour) closes a cycle. The only rewrite that turns that back into a
 *     simple path is to reverse the arc strictly between the endpoint and
 *     `p`: `pathCells[p+1 .. length-1]` at the head, or `pathCells[0 .. p-1]`
 *     at the tail. `reverseRange` no-ops by itself when that arc is empty
 *     (`p === length - 2` at the head, `p === 1` at the tail — picking the
 *     endpoint's current path-neighbour again, which is legal and does
 *     nothing), so neither case needs a guard of its own.
 *
 * An earlier version of this file flipped the *entire* array on every move,
 * before even knowing whether the move would touch it, on the theory that
 * relabelling which end is "the head" cost no more than the reversal a
 * backbite move already pays. Measured false: on a full 100x100 rectangle
 * (seed 1, default mixing) that cost 2526ms; picking the end first and
 * reversing only the arc a move actually needs brings the same call down to
 * 600-1200ms depending on seed — a large, reproducible win, though the
 * remaining cost is still real (see DEFAULT_MAX_GROWTH_MOVES_PER_CELL on why
 * it is inherently up to quadratic in `pathCellCount`).
 *
 * Once `length === mask.pathCellCount` every mask path cell is already on the
 * path, so `pathIndex[neighbour]` is never `-1` again — growth moves and
 * mixing moves are the same code, mixing just runs once growth stops
 * happening on its own.
 *
 * Growth alone can permanently trap: once the covered cells wall off an
 * uncovered pocket so that no cell adjacent to it can ever occupy an endpoint
 * position, no sequence of backbite moves reaches it, because the moves only
 * reorder the *covered* vertex set — they never touch the uncovered one. The
 * fix is the standard one: detect a long run of moves with no growth and
 * restart from a fresh random start cell. See DEFAULT_STALL_LIMIT_PER_CELL for
 * the measured effect, which is real but modest, not the difference between
 * working and not.
 */

import { DIRECTIONS, NO_CELL, directionBetween, parityOf, step as gridStep } from '../grid.js';
import type { Rng } from '../rng.js';
import type { HamiltonianPath, Mask } from '../types.js';
import { floodFillCount } from './floodFill.js';

export interface BackbiteOk {
  readonly ok: true;
  readonly path: HamiltonianPath;
  /** Growth + mixing moves actually taken. Reported for the tuning sweep in issue #6. */
  readonly moves: number;
}

export interface BackbiteFailed {
  readonly ok: false;
  readonly reason: string;
}

export type BackbiteResult = BackbiteOk | BackbiteFailed;

/**
 * Mixing moves run after growth first completes, to move the path away from
 * whatever order growth happened to produce and toward near-uniform among
 * Hamiltonian paths on the region. Scaled by cell count because a bigger
 * region needs more moves to mix by the same relative amount.
 *
 * 8x is deliberately small next to growth's own cost (see
 * DEFAULT_MAX_GROWTH_MOVES_PER_CELL — growth alone typically runs 10-60x
 * `pathCellCount` moves, more on hard shapes), so the default mixing pass
 * adds only a modest fraction to total moves while still visibly reshuffling
 * a board that already covers every cell.
 */
export const DEFAULT_MIXING_MOVES_PER_CELL = 8;

/**
 * Upper bound on growth moves before giving up, as a multiple of
 * `pathCellCount`. Growth is a randomized process with no worst-case bound in
 * theory, so this is a time box, not an estimate — it exists purely to turn a
 * pathological region into a clean `ok: false` instead of a runaway loop.
 *
 * Measured growth-to-completion cost (moves / pathCellCount, successful
 * attempts only, 15 seeds per shape) grows with region size and varies a lot
 * by shape: full rectangles ~7.5x mean / ~13x max at 10x10, rising to ~26x
 * mean / ~48-56x max at 100x100; a rectangle with 3 parity-legal holes goes
 * higher, ~57x mean / ~113x max at 100x100. A narrow ring (a 2-cell-wide
 * border band — the hardest shape found, well outside what a real silhouette
 * looks like) reached ~161x mean / ~377x max at 100x100 and, on one seed in
 * fifteen, exhausted this exact 400x budget. So 400x is not a comfortable
 * multiple above every shape this method could ever see, only above every
 * *realistic* one measured; a region that exhausts it reports `ok: false` and
 * the generator pipeline retries with a new seed rather than blocking on this
 * call succeeding, which is the intended escape hatch for the shapes this
 * margin does not cover.
 *
 * The move-count box is exact and deterministic, but each move costs up to
 * O(pathCellCount) (the reversal), so wall-clock cost is at worst quadratic in
 * `pathCellCount` even after the per-move fix in this file. Lowering this
 * default further would not help the case that actually costs the most wall
 * clock time — an infeasible region — since findInfeasibility now rejects
 * those in O(pathCellCount) before any of this budget is spent; it would only
 * cost success rate on the legitimate hard shapes above.
 */
export const DEFAULT_MAX_GROWTH_MOVES_PER_CELL = 400;

/**
 * Consecutive moves with no growth before abandoning the current attempt and
 * restarting from a fresh random cell (see the file header on trapping).
 *
 * Not tuned to an observed trapping threshold — sweeping this from 1x to 120x
 * `pathCellCount` on the 80-case property-test corpus in
 * backbite.property.test.ts produces the identical 76/80 pass rate at every
 * setting, and disabling restarts entirely (stallLimit so large it never
 * fires) drops that to 74/80 — restarts fix exactly 2 of the 80 cases,
 * regardless of how generous the limit is otherwise. Restarting is real,
 * cheap insurance (a restart costs one O(pathCellCount) array reset,
 * negligible next to the move budget above) for whatever fraction of regions
 * do trap, but this codebase has not found an input where the exact limit
 * matters; 60x is simply a value comfortably larger than the handful of moves
 * a healthy attempt needs between growth events, chosen so restarts fire on
 * genuine stalls and not on ordinary slow patches.
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
   * Check path invariants after every move, not only at the end (issue #6 AC).
   * O(pathCellCount) per move, so it is opt-in — tests and property tests turn
   * it on; nothing in `src/core` enables it by default, so production pays
   * nothing for it.
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
 * fails that is reported as `ok: false`, not thrown.
 */
export function buildBackbitePath(
  mask: Mask,
  rng: Rng,
  options: BackbiteOptions = {},
): BackbiteResult {
  const target = mask.pathCellCount;
  if (target === 0) return { ok: true, path: { cells: new Uint32Array(0) }, moves: 0 };

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
  const stallLimit = options.stallLimit ?? DEFAULT_STALL_LIMIT_PER_CELL * target;
  const validateEveryMove = options.validateEveryMove ?? false;

  const pathCells = new Uint32Array(target);
  const pathIndex = new Int32Array(size).fill(-1);

  const restart = (): void => {
    pathIndex.fill(-1);
    const start = pathCellList[rng.int(target)] as number;
    pathCells[0] = start;
    pathIndex[start] = 0;
  };
  restart();
  let length = 1;

  // Reused per-move scratch for the endpoint's candidate neighbours, so the
  // hot loop does not allocate — the same discipline spanningTree.ts uses.
  const candidates = new Int32Array(4);

  let moves = 0;
  let movesSinceGrowth = 0;
  while (length < target) {
    if (moves >= maxGrowthMoves) {
      return {
        ok: false,
        reason:
          `backbite did not grow to a Hamiltonian path within ${maxGrowthMoves} moves ` +
          `(reached ${length} of ${target} cells) — the region may not be one 4-connected ` +
          'piece under the path-cell rule, or a path cell may have no path-cell neighbour',
      };
    }
    if (movesSinceGrowth >= stallLimit) {
      // Growth trapped itself: some uncovered pocket is walled off from both
      // current endpoints and every reachable reordering of them (see file
      // header). Restarting from a new cell is cheap next to the budget above
      // and empirically resolves most such cases.
      restart();
      length = 1;
      movesSinceGrowth = 0;
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

  return { ok: true, path: { cells: pathCells }, moves };
}

/**
 * Cheap necessary conditions for a Hamiltonian path to exist at all, checked
 * up front so an actually-infeasible region fails immediately instead of
 * burning the growth budget on restarts that can never succeed:
 *
 *   - Checkerboard parity (docs/CONTRACTS.md's `|black - white| <= 1`): a
 *     Hamiltonian path alternates colour on every step, so its two colour
 *     counts can differ by at most one no matter how it is routed. This is
 *     the cheapest check and also the one that matters most in practice — an
 *     imbalanced region is unsolvable by any routing at all, but without this
 *     check growth cannot know that and instead retries until the move
 *     budget runs out (measured: 28s at 100x100 for a 3-cell imbalance).
 *   - A path cell with zero path-cell neighbours can never be reached at all.
 *   - A path cell with exactly one path-cell neighbour (a dead end) can only
 *     ever be a path *endpoint* — there is only room for two of those.
 *   - The path cells are not one 4-connected piece.
 *
 * None of these is sufficient (plenty of regions that pass all four still
 * have no Hamiltonian path), so passing this does not guarantee growth
 * succeeds — it only means growth is not provably doomed before it starts.
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
 * length. See the file header for the derivation of which arc gets reversed.
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
    // Growth. The tail has no O(1) prepend, so relabel it as the head first —
    // see the file header on why this is rare relative to the total move
    // count, not paid on every move.
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
 * The S2 postconditions restricted to a path still under construction: no
 * repeats, every entry a mask path cell, consecutive entries 4-neighbours.
 * `cells.length === pathCellCount` is checked by the caller once growth ends,
 * since it is not true of a partial path by definition.
 *
 * Lives here rather than in test/fixtures/postconditions.ts because it runs
 * inside the algorithm (opt-in via `validateEveryMove`), and src/core cannot
 * depend on test code.
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
