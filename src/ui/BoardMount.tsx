import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  DEFAULT_GEN_PARAMS,
  DEFAULT_PLAY_PARAMS,
  type BoardMetrics,
  type GenParams,
  type PlayParams,
} from '../core/types.js';
import { clearSavedGame, loadSavedGame, saveGame, type SavedGame } from '../game/persistence.js';
import { genParamsForShape, type ShapeDrawing } from '../game/shapeBoard.js';
import {
  createBoardController,
  type BoardController,
  type BoardHud,
  type ResumableState,
} from './boardController.js';
import { DevPanel } from './DevPanel.js';

/** How long a lost board stays readable before it replays the same seed. */
const LOSS_BEAT_MS = 1600;

function defaultSearch(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.search;
}

/**
 * `?grid=` and `?seed=` override the derived defaults for the very first
 * board. Once the dev panel is open it takes over live editing of every
 * generation parameter.
 */
export function paramsFromLocation(
  base: GenParams,
  search: string | undefined = defaultSearch(),
): GenParams {
  if (search === undefined) return base;
  const query = new URLSearchParams(search);
  const asInt = (key: string, min: number, max: number): number | null => {
    const raw = query.get(key)?.trim();
    // `Number('')` is 0, so an empty parameter would silently pick a board
    // rather than falling back to the default.
    if (raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= min && value <= max ? value : null;
  };
  return {
    ...base,
    gridSize: asInt('grid', 8, 100) ?? base.gridSize,
    // A seed is unsigned 32-bit: the rng truncates anything wider, so a larger
    // value would silently play a different board than the one it names.
    seed: asInt('seed', 0, 0xffffffff) ?? base.seed,
  };
}

const INITIAL_HUD: BoardHud = {
  lives: DEFAULT_PLAY_PARAMS.lives,
  status: 'playing',
  removedCount: 0,
  segmentCount: 0,
  gridSize: DEFAULT_GEN_PARAMS.gridSize,
  legibleUnzoomed: true,
  bufferOk: true,
  droppedSegments: 0,
};

export interface BoardMountProps {
  /**
   * The shape this board plays. Fixes the derived seed and travels into every
   * save. Null is a board with no shape behind it, which is what a URL naming
   * a seed or a grid size opens.
   */
  readonly shapeId: string | null;
  /**
   * The shape's drawing, which the board is cut from. Absent, the generator
   * draws a procedural blob — which is what a URL naming a seed opens on.
   */
  readonly drawing?: ShapeDrawing;
  /** Returns to the home screen. Safe to call at any point, including mid-animation. */
  readonly onExit: () => void;
}

/**
 * Mounts the board behind refs and never re-renders it. React state here holds
 * only what the chrome shows; every canvas write happens in the controller.
 */
/** A board nobody has played yet: nothing to resume, and nothing worth replacing a save for. */
export function untouched(state: ResumableState): boolean {
  return (
    state.snapshot.removedSegments.length === 0 &&
    (state.snapshot.bouncedSegments?.length ?? 0) === 0 &&
    state.snapshot.lives === state.playParams.lives
  );
}

export function BoardMount(props: BoardMountProps): ReactElement {
  const { shapeId, drawing, onExit } = props;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<BoardController | null>(null);
  const [hud, setHud] = useState<BoardHud>(INITIAL_HUD);
  const [error, setError] = useState<string | null>(null);
  const [genParams, setGenParams] = useState<GenParams>(() =>
    paramsFromLocation(genParamsForShape(shapeId)),
  );
  const [playParams, setPlayParams] = useState<PlayParams>(DEFAULT_PLAY_PARAMS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [metrics, setMetrics] = useState<BoardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const pendingSaveRef = useRef<ResumableState | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  /**
   * Writes whatever is pending straight away, cancelling any debounce still
   * waiting on it. Called both from that debounce and from teardown, so
   * leaving the board — including mid-animation — never drops the write a
   * timer at zero milliseconds had not yet run.
   */
  const flushPending = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const latest = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (latest === null) return;
    // A finished board is not worth resuming: it would come back already
    // over, with nothing to play and no way to tell why.
    if (latest.status !== 'playing') {
      clearSavedGame();
      return;
    }
    // Opening a shape and leaving it alone must not cost the player the board
    // they had going on another one. The controller publishes a snapshot the
    // moment it mounts, so without this a mis-tap on Play overwrites the save.
    if (untouched(latest)) return;
    saveGame(
      latest.snapshot,
      latest.genParams,
      latest.playParams,
      latest.segmentCount,
      latest.shapeId,
    );
  }, []);

  /**
   * Writing straight from the callback would put a synchronous `localStorage`
   * write on the frame that finishes an exit animation, where a dropped frame
   * is most visible. Only the newest state is ever written; the ones a fast
   * sequence of taps produces in between are superseded before the timer runs.
   */
  const persist = useCallback(
    (state: ResumableState) => {
      pendingSaveRef.current = state;
      if (saveTimerRef.current !== null) return;
      saveTimerRef.current = window.setTimeout(flushPending, 0);
    },
    [flushPending],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (surface === null || base === null || overlay === null) return;
    const cutFrom = drawing === undefined ? {} : { drawing };

    const mountController = (saved: SavedGame | null): BoardController =>
      createBoardController(
        { surface, base, overlay },
        saved?.genParams ?? genParams,
        saved?.playParams ?? playParams,
        saved === null
          ? { onSnapshot: persist, shapeId, ...cutFrom }
          : {
              snapshot: saved.snapshot,
              expectedSegmentCount: saved.segmentCount,
              onSnapshot: persist,
              shapeId,
              ...cutFrom,
            },
      );

    // The one save slot only ever resumes onto the shape it was written for;
    // a save for a different shape is left alone rather than reused, and the
    // fresh board below overwrites it as soon as it has anything to persist.
    const loaded = loadSavedGame();
    const saved = loaded !== null && loaded.shapeId === shapeId ? loaded : null;
    let controller: BoardController;
    try {
      controller = mountController(saved);
    } catch (cause) {
      if (saved === null) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
      clearSavedGame();
      try {
        controller = mountController(null);
      } catch (fresh) {
        setError(fresh instanceof Error ? fresh.message : String(fresh));
        return;
      }
    }
    controllerRef.current = controller;
    // A failed earlier mount must not leave its alert over a working board.
    setError(null);
    setHud(controller.getHud());
    setGenParams(controller.getGenParams());
    setPlayParams(controller.getPlayParams());
    const unsubscribe = controller.subscribe(setHud);
    return () => {
      unsubscribe();
      controller.destroy();
      controllerRef.current = null;
      flushPending();
    };
    // Runs once per mount: the dev panel drives every later parameter change
    // through `reconfigure` on the same controller, not through a remount,
    // and a shape change remounts this component from scratch under a fresh
    // `shapeId` rather than reusing this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hud.status !== 'lost') return;
    // Zero lives replays the same seed rather than ending; the delay is only
    // so the player sees why the board reset.
    const timer = window.setTimeout(() => controllerRef.current?.restartBoard(), LOSS_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [hud.status]);

  /** `getMetrics` runs a greedy clear, so it is read only while the panel can show it. */
  const refreshMetrics = useCallback(() => {
    const controller = controllerRef.current;
    if (controller === null) return;
    try {
      setMetrics(controller.getMetrics());
      setMetricsError(null);
    } catch (cause) {
      setMetrics(null);
      setMetricsError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (panelOpen) refreshMetrics();
  }, [panelOpen, refreshMetrics]);

  const applyParams = useCallback(
    (nextGen: GenParams, nextPlay: PlayParams) => {
      const controller = controllerRef.current;
      if (controller === null) return;
      try {
        controller.reconfigure(nextGen, nextPlay);
      } catch (cause) {
        // The controller has changed nothing on a throw, so the board on
        // screen is still the old, playable one under its old parameters.
        setRegenerateError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
      setRegenerateError(null);
      setGenParams(controller.getGenParams());
      setPlayParams(controller.getPlayParams());
      setHud(controller.getHud());
      if (panelOpen) refreshMetrics();
    },
    [panelOpen, refreshMetrics],
  );

  const togglePanel = useCallback(() => setPanelOpen((was) => !was), []);

  const cleared =
    hud.segmentCount === 0 ? 0 : Math.round((hud.removedCount / hud.segmentCount) * 100);

  return (
    <div className="board-shell">
      <header className="hud">
        <button type="button" onClick={onExit}>
          Home
        </button>
        <span className="hud-title">Arrow Maze</span>
        <span className="hud-stat" aria-label={`${hud.lives} lives remaining`}>
          {'♥'.repeat(Math.max(0, hud.lives)) || '—'}
        </span>
        <span className="hud-stat">
          {hud.removedCount}/{hud.segmentCount} ({cleared}%)
        </span>
        <button type="button" onClick={() => controllerRef.current?.restartBoard()}>
          Restart
        </button>
      </header>

      <div className="board-surface" ref={surfaceRef} style={{ touchAction: 'none' }}>
        <canvas ref={baseRef} className="board-canvas" />
        <canvas ref={overlayRef} className="board-canvas" />
      </div>

      <DevPanel
        open={panelOpen}
        onToggle={togglePanel}
        genParams={genParams}
        playParams={playParams}
        metrics={metrics}
        metricsError={metricsError}
        regenerateError={regenerateError}
        onApply={applyParams}
      />

      <footer className="hud-foot">
        {error !== null ? (
          <span role="alert">Could not build a board: {error}</span>
        ) : !hud.bufferOk ? (
          <span role="alert">
            This device could not allocate a drawing buffer, so the board is blank. Try a smaller
            grid size.
          </span>
        ) : hud.status === 'won' ? (
          <span>Board cleared.</span>
        ) : hud.status === 'lost' ? (
          <span>Out of lives — replaying the same board.</span>
        ) : hud.droppedSegments > 0 ? (
          <span role="alert">
            {hud.droppedSegments} {hud.droppedSegments === 1 ? 'piece' : 'pieces'} could not be
            drawn.
          </span>
        ) : !hud.legibleUnzoomed ? (
          <span>
            Zoom in to read the arrowheads at {hud.gridSize}×{hud.gridSize}.
          </span>
        ) : (
          <span>Tap a piece whose path to the edge is clear.</span>
        )}
      </footer>
    </div>
  );
}
