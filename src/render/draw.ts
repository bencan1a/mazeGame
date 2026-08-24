/**
 * Segment drawing: the two seams both the static layer and the snake-out
 * animation stroke through — a segment's body (`strokeSegmentPolyline`) and
 * its arrowhead (`drawArrowhead`) — plus `drawSegment`, which is both of
 * those in the segment's palette colour.
 */

import { DX, DY, xOf, yOf } from '../core/grid.js';
import {
  cellCenterX,
  cellCenterY,
  createViewport,
  type PixelSpace,
  type Viewport,
} from './viewport.js';
import { paletteColor } from './palette.js';
import type { Board, Direction, SegmentId } from '../core/types.js';

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
/**
 * Arrowhead length as a fraction of one cell, scaled by the viewport at draw
 * time. Bounded at 1: the triangle spans the head cell exactly (-0.5 to +0.5
 * of a cell about its centre) and must never reach into a neighbouring
 * cell — hit testing is per-cell, so a tip that spills over would select a
 * different segment than the one the player is looking at.
 */
export const ARROWHEAD_LENGTH_CELLS = 1;
/** Arrowhead base width as a fraction of one cell, scaled by the viewport at draw time. */
export const ARROWHEAD_WIDTH_CELLS = 0.7;

/**
 * CSS px an arrowhead needs to read as a direction on a real phone screen —
 * the single source `isLegibleAtScale` checks against. Current best
 * estimate; a device measurement replaces this one value.
 */
export const MIN_LEGIBLE_ARROWHEAD_CSS_PX = 9;

/**
 * How far past its cell's outer edge an arrowhead can reach in either axis,
 * in cells: the tip along its direction, or a base corner across it. Zero
 * at the current constants (the triangle is bounded by the cell itself);
 * covers both `ARROWHEAD_LENGTH_CELLS` and `ARROWHEAD_WIDTH_CELLS` so a
 * future increase past 1 cell in either keeps the static buffer padded
 * instead of clipping again.
 */
export const ARROWHEAD_OVERHANG_CELLS = Math.max(
  0,
  ARROWHEAD_LENGTH_CELLS / 2 - 0.5,
  ARROWHEAD_WIDTH_CELLS / 2 - 0.5,
);

/**
 * Reference CSS viewport size the ~8-10 CSS px legibility floor's "about 40
 * cells across" figure assumes — roughly a phone's width in portrait, the
 * smaller of its two axes and so the default for both when a caller does
 * not yet know its actual on-screen width or height.
 */
export const REFERENCE_CSS_VIEWPORT_WIDTH = 390;

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

function requireDirection(board: Board, segmentId: SegmentId): Direction {
  const dir = board.segDir[segmentId - 1];
  if (dir !== 0 && dir !== 1 && dir !== 2 && dir !== 3) {
    throw new RangeError(`segment ${segmentId} has an invalid segDir: ${String(dir)}`);
  }
  return dir;
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
 * Whether a board `boardWidthCells` cells across reads its arrowheads
 * unzoomed in a CSS viewport `availableCssWidth` by `availableCssHeight` —
 * the actual on-screen scale, not a board-independent constant. A board is
 * square, so the smaller of the two axes is what actually constrains it:
 * a wide-but-short landscape viewport can fit a board by width alone and
 * still crop it to an illegible scale by height. Below this the UI must
 * require zoom rather than render mush.
 */
export function isBoardLegibleUnzoomed(
  boardWidthCells: number,
  availableCssWidth: number = REFERENCE_CSS_VIEWPORT_WIDTH,
  availableCssHeight: number = REFERENCE_CSS_VIEWPORT_WIDTH,
): boolean {
  requirePositiveFinite(boardWidthCells, 'boardWidthCells');
  requirePositiveFinite(availableCssWidth, 'availableCssWidth');
  requirePositiveFinite(availableCssHeight, 'availableCssHeight');
  const constrainingCssSize = Math.min(availableCssWidth, availableCssHeight);
  return isLegibleAtScale(createViewport({ scale: constrainingCssSize / boardWidthCells }));
}

/**
 * Strokes one segment's polyline, cell-center to cell-center, except its
 * last vertex: for a segment of two cells or more that stops short of the
 * head cell's own center, leaving that cell for `drawArrowhead` to fill
 * without the stroke drawn on top of it. A single-cell segment has no line
 * to draw, so it gets a dot — a zero-length subpath with a round cap —
 * rather than vanishing silently.
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

  const multiCell = end - start > 1;
  let setbackX = 0;
  let setbackY = 0;
  if (multiCell) {
    const dir = requireDirection(board, segmentId);
    // Stop short of the head cell's center by half a cell, minus the round
    // cap's own radius so the cap still overlaps the arrowhead's base
    // instead of merely touching it.
    const capRadius = (LINE_WIDTH_CELLS * viewport.scale) / 2;
    const setback = 0.5 * viewport.scale - capRadius;
    setbackX = (DX[dir] as number) * setback;
    setbackY = (DY[dir] as number) * setback;
  }

  ctx.strokeStyle = paletteColor(board.segColor[segmentId - 1] as number);
  ctx.lineWidth = LINE_WIDTH_CELLS * viewport.scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  let lastX = 0;
  let lastY = 0;
  for (let i = start; i < end; i++) {
    const cellIndex = board.segCells[i] as number;
    let px = cellCenterX(viewport, xOf(cellIndex, board.width));
    let py = cellCenterY(viewport, yOf(cellIndex, board.width));
    if (i === end - 1) {
      px -= setbackX;
      py -= setbackY;
    }
    if (i === start) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    lastX = px;
    lastY = py;
  }
  if (end - start === 1) ctx.lineTo(lastX, lastY);
  ctx.stroke();
}

/**
 * Fills the arrowhead at a segment's head, pointing along `segDir` — the
 * one source valid for both a multi-cell segment's terminal stroke and a
 * one-cell segment with none. The triangle spans exactly the head cell, so
 * it never reads as belonging to a neighbouring cell's segment.
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

  const dir = requireDirection(board, segmentId);
  const headCell = board.segCells[end - 1] as number;
  const cx = cellCenterX(viewport, xOf(headCell, board.width));
  const cy = cellCenterY(viewport, yOf(headCell, board.width));
  const dx = DX[dir] as number;
  const dy = DY[dir] as number;

  const half = (ARROWHEAD_LENGTH_CELLS * viewport.scale) / 2;
  const halfWidth = (ARROWHEAD_WIDTH_CELLS * viewport.scale) / 2;
  const tipX = cx + dx * half;
  const tipY = cy + dy * half;
  const baseX = cx - dx * half;
  const baseY = cy - dy * half;
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
