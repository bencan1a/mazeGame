/**
 * Segment drawing: the two seams both the static layer and the snake-out
 * animation stroke through — a segment's body (`strokeSegmentPolyline`) and
 * its arrowhead (`drawArrowhead`) — plus `drawSegment`, which is both of
 * those in the segment's palette colour.
 */

import { DX, DY, xOf, yOf } from '../core/grid.js';
import { cellCenterX, cellCenterY, type PixelSpace, type Viewport } from './viewport.js';
import { paletteColor } from './palette.js';
import type { Board, SegmentId } from '../core/types.js';

/**
 * The subset of `CanvasRenderingContext2D` stroking needs, so tests can
 * stroke against a hand-written fake instead of a real canvas.
 */
export interface StrokeContext2D {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

/** The subset of `CanvasRenderingContext2D` filling the arrowhead triangle needs. */
export interface FillContext2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
}

/** Line width as a fraction of one cell, scaled by the viewport at draw time. */
export const LINE_WIDTH_CELLS = 0.3;
/** Arrowhead length as a fraction of one cell, scaled by the viewport at draw time. */
export const ARROWHEAD_LENGTH_CELLS = 0.55;
/** Arrowhead base width as a fraction of one cell, scaled by the viewport at draw time. */
export const ARROWHEAD_WIDTH_CELLS = 0.4;

/**
 * CSS px an arrowhead needs to read as a direction on a real phone screen —
 * the single source `isLegibleAtScale` checks against. Current best
 * estimate; a device measurement replaces this one value.
 */
export const MIN_LEGIBLE_ARROWHEAD_CSS_PX = 9;

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/**
 * Whether an arrowhead drawn at `viewport`'s scale reads as a direction.
 * `viewport` must be `'css'`-space: that is what the player actually sees,
 * unlike the static buffer's own backing-store resolution.
 */
export function isLegibleAtScale(viewport: Viewport<'css'>): boolean {
  requirePositiveFinite(viewport.scale, 'viewport.scale');
  return ARROWHEAD_LENGTH_CELLS * viewport.scale >= MIN_LEGIBLE_ARROWHEAD_CSS_PX;
}

/**
 * Strokes one segment's polyline, cell-center to cell-center, through
 * `viewport`. A single-cell segment has no line to draw, so it gets a dot —
 * a zero-length subpath with a round cap — rather than vanishing silently.
 */
export function strokeSegmentPolyline<S extends PixelSpace>(
  ctx: StrokeContext2D,
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<S>,
): void {
  const start = board.segStart[segmentId - 1];
  const end = board.segStart[segmentId];
  if (start === undefined || end === undefined || end <= start) return;

  ctx.strokeStyle = paletteColor(board.segColor[segmentId - 1] as number);
  ctx.lineWidth = LINE_WIDTH_CELLS * viewport.scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  let lastX = 0;
  let lastY = 0;
  for (let i = start; i < end; i++) {
    const cellIndex = board.segCells[i] as number;
    const px = cellCenterX(viewport, xOf(cellIndex, board.width));
    const py = cellCenterY(viewport, yOf(cellIndex, board.width));
    if (i === start) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    lastX = px;
    lastY = py;
  }
  if (end - start === 1) ctx.lineTo(lastX, lastY);
  ctx.stroke();
}

/**
 * Fills the arrowhead at a segment's head, pointing along `segDir`. Read
 * directly off `segDir` rather than the last two points of the polyline: a
 * one-cell segment has no terminal stroke to infer a direction from, and
 * `segDir` is the one source that is valid for both cases.
 */
export function drawArrowhead<S extends PixelSpace>(
  ctx: FillContext2D,
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<S>,
): void {
  const start = board.segStart[segmentId - 1];
  const end = board.segStart[segmentId];
  if (start === undefined || end === undefined || end <= start) return;

  const dir = board.segDir[segmentId - 1];
  if (dir !== 0 && dir !== 1 && dir !== 2 && dir !== 3) {
    throw new RangeError(`segment ${segmentId} has an invalid segDir: ${String(dir)}`);
  }

  const headCell = board.segCells[end - 1] as number;
  const cx = cellCenterX(viewport, xOf(headCell, board.width));
  const cy = cellCenterY(viewport, yOf(headCell, board.width));
  const dx = DX[dir] as number;
  const dy = DY[dir] as number;

  const halfLength = (ARROWHEAD_LENGTH_CELLS * viewport.scale) / 2;
  const halfWidth = (ARROWHEAD_WIDTH_CELLS * viewport.scale) / 2;
  const tipX = cx + dx * halfLength;
  const tipY = cy + dy * halfLength;
  const baseX = cx - dx * halfLength;
  const baseY = cy - dy * halfLength;
  // Perpendicular to (dx, dy): rotate a quarter turn.
  const perpX = -dy * halfWidth;
  const perpY = dx * halfWidth;

  ctx.fillStyle = paletteColor(board.segColor[segmentId - 1] as number);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + perpX, baseY + perpY);
  ctx.lineTo(baseX - perpX, baseY - perpY);
  ctx.closePath();
  ctx.fill();
}

/** One segment, body and arrowhead, in its palette colour. */
export function drawSegment<S extends PixelSpace>(
  ctx: StrokeContext2D & FillContext2D,
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<S>,
): void {
  strokeSegmentPolyline(ctx, board, segmentId, viewport);
  drawArrowhead(ctx, board, segmentId, viewport);
}
