/**
 * Segment polyline drawing: the one seam both the static layer and the
 * snake-out animation stroke through. No arrowheads, no palette — a plain
 * stroke in a placeholder colour.
 */

import { cellCenterToCssPixel, type Viewport } from './viewport.js';
import { xOf, yOf } from '../core/grid.js';
import type { Board, SegmentId } from '../core/types.js';

/**
 * The subset of `CanvasRenderingContext2D` drawing needs, so tests can stroke
 * against a hand-written fake instead of a real canvas.
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

export const PLACEHOLDER_STROKE_STYLE = '#94a3b8';
/** Line width as a fraction of one cell, scaled by the viewport at draw time. */
export const PLACEHOLDER_LINE_WIDTH_CELLS = 0.3;

/**
 * Strokes one segment's polyline, cell-center to cell-center, through
 * `viewport`. A single-cell segment has no line to draw, so it gets a dot —
 * a zero-length subpath with a round cap — rather than vanishing silently.
 */
export function strokeSegmentPolyline(
  ctx: StrokeContext2D,
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport,
): void {
  const start = board.segStart[segmentId - 1];
  const end = board.segStart[segmentId];
  if (start === undefined || end === undefined || end <= start) return;

  ctx.strokeStyle = PLACEHOLDER_STROKE_STYLE;
  ctx.lineWidth = PLACEHOLDER_LINE_WIDTH_CELLS * viewport.scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  let lastX = 0;
  let lastY = 0;
  for (let i = start; i < end; i++) {
    const cellIndex = board.segCells[i] as number;
    const cell = { x: xOf(cellIndex, board.width), y: yOf(cellIndex, board.width) };
    const point = cellCenterToCssPixel(viewport, cell);
    if (i === start) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
    lastX = point.x;
    lastY = point.y;
  }
  if (end - start === 1) ctx.lineTo(lastX, lastY);
  ctx.stroke();
}
