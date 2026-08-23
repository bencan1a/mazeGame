/**
 * Morphological open: erode then dilate, with the 4-connected "plus"
 * structuring element, so a cell survives erosion exactly when all four of its
 * 4-neighbours are inside.
 *
 * Off-grid counts as "not inside", so a border cell can never have all four
 * present and always erodes away. That is a consequence of the plus element,
 * not a case to special-case.
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

/** Erode then dilate with the same structuring element. */
export function morphologicalOpen(grid: Blob): Blob {
  return dilate(erode(grid));
}
