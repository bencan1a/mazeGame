/**
 * A non-ink cell the flood from the border cannot reach is enclosed, so the
 * faces are everything the flood misses. Repair rejects a blob with anything
 * in the leftover row or column of an odd grid, so that strip is cleared here
 * too.
 */

import { DIRECTIONS, NO_CELL, isBorder, step } from '../grid.js';

export interface FaceExtraction {
  /** 1 = enclosed face (becomes `Blob.inside`), 0 = ink or background. */
  readonly inside: Uint8Array;
  /** Number of 4-connected faces found, 0 when the drawing leaked. */
  readonly faceCount: number;
}

export function extractFaces(ink: Uint8Array, width: number, height: number): FaceExtraction {
  const size = width * height;
  const reached = floodFromBorder(ink, width, height);

  const inside = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (ink[i] !== 1 && reached[i] !== 1) inside[i] = 1;
  }
  clearLeftoverStrip(inside, width, height);

  return { inside, faceCount: countComponents(inside, width, height) };
}

function floodFromBorder(ink: Uint8Array, width: number, height: number): Uint8Array {
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
  return reached;
}

/**
 * `repairMask` downsamples in whole 2x2 blocks at lattice offset (0, 0); an
 * odd width or height leaves a trailing row or column no block covers, and
 * `repairMask` throws on a face cell there. Clearing it here keeps that
 * failure out of the caller's hands.
 */
function clearLeftoverStrip(inside: Uint8Array, width: number, height: number): void {
  const coveredWidth = Math.floor(width / 2) * 2;
  const coveredHeight = Math.floor(height / 2) * 2;
  for (let y = 0; y < height; y++) {
    const yCovered = y < coveredHeight;
    if (yCovered && coveredWidth === width) continue;
    for (let x = yCovered ? coveredWidth : 0; x < width; x++) {
      inside[y * width + x] = 0;
    }
  }
}

function countComponents(inside: Uint8Array, width: number, height: number): number {
  const seen = new Uint8Array(inside.length);
  let count = 0;
  for (let start = 0; start < inside.length; start++) {
    if (inside[start] === 0 || seen[start] === 1) continue;
    count++;
    seen[start] = 1;
    const stack = [start];
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      for (const dir of DIRECTIONS) {
        const next = step(cell, dir, width, height);
        if (next === NO_CELL || inside[next] === 0 || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return count;
}
