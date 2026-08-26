import { useEffect, useRef, type ReactElement } from 'react';
import type { ShapeLibrary } from '../game/shapes.js';
import { hexToRgb, inkFillColor, inkToRgba, isResumeShape } from './homeScreen.js';

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
 * Draws a shape's ink bitmap into a canvas sized to the bitmap itself, then
 * lets CSS scale it up: a small, crisp source stays legible blown up on a
 * phone, where a native-resolution draw would not.
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
    const edge = library.edge;
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const fill = hexToRgb(inkFillColor(index));
    const rgba = inkToRgba(ink, fill);
    ctx.putImageData(new ImageData(rgba, edge, edge), 0, 0);
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
