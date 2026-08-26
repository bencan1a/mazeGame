/**
 * The opening reveal: the board draws itself one segment at a time along the
 * path while the camera pulls straight back from the middle of the board to
 * the whole silhouette.
 *
 * Segment ids run along the path, so revealing them in id order draws the
 * board as one continuous line filling the shape rather than as pieces
 * appearing at random. The reveal is paced by cell count rather than segment
 * count — `revealedSegmentCount` — so the line grows at a steady speed
 * whatever lengths the peel happened to produce.
 *
 * Nothing here paints. The driver reports a frame's progress and reveal
 * count; the caller draws the newly revealed segments onto the static buffer
 * and blits it through the camera this module computes.
 */

import type { Board } from '../core/types.js';
import type { SnakeOutScheduler } from './animate.js';
import { clampPan, createViewport, type PanBounds, type Viewport } from './viewport.js';

/** How long the whole reveal takes. */
export const INTRO_DURATION_MS = 1400;

/** Where the camera starts, as a multiple of the resting fit scale. */
export const INTRO_START_ZOOM = 2.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * easeInOutCubic. Symmetric rather than front-loaded so the camera holds the
 * close view long enough to read, sweeps out through the middle, and settles
 * onto the resting viewport instead of arriving at it and stopping dead.
 */
export function introEase(progress: number): number {
  const t = clamp01(progress);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * How many segments are drawn at `progress`: every segment whose cells all
 * fall within the leading `progress` of the path. Counting cells rather than
 * segments keeps the drawing speed even, since segment lengths vary.
 */
export function revealedSegmentCount(board: Board, progress: number): number {
  const total = board.segCells.length;
  if (total === 0 || board.segmentCount === 0) return board.segmentCount;
  const target = clamp01(progress) * total;
  // segStart is non-decreasing, so this is the largest k with segStart[k] <= target.
  let lo = 0;
  let hi = board.segmentCount;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((board.segStart[mid] as number) <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface IntroCameraOptions {
  /** The viewport the reveal lands on — fitted to the canvas and pan-clamped. */
  readonly resting: Viewport<'css'>;
  /** CSS px per cell the reveal opens at. A value the camera cannot use falls back to `resting`. */
  readonly startScale: number;
  readonly progress: number;
  readonly bounds: PanBounds;
}

/**
 * The camera for one frame of the reveal: the board's own centre held under
 * the middle of the canvas throughout, at a scale eased from `startScale` to
 * `resting`. Only the scale moves, so the board grows out from where it
 * already is rather than travelling across the canvas as it grows.
 *
 * At the resting scale the board fits the canvas, where `clampPan` centres
 * it — the same origin this computes — so progress 1 lands exactly on
 * `resting`.
 */
export function introCamera(options: IntroCameraOptions): Viewport<'css'> {
  const { resting, startScale, bounds } = options;
  const scale = startScale + (resting.scale - startScale) * introEase(options.progress);
  if (!Number.isFinite(scale) || scale <= 0) return resting;

  return clampPan(
    createViewport({
      scale,
      dpr: resting.dpr,
      originX: (bounds.canvasCssWidth - bounds.boardWidth * scale) / 2,
      originY: (bounds.canvasCssHeight - bounds.boardHeight * scale) / 2,
    }),
    bounds,
  );
}

export interface IntroFrame {
  /** 0 at the opening view, 1 on the resting one. */
  readonly progress: number;
  /** Segments 1..`revealedCount` are drawn by the end of this frame. */
  readonly revealedCount: number;
}

export interface IntroAnimationOptions {
  readonly board: Board;
  readonly durationMs: number;
  readonly scheduler: SnakeOutScheduler;
  /**
   * Paints one frame. Called with a non-decreasing `revealedCount`, so a
   * caller may draw only what the previous call did not.
   */
  readonly onFrame: (frame: IntroFrame) => void;
  /**
   * Called exactly once, when the reveal ends — after the final full-reveal
   * frame, or in its place if painting that frame failed. Never after
   * `cancel()`.
   */
  readonly onComplete: () => void;
}

export interface IntroAnimation {
  /** Ends the reveal now: draws the finished board, then completes. */
  finish(): void;
  /** Stops without a final frame and without completing. Safe to call twice. */
  cancel(): void;
}

/**
 * Drives the reveal off `scheduler`, one `onFrame` per animation frame.
 *
 * The first frame is painted synchronously so the caller never shows an
 * un-revealed board, and completion is always deferred to a frame or to an
 * explicit `finish()` — a caller has to be holding the handle before
 * `onComplete` can run.
 */
export function startIntroAnimation(options: IntroAnimationOptions): IntroAnimation {
  const { board, durationMs, scheduler, onFrame, onComplete } = options;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be a positive finite number, got ${durationMs}`);
  }

  let settled = false;
  let frameHandle: number | null = null;
  let unsubscribeVisible: (() => void) | null = null;

  const release = (): void => {
    if (frameHandle !== null) {
      scheduler.cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (unsubscribeVisible !== null) {
      unsubscribeVisible();
      unsubscribeVisible = null;
    }
  };

  /**
   * A frame can throw while a resize is replacing the canvas under it. Losing
   * the reveal is survivable; leaving the caller without its completion is
   * not, so every paint goes through here and a failure ends the reveal
   * rather than escaping into the frame callback.
   */
  const guard = (body: () => void): boolean => {
    try {
      body();
      return true;
    } catch {
      return false;
    }
  };

  const finish = (): void => {
    if (settled) return;
    settled = true;
    release();
    guard(() => onFrame({ progress: 1, revealedCount: board.segmentCount }));
    onComplete();
  };

  const cancel = (): void => {
    if (settled) return;
    settled = true;
    release();
  };

  const startTime = scheduler.now();
  const elapsed = (): number => scheduler.now() - startTime;

  const step = (): void => {
    frameHandle = null;
    if (settled) return;
    const progress = Math.min(1, elapsed() / durationMs);
    if (progress >= 1) {
      finish();
      return;
    }
    const drawn = guard(() =>
      onFrame({ progress, revealedCount: revealedSegmentCount(board, progress) }),
    );
    if (!drawn) {
      finish();
      return;
    }
    frameHandle = scheduler.requestFrame(step);
  };

  guard(() => onFrame({ progress: 0, revealedCount: revealedSegmentCount(board, 0) }));

  // Frames stop arriving while the tab is hidden, so a reveal started into a
  // backgrounded tab would otherwise never reach its caller's completion.
  unsubscribeVisible = scheduler.onVisible(() => {
    if (settled || elapsed() < durationMs) return;
    finish();
  });
  frameHandle = scheduler.requestFrame(step);

  return { finish, cancel };
}
