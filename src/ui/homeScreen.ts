/**
 * Pure logic behind the home screen: library index cycling with wrap, and
 * turning an ink bitmap into pixel colour so the drawing can be tested
 * without a canvas.
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

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/** One palette hue per shape index, so cycling the library also cycles the drawing's colour. */
export function inkFillColor(shapeIndex: number): string {
  return PALETTE[wrapIndex(shapeIndex, PALETTE_SIZE)] as string;
}

/**
 * The ink bitmap as RGBA bytes ready for an `ImageData`. Ink pixels are the
 * strokes, which stay empty on the board, so they go fully transparent
 * rather than a drawn colour — the page background shows through them
 * exactly as it will once the board is playable. The enclosed faces around
 * the ink take the fill colour, since those are what the segments tile.
 */
export function facesToRgba(inside: Uint8Array, fill: Rgb): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(inside.length * 4);
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] !== 1) continue;
    const offset = i * 4;
    rgba[offset] = fill.r;
    rgba[offset + 1] = fill.g;
    rgba[offset + 2] = fill.b;
    rgba[offset + 3] = 255;
  }
  return rgba;
}
