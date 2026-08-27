/**
 * Segment drawing: the two seams both the static layer and the snake-out
 * animation stroke through — a segment's body (`strokeSegmentPolyline`) and
 * its arrowhead (`drawArrowhead`) — plus `drawSegment`, which is both of
 * those in the segment's palette colour or a caller's override, and
 * `drawSegmentGuarded`, the same
 * draw with malformed per-segment data turned into a skip instead of a
 * throw.
 */

import { DX, DY, xOf, yOf } from '../core/grid.js';
import {
  cellCenterX,
  cellCenterY,
  createViewport,
  type PixelSpace,
  type Viewport,
} from './viewport.js';
import { requirePositiveFinite } from './numeric.js';
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
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
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
 * Radius of the arc that replaces a bend in a segment's centre line, as a
 * fraction of one cell. The stroke's two edges follow it at
 * `CORNER_RADIUS_CELLS +- LINE_WIDTH_CELLS / 2`, so the outer edge rounds
 * and the inner one rounds with it rather than staying a notch. Bounded
 * below by half a line width and above by half a cell, both enforced
 * below: consecutive cell centres are one cell apart, and a corner takes
 * half of each leg it touches.
 */
export const CORNER_RADIUS_CELLS = 0.35;

if (CORNER_RADIUS_CELLS > 0.5 || CORNER_RADIUS_CELLS <= LINE_WIDTH_CELLS / 2) {
  throw new RangeError(
    `CORNER_RADIUS_CELLS must be in (${LINE_WIDTH_CELLS / 2}, 0.5], got ${CORNER_RADIUS_CELLS}`,
  );
}
/**
 * Arrowhead length as a fraction of one cell, scaled by the viewport at draw
 * time. Bounded at 1 and enforced below: the triangle spans the head cell
 * exactly (-0.5 to +0.5 of a cell about its centre) and must never reach
 * into a neighbouring cell — hit testing is per-cell, so a tip that spills
 * over would select a different segment than the one the player is looking
 * at.
 */
export const ARROWHEAD_LENGTH_CELLS = 1;
/**
 * Arrowhead base width as a fraction of one cell, scaled by the viewport at
 * draw time. Bounded at 1 and enforced below, for the same reason as
 * `ARROWHEAD_LENGTH_CELLS`: a base corner past a cell's edge reads as the
 * neighbouring segment's.
 */
export const ARROWHEAD_WIDTH_CELLS = 0.7;

function assertBoundedByOneCell(name: string, valueCells: number): void {
  if (valueCells > 1) {
    throw new RangeError(
      `${name} must not exceed 1 cell, got ${valueCells}: hit testing is per-cell, and ` +
        'an arrowhead reaching past its own cell would tap the wrong segment',
    );
  }
}
assertBoundedByOneCell('ARROWHEAD_LENGTH_CELLS', ARROWHEAD_LENGTH_CELLS);
assertBoundedByOneCell('ARROWHEAD_WIDTH_CELLS', ARROWHEAD_WIDTH_CELLS);

/**
 * CSS px an arrowhead needs to read as a direction on a real phone screen —
 * the single source `isLegibleAtScale` checks against. Current best
 * estimate; a device measurement replaces this one value.
 */
export const MIN_LEGIBLE_ARROWHEAD_CSS_PX = 9;

/**
 * How far past its cell's outer edge an arrowhead could reach in either
 * axis, in cells — always 0, because `ARROWHEAD_LENGTH_CELLS` and
 * `ARROWHEAD_WIDTH_CELLS` are asserted at or under 1 cell above and must
 * stay there. A formula rather than a literal 0 so a bug in that assertion
 * cannot also silently reintroduce buffer clipping as a second failure.
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

/** Reads and validates a segment's `segDir`, for a caller that needs the direction on its own — see `drawSegmentGuarded` for one that needs the throw absorbed. */
export function requireDirection(board: Board, segmentId: SegmentId): Direction {
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
 * Whether a `boardWidthCells` by `boardHeightCells` board reads its
 * arrowheads unzoomed in a CSS viewport `availableCssWidth` by
 * `availableCssHeight` — the board's actual fit-to-viewport scale, not a
 * board-independent constant. Fitting a board into a viewport is bounded by
 * whichever axis is tighter in either direction, so this takes the smaller
 * of the two ratios: a wide-but-short landscape viewport can fit a wide
 * board by width alone and still crop it to an illegible scale by height,
 * and a tall narrow board is equally bounded by width. Below this the UI
 * must require zoom rather than render mush.
 */
export function isBoardLegibleUnzoomed(
  boardWidthCells: number,
  boardHeightCells: number,
  availableCssWidth: number = REFERENCE_CSS_VIEWPORT_WIDTH,
  availableCssHeight: number = REFERENCE_CSS_VIEWPORT_WIDTH,
): boolean {
  requirePositiveFinite(boardWidthCells, 'boardWidthCells');
  requirePositiveFinite(boardHeightCells, 'boardHeightCells');
  requirePositiveFinite(availableCssWidth, 'availableCssWidth');
  requirePositiveFinite(availableCssHeight, 'availableCssHeight');
  const fitScale = Math.min(
    availableCssWidth / boardWidthCells,
    availableCssHeight / boardHeightCells,
  );
  return isLegibleAtScale(createViewport({ scale: fitScale }));
}

/**
 * The radius to round the vertex at `(cx, cy)` with, arrived at from
 * `(ax, ay)` and leaving toward `(bx, by)`: `maxRadius`, pulled in so the
 * arc meets each leg within half of it and the corners at either end of one
 * leg cannot claim overlapping stretches, and 0 where the two legs do not
 * turn at all.
 *
 * An arc of radius `r` leaves its leg `r / tan(turn / 2)` from the vertex,
 * which is `r` itself only at a right angle: the sharper the turn, the
 * further out it reaches, so the radius that fits depends on the angle and
 * not on the leg lengths alone.
 */
export function cornerRadiusAt(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  maxRadius: number,
): number {
  const inX = cx - ax;
  const inY = cy - ay;
  const outX = bx - cx;
  const outY = by - cy;
  const cross = inX * outY - inY * outX;
  if (cross === 0) return 0;
  const inLength = Math.hypot(inX, inY);
  const outLength = Math.hypot(outX, outY);
  // tan(turn / 2) without the trig, so a right angle comes out as exactly 1
  // and every corner between two cell centers keeps the plain half-leg bound.
  const halfTurnTangent = Math.abs(cross) / (inLength * outLength - (inX * outX + inY * outY));
  return Math.min(maxRadius, halfTurnTangent * (Math.min(inLength, outLength) / 2));
}

/**
 * Extends the current subpath through the vertex at `(cx, cy)` on its way
 * to `(bx, by)`, as an arc of `radius` or, at radius 0, as a plain line to
 * the vertex itself.
 */
export function strokeCorner(
  ctx: StrokeContext2D,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  radius: number,
): void {
  if (radius === 0) ctx.lineTo(cx, cy);
  else ctx.arcTo(cx, cy, bx, by, radius);
}

/**
 * Strokes one segment's polyline, cell-center to cell-center, except its
 * last vertex: for a segment of two cells or more that stops mostly short
 * of the head cell's own center, but not entirely — the stroke's rounded
 * end deliberately reaches about 0.3 of a cell past the head cell's near
 * edge (a full line width), so `drawArrowhead`'s base has no
 * anti-aliasing seam against it once both are drawn. A caller that strokes
 * the body without also drawing the arrowhead on the same frame will show
 * that overlap as a small stub past the true half-cell edge; it is only
 * invisible once the arrowhead's fill covers it. A single-cell segment has
 * no line to draw, so it gets a dot — a zero-length subpath with a round
 * cap — rather than vanishing silently.
 *
 * Each interior vertex is stroked as an arc of `CORNER_RADIUS_CELLS`
 * rather than a right angle, clamped at every corner to half of each leg
 * of cell centers it touches, so two corners sharing a leg cannot overlap.
 *
 * Throws `RangeError` for a malformed `segColor` or (on a multi-cell
 * segment) `segDir` — see `drawSegmentGuarded` for a caller, such as a
 * per-frame animation loop, that must not let one bad segment stop it.
 */
export function strokeSegmentPolyline<S extends PixelSpace>(
  ctx: StrokeContext2D,
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<S>,
  color?: string,
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

  // The palette lookup runs even when `color` overrides it, so a malformed
  // `segColor` still throws rather than being hidden by the override.
  const paletteStroke = paletteColor(board.segColor[segmentId - 1] as number);
  ctx.strokeStyle = color ?? paletteStroke;
  ctx.lineWidth = LINE_WIDTH_CELLS * viewport.scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const maxRadius = CORNER_RADIUS_CELLS * viewport.scale;
  ctx.beginPath();
  let prevX = 0;
  let prevY = 0;
  let curX = 0;
  let curY = 0;
  for (let i = start; i < end; i++) {
    const cellIndex = board.segCells[i] as number;
    const centerX = cellCenterX(viewport, xOf(cellIndex, board.width));
    const centerY = cellCenterY(viewport, yOf(cellIndex, board.width));
    let px = centerX;
    let py = centerY;
    if (i === end - 1) {
      px -= setbackX;
      py -= setbackY;
    }
    if (i === start) ctx.moveTo(px, py);
    else if (i > start + 1) {
      // The radius is measured against the cell centers, the setback left
      // out: it is a cosmetic stop-short under the arrowhead, and letting it
      // tighten the last corner would leave the resting board and the exit
      // animation drawing that one bend differently.
      strokeCorner(
        ctx,
        curX,
        curY,
        px,
        py,
        cornerRadiusAt(prevX, prevY, curX, curY, centerX, centerY, maxRadius),
      );
    }
    prevX = curX;
    prevY = curY;
    curX = px;
    curY = py;
  }
  ctx.lineTo(curX, curY);
  ctx.stroke();
}

/**
 * Fills an arrowhead triangle at an arbitrary point, pointing along `dir` —
 * the geometry `drawArrowhead` uses at a segment's own head cell, factored
 * out for a caller (a snake-out animation) that needs the same triangle at a
 * point that moves frame to frame instead of one pinned to a cell center.
 *
 * Throws `RangeError` for a `dir` outside 0..3.
 */
export function fillArrowheadAt(
  ctx: FillContext2D,
  cx: number,
  cy: number,
  dir: Direction,
  scale: number,
  color: string,
): void {
  if (dir !== 0 && dir !== 1 && dir !== 2 && dir !== 3) {
    throw new RangeError(`dir must be 0 (N), 1 (E), 2 (S) or 3 (W), got ${String(dir)}`);
  }
  const dx = DX[dir] as number;
  const dy = DY[dir] as number;

  const half = (ARROWHEAD_LENGTH_CELLS * scale) / 2;
  const halfWidth = (ARROWHEAD_WIDTH_CELLS * scale) / 2;
  const tipX = cx + dx * half;
  const tipY = cy + dy * half;
  const baseX = cx - dx * half;
  const baseY = cy - dy * half;
  // Perpendicular to (dx, dy): rotate a quarter turn.
  const perpX = -dy * halfWidth;
  const perpY = dx * halfWidth;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + perpX, baseY + perpY);
  ctx.lineTo(baseX - perpX, baseY - perpY);
  ctx.closePath();
  ctx.fill();
}

/**
 * Fills the arrowhead at a segment's head, pointing along `segDir` — the
 * one source valid for both a multi-cell segment's terminal stroke and a
 * one-cell segment with none. The triangle spans exactly the head cell, so
 * it never reads as belonging to a neighbouring cell's segment.
 *
 * Throws `RangeError` for a malformed `segColor` or `segDir` — see
 * `drawSegmentGuarded`.
 */
export function drawArrowhead<S extends PixelSpace>(
  ctx: FillContext2D,
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<S>,
  color?: string,
): void {
  const start = board.segStart[segmentId - 1];
  const end = board.segStart[segmentId];
  if (start === undefined || end === undefined || end <= start) return;

  const dir = requireDirection(board, segmentId);
  const headCell = board.segCells[end - 1] as number;
  const cx = cellCenterX(viewport, xOf(headCell, board.width));
  const cy = cellCenterY(viewport, yOf(headCell, board.width));
  const paletteFill = paletteColor(board.segColor[segmentId - 1] as number);
  fillArrowheadAt(ctx, cx, cy, dir, viewport.scale, color ?? paletteFill);
}

/**
 * One segment, body and arrowhead, in its palette colour.
 *
 * Throws `RangeError` for a malformed `segColor` or `segDir` — see
 * `drawSegmentGuarded` for a total version.
 */
export function drawSegment<S extends PixelSpace>(
  ctx: StrokeContext2D & FillContext2D,
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<S>,
  color?: string,
): void {
  strokeSegmentPolyline(ctx, board, segmentId, viewport, color);
  drawArrowhead(ctx, board, segmentId, viewport, color);
}

/**
 * `drawSegment`, with a malformed `segColor` or `segDir` turned into a
 * skipped throw instead of a crash: returns whether it drew *completely*,
 * not whether it drew at all — a one-cell segment's dot still strokes
 * before a bad `segDir` makes `drawArrowhead` throw, so `false` can mean
 * something was drawn. The one guard both `redrawStaticLayer`'s
 * per-segment loop and a per-frame animation caller need, so that one bad
 * segment cannot stop either — a loop over many segments would otherwise
 * lose the rest of the frame past the bad one, and a
 * single-segment-per-frame caller would otherwise stop scheduling its next
 * frame at all. Anything else — a dead canvas context, say — still
 * propagates rather than being absorbed here.
 */
export function drawSegmentGuarded<S extends PixelSpace>(
  ctx: StrokeContext2D & FillContext2D,
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<S>,
  color?: string,
): boolean {
  try {
    drawSegment(ctx, board, segmentId, viewport, color);
    return true;
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return false;
  }
}
