import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  DEFAULT_GEN_PARAMS,
  DEFAULT_PLAY_PARAMS,
  type BoardMetrics,
  type GenParams,
  type PlayParams,
} from '../core/types.js';
import { clearSavedGame, loadSavedGame, saveGame, type SavedGame } from '../game/persistence.js';
import {
  createBoardController,
  type BoardController,
  type BoardHud,
  type ResumableState,
} from './boardController.js';
import { DevPanel } from './DevPanel.js';

/** How long a lost board stays readable before it replays the same seed. */
const LOSS_BEAT_MS = 1600;

/**
 * `?grid=` and `?seed=` override the defaults for the very first board. Once
 * the dev panel is open it takes over live editing of every generation
 * parameter.
 */
function paramsFromLocation(): GenParams {
  if (typeof window === 'undefined') return DEFAULT_GEN_PARAMS;
  const query = new URLSearchParams(window.location.search);
  const asInt = (key: string, min: number, max: number): number | null => {
    const raw = query.get(key)?.trim();
    // `Number('')` is 0, so an empty parameter would silently pick a board
    // rather than falling back to the default.
    if (raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= min && value <= max ? value : null;
  };
  return {
    ...DEFAULT_GEN_PARAMS,
    gridSize: asInt('grid', 8, 100) ?? DEFAULT_GEN_PARAMS.gridSize,
    // A seed is unsigned 32-bit: the rng truncates anything wider, so a larger
    // value would silently play a different board than the one it names.
    seed: asInt('seed', 0, 0xffffffff) ?? DEFAULT_GEN_PARAMS.seed,
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

/**
 * Mounts the board behind refs and never re-renders it. React state here holds
 * only what the chrome shows; every canvas write happens in the controller.
 */
export function BoardMount(): ReactElement {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<BoardController | null>(null);
  const [hud, setHud] = useState<BoardHud>(INITIAL_HUD);
  const [error, setError] = useState<string | null>(null);
  const [genParams, setGenParams] = useState<GenParams>(paramsFromLocation);
  const [playParams, setPlayParams] = useState<PlayParams>(DEFAULT_PLAY_PARAMS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [metrics, setMetrics] = useState<BoardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const pendingSaveRef = useRef<ResumableState | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  /**
   * Writing straight from the callback would put a synchronous `localStorage`
   * write on the frame that finishes an exit animation, where a dropped frame
   * is most visible. Only the newest state is ever written; the ones a fast
   * sequence of taps produces in between are superseded before the timer runs.
   */
  const persist = useCallback((state: ResumableState) => {
    pendingSaveRef.current = state;
    if (saveTimerRef.current !== null) return;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const latest = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (latest === null) return;
      // A finished board is not worth resuming: it would come back already
      // over, with nothing to play and no way to tell why.
      if (latest.status !== 'playing') {
        clearSavedGame();
        return;
      }
      saveGame(latest.snapshot, latest.genParams, latest.playParams, latest.segmentCount);
    }, 0);
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (surface === null || base === null || overlay === null) return;

    const mountController = (saved: SavedGame | null): BoardController =>
      createBoardController(
        { surface, base, overlay },
        saved?.genParams ?? genParams,
        saved?.playParams ?? playParams,
        saved === null
          ? { onSnapshot: persist }
          : {
              snapshot: saved.snapshot,
              expectedSegmentCount: saved.segmentCount,
              onSnapshot: persist,
            },
      );

    // A save is only worth resuming onto the board its own seed generates, and
    // whether it does is not knowable until that board exists. So the resume
    // is attempted and the saved game dropped if the controller refuses it,
    // rather than validated up front by generating the board twice.
    const saved = loadSavedGame();
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
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
    // Runs once: the dev panel drives every later parameter change through
    // `reconfigure` on the same controller, not through a remount.
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
