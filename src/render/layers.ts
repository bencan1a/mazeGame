/**
 * The two-layer setup: a capped static offscreen buffer holding every idle
 * segment, redrawn only when the removed set changes, plus a screen-sized
 * animation layer for the segment currently exiting.
 *
 * A single canvas is capped at `MAX_CANVAS_DIMENSION` device pixels per side.
 * An over-budget canvas allocates without throwing and comes back blank, so
 * the cap is enforced by drawing a pixel and reading it back — allocation
 * success is never trusted on its own. When the probe fails, the buffer
 * degrades to a lower resolution rather than staying blank.
 */

import { strokeSegmentPolyline } from './draw.js';
import { createViewport, type Viewport } from './viewport.js';
import type { Board, SegmentId } from '../core/types.js';

export const MAX_CANVAS_DIMENSION = 8192;
export const MIN_PIXELS_PER_CELL = 1;

export interface BufferBudget {
  /** Buffer pixels per board cell. */
  readonly pixelsPerCell: number;
  readonly widthPx: number;
  readonly heightPx: number;
  /** True once the request has been reduced below what was asked for. */
  readonly degraded: boolean;
}

/**
 * The largest `pixelsPerCell` that keeps both buffer dimensions within
 * `maxDimension`, capped at `requestedPixelsPerCell`.
 */
export function computeBufferBudget(
  boardWidth: number,
  boardHeight: number,
  requestedPixelsPerCell: number,
  maxDimension: number = MAX_CANVAS_DIMENSION,
): BufferBudget {
  const maxBoardDim = Math.max(boardWidth, boardHeight, 1);
  const cappedPixelsPerCell = Math.min(requestedPixelsPerCell, maxDimension / maxBoardDim);
  const widthPx = Math.max(1, Math.min(maxDimension, Math.round(cappedPixelsPerCell * boardWidth)));
  const heightPx = Math.max(
    1,
    Math.min(maxDimension, Math.round(cappedPixelsPerCell * boardHeight)),
  );
  return {
    pixelsPerCell: cappedPixelsPerCell,
    widthPx,
    heightPx,
    degraded: cappedPixelsPerCell < requestedPixelsPerCell,
  };
}

/** One rung down the degradation ladder: half the resolution, still capped. */
export function degradeBudget(
  budget: BufferBudget,
  boardWidth: number,
  boardHeight: number,
  maxDimension: number = MAX_CANVAS_DIMENSION,
  minPixelsPerCell: number = MIN_PIXELS_PER_CELL,
): BufferBudget {
  const next = Math.max(minPixelsPerCell, budget.pixelsPerCell / 2);
  return { ...computeBufferBudget(boardWidth, boardHeight, next, maxDimension), degraded: true };
}

export interface DegradationAttempt {
  readonly budget: BufferBudget;
  readonly ok: boolean;
}

export interface DegradationOptions {
  readonly maxDimension?: number;
  readonly minPixelsPerCell?: number;
}

export interface DegradationPlan {
  readonly budget: BufferBudget;
  readonly attempts: readonly DegradationAttempt[];
}

/**
 * Halves `pixelsPerCell` until `probe` succeeds or the floor is reached.
 * Pure aside from calling `probe`, so the ladder is testable without a real
 * canvas. Never throws: if every attempt fails, the last (smallest) budget is
 * returned so the caller has something to size a canvas to rather than
 * nothing at all.
 */
export function planDegradation(
  boardWidth: number,
  boardHeight: number,
  requestedPixelsPerCell: number,
  probe: (budget: BufferBudget) => boolean,
  options: DegradationOptions = {},
): DegradationPlan {
  const maxDimension = options.maxDimension ?? MAX_CANVAS_DIMENSION;
  const minPixelsPerCell = options.minPixelsPerCell ?? MIN_PIXELS_PER_CELL;

  let budget = computeBufferBudget(boardWidth, boardHeight, requestedPixelsPerCell, maxDimension);
  const attempts: DegradationAttempt[] = [];
  for (;;) {
    const ok = probe(budget);
    attempts.push({ budget, ok });
    if (ok || budget.pixelsPerCell <= minPixelsPerCell) return { budget, attempts };
    budget = degradeBudget(budget, boardWidth, boardHeight, maxDimension, minPixelsPerCell);
  }
}

/** True when the two removed-segment sets differ, the trigger to redraw the static layer. */
export function removedSetsDiffer(a: ReadonlySet<SegmentId>, b: ReadonlySet<SegmentId>): boolean {
  if (a.size !== b.size) return true;
  for (const id of a) if (!b.has(id)) return true;
  return false;
}

/** The canvas surface both layers are built on — an `HTMLCanvasElement` or an `OffscreenCanvas`. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Draws one pixel and reads it back. An allocation that silently failed
 * comes back as an untouched (typically transparent-black) pixel instead of
 * throwing, which is why allocation success alone cannot be trusted.
 */
export function probeReadback(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
): boolean {
  const x = Math.max(0, widthPx - 1);
  const y = Math.max(0, heightPx - 1);
  try {
    ctx.save();
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(x, y, 1, 1);
    const data = ctx.getImageData(x, y, 1, 1).data;
    ctx.restore();
    return data[0] === 255 && data[1] === 0 && data[2] === 255 && data[3] === 255;
  } catch {
    return false;
  }
}

export interface StaticLayer {
  readonly canvas: CanvasLike;
  readonly ctx: CanvasRenderingContext2D;
  readonly budget: BufferBudget;
  /** Board cell -> buffer pixel. Independent of pan/zoom and of screen dpr. */
  readonly viewport: Viewport;
}

export interface StaticLayerOptions extends DegradationOptions {
  readonly createCanvas?: () => CanvasLike;
}

function defaultCreateCanvas(): CanvasLike {
  return document.createElement('canvas');
}

/**
 * Allocates the static offscreen buffer sized to hold the whole board at
 * `requestedPixelsPerCell`, degrading resolution until a drawn pixel reads
 * back correctly.
 */
export function createStaticLayer(
  board: Board,
  requestedPixelsPerCell: number,
  options: StaticLayerOptions = {},
): StaticLayer {
  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const canvas = createCanvas();
  let liveCtx: CanvasRenderingContext2D | null = null;

  const probe = (budget: BufferBudget): boolean => {
    canvas.width = budget.widthPx;
    canvas.height = budget.heightPx;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return false;
    liveCtx = ctx;
    return probeReadback(ctx, budget.widthPx, budget.heightPx);
  };

  const { budget } = planDegradation(
    board.width,
    board.height,
    requestedPixelsPerCell,
    probe,
    options,
  );

  if (liveCtx === null) {
    canvas.width = budget.widthPx;
    canvas.height = budget.heightPx;
    liveCtx = canvas.getContext('2d');
  }
  if (liveCtx === null) throw new Error('2d canvas context unavailable');

  const viewport = createViewport({ scale: budget.pixelsPerCell });
  return { canvas, ctx: liveCtx, budget, viewport };
}

/** Redraws every non-removed segment. The caller decides when that is needed — see `removedSetsDiffer`. */
export function redrawStaticLayer(
  layer: StaticLayer,
  board: Board,
  removed: ReadonlySet<SegmentId>,
): void {
  const { ctx, viewport, budget } = layer;
  ctx.clearRect(0, 0, budget.widthPx, budget.heightPx);
  for (let id = 1; id <= board.segmentCount; id++) {
    if (removed.has(id)) continue;
    strokeSegmentPolyline(ctx, board, id, viewport);
  }
}

export interface AnimationLayer {
  readonly canvas: CanvasLike;
  readonly ctx: CanvasRenderingContext2D;
}

/** A screen-sized layer for the single segment currently exiting. Not capped or probed — far under budget at any real screen size. */
export function createAnimationLayer(
  widthPx: number,
  heightPx: number,
  createCanvas: () => CanvasLike = defaultCreateCanvas,
): AnimationLayer {
  const canvas = createCanvas();
  canvas.width = Math.max(1, Math.round(widthPx));
  canvas.height = Math.max(1, Math.round(heightPx));
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d canvas context unavailable');
  return { canvas, ctx };
}

/** Clears the animation layer to its full backing-store size. */
export function clearAnimationLayer(layer: AnimationLayer): void {
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
}
