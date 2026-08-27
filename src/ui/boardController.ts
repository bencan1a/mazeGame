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
  hasBounced,
  hitTest,
  isFree,
  isRemoved,
  restart,
  restoreGameState,
  shapeGenerateOptions,
  snapshotGameState,
  tap,
  type GameSnapshot,
  type GameState,
  type GestureArbiter,
  type ShapeDrawing,
} from '../game/index.js';
import {
  INTRO_DURATION_MS,
  INTRO_START_ZOOM,
  blitStaticLayer,
  clampPan,
  clampZoomScale,
  computeBlitRects,
  createAnimationLayer,
  createStaticLayer,
  createDomScheduler,
  createViewport,
  drawStaticLayerSegments,
  introCamera,
  isLayerLegibleUnzoomed,
  maxZoomScale,
  panViewport,
  redrawStaticLayer,
  segmentSetsDiffer,
  startBounceAnimation,
  startIntroAnimation,
  startSnakeOutAnimation,
  zoomViewportAt,
  type AnimationLayer,
  type IntroAnimation,
  type IntroFrame,
  type SnakeOutAnimation,
  type SnakeOutAnimationOptions,
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
  /** The shape this board was started for, echoed straight from `BoardControllerOptions`. */
  readonly shapeId: string | null;
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
  /**
   * The shape this board plays, carried through to every `ResumableState` so
   * a save names the shape it belongs to. `null` for a procedural board.
   */
  readonly shapeId?: string | null;
  /**
   * The shape's drawing, cut into every board this controller generates. Left
   * out, the generator draws its own procedural blob. Held rather than turned
   * into a silhouette up front because the silhouette has to be re-imported at
   * whatever grid size the board is currently generated at.
   */
  readonly drawing?: ShapeDrawing;
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
export function drawnSetChanged(
  drawn: ReadonlySet<number> | null,
  current: ReadonlySet<number>,
): boolean {
  return drawn === null || segmentSetsDiffer(drawn, current);
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
function generateTimed(params: GenParams, drawing: ShapeDrawing | undefined): GeneratedBoard {
  const startedAt = performance.now();
  const options = drawing === undefined ? {} : shapeGenerateOptions(drawing, params.gridSize);
  const { board, mask, path } = generateBoardWithDiagnostics(params, options);
  return { board, mask, path, generationMs: performance.now() - startedAt };
}

function readDpr(): number {
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // Not every environment the controller runs in implements matchMedia; an
    // unanswerable preference is not a stated one.
    return false;
  }
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

  const shapeId: string | null = options.shapeId ?? null;
  const drawing: ShapeDrawing | undefined = options.drawing;
  let genParams: GenParams = initialGenParams;
  let playParams: PlayParams = initialPlayParams;
  let generated: GeneratedBoard = generateTimed(genParams, drawing);
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
  let drawnHidden: Set<number> | null = null;
  let drawnBounced: Set<number> | null = null;
  /**
   * The segment currently drawn on the animation layer instead of the static
   * one. Not the same as "removed": a bouncing segment is still on the board.
   */
  let liftedId: number | null = null;
  let viewport: Viewport<'css'> = createViewport({ scale: 1, dpr });
  let legibleUnzoomed = true;
  let settleHandle: number | null = null;
  /** False once the visible canvas has refused a 2d context, leaving a blank board. */
  let canvasOk = true;
  let blitPending = false;
  /** True once the player has pinched; until then every layout re-fits the board. */
  let userZoomed = false;
  let disposed = false;
  let intro: IntroAnimation | null = null;
  /**
   * While true the static layer holds only segments 1..`introRevealed` and the
   * viewport is the reveal's own camera rather than the resting fit.
   */
  let introActive = false;
  let introRevealed = 0;
  /** What the reveal draws against, held for its duration so state cannot move under it. */
  let introHidden: Set<number> = new Set();
  let introBounced: Set<number> = new Set();

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
      shapeId,
    });
  };

  /** Segments the static layer must not draw: gone from the board, or in flight over it. */
  const settledHiddenSet = (): Set<number> => {
    const set = new Set<number>();
    for (let id = 1; id <= board.segmentCount; id++) {
      if (isRemoved(state, id)) set.add(id);
    }
    if (liftedId !== null) set.add(liftedId);
    return set;
  };

  /** The above, plus everything the opening reveal has not reached yet. */
  const hiddenSet = (): Set<number> => {
    const set = settledHiddenSet();
    if (introActive) {
      for (let id = introRevealed + 1; id <= board.segmentCount; id++) set.add(id);
    }
    return set;
  };

  /**
   * The segment whose bounce the state machine has resolved but whose
   * animation has not landed yet. Its mark belongs to the animation, which
   * turns it white at the impact; painting it white on the buffer first shows
   * the result of the bounce before the bounce.
   */
  const bounceInFlight = (): number | null =>
    state.animating && state.lastOutcome?.kind === 'bounced' ? state.lastOutcome.id : null;

  /** Segments the static layer must paint in the blocked colour rather than their own. */
  const bouncedSet = (): Set<number> => {
    const inFlight = bounceInFlight();
    const set = new Set<number>();
    for (let id = 1; id <= board.segmentCount; id++) {
      if (id !== inFlight && hasBounced(state, id)) set.add(id);
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

  /** Repaints the offscreen buffer only when what it would draw has changed. */
  const syncStaticLayer = (): void => {
    const hidden = hiddenSet();
    const bounced = bouncedSet();
    if (!drawnSetChanged(drawnHidden, hidden) && !drawnSetChanged(drawnBounced, bounced)) return;
    redrawStaticLayer(staticLayer, board, hidden, bounced);
    drawnHidden = hidden;
    drawnBounced = bounced;
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

  /** The viewport the board rests at: fitted to the canvas, then pan-clamped. */
  const restingViewport = (): Viewport<'css'> => {
    const { min, max } = zoomBounds();
    return clampPan(createViewport({ scale: clampZoomScale(min, min, max), dpr }), panBounds());
  };

  /**
   * Deliberately not held to `zoomBounds().max`, which is the point past which
   * the buffer is being magnified rather than sampled. That ceiling protects a
   * resting view the player reads arrowheads on; the reveal is moving the whole
   * time and lands exactly on the resting scale, and on a board whose fit
   * already sits at the ceiling honouring it would mean no zoom at all.
   */
  const introStartScale = (): number => restingViewport().scale * INTRO_START_ZOOM;

  const introFrame = (frame: IntroFrame): void => {
    if (frame.revealedCount > introRevealed) {
      drawStaticLayerSegments(
        staticLayer,
        board,
        introRevealed + 1,
        frame.revealedCount,
        introHidden,
        introBounced,
      );
      introRevealed = frame.revealedCount;
    }
    viewport = introCamera({
      resting: restingViewport(),
      startScale: introStartScale(),
      progress: frame.progress,
      bounds: panBounds(),
    });
    blit();
  };

  /** Hands the board back: fully drawn, at rest, and tappable again. */
  const endIntro = (): void => {
    introActive = false;
    intro = null;
    surface.removeAttribute('data-intro');
    // A reveal that reached the last segment painted every segment outside
    // these two sets, so this is what the buffer holds and syncStaticLayer
    // repaints only if the game moved while it was running. One cut short by
    // a failed frame left the buffer part drawn, which no drawn set describes.
    const revealedAll = introRevealed >= board.segmentCount;
    drawnHidden = revealedAll ? introHidden : null;
    drawnBounced = revealedAll ? introBounced : null;
    syncStaticLayer();
    viewport = restingViewport();
    blit();
    publish();
  };

  /** Drops the reveal where it stands, for a board that is about to be replaced. */
  const cancelIntro = (): void => {
    if (intro === null && !introActive) return;
    intro?.cancel();
    intro = null;
    introActive = false;
    surface.removeAttribute('data-intro');
    // The buffer holds however far the reveal got, which no drawn set describes.
    drawnHidden = null;
    drawnBounced = null;
  };

  /**
   * Marks the board as awaiting its reveal, so the layout that first paints it
   * draws an empty buffer rather than painting it in full and clearing it
   * again. Returns whether there is a reveal to start.
   */
  const armIntro = (): boolean => {
    if (board.segmentCount === 0 || !staticLayer.allocationOk) return false;
    if (prefersReducedMotion()) return false;
    introActive = true;
    introRevealed = 0;
    introHidden = settledHiddenSet();
    introBounced = bouncedSet();
    return true;
  };

  const startIntro = (): void => {
    if (!introActive || disposed) return;
    surface.setAttribute('data-intro', 'running');
    try {
      intro = startIntroAnimation({
        board,
        durationMs: INTRO_DURATION_MS,
        scheduler,
        onFrame: introFrame,
        onComplete: endIntro,
      });
    } catch {
      // A reveal that cannot start must not cost the board: drop back to the
      // finished one rather than leaving it hidden behind a reveal nothing drives.
      cancelIntro();
      syncStaticLayer();
      blit();
    }
  };

  /** What both flight animations are driven with; the bounce adds to it. */
  const flightOptions = (id: number): SnakeOutAnimationOptions => ({
    board,
    segmentId: id,
    viewport: () => viewport,
    durationMs: playParams.animationDurationMs,
    layer: () => animationLayer as AnimationLayer,
    scheduler,
    onComplete: () => {
      animation = null;
      liftedId = null;
      state = animationComplete(state);
      syncStaticLayer();
      blit();
      publish();
      publishSnapshot();
      driveOutcome();
    },
  });

  const startExit = (id: number): void => {
    if (animationLayer === null) {
      // Without an overlay there is no exit to play, but the state machine
      // still has to be settled or it stays `animating` and the board freezes.
      settleWithoutAnimation();
      return;
    }
    animation?.cancel();
    animation = startSnakeOutAnimation(flightOptions(id));
  };

  const startBounce = (id: number): void => {
    if (animationLayer === null) {
      settleWithoutAnimation();
      return;
    }
    animation?.cancel();
    // A bouncing segment is still on the board, so nothing has taken it off
    // the buffer the way the removed set takes an exiting one off: without
    // this it would stay painted at rest under the moving copy.
    liftedId = id;
    syncStaticLayer();
    blit();
    animation = startBounceAnimation({
      ...flightOptions(id),
      isRemovedSegment: (segmentId) => isRemoved(state, segmentId),
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
    if (state.lastOutcome.kind === 'bounced') {
      // The life is already spent in state, so the counter drops as the bounce
      // starts rather than when it lands.
      publish();
      startBounce(state.lastOutcome.id);
      return;
    }
    settleWithoutAnimation();
  };

  /**
   * Every scheduled thing that draws, stopped. A pending settle frame is part
   * of it: one from before a restart or a reconfigure would land on a later
   * removal and clear `animating` while that exit was still drawing.
   */
  const stopMotion = (): void => {
    cancelIntro();
    if (settleHandle !== null) {
      scheduler.cancelFrame(settleHandle);
      settleHandle = null;
    }
    animation?.cancel();
    animation = null;
    liftedId = null;
  };

  /** Advances the queue on the next frame for an outcome with nothing to draw. */
  const settleWithoutAnimation = (): void => {
    // Reached only when there is no overlay to animate on, so the queue
    // advances on the next frame rather than waiting for a completion that
    // would never arrive. Only one settle may be pending: a duplicate would
    // land on a later removal and clear `animating` while that exit was still
    // drawing.
    if (settleHandle !== null) return;
    settleHandle = scheduler.requestFrame(() => {
      settleHandle = null;
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
    if (introActive) {
      // The touch that ends the reveal does not also play a piece: the board
      // it would have been aimed at was not finished being drawn.
      intro?.finish();
      return;
    }
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

  const introArmed = armIntro();
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
  if (introArmed) startIntro();

  return {
    getHud: hud,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restartBoard() {
      stopMotion();
      state = restart(state);
      // The same board laying itself out again, which is what a restart is.
      const armed = armIntro();
      syncStaticLayer();
      blit();
      publish();
      publishSnapshot();
      if (armed) startIntro();
    },
    reconfigure(nextGenParams, nextPlayParams) {
      if (disposed) return;
      // Everything that can throw runs before anything is torn down, so a
      // parameter set that cannot generate — or a buffer that cannot take a
      // 2d context — leaves the board on screen playable under its old
      // parameters. The cost is that both buffers are briefly live.
      const nextGenerated = generateTimed(nextGenParams, drawing);
      const nextStaticLayer = createStaticLayer(nextGenerated.board, { dpr });

      stopMotion();
      staticLayer.canvas.width = 0;
      staticLayer.canvas.height = 0;

      genParams = nextGenParams;
      playParams = nextPlayParams ?? playParams;
      generated = nextGenerated;
      board = nextGenerated.board;
      staticLayer = nextStaticLayer;
      metrics = null;
      state = createGameState(board, playParams);
      drawnHidden = null;
      drawnBounced = null;
      // A new board is a new fit: keeping a pinch from the previous one lands
      // a different grid size at a scale the player never chose for it.
      userZoomed = false;
      const armed = armIntro();
      resize();
      publishSnapshot();
      if (armed) startIntro();
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
      stopMotion();
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
