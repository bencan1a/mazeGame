import { useEffect, useRef, useState, type ReactElement } from 'react';
import { DEFAULT_GEN_PARAMS, DEFAULT_PLAY_PARAMS, type GenParams } from '../core/types.js';
import { createBoardController, type BoardController, type BoardHud } from './boardController.js';

/** How long a lost board stays readable before it replays the same seed. */
const LOSS_BEAT_MS = 1600;

/**
 * `?grid=` and `?seed=` override the defaults. The tuning panel is a later
 * milestone; this is the only way to reach a size other than the default,
 * which the on-device performance pass needs.
 */
function paramsFromLocation(): GenParams {
  if (typeof window === 'undefined') return DEFAULT_GEN_PARAMS;
  const query = new URLSearchParams(window.location.search);
  const asInt = (key: string, min: number, max: number): number | null => {
    const raw = query.get(key);
    if (raw === null) return null;
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

  useEffect(() => {
    const surface = surfaceRef.current;
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (surface === null || base === null || overlay === null) return;

    let controller: BoardController;
    try {
      controller = createBoardController(
        { surface, base, overlay },
        paramsFromLocation(),
        DEFAULT_PLAY_PARAMS,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    controllerRef.current = controller;
    // A failed earlier mount must not leave its alert over a working board.
    setError(null);
    setHud(controller.getHud());
    const unsubscribe = controller.subscribe(setHud);
    return () => {
      unsubscribe();
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (hud.status !== 'lost') return;
    // Zero lives replays the same seed rather than ending; the delay is only
    // so the player sees why the board reset.
    const timer = window.setTimeout(() => controllerRef.current?.restartBoard(), LOSS_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [hud.status]);

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
