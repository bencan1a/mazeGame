/**
 * Pixel -> cell -> segment hit testing.
 *
 * A direct hit reads `occupancy` once. When that cell is empty, out of
 * bounds, or the segment sitting on it is blocked, the radius search takes
 * over: it walks outward from the tapped cell and only ever considers a cell
 * whose segment `isFree` accepts, so a blocked segment is never a candidate
 * in the first place rather than a result that gets discarded afterward.
 */

import type { Board, SegmentId } from '../core/types.js';
import type { CssPixel, Viewport } from '../render/viewport.js';
import { cssPixelToCell } from '../render/viewport.js';

/** Injected rather than read from game state, so this module stays testable with no game state at all. */
export type FreePredicate = (id: SegmentId) => boolean;

export interface HitTestOptions {
  /** Search radius, in CSS pixels, converted to cell space by the viewport's own scale. */
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

  const cellRadius = radiusCssPx / viewport.scale;
  return nearestFreeInRadius(board, center.x, center.y, cellRadius, isFree);
}

function isInBounds(board: Board, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < board.width && y < board.height;
}

/**
 * Scans the cells within `cellRadius` of `(cx, cy)`, in increasing distance,
 * and returns the nearest one whose segment `isFree` accepts. A cell holding
 * a blocked segment is skipped, never returned as a fallback.
 */
function nearestFreeInRadius(
  board: Board,
  cx: number,
  cy: number,
  cellRadius: number,
  isFree: FreePredicate,
): SegmentId | null {
  if (cellRadius <= 0) return null;

  const reach = Math.ceil(cellRadius);
  const xMin = Math.max(0, cx - reach);
  const xMax = Math.min(board.width - 1, cx + reach);
  const yMin = Math.max(0, cy - reach);
  const yMax = Math.min(board.height - 1, cy + reach);
  const radiusSq = cellRadius * cellRadius;

  let bestId: SegmentId | null = null;
  let bestDistSq = Infinity;

  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy;
    const rowOffset = y * board.width;
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
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
