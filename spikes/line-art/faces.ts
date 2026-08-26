/**
 * Line art in, silhouette out: the strokes are the drawing and stay empty, and
 * the enclosed faces between them become the lobes the player fills.
 */

import { DIRECTIONS, NO_CELL, isBorder, step } from '../../src/core/grid.js';
import type { Blob } from '../../src/core/mask/index.js';

export interface FaceExtraction {
  readonly blob: Blob;
  /** Faces found before repair, largest first, in cells. */
  readonly faceSizes: readonly number[];
  /** Non-ink cells the border flood reached: the background. */
  readonly backgroundCells: number;
  readonly inkCells: number;
}

/**
 * A non-ink cell the flood from the border cannot reach is enclosed, so the
 * faces are everything the flood misses. Repair rejects a blob with anything
 * in the leftover row or column of an odd grid, so those are cleared here.
 */
export function facesFromInk(ink: Uint8Array, width: number, height: number): FaceExtraction {
  const size = width * height;
  const reached = new Uint8Array(size);
  const stack: number[] = [];

  for (let i = 0; i < size; i++) {
    if (ink[i] === 1 || reached[i] === 1 || !isBorder(i, width, height)) continue;
    reached[i] = 1;
    stack.push(i);
  }
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    for (const dir of DIRECTIONS) {
      const next = step(cell, dir, width, height);
      if (next === NO_CELL || ink[next] === 1 || reached[next] === 1) continue;
      reached[next] = 1;
      stack.push(next);
    }
  }

  const inside = new Uint8Array(size);
  let inkCells = 0;
  let backgroundCells = 0;
  for (let i = 0; i < size; i++) {
    if (ink[i] === 1) inkCells++;
    else if (reached[i] === 1) backgroundCells++;
    else inside[i] = 1;
  }

  const coveredWidth = Math.floor(width / 2) * 2;
  const coveredHeight = Math.floor(height / 2) * 2;
  for (let y = 0; y < height; y++) {
    for (let x = y < coveredHeight ? coveredWidth : 0; x < width; x++) inside[y * width + x] = 0;
  }

  return {
    blob: { width, height, inside },
    faceSizes: componentSizes(inside, width, height),
    backgroundCells,
    inkCells,
  };
}

function componentSizes(inside: Uint8Array, width: number, height: number): number[] {
  const seen = new Uint8Array(inside.length);
  const sizes: number[] = [];
  for (let start = 0; start < inside.length; start++) {
    if (inside[start] === 0 || seen[start] === 1) continue;
    let count = 0;
    seen[start] = 1;
    const stack = [start];
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      count++;
      for (const dir of DIRECTIONS) {
        const next = step(cell, dir, width, height);
        if (next === NO_CELL || inside[next] === 0 || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    sizes.push(count);
  }
  return sizes.sort((a, b) => b - a);
}

/**
 * Route 2: cut a solid shape into bands rather than sourcing a drawing. The
 * cuts run at `angle`, `spacing` cells apart, `strokeWidth` cells wide.
 */
export function cutSolid(
  solid: Uint8Array,
  width: number,
  height: number,
  spacing: number,
  strokeWidth: number,
  angle: number,
): Uint8Array {
  const ink = new Uint8Array(solid.length);
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const half = strokeWidth / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (solid[i] === 0) {
        ink[i] = 0;
        continue;
      }
      const projected = (x + 0.5) * nx + (y + 0.5) * ny;
      const offset = projected - Math.floor(projected / spacing) * spacing;
      ink[i] = offset < half || offset > spacing - half ? 1 : 0;
    }
  }
  // The shape's own boundary is a cut too, or the outermost band merges with
  // the background the moment the flood reaches it.
  for (let i = 0; i < solid.length; i++) if (solid[i] === 0) ink[i] = 1;
  return ink;
}
