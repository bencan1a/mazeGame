/**
 * Morphological open (PRD §4.2 step 1.3): erode then dilate. This is the
 * load-bearing repair step — it amputates 1-cell-wide spurs and severs
 * hairline necks, both of which can make a Hamiltonian path impossible (a
 * spur cell has only one inside neighbour, so no path can pass through it).
 *
 * Structuring element: the 4-connected "plus" (a cell and its N/E/S/W
 * neighbours, no diagonals) — the same neighbourhood every other 4-connected
 * invariant in this codebase uses (`docs/CONTRACTS.md`), so a cell that
 * survives erosion is exactly one with all four 4-neighbours already inside.
 * Off-grid counts as "not inside", so a cell on the grid border can never
 * have all four neighbours present and always erodes away; that is a
 * deliberate consequence of the plus SE, not a bug to special-case.
 *
 * Opening (erode then dilate with the *same* SE) is anti-extensive — its
 * result is always a subset of the input.
 */

import { DIRECTIONS, NO_CELL, step } from '../grid.js';
import type { Blob } from './blob.js';

export function erode(grid: Blob): Blob {
  const { width, height, inside } = grid;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] !== 1) continue;
    out[i] = DIRECTIONS.every((dir) => {
      const n = step(i, dir, width, height);
      return n !== NO_CELL && inside[n] === 1;
    })
      ? 1
      : 0;
  }
  return { width, height, inside: out };
}

export function dilate(grid: Blob): Blob {
  const { width, height, inside } = grid;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] === 1) {
      out[i] = 1;
      continue;
    }
    out[i] = DIRECTIONS.some((dir) => {
      const n = step(i, dir, width, height);
      return n !== NO_CELL && inside[n] === 1;
    })
      ? 1
      : 0;
  }
  return { width, height, inside: out };
}

/** Erode then dilate with the plus structuring element documented above. */
export function morphologicalOpen(grid: Blob): Blob {
  return dilate(erode(grid));
}
