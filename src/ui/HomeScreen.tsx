import { useEffect, useRef, type ReactElement } from 'react';
import { genParamsForShape, shapeFaceMask } from '../game/shapeBoard.js';
import type { ShapeLibrary } from '../game/shapes.js';
import { inkFillColor, isResumeShape } from './homeScreen.js';
import { maskLoops, smoothOutline } from './maskOutline.js';

/**
 * Display resolution of the preview. The face mask is a handful of cells
 * across, so it is drawn small and blown up here; the ratio between the two is
 * what the smoothing pass below is tuned against.
 */
const PREVIEW_EDGE = 512;

export interface HomeScreenProps {
  readonly library: ShapeLibrary;
  /** Index into `library.shapes` of the drawing on screen. */
  readonly index: number;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onPlay: () => void;
  /** The shape holding the one saved board, if there is one. */
  readonly resumeShapeId: string | null;
  /** Shown under the controls when something the player cannot fix went wrong. */
  readonly notice?: string | null;
}

/**
 * Draws the cells a board cut from this shape would fill — the same mask the
 * generator works from, so the preview and the board cannot disagree — as a
 * smoothed outline rather than as pixels.
 */
export function HomeScreen(props: HomeScreenProps): ReactElement {
  const { library, index, onPrevious, onNext, onPlay, resumeShapeId, notice } = props;
  const shape = library.shapes[index];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || shape === undefined) return;
    const ink = library.ink(shape.id);
    if (ink === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    canvas.width = PREVIEW_EDGE;
    canvas.height = PREVIEW_EDGE;
    ctx.clearRect(0, 0, PREVIEW_EDGE, PREVIEW_EDGE);

    const gridSize = genParamsForShape(shape.id).gridSize;
    const mask = shapeFaceMask({ ink, edge: library.edge }, gridSize);
    if (mask === null) return;

    const scale = PREVIEW_EDGE / mask.width;
    ctx.fillStyle = inkFillColor(index);
    const path = new Path2D();
    for (const loop of maskLoops(mask.inside, mask.width, mask.height)) {
      const smoothed = smoothOutline(loop);
      const first = smoothed[0];
      if (first === undefined) continue;
      path.moveTo(first.x * scale, first.y * scale);
      for (const point of smoothed.slice(1)) path.lineTo(point.x * scale, point.y * scale);
      path.closePath();
    }
    // Holes are wound against the outline that contains them, so this cuts
    // them out rather than filling them in.
    ctx.fill(path, 'evenodd');
  }, [library, shape, index]);

  if (shape === undefined) return <div className="home-screen" />;
  const resumable = isResumeShape(shape.id, resumeShapeId);

  return (
    <div className="home-screen">
      <div className="home-drawing-frame">
        <canvas ref={canvasRef} className="home-drawing" aria-hidden="true" />
      </div>
      <h1 className="home-title">{shape.name}</h1>
      <div className="home-controls">
        <button type="button" onClick={onPrevious} aria-label="Previous shape">
          ‹
        </button>
        <button type="button" className="home-play" onClick={onPlay}>
          {resumable ? 'Resume' : 'Play'}
        </button>
        <button type="button" onClick={onNext} aria-label="Next shape">
          ›
        </button>
      </div>
      {notice === null || notice === undefined ? null : <p role="status">{notice}</p>}
    </div>
  );
}
