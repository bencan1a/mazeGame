/**
 * Pixel -> cell -> segment hit testing.
 *
 * A direct hit reads `occupancy` once. When that cell is empty, out of
 * bounds, or the segment sitting on it is blocked, the radius search takes
 * over: it scans every cell in a bounding box around the tapped cell, wide
 * enough to cover the radius, and keeps the one whose square is closest to
 * the exact tap point — in CSS pixels, not cell count — among those whose
 * segment `isFree` accepts. A cell holding a blocked segment is skipped,
 * never returned as a fallback.
 */

import type { Board, SegmentId } from '../core/types.js';
import type { CssPixel, Viewport } from '../render/viewport.js';
import { cssPixelToCell } from '../render/viewport.js';

/** Injected rather than read from game state, so this module stays testable with no game state at all. */
export type FreePredicate = (id: SegmentId) => boolean;

export interface HitTestOptions {
  /** Search radius, in CSS pixels, measured from the tap point to each candidate cell's nearest edge. */
  readonly radiusCssPx?: number;
}

/** A fingertip-sized tolerance, in CSS pixels, independent of zoom. */
export const DEFAULT_TAP_RADIUS_CSS_PX = 24;

function requireNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number, got ${value}`);
  }
}

/**
 * Resolves a CSS-pixel tap to the nearest free segment within radius, or
 * `null` for a miss. Never returns a segment `isFree` rejects.
 *
 * A non-finite `point` (a `NaN` from a malformed pointer event) is a miss,
 * not a thrown error or an out-of-bounds cell read.
 */
export function hitTest(
  board: Board,
  viewport: Viewport<'css'>,
  point: CssPixel,
  isFree: FreePredicate,
  options?: HitTestOptions,
): SegmentId | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  const radiusCssPx = options?.radiusCssPx ?? DEFAULT_TAP_RADIUS_CSS_PX;
  requireNonNegativeFinite(radiusCssPx, 'radiusCssPx');

  const center = cssPixelToCell(viewport, point);
  if (isInBounds(board, center.x, center.y)) {
    const direct = board.occupancy[center.y * board.width + center.x] as SegmentId;
    if (direct !== 0 && isFree(direct)) return direct;
  }

  return nearestFreeInRadius(board, viewport, point, center.x, center.y, radiusCssPx, isFree);
}

function isInBounds(board: Board, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < board.width && y < board.height;
}

/**
 * Distance, along one axis, from `value` to the nearest edge of the span
 * `[start, start + size)` — 0 when `value` falls inside it.
 */
function clampedAxisDistance(value: number, start: number, size: number): number {
  if (value < start) return start - value;
  const end = start + size;
  if (value > end) return value - end;
  return 0;
}

/**
 * Bounds a box of candidate cells around `(cx, cy)`, then keeps the one
 * whose cell square is closest to `point`, in squared CSS-pixel distance,
 * among those `isFree` accepts. `reach` is deliberately one cell wider than
 * `radiusCssPx / scale` alone would give, since `point` can sit anywhere
 * inside cell `(cx, cy)`, including right on the edge of its farthest
 * reachable neighbour.
 */
function nearestFreeInRadius(
  board: Board,
  viewport: Viewport<'css'>,
  point: CssPixel,
  cx: number,
  cy: number,
  radiusCssPx: number,
  isFree: FreePredicate,
): SegmentId | null {
  if (radiusCssPx <= 0) return null;

  const reach = Math.floor(radiusCssPx / viewport.scale) + 1;
  const xMin = Math.max(0, cx - reach);
  const xMax = Math.min(board.width - 1, cx + reach);
  const yMin = Math.max(0, cy - reach);
  const yMax = Math.min(board.height - 1, cy + reach);
  const radiusSq = radiusCssPx * radiusCssPx;

  let bestId: SegmentId | null = null;
  let bestDistSq = Infinity;

  for (let y = yMin; y <= yMax; y++) {
    const dy = clampedAxisDistance(point.y, viewport.originY + y * viewport.scale, viewport.scale);
    const rowOffset = y * board.width;
    for (let x = xMin; x <= xMax; x++) {
      const dx = clampedAxisDistance(
        point.x,
        viewport.originX + x * viewport.scale,
        viewport.scale,
      );
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq || distSq >= bestDistSq) continue;

      const id = board.occupancy[rowOffset + x] as SegmentId;
      if (id === 0 || !isFree(id)) continue;

      bestDistSq = distSq;
      bestId = id;
    }
  }

  return bestId;
}
