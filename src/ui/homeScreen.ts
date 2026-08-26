/**
 * Pure logic behind the home screen: cycling the library index with wrap, and
 * picking a shape's colour, both testable without a canvas.
 */

import { PALETTE, PALETTE_SIZE } from '../render/palette.js';

/** Wraps `index` into `[0, count)`. `count <= 0` has no valid index, so it settles on 0. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export function previousIndex(index: number, count: number): number {
  return wrapIndex(index - 1, count);
}

export function nextIndex(index: number, count: number): number {
  return wrapIndex(index + 1, count);
}

export function isResumeShape(shapeId: string, resumeShapeId: string | null): boolean {
  return resumeShapeId !== null && shapeId === resumeShapeId;
}

/** One palette hue per shape index, so cycling the library also cycles the drawing's colour. */
export function inkFillColor(shapeIndex: number): string {
  return PALETTE[wrapIndex(shapeIndex, PALETTE_SIZE)] as string;
}
