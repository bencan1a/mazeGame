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

import { drawSegment } from './draw.js';
import { createBufferViewport, type Viewport } from './viewport.js';
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

/**
 * One rung down the degradation ladder: half the resolution, still capped.
 * Rejects a `minPixelsPerCell` above `budget.pixelsPerCell` — halving toward
 * a floor higher than where you already are raises resolution instead of
 * lowering it, which is exactly backwards for a function whose contract is
 * "one step down".
 */
export function degradeBudget(
  budget: BufferBudget,
  boardWidth: number,
  boardHeight: number,
  maxDimension: number = MAX_CANVAS_DIMENSION,
  minPixelsPerCell: number = MIN_PIXELS_PER_CELL,
): BufferBudget {
  requirePositiveFinite(minPixelsPerCell, 'minPixelsPerCell');
  if (minPixelsPerCell > budget.pixelsPerCell) {
    throw new RangeError(
      `minPixelsPerCell (${minPixelsPerCell}) exceeds budget.pixelsPerCell (${budget.pixelsPerCell})`,
    );
  }
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
  let lastAttempt: DegradationAttempt = { budget, ok: false };
  for (let attempt = 0; attempt < MAX_DEGRADATION_ATTEMPTS; attempt++) {
    lastAttempt = { budget, ok: probe(budget) };
    attempts.push(lastAttempt);
    if (lastAttempt.ok || budget.pixelsPerCell <= minPixelsPerCell) {
      return { budget, attempts, ok: lastAttempt.ok };
    }
    budget = degradeBudget(budget, boardWidth, boardHeight, maxDimension, minPixelsPerCell);
  }
  return { budget: lastAttempt.budget, attempts, ok: lastAttempt.ok };
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
 * Per-channel slack allowed when reading the probe pixel back. Wide enough to
 * survive an engine that perturbs `getImageData`, far narrower than the gap
 * between the probe colour and the transparent black a failed allocation
 * reads back as.
 */
const PROBE_CHANNEL_TOLERANCE = 24;

function near(actual: number | undefined, expected: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) <= PROBE_CHANNEL_TOLERANCE;
}

/**
 * Draws one pixel at the buffer's far corner and reads it back. Touches only
 * that single pixel, and restores whatever it held first, so it is safe to
 * call on a layer that already holds drawn content, not just at allocation
 * time.
 *
 * The read is compared with a tolerance rather than byte-exactly. A canvas
 * that never allocated reads back transparent black, so the two cases are
 * far apart; an exact comparison instead fails on any engine that perturbs
 * `getImageData` to defeat fingerprinting, degrading a working buffer all
 * the way to the floor.
 *
 * Resets the transform first: `fillRect`/`clearRect` honour the context's
 * current transform, but `getImageData` always reads raw backing-store
 * pixels regardless of it. On a context a caller has already scaled (the
 * animation layer's dpr pre-scale), probing without resetting the transform
 * draws and clears at the wrong location and reads back a pixel that was
 * never touched — always reporting failure, and corrupting whatever the
 * transform-scaled clear actually hit. The reset is undone by `restore` in
 * `finally`, leaving the caller's transform exactly as it found it.
 *
 * An allocation that silently failed comes back as an untouched (typically
 * transparent-black) pixel instead of throwing, which is why allocation
 * success alone cannot be trusted.
 */
export function probeReadback(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
): boolean {
  const x = Math.max(0, widthPx - 1);
  const y = Math.max(0, heightPx - 1);
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const original = ctx.getImageData(x, y, 1, 1);
    ctx.clearRect(x, y, 1, 1);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(x, y, 1, 1);
    const data = ctx.getImageData(x, y, 1, 1).data;
    ctx.putImageData(original, x, y);
    return near(data[0], 255) && near(data[1], 0) && near(data[2], 255) && near(data[3], 255);
  } catch {
    return false;
  } finally {
    ctx.restore();
  }
}

export interface StaticLayer {
  readonly canvas: CanvasLike;
  readonly ctx: CanvasRenderingContext2D;
  readonly budget: BufferBudget;
  /** Board cell -> buffer pixel, a space of its own — never a CSS or device pixel. */
  readonly viewport: Viewport<'buffer'>;
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

  // Resizing to an over-budget canvas can throw outright on some platforms
  // rather than returning null or a blank surface — that is just another
  // failed rung, not a reason to abandon the ladder.
  const allocate = (budget: BufferBudget): CanvasRenderingContext2D | null => {
    try {
      canvas.width = budget.widthPx;
      canvas.height = budget.heightPx;
      return canvas.getContext('2d');
    } catch {
      return null;
    }
  };

  const probe = (budget: BufferBudget): boolean => {
    const ctx = allocate(budget);
    if (ctx === null) return false;
    return probeReadback(ctx, budget.widthPx, budget.heightPx);
  };

  const { budget, attempts, ok } = planDegradation(
    board.width,
    board.height,
    requestedPixelsPerCell,
    probe,
    options,
  );

  // Always re-allocate at the final budget, even if an earlier (larger) rung
  // already produced a live context: the ladder's own probe at this exact
  // budget may itself have thrown, in which case a stale context sized for
  // a rung that is no longer being reported would otherwise leak through.
  const liveCtx = allocate(budget);
  if (liveCtx === null) throw new Error('2d canvas context unavailable');
  const liveOk = ok && probeReadback(liveCtx, budget.widthPx, budget.heightPx);

  const viewport = createBufferViewport(budget.pixelsPerCell);
  return { canvas, ctx: liveCtx, budget, viewport, allocationOk: liveOk, attempts };
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
    drawSegment(ctx, board, id, viewport);
  }
}

export interface AnimationLayer {
  readonly canvas: CanvasLike;
  readonly ctx: CanvasRenderingContext2D;
  readonly dpr: number;
  /** CSS px the backing store was sized from — what the pre-scaled context now draws in. */
  readonly cssWidth: number;
  readonly cssHeight: number;
}

/**
 * A screen-sized layer for the single segment currently exiting. Not capped
 * or probed — far under budget at any real screen size. The backing store is
 * sized in device pixels (`cssWidth`/`cssHeight` times `dpr`), and the
 * context is pre-scaled by `dpr` so a caller draws in the same CSS-pixel
 * coordinates a `'css'`-space `Viewport` already uses — the screen viewport
 * pan/zoom maintains and hit testing reads, *not* the static layer's
 * `'buffer'`-space viewport, which is a different pixel space entirely and
 * would draw here at the wrong scale.
 */
export function createAnimationLayer(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  createCanvas: () => CanvasLike = defaultCreateCanvas,
): AnimationLayer {
  requirePositiveFinite(cssWidth, 'cssWidth');
  requirePositiveFinite(cssHeight, 'cssHeight');
  requirePositiveFinite(dpr, 'dpr');
  const canvas = createCanvas();
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d canvas context unavailable');
  ctx.scale(dpr, dpr);
  return { canvas, ctx, dpr, cssWidth, cssHeight };
}

/**
 * Clears the animation layer's full backing store. Resets the transform
 * first and clears by the canvas's actual device-pixel dimensions rather
 * than `cssWidth * dpr`: `Math.round` sizing the backing store means that
 * product is not always exactly the canvas's real width, and clearing the
 * rounded-off CSS amount through the dpr-scaled transform can leave a
 * sub-pixel sliver of the previous frame uncleared at the far edge.
 */
export function clearAnimationLayer(layer: AnimationLayer): void {
  const { ctx, canvas } = layer;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}
