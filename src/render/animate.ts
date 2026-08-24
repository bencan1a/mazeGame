/**
 * The snake-out exit animation: a segment's own polyline concatenated with
 * its exit ray, stroked as one path every frame with a dashed window whose
 * length is the segment's own length. Sliding the dash offset forward walks
 * that window along the concatenated path — the tail end shrinking away
 * while the leading end advances into, and finally past, the ray — which is
 * what reads as a piece slithering along its own shape rather than sliding
 * or fading. Draws only to the animation layer; the static layer is never
 * touched here.
 */

import { DX, DY, directionBetween, step, stepsToEdge, xOf, yOf } from '../core/grid.js';
import type { Board, Direction, SegmentId } from '../core/types.js';
import {
  LINE_WIDTH_CELLS,
  drawSegmentGuarded,
  fillArrowheadAt,
  requireDirection,
  type FillContext2D,
  type StrokeContext2D,
} from './draw.js';
import { clearAnimationLayer, type AnimationLayer } from './layers.js';
import { paletteColor } from './palette.js';
import { cellCenterX, cellCenterY, type Viewport } from './viewport.js';

function requireValidSegmentId(board: Board, id: number): asserts id is SegmentId {
  if (!Number.isInteger(id) || id < 1 || id > board.segmentCount) {
    throw new RangeError(`segmentId must be an integer in [1, ${board.segmentCount}], got ${id}`);
  }
}

/**
 * A segment's exit path: its own polyline (tail to head, cell center to cell
 * center) followed by the exit ray (head to the board's outer edge),
 * precomputed once so a per-frame draw only ever restrokes the same
 * vertices with a different dash offset. `edgeDirs[k]` is the direction
 * travelled between vertex `k` and vertex `k + 1`.
 *
 * Every edge is exactly `scale` long, except the very last — the half-cell
 * step from the final ray cell's center to the board's true outer edge —
 * which is `scale / 2`. `drawSnakeOutFrame` relies on that uniform spacing
 * to place the leading arrowhead without walking the vertex list.
 */
export interface ExitPath {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly edgeDirs: Uint8Array;
  /** Length of the segment's own polyline, tail center to head center. Zero for a one-cell segment. */
  readonly dashLength: number;
  /** Full concatenated length: `dashLength` plus the exit ray to the board's outer edge. */
  readonly totalLength: number;
  readonly scale: number;
  readonly strokeColor: string;
}

/**
 * Builds `segmentId`'s exit path in `viewport`'s pixel space. Throws
 * `RangeError` for a `segmentId` outside the board or a malformed
 * `segColor`/`segDir` — a caller driving a per-frame loop should check the
 * segment with `drawSegmentGuarded` first, as `startSnakeOutAnimation` does.
 */
export function buildExitPath(
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<'css'>,
): ExitPath {
  requireValidSegmentId(board, segmentId);
  const start = board.segStart[segmentId - 1] as number;
  const end = board.segStart[segmentId] as number;
  const dir = requireDirection(board, segmentId);
  const segLen = end - start;
  const headCell = board.segCells[end - 1] as number;
  const numRaySteps = stepsToEdge(headCell, dir, board.width, board.height);

  const vertexCount = segLen + numRaySteps + 1;
  const xs = new Float64Array(vertexCount);
  const ys = new Float64Array(vertexCount);
  const edgeDirs = new Uint8Array(vertexCount - 1);

  let vi = 0;
  let prevCell = -1;
  for (let i = start; i < end; i++) {
    const cellIndex = board.segCells[i] as number;
    xs[vi] = cellCenterX(viewport, xOf(cellIndex, board.width));
    ys[vi] = cellCenterY(viewport, yOf(cellIndex, board.width));
    if (vi > 0) {
      const edgeDir = directionBetween(prevCell, cellIndex, board.width);
      edgeDirs[vi - 1] = edgeDir === -1 ? dir : edgeDir;
    }
    prevCell = cellIndex;
    vi++;
  }

  let rayCell = headCell;
  for (let s = 0; s < numRaySteps; s++) {
    rayCell = step(rayCell, dir, board.width, board.height);
    xs[vi] = cellCenterX(viewport, xOf(rayCell, board.width));
    ys[vi] = cellCenterY(viewport, yOf(rayCell, board.width));
    edgeDirs[vi - 1] = dir;
    vi++;
  }

  const dx = DX[dir] as number;
  const dy = DY[dir] as number;
  xs[vi] = (xs[vi - 1] as number) + dx * (viewport.scale / 2);
  ys[vi] = (ys[vi - 1] as number) + dy * (viewport.scale / 2);
  edgeDirs[vi - 1] = dir;

  const dashLength = (segLen - 1) * viewport.scale;
  const totalLength = (segLen - 1 + numRaySteps) * viewport.scale + viewport.scale / 2;
  const strokeColor = paletteColor(board.segColor[segmentId - 1] as number);

  return { xs, ys, edgeDirs, dashLength, totalLength, scale: viewport.scale, strokeColor };
}

/** The subset of a 2D context `drawSnakeOutFrame` needs beyond `StrokeContext2D`/`FillContext2D`. */
export interface DashContext2D extends StrokeContext2D, FillContext2D {
  lineDashOffset: number;
  setLineDash(segments: readonly number[]): void;
}

/**
 * Draws one frame of `path` at `progress` (0 at the segment's resting
 * position, 1 fully exited) onto `ctx`. `progress` outside `[0, 1]` is
 * clamped; it must still be finite, since a `NaN` dash offset silently draws
 * nothing and would fail a caller's completion check without ever throwing.
 *
 * A single dash the length of the segment's own body is stroked along the
 * concatenated path, offset so it starts at the tail at `progress = 0` and
 * has fully passed the path's end at `progress = 1`. An arrowhead is filled
 * at the dash's leading edge each frame, oriented to the path's local
 * direction there, so the piece keeps a visible head as it slithers — except
 * while that leading edge sits past the path's own end, and for a one-cell
 * segment's zero-length dash, which draws only the moving arrowhead.
 */
export function drawSnakeOutFrame(ctx: DashContext2D, path: ExitPath, progress: number): void {
  if (!Number.isFinite(progress)) {
    throw new RangeError(`progress must be a finite number, got ${progress}`);
  }
  const t = Math.min(1, Math.max(0, progress));
  const windowStart = t * path.totalLength;

  if (path.dashLength > 0) {
    ctx.strokeStyle = path.strokeColor;
    ctx.lineWidth = LINE_WIDTH_CELLS * path.scale;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([path.dashLength, path.totalLength]);
    ctx.lineDashOffset = windowStart === 0 ? 0 : -windowStart;
    ctx.beginPath();
    ctx.moveTo(path.xs[0] as number, path.ys[0] as number);
    for (let i = 1; i < path.xs.length; i++) {
      ctx.lineTo(path.xs[i] as number, path.ys[i] as number);
    }
    ctx.stroke();
  }

  if (windowStart >= path.totalLength) return;
  const leadArcLength =
    path.dashLength > 0 ? Math.min(windowStart + path.dashLength, path.totalLength) : windowStart;

  const uniformEdgeCount = path.edgeDirs.length - 1;
  const uniformLength = uniformEdgeCount * path.scale;
  let edgeIndex: number;
  let edgeT: number;
  if (uniformEdgeCount > 0 && leadArcLength <= uniformLength) {
    edgeIndex = Math.min(uniformEdgeCount - 1, Math.floor(leadArcLength / path.scale));
    edgeT = (leadArcLength - edgeIndex * path.scale) / path.scale;
  } else {
    edgeIndex = path.edgeDirs.length - 1;
    edgeT = (leadArcLength - uniformLength) / (path.scale / 2);
  }
  edgeT = Math.min(1, Math.max(0, edgeT));

  const ax = path.xs[edgeIndex] as number;
  const ay = path.ys[edgeIndex] as number;
  const bx = path.xs[edgeIndex + 1] as number;
  const by = path.ys[edgeIndex + 1] as number;
  const leadX = ax + (bx - ax) * edgeT;
  const leadY = ay + (by - ay) * edgeT;
  const leadDir = path.edgeDirs[edgeIndex] as Direction;

  fillArrowheadAt(ctx, leadX, leadY, leadDir, path.scale, path.strokeColor);
}

function requirePositiveFiniteDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be a positive finite number, got ${durationMs}`);
  }
}

/**
 * The clock and frame source `startSnakeOutAnimation` drives itself from,
 * rather than reaching for `performance.now`/`requestAnimationFrame`
 * directly — so a caller can supply a fake one in a test, and so the one
 * real implementation (`createDomScheduler`) is the only place those globals
 * are touched.
 *
 * `onVisible` is what makes completion reliable across a backgrounded tab:
 * `requestFrame` callbacks stop arriving while the tab is hidden, so a
 * caller of `startSnakeOutAnimation` subscribes it to "the tab is visible
 * again" and calls back only then. The animation itself never polls a
 * timer alongside `requestFrame` — elapsed wall-clock time against `now()`
 * is the one clock both paths check.
 */
export interface SnakeOutScheduler {
  now(): number;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  /** Subscribes to the tab regaining visibility. Returns an unsubscribe function. */
  onVisible(callback: () => void): () => void;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** The real scheduler: `requestAnimationFrame`, `performance.now`, and `document`'s visibility event. */
export function createDomScheduler(): SnakeOutScheduler {
  return {
    now: defaultNow,
    requestFrame(callback) {
      return requestAnimationFrame(callback);
    },
    cancelFrame(handle) {
      cancelAnimationFrame(handle);
    },
    onVisible(callback) {
      const handler = (): void => {
        if (document.visibilityState === 'visible') callback();
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
  };
}

export interface SnakeOutAnimationOptions {
  readonly board: Board;
  readonly segmentId: SegmentId;
  /** The screen viewport pan/zoom maintains — the same one hit testing and the static-layer blit use. */
  readonly viewport: Viewport<'css'>;
  readonly durationMs: number;
  readonly layer: AnimationLayer;
  readonly scheduler: SnakeOutScheduler;
  /** Called exactly once: on natural completion, or once on a backgrounded-tab catch-up. Never called after `cancel()`. */
  readonly onComplete: () => void;
}

export interface SnakeOutAnimation {
  /** Stops the animation without calling `onComplete`. Safe to call more than once, and after completion. */
  cancel(): void;
}

/**
 * Drives one segment's exit animation on `options.layer`, leaving every
 * other layer untouched. Validates `segmentId` and `durationMs` up front —
 * both are the caller's own choice, so a bad one is rejected rather than
 * absorbed. `board` itself may still carry a malformed `segColor`/`segDir`
 * for this segment; that is checked with `drawSegmentGuarded` before any
 * frame is scheduled, and turns into an immediate, silent completion rather
 * than a throw out of a per-frame loop.
 */
export function startSnakeOutAnimation(options: SnakeOutAnimationOptions): SnakeOutAnimation {
  const { board, segmentId, viewport, durationMs, layer, scheduler, onComplete } = options;
  requireValidSegmentId(board, segmentId);
  requirePositiveFiniteDuration(durationMs);

  let settled = false;
  let frameHandle: number | null = null;
  let unsubscribeVisible: (() => void) | null = null;

  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (frameHandle !== null) {
      scheduler.cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (unsubscribeVisible !== null) {
      unsubscribeVisible();
      unsubscribeVisible = null;
    }
  };

  const complete = (): void => {
    if (settled) return;
    finish();
    onComplete();
  };

  const guardedOk = drawSegmentGuarded(layer.ctx, board, segmentId, viewport);
  clearAnimationLayer(layer);
  if (!guardedOk) {
    frameHandle = scheduler.requestFrame(() => complete());
    return { cancel: finish };
  }

  const path = buildExitPath(board, segmentId, viewport);
  const startTime = scheduler.now();
  drawSnakeOutFrame(layer.ctx, path, 0);

  const step = (time: number): void => {
    frameHandle = null;
    const progress = (time - startTime) / durationMs;
    clearAnimationLayer(layer);
    drawSnakeOutFrame(layer.ctx, path, progress);
    if (progress >= 1) {
      complete();
    } else {
      frameHandle = scheduler.requestFrame(step);
    }
  };
  frameHandle = scheduler.requestFrame(step);

  unsubscribeVisible = scheduler.onVisible(() => {
    if (scheduler.now() - startTime < durationMs) return;
    clearAnimationLayer(layer);
    drawSnakeOutFrame(layer.ctx, path, 1);
    complete();
  });

  return { cancel: finish };
}
