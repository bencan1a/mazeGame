/**
 * Synthetic `HamiltonianPath` fixtures. A boustrophedon walk is Hamiltonian
 * over any full rectangle and correct by inspection, which is why the fixtures
 * cover only rectangles.
 */

import { directionBetween } from '../../src/core/grid.js';
import type { HamiltonianPath, Mask } from '../../src/core/types.js';
import { pathViolations } from './postconditions.js';

/**
 * A boustrophedon path over a mask whose cells are a full rectangle. Throws on
 * anything else: a hole or an unvisited cell breaks the serpentine's
 * 4-adjacency.
 */
export function makePath(mask: Mask): HamiltonianPath {
  const full = mask.width * mask.height;
  if (mask.pathCellCount !== full) {
    const outside = countWhere(mask.inside, 0);
    const unvisited = countWhere(mask.unvisited, 1);
    throw new Error(
      `makePath covers full rectangles only: ${mask.width}x${mask.height} has ` +
        `${outside} outside and ${unvisited} unvisited cell(s). ` +
        `Use makeMask({ width, height }), or makePathFromCells to supply a walk yourself.`,
    );
  }

  const cells = new Uint32Array(full);
  let at = 0;
  for (let y = 0; y < mask.height; y++) {
    // Odd rows run east-to-west, so the row change is always a single step.
    for (let n = 0; n < mask.width; n++) {
      const x = y % 2 === 0 ? n : mask.width - 1 - n;
      cells[at++] = y * mask.width + x;
    }
  }
  return { cells };
}

/**
 * Wrap a hand-written walk as a path, checking the postconditions. Checking a
 * Hamiltonian path is trivial where constructing one is not, so this checks
 * yours rather than inventing one.
 */
export function makePathFromCells(mask: Mask, cells: Iterable<number>): HamiltonianPath {
  const path: HamiltonianPath = { cells: Uint32Array.from(cells) };
  const violations = pathViolations(path, mask);
  if (violations.length > 0) {
    throw new Error(
      `makePathFromCells got a walk that is not a path:\n  ${violations.join('\n  ')}`,
    );
  }
  return path;
}

/** Direction of each step of a path, for tests that care about turns. */
export function pathDirections(path: HamiltonianPath, mask: Mask): number[] {
  const dirs: number[] = [];
  for (let i = 1; i < path.cells.length; i++) {
    dirs.push(directionBetween(path.cells[i - 1] as number, path.cells[i] as number, mask.width));
  }
  return dirs;
}

function countWhere(array: Uint8Array, value: number): number {
  let n = 0;
  for (let i = 0; i < array.length; i++) if (array[i] === value) n++;
  return n;
}
