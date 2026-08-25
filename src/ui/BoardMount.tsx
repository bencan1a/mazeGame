import { useEffect, useRef, useState, type ReactElement } from 'react';
import { DEFAULT_GEN_PARAMS, DEFAULT_PLAY_PARAMS } from '../core/types.js';
import { createBoardController, type BoardController, type BoardHud } from './boardController.js';

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
        DEFAULT_GEN_PARAMS,
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
        ) : hud.droppedSegments > 0 ? (
          <span role="alert">{hud.droppedSegments} pieces could not be drawn.</span>
        ) : hud.status === 'won' ? (
          <span>Board cleared.</span>
        ) : hud.status === 'lost' ? (
          <span>Out of lives — restart replays the same board.</span>
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
