/**
 * The postconditions from docs/CONTRACTS.md, as checkers.
 *
 * Each returns a list of human-readable violations; empty means clean. They
 * return rather than throw so a test can assert on the whole list, and so a
 * deliberately-broken fixture can be checked for exactly the breakage it is
 * supposed to have.
 *
 * These check *fixtures*. They are not `validateBoard` (S4, src/core/validate)
 * — that one throws, runs in dev, and computes metrics on the way through. When
 * it lands it should be tested against these fixtures, not against this file.
 */

import { DIRECTIONS, NO_CELL, directionBetween, parityOf, step } from '../../src/core/grid.js';
import type { Board, Direction, HamiltonianPath, Mask } from '../../src/core/types.js';

/** Postconditions of `buildMask` (S1). */
export function maskViolations(mask: Mask): string[] {
  const out: string[] = [];
  const { width, height, inside, unvisited } = mask;
  const size = width * height;

  if (inside.length !== size) out.push(`inside has ${inside.length} cells, expected ${size}`);
  if (unvisited.length !== size) {
    out.push(`unvisited has ${unvisited.length} cells, expected ${size}`);
  }

  let insideCount = 0;
  let unvisitedCount = 0;
  let pathCells = 0;
  let black = 0;
  let white = 0;
  let seed = NO_CELL;
  for (let i = 0; i < size; i++) {
    if (inside[i] !== 1) {
      if (unvisited[i] === 1) out.push(`cell ${i} is unvisited but not inside`);
      continue;
    }
    insideCount++;
    if (seed === NO_CELL) seed = i;
    if (unvisited[i] === 1) {
      unvisitedCount++;
    } else {
      pathCells++;
      if (parityOf(i, width) === 0) black++;
      else white++;
    }
  }

  if (mask.pathCellCount !== pathCells) {
    out.push(`pathCellCount is ${mask.pathCellCount}, counted ${pathCells}`);
  }
  if (Math.abs(black - white) > 1) {
    out.push(`checkerboard parity is off by ${Math.abs(black - white)} (${black} vs ${white})`);
  }
  if (unvisitedCount > 3) out.push(`${unvisitedCount} unvisited cells, at most 3 expected`);
  if (insideCount === 0) {
    out.push('mask has no inside cells');
    return out;
  }

  // One 4-connected component.
  const reached = floodFill(seed, (i) => inside[i] === 1, width, height);
  if (reached !== insideCount) {
    out.push(`inside has more than one component: reached ${reached} of ${insideCount} cells`);
  }

  // A 1-cell spur is a dead end that can make a Hamiltonian path impossible.
  for (let i = 0; i < size; i++) {
    if (inside[i] !== 1) continue;
    let neighbours = 0;
    for (const dir of DIRECTIONS) {
      const n = step(i, dir, width, height);
      if (n !== NO_CELL && inside[n] === 1) neighbours++;
    }
    if (neighbours < 2) out.push(`cell ${i} has ${neighbours} inside neighbour(s), expected >= 2`);
  }

  return out;
}

/** Postconditions of `buildPath` (S2). */
export function pathViolations(path: HamiltonianPath, mask: Mask): string[] {
  const out: string[] = [];
  const { cells } = path;

  if (cells.length !== mask.pathCellCount) {
    out.push(`path has ${cells.length} cells, mask.pathCellCount is ${mask.pathCellCount}`);
  }

  const seen = new Set<number>();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as number;
    if (cell < 0 || cell >= mask.width * mask.height) {
      out.push(`path[${i}] = ${cell} is outside the grid`);
      continue;
    }
    if (seen.has(cell)) out.push(`path visits cell ${cell} more than once (at index ${i})`);
    seen.add(cell);
    if (mask.inside[cell] !== 1) out.push(`path[${i}] = ${cell} is outside the mask`);
    if (mask.unvisited[cell] === 1) out.push(`path[${i}] = ${cell} is an unvisited cell`);
    if (i > 0) {
      const prev = cells[i - 1] as number;
      if (directionBetween(prev, cell, mask.width) === -1) {
        out.push(`path[${i - 1}] = ${prev} and path[${i}] = ${cell} are not 4-neighbours`);
      }
    }
  }

  return out;
}

/**
 * Everything a Board must satisfy regardless of whether its blocking digraph is
 * acyclic. The deliberately cyclic fixtures must still pass this — otherwise
 * they would not be a fair test of the cycle check.
 */
export function boardStructureViolations(board: Board): string[] {
  const out: string[] = [];
  const n = board.segmentCount;
  const size = board.width * board.height;

  if (board.occupancy.length !== size) {
    out.push(`occupancy has ${board.occupancy.length} cells, expected ${size}`);
  }
  if (board.segStart.length !== n + 1) {
    out.push(`segStart has ${board.segStart.length} entries, expected ${n + 1}`);
  }
  if (board.segHead.length !== n) out.push(`segHead has ${board.segHead.length}, expected ${n}`);
  if (board.segDir.length !== n) out.push(`segDir has ${board.segDir.length}, expected ${n}`);
  if (board.segColor.length !== n) out.push(`segColor has ${board.segColor.length}, expected ${n}`);
  if (board.edgeStart.length !== n + 1) {
    out.push(`edgeStart has ${board.edgeStart.length} entries, expected ${n + 1}`);
  }
  if (out.length > 0) return out;

  if (board.segStart[0] !== 0)
    out.push(`segStart[0] is ${board.segStart[0] as number}, expected 0`);
  if (board.segStart[n] !== board.segCells.length) {
    out.push(
      `segStart[${n}] is ${board.segStart[n] as number}, segCells has ${board.segCells.length}`,
    );
  }
  if (board.edgeStart[0] !== 0) {
    out.push(`edgeStart[0] is ${board.edgeStart[0] as number}, expected 0`);
  }
  if (board.edgeStart[n] !== board.edgeTarget.length) {
    out.push(
      `edgeStart[${n}] is ${board.edgeStart[n] as number}, edgeTarget has ${board.edgeTarget.length}`,
    );
  }

  let covered = 0;
  for (let i = 0; i < size; i++) {
    const id = board.occupancy[i] as number;
    if (id === 0) continue;
    covered++;
    if (id > n) out.push(`occupancy[${i}] = ${id} is not a valid segment id (1..${n})`);
  }
  if (covered !== board.segCells.length) {
    out.push(`${covered} occupied cells but segCells has ${board.segCells.length} entries`);
  }

  for (let id = 1; id <= n; id++) {
    const from = board.segStart[id - 1] as number;
    const to = board.segStart[id] as number;
    if (to <= from) {
      out.push(`segment ${id} is empty`);
      continue;
    }
    for (let k = from; k < to; k++) {
      const cell = board.segCells[k] as number;
      if (board.occupancy[cell] !== id) {
        out.push(
          `segment ${id} claims cell ${cell} but occupancy says ${board.occupancy[cell] as number}`,
        );
      }
      if (k > from) {
        const prev = board.segCells[k - 1] as number;
        if (directionBetween(prev, cell, board.width) === -1) {
          out.push(`segment ${id} is not a walk: ${prev} and ${cell} are not 4-neighbours`);
        }
      }
    }

    // segCells runs tail -> head, so the head is the last cell and segDir is the
    // direction of the stroke that arrives at it.
    const head = board.segCells[to - 1] as number;
    if (board.segHead[id - 1] !== head) {
      out.push(`segment ${id} head is ${board.segHead[id - 1] as number}, last cell is ${head}`);
    }
    if (to - from >= 2) {
      const before = board.segCells[to - 2] as number;
      const stroke = directionBetween(before, head, board.width);
      if (stroke !== board.segDir[id - 1]) {
        out.push(
          `segment ${id} exits ${board.segDir[id - 1] as number} but its terminal stroke is ${stroke}`,
        );
      }
    }

    const declared = blockersOf(board, id);
    const badTarget = declared.find((target) => target < 1 || target > n);
    if (badTarget !== undefined) {
      out.push(`segment ${id} blocks on ${badTarget}, which is not a segment id (1..${n})`);
      continue;
    }
    if (new Set(declared).size !== declared.length) {
      // The contract de-duplicates: a long segment crossing the ray twice is one
      // edge, so a repeat would double-count in any traversal of the digraph.
      out.push(`segment ${id} lists a blocker twice: [${declared.join(', ')}]`);
      continue;
    }
    if (!isDirection(board.segDir[id - 1] as number)) {
      out.push(`segment ${id} has direction ${board.segDir[id - 1] as number}, expected 0..3`);
      continue;
    }

    const derived = rayBlockers(board, id);
    if (!sameSet(derived, declared)) {
      out.push(
        `segment ${id} blockers are [${declared.join(', ')}], the ray hits [${derived.join(', ')}]`,
      );
    }
  }

  // Adjacent segments must be visually distinguishable (S3 colouring).
  for (let i = 0; i < size; i++) {
    const id = board.occupancy[i] as number;
    if (id === 0) continue;
    for (const dir of [1, 2] as Direction[]) {
      const n2 = step(i, dir, board.width, board.height);
      if (n2 === NO_CELL) continue;
      const other = board.occupancy[n2] as number;
      if (other === 0 || other === id) continue;
      if (board.segColor[id - 1] === board.segColor[other - 1]) {
        out.push(
          `segments ${id} and ${other} touch and share colour ${board.segColor[id - 1] as number}`,
        );
      }
    }
  }

  return out;
}

/** Board and Mask have to describe the same silhouette for validateBoard to mean anything. */
export function boardMaskViolations(board: Board, mask: Mask): string[] {
  const out: string[] = [];
  if (board.width !== mask.width || board.height !== mask.height) {
    out.push(`board is ${board.width}x${board.height}, mask is ${mask.width}x${mask.height}`);
    return out;
  }
  let covered = 0;
  for (let i = 0; i < board.occupancy.length; i++) {
    if ((board.occupancy[i] as number) === 0) continue;
    covered++;
    if (mask.inside[i] !== 1) out.push(`cell ${i} is occupied but outside the mask`);
    if (mask.unvisited[i] === 1) out.push(`cell ${i} is occupied but marked unvisited`);
  }
  if (covered !== mask.pathCellCount) {
    out.push(`${covered} covered cells, mask.pathCellCount is ${mask.pathCellCount}`);
  }
  return out;
}

/**
 * The order a greedy clear removes segments in, or null if it stalls.
 *
 * An edge k -> j means j blocks k, so k is removable once every j it points at
 * is gone. Stalling is exactly a cycle in the blocking digraph, which is the
 * one thing orientation must never produce.
 */
export function greedyClearOrder(board: Board): number[] | null {
  const n = board.segmentCount;
  const remaining = new Uint32Array(n);
  const blockedBy: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let id = 1; id <= n; id++) {
    const targets = blockersOf(board, id);
    remaining[id - 1] = targets.length;
    for (const target of targets) {
      // An edge to a segment that does not exist can never be satisfied, so the
      // board is not clearable. Say so rather than throwing: this file reports.
      if (target < 1 || target > n) return null;
      (blockedBy[target] as number[]).push(id);
    }
  }

  const order: number[] = [];
  const queue: number[] = [];
  for (let id = 1; id <= n; id++) if (remaining[id - 1] === 0) queue.push(id);

  while (queue.length > 0) {
    const id = queue.shift() as number;
    order.push(id);
    for (const waiter of blockedBy[id] as number[]) {
      remaining[waiter - 1] = (remaining[waiter - 1] as number) - 1;
      if (remaining[waiter - 1] === 0) queue.push(waiter);
    }
  }

  return order.length === n ? order : null;
}

/** True when a greedy clear removes every segment. */
export function isAcyclic(board: Board): boolean {
  return greedyClearOrder(board) !== null;
}

/** The distinct other segments on segment `id`'s exit ray, in the order the ray meets them. */
export function rayBlockers(board: Board, id: number): number[] {
  const dir = board.segDir[id - 1] as Direction;
  // segDir is a Uint8Array, so a board can carry 255 (what -1 becomes) with no
  // type error to catch it. step() now answers NO_CELL for that (#38), so the
  // walk would simply find nothing — and "no blockers" reads as "this segment
  // is free", which is a worse answer than an error.
  if (!isDirection(dir)) {
    throw new Error(`segment ${id} has direction ${dir as number}, which is not one of 0..3`);
  }
  const found: number[] = [];
  const seen = new Set<number>();
  let cell = step(board.segHead[id - 1] as number, dir, board.width, board.height);
  while (cell !== NO_CELL) {
    const other = board.occupancy[cell] as number;
    // A segment's own body never blocks it — that is what makes a clear head a
    // guaranteed escape rather than a guess.
    if (other !== 0 && other !== id && !seen.has(other)) {
      seen.add(other);
      found.push(other);
    }
    cell = step(cell, dir, board.width, board.height);
  }
  return found;
}

/** The blocking edges declared for segment `id`. */
export function blockersOf(board: Board, id: number): number[] {
  const from = board.edgeStart[id - 1] as number;
  const to = board.edgeStart[id] as number;
  const out: number[] = [];
  for (let k = from; k < to; k++) out.push(board.edgeTarget[k] as number);
  return out;
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== a.length || setB.size !== b.length) return false;
  return [...setB].every((value) => setA.has(value));
}

function isDirection(dir: number): dir is Direction {
  return dir === 0 || dir === 1 || dir === 2 || dir === 3;
}

function floodFill(
  seed: number,
  isIn: (cell: number) => boolean,
  width: number,
  height: number,
): number {
  const seen = new Set<number>([seed]);
  const stack = [seed];
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    for (const dir of DIRECTIONS) {
      const next = step(cell, dir, width, height);
      if (next === NO_CELL || seen.has(next) || !isIn(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen.size;
}
