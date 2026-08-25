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
  ARROWHEAD_LENGTH_CELLS,
  CORNER_RADIUS_CELLS,
  LINE_WIDTH_CELLS,
  fillArrowheadAt,
  requireDirection,
  strokeCorner,
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
 * A segment's exit path: its own route (tail to head, cell center to cell
 * center, rounding each bend), the exit ray (head to the board's outer
 * edge), and a final straight run continuing past the board in the same
 * direction — precomputed once so a per-frame draw only ever restrokes the
 * same geometry with a different dash offset. `edgeDirs[k]` is the direction
 * travelled between vertex `k` and vertex `k + 1`.
 *
 * Every edge is exactly `scale` long except the very last, which absorbs
 * both the half-cell step to the board's true outer edge and the run beyond
 * it — long enough that by `progress = 1` the dash and the arrowhead riding
 * at its leading edge have both fully passed the board, so `drawSnakeOutFrame`
 * never has to place either past a vertex the path doesn't have.
 *
 * Distances along it — `dashLength`, `totalLength`, the dash offset a frame
 * sets, the arrowhead's place — are arc lengths on the rounded route, which
 * is shorter than the polyline through the same vertices: that is the space
 * a dashed stroke on a canvas measures itself in.
 */
export interface ExitPath {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly edgeDirs: Uint8Array;
  /**
   * Radius the path rounds each vertex with, 0 where it runs straight
   * through. Both ends are 0, and so is the head vertex: that one carries
   * the arrowhead at rest, which has to sit on the head cell's own centre
   * pointing along `segDir`, exactly as the static layer draws it.
   */
  readonly cornerRadii: Float64Array;
  /** Index of the head cell's vertex: where the segment's own body ends and the exit ray begins. */
  readonly headVertex: number;
  /** Length of the segment's own body along the rounded route, tail center to head center. Zero for a one-cell segment. */
  readonly dashLength: number;
  /**
   * How far `progress` travels the dash's own trailing edge: the ray to the
   * board's outer edge, plus whatever extra a segment whose own body
   * (`dashLength`) is shorter than an arrowhead's reach still needs. Not the
   * path's own drawn length — the arrowhead, riding `dashLength` ahead of
   * the trailing edge, can still be over real vertices well past this point.
   */
  readonly totalLength: number;
  readonly scale: number;
  readonly strokeColor: string;
}

/**
 * The cell-space part of a segment's exit path: which cells it passes
 * through and which direction each edge between them travels. None of this
 * depends on the viewport, so it is computed once per segment and reused by
 * `layoutExitPath` across however many viewports the exit is drawn at (a pan
 * or a pinch resizes the same journey rather than choosing a different one).
 * `cellIndices` covers the on-board vertices only — the polyline followed by
 * the ray — in tail-to-head-to-edge order; the final, off-board vertex
 * `layoutExitPath` appends has no cell of its own. `edgeDirs` covers every
 * edge, including that last one.
 */
interface ExitTopology {
  readonly cellIndices: Uint32Array;
  readonly edgeDirs: Uint8Array;
  readonly dir: Direction;
  readonly width: number;
  /** Index of the head cell's vertex, which is also how many edges the segment's own body has. */
  readonly headVertex: number;
  readonly strokeColor: string;
}

/**
 * Builds `segmentId`'s exit topology. Throws `RangeError` for a `segmentId`
 * outside the board, a segment with no cells, or a malformed
 * `segColor`/`segDir`.
 */
function buildExitTopology(board: Board, segmentId: SegmentId): ExitTopology {
  requireValidSegmentId(board, segmentId);
  const start = board.segStart[segmentId - 1] as number;
  const end = board.segStart[segmentId] as number;
  if (end <= start) {
    throw new RangeError(`segment ${segmentId} has no cells`);
  }
  const dir = requireDirection(board, segmentId);
  const segLen = end - start;
  const headCell = board.segCells[end - 1] as number;
  const numRaySteps = stepsToEdge(headCell, dir, board.width, board.height);

  const onBoardCount = segLen + numRaySteps;
  const cellIndices = new Uint32Array(onBoardCount);
  const edgeDirs = new Uint8Array(onBoardCount);

  let vi = 0;
  let prevCell = -1;
  for (let i = start; i < end; i++) {
    const cellIndex = board.segCells[i] as number;
    cellIndices[vi] = cellIndex;
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
    cellIndices[vi] = rayCell;
    edgeDirs[vi - 1] = dir;
    vi++;
  }
  edgeDirs[onBoardCount - 1] = dir;

  return {
    cellIndices,
    edgeDirs,
    dir,
    width: board.width,
    headVertex: segLen - 1,
    strokeColor: paletteColor(board.segColor[segmentId - 1] as number),
  };
}

/** Arc length a rounded corner of `radius` saves against the two straight legs it replaces. */
function cornerShortening(radius: number): number {
  return radius * (2 - Math.PI / 2);
}

/**
 * Lays `topology` out at `viewport`'s scale and origin, writing vertices and
 * corner radii into the caller's arrays in place — sized to
 * `topology.cellIndices.length + 1` by the caller — rather than allocating
 * new ones, so a caller re-laying the same topology out at a new viewport (a
 * pan or a pinch mid-exit) does not pay for a fresh `ExitPath` on every
 * frame.
 */
function layoutExitPath(
  topology: ExitTopology,
  viewport: Viewport<'css'>,
  xs: Float64Array,
  ys: Float64Array,
  cornerRadii: Float64Array,
): { readonly dashLength: number; readonly totalLength: number } {
  const { cellIndices, edgeDirs, dir, width } = topology;
  for (let i = 0; i < cellIndices.length; i++) {
    const cellIndex = cellIndices[i] as number;
    xs[i] = cellCenterX(viewport, xOf(cellIndex, width));
    ys[i] = cellCenterY(viewport, yOf(cellIndex, width));
  }

  // Every leg between two cell centers is one cell, and CORNER_RADIUS_CELLS
  // is bounded at half of that, so no corner's radius is ever clamped here.
  const radius = CORNER_RADIUS_CELLS * viewport.scale;
  const last = cellIndices.length - 1;
  cornerRadii[0] = 0;
  cornerRadii[cellIndices.length] = 0;
  let onBoardLength = 0;
  let dashLength = 0;
  let previousRadius = 0;
  for (let k = 1; k <= last; k++) {
    const turns = edgeDirs[k - 1] !== edgeDirs[k];
    const cornerRadius = turns && k !== topology.headVertex ? radius : 0;
    cornerRadii[k] = cornerRadius;
    onBoardLength +=
      viewport.scale - cornerShortening(previousRadius) / 2 - cornerShortening(cornerRadius) / 2;
    if (k === topology.headVertex) dashLength = onBoardLength;
    previousRadius = cornerRadius;
  }

  const arrowReach = ARROWHEAD_LENGTH_CELLS * viewport.scale;
  const capRadius = (LINE_WIDTH_CELLS / 2) * viewport.scale;
  const totalLength =
    onBoardLength + viewport.scale / 2 + capRadius + Math.max(0, arrowReach - dashLength);
  const finalEdgeLength = totalLength + dashLength - onBoardLength;

  const dx = DX[dir] as number;
  const dy = DY[dir] as number;
  xs[cellIndices.length] = (xs[last] as number) + dx * finalEdgeLength;
  ys[cellIndices.length] = (ys[last] as number) + dy * finalEdgeLength;

  return { dashLength, totalLength };
}

/**
 * Builds `segmentId`'s exit path in `viewport`'s pixel space. Throws
 * `RangeError` for a `segmentId` outside the board, a segment with no cells,
 * or a malformed `segColor`/`segDir`.
 */
export function buildExitPath(
  board: Board,
  segmentId: SegmentId,
  viewport: Viewport<'css'>,
): ExitPath {
  const topology = buildExitTopology(board, segmentId);
  const vertexCount = topology.cellIndices.length + 1;
  const xs = new Float64Array(vertexCount);
  const ys = new Float64Array(vertexCount);
  const cornerRadii = new Float64Array(vertexCount);
  const { dashLength, totalLength } = layoutExitPath(topology, viewport, xs, ys, cornerRadii);
  return {
    xs,
    ys,
    edgeDirs: topology.edgeDirs,
    cornerRadii,
    headVertex: topology.headVertex,
    dashLength,
    totalLength,
    scale: viewport.scale,
    strokeColor: topology.strokeColor,
  };
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
 * concatenated route, offset so it starts at the tail at `progress = 0` and
 * has its trailing edge at the board's true edge — or a little past it, for
 * a segment short enough that its arrowhead would not otherwise clear — by
 * `progress = 1` (see `buildExitPath`). An arrowhead is filled at the dash's
 * leading edge each frame, oriented to the path's local direction there —
 * for a one-cell segment, whose dash has zero length, that edge is the whole
 * piece, so only the moving arrowhead is drawn.
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
    // The gap exceeds the path so the pattern cannot wrap: an exactly-equal
    // period puts a zero-length dash back at distance 0 when the offset
    // reaches the end, which a round cap draws as a dot on the tail cell.
    ctx.setLineDash([path.dashLength, path.totalLength + path.dashLength]);
    ctx.lineDashOffset = windowStart === 0 ? 0 : -windowStart;
    ctx.beginPath();
    ctx.moveTo(path.xs[0] as number, path.ys[0] as number);
    const lastVertex = path.xs.length - 1;
    for (let i = 1; i < lastVertex; i++) {
      strokeCorner(
        ctx,
        path.xs[i] as number,
        path.ys[i] as number,
        path.xs[i + 1] as number,
        path.ys[i + 1] as number,
        path.cornerRadii[i] as number,
      );
    }
    ctx.lineTo(path.xs[lastVertex] as number, path.ys[lastVertex] as number);
    ctx.stroke();
    // The layer's context is reused across exits and `clearAnimationLayer`
    // preserves it, so a dash left set here would apply to the next stroke.
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // The route past the head vertex is the exit ray, which never turns, so
  // the leading edge is that far straight along it — `windowStart` is
  // already the lead's distance past the head, whatever the body behind it
  // curved through.
  const rayDir = path.edgeDirs[path.headVertex] as Direction;
  const rayX = DX[rayDir] as number;
  const rayY = DY[rayDir] as number;
  const leadX = (path.xs[path.headVertex] as number) + rayX * windowStart;
  const leadY = (path.ys[path.headVertex] as number) + rayY * windowStart;

  fillArrowheadAt(ctx, leadX, leadY, rayDir, path.scale, path.strokeColor);
}

function requirePositiveFiniteDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be a positive finite number, got ${durationMs}`);
  }
}

/** `buildExitTopology`, with a `RangeError` turned into `null` instead of a throw. */
function tryBuildExitTopology(board: Board, segmentId: SegmentId): ExitTopology | null {
  try {
    return buildExitTopology(board, segmentId);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

/** Whether two `'css'` viewports differ in a way that changes the geometry `buildExitPath` computes. */
export function viewportChanged(a: Viewport<'css'>, b: Viewport<'css'>): boolean {
  return a.scale !== b.scale || a.originX !== b.originX || a.originY !== b.originY;
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
  /**
   * The screen viewport pan/zoom maintains — the same one hit testing and the
   * static-layer blit use. Pass a getter when the viewport can change during
   * the exit: pan and pinch replace it, and a path built against the old one
   * draws the segment at a scale and origin the blit no longer uses.
   */
  readonly viewport: Viewport<'css'> | (() => Viewport<'css'>);
  readonly durationMs: number;
  /**
   * The animation layer to draw into. Pass a getter when the layer can be
   * replaced during the exit: a resize or orientation change recreates the
   * canvas the same way a pan or pinch replaces the viewport, and drawing
   * into a discarded layer strands the segment on a canvas nothing blits
   * again for the rest of its flight.
   */
  readonly layer: AnimationLayer | (() => AnimationLayer);
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
 * absorbed. `board` itself may still carry a segment with no cells or a
 * malformed `segColor`/`segDir`; that is checked with `tryBuildExitTopology`
 * before any frame is scheduled, and turns into an immediate, silent
 * completion rather than a throw out of a per-frame loop.
 */
export function startSnakeOutAnimation(options: SnakeOutAnimationOptions): SnakeOutAnimation {
  const { board, segmentId, durationMs, scheduler, onComplete } = options;
  const readViewport = (): Viewport<'css'> =>
    typeof options.viewport === 'function' ? options.viewport() : options.viewport;
  const readLayer = (): AnimationLayer =>
    typeof options.layer === 'function' ? options.layer() : options.layer;
  requireValidSegmentId(board, segmentId);
  requirePositiveFiniteDuration(durationMs);

  let settled = false;
  let frameHandle: number | null = null;
  let unsubscribeVisible: (() => void) | null = null;

  const finish = (): void => {
    if (settled) return;
    settled = true;
    // The frame and the subscription are released first: reading the layer
    // can throw while an orientation change is recreating the canvas, and a
    // throw here would otherwise leak the listener for the page's lifetime
    // and leave the caller's completion unreachable.
    if (frameHandle !== null) {
      scheduler.cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (unsubscribeVisible !== null) {
      unsubscribeVisible();
      unsubscribeVisible = null;
    }
    try {
      clearAnimationLayer(readLayer());
    } catch {
      // Nothing to clear if the layer is gone; the caller still gets its
      // completion, which is the part the game loop is waiting on.
    }
  };

  const complete = (): void => {
    if (settled) return;
    finish();
    onComplete();
  };

  const startTime = scheduler.now();
  const elapsed = (): number => scheduler.now() - startTime;

  /**
   * Runs `body` and reports whether it survived. Both getters and the drawing
   * they feed can fail while a resize is recreating the canvas, and a throw
   * escaping a frame would leave nothing scheduled and the caller's completion
   * unreachable — so every read and draw goes through here. The caller decides
   * how to settle: before this function returns its handle, completion must be
   * deferred to a frame, or `onComplete` would run before the caller can hold
   * the handle it is expected to cancel.
   */
  const guard = (body: () => void): boolean => {
    try {
      body();
      return true;
    } catch {
      return false;
    }
  };

  /** Subscribes and schedules only while still live, so teardown cannot be outrun. */
  const arm = (onFrame: () => void): void => {
    if (settled) return;
    unsubscribeVisible = scheduler.onVisible(() => {
      if (settled || elapsed() < durationMs) return;
      complete();
    });
    if (settled) {
      unsubscribeVisible();
      unsubscribeVisible = null;
      return;
    }
    frameHandle = scheduler.requestFrame(onFrame);
  };

  const topology = tryBuildExitTopology(board, segmentId);
  if (topology === null) {
    guard(() => clearAnimationLayer(readLayer()));
    arm(() => complete());
    return { cancel: finish };
  }

  let setupViewport: Viewport<'css'> | null = null;
  if (!guard(() => void (setupViewport = { ...readViewport() })) || setupViewport === null) {
    arm(() => complete());
    return { cancel: finish };
  }
  let pathViewport: Viewport<'css'> = setupViewport;
  const vertexCount = topology.cellIndices.length + 1;
  const xs = new Float64Array(vertexCount);
  const ys = new Float64Array(vertexCount);
  const cornerRadii = new Float64Array(vertexCount);
  const path: ExitPath = {
    xs,
    ys,
    edgeDirs: topology.edgeDirs,
    cornerRadii,
    headVertex: topology.headVertex,
    dashLength: 0,
    totalLength: 0,
    scale: pathViewport.scale,
    strokeColor: topology.strokeColor,
  };
  const applyLayout = (viewport: Viewport<'css'>): void => {
    const { dashLength, totalLength } = layoutExitPath(topology, viewport, xs, ys, cornerRadii);
    Object.assign(path, { dashLength, totalLength, scale: viewport.scale });
  };
  applyLayout(pathViewport);
  const currentPath = (): ExitPath => {
    const now = readViewport();
    if (viewportChanged(now, pathViewport)) {
      pathViewport = { ...now };
      applyLayout(pathViewport);
    }
    return path;
  };

  const drewFirst = guard(() => {
    const layer = readLayer();
    clearAnimationLayer(layer);
    drawSnakeOutFrame(layer.ctx, path, 0);
  });
  if (!drewFirst) {
    arm(() => complete());
    return { cancel: finish };
  }

  const step = (): void => {
    frameHandle = null;
    if (settled) return;
    // At progress 1 the dash window has passed the path's end entirely, so the
    // frame would draw nothing; the clear below is the whole of it.
    const progress = Math.min(1, elapsed() / durationMs);
    if (progress >= 1) {
      complete();
      return;
    }
    const drawn = guard(() => {
      const layer = readLayer();
      clearAnimationLayer(layer);
      drawSnakeOutFrame(layer.ctx, currentPath(), progress);
    });
    if (!drawn) {
      complete();
      return;
    }
    frameHandle = scheduler.requestFrame(step);
  };

  arm(step);

  return { cancel: finish };
}
