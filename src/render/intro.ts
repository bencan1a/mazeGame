/**
 * The opening reveal: the board draws itself one segment at a time along the
 * path while the camera pulls back from a close view of where the drawing
 * starts to the whole silhouette.
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
import {
  cell,
  clampPan,
  createViewport,
  type Cell,
  type PanBounds,
  type Viewport,
} from './viewport.js';

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

/**
 * The cell the camera opens on: the tail of the first segment, which is where
 * the path — and so the reveal — begins. A board with no segments has nowhere
 * to look, so the centre stands in.
 */
export function introFocusCell(board: Board): Cell {
  if (board.segmentCount === 0 || board.segCells.length === 0) {
    return cell((board.width - 1) / 2, (board.height - 1) / 2);
  }
  const index = board.segCells[0] as number;
  return cell(index % board.width, Math.floor(index / board.width));
}

export interface IntroCameraOptions {
  /** The viewport the reveal lands on — fitted to the canvas and pan-clamped. */
  readonly resting: Viewport<'css'>;
  /** CSS px per cell the reveal opens at. A value the camera cannot use falls back to `resting`. */
  readonly startScale: number;
  /** Board cell the opening view is centred on. See `introFocusCell`. */
  readonly focus: Cell;
  readonly progress: number;
  readonly bounds: PanBounds;
}

/**
 * The camera for one frame of the reveal: `startScale` centred on `focus` at
 * progress 0, `resting` at progress 1, eased between. Both the scale and the
 * origin move on the same ease, so the pull-back reads as one motion rather
 * than a zoom racing a pan.
 *
 * The result is pan-clamped, which is what keeps an opening focus near a
 * corner from showing empty space beside the board.
 */
export function introCamera(options: IntroCameraOptions): Viewport<'css'> {
  const { resting, startScale, focus, bounds } = options;
  const eased = introEase(options.progress);
  const scale = startScale + (resting.scale - startScale) * eased;
  if (!Number.isFinite(scale) || scale <= 0) return resting;

  const focusOriginX = bounds.canvasCssWidth / 2 - (focus.x + 0.5) * scale;
  const focusOriginY = bounds.canvasCssHeight / 2 - (focus.y + 0.5) * scale;
  return clampPan(
    createViewport({
      scale,
      dpr: resting.dpr,
      originX: focusOriginX + (resting.originX - focusOriginX) * eased,
      originY: focusOriginY + (resting.originY - focusOriginY) * eased,
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
