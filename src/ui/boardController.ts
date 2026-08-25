import { generateBoardWithDiagnostics } from '../core/generate.js';
import { computeMetrics } from '../core/metrics.js';
import type {
  Board,
  BoardMetrics,
  GenParams,
  HamiltonianPath,
  Mask,
  PlayParams,
} from '../core/types.js';
import {
  animationComplete,
  createGameState,
  createGestureArbiter,
  hitTest,
  isFree,
  isRemoved,
  restart,
  restoreGameState,
  snapshotGameState,
  tap,
  type GameSnapshot,
  type GameState,
  type GestureArbiter,
} from '../game/index.js';
import {
  blitStaticLayer,
  clampPan,
  clampZoomScale,
  computeBlitRects,
  createAnimationLayer,
  createStaticLayer,
  createDomScheduler,
  createViewport,
  isLayerLegibleUnzoomed,
  maxZoomScale,
  panViewport,
  redrawStaticLayer,
  removedSetsDiffer,
  startSnakeOutAnimation,
  zoomViewportAt,
  type AnimationLayer,
  type SnakeOutAnimation,
  type StaticLayer,
  type PanBounds,
  type Viewport,
} from '../render/index.js';

/** What the React chrome renders. Never includes anything the canvas draws. */
export interface BoardHud {
  readonly lives: number;
  readonly status: GameState['status'];
  readonly removedCount: number;
  readonly segmentCount: number;
  readonly gridSize: number;
  /** False when arrowheads are below the legible floor at the resting scale. */
  readonly legibleUnzoomed: boolean;
  /**
   * False when every rung of the buffer's readback probe failed. The board
   * then draws nothing while remaining fully tappable, so the chrome has to
   * say so rather than present a black board as an empty one.
   */
  readonly bufferOk: boolean;
  /** Segments the buffer could not draw, from malformed colour or direction. */
  readonly droppedSegments: number;
}

export interface BoardController {
  getHud(): BoardHud;
  subscribe(listener: (hud: BoardHud) => void): () => void;
  restartBoard(): void;
  /**
   * Rebuilds the board from new parameters, in place. Throws whatever
   * generation threw, having changed nothing — the board on screen stays
   * playable under its old parameters.
   */
  reconfigure(genParams: GenParams, playParams?: PlayParams): void;
  getGenParams(): GenParams;
  getPlayParams(): PlayParams;
  /** What a caller would have to store to resume this game after a reload. */
  getSnapshot(): GameSnapshot;
  /** Metrics for the board on screen, computed on first call and reused after. */
  getMetrics(): BoardMetrics;
  destroy(): void;
}

/**
 * Everything a caller needs to write a resumable save, in one payload. It
 * carries `status` because a won or lost board must not be resumed — it would
 * come back already over, with no way to play it — and `segmentCount` because
 * the first callback fires before the constructor has returned, so a caller
 * has no controller to read it off yet.
 */
export interface ResumableState {
  readonly snapshot: GameSnapshot;
  readonly genParams: GenParams;
  readonly playParams: PlayParams;
  readonly segmentCount: number;
  readonly status: GameState['status'];
}

export interface BoardControllerOptions {
  /**
   * Resumes a saved game on the generated board rather than starting fresh.
   * A snapshot that does not fit the board throws out of the constructor,
   * leaving the caller to decide between a fresh board and an error.
   */
  readonly snapshot?: GameSnapshot;
  /**
   * Segment count the `snapshot` was taken against. A generated board that
   * disagrees is the same seed describing different segments, so the removed
   * set no longer names what the player cleared — the constructor throws
   * rather than resuming a game onto a board it does not fit.
   */
  readonly expectedSegmentCount?: number;
  /**
   * Called whenever the resumable state changes — a settled tap, a restart, a
   * reconfigure. The controller holds no storage of its own; this is the hook
   * a persistence layer writes through.
   */
  readonly onSnapshot?: (state: ResumableState) => void;
}

export interface BoardCanvases {
  /** Receives the static buffer's blit. */
  readonly base: HTMLCanvasElement;
  /** Receives the exiting segment, stacked over `base`. */
  readonly overlay: HTMLCanvasElement;
  /** Takes the pointer listeners and defines the CSS-pixel origin. */
  readonly surface: HTMLElement;
}

/**
 * Whether the offscreen buffer has to be repainted. `drawn` is null before
 * anything has been painted, which an empty set is otherwise indistinguishable
 * from — treating those alike reads as "no change" and skips the first paint.
 */
export function removedSetChanged(
  drawn: ReadonlySet<number> | null,
  current: ReadonlySet<number>,
): boolean {
  return drawn === null || removedSetsDiffer(drawn, current);
}

/**
 * Pan bounds for a board on a canvas. `boardWidth`/`boardHeight` are in cells,
 * not CSS pixels — `clampPan` multiplies them by the viewport's own scale, so
 * passing pixels scales twice and the board never centres.
 */
export function boardPanBounds(
  board: Board,
  canvasCssWidth: number,
  canvasCssHeight: number,
): PanBounds {
  return {
    boardWidth: board.width,
    boardHeight: board.height,
    canvasCssWidth,
    canvasCssHeight,
  };
}

interface GeneratedBoard {
  readonly board: Board;
  readonly mask: Mask;
  readonly path: HamiltonianPath;
  readonly generationMs: number;
}

/**
 * `src/core/` cannot read a clock, so the caller times the call and hands the
 * reading to `computeMetrics`. `mask` and `path` come out for the same
 * reason: coverage counts against the silhouette's inside cells and the bend
 * rate against the walk, neither of which a finished `Board` records.
 */
function generateTimed(params: GenParams): GeneratedBoard {
  const startedAt = performance.now();
  const { board, mask, path } = generateBoardWithDiagnostics(params);
  return { board, mask, path, generationMs: performance.now() - startedAt };
}

function readDpr(): number {
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/**
 * Owns the board, both canvases and every pointer listener, entirely outside
 * React. The only thing crossing back is `BoardHud`, which the chrome renders.
 */
export function createBoardController(
  canvases: BoardCanvases,
  initialGenParams: GenParams,
  initialPlayParams: PlayParams,
  options: BoardControllerOptions = {},
): BoardController {
  const { base, overlay, surface } = canvases;
  const scheduler = createDomScheduler();

  let genParams: GenParams = initialGenParams;
  let playParams: PlayParams = initialPlayParams;
  let generated: GeneratedBoard = generateTimed(genParams);
  let board: Board = generated.board;
  let metrics: BoardMetrics | null = null;

  if (
    options.snapshot !== undefined &&
    options.expectedSegmentCount !== undefined &&
    options.expectedSegmentCount !== board.segmentCount
  ) {
    throw new RangeError(
      `createBoardController: saved game expects ${options.expectedSegmentCount} segments, ` +
        `seed ${genParams.seed} now generates ${board.segmentCount}`,
    );
  }
  let state: GameState =
    options.snapshot === undefined
      ? createGameState(board, playParams)
      : restoreGameState(board, playParams, options.snapshot);
  let dpr = readDpr();
  let cssWidth = 1;
  let cssHeight = 1;
  let staticLayer: StaticLayer = createStaticLayer(board, { dpr });
  let animationLayer: AnimationLayer | null = null;
  let animation: SnakeOutAnimation | null = null;
  let drawnRemoved: Set<number> | null = null;
  let viewport: Viewport<'css'> = createViewport({ scale: 1, dpr });
  let legibleUnzoomed = true;
  let bounceHandle: number | null = null;
  /** False once the visible canvas has refused a 2d context, leaving a blank board. */
  let canvasOk = true;
  let blitPending = false;
  /** True once the player has pinched; until then every layout re-fits the board. */
  let userZoomed = false;
  let disposed = false;

  const listeners = new Set<(hud: BoardHud) => void>();
  const hud = (): BoardHud => ({
    lives: state.lives,
    // While a piece is still leaving, the board is not yet cleared or lost
    // whatever the state machine has already resolved.
    status: state.animating ? 'playing' : state.status,
    removedCount: state.removedCount,
    segmentCount: board.segmentCount,
    gridSize: genParams.gridSize,
    legibleUnzoomed,
    bufferOk: staticLayer.allocationOk && canvasOk,
    droppedSegments: staticLayer.droppedSegments.length,
  });
  const publish = (): void => {
    const snapshot = hud();
    for (const listener of [...listeners]) listener(snapshot);
  };

  /**
   * Fires only where the game has settled onto a state worth resuming from,
   * rather than beside every `publish` — a layout change moves no game state,
   * and a tap mid-animation is still queued rather than resolved.
   */
  const publishSnapshot = (): void => {
    if (options.onSnapshot === undefined) return;
    options.onSnapshot({
      snapshot: snapshotGameState(state),
      genParams,
      playParams,
      segmentCount: board.segmentCount,
      status: state.status,
    });
  };

  const removedSet = (): Set<number> => {
    const set = new Set<number>();
    for (let id = 1; id <= board.segmentCount; id++) {
      if (state.removed[id] === 1) set.add(id);
    }
    return set;
  };

  const fitScale = (): number => Math.min(cssWidth / board.width, cssHeight / board.height) || 1;

  const zoomBounds = (): { min: number; max: number } => {
    const min = fitScale();
    return { min, max: maxZoomScale(min, staticLayer.budget.pixelsPerCell, dpr) };
  };

  const panBounds = (): PanBounds => boardPanBounds(board, cssWidth, cssHeight);

  /** Pointer events outrun frames, so a pan coalesces to one repaint per frame. */
  const scheduleBlit = (): void => {
    if (blitPending || disposed) return;
    blitPending = true;
    scheduler.requestFrame(() => {
      blitPending = false;
      if (!disposed) blit();
    });
  };

  const blit = (): void => {
    const ctx = base.getContext('2d');
    if (ctx === null) {
      if (canvasOk) {
        canvasOk = false;
        publish();
      }
      return;
    }
    if (!canvasOk) {
      canvasOk = true;
      publish();
    }
    const rects = computeBlitRects(
      viewport,
      staticLayer.viewport,
      staticLayer.budget.widthPx,
      staticLayer.budget.heightPx,
      cssWidth,
      cssHeight,
      base.width,
      base.height,
    );
    blitStaticLayer(ctx, staticLayer.canvas, rects, base.width, base.height);
  };

  /** Repaints the offscreen buffer only when the removed set has changed. */
  const syncStaticLayer = (): void => {
    const removed = removedSet();
    if (!removedSetChanged(drawnRemoved, removed)) return;
    redrawStaticLayer(staticLayer, board, removed);
    drawnRemoved = removed;
  };

  const resize = (): void => {
    if (disposed) return;
    const rect = surface.getBoundingClientRect();
    const nextWidth = Math.max(1, rect.width);
    const nextHeight = Math.max(1, rect.height);
    const nextDpr = readDpr();
    cssWidth = nextWidth;
    cssHeight = nextHeight;
    dpr = nextDpr;

    for (const canvas of [base, overlay]) {
      canvas.style.width = `${nextWidth}px`;
      canvas.style.height = `${nextHeight}px`;
      canvas.width = Math.max(1, Math.round(nextWidth * nextDpr));
      canvas.height = Math.max(1, Math.round(nextHeight * nextDpr));
    }
    try {
      animationLayer = createAnimationLayer(nextWidth, nextHeight, nextDpr, () => overlay);
    } catch {
      // Losing the overlay costs the exit animation, not the board: the rest of
      // this layout still has to run or the base layer stays blank.
      animationLayer = null;
    }

    const { min, max } = zoomBounds();
    const nextScale = clampZoomScale(userZoomed ? viewport.scale : min, min, max);
    viewport = clampPan(
      createViewport({
        scale: nextScale,
        dpr: nextDpr,
        originX: viewport.originX,
        originY: viewport.originY,
      }),
      panBounds(),
    );
    legibleUnzoomed = isLayerLegibleUnzoomed(staticLayer, board, nextWidth, nextHeight, nextDpr);
    syncStaticLayer();
    blit();
    publish();
  };

  const startExit = (id: number): void => {
    if (animationLayer === null) {
      // Without an overlay there is no exit to play, but the state machine
      // still has to be settled or it stays `animating` and the board freezes.
      settleWithoutAnimation();
      return;
    }
    animation?.cancel();
    animation = startSnakeOutAnimation({
      board,
      segmentId: id,
      viewport: () => viewport,
      durationMs: playParams.animationDurationMs,
      layer: () => animationLayer as AnimationLayer,
      scheduler,
      onComplete: () => {
        animation = null;
        state = animationComplete(state);
        syncStaticLayer();
        blit();
        publish();
        publishSnapshot();
        driveOutcome();
      },
    });
  };

  /** Starts an animation for a tap the state machine has just resolved, if it needs one. */
  const driveOutcome = (): void => {
    if (!state.animating || state.lastOutcome === null) return;
    if (state.lastOutcome.kind === 'removed') {
      // The segment is already out of the removed-set, so the buffer has to be
      // repainted before the exit starts — otherwise a stationary copy sits on
      // the base layer beside the animating one for the whole flight.
      syncStaticLayer();
      blit();
      publish();
      startExit(state.lastOutcome.id);
      return;
    }
    settleWithoutAnimation();
  };

  /** Advances the queue on the next frame for an outcome with nothing to draw. */
  const settleWithoutAnimation = (): void => {
    // A bounce has no exit to animate, so the queue advances on the next frame
    // rather than waiting for a completion that would never arrive. Only one
    // settle may be pending: a duplicate would land on a later removal and
    // clear `animating` while that exit was still drawing.
    if (bounceHandle !== null) return;
    bounceHandle = scheduler.requestFrame(() => {
      bounceHandle = null;
      if (disposed) return;
      state = animationComplete(state);
      blit();
      publish();
      publishSnapshot();
      driveOutcome();
    });
  };

  const arbiter: GestureArbiter = createGestureArbiter(
    {
      onTap: (point) => {
        if (state.status !== 'playing') return;
        const rect = surface.getBoundingClientRect();
        const local = { x: point.x - rect.left, y: point.y - rect.top } as typeof point;
        const id = hitTest(
          board,
          viewport,
          local,
          (segmentId) => isFree(state, segmentId),
          (segmentId) => isRemoved(state, segmentId),
        );
        if (id === null) return;
        const wasAnimating = state.animating;
        state = tap(state, id);
        // A tap arriving mid-animation is only queued — `lastOutcome` still
        // describes the previous removal, so driving it would cancel and
        // replay the exit already on screen. The queue is drained by whatever
        // settles the animation in flight.
        //
        // No publish either. The counter follows the static layer: a piece is
        // counted as its exit starts, which is when it is lifted off that
        // layer. A terminal status waits for the board to settle.
        if (!wasAnimating) driveOutcome();
      },
      onPanMove: (dx, dy) => {
        viewport = clampPan(panViewport(viewport, dx, dy), panBounds());
        scheduleBlit();
      },
      onPinchMove: (scaleFactor, focal) => {
        const rect = surface.getBoundingClientRect();
        const { min, max } = zoomBounds();
        const next = clampZoomScale(viewport.scale * scaleFactor, min, max);
        userZoomed = true;
        viewport = clampPan(
          zoomViewportAt(viewport, next, focal.x - rect.left, focal.y - rect.top),
          panBounds(),
        );
        scheduleBlit();
      },
    },
    { slopCssPx: 8 },
  );

  const onDown = (event: PointerEvent): void => {
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the platform no longer knows about cannot be captured; the
      // gesture still tracks fine without it.
    }
    arbiter.onPointerDown(event);
  };
  const onMove = (event: PointerEvent): void => arbiter.onPointerMove(event);
  const onUp = (event: PointerEvent): void => arbiter.onPointerUp(event);
  const onCancel = (event: PointerEvent): void => arbiter.onPointerCancel(event);

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onCancel);

  const observer = new ResizeObserver(() => {
    try {
      resize();
    } catch {
      // A layout mid-teardown can fail to allocate; the next one recovers, and
      // an exception escaping the observer would stop it being called again.
    }
  });
  observer.observe(surface);

  const detach = (): void => {
    observer.disconnect();
    surface.removeEventListener('pointerdown', onDown);
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerup', onUp);
    surface.removeEventListener('pointercancel', onCancel);
  };

  try {
    resize();
  } catch (cause) {
    // The caller never receives a handle when construction throws, so nothing
    // else can unhook the listeners or the observer.
    detach();
    throw cause;
  }
  // A board is worth resuming from before it is played: without this, a
  // reload between generating and the first tap comes back on a new seed.
  publishSnapshot();

  return {
    getHud: hud,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restartBoard() {
      // A settle frame from before the restart would land on a later removal
      // and clear `animating` while that exit was still drawing.
      if (bounceHandle !== null) {
        scheduler.cancelFrame(bounceHandle);
        bounceHandle = null;
      }
      animation?.cancel();
      animation = null;
      state = restart(state);
      syncStaticLayer();
      blit();
      publish();
      publishSnapshot();
    },
    reconfigure(nextGenParams, nextPlayParams) {
      if (disposed) return;
      // Everything that can throw runs before anything is torn down, so a
      // parameter set that cannot generate — or a buffer that cannot take a
      // 2d context — leaves the board on screen playable under its old
      // parameters. The cost is that both buffers are briefly live.
      const nextGenerated = generateTimed(nextGenParams);
      const nextStaticLayer = createStaticLayer(nextGenerated.board, { dpr });

      if (bounceHandle !== null) {
        scheduler.cancelFrame(bounceHandle);
        bounceHandle = null;
      }
      animation?.cancel();
      animation = null;
      staticLayer.canvas.width = 0;
      staticLayer.canvas.height = 0;

      genParams = nextGenParams;
      playParams = nextPlayParams ?? playParams;
      generated = nextGenerated;
      board = nextGenerated.board;
      staticLayer = nextStaticLayer;
      metrics = null;
      state = createGameState(board, playParams);
      drawnRemoved = null;
      // A new board is a new fit: keeping a pinch from the previous one lands
      // a different grid size at a scale the player never chose for it.
      userZoomed = false;
      resize();
      publishSnapshot();
    },
    getGenParams: () => genParams,
    getPlayParams: () => playParams,
    getSnapshot: () => snapshotGameState(state),
    getMetrics() {
      // A greedy clear over the whole board is too much to pay on every
      // regenerate, and only a caller showing the numbers ever asks.
      metrics ??= computeMetrics(board, {
        mask: generated.mask,
        path: generated.path,
        generationMs: generated.generationMs,
      });
      return metrics;
    },
    destroy() {
      disposed = true;
      if (bounceHandle !== null) {
        scheduler.cancelFrame(bounceHandle);
        bounceHandle = null;
      }
      animation?.cancel();
      animation = null;
      // Zeroing the offscreen buffer frees it now rather than at the next GC,
      // which matters under a mount/unmount/mount cycle where two would
      // otherwise be live at once.
      staticLayer.canvas.width = 0;
      staticLayer.canvas.height = 0;
      arbiter.reset();
      detach();
      listeners.clear();
    },
  };
}
