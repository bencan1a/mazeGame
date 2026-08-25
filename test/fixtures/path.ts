/**
 * Synthetic `HamiltonianPath` fixtures. A boustrophedon walk is Hamiltonian
 * over any full rectangle and correct by inspection, which is why the fixtures
 * cover only rectangles.
 *
 * Both builders produce a single-region path. A multi-region walk is built by
 * concatenating single-region ones with `joinRegionPaths`.
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
  return { cells, regionStart: Uint32Array.from([0, full]) };
}

/**
 * Wrap a hand-written walk as a path, checking the postconditions. Checking a
 * Hamiltonian path is trivial where constructing one is not, so this checks
 * yours rather than inventing one.
 */
export function makePathFromCells(mask: Mask, cells: Iterable<number>): HamiltonianPath {
  const walk = Uint32Array.from(cells);
  const path: HamiltonianPath = { cells: walk, regionStart: Uint32Array.from([0, walk.length]) };
  const violations = pathViolations(path, mask);
  if (violations.length > 0) {
    throw new Error(
      `makePathFromCells got a walk that is not a path:\n  ${violations.join('\n  ')}`,
    );
  }
  return path;
}

/**
 * One path per region, in the order given. Each input must be a single-region
 * walk; the result carries the region boundaries the peel needs.
 */
export function joinRegionPaths(regions: readonly HamiltonianPath[]): HamiltonianPath {
  let total = 0;
  for (const region of regions) total += region.cells.length;
  const cells = new Uint32Array(total);
  const regionStart = new Uint32Array(regions.length + 1);
  let written = 0;
  for (let r = 0; r < regions.length; r++) {
    const region = regions[r] as HamiltonianPath;
    if (region.regionStart.length !== 2) {
      throw new Error(
        `joinRegionPaths: input ${r} has ${region.regionStart.length - 1} regions, expected 1`,
      );
    }
    cells.set(region.cells, written);
    written += region.cells.length;
    regionStart[r + 1] = written;
  }
  return { cells, regionStart };
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
