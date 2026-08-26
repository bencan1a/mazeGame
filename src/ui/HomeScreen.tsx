import { useEffect, useRef, type ReactElement } from 'react';
import type { ShapeLibrary } from '../game/shapes.js';
import { inkFillColor, isResumeShape } from './homeScreen.js';

/**
 * Canvas edge the preview is drawn at, well above both the board's cell grid
 * and the size the frame gives it: the artwork is vector, so drawing it at the
 * board's resolution would show a player the staircase rather than the drawing.
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

/** Shows a shape as it was drawn. What playing it fills is the space between the strokes. */
export function HomeScreen(props: HomeScreenProps): ReactElement {
  const { library, index, onPrevious, onNext, onPlay, resumeShapeId, notice } = props;
  const shape = library.shapes[index];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || shape === undefined) return;
    const outline = library.outline(shape.id);
    if (outline === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    canvas.width = PREVIEW_EDGE;
    canvas.height = PREVIEW_EDGE;
    ctx.clearRect(0, 0, PREVIEW_EDGE, PREVIEW_EDGE);
    ctx.save();
    ctx.scale(PREVIEW_EDGE / outline.viewBox, PREVIEW_EDGE / outline.viewBox);
    ctx.fillStyle = inkFillColor(index);
    // Nonzero, because a drawing's holes are wound against the outline around
    // them and are meant to stay holes.
    ctx.fill(new Path2D(outline.path));
    ctx.restore();
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
