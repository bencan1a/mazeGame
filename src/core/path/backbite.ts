/**
 * Backbite: the fallback Hamiltonian path builder (PRD 4.2 step 2,
 * docs/CONTRACTS.md `Mask -> HamiltonianPath`), for regions the spanning-tree
 * contour method (contour.ts) cannot tile into 2x2 blocks — expected to be
 * common, since parity absorption (#4) can leave an `unvisited` hole that
 * breaks tiling without breaking connectivity.
 *
 * The path is kept as a position array `pathCells` (the walk, in order) plus
 * its inverse `pathIndex` (cell -> position, -1 if the cell is not yet on the
 * path). Every move operates on the current head, `pathCells[length - 1]`:
 * pick a uniformly random 4-neighbour of the head that the mask allows on the
 * path at all (on-path or not).
 *
 *   - Not yet on the path (`pathIndex[neighbour] === -1`): append it. This is
 *     growth; it is the only way `length` increases.
 *   - Already on the path at position `p`: adding the edge (head, neighbour)
 *     closes a cycle through positions `p..length-1`. The only rewrite that
 *     turns that back into a simple path is to reverse the subarray
 *     `pathCells[p+1 .. length-1]` in place — this drops the old edge
 *     `(p, p+1)`, keeps every other edge, and adds exactly the new one. When
 *     `p === length - 2`, "the old edge at p+1" *is* the edge we were about to
 *     add, so the reversal is a length-1 no-op: picking the head's current
 *     path-neighbour again is legal and simply does nothing.
 *
 * A move at the *other* endpoint (`pathCells[0]`) needs the mirror-image
 * rewrite (reverse `pathCells[0 .. p-1]`). Rather than duplicate the branch,
 * each move first reverses the whole array with 50/50 probability, which
 * relabels "the other endpoint" as `pathCells[length - 1]` and lets every move
 * use the single head-only rewrite above. That reversal is the same
 * O(length) cost the move already pays for the subarray case, so it does not
 * change the asymptotics.
 *
 * Once `length === mask.pathCellCount` every mask path cell is already on the
 * path, so `pathIndex[neighbour]` is never `-1` again — growth moves and
 * mixing moves are the same code, mixing just runs once growth stops
 * happening on its own.
 *
 * Growth alone can permanently trap on branchy or peninsula-heavy regions:
 * once the covered cells wall off an uncovered pocket so that no cell
 * adjacent to it can ever occupy an endpoint position, no sequence of
 * backbite moves reaches it, because the moves only reorder the *covered*
 * vertex set — they never touch the uncovered one. The measured sweep for
 * this issue hit exactly this on an irregular ~45%-fill blob, permanently
 * stuck partway with zero progress over 50 million further moves. The fix
 * used here is the standard one: detect a long run with no growth and
 * restart from a fresh random start cell, which almost always avoids
 * whatever the previous walk trapped itself against.
 */

import { DIRECTIONS, NO_CELL, directionBetween, step as gridStep } from '../grid.js';
import type { Rng } from '../rng.js';
import type { HamiltonianPath, Mask } from '../types.js';

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
 * Chosen from the sweep in issue #6 (`test/fixtures` shapes and random
 * irregular regions, sizes 20..100): growth itself averages a small multiple
 * of `pathCellCount` moves, so a mixing budget of the same order is cheap
 * relative to growth while still visibly reshuffling small boards.
 */
export const DEFAULT_MIXING_MOVES_PER_CELL = 8;

/**
 * Upper bound on growth moves before giving up, as a multiple of
 * `pathCellCount`. Growth is a randomized process with no worst-case bound in
 * theory, so this is a time box, not an estimate — it exists purely to turn a
 * pathological region into a clean `ok: false` instead of a runaway loop.
 * Sized from the sweep in issue #6: a full rectangle needs on the order of
 * 10-25x `pathCellCount` moves, a region with a few parity-absorption holes
 * or an irregular non-tileable shape typically 20-110x, and the worst
 * (non-degenerate) region seen needed close to 180x. This is set well above
 * that observed ceiling so a solvable region essentially never hits it; a
 * region that does is a genuine "report and let the caller retry with a new
 * seed" case, per docs/CONTRACTS.md and the retry the generator pipeline
 * already does on any generation failure.
 */
export const DEFAULT_MAX_GROWTH_MOVES_PER_CELL = 400;

/**
 * Consecutive moves with no growth before abandoning the current attempt and
 * restarting from a fresh random cell (see the file header on trapping).
 * Sized from the same sweep: successful attempts on hard shapes kept growing
 * within a small multiple of `pathCellCount` moves of any given length, so a
 * stall well beyond that is a trap, not merely a slow patch.
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
 * 4-connected component, no path cell with zero path-cell neighbours. A
 * region that fails that is reported as `ok: false`, not thrown.
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

  // Reused per-move scratch for the head's candidate neighbours, so the hot
  // loop does not allocate — the same discipline spanningTree.ts uses.
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
      // and empirically resolves it.
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
 * Two cheap necessary conditions for a Hamiltonian path to exist at all, checked
 * up front so an actually-infeasible region fails immediately instead of
 * burning the whole growth budget on restarts that can never succeed:
 *
 *   - A path cell with zero path-cell neighbours can never be reached at all.
 *   - A path cell with exactly one path-cell neighbour (a dead end) can only
 *     ever be a path *endpoint* — there is only room for two of those.
 *
 * Neither condition is sufficient (plenty of regions that pass both still have
 * no Hamiltonian path), so passing this does not guarantee growth succeeds —
 * it only means growth is not provably doomed before it starts.
 */
function findInfeasibility(
  isPathCell: Uint8Array,
  pathCellList: Uint32Array,
  width: number,
  height: number,
): string | null {
  let deadEnds = 0;
  for (let k = 0; k < pathCellList.length; k++) {
    const cell = pathCellList[k] as number;
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
  if (deadEnds > 2) {
    return (
      `${deadEnds} path cells have exactly one path-cell neighbour; a Hamiltonian path has ` +
      'only two endpoints, so more than two dead ends makes the region infeasible'
    );
  }

  const reached = floodFillPathCells(isPathCell, pathCellList[0] as number, width, height);
  if (reached !== pathCellList.length) {
    return (
      `path cells are not one 4-connected piece: reached ${reached} of ${pathCellList.length} ` +
      'from the first cell'
    );
  }

  return null;
}

function floodFillPathCells(
  isPathCell: Uint8Array,
  start: number,
  width: number,
  height: number,
): number {
  const seen = new Uint8Array(isPathCell.length);
  seen[start] = 1;
  const stack = [start];
  let count = 1;
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    for (const dir of DIRECTIONS) {
      const next = gridStep(cur, dir, width, height);
      if (next === NO_CELL || seen[next] === 1 || isPathCell[next] !== 1) continue;
      seen[next] = 1;
      count++;
      stack.push(next);
    }
  }
  return count;
}

/** One growth-or-backbite move at a randomly chosen end. Returns the new length. */
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
  // Relabels "the other endpoint" as pathCells[length - 1] — see file header.
  if (rng.chance(0.5)) reverseRange(pathCells, pathIndex, 0, length - 1);

  const head = pathCells[length - 1] as number;
  let count = 0;
  for (const dir of DIRECTIONS) {
    const neighbour = gridStep(head, dir, width, height);
    if (neighbour !== NO_CELL && isPathCell[neighbour] === 1) candidates[count++] = neighbour;
  }
  if (count === 0) return length;

  const neighbour = candidates[rng.int(count)] as number;
  const p = pathIndex[neighbour] as number;

  if (p === -1) {
    pathCells[length] = neighbour;
    pathIndex[neighbour] = length;
    return length + 1;
  }
  if (p === length - 2) return length; // reproduces the head's current edge; no-op.

  reverseRange(pathCells, pathIndex, p + 1, length - 1);
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
