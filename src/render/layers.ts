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
/** Backstop against a runaway ladder: enough rungs to halve from the cap to 1 several times over. */
const MAX_DEGRADATION_ATTEMPTS = 64;

/** CSS px per board cell at 1x zoom, 1x dpr — the static buffer's resting resolution. */
export const BASE_CSS_PIXELS_PER_CELL = 10;
/** Zoom level the static buffer stays sharp up to before a `drawImage` blit would blur it. */
export const DEFAULT_MAX_ZOOM = 3;

export interface BufferBudget {
  /** Buffer pixels per board cell. */
  readonly pixelsPerCell: number;
  readonly widthPx: number;
  readonly heightPx: number;
  /** True once the request has been reduced below what was asked for. */
  readonly degraded: boolean;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
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
  requirePositiveFinite(boardWidth, 'boardWidth');
  requirePositiveFinite(boardHeight, 'boardHeight');
  requirePositiveFinite(requestedPixelsPerCell, 'requestedPixelsPerCell');
  requirePositiveFinite(maxDimension, 'maxDimension');

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

/**
 * What the board actually needs at rest: cells across a target CSS px per
 * cell times the zoom ceiling times dpr. `createStaticLayer` clamps this to
 * `MAX_CANVAS_DIMENSION` — this is the number it clamps, not the cap itself.
 */
export function recommendedPixelsPerCell(
  dpr: number,
  maxZoom: number = DEFAULT_MAX_ZOOM,
  baseCssPixelsPerCell: number = BASE_CSS_PIXELS_PER_CELL,
): number {
  requirePositiveFinite(dpr, 'dpr');
  requirePositiveFinite(maxZoom, 'maxZoom');
  requirePositiveFinite(baseCssPixelsPerCell, 'baseCssPixelsPerCell');
  return baseCssPixelsPerCell * maxZoom * dpr;
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
  /** Whether `budget`'s own probe succeeded — false means every rung failed and this is the smallest attempted, not a working buffer. */
  readonly ok: boolean;
}

/**
 * Halves `pixelsPerCell` until `probe` succeeds or the floor is reached.
 * Pure aside from calling `probe`, so the ladder is testable without a real
 * canvas. Never throws on a failing probe: if every attempt fails, the last
 * (smallest) budget is returned, with `ok: false`, so the caller has
 * something to size a canvas to and a way to tell it never actually worked.
 * A bounded iteration count backstops the halving itself against a runaway
 * loop if an input turns out non-finite despite validation.
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
  requirePositiveFinite(minPixelsPerCell, 'minPixelsPerCell');

  let budget = computeBufferBudget(boardWidth, boardHeight, requestedPixelsPerCell, maxDimension);
  const attempts: DegradationAttempt[] = [];
  for (let attempt = 0; attempt < MAX_DEGRADATION_ATTEMPTS; attempt++) {
    const ok = probe(budget);
    attempts.push({ budget, ok });
    if (ok || budget.pixelsPerCell <= minPixelsPerCell) return { budget, attempts, ok };
    budget = degradeBudget(budget, boardWidth, boardHeight, maxDimension, minPixelsPerCell);
  }
  const last = attempts[attempts.length - 1];
  return { budget, attempts, ok: last?.ok ?? false };
}

/** True when the two removed-segment sets differ, the trigger to redraw the static layer. */
export function removedSetsDiffer(a: ReadonlySet<SegmentId>, b: ReadonlySet<SegmentId>): boolean {
  if (a.size !== b.size) return true;
  for (const id of a) if (!b.has(id)) return true;
  return false;
}

/** The canvas surface both layers are built on. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Draws one pixel and reads it back, then clears it. An allocation that
 * silently failed comes back as an untouched (typically transparent-black)
 * pixel instead of throwing, which is why allocation success alone cannot be
 * trusted.
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
    ctx.clearRect(x, y, 1, 1);
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
  /** Whether `budget`'s readback probe actually succeeded — false means the buffer is blank. */
  readonly allocationOk: boolean;
  /** Every rung the degradation ladder tried, in order, for diagnostics. */
  readonly attempts: readonly DegradationAttempt[];
}

export interface StaticLayerOptions extends DegradationOptions {
  /** Device pixel ratio, used to derive the default request when `requestedPixelsPerCell` is not given. */
  readonly dpr?: number;
  /** Zoom ceiling the default request stays sharp up to. */
  readonly maxZoom?: number;
  /** Explicit override for what the buffer asks for, before the cap. Defaults to `recommendedPixelsPerCell(dpr, maxZoom)`. */
  readonly requestedPixelsPerCell?: number;
  readonly createCanvas?: () => CanvasLike;
}

function defaultCreateCanvas(): CanvasLike {
  return document.createElement('canvas');
}

/**
 * Allocates the static offscreen buffer sized to hold the whole board,
 * degrading resolution until a drawn pixel reads back correctly.
 */
export function createStaticLayer(board: Board, options: StaticLayerOptions = {}): StaticLayer {
  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const requestedPixelsPerCell =
    options.requestedPixelsPerCell ??
    recommendedPixelsPerCell(options.dpr ?? 1, options.maxZoom ?? DEFAULT_MAX_ZOOM);

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

  const { budget, attempts, ok } = planDegradation(
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
  return { canvas, ctx: liveCtx, budget, viewport, allocationOk: ok, attempts };
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
  readonly dpr: number;
}

/**
 * A screen-sized layer for the single segment currently exiting. Not capped
 * or probed — far under budget at any real screen size. `cssWidth`/`cssHeight`
 * are CSS px; the backing store is sized up by `dpr` so the animation layer
 * matches the static layer's device resolution rather than rendering soft.
 */
export function createAnimationLayer(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  createCanvas: () => CanvasLike = defaultCreateCanvas,
): AnimationLayer {
  const canvas = createCanvas();
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d canvas context unavailable');
  return { canvas, ctx, dpr };
}

/** Clears the animation layer to its full backing-store size. */
export function clearAnimationLayer(layer: AnimationLayer): void {
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
}
